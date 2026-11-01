// Offline end-to-end: Mindcraft's real initBot (src/utils/mcdata.js) against an
// in-process fake Forge server on 127.0.0.1. Covers the G1 protocol path:
// status ping -> tagHost -> FML handshake -> Join Game -> REID chunk, slots and
// effects -> chat -> walking, with the capture file. No real Minecraft server,
// no Microsoft login (auth offline), no network beyond loopback.

import { Buffer } from 'node:buffer';
import process from 'node:process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { startFakeForgeServer } from './fake-forge-server.js';
import { pinnedModList, syntheticRegistries, tmpFile } from './helpers.js';
import { Writer, encodeVarInt } from '../src/wire.js';
import { encodeEntitySpawn } from '../src/channels.js';
import { readCapture } from '../src/capture.js';

const require = createRequire(import.meta.url);
const BitArray = require('prismarine-chunk/src/pc/common/BitArray');
const { SmartBuffer } = require('smart-buffer');

const MODDED = (4001 << 4) | 3;

// Race a promise against a timeout that is always cleared (no lingering timer).
function within(ms, promise, what) {
    let timer;
    const t = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: no result within ${ms} ms`)), ms); });
    return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

// One section (y 64-79): stone floor at y=64, a modded block at (0,64,0), air above.
function chunkData() {
    const data = new BitArray({ bitsPerValue: 16, capacity: 4096 });
    for (let i = 0; i < 256; i++) data.set(i, 1 << 4);
    data.set(0, MODDED);
    const sb = new SmartBuffer();
    data.writeBuffer(sb);
    const longs = sb.toBuffer();
    const w = new Writer().u8(16).varint(0).varint(longs.length / 8).bytes(longs)
        .bytes(Buffer.alloc(2048, 0xff)).bytes(Buffer.alloc(2048, 0xff));
    w.varint(256);
    for (let i = 0; i < 256; i++) w.varint(i === 0 ? 300 : 1); // REID VarInt biomes
    return w.toBuffer();
}

function join(client) {
    client.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 2, maxPlayers: 10, levelType: 'default', reducedDebugInfo: false });
    client.write('map_chunk', { x: 0, z: 0, groundUp: true, bitMap: 1 << 4, chunkData: chunkData(), blockEntities: [] });
    const items = Array.from({ length: 46 }, () => ({ blockId: -1 }));
    items[36] = { blockId: 1, itemCount: 64, itemDamage: 0 };   // minecraft:stone
    items[37] = { blockId: 280, itemCount: 3, itemDamage: 0 };  // minecraft:stick
    items[38] = { blockId: 5003, itemCount: 1, itemDamage: 0 }; // modded, above 4095
    client.write('window_items', { windowId: 0, items });
    client.write('set_slot', { windowId: 0, slot: 39, item: { blockId: 40000, itemCount: 2, itemDamage: 1 } });
    client.write('position', { x: 8.5, y: 65, z: 8.5, yaw: 0, pitch: 0, flags: 0, teleportId: 1 });
    client.write('update_health', { health: 20, food: 20, foodSaturation: 5 });
    client.write('entity_effect', { entityId: 1, effectId: ((300 & 0xff) << 24) >> 24, amplifier: 1, duration: 200, hideParticles: 0, reidEffectId: encodeVarInt(300) });
    client.write('custom_payload', {
        channel: 'FML',
        data: encodeEntitySpawn({
            entityId: 77, modId: 'iceandfire', modEntityTypeId: 4, uuid: '00000000-0000-0000-0000-00000000004d',
            x: 10, y: 65, z: 10, yaw: 0, pitch: 0, headYaw: 0,
        }),
    });
    client.write('custom_payload', { channel: 'jeid', data: new Writer().u8(1).varint(-5).varint(7).varint(300).toBuffer() });
}

let server;
let bot;
after(async () => {
    try { bot?.quit(); bot?._client.socket?.destroy(); clearTimeout(bot?._client.closeTimer); } catch { /* already gone */ }
    await server?.close();
});

test('initBot logs in through forge-bridge to a fake Forge server and plays', { timeout: 30000 }, async () => {
    server = await startFakeForgeServer({ modList: pinnedModList(), registries: syntheticRegistries(), reid: true, onJoin: join });
    const captureFile = tmpFile('capture.jsonl');
    process.env.FORGE_CAPTURE = captureFile;
    process.env.FORGE_BRIDGE = 'auto';
    delete process.env.MINDCRAFT_PROFILES_FOLDER;

    const { setSettings } = await import('../../../src/agent/settings.js');
    setSettings({ host: '127.0.0.1', port: server.port, auth: 'offline', minecraft_version: '1.12.2' });
    const { initBot } = await import('../../../src/utils/mcdata.js');

    bot = initBot('FRCFLD');
    await within(15000, once(bot, 'spawn'), 'spawn');
    await sleep(300);

    // Handshake
    const bridge = bot.forge.bridge;
    assert.ok(bridge, 'bridge attached');
    assert.equal(bridge.modListSource, 'ping');
    assert.ok(server.state.serverHost.endsWith('\0FML\0'), 'tagHost on the handshake host');
    assert.equal(server.state.hsState, 'DONE');
    assert.equal(bridge.handshakeDone, true);
    assert.equal(bridge.reid.version, '2.2.2');
    const hsOut = server.state.fromClient.filter(p => p.channel === 'FML|HS' || p.channel === 'REGISTER').map(p => `${p.channel}:${p.data[0]}`);
    assert.deepEqual(hsOut.slice(0, 7), ['REGISTER:70', 'FML|HS:1', 'FML|HS:2', 'FML|HS:255', 'FML|HS:255', 'FML|HS:255', 'FML|HS:255']);
    const acks = server.state.fromClient.filter(p => p.channel === 'FML|HS' && p.data[0] === 0xff).map(p => p.data[1]);
    assert.deepEqual(acks, [2, 3, 4, 5]);
    assert.deepEqual(bridge.registries.namespaces('minecraft:blocks'), { minecraft: 3, pyrotech: 2 });
    const brand = server.state.fromClient.find(p => p.channel === 'MC|Brand');
    assert.ok(brand && brand.data.toString().includes('fml,forge'), 'Forge client brand');

    // World, inventory and effects with REID formats
    assert.equal(bot.blockAt(bot.entity.position.offset(0, -1, 0)).name, 'stone');
    const modded = bot.world.getBlockStateId({ x: 0, y: 64, z: 0 });
    assert.equal(modded, MODDED);
    assert.equal(bot.inventory.slots[36].name, 'stone');
    assert.equal(bot.inventory.slots[36].count, 64);
    assert.equal(bot.inventory.slots[37].name, 'stick');
    assert.equal(bot.inventory.slots[38].type, 5003);
    assert.equal(bot.inventory.slots[39].type, 40000);
    assert.equal(bot.inventory.slots[39].count, 2);
    assert.equal(bot.entity.effects[300]?.amplifier, 1, 'REID effect id from the VarInt tail');
    assert.equal(bridge.stats.reidEffectTails, 1);
    assert.equal(bridge.stats.entitySpawns, 1);
    assert.equal(bridge.stats.jeidMessages, 1);
    assert.equal(bridge.stats.parseErrors, 0);
    assert.equal(bridge.stats.partialReadErrors, 0);
    assert.deepEqual(bridge.stats.partialPackets, {});
    assert.equal(bot.partialReadErrors, 0);

    // Chat both ways
    const heard = new Promise((resolve) => bot.on('chat', (user, msg) => { if (user === 'JQDAW') resolve(msg); }));
    server.state.client.write('chat', { message: JSON.stringify({ translate: 'chat.type.text', with: [{ text: 'JQDAW' }, { text: 'hello bot' }] }), position: 0 });
    assert.equal(await within(3000, heard, 'chat'), 'hello bot');
    bot.chat('hello from FRCFLD');
    await sleep(200);
    assert.ok(server.state.chats.includes('hello from FRCFLD'));

    // Walk a few blocks
    const start = bot.entity.position.clone();
    const before = server.state.positions.length;
    bot.setControlState('forward', true);
    await sleep(1200);
    bot.setControlState('forward', false);
    await sleep(200);
    const moved = bot.entity.position.distanceTo(start);
    assert.ok(moved > 2, `bot moved ${moved.toFixed(2)} blocks`);
    const last = server.state.positions.at(-1);
    assert.ok(server.state.positions.length > before, 'server received movement');
    assert.ok(Math.hypot(last.x - start.x, last.z - start.z) > 2, 'server saw the newest position');

    // Capture
    bot.quit();
    await sleep(300);
    const cap = readCapture(captureFile);
    const kinds = new Set(cap.map(l => l.kind));
    for (const k of ['event', 'payload', 'packet']) assert.ok(kinds.has(k), `capture has ${k}`);
    const channelsSeen = new Set(cap.filter(l => l.kind === 'payload').map(l => `${l.dir}:${l.channel}`));
    for (const c of ['S2C:REGISTER', 'S2C:FML|HS', 'C2S:REGISTER', 'C2S:FML|HS', 'S2C:FML', 'S2C:jeid', 'C2S:MC|Brand']) {
        assert.ok(channelsSeen.has(c), `capture has ${c}`);
    }
    assert.ok(cap.some(l => l.kind === 'packet' && l.name === 'window_items'));
    assert.ok(cap.some(l => l.kind === 'event' && l.name === 'hs_complete'));
    assert.ok(cap.some(l => l.kind === 'event' && l.name === 'registries'));
    assert.ok(!JSON.stringify(cap).includes('FRCFLD'), 'username redacted');
    for (const l of cap.filter(x => x.b64)) assert.equal(Buffer.from(l.b64, 'base64').indexOf('FRCFLD'), -1);
});
