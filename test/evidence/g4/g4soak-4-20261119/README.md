# G4 soak 4: `g4-soak-2h` on the CX23 service (2026-11-19)

**Label: the fourth soak, under the lead's written GO `G4-SOAK-4-20261119`. It is never G4 acceptance evidence.**
- This run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. It FAILED: 8 checks passed and 1 failed.
- `result.json` marks it not-gate (`gateValid: false`) with two reasons:
  - the S-run reason from #436: "a G4 run on the CX23 service (set-up S) is not an acceptance run";
  - the step-7 runner's (#446) reasons: no `ROTN_G4_ACCEPT` marker, so (a) and (d) fail.
  - (b), (c) and (e) hold. **(e) passed on the live pack for the first time** (below: *Step 7: (e) on the live pack*).
- G4 evidence comes only from the step-7 runs, under their own rules (test/scenarios/g4/PLAN.md).
- **Read the passes with care.** The bot worked for its first 11 minutes, then sat in its shelter for the last 106. The memory, spend, deaths and food checks therefore measure a bot that was idle for most of the soak (below: *What happened*).

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | tag `rotn-v0.1.7` = develop `d6a34e9b`, a fresh detached checkout. `npm ci` ran first, then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. The run started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-4-20261119:frcfld:test-server-host-confirmed`. `result.json`: `service.goId` is `G4-SOAK-4-20261119`, with no start error, no incident and no unknown state |
| The bot | the CX23 unit `mindcraft-rotn@frcfld`. The human deployed `rotn-v0.1.7`, reset FRCFLD's state (only action-code, histories and `last_profile.json` remained) and confirmed the env `host` was this test server. Its journal after the unit's systemd start (11:07:59) says: `[release] rotn-v0.1.7-d6a34e9bdd47` (the harness's commit); `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[state] <bot> at start: tasks=absent agenda=absent memory=absent` |
| Test server | `mcr-test-20261119-105229`, CPX42 nbg1. Created 10:52:36, ready 10:57:11, deleted 13:09:09 (136 min, billed about 3 h: EUR 0.4143 plus the IPv4). Watchdog `delete-after` was 2026-11-19T14:52:35Z (TTL 4 h). Afterwards: 0 servers, 0 Primary IPs and 0 labelled keys, counted with `grep -c .` |
| Step-7 rehearsal check | `test-server.sh starts` right after `up`: `starts=1 files=1` on the live pack (the PLAN step 7 checklist) |
| World | the G2/G3/M1 seed `1880465901402976865`, fresh (`world 13180 of at most 18306 ticks` at the step-7 read) |
| Server | firewall 22 and 25565 only from the CX23 and the dev server; online mode; whitelist `<bot>,JQDAW` (the script's default, with `ROTN_TEST_WHITELIST` unset; the same `up` flags as soak 3) |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match; 0 extra mods |
| Timing | The scenario ran 11:07:51 to 13:08:26 UTC. The bot joined at 11:08:16, then came 120 min of samples every 5 min (25 samples), then the runner's ctl stop at 13:08:23. Afterwards the unit was `inactive (dead)` and `disabled` (`status frcfld`, read through the gate). The journal covers 120.1 of 120.1 min. The test server had been up about 11 min before the join |

## The measurements
| Measure | Value |
| --- | --- |
| **Peak memory** | **467 MiB** (`MemoryPeak`), target 850. Memory was 351 MiB at the join, 406 at minute 5 and 465 at minute 10, then 466–467 to the end (`notes.samples`). The flat line matches the idle bot. Soak 3: 518 MiB; soak 2: 622 |
| **NRestarts** | **0** at all 25 samples; `ActiveState` was active at every sample |
| **LLM spend** | **USD 0.007878 per hour** over the soak, target 0.05: USD 0.015769, the sum of `cost_usd` over 103 `[openrouter] usage …` lines, 0 unknown. **Every completion came between 11:08:15 and 11:19:28** (11.2 min), which is **about USD 0.084 per hour while the bot was working**, above the target. Soak 3: USD 0.0089/h over 117 completions in 120 min |

## The checks (`result.json`)
| Check | Result |
| --- | --- |
| `login_online` | PASS: joined at 11:08:16, version-4 UUID |
| `naming` (#2) | PASS: `[naming] <bot> near spawn: 3 kinds; unknown 0` (`dynamictrees:leaves0`, `sprucebranch`, `trunkshell`); entities: 2 kinds (`animania:toad`, `zombieawareness:entityscent`), unknown 0 |
| `no_crash` (#7) | PASS: 120 min up, 25 samples, NRestarts 0 throughout, no agent exit |
| `peak_memory` (#7) | PASS: 467 MiB (target 850) |
| `usd_per_hour` (#7) | PASS: USD 0.007878/h (target 0.05); see the spend note above |
| `agenda_done` (#4) | **PASS**: `agenda done` in chat at 11:19:24, 11 min after the join. The first soak where it passed |
| `food_floor` (#5) | PASS: lowest food 7 (floor 6), over 121 food lines |
| `ate_when_low` (#5) | **FAIL**: 1 of 1 `low` food lines had no eat within 5 food lines (below) |
| `deaths_reported` (#5, as #6) | PASS: no death |

## What happened (the bot's own `[survival]`, `[night]` and `[reflex]` lines, `driver.log`; agenda lines from `server.log`)
- **The agenda finished in 11 minutes.** In chat, from the join (11:08:13) to `agenda done` (11:19:24):
  - rocks (done 11:09:32), sticks (11:10:04), crude_axe (11:10:08), logs (11:10:47), first_plank (11:15:11), crafting_tools (11:15:24), crafting_table (11:15:41), planks_sticks (11:15:58), stone_pickaxe (11:16:05), cobblestone (11:18:58) and stone_axe (11:19:24);
  - the steps shelter_blocks, weapon and food each logged `started` (shelter_blocks and weapon twice) but no `done` line before `agenda done`.
  - From 11:11:26 to 11:14:59 the LLM said several times that the bread it held "should satisfy" the food step, while the agenda stayed on it. It then foraged a `harvestcraft:shadedgarden` 3 times (`got food`); a hunt of an `animania:sow_large_white` was `stuck (left alone for 5 min)`.
  - 0 fights, 0 flees, 0 deaths over the soak. The `[survival]` health stayed at 20 on every line.
- **The self-prompter stopped 6 s after `agenda done` and did not start again.** `self prompt loop stopped` came at 11:19:30, right after `!equip("stone_axe")`. There is no `Self-prompting started` after it, and no LLM call: the last `[openrouter] usage` line is at 11:19:28.
- **The bot stayed in its shelter for the last 106 minutes.**
  - 11:22:38 `sunset is near: building a shelter`; `food for the night: food worth 8 hunger held, food 20; enough`; 11:22:39 `in the shelter at -59, 65, -82 until morning`.
  - From the morning at 11:48:11, every 30 s: `morning: a zombie at -58, 65, -81 is within 8 blocks of the shelter at -59, 65, -82; staying in until it leaves`. The zombie is 1 block from the shelter and its position never changed: 59 such lines over three mornings (11:48–12:02, 12:28–12:42, and 13:08:11).
  - At the end of each day: `warning: a zombie at -58, 65, -81 is still within 8 blocks … at the end of the day (waited 14 min); staying in it for the night` (12:02:38 and 12:42:38).
  - The bot never came out, and nothing hurt it.
- **Food.**
  - One `low` line: `food 12 health 20 (low)` at 11:56:59. The eating reflex ate only at food 6, six times from 12:20:33: zucchini, sweet potato, jute, white mushroom, garlic, then the bread at 12:59:46 (`food 6->9`). The other five each gave 6->7.
  - So `ate_when_low` failed: the reflex ate 24 min after the `low` line, not within 5 food lines.
  - As in soak 3, `low` fires at 12 and the reflex eats at 6. `food_floor` passed only because the reflex eats at 6 and the floor is 6; from 12:20 to the end the `check` lines read 7 or 9, and 6 only on the eat lines.

## Step 7: (e) on the live pack (harness-ops)
- **(e) passed:** `fresh: no earlier run, join or scenario; started once; world 13180 of at most 18306 ticks`. The read from the start line on (#465, #466, #469) worked on a real server. In soak 3, the old 20,000-line tail failed (e).
- **The startup is again over 20,000 lines.** I kept the raw answer of `test-server.sh log 200000 since-start` (not committed), fetched at the end of the run, before the server was deleted:
  ```
  ##rotn-test since-start files=latest.log found=1 lines=21038 over=0 nonempty=21030
  2:[10:55:18] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Starting minecraft server version 1.12.2
  20238:[10:56:52] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Done (19.761s)! For help, type "help" or "?"
  ```
  - The numbers are lines of that answer, where line 1 is the header. Startup wrote 20,236 lines between the start line and `Done`. At the end of the run, the whole log from the start line on was 21,038 lines, within the 200,000-line bound.
  - The answer ended with `##rotn-test end`.

