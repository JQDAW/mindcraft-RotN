#!/bin/bash -p
# The forced command of the CX33's restricted SSH key to deploy@cx23 (ADR 0009, ADR 0011), installed as
# /usr/local/sbin/mindcraft-rotn-ssh-gate (root:root 0755) and named in deploy's authorized_keys:
#
#   from="<the CX33's address>",restrict,command="/usr/local/sbin/mindcraft-rotn-ssh-gate" ssh-ed25519 AAAA... <comment>
#
# sshd runs this program for every login with that key, whatever the client asked for, and puts the client's
# request in SSH_ORIGINAL_COMMAND (unset for an interactive login). The gate allows exactly these requests,
# each one bot name (the ctl's BOT_RE), separated by single spaces, nothing else on the line:
#
#   status BOT | start BOT | stop BOT | metrics BOT
#   journal BOT
#   journal BOT --since YYYY-MM-DDTHH:MM[:SS][Z]     (read as UTC by the ctl; no space form: no quoting needed)
#   journal BOT --since @EPOCH_SECONDS
#   reset-state BOT NAME                             (ADR 0011; NAME is the bot's Mindcraft profile name, e.g. FRCFLD)
#
# and runs it as `sudo -n mindcraft-rotn-ctl VERB BOT [...]`, which checks every argument again
# (deploy/cx23/mindcraft-rotn-ctl.sh). And, as the build user rotn-build (ADR 0011: release code never runs as
# deploy; deploy's second sudoers rule allows exactly `(rotn-build) /usr/local/lib/mindcraft-rotn/deploy.sh`):
#
#   deploy TAG         TAG exactly rotn-vX.Y.Z (digits only, no suffix; deliberately stricter than deploy.sh's own
#                      TAG_RE, which allows a suffix: do not align them):
#                      `sudo -n -u rotn-build DEPLOY_SH --no-restart deploy TAG`. Refused while any bot is enabled
#                      or running: the gate takes the ctl's lock (CTL_LOCK, which start, restart and reset-state also
#                      take) and holds it for the whole deploy, so no bot can start on a half-built release; then
#                      every bot of `ctl list` must print exactly "disabled" to `ctl is-enabled` and exactly
#                      "inactive" or "failed" to `ctl is-active` (exit codes are not trusted: is-active exits non-zero
#                      for activating and deactivating too), or nothing runs. Not exec'ed: the gate logs
#                      "deploy TAG exit=N" afterwards; the root-owned journal is the record (deploys.log is
#                      rotn-build's, so release code can rewrite it). A HUP, INT or TERM during the deploy is logged
#                      ("deploy TAG interrupted by SIGx") and passed on to the build as TERM; the exit line follows.
#   deploy-check TAG   `sudo -n -u rotn-build DEPLOY_SH check TAG`: fetch, then is the tag on develop, and its commit.
#                      Builds nothing.
#   release            `sudo -n -u rotn-build DEPLOY_SH status` (read-only).
#
# DEPLOY_SH is root's copy, /usr/local/lib/mindcraft-rotn/deploy.sh. sudo resets the environment, so nothing of the
# client's or sshd's reaches it (deploy.sh reads ROOT, MINDCRAFT_ROTN_REPO_URL, HEALTH_WAIT_S and more from its
# environment), and deploy.sh sets its own PATH. As deploy, the gate runs only fixed root-owned programs, never
# release code. restart, enable, disable, list, daemon-reload, rollback and everything else are refused: behind this
# gate the sudoers rule allows every ctl verb, so the gate is the only barrier (ADR 0009). No request reads or writes
# the env files in /etc/mindcraft-rotn: they stay the human's (ADR 0011).
#
# How it stays safe:
#   - The request is matched as ONE string against fixed anchored patterns; the arguments are the patterns'
#     captures. The request is never word-split, glob-expanded, eval'ed or passed to a shell.
#   - It trusts nothing in its environment: `bash -p` reads no BASH_ENV/ENV and imports no functions; sshd
#     passes LANG and LC_* from the client (AcceptEnv), so the
#     locale is fixed to C (the patterns' ranges are then plain ASCII), PATH is reset, and every program has a
#     fixed path. sudo resets the environment for the ctl.
#   - What this script cannot guard (#365 review): sshd starts a forced command through deploy's LOGIN SHELL,
#     as `$SHELL -c '/usr/local/sbin/mindcraft-rotn-ssh-gate'`. That shell runs before this one's `bash -p`: it
#     reads BASH_ENV if sshd let the client set it, and Ubuntu's bash reads ~/.bashrc when sshd starts it. So
#     on the CX23, `sshd -T` must show AcceptEnv with only LANG and LC_* and `permituserenvironment no`, and
#     deploy's shell start-up files must be writable by deploy only (deploy/cx23/README.md, G4 step 0, B1).
#   - A refused request is logged to syslog (tag rotn-ssh-gate, auth.warning) made safe: at most LOG_MAX
#     bytes, every byte outside printable ASCII shown as '?', and its full length. An allowed one is logged
#     at auth.info. The client gets a short refusal on stderr, never its own input back. Exit 126, distinct
#     from the ctl's own refusal (2), so the harness can tell a gate refusal (an ADR 0009 incident) apart.
#   - Requests longer than MAX_LEN bytes are refused before any matching.
#
# The offline tests (test/unit/cx23-ssh-gate.test.js) run a copy with the readonly program paths rewritten.
set -uf -o pipefail
export LC_ALL=C
PATH=/usr/sbin:/usr/bin:/sbin:/bin

