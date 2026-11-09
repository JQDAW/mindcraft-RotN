// G4 #5 (CX23 soak m1: food fell to 1, nothing got food): the bot may hunt for food, but on the live
// server never an animal that may belong to a player (lead's hard rule). An animal is left alone
// when its metadata is unknown (missing, or forge-bridge's metadataError: #422 review 3), it has a
// custom name, is tamed or has an owner (an owner UUID in its metadata), is leashed (mineflayer sets
// entity.vehicle from 1.12's attach_entity, the leash holder) or carries passengers, is a saddled pig
// or a sheep that is not white (#422 review 9), is within HUNT.ownedRadius of player-built blocks
// (fences, fence gates, walls, beds, chests, crafting tables, torches) the bot did not place itself,
// or within HUNT.baseRadius of a known player base. The bot's own placed blocks are remembered in
// memory only (trackBotPlaced): after a restart its earlier tables and torches count as a player's,
// which only leaves more animals alone (it fails safe).

import * as mc from '../../utils/mcdata.js';

/**
 * Soak 2 (rotn-v0.1.4): at food 4 or lower (Normal difficulty) Hunger Overhaul gives weakness
 * (-4 attack: a bare hand does nothing), slowness and mining slowdown (its jar's
 * HungerOverhaulEventHook, config addLowHungerWeakness=true): the bot chased a sow it could not hurt
 * until food 0 killed it. No hunting at this food level or lower: forage or eat instead.
 */
export const HUNT_MIN_FOOD = 4;
export const tooWeakToHunt = (bot) => Number.isFinite(bot?.food) && bot.food <= HUNT_MIN_FOOD;

export const HUNT = { radius: 16, ownedRadius: 8, baseRadius: 32, placedMax: 512, maxMs: 90_000, checkMs: 500 };

/**
 * Animals the bot may hunt for food: vanilla's adult cow, mooshroom, pig, rabbit and sheep, and
 * Animania's adult females, which this pack spawns instead (rotn-data common-mobs: cow_*, sow_*,
 * ewe_*, doe_*). Never a chicken or a hen (raw chicken is avoided food, rotn-data) nor a llama (no
 * meat) (#422 review 5). Animania names its young apart (calf_, piglet_, lamb_, kit_, kid_, chick_),
 * and its males (bull_, hog_, ram_, buck_, rooster_) are left alone: some charge when hit.
 */
const VANILLA_FOOD = new Set(['cow', 'mooshroom', 'pig', 'rabbit', 'sheep']);
const ANIMANIA_FOOD = /^animania:(cow|sow|ewe|doe)_[a-z_]+$/;
export const isHuntableAnimal = (e) => !!e?.name
    && ((VANILLA_FOOD.has(e.name) && mc.isHuntable(e)) || ANIMANIA_FOOD.test(e.name));

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
    // #422 review 3: what cannot be read is never taken for wild.
    const md = e?.metadata;
    if (!md || typeof md !== 'object' || Object.keys(md).length === 0 || e?.forge?.metadataError) return 'its data (metadata) is unknown';
    const name = customName(e);
    if (name) return 'it has a name tag';
    if (ownerOf(e) || tamedHorse(e)) return 'it is tamed';
    if (e?.vehicle) return 'it is on a leash';
    // #422 review 9: a rider, a saddle (1.12 EntityPig index 13), a sheep that is not white (1.12
    // EntitySheep index 13: the low 4 bits are the colour; dyed or bred by a player).
    if (Array.isArray(e?.passengers) && e.passengers.length > 0) return 'it carries a passenger';
    if (e?.name === 'pig' && md[13] === true) return 'it has a saddle';
    if (e?.name === 'sheep' && Number.isInteger(md[13]) && (md[13] & 0x0f) !== 0) return 'it is not a white sheep (dyed or bred)';
    if (!e?.position) return 'its position is unknown';
    if (nearBase(bases, e.position)) return 'it is near a player\'s base';
    const built = playerBuiltNear(bot, e.position);
    return built ? `it is near ${built}` : null;
}

/** Whether a point is within HUNT.baseRadius of a known player base (horizontally). */
export const nearBase = (bases, p) => bases.some(b => b && Math.hypot(b.x - p.x, b.z - p.z) <= HUNT.baseRadius);

/**
 * The first player-built block (PLAYER_BUILT, or `isBuilt`) within `radius` of a point that the
 * bot did not place itself (trackBotPlaced), as "a <name> at x, y, z (a farm or a base)", or null.
 * Shared by the hunting and foraging checks (G4 #5).
 */
export function playerBuiltNear(bot, point, { radius = HUNT.ownedRadius, isBuilt = (name) => PLAYER_BUILT.test(name) } = {}) {
    const placed = bot?.rotnPlaced ?? new Set();
    let found = [];
    try {
        found = bot.findBlocks?.({ point, maxDistance: radius, count: 64,
            matching: (b) => !!b && typeof b.name === 'string' && isBuilt(b.name) }) ?? [];
    } catch { found = []; }
    const built = found.find(p => !placed.has(key(p)));
    if (!built) return null;
    const b = bot.blockAt?.(built);
    return `a ${b?.name ?? 'player-built block'} at ${key(built).replace(/,/g, ', ')} (a farm or a base)`;
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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/**
 * One bounded hunt (#422 review 1: the reflex's attackEntity looped while the animal was within
 * 24 blocks, an unreachable cow kept the bot out after dark). mineflayer-pvp attacks; every
 * HUNT.checkMs the hunt ends when the animal is dead or gone, the bot is stopped, keepGoing() says
 * no (the phase is no longer day, a threat came), or after maxMs. pvp stops however it ends.
 * `equip`: the weapon equip (skills.equipHighestAttack; passed in, as skills imports this module's
 * users). Returns 'killed' | 'gone' | 'interrupted' | 'stopped' | 'time'.
 */
export async function huntAnimal(bot, entity, { keepGoing = () => true, maxMs = HUNT.maxMs, equip = null } = {}) {
    try { await equip?.(bot); } catch { /* fights with what is in hand */ }
    const start = Date.now();
    bot.pvp?.attack?.(entity);
    try {
        for (;;) {
            await sleep(HUNT.checkMs);
            if (!bot.entities?.[entity.id] || entity.isValid === false) return 'killed';
            if (bot.interrupt_code) return 'interrupted';
            if (!keepGoing()) return 'stopped';
            if (Date.now() - start >= maxMs) return 'time';
            if (bot.entity?.position && entity.position && entity.position.distanceTo(bot.entity.position) > 24) return 'gone';
        }
    } finally {
        try { bot.pvp?.stop?.(); } catch { /* best effort */ }
    }
}

