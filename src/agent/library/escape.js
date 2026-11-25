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
import { isEmpty, isLiquid, isFalling, hurtsOnContact, shelterItems, softItems, countOf, craftMore } from './shelter.js';
import { placeableDirt } from './night.js';
import { burrowDiggable, digEquip } from './burrow.js';
import { digWithin } from './pit.js';
import { goodFloor, inWater, boundedWalk } from './shelter_ground.js';
import { fallSafe, isTreePart } from './fall_safety.js';
import { walkableExit, WALK_EXIT } from './walk_exit.js';
import { planPath, placeBlock, log, craftRecipe } from './skills.js';
import { findItem, inventoryKey } from './rotn_names.js';
import { dumpState } from './night.js';

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
    reserve: 14, pileCraftMax: 16 };

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
    // #624 nit (the respawn escape at night): with hostiles given, the side away from them first.
    const near = (d) => (state.away?.length ? -Math.min(...state.away.map(h => Math.hypot(p.x + d.x + 0.5 - h.x, p.z + d.z + 0.5 - h.z))) : 0);
    const stairs = [];
    for (const d of [...HORIZONTAL].sort((a, b) => (state.away?.length ? (near(a) - near(b)) || (toward(a) - toward(b)) : toward(a) - toward(b)))) {
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
    const maxPlaced = state.budget?.maxPlaced ?? ESCAPE.maxPlaced;
    if (state.placed >= maxPlaced) return { why: `no stair step, and the ${maxPlaced} blocks for pillars are spent` };
    const reserve = reserveOf(state);
    if (buildCount(bot, reserve) < 1) return { why: `no stair step, and no block to pillar up with${reserve > 0 && countOf(shelterItems(bot)) > 0 ? ` (the ${Math.min(countOf(shelterItems(bot)), reserve)} sturdy blocks kept for the night's shelter are not used)` : ''}` };
    const ours = new Set([key(p), key(p.offset(0, 1, 0)), key(head2)]);
    if (!safeToDig(bot, head2, ours) || !safeToDig(bot, head2.offset(0, 1, 0), new Set([...ours, key(head2.offset(0, 1, 0))])))
        return { why: `no stair step, and no room to pillar up above ${at(p)}${fallingNear(bot, p)}` };
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
    const r = await digWithin(bot, block, left, equip ? { equip } : {}); // soak 14 (F2): the budget after the equip, within left
    if (r === 'timeout' && Date.now() >= deadline) return 'time';
    return r === true && isEmpty(bot.blockAt(c));
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
export async function pillarUp(bot, item, deadline = Infinity) {
    const p = feetOf(bot);
    const floor = bot.blockAt(p.offset(0, -1, 0));
    if (!item || !solid(floor)) return false;
    try {
        await bot.equip(item, 'hand');
        await bot.look(bot.entity.yaw ?? 0, -Math.PI / 2, true);
        bot.setControlState('jump', true);
        const jump = within(ESCAPE.jumpMs, deadline);
        for (let waited = 0; bot.entity.position.y < p.y + 1 && waited < jump; waited += 25) await sleep(25);
        // #562 review 7: a jump that did not get the feet out of the cell: no block into the bot's own cell.
        if (bot.entity.position.y < p.y + 1) return false;
        const left = within(ESCAPE.jumpMs, deadline);
        if (left <= 0) return false;
        try { await orTime(Promise.resolve(bot.placeBlock(floor, UP)), left); } catch { /* checked below: the server may confirm late */ }
    } finally {
        bot.setControlState('jump', false);
    }
    const land = within(ESCAPE.landMs, deadline);
    for (let waited = 0; feetOf(bot).y !== p.y + 1 && waited < land; waited += 50) await sleep(50);
    return solid(bot.blockAt(p)) && feetOf(bot).y === p.y + 1;
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
    const floor = bot.blockAt(p.offset(0, -1, 0));
    const head2 = bot.blockAt(p.offset(0, 2, 0));
    if (!solid(floor)) {
        log(bot, `Cannot place ${type} where you stand at ${at(p)}: you are in that cell, and there is nothing solid under your feet to jump off and put it on.`);
        return false;
    }
    if (!isEmpty(head2) && !isLiquid(head2)) {
        log(bot, `Cannot place ${type} where you stand at ${at(p)}: you are in that cell, and the ${head2?.name ?? 'block'} above your head leaves no room to jump and put it under you.`);
        return false;
    }
    if (await pillar(bot, item)) {
        log(bot, `Placed ${type} at ${at(p)} by jumping and putting it under you: you now stand on it at ${at(feetOf(bot))}.`);
        return true;
    }
    log(bot, `Could not place ${type} at ${at(p)}: you are in that cell, and the jump-and-place did not take (still at ${at(feetOf(bot))}).`);
    return false;
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
    return isOut(bot, target, state.budget?.kind === 'day') ? { out: true } : { why: r.stopped === 'blocks' ? `the pathfinder used the ${state.budget?.maxPlaced ?? ESCAPE.maxPlaced} blocks` : r.stopped ? `the pathfinder's walk stopped (${r.stopped})` : `the pathfinder's walk did not get out${r.why ? ` (${r.why})` : ''}` };
}

/** Stage 2: steps by hand (nextStep), at most maxSteps, until out. */
async function byHand(bot, target, state, deadline, { moveTo, pillar }) {
    const { maxSteps = ESCAPE.maxSteps, totalMs = ESCAPE.totalMs } = state.budget ?? {};
    // #624 review 5: stairs and pillars only go up: a target below the feet (the ground under a canopy) is no climb.
    if (target && target.y < feetOf(bot).y) return { why: `the ground is below you (open ground at ${at(target)}): climb down to it` };
    for (let i = 0; i < maxSteps; i++) {
        if (isOut(bot, target, state.budget?.kind === 'day')) return { out: true };
        if (bot.interrupt_code) return { why: 'interrupted' };
        if (Date.now() >= deadline) return { why: `the ${totalMs / 1000} s ran out` };
        const step = nextStep(bot, target, state);
        if (step.why) return { why: step.why };
        const late = { why: `the ${totalMs / 1000} s ran out` };
        for (const c of step.dig) {
            if (bot.interrupt_code) return { why: 'interrupted' };
            const dug = await digCell(bot, c, deadline);
            if (dug === 'time') return late;
            if (!dug) return { why: `could not dig ${bot.blockAt(c)?.name ?? 'the block'} at ${at(c)}` };
            state.dug++;
        }
        if (Date.now() >= deadline) return late; // #562 review 3: and before the step
        if (step.kind === 'stair') {
            if (!await moveTo(bot, step.to, deadline)) return Date.now() >= deadline ? late : { why: `could not step up into ${at(step.to)}` };
            state.stairs++;
        } else {
            const item = buildStacks(bot)[0];
            if (!await pillar(bot, item, deadline)) return Date.now() >= deadline ? late : { why: `could not pillar up from ${at(feetOf(bot))}` };
            state.placed++;
            state.pillars++;
        }
    }
    return isOut(bot, target, state.budget?.kind === 'day') ? { out: true } : { why: `${maxSteps} steps were not enough` };
}

/**
 * Get out of a pit or the water (the lead's escape plan). Returns {out, how: 'already'|'pathfinder'|
 * 'by hand'|null, dug, placed, stairs, pillars, at, why, interrupted, ms}. Never throws.
 * moveTo, pillar, say: the tests' own.
 */
export async function escape(bot, { moveTo = stepInto, pillar = pillarUp, say = (l) => console.log(l), target: given = null, budget = 'morning', craft = craftRecipe, hostiles = [] } = {}) {
    const t0 = Date.now();
    const state = { dug: 0, placed: 0, stairs: 0, pillars: 0, crafted: 0, away: hostiles.map(h => h?.position ?? h).filter(Boolean) };
    let deadline = t0 + ESCAPE.totalMs;
    // Soak 16 (E3): an escape run inside another one (the respawn escape) gives the flag back as it found it.
    const wasEscaping = bot.rotnEscaping;
    // #562 review 5: interrupted: stopped by something else (a reflex, a command), not a failure.
    const done = (out, how, why = null) => { const { budget: b, away: _away, ...counts } = state; return { out, how, why, interrupted: !out && (why === 'interrupted' || !!bot.interrupt_code), ...counts, budget: b?.kind ?? null, at: feetOf(bot), ms: Date.now() - t0 }; };
    try {
        if (isOut(bot, null, budget === 'day')) return done(true, 'already');
        // Soak 16 (E): a target given (!goToSurface: the ground under the sky in the bot's column), else the nearest dry
        // cell under the sky, else up toward the sky.
        const target = given ?? (budget === 'day' ? groundTarget(bot) : escapeTarget(bot));
        state.budget = budgetOf(bot, budget, target);
        deadline = t0 + state.budget.totalMs;
        const from = feetOf(bot);
        say(`[escape] stuck at ${at(from)}${inWater(bot) ? ' in water' : ''}: getting out ${target ? `to ${at(target)} (dry ground under open sky)` : `upward (the sky starts at y ${skyY(bot)})`}`
            + (state.budget.kind === 'day' ? ` (up to ${state.budget.maxSteps} steps, ${state.budget.totalMs / 60_000} min)` : ''));
        bot.rotnEscaping = true;
        // Soak 16 (E, the lead's order): no dirt or planks to climb with, but dirt piles: dirt crafted from them first
        // (4 piles each), as many as the climb may need (the depth, at most pileCraftMax).
        if (state.budget.kind === 'day' && buildCount(bot, reserveOf(state)) < state.budget.maxSteps && placeableDirt(bot.inventory.items()) > countOf(softItems(bot))) {
            const want = Math.min(ESCAPE.pileCraftMax, state.budget.maxSteps - buildCount(bot, reserveOf(state)));
            const before = countOf(softItems(bot));
            await craftMore(bot, 'dirt', want, craft, { why: `Climbing out of here needs blocks to stand on` });
            state.crafted = Math.max(0, countOf(softItems(bot)) - before);
        }
        const first = await byPathfinder(bot, target, state, deadline, say);
        if (first.out) return report(done(true, 'pathfinder'), say);
        if (bot.interrupt_code) return report(done(false, null, 'interrupted'), say);
        say(`[escape] ${first.why}; digging out by hand`);
        const second = await byHand(bot, target, state, deadline, { moveTo, pillar });
        return report(second.out ? done(true, 'by hand') : done(false, null, second.why), say);
    } catch (err) {
        return report(done(false, null, err?.message ?? String(err)), say);
    } finally {
        bot.rotnEscaping = wasEscaping === true;
        try { bot.clearControlStates?.(); } catch { /* best effort */ }
    }
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
    const why = String(r.why ?? 'no reason');
    const next = /no block to pillar|blocks for pillars are spent|used the \d+ blocks/.test(why)
        ? 'Make dirt from dirt piles (4 piles each) or planks, then !goToSurface again (the cobblestone kept for the night\'s shelter is not used).'
        : /falling/.test(why)
        ? 'Start sideways, away from the falling block: !breakBlockAt the block beside you on another side, step into it, then !goToSurface.'
        : /liquid|water|lava/.test(why)
        ? 'Dig away from the liquid, on the other side, then !goToSurface.'
        : /ran out|steps were not enough/.test(why)
        ? '!goToSurface goes on from here, a bit higher each time.'
        : /could not dig/.test(why)
        ? 'That block needs a better tool: dig another side with !breakBlockAt, then !goToSurface.'
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
