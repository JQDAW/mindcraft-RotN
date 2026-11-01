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
