// RotN recipes in minecraft-data's recipe format (src/registry-recipes.js): unit tests on a small
// fake registry. The real-registry and mineflayer-level tests are in src/utils/mcdata.rotn.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choiceTuples, convertRecipe, installRecipes, groupOptions, costTuples } from '../src/registry-recipes.js';

// minecraft-data style: vanilla names without "minecraft:", modded names in full.
const NAMES = ['stick', 'flint', 'planks', 'cobblestone', 'stone_pickaxe', 'pyrotech:rock', 'pyrotech:crude_axe', 'betterwithmods:shaft', 'wool', 'dye'];
const fakeRegistry = () => ({
    itemsByName: Object.fromEntries(NAMES.map((n, i) => [n, { id: 100 + i, name: n }])),
    recipes: { 999: [{ ingredients: [1], result: { id: 999, metadata: 0, count: 1 } }] },
});
const ID = (reg, n) => reg.itemsByName[n].id;
const rock = { ores: ['rock'], stacks: [{ name: 'minecraft:flint', meta: 0 }, { name: 'pyrotech:rock', meta: 0 }, { name: 'pyrotech:rock', meta: 6 }] };
const stickWood = { ore: 'stickWood', stacks: [{ name: 'betterwithmods:shaft', meta: 0 }, { name: 'minecraft:stick', meta: 0 }] };
const crudeAxe = { id: 'crafttweaker:pyro_crude_axe', type: 'shaped', dynamic: false, requiresTable: false, result: { name: 'pyrotech:crude_axe', meta: 0, count: 1 }, width: 2, height: 2, slots: [rock, stickWood, stickWood, null] };

test('choiceTuples: smallest index sum first, capped, and empty when a group is empty', () => {
    assert.deepEqual(choiceTuples([2, 2], 10), [[0, 0], [0, 1], [1, 0], [1, 1]]);
    assert.deepEqual(choiceTuples([3, 1, 2], 3), [[0, 0, 0], [0, 0, 1], [1, 0, 0]]);
    assert.deepEqual(choiceTuples([], 5), [[]]);
    assert.deepEqual(choiceTuples([2, 0], 5), []);
    assert.equal(choiceTuples([40, 40, 40], 256).length, 256);
});

test('a shaped recipe: pyrotech and vanilla stacks first; equal ingredients take the same stack, then mixed', () => {
    const reg = fakeRegistry();
    const { variants, skipped, truncated } = convertRecipe(reg, crudeAxe);
    assert.equal(skipped, null);
    assert.equal(truncated, false);
    // rock group: pyrotech:rock 0, pyrotech:rock 6, flint; stick group: stick, shaft -> 6 variants
    // rock (1 slot): 3 options; sticks (2 slots, stick or shaft): stick+stick, shaft+shaft, stick+shaft.
    assert.equal(variants.length, 9);
    assert.deepEqual(variants[0], {
        inShape: [[{ id: ID(reg, 'pyrotech:rock'), metadata: 0 }, { id: ID(reg, 'stick'), metadata: 0 }], [{ id: ID(reg, 'stick'), metadata: 0 }, null]],
        result: { id: ID(reg, 'pyrotech:crude_axe'), metadata: 0, meta: 0, count: 1 },
    });
    // The uniform variants come first; a mixed one (a stick and a shaft) exists too (#145 review).
    for (const v of variants.slice(0, 2)) assert.deepEqual(v.inShape[0][1], v.inShape[1][0], 'uniform first (stick+stick, shaft+shaft)');
    assert.ok(variants.some((v) => v.inShape[0][1].id === ID(reg, 'stick') && v.inShape[1][0].id === ID(reg, 'betterwithmods:shaft')), 'a stick and a shaft');
    assert.ok(variants.some((v) => v.inShape[0][0].id === ID(reg, 'flint')));
});

