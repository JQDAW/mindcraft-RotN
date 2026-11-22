# G4 soak 10: `g4-soak-2h` on the CX23 service (2026-11-22)

**Label: the tenth soak, run under the lead's written GO `G4-SOAK-10-20261122`. It is never G4 acceptance evidence.**
- The run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. It FAILED: 7 checks passed and 2 failed (`agenda_done`: no `agenda done`; `ate_when_low`: 2 of 3 `low` lines with no eat after them).
- `result.json` marks it not-gate (`gateValid: false`) for two reasons:
  - the S-run reason from #436;
  - the step-7 runner's reasons: there is no `ROTN_G4_ACCEPT` marker, so conditions (a) and (d) fail. Conditions (b), (c) and (e) hold.
- **The first soak on rotn-v0.1.16:** bounded crafts and table pickup (soak 9's hang), and the collectBlock patch. The run went the full 120 min with no process restart and no agent exit (`no_crash` passed).
- **126 deaths, all between 15:51:30 and 16:49:16, all reported.**
  - The first death was a zombie digging into the night-1 shelter while the bot had no weapon.
  - The other 125 were a death loop around the spawn:
    - **Server causes (whole run):** 116 `slain by Zombie <bot>`, 7 `slain by Zombie`, 2 `drowned`, 1 `drowned whilst trying to escape Zombie <bot>`.
    - **Where:** the loop's deaths have the bounding box x -88..-38, z -87..-44 (observed extremes), and 82 of them lie inside the box x -50..-36, z -76..-50.
    - **The bot's own reflex line:** a player zombie "rises there and never leaves".
- **The loop ended with the day relocate.** At 16:50:41 the run's first `[respawn]` line started it, and 3 s later the bot was 51 blocks from the spawn (16:50:44). There was no death after that.
- **Night 2** was spent in a shelter that the walk to better ground reached (16:54:55). The bot repaired it four times and did not die.
- **The root cause is in progress with skills-rotn and rotn-data.** This README records only what the logs show.
- **Better Combat:** one line, `[forge-bridge] bettercombat attack: on`, and no self-check trip. The only melee hits were 14 swings with `hitwithaxe:bark` in hand (0.3 to 0.4 damage each), and no hostile mob was killed.
- **Cost:**
  - **Overall:** USD 0.0256/h.
  - **By the self-prompting windows (21.5 min):** USD 0.079/h.
  - **Reasoning:** 96% of the completion tokens.
  - **Memory summaries:** 28% of the completions and 43% of the spend.

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.16` = develop `453713d2`, a fresh detached checkout. `npm ci` ran first, with no other npm process on the CX33, then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. It started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-10-20261122:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-10-20261122`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, release `rotn-v0.1.16`, which the lead deployed through the gate. At 15:11 the lead reset FRCFLD's state through the gate (it archived `agenda.json` and `memory.json`). The human set the env `host` to this test server and confirmed it, with the file `root:root 600`. After the unit's systemd start (15:19:55), the journal shows: `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[release] rotn-v0.1.16-453713d21290` (the harness's commit); `[state] <bot> at start: tasks=absent agenda=absent memory=absent`; `[forge-bridge] bettercombat attack: on` |
| Test server | `mcr-test-20261122-151331`, a CPX42 in nbg1. Created 15:13:37, ready 15:18:34, deleted 17:20:48: 127 min, billed about 3 h, EUR 0.4143 plus the IPv4. The watchdog `delete-after` was 2026-11-22T19:13:37Z (TTL 4 h). Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 test SSH keys (`server-lifecycle.txt`) |
| Step-7 check | `test-server.sh starts` right after `up` (15:18:34): `starts=1 files=1` (`step7-starts.txt`) |
| World | The G2/G3/M1 seed `1880465901402976865`, fresh: `world 1715 of at most 7398 ticks` at the step-7 read |
| Server | Firewall: ports 22 and 25565 only from the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 9 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match; 0 extra mods |
| Timing | The scenario ran 15:19:47 to 17:20:23 UTC. **Each join time names its source:** the unit started at **15:19:55** (systemd, `driver.log`). The server logged `<bot> joined the game` at **15:20:06** (`server.log`). The journal shows `Self-prompting started.` at **15:20:09**. The runner's `login_online` passed at **15:20:13** (`run.log`). Next came 120 min of samples every 5 min (25 samples), then the runner's ctl stop. The unit was stopped at 17:20:20 (systemd: `654.3M memory peak`, 27 min 35 s of CPU). Afterwards `status frcfld`, read through the gate, showed `inactive (dead)` and `disabled`. The journal covers the whole soak (`journalCoverage`: 120.1 of 120.1 min) |

## The checks (`result.json`)
| Check | Result | Detail |
| --- | --- | --- |
| `login_online` | PASS | joined, a version-4 (Mojang account) UUID |
| `naming` | PASS | `[naming]`: 18 kinds, unknown 0, all real; entities: 1 kind (`zombieawareness:entityscent`), unknown 0 |
| `no_crash` | PASS | 120 min up, 25 samples, `NRestarts` 0 throughout, no agent exit |
| `peak_memory` | PASS | 654 MiB (target 850) |
| `usd_per_hour` | PASS | USD 0.025617/h: USD 0.05128 over 120 min, 108 completions (target 0.05) |
| `agenda_done` | **FAIL** | no `agenda done` within the soak: the agenda never got past `crafting_tools` and `weapon` (below) |
| `food_floor` | PASS | lowest food 10 (17:19:23), from 121 food lines |
| `ate_when_low` | **FAIL** | 2 of 3 `low` lines had no eat after them:<br>- 15:51:34 (food 12, `no safe food in the inventory`, just after the first death);<br>- 17:11:23 (food 12, `no safe food`, in the night-2 shelter).<br>The one at 17:03:32 was followed by `ate harvestcraft:turnipitem` (17:03:34) |
| `deaths_reported` | PASS | each of 126 deaths reported |

The survival notes show 2 eats, 5 fights, 215 flees and 121 food lines.

## The LLM spend and the reasoning tokens (per window)
The windows come from the journal: the night routine's `sunset is near` lines and the `[respawn]` relocate. The memory summary logged at 15:37:43 (`driver.log:986`) comes before `self prompt loop stopped` and `[night] sunset is near` (`driver.log:991`–`992`), so it counts in day 1.
- All 108 completions were answered by provider `Wafer`.
- **The rule for a memory summary:** a call whose prompt is under 2,000 tokens. All 30 are also the call right before a `Memory updated to:` line.

| Window | Min | Completions | USD | USD/h | Completion tokens | Reasoning tokens | Memory summaries (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Day 1: join to `sunset is near` (15:20:08–15:37:43, up to `driver.log:991`); the self-prompting window | 17.6 | 57 | 0.023157 | 0.079 | 84,273 | 81,116 | 14 (0.009471) |
| Sunset 1 to the relocate (15:37:43 from `driver.log:992`, to 16:50:41): night 1, morning and the death loop; no self-prompting | 73.0 | 41 | 0.022343 | 0.018 | 86,542 | 83,405 | 13 (0.010014) |
| The relocate to `sunset is near` (16:50:41–16:54:39); the self-prompting window from 16:50:44 | 4.0 | 9 | 0.005168 | 0.078 | 19,963 | 19,412 | 2 (0.001756) |
| Night 2 (16:54:39–17:20:20) | 25.7 | 1 | 0.000611 | – | 3,024 | 2,858 | 1 (0.000611) |
| **The run** | **120.1** | **108** | **0.051280** | **0.0256** | **193,802** | **186,791 (96%)** | **30 (0.021853, 43%)** |

- **The self-prompting windows:** 21.5 min, 66 completions, USD 0.028325 (0.079/h). The memory summaries made in them are side calls, not self-prompts.
- **The death-loop window's 41 calls** were the replies to reflex re-plan prompts (`Reflexes (death) interrupted …`) and their memory summaries. The self-prompter was off from 15:37:43 to 16:50:44.
- **Prompt tokens:** 372,095 in all.
- **The largest call by total tokens:** 16:15:20, 5,489 prompt and 13,176 completion tokens (12,984 reasoning).
- **The largest completion, also the most expensive call:** a memory summary at 15:37:43 (`driver.log:986`, the last call of day 1), 765 prompt and 17,362 completion tokens (17,197 reasoning), USD 0.003227 (6.3% of the run's spend).
- **Empty replies:** three completions had no content (15:28:14, 15:30:13, 16:46:58). For example: `content null chars`, `reasoning_tokens 4546` of 4,546 completion tokens, then `Empty content returned (model @preset/glm-5-3-flash-cheap-reliable, finish_reason stop)` and `No response received.`

## What happened
### Day 1 (15:20–15:37)
- **Agenda steps done:** rocks (15:21:41), sticks (15:22:28), crude_axe (15:22:35), logs (15:23:32) and first_plank (15:27:04).
  - The shelter_blocks step reported `80 piles total now` (15:24:25).
  - The bot crafted a second crude axe at 15:24:35–15:24:40 (`weapon secured for the night`).
- **Food:** no animal was found within 128 blocks (15:24:52–15:25:40). Foraging gave crops.
- **First plank:**
  - `!placeHere("log")` failed once and then worked (see `!placeHere` below).
  - In between, the LLM asked for `!newAction(…)` (15:26:35) and got `newAction is disabled. Enable with allow_insecure_coding=true in settings.js` (server.log chat, `server.log:1167`), so `allow_insecure_coding=false` held.
  - The bot then debarked the log twice with `!useOn("pyrotech:crude_axe", …)` (15:26:52, 15:27:01).
- **The weapon step started again at 15:29:36.** The chat at 15:31:49 says `Need 2 sticks for the reserve crude axe but only hold 1`. Then `agenda step weapon stuck: 5 min of self-prompting; going on without it until the night` (15:34:23, server.log chat, `server.log:1274`).
- `crafting_tools` started at 15:27:04 and again at 15:34:25, and was not done by sunset.

### Night 1 and the death loop (15:37–16:50)
- **The shelter:** `[night] sunset is near: building a shelter` (15:37:43). The bot was `in the shelter at 11, 85, -153 until morning` (15:37:49), with `food worth 15 hunger held`.
- **The first death** (`driver.log:1012`–`1103`):
  - 15:51:04: `zombie is digging the shelter at 11, 85, -152`, then `no weapon, health 20, and no way to back away from a zombie in reach …: hitting back by hand`.
  - 15:51:05: `the repair placed nothing (… you have 0 dirt and 0 dirt piles …)`.
  - 15:51:09: `no weapon and a zombie in the opening …: not repairing under it`.
  - 15:51:22–15:51:33: 14 `[survival] swing zombie with hitwithaxe:bark` lines (the zombie's health 20 → 15.5).
  - 15:51:30: `slain by Zombie`.
  - The bot lost its inventory there (`lost 40 log:1, 10 rustic:ginseng, 4 betterwithmods:dirt_pile, …`).
- **The loop** (15:52:01, `driver.log:1138`, to the last death at 16:49:16, `driver.log:5372`):
  - **Deaths:** 125 more, two or three a minute. 116 `slain by Zombie <bot>` (`zombie_players:zombie_player` in the journal), 6 more `slain by Zombie`, and 3 drownings, the last at 16:49:16 `whilst trying to escape Zombie <bot>`.
  - **The reflexes:** the cowardice reflex logged 215 flees (`Backing off: zombie players:zombie_player (a player zombie, and no weapon or health at half or less)`, 51 times in chat).
  - **The night routine's walk away from recent death spots:** for example, `moving to the first spot at least 24 blocks from 9 recent death spots` (15:56:03). It was `interrupted at 2–7 blocks` every time it was logged.
  - **Food:** after the first death, every night-routine pass logged `food worth 0 hunger held, food 12`.
- **What the LLM tried** (replies to reflex re-plan prompts):
  - `!moveAway(25)` (16:00:37) and `!moveAway(60)` (16:02:36);
  - `!consume("lifescroll:spawnscroll")` five times (16:03:28, 16:05:11, 16:08:28, 16:10:35, 16:40:34). The bot's own note at 16:42:08: `Scroll fired but spawn is here — no escape that way`;
  - `!moveAway(250)` (16:42:08) and `!moveAway(500)` (16:48:33);
  - `!digDown(5)` (16:50:25). It was interrupted by the cowardice reflex (`Code execution triggered catch: Error: Digging aborted`, with a stack trace through `bot.stopDigging` and `Agent.requestInterrupt`).
- **Other journal lines in the loop:**
  - four `Code execution triggered catch: Error: Promise timed out.` (16:03:32, 16:08:31, 16:10:39, 16:40:37);
  - `- Weather: Thunderstorm` in a `!stats` reply at 16:12:59;
  - a night-routine `it is night: building a shelter` at 16:22:01. The LLM had said `morning` at 16:00:37.
- **The escape** (`driver.log:5463`–`5465`). These are the run's only two `[respawn]` lines; the relocate runs only in full day:
  - 16:50:41: `[respawn] after a death: moving at least 48 blocks from the spawn and 20 recent death spots, towards 8, -80, before the agenda resumes`.
  - 16:50:44: `[respawn] now 51 blocks from the spawn and 20 recent death spots at 4, 79, -80; the agenda resumes`.
  - Just before it, the cowardice reflex had logged `Moved 32 away from enemies.` several times (16:49:39–16:50:41). Self-prompting restarted at 16:50:44.

### Day 2 after the relocate, and night 2 (16:50–17:20)
- **Day 2:**
  - The agenda's food step and shelter_blocks step restarted (16:50:44–16:52:46).
  - `ate harvestcraft:scallionitem` (16:51:13).
  - `!moveAway(30)` (16:54:08).
- **Night 2:**
  - `sunset is near` at 16:54:39, with `food worth 1 hunger held, food 13`.
  - No shelter or hole fit at 27, 63, -101 (`space not free 200, no firm floor 123, water in the space 72`).
  - `the walk to better ground got there; sheltering from 27, 68, -99` (16:54:55) and `in the shelter at 27, 68, -99 until morning` (16:55:00).
  - The shelter was opened and repaired four times (16:56:22, 16:57:03, 16:58:34, 17:00:06), each time `the repair closed the shelter`.
  - The night routine's `morning:` line came at 17:20:07: `a spider at 30, 68, -99 is within 8 blocks of the shelter …; staying in until it leaves`.
  - The runner stopped the unit at 17:20:20.

## The lines the lead asked for
- **`[craft]`:** 10 lines, all `bot.craft returned after N ms`: 452, 327, 4527, 421, 881, 2326, 1216, 414, 410 and 367 ms (15:22:33 to 16:58:36).
  - No `abandoned craft` line (settled or not), no `timed out` or stopped line (`[craft] <ended> after … (limit …)`), and no `[craft] picking the crafting table up again` or table-pickup line.
- **collectBlock pickup or cancel timeouts:** none in the journal.
  - The patch (`patches/mineflayer-collectblock+1.6.0.patch`) records each pickup end in `bot.collectBlock.lastPickup` and the `collectBlock_pickupEnded` event. Nothing in this release logs them, so the journal cannot show one.
  - The journal has 224 `MaxListenersExceededWarning` lines: 112 for `11 diggingAborted listeners` and 112 for `11 diggingCompleted listeners`. That is a different listener from soak 9's `collectBlock_finished`.
- **Escape lines (`[escape] …`, `[reflex] unstuck: the escape …`):** none. Instead, the unstuck reflex logged `still stuck after 10 s; re-planning instead of a restart` 9 times: 15:54:55, 15:57:29, 15:59:53, 16:24:03, 16:24:55, 16:34:35, 16:46:41, 16:47:33 and 16:49:49.
- **Walk to better ground:** one, at 16:54:55 (`driver.log:5647`), above.
- **Ore skips for a liquid:** none.
- **`!placeHere`:** two, both `!placeHere("log")` during the first-plank step:
  - 15:26:30, result line 15:26:33 (`driver.log:662`): `Could not place log at -3, 84, -153: you are in that cell, and the jump-and-place did not take (still at -3, 84, -153).`
  - 15:26:47, after `!moveAway(2)`, result line 15:26:48 (`driver.log:713`): `Placed log at -1, 85, -152 by jumping and putting it under you: you now stand on it at -1, 86, -152.`
- **Fights with hostile mobs:** 5, all with the zombie at the night-1 shelter (15:51:05–15:51:33).
  - 3 `stopped` after 3 s each, 1 `interrupted` after 9 s, and 1 `died` (the bot) after 3 s.
  - **Kills:** none.
  - In the loop, the bot fled and never fought.
- **`[forge-bridge] bettercombat`:** one line, `bettercombat attack: on`. No `hits without a hurt` trip.
- **Parasites:** none.
- **Zombie Awareness:** one scent marker, `[naming] <bot> entities +240s: 1 kinds; unknown 0; zombieawareness:entityscent:1` (15:24:08).
- **Process restarts:** none. The journal's only `Agent process exited` line is the stop at 17:20:20 (code 0).

## Server-side notes (not about the bot)
- **15:24:32:** `server.log` has a `---- Minecraft Crash Report ----` for `Ticking entity`, a `java.util.ConcurrentModificationException` in an `animania:hedgehog` at 8.53, 66.00, 118.52. The server went on logging normally the same second.
- **Universal Tweaks:** 4 `Failed to save chunk` NullPointerExceptions (15:32:42, 15:34:11, 16:38:43, 17:16:59).
- **Lag:** 4 `Can't keep up!` lines, the largest `Running 2648ms behind, skipping 52 tick(s)` (15:24:34).
- **Summons:** 7 `Object successfully summoned` lines: 6 from `[Skeleton: …]` and 1 from `[Skeleton Warrior: …]` (`server.log:1626`, 16:31:32). As in soak 8, these are pack command senders, not the bot.

## Step 7 (harness-ops)
- `starts=1` after `up`.
- The world was fresh: 1715 ticks at the read, against at most 7398.
- The release was read from the journal's `[release]` line.
- Only (a) and (d) fail, as for every soak.

## For the owners (not judged here)
**The root-cause analysis is in progress with skills-rotn and rotn-data.** This section only points at the lines above:
- the night-1 shelter breach with no weapon and no blocks for the repair;
- the death loop around the spawn: 125 deaths in 58 min, with the walk away from death spots interrupted each time;
- the day relocate, the first `[respawn]` line, at 16:50:41;
- the weapon and crafting_tools steps, which were not done by sunset 1.

## Soak 9 corrections (the #568 review)
These are folded into `../g4soak-9-20261122/README.md` by this PR:
1. It now says the rule for counting a memory summary: a prompt under 2,000 tokens. That gives the same 21 calls.
2. "The largest call" is now "the largest call by total tokens" (11:58:47). The README also names the largest completion, which was also the most expensive call: 12:00:37, 2,603 completion tokens, USD 0.0013647.
3. "Made in daylight while self-prompting" is now "during the self-prompting window", because the memory summaries are side calls.
4. The `!placeHere` now cites its result line time (11:57:10, `driver.log:630`).

## Files
Each file was made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean.
- `result.json`: the runner's result, with the checks, `notes.samples`, `notes.llmUsage`, `notes.survival`, `notes.deaths` and `g4Acceptance`.
- `run.log`: the runner's stdout (`run-stdout.log` in the raw folder).
- `server.log`: the test server's log for the run, as the runner fetched it (`latest.log`).
- `driver.log`: the CX23 journal of `mindcraft-rotn@frcfld` from the unit's start to its stop, read through the gate.
- `step7-starts.txt`: `test-server.sh starts` right after `up`, under a header line naming the command, the time and the server.
- `server-lifecycle.txt` contains:
  - the `test-server.sh up` log and `starts`;
  - the header of the since-start log fetched before `down` (`found=1 lines=22166`); the run's part of it is the same as `server.log`;
  - the `test-server.sh down` log, ending `verified gone: server, Primary IPv4 and SSH key`;
  - the hcloud counts saved at the delete: `servers 0`, `primary_ips 0`, `ssh_keys_mcr_test 0` at 17:20:48Z. The 2 in `ssh_keys_total` are the project's permanent non-test keys.
