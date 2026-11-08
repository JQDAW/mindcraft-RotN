# G3 GATE batch C (2026-11-07): `g3-task-preempts-agenda`, FAIL 4 of 7 (the task steps "not reached"); on 0daeef2d; a GATE batch; the server is deleted

**Result in one line:** the bot finished the whole 11-step agenda in 4.8 min, before the scenario's fixed 5-min warm-up ended. The scenario whispers the task only while the agenda is active, so it never sent one, and the three task checks are "not reached".

**A gate batch:** `batch.json` says `"gate": true, "smoke": false`. The single-batch gate claim check is consistent (`g3-batch-check.mjs batch.json task/result.json`, exit 0). **A failed gate batch is a result:** it stays here.

## Run conditions

- **GO, code, pack:** as for gate batch A (`g3a-20261107-gate`). C ran after B, on its own fresh server.
- **Free memory at 21:46 UTC:** 4,430 MB available of 7,746 MB.
- **Checks right before the create (21:46:34-21:46:50 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0);
  - the gate preflight (HTTP 200, Wafer), "timeouts: g3-task-preempts-agenda 34 min; a GATE batch", for a 120 min TTL;
  - the dry run (sweeper OK);
  - the user-data (valid, equal to the checkout);
  - the pack pin.
- **Command:** the gate A command with `--scenario g3-task-preempts-agenda` and `--out <raw>/task`; no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created; ready (after the Mod Director check) | 21:47:19, 21:50:32 |
| Batch start; FRCFLD joined | 21:50:34, 21:50:45 |
| "agenda step stone_axe done"; "agenda done" (all 11 steps) | 21:55:31 |
| The warm-up (`warmMinutes` 5) ends | about 21:55:45 |
| The task marker placed (gold block at -42 68 -50, confirmed) | 21:55:51 |
| The wait for an active agenda (`activeWaitMinutes` 5) runs out: `agendaAtTask` `{active: false, waitedS: 301, last: "agenda done"}` | about 22:00:52 |
| Command exited (check FAIL, exit 1) | 22:01:14 |
| Server, Primary IP and SSH key verified gone | 22:01:25 |

## Mod Director check (ADR 0008, from `run.log`)

- ESM-Tweaks `sha256 b57590bf…f933 OK`; "OK: 1 pinned download(s) match; 337 jars of the pinned zip match; 0 extra mod(s)".

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_bot_state` | PASS: `agenda.json` and `memory.json` moved aside |
| `agenda_active` | PASS: counter 3 -> 9 over 5 min (11/11 objectives) |
| `task_accepted` | **FAIL**: not reached: agenda not active at the task (not active for 5 min; its last agenda line: "agenda done") |
| `task_done` | **FAIL**: not reached (the same) |
| `agenda_resumed` | **FAIL**: not reached (the same) |
| `no_cheat` | PASS |

- No kick, no agent exit, no deaths. No task was whispered (`notes.task` is absent).

## Why (harness-ops: the scenario is ours)

- **The scenario's design** (`test/scenarios/g3/g3-task-preempts-agenda.mjs`, steps 2-3):
  - a fixed 5-min warm-up;
  - then the task is whispered only while the agenda is active, which the lead set after smoke round 2;
  - it waits up to 5 more min for that; otherwise the task steps are "not reached" ("not a pass, and not a task failure").
- **What changed:** the agenda used to outlast the warm-up. In smoke round 10 C, it was still running when the task came at minute 5.2. Here it ended 14 s before the warm-up did.
- **What it is:** not a bot fault, since the bot was never given a task. It is a gap in the scenario's timing, which a faster agenda exposed.
- **Fixing it** (whisper as soon as the agenda is active after a shorter minimum, or keep the agenda from finishing first) is a scenario change for the lead to decide. A rerun of C needs the human (PLAN.md's gate rule).

## Other watch items

- **Sticks:** one `!collectBlocks("stick", 3)`. A `deadbush` and a `dynamictrees:leaves0` each logged "got no stick", and later pickups made up "Collected 3 stick".
- **Chat:** no identical bot line within 60 s; none held back. **Stop refusals:** none.

## LLM and cost

- **Requests:** 41: 32 agent replies and 9 memory summaries. None failed, none was empty; all went to Wafer.
- **Spend:** USD 0.004945 (key usage 0.939265 to 0.944210, from `batch.json`).
- **Hetzner:** ran 14 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone; the project was 0/0/0 afterwards.
