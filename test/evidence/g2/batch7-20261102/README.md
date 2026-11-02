# G2 batch 7, 2026-11-02: FAIL (blocks PASS, mobs PASS, items FAIL: the bot was kicked for an invalid move packet)

harness-ops ran this batch on the lead's written GO (2026-11-02 15:11 UTC, relayed by the human), exactly as the plan in `coord/STATUS-harness-ops.md` says: the fixed world (seed `1880465901402976865`) and the fixed cube (centre -45 66 -66, #92).

**Not G2 evidence.** `g2-blocks-named` and `g2-mobs-named` passed as gate runs. `g2-items-roundtrip` failed: 2 s after it joined, the server kicked the bot with "Invalid move player packet received", so it never answered the items request. G2 counts only if all three pass in one batch.

All files came out of the merged `test/tools/redact-evidence.mjs` (develop 1bd66cd) with `--bot FRCFLD`, with no hand edits. The CI leak check (`test/unit/evidence-redaction.test.js`) passes on them. The `msa-login --check` output is not part of this evidence.

| Folder | Scenario | Files |
| --- | --- | --- |
| `blocks/` | `g2-blocks-named` | `result.json`, `server.log` (from the runner's begin marker), `driver.log` |
| `mobs/` | `g2-mobs-named` | the same |
| `items/` | `g2-items-roundtrip` | the same |
| `run.log` | the batch | the batch's own output |

## Run

- **Code:** a clean detached checkout of develop at 1bd66cd (#84, #85, #92), after `npm ci` (all patches applied). Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create (15:13 UTC), all passed:**
  - `agentNaming('.')`: wired, 643/643, 0 failures.
  - The bot's login cache: exit 0 (output discarded).
  - The preflight on its own: cadence path (3 dispatch runs, gaps 14.7 and 15.5 min). The project had no servers or Primary IPs.
- **Server:** one CPX42 in nbg1, `--ttl-hours 2`, `--seed 1880465901402976865`, `deploy/test-server.sh run` unchanged.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario. Then the runner's commands, including blocks' `tp <bot> -45 66 -66`. Test server only, no difficulty change.

**Real times (UTC)**

| Event | Time |
| --- | --- |
| Batch start | 15:14:02 |
| Server created | 15:14:26 |
| Ready | 15:17:32 |
| `g2-blocks-named` | 15:17:40 to 15:28:28 (646 s) |
| `g2-mobs-named` | 15:28:31 to 15:31:12 (158 s) |
| `g2-items-roundtrip` | 15:31:15 to 15:34:52 (214 s) |
| EXIT-trap teardown | started 15:35:02; "verified gone" 15:35:15 |

- **Server up:** 21 min (hard stop 56).
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. Primary IPv4), plus 1 Primary IPv4-hour.
- **Afterwards:** at 15:35:22 UTC, `hcloud server list` and `primary-ip list` were empty. `ssh-key list` held only the human's unlabelled key.

## Results

The world seed is `1880465901402976865` in all three runs. None of them used the login retry (`notes.loginRetry` `{retried: false}`). The driver's remap line at login was the same in all three: `state-id remap active: applied 506 state ids in 132 of the table's 132 blocks; conflicts 0 skipped`.

| Scenario | Verdict | `pass` / `gateValid` | notGate | Driver end |
| --- | --- | --- | --- | --- |
| `g2-blocks-named` | **PASS** | true / true | none | stopped by the runner (`botStoppedByRunner: true`, 128, SIGTERM) |
| `g2-mobs-named` | **PASS** | true / true | none | stopped by the runner (true, 128, SIGTERM) |
| `g2-items-roundtrip` | **FAIL** | false / true | none | exit 1 after the kick (`botStoppedByRunner: false`) |

### Blocks

- **The fixed cube:**
  - The bot first spawned at -43.5 66 -66.5.
  - The server confirmed `Teleported <bot> to -44.5, 66.0, -65.5`, and the checked position was -44.5 66 -65.5.
  - `notes.cube`: centre -45 66 -66, radius 16, in the cube.
- **Census:** 50 non-air types; types 20686 + air 15027 + unloaded 0 = 35713 of 35937 (50 types reported, so the census claims at most the cube).
- **`blocks_confirmed`:** 150/150. `metaDrift` 0 of 150. `worldChanges`: none.
- **`blocks_spotcheck`:** 40 non-air of 40 in 80 positions, 0 unloaded, no skew, no failures. It took about 3 minutes (batch 6: still unfinished after 7.4).
- **Double plants:**
  - In the census: `minecraft:double_plant 10` (upper halves) 20 blocks, and `minecraft:double_plant 3` 20 blocks.
  - 6 samples, all server-confirmed by `testforblock`: **3 upper halves (meta 10)** and 3 of meta 3.
- **Dynamic Trees:** 33 of the 50 census types; 99 samples, all server-confirmed.

### Mobs

- **Summoned:** 12, all named and confirmed by run tag (`mobs_named` 12/12, `mobs_confirmed` 12/12).
  - vanilla: slime, creeper, spider, skeleton, zombie;
  - modded (7): `butterflies:butterfly`, `quark:stoneling`, `animania:toad`, `betteranimalsplus:deer`, `animania:cow_holstein`, `animania:hen_rhode_island_red`, `animania:hen_wyandotte`.
- **Replaced:** 1 of 12 (cap 3). `charm:spectre` vanished before the bot was asked.

### Items

- `items_table` PASS (643/643), `login_online` PASS.
- `items_read`, `items_named` and `items_roundtrip` FAIL: "no items reply within 120s".
- **The kick:**
  - The bot spawned at -44.5 66 -65.5, standing on `minecraft:dirt`.
  - 2 s later (15:31:26) the server logged `<bot> lost connection: Invalid move player packet received`, and the driver got `multiplayer.disconnect.invalid_player_movement` (`notes.kicks`).
  - In 1.12 the server sends that when a client's move packet has a non-finite or out-of-range position or rotation.
  - The mobs session had joined at the same position 3 minutes earlier and played normally.
- **What the capture shows:** it records no client position packets, so it cannot show the bad packet itself. Before the kick it has, for example, two `entity_effect` packets: effect 10 for another entity, and effect 11 with amplifier -1 for entity 256592. The blocks and mobs sessions got the same effect-11, amplifier -1 packet and were not kicked, so it is no proven cause.
  - Raw capture (git-ignored, on this PC): `captures/raw/batch7-20261102/FRCFLD-2026-11-02T15-31-20-713Z.jsonl`.
  - Diagnosis belongs to net-forge (forge-bridge and the driver).
