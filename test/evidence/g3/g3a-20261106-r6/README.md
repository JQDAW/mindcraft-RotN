# G3 smoke round 6, batch A (2026-11-06): `g3-rocks-to-stone-tools`, PASS 7 of 7; the whole agenda in under 6 minutes; a SMOKE batch; the server is deleted

**Result in one line:** the bot got its sticks by felling, made its first plank with Hit With Axe and kept its crude axe, crafted both stone tools by minute 4.8, and finished all 11 agenda steps ("agenda done").

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit). A smoke PASS is never a gate pass.

## Run conditions

- **GO:** the lead's written GO for G3 smoke round 6 (approved by the human); the run command went through Claude Code's auto mode (corrected after round 7: run commands go through Claude Code's auto mode, not a human approval).
- **Code:** a clean detached checkout of `origin/develop` at `f7fbe4fe`, after `npm ci`.
- **Free memory at 17:24:54 UTC:** 5,901 MB physical, 13,390 MB virtual.
- **Checks right before the create (17:24:54-17:25:04 UTC), all passed:** `msa-login FRCFLD --check`; an empty project (only the human's own unlabelled SSH key); the batch preflight with the LLM probe (HTTP 200, provider Wafer), "timeouts: g3-rocks-to-stone-tools 37 min" for a 120 min TTL, no midnight warning; the dry run (sweeper OK by its scheduled run, 72 min old).
- **Command:** `bash deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- node test/runner/batch.mjs --max-batch-usd 2 --logs-out <raw>/server --summary <raw>/batch.json --scenario g3-rocks-to-stone-tools --out <raw>/rocks -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json`. No skip flags, no `--gate`, no `--timeout-min`. The LLM-failure stop rule was active and did not fire.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 17:25:14 |
| Server created, ready | 17:25:35, 17:28:28 |
| FRCFLD joined | 17:28:39 |
| Crude axe, crafting tools, table crafted (minutes after the join) | 3.7 |
| Stone pickaxe and stone axe crafted | 4.8 |
| Checks | 17:36:11-17:36:15 |
| Command exited | 17:36:26 |
| Server, Primary IP and SSH key verified gone | 17:36:39 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `stone_tools` | PASS: stone pickaxe 1, stone axe 1; the agent reports its cobblestone step done |
| `crafting_table` | PASS: placed at -19 72 -76 (the server's block) |
| `cobblestone` | PASS: `contenttweaker:chalk_cobble:0` 10 |
| `crafted_by_bot` | PASS: crude axe, crafting tools, crafting table, stone pickaxe, stone axe, 1 each |
| `no_cheat` | PASS |

## What the bot did (`rocks/driver.log`)

- **Fresh state:** the driver moved `agenda.json` and `memory.json` aside; "[chat] the outgoing chat limit is on (wrapped on playerJoin)"; no agent exit.
- **Sticks by felling:** "Felled the tree at -36, 68, -71: 3 drops within 20 blocks", "Felled the tree at -32, 71, -81: 2 drops", "Collected 4 stick."
- **The first plank by Hit With Axe:** `!placeHere("log")`, the crude axe debarked it, then `!useOn("pyrotech:crude_axe", "hitwithaxe:debarked_oak")`. The inventory still showed `pyrotech:crude_axe: 1` afterwards: the axe reserve was kept.
- Then crafting tools, the table, planks and sticks at the table, both stone tools and 10 cobblestone; "agenda done".
- The unstuck reflex interrupted one `collectBlocks` and asked for a re-plan without an LLM call; no fall followed. No deaths, no kick.

## LLM, providers and memory summaries

- **Requests:** 42: 33 agent replies, **9 memory summaries stored**, 0 failed, no HTTP errors.

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| Wafer | 42 | 0 | 6 | 0 |
| Not attributed (another request was in flight) | - | - | 3 | 0 |

## Cost

- **Spend:** USD 0.005378 (key usage 0.792589 to 0.797967, from `batch.json`).
- **Hetzner:** ran 11 min, billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone.

## Files

- `batch.json`, `run.log`, and `rocks/result.json`, `rocks/driver.log`, `rocks/server.log`.
- All are redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs are in `captures/raw/r6-g3a/` (not committed).
