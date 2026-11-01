# CX23 bot runtime: bootstrap, unit, deploy (brief deliverable 5)

Everything here runs **on the bot's CX23** (Ubuntu 24.04). Nothing in this folder connects to the CX23 from the PC, and no agent logs in to it: the first steps need the human's root login.

So far these files are **tested offline only** (`test/unit/cx23.test.js`, with fake system commands, plus `shellcheck` and `systemd-analyze verify` in CI). The first real run, the 2-hour soak and the G4 acceptance run come later, with the lead's approval.

| File | Installed as | What it does |
| --- | --- | --- |
| `bootstrap.sh` | (run from a copy of this folder) | One-time setup as root: `setup`, `add-bot`, `lockdown`. |
| `mindcraft-rotn@.service` | `/etc/systemd/system/` | The unit template, one instance per bot (`mindcraft-rotn@<bot>`). |
| `check-env.sh` | `/usr/local/lib/mindcraft-rotn/check-env` | `ExecStartPre`: refuses to start a bot on an unsafe environment. |
| `mindcraft-rotn-ctl.sh` | `/usr/local/sbin/mindcraft-rotn-ctl` | The only command `deploy` may run with sudo: start/stop/restart/status of one bot unit. |
| `bot.env.example` | `/etc/mindcraft-rotn/<bot>.env` (via `add-bot`) | Per-bot settings: token-cache folder, OpenRouter key placeholder, profile, ports. |
| `deploy.sh` | (run as `deploy` from a copy) | Tag-based deploy, automatic rollback on a failed health check, manual rollback. |

## One-time bootstrap (human, with the root login)

