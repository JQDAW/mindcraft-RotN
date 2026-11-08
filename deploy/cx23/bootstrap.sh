#!/usr/bin/env bash
# One-time bootstrap of the bot's CX23 (Ubuntu 26.04, ADR 0007; 24.04 is still accepted), run as root
# (harness-ops, brief deliverable 5).
# Copy this folder (deploy/cx23/) to the server and run it there; it never connects anywhere except
# the Ubuntu and NodeSource apt mirrors.
#
#   bootstrap.sh setup --deploy-key-file FILE [--ssh-from CIDR] [--swap-size 2G] [--allow-fpr-override]
#       --ssh-from must contain this SSH session's client address (SSH_CONNECTION); GO 2 runs without it.
#       Users: `deploy` (SSH key login, in groups sudo and mindcraft-rotn) and the system user
#       `mindcraft-rotn` (no login) that runs the bots. Unattended security upgrades. ufw: SSH only.
#       2 GB swap. Node 22 from NodeSource (key fingerprint pinned). git. The unit template, check-env,
#       mindcraft-rotn-ctl, a sudoers rule that lets `deploy` run only mindcraft-rotn-ctl without a
#       password, and the folders under /opt, /etc and /var/lib.
#       SSH password login OFF (the human's decision for GO 2): the drop-in
#       /etc/ssh/sshd_config.d/10-mindcraft-rotn.conf, checked with `sshd -t` and verified with `sshd -T`
#       before ssh is reloaded. Root keeps its key login (PermitRootLogin is not touched); deploy's
#       password is for sudo only.
#   bootstrap.sh add-bot BOT [--mindserver-port N]
#       Per-bot folders (token cache 0700) and /etc/mindcraft-rotn/BOT.env (0600 root:root) from bot.env.example.
#       Never overwrites an existing env file.
#   bootstrap.sh lockdown --turn-off-root-ssh --i-tested-deploy-login
#       NOT run on this project's CX23 (ADR 0007: root keeps key-only SSH); refuses without both flags.
#       Also needs evidence: an "Accepted publickey for deploy" line in the ssh journal since setup.
#       Turns root login and password login off (sshd drop-in, checked with `sshd -t`). Refuses until
#       `deploy` has an authorized key and a sudo password, so nobody is locked out of admin access.
#
# Every step is idempotent. ROOT (tests only) prefixes every path written.
set -Eeuo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=${ROOT:-}
DEPLOY_USER=deploy
SVC_USER=mindcraft-rotn
BOT_RE='^[a-z0-9][a-z0-9-]{0,31}$'
KEY_RE='^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,3}( [^[:cntrl:]]*)?$'
NODE_MAJOR=22   # ADR 0002
# NodeSource's repository signing key. The URL is the one NodeSource's own setup script uses
# (github.com/nodesource/distributions, scripts/deb/setup_22.x: curl ... https://deb.nodesource.com/
# gpgkey/nodesource-repo.gpg.key | gpg --dearmor). NodeSource's README and DEV_README publish no
# fingerprint, and their script checks none. harness-ops downloaded the live key on 2026-11-01 and
# `gpg --show-keys` gave primary fingerprint 6F71F525282841EEDAF851B42F59B5F99B1BE0B4,
# uid "NSolid <nsolid-gpg@nodesource.com>", RSA 2048, created 2016-05-23 (file SHA-256
# b42e0321dabdc24e892115da705cf061167eac12a317f23d329862d0aa0a271d). setup refuses any other key.
readonly NODESOURCE_KEY_FPR_PINNED=6F71F525282841EEDAF851B42F59B5F99B1BE0B4
FPR_FROM_ENV=${NODESOURCE_KEY_FPR:-}
NODESOURCE_KEY_FPR=$NODESOURCE_KEY_FPR_PINNED   # only `setup --allow-fpr-override` takes $NODESOURCE_KEY_FPR instead
NODESOURCE_KEY_URL=https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key
# The OS packages `setup` installs: the whole list, on one line, always with --no-install-recommends.
# .github/workflows/ci-ubuntu-2604.yml reads this exact line and installs exactly these the same way, so CI cannot
# get a library the CX23 lacks through a Recommends chain (G4 step 0 C1, 2026-11-08: CI's git pulled openssh-client
# with its Recommends xauth, and so libx11-6 and libxext6; the CX23's cloud image had openssh-client without xauth).
#   libx11-6, libxext6: gl's prebuilt binding (node_modules/gl/build/Release/webgl.node) needs libX11.so.6 and
#   libXext.so.6 (readelf -d: NEEDED). canvas bundles its own libraries (RUNPATH $ORIGIN) and needs no package.
readonly SETUP_PACKAGES="unattended-upgrades git ufw ca-certificates curl gnupg libx11-6 libxext6"

