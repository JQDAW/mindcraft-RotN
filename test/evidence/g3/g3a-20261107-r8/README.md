# G3 smoke round 8, batch A (2026-11-07): `g3-rocks-to-stone-tools`, FAIL 3 of 7; on e5029f23; a SMOKE batch; the server is deleted

**Result in one line:** the agenda finished `rocks`, then stalled at `sticks`. No cane or bamboo was found within 511 blocks, and felling gave no sticks. A dead bush gave 1 stick (held 1 of 3). After the 5-minute self-prompt step limit, at 02:28:51, the bot logged "agenda step sticks stuck: 5 min of self-prompting; agenda paused". No table and no stone tools.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, not edited by hand).

## Run conditions

- **GO:** the lead's written GO for round 8, under the human's advance GO (2026-11-07, `coord/STATUS-rotn-lead.md`, #310). Smoke only, A-B-C-D. The run command went through auto mode.
- **Code:** a clean detached checkout of `e5029f2307a5` (develop, frozen for the round), after `npm ci` (8 of 8 patches). The run is on the CX33 dev server.
- **Free memory at 02:16:29 UTC:** 5,484 MB available of 7,746 MB, no swap.
- **Checks right before the create (02:16:29-02:16:35 UTC), all passed:**
  - `msa-login FRCFLD --check`;
  - the key present;
  - an empty project (0/0/0, counted with `grep -c .`);
  - the batch preflight with the LLM probe (HTTP 200, provider Wafer), "timeouts: g3-rocks-to-stone-tools 37 min" for a 120 min TTL, no midnight warning;
  - the dry run (sweeper OK by the scheduled path).
- **Command:** `deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- node test/runner/batch.mjs --max-batch-usd 2 --logs-out <raw>/server --summary <raw>/batch.json --scenario g3-rocks-to-stone-tools --out <raw>/rocks -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json`, with no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 02:21:47 |
| Server created, ready | 02:16:51, 02:21:45 |
| FRCFLD joined; "agenda step rocks started" | 02:21:59, 02:22:01 |
| "rocks done"; "sticks started" | 02:23:15 |
| "agenda step sticks stuck: 5 min of self-prompting; agenda paused" | 02:28:51 |
| Command exited (check FAIL, exit 1) | 02:30:38 |
| Server, Primary IP and SSH key verified gone | 02:30:52 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS: none of 24 target items held; the pack's first-join Bread and Bundle seen |
| `stone_tools` | FAIL: stone pickaxe 0, stone axe 0; "the agenda is stuck at step sticks" |
| `crafting_table` | FAIL: held 0, placed 0 |
| `cobblestone` | FAIL: none of the 35 4-rocks outputs held |
| `crafted_by_bot` | FAIL: crude axe, crafting tools, table, stone pickaxe and stone axe all 0 |
| `no_cheat` | PASS |

- No kick, no agent exit, no deaths.
- **The sticks path, from the bot's own replies:**
  - it looked for river cane, then bamboo, at 128, 256 and 511 blocks: none found;
  - `!collectBlocks("stick", 3)` was called four times (three times felling trees, once at the dead bush), each ending "Collected 0 stick" (the bot held 32 logs);
  - `!craftable` showed no stick recipe without a table;
  - a dead bush gave 1 stick (held 1 of 3): `!collectBlocks("dead_bush", 3)` logged "Broke deadbush but got no deadbush (it gave 1 stick)", and the next `!inventory` listed "stick: 1". The bot's own reply ("the drop didn't get picked up") misread that.
- **Its `!newAction` attempt was refused:** "Code writing is off". Insecure coding stays off, as intended.
- **Out of order:** "agenda step shelter_blocks started" (02:24:32) came before "agenda step logs done" (02:24:34), with sticks still open.
- **Same failure as round 5's A rerun** (stuck at `sticks`). Rounds 6 and 7 passed A on felling sticks.

## LLM, providers and memory summaries

- **Requests:** 33: 26 agent replies and **7 memory summaries stored**. None failed, none was empty, no HTTP errors, and none was in flight at the end.
- **Checked by hand:** 7 "Storing memories..." and 7 "Memory updated to:".

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| Wafer | 33 | 0 | 7 (3 attributed, 4 unattributed) | 0 |

## Cost

- **Spend:** USD 0.006970 (key usage 0.849110 to 0.856080, from `batch.json`).
- **Hetzner:** ran 14 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone.
  - The project was empty afterwards: 0/0/0 at 02:30:57, counted with `grep -c .`.

## Files

- `batch.json`, `run.log`, and `rocks/result.json`, `rocks/driver.log`, `rocks/server.log`.
- All were redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`, and `--check` is clean.
- The raw logs are in `captures/raw/r8-g3a/` (not committed).
- The round summary is in the batch D README (`g3d-20261107-r8`).
