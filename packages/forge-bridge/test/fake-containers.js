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
// Only what bot.craft, bot.placeBlock, bot.activateBlock, bot.consume and skills' equips use is
// modelled: click modes 0 (left and right button) and 2 (number key: Container.slotClick SWAP
// returns an empty stack, so the server accepts every such click and echoes nothing). Any other
// mode is rejected and recorded.
// Max stack sizes come from opts.maxStack (64 otherwise; dumpMaxStack gives the pack's StackUp
// sizes from rotn-data's dump); NBT is not modelled.
// close_window (fake-server task, item 2): NetHandlerPlayServer.processCloseWindow closes the open
// container whatever the packet's id (EntityPlayerMP.closeContainer, oq.r). For the player's own
// window, ContainerPlayer.onContainerClosed (agi.b) first runs Container.onContainerClosed (afr.b),
// which drops the cursor stack with no packet, clears the crafting result (no packet), then
// clearContainer (afr.a(aed, amu, tv)) gives each 2x2 grid stack to
// InventoryPlayer.placeItemBackInInventory (aec.a(amu, aip)): storeItemStack (aec.d: the held slot,
// then the off hand, then inventory 0-35, where a stack merges below both its own and the slot's
// limit), else getFirstEmptyStack (aec.k: 0-35, the hotbar first), else it is dropped; each placed
// part is sent as set_slot window -2 (an inventory index, which mineflayer ignores). The next tick's
// detectAndSendChanges sends the changed window-0 slots (not after a click, so not quantity-only).
// Closing the table does the same with its 3x3 grid (ContainerWorkbench.onContainerClosed): the cursor
// dropped, the grid put back, then window 0's changed slots.
// A single chest (opts.chest, #633 review 2): ContainerChest, window type minecraft:chest, slots 0-26 the
// chest and 27-62 the player's 9-44; opened with open_window and window_items (BlockChest.onBlockActivated,
// EntityPlayerMP.displayGUIChest), mode-0 clicks as above; closing it drops the cursor (Container.
// onContainerClosed; the chest's closeInventory sends no slot) and window 0's changed slots follow.
// Its contents stay between openings (the tile entity).
// The server tick (opts.tickModel, fake-tick.js runs it; soak 17): window 0's slots the client was last sent
// (Container.inventoryItemStacks) are kept, and detectAndSendChanges sends each slot that differs, at the end of
// the tick, while window 0 is the open container. An accepted click (mode 0 or 2) runs it at once with
// isChangingQuantityOnly: the changed slots are recorded as sent and none is sent (NetHandlerPlayServer.
// processClickWindow, pa.a(lf) bytecode 167-233; EntityPlayerMP.sendSlotContents, oq.a(afr,int,aip) bytecode
// 31-38), so a tool's damage from a dig in the same tick never reaches the client. A rejected click's resend
// (sendAllContents) leaves the record as it is. Without tickModel nothing of this runs.
// This is a model, not a server: the live probe batch is still the proof.

import { encodeOpenGui } from '../src/channels.js';

const DEFAULT_MAX_STACK = 64;
const TICK_MS = 50;
const EMPTY = { blockId: -1 };

const stack = (id, count = 1, meta = 0) => ({ id, count, meta });
const copy = (s) => (s ? { ...s } : null);
const toWire = (s) => (s ? { blockId: s.id, itemCount: s.count, itemDamage: s.meta } : EMPTY);
const fromWire = (w) => (!w || w.blockId === -1 ? null : stack(w.blockId, w.itemCount, w.itemDamage));
const same = (a, b) => (!a && !b) || (a && b && a.id === b.id && a.count === b.count && a.meta === b.meta);

export { stack };

/**
 * The pack's item stack sizes (StackUp, rotn-data's dump) for the item ids a test's registries
 * use: { id: stackSize }, for opts.maxStack. `ids`: { registryName: id }.
 */