test('shapeless, wildcard metadata, NBT stacks and unknown items', () => {
    const reg = fakeRegistry();
    const r = {
        id: 'x', type: 'shapeless', dynamic: false, requiresTable: false, result: { name: 'minecraft:cobblestone', meta: 0, count: 1 },
        ingredients: [
            { stacks: [{ name: 'pyrotech:rock', meta: 32767 }, { name: 'pyrotech:rock', meta: 0, nbt: '{a:1}' }, { name: 'nosuchmod:rock', meta: 0 }] },
            { stacks: [{ name: 'pyrotech:rock', meta: 32767 }] },
        ],
    };
    const { variants } = convertRecipe(reg, r);
    assert.deepEqual(variants, [{ ingredients: [{ id: ID(reg, 'pyrotech:rock'), metadata: null }, { id: ID(reg, 'pyrotech:rock'), metadata: null }], result: { id: ID(reg, 'cobblestone'), metadata: 0, meta: 0, count: 1 } }]);
});

test('skipped: dynamic, sample mismatch, unknown result, an ingredient with no usable stack', () => {
    const reg = fakeRegistry();
    assert.equal(convertRecipe(reg, { ...crudeAxe, dynamic: true }).skipped, 'dynamic');
    assert.equal(convertRecipe(reg, { ...crudeAxe, matchesSample: false }).skipped, 'sample grid did not match');
    assert.equal(convertRecipe(reg, { ...crudeAxe, result: { name: 'nosuchmod:axe', meta: 0, count: 1 } }).skipped, 'result not in the registry');
    const onlyNbt = { stacks: [{ name: 'minecraft:stick', meta: 0, nbt: '{x:1}' }] };
    assert.equal(convertRecipe(reg, { ...crudeAxe, slots: [rock, onlyNbt, onlyNbt, null] }).skipped, 'an ingredient has no usable stack');
});

test('variants that take the result itself are dropped (ore dictionary conversions)', () => {
    const reg = fakeRegistry();
    const cobble = { ore: 'cobblestone', stacks: [{ name: 'minecraft:cobblestone', meta: 0 }, { name: 'pyrotech:rock', meta: 0 }] };
    const r = { id: 'conv', type: 'shapeless', dynamic: false, requiresTable: false, result: { name: 'minecraft:cobblestone', meta: 0, count: 1 }, ingredients: [cobble] };
    const { variants } = convertRecipe(reg, r);
    assert.deepEqual(variants.map((v) => v.ingredients[0].id), [ID(reg, 'pyrotech:rock')]);
    // Wildcard metadata of the result's item counts as the result too.
    const wool = { stacks: [{ name: 'minecraft:wool', meta: 32767 }] };
    const dye = { stacks: [{ name: 'minecraft:dye', meta: 15 }] };
    assert.deepEqual(convertRecipe(reg, { ...r, result: { name: 'minecraft:wool', meta: 0, count: 1 }, ingredients: [wool, dye] }).variants, []);
});

test('the cap and truncated flag', () => {
    const reg = fakeRegistry();
    const { variants, truncated } = convertRecipe(reg, crudeAxe, { maxVariants: 4 });
    assert.equal(variants.length, 4);
    assert.equal(truncated, true);
});

test('installRecipes: same object, vanilla contents replaced, built lazily and once per result id', () => {
    const reg = fakeRegistry();
    const table = reg.recipes;
    const flintPick = { ...crudeAxe, id: 'flintstone_pickaxe', requiresTable: true, result: { name: 'minecraft:stone_pickaxe', meta: 0, count: 1 }, width: 3, height: 3, slots: [{ stacks: [{ name: 'minecraft:flint', meta: 0 }] }, { stacks: [{ name: 'minecraft:flint', meta: 0 }] }, { stacks: [{ name: 'minecraft:flint', meta: 0 }] }, null, stickWood, null, null, stickWood, null] };
    const rockPick = { ...flintPick, id: 'stone_pickaxe', slots: [rock, rock, rock, null, stickWood, null, null, stickWood, null] };
    const report = installRecipes(reg, [crudeAxe, flintPick, rockPick, { ...crudeAxe, result: { name: 'nosuchmod:x', meta: 0, count: 1 } }]);
    assert.equal(reg.recipes, table, 'the same object (prismarine-recipe keeps a reference)');
    assert.equal(table[999], undefined, 'vanilla entries are gone');
    assert.deepEqual(Object.keys(table).map(Number).sort(), [ID(reg, 'stone_pickaxe'), ID(reg, 'pyrotech:crude_axe')].sort());
    assert.deepEqual(report.resultNotInRegistry, 1);
    assert.equal(report.stats().results, 0, 'nothing built yet');
    const picks = table[ID(reg, 'stone_pickaxe')];
    // The rock recipe sorts before the flint one (pyrotech before minecraft), whatever the dump order.
    assert.equal(picks[0].inShape[0][0].id, ID(reg, 'pyrotech:rock'));
    // rock pick: rock (3 slots, 3 candidates) 3 uniform + 7 mixed, sticks (2 slots) 3 -> 30; flint pick: 1 x 3 -> 3.
    assert.equal(picks.length, 30 + 3);
    assert.equal(table[ID(reg, 'stone_pickaxe')], picks, 'built once, then a plain value');
    assert.equal(report.stats().results, 1);
    assert.throws(() => installRecipes(null, []), /registry is required/);
});

