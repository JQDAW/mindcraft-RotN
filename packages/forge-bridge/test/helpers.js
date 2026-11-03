// Shared helpers for forge-bridge tests. Offline only: no server, no network.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import { loadModListFile } from '../src/modlist.js';
import { decodeHandshake, HS } from '../src/fml-hs.js';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const PING_FIXTURE = path.join(FIXTURES, 'rotn-3.3.4', 'ping.json');

export function pinnedModList() {
    return loadModListFile(PING_FIXTURE);
}

export function tmpFile(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-bridge-test-'));
    return path.join(dir, name);
}

let runARegistryCache = null;

/**
 * The real RotN 3.3.4 RegistryData from G1 Batch A (fixtures/rotn-3.3.4/handshake-runA.*),
 * decoded once: Map<registryName, Map<entryName, id>>. Tests take real ids from here
 * instead of hard-coding them.
 */
export function runARegistries() {
    if (runARegistryCache) return runARegistryCache;
    const dir = path.join(FIXTURES, 'rotn-3.3.4');
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'handshake-runA.json'), 'utf8'));
    const raw = zlib.brotliDecompressSync(fs.readFileSync(path.join(dir, 'handshake-runA.bin.br')));
    const out = new Map();
    let off = 0;
    for (const r of index.records) {
        const data = raw.subarray(off, off + r.len);
        off += r.len;
        if (r.dir !== 'S2C' || r.channel !== 'FML|HS' || data[0] !== HS.REGISTRY_DATA) continue;
        const m = decodeHandshake(data);
        out.set(m.name, { ids: new Map(m.ids), overrides: new Map(m.overrides) });
    }
    runARegistryCache = out;
    return out;
}

/** Real Run A id of an item ("pyrotech:crude_axe") or block ("minecraft:crafting_table"). */
export function runAId(name, registry = 'minecraft:items') {
    const id = runARegistries().get(registry)?.ids.get(name);
    if (id === undefined) throw new Error(`${name} is not in the Run A ${registry}`);
    return id;
}

// A small synthetic registry set shaped like Forge's 11 core registries plus mods.
export function syntheticRegistries() {
    return [
        { name: 'minecraft:blocks', ids: [['minecraft:air', 0], ['minecraft:stone', 1], ['minecraft:grass', 2], ['pyrotech:rock', 4001], ['pyrotech:log_pile', 4002]], dummied: [], overrides: [] },
        { name: 'minecraft:items', ids: [['minecraft:stone', 1], ['minecraft:stick', 280], ['pyrotech:rock', 4001], ['pyrotech:crude_axe', 5003]], dummied: ['oldmod:gone'], overrides: [['minecraft:stick', 'somemod']] },
        { name: 'minecraft:entities', ids: [['minecraft:zombie', 54], ['iceandfire:dragon', 300]], dummied: [], overrides: [] },
        { name: 'minecraft:biomes', ids: [['minecraft:plains', 1], ['biomesoplenty:bayou', 300]], dummied: [], overrides: [] },
        { name: 'minecraft:dataserializers', ids: [['minecraft:byte', 0], ['somemod:custom', 256]], dummied: [], overrides: [] },
    ];
}
