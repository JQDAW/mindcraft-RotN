#!/usr/bin/env bash
# G0 watchdog acceptance test (docs/briefs/harness-ops.md, Phase 0 revisions):
#   a labelled server with delete-after in the past is gone, with its Primary IP, within one
#   sweeper interval; a server without the test label is left untouched.
#
#   test/scenarios/g0-watchdog.sh --yes [--mode scheduled|dispatch|local] [--timeout MIN]
#
#   scheduled  (default) wait for the 15-minute cron run of .github/workflows/test-server-sweeper.yml
#   dispatch   trigger that workflow on develop now with `gh workflow run`
#   local      run `deploy/test-server.sh sweep` from this PC (proves the logic, not the off-PC part)
#
# PASS needs the target gone within one sweeper interval (15 min) plus 5 min for the run itself,
# and the control still present. GitHub may start scheduled runs late; that shows as a FAIL.
#
# Creates two CX23s (EUR 0.0109/h each) in the hcloud context mindcraft-rotn-test only:
#   target   purpose=mindcraft-rotn-test, delete-after=<now-60>, batch=<name>; its own Primary IPv4
#            with auto-delete OFF, so the sweeper must delete the IP itself.
#   control  NO purpose=mindcraft-rotn-test, but the same expired delete-after=<now-60>: a sweeper
#            that ignored the purpose label would delete it too. It carries
#            purpose=mindcraft-rotn-watchdog-control and control-expires=<now+1h>, by which the
#            sweeper deletes it (plus 30 min grace) if this script dies. IPv6 only.
# The EXIT trap deletes only what this run created, by the IDs returned from `create -o json`.
set -Eeuo pipefail

HCLOUD_BIN=${HCLOUD_BIN:-hcloud}
GH_BIN=${GH_BIN:-gh}
readonly TEST_CONTEXT=mindcraft-rotn-test
CONTEXT=${HCLOUD_CONTEXT:-$TEST_CONTEXT}
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
STATE_ROOT=${ROTN_TEST_STATE_DIR:-$HOME/.mindcraft-rotn/test-server}
POLL_SECONDS=${WATCHDOG_POLL_SECONDS:-30}
MODE=scheduled TIMEOUT_MIN=35 YES=0 LOCATION=nbg1 TYPE=cx23
INTERVAL_S=900 RUN_SLACK_S=300 CONTROL_TTL_S=3600

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
[[ $CONTEXT == "$TEST_CONTEXT" ]] || { echo "refusing hcloud context '$CONTEXT': only '$TEST_CONTEXT' is allowed" >&2; exit 2; }
[[ $TIMEOUT_MIN =~ ^[0-9]+$ ]] && (( TIMEOUT_MIN >= 1 && TIMEOUT_MIN * 60 < CONTROL_TTL_S )) \
  || { echo "--timeout must be 1..$(( CONTROL_TTL_S / 60 - 1 )) min (the control must outlive the test)" >&2; exit 2; }
(( YES )) || { echo "pass --yes: creates two $TYPE servers (about EUR 0.03 in total)" >&2; exit 2; }

