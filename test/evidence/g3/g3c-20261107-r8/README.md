# G3 smoke round 8, batch C (2026-11-07): `g3-task-preempts-agenda`, PASS 7 of 7; on e5029f23; a SMOKE batch; the server is deleted

**Result in one line:** the task whispered at minute 5.2 paused the active agenda. The server found the bot on the gold block at minute 5.6, the bot said "task t1 done", and the agenda resumed (counter 10 to 13).

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, not edited by hand).

## Run conditions

- **GO:** the round 8 GO (as in batch A). The run command went through auto mode.
- **Code:** the same clean detached checkout of `e5029f2307a5`.
- **Free memory at 03:15:56 UTC:** 5,107 MB available of 7,746 MB.
- **Checks right before the create (03:15:56-03:16:05 UTC), all passed:**
  - `msa-login`; the key present; an empty project (0/0/0);
  - the batch preflight with the LLM probe (HTTP 200, provider Wafer), "timeouts: g3-task-preempts-agenda 34 min" for a 120 min TTL;
  - the dry run (sweeper OK by the cadence path: 4 dispatch runs, gaps 14.7, 15.4 and 14.5 min).
- **Command:** as in batch A, with `--ttl-hours 2` and `--scenario g3-task-preempts-agenda --out <raw>/task`.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 03:19:34 |
| Server created, ready | 03:16:20, 03:19:34 |
| FRCFLD joined; "agenda step rocks started" | 03:19:44, 03:19:46 |
| The marker placed at -42 68 -50 | 03:24:51 |
| The whisper (`!taskAdd("go to the gold block at -42 68 -50 and stand on it", "normal")`) | 03:24:55 (minute 5.2) |
| The server found the bot on the marker | minute 5.6 |
| Command exited | 03:26:46 |
| Server, Primary IP and SSH key verified gone | 03:26:59 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_bot_state` | PASS: `agenda.json` and `memory.json` moved aside |
| `agenda_active` | PASS: counter 3 to 9 over 5 min (11/11 objectives) |
| `task_accepted` | PASS: task t1 accepted |
| `task_done` | PASS: the server found the bot on the marker at minute 5.6; the bot said "task t1 done"; the agenda was paused for it |
| `agenda_resumed` | PASS: counter 10 to 13 within 5 min after the done line ("agenda resumed") |
| `no_cheat` | PASS |

- No kick, no agent exit, no deaths. No `[inventory]` lines.
- The bot got sticks from "felling the placed log" (2 sticks), after felling Dynamic Trees gave none.

## LLM, providers and memory summaries

- **Requests:** 51: 39 agent replies and **12 memory summaries stored**. None failed, none was empty, no HTTP errors, and none was in flight at the end.
- **Checked by hand:** 12 "Storing memories..." and 12 "Memory updated to:".

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| Wafer | 51 | 0 | 12 (11 attributed, 1 unattributed) | 0 |

## Cost

- **Spend:** USD 0.007399 (key usage 0.867002 to 0.874400, from `batch.json`). The scenario's own figure is 0.007028; the rest was recorded after its last reading.
- **Hetzner:** ran 10 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone.
  - The project was empty afterwards: 0/0/0 at 03:27:04, counted with `grep -c .`.

## Files

- `batch.json`, `run.log`, and `task/result.json`, `task/driver.log`, `task/server.log`.
- All were redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`, and `--check` is clean.
- The raw logs are in `captures/raw/r8-g3c/` (not committed).
