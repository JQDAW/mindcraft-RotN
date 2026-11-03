// Offline end-to-end for skills-rotn Request 2: Mindcraft's real initBot, through
// forge-bridge and REID, crafts in the 2x2 grid and at RotN's crafting table
// (FastWorkbench, opened with FML OpenGui), places a block and eats, against the
// in-process fake Forge server plus fake-containers.js (a model of the 1.12.2 server
// code read with javap). Item ids are the real Run A ids. Loopback only.
//
// The recipes are built the way skills-rotn's C1 will build them: prismarine-recipe
// objects from rotn-data's recipes (rock, sticks, Crafting Tools, ...), passed to bot.craft.

import { Buffer } from 'node:buffer';
import process from 'node:process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { startFakeForgeServer } from './fake-forge-server.js';
import { attachFakeContainers } from './fake-containers.js';
import { pinnedModList, syntheticRegistries, tmpFile, PING_FIXTURE, runAId, runARegistries } from './helpers.js';
import { readCapture } from '../src/capture.js';
import { Writer } from '../src/wire.js';

const require = createRequire(import.meta.url);
const BitArray = require('prismarine-chunk/src/pc/common/BitArray');
const { SmartBuffer } = require('smart-buffer');
const Vec3 = require('vec3');

const I = {
    rock: runAId('pyrotech:rock'), stick: runAId('minecraft:stick'), planks: runAId('minecraft:planks'),
    crudeAxe: runAId('pyrotech:crude_axe'), craftingTools: runAId('contenttweaker:crafting_tools'),
    table: runAId('minecraft:crafting_table'), stonePickaxe: runAId('minecraft:stone_pickaxe'),
    cobble: runAId('minecraft:cobblestone'), bread: runAId('minecraft:bread'),
};
const B = {
    stone: runAId('minecraft:stone', 'minecraft:blocks'), table: runAId('minecraft:crafting_table', 'minecraft:blocks'),
    cobble: runAId('minecraft:cobblestone', 'minecraft:blocks'), rock: runAId('pyrotech:rock', 'minecraft:blocks'),
};
const TABLE = { x: 10, y: 65, z: 8 };

