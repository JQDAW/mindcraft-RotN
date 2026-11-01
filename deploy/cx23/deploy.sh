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
# "allow_insecure_coding": false. After the switch it restarts the enabled bots, waits HEALTH_WAIT_S
# (default 45 s), and if any is not active it switches back to the previous release by itself.
set -Eeuo pipefail

ROOT=${ROOT:-}
REPO_URL=${MINDCRAFT_ROTN_REPO_URL:-https://github.com/JQDAW/mindcraft-RotN.git}
BASE=$ROOT/opt/mindcraft-rotn
BOTS_DIR=/var/lib/mindcraft-rotn/bots
SVC_GROUP=mindcraft-rotn
HEALTH_WAIT_S=${HEALTH_WAIT_S:-45}
KEEP_RELEASES=${KEEP_RELEASES:-5}
TAG_RE='^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
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

# build TAG SHA NAME: extract, check, npm ci, link bots. Leaves releases/NAME complete or nothing.
build() {
  local tag=$1 sha=$2 name=$3 tmp
  tmp="$BASE/releases/.tmp-$name-$$"
  rm -rf "$tmp"; mkdir -p "$tmp"
  git_ archive --format=tar "$sha" | tar -x -C "$tmp"
  grep -Eq '"allow_insecure_coding"[[:space:]]*:[[:space:]]*false' "$tmp/settings.js" 2> /dev/null \
    || { rm -rf "$tmp"; die "$tag: settings.js does not set \"allow_insecure_coding\": false; refusing"; }
  log "npm ci in $name"
  (cd "$tmp" && npm ci --no-audit --no-fund) || { rm -rf "$tmp"; die "$tag: npm ci failed"; }
  rm -rf "$tmp/bots"
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
  [[ $tag =~ $TAG_RE ]] || die "usage: deploy.sh deploy TAG [--force] (bad tag '$tag')"
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
  switch_to "$name"
  [[ $name == "$cur" ]] || state_set "$name" "$cur"
  restart_bots "${bots[@]}"
  if healthy "${bots[@]}"; then
    ledger "deploy $tag $sha $name ok bots=${bots[*]:-none}"
    log "deployed $name (bots: ${bots[*]:-none})"
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
