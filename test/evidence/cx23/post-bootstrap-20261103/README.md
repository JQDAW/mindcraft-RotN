# CX23 post-bootstrap read-only check (GO 3), 2026-11-03 02:14 UTC

harness-ops ran this on the lead's written GO 3, after GO 2, the human's updates and reboot, and the new Orca environment "cx23 deploy". The server is called **cx23** here; its address appears nowhere.

- **How:** one Orca terminal, as the `deploy` user, in the human's folder workspace `/tmp`:
  `orca terminal create --environment "cx23 deploy" --worktree "path:/tmp" --title cx23-check`.
- **What ran:** only the lead's listed read-only commands, in the listed order, typed one per line. There were no extra markers: no `echo` and no `date` on the server, since those were not on the list.
  - `sudo -n /usr/local/sbin/mindcraft-rotn-ctl status nonexistent-bot` ran last, because `sudo -n -l` had listed the ctl rule.
  - No password was ever entered, nothing was written, and nothing under `~/.ssh` or any env file was read.
- **The terminal:** created 02:14:17, commands sent from 02:14:39 to about 02:16, **closed 02:16:21 UTC** (`ptyKilled: true`). These times were recorded on this PC around the Orca CLI calls; they are not in the capture.
  - The terminal showed no login banner. Only the shell prompt was there when it opened, so the capture starts at the first command.
  - After the close, `orca terminal list` for "cx23 deploy" still showed one other terminal (`term_c12ffc1c...`). It is not this check's, so it was left alone.

**Files:** `check.txt` is the full terminal output, produced from the git-ignored raw capture by `test/tools/redact-evidence.mjs`, with no hand edits. The CI leak check passes.
- The tool keeps loopback and the wildcard (`127.x`, `0.0.0.0`).
- It also turned the uid, gid and empty-comment fields of the two `getent passwd` lines into `<ip>`, because that run of numbers and colons is a valid IPv6 form. The same uids and gids are in the `id` lines just above them.

## Each value against what setup reported (the lead's GO 2 summary)

| What | Setup reported | This check (as `deploy`) | Match |
| --- | --- | --- | --- |
| OS | Ubuntu 26.04 | `26.04.1 LTS (Resolute Raccoon)` | yes |
| Kernel after the reboot | (new kernel expected) | `7.0.0-42-generic`, up 24 min (GO 1 saw `7.0.0-30-generic`) | yes, new |
| Node | v22.23.4 | `node v22.23.4`, `npm 10.9.9`; git 2.53.0 | yes |
| jq, unzip | not installed by setup | `command -v jq unzip` prints nothing: neither is installed. Nothing in `deploy/cx23/` uses them | as expected |
| Users | `deploy` and `mindcraft-rotn` | `deploy` uid 1000 in groups `sudo` and `mindcraft-rotn`; `mindcraft-rotn` uid 999 (a system user), shell `/usr/sbin/nologin`, home `/var/lib/mindcraft-rotn`; `deploy` has `/bin/bash` | yes |
| Folders | as in the README | `/opt/mindcraft-rotn` `deploy:mindcraft-rotn` 0750; `/var/lib/mindcraft-rotn` `mindcraft-rotn:mindcraft-rotn` 0750 (as `bootstrap.sh` creates it; `deploy/cx23/README.md` said `root:mindcraft-rotn` until this PR fixed it); `/etc/mindcraft-rotn` `root:mindcraft-rotn` 0750; `/usr/local/lib/mindcraft-rotn` `root:root` 0755; all from 01:23 (setup) | yes |
| Unit and ctl | installed | `mindcraft-rotn@.service` `root:root` 0644 (2870 bytes); `mindcraft-rotn-ctl` `root:root` 0755 (1999 bytes) | yes |
| Swap | 2 GB | `/swapfile` 2G, 0B used; `free -m`: swap 2047 MB, RAM 3814 MB | yes |
| Disk | | `/dev/sda1` 38G, 4.8G used (14%; GO 1: 6%, before Node and updates) | ok |
| Listening (TCP) | ufw: SSH only | only `0.0.0.0:22` and `[::]:22` are public. The rest is on loopback: `127.0.0.53`/`127.0.0.54:53` (resolved), and `127.0.0.1:6770` and `127.0.0.1:43159` (by inference the Orca server, as in GO 1 but on new ports after the reboot; `ss` ran without `-p`) | yes |
| Services | | `ssh`, `ufw` and `unattended-upgrades` are `active`; `ufw` is `enabled` | yes |
| ufw rules | SSH only | **Not readable as `deploy`:** `ufw status` needs root and was not on the list. Only the active and enabled state is checked here | partly |
| SSH password login | off, verified by `sshd -T` | `10-mindcraft-rotn.conf` is exactly the bootstrap's drop-in: `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, no `PermitRootLogin`. It is the **only** file in `sshd_config.d`; there is no `50-cloud-init.conf` on this image | yes |
| Unattended upgrades | on | `20auto-upgrades`: `Update-Package-Lists "1"`, `Unattended-Upgrade "1"` | yes |
| sudo rule | sudo-rs 0.2.13, the rule installed | `sudo -n -l` lists `(root) NOPASSWD: /usr/local/sbin/mindcraft-rotn-ctl`, and `(ALL : ALL) ALL` from the `sudo` group, which needs `deploy`'s password (H2) | yes |
| The ctl refuses an unknown bot | | `mindcraft-rotn-ctl: no env file for 'nonexistent-bot' (run bootstrap.sh add-bot nonexistent-bot)`: a clean refusal, with no `systemctl` call | yes |

## Findings

- **Everything setup reported holds after the updates and the reboot.**
- **Open, for a later check (both need root):**
  - **the ufw rule list.** `ss` shows nothing public except SSH, which agrees with "SSH only", but it does not show the firewall rules themselves.
  - **`sshd -T` after the reboot.** The drop-in is in place and is the only file in `sshd_config.d`, but the effective `passwordauthentication no` was last verified by setup's `sshd -T`, before the updates and the reboot.
