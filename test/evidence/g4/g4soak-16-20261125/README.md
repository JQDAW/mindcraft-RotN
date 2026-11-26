# G4 soak 16: `g4-soak-2h` on the CX23 service (2026-11-25)

**Label: the sixteenth soak, run under the lead's written GO `G4-SOAK-16-20261125`. It is never G4 acceptance evidence.**
- The run used the ADR 0010 targets (850 MiB, USD 0.05/h). **8 of 9 checks passed; `ate_when_low` failed** (4 of 10 `low` lines with no eat after them: one at 21:54:23, during the dig-out 36 s before death 1, and three on night 3, after death 2 had cost the bot its food).
- `result.json` marks it not-gate (`gateValid: false`): the S-run reason from #436, and the step-7 runner's reasons (no `ROTN_G4_ACCEPT` marker, so conditions (a) and (d) fail; (b), (c) and (e) hold).
- **The first soak on rotn-v0.1.22.** It ran 20:29:08 to 22:29:42 UTC.
- **Trapped underground from 21:17 to 21:55, and killed on the way out.**
  - **How it started:** on day 2 the model sent `!goToCoordinates(-41, 69, -12, 32)` to walk back to the night-1 shelter, 71 blocks away. mineflayer-pathfinder took a `destructive path` for 2.8 min (21:17:03–21:19:50) and left the bot at **9, 68, -63, 11 blocks under the sky** (y 79).
  - **The escape could not get out:** `!goToSurface` at 21:20:07 and 21:53:14, and the morning escape at 21:52:31, each ended `no stair step, and no room to pillar up above 9, 68, -63` (dug 0, placed 0).
  - **The stone pickaxe was gone.** It was last named as carried at 20:44:06; at 21:23:58 the night routine's pickaxe check said `inventory: none`. No break, drop or durability line was logged (below).
  - **The standing goal's daily budget** stopped the self-prompter at 21:20:50, 43 s after the first failed `!goToSurface`. The bot spent the rest of day 2 and night 2 in the trap. **Idle measure:** wall-clock time with no self-prompt loop running, from `self prompt loop stopped` (21:20:50) to the morning line (21:49:31): **28.7 min** (3.1 min of day 2, then night 2's 25.5 min), with 0 model replies; the next loop started at 21:52:32 (31.7 min).
  - **Day 3:** the model crafted a new stone pickaxe in the trap (21:54:07). `!goToSurface` then dug 21 blocks by hand, from y 68 to y 75, in 50 s. At 21:54:57 the cowardice reflex fled 2 zombies, which interrupted the dig, and the zombies killed the bot at 10, 75, -62 (21:54:59).
- **Death 2 (22:01:12): `slain by Rhode Island Red Hen`.** After the model killed a hog, a hen pecked the bot to death in 40 s: 4 hurt lines, which are at least 7 pecks (2 + 2, 2 + 2, 2 + 2, 1). A `zombie_players:zombie_player` was 0 m away at the killing hit (`driver.log:2530`). The bot never fought back, and the reflexes only fled.
- **Night 3 had no shelter.** After the second respawn the bot dug a hole at -7, 65, 30 whose roof block would not stay (`placed twice; now air`), and every later shelter try and walk failed. It spent the night in the open hole, with no food from 22:18 on (food 8 → 6).
- **Cost:** USD 0.028209/h (the gate's; target 0.05), from 114 calls, all to Wafer. **By day 0.0709/h, by night 0.0037/h.**
  - **Memory summaries:** 20 of 114 calls (17.5%), USD 0.018967 (**33.6% of the spend**), 20,297 prompt and 98,451 completion tokens (19.1% of all tokens). Their reasoning tokens were 95,587, up to **24,916** for one summary (night 3, 22:06:22).
  - **Reasoning:** 97.5% of all completion tokens.
- **Rejected clicks: 2** (item (d)): a crafting-grid click on day 1 that the server matched to a different recipe, and a respawn equip.

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.22` = develop `043466a2`, a fresh detached checkout. `npm ci` ran first, then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. It started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-16-20261125:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-16-20261125`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, release `rotn-v0.1.22`, which the lead deployed through the gate. The unit was inactive and disabled before the run, and the lead had reset its Mindcraft state. The human set the env `host` to this test server and confirmed it, with the file `root:root 600`. After the unit's systemd start (20:29:17), the journal shows: `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[release] rotn-v0.1.22-043466a266af` (the harness's commit); `[state] <bot> at start: tasks=absent agenda=absent memory=absent`; `[forge-bridge] bettercombat attack: on`; the dig-time rule line. Three `Error with embedding model, using word-overlap instead.` lines at 20:29:24 |
| Test server | `mcr-test-20261125-202536`, a CPX42 in nbg1. Created 20:25:43, ready 20:28:57, deleted 22:30:23: 124 min, billed about 3 h, EUR 0.4143 plus the IPv4. The watchdog `delete-after` was 2026-11-26T00:25:42Z (TTL 4 h). Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 test SSH keys (`server-lifecycle.txt`) |
| Step-7 check | `test-server.sh starts` right after `up` (20:28:57): `starts=1 files=1` (`step7-starts.txt`). After the run, before `down`: `starts=1 files=1` |
| World | The G2/G3/M1 seed `1880465901402976865`, fresh: `world 463 of at most 4135 ticks` at the step-7 read |
| Server | Firewall: ports 22 and 25565 only from the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 15 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match; 0 extra mods |
| Timing | **Each join time names its source:** the unit started at **20:29:17** (systemd, `driver.log:2`). The server logged `<bot> joined the game` at **20:29:30** (`server.log:10`). The journal shows `<bot> spawned.` at **20:29:32** and `Self-prompting started.` at **20:29:33**. The runner's `login_online` passed at **20:29:34** (`run.log`). Next came 120 min of samples every 5 min (25 samples), then the runner's ctl stop. The unit was stopped at 22:29:40 (systemd: `698.5M memory peak`, 20 min 12 s of CPU) |
| After the run | At the lead's request, for skills-rotn's trap analysis: `save-all flush` on the test server's console (22:29:51, `Saved the world`), then `test-server.sh fetch` of the region file covering the trap (`r.0.-1.mca`) and `level.dat` into the dev server's shared folder, then the delete as planned. Those files and the trap excerpt below stay off the repo |

