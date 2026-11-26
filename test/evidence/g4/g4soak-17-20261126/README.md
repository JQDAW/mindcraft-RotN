# G4 soak 17: `g4-soak-2h` on the CX23 service (2026-11-26)

**Label: the seventeenth soak, run under the lead's written GO `G4-SOAK-17-20261126`. It is never G4 acceptance evidence.**
- **SMOKE-PASS, 9 of 9 checks** with the ADR 0010 targets (850 MiB, USD 0.05/h). `result.json` marks it not-gate (`gateValid: false`). The reasons are the S-run reason from #436 and the step-7 runner's reasons: there is no `ROTN_G4_ACCEPT` marker, so conditions (a) and (d) fail, while (b), (c) and (e) hold.
- **The first soak on rotn-v0.1.23**, the first release with round 17 M's code-built memory (#637). It ran 17:16:41 to 19:17:17 UTC on the second test server of the day. The first server was deleted unused; see the set-up table.
- **The memory checks (item (b), the human's condition):**
  - **I13 reports a FAIL, with 26 misses in 746 checkable fields. I checked all 26 by hand, and every one is a checker artefact.**
  - **But 3 facts lines carry a real wrong agenda fact, and the checker missed all 3** (#661 review 1, plus 2 found while re-checking). All three are about the agenda step, and the other fields in those lines are right:
    - `driver.log:45` (17:17:05) says `Agenda: active, all steps done; done: none`, before the first step (weapon) started at 17:17:12 (`server.log:49`). The checker cannot parse `active, all steps done`, so it left the field unverifiable.
    - `driver.log:681` (17:22:20) and `:697` (17:22:23) say `active, step stone_pickaxe …` while their own done list ends in `stone_pickaxe`. They come 5 s and 8 s after `agenda step stone_pickaxe done` (`server.log:300`, 17:22:15), and the `!agenda` reply at 17:22:21 (`driver.log:690`) already said `step shelter_blocks`. The checker's ±30-s window took them as matches.
  - Two fields, `pickaxe` and `food held`, had **0 samples** the checker could use. I checked both by hand against other code-built lines. pickaxe: right on every change. food held: 5 of 7 comparisons equal. In the other 2, the standing goal's `you hold` is the stale figure, not the facts (below).
  - **I14:** 1 claim marked wrong of 15, which is also a checker artefact, so 0 of 15 by hand.
  - **I15:** 4 repeated failures, each with line refs below.
  - **Memory summaries: 0 calls**, so 0% of the spend. All 25 summary points logged `[memory] summary skipped (no player turn)`.
- **Trapped underground from 18:03:31 to 18:09:45 (6.2 min from the first trap line), and killed on the way out.** The bot was already down at y 25–26 during the collect that began at 18:01:53 (`2094`), so it was underground for about 8 min.
  - `!collectBlocks("cobblestone", 7)` took the bot to cobblestone at 81, 26, 67, 55 blocks under the sky.
  - The escape climbed from y 25 to y 61. On the way its stone pickaxe broke, and it made a new one.
  - The escape was interrupted twice: once by the model's own `!craftRecipe` and once by the cowardice reflex.
  - Zombies killed the bot in its shaft at 80, 61, 72.
  - A second, short trap from `!collectBlocks("undergroundbiomes:metamorphic_stone", 14)` cleared in 90.6 s (18:40:16 to 18:41:47).
- **Cost: USD 0.014567/h** (the gate's figure) from 123 calls, all to Wafer. **By day 0.0399/h, by night 0/h**, with no call on any night. Soak 16 was 0.0282/h overall, 0.0709/h by day and 0.0037/h by night.
- **The agenda was done in 12.7 min.** Soak 16 took 45.7 min; the step times are below.
- **Animals:** the bot attacked a ewe, which it could not reach, and killed a hen and a hog. No animal hit it.
- **The nights:** all three shelters held, with no hurt line at night and no roof retry needed.
- **Rejected clicks: 2.** Both show the same pattern: the server put the stone pickaxe on the cursor, with damage +1. Both lines are quoted below.

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test servers'.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.23`, which is develop `5d792d42`, in a fresh detached checkout. **`npm ci` was not run:** it was killed by the out-of-memory killer twice in an agent worktree that day. Instead `node_modules` was copied from an installed worktree, after `cmp` and `diff -r` showed that `package.json`, `package-lock.json` and `patches/` match the tag byte for byte. Then `run.mjs --list` ran. Command: `run.mjs --scenario g4-soak-2h --service frcfld`, started once, not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-17-20261126:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-17-20261126`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, on release `rotn-v0.1.23`, which the lead deployed through the gate. Before the run the unit was inactive and disabled, and the lead had reset its Mindcraft state (archive `frcfld-20261126T142050Z`). The human set the env `host` to the soak server and confirmed it, with the file `root:root 600`. After the unit's systemd start (17:16:50, `driver.log:2`), the journal shows: `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[release] rotn-v0.1.23-5d792d42e43d` (the harness's commit); `[state] <bot> at start: tasks=absent agenda=absent memory=absent` (`driver.log:14`); `[forge-bridge] bettercombat attack: on`; and the dig-time rule line. There were three `Error with embedding model, using word-overlap instead.` lines at 17:16:58 |
| Test server 1 (unused) | `mcr-test-20261126-142215`, a CPX42 in nbg1. Created 14:22:19, ready 14:28:07, with the watchdog `delete-after` at 2026-11-26T18:22:19Z (TTL 4 h). **The lead postponed the soak** because the human's host check had not come, and a 2-hour run no longer fit before the watchdog. `run.mjs` never ran against this server. It was deleted at 16:05:05: up 102 min, billed about 2 h, EUR 0.2762 plus the IPv4. Hetzner then showed 0 servers, 0 volumes and 0 Primary IPs |
| Test server 2 (the soak) | `mcr-test-20261126-171053`, a CPX42 in nbg1, with the same flags. Hetzner gave it the same address as server 1. Created 17:11:00, ready 17:14:14, with `delete-after` at 2026-11-26T21:10:59Z (TTL 4 h). The human confirmed the host, then the run started. Deleted at 19:17:57: up 126 min, billed about 3 h, EUR 0.4143 plus the IPv4. Afterwards Hetzner showed 0 servers, 0 volumes, 0 Primary IPs and 0 test SSH keys |
| Step-7 check | `test-server.sh starts` right after `up` (17:14:14): `starts=1 files=1` (`step7-starts.txt`). After the run, before `down`: `starts=1 files=1` |
| World | The G2/G3/M1 seed `1880465901402976865`, fresh: `world 3270 of at most 6861 ticks` at the step-7 read (`run.log`) |
| Server | Firewall: ports 22 and 25565 open only to the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 16 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; all 337 zip jars match; 0 extra mods (both servers) |
| Timing | **The source of each start time:** systemd started the unit at **17:16:50** (`driver.log:2`). The server logged `<bot> joined the game` at **17:17:02** (`server.log:10`). The journal shows `<bot> spawned.` at **17:17:04** (`driver.log:39`) and `Self-prompting started.` at **17:17:12** (`driver.log:59`). The runner's `login_online` passed at **17:17:07** (`run.log`). The runner then took 120 min of samples, one every 5 min (25 samples), and stopped the unit through ctl. The unit stopped at 19:17:15; systemd reported `697.2M memory peak` and 17 min 28 s of CPU |
| After the run | `test-server.sh log 200000 since-start` (found=1, 21,218 lines, over=0), then `starts`, then `save-all flush` (19:17:29, `Saved the world`), then `test-server.sh fetch` of the two trap regions (`r.0.0.mca` for trap 1, `r.-1.-1.mca` for trap 2) and `level.dat` into the dev server's shared folder for offline analysis, then the delete. The world files stay off the repo |

## The checks (`result.json`)
| Check | Result | Detail |
| --- | --- | --- |
| `login_online` | PASS | joined; the UUID is version 4 (a Mojang account) |
| `naming` | PASS | `[naming]`: 3 kinds, unknown 0, all real; entities: 1 kind, unknown 0 |
| `no_crash` | PASS | 120 min up, 25 samples, `NRestarts` 0 throughout, no agent exit |
| `peak_memory` | PASS | 697 MiB (target 850) |
| `usd_per_hour` | PASS | USD 0.014567/h: USD 0.029157 over 120 min, from 123 completions (target 0.05) |
| `agenda_done` | PASS | `agenda done` at 17:29:42 (`server.log:455`) |
| `food_floor` | PASS | lowest food 8 across 122 food lines (floor 6) |
| `ate_when_low` | PASS | the bot ate after each of the 6 `low` lines |
| `deaths_reported` | PASS | the 1 death was reported |

## (b) The memory checks (`test/tools/soak-memory-checks.mjs`: I13, I14, I15)
`node test/tools/soak-invariants.mjs test/evidence/g4/g4soak-17-20261126`. The checker is the one merged in #655. Every miss below was checked by hand against the chat (`server.log`) and the journal (`driver.log`). Line numbers are `driver.log` lines unless they say otherwise.

### I13: every `[memory] facts` field against the game
There were 102 facts lines. Of the 1,053 fields in them, the checker could check 746 and could not check 307.

| Field | Match | Miss (checker) | Unverifiable | Non-trivial samples | Checker verdict | **By hand** |
| --- | --- | --- | --- | --- | --- | --- |
| agenda | 61 | 20 | 21 | 81 | fail | all 20 misses are checker artefacts (A1–A4); **3 real wrong facts the checker missed**: `45` (unverifiable to it), `681` and `697` (matches to it) |
| shelter blocks | 14 | 6 | 82 | 20 | fail | **0 wrong**: all 6 misses are checker artefacts (S1) |
| deaths | 102 | 0 | 0 | 20 (82 trivial `0 = 0`) | pass | – |
| last death | 19 | 0 | 0 | 19 | pass | – |
| shelter | 46 | 0 | 0 | 46 | pass | – |
| failure | 282 | 0 | 0 | 282 | pass | the list holds only 3 entries (see I15 R4) |
| collect | 196 | 0 | 0 | 196 | pass | – |
| pickaxe | 0 | 0 | 102 | **0** | too few | **checked by hand: right at each of its 5 changes** (P) |
| food held | 0 | 0 | 102 | **0** | too few | **checked by hand: 5 of 7 equal, 2 differ by a fresh pickup** (F) |

**The 26 misses, each classified:**

| # | Facts line | Field | Facts said | Checker's state | Verdict | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 17:20:05 (`203`) | agenda | step shelter_blocks | rocks, crude_axe | **artefact A1 (timing)** | `shelter_blocks started` at 17:19:34 (`server.log:114`), 31 s before, just outside the 30-s window. The agenda moved to `rocks` at 17:20:06 (`server.log:146`), 1 s after the facts line |
| 2 | 17:21:24 (`456`) | agenda | step first_plank | crafting_tools, crafting_table, planks_sticks | **artefact A1** | first_plank ran from 17:20:36 (`server.log:204`) to 17:21:33 (`server.log:270`). The checker takes any source within ±30 s, so it saw only the later steps |
| 3 | 17:21:31 (`479`) | agenda | step first_plank | same | **artefact A1** | first_plank finished 2 s later (17:21:33) |
| 4 | 17:29:41 (`1332`) | agenda | step shelter_blocks | done | **artefact A1** | `agenda done` came at 17:29:42 (`server.log:455`), 1 s later. The same facts line says `shelter blocks 14 of 14` |
| 5–16 | 18:00:20 (`1815`), 18:00:30 (`1838`), 18:00:46 (`1858`), 18:00:49 (`1906`), 18:00:56 (`1944`), 18:01:00 (`1966`), 18:01:03 (`1985`), 18:01:06 (`2003`), 18:03:59 (`2124`), 18:04:05 (`2155`), 18:41:48 (`3002`), 18:42:04 (`3045`) | agenda | done (`before night it still keeps the shelter blocks`, all steps done) | shelter_blocks | **artefact A2 (a job line read as a step)** | Each state comes from a chat line `agenda step shelter_blocks: the scripted job (run 1 of 2 today)` (18:00:47 `server.log:641`, 18:04:00 `:664`, 18:41:51 `:864`). After `agenda done`, that job runs under the standing goal, and the code's own goal lines say so: `Standing goal (the agenda is done)` at 17:59:20, 17:59:35, 18:37:19, 18:38:40 and 18:39:22 (`1636`, `1687`, `2774`, `2838`, `2923`). The checker's #650 review-5 rule takes the job line as the current step even when the agenda is done |
| 17 | 18:06:50 (`2323`) | agenda | done, all steps done | shelter_blocks | **artefact A3 (timing)** | the done agenda re-opened its keep step at 18:07:19 (`server.log:684`), 29 s after the facts line. The facts line after that, at 18:07:34 (`2471`), names `step shelter_blocks` |
| 18 | 18:07:08 (`2415`) | agenda | done, all steps done | shelter_blocks, weapon | **artefact A3** | the steps re-opened at 18:07:19 and 18:07:38 (`server.log:684`, `:687`), after the facts line. The facts lines at 18:07:34 (`2471`) and 18:07:38 (`2501`) name them |
| 19 | 18:10:35 (`2683`) | agenda | done (…), **step shelter_blocks** | done | **artefact A4 (parse)** | The `!agenda` replies at 18:09:59 and 18:10:38 (`2611`, `2692`) say exactly the same: `agenda: done (before night it still keeps the shelter blocks), step shelter_blocks (…)`. The checker reads that reply form as plain `done`. The step re-opened after the death (`server.log:696`, 18:09:48) |
| 20 | 18:10:38 (`2698`) | agenda | the same | done | **artefact A4** | same as row 19 |
| 21 | 17:59:20 (`1642`) | shelter blocks | 5 | 6 | **artefact S1 (a later job's count)** | The scripted job ran 17:59:35–17:59:41 and ended `+1 shelter blocks (6 of 14…)` (`server.log:580`), so it was 5 before. The code's goal lines at 17:59:20 and 17:59:35 (`1636`, `1687`) also say `you have 5` |
| 22 | 17:59:35 (`1694`) | shelter blocks | 5 | 6 | **artefact S1** | same job; the facts line is from its start |
| 23 | 18:00:30 (`1838`) | shelter blocks | 6 | 7 | **artefact S1** | job 18:00:47–18:00:56, `+1 … (7 of 14…)` (`server.log:643`), so it was 6 before |
| 24 | 18:00:46 (`1858`) | shelter blocks | 6 | 7 | **artefact S1** | same job, 1 s before it started |
| 25 | 18:03:59 (`2124`) | shelter blocks | 7 | 9 | **artefact S1** | job 18:04:00–18:04:02, `+2 … (9 of 14…)` (`server.log:666`), so it was 7 before |
| 26 | 18:41:48 (`3002`) | shelter blocks | 0 | 14 | **artefact S1** | job 18:41:51–18:41:57, `+14 … (14 of 14; enough)` (`server.log:865`). The job crafted 14 cobble from the rocks the escape had dug (14 `[craft] bot.craft returned` lines after `3002`), so it was 0 before. The next facts line, 18:42:04 (`3045`), says 14 |

**(P) Pickaxe, checked by hand.** The checker's sources are the night's `[shelter] pickaxe check` and the `dig refused` lines. There were none in daylight, and there were no facts lines at night, so it had 0 samples. Instead I followed the field across all 102 lines, against the tool events:
- no pickaxe until `Successfully crafted stone_pickaxe` at 17:22:20 (`674`); the first facts line with one is at 17:22:20 (`681`);
- carried until `[tool] stone_pickaxe broke` at 18:06:10 (`2170`); the first line without one is at 18:06:14 (`2181`);
- none until `[pickaxe] made a stone pickaxe` at 18:07:18 (`2448`, the escape's); carried again from 18:07:34 (`2471`);
- kept at the death (18:09:45; the chat at 18:10:00 says `Lost everything in the death except my axe and pickaxe`, `server.log:716`): carried at 18:10:03 (`2637`) and after.

**Right at every change; 0 wrong.**

**(F) Food held, checked by hand.** The checker's only source is `[night] food for the night` (3 lines, all at sunset, when there are no facts lines), so it had 0 samples. The standing goal's own text, `keep food worth at least 12 points (you hold H)`, is a second code-built source. I compared it with the facts lines within 1 s:

| Goal line | Goal says | Facts line | Facts say | |
| --- | --- | --- | --- | --- |
| 17:29:46 (`1343`) | 10.2 | 17:29:46 (`1349`) | 10.2 | equal |
| 17:59:20 (`1636`) | 10.2 | 17:59:20 (`1642`) | 10.2 | equal |
| 17:59:35 (`1687`) | 10.2 | 17:59:35 (`1694`) | 10.2 | equal |
| 18:37:19 (`2774`) | 0 | 18:37:19 (`2780`) | 0 | equal (all food was lost at the death) |
| 18:38:40 (`2838`) | 2.3 | 18:38:41 (`2844`) | **4.3** | differs: right after `Foraged 1 block: got 1 turnipitem, 1 zucchiniitem` (`2837`, 18:38:40) |
| 18:39:22 (`2923`) | 19.9 | 18:39:23 (`2929`) | **20.9** | differs: right after `Foraged 2 blocks: got 4 ginseng, 1 radishitem` (`2922`, 18:39:22) |
| 19:17:13 (`3293`) | 17 | 19:17:13 (`3299`) | 17 | equal |

**The two differences: the standing goal is the stale one** (#661 review 2).
- Both figures come from the same function, `heldFoodPoints` (`memory_facts.js` `reservesLine`; `agenda.js` `standingGoal` through `agenda_driver.js` `foodHeld`).
- The goal text was built in the forage's second, before the pickup counted.
- The facts figure stays the same in the lines after: 4.3 in `2844`–`2881`; 20.9 in `2929`–`3002`; 19.9 after the bot ate (`3005`, `3045`).
- **The model repeated the stale figure** twice: `Garden food picked up (2.3 pts)` (`2850`, 18:38:41) and `Food's stocked (19.9 pts)` (18:39:27).
- So food held has 0 wrong facts. Two of the seven goal lines lagged a pickup.

**The causes, for the checker fix (a follow-up PR after this one):**
- **A1/A3:** the agenda source should be the state at the facts line's time: the latest source at or before it, with only a few seconds of slack after it, not any source within ±30 s.
- **A2:** a `scripted job (run …)` line is a step only while the agenda is active.
- **The 3 real wrong facts:** the checker must parse `active, all steps done` (`45`). It must also count a step named as current as a miss when the facts line's own done list names that step, or a `step X done` line came before it (`681`, `697`).
- **A4:** parse `agenda: done (…), step X (…)` as step X.
- **S1:** take the latest job-end count at or before the facts line, or a later job's end count minus its gain.
- **P and F:** add the standing goal's `you hold H` / `you have N` and the tool events (`[tool] … broke`, `crafted … pickaxe`, `[pickaxe] made`, death keeps) as sources. That gives both fields their samples by day.

With those fixes the gate would read this soak as 0 misses in 7 of 9 fields. pickaxe and food held would need the new sources before they could reach 5 samples.

### I14: the model's wrong-state claims
The model made 15 claims in 11 of 123 replies. The checker found 1 wrong and 9 unverifiable (y 1 right, 1 wrong; count 4 right, 9 unverifiable; step 0).
- **The one marked wrong is a checker artefact.** At 18:06:20 (`2187`) the model said `Getting there — I'm up from y=25 to y=44. Retrying the climb: !goToSurface`. The checker took the first `y=` (25, where the climb started). The claim about where the bot is now is y 44, and the position lines around it (44, 43, 43) agree. **By hand: 0 of 15 wrong.** Soak 16 was 0 of 7.
- The hand-check sample (11 lines): `100`, `126`, `210`, `257`, `520`, `614`, `794`, `1260`, `1319`, `2187`, `3031`.

### I15: repeated failures
There were 4 repeats within 10 min of the same failure, out of 20 failed commands (1.99/h; soak 16 had 0). All 4 came after a facts line had named the first failure.

| # | First failure | Repeat | Facts line before the repeat | What it was |
| --- | --- | --- | --- | --- |
| R1 | `!placeHere("log")` 17:20:47 (`308`): `Cannot place log where you stand at 17, 71, -42: … leaves above your head leaves no room to jump` | 17:20:55 (`344`): `Could not place log at 14, 71, -44: … the jump-and-place did not take` | 17:20:50 (`334`) names it, `just now at 17, 71, -42` | The model said `Retrying the log placement here`. The bot had moved 3 cells, and the second failure has a different reason |
| R2 | `!craftRecipe("stone_axe", 1)` 17:24:13 (`823`): `Failed to place crafting_table at (-8, 70, -3)` | 17:25:44 (`901`): the same text, the same cell | 17:25:37 (`891`) names it, `1 min ago at -8, 69, -3, here` | `Out and clear now. Retrying the craft`. **A true repeat:** the same cell failed again, and the memory had named it |
| R3 | `!searchForEntity("pig", 64)` 17:29:53 (`1375`) | 17:31:02 (`1539`) | 17:31:01 (`1529`) names it, `1 min ago at -72, 67, 20, 98 W` | `New spot. Let me search for animals here`. The bot was 98 blocks away, so this is a fair retry in a new place |
| R4 | `!attack("animania:ewe_dorset")` 18:00:12 (`1773`): `Could not reach … leaving it alone for 5 min` | 18:01:05 (`1995`): the code refused it, `Not attacking … the ones it could not reach in the last 5 min are left alone` | the facts lines from 18:00:12 to 18:00:56 (`1780`–`1944`) name it. **The last one before the repeat, 18:01:03 (`1985`), no longer does:** three newer `!searchForEntity` failures pushed it out of the 3-entry list | `The ewe is right here though — sheep don't fight back`. The code's guard stopped it; it cost one call. I15 counts it `inMemory` because an earlier line named it, but the line the model saw last did not |

### The summaries' share of the spend, and the agenda against soak 16
- **Summaries: 0 of 123 calls, USD 0 (0%).** soak-spend reports 0 summaries, 0 summary end lines and 0 `[memory] summary turns` markers. All 25 summary points logged `[memory] summary skipped (no player turn) turns N kept K`, the #637 code-built memory. I11 M4 check 5 shows the same: `summaries 0% of USD 0.029157; 25 chunks cut with no summary call`. In soak 16, summaries were 20 of 114 calls and 33.6% of the spend.
- **USD/h overall: 0.014567** (the gate's), against soak 16's 0.028209.
- **Agenda step times**, from each soak's chat; minutes after the join are in brackets. Soak 16 joined at 20:29:30, soak 17 at 17:17:02:

| Step done | Soak 16 | Soak 17 |
| --- | --- | --- |
| logs | 20:30:59 (1.5) | 17:18:43 (1.7) |
| sticks | 20:31:02 (1.5) | 17:18:43 (1.7) |
| rocks | 20:33:13 (3.7) | 17:20:21 (3.3) |
| crude_axe | 20:33:49 (4.3) | 17:20:36 (3.6) |
| first_plank | 20:36:31 (7.0) | 17:21:33 (4.5) |
| crafting_tools | 20:37:07 (7.6) | 17:21:39 (4.6) |
| crafting_table | 20:37:11 (7.7) | 17:21:43 (4.7) |
| planks_sticks | 20:37:56 (8.4) | 17:22:03 (5.0) |
| stone_pickaxe | 20:38:05 (8.6) | 17:22:15 (5.2) |
| stone_axe | 21:15:12 (45.7, day 2) | 17:26:43 (9.7) |
| cobblestone | 20:43:41 (14.2) | 17:28:00 (11.0) |
| **agenda done** | **21:15:12 (45.7)** | **17:29:42 (12.7)** |

## (a) The traps, and every `[escape]` / `[trapped]` line
**Trap 1, reported as one trap: 18:03:31 to 18:09:45, 6.2 min. It never reached the sky and ended with the death** (the lead's call). The 6.2 min runs from the first trap line. The collect that took the bot down began at 18:01:53 (`2094`), and the bot was at y 25–26 by the time the collect gave up (#661 review 5).
- **How it started:** at 18:01:53 (`2094`) the model sent `!collectBlocks("cobblestone", 7)` for the standing goal's shelter blocks. The collect ran for 98 s with no lines of its own. Its output (`2108`–`2110`) begins `Gave up on cobblestone at 81, 26, 67: time limit of 90 s reached`, so its target was cobblestone 55 blocks under the sky (the surface there is at y 78–80). The shortened output does not show the way down. The region file is saved for skills-rotn.
- **The lines:**

| Time (line) | Line |
| --- | --- |
| 18:03:31 (`2096`) | `[escape] trapped at 79, 25, 68 after digging (10 cells searched, no walkable way to the sky): getting out first` |
| 18:03:31 (`2097`) | `[escape] stuck at 79, 25, 68: getting out to 77, 78, 70 (dry ground under open sky) (up to 61 steps, 5 min)` |
| 18:03:50 (`2102`) | `[escape] the pathfinder found no way (timeout); digging out by hand` |
| 18:03:58 (`2103`) | `[escape] still stuck at 79, 25, 68 after 27.2 s (dug 2, placed 0): could not pillar up from 79, 25, 68` |
| 18:04:06 (`2165`) | `[escape] stuck at 79, 25, 68: getting out to 77, 78, 70 …` (`!goToSurface`, from the model) |
| 18:04:11 (`2167`) | `[escape] the pathfinder found no way (timeout); digging out by hand` |
| 18:06:10, 18:06:11 (`2170`, `2171`) | `[tool] stone_pickaxe broke (used up)` at 78, 44, 71 and 78, 45, 71 (item (f)) |
| 18:06:13 (`2172`) | `[escape] still stuck at 78, 44, 70 after 127.0 s (dug 53, placed 1): could not step up into 78, 44, 71` |
| 18:06:21 (`2191`–`2194`) | `[escape] stuck at 78, 43, 70: getting out to 78, 79, 70 …`; `the pathfinder found no way (noPath)`; **`no pickaxe, and none can be made here: a stone pickaxe needs a crafting table (none carried or near)`**; `still stuck at 78, 43, 70 after 0.4 s (dug 0, placed 0): no stair step, and no room to pillar up above 78, 43, 70: 78, 46, 70 is undergroundbiomes:metamorphic_stone, which needs a pickaxe (you carry none)` |
| 18:06:30–18:06:37 | **The model's re-plan:** `!craftRecipe("crafting_table", 1)` was refused (it needs `contenttweaker:crafting_tools`, `2218`); `!getCraftingPlan("contenttweaker:crafting_tools", 1)` showed stone_axe + rock:8 + stick; `!craftRecipe("contenttweaker:crafting_tools", 1)` |
| 18:07:15 (`2439`) | `[trapped] at 78, 43, 70, idle: the escape runs (day budget)`. The standing goal's day-1 budget had been spent (`2438`, the same second) |
| 18:07:16 (`2441`, `2442`) | `[escape] stuck at 78, 43, 70: getting out to 78, 79, 70 …`; `noPath; digging out by hand` |
| 18:07:17–18:07:21 (`2445`, `2448`, `2449`) | **A pickaxe made for the escape:** `placed the crafting table at (77, 43, 70)`; `[pickaxe] made a stone pickaxe (stick x1, stone_pickaxe x1)`; `[escape] no pickaxe: made a stone pickaxe; climbing again` |
| 18:07:35 (`2481`–`2484`) | **Interrupted by the model:** a new self-prompt loop (18:07:34) sent `!craftRecipe("cobblestone", 5)` for the shelter blocks. `action "action:craftRecipe" trying to interrupt current action "action:escape (trapped)"`; `still stuck at 80, 46, 71 after 19.7 s (dug 9, placed 0): Digging aborted`; `[trapped] still trapped: … stopped by something else; !goToSurface goes on from here.` |
| 18:07:40 (`2503`, `2505`) | `[trapped] at 80, 46, 71, idle: the escape runs (day budget)`; `stuck at 80, 46, 71: getting out to 80, 80, 71 (up to 42 steps, 5 min)` |
| 18:07:45 (`2513`) | `the pathfinder found no way (timeout); digging out by hand` |
| 18:08:54 (`2517`–`2520`) | **Interrupted by the cowardice reflex:** `[survival] flee zombie (outnumbered)`; `action "mode:cowardice" trying to interrupt current action "action:escape (trapped)"`; `still stuck at 80, 61, 72 after 73.7 s (dug 44, placed 0): Digging aborted`; `[trapped] still trapped …`. The bot was 19 blocks under the sky |
| 18:09:45 (`2547`) | `[death] died at 80, 61, 72` (item (g)) |

- **Give-ups: none.** No escape gave up. Each one ended as stuck, was interrupted, or ended with the death.
- **soak-invariants' raw output for this trap: 3 spans.** The #648 span logic ends a span with `moved away` when the next escape starts at another cell, so the climb up its own shaft splits the one trap in three:

```
trap span 18:03:31 (driver.log:2096) at 79, 25, 68 until 18:06:21 (driver.log:2191), 2.8 min, ended: moved away; 2 escapes not cleared, 0 interrupted
trap span 18:06:21 (driver.log:2191) at 78, 43, 70 until 18:07:40 (driver.log:2505), 1.3 min, ended: moved away; 2 escapes not cleared, 0 interrupted
trap span 18:07:40 (driver.log:2505) at 80, 46, 71 until 18:09:45 (driver.log:2547), 2.1 min, ended: died; 1 escapes not cleared, 0 interrupted
```

  The follow-up PR, after this one, ends a span only on a cleared escape, a death, or no further `[escape]` or `[trapped]` line within a short gap. Moving to a new trapped cell then continues the span. Its test is built from this journal. The tool is unchanged in this PR. The live checks showed the same: I1 fired at 18:03:31 and was reported to the lead at once.
- **The tool's escape episodes** (6; 5 not cleared, 1 cleared) are, in order: the trap check at 18:03:31 (27.2 s, could not pillar up), `!goToSurface` at 18:04:06 (127 s, could not step up), `!goToSurface` at 18:06:21 (0.4 s, no pickaxe), the trapped job at 18:07:16 (19.7 s, Digging aborted), the trapped job at 18:07:40 (73.7 s, Digging aborted), and trap 2.

**Trap 2: 18:40:16 to 18:41:47, cleared in 90.6 s.** At 18:39:27 the model sent `!collectBlocks("cobblestone", 14)`, which found none. At 18:39:37 it sent `!collectBlocks("undergroundbiomes:metamorphic_stone", 14)`.
- 18:40:16 (`2980`): `[escape] trapped at -16, 64, -171 after digging (3 cells searched, no walkable way to the sky): getting out first`.
- 18:40:17 (`2981`): `stuck … getting out to -16, 78, -171 (up to 22 steps, 5 min)`.
- 18:40:28 (`2984`): `timeout; digging out by hand`.
- 18:41:47 (`2987`): **`[escape] out at -15, 77, -171 (by hand; dug 37, placed 0) in 90.6 s`**.

The tool counts it as a cleared escape episode, not a trap span.

**Both traps came from a stone `!collectBlocks`.** In soak 16 the trap came from a `!goToCoordinates` walk, and the early trap from a metamorphic-stone collect. That is for skills-rotn.

## (c) Every `[attack]` line, and the fights with animals
| Time (line) | Line | Bot's health | Outcome |
| --- | --- | --- | --- |
| 17:59:48 (`1770`) | `[attack] attack (pvp) -> animania:ewe_dorset#516`, from the model's `!attack` for mutton | 20 (food 13 at 18:00:06, `1772`) | 2 Better Combat hits (`1771`). At 18:00:12 (`1773`): `Could not reach … no closer and no hit for 10 s; leaving it alone for 5 min` |
| 18:00:31 (`1848`) | `[attack] attack (pvp) -> animania:hen_plymouth_rock#36686`, from the model | 20 | `Successfully killed` at 18:00:45 (`1850`). The hen never hit the bot |
| 18:09:40 (`2542`) | `[attack] attack (one hit) -> zombie#956057` | 5, then 1 | in the shaft; the zombies killed the bot 5 s later |
| 18:37:46 (`2818`) | `[attack] hunt -> animania:hog_old_spot#261` | 20 (`[survival]` at 18:37:04) | `hunting animania:hog_old_spot: killed; picked up 2 animania:raw_prime_pork` (18:38:34) |

No animal hit the bot: there were 0 hurt lines from an animal. The I7 refusal (1) is the ewe's 5-min leave-alone. It was not followed by an attack that ran: at R4 the code refused the model's `!attack`.

## (d) Roof retries at night, and the shelters
There were **no roof retries**: no `roof` line, no other-side or one-lower try. All three nights' shelters held, with 0 hurt lines between any `sunset is near` and its morning line.

| Night | Sunset (line) | Shelter | Food for the night | Morning |
| --- | --- | --- | --- | --- |
| 1 | 17:31:44 (`1567`) | 41, 80, 38 (`1570`) | food 20, held 10.2, need 0: enough | 17:57:03–17:59:03: zombies near (`1598`–`1604`), so the bot stayed in for 2 min; then it left `by the side away from a zombie at 40, 80, 39` (`1605`, `1611`) |
| 2 | 18:11:41 (`2719`) | -51, 60, -66, where it respawned at night: `respawned at night in a closed shelter … staying, no escape` (`2727`) | food 12, held 0 (lost at the death), need 0 | 18:37:09: dug out by the west stairs (`2763`, `2766`) |
| 3 | 18:51:30 (`3238`) | -68, 66, -88 (`3241`) | food 9, held 20, need 5.6: enough | 19:17:06: dug out (`3289`) |

## (e) Craft refusals, and `click rejected:` lines
- **Craft refusals** (a craft the server would turn into another item): **0.** One craft was interrupted: `[craft] interrupted after 527 ms (limit 10000 ms): undergroundbiomes:metamorphic_cobble +1` at 18:04:02 (`2139`). It ended `The craft of undergroundbiomes:metamorphic_cobble was stopped before it finished; closed the inventory; crafted anyway: you now have 6 undergroundbiomes:metamorphic_cobble` (`2142`).
- **`click rejected:` lines: 2.** Both show the same pattern: the client had the stone pickaxe in a slot, and the server put it on the cursor with its damage one higher.
  - 18:03:58 (`2105`), during the trap 1 collect, followed by `[inventory] resync: the server resent the window; cursor: stone_pickaxe` and `before equip: put the stone_pickaxe on the cursor into slot 31`:
    > `[forge-bridge] click rejected: window 0 slot 31 (mode 0, button 0, action 532); client before the click: slot stone_pickaxe:79 x1, cursor -, grid [-, -, -, -]; server after it: slot -, cursor stone_pickaxe:80 x1, grid [-, -, -, -]`
  - 19:17:06 (`3284`), during the night-3 dig-out:
    > `[forge-bridge] click rejected: window 0 slot 43 (mode 0, button 0, action 1090); client before the click: slot stone_pickaxe:118 x1, cursor -, grid [-, -, -, -]; server after it: slot -, cursor stone_pickaxe:119 x1, grid [-, -, -, -]`

  Both came while the bot was digging with that pickaxe, so its damage on the server had gone up by one before the click. That is for net-forge.

## (f) `[tool] … broke` lines, and the pickaxe re-make
- 17:29:25 (`1264`): `[tool] spartanweaponry:club_wood broke (used up) on pyrotech_compat:rock_metamorphic at -70, 67, 24`. The bot had no weapon after that. The standing goal asked for one, and the agenda's `weapon` step re-opened at 18:07:38 (`server.log:687`).
- 18:06:10 (`2170`) and 18:06:11 (`2171`): `[tool] stone_pickaxe broke (used up) on undergroundbiomes:metamorphic_stone` at 78, 44, 71, then at 78, 45, 71. **It looks like one pickaxe whose break was logged twice:** every facts line before them names one `stone_pickaxe` and no second one, and the first facts line after them, at 18:06:14 (`2181`), names none.
- **The re-make:** the escape's `[pickaxe] made a stone pickaxe` at 18:07:18 (`2448`), at the table the model's re-plan had made possible (above). The escape's output, printed when it was interrupted at 18:07:35, reports the same craft: `Successfully crafted stick, you now have 4 stick.` and `Successfully crafted stone_pickaxe, you now have 1 stone_pickaxe.` (`2486`, `2487`). Note that the `[pickaxe]` line's ingredient list names `stone_pickaxe x1` among its inputs.

## (g) Hurt lines and deaths
| Time (line) | Line | Where |
| --- | --- | --- |
| 18:08:56 (`2521`) | `[survival] hurt 6 health 20->14 (by zombie)`, with one zombie 0.5 m away and two more within 6 m | 80.6, 57.5, 72.6 (in the shaft) |
| 18:09:21 (`2539`) | `hurt 6 health 11->5 (by zombie) since 14 at 18:09:17`, after the cowardice flee; the bot ate bread at 18:09:21 (food 6 → 9) | 78.8, 44.2, 70.5: **the flee took it back down the shaft** |
| 18:09:45 (`2544`) | `hurt 1 health 1->0 (by zombie) since 7 at 18:09:35` | 80.5, 61, 72.5 |

**One death: 18:09:45, `<bot> was slain by Zombie`** (`server.log:693`; `[death] died at 80, 61, 72`, `2547`).
- The bot lost its rocks, logs, dirt and cobble, and kept its axe and pickaxe.
- At 18:09:48 it logged `[respawn] no place 64 blocks from the spawn and 1 recent death spot within 160; the agenda resumes here`.
- This is the same shape as soak 16's death 1: a zombie at a trap exit, after the cowardice reflex had stopped the dig.

## (h) The LLM spend (`test/tools/soak-spend.mjs`)
| Window | Calls | Memory summaries | Completion tokens | Reasoning tokens | USD |
| --- | --- | --- | --- | --- | --- |
| Day 1 (17:17:04–17:31:44) | 66 | 0 | 23,797 | 22,136 | 0.014765 |
| Night 1 (17:31:44–17:57:03) | 0 | 0 | – | – | – |
| Day 2 (17:57:03–18:11:41) | 41 | 0 | 18,984 | 17,869 | 0.010210 |
| Night 2 (18:11:41–18:37:09) | 0 | 0 | – | – | – |
| Day 3 (18:37:09–18:51:30) | 16 | 0 | 8,813 | 8,348 | 0.004182 |
| Night 3 (18:51:30–19:17:06) | 0 | 0 | – | – | – |
| Day 4 (19:17:06–19:17:15) | 0 | 0 | – | – | – |
| **Total** | **123** | **0** | **51,594** | **48,353** | **0.029157** |

- **USD per hour:** the gate's figure is 0.014567 over 120 min. The gate's USD 0.029157 equals the tool's total.
- **Day vs night:**
  - Days: 43.8 min, 123 calls, USD 0.029157 = **0.0399/h**.
  - Nights: 76.4 min, 0 calls = **0/h**.
  - Soak 16: days 0.0709/h, nights 0.0037/h, the one night call being a summary.
- **Reasoning:** 48,353 of 51,594 completion tokens (93.7%), max 4,633 for one call. Every call had a `reasoning_tokens` line.
- **Self-prompting:** 28.5 min in 10 loop runs, with 118 calls inside them (USD 0.028271) and 5 outside (USD 0.000885).
- **The standing goal's daily budget** stopped the self-prompter at 18:07:33 (day 1) and 18:43:30 (day 2). The trapped escape went on after the day-1 stop (`[trapped] … idle: the escape runs (day budget)`).

## The soak invariants (`test/tools/soak-invariants.mjs`)
`node test/tools/soak-invariants.mjs test/evidence/g4/g4soak-17-20261126`:

| Invariant | Soak 17 | Lines |
| --- | --- | --- |
| I1 trapped | **3 raw trap spans, which are 1 trap: 18:03:31–18:09:45, 6.2 min, ended by the death** (above); 6 escape episodes, 5 not cleared, 1 cleared in 90.6 s | `2096`–`2547`; `2980`–`2987` |
| I2 enclosed morning | 0 | – |
| I3 rejected clicks | 2 | `2105`, `3284` |
| I4 dig refused with a usable tool | 0 of 0 | – |
| I5 sunset food short | 0 of 3 food-for-the-night lines; 0 food runs | – |
| I6 starving | 0 food lines at 4 or less (lowest 8); 0 `no safe food` runs over 5 min; 0 starving hurt lines | – |
| I7 gate then act | 0 of 1 refusals | the ewe, `1773` |
| I8 refused command | 0 by design; 9 replies whose command never ran | first 17:18:50 (`126`) |
| I9 false collect | 0 | – |
| I10 death loop | 0 loops (1 death) | – |
| I11 summary cost | 0 summaries; 0% of the spend (M4 check 5: 25 chunks cut with no summary call) | – |
| I12 unattributed hurt | 0 `(by unknown)` lines; 0 deaths with no mob named | – |
| I13 memory facts | checker gate **fail**, 26 misses in 746 fields, all 26 artefacts; **by hand 3 real wrong agenda facts the checker missed** (`45`, `681`, `697`); pickaxe and food held have 0 checker samples (hand checks: 0 wrong) | above |
| I14 wrong-state claims | checker 1 of 15; **by hand 0 of 15** | `2187` |
| I15 repeated failures | 4 (1.99/h), 4 after a facts line named the first | `344`, `901`, `1539`, `1995` |

The live checks during the run (every ~20 min on the partial journal, at 17:37, 17:57, 18:16, 18:37 and 18:57) all showed I2, I6 and I10 at 0. I1 fired at 18:03:31, and I reported it to the lead at once.

The baseline (`test/evidence/g4/invariants-baseline.json`) gets the soak 17 row. The diff adds only that row. **That row understates the fatal trap** (#661 review 3). It holds the tool's output today, `I1_trapped` 3 and `I1_longestMin` 2.8, which describes the same single trap of 6.2 min. The span-fix follow-up PR regenerates the row.

## Owners' notes
- **skills-rotn:**
  - Both traps started from a stone `!collectBlocks`, and trap 1's target was cobblestone at y 26, 55 blocks down.
  - The model's `!craftRecipe("cobblestone", 5)` interrupted the trapped escape (18:07:35).
  - The cowardice flee interrupted it again (18:08:54) and took the bot back down the shaft (hurt at y 44, 18:09:21).
  - A done agenda's facts line and its `!agenda` reply use the form `done (…), step X`. That is by design, and it is what A4 trips on.
  - The two food-held differences in (F).
  - A side note: at 18:00:20 `!searchForEntity("cow", 64)` found no cow (`1808`). A line 4 later, `Could not find any pig in 32 blocks. Animals in sight: animania:cow_holstein, animania:cow_holstein, …` (`1812`), is not this command's output, and its "in sight" list is different.
- **net-forge:** the two rejected clicks (e), both a pickaxe whose damage rose by one during a dig.
- **harness-ops (follow-ups after this PR):** the I1 span fix (the lead's call), which regenerates this soak's baseline row; the I13 fixes A1–A4 and S1; parsing `active, all steps done`; the stale-step check (`681`, `697`); the new sources for P and F; I14's `from y=A to y=B` (take the last y as where the bot is now); and the lead's new `no_trap` scenario check.
- **skills-rotn:** the facts' agenda step comes from `agent._agenda_step` (`memory_facts.js` `agendaLine`), the step the agenda driver last started.
  - It lags a step that is already done until the driver moves on (`681`, `697`).
  - With no step set yet, `describeAgenda` writes `active, all steps done; done: none` (`45`, 17:17:05).

## Files
Every file except `README.md` and `step7-starts.txt` went through `test/tools/redact-evidence.mjs <in> <out> --bot FRCFLD`. The redactor replaces addresses with `<ip>`, the bot's name with `<bot>`, UUIDs with `<uuid-v4>`, server ids with `<server-id>` and local paths with `<local>`. `redact-evidence.mjs --check` on this folder is clean, and so is `test/tools/secret-scan.mjs` after `git add`.
- `README.md`: this file, written by hand; it names no address, path or key.
- `driver.log`: the bot's journal for the run (`ssh cx23-ctl journal frcfld`), 3,311 lines. **Redacted** as above, with the line count unchanged, so the line numbers in this README are this file's lines.
- `server.log`: the test server's log as the runner read it. **Redacted** as above.
- `result.json`: the runner's result, with every sample. **Redacted** as above.
- `run.log`: the runner's console output. **Redacted** as above.
- `server-lifecycle.txt`: both servers. Server 1: `up`, `starts`, the postponement, `down`, and the Hetzner counts. Server 2: `up`, `starts` (twice), the since-start header, `save-all flush`, `down`, and the Hetzner counts. **Redacted** as above: addresses, server ids and the local state path. The `Waiting for …` progress lines of `up` and `down` are left out.
- `step7-starts.txt`: `test-server.sh starts` right after server 2's `up`, written by hand (two lines, no address).
