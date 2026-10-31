# Seam map: Mindcraft vanilla-1.21 assumptions vs Minecraft 1.12.2 Forge + RotN 3.3.2

- Source: `mindcraft-cartographer` subagent, 2026-10-31, filed by rotn-lead. Input, not a decision.
- Caveat: `node_modules` was not installed and there is no `package-lock.json`, so all dependency versions are declared ranges. Items tagged **[verify]** come from general knowledge of minecraft-data/mineflayer, not from this repo; check them against the dumper output or `pc/1.12` data.

Owners: **NF** = net-forge, **RD** = rotn-data, **SK** = skills-rotn. Paths are relative to the repo root; line numbers are exact for code the cartographer read.

## A. How the Minecraft version is chosen, and the minecraft-data features it depends on

**Version path**

- `settings.js` L2 sets `"minecraft_version": "auto"`.
- `src/mindcraft/mindcraft.js` L48-56 calls `getServer(host, port, version)`.
  - `src/mindcraft/mcserver.js` L21 pings the server.
  - L33-39 pull `\d+\.\d+(\.\d+)?` out of the ping's version name.
  - L143-149 reject the server if the version is not in `mc.supportedVersions`, or if it differs from a non-auto setting.
  - On failure, `mindcraft.js` L52-57 warns and carries on with "auto".
- `src/utils/mcdata.js` L11 does `let mc_version = settings.minecraft_version` at module load, using `src/agent/settings.js`.
  - That module is an empty `{}` (L2) until `setSettings` runs in `src/agent/mindserver_proxy.js` L93.
  - That call happens after `connect()`, which is after `init_agent.js` L1 has imported Agent, which imports mcdata (`agent.js` L6).
  - So `mc_version` is `undefined` when `initBot` runs.
  - `mcdata.js` L64-66 then deletes `options.version`, and mineflayer auto-detects from the ping.
  - Net effect: a configured `"1.12.2"` never reaches `createBot`. It only affects the `getServer` check and the UI texture lookup (`mindserver.js` L64-67, fallback `'1.21.8'`).
  - This is inferred from import order. **[verify at runtime]**
- After `login`, `mcdata.js` L126-130 sets `mcdata = minecraftData(bot.version)` and `Item = prismarine_items(bot.version)`.
  - Every helper in `mcdata.js` L156-362 reads this private instance, not `bot.registry`.
  - Registry extension at login by net-forge will not be seen by those helpers unless the objects are shared. This is a design decision to settle with rotn-data.

**minecraft-data features that are missing or different on 1.12, and who calls them**

- Flattened names through `itemsByName` / `blocksByName` (`mcdata.js` L156-186). Callers: `commands/index.js` L164-168, `world.js` L95/L138/L349, `skills.js` L1080.
- Block state properties (`block._properties`): `skills.js` L1531, plus the pathfinder patch (see the patches section).
- Recipes keyed by result id (`mcdata.js` L246-282). Callers: `skills.js` L47/L85, `npc/item_goal.js` L207, `queries.js` L300 via `getDetailedCraftingPlan`.
- `block.drops` (`mcdata.js` L331-340). Callers: `item_goal.js` L225, `world.js` L28.
- `harvestTools` and `canHarvest` (`mcdata.js` L356-362). Callers: `skills.js` L490, L595, L1208.
- Entity metadata indexes. In 1.21, baby is index 16. In 1.12, baby is index 12 and villager profession is index 13. **[verify]**
- `mcdata.biomes` (`world.js` L430).

## B. Seam table

