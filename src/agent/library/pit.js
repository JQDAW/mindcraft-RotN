// skills-rotn, G3 round 9 batch B, fix (h): a shelter that needs nothing in the inventory.
// After the night-time death the bot respawned 9 blocks from where it died with nothing; the
// shelter needs 10 dirt, so it was refused, the model dug dirt next to the death spot and died
// again to the zombie that had risen there ("slain by Zombie FRCFLD", server.log 575).
//
// The hole: dig straight down 3 blocks by hand at a spot of hand-diggable ground. The bot then
// stands with its feet 3 below the surface; the ground around it is the walls, the block under it
// the floor, and the roof goes into the top cell of the hole (flush with the ground, where it has
// ground on every side to be placed against). The dug blocks give dirt piles, and the roof is one
// dirt crafted from them (the shelter's own repair does the crafting and the placing).
// In the morning: the roof and three blocks of one side are dug by hand into a staircase, and the
// bot walks up it. Zombies dig dirt too (Epic Siege Mod), so the night routine checks the hole
// like any shelter.
//
//    surface (P)      .  .  .  .        P = the cell the bot stood in before digging
//    ground (P-1)   G  R  s  s  G       R = roof, s = dug for the stairs (side d, 2d)
//    (P-2)          G  .  s  G  G       . = the bot's two cells (feet at P-3)
//    (P-3)          G  .  G  G  G       G = ground (walls, floor, the steps)
//    (P-4)          G  G  G  G  G
import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { isWall, handDiggable, dumpState } from './night.js';
import { isLiquid, isEmpty, isFalling } from './shelter.js';
import { log, breakBlockAt, goToGoal } from './skills.js';
import { worldSources } from './rotn_sources.js';
import { blockMatcher } from './rotn_names.js';

/**
 * depth: blocks dug below the surface; radius: how far from the bot a spot is looked for;
 * awayFrom: how far from the death spot the bot first walks (Epic Siege Mod's awareness radius
 * is 16; the death-spot rule's radius is 24); walkMs and fallMs bound the walks and each drop.
 */
export const PIT = { depth: 3, radius: 3, awayFrom: 28, walkMs: 60_000, fallMs: 2000, maxHardness: 1, digSlackMs: 4000 };

const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const at = (p) => `${p.x}, ${p.y}, ${p.z}`;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const solid = (b) => !!b && b.boundingBox === 'block' && !isLiquid(b);
/**
 * Soak 2 (rotn-v0.1.4, night 2): a hole column the dump calls hand-diggable (toolRequired false) can
 * still take 30 s by hand: Dynamic Trees' rootydirt has hardness 20. The first block never broke
 * before the unstuck reflex moved the bot, again and again. Only blocks at most PIT.maxHardness hard
 * (dirt 0.5, grass, sand, gravel, clay 0.6: about a second by hand) make a hole.
 */
export const quickByHand = (b) => handDiggable(b) && (dumpState(b)?.hardness ?? Infinity) <= PIT.maxHardness;
const diggable = (b) => solid(b) && quickByHand(b) && !isFalling(b);

/**
 * The blocks that give dirt piles by hand (rotn-data's rules for betterwithmods:dirt_pile with no
 * tool: dirt, grass, mycelium, farmland, ...): the roof is a dirt crafted from them (#337 review 3:
 * a column of clay would give no roof).
 */
let pileMatchers = null;
function givesPiles(block) {
    if (!block) return false;
    if (!pileMatchers) {
        try { pileMatchers = worldSources('betterwithmods:dirt_pile').filter(s => !s.tool).map(s => blockMatcher(s.blocks)); }
        catch { pileMatchers = []; }
    }
    return pileMatchers.some(matches => matches(block));
}

/** The way out of a hole whose top cell is at P-1, towards d: what must be dug, and what must be firm. */
function stairsFor(P, d) {
    const p = (k, dy) => P.plus(d.scaled(k)).offset(0, dy, 0);
    return {
        dig: [p(1, -2), p(1, -1), p(2, -1)],           // step 1's space, step 2's space
        firm: [p(1, -3), p(2, -2), p(3, -1)],          // what each step stands on
        air: [p(1, 0), p(2, 0), p(2, 1), p(3, 0), p(3, 1)], // headroom and the exit cell
        exit: p(3, 0),
    };
}

/**
 * The stairs out towards d as a plan, or null: what to dig (the steps' spaces, and any headroom or
 * exit cell that is not free, when it can be dug by hand: #337 review 5) and the exit cell.
 */
function stairsPlan(bot, P, d) {
    const s = stairsFor(P, d);
    if (!s.dig.every(q => diggable(bot.blockAt(q))) || !s.firm.every(q => solid(bot.blockAt(q)))) return null;
    const extra = s.air.filter(q => !isEmpty(bot.blockAt(q)));
    if (!extra.every(q => diggable(bot.blockAt(q)))) return null;
    return { dig: [...s.dig, ...extra], exit: s.exit };
}

