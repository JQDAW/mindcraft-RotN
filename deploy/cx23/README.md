# CX23 bot runtime: bootstrap, unit, deploy (brief deliverable 5)

Everything here runs **on the bot's CX23** (Ubuntu 26.04, ADR 0007; `bootstrap.sh` still accepts 24.04). Nothing in this folder connects to the CX23 from the PC, and no agent logs in to it: the first steps need the human's root login.

So far these files are **tested offline only** (`test/unit/cx23.test.js`, with fake system commands, plus `shellcheck` and `systemd-analyze verify` in CI). The first real run, the 2-hour soak and the G4 acceptance run come later, with the lead's approval.

| File | Installed as | What it does |
| --- | --- | --- |
| `bootstrap.sh` | (run from a copy of this folder) | One-time setup as root: `setup`, `add-bot`, `lockdown`. |
| `mindcraft-rotn@.service` | `/etc/systemd/system/` | The unit template, one instance per bot (`mindcraft-rotn@<bot>`). |
| `check-env-names.sh` | `/usr/local/lib/mindcraft-rotn/check-env-names` | First `ExecStartPre`, **as root** (`+`; the env file is `root:root` 0600): only allowlisted variable names in the env file. |
| `check-env.sh`, `check-env.mjs` | `/usr/local/lib/mindcraft-rotn/check-env`, `check-env.mjs` | `ExecStartPre`: refuses to start a bot on an unsafe environment. |
| `mindcraft-rotn-ctl.sh` | `/usr/local/sbin/mindcraft-rotn-ctl` | The only command `deploy` may run with sudo: start/stop/restart/status of one bot unit, and the read-only `journal BOT [--since TIME]` and `metrics BOT` for the G4 scenarios (`test/scenarios/g4/PLAN.md`). |
| `mindcraft-rotn-ssh-gate.sh` | `/usr/local/sbin/mindcraft-rotn-ssh-gate` (by the human, from a reviewed tag) | The forced command of the CX33's restricted SSH key to `deploy` (ADR 0009): allows only `status`, `start`, `stop`, `metrics BOT` and `journal BOT [--since TIME]`, runs them through `sudo -n mindcraft-rotn-ctl`, refuses and logs everything else (syslog tag `rotn-ssh-gate`). |
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
   - installs its OS packages, the one list `SETUP_PACKAGES` in `bootstrap.sh` (`unattended-upgrades git ufw ca-certificates curl gnupg libx11-6 libxext6`), with `--no-install-recommends`. `libx11-6` and `libxext6` are there for gl's prebuilt binding (G4 step 0 C1, 2026-11-08). The Ubuntu 26.04 CI job installs exactly that list the same way, read from `bootstrap.sh`, and then checks with `ldd` that every native binding links;
   - installs **Node 22** from NodeSource's apt repo, with no recommends. The repo key's fingerprint is pinned (see "NodeSource key" below), and setup refuses on a mismatch. Changing the pin needs both `NODESOURCE_KEY_FPR=<new>` and `--allow-fpr-override`;
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
   - creates `/opt/mindcraft-rotn` (`deploy:mindcraft-rotn`, 0750), `/var/lib/mindcraft-rotn` and `/var/lib/mindcraft-rotn/bots` (`mindcraft-rotn:mindcraft-rotn`, 0750), and `/etc/mindcraft-rotn` (`root:mindcraft-rotn`, 0750).

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

## The CX33's SSH gate (ADR 0009)

The CX33 dev server reaches `deploy@<cx23>` with one dedicated key, root's on the CX33. Its line in `/home/deploy/.ssh/authorized_keys` has three options. The address is never recorded in the repo:

```
from="<the CX33's IPv4>",restrict,command="/usr/local/sbin/mindcraft-rotn-ssh-gate" ssh-ed25519 AAAA... <comment>
```

**What the gate does:**
- Whatever the client asks for, sshd runs the gate with the request in `SSH_ORIGINAL_COMMAND`.
- The gate matches the whole request, as one string, against fixed anchored patterns. The arguments are the patterns' captures, so the request is never word-split, glob-expanded, `eval`ed or given to a shell.
- **Allowed**, with single spaces and one bot name per `^[a-z0-9][a-z0-9-]{0,31}$`:
  - `status BOT`, `start BOT`, `stop BOT`, `metrics BOT`, `journal BOT`;
  - `journal BOT --since YYYY-MM-DDTHH:MM[:SS][Z]`. This is the ctl's T form, read as UTC. There is no space form, so no quoting is ever needed;
  - `journal BOT --since @EPOCH_SECONDS`.

  Each runs as `sudo -n mindcraft-rotn-ctl ...`, and the ctl checks the name and the time again.
