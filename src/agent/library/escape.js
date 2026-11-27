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
import { isEmpty, isLiquid, isFalling, hurtsOnContact, shelterItems, softItems, countOf, craftMore, buildShelter, siteNeeds } from './shelter.js';
import { placeableDirt, nightPhase, isWall } from './night.js';
import { shelterEnemy } from './threats.js';
import { heldFoodPoints, nightFoodNeed } from './food.js';
import { burrowDiggable, digEquip, digRule } from './burrow.js';
import { toolLevels } from './rotn_sources.js';
import { handDiggable } from './night.js';
import { bestPickaxe, makePickaxe, pickaxePlan, PICKAXE_RECIPE_TEXT } from './pickaxe.js';
import { digWithin } from './pit.js';
import { goodFloor, inWater, boundedWalk } from './shelter_ground.js';
import { fallSafe, isTreePart } from './fall_safety.js';
import { walkableExit, WALK_EXIT } from './walk_exit.js';
import { planPath, placeBlock, log, craftRecipe } from './skills.js';
import { findItem, inventoryKey } from './rotn_names.js';
import { dumpState } from './night.js';
import { fail, resultOf } from './results.js';
import { getBlock as rotnBlock, registryName as rotnRegistryName } from '../../../packages/rotn-data/index.js';

/**
 * planMs: the pathfinder's search; walkMs: its walk; totalMs: the whole escape; maxPlaced: blocks
 * placed (towers and pillars); maxSteps: stair and pillar steps by hand; targetRadius: how far dry
 * ground is looked for; skyCheck: how high above the bot the sky is looked for; moveMs: the move
 * into a stair step; jumpMs/landMs: a pillar's jump and landing; countMs: how often the held blocks
 * are counted during the pathfinder's walk (each drop is a placement).
 */
export const ESCAPE = { planMs: 5000, walkMs: 60_000, totalMs: 90_000, maxPlaced: 8, maxSteps: 24, targetRadius: 8, skyCheck: 40, moveMs: 3000, jumpMs: 1000, landMs: 1500, countMs: 50,
    // Soak 16 (E): reserve: the sturdy blocks a climb never uses (agenda.SHELTER_HOLD: the night's shelter and its
    // repairs; a test pins the two equal); pileCraftMax: at most this many dirt crafted from piles for one escape.
    reserve: 14, pileCraftMax: 16,
    // Soak 16 trap (21:20): sideSteps: at most this many sideways steps by hand when only the cell over the head is
    // blocked (an ore above the pickaxe's level, a wet cell); tableReach: a crafting table this near counts as at hand.
    sideSteps: 2, tableReach: 4,
    // Soak 17 E(2): remakes: at most this many pickaxes made in one escape when the best one is down to its keep.
    remakes: 3 };

/**
 * Soak 17 E(4) (the lead's decisions): cells: an air volume of at least this many cells beside a cell to dig is a cave
 * (the climb's own dug cells and the bot's cells not counted); hostileRange: a hostile mob this near makes the climb wary
 * of caves (at night it always is). DUSK_SEAL.minDepth: at dusk or night, a day escape this far below the surface stops
 * climbing, seals the bot's two cells (the night's shelter, buildShelter) and leaves the climb to the morning.
 */
export const CAVE = { cells: 16, hostileRange: 16 };
export const DUSK_SEAL = { minDepth: 6 };

/**
 * Soak 16 (E, the lead): the escape's budgets. morning: the night routine's morning and the unstuck reflex, as before
 * (the ESCAPE numbers). day: !goToSurface, the post-condition of digging commands and the respawn escape: the depth to
 * the target (or the sky) + extraSteps steps by hand, totalMs in all, and every block the order below allows (at most
 * maxPlaced). Soak 15's pocket was 8 below the surface: 24 steps and 90 s were too few once the walk had failed.
 */
export const ESCAPE_DAY = { totalMs: 5 * 60_000, walkMs: 120_000, extraSteps: 8, maxPlaced: 32 };
// #624 review 4 (the lead): only the day budget keeps the shelter's reserve; the morning and the unstuck reflex are
// emergencies (a whole day to gather blocks again) and may spend it, dirt and planks first.
function budgetOf(bot, kind, target) {
    if (kind !== 'day') return { kind: 'morning', totalMs: ESCAPE.totalMs, walkMs: ESCAPE.walkMs, maxSteps: ESCAPE.maxSteps, maxPlaced: ESCAPE.maxPlaced, reserve: 0 };
    // #624 review 1: the depth from the real surface (the ground around the bot), not the bot's own column, which is
    // open to the sky in a shaft (skyY gave 0 there).
    const depth = Math.max(0, (target ? target.y : surfaceAround(bot)) - feetOf(bot).y);
    return { kind: 'day', totalMs: ESCAPE_DAY.totalMs, walkMs: ESCAPE_DAY.walkMs, maxSteps: depth + ESCAPE_DAY.extraSteps, maxPlaced: ESCAPE_DAY.maxPlaced, reserve: ESCAPE.reserve };
}
const reserveOf = (state) => state?.budget?.reserve ?? 0;

const UP = new Vec3(0, 1, 0);
const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const SIX = [...HORIZONTAL, UP, new Vec3(0, -1, 0)];
const at = (p) => `${p.x}, ${p.y}, ${p.z}`;
const key = (p) => `${p.x},${p.y},${p.z}`;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const feetOf = (bot) => bot.entity.position.floored();
const solid = (b) => !!b && b.boundingBox === 'block' && !isLiquid(b) && !hurtsOnContact(b);
// #630 review 3: a tree part (fall_safety.isTreePart: Dynamic Trees branches, trunk shells, leaves) or a vanilla log,
// which isTreePart does not list (#624 review 8; fall_safety unchanged here).
const treeLike = (b) => !!b && (isTreePart(b) || /(^|:)log2?$|_log$/.test(b.name ?? ''));

/** Nothing but air (or unloaded) above p's head cell up to skyCheck: open sky. Water above is not. */
export function openSky(bot, p) {
    for (let y = p.y + 2; y <= p.y + ESCAPE.skyCheck; y++) {
        const b = bot.blockAt(new Vec3(p.x, y, p.z));
        if (!b) return true;
        if (!isEmpty(b)) return false;
    }
    return true;
}

/**
 * Soak 16 (E): sky above p, where tree parts (leaves, logs, branches) count as sky: under a canopy the bot is out, and
 * the escape never climbs into a tree (soak 15: a giant taiga's leaves at y 72 over the ground at 64). Water above is
 * no sky. `top`: a column memo (x,z -> the highest block above that is neither empty nor a tree part), for searches.
 */
export function skyAbove(bot, p, top = null) {
    return topOf(bot, p.x, p.z, top, p.y) < p.y + 2;
}
/**
 * The highest block of column x,z that is neither empty nor a tree part, or -Infinity. With a memo (`top`, its .base
 * the search's start y): the column is scanned once, from base + skyCheck + 12 down to base - 12 (#624 review 6:
 * the range a search can reach: its cells are within a few blocks of base), so every cell of that column reads it
 * once. Without: from y + skyCheck down to y + 2 (the sky over one cell).
 */
function topOf(bot, x, z, top = null, y = 0) {
    const k = `${x},${z}`;
    let y0 = top?.get(k);
    if (y0 !== undefined) return y0;
    y0 = -Infinity;
    const from = top ? (top.base ?? y) : y;
    for (let yy = from + ESCAPE.skyCheck + (top ? 12 : 0); yy >= (top ? from - 12 : y + 2); yy--) {
        const b = bot.blockAt(new Vec3(x, yy, z));
        if (b && !isEmpty(b) && !isTreePart(b)) { y0 = yy; break; }
    }
    top?.set(k, y0);
    return y0;
}
/** #624 review 1: the ground's height around the bot: one above the highest top (topOf) of its column and the 8 around it. */
function surfaceAround(bot) {
    const p = feetOf(bot);
    const top = new Map();
    top.base = p.y;
    let best = -Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) best = Math.max(best, topOf(bot, p.x + dx, p.z + dz, top) + 1);
    return Number.isFinite(best) ? best : skyY(bot);
}

