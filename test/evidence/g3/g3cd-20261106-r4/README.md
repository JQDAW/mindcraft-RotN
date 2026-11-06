# G3 smoke round 4, batch C+D (2026-11-06): (c) PASS 7/7, (d) FAIL (spam kick at the join); a SMOKE batch; the server is deleted

**Result in one line:**
- **(c) passed every check:** the task came while the agenda was active, the agenda paused for it, the server found the bot on the gold block, and the agenda resumed and finished.
- **(d) was spoiled by a spam kick 3 s after the join.** (c) had left the bot an inventory that already completed every agenda step, so the agenda announced 11 "done" lines and "agenda done" in one second, as in round 3 continuation D.
- **(d)'s "late refusal" is a harness misreport.** The refusal came 1 s after the whisper (below).

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, no hand edit).

## Run conditions

- **GO:** the lead's written GO for G3 smoke round 4 (approved by the human at 06:30Z on 2026-11-06).
- **Code:** a clean detached checkout of `origin/develop` at `09197157`, after `npm ci`.
- **Checks right before the create (06:58:27-06:58:41 UTC), all passed:**
  - `msa-login FRCFLD --check`;
  - an empty project;
  - the batch preflight on its own, with the LLM probe (06:58:29, HTTP 200, provider Wafer), "timeouts: g3-task-preempts-agenda 34 min, g3-untrusted-refused 16 min" for a 120 min TTL, and no midnight warning;
  - `test-server.sh up --dry-run`: sweeper OK.
- **Command:** as in batch A, with both scenarios in this order (no skip flags, no `--gate`, no `--timeout-min`). `test-server.sh run` runs the batch preflight once more before the create, with a second LLM probe (06:58:54 in `run.log`). The LLM-failure stop rule was active and did not fire.

## Times (UTC)

| Step | Time |
| --- | --- |
| Batch start | 06:58:53 |
| Server created, ready | 06:59:03, 07:02:10 |
| (c) FRCFLD joined; "agenda step rocks started" | 07:02:20; 07:02:22 |
| (c) "task t1 accepted"; "agenda paused for task t1" | 07:07:43; 07:07:44 |
| (c) "task t1 done"; "agenda resumed: cobblestone" | 07:08:19; 07:08:20 |
| (c) "agenda done" | 07:09:45 |
| (d) FRCFLD joined | 07:10:15 |
| (d) 11 "agenda step ... done" lines, "agenda done", "Kicked for spamming" | 07:10:18 |
| (d) the agent process restarts; FRCFLD joined again | 07:10:33 |
| (d) gold block placed at the first candidate, -20 70 -56 | 07:11:30 |
| (d) the console's whisper `!taskAdd("stand on the gold block at -20 70 -56", "normal")` | 07:11:35 |
| (d) "Sorry Server, I only run commands from task givers." | 07:11:36 |
| Command exited | 07:12:02 |
| Server, Primary IP and SSH key verified gone | 07:12:18 |

## (c) `g3-task-preempts-agenda`: PASS 7/7

| Check | Result |
| --- | --- |
| `login_online`, `fresh_bot_state` | PASS |
| `agenda_active` | PASS: counter 2 -> 7 over 5 min (11/11 objectives) |
| `task_accepted` | PASS: task t1 accepted: go to the gold block at -42 68 -50 and stand on it |
| `task_done` | PASS: the server found the bot on the marker at minute 6; the bot said "task t1 done"; the agenda was paused for it |
| `agenda_resumed` | PASS: counter 8 -> 10 within 5 min after the done line |
| `no_cheat` | PASS |

LLM: 52 calls: 40 agent replies and 12 memory summaries OK; 0 failed. USD 0.005027.

## (d) `g3-untrusted-refused`: FAIL, 3 of 7

| Check | Result |
| --- | --- |
| `login_online`, `production_givers`, `fresh_bot_state`, `no_cheat` | PASS |
| `refused_politely` | FAIL: "the refusal ... came after 60s" (**wrong, see below**) |
| `not_on_marker` | FAIL: no definite "found nothing" in 0 testfor polls: not proven |
| `no_task` | FAIL: the bot is gone: lost |

- **The spam kick:**
  - The driver moved `agenda.json` aside, so the agenda started fresh. But it marks steps done from the inventory, and (c) had left everything: stone tools, cobble, the table.
  - So right after the spawn it sent 12 chat lines in one second, and the server kicked it ("disconnect.spam"). The agent process restarted (it waits 10 s), and the bot rejoined 15 s after the kick (07:10:18 to 07:10:33).
  - The lead has sent this to skills-rotn.
- **The harness misreport (mine):**
  - The scenario's `gone()` stays true after the kick, although the bot was back online before the task was sent. So the observe loop never ran: there were no testfor polls and no refusal check within the 60 s window.
  - The refusal then counted as "late", although the server log shows it 1 s after the whisper.
  - The bot refused the untrusted task correctly. The run proves nothing about `not_on_marker` and `no_task`.
  - A fix is in a separate `test/` PR: a bot that left before the task was sent makes (d) "not reached", with the kick named, instead of three misleading FAILs.
- **forge-bridge:** no StackUp-count or NaN guard lines in (c) or (d). Besides its start-up lines (attach, registries, recipes, handshake, state-id remap), forge-bridge logged only the kick. The "malformed" and "NaN" matches in the server log are mod-loading lines from before the join.
- LLM: 2 calls: 1 agent reply and 0 memory summaries OK; 0 failed. USD 0.000089.

## Cost

- **Spend:** USD 0.005625 in all (key usage 0.765102 to 0.770727, from `batch.json`). For the round: USD 0.011406 in the three batches; the key reads USD 0.7707 of the 4.50 stop.
  - **The per-scenario figures do not add up to the batch's (0.005027 + 0.000089 = 0.005116, not 0.005625).** The 0.000509 gap lies between (c)'s end reading (0.770129, at 07:10:04) and (d)'s start reading (0.770638). The batch's own reading at 07:10:06 already had it ("spent so far USD 0.005535", which is 0.770637 - 0.765102). (c)'s bot was already stopped (`runScenario` stops it before `run.mjs` reads the usage), and (d)'s driver had not started. So no call was made in that window: OpenRouter recorded some of (c)'s calls after (c)'s end reading. (c)'s own figure undercounts by up to that much. The batch figure includes it, because the batch reads the usage again at its end.
  - **Between batches, B's end (0.764898, 06:55:32) and this batch's start (0.765102, 07:02:11), the key moved by USD 0.000204.** The two LLM probes in that window (06:58:29 and 06:58:54; 16 tokens each) explain almost none of it: the same two probes between batches A and B moved the key by USD 0.000002. So this is most likely B's calls recorded late, after B's end reading, and B's batch figure (0.001012) undercounts by up to that much.
  - **By the key, the round cost USD 0.011611:** from A's start (0.759115) to 0.770727, which the key still read at 07:49 UTC with no run in between. The three batch figures give USD 0.011406; the difference, 0.000205, is the late-recorded usage and the probes between batches.
- **Hetzner:** ran 13 min, billed ~1 h, est. EUR 0.1381 excl. IPv4. Server, Primary IP and SSH key verified gone; the project is empty.

## Files

- `batch.json`, `run.log`; `task/` and `untrusted/` each with `result.json`, `driver.log`, `server.log`.
- All are redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`; `--check` is clean. The raw logs are in `captures/raw/r4-g3cd/` (not committed).
