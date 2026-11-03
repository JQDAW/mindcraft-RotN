// A minimal server-side model of 1.12.2 containers for the offline end-to-end tests:
// the player inventory (2x2 grid) and RotN's FastWorkbench crafting table, block
// placing and eating. It follows the vanilla and Forge code read with javap
// (minecraft_server.1.12.2.jar, Forge 14.23.5.2860, FastWorkbench 1.7.4):
//
// - processClickWindow: slotClick first; then compare the client's clicked item with
//   the stack slotClick returns (for PICKUP, the slot's stack before the click). Equal:
//   transaction accepted. Not equal: transaction rejected, the window is resent, and
//   clicks in it are ignored until the client confirms that action (pendingTransactions).
// - a crafting-grid change sends set_slot for the result slot 0 during slotClick, so
//   it comes before the transaction.
// - FastWorkbench opens with FML OpenGui (gui 0), then window_items for that window.
//
// Only what bot.craft, bot.placeBlock, bot.activateBlock and bot.consume use is modelled:
// click mode 0 (left and right button). Any other mode is rejected and recorded.
// Max stack sizes come from opts.maxStack (64 otherwise); NBT is not modelled.
// This is a model, not a server: the live probe batch is still the proof.

import { encodeOpenGui } from '../src/channels.js';

const DEFAULT_MAX_STACK = 64;
const EMPTY = { blockId: -1 };

const stack = (id, count = 1, meta = 0) => ({ id, count, meta });
const copy = (s) => (s ? { ...s } : null);
const toWire = (s) => (s ? { blockId: s.id, itemCount: s.count, itemDamage: s.meta } : EMPTY);
const fromWire = (w) => (!w || w.blockId === -1 ? null : stack(w.blockId, w.itemCount, w.itemDamage));
const same = (a, b) => (!a && !b) || (a && b && a.id === b.id && a.count === b.count && a.meta === b.meta);

export { stack };

/**
 * @param {import('minecraft-protocol').ServerClient} client
 * @param {{ recipes: Array<{shaped?: (number|null)[][], shapeless?: number[], result: {id:number,count?:number,meta?:number}}>,
 *           blocks: Record<number, number>, foods: Record<number, number>, table: {x:number,y:number,z:number},
 *           inventory: Record<number, {id:number,count:number,meta?:number}>, placeDelayMs?: number, entityId?: number }} opts
 *   blocks: item id -> block id that placing it sets; foods: item id -> food points.
 */
