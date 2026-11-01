#!/usr/bin/env bash
# Fake system commands for the offline CX23 tests (test/unit/cx23.test.js). Called as
#   fake-sys.sh NAME ARGS...   (through a shim named NAME on PATH)
# Every call is appended to $FAKE_LOG as one line: NAME<TAB>ARG<TAB>ARG... (npm also logs cwd=$PWD).
#
# Generic behaviour, per command NAME (with '-' turned into '_'):
#   FAKE_OUT_NAME   printed on stdout        FAKE_RC_NAME   exit code (default 0)
# Special cases:
#   -o FILE   (curl and gpg only)     creates FILE
#   ln -sfn TARGET LINK               writes TARGET into the file LINK (no symlinks needed on Windows)
#   fallocate -l SIZE FILE            creates FILE
#   sudo -n /usr/local/sbin/mindcraft-rotn-ctl ACTION [BOT]
#        list        prints $FAKE_BOTS (space-separated)
#        is-enabled  0 if BOT is in $FAKE_ENABLED
#        is-active   1 if the release in $FAKE_CURRENT_FILE matches $FAKE_BAD_RELEASE, else 0
#        other       0
name=$1
shift
line=$name
for a in "$@"; do line+=$'\t'$a; done
[[ $name == npm ]] && line+=$'\t'"cwd=$PWD"
[[ -n ${FAKE_LOG:-} ]] && printf '%s\n' "$line" >> "$FAKE_LOG"

key=${name//-/_}
out_var="FAKE_OUT_$key"
rc_var="FAKE_RC_$key"

case $name in
  ln)
    printf '%s\n' "${@: -2:1}" > "${@: -1}"
    exit 0 ;;
  fallocate)
    : > "${@: -1}"
    exit 0 ;;
  sudo)
    action=$3 bot=${4:-}
    case $action in
      list) for b in ${FAKE_BOTS:-}; do echo "$b"; done; exit 0 ;;
      is-enabled) [[ " ${FAKE_ENABLED:-} " == *" $bot "* ]]; exit $? ;;
      is-active)
        if [[ -n ${FAKE_BAD_RELEASE:-} && -f ${FAKE_CURRENT_FILE:-} ]] && grep -q -- "$FAKE_BAD_RELEASE" "$FAKE_CURRENT_FILE"; then exit 3; fi
        exit 0 ;;
      *) exit 0 ;;
    esac ;;
esac

# Only curl and gpg take -o FILE (journalctl -o cat is an output format, not a file).
if [[ $name == curl || $name == gpg ]]; then
  prev=''
  for a in "$@"; do
    [[ $prev == -o ]] && : > "$a"
    prev=$a
  done
fi

[[ -n ${!out_var:-} ]] && printf '%s\n' "${!out_var}"
exit "${!rc_var:-0}"
