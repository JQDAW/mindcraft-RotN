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
import { clearCursor, returnGrid } from './inventory_sync.js';
import * as inv from './inventory_view.js';
import { isWeaponItem } from './threats.js';
import { usesLeft } from './pickaxe.js';

/**
 * Soak 16 trap: the stone pickaxe broke on the walk that dug the bot in, and no line said so. A tool in hand with at
 * most lastUses uses before a dig, gone from its slot checkMs after it: "[tool] <name> broke". The server's set_slot
 * comes after the block change, so the check waits.
 */
export const TOOL_BREAK = { lastUses: 2, checkMs: 500 };
function watchToolBreak(bot, tool, block) {
    if (!tool?.name || !(usesLeft(tool) <= TOOL_BREAK.lastUses) || !Number.isInteger(tool.slot)) return;
    setTimeout(() => {
        try {
            // #642 review 5: moved, not broken: any slot (the off hand too) or the cursor holding that tool, as worn or less.
            const held = inv.everyStack(bot).some(i => i?.name === tool.name && (i.metadata ?? 0) >= (tool.metadata ?? 0));
            if (held) return;
            const p = block?.position;
            bot.rotnToolBroke = { name: tool.name, at: Date.now(), on: block?.name ?? null };
            console.log(`[tool] ${tool.name} broke (used up) on ${block?.name ?? 'a block'}${p ? ` at ${p.x}, ${p.y}, ${p.z}` : ''}`);
        } catch { /* no line */ }
    }, TOOL_BREAK.checkMs).unref?.();
}

/**
 * Before an action: the off-hand pickaxe where the tool choosers look, a clear cursor, an empty 2x2 grid. null (no
 * await, nothing clicked) when there is nothing to do; else the promise of the moves.
 * #619 (the lead): a mode action (a reflex, label "mode:...") keeps the pickaxe in the off hand: a fight starts at
 * once, and every window click is another desync chance; its digs go through the bot.dig wrapper, and escape.js takes
 * the pickaxe itself. Its cursor and grid are cleaned only when not empty (no click otherwise). rearmWeapon after, as
 * for every action.
 */
