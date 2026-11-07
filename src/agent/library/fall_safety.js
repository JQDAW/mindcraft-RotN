// Fall safety (G3 round 4 batch B: "FRCFLD fell from a high place" about a minute and a half into
// !collectBlocks("stick", 4) on leaves, 3 s after the unstuck reflex took over).
//
// What made a deadly height possible:
// - Leaves were collected with bot.collectBlock.collect, whose pathfinder may dig, tower, parkour and
//   walk on top of leaves, so the nearest leaves (often in the canopy) pulled the bot up into the tree.
// - Every walk could dig a Dynamic Trees branch, and a broken branch fells the whole tree as one
//   entity, including the part the bot stands on (also the stuck reflex's "destructive" walk).
// - pickupNearbyItems set no-dig movements, but goToGoal replaced them with its own, which dig: a
//   drop resting on leaves sent the bot up after it.
// - The bot's registry gives every modded block a full-cube collision box (no dump properties in
//   initBot), so a thin branch looks like solid footing to the pathfinder and the bot's physics.
//
// The rules here: no walk drops more than MAX_SAFE_DROP blocks; no walk breaks a branch; a walk to
// leaves never digs, towers or jumps gaps, and never stands on a tree; only leaves reachable from
// the ground are broken; a bot that is on a tree climbs down first (skills.descendFromTree).
import { Vec3 } from 'vec3';
import { isBranch, isTrunkShell } from './felling.js';
import { stateHazard, hazardBlockIds } from '../../../packages/forge-bridge/src/collision.js';

/** The highest drop a walk may take: a fall of 3 blocks does no damage (fall damage is height - 3). */
export const MAX_SAFE_DROP = 3;
/**
 * mineflayer-pathfinder 2.4.5's maxDropDown for that (#256 review 3): getLandingBlock looks for the
 * landing block from the feet down and accepts it while node.y - landing.y <= maxDropDown; the bot
 * then stands on top of it, so the fall is (node.y - landing.y) - 1. maxDropDown 4 = falls of 3.
 */
export const PATHFINDER_MAX_DROP_DOWN = MAX_SAFE_DROP + 1;
/** Leaves are broken only from the ground: at most this many blocks between the ground and the leaf. */
export const LEAF_ABOVE_GROUND = 3;
// An exclusion cost the pathfinder treats as "never" (it drops moves costing over 100).
const NEVER = 1000;

/** Any leaves block: vanilla leaves, leaves2, Dynamic Trees leaves, other mods' leaves. */
export const isLeafBlock = (b) => !!b && typeof b.name === 'string' && /leaves/.test(b.name);
/** A part of a tree that can vanish under the bot: leaves, a branch (which fells the tree) or a thick trunk's shell. */
export const isTreePart = (b) => isBranch(b) || isTrunkShell(b) || isLeafBlock(b);

const offset = (pos, dy) => (pos?.offset ? pos.offset(0, dy, 0) : new Vec3(pos.x, pos.y + dy, pos.z));
const blockAt = (bot, pos) => { try { return bot.blockAt(pos) ?? null; } catch { return null; } };
// ---- Liquids and hazards (net-forge #259; lead, before G3 smoke round 5) ----
// mineflayer's physics and the pathfinder know water and lava by name only. A modded fluid (molten
// metal, poison, acid, tar, honey, milk: 162 on 3.3.4) is a solid full cube in bot.registry with
// `liquid: true` (forge-bridge applyCollisionShapes), and traps, fires, portals and webs carry
// `forge.hazard`, per state where a block mixes them (biomesoplenty:plant_0: poison ivy is a trap,
// short grass is not). So the guard lives here.
const VANILLA_LIQUID = /^(minecraft:)?(flowing_)?(water|lava)$/;
const VANILLA_LAVA = /^(minecraft:)?(flowing_)?lava$/;

/** Any liquid: vanilla water and lava by name, a modded fluid by the registry's liquid flag. */
export function isLiquid(bot, b) {
    if (!b) return false;
    if (VANILLA_LIQUID.test(b.name ?? '')) return true;
    return bot?.registry?.blocks?.[b.type]?.liquid === true;
}

/**
 * The hazard of this block state ('trap', 'fire', 'portal', 'web', 'lava'), or null: vanilla lava
 * and fire by name, a modded block per state (forge-bridge stateHazard; never by block id alone).
 */
