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
//                 or a hole fits, with no hostile mob ahead near the way. Async: it yields to the
//                 event loop as it goes (#557 review 3).
//   walkToGround: the walk there (fall-safe, no digging, no tower or scaffolding: #557 review 2),
//                 within `near`, at most walkMs; it stops when a hostile mob ahead comes within
//                 stopRange (or any within closeRange), and at night with no weapon once it has gone
//                 unarmedRadius (#557 review 4).
//   stepToDry:    out of the water to the nearest dry, firm cell within dryRadius.

import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { setImmediate } from 'node:timers';
import { siteNeeds, isEmpty, isLiquid, isFalling, firmFloor, hurtsOnContact } from './shelter.js';
import { isSturdy, isWall } from './night.js';
import { pitProblem } from './pit.js';
import { goToGoal } from './skills.js';
import { shelterEnemy } from './threats.js';
import { toolLevels } from './rotn_sources.js';

/**
 * radius: how far across the search looks (unarmedRadius at night with no weapon); below/above: the
 * surface cell looked for in each column, from `above` over the bot's feet down to `below` under
 * them; lastShelterMax: the last shelter comes first within this; holeBlocks: what a hole counts as
 * in the score (it needs no blocks, but a shelter on open ground takes about this many, and a hole is
 * the weaker shelter); walkMs, near: the walk; stopRange: a hostile mob ahead this near stops it;
 * closeRange: any hostile mob this near stops it (about to hit); maxMoves: walks a night; dryRadius,
 * dryWalkMs: the step out of the water; hostileWay: a hostile mob ahead this near the straight way
 * skips a place (mobOnWay); yieldEvery: columns looked at between yields to the event loop.
 */
export const GROUND = {
    radius: 24, unarmedRadius: 12, below: 4, above: 8, lastShelterMax: 48, holeBlocks: 10,
    walkMs: 45_000, near: 1, stopRange: 8, closeRange: 3, checkMs: 500, maxMoves: 2,
    dryRadius: 8, dryWalkMs: 20_000, hostileWay: 16, yieldEvery: 48,
};

const at = (p) => `${p.x}, ${p.y}, ${p.z}`;
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const key = (p) => `${p.x},${p.y},${p.z}`;
const tick = () => new Promise(resolve => setImmediate(resolve));

/**
 * A floor to stand on for the night (#557 review 8): firm (shelter.firmFloor: a solid full block, no
 * tree part), no liquid, nothing that hurts on contact (magma, cactus), and not a falling block over
 * a liquid or air (sand over water gives way).
 */
export function goodFloor(bot, feet) {
    const floor = bot.blockAt(feet.offset(0, -1, 0));
    if (!floor || !firmFloor(floor) || isLiquid(floor) || hurtsOnContact(floor)) return false;
    if (isFalling(floor)) {
        const under = bot.blockAt(feet.offset(0, -2, 0));
        if (!under || isLiquid(under) || isEmpty(under)) return false;
    }
    return true;
}

/** The bot holds a pickaxe (rotn_sources.toolLevels, what buildShelter's pickaxe check reads). */
export function hasPickaxe(bot) {
    try { return toolLevels(bot, 'pickaxe').length > 0; } catch { return false; }
}

/**
 * A shelter fits at feet as buildShelter would take it, {kind: 'shelter', blocks}: rock walls (with a
 * pickaxe), else dirt walls; without a pickaxe only dirt walls with a side to dig out by hand
 * (#557 review 6, as buildShelter's handExit). Else a hole fits: {kind: 'hole'}. Else null.
 */
export function fitsAt(bot, feet, { pickaxe = hasPickaxe(bot) } = {}) {
    if (!goodFloor(bot, feet)) return null;
    for (const accept of pickaxe ? [isSturdy, isWall] : [isWall]) {
        const need = siteNeeds(bot, feet, { accept });
        if (need && !need.unsafe && need.unsupported.length === 0 && (pickaxe || need.handExit)) return { kind: 'shelter', blocks: need.blocks };
    }
    if (!pitProblem(bot, feet)) return { kind: 'hole', blocks: GROUND.holeBlocks };
    return null;
}

/** The surface cell of the column x, z: the highest free (no liquid) 1x2 space on a firm floor, from y0 + above down to y0 - below; null if none, not loaded, or not a good floor (goodFloor). */
export function surfaceAt(bot, x, z, y0, { above = GROUND.above, below = GROUND.below } = {}) {
    for (let y = y0 + above; y >= y0 - below; y--) {
        const p = new Vec3(x, y, z);
        const feetB = bot.blockAt(p), headB = bot.blockAt(p.offset(0, 1, 0)), floorB = bot.blockAt(p.offset(0, -1, 0));
        if (!feetB || !headB || !floorB) return null; // not loaded
        if (isEmpty(feetB) && isEmpty(headB) && firmFloor(floorB)) return goodFloor(bot, p) ? p : null;
    }
    return null;
}

