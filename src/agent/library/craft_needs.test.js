// Offline tests for skills-rotn C1's recipe check (no slot clicks): what the bot
// still needs by RotN's recipes (rotn-data howToGet craft ways), judged by
// rotn-data's canFill (#152): slots are independent, so mixed rocks make a stone
// tool, while cobblestone (one recipe per rock type) still needs one type. A
// fake inventory on the 1.12.2 registry; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { parseCommandMessage, getCommand } from '../commands/index.js';
import { craftNeeds, describeNeeds, filledRecipe, fillNow } from './craft_needs.js';
import prismarineRecipe from 'prismarine-recipe';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);

const stack = (name, metadata, count) => ({ name, metadata, count, type: reg.itemsByName[name]?.id ?? 5000 });
const invBot = (items) => ({ inventory: { items: () => items, slots: [null, ...items] } });

test('mixed rocks make a stone pickaxe (rotn-data canFill: slots are independent)', () => {
    const bot = invBot([stack('pyrotech_compat:rock_metamorphic', 0, 2), stack('pyrotech_compat:rock_igneous', 7, 1), stack('stick', 0, 2)]);
    const needs = craftNeeds(bot, 'stone_pickaxe');
    assert.equal(needs.ready, true);
    assert.equal(needs.short, 0);
    assert.equal(needs.requiresTable, true);
});

test('two rocks short of one: get 1 more of any rock', () => {
    const bot = invBot([stack('pyrotech_compat:rock_metamorphic', 0, 2), stack('stick', 0, 4)]);
    const needs = craftNeeds(bot, 'stone_pickaxe');
    assert.equal(needs.ready, false);
    assert.equal(needs.short, 1);
    assert.equal(describeNeeds('stone_pickaxe', needs),
        'To craft stone_pickaxe (at a crafting table): 3 rock: you have 2 pyrotech_compat:rock_metamorphic, so get 1 more pyrotech:rock (any rock); 2 ladderMat: you have 4 stick (enough).');
});

test('the flint recipe counts too (any RotN craft way, matched by output and ingredients)', () => {
    const needs = craftNeeds(invBot([stack('flint', 0, 3), stack('stick', 0, 2)]), 'stone_pickaxe');
    assert.equal(needs.ready, true);
});

test('no rocks at all: "you have none", and the advice is any rock', () => {
    const needs = craftNeeds(invBot([stack('stick', 0, 2)]), 'stone_pickaxe');
    assert.equal(needs.ready, false);
    assert.match(describeNeeds('stone_pickaxe', needs), /3 rock: you have none, so get 3 pyrotech:rock \(any rock\)/);
});

test('an item with no RotN craft way gives null', () => {
    assert.equal(craftNeeds(invBot([]), 'pyrotech:rock:4'), null);
});

test('cobblestone still needs 4 rocks of one type (one RotN recipe per rock type)', () => {
    const needs = craftNeeds(invBot([stack('pyrotech:rock', 0, 3), stack('pyrotech:rock', 6, 2)]), 'cobblestone');
    assert.equal(needs.ready, false);
    assert.equal(describeNeeds('cobblestone', needs), 'To craft cobblestone: 4 pyrotech:rock:0: you have 3 pyrotech:rock:0, so get 1 more pyrotech:rock:0.');
    assert.equal(craftNeeds(invBot([stack('pyrotech:rock', 0, 4)]), 'cobblestone').ready, true);
});

// #151 review: the early-game messages, word for word.
test('crude axe: 1 rock and 2 sticks; with no rock the advice is any rock', () => {
    const needs = craftNeeds(invBot([stack('stick', 0, 2)]), 'pyrotech:crude_axe');
    assert.equal(describeNeeds('pyrotech:crude_axe', needs),
        'To craft pyrotech:crude_axe: 1 rock: you have none, so get 1 pyrotech:rock (any rock); 2 ladderMat: you have 2 stick (enough).');
    assert.equal(craftNeeds(invBot([stack('stick', 0, 2), stack('pyrotech_compat:rock_sedimentary', 2, 1)]), 'pyrotech:crude_axe').ready, true,
        'an Underground Biomes rock is a rock');
});

