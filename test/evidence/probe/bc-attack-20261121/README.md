# Probe BC, step 4 of the Better Combat plan: attempt 1 (2026-11-21)

**Label: run under the lead's written GO `G-BC-PROBE-20261121`. A probe, never a gate.**

**Result: FAIL at setup, before any hit.** 1 check passed (`login_online`) and 12 failed: `setup` itself, and the 11 after it were not reached.
- **The cause:** the lane's east end runs through a thick Dynamic Trees trunk. Two of the 12 cells checked after building the lane were not air: `-43 66 -66` (zombie B's cell) and `-42 66 -66` (the AI zombie's cell) are `tile.trunkshell.name`.
- `setblock … minecraft:air` does not replace a trunk shell: all 16 of the lane's air setblocks answered `The block couldn't be placed`. For the 14 cells that were already air, that is the normal answer.
- So the scenario stopped, as it should, before summoning anything. No zombie was summoned, no `bc-hit` was sent, and no Better Combat packet went out.
- **What it did show:** on the real server, the driver's wrapper found the `bettercombat` mod and channel. The journal has `[forge-bridge] bettercombat attack: on`, and `bc_status` was `active: true`.

Every address is redacted (`<ip>`, `<local>`).

## Set-up
| | |
| --- | --- |
| Harness | A fresh detached checkout of develop at `b7104fa1cf9b17468de26c9059cf8592ab704c1e` (#533 merged). `npm ci` ran first, then `run.mjs --list`. Command: `run.mjs --scenario probe-bc-attack -- node test/runner/drivers/bc-attack-driver.mjs`. It ran once and was not retried |
| Bot | FRCFLD, the local test account's token cache (the one the G3 and probe runs use); never the CX23 service. The scenario started the driver with `ROTN_DRIVER_BC_ATTACK=on`, which the driver turns into `FORGE_BC_ATTACK=on` for this bot only. No LLM call |
| Test server | `mcr-test-20261121-133952`, a CPX42 in nbg1. Created 13:39:59 UTC, ready 13:45:59, deleted 13:48:36: about 8 min, billed about 1 h, EUR 0.1381 plus the IPv4. The watchdog `delete-after` was 2026-11-21T15:39:58Z (TTL 2 h). Afterwards Hetzner showed 0 servers, 0 Primary IPs and 0 labelled SSH keys |
| Server | The G2/G3/M1 seed `1880465901402976865` and the pinned pack: zip SHA-256 `90642fd5…f5205`. Mod Director: 1 pinned download and 337 zip jars match, 0 extra mods. `starts=1 files=1`. Firewall, whitelist and online mode as for the soaks |
| Timing | The scenario ran 13:46:06 to 13:47:45. `<bot> joined the game` came at 13:46:16 (`server.log`), and `login_online` passed at 13:46:19 (`run.log`). Setup ran 13:46:30 to 13:47:42, and the check failed at 13:47:44 |

## What happened (`server.log`, `run.log`)
1. **13:46:30 to 13:46:33:** `Game rule doDaylightCycle has been updated to false` and `Set the time to 1000`. `kill @e[type=zombie]` killed 5 zombies, which were already in the loaded chunks around the spawn.
2. **13:46:34 to 13:47:19:** the lane's 32 setblocks, at z -66 from x -48 to -41:
   - the 8 floor cells (y 65, stone): `Block placed`;
   - the 16 air cells (y 66 and 67): all `The block couldn't be placed`;
   - the 8 roof cells (y 68, stone): `Block placed`.
3. **13:47:21 to 13:47:36:** the 12 `testforblock` checks. Every check passed except two:
   - `The block at -43, 66, -66 is tile.trunkshell.name (expected: Air)`;
   - `The block at -42, 66, -66 is tile.trunkshell.name (expected: Air)`.
4. **13:47:38 and 13:47:42:** the teleport to the landing spot: `Teleported <bot> to -44.5, 66.0, -65.5`, twice.
5. **13:47:44:** `FAIL setup: Better Combat's path active; lane 10/12 cells as planned`. The scenario returned, and the runner stopped the driver.

The bot spawned at -45.5, 65, -59.5, about 6 blocks north of the lane.

**Why that spot:** the plan reused P1's landing spot (G2 batch 8, on this seed), which was open ground in P1's run. On a fresh world, Dynamic Trees grow at random, so the same seed can put a thick trunk next to it in one world and not in another.

## The checks (`result.json`)
| Check | Result |
| --- | --- |
| `login_online` | PASS: joined, version-4 UUID |
| `setup` | **FAIL**: `Better Combat's path active; lane 10/12 cells as planned` |
| `vanilla_*` and `bc_*` (8 checks), `bc_ai_zombie` | not reached |
| `server_log`, `self_check` | not reached |

**The server-log grep** was not reached as a check. By hand: the saved `server.log` has no `FMLIndexedMessageCodec` line, no WARN or ERROR line naming `bettercombat`, and no kick. The only `bettercombat` mention is the mod in the join line's mod list (`bettercombat@1.5.6`).

## Not measurable this time (nits from the #533 review)
There are no series, so there are no hits, health drops, crits or gaps to report.

The README of the next attempt will add two things to each series:
- **The zombie's start health from `entity_metadata`.** The expected range (`bcExpected`) uses the catalogue's health of 20.
- **Whether hit 1 of each NoAI Better Combat series was a crit.** rotn-data #528 expects a sneak crit.

## For the lead (a decision before another run)
The lane must not depend on the terrain. Options, for a small harness-ops PR:
- **(a) Recommended: an enclosed lane in the air.** For example at y 120 over the same x and z:
  - a stone floor, a stone wall on each side and a stone roof, so no zombie burns and the AI zombie cannot leave the lane or be knocked off it;
  - nothing grows there, the bot is inside, and mobs do not spawn within 24 blocks of a player;
  - it needs only more planned `setblock` and `testforblock` cells on the allowlist, still exact.
- **(b)** Keep the ground lane but try a list of candidate spots, using the first whose cells all test as planned. This still depends on the world.

Either needs a new run under a new GO.

## Files
Each file was made with `test/tools/redact-evidence.mjs … --bot FRCFLD`; the leak check `--check` is clean.
- `result.json`: the runner's result: the checks, `notes.bcStatus`, `notes.landing`.
- `run.log`: the runner's stdout (`run-stdout.log` in the raw folder).
- `server.log`: the test server's log for the run, as the runner fetched it.
- `driver.log`: the driver's stdout and stderr.

The raw forge-bridge capture (`capture.jsonl`, 5 MB) and the `since-start` log are kept in the raw folder and not committed.
