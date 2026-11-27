// rotn-data brief item 4: mcdata.js's name and registry helpers on the bot's registry, and the
// agent's naming API toNew/toOld (lead decision for #44; harness-ops' G2 check imports it).
// Offline: a real prismarine-registry for 1.12.2, extended by forge-bridge's extendRegistry
// with the RegistryData ids the RotN 3.3.4 server synced (packages/rotn-data/3.3.4/registry-names.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RegistrySnapshot, extendRegistry } from '../../packages/forge-bridge/index.js';
import * as mc from './mcdata.js';
import * as rdData from '../../packages/rotn-data/index.js';

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
    // Upstream's 1.21 names still count. Carpet has a thin collision box in the dump, so only the
    // name list catches it (#127 review: checked here rather than claimed).
    assert.equal(mc.mustCollectManually('lily_of_the_valley'), true);
    assert.deepEqual(rdData.getBlock('minecraft:carpet').state.collision, [[0, 0, 0, 1, 0.0625, 1]]);
    assert.equal(mc.mustCollectManually('carpet'), true);
    // #127 review: gases, portals and fire have no box but are not things to collect; rails are.
    for (const n of ['adpother:carbon', 'adpother:mist', 'minecraft:portal', 'minecraft:fire']) assert.equal(mc.mustCollectManually(n), false, n);
    assert.equal(mc.mustCollectManually('rail'), true);
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
    assert.ok(report.results > 3000 && report.recipes + report.dropped === 6089 && report.dropped === 1 && report.resultNotInRegistry === 0, JSON.stringify(report));
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
    // Request 10: the plan names variants as inventory keys ("pyrotech:rock:0", "log:0"); a bare
    // key (planks, stick) means any variant. Soak 17 L3: an ore input the bot lacks is named by its ore
    // ("rock (any of ...)"), and a crafted bare key names what the recipe makes ("planks:0").
    assert.match(pick, /- 1 log:0\n- 3 rock \(any of pyrotech:rock, pyrotech_compat:rock_\*\)\n/);
    assert.match(pick, /Craft 1 log:0 -> 3 planks:0\nCraft 2 planks -> 4 stick\nCraft 3 rock \(any of pyrotech:rock, pyrotech_compat:rock_\*\) \+ 2 stick -> 1 stone_pickaxe/);
    const table = mc.getDetailedCraftingPlan('crafting_table', 1, {});
    const axeRock = 'rock \\(any of pyrotech:rock, flint, pyrotech_compat:rock_\\*\\)';
    assert.match(table, new RegExp(`Craft 1 ${axeRock} \\+ 2 stick -> 1 pyrotech:crude_axe\nCraft 1 pyrotech:crude_axe \\+ 1 ${axeRock} \\+ 1 stick -> 1 contenttweaker:crafting_tools\nCraft 1 planks \\+ 1 contenttweaker:crafting_tools -> 1 crafting_table`));
    // Soak 17 L3: cobblestone is made from 4 rocks, not a base item; the rocks are.
    assert.match(mc.getDetailedCraftingPlan('cobblestone', 1, {}), /^Note: 4 rocks of any one kind make that kind's cobblestone\.\nYou are missing the following items:\n- 4 pyrotech:rock:0\n[^]*Craft 4 pyrotech:rock:0 -> 1 cobblestone$/);
    assert.equal(mc.getDetailedCraftingPlan('pyrotech:rock', 1, {}), 'pyrotech:rock is a base item, you need to find 1 more in the world');
    const furnace = mc.getDetailedCraftingPlan('furnace', 1, { 'pyrotech:rock:0': 2 });
    assert.match(furnace, /- 6 rock \(any of /);
    assert.match(furnace, /Craft 2 pyrotech:rock:0 \+ 6 rock \(any of [^)]*\) -> 1 furnace/);
});

