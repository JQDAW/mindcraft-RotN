// Forge 1.12's two-pass block-state ids (G2 batch 4; Forge 14.23.5.2860
// GameData$BlockCallbacks.onAdd, read with javap on the pinned server pack):
//   pass 1: every valid state -> id << 4 | getMetaFromState(state)
//   pass 2: for each used meta m (Observers excepted), getStateFromMeta(m) -> id << 4 | m
// The map is last-put-wins, so a state that getStateFromMeta returns for several metas
// gets the highest one. Vanilla double_plant: getStateFromMeta(8..11) all return the
// default upper half (SUNFLOWER, NORTH), so a generated upper half is sent as meta 11,
// while the server's own getMetaFromState (testforblock) says 10. A real Forge client
// resolves 2811 with BLOCK_STATE_IDS.getByValue to that same state, i.e. meta 10.
//
// rotn-data's dumper exports, per block, the metas where the two differ:
//   { blocks: { "minecraft:double_plant": { "8": 10, "9": 10, "11": 10 } } }
// keyed by registry name (numeric ids belong to a world's save), network meta -> the
// meta of BLOCK_STATE_IDS.getByValue(id << 4 | meta) per getMetaFromState. This module
// turns that into registry.stateIdRemap (Map network state id -> client state id), which
// patches/prismarine-chunk+1.41.0.patch applies to every chunk load and block update.

const META = /^(?:[0-9]|1[0-5])$/;

function blockEntry(registry, registryName) {
    const byName = registry?.blocksByName ?? {};
    const name = registryName.startsWith('minecraft:') ? registryName.slice('minecraft:'.length) : registryName;
    // Vanilla blocks keep minecraft-data's unprefixed name; modded ones use the full
    // registry name; aliased vanilla 1.12 names resolve either way (registry-extension.js).
    return byName[name] ?? byName[registryName] ?? null;
}

/**
 * Builds the network -> client state-id map for a (Forge-extended) registry.
 * @param {object} registry  bot.registry after extendRegistry
 * @param {{blocks?: Record<string, Record<string, number>>} | null} table  rotn-data's table
 * @returns {{ map: Map<number, number>, blocks: string[], unknownBlocks: string[], invalid: string[] }}
 */
export function buildStateIdRemap(registry, table) {
    const map = new Map();
    const report = { map, blocks: [], unknownBlocks: [], invalid: [] };
    const blocks = table?.blocks;
    if (!blocks || typeof blocks !== 'object') return report;
    for (const [registryName, metas] of Object.entries(blocks)) {
        const entry = blockEntry(registry, registryName);
        if (!entry || !Number.isInteger(entry.id)) { report.unknownBlocks.push(registryName); continue; }
        if (!metas || typeof metas !== 'object') { report.invalid.push(`${registryName}: not an object`); continue; }
        const local = new Map();
        for (const [from, to] of Object.entries(metas)) {
            if (!META.test(from) || !Number.isInteger(to) || to < 0 || to > 15) {
                report.invalid.push(`${registryName} ${from} -> ${to}`);
                continue;
            }
            if (Number(from) !== to) local.set(Number(from), to);
        }
        // Resolve chains (a -> b -> c becomes a -> c), so applying the map twice changes
        // nothing; a cycle is dropped whole.
        let used = false;
        for (const from of local.keys()) {
            let to = local.get(from);
            const seen = new Set([from]);
            while (local.has(to) && !seen.has(to)) { seen.add(to); to = local.get(to); }
            if (local.has(to) || to === from) { report.invalid.push(`${registryName} ${from}: cycle`); continue; }
            map.set((entry.id << 4) | from, (entry.id << 4) | to);
            used = true;
        }
        if (used) report.blocks.push(registryName);
    }
    return report;
}

/**
 * Sets registry.stateIdRemap from rotn-data's table (or removes it when the table is
 * null or has nothing usable). Call after extendRegistry and before the first chunk.
 * @returns the buildStateIdRemap report, without the map
 */
export function attachStateIdRemap(registry, table, { log = () => {} } = {}) {
    const { map, ...report } = buildStateIdRemap(registry, table);
    if (map.size) registry.stateIdRemap = map;
    else delete registry.stateIdRemap;
    for (const n of report.unknownBlocks) log(`state-id remap: ${n} is not in the synced registry; skipped`);
    for (const n of report.invalid) log(`state-id remap: invalid entry ${n}; skipped`);
    log(`state-id remap: ${map.size} state ids in ${report.blocks.length} blocks`);
    return { ...report, size: map.size };
}
