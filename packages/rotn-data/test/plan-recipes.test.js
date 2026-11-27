// Soak 17 L3: what mcdata's crafting planner reads from the dump (src/plan-recipes.js): an item's recipes with every
// member of each ore input, inventory keys, the canFill shortfall, which items are rocks, and the cobble held rocks make.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRotnData } from '../src/catalog.js';
import { oreLabel, parseKey } from '../src/plan-recipes.js';

const pack = loadRotnData('3.3.4');

test('planRecipes: the stone pickaxe takes 3 of any rock and 2 ladderMat, rock recipe first; every member is listed', () => {
    const [rock, flint] = pack.planRecipes('stone_pickaxe');
    assert.equal(rock.recipeId, 'crafttweaker:stone_pickaxe');
    assert.equal(flint.recipeId, 'crafttweaker:flintstone_pickaxe');
    assert.deepEqual(rock.gives, { name: 'stone_pickaxe', meta: 0, count: 1, key: 'stone_pickaxe' });
    const [rocks, sticks] = rock.inputs;
    assert.equal(rocks.count, 3);
    assert.equal(rocks.ore, 'rock');
    assert.equal(rocks.label, 'rock (any of pyrotech:rock, pyrotech_compat:rock_*)');
    // Inventory keys, pyrotech first: a wildcard member is its bare name, a listed meta is "name:meta".
    assert.deepEqual(rocks.keys.slice(0, 4), ['pyrotech:rock:0', 'pyrotech:rock:6', 'pyrotech:rock:8', 'pyrotech_compat:rock_igneous']);
    assert.ok(rocks.keys.includes('pyrotech_compat:rock_metamorphic'));
    assert.ok(!rocks.keys.includes('pyrotech:rock:4'), 'a dirt clump is not a rock');
    assert.equal(sticks.count, 2);
    assert.equal(sticks.keys[0], 'stick');
    assert.equal(sticks.ore, 'ladderMat');
});

test('planRecipes: the result is taken out of its own ingredient; the dropped and duplicate recipes are left out', () => {
    const cobble = pack.planRecipes('cobblestone');
    assert.deepEqual(cobble[0].inputs.map((i) => [i.count, i.label]), [[4, 'pyrotech:rock:0']], '4 stone rocks first');
    const ub = cobble.find((w) => w.recipeId === 'undergroundbiomes:regular_cobblestone');
    assert.ok(!ub.inputs[0].keys.includes('cobblestone'), '4 of any other cobble -> 4 cobblestone');
    assert.ok(ub.inputs[0].keys.includes('undergroundbiomes:metamorphic_cobble:6'));
    // The canFill recipe has the result's stacks taken out too: 4 cobblestone do not fill it.
    assert.equal(pack.fillShortfall(ub.recipe, [{ cobblestone: 4 }]), 4);
    // recipe-collisions.json drops planks from 9 sticks (the stick wall wins on the server).
    assert.ok(!pack.planRecipes('planks').some((w) => w.recipeId === 'dungeontactics:misc/convenience/planks_from_sticks'));
    // A named meta: only that kind's recipes; the result key carries the meta.
    const meta0 = pack.planRecipes('undergroundbiomes:metamorphic_cobble', { meta: 0 });
    assert.equal(meta0[0].gives.key, 'undergroundbiomes:metamorphic_cobble:0');
    assert.deepEqual(meta0[0].inputs.map((i) => [i.count, i.keys]), [[4, ['pyrotech_compat:rock_metamorphic:0']]]);
    assert.ok(meta0.every((w) => w.gives.meta === 0));
    assert.deepEqual(pack.planRecipes('wooden_pickaxe'), [], 'RotN has no wooden tools');
});

test('fillShortfall: every held member counts, a mix of rocks fills one recipe, a bare total fills only an any-meta slot', () => {
    const recipe = pack.planRecipes('stone_pickaxe')[0].recipe;
    const pools = [{ 'pyrotech_compat:rock_metamorphic:0': 2 }, { 'pyrotech:rock:8': 1, stick: 2 }];
    assert.equal(pack.fillShortfall(recipe, pools), 0, 'inventory and leftovers together, two rock kinds');
    assert.equal(pack.fillShortfall(recipe, pools, { times: 2 }), 5);
    assert.equal(pack.fillShortfall(recipe, [{ 'pyrotech:rock:4': 3, stick: 2 }]), 3, 'dirt clumps fill no rock slot');
    assert.equal(pack.fillShortfall(recipe, [{ 'pyrotech:rock': 3, stick: 2 }]), 3, 'pyrotech:rock is listed by meta: a bare total cannot vouch');
    assert.equal(pack.fillShortfall(recipe, [{ 'pyrotech_compat:rock_igneous': 3, stick: 2 }]), 0, 'igneous rocks are listed for any meta');
    assert.equal(pack.fillShortfall('nosuch:recipe', [{}]), null);
});

