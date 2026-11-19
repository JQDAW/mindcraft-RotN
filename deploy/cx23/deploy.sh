#!/usr/bin/env bash
# Tag-based deploy and rollback on the bot's CX23 (harness-ops, brief deliverable 5). It needs no secrets: the
# repo is public and the bots' keys stay in /etc/mindcraft-rotn/<bot>.env.
#
# Since ADR 0011 it runs only as the build user rotn-build, which owns /opt/mindcraft-rotn and has no login shell,
# no SSH key, no sudo rule and no access to the bots' state: release code (settings.js, npm's install scripts) never
# runs as deploy. Root's copy is /usr/local/lib/mindcraft-rotn/deploy.sh (root:root 0755); deploy may run exactly that
# as rotn-build, the CX33's gate and the human alike:
#   sudo -n -u rotn-build /usr/local/lib/mindcraft-rotn/deploy.sh --no-restart deploy TAG
#   sudo -n -u rotn-build /usr/local/lib/mindcraft-rotn/deploy.sh check TAG
#   sudo -n -u rotn-build /usr/local/lib/mindcraft-rotn/deploy.sh status
# That sudoers rule allows any arguments, so run as BUILD_USER this script accepts exactly those three shapes
# (ADR 0011) and refuses everything else, rollback and a deploy without --no-restart included.
#
#   deploy.sh [--no-restart] deploy TAG [--force]   release TAG (a tag on develop): extract it, npm ci, switch,
#                                                   restart the enabled bots (not with --no-restart)
#   deploy.sh rollback                              switch back to the previous release and restart (not as BUILD_USER)
#   deploy.sh status                                current and previous release, and the releases on disk
#   deploy.sh check TAG                             fetch, then: is TAG on develop, and its commit. Builds nothing.
#
# --no-restart never calls the ctl (rotn-build has no sudo rule): the bots are not restarted and not health-checked.
# The gate refuses a deploy while any bot is enabled.
#
# PATH is fixed (node, npm and git from /usr/bin), and HOME is the running user's home from the passwd database
# (rotn-build's /var/lib/rotn-build: npm's cache), whatever the caller's environment; sudo resets the rest.
# The working folder is /, whatever the caller's: sudo keeps the caller's (/root, /home/deploy), which rotn-build
# cannot read, and GNU find fails when it cannot return to it (the first ADR 0011 install, D4). Every path is absolute.
# A deploy removes the leftovers of a killed build (releases/.tmp-*) once they are a day old.
# ROOT, MINDCRAFT_ROTN_REPO_URL, HEALTH_WAIT_S, KEEP_RELEASES and NPM_CI_RETRY_S are for the offline tests: sudo does
# not pass them.
#
# Release folders: /opt/mindcraft-rotn and releases/ are setgid (2750, group mindcraft-rotn), so what the build
# creates gets the bots' group. rotn-build is not in that group, so a chmod by it clears the setgid bit of a folder
# (the kernel drops S_ISGID for a non-member), and files made in such a folder would get rotn-build's own group: the
# build refuses (fail closed) if anything in the release is outside SVC_GROUP before it sets the permissions.
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
PATH=/usr/bin:/bin
BUILD_USER=rotn-build
# As the build user nothing in the environment may steer it (sudo resets it too; ADR 0011): the test hooks below
# keep their defaults.
if [[ $(id -un) == "$BUILD_USER" ]]; then unset ROOT MINDCRAFT_ROTN_REPO_URL HEALTH_WAIT_S KEEP_RELEASES NPM_CI_RETRY_S; fi

