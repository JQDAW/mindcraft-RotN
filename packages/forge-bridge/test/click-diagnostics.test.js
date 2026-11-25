// Soak 15 (N2): one line for each window click the server rejects: the client's view before the
// click next to the server's resend after it (clicked slot, cursor, the 2x2 grid).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
import { createRequire } from 'node:module';
import { attachClickDiagnostics, describeItem, rejectedClickLine } from '../src/click-diagnostics.js';

const require = createRequire(import.meta.url);
const registry = require('prismarine-registry')('1.12.2');
const Item = require('prismarine-item')(registry);
const DIRT = registry.itemsByName.dirt.id;
const STICK = registry.itemsByName.stick.id;
const EMPTY = { blockId: -1 };
const notch = (type, count, meta = 0) => Item.toNotch(new Item(type, count, meta));

/** A fake bot: a client that records writes, the player window, injected timers. */
function fakeBot() {
    const bot = new EventEmitter();
    bot.registry = registry;
    bot.writes = [];
    bot._client = new EventEmitter();
    bot._client.write = (name, params) => bot.writes.push([name, params]);
    bot.inventory = { id: 0, slots: new Array(46).fill(null), selectedItem: null };
    const timers = [];
    const t = {
        setTimer: (fn, ms) => { const h = { fn, ms, done: false }; timers.push(h); return h; },
        clearTimer: (h) => { if (h) h.done = true; },
        fire: () => { for (const h of timers.filter((x) => !x.done)) { h.done = true; h.fn(); } },
    };
    return { bot, t };
}
const clickPacket = (slot, action, mode = 0, mouseButton = 0) => ({ windowId: 0, slot, mouseButton, action, mode, item: null });

test('a rejected click: the client\'s view before it and the server\'s resend after it, one line', () => {
    const { bot, t } = fakeBot();
    const logs = [];
    attachClickDiagnostics(bot, { log: (m) => logs.push(m), setTimer: t.setTimer, clearTimer: t.clearTimer });
    // The client thinks slot 11 has 8 dirt (a phantom from an earlier merge); the grid is empty.
    bot.inventory.slots[11] = new Item(DIRT, 8);
    bot._client.write('window_click', clickPacket(11, 812));
    assert.equal(bot.writes.length, 1, 'the click still goes out');
    bot.inventory.slots[11] = null; // whatever the bot does meanwhile does not change the recorded view
    bot._client.emit('transaction', { windowId: 0, action: 812, accepted: false });
    const items = new Array(46).fill(EMPTY);
    items[4] = notch(DIRT, 1);
    items[11] = EMPTY;
    bot._client.emit('window_items', { windowId: 0, items });
    assert.deepEqual(logs, [], 'waits for the cursor packet');
    bot._client.emit('set_slot', { windowId: -1, slot: -1, item: EMPTY });
    assert.deepEqual(logs, ['click rejected: window 0 slot 11 (mode 0, button 0, action 812); client before the click: slot dirt x8, cursor -, grid [-, -, -, -]; server after it: slot -, cursor -, grid [-, -, -, dirt x1]']);
});

test('an accepted click logs nothing; a rejection with no resend says so; no cursor packet still logs the window', () => {
    const { bot, t } = fakeBot();
    const logs = [];
    attachClickDiagnostics(bot, { log: (m) => logs.push(m), setTimer: t.setTimer, clearTimer: t.clearTimer });
    bot._client.write('window_click', clickPacket(36, 1));
    bot._client.emit('transaction', { windowId: 0, action: 1, accepted: true });
    t.fire();
    assert.deepEqual(logs, []);
    bot._client.write('window_click', clickPacket(39, 2));
    bot._client.emit('transaction', { windowId: 0, action: 2, accepted: false });
    t.fire(); // the resend never came
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^click rejected: window 0 slot 39 \(mode 0, button 0, action 2\); client before the click: slot -, cursor -, grid \[-, -, -, -\]; server: no resend within 1000 ms$/);
    bot.inventory.selectedItem = new Item(STICK, 3);
    bot._client.write('window_click', clickPacket(4, 3, 0, 1));
    bot._client.emit('transaction', { windowId: 0, action: 3, accepted: false });
    const items = new Array(46).fill(EMPTY);
    items[4] = notch(STICK, 1);
    bot._client.emit('window_items', { windowId: 0, items });
    t.fire(); // no cursor packet within cursorMs
    assert.equal(logs[1], 'click rejected: window 0 slot 4 (mode 0, button 1, action 3); client before the click: slot -, cursor stick x3, grid [-, -, -, -]; server after it: slot stick x1, cursor (not resent), grid [-, -, -, stick x1]');
});

