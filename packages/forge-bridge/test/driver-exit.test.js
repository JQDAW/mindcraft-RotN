// g1-driver's exit decision (tools/driver-exit.mjs; ADR 0003 decision 5). G2 batch
// 2: an auth failure before join ("Failed to obtain profile data") exited 0. Offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createExitTracker } from '../tools/driver-exit.mjs';

const TOOLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools');
// nmp's own message for G2 batch 2's failure (minecraft-protocol src/client/microsoftAuth.js).
const AUTH_FAILURE = () => new Error('Failed to obtain profile data for FRCFLD, does the account own minecraft?');

function tracker() {
    const events = [];
    const exits = [];
    const t = createExitTracker({ emit: (type, data) => events.push({ type, ...data }), exit: (c) => exits.push(c) });
    return { t, events, exits };
}

test('an error before join (the auth failure, no "end" after it) exits 1 and says beforeJoin', () => {
    const { t, events, exits } = tracker();
    t.error(AUTH_FAILURE());
    assert.deepEqual(exits, [1]);
    assert.deepEqual(events, [{ type: 'end', reason: 'error before join', exitCode: 1, joined: false, beforeJoin: true, errorClass: 'Error' }]);
    t.end('socketClosed');
    t.drained();
    assert.deepEqual(exits, [1], 'decided once');
});

test('a drained event loop without a stop is never a clean exit', () => {
    const { t, events, exits } = tracker();
    t.drained();
    assert.deepEqual(exits, [1]);
    assert.equal(events[0].beforeJoin, true);
});

test('a fatal kick exits 3; a requested stop exits 0; after join an error waits for "end"', () => {
    const fatal = tracker();
    fatal.t.fatal('whitelist');
    fatal.t.end('kicked');
    assert.deepEqual(fatal.exits, [3]);

    const stop = tracker();
    stop.t.joined();
    stop.t.stopping();
    stop.t.end('quit');
    assert.deepEqual(stop.exits, [0]);
    assert.equal(stop.events[0].beforeJoin, false);

    const late = tracker();
    late.t.joined();
    late.t.error(new Error('some error while playing'));
    assert.deepEqual(late.exits, [], 'after join, mineflayer\'s "end" decides');
    late.t.end('socketClosed');
    assert.deepEqual(late.exits, [1]);
    assert.deepEqual([late.events[0].joined, late.events[0].beforeJoin], [true, false]);
});

test('in a real process: an error and nothing else (G2 batch 2\'s shape) exits 1, not 0', () => {
    // The wiring g1-driver uses: bot 'error' -> tracker.error, process 'beforeExit' -> tracker.drained.
    // Here the error is caught and logged, and the loop would otherwise drain to exit 0.
    const script = `
        import { EventEmitter } from 'node:events';
        import { createExitTracker } from ${JSON.stringify(pathToFileURL(path.join(TOOLS, 'driver-exit.mjs')).href)};
        const event = (type, data) => process.stdout.write('DRIVER ' + JSON.stringify({ type, ...data }) + '\\n');
        const bot = new EventEmitter();
        const t = createExitTracker({ emit: event });
        process.on('beforeExit', () => t.drained());
        bot.on('error', (e) => { event('error', { message: e.message }); t.error(e); });
        const mode = process.argv[1];
        if (mode === 'error') setTimeout(() => bot.emit('error', new Error('Failed to obtain profile data for FRCFLD, does the account own minecraft?')), 10);
    `;
    for (const [mode, reason] of [['error', 'error before join'], ['drain', 'event loop drained without a stop']]) {
        const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, mode], { encoding: 'utf8', timeout: 60000 });
        assert.equal(r.status, 1, `${mode}: ${r.stdout}${r.stderr}`);
        const end = r.stdout.split('\n').filter((l) => l.startsWith('DRIVER ')).map((l) => JSON.parse(l.slice(7))).find((e) => e.type === 'end');
        assert.deepEqual([end.reason, end.exitCode, end.beforeJoin], [reason, 1, true], mode);
    }
});
