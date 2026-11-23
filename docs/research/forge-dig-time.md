> Filed by rotn-lead on 2026-11-23 from net-forge's plan for PR #595 (approved as written, sections 3a-3d; 3e deferred). The paths under `/home/rv/` are scratch extracts on the dev server and may be gone.

# net-forge plan: dig time on a Forge 1.12.2 server (from the #593 review)

Author: net-forge, 2026-11-23. Status: **plan only**. There is no branch or PR yet; it waits for the lead's go.

**Sources:** bytecode only, read with `javap -c -p -constants`. No mod code was run.
- Vanilla server classes come from the pinned zip's `minecraft_server.1.12.2.jar`:
  - `or` = PlayerInteractionManager;
  - `pa` = NetHandlerPlayServer;
  - `aed` = EntityPlayer.
- Forge's own binpatches from `forge-1.12.2-14.23.5.2860.jar` were applied to them. The steps:
  - `binpatches.pack.lzma` was decompressed (LZMA), then unpacked with `unpack200`;
  - the GDiff patches were applied by `/home/rv/net-forge-dig/tools/binpatch.py`.
- Forge's own `ForgeHooks` and `ForgeEventFactory` were read directly. Tool Progression, BWM, Quark and the other mods were read from the pinned zip's `mods/`, and their configs from its `config/`.
- Client code: mineflayer 4.33.0 `lib/plugins/digging.js`, prismarine-block 1.23.0 `digTime`/`canHarvest`, mineflayer-pathfinder 2.4.5 (`bestHarvestTool`, `movements.js` dig cost), mineflayer-tool.
- Extracts are under `/home/rv/net-forge-dig/`.

## The problem (#593 review)

mineflayer's `bot.dig` waits `bot.digTime(block)`, which calls prismarine-block's `Block.digTime(heldItemType, …)`. That uses minecraft-data's vanilla 1.12.2 tables:
- the speed is `registry.materials[block.material][itemId]`;
- the harvest check is `block.harvestTools[itemId]`.

Modded tools are in neither table, so they dig at hand speed. For example, `pyrotech:flint_pickaxe` (rotn-data: pickaxe level 1, speed 3.8) on stone (hardness 1.5):

| | Calculation | Result |
|---|---|---|
| Client now | 1 / 1.5 / 100 per tick | 150 ticks = 7.5 s |
| Server | 3.8 / 1.5 / 30 per tick | 12 ticks = 0.6 s |

---

## (1) What does the server do with a STOP_DESTROY that comes early?

### The server's rule (PlayerInteractionManager, after Forge's patch)

**On START_DESTROY** (`onBlockClicked`), the server records `destroyPos` and `initialDamage` (its tick counter). If one tick's progress is already at least 1.0, the block breaks at once.

**On STOP_DESTROY** (`blockRemoving(pos)`), if `pos` is `destroyPos`:

```
f = relHardness(player, block) * (ticksSinceStart + 1)
if (f >= 0.7)                     -> break now (tryHarvestBlock)
else if (!receivedFinishDigging)  -> "delayed destroy": receivedFinishDigging = true,
                                     delayedDestroyPos = pos, initialBlockDamage = initialDamage
(else: the STOP is ignored)
```

**Every server tick** (`updateBlockRemoving`), while a delayed destroy is pending, the server recomputes `f` from `initialBlockDamage`:
- if the block is already air, the delayed destroy is cleared;
- once `f >= 1.0`, the server breaks the block.

So the server finishes an early STOP at its own full time: progress 1.0 counted from the START.

**Forge's patch** keeps this logic. It only changes the air test, from `material == AIR` to `isAir(state, world, pos)`. The `0.7f` constant and the delayed slot are unchanged.

**The handler** (NetHandlerPlayServer, `processPlayerDigging`) answers STOP by calling `blockRemoving(pos)`. Then, if the block is not air, it sends `SPacketBlockChange` with the real block straight away.

### The break speed (Forge)

**`ForgeHooks.blockStrength`:**
- hardness < 0 → 0;
- otherwise `getDigSpeed / hardness / (canHarvestBlock ? 30 : 100)`.

**`ForgeHooks.canHarvestBlock`:**
1. The material needs no tool → true.
2. The held item is empty, or the block has no harvest tool → the vanilla `canHarvestBlock`.
3. The item's level for that tool class is below 0 → the vanilla `canHarvestBlock`.
4. Otherwise, the item's level ≥ the block's harvest level.

