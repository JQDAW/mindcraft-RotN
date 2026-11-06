# G3 smoke round 4, batch A (2026-11-06): `g3-rocks-to-stone-tools`, PASS 7/7; the whole agenda done; a SMOKE batch; the server is deleted

**Result in one line:** the agent did **all 11 agenda steps ("agenda done") in 6.3 min** after its join: rocks to a stone pickaxe, a stone axe and 10 `undergroundbiomes:metamorphic_cobble:6`. Every check passed, and every LLM call succeeded.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit).

## Run conditions

- **GO:** the lead's written GO for G3 smoke round 4 (approved by the human at 06:30Z on 2026-11-06).
- **Code:** a clean detached checkout of `origin/develop` at `09197157` (#248, #249 and #250 included), after `npm ci`. `result.json` records the model `openrouter/@preset/glm-5-3-flash-cheap-reliable`.
- **Checks right before the create (06:32:43-06:32:59 UTC), all passed:**
  - `msa-login FRCFLD --check`;
  - `hcloud` server and Primary IP lists empty (the project's one SSH key is the human's own, without the batch label);
  - the batch preflight on its own, now with the LLM probe: "the LLM probe answered (HTTP 200, provider Wafer, z-ai/glm-5.3-flash)", "timeouts: g3-rocks-to-stone-tools 37 min" for a 120 min TTL, and no midnight warning;
  - `test-server.sh up --dry-run`: sweeper OK.
- **Command:** `deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- node test/runner/batch.mjs --max-batch-usd 2 ... --scenario g3-rocks-to-stone-tools ...` (no skip flags, no `--gate`, no `--timeout-min`). The 5-minute LLM-failure stop rule (#248) was active and did not fire.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 06:33:16 |
| Server created, ready | 06:33:26, 06:36:28 |
| FRCFLD joined | 06:36:38 |
| "agenda step rocks started" | 06:36:40 |
| "agenda step crafting_table done" | 06:40:50 |
| "agenda done" | 06:42:54 |
| Bot left, command exited | 06:45:21, 06:45:33 |
| Server, Primary IP and SSH key verified gone | 06:45:49 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS (UUID version 4) |
| `fresh_start` | PASS: none of the 24 target items; the pack's first-join Bread and Bundle seen |
| `stone_tools` | PASS: stone pickaxe 1, stone axe 1 |
| `crafting_table` | PASS: held 1 (`notes.craftingTablePath`) |
| `cobblestone` | PASS: `undergroundbiomes:metamorphic_cobble:6` 10 |
| `crafted_by_bot` | PASS: crude axe, Crafting Tools, crafting table, stone pickaxe, stone axe, 1 each |
| `no_cheat` | PASS: only the pack's first-join commands |

## The crafting table's use stat (the lead's question)

- The skill logged three placements ("Placed crafting_table at (-76, 63, -90).", then (-77, 63, -91) and (-77, 63, -92)). After each craft it picked the table up again ("Collected 1 crafting_table."). So at the end, `testforblock` finds Air in all three cells, and the table is in the inventory: the check passes on "held".
- `stat.useItem.minecraft.crafting_table` stayed 0 through all three placements, as it did for the one placement in round 3 continuation A.
- **The cause is in Forge, not in the bot or the harness:**
  - Forge 1.12.x `ForgeHooks.onPlaceItemIntoWorld` sets the stack to its new count ("Change the stack to its new content", `itemstack.setCount(newSize)`). Only then does it call `player.addStat(StatList.getObjectUseStats(itemstack.getItem()))`.
  - The bot only ever holds one table, so each placement uses the last item of the stack. That leaves the stack empty, and an empty stack's `getItem()` in 1.12 is air.
  - So the use is credited to air, never to the table.
- **Consequence:** the use stat only counts a table placed from a stack of 2 or more. DRIVER.md and the scenario's header now say so. No check changes: the held count and the placed-block path (#245) already carry `crafting_table`.

## LLM and cost

- **LLM:** 47 calls: 37 agent replies and 10 memory summaries OK; 0 failed, 0 disconnected, 0 empty, no HTTP errors.
- **Spend:** USD 0.004769 (key usage 0.759115 to 0.763885).
- **Hetzner:** ran 12 min, billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone; the project was empty again before batch B.

## Files

- `batch.json`, `run.log`: the batch summary and the whole batch output.
- `rocks/result.json`, `rocks/driver.log`, `rocks/server.log`: the scenario's result and its two logs.
- Everything went through `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs stay in `captures/raw/r4-g3a/` (not committed).