/**
 * Soak 16 (E): room to walk at p: how many of the 4 sides the bot can step to (level, one up with headroom, or one
 * down). The bottom of a hole open to the sky has 0 or 1 (the stairs it came down): sky over it is no way out.
 */
const passCell = (b) => !!b && b.boundingBox !== 'block' && !isLiquid(b);
// #624 review 5: a step onto leaves (a tree part) is no room: never "out" standing next to leaves only.
const standCell = (bot, c) => { const f = bot.blockAt(c.offset(0, -1, 0)); return passCell(bot.blockAt(c)) && passCell(bot.blockAt(c.offset(0, 1, 0))) && solid(f) && !isTreePart(f); };
export function roomAround(bot, p) {
    let n = 0;
    for (const d of HORIZONTAL) {
        const side = p.plus(d);
        if (standCell(bot, side) || (passCell(bot.blockAt(p.offset(0, 2, 0))) && standCell(bot, side.offset(0, 1, 0))) || (passCell(bot.blockAt(side)) && passCell(bot.blockAt(side.offset(0, 1, 0))) && standCell(bot, side.offset(0, -1, 0)))) n++;
    }
    return n;
}
/** Soak 16 (E): open ground: a good floor that is no tree part, the sky above (skyAbove), and room to walk (2 sides or more). */
export function openGround(bot, p, top = null) {
    return passCell(bot.blockAt(p)) && passCell(bot.blockAt(p.offset(0, 1, 0))) && goodFloor(bot, p) && !isTreePart(bot.blockAt(p.offset(0, -1, 0))) && skyAbove(bot, p, top) && roomAround(bot, p) >= 2;
}

/**
 * #624 review 1 and 5: the day escape's target: the nearest open ground (openGround) at the ground of a column within
 * targetRadius (one above its topOf: the ground under a canopy, the rim of a shaft), never the start cell; nearest
 * horizontally, then the smallest climb. null: none in reach (the escape goes up toward the sky).
 */
export function groundTarget(bot) {
    const p = feetOf(bot);
    const top = new Map();
    top.base = p.y;
    const r = ESCAPE.targetRadius;
    let best = null;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const y0 = topOf(bot, p.x + dx, p.z + dz, top);
        if (!Number.isFinite(y0)) continue;
        const c = new Vec3(p.x + dx, y0 + 1, p.z + dz);
        if (c.equals(p) || !openGround(bot, c, top)) continue;
        const d = Math.hypot(dx, dz) + Math.abs(c.y - p.y) * 0.01;
        if (!best || d < best.d) best = { c, d };
    }
    return best?.c ?? null;
}

/**
 * Out: not in a liquid, on a good floor (shelter_ground.goodFloor), and under the sky (skyAbove) or at the target.
 * strict (soak 16, E: the day budget): on open ground (openGround: room to walk too), or at the target.
 */
export function isOut(bot, target = null, strict = false) {
    const p = feetOf(bot);
    if (inWater(bot) || !goodFloor(bot, p)) return false;
    // #624 review 1: strict (the day budget) is open ground only: a target next to the start cell never counts.
    if (strict) return openGround(bot, p);
    const at = !!target && Math.abs(p.x - target.x) <= 1 && Math.abs(p.y - target.y) <= 1 && Math.abs(p.z - target.z) <= 1;
    return skyAbove(bot, p) || at;
}

/** Where to get out to: the nearest dry cell (free, no liquid, good floor) under open sky within targetRadius (and 4 up, 2 down), or null (then: up toward the sky). */
export function escapeTarget(bot) {
    const base = feetOf(bot);
    const r = ESCAPE.targetRadius;
    let best = null;
    for (let dy = -2; dy <= 4; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const p = base.offset(dx, dy, dz);
        if (!isEmpty(bot.blockAt(p)) || !isEmpty(bot.blockAt(p.offset(0, 1, 0))) || !goodFloor(bot, p) || isTreePart(bot.blockAt(p.offset(0, -1, 0))) || !skyAbove(bot, p)) continue;
        const d = Math.abs(dx) + Math.abs(dz) + Math.abs(dy);
        if (!best || d < best.d) best = { p, d };
    }
    return best?.p ?? null;
}

/** The first air cell above the highest block over the bot that is no tree part (within skyCheck): the height the sky starts at. */
export function skyY(bot) {
    const p = feetOf(bot);
    for (let y = p.y + ESCAPE.skyCheck; y >= p.y + 2; y--) {
        const b = bot.blockAt(new Vec3(p.x, y, p.z));
        if (b && !isEmpty(b) && !isTreePart(b)) return y + 1;
    }
    return p.y;
}

/**
 * Soak 16 (E): trapped: no walkable way (on foot, no digging: walk_exit.walkableExit's steps) from the feet to a cell
 * with sky above (skyAbove) within ESCAPE.targetRadius. Cheap: the sky over the feet ends it at once (one column);
 * else one search of at most WALK_EXIT.maxNodes cells, the sky per column memoized (one scan per column). No
 * pathfinder here: the escape's first stage is the pathfinder. Returns {trapped, exit, nodes}.
 */
export function isTrapped(bot) {
    const p = feetOf(bot);
    if (typeof bot?.blockAt !== 'function') return { trapped: false, exit: null, nodes: 0 };
    if (!inWater(bot) && openGround(bot, p)) return { trapped: false, exit: p, nodes: 0 };
    const top = new Map();
    top.base = p.y;
    let nodes = 0;
    const exit = walkableExit(bot, p, { maxNodes: WALK_EXIT.maxNodes, radius: ESCAPE.targetRadius,
        until: (c) => { nodes++; return openGround(bot, c, top); } });
    return { trapped: !exit, exit, nodes };
}

/**
 * Soak 16 (E, the lead's order): the blocks a climb may place: dirt first, then planks, then sturdy blocks (cobble,
 * stone) only beyond ESCAPE.reserve (the night's shelter and its repairs). Stacks in that order; buildCount: how many
 * may be placed. The pathfinder places in the order of its scafoldingBlocks (Movements.getScaffoldingItem), so the
 * reserve is never reached while dirt or planks are held.
 */
const isPlanks = (i) => /(^|:)planks$|_planks$/.test(i?.name ?? '');
const plankStacks = (bot) => bot.inventory.items().filter(isPlanks).sort((a, b) => b.count - a.count);
const buildStacks = (bot) => [...softItems(bot), ...plankStacks(bot), ...shelterItems(bot)];
const buildCount = (bot, reserve = 0) => countOf(softItems(bot)) + countOf(plankStacks(bot)) + Math.max(0, countOf(shelterItems(bot)) - reserve);

/**
 * The pathfinder's movements for the escape: fall-safe; digging and 1x1 towers with the held blocks;
 * digging preferred; no flow, no parkour, no sprint. #562 review 2: the planner sees at most the
 * blocks left in the budget (ESCAPE.maxPlaced - state.placed), whatever the bot holds.
 */
export function escapeMovements(bot, state = { placed: 0 }) {
    const m = fallSafe(new pf.Movements(bot));
    const held = typeof m.countScaffoldingItems === 'function' ? m.countScaffoldingItems.bind(m) : () => buildCount(bot);
    m.countScaffoldingItems = () => Math.max(0, Math.min(held(), buildCount(bot, reserveOf(state)), (state.budget?.maxPlaced ?? ESCAPE.maxPlaced) - state.placed));
    m.canDig = true;
    m.allow1by1towers = true;
    m.allowParkour = false;
    m.allowSprinting = false;
    m.dontCreateFlow = true;
    m.scafoldingBlocks = [...new Set(buildStacks(bot).map(s => s.type).filter(Number.isInteger))]; // in the climb's order
    m.digCost = 1;
    m.placeCost = 8; // the lead: digging over placing when both work
    return m;
}

/** Soak 16 (E4): a falling block (gravel, sand) over the head or the stair cells, named for the model's line. */
function fallingNear(bot, p) {
    for (const c of [p.offset(0, 3, 0), p.offset(0, 4, 0), ...HORIZONTAL.flatMap(d => [p.plus(d).offset(0, 2, 0), p.plus(d).offset(0, 3, 0)])]) {
        const b = bot.blockAt(c);
        if (isFalling(b)) return ` (a falling ${b.name} above at ${at(c)})`;
    }
    return '';
}

