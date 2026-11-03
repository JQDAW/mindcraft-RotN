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
#   sshd -T                           the effective config from $ROOT's sshd_config and its Include (first value wins)
#   systemctl is-active ... / cat ... 3 if $FAKE_SSH_INACTIVE / 1 if $FAKE_NO_SSH_UNIT is set, else 0
#   ufw allow/delete/enable/show added/status   kept as state under $ROOT (see below)
#   sudo --version, sudo -l -U USER   sudo-rs, and the rule installed under $ROOT/etc/sudoers.d
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
  sshd)
    # sshd -T: the effective config like the real one. For each key the FIRST value read wins, in the
    # order sshd reads them: $ROOT/etc/ssh/sshd_config line by line, and at its
    # "Include /etc/ssh/sshd_config.d/*.conf" line the drop-ins in sorted order; then sshd's defaults.
    # Port is multi-valued, as in sshd: every Port line counts (default 22 only if there is none).
    # FAKE_RC_sshd sets the exit code of sshd -t, FAKE_RC_sshd_T that of sshd -T.
    if [[ ${1:-} == -T ]]; then
      declare -A eff=()
      ports=()
      take() { local k v; while read -r k v; do
        [[ -z $k || $k == \#* ]] && continue
        k=${k,,}
        if [[ $k == include ]]; then
          shopt -s nullglob
          for f in ${ROOT:-}$v; do take < <(tr -d '\r' < "$f"); done
          continue
        fi
        if [[ $k == port ]]; then ports+=("$v"); continue; fi
        [[ -n ${eff[$k]+x} ]] || eff[$k]=${v,,}
      done; }
      [[ -f ${ROOT:-}/etc/ssh/sshd_config ]] && take < <(tr -d '\r' < "${ROOT:-}/etc/ssh/sshd_config")
      take <<< $'permitrootlogin prohibit-password\npubkeyauthentication yes\npasswordauthentication yes\nkbdinteractiveauthentication yes'
      (( ${#ports[@]} )) || ports=(22)
      { for k in "${!eff[@]}"; do printf '%s %s\n' "$k" "${eff[$k]}"; done
        for v in "${ports[@]}"; do printf 'port %s\n' "$v"; done; } | sort
      exit "${FAKE_RC_sshd_T:-0}"
    fi
    # sshd -t (and anything else): FAKE_RC_sshd.
    exit "${!rc_var:-0}" ;;
  systemctl)
    # is-active: 3 (inactive) when FAKE_SSH_INACTIVE is set, else 0. cat: 1 when FAKE_NO_SSH_UNIT is set.
    if [[ ${1:-} == is-active ]]; then [[ -n ${FAKE_SSH_INACTIVE:-} ]] && exit 3; exit 0; fi
    if [[ ${1:-} == cat ]]; then [[ -n ${FAKE_NO_SSH_UNIT:-} ]] && exit 1; exit 0; fi ;;
  ufw)
    # State in $ROOT/.fake-ufw: the added rules (one "ufw allow ..." line each) and whether it is enabled.
    # FAKE_UFW_DROP_RULES: allow does not take (show added lists nothing); FAKE_UFW_NO_ENABLE: enable
    # does not take.
    st=${ROOT:-/tmp}/.fake-ufw; touch "$st.rules"
    case "${1:-} ${2:-}" in
      'allow '*) [[ -n ${FAKE_UFW_DROP_RULES:-} ]] || printf 'ufw %s\n' "$*" >> "$st.rules" ;;
      'delete allow') grep -vxF -- "ufw allow ${*:3}" "$st.rules" > "$st.tmp"; mv -f "$st.tmp" "$st.rules" ;;
      '--force enable') [[ -n ${FAKE_UFW_NO_ENABLE:-} ]] || : > "$st.on" ;;
      'show added') echo "Added user rules (see 'ufw status' for running firewall):"; cat "$st.rules" ;;
      'status '*) if [[ -f $st.on ]]; then echo 'Status: active'; else echo 'Status: inactive'; fi ;;
    esac
    exit "${!rc_var:-0}" ;;
  sudo)
    # sudo --version: $FAKE_SUDO_VERSION (default sudo-rs). sudo -l -U USER: the rule in
    # $ROOT/etc/sudoers.d/mindcraft-rotn if it exists, unless FAKE_SUDO_IGNORES_DROPIN is set.
    if [[ ${1:-} == --version ]]; then echo "${FAKE_SUDO_VERSION:-sudo-rs 0.2.8}"; exit 0; fi
    if [[ ${1:-} == -l ]]; then
      echo "User ${3:-} may run the following commands on cx23:"
      f=${ROOT:-}/etc/sudoers.d/mindcraft-rotn
      if [[ -z ${FAKE_SUDO_IGNORES_DROPIN:-} && -f $f ]]; then
        sed -n 's/^[a-z][a-z0-9-]* ALL=\(([a-z]*)\) \(.*\)$/    \1 \2/p' "$f"
      fi
      exit 0
    fi
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
