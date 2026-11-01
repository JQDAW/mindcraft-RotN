import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyKick, chatToText, classifySocketError, createRestartPolicy, EXIT } from '../src/kicks.js';
import { CaptureWriter, readCapture, redactBuffer } from '../src/capture.js';
import { throttleMovement, mergeMovement } from '../src/movement-throttle.js';
import { tmpFile } from './helpers.js';

test('chat components flatten to text', () => {
    assert.equal(chatToText('{"text":"Server Mod rejections:\\n","extra":[{"text":"pyrotech: Requires 1.5.25"}]}'),
        'Server Mod rejections:\npyrotech: Requires 1.5.25');
    assert.equal(chatToText({ translate: 'multiplayer.disconnect.not_whitelisted' }), 'multiplayer.disconnect.not_whitelisted');
    assert.equal(chatToText('plain text'), 'plain text');
    assert.equal(chatToText('"quoted"'), 'quoted');
});

test('kicks are classified per fml-spec section 4 and the ADR 0003 exit codes', () => {
    const cases = [
        ['{"text":"Server Mod rejections:\\nfoo: Requires 1.0 but client has 2.0"}', 'mod_rejection', true],
        ['This server has mods that require FML/Forge to be installed on the client. Contact your server admin for more details.', 'vanilla_client_rejected', true],
        ['This is modded. No modded response received. Bye!', 'vanilla_client_rejected', true],
        ['You are not white-listed on this server!', 'not_whitelisted', true],
        ['You are banned from this server.', 'banned', true],
        ['{"translate":"multiplayer.disconnect.banned.reason","with":["griefing"]}', 'banned', true],
        ['Your IP address is banned from this server.', 'banned', true],
        ['Banned items in your inventory: bedrock', 'other', false],
        ['3 players were banned today, you were kicked to make room', 'other', false],
        ['Failed to verify username!', 'auth', false],
        ['Invalid session (Try restarting your game)', 'auth', false],
        ['Server is still starting! Please wait before reconnecting.', 'server_starting', false],
        ['Server closed', 'server_stopping', false],
        ['You logged in from another location', 'duplicate_login', false],
        ['Timed out', 'timeout', false],
        ['Internal Exception: java.io.IOException: An existing connection was forcibly closed', 'server_exception', false],
        ['Too many invasion mobs nearby', 'other', false],
    ];
    for (const [reason, category, fatal] of cases) {
        const c = classifyKick(reason);
        assert.equal(c.category, category, reason);
        assert.equal(c.fatal, fatal, reason);
        assert.equal(c.exitCode, fatal ? EXIT.FATAL : EXIT.TRANSIENT, reason);
    }
    assert.equal(classifySocketError({ code: 'ECONNRESET', message: 'read ECONNRESET' }).exitCode, EXIT.TRANSIENT);
});

test('auth kicks are transient up to a retry cap, then fatal', () => {
    const p = createRestartPolicy();
    const auth = classifyKick('Failed to verify username!');
    assert.equal(auth.retryCap, 3);
    assert.deepEqual([p.next(auth), p.next(auth)].map(r => [r.restart, r.delayMs]), [[true, 10000], [true, 20000]]);
    const third = p.next(auth);
    assert.equal(third.restart, false);
    assert.equal(third.exitCode, EXIT.FATAL);
    // A different kick in between resets the streak; a long session resets everything.
    const q = createRestartPolicy();
    q.next(auth); q.next(auth); q.next(classifyKick('Timed out'));
    assert.equal(q.next(auth).restart, true);
    assert.equal(q.next(auth, 11 * 60_000).delayMs, 10000);
});

test('restart backoff doubles from 10 s, caps at 5 min, and never restarts fatal or clean exits', () => {
    const p = createRestartPolicy();
    const t = classifyKick('Timed out');
    const delays = Array.from({ length: 8 }, () => p.next(t).delayMs);
    assert.deepEqual(delays, [10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000]);
    assert.equal(p.next(t, 600_000).delayMs, 10000);
    assert.equal(p.next(classifyKick('You are banned from this server.')).restart, false);
    assert.equal(p.next({ category: 'clean', fatal: false, exitCode: EXIT.CLEAN }).restart, false);
});

