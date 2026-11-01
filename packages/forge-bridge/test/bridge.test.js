// attachForgeBridge on a minimal fake nmp client: capture redaction on every
// raw-bytes path, and FML|MP re-emission.

import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { attachForgeBridge } from '../src/bridge.js';
import { CaptureWriter, readCapture } from '../src/capture.js';
import { encodeMultipart, PART_SIZE } from '../src/channels.js';
import { Writer } from '../src/wire.js';
import { pinnedModList, tmpFile } from './helpers.js';

const NAME = 'FRCFLD';
const UUID = '0123456789abcdef0123456789abcdef';

function setup(parse) {
    const client = new EventEmitter();
    client.write = () => true;
    client.setSerializer = function () { this.deserializer = { parsePacketBuffer: parse }; };
    const file = tmpFile('bridge-cap.jsonl');
    const capture = new CaptureWriter({ file, redact: { username: NAME, uuid: UUID } });
    const bridge = attachForgeBridge(client, { modList: pinnedModList(), capture, log: () => {} });
    const play = (name, data) => client.emit('packet', data, { name, state: 'play' }, null, null);
    return { client, bridge, capture, file, play };
}

function assertNoIdentity(lines) {
    const json = JSON.stringify(lines);
    assert.ok(!json.includes(NAME), 'username in JSON');
    for (const l of lines) {
        for (const b64 of JSON.stringify(l).match(/"b64":"([^"]*)"/g) ?? []) {
            const buf = Buffer.from(b64.slice(7, -1), 'base64');
            assert.equal(buf.indexOf(NAME), -1, `username inside base64 of a ${l.kind} record`);
            assert.equal(buf.indexOf(Buffer.from(UUID, 'hex')), -1, `raw UUID inside base64 of a ${l.kind} record`);
        }
    }
}

const withIdentity = Buffer.concat([Buffer.from([0x2e]), Buffer.from(`<${NAME}> hi`), Buffer.from(UUID, 'hex')]);

test('parse errors and partial packets are captured redacted', () => {
    const { client, bridge, capture, file } = setup((buf) => {
        if (buf[1] === 0x01) { const e = new Error('PartialReadError: Read error'); e.partialReadError = true; throw e; }
        return { data: { name: 'chat' }, metadata: { size: 2 } };
    });
    client.setSerializer('play');
    const bad = Buffer.concat([Buffer.from([0x0f, 0x01]), withIdentity]);
    assert.throws(() => client.deserializer.parsePacketBuffer(bad));
    client.deserializer.parsePacketBuffer(Buffer.concat([Buffer.from([0x0f, 0x02]), withIdentity]));
    capture.close();
    assert.equal(bridge.stats.partialReadErrors, 1);
    assert.equal(bridge.stats.partialPackets.chat, 1);
    const lines = readCapture(file);
    assert.ok(lines.some(l => l.kind === 'parse_error' && l.b64));
    assert.ok(lines.some(l => l.kind === 'partial_packet' && l.b64));
    assertNoIdentity(lines);
});

test('raw bytes inside decoded payloads (unknown discriminators) are captured redacted', () => {
    const { capture, file, play } = setup(() => ({ data: {}, metadata: { size: 0 } }));
    for (const channel of ['FML', 'FORGE', 'jeid']) play('custom_payload', { channel, data: Buffer.concat([Buffer.from([0x09]), withIdentity]) });
    play('custom_payload', { channel: 'somemod', data: withIdentity });
    capture.close();
    const lines = readCapture(file);
    assert.equal(lines.filter(l => l.kind === 'payload' && l.decoded?.raw).length, 3);
    assertNoIdentity(lines);
});

test('reassembled FML|MP payloads are re-emitted on the inner channel', () => {
    const { client, capture, file, play } = setup(() => ({ data: {}, metadata: { size: 0 } }));
    const inner = Buffer.alloc(PART_SIZE + 100, 7);
    const seen = [];
    client.on('custom_payload', (p) => seen.push(p));
    for (const part of encodeMultipart('somemod', inner)) play('custom_payload', { channel: 'FML|MP', data: part });
    capture.close();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].channel, 'somemod');
    assert.ok(seen[0].data.equals(inner));
    assert.equal(seen[0].viaMultipart, true);
    assert.ok(readCapture(file).some(l => l.channel === 'somemod<-FML|MP' && l.reassembled));
});