// #145 review: equal ingredients in several slots also get mixed variants (mineflayer fills a slot
// with one {id, metadata}; the server accepts any matching stack per slot).
test('groupOptions: uniform first, then mixes of the likeliest candidates within the budget; cost = least likely used', () => {
    assert.deepEqual(groupOptions(3, 1).map((o) => o.slots), [[0], [1], [2]]);
    const three = groupOptions(3, 3);
    assert.deepEqual(three.map((o) => o.slots.join('')), ['000', '111', '001', '011', '222', '002', '012', '022', '112', '122']);
    assert.deepEqual(three.map((o) => o.cost), [0, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
    // 13 rock candidates in 3 slots: mixes only among the first 6 (C(8,3) = 56 <= 64; C(9,3) = 84 > 64).
    const rocks = groupOptions(13, 3);
    assert.equal(rocks.filter((o) => o.uniform).length, 13);
    assert.equal(rocks.filter((o) => !o.uniform).length, 56 - 6);
    assert.ok(rocks.filter((o) => !o.uniform).every((o) => Math.max(...o.slots) < 6));
    assert.deepEqual(groupOptions(13, 3, { mixBudget: 1 }).filter((o) => !o.uniform).map((o) => o.slots.join('')), ['001', '011'], 'at least the two likeliest mix');
});

test('costTuples: smallest total cost first, capped', () => {
    assert.deepEqual(costTuples([[0, 1, 2], [0, 1]], 10), [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]]);
    assert.deepEqual(costTuples([[0, 1, 1], [0]], 2), [[0, 0], [1, 0]]);
    assert.deepEqual(costTuples([[0], []], 5), []);
});

test('a stone pickaxe from mixed rocks (one igneous, two metamorphic) has a variant', () => {
    const reg = fakeRegistry();
    reg.itemsByName['pyrotech_compat:rock_igneous'] = { id: 200, name: 'pyrotech_compat:rock_igneous' };
    reg.itemsByName['pyrotech_compat:rock_metamorphic'] = { id: 201, name: 'pyrotech_compat:rock_metamorphic' };
    const ub = { ores: ['rock'], stacks: [{ name: 'pyrotech:rock', meta: 0 }, { name: 'pyrotech_compat:rock_igneous', meta: 32767 }, { name: 'pyrotech_compat:rock_metamorphic', meta: 32767 }] };
    const pick = { ...crudeAxe, id: 'stone_pickaxe', requiresTable: true, result: { name: 'minecraft:stone_pickaxe', meta: 0, count: 1 }, width: 3, height: 3,
        slots: [ub, ub, ub, null, stickWood, null, null, stickWood, null] };
    const { variants } = convertRecipe(reg, pick);
    const row = (v) => v.inShape[0].map((x) => [x.id, x.metadata]);
    assert.deepEqual(row(variants[0]), [[ID(reg, 'pyrotech:rock'), 0], [ID(reg, 'pyrotech:rock'), 0], [ID(reg, 'pyrotech:rock'), 0]], 'uniform first');
    assert.ok(variants.some((v) => JSON.stringify(row(v)) === JSON.stringify([[200, null], [201, null], [201, null]])), 'igneous + 2 metamorphic (any meta)');
});
