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

// world (soak 16 R): the blocks around the listed ones (for the way-out check); null: unloaded, as before.
function fakeBot({ blocks = [], items = [], dropsOf = drops, world = null, palettePass = false } = {}) {
    const calls = { equip: [], collected: [], dug: [], walks: [] };
    const remaining = [...blocks];
    const bot = {
        calls,
        registry: reg,
        version: '1.12.2',
        output: '',
        interrupt_code: false,
        game: { gameMode: 'survival', dimension: 'overworld' },
        entity: { position: at(0), height: 1.8 },
        entities: {},
        heldItem: null,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => items.filter(i => i.count > 0), slots: [] },
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            // #630 review 1: as mineflayer, the matcher first runs on each block type of the "palette" with no position
            // (a section is skipped when none matches), then on each positioned block.
            if (typeof matching === 'function' && palettePass) {
                const types = [...new Map(remaining.map(b => [b.name, { name: b.name, type: b.type, metadata: b.metadata, position: null }])).values()];
                if (!types.some(b => matching(b))) return [];
            }
            return remaining.filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance)
                .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
                .slice(0, count).map(b => b.position);
        },
        blockAt: (pos) => remaining.find(b => b.position.equals(pos)) ?? (world ? world(pos.floored ? pos.floored() : pos) : null),
        // #630 re-review 1: the state-id view of the same world (air 0, unloaded undefined), as prismarine-world's.
        world: world ? { getBlockStateId: (pos) => { const b = bot.blockAt(pos); return b == null ? undefined : b.name === 'air' ? 0 : (b.type || 1); } } : undefined,
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
        // A walk arrives: the bot stands at the goal (#366 review 1: collectBlock digs only what is in
        // reach after the walk).
        pathfinder: { setMovements() {}, stop() {}, setGoal() {}, isMoving: () => false, getPathTo: () => ({ status: 'success', path: [] }),
            goto: (goal) => {
                calls.walks.push(goal);
                if (Number.isFinite(goal?.x)) bot.entity.position = new Vec3(Math.floor(goal.x) + 0.5, Math.floor(goal.y), Math.floor(goal.z) + 0.5);
                return Promise.resolve();
            } },
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
    assert.match(bot.output, /Broke pyrotech:rock: no pyrotech:rock yet\./);
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
        // Soak 16 (R): loose rocks within 48 come before any stone: this one is beyond, so the stone is tried first.
        blocks: [block('stone', 0, at(2)), block('stone', 0, at(3)), block('pyrotech_compat:rock_igneous', 0, at(55))],
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
    const bot = fakeBot({ items, blocks: [block('stone', 0, at(2)), block('pyrotech:rock', 0, at(55))] }); // soak 16 (R): the pile beyond 48
    // The pickaxe is there when the sources are chosen, gone (it broke earlier) by the first equip.
    const listItems = bot.inventory.items;
    let calls = 0;
    bot.inventory.items = () => (calls++ === 0 ? listItems() : listItems().filter(i => i.name !== 'stone_pickaxe'));
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 1), true, 'the one attempt goes to the rock pile');
    assert.match(bot.output, /No longer have a pickaxe of level 0 or lower to break stone; skipping those blocks\./);
    assert.match(bot.output, /Collected 1 pyrotech:rock \(1 pyrotech:rock:0\)\./);
});

test('#311 review: a by-hand rule that always yields (rock piles) gets no free attempts: a pile that gives nothing counts', async (t) => {
    t.mock.method(console, 'log', () => {});
    // A full inventory or a missed pickup: every pile breaks and gives nothing. Only rules whose yield
    // can be 0 (rotn-data countRange.min 0: a dead bush) may break without using an attempt.
    const piles = [1, 2, 3, 4, 5].map(x => block('pyrotech:rock', 0, at(x)));
    const bot = fakeBot({ blocks: piles, dropsOf: () => [] });
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 2), false);
    assert.equal(bot.calls.dug.length + bot.calls.collected.length, 2, 'two attempts, not every pile in range');
});

