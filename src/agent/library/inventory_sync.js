// The inventory kept in step with the server (G3 round 7 B). A zombie attacked; self_defense's
// equip was rejected ("Server rejected transaction for clicking on slot 16, on window with id 0"),
// the error ended the fight, and the bot died without hitting back. After the respawn the cursor
// still held quark:tallow.
//
// mineflayer 4.33 ignores the server's cursor packet (set_slot for window -1, slot -1). A 1.12
// server sends that packet together with the whole window after it rejects a click, and on a
// respawn. So mineflayer's cursor can show a stack the server no longer has there, and the clicks
// built on that view are rejected. Here:
// - the cursor follows the server's packet (followServerCursor);
// - before an equip or another inventory operation, a stack on the cursor is put into a free slot,
//   or dropped when there is none (clearCursor);
// - a rejected or unanswered click is answered by waiting for the server's resend of the window
//   (the resync), clearing the cursor again, and one more try (guardInventory).
//
// G3 round 8 B: three equips of the stone pickaxe in a row were rejected at hotbar slots 36, 37 and
// 38, each resync showed the pickaxe on the cursor, and each "put the stone_pickaxe on the cursor
// into slot 9" was followed by the same rejection. The put-down did take: the next equip found the
// pickaxe in slot 9 and lifted it onto the cursor again. With a full hotbar, mineflayer 4.33's
// equip (simple_inventory.js) moves an item into its least recently used hotbar slot with
// moveSlotItem: pick up, put down (a swap with that slot's stack), put back. The server rejected
// that put-down and left the pickaxe on its cursor, every time. And the guard's retry ran equip with
// the same Item object, whose .slot was stale after the resync. So now (equipToHand):
// - an item in the main inventory goes to the hand with one number-key click (mode 2): the server
//   swaps it with a hotbar slot directly; no cursor, and the server checks no slot's contents
//   against the client's for it (1.12 returns an empty stack for a swap click);
// - every try, the retry included, takes the item from where the window has it now.

import { AsyncLocalStorage } from 'node:async_hooks';
import prismarineItem from 'prismarine-item';
// #657 review 5: every slot number from the one inventory view; this file is the window-click layer, the only one
// besides the view that touches slots (to move stacks).
import { SLOTS, GRID_SLOTS as VIEW_GRID } from './inventory_view.js';

/** How long a resync waits for the server to resend the window after a rejected click. */
export const RESYNC_MS = 1000;
/** How long the cursor packet may come after the resent window (a 1.12 server sends it right after). */
export const CURSOR_AFTER_MS = 150;
/** The bot's inventory operations that start from an empty cursor and click the window. */
export const GUARDED = ['equip', 'unequip', 'craft', 'toss', 'tossStack', 'moveSlotItem'];

const REJECTED = /Server rejected transaction|Server didn't respond to transaction/;
/** Whether the error is mineflayer's for a click the server rejected or never answered. */
export const isRejectedClick = (err) => REJECTED.test(String(err?.message ?? err ?? ''));

/** The window mineflayer's clicks act on: an open container, else the inventory. */
const clickedWindow = (bot) => bot.currentWindow || bot.inventory;

/**
 * Keep mineflayer's cursor (selectedItem) as the server says, and count the windows it resends.
 * Once per bot; needs bot._client.
 */
export function followServerCursor(bot) {
    const client = bot?._client;
    if (!client || bot.rotnInventorySync) return bot?.rotnInventorySync ?? null;
    // resent: windows the server sent; cursorAt: the value of resent when its cursor packet came.
    const sync = bot.rotnInventorySync = { resent: 0, cursorAt: -1 };
    let Item = null;
    client.on('set_slot', (packet) => {
        if (packet?.windowId !== -1 || packet?.slot !== -1) return;
        Item ??= prismarineItem(bot.registry ?? bot.version);
        const item = Item.fromNotch(packet.item);
        if (bot.inventory) bot.inventory.selectedItem = item;
        if (bot.currentWindow && bot.currentWindow !== bot.inventory) bot.currentWindow.selectedItem = item;
        sync.cursorAt = sync.resent;
    });
    client.on('window_items', () => { sync.resent++; });
    return sync;
}

/**
 * After a rejected click: wait (up to ms) for the window the server resends with it (one sent since
 * `since`, sync.resent before the click, counts), and for the cursor packet that follows it (up to
 * CURSOR_AFTER_MS more). Whether the window came.
 */
