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
  - `restrict`, which turns off pty allocation, port, agent and X11 forwarding and `~/.ssh/rc`;
  - `command="/usr/local/sbin/mindcraft-rotn-ssh-gate"`, a forced command. This, not `restrict`, is what replaces any shell, exec, `scp` or `sftp` request with the gate. Client environment variables that sshd accepts (`AcceptEnv`, on Ubuntu `LANG` and `LC_*` by default) still reach the gate, so it must not trust its environment (sudo resets it for the ctl).
- **The gate, as the human reports it** (not yet in the repo or reviewed): it allows only `status`, `start` or `stop` with one valid bot name, and runs them through `sudo -n mindcraft-rotn-ctl`. The sudoers rule (`deploy/cx23/bootstrap.sh`) lets `deploy` run that ctl without a password, and the ctl checks the bot name again (`deploy/cx23/mindcraft-rotn-ctl.sh`). Anything else is refused and logged under the syslog tag `rotn-ssh-gate`. Behind the gate, the sudoers rule allows every ctl verb (restart, enable, disable, journal, metrics and more), so **the gate is the only barrier** between the key and the full ctl. That is why it needs a review.
- **Rules for agents:**
  - The key is root's, and every agent session on the CX33 runs as root, so technically any agent, subagent or reviewer can use it. By rule, only the lead and harness-ops use it, and only for G4 checks and scenarios under a written lead GO.
  - **Before the gate is reviewed:** only `status`. `start` and `stop` wait until the gate script is in `deploy/cx23/`, reviewed, and the human confirms that the installed copy matches it (by SHA-256).
  - **`start` joins whatever Minecraft server `/etc/mindcraft-rotn/<bot>.env` names**, and agents can neither see nor change that file through the gate. So every `start` needs the human's GO, which must confirm that the env file's host is a disposable test server, never the live one.
  - No attempt to run anything the gate refuses. A refusal in the gate's log is treated as an incident and reported to the human.
  - The live Minecraft server stays untouched: the CX23 bot joins only disposable test servers until G4 has passed (PLAN, NEEDS-HUMAN).
- **First use:** one read-only `status` check by the lead after this ADR is merged, recorded in `coord/STATUS-rotn-lead.md`. (`systemctl status` prints the last journal lines, so even `status` exposes some log content.)

## Consequences

- **Gate script in the repo.** The gate script lives only on the CX23 today. harness-ops writes it into `deploy/cx23/` with unit tests (against a fake ctl, covering `SSH_ORIGINAL_COMMAND` parsing: exact word count, the bot-name regex, no shell expansion or `eval`, safe logging of refused input), and an independent review follows. The human installs the reviewed version and reports its SHA-256 so it can be compared with the repo.
- **More verbs needed for G4.** G4 needs more than `status`, `start` and `stop`. The read-only `journal <bot> [--since <time>]` and `metrics <bot>` verbs of `mindcraft-rotn-ctl` (#326) are needed for the soak and reconnect scenarios. Extending the gate to allow them (with the same strict argument checks) is a reviewed change that the human installs. Until then, those scenarios cannot read the bot side. `restart` is deliberately left out; `stop` then `start` covers restart persistence. harness-ops also updates `test/scenarios/g4/PLAN.md`, which still lists the channel as an open decision.
- **Security.** The CX23 is production, though not the live Minecraft server. It is now reachable from the dev server: any agent session on the CX33, or anyone who compromises its root account, has the gate's capabilities: start, stop and read status (later journal and metrics) of the bot service, as long as the forced command and the gate hold. The `deploy` user's own SSH key and the human's root key are unchanged. Removing the line from `authorized_keys` stops new logins at once; a session already open runs until it ends.
- **Ownership.** Driving the channel from scenarios is harness-ops' work (`test/`, `deploy/`). The key, `authorized_keys` and the installed gate are the human's.