log()  { echo "[bootstrap] $*" >&2; }
die()  { echo "[bootstrap] ERROR: $*" >&2; exit 1; }
p()    { echo "$ROOT$1"; }   # a path on the target system

# dir_owned MODE OWNER:GROUP PATH
dir_owned() { mkdir -p "$(p "$3")"; chown "$2" "$(p "$3")"; chmod "$1" "$(p "$3")"; }
# file_owned MODE OWNER:GROUP PATH < content. Carriage returns are dropped: a copy made from a
# Windows checkout would otherwise install CRLF scripts (bash fails on them) and env values ending in \r.
file_owned() {
  local f; f=$(p "$3")
  mkdir -p "$(dirname "$f")"
  tr -d '\r' > "$f.tmp.$$"
  chown "$2" "$f.tmp.$$"; chmod "$1" "$f.tmp.$$"
  mv -f "$f.tmp.$$" "$f"
}

require_root_ubuntu() {
  [[ $(id -u) == 0 ]] || die "run as root, from a root SSH login (ssh root@<cx23>, then bash bootstrap.sh ...); setup --ssh-from needs that login, because sudo drops SSH_CONNECTION"
  local osr; osr=$(p /etc/os-release)
  [[ -f $osr ]] && grep -q '^ID=ubuntu$' "$osr" && grep -Eq '^VERSION_ID="(26\.04|24\.04)"$' "$osr" \
    || die "this is for Ubuntu 26.04 (ADR 0007) or 24.04 (see /etc/os-release)"
}

