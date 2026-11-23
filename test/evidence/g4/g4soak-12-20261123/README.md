# G4 soak 12: `g4-soak-2h` on the CX23 service (2026-11-23)

**Label: the twelfth soak, run under the lead's written GO `G4-SOAK-12-20261123`. It is never G4 acceptance evidence.**
- The run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. It FAILED: 8 checks passed and 1 failed (`ate_when_low`: 1 of 13 `low` lines with no eat after it, the one at 15:14:46 after death 2).
- `result.json` marks it not-gate (`gateValid: false`) for two reasons:
  - the S-run reason from #436;
  - the step-7 runner's reasons: there is no `ROTN_G4_ACCEPT` marker, so conditions (a) and (d) fail. Conditions (b), (c) and (e) hold.
- **The first soak on rotn-v0.1.18.** `agenda_done` and `food_floor` passed (both failed in soak 11): the agenda was done at 13:35:3x, and food never went below 12. The run went the full 120 min with no process restart and no agent exit (`no_crash` passed).
- **No death for the first 109 min.** The bot came through nights 1 and 2. It killed a spider (14:04:32) and, from inside the night-2 shelter, a zombie with the club (14:30:31).
- **16 deaths in the last 11 min, all reported** (server causes, `server.log`):
  - **Death 1** (15:11:12, `slain by Zombie`), in the night-3 shelter at 16, 64, -46. Three seconds after the bot broke a scaffolding block inside its 1x2 space, a zombie was in the bot's cell. The bot logged `fighting it from the shelter` 14 times, but no `fight start` or `swing` line. The `lost` line lists 344 dirt piles, 42 logs and the club (`club_wood:41`), but the club was in the off hand again after the respawn.
  - **Deaths 2 to 16** (15:14:42 to 15:21:37) were a loop at the respawn point the bot had set with the Scroll of New Life at sunset 2 (-70, 65, 87, the night-2 hole shelter):
    - 13 `slain by Zombie` and 2 `shot by Skeleton` (15:18:09, 15:18:42);
    - every death within 3 blocks of the respawn point;
    - each respawn escape ended 0 to 2 blocks from the spawn.
  - No `slain by Zombie <bot>` line.
- **The respawn escape** ran 15 times (after deaths 2 to 16; none after death 1, see below). Every run was `try 1 of 3`:
  - 8 were `interrupted by self_preservation … running it again`, and the bot died within 2 s each time;
  - 5 `ended with a death`;
  - 1 `ran out of its 60 s at 0 blocks from the spawn`;
  - the last was still running at the stop.
  - The `recent death spots` count went 2, 3, … 16 (up by one each time).
- **The club:** crafted once, by the agenda's weapon step (13:24:1x). 1 hunt with it (stuck), 1 zombie kill with it (8 swings). It was in the off hand after death 1. Each `lost` line for deaths 1 to 13 names `spartanweaponry:club_wood:N`, N from 41 to 125, up by 7 each time. No other club craft.
- **The Scroll of New Life was used once** (14:17:08–14:17:13), `seen by the stack shrank, on try 2`. The server granted the scroll advancement at the same second (`server.log:755`–`757`).
- **Repairs:** 3. Two closed the shelter. One stopped: `the repair stopped: a zombie in the opening` (14:44:04). There was **no `the repair stopped: hit by` line** and **no burrow line**. There was 1 self-seal (14:17:26).
- **No `block did not stay` line.**
- **Cost:**
  - **Overall:** USD 0.0343/h. Every call went to the provider `Wafer`.
  - **By the self-prompting windows (36.7 min):** USD 0.111/h.
  - **Reasoning:** 95% of the completion tokens.
  - **Memory summaries:** 27% of the completions and 32% of the spend.
