# G2 batch 1, 2026-11-01: FAIL (items PASS; blocks and mobs FAIL)

harness-ops ran this batch on the lead's written GO (22:03 UTC), exactly as the G2 batch plan in `coord/STATUS-harness-ops.md` (#51) says. **It is not a G2 pass.** Items passed. Blocks and mobs failed. All three runs were valid gate runs: `gateValid: true`, no `weakenedParams`, no `notGate` reasons, and no kicks.

The files are redacted with `test/tools/redact-evidence.mjs`:
- the bot's name becomes `<bot>`;
- player UUIDs become `<uuid-v4>`;
- the bot's address in the 1.12 login line becomes `<ip>`;
- local paths become `<local>`.

`test/unit/evidence-redaction.test.js` fails CI if any IP address, UUID or local path is left in `test/evidence/g2/**`. Mod version strings with four numbers, such as the versions in FML's `modid@version` join list, are not addresses and are kept. No tokens appear here. The `msa-login --check` output is not part of this evidence.

| Folder | Scenario | Files |
| --- | --- | --- |
| `blocks/` | `g2-blocks-named` | `result.json`, `server.log` (from the runner's begin marker), `driver.log` |
| `mobs/` | `g2-mobs-named` | the same |
| `items/` | `g2-items-roundtrip` | the same |

## Run

- **Code:** a clean detached checkout of develop at 36d7ee8, after `npm ci`. Each `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create:**
  - `agentNaming('.')`: wired, 643/643 entries.
  - The bot's login cache: OK.
  - The preflight on its own: the sweeper scheduled run was 54 min old; no leftover labelled resources.
- **Server:** one CPX42 in nbg1, `--ttl-hours 2`, `deploy/test-server.sh run` unchanged.
  - Created 22:10:20 UTC, ready 22:13:02.
  - Deleted by the EXIT trap and verified gone at 22:24:20: up 14 min (plan about 37, hard stop 56).
- **Cost:** 1 billed hour, about EUR 0.14 (EUR 0.1381 excl. Primary IPv4).
- **Afterwards:** at 22:24:37 UTC, `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` were all empty.
- **Console:** `time set day` and `gamerule doDaylightCycle false` before the first scenario, then the runner's scenario commands. Test server only.
- **World seed:** 4200657588867313809. **Cube centre:** -46 80 -65, radius 16.

| Scenario | Time (UTC) | Verdict | Checks |
| --- | --- | --- | --- |
| `g2-blocks-named` | 22:13:10-22:20:18 | FAIL | `login_online` PASS. `blocks_named` PASS (50 non-air types). `blocks_confirmed` FAIL (0/150). `blocks_spotcheck` FAIL (0 of 40; stopped after 16 positions) |
| `g2-mobs-named` | 22:20:18-22:22:07 | FAIL | `login_online` PASS. `mobs_named` FAIL (9/12). `mobs_confirmed` FAIL (10/12) |
| `g2-items-roundtrip` | 22:22:07-22:23:58 | **PASS** | `items_table` (643/643), `login_online`, `items_read`, `items_named` and `items_roundtrip` (30/30 each) |

## Why blocks and mobs failed

1. **Reply parser (runner bug, fixed in #64).** This server prints `Successfully found the block at -38, 72, -58`, with spaces after the commas and no full stop. The parser expected the lang form `x,y,z.`, so every confirmation counted as a failure: a false fail, never a false pass.
   - `server.log` in `blocks/` has 158 success lines out of 166 `testforblock` replies.
   - The 10 spot "failures" that stopped the spot check were also success lines.
2. **Dynamic Trees state drift.** The other 8 replies were `had the data value of N (expected: M)`, all on `dynamictrees`/`dynamictreesbop` leaves and branches.
   - The name was right every time; only the meta had changed (for example 14 against 6).
   - The samples were checked 2-5 min after the census.
3. **`minecraft:chicken` and `minecraft:pig`:** `Unable to summon object` on this pack. These two come from `common-mobs.json`.
4. **`charm:spectre`:** summoned, but gone before the bot looked; `kill` did not find it either.
5. **`mobs_confirmed`** ran `testfor` on two ambient Animania animals the bot also reported (`cow_angus`, `calf_angus`). They were never summoned, and they had moved out of the 3-block radius.

Also seen, not caused by the bot or the runner:
- Time Shall Not Pass logs "The daylight cycle has been enabled" whenever a player connects, so `gamerule doDaylightCycle false` did not hold.
- A pack mod runs `gamerule commandBlockOutput/sendCommandFeedback false` as the joining player. On the first join it also gives Bread and a Bundle.

The proposed fixes for findings 2-5 are in `coord/STATUS-harness-ops.md`, "Real G2 batches". A re-run needs the lead's decisions and a new written GO.
