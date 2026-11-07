// Offline tests for collecting sticks before the first crude axe (G3 round 8 batch A).
// Round 8 A failed at the agenda's sticks step: the bot spawned on a canopy, its rock run took it
// to spruces, and two felled spruces gave 32 logs and 0 sticks. A dead bush stood next to it, but
// !collectBlocks("stick", 3) went for a tree; broken directly, the bushes gave a stick (vanilla 1.12:
// 0-2 each). Round 7 felled dark oaks and got 4 sticks; round 5 A rerun: 3 spruces, 25 logs, 1 stick.
// So: dead bushes (by hand) first, nearest first; then trees, but not a species that gave 0 sticks.
// A fake world on the 1.12.2 registry (dirt below y 64, Dynamic Trees on rooty dirt); no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { worldSources } from './rotn_sources.js';
import { FALLING_TREE } from './felling.js';
import * as skills from './skills.js';

const vanilla = minecraftData('1.12.2');
const reg = { ...vanilla, blocks: { ...vanilla.blocks }, blocksByName: { ...vanilla.blocksByName } };
const MODDED = {
    'dynamictrees:sprucebranch': 4300, 'dynamictrees:leaves0': 4301, 'dynamictrees:rootydirt': 4302,
    'dynamictrees:darkoakbranch': 4303,
};
for (const [name, id] of Object.entries(MODDED)) { reg.blocks[id] = { id, name }; reg.blocksByName[name] = reg.blocks[id]; }
__setRegistryForTest(reg);

const T = { timeout: 30_000 };
const FAST_DROPS = { settleMs: 1500, quietMs: 300, walkMs: 500, totalMs: 4000 };
const FAST_FALL = { appearMs: 500, maxMs: 3000, stepAwayMs: 500 };
const at = (x, y = 64, z = 0) => new Vec3(x, y, z);
const key = (p) => `${p.x},${p.y},${p.z}`;
const SPRUCE = 'dynamictrees:sprucebranch', DARK_OAK = 'dynamictrees:darkoakbranch';
const LEAVES = 'dynamictrees:leaves0', ROOTY = 'dynamictrees:rootydirt', BUSH = 'deadbush';

/**
 * The bot and its world. trees: [{ x, branch, sticks, canopy }]: a 5-block trunk with a canopy leaning
 * east, from y `canopy` (default 69: no leaf is reachable from the ground; 67: the lowest are); a cut
 * trunk fells only that tree, which drops 3 logs and `sticks` sticks east of it after the fall.
 * bushes: [{ x, z, sticks }]: a dead bush that gives `sticks` sticks when broken (by hand).
 * leafSticks: what each broken leaf gives, in turn (Pyrotech: a stick half the time). The walks keep
 * the bot on the ground (y 64): a leaf is broken from below.
 */
