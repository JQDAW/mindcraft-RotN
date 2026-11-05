// Offline tests for G3 round 3 batch A: !craftRecipe("cobblestone") and the agenda's cobblestone
// step use the cobblestone the bot's rocks make (rotn-data's 4-rocks rock recipes), not vanilla
// cobblestone's recipes (4 plain rocks, or Twilight Forest's giant cobblestone). The registry is
// minecraft-data 1.12.2 plus the modded rocks and cobbles, with RotN's recipes installed as initBot
// does; the fake bot's craft takes 4 rocks and gives the recipe's output. No server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { installRecipes } from '../../../packages/rotn-data/index.js';
import prismarineRecipe from 'prismarine-recipe';
import { cobbleRecipes, cobbleChoices, isGenericCobble, __resetCobbleCache } from './cobble.js';

const vanilla = minecraftData('1.12.2');
const reg = { ...vanilla, items: { ...vanilla.items }, itemsByName: { ...vanilla.itemsByName }, recipes: { ...vanilla.recipes } };
const MODDED = ['pyrotech:rock', 'pyrotech_compat:rock_igneous', 'pyrotech_compat:rock_metamorphic', 'pyrotech_compat:rock_sedimentary',
    'contenttweaker:chalk_cobble', 'contenttweaker:shale_cobble', 'undergroundbiomes:igneous_cobble', 'undergroundbiomes:metamorphic_cobble',
    'twilightforest:giant_cobblestone'];
MODDED.forEach((name, i) => {
    const item = { id: 6000 + i, name, stackSize: 64 };
    reg.items[item.id] = item;
    reg.itemsByName[name] = item;
});
installRecipes(reg);
__setRegistryForTest(reg);

const stack = (name, metadata, count) => ({ name, metadata, count, type: reg.itemsByName[name].id });

/** A bot whose craft takes 4 of the recipe's rock and gives its output (as the server does). */
function craftBot(items) {
    let inv = [...items];
    const crafts = [];
    const bot = {
        output: '', registry: reg, version: '1.12.2',
        entity: { position: new Vec3(0, 64, 0) },
        inventory: { items: () => inv.filter(i => i.count > 0), get slots() { return [null, ...inv]; } },
        modes: { isOn: () => false },
        armorManager: { equipAll() {} },
        findBlocks: () => [], blockAt: () => null,
        recipesFor: () => [], // the registry's capped variants: craftRecipe uses rotn-data's fill
        craft: (recipe) => {
            const out = recipe.result;
            const rocks = (recipe.ingredients ?? recipe.inShape.flat()).filter(c => c && c.id !== -1);
            assert.equal(rocks.length, 4, '4 rocks per cobblestone');
            const r = rocks[0];
            const rock = inv.find(i => i.type === r.id && i.metadata === r.metadata);
            assert.ok(rock && rock.count >= 4, 'the rocks the recipe names are held');
            rock.count -= 4;
            const name = reg.items[out.id].name;
            crafts.push(`${name}:${out.metadata ?? 0}`);
            const have = inv.find(i => i.type === out.id && i.metadata === (out.metadata ?? 0));
            if (have) have.count += out.count; else inv.push(stack(name, out.metadata ?? 0, out.count));
            return Promise.resolve();
        },
    };
    return { bot, crafts };
}

test('the rock recipes that make cobblestone come from rotn-data: one per rock kind, no sandstone', () => {
    const r = cobbleRecipes();
    assert.equal(r.length, 26);
    const of = (rock) => r.find(x => x.rock === rock)?.gives;
    assert.equal(of('pyrotech_compat:rock_sedimentary:0'), 'contenttweaker:chalk_cobble:0');
    assert.equal(of('pyrotech_compat:rock_igneous:2'), 'undergroundbiomes:igneous_cobble:2');
    assert.equal(of('pyrotech_compat:rock_metamorphic:6'), 'undergroundbiomes:metamorphic_cobble:6');
    assert.equal(of('pyrotech:rock:0'), 'cobblestone');
    assert.equal(of('pyrotech:rock:6'), undefined, 'plain rock 6 makes sandstone, not cobblestone');
    assert.ok(isGenericCobble('cobblestone') && isGenericCobble('minecraft:cobblestone') && !isGenericCobble('cobblestone:0'));
});

test('the choice follows the rocks held: sedimentary, igneous, metamorphic, plain; 3 + 3 of two kinds make none', () => {
    const bot = (items) => ({ inventory: { items: () => items } });
    const first = (items) => cobbleChoices(bot(items))[0]?.gives ?? null;
    assert.equal(first([stack('pyrotech_compat:rock_sedimentary', 0, 8)]), 'contenttweaker:chalk_cobble:0');
    assert.equal(first([stack('pyrotech_compat:rock_igneous', 2, 5)]), 'undergroundbiomes:igneous_cobble:2');
    assert.equal(first([stack('pyrotech_compat:rock_metamorphic', 6, 4)]), 'undergroundbiomes:metamorphic_cobble:6');
    assert.equal(first([stack('pyrotech:rock', 0, 4)]), 'cobblestone');
    assert.equal(first([stack('pyrotech_compat:rock_sedimentary', 0, 3), stack('pyrotech_compat:rock_igneous', 0, 3)]), null);
    assert.equal(first([stack('pyrotech_compat:rock_sedimentary', 1, 4), stack('pyrotech_compat:rock_metamorphic', 0, 9)]),
        'undergroundbiomes:metamorphic_cobble:0', 'the kind with the most rocks first');
});

