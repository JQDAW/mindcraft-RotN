// G3 round 8 B: three equips of the stone pickaxe in a row were rejected at hotbar slots 36, 37 and
// 38; each resync showed the pickaxe on the cursor, and each "put the stone_pickaxe on the cursor
// into slot 9" was followed by the same rejection (evidence: #313, g3b-20261107-r8/night/driver.log
// lines 1020-1028). With a full hotbar, mineflayer 4.33's equip moves the item into its least
// recently used hotbar slot with three cursor clicks; the server rejected the put-down and kept the
// pickaxe on its cursor. Now an item goes from the main inventory to the hand with one number-key
// click (mode 2), and every try takes the item from where the window has it now.
// Offline: prismarine-windows' player window on the 1.12.2 registry, mineflayer 4.33's equip and
// moveSlotItem as far as a full hotbar goes, and a fake 1.12 server behind bot._client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import minecraftData from 'minecraft-data';
import prismarineWindows from 'prismarine-windows';
import prismarineItem from 'prismarine-item';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { guardInventory, currentItem } from './inventory_sync.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const windows = prismarineWindows(reg);
const Item = prismarineItem(reg);
const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };
const make = (name, count = 1, meta = 0) => new Item(reg.itemsByName[name].id, count, meta);
const same = (a, b) => (!a && !b) || (!!a && !!b && a.type === b.type && a.count === b.count && a.metadata === b.metadata);
const copy = (it) => (it ? new Item(it.type, it.count, it.metadata) : null);
const HOTBAR_ROUND8B = ['flint', 'log2', 'stick', 'planks', 'bread', 'dirt', 'cobblestone', 'wheat_seeds', 'log'];

/**
 * The bot (mineflayer's player window as local view) and a 1.12 server (its own slots and cursor).
 * The server applies every click first, then compares the client's view of the clicked slot with
 * what was there (NetHandlerPlayServer.processClickWindow); on a mismatch it rejects and resends the
 * window and its cursor. rejectHotbarPutDown: a put-down into a hotbar slot is rejected and changes
 * nothing, the cursor keeps its stack (what round 8 B showed). rejectNext: the next click is rejected
 * and not applied; moveOnReject(server) may then change the server's slots before the resend.
 */
function botAndServer({ pickaxeAt = 20, hotbar = HOTBAR_ROUND8B } = {}) {
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.registry = reg;
    bot.version = '1.12.2';
    bot.inventory = windows.createWindow(0, 'minecraft:inventory', 'Inventory');
    const server = { slots: new Array(46).fill(null), cursor: null, rejectHotbarPutDown: true, rejectNext: false, moveOnReject: null };
    const put = (k, it) => { server.slots[k] = it; bot.inventory.updateSlot(k, copy(it)); };
    hotbar.forEach((name, i) => put(36 + i, name ? make(name, name === 'bread' ? 1 : 16) : null));
    put(pickaxeAt, make('stone_pickaxe'));
    bot.quickBarSlot = 0;
    bot.heldItem = bot.inventory.slots[36];
    bot.setQuickBarSlot = (k) => { bot.quickBarSlot = k; bot.heldItem = bot.inventory.slots[36 + k]; };
    bot.clicks = [];
    bot.clickWindow = async (slot, mouseButton, mode) => {
        bot.clicks.push([slot, mouseButton, mode]);
        await Promise.resolve(); // the server answers a click later
        const claimed = mode === 2 ? null : bot.inventory.slots[slot];
        let result = null;
        const before = server.slots[slot];
        if (server.rejectNext) result = make('dirt', 99); // a click the server rejects and does not apply (the test's stand-in)
        else if (mode === 2) { // number key: swap with hotbar slot mouseButton; the server returns an empty stack
            [server.slots[slot], server.slots[36 + mouseButton]] = [server.slots[36 + mouseButton], server.slots[slot]];
        } else if (mode === 0) {
            result = copy(before);
            const hotbarPutDown = slot >= 36 && slot <= 44 && server.cursor;
            if (!(hotbarPutDown && server.rejectHotbarPutDown)) {
                if (!server.cursor) { server.cursor = before; server.slots[slot] = null; }
                else { server.slots[slot] = server.cursor; server.cursor = before; }
            }
            if (hotbarPutDown && server.rejectHotbarPutDown) result = make('dirt', 99); // what round 8 B's server answered: not what the client had
        }
        const accepted = !server.rejectNext && same(claimed, result);
        if (accepted) {
            bot.inventory.acceptClick({ slot, mouseButton, mode, item: bot.inventory.slots[slot] });
            return;
        }
        server.rejectNext = false;
        server.moveOnReject?.(server);
        // The resend: mineflayer applies the window (window_items), then the cursor packet.
        for (let k = 0; k < 46; k++) bot.inventory.updateSlot(k, copy(server.slots[k]));
        bot._client.emit('window_items', { windowId: 0, items: [] });
        bot._client.emit('set_slot', { windowId: -1, slot: -1, item: Item.toNotch(server.cursor) });
        throw new Error(`Server rejected transaction for clicking on slot ${slot}, on window with id 0.`);
    };
    // mineflayer 4.33, simple_inventory.js equip and inventory.js moveSlotItem, as far as these go.
    let nextQuickBarSlot = 0;
    bot.moveSlotItem = async (source, dest) => {
        await bot.clickWindow(source, 0, 0);
        await bot.clickWindow(dest, 0, 0);
        if (bot.inventory.selectedItem) await bot.clickWindow(source, 0, 0);
    };
    bot.equip = async (item, destination = 'hand') => {
        const sourceSlot = item.slot;
        let destSlot = 36 + bot.quickBarSlot;
        if (sourceSlot === destSlot) return;
        if (destination !== 'hand') { await bot.moveSlotItem(sourceSlot, destSlot); return; }
        if (sourceSlot >= 36 && sourceSlot < 45) { bot.setQuickBarSlot(sourceSlot - 36); return; }
        destSlot = [...Array(9).keys()].map(i => 36 + i).find(k => !bot.inventory.slots[k]) ?? null;
        if (destSlot == null) { destSlot = 36 + nextQuickBarSlot; nextQuickBarSlot = (nextQuickBarSlot + 1) % 9; }
        bot.setQuickBarSlot(destSlot - 36);
        await bot.moveSlotItem(sourceSlot, destSlot);
    };
    return { bot, server };
}

