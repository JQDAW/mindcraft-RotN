# Status: rotn-data

Updated: 2026-11-01

Worktree `C:/Users/admin/orca/workspaces/mindcraft-RotN/rotn-data-g2`. G2 brief items: (1) dumper, (2) data package, (3) name translation, (4) `mcdata.js` name/registry helpers on `bot.registry`.

## Done

- Read CLAUDE.md, PLAN, my brief (the "Phase 0 research revisions" section wins), ADRs 0003-0005, `rotn-progression.md`, the RD rows of `seam-map.md`, and net-forge's PR #25 (`extendRegistry`).
- **Re-checked against the pinned 3.3.4 zip** (`unzip -p` into a scratch folder outside the repo; SHA-256 prefix `90642fd5cd098e91` confirmed; nothing run):
  - Early recipes, unchanged from 3.3.2: Crafting Tools `scripts/crafting_tables.zs:9`, crafting table `:14-15`, crude axe `scripts/pyrotech/pyrotech_recipes_craftingtable.zs:238-240` (rock is `<ore:rock>`, L117), rocks to cobblestone `scripts/minecraft_(max-file-size).zs:228, 267-268`, stone pickaxe `scripts/recipe_cohesion.zs:115-120`, stone axe (mirrored) `:79-84`, sticks `scripts/minecraft_(max-file-size).zs:1042-1046`, furnace `:453-457`.
  - Mining level names: `config/tool_progression/mining_level_names.cfg` (0 Crude ... 6 Zenith), same as the report.
  - Every name in `rotn-progression.md` section 4 exists in the 3.3.4 RegistryData capture. Open item 6 partly answered: Stone Kiln is `pyrotech:stone_kiln`, the bundle is `bundles:bundle`; the Scroll of New Life is probably `lifescroll:spawnscroll` (not confirmed in game).
  - New for skills-rotn: `scripts/blockhardness1.zs`/`blockhardness2.zs` change block hardness and `scripts/dropt*.zs` change drops (Dropt). The dump includes the hardness changes; Dropt drops are event-based and are not in it.

## Doing

- **PR #34 (`agent/rotn-data/g2-dumper`): the dumper mod** (brief item 1, ADR 0004) in `tools/dumper/`. Review (REQUEST CHANGES) items 1-7 are addressed:
  - compute-then-write (`J.java`);
  - atomic `.tmp` + rename, with `DONE` last;
  - one part per server tick;
  - opt-in marker `rotn-dump.enable`;
  - ore keys from `OreIngredient`, CraftTweaker and wildcard expansion;
  - `modSpawn` + `usesVanillaSpawning`;
  - `run-dump.sh` waits for `DONE`;
  - the nits.

  **The mod compiles:** harness-ops' dumper-build trial on `3398b03` is green (run 41338507034: Temurin 1.8.0_504, Gradle 4.10.3 checksum OK, BUILD SUCCESSFUL; `rotndump-0.1.0.jar`, 48,212 bytes, SHA-256 `fcfe6b47...c898`). The workflow itself is harness-ops' PR #40. Not yet run on a server.
- **PR #37 (`agent/rotn-data/data-package`): `packages/rotn-data`**, items 2 and 3. Translation API `toNew`/`toOld` (642 vanilla item pairs, a clean bijection; `spawn_egg` excluded, its mob is in NBT), catalog API, names from the real capture, script cross-check fixtures, 25 offline tests. The dump-dependent acceptance tests skip until a dump is imported.
- Then item 4: the `mcdata.js` helpers on `bot.registry`, after net-forge's PR #25 merges (see Request 4).
- The lead's low-memory rule (2026-11-01) applies: targeted `node --test <file>` runs only, no parallel heavy jobs.

## Follow-ups (from the PR #37 review, 2026-11-01; not part of #37)

- **3.** `toOld`'s old-name fallback gives a changed meaning for a few names: `toOld('stone_slab')` is the 1.12 smooth slab, and `toOld('grass')` is the grass block, while Mindcraft (`skills.js:706`) means the plant. Handle this at the command boundary in brief item 4 / with skills-rotn (prefer the 1.21 meaning for names Mindcraft uses).
- **4.** A reverse-coverage test: every synced `minecraft:` item name maps (except `air`, `portal`, `end_portal`, `end_gateway`), plus per-meta gaps such as item `tallgrass:0`.
- **5.** `blockToNew` falls back to the item table and so accepts invalid block metas (e.g. `silver_glazed_terracotta:9`). Restrict the fallback to names that have no block entry.

## Blocked

- The real dump needs #34 merged (after #40) and the lead's written GO for the paid run below. The jar builds in CI.

## Requests to other agents or the lead

