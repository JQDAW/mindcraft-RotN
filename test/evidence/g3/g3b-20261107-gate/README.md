# G3 GATE batch B (2026-11-07): `g3-first-night`, FAIL 4 of 5 (`survived_night`); on 0daeef2d; a GATE batch; the server is deleted

**Result in one line:** the bot finished the agenda and sat in its shelter for 12 min. Then the night check found `contenttweaker:scaffolding` in the shelter's head cell and left to build a new one. `self_defense` interrupted that build, and a zombie killed the bot 21 s after it left.

**A gate batch:** `batch.json` says `"gate": true, "smoke": false`. The single-batch gate claim check is consistent (`g3-batch-check.mjs batch.json night/result.json`, exit 0). **A failed gate batch is a result** (the GO; PLAN.md's gate rule): it stays here, and C and D still ran.

## Run conditions

- **GO, code, pack:** as for gate batch A (`g3a-20261107-gate`). B ran after A, on its own fresh server.
- **Free memory at 21:14 UTC:** 4,444 MB available of 7,746 MB.
- **Checks right before the create (21:14:05-21:14:32 UTC), all passed:**
  - `msa-login`, the key, an empty project (0/0/0);
  - the gate preflight (HTTP 200, Wafer), "timeouts: g3-first-night 67 min; a GATE batch", for a 180 min TTL;
  - the dry run (sweeper OK);
  - the user-data (16,962 bytes, valid, equal to the checkout);
  - the pack pin.
- **Command:** the gate A command with `--ttl-hours 3`, `--scenario g3-first-night` and `--out <raw>/night`; no skip flags.

## Times (UTC)

| Step | Time |
| --- | --- |
| Server created; ready (after the Mod Director check) | 21:15:05, 21:18:17 |
| Batch start; FRCFLD joined | 21:18:19, 21:18:29 |
| Agenda done | 21:23:44 |
| "[night] sunset is near: building a shelter" | 21:32:56 |
| "[night] in the shelter at -59, 65, -101 until morning" | 21:33:02 |
| "[night] the shelter at -59, 65, -101 is no longer usable: contenttweaker:scaffolding at -59, 66, -101 (a solid block in the 1x2 space); building a new one" | 21:45:17 |
| "Fighting zombie!" (`self_defense` interrupts `buildShelter`) | 21:45:27 |
| "FRCFLD was slain by Zombie" | 21:45:38 |
| "[night] it is night: building a shelter", twice | 21:45:41 |
| "[night] in the shelter at -50, 62, -64 until morning" (after the respawn) | 21:45:52 |
| Command exited (check FAIL, exit 1) | 21:46:04 |
| Server, Primary IP and SSH key verified gone | 21:46:18 |

## Mod Director check (ADR 0008, from `run.log`)

- ESM-Tweaks `sha256 b57590bf…f933 OK`; "OK: 1 pinned download(s) match; 337 jars of the pinned zip match; 0 extra mod(s)".

## Checks

| Check | Result |
| --- | --- |
| `login_online` | PASS |
| `fresh_start` | PASS |
| `survived_night` | **FAIL**: no dawn (the bot died: FRCFLD was slain by Zombie); `stat.deaths` 1; death lines 1 |
| `stayed_online` | PASS: online from the join to the end (26.7 min) |
| `no_cheat` | PASS |

- No kick, no agent exit.

## What happened in the night

- **The head cell was blocked.** At 21:45:17 the night check found `contenttweaker:scaffolding` at -59 66 -101. That is the head cell of the shelter whose feet cell is -59 65 -101.
  - No line says where it came from: no digging alarm, no "the shelter is open", and the server log has nothing between 21:33 and 21:45 but the scenario's reads.
  - rotn-data's `packages/rotn-data/3.3.4/threat-reactions.json` says `minecraft:zombie` can "place weak scaffolding". That is the likely source; it is not proven.
- **The rule that applied:** a solid block in the 1x2 space makes the shelter "no longer usable", and the bot leaves to build a new one.
  - #346's reflex ("a falling block in the shelter's head space is dug out by hand") does not cover it: scaffolding is not a falling block, and no "[reflex] dug … out of the shelter's head space" line appears.
- **Outside:**
  - `self_defense` interrupted the new `buildShelter` (11 "waiting for code to finish executing..." lines, then "the shelter build was interrupted; it does not count as a try").
  - The bot fought ("Fighting zombie!", "I'm dying!") and was slain 21 s after leaving.
- **After the respawn:**
  - The bot said "[night] it is night: building a shelter" twice in the same second. That is a night-routine line, which #344's repeat filter does not cover.
  - Try 1 failed for want of dirt ("you have 0 dirt and 0 dirt piles").
  - The bot was "in the shelter at -50, 62, -64" at 21:45:52, 11 s before the scenario ended.
- **For skills-rotn (the lead routes):**
  - a placed (not falling) block in the head cell sends the bot out into the night; digging it out by hand, as #346 does for falling blocks, would keep it in;
  - `self_defense` interrupts the rebuild outside;
  - the duplicated `[night]` chat line.
- **No "refused stop after 10 seconds"** in `driver.log` or the bot's saved history; no agent exit. Digging alarms, repairs and falling blocks: 0.

## Other watch items

- **Sticks:** one `!collectBlocks("stick", 3)`. Five `dynamictrees:leaves0` breaks logged "got no stick" (one gave a `harvestcraft:pearitem`), and the call ended "Collected 3 stick" from later pickups.
- **`[inventory]`:** 3 lines.
  - A craft click was rejected by the server; the second try failed with "missing ingredient".
  - The resync then reported "the server resent the window; cursor: empty".

## LLM and cost

- **Requests:** 45: 34 agent replies and 10 memory summaries; none failed or was empty.
  - 44 went to Wafer. One was still waiting for its answer when the scenario ended.
- **Spend:** USD 0.005213 (key usage 0.933691 to 0.938904, from `batch.json`).
- **Hetzner:** ran 31 min, billed about 1 h, an estimated EUR 0.1381 excluding the IPv4.
  - The server, Primary IP and SSH key were verified gone; the project was 0/0/0 afterwards.
