# G4 soak 11: `g4-soak-2h` on the CX23 service (2026-11-22)

**Label: the eleventh soak, run under the lead's written GO `G4-SOAK-11-20261122`. It is never G4 acceptance evidence.**
- The run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. It FAILED: 6 checks passed and 3 failed (`agenda_done`: no `agenda done`; `food_floor`: lowest food 1; `ate_when_low`: 2 of 3 `low` lines with no eat after them).
- `result.json` marks it not-gate (`gateValid: false`) for two reasons:
  - the S-run reason from #436;
  - the step-7 runner's reasons: there is no `ROTN_G4_ACCEPT` marker, so conditions (a) and (d) fail. Conditions (b), (c) and (e) hold.
- **The first soak on rotn-v0.1.17:** the wooden club weapon, the shelter repair spare and the hole shelter with its sealed side pocket, the respawn escape, and the Scroll of New Life. The run went the full 120 min with no process restart and no agent exit (`no_crash` passed).
- **6 deaths, all reported** (server causes, `server.log`):
  - 4 `slain by Zombie`: two during shelter repairs after a zombie dug in (21:04:24, 21:38:42), one in the open after the night-2 shelter tries failed (21:48:34), and one inside a shelter whose repair had just closed with the zombie in the bot's cell (21:57:06);
  - 1 `starved to death` (22:28:34), in the sealed night-3 side pocket at food 1;
  - 1 `slain by Spider` (22:36:12), in the open after the cowardice reflex had interrupted six night-3 shelter tries.
  - No `slain by Zombie <bot>` line. Every `[respawn]` line counts `1 player zombie near`.
