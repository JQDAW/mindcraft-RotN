import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createForgeConnect } from '../src/connect.js';
import { forgeOptionsFromEnv } from '../src/env.js';
import { PING_FIXTURE } from './helpers.js';

// Just enough of an nmp client for attachForgeBridge.
function fakeClient() {
    const c = new EventEmitter();
    c.writes = [];
    c.write = (name, params) => c.writes.push({ name, params });
    c.setSerializer = () => {};
    c.setSocket = (s) => { c.socket = s; c.emit('socket_set'); };
    return c;
}

const fmlPing = JSON.parse(fs.readFileSync(PING_FIXTURE, 'utf8'));
const vanillaPing = { version: { name: '1.12.2', protocol: 340 }, description: { text: 'vanilla' } };

async function run(opts) {
    const client = fakeClient();
    let attached = null;
    const logs = [];
    const done = new Promise((resolve) => {
        client.once('socket_set', () => resolve('socket'));
        client.once('error', (e) => resolve(e));
    });
    createForgeConnect({ host: 'h', port: 1, socket: () => 'SOCKET', log: (m) => logs.push(m), onAttach: (b, src) => { attached = src; }, ...opts })(client);
    const result = await done;
    return { client, attached, logs, result };
}

test('auto: an FML ping attaches the bridge, sets tagHost and the REID overrides', async () => {
    const { client, attached, result } = await run({ ping: () => Promise.resolve(fmlPing) });
    assert.equal(result, 'socket');
    assert.equal(attached, 'ping');
    assert.equal(client.tagHost, '\0FML\0');
    assert.ok(client.customPackets['1.12'].types.slot, 'REID slot override');
    assert.equal(client.forgeBridge.modList.length, 346);
});

test('auto: a vanilla ping connects without the bridge', async () => {
    const { client, attached, result } = await run({ ping: () => Promise.resolve(vanillaPing) });
    assert.equal(result, 'socket');
    assert.equal(attached, null);
    assert.equal(client.tagHost, undefined);
});

test('a failed ping is retried once, then falls back to the pinned mod list file', async () => {
    let pings = 0;
    const { attached, logs } = await run({ ping: () => { pings++; return Promise.reject(new Error('ECONNREFUSED')); }, modListFile: PING_FIXTURE });
    assert.equal(attached, 'file');
    assert.equal(pings, 2);
    assert.ok(logs.some(l => l.includes('status ping attempt 2 failed')));
});

test('a ping that fails once and then answers uses the live mod list', async () => {
    let pings = 0;
    const { attached } = await run({ ping: (o) => { pings++; assert.equal(o.closeTimeout, 15000); return pings === 1 ? Promise.reject(new Error('ETIMEDOUT')) : Promise.resolve(fmlPing); }, modListFile: PING_FIXTURE });
    assert.equal(attached, 'ping');
    assert.equal(pings, 2);
});

test('a vanilla answer is final: no second ping', async () => {
    let pings = 0;
    await run({ ping: () => { pings++; return Promise.resolve(vanillaPing); } });
    assert.equal(pings, 1);
});

test('on: no mod list at all is an error, not a vanilla login', async () => {
    const { result, attached } = await run({ mode: 'on', ping: () => Promise.resolve(vanillaPing) });
    assert.ok(result instanceof Error);
    assert.match(result.message, /FORGE_BRIDGE=on/);
    assert.equal(attached, null);
});

test('off: no ping, no bridge', async () => {
    let pinged = false;
    const { attached } = await run({ mode: 'off', ping: () => { pinged = true; return Promise.resolve(fmlPing); } });
    assert.equal(pinged, false);
    assert.equal(attached, null);
});

test('env switches', () => {
    const now = new Date('2026-11-01T02:03:04.567Z');
    assert.deepEqual(forgeOptionsFromEnv('FRCFLD', {}, now), { mode: 'auto', captureFile: null, modListFile: null, profilesFolder: null, pingTimeoutMs: null });
    const e = forgeOptionsFromEnv('FRCFLD', { FORGE_BRIDGE: 'on', FORGE_CAPTURE: '1', FORGE_MODLIST_FILE: 'p.json', MINDCRAFT_PROFILES_FOLDER: 'C:/x/msa', FORGE_PING_TIMEOUT_MS: '60000' }, now);
    assert.deepEqual(e, { mode: 'on', captureFile: 'captures/raw/FRCFLD-2026-11-01T02-03-04-567Z.jsonl', modListFile: 'p.json', profilesFolder: 'C:/x/msa', pingTimeoutMs: 60000 });
    assert.equal(forgeOptionsFromEnv('b', { FORGE_PING_TIMEOUT_MS: 'nope' }).pingTimeoutMs, null);
    assert.equal(forgeOptionsFromEnv('b', { FORGE_BRIDGE: 'bogus', FORGE_CAPTURE: '0' }).mode, 'auto');
    assert.equal(forgeOptionsFromEnv('b', { FORGE_CAPTURE: 'C:/tmp/c.jsonl' }).captureFile, 'C:/tmp/c.jsonl');
});

test('SRV lookup follows nmp: only for port 25565 and a non-IP hostname', async () => {
    const { srvTarget } = await import('../src/connect.js');
    const srv = () => Promise.resolve([{ name: 'mc.example.net', port: 25570 }]);
    assert.deepEqual(await srvTarget('example.net', 25565, srv), { host: 'mc.example.net', port: 25570 });
    assert.deepEqual(await srvTarget('example.net', 25566, srv), { host: 'example.net', port: 25566 });
    assert.deepEqual(await srvTarget('203.0.113.5', 25565, srv), { host: '203.0.113.5', port: 25565 });
    assert.deepEqual(await srvTarget('example.net', 25565, () => Promise.reject(new Error('ENODATA'))), { host: 'example.net', port: 25565 });
});
