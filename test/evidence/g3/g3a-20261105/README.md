# G3 smoke batch A (2026-11-05): `g3-rocks-to-stone-tools`, FAIL (gate-valid); the server is deleted

**Result in one line:** the real agent (FRCFLD, `openrouter/@preset/glm-5-1-mindcraft`) crafted the crude axe and Crafting Tools. It then got stuck at the agenda's `crafting_table` step: `!useOn("pyrotech:crude_axe", "log")` never returned, and after 5 min of self-prompting the agenda paused itself. No table, no stone tools and no cobblestone. `no_cheat` also failed, on a false positive: the pack repeated its own two `gamerule` lines (see below).

This is a smoke batch, not the gate. `batch.json` says `"smoke": true` (the lead, #218 review), so `g3-batch-check.mjs <batch.json> <result.json>...` (the gate claim check) refuses it, whatever a `result.json` here says about `gateValid` or `pass`. That field was added by hand after the run, the only hand edit here, because these batches ran before the field existed. Smoke is now the default, and only `batch.mjs --gate` writes `gate: true` (the lead, #220 decision).

## Run conditions

- **GO:** the lead's written GO for the first G3 smoke batches (approved by the human, 2026-11-05), batch A of three.
- **Code:** a clean detached checkout of `origin/develop` at `d5ae8e75` in the harness-ops worktree, after `npm ci` (all patches applied). `result.json` has `git.dirty: false`.
- **Checks right before the create, all passed:**
  - `msa-login FRCFLD --check`: exit 0;
  - `OPENROUTER_API_KEY` is set (checked for presence only);
  - `hcloud server list` and `primary-ip list` are empty;
  - the batch preflight on its own (`batch.mjs --preflight`, same arguments, 17:20:57): driver, profile, model and settings checked, and the key's usage can be read;
  - the test-server preflight on its own (`deploy/test-server.sh up --dry-run --ttl-hours 2 --seed 1880465901402976865`, 17:21:06): sweeper OK by the cadence path, and nothing was created.
- **Command** (no skip flags):
  ```
  deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- \
    node test/runner/batch.mjs --max-batch-usd 2 --logs-out captures/raw/g3a/server --summary captures/raw/g3a/batch.json \
      --timeout-min 32 --scenario g3-rocks-to-stone-tools --out captures/raw/g3a/rocks \
      -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json
  ```
- **Server:** CPX42, nbg1, the pinned RotN 3.3.4 server pack, world seed `1880465901402976865` (the G2 seed).

## Times (UTC, from `date -u` and the logs)

| Step | Time |
| --- | --- |
| Batch start | 17:21:18 |
| Server created | 17:21:44 |
| Ready | 17:24:29 |
| FRCFLD joined | 17:24:39 |
| Crude axe, Crafting Tools | 2.5 and 3.6 min after the join |
| Scenario end (agenda stuck) | 8.1 min after the join; batch command exit 17:34:25 |
| Teardown, "verified gone: server, Primary IPv4 and SSH key" | 17:34:38 |
| Project checked empty by hand | 17:35:19 |

## Checks (`rocks/result.json`)

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS: none of the 24 target items held; the pack's first-join Bread and Bundle seen |
| `stone_tools` | FAIL: stone pickaxe 0, stone axe 0; the agenda is stuck at `crafting_table` |
| `crafting_table` | FAIL: held 0, placed (the use stat) 0 |
| `cobblestone` | FAIL: none of the 35 4-rocks outputs held |
| `crafted_by_bot` | FAIL: `pyrotech:crude_axe` 1, `contenttweaker:crafting_tools` 1, table 0, stone tools 0 |
| `no_cheat` | FAIL: two `[<bot>: Game rule ... has been updated to false]` lines (false positive, see below) |

Verdict `FAIL`, `gateValid: true`.

## Observations

1. **The agenda got stuck at `crafting_table`.**
   - Steps rocks, sticks, logs, crude_axe, first_plank and crafting_tools completed (`notes.agendaChat`).
   - For the table's plank, the bot sent `!useOn("pyrotech:crude_axe", "log")`. `driver.log` ends at "executing code..." with no action output.
   - After 5 min, skills-rotn's stuck rule paused the agenda, and the scenario ended.
   - Earlier `!useOn` calls on a log it had placed did work. The lead routed this hang to skills-rotn. Batch B shows the same hang.
2. **`no_cheat` false positive.**
   - The pack ran `gamerule commandBlockOutput false` and `gamerule sendCommandFeedback false` as the bot twice: at the join (allowed), and again at 17:26:57. That was 2 min 18 s later, right after the bot picked up an item and finished the logs step.
   - `cheatProblems` allowed these lines only once, within 10 s of the join.
   - The lead decided (2026-11-05) to allow exactly these two lines, value `false` only, at any time. That fix is in a separate `test/` PR. It would not change this batch's verdict.
3. **Clean otherwise:** no kicks, no login retry, no deaths.

## Cost

- **LLM:** USD 0.0765 (25 calls; the key's usage went from 0 to 0.0765, `batch.json`).
- **Hetzner:** up about 13 min, 1 billed hour, about EUR 0.14 (excl. IPv4), plus 1 Primary IPv4-hour.

## Files

All files came out of `test/tools/redact-evidence.mjs --bot FRCFLD` with no hand edits. They pass `--check` and `node test/tools/g3-batch-check.mjs --tree test/evidence`, and were read before committing.

- `batch.json`: the batch summary (`BATCH`);
- `run.log`: the output of `test-server.sh run` and `batch.mjs`;
- `rocks/result.json`, `rocks/server.log`, `rocks/driver.log`: the scenario's record, the server log of the run, and the agent's output.

The full fetched server logs (`latest.log` about 4 MB, `debug.log` about 11 MB) are not committed. They stay in `captures/raw/g3a/server/` on the PC.
