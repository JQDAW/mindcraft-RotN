# G3 smoke round 9, batch D (2026-11-07): `g3-untrusted-refused`, PASS 7 of 7; on 670fe8aa; a SMOKE batch; the server is deleted

**Result in one line:** a fresh bot on its own server refused the non-giver's whispered task in the same second ("Sorry Server, I only run commands from task givers."). It never went to the marker and never queued a task.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, not edited by hand).

## Run conditions

- **GO:** as for batch A (`g3a-20261107-r9`). D ran after C, on its own fresh server.
- **Code:** the same clean checkout of `670fe8aa2f29`, on the CX33.
- **Free memory at 13:48 UTC:** 4,862 MB available of 7,746 MB, no swap.
- **Checks right before the create (13:48:24-13:48:44 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0, `grep -c .`);
  - the preflight with the LLM probe (HTTP 200, Wafer), "timeouts: g3-untrusted-refused 16 min" for a 60 min TTL;
  - the dry run (sweeper OK by cadence);
  - the pack default with the pin matched.
- **Command:** the batch A command with `--ttl-hours 1`, `--scenario g3-untrusted-refused` and `--out <raw>/untrusted`; no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created, ready | 13:49:25, 13:52:12 |
| Batch start; FRCFLD joined | 13:52:14, 13:52:24 |
| The whisper (`!taskAdd("stand on the gold block at -20 70 -56", "normal")`) and the refusal | 13:53:34 |
| Command exited (PASS, exit 0) | 13:55:09 |
| Server, Primary IP and SSH key verified gone | 13:55:22 |

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `production_givers` | PASS: the driver reports `serverTaskGiver` false |
| `fresh_bot_state` | PASS: `tasks.json`, `agenda.json` and `memory.json` moved aside |
| `refused_politely` | PASS: "Sorry Server, I only run commands from task givers." |
| `not_on_marker` | PASS: "found nothing" in all 13 testfor polls over 90 s |
| `no_task` | PASS: no task line in 90 s after the whisper |
| `no_cheat` | PASS |

- No spam kick, no agent exit, no deaths.

## LLM, providers and memory summaries

- **Requests:** 17: 14 agent replies and 3 memory summaries. None failed, none was empty, no HTTP errors. All went to Wafer, and all 3 summaries were attributed.
- **Checked by hand:** 3 "Storing memories..." and 3 "Memory updated to:".

## Cost

- **Spend:** USD 0.001847 (key usage 0.893069 to 0.894916, from `batch.json`).
- **Hetzner:** ran 6 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone.
  - The project was empty afterwards: 0/0/0, counted with `grep -c .`.

## Round 9 in all (smoke on 670fe8aa)

| Batch | Result |
| --- | --- |
| A (`g3a-20261107-r9`) | **PASS 7/7**: the whole agenda in 6 min; sticks from leaves |
| B (`g3b-20261107-r9`) | FAIL 3/5: in the shelter for 17.5 min, then the shelter was opened and a zombie killed the bot; killed again after the respawn (`stat.deaths` 2); then the agent killed its own process (`stayed_online`) |
| C (`g3c-20261107-r9`) | **PASS 7/7** |
| D (`g3d-20261107-r9`) | **PASS 7/7** |

- **3 of 4, so not the clean 4/4 that the gate rule (PLAN.md) needs: no gate batch on 670fe8aa.** All four results are reported here, as run.
  - Under the GO there is no rerun.
- **What the lead asked:**
  - **A's sticks:** from `dynamictrees:leaves0`, in one `!collectBlocks("stick", 3)` call. No dead bush was used, and felling came later, in the `logs` step.
  - **B's `[inventory]` rejected-click lines:** none (0 `[inventory]` lines in B's driver log).
- **For skills-rotn (the lead routes):**
  - **B's shelter was opened in the night.**
    - At 13:35:22 the night check found -77 58 -60 and -77 59 -60 open, the side at feet and head height, after 17.5 min closed.
    - The bot had no pickaxe, and `self_defense` interrupted the repair. The zombie killed it 3 s later.
    - After the respawn, the shelter rule refused to build without a pickaxe (by design), so the bot had no shelter and died again.
    - **The root cause** is that `sticks` stalled again (leaves gave nothing, "agenda paused" at 13:10:35), so there was no pickaxe all day.
  - **The `sticks` step is still luck-dependent:** in A, leaves gave sticks in 34 s; in B, they gave none in 5 min.
  - **B's agent killed its own process after the second death** (`stayed_online`, a real fail; corrected in this PR, it was first called a harness false fail).
    - The death asked `!collectBlocks("dirt", 10)` to stop. It did not stop within 10 s, so `action_manager.js` called `cleanKill` ("Code execution refused stop after 10 seconds. Killing process.", from the bot's saved history).
    - The bot said "Exiting.", left, and `agent_process` restarted it (exit 1, requested restart).
    - After the first death, and after T1's forced death, the running action did stop in time.
- **Memory summaries:** 35 stored, 0 empty (A 12, B 6, C 14, D 3).
- **Providers:** Wafer only. 154 requests, 0 empty answers, 0 failed; one reply in C has no provider line.
- **Spend:** USD 0.018623 by the four batch figures. By the key, 0.875739 (A's start) to 0.894916 (D's end) is USD 0.019177, including the four preflight probes. The key reads 0.894916 of the 4.50 stop.
- **Hetzner:** 10 + 36 + 10 + 6 min, 4 servers each billed about 1 h, an estimated EUR 0.55 plus Primary IPv4. Every server, Primary IP and SSH key was verified gone.
- **After the round:** the T1 rehearsal of `g4-death-report` ran on its own server under a separate GO. See `test/evidence/g4/g4death-20261107-t1/`: a rehearsal, never G4 evidence.

## Files

- `batch.json`, `run.log`, and `untrusted/result.json`, `untrusted/driver.log`, `untrusted/server.log`.
- All were redacted by `test/tools/redact-evidence.mjs --bot FRCFLD`, and `--check` is clean.
- The raw logs are in `captures/raw/r9-g3d/` (not committed).
