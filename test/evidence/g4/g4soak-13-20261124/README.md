# G4 soak 13: `g4-soak-2h` on the CX23 service (2026-11-24)

**Label: the thirteenth soak, run under the lead's written GO `G4-SOAK-13-20261124`. It is never G4 acceptance evidence.**
- The run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. It FAILED: 8 checks passed and 1 failed (`usd_per_hour`: USD 0.055172/h against 0.05).
- `result.json` marks it not-gate (`gateValid: false`) for two reasons:
  - the S-run reason from #436;
  - the step-7 runner's reasons: there is no `ROTN_G4_ACCEPT` marker, so conditions (a) and (d) fail. Conditions (b), (c) and (e) hold.
- **The first soak on rotn-v0.1.19.** `ate_when_low` passed (11 of 11 `low` lines had an eat after them; it failed in soaks 10 to 12), and so did `agenda_done` (`agenda done` at 02:34:43, `server.log:773`) and `food_floor` (lowest food 12). The run went the full 120 min with no process restart and no agent exit.
- **No death, no hurt.** Health was 20 on all 125 food lines. The bot slept through 3 nights in 3 shelters and dug out of each one in the morning. One open fight: a zombie, gone after 1 s with no swing (03:23:25).
- **The Scroll of New Life was never used.** It was refused at each of the 3 sunsets with `no walkable way out of … to 8 blocks`. The lead's extra item, why `walkableExit` found no exit, has its own section below. In short: the bot always held a stone pickaxe, but its shelter walls are the pack's cobble (`chalk_cobble`, `siltstone_cobble`, `limestone_cobble`, hardness 4). These take 1.5 s each with a stone pickaxe, over `quickDig`'s 1 s, so `scrollRefusal` does not count them as walls it can take down. On nights 1 and 3 the morning dig-out also found solid ground 3 or more blocks deep on 2 to 3 sides.
- **Most of the v0.1.19 paths the lead listed did not run.** No death or respawn means no respawn escape, dig-out after a respawn, loop breaker, night dirt gather or respawn pre-arm. No mob ever got into a shelter, so there was no shelter fight and no scaffolding line. No block was refused for its tool (`needs a better tool`: 0). No hurt line means no arrow attribution. The counts are below; a 0 is a real 0 in `driver.log`.
- **Cost:**
  - **Overall:** USD 0.0552/h, over the 0.05 target; soak 12 was 0.0343/h. 267 of 268 calls went to the provider `Wafer`, 1 to `Near`.
  - **Day 3 (03:12–03:27) cost USD 0.0672,** more than days 1 and 2 together (0.0426). Its 33 memory summaries used 177,035 completion tokens (up to 18,312 for one summary of about 500 characters) and cost 0.0344.
  - **Memory summaries:** 69 of 268 calls (26%), 42% of the spend. **Reasoning:** 95.7% of the completion tokens.
  - **While self-prompting (32.1 min):** USD 0.201/h.

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.19` = develop `2e662a1b`, a fresh detached checkout. `npm ci` ran first, then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. It started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-13-20261124:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-13-20261124`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, release `rotn-v0.1.19`, which the lead deployed through the gate. The unit was inactive and disabled before the run. The human set the env `host` to this test server and confirmed it, with the file `root:root 600`. After the unit's systemd start (01:52:06), the journal shows: `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[release] rotn-v0.1.19-2e662a1b96f5` (the harness's commit); `[state] <bot> at start: tasks=absent agenda=absent memory=absent`; `[forge-bridge] bettercombat attack: on`; `[forge-bridge] dig time: the Forge 1.12 rule from the dump is installed (modded tools dig at their speed)` (`driver.log:33`). Three `Error with embedding model, using word-overlap instead.` lines at 01:52:12 |
| Test server | `mcr-test-20261124-014132`, a CPX42 in nbg1. Created 01:41:39, ready 01:45:09, deleted 03:52:59: 131 min, billed about 3 h, EUR 0.4143 plus the IPv4. The watchdog `delete-after` was 2026-11-24T05:41:38Z (TTL 4 h). Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 test SSH keys (`server-lifecycle.txt`) |
| Step-7 check | `test-server.sh starts` right after `up` (01:45:09): `starts=1 files=1` (`step7-starts.txt`). The same after the run, before `down` |
| World | The G2/G3/M1 seed `1880465901402976865`, fresh: `world 8558 of at most 12378 ticks` at the step-7 read |
| Server | Firewall: ports 22 and 25565 only from the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 12 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match; 0 extra mods |
| Timing | The scenario ran 01:51:57 to 03:52:33 UTC. **Each join time names its source:** the unit started at **01:52:06** (systemd, `driver.log:2`). The server logged `<bot> joined the game` at **01:52:16** (`server.log:10`). The journal shows `<bot> spawned.` at **01:52:18** and `Self-prompting started.` at **01:52:19**. The runner's `login_online` passed at **01:52:23** (`run.log`). Next came 120 min of samples every 5 min (25 samples), then the runner's ctl stop. The unit was stopped at 03:52:30 (systemd: `645.1M memory peak`, 19 min 43 s of CPU). The journal covers the whole soak (`journalCoverage`: 120.1 of 120.1 min) |

