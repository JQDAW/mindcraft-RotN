// Soak 8 (rotn-v0.1.14, night 2): at sunset the bot was in a river channel (y 59-61, flowing water,
// a sand bank, a stone overhang). The shelter search (shelter.chooseSite: 4 blocks across, 2 up or
// down) and the hole (pit.choosePit) found no place there, and the 3 tries and 4 quiet retries all
// ran from the same spot: the bot spent the night in the open, in the water, eels near.
// The lead's plan (approved): on "no place" for both, walk to better ground (higher, dry, solid) and
// shelter there, bounded; if there is none, at least out of the water, and no retry from the same
// cell (night_routine.js).
//
//   groundPlan:   the place to walk to: the last shelter (within lastShelterMax, if a shelter or a
//                 hole still fits there), else the best surface cell within `radius` where a shelter
//                 or a hole fits, with no hostile mob near the way.
//   walkToGround: the fall-safe walk there (within `near`), at most walkMs, stopped when a hostile
//                 mob comes within stopRange.
//   stepToDry:    out of the water to the nearest dry, solid cell within dryRadius.

import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { siteNeeds, isEmpty, isLiquid, firmFloor } from './shelter.js';
import { isSturdy, isWall } from './night.js';
import { pitProblem } from './pit.js';
import { goToGoal } from './skills.js';
import { shelterEnemy } from './threats.js';
import { hostileNearWay } from '../respawn_relocate.js';

/**
 * radius: how far across the search looks (unarmedRadius at night with no weapon); below/above: the
 * surface cell looked for in each column, from `above` over the bot's feet down to `below` under
 * them; lastShelterMax: the last shelter comes first within this; holeBlocks: what a hole counts as
 * in the score (it needs no blocks, but a shelter on open ground takes about this many, and a hole is
 * the weaker shelter); walkMs, near, stopRange: the walk; maxMoves: walks a night; dryRadius,
 * dryWalkMs: the step out of the water; hostileWay: a hostile mob this near the straight way skips
 * a place (respawn_relocate.hostileNearWay).
 */
export const GROUND = {
    radius: 24, unarmedRadius: 12, below: 4, above: 8, lastShelterMax: 48, holeBlocks: 10,
    walkMs: 45_000, near: 1, stopRange: 8, checkMs: 500, maxMoves: 2,
    dryRadius: 8, dryWalkMs: 20_000, hostileWay: 16,
};

const at = (p) => `${p.x}, ${p.y}, ${p.z}`;
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const key = (p) => `${p.x},${p.y},${p.z}`;

/** A shelter fits at feet as chooseSite would take it (rock walls, else dirt walls): {kind, blocks}, else a hole fits: {kind: 'hole'}, else null. */
export function fitsAt(bot, feet) {
    for (const accept of [isSturdy, isWall]) {
        const need = siteNeeds(bot, feet, { accept });
        if (need && !need.unsafe && need.unsupported.length === 0) return { kind: 'shelter', blocks: need.blocks };
    }
    if (!pitProblem(bot, feet)) return { kind: 'hole', blocks: GROUND.holeBlocks };
    return null;
}

/** The surface cell of the column x, z: the highest free (no liquid) 1x2 space on a firm floor, from y0 + above down to y0 - below; null if none or not loaded. */
export function surfaceAt(bot, x, z, y0, { above = GROUND.above, below = GROUND.below } = {}) {
    for (let y = y0 + above; y >= y0 - below; y--) {
        const p = new Vec3(x, y, z);
        const feetB = bot.blockAt(p), headB = bot.blockAt(p.offset(0, 1, 0)), floorB = bot.blockAt(p.offset(0, -1, 0));
        if (!feetB || !headB || !floorB) return null; // not loaded
        if (isEmpty(feetB) && isEmpty(headB) && firmFloor(floorB)) return p;
    }
    return null;
}

/**
 * Where to walk for a shelter, or null: {feet, kind: 'last'|'shelter'|'hole', blocks, d}.
 * The last shelter first (within GROUND.lastShelterMax, if a shelter or a hole still fits there);
 * else the surface cells within radius where one fits, by blocks needed (a hole: holeBlocks) x 4 +
 * distance + 2 a block lower than the bot (higher ground first); cells chooseSite already looked at
 * (4 across, 2 up or down) and those in `skip` are left out, and so is a place with a hostile mob
 * near the straight way (GROUND.hostileWay).
 */
export function groundPlan(bot, { radius = GROUND.radius, lastShelter = null, skip = [], wayClear = (a, b) => !hostileNearWay(bot, a, b, GROUND.hostileWay) } = {}) {
    const here = bot?.entity?.position;
    if (!here) return null;
    const base = here.floored();
    const skipped = new Set(skip.map(p => key(p)));
    if (lastShelter && hdist(lastShelter, here) <= GROUND.lastShelterMax && !skipped.has(key(lastShelter))) {
        const fit = fitsAt(bot, lastShelter);
        if (fit && wayClear(here, lastShelter)) return { feet: lastShelter.clone?.() ?? lastShelter, kind: 'last', blocks: fit.blocks, d: hdist(lastShelter, here) };
    }
    const found = [];
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const feet = surfaceAt(bot, base.x + dx, base.z + dz, base.y);
        if (!feet || skipped.has(key(feet))) continue;
        const dy = feet.y - base.y;
        if (Math.abs(dx) <= 4 && Math.abs(dz) <= 4 && Math.abs(dy) <= 2) continue; // chooseSite looked here
        const fit = fitsAt(bot, feet);
        if (!fit) continue;
        const d = Math.hypot(dx, dz);
        found.push({ feet, kind: fit.kind, blocks: fit.blocks, d, score: fit.blocks * 4 + d + (dy < 0 ? -2 * dy : 0) });
    }
    found.sort((a, b) => a.score - b.score);
    const pick = found.find(c => wayClear(here, c.feet));
    return pick ? { feet: pick.feet, kind: pick.kind, blocks: pick.blocks, d: pick.d } : null;
}