/**
 * Why P (the cell the bot would stand in on the surface) is no place for a hole, or null:
 * {why}. Needs: P free and on hand-diggable ground three deep, a floor, walls of solid ground
 * with no liquid or falling block anywhere around, and one side to dig stairs out of by hand.
 */
export function pitProblem(bot, P) {
    const b = (q) => bot.blockAt(q);
    if (!isEmpty(b(P)) || !isEmpty(b(P.offset(0, 1, 0)))) return { why: 'the space is not free' };
    const column = [1, 2, 3].map(k => P.offset(0, -k, 0));
    const bad = column.find(q => !diggable(b(q)));
    if (bad) return { why: `${b(bad)?.name ?? 'nothing'} at ${at(bad)} cannot be dug by hand` };
    if (!column.some(q => givesPiles(b(q)))) return { why: `nothing at ${at(column[0])} to ${at(column[2])} gives dirt piles for the roof` };
    const floor = P.offset(0, -4, 0);
    // #337 review 4: not a floor that falls (gravel over a cave).
    if (!solid(b(floor)) || isFalling(b(floor))) return { why: `no firm floor at ${at(floor)}` };
    for (const d of HORIZONTAL) {
        for (const dy of [-1, -2, -3]) {
            const q = P.plus(d).offset(0, dy, 0);
            // What the shelter's check counts as a wall (rock or dirt), or every check finds it open.
            if (dy !== -1 && !isWall(b(q))) return { why: `${b(q)?.name ?? 'nothing'} at ${at(q)} is no wall` };
            if (dy === -1 && !solid(b(q))) return { why: `nothing to hold the roof at ${at(q)}` };
        }
    }
    const near = [];
    for (const d of HORIZONTAL) for (const dy of [-1, -2, -3, -4]) near.push(P.plus(d).offset(0, dy, 0), P.plus(d).plus(d).offset(0, dy, 0));
    const wet = near.find(q => isLiquid(b(q)) || isFalling(b(q)));
    if (wet) return { why: `${b(wet).name} at ${at(wet)} would flow or fall in` };
    // #337 review 1: without a pickaxe the shelter's roofing needs a side whose two cells (beside the
    // bot's feet and head) are dug by hand, or it refuses the roof and the hole stays open.
    if (!HORIZONTAL.some(d => [-3, -2].every(dy => handDiggable(b(P.plus(d).offset(0, dy, 0))))))
        return { why: 'no side beside the bottom of the hole could be dug out by hand' };
    if (!HORIZONTAL.some(d => stairsPlan(bot, P, d))) return { why: 'no side to dig stairs out of by hand' };
    return null;
}

/** The nearest surface cell within PIT.radius (and 1 up or down) where a hole can be dug, or null. */
export function choosePit(bot, radius = PIT.radius, bad = new Set()) {
    const base = bot.entity.position.floored();
    let best = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        const P = base.offset(dx, dy, dz);
        if (bad.has(at(P)) || pitProblem(bot, P)) continue;
        const d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (!best || d < best.d) best = { P, d };
    }
    return best?.P ?? null;
}

/** A walk bounded by ms; at the limit the pathfinder is stopped (#337 review 2), not left walking. */
async function boundedWalk(bot, promise, ms) {
    let timer;
    try {
        const r = await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), ms); })]);
        if (r === 'timeout') {
            try { bot.pathfinder?.stop?.(); bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.(); } catch { /* best effort */ }
            Promise.resolve(promise).catch(() => {}); // it ends as a stopped walk
        }
        return r;
    } finally { clearTimeout(timer); }
}

/** Wait (bounded) until the bot's feet are at y. */
async function landAt(bot, y) {
    for (let waited = 0; Math.floor(bot.entity.position.y) > y && waited < PIT.fallMs; waited += 50) await sleep(50);
    return Math.floor(bot.entity.position.y) === y;
}

/**
 * Dig the hole (the night routine then roofs it with the shelter's repair). Walks to the chosen
 * cell, digs the three blocks below it one by one, dropping one block each time. Returns the
 * feet position in the hole, or null (said in the log). progress.P records the hole: a dig that
 * was interrupted goes on from where the bot is in it (#337 review 6).
 */
