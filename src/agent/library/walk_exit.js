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
import { digEquip } from './burrow.js';
import { getItem, registryName } from '../../../packages/rotn-data/index.js';
import { isLiquid, isFalling } from './shelter.js';
import { goToGoal } from './skills.js';
import { digWithin, PIT } from './pit.js';

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
 * The lead's decision 1 (#593 review 5): a block the bot breaks within DIG_OUT.maxMs with what it holds,
 * by its dig time with the best tool it carries, or the hand. Never a falling block, one next to a
 * liquid (the dig would let it in), or (#593 review 1) one with a falling block right above it (gravel
 * or sand over the roof drops down the dug column).
 */
export const DIG_OUT = { maxBlocks: 6, side: 3, rise: 4, maxMs: 1000 };
const TOOL_NAME = /_(pickaxe|shovel|axe|spade|mattock|hoe)$/;
/**
 * #593 re-review 1: the dig time of block b with `tool` (an item, or null: the hand), in ms.
 * - A block in rotn-data's dump, and the hand or a tool rotn-data knows: the vanilla rule from the dump,
 *   hardness * (can harvest ? 1.5 : 5) / speed s, where speed is rotn-data's speed[class] for the
 *   block's harvest tool class when the tool has that class, else 1. A tool the block requires (Tool
 *   Progression) that is missing or below its tier: Infinity (burrow.digEquip would not dig it).
 *   prismarine-block's digTime knows only vanilla item ids (a flint pickaxe on stone read 7.5 s).
 * - A tool rotn-data does not know (no real item today: every *_pickaxe in items.json has toolClasses;
 *   crafttweaker:stone_pickaxe is a recipe id, #593 re-review): a block that requires a tool, Infinity (as
 *   burrow.digEquip/allowedTool refuse it); else the hand's time from the dump (speed 1).
 * - A block with no dump entry: prismarine's block.digTime (vanilla ids only); with
 *   none, the pit's hand rule.
 */
export function toolDigMs(bot, b, tool) {
    const st = dumpState(b);
    const data = tool ? getItem(registryName(tool.name)) : null;
    if (st && Number.isFinite(st.hardness)) {
        if (st.hardness < 0 || (st.toolRequired && !st.harvestTool)) return Infinity;
        if (!tool || data?.toolClasses) {
            const cls = st.harvestTool;
            const level = cls ? data?.toolClasses?.[cls] : undefined;
            const has = Number.isInteger(level) && level >= 0;
            const canHarvest = !st.toolRequired || (has && level >= (st.harvestLevel ?? 0));
            if (st.toolRequired && !canHarvest) return Infinity;
            const speed = has ? (data.speed?.[cls] ?? 1) : 1;
            return st.hardness * (canHarvest ? 1.5 : 5) / Math.max(speed, 1e-6) * 1000;
        }
        // A tool rotn-data does not know: as the hand.
        return st.toolRequired ? Infinity : st.hardness * 1.5 * 1000;
    }
    if (typeof b?.digTime === 'function') { try { return b.digTime(tool?.type ?? null, false, false, false, [], bot.entity?.effects ?? {}); } catch { return Infinity; } }
    return !tool && handDiggable(b) && (st?.hardness ?? Infinity) <= PIT.maxHardness ? 0 : Infinity;
}
/** The best dig time of b with the hand or any tool the bot carries (ms). */
export function digMs(bot, b) {
    return bestDig(bot, b).ms;
}
/** The tools the bot carries (pickaxes, axes, shovels, ... and every item rotn-data gives tool classes). */
const carriedTools = (bot) => (bot.inventory?.items?.() ?? []).filter(i => TOOL_NAME.test(i.name ?? '') || !!getItem(registryName(i.name))?.toolClasses);
/**
 * Soak 14 (F2, net-forge): the bot's effects on dig speed, as vanilla: Mining Fatigue I to IV x0.3, 0.09, 0.0027,
 * 0.00081 (Hunger Overhaul gives them at food 4 to 1 or less), Haste +20% a level. 1 with none.
 */
const FATIGUE = [0.3, 0.09, 0.0027, 0.00081];
export function digSpeedFactor(bot) {
    let f = 1;
    for (const [id, ef] of Object.entries(bot?.entity?.effects ?? {})) {
        const name = String(bot?.registry?.effects?.[id]?.name ?? ef?.name ?? '').toLowerCase().replace(/[^a-z]/g, '');
        const a = Number.isInteger(ef?.amplifier) ? Math.max(0, ef.amplifier) : 0;
        if (name === 'miningfatigue') f *= FATIGUE[Math.min(a, 3)];
        else if (name === 'haste') f *= 1 + 0.2 * (a + 1);
    }
    return f;
}
/** The best dig time of b with the hand or any tool the bot carries, and that tool (null: the hand): {ms, tool}. With the bot's effects (digSpeedFactor). */
export function bestDig(bot, b) {
    let best = { ms: toolDigMs(bot, b, null), tool: null };
    for (const t of carriedTools(bot)) { const ms = toolDigMs(bot, b, t); if (ms < best.ms) best = { ms, tool: t }; }
    best.ms /= digSpeedFactor(bot);
    return best;
}
/**
 * Soak 13 (S2, the lead): what a death keeps (Corpse Complex: the main hand, the off hand and the armour;
 * the rest drops where the bot died). The items in the main and off hand now.
 */