/** What the plan is, for the line: "the last shelter", "a shelter there needs 9 blocks", "ground for a hole shelter". */
export function planText(plan) {
    if (plan.kind === 'last') return 'the last shelter';
    if (plan.kind === 'hole') return 'ground for a hole shelter';
    return `a shelter there needs ${plan.blocks} block${plan.blocks === 1 ? '' : 's'}`;
}

/** The nearest hostile mob (threats.shelterEnemy) within range of the bot, or null. */
function hostileWithin(bot, range) {
    const here = bot.entity?.position;
    if (!here) return null;
    let best = null, bestD = Infinity;
    for (const e of Object.values(bot.entities ?? {})) {
        if (!e || e === bot.entity || !e.position || !shelterEnemy(e)) continue;
        const d = e.position.distanceTo(here);
        if (d <= range && d < bestD) { best = e; bestD = d; }
    }
    return best;
}

/**
 * A walk, bounded by ms; stop(): a reason to stop it early (checked every GROUND.checkMs), or null.
 * Returns {stopped: null|'time'|<reason>, why} (why: what the walk threw).
 */
async function boundedWalk(bot, walk, ms, stop = () => null) {
    let stopped = null, why = null, timer, watch, done;
    // A stop ends the wait at once, whether or not the walk's promise ends with it.
    const ended = new Promise(resolve => { done = resolve; });
    const halt = (r) => { if (stopped) return; stopped = r; try { bot.pathfinder?.stop?.(); bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.(); } catch { /* best effort */ } done(); };
    timer = setTimeout(() => halt('time'), ms);
    watch = setInterval(() => { const r = stop(); if (r) halt(r); }, GROUND.checkMs);
    try {
        await Promise.race([Promise.resolve().then(walk).catch(err => { why = err?.message ?? String(err); }), ended]);
    } finally { clearTimeout(timer); clearInterval(watch); }
    return { stopped, why };
}

/**
 * The walk to the plan's place (fall-safe goToGoal, within GROUND.near), at most GROUND.walkMs;
 * it stops when a hostile mob comes within GROUND.stopRange. Returns {arrived, stopped: null|'time'|'hostile', mob, why}.
 */
export async function walkToGround(bot, plan, { walk = (b, f) => goToGoal(b, new pf.goals.GoalNear(f.x, f.y, f.z, GROUND.near)) } = {}) {
    let mob = null;
    const r = await boundedWalk(bot, () => walk(bot, plan.feet), GROUND.walkMs, () => {
        mob = hostileWithin(bot, GROUND.stopRange);
        return mob ? 'hostile' : null;
    });
    const here = bot.entity?.position;
    const arrived = !!here && here.distanceTo(plan.feet.offset(0.5, 0, 0.5)) <= GROUND.near + 1;
    return { arrived, stopped: arrived ? null : r.stopped, mob: r.stopped === 'hostile' ? (mob?.name ?? 'hostile mob') : null, why: r.why };
}

/** The bot's feet or head is in a liquid (soak 8: in a river). */
export function inWater(bot) {
    const p = bot?.entity?.position?.floored?.();
    if (!p) return false;
    return isLiquid(bot.blockAt(p)) || isLiquid(bot.blockAt(p.offset(0, 1, 0)));
}

/** The nearest dry, solid cell within radius (and 3 up or down): a free 1x2 space with no liquid on a solid floor that is no liquid; or null. */
export function dryCell(bot, radius = GROUND.dryRadius) {
    const base = bot.entity.position.floored();
    let best = null;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        const p = base.offset(dx, dy, dz);
        const floorB = bot.blockAt(p.offset(0, -1, 0));
        if (!isEmpty(bot.blockAt(p)) || !isEmpty(bot.blockAt(p.offset(0, 1, 0))) || !floorB || floorB.boundingBox !== 'block' || isLiquid(floorB)) continue;
        const d = Math.abs(dx) + Math.abs(dz) + 2 * Math.abs(dy);
        if (!best || d < best.d) best = { p, d };
    }
    return best?.p ?? null;
}

/**
 * Out of the water (the lead's (c)): with the bot's feet or head in a liquid, a walk (fall-safe,
 * at most GROUND.dryWalkMs) to the nearest dry cell (dryCell). Returns {dry, moved, at, why}:
 * dry: out of the water now; moved: it walked; why: why it is still in the water.
 */
export async function stepToDry(bot, { walk = (b, p) => goToGoal(b, new pf.goals.GoalBlock(p.x, p.y, p.z)) } = {}) {
    if (!inWater(bot)) return { dry: true, moved: false, at: bot.entity.position.floored(), why: null };
    const target = dryCell(bot);
    if (!target) return { dry: false, moved: false, at: bot.entity.position.floored(), why: `no dry ground within ${GROUND.dryRadius} blocks` };
    const r = await boundedWalk(bot, () => walk(bot, target), GROUND.dryWalkMs);
    const dry = !inWater(bot);
    return { dry, moved: true, at: bot.entity.position.floored(), why: dry ? null : (r.stopped === 'time' ? `the walk to ${at(target)} ran out of time` : `the walk to ${at(target)} did not get there${r.why ? ` (${r.why})` : ''}`) };
}
