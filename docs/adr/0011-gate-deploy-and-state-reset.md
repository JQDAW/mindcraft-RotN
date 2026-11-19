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

**What a deploy really does.** `deploy.sh` runs release code as `deploy`: the settings check imports the release's `settings.js`, and `npm ci` runs lifecycle scripts (our `postinstall`, plus every dependency's install scripts). Today `deploy` owns the files the gate depends on: `/home/deploy/.ssh/authorized_keys` (which holds the forced command), `deploy`'s shell start-up files (run before the gate), and `/home/deploy/deploy.sh`. So a deploy of a bad release can rewrite `authorized_keys` without the forced command and escape the gate. The human's manual deploys ran the same code; the difference is that a human was in the loop.

## Options

1. A normal shell for the lead on the CX23. It removes the gate, and the env file would be within reach.
2. New gate verbs with strict argument checks, implemented in reviewed, checksummed scripts the human installs, **after** the files the gate depends on are made root-owned.
3. Keep everything with the human.

## Decision

Option 2.

### Prerequisites (the human, once, as root, before the new gate is installed)

- `authorized_keys` for `deploy` moves to a root-owned file. sshd uses `Match User deploy` with `AuthorizedKeysFile /etc/ssh/authorized_keys/%u`, and that file is `root:root 0644`.
- `deploy`'s shell start-up files (`.bashrc`, `.profile`, `.bash_profile`, `.bash_logout` and any others) become `root:root 0644`.
- The copy of `deploy.sh` that the gate runs is installed `root:root 0755` at `/usr/local/lib/mindcraft-rotn/deploy.sh`. The gate never runs `/home/deploy/deploy.sh`.

harness-ops writes these steps into `deploy/cx23/README.md`, with a check command for each. Release code then still runs as `deploy`, but can no longer change how the key is handled or what the gate runs.

**Later hardening, not required now:** run the extract, the settings check and `npm ci` as a separate unprivileged build user that owns nothing the gate relies on.

### The new gate requests

| Request | Runs | Checks |
| --- | --- | --- |
| `deploy TAG` | `/usr/bin/env -i PATH=/usr/bin:/bin HOME=/home/deploy /bin/bash /usr/local/lib/mindcraft-rotn/deploy.sh deploy TAG`, as `deploy`, no sudo, with a clean environment (no `ROOT`, repo URL or timing overrides) | TAG matches `^rotn-v[0-9]+\.[0-9]+\.[0-9]+$` exactly. The gate **refuses if any bot is enabled** (via `ctl list` / `is-enabled`), because `deploy.sh` restarts, and so starts, enabled bots. `deploy.sh` checks that the tag is on a freshly fetched `develop`. |
| `deploy-check TAG` | `deploy.sh` with a no-build mode: fetch, then check the tag is on `develop` and print its commit | The same TAG check. A dry run. |
| `release` | `deploy.sh status`, with the same clean environment | Read-only. |
| `reset-state BOT NAME` | `sudo -n mindcraft-rotn-ctl reset-state BOT NAME` | BOT is the unit name (the existing regex). NAME is the Mindcraft profile name, `^[A-Za-z0-9_]{1,16}$` (for this bot, unit `frcfld`, profile `FRCFLD`). |

**The gate logs the result of a deploy.** For `deploy`, the gate does not `exec`: it runs `deploy.sh`, then logs `deploy TAG exit=N` under `rotn-ssh-gate`. The root-owned journal is the record, because release code can rewrite the deploy-owned `deploys.log`.

### `reset-state` in the ctl (runs as root over a tree the bot user can write)

- **Scope.** It works on `/var/lib/mindcraft-rotn/bots/<NAME>/`, Mindcraft's per-agent folder (named after the profile's `"name"`).
- **Kept:** `action-code`, `histories` and `last_profile.json`. Every other entry is moved (for example `memory.json`, `agenda.json`, `control.json`, `tasks.json`, `screenshots/`).
- **Never touched:** the Microsoft token cache, `/var/lib/mindcraft-rotn/<bot>/msa`, which is outside this folder.
- **Refusals:**
  - unless the unit's ActiveState is `inactive` or `failed`. `activating` (including auto-restart), `active` and `deactivating` are refused;
  - if `bots/<NAME>` is a symlink, or is not a directory owned by `mindcraft-rotn`.
