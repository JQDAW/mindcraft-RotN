// Request 7 (lead exception): initBot installs RotN recipes once per login, after forge-bridge's
// extendRegistry. Offline: a real prismarine-registry for 1.12.2 extended with the RotN 3.3.4 synced
// ids (as in mcdata.rotn.test.js), the committed dump, and a static check of initBot's one call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

const names12 = (registry, r) => r.ingredients
    ? r.ingredients.map((x) => registry.items[x.id ?? x]?.name)
    : r.inShape.flat().filter(Boolean).map((x) => registry.items[x.id ?? x]?.name);

test('no recipe data, a failing load, or no registry: logged, nothing thrown, vanilla recipes kept', () => {
    const registry = rotnRegistry();
    const table = registry.recipes;
    const pick = registry.itemsByName.stone_pickaxe.id;
    const before = table[pick];
    const logs = [];
    assert.equal(mc.installRotnRecipesOnce(registry, { log: (m) => logs.push(m), load: () => ({ dump: {} }) }), null);
    assert.equal(mc.installRotnRecipesOnce(registry, { log: (m) => logs.push(m), load: () => { throw new Error('boom'); } }), null);
    assert.equal(mc.installRotnRecipesOnce(null, { log: (m) => logs.push(m) }), null);
    assert.equal(registry.recipes, table);
    assert.equal(table[pick], before, 'the vanilla stone pickaxe recipes are untouched');
    assert.ok(names12(registry, table[pick][0]).includes('cobblestone'), 'still the vanilla recipe (cobblestone)');
    // Messages carry no prefix of their own; initBot's log adds "[forge-bridge] " (#130 review nit 4).
    assert.deepEqual(logs, [
        'the dump has no recipe data: bot.registry keeps its vanilla recipes',
        'RotN recipes not installed: boom',
        'no registry: RotN recipes not installed',
    ]);
});

// #130 review 1: a failure after the table is cleared puts the previous (vanilla) table back.
test('an install that fails while refilling the table restores the previous recipes', () => {
    const registry = rotnRegistry();
    const vanilla = { ...registry.recipes };
    const keys = new Set(Object.keys(vanilla));
    // A table that refuses new keys: clearing works, refilling with RotN result ids throws.
    registry.recipes = new Proxy({ ...vanilla }, {
        defineProperty(target, key, d) {
            if (!keys.has(String(key))) throw new Error(`refused ${String(key)}`);
            return Reflect.defineProperty(target, key, d);
        },
    });
    const logs = [];
    assert.equal(mc.installRotnRecipesOnce(registry, { log: (m) => logs.push(m) }), null);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^RotN recipes not installed: refused \d+; the previous recipes were restored$/);
    assert.deepEqual(new Set(Object.keys(registry.recipes)), keys);
    const pick = registry.itemsByName.stone_pickaxe.id;
    assert.equal(registry.recipes[pick], vanilla[pick], 'the vanilla stone pickaxe recipes are back');
});

// #130 review 2: the install uses the injected catalog's recipes, not the real dump.
test('the injected catalog is what gets installed', () => {
    const registry = rotnRegistry();
    const fake = { dump: { recipes: { recipes: [{
        id: 'test:dirt_pick', type: 'shapeless', dynamic: false, requiresTable: false,
        result: { name: 'minecraft:stone_pickaxe', meta: 0, count: 1 },
        ingredients: [{ stacks: [{ name: 'minecraft:dirt', meta: 0 }] }],
    }] } } };
    const report = mc.installRotnRecipesOnce(registry, { log: () => {}, load: () => fake });
    assert.deepEqual([report.recipes, report.results], [1, 1]);
    assert.deepEqual(Object.keys(registry.recipes).map(Number), [registry.itemsByName.stone_pickaxe.id]);
    assert.deepEqual(names12(registry, registry.recipes[registry.itemsByName.stone_pickaxe.id][0]), ['dirt']);
});

// #130 review 1: the lazy build fails soft, so bot.recipesFor cannot throw from a bad conversion.
test('a recipe whose conversion throws is skipped and counted; reading the table does not throw', () => {
    const registry = rotnRegistry();
    const bad = {
        id: 'test:bad', type: 'shapeless', dynamic: false, requiresTable: false,
        result: { name: 'minecraft:stick', meta: 0, count: 1 },
        ingredients: [{ get stacks() { throw new Error('broken ingredient'); } }],
    };
    const good = { ...bad, id: 'test:good', ingredients: [{ stacks: [{ name: 'minecraft:planks', meta: 0 }] }] };
    const report = mc.installRotnRecipesOnce(registry, { log: () => {}, load: () => ({ dump: { recipes: { recipes: [bad, good] } } }) });
    const stick = registry.itemsByName.stick.id;
    let variants;
    assert.doesNotThrow(() => { variants = registry.recipes[stick]; });
    assert.deepEqual(variants.map((r) => names12(registry, r)), [['planks']], 'the good recipe is still there');
    const stats = report.stats();
    assert.equal(stats.errors, 1);
    assert.match(stats.firstError, /test:bad: broken ingredient/);
    // mineflayer's Recipe.find reads the same table.
    const Recipe = require('prismarine-recipe')(registry).Recipe;
    assert.doesNotThrow(() => Recipe.find(stick));
});

test('installRotnRecipesOnce installs RotN recipes exactly once per registry (login)', () => {
    const registry = rotnRegistry();
    const logs = [];
    const log = (m) => logs.push(m);
    const first = mc.installRotnRecipesOnce(registry, { log });
    assert.ok(first && first.recipes === 6089, JSON.stringify(first));
    const pick = registry.itemsByName.stone_pickaxe.id;
    const built = registry.recipes[pick];
    assert.deepEqual(names12(registry, built[0]).sort(), ['pyrotech:rock', 'pyrotech:rock', 'pyrotech:rock', 'stick', 'stick']);
    // A second call (the registries event again, or another caller): same report, nothing reinstalled.
    const second = mc.installRotnRecipesOnce(registry, { log });
    assert.equal(second, first);
    assert.equal(registry.recipes[pick], built, 'the built recipes were not replaced');
    assert.equal(logs.filter((m) => /RotN recipes installed/.test(m)).length, 1);
    // A new login is a new bot.registry: it gets its own install.
    const other = rotnRegistry();
    assert.notEqual(mc.installRotnRecipesOnce(other, { log }), null);
    assert.equal(logs.filter((m) => /RotN recipes installed/.test(m)).length, 2);
});

test('initBot calls installRotnRecipesOnce once, right after mcdata = bot.registry in the registries handler', () => {
    const src = fs.readFileSync(new URL('./mcdata.js', import.meta.url), 'utf8');
    const calls = src.match(/installRotnRecipesOnce\(bot\.registry/g) ?? [];
    assert.equal(calls.length, 1, 'exactly one call in initBot');
    const handler = src.indexOf("bridge.on('registries'");
    const assign = src.indexOf('mcdata = bot.registry;', handler);
    const call = src.indexOf('installRotnRecipesOnce(bot.registry', handler);
    const emit = src.indexOf("bot.emit('forge_registry'", handler);
    assert.ok(handler > 0 && handler < assign && assign < call && call < emit, 'after extendRegistry and mcdata = bot.registry, before forge_registry is emitted');
    assert.match(src.slice(assign, call), /Lead exception \(Request 7/, 'the code comment names the exception');
});
