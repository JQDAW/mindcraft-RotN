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
//   whole collect), every walk breaks nothing below it, steps into no cell below it, and lands no drop below it (a drop
//   into a cave: the pathfinder checks only the cells it passes, not the landing, so getLandingBlock is wrapped).
import pf from 'mineflayer-pathfinder';
import { fallSafe } from './fall_safety.js';
import { walkPickaxeOk } from './pickaxe.js';
import { digRule } from './burrow.js';

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

/** maxMs: a collect floor older than this is ignored (a collect that never cleared its own: the run was killed). */
export const COLLECT_FLOOR = { maxMs: 10 * 60_000 };

/** Start a collect's floor at y (its start y - floorBelow); returns the record for clearCollectFloor. */
export function setCollectFloor(bot, y, now = Date.now()) {
    const f = { y, at: now };
    bot.rotnCollectFloor = f;
    return f;
}
/** End the collect's floor (only its own record: a nested collect leaves the outer one's in place). */
export function clearCollectFloor(bot, f) {
    if (bot && (!f || bot.rotnCollectFloor === f)) bot.rotnCollectFloor = null;
}
/** The collect floor in effect, or null. */
export function collectFloorY(bot, now = Date.now()) {
    const f = bot?.rotnCollectFloor;
    return f && Number.isFinite(f.y) && now - (f.at ?? 0) <= COLLECT_FLOOR.maxMs ? f.y : null;
}

/** The break floor of movements m: its own (a walk's) or the collect's, the higher; null for none. */
function breakFloor(bot, m) {
    const own = m.rotnWalkGuard?.floorY;
    const c = collectFloorY(bot);
    const ys = [own, c].filter(Number.isFinite);
    return ys.length ? Math.max(...ys) : null;
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
        movements.exclusionAreasStep.push((block) => {
            const f = collectFloorY(bot);
            return f !== null && block?.position && block.position.y < f ? WALK_GUARD.breakNever : 0;
        });
    }
    if (typeof movements.getLandingBlock === 'function') {
        const landing = movements.getLandingBlock.bind(movements);
        movements.getLandingBlock = (node, dir) => {
            const land = landing(node, dir);
            const f = collectFloorY(bot);
            return land?.position && f !== null && land.position.y < f ? null : land;
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
 * The collect's own target check (skills.collectBlock's wanted(): movements.safeToBreak), no walk: the collect floor only.
 * Not fall-safe (fallSafe bars a Dynamic Trees branch, which is a target the collect cuts with fellTree) and no pickaxe
 * keep (the target's own dig is no walk).
 */
export function targetCheckMovements(bot) {
    return guardMovements(bot, new pf.Movements(bot), { floorY: null, keep: false });
}
