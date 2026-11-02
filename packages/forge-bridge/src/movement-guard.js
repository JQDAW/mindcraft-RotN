// Movement guard (G2 batch 7: items session kicked ~2 s after join with
// multiplayer.disconnect.invalid_player_movement).
//
// Forge 1.12.2's NetHandlerPlayServer.processPlayer kicks a client whose CPacketPlayer has a
// non-finite x, y, z, yaw or pitch, or |x|, |y| or |z| above 3.0E7
// (isMovePlayerPacketInvalid); processVehicleMove does the same for CPacketVehicleMove
// (invalid_vehicle_movement). Rotation is checked for finiteness only.
//
// mineflayer's physics sends bot.entity's state as it is, so one non-finite input (a server
// packet, or anything that sets bot.entity.position, velocity, yaw or pitch) poisons every
// later packet. This module:
//   1. sanitizes the server inputs that mineflayer feeds into the bot's own motion (position,
//      the bot's own entity_teleport, explosion knockback) before mineflayer's handlers see them;
//   2. checks the bot's state every physics tick (and every 250 ms) and repairs a non-finite or out-of-range
//      position, velocity or rotation from the last good state (or, before there is one, the
//      server's last absolute position);
//   3. guards the wire: a movement packet that the server would kick for is never sent
//      (dropped; the state is repaired, so the next tick sends a good one);
//   4. keeps a short trace of movement inputs and outputs, and writes it to the capture (and
//      one log line) the first time anything above fires, and on a movement kick.
// Each kind of event is logged once; all are counted in bot.forge.movementGuard.

export const MAX_COORD = 3.0e7;
const TRACE_SIZE = 80;

const POSITION_FIELDS = ['x', 'y', 'z'];
const LOOK_FIELDS = ['yaw', 'pitch'];
/** The C2S packets the server checks, and their fields. */
export const GUARDED_PACKETS = {
    position: { pos: POSITION_FIELDS, look: [] },
    position_look: { pos: POSITION_FIELDS, look: LOOK_FIELDS },
    look: { pos: [], look: LOOK_FIELDS },
    vehicle_move: { pos: POSITION_FIELDS, look: LOOK_FIELDS },
};

const badCoord = (v) => !Number.isFinite(v) || Math.abs(v) > MAX_COORD;

/**
 * Why the server would kick this outgoing packet, or null.
 * @returns {string|null} e.g. "position_look x NaN"
 */
export function movementProblem(name, data) {
    const spec = GUARDED_PACKETS[name];
    if (!spec || !data) return null;
    const bad = [];
    for (const f of spec.pos) if (badCoord(data[f])) bad.push(`${f} ${data[f]}`);
    for (const f of spec.look) if (!Number.isFinite(data[f])) bad.push(`${f} ${data[f]}`);
    return bad.length ? `${name} ${bad.join(', ')}` : null;
}

const num = (v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v); // JSON keeps NaN/Infinity as text
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, num(o[k])]));
const vec = (v) => (v ? [num(v.x), num(v.y), num(v.z)] : null);
const finiteVec = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const goodPos = (v) => finiteVec(v) && Math.abs(v.x) <= MAX_COORD && Math.abs(v.y) <= MAX_COORD && Math.abs(v.z) <= MAX_COORD;

/**
 * Attach the guard to a mineflayer bot (call right after createBot, before login).
 * Returns { guardWrite, stats, trace }. guardWrite(write) wraps the client's write function;
 * initBot puts it under the movement throttle, so merged packets are checked too.
 */
