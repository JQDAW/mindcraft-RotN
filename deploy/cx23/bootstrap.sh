#!/usr/bin/env bash
# One-time bootstrap of the bot's CX23 (Ubuntu 24.04), run as root (harness-ops, brief deliverable 5).
# Copy this folder (deploy/cx23/) to the server and run it there; it never connects anywhere except
# the Ubuntu and NodeSource apt mirrors.
#
#   bootstrap.sh setup --deploy-key-file FILE [--ssh-from CIDR] [--swap-size 2G]
#       Users: `deploy` (SSH key login, in groups sudo and mindcraft-rotn) and the system user
#       `mindcraft-rotn` (no login) that runs the bots. Unattended security upgrades. ufw: SSH only.
#       2 GB swap. Node 22 from NodeSource (key fingerprint pinned). git. The unit template, check-env,
#       mindcraft-rotn-ctl, a sudoers rule that lets `deploy` run only mindcraft-rotn-ctl without a
#       password, and the folders under /opt, /etc and /var/lib. Root and password login stay ON.
#   bootstrap.sh add-bot BOT [--mindserver-port N]
#       Per-bot folders (token cache 0700) and /etc/mindcraft-rotn/BOT.env (0640) from bot.env.example.
#       Never overwrites an existing env file.
#   bootstrap.sh lockdown --i-tested-deploy-login
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
# NodeSource's repository signing key (https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key).
# The fingerprint as harness-ops understands NodeSource to publish it; NOT yet verified against a live
# download. setup refuses on a mismatch and prints the downloaded fingerprint, so a wrong pin fails safe.
NODESOURCE_KEY_FPR=${NODESOURCE_KEY_FPR:-6F71F525282841EEDAF851B42F59B5F99B1BE0B4}
NODESOURCE_KEY_URL=https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key

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
  [[ $(id -u) == 0 ]] || die "run as root (sudo bash bootstrap.sh ...)"
  local osr; osr=$(p /etc/os-release)
  [[ -f $osr ]] && grep -q '^ID=ubuntu$' "$osr" && grep -q '^VERSION_ID="24.04"$' "$osr" \
    || die "this is for Ubuntu 24.04 (see /etc/os-release)"
}

user_exists() { getent passwd "$1" > /dev/null 2>&1; }

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
  printf '%s\n' "$key" | file_owned 0600 "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  log "authorized one key for $DEPLOY_USER"
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
}

setup_packages() {
  log "apt: unattended-upgrades, git, ufw, prerequisites"
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q unattended-upgrades git ufw ca-certificates curl gnupg
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
    die "NodeSource key fingerprint is '${fpr:-none}', expected $NODESOURCE_KEY_FPR. Check it against NodeSource's published fingerprint; if theirs changed, set NODESOURCE_KEY_FPR (lead's decision)."
  fi
  mkdir -p "$(p /etc/apt/keyrings)"
  gpg --dearmor --yes -o "$(p /etc/apt/keyrings/nodesource.gpg)" "$tmpkey"
  rm -f "$tmpkey"
  chmod 0644 "$(p /etc/apt/keyrings/nodesource.gpg)"
  file_owned 0644 root:root /etc/apt/sources.list.d/nodesource.list <<EOF
deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main
EOF
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q nodejs
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
  if [[ -n $from ]]; then ufw allow proto tcp from "$from" to any port 22 > /dev/null
  else ufw allow 22/tcp > /dev/null; fi
  ufw --force enable > /dev/null
  log "ufw: incoming SSH only${from:+ from $from}"
}

setup_files() {
  dir_owned 0750 "$DEPLOY_USER:$SVC_USER" /opt/mindcraft-rotn
  dir_owned 0750 "$DEPLOY_USER:$SVC_USER" /opt/mindcraft-rotn/releases
  dir_owned 0750 "$SVC_USER:$SVC_USER" /var/lib/mindcraft-rotn
  dir_owned 0750 "$SVC_USER:$SVC_USER" /var/lib/mindcraft-rotn/bots
  dir_owned 0750 "root:$SVC_USER" /etc/mindcraft-rotn
  dir_owned 0755 root:root /usr/local/lib/mindcraft-rotn
  file_owned 0755 root:root /usr/local/lib/mindcraft-rotn/check-env < "$HERE/check-env.sh"
  file_owned 0755 root:root /usr/local/sbin/mindcraft-rotn-ctl < "$HERE/mindcraft-rotn-ctl.sh"
  file_owned 0644 root:root /etc/systemd/system/mindcraft-rotn@.service < "$HERE/mindcraft-rotn@.service"
  file_owned 0644 root:root /etc/mindcraft-rotn/bot.env.example < "$HERE/bot.env.example"
  systemctl daemon-reload
}

do_setup() {
  local keyfile='' from='' swap=2G
  while (( $# )); do
    case $1 in
      --deploy-key-file) keyfile=${2:?}; shift 2 ;;
      --ssh-from) from=${2:?}; shift 2 ;;
      --swap-size) swap=${2:?}; shift 2 ;;
      *) die "setup: unknown option $1" ;;
    esac
  done
  [[ -n $keyfile && -f $keyfile ]] || die "setup needs --deploy-key-file FILE (the deploy user's public key)"
  [[ -z $from || $from =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] || die "--ssh-from must be an IPv4 CIDR"
  [[ $swap =~ ^[1-9][0-9]*[MG]$ ]] || die "--swap-size like 2G"
  require_root_ubuntu
  setup_users "$keyfile"
  setup_sudoers
  setup_packages
  setup_node
  setup_swap "$swap"
  setup_firewall "$from"
  setup_files
  log "setup done. Root and password login are still ON. Next, as the human:"
  log "  1. in a second terminal: ssh deploy@<cx23>   (must work)"
  log "  2. as root: passwd deploy   (deploy's sudo password)"
  log "  3. bootstrap.sh lockdown --i-tested-deploy-login"
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
    sed -e "s/__BOT__/$bot/g" -e "s/__MINDSERVER_PORT__/$port/g" -e 's/\r$//' "$HERE/bot.env.example" \
      | file_owned 0640 "root:$SVC_USER" "$envf"
    log "wrote $envf (MindServer port $port)"
  fi
  log "next, as the human: put the OpenRouter key into $envf; do the bot's first Microsoft device-code login"
  log "(NEEDS-HUMAN); then: sudo mindcraft-rotn-ctl enable $bot && sudo mindcraft-rotn-ctl start $bot"
}

# ---------------------------------------------------------------- lockdown
do_lockdown() {
  [[ ${1:-} == --i-tested-deploy-login ]] \
    || die "lockdown turns root and password login off. First log in as deploy in a second terminal, then pass --i-tested-deploy-login"
  require_root_ubuntu
  local ak; ak=$(p "/home/$DEPLOY_USER/.ssh/authorized_keys")
  [[ -s $ak ]] && grep -Eq "$KEY_RE" "$ak" || die "$DEPLOY_USER has no authorized key (run setup)"
  local st; st=$(passwd --status "$DEPLOY_USER" | awk '{ print $2 }')
  [[ $st == P ]] || die "$DEPLOY_USER has no usable password (passwd --status says '$st'); set one with 'passwd $DEPLOY_USER' first, or nobody can sudo after lockdown"
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
  *) die "usage: bootstrap.sh setup --deploy-key-file FILE [--ssh-from CIDR] [--swap-size 2G] | add-bot BOT [--mindserver-port N] | lockdown --i-tested-deploy-login" ;;
esac
