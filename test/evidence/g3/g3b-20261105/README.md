# G3 smoke batch B (2026-11-05): `g3-first-night`, FAIL (gate-valid) on `no_cheat` only; the server is deleted

**Result in one line:** the real agent survived its first RotN night: dusk, night and dawn were seen, `stat.deaths` stayed 0, there were no death lines, and it was online for all 40.1 min. The only failing check is `no_cheat`, on the same false positive as batch A: the pack's own two `gamerule` lines, repeated.

This is a smoke batch, not the gate. `batch.json` says `"smoke": true` (the lead, #218 review), so `g3-batch-check.mjs <batch.json> <result.json>...` (the gate claim check) refuses it, whatever a `result.json` here says about `gateValid` or `pass`. That field was added by hand after the run, the only hand edit here, because these batches ran before `batch.mjs --smoke` existed.

## Run conditions

- **GO:** the lead's written GO for the first G3 smoke batches (approved by the human, 2026-11-05), and the lead's "go ahead with batch B" after batch A's report.
- **Code:** a clean detached checkout of `origin/develop` at `202b8263`, after `npm ci`. `result.json` has `git.dirty: false`.
- **Checks right before the create, all passed** (17:52:23-17:52:36):
  - `msa-login FRCFLD --check`: exit 0;
  - `OPENROUTER_API_KEY` is set;
  - `hcloud server list` and `primary-ip list` are empty;
  - the batch preflight on its own, which passed;
  - `deploy/test-server.sh up --dry-run --ttl-hours 3 --seed 1880465901402976865`: sweeper OK by the cadence path, and nothing was created.
- **Command** (no skip flags; TTL 3 h, as the GO set for B):
  ```
  deploy/test-server.sh run --yes --ttl-hours 3 --seed 1880465901402976865 -- \
    node test/runner/batch.mjs --max-batch-usd 2 --logs-out captures/raw/g3b/server --summary captures/raw/g3b/batch.json \
      --timeout-min 62 --scenario g3-first-night --out captures/raw/g3b/night \
      -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json
  ```
- **Server:** CPX42, nbg1, the pinned RotN 3.3.4 server pack, world seed `1880465901402976865`.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 17:52:43 |
| Server created | 17:52:53 |
| Ready | 17:56:12 |
| FRCFLD joined | 17:56:21 (server.log) |
| Dusk / night / dawn | 19.4 / 20.5 / 39.9 min after the join (daytime 12376 / 13743 / 989) |
| Scenario end (dawn) | 40.1 min after the join; batch command exit 18:37:40 |
| Teardown, "verified gone" | 18:37:53 |
| Project checked empty by hand | 18:38:15 |

## Checks (`night/result.json`)

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `survived_night` | PASS: dawn reached; `stat.deaths` 0; death lines 0 |
| `stayed_online` | PASS: online from the join to the end (40.1 min) |
| `no_cheat` | FAIL: the pack's two `gamerule ... false` lines again, at 17:59:00 (2.6 min after the join) |

Verdict `FAIL`, `gateValid: true`. Under the lead's decision (1) of 2026-11-05 (allow those two lines at any time), every check of this run would have passed. The verdict above is the one the run recorded.

## Observations

1. **The night routine** (skills-rotn D2b-2) ran as designed without a pickaxe:
   - "[night] sunset is near: building a shelter";
   - three refusals: "Not building a shelter ... without a pickaxe you could not dig out of it again";
   - it stayed put, ate bread at food 12 (the eating reflex), and said "[night] morning: back to work".
   - Food went 19 to 13 over the night, and ended at 15 (`notes.foodAtEnd`, evidence only).
2. **The `!useOn` hang happened again, this time at `first_plank`.**
   - The first `!useOn("pyrotech:crude_axe", "log")` returned cleanly with "Path not found ... metamorphic_stone is in the way".
   - The bot then walked to the log and called it again. That call never returned, about 15 min, until the night routine stopped it at sunset.
   - The agenda had paused itself as stuck at `first_plank`. The lead routed this to skills-rotn.
3. **The clock stopped twice:** at daytime 3001 for about 9 min, and at 16001 for about 10 min (`notes.samples`).
   - Time Shall Not Pass logged that it switches the daylight cycle on when a player connects.
   - These holds made the night take 40 min. The 55-min `maxMinutes` still had room.
4. No kicks, no login retry.

## Cost

- **LLM:** USD 0.0526 (17 calls; the key's usage went from 0.0765 to 0.1291).
- **Hetzner:** up about 45 min, 1 billed hour, about EUR 0.14 (excl. IPv4), plus 1 Primary IPv4-hour.

## Files

All files came out of `test/tools/redact-evidence.mjs --bot FRCFLD` with no hand edits. They pass `--check` and `g3-batch-check.mjs --tree test/evidence`, and were read before committing.

- `batch.json`, `run.log`;
- `night/result.json`, `night/server.log`, `night/driver.log`.

The full fetched server logs stay in `captures/raw/g3b/server/` on the PC.
