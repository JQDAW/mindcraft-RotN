# G3 smoke round 9, batch C (2026-11-07): `g3-task-preempts-agenda`, PASS 7 of 7; on 670fe8aa; a SMOKE batch; the server is deleted

**Result in one line:** the agenda ran (counter 4 to 14 in 5 min). Task t1 ("go to the gold block at -42 68 -50 and stand on it") paused it: the bot stood on the marker at minute 5.5 and said "task t1 done". The agenda then resumed (14 to 17 within 5 min, "agenda resumed").

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, not edited by hand).

## Run conditions

- **GO:** as for batch A (`g3a-20261107-r9`). C ran after B, on its own fresh server.
- **Code:** the same clean checkout of `670fe8aa2f29`, on the CX33.
- **Free memory at 13:37 UTC:** 4,905 MB available of 7,746 MB, no swap.
- **Checks right before the create (13:36:57-13:37:08 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0, `grep -c .`);
  - the preflight with the LLM probe (HTTP 200, Wafer), "timeouts: g3-task-preempts-agenda 34 min" for a 120 min TTL;
  - the dry run (sweeper OK by cadence);
  - the pack default with the pin matched.
- **Command:** the batch A command with `--scenario g3-task-preempts-agenda` and `--out <raw>/task`; no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created, ready | 13:37:53, 13:40:55 |
| Batch start; FRCFLD joined | 13:40:56, 13:41:07 |
| `agenda_active` (counter 4 to 14 over 5 min) | 13:46:09 |
| Task t1 accepted | 13:46:18 |
| On the marker, "task t1 done" | 13:46:36 |
| `agenda_resumed` (counter 14 to 17) | 13:47:41 |
| Command exited (PASS, exit 0) | 13:47:59 |
| Server, Primary IP and SSH key verified gone | 13:48:12 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_bot_state` | PASS: the driver moved `agenda.json` and `memory.json` aside |
| `agenda_active` | PASS: counter 4 to 14 over 5 min (11 of 11 objectives) |
| `task_accepted` | PASS: task t1 accepted |
| `task_done` | PASS: the server found the bot on the marker at minute 5.5; the bot said "task t1 done"; the agenda was paused for it |
| `agenda_resumed` | PASS: counter 14 to 17 within 5 min after the done line (the agent said "agenda resumed") |
| `no_cheat` | PASS |

- No kick, no agent exit, no deaths.

## LLM, providers and memory summaries

- **Requests:** 58: 43 agent replies and 14 memory summaries. None failed, none was empty, no HTTP errors.
- **Checked by hand:** 14 "Storing memories..." and 14 "Memory updated to:".
- **Provider lines:** 57 of the 58 requests named a provider (Wafer). One reply has no `[openrouter] provider` line; its cost is still counted.

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| Wafer | 57 | 0 | 13 attributed | 0 |
| not attributed | - | - | 1 (overlapping, #314) | 0 |

## Cost

- **Spend:** USD 0.006822 (key usage 0.885698 to 0.892520, from `batch.json`).
- **Hetzner:** ran 10 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone.
  - The project was empty afterwards: 0/0/0, counted with `grep -c .`.

## Files

- `batch.json`, `run.log`, and `task/result.json`, `task/driver.log`, `task/server.log`.
- All were redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`, and `--check` is clean.
- The raw logs are in `captures/raw/r9-g3c/` (not committed).
