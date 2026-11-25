// Soak 15 (net-forge's N3, the lead): failed crafts (rejected clicks: StackUp's stack sizes against bot.registry's
// 64) left their rocks in the 2x2 grid (slots 1-4); crafting reads inventory.items() (9-44), so every cobble craft
// failed for 10 min while !inventory listed the rocks. Now the grid is returned (the cursor first, then the vanilla
// close of window 0 on the client; no shift-click) before every craft, after a failed craft and after a rejected
// click; !inventory names the grid, the cursor and the off hand apart.
// Offline: a fake window (slots 0-45, a cursor) and a fake server that returns the grid on close_window 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { returnGrid, guardInventory } from './inventory_sync.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const item = (name, meta, count) => ({ name, metadata: meta, count, type: reg.itemsByName[name.replace(/^minecraft:/, '')]?.id ?? 9000 });

/** returns: whether the fake server answers close_window 0 by putting the grid back into free slots. */
function windowBot({ grid = {}, cursor = null, inv = {}, returns = true } = {}) {
    const slots = new Array(46).fill(null);
    for (const [k, it] of Object.entries(grid)) slots[+k] = { ...it, slot: +k };
    for (const [k, it] of Object.entries(inv)) slots[+k] = { ...it, slot: +k };
    const client = new EventEmitter();
    const sent = [];
    const firstFree = () => { const i = slots.findIndex((s, k) => k >= 9 && k < 45 && !s); return i < 0 ? null : i; };
    client.write = (name, data) => {
        sent.push([name, data]);
        if (name === 'close_window' && data?.windowId === 0 && returns) {
            setTimeout(() => {
                if (bot.inventory.selectedItem) { sent.push(['dropped', bot.inventory.selectedItem.name]); bot.inventory.selectedItem = null; }
                for (const k of [1, 2, 3, 4]) if (slots[k]) { const f = firstFree(); slots[f] = { ...slots[k], slot: f }; slots[k] = null; }
            }, 10);
        }
    };
    const bot = {
        output: '', _client: client, currentWindow: null, registry: reg,
        inventory: { slots, selectedItem: cursor, items: () => slots.slice(9, 45).filter(Boolean), firstEmptyInventorySlot: firstFree },
        clickWindow: (slot) => {
            sent.push(['click', slot]);
            if (bot.inventory.selectedItem && slot >= 0) { slots[slot] = { ...bot.inventory.selectedItem, slot }; bot.inventory.selectedItem = null; }
            return Promise.resolve();
        },
    };
    return { bot, slots, sent };
}
const capture = (t) => { const logs = []; t.mock.method(console, 'log', (...a) => logs.push(a.join(' '))); t.mock.method(console, 'warn', (...a) => logs.push(a.join(' '))); return logs; };
const ROCK = 'pyrotech_compat:rock_metamorphic';

test('soak 15 (N3): returnGrid sends the vanilla close of window 0 on the client (no shift-click); the grid comes back, a line names it', async (t) => {
    const logs = capture(t);
    const { bot, slots, sent } = windowBot({ grid: { 3: item(ROCK, 6, 3), 4: item(ROCK, 6, 4) } });
    const r = await returnGrid(bot, 'after a failed craft');
    assert.deepEqual(sent, [['close_window', { windowId: 0 }]], 'only the close: no click, no shift-click');
    assert.deepEqual([1, 2, 3, 4].map(k => slots[k]), [null, null, null, null]);
    assert.equal(bot.inventory.items().filter(i => i.name === ROCK).reduce((n, i) => n + i.count, 0), 7);
    assert.deepEqual(r.left, []);
    assert.ok(logs.includes(`[inventory] after a failed craft: closed the inventory to return the 2x2 grid: 3 ${ROCK} (slot 3), 4 ${ROCK} (slot 4)`), logs.join('\n'));
});

