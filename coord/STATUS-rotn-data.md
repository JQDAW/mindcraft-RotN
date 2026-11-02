# Status: rotn-data

Updated: 2026-11-02T02:42Z (from `date -u`)

Worktree `C:/Users/admin/orca/workspaces/mindcraft-RotN/rotn-data-g2`. G2 brief items: (1) dumper, (2) data package, (3) name translation, (4) `mcdata.js` name/registry helpers on `bot.registry`.

## Done

- **#34 merged** (`3158776`): the dumper mod, `tools/dumper/`. It is opt-in, writes in batches with `.tmp` + rename and `DONE` last, and builds with ForgeGradle 3.0.197 (the lead accepted it and writes the ADR 0004 addendum).
- **#37 merged** (`441020b`): `packages/rotn-data`, with translation, catalog, importer and the scripts cross-check fixture.
- **#43 merged**: translation follow-ups 4-6 (reverse coverage, strict block metas, the export-contract test).
- **#44 merged**: brief item 4. The `mcdata.js` helpers read `bot.registry` (via #46's `mcdata = bot.registry`); `toNew`/`toOld` are the agent's naming API; `resolveName` handles the names that mean different things in 1.12 and 1.21. Lint baseline 255.
- **#47 merged** (`7978d27`): the first dump import, `common-mobs.json`, acceptance tests on.
- **#55 merged** (`59f9271`): the second dump's import, the importer's jar check and raw SHA-256s.
- **#59 merged**: canonical list order in the importer, `maxTickMs` and the sorted recipe sample in the dumper, the corrected first-vs-second dump comparison.
- **#62 merged** (`b47449e`): entity threat overrides beyond IMob, cited from the mods' bytecode (13 entries; dangerous: fire and ice dragons, sea serpent, death worm, cockatrice; 33 reviewed and not marked, among them the 24 Animania rabbits, whose player targeting is only for a rabbit named "Killer"). It also marks the vanilla animals Animania replaces (chicken, cow, pig, rabbit, sheep; `config/animania.cfg` lines 104-119; G2 batch 1) and leaves them out of `common-mobs.json`.
  - Correction to its PR description's condition table: the cockatrice's player-targeting task, `CockatriceAITarget(EntityLivingBase, EntityCockatrice$1)`, is at bytecode **253**. Offset 183 is `CockatriceAITargetItems` (item targeting), which my checker's name match also caught. Neither has a branch that skips it, so the classification stands. The offset is now in the `entity-overrides.json` evidence.