| File | Lines | Assumption | Why it breaks on 1.12.2/RotN | Owner |
|---|---|---|---|---|
| `src/utils/mcdata.js` | 56-68 | `createBot` with plain vanilla login; `auth` from settings (default `"offline"`, `settings.js` L5) | No FML handshake, so Forge kicks vanilla clients. RotN needs `microsoft` auth. No per-bot token cache or profiles folder option. | NF |
| `src/utils/mcdata.js` | 11, 64-66 | Version from `settings.minecraft_version` | `mc_version` is undefined at call time (section A), so the version is always auto-detected from the ping. Pin `1.12.2` explicitly. | NF |
| `src/utils/mcdata.js` | 70-98 | Throttles `position`/`position_look`/`look` writes to 50 ms | If a packet is pending, later ones are dropped (L82-89 returns without updating). The comment says "never lost" but the oldest packet is sent. This can cause rubberbanding on a 1.12 modded server with movement checks. | NF |
| `src/utils/mcdata.js` | 104-115 | Swallows every `error` event whose message contains `PartialReadError` | On Forge, unparsed FML or mod packets are the likely failure. Swallowing hides handshake and registry problems and can drop mod packets silently. | NF |
| `src/utils/mcdata.js` | 117-124 | Loads pathfinder, pvp, collectblock, auto-eat, armor-manager, then accepts any resource pack | RotN may offer a resource pack. Accepting is probably fine. Plugin support is covered in the dependencies table. | NF |
| `src/utils/mcdata.js` | 126-130 | `mcdata`/`Item` from `bot.version` only | No modded IDs. `getItemId`/`getBlockId` return null for modded names, so commands reject them. | NF + RD |
| `src/utils/mcdata.js` | 20-52 | `WOOD_TYPES` (incl. mangrove, cherry), `MATCHING_WOOD_BLOCKS`, `WOOL_COLORS` build names like `oak_log`, `oak_door`, `white_wool` | 1.12 has `log`/`log2`, `planks`, `wool`, `wooden_door`, `wooden_slab`, `wooden_button`, `wooden_pressure_plate` as base names with metadata, not prefixes. mangrove and cherry do not exist. `light_gray` is `silver` in 1.12. **[verify]** Consumers: `npc/utils.js` L5-69. | RD |
| `src/utils/mcdata.js` | 135-139 | `isHuntable`: `!mob.metadata[16]` means not baby | Baby flag is index 12 in 1.12, so babies are hunted. **[verify]** | RD/SK |
| `src/utils/mcdata.js` | 141-144 | `isHostile`: `type` is `mob`/`hostile`, excluding `iron_golem`/`snow_golem`; returns false when `mob.name` is falsy | 1.12 internal names are `villager_golem` and `snowman` **[verify]**, so golems get attacked. Modded mobs have no registry name and are never hostile. RotN invasions are invisible to reflexes. | RD + NF |
| `src/utils/mcdata.js` | 147-154 | `mustCollectManually` uses `short_grass`, `sugar_cane`, `kelp`, `bamboo`, `lantern`, `vines` | 1.12 uses `tallgrass`, `reeds`, `double_plant`, `vine`, etc. Manual-collect crops are handled by the wrong path. | RD |
| `src/utils/mcdata.js` | 156-194 | Name-to-id lookups via `itemsByName`/`blocksByName`/`entitiesByName` | Flattened names do not resolve. Metadata variants (`log:0`) and `modid:item` are not modelled. | RD |
| `src/utils/mcdata.js` | 196-244 | `getAllItems/Blocks` iterate `mcdata.items/blocks` | Modded blocks and items are absent. `world.js` L132 uses this list for `findBlocks`, so unknown blocks are invisible to `!nearbyBlocks`. | RD |
| `src/utils/mcdata.js` | 246-282 | `getItemCraftingRecipes` reads `mcdata.recipes[itemId]`, and `getItemName(ingredient)` takes a bare id | Vanilla recipes only. RotN rewrites recipes (crude axe, rocks to cobblestone). 1.12 recipe ingredients may be `{id, metadata}` objects, which silently drop out at L262-263 **[verify]**. Returns `null` for unknown items. `commonItems` (L274) uses `oak_planks`/`oak_log`. | RD |
| `src/utils/mcdata.js` | 284-287 | `isSmeltable`: name contains `raw` or `log`, or is in a list incl. `cod`, `salmon`, `tropical_fish`, `kelp` | 1.12 has no `raw_iron`. Ore items are `iron_ore`/`gold_ore`, so smelting ore is refused at `skills.js` L154-157. Fish are `fish` with metadata. | RD |
| `src/utils/mcdata.js` | 289-311 | Fuel: `charcoal`, `blaze_rod`, `coal_block`, `lava_bucket`; output ratios hard-coded | In 1.12 charcoal is `coal` with metadata 1, so `charcoal` never matches. RotN may alter fuel values. | RD |
| `src/utils/mcdata.js` | 313-329, 342-354 | Smelting and animal-source maps use `raw_beef`, `steak`, `raw_iron`, `copper_ingot`, `dried_kelp`, `raw_cod` | 1.12: `beef`/`cooked_beef`, `iron_ore`, `fish`/`cooked_fish`, no copper. Many modded foods are unmapped. | RD |
| `src/utils/mcdata.js` | 331-340, 356-362 | `block.drops` and `harvestTools` from vanilla data | RotN changed harvest and drop rules (rocks, crude axe). Modded blocks have no data. `getBlockTool` returns null. | RD |
| `src/utils/mcdata.js` | 364-366 | `makeItem` is `new Item(id, amount)` with no metadata | Cannot create `log:1` or other metadata variants. Only used in creative paths. | RD |
| `src/utils/mcdata.js` | 417-458 | `loopingItems` lists 1.20+ items such as `*_armor_trim_smithing_template` | Dead data on 1.12. Harmless but misleading. | RD |
| `src/utils/mcdata.js` | 464-572 | `getDetailedCraftingPlan` built on the vanilla recipe helper | Gives wrong plans for RotN. Outputs `oak_*` names. | RD |
| `src/agent/library/world.js` | 17, 28 | `block.name == 'air'`; L28 has `!top.name == 'air'` (always false, upstream bug) and uses `bottom.drops.length == 0` as a "solid" test | Modded blocks have no `drops` data, so free-space detection is unreliable for placing tables and furnaces. | SK |
| `src/agent/library/world.js` | 90, 132 | `['air','cave_air']`; `getAllBlockIds(['air'])` | `cave_air` does not exist in 1.12 (harmless). The block-id list excludes modded ids. | SK + RD |
| `src/agent/library/world.js` | 217-259 | `getVillagerProfession` uses 1.14+ metadata `[18]` and a 15-entry profession table | In 1.12 profession is index 13, with 0-5 vanilla ids, and RotN may add professions. **[verify]** | SK |
| `src/agent/library/world.js` | 285-309 | `getCraftableItems` loops all items with `bot.recipesFor` | Vanilla recipes. Cost grows with item count if modded items are added. | RD/SK |
| `src/agent/library/world.js` | 397-404 | `isClearPath` runs `getPathTo(..., 100)` | This runs inside modes (`modes.js` L148, L164, L180, L201), every 300 ms tick. CPU-heavy on a CX23 during invasions. | SK |
| `src/agent/library/world.js` | 406-419 | `shouldPlaceTorch` looks for `torch` and `wall_torch` | 1.12 has only `torch` (metadata gives facing). Light level is "broken" per the L408 TODO. RotN deadly darkness needs real light logic. | SK |
| `src/agent/library/world.js` | 421-431 | `mc.getAllBiomes()[biomeId].name` | An unknown biome id throws a TypeError. Reached from `!stats` (unblockable, `commands/index.js` L18) and `full_state.js` L69. | SK + RD |
| `src/agent/library/skills.js` | 36-115 `craftRecipe` | Crafting uses vanilla recipes from `bot.recipesFor`; L47 calls `.length` on a result that can be `null`; L67-68 dereferences a possibly-undefined free-space position | RotN recipes are not known to mineflayer, so the server rejects crafts. `getItemCraftingRecipes` returns null for unknown names, which throws a TypeError. Modded crafting stations are unsupported. | RD + SK |
| `src/agent/library/skills.js` | 142-273 `smeltItem` | Searches `'furnace'` (L162, L169, L283); relies on `isSmeltable` | 1.12 has separate `lit_furnace` while burning, so a burning furnace is not found. Ores are refused (see the `isSmeltable` row). RotN may change furnaces. | SK + RD |
| `src/agent/commands/actions.js` | 284-291 | `!smeltItem` calls `agent.cleanKill('Safely restarting...')` after success | Each smelt kills the process. The parent restarts it, so every smelt triggers a full Forge login plus FML handshake. | SK |
| `src/agent/library/skills.js` | 313-332, 324 | `attackNearest` matches `entity.name === mobType`; pauses self_preservation for `drowned`, `cod`, etc. | Modded mob names are undefined or unknown. 1.13 mobs do not exist. | SK |
| `src/agent/library/skills.js` | 370-413 `defendSelf` | Hostile test and `bot.pvp`; `phantom` special case (L385) | pvp is fine for 1.9 combat, but modded hostiles are not recognised (see the `isHostile` row). | SK |
| `src/agent/library/skills.js` | 417-529 `collectBlock` | L433-440 aliasing: `coal`→`coal_ore`, `*ore`→`deepslate_*ore`, `dirt`→`grass_block`, `cobblestone`→`stone` | `deepslate_` and `grass_block` do not exist in 1.12 (`grass`). In RotN, breaking `stone` does not yield cobblestone (rocks, 4 to 1). L441/L466 use `block.metadata === 0` with `water`/`lava`, but 1.12 also has `flowing_water`/`flowing_lava`. | SK + RD |
| `src/agent/library/skills.js` | 480, 490, 506 | `bot.tool.equipForBlock`, `block.canHarvest(itemId)`, `bot.collectBlock.collect` | These depend on vanilla hardness and harvest data. RotN changes both (PLAN gap 7), so digs hang or mis-select tools. `bot.tool` comes from mineflayer-tool, a transitive dependency of collectblock and not in package.json. | RD + SK |
| `src/agent/library/skills.js` | 561-608 `breakBlockAt` | `'water'`/`'lava'` names; cheat branch `/setblock x y z air` (L576-582) | Flowing variants are missed. Cheat mode needs op, and agents have no op. | SK |
| `src/agent/library/skills.js` | 634-680 `placeBlock` cheat | 1.13+ block-state syntax `[facing=...]`, `[half=upper]`, `[part=head]` | These are invalid in 1.12. The bed branch at L675-677 is also missing braces after `if`. Needs op regardless. Remove or disable. | SK |
| `src/agent/library/skills.js` | 702, 706 | `empty_blocks` includes `'grass'`, `'short_grass'`, `'tall_grass'`, `'fern'`, `'snow'`; `grass_block` | In 1.12 `grass` is the grass block itself. Grass ground is treated as empty at L707 and as non-solid at L742, so placing a table, furnace or torch on grass fails with "nothing to place on". Real 1.12 names are `tallgrass`, `double_plant`, `snow_layer`, `deadbush`. **[verify]** | SK + RD |
| `src/agent/library/skills.js` | 780 | `bot.placeBlock` then wait for `blockUpdate` | The mineflayer patch cuts that wait from 5000 ms to 500 ms. On a lagging modded server, placements will report failure while the block is actually placed. | NF |
| `src/agent/library/skills.js` | 791-836 `equip` | Slot chosen by `leggings`/`boots`/`helmet`/`chestplate`/`elytra`/`shield` substrings | Fine for vanilla 1.12. Modded armor and tools are not recognised unless their names match. | SK |
| `src/agent/library/skills.js` | 1198-1202, 1308-1311, 1411-1419 | Cheat-mode `/tp @s x y z` and `/tp @s player` | `@s` was added in 1.13. Cheat mode needs op. | SK |
| `src/agent/library/skills.js` | 1499-1541 `useDoor` | L1510-1511 door names (`oak_door` ... `bamboo_door`, `crimson_door`); L1512 `.position` on a possibly-null block; L1531 `door_block._properties.open` | 1.12 uses `wooden_door`, `spruce_door`, etc. `_properties` is probably undefined (open is a metadata bit). **[verify]** Throws. | SK |
| `src/agent/library/skills.js` | 1543-1573 `goToBed` | `block.name.includes('bed')`, `bot.sleep(bed)` unguarded | Sleeping fails during the day (and under any RotN sleep or invasion rule) and throws. L1553 `block.name.includes` also throws on unknown modded blocks with no name. | SK |
| `src/agent/library/skills.js` | 1575-1650 `tillAndSow` | `grass_block`, `diamond_hoe` fallback, `wheat_seeds`; cheat farmland | `grass_block` vs `grass`. RotN farming rules are unknown. | SK |
| `src/agent/library/skills.js` | 1692, 1713 | Villager baby check `metadata[16]` | 1.12 baby index is 12. **[verify]** Whether `bot.openVillager` works on 1.12 is also unverified. L1887-1896 uses the `ench` NBT key, which is 1.12-correct. | SK |
| `src/agent/library/skills.js` | 1927-1936, 1963-1980 | `digDown` water/lava names; `goToSurface` scans y from 360 to -64 | 1.12 height is 0-255, so the loop wastes iterations. Flowing liquid names are missed. | SK |
| `src/agent/commands/actions.js` | 118-124, 130-131, 146 | y domain `[-64, 320]`; search ranges up to 512 | Superset of 1.12's 0-255. The server loads chunks only within view distance, so far searches are useless. | SK |
| `src/agent/commands/actions.js` | 256-276, 302-309 | `!collectBlocks`, `!craftRecipe`, `!placeHere` use `BlockName`/`ItemName` types | Validation goes through vanilla `getBlockId`/`getItemId` (`commands/index.js` L133-169), so modded and old names are rejected. This is the translation point (`!lookup` in PLAN). | SK + RD |
| `src/agent/commands/actions.js` | 346-362 | `!setMode` can turn on `cheat` | The LLM can switch on `/tp`/`/setblock` chat spam on a server where the bot has no op. Block `cheat` for RotN. | SK |
| `src/agent/commands/actions.js` | 363-385 | `!goal`/`!endGoal` start and stop the self-prompter | This is the hook for the agenda, but it is a free-text goal only (see the `self_prompter` row). | SK |
| `src/agent/commands/queries.js` | 27, 40-46 | `!stats` biome lookup; Morning/Afternoon/Night by `timeOfDay` <6000, <12000 | Biome can throw (see the `world.js` biome row). The labels do not reflect RotN danger windows (darkness, invasions). | SK |
| `src/agent/commands/queries.js` | 104-130, 147-213 | `!nearbyBlocks`, `!entities` read names directly | Modded blocks and entities print as `undefined` or are dropped. L180 uses villager `metadata[16]`. | SK + RD |
| `src/agent/commands/queries.js` | 311-339 | `!searchWiki` fetches `https://minecraft.wiki/w/<query>` | It returns vanilla 1.21 information, which is wrong for RotN. | SK |
| `src/agent/modes.js` | 31, 38, 44 | `self_preservation`: `fall_blocks` substring match, `blockAbove.name === 'water'`, `.includes` on the name | No oxygen check, no eating, no darkness response. Flowing water is missed. L44 throws if a modded block has no name (see open question 4). | SK |
| `src/agent/modes.js` | 49-84 | Lava/fire escape and low-health flee | Only `lava`/`fire` by name. No AggroTP or invasion handling. | SK |
| `src/agent/modes.js` | 141-186, 278 | `cowardice` (default off), `self_defense`, `hunting`, `idle_staring` use `isHostile`/`isHuntable` and `metadata[16]` | Modded mobs are not detected. Baby index is wrong. | SK |
| `src/agent/modes.js` | 306-330 | Each mode calls `agent.self_prompter.stopLoop()` and may re-prompt the LLM ("Respond accordingly") | During invasions this triggers LLM calls and chat spam, against the "reflexes without an LLM" requirement. | SK |
| `src/agent/modes.js` | 296-303 | `cheat` mode | Remove or hard-disable for RotN. | SK |
| `src/agent/self_prompter.js` | 56-87 | One LLM call per iteration with a 2000 ms cooldown (L12, L81); stops after 3 replies with no command (L64, L71-76) | The cost model is "an LLM call every few seconds", not decision points. Autonomy dies silently after 3 no-command replies. | SK |
| `src/agent/self_prompter.js` + `agent.js` | 197-202; `settings.js` L29 | Only the prompt text and state are restored, and only if `load_memory` is true (default false) | No task queue or agenda persistence. Restart does not resume autonomy by default. | SK |
| `src/agent/agent.js` | 69-89, 103-108 | Any `kicked`/`end` calls `process.exit(1)`; `spawn_timeout` is 30 s (`settings.js` L56) | `src/process/agent_process.js` L42-51 restarts without backoff, and skips the restart if the process lived under 10 s. A kick at the FML handshake leaves the bot dead with no retry. A large modded login may exceed 30 s. `connection_handler.js` computes `isFatal` but it is unused for the restart decision. | NF |
| `src/agent/agent.js` | 98-101 | Sends `/skin set URL ...` or `/skin clear` on every login | Fabric Tailor command; "Unknown command" on Forge. | SK |
| `src/agent/agent.js` | 148-155, 190-195, 476 | Ignored-message strings are vanilla feedback; auto-eat `bannedFood` list includes `pufferfish`; death detection via `jsonMsg.translate` | Item names are 1.13+ (`fish` is metadata 3 in 1.12). RotN modded foods and death messages are unknown. Death handling needs a real respawn/loss report. | SK |
| `src/agent/agent.js` | 505-515 | Update loop `while(true) await this.update()` with no try/catch | An exception from a mode (for example a name TypeError on a modded block) kills the loop or process. | SK |
| `src/agent/npc/*.js` | utils L5-69, item_goal L7-20/L207-243, controller L43 | NPC and item-goal subsystem uses `WOOD_TYPES`, vanilla recipes and blacklist names (`deepslate`, `netherite`, `crimson`) | Optional subsystem, but built entirely on the vanilla helpers. Ignore unless adopted for RotN. | RD/SK |
| `src/agent/tasks/*.js` | tasks.js L461-582; cooking_tasks.js L229-355 | `/give`, `/tp`, `/setblock`, `/kill @e[type=...,distance=..200]`, `/data merge` | These are benchmark setup commands using 1.13+ syntax and requiring op. Not for RotN. | SK |
| `profiles/defaults/_default.json` | 53, 89-90, 96-99, 143-149, 196-204, 219-251 | Examples use `oak_log`, `oak_planks`, `spruce_wood`, `cooked_chicken`; L196/L198-202 call `!collectBlock`/`!craftItem`, which do not exist (real commands are `!collectBlocks`/`!craftRecipe`) | Teaches 1.13+ names and invalid commands. L65 and L113 collect `stone` for cobblestone, which is wrong for RotN. | SK |
| `profiles/defaults/_default.json` | 47, 59, 139, 149, 161, 166, 208, 212 | Examples steer the model to `!newAction` | `!newAction` is disabled when `allow_insecure_coding=false` (`actions.js` L37-40), which is mandatory. These examples waste turns. | SK |
| `profiles/defaults/_default.json` | 4 | System prompt says "don't refuse requests" | Conflicts with the trusted-task-givers-only rule and with refusing untrusted tasks. | SK |
| `profiles/defaults/_default.json` | 12 | Image prompt mentions "blocks below y=0 do not render" | 1.18+ remark. Irrelevant for 1.12. | SK |
| `profiles/tasks/*.json` | crafting L13-68, construction L15-34 | Benchmark examples with `!craftItem`, `ender_chest`, `oak_door`, and so on | Benchmark-only. Ignore. | SK |
| `profiles/defaults/{survival,assistant,creative,god_mode}.json` | whole files | Mode flags only | `god_mode.json` L12 sets `cheat: true`. Never use it on RotN. | SK |
| `settings.js` | 5, 45 | `auth: "offline"`; blocked_actions covers blueprint commands only | Needs `"microsoft"`. Consider blocking `!searchWiki`, `!newAction`, and the villager and blueprint commands. | NF/SK |

