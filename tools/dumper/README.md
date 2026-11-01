# RotN data dumper (`tools/dumper`)

A small **server-side** Forge 1.12.2 mod (ADR 0004). It runs **only on the disposable test server**, never on the live server. When the server has started (every mod and CraftTweaker script loaded) it reads the live registries and writes JSON to `./rotn-dump/` in the server folder. The console command `rotndump` (permission level 4) writes the files again. It only reads game state.

`acceptableRemoteVersions = "*"` and `serverSideOnly = true`: clients that lack the mod can still join.

## Output (format `rotn-dump/1`)

Every key is a registry name plus metadata, never a numeric id (numeric ids differ between servers; ADR 0004).

| File | Content |
| --- | --- |
| `manifest.json` | dumper version, Minecraft and Forge versions, dump time (UTC), active mods with versions and the SHA-256 of their sorted `id@version` list, per-file counts, errors |
| `blocks.json` | per block: `defaultMeta`, `class`, and one entry per metadata value `m` (0-15) where `getMetaFromState(getStateFromMeta(m)) == m`: state `props`, `displayName`, `hardness`, `explosionResistance`, `material`, `harvestTool`, `harvestLevel`, `toolRequired`, `solid`, `liquid`, `replaceable`, `light`, `opacity`, `fullCube`, `opaque`, `collision` boxes, the block's `item` `{name, meta}` and nominal `drops` |
| `items.json` | per item: `stackSize`, `maxDamage`, `hasSubtypes`, `block`, `toolClasses {class: level}`, `speed` on stone/log/dirt, `variants [{meta, displayName, translationKey, burnTime, food}]` |
| `recipes.json` | every crafting-grid `IRecipe` after CraftTweaker: `id`, `class`, `type` (`shaped`/`shapeless`), `width`, `height`, `requiresTable` (`!canFit(2, 2)`), `result {name, meta, count}`, `slots` (shaped, row-major, `null` = empty) or `ingredients` (shapeless), each `{stacks: [{name, meta}], ore?}`; `matchesSample`, `mirroredTested`, `remaining` (what `getRemainingItems` leaves, e.g. a reused tool) |
| `smelting.json` | vanilla furnace recipes (`FurnaceRecipes`, after CraftTweaker's `furnace.*`): `input`, `output`, `xp` |
| `oredict.json` | every ore dictionary key and its stacks |
| `entities.json` | per entity: `modId` + `modEntityTypeId` (the **mod-local id** in FML EntitySpawn; `null` for vanilla), `class`, `entityName`, `displayName`, `hostile` (`IMob`), `kinds`, tracking settings |
| `spawns.json` | per biome and creature type: natural spawn list entries (`entity`, `weight`, `min`, `max`) |
| `DONE` | one summary line, written last |

Metadata `32767` is the ore dictionary wildcard ("any meta").

What is **not** in the dump, on purpose:

- **Event-handler drops** (Pyrotech's stone-to-rocks, Dropt rules). `drops` is only `getItemDropped` / `quantityDropped` with a fixed seed. Gameplay drops are checked in G3 harness scenarios (ADR 0004).
- **Mod station recipes** (Pyrotech kilns, anvils, drying racks). A later increment; ready-to-try needs only the crafting table and the 2x2 grid.
- **Spawn rules applied at spawn time** (game stages, light, invasions).
- Values that a mod computes from a real world position. Hardness and collision are read at (0, 0, 0) in the overworld; a value that throws is written as `null`.

## Build

The jar is **never committed**. Pinned toolchain:

| Tool | Version | Pin |
| --- | --- | --- |
| JDK | 8 | `build.sh` refuses any other `java -version` |
| Gradle | 4.10.3 | `build.sh` downloads `gradle-4.10.3-bin.zip` and checks SHA-256 `8626cbf2...186e` |
| ForgeGradle | 2.3, as `com.anatawa12.forge:ForgeGradle:2.3-1.0.8` (Maven Central) | `build.gradle` |
| Forge | 14.23.5.2860 (the pack's build) | `build.gradle` |
| MCP mappings | `stable_39` | `build.gradle` |

Why the anatawa12 fork: it is ForgeGradle 2.3 with its dead download URLs fixed. The original `net.minecraftforge.gradle:ForgeGradle:2.3-SNAPSHOT` (still on maven.minecraftforge.net) reads MCP metadata from the retired `export.mcpbot.bspk.rs`. `DUMPER_FG=official tools/dumper/build.sh` tries the original. If the fork is kept, rotn-data records it in a follow-up ADR (ADR 0004 allows build details to change that way).

```sh
JAVA_HOME=/path/to/jdk8 tools/dumper/build.sh
# -> tools/dumper/build/libs/rotndump-0.1.0.jar and its SHA-256
```

This PC has only JDK 21, so the jar is built in CI (a `workflow_dispatch` workflow that harness-ops owns; proposal in `ci/dumper-build.yml.proposed`) or on the test server.

## Run it on the test server

Paid runs need a plan in `coord/STATUS-rotn-data.md` and the lead's written GO first. `deploy/test-server.sh` stays unchanged. Then:

```sh
deploy/test-server.sh run --ttl-hours 2 --yes \
  --extra-mod tools/dumper/build/libs/rotndump-0.1.0.jar \
  --wait 180 --console rotndump \
  --fetch rotn-dump --fetch logs/latest.log \
  --out "$OUT" -- true
node packages/rotn-data/tools/import-dump.mjs "$OUT/rotn-dump"
```

- The automatic dump at server start runs before the console is ready. The `rotndump` console command then writes the files again on the server thread. Its summary line ("[rotndump] wrote {...}") in the console output shows that the files are complete.
- `import-dump.mjs` checks the format, that every name exists in the 3.3.4 registry capture, and the script cross-checks, then writes `packages/rotn-data/3.3.4/`.

## Rerun after a pack change

A new pack version needs a new ADR (ADR 0005). Then rebuild nothing (the dumper is pack-independent), run the command above against the new pack, import into `packages/rotn-data/<version>/`, and rerun G2.