## The checks (`result.json`)
| Check | Result | Detail |
| --- | --- | --- |
| `login_online` | PASS | joined, a version-4 (Mojang account) UUID |
| `naming` | PASS | `[naming]`: 3 kinds (`dynamictrees:leaves0`, `sprucebranch`, `trunkshell`), unknown 0, all real; entities: 1 kind (`zombieawareness:entityscent`), unknown 0 |
| `no_crash` | PASS | 120 min up, 25 samples, `NRestarts` 0 throughout, no agent exit |
| `peak_memory` | PASS | 645 MiB (target 850) |
| `usd_per_hour` | **FAIL** | USD 0.055172/h: USD 0.110436 over 120 min, 268 completions (target 0.05) |
| `agenda_done` | PASS | `agenda done` at 02:34:43 (`server.log:773`), 42 min after the join; the last steps (`stone_axe`, `cobblestone`) ran after night 1 |
| `food_floor` | PASS | lowest food 12, from 125 food lines (floor 6) |
| `ate_when_low` | PASS | 11 of 11 `low` lines were followed by an eat, each within 14 s |
| `deaths_reported` | PASS | no death |

## The LLM spend and the reasoning tokens (per window)
Each `[openrouter] usage` line is one call. Its `reasoning_tokens` is the line right after it. A memory summary is a call whose prompt is under 2,000 tokens. A night runs from `sunset is near` to the first `[night] morning` line.

| Window | Calls | Memory summaries (calls, USD) | Completion tokens | USD |
| --- | --- | --- | --- | --- |
| Day 1 (01:52:19–02:06:50) | 89 | 22, 0.007625 | 70,930 | 0.024936 |
| Night 1 (02:06:50–02:32:17) | 0 | – | – | – |
| Day 2 (02:32:17–02:46:45) | 52 | 14, 0.004665 | 56,305 | 0.017702 |
| Night 2 (02:46:45–03:12:18) | 0 | – | – | – |
| Day 3 (03:12:18–03:26:45) | 124 | 33, 0.034355 | 237,754 | 0.067208 |
| Night 3 (03:26:45–03:52:18) | 0 | – | – | – |
| Morning 4 (03:52:18–03:52:30) | 3 | 0 | 174 | 0.000589 |
| **Total** | **268** | **69, 0.046646 (42.2%)** | **365,163** | **0.110436** |

