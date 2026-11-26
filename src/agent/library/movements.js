// Soak 17 T (the lead's decisions; the seed of round 17 W, makeMovements): the one place that builds the pathfinder's
// Movements under src/agent (guardedMovements), and that guards the ones it does not build (guardMovements:
// mineflayer-collectblock's own, which #642's walk rules never reached: soak 17's !collectBlocks("cobblestone") dug a
// shaft 44 blocks down to a buried vanilla cobblestone). A static test (movements.test.js) checks that every
// `new Movements` under src/agent is here or on the allow-list (UNGUARDED), each entry with its reason. W adds the
// kinds (walk, dig, escape, night) on top of these.
//
// The rules every guarded walk keeps (WALK_GUARD, from #642):
// - its floor: no block broken below it (a walk: min(start y, goal y) - floorBelow with a pickaxe, that min without);
// - the pickaxe's last uses (pickaxe.walkKeep) are never spent: no block that needs a pickaxe is broken then;
// - the collect floor (soak 17 T): while a collect runs (bot.rotnCollectFloor, its start y - floorBelow, fixed for the
//   whole collect, and held only while the action that set it is the current one), every walk breaks nothing below it,
//   and moves into no cell below it: no step, no drop landing (the pathfinder checks only the cells it passes, not the
//   landing, so getLandingBlock is wrapped) and no other move (#665 review 5: a diagonal drops one without a landing
//   check: every move from getNeighbors is checked). The one exception (the lead, #665 round 1): a cell under open sky
//   when the collect began (above the top solid block of its column, tree parts not counted) may be walked in below the
//   floor (a valley); never a cell under rock (a cave), and no break below the floor at all.
import pf from 'mineflayer-pathfinder';
import { fallSafe, isTreePart } from './fall_safety.js';
import { walkPickaxeOk } from './pickaxe.js';
import { digRule } from './burrow.js';
import { Vec3 } from 'vec3';

/**
 * floorBelow: how far below a walk's lower end (or a collect's start) a block may still be broken, with a pickaxe that
 * has uses above its keep. pickaxeMs: how long the pickaxe's uses are cached during a search (the cost function runs per
 * block). breakNever: the pathfinder's "never" (an exclusion of 100 or more makes a block unbreakable or a cell barred).
 */
export const WALK_GUARD = { floorBelow: 2, pickaxeMs: 1000, breakNever: 100 };

/**
 * The paths that build their own Movements without this guard, each with its reason. The static test reads `files`.
 * digDown and the pit shelter build none (they dig with bot.dig), and are named so W keeps them apart.
 */
export const UNGUARDED = Object.freeze({
    escape: {
        files: ['library/escape.js', 'respawn_escape.js'],
        why: 'the escape climbs up and out of a hole (it digs above the feet, never down); it may spend the pickaxe\'s last uses (#642), and the respawn escape walks with no digging at all',
    },
    digDown: { files: [], why: '!digDown goes down on purpose (POST_ESCAPE "deep"); it digs with bot.dig, not the pathfinder' },
    pitShelter: { files: [], why: 'the night\'s pit shelter digs its hole one or two down on purpose (#652 PIT_DEEPER, its own flood and headroom checks), with bot.dig' },
});

/** A walk's floor: min(start y, goal y) - floorBelow with a usable pickaxe, else that min (a goal with no y: the start). */
export function walkFloorY(bot, goal, { pickaxe = walkPickaxeOk(bot) } = {}) {
    const start = Math.floor(bot.entity?.position?.y ?? 0);
    const goalY = Number.isFinite(goal?.y) ? Math.floor(goal.y) : start;
    return Math.min(start, goalY) - (pickaxe ? WALK_GUARD.floorBelow : 0);
}

/**
 * The collect floor's record: {y, startY, seq, top, dugCols}. seq: the action that set it (bot.rotnActionSeq, which the
 * action manager changes at each action's start and end, #665 review 7): it holds only while that action runs (an
 * abandoned collect's floor binds no later walk; no wall-clock lapse inside the run). top: the column memo for the sky
 * exception; dugCols: the columns this collect dug in (their top is never read after a dig: a shaft is no sky).
 * skyScan: how far above the start and below the floor a column is read.
 */
