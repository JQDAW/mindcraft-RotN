#!/usr/bin/env bash
# ExecStartPre of mindcraft-rotn@<bot>.service: refuse to start a bot on an unsafe environment.
# Installed as /usr/local/lib/mindcraft-rotn/check-env, next to check-env.mjs. It runs as the service
# user with the unit's effective environment (EnvironmentFile= applied), so it checks what the bot
# would really get.
#
#   check-env [--node BIN] [--stat BIN] [--release DIR] ENV_FILE
#
# The flags exist for the offline tests; the unit passes none, so the defaults (/usr/bin/node,
# /usr/bin/stat, /opt/mindcraft-rotn/current) apply. They are flags on purpose, not environment
# variables: an env file must not be able to point this check at another program.
#
# This half checks the files: MINDCRAFT_PROFILES_FOLDER (absolute, a directory, mode 0700, owned by
# the service user) and the env file (owned by root, mode 0600 or 0400, so the deploy user cannot
# read the OpenRouter key; systemd reads it as root). check-env.mjs parses the values the way main.js
# does: INSECURE_CODING, BLOCKED_ACTIONS, SETTINGS_JSON (allowlist), DEBUG, NODE_OPTIONS,
# MINDCRAFT_SINGLE_BOT_SERVICE and the OpenRouter key. Exit 1 with one line per problem; never prints
# a value.
set -uo pipefail

NODE_BIN=/usr/bin/node STAT_BIN=/usr/bin/stat RELEASE=/opt/mindcraft-rotn/current ENV_FILE=''
while (( $# )); do
  case $1 in
    --node) NODE_BIN=${2:-}; shift 2 ;;
    --stat) STAT_BIN=${2:-}; shift 2 ;;
    --release) RELEASE=${2:-}; shift 2 ;;
    *) ENV_FILE=$1; shift ;;
  esac
done
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
problems=0
bad() { echo "check-env: $*" >&2; problems=$((problems + 1)); }
me=$(id -un)

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
  bad "usage: check-env [--node BIN] [--stat BIN] [--release DIR] /etc/mindcraft-rotn/<bot>.env"
elif [[ ! -e $ENV_FILE ]]; then
  bad "env file missing"
else
  read -r mode owner < <("$STAT_BIN" -c '%a %U' "$ENV_FILE" 2>/dev/null)
  [[ ${owner:-} == root ]] || bad "the env file is owned by ${owner:-?}, must be root"
  [[ ${mode:-} =~ ^(600|400)$ ]] || bad "the env file has mode ${mode:-?}, must be 0600 (root only: the deploy user must not read the key)"
fi

# The value checks, in node. NODE_OPTIONS and NODE_PATH from the env file must not change how this
# checker runs; the bot's NODE_OPTIONS is passed along to be checked instead.
opts=()
[[ -n ${NODE_OPTIONS+x} ]] && opts=(CHECK_ENV_NODE_OPTIONS="$NODE_OPTIONS")
if ! env -u NODE_OPTIONS -u NODE_PATH "${opts[@]}" "$NODE_BIN" "$HERE/check-env.mjs" "$RELEASE"; then
  problems=$((problems + 1))
fi

if (( problems )); then
  echo "check-env: refusing to start" >&2
  exit 1
fi
exit 0
