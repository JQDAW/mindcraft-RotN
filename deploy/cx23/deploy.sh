#!/usr/bin/env bash
# Tag-based deploy and rollback on the bot's CX23, run there as the `deploy` user (harness-ops, brief
# deliverable 5). Installed by the human with the rest of deploy/cx23/; it needs no secrets: the repo
# is public and the bots' keys stay in /etc/mindcraft-rotn/<bot>.env.
#
#   deploy.sh deploy TAG [--force]   release TAG (a tag on develop): extract it, npm ci, switch, restart
#   deploy.sh rollback               switch back to the previous release and restart
#   deploy.sh status                 current and previous release, and the releases on disk
#
# Layout under /opt/mindcraft-rotn:
#   repo.git/              bare clone of the repo (develop and tags only)
#   releases/TAG-SHA12/    one extracted release each, with node_modules; ./bots links to
#                          /var/lib/mindcraft-rotn/bots so the bots' memories survive a deploy
#   current -> releases/…  what the units run (WorkingDirectory, ExecStart)
#   state                  current= and previous= (the source of truth; `current` follows it)
#   deploys.log            one line per deploy or rollback
#
# A deploy refuses a tag that is not on develop, and a release whose settings.js does not have
# "allow_insecure_coding": false, turns on the test-only allow_server_task_giver, or names "Server" as a
# task giver (#146, #157 review). After the switch it restarts the enabled bots, waits HEALTH_WAIT_S
# (default 45 s), and if any is not active it switches back to the previous release by itself.
# npm ci gets NPM_CI_TRIES (3) tries, NPM_CI_RETRY_S (120 s) apart: canvas and gl download prebuilt binaries
# from GitHub's release downloads, which answered 504 for every repo on 2026-11-08 (#394, #397); with no
# prebuild they fall back to node-gyp, which cannot build here (no compiler or pkg-config, by design).
set -Eeuo pipefail

