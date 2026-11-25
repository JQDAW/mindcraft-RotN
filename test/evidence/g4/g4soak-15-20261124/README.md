# G4 soak 15: `g4-soak-2h` on the CX23 service (2026-11-24/25)

**Label: the fifteenth soak, run under the lead's written GO `G4-SOAK-15-20261124`. It is never G4 acceptance evidence.**
- The run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. **All 9 checks passed**: `SMOKE-PASS (not a gate pass)`, the first soak with no failed check.
- `result.json` marks it not-gate (`gateValid: false`) for two reasons:
  - the S-run reason from #436;
  - the step-7 runner's reasons: there is no `ROTN_G4_ACCEPT` marker, so conditions (a) and (d) fail. Conditions (b), (c) and (e) hold.
- **The first soak on rotn-v0.1.21.** It ran 22:36:41 to 00:37:16 UTC, across midnight. The server log rolled over, and the runner read both files (`the marker was rolled over; saved from 2026-11-24-1.log.gz, latest.log`).
- **No death and no fight.** Two hurt lines came from a cow that the hunting reflex hunted (00:03:50, 00:03:52; health 20 → 12), 35 s after the reflex had refused that cow because a bull was near.
- **Food:** lowest food 7 (00:02:20). 8 `low` lines and 8 eats, each with a food change. The sunset lines now give points held and points needed. Sunset 3 started a food run, which ended `+0 points`.
- **Agenda:** done at 00:06:56 (`server.log:746`), 90 min after the join. The `stone_axe` step was stuck from 22:43 to 00:06.
- **Trapped underground from 22:42 to 00:01.**
  - **How it started:** two rock collects on day 1 (22:41:47 and 22:42:33) took the bot from the surface (y 64) down to y 56 (`driver.log:934`).
  - **From then on it could not dig or path out.** From 22:41:56 to 22:47:14 there were 6 `Path not found …` lines and 7 `Unable to reach …` lines (one more pair at 23:19), a `needs a better tool` refusal on `!digDown` (22:44:24), and 3 `!newAction` calls refused because code writing is off.
  - **Probable cause, not proven:** the stone pickaxe was not in `items()` or the main hand when the digs were chosen. It sat on the cursor after a rejected click at 22:41:56, and after each collect #614's weapon re-arm put it in the off hand.
    - The stone isn't too hard: every Underground Biomes stone is pickaxe level 0, so the stone pickaxe breaks it.
    - Sources: rotn-data's, net-forge's and the lead's soak 15 notes, relayed by the lead.
  - **The bot sheltered in the pocket at -58, 57, -50 on nights 1 and 2.** Both morning dig-outs failed after 3 tries (`no free cell within 3 blocks` / `no firm floor`, `no way up within 4 steps`).
  - **The model dug its own way out** at 00:01:15–00:01:25 (`Boxed in with rock right overhead`).
  - **Meanwhile:** 3 crafts of `metamorphic_cobble:6` failed with `missing ingredient`, and 18 `Server rejected transaction` lines (9 rejected clicks) came. The model blamed a bundle.
- **The Scroll of New Life was never used.**
  - Sunsets 1 and 2 at -58, 57, -50: refused, every side `open` or `a step down`, `but no walk to 8 blocks from there`.
  - Sunset 3 at -17, 89, -127: refused, `57 blocks from the spawn (it needs 100)`.
