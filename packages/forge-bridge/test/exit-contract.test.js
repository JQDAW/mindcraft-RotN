// Agent side of the exit-code contract (src/exit-contract.js recordAgentExit),
// as agent.js calls it through bot.forge.recordExit. Offline: temp files only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordAgentExit, readExitReason, writeExitReason, REQUESTED_RESTART } from '../src/exit-contract.js';
import { classifyKick, EXIT } from '../src/kicks.js';

function withFile() {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exit-contract-')), 'reason.json');
    return { file, io: { env: { MINDCRAFT_EXIT_REASON_FILE: file } }, read: () => readExitReason(file) };
}

test('a fatal kick exits 3 and is reported; an auth kick exits 1 with its retry cap', () => {
    const a = withFile();
    assert.equal(recordAgentExit({ kick: classifyKick('You are banned from this server.'), event: 'Kicked', clientEnded: true }, a.io), EXIT.FATAL);
    assert.deepEqual(a.read(), { category: 'banned', exitCode: 3, fatal: true });

    const b = withFile();
    assert.equal(recordAgentExit({ kick: classifyKick('Failed to verify username!'), clientEnded: true }, b.io), EXIT.TRANSIENT);
    assert.deepEqual(b.read(), { category: 'auth', exitCode: 1, fatal: false, retryCap: 3 });
});

test('without a bridge the raw kick reason is classified; a plain disconnect is transient', () => {
    const a = withFile();
    assert.equal(recordAgentExit({ event: 'Kicked', reason: '{"text":"You are not white-listed on this server!"}', clientEnded: true }, a.io), EXIT.FATAL);
    assert.equal(a.read().category, 'not_whitelisted');

    const b = withFile();
    assert.equal(recordAgentExit({ event: 'Disconnected', reason: 'socketClosed', clientEnded: true }, b.io), EXIT.TRANSIENT);
    assert.equal(b.read().category, 'disconnect');
});

test('cleanKill: a deliberate restart while connected is requested_restart; after a kick it reports the kick', () => {
    const a = withFile();
    assert.equal(recordAgentExit({ requestedRestart: true, clientEnded: false }, a.io), EXIT.TRANSIENT);
    assert.equal(a.read().category, REQUESTED_RESTART);

    const b = withFile();
    assert.equal(recordAgentExit({ requestedRestart: true, clientEnded: true, kick: classifyKick('Server Mod rejections: x') }, b.io), EXIT.FATAL);
    assert.equal(b.read().category, 'mod_rejection', 'a kick is never turned into an immediate restart');
});

test('startup errors: exitCode 3 (auth-guard) is fatal, anything else exits 1, never 0', () => {
    const a = withFile();
    assert.equal(recordAgentExit({ error: Object.assign(new Error('no folder'), { exitCode: 3 }) }, a.io), EXIT.FATAL);
    assert.equal(a.read().category, 'setup');
    const b = withFile();
    assert.equal(recordAgentExit({ error: new Error('boom') }, b.io), EXIT.TRANSIENT);
    assert.equal(b.read().category, 'error');
});

test('without MINDCRAFT_EXIT_REASON_FILE the code is still returned and nothing is written', () => {
    assert.equal(writeExitReason({ category: 'x', exitCode: 1 }, { env: {} }), false);
    assert.equal(recordAgentExit({ kick: classifyKick('You are banned from this server.') }, { env: {} }), EXIT.FATAL);
});
