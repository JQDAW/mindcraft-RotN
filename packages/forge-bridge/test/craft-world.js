// The crafting world shared by craft-e2e.test.js and probe-e2e.test.js: the real Run A ids
// and the fastbench override, a stone floor with RotN's crafting table, the fake 1.12.2
// containers (fake-containers.js), and Mindcraft's real initBot logged in to it.
// Loopback only.

import { Buffer } from 'node:buffer';
import process from 'node:process';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { startFakeForgeServer } from './fake-forge-server.js';
import { attachFakeContainers } from './fake-containers.js';
import { pinnedModList, syntheticRegistries, PING_FIXTURE, runAId } from './helpers.js';
import { Writer } from '../src/wire.js';

const require = createRequire(import.meta.url);
const BitArray = require('prismarine-chunk/src/pc/common/BitArray');
const { SmartBuffer } = require('smart-buffer');

export const I = {
    rock: runAId('pyrotech:rock'), stick: runAId('minecraft:stick'), planks: runAId('minecraft:planks'),
    crudeAxe: runAId('pyrotech:crude_axe'), craftingTools: runAId('contenttweaker:crafting_tools'),
    table: runAId('minecraft:crafting_table'), stonePickaxe: runAId('minecraft:stone_pickaxe'),
    cobble: runAId('minecraft:cobblestone'), bread: runAId('minecraft:bread'),
};
export const B = {
    stone: runAId('minecraft:stone', 'minecraft:blocks'), table: runAId('minecraft:crafting_table', 'minecraft:blocks'),
    cobble: runAId('minecraft:cobblestone', 'minecraft:blocks'), rock: runAId('pyrotech:rock', 'minecraft:blocks'),
};
export const TABLE = { x: 10, y: 65, z: 8 };

// The sync the bot gets: the real ids and the real fastbench override, plus the synthetic
// entity, biome and serializer registries the other e2e tests use.
export function registries() {
    const pick = (reg, names) => names.map(n => [n, runAId(n, reg)]);
    const blocks = pick('minecraft:blocks', ['minecraft:air', 'minecraft:stone', 'minecraft:grass', 'minecraft:cobblestone', 'minecraft:planks', 'minecraft:crafting_table', 'pyrotech:rock']);
    const items = pick('minecraft:items', ['minecraft:stone', 'minecraft:cobblestone', 'minecraft:planks', 'minecraft:crafting_table', 'minecraft:stone_pickaxe', 'minecraft:stick', 'minecraft:bread', 'pyrotech:rock', 'pyrotech:crude_axe', 'contenttweaker:crafting_tools']);
    const override = [['minecraft:crafting_table', 'fastbench']];
    const rest = syntheticRegistries().filter(r => !['minecraft:blocks', 'minecraft:items'].includes(r.name));
    return [
        { name: 'minecraft:blocks', ids: blocks, dummied: [], overrides: override },
        { name: 'minecraft:items', ids: items, dummied: [], overrides: override },
        ...rest,
    ];
}

// One section (y 64-79): stone floor at y=64 and the crafting table.
export function chunkData() {
    const data = new BitArray({ bitsPerValue: 16, capacity: 4096 });
    for (let i = 0; i < 256; i++) data.set(i, B.stone << 4);
    data.set(((TABLE.y - 64) << 8) | (TABLE.z << 4) | TABLE.x, B.table << 4);
    const sb = new SmartBuffer();
    data.writeBuffer(sb);
    const longs = sb.toBuffer();
    const w = new Writer().u8(16).varint(0).varint(longs.length / 8).bytes(longs)
        .bytes(Buffer.alloc(2048, 0xff)).bytes(Buffer.alloc(2048, 0xff));
    w.varint(256);
    for (let i = 0; i < 256; i++) w.varint(1); // REID VarInt biomes
    return w.toBuffer();
}

