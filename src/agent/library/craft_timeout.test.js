// Soak 9 (rotn-v0.1.15, 12:01:22): !craftRecipe("stone_pickaxe", 1) said "crafting..." and
// bot.craft never resolved (the server had made the pickaxe). At 12:01:50 the unstuck reflex (20 s
// at the table) tried to stop the craft, which ignored it, and Mindcraft killed the process 10 s
// later. Offline: a bot.craft that never resolves, mineflayer 4.33.0's real craft plugin with a
// click the server never confirms, and the real unstuck mode. No server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import * as skills from './skills.js';
import { initModes, __modeForTest } from '../modes.js';

const { craftPausingAutoEat, craftRecipe, viewChest, stationaryWhile, collectBlock, CRAFT_LIMITS, CRAFT_TABLE_OPS, TABLE_PICKUP_MS, STOP_POLL_MS } = skills;
const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const PICK = reg.itemsByName.stone_pickaxe.id;
const stack = (name, count) => ({ name, metadata: 0, count, type: reg.itemsByName[name].id });
const pickRecipe = { result: { id: PICK, count: 1, metadata: 0 }, requiresTable: true };
const table = { name: 'crafting_table', position: new Vec3(1, 64, 0) };
const FAST = { ...CRAFT_LIMITS, tableMs: 400, handMs: 300, pollMs: 20, settleMs: 300 };
const quiet = (t) => { t.mock.method(console, 'log', () => {}); };

/**
 * A bot whose bot.craft never resolves (each call recorded with what bot.rotnStationary was); the
 * table's window open. With madeOnClose the server's pickaxe shows up in the inventory 50 ms after
 * the window is closed (soak 9: it was there after the restart).
 */
function hangBot({ madeOnClose = false, items = [] } = {}) {
    const calls = { crafts: [], closed: 0 };
    const bot = {
        output: '', registry: reg, interrupt_code: false,
        inventory: { items: () => items, get slots() { return [null, ...items]; } },
        currentWindow: { id: 3, type: 'minecraft:crafting_table' },
        craft: (recipe, count) => { calls.crafts.push({ count, stationary: bot.rotnStationary }); return new Promise(() => {}); },
        closeWindow: () => {
            calls.closed++;
            bot.currentWindow = null;
            if (madeOnClose) setTimeout(() => items.push(stack('stone_pickaxe', 1)), 50);
        },
    };
    return { bot, calls, items };
}

test('soak 9 (1): a table craft that never resolves ends at its limit, closes the table, and says it was crafted anyway when the server made it', async (t) => {
    quiet(t);
    const { bot, calls } = hangBot({ madeOnClose: true });
    const start = Date.now();
    const r = await craftPausingAutoEat(bot, pickRecipe, 1, table, 3000, FAST);
    assert.ok(Date.now() - start < 1500, `ended at its limit: ${Date.now() - start} ms`);
    assert.deepEqual(r, { ended: 'timeout', made: 1 });
    assert.equal(calls.closed, 1);
    assert.equal(bot.currentWindow, null);
    assert.match(bot.output, /The craft of stone_pickaxe did not finish within 0\.4 s \(timed out\); closed the crafting table; crafted anyway: you now have 1 stone_pickaxe\./);
    assert.deepEqual(calls.crafts.map(c => c.count), [1, 0], 'then a craft of 0, which lets mineflayer\'s kept table window go');
    assert.equal(calls.crafts[0].stationary, true, 'rotnStationary during the craft');
    assert.equal(bot.rotnStationary, false, 'and set back after');
});

test('soak 9 (1): nothing made: "not crafted"; the table limit is CRAFT_LIMITS.tableMs, plus perCraftMs per further use', async (t) => {
    quiet(t);
    assert.equal(CRAFT_LIMITS.tableMs, 15_000);
    const { bot } = hangBot();
    const r = await craftPausingAutoEat(bot, pickRecipe, 3, table, 3000, { ...FAST, tableMs: 300, perCraftMs: 100 });
    assert.deepEqual(r, { ended: 'timeout', made: 0 });
    assert.match(bot.output, /did not finish within 0\.5 s \(timed out\); closed the crafting table; not crafted: you have 0 stone_pickaxe\./);
});

