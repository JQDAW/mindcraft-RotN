# G4 soak 19: `g4-soak-2h` on the CX23 service (2026-11-28)

**Label: the nineteenth soak, run under the lead's written GO `G4-SOAK-19-20261128`. It is never G4 acceptance evidence.**
- **FAIL, 9 of 10 checks**, with the ADR 0010 targets (850 MiB, USD 0.05/h). Only `ate_when_low` fails: 1 of 9 `low` lines had no eat after it. `result.json` marks the run not-gate (`gateValid: false`), for three reasons: the S-run reason from #436, and the step-7 runner's (a) no `ROTN_G4_ACCEPT` marker and (d) no gate/ctl hash confirmation.
- **The first soak on rotn-v0.1.25.** This release adds:
  - skills-rotn S18a, S18b and S18c: the standing goal's tools clause, sticky failures and the model's decisions, free misses from a world rule's yield, the full-inventory craft guard, a rock kind's cobble hint, and the `[collect] no … yet` diagnostics;
  - #675's `canRun` results for `!craftRecipe` and `!placeHere`;
  - rotn-data's tinder and plant-fiber planner answers;
  - net-forge's craft-result-thrown line.

  The run went from 13:53:14 to 15:53:38 UTC, on one test server.
- **Why `ate_when_low` failed** (`driver.log:3365`, 15:52:39): it was the last `low` line, 59 s before the unit's stop (15:53:38). No food line followed it. Two things came together:
  1. **A fight loop with no swing.** At 15:48:36 (`2997`) a zombie was digging the night-3 hole shelter's wall cell -82, 65, 91, and the first fight started at 15:48:38. At 15:53:25 it stood at -83, 65, 91, diagonal to the bot. For 5 min, self_defense started a fight from inside the shelter every 4.8 s: **62 times, every one ending `No swing went out from inside the shelter, stopped: the zombie is in reach but out of sight for 3 s.`** The bridge's sight refusals went from 85 to 900. The shelter was `'open'` for the fight, so the eating mode's 4-block rule applied, and the zombie in reach held the food-8 eat by design: at 8 it eats only with no threat within 4 blocks, at 6 always.
  2. **The run's end.** The check gives each `low` line a window of the next 5 food lines (about 5 min). This one had 59 s and no food line after it.

  Under the lead's ruling this stays a FAIL in this README. The check is unchanged here; the follow-up PR is (2) in the owners' notes.
- **`no_trap` PASS:** no trap span, no enclosed shelter and no escape, in the run or in any of the six live checks.
- **No death and no hurt line** in 120 min. All three shelters held. Zombies dug at the night-3 shelter twice. The first dig was fought and repaired. After the second (15:48:36) no repair or `the shelter is open` line followed, and the journal does not show that cell's state.
- **No stone-sword loop (watch item (a)).** No sword, tinder, twine or `spartanweaponry:material` craft, plan or collect in the soak. The standing goal's tools clause asked for a spare stone pickaxe once, before the second pickaxe was made. In its 12 later prompts it said `your weapon (stone_axe) and 2 pickaxes are enough: keep them, and replace one that breaks`.
- **The night routine's dirt crafts threw 13 dirt on the ground** with a full inventory (watch item (d)), at 15:28:24, 15:28:41 and 15:42:08. The full-inventory guard stopped one of the model's cobble crafts (14:35:13). The repairs still closed the shelter.
- **The memory checks (watch item (g)):**
  - **I13:** the checker reports 5 misses in 599 fields. **By hand, all 5 are checker artefacts; 0 wrong facts.**
  - **I14:** the model claimed a wrong shelter-block count **3 times** (soak 18: 4), each time while the facts line just before had the right count.
  - **I15:** 0 repeated failures.
  - **Summaries:** 0 calls.
  - **`Your decisions:` lines:** 0.
- **The agenda was done in 8.1 min** (soak 18: 7.9).
- **Cost: USD 0.012579/h** (the gate's), from 110 calls, all to Wafer. **By day 0.0347/h, by night 0/h.** Soak 18: 0.016984/h, by day 0.0470/h.
- **Rejected clicks: 1** (15:28:24, `2909`): a dirt-pile stack count of 70 against 74, answered by the resync.
- **`!getCraftingPlan`: 0 calls.**

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.25`, which is develop `4c775d3d`, in a fresh detached checkout. **`npm ci` was not run.** `node_modules` was copied from an installed agent worktree, after `cmp` and `diff -r` showed that `package.json`, `package-lock.json` and `patches/` match the tag byte for byte. Its installed mineflayer has the tag's new patch (the `craftResultDropped` event, #682); the copy used for soak 18 does not. `patch-package --error-on-fail` then reported all 9 patches applied, and `run.mjs --list` ran. Command: `run.mjs --scenario g4-soak-2h --service frcfld`, started once and not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-19-20261128:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-19-20261128`, with no start error |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, on release `rotn-v0.1.25`, which the lead deployed through the gate. Before the run the unit was inactive and disabled, and the lead had reset its Mindcraft state (archive `frcfld-20261128T133741Z`). The human set the env `host` to the soak server and confirmed it, with the file `root:root 600`. After the unit's systemd start (13:53:14, `driver.log:2`), the journal shows: `[settings] effective allow_insecure_coding=false` (`3`); `task_givers=["JQDAW"] allow_server_task_giver=false` (`4`); `[release] rotn-v0.1.25-4c775d3da274` (`5`, the harness's commit); `[state] <bot> at start: tasks=absent agenda=absent memory=absent` (`14`); `[forge-bridge] bettercombat attack: on` (`34`); and the dig-time rule line (`37`). There were three `Error with embedding model, using word-overlap instead.` lines at 13:53:20 |
| Test server | `mcr-test-20261128-134004`, a CPX42 in nbg1. Created 13:40:08, ready 13:43:02, with the watchdog `delete-after` at 2026-11-28T17:40:08Z (TTL 4 h). Deleted at 15:54:23: ran 134 min, billed about 3 h, EUR 0.4143 plus the IPv4. `down` verified the server, the Primary IPv4 and the SSH key gone. Hetzner then showed 0 servers, 0 volumes and 0 Primary IPs (15:54:23Z) |
| Step-7 check | `test-server.sh starts` right after `up` (13:43): `starts=1 files=1` (`step7-starts.txt`). After the run, before `down`: `starts=1 files=1` |
| World | The G2/G3/M1 seed `1880465901402976865`, the same as soaks 17 and 18. **This time it was checked offline after the run**, from the fetched `level.dat` (`Data.RandomSeed`), not with the console's `seed` before the host check. The world was fresh: `world 12240 of at most 15575 ticks` at the step-7 read (`run.log`) |
| Server | Firewall: ports 22 and 25565 open only to the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 18 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; all 337 zip jars match; 0 extra mods |
| Timing | systemd started the unit at **13:53:14** (`driver.log:2`). The server logged `<bot> joined the game` at **13:53:25** (`server.log:10`). The journal shows `<bot> spawned.` and `Self-prompting started.` at **13:53:27** (`driver.log:39`, `:50`). The runner's `login_online` passed at **13:53:30** (`run.log`). The runner took 120 min of samples, one every 5 min (25 samples), and stopped the unit through ctl. The `SIGTERM` came at 15:53:38 (`3452`), and the unit stopped that second. systemd reported `656.7M memory peak` and 14 min 49 s of CPU |
| After the run | `test-server.sh log 200000 since-start` (found=1, 21,277 lines, over=0), then `starts`, then `save-all flush` (15:53:55, `Saved the world`), then `test-server.sh fetch` of `level.dat`, `r.-1.-1.mca` and `r.-1.0.mca` (the area of all three shelters) into the dev server's shared folder for offline analysis, then the delete. The world files stay off the repo |