- **Cost:** USD 0.043737/h (the gate's; target 0.05), from 180 calls, all to Wafer.
  - **Memory summaries:** 29 cost USD 0.029497 (33.7%), with 147,511 reasoning tokens. One summary at 00:11:16 used **31,458 reasoning tokens** for 499 characters (USD 0.005857).
  - **Reasoning:** 97.4% of all completion tokens.

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.21` = develop `83011f50`, a fresh detached checkout. `npm ci` ran first, then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. It started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-15-20261124:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-15-20261124`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, release `rotn-v0.1.21`, which the lead deployed through the gate. The unit was inactive and disabled before the run. The human set the env `host` to this test server and confirmed it, with the file `root:root 600`. After the unit's systemd start (22:36:48), the journal shows: `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[release] rotn-v0.1.21-83011f506c72` (the harness's commit); `[state] <bot> at start: tasks=absent agenda=absent memory=absent`; `[forge-bridge] bettercombat attack: on`; the dig-time rule line. Three `Error with embedding model, using word-overlap instead.` lines at 22:36:54 |
| Test server | `mcr-test-20261124-222937`, a CPX42 in nbg1. Created 22:29:44, ready 22:34:39, deleted 00:37:38: 127 min, billed about 3 h, EUR 0.4143 plus the IPv4. The watchdog `delete-after` was 2026-11-25T02:29:44Z (TTL 4 h). Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 test SSH keys (`server-lifecycle.txt`) |
| Step-7 check | `test-server.sh starts` right after `up` (22:34:39): `starts=1 files=1` (`step7-starts.txt`). After the run, before `down`: `starts=1 files=2`. Still one start; there are two files because the log rolled over at midnight |
| World | The G2/G3/M1 seed `1880465901402976865`, fresh: `world 2581 of at most 8293 ticks` at the step-7 read |
| Server | Firewall: ports 22 and 25565 only from the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 14 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match; 0 extra mods |
| Timing | **Each join time names its source:** the unit started at **22:36:48** (systemd, `driver.log:2`). The server logged `<bot> joined the game` at **22:36:59** (`server.log:10`). The journal shows `<bot> spawned.` at **22:37:01** and `Self-prompting started.` at **22:37:02**. The runner's `login_online` passed at **22:37:05** (`run.log`). Next came 120 min of samples every 5 min (25 samples), then the runner's ctl stop. The unit was stopped at 00:37:13 (systemd: `594.2M memory peak`, 14 min 19 s of CPU). The journal covers the whole soak (`journalCoverage`: 120.1 of 120.1 min) |

## The checks (`result.json`)
| Check | Result | Detail |
| --- | --- | --- |
| `login_online` | PASS | joined, a version-4 (Mojang account) UUID |
| `naming` | PASS | `[naming]`: 12 kinds, unknown 0, all real; entities: 1 kind (`zombieawareness:entityscent`), unknown 0 |
| `no_crash` | PASS | 120 min up, 25 samples, `NRestarts` 0 throughout, no agent exit |
| `peak_memory` | PASS | 594 MiB (target 850) |
| `usd_per_hour` | PASS | USD 0.043737/h: USD 0.087551 over 120 min, 180 completions (target 0.05) |
| `agenda_done` | PASS | `agenda done` at 00:06:56 (`server.log:746`) |
| `food_floor` | PASS | lowest food 7, from 124 food lines (floor 6) |
| `ate_when_low` | PASS | ate after each of 8 `low` lines. **Not comparable with earlier soaks:** since #612 a `low` line fires at each new lower food level at or below 8, reset after an eat. Before, it fired only when food fell to 12 from above |
| `deaths_reported` | PASS | no death |

## The LLM spend (`test/tools/soak-spend.mjs`)
- **Rules:** the tool as merged in #613. Each call is paired with its caller's first line after its reply end: `Memory updated to:` means a summary. A night runs from `sunset is near` to its first `[night] morning` line, and calls go to windows by line order.
- **Summaries:** 29, the same as the 29 `[memory] summary turns` markers and the 29 `Memory updated to:` lines. 0 calls were unclear.
- **#600 lines:** `reasoning effort=none` 0 and `may have been refused` 0. #609 removed them.

| Window | Calls | Memory summaries (calls, USD, reasoning tokens) | Completion tokens | Reasoning tokens | USD |
| --- | --- | --- | --- | --- | --- |
| Day 1 (22:37:01–22:52:52) | 76 | 12, 0.004075, 17,889 | 90,319 | 86,931 | 0.027782 |
| Night 1 (22:52:52–23:17:02) | 0 | 0 | – | – | – |
| Day 2 (23:17:02–23:31:38) | 28 | 4, 0.003768, 19,063 | 85,801 | 84,398 | 0.020904 |
| Night 2 (23:31:38–23:57:01) | 0 | 0 | – | – | – |
| Day 3 (23:57:01–00:11:32) | 75 | 12, 0.018720, 94,955 | 129,471 | 126,086 | 0.035931 |
| Night 3 (00:11:32–00:37:01) | 1 | 1, 0.002934, 15,604 | 15,774 | 15,604 | 0.002934 |
| Day 4 (00:37:01–00:37:13) | 0 | 0 | – | – | – |
| **Total** | **180** | **29, 0.029497 (33.7%), 147,511** | **321,365** | **313,019** | **0.087551** |

