# G2 batch 4, 2026-11-02: FAIL (blocks 147/150; mobs PASS; items PASS)

harness-ops ran this batch on the lead's written GO (2026-11-02 01:11 UTC), exactly as the plan in `coord/STATUS-harness-ops.md` says.

**It is not a G2 pass.** `g2-blocks-named` failed 3 runner-picked samples, all of them the upper half of a double plant.
- All three runs were valid gate runs: `gateValid: true`, no `weakenedParams`, no `notGate` reasons, no kicks.
- No scenario used the login retry: `notes.loginRetry` is `{retried: false}` in all three.

All files are redacted with the merged `test/tools/redact-evidence.mjs`, and the CI leak check (`test/unit/evidence-redaction.test.js`) passes on them. The `msa-login --check` output is not part of this evidence.

| Folder | Scenario | Files |
| --- | --- | --- |
| `blocks/` | `g2-blocks-named` | `result.json`, `server.log` (from the runner's begin marker), `driver.log` |
| `mobs/` | `g2-mobs-named` | the same |
| `items/` | `g2-items-roundtrip` | the same |

## Run

- **Code:** a clean detached checkout of develop at 3102f6c (#72-#77), after `npm ci`, which applied #74's prismarine-auth patch. Every `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create:**
  - `agentNaming('.')`: wired, 643/643.
  - The bot's login cache: OK.
  - The preflight on its own passed (a scheduled sweeper run, 21 min old). No leftover labelled resources.
- **Server:** one CPX42 in nbg1, `--ttl-hours 2`, `deploy/test-server.sh run` unchanged.
  - Created 01:13:32 UTC, ready 01:16:37.
  - Deleted by the EXIT trap and verified gone at 01:33:04: up 20 min (hard stop 56).
- **Cost:** 1 billed hour, about EUR 0.14 (EUR 0.1381 excl. Primary IPv4).
- **Afterwards:** at 01:33:44 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.
- **Console:** `gamerule doDaylightCycle false` once and `time set day` before each scenario, 4 lines in the raw server log only. The committed excerpts start at each scenario's marker. Then the runner's scenario commands. Test server only, no difficulty change.
- **World seed:** 1880465901402976865. **Cube centre:** -45 66 -66, radius 16.

| Scenario | Time (UTC) | Verdict | Checks | `notes.loginRetry` |
| --- | --- | --- | --- | --- |
| `g2-blocks-named` | 01:16:43-01:27:45 | FAIL | `login_online` PASS; `blocks_named` PASS (50 non-air types); **`blocks_confirmed` FAIL (147/150)**; `blocks_spotcheck` PASS (43 non-air of 40, 72 positions, 0 unloaded, no skew) | `{retried: false}` |
| `g2-mobs-named` | 01:27:48-01:30:39 | **PASS** | `login_online`; `mobs_named` 12/12 (1 replaced); `mobs_confirmed` 12/12 by run tag | `{retried: false}` |
| `g2-items-roundtrip` | 01:30:42-01:32:38 | **PASS** | `items_table` (643/643), `login_online`, and `items_read`, `items_named`, `items_roundtrip` (30/30 each) | `{retried: false}` |

## Blocks

- **`worldChanges`:** none. **`metaDrift`:** 0 of 147.
- **The 3 failures** are one systematic disagreement between the bot and the server, not world changes. In each, the server did not confirm the fresh answer.

  ```
  -44,67,-58 census minecraft:double_plant 11 fresh minecraft:double_plant 11 server The block at -44, 67, -58 had the data value of 10 (expected: 11): FAIL
  -38,70,-50 census minecraft:double_plant 11 fresh minecraft:double_plant 11 server The block at -38, 70, -50 had the data value of 10 (expected: 11): FAIL
  -36,71,-50 census minecraft:double_plant 11 fresh minecraft:double_plant 11 server The block at -36, 71, -50 had the data value of 10 (expected: 11): FAIL
  ```

- These are the three sampled **upper halves** of double plants.
  - The census lists `minecraft:double_plant 11 24` and no `double_plant 10`, so the bot reads every upper half as meta 11, where the server has 10.
  - The lower halves (`double_plant 3`) were confirmed 3/3.
  - In 1.12, an upper half's meta is `8 | facing` (NORTH = 10 is the default a generated plant gets), so the server's 10 is the expected value. Unverified: the bot's 11 suggests its decode of this block state differs.
- **For net-forge / rotn-data:** all three positions are in chunk (-3, -4), and the blocks session's forge-bridge capture (`captures/raw/`, not committed) holds that chunk's `map_chunk` packet. Decoding it offline shows whether the server sent 10 or 11.
- **Not related:** three `betterwithmods` `[EXPLOSION]` lines at (118, 6, -216), deep underground and about 160 blocks from the cube, at 01:18.

## Mobs

- **Summoned:**
  - vanilla: `minecraft:slime`, `minecraft:creeper`, `minecraft:spider`, `minecraft:skeleton`, `minecraft:zombie`;
  - modded: `butterflies:butterfly`, `quark:stoneling`, `animania:toad`, `betteranimalsplus:deer`, `animania:cow_holstein`, `animania:hen_rhode_island_red`, `animania:hen_wyandotte`.

  That is 7 modded mobs.
- **Replaced:** 1 of 12 (cap 3). `charm:spectre` vanished before the bot was asked and was replaced by `quark:stoneling`.
- **Other entities:** none reported.