## The checks (`result.json`)
| Check | Result | Detail |
| --- | --- | --- |
| `login_online` | PASS | joined; the UUID is version 4 (a Mojang account) |
| `naming` | PASS | `[naming]`: 17 kinds, unknown 0, all real; entities: 1 kind, unknown 0 |
| `no_crash` | PASS | 120 min up, 25 samples, `NRestarts` 0 throughout, no agent exit |
| `peak_memory` | PASS | 657 MiB (target 850) |
| `usd_per_hour` | PASS | USD 0.012579/h: USD 0.025179 over 120 min, from 110 completions (target 0.05) |
| `agenda_done` | PASS | `agenda done` at 14:01:29 (`server.log:425`) |
| `food_floor` | PASS | lowest food 8 across 123 food lines (floor 6) |
| `ate_when_low` | **FAIL** | `1 of 9 low food line(s) with no eat after them`: the last one, `3365` (below) |
| `deaths_reported` | PASS | no death |
| `no_trap` | PASS | `no trap span or enclosed shelter` |

### The `ate_when_low` failure (the lead's point 3)
The 9 `low` lines are at `2332`, `2344`, `2356`, `2513`, `2887`, `2936`, `2948`, `2989` and `3365`. The eating reflex ate after 7 of the first 8, each 2 s later. After `2513` (15:16:49) it ate 57 s later (15:17:46, `2548`), when the model's `!collectBlocks("cobblestone", 8)` (`2503`, from 15:16:06) ended. That was still within the check's window. The ninth:

| Time (line) | Line |
| --- | --- |
| 15:48:36 (`2997`) | `[night] zombie is digging the shelter at -82, 65, 91: checking at once, ready to repair` |
| 15:48:37 (`2999`) | `[night] armed, health 20 above the 10.5 a zombie may hit for, and the only melee mob near: fighting it from the shelter first, then the repair` |
| 15:48:38 (`3001`, `3002`) | `[survival] fight start zombie (shelter)`; `[attack] reflex -> zombie#2614488` |
| 15:48:41 (`3007`) | the first `No swing went out from inside the shelter, stopped: the zombie is in reach but out of sight for 3 s.` |
| 15:52:39 (`3365`) | **`[survival] food 8 health 20 (low)`**, inside a fight (`3364` `fight start`, `3366` `fight end … stopped after 3 s`) |
| 15:53:25 (`3435`) | `[night] morning: a zombie at -83, 65, 91 is within 8 blocks of the shelter at -82, 65, 92; staying in until it leaves (checking every 30 s, at most 2 min)` |
| 15:53:34 (`3449`) | the last `No swing went out …` |
| 15:53:38 (`3452`) | `[agent_process] SIGTERM: stopping 1 agent(s), exiting within 5 s.` (the runner's stop) |

- **The self_defense line:** 62 lines of `No swing went out from inside the shelter, stopped: the zombie is in reach but out of sight for 3 s.`, from 15:48:41 (`3007`) to 15:53:34 (`3449`). That is one every 4.8 s (min 4 s, max 5 s): a 3-s fight, then the next one about 1.8 s later. There were 63 `fight start` and 62 `fight end` lines; the last fight was cut by the stop. One `[attack] reflex` line opened the loop. No later fight logged an attack target, and the bridge's minute lines show `targets -`.
- **The sight refusals:** the bridge's run totals read `sight 85` at 15:42:25 (`2985`, after the 15:42 fight) and `sight 215` at 15:49:25 (`3073`), then 377, 540, 701 and 865 at the next minute lines. At the end they read `sight 900` (15:53:38, `3455`). That is 815 attack calls refused for sight in 5 min, with `written bettercombat 28` unchanged: no hit went out.
- **Between 15:48:41 and 15:53:34:** no eat, no `!consume` and no eating-mode line. The `[survival]` lines in that span:
  - 4 food checks (15:48:49, 15:49:49, 15:50:49 and 15:51:49, all `food 9 health 20 (check)`);
  - the `low` line;
  - 63 `fight start` and 62 `fight end` lines.

  Health stayed 20 throughout.
- **Why no eat, as far as the code says** (`src/agent/modes.js:462`, `food.js` `EAT_AT` 8 and `EAT_NOW_AT` 6, `threats.js` `EAT_SAFE` 4 blocks):
  - The eating mode eats at food 8 or lower only `when idle or between fights and no threat is close`, and at 6 or lower always.
  - **It depends on the shelter state.** self_defense acts from inside the shelter only when `bot.rotnSheltered` is `'open'` (`modes.js:67`–`72`, `shelterQuiet`); the night routine sets that for the in-shelter fight.
    - With `'open'`, the eating mode's threat test is `threats.shelterEatBlock` without `closedAt` (`modes.js:505`–`509`), which applies the 4-block rule (`threats.js:821`–`824`).
    - With `true` (closed), only a mob in the shelter's own cells would block (`mobInShelterCells`).
  - **The eating update did run.** It comes before self_defense in the mode list, interrupts all, and `EAT_BETWEEN` includes `mode:self_defense` (`modes.js:82`, `:512`). It refused on the threat. The journal does not log that refusal.
  - **The evidence that the zombie stayed within 4 blocks:** each of the 62 fight ends says the zombie was `in reach`. Its position is logged only once, at 15:53:25 (`3435`): -83, 65, 91, diagonal to the bot's cell (-82, 65, 92).
  - So the shelter was `'open'` for the fight, the 4-block rule applied, and the zombie in reach held the food-8 eat.
- **The check's window:** `ate_when_low` judges each `low` line on the next `eatWithinMinutes` (5) food lines. `3365` came 59 s before the stop, and no food line followed it, so its window was cut to the run's end.

For skills-rotn: 62 shelter fights in 5 min with no swing possible. The zombie dug the wall cell -82, 65, 91, and at 15:53:25 it stood at -83, 65, 91, diagonal to the bot and out of sight. For harness-ops: the window follow-up, (2) in the owners' notes.

## (a) The stone-sword loop, the tools clause and the dead-end crafts
**None.** No line in `driver.log` or `server.log` names `stone_sword`, `sword`, `tinder`, `twine` or `spartanweaponry:material`: no craft, plan, collect or model reply.

**The standing goal's tools clause**, in its 13 prompts:
- 14:01:33 (`679`), the first prompt, with one stone pickaxe held: `keep a weapon and a pickaxe: make a spare stone pickaxe when you can (3 rocks and 2 sticks at a crafting table)`. The model made the spare at 14:01:57 (`743`, `746`: `you now have 2 stone_pickaxe`).
- The 12 later prompts (`760`, `907`, `1177`, `1458`, `1543`, `1577`, `1611`, `2024`, `2377`, `2460`, `2619`, `2814`) say: `keep a weapon and a pickaxe: your weapon (stone_axe) and 2 pickaxes are enough: keep them, and replace one that breaks`.
- The clause never named a sword. The stone axe counted as the weapon from 14:02:03 (`760`).

**Suppressed suggestions after a failed find (S18a's `craftDeadEnd`):** nothing to suppress. After the spare pickaxe, the clause asked for no craft, and the model attempted no craft whose input a collect had failed to find. Every `!craftRecipe` it ran succeeded (below).

## (b) Tinder, plant fiber and the drying rack
- **`!collectBlocks("pyrotech:tinder", N)`: none.** So there are no tinder breaks, gains, stop reasons or #686 odds lines to report. No `odds` or `mean yield` line appears anywhere.
- **Plant fiber and drying-rack plans: none.** There was no `!getCraftingPlan` call at all.
- The model's commands, by count:
  - `!forage` 17, `!moveAway` 13;
  - `!collectBlocks` 13, `!craftRecipe` 9, `!attack` 8;
  - `!agenda` 7, `!inventory` 6, `!entities` 6, `!goToCoordinates` 5;
  - `!searchForEntity` 4;
  - `!stats`, `!placeHere`, `!nearbyBlocks`, `!discard`, `!consume` and `!useOn` 2 each;
  - `!savedPlaces` and `!craftable` 1 each.

  That is 102 commands. 7 of them are in replies whose parsed command spans several journal lines (`164`, `351`, `413`, `774`, `857`, `1931`, `2076`).

## (c) `[result]` lines, refusals, table re-placements and merged failures
**11 `[result]` lines** (#675), all on day 1 (`205`–`743`). Ten are `ok=true`. The one failure:
> `[result] cmd=!placeHere args=["log"] ok=false code=jump-failed where=-20,88,-141 why="Could not place log at -20, 88, -141: you are in that cell, and the jump-and-place did not take (still at -20, 88, -141): the log did not stay at -20, 88, -141 (it is air)."` (13:57:05, `238`)

The retry 5 s later worked (`276`, `ok=true`).
- **Refused `!craftRecipe`: none.** The model's 9 all ran with `ok=true`:
  - for the agenda's steps: the crude axe, Crafting Tools (the reply at `411`/`413`, result `420`), table, planks, stick, stone pickaxe, stone axe and `cobblestone` ×4 (`205`–`659`);
  - the spare stone pickaxe (`743`).

  With the 2 `!placeHere`, these are the 11 `[result]` lines.
- **Refused `!placeHere`: none.** The one failure above is a failed place, not a refusal.
- **Table re-placement:** 4 `[craft] picking the crafting table up again` lines (13:57:42, 13:57:57, 14:01:13 and 14:01:55: `490`, `548`, `620`, `741`). Each came after a craft at the table, and each was followed by `Collected 1 crafting_table` (`496`, `554`, `626`, `747`). No re-placement failed.
- **xN merged failures (#675's `!cmd(args) xN:` form): none in any facts line.** No failure repeated (I15 0).

## (d) Thrown craft results and the full-inventory guard
**The bot's inventory was full by 14:35:13** (`1686`, `your inventory is full`, below). The first of 23 `[inventory] no free slot: the stone_pickaxe swapped from the off hand into the main hand for the dig` lines came at 14:37:56 (`2059`). The last listing (15:20:23, `2762`) holds 36 stacks plus the off-hand stone pickaxe, among them 66 dirt piles, 25 logs, 6 tallow and many single foraged foods and seeds.

**The model's craft: the guard worked once.** It came inside `!collectBlocks("cobblestone", 7)`, whose rock route crafts cobble first:
> `… 1 more need a free slot first (your inventory is full): free a slot (!discard something you do not need), then craft again.` and `Crafted 2 of 3 cobble from the rocks you carry: the craft stopped (see above), so no more rocks are collected for it.` (14:35:13, `1686`, `1687`)

The model's next reply was `Freeing a slot — tossing rotten flesh. !discard("rotten_flesh", 2)` (`1700`).

**The night routine's dirt crafts: 13 dirt thrown on the ground** (net-forge's line, #682). There was no guard on these. Each line reads `[forge-bridge] craft result dirt x1: thrown on the ground at … (window 0, minecraft:inventory): no inventory slot had room`:

| Time (lines) | Where | What the night routine was doing |
| --- | --- | --- |
| 15:28:24–25 (`2908`, `2913`–`2916`), 5 dirt | at -83, 65, 92 | building the night-3 hole shelter, after the first site failed (`2903`, `2904`, below) |
| 15:28:41–42 (`2929`–`2932`), 4 dirt | at -82, 65, 92 | `[night] the shelter is open at -82, 67, 92: repairing` (`2925`), right after the move into the side pocket. `the repair closed the shelter at -82, 65, 92` at 15:28:42 (`2934`) |
| 15:42:08–09 (`2979`–`2982`), 4 dirt | at -82, 65, 92 | after the fight with the zombie digging at -82, 66, 93 (`2957`–`2975`): `the shelter is open at -82, 66, 93: repairing` (`2976`), then `the repair closed the shelter at -82, 65, 92` at 15:42:09 (`2984`) |

- **Each dirt was thrown in the bot's own cell.** A full inventory cannot pick it up. Each craft batch made 4 or 5 dirt and kept none.
- **Both repairs closed the shelter**, so the closing block came from what the bot carried (it had 17 cobble, by the facts at 15:18).
- **Related lines:**
  - 15:28:39 (`2923`): `[inventory] before equip: Dropped the dirt on the cursor: no free slot for it.`
  - 15:20:12 (`2715`, `2721`): `Dropped the harvestcraft:leekitem on the cursor: no free slot for it.`, after a `!forage`. The model said `Forage gave nothing and left a leek stuck on my cursor. I'll toss some dirt piles to free a slot for it.` (`2733`) and ran `!discard("betterwithmods:dirt_pile", 10)` (`2735`).
  - The same happened with a spice leaf at 15:20:22 (`2738`, `2745`).

For skills-rotn: the night routine crafts dirt from piles with no free slot and loses the result. The guard that stopped the model's cobble craft does not cover it.

## (e) `[collect] no … yet` lines (S18c)
**64 lines**: 60 for `pyrotech:rock`, from rock piles, and 4 for `betterwithmods:dirt_pile`, from grass and dirt. **Every one says `no pickup wait` and `the cell is now air`.**

| Item | Block broken | `items near` | Lines |
| --- | --- | --- | --- |
| `pyrotech:rock` | `pyrotech_compat:rock_metamorphic` | none | 24 |
| `pyrotech:rock` | `pyrotech_compat:rock_igneous` | none | 21 |
| `pyrotech:rock` | `pyrotech_compat:rock_sedimentary` | none | 7 |
| `pyrotech:rock` | `rock_metamorphic` | 2 (nearest 1.5–1.6 blocks); 1 (5.7 blocks); 5 (0.6 blocks) | 4 |
| `pyrotech:rock` | `rock_igneous` | 2 (1.5 blocks); 5 (0.4 and 0.8 blocks) | 3 |
| `pyrotech:rock` | `rock_sedimentary` | 5 (0.6 blocks) | 1 |
| `betterwithmods:dirt_pile` | `grass` | none | 2 |
| `betterwithmods:dirt_pile` | `dirt` | none | 2 |

**The 8 with items near:**
- 14:02:28 at -1, 77, -81;
- 14:35:41 at -166, 68, 25;
- 14:36:12 at -178, 69, 26;
- 15:16:09, 15:16:14, 15:16:18 and 15:16:46, at -110/-109/-117/-108, 70/69, 33/39/34, near night 2's shelter, where the morning's zombie fight had just been;
- 15:17:26 at -130, 66, 53.

**What the lines show (`noYetDiagnostics`, `skills.js:2322`):**
- **The block broke every time** (`the cell is now air`).
- **The collectblock plugin's pickup wait never ran on any of them** (`no pickup wait`: no `collectBlock.lastPickup`).
- **In 56 of the 64, no item entity was within 8 blocks** at the moment of the line. So the drop had not appeared yet, or never did. It was not lying near the bot waiting to be picked up.
- The line cannot tell a drop that spawns a tick later from no drop at all. Telling them apart needs the drop's spawn (or its absence) after the break.

**For scale:**
- The 5 rock collects with a `Collected` end line got 28 rocks between them:
  - 6 at 13:56:15 (`137`);
  - 0 and 1 at 14:01:45–50 (`700`, `719`);
  - 18 at 14:34:25 (`1526`);
  - 3 at 15:15:51 (`2444`).
- The agenda's and the standing goal's scripted jobs collected more rocks without a `Collected` line.
- The dirt collect with 4 empty breaks still ended `Collected 56 betterwithmods:dirt_pile` (13:56:55).

**The 1-rock collects at `690`–`719` (the lead's point 4):**
- 14:01:43 (`690`, `692`): the model says `One rock short of a spare pickaxe (have 2, need 3). Grabbing one more rock: !collectBlocks("pyrotech:rock", 1)`.
- 14:01:44 (`695`): `[collect] no pyrotech:rock yet from pyrotech_compat:rock_igneous at -7, 85, -99: (no pickup wait; items near: none; the cell is now air)`. The output reads `You have reached at -7, 85, -99. Picked up 0 items. Broke pyrotech_compat:rock_igneous at -7, 85, -99: no pyrotech:rock yet. Collected 0 pyrotech:rock.` (`696`–`700`).
- 14:01:46 (`711`, `713`): the model says `The rock broke but the drop may still be on the ground. Trying again: !collectBlocks("pyrotech:rock", 1)`.
- 14:01:50 (`716`–`719`): the retry did not go back to -7, 85, -99. It walked to another pile at -13, 80, -97 (`You have reached at -13, 80, -97.`). It got `Picked up 0 items.` and then `Collected 1 pyrotech:rock (1 pyrotech_compat:rock_igneous:0).` That pile's break gave its rock, so it has no `no … yet` line.
- The first pile's rock never showed up: the next facts line (`724`) has `got 1 pyrotech:rock near -13, 80, -98 (here), just now`, the retry's one rock.

For skills-rotn: the fix comes after this evidence (S18c's note).

## (f) `no_trap`, escapes, dusk shelters and the mornings
**No `[escape]` or `[trapped]` line in the soak.** The live checks on the partial journal (14:13, 14:33, 14:53, 15:13, 15:33, 15:53; their output is in `live-checks.txt`) all showed `no_trap` ok with 0 spans, and I1, I2, I6 and I10 at 0. The scenario's `no_trap` passed with `no trap span or enclosed shelter`.

| Night | Sunset (line) | Shelter | Food for the night | Morning |
| --- | --- | --- | --- | --- |
| 1 | 14:07:57 (`1414`) | -145, 64, 14 (`1417`) | food 20, held 26.8, needs 0: enough (`1415`) | 14:33:25–29: the dig-out found no way out on the east, west and south sides (`1446`–`1451`), and took the north side, stairs up 2 steps (`1452`). `morning: dug out of the shelter at -145, 66, 11; back to work` (`1455`). The scroll was not used: `a zombie is within 16 blocks` (`1454`). Two zombie fights followed at 14:34:27 and 14:34:48 (`1530`, `1566`), with no hurt line |
| 2 | 14:47:53 (`2318`) | -114, 69, 39 (`2322`) | food 10, held 30.6, needs 4.8: enough (`2319`) | 15:13:25–15:15:25: `a zombie at -113, 69, 40 is within 8 blocks …; staying in until it leaves (checking every 30 s, at most 2 min)` 4 times (`2363`–`2367`); then `after 120 s a zombie at -113, 69, 40 has not moved; health 20, holds nothing, helmet leather_helmet, sky light 15` (`2369`); then `armed, health 20, but the fight cannot be judged yet …: leaving the shelter … by the side away from a zombie` (`2370`). `left the shelter at -115, 69, 39 on the side away from a zombie at -113, 69, 40; back to work` at 15:15:34 (`2374`). A defendSelf fight came at 15:15:52 (`2448`) |
| 3 | 15:27:53 (`2897`) | first try at -83, 68, 92 failed (`2903`, `2904`; below). Then the hole shelter at -83, 65, 92 (`2918`), a side pocket at -82, 65, 92 with the shaft sealed (`2920`, `2924`), and a repair at once (`2925`, `2934`) | food 9, held 31.4, needs 5.8: enough (`2898`) | Not reached: the first morning line came at 15:53:25 (`3435`), 13 s before the stop, with a zombie at -83, 65, 91 |

**Night 3's first site:**
> `[night] the block at -82, 68, 92 does not stay: that site is left for the night; another next` (`2903`)

> `[night] shelter try 1 of 3 failed (Shelter at -83, 68, 92 is not closed: 4 open (-82, 68, 92: the block did not stay (placed twice; now brown_mushroom; against dirt at -82, 67, 92 (face 0, 1, 0); …); -83, 68, 93: dynamictrees:trunkshell is in it; …` (`2904`)

**Night 3's zombie digs:**
- 15:42:01 (`2957`): `zombie is digging the shelter at -82, 66, 93`. The bot fought it from inside: 8 club swings, the zombie's health 20 → 0 (`2963`–`2970`). Then the repair (above).
- 15:48:36 (`2997`): `zombie is digging the shelter at -82, 65, 91`. The bot could not see this zombie, and the 62-fight loop followed (see the ate_when_low section). No repair or `the shelter is open` line followed it, and no other `[night]` check result came before the 15:53:25 morning line. The journal does not show the cell's state.

**Morning cap and mob-still-near hand-backs (`night_routine.js:2111`): none.** Night 2's morning took the 2-min wait and left by the far side. No morning reached the 5-min cap. I2's `mobStillNear` is 0.

## (g) The memory checks (`test/tools/soak-memory-checks.mjs`, #677)
`node test/tools/soak-invariants.mjs test/evidence/g4/g4soak-19-20261128`, with the checker as develop has it (#677, #681). Every miss below was checked by hand against the chat (`server.log`) and the journal (`driver.log`).

### I13: every `[memory] facts` field against the game
There were 86 facts lines. Of their fields, the checker could check 599 and could not check 256.

| Field | Match | Miss (checker) | Unverifiable | Non-trivial samples | Checker verdict | **By hand** |
| --- | --- | --- | --- | --- | --- | --- |
| agenda | 82 | 1 | 3 | 83 | fail | **0 wrong**: the checker read the `!agenda` reply and the step done 1 s later; the driver's step matched the facts (miss 1) |
| collect | 91 | 4 | 82 | 95 | fail | **0 wrong**: all 4 are the rock route's `Crafted N cobble from your rocks` end line |
| pickaxe | 73 | 0 | 13 | 73 | pass | – |
| food held | 12 | 0 | 74 | 12 | pass | – |
| shelter blocks | 17 | 0 | 69 | 17 | pass | – |
| failure | 194 | 0 | 15 | 194 | pass | – |
| shelter | 39 | 0 | 0 | 39 | pass | – |
| deaths | 86 | 0 | 0 | 0 (86 trivial `0 = 0`) | too few | no death in the soak, so nothing to sample |

**The 5 misses, each with the facts text, the state the checker read, and the verdict** (for the memory-rule judgement):

**Miss 1: `667`, 14:01:28, agenda.**
- **The facts text:** `Agenda: active, step cobblestone (make cobblestone from rocks); done: rocks, sticks, crude_axe, logs, first_plank, crafting_tools, crafting_table, planks_sticks, stone_pickaxe, stone_axe`.
- **The checker's state: `shelter_blocks,done`,** from two sources:
  - **`shelter_blocks`** is the latest source before the facts line (`agendaReplies`). It is the model's `!agenda` reply at 14:01:17 (`640`): `Agent executed: !agenda and got: agenda: active, step shelter_blocks (keep 14 blocks for the night's shelter and its repairs); done: rocks, sticks, crude_axe, logs, first_plank, crafting_tools, crafting_table, planks_sticks, stone_pickaxe, stone_axe`.
  - **`done`** is within the 3-s after-window (`agendaAfterS`). It is `agenda step cobblestone done` and `agenda done` at 14:01:29 (`server.log:424`, `:425`), 1 s after the facts line.
- **The game's own record of the step**, the agenda driver's chat:
  - `agenda step shelter_blocks: the scripted job ended: +6 shelter blocks (6 of 14; the collect's time limit)` (14:01:06, `server.log:415`);
  - `agenda step stone_axe started` (14:01:07, `:416`) and `stone_axe done` (14:01:14, `:419`);
  - `agenda step cobblestone started: make cobblestone from rocks` (14:01:14, `:420`);
  - `agenda step cobblestone done` (14:01:29, `:424`).

  The craft that finished it, `!craftRecipe("cobblestone", 4)`, ran in the facts line's own second (`659`: `[result] … ok=true`, 14:01:28; `662`: `you now have 4 undergroundbiomes:igneous_cobble:0`).
- **Verdict: checker artefact, 0 wrong facts.** At 14:01:28 the driver's step was cobblestone, from 14:01:14 to 14:01:29, and that is what the facts said.
  - The `!agenda` reply reports a different thing: the shelter-blocks step, still unmet at 6 of 14 after its job hit the time limit. The driver had moved on past it and came back to it at 14:02:52 (`server.log:446`).
  - The `done` source is the step finishing in the next second.
  - #677's B1 makes only a same-second source unverifiable, so the checker judged it.
- **For skills-rotn:** in these 11 s the model saw two different current steps, `shelter_blocks` from `!agenda` (`640`) and `cobblestone` from the facts (`667`). The model's reply at `673` (`Checking if the step advanced: !agenda`) followed.

**Misses 2–4: `1550` (14:34:40), `1583` (14:34:59) and `1617` (14:35:05), collect.**
- **The facts text, in each:** `Collects: got 3 cobblestone near -150, 62, 22 (… ), just now; got 18 pyrotech:rock near -150, 62, 22 (…), just now`.
- **The checker's state: none.** No `Collected 3 cobblestone` line is within its window. The checker's only collect source is a `Collected N <item>` line (`st.collected`). It matched the rock half of the same field, `Collected 18 pyrotech:rock (7 pyrotech_compat:rock_sedimentary:0, 9 pyrotech_compat:rock_metamorphic:6, 2 pyrotech_compat:rock_igneous:7).` (14:34:25, `1526`).
- **The game's record:** the same `!collectBlocks("cobblestone", 10)` (`1472`, 14:33:32) ends with **`Crafted 3 cobble from your rocks, of 10 asked.`** (14:34:25, `1527`). The 3 cobble are real crafts in the same output:
  - `Cobblestone from your rocks: 2 undergroundbiomes:igneous_cobble:0` and `you now have 4 undergroundbiomes:igneous_cobble:0` (`1489`, `1490`);
  - `… 1 undergroundbiomes:metamorphic_cobble:0` and `you now have 3 undergroundbiomes:metamorphic_cobble:0` (`1491`, `1492`).

  The output is shortened, but these are its last lines.
- **Verdict: checker artefact, 0 wrong facts.** A cobblestone collect's rock route reports its count as `Crafted N cobble from your rocks`, not `Collected N cobblestone`, and the checker does not read that line.

**Miss 5: `2466`, 15:16:01, collect.**
- **The facts text:** `Collects: got 3 cobblestone near -107, 70, 27 (5 E), just now; got 3 pyrotech:rock near -107, 70, 27 (5 E), just now`.
- **The checker's state: none**, as above. The rock half matched `Collected 3 pyrotech:rock (1 pyrotech_compat:rock_sedimentary:0, 2 pyrotech_compat:rock_metamorphic:6).` (15:15:51, `2444`).
- **The game's record:** `!collectBlocks("cobblestone", 8)` (`2407`, 15:15:39) ends with **`Crafted 3 cobble from your rocks, of 8 asked.`** (15:15:51, `2445`). The crafts are in its output:
  - `Cobblestone from your rocks: 2 undergroundbiomes:igneous_cobble:0` and `you now have 4 undergroundbiomes:igneous_cobble:0` (`2419`, `2420`);
  - `… 1 undergroundbiomes:metamorphic_cobble:0` and `you now have 2 undergroundbiomes:metamorphic_cobble:0` (`2421`, `2422`).
- **Verdict: checker artefact, 0 wrong facts**, for the same reason as misses 2–4.

**For the checker (a harness-ops follow-up, not in this PR):**
- **The agenda field:** an agenda source within the after-window, when the facts line's own second holds the craft that finishes the facts' step, should be unverifiable. So should a latest-earlier source that is an `!agenda` reply naming a different step than the driver's last `started` line; the chat's `started`/`done` lines are the driver's state.
- **The collect field:** `Crafted N cobble from your rocks[ (instead of …)], of M asked.` is a cobblestone collect's source.

With those, this soak's I13 would read 0 misses, with 5 or more samples in every field but deaths.

### I14: the model's wrong-state claims
The checker found 7 claims in 6 of 110 replies: 0 wrong, 6 unverifiable. The checker's hand-check sample: `99`, `614`, `735`, `1077`, `1812`, `2556`.

**By hand, the 10 replies that give a shelter-block count or say the blocks are met** (watch item (g), soak 18: 4 wrong): **3 wrong, all upward, all on day 1 within 30 s.** Each time, the facts line just before had the right count. The other replies that mention shelter blocks or cobble give no count: `650`, `974`, `1370`, `1847`, `2195`, `2844`.

| Reply (line) | The model said | The facts line just before | Right count |
| --- | --- | --- | --- |
| 14:01:31 (`673`) | `That's 8 igneous cobble + 6 metamorphic cobble = 14 shelter blocks, goal met.` | 14:01:28 (`667`): `shelter blocks 10 of 14 (stone or cobble; 4 short; counted now, new crafts included)` | 10. The job ended `6 of 14` (14:01:06, `server.log:415`), and the craft made 4 igneous cobble (`662`: `you now have 4 undergroundbiomes:igneous_cobble:0`) |
| 14:01:43 (`690`) | `Shelter blocks now 14 (8 igneous + 6 metamorphic cobble) — that's done.` | 14:01:34 (`684`): `shelter blocks 10 of 14 (stone or cobble; 4 short; counted now, new crafts included)` | 10, as above |
| 14:02:01 (`758`) | `standing goal fully met: food 15.2, 14 cobble, club, two pickaxes.` | 14:01:57 (`752`): `shelter blocks 10 of 14` | 10. The standing goal's job then restarted the step (14:02:52, `server.log:446`), and the facts reached `14 of 14` at 14:03:20 (`883`) |

The other 7 were right:
- `14 blocks secured` (`883`) and `14 cobble` (`902`), with the facts at 14 of 14;
- `All reserves are set` (`956`; facts `950`: 14 of 14);
- `the 10 shelter blocks I still need` (`1470`; facts `1464`: 4 of 14);
- `7 shelter blocks (3 metamorphic + 4 igneous cobble)` (`1674`);
- `16 shelter blocks now` (`1812`);
- `17 cobble banked now` (`2556`). No wrong claim led to a short night: the code-built standing goal kept its own count, and each night's food line and shelter came out right.

### I15, sticky failures and `Your decisions:`
- **I15:** 0 repeats of the same failure, from 10 failed commands; 0 within 30 or 60 min. Plans asked again after a defer: 0. No reply named a target and dropped it.
- **The failure lines in the facts** (`Recent failures (newest first)`): 77 of the 86 facts lines show at least one failure. Counted by the failure each line shows first:
  - `!collectBlocks("pyrotech:rock", 1): Collected 0 pyrotech:rock.` heads 34. This is the 0-rock collect at 14:01:45 (`700`). **It is a sticky failure:** it is still in the facts at 15:16:01 (`2466`) as `(74 min ago at -5, 85, -99, 166 NE)`.
  - `!placeHere("log"): Could not place log at -20, 88, -141 …` (13:57:05) heads 15.
  - `!attack("animania:doe_new_zealand"): Could not reach …` heads 8.
  - The coal collect (`Collected 0 osv:coal_…`) heads 6.
  - `!attack("animania:buck_new_zealand")` heads 5.
  - `!collectBlocks("cobblestone", 8): Collected 0 cobblestone.` heads 4.
  - `!searchForEntity("animania:sow_old_spot", 64)` heads 2.
  - `!attack("zombie")`, `!attack("animania:sow_hampshire")` and `!attack("animania:hen_rhode_island_red")` head 1 each.

  Failures past 5 min carry their age and place, for example `(33 min ago at -5, 85, -99, 185 NE)` (`1550`).
- **`Your decisions:` lines: 0.** The model wrote one dropping reply: `Coal's deeper than I can safely dig for — skipping it. Let me forage for wild food instead while it's daytime. !forage` (14:37:22, `1952`). It is not stored as a decision: S18a's decisions are `can wait`, `is optional` and `drop the X hunt`. Nothing went back to the coal.

### Summaries, and the agenda against soak 18
- **Summaries: 0 of 110 calls, USD 0 (0%).** soak-spend reports 0 summaries, 0 summary end lines and 0 `[memory] summary turns` markers. I11 M4 check 5: `summaries 0% of USD 0.025179 …; 21 chunks cut with no summary call`.
- **Agenda step times**, from each soak's chat. Minutes after the join are in brackets. Soak 18 joined at 20:51:44, soak 19 at 13:53:25 (`server.log:10`):

| Step done | Soak 18 | Soak 19 (`server.log` line) |
| --- | --- | --- |
| logs | 20:53:05 (1.4) | 13:54:37 (1.2) (`66`) |
| sticks | 20:53:05 (1.4) | 13:54:39 (1.2) (`67`) |
| rocks | 20:54:26 (2.7) | 13:56:16 (2.9) (`185`) |
| crude_axe | 20:55:13 (3.5) | 13:56:59 (3.6) (`251`) |
| first_plank | 20:55:31 (3.8) | 13:57:20 (3.9) (`308`) |
| crafting_tools | 20:56:05 (4.3) | 13:57:29 (4.1) (`316`) |
| crafting_table | 20:56:09 (4.4) | 13:57:35 (4.2) (`320`) |
| planks_sticks | 20:56:27 (4.7) | 13:57:50 (4.4) (`335`) |
| stone_pickaxe | 20:56:35 (4.8) | 13:57:59 (4.6) (`340`) |
| stone_axe | 20:59:27 (7.7) | 14:01:14 (7.8) (`419`) |
| cobblestone | 20:59:37 (7.9) | 14:01:29 (8.1) (`424`) |
| **agenda done** | **20:59:37 (7.9)** | **14:01:29 (8.1)** (`425`) |

The gap between stone_pickaxe and stone_axe is the shelter-blocks scripted job: 13:58:03 to 14:01:06 (`server.log:341`, `:415`), which ended `6 of 14; the collect's time limit`. Soak 18's ended `7 of 14`.

## (h) `click rejected:`, `[hands] idle:`, `[attack]`, `[tool] … broke`, hurt lines and deaths
**1 rejected click** (I3):
> `[forge-bridge] click rejected: window 0 slot 17 (mode 0, button 0, action 764); client before the click: slot betterwithmods:dirt_pile x70, cursor -, grid [-, -, -, -]; server after it: slot -, cursor betterwithmods:dirt_pile x74, grid [-, -, -, -]` (15:28:24, `2909`)

- **Context:** the night-3 hole shelter's dirt craft, with a full inventory. The client counted 70 dirt piles in the slot, the server 74. That is the same kind of stack-count drift as soak 18's `1448` (7 rocks against 8).
- **The resync answered it:** `[inventory] craft: Error: Server rejected transaction for clicking on slot 17 …; Resyncing and trying once more.` (`2910`); `[inventory] resync: the server resent the window; cursor: betterwithmods:dirt_pile` (`2911`); `[inventory] before craft: put the betterwithmods:dirt_pile on the cursor into slot 17` (`2912`). The craft went on and threw its 4 more dirt (d).

**`[hands] idle:` lines: 3.**
- 15:16:03 (`2486`): `[hands] idle: the pickaxe is not in the off hand: re-arming`, after the morning's defendSelf fight (`2448`).
- 15:42:01 (`2958`) and 15:48:37 (`2998`): `[hands] idle: the weapon is not in the main hand: re-arming`. Each came at the start of a night-3 shelter fight, after the dig swaps that a full inventory forces (`no free slot: the stone_pickaxe swapped from the off hand into the main hand for the dig`, d).

**`[attack]` lines: 9.**

| Time (line) | Line |
| --- | --- |
| 14:04:14 (`1014`) | `[attack] attack (pvp) -> animania:sow_large_white#305` (the model's `!attack`: `some extra protein never hurts`) |
| 14:34:27 (`1530`), 14:34:48 (`1566`) | `[attack] defendSelf -> zombie#866803`, `-> zombie#471886`: after night 1's dig-out, then `flee zombie (outnumbered)` and `Moved 16 away from enemies` |
| 14:37:39 (`2008`) | `[attack] attack (pvp) -> animania:sow_old_spot#48288` |
| 15:15:52 (`2448`) | `[attack] defendSelf -> zombie#1484083`, after night 2's morning |
| 15:19:17 (`2636`), 15:19:32 (`2657`) | `[attack] attack (pvp) -> animania:sow_hampshire#65132`, `-> animania:doe_new_zealand#35865` |
| 15:42:02 (`2962`) | `[attack] reflex -> zombie#2432565`: 8 swings from inside the shelter, the zombie killed |
| 15:48:38 (`3002`) | `[attack] reflex -> zombie#2614488`: the out-of-sight loop |

The run's totals: `written bettercombat 28, use_entity 0; … reach 12, sight 900, misses 0` (`3455`).

**The rest:**
- **`[tool] … broke`: none.** The only `broke` outside a collect's lines is `contenttweaker:broken_stick` in an inventory listing (`2280`).
- **Hurt lines: none** (`[survival] hurt` 0; I12 0). Health was 20 in 122 of the 123 food lines. The exception is `food 9 health 19 (check)` at 15:16:03 (`2479`), 11 s after the 15:15:52 defendSelf fight: a 1-point loss with no hurt line.
- **Deaths: none.**

## (i) The LLM spend (`test/tools/soak-spend.mjs`) and `!getCraftingPlan`
| Window | Calls | Memory summaries | Completion tokens | Reasoning tokens | USD |
| --- | --- | --- | --- | --- | --- |
| Day 1 (13:53:27–14:07:57) | 61 | 0 | 18,922 | 17,482 | 0.012933 |
| Night 1 (14:07:57–14:33:29) | 0 | 0 | – | – | – |
| Day 2 (14:33:29–14:47:53) | 31 | 0 | 8,544 | 7,663 | 0.006908 |
| Night 2 (14:47:53–15:13:25) | 0 | 0 | – | – | – |
| Day 3 (15:13:25–15:27:53) | 18 | 0 | 11,412 | 10,933 | 0.005338 |
| Night 3 (15:27:53–15:53:25) | 0 | 0 | – | – | – |
| Day 4 (15:53:25–15:53:38) | 0 | 0 | – | – | – |
| **Total** | **110** | **0** | **38,878** | **36,078** | **0.025179** |

- **USD per hour:** the gate's figure is 0.012579 over 120 min. The gate's USD 0.025179 equals the tool's total.
- **Day vs night:**
  - Days: 43.6 min, 110 calls, USD 0.025179 = **0.0347/h**.
  - Nights: 76.6 min, 0 calls = **0/h**.
  - Soak 18: days 0.0470/h, nights 0/h.
- **Reasoning:** 36,078 of 38,878 completion tokens (92.8%), max 3,638 for one call. Every call had a `reasoning_tokens` line.
- **Self-prompting:** 21.4 min in 7 loop runs, with all 110 calls inside them (0.0705/h of self-prompting).
- **The standing goal's daily budget** stopped the self-prompter at 14:38:52 and 15:21:18 (`server.log:735`, `:909`). Those are the agenda's day 1 and day 2, and the spend table's Day 2 and Day 3.
- **`!getCraftingPlan`: 0 calls**, so there are no replies to quote. The soak 18 sword chain cost 27 calls (USD 0.0086, 25%). Here no chain ran.

## The soak invariants (`test/tools/soak-invariants.mjs`)
`node test/tools/soak-invariants.mjs test/evidence/g4/g4soak-19-20261128`, with develop's checker (#683, #685 and #687 included):

| Invariant | Soak 19 | Lines |
| --- | --- | --- |
| I1 trapped | **0 trap spans**; 0 escape episodes | – |
| I2 enclosed morning | 0 still-enclosed hand-backs (0 mob-still-near), 0 nights in the same shelter | – |
| `no_trap` (scenario check) | **PASS: no trap span or enclosed shelter** | – |
| I3 rejected clicks | 1 | `2909` |
| I4 dig refused with a usable tool | 0 of 0 | – |
| I5 sunset food short | 0 of 3 food-for-the-night lines; 0 food runs | – |
| I6 starving | 0 food lines at 4 or less (lowest 8); 0 `no safe food` runs over 5 min; 0 starving hurt lines | – |
| I7 gate then act | 0 of 0 refusals | – |
| I8 refused command | 0 by design; 2 replies whose command never ran | `99`, `1606` |
| I9 false collect | 0 | – |
| I10 death loop | 0 loops (0 deaths) | – |
| I11 summary cost | 0 summaries; 0% of the spend (M4 check 5: 21 chunks cut with no summary call) | – |
| I12 unattributed hurt | 0 | – |
| I13 memory facts | checker gate **fail**, 5 misses in 599 fields; **by hand all 5 are artefacts, 0 wrong facts** | (g) |
| I14 wrong-state claims | checker 0 of 7 (6 unverifiable); **by hand 3 wrong shelter-block counts by the model, with the facts right** | `673`, `690`, `758` |
| I15 repeated failures | 0; plans asked again after a defer: 0 | – |

**The two replies whose command never ran (I8):**
- `99` (13:54:42): `Crafting the club now. !craftRecipe("spartanweaponry:club_wood", 1)`. The self-prompt loop stopped 2 s later (`102`) for the agenda's scripted food job, and the club came from the agenda.
- `1606` (14:35:02): `!collectBlocks("cobblestone", 7)`. The standing goal's prompt was re-sent at 14:35:04 (`1611`), and the next reply ran the same collect (`1676`).

The baseline (`test/evidence/g4/invariants-baseline.json`) gets the soak 19 row, and the diff adds only that row.

## Owners' notes
- **skills-rotn:**
  - The night routine's dirt crafts with a full inventory threw 13 dirt in the bot's cell; there is no guard there like the model's craft has (d).
  - The inventory was full by 14:35 with foraged odds and ends (d).
  - 62 shelter fights in 5 min with no swing possible, against a zombie digging the wall cell while it stood diagonal to the bot (the ate_when_low section). The eat at food 8 waited behind it.
  - Night 3's first site failed on a block that did not stay (a brown mushroom in the cell) (f).
  - The model's shelter-block count ran high 3 times, on day 1, while the facts were right (I14).
  - 60 empty rock-pile breaks, with no item within 8 blocks in 56 of them (e).
  - The model's `skipping it` was not kept as a decision (g).
- **net-forge:** the one rejected click, a dirt-pile stack count of 70 against 74 during the hole shelter's dirt craft; the resync answered it (h).
- **harness-ops (follow-ups after this PR):**
  1. The I13 checker: an agenda step done 1 s after the facts line, and the rock route's `Crafted N cobble from your rocks` as a collect source (g).
  2. `ate_when_low` (the lead's ruling): a `low` line whose window the run's end cuts short, with no eat seen, counts as "not decided". It is never a pass, and it does not fail the check on its own. Under that rule soak 19 would read "8 fed, 1 not decided"; its recorded verdict stays FAIL.

## Files
Every file except `README.md` and `step7-starts.txt` went through `test/tools/redact-evidence.mjs <in> <out> --bot FRCFLD`. The redactor replaces addresses with `<ip>`, the bot's name with `<bot>`, UUIDs with `<uuid-v4>`, server ids with `<server-id>` and local paths with `<local>`. `redact-evidence.mjs --check` on this folder is clean, and so is `test/tools/secret-scan.mjs` after `git add`.
- `README.md`: this file, written by hand; it names no address, path or key.
- `driver.log`: the bot's journal for the run (`ssh cx23-ctl journal frcfld`), 3,462 lines. **Redacted** as above, with the line count unchanged, so the line numbers in this README are this file's lines.
- `server.log`: the test server's log as the runner read it, 985 lines. **Redacted** as above.
- `result.json`: the runner's result, with every sample. **Redacted** as above.
- `run.log`: the runner's console output. **Redacted** as above.
- `server-lifecycle.txt`: `up`, `starts`, the since-start header, `starts` again, `save-all flush`, the seed from `level.dat`, `down`, and the Hetzner counts. **Redacted** as above. The `Waiting for …` progress lines of `up` and `down` are left out.
- `step7-starts.txt`: `test-server.sh starts` right after `up`, written by hand (two lines, no address).
- `live-checks.txt`: the six live checks on the partial journal during the run (14:13 to 15:53, every 20 min), as the harness-ops session ran them: `no_trap` (the scenario's trap-span and enclosed-episode rule) and the I1, I2, I6 and I10 lines of `soak-invariants.mjs`, on the journal the watch saved. **Redacted** as above.