## C. Patches

| Patch | What it changes | Matters for 1.12.2/RotN? |
|---|---|---|
| `patches/mineflayer+4.33.0.patch` digging.js L9-10 | Maps a material `incorrect_for_wooden_tool` to `mineable/pickaxe` | No effect on 1.12 (1.21-only material strings). |
| same, digging.js L16-17 | `isInWater` forced to `false` in dig time | Dig time underwater is underestimated. Minor. |
| same, inventory.js L29-38 | `use_item` gets rotation x/y and `sequence` | 1.12 `use_item` has only `hand`. Extra fields are likely ignored. **[verify]** |
| same, place_block.js L14 | `blockUpdate` wait 5000 to 500 ms | **Matters.** A heavily loaded Forge server with RotN will exceed 500 ms, so placements report failure (`skills.js` L785-787). Make it configurable. |
| `patches/minecraft-data+3.97.0.patch` | `checksum` i8 to u8 in `pc/1.21.6/protocol.json` | Irrelevant to 1.12. The patch name pins 3.97.0 while the range is `^3.97.0`. |
| `patches/mineflayer-pathfinder+2.4.5.patch` L9-14, L49-50, L90-100 | Lava avoidance, escape logic, door tweak | Lava is available in 1.12. `updateLavaAvoidance` is fine. |
| same, L55 | `bot.world.setBlockStateId(pos, 1)` to mark the placement target as solid | In 1.21 state 1 is stone. In 1.12 the state id is `(id<<4)\|meta`, so 1 is `air` with meta 1 (not solid). The trick likely does nothing. **[verify]** (NF) |
| same, L133, L179 | `canOpenDoors = true`; `!blockC._properties.open` without optional chaining | `_properties` is probably undefined on 1.12. Any path through a door or gate then throws a TypeError. **[verify]** (NF) |
| same, L96-99, L141-151 | Trapdoor and `cave_vines` logic with optional chaining or `if` guards | Harmless on 1.12. |
| same, L72 | Arrival tolerance 0.35 to 0.175 | Slower path-following, more stuck-time. Retest on a laggy server. |
| `patches/mineflayer-pvp+1.3.2.patch` | `physicTick` to `physicsTick` | Needed on any version with mineflayer 4.x. |
| `patches/protodef+1.19.0.patch` | Comments out the "Chunk size ... partial packet" log | Hides the main diagnostic for FML work. Make it env-gated. |
| `patches/prismarine-viewer+1.33.0.patch` | Unknown entity returns instead of throwing | Only matters for `render_bot_view` and vision, both off by default. The package.json range is `^1.32.0`, so the version in the patch name may not match. |