## The checks (`result.json`)
| Check | Result | Detail |
| --- | --- | --- |
| `login_online` | PASS | joined, a version-4 (Mojang account) UUID |
| `naming` | PASS | `[naming]`: 17 kinds, unknown 0, all real; entities: 1 kind, unknown 0 |
| `no_crash` | PASS | 120 min up, 25 samples, `NRestarts` 0 throughout, no agent exit |
| `peak_memory` | PASS | 699 MiB (target 850) |
| `usd_per_hour` | PASS | USD 0.028209/h: USD 0.056454 over 120 min, 114 completions (target 0.05) |
| `agenda_done` | PASS | `agenda done` at 21:15:12 (`server.log:580`) |
| `food_floor` | PASS | lowest food 6, from 123 food lines (floor 6) |
| `ate_when_low` | **FAIL** | 4 of 10 `low` lines with no eat after them: 21:54:23 (food 8, 36 s before death 1, during the dig-out) and 22:18:52, 22:22:47, 22:26:42 (food 8, 7, 6 on night 3, with `no safe food in the inventory` every 30 s from 22:18:52 to the end) |
| `deaths_reported` | PASS | each of 2 deaths reported |

## The LLM spend (item (i); `test/tools/soak-spend.mjs`)
- **Rules:** the tool as merged in #613. Each call is paired with its caller's first line after its reply end: `Memory updated to:` means a summary. A night runs from `sunset is near` to its first `[night] morning` line, and calls go to windows by line order.
- **Summaries:** 20, the same as the 20 `[memory] summary turns` markers and the 20 summary end lines. 0 calls were unclear.

| Window | Calls | Memory summaries (calls, USD, reasoning tokens) | Completion tokens | Reasoning tokens | USD |
| --- | --- | --- | --- | --- | --- |
| Day 1 (20:29:32–20:44:02) | 53 | 8, 0.004379, 20,870 | 77,719 | 75,327 | 0.022232 |
| Night 1 (20:44:02–21:09:31) | 0 | 0 | – | – | – |
| Day 2 (21:09:31–21:23:58) | 30 | 6, 0.002010, 8,848 | 34,281 | 32,985 | 0.010643 |
| Night 2 (21:23:58–21:49:31) | 0 | 0 | – | – | – |
| Day 3 (21:49:31–22:04:15) | 30 | 5, 0.007919, 40,953 | 76,907 | 75,490 | 0.018920 |
| Night 3 (22:04:15–22:29:31) | 1 | 1, 0.004661, 24,916 | 25,084 | 24,916 | 0.004661 |
| Day 4 (22:29:31–22:29:40) | 0 | 0 | – | – | – |
| **Total** | **114** | **20, 0.018967 (33.6%), 95,587** | **213,991** | **208,718** | **0.056454** |

- **USD per hour:** the gate's, 0.028209 over 120 min. The gate's USD 0.056454 equals the tool's total.
- **Day vs night:** days 43.8 min, 113 calls, USD 0.051795 = **0.0709/h**. Nights 76.3 min, 1 call, USD 0.004661 = **0.0037/h**. The one night call is the summary at 22:06:22.
- **Memory summaries, the share the lead asked for:**

  | | Summaries | All calls | Share |
  | --- | --- | --- | --- |
  | Calls | 20 | 114 | 17.5% |
  | Prompt tokens | 20,297 | 407,907 | 5.0% |
  | Completion tokens | 98,451 (max 25,084) | 213,991 | 46.0% |
  | Prompt + completion | 118,748 | 621,898 | 19.1% |
  | Reasoning tokens | 95,587 (max 24,916) | 208,718 | 45.8% |
  | USD | 0.018967 | 0.056454 | **33.6%** |

  Each summary's prompt is small (706 to 1,640 tokens); its cost is the reasoning. 5 summaries used more than 10,000 reasoning tokens (I11): 20:38:32 (10,792), 21:57:04 (14,339), 22:01:11 (11,645), 22:01:56 (11,568), 22:06:22 (24,916). Those 5 cost USD 0.013853, 73% of the summary spend.
