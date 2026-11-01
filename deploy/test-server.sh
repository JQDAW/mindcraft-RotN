#!/usr/bin/env bash
# deploy/test-server.sh: disposable RotN 3.3.4 test server on Hetzner Cloud (harness-ops, gate G0).
#
# The PC only calls hcloud (create, poll, test, delete). cloud-init does the whole build on the box
# (deploy/test-server/build.sh). Every resource carries the labels
#   purpose=mindcraft-rotn-test  delete-after=<unix epoch>  batch=<name>
# and is deleted by this script's EXIT trap, or by the off-PC sweeper (`sweep`, run every 15 min
# from .github/workflows/test-server-sweeper.yml) once delete-after has passed.
#
# Never point this at the live server. Never put secrets in user-data.
#
# Usage: deploy/test-server.sh <command> [options]
#
#   run [up options] -- CMD [ARGS...]
#                 Batch mode: up, run CMD with TEST_SERVER_* in the environment, then always down.
#                 Exits with CMD's status (or the teardown's, if teardown fails).
#   up [options]  Create and build a server and leave it running until `down` or delete-after.
#                 Deleted at once if the build fails (unless --keep-on-failure).
#   down          Delete the server, then its Primary IPv4, then its SSH key; verify all are gone.
#   list          Show labelled servers, Primary IPs and SSH keys with time left.
#   sweep         Delete labelled resources whose delete-after has passed (the watchdog).
#   console CMD   Type CMD into the server console and print the new log lines (--wait S).
#   fetch PATH    Copy PATH (relative to the server dir, e.g. logs) into --out DIR.
#   verify        Print the on-server G0 facts (key=value).
#   log [N]       Tail the server log.  build-log [N]  Tail the cloud-init build log.
#   ssh [CMD]     Open an SSH session (or run CMD) on the server.
#   env           Print TEST_SERVER_* exports for the server.
#   render-user-data [up options]   Print the cloud-init user-data and exit (no API calls).
#
# up/run options:
#   --type T (cpx42)  --location L (nbg1)  --image I (ubuntu-24.04)  --name NAME
#   --ttl-hours H (8, max 24)     delete-after = now + H hours
#   --capture                     -Dfml.debugNetworkHandshake=true and network-compression-threshold=-1
#   --extra-mod JAR               upload JAR to mods/ before the first start (repeatable)
#   --console "CMD"               run CMD on the console once ready (repeatable)
#   --fetch PATH                  fetch PATH after the console commands (repeatable), into --out DIR
#   --whitelist NAME[:UUID]       whitelist NAME (repeatable; default: $ROTN_TEST_WHITELIST or "FRCFLD JQDAW").
#                                 UUIDs are resolved on the PC (Mojang profile API) before anything is created,
#                                 and whitelist.json is written before the first start: 1.12.2's own
#                                 `whitelist add` lookup is unreliable (legacy API, datacenter IPs blocked).
#   --seed SEED  --heap-min 4G  --heap-max 8G
#   --pack-source auto|url|upload (auto: CurseForge download if its SHA-256 matches, else upload)
#   --pack-zip PATH               local zip for upload (default: $ROTN_PACK_ZIP)
#   --ready-timeout MIN (120, restarts after a pack upload)  --yes (no cost prompt)  --allow-multiple  --keep-on-failure
#   --allow-from CIDR             open 22 and 25565 only to CIDR (repeatable; default: $ROTN_TEST_ALLOW_FROM, else
#                                 the whole internet). Include this PC's public address, or SSH and the tests fail.
#   --skip-sweeper-check          create even without a recent successful *scheduled* sweeper run on develop.
#                                 Only with the lead's approval: without the sweeper a crashed batch bills open-ended.
#   --dry-run                     print mutating hcloud commands instead of running them
# Global: --name NAME (or $TEST_SERVER_NAME), --out DIR
#   Before any create, up/run require a successful event=schedule run of test-server-sweeper.yml on
#   develop within the last $ROTN_SWEEPER_MAX_AGE_MIN minutes (default 120, 15..240), read with
#   `gh run list --repo $ROTN_GH_REPO` (default JQDAW/mindcraft-RotN).
#   hcloud always runs with --context mindcraft-rotn-test (the test project); any other
#   --context / $HCLOUD_CONTEXT is refused. ROTN_HCLOUD_AUTH=env-token (HCLOUD_TOKEN, no context)
#   is accepted only inside GitHub Actions, for the sweeper.
set -Eeuo pipefail

SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")
DEPLOY_DIR=$(dirname "$SELF")
REPO_ROOT=$(dirname "$DEPLOY_DIR")
REMOTE_DIR=$DEPLOY_DIR/test-server

# ---- Pins (ADR 0005). Change only with an ADR. ----
readonly PACK_SHA256=90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205
readonly PACK_BYTES=791130136
readonly PACK_URL_DEFAULT='https://mediafilez.forgecdn.net/files/7564/549/RotN%203.3.4%20Server%20Pack.zip'
readonly FORGE_JAR=forge-1.12.2-14.23.5.2860.jar
readonly LABEL_PURPOSE=mindcraft-rotn-test
readonly LABEL_CONTROL=mindcraft-rotn-watchdog-control   # g0-watchdog control servers (own expiry label)
readonly CONTROL_GRACE_SECONDS=1800                      # control deleted at control-expires + 30 min
readonly CONTROL_DEFAULT_TTL_SECONDS=7200                # control without a valid control-expires
readonly TEST_CONTEXT=mindcraft-rotn-test                # the only hcloud context this script may use
readonly MAX_TTL_HOURS=24
readonly DEFAULT_TTL_HOURS=8
readonly SWEEP_GRACE_SECONDS=1800   # sweeper: no labelled resource outlives created + MAX_TTL_HOURS + grace
readonly USER_DATA_MAX_BYTES=32768

