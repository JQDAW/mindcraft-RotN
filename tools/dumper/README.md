# RotN data dumper (`tools/dumper`)

A small **server-side** Forge 1.12.2 mod (ADR 0004). It runs **only on the disposable test server**, never on the live server.

- **Strictly opt-in.** It does nothing unless the file `rotn-dump.enable` exists in the server folder. The test-server batch creates it (`run-dump.sh`). A copy of the jar anywhere else stays idle and logs one line.
- With the marker present, a dump is scheduled once the server has started, and the console command `rotndump` (permission level 4) schedules another.
- A dump writes **one part per server tick** (oredict, blocks, items, recipes, smelting, entities, spawns, then the manifest), so no single tick holds all the work. Each file is written as `NAME.json.tmp` and renamed into place, and `DONE` is written last. **A reader must wait for `DONE`.**
- It only reads game state. `acceptableRemoteVersions = "*"` and `serverSideOnly = true`: clients that lack the mod can still join.
- Every value is computed before it is written. A game call that throws gives `null` for that one value, never a truncated file.

## Output (format `rotn-dump/1`)

Every key is a registry name plus metadata, never a numeric id (numeric ids differ between servers; ADR 0004).

| File | Content |
| --- | --- |
| `manifest.json` | dumper version, Minecraft and Forge versions, dump time (UTC), active mods with versions and the SHA-256 of their sorted `id@version` list, per-file counts, errors |
| `blocks.json` | per block: `defaultMeta`, `class`, and one entry per metadata value `m` (0-15) where `getMetaFromState(getStateFromMeta(m)) == m`: state `props`, `displayName`, `hardness`, `explosionResistance`, `material`, `harvestTool`, `harvestLevel`, `toolRequired`, `solid`, `liquid`, `replaceable`, `light`, `opacity`, `fullCube`, `opaque`, `collision` boxes (`[]` none, `null` unknown), the block's `item` `{name, meta}` and nominal `drops` |
| `items.json` | per item: `stackSize`, `maxDamage`, `hasSubtypes`, `block`, `toolClasses {class: level}`, `speed` on stone/log/dirt, `variants [{meta, displayName, translationKey, burnTime, food}]` |
| `recipes.json` | every crafting-grid `IRecipe` after CraftTweaker: `id`, `class`, `type` (`shaped`/`shapeless`), `width`, `height`, `requiresTable` (`!canFit(2, 2)`), `result {name, meta, count}`, `slots` (shaped, row-major, `null` = empty) or `ingredients` (shapeless), each `{stacks: [{name, meta}], ore?, ores?}`. `ore` is set when the ingredient is exactly one ore key (read from Forge's `OreIngredient`, or matched with wildcards expanded), and its `stacks` are then the ore's own list. `ores` lists every ore key inside, including CraftTweaker `<ore:a>|<b>` unions; `matchesSample`, `mirroredTested`, `remaining` (what `getRemainingItems` leaves, e.g. a reused tool) |
| `smelting.json` | vanilla furnace recipes (`FurnaceRecipes`, after CraftTweaker's `furnace.*`): `input`, `output`, `xp` |
| `oredict.json` | every ore dictionary key and its stacks |
| `entities.json` | per entity: `modSpawn` (FML has a mod spawn registration), `modId` + `modEntityTypeId` (the **mod-local id** in FML EntitySpawn; `null` without a mod spawn), `usesVanillaSpawning` (such a mod entity arrives in a vanilla spawn packet with its `minecraft:entities` id instead), `class`, `entityName`, `displayName`, `hostile` (`IMob`), `kinds`, tracking settings |
| `spawns.json` | per biome and creature type: natural spawn list entries (`entity`, `weight`, `min`, `max`) |
| `DONE` | one summary line, written last |

Metadata `32767` is the ore dictionary wildcard ("any meta").

`material` is the lower-cased MCP field name of the vanilla `Material` (`Material.PLANTS` is `plants`, `GROUND` is `ground`, `CLOTH` is `cloth`, `CIRCUITS` is `circuits`). A modded material is `modded:<class>`. These are not prismarine's material strings; rotn-data maps them when it builds `bot.registry` properties.

**Mod-local entity table for net-forge.** rotn-data's catalog builds net-forge's proposed `modEntityTable` shape from `entities.json`: `{ [modId]: { [modEntityTypeId]: registryName } }`. It takes every entry with `modSpawn: true` and an integer `modEntityTypeId` (`modEntityTable()` in `packages/rotn-data`). Entries with `usesVanillaSpawning: true` are in that table too. On the wire, though, they come in a vanilla spawn packet and are named through forge-bridge's `bot.registry.entitiesByForgeId`.

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
| ForgeGradle | 3.0.197 (maven.minecraftforge.net) | `build.gradle` |
| Forge | 14.23.5.2860 (the pack's build) | `build.gradle` |
| MCP mappings | `stable` `39-1.12` | `build.gradle` |

**Why ForgeGradle 3, not the 2.3 the brief names.** maven.minecraftforge.net no longer serves ForgeGradle 2's `userdev` artifact for 14.23.5.2860 (HTTP 404); it serves only `userdev3`. The official 14.23.5.2860 MDK (re-released in December 2021) builds with ForgeGradle 3 on Gradle 4.9.

- harness-ops' first CI trial with ForgeGradle 2.3 (run 41338011357) failed exactly there: "Could not find net.minecraftforge:forge:1.12.2-14.23.5.2860".
- ForgeGradle 3 reobfuscates the jar to SRG names (`reobfJar`), so it loads on the real server.
- This changes ADR 0004's build pin. rotn-data asks the lead for a follow-up ADR (ADR 0004 allows build details to change that way).

`build.sh` also checks that `RotnDump.VERSION` equals `build.gradle`'s `version`.

```sh
JAVA_HOME=/path/to/jdk8 tools/dumper/build.sh
# -> tools/dumper/build/libs/rotndump-0.1.0.jar and its SHA-256
```

This PC has only JDK 21, so the jar is built in CI by harness-ops' `dumper-build` workflow (`.github/workflows/`; it runs `build.sh` unchanged and keeps the jar as the 7-day artifact `rotndump-jar`). The original proposal is kept in `ci/dumper-build.yml.proposed`.

## Run it on the test server

Paid runs need a plan in `coord/STATUS-rotn-data.md` and the lead's written GO first. `deploy/test-server.sh` stays unchanged. Then:

```sh
timeout 3600 deploy/test-server.sh run --ttl-hours 2 --yes \
  --extra-mod "$JAR" -- tools/dumper/run-dump.sh "$OUT"
node packages/rotn-data/tools/import-dump.mjs "$OUT/rotn-dump"
```

- `run-dump.sh` uses only `deploy/test-server.sh`'s own `ssh`, `console` and `fetch` subcommands. It creates `rotn-dump.enable` and types `rotndump`. It then waits until `rotn-dump/DONE` exists (20 min limit) and fetches `rotn-dump/` and `logs/latest.log` into `$OUT`.
- `import-dump.mjs` refuses a dump without `DONE`. It checks the format, that every name exists in the 3.3.4 registry capture, and the script cross-checks. Only then does it write `packages/rotn-data/3.3.4/`.

## Rerun after a pack change

A new pack version needs a new ADR (ADR 0005). Then rebuild nothing (the dumper is pack-independent), run the command above against the new pack, import into `packages/rotn-data/<version>/`, and rerun G2.