- **USD per hour:** the gate's, 0.043737 over 120 min. The gate's USD 0.087551 equals the tool's total.
- **Reasoning:** 313,019 of 321,365 completion tokens (97.4%). Every call had a `reasoning_tokens` line.
- **Memory summaries:** 29 of 180 calls (16.1%), USD 0.029497 (33.7%). Completion tokens 151,805 (max 31,641); reasoning 147,511 (max 31,458).
  - Day 3's 12 summaries cost 0.018720 of that, with 94,955 reasoning tokens.
  - Night 3's one call is the summary at 00:12:10, after the sunset line.
- **Other calls:** 151, USD 0.058054. Completion tokens 169,560; reasoning 165,508 (max 15,355).
- **Self-prompting:** 39.3 min in 8 loop runs. 178 calls had their usage line inside a run, USD 0.083735; 2 calls were outside one.
- **Reply ends:** 4 `Empty content returned` lines, all from command calls (22:38:05, 22:40:51, 22:41:24, 23:20:11). They show as `Generated response: No response received.`

### Every memory summary (`memory-summaries.txt`)
`memory-summaries.txt` lists all 29, redacted. For each: the usage line's time, tokens, USD, the reply's length, and the memory text. The bot's `memory.json` on the CX23 is not readable from here.

The reply lengths in characters, in order:

> 414, 542, 461, 398, 398, 412, 477, 481, 489, 501, 472, 481, 495, 498, 498, 476, 469, 490, 499, 497, 496, 495, 499, 602, 498, 497, 492, 499, 492

- **Truncation:** three replies were over 500 characters (summaries 2, 10 and 24: 542, 501 and 602). history.js cut each to 500 and added `...(Memory truncated to 500 chars. Compress it more next time)` (`driver.log:310`, `1216`, `2891`).
- **Reasoning tokens:**
  - Day 1: 261 to 3,215.
  - Day 3 onward, from 00:07:26: 8,181; 8,980; 13,465; **31,458** (00:11:16); 15,604 (00:12:10).

## What happened
### Day 1 (22:37–22:53)
- **The agenda:**
  - rocks, sticks and the crude axe;
  - logs;
  - the weapon step (`crafting spartanweaponry:club_wood (try 1 of 2)`, 22:39:28);
  - the first plank, Crafting Tools, the table, planks and sticks;
  - the stone pickaxe (22:41:33);
  - cobblestone from metamorphic rocks (13 `metamorphic_cobble:6` by 22:43:01).
- **`stone_axe` stuck:** the step started at 22:43:02, and at 22:48:03 it was `stuck: 5 min of self-prompting; retry 1 of 3 in 20 min or at the next full day`.
- **The trap (22:41–22:51):**
  - **The collects:** `!collectBlocks("pyrotech:rock", 8)` (22:41:47) got 8 rocks. One break during it was refused: `Failed to collect pyrotech:rock: undergroundbiomes:metamorphic_stone needs a better tool (Tool Progression) …` (22:41:56, `driver.log:749`). Then `!collectBlocks("pyrotech:rock", 44)` (22:42:33) got 48 rocks. They took the bot from the surface (y 64) down to y 56 (`position … y: 56.00` at 22:43:59, `driver.log:934`).
  - **No path out:** from 22:41:56 to 22:47:14 (`driver.log:748`–`1085`), 6 `Path not found, but attempting to navigate anyway using destructive movements` lines and 7 `Unable to reach …` lines. The first, at 22:41:56, was `Unable to reach -58, 60, -49, you are 3 blocks away`, during the collect. The rest were to the table at -58, 64, -51 (8 blocks away) and to the surface at y 72 (16 blocks). One more came at 23:19:00 (`driver.log:1533`).
  - **`!digDown(4)`** (22:44:24) was refused: `Cannot break the block at x:-58.0, y:55.0, z:-50.0: undergroundbiomes:metamorphic_stone needs a better tool …` (`driver.log:1045`).
  - **`!newAction` was refused 3 times** (`newAction not allowed! Code writing is disabled in settings`, as it should be): 22:44:22 (`Dig straight up to the surface …`), 22:50:33 (`Dig straight up out of this burial pit …`) and 23:23:21 (unbundling rocks).
  - **Probable cause of the refusals (not proven):** the stone pickaxe was not in `bot.inventory.items()` (slots 9–44) or the main hand when the dig was chosen.
    - At 22:41:56 it was on the cursor after a rejected click (`resync: … cursor: stone_pickaxe`, `driver.log:742`–`744`).
    - After each collect, #614's weapon re-arm puts it in the off hand (slot 45). The 6 `moved stone_pickaxe from the off hand back into the inventory to dig out` lines show it there at the dig-outs.
    - The `needs a better tool (Tool Progression)` wording is misleading here: every Underground Biomes stone and cobble is pickaxe level 0, so the stone pickaxe breaks it.
    - The sources are rotn-data's, net-forge's and the lead's soak 15 notes, relayed by the lead.
  - **Pillaring:** the model said `Up to y=60 with 16 piles` (22:50:59, `driver.log:1294`). That is its own claim; the shelter at sunset was at y 57.
