// Name translation 1.12.2 <-> 1.21 (rotn-data brief deliverable 3, acceptance tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { toNew, toOld, blockToNew, blockToOld, loadRotnData, registryName, parseOld } from '../index.js';
import { buildFlattening } from '../tools/build-flattening.mjs';
import { buildRegistryNames } from '../tools/registry-from-capture.mjs';

const require = createRequire(import.meta.url);
const items = require('../vanilla/flattening-items.json');
const blocks = require('../vanilla/flattening-blocks.json');
const pack = loadRotnData('3.3.4');

test('generated tables are up to date with their generators', () => {
    const f = buildFlattening();
    assert.equal(JSON.stringify(items, null, 1) + '\n', f['flattening-items.json']);
    assert.equal(JSON.stringify(blocks, null, 1) + '\n', f['flattening-blocks.json']);
    assert.equal(JSON.stringify(require('../3.3.4/registry-names.json'), null, 1) + '\n', buildRegistryNames());
});

test('registry-names.json holds the real 3.3.4 capture sizes', () => {
    assert.equal(pack.names.blocks.size, 4896);
    assert.equal(pack.names.items.size, 9710);
    assert.equal(pack.names.entities.size, 971);
    assert.equal(pack.names.biomes.size, 175);
});

test('every vanilla 1.12.2 item with a 1.13+ name round-trips both ways', () => {
    assert.equal(items.entries.length, 642); // 643 legacy pairs minus spawn_egg (NBT variant)
    for (const e of items.entries) {
        const neu = toNew(e.old, e.meta);
        assert.equal(neu, e.new, `${e.old}:${e.meta}`);
        assert.deepEqual(toOld(neu), { name: e.old, meta: e.meta }, neu);
        // The old-name spelling with metadata in the string gives the same answer.
        assert.equal(toNew(`${e.old}:${e.meta}`), e.new);
    }
});

test('every vanilla item in the table exists in the RotN 3.3.4 item registry', () => {
    const missing = [...new Set(items.entries.map(e => e.old))].filter(n => !pack.names.items.has(n));
    assert.deepEqual(missing, []);
});

test('every vanilla block in the table exists in the RotN 3.3.4 block registry', () => {
    const missing = [...new Set(blocks.entries.map(e => e.old))].filter(n => !pack.names.blocks.has(n));
    assert.deepEqual(missing, []);
    // minecraft-data's light_gray_* names are silver_* on the 1.12.2 server.
    assert.equal(blockToNew('silver_glazed_terracotta'), 'light_gray_glazed_terracotta');
    assert.equal(blockToNew('silver_shulker_box'), 'light_gray_shulker_box');
    assert.deepEqual(blockToOld('light_gray_shulker_box').map(s => s.name), Array(6).fill('minecraft:silver_shulker_box'));
});

test('spawn eggs are not guessed: the mob is in NBT in 1.12', () => {
    assert.equal(toNew('spawn_egg'), null);
    assert.equal(toNew('spawn_egg', 90), null);
    assert.equal(toOld('pig_spawn_egg'), null);
});

test('well-known flattening pairs', () => {
    const pairs = [
        ['log', 0, 'oak_log'], ['log', 3, 'jungle_log'], ['log2', 1, 'dark_oak_log'], ['planks', 5, 'dark_oak_planks'],
        ['wool', 14, 'red_wool'], ['wool', 8, 'light_gray_wool'], ['dye', 4, 'lapis_lazuli'], ['dye', 15, 'bone_meal'],
        ['dye', 1, 'red_dye'], ['dye', 2, 'green_dye'], ['dye', 11, 'yellow_dye'], ['coal', 1, 'charcoal'], ['coal', 0, 'coal'],
        ['fish', 0, 'cod'], ['cooked_fish', 1, 'cooked_salmon'], ['tallgrass', 1, 'short_grass'], ['grass', 0, 'grass_block'],
        ['sign', 0, 'oak_sign'], ['wooden_door', 0, 'oak_door'], ['boat', 0, 'oak_boat'], ['stone', 1, 'granite'],
        ['sapling', 2, 'birch_sapling'], ['leaves', 0, 'oak_leaves'], ['red_flower', 0, 'poppy'], ['yellow_flower', 0, 'dandelion'],
        ['stone_slab', 0, 'smooth_stone_slab'], ['reeds', 0, 'sugar_cane'], ['web', 0, 'cobweb'], ['golden_apple', 1, 'enchanted_golden_apple'],
        ['skull', 1, 'wither_skeleton_skull'], ['melon', 0, 'melon_slice'], ['speckled_melon', 0, 'glistering_melon_slice'],
    ];
    for (const [o, m, n] of pairs) {
        assert.equal(toNew(o, m), n, `${o}:${m}`);
        assert.deepEqual(toOld(n), { name: `minecraft:${o}`, meta: m }, n);
    }
});

