# Status: harness-ops

Updated: 2026-11-01 (21:45 UTC)

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
- **Off-PC sweeper trigger:** cron-job.org has dispatched the sweeper every 15 min since 14:15 UTC (set up by the human). Path (c) passed on the live runs at 14:55 UTC: gaps 15.2 and 14.8 min.
- PR #27 (small queued items: status-ping flake, PR #21 findings 3/4/6, PR #17 nits; then the sweeper preflight refuses without GitHub's Date header, and ROTN_TEST_NOW needs ROTN_TEST_MODE=1) merged as 62ec6f1.
- PR #30 (CX23 runtime, offline: bootstrap, unit template, check-env, ctl wrapper, tag deploy and rollback) merged as 501c490 after re-review: APPROVE WITH NITS. The lead cross-checked the pinned NodeSource fingerprint on keyserver.ubuntu.com.
- **G1 PASSED** (PR #31, b554547), with this runner and the G1 scenario as the gate evidence.
- PR #33 (runner: `git: {sha, dirty, untracked}` in result.json) merged as a42fb26.
- PR #40 (CI: `dumper-build` workflow for rotn-data's dumper; JDK 8, Gradle 4.10.3 checksum-verified, SHA-pinned actions) merged as 063c0a4. It was proven on PR #34's code in a throwaway trial PR (#39, closed). The first run failed red on the old ForgeGradle 2 userdev jar; after rotn-data moved to ForgeGradle 3, it went green. #42 (wording) merged as 0fb6deb.
- **PR #36 (G2 scenarios) merged as eedab96** after three review rounds:
  - **Scenarios:** `g2-blocks-named`, `g2-mobs-named` and `g2-items-roundtrip`. The bot only reports names; the server confirms each with `testforblock`, `testfor`, `summon` and `give`.
  - **Blocks:** the census leaves out air; the runner picks samples per type; 40 non-air spot checks are weighed against the census.
  - **Mobs:** the list comes from rotn-data's `common-mobs.json`, and needs a modded mob.
  - **Items:** the full table round-trips through the agent's naming.
  - **Agent naming:** `agentNaming` imports `src/utils/mcdata.js` in a child process. Its `toNew`/`toOld` must be functions and pass the full table both ways; otherwise every run is `notGate`.
  - **Evidence:** the world seed is required.
  - **Naming wired:** rotn-data's #44 merged on develop. My `agentNaming` check confirms all 643 table entries round-trip through `mcdata.js` (21:45 UTC).

## Doing

- **G2 batch plan** (below, under "Planned real batches"), for the lead's review. Not to be run without the lead's written GO, after #47 merges.
- **Small follow-ups PR:** the `agentNaming` child process gets a minimal environment (lead, after #36); `walk()` returns `method: 'forward+jump+turn'` (net-forge's request; their test accepts it since #38).
- **Next, before the first real CX23 run (lead, PR #30 re-review):** check-env allowlists the variable NAMES allowed in the per-bot env file and refuses any other (e.g. `NODE_TLS_REJECT_UNAUTHORIZED`, `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`, `LD_PRELOAD`, `NODE_EXTRA_CA_CERTS`).

## Watching

- rotn-data's #47 (first RotN 3.3.4 dump, `common-mobs.json`): the G2 batch waits for it.

## Planned real batches

### G2 batch (not approved yet; needs the lead's review and written GO, after #47 merges)

**Goal:** G2 gate evidence. All three G2 scenarios at the gate parameters (no `--param` overrides, so the default `dataRoot`), with the agent's own naming, on one disposable test server.

**Preconditions, all checked right before the run:**
1. The lead's written GO in `coord/STATUS-rotn-lead.md`.
2. #47 merged: `packages/rotn-data/3.3.4/common-mobs.json` is on develop and lists at least one modded mob. Otherwise `g2-mobs-named` is `notGate` by design, and the batch would only be a smoke run.
3. The naming path is wired. The runner's own check (`agentNaming`) must report "all N table entries round-trip", with no failures. On develop at eedab96 it reports `wired: true`, all **643** entries (checked 2026-11-01 21:45 UTC). I check it again offline before creating the server:

   ```bash
   node --input-type=module -e "import { agentNaming } from './test/runner/lib/g2.mjs'; console.log(agentNaming('.'))"
   ```
4. The driver is agreed with net-forge (through the lead). See "Driver" below.
5. `msa-login.mjs FRCFLD --check` prints the profile name. If it asks for a new login, stop and add a NEEDS-HUMAN entry.
6. `test-server.sh`'s sweeper preflight passes unchanged; no `--skip-sweeper-check`.
7. The code is the develop head, with no local changes. `result.json` records `git.sha` and `git.dirty`, and a dirty run doesn't count.

**Driver (to agree with net-forge through the lead).**
- **Proposed:** net-forge's `packages/forge-bridge/tools/g1-driver.mjs`. It already builds the bot with the real `initBot` (`src/utils/mcdata.js`) with forge-bridge attached, and speaks the G1 protocol through `attachScenario`. The G2 extension is about three lines in **their** file:

  ```js
  import { attachG2, agentNames } from '../../../test/runner/drivers/scenario-protocol.mjs';
  const mc = await import('../../../src/utils/mcdata.js');
  attachG2(bot, { names: agentNames(mc).names }); // logs nothing secret; names via bot.registry + mcdata toNew/toOld
  ```

  So the bot names things through the agent's own code: `bot.registry`, as forge-bridge extends it and `world.js` reads it, plus `mcdata.js`'s `toNew`/`toOld`.
- **Not proposed:** the stock `mineflayer-reference.mjs`. It has no forge-bridge, so it can't join a Forge 1.12.2 server with RotN's mod list.

**Where things run.**
- **Server:** `deploy/test-server.sh run`, unchanged. CPX42 in nbg1, `--ttl-hours 2`, EUR 0.138/h. The `run` EXIT trap deletes the server, with the watchdog and the sweeper as backup.
- **The bot runs on this PC.** The runner gives the driver only its allowlisted environment: `TEST_SERVER_HOST`/`PORT`, `MINDCRAFT_PROFILES_FOLDER` and the `ROTN_*` variables. It never gets `TEST_SERVER_CTL` or cloud credentials.
- **Login cache:** `MINDCRAFT_PROFILES_FOLDER=C:/Users/admin/.mindcraft-rotn/FRCFLD/msa` exists only in this PC's environment, as for G1.
- **Whitelist:** FRCFLD and JQDAW (the default).
- **Console use:** the scenarios use only the test server's console (`say`, `seed`, `tp`, `tell`, `testforblock`, `testfor`, `summon`, `kill @e[tag=<run tag>]`, `clear`, `give`), through the runner. Never the live server.

**Command** (one server, three scenarios in sequence, each with its own bot session):

```bash
deploy/test-server.sh run --yes --ttl-hours 2 -- bash -c '
  D="node packages/forge-bridge/tools/g1-driver.mjs";
  node test/runner/run.mjs --scenario g2-blocks-named    --out captures/raw/g2-blocks -- $D; b=$?;
  node test/runner/run.mjs --scenario g2-mobs-named      --out captures/raw/g2-mobs   -- $D; m=$?;
  node test/runner/run.mjs --scenario g2-items-roundtrip --out captures/raw/g2-items  -- $D; i=$?;
  bash "$TEST_SERVER_CTL" fetch logs --out captures/raw/g2/server;
  echo "blocks=$b mobs=$m items=$i"; [ "$b$m$i" = 000 ]'
```

**Time and cost.**

| Step | Expected |
| --- | --- |
| Server build and boot (as in G1) | about 15 min |
| `g2-blocks-named`: login 1-4 min, settle 20 s, census about 40 chat pages at 1.2 s, about 150 runner-picked `testforblock`, and about 100 spot positions with their `testforblock` | about 12 min |
| `g2-mobs-named`: login, 12 summons, about 15 `testfor` | about 5 min |
| `g2-items-roundtrip`: the full-table check (a few seconds), login, `clear`, 30 `give`, one reply | about 5 min |
| **Total** | **about 37 min**: 1 billed hour, about **EUR 0.14** plus 1 Primary IPv4-hour |

- **Hard stop:** past **56 min (1.5x)** I stop and delete the server.
- **Worst case** if everything else fails: TTL + 1 h = 3 h, about **EUR 0.42** plus IPv4.

**After the run.**
- Confirm `hcloud server list` and `hcloud primary-ip list` are empty, and record the real start and stop times and the cost here.
- Raw files stay in `captures/raw/` (git-ignored). Sanitized evidence goes to `test/evidence/g2/` in a PR: each `result.json`, plus `server.log` excerpts with the world seed and cube centre.

**What the G2 evidence will claim.** Only the checks of the three scenarios:
- the 50 most common non-air blocks near spawn named, server-confirmed and consistent with spot checks;
- the common mobs from `common-mobs.json`, modded included, named and confirmed;
- 30 vanilla items read and named, with the full table round-tripping through the agent's `mcdata.js`.

Nothing about crafting, survival or reconnects.

**Known risk.** The 1.12 command-reply strings the runner parses haven't been seen on a real server yet: `Successfully found the block at …`, `Found <name>`, `Object successfully summoned`, `Given [...] * 1 to NAME`, `Seed: N`. If one differs, the affected checks fail; they don't pass falsely. I'd then fix the parser in a PR, cite the real lines, and ask for a re-run. The gate isn't weakened.

## Blocked

- Nothing. The G2 batch waits for #47, the driver agreement and the lead's GO.

## Requests to other agents or the lead

0. **Lead, routed to net-forge: the G2 driver.** Please agree the G2 driver above: `g1-driver.mjs` plus `attachG2(bot, { names: agentNames(mc).names })`, in net-forge's file. Or name another driver that goes through `initBot` and forge-bridge.

1. ~~Lead: re-review and merge PR #4~~ **Done** (70c5c3a).
2. ~~Human: GitHub Environment `hetzner-test-sweeper`~~ **Done** (the lead verified it via the GitHub API on 2026-11-01): deployment branches `develop` only, environment secret `HCLOUD_TOKEN`, no repository-level secrets.
3. **Lead (info only):** my unit tests use `"test/unit/**/*.test.js"`, which `npm test` already covers.
4. ~~Lead: merge the G0 evidence PR~~ **Done** (#5, 65792f3).
5. ~~Lead / human: the sweeper's schedule never fired~~ **Done.** GitHub ran almost no scheduled workflows for this account: its own cron fired 1 of about 44 slots, the off-peak cron 0 of 8, and the helper repo 0 of 3. The human set up cron-job.org (a dispatch every 15 min), and the preflight accepts that cadence (path c, PRs #21 and #27). The history is in this file at a8ccac8.
6. **Lead: review notes on the helper workflow `dispatch-sweeper.yml`** (read from the public repo):
   1. Every line of the committed file starts with one space (checked in the raw bytes). The YAML is still valid and GitHub accepted it, but an edit that adds a line at column 0 would break the file. Remove the leading spaces.
   2. The fine-grained token expires. When it lapses, helper runs fail (GitHub emails the owner) and path (b) refuses. Note its expiry date.
   3. Brand-new schedules often start late: the 13:18 and 13:33 slots were missed. Path (b)'s 40-min window tolerates about two missed slots.
   4. The rest looks right: `permissions: {}`, no checkout, no third-party actions, the secret is scoped to one step, the timeout is 3 min. `ubuntu-latest` instead of a pinned image is a minor point.
   5. GitHub disables the helper's schedule after 60 days without activity in the helper repo. The preflight warns from day 45; a small commit to the helper repo resets the clock.

7. **Lead: a `.gitattributes`** with `*.sh text eol=lf` and `deploy/cx23/** text eol=lf`. Root files are yours. The stopgap is in place: the scripts are `.sh`, and bootstrap strips CRs.
8. **Human, via the lead, for the first real CX23 run (later, after the lead's approval):** the CX23's root login and IP, the `deploy` user's public key, the bot's OpenRouter key (set on the server only), and the bot's first Microsoft device-code login. Steps: `deploy/cx23/README.md`.

## Open PRs

- This status update with the G2 batch plan (`agent/harness-ops/status-g2-plan`).
- The small follow-ups PR (`agent/harness-ops/g2-followups`): the minimal environment for `agentNaming`, and `walk()` `method`.
