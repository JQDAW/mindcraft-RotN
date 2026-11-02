// g1-driver's error logging and exit decision (tools/driver-exit.mjs; ADR 0003
// decision 5). G2 batch 2: an auth failure before join exited 0, and the #72
// review: before join no error message (prismarine-auth puts HTTP bodies in it)
// may be logged, and a permanent auth failure exits 3. Offline: no network, and
// only fake tokens (fake-auth-failure.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createExitTracker, classifyBeforeJoinError } from '../tools/driver-exit.mjs';
import { FAKE_JWT } from './fake-auth-failure.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.join(HERE, '..', 'tools');
const DRIVER = path.join(TOOLS, 'g1-driver.mjs');
const PRELOAD = pathToFileURL(path.join(HERE, 'fake-auth-failure.mjs')).href;

// What prismarine-auth's checkStatus throws (src/common/Util.js): "<status> <statusText> <body>".
const BODY = JSON.stringify({ XErr: 2148916233, Token: FAKE_JWT });
const httpError = (status, text) => new Error(`${status} ${text} ${BODY}`);
// nmp's own message after a swallowed profile-fetch failure (src/client/microsoftAuth.js).
const NMP_PROFILE = () => new Error('Failed to obtain profile data for FRCFLD, does the account own minecraft?');
const coded = (Ctor, message, code, causeCode) => {
    const e = new Ctor(message, causeCode ? { cause: Object.assign(new Error(`${causeCode} 203.0.113.9:443 ${FAKE_JWT}`), { code: causeCode }) } : undefined);
    if (code) e.code = code;
    return e;
};
const SECRET_LIKE = new RegExp(`eyJ|${FAKE_JWT.slice(0, 12)}|XErr|203\\.0\\.113\\.9|Token`);

function tracker(profileFailure = null) {
    const events = [];
    const exits = [];
    const t = createExitTracker({ emit: (type, data) => events.push({ type, ...data }), exit: (c) => exits.push(c), profileFailure: () => profileFailure });
    return { t, events, exits };
}

// One case per class (lead's #72 review, item 2).
const CLASSES = [
    { name: 'Xbox 401', err: () => httpError(401, 'Unauthorized'), exit: 3, kind: 'auth-permanent', status: 401, statusSource: 'error' },
    { name: 'Xbox 403', err: () => httpError(403, 'Forbidden'), exit: 3, kind: 'auth-permanent', status: 403, statusSource: 'error' },
    { name: 'profile fetch 401 (nmp\'s message + the captured status)', err: NMP_PROFILE, profile: { status: 401 }, exit: 3, kind: 'auth-permanent', status: 401, statusSource: 'profile-fetch' },
    { name: 'profile fetch 404: does not own Minecraft', err: NMP_PROFILE, profile: { status: 404 }, exit: 3, kind: 'auth-permanent', status: 404, statusSource: 'profile-fetch' },
    { name: 'Xbox 503', err: () => httpError(503, 'Service Unavailable'), exit: 1, kind: 'http-5xx', status: 503, statusSource: 'error' },
    { name: 'profile fetch 500', err: NMP_PROFILE, profile: { status: 500 }, exit: 1, kind: 'http-5xx', status: 500, statusSource: 'profile-fetch' },
    { name: 'rate limited (429)', err: () => httpError(429, 'Too Many Requests'), exit: 1, kind: 'http-other', status: 429, statusSource: 'error' },
    { name: 'network: fetch failed, ECONNRESET', err: () => coded(TypeError, 'fetch failed', null, 'ECONNRESET'), exit: 1, kind: 'network', status: null, code: 'ECONNRESET' },
    { name: 'timeout: undici connect timeout', err: () => coded(TypeError, 'fetch failed', null, 'UND_ERR_CONNECT_TIMEOUT'), exit: 1, kind: 'network', status: null, code: 'UND_ERR_CONNECT_TIMEOUT' },
    { name: 'connect refused (the code stays visible)', err: () => coded(Error, 'connect ECONNREFUSED 127.0.0.1:25565', 'ECONNREFUSED'), exit: 1, kind: 'network', status: null, code: 'ECONNREFUSED' },
    { name: 'profile failure with no captured status', err: NMP_PROFILE, profile: null, exit: 1, kind: 'auth-unknown', status: null },
    // XSTS (patched prismarine-auth attaches err.xerr; the message is its fixed description).
    { name: 'XSTS XErr 2148916233 (no Xbox profile)', err: () => Object.assign(new Error('Your account currently does not have an Xbox profile.'), { xerr: 2148916233 }), exit: 3, kind: 'auth-permanent', status: null, xerr: 2148916233 },
    { name: 'XSTS XErr 2148916238 (under 18, not in a family)', err: () => Object.assign(new Error('The account date of birth is under 18 years.'), { xerr: 2148916238 }), exit: 3, kind: 'auth-permanent', status: null, xerr: 2148916238 },
    { name: 'XSTS with an unknown XErr', err: () => Object.assign(new Error('Xbox Live authentication failed to obtain a XSTS token. XErr: 2148916000'), { xerr: 2148916000 }), exit: 1, kind: 'xsts-other', status: null, xerr: 2148916000 },
];

