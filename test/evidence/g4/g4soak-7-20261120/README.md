# G4 soak 7: `g4-soak-2h` on the CX23 service (2026-11-20/21)

**Label: the seventh soak, run under the lead's written GO `G4-SOAK-7-20261120`. It is never G4 acceptance evidence.**
- The run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. It FAILED: 8 checks passed and 1 failed (`ate_when_low`, 1 of 9 `low` lines).
- `result.json` marks it not-gate (`gateValid: false`) for two reasons:
  - the S-run reason from #436: "a G4 run on the CX23 service (set-up S) is not an acceptance run";
  - the step-7 runner's reasons: there is no `ROTN_G4_ACCEPT` marker, so conditions (a) and (d) fail. Conditions (b), (c) and (e) hold.
- G4 evidence comes only from the step-7 runs, under their own rules (test/scenarios/g4/PLAN.md).
- **The agenda was done 12.4 min after the join**, the fastest of the soaks (soak 6: 40.3 min).
- **One death, by day:** on the first morning the bot opened its shelter to fight a zombie that had waited by it for 2 min, and was slain by it (23:24:33).
- **The failed `low` line came right after that death:** the bot had respawned with food 12 and no food in its inventory. Its next food was foraged 5 min 48 s later. Food never went below 12.
- **Cost:**
  - **Daytime:** USD 0.091/h, above the 0.05 target; all 263 completions came by day.
  - **While self-prompting:** USD 0.098/h.
  - **The 2-hour figure of 0.034 passes** only because the nights (75.3 min) made no call.
  - **Each completion cost 70% more than in soak 6** (USD 0.000257 against 0.000151). The bot wrote about as much text (46,724 characters against 50,303), but the provider billed 5.2 times the completion tokens (176,595 against 34,013). The profile and the model code did not change between the two tags. See *The LLM spend*.
