# Status: harness-ops

Updated: 2026-11-01 (16:15 UTC)

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

- PR #7 (G0 follow-ups: sweeper preflight, name check, `--allow-from`, label alerts, watchdog attribution) merged as bbcb0ef.
- PR #8 (CI: `npm ci`, `npm test` and the lint gate on every PR) merged as a04ea22. Its own CI run passed: 55/55 tests, lint 259/259.
- PR #9 (scenario runner plus the G1 scenario, brief deliverable 2) merged as f1aefab after re-review: all 12 findings fixed, APPROVE WITH NITS.
  - `test/runner/` holds the engine, the server-log parsers, the adapters, the CLI and the driver contract (`DRIVER.md`), plus a stock-mineflayer reference driver. The scenario is `test/scenarios/g1/g1-login-chat-walk.mjs`.
  - No paid run yet. The first real G1 run needs net-forge's driver, the bot's token cache (NEEDS-HUMAN), the lead's approval and an observed scheduled sweeper run.

- PR #11 (review follow-ups: scheduled-only watchdog evidence, `gh --repo`, lint ratchet that fails closed) merged as e3c1732: APPROVE, lint gate proven end to end. Its review findings 1 and 3 and nits 4 and 5 were fixed in 5296086.
- PR #12 (sweeper cron at the off-peak minutes `7,22,37,52 * * * *`) merged as 971262f at 11:45:11 UTC: APPROVE.
- PR #13 (PR #9 re-review nits: confirm the `say` marker before `bot.start`; reject `[Rcon]` and `[@]`) merged as 04b57c3: APPROVE WITH NITS.
- PR #17 (low-priority nits from the #11, #12 and #13 reviews) merged as 032da12 at 12:16:28 UTC.
- PR #21 (sweeper preflight: (a) its own schedule, (b) the helper repo's schedule, or (c) a cadence of external-cron dispatch runs; a failed newest sweeper run blocks all three) merged as 2abdd3b. Its CI race fix is in c5a4a8c (atomic writes of the fakes' state).
- PR #22 (status: off-peak cron 0/8, helper not firing, helper workflow review) merged as a8ccac8.
- **Off-PC sweeper trigger:** cron-job.org has dispatched the sweeper every 15 min since 14:15 UTC (set up by the human). Path (c) passed on the live runs at 14:55 UTC: gaps 15.2 and 14.8 min. G1 Batch A passed (lead, #26).

## Doing

- **Small queued items**, `agent/harness-ops/small-queued`, one PR:
  - the status-ping loopback flake;
  - PR #21 review findings 3 (GitHub's clock), 4 (document what (b) cannot prove) and 6 (empty `pushed_at`);
  - the PR #17 review nits (the `chatPrefixes` note after the walk check; what the note covers).
- **Next: brief deliverable 5, offline only.** The CX23 bootstrap script, the `mindcraft-rotn@.service` template, the per-bot env file, and the tag-based deploy and rollback, tested with fakes. Nothing connects to the CX23: the human has not given its root login yet.

## Watching

- Nothing. The 2 h observation of GitHub's own schedule ended with 0 of 8 slots, and the helper repo's schedule did not fire in its first three slots (13:18, 13:33, 13:48). Both are recorded in this file at a8ccac8. The preflight now also accepts the external cron cadence (path c).

## Planned real batches

None planned. The next real batch is a G1 run or net-forge's capture run (`--capture`). Each needs the lead's approval and an observed scheduled sweeper run. The plan for the two G0 batches, as written before they ran, is in this file at commit 70c5c3a.

## Blocked

- Nothing. Paid batches need the lead's approval and a passing sweeper preflight, which the cron-job.org cadence now gives.

## Requests to other agents or the lead

1. ~~Lead: re-review and merge PR #4~~ **Done** (70c5c3a).
2. ~~Human: GitHub Environment `hetzner-test-sweeper`~~ **Done** (the lead verified it via the GitHub API on 2026-11-01): deployment branches `develop` only, environment secret `HCLOUD_TOKEN`, no repository-level secrets.
3. **Lead (info only):** my unit tests use `"test/unit/**/*.test.js"`, which `npm test` already covers.
4. ~~Lead: merge the G0 evidence PR~~ **Done** (#5, 65792f3).
5. **Lead / human: the sweeper's schedule has never fired.**
   - `test-server-sweeper.yml` has been on `develop` (the default branch) since 00:25 UTC (70c5c3a), and the workflow state is `active`. Pushes to develop at 00:52, 00:55, 01:16 and 01:21 UTC did not change that.
   - A watch from 01:41 to 04:00:23 UTC found **no `event=schedule` run at all**: no success, no failure, no skipped run. The only runs are my two manual dispatches (41257157372, 41257552258), and both succeeded. A `*/15` cron that is late by minutes is normal on GitHub; 3.5 hours with no run is not.
   - Likely cause: this repo is a **fork** (`fork: true`). GitHub keeps scheduled workflows off in forks until someone enables them, even when manual dispatch works. Unconfirmed.
   - Under the lead's rule, and enforced by `test-server.sh up`, **no paid batch can start until a scheduled run succeeds**.
   - Options, all reversible. The repo settings belong to the lead or human, so I have not touched them:
     1. Human, in the GitHub UI: Actions tab → `test-server-sweeper` → look for a "scheduled workflows are disabled" banner and enable it, then check Settings → Actions → General.
     2. Lead: `gh workflow disable test-server-sweeper.yml` followed by `gh workflow enable test-server-sweeper.yml`. That usually re-registers the cron.
     3. Me: a one-line comment PR to the workflow file. When merged, it registers the schedule again. Only if the lead asks: the lead's rule is no cron or workflow changes without a request.
   - **Routed:** the lead asked the human (NEEDS-HUMAN) to re-enable or re-register the workflow in the Actions tab.
   - **Update (lead):** the schedule fired once, at 06:30:54 UTC (success). That is the only scheduled run in about 10 h, so the cron is registered but GitHub drops almost every run at the busy :00/:15/:30/:45 marks. The preflight correctly refuses today: its 120-min window stays as it is.
   - **Authorized fix:** a separate PR from develop moves the cron to the off-peak minutes `7,22,37,52 * * * *`. Merging it also re-registers the schedule. After the merge I watch for 2 h and record the scheduled-run cadence here. `test-server.sh up` passes its preflight once a scheduled run has succeeded within 120 min.
   - **Done:** #12 merged at 11:45:11 UTC. Result: 0 of 8 off-peak slots fired (see Watching).
   - **Next fix (lead and human):** the helper repo `JQDAW/rotn-sweeper-cron` dispatches the sweeper every 15 min. My preflight change (path b) accepts its scheduled runs as evidence. Its schedule did not fire either.
   - **Resolved:** the human set up cron-job.org (a POST to the dispatches endpoint every 15 min). PR #21's path (c) accepts that cadence. It has been live since 14:15 UTC.
6. **Lead: review notes on the helper workflow `dispatch-sweeper.yml`** (read from the public repo):
   1. Every line of the committed file starts with one space (checked in the raw bytes). The YAML is still valid and GitHub accepted it, but an edit that adds a line at column 0 would break the file. Remove the leading spaces.
   2. The fine-grained token expires. When it lapses, helper runs fail (GitHub emails the owner) and path (b) refuses. Note its expiry date.
   3. Brand-new schedules often start late: the 13:18 and 13:33 slots were missed. Path (b)'s 40-min window tolerates about two missed slots.
   4. The rest looks right: `permissions: {}`, no checkout, no third-party actions, the secret is scoped to one step, the timeout is 3 min. `ubuntu-latest` instead of a pinned image is a minor point.
   5. GitHub disables the helper's schedule after 60 days without activity in the helper repo. The preflight warns from day 45; a small commit to the helper repo resets the clock.

## Open PRs

- The small-queued PR (`agent/harness-ops/small-queued`), opened with this update.