# The system steps the CI container cannot test (ADR 0007), checked on the real server before setup
# changes anything: stop on a mismatch rather than guess.
preflight_system() {
  # The ssh unit is ssh.service on Ubuntu 24.04 and 26.04 (the cx23 probe, test/evidence/cx23/): setup
  # reloads it, and lockdown reads its journal.
  systemctl cat ssh.service > /dev/null 2>&1 \
    || die "there is no ssh.service unit; this bootstrap reloads ssh.service and reads its journal (check the unit name)"
  command -v sshd > /dev/null || die "no sshd on PATH; the SSH steps need sshd -t and sshd -T"
  # The password-login drop-in works only if sshd_config includes sshd_config.d/*.conf.
  grep -Eq '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf[[:space:]]*$' "$(p /etc/ssh/sshd_config)" 2> /dev/null \
    || die "/etc/ssh/sshd_config does not include /etc/ssh/sshd_config.d/*.conf; the password-login drop-in would not be read"
  # sshd -T without -C ignores Match blocks, so a Match block that turns password login back on for some
  # users or addresses would pass the check unseen (#137 re-review nit 3): refuse any Match line, also in
  # the "Match=..." form sshd accepts (#144 review nit 1).
  # Every other Include is refused too: the scan below covers only sshd_config and sshd_config.d/*.conf,
  # so a file included from elsewhere could hide a Match block (#144 review nit 1).
  local cfg matched=() included=() std_include='^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf[[:space:]]*$'
  shopt -s nullglob
  for cfg in "$(p /etc/ssh/sshd_config)" "$(p /etc/ssh/sshd_config.d)"/*.conf; do
    if grep -Eiq '^[[:space:]]*Match([[:space:]=]|$)' "$cfg" 2> /dev/null; then matched+=("${cfg#"$ROOT"}"); fi
    if grep -Ei '^[[:space:]]*Include([[:space:]=]|$)' "$cfg" 2> /dev/null | grep -Eqv "$std_include" \
      || { [[ $cfg != "$(p /etc/ssh/sshd_config)" ]] && grep -Eiq '^[[:space:]]*Include([[:space:]=]|$)' "$cfg" 2> /dev/null; }; then
      included+=("${cfg#"$ROOT"}")
    fi
  done
  shopt -u nullglob
  (( ${#matched[@]} == 0 )) \
    || die "the sshd config has Match blocks (${matched[*]}); sshd -T cannot verify password login under them, so setup does not change anything"
  (( ${#included[@]} == 0 )) \
    || die "the sshd config includes files other than /etc/ssh/sshd_config.d/*.conf (${included[*]}); this check does not read them, so setup does not change anything"
  # ufw opens only port 22, so sshd must listen on 22 and nothing else (#137 review nit 4). sshd -t and
  # -T need the privilege separation folder, which ssh.service creates only while it runs.
  dir_owned 0755 root:root /run/sshd
  local ports
  ports=$(sshd -T 2> /dev/null | awk 'tolower($1) == "port" { print $2 }' | sort -u | tr '\n' ' ') \
    || die "sshd -T failed; cannot check sshd's port"
  [[ $ports == '22 ' ]] || die "sshd listens on port(s) '${ports% }', but ufw will allow only 22; not changing anything"
}

user_exists() { getent passwd "$1" > /dev/null 2>&1; }

# A dotted IPv4 address as a number; fails on anything else (octets read as decimal, even with a leading 0).
ip_to_int() {
  local a b c d o
  [[ $1 =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  a=$((10#${BASH_REMATCH[1]})) b=$((10#${BASH_REMATCH[2]})) c=$((10#${BASH_REMATCH[3]})) d=$((10#${BASH_REMATCH[4]}))
  for o in "$a" "$b" "$c" "$d"; do (( o <= 255 )) || return 1; done
  echo $(( (a << 24) | (b << 16) | (c << 8) | d ))
}

# --ssh-from must contain this SSH session's client address (#137 review): a CIDR that does not (a home
# address that changed, a typo) lets this session live on through ufw's ESTABLISHED rule and then shuts
# out every new SSH login, root included. Without an IPv4 SSH session to check against, it refuses.
check_ssh_from() {
  local cidr=$1 net bits client ni ci mask
  net=${cidr%/*} bits=$((10#${cidr#*/}))
  (( bits <= 32 )) || die "--ssh-from: the prefix /$bits is not 0..32"
  ni=$(ip_to_int "$net") || die "--ssh-from: $net is not an IPv4 address"
  client=${SSH_CONNECTION:-}; client=${client%% *}
  ci=$(ip_to_int "$client") \
    || die "--ssh-from needs this to run in an SSH session over IPv4 (SSH_CONNECTION), to check that the CIDR contains your own address. Run setup from a root SSH login (ssh root@<cx23>), not through sudo: sudo drops SSH_CONNECTION. GO 2 runs without --ssh-from"
  mask=$(( bits == 0 ? 0 : (0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF ))
  (( (ni & mask) == (ci & mask) )) \
    || die "--ssh-from $cidr does not contain this SSH session's client address; it would shut out every new SSH login (root included) once this session ends. GO 2 runs without --ssh-from"
}