test('soak 15 (N3): the cursor is cleared first (closing would drop it); with no free slot nothing is closed; an empty grid does nothing', async (t) => {
    const logs = capture(t);
    const cur = windowBot({ grid: { 4: item(ROCK, 6, 4) }, cursor: item('betterwithmods:dirt_pile', 0, 1) });
    await returnGrid(cur.bot, 'after a rejected click (craft)');
    assert.deepEqual(cur.sent.map(s => s[0]), ['click', 'close_window'], 'the cursor into a free slot, then the close');
    assert.ok(!cur.sent.some(s => s[0] === 'dropped'), 'nothing dropped');
    assert.match(logs.at(-1), /^\[inventory\] after a rejected click \(craft\): closed the inventory to return the 2x2 grid: 4 \S+ \(slot 4\); first put the betterwithmods:dirt_pile on the cursor into slot 9$/);
    // No free slot for the cursor: no close (it would drop the cursor stack).
    const inv = {}; for (let k = 9; k < 45; k++) inv[k] = item('dirt', 0, 64);
    const full = windowBot({ grid: { 4: item(ROCK, 6, 4) }, cursor: item('betterwithmods:dirt_pile', 0, 1), inv });
    const r = await returnGrid(full.bot, 'before a 2x2 craft');
    assert.deepEqual(full.sent, []);
    assert.deepEqual(r.left, [4]);
    assert.ok(logs.some(l => /before a 2x2 craft: 4 \S+ \(slot 4\) left in the 2x2 grid, but the betterwithmods:dirt_pile on the cursor has no free slot \(closing would drop it\): not closing/.test(l)), logs.join('\n'));
    // An empty grid: nothing sent, nothing said.
    const empty = windowBot();
    const n = logs.length;
    assert.equal(await returnGrid(empty.bot, 'before a 2x2 craft'), null);
    assert.deepEqual(empty.sent, []);
    assert.equal(logs.length, n);
});

test('soak 15 (N3): a close the server does not answer: the line says the grid is still not empty; no shift-click is tried', async (t) => {
    const logs = capture(t);
    const { bot, sent } = windowBot({ grid: { 2: item(ROCK, 6, 4) }, returns: false });
    const r = await returnGrid(bot, 'after a failed craft', { waitMs: 60, stepMs: 10 });
    assert.deepEqual(sent, [['close_window', { windowId: 0 }]]);
    assert.deepEqual(r.left, [2]);
    assert.match(logs.at(-1), /; the grid is still not empty: slots 2$/);
});

test('soak 15 (N3): the guarded craft returns the grid before a 2x2 craft and after a failed one; not before a table craft', async (t) => {
    capture(t);
    const { bot, sent } = windowBot({ grid: { 1: item(ROCK, 6, 2) } });
    bot.on = () => {};
    let fail = false;
    const crafted = [];
    bot.craft = (recipe, count, table) => { crafted.push(table ?? null); if (fail) { bot.inventory.slots[2] = { ...item(ROCK, 6, 4), slot: 2 }; return Promise.reject(new Error('missing ingredient')); } return Promise.resolve(); };
    guardInventory(bot);
    await bot.craft({}, 1, null);
    assert.equal(sent.filter(s => s[0] === 'close_window').length, 1, 'before the 2x2 craft');
    await new Promise(r => setTimeout(r, 20));
    fail = true;
    await assert.rejects(bot.craft({}, 1, null), /missing ingredient/);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(sent.filter(s => s[0] === 'close_window').length, 2, 'after the failed craft (the grid had the craft\'s rocks)');
    assert.deepEqual(bot.inventory.slots.slice(1, 5), [null, null, null, null]);
    fail = false;
    bot.inventory.slots[3] = { ...item(ROCK, 6, 1), slot: 3 };
    await bot.craft({}, 1, { name: 'crafting_table' });
    assert.equal(sent.filter(s => s[0] === 'close_window').length, 2, 'a table craft: the 2x2 grid is not its grid');
});