// Request 10 (#131 nit): the plan reads ingredient metas against a variant-keyed inventory
// (world.getInventoryCounts: "name:meta" for items with subtypes), so the wrong variant is not "everything".
test('getDetailedCraftingPlan: a dirt clump is not a rock; any rock in the ore is; mixed rocks make a stone pickaxe', () => {
    const everything = /^You have all items required to craft this item!/;
    // A dirt clump (pyrotech:rock:4) is not in the rock ore dictionary: the crude axe still needs a rock.
    const clump = mc.getDetailedCraftingPlan('pyrotech:crude_axe', 1, { 'pyrotech:rock:4': 1, stick: 2 });
    assert.doesNotMatch(clump, everything);
    assert.match(clump, /- 1 rock \(any of pyrotech:rock, flint, pyrotech_compat:rock_\*\)/);
    // A metamorphic rock (any meta) is in the ore: everything is there, and the plan names it.
    const meta6 = mc.getDetailedCraftingPlan('pyrotech:crude_axe', 1, { 'pyrotech_compat:rock_metamorphic:6': 1, stick: 2 });
    assert.match(meta6, everything);
    assert.match(meta6, /Craft 1 pyrotech_compat:rock_metamorphic \+ 2 stick -> 1 pyrotech:crude_axe/);
    // Mixed families (the G3 spawn): 1 igneous + 2 metamorphic make a stone pickaxe (#152's mixed variants).
    const mixed = mc.getDetailedCraftingPlan('stone_pickaxe', 1, { 'pyrotech_compat:rock_igneous:3': 1, 'pyrotech_compat:rock_metamorphic:0': 2, stick: 2 });
    assert.match(mixed, everything);
    assert.match(mixed, /1 pyrotech_compat:rock_igneous \+ 2 pyrotech_compat:rock_metamorphic \+ 2 stick -> 1 stone_pickaxe/);
    // Not enough of the right variants: 2 good rocks and a clump are not 3 rocks.
    assert.doesNotMatch(mc.getDetailedCraftingPlan('stone_pickaxe', 1, { 'pyrotech_compat:rock_igneous:0': 2, 'pyrotech:rock:4': 1, stick: 2 }), everything);
    // A bare total of an item with subtypes cannot vouch for a variant: callers pass variant keys.
    assert.doesNotMatch(mc.getDetailedCraftingPlan('pyrotech:crude_axe', 1, { 'pyrotech:rock': 1, stick: 2 }), everything);
    // Items without subtypes keep bare keys, and a bare need takes any variant ("planks" from "planks:2").
    assert.match(mc.getDetailedCraftingPlan('stick', 4, { 'planks:2': 2 }), everything);
    // The variant-aware recipes: the stone pickaxe's first variant, keyed like the inventory.
    assert.deepEqual(mc.getItemCraftingRecipeVariants('stone_pickaxe')[0], [{ 'pyrotech:rock:0': 3, stick: 2 }, { craftedCount: 1 }]);
    assert.equal(mc.getItemCraftingRecipeVariants('nosuchmod:thing'), null);
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

// #145 review: near the G3 spawn the bot holds mixed Underground Biomes rocks. mineflayer's
// recipesFor keeps a recipe when, for every delta entry, inventory.count(id, metadata) covers it
// (craft.js requirementsMetForRecipe); the same rule here, on the installed RotN table.
test('mixed rocks (1 igneous + 2 metamorphic) and 2 sticks make a stone pickaxe and a stone axe', () => {
    mc.installRotnRecipes();
    const Recipe = require('prismarine-recipe')(registry).Recipe;
    const id = (n) => registry.itemsByName[n].id;
    const inv = [[id('pyrotech_compat:rock_igneous'), 3, 1], [id('pyrotech_compat:rock_metamorphic'), 0, 2], [id('stick'), 0, 2]];
    const count = (i, m) => inv.filter(([a, b]) => a === i && (m == null || m === b)).reduce((n, x) => n + x[2], 0);
    const craftable = (r) => r.delta.every((d) => count(d.id, d.metadata) + d.count >= 0);
    for (const item of ['stone_pickaxe', 'stone_axe']) assert.ok(Recipe.find(id(item)).some(craftable), item);
    // Cobblestone takes 4 rocks of one type (one recipe per rock type), so a mix makes none.
    assert.ok(!Recipe.find(id('cobblestone')).some(craftable));
});

// #152 review: single-kind variants are never pushed out by mixes, and no variant counts a stack twice.
test('stone tools keep all 78 single-kind variants; no variant pairs a wildcard with the same item', () => {
    mc.installRotnRecipes();
    const Recipe = require('prismarine-recipe')(registry).Recipe;
    const id = (n) => registry.itemsByName[n].id;
    const canCraft = (inv) => (r) => r.delta.every((d) => inv.filter(([a, b]) => a === d.id && (d.metadata == null || d.metadata === b)).reduce((n, x) => n + x[2], 0) + d.count >= 0);
    // The reviewer's case: 3 sedimentary sand rocks (meta 8) and 2 sticks (develop could craft it).
    const sand3 = [[id('pyrotech_compat:rock_sedimentary_sand'), 8, 3], [id('stick'), 0, 2]];
    for (const item of ['stone_pickaxe', 'stone_axe']) assert.ok(Recipe.find(id(item)).some(canCraft(sand3)), item);
    // The rock recipe's first 78 variants are single-kind (13 rocks x 6 stick choices), as on develop.
    const rockVariants = registry.recipes[id('stone_pickaxe')].filter((r) => r.inShape[0].length === 3 && r.inShape[0][0].id !== id('flint'));
    const singleKind = (r) => new Set(r.inShape[0].map((x) => `${x.id}:${x.metadata}`)).size === 1;
    assert.ok(rockVariants.slice(0, 78).every(singleKind));
    assert.ok(rockVariants.slice(78).some((r) => !singleKind(r)), 'mixes after them');
    // The reviewer's double-count examples: no variant has a wildcard and a specific meta of one item.
    for (const item of ['concrete_powder', 'bookshelf']) {
        for (const r of registry.recipes[id(item)] ?? []) {
            const its = (r.ingredients ?? r.inShape.flat()).filter((x) => x && x.id >= 0);
            assert.ok(!its.some((x) => x.metadata == null && its.some((y) => y !== x && y.id === x.id && y.metadata != null)), item);
        }
    }
});

// Soak 17 L3 (test/evidence/g4/g4soak-17-20261126/driver.log): the planner named the one rock a vanilla-style
// variant shows ("pyrotech:rock:0") while the bot held other rocks, and called cobblestone a base item.
// develop picked the first variant whenever no variant was complete (no sticks held, a handle to make).
test('soak 17 L3: ore inputs count every held rock; cobblestone comes from 4 rocks of the kind held most', () => {
    mc.installRotnRecipes();
    // 18:01:49 !getCraftingPlan("stone_sword", 1) said "- 2 pyrotech:rock:0". The inventory is the last listing
    // before it (18:00:47 INVENTORY), its rocks and sticks.
    const at180047 = { stick: 3, 'pyrotech_compat:rock_igneous:7': 2, 'planks:1': 4, 'log:1': 34, 'pyrotech_compat:rock_sedimentary:3': 2,
        'pyrotech_compat:rock_igneous:0': 1, 'pyrotech_compat:rock_metamorphic:6': 4, 'pyrotech_compat:rock_sedimentary:0': 1, 'pyrotech_compat:rock_metamorphic:5': 3 };
    const sword = mc.getDetailedCraftingPlan('stone_sword', 1, at180047);
    assert.doesNotMatch(sword, /pyrotech:rock:0|rock \(any of/, sword);
    assert.match(sword, /^You are missing the following items:\n- 3 pyrotech:tinder\n\n/);
    assert.match(sword, /Craft 2 pyrotech_compat:rock_igneous \+ 1 spartanweaponry:material:0 -> 1 stone_sword$/);

    // 18:07:10 !getCraftingPlan("stone_pickaxe", 1) said "- 3 pyrotech:rock:0". At 18:04:02 the bot had 20
    // pyrotech_compat:rock_metamorphic:0 left (7 cobbles' worth, 2 crafted), which it crafted into 5 cobbles at
    // 18:07:38. #669 review 3: its pyrotech:rock:8 count is logged too: 20 at 18:04:02 (5 limestone cobbles of 4,
    // driver.log:2144); the crude axe (18:06:45) and Crafting Tools (18:06:49) took one rock each, the tools'
    // plan naming rock:8 (18:06:34), so 18 here (at 20, a tie, metamorphic still wins: see below). 4 planks
    // (18:06:14), no sticks.
    const at1807 = { 'pyrotech_compat:rock_metamorphic:0': 20, 'pyrotech:rock:8': 18, 'planks:1': 4, 'undergroundbiomes:metamorphic_cobble:0': 4, 'log:1': 34 };
    const pick = mc.getDetailedCraftingPlan('stone_pickaxe', 1, at1807);
    assert.match(pick, /^You have all items required to craft this item!\n/, pick);
    assert.match(pick, /Craft 2 planks -> 4 stick\nCraft 3 pyrotech:rock:8 \+ 2 stick -> 1 stone_pickaxe$/);
    // Seven pickaxes: 21 rocks of two kinds (every member of the ore counts), no rock missing.
    assert.match(mc.getDetailedCraftingPlan('stone_pickaxe', 7, at1807), /^You have all items[^]*Craft 18 pyrotech:rock:8 \+ 3 pyrotech_compat:rock_metamorphic \+ 14 stick -> 7 stone_pickaxe$/);
    // Too few rocks: the missing line names the ore, not one rock.
    const short = mc.getDetailedCraftingPlan('stone_pickaxe', 1, { 'pyrotech_compat:rock_metamorphic:0': 1, stick: 2 });
    assert.match(short, /^You are missing the following items:\n- 2 rock \(any of pyrotech:rock, pyrotech_compat:rock_\*\)\n/);
    assert.match(short, /Craft 1 pyrotech_compat:rock_metamorphic \+ 2 rock \(any of [^)]*\) \+ 2 stick -> 1 stone_pickaxe$/);

    // 18:07:32 !getCraftingPlan("cobblestone", 1) said "cobblestone is a base item". The rocks held most make
    // metamorphic cobble (what the bot crafted at 18:07:38); the 4 it already had are not counted for the plan.
    const cobble = mc.getDetailedCraftingPlan('cobblestone', 5, at1807);
    assert.equal(cobble, 'Any cobblestone: your pyrotech_compat:rock_metamorphic:0 rocks make undergroundbiomes:metamorphic_cobble:0 (4 rocks each); you already have 4.\n'
        + 'You have all items required to craft this item!\nHere\'s your crafting plan:\n\nCraft 20 pyrotech_compat:rock_metamorphic:0 -> 5 undergroundbiomes:metamorphic_cobble:0');
    // A named kind: only that kind's rocks, 4 of one kind per cobble.
    assert.match(mc.getDetailedCraftingPlan('contenttweaker:limestone_cobble', 5, at1807), /^You are missing the following items:\n- 2 pyrotech:rock:8\n[^]*Craft 20 pyrotech:rock:8 -> 5 contenttweaker:limestone_cobble:0$/);
    // A tie (20 and 20): the first rock recipe in rockRecipes' order (metamorphic before limestone), the order skills'
    // cobbleChoices also uses; the bot made metamorphic cobble at 18:07:38.
    assert.match(mc.getDetailedCraftingPlan('cobblestone', 1, { ...at1807, 'pyrotech:rock:8': 20 }), /^Any cobblestone: your pyrotech_compat:rock_metamorphic:0 rocks make undergroundbiomes:metamorphic_cobble:0 /);
    // #669 review 2: mixed kinds make no cobble. 2 igneous + 2 metamorphic rocks, or two metas of one rock, are not 4 of one kind.
    const mixed = mc.getDetailedCraftingPlan('cobblestone', 1, { 'pyrotech_compat:rock_igneous:0': 2, 'pyrotech_compat:rock_metamorphic:0': 2 });
    assert.match(mixed, /^Any cobblestone: your pyrotech_compat:rock_igneous:0 rocks make undergroundbiomes:igneous_cobble:0 \(4 rocks each\)\.\nYou are missing the following items:\n- 2 pyrotech_compat:rock_igneous:0\n/, mixed);
    assert.doesNotMatch(mixed, /You have all items/);
    const metas = mc.getDetailedCraftingPlan('undergroundbiomes:metamorphic_cobble', 1, { 'pyrotech_compat:rock_metamorphic:0': 2, 'pyrotech_compat:rock_metamorphic:1': 2 });
    assert.match(metas, /^You are missing the following items:\n- 2 pyrotech_compat:rock_metamorphic:0\n[^]*Craft 4 pyrotech_compat:rock_metamorphic:0 -> 1 undergroundbiomes:metamorphic_cobble:0$/, metas);
});

// Soak 17 L3 item 3: the plan follows rotn-data's recipes, not the registry's, where they disagree.
test('soak 17 L3: the plan reads rotn-data\'s recipes even when the registry still has vanilla ones', () => {
    const vanilla = require('prismarine-registry')('1.12.2');
    const id = (n) => registry.itemsByName[n].id;
    const saved = { ...registry.recipes };
    try {
        // As if the RotN install had failed: the registry holds vanilla 1.12.2's recipes for these items.
        for (const n of ['wooden_pickaxe', 'stone_pickaxe', 'crafting_table']) registry.recipes[id(n)] = vanilla.recipes[vanilla.itemsByName[n].id];
        assert.equal(mc.getDetailedCraftingPlan('wooden_pickaxe', 1, { 'planks:0': 3, stick: 2 }), 'wooden_pickaxe is a base item, you need to find 1 more in the world');
        assert.match(mc.getDetailedCraftingPlan('stone_pickaxe', 1, { cobblestone: 3, stick: 2 }), /- 3 rock \(any of /);
        assert.match(mc.getDetailedCraftingPlan('crafting_table', 1, { 'planks:0': 4 }), /contenttweaker:crafting_tools/);
    } finally {
        for (const k of Object.keys(registry.recipes)) delete registry.recipes[k];
        Object.assign(registry.recipes, saved);
    }
});

// #669 review 1: an ore input must not take the stack a later single-item input needs. The hamster wheel's 3 genericMetal
// also accept the iron ingot its 1 ingotIron needs; the soaking pot's 2 twine also accept the 1 pyrotech:material:14 it needs.
test('#669 review 1: inputs with the fewest members fill first (hamster wheel, soaking pot)', () => {
    mc.installRotnRecipes();
    const everything = /^You have all items required to craft this item!\n/;
    const wheel = mc.getDetailedCraftingPlan('animania:block_hamster_wheel', 1, { iron_ingot: 1, 'contenttweaker:material_part:0': 3, stone_slab: 2 });
    assert.match(wheel, everything, wheel);
    assert.match(wheel, /Craft 3 contenttweaker:material_part:0 \+ 2 stone_slab \+ 1 iron_ingot -> 1 animania:block_hamster_wheel$/);
    const pot = mc.getDetailedCraftingPlan('pyrotech:soaking_pot', 1, { 'pyrotech:material:14': 1, string: 2, 'pyrotech:rock:0': 3, 'planks:0': 2 });
    assert.match(pot, everything, pot);
    assert.match(pot, /Craft 3 pyrotech:rock:0 \+ 2 string \+ 2 planks \+ 1 pyrotech:material:14 -> 1 pyrotech:soaking_pot$/);
});
