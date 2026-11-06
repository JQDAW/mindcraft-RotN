# G3 smoke round 3 continuation, batch A rerun (2026-11-06): `g3-rocks-to-stone-tools`, 6 of 7; the whole agenda done; a SMOKE batch; the server is deleted

**Result in one line:**
- With the new preset (`@preset/glm-5-3-flash-cheap-reliable`), the agent did **all 11 agenda steps ("agenda done") in 8.5 min**: rocks to stone pickaxe, stone axe and 10 `chalk_cobble`. Every LLM call succeeded.
- The one failing check, `crafting_table`, is a false negative of the check, not of the bot: the bot placed its table, but the server's use stat for it stayed 0.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit).

## Run conditions

- **GO:** the lead's written GO for the round 3 continuation (approved by the human at 01:07Z on 2026-11-06), resumed on the new preset after #241. The continuation's first A (01:10Z) never reached the LLM: every call got a 429 from the old preset's upstream provider. This is its rerun.
- **Probe right before** (the lead's rule): 02:13:18Z, HTTP 200, provider OpenInference, model `z-ai/glm-5.3-flash`, reply "ok".
- **Code:** a clean detached checkout of `origin/develop` at `aec33fe7` (#241 included), after `npm ci`. `result.json` records the model `openrouter/@preset/glm-5-3-flash-cheap-reliable`.
- **Checks right before the create (02:15:34-02:15:42 UTC), all passed:**
  - `msa-login FRCFLD --check`;
  - `hcloud server list` and `primary-ip list` are empty;
  - the batch preflight on its own, with the TTL ("timeouts: g3-rocks-to-stone-tools 37 min"), and no midnight warning;
  - `test-server.sh up --dry-run`: sweeper OK.
- **Command:** as in round 3 A (no skip flags, no `--gate`, no `--timeout-min`), with the output in `captures/raw/r3b-g3a-rerun/`.
- **The 5-minute LLM rule:** at 02:24:53 there were 33 successful replies, 0 "brain disconnected" and 0 × 429, so the run went on.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 02:15:52 |
| Server created, ready | 02:15:59, 02:19:03 |
| FRCFLD joined | 02:19:13 |
| Crude axe / Crafting Tools, table and stone pickaxe / stone axe | 3.7 / 5.9 / 7 min after the join |
| "agenda done" (all 11 steps) | 02:27:43 |
| Scenario end ("both stone tools crafted and the agent reports its cobblestone step done") | 9.3 min after the join |
| Teardown, "verified gone" | 02:30:32 |
| Project checked empty by hand | 02:30:43 |

## Checks (`rocks/result.json`)

| Check | Result |
| --- | --- |
| `login_online`, `fresh_start` | PASS |
| `stone_tools` | PASS: stone pickaxe 1, stone axe 1 |
| `crafting_table` | FAIL: held 0, placed (use stat) 0, a false negative (below) |
| `cobblestone` | PASS: `contenttweaker:chalk_cobble` x 10 (skills-rotn's #234: the rock's own recipe) |
| `crafted_by_bot` | PASS: all five crafts, by the server's craft stats |
| `no_cheat` | PASS (the pack's gamerule repeat at 02:23:08 went to `notes.packRepeats`) |

## Observations

1. **The first full agenda in any round:** 11 of 11 steps, no death, no hang.
2. **The table:**
   - The craft stat says it was crafted (`g3a_c_table` 1).
   - Placing it next to a tree failed twice ("Cannot place crafting_table ... nothing to place on"). The agent moved to dirt and placed it with `!placeHere`: "Placed crafting_table at (-42, 67, -54)" (`driver.log`). Later it walked back to the "crafting_table at (-42, 67, -54)" to craft the stone axe.
   - So the table stood in the world at the end (held 0), yet `stat.useItem.minecraft.crafting_table` stayed 0.
   - The check's "placed" path misses this RotN placement. It is fixed next, with the placed block itself as the evidence (lead, 2026-11-06).
3. **Dynamic Trees:** leaves gave no sticks several times, and once "Broke the tree ... no drops appeared within 6 s". The agent got its sticks another way.

## Cost

- **LLM:** 62 requests = **46 agent replies + 13 memory summaries + 3 empty answers** (failures). USD 0.0065 (the key's usage went from 0.7449 to 0.7513).
  - **Correction (#246 review):** this line first said "52 successful replies, 0 failures (the result records 62 calls)". The 52 came from a `grep 'Generated response'` that also matched the 6 error lines of the 3 empty answers ("Error: Generated response is not a string null" and its follow-up). So there were 46 agent replies, not 52, and 3 failures, not 0.
  - The 13 memory summaries ("Memory updated to:") are requests of their own. The 46 + 13 + 3 add up to the 62 requests ("Awaiting openrouter api response...").
  - From #246 on, `result.llm.replies` counts this way (`countLlmReplies`); this batch ran before it, so its `result.json` has `calls: 62` only.
  - The 5-minute check at 02:24:53 (33 replies, no stand-ins, no 429) was not affected: the rule needs 5 failures and no success.
- **Hetzner:** about 15 min from the create to "verified gone" (`run.log`'s "ran 14 min" counts from the server being up), 1 billed hour, about EUR 0.14 plus 1 Primary IPv4-hour.

## Files

All files came out of `test/tools/redact-evidence.mjs --bot FRCFLD` with no hand edits. Hetzner's numeric server ids are masked as `<server-id>` (#237 review nit). They pass `--check` and `g3-batch-check.mjs --tree test/evidence`, and were read before committing.

- `batch.json`, `run.log` (its sweeper line names the public repository, as before);
- `rocks/result.json`, `rocks/server.log`, `rocks/driver.log`.
