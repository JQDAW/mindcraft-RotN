// G4 #5 food, foraging (lead, after rotn-data #423): wild food before hunting. What a block gives and
// how comes from rotn-data (forageFood / forageSources / forageHazard, 3.3.4/forage-food.json):
// - only a ready state (forageSources' readyMetas): never an unripe herb nor a bare berry bush;
// - a Rustic wildberry bush (rustic:wildberry_bush) is right-clicked, never broken (it keeps the
//   bush, which regrows its berries); herbs and HarvestCraft gardens are broken, never sneaking (a
//   garden broken while sneaking drops itself, not food);
// - never a block with a plant hazard: the BoP hawthorn (biomesoplenty:plant_0 meta 5, poison and
//   4 damage on right-click) is never touched; poison ivy and thorns (touch hazards) are never
//   foraged and every walk steps around them (plantSafe, goToGoal);
// - never food that rotn-data's avoidFood flags (cloudsbluff);
// - never a crop that may be a player's, like animals (the lead's hard rule): within
//   FORAGE.ownedRadius of player-built blocks (fences, beds, chests, torches ...) or of farmland,
//   crop stakes, trellises or flower pots the bot did not place, or within HUNT.baseRadius of a
//   known player base.
// Block names are full registry names (rustic:wildberry_bush; minecraft: added to vanilla ones).
// Pure helpers only (no skills import): skills.forageNearby walks, right-clicks and breaks.

import * as rotnData from '../../../packages/rotn-data/index.js';
import { HUNT, PLAYER_BUILT, nearBase, playerBuiltNear } from './hunting.js';

export const FORAGE = {
    radius: 24, // the reflex and !forage look this far for a ready block
    ownedRadius: HUNT.ownedRadius, // player-built blocks this near: the crop may be a player's
    reach: 3, // walk this near before a right-click or a break
    triedMs: 10 * 60_000, // a block the bot failed to forage is left alone this long
    triedMax: 256,
    hazardCost: 100, // pathfinder step cost of a touch-hazard plant (pathfinder: 100 and up is excluded)
};

/** Blocks near a crop that say it is a player's farm, besides PLAYER_BUILT. */
export const FARM_BUILT = /(^|:)(farmland|crop_stake|trellis|flower_pot)$/;
const isOwnedSign = (name) => PLAYER_BUILT.test(name) || FARM_BUILT.test(name);

const fullName = (name) => { try { return rotnData.registryName(name); } catch { return null; } };
/**
 * The mods forage-food.json names blocks of (its forage blocks and plant hazards; a test checks
 * every one): any other block is no forage source nor a hazard, without asking rotn-data. Keeps the
 * checks in collectBlock, useOn and every pathfinder step cheap.
 */
export const FORAGE_BLOCK_NAME = /^(rustic|biomesoplenty|harvestcraft):|^(minecraft:)?(brown|red)_mushroom$/;
const mayForage = (name) => typeof name === 'string' && FORAGE_BLOCK_NAME.test(name);
const posKey = (p) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;

let sourcesCache = null;
/**
 * The forage sources the bot may use: rotn-data's forageSources (no mushrooms, no avoided food),
 * as Map(registry name -> Set(ready metas)), without any block whose ready state has a plant hazard
 * (the hawthorn) or gives no food. Empty when rotn-data has no forage data.
 */
export function forageSources() {
    if (sourcesCache) return sourcesCache;
    const out = new Map();
    let list = [];
    try { list = rotnData.forageSources?.() ?? []; } catch { list = []; }
    for (const s of list) {
        const ready = new Set((s.readyMetas ?? []).filter(m => !!usable(forageInfoOf(s.block, m))));
        if (ready.size) out.set(s.block, ready);
    }
    sourcesCache = out;
    return out;
}
/** For tests: forget the cached sources. */
export function _resetForageCache() { sourcesCache = null; infoCache.clear(); hazardCache.clear(); }

const infoCache = new Map();
function forageInfoOf(name, meta) {
    const k = `${name}:${meta}`;
    if (!infoCache.has(k)) {
        let info = null;
        try { info = rotnData.forageFood?.(name, meta) ?? null; } catch { info = null; }
        infoCache.set(k, info);
    }
    return infoCache.get(k);
}

/** rotn-data's forageFood for a mineflayer block ({ name, metadata }), or null. */
export function forageInfo(block) {
    if (!mayForage(block?.name) || !Number.isInteger(block?.metadata)) return null;
    const name = fullName(block.name);
    return name ? forageInfoOf(name, block.metadata) : null;
}

/**
 * How the bot gets food from a forageFood result now: 'right-click' or 'break', or null when it
 * must not (not ready, waiting to regrow, a hazard, avoided or no food, a right-click that harms).
 */
export function usable(info) {
    if (!info || !info.ready) return null;
    if (info.hazards?.length) return null; // the hawthorn, poison ivy, thorns: never touched
    const foods = info.food ?? [];
    if (!foods.length || foods.every(f => f.avoid)) return null;
    if (info.how === 'right-click') return info.rightClick && !info.rightClick.harm && info.rightClick.keepsBlock !== false ? 'right-click' : null;
    if (info.how === 'break') return info.kind === 'mushroom' ? null : 'break';
    return null;
}

