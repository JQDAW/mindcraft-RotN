#!/usr/bin/env bash
# Root-owned control wrapper for the bot units, installed as /usr/local/sbin/mindcraft-rotn-ctl.
# The deploy user may run exactly this program with sudo (/etc/sudoers.d/mindcraft-rotn), never
# systemctl itself: a sudoers wildcard such as `systemctl restart mindcraft-rotn@*` would also match
# `restart mindcraft-rotn@x other.service`.
#
#   sudo mindcraft-rotn-ctl ACTION BOT     ACTION: start | stop | restart | status | is-active | is-enabled | enable | disable
#                                          (start runs `systemctl reset-failed` first, so a failed unit starts; start
#                                          and restart hold LOCK, as reset-state does, so neither can race a reset)
#   sudo mindcraft-rotn-ctl list           the bots that have an env file in /etc/mindcraft-rotn
#   sudo mindcraft-rotn-ctl daemon-reload
#   Read-only, for the G4 scenarios (test/scenarios/g4/PLAN.md; they change nothing):
#   sudo mindcraft-rotn-ctl journal BOT [--since TIME]   the unit's journal (UTC, ISO times): the newest JOURNAL_LINES
#                                          lines, of which at most the first JOURNAL_BYTES bytes (a cut is noted on stderr;
#                                          narrow with --since to read the newest part).
#                                          TIME: YYYY-MM-DD HH:MM[:SS], YYYY-MM-DDTHH:MM[:SS][Z] (both read as UTC, and
#                                          a real date and time) or @EPOCH_SECONDS; nothing else (no relative times).
#   sudo mindcraft-rotn-ctl metrics BOT    MemoryCurrent, MemoryPeak, NRestarts and ActiveState (systemctl show),
#                                          one KEY=value line each
#   ADR 0011 (through the CX33's gate, under the soak's GO):
#   sudo mindcraft-rotn-ctl reset-state BOT NAME
#                                          BOT is the unit's name (frcfld), NAME the bot's Mindcraft profile name
#                                          (FRCFLD, ^[A-Za-z0-9_]{1,16}$), whose folder is BOTS_DIR/NAME. Only while
#                                          the unit is inactive or failed, and under LOCK: every entry of that folder
#                                          except KEEP (action-code, histories, last_profile.json) is moved, by
#                                          rename(2) only, into a new ARCHIVE_DIR/BOT-<UTC time>/ (root, 0700).
#                                          Nothing is deleted or copied. It prints what moved, what remains and the
#                                          archive path. The token cache /var/lib/mindcraft-rotn/<bot>/msa is outside
#                                          BOTS_DIR and never touched; the env file is never read.
#
# The paths are fixed on purpose: nothing in the caller's environment may change what root runs
# (PR #30 review finding 8). The offline tests run a copy with these lines rewritten.
set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin

readonly SYSTEMCTL=/usr/bin/systemctl
readonly JOURNALCTL=/usr/bin/journalctl
readonly ETC_DIR=/etc/mindcraft-rotn
readonly HEAD=/usr/bin/head
readonly MKTEMP=/usr/bin/mktemp
readonly STAT=/usr/bin/stat
readonly RM=/usr/bin/rm
readonly MV=/usr/bin/mv
readonly MKDIR=/usr/bin/mkdir
readonly DATE=/usr/bin/date
readonly FLOCK=/usr/bin/flock
readonly LOCK=/run/mindcraft-rotn-ctl.lock   # in root's /run: no other user can create or replace it
readonly LOCK_WAIT_S=30
readonly BOTS_DIR=/var/lib/mindcraft-rotn/bots
readonly ARCHIVE_DIR=/var/lib/mindcraft-rotn-archive
readonly SVC_USER=mindcraft-rotn
readonly ARCHIVE_UID=0
readonly KEEP=(action-code histories last_profile.json)
readonly NAME_RE='^[A-Za-z0-9_]{1,16}$'
readonly JOURNAL_LINES=20000
readonly JOURNAL_BYTES=8388608
readonly METRICS=MemoryCurrent,MemoryPeak,NRestarts,ActiveState
readonly BOT_RE='^[a-z0-9][a-z0-9-]{0,31}$'