export const COLLECT_FLOOR = { skyScan: 40 };

/** Start a collect's floor at y (its start y - floorBelow); returns the record for clearCollectFloor. */
export function setCollectFloor(bot, y, { startY = y + WALK_GUARD.floorBelow } = {}) {
    const f = { y, startY, seq: bot?.rotnActionSeq, top: new Map(), dugCols: new Set() };
    bot.rotnCollectFloor = f;
    return f;
}
/** End the collect's floor: only its own record (#665 review 1: a nested collect, which set none, leaves the outer one). */
export function clearCollectFloor(bot, f) {
    if (bot && f && bot.rotnCollectFloor === f) bot.rotnCollectFloor = null;
}
/** The collect floor's record in effect (set, and its action still the current one), or null. */
export function collectFloor(bot) {
    const f = bot?.rotnCollectFloor;
    if (!f || !Number.isFinite(f.y)) return null;
    return f.seq === bot.rotnActionSeq ? f : null;
}
/** The collect floor's y in effect, or null. */
export const collectFloorY = (bot) => collectFloor(bot)?.y ?? null;
/** A dig during the collect (the bot.dig hook): its column's top is no longer read as the start's. */
export function noteCollectDig(bot, pos) {
    const f = collectFloor(bot);
    if (f && pos) f.dugCols.add(`${Math.floor(pos.x)},${Math.floor(pos.z)}`);
}

const treeLike = (b) => !!b && (isTreePart(b) || /(^|:)log2?$|_log$/.test(b.name ?? ''));
const solidBlock = (b) => !!b && b.boundingBox === 'block' && !treeLike(b);
/**
 * The top solid block of column x,z when the collect began (tree parts and blocks with no collision not counted), from
 * the memo; a column the collect has dug in before it was read: +Infinity (nothing in it counts as sky).
 */
function startTop(bot, f, x, z) {
    const col = `${x},${z}`;
    if (f.top.has(col)) return f.top.get(col);
    let top = -Infinity;
    if (f.dugCols.has(col)) top = Infinity;
    else {
        for (let y = f.startY + COLLECT_FLOOR.skyScan; y >= f.y - COLLECT_FLOOR.skyScan; y--) {
            let b;
            try { b = bot.blockAt(new Vec3(x, y, z)); } catch { b = null; }
            if (solidBlock(b)) { top = y; break; }
        }
    }
    f.top.set(col, top);
    return top;
}
/** Soak 17 T (the lead): a cell under open sky when the collect began (above its column's top solid block). */
export function skyCellAtStart(bot, f, pos) {
    if (!f || !pos) return false;
    const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
    // Cheap first: a solid block right above (rock over a cave) is never sky.
    let above;
    try { above = bot.blockAt(new Vec3(x, y + 1, z)); } catch { above = null; }
    if (solidBlock(above)) return false;
    return y > startTop(bot, f, x, z);
}
/**
 * Soak 17 T (the lead): a target below the collect floor may be taken only when it was at the surface when the collect
 * began: the top solid block of its column under open sky, or above it (a log, a rock pile on the ground). Never a cell
 * the collect dug its way to.
 */
export function surfaceTargetBelowFloor(bot, pos) {
    const f = collectFloor(bot);
    if (!f || !pos) return false;
    const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
    let above;
    try { above = bot.blockAt(new Vec3(x, y + 1, z)); } catch { above = null; }
    if (solidBlock(above)) return false;
    return y >= startTop(bot, f, x, z);
}
/** The break floor of movements m: its own (a walk's) or the collect's, the higher; null for none. */
function breakFloor(bot, m) {
    const own = m.rotnWalkGuard?.floorY;
    const c = collectFloorY(bot);
    const ys = [own, c].filter(Number.isFinite);
    return ys.length ? Math.max(...ys) : null;
}
/** A cell a walk may be in during the collect: at or above the floor, or under open sky at the collect's start. */
function cellAllowed(bot, pos) {
    const f = collectFloor(bot);
    if (!f || !pos || pos.y >= f.y) return true;
    return skyCellAtStart(bot, f, pos);
}

