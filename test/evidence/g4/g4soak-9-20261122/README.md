# G4 soak 9: `g4-soak-2h` on the CX23 service (2026-11-22), ended at minute 15

**Label: the ninth soak, run under the lead's written GO `G4-SOAK-9-20261122`. It is never G4 acceptance evidence.**
- The run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. It FAILED after 15 minutes: 7 checks passed and 2 failed (`no_crash`, `usd_per_hour`).
- `result.json` marks it not-gate (`gateValid: false`) for two reasons:
  - the S-run reason from #436;
  - the step-7 runner's reasons: there is no `ROTN_G4_ACCEPT` marker, so conditions (a) and (d) fail. Conditions (b), (c) and (e) hold.
- **Why it ended:**
  - A `!craftRecipe("stone_pickaxe", 1)` started at 12:01:22 and never returned.
  - At 12:01:50 the `unstuck` mode tried to interrupt it. The action did not stop within `ActionManager.stop()`'s 10 s, so Mindcraft's `cleanKill` ended the agent process with exit 1 at 12:02:00.
  - `agent_process` restarted it in-process and the bot was back in the game at 12:02:07.
  - The soak's rule is that a lost connection ends the watch, even after an in-process restart (the lead kept that rule). The runner saw the server's `lost connection` line at the minute-15 sample and stopped the unit at 12:06:31.