/** The why of a climb blocked for want of a pickaxe (digWhy's text). */
export const NO_PICKAXE = /needs a pickaxe \(you carry none\)/;

/**
 * Soak 16 trap (21:20, "no room to pillar"): why a cell cannot be dug for the escape, naming the cell and its block,
 * or null when it can: empty already, or diggable (burrow.burrowDiggable: by hand or a held tool, never a tree part),
 * with no liquid next to it or above it (ours excepted: the bot's own two cells, and the other cells of the same step),
 * and nothing that falls above it.
 */
export function digWhy(bot, c, ours) {
    const b = bot.blockAt(c);
    if (!b) return `${at(c)} is not loaded`;
    if (isLiquid(b)) return `${at(c)} is ${b.name}`;
    if (isEmpty(b)) return null;
    if (!burrowDiggable(bot, b)) return `${at(c)} is ${b.name}, which ${cantDigText(bot, b)}`;
    for (const d of SIX) {
        const q = c.plus(d);
        if (ours.has(key(q))) continue;
        const n = bot.blockAt(q);
        if (isLiquid(n)) return `${at(c)} (${b.name}) has ${n.name} next to it`;
        if (d.y === 1 && isFalling(n)) return `${at(c)} (${b.name}) has a falling ${n.name} on it`;
    }
    return null;
}
const safeToDig = (bot, c, ours) => digWhy(bot, c, ours) === null;

/** Why burrowDiggable says no, in words: the tool the dump asks for and what the bot carries. */
function cantDigText(bot, b) {
    if (isTreePart(b)) return 'is part of a tree (never dug in a climb)';
    if (!solid(b)) return 'is no full block to dig';
    const rule = digRule(b);
    if (rule === false) return 'nothing can break';
    if (rule === undefined) return handDiggable(b) ? 'cannot be dug here' : 'needs a tool (not by hand)';
    if (!rule) return 'cannot be dug here';
    const levels = toolLevels(bot, rule.type);
    return levels.length ? `needs a level ${rule.minLevel} ${rule.type} (yours: level ${Math.max(...levels)})` : `needs a ${rule.type} (you carry none)`;
}

/**
 * The next step by hand, or {why}: {kind: 'stair', d, dig, to} (up one, toward d: the headroom over
 * the bot, the new feet and head cells; the block toward d stays to stand on), toward the target
 * first; else {kind: 'pillar', dig} (the headroom; then a block placed in the feet cell), when the bot
 * stands on solid ground and has a block left in the budget.
 */
