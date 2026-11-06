// Offline tests for skills-rotn B2: collectBlock follows RotN's world rules
// from rotn-data (howToGet): rocks come from rock piles by hand and from stone
// mined with a pickaxe below Sturdy; "cobblestone" no longer digs stone. The
// #141 review: count the real inventory gain, keep the rule's tool equipped, and
// treat only rock variants as rocks. A fake bot on the 1.12.2 registry (plus the
// modded rock the server's registry has) simulates the drops; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { worldSources, itemVariants, toolAllows, allowedTool, describeTool } from './rotn_sources.js';
import { countItem } from './rotn_names.js';
import * as skills from './skills.js';

const vanilla = minecraftData('1.12.2');
// The modded rocks the server's registry has (net-forge's registry extension); ids are made up.
const MODDED = ['pyrotech:rock', 'pyrotech_compat:rock_igneous', 'pyrotech_compat:rock_metamorphic', 'pyrotech_compat:rock_sedimentary'];
const reg = { ...vanilla, items: { ...vanilla.items }, itemsByName: { ...vanilla.itemsByName }, blocks: { ...vanilla.blocks }, blocksByName: { ...vanilla.blocksByName } };
MODDED.forEach((name, i) => {
    const item = { id: 5000 + i, name, stackSize: 64 };
    const blk = { id: 4242 + i, name };
    reg.items[item.id] = item; reg.itemsByName[name] = item;
    reg.blocks[blk.id] = blk; reg.blocksByName[name] = blk;
});
__setRegistryForTest(reg);

const at = (x, y = 64, z = 0) => new Vec3(x, y, z);
const block = (name, metadata, position) => ({
    name, metadata, type: reg.blocksByName[name].id, position,
    canHarvest: () => true, boundingBox: 'block', transparent: false, shapes: [[0, 0, 0, 1, 1, 1]],
});
const tool = (name) => ({ name, metadata: 0, count: 1, type: reg.itemsByName[name].id });
const PICKAXE_LEVEL = { stone_pickaxe: 0, iron_pickaxe: 1 };

// What a break drops in RotN, by block and held tool.
function drops(b, held) {
    const level = held ? PICKAXE_LEVEL[held.name] : undefined;
    if (b.name === 'stone') {
        if (level === 0) return [['pyrotech:rock', 0, 4]];
        if (level >= 1) return [['cobblestone', 0, 1]];
        return [];
    }
    if (MODDED.includes(b.name)) return [[b.name, b.metadata, 1]]; // a pile drops its own rock, same meta
    return []; // leaves: an unlucky roll, no stick
}

function fakeBot({ blocks = [], items = [], dropsOf = drops } = {}) {
    const calls = { equip: [], collected: [], dug: [] };
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
        inventory: { items: () => items.filter(i => i.count > 0), slots: [] },
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            return remaining.filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance)
                .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
                .slice(0, count).map(b => b.position);
        },
        blockAt: (pos) => remaining.find(b => b.position.equals(pos)) ?? null,
        equip: (item) => { calls.equip.push(item.name); bot.heldItem = item; return Promise.resolve(); },
        // Like mineflayer-tool: the fastest pickaxe.
        tool: {
            equipForBlock: () => {
                const best = items.filter(i => i.name in PICKAXE_LEVEL).sort((a, b) => PICKAXE_LEVEL[b.name] - PICKAXE_LEVEL[a.name])[0];
                if (best) bot.heldItem = best;
                return Promise.resolve();
            },
        },
        collectBlock: { collect: (b) => { calls.collected.push(b); breakBlock(b); return Promise.resolve(); } },
        dig: (b) => { calls.dug.push(b); breakBlock(b); return Promise.resolve(); },
        pathfinder: { setMovements() {}, stop() {}, setGoal() {}, isMoving: () => false, goto: () => Promise.resolve(), getPathTo: () => ({ status: 'success', path: [] }) },
        lookAt: () => Promise.resolve(),
        nearestEntity: () => null,
    };
    function breakBlock(b) {
        remaining.splice(remaining.indexOf(b), 1);
        for (const [name, metadata, count] of dropsOf(b, bot.heldItem)) {
            const stack = items.find(i => i.name === name && i.metadata === metadata);
            if (stack) stack.count += count;
            else items.push({ name, metadata, count, type: reg.itemsByName[name].id });
        }
    }
    return bot;
}