- **The respawn escape** ran after every death (6 times), each done on try 1, 64 or 65 blocks from the spawn and the recent death spots in 20 to 31 s.
- **The club:** the agenda's weapon step crafted it at 20:38:55–20:38:56; the bot hunted a pig with it (killed, 20:41:20) and lost it in the first death. The LLM crafted a second club at 21:59:51; the bot hunted a cottontail doe with it (killed, 22:08:51) and lost it in the starvation death. No fight with a hostile mob was logged.
- **The Scroll of New Life was never used.** The one try (21:31:58, 130 blocks from the spawn) logged `no answer from the server`, and the server log has no Scroll of New Life line after start-up.
- **The root cause is in progress with skills-rotn** (its soak 11 plan). This README records only what the logs show.
- **Cost:**
  - **Overall:** USD 0.0477/h, just under the 0.05 target.
  - **By the self-prompting windows (42.9 min):** USD 0.126/h.
  - **Reasoning:** 96% of the completion tokens.
  - **Memory summaries:** 26% of the completions and 50% of the spend.

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.17` = develop `d92bcdee`, a fresh detached checkout. `npm ci` ran first, with no other `npm ci` on the CX33 (another agent's `npm test` was running), then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. It started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-11-20261122:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-11-20261122`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, release `rotn-v0.1.17`, which the lead deployed through the gate. At 20:23 the lead reset FRCFLD's state through the gate (it archived `agenda.json` and `memory.json`). The human set the env `host` to this test server and confirmed it, with the file `root:root 600`. After the unit's systemd start (20:36:47), the journal shows: `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[release] rotn-v0.1.17-d92bcdeecb73` (the harness's commit); `[state] <bot> at start: tasks=absent agenda=absent memory=absent`; `[forge-bridge] bettercombat attack: on` |
| Test server | `mcr-test-20261122-202551`, a CPX42 in nbg1. Created 20:25:57, ready 20:28:56, deleted 22:37:35: 131 min, billed about 3 h, EUR 0.4143 plus the IPv4. The watchdog `delete-after` was 2026-11-23T00:25:57Z (TTL 4 h). Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 test SSH keys (`server-lifecycle.txt`) |
| Step-7 check | `test-server.sh starts` right after `up` (20:28:56): `starts=1 files=1` (`step7-starts.txt`) |
| World | The G2/G3/M1 seed `1880465901402976865`, fresh: `world 9479 of at most 12847 ticks` at the step-7 read |
| Server | Firewall: ports 22 and 25565 only from the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 10 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match; 0 extra mods |
| Timing | The scenario ran 20:36:39 to 22:37:08 UTC. **Each join time names its source:** the unit started at **20:36:47** (systemd, `driver.log`). The server logged `<bot> joined the game` at **20:36:57** (`server.log`). The runner's `login_online` passed at **20:36:58** (`run.log`). The journal shows `Self-prompting started.` at **20:37:00**. Next came 120 min of samples every 5 min (25 samples), then the runner's ctl stop. The unit was stopped at 22:37:06 (systemd: `668.1M memory peak`, 15 min 58 s of CPU). Afterwards `status frcfld`, read through the gate, showed `inactive (dead)` and `disabled`. The journal covers the whole soak (`journalCoverage`: 120.1 of 120.1 min) |

## The checks (`result.json`)
| Check | Result | Detail |
| --- | --- | --- |
| `login_online` | PASS | joined, a version-4 (Mojang account) UUID |
| `naming` | PASS | `[naming]`: 15 kinds, unknown 0, all real; entities: 1 kind (`dynamictrees:falling_tree`), unknown 0 |
| `no_crash` | PASS | 120 min up, 25 samples, `NRestarts` 0 throughout, no agent exit |
| `peak_memory` | PASS | 668 MiB (target 850) |
| `usd_per_hour` | PASS | USD 0.047685/h: USD 0.095449 over 120 min, 220 completions (target 0.05) |
| `agenda_done` | **FAIL** | no `agenda done` within the soak: the agenda did rocks, sticks, crude_axe and logs, and crafted the club, then stuck on `food` and `first_plank` (below) |
| `food_floor` | **FAIL** | lowest food 1 (22:24:42 to 22:27:42), from 122 food lines (floor 6) |
| `ate_when_low` | **FAIL** | 2 of 3 `low` lines had no eat after them:<br>- 21:04:30 (food 12, health 20, just after the first death, `no safe food in the inventory`);<br>- 21:38:40 (food 12, health 5, two seconds before the second death).<br>The one at 21:31:56 was followed by `ate harvestcraft:leekitem` (21:31:58) |
| `deaths_reported` | PASS | each of 6 deaths reported |

The survival notes show 9 eats, 0 fights, 23 flees and 122 food lines.

## The LLM spend and the reasoning tokens (per window)
The windows come from the journal: the night routine's `sunset is near` and `morning` lines. Each sunset line comes right after `self prompt loop stopped`, so no call falls on a boundary.
- Providers: `Wafer` answered 207 completions, `Near AI` 11 (21:58:21–22:09:49) and `DigitalOcean` 2.
- **The rule for a memory summary:** a call whose prompt is under 2,000 tokens. All 58 are also the call right before a `Memory updated to:` line.

| Window | Min | Completions | USD | USD/h | Completion tokens | Reasoning tokens | Memory summaries (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Day 1: join to `sunset is near` (20:36:58–20:51:28, up to `driver.log:1599`); a self-prompting window | 14.5 | 96 | 0.030157 | 0.125 | 94,473 | 89,157 | 23 (0.008664) |
| Night 1 (20:51:28 from `driver.log:1600`, to `morning` at 21:16:58, `driver.log:1782`) | 25.5 | 0 | 0 | 0 | 0 | 0 | 0 |
| Day 2 (21:16:58–21:31:51, up to `driver.log:3256`); a self-prompting window | 14.9 | 85 | 0.039773 | 0.160 | 153,670 | 148,732 | 24 (0.022974) |
| Night 2 (21:31:51 from `driver.log:3257`, to `morning` at 21:57:00, `driver.log:3498`) | 25.1 | 1 | 0.002978 | 0.007 | 16,042 | 15,881 | 1 (0.002978) |
| Day 3 (21:57:00–22:12:03, up to `driver.log:4248`); self-prompting from 21:57:43 | 15.1 | 36 | 0.021995 | 0.088 | 57,961 | 55,766 | 10 (0.013560) |
| Night 3 (22:12:03 from `driver.log:4249`, to the stop at 22:37:06) | 25.1 | 2 | 0.000546 | 0.001 | 752 | 739 | 0 |
| **The run** | **120.1** | **220** | **0.095449** | **0.0477** | **322,898** | **310,275 (96%)** | **58 (0.048176, 50%)** |

- **The self-prompting windows:** 42.9 min in six runs (20:37:00–20:51:27, 21:16:58–21:31:51, 21:57:43–22:05:42, 22:06:15–22:08:13, 22:08:45–22:12:03, and 22:36:45–22:37:06 after the last respawn), 215 completions, USD 0.090389 (0.126/h). The memory summaries made in them are side calls, not self-prompts. The other 5 calls are the night-2 memory summary and 4 day-3 calls in the gaps between self-prompting runs.
- **The nights cost almost nothing:** the re-plan prompts after the deaths were held while the respawn escape ran (`re-plan prompt held: the respawn escape is running`), and the night routine runs without the LLM.
- **Prompt tokens:** 704,832 in all.
- **The largest call by total tokens, also the largest completion:** the night-2 memory summary at 21:33:03 (`driver.log:3276`), 622 prompt and 16,042 completion tokens (15,881 reasoning), USD 0.002978.
- **The most expensive call:** a memory summary at 22:09:49 (`driver.log:4140`, provider `Near AI`), 1,008 prompt and 6,479 completion tokens (6,278 reasoning), USD 0.003320 (3.5% of the run's spend).
- **Empty replies:** five completions had no content (20:48:33, 21:22:48, 21:23:50, 21:24:08, 21:30:20), each `content null chars`, then `Empty content returned (model @preset/glm-5-3-flash-cheap-reliable, finish_reason stop)` and `No response received.`

## What happened
### Day 1 (20:37–20:51)
- **Agenda steps done** (server.log chat): rocks (20:37:32), sticks (20:37:45), crude_axe (20:37:50) and logs (20:38:49, `Collected 29 log`).
- **The club (agenda weapon step):** `agenda step weapon: crafting spartanweaponry:club_wood (try 1 of 2)` (20:38:55, `server.log:90`), then `[craft] bot.craft returned after 310 ms` (20:38:56, `driver.log:203`). The next agenda line is `agenda step first_plank started` (20:38:58, `server.log:105`); no `agenda step weapon done` line was logged. The inventory first lists `spartanweaponry:club_wood: 1` at 20:40:57.
  - The LLM also asked for `!craftRecipe("spartanweaponry:wooden_club", 1)` at 20:39:42. The self-prompt loop restarted at 20:39:44 and the command was never parsed or run.
- **The hunt with the club:** `[survival] weapon spartanweaponry:club_wood (hunt)` (20:41:05, `driver.log:425`), then `[reflex] hunting animania:sow_old_spot: killed` (20:41:20, `driver.log:437`).
- **Shelter blocks:** the chat says `116 total` dirt piles (20:40:22).
- **Food:** `agenda step food stuck: 5 min of self-prompting` (20:45:18). The bot said it held about 9 hunger of food (2 pork, radish, mushroom, bread).
- **First plank:** `!placeHere("log:1")` placed a log at 20:45:52 (`driver.log:1071`). The step stuck at 20:50:30 (`retry 1 of 3 in 20 min or at the next full day`).

### Night 1 (20:51–21:17)
- **The shelter at the spawn:** `sunset is near` (20:51:28) with `food worth 7 hunger held, food 20; enough`.
  - `shelter try 1 of 3 failed (… 1 open (-41, 69, -59: no block left to place); placed 7.); digging a hole shelter instead` (20:51:37).
  - `in the shelter at -41, 64, -59 until morning` (20:51:48). The scroll: `not used at -41, 64, -59: 0 blocks from the spawn (it needs 100)`.
  - **Self-seal:** `moving into a side pocket at -40, 64, -59 and sealing the shaft behind` (20:51:58), `moved into the side pocket: … the cells behind sealed` (20:52:00, `driver.log:1617`).
- **Death 1** (`driver.log:1631`–`1656`, `server.log:470`):
  - 21:04:14: `zombie is digging the shelter at -41, 65, -59: checking at once, ready to repair`.
  - 21:04:15: `the shelter is open at -41, 65, -59: repairing`; a `[craft]` returned at 21:04:16 (457 ms).
  - 21:04:17 and 21:04:21: `hurt 6` twice `(by zombie)`, the zombie at 0.8 m.
  - 21:04:24: died at -40, 64, -59 (`slain by Zombie`).
  - The repair's output (21:04:30): `A zombie near digs it by hand: none of the blocks you hold stops it (best: dirt).`, `Cannot close -41, 64, -59: zombie stands in it.`, `… 2 open (-41, 64, -59: a zombie stands in it; -41, 65, -59: the block did not stay (placed twice; now air; zombie over the cell)); placed 0.`
  - Lost: `36 betterwithmods:dirt_pile, 26 log:1, …`, including the club.
- **The escape and the rest of the night:**
  - Escape 1 (table below) ended at -88, 62, -131, where `the hole shelter failed (found no place to dig a hole shelter within 3 blocks (refused: water in the space 58, …; feet in water))`.
  - **Walk to better ground:** `no place for a shelter or a hole here …; walking to -95, 69, -134` (21:05:30), `the walk to better ground got there; sheltering from -95, 69, -135` (21:05:41).
  - `shelter try 1 of 3 failed (Not building a shelter at -95, 69, -134: you have 2 dirt and 0 dirt piles, and a dirt shelter needs 8 dirt …)` (21:05:42, `driver.log:1683`).
  - Then every try failed at the same cell: `Shelter at -95, 66, -134 is not closed: 1 open (-95, 68, -134: the block did not stay (placed twice; now air)); placed 0.`, 17 lines from 21:05:58 to 21:16:31 (the first round plus `quiet for 60 s: trying a shelter again` rounds 1 to 4 of 4). Each round ended `no shelter after 3 tries and a hole shelter …; no weapon: keeping away`.
  - Food: `food worth 0 hunger held, food 12`, and the eating reflex logged `no safe food in the inventory` every 30 s.
  - `morning: back to work` (21:16:58).

### Day 2 (21:17–21:32)
- **Stuck at the night-1 spot:** `unstuck: could not move away (Error: no floor under the start cell -95, 67, -134 or next to it)` (21:17:41); `unstuck: still stuck after 10 s` (21:19:06). Then the escape code got out (`driver.log:2020`–`2022`):
  - `[escape] stuck at -95, 67, -134: getting out to -95, 66, -134 (dry ground under open sky)`;
  - `[escape] the pathfinder found a way (1 moves): walking it`;
  - `[escape] out at -95, 66, -134 (pathfinder; dug 0, placed 0) in 0.2 s` (21:19:32).
- **The weapon step:** started at 21:16:58 and 21:20:32; the chat says `Died and lost everything — no club, no logs now` (21:17:12) and `Still no logs, so no club possible yet` (21:25:14); `agenda step weapon stuck` (21:25:34).
- **Food:** foraging `harvestcraft:shadedgarden` gave food from 21:22:21. Five eats: a sweet potato, a spice leaf and a bean at food 9, 10 and 11 (21:22:46–21:22:50), a tea leaf at 11 (21:26:52) and a blackberry at 12 (21:27:24).
- **A crude axe** was crafted at 21:30:53 (432 ms). `!placeHere("log")` failed at 21:31:00 (`you are in that cell, and the jump-and-place did not take`) and worked at 21:31:05 (`driver.log:3201`).
- The `!stats` reply at 21:17:44 has `- Weather: Thunderstorm`.

### Night 2 (21:32–21:57)
- **The shelter:** `sunset is near` (21:31:51) with `food worth 8 hunger held, food 13; enough`; `in the shelter at -168, 68, -85 until morning` (21:31:56); `ate harvestcraft:leekitem` at food 12 (21:31:58).
- **The Scroll of New Life try** (`driver.log:3271`–`3273`):
  - 21:31:58: `setting the respawn point here at -168, 68, -85 with the Scroll of New Life (once): far from the spawn and every death spot, no hostile near`.
  - 21:32:00: `the Scroll of New Life was not used (the scroll was not used up (no answer from the server))`.
  - The spot is 130 blocks (horizontal) from the night-1 shelter that the bot logged as 0 blocks from the spawn, and 131 from death 1. The server log has no `lifescroll` or `SoNL` line after its start-up lines; the only server line about it is the bot's own chat at 21:32:00 (`server.log:775`). The scroll stayed in the inventory through the deaths (`held: lifescroll:spawnscroll` at 21:49:13).
- **Death 2** (`driver.log:3285`–`3324`, `server.log:787`):
  - 21:38:34: `zombie is digging the shelter at -168, 69, -86`; `no weapon, health 20, and a zombie in reach at -169, 68, -86, and no way to back away: the opening is free and 49 blocks held: repairing first`; `the shelter is open at -168, 69, -86: repairing`.
  - 21:38:35 and 21:38:40: `hurt 6` twice `(by zombie)`; `[survival] weapon dirt (cell)` (21:38:39).
  - 21:38:42: died at -168, 68, -85 (`slain by Zombie`). The repair's output: `Cannot close -168, 68, -86: zombie stands in it.` and `Cannot close -168, 69, -86: zombie stands in it.`; `placed 0`.
  - Lost: `52 betterwithmods:dirt_pile, 32 log:1, …`.
- **After escape 2** (ended at -48, 82, -139): every try failed at one cell: `Shelter at -48, 78, -140 is not closed: 1 open (-48, 80, -140: the block did not stay (placed twice; now air)); placed 0.`, 16 lines from 21:39:27 to 21:48:09.
- **Death 3** (`driver.log:3410`–`3438`, `server.log:815`): `[survival] flee zombie (melee, and no weapon)` (21:48:28); three `hurt 6.5 (by zombie)` at 21:48:31–21:48:33, two of them in the air (`vy 0.3 air`, `vy 0 air`); three `attacking mob...` lines (21:48:33–21:48:34); died at -48, 77, -140 at 21:48:34 (`slain by Zombie`).
- **After escape 3** (ended at -118, 67, -31): `in the shelter at -118, 64, -29 until morning` (21:49:15, after two `[craft]` lines); the scroll `not used at -118, 64, -29: 65 blocks from the spawn (it needs 100)`; **self-seal** into a side pocket at -117, 64, -29 (21:49:27, `driver.log:3463`).
- **Death 4** (`driver.log:3487`–`3530`, `server.log:842`):
  - 21:56:56: `zombie is digging the shelter at -117, 66, -29`; 21:56:57: `the shelter is open at -117, 66, -29: repairing`; two `[craft]` lines (427 and 1210 ms).
  - 21:57:00: `hurt 6 (by zombie)`, the zombie at 0.3 m; then **`the repair closed the shelter at -117, 64, -29`** and `morning: a zombie at -117, 64, -29 is within 8 blocks of the shelter at -117, 64, -29; staying in until it leaves (checking every 30 s, at most 2 min)` (`driver.log:3497`–`3498`). The zombie's position is the bot's own cell.
  - 21:57:03: `hurt 6 (by zombie)`, 0.6 m; 21:57:06: died at -117, 64, -29 (`slain by Zombie`). Lost: `3 dirt`.

### Day 3 (21:57–22:12)
- **The second club:** the LLM's `!craftRecipe("club", 1)` got `Invalid item type: club.` (21:59:46, `driver.log:3707`); then `!craftRecipe("spartanweaponry:club_wood", 1)`, `[craft] bot.craft returned after 309 ms`, `Successfully crafted spartanweaponry:club_wood` (21:59:51, `driver.log:3746`–`3757`).
- **A fall:** `hurt 11 health 20->9 (by fall)` at 22:00:38 (`cause fall`, `vy -2`); the self-preservation reflex interrupted `action:descendFromTree` at 22:03:42.
- **Stuck:** `unstuck: could not move away (Error: no floor under the start cell 49, 67, -33 or next to it)` (22:08:11).
- **Food:** fell from 12 to 4 (21:57:41–22:08:41). `ate rustic:wildberries` at food 4, 5 and 6 (22:08:45–22:08:46).
- **The hunt with the club:** `[survival] weapon spartanweaponry:club_wood (hunt)` (22:08:47, `driver.log:4130`), `[reflex] hunting animania:doe_cottontail: killed` (22:08:51, `driver.log:4131`).
- Agenda: shelter_blocks stuck (22:05:04), food stuck (22:07:59), first_plank started (22:08:01).

### Night 3 (22:12–22:37)
- **The shelter:** `sunset is near` (22:12:03) with `food worth 0 hunger held, food 5; less than 6: staying sealed anyway (never out for food at night)`. A shelter try failed for blocks (`you have 4 dirt and 0 dirt piles`, 22:12:06); the hole worked: `in the shelter at 55, 76, -27 until morning` (22:12:16); the scroll `not used at 55, 76, -27: 97 blocks from the spawn (it needs 100)`; **self-seal** into a side pocket at 56, 76, -27 (22:12:29, `driver.log:4263`).
- **Death 5, starving** (`driver.log:4300`–`4326`, `server.log:959`): food 4 at 22:13:41, 3 at 22:17:41, 2 at 22:20:42 and 1 from 22:24:42, with health 20 at every food line; the eating reflex logged `food 1, but no safe food in the inventory, and no other food either` every 30 s. At 22:28:34: `[survival] hurt 20 health 20->0 (by starving)`; its hurt-detail names `near zombie_players:zombie_player@0m`. No zombie-dig line came before it. Lost: `20 betterwithmods:dirt_pile, 6 log:2, …, 1 spartanweaponry:club_wood:1, …`.
- **After escape 5** (ended at -123, 63, -63): `a hole first` (22:29:07); the cowardice reflex interrupted the hole or the shelter six times (`does not count as a try (1 of 6 by a threat reflex)` to `(6 of 6 …)`, 22:32:33–22:35:27). In between: a skeleton hit (`hurt 5.1`, 22:32:59), `the bot has moved since the hole found no place` at -145, 62, -26 (22:33:26), -229, 62, -94 (22:34:29) and -198, 63, -131 (22:35:15), and `up on a tree: climbing down before sheltering` (22:35:14). Food fell from 12 to 4 (22:32:42–22:35:42).
- **Death 6** (`driver.log:4549`–`4570`, `server.log:1102`): two `hurt 4 (by spider)` (22:36:10, 22:36:11), died at -203, 63, -276 at 22:36:12 (`slain by Spider`). Lost: `3 contenttweaker:spider_silk, 1 dirt, 1 feather`.
- Escape 6 ended at -123, 63, -64 (22:36:45), next to escape 5's end. The runner stopped the unit at 22:37:06.

## The lines the lead asked for
### Deaths and causes
| # | Time | Server cause (`server.log`) | Where | Shelter state |
| --- | --- | --- | --- | --- |
| 1 | 21:04:24 | `slain by Zombie` (470) | -40, 64, -59 (the spawn) | repairing a breach, zombie in the opening |
| 2 | 21:38:42 | `slain by Zombie` (787) | -168, 68, -85 | repairing a breach, zombie in the opening, no weapon |
| 3 | 21:48:34 | `slain by Zombie` (815) | -48, 77, -140 | no shelter: every try failed (`block did not stay`) |
| 4 | 21:57:06 | `slain by Zombie` (842) | -117, 64, -29 | the repair closed the shelter with the zombie in the bot's cell |
| 5 | 22:28:34 | `starved to death` (959) | 56, 76, -27 | sealed in the side pocket, food 1, no food held |
| 6 | 22:36:12 | `slain by Spider` (1102) | -203, 63, -276 | no shelter: six tries interrupted by cowardice |

- **Player zombies:** no `slain by Zombie <bot>` line. Every `[respawn]` escape line says `1 player zombie near`, and the flee lines name `zombie_players:zombie_player` 7 times (for example `Backing off: zombie players:zombie_player (a player zombie, and no weapon or health at half or less)`, `server.log:788`, 21:38:46).
- **Distances** (horizontal, from the night-1 shelter at -41, -59, which the bot logged as `0 blocks from the spawn`): death 1 is 1 block from it, death 2 130, death 3 81, death 4 82, death 5 102 and death 6 271.

### The respawn escapes
| # | Start (`driver.log`) | Done | Escape line | Seconds | Ends near |
| --- | --- | --- | --- | --- | --- |
| 1 | 21:04:30 (1654), `1 recent death spot` | 21:04:58 (1667) | `64 blocks from the spawn and 1 recent death spot at -88, 62, -131` | 28 | 41 blocks from where death 3 later happened |
| 2 | 21:38:46 (3308), `1 recent death spot` | 21:39:08 (3336) | `65 blocks … at -48, 82, -139` | 20 | death 3 came 1 block from here |
| 3 | 21:48:38 (3435), `2 recent death spots` | 21:49:04 (3448) | `64 blocks … at -118, 67, -31` | 26 | death 4 came 2 blocks from here |
| 4 | 21:57:10 (3514), `3 recent death spots` | 21:57:42 (3577) | `64 blocks … at 15, 63, -110` | 31 | 70 blocks from death 3 |
| 5 | 22:28:39 (4318), `1 recent death spot` | 22:29:07 (4339) | `64 blocks … at -123, 63, -63` | 28 | 35 blocks from death 4, 50 from death 2 |
| 6 | 22:36:16 (4563), `2 recent death spots` | 22:36:45 (4582) | `65 blocks … at -123, 63, -64` | 29 | 1 block from escape 5's end |

- Every escape was `try 1 of 3`, `sprinting at least 64 blocks from the spawn and N recent death spots, 1 player zombie near; no digging, no pickups, no fights`. Each one ended in 20 to 31 s.
- The `recent death spots` count went 1, 1, 2, 3, 1, 2; escape 5 counted 1 spot, and its end is 35 blocks from death 4 (21:57:06).

### The club and the weapon lines
- **Crafts:** the agenda weapon step at 20:38:55–20:38:56 (`server.log:90`, `driver.log:203`) and the LLM's `!craftRecipe("spartanweaponry:club_wood", 1)` at 21:59:51 (`driver.log:3757`). No reserve auto-craft line.
- **`[survival] weapon` lines:** 3: `spartanweaponry:club_wood (hunt)` at 20:41:05 and 22:08:47; `dirt (cell)` at 21:38:39 (during the death-2 repair).
- **Hunts with the club:** 2, both `killed`: `animania:sow_old_spot` (20:41:20) and `animania:doe_cottontail` (22:08:51). Two more hunting lines said `no weapon, so no hunt (foraging only)` (21:16:32, 22:36:46).
- **Clubs lost:** in death 1 and death 5.
- **Fights with hostile mobs:** none (`fights: 0`, no `[survival] swing` line). The flees: 10 zombie, 7 `zombie_players:zombie_player`, 2 skeleton, 1 skeleton horse, 1 `mod_lavacow:piranha`, 2 unknown.
- **`[forge-bridge] bettercombat`:** one line, `bettercombat attack: on`. No `hits without a hurt` trip.

### Shelters, repairs and self-seals
- **Shelters reached:** 4: the hole shelter at the spawn (20:51:48), the shelter at -168, 68, -85 (21:31:56), the hole after escape 3 (21:49:15) and the hole at 55, 76, -27 (22:12:16).
- **Self-seals into a side pocket:** 3: 20:52:00, 21:49:27 and 22:12:29, each `the cells behind sealed`.
- **Repairs:** 3, each after `zombie is digging the shelter … checking at once, ready to repair`: 21:04:15 (not closed: zombie in the cell), 21:38:34 (not closed: zombie in the cell) and 21:56:57 (`the repair closed the shelter`, the zombie inside). All with dirt; the repair says `no pickaxe: dirt can be dug out by hand`. No log or plank repair.
- **`the block did not stay (placed twice; now air)`:** 34 lines: 1 in the death-1 repair (21:04:30), 17 at -95, 68, -134 (21:05:58–21:16:31) and 16 at -48, 80, -140 (21:39:27–21:48:09). All 33 retries placed 0 blocks.
- **Retry counts:** 23 `shelter try N of 3 failed`, 13 `the hole shelter failed`, 7 `no shelter after 3 tries and a hole shelter`, 7 `quiet for 60 s: trying a shelter again`, 6 `interrupted by cowardice`.
- **`!placeHere`:** 3: `log:1` placed (20:45:52); `log` failed (21:31:00) and then placed (21:31:05).

### The Scroll of New Life
- One try, at -168, 68, -85 (21:31:58), 130 blocks from the spawn and 131 from death 1 (the only death before it): `not used up (no answer from the server)`. No server line for it.
- Three skips for distance: 0 (20:51:48), 65 (21:49:15) and 97 (22:12:16) blocks from the spawn, each `it needs 100`.

### Food over time
| Time | Food | What happened |
| --- | --- | --- |
| 20:37–20:58 | 20 | day 1 |
| 21:03–21:04 | 18 | night 1 |
| 21:04:30–21:17:30 | 12 | after death 1, no food held |
| 21:18:30–21:22:30 | 11 → 9 | day 2 |
| 21:22:46–21:27:24 | 9 → 13 | 5 eats of foraged food |
| 21:31:58 | 12 → 13 | the leek at sunset 2 |
| 21:38:40–21:57:41 | 12 | night 2, after death 2 |
| 21:58:41–22:08:41 | 11 → 4 | day 3 |
| 22:08:45–22:08:46 | 4 → 7 | 3 wildberries |
| 22:12:03 | 5 | sunset 3, no food held |
| 22:13:41–22:27:42 | 4 → 1 | sealed in the side pocket; 1 from 22:24:42 |
| 22:28:34 | – | starved |
| 22:28:42–22:32:42 | 12 | after death 5 |
| 22:33:42–22:35:42 | 12 → 4 | fleeing in the open |
| 22:36:42 | 12 | after death 6 |

- **The eats:** 9, all from the eating reflex (listed above). `no safe food in the inventory` was logged 139 times.
- **The `low` tag:** only 3 food lines had it (21:04:30, 21:31:56, 21:38:40), all at food 12. The 29 food lines at food 9 or below from 21:59:41 to 22:27:42 were all tagged `(check)`.

### The rest
- **`[craft]`:** 16 lines, all `bot.craft returned after N ms`, from 259 to 3241 ms (20:37:50 to 22:12:06): 486, 310, 259, 3241, 406, 1203, 457, 432, 2448, 1221, 385, 755, 427, 1210, 309 and 1592 ms. No `abandoned craft` line, no `timed out` or stopped line, no table-pickup line.
- **collectBlock pickup or cancel timeouts:** none in the journal. No `MaxListenersExceededWarning` line.
- **Escape from stuck:** the 3 `[escape]` lines at 21:19:32 (above). The unstuck reflex logged `could not move away` twice (21:17:41, 22:08:11) and `still stuck after 10 s` once (21:19:06), each `re-planning instead of a restart`.
- **Walk to better ground:** one, at 21:05:30–21:05:41 (above).
- **Ore skips for a liquid:** none.
- **Parasites:** none.
- **Zombie Awareness:** one scent marker, `- entities: 1 zombieawareness:entityscent(s)` (21:59:55).
- **Process restarts:** none. The journal's only `Agent process exited` line is the stop at 22:37:06 (code 0).

## Server-side notes (not about the bot)
- `server.log` (the runner's copy, 20:36:45 to 22:37:06) has one `Object successfully summoned` line, `[Skeleton: …]` at 20:37:19 (`server.log:53`), a pack command sender as in soaks 8 and 10.
- No crash report, no `Failed to save chunk` and no `Can't keep up!` line in it.

## Step 7 (harness-ops)
- `starts=1` after `up`.
- The world was fresh: 9479 ticks at the read, against at most 12847.
- The release was read from the journal's `[release]` line.
- Only (a) and (d) fail, as for every soak.

## For the owners (not judged here)
**The root-cause analysis is in progress with skills-rotn** (its soak 11 plan). This section only points at the lines above:
- the two repairs with a zombie in the opening (deaths 1 and 2), and the repair that closed the shelter with the zombie in the bot's cell (death 4);
- the 33 shelter retries after escapes 1 and 2 that each failed at one cell with `the block did not stay`, ending in death 3;
- the starvation in the sealed side pocket after sunset 3 at food 5 with no food held;
- the Scroll of New Life try with `no answer from the server`;
- the `recent death spots` count that went back to 1 at escape 5;
- the `(low)` tag, which was on 3 food lines, none of them below 12.

## Soak 10 correction (the #578 review)
`../g4soak-10-20261122/README.md` cited `driver.log:990`–`991` for the day-1 boundary; 990 is `Saved memory to:`, 991 `self prompt loop stopped` and 992 `[night] sunset is near`. It now reads `driver.log:991`–`992`, day 1 `up to driver.log:991` and the sunset row `from driver.log:992`. The sums do not change.

## Files
Each file was made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean.
- `result.json`: the runner's result, with the checks, `notes.samples`, `notes.llmUsage`, `notes.survival`, `notes.deaths` and `g4Acceptance`.
- `run.log`: the runner's stdout (`run.stdout` in the raw folder).
- `server.log`: the test server's log for the run, as the runner fetched it (`latest.log`).
- `driver.log`: the CX23 journal of `mindcraft-rotn@frcfld` from the unit's start to its stop, read through the gate.
- `step7-starts.txt`: `test-server.sh starts` right after `up`, under a header line naming the command, the time and the server.
- `server-lifecycle.txt` contains:
  - the `test-server.sh up` log and `starts`;
  - the header of the since-start log fetched before `down` (`found=1 lines=21404`); the run's part of it is the same as `server.log`;
  - the `test-server.sh down` log, ending `verified gone: server, Primary IPv4 and SSH key`;
  - the hcloud counts saved at the delete: `servers 0`, `primary_ips 0`, `ssh_keys_mcr_test 0` at 22:37:35Z. The 2 in `ssh_keys_total` are the project's permanent non-test keys.
