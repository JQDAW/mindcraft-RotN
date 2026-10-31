# ADR 0004: The RotN data dump comes from a small server-side Forge mod run only on the test server

- Status: accepted (direction). rotn-data may propose changes to build and output details in a follow-up ADR.
- Date: 2026-11-01
- Author: rotn-lead

## Context

rotn-data needs these facts for RotN 3.3.2 as JSON: blocks (registry name, metadata variants, hardness, material, harvest tool and level), items (stack size, tool tier), recipes (after CraftTweaker), entities, and the ore dictionary.

Research adds two hard requirements:

- `docs/research/fml-spec.md` section 3: mod mobs spawn through FML with a **mod-local** `(modId, modEntityTypeId)`. That table is not sent to clients, so only server-side code can produce it.
- `docs/research/rotn-progression.md`: RotN changes harvest levels through Tool Progression configs, and recipes through about 190 CraftTweaker scripts. The pack's scripts and configs are public at `Rebirth-of-the-Night/Rebirth-of-the-Night@bd2d078d` ("3.3.2"); the mod jars are not.

## Options

1. **CraftTweaker dump commands** (`/ct recipes`, `/ct names`, `/ct oredict`, ...). These give post-script recipes and names in a text log. They do not give hardness, harvest levels or the mod-local entity table, and the log needs fragile parsing.
2. **Parse the public scripts and configs offline.** These give only the deltas from vanilla and mod defaults, and they cannot resolve ore dictionary entries or mod recipes. They are useful for cross-checks and documentation, not as the source.
3. **A small server-side Forge 1.12.2 mod** (`tools/dumper/`), dropped into the test server's `mods/` and triggered by a server console command or automatically on `FMLServerStartedEvent`. It reads the live registries after every mod and CraftTweaker script has loaded:
   - `ForgeRegistries.BLOCKS` and states: hardness, material, `getHarvestTool` and `getHarvestLevel` per state.
   - Items: stack size, max damage, tool classes and levels.
   - `ForgeRegistries.RECIPES` with ingredients expanded, plus `FurnaceRecipes`.
   - `EntityRegistry` registrations: mod id, mod-local id, class, and whether the mob is hostile (`IMob`).
   - `OreDictionary`.

   It writes the results as JSON.
4. **Client-side capture only.** This gives names and numeric ids from RegistryData and nothing else.

## Decision

- **Option 3 is the source of truth.** Option 1 (`/ct recipes`) and option 2 (the scripts at the pinned commit) serve as cross-checks in rotn-data's unit tests. Example: confirm that the crude axe, Crafting Tools and 4-rocks-to-cobblestone recipes appear in the dump.
- The dumper mod is installed **only on the disposable test server**, never on the live server. It is not a "helper mod" in the PLAN sense.
- Build: Java 8 with ForgeGradle for Forge 14.23.5.2860. The jar is built in CI or on the test server, not committed. Its source and build script live in `tools/dumper/`. The JSON output is committed to `packages/rotn-data/3.3.2/` with a manifest: pack zip SHA-256, Forge build, mod list hash, dump date and dumper version.
- Recipes from modded stations (Pyrotech kilns, the anvil) come from those mods' registries, as a later increment. Ready-to-try needs only the crafting table and the 2x2 grid (PLAN).
- Numeric ids are **not** a stable key between servers. The dump keys everything by registry name and metadata. At runtime, forge-bridge's synced ids map names to numbers (ADR 0003).

## Consequences

- harness-ops' test-server script needs an option to install an extra mod jar and run a console command, then fetch the output files.
- rotn-data's first deliverable is the dumper plus a dump run on the test server. It needs G0 (the test server) first.
- What we give up: building a Forge 1.12.2 mod needs an old toolchain (Gradle 4.x, ForgeGradle 2.3, JDK 8). rotn-data pins it in `tools/dumper/` and runs it in CI with JDK 8. If the toolchain cannot be made to work, the fallback is option 1 for recipes and names, plus a `tellme`-style dump for blocks. `tellme` is in RotN's `_devtools/`, but whether it covers harvest levels is UNVERIFIED. The mod-local entity table would then stay open, a G2 risk.