export function dumpMaxStack(dumpItems, ids) {
    const out = {};
    for (const [name, id] of Object.entries(ids)) {
        const size = dumpItems?.[name]?.stackSize;
        if (Number.isInteger(size) && size > 0) out[id] = size;
    }
    return out;
}

/**
 * Where mineflayer's view of window 0 and the cursor differs from the server model's: a list of
 * "slot N: client X, server Y" (slot 0, the crafting result, is left out: the server never sends
 * it when a close clears it). Empty when they agree. The silent divergence no rejection shows.
 */
export function inventoryDiff(window, state) {
    const name = (s) => (s ? `${s.id}x${s.count}${s.meta ? `:${s.meta}` : ''}` : '-');
    const client = (it) => (it ? { id: it.type, count: it.count, meta: it.metadata ?? 0 } : null);
    const out = [];
    for (let s = 1; s < 46; s++) {
        const c = client(window.slots[s]);
        if (!same(c, state.inv[s])) out.push(`slot ${s}: client ${name(c)}, server ${name(state.inv[s])}`);
    }
    const cc = client(window.selectedItem);
    if (!same(cc, state.cursor)) out.push(`cursor: client ${name(cc)}, server ${name(state.cursor)}`);
    return out;
}

/**
 * RotN 3.3.4's hunger, as the server computes it on normal difficulty (server.properties
 * `difficulty=2` in the pinned pack). Read with javap on the pinned zip's jars (scratch only, never run):
 * - vanilla `minecraft_server.1.12.2.jar` Potion (`uz`): Hunger adds 0.005 * (amplifier + 1) exhaustion
 *   on every tick it lasts (its isReady is always true);
 * - Hunger Overhaul 1.3.3 (`HungerOverhaul.cfg`: constantHungerLoss=true, hungerLossRatePercentage=85,
 *   difficultyScalingHunger=true): +0.01 exhaustion every tick (`onLivingUpdate`), and one hunger step
 *   costs 4 / 0.85 exhaustion (`getMaxExhaustion`; x1.333 on easy and x1.667 on peaceful, not used here);
 * - AppleCore 3.4.0: exhaustion is capped at 40 (`GetExhaustionCap`); each tick with exhaustion >= the
 *   step cost takes one step (`onAppleCoreFoodStatsUpdate`): saturation -1 (never below 0), or, when
 *   saturation is already 0, food -1 (never below 0). At food 0 Hunger Overhaul deals 200 damage
 *   (`damageOnStarve`), so a setup must never get there.
 * A new player starts at food 20, saturation 5 (vanilla FoodStats).
 */
export const ROTN_HUNGER = Object.freeze({
    effectPerTick: (amplifier) => 0.005 * (amplifier + 1),
    constantPerTick: 0.01,
    stepCost: Math.fround(4 / Math.fround(85 / 100)), // Java: 4.0f / (85f / 100f)
    cap: 40,
});

/**
 * The food state after a `/effect <player> minecraft:hunger SECONDS AMPLIFIER`, tick by tick, with
 * Hunger Overhaul's constant loss during those ticks. Time before and after the effect is not
 * counted (the real server keeps losing 0.01 a tick, so its food can only be lower).
 * @param {{food:number, saturation:number, exhaustion?:number}} s
 * @param {number} seconds @param {number} amplifier
 * @returns {{food:number, saturation:number, exhaustion:number, steps:number}}
 */
export function simulateHunger(s, seconds, amplifier) {
    const f = Math.fround;
    let { food, saturation } = s;
    let exhaustion = s.exhaustion ?? 0;
    let steps = 0;
    const add = f(ROTN_HUNGER.effectPerTick(amplifier) + ROTN_HUNGER.constantPerTick);
    const cost = f(ROTN_HUNGER.stepCost);
    for (let tick = 0; tick < seconds * 20; tick++) {
        exhaustion = Math.min(f(exhaustion + add), ROTN_HUNGER.cap);
        if (exhaustion >= cost) { // AppleCore onAppleCoreFoodStatsUpdate: a step unless exhaustion < cost (fcmpl; iflt), so >=
            exhaustion = f(exhaustion - cost);
            steps++;
            if (saturation > 0) saturation = Math.max(f(saturation - 1), 0);
            else food = Math.max(food - 1, 0);
        }
    }
    return { food, saturation, exhaustion, steps };
}

