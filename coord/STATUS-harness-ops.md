# Status: harness-ops

Updated: 2026-11-01 (01:10 UTC)

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

### Real G0 batches (2026-11-01, branch `agent/harness-ops/g0-evidence`)

- PR #4 merged into develop as 70c5c3a; the sweeper is active on develop.
- Re-review nits (commit 31cefa0):
  - `deploy/test-server.sh` and `g0-watchdog.sh` now also strip `HCLOUD_ENDPOINT` and `HCLOUD_CONFIG` from hcloud's environment.
  - `check_context` has a comment explaining why `GITHUB_ACTIONS=true` forces env-token mode.
  - Two new unit tests fail without the fix. `npm test` passes 46/46, and `npx eslint test/` is clean.
- Sweeper dry-run dispatch [41257157372](https://github.com/JQDAW/mindcraft-RotN/actions/runs/41257157372) at 00:32:00 UTC, before any create: the token works, 0 deletions.
- **Real batch 1, G0 build: PASS, 21/21 checks.**
  - Batch `mcr-test-20261101-003243`: cpx42, nbg1.
  - **Start 00:32:37 UTC** (create 00:32:44), ready 00:35:52, **stop 00:36:16** (deletion verified).
  - The pack was downloaded from CurseForge, and its SHA-256 matches the pin. Java 8, Forge 14.23.5.2860, REID 2.2.2, 346 mods in the ping, online mode, whitelist FRCFLD and JQDAW, console OK.
  - **Cost: 1 billed hour x EUR 0.138136 = EUR 0.14**, plus 1 Primary IPv4-hour.
- **Real batch 2, watchdog proof (`--mode dispatch`): PASS.**
  - Batch `mcr-wd-20261101-003652`.
  - **Start 00:36:52, stop 00:38:18 UTC.**
  - Sweeper run [41257552258](https://github.com/JQDAW/mindcraft-RotN/actions/runs/41257552258) deleted the target server, its Primary IPv4 (auto-delete off) and its SSH key 34 s after creation. The control (expired `delete-after`, no test label) was untouched, then deleted by the script's cleanup by ID.
  - **Cost: 2 x cx23 x 1 billed hour x EUR 0.010912 = EUR 0.02**, plus 1 Primary IPv4-hour.
- After each batch, `hcloud server list` and `primary-ip list` were empty (00:36:21 and 00:38:24). The only thing left in the project is the human's unlabelled SSH key.
- Total for both batches: about **EUR 0.16** plus 2 Primary IPv4-hours. The stated maximum was about EUR 1.29.
- Evidence is in `test/evidence/g0/`. An independent verifier pass gave PASS. Its should-fix (capture the project-wide empty checks) and nits are applied.

- PR #5 (G0 evidence) merged as 65792f3: **G0 test-server half passed, "schedule pending"**.

## Doing

Lead's assignment of 2026-11-01, as three PRs, each on its own branch from develop:

1. **PR A**, `agent/harness-ops/g0-followups`: PR #5 review nits 2-5 and deferred findings 5, 7, 8 and 10 (see below). Code done, `npm test` passes 62/62; PR opened.
2. **PR B**, CI (brief deliverable 3): `npm ci`, `npm test` and lint on every PR. Lint must not raise the baseline of 259. No secrets in `pull_request` jobs.
3. **PR C**, the scenario runner plus the G1 scenarios (log in online, stay 10 min, chat, walk), brief deliverable 2.

No paid batches for any of these unless the lead approves.

## Watching

- The first `event=schedule` run of `test-server-sweeper.yml` (active on develop since 00:25 UTC). By the lead's rule it is a **precondition for the next paid batch**, and `test-server.sh up` now enforces it.
  - Still none at 01:05 UTC; only the two dispatch runs exist.
  - I keep checking until about 04:00 UTC. If none appears by then, I write it under Requests.

## Planned real batches

None planned. The next real batch is net-forge's capture run (`--capture`), once G1 needs it. It needs the lead's approval and an observed scheduled sweeper run. Both earlier batches passed (see Done); the plan as written before them is in this file at commit 70c5c3a.

## Blocked

- Nothing.

## Review findings (deferred from PR #4, plus PR #5 nits): fixed in PR A

- **5. Sweeper preflight.**
  - `up`/`run` refuse to create anything unless `gh run list` shows a **successful `event=schedule`** sweeper run on develop in the last `ROTN_SWEEPER_MAX_AGE_MIN` minutes (default 120). Dispatch runs do not count.
  - `--dry-run` only warns. `--skip-sweeper-check` needs the lead's approval.
- **7. Name check.** One `check_name` rule for `--name`, `$TEST_SERVER_NAME` and the name found in the state directory, for every command.
- **8. Firewall.** `--allow-from CIDR` (repeatable, or `ROTN_TEST_ALLOW_FROM`) opens 22 and 25565 only to those CIDRs (ufw). The default stays open, because this PC's address changes. `verify` reports `firewall_allow_from`.
- **10. Decision: keep the fallbacks and add an alert.** A labelled resource with a missing or unparsable `delete-after` (or a control with no `control-expires`) is logged as `ALERT` and makes the sweep exit non-zero, so the GitHub job fails and notifies someone. Deletion still follows the fallback (created + 8 h; at once only if the creation time is also unreadable).
- **PR #5 nit 3.** `g0-watchdog.sh` now PASSes only if the sweeper's own log (local output, or `gh run view --log` of the runs since the create) has "expired ... (ID): deleting" for all three target IDs and never names the control's ID.
- **PR #5 nits 2, 4, 5.** `project-empty-checks.txt` wording and check-3 command, the 338-vs-346 note, and the timestamp.

## Requests to other agents or the lead

1. ~~Lead: re-review and merge PR #4~~ **Done** (70c5c3a).
2. ~~Human: GitHub Environment `hetzner-test-sweeper`~~ **Done** (the lead verified it via the GitHub API on 2026-11-01): deployment branches `develop` only, environment secret `HCLOUD_TOKEN`, no repository-level secrets.
3. **Lead (info only):** my unit tests use `"test/unit/**/*.test.js"`, which `npm test` already covers.
4. ~~Lead: merge the G0 evidence PR~~ **Done** (#5, 65792f3).

## Open PRs

- PR A (`agent/harness-ops/g0-followups`): see Doing.