- **How entries move:** with `rename(2)` only (`mv -T`, never following links), into a new archive directory `/var/lib/mindcraft-rotn-archive/<bot>-<UTC timestamp>/`. The parent `/var/lib/mindcraft-rotn-archive` is `root:root 0700`, outside the bot user's tree, and the new directory is created with a `mkdir` that fails if it exists.
- **Locking:** the ctl takes a lock that `start` also takes, so a start cannot race a reset.
- **Nothing is deleted.** It prints what remains and the archive path. The human can restore an archive by hand.

### The env file stays the human's

No verb reads or writes `/etc/mindcraft-rotn/<bot>.env`. A bot `start` still needs the human's GO confirming that the env file's `"host"` names a disposable test server. The lead must not confirm its own change, so this stays the one human step per soak.

### When the lead uses the new verbs

- `deploy`: under a written lead GO naming the tag, for a tag the lead created on `develop` after CI passed (or, as a rollback, an earlier tag), with no bot enabled. Afterwards it runs `release`, and records the tag, the SHA and the time in `coord/STATUS-rotn-lead.md`.
- `reset-state`: under the soak's GO, with the bot stopped.
- A refused request in the gate's log is still an incident, reported to the human.

## Consequences

- **harness-ops** writes:
  - the gate changes;
  - the ctl's `reset-state` verb;
  - `deploy.sh`'s no-build mode for `deploy-check`;
  - the README prerequisites and install steps.

  The unit tests use fakes and cover:
  - word counts, the tag, bot and name regexes, and no `eval` or expansion;
  - `deploy` refused while any bot is enabled;
  - the clean environment, so `MINDCRAFT_ROTN_REPO_URL` is ignored;
  - the result logged;
  - `reset-state`:
    - refusing every active, activating or deactivating state;
    - refusing a symlinked or foreign-owned folder;
    - keeping exactly the three entries and never touching `msa`;
    - deleting nothing, with an archive under the root-owned parent.

  An independent review follows.
- **The human** does the prerequisites above, installs the reviewed gate, ctl and root-owned `deploy.sh`, and reports their SHA-256 values and the outputs of the check commands, as in step 0. Until then the new verbs do not exist and the human keeps doing these steps.
- **Audit.** The human can see every gate request and every deploy result with `journalctl -t rotn-ssh-gate`, and the current release with `release` (or `deploy.sh status`). The lead's STATUS file lists each deploy.
- **Operations.**
  - A deploy can take minutes (`npm ci` retries and a health wait). The lead runs it with `ssh -o ServerAliveInterval=30`.
  - If the session drops and leaves a stale `.deploy.lock`, the next deploy reports the lock, and the human clears it (rare).
  - There is no `rollback` verb: deploying the previous tag is the rollback.
- **Security, stated plainly.**
  - Through the gate, the key can now put any `rotn-v` tag that is on `develop` into production on the CX23, with no human hand on it. The protection is the review of every `develop` merge, plus the npm and GitHub supply chain. A bad release runs its code as `deploy`.
  - The prerequisites stop such code from escaping the gate. They do not stop it from misbehaving as the bot. Release code decides where the bot connects (the env file's `host` is only configuration it reads), and part of the env check comes from the release itself. **What protects the live Minecraft server is the review of `develop`, and the live server's own whitelist**, not the env file alone.
  - While no bot is enabled (all of G4), `deploy.sh`'s health check and automatic rollback do nothing. A broken release shows up at the next `start`.
  - `reset-state` can move a bot's memory aside, but never deletes it.
- **Rollback of this ADR:** the human reinstalls the previous gate (its SHA-256 is in the step 0 evidence and `coord/STATUS-rotn-lead.md`), which removes the new requests at once. The root-owned prerequisites can stay; they only harden the host.
