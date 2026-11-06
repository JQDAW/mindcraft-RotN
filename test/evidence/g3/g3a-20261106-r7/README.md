# G3 smoke round 7, batch A (2026-11-06): `g3-rocks-to-stone-tools`, PASS 7 of 7; the pre-gate round on 42a8e94; a SMOKE batch; the server is deleted

**Result in one line:** on the pre-gate commit, the bot dug dirt piles for its shelter (the new `shelter_blocks` step), felled trees for sticks, made the first plank with Hit With Axe, crafted both stone tools by minute 9.2 and finished all 11 agenda steps.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit). A smoke PASS is never a gate pass.

## Run conditions

- **GO:** the lead's written GO for G3 smoke round 7, the pre-gate round under PLAN.md's gate rule (#290): four smoke batches on develop at exactly `42a8e94`, each on its own fresh CPX42; the gate needs 4/4 here. The run command went through Claude Code's auto mode.
- **Code:** a clean detached checkout of `42a8e9423fe8` (not a later develop), after `npm ci`.
- **Free memory at 20:21:14 UTC:** 6,068 MB physical, 13,225 MB virtual.
- **Checks right before the create (20:21:14-20:21:27 UTC), all passed:** `msa-login FRCFLD --check`; an empty project (only the human's own unlabelled SSH key); the batch preflight with the LLM probe (HTTP 200, provider Wafer), "timeouts: g3-rocks-to-stone-tools 37 min" for a 120 min TTL, no midnight warning; the dry run (sweeper OK by the dispatch cadence).
- **Command:** `bash deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- node test/runner/batch.mjs --max-batch-usd 2 --logs-out <raw>/server --summary <raw>/batch.json --scenario g3-rocks-to-stone-tools --out <raw>/rocks -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json`. No skip flags, no `--gate`, no `--timeout-min`. The LLM-failure stop rule was active and did not fire.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 20:21:42 |
| Server created, ready | 20:22:05, 20:25:14 |
| FRCFLD joined | 20:25:26 |
| Crude axe; crafting tools and table; stone pickaxe; stone axe (minutes after the join) | 4.8; 5.9; 7.0; 9.2 |
| Checks | 20:36:16-20:36:20 |
| Command exited | 20:36:32 |
| Server, Primary IP and SSH key verified gone | 20:36:45 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `stone_tools` | PASS: stone pickaxe 1, stone axe 1 |
| `crafting_table` | PASS: placed at -64 63 -70 (the server's block) |
| `cobblestone` | PASS: `undergroundbiomes:igneous_cobble:0` 1, `metamorphic_cobble:0` 1, `metamorphic_cobble:6` 8 (10 in all) |
| `crafted_by_bot` | PASS: crude axe, crafting tools, crafting table, stone pickaxe, stone axe, 1 each |
| `no_cheat` | PASS |

## What the bot did (`rocks/driver.log`)

- **Fresh state:** the driver moved `agenda.json` and `memory.json` aside; the chat limit on ("wrapped on playerJoin"); no agent exit; no kick; no deaths.
- **Sticks:** it looked for cane and bamboo near a river first ("No bamboo either"), then felled trees: "Collected 4 stick." (8 in all).
- **The dirt-pile change (#288):** a new agenda step, `shelter_blocks` ("keep 10 blocks for the night's shelter"); the bot dug `betterwithmods:dirt_pile` by hand (40, later 64).
- **The first plank by Hit With Axe:** "Used pyrotech:crude_axe on hitwithaxe:debarked_dark_oak"; `pyrotech:crude_axe: 1` stayed in the inventory.
- Then the crafting tools, the table, planks and sticks, both stone tools and 10 cobblestone: "agenda done".

## LLM, providers and memory summaries

- **Requests:** 56: 43 agent replies, **13 memory summaries, all stored**, 0 failed, no HTTP errors.
- **The run log says "2 failed, 2 of them empty summaries": a harness miscount.** The log has 13 "Storing memories..." lines, 13 "Memory updated to:" lines and no "[memory] summary returned" line. Twice a second summary started before the first one's reply came back (log lines 281, 321, 330 and 633, 673, 682), and the counter's rule "the next start closes an open summary as empty" counted those two as empty. The fix (match each stored summary to the oldest open one) comes after the gate, by the lead's decision, so the commit stays 42a8e94.

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| Wafer | 56 | 0 | 7 | 0 |
| Not attributed (another request was in flight) | - | - | 6 | 0 (the counter's 2 are not real) |

## Cost

- **Spend:** USD 0.009902 (key usage 0.815583 to 0.825485, from `batch.json`).
- **Hetzner:** ran 14 min, billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone.

## Files

- `batch.json`, `run.log`, and `rocks/result.json`, `rocks/driver.log`, `rocks/server.log`.
- All are redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs are in `captures/raw/r7-g3a/` (not committed).
