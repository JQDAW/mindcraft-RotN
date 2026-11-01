// tools/g1-driver.mjs against the in-process fake Forge server, the way
// harness-ops' runner drives it (test/runner/DRIVER.md): hello once, echo a
// token, walk on request, stop cleanly on SIGTERM. Offline: loopback only,
// ROTN_DRIVER_AUTH=offline, no token cache.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { startFakeForgeServer } from './fake-forge-server.js';
import { joinFakeWorld } from './fake-world.js';
import { pinnedModList, syntheticRegistries, tmpFile } from './helpers.js';
import { readCapture } from '../src/capture.js';

const DRIVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'g1-driver.mjs');

async function until(pred, ms, what) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const v = pred();
        if (v) return v;
        await sleep(50);
    }
    throw new Error(`${what}: not within ${ms} ms`);
}

// Only what the runner's allowlist would pass (lib/adapters.mjs driverEnv).
function driverEnv(extra) {
    const keep = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'APPDATA', 'LOCALAPPDATA'];
    const env = {};
    for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
    return { ...env, ...extra };
}

let server;
let child;
after(async () => {
    try { child?.kill('SIGKILL'); } catch { /* gone */ }
    await server?.close();
});

test('g1-driver: hello, echo, walk and a clean SIGTERM stop through forge-bridge', { timeout: 300000 }, async () => {
    server = await startFakeForgeServer({ modList: pinnedModList(), registries: syntheticRegistries(), reid: true, onJoin: joinFakeWorld });
    const captureFile = tmpFile('driver-capture.jsonl');
    let out = [];
    let exited;
    const startDriver = () => {
        out = [];
        child = spawn(process.execPath, [DRIVER], {
            env: driverEnv({
                TEST_SERVER_HOST: '127.0.0.1', TEST_SERVER_PORT: String(server.port),
                ROTN_SCENARIO_BOT: 'FRCFLD', ROTN_SCENARIO_HELLO: 'hello-nonce-1234', ROTN_SCENARIO_RUN: 'test',
                ROTN_DRIVER_AUTH: 'offline', ROTN_DRIVER_CAPTURE: captureFile, ROTN_DRIVER_PING_TIMEOUT_MS: '60000',
            }),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', (b) => out.push(b.toString()));
        child.stderr.on('data', (b) => out.push(b.toString()));
        let done = null;
        exited = new Promise((resolve) => child.on('exit', (code, signal) => { done = { code, signal }; resolve(done); }));
        return () => done;
    };
    const events = () => out.join('').split('\n').filter(l => l.startsWith('DRIVER ')).map(l => JSON.parse(l.slice(7)));

    // One retry: under heavy load a loopback connect can fail at once (ETIMEDOUT) and
    // the driver exits 1 before it says hello. That is not the behaviour under test.
    for (let attempt = 1; ; attempt++) {
        const hasExited = startDriver();
        await until(() => server.state.chats.includes('hello-nonce-1234') || hasExited(), 150000, 'hello in chat');
        if (server.state.chats.includes('hello-nonce-1234')) break;
        if (attempt === 2) assert.fail(`driver exited before hello twice: ${JSON.stringify(hasExited())}\n${out.join('').slice(-2000)}`);
        await sleep(2000);
    }
    assert.equal(server.state.hsState, 'DONE', 'FML handshake completed');
    assert.ok(server.state.serverHost.endsWith('\0FML\0'));

    const say = (text) => server.state.client.write('chat', { message: JSON.stringify({ text }), position: 1 });
    say('[Server] whispers: scenario-echo 0a1b2c3d');
    await until(() => server.state.chats.includes('echo 0a1b2c3d'), 60000, 'echo');

    const before = server.state.positions.length;
    say('scenario-walk 3');
    const walkedLine = await until(() => server.state.chats.find(c => c.startsWith('walked ')), 90000, 'walked reply');
    const [x, , z] = walkedLine.split(' ').slice(1).map(Number);
    assert.ok(Math.hypot(x - 8.5, z - 8.5) >= 3, `walked to ${walkedLine}`);
    assert.ok(server.state.positions.length > before, 'server received movement');
    assert.equal(server.state.chats.filter(c => c === 'hello-nonce-1234').length, 1, 'hello said exactly once');

    const walked = await until(() => events().find(e => e.type === 'walked'), 15000, 'walked event');
    assert.equal(walked.walkMethod, 'scenario-protocol walk()', 'the method comes from the scenario, not the driver');
    assert.equal(walked.blockBelow?.registryName, 'minecraft:stone');
    const forge = events().find(e => e.type === 'forge');
    assert.equal(forge.handshakeDone, true);
    assert.deepEqual(forge.blockNamespaces, { minecraft: 3, pyrotech: 2 });

    child.kill('SIGTERM');
    const { code, signal } = await exited;
    // Windows has no SIGTERM handler delivery: kill() terminates the process.
    if (process.platform !== 'win32') assert.equal(code, 0, `exit ${code} ${signal}`);
    const cap = readCapture(captureFile);
    assert.ok(cap.some(l => l.kind === 'event' && l.name === 'hs_complete'));
    assert.ok(!JSON.stringify(cap).includes('FRCFLD'), 'capture redacted');
});

test('g1-driver exits 3 without a token-cache folder, before connecting anywhere', () => {
    const r = spawnSync(process.execPath, [DRIVER], {
        env: driverEnv({ TEST_SERVER_HOST: '127.0.0.1', TEST_SERVER_PORT: '1', ROTN_SCENARIO_BOT: 'FRCFLD' }),
        encoding: 'utf8', timeout: 120000,
    });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stdout, /DRIVER .*"type":"fatal".*MINDCRAFT_PROFILES_FOLDER is not set/);
});

test('g1-driver exits 3 without TEST_SERVER_HOST', () => {
    const r = spawnSync(process.execPath, [DRIVER], { env: driverEnv({ ROTN_DRIVER_AUTH: 'offline' }), encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 3);
});
