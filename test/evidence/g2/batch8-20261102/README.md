# G2 batch 8, 2026-11-02: PASS (blocks, mobs and items all PASS, gate-valid, one batch, one SHA, the fixed world and cube)

harness-ops ran this batch on the lead's written GO (2026-11-02 16:24 UTC, relayed by the human), exactly as the plan in `coord/STATUS-harness-ops.md` says: the fixed world (seed `1880465901402976865`) and the fixed cube (centre -45 66 -66, landing within 2 blocks).

**All three G2 scenarios passed as gate runs** in this one batch on develop 0bdb537:
- `pass: true`, `gateValid: true`, `weakenedParams: []`;
- no `notGate` reasons and no kicks;
- `notes.loginRetry` `{retried: false}` in all three.

By the lead's rule (all three gate-valid in one batch on one SHA), this is G2 evidence. The lead decides whether G2 is met.

All files came out of the merged `test/tools/redact-evidence.mjs` with `--bot FRCFLD`, with no hand edits. The CI leak check over `test/evidence/**` passes. The `msa-login --check` output is not part of this evidence.

| Folder | Scenario | Files |
| --- | --- | --- |
| `blocks/` | `g2-blocks-named` | `result.json`, `server.log` (from the runner's begin marker), `driver.log` |
| `mobs/` | `g2-mobs-named` | the same |
| `items/` | `g2-items-roundtrip` | the same |
| `run.log` | the batch | the batch's own output |

## Run

- **Code:** a clean detached checkout of develop at 0bdb537, after `npm ci` (all patches applied). It includes #84, #85, #92, #94, #95 (net-forge's movement guard) and #96. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create (16:25 UTC), all passed:**
  - `agentNaming('.')`: wired, 643/643, 0 failures.
  - The bot's login cache: exit 0 (output discarded).
  - The preflight on its own: cadence path (3 dispatch runs, gaps 15.5 and 14.5 min). The project had no servers or Primary IPs.
- **Server:** one CPX42 in nbg1, `--ttl-hours 2`, `--seed 1880465901402976865`, `deploy/test-server.sh run` unchanged.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario. Then the runner's commands, including blocks' `tp <bot> -45 66 -66`. Test server only, no difficulty change.

**Real times (UTC)**

| Event | Time |
| --- | --- |
| Batch start | 16:26:11 |
| Server created | 16:26:28 |
| Ready | 16:29:18 |
| `g2-blocks-named` | 16:29:26 to 16:40:05 (637 s) |
| `g2-mobs-named` | 16:40:08 to 16:42:52 (161 s) |
| `g2-items-roundtrip` | 16:42:55 to 16:44:44 (107 s) |
| EXIT-trap teardown | started 16:44:53; "verified gone" 16:45:06 |

- **Server up:** 18 min, as `deploy/test-server.sh` reports it (hard stop 56).
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. Primary IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 16:45:19 UTC, `hcloud server list` and `primary-ip list` were empty. `ssh-key list` held only the human's unlabelled key.

## Results

These are the same in all three runs:
- **World seed:** `1880465901402976865`.
- **Remap line at login:** `state-id remap active: applied 506 state ids in 132 of the table's 132 blocks; conflicts 0 skipped`.
- **Movement guard (#95):** no log line. The captures hold no `movement_trace`, so the guard never had to act.
- **End of each run:** the runner stopped the driver (`botStoppedByRunner: true`, exit 128, SIGTERM).

| Scenario | Verdict | Checks |
| --- | --- | --- |
| `g2-blocks-named` | **PASS** | `login_online`; `blocks_named` (50 types); `blocks_confirmed` 150/150; `blocks_spotcheck` (40 non-air of 40 in 72 positions, 0 unloaded, no skew) |
| `g2-mobs-named` | **PASS** | `login_online`; `mobs_named` 12/12 (1 replaced); `mobs_confirmed` 12/12 by run tag |
| `g2-items-roundtrip` | **PASS** | `items_table` (643/643), `login_online`, and `items_read`, `items_named`, `items_roundtrip` (30/30 each) |

### Blocks

- **The fixed cube:**
  - The bot first spawned at -51.5 65 -63.5.
  - The server confirmed `Teleported <bot> to -44.5, 66.0, -65.5`.
  - The checked position was -44.5 66 -65.5: **landing offset 0** (max 2).
  - Cube centre -45 66 -66, radius 16.
- **Census:** 50 non-air types (more exist, so the census claims at most the cube); types 20770 + air 14993 + unloaded 0 = 35763 of 35937.
- **`blocks_confirmed`:** 150/150. `metaDrift` 0 of 150. `worldChanges`: none.
- **Double plants:**
  - In the census: `minecraft:double_plant 10` (**upper halves**) 23 blocks, and `minecraft:double_plant 3` 23 blocks.
  - 6 samples, **all server-confirmed** by `testforblock`: **3 upper halves** and 3 of meta 3.
- **Dynamic Trees:** 31 of the 50 census types; **93 samples, all server-confirmed**.

### Mobs

- **Summoned:** 12, all named and confirmed by run tag.
  - vanilla: slime, creeper, spider, skeleton, zombie;
  - modded (7): `butterflies:butterfly`, `quark:stoneling`, `animania:toad`, `betteranimalsplus:deer`, `animania:cow_holstein`, `animania:hen_rhode_island_red`, `animania:hen_wyandotte`.
- **Replaced:** 1 of 12 (cap 3). `charm:spectre` vanished before the bot was asked.
- The session joined at -44.5 66 -65.5, where blocks had left the bot.

### Items

- 30/30 given items read with their 1.12 name and meta, named with the expected 1.13+ name, and round-tripped back. The full table (643) round-trips through the agent's `mcdata.js`.
- The session joined at -44.5 66 -65.5, the same spot as in batch 7, and stayed connected until the runner stopped it. There was no kick and no movement-guard line.

## Server-side notes (not caused by the bot)

Pack config messages only: `[cyclicmagic]: Data not found for <bot>` at the first join, and two `[Village Names]` config warnings.