function fakeBot({ start = at(-2), trees = [], bushes = [], held = null, leafSticks = [1, 0] } = {}) {
    const world = new Map(); // key -> { name, tree }
    for (const [i, tr] of trees.entries()) {
        world.set(key(at(tr.x, 63)), { name: ROOTY });
        for (let y = 64; y <= 68; y++) world.set(key(at(tr.x, y)), { name: tr.branch, tree: i });
        world.set(key(at(tr.x + 1, 67)), { name: tr.branch, tree: i }); // a limb
        const low = tr.canopy ?? 69;
        for (let dx = -1; dx <= 3; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = low; y <= low + 3; y++) {
            const p = at(tr.x + dx, y, dz);
            if (!world.has(key(p))) world.set(key(p), { name: LEAVES, tree: i });
        }
    }
    for (const b of bushes) world.set(key(at(b.x, 64, b.z ?? 0)), { name: BUSH, sticks: b.sticks });
    const blockAt = (p) => {
        const q = p.floored ? p.floored() : p;
        const name = world.get(key(q))?.name ?? (q.y < 64 ? 'dirt' : 'air');
        const id = reg.blocksByName[name]?.id ?? MODDED[name];
        const solid = name !== 'air' && name !== BUSH;
        return { name, metadata: 0, type: id, position: q, boundingBox: solid ? 'block' : 'empty',
            canHarvest: () => true, transparent: !solid, shapes: solid ? [[0, 0, 0, 1, 1, 1]] : [] };
    };
    const items = held ? [held] : [];
    const slots = new Array(46).fill(null);
    if (held) slots[36] = held;
    const give = (name, meta, n) => {
        if (n <= 0) return;
        const got = items.find(i => i.name === name && i.metadata === meta);
        if (got) got.count += n; else items.push({ name, metadata: meta, count: n, type: reg.itemsByName[name].id });
    };
    let nextId = 1, leaves = 0;
    const entities = {};
    const log = { digs: [] };
    const bot = {
        log, world, registry: reg, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival' },
        entity: { position: start.offset(0.5, 0, 0.5) },
        entities, heldItem: held,
        setQuickBarSlot(i) { bot.heldItem = slots[36 + i] ?? null; },
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => items.filter(i => i.count > 0), slots },
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            const here = bot.entity.position;
            return [...world.keys()].map(k => blockAt(at(...k.split(',').map(Number))))
                .filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .filter(b => b.position.distanceTo(here) <= maxDistance)
                .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))
                .slice(0, count).map(b => b.position);
        },
        blockAt,
        equip: (item) => { bot.heldItem = item; return Promise.resolve(); },
        tool: { equipForBlock: () => Promise.resolve() },
        lookAt: () => Promise.resolve(),
        nearestEntity: () => null,
        dig: (b) => {
            const cell = world.get(key(b.position));
            log.digs.push({ pos: key(b.position), name: cell?.name, held: bot.heldItem?.name ?? null });
            if (cell?.name === BUSH) { world.delete(key(b.position)); give('stick', 0, cell.sticks); return Promise.resolve(); }
            if (cell?.name === LEAVES) { world.delete(key(b.position)); give('stick', 0, leafSticks[leaves++ % leafSticks.length]); return Promise.resolve(); }
            const tr = trees[cell.tree];
            for (const [k, c] of [...world]) if (c.tree === cell.tree) world.delete(k);
            const fall = { id: nextId++, name: FALLING_TREE, position: b.position.clone() };
            entities[fall.id] = fall;
            setTimeout(() => {
                delete entities[fall.id];
                for (let i = 0; i < 3; i++) entities[nextId] = { id: nextId++, name: 'item', position: at(tr.x + 4 + i, 64, 1), drop: 'log' };
                for (let i = 0; i < tr.sticks; i++) entities[nextId] = { id: nextId++, name: 'item', position: at(tr.x + 4 + i, 64, 2), drop: 'stick' };
            }, 600);
            return Promise.resolve();
        },
        pathfinder: {
            setMovements(m) { bot._moves = m; }, setGoal() {}, isMoving: () => false,
            stop() {},
            getPathTo: () => ({ status: 'success', path: [] }),
            goto(goal) {
                // Every walk ends on the ground (y 64): these tests check which blocks are chosen, not how
                // the bot walks. That a real walk never climbs a tree is proven in fall_safety.test.js.
                bot.entity.position = at(Math.floor(goal.x), 64, Math.floor(goal.z)).offset(0.5, 0, 0.5);
                for (const [id, e] of Object.entries(entities)) {
                    if (e.name === 'item' && e.position.distanceTo(bot.entity.position) <= 1.5) {
                        delete entities[id];
                        give(e.drop, e.drop === 'log' ? 1 : 0, 1);
                    }
                }
                return Promise.resolve();
            },
        },
    };
    return bot;
}

function fast(t) {
    t.mock.method(console, 'log', () => {});
    const saved = [{ ...skills.FELL_LIMITS }, { ...skills.TREE_FALL }];
    Object.assign(skills.FELL_LIMITS, FAST_DROPS);
    Object.assign(skills.TREE_FALL, FAST_FALL);
    t.after(() => { Object.assign(skills.FELL_LIMITS, saved[0]); Object.assign(skills.TREE_FALL, saved[1]); });
}

test('rotn-data #312: a dead bush gives 0-2 sticks, by hand (its rule; the fallback is gone)', () => {
    const way = worldSources('stick').find(s => s.blocks.includes(BUSH));
    assert.ok(way, 'a dead bush is a stick source');
    assert.equal(way.id, 'deadbush-sticks');
    assert.equal(way.tool, null, 'by hand');
    assert.deepEqual(way.countRange, { min: 0, max: 2, mean: 1 }, 'its yield can be 0');
});