export function hazardOf(bot, b) {
    if (!b) return null;
    if (VANILLA_LAVA.test(b.name ?? '')) return 'lava';
    if (b.name === 'fire' || b.name === 'minecraft:fire') return 'fire';
    try { return stateHazard(bot?.registry, b); } catch { return null; }
}

/** Deadly to stand in: lava, and the pack's molten metals (forge.hazard 'lava'). */
export const isLethal = (bot, b) => hazardOf(bot, b) === 'lava';

/** A liquid or a hazard: never ground, never empty (vanilla water included: not firm ground). */
export const isUnsafeBlock = (bot, b) => isLiquid(bot, b) || hazardOf(bot, b) !== null;

const VANILLA_WATER = /^(minecraft:)?(flowing_)?water$/;
/** A modded fluid (the registry's liquid flag); vanilla water and lava are known by name. */
const isModdedLiquid = (bot, b) => !!b && !VANILLA_LIQUID.test(b.name ?? '') && bot?.registry?.blocks?.[b.type]?.liquid === true;
/**
 * What a walk must keep out of: a liquid or a hazard, but not vanilla water, which the pathfinder
 * handles itself (wading, swimming, landing in it; #264 review 1: refusing it left a bot in a lake
 * with no way out).
 */
export const isWalkHazard = (bot, b) => !!b && !VANILLA_WATER.test(b.name ?? '') && isUnsafeBlock(bot, b);

// A liquid or a hazard is not empty (#256 nit, #259): a leaf over water is not reachable from the
// ground, an item on molten metal is not on the ground. isFirmGround rejects them.
const isEmpty = (bot, b) => !b || b.name === 'air' || (b.boundingBox === 'empty' && !isUnsafeBlock(bot, b));

/** Firm ground to stand on: a solid block, not part of a tree, not a liquid, not a hazard. */
export function isFirmGround(bot, b) {
    return !!b && b.boundingBox === 'block' && !isTreePart(b) && !isUnsafeBlock(bot, b);
}

/**
 * The first block below pos (exclusive) that is not empty, within maxDepth blocks:
 * { block, depth } (depth 1 = right below), or null when there is only air that far down.
 */
export function firstBelow(bot, pos, maxDepth) {
    for (let d = 1; d <= maxDepth; d++) {
        const b = blockAt(bot, offset(pos, -d));
        if (!isEmpty(bot, b)) return { block: b, depth: d };
    }
    return null;
}

/** The bot stands on leaves or a branch (its feet are above a tree part). */
export function standsOnTree(bot) {
    const feet = bot?.entity?.position;
    if (!feet) return false;
    const below = blockAt(bot, offset(feet.floored ? feet.floored() : feet, -1));
    return isTreePart(below);
}

/**
 * A leaves block the bot can break while standing on the ground beside it: straight below it, the
 * first block that is not air is firm ground, with at most LEAF_ABOVE_GROUND blocks of air between.
 * Leaves above other leaves, or high in the canopy, are not: the bot would have to climb.
 */
export function leafFromGround(bot, block) {
    if (!block?.position) return true; // findBlocks' section scan: decided again with the position
    const below = firstBelow(bot, block.position, LEAF_ABOVE_GROUND + 1);
    return !!below && isFirmGround(bot, below.block);
}

/**
 * An item lying where the bot can walk to it on the ground: what is right under it is firm ground
 * (an item on leaves or a branch would pull the bot up into the tree).
 */
export function itemOnGround(bot, entity) {
    const p = entity?.position;
    if (!p) return false;
    // An item rests on the block top, a little above it: the block below its floored position.
    const cell = new Vec3(Math.floor(p.x), Math.floor(p.y + 0.01), Math.floor(p.z));
    const below = firstBelow(bot, cell, MAX_SAFE_DROP);
    return !!below && isFirmGround(bot, below.block);
}

/**
 * Every walk: never a drop over MAX_SAFE_DROP, never a broken branch (it fells the tree, maybe the
 * one the bot stands in). Changes the movements in place, once; returns them.
 */
export function fallSafe(movements) {
    if (!movements || movements.rotnFallSafe) return movements;
    movements.maxDropDown = PATHFINDER_MAX_DROP_DOWN;
    movements.exclusionAreasBreak.push((b) => (isBranch(b) || isTrunkShell(b) ? NEVER : 0));
    liquidAndHazardSafe(movements);
    movements.rotnFallSafe = true;
    return movements;
}

