#!/usr/bin/env bash
# Runs one RotN dump on a test server that `deploy/test-server.sh run` has just built, and fetches
# it. Meant as the CMD of a batch (see README.md "Run it on the test server"):
#
#   deploy/test-server.sh run --ttl-hours 2 --yes --extra-mod "$JAR" -- tools/dumper/run-dump.sh "$OUT"
#
# Steps: create the opt-in marker rotn-dump.enable in the server folder, type `rotndump` on the
# console, wait until rotn-dump/DONE exists (the dumper writes it last, after every file was
# renamed into place), then fetch rotn-dump/ and the server log into OUT.
# Uses only deploy/test-server.sh's own subcommands (ssh, console, fetch), unchanged.
set -Eeuo pipefail

OUT=${1:?usage: run-dump.sh OUT_DIR [TIMEOUT_S]}
TIMEOUT_S=${2:-1200}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CTL=${TEST_SERVER_CTL:-$HERE/../../deploy/test-server.sh}
SERVER=/opt/rotn/server
[[ -n ${TEST_SERVER_NAME:-} ]] || { echo "run-dump.sh: TEST_SERVER_NAME is not set (run me inside deploy/test-server.sh run)" >&2; exit 2; }

log() { echo "run-dump.sh: $*" >&2; }

log "enabling the dumper (marker $SERVER/rotn-dump.enable)"
"$CTL" ssh "touch $SERVER/rotn-dump.enable && rm -f $SERVER/rotn-dump/DONE"
log "console: rotndump"
"$CTL" console --wait 5 rotndump

start=$SECONDS
until "$CTL" ssh "test -f $SERVER/rotn-dump/DONE"; do
  (( SECONDS - start < TIMEOUT_S )) || { log "no DONE after ${TIMEOUT_S}s"; "$CTL" log 80 >&2 || true; exit 1; }
  sleep 10
done
log "DONE after $(( SECONDS - start ))s: $("$CTL" ssh "cat $SERVER/rotn-dump/DONE")"

mkdir -p "$OUT"
"$CTL" fetch rotn-dump --out "$OUT"
"$CTL" fetch logs/latest.log --out "$OUT"
log "fetched into $OUT; next: node packages/rotn-data/tools/import-dump.mjs $OUT/rotn-dump"