## D. Dependencies and plugins

| Package | Declared | Used at | Plausible on 1.12.2? |
|---|---|---|---|
| mineflayer | ^4.33.0 | `mcdata.js` L3 | Supports 1.8-1.21 per its README, from general knowledge. No Forge handshake (net-forge). |
| minecraft-data | ^3.97.0 | `mcdata.js` L1 | 1.12.2 data exists. No modded ids. **[verify]** |
| prismarine-item | ^1.15.0 | `mcdata.js` L4, L129 | Fine. Metadata is not exposed by Mindcraft helpers. |
| mineflayer-pathfinder | ^2.4.5 | `mcdata.js` L5 | Works on 1.12 in general. Patched. Hazards are in section C: `_properties`, `setBlockStateId(...,1)`, flowing water names. |
| mineflayer-pvp | ^1.3.2 | `mcdata.js` L6 | Fine for 1.9-combat servers. Modded weapons not recognised. |
| mineflayer-collectblock | ^1.4.1 | `mcdata.js` L7 | Not maintained recently. Brings in mineflayer-tool as a transitive dependency. Uses vanilla harvest data. |
| mineflayer-auto-eat | ^3.3.6 | `mcdata.js` L8 | Uses `bot.registry` foods, so RotN foods are skipped. `bot.autoEat.enableAuto()` is never called in `src` (grep shows only `agent.js` L191 setting options). Whether v3.3.6 auto-enables is unknown, so there may be no eating reflex. |
| mineflayer-armor-manager | ^2.0.1 | `mcdata.js` L9 | Vanilla armor by name only. |
| prismarine-viewer | ^1.32.0 | `vision/*.js` | Only for vision. Patched. |
| canvas, node-canvas-webgl, gl (overrides), three, minecraft-assets | various | vision and UI | Heavy native dependencies, unneeded for a headless CX23 bot. Candidate to drop. |
| patch-package | ^8.0.0 (dev), `postinstall` | `package.json` L45 | No `package-lock.json` is committed, so ranges can float. A newer mineflayer or pathfinder minor can break patch application. Pin exact versions. |
| `minecraft-protocol-forge` | absent | PLAN risks | Not a dependency yet. net-forge decides to fork or port. |