for (const c of CLASSES) {
    test(`before join, ${c.name}: exit ${c.exit}, logged without the message`, () => {
        const { t, events, exits } = tracker(c.profile ?? null);
        t.botError(c.err());
        assert.deepEqual(exits, [c.exit]);
        const [error, end] = events;
        assert.equal(error.type, 'error');
        assert.equal(error.phase, 'before_join');
        assert.equal(error.message, undefined, 'no message before join');
        assert.deepEqual([error.kind, error.status], [c.kind, c.status]);
        if (c.statusSource) assert.equal(error.statusSource, c.statusSource);
        if (c.code) assert.equal(error.code, c.code);
        assert.equal(error.xerr, c.xerr ?? null);
        assert.deepEqual([end.type, end.reason, end.exitCode, end.joined, end.beforeJoin], ['end', 'error before join', c.exit, false, true]);
        assert.doesNotMatch(JSON.stringify(events), SECRET_LIKE);
    });
}

test('an HTTP body with an eyJ... value never reaches the output, from either handler', () => {
    const { t, events } = tracker();
    t.unhandledRejection(httpError(401, 'Unauthorized'));
    assert.deepEqual(events, [{ type: 'error', phase: 'before_join', unhandledRejection: true, errorClass: 'Error', code: null, status: 401, statusSource: 'error', xerr: null, kind: 'auth-permanent' }]);
    t.botError(httpError(400, 'Bad Request'));
    assert.doesNotMatch(JSON.stringify(events), SECRET_LIKE);
    assert.ok(!JSON.stringify(events).includes(FAKE_JWT));
});

test('decided once; a drained loop without a stop is never a clean exit; stop exits 0', () => {
    const once = tracker();
    once.t.botError(NMP_PROFILE());
    once.t.end('socketClosed');
    once.t.drained();
    assert.deepEqual(once.exits, [1]);

    const drained = tracker();
    drained.t.drained();
    assert.deepEqual(drained.exits, [1]);
    assert.equal(drained.events[0].beforeJoin, true);

    const stop = tracker();
    stop.t.joined();
    stop.t.stopping();
    stop.t.end('quit');
    assert.deepEqual(stop.exits, [0]);
});

test('after join: the message is logged, "end" decides, and a fatal kick exits 3', () => {
    const late = tracker();
    late.t.joined();
    late.t.botError(new Error('some error while playing'));
    assert.deepEqual(late.events, [{ type: 'error', message: 'some error while playing' }]);
    assert.deepEqual(late.exits, []);
    late.t.end('socketClosed');
    assert.deepEqual([late.exits, late.events[1].joined, late.events[1].beforeJoin], [[1], true, false]);

    const kicked = tracker();
    kicked.t.joined();
    kicked.t.fatal('whitelist');
    kicked.t.end('kicked');
    assert.deepEqual(kicked.exits, [3]);
});

test('classifyBeforeJoinError reads only a leading status from the message', () => {
    assert.equal(classifyBeforeJoinError(new Error(`body first ${BODY} 401 Unauthorized`)).status, null);
    assert.equal(classifyBeforeJoinError(new Error('401 Unauthorized')).fatal, true);
    assert.equal(classifyBeforeJoinError(new Error('Some other error'), { profileFailure: { status: 404 } }).status, null, 'the captured profile status applies only to nmp\'s profile failure');
});

