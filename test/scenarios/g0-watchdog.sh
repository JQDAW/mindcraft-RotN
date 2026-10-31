#!/usr/bin/env bash
# G0 watchdog acceptance test (docs/briefs/harness-ops.md, Phase 0 revisions):
#   a labelled server with delete-after in the past is gone, with its Primary IP, within one
#   sweeper interval; a server without the test label is left untouched.
#
#   test/scenarios/g0-watchdog.sh --yes [--mode scheduled|dispatch|local] [--timeout MIN] [--context CTX]
#
# PASS needs the target gone within one sweeper interval (15 min) plus 5 min for the run itself.
# GitHub may start scheduled runs late; that shows up here as a FAIL, on purpose.
#
#   scheduled  (default) wait for the 15-minute cron run of .github/workflows/test-server-sweeper.yml
#   dispatch   trigger that workflow on develop now with `gh workflow run`
#   local      run `deploy/test-server.sh sweep` from this PC (proves the logic, not the off-PC part)
#
# Creates two CX23s (EUR 0.0109/h each) for at most --timeout minutes:
#   target   labels purpose=mindcraft-rotn-test, delete-after=<now-60>, batch=<name>; its own
#            Primary IPv4 with auto-delete OFF, so the sweeper must delete the IP itself.
#   control  labels purpose=mindcraft-rotn-watchdog-control, delete-after=<now+2h>, batch=<name>.
#            The sweeper selects only purpose=mindcraft-rotn-test, so it must leave this alone.
#            (Every server we create carries labels; "unlabelled" here means without the test label.)
# The EXIT trap deletes whatever of these is left, by exact name.
set -Eeuo pipefail

HCLOUD_BIN=${HCLOUD_BIN:-hcloud}
CONTEXT=${HCLOUD_CONTEXT:-}
INTERVAL_S=900 RUN_SLACK_S=300
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
STATE_ROOT=${ROTN_TEST_STATE_DIR:-$HOME/.mindcraft-rotn/test-server}
MODE=scheduled TIMEOUT_MIN=35 YES=0 LOCATION=nbg1 TYPE=cx23

while (( $# )); do
  case $1 in
    --mode) MODE=$2; shift 2 ;;
    --timeout) TIMEOUT_MIN=$2; shift 2 ;;
    --location) LOCATION=$2; shift 2 ;;
    --context) CONTEXT=$2; shift 2 ;;
    --yes) YES=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[[ $MODE =~ ^(scheduled|dispatch|local)$ ]] || { echo "bad --mode" >&2; exit 2; }
(( YES )) || { echo "pass --yes: creates two $TYPE servers (about EUR 0.03 in total)" >&2; exit 2; }