test('soak 9 (1): a stop ends a craft that never resolves at once (the default 15 s limit), long before Mindcraft\'s 10 s kill', async (t) => {
    quiet(t);
    const { bot, calls } = hangBot();
    setTimeout(() => { bot.interrupt_code = true; }, 100);
    const start = Date.now();
    const r = await craftPausingAutoEat(bot, pickRecipe, 1, table);
    const ms = Date.now() - start;
    assert.ok(ms < 2500, `ended on the stop: ${ms} ms`);
    assert.deepEqual(r, { ended: 'interrupted', made: 0 });
    assert.equal(calls.closed, 1);
    assert.match(bot.output, /The craft of stone_pickaxe was stopped before it finished; closed the crafting table; not crafted: you have 0 stone_pickaxe\./);
    // The command's own limit (currentRun aborted) ends it too.
    const late = hangBot();
    late.bot.action_run = { aborted: false };
    setTimeout(() => { late.bot.action_run.aborted = true; }, 100);
    assert.equal((await craftPausingAutoEat(late.bot, pickRecipe, 1, table)).ended, 'interrupted');
});

test('soak 9 (1): craftRecipe with a craft that never resolves returns, picks its table up, and never says "Successfully crafted"', async (t) => {
    quiet(t);
    const saved = { ...CRAFT_LIMITS };
    Object.assign(CRAFT_LIMITS, FAST);
    t.after(() => Object.assign(CRAFT_LIMITS, saved));
    const items = [stack('cobblestone', 3), stack('stick', 2), stack('crafting_table', 1)];
    const { bot, calls } = hangBot({ madeOnClose: true, items });
    const prismarineRecipe = (await import('prismarine-recipe')).default;
    const recipe = prismarineRecipe(reg).Recipe.find(PICK, null)[0];
    Object.assign(bot, {
        entity: { position: new Vec3(0, 64, 0) },
        modes: { isOn: () => false }, armorManager: { equipAll() {} },
        findBlocks: () => [], blockAt: () => null,
        recipesFor: (id, meta, n, tbl) => (tbl === null ? [] : [recipe]),
    });
    const ops = { placed: 0, picked: 0 };
    ops.place = () => { ops.placed++; return Promise.resolve(table); };
    ops.pickUp = () => { ops.picked++; return Promise.resolve(); };
    assert.equal(await craftRecipe(bot, 'stone_pickaxe', 1, ops), true, 'the server made it');
    assert.deepEqual([ops.placed, ops.picked], [1, 1]);
    assert.equal(calls.closed, 1);
    assert.match(bot.output, /crafted anyway: you now have 1 stone_pickaxe/);
    assert.doesNotMatch(bot.output, /Successfully crafted/);
});

/**
 * mineflayer 4.33.0's real craft plugin on a fake bot: the table opens, and the first click is
 * never confirmed (a craft that never resolves, as in soak 9).
 */
function mineflayerBot() {
    const require = createRequire(import.meta.url);
    const inject = require('mineflayer/lib/plugins/craft.js');
    const bot = new EventEmitter();
    const opened = [], closed = [];
    Object.assign(bot, {
        registry: reg, output: '', interrupt_code: false, currentWindow: null,
        inventory: { items: () => [] },
        activateBlock: () => {
            const window = { id: opened.length + 1, type: 'minecraft:crafting_table', selectedItem: null, inventoryStart: 10, inventoryEnd: 46,
                findInventoryItem: () => ({ slot: 20, type: 4, count: 3 }), updateSlot() {} };
            opened.push(window);
            // mineflayer calls once(bot, 'windowOpen') right after this, in the same tick; its 20 s
            // timeout timer is never cleared, so it is unref'd (the file would wait 20 s for it).
            const real = globalThis.setTimeout;
            globalThis.setTimeout = (...a) => real(...a).unref();
            queueMicrotask(() => { globalThis.setTimeout = real; });
            setImmediate(() => { bot.currentWindow = window; bot.emit('windowOpen', window); });
        },
        clickWindow: () => new Promise(() => {}),
        closeWindow: (w) => { closed.push(w.id); bot.currentWindow = null; },
    });
    inject(bot);
    const recipe = { result: { id: PICK, count: 1, metadata: 0 }, inShape: [[{ id: 4, metadata: null, count: 1 }]], requiresTable: true, delta: [] };
    return { bot, recipe, opened, closed };
}

test('soak 9 (1): with mineflayer\'s real craft, a give-up lets the kept table window go, so the next craft opens the table afresh', async (t) => {
    quiet(t);
    const { bot, recipe, opened, closed } = mineflayerBot();
    assert.equal((await craftPausingAutoEat(bot, recipe, 1, table, 3000, FAST)).ended, 'timeout');
    assert.deepEqual(closed, [1], 'window 1 closed (by mineflayer\'s own close, through the craft of 0)');
    assert.equal(bot.currentWindow, null);
    assert.equal((await craftPausingAutoEat(bot, recipe, 1, table, 3000, FAST)).ended, 'timeout');
    assert.equal(opened.length, 2, 'the second craft opened the table again, not window 1 that the server had closed');
    assert.deepEqual(closed, [1, 2]);
});

