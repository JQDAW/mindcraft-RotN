#!/usr/bin/env bash
# First ExecStartPre of mindcraft-rotn@<bot>.service, run as ROOT ("+" prefix in the unit), because the
# per-bot env file is root:root 0600 and the service user cannot read it. Installed as
# /usr/local/lib/mindcraft-rotn/check-env-names. It only reads the one file it is given.
#
#   check-env-names /etc/mindcraft-rotn/<bot>.env
#
# Allowlist of the variable NAMES the env file may set (lead, PR #30 re-review): exactly the ones in
# bot.env.example. Anything else refuses, e.g. NODE_TLS_REJECT_UNAUTHORIZED, HTTPS_PROXY/HTTP_PROXY/
# ALL_PROXY, LD_PRELOAD or NODE_EXTRA_CA_CERTS. Every non-comment, non-blank line must be NAME=value with
# an allowed NAME; "export NAME=", a line continuation (a trailing backslash) or anything else refuses.
# Prints names and line numbers only, never a value. Exit 0 ok, 1 refuse.
set -uo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin

readonly ALLOWED=' MINDCRAFT_PROFILES_FOLDER OPENROUTER_API_KEY PROFILES SETTINGS_JSON MINECRAFT_PORT MINDSERVER_PORT NODE_OPTIONS '
file=${1:-}
[[ -n $file && -f $file && ! -L $file ]] || { echo "check-env-names: usage: check-env-names /etc/mindcraft-rotn/<bot>.env (a regular file)" >&2; exit 1; }
# Fail closed on a file that cannot be read: otherwise the loop below would never run and the check
# would pass (PR #58 review).
[[ -r $file ]] || { echo "check-env-names: cannot read the env file; refusing to start" >&2; exit 1; }

problems=0
n=0
while IFS= read -r line || [[ -n $line ]]; do
  n=$((n + 1))
  line=${line%$'\r'}
  [[ $line =~ ^[[:space:]]*(#|;|$) ]] && continue
  if [[ $line =~ \\$ ]]; then
    echo "check-env-names: line $n continues onto the next line (trailing backslash): not allowed" >&2; problems=$((problems + 1)); continue
  fi
  if [[ ! $line =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]]; then
    echo "check-env-names: line $n is not NAME=value" >&2; problems=$((problems + 1)); continue
  fi
  name=${BASH_REMATCH[1]}
  if [[ $ALLOWED != *" $name "* ]]; then
    echo "check-env-names: line $n sets $name, which is not allowed in a bot env file" >&2; problems=$((problems + 1))
  fi
done < "$file" || { echo "check-env-names: reading the env file failed; refusing to start" >&2; exit 1; }
# A non-empty file that yielded no line at all was not really read: refuse rather than pass.
if [[ -s $file ]] && (( n == 0 )); then
  echo "check-env-names: read nothing from a non-empty env file; refusing to start" >&2
  exit 1
fi

if (( problems )); then
  echo "check-env-names: refusing to start ($problems problem(s))" >&2
  exit 1
fi
exit 0
