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
import { startFakeForgeServer } from './fake-forge-server.js';
import { pinnedModList, syntheticRegistries, tmpFile, PING_FIXTURE } from './helpers.js';
import { readCapture } from '../src/capture.js';
import { joinFakeWorld, MODDED } from './fake-world.js';

// Race a promise against a timeout that is always cleared (no lingering timer).
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

test('initBot logs in through forge-bridge to a fake Forge server and plays', { timeout: 240000 }, async () => {
    server = await startFakeForgeServer({ modList: pinnedModList(), registries: syntheticRegistries(), reid: true, onJoin: joinFakeWorld });
    const captureFile = tmpFile('capture.jsonl');
    process.env.FORGE_CAPTURE = captureFile;
    process.env.FORGE_BRIDGE = 'auto';
    process.env.FORGE_PING_TIMEOUT_MS = '60000'; // a loaded CI machine can stall the shared event loop
    // If the status ping still fails under load, the bridge attaches from the pinned
    // mod list (the ping path itself is unit-tested in connect.test.js).
    process.env.FORGE_MODLIST_FILE = PING_FIXTURE;
    delete process.env.MINDCRAFT_PROFILES_FOLDER;

    const { setSettings } = await import('../../../src/agent/settings.js');
    setSettings({ host: '127.0.0.1', port: server.port, auth: 'offline', minecraft_version: '1.12.2' });
    const { initBot } = await import('../../../src/utils/mcdata.js');

    // One retry of the whole login: under heavy load a loopback connect can fail
    // at once with ETIMEDOUT, which says nothing about the protocol path under test.
    let loginAttempt = 0;
    for (let attempt = 1; ; attempt++) {
        loginAttempt = attempt;
        bot = initBot('FRCFLD');
        const spawned = once(bot, 'spawn').then(() => true);
        const failed = new Promise((resolve) => bot.once('end', () => resolve(false)));
        if (await within(120000, Promise.race([spawned, failed]), 'spawn')) break;
        try { bot._client.socket?.destroy(); clearTimeout(bot._client.closeTimer); } catch { /* gone */ }
        if (attempt === 2) assert.fail('no spawn after 2 login attempts');
        await sleep(2000);
    }
    await sleep(300);

    // Handshake
    const bridge = bot.forge.bridge;
    assert.ok(bridge, 'bridge attached');
    // The live ping is the path under test. Only after a failed first login (a loaded
    // machine) may the bridge have come up from the pinned mod list instead.
    if (loginAttempt === 1) assert.equal(bridge.modListSource, 'ping');
    else assert.ok(['ping', 'file'].includes(bridge.modListSource), bridge.modListSource);
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
    // Brief item 4: bot.registry carries the synced modded names.
    const moddedBlock = bot.blockAt(bot.entity.position.floored().offset(-8, -1, -8));
    assert.equal(moddedBlock.name, 'pyrotech:rock');
    assert.equal(moddedBlock.boundingBox, 'block');
    assert.deepEqual(bot.forge.registryReport.added, { blocks: 2, items: 2, entities: 1, biomes: 1 });
    assert.equal(bot.inventory.slots[36].name, 'stone');
    assert.equal(bot.inventory.slots[36].count, 64);
    assert.equal(bot.inventory.slots[37].name, 'stick');
    assert.equal(bot.inventory.slots[38].type, 5003);
    assert.equal(bot.inventory.slots[38].name, 'pyrotech:crude_axe');
    assert.equal(bot.inventory.slots[39].type, 40000);
    assert.equal(bot.inventory.slots[39].count, 2);
    assert.equal(bot.entity.effects[300]?.amplifier, 1, 'REID effect id from the VarInt tail');
    assert.equal(bridge.stats.reidEffectTails, 1);
    assert.equal(bridge.stats.entitySpawns, 1);
    // Brief item 6: the FML-spawned mod mob is in bot.entities, and mineflayer tracks it from there.
    const mob = bot.entities[77];
    assert.ok(mob, 'FML EntitySpawn reached bot.entities');
    assert.equal(mob.name, 'iceandfire:entity_4', 'placeholder name until rotn-data\'s mod-local table exists');
    assert.equal(mob.forge.modId, 'iceandfire');
    assert.deepEqual([mob.position.x, mob.position.y, mob.position.z], [10, 65, 10]);
    const gone = once(bot, 'entityGone');
    server.state.client.write('entity_destroy', { entityIds: [77] });
    await within(10000, gone, 'entityGone');
    assert.equal(bot.entities[77], undefined, 'mineflayer\'s own entity_destroy removed it');
    assert.equal(bridge.stats.jeidMessages, 1);
    assert.equal(bridge.stats.parseErrors, 0);
    assert.equal(bridge.stats.partialReadErrors, 0);
    assert.deepEqual(bridge.stats.partialPackets, {});
    assert.equal(bot.partialReadErrors, 0);

    // Chat both ways
    const heard = new Promise((resolve) => bot.on('chat', (user, msg) => { if (user === 'JQDAW') resolve(msg); }));
    server.state.client.write('chat', { message: JSON.stringify({ translate: 'chat.type.text', with: [{ text: 'JQDAW' }, { text: 'hello bot' }] }), position: 0 });
    assert.equal(await within(30000, heard, 'chat'), 'hello bot');
    bot.chat('hello from FRCFLD');
    await sleep(200);
    assert.ok(server.state.chats.includes('hello from FRCFLD'));

    // Walk a few blocks
    const start = bot.entity.position.clone();
    const before = server.state.positions.length;
    bot.setControlState('forward', true);
    // Poll instead of a fixed sleep: physics ticks slow down under load.
    for (let waited = 0; bot.entity.position.distanceTo(start) <= 2.5 && waited < 30000; waited += 100) await sleep(100);
    bot.setControlState('forward', false);
    await sleep(300);
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