**`EntityPlayer.getDigSpeed`**, Forge-patched:
1. Starts from `item.getDestroySpeed(stack, state)`. For a tool (ItemTool), that is its efficiency when one of its tool classes is the block's harvest tool (or the block is in its effective blocks); otherwise it is 1.
2. Efficiency: when the speed is above 1, it adds level² + 1.
3. Haste and mining fatigue.
4. In water without Aqua Affinity, ÷5. Not on the ground, ÷5.
5. Then `ForgeEventFactory.getBreakSpeed`, which posts `PlayerEvent.BreakSpeed`. A cancelled event returns -1, and `getDigSpeed` clamps anything below 0 to **0**. Progress then never grows, so the block never breaks.

### What mineflayer does

`dig()` does the following:
1. Sends START.
2. Waits `bot.digTime(block)`.
3. Sends STOP.
4. Immediately sets the block to air locally (`_updateBlockState(pos, 0)`), which resolves `dig()`.

It never waits for the server to confirm. A later non-air block update from the server is ignored by the dig listener; it only changes the world.

### So: is a shorter client wait safe?

**Down to 0.7 of the server's real time: yes.** The block breaks at the STOP, exactly as now.

**Below 0.7, it fails in ways the bot cannot see:**
- The server sends the real block back at once. `dig()` has already resolved, so the bot sees the block reappear. Then, at the server's full time (progress 1.0, not 0.7), the block breaks.
- **There is only one delayed slot.** If the bot digs a second block early while one delayed break is pending, that STOP is ignored. The second block stays, although its `dig()` also resolved.
- If the server's speed for that block is 0 (the BreakSpeed cancel below), the delayed break never completes. It holds the slot until the block is gone some other way, so every later early STOP is ignored.

**Conclusion:**
- The client should wait the server's time, computed from Forge's rule, and not try to be faster.
- The 0.7 margin allows the client estimate to be up to about 30% short. That covers small data errors and server lag down to about 14 TPS, because the server counts ticks while the client counts milliseconds.

### Today's client is also wrong the other way (too fast or "never")

**29 vanilla blocks have different hardness on this pack.** The dump's default state differs from minecraft-data. Examples:
- `brick_block` 2 → 36, `brick_stairs` 2 → 27;
- `nether_brick` 2 → 41.5, `nether_brick_fence`/`nether_brick_stairs` 2 → 31.125, `red_nether_brick` 2 → 41.5;
- `double_stone_slab` 0 → 41.5, `end_bricks` 0.8 → 52;
- `quartz_block` 0.8 → 2;
- `redstone_ore` 3 → 1, `quartz_ore` 3 → 2.

On the hardened ones the client is far too fast. It falls into the delayed break, or the break is lost when the slot is already taken.

**Vanilla `harvestTools` are wrong for RotN's levels.** For example, the stone pickaxe is level 0 on this pack. When the client thinks it can harvest but Tool Progression says no, the server never breaks the block, yet mineflayer reports success.

**The same `Block.digTime` drives:**
- pathfinder's dig cost (`movements.js`);
- `bot.pathfinder.bestHarvestTool`, which Mindcraft's `equipForBlock` uses;
- mineflayer-tool.

The effects:
- Modded tools are never chosen over the hand.
- Pathfinder plans hand digs through stone at a 7.5 s cost that the server never completes (Tool Progression).

---

## (1b) Which BreakSpeed mods matter early, and how the plan handles them

A byte scan of all 339 jars in the pinned zip's `mods/` for `PlayerEvent$BreakSpeed`, `PlayerEvent$HarvestCheck` and `getPlayerRelativeBlockHardness`/`func_180647_a` overrides found:

