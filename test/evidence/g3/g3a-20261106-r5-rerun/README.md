# G3 smoke round 5, batch A rerun (2026-11-06): `g3-rocks-to-stone-tools`, 3 of 7; the agenda paused itself at `sticks`; a SMOKE batch; the server is deleted

**Result in one line:** no crash this time. The bot got 25 logs but only 1 stick, could not make planks without a table, walked 180 s towards an underground log, and the agenda paused itself as stuck at `sticks`. The four task checks failed on that.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit).

## Run conditions

- **GO:** the round 5 GO, resumed by the lead after the human's approval at 12:45Z: rerun A, then B, C, D.
- **Code:** a clean detached checkout of `origin/develop` at `1a7d990f` (with #266, #267 and skills-rotn's `history.js` and chat-limit fixes), after `npm ci`.
- **Checks right before the create (12:47:17-12:47:29 UTC), all passed:** `msa-login`; an empty project; the batch preflight with the LLM probe (HTTP 200, provider OpenInference), "timeouts: g3-rocks-to-stone-tools 37 min" for a 120 min TTL, no midnight warning; the dry run (sweeper OK).
- **Command:** as in batch A. The LLM-failure stop rule was active and did not fire.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 12:47:42 |
| Server created, ready | 12:48:09, 12:53:16 |
| FRCFLD joined | 12:53:26 |
| `!collectBlocks("stick", 4)` (first) | about 12:55 |
| `!searchForBlock("log", 64)`: 180 s of pathfinding | about 12:57-13:00 |
| Checks ("agenda paused") | 13:01:04 |
| Command exited | 13:01:19 |
| Server, Primary IP and SSH key verified gone | 13:01:39 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `stone_tools` | FAIL: 0 and 0; "the agenda is stuck at step sticks: 5 min of self-prompting; agenda paused" |
| `crafting_table` | FAIL: held 0, placed 0 |
| `cobblestone` | FAIL |
| `crafted_by_bot` | FAIL: all 0 |
| `no_cheat` | PASS |

## What the bot did (`rocks/driver.log`)

1. **The fixes held:** the driver moved `agenda.json` and `memory.json` aside (`botState.fresh: true`); "[chat] the outgoing chat limit is on (wrapped on playerJoin)"; the agent never exited.
2. **Sticks by felling, half working:** `!collectBlocks("stick", 4)` cut spruce trees three times. The first breaks gave "no drops appeared within 6 s" and "Broke dynamictrees:sprucebranch but got no stick". One felling did drop ("Felled the tree at -74, 63, -54: 1 drops"), and the item-collecting mode later picked up 25 `log:1` and 1 stick.
3. **No planks:** the bot tried `!craftRecipe("planks", 2)` itself and got "Crafting planks requires a crafting table". It also tried `!newAction`, refused because code writing is off.
4. **Lost minutes:** `!collectBlocks("log", 4)` twice gave "its trunk is not in sight"; `!searchForBlock("log", 64)` chose a log at -40 45 -33, underground, and pathfinding ran out its 180 s.
5. The agenda then paused itself as stuck. No deaths, falls or kicks.

**For skills-rotn (via the lead):** few sticks from felling, no hand-crafted planks (rotn-data's "Hit With Axe" planks came after this run), and the search for an underground log.

## LLM, providers and memory summaries

- **Requests:** 20: 16 agent replies, 0 summaries stored, **4 failed: 4 empty memory summaries** ("Empty content returned (... finish_reason stop)", then "[memory] summary returned failure reply \"No response received.\"; keeping the previous memory").
  - The run log says "3 failed": the last summary was still open when the log ended, and the counter then did not know `history.js`'s new line. The current counter (#273) reads 4.
- **Providers:** this run is from before #271, so it has no provider lines.

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| (not logged; the probe named OpenInference) | 20 | not logged (at least the 4 summaries) | 0 | 4 (not attributed) |

## Cost

- **Spend:** USD 0.002087 (key usage 0.772298 to 0.774385, from `batch.json`).
- **Hetzner:** ran 13 min (5.5 of them the server build), billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone.

## Files

- `batch.json`, `run.log`, and `rocks/result.json`, `rocks/driver.log`, `rocks/server.log`.
- All are redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs are in `captures/raw/r5-g3a-rerun/` (not committed).
