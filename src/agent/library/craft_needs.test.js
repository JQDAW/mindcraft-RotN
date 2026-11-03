// Offline tests for skills-rotn C1's recipe check (no slot clicks): what the bot
// still needs by RotN's recipes (rotn-data howToGet craft ways), with #145 nit 1:
// equal ingredients take the same stack, so 3 rocks must be of one kind. A fake
// inventory on the 1.12.2 registry; no server, no LLM.
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

test('a mixed haul of rocks is refused: get 1 more of the kind the bot holds most of', () => {
    const bot = invBot([stack('pyrotech_compat:rock_metamorphic', 0, 2), stack('pyrotech_compat:rock_igneous', 7, 1), stack('stick', 0, 4)]);
    const needs = craftNeeds(bot, 'stone_pickaxe');
    assert.equal(needs.ready, false);
    assert.equal(needs.short, 1);
    assert.equal(needs.requiresTable, true);
    assert.equal(describeNeeds('stone_pickaxe', needs),
        'To craft stone_pickaxe (at a crafting table): 3 rock of one kind: you have 2 pyrotech_compat:rock_metamorphic, 1 pyrotech_compat:rock_igneous, so get 1 more pyrotech_compat:rock_metamorphic; 2 ladderMat of one kind: you have 4 stick (enough).');
});

test('3 rocks of one kind are enough, across that rock\'s metas (an ore-wide member)', () => {
    const bot = invBot([stack('pyrotech_compat:rock_metamorphic', 0, 2), stack('pyrotech_compat:rock_metamorphic', 6, 1), stack('stick', 0, 2)]);
    const needs = craftNeeds(bot, 'stone_pickaxe');
    assert.equal(needs.ready, true);
    assert.deepEqual(needs.inputs.map(i => i.short), [0, 0]);
});

test('the flint recipe counts too (any RotN craft way, matched by output and ingredients)', () => {
    const bot = invBot([stack('flint', 0, 3), stack('stick', 0, 2)]);
    const needs = craftNeeds(bot, 'stone_pickaxe');
    assert.equal(needs.ready, true);
    assert.ok(needs.inputs[0].kinds.some(k => k.name === 'flint'));
});

test('no rocks at all: "you have none", and the likeliest rock to get', () => {
    const needs = craftNeeds(invBot([stack('stick', 0, 2)]), 'stone_pickaxe');
    assert.equal(needs.ready, false);
    assert.match(describeNeeds('stone_pickaxe', needs), /3 rock of one kind: you have none, so get 3 more pyrotech:rock:0/);
});

test('an item with no RotN craft way gives null', () => {
    assert.equal(craftNeeds(invBot([]), 'pyrotech:rock:4'), null);
});

test('!craftRecipe("stone_pickaxe", 1) with a mixed haul says which rock to get, not a raw recipe dump', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [stack('pyrotech_compat:rock_metamorphic', 0, 2), stack('pyrotech_compat:rock_igneous', 7, 1), stack('stick', 0, 4)];
    const bot = {
        ...invBot(items),
        registry: reg,
        output: '',
        entity: { position: new Vec3(0, 64, 0) },
        modes: { isOn: () => false },
        findBlocks: () => [],
        blockAt: () => null,
        recipesFor: () => [], // bot.recipesFor refuses the mixed haul (equal slots, one stack)
    };
    const agent = { bot, actions: { runAction: async (label, fn) => { await fn(); return { message: bot.output, interrupted: false }; } } };
    const { commandName, args } = parseCommandMessage('!craftRecipe("stone_pickaxe", 1)');
    await getCommand(commandName).perform(agent, ...args);
    assert.match(bot.output, /You do not have the resources to craft stone_pickaxe\. To craft stone_pickaxe \(at a crafting table\): 3 rock of one kind: .* so get 1 more pyrotech_compat:rock_metamorphic/);
});