## E. Top 10 seams, ranked by impact

1. **No Forge login.** `initBot` (`mcdata.js` L56-68) has no FML handshake, so the first gate (G1) fails. net-forge. Includes the unreliable version selection (section A).
2. **Name space.** Every name list and alias is 1.13+ (`mcdata.js` L20-52, L147-154, L284-354; `skills.js` L433-440, L706, L1510). Translate at the command boundary (`commands/index.js` L133-169) via a rotn-data catalog.
3. **No modded IDs in the helpers.** The helpers use a private `minecraftData` instance (`mcdata.js` L126-130), so modded blocks are unknown to commands, `getAllBlockIds` (and thus `!nearbyBlocks`), and mobs. G2 depends on this.
4. **Vanilla recipes and harvest rules.** `getItemCraftingRecipes`, `craftRecipe`, `getCraftableItems`, `getDetailedCraftingPlan`, `canHarvest` and `digTime` all ignore RotN (rocks to cobblestone, crude axe). G3's early game fails without RD data.
5. **Placement and block-name collisions.** `grass` is the grass block in 1.12 (`skills.js` L706, L742), `lit_furnace` is missed (L162), `flowing_*` liquids are missed, and door `_properties` is probably missing (L1531, patch L179). Tables and furnaces may never get placed.
6. **Smelting.** `isSmeltable` refuses ores (`mcdata.js` L284-287), and `!smeltItem` kills the process (`actions.js` L284-291), so each smelt is a full Forge relogin.
7. **Reflexes.** `modes.js` has no eat, darkness, oxygen or AggroTP reflex. `isHostile` ignores modded mobs. Each reflex can prompt the LLM (L317-329), and `isClearPath` runs A* every 300 ms tick.
8. **Autonomy loop.** `self_prompter.js` L56-87 is an LLM call every few seconds with no queue, no agenda and no persistence (restores only if `load_memory` is true).
9. **Restart and kick handling.** `agent.js` L69-89 plus `agent_process.js` L42-51 give no retry after an early kick, no backoff, and no fatal-vs-transient split. The 30 s spawn timeout may be too short for a large modded login.
10. **Vanilla command and crash hazards.** Cheat mode (`/tp @s`, `/setblock [state]`), `/skin` on login, `!searchWiki`, the biome-name TypeError (`world.js` L430), the 500 ms place timeout patch, and the unprotected update loop (`agent.js` L505-515).

