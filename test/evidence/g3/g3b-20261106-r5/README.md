# G3 smoke round 5, batch B (2026-11-06): `g3-first-night`, a scenario error (the runner's machine was short of memory); a SMOKE batch; the server is deleted

**Result in one line:** 18 minutes in, three console calls in a row failed with 3221225794 (0xC0000142, STATUS_DLL_INIT_FAILED): Git Bash could not start on the Windows machine running the batch, which was short of memory. That is a scenario error, so the round stopped. The bot itself was doing well. Re-run as `g3b-20261106-r5-rerun` (a retry the lead approved).

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit).

## Run conditions

- **GO:** the round 5 GO, as resumed at 12:45Z.
- **Code:** a clean detached checkout of `origin/develop` at `1a7d990f`, after `npm ci`.
- **Checks right before the create (13:04:24-13:04:37 UTC), all passed:** `msa-login`; an empty project; the batch preflight with the LLM probe (HTTP 200, provider OpenInference), "timeouts: g3-first-night 67 min" for a 180 min TTL, no midnight warning; the dry run (sweeper OK).
- **Command:** as in batch A, with `--ttl-hours 3` and `--scenario g3-first-night --out <raw>/night`. The LLM-failure stop rule was active and did not fire.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 13:04:53 |
| Server created, ready | 13:05:13, 13:08:06 |
| `login_online`, `fresh_start` | 13:09:19, 13:10:19 |
| Claude Code reaped the batch's wrapper shell ("the system is running low on memory"); `test-server.sh` and `batch.mjs` kept running | about 13:25 |
| DCOM 10016 errors in the Windows System log | 13:25:11 |
| "scenario error: Error: console failed (3221225794): (after 3 attempts)" | 13:26:21 |
| "could not save the server log: log failed (3221225794)"; "log fetch failed (3221225794)" | 13:26:27 |
| Command exited (EXIT trap tears down) | 13:26:27 |
| Server, Primary IP and SSH key verified gone | 13:26:41 |

`times.txt` (raw, not committed) has a hand-written end line, because the wrapper shell that writes it was gone.

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `survived_night` | not reached (scenario error) |
| `stayed_online` | not reached (scenario error) |
| `no_cheat` | not reached (scenario error) |

There is no `night/server.log` and no batch-level server log: both fetches failed the same way, and the server was deleted by then.

## The cause

- Node gets the full 32-bit code only from the process it started itself, so `bash.exe` failed to initialise: nothing reached the server, and no ssh ran.
- The 2 s and 4 s retries were over in 6 s. No harness process was left behind (B makes about 2 console calls a minute); no Resource-Exhaustion event (2004) was logged.
- **Fixed since (#273):** a call whose bash never started is retried after 5, 10, 20, 40 and 60 s (135 s), and the error names the free memory; the batch's final log fetch gets the same retry. The human freed memory before the rerun.

## What the bot did (`night/driver.log`, about 18 min)

- The driver moved `agenda.json` and `memory.json` aside; the chat limit was on; no agent exit.
- One felling worked ("Felled the tree at -21, 72, -74: 6 drops ...", "Collected 3 stick."). Later the bot made a crafting table, crafted 6 planks and had 5 sticks: it reached the agenda's step 8.
- Before it had a table, its own `!craftRecipe("planks", 2)` got "Crafting planks requires a crafting table", and it tried `!newAction` once (refused).
- No death lines in the driver log (the server log is missing, so not confirmed by the server).

## LLM, providers and memory summaries

- **Requests:** 48: 37 agent replies, 0 summaries stored, **11 failed: 11 empty memory summaries**. The run log says 10; the current counter (#273) reads 11, because the last summary was closed by `history.js`'s own line.
- **Providers:** before #271, so no provider lines.

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| (not logged; the probe named OpenInference) | 48 | not logged (at least the 11 summaries) | 0 | 11 (not attributed) |

## Cost

- **Spend:** USD 0.005139 (key usage 0.774393 to 0.779532, from `batch.json`).
- **Hetzner:** ran 21 min, billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone.

## Files

- `batch.json`, `run.log`, and `night/result.json`, `night/driver.log` (no `night/server.log`, see above).
- All are redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs are in `captures/raw/r5-g3b/` (not committed).