/**
 * @param {import('minecraft-protocol').ServerClient} client
 * @param {{ recipes: Array<{shaped?: (number|null)[][], shapeless?: number[], result: {id:number,count?:number,meta?:number}}>,
 *           blocks: Record<number, number>, foods: Record<number, number|{hunger:number,saturation:number}>,
 *           table: {x:number,y:number,z:number}, inventory: Record<number, {id:number,count:number,meta?:number}>,
 *           placeDelayMs?: number, entityId?: number, food?: number, saturation?: number,
 *           chest?: {x:number,y:number,z:number} }} opts
 *   recipes are matched first to last (the server's registry order); maxUses (a test hook) makes a recipe
 *   stop matching after it has been crafted that many times (a server whose result changes between crafts).
 *   blocks: item id -> block id that placing it sets; foods: item id -> food points, or food points and
 *   the saturation modifier (RotN's bread, scripts/food.zs: { hunger: 3, saturation: 0.2 }).
 */
export function attachFakeContainers(client, opts) {
    let { recipes } = opts;
    const { blocks, foods, table, chest, placeDelayMs = 0, entityId = 1, food = 20, saturation = 5, maxStack = {} } = opts;
    // Item max stack size (tools are 1 on a real server), DEFAULT_MAX_STACK otherwise.
    const max = (id) => maxStack[id] ?? DEFAULT_MAX_STACK;
    const inv = Array(46).fill(null); // ContainerPlayer: 0 result, 1-4 grid, 5-8 armour, 9-35 main, 36-44 hotbar, 45 offhand
    for (const [slot, s] of Object.entries(opts.inventory ?? {})) inv[Number(slot)] = stack(s.id, s.count, s.meta ?? 0);
    const state = {
        inv, cursor: null, held: 0, food, saturation, exhaustion: 0, table: table ? { ...table } : null, noiseNext: null,
        tableWindow: null, // { id, grid: Array(10) } while FastWorkbench is open
        chest: chest ? { ...chest } : null, chestSlots: Array(27).fill(null), // the chest's contents
        chestWindow: null, // { id, invAtOpen } while the chest is open
        resultRecipe: {}, // windowId -> the recipe behind the result slot (for maxUses)
        closedOther: [], // close_window packets whose id was not the open window's ({ sent, open })
        pending: null, // { windowId, action } after a rejected click
        clicks: [], rejected: [], ignored: [], unsupported: [], placed: [], uses: [], closed: [],
        swaps: [], dropped: [], returned: [], // mode-2 clicks; stacks dropped and grid stacks put back by a close of window 0
        sent: inv.map(copy), // tickModel: window 0 as the client was last sent it (inventoryItemStacks)
        unsent: [], // tickModel: { slot, item } recorded as sent by an accepted click's detectAndSendChanges, not sent
    };
    // tickModel: Container.detectAndSendChanges for window 0 (slot 0, the crafting result, is never sent).
    function detectAndSendChanges(quantityOnly = false) {
        if (!opts.tickModel || state.tableWindow || state.chestWindow) return;
        for (let s = 1; s < 46; s++) {
            if (same(state.sent[s], inv[s])) continue;
            state.sent[s] = copy(inv[s]);
            if (quantityOnly) state.unsent.push({ slot: s, item: copy(inv[s]) });
            else client.write('set_slot', { windowId: 0, slot: s, item: toWire(inv[s]) });
        }
    }
    const sentAll = () => { if (opts.tickModel) state.sent = inv.map(copy); };
    let nextWindowId = 0;

    // Slot access per window. FastWorkbench: 0 result, 1-9 grid, 10-45 = player slots 9-44.
    // The chest: 0-26 the chest, 27-62 = player slots 9-44.
    const isChest = (windowId) => windowId !== 0 && state.chestWindow?.id === windowId;
    function grid(windowId) { return windowId === 0 ? inv : state.tableWindow.grid; }
    function get(windowId, slot) {
        if (isChest(windowId)) return slot < 27 ? state.chestSlots[slot] : inv[slot - 18];
        if (windowId === 0 || slot <= 9) return grid(windowId)[slot];
        return inv[slot - 1];
    }
    function set(windowId, slot, s) {
        const v = s && s.count > 0 ? s : null;
        if (isChest(windowId)) { if (slot < 27) state.chestSlots[slot] = v; else inv[slot - 18] = v; return; }
        if (windowId === 0 || slot <= 9) grid(windowId)[slot] = v;
        else inv[slot - 1] = v;
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
            if (r.maxUses !== undefined && (r.used ?? 0) >= r.maxUses) continue;
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
        state.resultRecipe[windowId] = r;
        const result = r ? stack(r.result.id, r.result.count ?? 1, r.result.meta ?? 0) : null;
        if (!same(grid(windowId)[0], result)) {
            grid(windowId)[0] = result;
            client.write('set_slot', { windowId, slot: 0, item: toWire(result) });
        }
    }

    function windowItems(windowId) {
        // Window 0 and the table have 46 slots: 9 crafting + armour/offhand or 10 + 36 player slots; the chest 27 + 36.
        return Array.from({ length: isChest(windowId) ? 63 : 46 }, (_, s) => toWire(get(windowId, s)));
    }

    // Container.slotClick, PICKUP (mode 0) only. Returns the stack it reports back.
    function slotClick(windowId, slot, button) {
        const gridEnd = windowId === 0 ? 4 : 9;
        if (slot === -999) {
            if (state.cursor) { if (button === 0) state.cursor = null; else { state.cursor.count--; if (!state.cursor.count) state.cursor = null; } }
            return null;
        }
        const before = copy(get(windowId, slot));
        const crafting = !isChest(windowId);
        if (crafting && slot === 0) { // the crafting result: take it all, or add it to a matching cursor
            const res = get(windowId, 0);
            if (res && (!state.cursor || (state.cursor.id === res.id && state.cursor.meta === res.meta && state.cursor.count + res.count <= max(res.id)))) {
                state.cursor = state.cursor ? { ...state.cursor, count: state.cursor.count + res.count } : copy(res);
                for (let s = 1; s <= gridEnd; s++) { const g = get(windowId, s); if (g) set(windowId, s, { ...g, count: g.count - 1 }); }
                grid(windowId)[0] = null;
                const made = state.resultRecipe[windowId];
                if (made) made.used = (made.used ?? 0) + 1;
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
        if (crafting && slot >= 1 && slot <= gridEnd) updateResult(windowId);
        return before;
    }

    // Container.slotClick SWAP (mode 2, button = hotbar index): swap the slot with that hotbar slot.
    // The crafting result (slot 0) and armour validity are not modelled: a swap on slot 0 is recorded
    // in unsupported and changes nothing.
    function swapClick(windowId, slot, button) {
        if (slot < 0 || (slot === 0 && !isChest(windowId))) { state.unsupported.push({ windowId, slot, mode: 2, mouseButton: button }); return; }
        // the table maps player slot n to n + 1, the chest to n + 18
        const hot = windowId === 0 ? 36 + button : isChest(windowId) ? 54 + button : 37 + button;
        if (hot === slot) return;
        const h = get(windowId, hot);
        const s = get(windowId, slot);
        if (!h && !s) return;
        set(windowId, hot, s ? { ...s } : null);
        set(windowId, slot, h ? { ...h } : null);
        if (!isChest(windowId) && slot >= 1 && slot <= (windowId === 0 ? 4 : 9)) updateResult(windowId);
    }

    client.on('window_click', (p) => {
        state.clicks.push(p);
        // processClickWindow only acts on the open container: while the table is open, a
        // window-0 click is dropped silently (no transaction), as on a real server.
        // At most one container is open besides window 0: opening one closes the other (openTable, openChest).
        const openId = state.tableWindow?.id ?? state.chestWindow?.id ?? 0;
        const open = p.windowId === openId;
        if (!open || (state.pending && state.pending.windowId === p.windowId)) { state.ignored.push(p); return; }
        if (p.mode === 2 && p.mouseButton >= 0 && p.mouseButton <= 8) {
            swapClick(p.windowId, p.slot, p.mouseButton);
            state.swaps.push(p);
            // SWAP returns EMPTY; the client sends no item for mode 2: always equal, accepted, no echo.
            client.write('transaction', { windowId: p.windowId, action: p.action, accepted: true });
            detectAndSendChanges(true);
            return;
        }
        if (p.mode !== 0) {
            state.unsupported.push(p);
            client.write('transaction', { windowId: p.windowId, action: p.action, accepted: false });
            state.pending = { windowId: p.windowId, action: p.action };
            return;
        }
        const returned = slotClick(p.windowId, p.slot, p.mouseButton);
        if (same(fromWire(p.item), returned)) {
            client.write('transaction', { windowId: p.windowId, action: p.action, accepted: true });
            detectAndSendChanges(true);
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

    // EntityPlayerMP.closeContainer (oq.r) on the open container, the table or the chest; false when none is open.
    function closeOpenContainer() {
        if (state.tableWindow) { closeTableWindow(); return true; }
        if (state.chestWindow) { closeChestWindow(); return true; }
        return false;
    }
    // processCloseWindow closes the open container whatever the packet's window id (#649 review: on
    // purpose, for the table and the chest alike); a close with another id is recorded in closedOther.
    client.on('close_window', (p) => {
        state.closed.push(p.windowId);
        const openId = state.tableWindow?.id ?? state.chestWindow?.id ?? 0;
        if (p.windowId !== openId) state.closedOther.push({ sent: p.windowId, open: openId });
        if (!closeOpenContainer()) closePlayerWindow();
    });

    // The window slot of an InventoryPlayer index (0-8 hotbar, 9-35 main, 40 off hand).
    const slotOfIndex = (i) => (i === 40 ? 45 : i < 9 ? 36 + i : i);
    const mergeable = (a, b) => a && b && a.id === b.id && a.meta === b.meta && a.count < max(a.id);
    // aec.d storeItemStack: the held slot, the off hand, then 0-35; aec.k getFirstEmptyStack: 0-35.
    function storeIndex(st) {
        if (mergeable(inv[slotOfIndex(state.held)], st)) return state.held;
        if (mergeable(inv[45], st)) return 40;
        for (let i = 0; i < 36; i++) if (mergeable(inv[slotOfIndex(i)], st)) return i;
        return -1;
    }
    function firstEmptyIndex() {
        for (let i = 0; i < 36; i++) if (!inv[slotOfIndex(i)]) return i;
        return -1;
    }
    // aec.a(amu, aip) placeItemBackInInventory.
    function placeBack(st) {
        let left = { ...st };
        while (left.count > 0) {
            let i = storeIndex(left);
            if (i === -1) i = firstEmptyIndex();
            if (i === -1) { state.dropped.push({ ...left, why: 'no room' }); return; }
            const slot = slotOfIndex(i);
            const have = inv[slot];
            const n = Math.min(left.count, max(left.id) - (have?.count ?? 0));
            inv[slot] = have ? { ...have, count: have.count + n } : { ...left, count: n };
            left = { ...left, count: left.count - n };
            state.returned.push({ slot, id: st.id, count: n });
            client.write('set_slot', { windowId: -2, slot: i, item: toWire(inv[slot]) }); // mineflayer ignores window -2
        }
    }
    // ContainerPlayer.onContainerClosed (agi.b), then the next tick's detectAndSendChanges.
    function closePlayerWindow() {
        const before = inv.map(copy);
        if (state.cursor) { state.dropped.push({ ...state.cursor, why: 'cursor' }); state.cursor = null; } // afr.b: no packet
        inv[0] = null; // craftResult.clear(): no packet (a crafting slot is never sent by sendSlotContents)
        const grid = [1, 2, 3, 4].map((k) => inv[k]).filter(Boolean);
        for (const k of [1, 2, 3, 4]) inv[k] = null;
        for (const g of grid) placeBack(g);
        sendChangedNextTick(before);
    }
    // The table (soak 16 craft guard; was #629 review 4's "not modelled"): ContainerFastBench.onContainerClosed
    // (its position is not ORIGIN) runs ContainerWorkbench.onContainerClosed: Container.onContainerClosed
    // drops the cursor (no packet), then clearContainer gives each grid stack to placeItemBackInInventory,
    // as for window 0. Window 0 is the open container again, and its next detectAndSendChanges sends the
    // slots that changed since it was last in step (when the table opened).
    function closeTableWindow() {
        const { grid: tableGrid, invAtOpen } = state.tableWindow;
        const stacks = tableGrid.slice(1).filter(Boolean);
        state.closedTableGrid = stacks.length;
        state.tableWindow = null;
        if (state.cursor) { state.dropped.push({ ...state.cursor, why: 'cursor' }); state.cursor = null; }
        for (const g of stacks) placeBack(g);
        sendChangedNextTick(invAtOpen);
    }
    // The chest's close: Container.onContainerClosed drops the cursor (no packet); the chest's closeInventory
    // sends no slot; then window 0's changed slots.
    function closeChestWindow() {
        const { invAtOpen } = state.chestWindow;
        state.chestWindow = null;
        if (state.cursor) { state.dropped.push({ ...state.cursor, why: 'cursor' }); state.cursor = null; }
        sendChangedNextTick(invAtOpen);
    }
    function sendChangedNextTick(before) {
        setTimeout(() => {
            for (let s = 1; s < 46; s++) if (!same(before[s], inv[s])) client.write('set_slot', { windowId: 0, slot: s, item: toWire(inv[s]) });
        }, TICK_MS);
    }

    client.on('block_place', (p) => {
        const at = p.location;
        const table = state.table;
        if (table && at.x === table.x && at.y === table.y && at.z === table.z) { // BlockFastBench.onBlockActivated
            // FML's openGui closes the open container first, with no packet (closeContainer).
            closeOpenContainer();
            nextWindowId = (nextWindowId % 100) + 1;
            state.tableWindow = { id: nextWindowId, grid: Array(10).fill(null), invAtOpen: inv.map(copy) };
            client.write('custom_payload', { channel: 'FML', data: encodeOpenGui({ windowId: nextWindowId, modId: 'fastbench', modGuiId: 0, ...table }) });
            client.write('window_items', { windowId: nextWindowId, items: windowItems(nextWindowId) });
            client.write('set_slot', { windowId: -1, slot: -1, item: toWire(state.cursor) });
            return;
        }
        const ch = state.chest;
        if (ch && at.x === ch.x && at.y === ch.y && at.z === ch.z) { // BlockChest.onBlockActivated -> displayGUIChest
            // displayGUIChest (oq.a(tv), bytecode 64-76): another open container is closed first with closeScreen
            // (oq.p): close_window for its id, then closeContainer.
            const other = state.tableWindow?.id ?? state.chestWindow?.id;
            if (other !== undefined) { client.write('close_window', { windowId: other }); closeOpenContainer(); }
            nextWindowId = (nextWindowId % 100) + 1;
            state.chestWindow = { id: nextWindowId, invAtOpen: inv.map(copy) };
            client.write('open_window', { windowId: nextWindowId, inventoryType: 'minecraft:chest', windowTitle: JSON.stringify({ translate: 'container.chest' }), slotCount: 27 });
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
        const value = item && foods[item.id];
        // AppleCore needFood: food < 20 (bread is not always edible). At 20 the server starts nothing.
        if (p.hand !== 0 || value === undefined || state.food >= 20) return;
        const { hunger, saturation: modifier } = typeof value === 'number' ? { hunger: value, saturation: 0 } : value;
        setTimeout(() => { // 32 ticks in vanilla; shortened here
            inv[heldSlot] = item.count > 1 ? { ...item, count: item.count - 1 } : null;
            // vanilla FoodStats.addStats: saturation += hunger * modifier * 2, at most the new food level.
            state.food = Math.min(20, state.food + hunger);
            state.saturation = Math.min(Math.fround(state.saturation + hunger * modifier * 2), state.food);
            client.write('entity_status', { entityId, entityStatus: 9 });
            client.write('set_slot', { windowId: 0, slot: heldSlot, item: toWire(inv[heldSlot]) });
            health();
        }, 100);
    });

    function health() {
        client.write('update_health', { health: 20, food: state.food, foodSaturation: state.saturation });
    }

    return {
        state,
        windowItems,
        /** tickModel: the end of a server tick's detectAndSendChanges for window 0 (fake-tick.js calls it). */
        detectAndSendChanges: () => detectAndSendChanges(false),
        /** Replace the server's recipes (matched first to last), e.g. with a maxUses hook. */
        setRecipes(list) { recipes = list; },
        /** The chest's contents as { slot: {id, count, meta} } (non-empty slots). */
        chestContents() { return Object.fromEntries(state.chestSlots.map((c, i) => [i, c]).filter(([, c]) => c)); },
        /** Send the player's inventory window (as at login). */
        sendInventory() {
            client.write('window_items', { windowId: 0, items: windowItems(0) });
            sentAll();
            health();
        },
        /** Set the food level directly, with saturation 0 (update_health). Not what any command does. */
        setFood(n) { state.food = n; state.saturation = 0; health(); },
        /**
         * `/effect <player> minecraft:hunger SECONDS AMPLIFIER` on RotN 3.3.4 (simulateHunger), applied at
         * once; sends one update_health if food or saturation changed. Returns the new food state.
         */
        applyHunger(seconds, amplifier) {
            const r = simulateHunger(state, seconds, amplifier);
            const changed = r.food !== state.food || r.saturation !== state.saturation;
            [state.food, state.saturation, state.exhaustion] = [r.food, r.saturation, r.exhaustion];
            if (changed) health();
            return { food: state.food, saturation: state.saturation, exhaustion: state.exhaustion };
        },
        // The main inventory and hotbar (9-44) only; the real /clear also counts armour, the offhand and the cursor.
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
            sentAll();
            return n;
        },
        /** Replace window 0 and the cursor ({slot: {id, count, meta}}) and resend them, as after a login. */
        setInventory(slots, cursor = null) {
            for (let s = 0; s < inv.length; s++) inv[s] = null;
            for (const [slot, st] of Object.entries(slots)) inv[Number(slot)] = stack(st.id, st.count, st.meta ?? 0);
            state.cursor = cursor ? stack(cursor.id, cursor.count, cursor.meta ?? 0) : null;
            state.pending = null;
            client.write('window_items', { windowId: 0, items: windowItems(0) });
            client.write('set_slot', { windowId: -1, slot: -1, item: toWire(state.cursor) });
            sentAll();
        },
        /** The server's window 0 and cursor ({ slots: [...46], cursor }), copies. */
        serverView() { return { slots: inv.map(copy), cursor: copy(state.cursor) }; },
        /** Move RotN's crafting table (a setblock of minecraft:crafting_table). */
        setTable(pos) { state.table = pos ? { ...pos } : null; },
    };
}
