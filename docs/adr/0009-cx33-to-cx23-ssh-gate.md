# ADR 0009: A restricted SSH key from the CX33 dev server to the CX23 bot host

- Status: accepted (the human's decision, 2026-11-07)
- Date: 2026-11-07
- Author: rotn-lead (decision and setup by the human)

## Context

G4 proves the ready-to-try list on the CX23 bot host (`test/scenarios/g4/PLAN.md`). Its service scenarios (reconnect, restart persistence, the 2-hour soak, the second bot) run for up to hours unattended, so the harness on the CX33 dev server needs a scripted way to drive the bot's systemd service on the CX23. Until now, agents had no access at all to the bot host; the human ran every CX23 step by hand.

`coord/NEEDS-HUMAN.md` offered two options: (a) an Orca terminal on a `cx23-deploy` target, or (b) a dedicated SSH key from the CX33 to `deploy@cx23`. It noted that a plain key gives a normal shell as `deploy`, because the sudo rule only limits what `deploy` may run as root, and that limiting the key itself needs `restrict` and a forced command.

## Options

1. Orca terminal on a `cx23-deploy` target, driven by `orca terminal send/read`.
2. A dedicated SSH key, restricted on the CX23 side.
3. No scripted channel: the human runs every G4 service step by hand.

## Decision

Option 2, set up by the human on 2026-11-07:

- **The key:** a dedicated key pair on the CX33 (root's, used only for this). Its file is never read, printed, copied or committed; only `ssh` uses it.
- **The CX23 side:** its line in `/home/deploy/.ssh/authorized_keys` carries three options:
  - `from="<the CX33's address>"`, so the key works only from the dev server (the address is not recorded in the repo);
  - `restrict`, so no shell, pty, port, agent or X11 forwarding;
  - `command="/usr/local/sbin/mindcraft-rotn-ssh-gate"`, a forced command.
- **The gate** allows only `status`, `start` or `stop` with one valid bot name. It runs them through `sudo -n mindcraft-rotn-ctl`, which the existing sudoers rule allows without a password and which checks the bot name again. Anything else is refused and logged under the syslog tag `rotn-ssh-gate`.
- **Rules for agents:**
  - Only the lead and harness-ops use the key, and only for G4 checks and scenarios under a written lead GO. A run that starts the bot against a test server also needs the human's GO, like every paid batch.
  - No attempt to run anything the gate refuses. A refusal in the gate's log is treated as an incident and reported to the human.
  - The live Minecraft server stays untouched: the CX23 bot joins only disposable test servers until G4 has passed (PLAN, NEEDS-HUMAN).
- **First use:** one read-only `status` check by the lead after this ADR is merged, recorded in `coord/STATUS-rotn-lead.md`.

## Consequences

- **Gate script in the repo.** The gate script lives only on the CX23 today. The lead proposes that harness-ops write it into `deploy/cx23/` with unit tests (against a fake ctl) and an independent review, so that any version the human installs has been reviewed. The installed copy should then match the reviewed file.
- **More verbs needed for G4.** G4 needs more than `status`, `start` and `stop`. The read-only `journal <bot> [--since <time>]` and `metrics <bot>` verbs of `mindcraft-rotn-ctl` (#326) are needed for the soak and reconnect scenarios. Extending the gate to allow them (with the same strict argument checks) is a reviewed change that the human installs. Until then, those scenarios cannot read the bot side.
- **Security.** The production bot host is now reachable from the dev server. A compromise of the CX33's root account gives the gate's capabilities: start, stop and read status (later journal and metrics) of the bot service, nothing more, as long as the forced command holds. The `deploy` user's own SSH key and the human's root key are unchanged. Removing the line from `authorized_keys` revokes the channel at once.
- **Ownership.** Driving the channel from scenarios is harness-ops' work (`test/`, `deploy/`). The key, `authorized_keys` and the installed gate are the human's.
