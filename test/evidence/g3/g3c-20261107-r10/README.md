# G3 smoke round 10, batch C (2026-11-07): `g3-task-preempts-agenda`, PASS 7 of 7; on 0daeef2d; a SMOKE batch; the server is deleted

**Result in one line:** the agenda ran; a whispered task paused it, the bot stood on the gold block 59 s later and said "task t1 done", and the agenda resumed in the same second and finished 24 s after that.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, not edited by hand).

## Run conditions

- **GO:** as for batch A (`g3a-20261107-r10`). C ran after B, on its own fresh server.
- **Code:** the same clean checkout of `0daeef2da14f`, on the CX33.
- **Pack as tested:** the zip SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`, plus the Mod Director download `mods/esmtweaks-1.12.2-0.4.5.jar`, SHA-256 `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` (ADR 0005 + ADR 0008).
- **Free memory at 20:19 UTC:** 4,435 MB available of 7,746 MB.
- **Checks right before the create (20:19:26-20:19:57 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0, `grep -c .`);
  - the preflight with the LLM probe (HTTP 200, Wafer), "timeouts: g3-task-preempts-agenda 34 min" for a 120 min TTL;
  - the dry run (sweeper OK);
  - the user-data: 16,962 bytes, gz+b64, valid schema, every `write_files` entry equals the checkout's file;
  - the pack default matched the pin.
- **Command:** the batch A command with `--scenario g3-task-preempts-agenda` and `--out <raw>/task`; no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created; ready (after the Mod Director check) | 20:20:22, 20:23:18 |
| Batch start; FRCFLD joined | 20:23:19, 20:23:30 |
| The whisper (`!taskAdd("go to the gold block at -42 68 -50 and stand on it", "normal")`); "task t1 accepted"; "agenda paused for task t1" | 20:28:41 |
| "task t1: stopping collectBlocks to start it"; "task t1 started" | 20:28:47, 20:28:50 |
| "task t1 done"; "agenda resumed: shelter_blocks" | 20:29:40 |
| Agenda done | 20:30:04 |
| Command exited (PASS, exit 0) | 20:31:08 |
| Server, Primary IP and SSH key verified gone | 20:31:19 |

## Mod Director check (ADR 0008, from `run.log`)

- `mod-director: pinned mods/esmtweaks-1.12.2-0.4.5.jar sha256 b57590bf…f933 OK`.
- `mod-director: OK: 1 pinned download(s) match; 337 jars of the pinned zip match; 0 extra mod(s)`.

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_bot_state` | PASS: `agenda.json` and `memory.json` moved aside |
| `agenda_active` | PASS: counter 3 -> 14 over 5 min (11/11 objectives) |
| `task_accepted` | PASS: task t1 accepted |
| `task_done` | PASS: the server found the bot on the marker at minute 6.2; the bot said "task t1 done"; the agenda was paused for it |
| `agenda_resumed` | PASS: counter 14 -> 15 within 5 min after the done line ("agenda resumed") |
| `no_cheat` | PASS |

- No kick, no agent exit, no deaths.

## Watch items

- **Sticks:** all 3 came from one `!collectBlocks("stick", 3)` (20:24).
  - Three `dynamictrees:leaves0` and one `deadbush` each logged "Broke … but got no stick".
  - Two later "Picked up 1 items" lines made up the count ("Collected 3 stick"). So the sticks came from leaf or dead-bush drops picked up after the break had been reported as giving none.
  - For skills-rotn (minor): the "got no stick" lines undercount.
  - The tree was felled later, for logs ("Cut the tree at -48, 65, -59").
- **Chat (#344 at work):** the reflex line "Picking up item!" was said at 20:24, 20:25 and 20:30:06 (each more than 60 s after the one before), and held back twice in between: "[reflex] not repeated in chat (said within 60 s): Picking up item!". No identical bot line within 60 s in the server log.
- **Stop refusals:** none in `driver.log` or the bot's saved history. The task's stop of `collectBlocks` took one "waiting for code to finish executing..." line. No agent exit.

## LLM, providers and memory summaries

- **Requests:** 50: 38 agent replies and 12 memory summaries. None failed, none was empty, no HTTP errors; all went to Wafer.

## Cost

- **Spend:** USD 0.005872 (key usage 0.917166 to 0.923038, from `batch.json`).
- **Hetzner:** ran 10 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone; the project was 0/0/0 afterwards.