# ---------------------------------------------------------------- setup
setup_users() {
  local keyfile=$1 key
  key=$(tr -d '\r' < "$keyfile" | sed -n '/[^[:space:]]/{p;q;}')
  [[ $key =~ $KEY_RE ]] || die "--deploy-key-file must hold one OpenSSH public key line (ssh-ed25519 ... / ssh-rsa ...)"
  [[ $key != *PRIVATE* ]] || die "that is a private key; give the .pub file"

  if ! user_exists "$SVC_USER"; then
    log "creating system user $SVC_USER (no login)"
    useradd --system --home-dir /var/lib/$SVC_USER --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
  fi
  if ! user_exists "$DEPLOY_USER"; then
    log "creating user $DEPLOY_USER"
    useradd --create-home --shell /bin/bash "$DEPLOY_USER"
    passwd --lock "$DEPLOY_USER" > /dev/null   # no password until the human sets one (needed before lockdown)
  fi
  usermod --append --groups sudo,"$SVC_USER" "$DEPLOY_USER"
  dir_owned 0700 "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
  # Append the key if it is missing; never drop keys already there (PR #30 review finding 5).
  local ak; ak=$(p "/home/$DEPLOY_USER/.ssh/authorized_keys")
  if [[ -f $ak ]] && tr -d '\r' < "$ak" | grep -qxF -- "$key"; then
    log "$DEPLOY_USER already has this key"
  else
    { [[ -f $ak ]] && tr -d '\r' < "$ak" | sed '/^$/d'; printf '%s\n' "$key"; } \
      | file_owned 0600 "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
    log "authorized the key for $DEPLOY_USER"
  fi
}

setup_sudoers() {
  local f tmp
  f=$(p /etc/sudoers.d/mindcraft-rotn)
  tmp=$(p /etc/sudoers.d/.mindcraft-rotn.new)
  mkdir -p "$(dirname "$f")"
  cat > "$tmp" <<EOF
# deploy may run only the bot control wrapper without a password (it validates its arguments).
# General sudo for deploy needs deploy's own password, which the human sets before lockdown.
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/local/sbin/mindcraft-rotn-ctl
EOF
  chown root:root "$tmp"; chmod 0440 "$tmp"
  visudo -c -f "$tmp" > /dev/null || { rm -f "$tmp"; die "visudo rejected the sudoers rule"; }
  mv -f "$tmp" "$f"
  # Ubuntu 26.04 ships sudo-rs as sudo (ADR 0007): check that the rule really applies, not only that
  # visudo accepts it (sudo-rs must read /etc/sudoers.d and grant exactly the wrapper without a password).
  local which list
  which=$(sudo --version 2> /dev/null | head -1) || true
  list=$(sudo -l -U "$DEPLOY_USER" 2> /dev/null) || true
  if ! grep -Eq "NOPASSWD:[[:space:]]*/usr/local/sbin/mindcraft-rotn-ctl([[:space:],]|$)" <<< "$list"; then
    rm -f "$f"
    die "sudo (${which:-unknown}) does not show the rule for $DEPLOY_USER after install (sudo -l -U $DEPLOY_USER); removed it"
  fi
  log "sudoers: $DEPLOY_USER may run only mindcraft-rotn-ctl without a password (${which:-sudo})"
}

setup_packages() {
  log "apt (no recommends): $SETUP_PACKAGES"
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  # shellcheck disable=SC2086 # the list splits into package names on purpose
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends $SETUP_PACKAGES
  # Ubuntu's 50unattended-upgrades already limits automatic upgrades to the security pocket.
  file_owned 0644 root:root /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
}

