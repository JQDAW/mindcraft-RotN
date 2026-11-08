// G4 #2 (test/scenarios/g4/PLAN.md: RotN names; none of the top 50 blocks near spawn unknown). Once
// per process, after the first spawn, one journal line from the bot's own naming path (the block
// names !nearbyBlocks shows), for harness-ops:
//
//   [naming] <bot> near spawn: <kinds> kinds; unknown <n>; <name>:<count> <name>:<count> ...
//
// kinds: the distinct block names among the non-air blocks within NAMING_RADIUS; then the top
// NAMING_TOP kinds by count (ties by name), each "<name>:<count>"; unknown: how many of those top
// kinds have no real name (undefined, null, empty, a number such as "1234" or "1234:5", or a name
// with an "unknown" part), printed as they are ("undefined:3", "null:1", "1234:2", "unknown:4").
// No LLM, no chat: console only.

import * as world from './world.js';

/** world.getNearestBlocks' defaults (what !nearbyBlocks asks for). */
export const NAMING_RADIUS = 8;
export const NAMING_COUNT = 10000;
export const NAMING_TOP = 50;

const AIR = new Set(['air', 'minecraft:air', 'cave_air', 'void_air']);

/** A block name that is not a real name: not a string, empty, numeric ("1234", "1234:5"), or with an "unknown" part. */
export const unknownName = (name) => typeof name !== 'string' || name.trim() === '' || /^\d+(:\d+)?$/.test(name)
    || /(^|[:_/])unknown([_/]|$)/.test(name);

/**
 * The non-air blocks near the bot: the query !nearbyBlocks makes (world.getNearestBlocks: radius 8,
 * up to 10000 blocks), but matching every state that is not air, so a block the registry does not
 * know (its id has no registry entry, so getNearestBlocks' id list can never match it) is counted too.
 */
export function blocksNearSpawn(bot) {
    const isAir = (b) => !!b && (b.type === 0 || AIR.has(b.name));
    return world.getNearestBlocksWhere(bot, (b) => !!b && !isAir(b), NAMING_RADIUS, NAMING_COUNT).filter(b => b && !isAir(b));
}

/** The line, from the blocks found (each {name}). Deterministic: count, then name. */
export function namingLine(botName, blocks) {
    const kinds = new Map(); // printed name -> { n, unknown }
    for (const b of blocks) {
        const unknown = unknownName(b?.name);
        const key = unknown ? (String(b?.name).trim() || '""') : b.name; // undefined, null and numbers as they are
        const k = kinds.get(key) ?? { n: 0, unknown };
        k.n++;
        kinds.set(key, k);
    }
    const top = [...kinds].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, NAMING_TOP);
    const unknown = top.filter(([, k]) => k.unknown).length;
    const list = top.map(([name, k]) => `${name.replace(/\s+/g, '_')}:${k.n}`).join(' ');
    return `[naming] ${botName} near spawn: ${kinds.size} kinds; unknown ${unknown};${list ? ` ${list}` : ''}`;
}
