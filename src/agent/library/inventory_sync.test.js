// G3 round 7 B: the cursor kept as the server says, cleared before each inventory operation, and
// one rejected click answered with a resync and one more try. Offline: a fake 1.12 server behind
// bot._client and mineflayer's player window (slots 9-44, the cursor as selectedItem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import minecraftData from 'minecraft-data';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { followServerCursor, clearCursor, guardInventory, isRejectedClick, RESYNC_MS } from './inventory_sync.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const REJECTED = 'Server rejected transaction for clicking on slot 16, on window with id 0.';
const item = (name, count = 1, slot = null) => ({ name, count, type: reg.itemsByName[name].id, metadata: 0, slot });
const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };

/** mineflayer's player window as far as these operations touch it, and a 1.12 server behind _client. */
function invBot({ cursor = null, full = false } = {}) {
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.registry = reg;
    bot.version = '1.12.2';
    const slots = new Array(46).fill(null);
    if (full) for (let k = 9; k < 45; k++) slots[k] = item('dirt', 64, k);
    slots[16] = item('stone_sword', 1, 16);
    bot.inventory = {
        slots, selectedItem: cursor,
        firstEmptyInventorySlot() { for (let k = 9; k < 45; k++) if (!slots[k]) return k; return null; },
        items: () => slots.slice(9, 45).filter(Boolean),
    };
    bot.clicks = [];
    bot.dropped = [];
    // A left click puts the cursor stack down; outside the window (-999) it drops it.
    bot.clickWindow = (slot) => {
        bot.clicks.push(slot);
        if (slot === -999) bot.dropped.push(bot.inventory.selectedItem?.name);
        else slots[slot] = bot.inventory.selectedItem;
        bot.inventory.selectedItem = null;
        return Promise.resolve();
    };
    /** What a 1.12 server sends after it rejects a click: the whole window, then its cursor. */
    bot.resend = (cursorId = -1) => {
        bot._client.emit('window_items', { windowId: 0, items: [] });
        bot._client.emit('set_slot', { windowId: -1, slot: -1, item: cursorId < 0 ? { blockId: -1 } : { blockId: cursorId, itemCount: 3, itemDamage: 0 } });
    };
    return bot;
}

test('G3 round 7 B: the server\'s cursor packet (window -1, slot -1), which mineflayer ignores, sets the cursor', () => {
    const bot = invBot({ cursor: item('stick', 3) }); // what mineflayer believed after the death
    followServerCursor(bot);
    bot._client.emit('set_slot', { windowId: 0, slot: 36, item: { blockId: -1 } });
    assert.equal(bot.inventory.selectedItem?.name, 'stick', 'another slot: not the cursor');
    bot.resend(); // the server: nothing on the cursor
    assert.equal(bot.inventory.selectedItem, null);
    bot.resend(reg.itemsByName.wheat_seeds.id);
    assert.deepEqual([bot.inventory.selectedItem?.name, bot.inventory.selectedItem?.count], ['wheat_seeds', 3]);
    assert.equal(bot.rotnInventorySync.resent, 2);
});

test('G3 round 7 B: before an equip the cursor stack goes into a free slot, or is dropped when there is none', async (t) => {
    quiet(t);
    const bot = invBot({ cursor: item('stick', 3) });
    assert.equal(await clearCursor(bot), 'put the stick on the cursor into slot 9');
    assert.equal(bot.inventory.slots[9].name, 'stick');
    assert.equal(await clearCursor(bot), null, 'an empty cursor: no click');
    assert.deepEqual(bot.clicks, [9]);

    const full = invBot({ cursor: item('stick', 3), full: true });
    full.output = '';
    guardInventory(full);
    full.equip = (it) => { full.heldItem = it; return Promise.resolve(); };
    guardInventory(full); // equip came later (mineflayer's plugins): wrapped now
    await full.equip(full.inventory.slots[16], 'hand');
    assert.deepEqual(full.clicks, [-999]);
    assert.deepEqual(full.dropped, ['stick']);
    assert.equal(full.output, 'Dropped the stick on the cursor: no free slot for it.\n', "in the bot's own log (#296 nit)");
    assert.equal(full.heldItem.name, 'stone_sword');
});

