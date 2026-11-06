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
set -euo pipefail

STATE=/var/lib/rotn-test
SERVER=${ROTN_TEST_SERVER_DIR:-/opt/rotn/server}   # the override (and ROTN_TEST_GZ_RETRY_S) is for the offline tests only
SOCK=/opt/rotn/console.sock
LOG=$SERVER/logs/latest.log

prop() { awk -v k="$1" '{ sub(/\r$/, "") } index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$SERVER/server.properties" 2>/dev/null || true; }
state() { tr -d '\n' < "$STATE/$1" 2>/dev/null || true; }

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
    runuser -u minecraft -- tmux -S "$SOCK" send-keys -t rotn -l -- "$line"
    runuser -u minecraft -- tmux -S "$SOCK" send-keys -t rotn Enter
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
  *)
    sed -n '2,12p' "$0"
    [[ $cmd == help ]] || exit 2
    ;;
esac