test('inOre, rocks and cobbles; cobbleFromRocks: the cobble the most held rocks make', () => {
    assert.equal(pack.inOre('rock', 'pyrotech:rock', 0), true);
    assert.equal(pack.inOre('rock', 'pyrotech:rock', 4), false, 'a dirt clump');
    assert.equal(pack.inOre('rock', 'pyrotech:rock'), true, 'any meta');
    assert.equal(pack.inOre('rock', 'pyrotech_compat:rock_metamorphic', 6), true);
    assert.equal(pack.inOre('rock', 'flint', 0), false, 'flint fits the crude axe slot but is not in the ore');
    assert.equal(pack.inOre('cobblestone', 'undergroundbiomes:metamorphic_cobble', 0), true);
    assert.equal(pack.inOre('cobblestone', 'cobblestone', 0), true);
    const have = (inv) => (k) => inv[k] ?? 0;
    // Soak 17 (18:07:32): 20 metamorphic rocks and some limestone rocks make metamorphic cobble.
    assert.deepEqual(pack.cobbleFromRocks(have({ 'pyrotech_compat:rock_metamorphic:0': 20, 'pyrotech:rock:8': 8 })),
        { rock: 'pyrotech_compat:rock_metamorphic:0', gives: 'undergroundbiomes:metamorphic_cobble:0', have: 20 });
    assert.deepEqual(pack.cobbleFromRocks(have({ 'pyrotech_compat:rock_metamorphic:0': 3, 'pyrotech:rock:8': 8 })),
        { rock: 'pyrotech:rock:8', gives: 'contenttweaker:limestone_cobble:0', have: 8 });
    // pyrotech:rock:6 makes sandstone, which is not a cobblestone.
    assert.equal(pack.cobbleFromRocks(have({ 'pyrotech:rock:6': 40 })), null);
    assert.equal(pack.cobbleFromRocks(have({})), null);
});

test('oreLabel and parseKey', () => {
    assert.equal(oreLabel('rock', [{ name: 'pyrotech:rock' }, { name: 'pyrotech_compat:rock_igneous' }, { name: 'pyrotech_compat:rock_metamorphic' }]),
        'rock (any of pyrotech:rock, pyrotech_compat:rock_*)');
    assert.equal(oreLabel(null, [{ name: 'minecraft:slime_ball' }, { name: 'betterslimes:black_slime' }]), 'any of slime_ball, betterslimes:black_slime');
    assert.equal(oreLabel('x', 'abcdefgh'.split('').map((c) => ({ name: `m${c}:${c}` }))), 'x (any of ma:a, mb:b, mc:c, md:d, me:e, mf:f, ...)');
    // #669 review 4: metas of one item keep their metas (the torch's coal or charcoal).
    assert.equal(oreLabel(null, [{ name: 'minecraft:coal', meta: 0 }, { name: 'minecraft:coal', meta: 1 }]), 'any of coal:0, coal:1');
    const torch = pack.planRecipes('torch').find((w) => w.inputs.some((i) => i.keys.includes('coal:1')));
    assert.ok(torch.inputs.some((i) => i.label === 'any of coal:0, coal:1'), JSON.stringify(torch.inputs.map((i) => i.label)));
    // Soak 18: an item listed once keeps its inventory key: the twine handle's slot is twine (pyrotech:material:14) or string,
    // not "any of pyrotech:material, string"; the rock label (pyrotech:rock at three metas) is unchanged.
    const handle = pack.planRecipes('spartanweaponry:material', { meta: 0 }).find((w) => w.recipeId === 'crafttweaker:string_twine_handle');
    assert.equal(handle.inputs[1].label, 'any of pyrotech:material:14, string');
    assert.equal(oreLabel(null, [{ name: 'pyrotech:material', meta: 14, key: 'pyrotech:material:14' }, { name: 'minecraft:string', meta: 0, key: 'string' }]), 'any of pyrotech:material:14, string');
    assert.equal(pack.planRecipes('stone_sword')[0].inputs[0].label, 'rock (any of pyrotech:rock, pyrotech_compat:rock_*)');
    assert.deepEqual(parseKey('pyrotech:rock:8'), { name: 'pyrotech:rock', meta: 8 });
    assert.deepEqual(parseKey('pyrotech:rock'), { name: 'pyrotech:rock', meta: null });
    assert.deepEqual(parseKey('stick'), { name: 'stick', meta: null });
});