test('rotn-data world rules for rocks: piles by hand, stone with a pickaxe below Sturdy; only rock variants', () => {
    const sources = worldSources('pyrotech:rock');
    const pile = sources.find(s => s.blocks.some(b => b.startsWith('pyrotech:rock')));
    const stone = sources.find(s => s.blocks.includes('stone:0'));
    assert.ok(pile && pile.tool === null, 'rock piles by hand');
    assert.ok(stone && stone.tool?.type === 'pickaxe' && stone.tool.maxLevel === 0, 'stone: pickaxe below Sturdy');
    assert.equal(describeTool(stone.tool), 'a pickaxe of level 0 or lower');
    // The rock variants come from rotn-data (the "rock" ore dictionary), not from this code.
    const rocks = itemVariants('pyrotech:rock');
    assert.deepEqual(rocks.slice(0, 3), ['pyrotech:rock:0', 'pyrotech:rock:6', 'pyrotech:rock:8']);
    for (const ub of ['pyrotech_compat:rock_igneous', 'pyrotech_compat:rock_metamorphic', 'pyrotech_compat:rock_sedimentary'])
        assert.ok(rocks.includes(ub), `${ub}: any meta is a rock (rotn-data #142, the rock ore dictionary)`);
    assert.ok(!rocks.includes('pyrotech:rock:4') && !rocks.includes('pyrotech:rock'), 'a dirt clump is not a rock');
    assert.deepEqual(itemVariants('pyrotech:rock:4'), ['pyrotech:rock:4']);
    assert.deepEqual(itemVariants('cobblestone'), ['cobblestone']);
    assert.equal(toolAllows(fakeBot({ items: [tool('stone_pickaxe')] }), stone.tool), true);
    assert.equal(toolAllows(fakeBot({ items: [tool('iron_pickaxe')] }), stone.tool), false, 'iron is Sturdy');
    assert.equal(allowedTool(fakeBot({ items: [tool('iron_pickaxe'), tool('stone_pickaxe')] }), stone.tool).name, 'stone_pickaxe');
});

test('nit 4: only "break" rules are collect sources (no item-on-block rules, no "a undefined")', () => {
    for (const name of ['planks', 'planks:0', 'stick', 'pyrotech:rock']) {
        for (const s of worldSources(name)) assert.doesNotMatch(describeTool(s.tool), /undefined/, name);
    }
});

test('8 rocks with a stone pickaxe: 2 stone blocks, counted from the inventory', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [tool('stone_pickaxe')];
    const bot = fakeBot({ items, blocks: [block('stone', 0, at(2)), block('stone', 0, at(3)), block('stone', 0, at(4))] });
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 8), true);
    assert.equal(bot.calls.dug.length, 2, 'two stone blocks, not eight');
    assert.equal(countItem(bot, 'pyrotech:rock'), 8);
    assert.match(bot.output, /Collected 8 pyrotech:rock \(8 pyrotech:rock:0\)\./);
});

test('review 2: with a stone and an iron pickaxe, the stone one is used (iron would give cobblestone)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [tool('iron_pickaxe'), tool('stone_pickaxe')];
    const bot = fakeBot({ items, blocks: [block('stone', 0, at(2)), block('stone', 0, at(3))] });
    await skills.collectBlock(bot, 'pyrotech:rock', 8);
    assert.deepEqual([...new Set(bot.calls.equip)], ['stone_pickaxe']);
    assert.equal(countItem(bot, 'pyrotech:rock'), 8);
    assert.equal(countItem(bot, 'cobblestone'), 0);
    assert.match(bot.output, /Collected 8 pyrotech:rock \(8 pyrotech:rock:0\)\./);
});

// Was leaves for sticks; leaves never drop sticks on this pack (rotn-data Request 13), so the
// rule goes. The same check with piles that drop nothing (round 4 B: leaves are fall_safety.test.js).
test('review 1: the count is the real gain: piles that drop nothing give "Collected 0 pyrotech:rock"', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot({ blocks: [block('pyrotech:rock', 0, at(1)), block('pyrotech:rock', 0, at(2))], dropsOf: () => [] });
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 2), false);
    assert.match(bot.output, /Broke pyrotech:rock but got no pyrotech:rock\./);
    assert.match(bot.output, /Collected 0 pyrotech:rock\./);
});

test('review 3: a bare "pyrotech:rock" skips a nearer dirt clump (meta 4) and takes a rock pile', async (t) => {
    t.mock.method(console, 'log', () => {});
    const clump = block('pyrotech:rock', 4, at(1));
    const pile = block('pyrotech:rock', 0, at(5));
    const bot = fakeBot({ blocks: [clump, pile] });
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 1), true);
    const taken = [...bot.calls.collected, ...bot.calls.dug];
    assert.deepEqual(taken.map(b => b.metadata), [0]);
    assert.equal(countItem(bot, 'pyrotech:rock:4'), 0, 'no dirt clump picked up');
    assert.match(bot.output, /Collected 1 pyrotech:rock \(1 pyrotech:rock:0\)\./);
});

test('without a pickaxe, stone is not a rock source, and the bot says what it needs', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot({ blocks: [block('stone', 0, at(2))] });
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 4), false);
    assert.deepEqual(bot.calls.dug, []);
    assert.match(bot.output, /No pyrotech:rock nearby to collect\./);
    assert.match(bot.output, /Mine stone with a pickaxe below Sturdy.*That needs a pickaxe of level 0 or lower\./);
});

