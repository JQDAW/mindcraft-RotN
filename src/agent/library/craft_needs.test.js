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
import { craftNeeds, describeNeeds } from './craft_needs.js';

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
