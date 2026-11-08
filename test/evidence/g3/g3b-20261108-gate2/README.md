# G3 GATE RERUN batch B (2026-11-08): `g3-first-night`, PASS 5 of 5; on 8aaf370c; a GATE batch; the server is deleted

**Result in one line:** a fresh bot finished the agenda by 00:15, built its shelter at sunset, moved once to a new site one block lower 10 s later, and stayed in it until dawn: no deaths, online for all 39.6 min.

**A gate batch:** `batch.json` says `"gate": true, "smoke": false` (written by `batch.mjs --gate`, not edited by hand). The single-batch gate claim check passes: `node test/tools/g3-batch-check.mjs batch.json night/result.json` → "consistent: 1 result(s) vouched for by … a gate batch (gate: true)".

## Run conditions

- **GO:** the lead's written GO for the G3 gate rerun of B and C only, approved by the human (2026-11-07, about 23:35 UTC) under the G3 gate rule.
  - A and D passed on `0daeef2d` (#353). B's failure was fixed by #355 and C's scenario by #354.
  - Scope: exactly one `batch.mjs --gate` batch for B, then one for C, each on its own fresh server, from a new detached checkout of `8aaf370c` with `npm ci`; the same seed; no skip flags.
  - Rules: no further rerun, retry or extra batch without the human.
- **Start after 00:00 UTC:** DRIVER.md's pre-batch rule is not to start a batch that would cross 00:00 UTC. The lead agreed to wait, so B's pre-checks began at 00:00:43.
- **Code:** a clean detached checkout of `8aaf370c77b4` (develop, frozen), after `npm ci` (patches applied, 0 changed files).
- **Pack as tested (ADR 0005 + ADR 0008):**
  - the server pack zip SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`;
  - the Mod Director download `mods/esmtweaks-1.12.2-0.4.5.jar`, SHA-256 `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933`.
- **Free memory at 00:00 UTC:** 4,368 MB available of 7,746 MB.
- **Checks right before the create (00:00:43-00:00:54 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0, `grep -c .`);
  - the gate preflight (`--preflight --gate`, HTTP 200, Wafer): "timeouts: g3-first-night 67 min; a GATE batch (gate: true)", for a 180 min TTL, with no midnight warning;
  - the dry run (sweeper OK);
  - the user-data: 16,962 bytes, gz+b64, valid schema, every `write_files` entry equals the checkout's file;
  - the pack default matched the pin.
- **Command:** `deploy/test-server.sh run --yes --ttl-hours 3 --seed 1880465901402976865 -- node test/runner/batch.mjs --gate --max-batch-usd 2 --logs-out <raw>/server --summary <raw>/batch.json --scenario g3-first-night --out <raw>/night -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/rotn-bot.json`, with no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created; ready (after the Mod Director check) | 00:01:20, 00:04:33 |
| Batch start; FRCFLD joined | 00:04:35, 00:04:48 |
| Agenda done | 00:15:12 |
| "[night] sunset is near: building a shelter" | 00:19:16 |
| "[night] in the shelter at -74, 60, -67 until morning" | 00:19:29 |
| "[night] no longer in the shelter at -74, 60, -67: building a new one" | 00:19:39 |
| "[night] in the shelter at -74, 59, -67 until morning" | 00:19:42 |
| "[night] morning: found no safe side to open; back to work" | 00:44:54 |
| Command exited (PASS, exit 0) | 00:45:15 |
| Server, Primary IP and SSH key verified gone | 00:45:29 |

## Mod Director check (ADR 0008, from `run.log`)

- ESM-Tweaks `sha256 b57590bf…f933 OK`; "OK: 1 pinned download(s) match; 337 jars of the pinned zip match; 0 extra mod(s)".

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `survived_night` | PASS: dawn reached; `stat.deaths` 0; death lines 0 |
| `stayed_online` | PASS: online from the join to the end (39.6 min) |
| `no_cheat` | PASS |

- No kick, no agent exit, no deaths.

## The shelter (the lead's watch items for this rerun)

- **The bot stayed in its shelter all night**, from 00:19:42 to dawn (about 25 min), after one move.
  - At 00:19:39, 10 s after it was first "in the shelter", the night check found it no longer in its site and built a new one at -74 59 -67, one block lower, 3 s later. No line names why it was out of the first site.
- **No mob-placed block this time:**
  - #355's lines ("breaking it from inside; staying in the shelter", "could not break" / "Not breaking", "keeps coming back or cannot be broken"): 0;
  - "no longer usable": 0.
  - Gate B on `0daeef2d` (#353) failed on such a block; whether #355 handles one on a real server is therefore not shown here.
- **Digging alarms, repairs, fights from the shelter, falling blocks:** 0. The bot never walked out.
- **The server log in the night:** besides the scenario's reads and the `gamestages` saves, only three "Fetching addPacket for removed entity" warnings (00:34:53, 00:39:27, 00:41:52).
- **"refused stop after 10 seconds":** none in `driver.log` or the bot's saved history; no agent exit.
- **For skills-rotn (open since smoke round 10 B):** dawn again said "morning: found no safe side to open; back to work". The scenario ended 20 s later.

## Other watch items

- **Sticks:** one `!collectBlocks("stick", 3)`. A `deadbush` and two `dynamictrees:leaves0` (one gave `rustic:olives`) logged "got no stick", and later pickups made up "Collected 3 stick".
- **Chat:** no reflex line repeated. Four of the LLM's own command replies came twice or three times within 60 s (`!placeHere("crafting_table")` 3×, `!useOn("crude_axe", "log")`, `!inventory`, `!craftRecipe("planks", 2)` 2× each).

## LLM and cost

- **Requests:** 72: 55 agent replies and 17 memory summaries. None failed, none was empty; all went to Wafer.
- **Spend:** USD 0.009309 (key usage 0.946290 to 0.955598, from `batch.json`).
- **Hetzner:** ran 44 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone; the project was 0/0/0 afterwards.
