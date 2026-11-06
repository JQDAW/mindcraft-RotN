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

import { AsyncLocalStorage } from 'node:async_hooks';
import prismarineItem from 'prismarine-item';

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
    return `dropped the ${held.name} on the cursor: no free slot`;
}

/**
 * Run an inventory operation with a clear cursor; when the server rejects (or never answers) one of
 * its clicks: resync, clear the cursor again and try once more. Its second failure is thrown.
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
        return await op();
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
            const guarded = function (...args) {
                if (insideGuard.getStore()) return original.apply(bot, args);
                return insideGuard.run(true, () => withCleanCursor(bot, name, () => original.apply(bot, args)));
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
