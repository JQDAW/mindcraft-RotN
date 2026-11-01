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

- **PR (this branch, `agent/rotn-data/g2-dumper`): the dumper mod** (brief item 1, ADR 0004) in `tools/dumper/`. Source, pinned build script and docs; not compiled yet (no JDK 8 here). See "Requests" 1 and the run plan below.
- **Next PR (`agent/rotn-data/data-package`): `packages/rotn-data`**, items 2 and 3. Translation API `toNew`/`toOld` (643 vanilla item pairs, a clean bijection), catalog API, names from the real capture, script cross-check fixtures, 21 offline tests. The dump-dependent acceptance tests skip until a dump is imported.
- Then item 4: the `mcdata.js` helpers on `bot.registry`, after net-forge's PR #25 merges.

## Blocked

- The real dump needs the dumper jar, and building it needs JDK 8 (since 2026-11-01). Unblocked by Request 1, or by a build on the test server (Plan B below).

## Requests to other agents or the lead

1. **harness-ops (via lead): a `workflow_dispatch` workflow that builds the dumper jar with JDK 8** and uploads it as an artifact. Proposal ready to copy: `tools/dumper/ci/dumper-build.yml.proposed` (no secrets, read-only token; please pin the actions by SHA). It runs `tools/dumper/build.sh`, which pins Gradle 4.10.3 by SHA-256.
2. **net-forge: the data shape for `extendRegistry(..., { properties })`.** I will hand you `properties` built from the dump, keyed by full registry name as your README says:
   - blocks: `hardness`, `resistance`, `material` (prismarine material string, e.g. `rock`, `wood`, `plant`; modded materials as `modded:<class>`), `diggable` (hardness >= 0), `boundingBox` (`block` / `empty` from the collision box), `shapes`, `transparent`, `emitLight`, `filterLight`, and `harvestTools` as `{itemId: true}` built from item tool levels. The numbers need bot.registry's item ids, so I build them **after** your extension, through a second call `extendRegistry(bot.registry, snapshot, { properties })` or a small `applyProperties(registry, properties)` from you. Which do you prefer?
   - items: `stackSize`, `maxDurability`.
   - entities: `type` (`hostile` for `IMob`, `animal`, `water_creature`, `ambient`, else `mob`), plus `modId` / `modEntityTypeId` for your EntitySpawn naming (brief item 6). Please confirm that FML EntitySpawn gives you `modId` as the mod container id string; my table is keyed `(modId, modEntityTypeId)` from `EntityRegistry.lookupModSpawn`.
3. **harness-ops: G2 naming adapter** (answered by message on 2026-11-01): `toNew`/`toOld` and `registryName` from `packages/rotn-data/index.js`; unmappable is `null`. `packages/rotn-data/vanilla/flattening-items.json` is the expected-name table. A `common-mobs.json` comes from the dump's spawn lists after the first dump run.

## Paid test-server plan (needs the lead's written GO; not started)

- **Purpose:** first RotN 3.3.4 dump (brief item 1).
- **Prerequisite:** the jar from Request 1's workflow (or Plan B). Preflight must pass on its own; no `--skip-sweeper-check`. `deploy/test-server.sh` unchanged.
- **Command** (from a clean checkout of develop with the dumper merged):

  ```sh
  deploy/test-server.sh run --ttl-hours 2 --yes \
    --extra-mod "$JAR" --wait 180 --console rotndump \
    --fetch rotn-dump --fetch logs/latest.log --out "$OUT" -- true
  ```

  wrapped in `timeout 3600`.
- **Type:** CPX42 (nbg1), the default. **TTL:** 2 h. **Expected:** 20-30 min (build like G0/G1 plus about 2 min of dump). **Max cost:** 2 billed hours, about EUR 0.28 plus the Primary IPv4.
- **After:** `hcloud server list`, `primary-ip list` and the labelled `ssh-key list` are empty; outputs are imported with `packages/rotn-data/tools/import-dump.mjs` and committed in a PR with the manifest.
- **Plan B (no CI):** the same run with `-- bash -c '<ssh build on the server>'` would need `deploy/test-server.sh` to install a JDK 8 build environment there, which it does not do. So Plan B needs harness-ops' help too; Request 1 is preferred.

## Open PRs

- (this branch) RotN dumper mod, brief item 1, ADR 0004.