ROOT=${ROOT:-}
REPO_URL=${MINDCRAFT_ROTN_REPO_URL:-https://github.com/JQDAW/mindcraft-RotN.git}
BASE=$ROOT/opt/mindcraft-rotn
BOTS_DIR=/var/lib/mindcraft-rotn/bots
BOTS_FS=$ROOT$BOTS_DIR   # the same folder on this file system (ROOT is the tests' fake root)
SVC_GROUP=mindcraft-rotn
HEALTH_WAIT_S=${HEALTH_WAIT_S:-45}
KEEP_RELEASES=${KEEP_RELEASES:-5}
readonly NPM_CI_TRIES=3
NPM_CI_RETRY_S=${NPM_CI_RETRY_S:-120}
# Only this fork's release tags (lead, rotn-v0.1.0): the repo also carries upstream Mindcraft's v0.x tags, and upstream
# v0.1.0 is an ancestor of develop, so `deploy v0.1.0` would pass the on-develop check and deploy plain Mindcraft.
TAG_RE='^rotn-v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$'
CTL=(sudo -n /usr/local/sbin/mindcraft-rotn-ctl)

log() { echo "[deploy $(date -u +%H:%M:%S)] $*" >&2; }
die() { echo "[deploy] ERROR: $*" >&2; exit 1; }
git_() { git --git-dir="$BASE/repo.git" "$@"; }

state_get() { [[ -f $BASE/state ]] && sed -n "s/^$1=//p" "$BASE/state" | tail -n 1 || true; }
state_set() {   # state_set CURRENT PREVIOUS
  printf 'current=%s\nprevious=%s\n' "$1" "$2" > "$BASE/state.new"
  mv -f "$BASE/state.new" "$BASE/state"
}
ledger() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$BASE/deploys.log"; }

lock() {
  mkdir "$BASE/.deploy.lock" 2> /dev/null || die "another deploy is running (or a stale $BASE/.deploy.lock: remove it if no deploy is running)"
  trap 'rmdir "$BASE/.deploy.lock" 2> /dev/null || true' EXIT
}

# switch_to RELEASE_NAME: point `current` at it in one rename.
switch_to() {
  ln -sfn "releases/$1" "$BASE/current.new"
  mv -Tf "$BASE/current.new" "$BASE/current"
}

enabled_bots() {
  local b
  for b in $("${CTL[@]}" list); do
    "${CTL[@]}" is-enabled "$b" > /dev/null 2>&1 && echo "$b"
  done
  return 0
}

restart_bots() {
  local b
  for b in "$@"; do log "restarting $b"; "${CTL[@]}" restart "$b"; done
}

# The release's tracked files under bots/ (G4 step 0, 2026-11-08: bots/execTemplate.js and bots/lintTemplate.js,
# which the Coder reads). A release's bots/ is the link to the shared $BOTS_DIR, so build() keeps the tracked files
# in RELEASE/.bots-tracked/ with their list in RELEASE/.bots-files, and install_bot_files puts them into $BOTS_DIR
# before every switch (deploy and rollback), overwriting, 0644. $BOTS_DIR must be writable by deploy: bootstrap.sh
# makes it 2770 mindcraft-rotn:mindcraft-rotn (an older CX23: run `chmod 2770 /var/lib/mindcraft-rotn/bots` as root).
readonly BOTS_FILE_RE='^bots/[A-Za-z0-9_][A-Za-z0-9._-]*(/[A-Za-z0-9_][A-Za-z0-9._-]*)*$'

# install_bot_files RELEASE_DIR: copy the release's tracked bots/ files into $BOTS_DIR and check them; dies on any
# problem, so a caller that has not switched yet changes nothing. A release built before this fix has no list: logged.
install_bot_files() {
  local rel=$1 f dst tmpf
  [[ -f $rel/.bots-files ]] || { log "$(basename "$rel") has no .bots-files (built before the bots/ fix): no files installed"; return 0; }
  [[ -d $BOTS_FS && -w $BOTS_FS ]] \
    || die "$BOTS_DIR is not a folder deploy can write: as root, once: chmod 2770 $BOTS_DIR (bootstrap.sh makes it so; G4 step 0)"
  while IFS= read -r f; do
    [[ -n $f ]] || continue
    [[ $f =~ $BOTS_FILE_RE ]] || die "$(basename "$rel"): bad name in .bots-files: '$f'"
    dst=$BOTS_FS/${f#bots/}
    tmpf=$(dirname "$dst")/.$(basename "$dst").new-$$
    mkdir -p "$(dirname "$dst")"
    cp "$rel/.bots-tracked/${f#bots/}" "$tmpf" && chmod 0644 "$tmpf" && mv -f "$tmpf" "$dst" \
      || { rm -f "$tmpf"; die "could not install $f into $BOTS_DIR"; }
  done < "$rel/.bots-files"
  bot_files_ok "$rel" || die "the bots/ files of $(basename "$rel") are not in $BOTS_DIR after the install"
  log "installed $(grep -c . "$rel/.bots-files") tracked bots/ file(s) into $BOTS_DIR"
}

# bot_files_ok RELEASE_DIR: 0 if every file on the release's list is in $BOTS_DIR as the release has it.
bot_files_ok() {
  local rel=$1 f ok=0
  [[ -f $rel/.bots-files ]] || return 0
  while IFS= read -r f; do
    [[ -n $f ]] || continue
    cmp -s "$rel/.bots-tracked/${f#bots/}" "$BOTS_FS/${f#bots/}" || { log "missing or different in $BOTS_DIR: ${f#bots/}"; ok=1; }
  done < "$rel/.bots-files"
  return $ok
}

# healthy BOT...: 0 if every bot is active after HEALTH_WAIT_S.
healthy() {
  local b bad=()
  (( $# )) || return 0
  sleep "$HEALTH_WAIT_S"
  for b in "$@"; do "${CTL[@]}" is-active "$b" > /dev/null 2>&1 || bad+=("$b"); done
  (( ${#bad[@]} == 0 )) && return 0
  log "not active after ${HEALTH_WAIT_S}s: ${bad[*]} (see: sudo mindcraft-rotn-ctl status <bot>; journalctl -u mindcraft-rotn@<bot>)"
  return 1
}

fetch() {
  if [[ ! -d $BASE/repo.git ]]; then
    log "cloning $REPO_URL"
    git clone --quiet --bare "$REPO_URL" "$BASE/repo.git"
  fi
  git_ fetch --quiet --prune --force origin '+refs/heads/develop:refs/heads/develop' '+refs/tags/*:refs/tags/*'
}

# settings_check DIR: DIR/settings.js's default export, as main.js imports it. Exit 0 only if:
#   allow_insecure_coding === false (else 1; also 1 if it cannot be evaluated);
#   skills-rotn's test-only allow_server_task_giver (#146) is false or absent (else 2): only the G3
#     driver turns it on, on a test server (#157 review);
#   no task-giver list names the console sender "Server", in any case (else 3).
settings_check() {
  local node; node=$(command -v node) || return 1
  (cd "$1" && env -i PATH=/usr/bin:/bin "$node" --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const s = (await import(pathToFileURL(process.cwd() + "/settings.js").href)).default;
    if (!(s && typeof s === "object" && s.allow_insecure_coding === false)) process.exit(1);
    if ("allow_server_task_giver" in s && s.allow_server_task_giver !== false) process.exit(2);
    for (const [k, v] of Object.entries(s)) {
      if (/giver/i.test(k) && (Array.isArray(v) ? v : [v]).some((x) => String(x).toLowerCase() === "server")) process.exit(3);
    }
    process.exit(0);
  ' > /dev/null 2>&1)
}

# build TAG SHA NAME: extract, check, npm ci, link bots. Leaves releases/NAME complete or nothing.
build() {
  local tag=$1 sha=$2 name=$3 tmp
  tmp="$BASE/releases/.tmp-$name-$$"
  rm -rf "$tmp"; mkdir -p "$tmp"
  git_ archive --format=tar "$sha" | tar -x -C "$tmp"
  # Evaluate settings.js the way main.js does (import its default export), not by grep: only a real
  # `allow_insecure_coding === false` passes (PR #30 review finding 7). It runs with an empty
  # environment so nothing outside the release can change the answer.
  local rc=0
  settings_check "$tmp" || rc=$?
  case $rc in
    0) ;;
    2) rm -rf "$tmp"; die "$tag: settings.js has allow_server_task_giver not false: it is test-only (the G3 driver's, on a test server), never on the CX23; refusing" ;;
    3) rm -rf "$tmp"; die "$tag: settings.js names \"Server\" as a task giver: the console sender is a test-only giver, never on the CX23; refusing" ;;
    *) rm -rf "$tmp"; die "$tag: settings.js does not evaluate to allow_insecure_coding === false; refusing" ;;
  esac
  log "npm ci in $name"
  # npm ci starts from a clean node_modules each time, so a retry is safe.
  local try=1
  until (cd "$tmp" && npm ci --no-audit --no-fund); do
    (( try < NPM_CI_TRIES )) || { rm -rf "$tmp"; die "$tag: npm ci failed ($try tries; if it says \"No prebuilt binaries found\", check GitHub's release downloads)"; }
    log "npm ci failed (try $try of $NPM_CI_TRIES); trying again in $NPM_CI_RETRY_S s"
    sleep "$NPM_CI_RETRY_S"
    try=$((try + 1))
  done
  # Keep the tracked bots/ files (the release's bots/ becomes the link to the shared folder): the list from git,
  # the files moved to .bots-tracked/ (G4 step 0: deleting them crash-looped the Coder).
  git_ ls-tree -r --name-only "$sha" -- bots/ > "$tmp/.bots-files" || { rm -rf "$tmp"; die "$tag: could not list bots/"; }
  if [[ -d $tmp/bots ]]; then mv -T "$tmp/bots" "$tmp/.bots-tracked"; else mkdir -p "$tmp/.bots-tracked"; fi
  ln -sfn "$BOTS_DIR" "$tmp/bots"
  chgrp -R "$SVC_GROUP" "$tmp"
  chmod -R g+rX,g-w,o-rwx "$tmp"
  touch "$tmp/.release-ok"
  mv -T "$tmp" "$BASE/releases/$name"
}

prune() {
  local cur=$1 prev=$2 n=0 d
  # Newest first; keep KEEP_RELEASES complete releases plus current and previous.
  while IFS= read -r d; do
    [[ -n $d && $d != .tmp-* ]] || continue
    [[ $d == "$cur" || $d == "$prev" ]] && continue
    n=$((n + 1))
    (( n > KEEP_RELEASES )) && { log "pruning $d"; rm -rf "${BASE:?}/releases/$d"; }
  done < <(ls -1t "$BASE/releases")
  return 0
}

do_deploy() {
  local tag=${1:-} force=0 sha name cur prev bots
  [[ ${2:-} == --force ]] && force=1
  [[ $tag =~ $TAG_RE ]] || die "usage: deploy.sh deploy rotn-vX.Y.Z[-suffix] [--force] (bad tag '$tag': only this fork's rotn-v release tags are deployed; v0.x tags are upstream Mindcraft's)"
  lock
  fetch
  sha=$(git_ rev-parse --verify --quiet "refs/tags/$tag^{commit}") || die "no tag '$tag' in $REPO_URL"
  git_ merge-base --is-ancestor "$sha" refs/heads/develop || die "tag '$tag' ($sha) is not on develop; refusing"
  name="$tag-${sha:0:12}"
  cur=$(state_get current); prev=$(state_get previous)
  if [[ $name == "$cur" ]] && (( !force )); then log "$name is already current (use --force to restart anyway)"; return 0; fi
  if [[ -f $BASE/releases/$name/.release-ok ]]; then log "reusing releases/$name"
  else build "$tag" "$sha" "$name"; fi
  mapfile -t bots < <(enabled_bots)
  install_bot_files "$BASE/releases/$name"
  switch_to "$name"
  [[ $name == "$cur" ]] || state_set "$name" "$cur"
  restart_bots "${bots[@]}"
  if bot_files_ok "$BASE/releases/$name" && healthy "${bots[@]}"; then
    ledger "deploy $tag $sha $name ok bots=${bots[*]:-none}"
    log "deployed $name (bots: ${bots[*]:-none})"
    prune "$name" "$cur"
    return 0
  fi
  if [[ -n $cur && $cur != "$name" && -f $BASE/releases/$cur/.release-ok ]]; then
    log "health check failed: rolling back to $cur"
    install_bot_files "$BASE/releases/$cur"
    switch_to "$cur"
    state_set "$cur" "$prev"
    restart_bots "${bots[@]}"
    ledger "deploy $tag $sha $name FAILED rolled-back-to=$cur"
    healthy "${bots[@]}" || log "the bots are not healthy on $cur either; check the server and the journal"
  else
    ledger "deploy $tag $sha $name FAILED no-previous-release"
  fi
  die "deploy of $tag failed its health check"
}

do_rollback() {
  local cur prev bots
  lock
  cur=$(state_get current); prev=$(state_get previous)
  [[ -n $prev ]] || die "no previous release to roll back to"
  [[ -f $BASE/releases/$prev/.release-ok ]] || die "previous release $prev is not on disk"
  mapfile -t bots < <(enabled_bots)
  install_bot_files "$BASE/releases/$prev"
  switch_to "$prev"
  state_set "$prev" "$cur"
  restart_bots "${bots[@]}"
  if bot_files_ok "$BASE/releases/$prev" && healthy "${bots[@]}"; then
    ledger "rollback to $prev from $cur ok"
    log "rolled back to $prev"
    return 0
  fi
  ledger "rollback to $prev from $cur UNHEALTHY"
  die "rolled back to $prev, but the bots are not healthy; check the journal"
}

do_status() {
  echo "current=$(state_get current)"
  echo "previous=$(state_get previous)"
  echo "releases:"
  local d
  while IFS= read -r d; do
    [[ -n $d && $d != .tmp-* ]] && echo "  $d"
  done < <(ls -1t "$BASE/releases" 2> /dev/null)
  return 0
}

[[ -d $BASE/releases ]] || die "$BASE/releases is missing (run bootstrap.sh setup first)"
case ${1:-} in
  deploy) shift; do_deploy "$@" ;;
  rollback) shift; do_rollback ;;
  status) do_status ;;
  *) die "usage: deploy.sh deploy TAG [--force] | rollback | status" ;;
esac