log() { printf '[watchdog %s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
# Same rule as deploy/test-server.sh: always the test context, never a token from the environment.
hc() { env -u HCLOUD_TOKEN -u HCLOUD_CONTEXT "$HCLOUD_BIN" --context "$CONTEXT" "$@"; }
exists_id() { [[ -n $2 ]] && hc "$1" describe "$2" -o json > /dev/null 2>&1; }
id_of() { jq -r "$1 // empty" | tr -d '\r'; }   # read the new resource's ID from `create -o json`

TS=${WATCHDOG_TS:-$(date -u +%Y%m%d-%H%M%S)}
NAME=mcr-wd-$TS
CONTROL=mcr-wdctl-$TS
WORK=$STATE_ROOT/watchdog/$NAME
mkdir -p "$WORK"
chmod 700 "$WORK"
NOW=$(date -u +%s)
KEY_ID='' IP_ID='' SRV_ID='' CTL_ID=''

cleanup() {
  local rc=$?
  trap - EXIT
  trap '' INT TERM HUP
  log "cleanup: deleting what this run created (by ID)"
  if exists_id server "$CTL_ID"; then hc server delete "$CTL_ID" > /dev/null || true; fi
  if exists_id server "$SRV_ID"; then hc server delete "$SRV_ID" > /dev/null || true; fi
  local i
  for (( i = 0; i < 20; i++ )); do
    exists_id primary-ip "$IP_ID" || break
    hc primary-ip delete "$IP_ID" > /dev/null 2>&1 || sleep "$(( POLL_SECONDS < 3 ? POLL_SECONDS : 3 ))"
  done
  if exists_id ssh-key "$KEY_ID"; then hc ssh-key delete "$KEY_ID" > /dev/null || true; fi
  local left='' r
  for r in "server:$CTL_ID" "server:$SRV_ID" "primary-ip:$IP_ID" "ssh-key:$KEY_ID"; do
    if exists_id "${r%%:*}" "${r#*:}"; then left+=" [$r]"; fi
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
control=(--label purpose=mindcraft-rotn-watchdog-control --label "delete-after=$(( NOW - 60 ))"
         --label "control-expires=$(( NOW + CONTROL_TTL_S ))" --label "batch=$NAME")
ssh-keygen -q -t ed25519 -N '' -C "$NAME" -f "$WORK/id_ed25519"
log "creating target $NAME (expired, labelled), its Primary IPv4 (auto-delete off) and control $CONTROL"
KEY_ID=$(hc ssh-key create --name "$NAME" --public-key-from-file "$WORK/id_ed25519.pub" "${expired[@]}" -o json | id_of .ssh_key.id)
IP_ID=$(hc primary-ip create --name "$NAME-ipv4" --type ipv4 --location "$LOCATION" --auto-delete=false \
  "${expired[@]}" -o json | id_of .primary_ip.id)
SRV_ID=$(hc server create --name "$NAME" --type "$TYPE" --image ubuntu-24.04 --location "$LOCATION" \
  --ssh-key "$KEY_ID" --primary-ipv4 "$IP_ID" --without-ipv6 "${expired[@]}" -o json | id_of .server.id)
CTL_ID=$(hc server create --name "$CONTROL" --type "$TYPE" --image ubuntu-24.04 --location "$LOCATION" \
  --ssh-key "$KEY_ID" --without-ipv4 "${control[@]}" -o json | id_of .server.id)
[[ -n $KEY_ID && -n $IP_ID && -n $SRV_ID && -n $CTL_ID ]] || { log "a create returned no ID"; exit 1; }
T0=$(date -u +%s)
log "created at $(date -u -d "@$T0" +%H:%M:%SZ): key $KEY_ID, ip $IP_ID, target $SRV_ID, control $CTL_ID; mode=$MODE"

case $MODE in
  local) HCLOUD_CONTEXT=$CONTEXT "$REPO_ROOT/deploy/test-server.sh" sweep || log "local sweep reported a problem" ;;
  dispatch) "$GH_BIN" workflow run test-server-sweeper.yml --ref develop ;;
  scheduled) log "waiting for the scheduled sweeper (every 15 min; GitHub may start it late)" ;;
esac

deadline=$(( T0 + TIMEOUT_MIN * 60 ))
gone_at=''
while :; do
  if ! exists_id server "$SRV_ID" && ! exists_id primary-ip "$IP_ID" && ! exists_id ssh-key "$KEY_ID"; then
    gone_at=$(date -u +%s)
    break
  fi
  (( $(date -u +%s) < deadline )) || break
  sleep "$POLL_SECONDS"
done

control_ok=false
if exists_id server "$CTL_ID"; then control_ok=true; fi
elapsed=$([[ -n $gone_at ]] && echo $(( gone_at - T0 )) || echo null)
in_interval=false
if [[ -n $gone_at ]] && (( gone_at - T0 <= INTERVAL_S + RUN_SLACK_S )); then in_interval=true; fi
pass=false
[[ $in_interval == true && $control_ok == true ]] && pass=true
runs='[]'
if [[ $MODE != local ]]; then
  runs=$("$GH_BIN" run list --workflow test-server-sweeper.yml --limit 5 \
    --json databaseId,event,status,conclusion,createdAt 2>/dev/null || echo '[]')
fi
jq -n --arg b "$NAME" --arg m "$MODE" --argjson pass "$pass" --argjson e "$elapsed" --argjson c "$control_ok" \
  --argjson w "$in_interval" --arg t0 "$(date -u -d "@$T0" +%Y-%m-%dT%H:%M:%SZ)" --argjson runs "$runs" \
  '{scenario:"g0-watchdog", batch:$b, mode:$m, pass:$pass, created:$t0, seconds_until_gone:$e,
    within_one_interval:$w, control_untouched:$c, recent_sweeper_runs:$runs}' | tee "$WORK/result.json"

if [[ $pass == true ]]; then
  log "PASS: target server, Primary IPv4 and SSH key deleted by the sweeper after ${elapsed}s; control (same expired delete-after, no test label) untouched"
else
  log "FAIL: seconds_until_gone=$elapsed (limit $(( INTERVAL_S + RUN_SLACK_S ))) control_untouched=$control_ok"
  exit 1
fi