test('a rejection for a click it did not see, another window, and the line cap', () => {
    const { bot, t } = fakeBot();
    const logs = [];
    attachClickDiagnostics(bot, { log: (m) => logs.push(m), setTimer: t.setTimer, clearTimer: t.clearTimer, maxLines: 2 });
    bot._client.emit('transaction', { windowId: 0, action: 99, accepted: false });
    t.fire();
    assert.match(logs[0], /^click rejected: window 0 slot \? \(mode \?, button \?, action 99\); client before the click: not recorded; server: no resend/);
    // A crafting table (window 5): no grid in the line; a resend for window 0 is not its resend.
    bot.currentWindow = { id: 5, slots: new Array(46).fill(null), selectedItem: null };
    bot._client.write('window_click', { windowId: 5, slot: 0, mouseButton: 0, action: 100, mode: 0, item: null });
    bot._client.emit('transaction', { windowId: 5, action: 100, accepted: false });
    bot._client.emit('window_items', { windowId: 0, items: new Array(46).fill(EMPTY) });
    bot._client.emit('window_items', { windowId: 5, items: new Array(46).fill(EMPTY) });
    bot._client.emit('set_slot', { windowId: -1, slot: -1, item: EMPTY });
    assert.equal(logs[1], 'click rejected: window 5 slot 0 (mode 0, button 0, action 100); client before the click: slot -, cursor -; server after it: slot -, cursor -');
    assert.equal(logs[2], 'click rejected: 2 lines logged; further rejections on this connection are not');
    bot._client.emit('transaction', { windowId: 0, action: 101, accepted: false });
    t.fire();
    assert.equal(logs.length, 3, 'capped');
});

test('describeItem and the line text', () => {
    assert.equal(describeItem(null), '-');
    assert.equal(describeItem(new Item(DIRT, 72, 1)), 'dirt:1 x72');
    assert.equal(describeItem({ type: 40000, count: 2 }), '#40000 x2');
    assert.equal(rejectedClickLine({ windowId: 0, slot: 1, mode: 0, button: 1, action: 7, client: null }, null, 500),
        'click rejected: window 0 slot 1 (mode 0, button 1, action 7); client before the click: not recorded; server: no resend within 500 ms');
});

// #618 review 2: through mineflayer 4.33's real bot.clickWindow. On 1.12 it writes window_click and
// applies the click to its own window only when the server accepts it (acceptClick in
// confirmTransaction). The line's "client before the click" depends on that order: were mineflayer
// to apply the click before writing it (as its 1.17+ path does), the view recorded at the write would
// already be the predicted one.
function realInventoryBot(respond) {
    const bot = new EventEmitter();
    bot.registry = registry;
    bot.version = '1.12.2';
    bot.supportFeature = (f) => registry.supportFeature(f);
    bot.QUICK_BAR_START = 36;
    bot.lastDigTime = null;
    bot.game = { gameMode: 'survival' };
    bot.writes = [];
    bot._client = new EventEmitter();
    bot._client.write = (name, params) => {
        bot.writes.push([name, params]);
        if (name === 'window_click') setImmediate(() => respond(bot, params));
    };
    require('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true });
    return bot;
}

test('#618 review 2: the real bot.clickWindow writes before it applies the click, so the line has the view the click was built on', async () => {
    const logs = [];
    const answers = [true, false]; // the first click accepted, the second rejected
    const bot = realInventoryBot((b, params) => {
        const accepted = answers.shift();
        b._client.emit('transaction', { windowId: 0, action: params.action, accepted });
        if (!accepted) {
            const items = new Array(46).fill(EMPTY);
            items[12] = notch(DIRT, 8); // the server did perform it: the dirt is in slot 12
            b._client.emit('window_items', { windowId: 0, items });
            b._client.emit('set_slot', { windowId: -1, slot: -1, item: EMPTY });
        }
    });
    attachClickDiagnostics(bot, { log: (m) => logs.push(m) });
    bot.inventory.updateSlot(11, new Item(DIRT, 8));

    // Accepted: picked up. mineflayer applies it on the confirm (the cursor holds the dirt afterwards).
    await bot.clickWindow(11, 0, 0);
    assert.equal(bot.inventory.selectedItem?.count, 8, 'applied after the server accepted it');
    assert.equal(bot.inventory.slots[11], null);
    assert.deepEqual(logs, []);
    const first = bot.writes.find(([n]) => n === 'window_click')[1];
    assert.equal(first.item?.blockId, DIRT, 'the clicked item sent is the slot as it was before the click');

    // Rejected: put down on slot 12. The line shows the view at the write (cursor: the 8 dirt, slot 12 empty).
    await assert.rejects(bot.clickWindow(12, 0, 0), /Server rejected transaction for clicking on slot 12/);
    assert.equal(logs.length, 1);
    const action = bot.writes.filter(([n]) => n === 'window_click')[1][1].action;
    assert.equal(logs[0], `click rejected: window 0 slot 12 (mode 0, button 0, action ${action}); client before the click: slot -, cursor dirt x8, grid [-, -, -, -]; server after it: slot dirt x8, cursor -, grid [-, -, -, -]`);
    assert.ok(bot.writes.some(([n, p]) => n === 'transaction' && p.action === action && p.accepted === true), 'mineflayer acknowledged the rejection');
});

test('#618 review 3: the resend and cursor timers do not keep the process alive', () => {
    const { bot } = fakeBot();
    const made = [];
    const setTimer = (fn, ms) => { const h = setTimeout(fn, ms); made.push(h); return h; };
    attachClickDiagnostics(bot, { log: () => {}, setTimer, clearTimer: clearTimeout });
    bot._client.write('window_click', clickPacket(11, 1));
    bot._client.emit('transaction', { windowId: 0, action: 1, accepted: false });
    bot._client.emit('window_items', { windowId: 0, items: new Array(46).fill(EMPTY) });
    assert.equal(made.length, 2, 'the 1 s resend timer and the 150 ms cursor timer');
    assert.ok(made.every((h) => h.hasRef() === false), 'both unref\'d');
    made.forEach(clearTimeout);
});