test('redaction replaces username and UUID forms with same-length placeholders', () => {
    const uuid = '0123456789abcdef0123456789abcdef';
    const dashed = '01234567-89ab-cdef-0123-456789abcdef';
    const raw = Buffer.from(uuid, 'hex');
    const buf = Buffer.concat([Buffer.from(`hi FRCFLD ${dashed} ${uuid.toUpperCase()} `), raw, Buffer.from(' FRCFLD')]);
    const out = redactBuffer(buf, { username: 'FRCFLD', uuid: dashed });
    assert.equal(out.length, buf.length);
    const s = out.toString('latin1');
    assert.ok(!s.includes('FRCFLD'));
    assert.ok(!s.includes(dashed));
    assert.ok(!s.toLowerCase().includes(uuid));
    assert.equal(out.indexOf(raw), -1);
    assert.ok(s.includes('XXXXXX'));
    assert.equal(redactBuffer(Buffer.from('nothing'), { username: 'FRCFLD' }).toString(), 'nothing');
});

test('capture writes redacted JSONL and honours per-packet limits', () => {
    const file = tmpFile('cap.jsonl');
    const cap = new CaptureWriter({ file, redact: { username: 'FRCFLD' }, packetLimits: { set_slot: 2 } });
    cap.payload('S2C', 'FML|HS', Buffer.from([0x00, 0x02, 0, 0, 0, 0]), { decoded: { type: 'ServerHello' } });
    cap.payload('S2C', 'somemod', Buffer.from('player FRCFLD joined'));
    assert.equal(cap.packet('S2C', 'set_slot', Buffer.from([1])), true);
    assert.equal(cap.packet('S2C', 'set_slot', Buffer.from([2])), true);
    assert.equal(cap.packet('S2C', 'set_slot', Buffer.from([3])), false);
    cap.event('kick', { text: 'bye FRCFLD' });
    cap.close();
    const lines = readCapture(file);
    assert.equal(lines.length, 6);
    assert.equal(lines[0].channel, 'FML|HS');
    assert.equal(lines[0].disc, 0);
    assert.equal(Buffer.from(lines[1].b64, 'base64').toString(), 'player XXXXXX joined');
    assert.equal(lines[4].text, 'bye XXXXXX');
    assert.equal(lines[5].name, 'capture_closed');
    assert.ok(!JSON.stringify(lines).includes('FRCFLD'));
});

test('mergeMovement keeps the newest position and look', () => {
    const pos = (x) => ({ name: 'position', data: { x, y: 64, z: 0, onGround: true } });
    const look = (yaw) => ({ name: 'look', data: { yaw, pitch: 0, onGround: false } });
    assert.deepEqual(mergeMovement(pos(1), pos(2)), pos(2));
    assert.deepEqual(mergeMovement(pos(1), look(90)), { name: 'position_look', data: { x: 1, y: 64, z: 0, yaw: 90, pitch: 0, onGround: false } });
    assert.deepEqual(mergeMovement(look(10), look(20)).data.yaw, 20);
});

test('throttleMovement sends the newest packet in each window, never the oldest', () => {
    let t = 1000;
    const timers = [];
    const sent = [];
    const write = throttleMovement((name, data) => { sent.push([name, data.x ?? null, data.yaw ?? null]); return true; }, {
        intervalMs: 50, now: () => t, setTimer: (fn, ms) => { timers.push({ fn, at: t + ms }); return timers.length; }, clearTimer: () => {},
    });
    write('position', { x: 1, y: 0, z: 0, onGround: true });   // goes out now
    t += 10; write('position', { x: 2, y: 0, z: 0, onGround: true }); // queued
    t += 10; write('position', { x: 3, y: 0, z: 0, onGround: true }); // replaces 2
    t += 5; write('look', { yaw: 45, pitch: 0, onGround: true });     // merged in
    write('chat', { message: 'hi' });                                  // not throttled
    assert.deepEqual(sent, [['position', 1, null], ['chat', null, null]]);
    t = timers[0].at; timers[0].fn();
    assert.deepEqual(sent[2], ['position_look', 3, 45]);
    t += 100; write('position', { x: 4, y: 0, z: 0, onGround: true });
    assert.deepEqual(sent[3], ['position', 4, null]);
    assert.equal(timers.length, 1);
});
