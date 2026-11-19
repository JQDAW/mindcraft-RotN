# ADR 0011: The lead deploys releases and resets bot state through the CX23 gate

- Status: accepted
- Date: 2026-11-19
- Author: rotn-lead

## Context

ADR 0009 gave the CX33 dev server a restricted SSH key to `deploy@cx23`. A forced command (`/usr/local/sbin/mindcraft-rotn-ssh-gate`, `deploy/cx23/mindcraft-rotn-ssh-gate.sh`) allows only `status`, `start`, `stop`, `journal` and `metrics` for one bot, through `sudo -n mindcraft-rotn-ctl`. The gate is the only barrier between the key and the full ctl.

Every soak since step 0 has needed the human for three more steps:
- deploying the release tag (`bash ~/deploy.sh deploy <tag>` as `deploy`);
- resetting the bot's Mindcraft state;
- checking or setting the env file's `"host"`.

The first two are mechanical, and each soak waited hours for them. On 2026-11-19 the human asked for the lead to do the deploy operations itself, and chose this scope: deploy, release status and state reset through the gate, with the env file staying the human's.

**What a deploy really does.** `deploy.sh` runs release code: the settings check imports the release's `settings.js`, and `npm ci` runs lifecycle scripts (our `postinstall`, plus every dependency's install scripts). Today it runs as `deploy`, which has two kinds of power over the host:
- It owns its home directory, `authorized_keys` (which holds the forced command) and the shell start-up files that run before the gate.
- Through the sudoers rule it can run every ctl verb without a password: `start`, `enable`, `restart` and the rest.

So a deploy of a bad release can escape the gate, or start the bot without the human's GO. The human's manual deploys ran the same code; the difference is that a human was in the loop.

## Options

1. A normal shell for the lead on the CX23. It removes the gate, and the env file would be within reach.
2. New gate verbs with strict argument checks, in reviewed, checksummed scripts the human installs, with the build moved to a user that has no sudo and owns nothing the gate depends on.
3. Keep everything with the human.

## Decision

Option 2.

### Prerequisites (the human, once, as root, before the new gate is installed)

