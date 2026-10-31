# Status: harness-ops

Updated: 2026-11-01

## Done

- G0 tooling written and unit-tested offline on branch `agent/harness-ops/g0-test-server`:
  - `deploy/test-server.sh`: up, run, down, list, sweep, console, fetch, verify, `--dry-run`.
  - `deploy/test-server/`: the cloud-init build, the on-server helper and the systemd unit.
  - `.github/workflows/test-server-sweeper.yml`: the off-PC watchdog.
  - `test/scenarios/g0-test-server.sh` and `test/scenarios/g0-watchdog.sh`.
  - `test/tools/status-ping.mjs`.
  - `test/unit/*.test.js`: 32 tests (`npm test`), all passing; `npx eslint test/` is clean, and the repo total is still 259.
- Read-only checks against the real API (2026-11-01), all passing:
  - `hcloud context list` shows `mindcraft-rotn-test` active.
  - The project has no servers and no Primary IPs. It has one human SSH key with no labels, which the sweeper's selector never matches.
  - `ubuntu-24.04` is available (x86).
  - nbg1 gross prices: CPX42 EUR 0.138136/h, CX23 EUR 0.010912/h.
  - `test-server.sh up --dry-run` and `sweep --dry-run` work against the real API.
- Pack: CurseForge file 7564549 is "RotN 3.3.4 Server Pack.zip" with 791,130,136 bytes, the same as the local zip. Its CDN URL answers HEAD with 200.
  - The SHA-256 is not yet verified: the first build downloads the file, hashes it on the server and logs the result.
  - If the hash does not match the pin, the build falls back to uploading the local zip.

## Doing

- Opening the G0 tooling PR against `develop`.

## Planned real batches (written before any create, per the lead's rule)

All in the test project (context `mindcraft-rotn-test`). Every resource carries `purpose=mindcraft-rotn-test`, `delete-after=<epoch>` and `batch=<name>`. Deletion runs server first, then the Primary IPv4, then the SSH key, and each is checked as gone.

1. **G0 build batch.**
   - Command: `deploy/test-server.sh run --yes -- test/scenarios/g0-test-server.sh`
   - Server: type `cpx42`, image `ubuntu-24.04`, location `nbg1`, one labelled Primary IPv4, no IPv6, TTL 8 h.
   - Expected runtime 30-60 min, so 1 billed hour: about **EUR 0.14**.
   - **Max cost EUR 1.11** (8 h x 0.138136, if the EXIT trap fails and only the watchdog deletes it), plus the Primary IPv4 for the same hours.
2. **Watchdog acceptance test.**
   - Command: `test/scenarios/g0-watchdog.sh --yes --mode dispatch`, with a fallback to `--mode scheduled`.
   - Servers: two `cx23`, `ubuntu-24.04`, `nbg1`.
     - The target has expired labels and its own Primary IPv4 with auto-delete off.
     - The control carries `purpose=mindcraft-rotn-watchdog-control` and is IPv6-only.
   - Runs at most 35 min: about **EUR 0.03**, max EUR 0.03 plus IPv4.
   - The control is deleted by the script's own trap. The sweeper alerts on an overdue control but never deletes it.

## Blocked

- Watchdog proof (batch 2), since 2026-11-01. It needs:
  - the sweeper workflow on `develop` (this PR merged);
  - the GitHub Environment and its secret (request 2 below).

## Requests to other agents or the lead

1. **Lead:** review and merge the G0 tooling PR. The scheduled sweeper only runs from the default branch.
2. **Human, via NEEDS-HUMAN** (the lead routes it). Create a GitHub Environment for the off-PC sweeper:
   - Repo Settings -> Environments -> New environment named `hetzner-test-sweeper`.
   - Deployment branches and tags: "Selected branches", add `develop` only. Required reviewers: none, or the schedule would wait.
   - Environment secret `HCLOUD_TOKEN`: a new **Read & Write** API token of the Hetzner **test** project (Hetzner console -> project -> Security -> API tokens). Not a repository secret.
   - The agent never sees or handles the token.
3. **Lead:** my unit tests use `"test/unit/**/*.test.js"`, which `npm test` already covers. CI (brief deliverable 3) comes in a later PR.

## Open PRs

- (being opened) G0: disposable RotN 3.3.4 test server, cleanup and off-PC watchdog (gate G0)
