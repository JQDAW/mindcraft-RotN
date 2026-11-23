// Soak 12 (rotn-v0.1.18, deaths 2-16): the Scroll of New Life had set the respawn point in the night-2
// hole shelter's cell, which the bot could not leave without digging; every respawn put it back there
// (rotn-data: a forced spawn is exactly the scroll's block, no nearby search), and the escape, which
// never digs, ended 0 to 2 blocks from it 15 times. Two tools, offline-testable on a blockAt world:
//   walkableExit: is there a way out of a cell on foot (no digging) to `reach` blocks away (B(i): where
//     the scroll may set the spawn; B(ii): whether the escape must dig first)?
//   stairOutPlan / stairOut: the lead's bounded dig-out (decision 1): at most maxBlocks blocks, each one
//     the bot breaks quickly with what it holds (soft ground by hand, stone only with a pickaxe), always
//     away from the hostiles: up to 3 blocks of tunnel sideways, then stairs up, until a walkable exit.

import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { handDiggable, dumpState } from './night.js';
import { digRule, digEquip } from './burrow.js';
import { allowedTool } from './rotn_sources.js';
import { isLiquid, isFalling } from './shelter.js';
import { goToGoal } from './skills.js';
import { digWithin, digBudget, PIT } from './pit.js';

const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const SIX = [...HORIZONTAL, new Vec3(0, 1, 0), new Vec3(0, -1, 0)];
const key = (p) => `${p.x},${p.y},${p.z}`;
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** A block the body cannot pass (a full collision box), not a liquid. */
const solid = (b) => !!b && b.boundingBox === 'block' && !isLiquid(b);
/** A cell the body can be in: loaded, not solid, not a liquid (or one of `free`, cells to be dug). */
const passable = (bot, p, free) => free.has(key(p)) || (() => { const b = bot.blockAt(p); return !!b && !solid(b) && !isLiquid(b); })();

/**
 * WALK_EXIT: reach, the horizontal blocks from the start a walk must get (8): one reach for "walled in"
 * (the escape's check, B(i)'s walkable exit) and for "out" (the dig-out's end), #593 review 4, so a
 * pocket 4 to 7 wide is not "dug out" with 0 blocks; maxNodes bounds the search.
 */
export const WALK_EXIT = { reach: 8, maxNodes: 400 };

/**
 * Whether the bot can walk from `from` (a cell it stands in) to a cell `reach` blocks away horizontally
 * without digging: steps to the 4 sides, level, one up (headroom over the cell it leaves) or one down
 * (the side cell free at its level first). `free`: cells counted as free (to be dug, or a shelter
 * wall the bot can take down). Returns the cell reached, or null.
 */
export function walkableExit(bot, from, { reach = WALK_EXIT.reach, maxNodes = WALK_EXIT.maxNodes, free = new Set() } = {}) {
    const start = new Vec3(Math.floor(from.x), Math.floor(from.y), Math.floor(from.z));
    if (typeof bot?.blockAt !== 'function') return start; // no world to look at: not known to be enclosed
    const floor = bot.blockAt(start.offset(0, -1, 0));
    if (floor && !('boundingBox' in floor)) return start; // blocks with no collision data: not known either
    const stand = (p) => passable(bot, p, free) && passable(bot, p.offset(0, 1, 0), free) && solid(bot.blockAt(p.offset(0, -1, 0))) && !free.has(key(p.offset(0, -1, 0)));
    const seen = new Set([key(start)]);
    const queue = [start];
    while (queue.length && seen.size <= maxNodes) {
        const c = queue.shift();
        if (hdist(c, start) >= reach) return c;
        for (const d of HORIZONTAL) {
            const side = c.plus(d);
            const next = [];
            if (stand(side)) next.push(side);
            else if (passable(bot, c.offset(0, 2, 0), free) && stand(side.offset(0, 1, 0))) next.push(side.offset(0, 1, 0));
            else if (passable(bot, side, free) && passable(bot, side.offset(0, 1, 0), free) && stand(side.offset(0, -1, 0))) next.push(side.offset(0, -1, 0));
            for (const n of next) {
                if (seen.has(key(n))) continue;
                seen.add(key(n));
                queue.push(n);
            }
        }
    }
    return null;
}

/**
 * The lead's decision 1 (#593 review 5): a block the bot breaks within DIG_OUT.maxMs with what it holds:
 * its real dig time (prismarine's block.digTime, the harvest tier included: rotn-data's tool rule,
 * burrow.digRule) with the best tool it carries that may break it, or the hand. Never a falling
 * block, one next to a liquid (the dig would let it in), or (#593 review 1) one with a falling block
 * right above it (gravel or sand over the roof drops down the dug column). A block whose dig time is
 * unknown falls back to the pit's rule (hand-diggable, hardness at most PIT.maxHardness).
 */