test('soak 15: !craftRecipe("cobblestone") with its rocks left in the grid: they come back first, and the craft goes on (not "you have no such rocks")', async (t) => {
    capture(t);
    const { craftRecipe } = await import('./skills.js');
    const SED = 'pyrotech_compat:rock_sedimentary';
    const { bot, slots } = windowBot({ grid: { 1: item(SED, 0, 2), 2: item(SED, 0, 2) } });
    Object.assign(bot, {
        version: '1.12.2', entity: { position: new Vec3(0, 64, 0) }, modes: { isOn: () => false }, armorManager: { equipAll() {} },
        findBlocks: () => [], blockAt: () => null, recipesFor: () => [],
        craft: (recipe) => {
            const rocks = (recipe.ingredients ?? recipe.inShape.flat()).filter(c => c && c.id !== -1);
            const rock = bot.inventory.items().find(i => i.type === rocks[0].id && i.metadata === rocks[0].metadata && i.count >= 4);
            if (!rock) return Promise.reject(new Error('missing ingredient'));
            rock.count -= 4;
            const k = slots.findIndex((s, i) => i >= 9 && i < 45 && !s);
            slots[k] = { ...item('contenttweaker:chalk_cobble', 0, 1), slot: k };
            return Promise.resolve();
        },
    });
    // The fake server returns the grid's two stacks into two slots: merge them as one stack of 4 (as the server would).
    const write = bot._client.write;
    bot._client.write = (name, data) => { write(name, data); setTimeout(() => {
        const rocks = slots.filter((s, i) => i >= 9 && i < 45 && s?.name === SED);
        if (rocks.length > 1) { rocks[0].count = rocks.reduce((n, r) => n + r.count, 0); for (const r of rocks.slice(1)) slots[r.slot] = null; }
    }, 20); };
    // (This fake registry has no modded cobble, so the craft itself stops at the registry; what matters is the count.)
    await craftRecipe(bot, 'cobblestone', 1);
    assert.match(bot.output, /Cobblestone from your rocks: 1 contenttweaker:chalk_cobble:0 \(4 pyrotech_compat:rock_sedimentary:0 each\)\./, 'the rocks were counted');
    assert.match(bot.output, new RegExp(`2 ${SED}, 2 ${SED} that were left in the crafting grid are back in your inventory\\.`));
    assert.doesNotMatch(bot.output, /no such rocks/);
});