test('G3 round 7 B replay: a stale cursor and a rejected equip click: the cursor is put down, the rejection resyncs, the second try holds the sword', async (t) => {
    quiet(t);
    const bot = invBot({ cursor: item('stick', 3) });
    let tries = 0;
    bot.equip = (it) => {
        tries++;
        if (tries === 1) { setTimeout(() => bot.resend(), 30); return Promise.reject(new Error(REJECTED)); } // the resend comes a moment later
        bot.heldItem = it;
        return Promise.resolve();
    };
    guardInventory(bot);
    const started = Date.now();
    await bot.equip(bot.inventory.slots[16], 'hand');
    assert.equal(tries, 2);
    assert.equal(bot.heldItem.name, 'stone_sword');
    assert.deepEqual(bot.clicks, [9], 'the cursor stack was put down before the first try');
    assert.ok(Date.now() - started < RESYNC_MS, 'it went on when the resend came, not at the time limit');

    // The cursor packet a moment after the resent window: the resync waits for it, so the stack the
    // server put on the cursor is put down before the second try.
    const split = invBot();
    tries = 0;
    split.equip = (it) => {
        tries++;
        if (tries === 1) {
            split._client.emit('window_items', { windowId: 0, items: [] });
            setTimeout(() => split._client.emit('set_slot', { windowId: -1, slot: -1, item: { blockId: reg.itemsByName.wheat_seeds.id, itemCount: 1, itemDamage: 0 } }), 50);
            return Promise.reject(new Error(REJECTED));
        }
        split.heldItem = it;
        return Promise.resolve();
    };
    guardInventory(split);
    await split.equip(split.inventory.slots[16], 'hand');
    assert.deepEqual(split.clicks, [9]);
    assert.equal(split.inventory.slots[9].name, 'wheat_seeds');

    // A second rejection is the caller's (after one resync); other errors are not retried.
    const stubborn = invBot();
    let calls = 0;
    stubborn.equip = () => { calls++; stubborn.resend(); return Promise.reject(new Error(REJECTED)); };
    guardInventory(stubborn);
    await assert.rejects(stubborn.equip(stubborn.inventory.slots[16], 'hand'), /Server rejected transaction/);
    assert.equal(calls, 2);
    const other = invBot();
    calls = 0;
    other.equip = () => { calls++; return Promise.reject(new Error('Invalid destination: elbow')); };
    guardInventory(other);
    await assert.rejects(other.equip(other.inventory.slots[16], 'elbow'), /elbow/);
    assert.equal(calls, 1);
    assert.equal(isRejectedClick(new Error("Server didn't respond to transaction for clicking on slot 36 on window with id 0.")), true);
});

test('G3 round 7 B: an operation run by a guarded one (equip runs moveSlotItem) is not retried inside it; two at once are each guarded', async (t) => {
    quiet(t);
    const bot = invBot();
    let moves = 0;
    bot.moveSlotItem = () => { moves++; if (moves === 1) { bot.resend(); return Promise.reject(new Error(REJECTED)); } return Promise.resolve(); };
    bot.equip = async (it) => { await bot.moveSlotItem(it.slot, 36); bot.heldItem = it; };
    guardInventory(bot);
    await bot.equip(bot.inventory.slots[16], 'hand');
    assert.equal(moves, 2, 'one retry, by equip; moveSlotItem inside it is not retried on its own');
    assert.equal(bot.heldItem.name, 'stone_sword');

    // Two operations started at once: each clears the cursor first.
    const two = invBot({ cursor: item('stick', 3) });
    two.toss = () => new Promise(resolve => setTimeout(resolve, 20));
    two.equip = () => Promise.resolve();
    guardInventory(two);
    const tossing = two.toss();
    two.inventory.selectedItem = item('wheat_seeds', 1); // a stack picked up meanwhile
    await Promise.all([tossing, two.equip(two.inventory.slots[16], 'hand')]);
    assert.deepEqual(two.clicks, [9, 10], 'the equip cleared its cursor too');

    // Wrapped once, on login and spawn too.
    const late = invBot();
    guardInventory(late);
    late.craft = () => Promise.resolve('crafted');
    late.emit('login');
    const wrapped = late.craft;
    late.emit('spawn');
    assert.equal(late.craft, wrapped);
    assert.equal(await late.craft(), 'crafted');
    assert.equal(late.listenerCount('login'), 1);
});