## F. Open questions (not answerable from code alone)

1. Which installed versions will `npm install` produce? There is no lockfile and no `node_modules`, so every version here is a declared range.
2. Is the `minecraftData(version)` object in `mcdata.js` shared with `bot.registry`? If it is, extending the registry at login also fixes the helpers. If not, the helpers need an explicit overlay.
3. Does prismarine-block set `_properties` for 1.12 (the `skills.js` L1531 and patch L179 hazard)?
4. What do unknown modded block ids look like to `bot.blockAt` and `findBlocks` in 1.12 (name undefined or a placeholder)? That decides whether the many `block.name.includes(...)` calls throw (`modes.js` L44, `skills.js` L1553).
5. What shape do 1.12 recipe ingredients take in minecraft-data (plain ids vs `{id, metadata}`)? `mcdata.js` L262 depends on it.
6. Does `mineflayer-auto-eat` 3.3.6 eat automatically without `enableAuto()`? If not, nothing eats at present.
7. Does the `use_item` change in the mineflayer patch cause any trouble on 1.12 (extra fields)?
8. How long is the RotN login (FML handshake plus registry sync) compared with `spawn_timeout: 30`?
9. Does `bot.openVillager` work on 1.12, and what is the RotN trade protocol (`MC|TList` custom payload vs newer)?
10. What are RotN's real death message translate keys, and are there chat length limits (1.12 allows 100 characters in the GUI, and the code in `agent.js` L404-428 neither chunks nor truncates long LLM replies)?
11. Do RotN's AggroTP teleports change position within a single tick in a way mineflayer physics or pathfinder can detect? The skills-rotn brief asks for a detector, but there is nothing in the current code to build on.
