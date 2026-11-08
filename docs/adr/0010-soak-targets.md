# ADR 0010: The 2-hour soak's memory and hourly-cost targets

- Status: accepted
- Date: 2026-11-08
- Author: rotn-lead

## Context

Ready-to-try item #7 (`docs/PLAN.md`, "Definition of ready-to-try") needs a 2-hour soak on the CX23 "with no crash, within memory and hourly API-cost targets the lead sets in an ADR". The `g4-soak-2h` scenario (#394) leaves both targets as `TBD` until this ADR sets them, so that every run before it is a measuring run and never a pass.

The first measuring run (GO G4-SOAK-M1-20261108, evidence `test/evidence/g4/g4soak-m1-20261108/`, #419) ran FRCFLD as the CX23 service (`rotn-v0.1.3`, the same commit as the harness) against a fresh test server for 120 minutes:

| Measure | Value |
| --- | --- |
| Memory (`MemoryCurrent`/`MemoryPeak`, 25 samples, in MiB) | 352 at the join, then flat at 629-632 (`MemoryCurrent`) from minute 55; **peak 634** (`MemoryPeak`) |
| `NRestarts` | 0 in every sample |
| LLM spend (sum of `[openrouter] usage ... cost_usd`, #395) | USD 0.023171 over 178 completions, every one with a known cost: **USD 0.0116 per hour** |

Other runs agree on the cost: the step 0 first start used USD 0.00758 in about 21 minutes, about USD 0.02/h (`test/evidence/cx23/step0-first-start-20261108/`); `test/scenarios/g4/PLAN.md` (#7) records about USD 0.015-0.02/h from G3 smoke (round 8 B: USD 0.011 in 40 min). Within M1, short windows run higher: the busiest 5-minute window was about USD 0.067/h, the busiest 15-minute window about USD 0.044/h (both around minute 43), and the busiest 30-minute window about USD 0.026/h.

The unit's own limits are `MemoryHigh=1G` (the kernel starts throttling and reclaiming above it) and `MemoryMax=1536M` (an OOM kill), from `deploy/cx23/mindcraft-rotn@.service`. The CX23 has 4 GB of RAM and no swap for the unit (`MemorySwapMax=0`).

The run had no player besides the bot. Every public chat line the bot reads is one more model call (TRY_IT.md), so a busy server costs more; the soak measures the bot alone.

## Options

1. Targets just above the measurements (for example 700 MiB and USD 0.015/h): tight, but a normal variation of world, mobs or model answers could fail a healthy run.
2. Targets at the unit's limits (1 GiB and no cost limit): the soak would then only repeat what systemd already enforces, and it would not catch a slow leak or a model loop.
3. Targets with headroom that still catch a leak or a runaway loop well before the limits.

## Decision

Option 3. For `g4-soak-2h` (and the G4 acceptance soak, step 7):

- **`peakMemoryMaxMb`: 850** (MiB, the highest `MemoryCurrent`/`MemoryPeak` sample over the 2 hours). That is about 1.35 times the measured peak and still 174 MiB below `MemoryHigh`, so a passing run never reaches throttling. The measuring run's memory stopped growing at minute 55; a leak that added more than about 216 MiB after that would cross the target.
- **`usdPerHourMax`: 0.05** (USD per hour of soak time, summed from the `[openrouter] usage` lines). That is about 4 times the measured rate and above every 15-minute window seen; short bursts reach about USD 0.06-0.07/h, which a 2-hour average absorbs, so a normal run passes, while a model loop (for example a chat or command loop) fails it. At this ceiling a bot running all day costs at most about USD 1.20.
- As before, a completion whose cost is `unknown` makes `usd_per_hour` "not reached", never a pass (#394).

These are the defaults in `test/scenarios/g4/g4-soak-2h.mjs` (harness-ops sets them there), so a run with other values passed as parameters stays not-gate (`gateParams` `equal`).

## Consequences

- harness-ops replaces the two `TBD` defaults with 850 and 0.05 and updates `test/scenarios/g4/PLAN.md` and `test/runner/DRIVER.md`. The next soak with these defaults can pass #7.
- The production key's credit limit (the human's) should allow at least a day at the ceiling, about USD 1.20, plus player chat.
- The soak still measures the bot alone. Before the live server, the human decides whether the bot should answer only when addressed (TRY_IT.md); that changes cost with players, not this target.
- The measuring run also failed `food_floor` and `ate_when_low` and had 17 deaths. Those are G4 #5 problems, fixed separately (skills-rotn, #414-#418 and a food fix), not reasons to change these targets.
- **What the targets cannot catch.** Both are judged over one 2-hour run. The memory target catches only a leak faster than about 3.3 MiB per minute after minute 55 (216 MiB in the remaining 65 minutes); a slower leak passes the soak and could still reach `MemoryHigh` within a day. The cost target is an average: a loop of about 20 minutes at USD 0.2/h would still pass (about USD 0.043/h for the run). The journal's per-sample memory and the `[openrouter] usage` lines show both, and a longer run later can check them.
- The soak scenario's messages say MB for values in MiB (`peakMemoryMaxMb` is MiB: `MemoryCurrent` / 1048576); harness-ops relabels them when it sets the defaults.
- If a later release changes memory or cost a lot (a new mod set, model or profile), a new measuring run and an update to this ADR come first.
