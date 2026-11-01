// tools/g1-driver.mjs against the in-process fake Forge server, the way
// harness-ops' runner drives it (test/runner/DRIVER.md): hello once, echo a
// token, walk on request, stop cleanly on SIGTERM. Offline: loopback only,
// ROTN_DRIVER_AUTH=offline, no token cache.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
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
                // The fake world has one chunk: don't wait 30 s for the rest of the census cube.
                ROTN_DRIVER_CHUNK_WAIT_MS: '0',
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
    // walk() may report its own method (harness-ops adds 'forward+jump+turn'); the driver passes it on, else names the function.
    assert.equal(walked.walkMethod, walked.method ?? 'scenario-protocol walk()', 'the method comes from the scenario, not the driver');
    assert.equal(walked.blockBelow?.registryName, 'minecraft:stone');
    const forge = events().find(e => e.type === 'forge');
    assert.equal(forge.handshakeDone, true);
    assert.deepEqual(forge.blockNamespaces, { minecraft: 3, pyrotech: 2 });

    // G2 scenario protocol (DRIVER.md), through the agent's own naming path on Mindcraft's real initBot.
    const adapter = await until(() => events().find(e => e.type === 'g2_adapter'), 15000, 'g2_adapter event');
    assert.match(adapter.source, /src\/utils\/mcdata\.js/);
    assert.equal(adapter.translation, true, 'mcdata.js exports toNew/toOld (rotn-data #44)');
    assert.deepEqual([adapter.chunkWaitMs, adapter.chunkWaitSource], [0, 'ROTN_DRIVER_CHUNK_WAIT_MS'], 'the effective census chunk wait is logged');
    const reply = async (kind, token) => {
        const lines = await until(() => {
            const got = server.state.chats.filter(c => c.startsWith(`${kind} ${token} `));
            const total = got.length ? Number(/ \d+\/(\d+)/.exec(got[0])[1]) : 0;
            return got.length && got.length === total ? got : null;
        }, 60000, `${kind} reply`);
        return lines.join(' ');
    };
    say('[Server] whispers: scenario-blocks aaaaaa01 16 50 2');
    const census = await reply('blocks', 'aaaaaa01');
    assert.match(census, /minecraft:stone 0 \d+/, census);
    assert.match(census, /pyrotech:rock 3 1 0,64,0/, 'the modded block is named from bot.registry (forge-bridge extension)');
    // The fake world has one chunk, so most of the radius-16 cube is unloaded. The census (#57)
    // counts those positions apart, in a first "#unloaded U T" entry, never as a block type.
    const entries = census.split(/(?:^| )blocks aaaaaa01 \d+\/\d+ ?/).filter(Boolean).join('; ').split('; ');
    const types = entries.map((e) => e.split(' ')[0]);
    assert.ok(entries[0].startsWith('#unloaded '), `the first census entry is "#unloaded U T": ${entries[0]}`);
    const [, u, t] = entries[0].split(' ').map(Number);
    assert.equal(t, 33 ** 3, entries[0]);
    assert.ok(u > 0 && u < t, `some positions are unloaded in the fake world: ${entries[0]}`);
    assert.ok(!types.includes('null'), 'unloaded positions are never a "null" type');
    assert.deepEqual(types.slice(1).sort(), ['minecraft:stone', 'pyrotech:rock'], 'every other entry is a named block type');
    assert.doesNotMatch(census, /minecraft:air|unknown/);
    say('[Server] whispers: scenario-blockat bbbbbb02 0,64,0 5,64,5');
    const at = await reply('blockat', 'bbbbbb02');
    assert.match(at, /0 64 0 pyrotech:rock 3/);
    assert.match(at, /5 64 5 minecraft:stone 0/);
    say('[Server] whispers: scenario-entities cccccc03 32');
    const ents = await reply('entities', 'cccccc03');
    assert.match(ents, /iceandfire:entity_4 10(\.0+)? 65(\.0+)? 10(\.0+)?/, 'the FML-spawned mob is reported (placeholder name until rotn-data\'s table)');
    say('[Server] whispers: scenario-items dddddd04');
    const items = await reply('items', 'dddddd04');
    assert.match(items, /36 minecraft:stone 0 /, items);
    assert.match(items, /pyrotech:crude_axe/);

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

test('g1-driver exits 3 on a bad ROTN_DRIVER_CHUNK_WAIT_MS, before connecting anywhere', () => {
    const r = spawnSync(process.execPath, [DRIVER], {
        env: driverEnv({ TEST_SERVER_HOST: '127.0.0.1', TEST_SERVER_PORT: '1', ROTN_DRIVER_AUTH: 'offline', ROTN_DRIVER_CHUNK_WAIT_MS: '-5' }),
        encoding: 'utf8', timeout: 120000,
    });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stdout, /DRIVER .*"type":"fatal".*ROTN_DRIVER_CHUNK_WAIT_MS must be a whole number/);
});

test('g1-driver exits 1, not 0, when it cannot join, and says beforeJoin (G2 batch 2)', async () => {
    // A loopback port that was just freed: the connect is refused before any login.
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const r = spawnSync(process.execPath, [DRIVER], {
        env: driverEnv({ TEST_SERVER_HOST: '127.0.0.1', TEST_SERVER_PORT: String(port), ROTN_DRIVER_AUTH: 'offline', ROTN_DRIVER_CAPTURE: '0', ROTN_DRIVER_PING_TIMEOUT_MS: '2000' }),
        encoding: 'utf8', timeout: 120000,
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const end = r.stdout.split('\n').filter((l) => l.startsWith('DRIVER ')).map((l) => JSON.parse(l.slice(7))).find((e) => e.type === 'end');
    assert.ok(end, r.stdout);
    assert.deepEqual([end.exitCode, end.joined, end.beforeJoin], [1, false, true]);
});
