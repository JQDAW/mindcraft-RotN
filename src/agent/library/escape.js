// Soak 8 (rotn-v0.1.14, #558): the bot sat in one block (-89.5, 61, -126.7) for about 36 min: legs
// in flowing water, stone below, a stone overhang above. Every walk out was "Path not found" (the
// pathfinder's check is one 40 ms tick of its search: skills.planPath), its destructive fallback was
// cut by the unstuck reflex, which only re-planned, and the shelter and the hole had no place there.
// The lead's escape plan (approved, PR 1): getting out comes first, before any shelter.
//
//   1. The pathfinder with real time (ESCAPE.planMs, through planPath) and digging and 1x1 towers
//      allowed (at most ESCAPE.maxPlaced held blocks, the shelter's reserve too; digging preferred),
//      never a flow of water or lava, no parkour, the fall-safe drops; at most ESCAPE.walkMs.
//   2. If it finds no way: a staircase dug by hand toward the target (dry ground with open sky
//      within ESCAPE.targetRadius, else straight up toward the sky), ESCAPE.maxSteps steps, never a
//      cell next to or under a liquid; where no stair step is possible, a one-step pillar (jump and
//      place a block below), within the same block budget.
//   The whole escape takes at most ESCAPE.totalMs; bot.rotnEscaping holds the unstuck reflex off
//   meanwhile (modes.js).

import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { isEmpty, isLiquid, isFalling, hurtsOnContact, shelterItems, softItems, countOf } from './shelter.js';
import { burrowDiggable, digEquip } from './burrow.js';
import { digWithin, digBudget } from './pit.js';
import { goodFloor, inWater, boundedWalk } from './shelter_ground.js';
import { fallSafe } from './fall_safety.js';
import { planPath } from './skills.js';

/**
 * planMs: the pathfinder's search; walkMs: its walk; totalMs: the whole escape; maxPlaced: blocks
 * placed (towers and pillars); maxSteps: stair and pillar steps by hand; targetRadius: how far dry
 * ground is looked for; skyCheck: how high above the bot the sky is looked for; moveMs: the move
 * into a stair step; jumpMs/landMs: a pillar's jump and landing; countMs: how often the held blocks
 * are counted during the pathfinder's walk (each drop is a placement).
 */
export const ESCAPE = { planMs: 5000, walkMs: 60_000, totalMs: 90_000, maxPlaced: 8, maxSteps: 24, targetRadius: 8, skyCheck: 40, moveMs: 3000, jumpMs: 1000, landMs: 1500, countMs: 50 };

const UP = new Vec3(0, 1, 0);
const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const SIX = [...HORIZONTAL, UP, new Vec3(0, -1, 0)];
const at = (p) => `${p.x}, ${p.y}, ${p.z}`;
const key = (p) => `${p.x},${p.y},${p.z}`;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const feetOf = (bot) => bot.entity.position.floored();
const solid = (b) => !!b && b.boundingBox === 'block' && !isLiquid(b) && !hurtsOnContact(b);

/** Nothing but air (or unloaded) above p's head cell up to skyCheck: open sky. Water above is not. */
export function openSky(bot, p) {
    for (let y = p.y + 2; y <= p.y + ESCAPE.skyCheck; y++) {
        const b = bot.blockAt(new Vec3(p.x, y, p.z));
        if (!b) return true;
        if (!isEmpty(b)) return false;
    }
    return true;
}

/** Out: not in a liquid, on a good floor (shelter_ground.goodFloor), and under open sky or at the target. */
export function isOut(bot, target = null) {
    const p = feetOf(bot);
    if (inWater(bot) || !goodFloor(bot, p)) return false;
    return openSky(bot, p) || (!!target && Math.abs(p.x - target.x) <= 1 && Math.abs(p.y - target.y) <= 1 && Math.abs(p.z - target.z) <= 1);
}

/** Where to get out to: the nearest dry cell (free, no liquid, good floor) under open sky within targetRadius (and 4 up, 2 down), or null (then: up toward the sky). */
export function escapeTarget(bot) {
    const base = feetOf(bot);
    const r = ESCAPE.targetRadius;
    let best = null;
    for (let dy = -2; dy <= 4; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const p = base.offset(dx, dy, dz);
        if (!isEmpty(bot.blockAt(p)) || !isEmpty(bot.blockAt(p.offset(0, 1, 0))) || !goodFloor(bot, p) || !openSky(bot, p)) continue;
        const d = Math.abs(dx) + Math.abs(dz) + Math.abs(dy);
        if (!best || d < best.d) best = { p, d };
    }
    return best?.p ?? null;
}