test('round 8 B: with a full hotbar, equip to the hand is one number-key swap (mode 2): no cursor, no put-down, the pickaxe in hand', async (t) => {
    quiet(t);
    const { bot, server } = botAndServer();
    guardInventory(bot);
    await bot.equip(bot.inventory.slots[20], 'hand');
    assert.deepEqual(bot.clicks, [[20, 0, 2]], 'one click: slot 20 swapped with hotbar slot 0 (the selected one)');
    assert.equal(bot.heldItem?.name, 'stone_pickaxe');
    assert.equal(server.slots[36]?.name, 'stone_pickaxe', 'the server agrees');
    assert.equal(server.slots[20]?.name, 'flint', 'what was in that hotbar slot went to slot 20');
    assert.equal(server.cursor, null);
    assert.equal(bot.inventory.selectedItem, null);
});

test('round 8 B: an empty hotbar slot is used first; an item already in the hotbar is only selected', async (t) => {
    quiet(t);
    const hotbar = [...HOTBAR_ROUND8B];
    hotbar[4] = null; // slot 40 empty
    const { bot, server } = botAndServer({ hotbar });
    guardInventory(bot);
    await bot.equip(bot.inventory.slots[20], 'hand');
    assert.deepEqual(bot.clicks, [[20, 4, 2]]);
    assert.equal(bot.quickBarSlot, 4);
    assert.equal(server.slots[40]?.name, 'stone_pickaxe');
    assert.equal(server.slots[20], null);

    await bot.equip(bot.inventory.slots[38], 'hand'); // the sticks, in the hotbar
    assert.deepEqual(bot.clicks.length, 1, 'no click');
    assert.equal(bot.heldItem?.name, 'stick');
});

test('round 8 B: the retry after a rejection takes the item from where the window has it now, not the stale slot', async (t) => {
    quiet(t);
    const { bot, server } = botAndServer();
    server.rejectNext = true;
    server.rejectHotbarPutDown = false;
    // Meanwhile the server has the pickaxe in slot 25 (the resend shows it there).
    server.moveOnReject = (s) => { s.slots[25] = s.slots[20]; s.slots[20] = null; };
    guardInventory(bot);
    const stale = bot.inventory.slots[20];
    await bot.equip(stale, 'hand');
    assert.deepEqual(bot.clicks, [[20, 0, 2], [25, 0, 2]]);
    assert.equal(bot.heldItem?.name, 'stone_pickaxe');
    assert.equal(server.slots[36]?.name, 'stone_pickaxe');
});

test('currentItem: the same slot while it holds that stack, else the same stack elsewhere, else the same kind', () => {
    const { bot } = botAndServer();
    const pick = bot.inventory.slots[20];
    assert.equal(currentItem(bot, pick), pick);
    bot.inventory.updateSlot(25, copy(pick));
    bot.inventory.updateSlot(20, null);
    assert.equal(currentItem(bot, pick)?.slot, 25);
    bot.inventory.updateSlot(25, make('stone_pickaxe', 1, 7)); // used: its damage changed
    assert.equal(currentItem(bot, pick)?.slot, 25);
    bot.inventory.updateSlot(25, null);
    assert.equal(currentItem(bot, pick), null);
});