- **Other calls:** 94, USD 0.037487. Prompt 387,610, completion 115,540, reasoning 113,131 (max 21,408).
- **Reasoning:** 208,718 of 213,991 completion tokens (97.5%). Every call had a `reasoning_tokens` line.
- **Self-prompting:** 28.0 min in 13 loop runs. 109 calls had their usage line inside a run, USD 0.046406; 5 calls were outside one, USD 0.010048.

### Every memory summary (`memory-summaries.txt`)
`memory-summaries.txt` lists all 20, redacted: the usage line's time, tokens, USD, the reply's length, and the memory text. The reply lengths in characters, in order:

> 456, 485, 498, 484, 494, 474, 451, 487, 433, 496, 483, 483, 493, 495, 491, 485, 497, 492, 498, 488

None was over 500 characters, so history.js truncated none.

## The soak invariants (`test/tools/soak-invariants.mjs`)
`node test/tools/soak-invariants.mjs test/evidence/g4/g4soak-16-20261125`:

| Invariant | Soak 16 | Lines |
| --- | --- | --- |
| I1 trapped | **1 episode, 4 failed path attempts, 7.8 min** | 21:12:13 (`driver.log:1254`) to 21:19:59 (`driver.log:1811`) |
| I2 enclosed morning | **1** `could not leave the shelter` | 21:52:32 (`driver.log:2005`) |
| I3 rejected clicks | 2 | 20:37:18 (`617`), 21:55:03 (`2194`) |
| I4 dig refused with a usable tool | 0 of 2 tool refusals | both with no pickaxe carried (21:53:57) |
| I5 sunset food short | 1 of 3 sunset lines; 1 food run, +0 points | 22:04:15 (`2731`): food 12, held 0, need 2.8 |
| I6 starving | 0 food lines at 4 or less (lowest 6); **1 `no safe food` run over 5 min (10.5 min)**; 0 starving hurt lines | 22:18:52–22:29:23 |
| I7 gate then act | 0 of 0 | – |
| I8 refused command | 0 by design; 11 replies whose command never ran | first 20:31:11 (`94`) |
| I9 false collect | 0 | – |
| I10 death loop | 0 loops (2 deaths) | – |
| I11 summary cost | 5 of 20 over 10,000 reasoning tokens (max 24,916); 33.6% of the spend | above |
| I12 unattributed hurt | 0 `(by unknown)` lines; 0 deaths with no mob named | – |