1. Copy this folder to the server: `scp -r deploy/cx23 root@<cx23>:/root/cx23`. Also copy the `deploy` user's **public** key (`deploy.pub`).
2. `bash /root/cx23/bootstrap.sh setup --deploy-key-file /root/deploy.pub` (optionally `--ssh-from <your-ip>/32`). This step:
   - creates `deploy` (key login; groups `sudo` and `mindcraft-rotn`) and the system user `mindcraft-rotn` (no login, home `/var/lib/mindcraft-rotn`);
   - turns on unattended **security** upgrades (`20auto-upgrades`; Ubuntu's default `50unattended-upgrades` limits them to the security pocket);
   - sets ufw to deny incoming except SSH. It allows SSH *before* enabling ufw, so the session survives;
   - adds a 2 GB `/swapfile` (with `vm.swappiness=10`) if no swap exists;
   - installs **Node 22** from NodeSource's apt repo. The repo key's fingerprint is pinned, and setup refuses on a mismatch. Then git;
   - installs the unit, `check-env`, `mindcraft-rotn-ctl`, and a sudoers rule (checked with `visudo -c`) letting `deploy` run only `mindcraft-rotn-ctl` without a password;
   - creates `/opt/mindcraft-rotn` (`deploy:mindcraft-rotn`, 0750), `/var/lib/mindcraft-rotn` and `/etc/mindcraft-rotn` (`root:mindcraft-rotn`, 0750).

   Root and password login stay **on** after `setup`.
3. In a **second** terminal: `ssh deploy@<cx23>`. It must work.
4. As root: `passwd deploy`. This is `deploy`'s own sudo password for admin work once root login is off.
5. `bash /root/cx23/bootstrap.sh lockdown --i-tested-deploy-login`. This writes `/etc/ssh/sshd_config.d/00-mindcraft-rotn.conf` (no root login, no passwords, `AllowUsers deploy`). It checks the file with `sshd -t`, then reloads ssh. It refuses if `deploy` has no key or no password.

## Each bot

1. `bash bootstrap.sh add-bot <bot>` (as root, or as `deploy` with `sudo`). It creates:
   - `/var/lib/mindcraft-rotn/<bot>/` with the token cache `msa/` at **0700**, owned by `mindcraft-rotn`;
   - `/etc/mindcraft-rotn/<bot>.env` (`root:mindcraft-rotn`, 0640), from `bot.env.example`. The MindServer port is 8080, 8081 and so on.

   It never overwrites an existing env file.
2. **Human:** put the bot's OpenRouter key into the env file on the server, and fill in the Minecraft host. The key never goes into the repo or a chat.
3. **Human (NEEDS-HUMAN):** do the bot's first Microsoft device-code login into its `msa/` folder (`docs/research/ops.md` section 1). Agents never handle the code, the password or the token cache.
4. `sudo mindcraft-rotn-ctl enable <bot>` and `sudo mindcraft-rotn-ctl start <bot>`.

The MindServer web UI listens on `localhost` only (`src/mindcraft/mindserver.js`). Reach it with `ssh -L 8080:localhost:8080 deploy@<cx23>`.

## Deploy and rollback (as `deploy`)

```bash
bash deploy.sh deploy v0.1.0     # a tag on develop
bash deploy.sh rollback          # back to the previous release
bash deploy.sh status
```

- `repo.git` is a bare clone of the public repo, holding only `develop` and the tags.
- A tag must be **on develop** (`git merge-base --is-ancestor`), or the deploy refuses.
- The release is extracted with `git archive` into `releases/<tag>-<sha12>/`, then `npm ci` runs (with the patch-package postinstall). Its `./bots` links to `/var/lib/mindcraft-rotn/bots`, so memories survive a deploy.
- **A release whose `settings.js` lacks `"allow_insecure_coding": false` is refused.**
- `current` switches in one rename. Only the bots that are **enabled** are restarted, through `sudo -n mindcraft-rotn-ctl`.
- If any of them is not active after `HEALTH_WAIT_S` (45 s), the script switches back to the previous release and restarts the bots on it. It then exits 1.
- `state` (`current=`, `previous=`) is the source of truth. `deploys.log` gets one line per deploy or rollback. The newest `KEEP_RELEASES` (5) releases are kept, never current or previous. A `mkdir` lock stops two deploys at once.

## Safety rules built in

- **No insecure coding.**
  - `check-env` refuses to start a bot if `INSECURE_CODING` is set to anything non-empty: `main.js` turns on `allow_insecure_coding` for any such value.
  - It also refuses if `SETTINGS_JSON` mentions `allow_insecure_coding`.
  - `deploy.sh` refuses a release whose `settings.js` does not have it `false`.
- **Token cache.** `check-env` refuses if `MINDCRAFT_PROFILES_FOLDER` is unset, relative, not a directory, not 0700, or not owned by `mindcraft-rotn`.
- **Env file.** It must be root-owned and 0640/0600. A placeholder or empty OpenRouter key refuses. `check-env` never prints a variable's value.
- **Single-bot service.** The unit sets `MINDCRAFT_SINGLE_BOT_SERVICE=1`, and `check-env` refuses an env file that changes it. So a clean stop ends the process with 0 (ADR 0003 decision 5).
- **Restarts.**
  - `Restart=always` with `RestartPreventExitStatus=0 3`: exit 0 (requested stop) and exit 3 (fatal: mod rejection, ban, not whitelisted, auth needs a human) are never restarted. Anything else is.
  - `StartLimitBurst=6` per 10 min stops crash loops.
- **Narrow sudo.** `deploy` may run only `mindcraft-rotn-ctl` without a password. The wrapper accepts exactly one action and one bot name matching `^[a-z0-9][a-z0-9-]{0,31}$` with an env file. A sudoers wildcard on `systemctl` would also have matched other units.

## Not verified yet

- **The NodeSource key fingerprint** (`NODESOURCE_KEY_FPR` in `bootstrap.sh`) is pinned from what harness-ops understands NodeSource publishes. It has **not** been checked against a live download. If it is wrong, `setup` stops before adding the repo and prints the real fingerprint; the lead then decides.
- **Resource caps** (`MemoryHigh=1G`, `MemoryMax=1536M`, `--max-old-space-size=768`) are ops.md estimates, to be confirmed in the 2-hour soak.
- **The first device-code login** needs a helper (ops.md section 1 sketches `login-bot.mjs`). It is not written yet; it comes with the first real bot.
