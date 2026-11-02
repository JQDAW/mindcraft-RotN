// The movement guard (G2 batch 7: the items session was kicked with
// multiplayer.disconnect.invalid_player_movement ~2 s after join). Forge 1.12.2's
// NetHandlerPlayServer.isMovePlayerPacketInvalid kicks for a non-finite x, y, z, yaw or pitch,
// or |x|, |y|, |z| > 3.0E7. Offline: mineflayer 4.33's real plugins (physics included) on a
// fake client, wired as initBot wires them (the guard under the movement throttle).
//
// Batch 7's capture did not record the server's movement inputs or the bot's movement packets,
// so the exact trigger is not in a fixture. These tests reproduce the failure mode: one
// non-finite input into the bot's own motion makes stock mineflayer send a packet the server
// kicks for. The state stays poisoned (mineflayer then stops ticking physics, because
// blockAt(NaN) is null), so a repaired state matters as much as the dropped packet.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { attachMovementGuard, movementProblem, MAX_COORD } from '../src/movement-guard.js';
import { throttleMovement } from '../src/movement-throttle.js';

const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOVES = new Set(['position', 'position_look', 'look', 'vehicle_move']);

// A mineflayer bot on a fake 1.12.2 client: logged in, standing on a stone floor at (8.5, 65, 8.5).
async function standingBot({ guard = true } = {}) {
    const client = new EventEmitter();
    client.version = '1.12.2';
    client.sent = [];
    client.write = (name, data) => { client.sent.push({ name, data: { ...data } }); return true; };
    client.end = () => {};
    client.registerChannel = client.unregisterChannel = client.writeChannel = () => {};
    const bot = mineflayer.createBot({ client, version: '1.12.2', username: 'tester', auth: 'offline', hideErrors: true, logErrors: false });
    const logs = [];
    const events = [];
    let g = null;
    if (guard) {
        g = attachMovementGuard(bot, { log: (m) => logs.push(m), capture: () => ({ event: (name, data) => events.push({ name, ...data }) }) });
        bot._client.write = throttleMovement(g.guardWrite(bot._client.write.bind(bot._client)), { intervalMs: 50 });
    }
    await new Promise((r) => bot.once('inject_allowed', r));
    await sleep(0); // plugins are injected in the same tick as inject_allowed
    client.emit('login', { entityId: 42, gameMode: 0, dimension: 0, difficulty: 2, maxPlayers: 10, levelType: 'default', reducedDebugInfo: false });
    const Chunk = require('prismarine-chunk')(bot.registry);
    const c = new Chunk();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) c.setBlockStateId(new Vec3(x, 64, z), 1 << 4);
    client.emit('map_chunk', { x: 0, z: 0, groundUp: true, bitMap: c.getMask(), chunkData: c.dump(), blockEntities: [] });
    client.emit('position', { x: 8.5, y: 65, z: 8.5, yaw: 0, pitch: 0, flags: 0, teleportId: 1 });
    await sleep(250);
    const moves = () => client.sent.filter((w) => MOVES.has(w.name));
    const bad = () => moves().map((w) => movementProblem(w.name, w.data)).filter(Boolean);
    return { bot, client, logs, events, guard: g, moves, bad, end: () => bot.emit('end', 'test') };
}

test('movementProblem: what Forge 1.12.2 kicks for (non-finite fields, |coordinate| > 3.0E7), and nothing else', () => {
    assert.equal(movementProblem('position', { x: 1, y: 65, z: -3e7, onGround: true }), null, '3.0E7 itself is allowed');
    assert.equal(movementProblem('position_look', { x: 1, y: 65, z: 2, yaw: 720, pitch: 95, onGround: true }), null, 'rotation is checked for finiteness only');
    assert.equal(movementProblem('position', { x: NaN, y: 65, z: 2 }), 'position x NaN');
    assert.equal(movementProblem('position', { x: 1, y: Infinity, z: MAX_COORD + 1 }), 'position y Infinity, z 30000001');
    assert.equal(movementProblem('look', { x: NaN, yaw: 0, pitch: -Infinity }), 'look pitch -Infinity', 'a look packet has no position');
    assert.equal(movementProblem('vehicle_move', { x: 0, y: 0, z: 0, yaw: NaN, pitch: 0 }), 'vehicle_move yaw NaN');
    assert.equal(movementProblem('flying', { onGround: true }), null);
    assert.equal(movementProblem('chat', { message: 'x' }), null);
});

test('reproduction: without the guard, one NaN explosion knockback makes stock mineflayer send position x NaN, and the state stays poisoned', async () => {
    const s = await standingBot({ guard: false });
    try {
        assert.deepEqual(s.bad(), [], 'a good start');
        s.client.emit('explosion', { x: 8, y: 65, z: 8, radius: 1, affectedBlockOffsets: [], playerMotionX: NaN, playerMotionY: 0, playerMotionZ: 0 });
        await sleep(1200);
        const bad = s.bad();
        assert.ok(bad.length >= 1, 'the server would kick');
        assert.match(bad[0], /^position(_look)? x NaN/);
        assert.ok(Number.isNaN(s.bot.entity.position.x), 'the state stays poisoned');
    } finally { s.end(); }
});

