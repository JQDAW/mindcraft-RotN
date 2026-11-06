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
import { isBranch } from './felling.js';

/** The highest drop a walk may take: a fall of 3 blocks does no damage (fall damage is height - 3). */
export const MAX_SAFE_DROP = 3;
/** Leaves are broken only from the ground: at most this many blocks between the ground and the leaf. */
export const LEAF_ABOVE_GROUND = 3;
// An exclusion cost the pathfinder treats as "never" (it drops moves costing over 100).
const NEVER = 1000;

/** Any leaves block: vanilla leaves, leaves2, Dynamic Trees leaves, other mods' leaves. */
export const isLeafBlock = (b) => !!b && typeof b.name === 'string' && /leaves/.test(b.name);
/** A part of a tree that can vanish under the bot: leaves, or a branch (which fells the tree). */
export const isTreePart = (b) => isBranch(b) || isLeafBlock(b);

const offset = (pos, dy) => (pos?.offset ? pos.offset(0, dy, 0) : new Vec3(pos.x, pos.y + dy, pos.z));
const blockAt = (bot, pos) => { try { return bot.blockAt(pos) ?? null; } catch { return null; } };
const isEmpty = (b) => !b || b.boundingBox === 'empty' || b.name === 'air';

/** Firm ground to stand on: a solid block that is not part of a tree and not a liquid. */
export function isGround(b) {
    return !!b && b.boundingBox === 'block' && !isTreePart(b) && !/water|lava/.test(b.name ?? '');
}

/**
 * The first block below pos (exclusive) that is not empty, within maxDepth blocks:
 * { block, depth } (depth 1 = right below), or null when there is only air that far down.
 */
export function firstBelow(bot, pos, maxDepth) {
    for (let d = 1; d <= maxDepth; d++) {
        const b = blockAt(bot, offset(pos, -d));
        if (!isEmpty(b)) return { block: b, depth: d };
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
    return !!below && isGround(below.block);
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
    return !!below && isGround(below.block);
}

/**
 * Every walk: never a drop over MAX_SAFE_DROP, never a broken branch (it fells the tree, maybe the
 * one the bot stands in). Changes the movements in place, once; returns them.
 */
export function fallSafe(movements) {
    if (!movements || movements.rotnFallSafe) return movements;
    movements.maxDropDown = MAX_SAFE_DROP;
    movements.exclusionAreasBreak.push((b) => (isBranch(b) ? NEVER : 0));
    movements.rotnFallSafe = true;
    return movements;
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
