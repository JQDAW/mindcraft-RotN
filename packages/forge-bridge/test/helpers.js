// Shared helpers for forge-bridge tests. Offline only: no server, no network.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { loadModListFile } from '../src/modlist.js';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const PING_FIXTURE = path.join(FIXTURES, 'rotn-3.3.4', 'ping.json');

export function pinnedModList() {
    return loadModListFile(PING_FIXTURE);
}

export function tmpFile(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-bridge-test-'));
    return path.join(dir, name);
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
