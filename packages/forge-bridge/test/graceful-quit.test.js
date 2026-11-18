// graceful-quit.js: SIGTERM/SIGINT in the agent process quits the server
// connection and exits 0 (CX23 runs: a systemctl stop reset the connection).
// Offline: fake process objects, and one real child on a localhost socket.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setImmediate } from 'node:timers';
import { Buffer } from 'node:buffer';
import { installGracefulQuit, recordAgentExit, readExitReason, EXIT } from '../index.js';

function fakeProc() {
    const proc = new EventEmitter();
    proc.exits = [];
    proc.exit = (c) => proc.exits.push(c);
    return proc;
}

function fakeBot(io) {
    const bot = new EventEmitter();
    bot.quits = [];
    bot._client = { ended: false };
    bot.quit = (reason) => { bot.quits.push(reason); };
    bot.forge = {};
    bot.forge.recordExit = (o = {}) => recordAgentExit({ ...o, stopSignal: bot.forge.stopSignal ?? null }, io);
    return bot;
}

const tick = () => new Promise((r) => setImmediate(r));

function reasonIo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graceful-quit-'));
    const file = path.join(dir, 'reason.json');
    return { io: { env: { MINDCRAFT_EXIT_REASON_FILE: file } }, file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('SIGTERM quits the connection, records a clean stop and exits 0 when the connection has closed', async () => {
    const r = reasonIo();
    try {
        const proc = fakeProc();
        const timers = [];
        const lines = [];
        const bot = fakeBot(r.io);
        const gq = installGracefulQuit(bot, { proc, log: (m) => lines.push(m), setTimer: (fn, ms) => { timers.push({ fn, ms }); } });
        proc.emit('SIGTERM', 'SIGTERM');
        assert.deepEqual(bot.quits, ['disconnect.quitting']);
        assert.equal(bot.forge.stopSignal, 'SIGTERM');
        assert.equal(gq.stopping, 'SIGTERM');
        assert.deepEqual(readExitReason(r.file), { category: 'stop_signal', exitCode: 0, fatal: false });
        assert.deepEqual(timers.map(t => t.ms), [3000]);
        proc.emit('SIGTERM', 'SIGTERM'); // the main process forwards the same signal
        assert.equal(bot.quits.length, 1, 'one quit');
        assert.deepEqual(proc.exits, []);
        bot.emit('end', 'disconnect.quitting');
        await tick();
        assert.deepEqual(proc.exits, [0]);
        assert.ok(lines.some(l => /^\[forge-bridge\] SIGTERM: quitting the server connection, exiting within 3 s$/.test(l)));
        gq.dispose();
        assert.equal(proc.listenerCount('SIGTERM'), 0);
    } finally { r.cleanup(); }
});

test('SIGINT: the deadline exits if the connection never closes; a throwing quit or an ended client exits at once', () => {
    const proc = fakeProc();
    const timers = [];
    const bot = fakeBot({ env: {} });
    const gq = installGracefulQuit(bot, { proc, log: () => {}, setTimer: (fn, ms) => { timers.push({ fn, ms }); } });
    proc.emit('SIGINT', 'SIGINT');
    assert.deepEqual(proc.exits, []);
    timers[0].fn();
    assert.deepEqual(proc.exits, [0]);
    gq.dispose();

    const p2 = fakeProc();
    const thrower = fakeBot({ env: {} });
    thrower.quit = () => { throw new Error('socket gone'); };
    installGracefulQuit(thrower, { proc: p2, log: () => {}, setTimer: () => {} });
    p2.emit('SIGTERM', 'SIGTERM');
    assert.deepEqual(p2.exits, [0]);

    const p3 = fakeProc();
    const ended = fakeBot({ env: {} });
    ended._client.ended = true;
    installGracefulQuit(ended, { proc: p3, log: () => {}, setTimer: () => {} });
    p3.emit('SIGTERM', 'SIGTERM');
    assert.deepEqual(ended.quits, [], 'nothing to quit');
    assert.deepEqual(p3.exits, [0]);
});

test('one listener per signal per process; the newest bot is the one quit', () => {
    const proc = fakeProc();
    const first = fakeBot({ env: {} });
    const second = fakeBot({ env: {} });
    const g1 = installGracefulQuit(first, { proc, log: () => {}, setTimer: () => {} });
    installGracefulQuit(second, { proc, log: () => {}, setTimer: () => {} });
    assert.equal(proc.listenerCount('SIGTERM'), 1);
    assert.equal(proc.listenerCount('SIGINT'), 1);
    g1.dispose(); // not the current bot: keeps the handler
    assert.equal(proc.listenerCount('SIGTERM'), 1);
    proc.emit('SIGTERM', 'SIGTERM');
    assert.deepEqual(first.quits, []);
    assert.deepEqual(second.quits, ['disconnect.quitting']);
});

test('recordAgentExit: a stop signal is a clean stop, whatever else the exit path reports', () => {
    for (const o of [{}, { event: 'Disconnected', reason: 'disconnect.quitting' }, { error: Object.assign(new Error('x'), { exitCode: 3 }) }, { requestedRestart: true }]) {
        assert.equal(recordAgentExit({ ...o, stopSignal: 'SIGTERM' }, { env: {} }), EXIT.CLEAN, JSON.stringify(o));
    }
    assert.equal(recordAgentExit({ event: 'Disconnected' }, { env: {} }), EXIT.TRANSIENT, 'without a signal: unchanged');
});

test('end to end: SIGTERM to a real child closes its TCP connection with a FIN (no reset) and the child exits 0', async () => {
    const r = reasonIo();
    const server = net.createServer();
    const seen = { end: false, error: null, data: 0 };
    let stream;
    server.on('connection', (sock) => {
        sock.on('data', () => { seen.data++; });
        sock.on('end', () => { seen.end = true; sock.end(); });
        sock.on('error', (e) => { seen.error = e.code; });
        // The server keeps sending, as a Minecraft server streams chunks and entities.
        stream = setInterval(() => { if (!sock.destroyed && sock.writable) sock.write(Buffer.alloc(512, 1)); }, 5);
    });
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const port = server.address().port;
    const gq = new URL('../src/graceful-quit.js', import.meta.url).href;
    const contract = new URL('../src/exit-contract.js', import.meta.url).href;
    // The child stands in for initBot + agent.js: a "bot" whose quit ends the socket and
    // whose 'end' fires when the socket closes, as minecraft-protocol's client does.
    const child = [
        `import net from 'node:net';`,
        `import { EventEmitter } from 'node:events';`,
        `import { installGracefulQuit } from ${JSON.stringify(gq)};`,
        `import { recordAgentExit } from ${JSON.stringify(contract)};`,
        `const bot = new EventEmitter();`,
        `bot.forge = {};`,
        `bot.forge.recordExit = (o = {}) => recordAgentExit({ ...o, stopSignal: bot.forge.stopSignal ?? null });`,
        `const sock = net.connect(${port}, '127.0.0.1', () => { process.stdout.write('ready\\n'); setInterval(() => sock.writable && sock.write('k'), 20); });`,
        `sock.on('data', () => {});`,
        `sock.on('close', () => bot.emit('end', 'disconnect.quitting'));`,
        `bot._client = { get ended() { return sock.destroyed; } };`,
        `bot.quit = () => sock.end();`,
        `installGracefulQuit(bot);`,
    ].join('\n');
    try {
        const proc = spawn(process.execPath, ['--input-type=module', '-e', child], {
            env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, MINDCRAFT_EXIT_REASON_FILE: r.file },
            stdio: ['ignore', 'pipe', 'inherit'],
        });
        await new Promise((res) => proc.stdout.on('data', (d) => { if (String(d).includes('ready')) res(); }));
        await new Promise((res) => setTimeout(res, 100)); // unread data is in flight both ways
        const exited = new Promise((res) => proc.on('exit', (code, signal) => res({ code, signal })));
        proc.kill('SIGTERM');
        const { code, signal } = await exited;
        await new Promise((res) => setTimeout(res, 50));
        assert.deepEqual({ code, signal }, { code: 0, signal: null });
        assert.equal(seen.end, true, 'the server saw a FIN');
        assert.equal(seen.error, null, 'no ECONNRESET on the server side');
        assert.ok(seen.data > 0);
        assert.deepEqual(readExitReason(r.file), { category: 'stop_signal', exitCode: 0, fatal: false });
    } finally {
        clearInterval(stream);
        server.close();
        r.cleanup();
    }
});