| Mod (class) | Effect | On this pack | Early game? | Plan |
|---|---|---|---|---|
| **Tool Progression** (`HarvestEventHandler.onBreakSpeed`) | Cancels BreakSpeed (speed 0, never breaks) when `HarvestHelper.canPlayerHarvestBlock` is false, `prevent_block_destruction` is true, and the block has no "destroyable" overwrite | `prevent_block_destruction=true` (`config/tool_progression/general.cfg:41`). One destroyable overwrite: `cyclicmagic:block_fragile` (`block_overwrites.cfg:135`, `!axe=0`) | **Yes**: stone and ores by hand or with a too-weak tool | Modelled: a block that needs a tool and can't be harvested → `Infinity` |
| BWM `HCStrata` | Speed scaled by depth stratum | `B:HCStrata=false` (`betterwithmods.cfg:516`) | Off | None |
| BWM `HCStumping` | Tree stumps slow, no hand | `B:HCStumping=false` (`betterwithmods.cfg:522`) | Off | None |
| Quark `AxesBreakLeaves` | Axes break leaves faster | `"Axes break leaves"=false` (`quark.cfg:1482`) | Off | None |
| Better With Addons (`AssortedHandler`, `WheatHandler`) | Speed tweaks, not decoded | Not checked | Possibly (wheat/crops) | Not modelled; see risk 1 |
| Inspirations `ToolsEvents` | Tool speed tweaks, not decoded | Not checked | Possibly | Not modelled; see risk 1 |
| OreStages, ZombieAwareness (`ZAEventHandler`) | Staged ores / not decoded | Not checked | Unlikely (no stages expected) | Not modelled |
| Carry On (`ItemEvents`) | No digging while carrying | Situational | No (the bot doesn't carry) | None |
| PotionCore, randomenchants, living_enchantment, Wards, FantasticLib `BlockProtection`, CraftTweaker `MCPlayerBreakSpeedEvent` (none of the 185 files in `scripts/` mentions BreakSpeed), ContentTweaker/Twilight Forest Tinkers traits | Effects, enchantments, protection, scripting hooks | Situational | No (no such enchantments or effects early) | None |
| Aether `PlayerAetherEvents`, Arcane World dungeon dimension | Only in their dimensions | Other dimensions | No | None |

Blocks that override `getPlayerRelativeBlockHardness` (`func_180647_a`) are TF/Redstone++ obsidian variants, an Animania wool block, the HorsePower chopping block, `DynamicTreesPHC` passionfruit vine, MCMultiPart, a Cyclic utility and others. None are early-game blocks the bot digs. Any such block keeps the dump's hardness: the plan has no special case.

**How the plan handles the rest:** a mismatch from a hook that isn't modelled has two outcomes:
- If the server is no more than about 1.43× slower than our estimate, the 0.7 rule still breaks the block at the STOP.
- Otherwise it falls into the delayed break. That is no worse than today's "too fast" cases.

The optional step in (3e) would close this gap fully.

---

## (2) Is `applyProperties` meant to fix this, and why is it not wired in?

**What it is.** `packages/forge-bridge/src/registry-extension.js` `applyProperties(registry, properties)` came with #46 and was hardened in #49. It merges per-name fields into an already-extended `bot.registry`, swapping every map that holds the entry. Its purpose was **rotn-data's Request 2**: rotn-data would build the properties from the dump. Those were, for blocks, `hardness`, `resistance`, `material` (mapped to prismarine strings), `diggable`, `boundingBox` and `harvestTools`; for items, `stackSize` and `maxDurability`; for entities, `type`. The properties come after `extendRegistry` because `harvestTools` needs the server's item ids.

**Why it isn't called.** rotn-data offered to build `properties` and asked net-forge for the exact field set (`coord/STATUS-rotn-data.md`, Requests, item 2). That was never settled, so nothing produces `properties` and `initBot` has nothing to pass. The work went elsewhere:
- collision now comes from `applyCollisionShapes`, fed by rotn-data's `playerCollision`;
- skills-rotn reads the dump directly for digging: `burrow.digRule`, and `walk_exit.toolDigMs` in #593.

**Even fed with data, it can't fix dig time exactly:**
- **Per block, not per state.** prismarine's `digTime` reads `this.hardness`, `this.material` and `this.harvestTools` from the registry entry for the block id. The dump is per metadata.
- **The speed model doesn't fit.** Speed is `registry.materials[material][itemId]`, minecraft-data's vanilla material tables (`rock`, `wood`, `dirt`, …). Forge's rule is "the tool's speed when it has the block's harvest-tool class". To express that we would have to invent material keys (`forge:pickaxe`, …) and put per-item speed tables into a copy of `registry.materials`. `applyProperties` doesn't touch `materials`, and the copy is shared minecraft-data state.
- **It can't say "never".** The worst prismarine can give is the finite ×100 hand time. Tool Progression's cancel needs `Infinity`.
- **Side effects.** It would rewrite `material` and `harvestTools` on vanilla blocks, which other code reads (`mcdata.getBlockTool` takes `Object.keys(block.harvestTools)[0]`, and `burrow.js`/`pit.js` comments rely on today's values).

**Verdict:** `applyProperties` was meant for this kind of data, but it can't express this rule. It stays as it is, unused.

---

## (3) The smallest safe fix

### (3a) The rule

New file `packages/forge-bridge/src/dig-time.js`, with a pure function `forgeDigTime(state, tool, mods)`.

**Inputs:**
- `state`: the dump's block state, `{ hardness, harvestTool, harvestLevel, toolRequired }`;
- `tool`: `{ classes: {cls: level}, speed: {cls: speed} }`, or `null` for the hand or a non-tool;
- `mods`: `{ enchantments, effects, notOnGround, inWater (always false, as mineflayer passes) }`.

**Steps:**
```
if hardness < 0                                    -> Infinity
level    = tool?.classes[harvestTool]   (integer >= 0, else none)
canHarvest = !toolRequired || (level != none && level >= max(0, harvestLevel))
if toolRequired && !canHarvest                     -> Infinity   (Tool Progression cancel)
speed    = level != none ? (tool.speed[harvestTool] ?? 1) : 1
efficiency: if speed > 1, speed += lvl^2 + 1
haste x(1 + 0.2*lvl); mining fatigue as prismarine; not on ground /5
delta    = speed / hardness / (canHarvest ? 30 : 100)
delta >= 1 -> 0 ms; hardness 0 -> 0 ms; else ceil(1/delta) * 50 ms
```

This matches skills-rotn's `toolDigMs` (#593), except that it rounds up to whole ticks.

**Items with no tool classes in rotn-data** (swords, shears, any non-tool, and the 16 late-game tools that have classes but no speed):
- **Swords, shears, non-tools.** For them Forge's `getDestroySpeed` is the item's own vanilla rule: a sword on web is 15 and on leaves/plants 1.5; shears on web/leaves 15 and on wool 5. So the speed comes from prismarine's vanilla material table when it lists that item for the block, else 1. Hardness and the harvest rule come from the dump.
- **The 16 late-game tools** use speed 1, which is slower and so safe.

**Falls back to prismarine's original `digTime`** when the dump has no state for the block (an unknown block), and in creative mode.

### (3b) Installing it

`attachDigTime(bot, { stateOf(block), toolOf(itemType), log })`:
- **Where it applies.** mineflayer's world builds blocks with prismarine-chunk's own `Block` class, which is created for `bot.registry`. On the first block seen, `attachDigTime` takes that class's prototype and replaces `digTime`. It keeps the original for the fallback. A symbol on the prototype makes a second call do nothing.
- **What it reaches.** That one change covers `bot.digTime` (and so `bot.dig`), pathfinder's dig cost and `bestHarvestTool`, and mineflayer-tool.
- **What it leaves alone.** No patch file and no registry maps change. Only this bot's class changes: the shared minecraft-data and any other `Block` class are untouched.
- **Return value:** a small report `{ installed, fallbacks }`, so unknown blocks can be counted and logged once each.

### (3c) Wiring in `initBot` (net-forge's part of `src/utils/mcdata.js`)

About 8 lines in the `registries` handler, right after `applyCollisionShapes`, inside a `try`:
- `stateOf` uses rotn-data's `getBlock(registryName)` and picks the state for `block.metadata`. The registry name comes from `block.registryName`, or `minecraft:` + name for vanilla.
- `toolOf` uses `getItem(registryName)` → `{ classes: toolClasses, speed }`.
- **On failure** it logs a `[forge-bridge]` warning and the vanilla `digTime` stays. rotn-data is already required (#555), so the data is always there.

### (3d) Data and coordination with rotn-data

No new fields are needed: the dump already has `hardness`, `material`, `harvestTool`, `harvestLevel` and `toolRequired` per state, and `toolClasses` and `speed` per item. I'll ask rotn-data, through the lead, to check two things:
1. **Do Tool Progression's block overwrites show in the dump?**
   - `config/tool_progression/block_overwrites.cfg` has 445 entries; `BlockOverwrite.apply(state)` sets the block's harvest level at runtime.
   - But `minecraft:redstone_ore` is `pickaxe=1` in the cfg and level 2 in the dump. That may be meta or lit-ore keying, or a dump read before `apply`.
   - If the dump's level is too high, the rule says "never" (`Infinity`) for a tool that can break the block. That is conservative, but wrong.
2. **The 16 tools with classes but no speed** (deferred by the lead) use speed 1 until filled.

### (3e) Optional second step (the lead's call; not in this PR)

A mineflayer patch (mineflayer is on net-forge's patch list): `dig()` would resolve when the server sends air, with a time limit, instead of on the local air prediction. A block the server sends back would then count as "not broken yet".
- This closes the remaining gap: server lag, unmodelled BreakSpeed hooks, and blocks whose hardness depends on the world.
- It changes when `dig()` resolves or fails, which affects collectblock and skills. That is why it is a separate decision.

---

## Risks

1. **Unmodelled BreakSpeed hooks** (Better With Addons, Inspirations, not decoded; see 1b): the client may be off. If the server is at most about 1.43× slower, the block still breaks at the STOP; otherwise the delayed break. No worse than today.
2. **Hardness that depends on the world.** Blocks that compute hardness from world or position have one value per state in the dump. Dynamic Trees branches might vary with thickness; not checked. A short estimate → the delayed break.
3. **Behaviour change for skills-rotn** (to be stated in the PR body):
   - Digs with real tools become 5–12× faster.
   - Pathfinder will dig through stone with a pickaxe more readily.
   - Pathfinder will refuse hand digs of blocks that need a tool (cost `Infinity`).
   - `bot.dig` throws `dig time for … is Infinity` instead of silently not breaking the block.
   - `bestHarvestTool` and `equipForBlock` will now pick modded tools.
   - skills-rotn's own `toolDigMs` stays; whether it switches to `bot.digTime` is their call.
4. **Replacing a method on prismarine-chunk's `Block` class.** It is scoped to this bot's class, and a test checks that other classes are untouched. If a later mineflayer builds blocks some other way, the install finds no block and logs that it didn't install; the vanilla behaviour stays.
5. **Tool Progression levels in the dump** (3d item 1): a wrong `Infinity` when the dump's level is too high.
6. **Server lag below about 14 TPS** while digging → the delayed break (3e would cover it).

## Tests (offline, `node --test`, no server)

All in `packages/forge-bridge/test/dig-time.test.js`, using the real 1.12.2 prismarine registry and the real rotn-data 3.3.4 dump:

**1. The rule** (`forgeDigTime`):

| Case | Expected |
|---|---|
| `pyrotech:flint_pickaxe` on stone | 600 ms (12 ticks) |
| Stone pickaxe on stone | 600 ms |
| Wooden pickaxe on stone | 1150 ms |
| Hand on stone | `Infinity` (Tool Progression) |
| Hand on an oak log | 3000 ms (needs no tool) |
| `brick_block` with a stone pickaxe | Uses hardness 36 |
| Not on the ground | ×5 |
| Efficiency | As vanilla |
| Haste | As vanilla |
| Hardness -1 | `Infinity` |
| Hardness 0 | 0 |
| Sword on web, shears on leaves | Vanilla item speeds |

**2. Regression check:** every vanilla tool × vanilla block where the dump's hardness and harvest rule match minecraft-data gives the same ms as prismarine's original. The differences are listed and are exactly the pack changes: the 29 hardness changes and RotN's levels.

**3. Install:**
- **Fallback:** an unknown block falls back to the original.
- **Real chunk:** a real prismarine-chunk column on a registry extended with `extendRegistry` (existing registry-extension fixtures). Its blocks get the new time, and the following work through it:
  - mineflayer's real `bot.digTime`;
  - pathfinder's `bestHarvestTool`, which picks the flint pickaxe over the hand;
  - a pathfinder dig cost through stone by hand, which is `Infinity`.
- **Idempotent:** a second install does nothing.
- **Isolation:** a fresh `require('prismarine-block')('1.12.2')` block still has the vanilla `digTime`.
- **Failure:** an install failure only warns.

**4. `initBot` wiring** (as in `initbot-rotn-data.test.js`): the install runs in the `registries` handler after the collision shapes, and a throwing `stateOf` leaves the vanilla `digTime` with a warning.

**5. Mutation checks**, each failing a test:
- no `Infinity` for the Tool Progression case;
- the hand-speed fallback for modded tools;
- ×100 instead of ×30 when the tool can harvest;
- installing on the shared class.

**6. Before the PR:**
- the full `npm test` patterns (`packages/*/test/**/*.test.js`, `test/unit/**/*.test.js`, `src/**/*.test.js`);
- the lint baseline (249);
- no `npm ci` needed (no patch changes).

**Live check (later, harness-ops, on a disposable test server):** a timed dig of a stone block with the flint pickaxe takes about 0.6 s and the block is gone on the server. That is for a soak or harness step, not part of this PR.

## PR scope

- **Branch:** `agent/net-forge/forge-dig-time`, from `origin/develop`. One small PR, no STATUS edits.
- **Files:**
  - new `packages/forge-bridge/src/dig-time.js`;
  - an export in `packages/forge-bridge/index.js`;
  - new `packages/forge-bridge/test/dig-time.test.js`;
  - about 8 lines in `initBot` (`src/utils/mcdata.js`, net-forge's part);
  - a `packages/forge-bridge/README.md` section (the rule, the server's 0.7 rule, the risks).
- **Folded in, because the README is touched** (the #576 nits, no separate PR):
  1. README about line 335: the cancel "waits until the appended collect finishes or its full cancelTimeout";
  2. README about line 563: drop "Both fail against #570's version.";
  3. `collectblock-patch.test.js` about line 304: comment that the hook sends 12 ticks per `physicsTick` subscription.
- **Not touched:** `patches/`, `package.json` and the lockfile, `test/`, `src/agent/`, rotn-data.
