#!/bin/bash -p
# The forced command of the CX33's restricted SSH key to deploy@cx23 (ADR 0009), installed as
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
#
# and runs it as `sudo -n mindcraft-rotn-ctl VERB BOT [--since TIME]`, which checks the name and the time again
# (deploy/cx23/mindcraft-rotn-ctl.sh). restart, enable, disable, list, daemon-reload and everything else are
# refused: behind this gate the sudoers rule allows every ctl verb, so the gate is the only barrier (ADR 0009).
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
readonly LOGGER=/usr/bin/logger
readonly TAG=rotn-ssh-gate
readonly MAX_LEN=128
readonly LOG_MAX=200
readonly REFUSED=126   # a gate refusal; the ctl refuses with 2 (#365 review)
readonly BOT='[a-z0-9][a-z0-9-]{0,31}'
readonly SIMPLE_RE="^(status|start|stop|metrics) ($BOT)\$"
readonly JOURNAL_RE="^journal ($BOT)( --since ([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z?|@[0-9]{1,12}))?\$"

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
  echo "rotn-ssh-gate: refused. Allowed: status|start|stop|metrics BOT; journal BOT [--since YYYY-MM-DDTHH:MM[:SS][Z]|@EPOCH]" >&2
  exit "$REFUSED"
}

if [[ -z ${SSH_ORIGINAL_COMMAND+x} ]]; then req=''; refuse 'no command (an interactive login)'; fi
req=$SSH_ORIGINAL_COMMAND
(( ${#req} <= MAX_LEN )) || refuse "longer than $MAX_LEN bytes"

if [[ $req =~ $SIMPLE_RE ]]; then
  args=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}")
elif [[ $req =~ $JOURNAL_RE ]]; then
  args=(journal "${BASH_REMATCH[1]}")
  [[ -n ${BASH_REMATCH[2]} ]] && args+=(--since "${BASH_REMATCH[3]}")
else
  refuse 'not an allowed request'
fi

log auth.info "allowed: ${args[*]}"
exec "$SUDO" -n "$CTL" "${args[@]}"