# ---- Overridable for tests ----
HCLOUD_BIN=${HCLOUD_BIN:-hcloud}
SSH_BIN=${SSH_BIN:-ssh}
SCP_BIN=${SCP_BIN:-scp}
SSH_KEYGEN_BIN=${SSH_KEYGEN_BIN:-ssh-keygen}
GH_BIN=${GH_BIN:-gh}
GH_REPO_NAME=${ROTN_GH_REPO:-JQDAW/mindcraft-RotN}
SWEEPER_WORKFLOW=test-server-sweeper.yml
SWEEPER_MAX_AGE_MIN=${ROTN_SWEEPER_MAX_AGE_MIN:-120}
readonly SWEEPER_MAX_AGE_CAP=240
STATUS_PING_CMD=${STATUS_PING_CMD:-node $REPO_ROOT/test/tools/status-ping.mjs}
POLL_SECONDS=${ROTN_TEST_POLL_SECONDS:-15}
MOJANG_PROFILE_URL=${MOJANG_PROFILE_URL:-https://api.mojang.com/users/profiles/minecraft}
STATE_ROOT=${ROTN_TEST_STATE_DIR:-$HOME/.mindcraft-rotn/test-server}

# ---- Option defaults ----
TYPE=cpx42 LOCATION=nbg1 IMAGE=ubuntu-24.04 NAME=${TEST_SERVER_NAME:-}
TTL_HOURS=$DEFAULT_TTL_HOURS CAPTURE=0 SEED='' HEAP_MIN=4G HEAP_MAX=8G
PACK_SOURCE=auto PACK_ZIP=${ROTN_PACK_ZIP:-C:/Users/admin/source/RotN 3.3.4 Server Pack.zip}
READY_TIMEOUT_MIN=120 YES=0 ALLOW_MULTIPLE=0 KEEP_ON_FAILURE=0 DRY_RUN=0 OUT_DIR='' WAIT_S=5 SKIP_SWEEPER_CHECK=0
CONTEXT=${HCLOUD_CONTEXT:-$TEST_CONTEXT}
# hcloud auth: "context" (PC, default) or "env-token" (the GitHub sweeper only; see check_context).
HCLOUD_AUTH=${ROTN_HCLOUD_AUTH:-context}
EXTRA_MODS=() CONSOLE_CMDS=() FETCH_PATHS=() WHITELIST=() WHITELIST_ENTRIES=() ARGS=() ALLOW_FROM=()

# ---- Teardown state for the EXIT trap ----
CLEANUP_NAME='' UP_OK=0 KEEP_ON_SUCCESS=0

log()  { printf '[test-server %s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
warn() { log "WARNING: $*"; }
die()  { log "ERROR: $*"; exit 1; }
now()  { if [[ -n ${ROTN_TEST_NOW:-} ]]; then echo "$ROTN_TEST_NOW"; else date -u +%s; fi; }
iso()  { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
jqr()  { jq "$@" | tr -d '\r'; }

# Every hcloud call goes through hc. On the PC it always passes --context mindcraft-rotn-test and
# removes HCLOUD_TOKEN / HCLOUD_CONTEXT / HCLOUD_ENDPOINT / HCLOUD_CONFIG from hcloud's environment,
# so a token for another project, another API endpoint or another config file (with its own
# mindcraft-rotn-test context) in the environment cannot redirect a create (environment variables
# outrank the config file).
hc() {
  if [[ $HCLOUD_AUTH == env-token ]]; then
    "$HCLOUD_BIN" "$@"
  else
    env -u HCLOUD_TOKEN -u HCLOUD_CONTEXT -u HCLOUD_ENDPOINT -u HCLOUD_CONFIG "$HCLOUD_BIN" --context "$CONTEXT" "$@"
  fi
}

# Refuse anything but the test project.
#  - context mode: the context must be exactly mindcraft-rotn-test.
#  - env-token mode: only inside GitHub Actions, where HCLOUD_TOKEN comes from the
#    develop-only Environment hetzner-test-sweeper and is a test-project token by construction.
check_context() {
  case $HCLOUD_AUTH in
    context)
      [[ $CONTEXT == "$TEST_CONTEXT" ]] \
        || die "refusing hcloud context '$CONTEXT': only '$TEST_CONTEXT' (the test project) is allowed" ;;
    env-token)
      # Deliberate: GITHUB_ACTIONS=true is the only signal used, and inside Actions it forces
      # env-token mode to be accepted. Anyone can set GITHUB_ACTIONS=true on the PC, so this is a
      # guard against mistakes, not a security boundary; the boundary is that the only HCLOUD_TOKEN
      # this mode is meant for lives in the develop-only Environment hetzner-test-sweeper.
      [[ ${GITHUB_ACTIONS:-} == true ]] \
        || die "ROTN_HCLOUD_AUTH=env-token is only for the GitHub sweeper (GITHUB_ACTIONS=true)" ;;
    *) die "ROTN_HCLOUD_AUTH must be 'context' or 'env-token'" ;;
  esac
}

# Mutating hcloud call: printed instead of run under --dry-run.
hc_mut() {
  if (( DRY_RUN )); then
    printf 'DRY-RUN: hcloud' >&2; printf ' %q' "$@" >&2; printf '\n' >&2
    return 0
  fi
  hc "$@"
}

usage() { sed -n '2,/^set -Eeuo/p' "$SELF" | sed '$d' | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------- options
parse_opts() {
  while (( $# )); do
    case $1 in
      --type) TYPE=$2; shift 2 ;;
      --location) LOCATION=$2; shift 2 ;;
      --image) IMAGE=$2; shift 2 ;;
      --name) NAME=$2; shift 2 ;;
      --ttl-hours) TTL_HOURS=$2; shift 2 ;;
      --capture) CAPTURE=1; shift ;;
      --extra-mod) EXTRA_MODS+=("$2"); shift 2 ;;
      --console) CONSOLE_CMDS+=("$2"); shift 2 ;;
      --fetch) FETCH_PATHS+=("$2"); shift 2 ;;
      --whitelist) WHITELIST+=("$2"); shift 2 ;;
      --seed) SEED=$2; shift 2 ;;
      --heap-min) HEAP_MIN=$2; shift 2 ;;
      --heap-max) HEAP_MAX=$2; shift 2 ;;
      --pack-source) PACK_SOURCE=$2; shift 2 ;;
      --pack-zip) PACK_ZIP=$2; shift 2 ;;
      --ready-timeout) READY_TIMEOUT_MIN=$2; shift 2 ;;
      --out) OUT_DIR=$2; shift 2 ;;
      --wait) WAIT_S=$2; shift 2 ;;
      --context) CONTEXT=$2; shift 2 ;;
      --yes|-y) YES=1; shift ;;
      --allow-multiple) ALLOW_MULTIPLE=1; shift ;;
      --keep-on-failure) KEEP_ON_FAILURE=1; shift ;;
      --allow-from) ALLOW_FROM+=("$2"); shift 2 ;;
      --skip-sweeper-check) SKIP_SWEEPER_CHECK=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --) shift; ARGS+=("$@"); break ;;
      -h|--help) usage; exit 0 ;;
      -*) die "unknown option: $1" ;;
      *) ARGS+=("$1"); shift ;;
    esac
  done
}

