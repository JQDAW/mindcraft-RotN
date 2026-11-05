# G3 smoke round 2, batch B (2026-11-05): `g3-first-night`, PASS (all 5 checks); a SMOKE batch; the server is deleted

**Result in one line:**
- The agent survived its first RotN night: dusk, night and dawn were seen, `stat.deaths` stayed 0, and it was online for 40.1 min.
- `no_cheat` passed. The pack's gamerule repeat is now recorded in `notes.packRepeats`.
- Before dusk the agenda got through 10 of 11 steps, both stone tools included.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit). The gate claim check refuses it.

## Run conditions

- **GO:** the lead's written GO for G3 smoke round 2 (approved by the human, 2026-11-05), batch B.
- **Code:** a clean detached checkout of `origin/develop` at `139239f2`, after `npm ci`. `result.json` has `git.dirty: false`.
- **Checks right before the create (20:31:55-20:32:05), all passed:**
  - `msa-login FRCFLD --check`: exit 0;
  - `OPENROUTER_API_KEY` is set;
  - `hcloud server list` and `primary-ip list` are empty;
  - the batch preflight on its own, which passed;
  - `deploy/test-server.sh up --dry-run --ttl-hours 3 ...`: sweeper OK.
- **Command** (no skip flags, no `--gate`; TTL 3 h, as the GO set for B):
  ```
  deploy/test-server.sh run --yes --ttl-hours 3 --seed 1880465901402976865 -- \
    node test/runner/batch.mjs --max-batch-usd 2 --logs-out captures/raw/r2-g3b/server --summary captures/raw/r2-g3b/batch.json \
      --timeout-min 62 --scenario g3-first-night --out captures/raw/r2-g3b/night \
      -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json
  ```
- **Server:** CPX42, nbg1, the pinned RotN 3.3.4 server pack, world seed `1880465901402976865`.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 20:32:12 |
| Server created | 20:32:26 |
| Ready | 20:35:29 |
| FRCFLD joined | 20:35:39 |
| Stone pickaxe crafted | 20:41:38 |
| "[night] sunset is near" / "morning: back to work" | 20:50:07 / 21:15:40 |
| Dusk / night / dawn | 19.4 / 20.5 / 39.9 min after the join |
| Batch command exit | 21:16:57 |
| Teardown, "verified gone" | 21:17:10 |
| Project checked empty by hand | 21:17:17 |

## Checks (`night/result.json`)

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `survived_night` | PASS: dawn reached; `stat.deaths` 0; death lines 0 |
| `stayed_online` | PASS: 40.1 min |
| `no_cheat` | PASS: the pack's two gamerule lines repeated at 20:38:34 and went to `notes.packRepeats` (#219) |

Verdict `PASS` (a smoke pass, never gate evidence).

## Observations

1. **The agenda:**
   - Done: rocks, sticks, logs, crude_axe, first_plank, crafting_tools, crafting_table, planks_sticks, stone_pickaxe, stone_axe.
   - It stuck at `cobblestone` ("Not enough rock_metamorphic to craft 4, crafted 1"; it made 2 metamorphic cobble).
   - No `!useOn` or `!searchForBlock` hang, and no "got no log" line (#221, #222 and #224 at work).
2. **For skills-rotn: the shelter's pickaxe check.**
   - At sunset the night routine refused three times: "Not building a shelter at ...: without a pickaxe you could not dig out of it again".
   - Yet the bot held the stone pickaxe it crafted at 20:41:38 (`stone_pickaxe: 1` in its inventory listing before dusk, `driver.log`).
   - It stayed in the open, kept its food (15 to 14), and survived.
3. The clock stopped twice, as in round 1: at daytime 3001 for about 9 min and at 16001 for about 10 min (Time Shall Not Pass).

## Cost

- **LLM:** USD 0.2018 (63 calls; the key's usage went from 0.2995 to 0.5013).
- **Hetzner:** about 44 min, 1 billed hour, about EUR 0.14 (excl. IPv4), plus 1 Primary IPv4-hour.

## Files

All files came out of `test/tools/redact-evidence.mjs --bot FRCFLD` with no hand edits. They pass `--check` and `g3-batch-check.mjs --tree test/evidence`, and were read before committing.

- `batch.json`, `run.log`;
- `night/result.json`, `night/server.log`, `night/driver.log`.

The full server logs stay in `captures/raw/r2-g3b/server/`.