export function nextStep(bot, target, state) {
    const p = feetOf(bot);
    state.cave = null;
    const head2 = p.offset(0, 2, 0);
    const toward = (d) => (target ? -(d.x * (target.x - p.x) + d.z * (target.z - p.z)) : 0);
    // #624 nit (the respawn escape at night): with hostiles given, the side away from them first.
    const near = (d) => (state.away?.length ? -Math.min(...state.away.map(h => Math.hypot(p.x + d.x + 0.5 - h.x, p.z + d.z + 0.5 - h.z))) : 0);
    const stairs = [];
    for (const d of [...HORIZONTAL].sort((a, b) => (state.away?.length ? (near(a) - near(b)) || (toward(a) - toward(b)) : toward(a) - toward(b)))) {
        const to = p.plus(d).offset(0, 1, 0);
        const cells = [head2, to, to.offset(0, 1, 0)];
        const ours = new Set([key(p), key(p.offset(0, 1, 0)), ...cells.map(key)]);
        if (!solid(bot.blockAt(p.plus(d)))) continue; // the step stood on
        // #630 review 3: never a step onto a tree part (up a trunk into the canopy, in a climb toward the sky).
        if (treeLike(bot.blockAt(p.plus(d)))) continue;
        // #562 review 6: the new feet and head cells must not touch one of the bot's own cells that
        // holds a liquid (its head under water): dug, they would let that water through.
        if ([to, to.offset(0, 1, 0)].some(c => SIX.some(e => { const q = c.plus(e); return (q.equals(p) || q.equals(p.offset(0, 1, 0))) && isLiquid(bot.blockAt(q)); }))) continue;
        if (!cells.every(c => safeToDig(bot, c, ours))) continue;
        // Soak 17 E(4)(ii): wary (night, or a hostile near): never a step dug into a cave; the next direction instead.
        const caveCell = state.wary ? cells.find(c => !isEmpty(bot.blockAt(c)) && opensCave(bot, c, ours, state.dugSet)) : null;
        if (caveCell) { state.cave = caveCell; continue; }
        stairs.push({ kind: 'stair', d, to, dig: cells.filter(c => !isEmpty(bot.blockAt(c))) });
        break;
    }
    if (stairs.length) return stairs[0];
    if (!solid(bot.blockAt(p.offset(0, -1, 0)))) return { why: `nothing solid under the feet at ${at(p)} to pillar up from` };
    const maxPlaced = state.budget?.maxPlaced ?? ESCAPE.maxPlaced;
    if (state.placed >= maxPlaced) return { why: `no stair step, and the ${maxPlaced} blocks for pillars are spent` };
    const reserve = reserveOf(state);
    if (buildCount(bot, reserve) < 1) return { why: `no stair step, and no block to pillar up with${reserve > 0 && countOf(shelterItems(bot)) > 0 ? ` (the ${Math.min(countOf(shelterItems(bot)), reserve)} sturdy blocks kept for the night's shelter are not used)` : ''}` };
    const ours = new Set([key(p), key(p.offset(0, 1, 0)), key(head2)]);
    const blocked = digWhy(bot, head2, ours) ?? digWhy(bot, head2.offset(0, 1, 0), new Set([...ours, key(head2.offset(0, 1, 0))]));
    const pillarDig = [head2, head2.offset(0, 1, 0)].filter(c => !isEmpty(bot.blockAt(c)));
    // Soak 17 E(4)(ii): nor the headroom dug into a cave: a step sideways first, else the climb stops here.
    const caveUp = !blocked && state.wary ? pillarDig.find(c => opensCave(bot, c, ours, state.dugSet)) : null;
    if (caveUp) state.cave = caveUp;
    if (!blocked && !caveUp) return { kind: 'pillar', dig: pillarDig };
    // Soak 16 trap: the cell over the head blocks every stair and the pillar: a step sideways (feet and head height,
    // no headroom needed) to a column whose own headroom can be dug, at most ESCAPE.sideSteps per escape.
    const side = (state.sides ?? 0) < ESCAPE.sideSteps ? sideStep(bot, target, state, p) : null;
    if (side) return side;
    if (caveUp || (!stairs.length && state.cave)) return { why: `the way up opens into a cave at ${at(caveUp ?? state.cave)} (${caveWhy(bot)}): not dug into it`, cave: true };
    return { why: `no stair step, and no room to pillar up above ${at(p)}: ${blocked}${fallingNear(bot, p)}` };
}
const caveWhy = (bot) => (Number.isFinite(timeOfDay(bot)) && nightPhase(timeOfDay(bot)) === 'night' ? 'at night' : `a hostile mob within ${CAVE.hostileRange} blocks`);

/** A sideways step: the side cell and the one above it dug (or empty), solid ground under it, and its headroom diggable. */
function sideStep(bot, target, state, p) {
    const toward = (d) => (target ? -(d.x * (target.x - p.x) + d.z * (target.z - p.z)) : 0);
    for (const d of [...HORIZONTAL].sort((a, b) => toward(a) - toward(b))) {
        const to = p.plus(d);
        const under = bot.blockAt(to.offset(0, -1, 0));
        if (!solid(under) || treeLike(under)) continue;
        const cells = [to, to.offset(0, 1, 0)];
        const ours = new Set([key(p), key(p.offset(0, 1, 0)), ...cells.map(key), key(to.offset(0, 2, 0))]);
        if (!cells.every(c => safeToDig(bot, c, ours))) continue;
        if (!safeToDig(bot, to.offset(0, 2, 0), ours)) continue; // no use stepping under another blocked cell
        return { kind: 'side', d, to, dig: cells.filter(c => !isEmpty(bot.blockAt(c))) };
    }
    return null;
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
    const r = await digWithin(bot, block, left, equip ? { equip } : {}); // soak 14 (F2): the budget after the equip, within left
    if (r === 'timeout' && Date.now() >= deadline) return 'time';
    return r === true && isEmpty(bot.blockAt(c));
}

/** A crafting table within ESCAPE.tableReach (the pickaxe craft's table at hand). */
function tableNearOf(bot) {
    try { return !!bot.findBlock?.({ matching: (b) => /crafting_table$/.test(b?.name ?? ''), maxDistance: ESCAPE.tableReach }); } catch { return false; }
}
const needsPickaxe = (b) => { try { return digRule(b)?.type === 'pickaxe'; } catch { return false; } };

/**
 * Soak 17 E(2) (the lead): escape 2 dug 53 cells and used up two stone pickaxes; with stone overhead and no pickaxe,
 * escape 3 stopped ("none can be made here"), though the bot carried 510 rocks and 4 planks. Before a dig that needs a
 * pickaxe, a best pickaxe down to its keep (pickaxe.walkKeep) is replaced first when another can be made from what the
 * bot carries (pickaxePlan, the table chain included) and no hostile is near; else its last uses are spent (#642).
 * At most ESCAPE.remakes a escape. Returns true when a pickaxe was made.
 */
async function remakeAtKeep(bot, state, { craft, say }) {
    const best = bestPickaxe(bot);
    if (!best || best.uses > best.keep || (state.remade ?? 0) >= ESCAPE.remakes || state.away.length || !craft) return false;
    // #667 review 4 (the lead): a real scan for hostiles (not only the respawn escape's list): with one near, no table is
    // placed and nothing is crafted (the reflexes defend in place); the re-make comes once it is clear, else the last uses
    // are spent.
    const mob = hostileNear(bot);
    if (mob) {
        if (state.remakeHeld !== mob.id) { state.remakeHeld = mob.id; say(`[escape] the ${best.item.name} has ${best.uses} uses left (keep ${best.keep}); not making another with a ${mob.name ?? 'hostile mob'} within ${CAVE.hostileRange} blocks (later, once it is clear)`); }
        return false;
    }
    const tableNear = tableNearOf(bot);
    const plan = pickaxePlan(bot, { tableNear });
    const tag = `${best.item.name}:${best.uses}`;
    if (!plan.ready) {
        if (state.remakeSaid !== tag) { state.remakeSaid = tag; say(`[escape] the ${best.item.name} has ${best.uses} uses left (keep ${best.keep}); no other can be made here (${plan.why}): its last uses are spent`); }
        return false;
    }
    say(`[escape] the ${best.item.name} has ${best.uses} uses left (keep ${best.keep}): making another first`);
    state.remade = (state.remade ?? 0) + 1;
    const r = await makePickaxe(bot, { craft, tableNear, say });
    if (!r.made) say(`[escape] the new pickaxe was not made (${r.why}); the old one's last uses are spent`);
    return !!r.made;
}

/** #667 review 6: the time of day by the night routine's freeze-aware clock (bot.rotnTimeOfDay), else the raw time. */
function timeOfDay(bot) {
    try { const t = bot.rotnTimeOfDay?.(); if (Number.isFinite(t)) return t; } catch { /* the raw time */ }
    return bot.time?.timeOfDay;
}
/** A hostile mob (threats.shelterEnemy) within CAVE.hostileRange, or null. */
function hostileNear(bot) {
    const me = bot.entity?.position;
    if (!me) return null;
    return Object.values(bot.entities ?? {}).find(e => e !== bot.entity && e?.position && e.position.distanceTo(me) <= CAVE.hostileRange && shelterEnemy(e)) ?? null;
}
/** Soak 17 E(4)(ii): wary of caves: at night, or with a hostile mob within CAVE.hostileRange. */
function caveWary(bot) {
    const t = timeOfDay(bot);
    if (Number.isFinite(t) && nightPhase(t) === 'night') return true;
    return !!hostileNear(bot);
}

/**
 * Soak 17 E(4)(ii) (18:09, escape 4): the climb opened its shaft into a cave at y 57-61 with zombies in it, and died
 * there. Whether digging cell c opens into a cave: an empty neighbour (not one of `ours`, not a cell this escape dug)
 * from which at least CAVE.cells empty cells connect.
 */
export function opensCave(bot, c, ours, dug = new Set()) {
    const skip = (q) => ours.has(key(q)) || dug.has(key(q));
    for (const d of SIX) {
        const n = c.plus(d);
        if (skip(n) || !isEmpty(bot.blockAt(n))) continue;
        const seen = new Set([key(n)]);
        const queue = [n];
        while (queue.length && seen.size < CAVE.cells) {
            const q = queue.shift();
            for (const e of SIX) {
                const r = q.plus(e);
                const k = key(r);
                if (seen.has(k) || skip(r) || r.equals(c)) continue;
                const b = bot.blockAt(r);
                if (!b || !isEmpty(b)) continue;
                seen.add(k);
                queue.push(r);
            }
        }
        if (seen.size >= CAVE.cells) return true;
    }
    return false;
}

/**
 * Soak 17 E(4)(iii) (the lead): at dusk or night a day escape still DUSK_SEAL.minDepth or more below the surface stops
 * climbing (18:09: it reached a cave full of zombies at dusk and died in its own shaft): why, or null.
 */
export function duskSealDue(bot, state) {
    if (state?.budget?.kind !== 'day' || state.duskTried) return null; // #667 review 2: tried once an escape
    const t = timeOfDay(bot);
    if (!Number.isFinite(t)) return null;
    const phase = nightPhase(t);
    if (phase === 'day') return null;
    const depth = surfaceAround(bot) - feetOf(bot).y;
    if (!(depth >= DUSK_SEAL.minDepth)) return null;
    return `it is ${phase} and the bot is still ${depth} below the surface`;
}

/** The time to wait: ms, but no more than is left before the deadline (#562 nit: the 90 s is exact). */
const within = (ms, deadline) => Math.max(0, Math.min(ms, deadline - Date.now()));
/** A promise, or 'time' once ms have passed. */
const orTime = (promise, ms) => { let timer; return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve('time'), ms); })]).finally(() => clearTimeout(timer)); };

/** Into the stair step at `to`: look at it, forward and jump until the feet are in it (at most moveMs, and never past the deadline). */
export async function stepInto(bot, to, deadline = Infinity) {
    const c = to.offset(0.5, 0, 0.5);
    try {
        await bot.lookAt(new Vec3(c.x, to.y + 1.6, c.z), true);
        bot.setControlState('forward', true);
        bot.setControlState('jump', true);
        const limit = within(ESCAPE.moveMs, deadline);
        for (let waited = 0; !feetOf(bot).equals(to) && waited < limit; waited += 50) await sleep(50);
    } finally {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
    }
    return feetOf(bot).equals(to);
}

/**
 * One pillar step (also !placeHere in the bot's own cell, PR 2): with a block in hand, look down,
 * jump, and at the top of the jump place it on the block under the feet; then land on it. True when
 * the feet are one up and the old feet cell is solid. item: the stack to place. deadline (#562 nit):
 * the jump, the place and the landing never wait past it.
 */
