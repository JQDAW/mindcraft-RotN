// rotn-data brief item 4: mcdata.js's name and registry helpers on the bot's registry, and the
// agent's naming API toNew/toOld (lead decision for #44; harness-ops' G2 check imports it).
// Offline: a real prismarine-registry for 1.12.2, extended by forge-bridge's extendRegistry
// with the RegistryData ids the RotN 3.3.4 server synced (packages/rotn-data/3.3.4/registry-names.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RegistrySnapshot, extendRegistry } from '../../packages/forge-bridge/index.js';
import * as mc from './mcdata.js';

const require = createRequire(import.meta.url);
const names = require('../../packages/rotn-data/3.3.4/registry-names.json').registries;

function rotnRegistry() {
    const registry = require('prismarine-registry')('1.12.2');
    const snap = new RegistrySnapshot();
    const keys = ['minecraft:blocks', 'minecraft:items', 'minecraft:entities', 'minecraft:biomes'];
    keys.forEach((k, i) => snap.add({ name: k, ids: Object.entries(names[k].ids), dummied: [], overrides: [], hasMore: i < keys.length - 1 }));
    extendRegistry(registry, snap);
    return registry;
}

const registry = rotnRegistry();
mc.__setRegistryForTest(registry); // what initBot does at login: mcdata = bot.registry (#46)

test('1.12, modded and 1.21 item names all resolve to bot.registry ids', () => {
    assert.equal(mc.getItemId('log'), registry.itemsByName.log.id);
    assert.equal(mc.getItemId('oak_log'), registry.itemsByName.log.id);
    assert.equal(mc.getItemId('minecraft:log:2'), registry.itemsByName.log.id);
    assert.equal(mc.getItemId('charcoal'), registry.itemsByName.coal.id);
    assert.equal(mc.getItemId('pyrotech:crude_axe'), registry.itemsByName['pyrotech:crude_axe'].id);
    assert.equal(mc.getItemId('pyrotech:rock:6'), registry.itemsByName['pyrotech:rock'].id);
    assert.equal(mc.getItemId('netherite_ingot'), null);
    assert.equal(mc.getItemId('nosuchmod:thing'), null);
    assert.equal(mc.getItemId(undefined), null);
});

test('ids give the registry name back; recipe ingredient objects are accepted', () => {
    const axe = registry.itemsByName['pyrotech:crude_axe'].id;
    assert.equal(mc.getItemName(axe), 'pyrotech:crude_axe');
    assert.equal(mc.getItemName({ id: registry.itemsByName.planks.id, metadata: 2 }), 'planks');
    assert.equal(mc.getBlockName(registry.blocksByName['pyrotech:rock_grass'].id), 'pyrotech:rock_grass');
});

test('block names: modded, 1.21 and 1.12', () => {
    assert.equal(mc.getBlockId('pyrotech:rock'), registry.blocksByName['pyrotech:rock'].id);
    assert.equal(mc.getBlockId('short_grass'), registry.blocksByName.tallgrass.id);
    assert.equal(mc.getBlockId('grass_block'), registry.blocksByName.grass.id);
    assert.equal(mc.getBlockId('light_gray_shulker_box'), registry.blocksByName.silver_shulker_box.id);
    assert.equal(mc.getBlockId('dynamictrees:leaves1'), registry.blocksByName['dynamictrees:leaves1'].id);
});

test('follow-up 3: a name valid in both versions keeps its 1.12 meaning unless prefer new', () => {
    assert.deepEqual(mc.resolveName('grass', 'blocks'), { name: 'grass', meta: null }); // the grass block
    assert.deepEqual(mc.resolveName('stone_slab'), { name: 'stone_slab', meta: null }); // 1.12 slab family
    assert.deepEqual(mc.resolveName('melon'), { name: 'melon', meta: null }); // 1.12: the slice
    assert.deepEqual(mc.resolveName('melon', 'items', { prefer: 'new' }), { name: 'melon_block', meta: 0 }); // 1.21: the block
    assert.deepEqual(mc.resolveName('snow', 'blocks', { prefer: 'new' }), { name: 'snow_layer', meta: 0 });
    assert.deepEqual(mc.resolveName('oak_log', 'items', { prefer: 'new' }), { name: 'log', meta: 0 });
    assert.deepEqual(mc.resolveName('log:1'), { name: 'log', meta: 1 });
});

