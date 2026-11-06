# Status: net-forge

Updated: 2026-11-06T08:05Z

Worktree `C:/Users/admin/orca/workspaces/mindcraft-RotN/net-forge-g1`.

## #256 question: Dynamic Trees leaves collision (2026-11-06T07:56Z answer; 08:05Z PR open)

- **PR:** branch `agent/net-forge/collision-shapes`, from develop `4fd8106`. Waiting for the lead's review.
- **Real dump result:** 4,595 modded blocks take the dump's shapes. 707 of them vary by state and 742 are walk-through. Overrides: 26 DT leaves and 12 full cubes. 9 blocks have no dump data and stay full cubes.
- **Tests:**
  - `test/collision.test.js` (7) passes, including prismarine-physics: the bot lands on leaves at +0.5 and falls through a rock pile.
  - 17 other test files that use `initBot` or the extension pass. `e2e-initbot` now expects a rock pile to be `'empty'`.
  - Lint: the new files are clean, and `mcdata.js` is unchanged at 11 errors.
  - The tool's `--check` reports the data up to date.

**Answer: players collide with Dynamic Trees leaves; they do not fall through.** Each leaves block is a half-height box inset by 1/8: `[0.125, 0, 0.125, 0.875, 0.5, 0.875]`. So they are ground, but the surface is 0.5 above the block, not 1.0. A player walks up onto them like a slab.

Evidence (javap on `DramaticTrees-1.12.2-0.13.4.jar`, modid `dynamictrees`, from the pinned zip `90642fd5...f5205`; nothing run):

- **`BlockDynamicLeaves.addCollisionBoxToList` (`func_185477_a`):**
  - Item entities carrying a DT seed get no box.
  - A falling tree entity (or no entity) gets no box.
  - If `passableLeavesModLoaded` or `vanillaLeavesCollision` is true, the leaves use vanilla's full cube (`BlockLeaves`).
  - Otherwise, if `isLeavesPassable` is false, the box above (bytecode 96-128).
- **The pack's settings:**
  - `config/dynamictrees.cfg` has `isLeavesPassable=false` (line 60) and `vanillaLeavesCollision=false` (line 66).
  - `passableLeavesModLoaded` is `Loader.isModLoaded("passableleaves")` (`ModBlocks.preInit`). That mod is not on the server: the mod list in `test/fixtures/rotn-3.3.4/ping.json` has no `passableleaves`.
