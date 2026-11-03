# CX23 bot runtime: bootstrap, unit, deploy (brief deliverable 5)

Everything here runs **on the bot's CX23** (Ubuntu 26.04, ADR 0007; `bootstrap.sh` still accepts 24.04). Nothing in this folder connects to the CX23 from the PC, and no agent logs in to it: the first steps need the human's root login.

So far these files are **tested offline only** (`test/unit/cx23.test.js`, with fake system commands, plus `shellcheck` and `systemd-analyze verify` in CI). The first real run, the 2-hour soak and the G4 acceptance run come later, with the lead's approval.

| File | Installed as | What it does |
| --- | --- | --- |
| `bootstrap.sh` | (run from a copy of this folder) | One-time setup as root: `setup`, `add-bot`, `lockdown`. |
| `mindcraft-rotn@.service` | `/etc/systemd/system/` | The unit template, one instance per bot (`mindcraft-rotn@<bot>`). |
| `check-env-names.sh` | `/usr/local/lib/mindcraft-rotn/check-env-names` | First `ExecStartPre`, **as root** (`+`; the env file is `root:root` 0600): only allowlisted variable names in the env file. |
| `check-env.sh`, `check-env.mjs` | `/usr/local/lib/mindcraft-rotn/check-env`, `check-env.mjs` | `ExecStartPre`: refuses to start a bot on an unsafe environment. |
| `mindcraft-rotn-ctl.sh` | `/usr/local/sbin/mindcraft-rotn-ctl` | The only command `deploy` may run with sudo: start/stop/restart/status of one bot unit. |
| `bot.env.example` | `/etc/mindcraft-rotn/<bot>.env` (via `add-bot`) | Per-bot settings: token-cache folder, OpenRouter key placeholder, profile, ports. |
| `deploy.sh` | (run as `deploy` from a copy) | Tag-based deploy, automatic rollback on a failed health check, manual rollback. |

## One-time bootstrap (human, with the root login)

1. Copy this folder to the server: `scp -r deploy/cx23 root@<cx23>:/root/cx23`. Also copy the `deploy` user's **public** key (`deploy.pub`).

   **From a Windows checkout** (`core.autocrlf=true`): every file here must reach the server with LF line ends.
   - `deploy/.gitattributes` sets `eol=lf` for all of `deploy/cx23/`, so a fresh checkout is fine.
   - **A checkout made before that rule** (before 2026-11-03) may still hold CRLF copies, and git does not rewrite them on its own. Copy from git instead of the working tree, in Git Bash: `mkdir -p /tmp/cx23-copy && git archive HEAD deploy/cx23 | tar -x -C /tmp/cx23-copy`, then `scp -r /tmp/cx23-copy/deploy/cx23 root@<cx23>:/root/cx23`.
   - **To check a copy**, run `grep -rlI $'\r' deploy/cx23`. It must print nothing.
   - **In CI,** `test/unit/deploy-eol.test.js` checks both the attribute and the files.
