// Offline tests for skills-rotn B2: collectBlock follows RotN's world rules
// from rotn-data (howToGet): rocks come from rock piles by hand and from stone
// mined with a pickaxe below Sturdy (4 per block); "cobblestone" no longer digs
// stone. Fake bot on the 1.12.2 registry; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { worldSources, toolAllows, describeTool } from './rotn_sources.js';
import * as skills from './skills.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);

const at = (x, y = 64, z = 0) => new Vec3(x, y, z);
const block = (name, metadata, position, type = reg.blocksByName[name]?.id ?? 4000) =>
    ({ name, metadata, type, position, canHarvest: () => true, boundingBox: 'block', transparent: false, shapes: [[0, 0, 0, 1, 1, 1]] });
const stack = (name, count) => ({ name, metadata: 0, count, type: reg.itemsByName[name]?.id ?? 4001 });

function fakeBot({ blocks = [], items = [] } = {}) {
    const calls = { collect: [], dig: [] };
    const remaining = [...blocks];
    const bot = {
        calls,
        registry: reg,
        version: '1.12.2',
        output: '',
        interrupt_code: false,
        game: { gameMode: 'survival' },
        entity: { position: at(0), height: 1.8 },
        entities: {},
        heldItem: null,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => items, slots: [null, ...items] },
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            return remaining.filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance)
                .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
                .slice(0, count).map(b => b.position);
        },
        blockAt: (pos) => remaining.find(b => b.position.equals(pos)) ?? null,
        tool: { equipForBlock: () => Promise.resolve() },
        collectBlock: { collect: (b) => { calls.collect.push(b); remaining.splice(remaining.indexOf(b), 1); return Promise.resolve(); } },
        dig: (b) => { calls.dig.push(b); remaining.splice(remaining.indexOf(b), 1); return Promise.resolve(); },
        pathfinder: { setMovements() {}, stop() {}, setGoal() {}, isMoving: () => false, goto: () => Promise.resolve(), getPathTo: () => ({ status: 'success', path: [] }) },
        lookAt: () => Promise.resolve(),
        nearestEntity: () => null, // no dropped items to pick up in the fake world
    };
    return bot;
}

test('rotn-data world rules for rocks: piles by hand (1), stone with a pickaxe below Sturdy (4)', () => {
    const sources = worldSources('pyrotech:rock');
    const pile = sources.find(s => s.blocks.some(b => b.startsWith('pyrotech:rock')));
    const stone = sources.find(s => s.blocks.includes('stone:0'));
    assert.ok(pile && pile.tool === null && pile.count === 1, 'rock piles by hand, 1 rock');
    assert.ok(stone && stone.tool?.type === 'pickaxe' && stone.tool.maxLevel === 0 && stone.count === 4, 'stone: pickaxe level 0, 4 rocks');
    assert.equal(describeTool(stone.tool), 'a pickaxe of level 0 or lower');
    assert.equal(toolAllows(fakeBot({ items: [stack('stone_pickaxe', 1)] }), stone.tool), true);
    assert.equal(toolAllows(fakeBot({ items: [stack('iron_pickaxe', 1)] }), stone.tool), false, 'iron is Sturdy: stone would drop cobblestone');
    assert.equal(toolAllows(fakeBot(), stone.tool), false);
});

test('!collectBlocks("pyrotech:rock", 8) with a stone pickaxe mines 2 stone blocks for 8 rocks', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot({
        items: [stack('stone_pickaxe', 1)],
        blocks: [block('stone', 0, at(2)), block('stone', 0, at(3)), block('stone', 0, at(4)), block('dirt', 0, at(1))],
    });
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 8), true);
    assert.equal(bot.calls.collect.length, 2, 'two stone blocks, not eight');
    assert.ok(bot.calls.collect.every(b => b.name === 'stone'));
    assert.match(bot.output, /Collected 8 pyrotech:rock\./);
});

test('without a pickaxe, stone is not a rock source, and the bot says what it needs', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot({ blocks: [block('stone', 0, at(2))] });
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 4), false);
    assert.deepEqual(bot.calls.collect, []);
    assert.match(bot.output, /No pyrotech:rock nearby to collect\./);
    assert.match(bot.output, /Mine stone with a pickaxe below Sturdy.*That needs a pickaxe of level 0 or lower\./);
});

test('"cobblestone" no longer digs stone (that gives rocks below Sturdy)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot({ items: [stack('stone_pickaxe', 1)], blocks: [block('stone', 0, at(2))] });
    assert.equal(await skills.collectBlock(bot, 'cobblestone', 1), false);
    assert.deepEqual(bot.calls.collect, []);
    assert.match(bot.output, /No cobblestone nearby to collect\./);
});

test('rock piles are picked up by hand, 1 rock each', async (t) => {
    t.mock.method(console, 'log', () => {});
    const pileType = 4242;
    const bot = fakeBot({ blocks: [block('pyrotech:rock', 0, at(2), pileType), block('pyrotech:rock', 0, at(5), pileType)] });
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 2), true);
    const taken = [...bot.calls.collect, ...bot.calls.dig];
    assert.equal(taken.length, 2);
    assert.ok(taken.every(b => b.name === 'pyrotech:rock'));
    assert.match(bot.output, /Collected 2 pyrotech:rock\./);
});