- **Inventory clicks:**
  - 22:41:56: an equip was rejected (`Server rejected transaction for clicking on slot 39`), resynced, and the stone pickaxe on the cursor put back in slot 39.
  - 22:48 to 22:51: the model tried to pillar up with dirt.
    - Its dirt crafts from piles (`!craftRecipe("dirt", …)`) were rejected 3 times on slots 11 and 4, each `the second try failed too` (22:50:16, 22:50:56, 22:51:00).
    - `betterwithmods:dirt_slab` then failed with `missing ingredient` (22:51:10).

### Night 1 (22:53–23:17)
- **Sunset (22:52:52):** `food for the night: food 20 (+5 saturation), held 4.2 points, the night needs about 0: enough`.
- **Shelter:** at 22:52:53 the bot was `in the shelter at -58, 57, -50`, and refused the scroll (below).
- **Morning (23:17:02–23:18:02):** the dig-out failed 3 times, 30 s apart. Each try logged:
  - `moved stone_pickaxe from the off hand back into the inventory to dig out`;
  - east, west and north: `no free cell within 3 blocks`;
  - south: `no firm floor under -58, 57, -49 (air)`;
  - stairs on every side: `no way up within 4 steps`.

  Then: `could not leave the shelter at -58, 57, -50 after 3 tries …; back to work, still enclosed: dig a way out` (`driver.log:1513`). Food was 14.

### Day 2 (23:17–23:32)
- **The bot stayed in or right next to the hole.**
  - The `stone_axe` craft failed: `Could not get within reach of the crafting table at -58, 64, -51 (7.2 blocks away …)` (23:19:00). The table is 7 blocks above the shelter.
  - Cobblestone from rocks failed 3 times: `Could not craft undergroundbiomes:metamorphic_cobble:6: the craft failed (Error: Error: missing ingredient)` (23:20:22, 23:21:10, 23:24:22), with 19 to 43 metamorphic rocks held.
  - The model blamed the bundle (`the bundle's eating my loose rocks`). It tried `!useOn("bundles:bundle", "nothing")` and turned item collecting off (23:29:49).
- The `shelter_blocks` step was stuck at 23:28:45 (`going on without it until the night`).

### Night 2 (23:32–23:57)
- **Sunset (23:31:38):** `food for the night: food 11 (+0 saturation), held 4.2 points, the night needs about 3.8: enough`.
- **Shelter:** the same one, at -58, 57, -50 (23:31:39). The scroll was refused again.
- **Eating:** a `low` line at food 8 (23:40:25), then `ate minecraft:bread:0 food 8->11` (23:40:27).
- **Morning (23:57:01–00:00:02):**
  - `a zombie at -58, 59, -49 is within 8 blocks` four times, then `after 120 s a zombie at -58, 59, -49 has not moved; health 19, holds nothing, helmet leather_helmet, sky light 0`.
  - Then `armed, health 20, but the fight cannot be judged yet (unknown: its health, its attack interval, our weapon damage, our weapon cooldown): leaving the shelter … by the side away from a zombie`.
  - The dig-out failed 3 times: east and north `no free cell`; west and south `no firm floor`; no stairs. Then `could not leave the shelter … after 3 tries` (`driver.log:2083`).

