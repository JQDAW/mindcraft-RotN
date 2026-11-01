// src/auth-guard.js: the default device-code callback never prints the code, and
// the Microsoft-auth guard refuses unsafe setups (PR #16 review items 1-3).
// Offline: no login, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertMicrosoftAuthSafe, debugValueEnables, quietMsaCodeHandler } from '../src/auth-guard.js';
import { findGitWorkTree } from '../src/secret-folder.js';

// What prismarine-auth hands onMsaCode (the Microsoft device-code response).
const FAKE_CODE = {
    user_code: 'WXYZ-9876',
    device_code: 'DEVICECODE-not-for-printing',
    verification_uri: 'https://www.microsoft.com/link',
    message: 'To sign in, use a web browser to open the page https://www.microsoft.com/link and enter the code WXYZ-9876 to authenticate.',
    expires_in: 900,
};

function assertNoCode(text) {
    for (const v of [FAKE_CODE.user_code, FAKE_CODE.device_code, FAKE_CODE.message, FAKE_CODE.verification_uri]) {
        assert.ok(!text.includes(v), `output contains ${v}`);
    }
}

test('the default onMsaCode logs one line and never the code, message or URL', () => {
    const lines = [];
    quietMsaCodeHandler('FRCFLD', (l) => lines.push(l))(FAKE_CODE);
    assert.deepEqual(lines, ['[mcdata] FRCFLD: device-code login needed, see coord/NEEDS-HUMAN.md']);
    assertNoCode(lines.join('\n'));
});

test('the default onMsaCode writes nothing else to the console', () => {
    const out = [];
    const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    for (const k of Object.keys(saved)) console[k] = (...a) => out.push(a.join(' '));
    try {
        quietMsaCodeHandler('FRCFLD')(FAKE_CODE);
    } finally {
        Object.assign(console, saved);
    }
    assert.equal(out.length, 1);
    assert.match(out[0], /device-code login needed/);
    assertNoCode(out.join('\n'));
});

test('DEBUG values that enable prismarine-auth follow the debug package rules', () => {
    const on = ['prismarine-auth', '*', 'prismarine*', 'prismarine-*', '*auth', 'minecraft-protocol,prismarine-auth', 'mineflayer prismarine-auth', ' * '];
    const off = [undefined, '', 'minecraft-protocol', 'mineflayer*', 'prismarine-auth:*', '*,-prismarine-auth', 'prismarine*,-prismarine-auth', '-*', 'prismarine-authx'];
    for (const v of on) assert.equal(debugValueEnables(v), true, `DEBUG=${v}`);
    for (const v of off) assert.equal(debugValueEnables(v), false, `DEBUG=${v}`);
});

function sandbox() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-bridge-auth-'));
    assert.equal(findGitWorkTree(root), null);
    return root;
}

test('assertMicrosoftAuthSafe refuses no folder, a folder in a git work tree, and prismarine-auth debug output', () => {
    const root = sandbox();
    const ok = path.join(root, 'FRCFLD', 'msa');
    const noLive = () => false;
    assert.throws(() => assertMicrosoftAuthSafe({ username: 'FRCFLD', profilesFolder: undefined, env: {}, liveDebug: noLive }), /MINDCRAFT_PROFILES_FOLDER is not set/);

    fs.mkdirSync(path.join(root, 'repo', '.git'), { recursive: true });
    const inRepo = path.join(root, 'repo', 'cache');
    assert.throws(() => assertMicrosoftAuthSafe({ username: 'FRCFLD', profilesFolder: inRepo, env: {}, liveDebug: noLive }), /inside the git work tree/);
    assert.equal(fs.existsSync(inRepo), false, 'the check is read-only');

    for (const DEBUG of ['*', 'prismarine*', 'prismarine-auth']) {
        assert.throws(() => assertMicrosoftAuthSafe({ username: 'FRCFLD', profilesFolder: ok, env: { DEBUG }, liveDebug: noLive }), /DEBUG enables "prismarine-auth".*access and refresh tokens/);
    }
    assert.throws(() => assertMicrosoftAuthSafe({ username: 'FRCFLD', profilesFolder: ok, env: {}, liveDebug: () => true }), /DEBUG enables/,
        'a debug instance already enabled counts even if DEBUG was cleared later');

    assert.doesNotThrow(() => assertMicrosoftAuthSafe({ username: 'FRCFLD', profilesFolder: ok, env: { DEBUG: 'minecraft-protocol' }, liveDebug: noLive }));
    assert.equal(fs.existsSync(ok), false, 'nothing is created');
});
