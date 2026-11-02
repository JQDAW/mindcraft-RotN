# G2 batch 3, 2026-11-02: FAIL (blocks 110/111; mobs PASS; items PASS)

harness-ops ran this batch on the lead's written GO (2026-11-02 00:26 UTC), exactly as the plan in `coord/STATUS-harness-ops.md` says.

**It is not a G2 pass.** G2 counts only when all three scenarios pass gate-valid in one batch on one SHA, and `g2-blocks-named` failed one runner-picked sample.
- All three runs were valid gate runs: `gateValid: true`, no `weakenedParams`, no `notGate` reasons, no kicks.
- No scenario used the login retry: `notes.loginRetry` is `{retried: false}` in all three.

All files are redacted with the merged `test/tools/redact-evidence.mjs`, and the CI leak check (`test/unit/evidence-redaction.test.js`) passes on them. The `msa-login --check` output is not part of this evidence.

| Folder | Scenario | Files |
| --- | --- | --- |
| `blocks/` | `g2-blocks-named` | `result.json`, `server.log` (from the runner's begin marker), `driver.log` |
| `mobs/` | `g2-mobs-named` | the same |
| `items/` | `g2-items-roundtrip` | the same |

## Run

- **Code:** a clean detached checkout of develop at 1a396f5 (with #72 and #73), after `npm ci`. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create:**
  - `agentNaming('.')`: wired, 643/643.
  - The bot's login cache: OK.
  - The preflight on its own passed via the cadence path (3 dispatch runs, gaps 15.4 and 14.5 min). No leftover labelled resources.
- **Server:** one CPX42 in nbg1, `--ttl-hours 2`, `deploy/test-server.sh run` unchanged.
  - Created 00:28:44 UTC, ready 00:31:49.
  - Deleted by the EXIT trap and verified gone at 00:46:30: up 18 min (hard stop 56).
- **Cost:** 1 billed hour, about EUR 0.14 (EUR 0.1381 excl. Primary IPv4).
- **Afterwards:** at 00:46:47 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario, 4 lines in the raw server log. Those lines are not in the committed excerpts, which start at each scenario's marker. Then the runner's scenario commands. Test server only, no difficulty change.
- **World seed:** see `notes.worldSeed` in each `result.json`. **Cube centre:** -44 102 -63, radius 16.

| Scenario | Time (UTC) | Verdict | Checks | `notes.loginRetry` |
| --- | --- | --- | --- | --- |
| `g2-blocks-named` | 00:31:55-00:41:50 | FAIL | `login_online` PASS; `blocks_named` PASS (39 non-air types); **`blocks_confirmed` FAIL (110/111)**; `blocks_spotcheck` PASS (40/40 non-air, 88 positions asked, 0 unloaded, no skew) | `{retried: false}` |
| `g2-mobs-named` | 00:41:53-00:44:09 | **PASS** | `login_online`; `mobs_named` 12/12; `mobs_confirmed` 12/12 by run tag | `{retried: false}` |
| `g2-items-roundtrip` | 00:44:12-00:46:06 | **PASS** | `items_table` (643/643), `login_online`, and `items_read`, `items_named`, `items_roundtrip` (30/30 each) | `{retried: false}` |

## Blocks

- **`metaDrift`:** 0 of 110 (no sample whose meta changed since the census).
- **The one failed sample:** `-56,95,-58 census biomesoplenty:plant_0 0 fresh minecraft:air 0 server found: FAIL`.
  - The census (about 00:33) named a Biomes O' Plenty plant there.
  - At the re-ask, between 00:33 and 00:38, the bot said `minecraft:air 0`, and the server's `testforblock` confirmed air.
  - So the bot named the position correctly both times; the plant itself was gone. The rule agreed for #67 fails any sample whose fresh name differs from the census name, so this run fails.
  - Why the plant went is not in the log. A mob, or a neighbouring block change, could remove it.
  - The 11 other `biomesoplenty:plant_0` samples were all confirmed.

## Mobs

- **Summoned (from `common-mobs.json`):**
  - vanilla: `minecraft:slime`, `minecraft:creeper`, `minecraft:spider`, `minecraft:skeleton`, `minecraft:zombie`;
  - modded: `butterflies:butterfly`, `charm:spectre`, `animania:toad`, `betteranimalsplus:deer`, `animania:cow_holstein`, `animania:hen_rhode_island_red`, `animania:hen_wyandotte`.

  That is 7 modded mobs.
- **Replaced:** none.
- **Other entities reported:** one natural `primitivemobs:grovesprite`. It is in `notes.otherSeen` and not judged; its name is not a placeholder.