test('in a real process: an error and nothing else (G2 batch 2\'s shape) exits 1, not 0', () => {
    // g1-driver's wiring: bot 'error' -> botError, process 'beforeExit' -> drained.
    const script = `
        import { EventEmitter } from 'node:events';
        import { createExitTracker } from ${JSON.stringify(pathToFileURL(path.join(TOOLS, 'driver-exit.mjs')).href)};
        const event = (type, data) => process.stdout.write('DRIVER ' + JSON.stringify({ type, ...data }) + '\\n');
        const bot = new EventEmitter();
        const t = createExitTracker({ emit: event });
        process.on('beforeExit', () => t.drained());
        bot.on('error', (e) => t.botError(e));
        if (process.argv[1] === 'error') setTimeout(() => bot.emit('error', new Error('Failed to obtain profile data for FRCFLD, does the account own minecraft?')), 10);
    `;
    for (const [mode, reason] of [['error', 'error before join'], ['drain', 'event loop drained without a stop']]) {
        const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, mode], { encoding: 'utf8', timeout: 60000 });
        assert.equal(r.status, 1, `${mode}: ${r.stdout}${r.stderr}`);
        const end = r.stdout.split('\n').filter((l) => l.startsWith('DRIVER ')).map((l) => JSON.parse(l.slice(7))).find((e) => e.type === 'end');
        assert.deepEqual([end.reason, end.exitCode, end.beforeJoin], [reason, 1, true], mode);
    }
});

// The real g1-driver, with Microsoft auth failing offline through the preload.
function runDriver(env) {
    const profiles = fs.mkdtempSync(path.join(os.tmpdir(), 'g1-driver-auth-'));
    try {
        const keep = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'APPDATA', 'LOCALAPPDATA'];
        const base = Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
        const r = spawnSync(process.execPath, ['--import', PRELOAD, DRIVER], {
            env: { ...base, TEST_SERVER_HOST: '127.0.0.1', TEST_SERVER_PORT: '1', ROTN_DRIVER_AUTH: 'microsoft', ROTN_DRIVER_CAPTURE: '0', MINDCRAFT_PROFILES_FOLDER: profiles, ...env },
            encoding: 'utf8', timeout: 120000,
        });
        const events = r.stdout.split('\n').filter((l) => l.startsWith('DRIVER ')).map((l) => JSON.parse(l.slice(7)));
        return { r, events, all: r.stdout + r.stderr };
    } finally {
        fs.rmSync(profiles, { recursive: true, force: true });
    }
}

for (const [mode, exit, kind] of [['xbox401', 3, 'auth-permanent'], ['profile404', 3, 'auth-permanent'], ['xsts2148916233', 3, 'auth-permanent'], ['xbox503', 1, 'http-5xx'], ['network', 1, 'network']]) {
    test(`the real driver, auth failing with ${mode}: exit ${exit}, beforeJoin, and no token or body in any output`, () => {
        const { r, events, all } = runDriver({ FAKE_AUTH_FAILURE: mode });
        assert.equal(r.status, exit, all.slice(-3000));
        const error = events.find((e) => e.type === 'error');
        const end = events.find((e) => e.type === 'end');
        assert.deepEqual([error.phase, error.kind, error.message], ['before_join', kind, undefined]);
        assert.deepEqual([end.exitCode, end.joined, end.beforeJoin], [exit, false, true]);
        assert.ok(!all.includes(FAKE_JWT), 'the fake token never appears');
        // The body's JSON never appears ("XErr": its key); an XErr code may be logged as a number.
        assert.doesNotMatch(all, /eyJ|"XErr"|203\.0\.113\.9/);
    });
}

test('the real driver: an auth-guard refusal (DEBUG enabling prismarine-auth) exits 3 before any bot exists', () => {
    const { r, events } = runDriver({ FAKE_AUTH_FAILURE: 'xbox401', DEBUG: 'prismarine-auth' });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    const fatal = events.find((e) => e.type === 'fatal');
    assert.deepEqual([fatal.exitCode, fatal.beforeJoin], [3, true]);
    assert.equal(events.find((e) => e.type === 'error'), undefined, 'refused before auth ran');
});