- **The root cause is not judged here.** The lines are listed for skills-rotn under "For the owners".

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.18` = develop `5101e5c8`, a fresh detached checkout. `npm ci` ran first, with no other `npm ci` on the CX33, then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. It started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-12-20261123:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-12-20261123`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, release `rotn-v0.1.18`, which the lead deployed through the gate. The unit was inactive and disabled before the run. The human set the env `host` to this test server and confirmed it, with the file `root:root 600`. After the unit's systemd start (13:21:33), the journal shows: `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[release] rotn-v0.1.18-5101e5c84e30` (the harness's commit); `[state] <bot> at start: tasks=absent agenda=absent memory=absent`; `[forge-bridge] bettercombat attack: on`. Three `Error with embedding model, using word-overlap instead.` lines at 13:21:40 |
| Test server | `mcr-test-20261123-123354`, a CPX42 in nbg1. Created 12:33:58, ready 12:39:23, deleted 15:22:32: 168 min, billed about 3 h, EUR 0.4143 plus the IPv4. The watchdog `delete-after` was 2026-11-23T16:33:58Z (TTL 4 h). Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 test SSH keys (`server-lifecycle.txt`) |
| Step-7 check | `test-server.sh starts` right after `up` (12:39:23): `starts=1 files=1` (`step7-starts.txt`). The same after the run, before `down` |
| World | The G2/G3/M1 seed `1880465901402976865`, fresh: `world 50691 of at most 56954 ticks` at the step-7 read (the server waited 42 min for the host confirmation) |
| Server | Firewall: ports 22 and 25565 only from the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 11 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match; 0 extra mods |
| Timing | The scenario ran 13:21:25 to 15:22:06 UTC. **Each join time names its source:** the unit started at **13:21:33** (systemd, `driver.log`). The server logged `<bot> joined the game` at **13:21:51** (`server.log:10`). The journal shows `<bot> spawned.` at **13:21:53** and `Self-prompting started.` at **13:21:54**. The runner's `login_online` passed at **13:21:55** (`run.log`). Next came 120 min of samples every 5 min (25 samples), then the runner's ctl stop. The unit was stopped at 15:22:03 (systemd: `624.4M memory peak`, 18 min 6 s of CPU). The journal covers the whole soak (`journalCoverage`: 120.1 of 120.1 min) |

## The checks (`result.json`)
| Check | Result | Detail |
| --- | --- | --- |
| `login_online` | PASS | joined, a version-4 (Mojang account) UUID |
| `naming` | PASS | `[naming]`: 14 kinds, unknown 0, all real; entities: 1 kind (`betteranimalsplus:eel_freshwater`), unknown 0 |
| `no_crash` | PASS | 120 min up, 25 samples, `NRestarts` 0 throughout, no agent exit |
| `peak_memory` | PASS | 624 MiB (target 850) |
| `usd_per_hour` | PASS | USD 0.034265/h: USD 0.068589 over 120 min, 203 completions (target 0.05) |
| `agenda_done` | PASS | `agenda done` at 13:35:3x (`server.log:498`), 14 min after the join |
| `food_floor` | PASS | lowest food 12, from 126 food lines (floor 6) |
| `ate_when_low` | **FAIL** | 1 of 13 `low` lines had no eat after it: 15:14:46 (food 12, health 20), 4 s after death 2, with nothing held (the escape ran next). The other 12 were each followed by an eat within 37 s |
| `deaths_reported` | PASS | each of 16 deaths reported |

The survival notes show 24 eats, 7 fights (2 killed, 1 interrupted, 4 stopped), 36 flees and 126 food lines.

## The LLM spend and the reasoning tokens (per window)
The windows come from the journal: the night routine's `sunset is near` line and the first `morning` line of each night. The bot then stayed in for up to 3 min while a zombie was near; the first call after each night is later than that. No call falls on a boundary.
- Every completion was answered by the provider `Wafer` (203).
- **The rule for a memory summary:** a call whose prompt is under 2,000 tokens. There are 54, and the journal has 54 `Memory updated to:` lines.

