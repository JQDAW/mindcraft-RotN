# G3 smoke round 6, batch B (2026-11-06): `g3-first-night`, 4 of 5; a zombie killed the bot in the open after its shelter found "0 sturdy blocks"; a SMOKE batch; the server is deleted

**Result in one line:** the bot finished all 11 agenda steps, but at sunset its shelter refused three times ("needs 9 sturdy blocks (cobblestone or stone); you have 0") while it carried 11 Underground Biomes cobble. It stayed in the open at -65 52 -60, and at 18:16:30 "FRCFLD was slain by Zombie".

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit).

## Run conditions

- **GO:** the round 6 GO; the run command went through Claude Code's auto mode (corrected after round 7: run commands go through Claude Code's auto mode, not a human approval).
- **Code:** a clean detached checkout of `origin/develop` at `f7fbe4fe`, after `npm ci`.
- **Free memory at 17:39:04 UTC:** 6,065 MB physical, 13,526 MB virtual.
- **Checks right before the create (17:39:04-17:39:13 UTC), all passed:** `msa-login`; an empty project; the batch preflight with the LLM probe (HTTP 200, provider Wafer), "timeouts: g3-first-night 67 min" for a 180 min TTL, no midnight warning; the dry run (sweeper OK by its scheduled run).
- **Command:** as in batch A, with `--ttl-hours 3` and `--scenario g3-first-night --out <raw>/night`. The LLM-failure stop rule was active and did not fire.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 17:39:21 |
| Server created, ready | 17:39:43, 17:44:52 |
| FRCFLD joined | 17:45:02 |
| Daytime held at 3001 (Extended Days, below) | minutes 2.3-11.5 after the join |
| "[night] sunset is near: building a shelter" | 17:59:32 |
| "[night] no shelter after 3 tries (... needs 9 sturdy blocks (cobblestone or stone); you have 0.); staying here until morning" | 18:00:33 |
| Daytime held at 16001 (Extended Days) | minutes 22.9-31 |
| "FRCFLD was slain by Zombie" | 18:16:30 |
| Checks | 18:17:11-18:17:13 |
| Command exited | 18:17:25 |
| Server, Primary IP and SSH key verified gone | 18:17:40 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `survived_night` | **FAIL:** no dawn (the bot died: "FRCFLD was slain by Zombie"); `stat.deaths` 1 |
| `stayed_online` | PASS: online from the join to the end (31.2 min) |
| `no_cheat` | PASS |

## What the bot did (`night/driver.log`, `night/server.log`)

- **Fresh state:** `agenda.json` and `memory.json` moved aside; the chat limit on ("wrapped on playerJoin"); no agent exit; no kick.
- **Sticks by felling:** "Felled the tree at -73, 64, -44: 3 drops within 20 blocks (2 new)", "Collected 3 stick."
- **The first plank by Hit With Axe:** "Used pyrotech:crude_axe on hitwithaxe:debarked_spruce"; the axe was kept, and the agenda went on to crafting tools, the table, both stone tools and cobblestone: "agenda done".
- **The night:** at sunset the inventory held `undergroundbiomes:metamorphic_cobble:6` (11 at the death), 44 rocks, 32 dirt piles, the stone pickaxe and the stone axe. The shelter counted 0 sturdy blocks: its list knows cobblestone and stone, not RotN's Underground Biomes cobble. The bot stayed in the open and was killed by a zombie 16 minutes later.
- **After the respawn** it had lost everything (`I died at -65, 52, -60; lost 32 betterwithmods:dirt_pile, 30 log:1, ...`), and the shelter then refused because it had no pickaxe to dig out again.

**For skills-rotn (via the lead):** the shelter's sturdy blocks should include RotN's cobble (`undergroundbiomes:*_cobble`, and likely `contenttweaker:*_cobble`, the variant batch A made).

## The daytime holds: Extended Days

- `time query daytime` stood at **3001 from minute 2.3 to 11.5**, and at **16001 from minute 22.9 to the death at minute 31**.
- That is the pack's Extended Days mod (`extendeddays@0.2.9` in the FML mod list; `mods/ExtendedDays-1.12.2-0.2.9-28.jar` in the RotN 3.3.4 server pack). The pack's `config/extendeddays.cfg` sets `"Extended Periods" < 3000 10  16000 10 >`: 10 real minutes are added at daytime 3000 and again at 16000, so the clock holds there for about 10 minutes and days and nights run longer.
- The scenario allows for it: `maxMinutes` is 55, and S1-A's measured cycle of about 40 minutes already included both holds.

## LLM, providers and memory summaries

- **Requests:** 58: 44 agent replies, **14 memory summaries stored**, 0 failed, no HTTP errors.

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| Wafer | 58 | 0 | 11 | 0 |
| Not attributed (another request was in flight) | - | - | 3 | 0 |

## Cost

- **Spend:** USD 0.007017 by the batch (key usage 0.797969 to 0.804986, from `batch.json`); the scenario's own reading says 0.006648. The difference is usage OpenRouter recorded after the scenario's end reading, which the batch's end reading includes.
- **Hetzner:** ran 38 min, billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone.

## Files

- `batch.json`, `run.log`, and `night/result.json`, `night/driver.log`, `night/server.log`.
- All are redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs are in `captures/raw/r6-g3b/` (not committed).
