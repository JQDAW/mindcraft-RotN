#!/usr/bin/env bash
# Root-owned control wrapper for the bot units, installed as /usr/local/sbin/mindcraft-rotn-ctl.
# The deploy user may run exactly this program with sudo (/etc/sudoers.d/mindcraft-rotn), never
# systemctl itself: a sudoers wildcard such as `systemctl restart mindcraft-rotn@*` would also match
# `restart mindcraft-rotn@x other.service`.
#
#   sudo mindcraft-rotn-ctl ACTION BOT     ACTION: start | stop | restart | status | is-active | is-enabled | enable | disable
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
#
# The paths are fixed on purpose: nothing in the caller's environment may change what root runs
# (PR #30 review finding 8). The offline tests run a copy with these lines rewritten.
set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin

readonly SYSTEMCTL=/usr/bin/systemctl
readonly JOURNALCTL=/usr/bin/journalctl
readonly ETC_DIR=/etc/mindcraft-rotn
readonly HEAD=/usr/bin/head
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
    # The line cap, and a byte cap on top (#326 review). A journalctl stopped by the byte cap (SIGPIPE, 141) is a
    # cut, noted on stderr; any other failure of journalctl is its own exit code.
    set +e
    "$JOURNALCTL" "--unit=$unit" --no-pager --no-hostname --utc --output=short-iso "--lines=$JOURNAL_LINES" "${since[@]}" | "$HEAD" -c "$JOURNAL_BYTES"
    st=("${PIPESTATUS[@]}")
    set -e
    (( st[1] == 0 )) || exit "${st[1]}"
    case ${st[0]} in
      0) exit 0 ;;
      141) echo "mindcraft-rotn-ctl: journal cut at $JOURNAL_BYTES bytes (the newest $JOURNAL_LINES lines were more)" >&2; exit 0 ;;
      *) exit "${st[0]}" ;;
    esac ;;
  metrics)
    (( $# == 2 )) || die "usage: mindcraft-rotn-ctl metrics BOT"
    unit=$(unit_of "$2")
    exec "$SYSTEMCTL" show --no-pager "--property=$METRICS" "$unit" ;;
  *)
    die "usage: mindcraft-rotn-ctl {start|stop|restart|status|is-active|is-enabled|enable|disable|journal|metrics} BOT | list | daemon-reload" ;;
esac
