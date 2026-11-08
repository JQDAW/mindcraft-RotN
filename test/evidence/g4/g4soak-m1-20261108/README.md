# G4 measuring soak M1: `g4-soak-2h` on the CX23 service (2026-11-08)

**Label: a MEASURING run under the lead's written GO `G4-SOAK-M1-20261108`, never G4 acceptance evidence.**
- The soak ADR's targets (`peakMemoryMaxMb`, `usdPerHourMax`) are still TBD, so the runner marks it not-gate: "a measuring run, not an acceptance run".
- G4 evidence comes only from the step-7 runs under their own rules (test/scenarios/g4/PLAN.md).

Every address is redacted (`<ip>`): the CX23's, the dev server's and the test server's.

## Set-up
| | |
| --- | --- |
| Harness | develop `94dbd986`, a clean detached checkout with `npm ci` (all patches applied); `run.mjs --scenario g4-soak-2h --service frcfld` |
| GO marker | `ROTN_SERVICE_GO=G4-SOAK-M1-20261108:frcfld:test-server-host-confirmed` (the per-bot form, #401). `result.json`: `service.goId` `G4-SOAK-M1-20261108`, with no start error, no incident and no unknown state |
| The bot | the CX23 unit `mindcraft-rotn@frcfld`, on release `rotn-v0.1.3-94dbd9867bf7` (from the journal's paths), the same commit as the harness. The human reset its state first (`agenda.json` and `memory.json` moved aside) and confirmed the env `host` was this test server |
| Test server | `mcr-test-20261108-160235`, CPX42 nbg1. Created 16:02:34, `Done (20.371s)!` 16:05:33, deleted 18:25:17 (ran 142 min, billed about 3 h: EUR 0.4143 plus the IPv4). Watchdog `delete-after` 20:02:38Z (TTL 4 h). Afterwards 0 servers, 0 Primary IPs and 0 labelled keys, counted with `grep -c .` |
| World | the G2/G3 seed `1880465901402976865` (console `seed`), fresh |
| Server | firewall 22 and 25565 only from the CX23 and the dev server; online mode; whitelist `<bot>,JQDAW` |
| Pack | RotN 3.3.4 zip, SHA-256 `90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205`. Mod Director: `esmtweaks-1.12.2-0.4.5.jar` `b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933` OK; 337 zip jars match |
| Timing | the scenario 16:24:13 to 18:24:40 UTC: the join at 16:24:31, then 120 min of samples every 5 min (25), then the runner's ctl stop. The unit was `inactive`, `NRestarts=0` after (read through the gate) |

A first launch at 16:12 exited at once (`run.mjs` exit 2: `Cannot find module 'vec3'`, the fresh checkout had no `node_modules`). That was before any `ssh cx23-ctl` call or console command. After `npm ci`, the run above was the only start.

## The measurements (the ADR's inputs)
| Measure | Value |
| --- | --- |
| **Peak memory** | **634 MB** (`MemoryPeak`; `MemoryCurrent` peaked at 632 MB). It rose from 352 MB at the join to about 615 MB by minute 45, then stayed flat at 629–632 MB to the end (the 25 samples are in `result.json`, `notes.samples`). The unit's limits are `MemoryHigh=1G` and `MemoryMax=1536M` |
| **NRestarts** | **0** at all 25 samples; `ActiveState` was active at every sample |
| **LLM spend** | **USD 0.011576 per hour**: USD 0.023171 over 120 min, the sum of `cost_usd` over 178 `[openrouter] usage …` lines (#395), 0 unknown. That is 178 completions in 2 h, about 89 per hour |
| Journal coverage | complete: 120.1 of 120.1 min; no failed reads |

## The checks (`result.json`)
| Check | Result |
| --- | --- |
| `login_online` | PASS: joined at 16:24:31, version-4 UUID |
| `naming` (#2) | PASS: `[naming] <bot> near spawn: 15 kinds; unknown 0`, all real names; no entity near (+240 s) |
| `no_crash` (#7) | PASS: 120 min up, 25 samples, NRestarts 0 throughout, no agent exit |
| `peak_memory` (#7) | not reached: no target yet (TBD); measured 634 MB |
| `usd_per_hour` (#7) | not reached: no target yet (TBD); measured USD 0.011576/h |
| `agenda_done` (#4) | PASS: `agenda done` at 16:32:57, about 8.5 min after the join (stone axe and cobblestone included) |
| `food_floor` (#5) | **FAIL**: lowest food 1 (floor 6), over 121 food lines |
| `ate_when_low` (#5) | **FAIL**: 2 of 3 `low` food lines had no eat after them |
| `deaths_reported` (#5, as #6) | PASS: each of **17** deaths reported |

## Survival (the bot's own `[survival]`, `[night]` and `[death]` lines, `driver.log`)
- **Counts:** 2 eats (bread at food 12 at 16:52:33; rotten flesh at 12 at 17:18:16); 7 fights, all zombies (3 ended `died`, 4 `interrupted`); 31 flees; 121 food lines.
- **Food:** `low` lines came only at food 12 (16:52:31, 16:54:32, 17:22:20). Lower values were logged as `check`. Food fell to 5 by 18:07 and to 1 by the end, while the bot was in its third-night shelter. There was no eat in that stretch.
- **17 deaths, all reported, in three bursts:**
  - **First night (4), 16:54:35 to 16:58:39.**
    - At 16:39:01 it was in its shelter at (-80, 66, -38).
    - From 16:54:09: `zombie is digging the shelter … ready to repair`, then `the shelter is open … repairing`, then `the repair placed nothing (… 2 open …; placed 0.)`, then `death: not in a shelter any more`.
    - The first death lost what it held (116 dirt piles, 19 logs, 19 rocks, …).
    - After each respawn: `shelter try 1 of 3 failed (… Found no place for a shelter within 4 blocks …)`, `(found no place to dig a hole shelter)`, and `you have 0 dirt and 0 dirt piles, and a dirt shelter needs 9 dirt …`.
    - A second shelter at (-53, 66, -39) was dug open within 10 s, and its repair placed nothing too.
  - **The morning after (10), 17:08:26 to 17:17:12**, after `morning: back to work` at 17:04:30. Several deaths lost nothing or only dirt piles, spider silk or rotten flesh.
  - **Second night (3), 17:26:50 to 17:44:33.** Another shelter at (26, 70, -52) was dug open (`repairing`, then death). The next said `no shelter after 3 tries and a hole shelter … no weapon: keeping away from mobs until morning`, then a death at 17:43:36. A hole shelter at (3, 75, -78) was opened at once, then a death at 17:44:33.
- **Third night:** `in the shelter at -80, 66, -38 until morning` at 17:59:04, with no death to the end.
- **Also:** `agenda step shelter_blocks stuck: 5 min of self-prompting; going on without it until the night` at 17:13:01.

## For the owners (not judged here)
- **skills-rotn: the night shelter loses to digging zombies.** "The repair placed nothing" while two cells stay open. After a death with an empty inventory, there's no shelter site and no blocks, so the deaths repeat.
- **skills-rotn: the morning-after burst** (10 deaths in 9 minutes in daylight).
- **skills-rotn: eating.** It ate twice; food reached 1 with `check` lines, and no `low` line below 12 (`food_floor`, `ate_when_low`).
- **The lead (soak ADR):** peak memory 634 MB and USD 0.0116 per hour are this run's measurements. One run on a fresh world with a death spiral is not a typical hour of play.

## Files (each made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean)
- `result.json`: the runner's result, with every sample.
- `run.log`: the scenario's own lines.
- `server.log`: the server log from the scenario's begin marker.
- `driver.log`: the unit's journal from its start line (`[settings]`, `[state]`, `[naming]`, `[survival]`, `[night]`, `[death]`, `[openrouter] usage …`).
