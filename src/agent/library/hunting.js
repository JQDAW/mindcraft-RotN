// G4 #5 (CX23 soak m1: food fell to 1, nothing got food): the bot may hunt for food, but on the live
// server never an animal that may belong to a player (lead's hard rule). An animal is left alone
// when it has a custom name, is tamed or has an owner (an owner UUID in its metadata), is leashed
// (mineflayer sets entity.vehicle from 1.12's attach_entity, the leash holder), is within
// HUNT.ownedRadius of player-built blocks (fences, fence gates, walls, beds, chests, crafting tables,
// torches) the bot did not place itself, or within HUNT.baseRadius of a known player base.

import * as mc from '../../utils/mcdata.js';

export const HUNT = { radius: 16, ownedRadius: 8, baseRadius: 32, placedMax: 512 };

/**
 * Animals the bot may hunt: vanilla's huntable adults (mcdata.isHuntable: chicken, cow, llama,
 * mooshroom, pig, rabbit, sheep), and Animania's adult females, which this pack spawns instead
 * (rotn-data common-mobs: cow_*, sow_*, ewe_*, doe_*, hen_*). Animania names its young apart
 * (calf_, piglet_, lamb_, kit_, kid_, chick_), and its males (bull_, hog_, ram_, buck_, rooster_)
 * are left alone: some charge when hit.
 */
const ANIMANIA_FOOD = /^animania:(cow|sow|ewe|doe|hen)_[a-z_]+$/;
export const isHuntableAnimal = (e) => !!e?.name && (mc.isHuntable(e) || ANIMANIA_FOOD.test(e.name));

/** Blocks a player builds: fences, fence gates, walls, beds, chests, crafting tables, torches (any mod's). */
export const PLAYER_BUILT = /(^|:)([a-z_]*_)?(fence|fence_gate|wall|bed|chest|crafting_table|torch)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (p) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;

/** The text of a 1.12 custom name (metadata index 2: a string, or a chat component), or ''. */
function customName(e) {
    const v = e?.metadata?.[2];
    if (typeof v === 'string') return v.trim();
    if (v && typeof v === 'object') return String(v.text ?? v.toString?.() ?? '').trim();
    return '';
}

/** An owner UUID anywhere in the metadata (EntityTameable's and AbstractHorse's Optional<UUID>). */
function ownerOf(e) {
    for (const v of Object.values(e?.metadata ?? {})) {
        if (typeof v === 'string' && UUID.test(v)) return v;
        if (v && typeof v === 'object' && typeof v.uuid === 'string' && UUID.test(v.uuid)) return v.uuid;
    }
    return null;
}

/** A horse-like animal (a llama) with its tame bit (1.12 AbstractHorse flags, index 13, bit 0x02). */
const tamedHorse = (e) => /llama|horse|donkey|mule/.test(e?.name ?? '') && Number.isInteger(e?.metadata?.[13]) && (e.metadata[13] & 0x02) !== 0;

/**
 * Why an animal may belong to a player (a short reason), or null. `bases`: known player bases
 * [{x, y, z}]; the bot's own placed blocks (trackBotPlaced) never count as player-built.
 */
export function mayBelongToPlayer(bot, e, { bases = [] } = {}) {
    const name = customName(e);
    if (name) return 'it has a name tag';
    if (ownerOf(e) || tamedHorse(e)) return 'it is tamed';
    if (e?.vehicle) return 'it is on a leash';
    if (!e?.position) return 'its position is unknown';
    for (const b of bases) if (b && Math.hypot(b.x - e.position.x, b.z - e.position.z) <= HUNT.baseRadius) return 'it is near a player\'s base';
    const placed = bot?.rotnPlaced ?? new Set();
    let found = [];
    try {
        found = bot.findBlocks?.({ point: e.position, maxDistance: HUNT.ownedRadius, count: 64,
            matching: (b) => !!b && typeof b.name === 'string' && PLAYER_BUILT.test(b.name) }) ?? [];
    } catch { found = []; }
    const built = found.find(p => !placed.has(key(p)));
    if (built) {
        const b = bot.blockAt?.(built);
        return `it is near a ${b?.name ?? 'player-built block'} at ${key(built).replace(/,/g, ', ')} (a farm or a base)`;
    }
    return null;
}

/** The player bases the bot knows: places in its memory named "base" or "home" (or "<x> base"). */
export function knownBases(agent) {
    const mem = agent?.memory_bank?.memory ?? {};
    return Object.entries(mem).filter(([n]) => /(^|[\s_-])(base|home)($|[\s_-])/i.test(n))
        .map(([, p]) => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p)).filter(p => Number.isFinite(p?.x));
}

/**
 * Remember where the bot itself places blocks (its crafting tables, torches, shelter), so they never
 * make an animal look owned. Wraps bot.placeBlock once; keeps at most HUNT.placedMax positions.
 */
export function trackBotPlaced(bot) {
    if (!bot || bot.rotnPlaced || typeof bot.placeBlock !== 'function') return;
    const placed = bot.rotnPlaced = new Set();
    const original = bot.placeBlock.bind(bot);
    bot.placeBlock = (ref, face, ...rest) => {
        const target = ref?.position && face ? ref.position.plus(face) : null;
        if (target) {
            placed.add(key(target));
            if (placed.size > HUNT.placedMax) placed.delete(placed.values().next().value);
        }
        return original(ref, face, ...rest);
    };
}

/** The nearest animal the bot may hunt (within radius, not a baby, not maybe a player's), or null; `skipped` gets the reasons. */
export function huntTarget(bot, { bases = [], radius = HUNT.radius, skipped = [] } = {}) {
    const here = bot?.entity?.position;
    if (!here) return null;
    const animals = Object.values(bot.entities ?? {})
        .filter(e => e && e !== bot.entity && e.position && isHuntableAnimal(e) && e.position.distanceTo(here) <= radius)
        .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here));
    for (const e of animals) {
        const why = mayBelongToPlayer(bot, e, { bases });
        if (!why) return e;
        skipped.push(`${e.name}: ${why}`);
    }
    return null;
}

/** The names of the wild animals near (within radius) the bot may hunt, nearest first (for the food reserve's prompt). */
export function nearbyHuntable(bot, { bases = [], radius = 32 } = {}) {
    const here = bot?.entity?.position;
    if (!here) return [];
    return Object.values(bot.entities ?? {})
        .filter(e => e && e !== bot.entity && e.position && isHuntableAnimal(e) && e.position.distanceTo(here) <= radius)
        .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))
        .filter(e => !mayBelongToPlayer(bot, e, { bases }))
        .map(e => e.name);
}