/**
 * The nearest hostile mob (threats.shelterEnemy) ahead on the straight way from a to b, within range
 * of it, or null (#557 review 1): ahead is past the bot along the way (t > 0) and nearer b than the
 * bot is. A mob behind the bot, or level with where it starts, is no reason not to go.
 */
export function mobOnWay(bot, a, b, range = GROUND.hostileWay) {
    const vx = b.x - a.x, vz = b.z - a.z, len2 = vx * vx + vz * vz;
    const total = Math.sqrt(len2);
    let best = null, bestD = Infinity;
    for (const e of Object.values(bot.entities ?? {})) {
        if (!e || e === bot.entity || !e.position || !shelterEnemy(e)) continue;
        const p = e.position;
        const t = len2 > 0 ? ((p.x - a.x) * vx + (p.z - a.z) * vz) / len2 : 0;
        if (t <= 0 || hdist(p, b) >= total) continue;
        const c = Math.min(1, t);
        const d = Math.hypot(p.x - (a.x + c * vx), p.z - (a.z + c * vz));
        if (d <= range && d < bestD) { best = e; bestD = d; }
    }
    return best;
}

/** The column offsets within radius, nearest first (cached per radius). */
const ringCache = new Map();
function columnsWithin(radius) {
    if (!ringCache.has(radius)) {
        const cols = [];
        for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
            const d = Math.hypot(dx, dz);
            if (d <= radius) cols.push({ dx, dz, d });
        }
        cols.sort((a, b) => a.d - b.d);
        ringCache.set(radius, cols);
    }
    return ringCache.get(radius);
}

/**
 * Where to walk for a shelter, or null: {feet, kind: 'last'|'shelter'|'hole', blocks, d}.
 * The last shelter first (within GROUND.lastShelterMax, if a shelter or a hole still fits there);
 * else the surface cells within radius where one fits, by blocks needed (a hole: holeBlocks) x 4 +
 * distance + 2 a block lower than the bot (higher ground first); cells chooseSite already looked at
 * (4 across, 2 up or down) and those in `skip` are left out, and so is a place with a hostile mob
 * ahead near the way (mobOnWay).
 * #557 review 3: the columns are looked at nearest first, and the search ends once the distance
 * alone cannot beat the best place; it yields to the event loop every GROUND.yieldEvery columns.
 * report (filled in): {columns, ms, mobSkipped, mob}: places left out for a mob on the way, and its name.
 */
export async function groundPlan(bot, { radius = GROUND.radius, lastShelter = null, skip = [], report = {}, pickaxe = hasPickaxe(bot), onWay = (a, b) => mobOnWay(bot, a, b) } = {}) {
    Object.assign(report, { columns: 0, ms: 0, mobSkipped: 0, mob: null });
    const t0 = Date.now();
    const here = bot?.entity?.position;
    if (!here) return null;
    const base = here.floored();
    const skipped = new Set(skip.map(p => key(p)));
    const blocked = (feet) => {
        const mob = onWay(here, feet);
        if (mob) { report.mobSkipped++; report.mob ??= mob.name ?? 'hostile mob'; }
        return !!mob;
    };
    try {
        if (lastShelter && hdist(lastShelter, here) <= GROUND.lastShelterMax && !skipped.has(key(lastShelter))) {
            const fit = fitsAt(bot, lastShelter, { pickaxe });
            if (fit && !blocked(lastShelter)) return { feet: lastShelter.clone?.() ?? lastShelter, kind: 'last', blocks: fit.blocks, d: hdist(lastShelter, here) };
        }
        let best = null, n = 0;
        for (const { dx, dz, d } of columnsWithin(radius)) {
            if (best && d >= best.score) break; // no place farther out can score better
            if (++n % GROUND.yieldEvery === 0) await tick();
            report.columns++;
            const feet = surfaceAt(bot, base.x + dx, base.z + dz, base.y);
            if (!feet || skipped.has(key(feet))) continue;
            const dy = feet.y - base.y;
            if (Math.abs(dx) <= 4 && Math.abs(dz) <= 4 && Math.abs(dy) <= 2) continue; // chooseSite looked here
            const lower = dy < 0 ? -2 * dy : 0;
            if (best && d + lower >= best.score) continue; // even a place needing no blocks would not beat it
            const fit = fitsAt(bot, feet, { pickaxe });
            if (!fit) continue;
            const score = fit.blocks * 4 + d + lower;
            if (best && score >= best.score) continue;
            if (blocked(feet)) continue;
            best = { feet, kind: fit.kind, blocks: fit.blocks, d, score };
        }
        return best ? { feet: best.feet, kind: best.kind, blocks: best.blocks, d: best.d } : null;
    } finally {
        report.ms = Date.now() - t0;
    }
}

/** What the plan is, for the line: "the last shelter", "a shelter there needs 9 blocks", "ground for a hole shelter". */
export function planText(plan) {
    if (plan.kind === 'last') return 'the last shelter';
    if (plan.kind === 'hole') return 'ground for a hole shelter';
    return `a shelter there needs ${plan.blocks} block${plan.blocks === 1 ? '' : 's'}`;
}