test('round 8 A: sticks come from dead bushes first, nearest first, before any tree is felled', T, async (t) => {
    fast(t);
    // The spruce is the nearest stick source; the bushes are farther, the one at x 8 before x 12.
    const bot = fakeBot({ trees: [{ x: 3, branch: SPRUCE, sticks: 0 }], bushes: [{ x: 12, sticks: 1 }, { x: 8, sticks: 1 }] });
    assert.equal(await skills.collectBlock(bot, 'stick', 2), true, bot.output);
    assert.deepEqual(bot.log.digs.map(d => d.pos), ['8,64,0', '12,64,0'], `digs: ${JSON.stringify(bot.log.digs)}`);
    assert.ok(bot.log.digs.every(d => d.name === BUSH && d.held === null), 'only dead bushes, by hand');
    assert.match(bot.output, /Collected 2 stick\./);
});

test('round 8 A: a bush that gives nothing does not use up an attempt; then a tree', T, async (t) => {
    fast(t);
    const bot = fakeBot({ trees: [{ x: 3, branch: DARK_OAK, sticks: 2 }], bushes: [{ x: -6, sticks: 0 }, { x: -9, sticks: 0 }] });
    assert.equal(await skills.collectBlock(bot, 'stick', 1), true, bot.output);
    assert.deepEqual(bot.log.digs.map(d => d.name), [BUSH, BUSH, DARK_OAK]);
    assert.match(bot.output, /Collected 2 stick\./);
});

test('round 8 A, #311 review: a species that gave 0 sticks loses to a tree at most 16 blocks farther, in a collect and the next; never a long walk', T, async (t) => {
    fast(t);
    // From x 1 the spruce at 3 is nearest; its logs land at 7-9. From there the spruce at 13 is about
    // 4 away and the dark oak at -8 about 17: within 4 + 16, so the dark oak (spruce gave nothing).
    const trees = [
        { x: 3, branch: SPRUCE, sticks: 0 }, { x: 13, branch: SPRUCE, sticks: 1 },
        { x: -8, branch: DARK_OAK, sticks: 2 }, { x: -20, branch: DARK_OAK, sticks: 2 }, { x: -60, branch: DARK_OAK, sticks: 2 },
    ];
    const bot = fakeBot({ start: at(1), trees });
    const felled = () => bot.log.digs.map(d => `${d.name.replace('dynamictrees:', '')}@${d.pos.split(',')[0]}`);
    assert.equal(await skills.collectBlock(bot, 'stick', 2), true, bot.output);
    assert.deepEqual(felled(), ['sprucebranch@3', 'darkoakbranch@-8']);
    assert.match(bot.output, /Collected 2 stick\./);

    // The next collect remembers spruce: from the dark oak's drops (about x -2) the spruce at 13 is
    // about 15 away, the dark oak at -20 about 18: within 15 + 16, so the dark oak.
    assert.equal(await skills.collectBlock(bot, 'stick', 1), true, bot.output);
    assert.deepEqual(felled().slice(2), ['darkoakbranch@-20']);

    // From about x -14: the spruce at 13 is about 27 away, the dark oak at -60 about 46, more than
    // 27 + 16: the nearer spruce is felled (a spruce-only area still gets its sticks).
    assert.equal(await skills.collectBlock(bot, 'stick', 1), true, bot.output);
    assert.deepEqual(felled().slice(3), ['sprucebranch@13']);
});

test('#311 review: dead bushes come first only within 24 blocks; a tree next to the bot comes before a far bush, which is the last resort', T, async (t) => {
    fast(t);
    const bot = fakeBot({ trees: [{ x: 3, branch: DARK_OAK, sticks: 2 }], bushes: [{ x: 40, sticks: 1 }] });
    assert.equal(await skills.collectBlock(bot, 'stick', 3), true, bot.output);
    assert.deepEqual(bot.log.digs.map(d => d.name), [DARK_OAK, BUSH]);
    assert.match(bot.output, /Collected 3 stick\./);
});

test('#311 review: bushes that give nothing use no attempt at most 6 times per collect', T, async (t) => {
    fast(t);
    const bushes = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20].map(x => ({ x, sticks: 0 }));
    const bot = fakeBot({ bushes });
    assert.equal(await skills.collectBlock(bot, 'stick', 1), false, bot.output);
    assert.equal(bot.log.digs.length, 1 + skills.COLLECT_LIMITS.freeMisses, 'one attempt plus the capped free misses');
    assert.equal(skills.COLLECT_LIMITS.freeMisses, 6);
    assert.match(bot.output, /Collected 0 stick\./);
});