ROOT=${ROOT:-}
REPO_URL=${MINDCRAFT_ROTN_REPO_URL:-https://github.com/JQDAW/mindcraft-RotN.git}
BASE=$ROOT/opt/mindcraft-rotn
BOTS_DIR=/var/lib/mindcraft-rotn/bots
SVC_GROUP=mindcraft-rotn
HEALTH_WAIT_S=${HEALTH_WAIT_S:-45}
KEEP_RELEASES=${KEEP_RELEASES:-5}
readonly NPM_CI_TRIES=3
NPM_CI_RETRY_S=${NPM_CI_RETRY_S:-120}
# Only this fork's release tags (lead, rotn-v0.1.0): the repo also carries upstream Mindcraft's v0.x tags, and upstream
# v0.1.0 is an ancestor of develop, so `deploy v0.1.0` would pass the on-develop check and deploy plain Mindcraft.
# Do not align this with the CX33 gate's TAG_RE (ADR 0011): the gate deliberately allows only rotn-vX.Y.Z (no suffix);
# a suffixed tag (rotn-v0.1.0-rc.1) is deployed only by the human, through the build user.
TAG_RE='^rotn-v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$'
CTL=(sudo -n /usr/local/sbin/mindcraft-rotn-ctl)
NO_RESTART=0

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
  (( NO_RESTART )) && return 0   # never calls the ctl: no bot is restarted or health-checked
  for b in $("${CTL[@]}" list); do
    "${CTL[@]}" is-enabled "$b" > /dev/null 2>&1 && echo "$b"
  done
  return 0
}

