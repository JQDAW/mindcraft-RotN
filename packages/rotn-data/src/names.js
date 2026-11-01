// Name helpers shared by the translation layer and the catalog.
//
// Conventions (agreed with net-forge, PR #25, and harness-ops for G2):
// - A "registry name" is always the full Forge name, "ns:path" ("minecraft:log",
//   "pyrotech:rock"). bot.registry keeps vanilla names unprefixed ("log"), so
//   registryName() adds the namespace back.
// - A 1.12 "old name" may carry metadata after a last numeric segment:
//   "log:1", "minecraft:log:1", "pyrotech:rock:6". "pyrotech:rock" is ns:path.
// - New (1.21-style) names are vanilla only and unprefixed ("oak_log").

export const WILDCARD_META = 32767; // OreDictionary.WILDCARD_VALUE

/** Full registry name for a bot.registry entry, a name or a {name} object. */
export function registryName(entryOrName) {
    if (entryOrName == null) return null;
    const n = typeof entryOrName === 'string' ? entryOrName : (entryOrName.registryName ?? entryOrName.name);
    if (typeof n !== 'string' || n === '') return null;
    return n.includes(':') ? n.toLowerCase() : `minecraft:${n.toLowerCase()}`;
}

/** The name bot.registry uses: vanilla unprefixed, modded full. */
export function botName(regName) {
    if (regName == null) return null;
    return regName.startsWith('minecraft:') ? regName.slice('minecraft:'.length) : regName;
}

/**
 * Parse an old-style name with optional metadata.
 * @returns {{name: string, meta: number|null}|null} name is a full registry name; meta is null when absent.
 */
export function parseOld(input) {
    if (typeof input !== 'string') return null;
    const s = input.trim().toLowerCase();
    if (!s) return null;
    const parts = s.split(':');
    let meta = null;
    if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
        meta = Number(parts.pop());
        if (meta > WILDCARD_META) return null;
    }
    if (parts.length > 2 || parts.some(p => p === '')) return null;
    const name = parts.length === 1 ? `minecraft:${parts[0]}` : `${parts[0]}:${parts[1]}`;
    return { name, meta };
}

/** "minecraft:log" + 1 -> "log:1"; modded keeps its namespace; meta 0 is omitted. */
export function formatOld(name, meta = 0) {
    const n = botName(name);
    return meta ? `${n}:${meta}` : n;
}