/** A hostile mob that stops the walk to target: one ahead (nearer the target than the bot) within stopRange of the bot, or any within closeRange. */
function stopper(bot, target) {
    const here = bot.entity?.position;
    if (!here) return null;
    let best = null, bestD = Infinity;
    for (const e of Object.values(bot.entities ?? {})) {
        if (!e || e === bot.entity || !e.position || !shelterEnemy(e)) continue;
        const d = e.position.distanceTo(here);
        if (d < bestD && d <= GROUND.stopRange && (d <= GROUND.closeRange || hdist(e.position, target) < hdist(here, target))) { best = e; bestD = d; }
    }
    return best;
}

/**
 * A walk, bounded by ms; stop(): a reason to stop it early (checked every GROUND.checkMs), or null.
 * A stop ends the wait at once, whether or not the walk's promise ends with it.
 * Returns {stopped: null|'time'|<reason>, why} (why: what the walk threw).
 */
async function boundedWalk(bot, walk, ms, stop = () => null) {
    let stopped = null, why = null, done;
    const ended = new Promise(resolve => { done = resolve; });
    const halt = (r) => { if (stopped) return; stopped = r; try { bot.pathfinder?.stop?.(); bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.(); } catch { /* best effort */ } done(); };
    const timer = setTimeout(() => halt('time'), ms);
    const watch = setInterval(() => { const r = stop(); if (r) halt(r); }, GROUND.checkMs);
    try {
        await Promise.race([Promise.resolve().then(walk).catch(err => { why = err?.message ?? String(err); }), ended]);
    } finally { clearTimeout(timer); clearInterval(watch); }
    return { stopped, why };
}

/** A walk that only walks (#557 review 2): fall-safe, no digging, no 1x1 tower, no scaffolding. */
export const pureWalk = (bot, goal) => goToGoal(bot, goal, { canDig: false, noBuild: true });

/**
 * The walk to the plan's place (pureWalk to within GROUND.near), at most GROUND.walkMs. It stops when
 * a hostile mob ahead comes within GROUND.stopRange (or any within closeRange), and (#557 review 4)
 * once shortNow() (night, and no weapon) and the bot has gone GROUND.unarmedRadius from where it
 * started, when the place is farther than that (a dusk plan of 24 blocks).
 * Returns {arrived, stopped: null|'time'|'hostile'|'night', mob, why}.
 */
export async function walkToGround(bot, plan, { walk = (b, f) => pureWalk(b, new pf.goals.GoalNear(f.x, f.y, f.z, GROUND.near)), shortNow = () => false } = {}) {
    let mob = null;
    const start = bot.entity?.position?.clone?.() ?? null;
    const r = await boundedWalk(bot, () => walk(bot, plan.feet), GROUND.walkMs, () => {
        mob = stopper(bot, plan.feet);
        if (mob) return 'hostile';
        const here = bot.entity?.position;
        if (start && here && plan.d > GROUND.unarmedRadius && shortNow() && hdist(start, here) >= GROUND.unarmedRadius) return 'night';
        return null;
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

/** The nearest dry cell within radius (and 3 up or down): a free 1x2 space with no liquid or hazard, on a good floor (goodFloor); or null. */
export function dryCell(bot, radius = GROUND.dryRadius) {
    const base = bot.entity.position.floored();
    let best = null;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        const p = base.offset(dx, dy, dz);
        if (!isEmpty(bot.blockAt(p)) || !isEmpty(bot.blockAt(p.offset(0, 1, 0))) || !goodFloor(bot, p)) continue;
        const d = Math.abs(dx) + Math.abs(dz) + 2 * Math.abs(dy);
        if (!best || d < best.d) best = { p, d };
    }
    return best?.p ?? null;
}

/**
 * Out of the water (the lead's (c)): with the bot's feet or head in a liquid, a walk (pureWalk, at
 * most GROUND.dryWalkMs) to the nearest dry cell (dryCell). Returns {dry, moved, at, why}: dry: out
 * of the water now; moved: it walked; why: why it is still in the water.
 */
export async function stepToDry(bot, { walk = (b, p) => pureWalk(b, new pf.goals.GoalBlock(p.x, p.y, p.z)) } = {}) {
    if (!inWater(bot)) return { dry: true, moved: false, at: bot.entity.position.floored(), why: null };
    const target = dryCell(bot);
    if (!target) return { dry: false, moved: false, at: bot.entity.position.floored(), why: `no dry ground within ${GROUND.dryRadius} blocks` };
    const r = await boundedWalk(bot, () => walk(bot, target), GROUND.dryWalkMs);
    const dry = !inWater(bot);
    return { dry, moved: true, at: bot.entity.position.floored(), why: dry ? null : (r.stopped === 'time' ? `the walk to ${at(target)} ran out of time` : `the walk to ${at(target)} did not get there${r.why ? ` (${r.why})` : ''}`) };
}
