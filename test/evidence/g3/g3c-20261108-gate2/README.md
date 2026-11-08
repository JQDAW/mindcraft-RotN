# G3 GATE RERUN batch C (2026-11-08): `g3-task-preempts-agenda`, PASS 7 of 7; on 8aaf370c; a GATE batch; the server is deleted

**Result in one line:** the task went out at minute 2.2 while the agenda's `logs` step was running. The agenda paused for it in the same second, the bot stood on the marker 19 s later and said "task t1 done", and the agenda resumed in that second and kept going.

**A gate batch:** `batch.json` says `"gate": true, "smoke": false` (written by `batch.mjs --gate`, not edited by hand). The single-batch gate claim check passes: `node test/tools/g3-batch-check.mjs batch.json task/result.json` → "consistent: 1 result(s) vouched for by … a gate batch (gate: true)".

## Run conditions

- **GO, code, pack:** as for rerun batch B (`g3b-20261108-gate2`). C ran after B, on its own fresh server. The scenario is the one #354 changed: a 2-min minimum warm-up, then the task at the first moment the agenda is active and the counter has risen, within 8 min.
- **Free memory at 00:45 UTC:** 4,358 MB available of 7,746 MB.
- **Checks right before the create (00:45:59-00:46:15 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0);
  - the gate preflight (HTTP 200, Wafer), "timeouts: g3-task-preempts-agenda 34 min; a GATE batch", for a 120 min TTL;
  - the dry run (sweeper OK);
  - the user-data: 16,966 bytes (its config holds the date), valid, equal to the checkout;
  - the pack pin.
- **Command:** the rerun B command with `--ttl-hours 2`, `--scenario g3-task-preempts-agenda` and `--out <raw>/task`; no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created; ready (after the Mod Director check) | 00:46:48, 00:51:43 |
| Batch start; FRCFLD joined | 00:51:46, 00:51:56 |
| Agenda: rocks, sticks, crude_axe done; "agenda step logs started" | 00:52:47, 00:53:24, 00:53:49; 00:53:49 |
| The minimum warm-up ends; counter 3 -> 7 | about 00:53:56 (minute 2) |
| The whisper (`!taskAdd("go to the gold block at -42 68 -50 and stand on it", "normal")`), minute 2.2; "task t1 accepted"; "agenda paused for task t1" | 00:54:09 |
| "task t1: stopping collectBlocks to start it"; "task t1 started" | 00:54:16, 00:54:20 |
| The server finds the bot on the marker (minute 2.5); "task t1 done"; "agenda resumed: shelter_blocks" | 00:54:28 |
| Agenda steps after the task: logs, first_plank, crafting_tools, crafting_table, planks_sticks, stone_pickaxe done | 00:55:56 to 00:56:58 |
| Command exited (PASS, exit 0) | 00:57:02 |
| Server, Primary IP and SSH key verified gone | 00:57:18 |

## Mod Director check (ADR 0008, from `run.log`)

- ESM-Tweaks `sha256 b57590bf…f933 OK`; "OK: 1 pinned download(s) match; 337 jars of the pinned zip match; 0 extra mod(s)".

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_bot_state` | PASS: `agenda.json` and `memory.json` moved aside |
| `agenda_active` | PASS: counter 3 -> 7 by minute 2 (11/11 objectives) |
| `task_accepted` | PASS: task t1 accepted |
| `task_done` | PASS: the server found the bot on the marker at minute 2.5; the bot said "task t1 done"; the agenda was paused for it |
| `agenda_resumed` | PASS: counter 7 -> 9 within 5 min after the done line (the agent said "agenda resumed") |
| `no_cheat` | PASS |

- No kick, no agent exit, no deaths.

## When the task was sent, and the agenda's state (the lead's watch items)

- **Sent at minute 2.2** (`notes.task.sentMin`), 1 s after the wait began (`notes.agendaAtTask`: `active: true`, `waitedS: 1`, last line "agenda step logs started: collect 3 logs").
- **The preemption is in the bot's own chat:** "agenda paused for task t1" in the second of the accept, "task t1: stopping collectBlocks to start it", and "agenda resumed: shelter_blocks" in the second of the done line.
- **Counter readings:** 3 at minute 0.6, 7 after the minimum warm-up, 7 at the done line, 7 at minute 3.7, 9 at minute 4.7.
- **For comparison:** gate C on `0daeef2d` (#353) never sent a task, because its agenda finished in 4.8 min, inside the old fixed 5-min warm-up.

## Other watch items

- **Chat:** #344 held "Picking up item!" back once; no identical bot line within 60 s.
- **Stop refusals:** none; the task's stop of `collectBlocks` took one "waiting for code to finish executing..." line.

## LLM and cost

- **Requests:** 53: 40 agent replies and 13 memory summaries. None failed, none was empty; all went to Wafer.
- **Spend:** USD 0.005663 (key usage 0.955601 to 0.961264, from `batch.json`).
- **Hetzner:** ran 10 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone; the project was 0/0/0 afterwards (00:57:35 UTC).

## G3 gate summary: G3 now PASSES

| Scenario | Gate batch | Commit | Result |
| --- | --- | --- | --- |
| A `g3-rocks-to-stone-tools` | `g3a-20261107-gate` (#353) | `0daeef2d` | **PASS 7/7** |
| B `g3-first-night` | `g3b-20261108-gate2` (this PR; the first try `g3b-20261107-gate` FAILED 4/5, kept in #353) | `8aaf370c` | **PASS 5/5** |
| C `g3-task-preempts-agenda` | `g3c-20261108-gate2` (this PR; the first try `g3c-20261107-gate` FAILED 4/7, kept in #353) | `8aaf370c` | **PASS 7/7** |
| D `g3-untrusted-refused` | `g3d-20261107-gate` (#353) | `0daeef2d` | **PASS 7/7** |

- **Under the G3 gate rule (PLAN.md), each scenario now has a passing gate batch.**
  - The rule: one `--gate` batch per scenario, each on its own fresh server; a failed one is fixed, and only that scenario is rerun as a new gate batch with the human's approval.
  - B and C were rerun after their fixes (#355 and #354), with the human's GO.
  - Every gate batch's `batch.json` says `gate: true` and passes the single-batch gate claim check, and `g3-batch-check --tree test/evidence` is consistent.
- **The commits differ:** A and D passed on `0daeef2d`; B and C passed on `8aaf370c`, which adds only #352-#355 to it.
  - #352 and #353 are evidence. #354 changes C's scenario only. #355 changes the bot's shelter rule (`src/agent/library/shelter.js`, `modes.js`, `night_routine.js`).
  - Whether A and D carry over to `8aaf370c` without a rerun is the lead's and the human's call. The rule reruns only the failed scenarios.
- **Test-server passes count for G3 only;** ready-to-try is proven on the CX23 (G4).
- **Rerun spend:** USD 0.014972 from the two `batch.json` files (key 0.946290 to 0.961264).
  - Hetzner: 2 servers, 54 min, an estimated EUR 0.28 excluding IPv4.
  - All servers, IPs and keys were verified gone.
