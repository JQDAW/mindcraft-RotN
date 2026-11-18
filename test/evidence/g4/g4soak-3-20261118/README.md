# G4 soak 3: `g4-soak-2h` on the CX23 service (2026-11-18)

**Label: the third soak, under the lead's written GO `G4-SOAK-3-20261118`. It is never G4 acceptance evidence.**
- This run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. It FAILED: 6 checks passed and 3 failed.
- `result.json` marks it not-gate (`gateValid: false`) with two reasons:
  - the S-run reason from #436: "a G4 run on the CX23 service (set-up S) is not an acceptance run";
  - the step-7 runner's (#446) reasons: no `ROTN_G4_ACCEPT` marker, so (a) and (d) fail, and (e) failed too (below: *A step-7 finding*).
- G4 evidence comes only from the step-7 runs, under their own rules (test/scenarios/g4/PLAN.md).

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | tag `rotn-v0.1.5` = develop `518e782e`, a fresh detached checkout. `npm ci` ran first, then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. The run started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-3-20261118:frcfld:test-server-host-confirmed`. `result.json`: `service.goId` is `G4-SOAK-3-20261118`, with no start error, no incident and no unknown state |
| The bot | the CX23 unit `mindcraft-rotn@frcfld`. The human deployed `rotn-v0.1.5`, reset FRCFLD's state (only action-code, histories and `last_profile.json` remained) and confirmed the env `host` was this test server. Its journal after the unit's systemd start (19:21:40) says: `[release] rotn-v0.1.5-518e782eff28` (the harness's commit); `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[state] <bot> at start: tasks=absent agenda=absent memory=absent` |
| Test server | `mcr-test-20261118-183051`, CPX42 nbg1. Created 18:30:56, ready 18:34:13, deleted 21:23:06 (172 min, billed about 3 h: EUR 0.4143 plus the IPv4). Watchdog `delete-after` was 2026-11-18T22:30:56Z (TTL 4 h). Afterwards: 0 servers, 0 Primary IPs and 0 labelled keys, counted with `grep -c .` |
| Step-7 rehearsal check | `test-server.sh starts` right after `up`: `starts=1 files=1` on the live pack (the PLAN step 7 checklist) |
| World | the G2/G3/M1 seed `1880465901402976865` (console `seed`), fresh |
| Server | firewall 22 and 25565 only from the CX23 and the dev server; online mode; whitelist `<bot>,JQDAW` |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match |
| Timing | The scenario ran 19:21:32 to 21:22:08 UTC. The bot joined at 19:21:55, then came 120 min of samples every 5 min (25 samples), then the runner's ctl stop. Afterwards the unit was `inactive (dead)` and `disabled` (`status frcfld`, read through the gate). The journal covers 120.1 of 120.1 min. The test server had been up about 47 min before the join, while the human set the host |

## The measurements
| Measure | Value |
| --- | --- |
| **Peak memory** | **518 MiB** (`MemoryPeak`), target 850. Memory was 352 MiB at the join, 455 by minute 10, about 505 from minute 40 and 515 at minute 81–91. It dropped to 452 at minute 96, then stayed at 462–470 to the end (`notes.samples`). Soak 2: 622 MiB; M1: 634 |
| **NRestarts** | **0** at all 25 samples; `ActiveState` was active at every sample |
| **LLM spend** | **USD 0.008913 per hour**, target 0.05: USD 0.017841 over 120 min, the sum of `cost_usd` over 117 `[openrouter] usage …` lines, 0 unknown (about 58 completions per hour; soak 2 had 103). Soak 2: USD 0.0129/h |

## The checks (`result.json`)
| Check | Result |
| --- | --- |
| `login_online` | PASS: joined at 19:21:55, version-4 UUID |
| `naming` (#2) | PASS: `[naming] <bot> near spawn: 15 kinds; unknown 0`, all real names; entities: 1 kind, unknown 0 |
| `no_crash` (#7) | PASS: 120 min up, 25 samples, NRestarts 0 throughout, no agent exit |
| `peak_memory` (#7) | PASS: 518 MiB (target 850) |
| `usd_per_hour` (#7) | PASS: USD 0.008913/h (target 0.05) |
| `agenda_done` (#4) | **FAIL**: no `agenda done` within the soak (below) |
| `food_floor` (#5) | **FAIL**: lowest food 2 (floor 6), over 121 food lines |
| `ate_when_low` (#5) | **FAIL**: 1 of 1 `low` food lines had no eat after it |
| `deaths_reported` (#5, as #6) | PASS: each of **12** deaths reported |

## What happened (the bot's own `[survival]`, `[night]`, `[death]`, `[respawn]` and `[reflex]` lines, `driver.log`; death causes from `server.log`)
- **The agenda.** Steps 1–9 were done by 19:31 (`!agenda` at 19:30:58): rocks, sticks, crude_axe, logs, first_plank, crafting_tools, crafting_table, planks_sticks and stone_pickaxe; it also held 40 dirt piles for the shelter (19:26). Step 10 of 11 (`stone_axe`) was still open at the end. The first death (19:47) cost the whole first kit, including the stone pickaxe.
- **Counts:** 1 eat (19:46:58, rhubarb, food 17), 23 fights (outcomes: 12 interrupted, 5 died, 4 stopped, 1 capped, 1 killed), 21 flees, 121 food lines.
- **12 deaths, all reported, in two bursts at night:**
  - **First night, 7 deaths, 19:47:01–20:01:58.** Six were `slain by Zombie`, and one (20:01:20) was `slain by Zombie <bot>`: a zombie player with the bot's own name. Five of them came in a shelter while a zombie dug into it (`zombie is digging the shelter … ready to repair`, then `the repair placed nothing` or `placed 1 but left some open`, then `fight start zombie (shelter)`, and the bot died within 1–3 s). After each respawn the bot held 0 dirt, so the next dirt shelter failed (`a dirt shelter needs N dirt`), and it went back to a hole shelter near the same spot (`could not get far from the death spot; sheltering here`, 3 times).
  - **Second night, 5 deaths, 20:27:01–20:30:30.** Four were `slain by Zombie`; the last was `slain by Skeleton Warrior`. Before this the shelter failed: `Could not reach the shelter site at 1, 75, -78`, then `found no place to dig a hole shelter`, then `no shelter after 3 tries and a hole shelter … no weapon: keeping away from mobs until morning` (20:24:28). Then came open fights at low health (`flee zombie (low health 2)`, `low health 1`) and a burst of 8 one-second `fight start zombie (open)` / `interrupted` pairs at 20:29:56–20:30:03.
  - `zombie_players:zombie_player` shows up 13 times in `flee … (a player zombie, and no weapon or health at half or less)` lines, mostly right after a death at the same spot.
- **The respawn move** ran once, after the seventh death: at 20:02:29 it was `now 50 blocks from the spawn and 7 recent death spots … the agenda resumes`. After the other deaths the night routine took over at once.
- **The self-prompter stopped at 20:15:35 and did not start again.** The log says `self prompt loop stopped`, with no `stopping self-prompt loop` and no "did not use command" warning before it. The line came 2 s after `!moveAway(40)` failed (`time limit of 180 s reached`) and 49 s before `sunset is near` (20:16:24). There is no `Self-prompting started` or `Restarting self-prompting` after it. The morning at 20:42:04 (`dug out of the shelter … back to work`) was followed by no command at all until the next `sunset is near` at 20:56:23. Earlier stops (19:35:58, 19:41:44, 20:07:30) were each followed by `Self-prompting started` within 2 s to 21 min (the 21-min one after the respawn move).
- **Hunger.** From 20:30 the bot held no food (`food worth 0 hunger held`). In the last shelter (20:56:36 to the end) the eating reflex fired every 30 s: `eating: food 8, but no safe food in the inventory`, and from 21:08 `…, and no other food either`. Food fell by 1 about every 4 min, from 8 at 20:56 to 2 at 21:20. Only one `low` line was logged (food 12, at 19:47:05); lower values came as `check` lines. On this pack food 1 has killed the bot in earlier soaks.

## A step-7 finding (harness-ops)
- **On the live pack, the server's start line is more than 20,000 lines from the end of `latest.log`.**
  - In `latest.log`, `Starting minecraft server version 1.12.2` is line 5,520 and `Done (19.867s)!` is line 25,718: startup writes about 20,200 lines between them.
  - `startAcceptance` reads the server log with `log(20000)` (`tail -n 20000`), so the start line was not in the fetched log. The runner said: "(e) the server's start line is not in the fetched log, so its history cannot be checked".
  - The `rotated` fallback does not help on the first day: there is no rolled-over file yet.
  - As built, every step-7 acceptance run on a fresh server would therefore fail (e).
  - `test-server.sh starts` is not affected: it counts over whole files. It said `starts=1`.
- **Proposed fix, in a separate PR once the lead agrees:** fetch enough of the log to include the start line, for example a larger tail (60,000 lines) or the file from its start line. Add a test with a startup longer than 20,000 lines.

## For the owners (not judged here)
- **skills-rotn: the self-prompter stopped at 20:15:35 and never restarted.** The bot spent the last 67 minutes doing only night-routine and reflex actions; after the morning at 20:42 it did no agenda or food work at all. This is why `stone_axe` stayed open and food ran down to 2 with no food held.
- **skills-rotn: death cascades in the shelter at night.**
  - RotN zombies dig into the dirt shelter, and the repair places nothing or too little.
  - After a death the bot holds 0 dirt, cannot build a new dirt shelter, and digs a hole near the death spot. There, zombies and zombie players (one named after the bot) kill it again within a minute: 7 deaths in 15 minutes on the first night, 5 in 4 minutes on the second.
  - Soak 2 had 5 deaths in 2 hours.
- **skills-rotn: food.** The bot held no food from 20:30; the one daytime food attempt (20:02–20:03) was cut short by a zombie and a creeper. `low` fires only at 12, as in soak 2.
- **The lead:** the memory and cost targets (ADR 0010) pass with a wide margin in all three soaks: 518, 622 and 634 MiB against 850; USD 0.0089, 0.0129 and 0.0116/h against 0.05.

## Files (each made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean)
- `result.json`: the runner's result, with every sample.
- `run.log`: the scenario's own lines (the runner's stdout).
- `server.log`: the server log from the scenario's begin marker.
- `driver.log`: the unit's journal from its start line (`[release]`, `[settings]`, `[state]`, `[naming]`, `[survival]`, `[night]`, `[death]`, `[respawn]`, `[reflex]`, `[openrouter] usage …`).
