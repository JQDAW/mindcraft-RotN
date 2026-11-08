// G4 #2 (test/scenarios/g4/PLAN.md: RotN names; none of the top 50 blocks near spawn unknown; the
// plan names !nearbyBlocks and !entities). Once per process, after the first spawn, two journal
// lines from the bot's own naming path, for harness-ops:
//
//   [naming] <bot> near spawn: <kinds> kinds; unknown <n>; <name>:<count> <name>:<count> ...
//   [naming] <bot> entities +<secs>s: <kinds> kinds; unknown <n>; <name>:<count> ...
//
// Blocks: the distinct block names among the non-air blocks within NAMING_RADIUS, after the chunks
// have loaded (waited for, bounded; retried while fewer than NAMING_MIN_KINDS kinds); then the top
// NAMING_TOP kinds by count (ties by name), each "<name>:<count>". unknown: how many of those top
// kinds have no real name. A block with no name at all (a state the registry does not know: undefined,
// null or empty) is printed "#<type>:<meta>", e.g. "#4321:2:7"; a numeric name ("1234", "1234:5") or
// one with an "unknown" part is printed as it is.
// Entities: as !entities lists them (within ENTITY_RADIUS; no players, no dropped items), the same
// rules; an entity with no name is "#<entityType>" ("#?" when that is unknown too); forge-bridge's
// placeholder "<mod>:entity_<n>" and "unknown" count as unknown. Taken with the block scan; when no
// entity is near, again every ENTITY_RETRY_MS, at most ENTITY_TRIES times; "+<secs>s" says when.
// No LLM, no chat: console only.

import * as world from './world.js';

/** world.getNearestBlocks' defaults (what !nearbyBlocks asks for). */
export const NAMING_RADIUS = 8;
export const NAMING_COUNT = 10000;
export const NAMING_TOP = 50;
/** Fewer kinds than this near spawn is a scan of unloaded chunks: wait and scan again (harness-ops: a FAIL). */
export const NAMING_MIN_KINDS = 3;
/** The block scan: each try waits for the chunks at most chunkWaitMs, then RETRY_MS between tries. */
export const NAMING_SCAN = { tries: 3, chunkWaitMs: 15_000, retryMs: 5_000 };
/** world.getNearbyEntities' default (what !entities asks for). */
export const ENTITY_RADIUS = 16;
/** The entity scan: again every retryMs while nothing is near, at most `tries` scans in all. */
export const ENTITY_SCAN = { tries: 3, retryMs: 120_000 };

const AIR = new Set(['air', 'minecraft:air', 'cave_air', 'void_air']);
const noName = (name) => name === undefined || name === null || (typeof name === 'string' && name.trim() === '');

/** A block name that is not a real name: none, not a string, numeric ("1234", "1234:5"), or with an "unknown" part. */
export const unknownName = (name) => noName(name) || typeof name !== 'string' || /^\d+(:\d+)?$/.test(name)
    || /(^|[:_/])unknown([_/]|$)/.test(name);
/** An entity name that is not a real name: as unknownName, or forge-bridge's placeholder "<mod>:entity_<n>". */
export const unknownEntityName = (name) => unknownName(name) || /:entity_\d+$/.test(name);

/**
 * The non-air blocks near the bot: the query !nearbyBlocks makes (world.getNearestBlocks: radius 8,
 * up to 10000 blocks), but matching every state that is not air, so a block the registry does not
 * know (its id has no registry entry, so getNearestBlocks' id list can never match it) is counted too.
 */
export function blocksNearSpawn(bot) {
    const isAir = (b) => !!b && (b.type === 0 || AIR.has(b.name));
    return world.getNearestBlocksWhere(bot, (b) => !!b && !isAir(b), NAMING_RADIUS, NAMING_COUNT).filter(b => b && !isAir(b));
}

/** The entities !entities lists: within ENTITY_RADIUS, not a player (the bot itself included), not a dropped item. */
export function entitiesNearSpawn(bot) {
    return world.getNearbyEntities(bot, ENTITY_RADIUS).filter(e => e && e !== bot.entity && e.type !== 'player' && e.name !== 'item');
}

/** "<kinds> kinds; unknown <n>;<list>" for items keyed by keyOf, unknown by isUnknown. Deterministic: count, then key. */
function census(items, keyOf, isUnknown) {
    const kinds = new Map(); // printed key -> { n, unknown }
    for (const it of items) {
        const key = keyOf(it).replace(/\s+/g, '_');
        const k = kinds.get(key) ?? { n: 0, unknown: isUnknown(it) };
        k.n++;
        kinds.set(key, k);
    }
    const top = [...kinds].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, NAMING_TOP);
    const unknown = top.filter(([, k]) => k.unknown).length;
    const list = top.map(([key, k]) => `${key}:${k.n}`).join(' ');
    return { kinds: kinds.size, text: `${kinds.size} kinds; unknown ${unknown};${list ? ` ${list}` : ''}` };
}

const blockKey = (b) => (noName(b?.name) ? `#${b?.type ?? '?'}:${b?.metadata ?? 0}` : String(b.name));
const entityKey = (e) => (noName(e?.name) ? `#${e?.entityType ?? '?'}` : String(e.name));

/** The block line, from the blocks found (each {name, type, metadata}). */
export function namingLine(botName, blocks) {
    return `[naming] ${botName} near spawn: ${census(blocks, blockKey, (b) => unknownName(b?.name)).text}`;
}
/** The entity line, from the entities found (each {name, entityType}), taken `secs` after the block scan began. */
export function entityLine(botName, entities, secs = 0) {
    return `[naming] ${botName} entities +${Math.max(0, Math.round(secs))}s: ${census(entities, entityKey, (e) => unknownEntityName(e?.name)).text}`;
}
const kindsOf = (blocks) => census(blocks, blockKey, () => false).kinds;

const sleepFor = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/** The promise, or undefined after ms (a chunk wait that never ends must not hold the scan forever). */
function bounded(promise, ms, sleep) {
    return Promise.race([Promise.resolve(promise).catch(() => {}), sleep(ms)]);
}

/**
 * Both lines, once: the block scan after the chunks loaded (retried while fewer than NAMING_MIN_KINDS
 * kinds), then the entity scan (retried while nothing is near). Never throws; the caller does not
 * wait for it (the agent's start goes on). `stopped()` ends it early (the bot is gone).
 */
export async function reportNamingNearSpawn(bot, botName, { sleep = sleepFor, now = Date.now, log = (l) => console.log(l), stopped = () => false } = {}) {
    try {
        const start = now();
        let blocks = [];
        for (let i = 1; i <= NAMING_SCAN.tries && !stopped(); i++) {
            if (typeof bot.waitForChunksToLoad === 'function') await bounded(bot.waitForChunksToLoad(), NAMING_SCAN.chunkWaitMs, sleep);
            blocks = blocksNearSpawn(bot);
            if (kindsOf(blocks) >= NAMING_MIN_KINDS || i === NAMING_SCAN.tries) break;
            await sleep(NAMING_SCAN.retryMs);
        }
        if (stopped()) return;
        log(namingLine(botName, blocks));
        for (let i = 1; i <= ENTITY_SCAN.tries && !stopped(); i++) {
            const entities = entitiesNearSpawn(bot);
            if (entities.length > 0 || i === ENTITY_SCAN.tries) { log(entityLine(botName, entities, (now() - start) / 1000)); return; }
            await sleep(ENTITY_SCAN.retryMs);
        }
    } catch (err) {
        console.warn(`[naming] near spawn: could not read the world (${err?.message ?? err})`);
    }
}