- **`isPassable` (`func_176205_b`):** returns `isLeavesPassable` (false). `getCollisionBoundingBox` is not overridden. `getBoundingBox` (the selection box) is a full cube.
- **Addon leaves:** all 26 leaves blocks on the pack inherit this. That covers the DT addons (BOP, PHC, Quark, Aether, TF, Defiled Lands) and `rustic:leaves0`. None of the 7 addon leaves classes overrides a collision method.
- **Two more behaviours, for fall safety (#256):**
  - **Landing on DT leaves deals no fall damage.** `onFallenUpon` (`func_180658_a`) never calls `entity.fall`.
  - **`canopyCrash=true` (cfg line 36):** a landing with fallDistance > 3 (after -1) destroys the leaves under the entity's footprint. It works down layer by layer, multiplying fallDistance by 0.66 for each leaves layer, and stops once fallDistance is 3 or less or it reaches a block that is neither air nor leaves. The entity then falls on from there.
  - **Inside leaves (`onEntityCollidedWithBlock`):** a real client is slowed (x/z motion x0.25, sinking halved, no sprint). mineflayer does not model this. The server does not enforce it either, so no kick is expected.

**Why the bot sees a full cube.** forge-bridge's `extendRegistry` gives every modded block a full cube: `initBot` passes no properties, so the safe default is used. That covers all 4,642 modded blocks, not only the leaves.

rotn-data's dump has a per-state `collision`, but it is never applied to `bot.registry`. The dump also has a blind spot: it reads `getCollisionBoundingBox`. A scan of every dumped class chain in the pack's jars found 1,157 modded blocks that override `addCollisionBoxToList`. For those, the dump may be wrong, as it is for the DT leaves (it records them as a full cube).

**What the dump says for modded blocks (default state):**

| Default-state collision | Blocks | Examples |
| --- | --- | --- |
| Full cube | 2,521 | |
| No box | 757 | `pyrotech:rock` rock piles, plants, flowers, saplings |
| Partial box | 1,355 | slabs, doors, fences, DT branches |
| Box changes by state | 708 | |

**Proposed minimal fix (net-forge, PR to follow):** a new `applyCollisionShapes(bot.registry, dumpBlocks)` in forge-bridge, called in `initBot` after `extendRegistry`.

- **Source of shapes:** each modded block gets the dump's per-state boxes.
  - `stateShapes` are indexed by metadata; prismarine-block reads them on 1.12 as well.
  - `boundingBox` is `'empty'` only when no state has a box. The skills code checks `boundingBox === 'empty'` in felling, night, shelter and the pathfinder.
- **Exceptions, from the bytecode scan:**
  - The 26 DT leaves get the box above.
  - 12 blocks have an `addCollisionBoxToList` override and no box in the dump. They keep the full cube rather than becoming walk-through. Examples: lily pads (they hold a player up), barbed wire fence, grape vines, hops, the TF portal.
  - 9 blocks with no states in the dump also keep the full cube.
- **Vanilla blocks** are untouched; minecraft-data has their shapes.

**Requests:** rotn-data's dumper could record what `addCollisionBoxToList` adds for a player-sized entity, rather than `getCollisionBoundingBox`. The exception lists could then go.

## (Merged as #250) #249 review follow-ups (2026-11-06T04:42Z, lead's list)

- **Branch:** `agent/net-forge/stackup-followups`, from develop `aeda51d` (#249 merged). The PR is waiting for the lead's review.
- **(1) javap fixture:** the StackUp 0.2.5 javap excerpt is committed as `packages/forge-bridge/test/fixtures/stackup-0.2.5/PacketBufferWriterSplice.javap.txt` (readItemStack and writeItemStack, with the jar's SHA-256). A test checks `STACKUP_MARKER` and `STACKUP_BYTE_MAX` against its instructions.
- **(2) version warning:** the bridge logs a warning when the server's StackUp is not 0.2.5. Tested.
- **(3) load order:** `reid.js` now checks minecraft-data's protocol when it takes its copy, and throws if nmp has already merged overrides into it. Tested; every forge-bridge test file that loads it passes.
- **(4) process-wide note:** `stackup.js` says that the global nmp tables and nmp's protocol cache fix the slot layout for the whole process.
- **(5) spawn_entity:** dropped from the velocity compat list. mineflayer 4.33.0's `spawn_entity` handler reads no velocity.
- **Blocked / requests:** none.

## G3 round 3 batch C+D disconnect and the NaN x/z: merged as #249 (`aeda51d`)

- **Branch:** `agent/net-forge/stackup-count`, from develop `aec33fe`; PR #249 is waiting for the lead's review.
- **Local full suite:** `npm test` hung on Windows. Run file by file: 100 of 103 pass. The 3 others are harness-ops files that fail the same way on develop `d89fc30`: `deploy-eol` (CR in the autocrlf checkout), and `cx23` and `test-server` (both time out).
- **Disconnect, root cause: StackUp 0.2.5.**
  - StackUp's `PacketBuffer.readItemStack` reads count byte -42 (0xD6) as "an int count follows". Its writer sends counts outside 0..64 that way (`PacketBufferWriterSplice`, line 45 is the `readInt` in the server's stack trace).
  - RotN stacks rocks to 256 and blocks to 128 (`config/stackup`).
  - Our slot type read the -42 as the count, and the bot sent that stack back in a window click without the int. That is the 14-byte click: "readerIndex(11) + length(4) exceeds writerIndex(14)".
  - Its 3 unread bytes (`00 00 00`) were decoded again on channel close: id 0 (`CPacketConfirmTeleport`), teleport id 0, "1 bytes extra". So there is no separate teleport bug and no packet-id mapping error.
  - Fix: a native `stackUpCount` slot-count type, used when `stackup` is in the server's ModList (`src/stackup.js`).
- **NaN x/z, root cause: field names.**
  - minecraft-data 3.119 parses 1.12.2's `entity_velocity` (and the spawn packets) as `velocity {x, y, z}`. mineflayer 4.33.0 reads `velocityX/Y/Z`, so every knockback of the bot was a NaN velocity.
  - prismarine-physics' step-up branch then keeps y and makes x/z NaN. S1a's `movement_trace` shows it: `entity_velocity`, then "NaN 63.99999999999999 NaN".
  - The guard kept it off the wire; the server logged no NaN.
  - Fix: `src/velocity-compat.js` (in `initBot`). The guard also sanitizes the bot's own `entity_velocity`, and logs its trace when there is no capture.
- **Also fixed:** nmp merges customPackets into minecraft-data's protocol object in place, so `reid.js` now builds from a copy taken at load.
- **Earlier:** #235 (the `hordes.js` comment nit) merged. `agent/net-forge/hordes-nits` is left for the human's branch cleanup.
- **Blocked / requests:** none.

## (Merged as #235) #214 comment nit (2026-11-06T00:17Z)

- **Branch:** `agent/net-forge/hordes-comment`, from develop `9072315`. The PR is waiting for the lead's review.
- **Change:** a comment only, in `decodeHordes`, `packages/forge-bridge/src/hordes.js`.
  - `HordeSoundMessage.toBytes` (4-30) omits x/z when `direction` is null, while `fromBytes` always reads them.
  - The server always sets a direction (`spawnWave` 43/91).
  - Checked: such a payload with `hordes:horde_spawn` throws `WireError` (read past end), so the bridge logs it and emits nothing.
- **Tests:** `hordes.test.js` 7/7, the only targeted file.
- **Why a new branch:** the lead asked for a rebase on develop. `agent/net-forge/hordes-nits` was already pushed, and the rules forbid force-pushing. So its two STATUS commits were cherry-picked onto this fresh branch from develop. `hordes-nits` is superseded and can be deleted.
- **Blocked / requests:** none.

## Hordes horde event: merged as #214 (`d5ae8e7`), serves skills-rotn D1b

- **Branch:** `agent/net-forge/hordes-event`, **PR #214**, merged as `d5ae8e7`. It decodes the Hordes 1.1.7 `hordes_hordeevent` channel and emits `bot.emit('rotn:horde', ev)`. No batch was run.
- **Events for skills-rotn** (in `packages/forge-bridge/src/hordes.js`, wired in `initBot`):
  - `{ kind: 'start', key: 'message.hordes.EventStart' }`: the horde starts.
  - `{ kind: 'end', key: 'message.hordes.EventEnd' }`: the horde stopped.
  - `{ kind: 'wave', sound: 'hordes:horde_spawn', direction: { x, z } }`: a wave spawns. `direction` is the random XZ vector from the player along which the wave spawns.
  - `{ kind: 'message', key }`: some other text, for example if a listener changed the message.
  - Only the event's own player gets these (`OngoingHordeEvent.sendMessage`, `sendTo`). The client draws the title from the lang key, so **no chat line** reaches the bot.
- **Layout (javap on the pinned jars):**
  - SimpleNetworkWrapper channel: disc 0 is HordeSoundMessage (double x, double z, UTF-8 string sound).
  - Disc 1 is AtlasLib 1.1.6 SimpleStringMessage (UTF-8 string).
  - The offsets are cited in the header of `hordes.js`.
- **Registration:** no handshake change is needed. `hordes_hordeevent` is in the server's REGISTER list (`captures/raw/g1-runB2/summary.json`), and the bridge echoes those channels back by default (`bridge.js`, `echoServerChannels`).
- **Errors:** short payloads are logged as `decode error on hordes_hordeevent`. Unknown discriminators are logged and ignored. A throwing `rotn:horde` listener is logged and does not break the bridge.
- **Tests:** `test/hordes.test.js` has hand-written golden vectors and the custom_payload-to-`bot.emit` path. Run with the touched suites (hordes, bridge, channels, e2e-initbot): 25/25 pass. Lint is 254, the baseline, and the touched files add no new errors.
- **Not proven live:** no server run has sent a horde yet. The bytes come from the jar, not from a capture.
  - Pack defaults (`config/hordes.cfg`): `hordeSpawnDays=15`, `hordeStartTime=13000`, `spawnFirstDay=false`, `hordeSpawnDuration=20000`, `hordeSpawnSound=true`. So the first horde comes on day 15 at dusk, not on the first night.
  - A live check would need `/hordes` debug commands (`CommandDebugHordeEvent`) on the test server.
- **Blocked / requests:** none.

## (Earlier) PAUSED for the Orca restart (2026-11-05T01:49Z, lead's request)

- **Branch:** `agent/net-forge/hordes-event`, from develop `2f2f0c2`, pushed. It holds this STATUS entry only. No code is written yet, nothing is uncommitted and nothing is running.
- **Task (lead, from the #212 review; serves skills-rotn D1b):** decode the Hordes 1.1.7 horde warning in forge-bridge.
  - **Channel:** the Forge custom payload channel `hordes_hordeevent` (`HordeEventPacketHandler`). The message carries the lang key `message.hordes.EventStart`, and the client renders the title itself (`config/hordes.cfg:17`, `eventNotifyMode=3`).
  - **What to build:** a structured event, for example `bot.emit('rotn:horde', { key, ... })`, and an offline golden-vector test.
  - **Size:** small PR, no batch.
- **Found so far:**
  - `javap` is at `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot\bin\javap.exe`.
  - The pinned pack zip is at `C:\Users\admin\source\RotN 3.3.4 Server Pack.zip`.
  - The forge-bridge files to look at: `packages/forge-bridge/src/channels.js` (mod channels), `bridge.js`, `modlist.js`. The existing tests are `test/channels.test.js` and `test/golden.test.js`.
- **Exact next step on resume:**
  1. Extract the Hordes jar from the zip into a new empty scratch folder. With `javap -c -p`, read the packet class(es) `fromBytes`/`toBytes` and `HordeEventPacketHandler`, and cite the bytecode offsets for the layout.
  2. Check whether `hordes_hordeevent` must be in the client's `REGISTER` / FML channel list for the server to send it, and register it in the handshake if so.
  3. Decode it in `channels.js`, then `bot.emit('rotn:horde', {...})` with the decoded fields. Unknown or short payloads are logged, not thrown.
  4. Write a golden-vector test from bytes built per the jar's layout. Run only the forge-bridge tests that are touched. Open the PR and update this STATUS.
- **Earlier:** #192 (Request 2 final answer) merged as `a24f1d3`; #199 (its nits) merged.
- **Blocked / requests:** none.

## Request 2: FINAL answer for skills-rotn, proven live by P1 (2026-11-03T16:06Z)

This replaces the offline-only answer further down. C1 (crafting) and D2b (shelter placing) can build on it.

### What P1 proved on the real RotN 3.3.4 server

Rerun evidence #189 (`88c02bc`, `test/evidence/probe/p1-20261103-a2/`). The lead's review confirmed it, and I read the redacted driver log and `capture-summary.json` myself.

| What | Live result |
| --- | --- |
| Crafts (rotn-data dump recipe -> `convertRecipe` -> `bot.craft`) | **4/4** by the server's counts: crude axe, Crafting Tools and the crafting table in the 2x2 grid; the stone pickaxe at the FastWorkbench table |
| Craft time (`bot.craft`) | 2x2: 490-589 ms. At the table: 1271 ms, which includes the right-click, the open and the 3x3 clicks |
| Window clicks | **33/33 accepted**, 0 rejected, 0 unanswered. 7 of them carried REID item ids above 4095 (rock 8917, crude axe 9075, Crafting Tools 12510). Each click was answered in 39-136 ms |
| FastWorkbench | The right-click on the table was answered in 138 ms by **one** FML `fastbench` mod window (window 1, `minecraft:crafting_table`). forge-bridge's synthetic window worked with no extra code. It closed 594 ms later |
| Placements (`bot.placeBlock` path) | **5/5** cobblestone (the lead's review of #189). The probe's `updateMs` was 589-1158 ms, median 904 ms (see below for what it contains) |
| Eating (`bot.consume`) | food **15 -> 18**: bread is **+3** live, as `scripts/food.zs` sets it, so Hunger Overhaul does not override it. `bot.consume` took 1736 ms (about 35 ticks), and that includes a server stall (see E1) |
| Hunger model | food 15 after `hunger 22 19`, exactly as `simulateHunger` predicted |
| Kicks / `movement guard:` / parse errors | none |

### Where the placement time goes, and `place_block_timeout_ms`

**Keep 2000.** I lined up the driver's call times with the capture's serverbound `block_place` times:
- **Before the packet is sent, 540-1060 ms is on the bot.** mineflayer turns the head smoothly to the block first: `physics.yawSpeed` 3.0 rad/s, 0.15 rad per 50 ms tick (`node_modules/mineflayer/lib/plugins/physics.js:162-164`). So a turn of up to 180° takes up to about 1.05 s. P1's cells were west, north and south of the bot.
- **After the packet is sent, the server answered in about 40-125 ms,** one network round trip plus a tick.
- **The 2000 ms wait covers only the second part.** mineflayer starts the `blockUpdate` timer after `_genericPlace` has turned the head and sent the packet (`place_block.js:27-32`). The margin over the measured values is therefore about 16x.
- **The real server can stall, though.** It logged `Can't keep up! ... Running 2160ms behind, skipping 43 tick(s)` once (`server.log:201`, 15:28:28). That was in the same second as the bread eat (`probe-eat` whispered at 15:28:27, `eat ok` at 15:28:29), not during a placement. A stall like that during a placement can exceed 2000 ms even when the block does get placed. Raising the value would not remove this case, because stalls can be longer, so handle it in the skill (rule P2 below).

### The API to call

**Crafting** (the same call for the 2x2 grid and the table):
1. Get the recipe from rotn-data: `convertRecipe(bot.registry, dumpRecipe)` (`packages/rotn-data/index.js`).
   - Take the first variant the inventory covers; see `pickVariant` in `packages/forge-bridge/tools/probe-commands.mjs`, which never counts one stack for two cells. That is what P1 used. The crude axe has 256 variants (ore dictionary), and the first covered one is fine.
   - Build the recipe with `new (require('prismarine-recipe')(bot.registry).Recipe)(variant)`.
   - `bot.recipesFor(itemId, meta, 1, table)` (filled by `initBot` with the same conversions) was **not** exercised live.
2. `await bot.craft(recipe, 1, table)`:
   - `table` is `null` for the 2x2 grid;
   - at the table, it is `bot.blockAt(pos)` of a `minecraft:crafting_table` within reach (RotN's FastWorkbench). No FastWorkbench-specific code is needed: `bot.craft` right-clicks it, forge-bridge turns FML's OpenGui into a normal window, and `bot.craft` closes it again.
3. Check the result in the inventory afterwards. P1's success test was "count of the result rose by 1".

**Placing:**
1. Hold the item: `await bot.equip(item, 'hand')`.
2. Then `await bot.placeBlock(referenceBlock, faceVector)`. The block lands at `referenceBlock.position.plus(faceVector)`. The wait comes from `settings.place_block_timeout_ms` (2000).
3. For a one-off wait, `bot._placeBlockWithOptions(ref, face, { timeout })`, clamped to 50-60000 ms.
4. A timeout throws `Event blockUpdate:(x, y, z) did not fire within timeout of <N>ms`.

**Eating:** `await bot.consume()` with the food held, **only while `bot.food < 20`** (rule E1).

### Rules

- **C1 (auto-eat).** Pause mineflayer-auto-eat around `bot.craft`: `bot.autoEat.disable()`, then `enable()` in a `finally`. It clicks the inventory too. P1 ran with it off.
- **C2 (recipe results).** `recipe.result` must carry the exact count and meta and no NBT, or the server rejects the result-slot click. `convertRecipe` does this, and wildcard meta becomes `null`. **`convertRecipe` emits no `outShape` at all**, so a recipe that leaves a container item in the grid (a bucket, for example) would leave mineflayer's local grid out of step with the server until the server's `set_slot`s correct it. No early-game recipe has one. The older offline sections below, which say container items "belong in `outShape`", describe what a recipe would need, not what `convertRecipe` does.
- **C3 (other mod GUIs).** Only FastWorkbench's GUI becomes a window. Other mod GUIs (for example `craftingcraft:portable_crafting_table`) are logged only.
- **P1 (what success means).** mineflayer returns on the first change of block type at the target. Check `bot.blockAt(target)` afterwards when the exact block matters.
- **P2 (a placement timeout means "unknown", not "failed").** Wait about 1 s, then read `bot.blockAt(target)`. If it is the block, it worked. Retry only if the target is still empty. A blind retry is harmless on an occupied target, but it costs another head turn and another wait.
- **P3 (head turns cost time).** Each placement costs up to about 1 s of head turn before the packet. For D2b, order the cells so that the head turns little between them (go round, not back and forth). mineflayer can skip the smooth turn with `forceLook: true` in the options, but that is **not tested live**; do not depend on it without a probe.
- **E1 (eating: full food and the 2500 ms timeout).** Checked in mineflayer 4.33.0, `node_modules/mineflayer/lib/plugins/inventory.js`:
  - **At food 20,** `bot.consume()` throws `Food is full` at once, before it sends anything (L103-105; survival mode and non-"always" foods; bread is not one). A 1.12 player cannot eat bread at food 20 anyway. Check `bot.food < 20` first so you do not depend on the throw. P1's driver does that.
  - **Its own timeout:** it waits at most `CONSUME_TIMEOUT` = **2500 ms** (L13, L111), then throws `Promise timed out.` (`lib/promise_utils.js:79-86`). The wait ends early on the server's "eating done" `entity_status` 9 (L68-71), on a change of held item type or count (L76-88), or on `set_cooldown` (L90-96).
  - **Margin:** live, bread took **1736 ms** (about 35 ticks, P1), so 2500 ms leaves only about 760 ms. That eat already overlapped P1's one logged stall (2160 ms behind, 43 ticks skipped, `server.log:201`) and still finished in time. A longer stall can make it throw even though the bot did eat.
  - **So, as with P2: a `Promise timed out.` means "unknown".** Compare `bot.food` (or the food item's count) with the value from before the call, about 1 s later. Retry only if neither changed. The timeout is a module constant, not an option, so it cannot be raised without a mineflayer patch. I only make that patch on request, if a scenario shows that this harms the bot.
- **E2 (bread).** Bread is +3 food in RotN, so plan with that.

### Still not proven live (not needed for C1 or D2b)

- `bot.recipesFor` / `installRotnRecipesOnce` as the recipe source;
- `forceLook: true`;
- placing against modded blocks;
- any mod GUI other than FastWorkbench.

### Small things seen in P1 (mine, low priority)

- **`<bot> moved wrongly!`** (server WARN) right after the setup's `tp`, in both attempts. The server corrected the position; there was no kick and no `movement guard:` line. If it ever turns into a kick, I will look at how the teleport confirm and the next position packet are ordered in mineflayer 1.12 and `initBot`'s position throttle.
- **The capture's `block_change` cap** (300 records) was used up by the login chunks, so the five placements' `block_change` packets are not in the capture. The latency above comes from the driver plus the serverbound `block_place` times instead. If a later probe needs the server side exactly, I can make that cap skip chunk-load bursts (a forge-bridge change; only on request).

## P1 status (2026-11-03T14:44Z)

- **Merged:** #177 (`663efff`) and #165.
- **P1 attempt 1 failed at the setup,** on a harness console wait (lead). No probe step ran, so there is no P1 result yet: no `updateMs`, no bread value, no live click check.
- **For the rerun, I checked harness-ops' merged setup against the hunger model.** It is fine:
  - **Setup:** `effect <bot> minecraft:hunger 22 19`.
  - **Fresh player:** 10 steps, food **15**, first drop after about 12.9 s.
  - **Saturation already 0 at food 18:** food 8.
  - **Their wait** is right. They poll the server's own food score (`p1food`) for up to 40 s and send `probe-eat` only below 20. That covers the real-time wait that the offline model does not test.
  - **Nit, not blocking:** the comment at `test/runner/lib/probe.mjs:111-112` says "44 exhaustion: 11 points ... about 14". On RotN a point costs 4/0.85 ≈ 4.706 exhaustion, not 4 (Hunger Overhaul `hungerLossRatePercentage=85`). With the constant 0.01 per tick it is 48.4 exhaustion, 10 points and food 15. The server's food can only be lower, never higher.
- **Offer to harness-ops:** your e2e wraps `probe-test-server.js` to answer P1's three `scoreboard` commands. If you want, I can move that into `probe-test-server.js` (a food objective answered from the fake's food level, written only when the food changes), and your wrapper then becomes optional. Say so here.
- **After the rerun I will:**
  - read the redacted evidence;
  - check the measured `updateMs` against `place_block_timeout_ms: 2000`;
  - check bread's real food gain (+3 is expected);
  - look for any kick or `movement guard:` line;
  - check the capture for rejected clicks and the `fastbench` `mod_window`.

## The hunger setup for P1 (2026-11-03T12:10Z; lead, required before the P1 GO, #167 review)

**#167 merged** (`f5813ff`). The required fixes are in **#177** (`agent/net-forge/probe-hunger`):
- **The fake server models RotN 3.3.4's real hunger.** I read the jars in the pinned zip with `javap`; nothing was run. The model, per tick:
  - the Hunger effect adds `0.005 * (amp + 1)` exhaustion (vanilla);
  - Hunger Overhaul's constant loss adds 0.01;
  - one step costs 4/0.85 exhaustion, at most one step per tick, with a cap of 40 (AppleCore);
  - each step takes saturation first, then food.

  It is `simulateHunger` in `packages/forge-bridge/test/fake-containers.js`. The details and sources are in the README, "Hunger setup for `probe-eat`".
- **RotN facts the old fake missed:**
  - **Hunger Overhaul:** `constantHungerLoss`, `hungerLossRatePercentage=85`, and `damageOnStarve=200`, so food 0 kills the bot.
  - **The pack:** `difficulty=2`; bread is 3 hunger with saturation 0.2 (`scripts/food.zs`), not 5.
- **`probe-eat` fails at once at food 20** with `food is 20, not below 20: ...` and sends no `use_item`. Before, it hung until the 60 s limit.

**For harness-ops (#165), please change:**
1. **The setup:** `effect <bot> minecraft:hunger 20 24` instead of `10 10`, so `plan.hunger: [20, 24]`.
   - `10 10` leaves a fresh player at food 20, saturation 3, which the lead's review predicted. Then `probe-eat` cannot work on the real server.
   - With `20 24`, a fresh player ends at food 14, and bread takes it to 17. A bot whose saturation is already 0 at food 18 ends at about 7. Lower than that is not safe (item 5).
2. **The wait:** on the real server the effect runs in real time. Send `probe-eat` at least **25 s** after the effect command; a fresh player's food first drops after about 10.5 s. Your crafts and places probably take longer than that, but please enforce it, for example with a wait before eat counted from the effect.
3. **Your e2e console adapter** (`test/unit/probe-e2e.test.js:108-110`): call `containers.applyHunger(Number(seconds), Number(amp))` instead of `containers.setFood(14)`.
   - Then the offline test fails for a setup that fails on the real server.
   - Mutation check on my side: `probe-test-server.test.js` with `10 10` fails at the eat step with the new error.
   - `setFood` still exists, so nothing of yours breaks.
4. **Your stub fake driver** in `probe.test.js`: answer `probe-eat` with `ok:false` and that error when its food is 20.
5. **Run the setup only on a fresh bot (review of #177, finding 1).** `20 24` takes 11 food once saturation is 0. An idle bot gets there about 118 s after joining, from Hunger Overhaul's constant drain, and reaches food 11 at about 5.5 min. The effect would then take it to 0, and food 0 deals 200 damage.
   - Keep the effect where P1 has it, straight after the join checks: within about 3 min of the first spawn on a fresh server, while food is still 20.
   - If it ever moves later, check the food level first and abort below 18.
6. **Do not assert +3 from bread live (finding 3).** `scripts/food.zs` sets 3, but Hunger Overhaul's own food values (`useHOFoodValues=true`) may win at runtime, and that is not checked. Your `foodAfter > foodBefore` is right; P1's reply measures the real value.
7. **Still open from 11:46Z:** `test/unit/probe-e2e.test.js:184` must expect `'minecraft:crafting_table'`. It is red on develop since #167 merged; re-checked against your head `13d38253`, and it is the only failure.

**Changed in my helpers** (no export removed, as promised in item 15):
- `fake-containers.js` adds `simulateHunger`, `ROTN_HUNGER` and `applyHunger`. `foods` values can be `{ hunger, saturation }`, and `update_health` now sends the real saturation.
- `craft-world.js`: bread is now RotN's `{ hunger: 3, saturation: 0.2 }`, so eating at 15 gives 18, not 20. Your e2e asserts only `foodAfter > foodBefore`, so it is unaffected.

## Resumed 2026-11-03T11:46Z (after the Orca restart)

- **State:** respawned by the lead. The branch matches origin. **#167:** both CI checks pass, it is mergeable, and it waits for the lead's merge.
- **For harness-ops (your Requests item 15, #165).** I merged #165 (`857e7d8`) into #167 on a throwaway local branch, ran only the probe tests, and then deleted the branch.
  1. **One line in #165 must change, whichever PR merges first.** Contract v1 (#167) sends full registry names, as #162 did not.
     - `test/unit/probe-e2e.test.js:184` must expect `'minecraft:crafting_table'`, not `'crafting_table'`.
     - As it stands, the full-run e2e fails on that assertion only. Every scenario check, the verdict and `gateValid` already pass.
     - With that line changed, the combination is green: `test/unit/probe.test.js`, `test/unit/probe-e2e.test.js` and both forge-bridge probe tests run 19/19.
     - If #165 merges first, #167's CI turns red on the same line, and the reverse is also true. So the fix belongs in #165 now.
  2. **The fake driver in `test/unit/probe.test.js` (lines 107 and 114-120) does not meet contract v1.** `checkProbeReply` (exported from `packages/forge-bridge/tools/probe-commands.mjs` in #167) reports:
     - every reply is missing `"v": 1`;
     - names are short: `tableBlock: 'crafting_table'`, and place `before`/`after`/`expected` as `air`/`cobblestone`;
     - place replies are missing `item`, `ref`, `face` and `target`;
     - eat replies are missing `item`.

     The scenario reads none of these, so its logic is unaffected. Still, once #167 merges, please build the fake's replies to v1 and add `assert.deepEqual(checkProbeReply(reply), [])` in the fake. Then the stub suite cannot drift from the real driver again.
  3. **Your test helpers:** #167 changes no export of `craft-world.js`, `fake-forge-server.js`, `fake-containers.js` or `helpers.js`. I will tell you here before I change any of them.
  4. **Per-craft `modWindow` and `transactions`** (your optional item): not in v1. I will add them as v2 fields only if a later scenario needs them. For P1 the capture is the source, as you have it.
- **Next:** wait for #167's merge and #165's fix; answer harness-ops' questions here. The P1 batch waits for #165 merged and the lead's written GO (unchanged, see below).

## Restart point (2026-11-03T03:11Z, before the Orca restart)

- **State:** nothing uncommitted, nothing running. The branch is `agent/net-forge/probe-contract`, pushed.
- **Open PR:** **#167** only (the probe reply contract v1, `checkProbeReply`, the fake RotN test server, the `/say` lookalike closed, the place wait for the placed block's update, and this STATUS with the final Request 2 answer).
  - Independent review: APPROVE WITH NITS, and all 7 nits are fixed in `5b74744`.
  - It waits for green CI and the lead's merge.
- **Merged for Request 2:** #149, #154, #155, #161, #162. The lead's #160 set `place_block_timeout_ms: 2000`.
- **Half-done:** nothing.
- **Exact next steps:**
  1. Check CI on #167 (`gh pr checks 167`). If it is red, fix it on the same branch; never force-push.
  2. After #167 merges: help harness-ops with #165, their P1 scenario. They should run `runScenario(probe, ...)` against `packages/forge-bridge/test/probe-test-server.js` with their `driverProcess` and the real g1-driver, and check their fake driver's replies with `checkProbeReply`. Answer their questions in this file.
  3. P1 batch: only after #165 merges **and** the lead writes the GO. net-forge never starts it. Then collect the evidence through `test/tools/redact-evidence.mjs`, and use the measured `updateMs` to confirm or change `place_block_timeout_ms`.
- **Do not:** start any Hetzner server, run `npm ci`, or run the full `npm test` locally (PC memory).

## Request 2: offline answer for skills-rotn (C1 crafting, C2 placing), 2026-11-03 (superseded by the live-proven answer at the top)

**Works and is proven offline** (merged: #149, #154, #155, #161, #162). The offline proof is the real `initBot`, through forge-bridge and REID, against a fake server that models the 1.12.2/Forge/FastWorkbench server code read with `javap`, using the real Run A item ids:
- **Click encoding.** Serverbound `window_click` (and `set_creative_slot`) carry REID VarInt item ids, byte-exact with the vanilla 1.12.2 layout.
- **Crafting.** In the 2x2 grid and at RotN's crafting table, which is FastWorkbench, opened by FML OpenGui; forge-bridge turns that into a normal mineflayer window. Crude axe, Crafting Tools and the crafting table in 2x2, the stone pickaxe at the table: every click is accepted, and the server-side inventory is right.
- **Placing.** `block_place` (1.12 float cursor) with a configurable wait. `settings.place_block_timeout_ms` is 2000 (#160). Runtime and per-call values are clamped to 50-60000 ms.
- **Item use.** `use_item` and eating (`bot.consume`).

**Only the live probe P1 can prove** (plan under Requests; it waits for harness-ops' scenario and then the lead's GO):
- that the real server accepts REID item ids in clicks;
- FastWorkbench's real order (OpenGui, then `window_items`) and its result-slot `set_slot`;
- the real placement latency, which will settle the 2000 ms value.

**The API to call:**
- **Crafting**, the same call for the 2x2 grid and the table:
  1. Get the recipe. Either take rotn-data's dump recipe through `convertRecipe(bot.registry, dumpRecipe)` (`packages/rotn-data/index.js`), pick the first variant the inventory covers, and build `new (require('prismarine-recipe')(bot.registry).Recipe)(variant)` (this is what P1's `probe-craft` does, see `pickVariant` in `packages/forge-bridge/tools/probe-commands.mjs`). Or use `bot.recipesFor(itemId, meta, 1, table)`, which `initBot` fills with the same conversions (`installRotnRecipesOnce`); that path is not exercised in my tests.
  2. Call `await bot.craft(recipe, count, table)`. `table` is `null` for the 2x2 grid, or `bot.blockAt(pos)` of a `minecraft:crafting_table` (FastWorkbench) within reach. No FastWorkbench-specific code is needed.
- **Placing:** `await bot.placeBlock(referenceBlock, faceVector)` with the item held (`bot.equip(item, 'hand')`). The wait comes from settings. `bot._placeBlockWithOptions(ref, face, { timeout })` sets the wait for one call. A failure throws `Event blockUpdate:(x, y, z) did not fire within timeout of <N>ms` (no space before `ms`). mineflayer returns on the first change of block type at the target; check `bot.blockAt(target)` afterwards if it matters.
- **Eating:** `await bot.consume()` with the food held.

**Rules for C1:**
- Pause mineflayer-auto-eat during `bot.craft` (`bot.autoEat.disable()`, then `enable()`). It clicks the inventory too, and it broke a craft in the offline test.
- `recipe.result` must have the exact count and meta, and no NBT. The server rejects the result-slot click otherwise. `convertRecipe` already does this. None of the early-game results have NBT.
- Wildcard meta (32767) must be `null`, which `convertRecipe` already does.
- Container items (`remaining`) belong in `outShape`. None of the early-game recipes have any.
- Other mod GUIs (for example `craftingcraft:portable_crafting_table`) do not open as windows. Only FastWorkbench's does.

## Resumed 2026-11-03: skills-rotn Request 2 (crafting, placing, item use on 1.12.2 + REID)

The human approved the resume on 2026-11-03, and the lead brought me back for skills-rotn's Request 2. Work is on branches from develop `49ec671`.

**Answers, item by item:**

1. **`window_click` with REID: the encoding works. The RotN crafting table does not, yet (see the gap below).**
   - The REID `slot` override is a global type, so serverbound `window_click.item` and `set_creative_slot` get VarInt item ids too. The slot *index* stays an i16, as in vanilla (REID changes only the stack's item id).
   - Proven offline in `packages/forge-bridge/test/serverbound.test.js` (PR 1). mineflayer's real `clickWindow` is injected into a stub bot. Its packet is encoded with the REID protocol and compared byte for byte with the vanilla 1.12.2 layout, then parsed back the way the server reads it. The test uses real Run A item ids (crude axe 9075, rock 8917, Crafting Tools 12510). It also covers:
     - an empty slot (VarInt -1, 5 bytes), meta, a 3-byte VarInt id and NBT;
     - all 7 click modes;
     - the transaction confirm that mineflayer sends after a rejected click (a 1.12 server ignores further clicks in that window until it arrives).
   - Turning REID off makes the two VarInt tests fail.
   - The vanilla layout comes from `javap` on `minecraft_server.1.12.2.jar` (SHA-1 `886945bf...5b25f`) from the pinned zip, extracted to scratch only, never run.
     - `CPacketClickWindow`: byte, short, byte, short, enum as a VarInt ordinal, item stack.
     - `NetHandlerPlayServer.processClickWindow` runs `slotClick`, then compares the clicked item with the stack `slotClick` returned. A mismatch means `accepted=false`, a pending transaction and a window resync.
   - The 2x2 grid is vanilla `ContainerPlayer`. FastWorkbench replaces only the server recipe book (`javap`, see below).
2. **`block_place` and `use_item` on 1.12: they work (encoding level).**
   - mineflayer 4.33 takes `blockPlaceHasHandAndFloatCursor` on 1.12.2 (position, face VarInt, hand VarInt, 3 f32). That matches vanilla `CPacketPlayerTryUseItemOnBlock` (`javap`).
   - `use_item`: our patch adds the 1.21 `sequence` and `rotation` fields, but the 1.12.2 serializer writes only `hand` (2 bytes in all). The extra fields are harmless. Same for `block_dig` status 5 (`deactivateItem`).
   - All of these are covered in the same test file through mineflayer's real `_genericPlace`, `activateItem` and `deactivateItem`.
3. **The 500 ms `blockUpdate` wait: yes, it can be made configurable.** That is PR 3 (the mineflayer patch, plus an `initBot` option). Details are in that PR.

**Gap found: the RotN crafting table opens through FML OpenGui, so `bot.craft(recipe, n, table)` fails.**
- Run A's RegistryData overrides `minecraft:crafting_table` (block and item) with **`fastbench`** (FastWorkbench 1.7.4).
- `javap` on `FastWorkbench-1.12.2-1.7.4.jar` from the pinned zip:
  - `BlockFastBench.onBlockActivated` calls `player.openGui(FastBench, 0, world, x, y, z)`.
  - Its `Handler` returns a `ContainerFastBench` (a `ContainerWorkbench`, same slots) for gui id 0.
- `javap` on Forge 14.23.5.2860 `FMLNetworkHandler.openGui`: it writes the FML OpenGui message (i32 windowId, modId, i32 gui id, x, y, z) **before** `addListener` sends `window_items`.
- So the server never sends a vanilla `open_window`. mineflayer's `craftOnce` then waits on `once(bot, 'windowOpen')` and fails after 20 s ("Event windowOpen did not fire within timeout of 20000ms", reproduced in PR 2's mutation check). Before PR 2, forge-bridge only logged OpenGui.
- **The fix (PR 2, forge-bridge only, done):** on OpenGui `fastbench`/0, emit a synthetic `open_window` (`minecraft:crafting_table`) on the client before the `window_items` that follows. prismarine-windows already knows that window (result 0, grid 1-9, inventory 10-45). Unknown mod GUIs stay logged only.
- Also from `javap`: `ContainerFastBench` sends the result slot (`set_slot` 0) only when the recipe or the result changes, plus an int recipe id on the `fastbench` channel. No reply is needed. mineflayer sets slot 0 from `recipe.result` before it clicks, so this does not matter for `bot.craft`.

**Notes for skills-rotn (C1), from the same reading:**
- mineflayer's `grabResult` clicks slot 0 holding an item built from `recipe.result` (id, count, meta, no NBT). The server accepts that click only if it equals the real result stack. Give `recipe.result` the exact count and meta from rotn-data. A result with NBT will be rejected (107 of the 6089 dumped recipes have NBT outputs; none of the early-game ones do).
- Ingredient meta `32767` is the wildcard. Pass `metadata: null` for it, or `findInventoryItem` looks for meta 32767.
- `remaining` items (container items) must become `outShape`. Otherwise mineflayer clears the grid locally while the server keeps them. The server's `set_slot`s fix this later. None of the early-game recipes have any.
- `craftingcraft:portable_crafting_table` also opens through OpenGui (not handled; not needed for ready-to-try).
- **mineflayer-auto-eat (loaded by `initBot`) clicks the inventory too.** In PR 2's test, at food 15 it equipped bread in the middle of a 2x2 craft (with its default `offhand: true`, it moved stacks into slot 45), and mineflayer's craft then failed with a rejected click. `agent.js` sets `startAt: 14` without `offhand`, so the window is smaller, but it is still there. C1 should pause auto-eat during `bot.craft` (`bot.autoEat.disable()` / `enable()`), or not craft while hungry.

**PR 2 (offline proof of the flow):** `packages/forge-bridge/test/craft-e2e.test.js`. The real `initBot` runs through forge-bridge and REID against the fake Forge server plus `test/fake-containers.js`, a model of `processClickWindow`, the crafting result slot, FastWorkbench's OpenGui, placing and eating as read with `javap`. It uses the real Run A ids and the `fastbench` override, and builds prismarine-recipe objects the way C1 will.
- The bot crafts the crude axe (2x2 shaped), Crafting Tools and the crafting table (2x2 shapeless), and a stone pickaxe at the FastWorkbench table (3x3).
- Every click is accepted on the first try, and the server-side inventory ends up right.
- `bot.placeBlock` places cobblestone, confirmed by `block_change`.
- `bot.consume` eats bread with `use_item` hand 0.
- Mutation check: with the FastWorkbench mapping removed, the table craft fails with the 20 s `windowOpen` timeout.

**Live proof:** the encoding is checked against the vanilla jar and the real ids, and PR 2's flow against a fake server that follows the `javap` reading. A real-server check is still needed. The probe plan is under "Requests" (it needs a written GO).

## Paused 2026-11-02

G2 passed (batch 8, #97). The human paused net-forge for Phase 3, and skills-rotn takes the agent slot. net-forge will be respawned for protocol issues.

**State at pause:**
- Nothing is uncommitted or in flight. Every `agent/net-forge/*` branch is pushed. No net-forge PR is open except this STATUS PR.
- The last merged code PR is #95 (the movement guard).

**What is done.** All of it is on develop; the details are in the sections below and in `packages/forge-bridge/README.md`.
- **The Forge connection:**
  - the FML|HS handshake and RegistryData;
  - `FML|MP` and the FML EntitySpawn into `bot.entities`, with rotn-data's mod-entity table;
  - REID/`jeid` overrides;
  - mod entity-metadata serializers;
  - the status-ping mod list with a fixture fallback;
  - the JSONL capture.
- **Bot setup:**
  - the `bot.registry` extension;
  - the Forge two-pass block-state-id remap, applied once at decode and active on the real server (batch 8: 506 state ids in 132 blocks, 0 conflicts);
  - the movement guard;
  - the `initBot` auth guard;
  - the `agent_process.js` exit-code contract.
- **The harness:** the G1/G2 driver (`tools/g1-driver.mjs`), and the dependency patches listed in CLAUDE.md.

**Known gaps:**
1. **Other server data with block states bypasses the remap.** Only chunk data, `block_change` and `multi_block_change` are remapped. These are used as sent:
   - falling-block `spawn_entity` object data;
   - `world_event` 2001 (block break) data;
   - block particle arguments;
   - mod plugin-channel payloads.

   Stock mineflayer reads none of them as block states today. Vanilla builds the first three with `Block.getStateId` (`id + (meta << 12)`), which may not need the map, but this is not checked with `javap`. See the README, "Known gap".
2. **The movement guard's root cause is still unproven.**
   - The batch 7 items kick (`invalid_player_movement`) was reproduced offline only, as a NaN explosion knockback. The capture did not record the movement packets, so the cause is not proven.
   - In batch 8 the guard never had to act: there was no `movement guard:` line and no `movement_trace`.
   - The trigger is named only when the guard fires on a real server.
3. **The capture logs no client movement packets.** It also does not log the server's `position`, `explosion` or `entity_velocity` packets except inside a guard-triggered `movement_trace`. Its map_chunk cap is 40 records, so the bot's own chunk can be missed and physics cannot be replayed from a capture.
4. **Never run on the real server:** death and respawn, dimension changes, and riding a vehicle. `vehicle_move` is guarded and unit-tested only. No G1/G2 evidence covers any of them.

**What I would do next:**
1. If any Phase 3 run logs `[forge-bridge] movement guard: ...` or a kick: take the `movement_trace` from that capture, name the trigger, and fix it where it starts (not only in the guard). Then add the sanitized trace as a test fixture.
2. Before any skill reads falling-block data, block-break `world_event`s or particles as block states: confirm the encoding with `javap` on Forge 14.23.5.2860. Remap them, or document that they need no remap, with a test.
3. Add capture options for C2S movement packets and the bot's own chunk (a ring buffer, off by default), so the next protocol kick is diagnosable from the first capture.
4. Live-test death and respawn, a dimension change, and riding, each in a harness scenario, since skills will need them.

## Done (offline, step 1 of the G1 spike; PR #10, merged as 26a0b5e)

- **`packages/forge-bridge`**: a fresh nmp client plugin per ADR 0003. Details are in `packages/forge-bridge/README.md`.
  - `tagHost = '\0FML\0'`, set before connect. It never uses `fakeHost`.
  - The exact Forge client handshake state machine. Acks carry the client's own state ordinals (2, 3, 4, 5). Our ModList is the server's own list, byte for byte.
  - RegistryData parsing (ids, then dummied, then overrides) into a RegistrySnapshot with name/id maps.
  - `FML|MP` reassembly, plus decoders for `FML` (EntitySpawn, OpenGui), `FORGE` (DimensionRegister, FluidIdMap) and `jeid`.
  - REID overrides, enabled only when the ModList has **`jeid`**:
    - `slot` item id as a VarInt;
    - `remove_entity_effect` id as an i32;
    - `entity_effect` keeps the vanilla fields and reads a trailing VarInt, which the bridge copies into `effectId`.
  - On every Forge connection: entity-metadata type ids are read as VarInts.
  - The mod list comes from a status ping. If the ping fails, it falls back to `FORGE_MODLIST_FILE`, for which the pinned fixture is `packages/forge-bridge/test/fixtures/rotn-3.3.4/ping.json` (a byte copy of `test/evidence/g0/status-ping.json`).
  - Capture: JSONL of every plugin-channel message in both directions, selected play packets, handshake events, kicks, and parse errors with raw bytes. The username and UUID are redacted at write time. The default folder is `captures/raw/`, which is git-ignored.
  - Kick classification per spec section 4, mapped to the ADR 0003 exit codes (0 clean, 1 transient, 3 fatal).
- **REID 2.2.2 layouts confirmed from the jar.** I ran `javap` on the class files of `RoughlyEnoughIDs-2.2.2.jar` from the pinned zip. The jar was extracted to a scratch folder outside the repo; nothing from it was run. All five section-R rows match. New facts:
  - The `jeid` channel's three message layouts (README table).
  - `remove_entity_effect` reads nothing for the vanilla byte (a Redirect to 0), then reads an i32.

  Lead, you may want to fold these into `fml-spec.md` section R.
- **`initBot` fixes**, all inside the function in `src/utils/mcdata.js`, plus one import line:
  - The version is read from settings inside `initBot`.
  - `profilesFolder` comes from `MINDCRAFT_PROFILES_FOLDER`.
  - forge-bridge is attached through nmp's `connect` option. `FORGE_BRIDGE=auto|on|off`; `auto` attaches when the ping reports FML.
  - The position throttle now keeps the newest state, merging position and look.
  - PartialReadError is counted and logged, no longer swallowed silently.
- **Dependency patches:**
  - New `patches/prismarine-chunk+1.41.0.patch`: the packet's bitsPerBlock is used for global-palette sections, and REID's VarInt biome tail is read.
  - `patches/protodef+1.19.0.patch`: `PROTODEF_LOG_PARTIAL=1` turns the "partial packet" log line back on.
  - `minecraft-data+3.97.0.patch` is renamed to `+3.119.0` (lead's item). patch-package now applies all seven patches with no version warning.
- **Tools** (`packages/forge-bridge/tools/`):
  - `msa-login.mjs`: the human's device-code login. It prints only the profile name.
  - `g1-spike.mjs`: the spike runner, using the real `initBot`.
  - `capture-summary.mjs`.
- **Tests:** `npm test` passes 101/101. All of it is offline, using synthetic fixtures plus the pinned ping.
  - This includes `e2e-initbot.test.js`: the real `initBot` against an in-process fake Forge server on 127.0.0.1. It covers the ping, tagHost, the handshake, a REID chunk, inventory and effect, chat both ways, walking and the capture.
  - Reversing the patches makes the chunk tests fail, so they really test the patch.
- **Verifier pass (adaptive-agents:verifier) on PR #10: PASS WITH ISSUES.** All findings are addressed in a follow-up commit:
  1. **Medium: a capture leak, reproduced by the verifier.** Parse-error and partial-packet records, and raw buffers inside decoded payloads, were base64-encoded before redaction.
     - Every Buffer, and every `b64` string, is now redacted inside the JSON replacer.
     - `packages/forge-bridge/test/bridge.test.js` covers each path.
  2. **Low:** `bot.partialReadErrors` never counted deserializer drops. It now includes the bridge's count.
  3. **Low:** reassembled FML|MP payloads are now re-emitted as `custom_payload` (spec 1.6). A length mismatch is logged.
  4. **Low:** the connect wrapper now does nmp's SRV lookup.
  5. **Low:** undeclared dependencies. See request 3, now listing minecraft-protocol and prismarine-auth too.
  6. **Info:** chunk bit widths for local writes. Documented under README "Known limits".
- **Lint:** `npm run lint` gives 259 errors, the baseline. My files add none, and `mcdata.js` stays at its own baseline of 13.

## Done since PR #10 merged (branch `agent/net-forge/g1-review-fixes`, from develop 26a0b5e)

The review findings on PR #10, numbered as in the review comment:

- **2 (medium) kicks:** `Failed to verify username` and `Invalid session` are now transient with `retryCap: 3`. The ban rule only matches `You are banned`, `Your IP address is banned` and `multiplayer.disconnect.banned*` at the start of the reason. "No Minecraft licence" stays fatal as its own category.
  - New `createRestartPolicy()` implements the ADR 0003 backoff (10 s doubling to 5 min, reset after 10 min connected) and the caps. It is not wired in yet; that is `agent_process.js`, brief item 8.
- **3 msa-login:** refuses any folder inside any git work tree. It walks up looking for `.git`, a folder or a worktree's file, and creates nothing on refusal. It creates the folder with mode 0700 and chmods it on POSIX. The check lives in `src/secret-folder.js` and has tests.
- **4:** `delete process.env.DEBUG` runs before prismarine-auth loads. A test checks that order and that the tool refuses a folder inside this repo.
- New: `msa-login.mjs FRCFLD --check` confirms the cache without ever starting a device-code prompt. If the cache needs a new login, it fails.
- **5 chunk widths:** a section now widens its data array when a written state id needs more bits. A section that leaves its palette uses the width of its widest id. `new Chunk({maxBitsPerBlock})` can seed the width. Local `block_change` writes of 20-bit ids are tested. README line 109 is corrected.
- **6:** `packages/forge-bridge/test/golden.test.js` holds hand-written hex vectors for ModList, RegistryData (1-, 2- and 3-byte VarInt ids), FML EntitySpawn (metadata, thrower velocity, spawn data) and FML|MP (PART_SIZE 1048496, 2 parts). The layouts come from `javap` on Forge 14.23.5.2860's own classes in the pinned pack's Forge jar, extracted to scratch and never run. Our decoders read each vector, and our encoders reproduce it byte for byte.
- **7:** `ChunkColumn.dump()` writes REID VarInt biomes back, or switches to them for any id over 255. Two tests show that a dump reloads. The viewer stays off (`render_bot_view: false`).
- **8:** the README documents that nmp's `merge` mutates the shared minecraft-data 1.12.2 protocol object. I confirmed this in a node session: `createSerializer` with customPackets changes `mcData('1.12.2').protocol.types.slot`.
- **10:** `g1-spike` `summary.json` records `walkMethod`, plus the blocks under the bot at spawn and along the walk, each with the Forge registry name next to prismarine's name.
- **9:** `summary.json` gets a `scope` field saying the spike does not test reconnects or exit codes. G1 evidence will make no such claim.
- **11:** capture limits per direction and channel (default 2000; the handshake, REGISTER and FORGE are never capped), a 1 MiB per-payload byte cap, a 256 MiB file cap with one `capture_full` event, and C2S packets capped per name. The closing summary records per-channel counts and drops.
- **Tests:** `npm test` passes 175/175, all offline. The chunk patch: reversing it fails all 9 chunk tests. `npm run lint` gives 259, the baseline; `packages/forge-bridge` has 0 errors.
- **FRCFLD login (done by the human, verified by the lead).** I ran the permitted check: `MINDCRAFT_PROFILES_FOLDER=C:/Users/admin/.mindcraft-rotn/FRCFLD/msa node packages/forge-bridge/tools/msa-login.mjs FRCFLD --check`, with `DEBUG` unset. It printed `Signed in. Minecraft profile: FRCFLD`. Nothing in the folder was read, printed or copied by me.

## Done: G1 gate driver for Batch C

- `packages/forge-bridge/tools/g1-driver.mjs` implements `test/runner/DRIVER.md`. It uses Mindcraft's real `initBot` with forge-bridge `on`, and harness-ops' `attachScenario` for hello, echo, walk and SIGTERM.
- It exits 3 without `MINDCRAFT_PROFILES_FOLDER` or host. It never starts a device-code login: `initBot` gained an optional `{ onMsaCode }`, a 5-line diff inside `initBot`.
- Kicks exit 3 when the runner's `FATAL_KICKS` or our `classifyKick` says fatal.
- It records the handshake result, registry sizes, `walkMethod` and block registry names as `DRIVER` lines.
- **Test:** `packages/forge-bridge/test/g1-driver.test.js` runs the driver as a subprocess against the fake Forge server, with the runner's allowlisted env.
- The shared fake world moved to `test/fake-world.js`.
- `npm test` passes 178/178; lint 259.

## Done: initBot auth guard and PR #15 nits (branch `agent/net-forge/initbot-auth-guard`, from develop 74b23ed)

- `initBot` throws when `auth` is `microsoft` and `MINDCRAFT_PROFILES_FOLDER` is unset, so it never falls back to nmp's shared default cache. The default `onMsaCode` logs only `device-code login needed, see coord/NEEDS-HUMAN.md` and never the code; a caller can supply its own.
- `msa-login`: the git-tree check also runs on the realpath (junctions, symlinks).
- `g1-driver`: `walkMethod` comes from the scenario (its `method`, else `scenario-protocol walk()`).
- Capture `maxFileBytes` is checked in UTF-8 bytes.
- `npm test` passes 193/193; lint 259.
- **PR #16 review (REQUEST CHANGES) fixed on the same branch:**
  - The default `onMsaCode` is now `quietMsaCodeHandler` in `src/auth-guard.js`. A test feeds it a fake `{user_code, message, ...}` and checks that none of it appears in the output.
  - `initBot` refuses Microsoft auth when `DEBUG` enables `prismarine-auth` (debug-package matching, plus the live `debug` state).
  - `initBot` runs the read-only git-work-tree check (given and real path) on `MINDCRAFT_PROFILES_FOLDER`.
  - New test: offline auth without a folder still starts.
  - The README now says the bot keeps polling until the code expires (about 15 min).
  - `npm test` passes 200/200; lint 259.

## Done: stricter DEBUG guard (branch `agent/net-forge/debug-guard-strict`, from develop 506301d; PR #16 merged)

- Lead decision: refuse when any enabled `DEBUG` pattern starts with `prismarine-auth` (for example `prismarine-auth:*`) or is a glob that could reach such a name. Only a plain prefix skip (`-prismarine-auth*`, `-prismarine*`, `-*`) clears it; `*,-prismarine-auth` is now refused.
- The live `debug` instance is checked under the same rule.
- Tests: the table now has sub-namespace and skip cases, plus a live-instance test with `debug.enable('prismarine-auth:*')`, where `debug.enabled('prismarine-auth')` is false.
- `npm test` passes 203/203; lint 259.

## Done: brief item 8, `agent_process.js` applies the exit-code contract (branch `agent/net-forge/agent-process-restart`, from develop a38e0e2; PR #18 merged)

- `decideAgentExit()` implements the ADR 0003 decision 5 table:
  - 1: restart in-process with backoff (forge-bridge `createRestartPolicy`).
  - 3: end the main process with 3, plus a line for the human.
  - 2 and 4: task codes, as upstream.
  - 0: end with 0 when `MINDCRAFT_SINGLE_BOT_SERVICE=1`; otherwise stay up.
  - A requested stop (SIGINT, SIGTERM, `stop()`) is never restarted, and `stop()` cancels a pending restart.
- New, optional exit-reason file. The agent may write `{category, exitCode, retryCap?}` to `MINDCRAFT_EXIT_REASON_FILE` before it exits. Then a fatal kick is fatal even with exit 1, and auth kicks become fatal at their cap of 3.
- `assertMicrosoftAuthSafe` errors carry `exitCode: 3`.
- **Behaviour change from upstream:** a quick crash (under 10 s) used to be left dead. It is now restarted with backoff, per the ADR. Fatal setup errors need exit 3 to stop that loop (request 9).
- **Tests:** `packages/forge-bridge/test/agent-process.test.js`, 9 tests with a fake spawn, timers and exit. `npm test` passes 212/212. Lint is 257: `agent_process.js` went from 2 errors to 0.

## Done: PR #19 review follow-ups (branch `agent/net-forge/exit-contract-followups`, from develop 976ea48; PR #19 merged)

- **Lead-approved ownership exception:** only the exit lines in `src/agent/agent.js`, plus `src/process/init_agent.js:52`.
  - Invalid name: exit 3.
  - `onDisconnect`: `process.exit(bot.forge.recordExit({event, reason}))`. It writes the reason file and exits with the kick's code.
  - Spawn-handler catch: exits 1, or 3 if fatal; never 0.
  - `cleanKill`: `requested_restart` while still connected. After a kick it reports the kick instead, so kicks keep the backoff.
  - `init_agent.js`: `process.exit(error?.exitCode === 3 ? 3 : 1)`.
- **The contract moved to forge-bridge** (`src/exit-contract.js`): `decideAgentExit`, `readExitReason`, `writeExitReason` and `recordAgentExit`. `initBot` adds `bot.forge.recordExit`.
- **`requested_restart`** restarts at once without touching the backoff. A guard falls back to the backoff after 5 requested restarts in 10 min (my addition, against login loops).
- **Single-bot service:** a requested stop ends the main process with 0. `forceRestart` is never a stop.
- **Findings 3-8:**
  - comment that "connected" is measured from spawn;
  - the reason file sits in a private mkdtemp folder;
  - multi-bot exit-3 orphaning documented;
  - new tests for `forceRestart`, the auth cap and the reset through `AgentProcess`, and stop-then-code;
  - `kicks.js` comment fixed;
  - STATUS test paths fixed.
- **Lint ratchet:** `test/lint-baseline.json` updated to 257 with `node test/tools/lint-baseline.mjs --update` (the same value as lead PR #20).
- `npm test` passes 224/224; the lint ratchet passes (257, baseline 257).

## Done: PR #23 review (REQUEST CHANGES) fixes, on the same branch

1. A `requested_restart` applies the 10-minute reset (`policy.noteSession`) but still adds nothing to the streak. Test: 2 auth kicks, a 5 h session ended by `!restart`, then 1 auth kick gives a 10 s restart, not fatal.
2. Single-bot service: `stop()` while a backoff restart is pending calls `exit(0)`.
3. `readExitReason` ignores files over 4 KB (or not a file), checked with `statSync` before reading.
4. (Nit) The mkdtemp folders are removed when the main process exits. The constructor no longer throws: without a folder, the contract runs on exit codes only.
5. (Nit) The `cleanKill` exit comment in `agent.js` is reworded.
6. New end-to-end test: a real child process classifies a ban and calls `recordAgentExit`, which writes the reason file; `AgentProcess` then calls `exit(3)` with "FATAL (banned)".
7. **Flaky loopback tests.** Under heavy load, a loopback connect on this Windows machine can fail at once with `ETIMEDOUT` (in about 300 ms).
   - forge-bridge: the status ping is now tried twice, 1 s apart. Its timeout is configurable (`FORGE_PING_TIMEOUT_MS`, and `ROTN_DRIVER_PING_TIMEOUT_MS` for the driver).
   - Tests: generous budgets. e2e-initbot gets the pinned mod-list fallback and one login retry. The g1-driver test restarts the driver once if it exits before hello. initbot-auth uses a local hang-up server and accepts a connect error to that port as proof of start.
   - **Load check:** 3 full `npm test` runs at once on this PC. All forge-bridge tests passed in all 3 runs, and the ping retry was used 3 times. Before the fixes the same check failed 2 tests per run.
- `npm test` (single run): 231/231. Lint ratchet: 257, unchanged.

## Done: status-ping budget (branch `agent/net-forge/ping-budget`, from develop e744e44; PR #23 merged)

- Lead's production item: the ping retry could take 15 + 1 + 15 = 31 s, over `spawn_timeout` (30 s). The status ping now has one total budget (`FORGE_PING_TIMEOUT_MS`, default 15 s).
  - Only a fast failure (under 3 s) is retried, once, 1 s later, and only with what is left of the budget. A ping that timed out goes straight to the mod-list file fallback.
  - Fake-clock tests show the total never exceeds the budget.
- `e2e-initbot` asserts `modListSource === 'ping'` again when the first login attempt succeeds. `file` is allowed only after a retried login.
- `npm test` passes 233/233; lint 257, unchanged.

## In review: brief item 4, `bot.registry` extension (PR #25, branch `agent/net-forge/registry-extension`, started from develop 1cbe6a8 after PR #24 merged)

- `extendRegistry(bot.registry, snapshot, {properties})` (`src/registry-extension.js`) runs in `initBot` after the last RegistryData. It covers blocks, items, entities and biomes; block states are `id << 4 | meta`.
  - Modded entries carry full registry names and safe defaults: a solid full cube, diggable, hardness `null`.
  - Vanilla names keep minecraft-data's objects; a moved vanilla id is rebound and dummied entries are skipped.
  - The shared minecraft-data object stays vanilla.
- **Contract for rotn-data:** feed properties keyed by full registry name (`minecraft:stone`, `pyrotech:rock`). Properties cannot rename an entry. See the README section "Registry extension".
- **Tests:** `registry-extension.test.js` (6, with the real prismarine-registry, prismarine-block and prismarine-item). `e2e-initbot` now checks that `blockAt` gives `pyrotech:rock` and that the inventory gives `pyrotech:crude_axe`.
- `npm test` passes 239/239; lint 257, unchanged.

## Batch A result (G1 spec Run A, handshake capture): PASS

The lead's GO was recorded at 15:35 UTC. The batch ran from a clean branch at origin/develop 2abdd3b (`agent/net-forge/g1-batch-a`), with the command exactly as planned, `MINDCRAFT_PROFILES_FOLDER` set, `DEBUG` unset, and a 30-minute TERM guard (`timeout 1800`).

- **Before:** `msa-login.mjs FRCFLD --check` printed `Signed in. Minecraft profile: FRCFLD`, and the test project was empty.
- **Preflight passed on its own:** "sweeper OK (via cadence): 3 dispatch runs on develop in the last 50 min, gaps 14.5, 15.2 min, newest 5.8 min ago". No `--skip-sweeper-check`.
- **Times (UTC):**

  | Event | Time |
  | --- | --- |
  | Command start | 15:36:19 |
  | Server created (CPX42, nbg1, TTL 2 h) | 15:36:30 |
  | Server ready | 15:39:34 |
  | Status ping: FML, 346 mods, jeid 2.2.2 | 15:39:36 |
  | Spike login, handshake done | 15:39:44 |
  | EXIT trap deleted server, Primary IPv4 and SSH key, verified gone | 15:40:14 |

  - Ran 224 s, against an expected ~20 min and a 30 min cap.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. Primary IPv4), against the planned maximum of EUR 0.42 plus IPv4.
- **After (15:40:35 UTC):** `hcloud server list`, `hcloud primary-ip list` and the labelled `ssh-key list` are all empty, and `deploy/test-server.sh list` shows nothing.
- **Handshake, against the real RotN 3.3.4 server:**
  - The client went START, HELLO, WAITINGSERVERDATA, WAITINGSERVERCOMPLETE, PENDINGCOMPLETE, COMPLETE, DONE in 1.1 s.
  - It sent REGISTER, ClientHello, ModList (346) and acks 2, 3, 4 and 5.
  - The server logged "Client attempting to join with 346 mods", "Server side modded connection established" and "FRCFLD ... logged in with entity id 793".
  - It then closed with "Handshake Complete review log file for details". That is `-Dfml.debugNetworkHandshake` by design, not a kick.
  - 0 parse errors, 0 partial reads, `lastKick` null, mod list from the live ping, `overrideDimension` 0.
- **Confirmed on the wire:**
  - Forge 14.23.5.2860 and REID (`jeid`) 2.2.2, from the server's ModList.
  - The live ModList has the same 346 entries as the pinned ping fixture.
  - 52 registries: `minecraft:blocks` 4896 (max id 4895), `items` 9710 (max id 13394), `entities` 971, `biomes` 175, `recipes` 10687. Every RegistryData was read to its last byte.
  - Vanilla block ids are unchanged (`minecraft:stone` = 1).
  - Also received: `FORGE` FluidIdMap (decoded), plus `OBFUSCATE|HS` (5 bytes) and `dimstack` (317 bytes) with no decoder. Run A closes right after them, so whether they need an answer shows only in Batch B.
- **Server-side note for Batch B:** right after login, JustEnoughDimensions' `ServerConnectionFromClientEvent` handler threw "DISPATCHER expects a NetworkDispatcher". It is not a kick, and it may come from the debug-flag connection; Batch B will show whether it also happens normally.
- **Not tested in Batch A:** chunks, slots, entity effects and `jeid` messages (Run A ends before play), and chat, walking and staying connected. Those are Batch B+C.
- **Raw files** stay in `captures/raw/g1-runA/` (capture, summary, registries, server logs, batch log) and are git-ignored.
- **Committed (sanitized):**
  - `packages/forge-bridge/test/fixtures/rotn-3.3.4/handshake-runA.json` (index, 7 KB) and `handshake-runA.bin.br` (all 67 payloads, brotli, 252 KB). No username, UUID or IP, and the SHA-256 is checked.
  - `test/real-handshake.test.js` replays the real server messages through `attachForgeBridge`: the bridge's replies are byte-identical to what it really sent.
- **Batch B+C:** waits for the lead's separate go-ahead.

## Batch B+C result (G1): FAIL, root cause found (Triumph advancements)

The lead's GO was recorded at 15:55 UTC. The batch ran from a clean branch at origin/develop 2abdd3b (`agent/net-forge/g1-batch-bc`), without PR #25, on one server: B = `g1-spike --minutes 11`, then C = `test/runner/run.mjs --scenario g1-login-chat-walk` with `g1-driver.mjs` and default parameters. It had a 55-minute TERM guard.

- **Before:** `msa-login --check` printed FRCFLD, and the project was empty.
- **Preflight:** passed on its own (cadence: 3 dispatch runs, gaps 15.2 and 14.7 min, newest 8 min old).
- **Times (UTC):**

  | Event | Time |
  | --- | --- |
  | Command start | 15:53:19 |
  | Server created (CPX42, nbg1, TTL 2 h) | 15:53:27 |
  | Server ready | 15:56:33 |
  | B start | 15:56:35 |
  | C start | 15:58:25 |
  | C end | 16:01:43 |
  | EXIT trap deleted everything, verified gone | 16:02:09 |

  - Up 522 s, against an expected ~35 min and a 55 min cap.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. Primary IPv4).
- **After (16:02:36 UTC):** server, Primary IP and labelled SSH-key lists all empty.
- **C (gate evidence), `result.json`:** `gateValid: true`, `pass: false`.
  - PASS: `login_online` (online mode, v4 UUID) and `chat_send`.
  - FAIL: `chat_receive`, `walk` and `stay_10min`.
  - **B (spike):** handshake, spawn, outgoing chat and a local 19-block walk worked; incoming chat and the stay failed.
- **Root cause:**
  - The first `play.advancements` packet fails to parse (`unexpected tag end`), and a full parse error makes protodef end nmp's packet stream. No packet arrives after that, so the client keep-alive times out after 60 s and the bot quits. Everything else follows from this.
  - **Why it fails:** RotN's Triumph 3.19.2 `ExtendedDisplayInfo` (confirmed with `javap` on the pack jar in scratch, never run) sets display flag bit 8. It appends optional colours (4 optional ints), an optional boolean, 2 optional line colours, another optional boolean, a count-prefixed list of extra connection ids, and 2 optional positions. minecraft-data's vanilla layout lacks all of these.
  - A hand-written parser with the extension reads both captured packets (42 KB and 50 KB) to the last byte: 150 and 174 advancements, all extended.
- **Also checked on the wire:** REID's VarInt slot id holds for non-empty slots (`set_slot` with modded item 4924, count byte, damage, NBT end).
  - StackUp 0.2.5 (`javap`) writes counts over 64 as `0xD6` plus an int. None appeared, and I have not handled it yet.
  - The bot spawned on `dynamictrees:leaves1`, which develop still treats as empty (PR #25 makes modded blocks solid).
- **The lead's watch items:**
  - **Kicks:** none. Both sessions ended as `client-quit` after the keep-alive timeout.
  - **JustEnoughDimensions error:** 0 occurrences, so it was a Batch A debug-flag artifact.
  - **`OBFUSCATE|HS` (5 zero bytes) and `dimstack` (317 bytes, every login):** neither got an answer, and there was no kick in the 60 s each session lasted, so there is no sign either needs one. The re-run's 10-minute stay is the real check.
- **Evidence:** `test/evidence/g1/batch-bc-20261101/` holds the sanitized `result.json`, `server.log` and `driver.log`, plus a README (the lead-approved exception).
  - Fixture: `packages/forge-bridge/test/fixtures/rotn-3.3.4/advancements-triumph.{json,bin.br}`, the two real packets.
  - Raw files stay in `captures/raw/`.
- **Fix done (lead direction):**
  - With `triumph` in the ModList, `advancements` is an opaque buffer; `triumphTypes()` stays as an offline decoder.
  - Safety net: a parse error in an allowlisted cosmetic packet (advancements, statistics, unlock_recipes and others) is logged and captured in full, and the packet dropped; essential packets still fail loudly.
  - Tests replay the two real packets through nmp's real deserializer stream. `npm test` passes 258/258.
- **Next (superseded):**
  1. A fix PR: a Triumph-aware `advancements` type, gated on ModList `triumph`. Also an unparseable play packet should be dropped and counted rather than ending the stream, and parse-error captures should keep larger packets in full.
  2. Then PR #25's requested changes.
  3. A re-run of B+C needs a new GO.

## Batch B+C retry result (G1): **PASS**

The lead's GO was recorded at 17:05 UTC, after PR #28 merged. The batch ran from a clean branch at origin/develop 62ec6f1 (`agent/net-forge/g1-batch-bc2`), without PR #25, on one server: B = the 11-minute spike, then C = the runner's `g1-login-chat-walk` with `g1-driver.mjs` at default params. It had a 55-minute TERM guard.

- **Before:** `msa-login --check` printed FRCFLD, and the project was empty.
- **Preflight:** passed on its own (cadence: gaps 14.7 and 15.4 min, newest 9 min old).
- **Times (UTC):**

  | Event | Time |
  | --- | --- |
  | Command start | 17:09:50 |
  | Server created (CPX42, nbg1, TTL 2 h) | 17:09:58 |
  | Server ready | 17:12:42 |
  | B | 17:12:44 to 17:23:55 |
  | C | 17:23:55 to 17:34:24 |
  | EXIT trap deleted everything, verified gone | 17:34:44 |

  - Up 1486 s (24.8 min), against an expected ~35 min and a 55 min cap.
- **Cost:** 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. Primary IPv4).
- **After (17:35:19 UTC):** server, Primary IP and labelled SSH-key lists all empty.
- **C, `result.json`:** `pass: true`, `gateValid: true`, `weakenedParams: []`, verdict PASS, 5/5:
  - `login_online`: v4 UUID.
  - `chat_send`.
  - `chat_receive`: token echoed.
  - `walk`: 8.6 blocks, minimum 6.
  - `stay_10min`: 608 s, no disconnects.
- **B (spike):** every check passed: handshake, spawn, chat both ways, a 6-block pathfinder walk, and an 11-minute stay.
- **Advancements opaque:** yes. Triumph 3.19.2 was detected in both sessions, with no advancements parse error.
- **Safety net:** dropped nothing (`droppedPackets` `{}`). The only parse errors were PartialReadErrors, which protodef drops itself. (Corrected: the "(dropped, allowlisted)" log string did not exist yet in that code, so its absence was no evidence.)
- **Kicks:** none (runner `kicks: []`). B ended with its own `disconnect.quitting`. The 17:34:22 "Internal Exception" disconnect is the teardown after `stay_10min` passed (SIGTERM on Windows).
- **`OBFUSCATE|HS` and `dimstack`:** no answer was needed, with no kick over 11 and 10 minutes. The JustEnoughDimensions error occurred 0 times.
- **New finding (not a blocker):** one `entity_metadata` PartialReadError per session (a player's, 77 and 78 bytes), dropped by protodef.
  - Key 17 uses serializer **type 14**, AquaAcrobatics 1.15.4's `PoseSerializer` (an enum as a VarInt ordinal), registered via vanilla `DataSerializers.registerSerializer` (`javap`).
  - base, Charset-Lib, Mowzie's Mobs and Requious Frakto also call that method, so ids from 15 up are unknown.
  - Fixture: `packages/forge-bridge/test/fixtures/rotn-3.3.4/entity-metadata-aqua-pose.json`. The follow-up needs the registration order.
- **Evidence:** `test/evidence/g1/batch-bc2-20261101/` holds the sanitized `result.json`, `server.log` and `driver.log`, plus a README.
  - Raw files stay in `captures/raw/` (`g1-runB2`, `g1-runC2`, `g1-runBC2`, and the driver capture).

## Done: brief item 6, FML EntitySpawn into `bot.entities` (branch `agent/net-forge/fml-entity-spawn`, stacked on PR #25)

- `src/fml-entities.js` `attachFmlEntities(bot, bridge)`, wired in `initBot`'s `onAttach`, turns each FML EntitySpawn into a mineflayer entity and emits `entitySpawn`. Mineflayer's own handlers then track and remove it.
- Names: rotn-data's mod-local entity table when given; until then the placeholder `<modId>:entity_<n>` (`forge.nameKnown: false`), marked TODO(rotn-data).
- Tests: `fml-entities.test.js` (4), plus `e2e-initbot` (spawn into `bot.entities`, then `entity_destroy` removes it).

## Decisions for rotn-data (its requests 2 and 4, relayed by the lead)

- **Request 2, properties after the extension:** use the exported **`applyProperties(registry, properties)`**, not a second `extendRegistry` call. It applies to an already-extended `bot.registry`, keyed by full registry name, updates every map (aliases included), and returns `{ applied, missing }`.
  - **Confirmed:** FML EntitySpawn's `modId` is the mod container id string (`ModContainer.getModId()`, `javap` on Forge 14.23.5.2860's `EntitySpawnMessage`), and `modEntityTypeId` is `EntityRegistration.getModEntityId()`. That is the same pair `EntityRegistry.lookupModSpawn` uses, so key the table by `(modId, modEntityTypeId)`.
- **Request 4, name helpers:** `initBot` sets `mcdata = bot.registry` at login (falling back to `minecraftData()` without one), and again after the extension. No `setRegistry` is needed. This unblocks harness-ops' PR #36 checking names through `mcdata.js`.

## Done: item 3, mod entity-metadata serializers; PR #38 nits (branch `agent/net-forge/metadata-types`, from develop a4720df)

- `METADATA_SERIALIZER_TYPES` holds the wire formats of all 7 mod serializers in RotN 3.3.4, from `javap` on each `write()`. `rotnMetadataSerializers(modList)` gives the proven ids: 14 = AquaAcrobatics pose (by elimination on G1's bytes), 256/257 = DoggyTalents (synced).
  - The real G1 player packet now parses to the last byte.
  - After RegistryData, the bridge checks ids >= 256 against `minecraft:dataserializers`.
- **PR #38 nits:** `entity.kind` is `unknown` when the name is unknown, and the README says the table must give `type` explicitly.
- **Tests (targeted):** `metadata-types` 5, `registry-extension` 15 (`applyProperties` on real data), `fml-entities` 6, `e2e-initbot` (Mindcraft's `getBlockId`/`getItemName` see modded names).

## Done: PR #46 follow-ups (branch `agent/net-forge/apply-properties-hardening`, from #46 head fd27ceb)

- Serializer 14 is worded as inferred by fit, to be confirmed by the dumper (`INFERRED_METADATA_SERIALIZERS`). The bridge logs and captures its first decode, from `entity_metadata` or an FML spawn.
- `applyProperties`: protected fields are stripped (`id`, `name`, `registryName`, `forge`, `minStateId`, `maxStateId`, `defaultState`), and an unextended registry is refused (it requires `entitiesByForgeId`). One old-to-new map per kind, swapped in a single pass; two names for one entry merge.
- Targeted tests: `registry-extension` 17, `metadata-types` 6, `bridge` and `fml-entities` pass.

## Done: g1-driver answers the G2 scenario protocol (branch `agent/net-forge/g2-driver-check`, from develop eedab96)

- **Finding:** the reference driver (`test/runner/drivers/mineflayer-reference.mjs`) uses stock `mineflayer.createBot` without forge-bridge, so a Forge server rejects it at the handshake (its own header calls it the negative control). It also cannot give forge-bridge's names. G2 on the real server needs this driver.
- `g1-driver.mjs` now calls `attachG2(bot, { names })` with `loadAgentNames(repoRoot)`: the same `mcdata.js` module `initBot` used, so `bot.registry` (extended) and `toNew`/`toOld`.
- **Offline test** (`g1-driver.test.js`, against the fake Forge server):
  - census: `minecraft:stone` and `pyrotech:rock`;
  - `blockat`: `0 64 0 pyrotech:rock 3`;
  - `entities`: the FML mob;
  - `items`: slot 36 `minecraft:stone` and `pyrotech:crude_axe`, with translation on.
- **Open for G2:**
  - ~~Modded FML mobs carry placeholder names.~~ Fixed by the mod-entity-table PR (#56), below.
  - The census counts unloaded positions (`bot.blockAt` null) as a `null` type, which the runner fails (see requests).

## Done: rotn-data's mod-local entity table in initBot (G2 prerequisite; branch `agent/net-forge/mod-entity-table`, from develop 437d7ff)

- `fmlEntityTable({ modEntityTable, entityByModId })` builds the bridge's table from rotn-data's catalog API (no file reads). A living entity gets `type`/`category` from rotn-data's `hostile`: `hostile`/`Hostile mobs` or `passive`/`Passive mobs`. A non-living one keeps the `projectile`/`other` rule. `displayName` comes from the dump.
- `initBot` passes it to `attachFmlEntities`. If rotn-data fails to load, it warns and FML mobs keep placeholder names.
- Tests (targeted): `fml-entities` 8, with the real table: `iceandfire:firedragon` passive, `aether_legacy:cockatrice` hostile, a thrown `iceandfire:dragonarrow`, and all 30 modded mobs of `common-mobs.json` with rotn-data's hostility. `e2e-initbot`: through `initBot`, an FML `aether_legacy` #7 becomes `aether_legacy:cockatrice` and `isHostile` is true.

## Done: prismarine-auth patch (lead-approved patch-list addition), XSTS XErr exit 3, no-op error listener

- `patches/prismarine-auth+3.1.1.patch`:
  - `Error refreshing token` (Live and MSA), the Live device-code non-200 and the MSA device-code error now print only status, class and code;
  - XSTS errors carry `err.xerr`;
  - an unknown XErr's message has no response JSON.
- A permanent XSTS XErr exits 3. A listener is always attached (a no-op with `hideErrors`).

## Done: Forge two-pass block-state ids (G2 batch 4; branch `agent/net-forge/double-plant-meta`, from develop 3102f6c)

- Decoding batch 4's capture offline showed that the server really sends `double_plant` upper halves as meta 11: state 2811 at all 3 failed positions in chunk (-3,-4).
  - The cause is Forge's two-pass `BLOCK_STATE_IDS` (`GameData$BlockCallbacks.onAdd`, javap) combined with vanilla `BlockDoublePlant.getStateFromMeta` ignoring the facing bits.
  - Doors, beds and tallgrass round-trip. Details are in the forge-bridge README.
- Lead decision, option 1: the bot reports the meta a real Forge client would see.
  - `attachStateIdRemap` builds `bot.registry.stateIdRemap` from rotn-data's `stateMetaRemap().byBlock` (#80; the 3.3.4 dump has no table yet). `initBot` logs at login whether it is active and how many blocks it covers.
  - The prismarine-chunk patch applies it at chunk load (palette and global data) and in `setBlockStateId`.
- Tests: a sanitized fixture of section (-3,-4) y 64-79, and rotn-data's real catalog API over #80's mini-dump fixture (also through `initBot` in e2e-initbot, so an API-name mismatch fails CI).
- PR #81: REQUEST CHANGES fixed (catalog API name, real-API e2e, login line, two nits). Stacked on #80 until it merges, then rebased onto develop.

## Done: state-id remap cycles (G2 batch 5 review; branch `agent/net-forge/state-remap-cycles`, from develop 01a8193)

- **The bug.** Batch 5 showed "active, 382 state ids in 94 of 132 blocks", with 124 modded entries skipped as "cycle" (pyrotech worktable `0>1, 1>2, 2>0`, animania, twilightforest and others).
  - My builder also resolved chains, which was wrong: network 1 -> client 2 is not network 1 -> client 3.
- **Fix: the table is taken literally** (a pure function), applied exactly once at decode time.
  - prismarine-chunk `load` (palettes, global data).
  - mineflayer `block_change` / `multi_block_change` (new mineflayer patch hunk).
  - `ChunkColumn.setBlockStateId` no longer remaps. Local writes (digging, `update_sign`'s `setBlock`, pathfinder) hold client ids, so a cycle is never applied twice.
- **Only true conflicts are skipped:** one network id with two different targets, from two names resolving to one synced block. They are logged. The login line now has `applied N ...; conflicts C skipped`.
- **Real 3.3.4 table:** all 506 entries apply, with 0 conflicts.

## Done: PR #84 nits (PR #86, merged; branch `agent/net-forge/state-remap-nits`, develop merged in after #84 landed as 18fbed6)

- `state-remap.test.js`: the "same chunk again" comment now says it is a consistency check only (load decodes fresh bytes, so it cannot catch a double remap); the local-write loop is named as the real test.
- README: names the known gap. Other server data with block states (falling-block `spawn_entity` object data, `world_event` 2001, block particles, mod payloads) bypasses the map. Stock mineflayer reads none of them as states today.
- prismarine-chunk patch, `remapGlobalData`: a target too wide for the section is left as sent, counted in `stateIdRemap.skippedTooWide`, and the first one per map is logged. New test.
- Tested: `node --test` on `state-remap.test.js` and `chunk.test.js`, 25/25 pass; ESLint is clean on the test file; the patch reverse-applies cleanly to the installed `node_modules`.

## Done: #86 nits (PR #90, merged; branch `agent/net-forge/remap-readme-status`)

- README: `skippedTooWide` lives on `bot.registry.stateIdRemap` (the live Map), not in the `bot.forge.stateIdRemap` login report.
- This STATUS: the #86 entry no longer says "stacked on #84".

## Done: G2 batch 7 blocker, the movement guard (PR #95, merged as 0bdb537; branch `agent/net-forge/invalid-move-guard`, from develop c3163b1)

- **Batch 7 items kick** (`invalid_player_movement`, about 2.2 s after spawn). Forge 1.12.2 sends it for a movement packet with a non-finite x, y, z, yaw or pitch, or with a coordinate whose absolute value is over 3.0E7.
- **What the capture shows** (items vs. the mobs control):
  - The kick came before the scenario's 10 s settle, so the console `clear`/`give` are not the cause.
  - The driver never moves the bot. The throttle cannot make a NaN.
  - Modded blocks get full-cube shapes.
  - There were 0 parse errors.
  - Effects, inventory and the first self metadata match the control session.
  - **The one difference:** the server set the bot's on-fire flag (metadata key 0 = 1) at +3752 ms, 10 ms before the kick. The control session never shows it.
- **Root cause: not proven.** The capture recorded neither the server's movement inputs (`position`, `explosion`, `entity_velocity`, mounts) nor the bot's movement packets. Its 40-chunk cap missed the bot's own chunk, so physics could not be replayed either.
  - Reproduced offline instead: with mineflayer's real physics, one NaN explosion knockback makes it send `position x NaN`, and the state stays poisoned.
  - An explosion or fire event would fit the on-fire flag, but this is a guess.
- **Fix** (`src/movement-guard.js`, wired in `initBot` under the throttle):
  - sanitize the server's `position` and explosion inputs;
  - repair a poisoned state at every physics tick, and every 250 ms while physics is stalled;
  - drop any movement packet the server would kick for;
  - log each kind once;
  - write a `movement_trace` (the last 80 movement inputs and outputs) to the capture on the first guard event or on a movement kick.
- **What the next items run gives us:** if anything fires, there is one `[forge-bridge] movement guard: ...` line in the driver log, and the capture has `movement_trace` with the input that caused it. No extra capture settings are needed.
- **Tested:** `movement-guard.test.js` (7), `e2e-initbot.test.js` and `support.test.js`: 16/16 pass. ESLint: the new files are clean, and `mcdata.js` stays at its baseline of 11.
- **Review (APPROVE WITH NITS), fixed:**
  - The bot's own `entity_teleport` is sanitized like `position`, and the comment is corrected.
  - Before the first good state, the repair falls back to the server's last absolute position. The (0, 0, 0) placeholder is never used. With no position at all, packets are held back (logged once). This is documented and tested.
  - The tests now show physics resumes: displacement and good packets after every recovery, and 1.5+ blocks in the e2e test.
  - Tested: 19/19 pass (the same three files); ESLint is clean.

## Doing

- **2026-11-03: skills-rotn Request 2** (see the top section).
  - Merged: #149 (encoding tests), #154 (the FastWorkbench window), #155 (the configurable placement wait).
  - Merged too: #161 (the clamp) and #162 (P1's driver commands).
  - Open: the probe contract PR (the reply contract v1 in the README, full names, `checkProbeReply`, the fake RotN test server for end-to-end tests, the `/say` lookalike closed, the unrelated-update test).
  - Next: the GO for P1 is with the lead and the human after both P1 PRs merge. I do not start the batch.
- Historical: **Nothing: paused 2026-11-02** (see "Paused 2026-11-02" at the top). The notes below are historical. #50 and #56 are merged. The PR #54 nit (an explicit `source: 'fallback'` in `g2_adapter`) is in `tools/g1-driver.mjs`.
- G1 PASSED. Phase 2 (G2): #25, #38, #46, #49 and #54 are merged. Open: #50 (PR #31 follow-ups) and #56 (mod-entity table).
- Done in #56 too: serializers 14-18 and 256/257 from rotn-data's second dump (#55), through `loadRotnData(PACK_VERSION).serializers()`. 14 is confirmed, and the inferred-decode logging is removed. `javap` on the seven dumped classes matches every format except Charset's quaternion: the order on the wire is w, x, y, z, not x, y, z, w (same 16 bytes, so it was never misparsed; field names fixed).
- Next: the PR #54 nits: log `g2_adapter source=fallback` explicitly, and assert no `null` census type once harness-ops' census fix lands.

## Next

1. **G1 batches** (below), after the lead's written approval and a scheduled sweeper run within 120 min (PR #12).
2. Captured fixtures: real handshake, RegistryData, `window_items`/`set_slot`, chunks, `entity_effect`, `jeid`. Then the handshake test against real captured server messages; real Run A bytes become extra golden vectors.
3. Classify every kick seen, confirm chunk bits per block and the REID formats on the wire, and record walk blocks.
4. Brief item 6 (FML EntitySpawn into `bot.entities`). Item 8 is done (#19, #23). Item 4 is in review (#25).

## G1 batches (approved by the lead 2026-11-01 11:40 UTC in STATUS-rotn-lead.md; Batch A ran 15:36 UTC, PASS; Batch B+C ran 15:53 UTC, FAIL, see below)

**Approval:** A as written. B as a spike only, not G1 gate evidence. C is the G1 gate evidence: harness-ops' runner (`test/runner/run.mjs` + `test/scenarios/g1/g1-login-chat-walk.mjs`) with a forge-bridge driver per `test/runner/DRIVER.md`, kept in `packages/forge-bridge/`. B and C may share one server run. **Conditions:** one server at a time, in order; `test-server.sh` unchanged with its preflight passing (no `--skip-sweeper-check`); stop and delete past 1.5x the expected time (A: 30 min, B: 53 min); after each batch, confirm `hcloud server list` and `hcloud primary-ip list` are empty and record the real times and cost here; never the live server.

The setup for both batches:

- **Where things run.** Disposable test server only, never the live server. `deploy/test-server.sh` is used unchanged: CPX42 in nbg1 with `--ttl-hours 2`, EUR 0.138/h. Each server is deleted by the `run` EXIT trap, with the watchdog and the sweeper as backup.
- **The bot runs on this PC.** `test-server.sh run` executes the command locally, with `TEST_SERVER_HOST`/`PORT`/`CTL` set. The bot connects from here to the test server's IP.
- **Login cache.** It is set only in this PC's environment: `MINDCRAFT_PROFILES_FOLDER=C:/Users/admin/.mindcraft-rotn/FRCFLD/msa`. Nothing from that folder is uploaded or sent to the test server; the server only checks the session with Mojang as usual.
- **Whitelist.** FRCFLD is in the default whitelist (`ROTN_TEST_WHITELIST` default `FRCFLD JQDAW`), written before the first start.
- **Code.** Batch A runs from this branch: develop 26a0b5e plus the review fixes, with tests passing. Batch B and C run after the driver exists.
- **Before each batch:** `msa-login.mjs FRCFLD --check` must print the profile name. If it asks for a new login, stop and put the request in NEEDS-HUMAN.

1. **Batch A (spec Run A, handshake capture).** Expected about 20 min, so 1 billed hour. Worst case (TTL + 1 h) 3 h, about EUR 0.42, plus Primary IPv4 hours.

   ```bash
   deploy/test-server.sh run --yes --capture --ttl-hours 2 -- bash -c \
     'node packages/forge-bridge/tools/g1-spike.mjs --mode handshake --out captures/raw/g1-runA; s=$?; bash "$TEST_SERVER_CTL" fetch logs --out captures/raw/g1-runA/server; exit $s'
   ```

2. **Batch B+C on one server run.** B is the spike only, not gate evidence: 11 minutes, chat both ways, walk, capture. C is the **G1 gate evidence**: harness-ops' runner with `g1-login-chat-walk` and `g1-driver.mjs`, at the gate parameters (no `--param` overrides).
   - Expected time: about 15 min of server boot, about 13 min for B, and about 13 min for C. That is about 45 min, 1 billed hour, about EUR 0.14. Stop and delete past 68 min (1.5x). Worst case 3 h, about EUR 0.42.

   ```bash
   deploy/test-server.sh run --yes --ttl-hours 2 -- bash -c \
     'node packages/forge-bridge/tools/g1-spike.mjs --minutes 11 --out captures/raw/g1-runB; b=$?;
      node test/runner/run.mjs --scenario g1-login-chat-walk --out captures/raw/g1-runC -- node packages/forge-bridge/tools/g1-driver.mjs; c=$?;
      bash "$TEST_SERVER_CTL" fetch logs --out captures/raw/g1-runBC/server; echo "B=$b C=$c"; exit $c'
   ```

   The runner gives the driver only its allowlisted environment: `TEST_SERVER_HOST`/`PORT`, `MINDCRAFT_PROFILES_FOLDER` and the `ROTN_*` variables. It never gets `TEST_SERVER_CTL` or cloud credentials.

- **Totals:** expected EUR 0.28 for two server runs (A, then B+C); maximum EUR 0.84.
- **Outputs:** raw files stay in `captures/raw/` (git-ignored). Only sanitized excerpts go to `packages/forge-bridge/test/fixtures/` and `test/evidence/g1/`.
- **G1 evidence will claim only:** login, handshake, spawn, chat both ways, walking (with `walkMethod` and block names) and 10+ minutes connected. No reconnect or exit-code claims.

## Blocked

- Nothing (paused). The two G1 lines below are historical: G1 passed.
- Batch A: approved; waiting only for the preflight (a scheduled sweeper run within 120 min; PR #12 in review).
- Batch B+C: approved; the driver is ready (below). Runs after Batch A, with the same preflight condition.

## Requests to other agents or the lead

- **harness-ops: the P1 scenario (#165)**. It must read only the fields of the reply contract, which is now written out in `packages/forge-bridge/README.md`, "Probe P1: commands and reply contract (v1)". The contract PR adds `v: 1` and full registry names (`minecraft:stone_pickaxe`, `minecraft:cobblestone`) in every reply. Two things to use in #165's tests:
  - `checkProbeReply(reply)` from `packages/forge-bridge/tools/probe-commands.mjs`, on the fake driver's replies, so they can only send what the real driver sends;
  - an end-to-end test against the real module: `packages/forge-bridge/test/probe-test-server.js` is a fake RotN test server behind the runner's `console`/`log` interface. `probe-test-server.test.js` shows the real g1-driver started through `driverProcess`; pass the same `server` and adapter to `runScenario(probe, ...)`.
  - The fake server stays in forge-bridge's `test/` (net-forge's). If harness-ops would rather own it, say so in your STATUS and I will hand it over.
  - Note for harness-ops: `probe-test-server.test.js` imports your `test/runner/lib/adapters.mjs` (`driverProcess`, read-only). A change to that adapter's interface breaks this net-forge test; please tell me in STATUS when it changes.
- **Probe plan P1 for the human's GO (Request 2 live proof). Accepted in principle by the lead (2026-11-03). Not started: the lead writes the GO after the driver PR and harness-ops' scenario PR merge.**
  - **What it proves:** the offline tests cannot prove these three things on the real RotN 3.3.4 server:
    1. Serverbound REID: the server accepts `window_click` stacks with VarInt item ids above 4095 (crude axe 9075, rock 8917, Crafting Tools 12510).
    2. FastWorkbench: right-clicking `minecraft:crafting_table` sends FML OpenGui `fastbench`/0, then `window_items`. A 3x3 craft in it works through the synthetic window. The result slot's `set_slot` behaves as `fake-containers.js` assumes.
    3. Placing and eating: `block_place` and `use_item` on 1.12, with the real `block_change` latency. That latency picks the `place_block_timeout_ms` value.
  - **Server:** one disposable CPX42 in nbg1, built from the pinned zip by `deploy/test-server.sh run`, as in G2 batch 8:
    - fixed world seed `1880465901402976865`;
    - `--ttl-hours 2` (the delete-after watchdog; the sweeper preflight must pass, and nothing is skipped);
    - deleted by the EXIT trap.
  - **Lead decisions (2026-11-03):**
    - The plan is accepted in principle.
    - The console `give`/`effect`/`setblock`/`clear` setup steps are allowed **in P1 only**, on the disposable test server, as in S1. P1 is not a gate: `gateValid: false`.
    - The lead writes the GO after both code PRs merge. net-forge never starts the batch.
  - **Code needed first (none of it touches the live server):**
    - **net-forge: done in PR "probe driver"** (`packages/forge-bridge/tools/probe-commands.mjs`). It is wired into `tools/g1-driver.mjs` only when the scenario sets **`ROTN_DRIVER_PROBE=1`**; G1/G2 runs are unchanged. While the probe runs, auto-eat is off (`probe_ready {autoEat:"off"}`).
      - Commands come **only as a console whisper** (`tell FRCFLD probe-...`), which mineflayer reports as a whisper from `Server` (lead, #162 review). The whole whisper text must be the command (anchored). Public chat, players' whispers and anything else are ignored (`probe_ignored` is logged for a player's whisper). TOKEN is 6-32 hex characters, and each token runs once:
        - `probe-craft TOKEN RECIPE_ID [X,Y,Z]`: crafts once with rotn-data's dump recipe (through `convertRecipe`, taking the first variant the inventory covers). X,Y,Z is the crafting table; without it, the 2x2 grid is used.
        - `probe-place TOKEN ITEM X,Y,Z FACE`: holds ITEM and places it against X,Y,Z on FACE (`up|down|north|south|east|west`). The wait is 10 s, `ROTN_DRIVER_PROBE_PLACE_TIMEOUT_MS`, 50-60000.
        - `probe-eat TOKEN ITEM`: `bot.consume`.
      - Answers come one at a time:
        - a `DRIVER {"type":"probe","token":...,"cmd":...,"ok":...}` JSON line with the full result (craft: recipe, variant, result, before/after counts, ms, table block; place: before/after block, `updateMs`, `totalMs`; eat: food and counts before and after);
        - one chat line, at most 200 characters: `probe TOKEN CMD ok|fail k=v ...`.
      - Failures are answered (`ok:false`, `error`), never thrown. Each command has a **60 s time limit** (lead, #162 review): at the limit it is answered `ok:false, timedOut:true`, and a later result is only logged (`probe_late`). The next command waits until the hung one settles, at most 10 s more (then `probe_stuck` is logged and any open window is closed). Each token gets exactly one answer.
      - `probe-place` counts only a block update whose new state is the placed block (`expected`, `otherUpdates`).
      - The recipe ids for P1: `crafttweaker:pyro_crude_axe`, `crafttweaker:crafting_tools`, `crafttweaker:crafting_table`, `crafttweaker:stone_pickaxe` (with the table's X,Y,Z).
    - **harness-ops:** a scenario `test/scenarios/probe/probe-craft-place.mjs`. It sets `ROTN_DRIVER_PROBE=1` for the driver, and it is not a gate: `gateValid: false` always.
  - **Abort on a kick (lead):** if the bot is kicked or disconnected, the run stops and the server is torn down. Nothing reconnects.
    - The g1-driver never reconnects. On a kick it logs a `kicked` event and exits 1 (3 if fatal), following the exit contract (`driver-exit.mjs`).
    - The one relaunch anywhere is the runner's: if the driver exits **before joining** with the profile-fetch failure ("Failed to obtain profile data"), `test/runner/lib/session.mjs` starts it once more (lead, #71). A kick after join, or any second failure, is never retried.
    - harness-ops' scenario must treat a driver exit before the last answer as an abort: send no more commands, record FAIL with the kick reason, and end at once.
    - `run.mjs` then returns, and `deploy/test-server.sh run`'s EXIT trap deletes the server, its Primary IPv4 and its SSH key, so nothing waits for the 2 h TTL.
    - The same applies to a probe step that gets no answer within 120 s.
  - **Evidence redaction (lead):** every file goes through `node test/tools/redact-evidence.mjs IN OUT --bot FRCFLD` before it is committed. That covers `result.json`, `driver.log`, the capture summary and the server log. `node test/tools/redact-evidence.mjs --check test/evidence/probe/` must exit 0 before the evidence PR, and CI's leak check runs over `test/evidence/**` too. The raw capture stays git-ignored under `captures/raw/`.
  - **Scenario steps** (server console on the test server only; no op for the bot):
    1. Log in as in G1. `gamerule doDaylightCycle false`, `time set day`, `tp FRCFLD -45 66 -66` (batch 8's landing spot).
    2. `clear FRCFLD`, then:
       - `give FRCFLD pyrotech:rock 8 0`
       - `give FRCFLD minecraft:stick 6 0`
       - `give FRCFLD minecraft:planks 1 0`
       - `give FRCFLD minecraft:bread 2 0`
       - `give FRCFLD minecraft:cobblestone 8 0`
       - `effect FRCFLD minecraft:hunger 10 10` (food under 20 for the eat step)
    3. `setblock -43 66 -66 minecraft:crafting_table`; check it with `testforblock -43 66 -66 minecraft:crafting_table`.
    4. Run `probe-craft` for each recipe (`tell FRCFLD probe-craft <token> crafttweaker:pyro_crude_axe`, ...; the stone pickaxe with ` -43,66,-66`), and check each with the server's own count (`clear FRCFLD <item> <meta> 0` reports the count without removing anything):
       - `pyrotech:crude_axe` (2x2): crude axe 1, rock 7;
       - `contenttweaker:crafting_tools` (2x2): Crafting Tools 1, crude axe 0;
       - `minecraft:crafting_table` (2x2): table 1, planks 0;
       - `minecraft:stone_pickaxe` at the placed table (3x3): pickaxe 1, rock 3.
    5. `probe-place` 5 times (`probe-place <token> minecraft:cobblestone X,65,Z up`: against the floor block at y 65, so the cobblestone lands at y 66; check it with `testforblock X 66 Z minecraft:cobblestone`): cobblestone on the floor around the bot. Check each with `testforblock`, and record each latency.
    6. `probe-eat <token> minecraft:bread`: bread 1 left, food up (`data get` is not in 1.12, so use the driver's `bot.food` after `update_health`, plus the bread count).
    7. `clear FRCFLD`, then the end.
  - **Pass (for the record, not a gate):**
    - all 4 crafts are confirmed by server counts;
    - the capture has 0 rejected transactions (`accepted: false`);
    - one `mod_window` event with `fastbench`;
    - 5/5 placements confirmed by `testforblock`;
    - food up and bread down by 1.
  - **Commands (PC, after `npm ci` on a clean develop checkout):**
    ```
    deploy/test-server.sh run --yes --ttl-hours 2 --seed 1880465901402976865 -- \
      node test/runner/run.mjs --scenario probe-craft-place --out captures/raw/probe-p1 -- \
        node packages/forge-bridge/tools/g1-driver.mjs
    ```
    It needs no LLM and no OpenRouter key (the g1-driver, not the Mindcraft driver), so `batch.mjs`'s spend stop does not apply. Afterwards, `hcloud server list` and `hcloud primary-ip list` must be empty, as in batch 8.
  - **Evidence:** `test/evidence/probe/p1-<date>/`, redacted with harness-ops' tool. It holds:
    - `result.json`;
    - the driver log;
    - the capture summary: clicks, transactions, `set_slot` around the table craft, and placement latencies;
    - the server log.
  - **Time and cost:** batch 8's build-to-ready was about 3 min, its three scenarios took 15 min, and the server was up 18 min. This probe is one short scenario (about 5 min), so it should be up about 10-15 min and **under 30 min** including the teardown. That is **1 billed hour of CPX42, about EUR 0.14**, plus 1 Primary IPv4-hour. The worst case, a hang until the 2 h TTL, is about EUR 0.28 plus 2 IPv4-hours.
  - **Order:** the driver commands (net-forge PR) and the scenario (harness-ops PR) are reviewed and merged first. Then the human's GO, the batch, and the evidence PR.

- **Lead (`settings.js`, after PR 3 = #155):** please add `place_block_timeout_ms` (#155 reads it in `initBot`; `MINDCRAFT_PLACE_BLOCK_TIMEOUT_MS` wins; default 500, upstream Mindcraft's value). I suggest 2000 for RotN: a successful placement returns as soon as the server's `block_change` arrives, so a longer timeout only delays real failures. The probe's latencies can settle it.

- ~~**rotn-data: the state-id remap table.**~~ Done in #80 (`stateMetaRemap().byBlock`), which `initBot` uses. A dumper 0.2.0 run on the test server is still needed for the real 3.3.4 table; until then the remap is inactive and the login line says so.

- **harness-ops (`test/runner/drivers/scenario-protocol.mjs`):** the `scenario-blocks` census counts positions where `bot.blockAt()` returns null (unloaded chunks) as a type named `null`; the fake world shows `null 0 27489`. On a real server the cube's edge chunks may not be loaded yet, and the runner fails any `null` name. Skip null blocks, or wait for the cube's chunks first.
- **rotn-data:** the mod-local entity table (shape agreed) and `common-mobs.json`. When it exists, `initBot` passes the table to `attachFmlEntities` (a one-line net-forge change).

- ~~**rotn-data (dumper):** dump the `DataSerializers` ids 14 and up.~~ Done in #55, and wired in #56.

0. **rotn-data (shared-registry shape, ADR 0003 decision 4): done.** `initBot` reads rotn-data's `modEntityTable()` and `entityByModId()` (mod-entity-table PR).
   - ~~Export `serializers()` from `index.js`.~~ Not needed: `initBot` uses the exported `loadRotnData(PACK_VERSION).serializers()`.
   - Block/item/entity/biome properties go in keyed by full registry name (`extendRegistry(..., { properties })`, PR #25).
   - A different shape is fine: tell me in your status file.

1. ~~Human: FRCFLD device-code login.~~ Done; verified by the lead and by `--check`.
2. ~~Lead (`settings.js`): `minecraft_version` 1.12.2 and `auth` microsoft.~~ Done since PR #14 (ff9e154).
3. **Lead (`package.json`): accepted.** The lead adds `minecraft-protocol`, `protodef`, `prismarine-nbt`, `lodash.merge` and `prismarine-auth` as direct dependencies, pinned to the lockfile versions, in a lead PR.
4. **Lead (`docs/research/fml-spec.md`): noted for the spec later.** The Forge 14.23.5.2860 layouts confirmed by `javap` are listed at the top of `packages/forge-bridge/test/golden.test.js`.
5. **harness-ops: walk() `method`.** harness-ops adds `method: 'forward+jump+turn'` to `walk()`'s result. `g1-driver.test.js` now accepts the scenario's method when present and the fallback otherwise, so that one line can land on its own.
6. **harness-ops / lead (`TRY_IT.md`, `main.js` docs):** with `auth: "microsoft"` (develop's default), `initBot` now refuses to start without `MINDCRAFT_PROFILES_FOLDER`. Please mention this where the run steps are.
8. ~~skills-rotn (`agent.js` exit lines).~~ Done by net-forge under the lead-approved exception (PR #19 follow-ups).
9. ~~Lead (`init_agent.js` exit 3).~~ Done by net-forge under the same exception.
11. **harness-ops (`test/unit/status-ping.test.js`):** under heavy load (3 `npm test` runs at once), "ping talks to a fake server and reassembles a large, chunked response" failed with an immediate `connect ETIMEDOUT 127.0.0.1:<port>` in 7 of the 9 loaded runs I did today (my changes do not touch that test). The same loopback symptom is fixed in forge-bridge's tests by retrying the connect once after 1 s.
10. **harness-ops (systemd unit `mindcraft-rotn@<bot>`):** set `Environment=MINDCRAFT_SINGLE_BOT_SERVICE=1`, so a clean agent stop ends the main process with 0, and `RestartPreventExitStatus=0 3` (ADR 0003).

## Open PRs

- **2026-11-03 (Request 2):**
  - **#149** merged (`ba07cce`).
  - **#154** merged (`db77934`): the FastWorkbench window.
  - **#155** merged (`0a5347f`): the configurable placement wait. The lead's #160 sets `place_block_timeout_ms: 2000`.
  - **#161** merged: the clamp. **#162** merged: P1's driver commands.
  - **Probe contract PR** (open, `agent/net-forge/probe-contract`): the reply contract v1 and the fake test server (see Requests, harness-ops).
- **At the pause (2026-11-02): none** except this STATUS PR. The lines below are historical; all of those PRs are merged.
- Merged: #15, #16, #18, #19, #23, #24 and #26 (G1 Batch A: real handshake fixture and replay test).
- #25: brief item 4, `bot.registry` extension, on `agent/net-forge/registry-extension`. Being updated for its REQUEST CHANGES review, plus the PR #28 nits.
- #28: G1 Batch B+C FAIL evidence plus the fix (Triumph advancements opaque, parse safety net), on `agent/net-forge/g1-batch-bc`. APPROVE WITH NITS; develop merged in; CI green.