test('"cobblestone" no longer digs stone (that gives rocks below Sturdy)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot({ items: [tool('stone_pickaxe')], blocks: [block('stone', 0, at(2))] });
    assert.equal(await skills.collectBlock(bot, 'cobblestone', 1), false);
    assert.deepEqual([...bot.calls.collected, ...bot.calls.dug], []);
    assert.match(bot.output, /No cobblestone nearby to collect\./);
});

// Lead, before the first G3 batch: near the G3 spawn the only plain pyrotech:rock piles are dirt
// clumps; the rocks there are Underground Biomes piles (S1-A survey), which the crude axe, Crafting
// Tools and stone tools accept (the rock ore dictionary, rotn-data #142).
test('G3 spawn: a bare "pyrotech:rock" collects Underground Biomes rock piles and skips the dirt clump', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot({
        blocks: [
            block('pyrotech:rock', 4, at(1)), // dirt clump, nearest
            block('pyrotech_compat:rock_metamorphic', 0, at(3)),
            block('pyrotech_compat:rock_igneous', 7, at(4)),
            block('pyrotech_compat:rock_metamorphic', 6, at(6)),
        ],
    });
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 3), true);
    const taken = [...bot.calls.collected, ...bot.calls.dug].map(b => `${b.name}:${b.metadata}`);
    assert.deepEqual(taken, ['pyrotech_compat:rock_metamorphic:0', 'pyrotech_compat:rock_igneous:7', 'pyrotech_compat:rock_metamorphic:6']);
    assert.equal(countItem(bot, 'pyrotech:rock:4'), 0);
    assert.match(bot.output, /Collected 3 pyrotech:rock \(1 pyrotech_compat:rock_metamorphic:0, 1 pyrotech_compat:rock_igneous:7, 1 pyrotech_compat:rock_metamorphic:6\)\./);
});

test('a pickaxe that breaks mid-run: no throw; stone is skipped and hand sources continue', async (t) => {
    t.mock.method(console, 'log', () => {});
    const pickaxe = tool('stone_pickaxe');
    const items = [pickaxe];
    const bot = fakeBot({
        items,
        blocks: [block('stone', 0, at(2)), block('stone', 0, at(3)), block('pyrotech_compat:rock_igneous', 0, at(9))],
    });
    const dig = bot.dig;
    bot.dig = async (b) => {
        await dig(b);
        if (b.name === 'stone') { pickaxe.count = 0; bot.heldItem = null; } // it breaks on the first stone
    };
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 8), true);
    assert.match(bot.output, /No longer have a pickaxe of level 0 or lower to break stone; skipping those blocks\./);
    assert.deepEqual(bot.calls.dug.map(b => b.name), ['stone', 'pyrotech_compat:rock_igneous']);
    assert.equal(countItem(bot, 'pyrotech:rock') + countItem(bot, 'pyrotech_compat:rock_igneous'), 5);
    assert.match(bot.output, /Collected 5 pyrotech:rock \(4 pyrotech:rock:0, 1 pyrotech_compat:rock_igneous:0\)\./);
});

// #145 review nits.
test('nit 2: the log names the items really gained, not only the name asked for', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot({ blocks: [block('pyrotech_compat:rock_igneous', 7, at(2)), block('pyrotech_compat:rock_igneous', 7, at(3))] });
    await skills.collectBlock(bot, 'pyrotech:rock', 2);
    assert.match(bot.output, /Collected 2 pyrotech:rock \(2 pyrotech_compat:rock_igneous:7\)\./);
});

test('nit 3: an explicit "pyrotech:rock:0" takes only stone-rock piles, not the Underground Biomes ones', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot({ blocks: [block('pyrotech_compat:rock_metamorphic', 0, at(1)), block('pyrotech:rock', 0, at(6))] });
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock:0', 1), true);
    assert.deepEqual([...bot.calls.collected, ...bot.calls.dug].map(b => `${b.name}:${b.metadata}`), ['pyrotech:rock:0']);
    assert.match(bot.output, /Collected 1 pyrotech:rock:0\./);
});

test('nit 4: finding the tool gone does not use up an attempt', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [tool('stone_pickaxe')];
    const bot = fakeBot({ items, blocks: [block('stone', 0, at(2)), block('pyrotech:rock', 0, at(5))] });
    // The pickaxe is there when the sources are chosen, gone (it broke earlier) by the first equip.
    const listItems = bot.inventory.items;
    let calls = 0;
    bot.inventory.items = () => (calls++ === 0 ? listItems() : listItems().filter(i => i.name !== 'stone_pickaxe'));
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 1), true, 'the one attempt goes to the rock pile');
    assert.match(bot.output, /No longer have a pickaxe of level 0 or lower to break stone; skipping those blocks\./);
    assert.match(bot.output, /Collected 1 pyrotech:rock \(1 pyrotech:rock:0\)\./);
});