/** The first air cell above the highest block over the bot (within skyCheck): the height the sky starts at. */
export function skyY(bot) {
    const p = feetOf(bot);
    for (let y = p.y + ESCAPE.skyCheck; y >= p.y + 2; y--) {
        const b = bot.blockAt(new Vec3(p.x, y, p.z));
        if (b && !isEmpty(b)) return y + 1;
    }
    return p.y;
}

/** The blocks the bot may build with (shelterItems, softItems): stacks and their count. */
const buildStacks = (bot) => [...shelterItems(bot), ...softItems(bot)];
const buildCount = (bot) => countOf(buildStacks(bot));

/**
 * The pathfinder's movements for the escape: fall-safe; digging and 1x1 towers with the held blocks;
 * digging preferred; no flow, no parkour, no sprint. #562 review 2: the planner sees at most the
 * blocks left in the budget (ESCAPE.maxPlaced - state.placed), whatever the bot holds.
 */
export function escapeMovements(bot, state = { placed: 0 }) {
    const m = fallSafe(new pf.Movements(bot));
    const held = typeof m.countScaffoldingItems === 'function' ? m.countScaffoldingItems.bind(m) : () => buildCount(bot);
    m.countScaffoldingItems = () => Math.max(0, Math.min(held(), ESCAPE.maxPlaced - state.placed));
    m.canDig = true;
    m.allow1by1towers = true;
    m.allowParkour = false;
    m.allowSprinting = false;
    m.dontCreateFlow = true;
    m.scafoldingBlocks = [...new Set(buildStacks(bot).map(s => s.type).filter(Number.isInteger))];
    m.digCost = 1;
    m.placeCost = 8; // the lead: digging over placing when both work
    return m;
}

/**
 * A cell can be dug for the escape: empty already, or diggable (burrow.burrowDiggable: by hand or a
 * held tool, never a tree part), with no liquid next to it or above it (ours excepted: the bot's own
 * two cells, and the other cells of the same step), and nothing that falls above it.
 */
function safeToDig(bot, c, ours) {
    const b = bot.blockAt(c);
    if (!b || isLiquid(b)) return false;
    if (isEmpty(b)) return true;
    if (!burrowDiggable(bot, b)) return false;
    for (const d of SIX) {
        const q = c.plus(d);
        if (ours.has(key(q))) continue;
        const n = bot.blockAt(q);
        if (isLiquid(n)) return false;
        if (d.y === 1 && isFalling(n)) return false;
    }
    return true;
}

/**
 * The next step by hand, or {why}: {kind: 'stair', d, dig, to} (up one, toward d: the headroom over
 * the bot, the new feet and head cells; the block toward d stays to stand on), toward the target
 * first; else {kind: 'pillar', dig} (the headroom; then a block placed in the feet cell), when the bot
 * stands on solid ground and has a block left in the budget.
 */
export function nextStep(bot, target, state) {
    const p = feetOf(bot);
    const head2 = p.offset(0, 2, 0);
    const toward = (d) => (target ? -(d.x * (target.x - p.x) + d.z * (target.z - p.z)) : 0);
    const stairs = [];
    for (const d of [...HORIZONTAL].sort((a, b) => toward(a) - toward(b))) {
        const to = p.plus(d).offset(0, 1, 0);
        const cells = [head2, to, to.offset(0, 1, 0)];
        const ours = new Set([key(p), key(p.offset(0, 1, 0)), ...cells.map(key)]);
        if (!solid(bot.blockAt(p.plus(d)))) continue; // the step stood on
        // #562 review 6: the new feet and head cells must not touch one of the bot's own cells that
        // holds a liquid (its head under water): dug, they would let that water through.
        if ([to, to.offset(0, 1, 0)].some(c => SIX.some(e => { const q = c.plus(e); return (q.equals(p) || q.equals(p.offset(0, 1, 0))) && isLiquid(bot.blockAt(q)); }))) continue;
        if (!cells.every(c => safeToDig(bot, c, ours))) continue;
        stairs.push({ kind: 'stair', d, to, dig: cells.filter(c => !isEmpty(bot.blockAt(c))) });
        break;
    }
    if (stairs.length) return stairs[0];
    if (!solid(bot.blockAt(p.offset(0, -1, 0)))) return { why: `nothing solid under the feet at ${at(p)} to pillar up from` };
    if (state.placed >= ESCAPE.maxPlaced) return { why: `no stair step, and the ${ESCAPE.maxPlaced} blocks for pillars are spent` };
    if (buildCount(bot) < 1) return { why: 'no stair step, and no block to pillar up with' };
    const ours = new Set([key(p), key(p.offset(0, 1, 0)), key(head2)]);
    if (!safeToDig(bot, head2, ours) || !safeToDig(bot, head2.offset(0, 1, 0), new Set([...ours, key(head2.offset(0, 1, 0))])))
        return { why: `no stair step, and no room to pillar up above ${at(p)}` };
    return { kind: 'pillar', dig: [head2, head2.offset(0, 1, 0)].filter(c => !isEmpty(bot.blockAt(c))) };
}