test('with the guard: a NaN explosion knockback is used as 0, nothing bad is sent, logged once, traced in the capture', async () => {
    const s = await standingBot();
    try {
        for (let i = 0; i < 2; i++) {
            s.client.emit('explosion', { x: 8, y: 65, z: 8, radius: 1, affectedBlockOffsets: [], playerMotionX: NaN, playerMotionY: Infinity, playerMotionZ: 0.1 });
        }
        await sleep(400);
        assert.deepEqual(s.bad(), []);
        assert.ok(Number.isFinite(s.bot.entity.position.x) && Number.isFinite(s.bot.entity.position.y));
        assert.equal(s.guard.stats.sanitizedInputs, 2);
        assert.equal(s.logs.length, 1);
        assert.match(s.logs[0], /explosion knockback had playerMotionX NaN, playerMotionY Infinity; used 0/);
        assert.equal(s.events.length, 1);
        assert.equal(s.events[0].name, 'movement_trace');
        const ex = s.events[0].trace.find((e) => e.name === 'explosion');
        assert.deepEqual(ex.sanitized, ['playerMotionX NaN', 'playerMotionY Infinity']);
        assert.ok(s.events[0].trace.some((e) => e.dir === 'C2S' && e.name.startsWith('position')), 'the trace has the bot\'s own packets');
        assert.doesNotThrow(() => JSON.stringify(s.events[0]));
    } finally { s.end(); }
});

test('with the guard: a server position packet with a non-finite field keeps the current value (relative 0)', async () => {
    const s = await standingBot();
    try {
        s.client.emit('position', { x: 9.5, y: NaN, z: 8.5, yaw: NaN, pitch: 0, flags: 0, teleportId: 2 });
        await sleep(150);
        assert.deepEqual(s.bad(), []);
        const p = s.bot.entity.position;
        assert.deepEqual([p.x, Math.round(p.y), p.z], [9.5, 65, 8.5]);
        assert.ok(Number.isFinite(s.bot.entity.yaw));
        assert.match(s.logs[0], /server position packet had y NaN, yaw NaN; kept the current value/);
    } finally { s.end(); }
});

test('with the guard: a poisoned state from any other source is repaired (physics tick, or the 250 ms check while physics is stalled) and never sent', async () => {
    const s = await standingBot();
    try {
        const before = s.bot.entity.position.clone();
        s.bot.entity.velocity.x = NaN;
        s.bot.entity.position.z = Infinity;
        s.bot.entity.pitch = NaN;
        await sleep(300);
        assert.deepEqual(s.bad(), []);
        const p = s.bot.entity.position;
        assert.equal(p.z, before.z, 'the last good position');
        assert.ok(Number.isFinite(s.bot.entity.velocity.x) && Number.isFinite(s.bot.entity.pitch));
        assert.ok(s.guard.stats.repairedStates >= 1);
        assert.equal(s.logs.length, 1);
        assert.match(s.logs[0], /bot state became invalid \(position 8\.5 65 Infinity, velocity NaN .*pitch NaN\) at (physicsTick|timer)/);
        // Out of range but finite counts too.
        s.bot.entity.position.x = 4e7;
        await sleep(200);
        assert.deepEqual(s.bad(), []);
        assert.equal(s.bot.entity.position.x, before.x);
        assert.equal(s.logs.length, 1, 'still logged once');
    } finally { s.end(); }
});

test('the wire guard: a bad packet is dropped (never written), the state is repaired, logged once', () => {
    const written = [];
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.entity = { id: 1, position: new Vec3(1, 65, 2), velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, onGround: true };
    after(() => bot.emit('end'));
    const logs = [];
    const g = attachMovementGuard(bot, { log: (m) => logs.push(m) });
    const write = g.guardWrite((name, data) => { written.push([name, data]); return true; });
    bot.emit('physicsTick'); // records the good state
    assert.equal(write('position', { x: 1, y: 65, z: 2, onGround: true }), true);
    bot.entity.position.y = NaN;
    assert.equal(write('position', { x: 1, y: NaN, z: 2, onGround: true }), false);
    assert.equal(write('look', { yaw: NaN, pitch: 0, onGround: true }), false);
    assert.equal(write('chat', { message: 'hi' }), true);
    assert.deepEqual(written.map(([n]) => n), ['position', 'chat']);
    assert.equal(bot.entity.position.y, 65);
    assert.equal(g.stats.droppedPackets, 2);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /dropped position y NaN: the server kicks for it/);
});

test('a movement kick writes the trace to the capture (once), even when nothing was caught first', () => {
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.entity = { id: 7, position: new Vec3(0, 65, 0), velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0 };
    after(() => bot.emit('end'));
    const events = [];
    const g = attachMovementGuard(bot, { capture: () => ({ event: (name, data) => events.push({ name, ...data }) }) });
    bot._client.emit('entity_velocity', { entityId: 7, velocity: { x: 0, y: -100, z: 0 } });
    bot._client.emit('entity_velocity', { entityId: 8, velocity: { x: 1, y: 1, z: 1 } }); // not us: not traced
    bot._client.emit('entity_metadata', { entityId: 7, metadata: [{ key: 0, type: 0, value: 1 }] });
    bot._client.emit('kick_disconnect', { reason: '{"translate":"multiplayer.disconnect.kicked"}' });
    assert.equal(events.length, 0, 'other kicks: no trace');
    bot._client.emit('kick_disconnect', { reason: '{"translate":"multiplayer.disconnect.invalid_player_movement"}' });
    bot._client.emit('kick_disconnect', { reason: '{"translate":"multiplayer.disconnect.invalid_player_movement"}' });
    assert.equal(events.length, 1);
    assert.match(events[0].why, /^kick: .*invalid_player_movement/);
    assert.deepEqual(events[0].trace.map((e) => e.name), ['entity_velocity', 'entity_metadata', 'kick_disconnect'], 'the trace as it was at the first kick');
    assert.equal(events[0].trace[1].flags, 1);
    assert.equal(g.stats.movementKicks, 2);
});