test('entities, lists and biomes come from the extended registry', () => {
    assert.equal(mc.getEntityId('specialmobs:firecreeper'), registry.entitiesByName['specialmobs:firecreeper'].id);
    assert.equal(mc.getEntityId('minecraft:zombie'), registry.entitiesByName.zombie.id);
    assert.ok(mc.getAllBlocks().some(b => b.name === 'pyrotech:rock'));
    assert.ok(mc.getAllItems(['pyrotech:rock']).every(i => i.name !== 'pyrotech:rock'));
    assert.ok(mc.getAllItemIds().length >= 9710 - 5);
    assert.ok(Object.values(mc.getAllBiomes()).some(b => b.name === 'biomesoplenty:bayou' || b.name?.startsWith('biomesoplenty:')));
});

test('vanilla recipes still work through the registry (RotN recipes come from the dump later)', () => {
    const r = mc.getItemCraftingRecipes('crafting_table');
    assert.ok(Array.isArray(r) && r.length > 0);
    assert.deepEqual(Object.keys(r[0][0]), ['planks']);
});

test('the agent naming API: mcdata.toNew/toOld round-trip every vanilla table entry (harness-ops G2)', () => {
    const table = require('../../packages/rotn-data/vanilla/flattening-items.json');
    assert.equal(table.entries.length, table.count);
    for (const e of table.entries) {
        assert.equal(mc.toNew(e.old, e.meta), e.new, `${e.old}:${e.meta}`);
        assert.deepEqual(mc.toOld(e.new), { name: e.old, meta: e.meta }, e.new);
    }
    // Same null semantics and modded passthrough as packages/rotn-data.
    assert.equal(mc.toNew('spawn_egg'), null);
    assert.equal(mc.toNew('nosuchmod:thing'), null);
    assert.equal(mc.toNew('pyrotech:rock', 6), 'pyrotech:rock:6');
    assert.deepEqual(mc.toOld('pyrotech:rock:6'), { name: 'pyrotech:rock', meta: 6 });
    assert.equal(mc.toOld('netherite_ingot'), null);
    assert.equal(mc.toNew.length, 1); // (name, meta = 0)
});

// skills-rotn Request 9: the 1.12 baby flag is metadata index 12 (1.21 uses 16).
test('isHuntable and isBaby read the 1.12 baby flag (metadata index 12), not the 1.21 index 16', () => {
    assert.equal(mc.BABY_METADATA_INDEX, 12);
    // mineflayer stores entity metadata by key; 1.12's index 12 is a Boolean.
    assert.equal(mc.isHuntable({ name: 'cow', metadata: { 12: true } }), false, 'a baby cow is not hunted');
    assert.equal(mc.isBaby({ name: 'cow', metadata: { 12: true } }), true);
    assert.equal(mc.isHuntable({ name: 'cow', metadata: { 12: false } }), true, 'an adult cow is huntable');
    // Index 16 means something else on 1.12 and must not decide it either way.
    assert.equal(mc.isHuntable({ name: 'pig', metadata: { 12: false, 16: 1 } }), true);
    assert.equal(mc.isHuntable({ name: 'pig', metadata: { 12: true, 16: 0 } }), false);
    // No metadata yet (just spawned): counted as an adult, and no exception.
    assert.equal(mc.isHuntable({ name: 'sheep' }), true);
    assert.equal(mc.isBaby({ name: 'sheep', metadata: [] }), false);
    assert.equal(mc.isHuntable({ name: 'zombie', metadata: { 12: false } }), false, 'not an animal');
    assert.equal(mc.isHuntable(null), false);
});

