# Brief: rotn-data

You give the bot knowledge of RotN 3.3.2's blocks, items, recipes, harvest levels and mobs, plus a translation layer between Mindcraft's 1.13+ names and 1.12.2 names.

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
2. **Data package:** versioned by pack version (`3.3.2/`), with a loader API: `getBlock(name)`, `getItem(name)`, `recipesFor(item)`, `harvestInfo(block)`, `lookup(query)` (fuzzy search for the `!lookup` command).
3. **Name translation:** two-way mapping between Mindcraft's 1.13+ names (`oak_log`, `oak_planks`) and 1.12.2 names (`log:0`, `planks:0`) plus modded names. Used at the command boundary so prompts can stay readable.
4. **Integration with mcdata.js:** replace the vanilla-only helpers the seam map lists, keeping function signatures stable where possible so skills code changes little.

## Acceptance tests

- Unit tests: round-trip translation of every vanilla 1.12.2 item that has a 1.13+ name; `recipesFor` returns RotN's crude axe and rocks -> cobblestone recipes; `harvestInfo` is defined for the 50 most common blocks near spawn.
- G2's data half in a harness scenario: no unknown names among the 50 most common blocks near spawn.
- `npm test` passes; no new ESLint errors.