die() { echo "mindcraft-rotn-ctl: $*" >&2; exit 2; }
# A real calendar date and time (#326 review): month 1-12, the month's days (leap years too), 00-23, 00-59, 00-59.
# Every part is read in base 10, so 08 and 09 are not octal. No external program sees the text.
valid_datetime() {
  local y=$((10#$1)) mo=$((10#$2)) d=$((10#$3)) h=$((10#$4)) mi=$((10#$5)) se=$((10#${6:-0})) dim=31
  (( mo >= 1 && mo <= 12 && h <= 23 && mi <= 59 && se <= 59 && d >= 1 )) || return 1
  case $mo in 4|6|9|11) dim=30 ;; 2) dim=28; (( (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 )) && dim=29 ;; esac
  (( d <= dim ))
}
# The bot argument: a valid name with an env file (the unknown-bot refusal); prints the unit.
unit_of() {
  local bot=$1
  [[ $bot =~ $BOT_RE ]] || die "bad bot name '$bot' (lowercase letters, digits, '-', at most 32)"
  [[ -f $ETC_DIR/$bot.env ]] || die "no env file for '$bot' (run bootstrap.sh add-bot $bot)"
  echo "mindcraft-rotn@$bot.service"
}
# LOCK on fd 9, held until this process (or the program it execs) ends: start and reset-state take it.
take_lock() {
  exec 9> "$LOCK" || die "cannot open $LOCK"
  "$FLOCK" -w "$LOCK_WAIT_S" 9 || die "another start or reset-state holds $LOCK (waited ${LOCK_WAIT_S}s)"
}
# reset-state BOT NAME (ADR 0011). Root works in a tree the bot user can write, so: lstat checks (no symlink, the
# expected owner), then a cd into the folder, checked to be the same inode the lstat saw; every move is relative to
# that directory (a later swap of a path above it changes nothing), by rename(2) on one filesystem.
reset_state() {
  local bot=$1 name=$2 unit=$3 st dir ino p n k keep archive
  local -a move=() kept=() left=()
  [[ $name =~ $NAME_RE ]] || die "bad profile name '$name' ([A-Za-z0-9_], 1-16)"
  export LC_ALL=C
  umask 077
  take_lock
  st=$("$SYSTEMCTL" show --no-pager --property=ActiveState --value "$unit") || die "cannot read the state of $unit (nothing moved)"
  [[ $st == inactive || $st == failed ]] || die "$unit is '$st', not inactive or failed: stop it first (nothing moved)"
  [[ -d $BOTS_DIR && ! -L $BOTS_DIR ]] || die "$BOTS_DIR is not a real directory (nothing moved)"
  dir=$BOTS_DIR/$name
  [[ -d $dir && ! -L $dir ]] || die "$dir is not a real directory (missing, a file or a symlink; nothing moved)"
  [[ $("$STAT" -c %U -- "$dir") == "$SVC_USER" ]] || die "$dir is not owned by $SVC_USER (nothing moved)"
  ino=$("$STAT" -c %d:%i -- "$dir")
  cd -P -- "$dir" || die "cannot enter $dir (nothing moved)"
  [[ $("$STAT" -c %d:%i -- .) == "$ino" ]] || die "$dir changed while it was checked (nothing moved)"
  # The archive parent: root's own, 0700, outside the bot user's tree; on the same device as BOTS_DIR and this folder.
  if [[ ! -e $ARCHIVE_DIR && ! -L $ARCHIVE_DIR ]]; then "$MKDIR" -m 0700 -- "$ARCHIVE_DIR" || die "cannot create $ARCHIVE_DIR (nothing moved)"; fi
  [[ -d $ARCHIVE_DIR && ! -L $ARCHIVE_DIR ]] || die "$ARCHIVE_DIR is not a real directory (nothing moved)"
  [[ $("$STAT" -c '%u %a' -- "$ARCHIVE_DIR") == "$ARCHIVE_UID 700" ]] || die "$ARCHIVE_DIR must be root's and 0700 (nothing moved)"
  [[ $("$STAT" -c %d -- "$BOTS_DIR") == $("$STAT" -c %d -- "$ARCHIVE_DIR") && $("$STAT" -c %d -- .) == $("$STAT" -c %d -- "$ARCHIVE_DIR") ]] \
    || die "$BOTS_DIR and $ARCHIVE_DIR are on different devices: a move could copy and delete (nothing moved)"
  shopt -s nullglob dotglob
  for p in ./*; do
    n=${p#./}
    keep=0
    for k in "${KEEP[@]}"; do if [[ $n == "$k" ]]; then keep=1; fi; done
    if (( keep )); then kept+=("$n"); else move+=("$n"); fi
  done
  if (( ${#move[@]} == 0 )); then
    echo "reset-state $bot: nothing to move in $dir (no archive made)"
    for n in "${kept[@]}"; do printf '  remains: %q\n' "$n"; done
    return 0
  fi
  archive=$ARCHIVE_DIR/$bot-$("$DATE" -u +%Y%m%dT%H%M%SZ)
  "$MKDIR" -m 0700 -- "$archive" || die "cannot create $archive: it exists, or the parent is not writable (nothing moved)"
  for n in "${move[@]}"; do
    # -T: never into an existing directory of that name; rename(2) moves a symlink itself, never what it points to.
    "$MV" -T -- "./$n" "$archive/$n" || die "moving $n failed; what moved so far is in $archive"
    if [[ -e ./$n || -L ./$n ]]; then die "$n is still in $dir after the move; what moved so far is in $archive"; fi
  done
  echo "reset-state $bot: moved ${#move[@]} entries of $dir"
  for n in "${move[@]}"; do printf '  moved: %q\n' "$n"; done
  for p in ./*; do left+=("${p#./}"); done
  for n in "${left[@]}"; do printf '  remains: %q\n' "$n"; done
  if (( ${#left[@]} == 0 )); then echo "  remains: (nothing)"; fi
  echo "archive: $archive"
}

action=${1:-}
case $action in
  list)
    (( $# == 1 )) || die "list takes no arguments"
    shopt -s nullglob
    for f in "$ETC_DIR"/*.env; do b=$(basename "$f" .env); [[ $b =~ $BOT_RE ]] && echo "$b"; done
    exit 0 ;;
  daemon-reload)
    (( $# == 1 )) || die "daemon-reload takes no arguments"
    exec "$SYSTEMCTL" daemon-reload ;;
  start|stop|restart|status|is-active|is-enabled|enable|disable)
    (( $# == 2 )) || die "usage: mindcraft-rotn-ctl $action BOT"
    unit=$(unit_of "$2")
    extra=()
    [[ $action == status ]] && extra=(--no-pager)
    # A unit that failed, or hit its start limit (StartLimitBurst: 6 starts in 10 min), refuses `start` until it is
    # reset (G4 step 0, 2026-11-08). An explicit start is a human's, or an agent's under a written GO, so it clears
    # that state first; on a unit that has not failed, reset-failed changes nothing. Only for start.
    if [[ $action == start || $action == restart ]]; then take_lock; fi
    if [[ $action == start ]]; then "$SYSTEMCTL" reset-failed "$unit" || true; fi
    exec "$SYSTEMCTL" "$action" "${extra[@]}" "$unit" ;;
  journal)
    # journal BOT, or journal BOT --since TIME; nothing else.
    (( $# == 2 || $# == 4 )) || die "usage: mindcraft-rotn-ctl journal BOT [--since TIME]"
    unit=$(unit_of "$2")
    since=()
    if (( $# == 4 )); then
      [[ $3 == --since ]] || die "usage: mindcraft-rotn-ctl journal BOT [--since TIME]"
      t=$4
      if [[ $t =~ ^(([0-9]{4})-([0-9]{2})-([0-9]{2}))[\ T](([0-9]{2}):([0-9]{2})(:([0-9]{2}))?)Z?$ ]]; then
        valid_datetime "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}" "${BASH_REMATCH[6]}" "${BASH_REMATCH[7]}" "${BASH_REMATCH[9]}" \
          || die "bad --since '$t': not a real date and time"
        since=("--since=${BASH_REMATCH[1]} ${BASH_REMATCH[5]} UTC")
      elif [[ $t =~ ^@[0-9]{1,12}$ ]]; then
        since=("--since=$t")
      else
        die "bad --since '$t' (YYYY-MM-DD HH:MM[:SS], YYYY-MM-DDTHH:MM[:SS][Z] or @EPOCH_SECONDS)"
      fi
    fi
    # The line cap, and a byte cap on top (#326 review). Whether the output was cut is decided from what arrived,
    # never from how journalctl ended (#326 re-review: up to a pipe buffer past the cap, journalctl exits 0 and a
    # SIGPIPE never comes): one byte more than the cap is read into a root-only temp file, at most the cap is
    # printed, and a cut is noted on stderr. journalctl's own failure keeps its exit code (after what it printed).
    tmpf=$("$MKTEMP" /tmp/mindcraft-rotn-journal.XXXXXX)   # a fixed template: no TMPDIR from the caller
    trap '"$RM" -f "$tmpf"' EXIT
    set +e
    "$JOURNALCTL" "--unit=$unit" --no-pager --no-hostname --utc --output=short-iso "--lines=$JOURNAL_LINES" "${since[@]}" \
      | "$HEAD" -c "$(( JOURNAL_BYTES + 1 ))" > "$tmpf"
    st=("${PIPESTATUS[@]}")
    set -e
    (( st[1] == 0 )) || exit "${st[1]}"
    size=$("$STAT" -c %s "$tmpf")
    "$HEAD" -c "$JOURNAL_BYTES" "$tmpf"
    if (( size > JOURNAL_BYTES )); then echo "mindcraft-rotn-ctl: journal cut at $JOURNAL_BYTES bytes (the newest $JOURNAL_LINES lines were more)" >&2; fi
    # 141: journalctl stopped by the full read above (SIGPIPE), which is the cut, not a failure.
    (( st[0] == 0 || st[0] == 141 )) || exit "${st[0]}"
    exit 0 ;;
  metrics)
    (( $# == 2 )) || die "usage: mindcraft-rotn-ctl metrics BOT"
    unit=$(unit_of "$2")
    exec "$SYSTEMCTL" show --no-pager "--property=$METRICS" "$unit" ;;
  reset-state)
    (( $# == 3 )) || die "usage: mindcraft-rotn-ctl reset-state BOT NAME"
    unit=$(unit_of "$2")
    reset_state "$2" "$3" "$unit"
    exit 0 ;;
  *)
    die "usage: mindcraft-rotn-ctl {start|stop|restart|status|is-active|is-enabled|enable|disable|journal|metrics} BOT | reset-state BOT NAME | list | daemon-reload" ;;
esac
