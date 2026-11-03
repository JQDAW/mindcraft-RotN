// canFill (#152 review, for skills-rotn #151): can these inventory stacks fill a recipe or a
// howToGet craft way? On the committed RotN 3.3.4 data, offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRotnData } from '../src/catalog.js';

const pack = loadRotnData('3.3.4');
const rockPick = pack.recipesFor('minecraft:stone_pickaxe').find((r) => r.inShape.flat().some((c) => c?.ores?.includes('rock')));
const stick2 = { name: 'stick', meta: 0, count: 2 };

test('mixed rock families fill a stone pickaxe; slots are independent', () => {
    const r = pack.canFill(rockPick, [{ name: 'pyrotech_compat:rock_igneous', meta: 3, count: 1 }, { name: 'pyrotech_compat:rock_metamorphic', meta: 0, count: 2 }, stick2]);
    assert.equal(r.ok, true);
    assert.equal(r.missing, 0);
    const used = r.assignment.filter(Boolean).map((x) => x.name).sort();
    assert.deepEqual(used, ['minecraft:stick', 'minecraft:stick', 'pyrotech_compat:rock_igneous', 'pyrotech_compat:rock_metamorphic', 'pyrotech_compat:rock_metamorphic']);
    // The reviewer's single-kind case: 3 sedimentary sand rocks (meta 8).
    assert.equal(pack.canFill(rockPick, [{ name: 'pyrotech_compat:rock_sedimentary_sand', meta: 8, count: 3 }, stick2]).ok, true);
});

test('wrong variants and too few items do not fill it, and say how many slots are missing', () => {
    // A dirt clump is not a rock.
    const clump = pack.canFill(rockPick, [{ name: 'pyrotech:rock', meta: 4, count: 1 }, { name: 'pyrotech:rock', meta: 0, count: 2 }, stick2]);
    assert.deepEqual([clump.ok, clump.missing], [false, 1]);
    assert.deepEqual(clump.assignment.filter((x) => x === null).length, 1);
    // pyrotech:rock 1 (granite rock) is not in the rock ore either.
    assert.equal(pack.canFill(rockPick, [{ name: 'pyrotech:rock', meta: 1, count: 3 }, stick2]).ok, false);
    assert.equal(pack.canFill(rockPick, [{ name: 'pyrotech:rock', meta: 0, count: 3 }]).missing, 2, 'no sticks');
    // Twice needs twice as much.
    assert.equal(pack.canFill(rockPick, [{ name: 'pyrotech:rock', meta: 0, count: 3 }, stick2], { times: 2 }).ok, false);
    assert.equal(pack.canFill(rockPick, [{ name: 'pyrotech:rock', meta: 0, count: 6 }, { name: 'stick', meta: 0, count: 4 }], { times: 2 }).ok, true);
});

test('stacks no slot accepts are ignored; assignment lists the first craft only (#152 nits)', () => {
    const fit = [{ name: 'pyrotech:rock', meta: 0, count: 6 }, { name: 'stick', meta: 0, count: 4 }];
    // A full inventory of unrelated items (and a dirt clump, which no slot accepts) changes nothing.
    const junk = [...Array.from({ length: 30 }, (_, i) => ({ name: 'dirt', meta: i % 3, count: 64 })), { name: 'pyrotech:rock', meta: 4, count: 64 }];
    for (const times of [1, 2, 3]) {
        assert.deepEqual(pack.canFill(rockPick, [...junk, ...fit], { times }), pack.canFill(rockPick, fit, { times }), `times ${times}`);
    }
    assert.deepEqual(pack.canFill(rockPick, junk), { ok: false, missing: 5, assignment: [null, null, null, null, null], recipeId: rockPick.id ?? null });
    // times 2: ten slots are matched, but the assignment has the five of one craft.
    const twice = pack.canFill(rockPick, fit, { times: 2 });
    assert.equal(twice.ok, true);
    assert.equal(twice.assignment.length, 5);
    assert.ok(twice.assignment.every(Boolean));
});

test('one item is never counted for two slots (a wildcard and a specific meta of one item)', () => {
    const r = { id: 'test:sand', ingredients: [{ stacks: [{ name: 'minecraft:sand', meta: 32767 }] }, { stacks: [{ name: 'minecraft:sand', meta: 1 }] }] };
    assert.equal(pack.canFill(r, [{ name: 'sand', meta: 1, count: 1 }]).ok, false, 'one red sand cannot fill both');
    assert.equal(pack.canFill(r, [{ name: 'sand', meta: 1, count: 1 }, { name: 'sand', meta: 0, count: 1 }]).ok, true, 'the matching puts red sand where only red sand fits');
    // NBT stacks are not matched (as in registry-recipes.js).
    const nbt = { id: 'test:nbt', ingredients: [{ stacks: [{ name: 'minecraft:book', meta: 0, nbt: '{x:1}' }] }] };
    assert.equal(pack.canFill(nbt, [{ name: 'book', meta: 0, count: 1 }]).ok, false);
});

test('a howToGet craft way or a recipe id works the same; names may be bot names or full names', () => {
    const way = pack.howToGet('pyrotech:crude_axe').ways.find((w) => w.kind === 'craft');
    const stacks = [{ name: 'pyrotech_compat:rock_metamorphic', metadata: 6, count: 1 }, { name: 'minecraft:stick', count: 2 }];
    assert.equal(pack.canFill(way, stacks).ok, true);
    assert.equal(pack.canFill(way.recipeId, stacks).ok, true);
    assert.equal(pack.canFill(way, [{ name: 'pyrotech:rock', meta: 4, count: 1 }, stick2]).ok, false);
    assert.equal(pack.canFill('no:such_recipe', stacks), null);
    assert.equal(pack.recipeById(way.recipeId).id, way.recipeId);
});