/**
 * Dig a cell within its budget (pit.digWithin, burrow.digEquip), and never past the deadline
 * (#562 review 3): true when it is empty after; 'time' when no time is left for it.
 */
async function digCell(bot, c, deadline) {
    const block = bot.blockAt(c);
    if (isEmpty(block)) return true;
    const left = deadline - Date.now();
    if (left <= 0) return 'time';
    const equip = digEquip(bot, block);
    const r = await digWithin(bot, block, Math.min(digBudget(bot, block).limitMs, left), equip ? { equip } : {});
    if (r === 'timeout' && Date.now() >= deadline) return 'time';
    return r === true && isEmpty(bot.blockAt(c));
}

/** Into the stair step at `to`: look at it, forward and jump until the feet are in it (at most moveMs). */
export async function stepInto(bot, to) {
    const c = to.offset(0.5, 0, 0.5);
    try {
        await bot.lookAt(new Vec3(c.x, to.y + 1.6, c.z), true);
        bot.setControlState('forward', true);
        bot.setControlState('jump', true);
        for (let waited = 0; !feetOf(bot).equals(to) && waited < ESCAPE.moveMs; waited += 50) await sleep(50);
    } finally {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
    }
    return feetOf(bot).equals(to);
}

/**
 * One pillar step (also !placeHere in the bot's own cell, PR 2): with a block in hand, look down,
 * jump, and at the top of the jump place it on the block under the feet; then land on it. True when
 * the feet are one up and the old feet cell is solid. item: the stack to place.
 */
export async function pillarUp(bot, item) {
    const p = feetOf(bot);
    const floor = bot.blockAt(p.offset(0, -1, 0));
    if (!item || !solid(floor)) return false;
    try {
        await bot.equip(item, 'hand');
        await bot.look(bot.entity.yaw ?? 0, -Math.PI / 2, true);
        bot.setControlState('jump', true);
        for (let waited = 0; bot.entity.position.y < p.y + 1 && waited < ESCAPE.jumpMs; waited += 25) await sleep(25);
        // #562 review 7: a jump that did not get the feet out of the cell: no block into the bot's own cell.
        if (bot.entity.position.y < p.y + 1) return false;
        try { await bot.placeBlock(floor, UP); } catch { /* checked below: the server may confirm late */ }
    } finally {
        bot.setControlState('jump', false);
    }
    for (let waited = 0; feetOf(bot).y !== p.y + 1 && waited < ESCAPE.landMs; waited += 50) await sleep(50);
    return solid(bot.blockAt(p)) && feetOf(bot).y === p.y + 1;
}

/** Stage 1: the pathfinder (escapeMovements), a search of planMs, a walk of walkMs, within the block budget. */
async function byPathfinder(bot, target, state, deadline, say) {
    if (typeof bot.pathfinder?.goto !== 'function') return { why: 'no pathfinder' };
    const m = escapeMovements(bot, state);
    const goal = target ? new pf.goals.GoalBlock(target.x, target.y, target.z) : new pf.goals.GoalY(skyY(bot));
    const plan = await planPath(bot, m, goal, ESCAPE.planMs);
    if (plan?.status !== 'success') return { why: `the pathfinder found no way (${plan?.status ?? 'no result'})` };
    say(`[escape] the pathfinder found a way (${plan.path?.length ?? '?'} moves): walking it`);
    // #562 review 2: placements are the drops in the held count (a dug block adds to it): each
    // drop is counted as it happens, never netted against a dig.
    let last = buildCount(bot);
    const count = () => { const now = buildCount(bot); if (now < last) state.placed += last - now; last = now; };
    const counter = setInterval(count, ESCAPE.countMs);
    // #562 review 4: the movements before the escape come back after it (a raw setGoal, such as
    // useDoor's, would otherwise walk with towers and digging).
    const before = bot.pathfinder.movements ?? null;
    bot.pathfinder.setMovements(m);
    let r;
    try {
        r = await boundedWalk(bot, () => bot.pathfinder.goto(goal), Math.min(ESCAPE.walkMs, Math.max(0, deadline - Date.now())),
            () => { count(); return state.placed >= ESCAPE.maxPlaced ? 'blocks' : bot.interrupt_code ? 'interrupted' : null; });
    } finally {
        clearInterval(counter);
        count();
        if (before) { try { bot.pathfinder.setMovements(before); } catch { /* best effort */ } }
    }
    return isOut(bot, target) ? { out: true } : { why: r.stopped === 'blocks' ? `the pathfinder used the ${ESCAPE.maxPlaced} blocks` : r.stopped ? `the pathfinder's walk stopped (${r.stopped})` : `the pathfinder's walk did not get out${r.why ? ` (${r.why})` : ''}` };
}

