# G3 smoke round 3 continuation, batch B (2026-11-06): `g3-first-night`, 4 of 5; crushed by a falling tree; a SMOKE batch; the server is deleted

**Result in one line:** 3.7 min after the join, at the agenda's `logs` step, the agent was felling a Dynamic Trees tree with its crude axe, and the tree fell on it: "<bot> was crushed by a falling tree". `survived_night` failed; the other four checks passed.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit).

## Run conditions

- **GO:** the lead's written GO for the round 3 continuation (approved by the human at 01:07Z on 2026-11-06), on the new preset (#241).
- **Probe right before:** 02:31:28Z, HTTP 200, provider OpenInference, model `z-ai/glm-5.3-flash`.
- **Code:** a clean detached checkout of `origin/develop` at `aec33fe7`, after `npm ci`.
- **Checks right before the create (02:33:25-02:33:33 UTC), all passed:**
  - `msa-login FRCFLD --check`;
  - an empty project;
  - the batch preflight on its own ("timeouts: g3-first-night 67 min", TTL 180), and no midnight warning;
  - `test-server.sh up --dry-run --ttl-hours 3`: sweeper OK.
- **Command:** as in round 3 B (TTL 3 h, no skip flags, no `--gate`, no `--timeout-min`), with the output in `captures/raw/r3b-g3b/`.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 02:33:43 |
| Server created, ready | 02:33:55, 02:37:02 |
| FRCFLD joined | 02:37:12 |
| "agenda step logs started"; `!collectBlocks("log", 3)` with the crude axe equipped | 02:40:30; 02:40:40 |
| "<bot> was crushed by a falling tree" | 02:40:55 |
| Scenario end (the death ends `survived_night`) | 02:41:53 |
| Teardown, "verified gone" | 02:42:15 |
| Project checked empty by hand | 02:42:27 |

The 5-minute LLM rule did not come into play: the run ended at 3.7 min, with 12 successful replies and 0 failures.

## Checks (`night/result.json`)

| Check | Result |
| --- | --- |
| `login_online`, `fresh_start` | PASS |
| `survived_night` | FAIL: "no dawn (the bot died: <bot> was crushed by a falling tree); stat.deaths 1; death lines 1" |
| `stayed_online` | PASS: 3.7 min |
| `no_cheat` | PASS |

## Observations (for skills-rotn)

1. **Felling a Dynamic Trees tree killed the bot.** The tree it cut fell onto it at -70, 65, -84. Felling needs a stance out of the fall line, or a step back as the tree comes down.
2. **The death report gave no cause:** "I died at -70, 65, -84; lost 12 stick, 7 pyrotech_compat:rock_igneous, ...". In round 2 the report said "(<bot> was slain by Grove Sprite)". Perhaps Dynamic Trees' death message is not recognised; the LLM then guessed "something got me mid-chop".
3. It kept its crude axe and lost the rest, its bread included.

## Cost

- **LLM:** 12 successful replies, 0 failures. USD 0.0015 (the key's usage went from 0.7513 to 0.7529).
- **Hetzner:** about 8 min from the create to "verified gone", 1 billed hour, about EUR 0.14 plus 1 Primary IPv4-hour.

## Files

All files came out of `test/tools/redact-evidence.mjs --bot FRCFLD` with no hand edits, server ids masked. They pass `--check` and `g3-batch-check.mjs --tree test/evidence`, and were read before committing.

- `batch.json`, `run.log`;
- `night/result.json`, `night/server.log`, `night/driver.log`.
