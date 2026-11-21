// Offline end to end for Better Combat's attack (G4 soak 7, rotn-data #518): Mindcraft's real
// initBot against the in-process fake Forge server. What reaches the server is decoded as
// Better Combat's server reads it (discriminator 5, readBoolean, readVarInt(4)).
// - With bc_attack on and the server's REGISTER listing bettercombat: arm_animation, then the
//   bettercombat payload, and no use_entity.
// - With bc_attack off, or a server without the channel: the vanilla use_entity ATTACK.
// Loopback only; no Minecraft server, no login.

import process from 'node:process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { startFakeForgeServer, DEFAULT_SERVER_CHANNELS } from './fake-forge-server.js';
import { pinnedModList, syntheticRegistries, PING_FIXTURE } from './helpers.js';
import { joinFakeWorld } from './fake-world.js';
import { decodeMainhandAttack } from '../src/bettercombat.js';

function within(ms, promise, what) {
    let timer;
    const t = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: no result within ${ms} ms`)), ms); });
    return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

// Poll until cond() holds; fails after ms, and never keeps the event loop alive after that.
async function until(ms, cond, what) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end) throw new Error(`${what}: not within ${ms} ms`);
        await sleep(20);
    }
}

const ZOMBIE = 500;
const servers = [];
const bots = [];
function closeBot(bot) {
    try { bot.quit(); bot._client.socket?.destroy(); clearTimeout(bot._client.closeTimer); } catch { /* already gone */ }
}
after(async () => {
    for (const b of bots) closeBot(b);
    for (const s of servers) await s.close();
});

// A zombie 2 blocks in front of the bot (8.5 65 8.5 in the fake world, holding stone), over its stone floor.
function onJoin(client) {
    joinFakeWorld(client);
    // The player's attack speed as a server sends it (base 4; the held stone adds no modifier).
    client.write('entity_update_attributes', { entityId: 1, properties: [{ key: 'generic.attackSpeed', value: 4, modifiers: [] }] });
    client.write('spawn_entity_living', {
        entityId: ZOMBIE, entityUUID: '00000000-0000-4000-8000-0000000001f4', type: 54,
        x: 8.5, y: 65, z: 10.5, yaw: 0, pitch: 0, headPitch: 0, velocity: { x: 0, y: 0, z: 0 }, metadata: [],
    });
}

async function attackOnce(server, { bcAttack, name }) {
    const { setSettings } = await import('../../../src/agent/settings.js');
    setSettings({ host: '127.0.0.1', port: server.port, auth: 'offline', minecraft_version: '1.12.2', bc_attack: bcAttack });
    const { initBot } = await import('../../../src/utils/mcdata.js');
    const bot = initBot(name);
    bots.push(bot);
    await within(120000, once(bot, 'spawn'), `${name} spawn`);
    await until(30000, () => bot.entities[ZOMBIE], 'zombie in bot.entities');
    await sleep(200);
    const before = server.state.attacks.length;
    const res = await bot.attack(bot.entities[ZOMBIE]);
    await until(10000, () => server.state.attacks.length >= before + 2, 'the attack on the wire');
    await sleep(100);
    const wire = server.state.attacks.slice(before);
    return { bot, res, wire };
}

test('initBot: bot.attack sends Better Combat\'s packet when bc_attack is on and the server has the channel; vanilla otherwise', { timeout: 300000 }, async () => {
    process.env.FORGE_BRIDGE = 'auto';
    process.env.FORGE_PING_TIMEOUT_MS = '60000';
    process.env.FORGE_MODLIST_FILE = PING_FIXTURE;
    delete process.env.FORGE_BC_ATTACK;
    delete process.env.FORGE_CAPTURE;
    delete process.env.MINDCRAFT_PROFILES_FOLDER;
    const modList = pinnedModList();
    assert.ok(modList.some((m) => m.modid === 'bettercombat'), 'the pinned mod list has Better Combat');

    const withChannel = await startFakeForgeServer({ modList, registries: syntheticRegistries(), onJoin, serverChannels: [...DEFAULT_SERVER_CHANNELS, 'bettercombat'] });
    servers.push(withChannel);

    // 1. On, and the server lists the channel: Better Combat's attack.
    const on = await attackOnce(withChannel, { bcAttack: true, name: 'BCON' });
    assert.ok(on.bot.forge.bridge.serverChannels.includes('bettercombat'));
    assert.equal(on.bot.forge.bcAttack.active, true);
    assert.equal(on.res.path, 'bettercombat');
    assert.deepEqual(on.wire.map((w) => w.name), ['arm_animation', 'bettercombat']);
    assert.equal(on.wire[0].params.hand, 0);
    assert.deepEqual(decodeMainhandAttack(on.wire[1].data), { disc: 5, entityId: ZOMBIE });
    assert.equal(on.wire[1].data.toString('hex'), '0501f403');
    assert.equal(on.bot.heldItem?.name, 'stone');
    assert.equal(on.bot.forge.attackCooldownTicks(), 13, 'stone in hand: Better Combat\'s non-weapon pacing (1.5), not the attribute\'s 4');
    // The server's hurt status settles the self-check.
    const hurt = once(on.bot, 'entityHurt');
    withChannel.state.client.write('entity_status', { entityId: ZOMBIE, entityStatus: 2 });
    await within(10000, hurt, 'entityHurt');
    assert.equal(on.bot.forge.bcAttack.stats.misses, 0);
    closeBot(on.bot);
    await sleep(300);

    // 2. Off (the default until the test-server run): the vanilla use_entity ATTACK.
    const off = await attackOnce(withChannel, { bcAttack: false, name: 'BCOFF' });
    assert.equal(off.res.path, 'vanilla');
    assert.deepEqual(off.wire.map((w) => w.name), ['use_entity', 'arm_animation']);
    assert.equal(off.wire[0].params.target, ZOMBIE);
    assert.equal(off.wire[0].params.mouse, 1, 'ATTACK');
    closeBot(off.bot);

    // 3. On, but the server does not list the channel: vanilla.
    const noChannel = await startFakeForgeServer({ modList, registries: syntheticRegistries(), onJoin });
    servers.push(noChannel);
    const lacks = await attackOnce(noChannel, { bcAttack: true, name: 'BCNOCH' });
    assert.equal(lacks.bot.forge.bcAttack.active, false);
    assert.match(lacks.bot.forge.bcAttack.status(), /lacks the bettercombat channel/);
    assert.equal(lacks.res.path, 'vanilla');
    assert.deepEqual(lacks.wire.map((w) => w.name), ['use_entity', 'arm_animation']);
});