export async function pillarUp(bot, item, deadline = Infinity, info = {}) {
    // Soak 17 E(3): 18:03:58 "could not pillar up from 79, 25, 68" said nothing more: info.why now says which part failed.
    const p = feetOf(bot);
    const floor = bot.blockAt(p.offset(0, -1, 0));
    if (!item) { info.why = 'no block to place'; return false; }
    if (!solid(floor)) { info.why = `nothing solid under the feet (${floor?.name ?? 'unloaded'})`; return false; }
    try {
        try { await bot.equip(item, 'hand'); } catch (err) { info.why = `the ${item.name} could not be taken in hand (${err?.message ?? err})`; return false; }
        if (bot.heldItem?.name !== item.name) { info.why = `holding ${bot.heldItem?.name ?? 'nothing'}, not the ${item.name}`; return false; }
        await bot.look(bot.entity.yaw ?? 0, -Math.PI / 2, true);
        bot.setControlState('jump', true);
        const jump = within(ESCAPE.jumpMs, deadline);
        for (let waited = 0; bot.entity.position.y < p.y + 1 && waited < jump; waited += 25) await sleep(25);
        // #562 review 7: a jump that did not get the feet out of the cell: no block into the bot's own cell.
        if (bot.entity.position.y < p.y + 1) { info.why = `the jump did not lift the feet out of the cell (y ${bot.entity.position.y.toFixed(2)} of ${p.y + 1}; the head cell is ${bot.blockAt(p.offset(0, 2, 0))?.name ?? 'unloaded'})`; return false; }
        const left = within(ESCAPE.jumpMs, deadline);
        if (left <= 0) { info.why = 'the time ran out at the top of the jump'; return false; }
        try { await orTime(Promise.resolve(bot.placeBlock(floor, UP)), left); } catch (err) { info.placeError = err?.message ?? String(err); /* checked below: the server may confirm late */ }
    } finally {
        bot.setControlState('jump', false);
    }
    const land = within(ESCAPE.landMs, deadline);
    for (let waited = 0; feetOf(bot).y !== p.y + 1 && waited < land; waited += 50) await sleep(50);
    const placed = solid(bot.blockAt(p));
    if (placed && feetOf(bot).y === p.y + 1) return true;
    info.why = !placed ? `the ${item.name} did not stay at ${at(p)} (it is ${bot.blockAt(p)?.name ?? 'unloaded'}${info.placeError ? `; the place said: ${info.placeError}` : ''})`
        : `placed, but the feet did not land on it (at y ${feetOf(bot).y})`;
    return false;
}

/** Soak 17 E(3): wait (at most ms) for the hands' clicks to settle (bot.rotnHandsBusy: a dig's pickaxe swap, a repair). */
async function handsSettled(bot, ms) {
    for (let waited = 0; bot.rotnHandsBusy && waited < ms; waited += 50) await sleep(50);
}

/** Items !placeHere puts where the bot stands, as upstream (after a step aside): never pillared on. */
const NOT_PILLARED = /torch|redstone|lever|button|rail|tripwire|bucket|string|carpet|sign|ladder|sapling|flower|seed|pressure_plate|snow_layer/;

/** A full solid block (the dump's fullCube, else the registry's bounding box), the kind a pillar stands on. */
function fullBlockItem(bot, item) {
    if (!item || NOT_PILLARED.test(item.name)) return false;
    const st = dumpState({ name: item.name, metadata: item.metadata ?? 0 });
    if (st) return st.fullCube === true && st.solid !== false;
    const base = item.name.includes(':') ? item.name.split(':').pop() : item.name;
    return bot.registry?.blocksByName?.[base]?.boundingBox === 'block';
}

/**
 * !placeHere (the lead's escape plan PR 2 (3)). Soak 8: "Failed to place … at (-90, 61, -127)" three
 * times: the spot is the bot's own cell, the step aside first had no path, and the server refuses a
 * block inside the bot. A full block now goes in by a jump (pillarUp): the bot ends standing on it,
 * one up. Torches and the like (NOT_PILLARED), and items that are no full block: upstream's
 * placeBlock (a step aside first). Returns whether it was placed. pillar, place: the tests' own.
 */
export async function placeHere(bot, type, { pillar = pillarUp, place = placeBlock } = {}) {
    const p = feetOf(bot);
    const item = findItem(bot, type);
    if (!item || !fullBlockItem(bot, item)) return place(bot, type, p.x, p.y, p.z);
    const refused = jumpPlaceRefusal(bot, type, p);
    if (refused) return fail(bot, refused.code, refused.why, p, 'placeHere');
    // Round 17 K (dl16:1635, dl17:344): pillarUp's own reason (#667) is said, not dropped.
    const info = {};
    if (await pillar(bot, item, Infinity, info)) {
        log(bot, `Placed ${type} at ${at(p)} by jumping and putting it under you: you now stand on it at ${at(feetOf(bot))}.`);
        return true;
    }
    return fail(bot, 'jump-failed', `Could not place ${type} at ${at(p)}: you are in that cell, and the jump-and-place did not take (still at ${at(feetOf(bot))})`
        + `${info.why ? `: ${info.why}` : ''}.`, p, 'placeHere');
}

/** Round 17 K: placeHere's result, {ok, code, why, where}, for the command layer; placeHere stays boolean. */
export function placeHereResult(bot, type, opts = {}) {
    // Its own failures, and placeBlock's for the items placeHere hands to it (torches and the like, no full block).
    return resultOf(bot, () => placeHere(bot, type, opts), ['placeHere', 'placeBlock']);
}

/**
 * The two checks before the jump that puts a full block under the bot: something solid under the feet, and room above
 * the head. {code, why} or null. Pure reads: placeHere and !placeHere's canRun (commands/preconditions.js) both use it.
 */
export function jumpPlaceRefusal(bot, type, p = feetOf(bot)) {
    const floor = bot.blockAt(p.offset(0, -1, 0));
    const head2 = bot.blockAt(p.offset(0, 2, 0));
    if (!solid(floor))
        return { code: 'no-floor', why: `Cannot place ${type} where you stand at ${at(p)}: you are in that cell, and there is nothing solid under your feet to jump off and put it on.` };
    if (!isEmpty(head2) && !isLiquid(head2))
        return { code: 'no-headroom', why: `Cannot place ${type} where you stand at ${at(p)}: you are in that cell, and the ${head2?.name ?? 'block'} above your head leaves no room to jump and put it under you.` };
    return null;
}

/**
 * Round 17 K: !placeHere's precondition (canRun), before anything running is stopped: {code, why} or null.
 * - none held (dl16:798);
 * - a modded item with no block form in rotn-data or the registry (dl16:456: hitwithaxe:bark). Vanilla items are left
 *   to placeBlock: some place a block of another name (a sign, seeds, a repeater);
 * - a full block: jumpPlaceRefusal (dl17:308), with what to do.
 */
export function placeHereRefusal(bot, type) {
    const item = findItem(bot, type);
    if (!item) {
        const blocks = [...new Set(bot.inventory.items().filter(i => fullBlockItem(bot, i)).map(i => i.name))].slice(0, 4);
        return { code: 'not-held', why: `Cannot place ${type}: you hold none${blocks.length ? ` (blocks you hold: ${blocks.join(', ')})` : ''}.` };
    }
    if (!hasBlockForm(bot, item.name))
        return { code: 'not-a-block', why: `Cannot place ${type}: ${item.name} is an item, not a block.` };
    if (!fullBlockItem(bot, item)) return null;
    const refused = jumpPlaceRefusal(bot, type);
    if (refused?.code === 'no-headroom') {
        const head = bot.blockAt(feetOf(bot).offset(0, 2, 0));
        const leaves = /leaves/.test(head?.name ?? '');
        return { ...refused, why: `${refused.why} ${leaves ? `Break the ${head.name} above you first, or step` : 'Step'} to a cell with open air above you (!moveAway(2)).` };
    }
    return refused;
}

/** Whether a modded item places a block: rotn-data or the registry knows a block of its name. Vanilla: always true. */
function hasBlockForm(bot, name) {
    if (!name.includes(':') || name.startsWith('minecraft:')) return true;
    try { if (rotnBlock(rotnRegistryName(name))) return true; } catch { return true; } // no data: never refused
    const base = name.split(':').pop();
    return !!(bot.registry?.blocksByName?.[name] || bot.registry?.blocksByName?.[base]);
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
        r = await boundedWalk(bot, () => bot.pathfinder.goto(goal), Math.min(state.budget?.walkMs ?? ESCAPE.walkMs, Math.max(0, deadline - Date.now())),
            () => { count(); return state.placed >= (state.budget?.maxPlaced ?? ESCAPE.maxPlaced) ? 'blocks' : bot.interrupt_code ? 'interrupted' : null; });
    } finally {
        clearInterval(counter);
        count();
        if (before) { try { bot.pathfinder.setMovements(before); } catch { /* best effort */ } }
    }
    return isOut(bot, target, state.budget?.kind === 'day' || !!state.budget?.strict) ? { out: true } : { why: r.stopped === 'blocks' ? `the pathfinder used the ${state.budget?.maxPlaced ?? ESCAPE.maxPlaced} blocks` : r.stopped ? `the pathfinder's walk stopped (${r.stopped})` : `the pathfinder's walk did not get out${r.why ? ` (${r.why})` : ''}` };
}