test('Crafting Tools: the crude axe, a rock and a stick', () => {
    const needs = craftNeeds(invBot([stack('pyrotech:crude_axe', 0, 1), stack('stick', 0, 1)]), 'contenttweaker:crafting_tools');
    assert.equal(describeNeeds('contenttweaker:crafting_tools', needs),
        'To craft contenttweaker:crafting_tools: 1 pyrotech:crude_axe: you have 1 pyrotech:crude_axe (enough); 1 rock: you have none, so get 1 pyrotech:rock (any rock); 1 ladderMat: you have 1 stick (enough).');
    const ready = craftNeeds(invBot([stack('pyrotech:crude_axe', 0, 1), stack('stick', 0, 1), stack('pyrotech_compat:rock_igneous', 3, 1)]), 'contenttweaker:crafting_tools');
    assert.equal(ready.ready, true);
});

test('crafting table: a plank and the Crafting Tools (no plank-only recipe)', () => {
    const needs = craftNeeds(invBot([stack('planks', 0, 1)]), 'crafting_table');
    assert.equal(describeNeeds('crafting_table', needs),
        'To craft crafting_table: 1 plankWood: you have 1 planks (enough); 1 contenttweaker:crafting_tools: you have none, so get 1 contenttweaker:crafting_tools.');
});

test('stone axe: at a crafting table, from 3 rocks (mixed is fine)', () => {
    const needs = craftNeeds(invBot([stack('pyrotech_compat:rock_igneous', 0, 2), stack('stick', 0, 2)]), 'stone_axe');
    assert.equal(describeNeeds('stone_axe', needs),
        'To craft stone_axe (at a crafting table): 3 rock: you have 2 pyrotech_compat:rock_igneous, so get 1 more pyrotech:rock (any rock); 2 ladderMat: you have 2 stick (enough).');
    assert.equal(craftNeeds(invBot([stack('pyrotech_compat:rock_igneous', 0, 2), stack('pyrotech:rock', 6, 1), stack('stick', 0, 2)]), 'stone_axe').ready, true);
});

test('!craftRecipe("stone_pickaxe", 1) without enough rocks says what to get, not a raw recipe dump', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [stack('pyrotech_compat:rock_metamorphic', 0, 2), stack('stick', 0, 4)];
    const bot = {
        ...invBot(items),
        registry: reg,
        output: '',
        entity: { position: new Vec3(0, 64, 0) },
        modes: { isOn: () => false },
        findBlocks: () => [],
        blockAt: () => null,
        recipesFor: () => [],
    };
    const agent = { bot, actions: { runAction: async (label, fn) => { await fn(); return { message: bot.output, interrupted: false }; } } };
    const { commandName, args } = parseCommandMessage('!craftRecipe("stone_pickaxe", 1)');
    await getCommand(commandName).perform(agent, ...args);
    assert.match(bot.output, /You do not have the resources to craft stone_pickaxe\. To craft stone_pickaxe \(at a crafting table\): 3 rock: you have 2 pyrotech_compat:rock_metamorphic, so get 1 more pyrotech:rock \(any rock\)/);
});

// #151 re-review: the advice is rotn-data's top-ranked choice, not the ore list's first entry,
// and a slot takes every stack the recipe slot lists (the crude axe's rock slot takes flint).
test('crude axe without sticks: the advice is stick (any ladderMat), not a Better With Mods shaft', () => {
    const needs = craftNeeds(invBot([stack('pyrotech:rock', 0, 1)]), 'pyrotech:crude_axe');
    assert.equal(describeNeeds('pyrotech:crude_axe', needs),
        'To craft pyrotech:crude_axe: 1 rock: you have 1 pyrotech:rock:0 (enough); 2 ladderMat: you have none, so get 2 stick (any ladderMat).');
});

test('crafting table without planks: the advice is planks (any plankWood), not skyroot', () => {
    const needs = craftNeeds(invBot([stack('contenttweaker:crafting_tools', 0, 1)]), 'crafting_table');
    assert.equal(describeNeeds('crafting_table', needs),
        'To craft crafting_table: 1 plankWood: you have none, so get 1 planks (any plankWood); 1 contenttweaker:crafting_tools: you have 1 contenttweaker:crafting_tools (enough).');
});