export function attachMovementGuard(bot, { log = () => {}, capture = () => null, now = Date.now, checkIntervalMs = 250 } = {}) {
    const t0 = now();
    const stats = { droppedPackets: 0, repairedStates: 0, sanitizedInputs: 0, movementKicks: 0, first: null };
    const trace = [];
    const logged = new Set();
    // The last good state, recorded only after the server has placed the bot (mineflayer's
    // first forcedMove): before that, bot.entity.position is prismarine-entity's (0, 0, 0)
    // placeholder, and mineflayer sends no movement anyway.
    let good = null; // { pos: Vec3 clone, yaw, pitch }
    let spawned = false;
    // Fallback while there is no good state yet: the last absolute, finite x, y, z the server
    // sent (position or own entity_teleport).
    let serverPos = null;
    let traceWritten = false;

    const record = (entry) => {
        trace.push({ t: now() - t0, ...entry });
        if (trace.length > TRACE_SIZE) trace.shift();
    };
    const state = () => {
        const e = bot.entity;
        return e ? { pos: vec(e.position), vel: vec(e.velocity), yaw: num(e.yaw), pitch: num(e.pitch), onGround: e.onGround } : null;
    };
    const writeTrace = (why) => {
        if (traceWritten) return;
        traceWritten = true;
        capture()?.event('movement_trace', { why, stats: { ...stats }, state: state(), trace: [...trace] });
    };
    const once = (kind, message) => {
        if (!stats.first) stats.first = { kind, message, t: now() - t0 };
        if (logged.has(kind)) return;
        logged.add(kind);
        log(`movement guard: ${message} (logged once; trace in the capture as movement_trace)`);
        writeTrace(`${kind}: ${message}`);
    };

    const isSelf = (id) => bot.entity && id === bot.entity.id;
    const client = bot._client;
    const on = (name, fn) => client.prependListener(name, fn); // before mineflayer's own handlers

    // 1. Server inputs into the bot's own motion. Sanitized in place, then traced.
    on('position', (p) => {
        const bad = [];
        const f = p.flags ?? 0;
        // 1.12 flags: 1 x, 2 y, 4 z, 8 yaw, 16 pitch are relative. A non-finite field becomes
        // "relative 0", i.e. keep the current value.
        [['x', 1], ['y', 2], ['z', 4], ['yaw', 8], ['pitch', 16]].forEach(([f, bit]) => {
            if (typeof p[f] === 'number' && !Number.isFinite(p[f])) { bad.push(`${f} ${p[f]}`); p[f] = 0; p.flags |= bit; }
        });
        if (!(f & 7) && !badCoord(p.x) && !badCoord(p.y) && !badCoord(p.z)) serverPos = { x: p.x, y: p.y, z: p.z };
        record({ dir: 'S2C', name: 'position', ...pick(p, ['x', 'y', 'z', 'yaw', 'pitch', 'flags', 'teleportId']), ...(bad.length ? { sanitized: bad } : {}) });
        if (bad.length) { stats.sanitizedInputs++; once('input:position', `server position packet had ${bad.join(', ')}; kept the current value`); }
    });
    on('explosion', (p) => {
        const bad = [];
        for (const f of ['playerMotionX', 'playerMotionY', 'playerMotionZ']) {
            if (typeof p[f] === 'number' && !Number.isFinite(p[f])) { bad.push(`${f} ${p[f]}`); p[f] = 0; }
        }
        record({ dir: 'S2C', name: 'explosion', ...pick(p, ['x', 'y', 'z', 'radius', 'playerMotionX', 'playerMotionY', 'playerMotionZ']), blocks: p.affectedBlockOffsets?.length, ...(bad.length ? { sanitized: bad } : {}) });
        if (bad.length) { stats.sanitizedInputs++; once('input:explosion', `server explosion knockback had ${bad.join(', ')}; used 0`); }
    });
    // entity_teleport carries doubles on 1.12, and mineflayer's entities plugin sets the bot's
    // own position from it (entities.js, 'entity_teleport', doublePosition). For self, a
    // non-finite or out-of-range coordinate keeps the current value, as for position.
    on('entity_teleport', (p) => {
        if (!isSelf(p.entityId)) return;
        const bad = [];
        const cur = bot.entity.position;
        for (const k of ['x', 'y', 'z']) {
            if (typeof p[k] === 'number' && badCoord(p[k])) {
                bad.push(`${k} ${p[k]}`);
                p[k] = goodPos(cur) ? cur[k] : (good?.pos ?? serverPos)?.[k] ?? 0;
            }
        }
        if (!bad.length) serverPos = { x: p.x, y: p.y, z: p.z };
        record({ dir: 'S2C', name: 'entity_teleport', ...pick(p, ['x', 'y', 'z', 'yaw', 'pitch']), ...(bad.length ? { sanitized: bad } : {}) });
        if (bad.length) { stats.sanitizedInputs++; once('input:entity_teleport', `server entity_teleport for the bot had ${bad.join(', ')}; kept the current value`); }
    });
    // Traced only, for self: their fields are integers or bytes on the wire (velocity i16,
    // relative moves i16, angles i8), so they cannot carry a non-finite value.
    on('entity_velocity', (p) => { if (isSelf(p.entityId)) record({ dir: 'S2C', name: 'entity_velocity', ...pick(p, ['velocity', 'velocityX', 'velocityY', 'velocityZ']) }); });
    for (const name of ['rel_entity_move', 'entity_move_look', 'entity_look']) {
        on(name, (p) => { if (isSelf(p.entityId)) record({ dir: 'S2C', name, ...pick(p, ['x', 'y', 'z', 'dX', 'dY', 'dZ', 'yaw', 'pitch']) }); });
    }
    on('attach_entity', (p) => { if (isSelf(p.entityId) || isSelf(p.vehicleId)) record({ dir: 'S2C', name: 'attach_entity', ...pick(p, ['entityId', 'vehicleId']) }); });
    on('set_passengers', (p) => { if (p.passengers?.some(isSelf) || isSelf(p.entityId)) record({ dir: 'S2C', name: 'set_passengers', entityId: p.entityId, passengers: p.passengers }); });
    on('update_health', (p) => record({ dir: 'S2C', name: 'update_health', ...pick(p, ['health', 'food', 'foodSaturation']) }));
    on('abilities', (p) => record({ dir: 'S2C', name: 'abilities', ...pick(p, ['flags', 'flyingSpeed', 'walkingSpeed']) }));
    on('respawn', () => record({ dir: 'S2C', name: 'respawn' }));
    on('entity_metadata', (p) => {
        if (!isSelf(p.entityId)) return;
        const flags = p.metadata?.find((m) => m.key === 0);
        if (flags) record({ dir: 'S2C', name: 'entity_metadata', flags: flags.value });
    });
    on('kick_disconnect', (p) => {
        const text = typeof p.reason === 'string' ? p.reason : JSON.stringify(p.reason);
        if (!/invalid_(player|vehicle)_movement|Invalid move/i.test(text ?? '')) return;
        stats.movementKicks++;
        record({ dir: 'S2C', name: 'kick_disconnect', reason: text.slice(0, 200) });
        writeTrace(`kick: ${text.slice(0, 200)}`);
    });

    // 2. The bot's own state, every physics tick (after physics, before mineflayer sends).
    // Position source: the last good state, else the server's last absolute position. With
    // neither (the server never placed the bot validly), the position stays as it is and
    // movement packets keep being dropped until the server sends one; that is logged once.
    const repair = (why) => {
        const e = bot.entity;
        const to = good?.pos ?? serverPos;
        if (!goodPos(e.position)) {
            if (to) e.position.set(to.x, to.y, to.z);
            else once('no-good-state', 'no good position yet (the server has not placed the bot validly); movement packets are held back until it does');
        }
        if (!finiteVec(e.velocity)) e.velocity.set(0, 0, 0);
        if (!Number.isFinite(e.yaw)) e.yaw = good?.yaw ?? 0;
        if (!Number.isFinite(e.pitch)) e.pitch = good?.pitch ?? 0;
        stats.repairedStates++;
        record({ name: 'repair', why, after: state() });
    };
    const checkState = (where) => {
        const e = bot.entity;
        if (!e?.position) return;
        const bad = [];
        if (!goodPos(e.position)) bad.push(`position ${vec(e.position).join(' ')}`);
        if (!finiteVec(e.velocity)) bad.push(`velocity ${vec(e.velocity).join(' ')}`);
        if (!Number.isFinite(e.yaw)) bad.push(`yaw ${e.yaw}`);
        if (!Number.isFinite(e.pitch)) bad.push(`pitch ${e.pitch}`);
        if (!bad.length) {
            if (spawned) good = { pos: e.position.clone(), yaw: e.yaw, pitch: e.pitch };
            return;
        }
        record({ name: 'bad_state', where, bad, state: state() });
        once('state', `bot state became invalid (${bad.join(', ')}) at ${where}; restored the last good state`);
        repair(where);
    };
    bot.on('physicsTick', () => checkState('physicsTick'));
    bot.on('forcedMove', () => { spawned = true; checkState('forcedMove'); });
    // mineflayer skips the physics tick (and physicsTick) while blockAt(position) is null, which
    // a non-finite or far-out position always is, so such a state would freeze the bot for good.
    const timer = setInterval(() => checkState('timer'), checkIntervalMs);
    timer.unref?.();
    bot.once('end', () => clearInterval(timer));

    // 3. The wire.
    const guardWrite = (write) => function guarded(name, data) {
        if (!GUARDED_PACKETS[name]) return write(name, data);
        const problem = movementProblem(name, data);
        if (!problem) {
            record({ dir: 'C2S', name, ...pick(data, ['x', 'y', 'z', 'yaw', 'pitch', 'onGround']) });
            return write(name, data);
        }
        stats.droppedPackets++;
        record({ dir: 'C2S', name, dropped: problem, ...pick(data, ['x', 'y', 'z', 'yaw', 'pitch', 'onGround']) });
        once('packet', `dropped ${problem}: the server kicks for it (invalid_player_movement)`);
        if (bot.entity?.position) repair('outgoing packet');
        return false;
    };

    return { guardWrite, stats, trace };
}