readonly SUDO=/usr/bin/sudo
readonly CTL=/usr/local/sbin/mindcraft-rotn-ctl
readonly BUILD_USER=rotn-build
readonly FLOCK=/usr/bin/flock
readonly CTL_LOCK=/run/mindcraft-rotn-ctl.lock   # root:deploy 0640, made by `ctl list`; deploy may open it read-only
readonly DEPLOY_SH=/usr/local/lib/mindcraft-rotn/deploy.sh
readonly DEPLOY_RUN=("$SUDO" -n -u "$BUILD_USER" "$DEPLOY_SH")
readonly LOGGER=/usr/bin/logger
readonly TAG=rotn-ssh-gate
readonly MAX_LEN=128
readonly LOG_MAX=200
readonly REFUSED=126   # a gate refusal; the ctl refuses with 2 (#365 review)
readonly BOT='[a-z0-9][a-z0-9-]{0,31}'
readonly SIMPLE_RE="^(status|start|stop|metrics) ($BOT)\$"
readonly JOURNAL_RE="^journal ($BOT)( --since ([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z?|@[0-9]{1,12}))?\$"
readonly RESET_RE="^reset-state ($BOT) ([A-Za-z0-9_]{1,16})\$"
readonly TAG_RE='rotn-v[0-9]+\.[0-9]+\.[0-9]+'
readonly DEPLOY_RE="^(deploy|deploy-check) ($TAG_RE)\$"
readonly BOT_LINE_RE="^$BOT\$"
readonly RELEASE_RE='^release$'

