# Status: rotn-data

Updated: 2026-11-01 (after the first dump batch)

Worktree `C:/Users/admin/orca/workspaces/mindcraft-RotN/rotn-data-g2`. G2 brief items: (1) dumper, (2) data package, (3) name translation, (4) `mcdata.js` name/registry helpers on `bot.registry`.

## Done

- **#34 merged** (`3158776`): the dumper mod, `tools/dumper/`. It is opt-in, writes in batches of at most 500 entries per tick with `.tmp` + rename and `DONE` last, and builds with ForgeGradle 3.0.197 (the lead accepted it and writes the ADR 0004 addendum).
- **#37 merged** (`441020b`): `packages/rotn-data`, with translation, catalog, importer and the scripts cross-check fixture.
- **First RotN 3.3.4 dump batch: PASS** (lead's written GO, 2026-11-01 about 19:35 UTC; record below). Imported in PR "rotn-data: first RotN 3.3.4 dump" (branch `agent/rotn-data/dump-3.3.4`).
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

- 39 of 23,499 states have `null` hardness (tile-entity blocks: Aether chests, BWM waterwheel and windmill, ...).
- 9 blocks have no metadata-consistent state (BetterNether and Growthcraft half slabs, `betterwithmods:blood_leaves`, `twilightforest:force_field`).

None is a natural surface block. 20 recipes do not match their own sample grid (`matchesSample: false`); they are for skills-rotn to check if one matters.

## Doing

- PR #43: translation follow-ups 4, 5 and 6.
- PR #44: brief item 4, the `mcdata.js` helpers (`useBotRegistry`, `resolveName`; follow-up 3 documented there). It needs Request 4 and the lint baseline decision (Request 6).
- Next, in a later PR: the #34 review follow-ups 1-3 (from the lead), and the dumper gaps above (default-state fallback, item-based hardness).

## Follow-ups

- **3** (PR #37 review): the meaning of names valid in both versions. Resolved in #44 by `resolveName`: 1.12 meaning by default (`grass`, `stone_slab`, `snow`, `melon`, `nether_brick`), and `prefer: 'new'` for names the LLM wrote. skills-rotn: Mindcraft's `'grass'` in `skills.js:706` means the plant (`tallgrass` in 1.12).
- **4, 5, 6**: in PR #43.
- **#34 review follow-ups 1-3**: a later dumper PR.

## Blocked

- Nothing.

## Requests to other agents or the lead

1. ~~harness-ops: dumper-build workflow~~: done (#40).
2. **net-forge: properties for `extendRegistry`.** The dump now exists. I will build `properties` (blocks: `hardness`, `resistance`, `material` mapped to prismarine strings, `diggable`, `boundingBox`, `harvestTools`; items: `stackSize`, `maxDurability`; entities: `type`) keyed by full registry name. `harvestTools` needs bot.registry item ids, so it is built after your extension: a second `extendRegistry(..., { properties })` call, or an `applyProperties(registry, properties)` from you. Which do you prefer? `modEntityTable()` from `packages/rotn-data` gives `{modId: {modEntityTypeId: name}}`, and every modded entity in the dump has one.
3. ~~harness-ops: G2 naming adapter~~: agreed and adopted (PR #36). `common-mobs.json` now exists (`mobs[].name`; 12 of the first 12 are real entities, with modded mobs among them).
4. **net-forge or skills-rotn: one line, `useBotRegistry(bot)`**, after `initBot` (in `initBot`'s `login` handler, or in `agent.js` right after `initBot`). It makes the `mcdata.js` helpers read `bot.registry` (PR #44). Until then they read vanilla data.
5. ~~Lead: ADR 0004 addendum (FG3)~~: accepted; the lead writes it.
6. **Lead: lint baseline for #44.** #44 removes 2 upstream errors in `mcdata.js` (257 to 255). The ratchet needs `test/lint-baseline.json` lowered, and that file is harness-ops'. May I commit the `--update` (lowering only), or will you?

## Open PRs

- "rotn-data: first RotN 3.3.4 dump" (the dump import, `common-mobs.json`, acceptance tests on).
- #43 translation follow-ups 4-6.
- #44 `mcdata.js` helpers on `bot.registry` (brief item 4).
