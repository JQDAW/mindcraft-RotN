// Soak 15 (the outside review, the lead's decision): the hands as an action-boundary rule, not a per-skill call.
// #614's rearmWeapon keeps the stone pickaxe in the off hand (slot 45: a death keeps both hands), but the tool
// choosers (mineflayer-tool's equipForBlock, the pathfinder's bestHarvestTool) read inventory.items() (9-44) and the
// main hand only: after a !collectBlocks the walks and !digDown saw no pickaxe, every stone was Infinity ("Path not
// found", "needs a better tool"). Now:
// - before every action (action_manager): the off-hand pickaxe into the inventory, the cursor cleared, the 2x2 grid
//   returned (net-forge's N3); after it: rearmWeapon (the pickaxe to the off hand, the weapon to the main hand);
// - a bot.dig wrapper: a dig outside an action, with the pickaxe in the off hand and a held item that cannot dig
//   the block, takes the pickaxe in hand first;
// - between actions (the agent's update loop): the cursor and the grid are repaired, said once.

import { offHandToolBack, rearmWeapon, isPickaxeItem } from './skills.js';
import { clearCursor, returnGrid, GRID_SLOTS } from './inventory_sync.js';

/**
 * Before an action: the off-hand pickaxe where the tool choosers look, a clear cursor, an empty 2x2 grid. null (no
 * await, nothing clicked) when there is nothing to do; else the promise of the moves.
 * #619 (the lead): a mode action (a reflex, label "mode:...") keeps the pickaxe in the off hand: a fight starts at
 * once, and every window click is another desync chance; its digs go through the bot.dig wrapper, and escape.js takes
 * the pickaxe itself. Its cursor and grid are cleaned only when not empty (no click otherwise). rearmWeapon after, as
 * for every action.
 */
export function handsBefore(bot, label = 'an action') {
    const inv = bot?.inventory;
    if (!Array.isArray(inv?.slots)) return null;
    const off = inv.slots[45];
    const takePick = !String(label).startsWith('mode:') && !!(off && isPickaxeItem(off));
    if (!takePick && !inv.selectedItem && !GRID_SLOTS.some(k => inv.slots[k]) && !bot.rotnHandsBusy) return null;
    return withHandsLock(bot, () => handsBeforeNow(bot, label, takePick));
}

/**
 * #619 review 4: the hands' window clicks one at a time: handsBefore waits for an idle repair still clicking, and
 * idleHands never starts while one runs (bot.rotnHandsBusy: the promise of the running one).
 */
async function withHandsLock(bot, fn) {
    while (bot.rotnHandsBusy) { try { await bot.rotnHandsBusy; } catch { /* its own warning */ } }
    const run = Promise.resolve().then(fn);
    bot.rotnHandsBusy = run;
    try { return await run; } finally { if (bot.rotnHandsBusy === run) bot.rotnHandsBusy = null; }
}

/**
 * afterMs (#619 review 6): the after-step's bound, so a slow server cannot push an interrupted action's end (and
 * stop()) toward the action manager's 10 s kill.
 */
export const HANDS = { afterMs: 4000 };
/** #619 review 1: the model's !equip sticks until its next action re-arms (no after-step for it). */
const NO_REARM_AFTER = new Set(['action:equip']);
async function handsBeforeNow(bot, label, takePick) {
    if (takePick) try { await offHandToolBack(bot); } catch (err) { console.warn(`[hands] before ${label}: the off-hand pickaxe could not be taken back (${err?.message ?? err})`); }
    try { const did = await clearCursor(bot); if (did) console.log(`[hands] before ${label}: ${did}`); } catch (err) { console.warn(`[hands] before ${label}: the cursor could not be cleared (${err?.message ?? err})`); }
    try { await returnGrid(bot, `before ${label}`); } catch (err) { console.warn(`[hands] before ${label}: the grid could not be returned (${err?.message ?? err})`); }
}

/**
 * After an action: the pickaxe to the off hand, the weapon to the main hand (rearmWeapon), as #614; within
 * HANDS.afterMs. Not after the model's !equip (#619 review 1), and not when another action interrupted this one
 * (`interruptedBy`, #619 review 6): that action's own after-step re-arms (unless it is an !equip, which keeps its
 * item). Returns 'skipped', 'timeout' or 'done'.
 */
export async function handsAfter(bot, label = 'an action', { interruptedBy = null, afterMs = HANDS.afterMs } = {}) {
    if (!bot?.inventory?.slots) return 'skipped';
    if (NO_REARM_AFTER.has(label)) return 'skipped';
    if (interruptedBy && !NO_REARM_AFTER.has(interruptedBy)) return 'skipped';
    let timer;
    const bound = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), afterMs); });
    try {
        const r = await Promise.race([withHandsLock(bot, () => rearmWeapon(bot)).then(() => 'done'), bound]);
        if (r === 'timeout') console.warn(`[hands] after ${label}: re-arming took over ${afterMs / 1000} s; going on (it may still finish)`);
        return r;
    } catch (err) {
        console.warn(`[hands] after ${label}: re-arming failed (${err?.message ?? err})`);
        return 'done';
    } finally { clearTimeout(timer); }
}