// #366 review 2: a break whose walk throws the pathfinder's Timeout or NoPath (bot.collectBlock's own
// walk) gives that block up for the collect and for COLLECT_LIMITS.unreachableMs, and uses no attempt.
test('#366 review 2: a block whose walk throws NoPath or Timeout uses no attempt and is not chosen again', async (t) => {
    t.mock.method(console, 'log', () => {});
    const sand = [2, 3, 4, 5].map(x => block('sand', 0, at(x)));
    const bot = fakeBot({ blocks: sand, dropsOf: (b) => (b.name === 'sand' ? [['sand', 0, 1]] : []) });
    const thrown = { 2: 'NoPath', 3: 'Timeout' };
    const collect = bot.collectBlock.collect;
    bot.collectBlock.collect = (b) => {
        const name = thrown[b.position.x];
        if (name) { bot.calls.collected.push(b); return Promise.reject(Object.assign(new Error("no way there"), { name })); }
        return collect(b);
    };
    assert.equal(await skills.collectBlock(bot, 'sand', 2), true, bot.output);
    assert.deepEqual(bot.calls.collected.map(b => b.position.x), [2, 3, 4, 5], 'the two with no path, then two more');
    assert.match(bot.output, /Collected 2 sand\b/);
    assert.equal(skills.COLLECT_LIMITS.unreachableTargets, 3);
    // The next collect does not walk to them again (remembered for unreachableMs).
    bot.output = '';
    await skills.collectBlock(bot, 'sand', 1);
    assert.deepEqual(bot.calls.collected.map(b => b.position.x), [2, 3, 4, 5], 'no new try at 2 or 3');
    assert.match(bot.output, /No sand nearby to collect\./);
});

// #416 review 2: the death-spot filter (CX23 soak) must not keep the bot from picking up the crafting
// table it placed for a craft (pickUpTable collects it): a crafting table is exempt.
test('#416 review 2: a crafting table near a recent death spot is still picked up; other targets there are left (said once, also on a partial collect)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const now = Date.now();
    const own = (b) => [[b.name, b.metadata, 1]];
    const table = fakeBot({ blocks: [block('crafting_table', 0, at(2))], dropsOf: own });
    table.rotnDeathSpots = () => [{ at: now - 60_000, pos: at(3), dimension: 'overworld' }];
    assert.equal(await skills.collectBlock(table, 'crafting_table', 1), true, table.output);
    assert.equal(countItem(table, 'crafting_table'), 1);
    assert.doesNotMatch(table.output, /left alone/);
    // Two rock piles, one 2 blocks from a recent death spot: the far one only; the line once.
    const piles = fakeBot({ blocks: [block('pyrotech:rock', 0, at(2)), block('pyrotech:rock', 0, at(40))] });
    piles.rotnDeathSpots = () => [{ at: now - 60_000, pos: at(3), dimension: 'overworld' }];
    assert.equal(await skills.collectBlock(piles, 'pyrotech:rock', 2), true, piles.output);
    assert.deepEqual(piles.calls.dug.map(b => b.position.x), [40]);
    assert.equal((piles.output.match(/Some were left alone: within 24 blocks of where you died recently/g) ?? []).length, 1, piles.output);
});


// Soak 16 (R, the lead): the rock collect stays out of holes. Soak 15: the nearest stone in 3-D, under the bot, block
// after block, 9 down, while loose rocks lay farther off. Now: loose rocks within 48 first; then stone open to the
// air that leaves a walkable way out once broken; a stone with no way out is skipped and said.
const ground = (pos) => {
    const name = pos.y <= 63 ? 'stone' : 'air';
    return { name, metadata: 0, type: reg.blocksByName[name].id, position: pos, boundingBox: name === 'air' ? 'empty' : 'block', shapes: name === 'air' ? [] : [[0, 0, 0, 1, 1, 1]], transparent: name === 'air' };
};
test('soak 16 (R): loose rocks within 48 come before nearer stone; then stone open to the air, never the buried one under the bot', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [tool('stone_pickaxe')];
    const buried = block('stone', 0, at(0, 60)), surface = block('stone', 0, at(3, 63)), loose = block('pyrotech_compat:rock_igneous', 0, at(40));
    const bot = fakeBot({ items, blocks: [buried, surface, loose], world: ground });
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 2), true);
    const taken = [...bot.calls.collected, ...bot.calls.dug];
    assert.equal(taken[0], loose, 'the loose rock at 40 first, not the stone 3 away');
    assert.equal(taken[1], surface, 'then the stone open to the air');
    assert.ok(!taken.includes(buried), 'never the buried stone under the bot');
});

