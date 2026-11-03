# Status: harness-ops

Updated: 2026-11-03 (02:37 UTC, from `date -u`)

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

- **Phase 3 (G3).**
  - The G3 plan, the driver interface proposal, the CX23 plan and the human items H1-H6 are merged (#101).
  - **S1 is done.** S1-A's evidence and findings are merged (#113); the S1 tooling is in #106.
  - **The lead's decisions after S1-A:**
    - the G3 world is the G2 world (seed 1880465901402976865, cube -45 66 -66);
    - **S1-B is cancelled**;
    - the dawn bound is provisional until the first G3 smoke batch;
    - memory: option 1 (Requests item 13).
  - **The G3 driver is merged (#116)** (`test/runner/drivers/mindcraft-driver.mjs`). It runs the real Mindcraft agent under the runner contract:
    - no task files, and it refuses skills-rotn's `MINDCRAFT_ROTN_ALLOW_TASK_FILES` too;
    - no insecure settings;
    - no process left behind on a stop.
    - It is tested offline with a fake `main.js`.
  - **Merged (#122, 2b30405), required before any G3 paid batch (lead, #116 review):**
    - **`test/runner/batch.mjs`:** the batch spend stop at `maxBatchUsd` USD 2. It reads the key's usage before every scenario (numbers only), stops above the limit, always fetches the logs, and exits 5. Without a reading it refuses to start.
    - **Per scenario:** LLM calls and cost recorded in `result.json` (`llm`). An unknown cost is notGate.
    - **G3 console allowlist:** no `give`, `summon`, `kill` or op commands.
    - **`Server` is test-only:** the driver refuses a production `settings.js` that lists it as a task giver.
    - **#122 review fixes:**
      - the end of a batch fails closed (over the limit exits 5, no reading exits 6);
      - the test-mode overrides are refused inside a real test-server run, and `testMode` is recorded;
      - every G3 scenario has `llm: true` and `maxBatchUsd` 2 'equal' (unit test), with the guard whenever `llm` is true;
      - a G3 run without `batch.mjs`'s `ROTN_G3_BATCH` marker is notGate;
      - `llm` is in progress and killed records;
      - the spend is checked between scenarios only, as documented in DRIVER.md.
  - **CX23 GO 1, the read-only probe: DONE (#128, 8fcec45). The cx23 terminal is closed** (opened 22:05:21, closed 22:06:05 UTC on 2026-11-02, checked with `orca terminal list`).
    - **Where:** in the human's workspace `/tmp/mindcraft-RotN`. Only the approved read-only commands ran, with `ls -la /root` last. No installs or writes. Nothing under `/root/.ssh` was read.
    - **The human's other workspaces** were left alone: `/tmp/mindcraft` and `/root/orca/workspaces/mindcraft/tunicate`, plus their two terminals.
    - **Evidence:** `test/evidence/cx23/`. The findings table is in its README.
    - **Ubuntu: 26.04.1 LTS.** The human chose to keep it (ADR 0007, #134). The bootstrap accepts it (#137, f028e9b; its re-review nits in #144, 655bcaa), and the 26.04 CI job (#135, 05b1a5b) passes. All GO 2 prerequisites are merged; the lead is handing the bootstrap steps to the human.
    - **RAM and swap:** 2 vCPU, 3,814 MB RAM, **no swap**.
    - **Disk:** 38 GB, 6% used.
    - **What setup will change:**
      - turn on ufw (SSH only);
      - add a 2 GB swapfile;
      - install Node 22;
      - create the `deploy` and `mindcraft-rotn` users, the unit, the scripts, the sudoers rule and the folders.
      - Unattended upgrades are already on.
    - **Unexpected or worth noting:**
      - **no firewall is active** (ufw is inactive and the nft ruleset is empty);
      - **sshd allows password logins** (`passwordauthentication yes`);
      - **only SSH (port 22) is public.** Orca's server listens on loopback only.
      - The users are root and nobody only. The running services are a standard cloud set. Nothing of ours is there yet.
    - GO 2 waits on the human (Ubuntu 26.04 against the 24.04 pin, and sshd password logins); the lead is asking.
  - **Merged (#129, c2d6867): the #122 review nits**, with the #129 review fixes (its re-review nits 1-3: #139, f1fd589):
    1. **The G3 gate evidence is cross-checked against `batch.mjs`'s summary** (`test/tools/g3-batch-check.mjs`), because the `ROTN_G3_BATCH` marker alone can be forged.
       - The check is forced: CI fails on any G3 `result.json` anywhere under `test/evidence/` that no `batch.json` in its own folder or a parent folder covers.
       - Each result is bound to its batch by its `runId`, which `batch.mjs` reads back from the scenario's `result.json`. A second, hand-run result under a reused batch id therefore fails.
    2. **The wiring test** checks the G3 scenarios only. While there are none, it is skipped visibly with "no G3 scenarios yet".
    3. **Timeouts:** a timed-out scenario is recorded as 124, whatever run.mjs exits.
    4. **Spawn errors:** a runner that cannot start is recorded as 127 instead of hanging the batch.
    - **Nit 5 (a stricter fake-cloud check) is not done.** `TEST_SERVER_FAKE_CLOUD=1` is already set only with `ROTN_TEST_MODE=1`, the fake state and a non-default hcloud binary.
  - **Next:** the G3 arbiters library (inventory by count-only `clear`, the stat objectives with absent read as 0, deaths, leaves and no-cheat), then the scenarios once skills-rotn's chat formats are agreed.
- **G2 PASSED** on batch 8 (#97): blocks, mobs and items all gate-valid in one batch on the fixed world and cube.
- **History:**
  - G2 batches 1-4 FAILED. The lead's decisions went into #64, #66, #67, #73, #77 and #79, and the double-plant fix into #80-#82.
  - Batch 5 PASSED (#83), but its world had no double plants, so the lead fixed the world (#85).
  - Batch 6 FAILED: its spawn on a canopy made the cube 90% air (#88). The lead then fixed the cube (#92).
  - Batch 7 FAILED: items was kicked for an invalid move packet (#93); net-forge's movement guard followed (#95).
  - The redaction and runner follow-ups are in #94 and #96.
- **Follow-up (lead, not blocking):** in `g2-mobs-named`, require a run-tagged entity within 1 block of a matched mob report.

## Watching

- rotn-data's #47 (first RotN 3.3.4 dump, `common-mobs.json`): the G2 batch waits for it.

## Real S1 batches

### S1-A (2026-11-02): the G2 world, a survey (never a gate). Cut short by this PC's memory; the server is deleted

The full record is in `test/evidence/s1/s1a-20261102/README.md` (this PR).

- **Run:**
  - The GO came from the lead at 19:09 UTC; the code was develop 16db8ac, clean.
  - Checks before the create: `msa-login --check` exit 0 (output discarded); the preflight on its own (helper path); an empty project.
  - The command was the planned one, unchanged; only S1's console commands were used.
- **Times (UTC):** start 19:12:08, ready 19:15:15, survey 19:15:17-19:18:50, arbiters 19:18:50-19:20:15, day cycle from 19:20:15. "Verified gone" at 19:57:08.
- **Cost:** up 44 min, 1 billed hour, about **EUR 0.14** plus 1 IPv4-hour. At 19:57:13 the project was empty, apart from the human's unlabelled SSH key.
- **What broke:**
  - At about 19:55 Claude Code reaped the batch's tracking shell and my hard-stop watcher, because the PC was critically low on memory. The batch processes kept running unsupervised.
  - Following the GO ("stop, delete, report"), I fetched the server logs by hand at 19:56:27.
  - At 19:56:37 the day-cycle run failed by itself: a console call could not start a process on the PC (Windows `0xC0000142`).
  - The batch's EXIT trap then deleted everything normally.
  - S1-B was not started.

**Findings:**

- **World 1880465901402976865 (radius 48 around the fresh spawn -50.5 64 -66.5).** The census was complete: 323 types, 0 unloaded.
  - **Rock piles: 203 blocks,** mostly `pyrotech_compat:rock_metamorphic`, `_igneous` and `_sedimentary`, plus `pyrotech:rock` 4. They are on the surface, 19-46 blocks from spawn.
  - **Trees:** 8,521 blocks. **Stone:** 406,694 blocks of Underground Biomes stone.
  - **Containers: 7 blocks in two underground dungeons:** 2 `minecraft:mob_spawner` and 5 `minecraft:chest`. They are 38-45 blocks below spawn and 34-41 blocks away; every sampled position was server-confirmed.
  - **172 unclassified modded types** are listed for the lead (leaves, `osv:*` ore variants, cave moss, gases, plants, `pyrotech:rock_grass`); none has a container-like class.
- **Reply forms (the parsers matched the real server):**
  - `<bot> has N items that match the criteria`;
  - `Could not clear the inventory of <bot>, no items to remove`;
  - `Added new objective '<name>' successfully`, and `No objective was found by the name '<name>'`;
  - `Showing N tracked objective(s) for <bot>:` with `- <name>: <score> (<name>)`;
  - `Time is N`.
  - **For G3:** `scoreboard players list` omits objectives that have no score yet, so an absent objective reads as 0.
- **Craft stats:** all exist on RotN 3.3.4: `pyrotech.crude_axe`, `contenttweaker.crafting_tools`, `minecraft.crafting_table`, `minecraft.stone_pickaxe`, `minecraft.stone_axe`, `minecraft.cobblestone`, plus `stat.deaths` and `stat.playOneMinute`.
- **The count-only `clear`** really removes nothing: it counted 1, then 1 again, for the given pickaxe.
- **The whisper sender:** a console `tell` reaches mineflayer's `whisper` event as **`Server`**.
- **The day cycle** (from the server log's `Time is N` lines; `time-segments.txt`):
  - running, the vanilla rate: 1,199 ticks per minute;
  - Extended Days **freezes the time twice per cycle, about 10 min each: at 3000 (morning) and at 16000 (early night)**;
  - so a cycle is about 20 min running plus 20 min frozen, about **40 min**; the night (12542-23460) is about **19 min**;
  - not observed: 0-3000 and the wrap past 24000 (the run stopped at 23635);
  - Time Shall Not Pass pauses the cycle while no player is online.

**Proposals for the lead (from S1-A):**

1. **The world.** The G2 world has plenty of rock piles and trees near spawn, but two dungeons 38-45 blocks down.
   - Proposal: keep it. `crafted_by_bot` can now gate for every G3 item (all the stats exist), so tools from a dungeon chest cannot pass. A bot without a pickaxe is also unlikely to reach y 19-26 in 25 min.
   - S1-B (batch 5's world, about EUR 0.14) would give a comparison. The lead decides whether it is still needed.
2. **The dawn bound for `g3-first-night`:**
   - Dawn is the first `time query daytime` sample below 12000 after the bot has seen 13000 or more (the time has wrapped past 24000).
   - Expected about 40 min after the first join on a fresh server: about 20 min of day including the freeze at 3000, plus about 19 min of night including the freeze at 16000.
   - Proposal: the scenario's limit is 55 min, compared 'equal'.
   - The wrap itself was not observed (the run stopped at 23635). The first G3 smoke batch confirms it.
3. **`crafted_by_bot` gates for all five items:** the crude axe, Crafting Tools, the table and both stone tools. That assumes the counters really count when the agent crafts, which the G3 smoke batch checks.

## Real G2 batches

### G2 batch 8 (2026-11-02): PASS (blocks, mobs and items all PASS, gate-valid, one batch, one SHA); the server is deleted

**Run conditions**
- **GO:** the lead, 2026-11-02 16:24 UTC (relayed by the human).
- **Code:** a clean detached checkout of develop at 0bdb537 (#84, #85, #92, #94, #95, #96), after `npm ci`. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create (16:25 UTC), all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: exit 0, output discarded.
  - The preflight on its own: cadence path; no servers or Primary IPs.
- **Command:** the planned one, unchanged.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario. Then the runner's commands, including `tp <bot> -45 66 -66`.

**Real times (UTC):**
- start 16:26:11, created 16:26:28, ready 16:29:18;
- blocks 16:29:26-16:40:05, mobs 16:40:08-16:42:52, items 16:42:55-16:44:44;
- teardown "verified gone" at 16:45:06.

Up 18 min, 1 billed hour, about **EUR 0.14** plus 1 Primary IPv4-hour. At 16:45:19 the server and primary-ip lists were empty; the only SSH key was the human's unlabelled one.

**Results.** All three runs: `pass: true`, `gateValid: true`, `weakenedParams: []`, no notGate reasons, no kicks. Also in all three:
- seed `1880465901402976865`;
- `loginRetry` `{retried: false}`;
- `botStoppedByRunner: true` (128, SIGTERM);
- remap line `applied 506 state ids in 132 of the table's 132 blocks; conflicts 0 skipped`;
- no movement-guard line, and no `movement_trace` in any capture.

| Scenario | Verdict | Details |
| --- | --- | --- |
| `g2-blocks-named` | **PASS** | Cube centre -45 66 -66: teleport confirmed, checked position -44.5 66 -65.5, landing offset 0 (first spawn -51.5 65 -63.5). 50 types. `blocks_confirmed` 150/150, `metaDrift` 0 of 150, `worldChanges` none. Spot check 40 of 40 non-air in 72 positions, 0 unloaded, no skew. |
| `g2-mobs-named` | **PASS** | 12/12 named and confirmed by run tag, 7 modded. Replaced 1 of 12 (`charm:spectre` vanished). |
| `g2-items-roundtrip` | **PASS** | 643/643 table; 30/30 read, named and round-tripped. Joined at the batch 7 kick spot and stayed connected. |

- **Double plants and Dynamic Trees (blocks):**
  - census: `minecraft:double_plant 10` (upper halves) 23 blocks, `double_plant 3` 23 blocks, and 31 Dynamic Trees types;
  - samples: 3 upper-half and 3 meta-3 double plants, plus 93 Dynamic Trees samples, **all server-confirmed**.

**Evidence:** `test/evidence/g2/batch8-20261102/` (this PR). Every file came out of the merged tool; no hand edits. The CI leak check passes. Raw files, including all three captures: `captures/raw/batch8-20261102/`.

### G2 batch 7 (2026-11-02): FAIL (blocks PASS, mobs PASS, items FAIL: kicked for an invalid move packet); the server is deleted

**Run conditions**
- **GO:** the lead, 2026-11-02 15:11 UTC (relayed by the human).
- **Code:** a clean detached checkout of develop at 1bd66cd (#84, #85, #92), after `npm ci`. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create (15:13 UTC), all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: exit 0, output discarded.
  - The preflight on its own: cadence path; no servers or Primary IPs.
- **Command:** the planned one, unchanged.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario. Then the runner's commands, including `tp <bot> -45 66 -66`.

**Real times (UTC):**
- start 15:14:02, created 15:14:26, ready 15:17:32;
- blocks 15:17:40-15:28:28, mobs 15:28:31-15:31:12, items 15:31:15-15:34:52;
- teardown "verified gone" at 15:35:15.

Up 21 min, 1 billed hour, about **EUR 0.14** plus 1 Primary IPv4-hour. At 15:35:22 the server and primary-ip lists were empty; the only SSH key was the human's unlabelled one.

**Results.** Seed `1880465901402976865` and `loginRetry` `{retried: false}` in all three runs. The remap line was the same in all three: `applied 506 state ids in 132 of the table's 132 blocks; conflicts 0 skipped`.

| Scenario | Verdict | Details |
| --- | --- | --- |
| `g2-blocks-named` | **PASS**, gate-valid | Cube centre -45 66 -66: teleport confirmed, checked position -44.5 66 -65.5 (first spawn -43.5 66 -66.5). 50 types. `blocks_confirmed` 150/150, `metaDrift` 0 of 150, `worldChanges` none. Spot check 40 of 40 non-air in 80 positions, 0 unloaded, no skew. Runner-stopped (128, SIGTERM). |
| `g2-mobs-named` | **PASS**, gate-valid | 12/12 named and confirmed by run tag, 7 modded. Replaced 1 of 12 (`charm:spectre` vanished). Runner-stopped. |
| `g2-items-roundtrip` | **FAIL** (gate-valid parameters) | `items_table` 643/643 and `login_online` PASS. Kicked at 15:31:26, 2 s after the join: server "Invalid move player packet received", client `multiplayer.disconnect.invalid_player_movement`. So `items_read`, `items_named` and `items_roundtrip` got no reply (FAIL). Driver exit 1, not runner-stopped. |

- **Double plants and Dynamic Trees (blocks):**
  - census: `minecraft:double_plant 10` (upper halves) 20 blocks, `double_plant 3` 20 blocks, and 33 Dynamic Trees types;
  - samples: 3 upper-half and 3 meta-3 double plants, plus 99 Dynamic Trees samples, **all server-confirmed**.
- **The kick:** the mobs session had joined at the same position (-44.5 66 -65.5, on dirt) and played normally. The capture has no client position packets, so it cannot show the bad packet itself. Raw capture: `captures/raw/batch7-20261102/FRCFLD-2026-11-02T15-31-20-713Z.jsonl`.

**Evidence:** `test/evidence/g2/batch7-20261102/` (#93). Every file came out of the merged tool; no hand edits. The CI leak check passes. Raw files: `captures/raw/batch7-20261102/`.

### G2 batch 6 (2026-11-02): FAIL (blocks timed out in its spot check; batch stopped); the server is deleted

**Run conditions**
- **GO:** the lead, 2026-11-02 13:41 UTC (relayed by the human).
- **Code:** a clean detached checkout of develop at 2de68ec (#84, #85), after `npm ci` (all patches applied). 0 changes in `git status`.
- **Checks right before the create (13:52 UTC), all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: exit 0; its output was discarded.
  - The preflight on its own: cadence path, 3 dispatch runs; no servers or Primary IPs in the project.
- **Command:** the planned one, unchanged, with `--seed 1880465901402976865`.
- **Console:** `gamerule doDaylightCycle false` once, then `time set day` before blocks and before mobs. Then the runner's commands.

**Real times (UTC):**
- start 13:53:11, created 13:53:32, ready 13:56:05;
- blocks 13:56:12 until the timeout kill at 14:11:12;
- mobs 14:11:15, stopped by me at 14:12:02 after its login (logs fetched by hand at 14:11:51 first);
- teardown "verified gone" at 14:12:17.

Up 18 min, 1 billed hour, about **EUR 0.14** plus 1 Primary IPv4-hour. At 14:12:33 the server and primary-ip lists were empty; the only SSH key was the human's unlabelled one.

**Results**
- **World seed** `1880465901402976865` (the planned world) in both sessions. **Remap line:** `applied 506 state ids in 132 of the table's 132 blocks; conflicts 0 skipped` (#84 works: batch 5 skipped 124).
- **Blocks:**
  - `login_online` PASS;
  - `blocks_named` PASS: 50 of 87 non-air types; air 32360 of 35937; 0 unloaded;
  - `blocks_confirmed` PASS: **150/150**, including the 38 Dynamic Trees types in the top 50, all server-confirmed;
  - `blocks_spotcheck` not reached; no `result.json` (so no `metaDrift`, `worldChanges` or `botStoppedByRunner` fields).
  - 342 `testforblock` confirmations and no mismatch.
- **Double plants:** none in the top 50, the samples or any spot answer.
- **Why blocks ran out of time:**
  - The bot spawned on a Dynamic Trees canopy (y 83, standing on `dynamictrees:leaves0`); batch 4's centre in the same world was -45 66 -66, on the ground.
  - The cube was therefore 90% air. The spot loop needs 40 confirmed non-air answers, and at about 18.5 s per batch of 8 it had 17 non-air of 192 positions after 7.4 min.
  - Reaching 40 needs about 400 positions (the `spotMaxPositions` cap), about 15 min more.
- **Mobs:** login PASS; stopped before any summon. **Items:** did not run.

**Evidence:** `test/evidence/g2/batch6-20261102/` (#88), redacted with the merged tool, plus one manual redaction (the server address in `run.log`; since #92 the tool gives the same file). The CI leak check passes. Raw files: `captures/raw/batch6-20261102/`.

### G2 batch 5 (2026-11-02): PASS (blocks, mobs and items all PASS, gate-valid); the server is deleted

**Run conditions**
- **GO:** the lead, 2026-11-02 02:59 UTC.
- **Code:** a clean detached checkout of develop at 01a8193 (#79-#82), after `npm ci`, which applied #81's prismarine-chunk patch. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create, all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: OK; its output is not recorded.
  - The preflight on its own: cadence path, 4 dispatch runs; no leftovers.
- **Command:** the planned one, unchanged.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario: 4 lines, in the raw `latest.log` only. Then the runner's commands. No difficulty change.
- **Raw files:** batch 4's are in `captures/raw/batch4-20261102/`, including the capture net-forge used.

**Real times (UTC, 2026-11-02)**

| Event | Time |
| --- | --- |
| Batch start | 03:01:57 |
| Server created | 03:02:06 |
| Ready | 03:05:09 |
| `g2-blocks-named` | 03:05:15 to 03:11:52 (394 s) |
| `g2-mobs-named` | 03:11:55 to 03:14:44 (166 s) |
| `g2-items-roundtrip` | 03:14:47 to 03:16:41 (112 s) |
| EXIT-trap teardown | started 03:16:50; "verified gone" 03:17:05 |

- **Server up:** 15 min.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 03:17:20 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.

**Results.** Every run had `pass: true`, `gateValid: true`, `weakenedParams: []`, no `notGate` reasons, no kicks, and `notes.loginRetry` `{retried: false}`. The driver's remap line at login was the same in all three: `state-id remap active: 382 state ids in 94 of the table's 132 blocks`.

| Scenario | Verdict | Details |
| --- | --- | --- |
| `g2-blocks-named` | **PASS** | 20 non-air types; census sum 16706 + air 19231 + unloaded 0 = 35937. `blocks_confirmed` 50/50; `worldChanges` none; `metaDrift` 0 of 50. `blocks_spotcheck` 41 of 40, 80 positions, 0 unloaded, no skew; every spot hit is a census type. |
| `g2-mobs-named` | **PASS** | 12/12 named and confirmed by run tag, 7 of them modded. **Replaced 1 of 12:** `charm:spectre` vanished, replaced by `quark:stoneling`. |
| `g2-items-roundtrip` | **PASS** | 643/643 table entries; 30/30 read, named and round-tripped. |

**Caveats and notes**
- **The double-plant case was not exercised.** The spawn cube (centre -703 65 -210, world seed 8796110535854059511) has sedimentary stone, sand, water and sandstone, and no double plants or Dynamic Trees blocks.
  - The remap is active in all three sessions, and its `minecraft:double_plant` entries (upper-half ids map to meta 10) were not skipped.
  - The 124 skipped entries are all modded blocks, skipped by forge-bridge as "cycle" (e.g. `animania:block_trough`, `artisanworkstumps:*`). None of them is in this cube.
  - The lead decides whether G2 needs a double-plant world.
- **A server-side error, not caused by the bot:** at 03:06:23 (during blocks), `[File IO Thread/ERROR] [Universal Tweaks]: Failed to save chunk` with a NullPointerException in NBT writing. It is a pack-side save error; all checks used the live world. Worth knowing for the live server.

**Evidence:** `test/evidence/g2/batch5-20261102/` (#83), redacted with the merged tool; the CI leak check passes.

### G2 batch 4 (2026-11-02): FAIL (blocks 147/150, mobs PASS, items PASS); the server is deleted

**Run conditions**
- **GO:** the lead, 2026-11-02 01:11 UTC.
- **Code:** a clean detached checkout of develop at 3102f6c (#72-#77), after `npm ci`, which applied #74's prismarine-auth patch. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create, all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: OK; its output is not recorded.
  - The preflight on its own: a scheduled sweeper run 21 min old; no leftovers.
- **Command:** the planned one, unchanged.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario: 4 lines, in the raw `latest.log` only. Then the runner's commands. No difficulty change.
- **Batch 3 raw files** were moved to `captures/raw/batch3-20261102/` first.

**Real times (UTC, 2026-11-02)**

| Event | Time |
| --- | --- |
| Batch start | 01:13:26 |
| Server created | 01:13:32 |
| Ready | 01:16:37 |
| `g2-blocks-named` | 01:16:43 to 01:27:45 (660 s) |
| `g2-mobs-named` | 01:27:48 to 01:30:39 (168 s) |
| `g2-items-roundtrip` | 01:30:42 to 01:32:38 (113 s) |
| EXIT-trap teardown | started 01:32:48; "verified gone" 01:33:04 |

- **Server up:** 20 min.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 01:33:44 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.

**Results.** Every run had `gateValid: true`, `weakenedParams: []`, no `notGate` reasons, no kicks, and `notes.loginRetry` `{retried: false}`.

| Scenario | Verdict | Details |
| --- | --- | --- |
| `g2-blocks-named` | FAIL | 50 non-air types. `blocks_confirmed` **147/150**; `worldChanges` none; `metaDrift` 0 of 147. `blocks_spotcheck` PASS: 43 of 40 non-air, 72 positions, 0 unloaded, no skew. |
| `g2-mobs-named` | **PASS** | 12/12 named and confirmed by run tag, 7 of them modded. **Replaced 1 of 12:** `charm:spectre` vanished, replaced by `quark:stoneling`. |
| `g2-items-roundtrip` | **PASS** | 643/643 table entries; 30/30 read, named and round-tripped. |

**The 3 failures: double plant upper halves (needs an owner).**
- All three failures are double plant upper halves in chunk (-3, -4): -44,67,-58; -38,70,-50; -36,71,-50.
- At each, the bot's census and fresh answers say `minecraft:double_plant 11`, and the server says data value 10.
- The census has `double_plant 11` (24 blocks) and no `double_plant 10`. The lower halves (`double_plant 3`) were confirmed 3/3.
- In 1.12 an upper half's meta is `8 | facing.getHorizontalIndex()`, and a generated plant gets the default NORTH (= 10). So the server's 10 is the expected value, and the bot's 11 suggests its decode of this block state differs (unverified).
- **Data for whoever takes it:** the blocks session's forge-bridge capture holds the `map_chunk` for chunk (-3, -4). It is in `captures/raw/` on this PC and not committed. Decoding it offline shows whether the server sent 10 (a client-side decode bug) or 11 (a server-side mismatch between the chunk and `testforblock`).

**Not related:** three `betterwithmods` `[EXPLOSION]` lines at (118, 6, -216), about 160 blocks away and underground, at 01:18. The `lost connection: Disconnected` at 01:30:36 is the driver's own quit.

**Evidence:** `test/evidence/g2/batch4-20261102/` (#78), redacted with the merged tool; the CI leak check passes.

### G2 batch 3 (2026-11-02): FAIL (blocks 110/111, mobs PASS, items PASS); the server is deleted

**Run conditions**
- **GO:** the lead, 2026-11-02 00:26 UTC.
- **Code:** a clean detached checkout of develop at 1a396f5 (#72, #73), after `npm ci`. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create, all passed:**
  - `agentNaming('.')`: wired, 643/643.
  - `msa-login FRCFLD --check`: OK; its output is not recorded.
  - The preflight on its own: cadence path, gaps 15.4 and 14.5 min; no leftovers.
- **Command:** the planned one, unchanged.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario. That is 4 lines in the raw `latest.log` only, since the committed excerpts start at each marker. Then the runner's commands. No difficulty change.
- **Batch 2 raw files** were moved to `captures/raw/batch2-20261101/` first.

**Real times (UTC, 2026-11-02)**

| Event | Time |
| --- | --- |
| Batch start | 00:28:34 |
| Server created | 00:28:44 |
| Ready | 00:31:49 |
| `g2-blocks-named` | 00:31:55 to 00:41:50 (592 s) |
| `g2-mobs-named` | 00:41:53 to 00:44:09 (133 s) |
| `g2-items-roundtrip` | 00:44:12 to 00:46:06 (112 s) |
| EXIT-trap teardown | started 00:46:14; "verified gone" 00:46:30 |

- **Server up:** 18 min.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 00:46:47 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.

**Results.** Every run had `gateValid: true`, `weakenedParams: []`, no `notGate` reasons, no kicks, and `notes.loginRetry` `{retried: false}`.

| Scenario | Verdict | Details |
| --- | --- | --- |
| `g2-blocks-named` | FAIL | 39 non-air types. `blocks_confirmed` **110/111**; `metaDrift` 0 of 110. `blocks_spotcheck` PASS: 40/40 non-air, 88 positions asked, 0 unloaded, no skew. |
| `g2-mobs-named` | **PASS** | 12/12 named and confirmed by run tag, 7 of them modded. 0 replaced. `otherSeen`: one natural `primitivemobs:grovesprite`. |
| `g2-items-roundtrip` | **PASS** | 643/643 table entries; 30/30 read, named and round-tripped. |

**The failed sample.** `-56,95,-58 census biomesoplenty:plant_0 0 fresh minecraft:air 0 server found: FAIL`.
- The census (about 00:33) named a plant there.
- At the re-ask (00:33-00:38) the bot said air, and the server confirmed air.
- The bot was right both times; the plant was gone. The #67 rule (fresh name must equal the census name) fails it.
- Why the plant went is not logged. A mob, or a neighbouring block change that pops a plant, could do it.
- The 11 other `plant_0` samples were confirmed.

**Proposal (the lead decides).** Like the mob replacements, a sample whose block **changed name** since the census becomes a world change, provided the server confirms the bot's fresh answer **exactly**. In that case:
- it is recorded in `notes.worldChanged`;
- it is replaced by another candidate of the same census type (5 unpicked candidates per type remain), which must pass the full rule;
- more than 2% of samples (3 of 150) changed makes the run notGate.

Nothing is tolerated on naming: each counted sample still needs census name = fresh name = the server's answer. The alternative is to keep the rule as it is and re-run: this happened to 1 of 111 samples.

**Evidence:** `test/evidence/g2/batch3-20261102/` (#76), redacted with the merged tool; the CI leak check passes.

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

**Evidence:** `test/evidence/g2/batch2-20261101/` (#71), redacted with the merged tool; the CI leak check passes.

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

### CX23 first run (the plan; nothing touches the CX23 until the lead's written GO for each step)

The CX23 is the bot's own VPS, reachable as the Orca SSH target **`cx23`** (root, by an SSH key on this PC that the human added). After the bootstrap, the human replaces it with **`cx23-deploy`** (H3). It is not the live server, which stays off-limits.

**The human's decisions on #101:**
- no lockdown;
- the target swap instead;
- only the test OpenRouter key for now (USD 5);
- the first CX23 start joins a disposable test server, with the CX23's IP supplied by the human at that GO.

**Ground rules:**
- I never read, print or copy the key or Orca's SSH settings, and I never run `ssh` or `scp` myself.
- Commands go through an Orca terminal on the SSH target: a folder workspace on that host, which is Orca metadata only, and `orca terminal create/send/read`.
  - Root work (GO 1, GO 2) goes through `cx23` before the human's target swap (H3).
  - Everything after goes only through `cx23-deploy`.
- The server's IP address appears nowhere in the repo or STATUS; I use the name `cx23`.
- Raw output stays in `captures/raw/cx23/` (git-ignored). Anything committed goes through `test/tools/redact-evidence.mjs` and the CI leak check, plus a manual read before the PR.

#### Step 1: a read-only probe (GO 1)

- **No installs and no changes.** No `apt update` (it writes package lists), no file writes, no service changes. Each command only reads.
- **The commands:**
  - **OS and hardware:** `cat /etc/os-release`, `uname -r`, `nproc`, `lscpu | head -20`, `free -m`, `swapon --show`, `df -h /`, `lsblk -o NAME,SIZE,TYPE,MOUNTPOINT`, `timedatectl`.
  - **Network (no addresses needed):** `ss -tulpn` (listening sockets), `ufw status verbose`, `nft list ruleset | head -50`.
  - **SSH config, effective:** `sshd -T | grep -Ei '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|allowusers|kbdinteractiveauthentication) '`.
  - **Users:** `getent passwd | awk -F: '$3==0 || $3>=1000'` (names, uids and shells only), `ls -ld /home/*`, `ls -l /etc/sudoers.d`.
  - **Services:** `systemctl list-units --type=service --state=running --no-pager`, `systemctl list-unit-files --state=enabled --no-pager`.
  - **Packages:** `dpkg -l nodejs git unattended-upgrades ufw 2>/dev/null | tail -n +6`, `command -v node git`, `cat /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null`.
  - **Our footprint (expected: none):** `ls -ld /opt/mindcraft-rotn /var/lib/mindcraft-rotn /etc/mindcraft-rotn 2>&1`, `id deploy mindcraft-rotn 2>&1`.
- **Not read:** `authorized_keys`, `/etc/shadow`, environment variables, shell history, `ip addr` (MAC and public addresses).
- **Output:** saved from `orca terminal read` to `captures/raw/cx23/probe-<date>.txt`. Then redacted with the tool into `test/evidence/cx23/probe-<date>.txt`: every IPv4 and IPv6 address becomes `<ip>`, and local paths become `<local>`. The hostname stays only if it does not contain the IP.
- **Then a short findings note in STATUS:** Ubuntu version, RAM and swap, what `setup` will change, and anything unexpected (other users, open ports, running services).

#### Step 2: the bootstrap (GO 2, through `cx23` as root, after the probe and H1; then the human's H2 and H3)

**What `deploy/cx23/bootstrap.sh setup` does** (README "One-time bootstrap"; tested offline in `test/unit/cx23.test.js`, plus shellcheck and `systemd-analyze verify` in CI):
- **Users:**
  - `deploy`: key login only, groups `sudo` and `mindcraft-rotn`;
  - system user `mindcraft-rotn`: no login, home `/var/lib/mindcraft-rotn`. The bot runs as this user.
- **Updates and resources:** unattended **security** upgrades (`20auto-upgrades`); a 2 GB `/swapfile` with `vm.swappiness=10` if no swap exists.
- **Firewall:** ufw denies all incoming except SSH (it allows SSH before enabling ufw, so the session survives). The bot needs no inbound port, and the MindServer UI binds to localhost only.
- **Node 22** from NodeSource's apt repo, with the repo key's fingerprint pinned (`6F71F525...BE0B4`; setup refuses on a mismatch), then git.
- **Installed:**
  - the unit template `mindcraft-rotn@.service`;
  - `/usr/local/lib/mindcraft-rotn/check-env-names` and `check-env` (+ `check-env.mjs`);
  - `/usr/local/sbin/mindcraft-rotn-ctl`;
  - a sudoers rule, checked with `visudo -c`, that lets `deploy` run only `mindcraft-rotn-ctl` without a password.
- **Folders:** `/opt/mindcraft-rotn` (`deploy:mindcraft-rotn` 0750), `/var/lib/mindcraft-rotn`, `/etc/mindcraft-rotn` (`root:mindcraft-rotn` 0750).

**How the unit starts a bot** (`mindcraft-rotn@frcfld`):
1. `ExecStartPre=+check-env-names` runs **as root**. It reads only `/etc/mindcraft-rotn/frcfld.env` (`root:root` 0600), and every line must be a comment, blank, or `NAME=value` with an allowlisted NAME. It prints names and line numbers, never values.
2. `ExecStartPre=check-env` runs as the bot user. It checks the **effective** environment the way `main.js` reads it:
   - it refuses `INSECURE_CODING` and `BLOCKED_ACTIONS` if set at all;
   - `SETTINGS_JSON` may hold only `auth`, `host`, `port` and `auto_open_ui`;
   - it refuses a `DEBUG` that would print tokens;
   - it refuses loader, proxy and TLS-override variables;
   - the token cache folder must exist, be 0700 and be owned by `mindcraft-rotn`;
   - the OpenRouter key must be set and not the placeholder.
3. `ExecStart` runs `node main.js` in the current release.
   - `MINDCRAFT_SINGLE_BOT_SERVICE=1`, so a clean stop exits 0. `Restart=always` with `RestartPreventExitStatus=0 3`: no restart after a clean stop or a fatal kick. `StartLimitBurst=6` per 10 min.
   - `UMask=0077`; memory caps `MemoryHigh=1G` and `MemoryMax=1536M`, to confirm in the soak.

**No lockdown (the human's decision on #101).** Root SSH stays enabled on the CX23. `bootstrap.sh lockdown` stays in the repo but is not run. Instead, the human swaps the Orca targets: after the bootstrap, a new target for `deploy` comes in, and the root target `cx23` is **removed** from Orca. So everything that needs root (GO 1 and GO 2) runs through `cx23` **before** the swap, and afterwards agents work **only** through the `deploy` target.

**The order** (each line run by me through the named Orca target unless marked **human**):
1. **GO 1, through `cx23` (root):** the read-only probe (Step 1).
2. **Human (H1):** the `deploy` public key file on the CX23 (see H1). Agents never see the private key.
3. **GO 2, through `cx23` (root)**, in one sitting:
   1. Get the bootstrap files without copying from this PC: `git clone --depth 1 --branch <tag> https://github.com/JQDAW/mindcraft-RotN /root/mindcraft-rotn-src` (the repo is public).
      - The tag is one the lead creates on develop. I check `git rev-parse HEAD` against the tag's SHA before running anything from it.
      - If git is missing on the image (the probe shows this), the human copies the folder instead.
   2. `bash /root/mindcraft-rotn-src/deploy/cx23/bootstrap.sh setup --deploy-key-file /root/deploy.pub`. No `--ssh-from`: SSH stays open to key logins, and the narrowing is for later, if the lead wants it.
   3. `bash /root/mindcraft-rotn-src/deploy/cx23/bootstrap.sh add-bot frcfld`. It creates `/var/lib/mindcraft-rotn/frcfld/msa` (0700, `mindcraft-rotn`) and `/etc/mindcraft-rotn/frcfld.env` (`root:root` 0600, from `bot.env.example`, with placeholders). It never overwrites an existing file.
   4. Read-only checks as root while I still can:
      - `systemctl cat mindcraft-rotn@frcfld`;
      - `ufw status verbose`;
      - `visudo -c`;
      - `stat -c '%U:%G %a %n'` on `/etc/mindcraft-rotn/frcfld.env` and `/var/lib/mindcraft-rotn/frcfld/msa`;
      - `node -v`.
      - Then I report "GO 2 done" and stop using `cx23`.
4. **Human (H2):** `passwd deploy` in a terminal the human opens as root. This is `deploy`'s own sudo password, which the human needs for H4 and H5.
5. **Human (H3), the target swap:**
   - add the Orca SSH target **`cx23-deploy`** (user `deploy`, the H1 key) and connect once;
   - **remove** the root target `cx23` from Orca;
   - tell the lead.
   - From here on, agents use only `cx23-deploy`. My first action there is a read-only `whoami && id`.
6. **The first release, as `deploy`** (GO 3, through `cx23-deploy`). `/root` is 0700, so `deploy` uses its own copy of the public repo:
   - `git clone --depth 1 --branch <tag> https://github.com/JQDAW/mindcraft-RotN ~/deploy-src`, with the same SHA check;
   - then `bash ~/deploy-src/deploy/cx23/deploy.sh deploy <tag>`. Its paths are fixed under `/opt/mindcraft-rotn`. It makes a bare clone, runs `git archive` of the tag (refusing a tag not on develop) and `npm ci`, and refuses a release whose `settings.js` does not evaluate to `allow_insecure_coding === false`.
   - No bot is enabled yet, so nothing starts.
   - Then `sudo -n mindcraft-rotn-ctl status frcfld` (allowed without a password).
7. **Human, later (H4 and H5):** the bot's long-term OpenRouter key into the env file (H4), and the bot's Microsoft login (H5).
   - The first start needs both: `check-env` refuses a placeholder key, and the bot cannot join without a token cache.
   - The human decided that for now there is only the test key (Requests item 12, for the PC), so the CX23's first start waits for H4.
8. **The first start (its own GO):** it joins a **disposable test server**, never the live one.
   - The human gives the CX23's IPv4 address in that GO message (H6; agents do not look it up). I pass it only on the command line as `deploy/test-server.sh run --allow-from <it>/32`, plus this PC. It never goes into the repo or STATUS, and evidence goes through the redaction tool.
   - Then `sudo -n mindcraft-rotn-ctl enable frcfld` and `start frcfld`, and the journal is watched for `check-env` results and the login. The server is deleted afterwards as in every batch.

**Secrets never pass through chat, git or an agent-read terminal:**
- **Who types them:** the human types the deploy password (H2), the OpenRouter key (H4) and the Microsoft code (H5) in a terminal tab the human opens and titles `HUMAN ONLY`.
- **What protects that tab:** agreement plus order, not a technical barrier.
  - Orca would let an agent read any terminal, so agents agree never to `terminal read` (or list the output of) a tab titled `HUMAN ONLY`.
  - The human does these steps only when no agent step on the CX23 is in progress, and closes the tab afterwards.
- The Microsoft device code lasts minutes.
- The token cache stays in `/var/lib/mindcraft-rotn/frcfld/msa` (0700, `mindcraft-rotn`). No agent reads it, and `check-env` prints no values.

**Undo:**
- Root SSH stays on, so the human can revert anything.
- Through `deploy`, agents can stop and disable the unit (`mindcraft-rotn-ctl stop|disable`) and roll back a release (`deploy.sh rollback`).
- `setup` and `add-bot` are safe to re-run.

**Time and cost:** the CX23 is already paid monthly (about EUR 6.81). The probe takes about 5 min; the bootstrap about 15 min; the first deploy about 15-30 min, mostly `npm ci`.

### G3 batches (the plan; lead, 2026-11-02 after G2 PASSED. Nothing paid without the lead's written GO.)

**Goal:** G3 gate evidence for the three PLAN items:
- rocks to stone tools on a fresh spawn;
- survive the first night;
- a task preempts the agenda, which then resumes.

The brief adds "the queue survives a restart": offline in G3, real on the CX23 in G4 (lead, #101).

**Same rules as G2.**
- The server is the arbiter: every pass condition is read from the server log or the console, never from the bot's own word.
- Gate parameters ('min' or 'equal'); a weakened run is never a gate pass.
- The world seed is recorded and checked; `git.dirty: false`.
- One batch must pass all scenarios on one SHA.
- Evidence goes only through `test/tools/redact-evidence.mjs`, with the CI leak check.
- Unit tests on a simulated server first, offline. Every new console command needs the lead's approval (listed below).

**What changes from G2: the real agent.** The bot under test is the real Mindcraft agent (`main.js` with skills-rotn's profile, agenda and task queue), talking to OpenRouter, not `g1-driver.mjs` alone. So:
- runs are slower and not deterministic;
- each batch has an LLM cost on top of the server;
- the runner never gives hints the human player would not. It whispers only what a task giver would type.

#### World and start state

- **A fresh spawn:** a new test server per batch, so the bot's player data is new. It holds only RotN's start kit (Scroll of New Life, Bundle, bread). At the start the runner confirms with `clear` in test mode (below) that the bot has none of the target items.
- **The world:** a fixed seed, as in G2. Candidates:
  - (a) the G2 world `1880465901402976865`: a forest at spawn, and trees are certain. Rock piles were not in its top-50 census, so their density is unknown.
  - (b) batch 5's world `8796110535854059511`: had `pyrotech:rock` piles (metas 6 and 8) in its spawn cube, so **rocks do generate in the Overworld**, against `rotn-progression.md`'s config reading. But it had no trees in the cube.
  - **Proposal:** decide with survey batch S1 (below), which measures rock piles, trees and exposed stone within 48 blocks of spawn in both worlds.
- **Spawn stone is Underground Biomes stone** (`undergroundbiomes:*_stone` in every G2 census), not `minecraft:stone`. Its rocks are UB rock variants, so "4 rocks to cobblestone" may not give `minecraft:cobblestone`. The scenarios take the accepted outputs from rotn-data's recipe table (every output of a 4-same-rocks recipe), not from a hard-coded name.
- **Difficulty:** the server default (no peaceful), daylight cycle on. `time set day` is used only where a scenario says so.

#### Server-side arbiters (no op mods; 1.12 vanilla commands)

1. **Inventory:** `clear <bot> <item> <meta> 0` in test mode. A maxCount of 0 removes nothing and prints "<bot> has N items that match the criteria". This is the main pass check: it counts what the bot really holds.
2. **Statistics:** scoreboard objectives on stat criteria.
   - **Gating rule (lead, #101):** `crafted_by_bot` **gates** for every item whose craft statistic S1 shows to exist. The vanilla stone tools and the crafting table certainly have one. For the RotN items (crude axe, Crafting Tools) it gates if S1 finds their stat; otherwise those are recorded only.
   - `stat.craftItem.pyrotech.crude_axe`, `stat.craftItem.minecraft.crafting_table`, `stat.craftItem.minecraft.stone_pickaxe`, `stat.craftItem.minecraft.stone_axe`;
   - `stat.mineBlock.<log blocks>`;
   - `stat.deaths` and `stat.playOneMinute`.
   - Read them with `scoreboard players list <bot>`.
   - They prove that the bot itself crafted, which the inventory alone cannot (the crude axe may be used up by Crafting Tools).
3. **Placed blocks:** `testforblock` (as in G2), for example the placed crafting table that the bot reports.
4. **Position:** `tp <bot> ~ ~ ~` (as in G2).
5. **Life:** the server log's join, leave and death lines for the bot (the vanilla death messages "<bot> was slain by", "<bot> died", and so on, and Corpse Complex's lines), plus `stat.deaths`.
6. **No cheating:** the scenario fails if, during the run:
   - the log shows a `Given [` line or a gamemode change for the bot;
   - the bot runs any command (its chat is never a `/`-command reply);
   - or the bot is op (`ops.json` empty, already true on the test server).
   - The runner itself gives nothing in G3.

**Console commands approved for G3 (lead, #101; test servers only, never the live server):**
- `clear <bot> <item> <meta> 0` (test mode only, never a real clear);
- `scoreboard objectives add|remove` and `scoreboard players list <bot>`;
- `time query daytime`;
- `setblock` **only** for the task marker.

G2's list (`say`, `seed`, `tp`, `tell`, `testforblock`, `testfor`, `time set day`, `gamerule doDaylightCycle`) stays. Not `give`, `summon` or `kill` in G3, except in S1.

**Pinned before any gate batch (lead, #101):** these become gate parameters compared 'equal', fixed after S1 and before the first G3 gate batch.
- the dawn bound for `g3-first-night` (from S1's day/night measurement);
- the task marker's position (a surface block in the chosen world, 20-30 blocks from the spawn area);
- the agenda counter that `agenda_active` and `agenda_resumed` read (a named stat or inventory item, chosen from skills-rotn's agenda).

#### Scenario `g3-rocks-to-stone-tools` (ready-to-try item 4)

- **Run:**
  - Login, then the runner checks the start inventory, then the agent plays its agenda with no runner input.
  - The scenario ends when the agent holds the targets, or at `maxMinutes` (default 25, compared **'equal'**, lead #101: a longer limit would be a weaker run).
- **Checks:**
  - `login_online`.
  - `fresh_start`: none of the target items at the start.
  - `stone_tools`: `clear` test finds at least 1 `minecraft:stone_pickaxe` and 1 `minecraft:stone_axe`.
  - `crafting_table`: one is placed (the bot reports its position; the server's `testforblock` confirms), or at least 1 is held.
  - `cobblestone`: at least 1 of the rotn-data outputs of a 4-rocks recipe is held, or placed and confirmed.
  - `crafted_by_bot` (**gating**, lead #101): the craft statistic is at least 1 for the crafting table and both stone tools, and for the crude axe if S1 shows its stat exists.
  - `no_cheat`.
- **Notes:**
  - minutes to each milestone (from periodic `clear` tests every 60 s);
  - deaths, and a position track every 60 s;
  - **LLM calls and cost for this scenario** (see "LLM spend" below).
- **Not claimed:** logs and planks are not separate checks. The table and the tools prove them, and the planks come from the debark interaction, which no stat counts.

#### Scenario `g3-first-night` (ready-to-try item 5)

- **Run:**
  - Fresh spawn; the runner sets nothing about time, so the bot lives a real first day and night.
  - The scenario ends at the first dawn after a full night, by `time query daytime`, against the **pinned dawn bound** (measured in S1, because Extended Days may change the cycle; `rotn-progression.md` says about 20 min of day in a 40 min cycle).
- **Checks:**
  - `login_online`;
  - `survived_night`: no death line and `stat.deaths` 0 from login to dawn;
  - `stayed_online`: no leave or kick line;
  - `no_cheat`.
- **Decided (lead, #101): survival is the night gate; shelter is evidence.** The shelter data is recorded, not gating:
  - at the middle of the night, the bot's position and `testforblock` results for its 6 neighbours and the block above its head;
  - the bot's hunger at dawn, if the bot reports it.
- **Length:** about 40-50 min. This scenario alone is longer than G2's whole batch.

#### Scenario `g3-task-preempts-agenda` (ready-to-try item 10, task part)

- **Run:**
  - Login; the agent works its agenda for `warmMinutes` (5).
  - Then the test-only task giver `Server` whispers a task with a server-checkable result: "go to the gold block at x y z and stand on it". The runner places the marker with `setblock` (approved for this only) at the **pinned marker position**.
- **Checks:**
  - `agenda_active`: the **pinned agenda counter** rises before the task (the bot is doing its agenda);
  - `task_accepted`: the bot's chat acknowledges the task id within 60 s;
  - `task_done`: the server sees the bot within 1.5 blocks of the marker within `taskMinutes` (5), and the bot reports done;
  - `agenda_resumed`: the pinned counter rises again within 5 min after done;
  - `no_cheat`.
- **Untrusted refusal (item 10's last sentence):** a separate short session, `g3-untrusted-refused`. It uses the production task-giver list, so the console whisperer is not on it. The bot's chat must show a polite refusal, and `!task list` must show no new task.

#### Queue survives a restart (ready-to-try item 11): offline in G3, real in G4 (lead, #101)

- **G3, offline:** a unit test runs the runner's stop and start against the simulated server, with a fake agent that keeps its queue in a file. After the restart, `!task list` in chat must show the same task id and status, and the agenda counter must rise again. No paid batch.
  - skills-rotn's own unit tests cover the real queue file.
- **G4, real:** the same checks on the CX23 with a real service restart (`mindcraft-rotn-ctl restart frcfld`), as part of the G4 acceptance run.

#### Who gives tasks in a test (decided: lead, #101)

The runner can only whisper from the console, which the bot sees as the player `Server`. JQDAW is the human's account, and agents never use it.

**Approved: the console sender `Server` as a test-only task giver, on test servers only, never in production.**
- It is allowed only through the G3 test profile's task-giver override, and recorded in each `result.json`.
- A unit test checks that the production profile's list does not contain `Server`.
- `g3-untrusted-refused` runs with the production list (JQDAW only), so it shows that `Server` is refused there.
- A second Microsoft account as a test task giver is not needed.

#### The G3 driver: the real Mindcraft agent (proposal for skills-rotn, through the lead)

harness-ops writes `test/runner/drivers/mindcraft-driver.mjs` (in `test/`, mine). It keeps the runner's driver contract (`DRIVER.md`):
- **Start:**
  - `node main.js` with `MINDCRAFT_SINGLE_BOT_SERVICE=1`, `PROFILES=["<scenario profile>"]`, `SETTINGS_JSON={"host":..., "port":..., "auth":"microsoft", "auto_open_ui":false}`, a free `MINDSERVER_PORT`, and `MINDCRAFT_PROFILES_FOLDER` (the PC's FRCFLD cache).
  - `OPENROUTER_API_KEY` comes through the runner's `--pass-env` and is never printed.
  - It never sets `INSECURE_CODING` or `BLOCKED_ACTIONS`. The same checks as `deploy/cx23/check-env.mjs` run first.
- **No Mindcraft task files (lead, 2026-11-02).** G3 scenarios never load Mindcraft task files: no `--task_path` or `--task_id`, and nothing from `tasks/`. Task files run op commands (`/give`, `/tp`, ...) regardless of cheat mode; skills-rotn is adding a refusal by default.
  - The driver starts `main.js` with no task arguments, and refuses to start if its arguments or environment carry any.
  - A unit test asserts both.
  - G3 inputs come only as whispers from the test-only task giver `Server`.
- **Stop:** on SIGTERM it stops the agent cleanly. On Windows it kills the whole process tree (`taskkill /T`), because `main.js` starts the agent as a child process, and a hard kill of the parent alone would leave the bot online.
- **Exit codes:** 0, 1 and 3 pass through (ADR 0003 decision 5).

What skills-rotn provides (to agree):
1. **A G3 test profile** (`profiles/`) that is the production profile plus only the task-giver override above, the model, and an LLM budget.
2. **The agenda at a fresh spawn:** the agent starts its RotN early-game agenda by itself on spawn, with no prompt from the runner.
3. **Fixed chat formats** the runner can parse from the server log (`<FRCFLD> ...`). For example:
   - `task <id> accepted: <text>`;
   - `task <id> done` and `task <id> failed: <reason>`;
   - `task refused: <giver> is not a task giver`;
   - `!task list` lines as `task <id> <status> <priority> <giver>`;
   - for the table, `placed crafting_table at x y z`.
4. **Where the queue and agenda files live** (under the bot's folder), so a restart keeps them. The runner reads only chat, never the files.
5. **Exit codes** as in ADR 0003 (already in `agent.js`).

#### Batches (each needs a written GO)

- **S1, survey and smoke (no LLM, `g1-driver.mjs`).** The tooling is in `test/scenarios/s1/` (`s1-site-survey`, `s1-arbiters`, `s1-day-cycle`) and `test/runner/lib/s1.mjs`; see DRIVER.md "S1". It checks:
  - (a) rock piles, trees and stone within 48 blocks of a fresh spawn: a G2 census around the bot (no teleport), radius 48, up to 400 types, with up to 5 positions per group confirmed by `testforblock`;
  - (b) the `clear`-test reply form, and which stat criteria exist (the vanilla ones must; `stat.craftItem.pyrotech.crude_axe` and `contenttweaker.crafting_tools` are the finding);
  - (c) the day length with Extended Days: `time query daytime` every minute for 45 min, with the bot online and the time untouched;
  - (d) whether a console `tell` reaches mineflayer's `whisper` event, the one Mindcraft's agent listens to, and as which sender (`Server` expected). This is checked at the mineflayer level with `g1-driver.mjs`, so no LLM is needed;
  - (e) **no loot containers near the cube** (lead, #101). The check fails closed (#106 review):
    - a type is a container by its registry name, as a vanilla inventory block or spawner, or by its Java class in rotn-data's block dump;
    - without the dump the check fails;
    - every unclassified modded type in the radius is listed for the lead.
    - A looted stone tool would fool the inventory check, and the craft statistics are the second guard.
- **The S1 batches (each needs a written GO; S1 is a survey, so nothing in it is a gate pass):**
  - **S1-A, the G2 world** (`--seed 1880465901402976865`): all three scenarios, the survey first (the fresh spawn).
    ```bash
    deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- bash -c '
      D="node packages/forge-bridge/tools/g1-driver.mjs";
      timeout 15m node test/runner/run.mjs --scenario s1-site-survey --out captures/raw/s1-survey   -- $D; a=$?;
      timeout 10m node test/runner/run.mjs --scenario s1-arbiters    --out captures/raw/s1-arbiters -- $D; b=$?;
      timeout 55m node test/runner/run.mjs --scenario s1-day-cycle   --out captures/raw/s1-day      -- $D; c=$?;
      bash "$TEST_SERVER_CTL" fetch logs --out captures/raw/s1/server;
      echo "survey=$a arbiters=$b day=$c"; [ "$a$b$c" = 444 ]'
    ```
    - **Exit codes:** every S1 run is not gate-valid, so a run whose checks all passed exits **4** ("smoke"), never 0. The batch line checks for 444; 1 means a check failed, and 124 means the timeout hit.
    - **No time or gamerule changes in S1-A:** no `time set`, and no `gamerule` with a value. The day cycle is measured as it really runs.
    - `s1-day-cycle` only **queries** the rule with `gamerule doDaylightCycle` without a value (read-only; 1.12 prints its current value), and records the reply.
    - About 4 min build, 6 min survey, 2 min arbiters, 46 min day cycle: about 60 min, so 1-2 billed hours, about **EUR 0.14-0.28** plus IPv4.
    - Hard stop at 90 min (1.5x).
  - **S1-B, batch 5's world** (`--seed 8796110535854059511`): `s1-site-survey` only, with the same command minus the other two scenarios. About 15 min, 1 billed hour, about **EUR 0.14** plus IPv4. Hard stop at 25 min.
  - **After both:** the evidence goes through the redaction tool into `test/evidence/s1/`, and the findings go into STATUS: the world proposal, the dawn bound, which RotN stats exist (so where `crafted_by_bot` gates), and the whisper sender.
- **G3 batch:** `g3-rocks-to-stone-tools`, `g3-first-night`, `g3-task-preempts-agenda` and `g3-untrusted-refused` on one server (the restart check is offline in G3).
  - About 25 + 45 + 15 + 5 = 90 min plus the build: about 2 h, so 2 billed hours, about **EUR 0.28** plus IPv4.
  - A hard stop at 1.5 times the plan; `--ttl-hours 4`.
  - Worst case 5 billed hours, about EUR 0.69, plus the LLM spend (below).

#### LLM spend (lead, #101)

- **Per scenario:** `result.json` records the LLM call count and the cost.
  - The calls are counted from the agent's own log lines (one per request to OpenRouter).
  - The cost is the difference in the test key's `usage`, read from OpenRouter's key endpoint (`GET /api/v1/key`) before and after the scenario. The runner prints and records only the numbers, never the key.
- **Batch spend stop:** before each scenario the batch script reads the key's usage. If the batch has spent more than `maxBatchUsd`, it stops the batch: no further scenarios, logs fetched, the server deleted as always.
  - **Decided (lead, #116 review): `maxBatchUsd` is USD 2 per batch,** a gate parameter compared 'equal'.
  - The key's USD 5 credit limit is the hard cap behind it.
- **Order of work:**
  1. this plan;
  2. the offline runner parts (arbiters, fake server, the driver wrapper with a fake `main.js`);
  3. S1 (GO);
  4. the scenarios against skills-rotn's agent as it lands;
  5. a G3 smoke batch;
  6. G3 batches.

**Decided on #101 (lead):**
- `Server` is the test-only task giver;
- the console commands above are approved;
- survival is the night gate;
- the restart is offline in G3 and real in G4;
- `maxMinutes` is 'equal';
- the dawn bound, the marker and the agenda counter are pinned before any gate batch;
- `crafted_by_bot` gates where S1 finds the stat;
- S1 checks for loot chests;
- LLM calls and cost are recorded per scenario, with a batch spend stop;
- the test key is a user environment variable with a USD 5 limit.

**Decided after S1-A (lead):**
- **The world:** the G2 world (seed 1880465901402976865, cube -45 66 -66). The dungeon chests cannot fake a pass, because `crafted_by_bot` gates all five items.
- **S1-B is cancelled.**
- **The dawn bound, provisionally:** the wrap past 24000 after the night, about 40 min from the first join, limit 55 min. The first G3 smoke batch runs a full night and confirms it before it is pinned as an 'equal' parameter.

**Decided (lead, #116 review):** `maxBatchUsd` is USD 2.

**Required before any G3 paid batch (lead, #116 review; my next PR):**
- the spend stop: `maxBatchUsd` as an 'equal' gate parameter; a numbers-only read of the key's usage (`GET /api/v1/key`); per-scenario LLM calls and cost; and a test that the batch stops, fetches the logs and deletes the server;
- `Server` as a test-only task giver;
- `give` and `summon` excluded from G3.

**Still open:** the model (skills-rotn's profile).

### G2 batch (the plan for every G2 gate batch; batches 1-7 ran on 2026-11-01/02. Each batch needs the lead's written GO.)

**Goal:** G2 gate evidence. All three G2 scenarios at the gate parameters (no `--param` overrides, so the default `dataRoot`), with the agent's own naming, on one disposable test server.

**The world is fixed (lead, after G2 batch 5):** a G2 gate run must use batch 4's world, **seed `1880465901402976865`**.

**The cube is fixed too (lead, after G2 batch 6):** `g2-blocks-named` teleports the bot to batch 4's ground centre **-45 66 -66** (`tp FRCFLD -45 66 -66`, test server only) after login and before the census, checks its real position with `tp FRCFLD ~ ~ ~`, and takes the census of that cube. The `cubeCentre` and `maxLandingOffset` gate parameters are compared 'equal'. A bot more than 2 blocks from the landing spot -44.5 66 -65.5 is notGate (lead, #92 review; #94). Batch 6's spawn was on a canopy 17 blocks higher, and its cube was 90% air.
- That world's spawn cube (centre -45 66 -66 in batch 4) has double plants and Dynamic Trees blocks, the cases batches 1-4 found.
- The server is created with `--seed 1880465901402976865` (below).
- The scenarios check it: the recorded seed must equal `G2_WORLD_SEED` (`test/runner/lib/g2.mjs`), otherwise the run is notGate. The spawn point may move by the spawn radius (about 10 blocks), so the cube is the same area, not necessarily the same centre.

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
13. **For batch 6 (lead, after batch 5):** net-forge's fix for the 124 remap entries skipped as "cycle" merged; the world-seed check (#85) merged; and a new written GO.
14. **For batch 7 (lead, after batch 6):** #92 merged (the fixed cube, killed-run records, the redaction rule), and a new written GO.
15. **For batch 8 (after batch 7):** net-forge's movement guard (#95) merged, and a new written GO (both done; batch 8 PASSED).

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
- **Server:** `deploy/test-server.sh run`, unchanged, with `--seed 1880465901402976865`. CPX42 in nbg1, `--ttl-hours 2`, EUR 0.138/h. The `run` EXIT trap deletes the server, with the watchdog and the sweeper as backup.
- **The bot runs on this PC.** The runner gives the driver only its allowlisted environment: `TEST_SERVER_HOST`/`PORT`, `MINDCRAFT_PROFILES_FOLDER` and the `ROTN_*` variables. It never gets `TEST_SERVER_CTL` or cloud credentials.
- **Login cache:** `MINDCRAFT_PROFILES_FOLDER=C:/Users/admin/.mindcraft-rotn/FRCFLD/msa` exists only in this PC's environment, as for G1.
- **Whitelist:** FRCFLD and JQDAW (the default).
- **Console use (test server only, never the live server):**
  - **Before the first scenario**, approved by the lead on the disposable test server only: `gamerule doDaylightCycle false`. **No** peaceful difficulty.
  - **Before each scenario**, approved by the lead on #65 for the disposable test server only: `time set day`, so the bot isn't attacked at night. Batch 1 showed that Time Shall Not Pass re-enables the daylight cycle whenever a player connects, so the gamerule alone does not hold.
  - **During the scenarios**, through the runner: `say`, `seed`, `tp` (`tp FRCFLD ~ ~ ~`, and in blocks `tp FRCFLD -45 66 -66`), `tell`, `testforblock`, `testfor`, `summon`, `kill @e[tag=<run tag>]`, `clear` and `give`.

**Command** (one server, three scenarios in sequence, each with its own bot session):

```bash
deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- bash -c '
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

- **G3 batches:** the lead's decisions on the G3 plan's open questions and on S1-A's proposals, skills-rotn's agent and profile, the test OpenRouter key (Requests item 12), and a written GO for each batch.
- **Any further paid batch:** a written GO. For batches over 20 min, I announce the batch window to the lead first (Requests item 13).
- **The CX23** (Requests item 8):
  1. ~~GO 1, the read-only probe, through `cx23`~~ **done** (2026-11-02);
  2. H1, the deploy key;
  3. GO 2, the bootstrap, through `cx23`: it needs the 26.04 CI job (#135) and this PR merged, then the lead's GO;
  4. H2, the deploy password, and H3, the target swap;
  5. GO 3, the first deploy, through `cx23-deploy`;
  6. later H4 and H5;
  7. the first-start GO, with H6, the CX23's IP, for a disposable test server.

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
8. **Human, via the lead: the CX23 items** (the CX23 exists as Orca SSH target `cx23`; the plan is under "Planned real batches", "CX23 first run"). They replace the three short CX23 items in NEEDS-HUMAN. Never paste a key, password, token or code into a chat, a file in the repo or a status file. The human's decisions on #101 apply: no lockdown, the target swap, the test key only for now, and a test server for the first start.
   - **Order:** H1 before GO 2; H2 and H3 right after GO 2; H4 and H5 later, before the first start; H6 at the first-start GO.
   - **H1. The `deploy` key** (about 5 min, in your own terminal on this PC, before GO 2):
     1. `ssh-keygen -t ed25519 -f C:/Users/admin/.ssh/mindcraft-rotn-deploy -C deploy@mindcraft-rotn`. A passphrase is optional; Orca must be able to use the key.
     2. Put the **public** key on the CX23 as `/root/deploy.pub`: in an Orca terminal **you** open on `cx23`, run `nano /root/deploy.pub`, paste the one line from `mindcraft-rotn-deploy.pub`, and save.
     3. Tell the lead "H1 done". Agents never read either key file.
   - **H2. `deploy`'s sudo password** (right after GO 2, still as root): in a terminal **you** open on `cx23`, titled `HUMAN ONLY`, run `passwd deploy`. Keep the password in your password manager. You need it for H4 and H5 (`sudo` as `deploy`).
   - **H3. Swap the Orca targets** (right after H2):
     1. Add an Orca SSH target **`cx23-deploy`**: the same host, user `deploy`, the H1 private key. Connect once to check it.
     2. **Remove** the root target `cx23` from Orca.
     3. Tell the lead "H3 done". From then on, agents work only through `cx23-deploy`. Root SSH itself stays enabled on the server (no lockdown), for you.
   - **H4. The bot's long-term OpenRouter key** (**later**: for now there is only the test key on the PC, item 12). Before the CX23's first start:
     1. Create a key at https://openrouter.ai/settings/keys, named `mindcraft-rotn-frcfld-cx23`, with a **credit limit** (the lead sets it in the soak ADR).
     2. In a terminal **you** open on `cx23-deploy`, titled `HUMAN ONLY`, run `sudo nano /etc/mindcraft-rotn/frcfld.env`.
     3. Replace `<set-by-human-never-in-repo>` after `OPENROUTER_API_KEY=` with the key. Fill in `"host"` in `SETTINGS_JSON` at the first-start GO (the test server's name or address). Save.
     4. Check: `sudo stat -c '%U:%G %a' /etc/mindcraft-rotn/frcfld.env` must print `root:root 600`.
     - The first start needs this: `check-env` refuses a placeholder key.
   - **H6. The CX23's IPv4 address, at the first-start GO:** give it to the lead in that GO message. Agents do not look it up. I pass it only on the command line (`deploy/test-server.sh run --allow-from <it>/32`); it never goes into the repo or STATUS.
   - **H5. The bot's Microsoft login on the CX23** (later, before the first start, after the first deploy), in a `HUMAN ONLY` terminal on `cx23-deploy`:
     1. `sudo -u mindcraft-rotn env MINDCRAFT_PROFILES_FOLDER=/var/lib/mindcraft-rotn/frcfld/msa node /opt/mindcraft-rotn/current/packages/forge-bridge/tools/msa-login.mjs FRCFLD`
     2. Open the Microsoft link it prints, enter the code, and sign in with the bot's account on Microsoft's page only.
     3. Then run the same command with `--check` at the end. It prints only the profile name (FRCFLD); tell the lead "H5 done".
     - This is the same tool as for this PC's cache. The cache stays in that folder (0700, owned by `mindcraft-rotn`).
   - **Agents never:**
     - use root except for GO 1 and GO 2 through `cx23` before H3;
     - see a private key, the OpenRouter key, the deploy password or the Microsoft code;
     - read a `HUMAN ONLY` terminal (protected by this agreement plus the order above, not by a technical barrier);
     - connect to your live server.

9. ~~Lead: decide how G2 handles the cube after batch 6~~ **Decided** (#88 comment): P1 and P2 approved, P3 declined; done in #92. The original proposals, for the record:
   - **P1 (recommended): fix the cube too.** After login, the runner teleports the bot to batch 4's ground centre (-45 66 -66) with `tp`, which is already on the plan's console list. It then waits for chunks and takes the census there, so every G2 run sees the same cube (the one where batch 4 found double plants and Dynamic Trees blocks). The new gate parameter `cubeCentre` would be 'equal'.
   - **P2: keep partial results.** On SIGTERM (`timeout`), the runner writes `result.json` with the checks done so far, verdict FAIL and an "interrupted" error, so a kill no longer loses passed checks.
   - **P3 (optional): make the spot check faster or give it more time.** Either one SSH console call per batch of 8 `testforblock` commands (a `deploy/test-server.sh console` change), or `timeout 25m` for blocks with the hard stop adjusted. P1 alone should bring the spot check back to about 1-2 min (batch 4: 43 non-air in 72 positions).

10. ~~Lead (info): G0 evidence predates the redaction rules~~ **Done** (#94): G0 redacted with the tool, and the check runs over all evidence. The original note: `test/evidence/g0/g0-batch.log` lines 9 and 17 hold the G0 test server's public IPv4 (the "is at" and "READY ... at" forms). That server was deleted on 2026-11-01. The CI leak check covers only `test/evidence/g2/**`, so it never flagged them. Say if you want them redacted with the tool (a small PR of mine). The G1 `server.log`'s other flags are FML's pipe-table mod versions, a form G2 excerpts never contain.
11. ~~Lead, routed to net-forge: batch 7's items kick~~ **Done:** net-forge's movement guard (#95). In batch 8 items joined at the same spot, passed, and the guard never had to act. The original request: 2 s after joining, the bot was kicked with `multiplayer.disconnect.invalid_player_movement` (server: "Invalid move player packet received"; 1.12 sends it for a non-finite or out-of-range position or rotation in a move packet). The raw capture is `captures/raw/batch7-20261102/FRCFLD-2026-11-02T15-31-20-713Z.jsonl` on this PC, and the evidence is in `test/evidence/g2/batch7-20261102/items/`. The capture logs no client position packets; it may need to.
12. **Human, via the lead: a test OpenRouter key on this PC, for G3 batches** (the real agent calls the LLM).
    - **Accepted (lead and human, #101):** a user environment variable with a **USD 5 credit limit**. This is the only OpenRouter key for now.
    - Create a **separate** key at https://openrouter.ai/settings/keys: name `mindcraft-rotn-test-pc`, credit limit **USD 5**.
    - Set it as a **user environment variable** on this PC: `OPENROUTER_API_KEY` (Windows: Settings > System > About > Advanced system settings > Environment Variables > User variables). Then restart Orca, so new terminals see it.
    - The runner passes it only to the agent (`--pass-env OPENROUTER_API_KEY`) and never prints or records it. Agents never read `keys.json`.
    - Not needed for survey batch S1.
13. ~~Lead (and the human): this PC's memory during paid batches~~ **Decided (lead, after S1-A): option 1.**
    - During any paid batch over 20 minutes, no other agent runs `npm ci` or a full test suite, and reviews are static, with at most one running.
    - **I announce each batch window to the lead,** who tells the others.
    - Option 2 is the human's choice; the lead told them.
    - S1-B is cancelled. The original note:
    - **What happened:** Claude Code reaped my background shells (the batch's tracking shell and the hard-stop watcher) because the PC was critically low on memory. Minutes later, new processes could not start (`0xC0000142`), which ended the day-cycle run.
    - **The safety net held:** the batch script's own teardown, plus the TTL and sweeper behind it, still deleted everything.
    - **But:** a long batch (G3's first night, about 45 min; S1's day cycle) cannot be supervised when the PC runs out of memory. Several agents and test runs were active at the same time; for example, another worktree's `deploy/test-server.sh` processes were running then, which look like unit tests.
    - **Options (decision for the lead and the human):**
      1. Fewer concurrent heavy agents or test runs during a paid batch. I propose this, at least for batches longer than 20 minutes.
      2. The human could start Claude Code with `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1`. That keeps supervision alive, but it does not add memory.
      3. Re-run S1-B and the missing day-cycle piece (0-3000 and the wrap) only after 1 is in place.

14. ~~Lead (and the human): cx23 runs Ubuntu 26.04.1, not 24.04~~ **Decided (ADR 0007, #134):** keep 26.04 and turn SSH password login off in setup. This PR does the bootstrap part. The original note: (GO 1 probe, `test/evidence/cx23/`). CLAUDE.md pins 24.04, and `deploy/cx23/bootstrap.sh` refuses any other version. The options:
    1. **Rebuild cx23 from Hetzner's `ubuntu-24.04` image** (I propose this). It keeps the pin, ADR 0002's Node 22 checks and the bootstrap as reviewed. But it erases what is on cx23 now: the human's clones, the Orca server install and its workspaces. The human then re-adds the Orca SSH target, and I run GO 1 again before GO 2 (about one minute).
    2. **Keep 26.04 with an ADR**, plus a small bootstrap change that accepts it. NodeSource's `nodistro` line should work there, but Node 22 and the native dependencies are untested on 26.04 (kernel 7.0).

    **A separate point for the human:** sshd allows password logins (`passwordauthentication yes`), and nothing filters the ports until GO 2 turns on ufw. With no lockdown (the human's decision), the `deploy` password from H2 will also work over SSH. Turning off `PasswordAuthentication` before H2 would close that. It is the human's call, and it is not part of my bootstrap.

15. ~~net-forge (via the lead): the P1 probe protocol~~ **Settled: #165 uses net-forge's protocol from #162 as it is** (`packages/forge-bridge/tools/probe-commands.mjs`); nothing is asked of net-forge.
    - **The scenario sends** rotn-data's recipe ids (`crafttweaker:pyro_crude_axe`, `crafttweaker:crafting_tools`, `crafttweaker:crafting_table`, and `crafttweaker:stone_pickaxe` at the table), and checks the results by the item names the server counts.
    - **It starts the driver with `ROTN_DRIVER_PROBE=1`.**
    - **It reads #162's reply fields:** craft `ok`/`before`/`after`/`tableBlock`; place `ok`/`updateMs`/`totalMs`; eat `ok`/`foodBefore`/`foodAfter`/`countBefore`/`countAfter`.
    - **It waits 75 s per reply** (the driver's limit is 60 s), and stops if the driver exits.
    - **Two of the plan's pass criteria come from the capture in the evidence step:** zero rejected transactions, and the `fastbench` mod window. #162 does not report them per command, so they are notes, not scenario checks; `notes.capture` records the capture path.
    - **Optional, later, not needed for P1:** per-craft `modWindow` and `transactions` in #162's craft reply would let a scenario check them directly.

## Open PRs

- #165: probe P1, the scenario `probe-craft-place` (never a gate), now aligned with net-forge's #162 protocol as it is (Requests item 15). It is in final review with #162 before the P1 GO.
- #166: the #157 nit. `deploy.sh` refuses a release with the test-only `allow_server_task_giver` or a `Server` task giver.
- Later: the #139 nits (trim the `loadScenarios` ids; DRIVER.md says a G3 result wrapped in an array or a parent object is not detected).
- Merged since the last update: #122 (2b30405), #128 (8fcec45), #129 (c2d6867), #135 (05b1a5b), #137 (f028e9b), #139 (f1fd589), #144 (655bcaa), #147 (the #128 and #135 review nits), #150 (the Java 8 on Ubuntu 26.04 note), #157 (the G3 test-only Server giver), #159 (every file under `deploy/cx23/` is LF), #163 (the GO 3 CX23 post-bootstrap check, 54d653b; the terminal was closed at 02:16:21 UTC), and the lead's #134 (ADR 0007).