export function resync(bot, since, ms = RESYNC_MS) {
    const sync = bot?.rotnInventorySync;
    const client = bot?._client;
    if (!sync || !client) return Promise.resolve(false);
    const resent = () => sync.resent > since;
    if (resent() && sync.cursorAt >= sync.resent) return Promise.resolve(true);
    return new Promise((resolve) => {
        let grace = null;
        const done = (came) => {
            clearTimeout(timer);
            clearTimeout(grace);
            client.removeListener('window_items', onPacket);
            client.removeListener('set_slot', onPacket);
            resolve(came);
        };
        // Judged after the listeners that apply the packet (mineflayer's and followServerCursor's).
        const onPacket = () => setTimeout(() => {
            if (resent() && sync.cursorAt >= sync.resent) done(true);
            else if (resent()) grace ??= setTimeout(() => done(true), CURSOR_AFTER_MS);
        }, 0);
        const timer = setTimeout(() => done(resent()), ms);
        client.on('window_items', onPacket);
        client.on('set_slot', onPacket);
        onPacket(); // a window that came already, its cursor not yet
    });
}

/**
 * Put the stack on the cursor into a free slot of the window clicks act on, or drop it when there
 * is none. What it did, or null when the cursor was empty. `click`: mineflayer's clickWindow.
 */
export async function clearCursor(bot, click = (...a) => bot.clickWindow(...a)) {
    const window = clickedWindow(bot);
    const held = window?.selectedItem;
    if (!held) return null;
    const slot = window.firstEmptyInventorySlot?.() ?? null;
    if (slot != null) {
        await click(slot, 0, 0);
        return `put the ${held.name} on the cursor into slot ${slot}`;
    }
    await click(-999, 0, 0); // a click outside the window drops the cursor stack
    const line = `Dropped the ${held.name} on the cursor: no free slot for it.`;
    if (typeof bot.output === 'string') bot.output += line + '\n'; // the bot's own log (#296 nit), as skills.log
    return line;
}

/** The player window's hotbar (slots 36-44) and main inventory (9-35). */
const HOTBAR = SLOTS.HOTBAR_FROM, HOTBAR_END = SLOTS.USABLE_TO, MAIN = SLOTS.USABLE_FROM;
const sameKind = (a, b) => !!a && !!b && a.type === b.type;
const sameStack = (a, b) => sameKind(a, b) && (a.metadata ?? 0) === (b.metadata ?? 0)
    && JSON.stringify(a.nbt ?? null) === JSON.stringify(b.nbt ?? null);

/**
 * The item as the window has it now (round 8 B: a retry ran with a stale Item, its .slot from before
 * the resync): the same slot while it still holds that stack; else the first slot with the same
 * stack; else the first of the same kind (a tool's damage may have changed); else null. The hotbar
 * is searched first (#317 review: a copy there needs no click), then the main inventory, then the
 * off hand.
 */
export function currentItem(bot, item) {
    const slots = bot?.inventory?.slots;
    if (!item || typeof item !== 'object' || !Array.isArray(slots)) return item ?? null;
    if (sameStack(slots[item.slot], item)) return slots[item.slot];
    const range = (from, to) => [...Array(to - from + 1).keys()].map(i => i + from);
    const order = [...range(HOTBAR, HOTBAR_END), ...range(MAIN, HOTBAR - 1), SLOTS.OFF_HAND];
    return order.map(k => slots[k]).find(s => sameStack(s, item))
        ?? order.map(k => slots[k]).find(s => sameKind(s, item)) ?? null;
}

/**
 * equip(item, 'hand') for an item in the main inventory: one number-key click (mode 2) swaps it with
 * a hotbar slot (an empty one, else the selected one), then that slot is selected (round 8 B). Any
 * other case (another destination, an item already in the hotbar or an armor slot, an open
 * container, a bot without these functions, or a cursor the tidy could not clear: a number-key click
 * does nothing while the cursor holds a stack) is mineflayer's equip, with the item as it is now.
 * An item no longer in the inventory is an error, never the stale Item (#317 review).
 */
export async function equipToHand(bot, original, args) {
    const [arg, destination, ...rest] = args;
    const item = typeof arg === 'object' && arg ? currentItem(bot, arg) : arg;
    if (item === null) {
        const line = `the ${arg.name ?? 'item'} is no longer in the inventory`;
        console.warn(`[inventory] equip: ${line}`);
        throw new Error(`Cannot equip: ${line}.`);
    }
    const toHand = destination == null || destination === 'hand';
    const playerWindow = !bot.currentWindow || bot.currentWindow === bot.inventory;
    const canSwap = typeof bot.clickWindow === 'function' && typeof bot.setQuickBarSlot === 'function';
    const cursorClear = !bot.inventory?.selectedItem;
    if (!toHand || !playerWindow || !canSwap || !cursorClear || typeof item !== 'object' || !item || !(item.slot >= MAIN && item.slot < HOTBAR))
        return await original.apply(bot, [item, destination, ...rest]);
    const slots = bot.inventory.slots;
    let k = [...Array(9).keys()].find(i => !slots[HOTBAR + i]);
    if (k === undefined) k = Number.isInteger(bot.quickBarSlot) ? bot.quickBarSlot : 0;
    await bot.clickWindow(item.slot, k, 2);
    bot.setQuickBarSlot(k);
}