export function attachFakeContainers(client, opts) {
    const { recipes, blocks, foods, table, placeDelayMs = 0, entityId = 1, food = 20, maxStack = {} } = opts;
    // Item max stack size (tools are 1 on a real server), DEFAULT_MAX_STACK otherwise.
    const max = (id) => maxStack[id] ?? DEFAULT_MAX_STACK;
    const inv = Array(46).fill(null); // ContainerPlayer: 0 result, 1-4 grid, 5-8 armour, 9-35 main, 36-44 hotbar, 45 offhand
    for (const [slot, s] of Object.entries(opts.inventory ?? {})) inv[Number(slot)] = stack(s.id, s.count, s.meta ?? 0);
    const state = {
        inv, cursor: null, held: 0, food, table: table ? { ...table } : null, noiseNext: null,
        tableWindow: null, // { id, grid: Array(10) } while FastWorkbench is open
        pending: null, // { windowId, action } after a rejected click
        clicks: [], rejected: [], ignored: [], unsupported: [], placed: [], uses: [], closed: [],
    };
    let nextWindowId = 0;

    // Slot access per window. FastWorkbench: 0 result, 1-9 grid, 10-45 = player slots 9-44.
    function grid(windowId) { return windowId === 0 ? inv : state.tableWindow.grid; }
    function get(windowId, slot) {
        if (windowId === 0 || slot <= 9) return grid(windowId)[slot];
        return inv[slot - 1];
    }
    function set(windowId, slot, s) {
        if (windowId === 0 || slot <= 9) grid(windowId)[slot] = s && s.count > 0 ? s : null;
        else inv[slot - 1] = s && s.count > 0 ? s : null;
    }
    const gridSize = (windowId) => (windowId === 0 ? 2 : 3);
    function gridCells(windowId) {
        const n = gridSize(windowId);
        return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => get(windowId, 1 + x + n * y)));
    }

    function match(windowId) {
        const cells = gridCells(windowId);
        const filled = cells.flat().filter(Boolean);
        for (const r of recipes) {
            if (r.shapeless) {
                const want = [...r.shapeless].sort();
                const have = filled.map(s => s.id).sort();
                if (want.length === have.length && want.every((v, i) => v === have[i])) return r;
                continue;
            }
            // Shaped: trim the grid to its filled bounding box, then compare (no mirroring).
            const ys = cells.map((row, y) => (row.some(Boolean) ? y : null)).filter(v => v !== null);
            const xs = [...new Set(cells.flatMap(row => row.map((s, x) => (s ? x : null)).filter(v => v !== null)))];
            if (!ys.length) continue;
            const [y0, y1, x0, x1] = [Math.min(...ys), Math.max(...ys), Math.min(...xs), Math.max(...xs)];
            if (y1 - y0 + 1 !== r.shaped.length || x1 - x0 + 1 !== r.shaped[0].length) continue;
            let ok = true;
            for (let y = 0; y < r.shaped.length && ok; y++) {
                for (let x = 0; x < r.shaped[0].length && ok; x++) {
                    const want = r.shaped[y][x];
                    const have = cells[y0 + y][x0 + x];
                    ok = want === null ? !have : have?.id === want;
                }
            }
            if (ok) return r;
        }
        return null;
    }

    function updateResult(windowId) {
        const r = match(windowId);
        const result = r ? stack(r.result.id, r.result.count ?? 1, r.result.meta ?? 0) : null;
        if (!same(grid(windowId)[0], result)) {
            grid(windowId)[0] = result;
            client.write('set_slot', { windowId, slot: 0, item: toWire(result) });
        }
    }

    function windowItems(windowId) {
        // Both windows have 46 slots: 9 crafting + armour/offhand or 10 + 36 player slots.
        return Array.from({ length: 46 }, (_, s) => toWire(get(windowId, s)));
    }

    // Container.slotClick, PICKUP (mode 0) only. Returns the stack it reports back.
    function slotClick(windowId, slot, button) {
        const gridEnd = windowId === 0 ? 4 : 9;
        if (slot === -999) {
            if (state.cursor) { if (button === 0) state.cursor = null; else { state.cursor.count--; if (!state.cursor.count) state.cursor = null; } }
            return null;
        }
        const before = copy(get(windowId, slot));
        if (slot === 0) { // the crafting result: take it all, or add it to a matching cursor
            const res = get(windowId, 0);
            if (res && (!state.cursor || (state.cursor.id === res.id && state.cursor.meta === res.meta && state.cursor.count + res.count <= max(res.id)))) {
                state.cursor = state.cursor ? { ...state.cursor, count: state.cursor.count + res.count } : copy(res);
                for (let s = 1; s <= gridEnd; s++) { const g = get(windowId, s); if (g) set(windowId, s, { ...g, count: g.count - 1 }); }
                grid(windowId)[0] = null;
                updateResult(windowId);
            }
            return before;
        }
        const s = get(windowId, slot);
        const c = state.cursor;
        const sameItem = s && c && s.id === c.id && s.meta === c.meta;
        if (button === 0) {
            if (!c && s) { state.cursor = s; set(windowId, slot, null); } else if (c && !s) { set(windowId, slot, c); state.cursor = null; } else if (sameItem) {
                const moved = Math.min(max(s.id) - s.count, c.count);
                set(windowId, slot, { ...s, count: s.count + moved });
                state.cursor = c.count - moved ? { ...c, count: c.count - moved } : null;
            } else if (c && s) { set(windowId, slot, c); state.cursor = s; }
        } else {
            if (!c && s) { const take = Math.ceil(s.count / 2); state.cursor = { ...s, count: take }; set(windowId, slot, { ...s, count: s.count - take }); } else if (c && (!s || (sameItem && s.count < max(s.id)))) {
                set(windowId, slot, s ? { ...s, count: s.count + 1 } : { ...c, count: 1 });
                state.cursor = c.count > 1 ? { ...c, count: c.count - 1 } : null;
            } else if (c && s) { set(windowId, slot, c); state.cursor = s; }
        }
        if (slot >= 1 && slot <= gridEnd) updateResult(windowId);
        return before;
    }

    client.on('window_click', (p) => {
        state.clicks.push(p);
        // processClickWindow only acts on the open container: while the table is open, a
        // window-0 click is dropped silently (no transaction), as on a real server.
        const open = state.tableWindow ? p.windowId === state.tableWindow.id : p.windowId === 0;
        if (!open || (state.pending && state.pending.windowId === p.windowId)) { state.ignored.push(p); return; }
        if (p.mode !== 0) {
            state.unsupported.push(p);
            client.write('transaction', { windowId: p.windowId, action: p.action, accepted: false });
            state.pending = { windowId: p.windowId, action: p.action };
            return;
        }
        const returned = slotClick(p.windowId, p.slot, p.mouseButton);
        if (same(fromWire(p.item), returned)) {
            client.write('transaction', { windowId: p.windowId, action: p.action, accepted: true });
        } else {
            state.rejected.push({ click: p, server: returned });
            state.pending = { windowId: p.windowId, action: p.action };
            client.write('transaction', { windowId: p.windowId, action: p.action, accepted: false });
            client.write('window_items', { windowId: p.windowId, items: windowItems(p.windowId) });
            client.write('set_slot', { windowId: -1, slot: -1, item: toWire(state.cursor) });
        }
    });

    client.on('transaction', (p) => {
        if (state.pending && p.windowId === state.pending.windowId && p.action === state.pending.action) state.pending = null; // processConfirmTransaction does not read 'accepted'
    });

    client.on('held_item_slot', (p) => { state.held = p.slotId; });

    client.on('close_window', (p) => {
        state.closed.push(p.windowId);
        if (state.tableWindow && p.windowId === state.tableWindow.id) {
            state.closedTableGrid = state.tableWindow.grid.slice(1).filter(Boolean).length;
            state.tableWindow = null;
        }
    });

    client.on('block_place', (p) => {
        const at = p.location;
        const table = state.table;
        if (table && at.x === table.x && at.y === table.y && at.z === table.z) { // BlockFastBench.onBlockActivated
            nextWindowId = (nextWindowId % 100) + 1;
            state.tableWindow = { id: nextWindowId, grid: Array(10).fill(null) };
            client.write('custom_payload', { channel: 'FML', data: encodeOpenGui({ windowId: nextWindowId, modId: 'fastbench', modGuiId: 0, ...table }) });
            client.write('window_items', { windowId: nextWindowId, items: windowItems(nextWindowId) });
            client.write('set_slot', { windowId: -1, slot: -1, item: toWire(state.cursor) });
            return;
        }
        const heldSlot = 36 + state.held;
        const item = inv[heldSlot];
        const blockId = item && blocks[item.id];
        if (blockId === undefined) return;
        const face = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][p.direction];
        const target = { x: at.x + face[0], y: at.y + face[1], z: at.z + face[2] };
        inv[heldSlot] = item.count > 1 ? { ...item, count: item.count - 1 } : null;
        // An unrelated update to the same block first (a test hook, used once): the client must not
        // take it for the placement.
        if (state.noiseNext !== null && state.noiseNext !== undefined) {
            client.write('block_change', { location: target, type: state.noiseNext << 4 });
            state.noiseNext = null;
        }
        const sent = Date.now();
        setTimeout(() => {
            client.write('block_change', { location: target, type: blockId << 4 });
            client.write('set_slot', { windowId: 0, slot: heldSlot, item: toWire(inv[heldSlot]) });
            state.placed.push({ target, blockId, delayMs: Date.now() - sent });
        }, placeDelayMs);
    });

    client.on('use_item', (p) => {
        state.uses.push(p);
        const heldSlot = 36 + state.held;
        const item = inv[heldSlot];
        const points = item && foods[item.id];
        if (p.hand !== 0 || points === undefined || state.food >= 20) return;
        setTimeout(() => { // 32 ticks in vanilla; shortened here
            inv[heldSlot] = item.count > 1 ? { ...item, count: item.count - 1 } : null;
            state.food = Math.min(20, state.food + points);
            client.write('entity_status', { entityId, entityStatus: 9 });
            client.write('set_slot', { windowId: 0, slot: heldSlot, item: toWire(inv[heldSlot]) });
            client.write('update_health', { health: 20, food: state.food, foodSaturation: 5 });
        }, 100);
    });

    return {
        state,
        windowItems,
        /** Send the player's inventory window (as at login). */
        sendInventory() {
            client.write('window_items', { windowId: 0, items: windowItems(0) });
            client.write('update_health', { health: 20, food: state.food, foodSaturation: 5 });
        },
        /** Change the food level (update_health), as hunger would. */
        setFood(n) { state.food = n; client.write('update_health', { health: 20, food: n, foodSaturation: 0 }); },
        count(id, meta = -1) { return inv.slice(9, 45).reduce((n, s) => n + (s?.id === id && (meta === -1 || s.meta === meta) ? s.count : 0), 0); },
        /** /give: merge into matching stacks, then the first empty hotbar slot, then the main inventory (vanilla order). */
        give(id, count, meta = 0) {
            let left = count;
            const slots = [...Array(9).keys()].map(i => 36 + i).concat([...Array(27).keys()].map(i => 9 + i));
            for (const s of slots) {
                const st = inv[s];
                if (left && st && st.id === id && st.meta === meta && st.count < max(id)) {
                    const n = Math.min(left, max(id) - st.count);
                    inv[s] = { ...st, count: st.count + n };
                    left -= n;
                    client.write('set_slot', { windowId: 0, slot: s, item: toWire(inv[s]) });
                }
            }
            for (const s of slots) {
                if (left && !inv[s]) {
                    const n = Math.min(left, max(id));
                    inv[s] = stack(id, n, meta);
                    left -= n;
                    client.write('set_slot', { windowId: 0, slot: s, item: toWire(inv[s]) });
                }
            }
            return count - left;
        },
        /** /clear without an item: empty the inventory; returns how many items were removed. */
        clearAll() {
            let n = 0;
            for (let s = 0; s < inv.length; s++) if (inv[s]) { n += inv[s].count; inv[s] = null; }
            client.write('window_items', { windowId: 0, items: windowItems(0) });
            return n;
        },
        /** Move RotN's crafting table (a setblock of minecraft:crafting_table). */
        setTable(pos) { state.table = pos ? { ...pos } : null; },
    };
}