- **#80 merged** (`ef84946`): the `state-meta-remap` dumper part (dumper 0.2.0), `stateMetaRemap()`/`clientMeta()`/`networkRemap()`, and the importer checks.
- **Third dump batch (state-meta-remap): PASS** (lead's written GO 02:33 UTC; record below). Imported in this PR, which replaces the second dump.
- **#68 merged** (`7d33cee`): the cockatrice offset correction (above).
- **#48 merged** (`7f0feef`): the dumper's per-tick time cap, per-entry isolation and `serializers.json`; the importer requires `serializers.json` and blocks on `entryErrors`.
- **First RotN 3.3.4 dump batch: PASS** (lead's written GO, 2026-11-01 about 19:24 UTC, before the server was created at 19:25:54; record below).
- **Second dump batch (serializers): PASS** (lead's written GO 21:23 UTC; record below). It is imported in PR #55, which replaces the first dump.
- Re-checked against the pinned 3.3.4 zip (`unzip -p` into a scratch folder outside the repo; nothing run): the early recipes (file:line in `packages/rotn-data/test/fixtures/scripts-3.3.4-early-recipes.json`), the mining level names, and the section-4 names. Stone Kiln is `pyrotech:stone_kiln`; the bundle is `bundles:bundle`.

## Dump batch record (2026-11-01)

| Item | Value |
| --- | --- |
| Checkout | separate scratch worktree, detached at origin/develop `a4720df` (contains `3158776`); removed afterwards |
| Jar | dumper-build push run **41341359100** (develop `3158776`, success), `rotndump-0.1.0.jar`, 53,939 bytes, SHA-256 `2d32ee409612f78195ff5b7fffbf2695cc37582499945e28268f9eca3190b94c`, recorded before the batch |
| Command | `timeout -s TERM -k 120 2700 deploy/test-server.sh run --type cpx42 --location nbg1 --ttl-hours 2 --yes --extra-mod <jar> -- bash tools/dumper/run-dump.sh <scratch out>`. The timeout was 45 min instead of the planned 60, enforcing the lead's 45-minute stop. `deploy/test-server.sh` unchanged. |
| Preflight | passed on its own: "sweeper OK (via cadence): 3 dispatch runs on develop in the last 50 min, gaps 15.4, 14.5 min, newest 41340802227 10.3 min ago". No `--skip-sweeper-check`. |
| Before | the project was empty (server and Primary IP lists empty; labelled list empty) |
| Times (UTC) | command start 19:25:45; server `mcr-test-20261101-192546` (id 174013935, CPX42, nbg1) created 19:25:54; jar uploaded 19:27:20; ready 19:29:32; `rotndump` scheduled 19:29:34; `DONE` 19:29:37; fetch done, delete started 19:30:03; server, Primary IPv4 and SSH key verified gone 19:30:18 |
| Duration and cost | ran 4 min 33 s; 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. Primary IPv4), against a maximum of EUR 0.28 + IPv4 |
| After (19:30:31) | `hcloud server list`, `primary-ip list` and `ssh-key list -l purpose=mindcraft-rotn-test` all empty |
| Live server | not touched; no bot login (no FRCFLD) |
| Manifest | `dumperJar.sha256` = `2d32ee40...b94c`, **matches** the artifact; Forge 14.23.5.2860; 347 mods (the 346 of the pack + rotndump); **0 errors** |
| Raw output | `rotn-dump/` (32 MB) and `latest.log` stay in my scratchpad, out of git; only `import-dump.mjs`'s output is committed |

`manifest.timing` per part (batch 500; the 9 parts took 3,226 ms in total):

| Part | Entries | ms | Ticks |
| --- | --- | --- | --- |
| oredict | 2347 | 53 | 5 |
| blocks | 4896 | 738 | 10 |
| items | 9710 | 790 | 20 |
| recipes | 6089 (plus 4598 empty CraftTweaker dummies skipped) | 574 | 22 |
| smelting | 1530 | 53 | 4 |
| entities | 971 | 54 | 2 |
| spawns | 175 | 63 | 1 |
| manifest | 1 | 13 | 1 |

Import: every block, item and entity name agrees with the RegistryData capture. All 8 script cross-checks pass (crude axe, Crafting Tools, crafting table, rocks to cobblestone, stone pickaxe, stone axe, sticks, furnace). All 15 acceptance tests pass.

Known gaps, pinned in `packages/rotn-data/test/fixtures/harvest-known-gaps-3.3.4.json`:

- 30 of 23,499 states, in 5 blocks, have `null` hardness (tile-entity blocks: Aether chests, BWM waterwheel and windmill, ...). (An earlier count of 39 wrongly included the 9 blocks below.)
- 9 blocks have no metadata-consistent state (BetterNether and Growthcraft half slabs, `betterwithmods:blood_leaves`, `twilightforest:force_field`).

None is a natural surface block. 20 recipes do not match their own sample grid (`matchesSample: false`); they are for skills-rotn to check if one matters.

## Second dump batch record (serializers dump, 2026-11-01)

| Item | Value |
| --- | --- |
| GO | lead's written GO, 21:23 UTC (second dump batch, the same plan with the new jar) |
| Checkout | separate scratch worktree, detached at origin/develop `7f0feef` (#48); removed afterwards |
| Jar | dumper-build push run **41351598338** (develop `7f0feef`, success), `rotndump-0.1.0.jar`, 58,632 bytes, SHA-256 `438b3ce64107f680ea7eefe6d143234b12eb140f89f4fd12d3ca3e72e8a47d33`, recorded at 21:23:27, before the batch |
| Command | `timeout -s TERM -k 120 2700 deploy/test-server.sh run --type cpx42 --location nbg1 --ttl-hours 2 --yes --extra-mod <jar> -- bash tools/dumper/run-dump.sh <scratch out>`; `deploy/test-server.sh` unchanged |
| Preflight | passed on its own: "sweeper OK: scheduled run 41351011439 on JQDAW/mindcraft-RotN succeeded 8 min ago (limit 120 min)". No `--skip-sweeper-check`. |
| Before (21:23:27) | server, Primary IP and labelled SSH key lists empty |
| Times (UTC) | command start 21:23:43; create `mcr-test-20261101-212345` (id 174032053, CPX42, nbg1) 21:23:50; jar uploaded 21:25:01; ready 21:26:57; `rotndump` scheduled 21:26:59; `DONE` about 21:27:04 (5,300 ms after scheduling); delete started 21:27:29; server, Primary IPv4 and SSH key verified gone 21:27:46 |
| Duration and cost | 4 min 3 s; 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. Primary IPv4); maximum was EUR 0.28 + IPv4 |
| After (21:27:56) | server, Primary IP and labelled SSH key lists all empty |
| Manifest | `dumperJar.sha256` = `438b3ce6...7d33`, **matches**; Forge 14.23.5.2860; 347 mods; **0 errors, 0 entryErrors** |
| Raw output | `rotn-dump/` and `latest.log` in my scratchpad, out of git |

`manifest.timing` (batch 500, tick budget 40 ms). That dumper (0.1.0 at `7f0feef`) recorded total ms and ticks per part, **not the max of a single tick**, so the average per tick is shown. A tick can exceed 40 ms by at most the time of one entry, because the cap is checked after each entry; serializers averaged 45 ms. Since this PR the manifest records `timing.<part>.maxTickMs`; it shows from the next batch.

| Part | Entries | ms | Ticks | Avg ms/tick |
| --- | --- | --- | --- | --- |
| oredict | 2347 | 36 | 5 | 7 |
| blocks | 4896 | 523 | 14 | 37 |
| items | 9710 | 745 | 27 | 28 |
| recipes | 6089 | 531 | 24 | 22 |
| smelting | 1530 | 38 | 4 | 10 |
| entities | 971 | 43 | 2 | 22 |
| spawns | 175 | 41 | 1 | 41 |
| serializers | 3 entities with modded keys (971 constructed) | 1168 | 26 | 45 |

**DataSerializer ids** (`serializers.json`, for net-forge):

| Id | Class | Mod |
| --- | --- | --- |
| 14 | `com.fuzs.aquaacrobatics.network.datasync.PoseSerializer$1` | AquaAcrobatics (pose) |
| 15 | `com.teamacronymcoders.base.entities.dataserializers.ResourceLocationDataSerializer` | Base (teamacronymcoders) |
| 16 | `com.bobmowzie.mowziesmobs.server.ServerProxy$1` | Mowzie's Mobs |
| 17 | `pl.asie.charset.lib.utils.DataSerializersCharset$1` | Charset |
| 18 | `requious.util.ExtraSerializers$1` | Requious |
| 256 | `doggytalents.serializers.TalentListSerializer` | Doggy Talents (Forge registry) |
| 257 | `doggytalents.serializers.OptionalTextComponentSerializer` | Doggy Talents (Forge registry) |

Ids 0-13 are vanilla. Registered entities that use a modded serializer: `doggytalents:dog` (index 21 → 256, index 30 → 257), `mowziesmobs:barakoaya` (index 16 → 16), `requious:spear` (index 8 → 18). No registered entity uses 14, 15 or 17. Players are not in the entity registry, so AquaAcrobatics' 14 (the player pose) does not show up in `usage`.

**First vs second dump** (corrected after the PR #55 review; my first text said "almost all list order", which overstated it).

- **The same:** names and counts, all 8 cross-checks, the known harvest gaps, `entities.json` and the recipe id set.
- **List order only** (mod hash sets): ore dictionary stacks, ingredient stacks, spawn lists (MultiMob's types), and the furnace list order. Since this PR the importer sorts these (`canonicalize`).
- **Real differences between two starts of the same pack:**
  - **CraftTweaker recipe ids are rebound.** 100 recipes keep their content but sit under different auto-generated ids, e.g. `crafttweaker:rustic_chair_0` made `rusticcompat:chair_cyan_stained` in the first dump and `chair_lime_stained` in the second. **Recipe ids from CraftTweaker are not stable keys**; match recipes by result and ingredients.
  - **`hammersmashing*` `remaining`.** The sample grid used the first stack of an unsorted ore list, so the reused hammer was `pyrotech:diamond_hammer` in one dump and `spartancompat:hammer_onyx` in the other. Fixed in the dumper in this PR: it samples the first stack in sorted order. The next batch shows it.
  - **The rat-nugget ore variant.** `ratPoop` ore entries and 11 `rats:rat_nugget_ore` furnace recipes carry a different `OreItem` in NBT.
  - **`wards:enchanted_paper`.** Its enchanted-book ingredient stacks carry **numeric enchantment ids** in NBT, e.g. id 113 in one dump and 117 in the other, for 18 of 380 stacks. Numeric ids are per server, as ADR 0004 says.
  - **World or random values:** `betterwithaddons:world_scale_ore` hardness (225 vs 15) and `randomthings:spectrecoil_number`.

## Third dump batch record (state-meta-remap dump, 2026-11-02)

| Item | Value |
| --- | --- |
| GO | lead's written GO, 02:33 UTC (third dump batch, the plan of the second) |
| Checkout | separate scratch worktree, detached at origin/develop `ef84946` (#80); clean; removed after the batch |
| Jar | dumper-build push run **41378074076** (develop `ef84946`, success), downloaded with `gh run download`; `rotndump-0.2.0.jar`, 62,963 bytes, SHA-256 `3d25f2d74a783495e86f62820c872a63c4095e158377ea089bef1e95a41031a7` (the same hash the run's log prints), recorded at 02:33:06, before the batch |
| Command | `timeout -s TERM -k 120 2700 deploy/test-server.sh run --type cpx42 --location nbg1 --ttl-hours 2 --yes --extra-mod <jar> -- bash tools/dumper/run-dump.sh <scratch out>`; `deploy/test-server.sh` identical to develop |
| Preflight | passed on its own: "sweeper OK: scheduled run 41369381802 on JQDAW/mindcraft-RotN succeeded 102 min ago (limit 120 min)". No `--skip-sweeper-check`. |
| Before (02:33:16) | server, Primary IP and labelled SSH key lists empty; nothing else running |
| Times (UTC) | command start 02:33:38; server `mcr-test-20261102-023339` (id 174074075, CPX42, nbg1, delete-after 04:33:43) create requested 02:33:44, created 02:33:54; jar uploaded 02:35:10; ready 02:37:04; `rotndump` scheduled 02:37:07; `DONE` 02:37:20; fetch done 02:37:48; delete started 02:37:49; server, Primary IPv4 and SSH key verified gone 02:38:04 |
| Duration and cost | ran about 4 min (02:33:44 to 02:38:04); 1 billed hour, about **EUR 0.14** (EUR 0.1381 excl. Primary IPv4), against a maximum of EUR 0.28 + IPv4 |
| After (02:38:12) | `hcloud server list`, `primary-ip list` and `ssh-key list -l purpose=mindcraft-rotn-test` all empty |
| Live server | not touched |
| Manifest | dumper 0.2.0; `dumperJar.sha256` = `3d25f2d7...31a7`, **matches** (`import-dump.mjs --jar-sha256` accepted it); Forge 14.23.5.2860; 347 mods; **0 errors, 0 entryErrors** |
| Import | `import-dump.mjs`: no problems, every scripts cross-check ok; one note (Quark flowerpot ids, below) |
| Raw output | `rotn-dump/` (32 MB) and `latest.log` stay in my scratchpad, out of git |

`manifest.timing` (batch 500, 40 ms budget; 12,980 ms in total, most of it waiting between ticks):

| Part | ms | ticks | maxTickMs |
| --- | --- | --- | --- |
| oredict | 28 | 5 | 15 |
| blocks | 533 | 14 | 42 |
| items | 754 | 26 | 69 |
| recipes | 544 | 24 | 72 |
| smelting | 23 | 4 | 12 |
| entities | 43 | 2 | 28 |
| spawns | 42 | 1 | 33 |
| serializers | 1,179 | 27 | 86 |
| state-meta-remap | 42 | 157 | 12 |
| manifest | 11 | 1 | 11 |

Ticks over the 40 ms budget: one entry can exceed it, because the budget is checked after each entry (the serializers part constructs entities; 86 ms at most).

**state-meta-remap summary:** `scanned` = 4,896 blocks, 24,011 network ids that resolve to a state, 220,349 valid states. **506 records** over **132 blocks**; 184 of them are ids the server actually sends (`networkId == stateNetworkId`). `anomalies`: encodingMismatches **0**, foreignStates **0**, so the `id << 4 | meta` encoding holds under REID. **double_plant: 8, 9 and 11 map to 10** (all three resolve to `minecraft:double_plant[facing=north,half=upper,variant=sunflower]`, which is sent as 2811 = `175 << 4 | 11`); 10 is not remapped.

Blocks with a remap (`idMeta>stateMeta`; `*` = the id the server sends for that state):

- **minecraft (3):** `double_plant` 8>10 9>10 11>10\*; `flower_pot` 1..15>0 (15\*); `tripwire` 2>0 3>1 6>4 7>5 10>8 11>9 14>12 (Forge's tripwire special case; none is sent).
- **pyrotech (10), early game:** `worktable`, `worktable_stone`, `crate`, `crate_stone`, `stash`, `stash_stone`, `soaking_pot`, `bellows`, `wood_rack`: 0>1\* 1>2\* 2>0\*; `drying_rack` 8>0\* 9>1\* 10>2\* 11>3\*.
- **artisanworkstumps (17):** every `workstump_*` (basic, blacksmith, carpenter, chef, chemist, designer, engineer, farmer, jeweler, mage, mason, potter, scribe, tailor, tanner), `log_basin`, `stone_basin`: 0>1\* 1>2\* 2>0\*.
- **quark (16):** `colored_flowerpot_<16 colours>`: 1..15>0 (15\*), like the vanilla flower pot.
- **earthworks (45):** every `doubleslab_*`: 0>1 (not sent).
- **twilightforest (4):** `aurora_block` 1..15>0 (15\*); `double_aurora_slab` 1>0\*; `force_field` 0..4>10..14\*, 5..14>0..9\*; `trophy_pedestal` 0>4 1>5 2>6 3>7.
- **betterwithmods (4):** `blood_leaves` 0>4\* 4>0\* 8>12\* 12>8\*; `screw_pump` 3>5\* 4>3\* 5>4\* 11>13\* 12>11\* 13>12\*; `steel_broken_gearbox`, `wooden_broken_gearbox` 4>0\* 5>1\* 12>8\* 13>9\*.
- **dungeontactics (9):** every `trap_*` (ailment, ambush, boom, clamp, fire, foul, piston, port, spectral): 3>2\*.
- **betternether (6):** five `*_slab_half` 0>1\* 1>0\*; `lucis_spore` 2>3\* 3>2\*.
- **animania (3):** `block_hive`, `block_wild_hive` 0>2 1>2; `block_trough` 0>3 1>4 3>5\* 4>3\* 5>4\*.
- **cyclicmagic (3):** `target`, `wireless_receiver`, `wireless_transmitter` 1>0\*.
- **growthcraft (6):** `growthcraft_apples:apple_sapling`, `growthcraft_cellar:cork_sapling` 8>0\*; `apple_slab_half`, `bamboo_slab_half` 1>2\* 2>1\*; `native_grape_vine0`, `native_grape_vine1` 2>0\* 3>1\*.
- **others:** `aether_legacy:treasure_chest` 2>3 4>3 5>3\*; `exsartagine:smelter` 8..15>0..7\*; `iceandfire:dread_stone_face` 4>0\* 6>4\*; `rustic:ironwood_doubleslab`, `rustic:olive_doubleslab` 0>1; `stygian:endleaves` 4>0 8>0 12>0\*.

**Ids on another server.** The 16 Quark colored flowerpots have block ids 1203-1218 on the test server but 1263-1278 in the registry capture (`registry-names.json`); every other remapped block has the same id. So the ids do differ between servers, and forge-bridge must build network ids from the connected server's registry (`networkRemap(blockIds)`), never from `records[].networkId`.

**Other differences from the second dump** (`scratchpad` diff; nothing missing, counts equal):
- recipes: 740 changed. 638 only in `remaining`: the dumper now samples each ingredient's first stack in sorted order (#59; this is the first batch with it), e.g. `animania:hamster_ball_colored_alt` now leaves a glass bottle. 100 in `result`/`slots`: CraftTweaker rebound the generated ids `crafttweaker:rustic_chair_*` and `rustic_table_*` to other colours (known). One: `rats:rat_nugget_to_seed` (rat-nugget NBT).
- oredict `ratPoop` and 14 smelting entries: the rat-nugget `OreItem` NBT (known).
- blocks/items: `betterwithaddons:world_scale_ore` hardness 15 -> 225 and `randomthings:spectrecoil_number` names (world or random values, known).
- entities, spawns and serializers: unchanged. `common-mobs.json`: only its dump stamp changed.

## Doing

- This PR: the third dump's import (it replaces the second) and the #80 review nits. Then hold for the lead.
## Follow-ups (later PRs)

- ~~Importer: sort order-unstable lists~~: done in this PR (`canonicalize`).
- **Dumper:**
  - ~~record `maxTickMs` per part~~: done in this PR (needs a batch to show);
  - default-state fallback for the 9 blocks without a metadata-consistent state;
  - item-based hardness for the 30 null-hardness tile-entity states (5 blocks).
- **#34 review follow-up 3:** expand the wildcard meta 32767 in recipe stacks at import.
- **net-forge:** the `extendRegistry`/`applyProperties` properties from the dump (Request 2).
- **skills-rotn:** Mindcraft's `'grass'` in `skills.js:706` means the plant (`tallgrass` in 1.12). `resolveName(name, kind, { prefer: 'new' })` is for names the LLM wrote.

## Blocked

- Nothing.

## Requests to other agents or the lead

1. ~~harness-ops: dumper-build workflow~~: done (#40).
2. **net-forge: properties for `bot.registry`.** The dump exists. I can build `properties` for your `applyProperties` (#46), keyed by full registry name:
   - blocks: `hardness`, `resistance`, `material` mapped to prismarine strings, `diggable`, `boundingBox`, `harvestTools`;
   - items: `stackSize`, `maxDurability`;
   - entities: `type`.

   Tell me the exact field set you want. `modEntityTable()` gives `{modId: {modEntityTypeId: name}}`. `serializers()` gives the DataSerializer table (ids 14-18 and 256/257 are in the second-dump record above).
3. ~~harness-ops: G2 naming adapter~~: done (PR #36). `common-mobs.json` exists.
4. ~~net-forge: initBot uses bot.registry~~: done (#46).
5. ~~Lead: ADR 0004 addendum (FG3)~~: accepted; the lead writes it.
6. ~~Lead: lint baseline for #44~~: approved and done (255).

## Open PRs

- This PR (`agent/rotn-data/dump3-import`): the third dump's import, and the #80 nits (`stateNetworkId >> 4 === blockId` in the importer; `clientMeta` checks that `idMeta` is an integer 0-15).
