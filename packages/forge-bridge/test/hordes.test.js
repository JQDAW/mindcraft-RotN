// The Hordes 1.1.7 'hordes_hordeevent' channel: golden byte vectors written by
// hand from the jar's layout (see the header of src/hordes.js for the javap
// offsets), not from an encoder of ours, and the path from a custom_payload to
// bot.emit('rotn:horde').
//
// SimpleNetworkWrapper: one discriminator byte, then the message's toBytes.
// - disc 0 HordeSoundMessage: double x, double z (big-endian), UTF-8 string sound
// - disc 1 SimpleStringMessage: UTF-8 string text
// ByteBufUtils.writeUTF8String: VarInt byte length, then the bytes.

import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachForgeBridge } from '../src/bridge.js';
import { WireError } from '../src/wire.js';
import { decodeHordes, hordeEvent, attachHordeEvents, HORDES_CHANNEL } from '../src/hordes.js';
import { pinnedModList } from './helpers.js';

const hex = (s) => Buffer.from(s.replace(/\s+|\/\/[^\n]*/g, ''), 'hex');

const START = hex(`
    01                                                  // disc 1 SimpleStringMessage
    19                                                  // 25 bytes
    6d6573736167652e686f726465732e4576656e745374617274  // "message.hordes.EventStart"
`);
const END = hex(`
    01                                                  // disc 1 SimpleStringMessage
    17                                                  // 23 bytes
    6d6573736167652e686f726465732e4576656e74456e64      // "message.hordes.EventEnd"
`);
const WAVE = hex(`
    00                                                  // disc 0 HordeSoundMessage
    3fe3333333333333                                    // x = 0.6
    bfe999999999999a                                    // z = -0.8
    12                                                  // 18 bytes
    686f726465733a686f7264655f737061776e                // "hordes:horde_spawn"
`);

test('golden horde start and end notifications (disc 1)', () => {
    assert.deepEqual(decodeHordes(START), { type: 'Notification', disc: 1, text: 'message.hordes.EventStart' });
    assert.deepEqual(hordeEvent(decodeHordes(START)), { kind: 'start', key: 'message.hordes.EventStart' });
    assert.deepEqual(hordeEvent(decodeHordes(END)), { kind: 'end', key: 'message.hordes.EventEnd' });
});

test('golden wave sound with its spawn direction (disc 0)', () => {
    assert.deepEqual(decodeHordes(WAVE), { type: 'Sound', disc: 0, direction: { x: 0.6, z: -0.8 }, sound: 'hordes:horde_spawn' });
    assert.deepEqual(hordeEvent(decodeHordes(WAVE)), { kind: 'wave', sound: 'hordes:horde_spawn', direction: { x: 0.6, z: -0.8 } });
});

test('a changed message text (multi-byte UTF-8) is kind "message"; unknown discriminators give no event', () => {
    const text = 'Die Horde kommt — lauf!';
    const body = Buffer.from(text, 'utf8');
    const msg = decodeHordes(Buffer.concat([Buffer.from([0x01, body.length]), body]));
    assert.deepEqual(hordeEvent(msg), { kind: 'message', key: text });
    const unknown = decodeHordes(hex('02 aabb'));
    assert.equal(unknown.type, 'Unknown');
    assert.ok(unknown.raw.equals(hex('aabb')));
    assert.equal(hordeEvent(unknown), null);
});

test('short payloads throw WireError', () => {
    assert.throws(() => decodeHordes(Buffer.alloc(0)), WireError);
    assert.throws(() => decodeHordes(START.subarray(0, 10)), WireError);
    assert.throws(() => decodeHordes(WAVE.subarray(0, 12)), WireError);
});

function setup() {
    const client = new EventEmitter();
    client.write = () => true;
    client.setSerializer = function () { this.deserializer = { parsePacketBuffer: () => ({ data: {}, metadata: { size: 0 } }) }; };
    const logs = [];
    const bridge = attachForgeBridge(client, { modList: pinnedModList(), log: (m) => logs.push(m) });
    const bot = new EventEmitter();
    const botLogs = [];
    const hordes = attachHordeEvents(bot, bridge, { log: (m) => botLogs.push(m) });
    const events = [];
    bot.on('rotn:horde', (ev) => events.push(ev));
    const play = (data) => client.emit('packet', { channel: HORDES_CHANNEL, data }, { name: 'custom_payload', state: 'play' }, null, null);
    return { bridge, bot, hordes, events, logs, botLogs, play };
}

test('a custom_payload on hordes_hordeevent reaches bot.emit("rotn:horde")', () => {
    const { bridge, hordes, events, play } = setup();
    play(START);
    play(WAVE);
    play(END);
    assert.deepEqual(events.map(e => e.kind), ['start', 'wave', 'end']);
    assert.deepEqual(events[1].direction, { x: 0.6, z: -0.8 });
    assert.equal(bridge.stats.hordeMessages, 3);
    assert.equal(hordes.emitted, 3);
});

test('short and unknown payloads are logged, not thrown, and emit nothing', () => {
    const { events, logs, play } = setup();
    assert.doesNotThrow(() => play(START.subarray(0, 10)));
    assert.doesNotThrow(() => play(hex('07 00')));
    assert.equal(events.length, 0);
    assert.ok(logs.some(l => l.startsWith(`decode error on ${HORDES_CHANNEL}`)), logs.join('\n'));
    assert.ok(logs.some(l => l.includes('unknown discriminator 7')), logs.join('\n'));
});

test('a throwing rotn:horde listener is logged and does not break the bridge', () => {
    const { bot, events, botLogs, play } = setup();
    bot.prependOnceListener('rotn:horde', () => { throw new Error('skill bug'); });
    assert.doesNotThrow(() => play(START));
    assert.ok(botLogs.some(l => l.includes('start listener threw: skill bug')), botLogs.join('\n'));
    play(END); // the next message still arrives
    assert.equal(events.length, 1);
    assert.equal(events.at(-1).kind, 'end');
});