validate_up_opts() {
  [[ $TTL_HOURS =~ ^[0-9]+$ ]] && (( TTL_HOURS >= 1 && TTL_HOURS <= MAX_TTL_HOURS )) \
    || die "--ttl-hours must be 1..$MAX_TTL_HOURS (got '$TTL_HOURS')"
  [[ $TYPE =~ ^[a-z0-9-]+$ ]] || die "bad --type '$TYPE'"
  [[ $LOCATION =~ ^[a-z0-9-]+$ ]] || die "bad --location '$LOCATION'"
  [[ $IMAGE =~ ^[a-z0-9.-]+$ ]] || die "bad --image '$IMAGE'"
  [[ $HEAP_MIN =~ ^[0-9]+[MG]$ && $HEAP_MAX =~ ^[0-9]+[MG]$ ]] || die "heap sizes look like 4G or 4096M"
  [[ -z $SEED || $SEED =~ ^-?[A-Za-z0-9_]{1,32}$ ]] || die "bad --seed '$SEED'"
  [[ $PACK_SOURCE =~ ^(auto|url|upload)$ ]] || die "--pack-source must be auto, url or upload"
  [[ $READY_TIMEOUT_MIN =~ ^[0-9]+$ ]] || die "bad --ready-timeout"
  if (( ${#WHITELIST[@]} == 0 )); then
    read -r -a WHITELIST <<< "${ROTN_TEST_WHITELIST:-FRCFLD JQDAW}"
  fi
  resolve_whitelist
  local jar
  for jar in "${EXTRA_MODS[@]}"; do
    [[ -f $jar ]] || die "--extra-mod: no such file '$jar'"
    [[ $(basename "$jar") =~ ^[A-Za-z0-9._+-]+\.jar$ ]] || die "--extra-mod: file name must be a plain .jar name"
  done
  local p
  for p in "${FETCH_PATHS[@]}"; do valid_rel_path "$p" || die "--fetch: bad path '$p'"; done
  if (( ${#ALLOW_FROM[@]} == 0 )) && [[ -n ${ROTN_TEST_ALLOW_FROM:-} ]]; then
    read -r -a ALLOW_FROM <<< "$ROTN_TEST_ALLOW_FROM"
  fi
  local c
  for c in "${ALLOW_FROM[@]}"; do valid_cidr "$c" || die "--allow-from: bad CIDR '$c' (e.g. 203.0.113.7/32)"; done
  if [[ -z $NAME ]]; then NAME="mcr-test-$(date -u -d "@$(now)" +%Y%m%d-%H%M%S)"; fi
  check_name
}

# One name rule for every command, whether the name comes from --name, $TEST_SERVER_NAME or the
# state directory (review finding 7).
check_name() { [[ $NAME =~ ^[a-z0-9][a-z0-9-]{2,62}$ ]] || die "bad --name '$NAME'"; }

# valid_cidr CIDR: IPv4 a.b.c.d/0-32. Nothing else reaches ufw.
# IPv4 only: test servers are created --without-ipv6, so an IPv6 rule could never match (PR #7 review).
valid_cidr() {
  local ip=${1%/*} len=${1##*/} o
  [[ $1 == */* && $len =~ ^[0-9]{1,2}$ ]] || return 1
  [[ $ip =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  (( 10#$len <= 32 )) || return 1
  for o in ${ip//./ }; do (( 10#$o <= 255 )) || return 1; done
}

# resolve_whitelist: WHITELIST (NAME or NAME:UUID) -> WHITELIST_ENTRIES (Name:dashed-uuid).
resolve_whitelist() {
  local w n u json
  WHITELIST_ENTRIES=()
  for w in "${WHITELIST[@]}"; do
    n=${w%%:*}
    u=''
    [[ $w == *:* ]] && u=${w#*:}
    [[ $n =~ ^[A-Za-z0-9_]{3,16}$ ]] || die "bad Minecraft name '$n'"
    if [[ -z $u ]]; then
      # Mojang rate-limits bursts (HTTP 429); curl --retry covers 429 and 5xx.
      json=$(curl -fsS --max-time 15 --retry 4 --retry-delay 3 "$MOJANG_PROFILE_URL/$n" 2>/dev/null) \
        || die "could not resolve the UUID of '$n' (Mojang profile API); pass --whitelist $n:<uuid>"
      u=$(jqr -r '.id // empty' <<< "$json")
      n=$(jqr -r '.name // empty' <<< "$json")
    fi
    u=${u//-/}
    u=${u,,}
    [[ $u =~ ^[0-9a-f]{32}$ && -n $n ]] || die "bad UUID for '$w'"
    WHITELIST_ENTRIES+=("$n:${u:0:8}-${u:8:4}-${u:12:4}-${u:16:4}-${u:20:12}")
  done
}

valid_rel_path() { [[ $1 =~ ^[A-Za-z0-9._/-]+$ && $1 != /* && $1 != *..* ]]; }

# ---------------------------------------------------------------- user-data
b64() { tr -d '\r' < "$1" | base64 -w0; }

render_config_env() {
  local jvm_extra=''
  (( CAPTURE )) && jvm_extra='-Dfml.debugNetworkHandshake=true'
  local hold=0
  (( ${#EXTRA_MODS[@]} )) && hold=1
  local url=$PACK_URL_DEFAULT
  [[ $PACK_SOURCE == upload ]] && url=''
  printf '# Written by deploy/test-server.sh. No secrets here.\n'
  printf '%s=%q\n' \
    BATCH_NAME "$NAME" \
    PACK_SOURCE "$PACK_SOURCE" \
    PACK_URL "$url" \
    PACK_SHA256 "$PACK_SHA256" \
    PACK_WAIT_SECONDS 5400 \
    FORGE_JAR "$FORGE_JAR" \
    HEAP_MIN "$HEAP_MIN" \
    HEAP_MAX "$HEAP_MAX" \
    JVM_EXTRA "$jvm_extra" \
    CAPTURE "$CAPTURE" \
    HOLD_START "$hold" \
    HOLD_WAIT_SECONDS 3600 \
    START_TIMEOUT_SECONDS 2400 \
    LEVEL_SEED "$SEED" \
    WHITELIST_ENTRIES "${WHITELIST_ENTRIES[*]}" \
    ALLOW_FROM "${ALLOW_FROM[*]}"
}

render_user_data() {
  local cfg
  cfg=$(mktemp)
  render_config_env > "$cfg"
  cat <<EOF
#cloud-config
# Mindcraft-RotN disposable test server ($NAME). Generated by deploy/test-server.sh.
package_update: true
packages:
  - openjdk-8-jre-headless
  - unzip
  - tmux
  - curl
  - ca-certificates
  - jq
  - ufw
write_files:
  - path: /etc/rotn-test/config.env
    permissions: '0644'
    encoding: b64
    content: $(b64 "$cfg")
  - path: /usr/local/sbin/rotn-test-build
    permissions: '0755'
    encoding: b64
    content: $(b64 "$REMOTE_DIR/build.sh")
  - path: /usr/local/sbin/rotn-test
    permissions: '0755'
    encoding: b64
    content: $(b64 "$REMOTE_DIR/rotn-test.sh")
  - path: /etc/systemd/system/rotn-server.service
    permissions: '0644'
    encoding: b64
    content: $(b64 "$REMOTE_DIR/rotn-server.service")
runcmd:
  - [/usr/local/sbin/rotn-test-build]
EOF
  rm -f "$cfg"
}

# ---------------------------------------------------------------- state
state_dir() { echo "$STATE_ROOT/active/$1"; }

resolve_name() {
  if [[ -n $NAME ]]; then check_name; return 0; fi
  local dirs=()
  if [[ -d $STATE_ROOT/active ]]; then
    mapfile -t dirs < <(find "$STATE_ROOT/active" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null)
  fi
  (( ${#dirs[@]} == 1 )) || die "pass --name (active servers here: ${dirs[*]:-none})"
  NAME=${dirs[0]}
  check_name
}

load_meta() {
  resolve_name
  local f
  f=$(state_dir "$NAME")/meta.env
  [[ -f $f ]] || die "no local state for $NAME ($f)"
  # shellcheck source=/dev/null
  source "$f"
  SDIR=$(state_dir "$NAME")
}

rssh() {
  "$SSH_BIN" -i "$SDIR/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes \
    -o UserKnownHostsFile="$SDIR/known_hosts" -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout=10 -o ServerAliveInterval=15 -o LogLevel=ERROR "root@$IP" "$@"
}

rscp() {
  "$SCP_BIN" -i "$SDIR/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes \
    -o UserKnownHostsFile="$SDIR/known_hosts" -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout=10 -o LogLevel=ERROR "$@"
}

# meta_get FILE KEY: read one value from a meta.env without touching this shell's variables.
# shellcheck source=/dev/null
meta_get() { ( source "$1"; printf '%s' "${!2}" ); }

ledger() { mkdir -p "$STATE_ROOT"; printf '%s\n' "$1" >> "$STATE_ROOT/ledger.jsonl"; }

# ---------------------------------------------------------------- hcloud helpers
require_auth() {
  hc server list -l "$(selector)" -o noheader > /dev/null 2>&1 \
    || die "hcloud is not authenticated ('hcloud server list' failed). The human must set up the hcloud context."
}

selector() { echo "purpose=$LABEL_PURPOSE${1:+,batch=$1}"; }

# hourly_price TYPE LOCATION -> gross EUR/h from the API (empty if unknown)
hourly_price() {
  hc server-type describe "$1" -o json 2>/dev/null \
    | jqr -r --arg loc "$2" '[.prices[]? | select(.location == $loc) | .price_hourly.gross][0] // empty' \
    | awk 'NF { printf "%.4f", $1 }'
}

count_batch() {  # count_batch KIND NAME -> number of labelled resources of KIND for the batch
  hc "$1" list -l "$(selector "$2")" -o json | jqr 'length'
}

# ---------------------------------------------------------------- sweeper preflight (finding 5)
# The off-PC sweeper is what bounds the cost of a crashed batch. Before any create, require a
# successful *scheduled* run of it on develop within SWEEPER_MAX_AGE_MIN (lead's rule, 2026-11-01:
# one observed event=schedule run is a precondition for every paid batch). Dispatch runs do not count:
# they prove the token and the logic, not that the cron fires.
# gh_: every gh call names the repository explicitly, and GH_REPO / GH_HOST in the environment
# cannot redirect it (PR #7 review).
gh_() { env -u GH_REPO -u GH_HOST "$GH_BIN" "$@" --repo "$GH_REPO_NAME"; }

check_sweeper() {
  local runs latest age t
  if (( SKIP_SWEEPER_CHECK )); then
    warn "--skip-sweeper-check: not checking the scheduled sweeper (needs the lead's approval)"
    return 0
  fi
  [[ $GH_REPO_NAME =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "bad ROTN_GH_REPO '$GH_REPO_NAME' (OWNER/REPO)"
  [[ $SWEEPER_MAX_AGE_MIN =~ ^[0-9]{1,4}$ ]] && (( 10#$SWEEPER_MAX_AGE_MIN >= 15 && 10#$SWEEPER_MAX_AGE_MIN <= SWEEPER_MAX_AGE_CAP )) \
    || die "ROTN_SWEEPER_MAX_AGE_MIN must be 15..$SWEEPER_MAX_AGE_CAP (got '$SWEEPER_MAX_AGE_MIN')"
  command -v "$GH_BIN" > /dev/null 2>&1 || { sweeper_refuse "the gh CLI ('$GH_BIN') is not available"; return 0; }
  runs=$(gh_ run list --workflow "$SWEEPER_WORKFLOW" --branch develop --event schedule \
           --limit 20 --json databaseId,status,conclusion,createdAt 2>/dev/null) \
    || { sweeper_refuse "'gh run list' failed (not logged in?)"; return 0; }
  latest=$(jqr -r '[.[] | select(.status == "completed" and .conclusion == "success")]
                   | sort_by(.createdAt) | last // empty | "\(.databaseId) \(.createdAt)"' <<< "$runs")
  [[ -n $latest ]] || { sweeper_refuse "no successful scheduled run of $SWEEPER_WORKFLOW on develop yet"; return 0; }
  t=$(date -u -d "${latest#* }" +%s 2>/dev/null) || { sweeper_refuse "unreadable run time '${latest#* }'"; return 0; }
  age=$(( ($(now) - t) / 60 ))
  (( age <= 10#$SWEEPER_MAX_AGE_MIN )) \
    || { sweeper_refuse "the last successful scheduled sweeper run (${latest% *}) is ${age} min old (limit $SWEEPER_MAX_AGE_MIN)"; return 0; }
  log "sweeper OK: scheduled run ${latest% *} on $GH_REPO_NAME succeeded ${age} min ago (limit $SWEEPER_MAX_AGE_MIN min)"
}

sweeper_refuse() {
  if (( DRY_RUN )); then warn "sweeper check would refuse: $1"; return 0; fi
  die "$1. Refusing to create anything: without the off-PC sweeper a crashed batch bills until someone notices. Check the Actions tab (a sweep that logs ALERT lines fails on purpose until the badly labelled resource is gone), or pass --skip-sweeper-check with the lead's approval."
}

# ---------------------------------------------------------------- up
on_exit() {
  local rc=$?
  trap - EXIT
  trap '' INT TERM HUP   # a second Ctrl-C must not interrupt the teardown
  if [[ -n $CLEANUP_NAME ]]; then
    if (( UP_OK && KEEP_ON_SUCCESS )); then
      :
    elif (( !UP_OK && KEEP_ON_FAILURE )); then
      warn "build failed; --keep-on-failure leaves $CLEANUP_NAME up until its delete-after (watchdog)"
    else
      log "EXIT trap: tearing down $CLEANUP_NAME"
      if ! NAME=$CLEANUP_NAME do_down; then
        warn "teardown of $CLEANUP_NAME failed; the sweeper deletes it after delete-after"
        (( rc == 0 )) && rc=1
      fi
    fi
  fi
  exit "$rc"
}

confirm_cost() {
  local price=$1 max
  if [[ -n $price ]]; then
    # Worst case: the EXIT trap fails and the sweeper (every 15 min, cron may start late) deletes it
    # after delete-after: TTL + 1 billed hours. If the sweeper is not running, the cost is open-ended.
    max=$(awk -v p="$price" -v h="$(( TTL_HOURS + 1 ))" 'BEGIN { printf "%.2f", p * h }')
    log "plan: $TYPE in $LOCATION at EUR $price/h gross; worst case (TTL ${TTL_HOURS}h, sweeper deletes it) ~$(( TTL_HOURS + 1 )) billed hours, EUR $max plus Primary IPv4"
  else
    warn "could not read the hourly price of $TYPE in $LOCATION from the API"
  fi
  (( YES || DRY_RUN )) && return 0
  if [[ -t 0 ]]; then
    local ans
    read -r -p "Create $NAME ($TYPE, $LOCATION, TTL ${TTL_HOURS}h)? [y/N] " ans
    [[ $ans =~ ^[Yy]$ ]] || die "aborted"
  else
    die "not a terminal: pass --yes to confirm the cost"
  fi
}

check_local_pack() {
  [[ -f $PACK_ZIP ]] || die "pack zip not found: $PACK_ZIP (set --pack-zip or ROTN_PACK_ZIP)"
  local size sum
  size=$(stat -c %s "$PACK_ZIP")
  [[ $size == "$PACK_BYTES" ]] || die "pack zip is $size bytes, expected $PACK_BYTES"
  log "hashing local pack zip"
  sum=$(sha256sum "$PACK_ZIP" | cut -d' ' -f1)
  [[ $sum == "$PACK_SHA256" ]] || die "pack zip SHA-256 $sum does not match the pin $PACK_SHA256"
}

upload_pack() {
  check_local_pack
  log "uploading the local pack zip ($PACK_BYTES bytes) over SSH"
  rscp "$PACK_ZIP" "root@$IP:/opt/rotn/incoming/pack.zip.part"
  rssh 'mv -f /opt/rotn/incoming/pack.zip.part /opt/rotn/incoming/pack.zip'
}

upload_mods() {
  local jar
  for jar in "${EXTRA_MODS[@]}"; do
    log "uploading extra mod $(basename "$jar")"
    rscp "$jar" "root@$IP:/opt/rotn/server/mods/$(basename "$jar")"
  done
  rssh 'rotn-test start'
}

wait_ready() {
  local deadline=$(( $(date +%s) + READY_TIMEOUT_MIN * 60 )) ph last='' packed=0 modded=0
  log "waiting for SSH and the build (up to ${READY_TIMEOUT_MIN} min)"
  while :; do
    # Falls back to cloud-init's status if write_files never installed rotn-test.
    ph=$(rssh 'rotn-test phase 2>/dev/null || echo "booting:$(cloud-init status 2>/dev/null | sed -n "s/^status: //p")"' \
      2>/dev/null | tr -d '\r' | tail -1) || true
    [[ -n $ph ]] || ph=unreachable
    [[ $ph != "$last" ]] && log "phase: $ph"
    last=$ph
    case $ph in
      ready) return 0 ;;
      need-pack)
        if (( !packed )); then
          packed=1
          upload_pack
          deadline=$(( $(date +%s) + READY_TIMEOUT_MIN * 60 ))   # unpack + first start still to come
        fi ;;
      booting:done*|booting:error*|booting:degraded*)
        rssh 'tail -n 60 /var/log/cloud-init-output.log' >&2 || true
        die "cloud-init finished ($ph) but the build never started" ;;
      hold) if (( !modded )); then modded=1; upload_mods; fi ;;
      failed*)
        rssh 'rotn-test build-log 60' >&2 || true
        rssh 'tail -n 40 /opt/rotn/server/logs/latest.log' >&2 2>/dev/null || true
        die "build failed: $ph" ;;
    esac
    (( $(date +%s) < deadline )) || die "not ready after ${READY_TIMEOUT_MIN} min (last phase: $ph)"
    sleep "$POLL_SECONDS"
  done
}

do_up() {
  validate_up_opts
  command -v jq > /dev/null || die "jq is required"
  # With --pack-source upload, check the local zip before paying for a server.
  if [[ $PACK_SOURCE == upload ]]; then check_local_pack; fi
  require_auth

  # Any labelled server, Primary IP or SSH key left over means an earlier batch did not clean up.
  local existing='' kind names
  for kind in server primary-ip ssh-key; do
    names=$(hc "$kind" list -l "$(selector)" -o json | jqr -r '[.[].name] | join(" ")')
    [[ -n $names ]] && existing+=" $kind: $names;"
  done
  if [[ -n $existing ]] && (( !ALLOW_MULTIPLE )); then
    die "labelled test resources already exist:$existing run 'down' (or wait for the sweeper), or pass --allow-multiple"
  fi
  check_sweeper

  local price
  price=$(hourly_price "$TYPE" "$LOCATION")
  confirm_cost "$price"

  local created delete_after labels
  created=$(now)
  delete_after=$(( created + TTL_HOURS * 3600 ))
  labels=(--label "purpose=$LABEL_PURPOSE" --label "delete-after=$delete_after" --label "batch=$NAME")
  SDIR=$(state_dir "$NAME")
  IP=''
  [[ -e $SDIR ]] && die "state dir already exists: $SDIR"
  mkdir -p "$SDIR"
  chmod 700 "$SDIR"
  render_user_data > "$SDIR/user-data.yaml"
  local ud_size
  ud_size=$(wc -c < "$SDIR/user-data.yaml")
  (( ud_size < USER_DATA_MAX_BYTES )) || die "user-data is $ud_size bytes (limit $USER_DATA_MAX_BYTES)"
  "$SSH_KEYGEN_BIN" -q -t ed25519 -N '' -C "$NAME" -f "$SDIR/id_ed25519"

  # From here on, anything created is deleted on exit unless the build succeeds and this is `up`.
  CLEANUP_NAME=$NAME
  (( DRY_RUN )) && CLEANUP_NAME=''

  log "creating $NAME: delete-after $(iso "$delete_after") (TTL ${TTL_HOURS}h)"
  hc_mut ssh-key create --name "$NAME" --public-key-from-file "$SDIR/id_ed25519.pub" "${labels[@]}" > /dev/null
  hc_mut primary-ip create --name "$NAME-ipv4" --type ipv4 --location "$LOCATION" --auto-delete=true \
    "${labels[@]}" > /dev/null
  hc_mut server create --name "$NAME" --type "$TYPE" --image "$IMAGE" --location "$LOCATION" \
    --ssh-key "$NAME" --primary-ipv4 "$NAME-ipv4" --without-ipv6 \
    --user-data-from-file "$SDIR/user-data.yaml" "${labels[@]}" -o json > "$SDIR/server-create.json"

  if (( DRY_RUN )); then
    mv -f "$SDIR/user-data.yaml" "$STATE_ROOT/dry-run-user-data.yaml"
    rm -rf "$SDIR"
    log "dry run: nothing was created; user-data is in $STATE_ROOT/dry-run-user-data.yaml"
    return 0
  fi

  IP=$(hc primary-ip describe "$NAME-ipv4" -o json | jqr -r '.ip')
  [[ $IP =~ ^[0-9.]+$ ]] || die "could not read the Primary IPv4 address"
  {
    printf '%s=%q\n' NAME "$NAME" IP "$IP" TYPE "$TYPE" LOCATION "$LOCATION" \
      CREATED_AT "$created" DELETE_AFTER "$delete_after" PRICE_HOURLY "$price" CAPTURE "$CAPTURE"
  } > "$SDIR/meta.env"
  ledger "$(jq -cn --arg b "$NAME" --arg t "$TYPE" --arg l "$LOCATION" --arg p "$price" \
    --arg s "$(iso "$created")" --arg d "$(iso "$delete_after")" --arg ip "$IP" \
    '{event:"created", batch:$b, type:$t, location:$l, ip:$ip, price_hourly_gross_eur:$p, started:$s, delete_after:$d}')"
  log "server $NAME is at $IP"

  wait_ready

  rssh 'rotn-test verify' | tr -d '\r' > "$SDIR/verify.txt" || warn "verify failed"
  if $STATUS_PING_CMD --host "$IP" --port 25565 --out "$SDIR/ping.json" >&2; then :; else
    warn "status ping failed"
  fi

  local c out p
  for c in "${CONSOLE_CMDS[@]}"; do
    log "console: $c"
    rssh "rotn-test console --wait $WAIT_S -- $(printf '%q' "$c")" | tr -d '\r' >&2
  done
  if (( ${#FETCH_PATHS[@]} )); then
    out=${OUT_DIR:-$SDIR/out}
    mkdir -p "$out"
    for p in "${FETCH_PATHS[@]}"; do
      log "fetching $p -> $out"
      rscp -r "root@$IP:/opt/rotn/server/$p" "$out/"
    done
  fi

  UP_OK=1
  log "READY: $NAME at $IP:25565 (delete-after $(iso "$delete_after")); state in $SDIR"
}

# ---------------------------------------------------------------- down
# Wait until no labelled resource of KIND remains for the batch.
wait_gone() {
  local kind=$1 name=$2 i n
  for (( i = 0; i < 40; i++ )); do
    n=$(count_batch "$kind" "$name") || n=unknown
    [[ $n == 0 ]] && return 0
    sleep "$(( POLL_SECONDS < 3 ? POLL_SECONDS : 3 ))"
  done
  return 1
}

do_down() {
  resolve_name
  require_auth
  local sel ok=1 id ids
  sel=$(selector "$NAME")
  log "deleting batch $NAME (selector $sel)"

  # 1. Servers first (stops billing; frees the Primary IP).
  mapfile -t ids < <(hc server list -l "$sel" -o json | jqr -r '.[].id')
  for id in "${ids[@]}"; do hc_mut server delete "$id" > /dev/null || warn "server delete $id returned an error"; done
  (( DRY_RUN )) || wait_gone server "$NAME" || { warn "server(s) of $NAME still exist"; ok=0; }

  # 2. Then the Primary IPs (auto-delete may already have removed them; retry while still assigned).
  local try
  for (( try = 0; try < 10; try++ )); do
    mapfile -t ids < <(hc primary-ip list -l "$sel" -o json | jqr -r '.[].id')
    (( ${#ids[@]} == 0 )) && break
    for id in "${ids[@]}"; do hc_mut primary-ip delete "$id" > /dev/null 2>&1 || true; done
    (( DRY_RUN )) && break
    sleep "$(( POLL_SECONDS < 3 ? POLL_SECONDS : 3 ))"
  done
  (( DRY_RUN )) || wait_gone primary-ip "$NAME" || { warn "Primary IP(s) of $NAME still exist"; ok=0; }

  # 3. The batch's SSH key.
  mapfile -t ids < <(hc ssh-key list -l "$sel" -o json | jqr -r '.[].id')
  for id in "${ids[@]}"; do hc_mut ssh-key delete "$id" > /dev/null || warn "ssh-key delete $id returned an error"; done
  (( DRY_RUN )) || wait_gone ssh-key "$NAME" || { warn "SSH key of $NAME still exists"; ok=0; }

  (( DRY_RUN )) && return 0
  (( ok )) || { log "teardown of $NAME INCOMPLETE"; return 1; }

  local sdir meta stopped hours cost=''
  sdir=$(state_dir "$NAME")
  meta=$sdir/meta.env
  stopped=$(now)
  if [[ -f $meta ]]; then
    local CREATED_AT PRICE_HOURLY TYPE_M LOCATION_M
    TYPE_M=$(meta_get "$meta" TYPE); LOCATION_M=$(meta_get "$meta" LOCATION)
    CREATED_AT=$(meta_get "$meta" CREATED_AT); PRICE_HOURLY=$(meta_get "$meta" PRICE_HOURLY)
    # Hetzner bills each started hour; estimate = ceil(hours) x gross hourly price.
    hours=$(( (stopped - CREATED_AT + 3599) / 3600 ))
    (( hours < 1 )) && hours=1
    [[ -n $PRICE_HOURLY ]] && cost=$(awk -v p="$PRICE_HOURLY" -v h="$hours" 'BEGIN { printf "%.4f", p * h }')
    ledger "$(jq -cn --arg b "$NAME" --arg t "$TYPE_M" --arg l "$LOCATION_M" --arg p "$PRICE_HOURLY" \
      --arg s "$(iso "$CREATED_AT")" --arg e "$(iso "$stopped")" --argjson sec "$(( stopped - CREATED_AT ))" \
      --argjson h "$hours" --arg c "$cost" \
      '{event:"deleted", batch:$b, type:$t, location:$l, price_hourly_gross_eur:$p, started:$s, stopped:$e,
        run_seconds:$sec, hours_billed:$h, cost_estimate_eur:$c, note:"excl. Primary IPv4"}')"
    log "batch $NAME: ran $(( (stopped - CREATED_AT) / 60 )) min, billed ~${hours}h, est. EUR ${cost:-?} (excl. IPv4)"
  fi
  if [[ -d $sdir ]]; then
    rm -f "$sdir/id_ed25519" "$sdir/id_ed25519.pub"
    mkdir -p "$STATE_ROOT/archive"
    mv "$sdir" "$STATE_ROOT/archive/$NAME-$stopped"
  fi
  log "verified gone: server, Primary IPv4 and SSH key of $NAME"
}

# ---------------------------------------------------------------- sweep (watchdog)
# expired_filter NOW [control]
# Reads a JSON array of resources on stdin and prints "id<TAB>name<TAB>assignee" for each expired one.
#   default: resources with purpose=mindcraft-rotn-test whose delete-after has passed.
#   control: watchdog-control servers (purpose=mindcraft-rotn-watchdog-control) whose
#            control-expires + CONTROL_GRACE_SECONDS has passed. Their delete-after label is
#            deliberately expired bait and is ignored here (g0-watchdog.sh proves label selection).
# A missing or unparsable expiry label falls back to created + default TTL. An unparsable creation
# time as well counts as expired at once (fail-safe: these are disposable by label). No expiry label
# keeps a resource alive past created + MAX_TTL_HOURS + SWEEP_GRACE_SECONDS.
# Decision on review finding 10 (2026-11-01): keep these fallbacks, and also alert. do_sweep reports
# every such resource with bad_label_report and exits non-zero, so the GitHub job fails and notifies
# someone, but the resource is deleted on the fallback schedule, not at once (unless its creation
# time is unreadable too).
expired_filter() {
  local purpose=$LABEL_PURPOSE label=delete-after grace=0 ttl=$(( DEFAULT_TTL_HOURS * 3600 ))
  if [[ ${2:-} == control ]]; then
    purpose=$LABEL_CONTROL label=control-expires grace=$CONTROL_GRACE_SECONDS ttl=$CONTROL_DEFAULT_TTL_SECONDS
  fi
  jqr -r --argjson now "$1" --argjson ttl "$ttl" --argjson grace "$grace" --arg label "$label" \
    --argjson cap "$(( MAX_TTL_HOURS * 3600 + SWEEP_GRACE_SECONDS ))" --arg purpose "$purpose" '
    def created_epoch: (.created // "" | sub("\\.[0-9]+"; "") | sub("\\+00:00$"; "Z")
                        | try fromdateiso8601 catch 0);
    def expiry: ((.labels // {})[$label] // "") as $d | created_epoch as $c
      | if ($d | test("^[0-9]+$")) then
          (if $c > 0 then ([($d | tonumber) + $grace, $c + $cap] | min) else ($d | tonumber) + $grace end)
        else (if $c > 0 then $c + $ttl + $grace else 0 end) end;
    .[] | select((.labels // {}).purpose == $purpose) | select(expiry <= $now)
        | "\(.id)\t\(.name)\t\(.assignee_id // "")"'
}

# bad_label_report LABEL PURPOSE: reads a JSON array, prints "kind id name" for each resource with
# that purpose whose LABEL is missing or not a plain epoch.
bad_label_report() {
  jqr -r --arg label "$1" --arg purpose "$2" '
    .[] | select((.labels // {}).purpose == $purpose)
        | select(((.labels // {})[$label] // "") | test("^[0-9]+$") | not) | "\(.id) \(.name)"'
}

# Log line formats below ("expired server NAME (ID): deleting", "expired Primary IP ...",
# "expired SSH key ...") are a contract: test/scenarios/g0-watchdog.sh reads them from the
# sweeper's run log to prove the sweeper, not something else, deleted its resources.
do_sweep() {
  require_auth
  local t sel line id name assignee rc=0 deleted=0
  t=$(now)
  sel=$(selector)
  log "sweep at $(iso "$t"), selector $sel$( (( DRY_RUN )) && echo ' (dry run)')"

  local kind
  for kind in server primary-ip ssh-key; do
    while read -r id name; do
      [[ -n $id ]] || continue
      warn "ALERT: labelled $kind $name ($id) has no valid delete-after label; it is deleted on the fallback schedule (created + ${DEFAULT_TTL_HOURS}h)"
      rc=1
    done < <(hc "$kind" list -l "$sel" -o json | bad_label_report delete-after "$LABEL_PURPOSE")
  done
  while read -r id name; do
    [[ -n $id ]] || continue
    warn "ALERT: watchdog-control server $name ($id) has no valid control-expires label; it is deleted on the fallback schedule"
    rc=1
  done < <(hc server list -l "purpose=$LABEL_CONTROL" -o json | bad_label_report control-expires "$LABEL_CONTROL")

  local labelled_servers
  labelled_servers=$(hc server list -l "$sel" -o json)
  while IFS=$'\t' read -r id name _; do
    [[ -n $id ]] || continue
    log "expired server $name ($id): deleting"
    hc_mut server delete "$id" > /dev/null && deleted=$(( deleted + 1 )) || { warn "delete server $id failed"; rc=1; }
  done < <(printf '%s' "$labelled_servers" | expired_filter "$t")

  # Labelled server ids, so an IP is never pulled from a server that is not ours.
  local ours
  ours=$(printf '%s' "$labelled_servers" | jqr -c '[.[].id]')
  local try ips pending
  for (( try = 0; try < 10; try++ )); do
    ips=$(hc primary-ip list -l "$sel" -o json)
    pending=0
    while IFS=$'\t' read -r id name assignee; do
      [[ -n $id ]] || continue
      if [[ -n $assignee ]]; then
        if ! jq -e --argjson a "$assignee" 'index($a) != null' <<< "$ours" > /dev/null; then
          warn "expired Primary IP $name ($id) is assigned to server $assignee, which is not labelled: skipping"
          continue
        fi
        if (( !DRY_RUN )); then pending=1; continue; fi
      fi
      log "expired Primary IP $name ($id): deleting"
      hc_mut primary-ip delete "$id" > /dev/null && deleted=$(( deleted + 1 )) || { warn "delete primary-ip $id failed"; rc=1; }
    done < <(printf '%s' "$ips" | expired_filter "$t")
    (( pending && !DRY_RUN )) || break
    sleep "$(( POLL_SECONDS < 5 ? POLL_SECONDS : 5 ))"
  done

  while IFS=$'\t' read -r id name _; do
    [[ -n $id ]] || continue
    log "expired SSH key $name ($id): deleting"
    hc_mut ssh-key delete "$id" > /dev/null && deleted=$(( deleted + 1 )) || { warn "delete ssh-key $id failed"; rc=1; }
  done < <(hc ssh-key list -l "$sel" -o json | expired_filter "$t")

  # Watchdog-control servers (test/scenarios/g0-watchdog.sh): never selected by the test label, and
  # their delete-after is expired bait. They get their own watchdog: deleted once control-expires
  # plus a grace period has passed, so a crashed watchdog test cannot leave one billing.
  local csel="purpose=$LABEL_CONTROL"
  while IFS=$'\t' read -r id name _; do
    [[ -n $id ]] || continue
    log "overdue watchdog-control server $name ($id): deleting"
    hc_mut server delete "$id" > /dev/null && deleted=$(( deleted + 1 )) || { warn "delete server $id failed"; rc=1; }
  done < <(hc server list -l "$csel" -o json | expired_filter "$t" control)

  if (( !DRY_RUN )); then
    local left kind
    for kind in server primary-ip ssh-key; do
      left=$(hc "$kind" list -l "$sel" -o json | expired_filter "$t" | cut -f2 | paste -sd' ' -)
      if [[ -n $left ]]; then warn "expired $kind still present after sweep: $left"; rc=1; fi
    done
    left=$(hc server list -l "$csel" -o json | expired_filter "$t" control | cut -f2 | paste -sd' ' -)
    if [[ -n $left ]]; then warn "overdue watchdog-control server still present after sweep: $left"; rc=1; fi
  fi
  log "sweep done: $deleted deletion(s), status $rc"
  return "$rc"
}

# ---------------------------------------------------------------- list
do_list() {
  require_auth
  local t sel kind
  t=$(now)
  sel=$(selector)
  for kind in server primary-ip ssh-key; do
    echo "== $kind (selector $sel)"
    hc "$kind" list -l "$sel" -o json | jqr -r --argjson now "$t" '
      .[] | (.labels["delete-after"] // "" ) as $d
      | "\(.id)\t\(.name)\t\(.labels.batch // "-")\tdelete-after=\($d)\t" +
        (if ($d | test("^[0-9]+$")) then "left=\((($d | tonumber) - $now) / 60 | floor)min" else "left=?" end)'
  done
}

# ---------------------------------------------------------------- main
main() {
  local cmd=${1:-help}
  (( $# )) && shift
  parse_opts "$@"
  case $cmd in
    render-user-data|help|-h|--help) ;;
    *) check_context ;;   # before any hcloud call
  esac
  case $cmd in
    up)
      KEEP_ON_SUCCESS=1
      trap on_exit EXIT; trap 'exit 130' INT; trap 'exit 143' TERM
      do_up ;;
    run)
      (( ${#ARGS[@]} )) || die "usage: run [options] -- CMD [ARGS...]"
      local -a run_cmd=("${ARGS[@]}")
      ARGS=()
      KEEP_ON_SUCCESS=0
      trap on_exit EXIT; trap 'exit 130' INT; trap 'exit 143' TERM
      do_up
      (( DRY_RUN )) && exit 0
      export TEST_SERVER_NAME=$NAME TEST_SERVER_HOST=$IP TEST_SERVER_PORT=25565
      export TEST_SERVER_STATE_DIR=$SDIR TEST_SERVER_CTL=$SELF
      log "running: ${run_cmd[*]}"
      local status=0
      "${run_cmd[@]}" || status=$?
      log "command exited with $status"
      exit "$status" ;;
    down) do_down ;;
    sweep) do_sweep ;;
    list) do_list ;;
    render-user-data) validate_up_opts; render_user_data ;;
    console)
      load_meta
      (( ${#ARGS[@]} )) || die "usage: console CMD"
      rssh "rotn-test console --wait $WAIT_S -- $(printf '%q' "${ARGS[*]}")" | tr -d '\r' ;;
    fetch)
      load_meta
      local out=${OUT_DIR:-$SDIR/out} p
      mkdir -p "$out"
      for p in "${ARGS[@]}"; do
        valid_rel_path "$p" || die "bad path '$p'"
        rscp -r "root@$IP:/opt/rotn/server/$p" "$out/"
      done
      echo "$out" ;;
    verify) load_meta; rssh 'rotn-test verify' | tr -d '\r' ;;
    log) load_meta; rssh "rotn-test log ${ARGS[0]:-100}" | tr -d '\r' ;;
    build-log) load_meta; rssh "rotn-test build-log ${ARGS[0]:-100}" | tr -d '\r' ;;
    ssh) load_meta; rssh "${ARGS[@]}" ;;
    env)
      load_meta
      printf 'export %s=%q\n' TEST_SERVER_NAME "$NAME" TEST_SERVER_HOST "$IP" TEST_SERVER_PORT 25565 \
        TEST_SERVER_STATE_DIR "$SDIR" TEST_SERVER_CTL "$SELF" ;;
    help|-h|--help) usage ;;
    *) usage; die "unknown command: $cmd" ;;
  esac
}

main "$@"