/**
 * Guard movements built elsewhere (mineflayer-collectblock's, goToGoal's): the rules above. Once per object; a later call
 * sets its own floor (floorY: a number, or null for none: then only the collect floor and the pickaxe keep apply).
 * keep false: no pickaxe-keep rule (a collect's own target check, movements.safeToBreak: the target's dig is no walk).
 */
export function guardMovements(bot, movements, { floorY = null, keep = true } = {}) {
    if (!movements || typeof movements !== 'object') return movements;
    if (movements.rotnWalkGuard) { movements.rotnWalkGuard.floorY = floorY; return movements; }
    movements.rotnWalkGuard = { floorY };
    let ok = null, okAt = 0;
    const pickaxeOk = () => { const t = Date.now(); if (ok === null || t - okAt > WALK_GUARD.pickaxeMs) { ok = walkPickaxeOk(bot); okAt = t; } return ok; };
    if (Array.isArray(movements.exclusionAreasBreak)) {
        movements.exclusionAreasBreak.push((block) => {
            const f = breakFloor(bot, movements);
            return f !== null && block?.position && block.position.y < f ? WALK_GUARD.breakNever : 0;
        });
        if (keep) movements.exclusionAreasBreak.push((block) => {
            let rule;
            try { rule = digRule(block); } catch { rule = undefined; }
            return rule && rule.type === 'pickaxe' && !pickaxeOk() ? WALK_GUARD.breakNever : 0;
        });
    }
    // Soak 17 T (the lead): no cell below the collect floor, walked into or landed on (a cave below is where the bot gets
    // trapped). Only the collect's: an ordinary walk may cross a valley lower than both of its ends.
    if (Array.isArray(movements.exclusionAreasStep)) {
        movements.exclusionAreasStep.push((block) => (block?.position && !cellAllowed(bot, block.position) ? WALK_GUARD.breakNever : 0));
    }
    if (typeof movements.getLandingBlock === 'function') {
        const landing = movements.getLandingBlock.bind(movements);
        movements.getLandingBlock = (node, dir) => {
            const land = landing(node, dir);
            return land?.position && !cellAllowed(bot, land.position) ? null : land;
        };
    }
    // #665 review 5: every move's end cell (a diagonal drops one below its node with no landing or step check).
    if (typeof movements.getNeighbors === 'function') {
        const neighbors = movements.getNeighbors.bind(movements);
        movements.getNeighbors = (node) => {
            const all = neighbors(node);
            return collectFloor(bot) ? all.filter(m => !(m && Number.isFinite(m.y) && !cellAllowed(bot, m))) : all;
        };
    }
    return movements;
}

/** #642's name for guardMovements with a walk's floor (kept for its callers and tests). */
export const guardWalkBreaks = (bot, movements, floorY) => guardMovements(bot, movements, { floorY });

/**
 * New guarded movements: fall-safe (fall_safety.fallSafe) plus the rules above. floorY: the walk's own floor; by default
 * the start's y - floorBelow (a walk with no goal: a flee, a pursuit, a step away), null for none (a tree descent, a
 * search that never digs). keep: as guardMovements.
 */
export function guardedMovements(bot, { floorY = walkFloorY(bot, null), keep = true } = {}) {
    return guardMovements(bot, fallSafe(new pf.Movements(bot)), { floorY, keep });
}

/**
 * The collect's own target check (skills.collectBlock's wanted(): movements.safeToBreak), no walk: no guard at all.
 * wanted() checks the collect floor itself (with the surface exception, which a break exclusion would refuse); not
 * fall-safe (fallSafe bars a Dynamic Trees branch, which is a target the collect cuts with fellTree); no pickaxe keep
 * (the target's own dig is no walk).
 */
export function targetCheckMovements(bot) {
    return new pf.Movements(bot);
}