/** Stage 2: steps by hand (nextStep), at most maxSteps, until out. */
async function byHand(bot, target, state, deadline, { moveTo, pillar }) {
    for (let i = 0; i < ESCAPE.maxSteps; i++) {
        if (isOut(bot, target)) return { out: true };
        if (bot.interrupt_code) return { why: 'interrupted' };
        if (Date.now() >= deadline) return { why: `the ${ESCAPE.totalMs / 1000} s ran out` };
        const step = nextStep(bot, target, state);
        if (step.why) return { why: step.why };
        const late = { why: `the ${ESCAPE.totalMs / 1000} s ran out` };
        for (const c of step.dig) {
            if (bot.interrupt_code) return { why: 'interrupted' };
            const dug = await digCell(bot, c, deadline);
            if (dug === 'time') return late;
            if (!dug) return { why: `could not dig ${bot.blockAt(c)?.name ?? 'the block'} at ${at(c)}` };
            state.dug++;
        }
        if (Date.now() >= deadline) return late; // #562 review 3: and before the step
        if (step.kind === 'stair') {
            if (!await moveTo(bot, step.to)) return { why: `could not step up into ${at(step.to)}` };
            state.stairs++;
        } else {
            const item = buildStacks(bot)[0];
            if (!await pillar(bot, item)) return { why: `could not pillar up from ${at(feetOf(bot))}` };
            state.placed++;
            state.pillars++;
        }
    }
    return isOut(bot, target) ? { out: true } : { why: `${ESCAPE.maxSteps} steps were not enough` };
}

/**
 * Get out of a pit or the water (the lead's escape plan). Returns {out, how: 'already'|'pathfinder'|
 * 'by hand'|null, dug, placed, stairs, pillars, at, why, interrupted, ms}. Never throws.
 * moveTo, pillar, say: the tests' own.
 */
export async function escape(bot, { moveTo = stepInto, pillar = pillarUp, say = (l) => console.log(l) } = {}) {
    const t0 = Date.now(), deadline = t0 + ESCAPE.totalMs;
    const state = { dug: 0, placed: 0, stairs: 0, pillars: 0 };
    // #562 review 5: interrupted: stopped by something else (a reflex, a command), not a failure.
    const done = (out, how, why = null) => ({ out, how, why, interrupted: !out && (why === 'interrupted' || !!bot.interrupt_code), ...state, at: feetOf(bot), ms: Date.now() - t0 });
    try {
        if (isOut(bot)) return done(true, 'already');
        const target = escapeTarget(bot);
        const from = feetOf(bot);
        say(`[escape] stuck at ${at(from)}${inWater(bot) ? ' in water' : ''}: getting out ${target ? `to ${at(target)} (dry ground under open sky)` : `upward (the sky starts at y ${skyY(bot)})`}`);
        bot.rotnEscaping = true;
        const first = await byPathfinder(bot, target, state, deadline, say);
        if (first.out) return report(done(true, 'pathfinder'), say);
        if (bot.interrupt_code) return report(done(false, null, 'interrupted'), say);
        say(`[escape] ${first.why}; digging out by hand`);
        const second = await byHand(bot, target, state, deadline, { moveTo, pillar });
        return report(second.out ? done(true, 'by hand') : done(false, null, second.why), say);
    } catch (err) {
        return report(done(false, null, err?.message ?? String(err)), say);
    } finally {
        bot.rotnEscaping = false;
        try { bot.clearControlStates?.(); } catch { /* best effort */ }
    }
}

function report(r, say) {
    say(r.out ? `[escape] out at ${at(r.at)} (${r.how}; dug ${r.dug}, placed ${r.placed}) in ${(r.ms / 1000).toFixed(1)} s`
        : `[escape] still stuck at ${at(r.at)} after ${(r.ms / 1000).toFixed(1)} s (dug ${r.dug}, placed ${r.placed}): ${r.why}`);
    return r;
}
