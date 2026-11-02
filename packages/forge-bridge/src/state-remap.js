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
// rotn-data's dumper (0.2.0, state-meta-remap.json) records, per block, the metas where
// the two differ. Its catalog's stateMetaRemap().byBlock is
//   { "minecraft:double_plant": { "8": 10, "9": 10, "11": 10 } }
// keyed by registry name (numeric ids belong to a world's save), network meta -> the
// meta of BLOCK_STATE_IDS.getByValue(id << 4 | meta) per getMetaFromState. initBot passes
// it as { blocks: byBlock }. This module turns that into registry.stateIdRemap (Map
// network state id -> client state id). It is applied exactly once, at decode time:
// patches/prismarine-chunk+1.41.0.patch in ChunkColumn.load (palettes, global data) and
// patches/mineflayer+4.33.0.patch in block_change / multi_block_change. Local writes
// (setBlockStateId and friends) hold client ids and are never remapped.
//
// The remapped ids are the bot's local view only. A remapped state id (2810) must never
// be sent back to the server, whose own id for that state is 2811; 1.12 clients send
// positions and items, not block state ids.

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
 *
 * The table is taken literally: network meta m of a block is client meta table[m]. The map
 * is a pure function, applied exactly once at decode time (chunk palettes, global-palette
 * data, block_change), so chains and cycles need no special handling: a permutation such
 * as pyrotech's worktable 0 -> 1, 1 -> 2, 2 -> 0 is applied as is. The only entries
 * skipped are true conflicts: one network id given two different client ids, which can
 * happen only when two table names resolve to the same synced block (an alias). Such an
 * id is left unmapped.
 * @param {object} registry  bot.registry after extendRegistry
 * @param {{blocks?: Record<string, Record<string, number>>} | null} table  { blocks: stateMetaRemap().byBlock }
 * @returns {{ map: Map<number, number>, blocks: string[], unknownBlocks: string[], invalid: string[], conflicts: string[] }}
 */
export function buildStateIdRemap(registry, table) {
    const map = new Map();
    const report = { map, blocks: [], unknownBlocks: [], invalid: [], conflicts: [] };
    const blocks = table?.blocks;
    if (!blocks || typeof blocks !== 'object') return report;
    const candidates = new Map(); // network id -> { to, from: [label], conflict }
    for (const [registryName, metas] of Object.entries(blocks)) {
        const entry = blockEntry(registry, registryName);
        if (!entry || !Number.isInteger(entry.id)) { report.unknownBlocks.push(registryName); continue; }
        if (!metas || typeof metas !== 'object') { report.invalid.push(`${registryName}: not an object`); continue; }
        for (const [from, to] of Object.entries(metas)) {
            if (!META.test(from) || !Number.isInteger(to) || to < 0 || to > 15) {
                report.invalid.push(`${registryName} ${from} -> ${to}`);
                continue;
            }
            const networkId = (entry.id << 4) | Number(from);
            const clientId = (entry.id << 4) | to;
            const label = `${registryName} ${from} -> ${to}`;
            const c = candidates.get(networkId);
            if (!c) candidates.set(networkId, { to: clientId, from: [label], conflict: false, name: registryName });
            else { c.from.push(label); if (c.to !== clientId) c.conflict = true; }
        }
    }
    const used = new Set();
    for (const [networkId, c] of candidates) {
        if (c.conflict) { report.conflicts.push(`network id ${networkId}: ${c.from.join(' vs ')}`); continue; }
        if (c.to === networkId) continue; // identity: nothing to do
        map.set(networkId, c.to);
        used.add(c.name);
    }
    report.blocks = Object.keys(blocks).filter((n) => used.has(n));
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
    for (const n of report.conflicts) log(`state-id remap: conflict, ${n}; skipped`);
    const blocks = table?.blocks;
    const tableBlocks = blocks && typeof blocks === 'object' ? Object.keys(blocks).length : null;
    return { tableBlocks, ...report, size: map.size };
}

/**
 * The one line initBot logs at login: whether the remap is active and what it covers.
 * @param {object|null|undefined} report  attachStateIdRemap's result (undefined: the
 *   server never sent a Forge registry)
 */
export function stateIdRemapStatus(report) {
    if (!report) return 'state-id remap inactive: no Forge registry sync; block state ids are used as sent';
    if (report.tableBlocks === null) return "state-id remap inactive: rotn-data's dump has no state-meta-remap table; block state ids are used as sent";
    if (report.size === 0) return `state-id remap inactive: nothing applied from the table's ${report.tableBlocks} blocks (not in the synced registry: ${report.unknownBlocks.length}; conflicts ${report.conflicts.length} skipped); block state ids are used as sent`;
    return `state-id remap active: applied ${report.size} state ids in ${report.blocks.length} of the table's ${report.tableBlocks} blocks; conflicts ${report.conflicts.length} skipped`;
}
