# G3 smoke round 7, batch B (2026-11-06): `g3-first-night`, 4 of 5; the bot sat in its shelter for 8 minutes, left it to rebuild, could not equip a weapon, and a zombie killed it; a SMOKE batch; the server is deleted

**Result in one line:** the shelter now builds (the dirt-pile fix worked), but after 8 min 23 s the bot judged it "no longer usable (fire, lava or a block inside)" and started a new one; a zombie attacked, `self_defense` failed to equip a weapon ("Server rejected transaction for clicking on slot 16"), and 28 s later "FRCFLD was slain by Zombie". `survived_night` failed, so round 7 cannot be 4/4: no gate on 42a8e94.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit).

## Run conditions

- **GO:** the round 7 GO (as in batch A); the run command went through auto mode.
- **Code:** a clean detached checkout of `42a8e9423fe8`, after `npm ci`.
- **Free memory at 20:39:38 UTC:** 6,264 MB physical, 13,494 MB virtual.
- **Checks right before the create (20:39:38-20:39:51 UTC), all passed:** `msa-login`; an empty project; the batch preflight with the LLM probe (HTTP 200, provider Wafer), "timeouts: g3-first-night 67 min" for a 180 min TTL, no midnight warning; the dry run (sweeper OK by the dispatch cadence).
- **Command:** as in batch A, with `--ttl-hours 3` and `--scenario g3-first-night --out <raw>/night`. The LLM-failure stop rule was active and did not fire.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 20:39:59 |
| Server created, ready | 20:40:18, 20:43:09 |
| FRCFLD joined | 20:43:19 |
| Daytime held at 3001 (Extended Days) | minutes 2.2-11.3 after the join |
| "[night] sunset is near: building a shelter"; "[night] in the shelter at -36, 69, -114 until morning" | 20:57:47 |
| "[night] the shelter at -36, 69, -114 is no longer usable (fire, lava or a block inside): building a new one" | 21:06:10 |
| "FRCFLD was slain by Zombie" (minute 22.8; daytime 16001, the night hold) | 21:06:38 |
| Checks | 21:07:06-21:07:08 |
| Command exited | 21:07:21 |
| Server, Primary IP and SSH key verified gone | 21:07:34 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `survived_night` | **FAIL:** no dawn (the bot died: "FRCFLD was slain by Zombie"); `stat.deaths` 1 |
| `stayed_online` | PASS: online from the join to the end (22.8 min) |
| `no_cheat` | PASS |

## What the bot did (`night/driver.log`, `night/server.log`)

- **The agenda:** all 11 steps, "agenda done". Sticks by felling ("Felled the tree at -42, 74, -104", "Collected 3 stick."); the first plank by Hit With Axe ("it is now hitwithaxe:debarked_oak"). Chat limit on; no agent exit; no kick.
- **The shelter:** built at sunset from dirt piles, and the bot stayed in it for 8 min 23 s.
- **"No longer usable":** at 21:06:10 the shelter check failed with "fire, lava or a block inside". The log does not say which, or what changed; the bot left to build a new one.
- **The fight it could not start:** `self_defense` interrupted the build and called `equipHighestAttack` (`src/agent/library/skills.js:62`), which failed in mineflayer's `clickWindow`: "Error: Server rejected transaction for clicking on slot 16, on window with id 0." The bot did not fight back, and `self_preservation` did not save it.
- **After the respawn** the shelter's pickaxe check showed "cursor: quark:tallow" (the bot had 3 tallow). An item held on the inventory cursor would make the server reject window clicks, but the log does not show whether the tallow was already on the cursor before the death.

**For skills-rotn and net-forge (via the lead):** why the shelter check judged the shelter unusable; the rejected window click in `equip` (a cursor item or an inventory desync); and leaving a working shelter at night at all.

## LLM, providers and memory summaries

- **Requests:** 54: 39 agent replies, **14 memory summaries stored**, 0 failed, no HTTP errors, and 1 summary request still in flight at the end (the log ends 1 line after its "Storing memories...").
- **The run log says "1 failed, 1 of them empty summaries": the same harness miscount as in batch A** (an overlapping summary). 15 started, 14 "Memory updated to:", no "[memory] summary returned" line, the 15th open at the end. True: 14 stored, 0 empty.

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| Wafer | 53 | 0 | 10 | 0 |
| Not attributed | - | - | 4 | 0 (the counter's 1 is not real) |
| In flight at the end (no completion) | 1 | - | - | - |

## Cost

- **Spend:** USD 0.009906 (key usage 0.825487 to 0.835393, from `batch.json`).
- **Hetzner:** ran 27 min, billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone.

## Files

- `batch.json`, `run.log`, and `night/result.json`, `night/driver.log`, `night/server.log`.
- All are redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs are in `captures/raw/r7-g3b/` (not committed).
