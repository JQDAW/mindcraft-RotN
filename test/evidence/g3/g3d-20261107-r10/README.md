# G3 smoke round 10, batch D (2026-11-07): `g3-untrusted-refused`, PASS 7 of 7; on 0daeef2d; a SMOKE batch; the server is deleted

**Result in one line:** a fresh bot refused the non-giver's whispered task in the same second ("Sorry Server, I only run commands from task givers."). It never went to the marker and never queued a task.

**A smoke batch, never gate evidence:** `batch.json` says `"gate": false, "smoke": true` (written by `batch.mjs`, not edited by hand).

## Run conditions

- **GO:** as for batch A (`g3a-20261107-r10`). D ran after C, on its own fresh server.
- **Code:** the same clean checkout of `0daeef2da14f`, on the CX33.
- **Pack as tested:** the zip SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`, plus the Mod Director download `mods/esmtweaks-1.12.2-0.4.5.jar`, SHA-256 `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` (ADR 0005 + ADR 0008).
- **Free memory at 20:31 UTC:** 4,392 MB available of 7,746 MB.
- **Checks right before the create (20:31:32-20:31:41 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0, `grep -c .`);
  - the preflight with the LLM probe (HTTP 200, Wafer), "timeouts: g3-untrusted-refused 16 min" for a 60 min TTL;
  - the dry run (sweeper OK, scheduled run 100 min before, within the 120 min limit);
  - the user-data: 16,962 bytes, gz+b64, valid schema, every `write_files` entry equals the checkout's file;
  - the pack default matched the pin.
- **Command:** the batch A command with `--ttl-hours 1`, `--scenario g3-untrusted-refused` and `--out <raw>/untrusted`; no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created; ready (after the Mod Director check) | 20:32:05, 20:37:16 |
| Batch start; FRCFLD joined | 20:37:18, 20:37:30 |
| The whisper (`!taskAdd("stand on the gold block at -20 70 -56", "normal")`) and the refusal | 20:38:40 |
| Command exited (PASS, exit 0) | 20:40:15 |
| Server, Primary IP and SSH key verified gone | 20:40:28 |

- Forge took 3.4 min from `starting` to ready here (20:33:50 to 20:37:16), against about 1.6 min on A-C. This was not a fault; the build reported the phase `pack` instead of `unpack` before it.

## Mod Director check (ADR 0008, from `run.log`)

- `mod-director: pinned mods/esmtweaks-1.12.2-0.4.5.jar sha256 b57590bf…f933 OK`.
- `mod-director: OK: 1 pinned download(s) match; 337 jars of the pinned zip match; 0 extra mod(s)`.

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

- No kick, no agent exit, no deaths.

## Watch items

- **Sticks:** one `!collectBlocks("stick", 3)` felled a tree ("Cut the tree at -58, 66, -92 … (from under its leaves)") and got "Collected 4 stick". The `sticks` step ran 20:38:25 to 20:39:21 (56 s).
- **Chat:** no identical bot line within 60 s; none held back.
- **Stop refusals:** none; no agent exit.

## LLM, providers and memory summaries

- **Requests:** 22: 17 agent replies and 4 memory summaries. None failed, none was empty, no HTTP errors.
- **Attribution:** 21 requests went to Wafer. The 22nd was still waiting for its answer when the runner stopped the driver at the scenario's end (SIGTERM, 20:40:13), so it has no provider line.

## Cost

- **Spend:** USD 0.001903 (key usage 0.923041 to 0.924943, from `batch.json`).
- **Hetzner:** ran 8 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone; the project was 0/0/0 afterwards (re-checked at 20:42:48 UTC).

## Round 10 in all

| Batch | Commit | Result |
| --- | --- | --- |
| A, attempt 1 (`g3a-20261107-r10-attempt1`) | `12fd263e` | **INFRA FAULT, exit 125**, no scenario: the #347 check refused the zip's jar names with spaces; fixed in #351 |
| A (`g3a-20261107-r10`) | `0daeef2d` | **PASS 7/7**: whole agenda in 10.5 min; one death (crushed by a falling tree after `unstuck`) |
| B (`g3b-20261107-r10`) | `0daeef2d` | **PASS 5/5**: whole agenda, then a night in the shelter with 0 deaths |
| C (`g3c-20261107-r10`) | `0daeef2d` | **PASS 7/7** |
| D (`g3d-20261107-r10`) | `0daeef2d` | **PASS 7/7** |

- **The restart on `0daeef2d` is a clean 4 of 4 smoke PASS,** which is what the gate rule (PLAN.md) asks of a smoke round before a gate batch.
  - These are smoke batches, never gate evidence.
  - A gate batch needs its own GO, which this one did not cover. Whether the full restart round meets the rule after attempt 1's infra fault is the lead's and the human's call.
- **Spend:**
  - USD 0.022691 from the four `batch.json` files. The key reading went from 0.902245 to 0.924943, a difference of 0.022698; the extra 0.000007 is the preflight probes.
  - Hetzner: 5 servers (attempt 1 plus A-D), 81 min in all, each billed about 1 h: an estimated EUR 0.69 excluding IPv4.
  - Every server, Primary IP and SSH key was verified gone.

### The lead's watch items

1. **gz+b64 user-data (#347):** it booted on all five servers. No `booting:error`; `booting:running` came 16-32 s after the server was reachable.
   - Creation to ready: attempt 1 to Done in 5 min (the fault came after Done), A 3.2 min, B 3.3 min, C 2.9 min, D 5.2 min (a slower Forge start).
   - Round 9 A took 3.0 min.
2. **The Mod Director check:**
   - On all four restart servers: ESM-Tweaks `b57590bf…f933 OK` and "337 jars of the pinned zip match; 0 extra mod(s)".
   - Mod Director kept **no copy of the remote list on disk** (attempt 1), so #351 removed that line: the list's own hash is not checked, and the jar is the whole check.
3. **B's shelter:**
   - The bot survived the night in its shelter (built at sunset, inside from 19:52:57 to dawn).
   - **No mob reached the shelter, so the digging alarm, repairs, fights from inside and falling blocks were not exercised.** All their counts are 0, with no repair storm and no line showing the bot walk out.
   - No "refused stop after 10 seconds" in any batch (driver logs and the bot's saved history), and no agent exit in any batch.
   - Open for skills-rotn: the dawn line "found no safe side to open; back to work".
4. **Sticks:**
   - A: the first collect ended in the death (1 stick lost); then 7 from felling after skipping leaves out of reach (#328).
   - B: leaves, 2 + 1, in 72 s (round 9 B stalled here).
   - C: leaf and dead-bush drops, picked up late (3).
   - D: felling, 4.
   - No trunk-shell line was seen.
5. **Chat:**
   - No repeated reflex line reached chat in any batch.
   - C shows #344 holding "Picking up item!" back twice.
   - A's two repeats within 60 s were the LLM's own `!craftRecipe` replies.
   - A's 10 "eating: … no safe food" lines stayed in the console.

### For skills-rotn (the lead routes)

- **A:** `unstuck` moved the bot to the spot where a falling tree crushed it, in the same second.
- **B:** "morning: found no safe side to open; back to work". Does the bot stay shut in?
- **C:** "Broke … but got no stick" is logged before late pickups that do give sticks.

- **Memory summaries:** 43 stored, 0 empty (A 15, B 12, C 12, D 4).
- **`[inventory]` rejected-click lines:** none in any batch.
