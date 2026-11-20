# G4 soak 6: `g4-soak-2h` on the CX23 service (2026-11-20)

**Label: the sixth soak, run under the lead's written GO `G4-SOAK-6-20261120`. It is never G4 acceptance evidence.**
- The run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. It FAILED: 8 checks passed and 1 failed (`ate_when_low`, 1 of 9 `low` lines).
- `result.json` marks it not-gate (`gateValid: false`) for two reasons:
  - the S-run reason from #436: "a G4 run on the CX23 service (set-up S) is not an acceptance run";
  - the step-7 runner's reasons: there is no `ROTN_G4_ACCEPT` marker, so conditions (a) and (d) fail. Conditions (b), (c) and (e) hold.
- G4 evidence comes only from the step-7 runs, under their own rules (test/scenarios/g4/PLAN.md).
- **The first soak with no death.** Each of the three nights passed in a closed shelter.
- **Cost:**
  - **Daytime:** USD 0.057/h, above the 0.05 target; all 301 completions came by day.
  - **While the self-prompter ran:** USD 0.080/h.
  - **The 2-hour figure of 0.023 passes** only because the nights, and a 10-minute stretch of day 3 when the self-prompter was stopped, cost nothing (see *The LLM spend*).

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.12` = develop `29b0ce72`, a fresh detached checkout. `npm ci` ran first, then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. It started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-6-20261120:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-6-20261120`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, release `rotn-v0.1.12`, which the lead deployed through the gate. At 17:05 the lead reset FRCFLD's state through the gate (it archived `agenda.json` and `memory.json`). The human confirmed that the env `host` named this test server and that the file is `root:root 600`. After the unit's systemd start (17:12:27), the journal shows: `[release] rotn-v0.1.12-29b0ce72212a` (the harness's commit); `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[state] <bot> at start: tasks=absent agenda=absent memory=absent` |
| Test server | `mcr-test-20261120-170728`, a CPX42 in nbg1. Created 17:07:35, ready 17:10:49, deleted 19:13:18: 125 min, billed about 3 h, EUR 0.4143 plus the IPv4. The watchdog `delete-after` was 2026-11-20T21:07:34Z (TTL 4 h). Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 labelled SSH keys (the servers and IPs counted with `grep -c .`, the keys from the JSON `labels` field). The project's 2 long-standing unlabelled keys stayed |
| Step-7 check | `test-server.sh starts` right after `up`: `starts=1 files=1` (`step7-since-start.txt`) |
| World | The G2/G3/M1 seed `1880465901402976865`, fresh: `world 2263 of at most 5701 ticks` at the step-7 read |
| Server | Firewall: ports 22 and 25565 only from the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 5 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match; 0 extra mods |
| Timing | The scenario ran 17:12:20 to 19:12:55 UTC. **Each join time names its source:** the unit started at **17:12:27** (systemd, `driver.log`). The server logged `<bot> joined the game` at **17:12:38** (`server.log`). The journal shows `Self-prompting started.` at **17:12:41**. The runner's `login_online` passed at **17:12:45** (`run.log`). Next came 120 min of samples every 5 min (25 samples), then the runner's ctl stop. The unit was stopped by 19:12:52 (systemd: `642M memory peak`, 19 min 5 s of CPU in 2 h). Afterwards `status frcfld`, read through the gate, showed `inactive (dead)` and `disabled`. The journal covers the whole soak |

## The measurements
| Measure | Value |
| --- | --- |
| **Peak memory** | **642 MiB** (`MemoryPeak`), target 850. From `notes.samples`: 349 MiB at the join; 455–471 from minute 5 to minute 45.6; 617 at minute 50.7 (`peakMb` 621); 642 at minute 55.7 (the peak); 519–571 in minutes 60.8–86.1; 595 from minute 91.2 to the end. Soak 5: 679 MiB |
| **NRestarts** | **0** at all 25 samples. `ActiveState` was active at every sample |
| **LLM spend** | See the next section |

## The LLM spend (per window)
All figures sum `cost_usd` over the bot's `[openrouter] usage …` lines in `driver.log`: 301 lines, 0 unknown, USD 0.045424 in total. The first usage line is at 17:12:42 and the last at 18:40:58.

| Measure (which window) | Minutes | Completions | USD per hour |
| --- | --- | --- | --- |
| **Overall**: the runner's 120-min soak (`usd_per_hour`, PASS) | 120 | 301 | **0.0227** |
| **Daytime**: from the join or each `[night] morning` line to the next `[night] sunset is near` line. Every completion falls in one of these windows | 47.8 | 301 | **0.0571** (above 0.05) |
| – day 1: 17:12:41 (join) to 17:27:14 | 14.6 | 129 | 0.081 |
| – day 2: 17:52:49 to 18:07:07 | 14.3 | 133 | 0.083 |
| – day 3: 18:32:43 to 18:51:24 | 18.7 | 39 | 0.019 |
| – day 4: the morning line at 19:12:38, 13 s before the stop | 0.2 | 0 | – |
| **While self-prompting**: from each `Self-prompting started.` to the `self prompt loop stopped` after which it did not start again within 2 s | 34.1 | 301 | **0.0799** |
| – 17:12:41 to 17:27:14 (sunset) | 14.6 | 129 | 0.081 |
| – 17:52:50 to 18:03:42 | 10.9 | 133 | 0.109 |
| – 18:32:44 to 18:41:26 | 8.7 | 39 | 0.041 |

- **Nights:** each measured from its `sunset is near` line to its `morning` line: 25.6 min (17:27:14–17:52:49), 25.6 min (18:07:07–18:32:43) and 21.2 min (18:51:24–19:12:38). That is 72.4 min with no LLM call.
- **Daytime without the self-prompter:** 13.4 min, with no call either:
  - 3.4 min on day 2: the loop stopped at 18:03:42, before the 18:07:07 sunset (see *What happened*);
  - 10.0 min on day 3: it stopped at 18:41:26, before the 18:51:24 sunset.
- So of the 120 min, the bot self-prompted for 34.1. At that rate (8.8 completions per minute) a bot that works all day would spend about USD 0.08/h. Soak 5's daytime rate was USD 0.064/h.

## The checks (`result.json`)
| Check | Result |
| --- | --- |
| `login_online` | PASS: joined (the runner's check at 17:12:45), version-4 UUID |
| `naming` (#2) | PASS: `[naming] <bot> near spawn: 16 kinds; unknown 0` (`dirt`, `undergroundbiomes:sedimentary_stone`, `dynamictrees:trunkshell`, …, three `pyrotech_compat:rock_*`). Entities at +120 s: 3 kinds, unknown 0 (`zombieawareness:entityscent`, `animania:piglet_large_white`, `animania:sow_large_white`). This time the bot spawned on the ground (soak 5: in a tree, 2 kinds) |
| `no_crash` (#7) | PASS: 120 min up, 25 samples, NRestarts 0 throughout, no agent exit |
| `peak_memory` (#7) | PASS: 642 MiB (target 850) |
| `usd_per_hour` (#7) | PASS: USD 0.022693/h overall (target 0.05). It was USD 0.057/h by day and 0.080/h while self-prompting; see above |
| `agenda_done` (#4) | PASS: `agenda done` in chat at 17:52:56, 40.3 min after the server's join line. The last step, stone_axe, started at 17:24:03, ran across night 1, and was done 7 s after the morning |
| `food_floor` (#5) | PASS: lowest food 10 (floor 6), over 124 food lines |
| `ate_when_low` (#5) | **FAIL**: 1 of 9 `low` food lines had no eat within 5 food lines after it (below) |
| `deaths_reported` (#5, as #6) | PASS: no death. `server.log` has no death line, so there are no killers to list |

## What happened
Sources: the bot's `[survival]`, `[night]` and `[reflex]` lines in `driver.log`, and agenda lines from `server.log`.

- **Day 1 (17:12–17:27): the agenda reached its last step, stone_axe.** In chat:
  - rocks done 17:13:13, sticks 17:14:37, crude_axe 17:14:43, logs 17:15:13;
  - the food step `stuck: 5 min of self-prompting; going on without it for 10 min` at 17:21:16;
  - then first_plank 17:21:39, crafting_tools 17:21:44, crafting_table 17:22:01, planks_sticks 17:22:14, stone_pickaxe 17:22:18 and cobblestone 17:24:03;
  - stone_axe started at 17:24:03 and was not done by sunset.
- **Night 1 (17:27–17:52):**
  - 17:27:14: `sunset is near`, with `food worth 7 hunger held, food 20; enough`.
  - It was in a shelter from 17:27:14, and the morning line came at 17:52:49 (`dug out of the shelter`).
  - `agenda done` came at 17:52:56.
- **Day 2 (17:52–18:07):**
  - The standing goal re-ran the food step; it was `stuck` again at 17:58:17.
  - The bot ate at once after the `low` line at 18:02:08.
  - It stocked cobblestone and planned a stone sword (`!getCraftingPlan("stone_sword", 1)` at 18:03:38).
  - At 18:03:40 the LLM answered `!craftRecipe("pyrotech:tinder", 3)`. **At 18:03:42 the journal shows `self prompt loop stopped`, with no `parsed command` line for that craft and no reason given.** It did not start again before the sunset at 18:07:07, so 3.4 min of day went unused.
- **Night 2 (18:07–18:32):**
  - 18:07:07: `food worth 11 hunger held, food 13; enough`; in the shelter at 18:07:12.
  - The eating reflex answered each of the four `low` lines that night within 2 s: persimmon, persimmon, scallion, spice leaf.
  - The morning line came at 18:32:43.
- **Day 3 (18:32–18:51): an eel kept the bot busy in the water for 10 min, with the self-prompter stopped.**
  - From 18:39:03 to 18:51:11 the bot fought a `betteranimalsplus:eel_freshwater` 26 times: every `fight start` of the soak. 25 fights ended `interrupted`, 1 `stopped`.
  - At 18:40:53 the reflex reported `under water with 15 of 20 air: stopping and swimming up`.
  - At 18:41:21 the unstuck reflex took over (`I'm stuck!`). **At 18:41:26 the self-prompter stopped and did not start again before the end of the soak.**
  - From 18:41 to 18:51 there was a loop: self-defence against the eel, then an unstuck `Moved away from … to …`, 21 such moves between 18:41:27 and 18:51:00, about one every 30 s, all inside x 45–59, z -142 to -153, at y 61–65. From 18:44:42 to 18:49:29 the same move repeated 11 times: `Moved away from (49, 62, -147) to (45, 62, -151)`, and each time the bot was back at (49, 62, -147) for the next one.
  - At 18:47:07 came `[reflex] re-plan prompt held: it is not full day yet; it goes once at full day`.
  - It ended with `flee betteranimalsplus:eel_freshwater (outnumbered)` at 18:51:11 and `Moved 16 away from enemies`. Sunset came at 18:51:24.
  - The eel did no damage. The only `hurt` line of the soak is `hurt 4 health 20->16 (by unknown)` at 17:54:56. Its `hurt-detail` line: four 1-point drops over 1.6 s, `cause none near none`. Health was 20 on every other line.
- **Night 3 (18:51 to the end):**
  - 18:51:24: `food worth 15 hunger held, food 13; enough`; in the shelter at 18:51:25.
  - The reflex ate within 2 s of the `low` lines at 18:58:22 and 19:06:12.
  - At 19:12:38 came `morning: a zombie at 59, 72, -134 is within 8 blocks of the shelter …; staying in until it leaves (checking every 30 s, at most 2 min)`. The run stopped 13 s later.
  - No shelter was opened or dug into on any night.
- **Food.**
  - The 9 `low` lines were all `food 12 health 20 (low)`: at 18:02:08, 18:08:42, 18:16:33, 18:24:23, 18:32:14, 18:36:51, 18:41:12, 18:58:22 and 19:06:12.
  - After 8 of them the bot ate within 16 s.
  - **The failure is 18:41:12, inside the eel loop.** Food read 12, 11 (18:44:12) and 10 (18:47:12) before the eating reflex ate ginseng at 18:49:30 (`ate rustic:ginseng:0 at food 10`), 8 min 18 s after the `low` line. That is also the soak's lowest food, 10.
  - There were 13 eats in all.

## Step 7 (harness-ops)
- **Condition (e) passed:** `fresh: no earlier run, join or scenario; started once; world 2263 of at most 5701 ticks`, read through `log … since-start`.
- The raw answer of `test-server.sh log 200000 since-start` was fetched at the end of the run, before the delete, and is not committed. Its header, start line, `Done` line and end line are in `step7-since-start.txt`:
  ```
  ##rotn-test since-start files=latest.log found=1 lines=21230 over=0 nonempty=21222
  2:[17:08:57] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Starting minecraft server version 1.12.2
  20200:[17:10:27] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Done (19.094s)! For help, type "help" or "?"
  ##rotn-test end
  ```
  - Line numbers are lines of that answer; line 1 is the header.
  - Startup wrote 20,198 lines between the start line and `Done` (soak 5: 20,208).
  - The whole log from the start line on was 21,230 lines, within the 200,000-line bound.

## For the owners (not judged here)
- **lead (cost): the working rate is still above the ADR 0010 target.** While self-prompting, the bot spent USD 0.080/h (8.8 completions per minute); over all daytime it was USD 0.057/h. The 2-hour check passes (0.023) because 72 min were night and 13 min of day had no self-prompter. If the target is meant for working time, this run fails it, by more than soak 5 (0.064 by day).
- **skills-rotn: the self-prompter stopped twice by day with no restart before the night.**
  - At 18:03:42, right after the LLM answered `!craftRecipe("pyrotech:tinder", 3)`: no `parsed command` line followed, and no reason was logged.
  - At 18:41:26, during the eel loop, and it never restarted: the re-plan prompt was `held: it is not full day yet` at 18:47:07.
- **skills-rotn: an eel in the water holds the bot in a loop.** Self-defence and unstuck took turns for 10 min (26 fights, all interrupted or stopped; 21 unstuck moves, 11 of them the same move from (49, 62, -147)). The bot did not eat until food 10, and nothing broke the loop until the flee at 18:51:11. The eel never hurt it.
- **skills-rotn: the food step got `stuck` twice again** (17:21:16 and 17:58:17), as in soak 5.
- **skills-rotn (logging, for #502's new line):** the one `hurt-detail` of the soak says `cause none near none` for 4 points over 1.6 s at full air. The source is still unknown.

## Files
Each file was made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean.
- `result.json`: the runner's result, with the checks, `notes.samples`, `notes.llmUsage`, `notes.survival` and `g4Acceptance`.
- `run.log`: the runner's stdout (`run-stdout.log` in the raw folder).
- `server.log`: the test server's log for the run, as the runner fetched it.
- `driver.log`: the CX23 journal of `mindcraft-rotn@frcfld` from the unit's start to its stop, read through the gate.
- `step7-since-start.txt`: `test-server.sh starts` right after `up`, and the header, start, `Done` and end lines of `test-server.sh log 200000 since-start`.
