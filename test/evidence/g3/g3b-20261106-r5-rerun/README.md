# G3 smoke round 5, batch B rerun (2026-11-06): `g3-first-night`, PASS 5 of 5; the whole agenda done and the night survived in a shelter; a SMOKE batch; the server is deleted

**Result in one line:** the bot finished all 11 agenda steps, built a shelter at sunset, stayed in it until dawn (minute 40.1) and never died. Every memory summary was stored.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit). A smoke PASS is never a gate pass.

## Run conditions

- **GO:** the round 5 GO; this rerun of B is a retry the lead approved after #273 merged, and after the human freed memory on the runner's machine.
- **Code:** a clean detached checkout of `origin/develop` at `a6825e81` (with #271's provider line and #273), after `npm ci`.
- **Free memory at 14:15:30 UTC:** 5,567 MB physical, 13,136 MB virtual.
- **Checks right before the create (14:15:30-14:15:42 UTC), all passed:** `msa-login`; an empty project; the batch preflight with the LLM probe (HTTP 200, provider **Wafer**), "timeouts: g3-first-night 67 min" for a 180 min TTL, no midnight warning; the dry run (sweeper OK).
- **Command:** as in batch B. The LLM-failure stop rule was active and did not fire.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 14:15:53 |
| Server created, ready | 14:16:28, 14:21:19 |
| FRCFLD joined | 14:21:30 |
| `login_online`, `fresh_start` | 14:22:33, 14:23:35 |
| "agenda steps done: sticks, logs" | 14:24:17 |
| Dusk, night (minutes after the join) | 19.5 (daytime 12504), 20.6 (13878) |
| "[night] in the shelter at -34, 66, -90 until morning" | about 14:35 |
| Dawn (minute 40.1, daytime 1246); checks | 15:02:50-15:02:52 |
| Command exited | 15:03:04 |
| Server, Primary IP and SSH key verified gone | 15:03:22 |

At 14:45 the lead saw `night/result.json` say "FAIL (killed)": that is the progress record `run.mjs` rewrites after every poll, and the final result replaced it at 15:02:55. The runner was never killed.

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `survived_night` | PASS: dawn reached; `stat.deaths` 0; death lines 0 |
| `stayed_online` | PASS: online from the join to the end (40.4 min) |
| `no_cheat` | PASS |

## What the bot did (`night/driver.log`, `night/server.log`)

- **The round 5 fixes held:** `agenda.json` and `memory.json` moved aside; "[chat] the outgoing chat limit is on (wrapped on playerJoin)"; no agent exit; no kick; no dropped or collapsed chat lines.
- **Sticks by felling:** the first tree gave "Broke the tree at -27, 79, -91: no drops appeared within 6 s"; then "Felled the tree at -29, 77, -90: 5 drops within 12 blocks (5 new), 0 left behind" and "Collected 4 stick." (a dark oak).
- **The agenda:** rocks, sticks, crude axe, logs, first plank, crafting tools, crafting table, planks and sticks, stone pickaxe, stone axe, cobblestone, then "agenda done".
- **The night:** "[night] sunset is near: building a shelter", then "[night] in the shelter at -34, 66, -90 until morning". No falls, no deaths near leaves or liquids.
- **Daytime stood at 3001 from minute 2.3 to 11.5,** then advanced normally (about 1,375 per sample). The server logged "Can't keep up! ... Running 2684ms behind" and "Time is 3001" at 14:24:44 (3 such lines in all). **That is the pack's Extended Days mod** (lead, after round 6; corrected from "the log does not show why"): `extendeddays@0.2.9` is in the FML mod list, and the RotN 3.3.4 server pack's `config/extendeddays.cfg` sets `"Extended Periods" < 3000 10  16000 10 >`, which adds 10 real minutes at daytime 3000 and again at 16000. The "Can't keep up!" lines are unrelated. The hold at 16000 is why the night ran from minute 20.6 to dawn at 40.1; the result is unaffected (DRIVER.md, the dawn rule).

## LLM, providers and memory summaries

- **Requests:** 45: 35 agent replies, **10 memory summaries stored**, 0 failed, no HTTP errors.

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| Wafer | 45 | 0 | 8 | 0 |
| Not attributed (another request was in flight) | - | - | 2 | 0 |

- The probe named Wafer as well. The provider counts come from openrouter.js's line per completion (#271); a summary is attributed only when exactly one completion came back while it was open (DRIVER.md, "Providers").

## Cost

- **Spend:** USD 0.005392 (key usage 0.779535 to 0.784927, from `batch.json`).
- **Hetzner:** ran 47 min, billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone.

## Files

- `batch.json`, `run.log`, and `night/result.json`, `night/driver.log`, `night/server.log`.
- All are redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs are in `captures/raw/r5-g3b-rerun/` (not committed).
