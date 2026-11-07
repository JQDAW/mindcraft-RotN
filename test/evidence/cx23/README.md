# CX23 read-only probe (GO 1), 2026-11-02 22:05 UTC

harness-ops ran this on the lead's GO 1, by the terminal route the lead gave once the human had opened a workspace on cx23. The server is called **cx23** here, and its address appears nowhere. The file name carries this PC's local date (2026-11-03); the probe itself started at 2026-11-02T22:05:37Z, as its first line shows.

- **How:** one Orca terminal on the cx23 Orca server, in the workspace the human opened (`/tmp/mindcraft-RotN`, a clone of this fork at develop 997da58; that commit and the folder come from the lead's GO message, which relayed what the human set up, since the probe ran no git command). Command:
  `orca terminal create --environment cx23 --worktree "path:/tmp/mindcraft-RotN" --title cx23-probe`.
- **What ran:** only the approved read-only commands, with `ls -la /root` last. No installs, no writes, no `apt update`, nothing in the clone. Not read: `authorized_keys`, shadow, environment variables, history, `ip addr`, and anything under `<local>/.ssh`.
- **The terminal** was opened at 22:05:21 and closed at 22:06:05 UTC. These times were recorded on this PC when `orca terminal create` and `orca terminal close` ran; they are not in the capture. The capture's own first line shows the probe starting at 22:05:37Z.
- **The human's other workspaces on cx23** were left alone and are only recorded: `/tmp/mindcraft` (the upstream clone) and its Orca worktree `<local>/orca/workspaces/mindcraft/tunicate`. Their two terminals stayed open. This comes from `orca terminal list` after the close, not from the capture.

**Files:** `probe-20261103.txt` is the full terminal output, produced from the git-ignored raw capture by `test/tools/redact-evidence.mjs`, with no hand edits. The CI leak check passes.

- **Addresses:** the tool keeps loopback (`127.x.x.x`) and the wildcard (`0.0.0.0`), which name no host (#128 review), and replaces every other dotted quad with `<ip>`. So the `ss` lines show directly which sockets are loopback-only. The one `<ip>` left is cx23's own address on `eth0` (the DHCP client).
- **Not byte-exact:** the file is the text Orca's terminal read returned. In a few places a space between columns was lost in that transfer: line 186 reads `sysstat.service enabledenabled`. This is cosmetic, and the values are as `systemctl` printed them.

## Findings

| What | cx23 |
| --- | --- |
| OS | **Ubuntu 26.04.1 LTS ("Resolute Raccoon")**, kernel 7.0.0-30-generic. **Not 24.04** (see "Blocking" below) |
| Hardware | 2 vCPU (Intel Xeon Skylake, KVM), 3,814 MB RAM, **no swap**. Location Helsinki (hostname `ubuntu-4gb-hel1-2`) |
| Disk | `/dev/sda1` 38 GB, 2.1 GB used (6%) |
| Time | UTC; chrony running; clock synchronised |
| Listening | **Only SSH (port 22, IPv4 and IPv6 wildcard) is public.** systemd-resolved and chrony are on loopback. A process named "MainThread" listens on ports 6768 and 37233, **both on loopback only** (`127.0.0.1`). That it is the Orca server is an inference: `ss` shows only the thread name, and Orca's server is the only non-system process we know runs on cx23. The DHCP client (UDP 68) is on eth0 |
| Firewall | **None active:** `ufw` is installed but "Status: inactive"; the nft ruleset is empty |
| sshd (effective) | port 22; `permitrootlogin prohibit-password` (root by key only); `pubkeyauthentication yes`; **`passwordauthentication yes`**; `kbdinteractiveauthentication no` |
| Users | root (uid 0) and nobody only; no `/home` |
| sudoers.d | `90-cloud-init-users` (cloud-init's) and `README` |
| Running services | a standard Ubuntu cloud set: atd, chrony, cron, dbus, gettys, multipathd, networkd-dispatcher, polkit, qemu-guest-agent, rsyslog, ssh, systemd-journald/logind/networkd/resolved/timedated/udevd, unattended-upgrades, `user@0` |
| Packages | git 2.53.0 (`/usr/bin/git`); **no Node.js**; ufw 0.36.2; unattended-upgrades 2.12 |
| Unattended upgrades | `20auto-upgrades` already sets `Update-Package-Lists "1"` and `Unattended-Upgrade "1"` |
| Our footprint | none: no `/opt`, `/var/lib` or `/etc` `mindcraft-rotn`, no `deploy` or `mindcraft-rotn` user |
| `/root` | `.bashrc`, `.profile`, `.cache`, `.config`, `.claude`, `.cloud-locale-test.skip`, `.ssh` (not read); Orca's own `.orca`, `.orca-remote` and `orca/` (accepted helper files and the human's Orca workspaces) |

## Blocking for GO 2 (the bootstrap)

`deploy/cx23/bootstrap.sh` checks `/etc/os-release` and **refuses anything but Ubuntu 24.04** ("this is for Ubuntu 24.04"). CLAUDE.md pins "Bot OS: Ubuntu 24.04 on the CX23". So `setup` would stop at once on cx23. The NodeSource apt line uses `nodistro` and would work; the OS check and the pin are what block it.

## What `setup` would change on a 24.04 server, given this state

- **Firewall:** ufw goes from inactive to active, allowing SSH only. Orca reaches cx23 over SSH, and its listeners are loopback-only, so it keeps working.
- **Swap:** a 2 GB swapfile, since there is none now.
- **Node:** Node 22 from NodeSource (none now). git is already there.
- **Users and files:** the `deploy` and `mindcraft-rotn` users, the unit, `check-env`, `mindcraft-rotn-ctl`, the sudoers rule, and the three folders.
- **Unattended upgrades:** `20auto-upgrades` is already the same.
- **Not changed (no lockdown, per the human's decision):** sshd's `PasswordAuthentication yes`. Once H2 gives `deploy` a password, that account could be reached over SSH with it.
