# G4 soak 8: `g4-soak-2h` on the CX23 service (2026-11-21/22)

**Label: the eighth soak, run under the lead's written GO `G4-SOAK-8-20261121`. It is never G4 acceptance evidence.**
- The run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. It FAILED: 7 checks passed and 2 failed (`food_floor`: lowest food 5; `ate_when_low`: 1 of 10 `low` lines).
- `result.json` marks it not-gate (`gateValid: false`) for two reasons:
  - the S-run reason from #436: "a G4 run on the CX23 service (set-up S) is not an acceptance run";
  - the step-7 runner's reasons: there is no `ROTN_G4_ACCEPT` marker, so conditions (a) and (d) fail. Conditions (b), (c) and (e) hold.
- **The first soak with `bc_attack` on (#545) and the first with a `reasoning_tokens` line per completion.**
- **No death and no damage:** health was 20 at every food line.
- **The agenda was done 10.5 min after the join**, the fastest so far (soak 7: 12.4 min).
- **Why food failed:**
  - At about 00:00 the bot got stuck in a flooded pit after mining copper under water, around -88, 60, -125.
  - It stayed there, as far as its journal positions show, for nights 2 and 3 with no shelter: no place for one within 4 blocks.
  - Day 3's food step got `stuck` too. The standing goal's 5-min budget then ran out, 4 min before sunset.
  - It went into night 3 with no food (`food worth 0 hunger held, food 15`). Food fell from 12 to 5 by the end, and the reflex had nothing to eat.
- **Better Combat:** the journal's only `bettercombat` line is `[forge-bridge] bettercombat attack: on`; there was no self-check trip. The bot made one attack in the whole soak: an `!attack` that killed a sow with the crude axe.
- **Cost:**
  - **Overall:** USD 0.0437/h passes the 0.05 target only because the nights made 2 calls.
  - **By day:** USD 0.117/h.
  - **While self-prompting:** USD 0.131/h.
  - **Reasoning:** 96% of the billed completion tokens are reasoning tokens. That confirms soak 7's inference: the preset's model reasons. Each completion cost 58% more than in soak 7 (USD 0.000405 against 0.000257).
  - **Memory summaries:** they are 26% of the completions and 52% of the spend.

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.14` = develop `92faa83f`, a fresh detached checkout. `npm ci` ran first, then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. It started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-8-20261121:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-8-20261121`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, release `rotn-v0.1.14`, which the lead deployed through the gate. At 22:55 the lead reset FRCFLD's state through the gate (it archived `agenda.json` and `memory.json`). The human confirmed that the env `host` named this test server and that the file is `root:root 600`. After the unit's systemd start (23:07:49), the journal shows: `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[release] rotn-v0.1.14-92faa83fdd50` (the harness's commit); `[state] <bot> at start: tasks=absent agenda=absent memory=absent`; `[forge-bridge] bettercombat attack: on` (23:08:03) |
| Test server | `mcr-test-20261121-225759`, a CPX42 in nbg1. Created 22:58:03, ready 23:03:01, deleted 01:08:46: 130 min, billed about 3 h, EUR 0.4143 plus the IPv4. The watchdog `delete-after` was 2026-11-22T02:58:03Z (TTL 4 h). Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 labelled SSH keys (`server-lifecycle.txt`) |
| Step-7 check | `test-server.sh starts` right after `up`: `starts=1 files=1` (`step7-starts.txt`) |
| World | The G2/G3/M1 seed `1880465901402976865`, fresh: `world 5743 of at most 11574 ticks` at the step-7 read |
| Server | Firewall: ports 22 and 25565 only from the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 7 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match; 0 extra mods |
| Timing | The scenario ran 23:07:41 to 01:08:19 UTC. **Each join time names its source:** the unit started at **23:07:49** (systemd, `driver.log`). The server logged `<bot> joined the game` at **23:08:02** (`server.log`). The journal shows `Self-prompting started.` at **23:08:05**. The runner's `login_online` passed at **23:08:06** (`run.log`). Next came 120 min of samples every 5 min (25 samples), then the runner's ctl stop. The unit was stopped at 01:08:15 (systemd: `585.3M memory peak`, 16 min 56 s of CPU). Afterwards `status frcfld`, read through the gate, showed `inactive (dead)` and `disabled`. The journal covers the whole soak (`journalCoverage`: 120.1 of 120.1 min) |
| Midnight | Crossed again, as in soak 7: the runner read `2026-11-21-1.log.gz` and `latest.log` |

## The measurements
| Measure | Value |
| --- | --- |
| **Peak memory** | **585 MiB** (`MemoryPeak`), target 850. From `notes.samples`: 370 MiB at the join; 515 at minute 5; 571–578 from minute 10 to 86 (540 at minute 45.6); 581–585 from minute 91 to the end. Soak 7: 585 MiB |
| **NRestarts** | **0** at all 25 samples. `ActiveState` was active at every sample |
| **LLM spend** | See the next section |

## The LLM spend and the reasoning tokens (per window)
**Sources:** in `driver.log`, each completion writes three lines:
- `[openrouter] provider …, content N chars`
- `[openrouter] usage prompt_tokens …, completion_tokens …, cost_usd …`
- `[openrouter] reasoning_tokens N` (new in this release)

There are 216 of each: all from provider `Wafer`, no unknown cost, USD 0.087575 in total. The first usage line is at 23:08:07 and the last at 01:08:07.

| Window | Minutes | Completions | USD | USD per hour | Completion tokens | of them reasoning |
| --- | --- | --- | --- | --- | --- | --- |
| **Overall**: the runner's 120-min soak (`usd_per_hour`, PASS) | 120 | 216 | 0.087575 | **0.0437** | 315,860 | 303,189 (96.0%) |
| **Daytime**: from the join or each `[night] morning` line to the next `sunset is near` line | 43.8 | 214 | 0.085362 | **0.117** (above 0.05) | 304,761 | 292,270 (95.9%) |
| – day 1: 23:08:05 (join) to 23:22:41 | 14.6 | 105 | 0.031100 | 0.128 | 91,272 | 85,771 (94.0%) |
| – day 2: 23:48:04 to 00:02:31 | 14.4 | 61 | 0.025482 | 0.106 | 92,568 | 88,396 (95.5%) |
| – day 3: 00:28:04 to 00:42:40 | 14.6 | 47 | 0.028547 | 0.117 | 120,629 | 117,829 (97.7%) |
| – day 4: 01:08:04 to the stop (01:08:15) | 0.2 | 1 | 0.000233 | – | 292 | 274 |
| **Nights**: from `sunset is near` to `morning` | 76.4 | 2 | 0.002213 | 0.002 | 11,099 | 10,919 |
| – night 1: 23:22:41 to 23:48:04 | 25.4 | 0 | 0 | 0 | 0 | 0 |
| – night 2: 00:02:31 to 00:28:04 | 25.6 | 0 | 0 | 0 | 0 | 0 |
| – night 3: 00:42:40 to 01:08:04. Two calls: the turn in flight at sunset (00:42:43) and a memory summary (00:43:21, 10,928 completion tokens) | 25.4 | 2 | 0.002213 | – | 11,099 | 10,919 |
| **While self-prompting**: from each `Self-prompting started.` to the `self prompt loop stopped` after which it did not start again within 1 s | 31.5 | 189 | 0.068559 | **0.131** | 228,984 | 218,648 (95.5%) |
| – 23:08:05 to 23:22:41 (sunset; the agenda and then the standing goal) | 14.6 | 105 | 0.031100 | 0.128 | 91,272 | 85,771 |
| – 23:50:17 to 23:56:41 (the standing goal's budget stop) | 6.4 | 48 | 0.021052 | 0.197 | 77,243 | 74,198 |
| – 00:28:04 to 00:38:20 (the food step, then the standing goal to its budget stop) | 10.3 | 35 | 0.016174 | 0.094 | 60,177 | 58,405 |
| – 01:08:04 to the stop | 0.2 | 1 | 0.000233 | – | 292 | 274 |
| **Daytime without the self-prompter**: these windows are not listed above | 12.3 | 25 | 0.016803 | 0.082 | 75,777 | 73,622 |
| – 23:48:04 to 23:50:17: the morning wait in the shelter | 2.2 | 0 | 0 | 0 | 0 | 0 |
| – 23:56:41 to 00:02:31: after the day-1 budget stop | 5.8 | 13 | 0.004430 | 0.046 | 15,325 | 14,198 |
| – 00:38:20 to 00:42:40: after the day-2 budget stop | 4.3 | 12 | 0.012373 | 0.171 | 60,452 | 59,424 |

- **What the calls after a budget stop were:**
  - **After 23:56:41:** 4 memory summaries, plus the replies to reflex `re-plan prompt`s (`(AUTO MESSAGE) Reflexes (unstuck|self_preservation) interrupted …`).
  - **After 00:38:20:** 5 memory summaries and 7 re-plan replies.
  - The budget stops the self-prompter. It does not stop a reflex's re-plan prompt, or the memory summary that a reply triggers. Those 25 calls cost USD 0.0168.
- **Reasoning is almost all of the completion tokens.** Every one of the 216 completions has a `reasoning_tokens` line. In each window, 94–98% of the billed completion tokens were reasoning.
  - Content: 41,182 characters in all, 0.13 characters per completion token (soak 7: 0.26, soak 6: 1.48).
  - The largest completion was a memory summary at 00:38:38: 25,235 completion tokens, of which 25,073 were reasoning. It had 495 characters of content and cost USD 0.004669, 5.3% of the soak's spend.

  | | Soak 6 | Soak 7 | Soak 8 |
  | --- | --- | --- | --- |
  | Completions | 301 | 263 | 216 |
  | Prompt tokens per completion | 3,109 | 3,186 | 3,253 |
  | Completion tokens per completion | 113 | 671 | 1,462 |
  | Of them reasoning (logged since this release) | – | – | 1,404 (96.0%) |
  | USD per completion | 0.000151 | 0.000257 | 0.000405 |
  | Memory summaries (prompt under 2,000 tokens): count, USD, completion tokens each | 78, 0.004718, 186 | 69, 0.023802, 1,724 | 57, 0.045457, 4,171 |
  | Other completions: count, USD, completion tokens each | 223, 0.040706, 87 | 194, 0.043777, 297 | 159, 0.042118, 491 |
  | Completions over 1,000 completion tokens | 0 | 38 (USD 0.027194) | 70 (USD 0.055140) |

  The memory summaries are 26% of the completions and **52% of the spend**. Each one reasons for about 4,000 tokens to write a few hundred characters.

## The checks (`result.json`)
| Check | Result |
| --- | --- |
| `login_online` | PASS: joined (the runner's check at 23:08:06), version-4 UUID |
| `naming` (#2) | PASS: `[naming] <bot> near spawn: 14 kinds; unknown 0` (`dirt`, `undergroundbiomes:sedimentary_stone`, `tallgrass`, `dynamictrees:leaves0`, `dynamictrees:trunkshell`, …). Entities at +120 s: 1 kind, unknown 0 (`dynamictrees:falling_tree`) |
| `no_crash` (#7) | PASS: 120 min up, 25 samples, NRestarts 0 throughout, no agent exit |
| `peak_memory` (#7) | PASS: 585 MiB (target 850) |
| `usd_per_hour` (#7) | PASS: USD 0.043745/h overall (target 0.05). It was USD 0.117/h by day and 0.131/h while self-prompting; see above |
| `agenda_done` (#4) | PASS: `agenda done` in chat at 23:18:31, 10.5 min after the server's join line |
| `food_floor` (#5) | **FAIL**: lowest food 5 (floor 6), over 125 food lines. Food 5 from 01:06:27 to the end |
| `ate_when_low` (#5) | **FAIL**: 1 of 10 `low` food lines had no eat within the 5 food lines after it (00:49:56, below) |
| `deaths_reported` (#5, as #6) | PASS: no death. The journal has no `[death]` line and `server.log` no death message |

## Fights, weapons and mobs
- **Fights by outcome:**
  - **0 reflex fights.** `notes.survival` has `fights: 0`, `fightOutcomes: {}` and `flees: 0`. The journal has no `fight start`, `fight end`, `flee` or `hurt` line, and health was 20 at all 125 food lines.
  - **1 kill, by the LLM's `!attack`.** At 23:12:34 the food step chose `!attack("animania:sow_old_spot")` (the bot was hunting wild animals: `no fences or houses around here`).
    - Weapon line: `[survival] weapon pyrotech:crude_axe (attack)`.
    - At 23:12:52: `Successfully killed animania:sow_old_spot.` and `Picked up 0 items.` The LLM said `Killed it but got no drops`.
    - The drops were picked up later: the inventory at 23:13:54 holds `animania:raw_prime_pork: 2` and `mod_lavacow:intestine: 1`. The bot ate both pork items later (23:53:44 raw, 23:58:22 cooked).
    - Better Combat logs nothing per hit, so the hits of this fight are not in the journal.
- **Every `[forge-bridge] bettercombat` line:** there is one, `bettercombat attack: on` at 23:08:03.
  - There is no `bettercombat attack: N hits without a hurt, back to vanilla for this connection` (the self-check trip, `bettercombat.js:315`).
  - There is no `on, but the server lacks the bettercombat channel` either.
  - `server.log` has no `bettercombat` WARN or ERROR, no `FMLIndexedMessageCodec` line and no kick. Its only `lost connection` is the bot's own quit at the stop (01:08:15).
- **Weapon lines, in time order:**
  - 23:10:33 and 23:11:30: `[reflex] hunting: no weapon, so no hunt (foraging only)`. The first crude axe broke while debarking (`!useOn`). The bot made a second at 23:10:57 and a third at 23:11:47.
  - 23:11:34 and 23:13:00: the agenda's `step weapon (before night)` prompts: `Night is near and you hold no weapon`. The step was started three times (23:11:30, 23:12:52, 23:13:58), while the crude axes kept breaking (`The crude axe broke after those two uses`, 23:14:22).
  - 23:12:34: `[survival] weapon pyrotech:crude_axe (attack)`, the only `[survival] weapon` line.
  - 23:18:30: `stone_axe` crafted, then the agenda's last step, `stone_axe done` (23:18:31). The bot equipped it (`Axe equipped!`, 23:18:55), and the inventory still listed `stone_axe: 1` at 23:22:22.
  - 23:50:04: `[night] morning: armed, health 20, but the fight cannot be judged yet (unknown: its health, its hit, its attack interval, our weapon damage): leaving the shelter … by the side away from a betteranimalsplus:eel_freshwater at -77, 60, -112`.
- **Parasite and Zombie Awareness sightings:**
  - **No parasite:** neither log names `mod_lavacow:parasite`. The only `mod_lavacow` name is the item `mod_lavacow:intestine` from the sow, in inventory listings.
  - **One Zombie Awareness scent marker:** `!entities` at 23:56:49 answered `1 zombieawareness:entityscent(s)`. The LLM took it for the cause of its reflex interruptions (`That's just a zombie-scent marker — it draws zombies, which is why my reflexes keep flinching. Backing off from it: !moveAway(12)`), and moved away twice. Its next `!entities` (23:59:50) answered `none`.
    - The interruptions were in fact `self_preservation`: `under water with 15 of 20 air` at 23:55:46, 23:56:41 and 23:59:07, then `unstuck`.
  - **Other mobs:** a zombie by the night-1 shelter at morning (23:48:04, `-74, 64, -110`), then a freshwater eel at -77, 60, -112 (23:48:34 to 23:50:04). `server.log` has no other mob line about the bot.

## What happened
Sources: the bot's `[survival]`, `[night]`, `[reflex]` and `[agenda]` lines in `driver.log`, and agenda lines from `server.log`.

- **Day 1 (23:08–23:22): the whole agenda in 10.5 min.** In chat:
  - rocks done 23:08:58, sticks 23:09:09, crude_axe 23:09:14, logs 23:10:18;
  - first_plank 23:13:54 (after the weapon and food steps cut in), crafting_tools 23:13:58, crafting_table 23:15:51, planks_sticks 23:16:23, stone_pickaxe 23:16:31, cobblestone 23:18:17, stone_axe 23:18:31;
  - `agenda done` at 23:18:31; the standing goal started at 23:18:34 (`day 0`).
  - Foraging got food twice (`shadedgarden` 23:12:28, `soggygarden` 23:13:00), and the sow was killed (above).
- **Night 1 (23:22–23:48):**
  - 23:22:41: `food worth 11 hunger held, food 20; enough`.
  - In the shelter at -72, 64, -110 at 23:22:44.
- **The first morning (23:48–23:50):**
  - A zombie, then an eel, within 8 blocks: `staying in until it leaves` four times.
  - At 23:50:04 the routine judged the eel `a different mob from the first one`, so it left by the side away from the eel. The east, south and north sides had no free cell.
  - It was out at 23:50:16 (`left the shelter at -73, 64, -110 … back to work`).
- **Day 2 (23:50–00:02):**
  - The agenda re-opened food (23:50:17) and shelter_blocks (23:50:34). The standing goal (day 1) started at 23:51:24.
  - At 23:56:24 the budget was spent (`[agenda] standing goal budget spent: 5 min of self-prompting for day 1 …`). The turn in flight ended at 23:56:41.
  - The bot was mining copper ore under water (`!collectBlocks("osv:simpleores_copper_ore_undergroundbiomes_metamorphic_stone", 3)`). `self_preservation` made it swim up three times (23:55:46, 23:56:41, 23:59:07), then `Still under water after swimming up` (00:00:52).
  - It got stuck in flowing water at -86, 62, -125 (00:01:16–00:01:40). The LLM tried to path to sand (00:01:48). At 00:02:10 the bot was at -88, 59, -123.
  - **Nobody was self-prompting after 23:56:41.** The re-plan prompts still called the LLM (13 calls; see the spend).
- **Night 2 (00:02–00:28): no shelter, in the open.**
  - 00:02:31: `food worth 10 hunger held, food 15; enough`.
  - Then `shelter try 1 of 3 failed (Found no place for a shelter within 4 blocks (needs a solid floor, a free 1x2 space, safe digging and a face for every block).); digging a hole shelter instead` and `found no place to dig a hole shelter`, ending with `no shelter after 3 tries and a hole shelter …; staying here until morning` (00:03:32).
  - `quiet for 60 s: trying a shelter again` 4 times, until 00:11:42, all failed the same way.
  - No mob came and there was no hurt. The reflex ate after each `low` line (00:08:55, 00:13:31, 00:18:08, 00:22:45, 00:27:22), using up the food it held.
- **Day 3 (00:28–00:42): stuck in the pit; the food step got nowhere.**
  - `morning: back to work` at 00:28:04. The food step started (00:28:04). At 00:30:22 the LLM said `my agenda is the food step, and there's a ripe shaded garden within range … !forage`.
  - `unstuck` interrupted `moveAway`, `goToSurface`, `goToCoordinates` and `searchForBlock` 11 times (00:28:27 to 00:41:36). Each time: `still stuck after 10 s; re-planning instead of a restart`.
  - At 00:33:04: `agenda step food stuck: 5 min of self-prompting; going on without it for 10 min`, which runs to 00:43:04, after the sunset at 00:42:40.
  - The standing goal (day 2) ran 00:33:09 to its budget stop (00:38:09/00:38:20).
  - At 00:39:09 the LLM said `I'm stuck in a water-filled hole again. Per my notes, I'll pillar up with cobble`. `!placeHere` then failed at -90, 61, -127.
  - The last food eaten was bread at 00:38:37 (food 12→15). The LLM ate a turnip with `!consume` at 00:32:07 (13→14).
- **Night 3 (00:42 to the end): no food and no shelter.**
  - 00:42:40: `food for the night: food worth 0 hunger held, food 15; less than 6: staying sealed anyway (never out for food at night)`. The bot was not sealed: the same shelter failures as night 2 (00:42:40 to 00:51:50, 4 retries), then `staying here until morning`.
  - 00:49:56: `food 12 health 20 (low)`, then `[reflex] eating: food 12, but no safe food in the inventory` every 30 s.
  - Food fell about 1 every 4 min: 11 at 00:52:26, 9 at 00:56:56, 7 at 01:01:56, 6 at 01:03:56 and 5 at 01:06:27. From food 5 the reflex's line adds `, and no other food either` (its emergency check).
  - Health stayed 20. At 01:08:04 came `morning: back to work`, and the agenda re-opened the food step. The run stopped 11 s later.
- **Food in numbers:**
  - The 10 `low` lines were all `food 12 health 20 (low)`: 23:53:32, 23:58:20, 00:08:55, 00:13:31, 00:18:08, 00:22:45, 00:27:22, 00:31:53, 00:38:35 and 00:49:56.
  - After the first 9 the reflex ate within 12 s.
  - **The failure is 00:49:56:** there was no food at all.
  - Eats: 10 `[survival] ate` lines (9 by the reflex, the turnip by the LLM). Lowest food: 5.
- **Burrow and far-side lines:** the journal has no burrow line and no relocation line. The only "side away from" lines are the night-1 morning lines above.

## Step 7 (harness-ops)
- **Condition (e) passed:** `fresh: no earlier run, join or scenario; started once; world 5743 of at most 11574 ticks`, which the runner read through `log … since-start`.
- `test-server.sh starts` right after `up`: `starts=1 files=1` (`step7-starts.txt`).
- **Not done this time:** soak 7 also fetched the raw answer of `test-server.sh log 200000 since-start` at the end, before the delete, and quoted its header, start, `Done` and end lines. That fetch was missed before this server was deleted, so those lines are not here. The runner's own since-start read is the one above.

## For the owners (not judged here)
- **lead (cost): the reasoning is now measured.**
  - 96% of the completion tokens are reasoning: 303,189 of 315,860. The bot wrote 41,182 characters.
  - The day rate is USD 0.117/h and the self-prompting rate 0.131/h. The 2-hour check (0.044) passes only because 76 of the 120 min were night.
  - The memory summaries are half the spend (USD 0.0455 of 0.0876): about 4,000 reasoning tokens to write one summary.
  - No repo change can show this; the preset `glm-5-3-flash-cheap-reliable` lives on OpenRouter. Turning reasoning off, or capping it, for the summary calls at least would cut most of it.
- **skills-rotn: a flooded pit held the bot for its last 68 min.**
  - **Entry:** after mining copper under water (23:55–00:00), it was stuck at about -86..-90, 59..62, -123..-127.
  - **Day-3 moves:** `unstuck` ended 11 moves with `still stuck after 10 s; re-planning`, and the restart path was never taken.
  - **Pillaring:** `!placeHere` of cobble failed (00:39:27).
  - **Shelters:** night 2 and night 3 both found `no place for a shelter within 4 blocks` and `no place to dig a hole shelter`.
- **skills-rotn: the food step's `stuck` back-off and the standing goal's budget together left the bot with no food at sunset.**
  - The food step went stuck at 00:33:04, with a 10-min back-off. The standing goal ran and spent its budget (00:38:20). Nothing worked on food until the sunset (00:42:40).
  - The night routine then logged `less than 6: staying sealed anyway` with no food.
  - The bot had eaten its stock during night 2, unsheltered, one item per `low` line.
- **skills-rotn: the budget does not stop re-plan prompts.** After each budget stop, reflex re-plans and memory summaries made 25 calls (USD 0.0168): about a fifth of the daytime spend.
- **skills-rotn: the LLM blamed the Zombie Awareness scent marker** for `self_preservation`'s under-water interrupts, and moved away from it twice (23:56:55, 23:57:51). The `!entities` answer names the marker with no hint that it is harmless.
- **skills-rotn: the crude axe broke three times in the first 6 min** (debarking and the first plank). The weapon step started three times before the stone axe (23:18:31).
- **net-forge (FYI): Better Combat.** One `!attack` kill with the crude axe and no self-check trip. That is a small sample: there was no zombie fight.
- **server (FYI, not ours):**
  - 3 `[Universal Tweaks]: Failed to save chunk` ERRORs with a `NullPointerException` in `NBTTagCompound.write` (00:39:47, 00:44:14, 00:58:29). Soak 6 had 1 and soak 7 none.
  - `[cyclicmagic]: Data not found for <bot>` at the join, as in soak 7.

## Files
Each file was made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean.
- `result.json`: the runner's result, with the checks, `notes.samples`, `notes.llmUsage`, `notes.survival`, `notes.deaths` and `g4Acceptance`.
- `run.log`: the runner's stdout (`run-stdout.log` in the raw folder).
- `server.log`: the test server's log for the run, as the runner fetched it (from `2026-11-21-1.log.gz` and `latest.log`).
- `driver.log`: the CX23 journal of `mindcraft-rotn@frcfld` from the unit's start to its stop, read through the gate.
- `step7-starts.txt`: `test-server.sh starts` right after `up`.
- `server-lifecycle.txt`: the `test-server.sh up` log, `starts`, the `test-server.sh down` log (ending `verified gone: server, Primary IPv4 and SSH key`), and the hcloud counts saved at the delete (`servers=0 ips=0 keys=0` at 01:08:46Z).