## For the owners (not judged here)
- **skills-rotn: after `agenda done`, the bot has no goal.** The self-prompter stopped 6 s after `agenda done` and never restarted. That may be by design, but it left the bot idle for the last 109 minutes: no LLM call, no food or other work.
- **skills-rotn: the morning wait never ends when a zombie does not move.** The zombie sat 1 block from the shelter for at least 80 minutes (11:48 to 13:08), and the morning check waited 14 minutes each day and then stayed in for the night. The bot spent two whole days in the shelter. Nothing in the log shows whether that zombie could reach the bot.
- **skills-rotn: food `low` at 12 vs the reflex at 6.** The same as soak 3. `ate_when_low` fails while the bot holds food, because the `low` line comes at 12 and the eating reflex waits until 6.
- **skills-rotn: the food step and the held bread.** For 3.5 minutes the LLM read the bread it held as meeting the food step, but the agenda stayed on it. It moved on only after more food was foraged.
- **lead (cost): the spend check passed on an idle bot.** At the working rate of this run (103 completions in 11.2 min, about 9 per minute), a bot that keeps working would spend about USD 0.084 per hour, above the ADR 0010 target of 0.05. Soak 3's bot made about 2 per minute: 115 completions in the 53 minutes before its self-prompter stopped. The 2-hour figure here does not show the cost of a bot that works the whole soak.