export function within(ms, promise, what) {
    let timer;
    const t = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: no result within ${ms} ms`)), ms); });
    return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

/** The fake containers for this world: RotN's four early recipes (rotn-data), cobblestone, bread. */
export function joinCraftWorld(client) {
    client.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 2, maxPlayers: 10, levelType: 'default', reducedDebugInfo: false });
    client.write('map_chunk', { x: 0, z: 0, groundUp: true, bitMap: 1 << 4, chunkData: chunkData(), blockEntities: [] });
    const containers = attachFakeContainers(client, {
        table: TABLE,
        // rotn-data: crafttweaker:pyro_crude_axe (2x2 shaped), crafting_tools and
        // crafting_table (shapeless), crafttweaker:stone_pickaxe (3x3 shaped).
        recipes: [
            { shaped: [[I.rock, I.stick], [I.stick, null]], result: { id: I.crudeAxe } },
            { shapeless: [I.crudeAxe, I.rock, I.stick], result: { id: I.craftingTools } },
            { shapeless: [I.planks, I.craftingTools], result: { id: I.table } },
            { shaped: [[I.rock, I.rock, I.rock], [null, I.stick, null], [null, I.stick, null]], result: { id: I.stonePickaxe } },
        ],
        blocks: { [I.cobble]: B.cobble },
        foods: { [I.bread]: { hunger: 3, saturation: 0.2 } }, // RotN scripts/food.zs
        maxStack: { [I.crudeAxe]: 1, [I.craftingTools]: 1, [I.stonePickaxe]: 1 },
        inventory: {
            36: { id: I.rock, count: 5 }, 37: { id: I.stick, count: 6 }, 38: { id: I.planks, count: 1 },
            39: { id: I.bread, count: 2 }, 40: { id: I.cobble, count: 8 },
        },
    });
    containers.sendInventory();
    client.write('position', { x: 8.5, y: 65, z: 6.5, yaw: 0, pitch: 0, flags: 0, teleportId: 1 });
    return containers;
}

/**
 * Start the fake server with the craft world and log Mindcraft's real initBot in to it
 * (one login retry: a loaded loopback can fail at connect). The caller closes both.
 * @returns {Promise<{ server: object, bot: object, containers: () => object }>}
 */
export async function startCraftWorld({ captureFile, onJoin } = {}) {
    let containers = null;
    const server = await startFakeForgeServer({
        modList: pinnedModList(), registries: registries(), reid: true,
        onJoin: (client, state) => { containers = joinCraftWorld(client); onJoin?.(client, state, containers); },
    });
    process.env.FORGE_CAPTURE = captureFile;
    process.env.FORGE_BRIDGE = 'auto';
    process.env.FORGE_PING_TIMEOUT_MS = '60000';
    process.env.FORGE_MODLIST_FILE = PING_FIXTURE;
    delete process.env.MINDCRAFT_PROFILES_FOLDER;
    const { setSettings } = await import('../../../src/agent/settings.js');
    setSettings({ host: '127.0.0.1', port: server.port, auth: 'offline', minecraft_version: '1.12.2' });
    const { initBot } = await import('../../../src/utils/mcdata.js');
    let bot;
    for (let attempt = 1; ; attempt++) {
        bot = initBot('FRCFLD');
        const spawned = once(bot, 'spawn').then(() => true);
        const failed = new Promise((resolve) => bot.once('end', () => resolve(false)));
        if (await within(120000, Promise.race([spawned, failed]), 'spawn')) break;
        try { bot._client.socket?.destroy(); clearTimeout(bot._client.closeTimer); } catch { /* gone */ }
        if (attempt === 2) assert.fail('no spawn after 2 login attempts');
        await sleep(2000);
    }
    for (let waited = 0; !bot.inventory.slots[36] && waited < 10000; waited += 50) await sleep(50);
    return { server, bot, containers: () => containers };
}

/** Quit the bot and close the server (for after()). */
export async function stopCraftWorld({ server, bot } = {}) {
    try { bot?.quit(); bot?._client.socket?.destroy(); clearTimeout(bot?._client.closeTimer); } catch { /* already gone */ }
    await server?.close();
}