1. **harness-ops (via lead): a `workflow_dispatch` workflow that builds the dumper jar with JDK 8** and uploads it as an artifact. In progress per the lead; #34 merges only after it is green. Proposal ready to copy: `tools/dumper/ci/dumper-build.yml.proposed` (no secrets, read-only token; please pin the actions by SHA). It runs `tools/dumper/build.sh`, which pins Gradle 4.10.3 by SHA-256.
2. **net-forge: the data shape for `extendRegistry(..., { properties })`.** I will hand you `properties` built from the dump, keyed by full registry name as your README says:
   - blocks: `hardness`, `resistance`, `material` (mapped by rotn-data from the dump's MCP material names, e.g. `plants`, `ground`, `cloth`, to prismarine's material strings; modded materials stay `modded:<class>`), `diggable` (hardness >= 0), `boundingBox` (`block` / `empty` from the collision box), `shapes`, `transparent`, `emitLight`, `filterLight`, and `harvestTools` as `{itemId: true}` built from item tool levels. The numbers need bot.registry's item ids, so I build them **after** your extension, through a second call `extendRegistry(bot.registry, snapshot, { properties })` or a small `applyProperties(registry, properties)` from you. Which do you prefer?
   - items: `stackSize`, `maxDurability`.
   - entities: `type` (`hostile` for `IMob`, `animal`, `water_creature`, `ambient`, else `mob`), plus `modId` / `modEntityTypeId` for your EntitySpawn naming (brief item 6). Please confirm that FML EntitySpawn gives you `modId` as the mod container id string; my table is keyed `(modId, modEntityTypeId)` from `EntityRegistry.lookupModSpawn`.
3. **harness-ops: G2 naming adapter** (answered by message on 2026-11-01; adopted in their PR #36; their 30-pair `VANILLA_SAMPLE` matches my table and is pinned by a test in #37): `toNew`/`toOld` and `registryName` from `packages/rotn-data/index.js`; unmappable is `null`. `packages/rotn-data/vanilla/flattening-items.json` is the expected-name table. A `common-mobs.json` comes from the dump's spawn lists after the first dump run.

4. **net-forge: one line in `initBot`** (yours) for item 4. The helpers in `mcdata.js` read the private `mcdata` set in `initBot`'s `login` handler (`mcdata = minecraftData(mc_version)`). Please make the module read `bot.registry` instead, after your extension (for example `mcdata = bot.registry` in that handler, refreshed on `forge_registry`). Or, if you prefer, I export `setRegistry(registry)` from the helper part and you call it there. I then change only the helper functions, keeping their signatures.

5. **Lead: a follow-up ADR to ADR 0004's build pin.** ForgeGradle 2.3 cannot build for Forge 14.23.5.2860 any more: maven.minecraftforge.net serves only `userdev3` for that build (FG 2's `userdev` is 404), and harness-ops' CI trial failed exactly there (run 41338011357). The official 2860 MDK uses ForgeGradle 3 on Gradle 4.9. #34 now pins ForgeGradle 3.0.197, Gradle 4.10.3 (SHA-256 checked), JDK 8, MCP stable 39-1.12. Everything else in ADR 0004 is unchanged.

## Paid test-server plan (needs the lead's written GO; not started)

- **Purpose:** first RotN 3.3.4 dump (brief item 1).
- **Prerequisite:** the jar from Request 1's workflow. Preflight must pass on its own; no `--skip-sweeper-check`. `deploy/test-server.sh` unchanged.
- **Command** (from a clean checkout of develop with the dumper merged):

  ```sh
  timeout 3600 deploy/test-server.sh run --ttl-hours 2 --yes \
    --extra-mod "$JAR" -- tools/dumper/run-dump.sh "$OUT"
  ```

  `run-dump.sh` creates the opt-in marker `rotn-dump.enable` and types `rotndump`. It then waits for `rotn-dump/DONE` (20 min limit) and fetches `rotn-dump/` and `logs/latest.log`. This follows PR #34 review item 2: no fetch before DONE.
- **Type:** CPX42 (nbg1), the default. **TTL:** 2 h. **Expected:** 20-30 min (build like G0/G1 plus about 2 min of dump). **Max cost:** 2 billed hours, about EUR 0.28 plus the Primary IPv4.
- **After:** `hcloud server list`, `primary-ip list` and the labelled `ssh-key list` are empty; outputs are imported with `packages/rotn-data/tools/import-dump.mjs` and committed in a PR with the manifest.
- **Plan B (dropped):** building on the test server would need a JDK 8 build environment there, which `deploy/test-server.sh` does not install. harness-ops is adding the `dumper-build` workflow (lead, 2026-11-01).

## Open PRs

- #34 RotN dumper mod (brief item 1, ADR 0004).
- #37 data package, name translation, catalog, dump importer (brief items 2-3). Review fixes 1, 2, 7 at `d416177`; 3-5 are follow-ups above.
