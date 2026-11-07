# G3 smoke round 9, batch B (2026-11-07): `g3-first-night`, FAIL 3 of 5; on 670fe8aa; a SMOKE batch; the server is deleted

**Result in one line:** the bot was in a dirt shelter 4 s after "sunset is near" and held it for about 17.5 minutes. Then the shelter was found open on one side, the bot could not repair it (no pickaxe), and a zombie killed it 3 s later. After respawning at night with nothing, it died again 33 s later. No dawn.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, not edited by hand).

## Run conditions

- **GO:** as for batch A (`g3a-20261107-r9`). B ran after A, on its own fresh server.
- **Code:** the same clean checkout of `670fe8aa2f29`, on the CX33.
- **Free memory at 12:59 UTC:** 4,868 MB available of 7,746 MB, no swap.
- **Checks right before the create (12:59:26-12:59:38 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0, `grep -c .`);
  - the preflight with the LLM probe (HTTP 200, Wafer), "timeouts: g3-first-night 67 min" for a 180 min TTL;
  - the dry run (sweeper OK by cadence);
  - the pack default with the pin matched.
- **Command:** the batch A command with `--ttl-hours 3`, `--scenario g3-first-night` and `--out <raw>/night`; no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created, ready | 13:00:20, 13:03:07 |
| Batch start; FRCFLD joined | 13:03:08, 13:03:18 |
| "rocks done"; "sticks started" | 13:03:50 |
| "agenda step sticks stuck: 5 min of self-prompting; agenda paused" | 13:10:35 |
| "[night] sunset is near: building a shelter"; "in the shelter at -77, 58, -61 until morning" | 13:17:46, 13:17:50 |
| "the shelter is open at -77, 58, -60; -77, 59, -60: repairing" | 13:35:22 |
| "FRCFLD was slain by Zombie" (first death) | 13:35:25 |
| The death report: "I died at -78, 58, -60; lost 356 betterwithmods:dirt_pile, 5 ... rock_sedimentary, 3 ... rock_igneous:7, 3 ... rock_metamorphic:6 ..." | 13:35:31 |
| "FRCFLD was slain by Zombie" (second death) | 13:36:04 |
| Command exited (check FAIL, exit 1) | 13:36:14 |
| Server, Primary IP and SSH key verified gone | 13:36:24 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `survived_night` | FAIL: no dawn (the bot died: FRCFLD was slain by Zombie); `stat.deaths` 2 |
| `stayed_online` | FAIL: "lost (... Connection reset by peer); left" at 13:36:12: the agent killed its own process (see below) |
| `no_cheat` | PASS |

- **`stayed_online` is a real fail: the agent killed its own process 8 s after the second death.** (Corrected in this PR: a first version of this README called it a harness false fail, the runner's own stop. It is not.)
  - After the respawn the bot ran `!collectBlocks("dirt", 10)`. The second death (13:36:04) asked that action to stop, and it did not stop: `driver.log` shows "waiting for code to finish executing..." until the process exits.
  - `action_manager.js`'s 10-second stop timeout then called `cleanKill`. The bot's saved history (`memory.json`, moved aside by batch C's start) ends with: "Code execution refused stop after 10 seconds. Killing process."
  - The bot said "Exiting." (13:36:12), "Agent process exited with code 1", and `agent_process` started a restart ("requested_restart; restarting in 0 s").
  - The runner's SIGTERM came after that (`DRIVER ... "stopping"` at 13:36:12.481Z). `botStoppedByRunner: true` is set at the end of every scenario, so it does not mean the runner caused the leave.
  - On the live server this would show as a leave and a rejoin after a death.
- **The day:**
  - `sticks` stalled again: leaves gave nothing, the bot said "I'm stuck!" (13:06:07), and the step paused after 5 minutes.
  - Meanwhile the bot dug dirt piles for `shelter_blocks` (356 held at the death).
  - It never had a pickaxe.
- **The night:**
  - The shelter held from 13:17:50 to 13:35:22.
  - The two blocks at -77 58 -60 and -77 59 -60 (the side at head and feet height) were then found open. `self_defense` interrupted the repair, and "the repair did not close the shelter".
  - After the respawn, the night routine's shelter try was refused: "Not building a shelter at -70, 63, -57: without a pickaxe you could not dig out of it again".
  - The bot then tried `!collectBlocks("mossy_cobblestone", 10)` (no tools), then `!buildShelter()`, before the second death.
- **`[inventory]` rejected-click lines (the lead asked):** none. There are 0 `[inventory]` lines in `night/driver.log`.
- No kick, no agent exit.
- **Different from round 8's B**, which reached dawn (39.6 min online, no death).

## LLM, providers and memory summaries

- **Requests:** 27: 21 agent replies and 6 memory summaries. None failed, none was empty, no HTTP errors.
- **Checked by hand:** 6 "Storing memories..." and 6 "Memory updated to:".

| Provider | Requests | Empty answers | Summaries stored | Summaries empty |
| --- | --- | --- | --- | --- |
| Wafer | 27 | 0 | 6 (6 attributed) | 0 |

## Cost

- **Spend:** USD 0.003456 by key usage (0.882239 to 0.885695); the LLM log sums to USD 0.002648.
- **Hetzner:** ran 36 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone.
  - The project was empty afterwards: 0/0/0, counted with `grep -c .`.

## Files

- `batch.json`, `run.log`, and `night/result.json`, `night/driver.log`, `night/server.log`.
- All were redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`, and `--check` is clean.
- The raw logs are in `captures/raw/r9-g3b/` (not committed).