- **The cause is in review with skills-rotn and net-forge.** This README records only what the logs show.
- **No death and no damage:** health was 20 at every food line, and food never fell below 20.
- **The agenda was done at 12:05:01**, 13.9 min after the join and across the restart.
- **Cost:** USD 0.1395/h over 15 min, all daytime agenda work. Reasoning tokens were 85% of completion tokens.

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | Tag `rotn-v0.1.15` = develop `c62e3155`, a fresh detached checkout. `npm ci` ran first, then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. It started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-9-20261122:frcfld:test-server-host-confirmed`. In `result.json`, `service.goId` is `G4-SOAK-9-20261122`, with no start error, incident or unknown state |
| The bot | The CX23 unit `mindcraft-rotn@frcfld`, release `rotn-v0.1.15`, which the lead deployed through the gate. At 11:37 the lead reset FRCFLD's state through the gate (it archived `agenda.json` and `memory.json`). The human confirmed that the env `host` named this test server and that the file is `root:root 600`. After the unit's systemd start (11:50:57), the journal shows: `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[release] rotn-v0.1.15-c62e3155c8d6` (the harness's commit); `[state] <bot> at start: tasks=absent agenda=absent memory=absent`; `[forge-bridge] bettercombat attack: on` (11:51:08) |
| Test server | `mcr-test-20261122-113937`, a CPX42 in nbg1. Created 11:39:43, ready 11:42:37, deleted 12:07:12: 27 min, billed about 1 h, EUR 0.1381 plus the IPv4. The watchdog `delete-after` was 2026-11-22T15:39:43Z (TTL 4 h). Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 test SSH keys (`server-lifecycle.txt`) |
| Step-7 check | `test-server.sh starts` right after `up` (11:42:41): `starts=1 files=1` (`step7-starts.txt`) |
| World | The G2/G3/M1 seed `1880465901402976865`, fresh: `world 10024 of at most 13328 ticks` at the step-7 read |
| Server | Firewall: ports 22 and 25565 only from the CX23 and the dev server. Online mode. Whitelist `<bot>,JQDAW` (the script's default). The same `up` flags as soaks 3 to 8 |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match; 0 extra mods |
| Timing | The scenario ran 11:50:50 to 12:06:34 UTC. **Each join time names its source:** the unit started at **11:50:57** (systemd, `driver.log`). The server logged `<bot> joined the game` at **11:51:07** (`server.log`). The journal shows `Self-prompting started.` at **11:51:10**. The runner's `login_online` passed at **11:51:13** (`run.log`). After 4 samples, the minute-15 sample found the bot gone (see below) and the runner's ctl stop followed. The unit was stopped at 12:06:32 (systemd: `473.6M memory peak`, 3 min 55 s of CPU). The bot was inactive and disabled afterwards. The journal covers the whole run (`journalCoverage`: 15.3 of 15.3 min) |

## The checks (`result.json`)
| Check | Result | Detail |
| --- | --- | --- |
| `login_online` | PASS | joined, a version-4 (Mojang account) UUID |
| `naming` | PASS | `[naming]`: 17 kinds, unknown 0, all real; no entity near at +240 s |
| `no_crash` | **FAIL** | `gone at minute 15: lost (Internal Exception: …NativeIoException: syscall:read(..) failed: Connection reset by peer)`; 2 agent restart or exit lines, the first `Agent process exited with code 1 and signal null` |
| `peak_memory` | PASS | 474 MiB (target 850). systemd's `NRestarts` stayed 0: the restart was inside `agent_process`, not the unit |
| `usd_per_hour` | **FAIL** | USD 0.139529/h: USD 0.035526 over 15 min, 82 completions (target 0.05) |
| `agenda_done` | PASS | `agenda done` at 12:05:01 |
| `food_floor` | PASS | lowest food 20, from 16 food lines |
| `ate_when_low` | PASS | food was never low |
| `deaths_reported` | PASS | no death |

The survival notes show 0 reflex fights, 0 flees and 0 eats.

## The LLM spend and the reasoning tokens
All 82 completions were made during the self-prompting window (11:51:12 to 12:05:19), in daylight; the memory summaries among them are side calls, not self-prompts. Sunset came at 12:06:29, two seconds before the stop. Every completion was answered by provider `Near AI`.

| Window | Completions | USD | Completion tokens | Reasoning tokens |
| --- | --- | --- | --- | --- |
| First process (11:51:09 to 12:02:00) | 65 | 0.027079 | 22,432 | 18,988 (85%) |
| After the restart (12:02:07 to 12:06:32) | 17 | 0.008446 | 8,559 | 7,417 (87%) |
| **The run** | **82** | **0.035526** | **30,991** | **26,405 (85%)** |

- Prompt tokens were 273,662 in all.
- **Memory summaries:** 21 calls, USD 0.011127 (31% of the spend). A call counts as a memory summary when its prompt is under 2,000 tokens. Each of the 21 is also the call right before a `Memory updated to:` line.
- **The largest call by total tokens:** 4,556 prompt and 839 completion tokens (782 reasoning) at 11:58:47.
- **The largest completion, also the most expensive call:** 12:00:37, 790 prompt and 2,603 completion tokens, USD 0.0013647.
- The rate is not comparable to the soak 8 overall figure (0.0437/h), which included 76 min of nights with almost no calls. Soak 8's daytime rate was 0.117/h and its self-prompting rate 0.131/h.

## The craft hang and the restart (timeline)
Taken from `driver.log` (the CX23 journal) and `server-since-start-1201-1202.txt`. `node[215649]` is the agent process and `node[215575]` is `agent_process`, its parent.

| Time | Source | Line |
| --- | --- | --- |
| 12:00:56 | `server.log` | `agenda step stone_pickaxe started: craft a stone pickaxe` |
| 12:01:22 | `driver.log:1097` | `parsed command: { commandName: '!craftRecipe', args: [ 'stone_pickaxe', 1 ] }`, then `executing code...` |
| 12:01:24 | `driver.log:1099` | `crafting...` |
| 12:01:26 | `server.log` | `agenda step stone_pickaxe done`, then `agenda step shelter_blocks started: keep 10 blocks for the night's shelter`. The agenda saw the pickaxe in the inventory, but the craft action had not returned. No `Agent executed: !craftRecipe` result line follows |
| 12:01:26–12:01:50 | `driver.log` | nothing from the agent process |
| 12:01:50 | `driver.log:1100`–`1101` | `executing code...` and `action "mode:unstuck" trying to interrupt current action "action:craftRecipe"`. Chat: `I'm stuck!` |
| 12:01:50–12:02:00 | `driver.log:1102`–`1138` | 34 `waiting for code to finish executing...` lines, about 3 a second (the 300 ms loop in `ActionManager.stop()`; each turn calls `requestInterrupt()`, which also calls `collectBlock.cancelTask()`) |
| 12:01:51 | `driver.log:1109` | `(node:215649) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 error listeners added to [EventEmitter]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit` |
| 12:01:53 | `driver.log:1115` | `(node:215649) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 collectBlock_finished listeners added to [EventEmitter]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit` |
| 12:02:00 | `driver.log:1139` | `Saved memory to: ./bots/<bot>/memory.json` (from `cleanKill`). Chat: `Exiting.` (`cleanKill`'s chat for code 1; its message `Code execution refused stop after 10 seconds. Killing process.` goes to the history, not the journal) |
| 12:02:00 | `driver.log:1140`–`1142` | `Agent <bot> disconnected`; `Agent process exited with code 1 and signal null`; `[agent_process] <bot>: requested_restart; restarting in 0 s.` |
| 12:02:00 | `server-since-start-1201-1202.txt` | `<bot> lost connection: Internal Exception: io.netty.channel.unix.Errors$NativeIoException: syscall:read(..) failed: Connection reset by peer`, then `<bot> left the game` |
| 12:02:07 | `server.log` | `<bot> joined the game` (the restarted process) |
| 12:02:13 | `server.log` | `agenda step shelter_blocks started: … (resumed after a restart)` |
| 12:06:30 | `run.log` | the minute-15 sample: `no_crash` failed with `gone at minute 15` |
| 12:06:31 | `driver.log:1457`–`1458` | `Stopping mindcraft-rotn@frcfld.service`; `[agent_process] SIGTERM: stopping 1 agent(s), exiting within 5 s.` |
| 12:06:32 | `driver.log:1460`–`1467` | `[forge-bridge] SIGTERM: quitting the server connection`; `Agent process exited with code 0`; `stopped (stop requested (single-bot service))`; `Deactivated successfully`; `473.6M memory peak` |

**What the server log shows between 12:01:22 and 12:02:00** (`server-since-start-1201-1202.txt`, every line from 12:01:20 to 12:02:01 of the since-start log, fetched before `down`):
- Only the bot's own chat lines: the `!craftRecipe` line, the two agenda lines, `I'm stuck!` and `Exiting.`
- No window or container line, no kick and no exception before 12:02:00.
- The first exception is the `Connection reset by peer` at 12:02:00, the same second as `Exiting.`, when the process exited.

**The cause is in review with skills-rotn (the craft action and the `unstuck` mode) and net-forge (the connection and the agent process).** Nothing here was judged beyond the lines above.

## `!placeHere`
- One `!placeHere`, at 11:57:09: `!placeHere("log")`, during the first-plank step. The result line at 11:57:10 (`driver.log:630`) was `Placed log at -26, 79, -93 by jumping and putting it under you: you now stand on it at -26, 80, -93.` This is #564's jump-place.
- **No escape lines.** The run had none, nor any walk-to-better-ground line or ore skip for liquid. The bot was never in water or stuck in a pit in these 15 minutes. The only `stuck` is the `unstuck` mode at 12:01:50 above.

## Better Combat and mobs
- **`[forge-bridge] bettercombat`:** two lines, both `bettercombat attack: on`, one per process start (11:51:08, 12:02:09). There was no self-check trip.
- **Fights with hostile mobs:** none.
- **Parasites:** none seen.
- **Zombie Awareness:** one scent marker, `[naming] <bot> entities +120s: 1 kinds; unknown 0; zombieawareness:entityscent:1` (12:04:11).

## After the restart
- The restarted agent resumed the agenda, made 10 cobble and a stone axe, and logged `agenda done` at 12:05:01. The standing goal started at 12:05:04.
- At 12:05:11 the LLM chose `!moveAway(40)`. It found a `destructive path (after a longer search)` and ended at -35, 26, -92 at 12:06:27, 40 blocks down from y 66.
- At 12:06:29 came `[night] sunset is near: building a shelter` (food worth 15 held, food 20). At 12:06:32 came `[night] in the shelter at -32, 26, -91 until morning`, in the same second as the stop.

## Step 7 (harness-ops)
- `starts=1` after `up`.
- The world was fresh: 10024 ticks at the read, against at most 13328.
- The release was read from the journal's `[release]` line.
- Only (a) and (d) fail, as for every soak.

## Files
Each file was made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean.
- `result.json`: the runner's result, with the checks, `notes.samples`, `notes.llmUsage`, `notes.survival`, `notes.deaths` and `g4Acceptance`.
- `run.log`: the runner's stdout (`run-stdout.log` in the raw folder).
- `server.log`: the test server's log for the run, as the runner fetched it.
- `driver.log`: the CX23 journal of `mindcraft-rotn@frcfld` from the unit's start to its stop, read through the gate.
- `server-since-start-1201-1202.txt`: every line from 12:01:20 to 12:02:01 of `test-server.sh log 200000 since-start` (fetched before `down`), under its header line.
- `step7-starts.txt`: `test-server.sh starts` right after `up`, under a header line naming the command, the time and the server.
- `server-lifecycle.txt`: the `test-server.sh up` log, `starts`, the `test-server.sh down` log (ending `verified gone: server, Primary IPv4 and SSH key`), and the hcloud counts saved at the delete (`servers 0`, `primary_ips 0`, `ssh_keys_mcr_test 0` at 12:07:12Z; `ssh_keys_total 2` are the project's permanent non-test keys).