// The sync the bot gets: the real ids and the real fastbench override, plus the synthetic
// entity, biome and serializer registries the other e2e tests use.
function registries() {
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
function chunkData() {
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

function within(ms, promise, what) {
    let timer;
    const t = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: no result within ${ms} ms`)), ms); });
    return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

let server;
let bot;
after(async () => {
    try { bot?.quit(); bot?._client.socket?.destroy(); clearTimeout(bot?._client.closeTimer); } catch { /* already gone */ }
    await server?.close();
});

test('crafts in the 2x2 grid and at the FastWorkbench table, places a block and eats, through initBot', { timeout: 240000 }, async () => {
    assert.equal(runARegistries().get('minecraft:blocks').overrides.get('minecraft:crafting_table'), 'fastbench');
    let containers;
    const onJoin = (client) => {
        client.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 2, maxPlayers: 10, levelType: 'default', reducedDebugInfo: false });
        client.write('map_chunk', { x: 0, z: 0, groundUp: true, bitMap: 1 << 4, chunkData: chunkData(), blockEntities: [] });
        containers = attachFakeContainers(client, {
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
            foods: { [I.bread]: 5 },
            inventory: {
                36: { id: I.rock, count: 5 }, 37: { id: I.stick, count: 6 }, 38: { id: I.planks, count: 1 },
                39: { id: I.bread, count: 2 }, 40: { id: I.cobble, count: 8 },
            },
        });
        containers.sendInventory();
        client.write('position', { x: 8.5, y: 65, z: 6.5, yaw: 0, pitch: 0, flags: 0, teleportId: 1 });
    };
    server = await startFakeForgeServer({ modList: pinnedModList(), registries: registries(), reid: true, onJoin });
    const captureFile = tmpFile('craft-capture.jsonl');
    process.env.FORGE_CAPTURE = captureFile;
    process.env.FORGE_BRIDGE = 'auto';
    process.env.FORGE_PING_TIMEOUT_MS = '60000';
    process.env.FORGE_MODLIST_FILE = PING_FIXTURE;
    delete process.env.MINDCRAFT_PROFILES_FOLDER;

    const { setSettings } = await import('../../../src/agent/settings.js');
    setSettings({ host: '127.0.0.1', port: server.port, auth: 'offline', minecraft_version: '1.12.2' });
    const { initBot } = await import('../../../src/utils/mcdata.js');

    for (let attempt = 1; ; attempt++) { // one retry: a loaded loopback can fail at connect
        bot = initBot('FRCFLD');
        const spawned = once(bot, 'spawn').then(() => true);
        const failed = new Promise((resolve) => bot.once('end', () => resolve(false)));
        if (await within(120000, Promise.race([spawned, failed]), 'spawn')) break;
        try { bot._client.socket?.destroy(); clearTimeout(bot._client.closeTimer); } catch { /* gone */ }
        if (attempt === 2) assert.fail('no spawn after 2 login attempts');
        await sleep(2000);
    }
    for (let waited = 0; !bot.inventory.slots[36] && waited < 10000; waited += 50) await sleep(50);
    assert.equal(bot.registry.items[I.crudeAxe]?.name, 'pyrotech:crude_axe', 'modded names from the registry sync');
    assert.equal(bot.inventory.slots[36]?.type, I.rock);
    const { Recipe } = require('prismarine-recipe')(bot.registry);
    const st = containers.state;
    // On failure, show the server model's view (rejected clicks, slots, cursor) next to mineflayer's.
    const craftOrExplain = async (run, what) => {
        try { await within(30000, run(), what); } catch (e) {
            const local = bot.inventory.slots.map((s, i) => s && `${i}:${s.type}x${s.count}`).filter(Boolean).join(' ');
            throw new Error(`${what}: ${e.message}
rejected: ${JSON.stringify(st.rejected)}
server slots: ${JSON.stringify(st.inv)}
cursor: ${JSON.stringify(st.cursor)}
bot slots: ${local}
clicks: ${JSON.stringify(st.clicks.map(c => [c.windowId, c.slot, c.mouseButton, c.item.blockId, c.item.itemCount]))}`);
        }
    };

    // 2x2: crude axe (shaped), Crafting Tools and the crafting table (shapeless).
    const crudeAxe = new Recipe({ inShape: [[I.rock, I.stick], [I.stick, null]], result: { id: I.crudeAxe, count: 1, metadata: 0 } });
    assert.equal(crudeAxe.requiresTable, false);
    await craftOrExplain(() => bot.craft(crudeAxe, 1, null), 'craft crude axe');
    const tools = new Recipe({ ingredients: [I.crudeAxe, I.rock, I.stick], result: { id: I.craftingTools, count: 1, metadata: 0 } });
    await craftOrExplain(() => bot.craft(tools, 1, null), 'craft Crafting Tools');
    const tableRecipe = new Recipe({ ingredients: [I.planks, I.craftingTools], result: { id: I.table, count: 1, metadata: 0 } });
    await craftOrExplain(() => bot.craft(tableRecipe, 1, null), 'craft crafting table');
    assert.deepEqual([containers.count(I.crudeAxe), containers.count(I.craftingTools), containers.count(I.table)], [0, 0, 1], 'server-side inventory after the 2x2 crafts');
    assert.equal(containers.count(I.rock), 3);

    // The FastWorkbench table: activateBlock -> FML OpenGui -> synthetic open_window -> 3x3 craft.
    const tableBlock = bot.blockAt(new Vec3(TABLE.x, TABLE.y, TABLE.z));
    assert.equal(tableBlock.name, 'crafting_table');
    const pickaxe = new Recipe({ inShape: [[I.rock, I.rock, I.rock], [null, I.stick, null], [null, I.stick, null]], result: { id: I.stonePickaxe, count: 1, metadata: 0 } });
    assert.equal(pickaxe.requiresTable, true);
    await craftOrExplain(() => bot.craft(pickaxe, 1, tableBlock), 'craft stone pickaxe at the FastWorkbench table');
    assert.equal(containers.count(I.stonePickaxe), 1, 'stone pickaxe in the server-side inventory');
    assert.equal(containers.count(I.rock), 0);
    assert.equal(bot.forge.bridge.stats.modWindows, 1);
    // bot.craft writes close_window last; wait for it to reach the server.
    for (let waited = 0; st.tableWindow && waited < 5000; waited += 50) await sleep(50);
    assert.equal(st.tableWindow, null, 'the bot closed the table window');
    assert.equal(st.closedTableGrid, 0, 'nothing left in the table grid');
    assert.equal(bot.inventory.slots.filter(Boolean).find(s => s.type === I.stonePickaxe)?.name, 'stone_pickaxe');

    // Every click was accepted on the first try (the clicked item matched the server's stack).
    assert.deepEqual(st.rejected, []);
    assert.deepEqual(st.unsupported, []);
    assert.deepEqual(st.ignored, []);
    assert.ok(st.clicks.length >= 15, `${st.clicks.length} clicks`);

    // Place cobblestone on the floor; the server confirms it with block_change.
    await bot.equip(bot.inventory.items().find(i => i.type === I.cobble), 'hand');
    const floor = bot.blockAt(new Vec3(6, 64, 6));
    await within(10000, bot.placeBlock(floor, new Vec3(0, 1, 0)), 'placeBlock');
    assert.equal(bot.blockAt(new Vec3(6, 65, 6)).name, 'cobblestone');
    assert.deepEqual(st.placed.map(p => p.target), [{ x: 6, y: 65, z: 6 }]);
    assert.equal(containers.count(I.cobble), 7);

    // Eat bread: use_item with the main hand, finished by entity_status 9. The bot starts at
    // food 20 so that mineflayer-auto-eat (loaded by initBot) stays idle during the crafts;
    // here it is turned off so that bot.consume() is the only eater.
    bot.autoEat.disable();
    containers.setFood(15);
    for (let waited = 0; bot.food !== 15 && waited < 5000; waited += 50) await sleep(50);
    await bot.equip(bot.inventory.items().find(i => i.type === I.bread), 'hand');
    await within(10000, bot.consume(), 'consume');
    assert.deepEqual(st.uses.map(u => u.hand), [0]);
    assert.equal(st.food, 20);
    assert.equal(containers.count(I.bread), 1);

    // The capture records the clicks, transactions and the mod window for live debugging.
    bot.quit();
    await sleep(300);
    const cap = readCapture(captureFile);
    const named = (dir, name) => cap.filter(l => l.kind === 'packet' && l.dir === dir && l.name === name).length;
    assert.ok(named('C2S', 'window_click') >= 15);
    assert.ok(named('S2C', 'transaction') >= 15);
    assert.ok(named('C2S', 'block_place') >= 2);
    assert.ok(cap.some(l => l.kind === 'event' && l.name === 'mod_window' && l.modId === 'fastbench'));
    assert.ok(!JSON.stringify(cap).includes('FRCFLD'), 'username redacted');
});