- **Soak 6's budget-stop items are fixed in this release:** the stop now writes a console line, and the command of the turn in flight still runs (23:35:18–23:35:24).

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.13` = develop `9955b0f4`, a fresh detached checkout. `npm ci` ran first, then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. It started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-7-20261120:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-7-20261120`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, release `rotn-v0.1.13`, which the lead deployed through the gate. At 22:30 the lead reset FRCFLD's state through the gate (it archived `agenda.json` and `memory.json`). The human confirmed that the env `host` named this test server and that the file is `root:root 600`. After the unit's systemd start (22:42:07), the journal shows: `[release] rotn-v0.1.13-9955b0f48803` (the harness's commit); `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[state] <bot> at start: tasks=absent agenda=absent memory=absent` |
| Test server | `mcr-test-20261120-223243`, a CPX42 in nbg1. Created 22:32:50, ready 22:36:35, deleted 00:43:02: 130 min, billed about 3 h, EUR 0.4143 plus the IPv4. The watchdog `delete-after` was 2026-11-21T02:32:50Z (TTL 4 h). Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 labelled SSH keys (the servers and IPs counted with `grep -c .`, the keys from the JSON `labels` field) |
| Step-7 check | `test-server.sh starts` right after `up`: `starts=1 files=1` (`step7-since-start.txt`) |
| World | The G2/G3/M1 seed `1880465901402976865`, fresh: `world 6603 of at most 10981 ticks` at the step-7 read |
| Server | Firewall: ports 22 and 25565 only from the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 6 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match; 0 extra mods |
| Timing | The scenario ran 22:42:00 to 00:42:35 UTC. **Each join time names its source:** the unit started at **22:42:07** (systemd, `driver.log`). The server logged `<bot> joined the game` at **22:42:18** (`server.log`). The journal shows `Self-prompting started.` at **22:42:21**. The runner's `login_online` passed at **22:42:24** (`run.log`). Next came 120 min of samples every 5 min (25 samples), then the runner's ctl stop. The unit was stopped by 00:42:32 (systemd: `585.4M memory peak`, 15 min 10 s of CPU in 2 h). Afterwards `status frcfld`, read through the gate, showed `inactive (dead)` and `disabled`. The journal covers the whole soak (`journalCoverage`: 120.1 of 120.1 min) |
| Midnight | The first soak to run across midnight UTC. The server's log rolled over at 00:00, so the runner read `2026-11-20-1.log.gz` and `latest.log` (`server.log: the marker was rolled over; saved from 2026-11-20-1.log.gz, latest.log`). The saved `server.log` runs on without a gap from 23:59:46 to 00:00:31 |

## The measurements
| Measure | Value |
| --- | --- |
| **Peak memory** | **585 MiB** (`MemoryPeak`), target 850. From `notes.samples`: 364 MiB at the join; 470–527 from minute 5 to minute 40.5; 583 at minute 45.6; the peak of 585 came between minutes 45.6 and 50.7 (`peakMb` 585 at minute 50.7, which reads 506); 532–577 in minutes 55.7–86.1; 574–575 from minute 91.2 to the end. Soak 6: 642 MiB |
| **NRestarts** | **0** at all 25 samples. `ActiveState` was active at every sample |
| **LLM spend** | See the next section |

## The LLM spend (per window)
All figures sum `cost_usd` over the bot's `[openrouter] usage …` lines in `driver.log`: 263 lines, 0 unknown, USD 0.067579 in total. The first usage line is at 22:42:22 and the last at 00:18:00.

| Measure (which window) | Minutes | Completions | USD per hour |
| --- | --- | --- | --- |
| **Overall**: the runner's 120-min soak (`usd_per_hour`, PASS) | 120 | 263 | **0.0338** |
| **Daytime**: from the join or each `[night] morning` line to the next `[night] sunset is near` line. Every completion falls in one of these windows | 44.8 | 263 | **0.0906** (above 0.05) |
| – day 1: 22:42:21 (join) to 22:57:01 | 14.7 | 138 | 0.085 |
| – day 2: 23:22:19 to 23:36:46 (the death at 23:24:33; the standing goal's budget ran out at 23:35:18) | 14.4 | 68 | 0.077 |
| – day 3: 00:02:23 to 00:18:01 | 15.6 | 57 | 0.109 |
| – day 4: the morning line at 00:42:25, 7 s before the stop | 0.1 | 0 | – |
| **While self-prompting**: from each `Self-prompting started.` to the `self prompt loop stopped` after which it did not start again within 2 s | 40.4 | 262 | **0.0984** |
| – 22:42:21 to 22:57:01 (sunset) | 14.7 | 138 | 0.085 |
| – 23:24:49 (after the respawn) to 23:35:24 (the budget stop) | 10.6 | 68 | 0.105 |
| – 00:02:23 to 00:10:50 | 8.4 | 37 | 0.112 |
| – 00:11:24 to 00:18:00 (sunset) | 6.6 | 19 | 0.103 |

- **Nights:** each measured from its `sunset is near` line to its `morning` line: 25.3 min (22:57:01–23:22:19), 25.6 min (23:36:46–00:02:23) and 24.4 min (00:18:01–00:42:25). That is 75.3 min with no LLM call.
- **Daytime without the self-prompter: 4.4 min.** The one completion outside the self-prompting windows is a memory summary at 00:11:15. The 4.4 min are:
  - 23:22:19 to 23:24:49 (2.5 min): the morning wait for the zombie, the fight, the death and the respawn walk;
  - 23:35:24 to 23:36:46 (1.4 min): **the standing goal's daily budget.** It started at 23:30:18 (`agenda standing goal started (day 1)`, `server.log`). At 23:35:18 the journal now shows `[agenda] standing goal budget spent: 5 min of self-prompting for day 1; the self-prompter stops after the turn in flight (its command still runs)`. The `!goToCoordinates(65, 72, -75, 2)` parsed at 23:35:15 ran to its end (23:35:24), then `[self-prompt] stopping after the turn …`, then `self prompt loop stopped`. `server.log` line 810 (23:35:24) has the chat line `agenda standing goal: its 5 min of self-prompting for day 1 are spent; none until the next day`;
  - 00:10:50 to 00:11:24 (0.6 min): after the eel fight.
- **The budget barely mattered this time.** The standing goal ran only after `agenda done` (22:54:47, `day 0`, until the sunset), on day 2 after the re-opened steps (23:30:18–23:35:24), and on day 3 between food-step runs (00:07:50–00:10:03 and 00:16:33–00:18:00, under 5 min, so no stop). Most daytime self-prompting was agenda steps, which the budget does not limit. So the day rates here are close to the self-prompting rate.
- **Why each completion costs more.** All 263 completions went to provider `Wafer` through the profile's model `openrouter/@preset/glm-5-3-flash-cheap-reliable`, as in soak 6 (301, all `Wafer`). `git diff 29b0ce72 9955b0f4 -- profiles src/models` is empty.

  | | Soak 6 | Soak 7 |
  | --- | --- | --- |
  | Completions | 301 | 263 |
  | Prompt tokens per completion | 3,109 | 3,186 |
  | Completion tokens per completion | 113 | 671 |
  | Completion tokens in all | 34,013 | 176,595 |
  | Characters of content in all (`[openrouter] provider … content N chars`) | 50,303 | 46,724 |
  | Characters per completion token | 1.48 | 0.26 |
  | USD per completion | 0.000151 | 0.000257 |
  | Memory summaries (prompt under 2,000 tokens): count, USD, completion tokens each | 78, 0.004718, 186 | 69, 0.023802, 1,724 |
  | Other completions: count, USD, completion tokens each | 223, 0.040706, 87 | 194, 0.043777, 297 |
  | Completions over 1,000 completion tokens | 0 | 38 (USD 0.027194) |

  The content is about the same; the billed completion tokens are 5.2 times as many. That fits hidden reasoning tokens. This is an inference: the log does not show reasoning text. The largest is 14,322 completion tokens; 23:25:49 is typical: content 86 characters, 2,118 completion tokens. The preset's settings live on OpenRouter, not in the repo. The memory summaries are 26% of the completions and 35% of the spend.
- Of the 120 min, the bot self-prompted for 40.4, at 6.5 completions per minute (soak 6: 8.8). Soak 6's rates were 0.057/h by day and 0.080/h while self-prompting.

## The checks (`result.json`)
| Check | Result |
| --- | --- |
| `login_online` | PASS: joined (the runner's check at 22:42:24), version-4 UUID |
| `naming` (#2) | PASS: `[naming] <bot> near spawn: 17 kinds; unknown 0` (`dirt`, `undergroundbiomes:metamorphic_stone`, `grass`, …, `pyrotech_compat:rock_metamorphic`, `osv:simpleores_tin_ore_undergroundbiomes_metamorphic_stone_6`). Entities at +120 s: 1 kind, unknown 0 (`zombieawareness:entityscent`) |
| `no_crash` (#7) | PASS: 120 min up, 25 samples, NRestarts 0 throughout, no agent exit |
| `peak_memory` (#7) | PASS: 585 MiB (target 850) |
| `usd_per_hour` (#7) | PASS: USD 0.033759/h overall (target 0.05). It was USD 0.091/h by day and 0.098/h while self-prompting; see above |
| `agenda_done` (#4) | PASS: `agenda done` in chat at 22:54:42, 12.4 min after the server's join line |
| `food_floor` (#5) | PASS: lowest food 12 (floor 6), over 124 food lines |
| `ate_when_low` (#5) | **FAIL**: 1 of 9 `low` food lines had no eat within the 5 food lines after it (below) |
| `deaths_reported` (#5, as #6) | PASS: 1 death, reported. The journal has 1 (`[death] died at -44, 80, -122` at 23:24:33, with its `lost …` line at 23:24:40). The chat has 1 report (`I died at -44, 80, -122; lost …` at 23:24:40). **Killer** (`server.log` line 669, 23:24:33): `<bot> was slain by Zombie` |

## What happened
Sources: the bot's `[survival]`, `[night]`, `[reflex]`, `[death]` and `[respawn]` lines in `driver.log`, and agenda lines from `server.log`.

- **Day 1 (22:42–22:57): the whole agenda in 12.4 min.** In chat:
  - rocks done 22:43:03; then shelter_blocks, weapon and food started in turn; crude_axe done 22:45:33;
  - sticks and logs done 22:51:38, first_plank 22:52:13, crafting_tools 22:52:19, crafting_table 22:52:45, planks_sticks 22:52:58, stone_pickaxe 22:53:06, cobblestone 22:54:32, stone_axe 22:54:42;
  - `agenda done` at 22:54:42; the standing goal started at 22:54:47 (`day 0`).
  - At 22:47:43 the unstuck reflex could not move away (`no floor under the start cell -121, 64, -33 or next to it`) and asked for a re-plan.
- **Night 1 (22:57–23:22):** `sunset is near` at 22:57:01, with `food worth 11 hunger held, food 20; enough`; in the shelter at -44, 80, -122 at 22:57:07.
- **The first morning: the death (23:22–23:25).**
  - 23:22:19: `morning: a zombie at -45, 80, -123 is within 8 blocks of the shelter …; staying in until it leaves (checking every 30 s, at most 2 min)`, repeated four times.
  - 23:24:19: `after 120 s a zombie at -45, 80, -123 has not moved; health 20, holds nothing, helmet chainmail_helmet, sky light 11`. The same second: `armed, health 20, one zombie near: opening the wall toward a zombie at -45, 80, -123 to fight it from the shelter`. The bot held nothing, but its inventory had `pyrotech:crude_axe` and `stone_axe` (both are in the death's `lost` list).
  - 23:24:23: `opened the west wall (-45, 81, -122 and -45, 80, -122)`; `fight start zombie (shelter)` at 23:24:24.
  - 23:24:26: `hurt 6 health 20->14 (by zombie)`. The `hurt-detail` shows two 3-point drops 0.9 s apart (two hits summed in the 2-s hurt window), `near zombie@0.8m`.
  - 23:24:27: `fight end zombie capped after 4 s`. 23:24:28: `ate between fights in the shelter (health 14, food 13 -> 13)`, then `Fought from inside the shelter: 6 swings, stopped: 4 hits did not hurt the zombie.`
  - 23:24:28: **the leave line:** `health 11 in the fight: leaving the shelter at -44, 80, -122 by the side away from a zombie at -44, 80, -122`. The zombie's position is the shelter's own cell, so it was inside the shelter by then. "Away from" it gave no real direction.
  - 23:24:30: `hurt 6 health 11->5 (by zombie)`, again two 3-point hits. 23:24:33: `[death] died at -44, 80, -122`; `server.log`: `<bot> was slain by Zombie`.
  - The respawn: `moving at least 48 blocks from the spawn and 1 recent death spot` (23:24:38), and `now 53 blocks from the spawn …; the agenda resumes` (23:24:49).
  - The `lost` list has 26 kinds of items, among them both axes and `stone_pickaxe:24`, the food and all 80 dirt piles. The agenda re-opened shelter_blocks (23:24:49), weapon (23:26:23) and food (23:27:21).
- **Day 2 (23:25–23:36):**
  - The bot rebuilt: 10 cobblestone (23:26:24), a crude axe (23:27:26), food foraged (ginseng at 23:30:26, `shadedgarden` at -25, 86, -129).
  - The standing goal (day 1) ran 23:30:18 to its budget stop at 23:35:18/24 (see *The LLM spend*).
  - The unstuck reflex took over twice: 23:33:43, interrupting `moveAway`, and 23:34:37, interrupting `goToCoordinates`.
- **Night 2 (23:36–00:02):**
  - 23:36:46: `food worth 11 hunger held, food 13; enough`; in the shelter at 59, 68, -74 at 23:36:49.
  - The reflex ate within 2 s of the `low` lines at 23:48:50 and 23:56:41.
  - Morning: `dig out: not the west side (no free cell within 3 blocks)` (00:02:18), then `dug out of the shelter at 60, 68, -74; back to work` (00:02:23).
- **Day 3 (00:02–00:18):**
  - The food step ran again (00:02:23), and shelter_blocks (00:04:50). The standing goal (day 2) started at 00:07:50.
  - **The eels:** at 00:09:50, after `!entities` showed `2 betteranimalsplus:eel_freshwater(s)`, the LLM chose `!attack("betteranimalsplus:eel_freshwater")`.
    - `under water with 15 of 20 air: stopping and swimming up`; self_preservation interrupted the attack.
    - Two eel hits: `hurt 5 health 20->15` (00:09:55) and `hurt 5 health 15->10` (00:09:56).
    - The reflex ate at food 12 (00:09:56), then `flee betteranimalsplus:eel_freshwater (outnumbered)` and `Moved 16 away from enemies`. The LLM then said `Two eels vs me at half health is a bad fight. Backing off: !moveAway(10)`.
    - There was no loop this time: no `fight start` against an eel (the soak's only one is the shelter fight), and no unstuck move after 00:08:34.
  - At 00:09:57 the food step came back. It was `stuck: 5 min of self-prompting; going on without it for 10 min` at 00:15:35. The standing goal ran again from 00:16:33.
  - 00:17:46: `[night] stopping the running command to build a shelter`.
- **Night 3 (00:18 to the end):**
  - 00:18:01: `food worth 6 hunger held, food 13; enough`; in the shelter at 93, 65, -57 at 00:18:07.
  - The reflex ate within 2 s of the `low` lines at 00:21:29, 00:29:20 and 00:37:10.
  - Morning: `dig out: not the east side (no free cell within 3 blocks)`, `not the south side (no firm floor under 93, 65, -56 (air))`, `the west side (a tunnel, 4 blocks)` (00:42:18–00:42:25), then `dug out of the shelter at 92, 65, -57; back to work`. The run stopped 7 s later.
- **Burrow and far-side lines:**
  - The journal has no burrow line: none of `burrowing away from it`, `Burrowed …`, `the burrow ended` or `no way to back away … or burrow`.
  - It has no relocation line either (`the walk away …`).
  - The only "side away from" line is the 23:24:28 leave line above.
  - The dig-out lines of nights 2 and 3 are listed above.
- **Food.**
  - The 9 `low` lines were all `food 12 health 20 (low)`: at 23:24:38, 23:48:50, 23:56:41, 00:03:46, 00:09:46, 00:13:42, 00:21:29, 00:29:20 and 00:37:10.
  - After 8 of them the bot ate within 10 s.
  - **The failure is 23:24:38, 5 s after the death.** The bot had respawned with food 12 (not 20) and nothing to eat: `[reflex] eating: food 12, but no safe food in the inventory` (23:24:38). Food stayed 12 through the next five food lines (23:25:38 to 23:29:38), which bound the check's window. The bot ate foraged ginseng at 23:30:26 (`ate rustic:ginseng:0 food 12->13`), 5 min 48 s after the `low` line.
  - There were 10 eats in all. Lowest food: 12.

## Step 7 (harness-ops)
- **Condition (e) passed:** `fresh: no earlier run, join or scenario; started once; world 6603 of at most 10981 ticks`, read through `log … since-start`.
- The raw answer of `test-server.sh log 200000 since-start` was fetched at the end of the run, before the delete, and is not committed. Its header, start line, `Done` line and end line are in `step7-since-start.txt`:
  ```
  ##rotn-test since-start files=2026-11-20-1.log.gz,latest.log found=1 lines=21251 over=0 nonempty=21243
  2:[22:35:01] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Starting minecraft server version 1.12.2
  20215:[22:36:30] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Done (18.669s)! For help, type "help" or "?"
  ##rotn-test end
  ```
  - Line numbers are lines of that answer; line 1 is the header.
  - Its `files=` names two files, because the log rolled over at midnight; the start line is in the rolled one.
  - Startup wrote 20,213 lines between the start line and `Done` (soak 6: 20,198).
  - The whole log from the start line on was 21,251 lines, within the 200,000-line bound.

## For the owners (not judged here)
- **lead (cost): the per-completion price rose 70%, and the working rate is now almost twice the ADR 0010 target.**
  - Rates: USD 0.091/h by day and 0.098/h while self-prompting. The 2-hour check passes (0.034) only because 75 of the 120 min were night.
  - The text the bot wrote is about the same as in soak 6. The billed completion tokens are 5.2 times as many: 671 against 113 per completion, 38 completions over 1,000.
  - The memory summaries alone went from USD 0.0047 to 0.0238.
  - No repo change explains it (`profiles/` and `src/models/` are unchanged between the tags; same provider, `Wafer`). This suggests the OpenRouter preset `glm-5-3-flash-cheap-reliable`, or its model, now reasons. The preset's settings are on OpenRouter, outside the repo.
- **lead (the `ate_when_low` check after a death):** the one failure was a `low` line 5 s after a death, with an empty inventory and food steady at 12, and the bot found food 5 min 48 s later. Should a `low` line right after a respawn with no food count the same as one with food in hand? That is the lead's call. The check now counts it as written.
- **skills-rotn: the morning fight from the shelter killed the bot.**
  - It opened the wall to a zombie that had stood by the shelter for 2 min, with full health but `holds nothing`. The same second's line said `armed`, and the crude axe and stone axe were in its inventory.
  - In the 4-s fight it took a double hit (20->14), and 4 of its 6 swings did not hurt the zombie. It was at health 11 when it left.
  - Its leave line chose `the side away from a zombie at -44, 80, -122`, which was the shelter's own cell: the zombie had come in through the opening.
  - It died 5 s after leaving.
- **skills-rotn: the respawn gives food 12 and an empty inventory, and the eating reflex has nothing to eat.** `no safe food in the inventory` at 23:24:38. Food came from foraging 6 min later.
- **skills-rotn: the LLM still picks fights with eels.** `!attack("betteranimalsplus:eel_freshwater")` against two eels at 00:09:50 cost 10 health. #508's fix held: there was no loop, the bot swam up, ate and fled. The model still chose that fight itself.
- **skills-rotn: the food step got `stuck` once** (00:15:35).
- **skills-rotn: soak 6's budget items are fixed.** The budget stop writes `[agenda] standing goal budget spent: …` and `[self-prompt] stopping after the turn (…)` to the journal, and the command of the turn in flight (`!goToCoordinates`) ran (23:35:15–23:35:24).

## Files
Each file was made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean.
- `result.json`: the runner's result, with the checks, `notes.samples`, `notes.llmUsage`, `notes.survival`, `notes.deaths` and `g4Acceptance`.
- `run.log`: the runner's stdout (`run-stdout.log` in the raw folder).
- `server.log`: the test server's log for the run, as the runner fetched it (from `2026-11-20-1.log.gz` and `latest.log`).
- `driver.log`: the CX23 journal of `mindcraft-rotn@frcfld` from the unit's start to its stop, read through the gate.
- `step7-since-start.txt`: `test-server.sh starts` right after `up`, and the header, start, `Done` and end lines of `test-server.sh log 200000 since-start`.