**What the invariants miss here (fixes queued after this PR, the lead's call):**
- **I1** counts runs of failed path lines, so it closes the episode at 21:19:59 and misses the `[escape]` lines that follow it (21:20:07 to 21:54:59, the bot still at 9, 68, -63). It does not count the 20:41 `[escape] trapped … after digging` episode either, which cleared in 127 s. The follow-up makes an episode run from an `[escape] trapped`/`stuck` line to `out` or a failure.
- **I8** does not count `[modes] refused: the model asked to turn cowardice off; only a task giver may` (21:13:42, `driver.log:1497`) as a refusal by design.

The baseline (`test/evidence/g4/invariants-baseline.json`) gets the soak 16 row; the diff adds only that row.

## What happened
### Day 1 (20:29–20:44)
- **The agenda** (from `server.log`): the weapon step and logs; the scripted **food job, `+7 food points in 46 s (enough)`** (20:31:14–20:32:00); rocks, the crude axe, the first plank, Crafting Tools, the table, planks and sticks; **the stone pickaxe at 20:38:03** (`driver.log:733`). Then the scripted `shelter_blocks` job: `+6 shelter blocks (6 of 14; short)` (20:38:05–20:40:26).
- **A rejected click (20:37:18), item (d):** `!craftRecipe("planks", 2)`: the client expected planks in the table's result slot, and the server gave `ancientbeasts:stick_wall` (below). The retry failed with `missing ingredient`.
- **The first trap (20:40:55–20:43:36):** `!collectBlocks("undergroundbiomes:metamorphic_stone", 8)` dug down to y 65. At 20:41:29: `[escape] trapped at -42, 65, -12 after digging (8 cells searched, no walkable way to the sky)`. The pathfinder found 5 moves and walked them for 2 min without getting out (`the pathfinder's walk stopped (time)`); then by hand the bot pillared up 3 blocks: `[escape] out at -41, 69, -12 (by hand; dug 0, placed 3) in 126.6 s`. The model got the blocks to 14 by itself (`agenda step cobblestone done`, 20:43:41).

### Night 1 (20:44–21:09)
- **Sunset (20:44:02):** `food for the night: food 20 (+0 saturation), held 11.2 points, the night needs about 0: enough`.
- **Shelter:** at the escape spot, `in the shelter at -41, 69, -12 until morning` (20:44:06). The scroll was refused (below).
- **Spiders** hit through the walls at 21:01:03 and 21:01:35 (`[shelter] spider (hits through walls)`); there was no hurt line.
- **Morning (21:09:31–21:11:43):** a zombie, then spiders, kept the bot in for the full 2 min. At 21:11:31 a creeper was near, and the bot left by the north side (`a step up, 2 blocks`). It killed a spider in 6 s (21:11:47–21:11:53).

### Day 2 (21:09–21:24)
- **Food:** the scripted food job ran at 21:11:43 and ended `+0 food points in 0 s (a spider within 16 blocks)`. Food fell from 12 to 8 between 21:12:34 and 21:13:23, and the bot ate at 8 three times (rhubarb, blackberry, zucchini).
- **shelter_blocks:** three runs, the first two stopped by the creeper flee (below), the third `+1 shelter blocks (14 of 14; enough)` at 21:14:45.
- **The agenda** was done at 21:15:12 (`stone_axe` at a new table), and the standing goal started.
- **The cowardice reflex** fled a creeper 15 times from 21:12:13 to 21:13:36. The model asked `!setMode("cowardice", false)` and was refused (21:13:42). A fall hurt the bot at 21:13:40 (`hurt 6 health 19->13 (by fall)`).
- **The trap (21:17:03–21:20:50):**
  - `!goToCoordinates(-41, 69, -12, 32)` (21:17:03) ran 2 min 47 s: `Found destructive path (after a longer search)`, then `Unable to reach -41, 69, -12, you are 71 blocks away` (21:19:50, `driver.log:1794`–`1796`). The bot had gone from about (4, 79, -120) to 9, 68, -63.
  - `!goToCoordinates(-16, 69, -37, 8)` (21:19:54): `Path not found, but attempting to navigate anyway using destructive movements`, then `Unable to reach … 36 blocks away` (21:19:59).
  - `!goToSurface` (21:20:07): `[escape] stuck at 9, 68, -63: getting out to 9, 79, -63 (dry ground under open sky)`; `the pathfinder found no way (timeout); digging out by hand`; `still stuck at 9, 68, -63 after 5.1 s (dug 0, placed 0): no stair step, and no room to pillar up above 9, 68, -63` (`driver.log:1826`–`1830`).
  - `[agenda] standing goal budget spent: 5 min of self-prompting for day 1` (21:20:15, `driver.log:1837`); the self-prompter stopped at 21:20:50, and chat said `none until the next day` (`server.log:597`).

### Night 2 (21:24–21:49)
- **Sunset (21:23:58):** `food 9 (+0.1 saturation), held 8.2 points, the night needs about 5.7: enough`.
- **No pickaxe:** `[shelter] pickaxe check: need level 0; inventory: none; off hand: spartanweaponry:club_wood; cursor: empty; held: nothing` (`driver.log:1918`).
- **Shelter:** in the trap cell, `in the shelter at 9, 68, -63 until morning`. The scroll was refused (`47 blocks from the spawn (it needs 100)`).
- **Eating:** 3 `low` lines at food 8, each followed 1–2 s later by an eat (radish, tea leaf twice).

### Day 3 (21:49–22:04)
- **Morning (21:49:31–21:52:32):** a zombie at 9, 75, -62 (7 blocks up) kept the bot in for 2 min. Then 3 dig-out tries, all `no free cell within 3 blocks` and `no way up within 4 steps`, then the escape (`getting out upward (the sky starts at y 79)`; a 47-move path that `did not get out`; `still stuck … after 0.8 s`). Then `could not leave the shelter at 9, 68, -63 after 3 tries … back to work, still trapped` (`driver.log:2005`).
- **Getting out:** the agenda's food step prompt now began `You are trapped at 9, 68, -63 … get out first with !goToSurface`. The model:
  - crafted sticks (21:53:04), then tried `!goToSurface` (21:53:14), which failed as before;
  - crafted planks with a table placed at 9, 69, -63 (21:53:45); `wooden_pickaxe` has no recipe in the pack (21:53:47);
  - tried `!collectBlocks("undergroundbiomes:metamorphic_stone", 1)`, refused twice for the tool (21:53:57, item (e));
  - **crafted a stone pickaxe** at 21:54:07 (`driver.log:2135`);
  - sent `!goToSurface` (21:54:09): the pathfinder found no way (timeout), so the bot dug by hand from y 68.
- **Death 1 (21:54:57–21:54:59):** `[survival] flee zombie (outnumbered)` interrupted the dig at 10, 75, -62. Five zombie hits in 2 s (4 hurt lines; the second line is 3 + 3) took health 20 → 14 → 8 → 2 → 0; a `zombie_players:zombie_player` was also 0.4 m away at the last hit. `[escape] still stuck at 10, 75, -62 after 49.8 s (dug 21, placed 0): interrupted`. `<bot> was slain by Zombie` (`server.log:674`).
- **Respawn:** a rejected equip click (below); the respawn escape went 74 blocks to -122, 61, -52 (21:55:03–21:55:34). The bot lost its blocks, rocks, logs and food.
- **shelter_blocks** (21:55:35–21:59:12): one run stopped early (`+0 … stopped early: not counted`), then `+7 shelter blocks (7 of 14; short)`. The weapon step crafted a club, and the standing goal for the agenda's day 2 started at 21:59:15.
- **Death 2 (22:00:32–22:01:12):** `!attack("animania:hog_old_spot")` (21:59:59) ended `Successfully killed … no drop seen` (22:00:27). Then `animania:hen_rhode_island_red` hit the bot 2 points per peck (1 at the last), 0.8–2.4 m away, at least 7 pecks over 4 hurt lines: the hurt lines read 20 → 16, 14 → 10, 8 → 4 and 1 → 0 (the steps between them had no line). The bot never fought back. The model sent `!entities` and `!craftRecipe("cobblestone", 3)`; self_preservation fled at health 4 (22:00:46), then cowardice fled a `mod_lavacow:piranha`. `<bot> was slain by Rhode Island Red Hen` (`server.log:814`).
- **After death 2:** `[respawn] no place 64 blocks from the spawn and 2 recent death spots within 160; the agenda resumes here` (22:01:15). The model collected rocks; then a respawn escape ran after all (22:02:46–22:03:34, to -7, 69, 2), and a last 30-s rock collect hit its time limit (22:04:12).

### Night 3 (22:04–22:29)
- **Sunset (22:04:15):** `food 12 (+0 saturation), held 0 points, the night needs about 2.8: short by 2.8: a food run first (at most 3 min)`. The food run ended in the same second: `+0 points (no ripe wild food and no animal to hunt within 32 blocks)`.
- **No shelter:** `after the respawn escape: sheltering here at -7, 68, 30, a hole first`. At 22:04:30: `the block at -7, 67, 30 does not stay … placed twice; now air; against dirt at -6, 67, 30`, so the hole stayed open. 3 shelter tries and the hole fallback then failed (`space not free 402, no firm floor 2`; `space not free 145, not quick to dig by hand 2`). Both walks to better ground, 1 block away, `found no way out`, while the night routine's escape said `got out at -7, 65, 30` (it counts open sky as out). At 22:07:08: `no shelter … and no walk to better ground left tonight (2 of 2 made)`.
- **Food:** from 22:18:52, `low` at 8, 7 and 6, with `no safe food in the inventory` every 30 s to the end. No hurt line came at night 3.
- **End:** at morning (22:29:31) the food job ran `+0 food points in 6 s (12 tries)`, and the runner stopped the unit at 22:29:40.

## The watch items the lead asked for
### (a) Traps underground and (h) the escape lines
**Every `[escape]` episode** (the lead asked for start, how, duration and result):

| Start | Where | Called by | How | Duration | Result | Lines |
| --- | --- | --- | --- | --- | --- | --- |
| 20:41:29 | -42, 65, -12 | the trap check after a dig (`trapped … after digging`) | pathfinder, 5 moves, walked 2 min until its time limit; then by hand: placed 3 | 126.6 s | **out** at -41, 69, -12 | `driver.log:932`–`941` |
| 21:20:07 | 9, 68, -63 | the model's `!goToSurface` | pathfinder: no way (timeout); by hand: no stair step, no room to pillar | 5.1 s | still stuck (dug 0, placed 0) | `1826`–`1830` |
| 21:52:31 | 9, 68, -63 | the night routine's morning, after 3 dig-out tries | pathfinder: 47 moves, `did not get out`; by hand: as above | 0.8 s | still stuck | `2001`–`2005` |
| 21:53:14 | 9, 68, -63 | `!goToSurface` | as at 21:20 | 5.1 s | still stuck | `2050`–`2054` |
| 21:54:09 | 10, 68, -63 | `!goToSurface`, with the new stone pickaxe | pathfinder: no way (timeout); by hand: dug 21, y 68 → 75 | 49.8 s | **interrupted** by the cowardice flee at 10, 75, -62; **death 1** at 21:54:59 | `2150`–`2180` |
| 22:07:04, 22:07:07 | -7, 65, 30 | the night routine's walk to better ground (`found no way out: getting out first`, escapes 1 and 2 of 2) | – | 0 s | `the escape got out at -7, 65, 30` (open sky above a hole it could not walk out of) | `2760`, `2762` (escape 1 of 2); `2770`, `2772` (escape 2 of 2); `2778`–`2780` (no shelter) |

- **The 21:17 trap was not an `[escape]` episode at its start:** the model's `!goToCoordinates` walk dug the bot in, and the first `[escape]` line came only with the model's `!goToSurface` at 21:20:07.
- **Respawn escapes** (`[respawn]`, not `[escape]`): 21:55:03–21:55:34 (74 blocks, to -122, 61, -52), and 22:02:46–22:03:34 (try 1 of 3, 47 s, to -7, 69, 2).
- **`goToSurface` results:** 4 runs: 3 `You are trapped …` replies, 1 interrupted (`The way out from 10, 75, -62 was stopped by something else`).
- **The live checks** (every ~20 min on the partial journal) were reported to the lead as they came: the 20:41 episode, the 21:20 trap (by hand, before I1 counted it), I1 at the ~21:48 check, I2 at 21:52, and the night-3 hole.

**Where the first stone pickaxe went (for skills-rotn; not settled here):**
- It was crafted at 20:38:03 (`driver.log:733`) and last named as carried at 20:44:06 (the night-1 scroll line: `stone_pickaxe 1237 ms`, `driver.log:1086`). At 21:23:58 the pickaxe check said `inventory: none` (`driver.log:1918`).
- **No break, durability, drop or toss line** is logged in between. The two `!inventory` replies the model asked for at 21:12:07 and 21:12:20 never ran (the creeper flee interrupted both turns), and the last inventory listing is from 20:36:22.
- **Blocks dug in that time, from the journal:** at least 2 metamorphic stone and 4 dirt in the 20:40 collect (its output was shortened); the morning dig-out's 2 cells (21:11:33; the walls there were metamorphic cobble); 2 rocks in the shelter_blocks runs (rocks; the job crafted cobble from rocks, no stone broken). **mineflayer-pathfinder's destructive digs are not logged**: 21:12:13, 21:14:04 (2), 21:16:25 (unstuck), 21:17:03–21:19:50 (about 57 blocks south and 11 down) and 21:19:54–59.
- **A durability break fits but is not proven.** The new pickaxe showed `stone_pickaxe:27` on the server after its 21 blocks and the fight (the 21:55:03 rejected click); rotn-data's items dump gives `minecraft:stone_pickaxe` a `maxDamage` of 131. At about 1 per block, the first pickaxe would break after about 130 blocks, which the 21:17 walk could dig.
- **Crafting Tools did not take it:** the `contenttweaker:crafting_tools` recipe (`scripts/crafting_tables.zs:9`) uses a crude or stone axe, a rock or flint and a stick.

### (b) The `shelter_blocks` scripted job
From `server.log` (the job's lines go to chat, not the journal):

| Day | Run | Start | Min to the night routine | End | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 of 2 | 20:38:05 (`server.log:328`) | 6.0 (20:44:02) | 20:40:26 | `+6 shelter blocks (6 of 14; short)`; the model then made the 14 (`cobblestone done` 20:43:41) |
| 2 | 1 of 2 | 21:12:02 (`512`) | 11.9 (21:23:58) | 21:12:13 | `+5 (9 of 14; stopped); stopped early: not counted`: the creeper flee interrupted it |
| 2 | 1 of 2 | 21:13:20 (`557`) | 10.6 | 21:13:22 | `+4 (13 of 14; stopped); stopped early: not counted`: the creeper flee again |
| 2 | 1 of 2 | 21:14:25 (`572`) | 9.6 | 21:14:45 | **`+1 shelter blocks (14 of 14; enough)`** |
| 3 | 1 of 2 | 21:55:35 (`690`) | 8.7 (22:04:15) | 21:55:45 | `+0 (0 of 14; stopped); not counted` (right after the respawn) |
| 3 | 1 of 2 | 21:57:01 (`710`) | 7.2 | 21:59:12 | `+7 shelter blocks (7 of 14; short)` |

- **The start rule:** the job's `ready` check (`agenda_driver.js`) refuses a run unless `(minutes to sunset − SHELTER_LEAD_MIN 6) ≥ maxMs 4 min + 1 min`, so a run must start at least 11 min before sunset. The night routine's `sunset is near` line comes at 6 min before sunset, so a run must start **at least 5 min before that line**. All 6 runs pass; the tightest is day 1's, 6.0 min before it. The column uses wall-clock time to each night's `sunset is near` line; the job reads `sunsetEstimateMin` (the rest of the morning freeze counted), which is not logged.
- **Before dusk:** every run ended before its night routine: day 2's last run 9.2 min before the 21:23:58 sunset line, day 3's 5.1 min before 22:04:15. The game clock (the morning freeze) is not logged, so the time-freeze window itself cannot be checked from these lines.
- **Kept 14 blocks:** day 1 and day 2, yes. Day 3, no: the run stopped at 7, the step came due again at 22:00:14, and death 2 (22:01:12) took the 7 + 3 blocks. Night 3 had none.
- No `stale` line and no `too close to dusk` line.

### (c) The food reserve, the scripted food job and the herd rule
**Each sunset** (the night line, against the night's need + 4, the day reserve's margin):

| Sunset | Food (saturation) | Held | The night needs | Need + 4 | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1, 20:44:02 | 20 (+0) | 11.2 points | about 0 | 4 | `enough`; reserve met |
| 2, 21:23:58 | 9 (+0.1) | 8.2 points | about 5.7 | 9.7 | `enough`; **1.5 below the reserve** |
| 3, 22:04:15 | 12 (+0) | 0 points | about 2.8 | 6.8 | `short by 2.8: a food run first`; the run got +0. Death 2 had taken the food |

**The scripted food job** (`server.log`): 20:31:14 `+7 food points in 46 s (enough)`; 21:11:43 `+0 food points in 0 s (a spider within 16 blocks)`; 22:29:31 `+0 food points in 6 s (12 tries)`. On day 3 the food step started at 21:52:32 (in the trap) and the job never ran. The sunset-3 run: above.

**Herd rule lines:** 0. No hunting reflex hunt ran (`hunting: no weapon, so no hunt` at the start and after death 2); the one kill was the model's hog `!attack` (22:00:27), which logged no bull or herd refusal.

**Eats** (`[survival] ate`, each with a food change): rhubarb 21:13:26, blackberry 21:16:47, zucchini 21:23:06, radish 21:30:57, tea leaf 21:38:48 and 21:46:38; all 8 → 9. **`low` lines:** 10; the 4 with no eat are under the checks. **Lowest food:** 6 (22:26:42). **Food at each sunset → morning:** night 1 20 → 14; night 2 9 → 9; night 3 12 → 6.

### (d) `click rejected:` lines: 2
- **20:37:18** (`driver.log:617`), during `!craftRecipe("planks", 2)`:
  > `[forge-bridge] click rejected: window 1 slot 0 (mode 0, button 0, action 48); client before the click: slot planks x1, cursor -; server after it: slot -, cursor ancientbeasts:stick_wall x1`

  The server matched the grid to a different recipe (a stick wall) than the client did (planks). The retry: `the second try failed too: Error: missing ingredient`. rotn-data's #639 (merged after this release) drops that planks recipe because `the server's stick wall always wins`.
- **21:55:03** (`driver.log:2194`), the respawn equip:
  > `[forge-bridge] click rejected: window 0 slot 43 (mode 0, button 0, action 598); client before the click: slot stone_pickaxe:20 x1, cursor -, grid [-, -, -, -]; server after it: slot -, cursor stone_pickaxe:27 x1, grid [-, -, -, -]`

  The client and the server disagreed on the pickaxe's damage (20 vs 27). It resynced and put the pickaxe in slot 37.

### (e) `dig refused:` lines: 2
Both at 21:53:57 in the trap, on the model's `!collectBlocks("undergroundbiomes:metamorphic_stone", 1)`, with no pickaxe:
> `[forge-bridge] dig refused: undergroundbiomes:metamorphic_stone:0 at 8, 68, -63 (pickaxe level 0, hardness 2.4750001); held stone_axe:2 (no pickaxe level); pickaxe tools: none carried; rule: held Infinity`

The second is the same at 10, 67, -63 (`driver.log:2108`–`2109`). Both refusals are right: the bot carried no pickaxe (I4: 0 of 2 with a usable tool).

### (f) Event-loop stalls around rock collects
**None found.** 0 keepalive lines and 0 `[survival] stall` lines in the journal; 0 `Can't keep up` lines in the server's whole since-start log (21,210 lines). The rock collects (20:32–20:33, 21:12:02, 21:55:45, 22:01:40, 22:02:28, 22:03:42) logged at their usual pace. The last one hit its own limits on stone-poor ground (`time limit of 0.2 s reached` on a rock, then `Stopped collecting pyrotech:rock: time limit of 30 s reached`, 22:04:12), which are the collect's bounds, not a stall.

### (g) Hurt lines and deaths
**Hurt lines: 9**, all naming the cause:

| Time | Line | Context |
| --- | --- | --- |
| 21:13:40 | `hurt 6 health 19->13 (by fall)` | during the creeper flees |
| 21:54:57–21:54:59 | `hurt 6` ×3, `hurt 2`, `(by zombie)`, 20 → 0: 5 hits (one line is 3 + 3) | death 1, at the trap's exit |
| 22:00:32–22:01:12 | `hurt 4` ×3, `hurt 1`, `(by animania:hen_rhode_island_red)`, 20 → 0: at least 7 pecks | death 2 |

**Deaths: 2**, both reported (`[death] … waiting for the respawn`, then `lost …`, and the chat line):
1. **21:54:59, zombie**, at 10, 75, -62 (`driver.log:2187`, `server.log:674`): 5 hits from 2 zombies (and a zombie player 0.4 m away) at the top of the dig-out, after the cowardice flee interrupted it. `[reflex] low health 2: the respawn escape is the flee`.
2. **22:01:12, a Rhode Island Red hen**, at -274, 63, -121 (`driver.log:2532`, `server.log:814`): 4 hurt lines over 40 s, at least 7 pecks (2 + 2, 2 + 2, 2 + 2, 1), with no fight back. The killing hit's detail line names a `zombie_players:zombie_player@0m` as well as the hen at 1.3 m (`driver.log:2530`); the server named the hen. Why the hen attacked is not in the lines; the hog fight's Better Combat swings (10 written in all, `reach 6, sight 6` refusals) are one possibility.

### Other lines
- **Scroll:** refused at sunset 1 (`no walkable way out … to 8 blocks`), morning 1 (`more than 8 blocks from it`) and sunset 2 (`47 blocks from the spawn (it needs 100)`). Never used.
- **Attack counts** (cumulative): `bettercombat 5` by 21:12:26 (the spider), 10 by 22:00:26 (the hog).
- **Mode refusal:** `[modes] refused: the model asked to turn cowardice off; only a task giver may` (21:13:42).

## Step 7 (harness-ops)
- **Fresh:** `fresh: no earlier run, join or scenario; started once; world 463 of at most 4135 ticks` (20:29:12).
- **Release:** read from the journal's `[release]` line: `rotn-v0.1.22` (`043466a266af…`).
- **Conditions:** (b), (c) and (e) hold; (a) and (d) fail (no `ROTN_G4_ACCEPT`), so this is not a G4 acceptance run.
- **`test-server.sh starts`:** 1 after `up` and 1 after the run.

## For the owners (not judged here)
- **skills-rotn, the trap:** the model's `!goToCoordinates` (mineflayer-pathfinder's destructive moves) dug the bot 11 blocks down into a cell the escape could not leave without a pickaxe. Every escape there found `no stair step, and no room to pillar up`. The standing goal's budget stopped the self-prompter 43 s after the first failed `!goToSurface`, so nothing retried until the next morning. skills-rotn has the trap excerpt and the region file (through the lead).
- **skills-rotn, the lost pickaxe:** see (a); a durability break during the 21:17 destructive walk fits, with no line to prove it.
- **skills-rotn, the cowardice flee at the trap's exit:** it fled 2 zombies from a dig-out shaft at y 75 (21:54:57) and the bot died 2 s later.
- **skills-rotn, the hen:** a food animal killed the bot (at least 7 pecks over 40 s, 4 hurt lines), and nothing fought back. A zombie player was 0 m away at the killing hit (`driver.log:2530`). Is a hen that attacks a threat for `threat-reactions.json`?
- **skills-rotn, the hog's drop:** the model's `!attack("animania:hog_old_spot")` reply said `no drop seen within 4 blocks in 3 s` (22:00:27, `driver.log:2439`), and the model answered `No drop appeared`. Yet the bot held pork by 22:00:45 (the model: `Pork's already in stock`, `server.log:797`), and death 2 lost `3 animania:raw_prime_pork` (`driver.log:2549`). No pork came before the hog after death 1, and no pickup line names it.
- **skills-rotn, night 3:** the hole's roof block at -7, 67, 30 `does not stay` (placed twice, against dirt). Then every shelter try and both walks failed, and the escape reported `got out` in an open hole.
- **skills-rotn, `shelter_blocks`:** on day 2 the creeper flee stopped two runs in a row; on day 3 the bot was 7 short when death 2 came.
- **net-forge / rotn-data, the 20:37 click:** the stick-wall recipe won on the server; #639 addresses it.
- **skills-rotn, memory summaries:** 5 used over 10,000 reasoning tokens (night 3's single summary 24,916), and summaries were 33.6% of the spend.

## Soak 15 corrections (the #616 re-review nits)
- The rejected-click bullet now says an equip logs one line and a failed craft five lines for its two clicks (18 lines = 3 + 3 × 5).
- The craft clicks: slot 11 then slot 4 only at 22:50:16; 22:50:56 and 22:50:59 were both slot 4.
- The hog and bull were near from 00:10:45 to **00:11:21** (`driver.log:3423`).

## Files
| File | What |
| --- | --- |
| `result.json` | the runner's checks, samples, notes and step-7 facts (redacted) |
| `run.log` | the runner's console log |
| `driver.log` | the bot unit's journal for the soak (redacted; line numbers as in the raw file) |
| `server.log` | the test server's log for the soak window (redacted; line numbers as in the raw file) |
| `memory-summaries.txt` | the 20 memory summaries: each call's tokens, USD and reply length, and the memory text (redacted) |
| `step7-starts.txt` | `test-server.sh starts` right after `up` |
| `server-lifecycle.txt` | the `up` log (no `Waiting for` lines), both `starts` reads, the since-start header, the `save-all flush` lines, the `down` log and the Hetzner counts after the delete |
