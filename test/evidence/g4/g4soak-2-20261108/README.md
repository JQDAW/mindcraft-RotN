# G4 soak 2: `g4-soak-2h` on the CX23 service (2026-11-08/09)

**Label: the second soak, under the lead's written GO `G4-SOAK-2-20261108`. It is never G4 acceptance evidence.**
- This run used the ADR 0010 targets (850 MiB, USD 0.05/h), so it could pass. It FAILED: 6 checks passed and 3 failed.
- `result.json` marks it not-gate (`gateValid: false`) with the runner's standing reason for every G4 run: "a G4 scenario on a test server is a rehearsal: G4 evidence comes only from the CX23 service". The wording reads oddly for an S run. Every G4 run stays not-gate until the step-7 runner.
- G4 evidence comes only from the step-7 runs, under their own rules (test/scenarios/g4/PLAN.md).

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | tag `rotn-v0.1.4` = develop `f6107fc4`, a fresh detached checkout. `npm ci` ran first (every patch applied), then `run.mjs --list`. Command: `run.mjs --scenario g4-soak-2h --service frcfld`. The run started once and was not retried |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-2-20261108:frcfld:test-server-host-confirmed`. `result.json`: `service.goId` is `G4-SOAK-2-20261108`, with no start error, no incident and no unknown state |
| The bot | the CX23 unit `mindcraft-rotn@frcfld` on release `rotn-v0.1.4-f6107fc4b3b6` (from the journal's paths), the same commit as the harness. The human deployed it, reset FRCFLD's state (only action-code, histories and `last_profile.json` remained) and confirmed the env `host` was this test server. Its start lines say: `[settings] effective allow_insecure_coding=false`; `task_givers=["JQDAW"] allow_server_task_giver=false`; `[state] <bot> at start: tasks=absent agenda=absent memory=absent` |
| Test server | `mcr-test-20261108-223149`, CPX42 nbg1. Created 22:31:56, ready 22:36:53, deleted 00:39:40 (ran 127 min, billed about 3 h: EUR 0.4143 plus the IPv4). Watchdog `delete-after` was 2026-11-09T02:31:56Z (TTL 4 h). Afterwards: 0 servers, 0 Primary IPs and 0 labelled keys, counted with `grep -c .` |
| World | the G2/G3/M1 seed `1880465901402976865` (console `seed`), fresh |
| Server | firewall 22 and 25565 only from the CX23 and the dev server; online mode; whitelist `<bot>,JQDAW` |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match |
| Timing | The scenario ran 22:38:29 to 00:39:05 UTC. The bot joined at 22:38:53, then 120 min of samples every 5 min (25 samples), then the runner's ctl stop. Afterwards the unit was `inactive` with `NRestarts=0` (`metrics frcfld`, read through the gate) |
| Midnight | The run crossed 00:00 UTC. The server log rolled over, and the runner saved `server.log` from `2026-11-08-1.log.gz` + `latest.log` (`notes.evidenceLogFiles`, `notes.logWindow`). The journal covers the whole run: 120.1 of 120.1 min |

## The measurements
| Measure | Value |
| --- | --- |
| **Peak memory** | **622 MiB** (`MemoryPeak`; `MemoryCurrent` peaked at 619 MiB), target 850. It rose from 372 MiB at the join to 527 by minute 15, to about 590 by minute 55 and to about 615 by minute 71. It dipped to 556 at minute 86, then stayed at 610–616 to the end (`notes.samples`). M1: 634 MiB |
| **NRestarts** | **0** at all 25 samples; `ActiveState` active at every sample |
| **LLM spend** | **USD 0.012869 per hour**, target 0.05: USD 0.025763 over 120 min, the sum of `cost_usd` over 205 `[openrouter] usage …` lines, 0 unknown (about 103 completions per hour). M1: USD 0.011576/h |

## The checks (`result.json`)
| Check | Result |
| --- | --- |
| `login_online` | PASS: joined at 22:38:53, version-4 UUID |
| `naming` (#2) | PASS: `[naming] <bot> near spawn: 22 kinds; unknown 0`, all real names; no entity near (+240 s) |
| `no_crash` (#7) | PASS: 120 min up, 25 samples, NRestarts 0 throughout, no agent exit |
| `peak_memory` (#7) | PASS: 622 MiB (target 850) |
| `usd_per_hour` (#7) | PASS: USD 0.012869/h (target 0.05) |
| `agenda_done` (#4) | **FAIL**: no `agenda done` within the soak (below) |
| `food_floor` (#5) | **FAIL**: lowest food 1 (floor 6), over 126 food lines |
| `ate_when_low` (#5) | **FAIL**: 2 of 9 `low` food lines had no eat after them |
| `deaths_reported` (#5, as #6) | PASS: each of **5** deaths reported |

## What happened (the bot's own `[survival]`, `[night]`, `[death]` and `[respawn]` lines, `driver.log`; death causes from `server.log`)
- **The agenda.** These steps were done by 23:23: rocks, sticks, crude_axe, logs, first_plank, crafting_tools, crafting_table, planks_sticks, stone_pickaxe and cobblestone. Step 10 of 11 (`stone_axe`) was still open at the end; the self-prompter switched between it, `food` and `shelter_blocks`. `mode:hunting` appears 51 times, and the memory says "Hunting sow_large_white kept failing: got stuck". For comparison, M1 (rotn-v0.1.3, same seed) finished its agenda in 8.5 min. Here the death at 22:48 cost the first kit, and the 23:32 death cost the second.
- **Counts:** 12 eats (all at food 12 or below, mostly harvestcraft crops; bread once), 2 fights (slime and zombie, both `interrupted`), 19 flees, 126 food lines.
- **First night: no death.** At 22:53:20 the bot was `in the shelter at 8, 66, -43 until morning`. At dawn a `primitivemobs:skeleton_warrior` stood within 8 blocks, and then there was `no safe side of the shelter … to open` (3 tries). From 23:22:48 the bot was `back to work, still enclosed: dig a way out`.
- **5 deaths, all reported:**
  - **22:48:12, gored to death** (server). It came after `fight start slime` then `flee slime (low health 2)`. It lost its whole first kit (68 dirt piles, 38 logs, 13 sticks, …).
  - **23:32:09, starved to death** (server), at `food 1 health 20` (23:31:35). Food fell 8 → 6 → 2 → 1 over 23:23–23:31 (two eats of 1 hunger each). There was no `low` line below 12; lower values were logged as `check`. It lost the second kit, including the 10 shelter cobblestone, the crafting table and the stone pickaxe.
  - **23:48:00, shot by Skeleton** on the second night, after `shelter try 1 of 3 failed (found no place to dig a hole shelter)`.
  - **00:03:06, starved to death** (server), at `food 1 health 20` (00:02:36). Food went 9 → 7 → 5 → 3 → 1 between 23:58 and 00:02, with no eat and no `low` line.
  - **00:19:51, slain by Zombie** on the third evening (`fight start zombie`, `flee zombie (low health 2)`).
- **Starvation.** On this pack the bot died at food 1 with full health, both times within about 35 s. Neither death came from slow starvation damage.
- **Second and third nights: no shelter.** After the 23:32 death it held 0 dirt and 0 dirt piles, so each try said `a dirt shelter needs N dirt (… piles)`. The fallback hole shelter (`digPit`) was **interrupted 71 times** (23:33–00:19), each time by `mode:unstuck` ("I'm stuck!" → `trying to interrupt current action "action:digPit"`). Then came `no shelter after 3 tries and a hole shelter` (23:52:07, 00:21:29).
- **The respawn move** worked after the first and fourth deaths (48–49 blocks away). After the second it `got only 5 blocks`.

## For the owners (not judged here)
- **skills-rotn: starving at food 1 kills on this pack.** Food fell from 9 to 1 in 4 to 5 minutes with no `low` line (`low` fires only at 12), and the bot died with full health. `food_floor` and `ate_when_low` failed as in M1, and this run shows the cost: 2 of 5 deaths were starvation.
- **skills-rotn: `mode:unstuck` interrupts the hole-shelter dig** (`action:digPit`, 71 times over two nights), so the fallback shelter never finishes.
- **skills-rotn: the agenda stalled at `stone_axe`** after the 23:32 death took the kit; it alternated with food and hunting (stuck while hunting).
- **skills-rotn: the dawn exit.** "No safe side to open" (3 tries) while a skeleton warrior stood nearby; it then left by digging. This is not a failure here, but the same line was noted in G3 B.
- **The lead:** the memory and cost targets (ADR 0010) pass with a wide margin in both soaks: 622 and 634 MiB against 850, USD 0.0129 and 0.0116/h against 0.05.

## Files (each made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean)
- `result.json`: the runner's result, with every sample.
- `run.log`: the scenario's own lines (the runner's stdout).
- `server.log`: the server log from the scenario's begin marker (over the 00:00 roll-over).
- `driver.log`: the unit's journal from its start line (`[settings]`, `[state]`, `[naming]`, `[survival]`, `[night]`, `[death]`, `[respawn]`, `[openrouter] usage …`).
