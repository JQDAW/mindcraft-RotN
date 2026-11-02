# G2 batch 5, 2026-11-02: PASS (blocks, mobs and items all PASS, gate-valid, one batch, one SHA)

harness-ops ran this batch on the lead's written GO (2026-11-02 02:59 UTC), exactly as the plan in `coord/STATUS-harness-ops.md` says.

**All three G2 scenarios passed as gate runs** in this one batch on develop 01a8193:
- `pass: true`, `gateValid: true`, `weakenedParams: []`;
- no `notGate` reasons, no kicks;
- `notes.loginRetry` `{retried: false}` in all three.

By the lead's rule (all three gate-valid in one batch on one SHA), this is the G2 evidence. The lead decides whether G2 is met.

All files are redacted with the merged `test/tools/redact-evidence.mjs`, and the CI leak check (`test/unit/evidence-redaction.test.js`) passes on them. The `msa-login --check` output is not part of this evidence.

| Folder | Scenario | Files |
| --- | --- | --- |
| `blocks/` | `g2-blocks-named` | `result.json`, `server.log` (from the runner's begin marker), `driver.log` |
| `mobs/` | `g2-mobs-named` | the same |
| `items/` | `g2-items-roundtrip` | the same |

## Run

- **Code:** a clean detached checkout of develop at 01a8193, after `npm ci`, which applied #81's prismarine-chunk patch. That includes:
  - the double-plant fix: #80 and #82 (rotn-data's state-meta remap table) and #81 (blocks read as a Forge client sees them);
  - the census sum rule (#79).

  Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create:**
  - `agentNaming('.')`: wired, 643/643.
  - The bot's login cache: OK.
  - The preflight on its own passed via the cadence path (4 dispatch runs, gaps 15.2, 14.7 and 15.5 min). No leftover labelled resources.
- **Server:** one CPX42 in nbg1, `--ttl-hours 2`, `deploy/test-server.sh run` unchanged.
  - Created 03:02:06 UTC, ready 03:05:09.
  - Deleted by the EXIT trap and verified gone at 03:17:05: up 15 min (hard stop 56).
- **Cost:** 1 billed hour, about EUR 0.14 (EUR 0.1381 excl. Primary IPv4).
- **Afterwards:** at 03:17:20 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario, 4 lines in the raw server log only. The committed excerpts start at each scenario's marker. Then the runner's scenario commands. Test server only, no difficulty change.
- **World seed:** 8796110535854059511. **Cube centre:** -703 65 -210, radius 16.

| Scenario | Time (UTC) | Verdict | Checks | `notes.loginRetry` | Driver's remap line at login |
| --- | --- | --- | --- | --- | --- |
| `g2-blocks-named` | 03:05:15-03:11:52 | **PASS** | `login_online`; `blocks_named` (20 non-air types; census sum 16706 + air 19231 + unloaded 0 = 35937); `blocks_confirmed` 50/50; `blocks_spotcheck` (41 non-air of 40, 80 positions, 0 unloaded, no skew) | `{retried: false}` | `state-id remap active: 382 state ids in 94 of the table's 132 blocks` |
| `g2-mobs-named` | 03:11:55-03:14:44 | **PASS** | `login_online`; `mobs_named` 12/12 (1 replaced); `mobs_confirmed` 12/12 by run tag | `{retried: false}` | the same line |
| `g2-items-roundtrip` | 03:14:47-03:16:41 | **PASS** | `items_table` (643/643), `login_online`, and `items_read`, `items_named`, `items_roundtrip` (30/30 each) | `{retried: false}` | the same line |

## Blocks

- **Census:** 20 non-air types, fewer than 50, so the census claims the whole cube. Its counts add up exactly: types 16706 + air 19231 + unloaded 0 = 35937. The spot checks hit only census types.
- **`blocks_confirmed`:** 50/50. `worldChanges`: none. `metaDrift`: 0 of 50.
- **Caveat, honestly:** this world's spawn is on sand and stone by water (sedimentary stone, sand, water, sandstone, ...). The cube has **no double plants** and no Dynamic Trees blocks, so the batch 4 double-plant case was not exercised in game here.
  - The remap itself is loaded and active in all three sessions.
  - Its `minecraft:double_plant` entries map the upper-half ids to meta 10, and none was skipped.
  - The 124 skipped entries are all modded blocks (for example `animania:block_trough`, `artisanworkstumps:*`, `betternether:stalagnate_planks_slab_half`), skipped by forge-bridge as "cycle". None is in this cube.

## Mobs

- **Summoned:**
  - vanilla: `minecraft:slime`, `minecraft:creeper`, `minecraft:spider`, `minecraft:skeleton`, `minecraft:zombie`;
  - modded: `butterflies:butterfly`, `quark:stoneling`, `animania:toad`, `betteranimalsplus:deer`, `animania:cow_holstein`, `animania:hen_rhode_island_red`, `animania:hen_wyandotte`.

  That is 7 modded mobs, all named and confirmed.
- **Replaced:** 1 of 12 (cap 3). `charm:spectre` vanished before the bot was asked and was replaced by `quark:stoneling`.
- **Other entities reported:** none.

## Server-side note (not caused by the bot)

At 03:06:23, during the blocks scenario, the server logged `[File IO Thread/ERROR] [Universal Tweaks]: Failed to save chunk` with a `NullPointerException` while writing chunk NBT to disk. It is a pack-side error on the server's save thread. Every check used the live world and passed. It is worth knowing for the live server.