test('#311 review: a dead bush is never broken with shears (sheared, it drops itself and no stick)', T, async (t) => {
    fast(t);
    const shears = { name: 'shears', metadata: 0, count: 1, type: reg.itemsByName.shears.id };
    const bot = fakeBot({ bushes: [{ x: 3, sticks: 1 }], held: shears });
    bot.tool.equipForBlock = () => { bot.heldItem = shears; return Promise.resolve(); }; // as mineflayer-tool might
    assert.equal(await skills.collectBlock(bot, 'stick', 1), true, bot.output);
    assert.deepEqual(bot.log.digs.map(d => [d.name, d.held]), [[BUSH, null]], 'by hand, not with the shears');
});

// ---- Request 17 (rotn-data #312): leaves DO give sticks (Pyrotech: 1 stick half the time) ----

test('Request 17, rotn-data #319: a leaves block is a stick source, by hand, whose yield can be 0 (its rule; the fallback is gone)', () => {
    const way = worldSources('stick').find(s => s.blocks.some(b => /leaves/.test(b)));
    assert.ok(way, 'leaves are a stick source');
    assert.equal(way.id, 'leaves-sticks');
    assert.equal(worldSources('stick').filter(s => s.blocks.some(b => /leaves/.test(b))).length, 1, 'one leaves rule, no duplicate');
    assert.equal(way.tool, null, 'by hand');
    assert.ok(way.blocks.includes('dynamictrees:leaves0'), 'Dynamic Trees leaves too');
    assert.equal(way.countRange?.min, 0, 'a leaf can give nothing');
});

test('Request 17: leaves reachable from the ground come after dead bushes and before any felling; a leaf that gave nothing uses no attempt', T, async (t) => {
    fast(t);
    // The spruce at 3 has leaves from y 67 (reachable from the ground); the bush at 12 is farther.
    const bot = fakeBot({ trees: [{ x: 3, branch: SPRUCE, sticks: 5, canopy: 67 }], bushes: [{ x: 12, sticks: 1 }], leafSticks: [0, 1, 1] });
    assert.equal(await skills.collectBlock(bot, 'stick', 3), true, bot.output);
    assert.deepEqual(bot.log.digs.map(d => d.name), [BUSH, LEAVES, LEAVES, LEAVES], `digs: ${JSON.stringify(bot.log.digs)}`);
    assert.ok(bot.log.digs.every(d => d.held === null), 'by hand');
    assert.ok(bot.log.digs.filter(d => d.name === LEAVES).every(d => Number(d.pos.split(',')[1]) === 67), 'only leaves reachable from the ground');
    assert.match(bot.output, /Collected 3 stick\./);
});

test('Request 17: leaves come before a species that gave 0 sticks; leaves out of reach from the ground are not chosen', T, async (t) => {
    fast(t);
    // Spruce at 3 (no reachable leaf) is nearest; the low leaves of the spruce at 30 start 31 out,
    // beyond the 24-block first search. Spruce at 3 is felled and gives 0; from its drops (x 7-9) those
    // leaves are within 24 and come before felling the spruce at 30 (a species that gave nothing).
    const bot = fakeBot({ trees: [{ x: 3, branch: SPRUCE, sticks: 0 }, { x: 30, branch: SPRUCE, sticks: 3, canopy: 67 }], leafSticks: [1] });
    // 3 attempts: the felling (0 sticks) uses one, each leaf (1 stick) one.
    assert.equal(await skills.collectBlock(bot, 'stick', 3), true, bot.output);
    assert.deepEqual(bot.log.digs.map(d => d.name), [SPRUCE, LEAVES, LEAVES], `digs: ${JSON.stringify(bot.log.digs)}`);
    assert.match(bot.output, /Collected 2 stick\./);

    const high = fakeBot({ trees: [{ x: 3, branch: SPRUCE, sticks: 2 }] });
    assert.equal(await skills.collectBlock(high, 'stick', 1), true, high.output);
    assert.deepEqual(high.log.digs.map(d => d.name), [SPRUCE], 'the canopy is out of reach: felled, no leaf');
});
