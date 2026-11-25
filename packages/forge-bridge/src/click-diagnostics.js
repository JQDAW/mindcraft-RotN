// A line for each window click the server rejects (soak 15, N2).
//
// A 1.12 server rejects a click when the stack the client says the slot held before the click is not
// the one the server had there (item, damage, count, NBT share tag). It still performs the click,
// then resends the whole window (window_items) and the cursor (set_slot window -1, slot -1). The
// cause is always earlier: an accepted click the client predicted wrongly, which the server never
// corrects (/home/rv/soak15-net-forge-clicks.md). mineflayer's error names only the slot. This line
// puts the client's view before the click next to the server's state after it, for the clicked
// slot, the cursor and (window 0) the 2x2 grid, so a soak shows what differed:
//
//   [forge-bridge] click rejected: window 0 slot 11 (mode 0, button 0, action 812); client before
//   the click: slot betterwithmods:dirt_pile x8, cursor -, grid [-, -, -, -]; server after it: slot -,
//   cursor -, grid [-, -, -, betterwithmods:dirt_pile x1]
//
// Read only: it records each window_click as it is written and watches the transaction, window_items
// and set_slot packets; it changes nothing the bot does.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ATTACHED = Symbol.for('mindcraft-rotn.clickDiagnostics');
export const CLICK_DIAG = { resendMs: 1000, cursorMs: 150, maxLines: 50, remembered: 64 };
const GRID = [1, 2, 3, 4];

/** "name:meta xcount", or "-" for an empty slot. */
export function describeItem(item) {
    if (!item || !item.name) return item && item.type != null && item.type >= 0 ? `#${item.type} x${item.count}` : '-';
    return `${item.name}${item.metadata ? `:${item.metadata}` : ''} x${item.count}`;
}

/** The line for one rejected click (`server` null: no resend came). */
export function rejectedClickLine(rec, server, resendMs = CLICK_DIAG.resendMs) {
    const head = `click rejected: window ${rec.windowId} slot ${rec.slot} (mode ${rec.mode}, button ${rec.button}, action ${rec.action})`;
    const view = (v) => `slot ${v.slot}, cursor ${v.cursor}${v.grid ? `, grid [${v.grid.join(', ')}]` : ''}`;
    const client = rec.client ? `client before the click: ${view(rec.client)}` : 'client before the click: not recorded';
    const srv = server ? `server after it: ${view(server)}` : `server: no resend within ${resendMs} ms`;
    return `${head}; ${client}; ${srv}`;
}

/**
 * Attach once per bot (its _client must exist). Returns { lines } (how many were logged).
 */
export function attachClickDiagnostics(bot, {
    log = (m) => console.log(`[forge-bridge] ${m}`), resendMs = CLICK_DIAG.resendMs, cursorMs = CLICK_DIAG.cursorMs,
    maxLines = CLICK_DIAG.maxLines, setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
    if (bot[ATTACHED]) return bot[ATTACHED];
    const report = { lines: 0, dropped: 0 };
    bot[ATTACHED] = report;
    const client = bot._client;
    const sent = new Map(); // action -> record, the last CLICK_DIAG.remembered clicks
    let pending = null; // { rec, server, timer }

    const windowOf = (id) => (id === 0 ? bot.inventory : (bot.currentWindow?.id === id ? bot.currentWindow : null));
    let Item = null;
    const fromNotch = (notch) => {
        try {
            Item ??= require('prismarine-item')(bot.registry ?? bot.version);
            return Item.fromNotch(notch);
        } catch { return notch && notch.blockId >= 0 ? { type: notch.blockId, count: notch.itemCount } : null; }
    };

    const write = client.write;
    client.write = function (name, params) {
        if (name === 'window_click' && params && params.action != null) {
            const w = windowOf(params.windowId);
            const rec = {
                windowId: params.windowId, slot: params.slot, mode: params.mode, button: params.mouseButton, action: params.action,
                client: w ? {
                    slot: params.slot === -999 ? '(outside)' : describeItem(w.slots?.[params.slot]),
                    cursor: describeItem(w.selectedItem),
                    grid: params.windowId === 0 ? GRID.map((i) => describeItem(w.slots?.[i])) : null,
                } : null,
            };
            sent.set(params.action, rec);
            if (sent.size > CLICK_DIAG.remembered) sent.delete(sent.keys().next().value);
        }
        return write.apply(this, arguments);
    };

    const flush = () => {
        if (!pending) return;
        const { rec, server, timer } = pending;
        pending = null;
        clearTimer(timer);
        if (report.lines >= maxLines) { report.dropped++; return; }
        report.lines++;
        log(rejectedClickLine(rec, server, resendMs));
        if (report.lines === maxLines) log(`click rejected: ${maxLines} lines logged; further rejections on this connection are not`);
    };

    client.on('transaction', (packet) => {
        if (!packet || packet.accepted !== false) return;
        flush(); // an earlier one still waiting for its resend
        const rec = sent.get(packet.action) ?? { windowId: packet.windowId, slot: '?', mode: '?', button: '?', action: packet.action, client: null };
        pending = { rec, server: null, timer: setTimer(() => flush(), resendMs) };
        pending.timer?.unref?.(); // #618 review 3: never what keeps the process alive
    });
    client.on('window_items', (packet) => {
        if (!pending || pending.server || packet?.windowId !== pending.rec.windowId) return;
        const items = packet.items ?? [];
        const at = (i) => describeItem(fromNotch(items[i]));
        pending.server = {
            slot: typeof pending.rec.slot === 'number' && pending.rec.slot >= 0 ? at(pending.rec.slot) : '(outside)',
            cursor: '(not resent)',
            grid: pending.rec.windowId === 0 ? GRID.map(at) : null,
        };
        clearTimer(pending.timer);
        pending.timer = setTimer(() => flush(), cursorMs); // the cursor packet follows at once
        pending.timer?.unref?.();
    });
    client.on('set_slot', (packet) => {
        if (!pending?.server || packet?.windowId !== -1 || packet?.slot !== -1) return;
        pending.server.cursor = describeItem(fromNotch(packet.item));
        flush();
    });
    bot.once?.('end', () => { if (pending) clearTimer(pending.timer); pending = null; });
    return report;
}
