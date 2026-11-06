# G3 smoke round 6, batch C (2026-11-06): `g3-task-preempts-agenda`, PASS 7 of 7; the bot stood on the gold block and checked it before reporting the task done; a SMOKE batch; the server is deleted

**Result in one line:** the task preempted the active agenda; the bot went to the cell above the gold block, checked the block under its feet, and reported done; the server found it on the marker at minute 6.7, and the agenda resumed.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit). A smoke PASS is never a gate pass.

## Run conditions

- **GO:** the round 6 GO; the run command went through Claude Code's auto mode (corrected after round 7: run commands go through Claude Code's auto mode, not a human approval).
- **Code:** a clean detached checkout of `origin/develop` at `f7fbe4fe`, after `npm ci`.
- **Free memory at 18:20:10 UTC:** 6,148 MB physical, 13,529 MB virtual.
- **Checks right before the create (18:20:10-18:20:23 UTC), all passed:** `msa-login`; an empty project; the batch preflight with the LLM probe (HTTP 200, provider Wafer), "timeouts: g3-task-preempts-agenda 34 min" for a 120 min TTL, no midnight warning; the dry run (sweeper OK by the dispatch cadence).
- **Command:** as in batch A, with `--scenario g3-task-preempts-agenda --out <raw>/task`. The LLM-failure stop rule was active and did not fire.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 18:20:38 |
| Server created, ready | 18:21:01, 18:23:55 |
| FRCFLD joined | 18:24:05 |
| `agenda_active` (counter 0 to 5 over 5 min) | 18:29:10 |
| `task_accepted` | 18:29:30 |
| The server finds the bot on the marker (minute 6.7); `task_done` | 18:30:58 |
| `agenda_resumed` (counter 5 to 14) | 18:32:07 |
| Command exited | 18:32:44 |
| Server, Primary IP and SSH key verified gone | 18:33:00 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_bot_state` | PASS: `agenda.json` and `memory.json` moved aside |
| `agenda_active` | PASS: counter 0 to 5 over 5 min (11/11 objectives) |
| `task_accepted` | PASS: "go to the gold block at -42 68 -50 and stand on it" |
| `task_done` | PASS: "the server found the bot on the marker at minute 6.7; the bot said \"task t1 done\"" |
| `agenda_resumed` | PASS: counter 5 to 14 within 5 min after the done line ("agenda resumed") |
| `no_cheat` | PASS |

## The task (`task/driver.log`, `task/server.log`)

- `!goToCoordinates(-42, 68, -50, 1)` now answered: "The task says to stand on the gold_block at -42 68 -50, so standing on top of it and checking. You have reached at -42, 69, -50. You are standing on the gold_block at -42 68 -50 (checked: it is the block under your feet)."
- Only then did the bot call `!taskDone`, and the server's `testfor @a[name=FRCFLD,x=-42,y=69,z=-50,dx=0,dy=1,dz=0]` found it ("Found FRCFLD"). Round 5 C had stopped beside the block.
- **A small finding:** before the task, the bot called `!taskDone` for an agenda step ("Stone pickaxe crafted! ... Step 9 done"); the answer was "no task is running", so nothing happened.
- Chat limit on; no kick; no agent exit; no deaths.

## LLM, providers and memory summaries

- **Requests:** 61: 46 agent replies, **14 memory summaries stored**, 0 failed, no HTTP errors, and **1 still in flight at the end** (46 + 14 = 60; #283 review nit).

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| Wafer | 60 | 0 | 8 | 0 |
| Not attributed (another request was in flight) | - | - | 6 | 0 |

- **The 61st request:** the last line of `task/driver.log` is "Awaiting openrouter api response..." with nothing after it. The runner stopped the bot while that request waited, so it has no reply, no summary line and no provider line. It is in `calls` only, as DRIVER.md ("Records") allows for a request still waiting when the bot left.

## Cost

- **Spend:** USD 0.007542 (key usage 0.804988 to 0.812530, from `batch.json`).
- **Hetzner:** ran 12 min, billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone.

## Files

- `batch.json`, `run.log`, and `task/result.json`, `task/driver.log`, `task/server.log`.
- All are redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs are in `captures/raw/r6-g3c/` (not committed).