test('damageable items ignore the damage value; unknown variants and names are null', () => {
    assert.equal(toNew('stone_pickaxe', 17), 'stone_pickaxe');
    assert.equal(toNew('minecraft:iron_sword:200'), 'iron_sword');
    assert.equal(toNew('wool', 16), null);
    assert.equal(toNew('dye', 16), null);
    assert.equal(toNew('no_such_item'), null);
    assert.equal(toNew('nosuchmod:thing'), null);
    assert.equal(toNew(''), null);
    assert.equal(toNew(null), null);
    assert.equal(toOld('netherite_ingot'), null); // 1.16+, not in 1.12
    assert.equal(toOld('cherry_log'), null);
    assert.equal(toOld(''), null);
    assert.equal(toOld(undefined), null);
});

test('modded names pass through, checked against the 3.3.4 registry', () => {
    assert.equal(toNew('pyrotech:rock'), 'pyrotech:rock');
    assert.equal(toNew('pyrotech:rock', 6), 'pyrotech:rock:6');
    assert.equal(toNew('pyrotech:rock:6'), 'pyrotech:rock:6');
    assert.deepEqual(toOld('pyrotech:rock:6'), { name: 'pyrotech:rock', meta: 6 });
    assert.deepEqual(toOld('pyrotech:crude_axe'), { name: 'pyrotech:crude_axe', meta: 0 });
    assert.equal(toOld('pyrotech:no_such_thing'), null);
});

test('old spellings are accepted by toOld too (leniency at the command boundary)', () => {
    assert.deepEqual(toOld('log'), { name: 'minecraft:log', meta: 0 });
    assert.deepEqual(toOld('minecraft:log:2'), { name: 'minecraft:log', meta: 2 });
    assert.deepEqual(toOld('minecraft:oak_log'), { name: 'minecraft:log', meta: 0 });
    assert.deepEqual(toOld('OAK_LOG'), { name: 'minecraft:log', meta: 0 });
});

test('block states: blockToNew strips state, blockToOld lists every state', () => {
    assert.equal(blockToNew('log', 4), 'oak_log'); // axis x
    assert.equal(blockToNew('lit_furnace', 3), 'furnace');
    assert.equal(blockToNew('leaves', 12), 'oak_leaves');
    assert.equal(blockToNew('flowing_water', 3), 'water');
    assert.equal(blockToNew('pyrotech:rock_grass'), 'pyrotech:rock_grass');
    const oak = blockToOld('oak_log');
    assert.deepEqual(oak, [{ name: 'minecraft:log', meta: 0 }, { name: 'minecraft:log', meta: 4 }, { name: 'minecraft:log', meta: 8 }]);
    const furnace = blockToOld('furnace').map(s => s.name);
    assert.ok(furnace.includes('minecraft:furnace') && furnace.includes('minecraft:lit_furnace'));
    assert.deepEqual(blockToOld('nope'), []);
});