- **Reasoning:** 349,462 of 365,163 completion tokens (95.7%).
- **Memory summaries:** 238,478 completion tokens (65% of all), 26% of the calls.
  - The mean tokens per summary went from about 1,700 on days 1 and 2 to 5,365 on day 3.
  - The four biggest summaries on day 3 each have about 500 characters of content:

    | Time | Completion tokens | Reasoning tokens | USD | Line |
    | --- | --- | --- | --- | --- |
    | 03:14:19 | 12,501 | 12,344 | 0.0023 | `driver.log:2693` |
    | 03:15:22 | 18,312 | 18,156 | 0.0034 | `driver.log:2941` |
    | 03:16:46 | 13,026 | 12,855 | 0.0024 | `driver.log:3241` |
    | 03:22:12 | 12,998 | 12,844 | 0.0024 | `driver.log:3875` |
- **Self-prompting:**
  - **Total:** 32.1 min in 13 runs of the loop (the last one open at the stop), 262 calls, USD 0.1077 (0.201/h).
  - **Day 1 (01:52:19–02:06:50):** the loop ran from the join until sunset 1, for the agenda.
  - **Day 2:** the agenda's last steps, then the standing goal from 02:35:5x. Its daily budget was spent at 02:41:22 (`driver.log:2378`, `server.log:819`; the bot calls this "day 1").
  - **Day 3:** from 03:13:21 until its budget was spent at 03:25:12 (`driver.log:4231`, `server.log:1011`; the bot's "day 2").
- **Calls while not self-prompting:** 6 in total (USD 0.0027).
- **Why it failed:** the night windows had no calls, as in soak 12. The difference from soak 12 (0.0343/h) is day 3's memory summaries: 0.0344 on their own.

## What happened
### Day 1 (01:52–02:07)
- The agenda ran from the join:
  - rocks, sticks and the crude axe;
  - 37 logs from one tree;
  - the weapon step (`!craftRecipe("spartanweaponry:club_wood", 1)` at 01:54:40, `driver.log:327`; the club is in the inventory from 01:57:01, `driver.log:548`);
  - 56 dirt piles;
  - the first plank, Crafting Tools and the table;
  - a stone pickaxe at 02:04:13 (`driver.log:1373`).
- The bot then made 3 `siltstone_cobble` (02:05:07) and 8 `chalk_cobble` (02:06:48) from rocks for the `shelter_blocks` step.
- The foraging reflex got food 3 times (`harvestcraft:soggygarden`).
- There was 1 pathfinder timeout (02:00:03) and 1 `unstuck` interrupt (01:56:53).

### Night 1 (02:07–02:33)
- `sunset is near` came at 02:06:50 (food 18, `food worth 9 hunger held`).
- At 02:06:53 the bot was `in the shelter at 280, 65, -83`. It refused the scroll there (`driver.log:1521`).
- 1 low line and 1 eat.
- At 02:32:17 it logged `a zombie at 279, 65, -84 is within 8 blocks … staying in until it leaves`.
- 61 s later it dug out to the west. It logged no fight and no hurt.

### Day 2 (02:33–02:47)
- The agenda finished: the stone axe at 02:33:47, then cobblestone; `agenda done` came at 02:34:43.
- The standing goal ran until its budget was spent at 02:41:22.
- The bot tried `!collectBlocks("undergroundbiomes:sedimentary_stone", 4)` (02:37:25). It got `Collected 0`: the stone it dug gave `pyrotech:rock:8` and dirt piles (`driver.log:2035`).
- It made a second stone pickaxe at 02:39:36 (`driver.log:2254`) and 4 `limestone_cobble`.

### Night 2 (02:47–03:13)
- `sunset is near` came at 02:46:45 (food 13).
- At 02:46:48 it was `in the shelter at 296, 82, -77` and refused the scroll (`driver.log:2405`).
- 4 low lines and 4 eats.
- At 03:12:18 it logged `a zombie at 297, 82, -78 is within 8 blocks`. At 03:13:21 it dug out at 297, 82, -77. That was a level exit to the east: no `dig out:` side lines, which the code logs only for a step, stairs or a tunnel.

### Day 3 (03:13–03:27)
- The standing goal (food, then `shelter_blocks`) ran until its budget was spent at 03:25:12.
- The model ran `!searchForEntity` 35 times (pigs, cows, sheep, rabbits, chickens, Animania kinds) with no find, and made 11 `chalk_cobble` (3 to 14).
- One open fight at 03:23:25: `fight start zombie (open)`, `weapon spartanweaponry:club_wood (open)`, then `fight end zombie gone after 1 s` (`driver.log:3973`–`3975`). There was no swing.
- 1 `search_range` error from the model (`!searchForEntity` with a range under 32, 03:17:37).

### Night 3 (03:27–03:52)
- `sunset is near` came at 03:26:45 (food 14, `food worth 13 hunger held`).
- At 03:26:45 it was `in the shelter at 288, 66, -74` and refused the scroll (`driver.log:4260`).
- 2 low lines and 2 eats.
- Morning came at 03:52:18. It dug out to the north (`a step up, 2 blocks`) at 03:52:21.
- The runner stopped the unit at 03:52:30.

## The lines the lead asked for
### The Scroll of New Life: refusals and uses
- **Uses:** 0. The scroll was in the inventory the whole run (every inventory listing has `lifescroll:spawnscroll: 1`).
- **Refusals:** 3, one per sunset, each `no walkable way out of X to 8 blocks (a respawn there could not leave without digging)`.
- **No hole refusal and no below-the-surface refusal:** all three shelters were built by `buildShelter`, not `digPit`, and none came after a burrow.

| Sunset | Shelter (refusal) | `sunset is near` → `in the shelter` | Line |
| --- | --- | --- | --- |
| 1 | 280, 65, -83 | 02:06:50 → 02:06:53 | `driver.log:1521` |
| 2 | 296, 82, -77 | 02:46:45 → 02:46:48 | `driver.log:2405` |
| 3 | 288, 66, -74 | 03:26:45 → 03:26:45 | `driver.log:4260` |

### Why `walkableExit` found no exit (the lead's extra item)
**What the logs hold.**
- `buildShelter` logs nothing about the cells it fills or the terrain it uses. Between `sunset is near` and `in the shelter` the journal has only `executing code...`. The server log has only the two chat lines.
- `scrollRefusal` (`src/agent/respawn_escape.js:516`–`527`) logs the reason but not which cells stopped the walk.
- So the wall cells are not in the evidence. What the evidence does hold is the tools held, the blocks held, and the morning dig-out's view of each side.

**The rule in v0.1.19.**
- `scrollRefusal` counts a shelter wall (feet and head height on the 4 sides) as free only when `quickDig` holds.
- `quickDig` needs `digMs` ≤ `DIG_OUT.maxMs` (1000 ms), with the best tool held.
- `walkableExit` then needs a walk on foot to a cell 8 blocks away, with no other digging.

**Tools and wall blocks at each sunset** (inventory listings, `driver.log`):

| Sunset | Pickaxe | Other tools | Sturdy blocks held | Source |
| --- | --- | --- | --- | --- |
| 1 (02:06:50) | `stone_pickaxe` 1 (crafted 02:04:13, `driver.log:1373`) | crude axe, club (`driver.log:1199`–`1220`, 02:03:30) | `siltstone_cobble` 3 (02:05:07, `driver.log:1453`), `chalk_cobble` 8 (02:06:48, `driver.log:1514`) | crafts after the last listing |
| 2 (02:46:45) | `stone_pickaxe` 2 (the second crafted 02:39:36, `driver.log:2254`) | stone axe, club | `chalk_cobble` 6, `siltstone_cobble` 8, `limestone_cobble` 4 | listing 02:37:45 (`driver.log:2049`), the limestone craft at 02:37:53 (`driver.log:2099`) |
| 3 (03:26:45) | `stone_pickaxe` 2 | stone axe, club | `chalk_cobble` 14, `siltstone_cobble` 3, `limestone_cobble` 3 | listing 03:17:18 (`driver.log:3325`) |

The bot also held 92 to 144 `betterwithmods:dirt_pile` every night. These are not dirt blocks, and `buildShelter` takes sturdy blocks (cobblestone first).

**Dig times by the v0.1.19 rule.** These were computed offline with `walk_exit.toolDigMs` and rotn-data's dump; they are not in the logs. rotn-data gives `minecraft:stone_pickaxe` `toolClasses {pickaxe: 0}` and `speed {pickaxe: 4}`.

| Block | Hardness | Needs | Hand | Stone pickaxe | `quickDig` (≤ 1000 ms) |
| --- | --- | --- | --- | --- | --- |
| `contenttweaker:chalk_cobble` / `siltstone_cobble` / `limestone_cobble` | 4 | pickaxe, level 0 | never | **1500 ms** | **no** |
| `undergroundbiomes:igneous_stone:2` | 2.925 | pickaxe, level 0 | never | 1097 ms | no |
| `undergroundbiomes:sedimentary_stone` (0 and 2) | 1.6875 | pickaxe, level 0 | never | 633 ms | yes |
| `undergroundbiomes:metamorphic_stone:6` | 0.9 | pickaxe, level 0 | never | 338 ms | yes |
| `dirt` / `grass` | 0.5 / 0.6 | none | 750 / 900 ms | 750 / 900 ms | yes |

**So the first cause the lead named is ruled out.** The bot always held a pickaxe. But every wall block it placed is a hardness-4 cobble that the stone pickaxe takes 1.5 s to break. Each placed wall cell was therefore counted as solid. The scroll check could only pass at a site where no placed block stood between the bot and a walkable way out.

**The terrain, from the morning dig-outs** (`digOut` checks each side for a free cell within 3 blocks; this happens after `scrollRefusal`, at the same site):
- **Night 1, 280, 65, -83** (`driver.log:1555`–`1559`):
  - east and south: `no free cell within 3 blocks`;
  - north: `no firm floor under 280, 65, -84 (air)`, a drop;
  - west: `a tunnel, 4 blocks`.

  The site was cut into solid ground on two sides, with a drop on the third. The terrain alone would have refused it.
- **Night 2, 296, 82, -77** (`driver.log:2452`): a level exit on the east (297, 82, -77). There was no `dig out:` line, so no side was refused and none needed a step or a tunnel. The east side opened level onto free ground, so this refusal points at the walls more than at the terrain. The bot held 18 cobble after 02:37:53 and 9 just before its 03:14:51 craft, so about 9 net went into this shelter; most of it was placed cobble. The east wall's two cells were most likely `chalk_cobble`, `siltstone_cobble` or `limestone_cobble` (1.5 s). The logs cannot show which.
- **Night 3, 288, 66, -74** (`driver.log:4297`–`4301`):
  - east, west and south: `no free cell within 3 blocks`;
  - north: `a step up, 2 blocks`.

  The site was in a cut with ground on three sides. The terrain alone would have refused it.

**Summary.** On nights 1 and 3 the site was enclosed by terrain. On night 2 the likely cause is the shelter's own cobble walls, at 1.5 s against `quickDig`'s 1 s. On every night, a wall of placed cobble could never count as free with a stone pickaxe. This is read from the dig-out lines and the inventory, not from a cell list; a `[night]` line naming the blocking cells would settle it.

### Shelter fights and scaffolding
- **A mob in the bot's cells or the roof cell (the soak 12 death-1 type): 0.** No `from the shelter`, `cornered`, `in the opening` or `mob inside` line, and no `[survival] hurt` line.
- **Morning zombies near the shelter:**
  - 2 zombies were seen within 8 blocks at morning: 279, 65, -84 at 02:32:17 and 297, 82, -78 at 03:12:18.
  - The bot waited (`checking every 30 s, at most 2 min`), then dug out after 61 s and 63 s.
  - No fight followed either one.
- **Scaffolding keep or clear lines:** 0 (no `scaffolding` in `driver.log`).
- **Repairs:** 0 repair actions. All 30 `repair` matches are the agenda's `shelter_blocks` text. There were also 0 burrows, 0 `block did not stay` lines and 0 `water came into the shelter` lines.

### Eating (counted only on a food or count change)
- **11 `low` lines (all at food 12) and 11 eats.** Each eat line shows a food change: 12->13 for 8 of them, 12->14 for the 3 marsh mallows. Each came 1 to 14 s after its `low` line.
- **There was 1 eat that was first judged cut:**
  - `the eat of rustic:marsh_mallow:0 was cut after 485 ms (no food or count change, food 12); trying again in 3 s` (03:25:13, `driver.log:4246`);
  - then `ate rustic:marsh_mallow:0 food 12->14` and `ate … at food 12 (it showed after the eat was judged cut)` (03:25:14, `driver.log:4248`–`4249`).

  It counts once.
- No eat line without a change.
- Food runs: the foraging reflex got food 5 times (4 `harvestcraft:soggygarden`, 1 `rustic:marsh_mallow`).
- The model searched for animals from 03:13:23 and found none.

### Night respawn escapes, dig-outs, the loop breaker, the night dirt gather, pre-arm and `equipHighestAttack`
- **No death, so none of the respawn paths ran.** The counts in `driver.log`:
  - 0 `[respawn]` lines and 0 `escape`;
  - 0 `dug out of the enclosed respawn spot` and 0 `loop breaker`;
  - 0 `the dirt gather ended` (the night dirt gather runs only after a respawn, `night_routine.js:737`);
  - 0 `from the off hand into the main hand` (the pre-arm);
  - 0 `no weapon in hand` (the `equipHighestAttack` false path in the fight).
- **The morning dig-outs of the night shelters** (not respawn dig-outs), 3:

  | Morning | From | Plan | Line |
  | --- | --- | --- | --- |
  | 1 (02:33:18–22) | 280, 65, -83 | west, `a tunnel, 4 blocks`; east, south and north refused | `driver.log:1555`–`1559` |
  | 2 (03:13:21) | 296, 82, -77 | east, level (no side line) | `driver.log:2452` |
  | 3 (03:52:18–21) | 288, 66, -74 | north, `a step up, 2 blocks`; east, west and south refused | `driver.log:4297`–`4301` |

### Dig times with pack pickaxes, and `needs a better tool`
- **The new dig-time rule was installed:** `[forge-bridge] dig time: the Forge 1.12 rule from the dump is installed (modded tools dig at their speed)` (01:52:17, `driver.log:33`).
- **One fallback line:** `harvestcraft:soggygarden:0 is not in the dump, or its dumped hardness 0 is not used: prismarine's vanilla dig time (logged once)` (01:56:55, `driver.log:507`).
- **No per-dig time is logged.** The only stone dig with a pack pickaxe was the `!collectBlocks("undergroundbiomes:sedimentary_stone", 4)` at 02:37:25–02:37:42 with the stone pickaxe. It dug, but `Collected 0`: the digs gave `pyrotech:rock:8` and dirt piles, not the stone block (`driver.log:2027`–`2035`). The offline dig times are in the table above.
- **`needs a better tool (Tool Progression)`: 0.** No `dig time for X is Infinity` either.

### Fights, swings, the stall guard and arrows
- **Fights:** 1, open, against a zombie at 03:23:25, `weapon spartanweaponry:club_wood (open)`, `fight end zombie gone after 1 s` (`driver.log:3973`–`3975`). `self_defense` then logged `Successfully defended self.`
- **`[survival] swing` lines:** 0. The fight ended before the first swing.
- **Stall guard lines:** 0.
- **Hurt sources and arrow attribution:** 0 `hurt` lines and no `shot` or `arrow` line. Health was 20 on all 125 food lines.

### Kill pickups
- 0. There was no kill.
- The 4 `Picking up item!` chat lines (01:53:00, 01:55:22, 02:33:25, 03:13:23; `server.log:60`, `166`, `762`, `880`) are the item-pickup reflex; at 01:56:15 the journal held a fifth back (`not repeated in chat`). The three `picked up` matches in `driver.log` are the model's own words.

### Deaths
- **0.** No `[death]` line, no server death message, `deaths_reported` passes with `no death`.

### The rest
- **Pathfinder:** 2 `Took to long to decide path to goal!` timeouts: 02:00:03 (two lines, `driver.log:814`, `826`) and 02:38:49 (`driver.log:2218`). There was also 1 `unstuck` interrupt (01:56:53).
- **Model command errors:** 1 `!searchForEntity` call with a `search_range` under 32 (03:17:37, `driver.log:3369`).
- **The club:** crafted once, at the weapon step. It was held through the run.
- **Self-prompter stops:** 2 standing-goal budget stops (02:41:22, 03:25:12). Each is in `driver.log` (`[agenda] standing goal budget spent`) and in the server chat (`its 5 min of self-prompting for day N are spent`).

## Server-side notes (not about the bot)
- **`[Skeleton: Object successfully summoned]`:** 7 lines, 2 at 02:32:14–17 and 5 at 03:12:16–19 (`server.log:756`–`757`, `869`–`874`). Each burst came within 4 s of a `morning: a zombie … within 8 blocks` line. These are pack entities running a summon, not the bot.
- **`Data not found for <bot>`:** 1 line from `cyclicmagic` at the join.
- **Other:** `defineId` warnings and CoFH World cascading-worldgen warnings, as in earlier soaks.

## Step 7 (harness-ops)
- **Fresh:** `fresh: no earlier run, join or scenario; started once; world 8558 of at most 12378 ticks` (01:52:00).
- **Release:** read from the journal's `[release]` line: `rotn-v0.1.19` (`2e662a1b96f5…`).
- **Conditions:** (b), (c) and (e) hold; (a) and (d) fail (no `ROTN_G4_ACCEPT`), so this is not a G4 acceptance run.
- **`test-server.sh starts`:** 1 after `up` and 1 after the run.

## For the owners (not judged here)
- **skills-rotn: the scroll was refused at all 3 sunsets.**
  - With a stone pickaxe, any shelter wall of the pack's hardness-4 cobble fails `quickDig` (1.5 s against 1 s). The `free` set in `scrollRefusal` then holds no placed wall cell.
  - A shelter of placed cobble on open ground can only pass if a gap in its walls is already walkable.
  - A `[night]` line that names the cells which stopped `walkableExit`, with each cell's block and dig time, would let the next soak say which it was.
- **skills-rotn and rotn-lead, cost:** the fail is day 3's memory summaries. They had about 500 characters of content each but up to 18,312 reasoning tokens. The other windows' spend is close to soak 12's.
- **skills-rotn:** the two morning zombie lines were followed by a dig-out 61 s and 63 s later, with no fight or hurt.
  - Night 1 dug out to the west (279, 65, -83), next to the zombie's reported cell (279, 65, -84).
  - Night 2 dug out to the east (297, 82, -77), next to 297, 82, -78.
  - The lines do not show whether the zombie was still there.

## Files
| File | What |
| --- | --- |
| `result.json` | the runner's checks, samples, notes and step-7 facts (redacted) |
| `run.log` | the runner's console log |
| `driver.log` | the bot unit's journal for the soak (redacted; line numbers as in the raw file) |
| `server.log` | the test server's log for the soak window (redacted; line numbers as in the raw file) |
| `step7-starts.txt` | `test-server.sh starts` right after `up` |
| `server-lifecycle.txt` | the `up` log (no `Waiting for` lines), both `starts` reads, the since-start header, the `down` log and the Hetzner counts after the delete |