setup_node() {
  local tmpkey fpr
  tmpkey=$(p /tmp/nodesource-key.$$)
  mkdir -p "$(dirname "$tmpkey")"
  curl -fsSL --proto '=https' --tlsv1.2 -o "$tmpkey" "$NODESOURCE_KEY_URL" || die "could not download the NodeSource key"
  fpr=$(gpg --show-keys --with-colons "$tmpkey" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }')
  if [[ ${fpr^^} != "${NODESOURCE_KEY_FPR^^}" ]]; then
    rm -f "$tmpkey"
    die "NodeSource key fingerprint is '${fpr:-none}', expected $NODESOURCE_KEY_FPR. If NodeSource really rotated its key, the lead decides; then rerun with NODESOURCE_KEY_FPR=<new> and --allow-fpr-override."
  fi
  mkdir -p "$(p /etc/apt/keyrings)"
  gpg --dearmor --yes -o "$(p /etc/apt/keyrings/nodesource.gpg)" "$tmpkey"
  rm -f "$tmpkey"
  chmod 0644 "$(p /etc/apt/keyrings/nodesource.gpg)"
  file_owned 0644 root:root /etc/apt/sources.list.d/nodesource.list <<EOF
deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main
EOF
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends nodejs
  local v; v=$(node --version)
  [[ $v == v$NODE_MAJOR.* ]] || die "node --version is '$v', expected v$NODE_MAJOR.x"
  log "node $v"
}

setup_swap() {
  local size=$1 sf; sf=$(p /swapfile)
  if [[ -n $(swapon --show --noheadings) ]]; then log "swap already on; leaving it"; return 0; fi
  log "creating $size swap at /swapfile"
  [[ -e $sf ]] || fallocate -l "$size" "$sf"
  chmod 0600 "$sf"
  mkswap "$sf" > /dev/null
  swapon "$sf"
  grep -qs '^/swapfile ' "$(p /etc/fstab)" || echo '/swapfile none swap sw 0 0' >> "$(p /etc/fstab)"
  file_owned 0644 root:root /etc/sysctl.d/60-mindcraft-rotn-swap.conf <<'EOF'
vm.swappiness=10
EOF
  sysctl --quiet --load "$(p /etc/sysctl.d/60-mindcraft-rotn-swap.conf)"
}

