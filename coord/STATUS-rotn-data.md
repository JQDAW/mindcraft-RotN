# Status: rotn-data

Updated: 2026-11-05T20:54Z (from `date -u`)

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
- **Third dump batch (state-meta-remap): PASS** (lead's written GO 02:33 UTC; record below).
- **#82 merged** (`761e954`): the third dump's import (replaces the second) and the #80 import nits (`stateNetworkId >> 4 === blockId`; `clientMeta` checks `idMeta`).
- **#153 merged** (`ad169c7`): Request 10, the plan reads ingredient metas (with skills-rotn #156). My last two STATUS commits on that branch (`e019e683`, `817cacfc`, the restart point) came after the squash merge; they are brought over in #172.
- **#143 merged** (`49ec671`): Special Mobs enderman and witch class rules (follow-up 2).
- **#152 merged** (`0edfd8d`): mixed ore-dictionary slots (single-kind variants first, no same-item wildcard mixes) and `canFill`.
- **#142 merged** (`89f3ef6`): the rock-pile rule names the Underground Biomes rock piles, and the rock-pile and stone rules say which metas give a rock (`ore`, `inOre`).
- **#140 merged** (`c114b44`): the G3 research note (STATUS only).
- **#138 merged** (`27403a2`): the initBot recipe tests restore the shared recipe table after each test.
- **#136 merged** (`fedab3d`): atomic recipe install with restore, fail-soft lazy build, injected catalog used.
- **#130 merged** (`8557060`): `initBot` installs RotN recipes once per login (lead exception, Request 7), with the #127 nits.
- **#127 merged** (`f457642`): `mustCollectManually` on RotN names (no collision box: dug in place).
- **#125 merged** (`0a94411`): `isHuntable` reads the 1.12 baby flag (metadata index 12, cited); `isBaby` exported.
- **#111, #114, #115, #118, #120 merged**: first-night threats and their cited follow-ups (`threatOf`, `nightThreats`, `threat-reactions.json` with `verified` entries from the mods' bytecode; #120 is `f74db6b`).
- **#112 merged**: #102 follow-ups (crafting table and sticks tests; the `outShape` note). Follow-up: the reviewer's nit on that comment.
- **#107 merged**: Phase 3 PR 2, `howToGet`, `rockRecipes`, `world-sources.json` (review fixes: no flint in the rocks rule, raw iron inferred, per-pair confidence, bare rock names narrowed).
- **#102 merged** (`b5a21fa`): Phase 3 PR 1, RotN recipes in `bot.registry` (`installRecipes`, `mcdata.installRotnRecipes()`), results carry `meta`, plan cycle guard without a depth limit. Not called yet (Request 7).
- **#91 merged**: the #87 nits (the `mapIds()` comment, README row).
- **#87 merged** (`0710480`): the #80 Java dumper nits, dumper **0.2.1**. Map size vs ids scanned: `scanned.mapIds` and `anomalies.unscannedIds = mapIds - networkIds`; the importer blocks unless it is 0 (null or missing counts as non-zero; a 0.2.0 dump gets a note). The map's `size()` (distinct states) is not compared, because Forge never removes stale states from it. `checkEncoding` guards each state; an entry that throws rolls back the counters. The first push did not compile (the map's iterator yields `Object`), so the fix in `0a10569` loops over `Object`. CI built `rotndump-0.2.1.jar`, SHA-256 `232c3ad2de73191532f73435196c522eaafb2b7ff5751bbe3a3cf64fbcf04aba` (run 41458632441). No batch needed; it shows on the next dump.
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

## Restart point (resumed 2026-11-05 after the Orca restart)

- **Worktree:** branch `agent/rotn-data/status-idle`, from develop after #213 (`1dfef62d`); STATUS only, no PR (rides with the next one). No background jobs, no subagents (the lead reviews).
- **#193 merged** (`4432cef`), **skeleton horse (lead's GO: hostile with a cited override):** `entity-overrides.json` `minecraft:skeleton_horse` (targetsPlayers, verified from specialai-1.1.0 `AIHandler` depacify bytecode; Special_AI.cfg lines 16 and 25, hordes.cfg line 134) and a `fight` entry in `threat-reactions.json`. Tests: the entity-threats pinned list (14 entries); threats.test.js's "class rules apply to hostile mobs only" check now uses a temporary probe rule (wither skeleton gets it, villager does not), because no non-hostile class in the dump matches a rule once the horse is hostile (a dump-derived list would have been empty). entity-threats 6/6, threats 14/14, ESLint clean.
- **#200 merged** (`a0c16d29`), the #193 follow-up: `depacify_aggressive_chance=1.0` is on Special_AI.cfg line **16**, not 15 (checked in the pinned zip, SHA-256 `90642fd5...`): fixed in both skeleton horse citations (`entity-overrides.json`, `threat-reactions.json`), the zombie horse's (`threat-reactions.json`) and the entity-threats test comment. The other Special_AI.cfg and hordes.cfg line citations were checked against the zip; all correct.
- **#205 merged** (`6d2034c1`): the `falls` field. `3.3.4/falling-blocks.json`, built by `tools/build-falling-blocks.mjs --pack <pinned zip>` (reads every jar's class headers; the vanilla and Forge jars mapped with Forge's notch-to-SRG table; chains to `BlockFalling`). 144 falling blocks: 23 BlockFalling subclasses, 59 blocks of 15 reviewed classes with their own falling code (UB sands and gravels, Earthworks gabions, dragon egg, candle, bloom, lanterns, chandelier, scaffolding, PHC fruit, gravisand; offsets cited), 60 ContentTweaker blocks a script gives gravity (`scripts/contentweaker/simpleExtraBlocks.zs`, by line), 2 OSV ores on gravel/sand (`config/osv.cfg` line 282). 849 candidates ruled out with cited rules; 0 unreviewed. API: `falls()`, `fallInfo()`, `getBlock().falls`/`fallsWhen`. Tests: falling-blocks 5/5, all 12 rotn-data test files pass, ESLint clean, `--check` reproduces the file.
- **#209 merged** (`abfc27a7`), D1a: the pack's food values, cited per line, and an `avoid` field. `3.3.4/food-values.json` from `tools/build-food-values.mjs --pack <pinned zip>`. Two AppleCore listeners change the dump's vanilla values: Hunger Overhaul (HIGHEST) and HungerTweaker with the scripts' `foodValues` (LOWEST, so last; hunger cast to int). 297 foods from scripts (`scripts/food.zs`, `scripts/opItems.zs`; bread 3 / 0.2, cooked beef 2 / 0.2), 8 from Hunger Overhaul's vanilla table, 399 from its divide rule (`HungerOverhaul.cfg`); 753 HarvestCraft / Biomes O' Plenty foods no script sets are `not-computed` (Hunger Overhaul's tables for those mods not read). `avoidFood`: 14 items (vanilla bytecode, `scripts/events.zs` lines, cloudsbluff from the research). `installFoods(registry)` for mineflayer-auto-eat (Request 11). Tests: food-values 6/6, all rotn-data tests and mcdata.rotn pass, ESLint clean, `--check` reproduces the file.
- **#210 merged** (`87590ca1`), the #205 nits: `minecraft:snow_layer` falls (Snow Real Magic `ModSnowBlock`, gated on `config/snowrealmagic.cfg` line 10 `SnowGravity=true`, read at build time); falling entities now include any entity class named `Falling*` (SRM's `FallingSnowEntity` extends `Entity`), which also found Dynamic Trees' `EntityFallingTree`: 70 branches fall when the branch below is broken (`when: 'tree-felled'`), leaves, roots, rooty dirt and the trunk shell do not (reviewed, cited); `notReflected` lists Forge's binpatches (the vanilla jar is read unpatched), coremods/mixins, helper classes. 215 falling, 0 unreviewed. Tests: falling-blocks 6/6, all rotn-data and mcdata.rotn pass, ESLint clean, both `--check`s reproduce.
- **#213 merged** (`1dfef62d`), the #209 review nits: (1) `installFoods` bans nothing and is meta 0 only (a pufferfish shares the cod's entry): documented in `src/foods.js`, `index.js` and the README; the eating code must check `avoidFood(name, meta)` and set auto-eat's `bannedFood` from it (see Request 11). (2) `scriptWon` names the winning line per field for the 9 foods `food.zs` sets more than once (baked beets: lines 466, 468). (3) The build stops on a `HungerEvents.onGetFoodValues` / `onGetPlayerFoodValues` handler (comments ignored). Tests: food-values 7/7, ESLint clean, `--check` reproduces.
- **G3 smoke round 2 batch A deaths (lead request, 2026-11-05), branch `agent/rotn-data/death-zombie`:** "Zombie FRCFLD" is Zombie Players by Corosus (`mods/zombie_players-1.12.1-1.2.7.jar`), its own entity `zombie_players:zombie_player` (named "Zombie <player>" by its getDisplayName), not a renamed vanilla zombie, so no name rule. It spawns at any player death spot (unless within 32 blocks of the player's bed), never despawns, is a plain zombie with empty hands (20 health, 2 armor, attack 3, follow range 16) and cannot pick up items. Corpse Complex keeps armor, main hand and off hand; the rest drops and despawns after 600 s. The grove sprite (Primitive Mobs) only retaliates on a server: its player-targeting task is added under world.isRemote (client only), so the PR #62 'conditional' override was wrong and made threatOf say 'fight'. Moved to reviewedNotMarked; both get cited threat-reactions entries (grove sprite ignore-unless-provoked, zombie player fight). Tests: threats 15/15, entity-threats 6/6, threats-bosses 4/4, threats-parasite-weta 3/3, ESLint clean (targeted, smoke round 2 running).
- **Exact next step on resume:** the death-zombie PR is with the lead; fix review findings on its branch (never force-push). Otherwise idle; on a new lead request, branch from develop. The #210 falls follow-ups stay low priority. Open offer to the lead: read Hunger Overhaul's HarvestCraft / Biomes O' Plenty tables so the 753 `not-computed` foods get values (only if the lead wants it for D1a). Request 11 is closed (covered by #206, lead confirmed). No background jobs, no subagents, nothing uncommitted.
- **Scratch for these PRs (this session's scratchpad, `C:/Users/admin/AppData/Local/Temp/claude/593cb80f0a2fa303/58e02aa2-eb4f-4b10-a106-0e44e7aa3c41/scratchpad/`):** `jars/` (four mod jars from the pinned zip, SHA-256s in #178), `packfiles/` (pack configs and scripts), `mcp/` (MCP stable-39 CSVs), `meth.sh` and `summ.sh` (javap helpers), `out/*.json` (the cited entries as merged).
- **Rules in force:** never force-push (the lead's rule; denied once here); memory is tight, so targeted test files one at a time, no full suite or `npm ci` unless the lead says; no paid batch without a written GO.
- **Reusable scratch, outside the repo (my previous session's scratchpad, `C:/Users/admin/AppData/Local/Temp/claude/C--Users-admin-orca-workspaces-mindcraft-RotN-rotn-data-g2/385eb418-186a-499d-8a48-1cfbf1bc037d/scratchpad/`):**
  - `pack/pack.zip`: the pinned RotN 3.3.4 server pack, SHA-256 `90642fd5...f5205` (verify again before use), plus `charm.jar`, `specialmobs.jar`, `Frozen-Fiend-1.5.3.jar`;
  - `bc/summ.sh`: the javap summariser;
  - `bc/x/`: extracted classes;
  - the older mod jars are in session `2c454268-...`'s `scratchpad/modjars/`.

  `pack/pack.zip` is the source of the jars and configs used in #178 and #179.

## Doing

- **#188 follow-up (lead, agreed as drafted).** A class rule `ghast-blaze-variants` (pattern `(Ghast|Ghastling|GhastQueen|Blaze)$`, take-cover, ranged, inferred: every class extends vanilla EntityGhast or EntityBlaze and its base fires fireballs, read from the three jars) covers 11 ranged variants (8 Special Mobs, NetherEx's ghastling, Twilight Forest's tower and mini ghasts); after the #191 review (REQUEST CHANGES: my fighter-ghast claim was wrong, I had read only adjustTypeAttributes) a verified rule `melee-ghast-blaze-variants`, matched first, makes the six Special Mobs variants that call disableRangedAI() (fighter, baby, unholy ghasts; cinder, ember, jolt blazes) `fight`. NetherEx's Ghast Queen and Twilight Forest's Ur-Ghast (boss package classes) are `avoid` entries. README `threatOf` row updated; the cockatrice evidence names CockatriceAIAggroLook.shouldContinueExecuting (func_75253_b).
- **#191 merged** (`b586626`): the ghast/blaze rules above.
- **#187 merged** (`e600de0`) and **#188 merged** (`944c7b2`, with the zombie horse corrected to fight: The Hordes' MixinAbstractHorse gives it zombie AI, hordes.cfg line 131). **#186 review data requests (lead).** (1) #187: `threatOf` and `nightThreats` return `lookAt` (false: enderman, rifted enderman, Special Mobs enderman variants and ender creeper, cockatrice via its override, all cited); it also carries the sludge_wand line fix (180-198; my push to #185 came after it had merged). Review: REQUEST CHANGES (the override path), fixed. (2) #188: ender dragon and wither `avoid`, ghast and blaze `take-cover` (ranged), zombie horse `fight` (first `ignore`, corrected before merge: The Hordes makes it aggressive), gorgon `avoid` + `lookAt: false` (verified: its gaze kills a player who looks back).
- **#185 merged** (`ec75f23`), **the #178/#179 follow-up (lead, after merging both).** The two PR bodies are corrected: nothing calls `threatOf` yet, and the parasite fire line is described as a mechanism, not advice. In `threat-reactions.json`: the 4 `packfiles/scripts/fishsundeadrising.zs` citations now read `scripts/fishsundeadrising.zs`, the 4 Fish's entries from #178 name the jar as it is in the pack (`Fish's Undead Rising-1.3.2.jar`, not my scratch copy's name), and one "no vanilla jar in SCRATCH" is reworded. A test keeps scratch paths out. The README `threatOf` row names the parasite and weta.
- **#178 merged** (`38728f2`), **the last 14 overworld night defaults (lead's pick 1, G3 night survival).** Every mob `nightThreats()` listed with the default `fight` now has a cited entry: 12 `verified` from the mods' bytecode and the pack's configs, husk and zombie villager `vanilla`. Three workers did the first pass, one per mod group; I re-ran the deciding checks. The independent review re-checked 7 claims in the bytecode, and all held. APPROVE WITH NITS; the wording nits are fixed. Open points are in the evidence as "Not settled: ...". No overworld night threat is left to the default (test).
- **#179 merged** (`b66a2a8`), **parasite and weta (lead's pick 2).** Both read from Fish's Undead Rising's bytecode by me. Parasite: `fight`. It latches on by touch, infests (a slow hunger drain), bites for 1 and dies by itself unattached. 0-4 spawn from a dead zombie, frozen zombie or mushroom zombie (5%), or from any mob that dies infested. Weta: `ignore-unless-provoked`. It only retaliates, and it does not spawn naturally on this pack (`weta spawn rate`=0). Independent review: APPROVE WITH NITS (6 claims re-checked in the bytecode; all held). Nits fixed: the sand source (a dry-biome sand block, 1%), now cited; advice to kill an attached parasite, since each bite renews Infested; infested deaths leave parasites.
- **Done:** #172 merged (`81875ca`), the #152 nits.

The entries below are done; they are kept here as the record of how they work.

- **#145 review nit 1, mixed ore-dictionary slots (done: merged as #152; G3 crafting path).**
  - **What prismarine-recipe and mineflayer can express (no patch needed):**
    - a prismarine-recipe slot is one `RecipeItem` (`id`, `metadata`; `node_modules/prismarine-recipe/lib/recipe_item.js:3-5`);
    - metadata >= 32767 becomes `null` (`recipe.js:102-105`);
    - mineflayer fills each slot with `window.findInventoryItem(ingredient.id, ingredient.metadata)` (`node_modules/mineflayer/lib/plugins/craft.js:96`, `:112`), and `null` matches any meta of that one item (`node_modules/prismarine-windows/lib/Window.js:312`);
    - `recipesFor` keeps a recipe when `inventory.count(id, metadata)` covers each delta entry (`craft.js:224-233`; delta per id+metadata at `recipe.js:72`).

    So one slot accepts any meta of one item, but not two items. A mix of rock families needs recipe entries whose slots name different items, which the table can hold.
  - **Fix (rotn-data only):** `registry-recipes.js` also emits mixed variants for an ingredient that fills n >= 2 slots (multisets of its likeliest candidates, K as large as `C(K+n-1, n) <= 64` allows), ordered by cost after the uniform ones. Within a rank, wildcard candidates (a whole rock family) come first, so the three Underground Biomes families are among the K. Stone pickaxe and axe: 1 igneous + 2 metamorphic rocks and 2 sticks are now craftable by mineflayer's rule. Cobblestone still needs 4 rocks of one type (one recipe per type).
- **#152 review (REQUEST CHANGES) fixed:**
  - single-kind variants are enumerated exactly as on develop, and mixes only fill the room the cap leaves. Over all 6,089 recipes against develop's algorithm: no first variant changed, every develop variant kept in order, and 744 recipes gain mixes; the stone pickaxe and axe keep 78 single-kind variants and add 178 mixes;
  - no mix pairs a wildcard with a specific meta of the same item (0 such variants);
  - the candidate order is develop's again; only the mix pool prefers whole families.
- **New for skills-rotn #151 (lead's request):** `canFill(recipe | recipeId | howToGet craft way, stacks, { times })`, the same slot rule as the variants, with bipartite matching so one item is never counted twice; also `recipeById(id)`.
- **Request 10, the plan reads ingredient metas (done: merged as #153, with skills-rotn #156, the `!getCraftingPlan` caller fix):**
  - **How it works:** `getDetailedCraftingPlan` now keys ingredients like `world.getInventoryCounts` does (`name:meta` for items with subtypes, bare otherwise; a bare recipe key means any variant), and plans with the first recipe variant the inventory and leftovers can supply.
  - **Results:** a dirt clump (`pyrotech:rock:4`) no longer counts as a rock; a metamorphic rock does; 1 igneous + 2 metamorphic make a stone pickaxe (with #152).
  - **New export:** `getItemCraftingRecipeVariants(key)`. `getItemCraftingRecipes` (bare names, upstream shape) is unchanged.
  - **For skills-rotn (via the lead):** `!getCraftingPlan` (`src/agent/commands/queries.js:292`) passes `world.getInventoryTotals` (bare totals). A bare total of an item with subtypes cannot vouch for one variant, so it counts only towards any-variant needs (planks, sticks still plan as before; `names_e2e.test.js` passes). To get variant-checked plans for rocks, pass `world.getInventoryCounts(bot)` (variant keys). The target can stay bare.

- **Free** (lead, after #138). Low-priority offline task done: the research note below (STATUS only, no code).
- **Lead's pick, follow-up 1 (`agent/rotn-data/ub-rock-piles`; G3 critical path, skills-rotn B2 #141 uses the world rules):** the `rock-pile` rule names the Underground Biomes rock piles (`pyrotech_compat:rock_igneous`, `_metamorphic`, `_sedimentary`), per-pair `inferred`, cited from the dump (no collision box, hardness 0.1, no tool, each state drops its own item at the same meta, state names match item names) and S1-A (the metas seen near the G3 spawn). `pyrotech:rock` stays `documented`. Blocks item 1 below is done by it. Lead (for skills-rotn B2): the rock-pile and stone rules carry `ore: rock`, and `howToGet` ways list per block the metas that give a rock in the dump's `rock` ore dictionary (`pyrotech:rock` 0, 6, 8; the Underground Biomes piles every meta), with `inOre` on each listed block; the metas 4, 5, 7, 9 of a bare `pyrotech:rock` pile are not rocks. Cross-checked against the dump's drops and the crude axe's rock slot.
- **Follow-up 2 (`agent/rotn-data/ender-witch-rules`, #143; rebased onto develop after #142):** class rules `enderman-variants` (`Enderman$`, ignore unless provoked) and `witch-variants` (`Witch$`, take cover, ranged), confidence `inferred`. Verified from `specialmobs-1.0.4_for_mc1.12.2.jar` only that the targeting AI is vanilla. Each variant's extra behaviour, re-read in the bytecode after the #143 review, is in the rule's `variants` and `threatOf().variantNote`: the thief enderman teleports its target, the blinding enderman blinds within 12, the mirage enderman makes fakes, the undead witch spawns skeletons, the wilds witch spawns baby spiders and mounts, the domination witch pulls its target in from 10-14, the wind witch teleports itself. Witch spiders are not caught. Nothing in `src/agent` calls `threatOf` yet.

## G3 first-night path: what rotn-data has NOT cited yet (research note, 2026-11-02)

Offline, from:
- the committed 3.3.4 data;
- harness-ops' S1-A survey evidence (`test/evidence/s1/s1a-20261102/survey/result.json`; G2 world 1880465901402976865, radius 48 around the fresh spawn);
- the pinned pack's `config/Special_Mobs.cfg`. That is the file at that path **inside the server pack zip** (`RotN 3.3.4 Server Pack.zip`, SHA-256 `90642fd5...f5205`, URL in `deploy/test-server.sh`); it is not in the repo. Reproduce with `unzip -p <zip> config/Special_Mobs.cfg`; the line numbers below are in that file. "Cited" means an entry with evidence in `world-sources.json` or `threat-reactions.json` (documented, verified or vanilla); "inferred" and "default" are not.

**Blocks (G3: rocks to stone tools)**
1. **Underground Biomes rock piles: the main rock source at the G3 spawn, not in the cited rule.** S1-A (`result.json` `findings.rocks`, lines 84-95): 203 rock-pile blocks within 48 blocks, 200 of them `pyrotech_compat:rock_metamorphic`, `_igneous` and `_sedimentary`. The other 3 are `pyrotech:rock` meta 4 (the survey line `pyrotech:rock 4 3` is meta 4, count 3), which is a Dirt Clump, not a rock. `world-sources.json` `rock-pile` names only `pyrotech:rock`, so `howToGet('pyrotech_compat:rock_igneous:0')` shows the pile only as a `block-drop` (dump-sample). The dump: these blocks have no collision box (so `mustCollectManually` digs them in place), hardness 0.1, no tool, and their plain drop is the same item (meta 0 in the fixed-seed sample; the item meta per block meta is not verified). Their items are in the `rock` ore dictionary, so they make the crude axe and stone tools. Proposal: add them to the rock-pile rule as `inferred` (the research cites "rock piles" in general). Check the meta mapping in a G3 run.
2. **Underground Biomes stone to rocks: inferred.** The spawn stone is Underground Biomes stone (every G2 census). The pairs (e.g. `undergroundbiomes:igneous_stone:3` to `pyrotech_compat:rock_igneous:3`) come from dumped names; the sources name only `minecraft:stone`.
3. **Felling a tree: which log drops is inferred.** S1-A `findings.trees.types` (`result.json` lines 98-168) has 71 name+meta entries: 70 Dynamic Trees entries across 9 block names (8,186 blocks: branches, `trunkshell`, `rootydirt`, `rootydirtspecies`) plus `minecraft:log` meta 0 (335 blocks), 8,521 tree blocks in all. My count by these rules differs slightly from the #140 review's "69 entries in 8 names". The "31 Dynamic Trees types" I first wrote is from a G2 census (`coord/STATUS-harness-ops.md`), not from S1-A. The `fell-tree` pairs (branch to log) are by wood name, and the research marks the dropped log as UNVERIFIED.
4. **Sticks from Dynamic Trees leaves: unverified.** `sticks-from-leaves` lists `dynamictrees:leaves0/1`, but the research cites only "break leaves". The dump's plain drop of `dynamictrees:leaves1` is empty.
5. **Debarking and the first plank: only oak is documented.** The other woods' pairs are inferred, and planks per click are unverified.
6. **`pyrotech:rock_grass`:** in the S1-A census (unclassified). Its plain drop is itself; it is not in the `rock` ore dictionary. What it is, and whether it is a rock source, is not known.

**Mobs (G3: survive the first night)**
1. **Special Mobs variants: about 25% of each vanilla family in the Overworld, and most get only a default reaction.** `config/Special_Mobs.cfg` (in the pack zip, above): `_special_chance_exceptions` `dimension/overworld=0.25`. The lines: cave spiders 150, creepers 248, endermen 435, silverfish 688, skeletons 809, slimes 961, spiders 1085, witches 1246, zombies 1589. The global chance is 0.6, or 0 for witches and silverfish, but the more specific dimension setting wins (the file's own comment). The variants never appear in spawn lists (`NIGHT_THREATS_NOT_REFLECTED`).
   - Covered only by inferred class rules: the creeper variants (keep distance) and the skeleton variants (take cover).
   - Default `fight`, not cited: zombie (8), spider (11), cave spider (6), slime (8) and silverfish (6) variants.
   - **Inconsistent:** the 7 enderman variants get `fight`, though `minecraft:enderman` is `ignore-unless-provoked`; the 6 witch variants get `fight`, though `minecraft:witch` is `take-cover`. Proposal: class rules for `Enderman` and `Witch`, like the creeper and skeleton rules, then per-variant bytecode checks for the dangerous ones (e.g. `lightningenderman`, `dominationwitch`).
2. **14 spawn-list mobs still default to `fight`**, each under 1.5% of overworld monster weight. The percentages are rotn-data's `nightThreats()` over the dump's `packages/rotn-data/3.3.4/spawns.json.br` (each mob's `monster` spawn weight summed over the overworld biomes of `src/biomes.js`, as a share of all listed hostile weight). Reproduce with `node -e "import('./packages/rotn-data/src/catalog.js').then(({loadRotnData}) => console.log(loadRotnData('3.3.4').nightThreats({ limit: 100 })))"`: `mod_lavacow:zombiemushroom` 1.3%, `mummy` 1.0%, `zombiefrozen` 0.6%, `sludgelord`; `defiledlands:host`, `scuttler` 0.6%, `shambler`, `shambler_twisted` 0.5%; `minecraft:zombie_villager` 0.5%, `husk` 0.2%; `betteranimalsplus:tarantula` 0.2%; `mowziesmobs:grottol`, `foliaath`, `barakoana` (0.1% or less).
3. **Mobs the research's hazard table names, not cited:**
   - `mod_lavacow:parasite`: "Parasites may drop when [zombies] die". Default `fight`.
   - `mod_lavacow:weta`: "Wetas: complete darkness in caves". It reads as level **none**: not IMob, no override. If it attacks players, `threatOf` misses it entirely.
   - Swamp mobs: `iceandfire:stymphalianbird`, `betteranimalsplus:eel_freshwater` and `lamprey`. Default `fight`.
   - Deep caves: `magma_monsters:magma_monster_grunt` and `mod_lavacow:salamander`. Default `fight`.
   - None of these is in an overworld monster spawn list (they come from mod spawning or other events). The swamp and deep-cave ones are off the first-night path if the bot stays out of swamps and caves. The parasite and the weta may not be.
   - Also defaulting and not in the overworld lists: `minecraft:cave_spider` and `minecraft:silverfish` (vanilla; spawners and stone).

**Suggested order, if the lead wants follow-ups:**
1. The Underground Biomes rock piles in `world-sources.json` (G3 critical path).
2. Class rules for the enderman and witch variants (safety and consistency).
3. A bytecode check of `mod_lavacow:weta` and `mod_lavacow:parasite`.
4. The zombie and spider variants with the biggest changes (giant, brute, fire, poison, web).

- **After that: free** (lead, 2026-11-02). Lead decisions recorded:
  - Request 7: granted (above).
  - Request 9 (prismarine-recipe `outShape` patch): not now; revisit after G3.
  - `isHuntable`: keep the vanilla list for G3; a note follows, no code change.
  - Pyrotech machine-recipe dumper part: no GO; not on the G3 path.
  - Request 8 items: routed to skills-rotn by the lead.
- **Note for a later `isHuntable` change (no code yet, per the lead):** on RotN the vanilla list (`cow`, `pig`, `chicken`, `sheep`, `rabbit`, ...) never matches a live animal. Animania replaces them all: `config/animania.cfg` lines 104 (chickens), 107 (cows), 113 (pigs), 116 (rabbits) and 119 (sheep) set `replaceVanilla*=true` in the pinned pack (`entity-overrides.json` `replacedByMod`; G2 batch 1: the server refused to summon vanilla chickens and pigs). `catalog.entity('minecraft:cow').replacedBy.replacements` lists them: 24 cattle, 18 pigs, 15 chickens, 18 sheep and 24 rabbits. Animania's loot tables (`animania-1.12.2-1.7.3.jar`, `assets/animania/loot_tables/`) drop vanilla meat: `cow_regular.json` beef and leather, `pig_regular.json` porkchop, `chicken_regular.json` chicken and feather, `sheep_regular.json` mutton and wool, `rabbit_regular.json` rabbit, hide and foot (`goat_regular.json`: `animania:raw_chevon`). Caveat: Animania's young are separate entities (`calf_*`, `piglet_*`, `chick_*`, `lamb_*`, `kit_*`), so leaving out babies there is by name, not by the metadata flag. Not checked: whether each young entity also sets the Ageable flag.

Earlier Phase 3 plan (done):

**Phase 3 (G3), from 2026-11-02 ~17:10 UTC** (lead: G2 passed on batch 8, #97/#98). Team: skills-rotn, rotn-data, harness-ops; net-forge paused. My part: data and helpers for G3 ("rocks to stone tools on a fresh spawn; survives the first night"). Plan, one small test-backed PR each:

1. **RotN recipes in `bot.registry`** (this PR, `agent/rotn-data/g3-progression`). Finding: `bot.registry.recipes` is minecraft-data's vanilla 1.12.2 table, so mineflayer's `bot.recipesFor`/`bot.craft` and `getItemCraftingRecipes`/`getDetailedCraftingPlan` planned vanilla crafts that RotN removed (a stone pickaxe from cobblestone, wooden tools). `rotn-data.installRecipes(registry)` / `mcdata.installRotnRecipes()` refill that object in place from the dump (prismarine-recipe keeps a reference to it), keyed by the server's item ids. Ore dictionary slots become variants (likeliest first, capped at 256 per recipe, built lazily per result). `getDetailedCraftingPlan` gets a general cycle guard (rocks <-> cobblestone), since upstream's `loopingItems` lists only 1.21 names. Result: `stone_pickaxe` plans as 3 rocks + log -> planks -> sticks; the crafting table as crude axe -> Crafting Tools -> table. **Needs a call site** (Request 7). Review (#102): APPROVE WITH NITS; fixed: results carry `meta` so `Recipe.find(id, meta)` filters (spruce vs oak planks, tested), and the cycle guard has no depth limit (iterative, `seen` ends it; a 12-step cycle is tested).
2. **"How do I get X"** (`howToGet(item)`; this PR, `agent/rotn-data/g3-howtoget`): dump crafting + furnace smelting + a cited table of non-recipe sources (rock piles, stone mined with a pickaxe below Sturdy gives 4 rocks, sticks from leaves, logs need an axe, the first plank from debarking, raw iron from iron ore). Each row is sourced from `rotn-progression.md` or the pinned zip, and marked verified or not. Done in this PR as `3.3.4/world-sources.json` (10 rules, each with evidence, `confidence` documented/inferred and an `unverified` list) plus `howToGet`, `formatHowToGet` and `rockRecipes` (the 35 "4 identical rocks -> block" recipes, for harness-ops' G3 cobblestone check: on the G3 spawn the stone is Underground Biomes stone and its rocks make UB cobble). Stone -> rock pairs come from dumped names; only `minecraft:stone:0` is documented, the rest `inferred`. Review (#107): APPROVE WITH NITS; fixed: flint dropped from the rocks rule (flint pickaxes are level 1, Sturdy), raw iron `inferred`, per-pair confidence for trees, debarking and planks (only the oak pairs are documented), and a bare `pyrotech:rock` means the rock ore dictionary metas.
3. **First-night threats** (merged: #111 and follow-ups #115, #118, #120): a threat level per mob (none, hostile = fight or avoid, dangerous = avoid) with a reaction hint (creepers explode: back off), and night spawns per biome from `spawns.json`. Done as `threatOf(entity)` (level, reaction, summary, evidence; `3.3.4/threat-reactions.json`: zombie, skeleton, spider, creeper documented from the research's hazard table, enderman `vanilla`, others a default from the level) and `nightThreats({biome})` (the `monster` spawn list only; MultiMob's lists have no biome filter). The overworld biome rule moved to `src/biomes.js`, shared with `build-common-mobs.mjs` (its `--check` is unchanged). `isHostile`/`isHuntable` for 1.12 (Animania animals, the 1.12 baby flag) is a later PR. Review (#111): REQUEST CHANGES; fixed: Fire Creeper documented, class rules (every creeper class in the dump keeps distance and counts as exploding; skeleton variants take cover; wither skeletons excluded), dangerous mobs report source `override`, `NIGHT_THREATS_NOT_REFLECTED` (Special Mobs variants, light, Mob Stages, invasions, MultiMob), and the custom-name gap ("Killer" rabbit) documented. Follow-up PR (`agent/rotn-data/threats-followup`, lead's #111 follow-up, needed before the first-night G3 batch): stray (class rule `Skeleton|Stray`), witch and illusion illager (`vanilla`, take cover), Ice and Fire dread lich (take cover) and troll (avoid), both `inferred` from the lead's review and not checked against the mod's code. 33 more overworld night threats still default to `fight` (slime, spectre, Quark ashen/dweller, Ancient Beasts, Defiled Lands, ...); listed in the PR, not guessed. #114 and #115 merged. Cited follow-up (`agent/rotn-data/threats-cited`): 19 entries `verified` from bytecode (javap on the pinned pack's jars, SHA-256 checked; SRG names checked against MCP stable-39 fields.csv) or `vanilla`: dread lich and troll now cited (the troll is 18 attack / 200 health on this pack, `config/ice_and_fire.cfg`), Quark ashen (blinding arrows) and dweller (invisible zombie), guardian, vindicator, Iceologer (Frozen-Fiend jar; falling ice blocks), naga, illager piper (summons rats), ten Ancient Beasts mobs. 16 overworld night threats still default to `fight` (slime and spectre about 10.5% each; the rest under 1.5% each). #118 merged (reviewer re-ran 9 citations). Second cited follow-up (`agent/rotn-data/threats-cited-2`): dread lich (always holds a lich staff so it fights from range; summons up to 5 minions), sandy (two ranged attacks; players only while untamed), ghost (buffs mobs; on a player: Possessed 20 s and 4 damage, found in the bytecode beyond the review), JSDoc `verified`, slime (`vanilla`) and Charm's spectre (`verified`: 0.5 health, but its touch curses items on this pack; spawns only at depth 24 or below). Remaining defaults are each under 1.5%.
4. **Pyrotech machine recipes** (kiln, pit kiln for charcoal, drying rack for tinder, chopping block, campfire): not in the dump. Needs a new dumper part and a paid batch: **only with the lead's written GO**.

Findings for skills-rotn (via the lead): see Request 8.

## Follow-ups (later PRs)

- **#152 nits: done in #172** (merged `81875ca`). The README's variant count is now 115,782, re-measured on develop `6a6d9ee` (209 recipes truncated; install about 0.3 s, building everything about 0.6 s). `canFill` drops stacks no slot accepts before the matching; results are unchanged (tested). The JSDoc says `assignment` covers the first craft only. Tests: `craft-fill.test.js` 5/5, skills-rotn's `craft_needs.test.js` 16/16, ESLint clean on the touched files.

- **#102 review follow-ups:** the crafting table test (no planks-only variant) and the sticks test are in PR #112. `outShape` from the dump's `remaining` is **blocked** (Request 9): prismarine-recipe 1.5.0's `computeDelta` applies `outShape` with inShape's items, so those recipes would look free to `bot.recipesFor`. No G3 recipe has remaining items.

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
7. **Lead: a call site for `mc.installRotnRecipes()`** (PR 1 above). It must run once per login, after forge-bridge's `extendRegistry`, i.e. right after `src/utils/mcdata.js:196` (`mcdata = bot.registry`) in `initBot`. That is net-forge's part of `mcdata.js`, and net-forge is paused. Options: (a) you allow me a one-line call there; (b) skills-rotn calls it on spawn. Until one is chosen, nothing in the agent uses RotN recipes. Lead (#102 review message): it needs net-forge, who is paused; tell the lead when skills-rotn needs it, and the lead may grant me a one-line `initBot` exception.
8. **skills-rotn (route via the lead), from PR 1:**
   - `skills.craftRecipe` calls `bot.recipesFor(mc.getItemId(name), null, ...)`. A null metadata matches every variant of the item, so `spruce_planks` can come out as oak. Pass `mc.resolveName(name).meta`.
   - `getDetailedCraftingPlan` does not know whether a crafting table is available. In RotN the first plank comes from debarking a placed log with the crude axe (not a recipe), and log -> 3 planks needs a table. PR 2's `howToGet` gives the non-recipe steps.
   - Tell me the shape you want for PR 2 (`howToGet`) and PR 3 (first-night threats) before I fix it.
   - **From skills-rotn Request 9 (PR `agent/rotn-data/huntable-baby`):** on 1.12.2 the baby flag is entity metadata index **12** (EntityAgeable, Boolean) and a villager's profession is index **13** (VarInt). Source: wiki.vg "Entity metadata", revision of 18 May 2018 (`https://minecraft.wiki/w/Java_Edition_protocol/Entity_metadata?oldid=2768639`). `mcdata.isHuntable` is fixed; `mcdata.isBaby(entity)` and `mcdata.BABY_METADATA_INDEX` are exported. Still on the 1.21 indices in `src/agent/` (yours): `commands/queries.js:181`, `library/skills.js:1692` and `:1713` (`metadata[16] === 1` for baby villagers; use `mc.isBaby`), and `library/world.js:238-248` (`metadata[18]` for the villager profession; 13 on 1.12).
9. **Lead: a prismarine-recipe patch?** (from PR #112). `node_modules/prismarine-recipe/lib/recipe.js` `computeDelta` > `applyShape` reads `recipe.inShape[y]` where it should read `shape[y]`, so any `outShape` adds back every input. A one-line patch would let rotn-data emit `outShape` from the dump's `remaining` (1,116 recipes: buckets, knives), which mineflayer's `craft.js` `updateOutShape` then handles correctly. Not needed for G3 (no G3 recipe has remaining items). `patches/` for prismarine-recipe is not on net-forge's list, so it's your call: patch it (who?), or leave `outShape` out.
11. **CLOSED (lead confirmed 2026-11-05: covered by #206; skills-rotn's `src/agent/library/food.js` calls `foodValues`/`avoidFood` directly, auto-eat off).** **Lead or net-forge: a call site for `installFoods(bot.registry)`** (food-values PR). mineflayer-auto-eat reads `bot.registry.foodsByName`, which has minecraft-data's vanilla 1.12.2 values (bread 5) until this runs. It must run once per login after forge-bridge's `extendRegistry`, next to `installRotnRecipesOnce` in `initBot` (net-forge's part of `src/utils/mcdata.js`). One line, like Request 7's. The same place (or skills-rotn's eating) must set auto-eat's `bannedFood` from `avoidFood` and check `avoidFood(name, meta)` on the stack before eating: `installFoods` bans nothing, and a pufferfish (`fish` meta 3) shares the cod's entry (#209 review).

## Open PRs

- `agent/rotn-data/death-zombie`: grove sprite and Zombie Players threat entries (G3 smoke round 2 batch A deaths).
