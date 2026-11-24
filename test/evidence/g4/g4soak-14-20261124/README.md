# G4 soak 14: `g4-soak-2h` on the CX23 service (2026-11-24)

**Label: the fourteenth soak, run under the lead's written GO `G4-SOAK-14-20261124`. It is never G4 acceptance evidence.**
- The run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. It FAILED: 6 checks passed and 3 failed (`agenda_done`, `food_floor` at lowest food 1, `ate_when_low` 1 of 3).
- `result.json` marks it not-gate (`gateValid: false`) for two reasons:
  - the S-run reason from #436;
  - the step-7 runner's reasons: there is no `ROTN_G4_ACCEPT` marker, so conditions (a) and (d) fail. Conditions (b), (c) and (e) hold.
- **The first soak on rotn-v0.1.20.** `usd_per_hour` passed: USD 0.037325/h (soak 13 failed at 0.055172). The run went the full 120 min with no process restart and no agent exit.
- **3 deaths, all reported** (server causes, `server.log`):

  | # | Time | Place | Server cause |
  | --- | --- | --- | --- |
  | 1 | 14:47:10 | -70, 62, -71 | `slain by Grove Sprite`, 4 min after the join |
  | 2 | 15:29:24 | 72, 64, 84 (the night-1 shelter's cell) | `starved to death` |
  | 3 | 16:26:39 | -2, 71, -46 (in the open, night 3) | `starved to death` |

  Death 1 took the bot's only food (1 bread). After it, the bot ate what it found as soon as it found it and held no food at any sunset. Its food lines read 1 twice, and it starved at food 0 both times.
- **No shelter on nights 2 and 3.** Each death took the dirt piles (60, then 72). The bot then had 0 to 6 dirt, and the dirt shelter needs 8 to 10. Every hole shelter was either interrupted by fights or found no place.
- **The Scroll of New Life was never used.** It was checked only at sunset 1 and morning 1, the only closed shelter, and refused both times. The new way-out line names the blocking cells: `limestone_cobble` on the east (`never` with the items a death keeps, 1500 ms with the stone pickaxe), and west, south and north `open, but no walk to 8 blocks from there`. No respawn was at a scroll spot.
- **Cost:**
  - **Overall:** USD 0.0373/h, 133 calls, from 3 providers (Wafer 108, Near AI 20, DigitalOcean 5).
  - **Memory summaries:** 22 summaries cost USD 0.034425 (**46.1%** of the spend), with 116,060 reasoning tokens, up to 16,783 for one summary of about 490 characters.
    - The first summary call with `reasoning effort=none` (#600) got a 400. openrouter.js retried it without the setting (`the reasoning setting may have been refused (status 400); retrying without it`) and sent no setting after that. So no summary ran with reasoning off.
    - **Counting:** the summaries are paired with their own replies, not taken from the `[memory]` marker. In this journal the marker's next usage line was a command call 18 times out of 22, so the marker rule would give USD 0.011309. See "The LLM spend" below and PR #607.
  - **Reasoning:** 96.6% of the completion tokens.

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.20` = develop `8cdfae87`, a fresh detached checkout. `npm ci` ran first, then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. It started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-14-20261124:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-14-20261124`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, release `rotn-v0.1.20`, which the lead deployed through the gate. The unit was inactive and disabled before the run. The human set the env `host` to this test server and confirmed it, with the file `root:root 600`. After the unit's systemd start (14:42:55), the journal shows: `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[release] rotn-v0.1.20-8cdfae874c78` (the harness's commit); `[state] <bot> at start: tasks=absent agenda=absent memory=absent`; `[forge-bridge] bettercombat attack: on`; the dig-time rule line. Three `Error with embedding model, using word-overlap instead.` lines at 14:43:01 |
| Test server | `mcr-test-20261124-143409`, a CPX42 in nbg1. Created 14:34:16, ready 14:37:31, deleted 16:43:44: 129 min, billed about 3 h, EUR 0.4143 plus the IPv4. The watchdog `delete-after` was 2026-11-24T18:34:16Z (TTL 4 h). Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 test SSH keys (`server-lifecycle.txt`) |
| Step-7 check | `test-server.sh starts` right after `up` (14:37:31): `starts=1 files=1` (`step7-starts.txt`). The same after the run, before `down` |
| World | The G2/G3/M1 seed `1880465901402976865`, fresh: `world 6679 of at most 10215 ticks` at the step-7 read |
| Server | Firewall: ports 22 and 25565 only from the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 13 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match; 0 extra mods |
| Timing | The scenario ran 14:42:47 to 16:43:21 UTC. **Each join time names its source:** the unit started at **14:42:55** (systemd, `driver.log:2`). The server logged `<bot> joined the game` at **14:43:08** (`server.log:10`). The journal shows `<bot> spawned.` at **14:43:10** and `Self-prompting started.` at **14:43:11**. The runner's `login_online` passed at **14:43:12** (`run.log`). Next came 120 min of samples every 5 min (25 samples), then the runner's ctl stop. The unit was stopped at 16:43:19 (systemd: `657.9M memory peak`, 15 min 5 s of CPU). The journal covers the whole soak (`journalCoverage`: 120.1 of 120.1 min) |

## The checks (`result.json`)
| Check | Result | Detail |
| --- | --- | --- |
| `login_online` | PASS | joined, a version-4 (Mojang account) UUID |
| `naming` | PASS | `[naming]`: 19 kinds, unknown 0, all real; no entity near (+242 s) |
| `no_crash` | PASS | 120 min up, 25 samples, `NRestarts` 0 throughout, no agent exit |
| `peak_memory` | PASS | 658 MiB (target 850) |
| `usd_per_hour` | PASS | USD 0.037325/h: USD 0.074706 over 120 min, 133 completions (target 0.05) |
| `agenda_done` | **FAIL** | no `agenda done`. Steps done: rocks to `stone_pickaxe` (14:56:43, `server.log:1339`). Then `shelter_blocks` and `food` took turns. `stone_axe` started at 15:34:30 and again at 16:43:13 |
| `food_floor` | **FAIL** | lowest food 1, from 122 food lines (floor 6): at 15:26:52 and 16:22:53 |
| `ate_when_low` | **FAIL** | 1 of 3 `low` lines had no eat after it: 14:54:51 (food 12, no food held; the next eat was at 15:55:49). A food line is tagged `low` only when food falls to 12 from above (`survival_log.js:297`); food 11 to 1 were `check` lines, so the check saw 3 `low` lines in a run that went down to food 1 twice |
| `deaths_reported` | PASS | each of 3 deaths reported |

## The LLM spend (test/tools/soak-spend.mjs)
**How the summaries are counted.** The table comes from `test/tools/soak-spend.mjs` as in PR #607. It pairs each call with its caller's first line after openrouter.js's `Received.` line: `Memory updated to:` means a memory summary, `Generated response:` means a command.

The marker rule (#602, the lead's choice for soak 14) does not work on this journal:
- history.js prints `[memory] summary turns <n> kept <k>` and starts the summary, and the next command's prompt goes out at the same moment (two `Awaiting openrouter api response...` lines).
- The command's reply usually comes back first, so the next usage line after a marker was a command call 18 times out of 22.
- For example, the marker at 14:45:28 (`driver.log:322`) is followed by a command reply at 14:45:31 (`!useOn(...)`, prompt 3,442 tokens). The summary's own reply came at 14:45:38 (prompt 930 tokens).
- The marker rule gives the summaries USD 0.011309 (15%); the pairing gives USD 0.034425 (46%).
- The pairing finds 22 summaries, which matches the 22 markers and the 22 `Memory updated to:` lines, with 0 unclear calls. On soaks 12 and 13 it gives the same counts as their READMEs (54, 69).

**Windows.** A night runs from `sunset is near` (or `it is night`) to its first `[night] morning` line; calls go to windows by line order. Day 1 starts at the spawn line.

| Window | Calls | Memory summaries (calls, USD, reasoning tokens) | Completion tokens | Reasoning tokens | USD |
| --- | --- | --- | --- | --- | --- |
| Day 1 (14:43:10–14:58:04) | 75 | 12, 0.008610, 37,525 | 77,245 | 73,822 | 0.027085 |
| Night 1 (14:58:04–15:23:57) | 0 | 0 | – | – | – |
| Day 2 (15:23:57–15:38:15) | 23 | 4, 0.014971, 30,151 | 45,976 | 44,659 | 0.026459 |
| Night 2 (15:38:15–16:12:35) | 0 | 0 | – | – | – |
| Day 3 (16:12:35–16:17:47) | 34 | 6, 0.010844, 48,384 | 75,785 | 73,857 | 0.020802 |
| Night 3 (16:17:47–16:43:08) | 0 | 0 | – | – | – |
| Day 4 (16:43:08–16:43:19) | 1 | 0 | 913 | 883 | 0.000360 |
| **Total** | **133** | **22, 0.034425 (46.1%), 116,060** | **199,919** | **193,221** | **0.074706** |

- **USD per hour:** the gate's, 0.037325 over 120 min. The gate's USD 0.074706 equals the tool's total.
- **Reasoning:** 193,221 of 199,919 completion tokens (96.6%). Every call had a `reasoning_tokens` line.
- **Memory summaries:** 22 of 133 calls (16.5%), USD 0.034425 (46.1%). Completion tokens 119,745 (max 16,966); reasoning 116,060 (max 16,783). One summary prompt was over 2,000 tokens (2,299, at 16:14:19).
- **Other calls:** 111, USD 0.040280. Completion tokens 80,174; reasoning 77,161 (max 8,951).
- **`reasoning effort=none`:** 1 line, at the first summary (`driver.log:221`). Right after it: `the reasoning setting may have been refused (status 400); retrying without it` and `the retry without the reasoning setting worked; sending none from now on` (`driver.log:227`–`228`). No later summary carried the setting.
- **Self-prompting:** 34.4 min in 9 loop runs (the last open at the end). All 133 calls had their usage line inside a run.
- **Providers:** Wafer 108, Near AI 20, DigitalOcean 5. Near AI was dearer per token: summary 16 (15:32:38) cost USD 0.008148 for 16,129 completion tokens. Wafer's summary 20 cost USD 0.003153 for 16,966.

### Every memory summary (`memory-summaries.txt`)
The memory texts are in the journal (`Memory updated to:`), so `memory-summaries.txt` lists all 22, redacted. For each: the usage line's time, provider, tokens, USD, the reply's length, and the memory text. The bot's `memory.json` on the CX23 is not readable from here.

The reply lengths in characters, in order:

> 352, 425, 413, 428, 538, 495, 519, 499, 498, 498, 504, 471, 507, 477, 500, 496, 495, 493, 491, 488, 484, 494

- From summary 5 on, every reply is 470 to 540 characters.
- Their reasoning tokens go from 159 (summary 1) to 9,710 (summary 9, 14:55:04), drop back (summaries 10 to 12: 5,480, 3,687, 2,043), and rise to about 16,000 (summary 16: 15,934; 18: 16,003; 20: 16,783 at 16:17:16).
- Four replies were over 500 characters (summaries 5, 7, 11 and 13: 538, 519, 504 and 507). history.js cut each memory to 500 characters and added `...(Memory truncated to 500 chars. Compress it more next time)`, so those memory lines are 562 characters.

## What happened
### Day 1 (14:43–14:58)
- **The agenda:** rocks, sticks and the crude axe; logs; the weapon (the club); the first plank. The `shelter_blocks` and `food` steps started at 14:45:40 and 14:46:32.
- **Death 1 (14:47:10):**
  - Two seconds into a `!forage` on a `harvestcraft:shadedgarden`, the bot logged three hits of 5.5, each with the source `unknown` (`driver.log:556`–`572`):
    - **14:46:58:** health 15.7 → 10.2, at -52.8, 66, -78.2, `near zombie@10.9m`;
    - **14:46:59:** 11.3 → 5.8, `near zombie@11.7m`;
    - **14:47:02:** 6.5 → 1, `near zombie@8.9m`. It then logged `flee zombie (low health 1)`.
  - The flee took it 19 blocks to -70, 62, -71, where it died (`[death] died at -70, 62, -71`). The server says `slain by Grove Sprite` (`server.log:1084`): a mob's melee hit.
  - **What the hurt lines can show, and what they can't:**
    - **They can never name a grove sprite.** rotn-data gives `primitivemobs:grovesprite` threat level `none` (it fights back only when provoked), so `mayHurt()` is false for it (`survival_log.js:87`–`92`). That leaves it out of the 5 m source check, which yields `unknown` when nothing else fits, and out of the hurt-detail's 16 m list. So `near zombie@10.9/11.7/8.9m` says nothing about the sprite, which may have been next to the bot.
    - `unknown` is our attribution. `cause none` is `bot.lastDamageCause`, not the server's damage type.
    - **The hits fit the sprite.** Each drop is exactly 5.5, the sprite's damage (3, plus Rough Mobs' 2.5).
    - **The last hit is not logged.** 1 → 0 is under the hurt line's 4-point minimum. The sprite most likely followed the 19-block flee and struck at -70, 62, -71.
    - **Health was 15.7 before the first logged hit,** but 20 at the 14:46:11 food line (`driver.log:471`). What took the 4.3 is not logged: each drop was under the 4-point minimum, or there was no line at all.
  - **Open question (for rotn-data):** nothing in the journal hurt the sprite first. The commands from 14:45:51 to 14:46:56 were `!agenda`, `!collectBlocks("betterwithmods:dirt_pile", 56)`, `!agenda`, `!forage`, `!searchForBlock("harvestcraft:shadedgarden", 64)` and `!forage`; there was no `!attack`, no hunting reflex (the first is at 14:49:53), no swing and no fight. Either "fights back only when hurt" is incomplete for this mob in this pack, or something unlogged provoked it.
  - **Lost:** 69 logs, 60 dirt piles, 11 spruce seeds, 6 sticks, 7 rocks, **1 bread (its only food)**, the bundle and the bark. `club_wood` is also on the list; the club is kept in the off hand.
- **Respawn 1:** `escape (try 1 of 3): sprinting at least 64 blocks from the spawn and 1 recent death spot, 1 player zombie near …` (14:47:13). Then `escape done: 64 blocks … at 26, 73, -52 in 18 s` (14:47:31). The first listing after it (14:54:07, `driver.log:1074`) shows the scroll, the club, 1 plank, 2 sticks, 60 dirt piles, 2 sheep intestines, wool, 1 wheat and seeds, and **no food**.
- **Food after respawn 1:**
  - Two hunts killed `ewe_dorset` (14:49:53, 14:52:20), each `no drop seen within 4 blocks in 3 s`. Item collecting then picked up the mutton (14:49:56, `Picked up 1 items.`).
  - The eat reflex ate it at once: 3 `animania:raw_prime_mutton` (about 1.1 hunger each) at 14:49:58–14:50:01 (food 10 → 13). Then 2 mutton, a broccoli and a quinoa at 14:52:22–14:52:27 (food 9 → 13).
  - A ram was out of reach (14:51:17). Foraging got food twice (14:51:48, 14:52:33).
- **Later steps:** Crafting Tools, the table, planks and sticks, and the stone pickaxe (14:56:43). The bot then made 4 `limestone_cobble`.
- 1 `needs a better tool` line (14:57:01, below).

### Night 1 (14:58–15:24)
- `sunset is near` came at 14:58:04: `food worth 0 hunger held, food 10; less than 6: staying sealed anyway (never out for food at night)`.
- The bot was `in the shelter at 72, 64, 84` at 14:58:07. It refused the scroll at 14:58:08 (below).
- Food fell 10 → 3 by the morning, with `no safe food in the inventory` every 30 s.
- **The morning dig-out** (15:23:08–15:23:57, `driver.log:1610`–`1624`):
  - all 4 sides: `no free cell within 3 blocks`;
  - east stairs: `no step at 74, 65, 84 (it is open)`; north stairs: `no way up within 4 steps`;
  - west: `limestone_cobble at 72, 66, 84 was not dug within 4.0 s`, then `could not open the west side`;
  - then `the south side (stairs up, 2 steps, 4 blocks)`, out at 72, 66, 87.

  The morning scroll check refused again (below).

### Day 2 (15:24–15:38)
- **The search for food:**
  - At food 3 to 1 the bot ran `!forage` 4 times (nothing ripe) and `!moveAway(16)` twice.
  - `!searchForEntity` was capped at 32 blocks (`Searching 32 blocks at most at food 2, not 64 …`) and found no sheep within 32 blocks, while ewes and rams were in sight farther out.
  - 2 `!attack` calls found nothing to attack (15:26:00, 15:26:09).
  - At 15:26:50 the model walked back to `73, 64, 84` ("my known foraging spot", in fact the night-1 shelter).
  - `!consume("wheat")` at 15:27:38 ended in `Promise timed out` (15:27:41); wheat is not food.
- **Death 2 (15:29:24):** `hurt 20 health 20->0 (by starving)` at 72, 64, 84. `(by starving)` means `bot.food` was 0 at that moment (`survival_log.js:101`); Hunger Overhaul kills 4 s after food 0. The last food line, at 15:28:52, read 1; the food lines come once a minute. The `zombie_players:zombie_player@0m` in the hurt-detail (`driver.log:1945`) is most likely the one this death raised.
- **Lost:** 72 dirt piles, 9 logs, 4 rocks, 3 dirt, 6 planks, 2 sticks, the club (`club_wood:16`, kept in the off hand) and the stone pickaxe.
- **Respawn 2:** `no place 64 blocks from the spawn and 1 recent death spot within 160; the agenda resumes here` (15:29:27). No escape ran.
- Food was 12 after the respawn. The agenda started `stone_axe` at 15:34:30.

### Night 2 (15:38–16:13)
- `sunset is near` came at 15:38:15 (`food worth 0 hunger held, food 12`).
- **No shelter all night.** The shelter was refused for lack of dirt: `you have 0 dirt and 0 dirt piles, and a dirt shelter needs 8 dirt` at -40, 66, -64; later `6 dirt … needs 10` at -54, 70, -102.
- **The hole shelter** failed twice:
  - at 15:48:17, `failed (interrupted again (more than 2 times))` (`driver.log:2084`);
  - at 16:00:22, after 6 self-defense interrupts and 1 by eating: `failed (interrupted again (more than 6 times by a threat reflex))` (`driver.log:2324`).
- **7 open fights against zombies** from 15:52:27 to 16:00:29: 5 kills, 2 `stopped` with `flee zombie (outnumbered)`. One hit taken: `hurt 5.9 (by zombie)` at 15:54:49.
- The bot ate rotten flesh twice at food 5 (`eating minecraft:rotten_flesh:0 although it is avoided (hunger)`, 15:55:47 and 16:00:50).
- Food reached 3 by the morning (16:12:35).

### Day 3 (16:13–16:18)
- Foraging got food twice: a tea leaf at 16:12:54 (food 3 → 4) and a zucchini at 16:17:20 (food 1 → 2).
- 5 `!searchForEntity` calls at 32 blocks found nothing (16:13:26 to 16:14:54). One got the new `None of …` line (16:13:34).
- 1 close-name suggestion (16:17:28).

### Night 3 (16:18–16:43)
- `sunset is near` came at 16:17:47 (`food worth 0 hunger held, food 2`).
- **No shelter.** The shelter was refused for lack of dirt (`you have 4 dirt … needs 9`). The hole shelter found no place (`not quick to dig by hand 82, space not free 64, no wall 1; at -2, 71, -46, on dirt`) 5 times.
- **Death 3 (16:26:39):** `hurt 4.1 health 14.1->10 (by starving)` (16:26:37), then `hurt 10 health 10->0 (by starving)`. The food lines had read 1 since 16:22:53. It died at -2, 71, -46, with `[night] death: not in a shelter any more`.
- **Lost:** 17 rocks, 4 dirt, the leather chestplate, the food book, the club (`club_wood:57`) and 1 wheat; XP level 3 → 0.
- **Respawn 3:** `escape (try 1 of 3): sprinting …` (16:26:43), then `escape done: … at -66, 73, -138 in 20 s` (16:27:03). Then:
  - `it is night: building a shelter`;
  - `after the respawn escape: sheltering here at -66, 73, -138, a hole first`;
  - `respawned with 0 shelter blocks, and the dirt shelter here needs 9: digging 36 dirt piles by hand within 8 blocks first (at most 45 s)`.
- `the dirt gather ended: 0 piles, 0 shelter blocks (stopped)` came at 16:28:40. A zombie fight started at 16:28:43 (killed, 16:28:50), and then came `self_defense interrupted 'action:gatherDirt'`.
- The hole shelter found no place at 4 sites, the last two `head in water` and `feet in water`. A walk to `-60, 64, -158` did not help: `needs 5 dirt`.
- A second zombie fight at 16:34:09 (killed) followed `hurt 5.4 (by zombie)`.
- Foraging got food at 16:42:52 (food 7 → 9). Morning came at 16:43:08, and the runner stopped the unit at 16:43:19.

## The lines the lead asked for
### The scroll: sunset and morning checks, way-out lines, use, roof, respawns
**Checks:** 2, both at the night-1 shelter (72, 64, 84). Nights 2 and 3 had no closed shelter, so there was no check.

**Sunset 1** (14:58:08, `driver.log:1533`–`1534`):
> `[night] the scroll's way out from 72, 64, 84 (a blocking cell: its block, its dig time by hand or with the items a death keeps, then the best tool carried): east 73,64,84 contenttweaker:limestone_cobble never (stone_pickaxe 1500 ms), 73,65,84 contenttweaker:limestone_cobble never (stone_pickaxe 1500 ms); west open, but no walk to 8 blocks from there; south open, but no walk to 8 blocks from there; north open, but no walk to 8 blocks from there`
> `[night] the Scroll of New Life is not used at 72, 64, 84: no walkable way out of 72, 64, 84 to 8 blocks (a respawn there could not leave without digging)`

**Morning 1** (15:23:57, `driver.log:1622`–`1623`), after the dig-out:
> `[night] morning: the scroll's way out from 72, 64, 84 (…): east 73,64,84 contenttweaker:limestone_cobble 1500 ms (stone_pickaxe 1500 ms), 73,65,84 contenttweaker:limestone_cobble 1500 ms (stone_pickaxe 1500 ms); west open, but no walk to 8 blocks from there; south open, but no walk to 8 blocks from there; north open, but no walk to 8 blocks from there`
> `[night] morning: the Scroll of New Life is not used at 72, 64, 84: no walkable way out of 72, 64, 84 to 8 blocks (a respawn there could not leave without digging)`

**Reading the two lines** (the lines are the record; this is a reading of them):
- The east wall is the bot's own `limestone_cobble`.
  - At sunset it is `never` by hand or with what a death keeps.
  - In the morning it is `1500 ms`, the time with the stone pickaxe.
- The other three sides are open next to the bot, but no walk reaches 8 blocks from them.
- The dig-out found no free cell within 3 blocks on any side.
- So the site looks like a hollow in terrain. The lines do not say whether the scroll would pass with the east wall counted free.

**The rest:**
- **Morning use:** 0.
- **Roof line:** 0. The `took down the roof block` / `the roof … stays` lines (`night_routine.js:1660`–`1661`) come only after a morning use.
- **Respawns at the scroll spot:** 0. The scroll set no spawn point. Respawns 1 and 3 ran the escape from the world spawn; respawn 2 found no place 64 blocks away.

### Deaths
| # | Time | Place | Cause (server) | The lines before it |
| --- | --- | --- | --- | --- |
| 1 | 14:47:10 | -70, 62, -71 | `slain by Grove Sprite` | 3 × `hurt 5.5 (by unknown)`, the sprite's damage; the source check leaves out level-`none` mobs, so the lines cannot name it; health 15.7 before the first logged hit (20 at 14:46:11); the last hit is unlogged; `flee zombie (low health 1)` |
| 2 | 15:29:24 | 72, 64, 84 | `starved to death` | food lines at 1 from 15:26:52 (then 0 between two once-a-minute lines); `hurt 20 health 20->0 (by starving)`; 74 `no safe food` lines since death 1 |
| 3 | 16:26:39 | -2, 71, -46 | `starved to death` | food lines at 1 from 16:22:53 (then 0); `hurt 4.1 (by starving)`, `hurt 10 (by starving)`; the `zombie_player` in the hurt-detail (`driver.log:3036`) is most likely the one this death raised |

### The food goal lines
- The self-prompt goal for the `food` step came 11 times (14:47:08 to 16:43:09). Its text: `Food: you hold food worth N hunger in your inventory; this step wants food worth at least 8 hunger held (your hunger bar, 20 of 20, does not count toward it). On this pack hunger falls about 1 every 4 minutes … Food 0 kills you at once on this pack …`
- `[night] food for the night: food worth 0 hunger held` came 4 times: at the three sunsets, food 10 (14:58:04), 12 (15:38:15) and 2 (16:17:47); and after respawn 3, food 12 (16:27:03, `driver.log:3056`).
- **The eat reflex ate food as soon as the bot found it.** On day 1 it ate at food 9 to 12, which emptied the inventory; later it ate each find at food 1 to 8. It never kept food back for the step's 8 hunger held.
  - 13 eats in all (`[survival] ate`, each with a food change): 5 mutton, a broccoli, a quinoa, 2 rotten flesh, a tea leaf, a zucchini, a tomatillo and a spice leaf.
  - 74 `no safe food` lines between death 1 and death 2.

### `!searchForEntity` misses, `None of` / `No animals near here`
- **13 `!searchForEntity` calls:**
  - 2 found an ewe (63 and 37 blocks away);
  - 10 were `Could not find any …`, each listing the animals in sight;
  - 1 was interrupted by `unstuck` (14:48:50, `got: undefined`);
  - at food 1 to 2, the search was capped at 32 blocks (`Searching 32 blocks at most at food 2, not 64 …`).
- **`None of … near here`:** 2 lines.
  - 16:13:34 (`driver.log:2542`): `None of cow, pig, animania:sow_old_spot near here: you searched for them (3 times within 64 blocks), and only the animals above are in sight. Searching again here for them finds nothing more: move more than 128 blocks away, or do something else …`
  - 15:27:44: shortened in the journal (`… near here: you searched for them (3 times within 64 blocks) …`).
- **`No animals near here`:** 0.
- **For the owners:** several misses name an animal that is in sight but more than 32 blocks away, for example `Could not find any animania:ewe_dorset in 32 blocks. Animals in sight: … animania:ewe_dorset …` (15:26:22).

### Close-name suggestions
- 1: `Invalid block type: harvestcraft:berrygarden. Did you mean aether_legacy:berry_bush or aether_legacy:berry_bush_stem?` (16:17:28, `driver.log:2902`).

### The v0.1.19 watch items
- **Shelter fights (a mob in the bot's cells or roof cell):** 0. The only closed shelter (night 1) had no fight. All 9 fights were `(open)`.
- **Scaffolding keep/clear lines:** 0.
- **Respawn escapes:** 2. After death 1: 64 blocks in 18 s. After death 3: 64 blocks in 20 s. Both on try 1, both `escape done`. After death 2: `no place 64 blocks … within 160`, so no escape.
- **Dig-outs:** 1 shelter dig-out (morning 1, above). 0 respawn dig-outs (`dug out of the enclosed respawn spot`).
- **The loop breaker:** 0.
- **The night dirt gather:** 1. It started at 16:27:03 after respawn 3 and ended `0 piles, 0 shelter blocks (stopped)` at 16:28:40. A zombie fight started 3 s later.
- **Pre-arm at a respawn (`from the off hand into the main hand`):** 0. Every fight's swings were with `spartanweaponry:club_wood`.
- **`no weapon in hand` (the `equipHighestAttack` false path):** 0.
- **`needs a better tool`:** 1, at 14:57:01 (`driver.log:1498`, cut off in the journal):
  `Failed to collect pyrotech:rock: undergroundbiomes:sedimentary_stone needs a better tool (Tool Progression): the tool you have cannot break it; get a higher-tier one firs…`
  The stone pickaxe had been crafted at 14:56:43.
- **Swings:** 42 `[survival] swing` lines over 9 fights. 7 fights ended `killed` (5 to 9 s); 2 ended `stopped` with `flee zombie (outnumbered)`. There were no stall-guard lines.
- **Hurt sources:** 8 hurt lines: 3 `(by unknown)` (death 1; the server names a Grove Sprite, which the lines cannot name, see death 1), 2 `(by zombie)`, 3 `(by starving)`. No `shot` or arrow line.
- **Kill pickups:** the two hunts logged `no drop seen within 4 blocks in 3 s`. Item collecting then picked up the mutton within 3 s (`Picked up 1 items.`, 14:49:56). There were no `!attack` kills; all zombie kills were self-defense.

### The rest
- **Errors:**
  - 12 `Digging aborted` lines: hole-shelter digs that reflexes interrupted, 15:48:16 to 16:12:35.
  - 2 `Promise timed out` lines: `!consume("wheat")`, 15:27:41.
  - The first `reasoning effort=none` call got a 400 and was retried (above).
- **Self-prompter:** no `standing goal budget spent` line, because the agenda was never done.

## Server-side notes (not about the bot)
- `slain by Grove Sprite` (`server.log:1084`) is the server's mob-melee death message. The bot's `unknown` and `cause none` are the bot's own attribution and `bot.lastDamageCause`, not the server's damage type.

## Step 7 (harness-ops)
- **Fresh:** `fresh: no earlier run, join or scenario; started once; world 6679 of at most 10215 ticks` (14:42:50).
- **Release:** read from the journal's `[release]` line: `rotn-v0.1.20` (`8cdfae874c78…`).
- **Conditions:** (b), (c) and (e) hold; (a) and (d) fail (no `ROTN_G4_ACCEPT`), so this is not a G4 acceptance run.
- **`test-server.sh starts`:** 1 after `up` and 1 after the run.

## For the owners (not judged here)
- **skills-rotn, food:** the bot never held food for the night.
  - The eat reflex ate every find at once (on day 1 at food 9 to 12), and the step's goal (8 hunger held) was never met. At all three sunsets, and after respawn 3, it held 0. Two deaths were starvation, at food 0 between two once-a-minute food lines that read 1.
  - Between deaths, the `low` tag fired only when food fell to 12, so `ate_when_low` saw 3 low lines.
- **skills-rotn, shelters:** after a death the bot has no dirt piles (they are lost), and every later night failed the dirt shelter.
  - The hole shelter was refused for `not quick to dig by hand` or `space not free`, or was interrupted by fights.
  - The night dirt gather ran once, for 97 s, and ended `(stopped)` with 0 piles, 3 s before a zombie fight.
  - On night 3 the bot logged `less than 6: staying sealed anyway (never out for food at night)` at food 2 (16:17:47), with no shelter to stay in. It starved at 16:26:39.
- **skills-rotn, the hurt source:** death 1's three hits are `by unknown`, and the server names a Grove Sprite. The source check and the hurt-detail list leave out level-`none` mobs (`mayHurt()`), so a provoked one can never be named. Health also went from 20 (14:46:11) to 15.7 with no line.
- **skills-rotn, attribution in memory:** memory summaries 6 to 12 (`driver.log:807`–`1493`) say `Zombie player killed me -70,62,-71`. The model took the player zombie the death raised for the killer.
- **rotn-data, open question:** what provoked the grove sprite? Nothing in the journal hurt it first (see death 1).
- **rotn-lead (#600), memory summaries:** the first `effort=none` call got a 400, and openrouter.js then sent no setting. Summaries still cost 46% of the spend, up to 16,783 reasoning tokens for about 490 characters.
- **harness-ops (PR #607):** counting summaries by the `[memory]` marker does not work when a summary and a command call overlap. The tool now pairs each call with its reply.

## Soak 13 correction
- The soak 13 README's provider line now says `Near AI` (it said `Near`; the provider name has a space).

## Files
| File | What |
| --- | --- |
| `result.json` | the runner's checks, samples, notes and step-7 facts (redacted) |
| `run.log` | the runner's console log |
| `driver.log` | the bot unit's journal for the soak (redacted; line numbers as in the raw file) |
| `server.log` | the test server's log for the soak window (redacted; line numbers as in the raw file) |
| `memory-summaries.txt` | the 22 memory summaries: each call's tokens, USD and reply length, and the memory text (redacted) |
| `step7-starts.txt` | `test-server.sh starts` right after `up` |
| `server-lifecycle.txt` | the `up` log (no `Waiting for` lines), both `starts` reads, the since-start header, the `down` log and the Hetzner counts after the delete |
