#!/usr/bin/env bash
# Mindcraft-RotN disposable test server: on-server helper, installed as /usr/local/sbin/rotn-test.
# The PC calls it over SSH (deploy/test-server.sh). Test server only; never the live server.
#
#   rotn-test phase                      current build phase (booting until cloud-init wrote it)
#   rotn-test start                      release a build held for extra mods (--extra-mod)
#   rotn-test console [--wait S] CMD...  type CMD into the Forge console, print new log lines
#   rotn-test log [N]                    tail logs/latest.log
#   rotn-test log N rotated              the same over the newest daily logs/YYYY-MM-DD-N.log.gz plus latest.log (log4j
#                                        rolls latest.log daily at 00:00 UTC); the first line names the files:
#                                        "##rotn-test files: <a.log.gz>,latest.log"
#   rotn-test build-log [N]              tail the first-boot build log
#   rotn-test verify                     key=value facts for the G0 checks
#   rotn-test restart [--timeout S]      restart the Minecraft server (G4 #1, server restart; test server only):
#                                        console `stop`, wait until rotn-server has exited, start it again, and wait
#                                        for a NEW "Done" line; prints "restarted: <done line>". S: a positive whole
#                                        number of seconds (default 300). Exit 2: usage; 4: it does not stop within
#                                        S; 5: no new Done line within S (or it exits first); 6: the start failed;
#                                        125: after the new Done, Mod Director's downloads fail the pinned check
#                                        (ADR 0008; phase failed:mod-director, the server stopped), as at first start.
#   rotn-test mod-director               check what Mod Director downloaded against the pinned list (ADR 0008):
#                                        exit 0 OK, 1 a problem, 3 cannot check; one line per pinned file
set -euo pipefail

# The overrides (ROTN_TEST_SERVER_DIR, ROTN_TEST_REMOTE_STATE_DIR, ROTN_TEST_SYSTEMCTL, ROTN_TEST_CONSOLE_SEND,
# ROTN_TEST_POLL_S, ROTN_TEST_GZ_RETRY_S) are for the offline tests only.
# (REMOTE: never the PC's own ROTN_TEST_STATE_DIR, which test-server.sh uses for its local state; #324 review.)
STATE=${ROTN_TEST_REMOTE_STATE_DIR:-/var/lib/rotn-test}
SERVER=${ROTN_TEST_SERVER_DIR:-/opt/rotn/server}
SYSTEMCTL=${ROTN_TEST_SYSTEMCTL:-systemctl}
SOCK=/opt/rotn/console.sock
LOG=$SERVER/logs/latest.log
# build.sh's "server ready" line: [12:00:00] [Server thread/INFO] [minecraft/DedicatedServer]: Done (41.2s)! For help, ...
DONE_REGEX='\]: Done \([0-9.,]+s\)! For help'

# Type one line into the Forge console (the tmux session rotn-server runs in).
send_line() {
  if [[ -n ${ROTN_TEST_CONSOLE_SEND:-} ]]; then "$ROTN_TEST_CONSOLE_SEND" "$1"; return; fi
  runuser -u minecraft -- tmux -S "$SOCK" send-keys -t rotn -l -- "$1"
  runuser -u minecraft -- tmux -S "$SOCK" send-keys -t rotn Enter
}
done_count() { local n; n=$(grep -cE "$DONE_REGEX" "$LOG" 2>/dev/null) || true; echo "${n:-0}"; }
log_inode() { stat -c %i "$LOG" 2>/dev/null || echo none; }