- **Refused:** everything else, **exit 126**, which is distinct from the ctl's own refusal (exit 2), so the harness can tell a gate refusal (an ADR 0009 incident) apart.
  - 126 is also what the shell returns when it finds the gate but cannot execute it (wrong permissions, say). So by exit code alone, a broken install looks like a refusal.
  - To tell them apart: a real refusal prints the gate's fixed stderr line (`rotn-ssh-gate: refused. Allowed: ...`) and writes a `rotn-ssh-gate` syslog entry. A broken install does neither.
  - Refused requests include `restart`, `enable`, `disable`, `list`, `daemon-reload`, an interactive login, `scp` and `sftp`.
  - The client gets one fixed line on stderr, never its own input back.
  - Syslog gets `refused (<why>): '<the request, printable ASCII only, others as ?, at most 200 bytes>' (<length> bytes)` under the tag `rotn-ssh-gate` at `auth.warning`.
  - Allowed requests are logged at `auth.info`.
- **It trusts nothing from the client.** It runs under `bash -p`, with `LC_ALL=C` (sshd passes the client's `LANG`, `LC_*`, `COLORTERM` and `NO_COLOR`), a reset `PATH`, and fixed program paths. sudo resets the environment for the ctl.
- **What the gate itself cannot guard** (#365 review): sshd starts a forced command through `deploy`'s **login shell**, as `$SHELL -c '/usr/local/sbin/mindcraft-rotn-ssh-gate'`, before the gate's own `bash -p`.
  - That shell reads `BASH_ENV` if sshd lets the client set it.
  - Ubuntu's bash also reads `~/.bashrc` when sshd starts it.
  - So the CX23's sshd must accept no client variables except `LANG`, `LC_*`, `COLORTERM` and `NO_COLOR`, with `PermitUserEnvironment no`, and `deploy`'s shell start-up files must be writable by `deploy` only. Step B1 below checks both.
  - `COLORTERM` and `NO_COLOR` are the Debian/Ubuntu openssh package's default (seen on the CX23, G4 step 0 B1, 2026-11-08). They are harmless here: no shell start-up effect, the gate forces `LC_ALL=C`, and sudo resets the environment.
  - **Dangerous are** `BASH_ENV`, `ENV`, any `LD_*`, `PATH`, or a wildcard `*`.
- **Tests:** `test/unit/cx23-ssh-gate.test.js`, offline, with a fake `sudo` and `logger`. It is also covered by shellcheck in CI.

**Install the reviewed copy (human, as root, from a reviewed tag):** see step B1 below. Then report both SHA-256 values to the lead, who compares them with the tag.

**Check it on the CX23 without SSH**, after `add-bot` (B2), as root:
```bash
sudo -u deploy env SSH_ORIGINAL_COMMAND='status frcfld' /usr/local/sbin/mindcraft-rotn-ssh-gate; echo "exit $?"   # the unit's status (3 = inactive)
sudo -u deploy env SSH_ORIGINAL_COMMAND='restart frcfld' /usr/local/sbin/mindcraft-rotn-ssh-gate; echo "exit $?"  # refused: exit 126
journalctl -t rotn-ssh-gate -n 5 --no-pager
```

ADR 0009's rules still apply:
- Agents use only `status` until the human confirms the installed gate matches the reviewed one.
- Every `start` needs the human's GO, confirming that the env file names a disposable test server.
- A refusal in this log is an incident for the human.

## G4 step 0: the first release and first start on the CX23 (human, step by step)

This is `test/scenarios/g4/PLAN.md` step 0. **Nothing secret goes into the repo, a chat or a status file.** The key, the device code and the addresses stay in your own terminals.

**What you need from the lead first:**
- **`<TAG>`:** the lead's release tag on `develop`, which contains this README, the gate and the ctl's `journal`/`metrics`. **`<TAG>` is the release tag named in the lead GO / `coord/NEEDS-HUMAN.md`** (never an upstream `v0.x` tag). Only `rotn-v…` tags deploy: the repo's `v0.x` tags are upstream Mindcraft's.
- **The first-start GO** (for step C3 only): it names the test server, and harness-ops creates that server with `--allow-from <the CX23's IPv4>/32`.

You give the lead the CX23's IPv4 in that GO (H6). Agents do not look it up.

### A. On your own machine: a clean copy of the reviewed folder

```bash
git fetch origin --tags && rm -rf /tmp/cx23-<TAG> && mkdir -p /tmp/cx23-<TAG>
git archive <TAG> deploy/cx23 | tar -x -C /tmp/cx23-<TAG>
grep -rlI $'\r' /tmp/cx23-<TAG>/deploy/cx23      # must print nothing (LF only)
scp -r /tmp/cx23-<TAG>/deploy/cx23 root@<cx23>:/root/cx23-<TAG>
```

### B. On the CX23 as root (`ssh root@<cx23>`, in a terminal titled HUMAN ONLY)

1. **Update the ctl and install the gate.**
   - The ctl on the CX23 dates from GO 3 (2026-11-03), before #326 added `journal` and `metrics`. Nothing else in this folder has changed since.
   ```bash
   install -o root -g root -m 0755 /root/cx23-<TAG>/mindcraft-rotn-ctl.sh /usr/local/sbin/mindcraft-rotn-ctl
   install -o root -g root -m 0755 /root/cx23-<TAG>/mindcraft-rotn-ssh-gate.sh /usr/local/sbin/mindcraft-rotn-ssh-gate
   sha256sum /usr/local/sbin/mindcraft-rotn-ctl /usr/local/sbin/mindcraft-rotn-ssh-gate
   ```
   - Send the lead these two hashes. They must equal `sha256sum deploy/cx23/mindcraft-rotn-ctl.sh deploy/cx23/mindcraft-rotn-ssh-gate.sh` at `<TAG>`.
   - The `authorized_keys` line (above) stays as it is: it already names `/usr/local/sbin/mindcraft-rotn-ssh-gate`.
   - **What runs before the gate** (the login shell, see "What the gate itself cannot guard"):
   ```bash
   sshd -T | grep -Ei '^(acceptenv|permituserenvironment) '   # acceptenv: only LANG, LC_*, COLORTERM, NO_COLOR; permituserenvironment no
   ls -l /home/deploy/.bashrc /home/deploy/.profile /home/deploy/.bash_profile /home/deploy/.bash_login 2>&1   # owned by deploy; no group or other w
   ```
   - **Expected:** `acceptenv` lists only `LANG`, `LC_*`, `COLORTERM` and `NO_COLOR` (the last two are Ubuntu's openssh default and harmless here), and `permituserenvironment no`.
   - **Stop and tell the lead before going on** if `acceptenv` lists any other name, above all `BASH_ENV`, `ENV`, any `LD_*`, `PATH` or a wildcard `*`, or if `permituserenvironment` is not `no`, or if a start-up file is writable by anyone but `deploy`.
2. **The bot:** `bash /root/cx23-<TAG>/bootstrap.sh add-bot frcfld`. It writes `/etc/mindcraft-rotn/frcfld.env` (root:root 0600) and `/var/lib/mindcraft-rotn/frcfld/msa` (0700). Then run the gate check above.
3. **The env file:** `nano /etc/mindcraft-rotn/frcfld.env`. Change three lines and nothing else:
   - `OPENROUTER_API_KEY=` the production key with its credit limit (H4; the key named `mindcraft-rotn-frcfld-cx23`).
   - `PROFILES=["./profiles/rotn-bot.json"]`: FRCFLD's profile is `profiles/rotn-bot.json` (`"name": "FRCFLD"`). The template defaults to it now; an env file written from an older template has `./profiles/frcfld.json`, which does not exist, and `check-env` refuses any profile path the release lacks.
   - `SETTINGS_JSON={"host":"<the test server's IPv4 from the GO>","auto_open_ui":false}`. Until that GO, leave the placeholder: `check-env` then refuses a start.

   Then check, without showing the key:
   ```bash
   stat -c '%U:%G %a' /etc/mindcraft-rotn/frcfld.env           # root:root 600
   grep -c '<set-by-human-never-in-repo>' /etc/mindcraft-rotn/frcfld.env   # 0
   /usr/local/lib/mindcraft-rotn/check-env-names /etc/mindcraft-rotn/frcfld.env && echo names-ok
   ```
4. **`deploy.sh` for `deploy`:** `install -o deploy -g deploy -m 0755 /root/cx23-<TAG>/deploy.sh /home/deploy/deploy.sh`.

### C. On the CX23 as `deploy` (`ssh -t deploy@<cx23>` with the deploy key, HUMAN ONLY)

1. **The first release:**
   ```bash
   bash ~/deploy.sh deploy <TAG>     # clones repo.git once, checks the tag is on develop, npm ci, settings checks
   bash ~/deploy.sh status           # current=<TAG>-<sha12>
   ```
   No bot is enabled yet, so nothing restarts.
2. **FRCFLD's device-code login (H5):**
   - Sign in on Microsoft's page with FRCFLD's account only. Never paste the code anywhere else.
   - `sudo` asks for `deploy`'s password (H2).
   ```bash
   cd /opt/mindcraft-rotn/current
   sudo -u mindcraft-rotn env MINDCRAFT_PROFILES_FOLDER=/var/lib/mindcraft-rotn/frcfld/msa \
     node packages/forge-bridge/tools/msa-login.mjs FRCFLD
   sudo -u mindcraft-rotn env MINDCRAFT_PROFILES_FOLDER=/var/lib/mindcraft-rotn/frcfld/msa \
     node packages/forge-bridge/tools/msa-login.mjs FRCFLD --check; echo "exit $?"   # 0
   ```
   It prints only Microsoft's instructions and the profile name, never a token.
3. **The first start, only with two GOs** (ADR 0009):
   - **the lead's written first-start GO**, which names the test server;
   - **your own GO**, confirming that the env file's `"host"` is that disposable test server and never the live server.

   First, as root, set `"host"` in `SETTINGS_JSON` to that GO's test server (B3).
   - Then, as `deploy`:
   ```bash
   sudo mindcraft-rotn-ctl start frcfld
   sudo mindcraft-rotn-ctl status frcfld
   sudo mindcraft-rotn-ctl journal frcfld --since <the start time, YYYY-MM-DDTHH:MM, UTC>
   sudo mindcraft-rotn-ctl stop frcfld      # when the GO's run is over
   ```
   - **If the start keeps failing:** systemd allows at most 6 starts in 10 minutes (`StartLimitBurst`), then marks the unit failed. Fix the cause (the journal says it), then start again: the ctl's `start` runs `systemctl reset-failed` first (#413, once the human has installed that ctl). With an older ctl, run as root `systemctl reset-failed mindcraft-rotn@frcfld` first, or wait 10 minutes (G4 step 0, 2026-11-08).
   - **Do not `enable` the bot during G4.** An enabled bot comes back after a CX23 reboot and joins whatever the env file names, by then a deleted test server. `start` works without `enable`. `deploy.sh` restarts only enabled bots.
   - `enable` comes after G4, with the live server's host (PLAN.md).

**Each later S run (lead's decision, #365 review):** before each G4 S run's `start`, you set the env file's `"host"` to that run's disposable test server, as in B3. Agents cannot change it, which keeps the live server out of their reach.

## Deploy and rollback (as `deploy`)

```bash
bash deploy.sh deploy rotn-v0.1.0     # a rotn-v release tag on develop
bash deploy.sh rollback          # back to the previous release
bash deploy.sh status
```

- `repo.git` is a bare clone of the public repo, holding only `develop` and the tags.
- **Only this fork's release tags:** `rotn-vX.Y.Z`, optionally with a suffix (`rotn-v0.1.0-rc.1`). Anything else is refused before the clone.
  - The repo also carries upstream Mindcraft's `v0.x` tags, and upstream `v0.1.0` is an ancestor of `develop`.
  - So `deploy v0.1.0` would pass the on-develop check and deploy plain Mindcraft without RotN. The lead found this at the first release, `rotn-v0.1.0`.
- A tag must be **on develop** (`git merge-base --is-ancestor`), or the deploy refuses.
- The release is extracted with `git archive` into `releases/<tag>-<sha12>/`, then `npm ci` runs (with the patch-package postinstall). Its `./bots` links to `/var/lib/mindcraft-rotn/bots`, so memories survive a deploy.
- The release's tracked `bots/` templates are replaced by that link. They are unused while `allow_insecure_coding` is false: since #410 the Coder reads them only on its first code generation.
- **A release is refused unless its `settings.js`, imported with node like `main.js` does, has `allow_insecure_coding === false`.** The import runs with an empty environment.
- **The task-giver settings are checked the same way** (#146, #157 review). A release is refused if its `settings.js` turns on skills-rotn's test-only `allow_server_task_giver` (anything but `false` or absent), or names the console sender `Server` in any task-giver list. Only the G3 driver turns that switch on, on a test server; on the CX23, `check-env` also refuses it in `SETTINGS_JSON`.
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
- **Narrow sudo.** `deploy` may run only `mindcraft-rotn-ctl` without a password. The wrapper's `systemctl` and `/etc` paths are fixed, and every per-bot action takes one bot name matching `^[a-z0-9][a-z0-9-]{0,31}$` with an env file, and nothing more (`journal` alone also takes an optional `--since TIME`). The read-only `journal` (journalctl on that unit only, UTC, the newest 20000 lines and at most the first 8 MiB of them, a cut noted on stderr; `--since` only as a real `YYYY-MM-DD HH:MM[:SS]`, `YYYY-MM-DDTHH:MM[:SS][Z]` or `@EPOCH`) and `metrics` (`systemctl show` of MemoryCurrent, MemoryPeak, NRestarts and ActiveState only) take nothing else; the sudoers rule is unchanged. A sudoers wildcard on `systemctl` would also have matched other units.
- **The journal is sensitive, so the `deploy` SSH key is too.** Through `journal`, `deploy` can read the bot's whole journal: its chat, the LLM's output, a Microsoft device-code prompt, and anything a library prints outside `safeError`. Treat the `deploy` key like a credential for that bot's logs.

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