export const DIG_OUT = { maxBlocks: 6, side: 3, rise: 4, maxMs: 1000 };
export function digMs(bot, b) {
    const rule = digRule(b);
    if (rule === false) return Infinity;
    if (typeof b?.digTime !== 'function') return handDiggable(b) && (dumpState(b)?.hardness ?? Infinity) <= PIT.maxHardness ? 0 : Infinity;
    const effects = bot.entity?.effects ?? {};
    const time = (item) => { try { return b.digTime(item?.type ?? null, false, false, false, [], effects); } catch { return Infinity; } };
    if (rule) { const tool = allowedTool(bot, rule); return tool ? time(tool) : Infinity; } // a tool it requires, of its tier
    const tools = (bot.inventory?.items?.() ?? []).filter(i => /_(pickaxe|shovel|axe|spade|mattock)$/.test(i.name ?? ''));
    return Math.min(time(null), ...tools.map(time));
}
export function quickDig(bot, p) {
    if (typeof bot?.blockAt !== 'function') return false;
    const b = bot.blockAt(p);
    if (!solid(b) || isFalling(b)) return false;
    if (SIX.some(d => isLiquid(bot.blockAt(p.plus(d))))) return false;
    if (isFalling(bot.blockAt(p.offset(0, 1, 0)))) return false;
    return digMs(bot, b) <= DIG_OUT.maxMs;
}

/**
 * The dig-out from `feet`: for each side, `s` blocks of tunnel (0 to DIG_OUT.side) and then `k` stairs up
 * (0 to DIG_OUT.rise), the first (s, k) whose end cell has a walkable exit (WALK_EXIT.reach) with
 * the dug cells counted free. Only plans of at most maxBlocks blocks to dig, every one quickDig, and
 * (with hostiles) ending farther from the nearest of them than the bot is now. The fewest blocks first,
 * then the farthest from the hostiles. Returns {dig: [Vec3] (in order), to: Vec3, side: Vec3} or null.
 */
export function stairOutPlan(bot, feet, { hostiles = [], maxBlocks = DIG_OUT.maxBlocks } = {}) {
    const f = new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z));
    const nearest = (p) => (hostiles.length ? Math.min(...hostiles.map(h => hdist(h.position ?? h, p.offset(0.5, 0, 0.5)))) : Infinity);
    const startFar = nearest(f);
    const plans = [];
    for (const d of HORIZONTAL) {
        for (let s = 0; s <= DIG_OUT.side; s++) {
            const need = []; // cells that must be free, in dig order
            for (let i = 1; i <= s; i++) need.push(f.plus(d.scaled(i)), f.plus(d.scaled(i)).offset(0, 1, 0));
            const base = f.plus(d.scaled(s));
            let ok = true, to = base;
            for (let k = 0; k <= DIG_OUT.rise && ok; k++) {
                if (k > 0) {
                    const prev = base.plus(d.scaled(k - 1)).offset(0, k - 1, 0);
                    to = base.plus(d.scaled(k)).offset(0, k, 0);
                    need.push(prev.offset(0, 2, 0), to, to.offset(0, 1, 0));
                    if (!solid(bot.blockAt(to.offset(0, -1, 0)))) { ok = false; break; } // a step to stand on
                }
                const dig = [...new Map(need.map(p => [key(p), p])).values()].filter(p => solid(bot.blockAt(p)) || !bot.blockAt(p));
                if (dig.length > maxBlocks) { ok = false; break; }
                if (!need.every(p => !isLiquid(bot.blockAt(p)))) { ok = false; break; }
                if (!dig.every(p => quickDig(bot, p))) { ok = false; break; } // every higher step needs it too
                const free = new Set(dig.map(key));
                if (!walkableExit(bot, to, { reach: WALK_EXIT.reach, free })) continue;
                const far = nearest(to);
                if (hostiles.length && !(far > startFar)) break; // toward a hostile: not this way
                plans.push({ dig, to, side: d, far });
                break;
            }
        }
    }
    plans.sort((a, b) => a.dig.length - b.dig.length || b.far - a.far);
    return plans[0] ?? null;
}

/**
 * Run the dig-out: each block dug within its budget (pit.digWithin, which equips the best tool), then a
 * bounded walk to the end cell without digging. Returns {to, dug} when the bot stands at the end cell
 * (or anywhere with a walkable exit), else null with why.
 */
export async function stairOut(bot, feet, { hostiles = [], maxBlocks = DIG_OUT.maxBlocks, walkMs = 15_000 } = {}) {
    const plan = stairOutPlan(bot, feet, { hostiles, maxBlocks });
    if (!plan) return { to: null, dug: 0, why: `no way out within ${maxBlocks} quick blocks, away from the hostiles` };
    let dug = 0;
    for (const p of plan.dig) {
        if (bot.interrupt_code) return { to: null, dug, why: 'stopped' };
        const b = bot.blockAt(p);
        if (!solid(b)) continue;
        const r = await digWithin(bot, b, digBudget(bot, b).limitMs, { equip: digEquip(bot, b) });
        if (r !== true) return { to: null, dug, why: `could not dig ${b.name} at ${p.x}, ${p.y}, ${p.z}` };
        dug++;
    }
    let timer;
    try {
        await Promise.race([goToGoal(bot, new pf.goals.GoalBlock(plan.to.x, plan.to.y, plan.to.z), { canDig: false }).catch(() => null),
            new Promise(resolve => { timer = setTimeout(resolve, walkMs); })]);
    } finally { clearTimeout(timer); try { bot.pathfinder?.setGoal?.(null); } catch { /* best effort */ } }
    const here = bot.entity.position.floored();
    if (here.equals(plan.to) || walkableExit(bot, here, { reach: WALK_EXIT.reach })) return { to: here, dug };
    return { to: null, dug, why: `the walk to ${plan.to.x}, ${plan.to.y}, ${plan.to.z} did not get there` };
}
