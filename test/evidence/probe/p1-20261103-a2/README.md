# Probe P1, attempt 2, the rerun (2026-11-03): SMOKE-PASS, 8 of 8 checks (a probe, never a gate); the server is deleted

**Result in one line:** on the real RotN 3.3.4 server, the bot (net-forge's `g1-driver` with its probe commands) crafted four RotN recipes, including the 3x3 stone pickaxe in FastWorkbench's window, placed five blocks and ate a bread. The server confirmed each step with its own counts and `testforblock`. Every serverbound window click, those with REID item ids above 4095 included, was accepted. Verdict `SMOKE-PASS (not a gate pass)`: P1 is never a gate.

Attempt 1 (`../p1-20261103-a1/`) failed at setup on a late console reply. Its fix (#183) was merged before this run. Here no reply came late (`notes.lateReplies` is empty), so the fix did not have to act.

## Run conditions

- **GO:** the lead's "P1 rerun: go" (2026-11-03), for the one rerun the human approved, under attempt 1's terms. No retry without a new GO.
- **Code:** a new clean detached worktree of develop at `defbaa69` (includes #183 at 9422afe and #184), after `npm ci` (all patches applied). `result.json` has `git.dirty: false` and `untracked: 0`.
- **Checks right before the create, all passed:**
  - `msa-login FRCFLD --check`: exit 0 (output discarded).
  - `hcloud server list` and `hcloud primary-ip list`: empty.
  - The preflight on its own (`deploy/test-server.sh up --dry-run --ttl-hours 2 --seed 1880465901402976865`, 15:19:59): sweeper OK by the cadence path (4 dispatch runs in 50 min, gaps 14.7, 15.4 and 14.5 min); nothing created.
- **Command:** attempt 1's, with only the output folder changed (`captures/raw/p1a2`). There were no skip flags, `--ttl-hours 2`, a fresh server, and no `OPENROUTER_API_KEY` in the batch's environment (no LLM).
- **Server:** CPX42, nbg1, the pinned RotN 3.3.4 server pack, world seed `1880465901402976865` (`notes.worldSeed`). Status ping: 1.12.2, Forge 14.23.5.2860, REID (`jeid`) 2.2.2, 346 mods.

## Timeline (UTC)

| Event | Time |
| --- | --- |
| Batch start | 15:20:16 |
| Server created | 15:20:26 (IP 15:20:40) |
| Phases | unreachable 15:20:50, booting 15:21:10, unpack 15:21:59, starting 15:22:16, ready 15:25:30 |
| READY, scenario start | 15:25:33 |
| `login_online` | 15:25:50 |
| `setup` | 15:26:51 |
| Crafts | 15:27:02, 15:27:13, 15:27:24, 15:27:35 |
| `place_5` | 15:28:21 |
| `eat` | 15:28:34 |
| Scenario end | 15:28:40 |
| EXIT-trap teardown | started 15:28:50; "verified gone" 15:29:05 |
| Project checked empty | 15:29:12 (`hcloud server list` and `primary-ip list` empty; the only SSH key is the human's unlabelled one) |

## Checks (each needs the driver's reply AND the server's own confirmation)

| Check | Result | Driver (contract v1 reply) | Server |
| --- | --- | --- | --- |
| `login_online` | **PASS** | joined; capture path reported | `UUID of player <bot>` is version 4 (Mojang account); no kicks; `loginRetry` `{retried: false}` |
| `setup` | **PASS** | (none) | 5/5 gives answered `Given ... to <bot>`; `Successfully found the block at -43, 66, -66` (crafting table); `Added new objective 'p1food' successfully` |
| `craft_crude_axe` | **PASS** | `crafttweaker:pyro_crude_axe` ok, crude axe 0 -> 1, 589 ms | count-only `clear`: `pyrotech:crude_axe` 1, `pyrotech:rock` 7 |
| `craft_crafting_tools` | **PASS** | `crafttweaker:crafting_tools` ok, 0 -> 1, 513 ms | `contenttweaker:crafting_tools` 1, `pyrotech:crude_axe` 0 |
| `craft_crafting_table` | **PASS** | `crafttweaker:crafting_table` ok, 0 -> 1, 490 ms | `minecraft:crafting_table` 1, `minecraft:planks` 0 |
| `craft_stone_pickaxe` (3x3, at the placed table) | **PASS** | `crafttweaker:stone_pickaxe` ok at -43 66 -66, `tableBlock` `minecraft:crafting_table`, 1271 ms | `minecraft:stone_pickaxe` 1, `pyrotech:rock` 3 |
| `place_5` | **PASS** | 5/5 ok, each `minecraft:air` -> `minecraft:cobblestone`, `otherUpdates` 0 | `testforblock` found `minecraft:cobblestone` at all five cells |
| `eat` | **PASS** | bread ok: food 15 -> 18, bread 2 -> 1, 1736 ms | food score `p1food` 15 before the eat; count-only `clear`: 1 bread left |

`notes.contractProblems` is empty: every driver reply passed net-forge's `checkProbeReply`. The runner stopped the driver at the end (`botStoppedByRunner: true`, SIGTERM), after `clear <bot>` (10 items) and `scoreboard objectives remove p1food`.

## What the capture shows (`capture-summary.json`, from `test/tools/p1-capture-summary.mjs --names`)

**Serverbound REID item ids: accepted.**
- 33 `window_click` packets went to the server: 23 in the player inventory (window 0) and 10 in the table's window (window 1).
- The server answered every one with a `transaction`, all `accepted: true`: 0 rejected, 0 unanswered. Answer times were 39-136 ms (median 60 ms).
- **7 clicks carried REID item ids above 4095**, all accepted: `pyrotech:rock` 8917 (3 clicks), `pyrotech:crude_axe` 9075 (2), and `contenttweaker:crafting_tools` 12510 (2). The highest clicked id was 12510.
- The names come from rotn-data's Run A id table and are only labels; the ids are the server's. They match the items the server counted at each step.

**The FastWorkbench window.**
- A `block_place` on the table at -43 66 -66 (right-click) was answered after 138 ms by FML's mod window `fastbench` (window 1, inventory type `minecraft:crafting_table`, title `container.crafting`).
- The server sent 10 `fastbench` channel payloads while it was open. It was closed (`close_window`) 594 ms after it opened.
- **The 3x3 craft, from the set_slots and clicks in window 1:**
  1. The window opened with rock ×6, stick ×3, crafting table, bread ×2 and cobblestone ×8 in the inventory slots.
  2. The rock stack was picked up and one rock right-clicked into each of grid slots 1-3. While the rocks went in, the result slot showed `minecraft:stone_button` and then nothing.
  3. A left-click on the sticks' slot swapped the cursor's 3 remaining rocks into it and picked the sticks up. One stick each was right-clicked into grid slots 5 and 8, and the last stick was put into the now empty slot 10.
  4. The result slot then showed `minecraft:stone_pickaxe`, which was taken (slot 0) and put in an inventory slot.
  5. While the grid emptied, the result slot briefly showed `minecraft:stone_hoe` and then `contenttweaker:broken_stick` ×2, and ended empty.
  6. After the close, window 0 shows stone pickaxe ×1 and rock ×3, as the server's counts say.

**Not in the capture:** the five placements' `block_change` packets. The capture keeps at most 300 `block_change` records (and 300 `entity_metadata`, 100 `spawn_entity_living`), and the login's chunks used them up by t = 25.7 s, before the first placement at t = 119.9 s. The 6 serverbound `block_place` packets (the table click and the five placements) are there.

## Placement latencies (the driver's `updateMs`, from the place call to the server's block update for the placed block)

| Cell | Latency |
| --- | --- |
| -47 66 -66 | 1158 ms |
| -45 66 -68 | 589 ms |
| -45 66 -64 | 1095 ms |
| -47 66 -68 | 904 ms |
| -47 66 -64 | 634 ms |

The range was 589-1158 ms, median 904 ms. All five were below `place_block_timeout_ms` 2000 in the lead's `settings.js` (#158, #160), with a margin of 842 ms or more. Each total time equalled its update time.

## Bread and hunger

- **Setup:** `effect <bot> minecraft:hunger 22 19` at 15:26:24 on a fresh player (food 20, saturation 5).
- **Model:** net-forge's RotN hunger model (`simulateHunger`, #177: Hunger Overhaul's step cost of 4/0.85 and AppleCore's one step per tick) predicts **food 15** for that setup.
- **Measured:** the server's `food` score was **15** at the first read, 117 s after the effect began. The driver's own `bot.food` was also 15 before eating.
- **Eating one bread:** food went **15 -> 18 (+3)**, which is RotN's bread (3 hunger, `scripts/food.zs`, as #177 found). The bread count went 2 -> 1.

## Other lines from the server log

- **First join (15:25:43; the same as in attempt 1):** the pack ran, as the bot, `gamerule commandBlockOutput false` and `gamerule sendCommandFeedback false`, and gave 1 Bread and 1 Bundle (`[<bot>: Given ...]`).
  - The capture also shows a `lifescroll:spawnscroll` (id 4924) put in the hotbar at login, probably the third of the "3 items" the setup's `clear` removed.
  - This matters for G3: a fresh bot does not start empty-handed.
- **`<bot> moved wrongly!`** (WARN, 15:26:05) right after the setup's `tp`, as in attempt 1. The server corrected the position; no kick.
- **A server lag spike at 15:28:28**, during the food wait: `Can't keep up! ... Running 2160ms behind, skipping 43 tick(s)`. Around it, CoFH World logged cascading worldgen as DynView raised the view distance. It did not affect any check, but it shows the real server can stall for about 2 s.

## Spend

The server was up 8 min: 1 billed hour × EUR 0.1381, **about EUR 0.14**, plus 1 Primary IPv4-hour. The limit was EUR 0.30. P1 so far (attempt 1 and this rerun): about EUR 0.28 plus 2 IPv4-hours.

## Files

All files came out of `test/tools/redact-evidence.mjs --bot FRCFLD` with no hand edits, pass `--check`, and were read before committing:
- `result.json`: the runner's result;
- `server.log`: the server log from the scenario's start marker;
- `driver.log`: the driver's output, with every probe reply;
- `run.log`: the batch script's output;
- `capture-summary.json`: `node test/tools/p1-capture-summary.mjs <capture> --names`. It holds no payload bytes; the raw capture stays in the git-ignored `captures/raw/` on the PC.