const hazardCache = new Map();
/** The touch hazards (poison ivy, thorns, tiny cacti) of a block state, cached: [] for none. */
export function touchHazards(block) {
    if (!block || !mayForage(block.name)) return [];
    const k = `${block.name}:${block.metadata}`;
    let hs = hazardCache.get(k);
    if (!hs) {
        const name = fullName(block.name);
        try { hs = (name && rotnData.forageHazard?.(name, block.metadata)) || []; } catch { hs = []; }
        hs = hs.filter(h => h.on === 'touch');
        hazardCache.set(k, hs);
    }
    return hs;
}

/**
 * Make pathfinder Movements step around touch-hazard plants (poison ivy, thorns): their step cost
 * is FORAGE.hazardCost. Marks the Movements, so it is added once. Returns the Movements.
 */
export function plantSafe(movements) {
    if (!movements || movements.rotnPlantSafe || !Array.isArray(movements.exclusionAreasStep)) return movements;
    movements.rotnPlantSafe = true;
    movements.exclusionAreasStep.push((block) => (touchHazards(block).length ? FORAGE.hazardCost : 0));
    return movements;
}

/** Why a crop at a point may be a player's (a short reason), or null. */
export function mayBeAPlayersCrop(bot, point, { bases = [] } = {}) {
    if (!point) return 'its position is unknown';
    if (nearBase(bases, point)) return 'it is near a player\'s base';
    const built = playerBuiltNear(bot, point, { radius: FORAGE.ownedRadius, isBuilt: isOwnedSign });
    return built ? `it is near ${built}` : null;
}

/**
 * Why the bot must not take a block by breaking it (skills.collectBlock: !collectBlocks), or null: a
 * forage source that is not ready, is right-clicked (a berry bush: never broken), has a plant
 * hazard or may be a player's. Any other block: null.
 */
export function breakRefusal(bot, block, { bases = [] } = {}) {
    const info = forageInfo(block);
    if (!info || info.kind === 'mushroom') return null; // a mushroom is food only once smelted: any collect may take it
    const how = usable(info);
    const name = fullName(block.name);
    if (info.hazards?.length) return `${name} is a hazard plant (${info.hazards.map(h => h.id).join(', ')}): never touch it`;
    if (how === 'right-click' || info.how === 'right-click' || info.kind === 'berry-bush') return `${name} is a berry bush: never break it; pick its berries with !forage when it has them`;
    if (!how) return `${name} is not ripe (state ${info.state ?? info.meta}): leave it to grow`;
    const owner = block.position ? mayBeAPlayersCrop(bot, block.position, { bases }) : null;
    return owner ? `${name} may be a player's: ${owner}` : null;
}

/** Why the bot must not right-click a block (!activate), or null: a right-click plant hazard (the hawthorn). */
export function rightClickRefusal(block) {
    const info = forageInfo(block);
    const harm = info?.rightClick?.harm ?? null;
    if (harm || info?.hazards?.some(h => h.on === 'right-click')) return `${fullName(block.name)} hurts on a right-click (poison and thorns): never touch it`;
    return null;
}

/** Remember a block the bot failed to forage (left alone for FORAGE.triedMs). */
export function markTried(bot, pos, now = Date.now()) {
    if (!bot || !pos) return;
    const tried = bot.rotnForageTried ??= new Map();
    tried.set(posKey(pos), now);
    if (tried.size > FORAGE.triedMax) tried.delete(tried.keys().next().value);
}
const triedRecently = (bot, pos, now) => {
    const at = bot?.rotnForageTried?.get(posKey(pos));
    return at !== undefined && now - at < FORAGE.triedMs;
};

/**
 * The nearest ready forage blocks the bot may take, nearest first: [{ block, how, info }].
 * `skipped` gets the reasons for blocks left alone as maybe a player's.
 */
export function forageTargets(bot, { bases = [], radius = FORAGE.radius, count = 8, skipped = [], now = Date.now() } = {}) {
    const here = bot?.entity?.position;
    const sources = forageSources();
    if (!here || sources.size === 0 || typeof bot.findBlocks !== 'function') return [];
    let found = [];
    try {
        found = bot.findBlocks({ maxDistance: radius, count: 64,
            // #427 review: the cheap name filter first; fullName (rotn-data) only for a forage mod's block.
            matching: (b) => !!b && mayForage(b.name) && !!sources.get(fullName(b.name))?.has(b.metadata) }) ?? [];
    } catch { found = []; }
    const out = [];
    for (const p of found.sort((a, b) => a.distanceTo(here) - b.distanceTo(here))) {
        if (out.length >= count) break;
        if (triedRecently(bot, p, now)) continue;
        const block = bot.blockAt?.(p);
        const info = forageInfo(block);
        const how = usable(info);
        if (!how) continue;
        const why = mayBeAPlayersCrop(bot, p, { bases });
        if (why) { skipped.push(`${info.block} at ${posKey(p).replace(/,/g, ', ')}: ${why}`); continue; }
        out.push({ block, how, info });
    }
    return out;
}

/** The nearest one (forageTargets), or null. */
export const forageTarget = (bot, opts = {}) => forageTargets(bot, { ...opts, count: 1 })[0] ?? null;

/** The names of the ready forage blocks near (for the food reserve's prompt), nearest first, each once. */
export function nearbyForage(bot, { bases = [], radius = 32 } = {}) {
    return [...new Set(forageTargets(bot, { bases, radius, count: 8 }).map(t => t.info.block))];
}