| Window | Min | Completions | USD | USD/h | Completion tokens | Reasoning tokens | Memory summaries (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Day 1: join to `sunset is near` (13:21:55–13:36:22, up to `driver.log:1647`); a self-prompting window | 14.5 | 98 | 0.025392 | 0.105 | 65,147 | 60,264 | 24 (0.006188) |
| Night 1 (13:36:22 from `driver.log:1648`, to `morning` at 14:01:54, `driver.log:1685`) | 25.5 | 0 | 0 | 0 | 0 | 0 | 0 |
| Day 2 (14:01:54–14:16:49, up to `driver.log:2546`); self-prompting from 14:04:21 | 14.9 | 53 | 0.022482 | 0.090 | 82,895 | 79,861 | 14 (0.006418) |
| Night 2 (14:16:49 from `driver.log:2547`, to `morning` at 14:41:53, `driver.log:2636`) | 25.1 | 1 | 0.000175 | 0.000 | 767 | 626 | 1 (0.000175) |
| Day 3 (14:41:53–14:56:21, up to `driver.log:3654`); self-prompting from 14:44:56 | 14.5 | 51 | 0.020539 | 0.085 | 72,849 | 69,841 | 15 (0.009183) |
| Night 3 (14:56:21 from `driver.log:3655`, to the stop at 15:22:03) | 25.7 | 0 | 0 | 0 | 0 | 0 | 0 |
| **The run** | **120.1** | **203** | **0.068589** | **0.0343** | **221,658** | **210,592 (95%)** | **54 (0.021965, 32%)** |

- **The self-prompting windows:** 36.7 min in three runs (13:21:54–13:36:22, 14:04:21–14:16:48 and 14:44:56–14:54:42), 201 completions, USD 0.067800 (0.111/h). The memory summaries made in them are side calls, not self-prompts. The other 2 calls are memory summaries: the night-2 one (14:16:52, `driver.log:2551`) and one at 14:54:48 (`driver.log:3645`), right after day 3's self-prompting stopped.
- **Day 3's self-prompting stopped on its budget:** `[agenda] standing goal budget spent: 5 min of self-prompting for day 2` (14:54:38, `driver.log:3626`). No LLM call came after 14:54:48. Every death came while the night routine or the escape ran, and the re-plan prompts were held (`re-plan prompt held: the night routine is running`, `re-plan requested (no LLM call now)`).
- **Prompt tokens:** 663,776 in all.
- **The largest and the most expensive call:** 14:05:50 (`driver.log:1747`), 4,531 prompt and 8,210 completion tokens, all reasoning, USD 0.001701 (2.5% of the run's spend). Its reply was empty.
- **Empty replies:** three completions had no content (13:27:31, 14:05:50, 14:47:02), each `content null chars`, then `Empty content returned (model @preset/glm-5-3-flash-cheap-reliable, finish_reason stop)`.

## What happened
### Day 1 (13:21–13:36)
- **The agenda** (server.log chat):
  - rocks (13:22:34), sticks (13:23:04), crude_axe (13:23:08) and logs (13:24:1x, `Collected 47 log`);
  - the weapon step (below);
  - first_plank and shelter_blocks (`Collected 56 betterwithmods:dirt_pile`, 13:25:12);
  - food: `stuck: 5 min of self-prompting` (13:30:1x);
  - crafting_tools, crafting_table, planks_sticks, stone_pickaxe, shelter_blocks (cobblestone from rocks) and stone_axe;
  - **`agenda done`** (13:35:3x, `server.log:498`), then `agenda standing goal started (day 0)`.
- **The club (agenda weapon step):** `agenda step weapon started: hold a weapon for the night`, then `agenda step weapon: crafting spartanweaponry:club_wood (try 1 of 2)` (13:24:1x, `server.log:120`–`128`), and `[craft] bot.craft returned after 452 ms` (13:24:17, `driver.log:229`). The inventory first lists `spartanweaponry:club_wood: 1` at 13:24:28.
- **The hunt with the club:** `[survival] weapon spartanweaponry:club_wood (hunt)` (13:26:15, `driver.log:679`), then `[reflex] hunting animania:sow_old_spot: stuck (left alone for 5 min)` (13:26:26). Searches for cow, pig, sheep and rabbit within 64 blocks found none (13:25:40–13:25:49).
- **Food:** foraging `harvestcraft:shadedgarden` at 13:25:27, 13:26:14 and 13:36:22 (blackberry, zucchini, leek, bean, spice leaf, …).

### Night 1 (13:36–14:04)
- `sunset is near` (13:36:22) with `food worth 8 hunger held, food 20; enough`; `in the shelter at -32, 74, -88 until morning` (13:36:28). The scroll: `not used at -32, 74, -88: 15 blocks from the spawn (it needs 100)`.
- `[shelter] spider (hits through walls) at -32.0, 76.0, -90.0: standing at -31.30, -87.30 in the cell, away from it` (13:47:27).
- **Morning:** a zombie at -33, 74, -89 stayed within 8 blocks for 2 min (14:01:54–14:03:54). Then `3 hostile mobs near: leaving the shelter … by the side away from a zombie` and `dig out: the east side (a step up, 2 blocks)`. The bot left at 14:04:21 (`driver.log:1698`).
- **Fight 1:** `fight start spider (open)` (14:04:25), `fight end spider killed after 7 s` (14:04:32, `driver.log:1712`).

### Day 2 (14:04–14:17)
- Cobblestone from rocks for the shelter blocks; a second stone pickaxe (14:15:17); foraging at 14:12:25.
- Eats at food 12: a blackberry (14:07:38), a rhubarb and a zucchini (14:14:54–14:14:56).

### Night 2 (14:17–14:45)
- **The shelter:** `sunset is near` (14:16:49) with `food worth 10 hunger held, food 13; enough`. Then `shelter try 1 of 3 failed (… 2 open (-70, 68, 86: dynamictrees:trunkshell is in it; …); placed 7.); digging a hole shelter instead` (14:16:57). Then `in the shelter at -70, 65, 87 until morning` (14:17:08).
- **The Scroll of New Life** (`driver.log:2563`–`2565`, `server.log:754`–`757`):
  - 14:17:08: `setting the respawn point here at -70, 65, 87 with the Scroll of New Life (once): far from the spawn and every death spot, no hostile near`.
  - 14:17:13: the server logged `<bot> has made the advancement [Ancestral Recall]` and `Granted the entire advancement 'triumph:advancements/magick/incantation/scroll_newlife'`. The bot logged `the respawn point is now -70, 65, 87: a death within 32 blocks of it raises no player zombie (seen by the stack shrank, on try 2)`.
- **Self-seal:** `moving into a side pocket at -69, 65, 87 and sealing the shaft behind` (14:17:24), `moved into the side pocket: in the shelter at -69, 65, 87, the cells behind sealed` (14:17:26, `driver.log:2568`). Next came `the shelter is open at -69, 67, 87: repairing` and `the repair closed the shelter` (14:17:27).
- **Fight 2, from the shelter** (`driver.log:2594`–`2619`):
  - 14:30:22: `zombie is digging the shelter at -69, 66, 86: checking at once, ready to repair`, then `armed, health 20 above the 10.5 a zombie may hit for, and the only melee mob near: fighting it from the shelter first, then the repair` (4 lines).
  - 14:30:24–14:30:31: 8 swings with `spartanweaponry:club_wood`, 751–753 ms apart, the zombie's health 19 → 16.2 → … → 0 → gone. One `hurt 6 (by zombie)` (20 → 14).
  - `fight end zombie killed after 7 s` and `Fought from inside the shelter: 8 swings, stopped: nothing left in reach.` Then `the shelter is open at -69, 65, 86; -69, 66, 86: repairing` and `the repair closed the shelter at -69, 65, 87` (14:30:31).
- Eats at food 12 in the shelter: a rhubarb (14:21:51), a leek (14:29:41) and a spice leaf (14:36:05).
- **Morning** (14:41:53–14:44:56): a zombie at -69, 67, 86 stayed for 2 min. Then came the leaving tries:
  - `a hole shelter: leaving the shelter … by the side away from a zombie`;
  - `no side … away from a zombie … to open yet` (tries 1 to 3);
  - a repair at 14:44:03 that **stopped: `the repair stopped: a zombie in the opening at -68, 66, 87; deciding again`** (`driver.log:2655`);
  - at 14:44:56: `could not leave the shelter at -69, 65, 87 after 3 tries …; back to work, still enclosed: dig a way out` (`driver.log:2662`).

### Day 3 (14:45–14:56)
- **Fights 3 to 6:**
  - `fight start zombie (open)` (14:45:53), `interrupted after 24 s` by the unstuck reflex.
  - Three skeleton-horse fights, each `stopped` after 4, 4 and 8 s (14:46:33–14:46:55). The skeleton horse hit the bot for 5.1 (14:46:36). The bot fled from a skeleton (ranged) and from an `iceandfire:if_troll (dangerous)`.
- Flees from zombies at health 7.1, 8.1 and 10.1 (14:47:39–14:48:00), and from a llama herd (14:50:12, 14:51:53).
- **The hunt and the kill pickup:**
  - `[reflex] hunting animania:ewe_dorset: killed; picked up 2 feather` (14:49:12, `driver.log:3091`).
  - The LLM's `!attack("animania:ewe_dorset")` got `Could not reach … leaving it alone for 5 min` (14:49:34). A second `!attack` got `Successfully killed animania:ewe_dorset.` (14:51:18, `driver.log:3233`), followed by `Picked up 0 items.`
  - The first `raw_prime_mutton` line is an eat at 14:51:02 (`driver.log:3211`). The inventory listed `animania:raw_prime_mutton: 2` at 14:53:49.
- Fall damage: `hurt 4 (by fall)` at 14:49:35.
- **The budget stop:** `standing goal budget spent: 5 min of self-prompting for day 2` (14:54:38). The last command was `!forage`: `Foraged 0 blocks, got nothing` (14:54:42).

### Night 3 (14:56–15:22)
- **The shelter:** `sunset is near` (14:56:21) with `food worth 8 hunger held, food 13; enough`; `in the shelter at 16, 64, -46 until morning` (14:56:22); the scroll: `not used at 16, 64, -46: no scroll held`. Wildberries at food 12 (15:03:56).
- **Death 1** (`driver.log:3679`–`3735`, `server.log:1734`–`1736`):
  - 15:11:00: `contenttweaker:scaffolding at 16, 65, -46 (a solid block in the 1x2 space): breaking it from inside; staying in the shelter`.
  - 15:11:03–15:11:07: `a zombie in the bot's cell at 16, 64, -46: not leaving past it; armed, health N above the 10.5 it may hit for: fighting it from the shelter`, 14 lines, with health 20, 17, 14 and 11. No `fight start` or `swing` line follows them.
  - `hurt 6 (by zombie)` at 15:11:04 (20 → 14) and 15:11:09 (11 → 5), the zombie at 0.6 m.
  - Eats: 8 `ate animania:raw_prime_mutton:0 food 12->12` from 15:11:08 to 15:11:12, around the hurt lines; `hurt in the shelter: not eating (zombie 0.6 blocks away)` (15:11:11) came between two of them.
  - 15:11:11: `[shelter] health 2, a zombie hits up to 10.5: not fighting from the shelter unless cornered`.
  - 15:11:12: died at 16, 64, -46 (`slain by Zombie`). Lost: `344 betterwithmods:dirt_pile, 42 log:1, 11 pyrotech_compat:rock_metamorphic, 11 undergroundbiomes:metamorphic_cobble, …`.
- **After the respawn at the scroll's point (no escape):**
  - `it is night: building a shelter` (15:11:18) with `food worth 1 hunger held, food 13; less than 6: staying sealed anyway`. The shelter build at -69, 64, 87 failed: `you have 0 dirt and 0 dirt piles`. The pickaxe check showed `inventory: none; off hand: spartanweaponry:club_wood; held: animania:raw_prime_mutton`. Then `the hole shelter failed (… refused: space not free 141, not quick to dig by hand 6; at -69, 64, 87, on undergroundbiomes:sedimentary_stone)`.
  - Two rounds of `no shelter after 3 tries and a hole shelter …; staying here until morning` (15:12:21, 15:14:24), with `quiet for 60 s: trying a shelter again (1 of 4)` (15:13:22) between them.
  - **No `[respawn] escape` line after death 1.** The escape first ran at 15:14:46, after death 2.
- **Death 2** (`driver.log:3792`–`3805`, `server.log:1753`): `hurt 5 (by zombie)` twice (15:14:38–15:14:39). Then `fight start zombie (open)` with `weapon animania:raw_prime_mutton (open)` (15:14:40), `fight end zombie stopped after 1 s`, `flee zombie (melee, and health 10 …)`, and two more `hurt 5` (15:14:41–15:14:42). It died at -69, 64, 88 at 15:14:42 (`slain by Zombie`).
- **Deaths 3 to 16:** the loop in the table below. The hurt details name a zombie at 0.2 to 1.6 m in each, with a skeleton horse and a skeleton 1.3 to 12.7 m away. The bot's chat said `I died 3 times in 10 min; I stop reporting deaths in chat for now.` (15:15:14, `server.log:1757`). The runner stopped the unit at 15:22:03, during escape 15 (health 6.5 after three `hurt 4.5`).

## The lines the lead asked for
### Deaths and causes
| # | Time | Server cause (`server.log`) | Where (bot) | What came before |
| --- | --- | --- | --- | --- |
| 1 | 15:11:12 | `slain by Zombie` (1736) | 16, 64, -46 | in the night-3 shelter: scaffolding broken from inside, then a zombie in the bot's cell |
| 2 | 15:14:42 | `slain by Zombie` (1753) | -69, 64, 88 | at the respawn point, no shelter (0 dirt), a 1 s fight holding mutton |
| 3 | 15:15:07 | `slain by Zombie` (1756) | -71, 63, 89 | escape 1 interrupted by self_preservation at 2 blocks |
| 4 | 15:15:33 | `slain by Zombie` (1759) | -70, 63, 88 | escape 2 interrupted at 1 block |
| 5 | 15:16:02 | `slain by Zombie` (1763) | -71, 63, 89 | escape 3 ended with a death at 0 blocks |
| 6 | 15:16:25 | `slain by Zombie` (1764) | -69, 64, 89 | escape 4 ended with a death at 1 block |
| 7 | 15:16:52 | `slain by Zombie` (1767) | -71, 62, 89 | escape 5 interrupted at 1 block |
| 8 | 15:17:16 | `slain by Zombie` (1768) | -72, 59, 89 | escape 6 interrupted at 1 block |
| 9 | 15:17:42 | `slain by Zombie` (1770) | -68, 64, 88 | escape 7 interrupted at 1 block |
| 10 | 15:18:09 | `shot by Skeleton` (1772) | -70, 62, 87 | escape 8 ended with a death at 1 block; the hurt lines say `by zombie` (5, 6.9, 5), a skeleton at 1.3–2.4 m |
| 11 | 15:18:42 | `shot by Skeleton` (1774) | -69, 63, 89 | escape 9 ended with a death at 0 blocks; the hurt lines say `by zombie` (5, 5, 7.6) |
| 12 | 15:19:07 | `slain by Zombie` (1777) | -69, 63, 88 | escape 10 interrupted at 0 blocks |
| 13 | 15:20:16 | `slain by Zombie` (1781) | -72, 59, 89 | escape 11 ran out of its 60 s at 0 blocks (15:20:12) |
| 14 | 15:20:42 | `slain by Zombie` (1784) | -72, 59, 89 | escape 12 interrupted at 0 blocks |
| 15 | 15:21:07 | `slain by Zombie` (1785) | -69, 64, 89 | escape 13 interrupted at 0 blocks (two `hurt 9.5`) |
| 16 | 15:21:37 | `slain by Zombie` (1788) | -70, 63, 86 | escape 14 ended with a death at 0 blocks |

- **Player zombies:** no `slain by Zombie <bot>` line. The only `zombie_players` lines in `server.log` are the mod list. Every death after death 1 is within 3 blocks of the scroll's respawn point. The bot's rule text says `a death within 32 blocks of it raises no player zombie`; the logs cannot show whether one rose.
- **Distances** (horizontal): death 1 is 158 blocks from the respawn point (-70, 87) and 64 from the night-1 shelter. Deaths 2 to 16 are 0 to 3 blocks from the respawn point.
- **Each death has two `[death]` lines:** `died at …; waiting for the respawn` at the death, and `died at …; lost …` 5 to 7 s later (32 in all).

### The respawn escapes
| # | After death | Start (`driver.log`) | `recent death spots` | How it ended | Seconds |
| --- | --- | --- | --- | --- | --- |
| 1 | 2 | 15:14:46 (3817) | 2 | interrupted by self_preservation at 2 blocks (15:15:06), death 1 s later | 20 |
| 2 | 3 | 15:15:11 (3843) | 3 | interrupted at 1 block (15:15:32) | 21 |
| 3 | 4 | 15:15:37 (3871) | 4 | ended with a death at 0 blocks (15:16:02) | 25 |
| 4 | 5 | 15:16:05 (3908) | 5 | ended with a death at 1 block (15:16:25) | 20 |
| 5 | 6 | 15:16:29 (3944) | 6 | interrupted at 1 block (15:16:50) | 21 |
| 6 | 7 | 15:16:55 (3978) | 7 | interrupted at 1 block (15:17:15) | 20 |
| 7 | 8 | 15:17:19 (4006) | 8 | interrupted at 1 block (15:17:41) | 22 |
| 8 | 9 | 15:17:46 (4040) | 9 | ended with a death at 1 block (15:18:09) | 23 |
| 9 | 10 | 15:18:13 (4078) | 10 | ended with a death at 0 blocks (15:18:42) | 29 |
| 10 | 11 | 15:18:44 (4110) | 11 | interrupted at 0 blocks (15:19:06) | 22 |
| 11 | 12 | 15:19:10 (4135) | 12 | **ran out of its 60 s at 0 blocks** (15:20:12) | 62 |
| 12 | 13 | 15:20:20 (4187) | 13 | interrupted at 0 blocks (15:20:42) | 22 |
| 13 | 14 | 15:20:46 (4214) | 14 | interrupted at 0 blocks (15:21:06) | 20 |
| 14 | 15 | 15:21:11 (4237) | 15 | ended with a death at 0 blocks (15:21:37) | 26 |
| 15 | 16 | 15:21:40 (4271) | 16 | still running at the stop (15:22:03) | – |

- Every escape line reads `escape (try 1 of 3): sprinting at least 64 blocks from the spawn and N recent death spots; no digging, no pickups, no fights`. After each interruption the bot logged `running it again`, but the next line was a death, and the following escape again said `try 1 of 3`.
- No escape got farther than 2 blocks from the spawn. From 15:14:42 on, the flee reflexes logged 18 `Moved away from enemies, but only to N blocks of the 16 (stopped)` lines (N 0 to 3; once 7 of 18) and 16 `flee zombie (outnumbered)` lines, most in the escapes' first seconds.
- No `[escape]` (stuck) line in the run.

### The club, fights and weapon lines
- **Crafts:** 1, the agenda weapon step at 13:24:1x (`server.log:128`, `driver.log:229`). No LLM craft, no reserve auto-craft.
- **`[survival] weapon` lines:** 2: `spartanweaponry:club_wood (hunt)` at 13:26:15, and `animania:raw_prime_mutton (open)` at 15:14:40 (death 2's fight, with the club in the off hand).
- **Fights:** 7 (`notes.survival`):
  - a spider, killed after 7 s (14:04:32);
  - a zombie from the shelter, killed after 7 s with 8 club swings (14:30:31);
  - a zombie in the open, interrupted by the unstuck reflex after 24 s (14:46:17);
  - three skeleton horses, each stopped (14:46:36, 14:46:43, 14:46:55);
  - the 1 s zombie fight before death 2 (15:14:41).
- **`[survival] swing` lines:** 8, all in fight 2.
- **Hunts:** 2 by the reflex: `animania:sow_old_spot: stuck` (13:26:26, 13:31:39) and `animania:ewe_dorset: killed; picked up 2 feather` (14:49:12). The LLM's `!attack` killed a second ewe (14:51:18).
- **The club after the deaths:** `off hand: spartanweaponry:club_wood` at every pickaxe check after death 1 (15:11:18–15:14:24). The `lost` lines name `spartanweaponry:club_wood:41`, `:48`, … `:125` for deaths 1 to 13 (13 lines, up by 7 each). Deaths 14 to 16 list none.
- **Flees:** 36 in all.
- **`[forge-bridge] bettercombat`:** one line, `bettercombat attack: on`. No `hits without a hurt` trip.

### Shelters, repairs, burrows and self-seals
- **Shelters reached:** 3: -32, 74, -88 (13:36:28), the hole at -70, 65, 87 (14:17:08) and 16, 64, -46 (14:56:22). After death 1, none: 4 `shelter try N of 3 failed`, 2 `the hole shelter failed` and 2 `no shelter after 3 tries and a hole shelter`, all for `0 dirt and 0 dirt piles` at -69, 64, 87 (plus 1 `the shelter build was interrupted; it does not count as a try`).
- **Self-seals into a side pocket:** 1, at 14:17:26 (`the cells behind sealed`).
- **Burrows:** none (no `burrow` line).
- **Repairs:** 3: 14:17:27 (after the self-seal) and 14:30:31 (after the fight), each `the repair closed the shelter`; 14:44:03, stopped by `a zombie in the opening` (morning, night 2). A `[craft]` line came with the last (431 ms).
- **`the repair stopped: hit by`:** 0 lines. **`the repair stopped`:** 1 line (`a zombie in the opening`, 14:44:04).
- **`the block did not stay`:** 0 lines.

### The Scroll of New Life
- **Used once,** at the night-2 hole shelter, -70, 65, 87 (14:17:08–14:17:13). The bot logged `seen by the stack shrank, on try 2`, and the server granted `triumph:advancements/magick/incantation/scroll_newlife` (`server.log:756`) at the same second.
- **The skips:** one for distance, `15 blocks from the spawn (it needs 100)` (13:36:28), and one at sunset 3, `no scroll held` (14:56:22).
- All 15 later deaths came within 3 blocks of this respawn point.

### Food, kill pickups and eating
| Time | Food | What happened |
| --- | --- | --- |
| 13:21:53–13:41:54 | 20 | day 1, night 1 |
| 13:42:54–14:06:55 | 19 → 13 | night 1, day 2 (one point each 4 min) |
| 14:07:33–15:11:07 | 12 ↔ 13 | 12 `low` lines at food 12, each followed by an eat (back to 13, except the mutton eats during death 1) |
| 15:12:07–15:14:07 | 13 | after death 1 (the last mutton eat at 15:11:18 gave 12 → 13) |
| 15:14:46–15:21:46 | 12 | the death loop; no eat |

- **The eats:** 24 `[survival] ate` lines: 11 `animania:raw_prime_mutton` (1 at 14:51:02, 10 from 15:11:08 to 15:11:18, 9 of them `12->12`), 3 wildberries, 2 beans, 2 rhubarb and one each of blackberry, zucchini, leek, spice leaf, tea leaf and scallion. All are from the eating reflex.
- **The `low` tag:** 13 lines, all at food 12 (one with health 9.1, one with health 11). `ate_when_low` fails on the last one (15:14:46).
- **Food runs:** no line names a food run. `agenda step food started: keep food for the day and the night` came at 14:51 (`server.log:1678`). Searches for pig, cow and sheep came at 13:25:40–13:25:44 and 14:51 (none found within 64 blocks at day 1).
- **Kill pickups:** one reflex line, `picked up 2 feather` (14:49:12). The mutton was first eaten at 14:51:02.
- Foraging got food at 13:25:27, 13:26:14, 13:36:22, 14:12:25, 14:49:00 and 14:51:23. `No ripe wild food within 24 blocks` came 14 times.

### The rest
- **`[craft]`:** 50 `bot.craft returned after N ms` lines, from 325 to 2314 ms (13:23:06 to 14:45:02). Most are cobblestone from rocks (4 rocks each). There were 4 table pickups (`the table pickup ended after` 5450, 5947, 2223 and 9732 ms). The last one, at 14:15:17, came with `Failed to place crafting_table` and `Failed to collect crafting_table: Timeout: Took to long to decide path to goal!`, then `Collected 1 crafting_table, late pickups included`. No `abandoned craft`, `timed out` or stopped line.
- **`[inventory]`:** one `Server rejected transaction for clicking on slot 11` during the night-2 shelter craft (14:17:06), then `resync` and `put the betterwithmods:dirt_pile on the cursor into slot 11`. The craft returned after 2314 ms.
- **collectBlock pickup or cancel timeouts:** none. No `MaxListenersExceededWarning` line.
- **Escape from stuck:** no `[escape]` line. The unstuck reflex interrupted a fight (14:46:17) and a flee (14:50:59), each `re-plan requested (no LLM call now)`.
- **Ore skips for a liquid:** none.
- **Trees:** `up on a tree: climbing down before the agenda goes on` and `down from the tree` (14:52:18).
- **Process restarts:** none. The journal's only `Agent process exited` line is the stop at 15:22:03 (code 0).

## Server-side notes (not about the bot)
- `server.log` (the runner's copy, 13:21:31 to 15:22:03) has one `Object successfully summoned` line, `[Skeleton: …]` at 13:42:33 (`server.log:552`), a pack command sender as in soaks 8, 10 and 11.
- 6 `Can't keep up!` lines from 13:24:36 to 13:26:35 (at most 2964 ms behind), and 195 lines naming `causing cascading worldgen lag`. No crash report and no `Failed to save chunk` line.

## Step 7 (harness-ops)
- `starts=1` after `up` and again after the run.
- The world was fresh: 50691 ticks at the read, against at most 56954.
- The release was read from the journal's `[release]` line.
- Only (a) and (d) fail, as for every soak.

## For the owners (not judged here)
This section only points at the lines above:
- the scroll's respawn point is the night-2 hole shelter cell, which the bot could not leave at morning (`still enclosed: dig a way out`, 14:44:56); every later death came within 3 blocks of it;
- no respawn escape ran after death 1 (night: the night routine ran instead, with 0 dirt), so the bot stayed at the respawn point for 3.5 min;
- the escapes did not get farther than 2 blocks from the spawn; 8 were interrupted by self_preservation, each followed by a death and another `try 1 of 3`;
- death 1: a zombie in the bot's cell 3 s after the scaffolding was broken from inside; 14 `fighting it from the shelter` lines with no fight or swing line; 8 mutton eats at `12->12` while hit;
- death 2's fight held `animania:raw_prime_mutton` with the club in the off hand;
- deaths 10 and 11: the server says `shot by Skeleton`, the bot's hurt lines say `by zombie`;
- the `lost` lines name the off-hand club for deaths 1 to 13 (`club_wood:41` … `:125`), and after death 1 up to 112 rocks and 48 dirt piles each.

## Soak 11 corrections (the #585 review)
`../g4soak-11-20261122/README.md`:
- the Scroll paragraph now cites the bot's chat at 21:31:58 and 21:32:00 (`server.log:774`–`775`), not only 775;
- the "Food over time" table has the missing row `20:59:04–21:02:04 | 19 | night 1`.

## Files
Each file was made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean.
- `result.json`: the runner's result, with the checks, `notes.samples`, `notes.llmUsage`, `notes.survival`, `notes.deaths` and `g4Acceptance`.
- `run.log`: the runner's stdout (`run.stdout` in the raw folder).
- `server.log`: the test server's log for the run, as the runner fetched it (`latest.log`).
- `driver.log`: the CX23 journal of `mindcraft-rotn@frcfld` from the unit's start to its stop, read through the gate.
- `step7-starts.txt`: `test-server.sh starts` right after `up`, under a header line naming the command, the time and the server.
- `server-lifecycle.txt` contains:
  - the `test-server.sh up` log and both `starts` reads;
  - the header of the since-start log fetched before `down` (`found=1 lines=22071`); the run's part of it is the same as `server.log`;
  - the `test-server.sh down` log, ending `verified gone: server, Primary IPv4 and SSH key`;
  - the hcloud counts saved at the delete: `servers 0`, `primary_ips 0`, `ssh_keys_mcr_test 0` at 15:22:33Z. The 2 in `ssh_keys_total` are the project's permanent non-test keys.