/** Stage 2: steps by hand (nextStep), at most maxSteps, until out. */
async function byHand(bot, target, state, deadline, { moveTo, pillar, craft = null, say = () => {} }) {
    state.dugSet ??= new Set();
    const { maxSteps = ESCAPE.maxSteps, totalMs = ESCAPE.totalMs } = state.budget ?? {};
    // #624 review 5: stairs and pillars only go up: a target below the feet is no climb. On a tree (the ground under a
    // canopy): say so. #624 re-review nit 3 (soak 16 R): elsewhere (a pocket whose nearest open ground is downhill,
    // walled off) the climb goes up toward the sky instead of giving up.
    if (target && target.y < feetOf(bot).y) {
        if (treeLike(bot.blockAt(feetOf(bot).offset(0, -1, 0)))) return { why: `the ground is below you (open ground at ${at(target)}): climb down to it` };
        target = null;
    }
    for (let i = 0; i < maxSteps; i++) {
        if (isOut(bot, target, state.budget?.kind === 'day' || !!state.budget?.strict)) return { out: true };
        if (bot.interrupt_code) return { why: 'interrupted' };
        if (Date.now() >= deadline) return { why: `the ${totalMs / 1000} s ran out` };
        // Soak 17 E(4)(iii): at dusk or night, deep under the surface: no more climbing toward the dark (sealed below).
        const dusk = duskSealDue(bot, state);
        if (dusk && await sealForNight(bot, state, dusk, say)) return { why: `${dusk}: sealed in at ${at(feetOf(bot))} for the night`, dusk: true };
        state.wary = caveWary(bot); // soak 17 E(4)(ii)
        const step = nextStep(bot, target, state);
        if (step.why) return { why: step.why, cave: !!step.cave };
        const late = { why: `the ${totalMs / 1000} s ran out` };
        // Soak 17 E(2): a pickaxe at its keep is replaced before a pickaxe dig, when one can be made.
        if (step.dig.some(c => needsPickaxe(bot.blockAt(c)))) await remakeAtKeep(bot, state, { craft, say });
        for (const c of step.dig) {
            if (bot.interrupt_code) return { why: 'interrupted' };
            const dug = await digCell(bot, c, deadline);
            if (dug === 'time') return late;
            if (!dug) return { why: `could not dig ${bot.blockAt(c)?.name ?? 'the block'} at ${at(c)}` };
            state.dug++;
            state.dugSet.add(key(c));
        }
        if (Date.now() >= deadline) return late; // #562 review 3: and before the step
        if (step.kind === 'stair') {
            if (!await moveTo(bot, step.to, deadline)) return Date.now() >= deadline ? late : { why: `could not step up into ${at(step.to)}` };
            state.stairs++;
        } else if (step.kind === 'side') {
            if (!await moveTo(bot, step.to, deadline)) return Date.now() >= deadline ? late : { why: `could not step sideways into ${at(step.to)}` };
            state.sides = (state.sides ?? 0) + 1;
        } else {
            // Soak 17 E(3): the reason said, and one more try after the hands settle (18:03:58: a rejected click of the
            // pickaxe's swap came in the same second).
            const info = {};
            let up = await pillar(bot, buildStacks(bot)[0], deadline, info);
            if (!up && !state.pillarRetried && Date.now() < deadline && !bot.interrupt_code) {
                state.pillarRetried = true;
                say(`[escape] the pillar at ${at(feetOf(bot))} did not take (${info.why ?? 'no reason'}): once more`);
                await handsSettled(bot, 1000);
                info.why = null;
                up = await pillar(bot, buildStacks(bot)[0], deadline, info);
            }
            if (!up) return Date.now() >= deadline ? late : { why: `could not pillar up from ${at(feetOf(bot))}${info.why ? ` (${info.why})` : ''}` };
            state.placed++;
            state.pillars++;
        }
    }
    return isOut(bot, target, state.budget?.kind === 'day' || !!state.budget?.strict) ? { out: true } : { why: `${maxSteps} steps were not enough` };
}

/**
 * Get out of a pit or the water (the lead's escape plan). Returns {out, how: 'already'|'pathfinder'|
 * 'by hand'|null, dug, placed, stairs, pillars, at, why, interrupted, ms}. Never throws.
 * moveTo, pillar, say: the tests' own.
 */
export async function escape(bot, { moveTo = stepInto, pillar = pillarUp, say = (l) => console.log(l), target: given = null, budget = 'morning', craft = craftRecipe, hostiles = [], strict = false, seal = null } = {}) {
    const t0 = Date.now();
    const state = { dug: 0, placed: 0, stairs: 0, pillars: 0, crafted: 0, away: hostiles.map(h => h?.position ?? h).filter(Boolean) };
    if (seal) Object.defineProperty(state, 'seal', { value: seal, enumerable: false }); // the tests' own buildShelter
    let deadline = t0 + ESCAPE.totalMs;
    // Soak 16 (E3): an escape run inside another one (the respawn escape) gives the flag back as it found it.
    const wasEscaping = bot.rotnEscaping;
    const wasClimbing = bot.rotnClimbing; // soak 17 E(4)(i): a climb out (not the respawn escape's walk): no flee walk
    // #562 review 5: interrupted: stopped by something else (a reflex, a command), not a failure.
    const done = (out, how, why = null) => { const { budget: b, away: _away, dugSet: _dug, wary: _wary, cave: _cave, remakeSaid: _said, remakeHeld: _held, pillarRetried: _retried, duskTried: _dt, ...counts } = state; return { out, how, why, interrupted: !out && (why === 'interrupted' || !!bot.interrupt_code), ...counts, budget: b?.kind ?? null, at: feetOf(bot), ms: Date.now() - t0 }; };
    try {
        if (isOut(bot, null, budget === 'day' || strict)) return done(true, 'already');
        // Soak 16 (E): a target given (!goToSurface: the ground under the sky in the bot's column), else the nearest dry
        // cell under the sky, else up toward the sky.
        const target = given ?? (budget === 'day' || strict ? groundTarget(bot) : escapeTarget(bot)); // strict: never the start cell
        state.budget = budgetOf(bot, budget, target);
        // Soak 16 night 3: a strict out (open ground with a walkable way on) in any budget.
        if (strict) state.budget.strict = true;
        deadline = t0 + state.budget.totalMs;
        const from = feetOf(bot);
        say(`[escape] stuck at ${at(from)}${inWater(bot) ? ' in water' : ''}: getting out ${target ? `to ${at(target)} (dry ground under open sky)` : `upward (the sky starts at y ${skyY(bot)})`}`
            + (state.budget.kind === 'day' ? ` (up to ${state.budget.maxSteps} steps, ${state.budget.totalMs / 60_000} min)` : ''));
        bot.rotnEscaping = true;
        bot.rotnClimbing = true;
        // Soak 17 E(4)(iii): at dusk or night, deep under the surface: sealed in here for the night, no climb; #667 review 2:
        // only when a seal is possible, and a seal that does not close goes on climbing.
        const duskFirst = duskSealDue(bot, state);
        if (duskFirst && await sealForNight(bot, state, duskFirst, say)) return report(done(false, null, `${duskFirst}: sealed in at ${at(feetOf(bot))} for the night`), say);
        // Soak 16 (E, the lead's order): no dirt or planks to climb with, but dirt piles: dirt crafted from them first
        // (4 piles each), as many as the climb may need (the depth, at most pileCraftMax).
        if (state.budget.kind === 'day' && buildCount(bot, reserveOf(state)) < state.budget.maxSteps && placeableDirt(bot.inventory.items()) > countOf(softItems(bot))) {
            const want = Math.min(ESCAPE.pileCraftMax, state.budget.maxSteps - buildCount(bot, reserveOf(state)));
            const before = countOf(softItems(bot));
            await craftMore(bot, 'dirt', want, craft, { why: `Climbing out of here needs blocks to stand on` });
            state.crafted = Math.max(0, countOf(softItems(bot)) - before);
        }
        await remakeAtKeep(bot, state, { craft, say }); // soak 17 E(2): the pathfinder's walk digs too
        const first = await byPathfinder(bot, target, state, deadline, say);
        if (first.out) return report(done(true, 'pathfinder'), say);
        if (bot.interrupt_code) return report(done(false, null, 'interrupted'), say);
        say(`[escape] ${first.why}; digging out by hand`);
        const second = await byHand(bot, target, state, deadline, { moveTo, pillar, craft, say });
        if (second.out) return report(done(true, 'by hand'), say);
        if (second.dusk) return report(done(false, null, second.why), say);
        // Soak 16 trap (21:20), #642 review 6: the way out is blocked for want of a pickaxe (used up by the walk that dug
        // the bot in: every stone cell is undiggable): one is made from what the bot carries, then the climb again.
        // Only after the pathfinder and the climb said so, and never with hostiles near (the respawn escape: no craft
        // among player zombies).
        if (NO_PICKAXE.test(second.why ?? '') && !state.away.length && !bestPickaxe(bot) && !bot.interrupt_code && Date.now() < deadline) {
            const tableNear = (() => { try { return !!bot.findBlock?.({ matching: (b) => /crafting_table$/.test(b?.name ?? ''), maxDistance: ESCAPE.tableReach }); } catch { return false; } })();
            const r = await makePickaxe(bot, { craft, tableNear, say });
            state.pickaxe = r.made ? 'made' : r.why;
            say(r.made ? '[escape] no pickaxe: made a stone pickaxe; climbing again' : `[escape] no pickaxe, and none can be made here: ${r.why}`);
            if (!r.made) return report(done(false, null, `${second.why}; ${r.why}`), say);
            const third = await byHand(bot, target, state, deadline, { moveTo, pillar, craft, say });
            if (third.dusk) return report(done(false, null, third.why), say);
            return report(third.out ? done(true, 'by hand') : done(false, null, third.why), say);
        }
        return report(done(false, null, second.why), say);
    } catch (err) {
        return report(done(false, null, err?.message ?? String(err)), say);
    } finally {
        bot.rotnEscaping = wasEscaping === true;
        bot.rotnClimbing = wasClimbing === true;
        try { bot.clearControlStates?.(); } catch { /* best effort */ }
    }
}