prop() { awk -v k="$1" '{ sub(/\r$/, "") } index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$SERVER/server.properties" 2>/dev/null || true; }
state() { tr -d '\n' < "$STATE/$1" 2>/dev/null || true; }

# mod_director_check (ADR 0008). Mod Director (in the pinned zip) fetches a list from the pack's moving `stable`
# branch at every start, then the jars it names, with no hash (mod-director.sha256 has the URLs); it installs them
# as top-level jars in mods/ ("Installed mod file /opt/rotn/server/mods/esmtweaks-1.12.2-0.4.5.jar", every server
# log of rounds 8 and 9). Run at each Done: build.sh at the first start, `restart` after its new Done. Only
# TOP-LEVEL mods/*.jar (files or symlinks: ! -type d) are compared, each by its full SHA-256: a jar of the pinned
# zip ($STATE/pack-jars.sha256, hashed by the build right after unpacking the verified zip), a pinned download
# (/etc/rotn-test/mod-director.sha256; the binding check), or an --extra-mod this harness uploaded
# ($STATE/extra-mods.sha256, hashed before the first start). Subfolders (mods/memory_repo/, mods/1.12.2/) are never
# compared: Forge writes into them at run time. A pinned entry outside mods/ must be on disk too: a missing pinned
# file of any kind is a problem (#351 review; the list's own copy was never on disk, so #351 dropped its line).
# Nothing here fetches. Exit 0 OK, 1 a problem, 3 cannot check. Prints one line per pinned or extra file (the zip's
# jars only as a count, or when one fails); a line break in a name is printed as \n.
mod_director_check() {
  local list=${ROTN_TEST_MODDIR_LIST:-/etc/rotn-test/mod-director.sha256} packjars=$STATE/pack-jars.sha256 extras=$STATE/extra-mods.sha256
  local problems=0 npinned=0 npack=0 nextra=0 f rel got
  local -A known=()
  md() { printf 'mod-director: %s\n' "$*"; }
  top_jar() { [[ $1 =~ ^mods/[^/]+\.jar$ ]]; }
  # From stdin (sha256sum puts "\" before the hash of a name with a backslash or a line break); empty for a dangling
  # symlink (never a silent exit).
  hash_of() { sha256sum 2>/dev/null < "$1" | cut -d' ' -f1 || true; }
  [[ -r $list ]] || { md "FAILED: cannot check: no pinned list $list"; exit 3; }
  # A missing tool must never pass as "nothing found" (#359 review): a find that cannot run would list no jar at all.
  for f in find sort sha256sum; do command -v "$f" > /dev/null || { md "FAILED: cannot check: no $f on PATH"; exit 3; }; done
  [[ -s $packjars ]] || { md "FAILED: cannot check: no hashes of the pinned zip's jars $packjars"; exit 3; }
  [[ -d $SERVER/mods ]] || { md "FAILED: cannot check: no $SERVER/mods"; exit 3; }
  # check_sums FILE KIND: every "<sha256>  <path>" line of FILE must name a file whose full SHA-256 matches.
  check_sums() {
    local want rel got ok
    while read -r want rel; do
      [[ -z $want || $want == \#* ]] && continue
      ok=1
      # A path may hold spaces, quotes and brackets (round 10 A: "mods/Aether Continuation v1.3.0.jar" and 15 more of
      # the pinned zip's jars): `read` gives the whole rest of the line after the hash and two spaces.
      [[ $want =~ ^[0-9a-f]{64}$ && -n $rel && $rel != /* && $rel != *..* ]] || ok=0
      [[ $rel == mods/* ]] && ! top_jar "$rel" && ok=0   # under mods/, only a top-level jar is compared
      [[ $2 != pinned ]] && ! top_jar "$rel" && ok=0      # the zip's and the extra jars are top-level jars
      (( ok )) || { md "FAILED: cannot check: a bad line in $1"; exit 3; }
      known[$rel]=$2
      if [[ ! -f $SERVER/$rel ]]; then
        md "MISSING $rel ($2)"; problems=$(( problems + 1 ))   # fails closed for every kind (#351 review)
        continue
      fi
      got=$(hash_of "$SERVER/$rel")
      if [[ $got == "$want" ]]; then [[ $2 == pack ]] || md "$2 $rel sha256 $got OK"
      else md "MISMATCH $rel sha256 ${got:-unreadable} != $want ($2)"; problems=$(( problems + 1 )); fi
      case $2 in pinned) npinned=$(( npinned + 1 )) ;; pack) npack=$(( npack + 1 )) ;; *) nextra=$(( nextra + 1 )) ;; esac
    done < "$1"
  }
  check_sums "$list" pinned
  check_sums "$packjars" pack
  [[ -f $extras ]] && check_sums "$extras" extra-mod
  # The listing goes to a file first, so find's and sort's exit codes are seen (a process substitution hides them).
  local listing=$STATE/mod-director.jars st
  # In a brace group of an || list, set -e does not end the script on the pipeline: its own status is read.
  { find "$SERVER/mods" -maxdepth 1 -name '*.jar' ! -type d -print0 | sort -z > "$listing"; st=("${PIPESTATUS[@]}"); } || true
  (( st[0] == 0 && st[1] == 0 )) || { md "FAILED: cannot check: listing $SERVER/mods failed (find ${st[0]}, sort ${st[1]})"; exit 3; }
  while IFS= read -r -d '' f; do
    rel=${f#"$SERVER"/}
    [[ -n ${known[$rel]:-} ]] && continue
    got=$(hash_of "$f")
    md "EXTRA ${rel//$'\n'/\\n} sha256 ${got:-unreadable} (not in the pinned zip or the pinned list)"
    problems=$(( problems + 1 ))
  done < "$listing"
  if (( problems )); then md "FAILED: $problems problem(s)"; exit 1; fi
  md "OK: $npinned pinned download(s) match; $npack jars of the pinned zip match; $nextra extra mod(s)"
}

cmd=${1:-help}
[[ $# -gt 0 ]] && shift

case $cmd in
  phase)
    # Before the build writes a phase, report cloud-init's own status (booting:running, booting:error...).
    if [[ -f $STATE/phase ]]; then cat "$STATE/phase"
    else echo "booting:$(cloud-init status 2>/dev/null | sed -n 's/^status: //p' | head -1)"; fi
    ;;
  start)
    touch "$STATE/start-requested"
    ;;
  console)
    wait=5
    if [[ ${1:-} == --wait ]]; then wait=$2; shift 2; fi
    [[ ${1:-} == -- ]] && shift
    line="$*"
    [[ -n $line ]] || { echo "usage: rotn-test console [--wait S] CMD" >&2; exit 2; }
    before=0
    [[ -f $LOG ]] && before=$(wc -l < "$LOG")
    send_line "$line"
    sleep "$wait"
    if [[ -f $LOG ]]; then
      now=$(wc -l < "$LOG")
      # latest.log was rolled over while we waited (it is shorter now): all of the new file is new.
      if (( now < before )); then cat "$LOG"; else tail -n "+$(( before + 1 ))" "$LOG"; fi
    fi
    ;;
  log)
    n=${1:-100}
    [[ $n =~ ^[0-9]+$ ]] || { echo "usage: rotn-test log [N] [rotated]" >&2; exit 2; }
    if [[ ${2:-} == rotated ]]; then
      # The newest DAILY rolled-over file (YYYY-MM-DD-N.log.gz; never Forge's debug-N.log.gz), by modification
      # time, then latest.log; one file name per entry.
      rot=$(ls -t "$SERVER"/logs/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.log.gz 2>/dev/null | head -n 1 || true)
      old=''
      if [[ -n $rot ]]; then
        # log4j may still be writing the .gz right after 00:00: one retry after a short pause (lead, #236 review).
        if ! old=$(gzip -dc "$rot" 2>/dev/null); then
          sleep "${ROTN_TEST_GZ_RETRY_S:-2}"
          old=$(gzip -dc "$rot" 2>/dev/null) || { echo "rotn-test: cannot read $(basename "$rot") (gzip failed twice)" >&2; exit 3; }
        fi
      fi
      echo "##rotn-test files: ${rot:+$(basename "$rot"),}latest.log"
      { [[ -n $old ]] && printf '%s\n' "$old"; [[ -f $LOG ]] && cat "$LOG"; } | tail -n "$n"
    else
      tail -n "$n" "$LOG"
    fi
    ;;
  build-log)
    tail -n "${1:-100}" /var/log/rotn-test-build.log
    ;;
  verify)
    echo "phase=$(state phase)"
    echo "java_version=$(state java-version)"
    echo "pack_source=$(state pack-source)"
    echo "pack_sha256_verified=$(state pack-sha256-verified)"
    echo "download_sha256=$(state download-sha256)"
    echo "forge_jar=$(cd "$SERVER" 2>/dev/null && ls forge-*.jar 2>/dev/null | grep -v installer | head -1)"
    echo "mod_jars=$(find "$SERVER/mods" -maxdepth 1 -name '*.jar' 2>/dev/null | wc -l)"
    echo "reid_jar=$(cd "$SERVER/mods" 2>/dev/null && ls RoughlyEnoughIDs-*.jar 2>/dev/null | head -1)"
    echo "online_mode=$(prop online-mode)"
    echo "white_list=$(prop white-list)"
    echo "network_compression_threshold=$(prop network-compression-threshold)"
    echo "firewall_allow_from=$(state firewall-allow-from)"
    echo "eula=$(grep -E '^eula=' "$SERVER/eula.txt" 2>/dev/null | cut -d= -f2 | tr -d '\r')"
    echo "whitelist_names=$(jq -r '[.[].name] | join(",")' "$SERVER/whitelist.json" 2>/dev/null || true)"
    echo "whitelist_missing=$(tr '\n' ',' < "$STATE/whitelist-missing" 2>/dev/null | sed 's/,$//' || true)"
    echo "start_command=$(grep -E '^exec java' "$SERVER/start-test.sh" 2>/dev/null || true)"
    echo "done_line=$(state done-line)"
    echo "unloading_dimension_7=$(grep -c 'Unloading dimension 7' "$LOG" 2>/dev/null || true)"
    echo "server_active=$(systemctl is-active rotn-server 2>/dev/null || true)"
    echo "listening_25565=$(ss -Hltn 'sport = :25565' 2>/dev/null | wc -l)"
    pid=$(pgrep -u minecraft -f 'forge-1.12.2-.*nogui' | head -1 || true)
    echo "java_rss_mb=$( [[ -n $pid ]] && awk '/VmRSS/ { printf "%d", $2 / 1024 }' "/proc/$pid/status" || true)"
    echo "mem_total_mb=$(awk '/MemTotal/ { printf "%d", $2 / 1024 }' /proc/meminfo)"
    echo "cloud_init_schema=$(cloud-init schema --system > /dev/null 2>&1 && echo valid || echo invalid)"
    ;;
  mod-director)
    mod_director_check
    ;;
  restart)
    # [--timeout S], S a positive whole number with no leading zero (#324 review: no 0, no octal); nothing else.
    restart_usage() { echo "usage: rotn-test restart [--timeout S] (S: whole seconds, 1 or more)" >&2; exit 2; }
    timeout=300
    if [[ ${1:-} == --timeout ]]; then
      (( $# >= 2 )) || restart_usage
      timeout=$2; shift 2
    fi
    (( $# == 0 )) || restart_usage
    [[ $timeout =~ ^[1-9][0-9]*$ ]] || restart_usage
    poll=${ROTN_TEST_POLL_S:-5}
    echo restarting > "$STATE/phase"
    # 1. console stop (the server saves and exits; the tmux session, and so rotn-server, end with it)
    if $SYSTEMCTL is-active --quiet rotn-server; then
      send_line stop
      waited=0
      while $SYSTEMCTL is-active --quiet rotn-server; do
        if (( waited >= timeout )); then echo "failed:restart: still running ${timeout}s after stop" > "$STATE/phase"; echo "rotn-test: the server is still running ${timeout}s after 'stop'" >&2; exit 4; fi
        sleep "$poll"; waited=$(( waited + poll ))
      done
    fi
    # 2. start, then a NEW Done line: log4j rolls latest.log over at startup (a new file), else more Done lines than before
    ino=$(log_inode); dc=$(done_count)
    if ! $SYSTEMCTL start rotn-server; then
      echo "failed:restart: start failed" > "$STATE/phase"; echo "rotn-test: 'systemctl start rotn-server' failed" >&2; exit 6
    fi
    waited=0
    while :; do
      now_ino=$(log_inode); now_dc=$(done_count)
      if { [[ $now_ino != "$ino" ]] && (( now_dc >= 1 )); } || { [[ $now_ino == "$ino" ]] && (( now_dc > dc )); }; then break; fi
      if (( waited > 20 )) && ! $SYSTEMCTL is-active --quiet rotn-server; then
        echo "failed:restart: exited before Done" > "$STATE/phase"; echo "rotn-test: the server exited before its Done line (see $SERVER/logs)" >&2; exit 5
      fi
      if (( waited >= timeout )); then echo "failed:restart: no Done in ${timeout}s" > "$STATE/phase"; echo "rotn-test: no new Done line ${timeout}s after the start" >&2; exit 5; fi
      sleep "$poll"; waited=$(( waited + poll ))
    done
    # 3. ADR 0008: Mod Director ran again at this start; the same check as at the first start (build.sh), fail closed.
    rc=0
    md_out=$(mod_director_check) || rc=$?
    printf '%s\n' "$md_out" | tee "$STATE/mod-director.txt"
    if (( rc )); then
      $SYSTEMCTL stop rotn-server || true
      echo "failed:mod-director: $(grep -m1 -E '^mod-director: (MISMATCH|MISSING|EXTRA|FAILED)' <<< "$md_out" | sed 's/^mod-director: //')" > "$STATE/phase"
      echo "rotn-test: after the restart, Mod Director's downloads fail the pinned check (ADR 0008); the server is stopped" >&2
      exit 125
    fi
    echo ready > "$STATE/phase"
    echo "restarted: $(grep -E "$DONE_REGEX" "$LOG" 2>/dev/null | tail -n 1)"   # the newest Done line
    ;;
  *)
    sed -n '2,22p' "$0"
    [[ $cmd == help ]] || exit 2
    ;;
esac