test('round 3 A: !craftRecipe("cobblestone", 2) with 8 sedimentary rocks crafts 2 chalk cobble, not giant cobblestone', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftRecipe } = await import('./skills.js');
    const { bot, crafts } = craftBot([stack('pyrotech_compat:rock_sedimentary', 0, 8)]);
    assert.equal(await craftRecipe(bot, 'cobblestone', 2), true, bot.output);
    assert.deepEqual(crafts, ['contenttweaker:chalk_cobble:0', 'contenttweaker:chalk_cobble:0']);
    assert.match(bot.output, /Cobblestone from your rocks: 2 contenttweaker:chalk_cobble:0 \(4 pyrotech_compat:rock_sedimentary:0 each\)\./);
    assert.doesNotMatch(bot.output, /giant_cobblestone/);
});

test('round 3 A: igneous, metamorphic and plain rocks each make their own cobblestone; mixed kinds fill the count', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftRecipe } = await import('./skills.js');
    for (const [rock, meta, gives] of [
        ['pyrotech_compat:rock_igneous', 2, 'undergroundbiomes:igneous_cobble:2'],
        ['pyrotech_compat:rock_metamorphic', 6, 'undergroundbiomes:metamorphic_cobble:6'],
        ['pyrotech:rock', 0, 'cobblestone:0'],
    ]) {
        const { bot, crafts } = craftBot([stack(rock, meta, 4)]);
        assert.equal(await craftRecipe(bot, 'cobblestone', 1), true, `${rock}: ${bot.output}`);
        assert.deepEqual(crafts, [gives], rock);
    }
    const { bot, crafts } = craftBot([stack('pyrotech_compat:rock_sedimentary', 0, 4), stack('pyrotech_compat:rock_igneous', 0, 4)]);
    assert.equal(await craftRecipe(bot, 'cobblestone', 2), true, bot.output);
    assert.deepEqual(crafts.sort(), ['contenttweaker:chalk_cobble:0', 'undergroundbiomes:igneous_cobble:0']);
});

test('round 3 A: too few rocks of any one kind: a clear line, no craft', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftRecipe } = await import('./skills.js');
    const { bot, crafts } = craftBot([stack('pyrotech_compat:rock_sedimentary', 0, 3), stack('pyrotech_compat:rock_igneous', 1, 2)]);
    assert.equal(await craftRecipe(bot, 'cobblestone', 1), false);
    assert.deepEqual(crafts, []);
    assert.match(bot.output, /Cobblestone takes 4 rocks of one kind, and each kind makes its own cobblestone; you have 3 pyrotech_compat:rock_sedimentary:0, 2 pyrotech_compat:rock_igneous:1\./);
});

// #233 review 1: bot.recipesFor can offer another recipe for the same output
// (undergroundbiomes:regular_cobblestone: 4 modded cobbles into vanilla cobblestone). The craft
// must use the rock's own recipe, and only what it really made counts.
test('#233 review 1: plain rocks make cobblestone by the rock recipe, never from the bot\'s modded cobble', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftRecipe } = await import('./skills.js');
    const { bot, crafts } = craftBot([stack('pyrotech:rock', 0, 4), stack('undergroundbiomes:metamorphic_cobble', 0, 4)]);
    const { Recipe } = prismarineRecipe(reg);
    // what mineflayer's recipesFor could return for vanilla cobblestone: the cobble-converting recipe
    const cobbleId = reg.itemsByName['undergroundbiomes:metamorphic_cobble'].id;
    bot.recipesFor = () => Recipe.find(reg.itemsByName.cobblestone.id, null)
        .filter(r => (r.ingredients ?? r.inShape?.flat() ?? []).some(c => c && c.id === cobbleId));
    assert.equal(await craftRecipe(bot, 'cobblestone', 1), true, bot.output);
    assert.deepEqual(crafts, ['cobblestone:0']);
    const left = (name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
    assert.equal(left('undergroundbiomes:metamorphic_cobble'), 4, 'the modded cobble is untouched');
    assert.equal(left('pyrotech:rock'), 0, 'the rocks were used');
});

test('#233 review 4: a failed oredict load is not cached', () => {
    __resetCobbleCache();
    assert.deepEqual(cobbleRecipes(() => { throw new Error('dump not readable'); }), []);
    assert.equal(cobbleRecipes().length, 26, 'the next call loads again');
    assert.equal(cobbleRecipes(() => { throw new Error('not called: cached now'); }).length, 26);
});