test('crude axe from flint and sticks is ready (the recipe slot lists flint)', () => {
    const needs = craftNeeds(invBot([stack('flint', 0, 1), stack('stick', 0, 2)]), 'pyrotech:crude_axe');
    assert.equal(needs.ready, true);
    assert.equal(needs.inputs[0].short, 0);
    assert.deepEqual(needs.inputs[0].kinds, [{ name: 'flint', have: 1 }]);
});

// #151 re-review: craftRecipe's messages must not throw (getItemCraftingRecipes gives null
// for an item without recipes; the raw-recipe text read [0][0] of it).
async function craftLog(items, name) {
    const bot = {
        ...invBot(items),
        registry: reg,
        output: '',
        entity: { position: new Vec3(0, 64, 0) },
        modes: { isOn: () => false },
        findBlocks: () => [],
        blockAt: () => null,
        recipesFor: () => [],
    };
    const agent = { bot, actions: { runAction: async (label, fn) => { await fn(); return { message: bot.output, interrupted: false }; } } };
    const { commandName, args } = parseCommandMessage(`!craftRecipe("${name}", 1)`);
    await getCommand(commandName).perform(agent, ...args);
    return bot.output;
}

test('!craftRecipe: items that fit a RotN recipe but no registry variant and no table: a message, not a throw', async (t) => {
    t.mock.method(console, 'log', () => {});
    const out = await craftLog([stack('pyrotech:rock', 0, 3), stack('stick', 0, 2)], 'stone_pickaxe');
    assert.match(out, /Crafting stone_pickaxe requires a crafting table\./, 'C1: it tries the canFill craft, which needs a table');
});

test('!craftRecipe: an item with no crafting recipe gives a message, not a TypeError', async (t) => {
    t.mock.method(console, 'log', () => {});
    const out = await craftLog([], 'bedrock');
    assert.match(out, /bedrock is either not an item, or it does not have a crafting recipe!/);
});

test('#151 nit: each input counts its own recipe slot (soaking_pot: string fits the twine slot, not the 1-stack slot beside it)', () => {
    const needs = craftNeeds(invBot([stack('string', 0, 5)]), 'pyrotech:soaking_pot');
    const one = needs.inputs.filter(i => i.count === 1 && !i.ore);
    assert.equal(one.length, 1);
    assert.deepEqual([one[0].kinds, one[0].short], [[], 1], 'string does not fill the 1-stack slot');
    const twine = needs.inputs.find(i => i.ore === 'twine');
    assert.deepEqual([twine.kinds, twine.short], [[{ name: 'string', have: 5 }], 0], 'it fills the twine slot');
});

// C1: crafting from canFill, for a mix of kinds bot.registry's capped variants leave out.
// A registry with the two modded rocks (their ids are made up; only the mapping matters).
const IGN = 5001, MET = 5002;
const modReg = { ...reg, itemsByName: { ...reg.itemsByName,
    'pyrotech_compat:rock_igneous': { id: IGN, name: 'pyrotech_compat:rock_igneous' },
    'pyrotech_compat:rock_metamorphic': { id: MET, name: 'pyrotech_compat:rock_metamorphic' } } };
const mixed = () => [stack('pyrotech_compat:rock_igneous', 0, 1), stack('pyrotech_compat:rock_metamorphic', 0, 2), stack('stick', 0, 2)];