2. `bash /root/cx23/bootstrap.sh setup --deploy-key-file /root/deploy.pub`.

   **GO 2 runs without `--ssh-from`** (#137 review): SSH stays open to all addresses, by key only.
   - A narrow rule ties SSH to one address. If that address changes later (a home IP, for example), every new SSH login is shut out, root's included. The current session lives on, so the lockout only shows the next day.
   - If `--ssh-from <CIDR>` is ever used, setup refuses a CIDR that does not contain this SSH session's own client address (from `SSH_CONNECTION`), and refuses outright outside an IPv4 SSH session. Run it from a root SSH login, not through `sudo`, which drops `SSH_CONNECTION`.

   **Checks before it changes anything.** A mismatch stops setup with a message:
   - the OS is Ubuntu 26.04 or 24.04;
   - there is an `ssh.service` unit (setup reloads it, and lockdown reads its journal);
   - `sshd` is installed;
   - `/etc/ssh/sshd_config` includes `/etc/ssh/sshd_config.d/*.conf`;
   - `sshd -T` reports port 22 and no other, since ufw opens only 22;
   - no `Match` block in `sshd_config` or `sshd_config.d/*.conf`. `sshd -T` without `-C` ignores Match blocks, so it could not verify password login under one.
   - no `Include` other than Ubuntu's own `Include /etc/ssh/sshd_config.d/*.conf` in `sshd_config`, and none in a drop-in. This check reads only those files, so a file included from elsewhere could hide a Match block.

   These are the system steps that the Ubuntu 26.04 CI job (`.github/workflows/ci-ubuntu-2604.yml`) cannot test in a container.

   This step:
   - creates `deploy` (key login; groups `sudo` and `mindcraft-rotn`) and the system user `mindcraft-rotn` (no login, home `/var/lib/mindcraft-rotn`);
   - turns on unattended **security** upgrades (`20auto-upgrades`; Ubuntu's default `50unattended-upgrades` limits them to the security pocket);
   - sets ufw to deny incoming except SSH. It allows SSH *before* enabling ufw, so the session survives. It also checks that the SSH rule is listed (`ufw show added`) before enabling, and that `ufw status` is active afterwards; a mismatch stops setup;
   - adds a 2 GB `/swapfile` (with `vm.swappiness=10`) if no swap exists;
   - installs **Node 22** from NodeSource's apt repo, then git. The repo key's fingerprint is pinned (see "NodeSource key" below), and setup refuses on a mismatch. Changing the pin needs both `NODESOURCE_KEY_FPR=<new>` and `--allow-fpr-override`;
   - installs a sudoers rule letting `deploy` run only `mindcraft-rotn-ctl` without a password. It is checked twice:
     - with `visudo -c` before it goes in place;
     - with `sudo -l -U deploy` afterwards, because Ubuntu 26.04 ships **sudo-rs** as `sudo`.

     If sudo does not show the rule, setup removes it and stops;
   - **turns SSH password login off** (the human's decision for GO 2) with `/etc/ssh/sshd_config.d/10-mindcraft-rotn.conf`, which sets `PasswordAuthentication no` and `KbdInteractiveAuthentication no`.
     - The file name must sort before cloud-init's `50-cloud-init.conf` (which may say `PasswordAuthentication yes`), because sshd keeps the first value it reads.
     - Setup runs `sshd -t`, then checks the effective values with `sshd -T`, and only then reloads ssh.
     - If either check fails, it puts back what was there, so sshd is never left half-configured.
     - `PermitRootLogin` is not touched: root keeps its key login (`prohibit-password`);
   - installs the unit, `check-env` and `mindcraft-rotn-ctl`;
   - creates `/opt/mindcraft-rotn` (`deploy:mindcraft-rotn`, 0750), `/var/lib/mindcraft-rotn` and `/etc/mindcraft-rotn` (`root:mindcraft-rotn`, 0750).

   After `setup`, SSH password login is **off**, and root login by key stays **on**.

   Re-running `setup` is safe. It appends a missing key to `deploy`'s `authorized_keys` and never drops keys already there. With `--ssh-from`, it adds the narrow SSH rule and then removes an earlier open `22/tcp` rule.
3. In a **second** terminal: `ssh deploy@<cx23>`. It must work.
4. As root: `passwd deploy`. This is `deploy`'s own **sudo** password. SSH never accepts it, because password login is off.
5. **There is no step 5 on this project's CX23.** `bootstrap.sh` also has a `lockdown` subcommand. **It is not run here:** by the human's decisions on #101 and ADR 0007, root keeps key-only SSH (`PermitRootLogin prohibit-password`).
   - **What it would do:** write `/etc/ssh/sshd_config.d/00-mindcraft-rotn.conf` with `PermitRootLogin no` and `AllowUsers deploy`, which cuts off root's SSH.
   - **Why it is hard to run by accident:** it refuses unless it gets an explicit flag of its own that names that effect, *and* `deploy` has a key and a sudo password, *and* the ssh journal shows a real key login for `deploy` since setup.
   - Its usage is in the header of `bootstrap.sh`. It runs only on the lead's written decision.

## Each bot

1. `bash bootstrap.sh add-bot <bot>` (as root, or as `deploy` with `sudo`). It creates:
   - `/var/lib/mindcraft-rotn/<bot>/` with the token cache `msa/` at **0700**, owned by `mindcraft-rotn`;
   - `/etc/mindcraft-rotn/<bot>.env` (**`root:root`, 0600**), from `bot.env.example`. systemd reads it as root, so neither `deploy` nor the bot process can read the OpenRouter key from the file. The MindServer port is 8080, 8081 and so on.

   It never overwrites an existing env file.
2. **Human:** put the bot's OpenRouter key into the env file on the server, and fill in the Minecraft host. The key never goes into the repo or a chat.
3. **Human (NEEDS-HUMAN):** do the bot's first Microsoft device-code login into its `msa/` folder, with `msa-login.mjs` (the command is under "Not verified yet" below). It needs a deployed release. Agents never handle the code, the password or the token cache.
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
- **A release is refused unless its `settings.js`, imported with node like `main.js` does, has `allow_insecure_coding === false`.** The import runs with an empty environment.
- `current` switches in one rename. Only the bots that are **enabled** are restarted, through `sudo -n mindcraft-rotn-ctl`.
- If any of them is not active after `HEALTH_WAIT_S` (45 s), the script switches back to the previous release and restarts the bots on it. It then exits 1.
- `state` (`current=`, `previous=`) is the source of truth. `deploys.log` gets one line per deploy or rollback. The newest `KEEP_RELEASES` (5) releases are kept, never current or previous. A `mkdir` lock stops two deploys at once.

## Safety rules built in

- **No insecure coding, values parsed, not grepped.** `check-env.mjs` reads the bot's environment the way `main.js` does:
  - `INSECURE_CODING` and `BLOCKED_ACTIONS` refuse when set at all, even empty. `main.js` turns on `allow_insecure_coding` for any non-empty `INSECURE_CODING`, and `BLOCKED_ACTIONS` would replace `settings.js`'s list.
  - `SETTINGS_JSON` is parsed with `JSON.parse`, so escaped keys such as `allow_insecure_coding` are decoded first. Only `auth` (`"microsoft"`), `host`, `port` and `auto_open_ui` (`false`) are allowed; any other key refuses.
  - A `DEBUG` that could enable prismarine-auth refuses, because that output prints tokens. The rule is forge-bridge's own `debugValueEnables`, loaded from the release.
  - `NODE_OPTIONS` may hold only `--max-old-space-size=N`, and the checker itself runs without the env file's `NODE_OPTIONS` and `NODE_PATH`.
  - The checker's tool paths are fixed or given as flags, never taken from the environment.
  - `deploy.sh` refuses a release whose `settings.js` does not evaluate to `allow_insecure_coding === false`.
- **Only allowlisted names in the env file.** `check-env-names` runs as root and reads only the env file. Every line must be a comment, blank, or `NAME=value` with NAME one of `MINDCRAFT_PROFILES_FOLDER`, `OPENROUTER_API_KEY`, `PROFILES`, `SETTINGS_JSON`, `MINECRAFT_PORT`, `MINDSERVER_PORT` or `NODE_OPTIONS` (the names in `bot.env.example`). Anything else refuses, including `NODE_TLS_REJECT_UNAUTHORIZED`, the proxy variables, `LD_PRELOAD`, `NODE_EXTRA_CA_CERTS`, `export NAME=` and line continuations. It prints names and line numbers, never values.
  - A second layer: `check-env.mjs` also refuses those names in the bot's **effective** environment, whatever their source: `NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_EXTRA_CA_CERTS`, `NODE_PATH`, the `LD_*` loader variables, every `*_PROXY` (either case) and `NODE_DEBUG`.
- **Token cache.** `check-env` refuses if `MINDCRAFT_PROFILES_FOLDER` is unset, relative, not a directory, not 0700, or not owned by `mindcraft-rotn`.
- **Env file.** It must be root-owned and 0600 (or 0400). A placeholder or empty OpenRouter key refuses. `check-env` never prints a variable's value.
- **Single-bot service.** The unit sets `MINDCRAFT_SINGLE_BOT_SERVICE=1`, and `check-env` refuses an env file that changes it. So a clean stop ends the process with 0 (ADR 0003 decision 5).
- **Restarts.**
  - `Restart=always` with `RestartPreventExitStatus=0 3`: exit 0 (requested stop) and exit 3 (fatal: mod rejection, ban, not whitelisted, auth needs a human) are never restarted. Anything else is.
  - `StartLimitBurst=6` per 10 min stops crash loops.
- **Narrow sudo.** `deploy` may run only `mindcraft-rotn-ctl` without a password. The wrapper's `systemctl` and `/etc` paths are fixed, and it accepts exactly one action and one bot name matching `^[a-z0-9][a-z0-9-]{0,31}$` with an env file. A sudoers wildcard on `systemctl` would also have matched other units.

## NodeSource key

NodeSource's docs publish no fingerprint. Its own setup script (`scripts/deb/setup_22.x` in github.com/nodesource/distributions) downloads `https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key` without checking one.

harness-ops downloaded that key on 2026-11-01 (file SHA-256 `b42e0321dabdc24e892115da705cf061167eac12a317f23d329862d0aa0a271d`). `gpg --show-keys` gave:
- primary fingerprint **`6F71F525282841EEDAF851B42F59B5F99B1BE0B4`**;
- uid `NSolid <nsolid-gpg@nodesource.com>`;
- RSA 2048, created 2016-05-23.

That is the pin in `bootstrap.sh`.

## Not verified yet

- **The 26.04 system steps on a real server** (ADR 0007). Offline tests with fake commands cover the checks in `setup`, but these have not yet run on a real 26.04:
  - the `ssh.service` unit;
  - `sshd -T`, and the order in which the `sshd_config.d` files are read;
  - sudo-rs's `visudo -c -f` and `sudo -l -U`;
  - `ufw show added` and `ufw status`.

  The probe (`test/evidence/cx23/`) did find `ssh.service` running on cx23, `ufw` 0.36.2 installed, and `/etc/sudoers.d` in place. Each check stops setup on a mismatch, so GO 2 is where they get proven. If one stops setup, the output says which.
- **Resource caps** (`MemoryHigh=1G`, `MemoryMax=1536M`, `--max-old-space-size=768`) are ops.md estimates, to be confirmed in the 2-hour soak.
- **The first device-code login** uses net-forge's `packages/forge-bridge/tools/msa-login.mjs`, the tool already used for the test bot's cache on the PC. It replaces the `login-bot.mjs` sketched in ops.md section 1. On the CX23, after the first deploy, as `deploy` (`ssh -t`): `sudo -u mindcraft-rotn env MINDCRAFT_PROFILES_FOLDER=/var/lib/mindcraft-rotn/<bot>/msa node /opt/mindcraft-rotn/current/packages/forge-bridge/tools/msa-login.mjs <MinecraftName>`, then the same with `--check`. It prints only Microsoft's instructions and the profile name, never a token. It has not been run on a CX23 yet.