/**
 * Run an inventory operation with a clear cursor; when the server rejects (or never answers) one of
 * its clicks: resync, clear the cursor again and try once more. Its second failure is thrown (and
 * logged, round 8 B: the log did not say how a retry ended).
 */
export async function withCleanCursor(bot, label, op, { resyncMs = RESYNC_MS } = {}) {
    const tidy = async () => {
        const before = bot.rotnInventorySync?.resent ?? 0;
        try {
            const did = await clearCursor(bot);
            if (did) console.log(`[inventory] before ${label}: ${did}`);
        } catch (err) {
            if (!isRejectedClick(err)) throw err;
            console.warn(`[inventory] before ${label}: clearing the cursor failed (${err.message}); resyncing`);
            await resync(bot, before, resyncMs);
        }
    };
    await tidy();
    const since = bot.rotnInventorySync?.resent ?? 0;
    try {
        return await op();
    } catch (err) {
        if (!isRejectedClick(err)) throw err;
        console.warn(`[inventory] ${label}: ${err.message} Resyncing and trying once more.`);
        const came = await resync(bot, since, resyncMs);
        console.log(`[inventory] resync: ${came ? 'the server resent the window' : `no resend within ${resyncMs} ms`}; `
            + `cursor: ${clickedWindow(bot)?.selectedItem?.name ?? 'empty'}`);
        await tidy();
        // Soak 15 (N3): after a rejected click, a stack the server has in the 2x2 grid goes back first.
        try { await returnGrid(bot, `after a rejected click (${label})`); } catch (e) { console.warn(`[inventory] returning the grid failed: ${e?.message ?? e}`); }
        try {
            return await op();
        } catch (again) {
            console.warn(`[inventory] ${label}: the second try failed too: ${again?.message ?? again}`);
            throw again;
        }
    }
}

/**
 * Soak 15 (net-forge's N3, the lead): from 22:50 the server rejected window clicks (StackUp's stack sizes against
 * bot.registry's 64: net-forge's N1), and the failed crafts left their rocks in the 2x2 grid (slots 1-4). Crafting
 * reads inventory.items() (9-44), so for 10 min every cobble craft said "missing ingredient" and "you have no such
 * rocks" while !inventory listed 19-43 rocks. Nothing emptied the grid (withCleanCursor clears only the cursor).
 * Return the grid's stacks: the cursor first (closing window 0 drops the cursor stack), then the vanilla client's
 * close of window 0 (close_window, windowId 0, on the client; not bot.closeWindow, which treats the inventory as a
 * closed container), so the server puts the grid back (ContainerPlayer.onContainerClosed). No shift-clicks:
 * prismarine-windows cannot predict them. A line names what moved. Returns {moved, left} or null (nothing to do).
 */
