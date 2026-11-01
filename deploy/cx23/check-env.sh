#!/usr/bin/env bash
# ExecStartPre of mindcraft-rotn@<bot>.service: refuse to start a bot on an unsafe environment.
# Runs as the service user, with the unit's effective environment (EnvironmentFile= applied), so it
# checks what the bot would really get, not just the file.
#
#   check-env /etc/mindcraft-rotn/<bot>.env
#
# Refuses (exit 1, one line per problem on stderr, which goes to the journal) when:
#   - INSECURE_CODING is set to anything non-empty (main.js turns on allow_insecure_coding for it),
#   - SETTINGS_JSON mentions allow_insecure_coding (it could override settings.js),
#   - MINDCRAFT_SINGLE_BOT_SERVICE is not exactly 1 (the unit sets it; an env file must not undo it),
#   - MINDCRAFT_PROFILES_FOLDER is unset, not absolute, not a directory, not mode 0700, or not owned
#     by the service user (it holds the Microsoft token cache),
#   - the env file is not owned by root, or is group-writable or readable by others,
#   - OPENROUTER_API_KEY is empty or still the placeholder from bot.env.example.
# Never prints a value of any variable.
set -uo pipefail

STAT_BIN=${STAT_BIN:-stat}
ENV_FILE=${1:-}
problems=0
bad() { echo "check-env: $*" >&2; problems=$((problems + 1)); }

me=$(id -un)

[[ -z ${INSECURE_CODING:-} ]] || bad "INSECURE_CODING is set: insecure coding stays off on the CX23 (CLAUDE.md)"
[[ ${SETTINGS_JSON:-} != *allow_insecure_coding* ]] || bad "SETTINGS_JSON mentions allow_insecure_coding: not allowed"
[[ ${MINDCRAFT_SINGLE_BOT_SERVICE:-} == 1 ]] || bad "MINDCRAFT_SINGLE_BOT_SERVICE must be 1 (set by the unit; do not override it in the env file)"

pf=${MINDCRAFT_PROFILES_FOLDER:-}
if [[ -z $pf ]]; then
  bad "MINDCRAFT_PROFILES_FOLDER is not set (the bot's token cache folder)"
elif [[ $pf != /* ]]; then
  bad "MINDCRAFT_PROFILES_FOLDER must be an absolute path"
elif [[ ! -d $pf ]]; then
  bad "MINDCRAFT_PROFILES_FOLDER is not a directory (run bootstrap.sh add-bot)"
else
  read -r mode owner < <("$STAT_BIN" -c '%a %U' "$pf" 2>/dev/null)
  [[ ${mode:-} == 700 ]] || bad "MINDCRAFT_PROFILES_FOLDER has mode ${mode:-?}, must be 700"
  [[ ${owner:-} == "$me" ]] || bad "MINDCRAFT_PROFILES_FOLDER is owned by ${owner:-?}, must be $me"
fi

if [[ -z $ENV_FILE ]]; then
  bad "usage: check-env /etc/mindcraft-rotn/<bot>.env"
elif [[ ! -f $ENV_FILE ]]; then
  bad "env file missing"
else
  read -r mode owner < <("$STAT_BIN" -c '%a %U' "$ENV_FILE" 2>/dev/null)
  [[ ${owner:-} == root ]] || bad "the env file is owned by ${owner:-?}, must be root"
  [[ ${mode:-} =~ ^(600|640|400|440)$ ]] || bad "the env file has mode ${mode:-?}, must be 0640 or 0600 (no group write, nothing for others)"
fi

[[ -n ${OPENROUTER_API_KEY:-} && ${OPENROUTER_API_KEY:-} != *set-by-human* ]] \
  || bad "OPENROUTER_API_KEY is empty or still the placeholder (the human sets it in the env file)"

if (( problems )); then
  echo "check-env: refusing to start ($problems problem(s))" >&2
  exit 1
fi
exit 0