// Brief item 4: mustCollectManually on RotN names (blocks with no collision box in the dump).
test('mustCollectManually: 1.12, 1.21 and modded blocks with no collision box, plus the upstream names', () => {
    for (const n of ['tallgrass', 'minecraft:tallgrass:1', 'short_grass', 'double_plant', 'red_flower', 'reeds', 'sapling', 'torch', 'wheat',
        'pyrotech:rock', 'pyrotech:rock:6', 'biomesoplenty:flower_0', 'vine', 'web']) {
        assert.equal(mc.mustCollectManually(n), true, n);
    }
    for (const n of ['stone', 'log', 'oak_log', 'dirt', 'grass', 'leaves', 'cobblestone', 'dynamictrees:oakbranch', 'pyrotech:chopping_block',
        'air', 'water', 'lava', 'nosuchmod:block']) {
        assert.equal(mc.mustCollectManually(n), false, n);
    }
    // Upstream's 1.21 names still count (carpet has a thin collision box, so only the name list catches it).
    assert.equal(mc.mustCollectManually('lily_of_the_valley'), true);
    assert.equal(mc.mustCollectManually('carpet'), true);
    assert.equal(mc.mustCollectManually(undefined), false);
});

// ---- RotN recipes in the registry (rotn-data brief item 4; Phase 3). These run last: installing
// changes the shared registry's recipes for the rest of this process.

test('installRotnRecipes: mineflayer\'s Recipe, bound before the install, sees RotN recipes', () => {
    // mineflayer's craft plugin does this when the bot is created, long before login.
    const Recipe = require('prismarine-recipe')(registry).Recipe;
    const before = registry.recipes;
    const report = mc.installRotnRecipes();
    assert.equal(registry.recipes, before, 'the same object');
    assert.ok(report.results > 3000 && report.recipes === 6089 && report.resultNotInRegistry === 0, JSON.stringify(report));
    const id = (n) => registry.itemsByName[n].id;
    const names = (r) => r.delta.filter((d) => d.count < 0).map((d) => [mc.getItemName(d.id), d.metadata, -d.count]);

    const axe = Recipe.find(id('pyrotech:crude_axe'));
    assert.equal(axe[0].requiresTable, false, 'the crude axe is a 2x2 recipe');
    assert.deepEqual(names(axe[0]), [['pyrotech:rock', 0, 1], ['stick', 0, 2]]);
    assert.ok(axe.some((r) => names(r).some(([n]) => n === 'flint')), 'flint can replace the rock');

    const pick = Recipe.find(id('stone_pickaxe'));
    assert.equal(pick[0].requiresTable, true);
    assert.deepEqual(names(pick[0]), [['pyrotech:rock', 0, 3], ['stick', 0, 2]]);
    assert.ok(!pick.some((r) => names(r).some(([n]) => n === 'cobblestone')), 'not the vanilla cobblestone recipe');

    assert.deepEqual(names(Recipe.find(id('stone_axe'))[0]), [['pyrotech:rock', 0, 3], ['stick', 0, 2]]);
    assert.deepEqual(names(Recipe.find(id('cobblestone'))[0]), [['pyrotech:rock', 0, 4]]);
    assert.deepEqual(names(Recipe.find(id('furnace'))[0]), [['pyrotech:rock', 0, 8]]);
    assert.deepEqual(names(Recipe.find(id('contenttweaker:crafting_tools'))[0]), [['pyrotech:crude_axe', null, 1], ['pyrotech:rock', 0, 1], ['stick', 0, 1]]);
    const table = Recipe.find(id('crafting_table'));
    assert.deepEqual(names(table[0]), [['planks', null, 1], ['contenttweaker:crafting_tools', 0, 1]]);
    assert.equal(table[0].requiresTable, false);
    // #102 review follow-up: the vanilla recipe (4 planks, nothing else) is gone.
    assert.ok(table.every((r) => names(r).some(([n]) => n === 'contenttweaker:crafting_tools')), 'every variant needs Crafting Tools');
    assert.ok(!table.some((r) => names(r).every(([n]) => n === 'planks')), 'no planks-only variant');
    // #102 review follow-up: sticks directly. 2 planks of one kind (any) in the 2x2 grid give 4.
    const sticks = Recipe.find(id('stick'));
    assert.deepEqual(names(sticks[0]), [['planks', null, 2]]);
    assert.equal(sticks[0].result.count, 4);
    assert.equal(sticks[0].requiresTable, false);
    assert.ok(sticks.every((r) => r.delta.some((d) => d.count < 0)), 'every stick variant consumes something');
    assert.deepEqual(Recipe.find(id('wooden_pickaxe')), [], 'RotN has no wooden tools');

    // #102 review: results carry `meta`, so Recipe.find (bot.recipesFor) filters by metadata.
    const spruce = Recipe.find(id('planks'), 1);
    assert.ok(spruce.length > 0);
    assert.ok(spruce.every((r) => r.result.metadata === 1), 'only spruce planks recipes');
    assert.ok(spruce.some((r) => names(r).some(([n, m]) => n === 'log' && m === 1)), 'from a spruce log');
    assert.ok(Recipe.find(id('planks'), 0).every((r) => r.result.metadata === 0), 'only oak planks recipes');
    assert.ok(Recipe.find(id('planks')).some((r) => r.result.metadata === 1), 'no metadata: every kind');
});