# The request as one log-safe line: printable ASCII kept, every other byte '?', at most LOG_MAX bytes.
safe() {
  local s=$1 out='' c i n=${#1}
  (( n > LOG_MAX )) && n=$LOG_MAX
  for (( i = 0; i < n; i++ )); do
    c=${s:i:1}
    if [[ $c == [[:print:]] ]]; then out+=$c; else out+='?'; fi
  done
  printf '%s' "$out"
}
log() { "$LOGGER" -t "$TAG" -p "$1" -- "$2" 2>/dev/null || true; }
refuse() {
  log auth.warning "refused ($1): '$(safe "$req")' (${#req} bytes)"
  echo "rotn-ssh-gate: refused. Allowed: status|start|stop|metrics BOT; journal BOT [--since YYYY-MM-DDTHH:MM[:SS][Z]|@EPOCH]; reset-state BOT NAME; deploy|deploy-check rotn-vX.Y.Z; release" >&2
  exit "$REFUSED"
}
# A well-formed deploy that the state of the host does not allow: logged and refused with the ctl's refusal code (2),
# not the gate's 126 (it is not a malformed request).
not_now() {
  log auth.warning "deploy $1 not run: $2"
  echo "rotn-ssh-gate: deploy $1 not run: $2" >&2
  exit 2
}
# 0 if no bot is enabled or running, with the ctl's lock held on fd 9 until the gate exits. `ctl list` first: it makes
# sure the lock file exists. Then, under the lock, every listed bot must print exactly "disabled" (is-enabled) and
# exactly "inactive" or "failed" (is-active). Anything else (enabled, static, masked, activating, deactivating, an
# error, empty output, an odd name, a failed list, a held lock) refuses: fail closed.
deploy_allowed() {
  local out b state
  out=$("$SUDO" -n "$CTL" list) || { why="ctl list failed"; return 1; }
  { exec 9< "$CTL_LOCK"; } 2>/dev/null || { why="cannot open the ctl's lock $CTL_LOCK"; return 1; }
  "$FLOCK" -n 9 || { why="the ctl's lock is held (a bot start, a reset-state or another deploy)"; return 1; }
  while IFS= read -r b; do
    [[ -z $b ]] && continue
    [[ $b =~ $BOT_LINE_RE ]] || { why="ctl list printed an unexpected line"; return 1; }
    state=$("$SUDO" -n "$CTL" is-enabled "$b" 2>/dev/null) || true
    [[ $state == disabled ]] || { why="bot $b is not disabled (is-enabled: '$(safe "$state")')"; return 1; }
    state=$("$SUDO" -n "$CTL" is-active "$b" 2>/dev/null) || true
    [[ $state == inactive || $state == failed ]] || { why="bot $b is not stopped (is-active: '$(safe "$state")')"; return 1; }
  done <<< "$out"
  return 0
}
# A signal during a deploy: logged, and passed on to the build (sudo relays TERM to deploy.sh); the gate then waits for
# it and logs its exit as usual.
on_signal() {
  interrupted=$1 woke=1
  log auth.warning "deploy $tag interrupted by SIG$1; passing TERM to the build"
  kill -s TERM "$child" 2>/dev/null || log auth.warning "deploy $tag: could not pass TERM to the build (pid $child); it goes on"
}

if [[ -z ${SSH_ORIGINAL_COMMAND+x} ]]; then req=''; refuse 'no command (an interactive login)'; fi
req=$SSH_ORIGINAL_COMMAND
(( ${#req} <= MAX_LEN )) || refuse "longer than $MAX_LEN bytes"

if [[ $req =~ $SIMPLE_RE ]]; then
  args=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}")
elif [[ $req =~ $JOURNAL_RE ]]; then
  args=(journal "${BASH_REMATCH[1]}")
  [[ -n ${BASH_REMATCH[2]} ]] && args+=(--since "${BASH_REMATCH[3]}")
elif [[ $req =~ $RESET_RE ]]; then
  args=(reset-state "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}")
elif [[ $req =~ $DEPLOY_RE ]]; then
  verb=${BASH_REMATCH[1]} tag=${BASH_REMATCH[2]}
  if [[ $verb == deploy-check ]]; then
    log auth.info "allowed: deploy-check $tag"
    exec "${DEPLOY_RUN[@]}" check "$tag"
  fi
  why='' interrupted='' child='' woke=0
  deploy_allowed || not_now "$tag" "$why"
  log auth.info "allowed: deploy $tag"
  trap 'on_signal HUP' HUP
  trap 'on_signal INT' INT
  trap 'on_signal TERM' TERM
  # 9<&-: the build never inherits the ctl's lock (release code must not be able to hold it).
  "${DEPLOY_RUN[@]}" --no-restart deploy "$tag" 9<&- &
  child=$!
  # wait returns early (>128) when a trapped signal arrives, and on_signal then sets woke: wait again. Only a wait that
  # no signal woke gives the build's own exit status. No kill -0 probe: the child is the setuid sudo, which this user
  # may not be allowed to signal (EPERM, e.g. under sudo-rs) while it still runs.
  while :; do
    woke=0 rc=0
    wait "$child" || rc=$?
    (( woke )) || break
  done
  if (( rc == 0 )) && [[ -z $interrupted ]]; then log auth.info "deploy $tag exit=0"; else log auth.warning "deploy $tag exit=$rc${interrupted:+ (after SIG$interrupted)}"; fi
  exit "$rc"
elif [[ $req =~ $RELEASE_RE ]]; then
  log auth.info "allowed: release"
  exec "${DEPLOY_RUN[@]}" status
else
  refuse 'not an allowed request'
fi

log auth.info "allowed: ${args[*]}"
exec "$SUDO" -n "$CTL" "${args[@]}"
