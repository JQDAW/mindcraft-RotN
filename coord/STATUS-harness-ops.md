# Status: harness-ops

Updated: 2026-11-01

## Done

- G0 tooling written and unit-tested offline on branch `agent/harness-ops/g0-test-server` (PR #4):
  - `deploy/test-server.sh`: up, run, down, list, sweep, console, fetch, verify, `--dry-run`.
  - `deploy/test-server/`: the cloud-init build, the on-server helper and the systemd unit.
  - `.github/workflows/test-server-sweeper.yml`: the off-PC watchdog.
  - `test/scenarios/g0-test-server.sh` and `test/scenarios/g0-watchdog.sh`.
  - `test/tools/status-ping.mjs`.
  - `test/unit/*.test.js`: 44 tests (`npm test`), all passing; `npx eslint test/` is clean, and the repo total is still 259.
- Read-only checks against the real API (2026-11-01), all passing:
  - `hcloud context list` shows `mindcraft-rotn-test` active.
  - The project has no servers and no Primary IPs. It has one human SSH key with no labels, which the sweeper's selector never matches.
  - `ubuntu-24.04` is available (x86).
  - nbg1 gross prices: CPX42 EUR 0.138136/h, CX23 EUR 0.010912/h.
  - `test-server.sh up --dry-run` and `sweep --dry-run` work against the real API.
- Pack: CurseForge file 7564549 is "RotN 3.3.4 Server Pack.zip" with 791,130,136 bytes, the same as the local zip. Its CDN URL answers HEAD with 200.
  - The SHA-256 is not yet verified: the first build downloads the file, hashes it on the server and logs the result.
  - If the hash does not match the pin, the build falls back to uploading the local zip.
- Independent verifier pass: static PASS, no blockers. Its should-fixes are applied in commit ce07fc0 (whitelist by UUID, sweep cap, interval assertion, timeouts).
- PR #4 independent review (REQUEST CHANGES): findings 1, 2, 3, 4, 6 and 9 are fixed on the same branch:
  1. **Context pin.**
     - Every hcloud call passes `--context mindcraft-rotn-test`, with `HCLOUD_TOKEN` and `HCLOUD_CONTEXT` stripped from hcloud's environment.
     - Any other context is refused before the first call.
     - The sweeper's `ROTN_HCLOUD_AUTH=env-token` mode is accepted only when `GITHUB_ACTIONS=true`.
     - `g0-watchdog.sh` is pinned in the same way.
  2. **Watchdog control.**
     - It has an expired `delete-after` and no `purpose=mindcraft-rotn-test`, so it proves selection by label.
     - Its own expiry is the separate label `control-expires`.
  3. **Control watchdog.** The sweeper deletes `purpose=mindcraft-rotn-watchdog-control` servers once `control-expires` plus 30 min has passed. Costs corrected below.
  4. **Cleanup by ID.** `g0-watchdog.sh` cleanup deletes only the IDs returned by its own `create -o json`, never by name.
  6. **Pre-create guard.** It also blocks on leftover labelled Primary IPs and SSH keys.
  9. **Flags checked.** Every hcloud subcommand and flag the scripts use was checked with `--help` on hcloud 1.70.2, and nothing was created. The `create -o json` output shapes were checked in the v1.70.2 source.

  Unit tests cover 1, 2 and 4 (plus 3 and 6). Part of finding 5 is done as well: the cost wording now says TTL + 1 billed hours.

## Doing

- PR #4 updated; waiting for the lead's re-review and merge.

## Planned real batches (written before any create, per the lead's rule)

All in the test project: hcloud context `mindcraft-rotn-test`, which the scripts now enforce. Every test resource carries `purpose=mindcraft-rotn-test`, `delete-after=<epoch>` and `batch=<name>`. Deletion runs server first, then the Primary IPv4, then the SSH key, and each is checked as gone.

1. **G0 build batch.**
   - Command: `deploy/test-server.sh run --yes -- test/scenarios/g0-test-server.sh`
   - Server: type `cpx42`, image `ubuntu-24.04`, location `nbg1`, one labelled Primary IPv4, no IPv6, TTL 8 h.
   - Expected runtime 30-60 min, so 1 billed hour: about **EUR 0.14**.
   - **Max cost about EUR 1.24** (9 billed hours x 0.138136) plus the Primary IPv4 for the same hours. This is the case where the EXIT trap fails and the sweeper deletes the server after `delete-after`; the extra hour allows for the 15-min interval and late cron starts.
2. **Watchdog acceptance test.**
   - Command: `test/scenarios/g0-watchdog.sh --yes --mode dispatch`, with a fallback to `--mode scheduled`.
   - Servers: two `cx23`, `ubuntu-24.04`, `nbg1`.
     - The **target** carries the test labels with `delete-after = now - 60`, and its own labelled Primary IPv4 with auto-delete off.
     - The **control** has the same expired `delete-after` and no test label (`purpose=mindcraft-rotn-watchdog-control`), plus `control-expires = now + 1 h`. It is IPv6-only.
   - Expected: the test ends within 20 min, both servers are deleted, about **EUR 0.02**.
   - **Max cost:**
     - The target is deleted by the sweeper within 1 billed hour.
     - The control is deleted by the script's own cleanup, or by the sweeper at `control-expires` + 30 min (about 1.75 h, 2 to 3 billed hours with cron latency).
     - Total about **EUR 0.05**, plus the target's Primary IPv4 for 1 hour.

## Blocked

- Both real batches (G0 build and watchdog proof), since 2026-11-01, by the lead's decision (option 1): no real server is created until the off-PC sweeper is live. Only the merge of PR #4 is left; then both batches run together.

## Deferred review findings (PR #4; the lead allowed them in a later PR)

- **5.** Preflight check for a recent successful sweeper run before `up` (`gh run list --workflow test-server-sweeper.yml`), refusing or warning if there is none. The cost wording is already fixed.
- **7.** `resolve_name` does not validate `--name` for the non-`up` commands (`down`, `console`, ...). Not exploitable, because selectors are ANDed, but it should use the same regex as `up`.
- **8.** The firewall opens 22 and 25565 to the whole internet. Add an optional `--allow-from CIDR` (ufw) or a labelled Hetzner Cloud Firewall.
- **10.** `expired_filter` treats a missing or unparsable expiry as expired at once (fail-safe for disposable labelled resources). This is now documented in the code comment. Still to decide: alert instead of deleting in that case.

## Requests to other agents or the lead

1. **Lead:** re-review and merge PR #4. The scheduled sweeper only runs from the default branch.
2. ~~Human: GitHub Environment `hetzner-test-sweeper`~~ **Done** (the lead verified it via the GitHub API on 2026-11-01): deployment branches `develop` only, environment secret `HCLOUD_TOKEN`, no repository-level secrets.
3. **Lead (info only):** my unit tests use `"test/unit/**/*.test.js"`, which `npm test` already covers. CI (brief deliverable 3) comes in a later PR.

## Open PRs

- #4 G0: disposable RotN 3.3.4 test server, cleanup and off-PC watchdog (gate G0, test-server half). Review findings 1, 2, 3, 4, 6 and 9 are fixed. Waiting for the lead's re-review and merge; then the G0 batch and the watchdog proof run together.