test('a capture-less bridge works (no capture writes on error paths)', () => {
    const client = new EventEmitter();
    client.write = () => true;
    client.setSerializer = function () { this.deserializer = { parsePacketBuffer: () => { const e = new Error('x'); e.partialReadError = true; throw e; } }; };
    const bridge = attachForgeBridge(client, { modList: pinnedModList(), log: () => {} });
    client.setSerializer('play');
    assert.throws(() => client.deserializer.parsePacketBuffer(new Writer().varint(0x0f).toBuffer()));
    assert.equal(bridge.stats.partialReadErrors, 1);
});

test('record() re-redacts base64 strings handed in by callers', () => {
    const file = tmpFile('b64.jsonl');
    const capture = new CaptureWriter({ file, redact: { username: NAME, uuid: UUID } });
    capture.record({ kind: 'partial_packet', b64: withIdentity.toString('base64') });
    capture.close();
    assertNoIdentity(readCapture(file));
});

test('per-channel capture limits: busy mod channels are capped, the handshake never is (review item 11)', () => {
    const file = tmpFile('limits.jsonl');
    const capture = new CaptureWriter({ file, redact: { username: NAME }, defaultChannelLimit: 5, channelLimits: { 'S2C chatty': 2 }, maxPayloadBytes: 64 });
    for (let i = 0; i < 10; i++) assert.equal(capture.payload('S2C', 'FML|HS', Buffer.from([3, i])), true);
    const kept = Array.from({ length: 10 }, () => capture.payload('S2C', 'somemod', Buffer.from([1, 2])));
    assert.deepEqual(kept, [true, true, true, true, true, false, false, false, false, false]);
    for (let i = 0; i < 4; i++) capture.payload('S2C', 'chatty', Buffer.from([0]));
    capture.payload('C2S', 'chatty', Buffer.from([0]));
    capture.payload('S2C', 'bigmod', Buffer.alloc(65, 1));
    capture.close();
    const lines = readCapture(file);
    const payloads = (ch, dir = 'S2C') => lines.filter(l => l.kind === 'payload' && l.channel === ch && l.dir === dir).length;
    assert.equal(payloads('FML|HS'), 10);
    assert.equal(payloads('somemod'), 5);
    assert.equal(payloads('chatty'), 2);
    assert.equal(payloads('chatty', 'C2S'), 1, 'limits are per direction when keyed "<dir> <channel>"');
    assert.deepEqual(lines.filter(l => l.name === 'channel_limit').map(l => l.channel), ['somemod', 'chatty']);
    const big = lines.find(l => l.channel === 'bigmod');
    assert.equal(big.b64, null);
    assert.equal(big.bytesOmitted, true);
    const closed = lines.at(-1);
    assert.equal(closed.name, 'capture_closed');
    assert.equal(closed.dropped.payloads, 7);
    assert.equal(closed.channelCounts['S2C somemod'], 10);
});

test('the capture stops at maxFileBytes but still writes its closing summary', () => {
    const file = tmpFile('full.jsonl');
    const capture = new CaptureWriter({ file, maxFileBytes: 2000, defaultChannelLimit: Infinity });
    let written = 0;
    for (let i = 0; i < 100; i++) if (capture.payload('S2C', 'somemod', Buffer.alloc(40, i))) written++;
    capture.close();
    const lines = readCapture(file);
    assert.ok(written > 0 && written < 100);
    assert.equal(lines.filter(l => l.name === 'capture_full').length, 1);
    assert.equal(lines.at(-1).name, 'capture_closed');
    assert.equal(lines.at(-1).dropped.full, 100 - written);
});

test('outgoing packets are capped per name too', () => {
    const { client, capture, file } = setup(() => ({ data: {}, metadata: { size: 0 } }));
    for (let i = 0; i < 60; i++) client.write('window_click', { windowId: 0, slot: i });
    capture.close();
    assert.equal(readCapture(file).filter(l => l.kind === 'packet' && l.name === 'window_click').length, 50);
});

test('maxFileBytes counts UTF-8 bytes, not characters', () => {
    const file = tmpFile('utf8.jsonl');
    // Each record carries 300 three-byte characters: ~900 bytes, ~300 characters.
    const capture = new CaptureWriter({ file, maxFileBytes: 2500 });
    let written = 0;
    for (let i = 0; i < 10; i++) if (capture.record({ kind: 'event', name: 'x', text: '€'.repeat(300) })) written++;
    capture.close();
    assert.equal(written, 2, 'a character count would have let 7 through');
    assert.ok(fs.statSync(file).size < 2500 + 1000, 'only the closing summary goes past the cap');
});