export const GRID_SLOTS = VIEW_GRID;
export const GRID_WAIT = { ms: RESYNC_MS, stepMs: 50 };
export async function returnGrid(bot, why, { waitMs = GRID_WAIT.ms, stepMs = GRID_WAIT.stepMs } = {}) {
    const inv = bot?.inventory;
    const slots = inv?.slots;
    if (!Array.isArray(slots) || (bot.currentWindow && bot.currentWindow !== inv)) return null;
    const stacks = GRID_SLOTS.filter(k => slots[k]).map(k => ({ slot: k, name: slots[k].name, count: slots[k].count }));
    if (!stacks.length) return null;
    const named = stacks.map(g => `${g.count} ${g.name} (slot ${g.slot})`).join(', ');
    let cursor = '';
    if (inv.selectedItem) {
        const free = inv.firstEmptyInventorySlot?.();
        if (!(Number.isInteger(free) && free >= 0)) {
            console.warn(`[inventory] ${why}: ${named} left in the 2x2 grid, but the ${inv.selectedItem.name} on the cursor has no free slot (closing would drop it): not closing`);
            return { moved: [], left: stacks.map(g => g.slot) };
        }
        const did = await clearCursor(bot);
        if (did) cursor = `; first ${did}`;
        // #619 review 2: closing with a stack still on the cursor drops it: re-checked after the clear.
        if (inv.selectedItem) {
            console.warn(`[inventory] ${why}: ${named} left in the 2x2 grid, but the ${inv.selectedItem.name} is still on the cursor (closing would drop it): not closing`);
            return { moved: [], left: stacks.map(g => g.slot), dropped: [] };
        }
    }
    if (typeof bot._client?.write !== 'function') return { moved: [], left: stacks.map(g => g.slot), dropped: [] };
    // #619 review 3: with no room the server drops a grid stack (placeItemBackInInventory): what came back is what the
    // inventory gained of that item; the rest was dropped. The grid's slots are sent before the inventory's, so the
    // wait goes on until the gain is seen or the time is up.
    const held = (name) => slots.slice(SLOTS.USABLE_FROM, SLOTS.OFF_HAND + 1).reduce((n, s) => n + (s?.name === name ? s.count : 0), 0);
    const names = [...new Set(stacks.map(g => g.name))];
    const before = Object.fromEntries(names.map(n => [n, held(n)]));
    const want = Object.fromEntries(names.map(n => [n, stacks.filter(g => g.name === n).reduce((a, g) => a + g.count, 0)]));
    const gained = (n) => held(n) - before[n];
    bot._client.write('close_window', { windowId: 0 });
    const settled = () => !GRID_SLOTS.some(k => slots[k]) && names.every(n => gained(n) >= want[n]);
    for (let waited = 0; waited < waitMs && !settled(); waited += stepMs) await new Promise(r => setTimeout(r, stepMs));
    const left = GRID_SLOTS.filter(k => slots[k]);
    const gone = stacks.filter(g => !left.includes(g.slot));
    // Per item: what left the grid and was not gained was dropped (the later stacks of a name first).
    const back = Object.fromEntries(names.map(n => [n, Math.max(0, gained(n))]));
    const moved = [], dropped = [];
    for (const g of gone) {
        const b = Math.min(g.count, back[g.name]);
        back[g.name] -= b;
        if (b > 0) moved.push({ ...g, count: b });
        if (g.count - b > 0) dropped.push({ ...g, count: g.count - b });
    }
    console.log(`[inventory] ${why}: closed the inventory to return the 2x2 grid: ${named}${cursor}`
        + (dropped.length ? `; no room for ${dropped.map(g => `${g.count} ${g.name}`).join(', ')}: dropped on the ground` : '')
        + (left.length ? `; the grid is still not empty: slots ${left.join(', ')}` : ''));
    bot.rotnGridReturned = { at: Date.now(), moved, dropped };
    return { moved, left, dropped };
}
/** A craft in the 2x2 grid (no table): the grid emptied first, and again after it fails (net-forge's N3). */
async function craftWithCleanGrid(bot, original, args) {
    if (!args[2]) await returnGrid(bot, 'before a 2x2 craft');
    try {
        return await original.apply(bot, args);
    } catch (err) {
        try { await returnGrid(bot, `after a failed craft (${String(err?.message ?? err).slice(0, 80)})`); } catch { /* the error below matters */ }
        throw err;
    }
}

/** Set inside a guarded operation, so the operations it runs itself are not guarded again. */
const insideGuard = new AsyncLocalStorage();

/**
 * Wrap the bot's inventory operations (GUARDED) with withCleanCursor, and follow the server's
 * cursor. mineflayer adds those operations with its plugins, so this runs again on login and spawn;
 * each is wrapped once. An operation run by another one (equip runs moveSlotItem) is not guarded
 * again inside it; one started elsewhere at the same time is.
 */
export function guardInventory(bot) {
    if (!bot) return;
    const wrap = () => {
        followServerCursor(bot);
        for (const name of GUARDED) {
            const original = bot[name];
            if (typeof original !== 'function' || original.rotnGuarded) continue;
            // equip: a number-key swap into the hotbar, on the item as the window has it at each try.
            // craft (soak 15, N3): the 2x2 grid emptied before it and after a failure.
            const run = name === 'equip' ? (args) => equipToHand(bot, original, args)
                : name === 'craft' ? (args) => craftWithCleanGrid(bot, original, args)
                : (args) => original.apply(bot, args);
            const guarded = function (...args) {
                if (insideGuard.getStore()) return original.apply(bot, args);
                return insideGuard.run(true, () => withCleanCursor(bot, name, () => run(args)));
            };
            guarded.rotnGuarded = true;
            bot[name] = guarded;
        }
    };
    wrap();
    if (typeof bot.on === 'function' && !bot.rotnInventoryHooked) {
        bot.rotnInventoryHooked = true;
        bot.on('login', wrap);
        bot.on('spawn', wrap);
    }
}