log() { printf '[watchdog %s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
hc() { if [[ -n $CONTEXT ]]; then "$HCLOUD_BIN" --context "$CONTEXT" "$@"; else "$HCLOUD_BIN" "$@"; fi; }
exists() { hc "$1" describe "$2" -o json > /dev/null 2>&1; }

TS=$(date -u +%Y%m%d-%H%M%S)
NAME=mcr-wd-$TS
CONTROL=mcr-wdctl-$TS
WORK=$STATE_ROOT/watchdog/$NAME
mkdir -p "$WORK"
chmod 700 "$WORK"
NOW=$(date -u +%s)

cleanup() {
  local rc=$?
  trap - EXIT
  log "cleanup: deleting anything left from $NAME / $CONTROL"
  exists server "$CONTROL" && hc server delete "$CONTROL" > /dev/null || true
  exists server "$NAME" && hc server delete "$NAME" > /dev/null || true
  local i
  for (( i = 0; i < 20; i++ )); do
    exists primary-ip "$NAME-ipv4" || break
    hc primary-ip delete "$NAME-ipv4" > /dev/null 2>&1 || sleep 3
  done
  exists ssh-key "$NAME" && hc ssh-key delete "$NAME" > /dev/null || true
  local left=''
  for r in "server $CONTROL" "server $NAME" "primary-ip $NAME-ipv4" "ssh-key $NAME"; do
    # shellcheck disable=SC2086
    exists $r && left+=" [$r]"
  done
  rm -f "$WORK/id_ed25519" "$WORK/id_ed25519.pub"
  if [[ -n $left ]]; then log "CLEANUP INCOMPLETE:$left"; rc=1; else log "cleanup verified"; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

hc server list -l purpose=mindcraft-rotn-test -o noheader > /dev/null || { log "hcloud not authenticated"; exit 1; }

expired=(--label purpose=mindcraft-rotn-test --label "delete-after=$(( NOW - 60 ))" --label "batch=$NAME")
ssh-keygen -q -t ed25519 -N '' -C "$NAME" -f "$WORK/id_ed25519"
log "creating target $NAME (expired labels), its Primary IPv4 (auto-delete off) and control $CONTROL"
hc ssh-key create --name "$NAME" --public-key-from-file "$WORK/id_ed25519.pub" "${expired[@]}" > /dev/null
hc primary-ip create --name "$NAME-ipv4" --type ipv4 --location "$LOCATION" --auto-delete=false "${expired[@]}" > /dev/null
hc server create --name "$NAME" --type "$TYPE" --image ubuntu-24.04 --location "$LOCATION" --ssh-key "$NAME" \
  --primary-ipv4 "$NAME-ipv4" --without-ipv6 "${expired[@]}" > /dev/null
hc server create --name "$CONTROL" --type "$TYPE" --image ubuntu-24.04 --location "$LOCATION" --ssh-key "$NAME" \
  --without-ipv4 --label purpose=mindcraft-rotn-watchdog-control --label "delete-after=$(( NOW + 7200 ))" \
  --label "batch=$NAME" > /dev/null
T0=$(date -u +%s)
log "created at $(date -u -d "@$T0" +%H:%M:%SZ); mode=$MODE"

case $MODE in
  local) HCLOUD_CONTEXT=$CONTEXT "$REPO_ROOT/deploy/test-server.sh" sweep || log "local sweep reported a problem" ;;
  dispatch) gh workflow run test-server-sweeper.yml --ref develop ;;
  scheduled) log "waiting for the scheduled sweeper (every 15 min; GitHub may start it late)" ;;
esac

deadline=$(( T0 + TIMEOUT_MIN * 60 ))
gone_at=''
while (( $(date -u +%s) < deadline )); do
  if ! exists server "$NAME" && ! exists primary-ip "$NAME-ipv4" && ! exists ssh-key "$NAME"; then
    gone_at=$(date -u +%s)
    break
  fi
  sleep 30
done

control_ok=false
exists server "$CONTROL" && control_ok=true
elapsed=$([[ -n $gone_at ]] && echo $(( gone_at - T0 )) || echo null)
in_interval=false
if [[ -n $gone_at ]] && (( gone_at - T0 <= INTERVAL_S + RUN_SLACK_S )); then in_interval=true; fi
pass=false
[[ $in_interval == true && $control_ok == true ]] && pass=true
runs=$(gh run list --workflow test-server-sweeper.yml --limit 5 --json databaseId,event,status,conclusion,createdAt 2>/dev/null || echo '[]')
jq -n --arg b "$NAME" --arg m "$MODE" --argjson pass "$pass" --argjson e "$elapsed" --argjson c "$control_ok" --argjson w "$in_interval" \
  --arg t0 "$(date -u -d "@$T0" +%Y-%m-%dT%H:%M:%SZ)" --argjson runs "$runs" \
  '{scenario:"g0-watchdog", batch:$b, mode:$m, pass:$pass, created:$t0, seconds_until_gone:$e,
    within_one_interval:$w, control_untouched:$c, recent_sweeper_runs:$runs}' | tee "$WORK/result.json"

if [[ $pass == true ]]; then
  log "PASS: target server, Primary IPv4 and SSH key deleted by the sweeper after ${elapsed}s; control untouched"
else
  log "FAIL: seconds_until_gone=$elapsed (limit $(( INTERVAL_S + RUN_SLACK_S ))) control_untouched=$control_ok"
  exit 1
fi