/**
 * Soak 17 E(4)(iii) (the lead): sealed in for the night where the climb stopped: the night routine's shelter at the bot's
 * cells (buildShelter, as the hole shelter roofs a fresh hole: the flood check and the roof retry). #667 review 2: tried
 * only when a seal is possible (sealPossible: a site, nothing to dig unsafely, every cell with a face, the blocks carried
 * and a pickaxe or a side to dig out by hand), once an escape; a seal that does not close goes on climbing. Closed, the
 * night routine adopts the cell (bot.rotnSealedIn: night_routine.sealedShaftHere) and its morning climbs out. True when
 * sealed; state.dusk and state.sealed are in the result (escapeText says so).
 */
async function sealForNight(bot, state, why, say) {
    state.duskTried = true;
    const feet = feetOf(bot);
    const possible = sealPossible(bot, feet);
    if (!possible.ok) { say(`[escape] ${why} at ${at(feet)}, but no seal is possible here (${possible.why}): climbing on`); return false; }
    say(`[escape] ${why} at ${at(feet)}: sealing the shaft here for the night (the night routine keeps the shelter; the climb goes on in the morning)`);
    let r = null;
    try { r = await (state.seal ?? buildShelter)(bot, { site: feet, keepSoft: true, floodCheck: true, roofRetry: true }); } catch (err) { r = { closed: false, line: err?.message ?? String(err) }; }
    if (!r?.closed) { say(`[escape] the seal at ${at(feet)} did not close (${r?.line ?? 'no result'}): climbing on`); return false; }
    state.dusk = true;
    state.sealed = true;
    bot.rotnSealedIn = { pos: feet, at: Date.now() };
    return true;
}

/** #667 review 2: whether a dusk seal can be built at feet now (siteNeeds with buildShelter's own rules), and why not. */
export function sealPossible(bot, feet) {
    let need = null;
    try { need = siteNeeds(bot, feet, { accept: isWall, occupied: true }); } catch { need = null; }
    if (!need) return { ok: false, why: 'no shelter fits these cells' };
    if (need.unsafe) return { ok: false, why: need.unsafe };
    if (need.unsupported.length) return { ok: false, why: `nothing to place against at ${at(need.unsupported[0])}` };
    const blocks = countOf(shelterItems(bot)) + countOf(softItems(bot));
    if (blocks < need.blocks) return { ok: false, why: `it needs ${need.blocks} blocks and you carry ${blocks}` };
    if (!bestPickaxe(bot) && !need.handExit) return { ok: false, why: 'no pickaxe, and no side to dig out by hand' };
    // #667 round 2 (the lead's corrected decision (a)): only when the food covers the night (the night routine's own
    // calculation: food.nightFoodNeed against the held points); else the climb goes on, and the night routine shelters on
    // the surface with its normal food rules. #667 round 3 nit: nightFoodNeed counts a whole night, also when part of it
    // has passed (a seal late in the night): a safe upper bound, which may send a bot that would have lasted on climbing.
    const held = heldFoodPoints(bot);
    const needFood = nightFoodNeed({ food: bot.food, saturation: Number.isFinite(bot.foodSaturation) ? bot.foodSaturation : 0 });
    if (Number.isFinite(needFood) && held < needFood) return { ok: false, why: `the food held (${held} points) does not cover the night (about ${needFood} more than your bar)` };
    return { ok: true, blocks: need.blocks };
}

function report(r, say) {
    say(r.out ? `[escape] out at ${at(r.at)} (${r.how}; dug ${r.dug}, placed ${r.placed}) in ${(r.ms / 1000).toFixed(1)} s`
        : `[escape] still stuck at ${at(r.at)} after ${(r.ms / 1000).toFixed(1)} s (dug ${r.dug}, placed ${r.placed}): ${r.why}`);
    return r;
}

/**
 * Soak 16 (E): !goToSurface's target: the nearest open ground at the ground of a column within reach (groundTarget:
 * the bot's own column first when its ground is open, as over soak 15's pocket; the ground under a canopy, never the
 * leaves (soak 15: y 72 over the ground at 64); the rim of a shaft, never the shaft's own bottom, #624 review 1).
 * null: none in reach (the escape goes up toward the sky).
 */
export function surfaceTarget(bot) {
    return groundTarget(bot);
}

/**
 * Soak 16 (E4): what the model is told about an escape: where it got to, or that it is trapped, why, and one next
 * step that fits the why. Never "Going to the surface" after a failure (soak 15).
 */
export function escapeText(r) {
    if (!r) return 'The escape gave no result.';
    const secs = (r.ms / 1000).toFixed(0);
    if (r.out) return r.how === 'already' ? `You are already on open ground at ${at(r.at)}.`
        : `Reached open ground at ${at(r.at)} (${r.how === 'pathfinder' ? 'by the pathfinder' : 'by stairs and pillars dug by hand'}; dug ${r.dug}, placed ${r.placed}${r.crafted ? `, ${r.crafted} dirt crafted from piles` : ''}) in ${secs} s.`;
    if (r.interrupted) return `The way out from ${at(r.at)} was stopped by something else; !goToSurface goes on from here.`;
    // Soak 17 E(4)(iii): sealed in for the night, deep under the surface.
    if (r.dusk) return r.sealed
        ? `Night is near and you are deep under the surface: sealed in at ${at(r.at)} for the night (dug ${r.dug}, placed ${r.placed}). Stay here: the night routine keeps this shelter, and the climb out goes on in the morning.`
        : `Night is near and you are deep under the surface at ${at(r.at)}: the climb stopped, but the seal did not close (${String(r.why ?? '').replace(/^.*?: /, '')}). Close the open cells with !placeHere or the night routine's shelter; the climb out goes on in the morning.`;
    const why = String(r.why ?? 'no reason');
    const next = /needs a pickaxe \(you carry none\)/.test(why)
        ? `You have no pickaxe, and every stone here needs one: ${PICKAXE_RECIPE_TEXT}. Get those, then !craftRecipe("stone_pickaxe", 1) and !goToSurface.`
        : /needs a level \d+ pickaxe/.test(why)
        ? 'That block needs a better pickaxe: !goToSurface tries a step sideways first; if it stops again, dig around it.'
        : /the ground is below you/.test(why)
        // #624 re-review nit 2: the ground under a canopy (or downhill): down, not up.
        ? 'Climb down to it: !goToCoordinates to that spot (a walk down), or break the leaves under you with !digDown(1) one at a time while the drop below is short.'
        : /no block to pillar|blocks for pillars are spent|used the \d+ blocks/.test(why)
        ? 'Make dirt from dirt piles (4 piles each) or planks, then !goToSurface again (the cobblestone kept for the night\'s shelter is not used).'
        : /falling/.test(why)
        // Round 17 P (the lead): only real commands (no command digs one chosen block; !breakBlockAt is a skill).
        ? 'Get out from under the falling block first: !moveAway(3) walks about 3 blocks in any direction (digging if it must), then !goToSurface.'
        : /liquid|water|lava/.test(why)
        ? 'Dig away from the liquid, on the other side, then !goToSurface.'
        : /ran out|steps were not enough/.test(why)
        ? '!goToSurface goes on from here, a bit higher each time.'
        : /could not dig/.test(why)
        ? 'That block needs a better tool: !moveAway(3) walks about 3 blocks in any direction (digging if it must), then !goToSurface from there.'
        : '!goToSurface tries again from here.';
    return `You are trapped at ${at(r.at)}: no walkable way to open ground within ${ESCAPE.targetRadius} blocks. The escape stopped after ${secs} s (dug ${r.dug}, placed ${r.placed}): ${why}. ${next}`;
}

