# Probe P1, attempt 1 (2026-11-03): FAIL at setup, a harness timing false negative; the server is deleted

**Result in one line:** `login_online` passed. `setup` failed with 4/5 gives confirmed, although the server had done all five; the console reply for one give arrived after the console's 1 s wait. By design the scenario stops after a failed setup, so **no craft, placement or eat ran**. P1 is never a gate.

**No retry** (the lead's GO): this is neither an infrastructure failure nor a probe finding. The lead approved the fix (#183) and one rerun on a fresh server after it merges.

## Run conditions

- **GO:** the lead's written GO for one P1 batch, approved by the human, 2026-11-03.
- **Code:** a clean detached worktree of develop at `e6196244` (#165 merged, with #162, #167 and #177), after `npm ci` (all patches applied). `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create, all passed:**
  - `msa-login FRCFLD --check`: exit 0 (output discarded).
  - `hcloud server list` and `hcloud primary-ip list`: empty (14:33 UTC).
  - The preflight on its own (`deploy/test-server.sh up --dry-run --ttl-hours 2 --seed 1880465901402976865`): sweeper OK by the cadence path (4 dispatch runs in 50 min, gaps 15.4, 14.5 and 15.3 min); nothing created.
- **Command** (the batch script; no skip flags, `OPENROUTER_API_KEY` removed from its environment, no LLM):

  ```bash
  deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- bash -c '
    timeout 20m node test/runner/run.mjs --scenario probe-craft-place --out captures/raw/p1 -- node packages/forge-bridge/tools/g1-driver.mjs; p=$?;
    bash "$TEST_SERVER_CTL" fetch logs --out captures/raw/p1/server;
    echo "P1 run.mjs exit $p (never 0: P1 is never a gate pass)"; exit 0'
  ```

- **Server:** CPX42, nbg1, the pinned RotN 3.3.4 server pack, world seed `1880465901402976865` (`notes.worldSeed`). Status ping: 1.12.2, Forge 14.23.5.2860, REID (`jeid`) 2.2.2, 346 mods.

## Timeline (UTC, from `date -u` and the logs)

| Event | Time |
| --- | --- |
| Batch start | 14:34:07 |
| Server created | 14:34:20 (IP 14:34:34) |
| Phases | unreachable 14:34:45, booting 14:35:19, unpack 14:35:52, starting 14:36:08, ready 14:39:39 |
| READY, scenario start | 14:39:42 |
| `login_online` PASS | 14:39:59 (server: joined 14:39:52) |
| `gamerule doDaylightCycle false`, `time set day`, `tp` | 14:40:10-14:40:18 |
| `clear`, gives, objective, hunger, table, placement cells | 14:40:20-14:40:56 |
| `setup` FAIL, scenario end | 14:41:00-14:41:02 |
| EXIT-trap teardown | started 14:41:10; "verified gone" 14:41:33 |
| Project checked empty | 14:41:47 (`hcloud server list` and `primary-ip list` empty; the only SSH key is the human's unlabelled one) |

## Checks

| Check | Result | Detail |
| --- | --- | --- |
| `login_online` | **PASS** | Joined with the account's Mojang UUID (version 4). `loginRetry` `{retried: false}`; no kicks. Landing: teleported to -44.5 66 -65.5, as planned. |
| `setup` | **FAIL** | `4/5 gives confirmed; table: found; food objective: added`. The unconfirmed one is `pyrotech:rock` (see below). |
| `craft_crude_axe`, `craft_crafting_tools`, `craft_crafting_table`, `craft_stone_pickaxe`, `place_5`, `eat` | not reached | The scenario stops after a failed setup. |

Verdict: `FAIL`, 1 passed, 7 failed, `gateValid: false` (P1 is never a gate). The runner stopped the driver at the end (`botStoppedByRunner: true`, SIGTERM); the server's "lost connection: ... Connection reset by peer" at 14:40:59 is that stop.

## Why setup failed: the console answered about 3 s after a `clear`

- `rotn-test console --wait 1 CMD` returns only the server log lines written during its own 1 s wait (`consoleWaitS: 1`).
- At 14:40:20 `clear <bot>` removed 3 items. Two mods then saved their data: gamestages ("Saved 1 stages", 14:40:22) and antiqueatlas ("Saving local markers data to NBT", 14:40:22).
- The next command, `give <bot> pyrotech:rock 8 0`, was answered at **14:40:23**: `Given    [Stone Rock] * 8 to <bot>` (`server.log`, line 61). That was after its 1 s window, which held only a DynView line.
- So `giveVerdict` saw no reply and marked the give unconfirmed. The other four gives (stick, planks, bread, cobblestone) were answered within their windows, in the same form, and were confirmed.
- **The fix** (#183, `test/runner/lib/late-console.mjs`): a reply missing from its own window is looked for in the server log lines written after it, for up to 5 s, and recorded in `notes.lateReplies`. Its unit test replays these exact lines.

## Found on the first join (they matter for G3)

When the bot joined this fresh world for the first time (14:39:53), the pack ran commands **as the bot** (the server log shows them in the `[<bot>: ...]` form of command feedback):
- `Game rule commandBlockOutput has been updated to false`;
- `Game rule sendCommandFeedback has been updated to false`;
- `Given [Bread] * 1 to <bot>` and `Given [Bundle] * 1 to <bot>`: **the starter items**;
- gamestages: "Syncing 1 stages" (one game stage granted).

For G3:
- A fresh bot does not start with an empty inventory: it has 1 Bread and 1 Bundle. P1's `clear` removed 3 items here (the two above plus one more, not named in the log).
- `sendCommandFeedback` is false from then on. Players no longer see command feedback in chat; the console replies the harness reads are still logged.

## Other lines, not problems

- 14:40:13 `<bot> moved wrongly!` (WARN), right after the `tp`. The server corrected the position; no kick. The second `tp ~ ~ ~` confirmed -44.5 66 -65.5.
- `The block couldn't be placed` (5 times): `setblock <cell> minecraft:air` on cells that were already air. 1.12 reports that when nothing changes. Every `setblock` of stone under a cell answered `Block placed`.
- The server's own WARN lines during the join (`defineId called for ...`, `Fetching addPacket for removed entity`) are pack-side.

## The capture

The driver's forge-bridge capture covers the login and handshake only, because no craft or placement ran. So this attempt shows **nothing about serverbound REID item ids in window clicks or the FastWorkbench window**; the rerun is for that. The raw capture stays in `captures/raw/` on the PC (git-ignored) and is not committed.

## Spend

The server was up 7 min: 1 billed hour × EUR 0.1381, **about EUR 0.14**, plus 1 Primary IPv4-hour. The GO's limit was EUR 0.30.

## Files

All files came out of `test/tools/redact-evidence.mjs --bot FRCFLD`, with no hand edits, and pass `--check`:
- `result.json`: the runner's result;
- `server.log`: the server log from the scenario's start marker;
- `driver.log`: the driver's output;
- `run.log`: the batch script's output (test-server.sh and the runner).