**Release code never runs as `deploy`.**
- **A build user, `rotn-build`:**
  - a system user with no login shell, no SSH key, no sudo rule, and not in the `sudo` group;
  - it has a real home, `/var/lib/rotn-build` (0700), for npm's cache and git; it is listed in `/etc/cron.deny`;
  - it is **not** in the `mindcraft-rotn` group (so it cannot read the bots' memories);
  - **A release group, `rotn-release`,** with two members: `rotn-build` and the bot user `mindcraft-rotn`. `/opt/mindcraft-rotn` and `releases` become `rotn-build:rotn-release` with mode 2750, and `deploy.sh` sets every file of a build to `rotn-release`. The bot reads its release through that group. (Changed on 2026-11-19 after the human's install: the first design, `rotn-build:mindcraft-rotn` with setgid, failed because canvas's build resets a folder's mode, which drops setgid when a non-member does it, and a non-member can never set the group back. Putting `rotn-build` into `mindcraft-rotn` would also have worked, but would let it read the bots' state.)
- **A root-owned copy of `deploy.sh`,** `root:root 0755` at `/usr/local/lib/mindcraft-rotn/deploy.sh`.
- **One narrow sudoers line:** `deploy ALL=(rotn-build) NOPASSWD: /usr/local/lib/mindcraft-rotn/deploy.sh`, with no `env_keep` and no `SETENV` for it. That is the only way to act as `rotn-build`, and sudo resets the environment. The line allows any arguments, so **`deploy.sh` checks its own arguments**: run as `rotn-build`, it accepts only `status`, `--no-restart deploy TAG` and the no-build check, and refuses `rollback` and any `deploy` without `--no-restart`.
- **Every deploy goes through the build user, the human's too.** `/home/deploy/deploy.sh` is retired (removed), and the README's manual step becomes `sudo -u rotn-build /usr/local/lib/mindcraft-rotn/deploy.sh --no-restart deploy TAG`. Release code never runs as `deploy` again. Restarting enabled bots after G4 becomes a separate ctl step, defined when the bots are enabled.
- **A build mode in `deploy.sh`** (`--no-restart`) that never calls the ctl. Restarts are not needed, because the gate refuses `deploy` while any bot is enabled. `rotn-build` has no ctl rights, so it could not restart a bot anyway.

**Effect.** As `deploy`, the gate runs only fixed root-owned scripts (the gate itself, `sudo -n` ctl, and `sudo -n -u rotn-build` deploy.sh), and never release code. Release code runs only as `rotn-build`. It can change the release tree (which is the bot's code in any case), but it cannot touch `deploy`'s files or keys, and it cannot run the ctl.

**Optional hardening:**
- the gate runs the build under `systemd-run --uid=rotn-build --wait --collect` (or kills leftover `rotn-build` processes after it), so release code cannot leave a process behind that changes the tree after the deploy;
- a root-owned `authorized_keys` (`Match User deploy` / `AuthorizedKeysFile /etc/ssh/authorized_keys/%u`, in its own `sshd_config.d` drop-in ending with `Match all`, checked with `sshd -T -C user=deploy,...`);
- a root-owned `/home/deploy`.

harness-ops writes the steps into `deploy/cx23/README.md` with a check command for each, and updates `bootstrap.sh` to match. The checks include:
- `id rotn-build`;
- `sudo -l -U rotn-build` showing no rules;
- `stat` of the copy of deploy.sh;
- `sudo -l -U deploy` showing exactly the two rules, and no `env_keep` or `SETENV` on the second;
- `passwd -S rotn-build` showing a locked password;
- `stat` of `/opt/mindcraft-rotn` showing `rotn-build rotn-release 2750`;
- `getent group rotn-release` listing exactly `rotn-build,mindcraft-rotn`, and `id -gn rotn-build` showing `rotn-build` (its primary group stays its own);
- `sudo -u mindcraft-rotn test -r /opt/mindcraft-rotn/current/main.js` succeeding.

**Migration of an existing tree** (the first install already ran): `build-user` runs `chown -R -P rotn-build:rotn-release /opt/mindcraft-rotn` (releases and `repo.git` from earlier deploys are owned by `deploy` or part by `rotn-build`), so `prune`, `state`, `deploys.log` and `repo.git` stay writable for `rotn-build`. `deploy` itself is in neither group and loses read access to `/opt`; that is intended (`release` runs as `rotn-build`), so do not add `deploy` to `rotn-release`.

### The new gate requests

| Request | Runs | Checks |
| --- | --- | --- |
| `deploy TAG` | `sudo -n -u rotn-build /usr/local/lib/mindcraft-rotn/deploy.sh --no-restart deploy TAG` (sudo gives a clean environment: no `ROOT`, repo URL or timing overrides; the script sets a fixed `PATH` that includes `node`, `npm` and `git`) | TAG matches `^rotn-v[0-9]+\.[0-9]+\.[0-9]+$` exactly (deliberately stricter than `deploy.sh`'s TAG_RE, which allows a suffix: do not align them). The gate **refuses if any bot is enabled** (via `ctl list` / `is-enabled`): an enabled bot comes back on its own after a reboot and joins whatever its env file names, which the human's start GO must cover. It also **refuses while any bot is running** (`ctl is-active` answers anything but `inactive` or `failed`): the unit runs from `current` with `Restart=always`, so a deploy during a soak would put the new release into the running bot at its next restart, with no GO for that code (added after the #485 review). `deploy.sh` checks that the tag is on a freshly fetched `develop`. |
| `deploy-check TAG` | the same `sudo -u rotn-build` call in a no-build mode: fetch, then check the tag is on `develop` and print its commit | The same TAG check. A dry run. |
| `release` | `sudo -n -u rotn-build /usr/local/lib/mindcraft-rotn/deploy.sh status` | Read-only. |
| `reset-state BOT NAME` | `sudo -n mindcraft-rotn-ctl reset-state BOT NAME` | BOT is the unit name (the existing regex). NAME is the Mindcraft profile name, `^[A-Za-z0-9_]{1,16}$` (for this bot, unit `frcfld`, profile `FRCFLD`). |

**The gate logs the result of a deploy.** For `deploy`, the gate does not `exec`: it runs `deploy.sh`, then logs `deploy TAG exit=N` under `rotn-ssh-gate`. The root-owned journal is the record, because release code can rewrite `deploys.log` (owned by `rotn-build`).

### `reset-state` in the ctl (runs as root over a tree the bot user can write)

- **Scope.** It works on `/var/lib/mindcraft-rotn/bots/<NAME>/`, Mindcraft's per-agent folder (named after the profile's `"name"`).
- **Kept:** `action-code`, `histories` and `last_profile.json`. Every other entry is moved (for example `memory.json`, `agenda.json`, `control.json`, `tasks.json`, `screenshots/`).
- **Never touched:** the Microsoft token cache, `/var/lib/mindcraft-rotn/<bot>/msa`, which is outside this folder.
- **Refusals:**
  - unless the unit's ActiveState is `inactive` or `failed`. `activating` (including auto-restart), `active` and `deactivating` are refused;
  - if `bots/<NAME>` is a symlink, or is not a directory owned by `mindcraft-rotn`.
- **Same filesystem only:** it refuses unless `/var/lib/mindcraft-rotn/bots` and the archive parent are on the same device (`stat -c %d`), so `mv` cannot fall back to copy-and-delete. It also refuses if `/var/lib/mindcraft-rotn/bots` itself is a symlink.
- **How entries move:** with `rename(2)` only (`mv -T`, never following links), into a new archive directory `/var/lib/mindcraft-rotn-archive/<bot>-<UTC timestamp>/`. The parent `/var/lib/mindcraft-rotn-archive` is `root:root 0700`, outside the bot user's tree, and the new directory is created with a `mkdir` that fails if it exists.
- **Locking:** the ctl takes a lock that `start` also takes, so a start cannot race a reset.
- **Nothing is deleted.** It prints what remains and the archive path. The human can restore an archive by hand.

### The env file stays the human's

No verb reads or writes `/etc/mindcraft-rotn/<bot>.env`. A bot `start` still needs the human's GO confirming that the env file's `"host"` names a disposable test server. The lead must not confirm its own change, so this stays the one human step per soak.

### When the lead uses the new verbs

- `deploy`: under a written lead GO naming the tag, for a tag the lead created on `develop` after CI passed (or, as a rollback, an earlier tag), with no bot enabled or running. Afterwards it runs `release`, and records the tag, the SHA and the time in `coord/STATUS-rotn-lead.md`.
- `reset-state`: under the soak's GO, with the bot stopped.
- A refused request in the gate's log is still an incident, reported to the human.

## Consequences

- **harness-ops** writes:
  - the gate changes;
  - the ctl's `reset-state` verb;
  - `deploy.sh`'s `--no-restart` and no-build modes;
  - `bootstrap.sh` and the README for the build user;
  - the README prerequisites and install steps.

  The unit tests use fakes and cover:
  - word counts, the tag, bot and name regexes, and no `eval` or expansion;
  - `deploy` refused while any bot is enabled or running (the printed `is-active` state compared exactly with `inactive` or `failed`; `activating`, `deactivating`, empty output or a ctl error refused);
  - the clean environment, so `MINDCRAFT_ROTN_REPO_URL` is ignored;
  - the result logged;
  - `reset-state`:
    - refusing every active, activating or deactivating state;
    - refusing a symlinked or foreign-owned folder (or `bots` itself a symlink), and archives on another device;
    - keeping exactly the three entries and never touching `msa`;
    - deleting nothing, with an archive under the root-owned parent.

  An independent review follows.
- **The human** does the prerequisites above (the build user, the ownership change, the sudoers line), installs the reviewed gate, ctl and root-owned `deploy.sh`, and reports their SHA-256 values and the outputs of the check commands, as in step 0. Until then the new verbs do not exist and the human keeps doing these steps.
- **Audit.** The human can see every gate request and every deploy result with `journalctl -t rotn-ssh-gate`, and the current release with `release` (or `deploy.sh status`). The lead's STATUS file lists each deploy.
- **Operations.**
  - A deploy can take minutes (`npm ci` and its retries). The lead runs it with `ssh -o ServerAliveInterval=30`.
  - If the session drops and leaves a stale `.deploy.lock`, the next deploy reports the lock, and the human clears it (rare).
  - There is no `rollback` verb: deploying the previous tag is the rollback.
- **Security, stated plainly.**
  - Through the gate, the key can now put any `rotn-v` tag that is on `develop` into production on the CX23, with no human hand on it. The protection is the review of every `develop` merge, plus the npm and GitHub supply chain.
  - A bad release runs its code as `rotn-build`, during the build, and later as the bot (`mindcraft-rotn`) when the human's GO starts it. It cannot escape the gate or run the ctl, so it cannot start the bot by itself.
  - It can misbehave as the bot once started. Release code decides where the bot connects (the env file's `host` is only configuration it reads), and part of the env check comes from the release itself. **What protects the live Minecraft server is the review of `develop`, and the live server's own whitelist**, not the env file alone.
  - While no bot is enabled (all of G4), there is no health check or automatic rollback. A broken release shows up at the next `start`.
  - `reset-state` can move a bot's memory aside, but never deletes it.
- **Rollback of this ADR:** the human reinstalls the previous gate (its SHA-256 is in the step 0 evidence and `coord/STATUS-rotn-lead.md`), which removes the new requests at once. The root-owned prerequisites can stay; they only harden the host.
