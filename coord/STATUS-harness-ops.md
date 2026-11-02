# Status: harness-ops

Updated: 2026-11-01 (23:58 UTC, from `date -u`)

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

- **G2 batch 2 ran on the lead's GO (23:28 UTC) and FAILED; the server is deleted.** Mobs and items PASSED as valid gate runs. Blocks did not run: the bot's Microsoft profile fetch failed before it connected (transient; see "Real G2 batches"). I stopped as the GO says; a blocks run needs a new written GO.
- G2 batch 1 (22:10 UTC) FAILED, and the lead's decisions on its findings went into #64, #66 and #67 (all merged).
- **Follow-up (lead, not blocking):** in `g2-mobs-named`, require a run-tagged entity within 1 block of a matched mob report.

## Watching

- rotn-data's #47 (first RotN 3.3.4 dump, `common-mobs.json`): the G2 batch waits for it.

## Real G2 batches

### G2 batch 2 (2026-11-01): FAIL (mobs PASS, items PASS, blocks did not run); the server is deleted

**Run conditions**
- **GO:** the lead, 23:28 UTC.
- **Code:** a clean detached checkout of develop at 53a1d5e, after `npm ci`. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create, all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: OK; its output is not recorded.
  - The preflight on its own: cadence path, 3 dispatch runs, gaps 15.4 and 14.5 min; no leftovers.