test('soak 9 (1): a craft that resolves is as before: { ended: crafted }, and its failure still throws', async (t) => {
    quiet(t);
    const items = [];
    const bot = { output: '', registry: reg, inventory: { items: () => items }, craft: () => { items.push(stack('stone_pickaxe', 1)); return Promise.resolve(); } };
    assert.deepEqual(await craftPausingAutoEat(bot, pickRecipe, 1, table), { ended: 'crafted', made: 1 });
    assert.equal(bot.output, '');
    const failing = { output: '', craft: () => Promise.reject(new Error('click rejected')) };
    await assert.rejects(craftPausingAutoEat(failing, pickRecipe, 1, table), /click rejected/);
    assert.equal(failing.rotnStationary, false);
});

function unstuckAgent(bot) {
    const agent = {
        name: 'FRCFLD', bot, task: null, prompter: { getInitModes: () => ({}) },
        actions: { currentActionLabel: 'action:craftRecipe', resume_func: null, runAction: async (label, fn) => { await fn(); return { message: 'ok', interrupted: false }; } },
        self_prompter: { isActive: () => true, stopLoop: () => {} },
        handleMessage: () => Promise.resolve(true), cleanKill: () => {}, isIdle: () => false,
    };
    initModes(agent);
    return { agent, mode: __modeForTest('unstuck') };
}

test('soak 9 (2): the unstuck reflex never counts a craft at the table (or a chest window) as stuck; after it, it counts again', async (t) => {
    quiet(t);
    const { bot } = hangBot();
    Object.assign(bot, { entity: { position: new Vec3(0.5, 64, 0.5) }, targetDigBlock: null, version: '1.12.2' });
    const { agent, mode } = unstuckAgent(bot);
    const runs = [];
    agent.actions.runAction = (label) => { runs.push(label); return Promise.resolve({ message: 'ok', interrupted: false }); };
    // 25 s at the table with no progress, as at 12:01:50, while the craft is under way.
    const craft = craftPausingAutoEat(bot, pickRecipe, 1, table, 3000, { ...FAST, tableMs: 400 });
    await new Promise(resolve => setTimeout(resolve, 50));
    mode.prev_location = bot.entity.position.clone();
    mode.stuck_time = mode.max_stuck_time + 5;
    mode.last_time = Date.now();
    await mode.update(agent);
    assert.equal(mode.stuck_time, 0, 'not counted while the craft runs');
    assert.deepEqual(runs, []);
    await craft;
    assert.equal(bot.rotnStationary, false);
    // A chest window: viewChest's window part (cheat mode: goToPosition is a /tp, no walk).
    let during = null, walking = null;
    Object.assign(bot, {
        modes: { isOn: (m) => m === 'cheat' },
        chat: () => { walking = bot.rotnStationary; },
        findBlocks: () => [new Vec3(1, 64, 0)],
        blockAt: (p) => ({ name: 'chest', position: p, type: reg.blocksByName.chest.id }),
        openContainer: () => { during = bot.rotnStationary; return Promise.resolve({ containerItems: () => [], close: () => {} }); },
    });
    assert.equal(await viewChest(bot), true);
    assert.equal(walking, false, 'not on the way to the chest');
    assert.equal(during, true, 'while the chest window is open');
    assert.equal(bot.rotnStationary, false);
    // Set by a skill already (the shelter): kept.
    bot.rotnStationary = true;
    await stationaryWhile(bot, async () => {});
    assert.equal(bot.rotnStationary, true);
    bot.rotnStationary = false;
    // Off again: a still bot is counted.
    mode.prev_location = bot.entity.position.clone();
    mode.stuck_time = 3;
    mode.last_time = Date.now() - 1000;
    await mode.update(agent);
    assert.ok(mode.stuck_time > 3, `counted again: ${mode.stuck_time}`);
});

