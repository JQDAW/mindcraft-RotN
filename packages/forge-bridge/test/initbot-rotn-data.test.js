// initBot fails closed without rotn-data (#555, lead decision after the #553 review).
// With the bridge not off: rotn-data that does not load, or an empty mod entity table, makes
// initBot write exit reason { category: 'rotn-data', exitCode: 3 } and throw an exitCode 3
// error (init_agent.js exits 3; the unit never restarts it), before any capture file or
// socket. A missing optional table only warns. FORGE_BRIDGE=off does not load rotn-data.
// Offline: loopback only.

import process from 'node:process';
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { requireRotnData, rotnDataRefusal, ROTN_DATA_CATEGORY } from '../src/rotn-data-required.js';
import { fmlEntityTable } from '../src/fml-entities.js';
import { readExitReason } from '../src/exit-contract.js';
import * as rotnData from '../../rotn-data/index.js';

let setSettings;
let initBot;

before(async () => {
    ({ setSettings } = await import('../../../src/agent/settings.js'));
    ({ initBot } = await import('../../../src/utils/mcdata.js'));
});

const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'initbot-rotn-data-')), name);

afterEach(() => {
    for (const k of ['FORGE_BRIDGE', 'FORGE_CAPTURE', 'FORGE_PING_TIMEOUT_MS', 'MINDCRAFT_EXIT_REASON_FILE']) delete process.env[k];
});

/** A catalog like rotn-data's, with some methods replaced. */
const catalog = (over = {}) => {
    const real = rotnData.loadRotnData(rotnData.PACK_VERSION);
    return new Proxy(real, { get: (t, k) => (k in over ? over[k] : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) });
};

function refusesWithExit3(load, why) {
    const reason = tmp('reason.json');
    const capture = tmp('capture.jsonl');
    process.env.MINDCRAFT_EXIT_REASON_FILE = reason;
    process.env.FORGE_CAPTURE = capture;
    setSettings({ host: '127.0.0.1', port: 1, auth: 'offline', minecraft_version: '1.12.2' });
    let thrown = null;
    assert.throws(() => initBot('FRCFLD', { loadRotnData: load }), (e) => { thrown = e; return true; });
    assert.equal(thrown.exitCode, 3, 'init_agent.js exits 3 on it');
    assert.equal(thrown.fatal, true);
    assert.equal(thrown.category, 'rotn-data');
    assert.match(thrown.message, new RegExp(`^\\[forge-bridge\\] refusing to start: rotn-data ${why}`));
    assert.match(thrown.message, /every living modded entity as hostile and may attack it \(NPCs such as ToroQuest guards and villagers included/);
    assert.match(thrown.message, /would misread blocks/);
    assert.match(thrown.message, /Exit 3: not restarted\./);
    assert.deepEqual(JSON.parse(fs.readFileSync(reason, 'utf8')), { category: 'rotn-data', exitCode: 3 });
    assert.deepEqual(readExitReason(reason), { category: 'rotn-data', exitCode: 3, fatal: true }, 'the main process reads it as fatal');
    assert.equal(fs.existsSync(capture), false, 'refused before any capture file');
}

test('rotn-data that does not load: initBot refuses, exit 3, exit reason rotn-data', () => {
    for (const mode of ['on', 'auto']) {
        process.env.FORGE_BRIDGE = mode;
        refusesWithExit3(() => { throw new Error('ENOENT: packages/rotn-data/3.3.4/dump.json'); }, 'did not load \\(ENOENT: packages/rotn-data/3\\.3\\.4/dump\\.json\\)');
    }
    process.env.FORGE_BRIDGE = 'on';
    refusesWithExit3(() => null, 'did not load \\(no catalog\\)');
});

test('an empty (or broken) mod entity table: initBot refuses, exit 3', () => {
    process.env.FORGE_BRIDGE = 'on';
    refusesWithExit3(() => catalog({ modEntityTable: () => ({}) }), 'has an empty mod entity table');
    refusesWithExit3(() => catalog({ modEntityTable: () => null }), 'has an empty mod entity table');
    refusesWithExit3(() => catalog({ modEntityTable: () => { throw new Error('bad dump'); } }), 'has no usable mod entity table \\(bad dump\\)');
});

/** Starts initBot against a loopback server that hangs up, then ends the bot. */
async function startsAndEnds(t, load) {
    const warns = [];
    t.mock.method(console, 'warn', (m) => warns.push(String(m)));
    t.mock.method(console, 'log', () => {});
    const reason = tmp('reason.json');
    process.env.MINDCRAFT_EXIT_REASON_FILE = reason;
    process.env.FORGE_PING_TIMEOUT_MS = '500';
    const hangup = net.createServer((s) => s.destroy());
    hangup.listen(0, '127.0.0.1');
    await once(hangup, 'listening');
    setSettings({ host: '127.0.0.1', port: hangup.address().port, auth: 'offline', minecraft_version: '1.12.2' });
    try {
        const bot = initBot('FRCFLD', { loadRotnData: load });
        assert.ok(bot?._client, 'a bot and its client exist');
        await new Promise((resolve) => { bot.once('error', resolve); bot.once('end', resolve); setTimeout(resolve, 20000).unref(); });
        try { bot.end(); bot._client.socket?.destroy(); } catch { /* already ended */ }
        clearTimeout(bot._client.closeTimer);
    } finally {
        hangup.close();
    }
    assert.equal(fs.existsSync(reason), false, 'no exit reason written: it started');
    return warns;
}

test('an optional table missing (serializers, block-state remap): a warning only, the bot starts', { timeout: 60000 }, async (t) => {
    process.env.FORGE_BRIDGE = 'on';
    const load = () => catalog({
        serializers: () => { throw new Error('no serializers'); },
        stateMetaRemap: () => { throw new Error('no remap'); },
    });
    const warns = await startsAndEnds(t, load);
    assert.ok(warns.includes('[forge-bridge] rotn-data serializer table unavailable: no serializers'), warns.join('\n'));
    assert.ok(warns.includes('[forge-bridge] rotn-data state-id remap table unavailable: no remap'), warns.join('\n'));
    assert.ok(!warns.some((w) => /refusing to start/.test(w)));
});

test('FORGE_BRIDGE=off: rotn-data is not loaded and initBot starts as before', { timeout: 60000 }, async (t) => {
    process.env.FORGE_BRIDGE = 'off';
    let loads = 0;
    const warns = await startsAndEnds(t, () => { loads++; throw new Error('must not be called'); });
    assert.equal(loads, 0);
    assert.ok(!warns.some((w) => /rotn-data/.test(w)), warns.join('\n'));
});

test('requireRotnData: the real catalog gives the table fmlEntityTable builds; the refusal is exit 3, category rotn-data', () => {
    const real = rotnData.loadRotnData(rotnData.PACK_VERSION);
    const { rd, modEntityTable } = requireRotnData(() => real);
    assert.equal(rd, real);
    assert.deepEqual(modEntityTable, fmlEntityTable({ modEntityTable: rotnData.modEntityTable, entityByModId: rotnData.entityByModId }));
    assert.ok(Object.keys(modEntityTable).length >= 50);
    const e = rotnDataRefusal('did not load (x)');
    assert.deepEqual([e.exitCode, e.fatal, e.category, ROTN_DATA_CATEGORY], [3, true, 'rotn-data', 'rotn-data']);
});