restart_bots() {
  local b
  for b in "$@"; do log "restarting $b"; "${CTL[@]}" restart "$b"; done
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

# in_group DIR: 0 if everything under DIR has the group SVC_GROUP (ADR 0011: the setgid folders gave it to them).
in_group() {
  local bad
  bad=$(find "$1" ! -group "$SVC_GROUP" -print -quit) || return 1
  [[ -z $bad ]] || { log "not in group $SVC_GROUP: ${bad#"$1"/} (a folder lost its setgid bit?)"; return 1; }
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
  # The release's tracked bots/ files (bots/execTemplate.js, bots/lintTemplate.js) are replaced by the link to the
  # shared folder. They are unused while allow_insecure_coding is false: since #410 the Coder reads them only on the
  # first code generation, which insecure coding off never reaches (lead decision after G4 step 0, #412 review).
  rm -rf "$tmp/bots"
  ln -sfn "$BOTS_DIR" "$tmp/bots"
  touch "$tmp/.release-ok.new"   # made before the chmod below, which clears the folders' setgid bit as rotn-build
  in_group "$tmp" || { rm -rf "$tmp"; die "$tag: part of the release is not in group $SVC_GROUP; the bot could not read it; refusing"; }
  chgrp -R "$SVC_GROUP" "$tmp"
  chmod -R g+rX,g-w,o-rwx "$tmp"
  mv -T "$tmp/.release-ok.new" "$tmp/.release-ok"
  mv -T "$tmp" "$BASE/releases/$name"
}

# A build killed by SIGKILL, a reboot or an older deploy.sh leaves releases/.tmp-*: remove those older than a day.
# Under the deploy lock no other build is running, so none of them is in use; the day is a margin all the same.
# A failed removal is logged, not fatal (README: "Stale build folders").
prune_tmp() {
  local d
  while IFS= read -r -d '' d; do
    log "removing a stale build folder: releases/${d##*/}"
    rm -rf -- "$d" || log "could not remove releases/${d##*/}; see the README, \"Stale build folders\""
  done < <(find "$BASE/releases" -mindepth 1 -maxdepth 1 -name '.tmp-*' -mmin +1440 -print0)
  return 0
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
  prune_tmp
  fetch
  sha=$(git_ rev-parse --verify --quiet "refs/tags/$tag^{commit}") || die "no tag '$tag' in $REPO_URL"
  git_ merge-base --is-ancestor "$sha" refs/heads/develop || die "tag '$tag' ($sha) is not on develop; refusing"
  name="$tag-${sha:0:12}"
  cur=$(state_get current); prev=$(state_get previous)
  if [[ $name == "$cur" ]] && (( !force )); then log "$name is already current (use --force to restart anyway)"; return 0; fi
  if [[ -f $BASE/releases/$name/.release-ok ]]; then log "reusing releases/$name"
  else build "$tag" "$sha" "$name"; fi
  mapfile -t bots < <(enabled_bots)
  switch_to "$name"
  [[ $name == "$cur" ]] || state_set "$name" "$cur"
  restart_bots "${bots[@]}"
  if healthy "${bots[@]}"; then
    ledger "deploy $tag $sha $name ok bots=${bots[*]:-none}"
    log "deployed $name (bots restarted: ${bots[*]:-none}$( (( NO_RESTART )) && echo '; --no-restart' || true))"
    prune "$name" "$cur"
    return 0
  fi
  if [[ -n $cur && $cur != "$name" && -f $BASE/releases/$cur/.release-ok ]]; then
    log "health check failed: rolling back to $cur"
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
  switch_to "$prev"
  state_set "$prev" "$cur"
  restart_bots "${bots[@]}"
  if healthy "${bots[@]}"; then
    ledger "rollback to $prev from $cur ok"
    log "rolled back to $prev"
    return 0
  fi
  ledger "rollback to $prev from $cur UNHEALTHY"
  die "rolled back to $prev, but the bots are not healthy; check the journal"
}

# check TAG: a dry run of deploy's first steps (ADR 0011's deploy-check): fetch, then the tag must be on develop.
do_check() {
  local tag=${1:-} sha
  (( $# == 1 )) && [[ $tag =~ $TAG_RE ]] || die "usage: deploy.sh check rotn-vX.Y.Z[-suffix]"
  lock
  fetch
  sha=$(git_ rev-parse --verify --quiet "refs/tags/$tag^{commit}") || die "no tag '$tag' in $REPO_URL"
  git_ merge-base --is-ancestor "$sha" refs/heads/develop || die "tag '$tag' ($sha) is not on develop"
  echo "tag=$tag commit=$sha on-develop=yes release=$tag-${sha:0:12}"
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

# Never as root (#485 review): release code would run with every right. rotn-build is the user (ADR 0011).
[[ $(id -u) != 0 ]] || die "never run deploy.sh as root: sudo -u $BUILD_USER /usr/local/lib/mindcraft-rotn/deploy.sh ..."
HOME=$(getent passwd "$(id -un)" | cut -d: -f6) || HOME=
[[ $HOME == /* ]] || die "no home directory for $(id -un) in the passwd database"
export HOME
# Run as the build user, exactly the three shapes the sudoers rule is for (ADR 0011).
if [[ $(id -un) == "$BUILD_USER" ]]; then
  case "$#:${1:-}:${2:-}" in
    1:status:|2:check:*|3:--no-restart:deploy) ;;
    *) die "as $BUILD_USER only: status | check TAG | --no-restart deploy TAG" ;;
  esac
fi
# Never in the caller's folder: sudo keeps it, and rotn-build cannot read /root or /home/deploy. GNU find (in_group)
# then fails with "Failed to restore initial working directory: Permission denied", and the build was refused as
# "not in group" (the first ADR 0011 install, D4). Nothing below uses a relative path.
cd / || die "cannot change to /"
[[ -d $BASE/releases ]] || die "$BASE/releases is missing (run bootstrap.sh setup first)"
if [[ ${1:-} == --no-restart ]]; then NO_RESTART=1; shift; fi
case ${1:-} in
  deploy) shift; do_deploy "$@" ;;
  rollback) (( NO_RESTART == 0 && $# == 1 )) || die "usage: deploy.sh rollback"; do_rollback ;;
  status) (( NO_RESTART == 0 && $# == 1 )) || die "usage: deploy.sh status"; do_status ;;
  check) (( NO_RESTART == 0 )) || die "usage: deploy.sh check TAG"; shift; do_check "$@" ;;
  *) die "usage: deploy.sh [--no-restart] deploy TAG [--force] | rollback | status | check TAG" ;;
esac
