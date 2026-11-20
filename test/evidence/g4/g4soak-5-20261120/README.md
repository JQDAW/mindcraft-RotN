# G4 soak 5: `g4-soak-2h` on the CX23 service (2026-11-20)

**Label: the fifth soak, run under the lead's written GO `G4-SOAK-5-20261120`. It is never G4 acceptance evidence.**
- The run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. It FAILED: 7 checks passed and 2 failed (`naming` and `ate_when_low`).
- `result.json` marks it not-gate (`gateValid: false`) for two reasons:
  - the S-run reason from #436: "a G4 run on the CX23 service (set-up S) is not an acceptance run";
  - the step-7 runner's reasons: there is no `ROTN_G4_ACCEPT` marker, so conditions (a) and (d) fail. Conditions (b), (c) and (e) hold.
- G4 evidence comes only from the step-7 runs, under their own rules (test/scenarios/g4/PLAN.md).
- **Unlike soak 4, the bot worked every day of the soak.** It ran from the join to each sunset, all three days, and stayed in a shelter each night. This soak therefore measures a working bot. The cost while it worked was **USD 0.064 per hour, above the 0.05 target**; the 2-hour average of 0.023 passes only because the nights cost nothing (see *The LLM spend*).

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.11` = develop `272ff9b9`, a fresh detached checkout. `npm ci` ran first. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. It started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-5-20261120:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-5-20261120`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, release `rotn-v0.1.11`, installed by the human (ADR 0011). At 00:05 the lead reset FRCFLD's state through the gate: it moved `agenda.json` and `memory.json` and kept action-code, the histories and `last_profile.json`. The human confirmed that the env `host` named this test server. After the unit's systemd start (00:16:03), the journal shows: `[release] rotn-v0.1.11-272ff9b92232` (the harness's commit); `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[state] <bot> at start: tasks=absent agenda=absent memory=absent` |
| Test server | `mcr-test-20261120-000741`, a CPX42 in nbg1. Created 00:07:47, ready 00:11:02, deleted 02:16:56: 129 min, billed about 3 h, EUR 0.4143 plus the IPv4. The watchdog `delete-after` was 2026-11-20T04:07:47Z (TTL 4 h). Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 labelled SSH keys (counted with `grep -c .`; the keys from the JSON `labels` field). The project's 2 long-standing unlabelled keys stayed |
| Step-7 check | `test-server.sh starts` right after `up`: `starts=1 files=1` (`step7-since-start.txt`) |
| World | The G2/G3/M1 seed `1880465901402976865`, fresh: `world 6173 of at most 9754 ticks` at the step-7 read |
| Server | Firewall: ports 22 and 25565 only from the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 and 4 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match; 0 extra mods |
| Timing | The scenario ran 00:15:55 to 02:16:29 UTC. **Each join time names its source:** the unit started at **00:16:03** (systemd, `driver.log`). The server logged `<bot> joined the game` at **00:16:17** (`server.log`). The journal shows `Self-prompting started.` at **00:16:20**. The runner's `login_online` passed at **00:16:20** (`run.log`). Next came 120 min of samples every 5 min (25 samples), then the runner's ctl stop at 02:16:26. The unit was stopped by 02:16:27 (systemd: `679.4M memory peak`, 19 min 39 s of CPU in 2 h). Afterwards `status frcfld`, read through the gate, showed `inactive (dead)` and `disabled`. The journal covers 120.1 of 120.1 min |

## The measurements
| Measure | Value |
| --- | --- |
| **Peak memory** | **679 MiB** (`MemoryPeak`), target 850. In `notes.samples`, memory rose while the bot worked: 357 MiB at the join, about 430–480 in the first half-hour, 525–584 in minutes 35–76, then 600–640. It held at 640 from minute 96 to the end. The peak came between the samples at minutes 45.5 and 55.7. Soak 4 (the idle bot): 467 MiB; soak 2: 622 |
| **NRestarts** | **0** at all 25 samples. `ActiveState` was active at every sample |
| **LLM spend** | See the next section |

## The LLM spend (the lead's question: per hour while working, and overall)
All figures sum `cost_usd` over the bot's `[openrouter] usage …` lines in `driver.log`: 304 lines, 0 unknown, USD 0.046651 in total.

| Measure (which window) | Minutes | Completions | USD per hour |
| --- | --- | --- | --- |
| **Overall**: the runner's 120-min soak (`usd_per_hour`, PASS) | 120 | 304 | **0.0233** |
| **While working**: the three daytimes, from the join or the `[night] morning` line to the next `[night] sunset is near` line. Every completion falls in one of them | 43.6 | 304 | **0.0642** (above the 0.05 target) |
| – day 1: 00:16:20 (join) to 00:31:08 | 14.8 | 79 | 0.050 |
| – day 2: 00:56:18 to 01:10:44 | 14.4 | 122 | 0.078 |
| – day 3: 01:36:24 to 01:50:46 | 14.4 | 103 | 0.065 |
| For reference: the first to the last usage line (00:16:21 to 01:50:44; it includes the first two nights) | 94.4 | 304 | 0.0297 |

- The nights made no LLM calls. The self-prompter stopped at or just before each sunset (00:31:08, 01:09:26, 01:50:46). It started again only at the morning: at 00:56:18 and, after the second night, at 01:36:29. The third night ran past the end of the soak.
- The three nights, each from its `sunset is near` line to its `morning` line, were 25.2, 25.7 and 25.5 min: **76.4 min of the 120 had no LLM call**. The no-call gaps between usage lines are slightly longer: 26.3 min (00:30:05–00:56:25), 27.1 min (01:09:24–01:36:29) and 25.7 min from the last call to the ctl stop.
- So the 2-hour figure mixes about 44 min of work with about 76 min of night. A bot that works for a larger share of the soak spends more per hour: about USD 0.064/h at this run's working rate (7 completions per minute on average, between 5.3 and 8.5 per day). Soak 4's 11 working minutes came to about USD 0.084/h.

## The checks (`result.json`)
| Check | Result |
| --- | --- |
| `login_online` | PASS: joined (the runner's check at 00:16:20), version-4 UUID |
| `naming` (#2) | **FAIL**: `[naming] <bot> near spawn: 2 kinds; unknown 0` (`dynamictrees:leaves0`, `dynamictrees:sprucebranch`). The check needs at least 3. No name was unknown, numeric or a placeholder. The bot spawned up a tree (`Stuck up a tree` at 00:16:31), so the scan saw only leaves and branches. Entities: 2 kinds (`primitivemobs:grovesprite`, `zombieawareness:entityscent`), unknown 0. Soak 4 had 3 block kinds |
| `no_crash` (#7) | PASS: 120 min up, 25 samples, NRestarts 0 throughout, no agent exit |
| `peak_memory` (#7) | PASS: 679 MiB (target 850) |
| `usd_per_hour` (#7) | PASS: USD 0.023309/h overall (target 0.05). While working it was USD 0.064/h; see above |
| `agenda_done` (#4) | PASS: `agenda done` in chat at 00:29:53, 13.6 min after the server's join line |
| `food_floor` (#5) | PASS: lowest food 12 (floor 6), over 123 food lines |
| `ate_when_low` (#5) | **FAIL**: 2 of 5 `low` food lines had no eat within 5 food lines after them (below) |
| `deaths_reported` (#5, as #6) | PASS: each of the 6 deaths was reported in chat (`I died at …; lost …`) |

## What happened
Sources: the bot's `[survival]`, `[night]`, `[respawn]` and `[death]` lines in `driver.log`, and agenda and death lines from `server.log`.

- **Day 1 (00:16–00:31): the agenda was done in 13.6 min.** In chat:
  - rocks done 00:18:19, then sticks and logs 00:19:11, crude_axe 00:21:08;
  - the food step `stuck: 5 min of self-prompting; going on without it for 10 min` at 00:26:10 (`[reflex] unstuck` kept interrupting its hunts of an `animania:sow_old_spot`);
  - then first_plank 00:26:49, crafting_tools 00:26:55, crafting_table 00:27:06, planks_sticks 00:27:14, stone_pickaxe 00:27:27, cobblestone 00:29:21, stone_axe 00:29:53, and `agenda done` at 00:29:53;
  - the self-prompter then took the standing goal (`the agenda is done: keep food worth at least 12 hunger … and 10 blocks for the night's shelter`).
- **Night 1 (00:31–00:56): a troll killed the bot in its shelter.**
  - At 00:31:08: `sunset is near`, and food worth 5 hunger held. Shelter try 1 failed with `the block did not stay (placed twice)`, so the bot dug a hole shelter and moved into a side pocket at 00:31:47.
  - At 00:46:05 the shelter was open again, and the repair placed nothing. An `iceandfire:if_troll` fought it through the gap (`4 hits did not hurt the iceandfire:if_troll`). Health fell to 2 while the bot ate between swings.
  - Death at 00:46:56 (`slain by Troll`). It respawned with no pickaxe and no food; all three shelter tries failed (`Found no place for a shelter within 4 blocks`). It stayed out until `morning: back to work` at 00:56:18.
- **Day 2 (00:56–01:10): two deaths by day, then back to work.**
  - At the morning (00:56:18) the respawn walk `got only 4 blocks from the spawn and 1 recent death spot`, and the agenda resumed there.
  - Zombies killed it at 01:00:11 (at -24, 71, -70) and at 01:00:40 (at -66, 64, -52).
  - After the second death it walked 51 blocks away and gathered dirt piles, a crude axe and food.
  - Its own memory notes record the death spots, and why to keep away from them.
- **Night 2 (01:10–01:36): a zombie dug in.**
  - At 01:10:44 the bot held food worth 10 hunger and sat in a shelter at 01:10:50.
  - At 01:27:12: `zombie is digging the shelter`. The repair placed nothing (`nothing to place a block against`), and the bot died at 01:27:23 (`slain by Zombie`).
  - It walked 25 blocks away, dug a hole shelter (01:27:40) and stayed in it to the morning, 01:36:24.
- **Day 3 (01:36–01:50): a flee at health 3 ended in drowning.** `flee unknown (low health 3)` at 01:42:54, then `drowned` at 01:43:53. After the respawn it gathered dirt piles again. The food step was `stuck` again at 01:45:22.
- **Night 3 (01:50 to the end): a zombie villager dug in.** In a shelter at 01:50:58. At 02:11:45 a `zombie_villager is digging the shelter`; four repairs followed, then death at 02:12:23. After that, every shelter try failed (`the block did not stay (placed twice)`), and the morning came at 02:16:18, 8 s before the stop.
- **Deaths: 6**, each reported in chat: troll (in the shelter), zombie, zombie (by day), zombie (dug in), drowned (fleeing at health 3), zombie villager (dug in). There were 13 fights (6 capped, 4 interrupted, 2 died, 1 stopped), 6 flees and 10 eats.
- **Food.**
  - The five `low` lines were `food 12 health 20 (low)` at 00:47:00, 01:27:06, 01:43:57, 02:09:04 and 02:12:27.
  - The bot ate after three of them: radish 01:27:08, wildberries 01:46:29 and 02:09:05.
  - The two failures each came 4 s after a death, with food 12 right after the respawn and every item lost:
    - 00:47:00, after the troll. The night line says `food worth 0 hunger held`, and the next eat was at 01:01:21;
    - 02:12:27, after the zombie villager. The run ended at 02:16:26 with no eat.
  - Food never fell below 12.

## Step 7 (harness-ops)
- **Condition (e) passed:** `fresh: no earlier run, join or scenario; started once; world 6173 of at most 9754 ticks`, read through `log … since-start`, as in soak 4.
- The raw answer of `test-server.sh log 200000 since-start` was fetched at the end of the run, before the delete, and is not committed. Its header, start line, `Done` line and end line are in `step7-since-start.txt`:
  ```
  ##rotn-test since-start files=latest.log found=1 lines=21341 over=0 nonempty=21333
  2:[00:09:12] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Starting minecraft server version 1.12.2
  20210:[00:10:47] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Done (19.606s)! For help, type "help" or "?"
  ##rotn-test end
  ```
  - Line numbers are lines of that answer; line 1 is the header.
  - Startup wrote 20,208 lines between the start line and `Done` (soak 4: 20,236).
  - The whole log from the start line on was 21,341 lines, within the 200,000-line bound.

## For the owners (not judged here)
- **lead (cost): a working bot is above the ADR 0010 cost target.** While it worked, the bot spent USD 0.064/h over 43.6 min of daytime, against a target of USD 0.05/h. Days 2 and 3, which included re-planning after deaths, came to 0.078 and 0.065. The 2-hour check passes only because RotN's nights (25 min each, about 64% of this soak) make no LLM calls. If the target is meant for working time, this run fails it.
- **skills-rotn: the shelter does not hold.**
  - A troll (night 1), a zombie (night 2) and a zombie villager (night 3) each got in, and each night ended in a death.
  - Repairs failed with `the block did not stay (placed twice)` and `nothing to place a block against`.
  - The troll took no damage from the bot (`4 hits did not hurt`).
- **skills-rotn: `ate_when_low` right after a respawn.** RotN respawns the bot with food 12, which is the `low` level, and with an empty inventory. Both failures are that case. Whether the check or the bot should handle it is for the lead and skills-rotn.
- **skills-rotn: the respawn walk.** After the first death, the walk away `got only 4 blocks` (00:56:18). The next two deaths followed within 5 min, both by day.
- **skills-rotn: the food step.** It got `stuck` twice (00:26:10, 01:45:22): the unstuck reflex kept interrupting the hunts, and the sows were out of reach.
- **harness-ops (`naming`):** the scan near spawn saw 2 kinds because the bot spawned in a tree. The names themselves were all RotN names (unknown 0). A check that needs 3 kinds depends on where the bot spawns. I can raise this as its own item if the lead wants.

## Files
Each file was made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean.
- `result.json`: the runner's result, with the checks, `notes.samples`, `notes.llmUsage`, `notes.survival` and `g4Acceptance`.
- `run.log`: the runner's stdout (`run-stdout.log` in the raw folder).
- `server.log`: the test server's log for the run, as the runner fetched it.
- `driver.log`: the CX23 journal of `mindcraft-rotn@frcfld` from the unit's start to its stop, read through the gate.
- `step7-since-start.txt`: `test-server.sh starts` right after `up`, and the header, start, `Done` and end lines of `test-server.sh log 200000 since-start`.