/**
 * Every walk keeps out of liquids and hazards (#259; lead, before smoke round 5). Changes the
 * movements in place:
 * - blocksToAvoid gets the blocks that are a hazard in every state; a block with hazardByMeta
 *   (BOP plant_0: poison ivy, short grass) is not added, or the bot would avoid all short grass;
 * - an exclusion check per state (stateHazard): never step into a hazard state, nor onto a cell
 *   above a liquid or a hazard; never dig either;
 * - the pathfinder's view of a modded liquid or a hazard state is made unsafe and not solid, as it
 *   treats vanilla lava: it never stands, lands or drops onto one (getLandingBlock and the forward
 *   move check no exclusion for the floor or the landing cell, so this is what stops them).
 * Vanilla water stays as the pathfinder treats it (it may swim and land in it); vanilla lava and
 * fire are in its own blocksToAvoid already.
 */
function liquidAndHazardSafe(movements) {
    const bot = movements.bot;
    if (!bot) return;
    const registry = bot.registry;
    for (const id of hazardBlockIds(registry)) {
        if (!registry?.blocks?.[id]?.forge?.hazardByMeta) movements.blocksToAvoid.add(id);
    }
    const near = (b, dx, dy, dz) => (b?.position ? blockAt(bot, b.position.offset(dx, dy, dz)) : null);
    // Not into a hazard state, nor onto a cell above a liquid or a hazard. The check runs on head
    // cells too (below them: the feet cell), so vanilla water is left out (#264 review 1).
    // Note (#264 review nit): a non-empty exclusionAreasStep turns off the pathfinder's path
    // shortcuts (mineflayer-pathfinder index.js), for every walk; accepted.
    movements.exclusionAreasStep.push((b) => (hazardOf(bot, b) || isWalkHazard(bot, near(b, 0, -1, 0)) ? NEVER : 0));
    // Never dig a liquid or a hazard, nor a block next to a modded fluid (#264 review 2): it would
    // flow out. safeToBreak's own check (dontCreateFlow) reads .liquid, and mineflayer-collectblock
    // turns dontCreateFlow off, so the neighbours are checked here whatever that setting is.
    movements.exclusionAreasBreak.push((b) => (isWalkHazard(bot, b)
        || [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => isModdedLiquid(bot, near(b, dx, dy, dz))) ? NEVER : 0));
    const getBlock = movements.getBlock.bind(movements);
    movements.getBlock = (pos, dx, dy, dz) => {
        const b = getBlock(pos, dx, dy, dz);
        // Everything a walk keeps out of is lava to the pathfinder: unsafe, not solid; a modded
        // fluid is also a liquid, so dontCreateFlow sees it (#264 review 2). Vanilla water keeps
        // the pathfinder's own handling.
        if (b && b.type !== undefined && isWalkHazard(bot, b)) {
            b.safe = false;
            b.physical = false;
            b.replaceable = false;
            if (isModdedLiquid(bot, b)) b.liquid = true;
        }
        return b;
    };
}

/**
 * Make every walk the bot takes fall-safe and liquid- and hazard-safe: whoever sets the
 * pathfinder's movements (our skills, mineflayer-collectblock, mineflayer-pvp, upstream code) gets
 * them through fallSafe. Call once the pathfinder plugin is loaded (after spawn); idempotent.
 */
export function installWalkSafety(bot) {
    const pf = bot?.pathfinder;
    if (!pf || typeof pf.setMovements !== 'function' || pf.rotnWalkSafety) return false;
    const set = pf.setMovements.bind(pf);
    pf.setMovements = (movements) => set(fallSafe(movements));
    if (pf.movements) fallSafe(pf.movements);
    pf.rotnWalkSafety = true;
    return true;
}

/**
 * A walk to leaves: fallSafe, and no digging, no 1x1 tower, no scaffolding, no parkour, and never a
 * step onto a place above leaves or a branch, so the bot stays on the ground.
 */
export function treeSafe(bot, movements) {
    fallSafe(movements);
    movements.canDig = false;
    movements.allow1by1towers = false;
    movements.allowParkour = false;
    movements.scafoldingBlocks = [];
    movements.exclusionAreasStep.push((b) => (b?.position && isTreePart(blockAt(bot, offset(b.position, -1))) ? NEVER : 0));
    return movements;
}