test('soak 16 (R): a stone whose break leaves no walkable way out (the bottom of a shaft) is skipped and said; a loose rock beyond 48 is taken instead', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [tool('stone_pickaxe')];
    // A 1-wide shaft from the surface down to the stone at 0, 59, 0: open to the sky, but no room to walk out once in it.
    const shaft = (pos) => (pos.x === 0 && pos.z === 0 && pos.y >= 60 && pos.y <= 63 ? { name: 'air', metadata: 0, type: 0, position: pos, boundingBox: 'empty', shapes: [], transparent: true } : ground(pos));
    const deep = block('stone', 0, at(0, 59)), far = block('pyrotech:rock', 0, at(55));
    const bot = fakeBot({ items, blocks: [deep, far], world: shaft });
    bot.entity.position = new Vec3(1.5, 64, 0.5);
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 1), true);
    assert.ok(![...bot.calls.collected, ...bot.calls.dug].includes(deep));
    assert.match(bot.output, /Skipped 1 block to mine \(stone at 0, 59, 0\): breaking it would leave no walkable way out\./);
    assert.equal(skills.COLLECT_LIMITS.mineHandRadius, 48);
});

// #630 review 1: with mineflayer's palette pre-pass (the matcher on position-less blocks first), exposed stone is found.
test('#630 review 1: findBlocks\' palette pass (no position) does not hide exposed stone', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [tool('stone_pickaxe')];
    // A buried stone nearer than the exposed one: with the palette pass hiding exposed stone, the buried one was tried
    // (and skipped as "no way out"), which this checks is not said.
    const surface = block('stone', 0, at(3, 63)), buried = block('stone', 0, at(0, 61));
    const bot = fakeBot({ items, blocks: [buried, surface], world: ground, palettePass: true });
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 1), true, bot.output);
    assert.deepEqual([...bot.calls.collected, ...bot.calls.dug], [surface]);
    assert.doesNotMatch(bot.output, /Skipped/);
});

// #630 re-review 1: the exposure check uses the state-id fast path; bare stone 40 blocks away on dirt over stone is found
// past 1,500 buried stones nearer (the old 16,384 cap missed stone 2+ sections away); a search that hits the cap says
// "capped", not "none". The time is measured (the old check took 1.7-3 s of CPU per pick).
const dirtOverStone = (pos) => {
    const name = pos.y <= 59 ? 'stone' : pos.y <= 63 ? 'dirt' : 'air';
    return { name, metadata: 0, type: reg.blocksByName[name].id, position: pos, boundingBox: name === 'air' ? 'empty' : 'block', shapes: name === 'air' ? [] : [[0, 0, 0, 1, 1, 1]], transparent: name === 'air' };
};
const buriedField = () => {
    const out = [];
    for (let x = -10; x <= 10 && out.length < 1500; x++) for (let z = -10; z <= 10 && out.length < 1500; z++) for (let y = 55; y <= 59 && out.length < 1500; y++) out.push(block('stone', 0, at(x, y, z)));
    return out;
};
test('#630 re-review 1: bare stone 40 blocks away on dirt over stone is found past 1,500 buried stones (state ids), and fast', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [tool('stone_pickaxe')];
    const boulder = block('stone', 0, at(40, 64));
    const bot = fakeBot({ items, blocks: [...buriedField(), boulder], world: dirtOverStone, palettePass: true });
    let reads = 0;
    const sid = bot.world.getBlockStateId;
    bot.world.getBlockStateId = (p) => { reads++; return sid(p); };
    const t0 = Date.now();
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 1), true, bot.output);
    const ms = Date.now() - t0;
    assert.deepEqual([...bot.calls.collected, ...bot.calls.dug], [boulder]);
    assert.ok(reads > 0, 'the state-id path ran');
    assert.ok(ms < 5000, `${ms} ms`);
    assert.equal(skills.COLLECT_LIMITS.exposeChecks, 262_144);
});

test('#630 re-review 1: a stone search that hits the exposure cap ends "capped", not "none"', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [tool('stone_pickaxe')];
    const boulder = block('stone', 0, at(40, 64));
    const bot = fakeBot({ items, blocks: [...buriedField(), boulder], world: dirtOverStone, palettePass: true });
    assert.equal(await skills.collectBlock(bot, 'pyrotech:rock', 1, null, 64, { ...skills.COLLECT_LIMITS, exposeChecks: 100 }), false);
    assert.equal(bot.rotnCollectEnd.reason, 'capped');
});