export async function digPit(bot, { radius = PIT.radius, progress = {} } = {}) {
    const here = bot.entity.position.floored();
    const resume = !!progress.P && here.x === progress.P.x && here.z === progress.P.z
        && here.y <= progress.P.y && here.y >= progress.P.y - PIT.depth;
    progress.bad ??= new Set(); // spots whose block took too long to dig (left alone this night)
    const P = resume ? progress.P : choosePit(bot, radius, progress.bad);
    progress.P = P;
    if (!P) {
        log(bot, `No place for a hole shelter within ${radius} blocks (needs ground you can dig by hand 3 deep, no water or sand around, and a side to dig stairs out of).`);
        return null;
    }
    if (!resume && !bot.entity.position.floored().equals(P)) {
        try { await boundedWalk(bot, goToGoal(bot, new pf.goals.GoalBlock(P.x, P.y, P.z), { canDig: false }), PIT.walkMs); } catch { /* checked below */ }
        if (!bot.entity.position.floored().equals(P)) {
            log(bot, `Could not reach the place for a hole shelter at ${at(P)}.`);
            return null;
        }
    }
    log(bot, `${resume ? 'Going on with' : 'Digging'} a hole shelter at ${at(P)}: 3 blocks down by hand, then a roof of dirt from the piles.`);
    // Soak 2: the bot stands still on purpose while it digs (the unstuck reflex leaves it alone, as
    // for the shelter build); each block has its own time limit instead.
    const wasStationary = bot.rotnStationary;
    bot.rotnStationary = true;
    try {
        for (let k = 1; k <= PIT.depth; k++) {
            const q = P.offset(0, -k, 0);
            if (bot.entity.position.floored().y <= q.y) continue; // dug before the interruption
            if (bot.interrupt_code) return null;
            const block = bot.blockAt(q);
            let estMs = null;
            try { estMs = bot.digTime?.(block) ?? null; } catch { estMs = null; }
            const limitMs = Math.max(PIT.digSlackMs, 2 * (Number.isFinite(estMs) ? estMs : 0));
            log(bot, `Digging ${block?.name ?? 'the block'} at ${at(q)}${Number.isFinite(estMs) ? ` (about ${(estMs / 1000).toFixed(1)} s by hand)` : ''}.`);
            const dug = await digWithin(bot, q, limitMs);
            if (dug === 'timeout') {
                progress.bad.add(at(P));
                progress.P = null;
                log(bot, `Digging ${block?.name ?? 'the block'} at ${at(q)} took over ${(limitMs / 1000).toFixed(1)} s; leaving this spot for another.`);
                return null;
            }
            if (!dug) {
                log(bot, `Could not dig ${bot.blockAt(q)?.name ?? 'the block'} at ${at(q)} for the hole shelter.`);
                return null;
            }
            if (!await landAt(bot, q.y)) {
                log(bot, `Did not drop into the hole at ${at(q)}.`);
                return null;
            }
        }
    } finally {
        bot.rotnStationary = wasStationary ?? false;
    }
    return P.offset(0, -PIT.depth, 0);
}

/** breakBlockAt bounded by ms: true, false, or 'timeout' (the dig is stopped). */
async function digWithin(bot, q, ms) {
    let timer;
    const dig = breakBlockAt(bot, q.x, q.y, q.z);
    try {
        const r = await Promise.race([dig, new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), ms); })]);
        if (r === 'timeout') {
            try { bot.stopDigging?.(); } catch { /* best effort */ }
            Promise.resolve(dig).catch(() => {}); // it ends as an aborted dig
        }
        return r;
    } finally { clearTimeout(timer); }
}

/**
 * Out of the hole in the morning: dig the roof and one side's stairs by hand, then walk up them.
 * Returns the exit cell on the surface, or null.
 */
export async function pitOut(bot, feet) {
    const P = feet.offset(0, PIT.depth, 0);
    const roof = feet.offset(0, 2, 0);
    // #337 review 5: a side to get out by first; the roof stays on when there is none.
    const plans = HORIZONTAL.map(d => stairsPlan(bot, P, d)).filter(Boolean);
    if (plans.length === 0) {
        log(bot, `No side of the hole shelter at ${at(feet)} to dig stairs out of by hand; staying in it.`);
        return null;
    }
    if (!isEmpty(bot.blockAt(roof)) && !await breakBlockAt(bot, roof.x, roof.y, roof.z)) return null;
    for (const s of plans) {
        let dug = true;
        for (const q of s.dig) dug &&= isEmpty(bot.blockAt(q)) || await breakBlockAt(bot, q.x, q.y, q.z);
        if (!dug) continue;
        try { await boundedWalk(bot, goToGoal(bot, new pf.goals.GoalBlock(s.exit.x, s.exit.y, s.exit.z), { canDig: false }), PIT.walkMs); } catch { /* checked below */ }
        if (bot.entity.position.floored().equals(s.exit)) return s.exit;
    }
    return null;
}

/**
 * Walk until at least `dist` from pos (the death spot), bounded by PIT.walkMs. Returns whether the
 * bot is that far now.
 */
export async function moveAwayFrom(bot, pos, dist = PIT.awayFrom) {
    const far = () => bot.entity.position.distanceTo(new Vec3(pos.x, pos.y, pos.z)) >= dist;
    if (far()) return true;
    const goal = new pf.goals.GoalInvert(new pf.goals.GoalNear(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), dist));
    try { await boundedWalk(bot, goToGoal(bot, goal), PIT.walkMs); } catch { /* checked below */ }
    return far();
}
