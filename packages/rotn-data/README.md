# `@mindcraft-rotn/rotn-data`

RotN 3.3.4 facts (ADR 0005) and two-way name translation between Minecraft 1.12.2 and the 1.21-style names Mindcraft uses. rotn-data brief deliverables 2 and 3.

## API (`packages/rotn-data/index.js`, ESM)

### Name translation

| Call | Result |
| --- | --- |
| `toNew(oldName, meta = 0)` | `'log', 1` / `'log:1'` / `'minecraft:log:1'` → `'spruce_log'`; `'coal', 1` → `'charcoal'`; modded names pass through: `'pyrotech:rock', 6` → `'pyrotech:rock:6'` (`:0` omitted) |
| `toOld(newName)` | `'oak_log'` → `{ name: 'minecraft:log', meta: 0 }`; `'pyrotech:rock:6'` → `{ name: 'pyrotech:rock', meta: 6 }`. `name` is always the full registry name. Old spellings (`'log:2'`) are accepted too. |
| `blockToNew(oldName, meta)` | block states: `'log', 4` (axis x) → `'oak_log'`; `'lit_furnace', 3` → `'furnace'` |
| `blockToOld(newName)` | every state: `'oak_log'` → `log:0`, `log:4`, `log:8` |
| `registryName(entryOrName)` | `{ name: 'stone' }` (bot.registry) → `'minecraft:stone'`; `'pyrotech:rock'` unchanged |

- **Anything that cannot be mapped is `null`** (or `[]` for `blockToOld`): never a guess, a number or "unknown".
- Modded names are checked against the names the 3.3.4 server syncs, so a typo gives `null`.
- Damageable items keep their name whatever the damage: `toNew('stone_pickaxe', 17)` → `'stone_pickaxe'`.
- Blocks are strict: `blockToNew` gives `null` for a metadata the block does not have (`blockToNew('stone', 7)`). It uses the item table only for names that have no block states.
- Vanilla table: `vanilla/flattening-items.json` (643 item pairs, a bijection). `spawn_egg` is left out because its mob is in NBT, and `stone_slab:2` (petrified oak slab) is added. `tallgrass:0` (the shrub item) stays `null` on purpose: its 1.13 name `dead_bush` is already `deadbush`'s. Every synced `minecraft:` item is covered except `air`, `portal`, `end_portal`, `end_gateway` and `spawn_egg`.
- Block table: `vanilla/flattening-blocks.json` (1682 states).
- Both tables come from minecraft-data's `pc/common/legacy.json` and `pc/1.12.2`, with every 1.12 name checked against the 3.3.4 server's registry (minecraft-data's `light_gray_glazed_terracotta` and `light_gray_shulker_box` blocks are `silver_*` there), and the later renames carried forward to 1.21 (`rose_red` → `red_dye`, `sign` → `oak_sign`, `grass` → `short_grass`, `grass_path` → `dirt_path`, 1.13's `stone_slab` → `smooth_stone_slab`). Rebuild with `node packages/rotn-data/tools/build-flattening.mjs`.

### Catalog

`loadRotnData('3.3.4')` returns the pack's catalog; the same calls are exported bound to 3.3.4. Inputs may be registry names, old names with metadata, 1.21 names or bot.registry entries.

| Call | Result |
| --- | --- |
| `getBlock(name)` | the dumped block with `states` and the selected `state`, or `{ name, propertiesKnown: false }` before a dump, or `null` if the server has no such block |
| `getItem(name)` | the dumped item with its `variant` for the metadata |
| `harvestInfo(block, meta?)` | `{ block, meta, hardness, tool, level, levelName, toolRequired, material }`; `levelName` is Tool Progression's (`0` Crude, `1` Sturdy, ...); `null` without a dump |
| `recipesFor(item, { meta })` | crafting-grid recipes after CraftTweaker, shaped like prismarine-recipe but keyed by names: `{ id, type, result {name, meta, count}, requiresTable, inShape \| ingredients, mirrored?, remaining? }`, ingredient = `{ stacks: [{name, meta}], ore? }` (ore dictionary expanded; meta `32767` = any) |
| `smeltingFor(item)`, `smeltingOf(input)` | furnace recipes by output or by input |
| `entity(name)`, `entityByModId(modId, typeId)`, `modEntityTable()` | entity facts; the mod-local table maps FML EntitySpawn ids to registry names. `modEntityTable()` gives net-forge's shape `{ [modId]: { [modEntityTypeId]: registryName } }` (entries with `modSpawn: true`) |
| `lookup(query, { limit, kind })` | fuzzy search over registry names, 1.21 aliases and display names, for `!lookup` |

## Data (`3.3.4/`)

| File | Source |
| --- | --- |
| `registry-names.json` | every block, item, entity, biome, enchantment and potion name the real 3.3.4 server synced, from net-forge's G1 Batch A RegistryData capture (`packages/forge-bridge/test/fixtures/rotn-3.3.4/handshake-runA.*`). Rebuild: `node packages/rotn-data/tools/registry-from-capture.mjs`. Numeric ids are kept for reference only. |
| `mining-levels.json` | `config/tool_progression/mining_level_names.cfg` from the pinned zip |
| `manifest.json`, `blocks.json`, `items.json`, `recipes.json`, `smelting.json`, `oredict.json`, `entities.json`, `spawns.json` | the dump (ADR 0004, `tools/dumper/README.md`): the first RotN 3.3.4 dump, 2026-11-01, dumper jar SHA-256 in `manifest.json`. `blocks`, `items`, `recipes` and `spawns` are stored as `.json.br`. Known harvest gaps are pinned in `test/fixtures/harvest-known-gaps-3.3.4.json`. |
| `common-mobs.json` | mobs most likely met in the overworld, from `spawns.json` (`tools/build-common-mobs.mjs`); harness-ops' G2 mob scenario reads `mobs[].name` |

Import a fetched dump with `node packages/rotn-data/tools/import-dump.mjs <fetched rotn-dump dir> --jar-sha256 <SHA-256 of the dumper-build artifact>`. The importer refuses a manifest whose `dumperJar.sha256` differs, and records the SHA-256 of every raw fetched file in `manifest.import.rawSha256`. Files over 1 MiB are stored as `.json.br`. It refuses a dump without its `DONE` marker, with dumper errors, with another Forge build, with names that differ from the registry capture, or without the early-game recipes from the pack's scripts (`test/fixtures/scripts-3.3.4-early-recipes.json`, transcribed from the zip with file and line).

## Tests

`npm test` runs `packages/rotn-data/test/*.test.js`, all offline:

- `translate.test.js`: every vanilla item round-trips; all names in `rotn-progression.md` section 4 resolve both ways; generated files are up to date.
- `catalog.test.js`: the API on a synthetic mini dump (`test/fixtures/mini-dump`, values made up).
- `import-dump.test.js`: the importer's checks.
- `acceptance-3.3.4.test.js`: the brief's acceptance tests on the real dump (crude axe, Crafting Tools, crafting table, rocks to cobblestone, stone pickaxe and axe recipes match the scripts; `harvestInfo('stone')`; harvest info for every block state; the mod-local entity table is complete). They skip only when no dump is imported.
