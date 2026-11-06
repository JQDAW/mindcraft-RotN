# G3 smoke round 5, batch C (2026-11-06): `g3-task-preempts-agenda`, 5 of 7; the bot reported the task done without standing on the marker; a SMOKE batch; the server is deleted

**Result in one line:** the task preempted the active agenda and was accepted, but the bot stopped within 1 block of the gold block, not on it, and said "Standing on the gold block ... ✅". The server never found it on the marker, so `task_done` failed and `agenda_resumed` was not reached.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit). From round 5, (c) and (d) each run in their own batch on a fresh server.

## Run conditions

- **GO:** the round 5 GO. Claude Code's auto mode first blocked the run command (15:06); the human approved it at the lead's request, and the preflight was re-run because the first one was older than 15 min.
- **Code:** a clean detached checkout of `origin/develop` at `a6825e81`, after `npm ci`.
- **Free memory at 15:20:38 UTC:** 4,717 MB physical, 11,670 MB virtual.
- **Checks right before the create (15:20:38-15:20:51 UTC), all passed:** `msa-login`; an empty project; the batch preflight with the LLM probe (HTTP 200, provider Wafer), "timeouts: g3-task-preempts-agenda 34 min" for a 120 min TTL, no midnight warning; the dry run (sweeper OK).
- **Command:** as in batch A, with `--scenario g3-task-preempts-agenda --out <raw>/task`. The LLM-failure stop rule was active and did not fire.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 15:21:03 |
| Server created, ready | 15:21:25, 15:24:18 |
| FRCFLD joined | 15:24:29 |
| `agenda_active` (counter 0 to 15 over 5 min) | 15:29:33 |
| Gold block placed at -42 68 -50 (both cells above it air) | 15:29:39 |
| Task whispered; "task t1 accepted"; "agenda paused for task t1" | 15:29:50 |
| "task t1: stopping collectBlocks to start it"; "task t1 started" | 15:29:56, 15:30:01 |
| `!goToCoordinates(-42, 68, -50, 1)` | 15:30:02 |
| "Standing on the gold block at -42 68 -50! ✅", `!taskDone`, "task t1 done", "agenda resumed: cobblestone" | 15:30:16 |
| Next action (`!collectBlocks("pyrotech:rock", 8)`) | 15:30:22 |
| `task_done` FAIL | 15:35:04 |
| Command exited | 15:35:41 |
| Server, Primary IP and SSH key verified gone | 15:35:54 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_bot_state` | PASS: `agenda.json` and `memory.json` moved aside |
| `agenda_active` | PASS: counter 0 to 15 over 5 min (11/11 objectives) |
| `task_accepted` | PASS: t1 accepted 5.3 min in, the agenda active at `cobblestone` |
| `task_done` | **FAIL:** "the server never found the bot on the marker; the bot said \"task t1 done\"; the agenda was paused for it" |
| `agenda_resumed` | not reached (`task_done` failed) |
| `no_cheat` | PASS |

## The task, step by step (`task/driver.log`, `task/server.log`)

- `!goToCoordinates(-42, 68, -50, 1)` returned "Path not found, but attempting to navigate anyway using destructive movements." and "You have reached at -42, 68, -50."
  - Range 1 means within 1 block of the gold block's own cell, so the bot can end beside it or level with it, not on top.
- The server's check, `testfor @a[name=FRCFLD,x=-42,y=69,z=-50,dx=0,dy=1,dz=0]` every 11 s, said "found nothing" at 15:30:07 and at 15:30:18, after the bot had said it stood there (15:30:16) and before it moved on (15:30:22). So the bot was not on the block; the harness did not miss a short stand.
- In round 4 the same command happened to end on top of the block.

**For skills-rotn (via the lead):** reaching the cell above the marker with range 0, or checking the block under the bot's feet, before `!taskDone`.

## The rest of the watch list

- Chat limit on ("wrapped on playerJoin"); no kick; no dropped or collapsed lines; no agent exit; no falls or deaths.

## LLM, providers and memory summaries

- **Requests:** 54: 40 agent replies, **12 memory summaries stored**, 2 failed: 1 empty memory summary ("[memory] summary returned failure reply \"No response received.\"") and 1 agent reply that came back empty ("Generated response: No response received."). No HTTP errors.

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| Wafer | 54 | 2 | 8 | 1 |
| Not attributed (another request was in flight) | - | - | 4 | 0 |

- The probe named Wafer as well.

## Cost

- **Spend:** USD 0.006549 (key usage 0.784931 to 0.791479, from `batch.json`).
- **Hetzner:** ran 14 min, billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone.

## Files

- `batch.json`, `run.log`, and `task/result.json`, `task/driver.log`, `task/server.log`.
- All are redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs are in `captures/raw/r5-g3c/` (not committed).
