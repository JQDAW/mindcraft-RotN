// initBot's auth guard (src/utils/mcdata.js + src/auth-guard.js). With
// "microsoft" it refuses to start without the bot's own token-cache folder, with
// that folder inside a git work tree, or with DEBUG enabling prismarine-auth's
// token-printing output. Each refusal throws before any bot, socket or login
// exists. "offline" without a folder still starts. Offline: loopback only.

import process from 'node:process';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let setSettings;
let initBot;

before(async () => {
    process.env.FORGE_BRIDGE = 'off';
    ({ setSettings } = await import('../../../src/agent/settings.js'));
    ({ initBot } = await import('../../../src/utils/mcdata.js'));
});

function microsoft({ folder, debug }) {
    if (folder === undefined) delete process.env.MINDCRAFT_PROFILES_FOLDER; else process.env.MINDCRAFT_PROFILES_FOLDER = folder;
    if (debug === undefined) delete process.env.DEBUG; else process.env.DEBUG = debug;
    setSettings({ host: '127.0.0.1', port: 1, auth: 'microsoft', minecraft_version: '1.12.2' });
}

test('microsoft without MINDCRAFT_PROFILES_FOLDER throws a clear error', () => {
    microsoft({});
    assert.throws(() => initBot('FRCFLD'), /auth is "microsoft" but MINDCRAFT_PROFILES_FOLDER is not set/);
});

test('microsoft with the folder inside this repo throws, and creates nothing', () => {
    const inside = path.join(HERE, 'fixtures', 'must-not-exist-cache');
    microsoft({ folder: inside });
    assert.throws(() => initBot('FRCFLD'), /MINDCRAFT_PROFILES_FOLDER: .*inside the git work tree/);
    assert.equal(fs.existsSync(inside), false);
});

test('microsoft with DEBUG enabling prismarine-auth throws (it would print tokens)', () => {
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-bridge-initbot-')), 'msa');
    for (const debug of ['*', 'prismarine*', 'minecraft-protocol,prismarine-auth']) {
        microsoft({ folder: outside, debug });
        assert.throws(() => initBot('FRCFLD'), /refusing Microsoft auth because DEBUG enables "prismarine-auth"/, `DEBUG=${debug}`);
    }
    delete process.env.DEBUG;
});

test('offline without a folder still starts', async () => {
    delete process.env.MINDCRAFT_PROFILES_FOLDER;
    delete process.env.DEBUG;
    setSettings({ host: '127.0.0.1', port: 1, auth: 'offline', minecraft_version: '1.12.2' });
    const bot = initBot('FRCFLD');
    assert.ok(bot?._client, 'a bot and its client exist');
    assert.equal(typeof bot.forge.recordExit, 'function', 'initBot gives agent.js its exit-reason hook');
    // Port 1 refuses the connection: the bot got as far as connecting.
    const err = await new Promise((resolve) => { bot.once('error', resolve); bot.once('end', () => resolve(null)); });
    if (err) assert.equal(err.code, 'ECONNREFUSED');
    // nmp leaves a 30 s close timer after end(): clear it so the test exits promptly.
    try { bot.end(); bot._client.socket?.destroy(); } catch { /* already ended */ }
    clearTimeout(bot._client.closeTimer);
    // Not connected any more: a cleanKill exit reports the disconnect, not a requested restart.
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'initbot-exit-')), 'reason.json');
    process.env.MINDCRAFT_EXIT_REASON_FILE = file;
    try {
        assert.equal(bot.forge.recordExit({ requestedRestart: true }), 1);
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).category, 'disconnect');
    } finally {
        delete process.env.MINDCRAFT_EXIT_REASON_FILE;
    }
});
