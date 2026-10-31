#!/usr/bin/env bash
# G0 scenario: the disposable test server builds from the pinned pack zip and runs RotN 3.3.4.
#
# Run it through the batch wrapper, which creates the server, runs this, then deletes it and
# verifies the server, Primary IPv4 and SSH key are gone:
#
#   deploy/test-server.sh run --yes -- test/scenarios/g0-test-server.sh
#
# Needs TEST_SERVER_NAME, TEST_SERVER_HOST, TEST_SERVER_STATE_DIR, TEST_SERVER_CTL (set by `run`).
# Writes $TEST_SERVER_STATE_DIR/g0-result.json and exits non-zero if any check fails.
set -uo pipefail

: "${TEST_SERVER_NAME:?run this through deploy/test-server.sh run}"
: "${TEST_SERVER_HOST:?}" "${TEST_SERVER_STATE_DIR:?}" "${TEST_SERVER_CTL:?}"

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PIN=90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205
OUT=$TEST_SERVER_STATE_DIR
PASS=0 FAIL=0
RESULTS=()

check() {  # check NAME OK(0/1) DETAIL
  local name=$1 ok=$2 detail=$3
  if (( ok == 0 )); then PASS=$((PASS + 1)); echo "PASS $name: $detail"; else FAIL=$((FAIL + 1)); echo "FAIL $name: $detail"; fi
  RESULTS+=("$(jq -cn --arg n "$name" --argjson ok "$([[ $ok == 0 ]] && echo true || echo false)" --arg d "$detail" '{check:$n, pass:$ok, detail:$d}')")
}

"$TEST_SERVER_CTL" verify > "$OUT/verify.txt"
v() { grep -E "^$1=" "$OUT/verify.txt" | head -1 | cut -d= -f2-; }
is() { [[ $1 == "$2" ]]; echo $?; }
has() { [[ $1 == *"$2"* ]]; echo $?; }

check build_phase          "$(is "$(v phase)" ready)"                       "phase=$(v phase)"
check java_8               "$(has "$(v java_version)" '"1.8')"              "$(v java_version)"
check pack_sha256          "$(is "$(v pack_sha256_verified)" "$PIN")"       "verified=$(v pack_sha256_verified) source=$(v pack_source)"
check forge_build          "$(is "$(v forge_jar)" forge-1.12.2-14.23.5.2860.jar)" "$(v forge_jar)"
check reid_jar             "$(is "$(v reid_jar)" RoughlyEnoughIDs-2.2.2.jar)" "$(v reid_jar)"
check mod_jars             "$( (( $(v mod_jars) >= 300 )); echo $?)"        "mods/*.jar=$(v mod_jars)"
check eula                 "$(is "$(v eula)" true)"                         "eula=$(v eula)"
check online_mode          "$(is "$(v online_mode)" true)"                  "online-mode=$(v online_mode)"
check white_list_on        "$(is "$(v white_list)" true)"                   "white-list=$(v white_list)"
for n in ${ROTN_TEST_WHITELIST:-FRCFLD JQDAW}; do
  check "whitelisted_$n"   "$(has ",$(v whitelist_names | tr '[:upper:]' '[:lower:]')," ",${n,,},")" "whitelist=$(v whitelist_names)"
done
check done_line            "$(has "$(v done_line)" 'Done (')"               "$(v done_line)"
check server_active        "$(is "$(v server_active)" active)"              "systemd=$(v server_active)"
check listening_25565      "$( (( $(v listening_25565) >= 1 )); echo $?)"    "listeners=$(v listening_25565)"
check cloud_init_schema    "$(is "$(v cloud_init_schema)" valid)"           "cloud-init schema --system: $(v cloud_init_schema)"

# From outside: a 1.12.2 status ping must show an FML server with REID (modid jeid) in its mod list.
ping_line=$(node "$REPO_ROOT/test/tools/status-ping.mjs" --host "$TEST_SERVER_HOST" --port 25565 --out "$OUT/ping.json" 2>&1)
echo "$ping_line"
pj() { jq -r "$1" "$OUT/ping.json" 2>/dev/null | tr -d '\r'; }
check ping_version         "$(is "$(pj .version.name)" 1.12.2)"                                    "version=$(pj .version.name) protocol=$(pj .version.protocol)"
check ping_fml             "$(is "$(pj .modinfo.type)" FML)"                                       "modinfo.type=$(pj .modinfo.type)"
check ping_forge           "$(is "$(pj '.modinfo.modList[] | select(.modid=="forge") | .version')" 14.23.5.2860)" "forge=$(pj '.modinfo.modList[] | select(.modid=="forge") | .version')"
check ping_jeid            "$(is "$(pj '.modinfo.modList[] | select(.modid=="jeid") | .version')" 2.2.2)" "jeid=$(pj '.modinfo.modList[] | select(.modid=="jeid") | .version')"
check ping_mod_count       "$( (( $(pj '.modinfo.modList | length' || echo 0) >= 300 )); echo $?)" "modList=$(pj '.modinfo.modList | length')"

# The console round-trip the dumper and scenarios rely on.
list_out=$("$TEST_SERVER_CTL" console --wait 3 list)
check console_list         "$(has "$list_out" 'players online')"            "$(grep -m1 'players online' <<< "$list_out" | sed 's/^.*INFO\]//')"

printf '%s\n' "${RESULTS[@]}" | jq -s --arg b "$TEST_SERVER_NAME" --argjson p "$PASS" --argjson f "$FAIL" \
  '{scenario:"g0-test-server", batch:$b, passed:$p, failed:$f, checks:.}' > "$OUT/g0-result.json"
echo "G0 test-server scenario: $PASS passed, $FAIL failed (details: $OUT/g0-result.json)"
(( FAIL == 0 ))