// net-forge's analysis of soak 9: bot.craft's own waits are bounded (5 s a click, 20 s a window or
// a put-away); the hang was most likely in the finally that picks the placed table up
// (collectBlock -> mineflayer-collectblock's wait for the drop, which has no bound).
const key = (p) => `${p.x},${p.y},${p.z}`;
/** A world (stone below y 64, air above) with a crafting table at 1, 64, 0; collectBlock.collect never resolves. */
function pickupBot() {
    const world = new Map([['1,64,0', 'crafting_table']]);
    const calls = { cancel: 0, collect: 0 };
    const blockOf = (q) => {
        const v = world.get(key(q)) ?? (q.y < 64 ? 'stone' : 'air');
        const b = reg.blocksByName[v];
        return { name: v, metadata: 0, type: b.id, position: q, boundingBox: b.boundingBox, transparent: false, shapes: [[0, 0, 0, 1, 1, 1]], canHarvest: () => true };
    };
    const bot = {
        registry: reg, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival', dimension: 'overworld' },
        entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 }, entities: {}, heldItem: null,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => [], slots: [] },
        blockAt: (p) => blockOf(p.floored()),
        findBlocks: ({ matching, count = 1 }) => [...world.keys()].map(k => new Vec3(...k.split(',').map(Number)))
            .filter(p => { const b = blockOf(p); return typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type); }).slice(0, count),
        equip: () => Promise.resolve(), tool: { equipForBlock: () => Promise.resolve() },
        collectBlock: { collect: () => { calls.collect++; return new Promise(() => {}); }, cancelTask: () => { calls.cancel++; return Promise.resolve(); } },
        dig: () => new Promise(() => {}), stopDigging() {},
        pathfinder: { setMovements() {}, stop() {}, setGoal() {}, isMoving: () => false, getPathTo: () => ({ status: 'success', path: [] }), goto: () => Promise.resolve() },
        lookAt: () => Promise.resolve(), nearestEntity: () => null,
    };
    return { bot, calls };
}

test('soak 9 (a): the table pickup gives up at its own limit (TABLE_PICKUP_MS), cancels the collect, and says the table is left', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    assert.equal(TABLE_PICKUP_MS, 10_000);
    const { bot, calls } = pickupBot();
    const start = Date.now();
    await CRAFT_TABLE_OPS.pickUp(bot, 300);
    assert.ok(Date.now() - start < 1500, `${Date.now() - start} ms`);
    assert.equal(calls.collect, 1, 'the collect was under way');
    assert.ok(calls.cancel >= 1, 'and cancelled');
    assert.match(bot.output, /Could not pick up the crafting table within 0\.3 s; it is left where it is\./);
    assert.ok(logs.includes('[craft] picking the crafting table up again'), logs.join('\n'));
    assert.ok(logs.some(l => /^\[craft\] the table pickup was given up after \d+ ms$/.test(l)), logs.join('\n'));
});

test('soak 9 (b): a stop ends a collect stuck in its drop wait within a few STOP_POLL_MS (its block limit is 90 s), and the pickup says so', async (t) => {
    t.mock.method(console, 'log', () => {});
    assert.equal(STOP_POLL_MS, 100);
    const { bot, calls } = pickupBot();
    setTimeout(() => { bot.interrupt_code = true; }, 150);
    let start = Date.now();
    await collectBlock(bot, 'crafting_table', 1);
    assert.ok(Date.now() - start < 1000, `the collect ended on the stop: ${Date.now() - start} ms`);
    assert.ok(calls.cancel >= 1);
    assert.match(bot.output, /Gave up on crafting_table at 1, 64, 0: stopped\./);
    // The craft's pickup, with its own 10 s: the stop ends it too.
    const p = pickupBot();
    setTimeout(() => { p.bot.interrupt_code = true; }, 150);
    start = Date.now();
    await CRAFT_TABLE_OPS.pickUp(p.bot);
    assert.ok(Date.now() - start < 1000, `${Date.now() - start} ms`);
    assert.match(p.bot.output, /Stopped while picking up the crafting table; it is left where it is\./);
});

test('soak 9 (c): a line right after bot.craft returns (or throws), before the table pickup', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const ok = { output: '', craft: () => new Promise(resolve => setTimeout(resolve, 30)) };
    await craftPausingAutoEat(ok, pickRecipe, 1, table);
    assert.ok(logs.some(l => /^\[craft\] bot\.craft returned after \d+ ms$/.test(l)), logs.join('\n'));
    const failing = { output: '', craft: () => Promise.reject(new Error('click rejected')) };
    await assert.rejects(craftPausingAutoEat(failing, pickRecipe, 1, table), /click rejected/);
    assert.ok(logs.some(l => /^\[craft\] bot\.craft returned after \d+ ms \(it threw: .*click rejected.*\)$/.test(l)), logs.join('\n'));
});