// rotn-progression.md section 4: every name listed there must resolve both ways.
// (Re-checked against the 3.3.4 registry capture, ADR 0005.)
const SECTION_4 = [
    'minecraft:log:0', 'minecraft:planks:0', 'minecraft:planks:2', 'minecraft:planks:4', 'hitwithaxe:debarked_oak', 'hitwithaxe:debarked_oak:1',
    'hitwithaxe:bark:15', 'minecraft:stick', 'contenttweaker:broken_stick', 'pyrotech:rock', 'pyrotech:rock:3', 'pyrotech:rock:6',
    'pyrotech:rock:7', 'pyrotech:rock:8', 'pyrotech_compat:rock_igneous:1', 'minecraft:cobblestone', 'pyrotech:crude_axe',
    'contenttweaker:crafting_tools', 'minecraft:crafting_table', 'craftingcraft:portable_crafting_table:0', 'minecraft:stone_pickaxe',
    'minecraft:stone_axe', 'minecraft:flint', 'minecraft:furnace', 'minecraft:coal:1', 'minecraft:torch', 'pyrotech:tinder',
    'pyrotech:stone_hammer', 'pyrotech:iron_hammer', 'contenttweaker:raw_iron', 'contenttweaker:raw_copper', 'contenttweaker:raw_tin',
    'contenttweaker:raw_silver', 'contenttweaker:raw_gold', 'minecraft:iron_ingot', 'rustic:wildberries', 'rustic:ginseng',
    'rustic:marsh_mallow', 'rustic:core_root', 'rustic:cloudsbluff', 'biomesoplenty:berries',
];

test('every name in rotn-progression.md section 4 resolves both ways', () => {
    for (const full of SECTION_4) {
        const p = parseOld(full);
        assert.ok(pack.names.items.has(p.name), `${p.name} is not in the 3.3.4 item registry`);
        const neu = toNew(full);
        assert.ok(neu, `toNew(${full})`);
        assert.deepEqual(toOld(neu), { name: p.name, meta: p.meta ?? 0 }, `${full} -> ${neu} -> back`);
    }
    // Named examples from the report.
    assert.equal(toNew('minecraft:coal:1'), 'charcoal');
    assert.equal(toNew('minecraft:planks:0'), 'oak_planks');
});

test('registryName adds the namespace that bot.registry drops for vanilla', () => {
    assert.equal(registryName({ name: 'stone' }), 'minecraft:stone');
    assert.equal(registryName({ name: 'pyrotech:rock' }), 'pyrotech:rock');
    assert.equal(registryName({ name: 'x', registryName: 'mod:x' }), 'mod:x');
    assert.equal(registryName('villager_golem'), 'minecraft:villager_golem');
    assert.equal(registryName({ name: '' }), null);
    assert.equal(registryName(null), null);
});

// harness-ops' G2 sample (test/scenarios/g2/g2-items-roundtrip.mjs, VANILLA_SAMPLE in PR #36),
// copied here so a change on either side shows up. Must be a subset of the table.
const HARNESS_SAMPLE = 'minecraft:log:0=oak_log, minecraft:log:1=spruce_log, minecraft:log:2=birch_log, minecraft:log:3=jungle_log, minecraft:log2:0=acacia_log, minecraft:log2:1=dark_oak_log, minecraft:planks:0=oak_planks, minecraft:planks:5=dark_oak_planks, minecraft:sapling:0=oak_sapling, minecraft:stone:0=stone, minecraft:stone:1=granite, minecraft:stone:3=diorite, minecraft:cobblestone:0=cobblestone, minecraft:wool:0=white_wool, minecraft:wool:14=red_wool, minecraft:dye:1=red_dye, minecraft:dye:4=lapis_lazuli, minecraft:dye:15=bone_meal, minecraft:coal:0=coal, minecraft:coal:1=charcoal, minecraft:red_flower:0=poppy, minecraft:yellow_flower:0=dandelion, minecraft:stonebrick:0=stone_bricks, minecraft:crafting_table:0=crafting_table, minecraft:stick:0=stick, minecraft:wooden_pickaxe:0=wooden_pickaxe, minecraft:torch:0=torch, minecraft:bone:0=bone, minecraft:rotten_flesh:0=rotten_flesh, minecraft:wheat_seeds:0=wheat_seeds';

test("harness-ops' G2 vanilla sample is a subset of flattening-items.json", () => {
    const table = new Map(items.entries.map(e => [`${e.old}:${e.meta}`, e.new]));
    for (const pair of HARNESS_SAMPLE.split(', ')) {
        const [old, neu] = pair.split('=');
        assert.equal(table.get(old), neu, old);
    }
});
