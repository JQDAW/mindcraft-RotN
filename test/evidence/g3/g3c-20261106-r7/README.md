# G3 smoke round 7, batch C (2026-11-06): `g3-task-preempts-agenda`, PASS 7 of 7; on 42a8e94; a SMOKE batch; the server is deleted

**Result in one line:** the task preempted the active agenda; the bot stood on the gold block (checked under its feet) and the server found it there at minute 5.8; the agenda resumed. A new provider, Near AI, served 11 of the requests.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit). A smoke PASS is never a gate pass.

## Run conditions

- **GO:** the round 7 GO (as in batch A); the lead told me to finish C and D after B's failure, as cheap evidence. The run command went through auto mode.
- **Code:** a clean detached checkout of `42a8e9423fe8`, after `npm ci`.
- **Free memory at 21:10:17 UTC:** 5,143 MB physical, 12,177 MB virtual.
- **Checks right before the create (21:10:17-21:10:35 UTC), all passed:** `msa-login`; an empty project; the batch preflight with the LLM probe (HTTP 200, provider Wafer), "timeouts: g3-task-preempts-agenda 34 min" for a 120 min TTL, no midnight warning; the dry run (sweeper OK by the helper path).
- **Command:** as in batch A, with `--scenario g3-task-preempts-agenda --out <raw>/task`. The LLM-failure stop rule was active and did not fire.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 21:10:47 |
| Server created, ready | 21:11:11, 21:14:04 |
| FRCFLD joined | 21:14:14 |
| `agenda_active` (counter 1 to 5 over 5 min) | 21:19:19 |
| `task_accepted` | 21:19:39 |
| `task_done`: on the marker at minute 5.8 | 21:20:21 |
| `agenda_resumed` (counter 6 to 8) | 21:21:30 |
| Command exited | 21:22:06 |
| Server, Primary IP and SSH key verified gone | 21:22:20 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_bot_state` | PASS: `agenda.json` and `memory.json` moved aside |
| `agenda_active` | PASS: counter 1 to 5 over 5 min (11/11 objectives) |
| `task_accepted` | PASS: "go to the gold block at -42 68 -50 and stand on it" |
| `task_done` | PASS: "the server found the bot on the marker at minute 5.8; the bot said \"task t1 done\"" |
| `agenda_resumed` | PASS: counter 6 to 8 within 5 min after the done line ("agenda resumed") |
| `no_cheat` | PASS |

- The bot reached -42 69 -50, the cell above the block, and checked the block under its feet before `!taskDone`, as in round 6. Chat limit on; no kick; no agent exit; no deaths.

## LLM, providers and memory summaries

- **Requests:** 44: 34 agent replies, **10 memory summaries, all stored**, 0 failed, no HTTP errors.
- **The run log says "2 failed, 2 of them empty summaries": the harness miscount described in batch A** (overlapping summaries). 10 started, 10 "Memory updated to:", no "[memory] summary returned" line. True: 10 stored, 0 empty.

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| Wafer | 33 | 0 | 4 | 0 |
| Near AI | 11 | 0 | 1 | 0 |
| Not attributed | - | - | 5 | 0 (the counter's 2 are not real) |

- **Near AI** is new in the preset's rotation; its 11 answers all had text.

## Cost

- **Spend:** USD 0.00928 (key usage 0.835489 to 0.844769, from `batch.json`).
- **Hetzner:** ran 11 min, billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone.

## Files

- `batch.json`, `run.log`, and `task/result.json`, `task/driver.log`, `task/server.log`.
- All are redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs are in `captures/raw/r7-g3c/` (not committed).