setup_firewall() {
  local from=$1
  # Allow SSH before enabling, so the running session survives.
  ufw default deny incoming > /dev/null
  ufw default allow outgoing > /dev/null
  if [[ -n $from ]]; then
    ufw allow proto tcp from "$from" to any port 22 > /dev/null
    # A re-run with --ssh-from after an open setup: drop the open rule, after adding the narrow one
    # (PR #30 review finding 5). Established sessions are not cut. No error if there is none.
    ufw delete allow 22/tcp > /dev/null 2>&1 || true
  else
    ufw allow 22/tcp > /dev/null
  fi
  # Never enable a firewall whose SSH rule did not take (that would cut off the human's root login).
  # `ufw show added` may print an extended rule in its own order, so both orders are accepted.
  local want='ufw allow 22/tcp'
  if [[ -n $from ]]; then
    local f=${from//./\\.}
    want="ufw allow (proto tcp from $f to any port 22|from $f to any port 22 proto tcp)"
  fi
  ufw show added 2> /dev/null | grep -Eqx -- "$want" \
    || die "ufw does not list the SSH rule (ufw show added); not enabling the firewall"
  ufw --force enable > /dev/null
  ufw status 2> /dev/null | grep -qx 'Status: active' || die "ufw is not active after 'ufw --force enable' (ufw status)"
  log "ufw: incoming SSH only${from:+ from $from}"
}

# SSH password login off (the human's decision for GO 2). cloud-init's 50-cloud-init.conf may say
# PasswordAuthentication yes, and sshd keeps the FIRST value it reads, so this drop-in must sort before
# 50-. Root login is not touched: root keeps its key login (prohibit-password).
readonly SSHD_DROPIN=/etc/ssh/sshd_config.d/10-mindcraft-rotn.conf
setup_sshd() {
  local f bak=''
  # sshd -t and -T need the privilege separation folder, which ssh.service creates only while it runs.
  # Made BEFORE the drop-in is written (#137 re-review nit 2): from the write on, every step either
  # passes or puts back what was there, so a failure here cannot leave an unchecked drop-in behind.
  dir_owned 0755 root:root /run/sshd
  f=$(p "$SSHD_DROPIN")
  if [[ -f $f ]]; then bak=$f.bak.$$; cp -p "$f" "$bak"; fi
  # Put back what was there (or nothing) when the new config is rejected or does not take effect.
  restore_dropin() { if [[ -n $bak ]]; then mv -f "$bak" "$f"; else rm -f "$f"; fi; }
  file_owned 0644 root:root "$SSHD_DROPIN" <<'EOF'
# mindcraft-rotn setup (deploy/cx23/bootstrap.sh): no SSH password login (the human's decision, GO 2).
# Root keeps its key login (PermitRootLogin is not set here); deploy's password is for sudo only.
# 10- sorts before cloud-init's 50-cloud-init.conf: sshd keeps the first value it reads.
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
  if ! sshd -t; then
    restore_dropin
    die "sshd -t rejected the config; put back what was there, ssh not reloaded"
  fi
  local eff want
  eff=$(sshd -T) || { restore_dropin; die "sshd -T failed; put back what was there, ssh not reloaded"; }
  for want in 'passwordauthentication no' 'kbdinteractiveauthentication no'; do
    if ! grep -qix -- "$want" <<< "$eff"; then
      restore_dropin
      die "sshd -T does not show '$want' (sshd_config or a file read before $SSHD_DROPIN sets it); put back what was there, ssh not reloaded"
    fi
  done
  [[ -n $bak ]] && rm -f "$bak"
  local root_login; root_login=$(awk 'tolower($1) == "permitrootlogin" { print $2; exit }' <<< "$eff")
  if systemctl is-active --quiet ssh; then
    systemctl reload ssh
    log "sshd: password login off (verified with sshd -T); root login '${root_login:-unknown}' is unchanged; ssh reloaded"
  else
    log "sshd: password login off (verified with sshd -T); root login '${root_login:-unknown}' is unchanged; ssh.service is not running (socket activation), so the next connection reads it"
  fi
}

setup_files() {
  dir_owned 0750 "$DEPLOY_USER:$SVC_USER" /opt/mindcraft-rotn
  dir_owned 0750 "$DEPLOY_USER:$SVC_USER" /opt/mindcraft-rotn/releases
  dir_owned 0750 "$SVC_USER:$SVC_USER" /var/lib/mindcraft-rotn
  dir_owned 0750 "$SVC_USER:$SVC_USER" /var/lib/mindcraft-rotn/bots
  dir_owned 0750 "root:$SVC_USER" /etc/mindcraft-rotn
  dir_owned 0755 root:root /usr/local/lib/mindcraft-rotn
  file_owned 0755 root:root /usr/local/lib/mindcraft-rotn/check-env < "$HERE/check-env.sh"
  file_owned 0755 root:root /usr/local/lib/mindcraft-rotn/check-env-names < "$HERE/check-env-names.sh"
  file_owned 0644 root:root /usr/local/lib/mindcraft-rotn/check-env.mjs < "$HERE/check-env.mjs"
  file_owned 0755 root:root /usr/local/sbin/mindcraft-rotn-ctl < "$HERE/mindcraft-rotn-ctl.sh"
  file_owned 0644 root:root /etc/systemd/system/mindcraft-rotn@.service < "$HERE/mindcraft-rotn@.service"
  file_owned 0644 root:root /etc/mindcraft-rotn/bot.env.example < "$HERE/bot.env.example"
  systemctl daemon-reload
  # lockdown looks for a deploy key login after this moment.
  date -u +%s | file_owned 0644 root:root /etc/mindcraft-rotn/.setup-epoch
}

do_setup() {
  local keyfile='' from='' swap=2G fpr_override=0
  while (( $# )); do
    case $1 in
      --deploy-key-file) keyfile=${2:?}; shift 2 ;;
      --ssh-from) from=${2:?}; shift 2 ;;
      --swap-size) swap=${2:?}; shift 2 ;;
      --allow-fpr-override) fpr_override=1; shift ;;
      *) die "setup: unknown option $1" ;;
    esac
  done
  # The pinned NodeSource fingerprint changes only on purpose: an override needs the env var AND the flag.
  if (( fpr_override )); then
    [[ $FPR_FROM_ENV =~ ^[0-9A-Fa-f]{40}$ ]] || die "--allow-fpr-override needs NODESOURCE_KEY_FPR=<40 hex digits>"
    NODESOURCE_KEY_FPR=$FPR_FROM_ENV
    log "WARNING: NodeSource key fingerprint overridden to $NODESOURCE_KEY_FPR (pinned: $NODESOURCE_KEY_FPR_PINNED)"
  elif [[ -n $FPR_FROM_ENV && ${FPR_FROM_ENV^^} != "$NODESOURCE_KEY_FPR_PINNED" ]]; then
    die "NODESOURCE_KEY_FPR is set but --allow-fpr-override is not; refusing to use an unpinned NodeSource key"
  fi
  [[ -n $keyfile && -f $keyfile ]] || die "setup needs --deploy-key-file FILE (the deploy user's public key)"
  [[ -z $from || $from =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] || die "--ssh-from must be an IPv4 CIDR"
  [[ -z $from ]] || check_ssh_from "$from"
  [[ $swap =~ ^[1-9][0-9]*[MG]$ ]] || die "--swap-size like 2G"
  require_root_ubuntu
  preflight_system
  setup_users "$keyfile"
  setup_sudoers
  setup_packages
  setup_node
  setup_swap "$swap"
  setup_firewall "$from"
  setup_sshd
  setup_files
  log "setup done. SSH password login is OFF; root keeps its key login. Next, as the human:"
  log "  1. in a second terminal: ssh deploy@<cx23>   (key login; must work)"
  log "  2. as root: passwd deploy   (deploy's sudo password; SSH never accepts it)"
  log "  (lockdown, which also turns root login off, is not run on this project's CX23: the human's decision)"
}