export function handsBefore(bot, label = 'an action') {
    if (!inv.slotCount(bot)) return null;
    const v = inv.view(bot); // round 17 V
    const off = v.offHand;
    const takePick = !String(label).startsWith('mode:') && !!(off && isPickaxeItem(off));
    if (!takePick && !v.cursor && !v.grid.length && !bot.rotnHandsBusy) return null;
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
    if (!inv.slotCount(bot)) return 'skipped';
    // Round 17 V2: the model's !equip holds until its next action; the idle repair leaves the hands alone till then.
    if (NO_REARM_AFTER.has(label)) { bot.rotnModelEquip = true; return 'skipped'; }
    if (!interruptedBy) bot.rotnModelEquip = false;
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
            const off = inv.offHand(bot);
            if (off && isPickaxeItem(off) && !heldCanDig(bot, block)) {
                await offHandToolBack(bot);
                const pick = (bot.inventory.items?.() ?? []).find(i => i.name === off.name) ?? (bot.heldItem?.name === off.name ? bot.heldItem : null);
                if (pick && bot.heldItem?.name !== pick.name) { try { await bot.equip(pick, 'hand'); } catch { /* the dig says why */ } }
                console.log(`[hands] the ${off.name} from the off hand for ${block?.name ?? 'the dig'}`);
            }
            const tool = bot.heldItem;
            const r = await original.call(this ?? bot, block, ...rest);
            watchToolBreak(bot, tool, block);
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
    // #619 review 4: never beside an action's clicks, a mode acting, or another repair.
    if (!inv.slotCount(bot) || agent.actions?.executing || agent.rotnIdleHandsBusy || bot.rotnHandsBusy) return null;
    try { if (bot.modes?.anyActive?.()) return null; } catch { return null; }
    // Round 17 V2: never while a container window is open (its clicks are not window 0's; Fable N3 iii).
    if (bot.currentWindow && bot.currentWindow !== bot.inventory) return null;
    const grid = inv.gridSlotsHeld(bot);
    const cursor = inv.cursorStack(bot)?.name ?? null;
    if (!grid.length && !cursor) { agent.rotnIdleHandsSaid = null; return idleArms(agent); }
    const stacks = inv.view(bot).grid;
    const state = `${cursor ?? '-'}|${stacks.map(st => `${st.slot}:${st.name}`).join(',')}`;
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

/**
 * Round 17 V2 (Fable S2 iii, the lead's plan): the other two idle invariants: the pickaxe in the off hand and the weapon
 * in the main hand (rearmWeapon, as after every action), when no action, reflex, repair or container window is about,
 * and not while the model's own !equip holds (until its next action). Each state is repaired and said once (a repair
 * that cannot be done is not tried again until the state changes). Also right after a respawn (the loop is idle then).
 */
export function armsWrong(bot) {
    const v = inv.view(bot);
    const carried = inv.carried(bot);
    const pick = carried.find(isPickaxeItem);
    const pickWrong = !!pick && !(v.offHand && isPickaxeItem(v.offHand));
    const weapon = carried.find(isWeaponItem);
    const weaponWrong = !!weapon && !isWeaponItem(bot.heldItem);
    if (!pickWrong && !weaponWrong) return null;
    return { pickWrong, weaponWrong, state: `${pickWrong ? `pick:${pick.name}@${pick.slot}` : '-'}|${weaponWrong ? `weapon:${weapon.name}@${weapon.slot}|held:${bot.heldItem?.name ?? '-'}` : '-'}` };
}
async function idleArms(agent) {
    const bot = agent.bot;
    if (bot.rotnModelEquip) return null;
    const wrong = armsWrong(bot);
    if (!wrong) { agent.rotnIdleArmsSaid = null; return null; }
    if (agent.rotnIdleArmsSaid === wrong.state) return null;
    agent.rotnIdleArmsSaid = wrong.state;
    agent.rotnIdleHandsBusy = true;
    try {
        console.log(`[hands] idle: ${[wrong.pickWrong ? 'the pickaxe is not in the off hand' : null, wrong.weaponWrong ? 'the weapon is not in the main hand' : null].filter(Boolean).join(' and ')}: re-arming`);
        await withHandsLock(bot, () => rearmWeapon(bot));
        return wrong.state;
    } catch (err) {
        console.warn(`[hands] idle re-arm failed: ${err?.message ?? err}`);
        return wrong.state;
    } finally { agent.rotnIdleHandsBusy = false; }
}

/**
 * Soak 16 death 2 (the lead's go): a hen was hit by the bot (rotn-data: Better Combat attacks exactly the entity id it is
 * sent, so some bot.attack call named the hen) and pecked it to death; the bridge counted a second caller in that
 * minute ("replaced 1"). A guard on bot.attack, installed above the bridge's Better Combat replacement like the dig
 * wrapper: a passive animal or a player is hit only when it is the target the calling skill named
 * (bot.rotnAttackTarget: attackEntity, defendSelf, the reflex's attackWatched); hostile mobs are never refused. Each
 * first swing at a new target names its caller, for the evidence.
 */
export const ATTACK_GUARD = { targetMs: 120_000 };
const PASSIVE = new Set(['ignore', 'ignore-unless-provoked']);

/** The skill about to hit `entity` names it (and itself) for the guard. */
export function noteAttackTarget(bot, entity, by) {
    if (bot && entity?.id != null) bot.rotnAttackTarget = { id: entity.id, by, at: Date.now() };
}

/** Why the guard refuses a hit on `target` now, or null. */
export function attackRefusal(bot, target, threatFor, now = Date.now()) {
    if (!target || target.id == null) return null;
    const player = target.type === 'player';
    let reaction = null;
    try { reaction = threatFor?.(target)?.reaction ?? null; } catch { reaction = null; }
    if (!player && !PASSIVE.has(reaction)) return null; // hostile or unknown: never refused
    const t = bot.rotnAttackTarget;
    if (t && t.id === target.id && now - t.at <= ATTACK_GUARD.targetMs) return null;
    const what = player ? 'a player' : reaction === 'ignore' ? 'a food animal' : 'an animal left alone unless provoked';
    return `${what}, not the target the skill named${t ? ` (${t.by} named #${t.id})` : ''}`;
}

export function installAttackGuard(bot, { threatFor = null } = {}) {
    if (!bot) return;
    const said = new Set();
    let lastTarget = null;
    const wrap = () => {
        const original = bot.attack;
        // #652 review 4: one guard per bot: once in the chain (survival_log's marking wrapper may sit above it), a
        // respawn's or a login's re-install adds no second layer.
        if (typeof original !== 'function' || original.rotnGuard || bot.rotnAttackGuardOn) return;
        const guarded = function (target, ...rest) {
            const why = attackRefusal(bot, target, threatFor);
            if (why) {
                const key = `${target.id}`;
                if (!said.has(key)) { said.add(key); console.log(`[attack] refused: ${target.name ?? 'entity'}#${target.id} is ${why}`); }
                return Promise.resolve({ sent: false, path: null, waitedMs: 0, reason: 'guard' });
            }
            if (target?.id != null && target.id !== lastTarget) {
                lastTarget = target.id;
                const t = bot.rotnAttackTarget;
                console.log(`[attack] ${t && t.id === target.id ? t.by : 'unnamed'} -> ${target.name ?? 'entity'}#${target.id}`);
            }
            return original.call(this ?? bot, target, ...rest);
        };
        guarded.rotnGuard = true;
        bot.rotnAttackGuardOn = guarded;
        // Keep the marks the wrappers below set (survival_log's rotnMarks sits above; the bridge's own fields).
        bot.attack = guarded;
    };
    wrap();
    if (typeof bot.on === 'function' && !bot.rotnAttackGuardHooked) {
        bot.rotnAttackGuardHooked = true;
        bot.on('login', wrap);
        bot.on('spawn', wrap);
    }
}
