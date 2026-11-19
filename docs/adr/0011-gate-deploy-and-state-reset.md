# ADR 0011: The lead deploys releases and resets bot state through the CX23 gate

- Status: accepted
- Date: 2026-11-19
- Author: rotn-lead

## Context

ADR 0009 gave the CX33 dev server a restricted SSH key to `deploy@cx23`. A forced command (`/usr/local/sbin/mindcraft-rotn-ssh-gate`, `deploy/cx23/mindcraft-rotn-ssh-gate.sh`) allows only `status`, `start`, `stop`, `journal` and `metrics` for one bot, through `sudo -n mindcraft-rotn-ctl`.

Every soak since step 0 has needed the human for three more steps:
- deploying the release tag (`bash ~/deploy.sh deploy <tag>` as `deploy`);
- resetting the bot's state (moving everything but action-code, histories and `last_profile.json` aside, as root);
- checking or setting the env file's `"host"`.

The deploy and the reset are mechanical and each soak waited hours for them. On 2026-11-19 the human asked for the lead to do the deploy operations itself, and chose this scope: deploy, release status and state reset through the gate, with the env file staying the human's.

## Options

1. A normal shell for the lead on the CX23 (as `deploy`, or root). Simple, but it removes the gate as the barrier ADR 0009 relies on, and the env file would be within reach.
2. New gate verbs with the same strict argument checks, implemented in the reviewed, checksummed scripts the human installs.
3. Keep everything with the human.

## Decision

Option 2. The gate gains three requests:

| Request | Runs | Checks |
| --- | --- | --- |
| `deploy TAG` | `bash /home/deploy/deploy.sh deploy TAG` as `deploy` (the gate's own user; no sudo) | TAG matches `^rotn-v[0-9]+\.[0-9]+\.[0-9]+$` exactly (plain tags only, as for step 7). `deploy.sh` itself checks that the tag is on `develop`, runs `npm ci` and the settings checks, and rolls back on a failed health check. |
| `release` | `bash /home/deploy/deploy.sh status` as `deploy` | Read-only. |
| `reset-state BOT` | `sudo -n mindcraft-rotn-ctl reset-state BOT` | The bot name regex as for the other verbs. The ctl refuses unless the bot's unit is inactive; it moves every entry of `/var/lib/mindcraft-rotn/bots/<BOT>/` except `action-code`, `histories`, `last_profile.json` and `msa` into a new root-owned (0700) archive directory `/var/lib/mindcraft-rotn/state-archive/<bot>-<UTC timestamp>/`, deletes nothing, and prints the remaining entries and the archive path. |

The gate still refuses everything else, and logs both allowed and refused requests under `rotn-ssh-gate` as before.

**The env file stays the human's.** No verb reads or writes `/etc/mindcraft-rotn/<bot>.env`. A bot `start` still needs the human's GO confirming that the env file's `"host"` names a disposable test server. The lead must not confirm its own change, so this stays the one human step per soak.

**When the lead uses the new verbs.**
- `deploy` and `release`: under a written lead GO naming the tag, only for a tag the lead created on `develop` after CI passed, and only while no bot is `enable`d (during G4 none is; `deploy.sh` restarts only enabled bots).
- `reset-state`: under the soak's GO, with the bot stopped.
- A refused request in the gate's log is still an incident, reported to the human.

## Consequences

- **harness-ops** extends `deploy/cx23/mindcraft-rotn-ssh-gate.sh` (the three requests) and `deploy/cx23/mindcraft-rotn-ctl.sh` (`reset-state`), with unit tests against a fake ctl and a fake `deploy.sh`: exact word counts, the tag and bot regexes, no shell expansion or `eval`, `reset-state` refusing a running unit, keeping exactly the four entries, deleting nothing, and an archive that cannot be written through a symlink. `deploy/cx23/README.md` gets the install steps. An independent review follows.
- **The human** installs the reviewed gate and ctl on the CX23 as root and reports their SHA-256, as in step 0. Until then the new verbs do not exist and the human keeps doing these steps.
- **CLAUDE.md** (Security rules) records that the lead may deploy, read the release and reset a stopped bot's state through the gate, and that the env file stays the human's.
- **Security.** The key can now also put any `rotn-v` tag that is on `develop` into production on the CX23. That is bounded by the review of every `develop` merge and by `deploy.sh`'s checks and rollback, but a bad release can now reach the CX23 without the human's hands on it. It still cannot reach the live Minecraft server: that needs the env file, which stays the human's. `reset-state` can move a bot's memory aside but never deletes it; the human can restore an archive by hand.
- **Rollback of this ADR:** the human reinstalls the previous gate (its SHA-256 is in `coord/STATUS-rotn-lead.md` and the step 0 evidence), which removes the three requests at once.