### Day 3 (00:00–00:12)
- **Getting out:**
  - Three `!searchForEntity` calls (cow, pig, sheep) found only a hen, and the third added `None of cow, pig, sheep near here …` (00:00:28).
  - `!moveAway(140)` failed, then a path to -40, 57, -30.
  - After `!nearbyBlocks` the model said `Boxed in with rock right overhead — that's why paths fail` and dug: `!collectBlocks("undergroundbiomes:metamorphic_cobble", 1)` (00:01:15), then `!collectBlocks("dirt", 1)` (00:01:25).
  - At 00:02:05 it reached -57, 65, -81 on a `searchForBlock` path.
- **Food:**
  - At 00:02:20, food 7 (the run's lowest).
  - Two eats: `harvestcraft:leekitem` (7 → 8) and `beanitem` (8 → 9) at 00:02:37–39.
  - Foraging got food 3 times (`shadedgarden` 00:02:07 and 00:03:47; `soggygarden` 00:08:06).
- **The cow:**
  - The hunting reflex left a `cow_holstein` alone: `it may belong to a player … a animania:bull_holstein within 16 blocks` (00:02:41).
  - **The hunting reflex then hunted that cow:** `weapon spartanweaponry:club_wood (hunt)` (00:03:16, `driver.log:2564`), then `hunting animania:cow_holstein: stuck (left alone for 5 min)` and `Mode hunting finished executing` (00:03:39, `driver.log:2572`–`2573`; again at 00:03:47, `driver.log:2588`). The cow hit back at 00:03:50 and 00:03:52 (below).
  - **The model's cow `!attack` replies never ran.** At 00:02:46, 00:03:20 and 00:03:42 (`driver.log:2496`, `2569`, `2585`) there is no `parsed command` or `Agent executed` after them, because a mode was running.
  - **The model's own `!attack` applies the bull rule:** `!attack("animania:hog_old_spot")` at 00:10:51 was refused with `a animania:bull_holstein within 16 blocks … Find a lone one, away from bulls.` (`driver.log:3357`).
  - A pig hunt was also `stuck` (00:04:25).
- **The agenda:** `food` was stuck at 00:05:03, and `stone_axe` was done at 00:06:56 at the remembered table. `agenda done` came at 00:06:56; the standing goal started at 00:07:00 (`server.log:747`).
- **Cobble:** `Successfully crafted undergroundbiomes:metamorphic_cobble, you now have 17 …` (00:07:20). The earlier failures had used the `:6` id.

### Night 3 (00:12–00:37)
- **Sunset (00:11:32):** `food for the night: food 9 (+0 saturation), held 5.1 points, the night needs about 5.8: short by 0.7: a food run first (at most 3 min)`.
- **Food run:** in the same second, `the food run ended: +0 points (no ripe wild food and no animal to hunt within 32 blocks); building the shelter here`.
- **Shelter:** at 00:11:35 the bot was `in the shelter at -17, 89, -127`. Scroll: `57 blocks from the spawn (it needs 100)`.
- **Eating:** 4 `low` lines at food 8, each followed 2 s later by an eat (8 → 9): sweet potato, white mushroom, jute, blueberry.
- **End:** morning came at 00:37:01, with a zombie at -18, 89, -128, and the runner stopped the unit at 00:37:13.

## The lines the lead asked for
### Food
**Every eat** (`[survival] ate`; each has a food change):

| Time | Item | Food |
| --- | --- | --- |
| 23:40:27 | `minecraft:bread` | 8 → 11 |
| 00:02:37 | `harvestcraft:leekitem` | 7 → 8 |
| 00:02:39 | `harvestcraft:beanitem` | 8 → 9 |
| 00:07:12 | `harvestcraft:leekitem` | 8 → 9 |
| 00:12:22 | `harvestcraft:sweetpotatoitem` | 8 → 9 |
| 00:20:12 | `harvestcraft:whitemushroomitem` | 8 → 9 |
| 00:28:03 | `harvestcraft:juteitem` | 8 → 9 |
| 00:35:53 | `harvestcraft:blueberryitem` | 8 → 9 |

**`low` lines** (`(low)`): 8.

| Time | Food | Next eat |
| --- | --- | --- |
| 23:40:25 | 8 | 2 s later |
| 00:00:02 | 8 | 00:02:37 (by then `no safe food in the inventory` ×3, and a `low` at food 7 at 00:02:20) |
| 00:02:20 | 7 | 17 s later |
| 00:07:10 | 8 | 2 s later |
| 00:12:20 | 8 | 2 s later |
| 00:20:10 | 8 | 2 s later |
| 00:28:01 | 8 | 2 s later |
| 00:35:51 | 8 | 2 s later |

The new rule shows in the run: after each eat back to 9, the next fall to 8 logged `low` again. **`ate_when_low` is not comparable with soaks before 15.**

**Sunset food-for-the-night lines:**

| Sunset | Food (saturation) | Held | The night needs | Verdict |
| --- | --- | --- | --- | --- |
| 1, 22:52:52 | 20 (+5) | 4.2 points | about 0 | `enough` |
| 2, 23:31:38 | 11 (+0) | 4.2 points | about 3.8 | `enough` |
| 3, 00:11:32 | 9 (+0) | 5.1 points | about 5.8 | `short by 0.7: a food run first (at most 3 min)` |

**Sunset food runs:** 1 (sunset 3). It started and ended in the same second: `+0 points (no ripe wild food and no animal to hunt within 32 blocks); building the shelter here`. There was no resume, no time-out and no walk back.

**Night food emergencies:** 0.

**Food at each sunset and morning** (the nearest food line):

| | Sunset | Morning |
| --- | --- | --- |
| Night 1 | 20 | 14 (23:17:03) |
| Night 2 | 11 | 9 (23:56:26) |
| Night 3 | 9 | 9 (00:36:51) |

**Lowest food:** 7 (00:02:20).

### `[forge-bridge]` respawn dropped-effects and attack counts
- **Dropped-effects lines:** 0. There was no respawn.
- **Attack counts:** 3 lines.
  - `attacks (minute): packets bettercombat 5, use_entity 0; calls bettercombat 5, vanilla 0, waits 6, replaced 2, gone 0, cancelled 0, reach 7, sight 2, misses 0` (00:03:57)
  - `attacks (minute): packets bettercombat 6, …, reach 10, sight 32, misses 0` (00:04:57)
  - `attacks (end): packets bettercombat 6, use_entity 0; calls bettercombat 6, …, reach 10, sight 32, misses 0` (00:37:13)

  So 6 Better Combat attack packets in all, from the cow and pig hunts.

### `[dig]` diagnosis lines and refused collects
- **`[dig]` lines:** 0.
- **Refused for the tool:** 2 (22:41:56 during a collect, and 22:44:24 on `!digDown`, above). Both are `undergroundbiomes:metamorphic_stone`, which is pickaxe level 0, so the stone pickaxe can break it. The probable cause is the pickaxe outside `items()` and the main hand (above), not Tool Progression.
- **Refused collects:** red mushrooms, twice. `!collectBlocks("red_mushroom", 1)` broke one each time (`Broke red_mushroom: no red_mushroom yet`) and ended `Collected 0 red_mushroom.` (00:09:58, 00:10:04; `driver.log:3227`–`3228`, `3266`–`3267`).
- **`missing ingredient`:** 4 failed crafts, 9 lines.
  - `betterwithmods:dirt_slab` (22:51:10).
  - `undergroundbiomes:metamorphic_cobble:6` 3 times (23:20:22, 23:21:10, 23:24:22).
  - At 00:07:20 the craft as `undergroundbiomes:metamorphic_cobble` worked.
- **`Server rejected transaction`:** 18 lines, which are **9 rejected clicks** (each click logs two lines):
  - 3 equips on slot 39: 22:41:56, 23:21:08, 23:23:44;
  - 6 craft clicks: 22:50:16, 22:50:56 and 22:50:59–22:51:00, two each (slot 11, then slot 4).

  The `[inventory]` lines resynced, and 3 times `the second try failed too` (all on day 1's dirt crafts).
  - **The click rejections:** net-forge's soak 15 click note (relayed by the lead) ties them to StackUp's real stack sizes (dirt piles and rocks stack to 256), which mineflayer's registry does not know. Not proven here.
  - **The 3 `:6` `missing ingredient` failures:** the lead's note has them as rocks probably left in the 2×2 crafting grid (slots 1–4) after a resync. `!inventory` counts those slots and the crafter does not. Open.

### Shelter after a death, the off-hand pickaxe, inventory swaps
- **Shelter after a death:** none; there was no death.
- **Off-hand pickaxe:** 6 `moved stone_pickaxe from the off hand back into the inventory to dig out`, one per morning dig-out try.
- **Inventory swaps:** 27 `[inventory]` lines. They are the rejected-click resyncs and `before equip|craft|moveSlotItem: put the … on the cursor into slot N` (dirt piles or the stone pickaxe).

### Hurt lines
2 lines, both naming the mob. `swung-0s` is the mob's own arm swing, 0 s before the hit (`survival_log.js`):

- `hurt 4 health 20->16 (by animania:cow_holstein)`, with the detail `drops 2@+0s=animania:cow_holstein,2@+1.7s=animania:cow_holstein at -1.5,85,-110.2 … near animania:cow_holstein@0.9m/swung-0s` (00:03:50, `driver.log:2611`–`2612`).
- `hurt 4 health 16->12 (by animania:cow_holstein)` (00:03:52).

The hunting reflex provoked the cow (Day 3 above); the model's cow `!attack` replies never ran. There was no fatal hit (no death).

### Deaths
0.

### Scroll lines
- **Sunset 1** (22:52:53, `driver.log:1454`–`1455`):
  > `[night] the scroll's way out from -58, 57, -50 (…): east open, but no walk to 8 blocks from there; west open, but no walk to 8 blocks from there; south a step down to -58,56,-49, but no walk to 8 blocks from there; north open, but no walk to 8 blocks from there`
  > `[night] the Scroll of New Life is not used at -58, 57, -50: no walkable way out of -58, 57, -50 to 8 blocks (…)`
- **Sunset 2** (23:31:39, `driver.log:2008`–`2009`): the same, except `west a step down to -59,56,-50`.
- **Sunset 3** (00:11:35): `the Scroll of New Life is not used at -17, 89, -127: 57 blocks from the spawn (it needs 100)`.
- **Morning checks:** 0. Mornings 1 and 2 never opened the shelter, and the run ended in morning 3's zombie wait.
- **Uses, roof lines and respawns at a scroll spot:** 0.

### The older watch items
- **Shelter fights, scaffolding lines, respawn escapes, respawn dig-outs, the loop breaker, the night dirt gather, pre-arm, `no weapon in hand`:** 0 each.
- **Shelter dig-outs:** 6 tries over mornings 1 and 2, all failed (above).
- **`needs a better tool`:** 2 (above).
- **Swings and fights:** 0 `[survival] swing` and 0 fight lines. The hunts log `weapon spartanweaponry:club_wood (hunt)` (00:03:16) and their attack packets.
- **Arrows:** 0 `shot` lines. The one `arrow` match is an inventory item (`spartanweaponry:arrow_wood`).
- **Kill pickups:** 0. There was no kill; both hunts ended `stuck`.
- **`None of … near here`:** 4 (00:00:28, 00:07:30, 00:08:16, 00:10:14). `No animals near here`: 0.
- **Close-name suggestion:** 1. `Invalid item type: metamorphic_cobble. Did you mean undergroundbiomes:metamorphic_cobble, undergroundbiomes:metamorphic_cobble_wall or undergroundbiomes:metamorphic_cobble_mossy?` (00:07:13).

## Server-side notes (not about the bot)
- The server log rolled over at 00:00 UTC. The runner saved its window from `2026-11-24-1.log.gz` and `latest.log`, and `since-start` read both (`files=2026-11-24-1.log.gz,latest.log`).

## Step 7 (harness-ops)
- **Fresh:** `fresh: no earlier run, join or scenario; started once; world 2581 of at most 8293 ticks` (22:36:42).
- **Release:** read from the journal's `[release]` line: `rotn-v0.1.21` (`83011f506c72…`).
- **Conditions:** (b), (c) and (e) hold; (a) and (d) fail (no `ROTN_G4_ACCEPT`), so this is not a G4 acceptance run.
- **`test-server.sh starts`:** 1 after `up` and 1 after the run (2 files, from the rollover).

## For the owners (not judged here)
- **skills-rotn, the trap:** the two rock collects at 22:41–22:42 went 8 blocks below the surface.
  - After them, every path and `!digDown` failed, and so did both morning dig-outs of the pocket shelter at -58, 57, -50 (`no way up within 4 steps`).
  - The bot spent day 2 and night 2 there, and the model dug out by hand on day 3.
  - The probable cause is the stone pickaxe outside `items()` and the main hand (the cursor, then the off hand after #614's re-arm).
  - The scroll check had already said `no walk to 8 blocks` from every side at sunset 1.
- **skills-rotn, false `Broke …` lines:**
  - `Broke undergroundbiomes:metamorphic_stone: no pyrotech:rock yet (it gave 4 betterwithmods:dirt_pile)` (22:41:56, `driver.log:753`). It came in the same second as the refusal of that stone, so it is not clear that the block was broken.
  - `Broke undergroundbiomes:metamorphic_cobble: no undergroundbiomes:metamorphic_cobble yet (it gave 16 pyrotech_compat:rock_metamorphic:6)`, then `Collected 0 undergroundbiomes:metamorphic_cobble.` (00:01:20, `driver.log:2235`–`2236`). The block dropped rocks, so the collect counted 0 although the dig worked.
- **skills-rotn / rotn-data, `metamorphic_cobble:6`:** the craft from `pyrotech_compat:rock_metamorphic:6` worked twice on day 1 (22:42:15, 22:43:01), then failed 3 times with `missing ingredient` (23:20:22 to 23:24:22) while the bot held 19 to 43 of those rocks. At 00:07:20 the craft as `undergroundbiomes:metamorphic_cobble` worked. The model blamed a bundle; the lines don't say why.
- **skills-rotn, the cow:** the hunting reflex refused a `cow_holstein` at 00:02:41 because a bull was within 16 blocks. Yet it hunted one 35 s later (00:03:16 to 00:03:39), and the cow hit back twice (health 20 → 12). Why?
- **skills-rotn, the sunset-3 food run:** it ended `+0 points (no ripe wild food and no animal to hunt within 32 blocks)` (00:11:32). Yet a hog and a bull were near from 00:10:45 to 00:11:20 (`driver.log:3344`–`3423`). Was that the bull rule or the 32-block cap?
- **rotn-data, red mushrooms:** two breaks of `red_mushroom` gave no drop (00:09:58, 00:10:04). Is that a pack drop rule?
- **skills-rotn, memory summaries:** the largest reasoning cost was on day 3. One summary used 31,458 reasoning tokens for 499 characters.

## Soak 14 corrections (the #608 re-review)
- The soak 14 README's open question now says nothing hurt the sprite first **from the join (14:43:08, `server.log:10`) to the first hit (14:46:58)**, without repeating the list. A check of the journal found no `!attack`, hunting, swing or fight line in that time.
- The soak 14 owner line on the memory attribution now says the model **most likely** took the player zombie for the killer.

## Files
| File | What |
| --- | --- |
| `result.json` | the runner's checks, samples, notes and step-7 facts (redacted) |
| `run.log` | the runner's console log |
| `driver.log` | the bot unit's journal for the soak (redacted; line numbers as in the raw file) |
| `server.log` | the test server's log for the soak window, from the two files across the rollover (redacted; line numbers as in the raw file) |
| `memory-summaries.txt` | the 29 memory summaries: each call's tokens, USD and reply length, and the memory text (redacted) |
| `step7-starts.txt` | `test-server.sh starts` right after `up` |
| `server-lifecycle.txt` | the `up` log (no `Waiting for` lines), both `starts` reads, the since-start header, the `down` log and the Hetzner counts after the delete |
