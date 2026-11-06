# G3 smoke round 4, batch B (2026-11-06): `g3-first-night`, 4 of 5; "fell from a high place" at the sticks step; a SMOKE batch; the server is deleted

**Result in one line:** 2.4 min after the join, at the agenda's `sticks` step, the bot died: "<bot> fell from a high place". `survived_night` failed; the other four checks passed. This was **not** the falling-tree death of round 3 continuation B.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit).

## Run conditions

- **GO:** the lead's written GO for G3 smoke round 4 (approved by the human at 06:30Z on 2026-11-06).
- **Code:** a clean detached checkout of `origin/develop` at `09197157`, after `npm ci`.
- **Checks right before the create (06:48:09-06:48:21 UTC), all passed:**
  - `msa-login FRCFLD --check`;
  - an empty project (no servers, no Primary IPs; only the human's own unlabelled SSH key);
  - the batch preflight on its own, with the LLM probe (HTTP 200, provider Wafer, `z-ai/glm-5.3-flash`), "timeouts: g3-first-night 67 min" for a 180 min TTL, and no midnight warning;
  - `test-server.sh up --dry-run --ttl-hours 3`: sweeper OK.
- **Command:** as in batch A, with `--ttl-hours 3` and `--scenario g3-first-night` (no skip flags, no `--gate`, no `--timeout-min`). The LLM-failure stop rule was active and did not fire.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 06:48:32 |
| Server created, ready | 06:48:42, 06:51:51 |
| FRCFLD joined | 06:52:01 |
| "agenda step rocks done"; "agenda step sticks started" | 06:52:54 |
| "<bot> fell from a high place" | 06:54:23 |
| "agenda step sticks done" (after the respawn) | 06:55:17 |
| Bot left, command exited | 06:55:31, 06:55:43 |
| Server, Primary IP and SSH key verified gone | 06:55:59 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS (UUID version 4) |
| `fresh_start` | PASS |
| `survived_night` | **FAIL:** no dawn (the bot died: "<bot> fell from a high place"); `stat.deaths` 1 |
| `stayed_online` | PASS: online from the join to the end (2.5 min) |
| `no_cheat` | PASS |

## What the bot did (`night/driver.log`)

1. It collected its 6 rocks, then called `!collectBlocks("stick", 4)`: in RotN, sticks drop from leaves.
2. During that action, the `unstuck` mode interrupted it ("action \"mode:unstuck\" trying to interrupt current action \"action:collectBlocks\"").
3. The bot died while unstuck was still running.
   - The unstuck mode then reported "Path not found, but attempting to navigate anyway using destructive movements." and "Moved away from (-43, 66, -65) to (-46, 65, -70)".
   - The death reflex reported "died at -73, 68, -34". The two positions do not agree, and the logs do not show which one is right.
4. After the respawn it knew it had lost its rocks, broke more leaves and got its 4 sticks.
   - Some leaves dropped nothing ("Broke dynamictrees:leaves0 but got no stick.").
   - The scenario had already ended at the death.

**For skills-rotn (via the lead):** collecting sticks from leaves, with the unstuck reflex, ended in a fatal fall. The leaf drop rate is low.

## LLM and cost

- **LLM:** 12 calls: 10 agent replies and 2 memory summaries OK; 0 failed, no HTTP errors.
- **Spend:** USD 0.001012 (key usage 0.763887 to 0.764898, from `batch.json`).
- **Hetzner:** ran 7 min, billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone; the project was empty again before batch C+D.

## Files

- `batch.json`, `run.log`, and `night/result.json`, `night/driver.log`, `night/server.log`.
- All are redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs are in `captures/raw/r4-g3b/` (not committed).