export function keptItems(bot) {
    return [bot?.heldItem ?? null, bot?.inventory?.slots?.[45] ?? null].filter(i => i?.name);
}
/** Soak 13 (S2): the best dig time of b with the hand or an item a death keeps (keptItems), in ms. */
export function keptDigMs(bot, b) {
    return Math.min(toolDigMs(bot, b, null), ...keptItems(bot).map(t => toolDigMs(bot, b, t))) / digSpeedFactor(bot);
}
/**
 * Why a dig of the block at p is not quick, apart from its time: 'a falling block', 'next to a liquid',
 * 'a falling block above', or null.
 */
function digHazard(bot, p, b) {
    if (isFalling(b)) return 'a falling block';
    if (SIX.some(d => isLiquid(bot.blockAt(p.plus(d))))) return 'next to a liquid';
    if (isFalling(bot.blockAt(p.offset(0, 1, 0)))) return 'a falling block above';
    return null;
}
/**
 * kept (soak 13, S2): only the hand and the items a death keeps count (keptDigMs), not every tool carried:
 * the scroll's respawn spot must be left after a death.
 */
export function quickDig(bot, p, { kept = false } = {}) {
    if (typeof bot?.blockAt !== 'function') return false;
    const b = bot.blockAt(p);
    if (!solid(b) || digHazard(bot, p, b)) return false;
    return (kept ? keptDigMs(bot, b) : digMs(bot, b)) <= DIG_OUT.maxMs;
}

const SIDES = [['east', new Vec3(1, 0, 0)], ['west', new Vec3(-1, 0, 0)], ['south', new Vec3(0, 0, 1)], ['north', new Vec3(0, 0, -1)]];
const msText = (ms) => (Number.isFinite(ms) ? `${Math.round(ms)} ms` : 'never');
const cellAt = (p) => `${p.x},${p.y},${p.z}`;
/** One blocking cell: its block, its kept-items dig time (S2), and in parentheses the best tool carried. */
function blockerText(bot, p) {
    const b = bot.blockAt(p);
    if (!b) return `${cellAt(p)} not loaded`;
    const hazard = digHazard(bot, p, b);
    const best = bestDig(bot, b);
    const bestText = Number.isFinite(best.ms) ? `${best.tool?.name ?? 'hand'} ${msText(best.ms)}` : 'never with any tool carried';
    return `${cellAt(p)} ${b.name} ${msText(keptDigMs(bot, b))} (${bestText})${hazard ? `, ${hazard}` : ''}`;
}

/**
 * Soak 13 (S1, the lead): why walkableExit found no way out of `from`, side by side, for the journal: the
 * cells that block each side at feet and head height (block, dig time by hand or with the items a death
 * keeps, then the best tool carried in parentheses), or a side that was open (level, a step up or down)
 * but led to no cell `reach` blocks away, or a drop. `free`: the cells counted free, as for walkableExit.
 */
export function exitReport(bot, from, { free = new Set(), reach = WALK_EXIT.reach } = {}) {
    if (typeof bot?.blockAt !== 'function') return 'no world to look at';
    const f = new Vec3(Math.floor(from.x), Math.floor(from.y), Math.floor(from.z));
    const stand = (p) => passable(bot, p, free) && passable(bot, p.offset(0, 1, 0), free) && solid(bot.blockAt(p.offset(0, -1, 0))) && !free.has(key(p.offset(0, -1, 0)));
    const parts = [];
    for (const [name, d] of SIDES) {
        const side = f.plus(d);
        const tail = `but no walk to ${reach} blocks from there`;
        if (stand(side)) { parts.push(`${name} open, ${tail}`); continue; }
        if (passable(bot, f.offset(0, 2, 0), free) && stand(side.offset(0, 1, 0))) { parts.push(`${name} a step up to ${cellAt(side.offset(0, 1, 0))}, ${tail}`); continue; }
        const open = passable(bot, side, free) && passable(bot, side.offset(0, 1, 0), free);
        if (open && stand(side.offset(0, -1, 0))) { parts.push(`${name} a step down to ${cellAt(side.offset(0, -1, 0))}, ${tail}`); continue; }
        if (open) { parts.push(`${name} a drop at ${cellAt(side.offset(0, -1, 0))} (${bot.blockAt(side.offset(0, -1, 0))?.name ?? 'not loaded'})`); continue; }
        const blocked = [side, side.offset(0, 1, 0)].filter(p => !passable(bot, p, free));
        parts.push(`${name} ${blocked.map(p => blockerText(bot, p)).join(', ')}`);
    }
    return parts.join('; ');
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
        const r = await digWithin(bot, b, Infinity, { equip: digEquip(bot, b) }); // soak 14 (F2): the budget after the equip
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
