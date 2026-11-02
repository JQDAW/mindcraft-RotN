# ADR 0007: The bot's CX23 runs Ubuntu 26.04 LTS

- Status: accepted
- Date: 2026-11-02 (UTC)
- Author: rotn-lead (decision by the human)

## Context

PLAN and CLAUDE.md pinned "Bot OS: Ubuntu 24.04 on the CX23". No ADR or research chose 24.04. It was a default from the project scaffolding (2026-10-31), and nobody checked which Ubuntu the human's servers run. It also shaped the OS check in `deploy/cx23/bootstrap.sh`. The test servers' `ubuntu-24.04` image (`deploy/test-server.sh`) has its own basis: `docs/research/ops.md` checked Java 8 packages on 24.04 (section B).

The read-only probe of the CX23 (GO 1, PR #128, `test/evidence/cx23/README.md`) found **Ubuntu 26.04.1 LTS** (kernel 7.0). The bootstrap refuses it, which blocks GO 2. The human says the live RotN server also runs Ubuntu 26.04, and that this is the OS they intend to run the bot on.

The bot needs only Node 22 LTS (ADR 0002), installed from NodeSource with the `nodistro` apt line, which does not depend on the Ubuntu release. Java 8 is needed only on the disposable test servers, which run the Forge server. Two risks are open. First, Mindcraft's npm dependencies that build native code have never been installed or run on 26.04. Second, the bootstrap's system-level steps are untested there: the ssh unit and the journal check for an accepted public key, ufw, sudo (26.04 ships sudo-rs by default) and the `sshd_config.d` drop-in.

## Options

1. **Rebuild the CX23 with Ubuntu 24.04.** This matches what has been tested so far. But it wipes the human's setup on the CX23, the bot's OS would differ from the human's servers, and it only puts the move to the newer LTS off.
2. **Keep 26.04 and move the pin.** No rebuild, and the bot's OS matches the human's servers. The cost is the two risks above. CI catches the native-dependency risk (see the decision). The bootstrap's system steps are first tried at GO 2 on the real CX23.

## Decision

Option 2, chosen by the human on 2026-11-02 (about 22:45 UTC). This answers harness-ops Requests item 14 (`coord/STATUS-harness-ops.md`).

- **Bot OS:** Ubuntu **26.04 LTS** on the CX23. Node stays 22 LTS (ADR 0002).
- **CI on 26.04 (harness-ops):** a CI job runs `npm ci` (with patch-package) and `npm test` inside an `ubuntu:26.04` container with Node 22. It runs on pull requests and develop, uses no secrets, and pins actions by SHA. It must pass before the first bootstrap of the CX23 (GO 2).
- **Bootstrap (harness-ops):** `deploy/cx23/bootstrap.sh` accepts Ubuntu 26.04. The tests and `deploy/cx23/README.md` follow.
- **SSH (human decision, same day):** the bootstrap's `setup` step sets `PasswordAuthentication no`. This is new: today the setting is only in the optional `lockdown` step, which also writes `PermitRootLogin no` and `AllowUsers deploy` and is not to be run (the human keeps root SSH). `PermitRootLogin` stays `prohibit-password`. The `deploy` user's password is for sudo only.
- **Test servers** stay on `ubuntu-24.04` until someone checks how Java 8 is installed on 26.04. Moving them is a separate, later change; the 26.04 CI job covers the bot's install in the meantime.

## Consequences

- CLAUDE.md's pinned versions and PLAN's "Bot VPS" row now say Ubuntu 26.04. PLAN's "root and password login are then disabled" becomes: root by key only, SSH password login disabled.
- GO 2 (the bootstrap) waits for the 26.04 CI job and the bootstrap change to merge. GO 2 is also the first run of the bootstrap's system steps on 26.04 (ssh unit, ufw, sudo-rs, the sshd drop-in). The bootstrap must check each of these and stop on a mismatch, never leave sshd half-configured.
- Files that still say 24.04 for the CX23, for harness-ops to update with the bootstrap change: `deploy/cx23/README.md:3`, `deploy/cx23/bootstrap.sh:2,61-62,277`.
- Until the test servers move, G3 and G4 test-server runs are on 24.04 while the CX23 runs 26.04. The first real bot start on the CX23 (G4) is the first full run on 26.04.