test('getItemCraftingRecipes and getDetailedCraftingPlan follow RotN recipes', () => {
    assert.deepEqual(mc.getItemCraftingRecipes('stone_pickaxe')[0], [{ 'pyrotech:rock': 3, stick: 2 }, { craftedCount: 1 }]);
    assert.deepEqual(mc.getItemCraftingRecipes('crafting_table')[0], [{ planks: 1, 'contenttweaker:crafting_tools': 1 }, { craftedCount: 1 }]);
    // Rocks and cobblestone make each other; both are gathered, not crafted (no endless recursion).
    const pick = mc.getDetailedCraftingPlan('stone_pickaxe', 1, {});
    assert.match(pick, /- 3 pyrotech:rock\n- 1 log\n/);
    assert.match(pick, /Craft 1 log -> 3 planks\nCraft 2 planks -> 4 stick\nCraft 3 pyrotech:rock \+ 2 stick -> 1 stone_pickaxe/);
    const table = mc.getDetailedCraftingPlan('crafting_table', 1, {});
    assert.match(table, /Craft 1 pyrotech:rock \+ 2 stick -> 1 pyrotech:crude_axe\nCraft 1 pyrotech:crude_axe \+ 1 pyrotech:rock \+ 1 stick -> 1 contenttweaker:crafting_tools\nCraft 1 planks \+ 1 contenttweaker:crafting_tools -> 1 crafting_table/);
    assert.equal(mc.getDetailedCraftingPlan('cobblestone', 1, {}), 'cobblestone is a base item, you need to find 1 more in the world');
    assert.match(mc.getDetailedCraftingPlan('furnace', 1, { 'pyrotech:rock': 2 }), /- 6 pyrotech:rock/);
});

test('the plan cycle guard has no depth limit: a 12-step cycle is found (#102 review)', () => {
    const N = 12;
    const items = Array.from({ length: N }, (_, i) => ({ id: 9000 + i, name: `cyc${i}` }));
    const fake = {
        items: Object.fromEntries(items.map((x) => [x.id, x])),
        itemsByName: Object.fromEntries(items.map((x) => [x.name, x])),
        // cyc_i is crafted from cyc_(i+1), and the last one from cyc0
        recipes: Object.fromEntries(items.map((x, i) => [x.id, [{ ingredients: [{ id: 9000 + ((i + 1) % N), metadata: 0 }], result: { id: x.id, metadata: 0, count: 1 } }]])),
    };
    try {
        mc.__setRegistryForTest(fake);
        assert.equal(mc.getDetailedCraftingPlan('cyc0', 1, {}), 'cyc0 is a base item, you need to find 1 more in the world');
    } finally {
        mc.__setRegistryForTest(registry);
    }
});
