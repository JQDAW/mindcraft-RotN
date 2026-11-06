# G3 smoke round 3, batch A (2026-11-05 UTC; the GO of 2026-11-06): `g3-rocks-to-stone-tools`, FAIL 6 of 7; a SMOKE batch; the server is deleted

**Result in one line:**
- In about 7 minutes the agent did 10 of the 11 agenda steps, with no deaths and no hung action: crude axe, Crafting Tools, crafting table, both stone tools.
- Only `cobblestone` failed: `!craftRecipe("cobblestone")` asked for Twilight Forest's giant cobblestone, and the rock's own 4-rocks output was never tried. skills-rotn's #234 (merged later) addresses it.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit).

## Run conditions

- **GO:** the lead's written GO for G3 smoke round 3 (approved by the human, 2026-11-06), batch A.
- **Code:** a clean detached checkout of `origin/develop` at `609490f6` (it includes #225-#232), after `npm ci`. `result.json` has `git.dirty: false`.
- **Checks right before the create (23:07:50-23:07:57 UTC), all passed:**
  - `msa-login FRCFLD --check`: exit 0;
  - `OPENROUTER_API_KEY` is set;
  - `hcloud server list` and `primary-ip list` are empty;
  - the batch preflight on its own, with the TTL (`ROTN_BATCH_TTL_MINUTES=120`): "timeouts: g3-rocks-to-stone-tools 37 min", a SMOKE batch;
  - `deploy/test-server.sh up --dry-run --ttl-hours 2 ...`: sweeper OK (a scheduled run 101 min old, limit 120).
- **Command** (no skip flags, no `--gate`, no `--timeout-min`: the timeout is derived, 37 min):
  ```
  deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- \
    node test/runner/batch.mjs --max-batch-usd 2 --logs-out captures/raw/r3-g3a/server --summary captures/raw/r3-g3a/batch.json \
      --scenario g3-rocks-to-stone-tools --out captures/raw/r3-g3a/rocks \
      -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json
  ```

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 23:08:06 |
| Server created, ready | 23:08:24, 23:11:27 |
| FRCFLD joined | 23:11:37 |
| Crude axe / Crafting Tools, table and stone pickaxe / stone axe | 3.6 / 4.8 / 7 min after the join |
| Scenario end (agenda stuck at `cobblestone`) | 11.5 min after the join; batch command exit 23:24:52 |
| Teardown, "verified gone" | 23:25:07 |
| Project checked empty by hand | 23:25:34 |

## Checks (`rocks/result.json`)

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `stone_tools` | PASS: stone pickaxe 1, stone axe 1 |
| `crafting_table` | PASS: held 1 |
| `cobblestone` | FAIL: none of the 35 4-rocks outputs held |
| `crafted_by_bot` | PASS: all five crafts, by the server's craft stats |
| `no_cheat` | PASS (the pack's gamerule repeat at 23:14:39 went to `notes.packRepeats`) |

Verdict `FAIL` (a smoke batch).

## Observations

1. **The best (a) so far:** rocks, sticks, crude_axe, logs, first_plank, crafting_tools, crafting_table, planks_sticks, stone_pickaxe and stone_axe were done in about 7 min. No death, no hang.
2. **The `cobblestone` step:**
   - The agent collected 10 rocks (8 sedimentary) and sent `!craftRecipe("cobblestone", 2)`.
   - The answer was "To craft cobblestone: 1 twilightforest:giant_cobblestone".
   - `contenttweaker:chalk_cobble`, the sedimentary 4-rocks output, was in its craftable list but never tried. It then searched the wiki, mined stone, and walked to a cobblestone block at y 37 until the step was declared stuck.
   - skills-rotn's #234 crafts the cobble by the rock's own recipe id.
3. **The key's usage was 0.5734 at this batch's start; round 2 ended at 0.5505.** That fits OpenRouter's usage lag (round 2's last calls were posted after its end reading).

## Cost

- **LLM:** USD 0.1715 (56 calls; the key's usage went from 0.5734 to 0.7449).
- **Hetzner:** about 17 min from the create (23:08:24) to "verified gone" (23:25:07); `run.log`'s "ran 16 min" counts from the server being up. 1 billed hour, about EUR 0.14 (excl. IPv4), plus 1 Primary IPv4-hour.

## Files

All files came out of `test/tools/redact-evidence.mjs --bot FRCFLD` with no hand edits. They pass `--check` and `g3-batch-check.mjs --tree test/evidence`, and were read before committing.

- `batch.json`, `run.log`;
- `rocks/result.json`, `rocks/server.log`, `rocks/driver.log`.

`run.log`'s sweeper line names the public repository (`<owner>/mindcraft-RotN`), as in earlier evidence. The full server logs stay in `captures/raw/r3-g3a/server/` on the PC.