# ---------------------------------------------------------------- add-bot
do_add_bot() {
  local bot=${1:-} port='' envf
  shift || true
  while (( $# )); do
    case $1 in
      --mindserver-port) port=${2:?}; shift 2 ;;
      *) die "add-bot: unknown option $1" ;;
    esac
  done
  [[ $bot =~ $BOT_RE ]] || die "usage: bootstrap.sh add-bot BOT (lowercase letters, digits, '-', at most 32)"
  require_root_ubuntu
  user_exists "$SVC_USER" || die "run setup first"
  if [[ -z $port ]]; then
    shopt -s nullglob
    local existing=("$(p /etc/mindcraft-rotn)"/*.env)
    port=$(( 8080 + ${#existing[@]} ))
  fi
  [[ $port =~ ^[0-9]{4,5}$ ]] && (( port >= 1024 && port <= 65535 )) || die "--mindserver-port must be 1024..65535"
  dir_owned 0750 "$SVC_USER:$SVC_USER" "/var/lib/mindcraft-rotn/$bot"
  dir_owned 0700 "$SVC_USER:$SVC_USER" "/var/lib/mindcraft-rotn/$bot/msa"
  envf=/etc/mindcraft-rotn/$bot.env
  if [[ -e $(p "$envf") ]]; then
    log "$envf exists; not touching it"
  else
    # 0600 root:root: systemd reads it as root; the deploy user (in group mindcraft-rotn) and the bot
    # process itself cannot read the OpenRouter key from the file (PR #30 review finding 6).
    sed -e "s/__BOT__/$bot/g" -e "s/__MINDSERVER_PORT__/$port/g" -e 's/\r$//' "$HERE/bot.env.example" \
      | file_owned 0600 root:root "$envf"
    log "wrote $envf (MindServer port $port)"
  fi
  log "next, as the human: put the OpenRouter key into $envf; do the bot's first Microsoft device-code login"
  log "(NEEDS-HUMAN); then: sudo mindcraft-rotn-ctl enable $bot && sudo mindcraft-rotn-ctl start $bot"
}

# ---------------------------------------------------------------- lockdown
do_lockdown() {
  local tested=0 root_off=0
  while (( $# )); do
    case $1 in
      --i-tested-deploy-login) tested=1; shift ;;
      --turn-off-root-ssh) root_off=1; shift ;;
      *) die "lockdown: unknown option $1" ;;
    esac
  done
  # Not run on this project's CX23 (#101, ADR 0007: root keeps key-only SSH). It writes PermitRootLogin
  # no and AllowUsers deploy, which cuts off root's SSH, so it needs a flag of its own (#137 review).
  (( root_off )) \
    || die "lockdown turns root SSH login off (PermitRootLogin no, AllowUsers $DEPLOY_USER); it is not run on this project's CX23 (ADR 0007). Only on the lead's written decision, add --turn-off-root-ssh"
  (( tested )) \
    || die "lockdown turns root and password login off. First log in as deploy in a second terminal, then pass --i-tested-deploy-login"
  require_root_ubuntu
  local ak; ak=$(p "/home/$DEPLOY_USER/.ssh/authorized_keys")
  [[ -s $ak ]] && grep -Eq "$KEY_RE" "$ak" || die "$DEPLOY_USER has no authorized key (run setup)"
  local st; st=$(passwd --status "$DEPLOY_USER" | awk '{ print $2 }')
  [[ $st == P ]] || die "$DEPLOY_USER has no usable password (passwd --status says '$st'); set one with 'passwd $DEPLOY_USER' first, or nobody can sudo after lockdown"
  # Evidence, not just the flag: sshd must have logged a key login for deploy since setup
  # (PR #30 review finding 3). Ubuntu 24.04 and 26.04 log it under ssh.service (preflight_system checks
  # that unit; on 26.04's OpenSSH the per-connection sshd-session process logs it in the same unit);
  # sshd.service is the alias.
  local since ef; ef=$(p /etc/mindcraft-rotn/.setup-epoch)
  since=$(tr -d '\r' < "$ef" 2> /dev/null) && [[ $since =~ ^[0-9]{9,11}$ ]] || die "no setup timestamp in /etc/mindcraft-rotn/.setup-epoch (run setup first)"
  journalctl -u ssh -u sshd --since "@$since" --no-pager -o cat 2> /dev/null \
    | grep -Eq "^Accepted publickey for $DEPLOY_USER from [0-9A-Fa-f.:]+ port [0-9]+ ssh2" \
    || die "no 'Accepted publickey for $DEPLOY_USER' in the ssh journal since setup; log in as $DEPLOY_USER with the key first (ssh $DEPLOY_USER@<cx23>), then rerun lockdown"
  # 00- sorts first in sshd_config.d, and for sshd the first value it reads wins (cloud-init's
  # 50-cloud-init.conf may say PasswordAuthentication yes).
  file_owned 0644 root:root /etc/ssh/sshd_config.d/00-mindcraft-rotn.conf <<EOF
# mindcraft-rotn lockdown (deploy/cx23/bootstrap.sh)
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers $DEPLOY_USER
EOF
  if ! sshd -t; then
    rm -f "$(p /etc/ssh/sshd_config.d/00-mindcraft-rotn.conf)"
    die "sshd -t rejected the config; removed it, nothing changed"
  fi
  systemctl reload ssh
  log "root login and password login are off; only $DEPLOY_USER with its key can log in"
}

case ${1:-} in
  setup) shift; do_setup "$@" ;;
  add-bot) shift; do_add_bot "$@" ;;
  lockdown) shift; do_lockdown "$@" ;;
  *) die "usage: bootstrap.sh setup --deploy-key-file FILE [--ssh-from CIDR] [--swap-size 2G] [--allow-fpr-override] | add-bot BOT [--mindserver-port N] | lockdown --turn-off-root-ssh --i-tested-deploy-login (not on this CX23)" ;;
esac