test('soak 15: !inventory names the 2x2 grid, the cursor and the off hand apart; the main list is the inventory crafting sees', async (t) => {
    capture(t);
    await import('../agent.js'); // the real import order (commands/index.js first)
    const { getCommand } = await import('../commands/index.js');
    const { bot, slots } = windowBot({ grid: { 4: item(ROCK, 6, 4) }, cursor: item('betterwithmods:dirt_pile', 0, 3), inv: { 10: item(ROCK, 6, 19), 36: item('stick', 0, 5) } });
    slots[45] = { ...item('stone_pickaxe', 0, 1), slot: 45 };
    bot.game = { gameMode: 'survival' };
    const out = getCommand('!inventory').perform({ bot });
    assert.match(out, new RegExp(`- ${ROCK}:6: 19\\b`), 'the main list: only the inventory (19, not 23)');
    assert.match(out, new RegExp(`IN THE 2x2 CRAFTING GRID \\(not usable until moved back; the next craft returns them first\\): 4 ${ROCK}:6`));
    assert.match(out, /ON THE CURSOR: 3 betterwithmods:dirt_pile/);
    assert.match(out, /IN THE OFF HAND: 1 stone_pickaxe \(kept at a death; taken back when a dig needs it\)/);
    assert.doesNotMatch(out, /creative mode/);
    // #619 review 7: the creative note follows a non-empty list (as upstream), never the off-hand line.
    bot.game.gameMode = 'creative';
    assert.match(getCommand('!inventory').perform({ bot }), /- stick: 5\n\(You have infinite items in creative mode[^\n]*\nIN THE 2x2 CRAFTING GRID/);
});

// Soak 15 (the lead): between actions the update loop repairs a cursor or 2x2-grid leftover, said once per state.
test('soak 15: idleHands: between actions a grid leftover is returned, said once; a running action is left alone', async (t) => {
    const logs = capture(t);
    const { idleHands } = await import('./hands.js');
    const { bot, slots, sent } = windowBot({ grid: { 4: item(ROCK, 6, 4) }, returns: false });
    const agent = { bot, actions: { executing: true } };
    assert.equal(await idleHands(agent), null, 'an action runs: nothing');
    assert.deepEqual(sent, []);
    agent.actions.executing = false;
    await idleHands(agent);
    assert.deepEqual(sent, [['close_window', { windowId: 0 }]]);
    assert.ok(logs.some(l => /^\[hands\] idle: stacks in the 2x2 grid \(slots 4\): putting them back$/.test(l)), logs.join('\n'));
    const n = logs.length;
    await idleHands(agent);
    assert.equal(sent.length, 1, 'the same state: not tried again');
    assert.equal(logs.length, n, 'not said again');
    slots[4] = null;
    assert.equal(await idleHands(agent), null, 'clean: nothing to do');
    assert.equal(agent.rotnIdleHandsSaid, null);
});

// Soak 15 (the lead): with allow_insecure_coding false the model is not offered !newAction (refused at run time).
test('soak 15: getCommandDocs leaves out !newAction when allow_insecure_coding is false', async () => {
    await import('../agent.js');
    const { getCommandDocs } = await import('../commands/index.js');
    const settings = (await import('../settings.js')).default;
    const before = settings.allow_insecure_coding;
    try {
        settings.allow_insecure_coding = false;
        assert.doesNotMatch(getCommandDocs({ blocked_actions: [] }), /!newAction:/);
        settings.allow_insecure_coding = true;
        assert.match(getCommandDocs({ blocked_actions: [] }), /!newAction:/);
    } finally { settings.allow_insecure_coding = before; }
});

// #619 review 2: the cursor is re-checked after the clear: still holding a stack, nothing is closed (it would drop it).
test('#619 review 2: a cursor the clear did not empty: no close_window', async (t) => {
    const logs = capture(t);
    const { bot, sent } = windowBot({ grid: { 4: item(ROCK, 6, 4) }, cursor: item('betterwithmods:dirt_pile', 0, 1) });
    bot.clickWindow = (slot) => { sent.push(['click', slot]); return Promise.resolve(); }; // the server kept the cursor
    const r = await returnGrid(bot, 'before a 2x2 craft');
    assert.deepEqual(sent.map(s => s[0]), ['click'], 'the clear, then no close');
    assert.deepEqual(r.left, [4]);
    assert.ok(logs.some(l => /is still on the cursor \(closing would drop it\): not closing/.test(l)), logs.join('\n'));
});

// #619 review 3: a full inventory: the server drops what it cannot place back; the line and the craft say "dropped".
test('#619 review 3: grid stacks the server could not place back are said dropped, not back in the inventory', async (t) => {
    const logs = capture(t);
    const inv = {}; for (let k = 9; k < 45; k++) inv[k] = item('dirt', 0, 64);
    inv[20] = item(ROCK, 6, 62); // room for 2 more rocks in this stack (a 64 stack size here)
    const { bot, slots, sent } = windowBot({ grid: { 3: item(ROCK, 6, 3), 4: item(ROCK, 6, 4) }, inv, returns: false });
    bot._client.write = (name, data) => {
        sent.push([name, data]);
        setTimeout(() => { slots[3] = null; slots[4] = null; slots[20].count = 64; }, 10); // 2 placed back, 5 dropped
    };
    const r = await returnGrid(bot, 'after a failed craft', { waitMs: 200, stepMs: 10 });
    assert.deepEqual(r.left, []);
    assert.deepEqual(r.moved.map(g => [g.slot, g.count]), [[3, 2]]);
    assert.deepEqual(r.dropped.map(g => [g.slot, g.count]), [[3, 1], [4, 4]]);
    assert.match(logs.at(-1), new RegExp(`; no room for 1 ${ROCK}, 4 ${ROCK}: dropped on the ground$`));
});

// #619 review 4: the hands' clicks one at a time: no idle repair while handsBefore clicks, nor while a mode acts.
test('#619 review 4: idleHands waits out handsBefore and a mode acting; handsBefore waits for an idle repair', async (t) => {
    capture(t);
    const { idleHands, handsBefore } = await import('./hands.js');
    const { bot, sent } = windowBot({ grid: { 4: item(ROCK, 6, 4) } });
    const agent = { bot, actions: { executing: false } };
    bot.modes = { anyActive: () => true };
    assert.equal(await idleHands(agent), null, 'a mode acts: no repair');
    bot.modes.anyActive = () => false;
    const before = handsBefore(bot, 'action:craftRecipe');
    assert.ok(bot.rotnHandsBusy, 'handsBefore holds the lock');
    assert.equal(await idleHands(agent), null, 'no repair beside it');
    await before;
    assert.equal(sent.filter(s => s[0] === 'close_window').length, 1, 'one close, from handsBefore');
    // An idle repair running: handsBefore waits for it (its close first, then nothing left to do).
    bot.inventory.slots[2] = { ...item(ROCK, 6, 1), slot: 2 };
    const idle = idleHands(agent);
    const next = handsBefore(bot, 'action:craftRecipe');
    assert.ok(next, 'waits on the lock');
    await Promise.all([idle, next]);
    assert.equal(sent.filter(s => s[0] === 'close_window').length, 2, 'the idle close only; handsBefore found it done');
    assert.equal(bot.rotnHandsBusy, null);
});