/** Whether the held item can dig the block (the Forge dig rule through bot.digTime); unknown: yes. */
function heldCanDig(bot, block) {
    if (typeof bot.digTime !== 'function' || !block) return true;
    try { return Number.isFinite(bot.digTime(block)); } catch { return true; }
}

/**
 * Wrap bot.dig once: with a pickaxe in the off hand and a held item that cannot dig the block, the pickaxe is taken
 * into the inventory and into the hand first (a dig outside an action; inside one, handsBefore already moved it).
 * mineflayer adds bot.dig with its plugin, so this also runs on login and spawn.
 */
export function installDigHands(bot) {
    if (!bot) return;
    const wrap = () => {
        const original = bot.dig;
        if (typeof original !== 'function' || original.rotnHands) return;
        const dig = async function (block, ...rest) {
            // Soak 16 (C, #632 review 2): a dig watcher (the collect: "it gave" counts from its target's own dig).
            try { bot.rotnDigHook?.(block); } catch { /* the dig goes on */ }
            const off = bot.inventory?.slots?.[45];
            if (off && isPickaxeItem(off) && !heldCanDig(bot, block)) {
                await offHandToolBack(bot);
                const pick = (bot.inventory.items?.() ?? []).find(i => i.name === off.name) ?? (bot.heldItem?.name === off.name ? bot.heldItem : null);
                if (pick && bot.heldItem?.name !== pick.name) { try { await bot.equip(pick, 'hand'); } catch { /* the dig says why */ } }
                console.log(`[hands] the ${off.name} from the off hand for ${block?.name ?? 'the dig'}`);
            }
            const r = await original.call(this ?? bot, block, ...rest);
            // Soak 16 (E): every dig that resolved, counted (the pathfinder's and the collect's digs come here too):
            // a command that dug is checked for a trapped bot after it (escape.escapeIfTrapped).
            const d = bot.rotnDigs ??= { count: 0, last: null, log: [] };
            d.count++;
            d.last = { name: block?.name ?? null, at: block?.position ?? null };
            // Soak 16 (C2): the last digs, numbered (n), for the collect's line (the walk's digs named apart).
            (d.log ??= []).push({ n: d.count, ...d.last });
            if (d.log.length > 32) d.log.shift();
            return r;
        };
        dig.rotnHands = true;
        bot.dig = dig;
    };
    wrap();
    if (typeof bot.on === 'function' && !bot.rotnDigHooked) {
        bot.rotnDigHooked = true;
        bot.on('login', wrap);
        bot.on('spawn', wrap);
    }
}

/**
 * Between actions (the update loop): a stack left on the cursor or in the 2x2 grid is put back, said once for each
 * state (a repair that cannot be done is not tried again until the state changes).
 */
export async function idleHands(agent) {
    const bot = agent?.bot;
    const inv = bot?.inventory;
    // #619 review 4: never beside an action's clicks, a mode acting, or another repair.
    if (!inv?.slots || agent.actions?.executing || agent.rotnIdleHandsBusy || bot.rotnHandsBusy) return null;
    try { if (bot.modes?.anyActive?.()) return null; } catch { return null; }
    const grid = GRID_SLOTS.filter(k => inv.slots[k]);
    const cursor = inv.selectedItem?.name ?? null;
    if (!grid.length && !cursor) { agent.rotnIdleHandsSaid = null; return null; }
    const state = `${cursor ?? '-'}|${grid.map(k => `${k}:${inv.slots[k].name}`).join(',')}`;
    if (agent.rotnIdleHandsSaid === state) return null;
    agent.rotnIdleHandsSaid = state;
    agent.rotnIdleHandsBusy = true;
    try {
        console.log(`[hands] idle: ${cursor ? `the ${cursor} on the cursor` : ''}${cursor && grid.length ? ' and ' : ''}${grid.length ? `stacks in the 2x2 grid (slots ${grid.join(', ')})` : ''}: putting them back`);
        await withHandsLock(bot, async () => {
            if (cursor && !grid.length) { const did = await clearCursor(bot); if (did) console.log(`[hands] idle: ${did}`); }
            if (grid.length) await returnGrid(bot, 'between actions');
        });
        return state;
    } catch (err) {
        console.warn(`[hands] idle repair failed: ${err?.message ?? err}`);
        return state;
    } finally { agent.rotnIdleHandsBusy = false; }
}
