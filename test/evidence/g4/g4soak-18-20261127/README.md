# G4 soak 18: `g4-soak-2h` on the CX23 service (2026-11-27)

**Label: the eighteenth soak, run under the lead's written GO `G4-SOAK-18-20261127`. It is never G4 acceptance evidence.**
- **SMOKE-PASS, 10 of 10 checks** with the ADR 0010 targets (850 MiB, USD 0.05/h). `result.json` marks it not-gate (`gateValid: false`): the S-run reason from #436, and the step-7 runner's (a) no `ROTN_G4_ACCEPT` marker and (d) no gate/ctl hash confirmation.
- **The first soak on rotn-v0.1.24** (round 17 T, E, S, S2 and V: the collect floor, cobble from rocks, the escape's own crafting table and the dusk seal, the inventory view and the idle hand repair, and net-forge's dig-click hold). Run 20:51:22 to 22:51:57 UTC, on one test server.
- **`no_trap` PASS, its first soak:** no trap span and no enclosed shelter. The one escape (21:04:45, `1359`) took the bot out of water in 6.2 s with nothing dug. No dusk seal, no escape table, no food-emergency climb: none was needed.
- **No death and no hurt line** in 120 min. All three shelters held.
- **The memory checks (item (c), the human's rule):**
  - **I13:** the checker reports 10 misses in 832 fields (gate fail). **By hand, all 10 are checker artefacts; 0 wrong facts.** pickaxe (86 samples) and food held (7) now have samples, from #662's sources.
  - **I14:** the checker finds 0 wrong of 24 claims (21 unverifiable). **By hand, the model claimed a wrong shelter-block count 4 times while the facts line just before had the right one** (`751`, `2160`, `2636`, `2692`).
  - **The sword chain:** the model went round `stone_sword` → `spartanweaponry:material:0` → `pyrotech:tinder` → "tinder is a base item" **in 6 rounds** (21:03 to 22:51), 27 of the 120 calls and **USD 0.0086, 25% of the spend**. Round by round below. My reading: the planner's answer and the standing goal's text drive it. The facts named the failures in 4 of the 5 later rounds (3–6; not at the start of round 2), and the model's own earlier answers were in its conversation, which spans self-prompt runs.
  - **I15:** 3 repeats within 10 min (1.5/h), each named in a facts line before it; 5 within 60 min.
  - **Memory summaries: 0 calls**, 0% of the spend (23 chunks cut with no summary call).
- **The agenda was done in 7.9 min** (soak 17: 12.7 min). Step times below.
- **Cost: USD 0.016984/h** (the gate's) from 120 calls, all to Wafer. **By day 0.0470/h, by night 0/h.** Soak 17: 0.0146/h overall, 0.0399/h by day.
- **Rejected clicks: 1** (21:35:44, `1448`), a stack count, not a tool's damage. The resync answered it and the craft went on.
- **Two `!getCraftingPlan` replies for rotn-data** (the lead has routed them): `pyrotech:tinder is a base item, you need to find 3 more in the world` and the step `Craft 3 pyrotech:tinder -> 3 pyrotech:material:14`.

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.24`, which is develop `5baf6732`, in a fresh detached checkout. **`npm ci` was not run** (it is OOM-killed on the dev server with several sessions up). `node_modules` was copied from an installed agent worktree after `cmp` and `diff -r` showed that `package.json`, `package-lock.json` and `patches/` match the tag byte for byte, and after a check that its mineflayer patch is the tag's (the dig-click hold is new in this tag, so soak 17's copy did not match). `patch-package --error-on-fail` then reported all 9 patches applied, and `run.mjs --list` ran. Command: `run.mjs --scenario g4-soak-2h --service frcfld`, started once, not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-18-20261127:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-18-20261127`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, on release `rotn-v0.1.24`, which the lead deployed through the gate. Before the run the unit was inactive and disabled, and the lead had reset its Mindcraft state (archive `frcfld-20261127T204359Z`). The human set the env `host` to the soak server and confirmed it at about 20:50:58Z, with the file `root:root 600`. After the unit's systemd start (20:51:30, `driver.log:2`), the journal shows: `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[release] rotn-v0.1.24-5baf67322c53` (the harness's commit); `[state] <bot> at start: tasks=absent agenda=absent memory=absent` (`driver.log:14`); `[forge-bridge] bettercombat attack: on`; and the dig-time rule line. There were three `Error with embedding model, using word-overlap instead.` lines at 20:51:37 |
| Test server | `mcr-test-20261127-204629`, a CPX42 in nbg1. Created 20:46:35, ready 20:49:46, with the watchdog `delete-after` at 2026-11-28T00:46:35Z (TTL 4 h). Deleted at 22:52:35: up 126 min, billed about 3 h, EUR 0.4143 plus the IPv4. Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 test SSH keys (22:52:39Z), and 0 volumes (counted 23:03:43Z) |
| Step-7 check | `test-server.sh starts` right after `up` (20:49): `starts=1 files=1` (`step7-starts.txt`). After the run, before `down`: `starts=1 files=1` |
| World | The G2/G3/M1 seed `1880465901402976865`, the same as soak 17, checked with the console's `seed` (20:49:55) before the host check; fresh: `world 2100 of at most 5728 ticks` at the step-7 read (`run.log`) |
| Server | Firewall: ports 22 and 25565 open only to the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 17 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; all 337 zip jars match; 0 extra mods |
| Timing | systemd started the unit at **20:51:30** (`driver.log:2`). The server logged `<bot> joined the game` at **20:51:44** (`server.log:10`). The journal shows `<bot> spawned.` at **20:51:46** (`driver.log:39`) and `Self-prompting started.` at **20:51:47** (`driver.log:50`). The runner's `login_online` passed at **20:51:47** (`run.log`). The runner took 120 min of samples, one every 5 min (25 samples), and stopped the unit through ctl. The unit stopped at 22:51:54; systemd reported `655.5M memory peak` and 17 min 8 s of CPU |
| After the run | `test-server.sh log 200000 since-start` (found=1, 21,161 lines, over=0), then `starts`, then `save-all flush` (22:52:09, `Saved the world`), then `test-server.sh fetch` of `level.dat` and `r.-1.-1.mca` (the area of all three shelters) into the dev server's shared folder for offline analysis, then the delete. The world files stay off the repo |

## The checks (`result.json`)
| Check | Result | Detail |
| --- | --- | --- |
| `login_online` | PASS | joined; the UUID is version 4 (a Mojang account) |
| `naming` | PASS | `[naming]`: 15 kinds, unknown 0, all real; entities: 1 kind, unknown 0 |
| `no_crash` | PASS | 120 min up, 25 samples, `NRestarts` 0 throughout, no agent exit |
| `peak_memory` | PASS | 656 MiB (target 850) |
| `usd_per_hour` | PASS | USD 0.016984/h: USD 0.033996 over 120 min, from 120 completions (target 0.05) |
| `agenda_done` | PASS | `agenda done` at 20:59:37 (`server.log:444`) |
| `food_floor` | PASS | lowest food 8 across 122 food lines (floor 6) |
| `ate_when_low` | PASS | the bot ate after each of the 8 `low` lines, 2 s after each |
| `deaths_reported` | PASS | no death |
| `no_trap` | PASS | `no trap span or enclosed shelter` (the #662 check: trap spans and enclosed episodes over 5 min, or a death while trapped) |

## (a) `no_trap`, and every `[escape]` / `[trapped]` line
**One escape, cleared in 6.2 s. No trap span and no enclosed shelter.** The live checks on the partial journal (20:51, 21:04 after the escape, 21:11, 21:31, 21:51, 22:11, 22:31, 22:51) all showed `no_trap` ok with 0 spans, and I1, I2, I6 and I10 at 0.

| Time (line) | Line |
| --- | --- |
| 21:04:45 (`1357`) | `[trapped] at -69, 61, -173, idle: the escape runs (day budget)`. The standing goal's day-0 budget was spent in the same second (`server.log:525`), so no model command was in flight: none was held or dropped |
| 21:04:45 (`1359`) | `[escape] stuck at -69, 61, -173 in water: getting out to -66, 63, -171 (dry ground under open sky) (up to 10 steps, 5 min)` |
| 21:04:49 (`1363`) | `[escape] the pathfinder found a way (5 moves): walking it` |
| 21:04:52 (`1364`) | `[escape] out at -66, 63, -171 (pathfinder; dug 0, placed 0) in 6.2 s` |
| 21:04:52 (`1365`) | `[trapped] out: Reached open ground at -66, 63, -171 (by the pathfinder; dug 0, placed 0, 9 dirt crafted from piles) in 6 s.` |

**The rest of watch item (a): none of them came up.**
- A crafting table made by the escape (crude axe, Crafting Tools, table): none. The escape never needed a pickaxe.
- A pickaxe re-made before it wears out: no `[pickaxe]` line and no `[tool] … broke` line in the soak.
- A dusk seal: none. No escape ran at dusk or at night.
- A food-emergency climb: none. The lowest food was 8.
- A model command held or dropped by the escape: none (above).

The scenario's `no_trap` note in `result.json` (`trapSpans`) is an empty list.

## (b) Collect floors, cobble from rocks, and walks under open sky
**The collect floor (`Left N … below y F`): 4 lines**, all from the rock and dirt collects of day 1. Three are cut by Mindcraft's shortened action output, so the count and item are partly lost:
- 20:54:27 (`157`): `…tech:rock below y 77 alone (more than 2 under where this collect started): a collect never digs or walks below that.` (from `!collectBlocks("pyrotech:rock", 6)`, which still `Collected 6 pyrotech:rock`, `158`)
- 20:55:06 (`205`): `Left 89 blocks for betterwithmods:dirt_pile below y 82 alone (more than 2 under where this collect started)` (the dirt collect for the shelter)
- 21:00:26 (`719`): `…tech:rock below y 78 alone …` (`Collected 7 pyrotech:rock`, `720`)
- 21:35:46 (`1458`): `…ollect started): a collect never digs or walks below that.` (the `!collectBlocks("cobblestone", 8)` below)

**Cobble from rocks.** As far as the logs show, every cobble in the soak was crafted from rocks. The rock route ran once from a cobblestone collect, and the model crafted the rest itself:

| Time (line) | Line |
| --- | --- |
| 20:59:38 (`642`, `643`) | `Cobblestone from your rocks: 6 undergroundbiomes:igneous_cobble:0 (4 pyrotech_compat:rock_igneous:0 each).` (the model's `!craftRecipe("cobblestone", 6)`) |
| 21:00:30 (`739`, `740`) | `… 1 undergroundbiomes:metamorphic_cobble:0 …`, `you now have 9 undergroundbiomes:metamorphic_cobble:0` |
| 21:35:46 (`1454`–`1460`) | **The rock route:** `!collectBlocks("cobblestone", 8)` → `Stone here drops rocks with a pickaxe below Sturdy (cobblestone needs a level 1 pickaxe, such as iron): crafting 2 cobble from the rocks you carry first.` → `Cobblestone from your rocks: 2 undergroundbiomes:igneous_cobble:0 …` → `Mine stone with a Sturdy (level 1) or better pickaxe, such as iron; it drops cobblestone.` → `Collected 0 cobblestone.` |
| 21:35:51 (`1484`, `1485`) | `… 1 undergroundbiomes:metamorphic_cobble:6 …` (the standing goal's shelter-blocks job, interrupted by the model's next command) |
| 21:36:09 (`1626`–`1631`) | `… 1 undergroundbiomes:igneous_cobble:7 …`, and `Successfully crafted contenttweaker:chalk_cobble:0 from your pyrotech_compat:rock_sedimentary:0 rocks` |
| 21:39:08 (`2146`–`2149`) | `… 1 undergroundbiomes:igneous_cobble:2 …`; `… 1 undergroundbiomes:igneous_cobble:6 …` |

**For skills-rotn:**
- **Rock piles broken with no rock picked up:** 8 lines of `Broke pyrotech_compat:rock_<kind> at …: no pyrotech:rock yet.` (`150`, `669`, `713`, `1108`, `1133`, `1489`, `1855`, `2118`), and more inside shortened outputs. The model noticed: `Rocks keep crumbling to nothing` (21:36:44) and `Second rock broke without a drop` (21:03:31).
- **Each rock kind makes its own cobble, so the model chased single kinds:** `!collectBlocks("pyrotech_compat:rock_igneous", 1)` 3 times (I15 below).
- **It also asked twice for `undergroundbiomes:sedimentary_cobble`**, which does not exist: `Invalid item type: undergroundbiomes:sedimentary_cobble. Did you mean undergroundbiomes:igneous_cobble, undergroundbiomes:sedimentary_clay or undergroundbiomes:sedimentary_sand?` (21:35:56 `1512`, 21:37:54 `1981`; I8's 2 refusals). Sedimentary rocks make `contenttweaker:chalk_cobble` (`1631`), which the suggestion list does not offer.

**Walks into valleys under open sky:** no line names one. There was no fall, no hurt line, and no walk ended underground. The only underground-looking moment is the water escape above.

## (c) The memory checks (`test/tools/soak-memory-checks.mjs`: I13, I14, I15)
`node test/tools/soak-invariants.mjs test/evidence/g4/g4soak-18-20261127`, with the checker as #662 merged it. Every miss below was checked by hand against the chat (`server.log`) and the journal (`driver.log`). Line numbers are `driver.log` lines unless they say otherwise.

### I13: every `[memory] facts` field against the game
There were 97 facts lines. Of their fields, the checker could check 832 and could not check 166.

| Field | Match | Miss (checker) | Unverifiable | Non-trivial samples | Checker verdict | **By hand** |
| --- | --- | --- | --- | --- | --- | --- |
| agenda | 93 | 2 | 2 | 95 | fail | **0 wrong**: both misses are the same-second step change (B1) |
| shelter blocks | 30 | 4 | 63 | 34 | fail | **0 wrong**: all 4 are crafts the checker does not count (B2) |
| collect | 136 | 4 | 0 | 140 | fail | **0 wrong**: all 4 are collects with no `Collected` line in the journal (B3) |
| pickaxe | 86 | 0 | 11 | 86 | pass | – |
| food held | 7 | 0 | 90 | 7 | pass | – |
| failure | 322 | 0 | 0 | 322 | pass | – |
| shelter | 51 | 0 | 0 | 51 | pass | – |
| deaths | 97 | 0 | 0 | 0 (97 trivial `0 = 0`) | too few | no death in the soak, so nothing to sample |

**The 10 misses, each classified:**

| # | Facts line | Field | Facts said | Checker's state | Verdict | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 20:53:22 (`112`) | agenda | step weapon | food | **B1 (same second)** | `agenda step food: the scripted job (run 1 of 4 today)` is at 20:53:22 too (`server.log:69`), and the facts line itself already lists the club the step asked for (`spartanweaponry:club_wood (off hand)`); `Club crafted!` (20:53:23) is the model's reply after it. The checker's 3-s after-window (`agendaAfterS`) takes the next step. The logs cannot order the two inside the second. It is the lag soak 17's `681`/`697` had (the facts read `agent._agenda_step`, the step the driver last started), but here under 1 s, so I do not count it as a wrong fact |
| 2 | 20:55:13 (`244`) | agenda | step crude_axe | first_plank | **B1** | `crude_axe done` and `first_plank started` are both at 20:55:13 (`server.log:242`, `:243`); the same facts line already lists `pyrotech:crude_axe` among the tools |
| 3 | 20:59:41 (`653`) | shelter blocks | 13 | 7 | **B2 (the model's crafts)** | the job ended at `7 of 14` (20:59:18, `server.log:434`); then the model's craft made 6 igneous cobble (`643`, 20:59:38), so 7 + 6 = 13. The model's next reply says `13 cobble banked` |
| 4 | 21:00:30 (`745`) | shelter blocks | 15 | 14 | **B2** | the job ended at `14 of 14` (21:00:28, `server.log:451`); the model's craft at 21:00:30 (`740`) made the 15th |
| 5 | 21:00:51 (`763`) | shelter blocks | 15 | 14 | **B2** | same as row 4 |
| 6 | 21:36:09 (`1636`) | shelter blocks | 13 | 11 | **B2** | the job ended `11 of 14; stopped); stopped early: not counted` (21:35:51, `server.log:610`); the interrupted job's craft (`1485`) and the model's two crafts at 21:36:09 (`1627`, `1631`) followed. The inventory listing 2 s later (21:36:11) holds 3 + 5 + 1 + 1 + 3 = **13** cobble |
| 7–9 | 20:59:20 (`590`), 20:59:28 (`612`), 20:59:41 (`653`) | collect | `got 54 pyrotech:rock … just now` | none | **B3 (no source)** | the rocks came from the shelter-blocks scripted job (20:56:40–20:59:18), which logs only its start and end in chat, so no `Collected 54` line exists. 54 rocks fits what followed: 13 cobble (52 rocks) by 20:59:41 and 1 rock left (`694`) |
| 10 | 21:35:46 (`1465`) | collect | `got 21 pyrotech:rock … just now` | none | **B3** | from the rock route inside `!collectBlocks("cobblestone", 8)`, whose output is shortened (`1452`–`1460`) |

**For the checker (a harness-ops follow-up, not in this PR):**
- **B1:** an agenda source in the same second as the facts line should be unverifiable, not a miss.
- **B2:** count `Successfully crafted <cobble> … you now have N` (cobble kinds summed) and `Cobblestone from your rocks: N` after the job's end as shelter-block sources.
- **B3:** a collect that a scripted job or a shortened output made has no source; mark it unverifiable.

With those, this soak's I13 would read 0 misses, with 5 or more samples in every field but deaths, which had nothing to sample.

### I14: the model's wrong-state claims
The checker found 24 claims in 19 of 120 replies: 0 wrong, 21 unverifiable (count 1 right, 21 unverifiable; step 2 right). The hand-check sample (19 lines): `96`, `445`, `469`, `503`, `526`, `545`, `570`, `596`, `631`, `689`, `733`, `751`, `785`, `1474`, `1692`, `1725`, `1770`, `2083`, `2692`.

**By hand: the facts line was right, and the model's own count was wrong, 4 times.** All are shelter-block counts, and all err upward:

| Reply (line) | The model said | The facts line just before | Right count |
| --- | --- | --- | --- |
| 21:00:34 (`751`) | `16 cobble total now (10 metamorphic + 6 igneous)` | 21:00:30 (`745`): `shelter blocks 15 of 14` | 15 (9 metamorphic, `740`, + 6 igneous) |
| 21:39:13 (`2160`) | `One cobble block made, shelter stores now 16` | 21:39:08 (`2154`): `15 of 14` | 15 (the facts at 21:39:13 and 21:39:16 still say 15) |
| 22:13:50 (`2636`) | `Shelter blocks are topped up now` | 22:13:40 (`2630`): `13 of 14` | 13, short of 14 |
| 22:14:19 (`2692`) | `Back at the shelter with 17 shelter blocks now (the 4 new cobble covered it)` | 22:14:13 (`2684`): `13 of 14` | 13; the 4 cobble were already in the 13 (`you now have 4 undergroundbiomes:metamorphic_cobble`, 22:13:35). The next facts line (22:14:34) says 14 |

The same kind of claim was right 4 times: `13 cobble banked` (`660`), `15 cobble spare` (`785`), `13 shelter blocks now` (`1692`), `10 stone blocks` (`2571`). No wrong claim led to a short night: each night's food line and shelter came out right, and the code-built standing goal kept its own count. Soak 17 had 0 of 15 wrong by hand.

### I15: repeated failures
3 repeats within 10 min of the same failure, out of 18 failed commands (1.5/h; soak 17 had 4, 1.99/h). All 3 came after a facts line had named the first failure. 3 within 30 min, 5 within 60 min.

| # | First failure | Repeat | Facts line before the repeat | What it was |
| --- | --- | --- | --- | --- |
| R1 | `!placeHere("crafting_table")` 21:02:46 (`1029`): `Could not place crafting_table at -25, 86, -130: …` | 21:02:53 (`1067`), at -27, 85, -129 | 21:02:47 (`1037`) and 21:02:49 (`1057`) name it, `just now` | the model stepped aside and tried 2 blocks away |
| R2 | `!collectBlocks("pyrotech_compat:rock_igneous", 1)` (`1529`) | 21:36:38 (`1733`) | names it | chasing a 4th igneous rock (b) |
| R3 | the same (`1733`) | 21:37:45 (`1960`) | names it | the same |

The 2 more within 60 min are the sword chain's `!craftRecipe("stone_sword", 1)` and `!collectBlocks("pyrotech:tinder", 3)`, each 36 min after round 1. The checker missed one more: round 1's second `!craftRecipe("stone_sword", 1)` at 21:03:31 (`1148`) never ran (I8's 1 `never ran`): the standing goal's prompt was re-sent in the same run at 21:03:33 (`1153`) and the next reply answered that instead. So it is not a failure. Rounds 3 to 6 have no failed command at all: `!getCraftingPlan` never fails, which is why I15 does not see them.

### The sword chain, round by round (the lead's question)
The standing goal, in all 7 of its prompts (first `648`), asks: `keep a weapon and a pickaxe, and make better ones when you can (a stone sword or axe, a spare pickaxe)`. From 21:01:21 (`872`) the bot held a stone axe, the club and two stone pickaxes.

| Round | Time (line) | The model's commands, in order | The facts line just before the round: Recent failures | Did the facts say tinder was missing? |
| --- | --- | --- | --- | --- |
| 1 | 21:02:43–21:04:07 (day 1) | `!placeHere("crafting_table")` ×2 (21:02:46 and 21:02:53, both failed: `1029`, `1067`); `!craftRecipe("stone_sword", 1)` (`1083`): `2 rock: you have none …; 1 spartanweaponry:material:0: you have none`; `!collectBlocks("pyrotech:rock", 2)` (got 1), `…1)` (got 0); `!craftRecipe("stone_sword", 1)` (`1148`, never ran); `!getCraftingPlan("spartanweaponry:material:0", 1)` (`1168`); `!getCraftingPlan("pyrotech:tinder", 3)` (`1191`); `!collectBlocks("pyrotech:tinder", 3)` → `Collected 0`; `!craftable`; `!getCraftingPlan("stone_sword", 1)` (`1302`); ended with `!craftRecipe("spartanweaponry:boomerang_stone", 1)`, which worked (`1332`) | 21:02:54 (`1075`): the two table placements, a dirt-pile placement, `!craftRecipe("stone_pickaxe", 1)` | **No** at the start (nothing about the sword yet). **Yes** from 21:03:53 (`1294`): `!collectBlocks("pyrotech:tinder", 3): Collected 0 pyrotech:tinder. (just now …)`, `!craftRecipe("stone_sword", 1)` (just now), and `Collects: no pyrotech:tinder within 64 …` |
| 2 | 21:39:13–21:39:31 (day 2) | `!craftRecipe("stone_sword", 1)` (`2162`): rock enough, `material:0: you have none`; `!getCraftingPlan("spartanweaponry:material:0", 1)` (`2181`); `!getCraftingPlan("pyrotech:tinder", 3)` (`2204`); `!collectBlocks("pyrotech:tinder", 3)` → 0; then **`Already hold a stone axe and club — that covers the weapon goal, so I'll drop the sword hunt`** (`2237`) | 21:39:08 (`2154`): 5 rock and cobble failures, 1–3 min old. **Round 1's two failures (36 min old) were stored but not shown:** the memory keeps 12 failures and shows them within a 600-character budget, those under 5 min old first (`memory_facts.js`), and these five filled it | **No** at the start: nothing in `2154` named the sword, material:0 or tinder. **Yes** from 21:39:13 (`2172`, then `2196`, `2212`, `2231`): the round's own `!craftRecipe("stone_sword", 1)` (just now), and from `2231` its `!collectBlocks("pyrotech:tinder", 3)` too |
| 3 | 22:13:50–22:13:59 (day 3) | `!getCraftingPlan("stone_sword", 1)` (`2638`); `!getCraftingPlan("pyrotech:tinder", 3)` (`2658`); then `Tinder can't be crafted — needs finding. … a stone sword can wait` (`2672`) | 22:13:40 (`2630`): `!collectBlocks("pyrotech:tinder", 3): Collected 0 pyrotech:tinder. (34 min ago …)` and `!craftRecipe("stone_sword", 1): You do not have the resources … (34 min ago …)` (round 2's) | **Yes**, in Recent failures (34 min ago) |
| 4 | 22:15:30–22:16:09 | `!getCraftingPlan("stone_sword", 1)` (`2840`): `Only unmet standing item left is a stone sword`; `!getCraftingPlan("pyrotech:tinder", 3)` (`2860`); `!craftable`; then `the stone sword is optional anyway` (22:15:56) and **`sword can wait until tinder shows up`** (22:16:09, `2954`) | 22:15:17 (`2795`): the same two (36 min ago) | **Yes** (36 min ago) |
| 5 | 22:16:36–22:17:17 | `!getCraftingPlan("stone_sword", 1)` (`3029`), **27 s after round 4 ended**; `!getCraftingPlan("pyrotech:tinder", 3)` (`3049`); `!collectBlocks("tallgrass", 5)` → `Collected 0 tallgrass`; `!collectBlocks("dynamictrees:leaves0", 8)` → 8 leaves, no tinder. The day-2 budget stop came after that turn (`3119`) | 22:16:31 (`3005`): the same two (37 min ago) | **Yes** (37 min ago) |
| 6 | 22:51:52 (day 4, the run's last call) | `Leaves gave little. Dead bushes often drop tinder — trying those: !collectBlocks("deadbush", 4)`; the unit stopped 2 s later | 22:51:49 (`3189`): `!collectBlocks("pyrotech:tinder", 3): Collected 0 …` (72 min ago) and `!craftRecipe("stone_sword", 1)` (73 min ago) | **Yes** (72 and 73 min ago) |

**Each `!getCraftingPlan` reply in the chain** (watch item (h)): `spartanweaponry:material:0` → `You are missing the following items: - 3 pyrotech:tinder … Craft 3 pyrotech:tinder -> 3 pyrotech:material:14; Craft 1 stick + 1 pyrotech:material:14 -> 1 spartanweaponry:material:0` (`1172`–`1176`, `2185`); `pyrotech:tinder` → `pyrotech:tinder is a base item, you need to find 3 more in the world` (`1193`, `2206`, `2660`, `2862`, `3051`); `stone_sword` → the same chain plus `Craft 1 pyrotech_compat:rock_igneous + 1 pyrotech_compat:rock_metamorphic + 1 spartanweaponry:material:0 -> 1 stone_sword` (`1304`–`1309`, and the same in `2640`, `2842`, `3031`).

**The cost:** 27 of the 120 calls, **USD 0.008606, 25.3% of the soak's spend**: the 26 replies that name the sword, material:0 or tinder (USD 0.008353), and round 5's `!collectBlocks("tallgrass", 5)` (`3063`, `Grass might drop it`), a tinder search that does not name it.

**My reading, for the lead to judge:**
- **The memory did not hide the repeat in rounds 3 to 6:** each facts line before them named the failed sword craft and the failed tinder collect, with their age (34 to 73 min). **At the start of round 2 it did not show them:** they were stored, but five failures 1–3 min old filled the 600-character budget, which shows the newest first. From 21:39:13 the round's own failures showed.
- **The model's own earlier answers were in its conversation**, and the conversation spans self-prompt runs: round 6 (a new run, 22:51:49) recalls round 5's leaves collect (`3100`, `3117`, `Leaves gave little`), which no facts line names. Round 5 came 27 s after round 4's `sword can wait until tinder shows up`. The standing goal, with its `a stone sword or axe`, was re-sent at 22:13:39 (`2623`, 11 s before round 3) and at 22:15:58 (`2943`, inside round 4, right after the model wrote `the goal says "sword…`).
- **What the memory never carries:** the planner's answer (`tinder is a base item`) and the model's own decision to drop the sword. `!getCraftingPlan` is not a failure, so it never reaches Recent failures.
- **So the loop's drivers are the planner and the goal text:**
  - the standing goal asks for `a stone sword or axe` in every prompt;
  - the planner offers a chain that ends at a "base item";
  - the model keeps looking for that item in the world: grass, leaves, dead bush.
  
  Whether the planner's `tinder` answer and the `tinder -> material:14` step are right is rotn-data's question (routed by the lead).

### The summaries' share of the spend, and the agenda against soak 17
- **Summaries: 0 of 120 calls, USD 0 (0%).** soak-spend reports 0 summaries, 0 summary end lines and 0 `[memory] summary turns` markers. I11 M4 check 5: `summaries 0% of USD 0.033996; 23 chunks cut with no summary call`. Soak 17 had 0 as well.
- **USD/h overall: 0.016984** (the gate's), against soak 17's 0.014567.
- **Agenda step times**, from each soak's chat; minutes after the join are in brackets. Soak 17 joined at 17:17:02, soak 18 at 20:51:44 (`server.log:10`):

| Step done | Soak 17 | Soak 18 (`server.log` line) |
| --- | --- | --- |
| logs | 17:18:43 (1.7) | 20:53:05 (1.4) (`65`) |
| sticks | 17:18:43 (1.7) | 20:53:05 (1.4) (`65`) |
| rocks | 17:20:21 (3.3) | 20:54:26 (2.7) (`148`) |
| crude_axe | 17:20:36 (3.6) | 20:55:13 (3.5) (`242`) |
| first_plank | 17:21:33 (4.5) | 20:55:31 (3.8) (`307`) |
| crafting_tools | 17:21:39 (4.6) | 20:56:05 (4.3) (`355`) |
| crafting_table | 17:21:43 (4.7) | 20:56:09 (4.4) (`359`) |
| planks_sticks | 17:22:03 (5.0) | 20:56:27 (4.7) (`374`) |
| stone_pickaxe | 17:22:15 (5.2) | 20:56:35 (4.8) (`377`) |
| stone_axe | 17:26:43 (9.7) | 20:59:27 (7.7) (`439`) |
| cobblestone | 17:28:00 (11.0) | 20:59:37 (7.9) (`443`) |
| **agenda done** | **17:29:42 (12.7)** | **20:59:37 (7.9)** (`444`) |

Soak 18's agenda was done with the shelter blocks still short (`7 of 14`, `server.log:434`). The standing goal's job reached `14 of 14` at 21:00:28 (8.7 min, `:451`).

## (d) `click rejected:` lines, and resyncs after a dig
**1 rejected click** (I3). It is a stack count, not the tool damage of soak 17's two (#664's dig-click hold is in this release):
> `[forge-bridge] click rejected: window 0 slot 30 (mode 0, button 0, action 500); client before the click: slot pyrotech_compat:rock_metamorphic:6 x7, cursor -, grid [-, -, -, -]; server after it: slot -, cursor pyrotech_compat:rock_metamorphic:6 x8, grid [-, -, -, -]` (21:35:44, `1448`)

- **Context:** a cobble craft inside the rock route of `!collectBlocks("cobblestone", 8)`. The client counted 7 rocks of that kind and the server 8: most likely a rock picked up just before the click.
- **The resync:** `[inventory] craft: Error: Server rejected transaction for clicking on slot 30 … Resyncing and trying once more.` (`1447`); `[inventory] resync: the server resent the window; cursor: pyrotech_compat:rock_metamorphic` (`1449`); `before craft: put the pyrotech_compat:rock_metamorphic on the cursor into slot 30` (`1450`); `bot.craft returned after 500 ms` (`1451`).
- **Resync lines: that one only.** No resync came after a dig, and no tool's damage was out of step.

For net-forge.

## (e) `[hands] idle:` lines
2 lines, both on day 2, each after a craft had moved the tools:
- 21:35:51 (`1497`): `[hands] idle: the pickaxe is not in the off hand and the weapon is not in the main hand: re-arming`, after the shelter-blocks job's crafts.
- 21:36:58 (`1843`): the same line, after the second job's craft (`server.log:644`–`647`).

The facts lines after each name `stone_pickaxe (off hand)` (from `1504` and from `1863`). No death, so no respawn re-arm to check.

## (f) `[attack]` lines, animal fights, roof retries and the shelters
| Time (line) | Line | Bot's health | Outcome |
| --- | --- | --- | --- |
| 20:53:45 (`124`) | `[attack] hunt -> animania:sow_old_spot#245`, from the food run of the agenda's food job (`server.log:69`) | 20 (`[survival] food 20 health 20`, 20:53:47) | 5 Better Combat hits on it (`189`). The job ended `+4.3 food points in 47 s (12 tries)` (chat); 2 `animania:raw_prime_pork` in the inventory at 20:55:32 (`380`) |
| 20:53:58 (`127`) | `[attack] hunt -> animania:sow_large_white#294` | 20 | no hit logged on it (the minute's attacks name only `sow_old_spot#245`) |

No animal hit the bot (0 hurt lines). The run's attack totals: `written bettercombat 5, use_entity 0 … misses 0` (`3202`).

**Roof retries: none.** No `roof` line. **All three shelters held**, with 0 hurt lines in any night:

| Night | Sunset (line) | Shelter | Food for the night | Morning |
| --- | --- | --- | --- | --- |
| 1 | 21:06:12 (`1367`) | On the river sand the bot found no place for a shelter or a hole (`1370`, `1372`). It walked toward better ground, an eel in the river stopped the walk (`1375`), and it sheltered at -71, 63, -146 (`1378`) | food 20, held 33.3, need 0: enough | 21:31:45–21:33:45: the eel within 8 blocks, so the bot stayed in for the full 2 min (`1405`–`1411`). Then `leaving … by the side away from` it (`1412`), dug out by the west stairs (`1422`), `back to work` 21:33:55 (`1425`) |
| 2 | 21:46:12 (`2383`) | -105, 69, -161 (`2386`) | food 9, held 33.3, need 5.6: enough | 22:11:49: dug out (`2428`) |
| 3 | 22:26:12 (`3134`) | -97, 69, -163 (`3137`), a new shelter 8 blocks from night 2's | food 9, held 29.7, need 5.6: enough | 22:51:48: dug out (`3180`) |

For skills-rotn: a freshwater eel, in water, stopped night 1's walk to better ground and kept the bot in for 2 min in the morning.

## (g) `[tool] … broke` lines, hurt lines and deaths
- **`[tool] … broke`: none.** The only "broke" outside a collect's dig lines is the model's own `The debarked log broke` (20:56:03).
- **Hurt lines: none** (`[survival] hurt` 0; I12 0).
- **Deaths: none.** `deaths_reported` passes with `no death`.

The food line sat at 8–9 from 21:45. The reflex ate within 2 s of each of the 8 `low` lines (`2378`–`3172`).

## (h) The LLM spend (`test/tools/soak-spend.mjs`) and the `!getCraftingPlan` replies
| Window | Calls | Memory summaries | Completion tokens | Reasoning tokens | USD |
| --- | --- | --- | --- | --- | --- |
| Day 1 (20:51:46–21:06:12) | 58 | 0 | 32,679 | 31,057 | 0.015001 |
| Night 1 (21:06:12–21:31:45) | 0 | 0 | – | – | – |
| Day 2 (21:31:45–21:46:12) | 32 | 0 | 20,383 | 19,348 | 0.009640 |
| Night 2 (21:46:12–22:11:49) | 0 | 0 | – | – | – |
| Day 3 (22:11:49–22:26:12) | 29 | 0 | 21,899 | 20,999 | 0.009140 |
| Night 3 (22:26:12–22:51:48) | 0 | 0 | – | – | – |
| Day 4 (22:51:48–22:51:54) | 1 | 0 | 206 | 179 | 0.000216 |
| **Total** | **120** | **0** | **75,167** | **71,583** | **0.033996** |

- **USD per hour:** the gate's figure is 0.016984 over 120 min. The gate's USD 0.033996 equals the tool's total.
- **Day vs night:**
  - Days: 43.4 min, 120 calls, USD 0.033996 = **0.0470/h**.
  - Nights: 76.6 min, 0 calls = **0/h**.
  - Soak 17: days 0.0399/h, nights 0/h.
- **Reasoning:** 71,583 of 75,167 completion tokens (95.2%), max 6,084 for one call. Every call had a `reasoning_tokens` line.
- **Self-prompting:** 21.6 min in 7 loop runs, all 120 calls inside them.
- **The standing goal's daily budget** stopped the self-prompter at 21:04:45 (day 0), 21:40:25 (day 1) and 22:17:18 (day 2) (`server.log:525`, `:683`, `:805`).
- **The sword chain** cost 27 calls, USD 0.008606 (25.3%), as detailed in (c) (26 calls, USD 0.008353, without the tallgrass collect).

**The `!getCraftingPlan` replies: 13 calls.**
- **`stone_pickaxe`** (21:00:56, `789`–`792`): `You already have 1 stone_pickaxe …`, `You have all items required to craft this item!`, `Craft 2 pyrotech_compat:rock_igneous + 1 pyrotech_compat:rock_metamorphic + 2 stick -> 1 stone_pickaxe`. Right.
- **`pyrotech_compat:rock_igneous`** (21:36:44, `1757`, `1758`): `You already have 4 …`, `… is a base item, you need to find 1 more in the world`. Right: rocks are found, not crafted.
- **The sword chain's 11** (`spartanweaponry:material:0` ×2, `pyrotech:tinder` ×5, `stone_sword` ×4): quoted in (c). **For rotn-data, routed by the lead:**
  - Is `pyrotech:tinder` a base item, or does it have a recipe the planner does not see?
  - Is `Craft 3 pyrotech:tinder -> 3 pyrotech:material:14` the real recipe for that material?

## The soak invariants (`test/tools/soak-invariants.mjs`)
`node test/tools/soak-invariants.mjs test/evidence/g4/g4soak-18-20261127`:

| Invariant | Soak 18 | Lines |
| --- | --- | --- |
| I1 trapped | **0 trap spans**; 1 escape episode, cleared in 6.2 s | `1359`–`1365` |
| I2 enclosed morning | 0 | – |
| `no_trap` (scenario check, #662) | **PASS: no trap span or enclosed shelter** | – |
| I3 rejected clicks | 1 | `1448` |
| I4 dig refused with a usable tool | 0 of 0 | – |
| I5 sunset food short | 0 of 3 food-for-the-night lines; 0 food runs | – |
| I6 starving | 0 food lines at 4 or less (lowest 8); 0 `no safe food` runs over 5 min; 0 starving hurt lines | – |
| I7 gate then act | 0 of 0 refusals | – |
| I8 refused command | 2 by design (`sedimentary_cobble`); 1 reply whose command never ran | `1512`, `1981`; `1148` |
| I9 false collect | 0 | – |
| I10 death loop | 0 loops (0 deaths) | – |
| I11 summary cost | 0 summaries; 0% of the spend (M4 check 5: 23 chunks cut with no summary call) | – |
| I12 unattributed hurt | 0 | – |
| I13 memory facts | checker gate **fail**, 10 misses in 832 fields; **by hand all 10 are artefacts (B1–B3), 0 wrong facts** | above |
| I14 wrong-state claims | checker 0 of 24 (21 unverifiable); **by hand 4 wrong shelter-block counts by the model, with the facts right** | `751`, `2160`, `2636`, `2692` |
| I15 repeated failures | 3 (1.5/h), 3 after a facts line named the first; 5 within 60 min | `1067`, `1733`, `1960` |

The live checks during the run (20:51, 21:04, 21:11, 21:31, 21:51, 22:11, 22:31, 22:51) all showed `no_trap` ok and I1, I2, I6 and I10 at 0.

The baseline (`test/evidence/g4/invariants-baseline.json`) gets the soak 18 row, and the diff adds only that row.

## Owners' notes
- **rotn-data (routed by the lead):** the `pyrotech:tinder` base-item reply, and the `tinder -> pyrotech:material:14` step (h).
- **skills-rotn:**
  - The standing goal's `a stone sword or axe` with a chain the bot cannot finish drove the 6-round loop (c).
  - The model's shelter-block counts ran high 4 times while the facts were right (I14).
  - Rock piles broken with no rock picked up (8 lines).
  - The `sedimentary_cobble` name: the suggestion list does not offer `contenttweaker:chalk_cobble` (b).
  - The eel stopped the night-1 walk and held the bot in for 2 min (f).
- **net-forge:** the one rejected click, a stack count of 7 against 8 during a rock-route craft; the resync answered it (d).
- **harness-ops (a follow-up after this PR):** the I13 checker fixes B1–B3; I15 does not see a repeated `!getCraftingPlan` chain, and could report the same chain asked again within a window.

## Files
Every file except `README.md` and `step7-starts.txt` went through `test/tools/redact-evidence.mjs <in> <out> --bot FRCFLD`. The redactor replaces addresses with `<ip>`, the bot's name with `<bot>`, UUIDs with `<uuid-v4>`, server ids with `<server-id>` and local paths with `<local>`. `redact-evidence.mjs --check` on this folder is clean, and so is `test/tools/secret-scan.mjs` after `git add`.
- `README.md`: this file, written by hand; it names no address, path or key.
- `driver.log`: the bot's journal for the run (`ssh cx23-ctl journal frcfld`), 3,209 lines. **Redacted** as above, with the line count unchanged, so the line numbers in this README are this file's lines.
- `server.log`: the test server's log as the runner read it. **Redacted** as above.
- `result.json`: the runner's result, with every sample. **Redacted** as above.
- `run.log`: the runner's console output. **Redacted** as above.
- `server-lifecycle.txt`: `up`, `starts`, the seed check, the since-start header, `starts` again, `save-all flush`, `down`, and the Hetzner counts. **Redacted** as above. The `Waiting for …` progress lines of `up` and `down` are left out.
- `step7-starts.txt`: `test-server.sh starts` right after `up`, written by hand (two lines, no address).