- **Command:** the planned one, unchanged. No `--skip-sweeper-check`.
- **Console:** `gamerule doDaylightCycle false` once, `time set day` before each scenario (3 lines in the raw `latest.log` in `captures/raw/`; the committed `server.log` excerpts start at each scenario's marker, so they do not show them), then the runner's scenario commands. No difficulty change; nothing on the live server.
- **Batch 1 raw files** were moved to `captures/raw/batch1-20261101/` first.

**Real times (UTC)**

| Event | Time |
| --- | --- |
| Batch start | 23:31:00 |
| Server created | 23:31:07 |
| Ready | 23:34:14 |
| `g2-blocks-named` | 23:34:20 to 23:34:41 (19 s) |
| `g2-mobs-named` | 23:34:44 to 23:37:36 (169 s) |
| `g2-items-roundtrip` | 23:37:39 to 23:39:34 (112 s) |
| EXIT-trap teardown | started 23:39:44; "verified gone" 23:39:57 |

- **Server up:** 9 min.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 23:40:12 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.

**Results.** Every run had `gateValid: true`, `weakenedParams: []`, no `notGate` reasons and no kicks.

| Scenario | Verdict | Details |
| --- | --- | --- |
| `g2-mobs-named` | **PASS** | 12/12 named, 12/12 confirmed by run tag, 7 of them modded. **Replaced 1 of 12** (cap 3): `charm:spectre` vanished, replaced by `quark:stoneling`. `otherSeen` is empty; no placeholder names. |
| `g2-items-roundtrip` | **PASS** | `items_table` 643/643; `items_read`, `items_named` and `items_roundtrip` 30/30 each. |
| `g2-blocks-named` | FAIL | `login_online` FAIL ("driver exited with code 0 before joining"); the other three checks not reached. No census, so no `metaDrift` or samples. |

**Why blocks did not run.** `driver.log`: `Failed to obtain profile data for FRCFLD, does the account own minecraft?` (minecraft-protocol `microsoftAuth.js:31`), 1 s after the driver started.
- prismarine-auth swallows any error from the profile fetch (`fetchProfile(...).catch(debug)`), and minecraft-protocol then throws this generic message, so the real cause is not logged.
- It was transient: the same cache passed `--check` at about 23:30 and logged in normally for mobs (23:34:52) and items (23:37:46).
- The server log shows no join attempt for the blocks session.
- Not to be investigated with `DEBUG=prismarine-auth`: that prints tokens.

**Proposals (the lead decides):**
1. **Batch 3, blocks only:** the same command with only the `g2-blocks-named` line, on a new written GO. About 15 min and EUR 0.14.
2. **One login retry in the runner** (`test/runner/lib/session.mjs`, mine): if the driver exits before joining with exactly this profile-fetch error, start it once more and record the retry in notes. `login_online` would still pass only if the bot joins. This would hide a single transient failure, so it needs your approval.
3. **net-forge:** log the profile fetch's HTTP status (no tokens, no body), so the next failure says why.

**Whether G2 can combine batches is your call:** mobs and items from batch 2 plus blocks from a batch 3, or all three in one batch.

**Evidence:** `test/evidence/g2/batch2-20261101/` (this PR), redacted with the merged tool; the CI leak check passes.

### G2 batch 1 (2026-11-01): FAIL; the server is deleted

**Run conditions**
- **GO:** the lead, 22:03 UTC.
- **Code:** a clean detached checkout of develop at 36d7ee8, after `npm ci`. All three `result.json` show `git.dirty: false` and `untracked: 0`.
- **Checks right before the create, all passed:**
  - `agentNaming('.')`: `wired: true`, all 643 entries round-trip.
  - `msa-login FRCFLD --check`: OK. Its output is not recorded.
  - The preflight on its own (`up --dry-run`): sweeper OK via path (a), a scheduled run 54 min old; no leftover labelled resources.
- **Command:** the planned one, unchanged (one CPX42, nbg1, `--ttl-hours 2`). No `--skip-sweeper-check`.
- **Console:** only `time set day` and `gamerule doDaylightCycle false`, plus the runner's scenario commands. Nothing on the live server.

**Real times (UTC)**

| Event | Time |
| --- | --- |
| Batch start | 22:10:12 |
| Server created | 22:10:20 |
| Ready | 22:13:02 |
| `g2-blocks-named` | 22:13:10 to 22:20:18 (425 s) |
| `g2-mobs-named` | 22:20:18 to 22:22:07 (106 s) |
| `g2-items-roundtrip` | 22:22:07 to 22:23:58 (108 s) |
| EXIT-trap teardown | started 22:24:07; "verified gone" 22:24:20 |

- **Server up:** 14 min (plan about 37, hard stop 56).
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 22:24:37 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.

**Results** (`captures/raw/g2-*/result.json`). Every run had `gateValid: true`, `weakenedParams: []`, no `notGate` reasons and no kicks.

| Scenario | Verdict | Checks |
| --- | --- | --- |
| `g2-items-roundtrip` | **PASS** | all 5 passed. `items_table`: 643/643. `items_read`, `items_named`, `items_roundtrip`: 30/30. |
| `g2-blocks-named` | FAIL | `login_online` and `blocks_named` passed (50 non-air types). `blocks_confirmed` failed (0/150). `blocks_spotcheck` failed (0 of 40; it stopped after 16 positions and 10 failures). |
| `g2-mobs-named` | FAIL | `login_online` passed. `mobs_named` failed (9/12). `mobs_confirmed` failed (10/12). |

**Findings**
1. **Parser bug, fixed in #64.** The server prints `Successfully found the block at -38, 72, -58`: commas with spaces, no full stop. The parser expected the lang form `x,y,z.`, so every confirmation counted as a failure. This was a false fail, never a false pass. The server log has 158 success lines out of 166 `testforblock` calls.
2. **Dynamic Trees state drift** (needs a decision). The other 8 replies were `had the data value of N (expected: M)`, all on `dynamictrees`/`dynamictreesbop` leaves and branches.
   - In every case the name was right; only the meta differed (for example 14 against 6, the 8 bit).
   - These blocks change state over time, and the samples were checked 2-5 min after the census.
   - So even with #64, `blocks_confirmed` would be 142/150 and still fail under the exact rule.
   - **Proposal:** re-ask the bot for each sample position right before its `testforblock`, and require (a) the fresh answer to equal the server exactly and (b) the fresh name to equal the census name. Every verdict stays the server's, comparing the same moment.
3. **Vanilla animals that can't exist in RotN** (needs a decision). The server refused to summon `minecraft:chicken` and `minecraft:pig` (`Unable to summon object`); Animania probably replaces vanilla animals as they join. They come from `common-mobs.json` (rotn-data, built from spawn lists). **Proposal:** either rotn-data drops mobs that can't be summoned, or the scenario replaces a refused summon with the next mob in rank and notes it. A refusal is the server's, not the bot's.
4. **`charm:spectre`** (needs a decision). It was summoned but was gone before the bot looked (`kill` didn't find it either). It probably vanishes in daylight. **Proposal:** right before asking the bot, `testfor` each summoned entity; any the server no longer has are replaced and noted, and the bot must report all the rest.
5. **`mobs_confirmed` checked ambient mobs** (needs a decision). It ran `testfor` on every entity the bot reported, including two untagged, never-summoned Animania animals (`cow_angus`, `calf_angus`) that had walked out of the 3-block radius by then. **Proposal:** confirm only the summoned, run-tagged entities (`@e[tag=<run tag>,type=...]`); other reports go to notes.
6. **Time Shall Not Pass re-enables the daylight cycle on each player connect** (FYI). It logged "Daylight Cycle Module: The daylight cycle has been enabled" at each join, so `gamerule doDaylightCycle false` did not hold. **Proposal:** approve `time set day` before each scenario for the re-run (test server only).
7. **A pack mod runs commands as the player on join** (FYI, not ours). The log shows `[FRCFLD: Game rule commandBlockOutput/sendCommandFeedback has been updated to false]`, and on the first join also `Given [Bread]` / `Given [Bundle]`. `git grep` finds neither gamerule in this repo. The runner's console replies were unaffected.

**Evidence:** raw output is in `captures/raw/g2*` (git-ignored). The redacted `test/evidence/g2/` comes in the evidence PR.

## Planned real batches

### G2 batch (batch 1 ran on 2026-11-01 and FAILED; this is the re-run plan, updated after the lead's decisions on #65. It needs a new written GO.)

**Goal:** G2 gate evidence. All three G2 scenarios at the gate parameters (no `--param` overrides, so the default `dataRoot`), with the agent's own naming, on one disposable test server.

**Preconditions, all checked right before the run:**
1. The lead's written GO in `coord/STATUS-rotn-lead.md`.
2. #47 merged: `packages/rotn-data/3.3.4/common-mobs.json` is on develop and lists at least one modded mob. Otherwise `g2-mobs-named` is `notGate` by design, and the batch would only be a smoke run.
3. The naming path is wired. The runner's own check (`agentNaming`) must report "all N table entries round-trip", with no failures. On develop at eedab96 it reports `wired: true`, all **643** entries (checked 2026-11-01 21:45 UTC). I check it again offline before creating the server:

   ```bash
   node --input-type=module -e "import { agentNaming } from './test/runner/lib/g2.mjs'; console.log(agentNaming('.'))"
   ```
4. **#54 merged:** the driver (net-forge's `g1-driver.mjs` answering the G2 protocol). See "Driver" below.
5. `msa-login.mjs FRCFLD --check` prints the profile name. If it asks for a new login, stop and add a NEEDS-HUMAN entry. Its output **never** goes into evidence or any committed file.
6. `test-server.sh`'s sweeper preflight passes unchanged; no `--skip-sweeper-check`.
7. The code is the develop head, with no local changes. `result.json` records `git.sha` and `git.dirty`, and a dirty run doesn't count.
8. **net-forge's mod-entity-table wiring merged**, so modded mobs carry their real registry names (not placeholders).
9. **rotn-data's second dump import merged.**
10. **#57 merged:** the census waits for the cube's chunks and counts unloaded positions apart; more than 1% unloaded makes the run `notGate`.
11. **#53 merged** (the minimal environment for the naming check), and `agentNaming('.')` (precondition 3) **rerun on develop under that reduced environment**: `wired: true`, all entries round-trip.
12. **For the re-run after batch 1:**
    - #64 merged: `testforblock` replies in the real server's form;
    - #67 merged: findings 2-5 (re-asked block samples, mob replacements capped at 3, tagged confirms, placeholder names fail);
    - #66 merged: the batch 1 evidence plus the redaction tool and CI leak check;
    - and a **new** written GO from the lead.

**Driver (agreed: net-forge's #54).**
- **The driver:** net-forge's `packages/forge-bridge/tools/g1-driver.mjs`. It already builds the bot with the real `initBot` (`src/utils/mcdata.js`) with forge-bridge attached, and speaks the G1 protocol through `attachScenario`. The G2 extension is about three lines in **their** file:

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
- **Console use (test server only, never the live server):**
  - **Before the first scenario**, approved by the lead on the disposable test server only: `gamerule doDaylightCycle false`. **No** peaceful difficulty.
  - **Before each scenario**, approved by the lead on #65 for the disposable test server only: `time set day`, so the bot isn't attacked at night. Batch 1 showed that Time Shall Not Pass re-enables the daylight cycle whenever a player connects, so the gamerule alone does not hold.
  - **During the scenarios**, through the runner: `say`, `seed`, `tp`, `tell`, `testforblock`, `testfor`, `summon`, `kill @e[tag=<run tag>]`, `clear` and `give`.

**Command** (one server, three scenarios in sequence, each with its own bot session):

```bash
deploy/test-server.sh run --yes --ttl-hours 2 -- bash -c '
  C() { bash "$TEST_SERVER_CTL" console --wait 2 -- "$@"; };
  C gamerule doDaylightCycle false;
  D="node packages/forge-bridge/tools/g1-driver.mjs";
  C time set day; timeout 15m node test/runner/run.mjs --scenario g2-blocks-named    --out captures/raw/g2-blocks -- $D; b=$?;
  C time set day; timeout 15m node test/runner/run.mjs --scenario g2-mobs-named      --out captures/raw/g2-mobs   -- $D; m=$?;
  C time set day; timeout 15m node test/runner/run.mjs --scenario g2-items-roundtrip --out captures/raw/g2-items  -- $D; i=$?;
  bash "$TEST_SERVER_CTL" fetch logs --out captures/raw/g2/server;
  echo "blocks=$b mobs=$m items=$i"; [ "$b$m$i" = 000 ]'
```

- **Timeout:** each `run.mjs` is wrapped in `timeout 15m` (exit 124 if hit). A hung scenario can't stop the log fetch, and the server is deleted by the `run` EXIT trap either way.

**Time and cost.**

| Step | Expected |
| --- | --- |
| Server build and boot (batch 1: 3 min from create to ready; G1 took longer) | about 5-15 min |
| `g2-blocks-named`: login, settle 20 s, census, about 150 samples re-asked in about 19 batches of 8 and each checked with `testforblock`, then about 100 spot positions. Batch 1 took 7 min without the re-asks. | about 10-12 min |
| `g2-mobs-named`: login, 12 summons plus replacements, 1-4 verify rounds of 12 tagged `testfor` 10 s apart, the reply, about 12 `testfor`. Batch 1 took 2 min. | about 3-5 min |
| `g2-items-roundtrip`: the full-table check, login, `clear`, 30 `give`, one reply. Batch 1 took 2 min. | about 2-5 min |
| **Total** | **about 20-37 min**: 1 billed hour, about **EUR 0.14** plus 1 Primary IPv4-hour |

- **Hard stop:** past **56 min (1.5x)** I stop and delete the server.
- **Worst case** if everything else fails: TTL + 1 h = 3 h, about **EUR 0.42** plus IPv4.

**After the run.**
- If a scenario used the one login retry (`notes.loginRetry.retried`, approved by the lead on #71), the evidence README says so, for that scenario.
- Confirm `hcloud server list` and `hcloud primary-ip list` are empty, and record the real start and stop times and the cost here.
- Raw files stay in `captures/raw/` (git-ignored). Sanitized evidence goes to `test/evidence/g2/` in a PR: each `result.json`, plus `server.log` excerpts with the world seed and cube centre.
- **Redaction**, in every committed `server.log` excerpt and in `result.json` (`notes` included), following the G1 evidence's conventions:
  - the 1.12 log's `FRCFLD[/IP:port] logged in`, which is this PC's public IP, becomes `<ip>:<port>`;
  - **every** IPv4 and IPv6 address becomes `<ip>`;
  - every player UUID becomes `<uuid-v4>`;
  - local paths are replaced.
- **A check that fails the evidence PR:** a unit test over `test/evidence/g2/**` fails if any IPv4 address (four dotted octets 0..255) or IPv6 address, or any unredacted UUID, is left. It goes in with the evidence PR, so CI enforces it.
- The `msa-login --check` output is never part of the evidence.

**What the G2 evidence will claim.** Only the checks of the three scenarios:
- the 50 most common non-air blocks near spawn named, server-confirmed and consistent with spot checks;
- the common mobs from `common-mobs.json`, modded included, named and confirmed;
- 30 vanilla items read and named, with the full table round-tripping through the agent's `mcdata.js`.

Nothing about crafting, survival or reconnects.

**Reply strings: confirmed by batch 1.** All of these matched the real server:
- `Found <name>`;
- `Object successfully summoned` and `Unable to summon object`;
- `Given [...] * 1 to NAME`;
- `Seed: N`;
- `Selector '...' found nothing`.

The exception was `testforblock`: it prints `x, y, z` with no full stop, which #64 fixed.

**Known risk for the re-run:** the tagged `testfor @e[tag=...,type=...,x=,y=,z=,r=3]` selector hasn't been run on this server yet. If it never matches, `mobs_confirmed` fails and every summon counts as "vanished" (so the run is notGate). Neither can pass falsely.

## Blocked

- **G2 blocks:** a new written GO, and the lead's choice on proposals 1-3 under G2 batch 2.

## Requests to other agents or the lead

0. ~~Lead, routed to net-forge: the G2 driver~~ **Agreed:** net-forge's `g1-driver.mjs` with the G2 protocol, in #54.

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

- This PR: G2 batch 2 evidence and this status update (`agent/harness-ops/g2-batch2-evidence`).
- Merged since the last update: #58, #64, #65, #66, #67.
