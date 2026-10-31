# Brief: rotn-data

You give the bot knowledge of RotN 3.3.4's blocks (ADR 0005), items, recipes, harvest levels and mobs, plus a translation layer between Mindcraft's 1.13+ names and 1.12.2 names.

## You own

- `tools/dumper/`: a way to export data from the test server. Options are a tiny server-side Forge 1.12.2 mod, CraftTweaker's dump commands, or both. Pick one in an ADR proposal to the lead.
- `packages/rotn-data/`: the generated JSON (checked in) and a small JS API around it.
- The name and registry helper functions in `src/utils/mcdata.js` (not `initBot`, which net-forge owns).

## Inputs

- `docs/research/rotn-progression.md` (rotn-gameplay-analyst) and `docs/research/seam-map.md`
- The registry shape that net-forge exposes at login
- The test server from harness-ops. The dump runs there, never on the live server.

## Deliverables

1. **Dumper:** produces JSON for blocks (registry name, metadata variants, hardness, material, harvest tool and level), items (name, metadata, stack size, tool tier), recipes (shaped, shapeless, smelting, including CraftTweaker changes) and entities (registry name, hostility if available). Document how to rerun it.
2. **Data package:** versioned by pack version (`3.3.4/`), with a loader API: `getBlock(name)`, `getItem(name)`, `recipesFor(item)`, `harvestInfo(block)`, `lookup(query)` (fuzzy search for the `!lookup` command).
3. **Name translation:** two-way mapping between Mindcraft's 1.13+ names (`oak_log`, `oak_planks`) and 1.12.2 names (`log:0`, `planks:0`) plus modded names. Used at the command boundary so prompts can stay readable.
4. **Integration with mcdata.js:** replace the vanilla-only helpers the seam map lists, keeping function signatures stable where possible so skills code changes little.

## Acceptance tests

- Unit tests: round-trip translation of every vanilla 1.12.2 item that has a 1.13+ name; `recipesFor` returns RotN's crude axe and rocks -> cobblestone recipes; `harvestInfo` is defined for the 50 most common blocks near spawn.
- G2's data half in a harness scenario: no unknown names among the 50 most common blocks near spawn.
- `npm test` passes; no new ESLint errors.

## Phase 0 research revisions (rotn-lead, 2026-11-01)

Read `docs/research/rotn-progression.md`, `docs/research/seam-map.md` (rows owned by RD), `docs/adr/0003-forge-bridge-approach.md` (shared-registry contract) and `docs/adr/0004-dumper-approach.md`. Where this section and the text above disagree, this section wins.

**Dumper (ADR 0004).** This settles the "pick one in an ADR" choice above.

- Build a small server-side Forge 1.12.2 mod in `tools/dumper/`. It runs only on the test server and reads the live registries after CraftTweaker has loaded.
- Besides the fields above, it must dump:
  - the **mod-local entity table** (`modId`, `modEntityTypeId`, registry name, hostile or not), which forge-bridge needs to name mod mobs;
  - the **ore dictionary**;
  - **block state to metadata** mappings.
- Use `/ct recipes` and the pack's public scripts (`Rebirth-of-the-Night/Rebirth-of-the-Night@bd2d078d933e798ad9f87d3171ca31ddbe6b24f4`) only as cross-checks in tests.
- Pin the build toolchain (JDK 8, Gradle 4.x, ForgeGradle 2.3, Forge 14.23.5.2860). Don't commit the jar.
- If the toolchain cannot be made to work within one working session, escalate (fallback in ADR 0004).

**Shared registry.** The `mcdata.js` helpers must read the bot's registry after login (`bot.registry`, as extended by forge-bridge), not the private `minecraftData(bot.version)` copy (seam-map section A). Agree the data shape with net-forge early.

**`mcdata.js` helpers to fix** (seam-map table, rows owned by RD):

- Name lists: `WOOD_TYPES`, `MATCHING_WOOD_BLOCKS`, `WOOL_COLORS` and `mustCollectManually`.
- `isSmeltable`, fuel and smelting maps. In RotN, ores give `contenttweaker:raw_iron` etc., and charcoal is `minecraft:coal:1`.
- `isHostile` and `isHuntable`: the 1.12 baby index, golem names, and modded mobs from the dump.
- `getItemCraftingRecipes` and `getDetailedCraftingPlan` on RotN recipes, including 1.12 `{id, metadata}` ingredients.
- `harvestTools`/`canHarvest` from the dump.

Keep the function signatures.

**Recipe shape (ADR 0004).** Emit recipes in a prismarine-recipe-compatible shape (`inShape`/`ingredients`, `result {id, metadata, count}`, `requiresTable`), with ore dictionary keys expanded. skills-rotn turns them into real crafts.

**Enchantments.** REID stores the enchantment NBT `id` as TAG_Int (`fml-spec.md` section R). Any helper that reads enchantments must accept both int and short.

**Revised acceptance tests:**

- `recipesFor` returns RotN's crude axe, Crafting Tools (`contenttweaker:crafting_tools`), crafting table (plank + Crafting Tools), 4 rocks to cobblestone, and the stone pickaxe and axe (3 rocks + 2 sticks). Each must match the pinned scripts.
- `harvestInfo('stone')` reports RotN's harvest tool and level from the dump. The drop ("a pickaxe below Sturdy gives 4 `pyrotech:rock`") is an event-handler behaviour, so it is checked in a G3 harness scenario, not here (ADR 0004).
- Every block in `rotn-progression.md` section 4 resolves both ways through name translation.
- The mod-local entity table maps every mod mob seen in net-forge's spawn fixtures.

**Start condition.** You start once harness-ops has a G0 test server (to run the dump) and net-forge has a registry capture.