test('C1: filledRecipe puts the stacks canFill assigned into the rotn-data recipe shape', () => {
    const fill = fillNow(invBot(mixed()), 'crafttweaker:stone_pickaxe');
    assert.equal(fill.ok, true);
    const v = filledRecipe(modReg, 'crafttweaker:stone_pickaxe', fill.assignment);
    const stick = reg.itemsByName.stick.id;
    const ids = v.inShape.map(row => row.map(c => c && `${c.id}:${c.metadata}`));
    assert.deepEqual(ids, [[`${MET}:0`, `${MET}:0`, `${IGN}:0`], [null, `${stick}:0`, null], [null, `${stick}:0`, null]]);
    assert.deepEqual(v.result, { id: reg.itemsByName.stone_pickaxe.id, metadata: 0, meta: 0, count: 1 });
    const { Recipe } = prismarineRecipe(modReg);
    assert.equal(new Recipe(v).requiresTable, true, 'a 3x3 shape: at the table');
    assert.throws(() => filledRecipe(reg, 'crafttweaker:stone_pickaxe', fill.assignment), /pyrotech_compat:rock_metamorphic is not in bot.registry/);
    assert.throws(() => filledRecipe(modReg, 'crafttweaker:stone_pickaxe', fill.assignment.slice(0, 2)), /no stack for slot 3/);
});

test('C1: !craftRecipe with mixed rocks and no registry variant crafts at the nearby table from the canFill stacks', async (t) => {
    t.mock.method(console, 'log', () => {});
    let items = mixed();
    const crafts = [];
    const tablePos = new Vec3(1, 64, 0);
    const bot = {
        inventory: { items: () => items, slots: [] },
        registry: modReg,
        output: '',
        entity: { position: new Vec3(0, 64, 0) },
        modes: { isOn: () => false },
        findBlocks: () => [tablePos],
        blockAt: (p) => ({ name: 'crafting_table', position: p }),
        recipesFor: () => [], // the capped variants have no such mix
        craft: (recipe, count, table) => {
            crafts.push({ recipe, count, table });
            items = [stack('stone_pickaxe', 0, 1)]; // the server took the rocks and sticks
            return Promise.resolve();
        },
    };
    const agent = { bot, actions: { runAction: async (label, fn) => { await fn(); return { message: bot.output, interrupted: false }; } } };
    const { commandName, args } = parseCommandMessage('!craftRecipe("stone_pickaxe", 2)');
    await getCommand(commandName).perform(agent, ...args);
    assert.equal(crafts.length, 1, 'one craft; then the items no longer fit');
    assert.equal(crafts[0].count, 1);
    assert.equal(crafts[0].table.name, 'crafting_table');
    assert.deepEqual(crafts[0].recipe.inShape[0].map(c => `${c.id}:${c.metadata}`), [`${MET}:0`, `${MET}:0`, `${IGN}:0`]);
    assert.match(bot.output, /Crafted 1 of 2 stone_pickaxe from mixed items; not enough for more\. You now have 1 stone_pickaxe\./);
});

test('C1: filledRecipe refuses an NBT result and a recipe that leaves items in the grid (net-forge rules)', () => {
    assert.throws(() => filledRecipe(modReg, 'betterwithmods:baiting_recipe', []), /has an NBT result/);
    assert.throws(() => filledRecipe(modReg, 'aether_legacy:poison_dart', []), /leaves items in the grid/);
});

test('C1: craftPausingAutoEat disables auto-eat for the craft, waits out an eat, and restores it', async () => {
    const { craftPausingAutoEat } = await import('./skills.js');
    const autoEat = { disabled: false, isEating: true, disable() { this.disabled = true; }, enable() { this.disabled = false; } };
    const seen = [];
    const bot = { autoEat, craft: () => { seen.push({ disabled: autoEat.disabled, eating: autoEat.isEating }); return Promise.resolve(); } };
    setTimeout(() => { autoEat.isEating = false; }, 150);
    await craftPausingAutoEat(bot, {}, 1, null);
    assert.deepEqual(seen, [{ disabled: true, eating: false }]);
    assert.equal(autoEat.disabled, false, 'on again after the craft');

    const failing = { autoEat, craft: () => Promise.reject(new Error('click rejected')) };
    await assert.rejects(craftPausingAutoEat(failing, {}, 1, null), /click rejected/);
    assert.equal(autoEat.disabled, false, 'on again after a failed craft');

    autoEat.disabled = true; // turned off by someone else: stays off
    await craftPausingAutoEat(bot, {}, 1, null);
    assert.equal(autoEat.disabled, true);
});
