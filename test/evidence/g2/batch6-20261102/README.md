# G2 batch 6, 2026-11-02: FAIL (blocks timed out in its spot check; the batch was stopped)

harness-ops ran this batch on the lead's written GO (2026-11-02 13:41 UTC, relayed by the human), as the plan in `coord/STATUS-harness-ops.md` says.

**Not G2 evidence.** `g2-blocks-named` did not finish within its `timeout 15m` and wrote no `result.json`. By the GO's rule ("if anything fails: stop, delete, report"), harness-ops then stopped the batch during `g2-mobs-named`, right after its login. `g2-items-roundtrip` did not run.

All files are redacted with the merged `test/tools/redact-evidence.mjs`. One address the tool does not cover (`run.log`: "server ... is at A.B.C.D") was redacted by hand. The CI leak check (`test/unit/evidence-redaction.test.js`) passes. The `msa-login --check` output is not part of this evidence.

| File | What |
| --- | --- |
| `run.log` | the batch's own output (test-server.sh, the console commands, the runner's check lines) |
| `blocks/server.log` | the server log from the blocks scenario's begin marker to the mobs marker |
| `blocks/driver.log` | the driver's output for blocks |
| `mobs/server.log`, `mobs/driver.log` | the same for mobs, up to the log fetch at 14:11:51 |

There is no `result.json`: `timeout` killed `run.mjs` before it wrote one (see "Harness findings").

## Run

- **Code:** a clean detached checkout of develop at 2de68ec (with #84, the remap that applies cycles, and #85, the world-seed check), after `npm ci`. All patches applied. `git status` showed 0 changes before the create, and both runs print `git 2de68ec5...`.
- **Checks right before the create (13:52 UTC):**
  - `agentNaming('.')`: wired, 643/643, 0 failures.
  - The bot's login cache (`msa-login FRCFLD --check`): exit 0. Its output was discarded.
  - The preflight on its own (`up --dry-run` with the planned options) passed via the cadence path (3 dispatch runs, gaps 15.2 and 14.7 min), with no refusal. The project had no servers or Primary IPs.
- **Server:** one CPX42 in nbg1, `--ttl-hours 2`, `--seed 1880465901402976865`, `deploy/test-server.sh run` unchanged.
- **Console:** `gamerule doDaylightCycle false` once, then `time set day` before blocks and before mobs. After that, only the runner's scenario commands. Test server only, no difficulty change.
- **World seed:** `1880465901402976865` in both sessions (the planned world). **Spawn and cube centre:** -49.5 83 -66.5. The bot stood on `dynamictrees:leaves0` at y 82, a tree canopy (batch 4, same world: centre -45 66 -66, on the ground).

**Real times (UTC)**

| Event | Time |
| --- | --- |
| Batch start | 13:53:11 |
| Server created | 13:53:32 |
| Ready | 13:56:05 |
| `g2-blocks-named` | 13:56:12 until the `timeout 15m` kill at 14:11:12 (no result) |
| `g2-mobs-named` | 14:11:15; login PASS 14:11:34; stopped by harness-ops at 14:12:02 |
| Server logs fetched by hand | 14:11:51 (before the stop, because the batch fetches logs only at its end) |
| EXIT-trap teardown | started 14:12:02; "verified gone" 14:12:17 |

- **Server up:** 18 min (hard stop 56 min).
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. Primary IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 14:12:33 UTC, `hcloud server list` and `hcloud primary-ip list` were empty. `ssh-key list` held only the human's unlabelled key, as before the batch.

## Blocks: what happened

From `run.log` and `blocks/server.log`:

| Check | Result |
| --- | --- |
| `login_online` | PASS (13:56:30) |
| `blocks_named` | PASS (13:57:59): 50 reported of 87 non-air types; census `#unloaded 0`, air 32360 of 35937 |
| `blocks_confirmed` | PASS (14:03:46): 150/150 runner-picked samples, 3 per type, re-asked and confirmed by `testforblock` |
| `blocks_spotcheck` | **not reached**: killed during the spot loop |

- **Dynamic Trees: in the census, the samples and the server confirms.** 38 of the 50 census types are Dynamic Trees blocks (`dynamictrees:*`, `dynamictreesbop:*`): leaves, branches and trunk shells, many metas. Every sample of every type was confirmed by `testforblock`. Batch 4 failed on these.
- **Double plants: not seen.** No `minecraft:double_plant` in the 50 reported types, the samples or any spot answer. The cube may hold some among the 37 types below the top 50; the census does not report those.
- **Every answer the server checked was right:** 342 `Successfully found the block` lines, and no `had the data value` or `The block at ... is` line.
- **The spot loop was slow, not stuck.**
  - In the 7.4 min after `blocks_confirmed`, the bot answered 24 batches of 8 positions, about 18.5 s per batch, and the server confirmed each answer.
  - Only 17 of those 192 positions were non-air (9%), because the cube is centred on a canopy 16 blocks above the ground.
  - The check needs 40 confirmed non-air answers within `spotMaxPositions` 400. At this world's 9.95% non-air share that means about 400 positions (about 15 min), so even without the timeout, `blocks_spotcheck` would have been close to a coin flip.
- `metaDrift`, `worldChanges`, `replacements`, `loginRetry` and `botStoppedByRunner` are `result.json` fields; there is no `result.json`. `driver.log` shows one login with no retry.
- **Remap line at login (blocks and mobs):** `state-id remap active: applied 506 state ids in 132 of the table's 132 blocks; conflicts 0 skipped`. Batch 5 showed 382 ids in 94 blocks with 124 skipped, so #84 applies all of them now.

## Mobs

Login PASS at 14:11:34, seed 1880465901402976865. It was stopped before any summon, so there are no mob results.

## Harness findings (for the lead)

1. **The cube centre depends on where the bot lands.** With the world fixed, the spawn radius still put this run's centre on a canopy 17 blocks above batch 4's. The world is fixed, but the cube is not.
2. **The spot check's cost grows with the cube's air share.** Each batch of 8 costs about 18.5 s (eight `testforblock` console calls over SSH), and a 90%-air cube needs about 50 batches.
3. **A `timeout` kill leaves no `result.json`.** The runner writes it only at the end, so checks that already passed are only in `run.log`.

The proposed fixes are in `coord/STATUS-harness-ops.md`. None was applied in this batch.