/**
 * Soak 16 (E3, E4): the post-condition of digging commands. When the command dug (bot.rotnDigs, counted by the
 * bot.dig wrapper, library/hands.js) and the bot is now trapped, the escape runs (the day budget). After a failed
 * escape, none again within ESCAPE_HOLD.ms within ESCAPE_HOLD.cells of that place (only the line; !goToSurface always
 * runs); 3 failures there within ESCAPE_HOLD.windowMs: the line also says to stop digging there. Returns the line for
 * the model, or null (nothing to do). minDepth: the depth below `from` the bot must be at (!digDown: deeper than 2).
 */
export const ESCAPE_HOLD = { ms: 2 * 60_000, cells: 3, windowMs: 10 * 60_000, fails: 3 };
export async function escapeIfTrapped(bot, { digsBefore = 0, from = null, minDepth = 0, run = escape, now = Date.now } = {}) {
    if ((bot?.rotnDigs?.count ?? 0) <= digsBefore || bot.interrupt_code) return null;
    if (from && minDepth > 0 && from.y - feetOf(bot).y < minDepth) return null;
    const trap = isTrapped(bot);
    if (!trap.trapped) { bot.rotnTrapped = null; return null; }
    const here = feetOf(bot);
    const fails = (bot.rotnEscapeFails ?? []).filter(f => now() - f.t < ESCAPE_HOLD.windowMs && f.at.distanceTo(here) <= ESCAPE_HOLD.cells);
    const last = fails.at(-1);
    bot.rotnTrapped = { at: here, since: bot.rotnTrapped?.since ?? now() };
    const stop = fails.length >= ESCAPE_HOLD.fails ? ` The escape failed ${fails.length} times here in ${ESCAPE_HOLD.windowMs / 60_000} min: stop digging here.` : '';
    if (last && now() - last.t < ESCAPE_HOLD.ms)
        return `You are trapped at ${at(here)}: no walkable way to open ground within ${ESCAPE.targetRadius} blocks. The escape here failed ${Math.round((now() - last.t) / 1000)} s ago (${last.why}); it is not tried again on its own for ${ESCAPE_HOLD.ms / 60_000} min: !goToSurface tries from here.${stop}`;
    console.log(`[escape] trapped at ${at(here)} after digging (${trap.nodes} cells searched, no walkable way to the sky): getting out first`);
    const r = await run(bot, { budget: 'day', target: surfaceTarget(bot) });
    if (r?.out) { bot.rotnTrapped = null; return escapeText(r); }
    if (!r?.interrupted) bot.rotnEscapeFails = [...(bot.rotnEscapeFails ?? []).filter(f => now() - f.t < ESCAPE_HOLD.windowMs), { at: r?.at ?? here, t: now(), why: r?.why ?? 'no result' }].slice(-8);
    const n = fails.length + (r?.interrupted ? 0 : 1);
    return escapeText(r) + (n >= ESCAPE_HOLD.fails ? ` The escape failed ${n} times here in ${ESCAPE_HOLD.windowMs / 60_000} min: stop digging here.` : '');
}

/**
 * Soak 16 (E4): where the bot is still trapped, for the agenda's prompt ("!goToSurface first"), or null. Set by a
 * failed escape (escapeIfTrapped, goToSurface); re-checked (isTrapped) at most every TRAPPED_CHECK_MS and cleared once
 * the bot is out.
 */
export const TRAPPED_CHECK_MS = 5000;
export function stillTrapped(bot, now = Date.now()) {
    const t = bot?.rotnTrapped;
    if (!t) return null;
    if (now - (t.checkedAt ?? 0) >= TRAPPED_CHECK_MS) {
        let r = null;
        try { r = isTrapped(bot); } catch { r = null; }
        if (!r?.trapped) { bot.rotnTrapped = null; return null; }
        t.at = feetOf(bot);
        t.checkedAt = now;
    }
    return t.at;
}

/**
 * Soak 16 (R, the lead): a block the bot may mine for an item (rocks from stone): exposed (a face touching air or
 * a free cell) and, once broken, a walkable way (no digging) from its cell to open ground within targetRadius
 * (openGround, as isTrapped). Soak 15: the collect took the nearest stone in 3-D, under the bot, block after
 * block, 9 down. A block over open air drops the bot onto the first floor below (at most 3).
 */
// An unloaded neighbour (null) is not known to be enclosed (as walkable_exit): exposed, with a way out.
const unknownAround = (bot, c) => SIX.some(d => bot.blockAt(c.plus(d)) == null);
// #630 review 1: mineflayer's findBlocks first runs the matcher on each section's palette, on blocks with no position:
// that pre-check must say yes (else every section is skipped); the real check runs on each positioned block.
export function exposedBlock(bot, block) {
    const c = block?.position;
    if (!c) return true;
    // #630 re-review 1: the state-id fast path (no Block objects: the section scan calls this for every stone in
    // range): a neighbour that is air (state 0) or unloaded (undefined) exposes it. One pass over the six sides.
    const sid = bot.world?.getBlockStateId;
    if (typeof sid === 'function') {
        for (const d of SIX) {
            const id = sid.call(bot.world, c.plus(d));
            if (id === undefined || id === 0) return true;
        }
        return false;
    }
    return unknownAround(bot, c) || SIX.some(d => passCell(bot.blockAt(c.plus(d))));
}
/** #630 review 5: one column memo for a whole pick (its base the bot's feet), shared by keepsWayOut's searches. */
export function topMemo(bot) {
    const top = new Map();
    top.base = feetOf(bot).y;
    return top;
}
export function keepsWayOut(bot, block, top = null) {
    const c = block?.position;
    if (!c || typeof bot?.blockAt !== 'function' || unknownAround(bot, c)) return true;
    let from = c.clone ? c.clone() : new Vec3(c.x, c.y, c.z);
    for (let k = 0; k < 3 && !solid(bot.blockAt(from.offset(0, -1, 0))); k++) {
        // #630 review 4: never a drop through a liquid or onto a block that hurts (lava, a cactus, fire).
        const below = bot.blockAt(from.offset(0, -1, 0));
        if (isLiquid(below) || hurtsOnContact(below)) return false;
        from = from.offset(0, -1, 0);
    }
    if (!solid(bot.blockAt(from.offset(0, -1, 0))) && !from.equals(c)) return false; // a drop of more than 3
    // #630 re-review 4: the shared memo scans its columns from its base (the bot's feet) down to base - 12 only: for a
    // candidate farther below, its own memo.
    if (!top || c.y < top.base - 8) { top = new Map(); top.base = c.y; }
    const free = new Set([key(c)]);
    return !!walkableExit(bot, from, { maxNodes: WALK_EXIT.maxNodes, radius: ESCAPE.targetRadius, free,
        until: (n) => !n.equals(c) && openGround(bot, n, top) });
}
