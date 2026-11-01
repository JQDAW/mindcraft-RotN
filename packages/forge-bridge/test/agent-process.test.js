// src/process/agent_process.js consumes the ADR 0003 exit-code contract (net-forge
// brief item 8): 0 clean, 1 transient with backoff, 3 fatal, 2/4 task codes.
// Offline: a fake spawn, fake timers and a fake process.exit; no child process starts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentProcess, decideAgentExit, readExitReason } from '../../../src/process/agent_process.js';
import { createRestartPolicy, classifyKick, EXIT } from '../index.js';
import { assertMicrosoftAuthSafe } from '../src/auth-guard.js';

const MIN = 60_000;

test('decideAgentExit follows the ADR 0003 table', () => {
    const p = () => createRestartPolicy();
    assert.deepEqual(decideAgentExit({ code: 0 }, p()), { action: 'none', reason: 'clean stop' });
    assert.equal(decideAgentExit({ code: 0, singleBotService: true }, p()).code, 0);
    assert.equal(decideAgentExit({ code: 0, singleBotService: true }, p()).action, 'exit');
    assert.deepEqual(decideAgentExit({ code: 3 }, p()), { action: 'exit', code: 3, reason: 'fatal (exit 3)' });
    for (const code of [2, 4]) assert.deepEqual(decideAgentExit({ code }, p()), { action: 'exit', code, reason: 'task ended' });
    assert.deepEqual(decideAgentExit({ code: 7 }, p()), { action: 'exit', code: 7, reason: 'exit 7' });
    assert.deepEqual(decideAgentExit({ code: 1 }, p()), { action: 'restart', delayMs: 10_000, reason: 'transient' });
    assert.equal(decideAgentExit({ code: null, signal: 'SIGKILL' }, p()).action, 'restart', 'killed by someone else: transient');
    for (const signal of ['SIGINT', 'SIGTERM']) assert.equal(decideAgentExit({ code: null, signal }, p()).action, 'none');
    assert.equal(decideAgentExit({ code: 1, requestedStop: true }, p()).action, 'none');
});

test('transient exits back off 10 s doubling to 5 min, and reset after 10 min connected', () => {
    const policy = createRestartPolicy();
    const delays = Array.from({ length: 7 }, () => decideAgentExit({ code: 1, connectedMs: 5_000 }, policy).delayMs);
    assert.deepEqual(delays, [10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
    assert.equal(decideAgentExit({ code: 1, connectedMs: 11 * MIN }, policy).delayMs, 10_000);
});

test('an exit-reason file makes a fatal kick fatal and caps auth kicks', () => {
    const fatalKick = classifyKick('{"text":"Server Mod rejections:\\nfoo: Requires 1.0"}');
    assert.deepEqual(decideAgentExit({ code: 1, reason: fatalKick }, createRestartPolicy()), { action: 'exit', code: 3, reason: 'mod_rejection' });

    const policy = createRestartPolicy();
    const auth = classifyKick('Failed to verify username!');
    assert.equal(decideAgentExit({ code: 1, reason: auth }, policy).action, 'restart');
    assert.equal(decideAgentExit({ code: 1, reason: auth }, policy).action, 'restart');
    assert.deepEqual(decideAgentExit({ code: 1, reason: auth }, policy), { action: 'exit', code: 3, reason: 'auth: 3 times in a row' });
});

test('readExitReason accepts only {category, exitCode 0|1|3, retryCap?}', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-exit-'));
    const write = (v) => { const f = path.join(dir, `${Math.random()}.json`); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); return f; };
    assert.deepEqual(readExitReason(write({ category: 'auth', exitCode: 1, retryCap: 3, text: 'x' })), { category: 'auth', exitCode: 1, fatal: false, retryCap: 3 });
    assert.deepEqual(readExitReason(write({ category: 'banned', exitCode: 3 })), { category: 'banned', exitCode: 3, fatal: true });
    for (const bad of [{ category: 'x', exitCode: 2 }, { exitCode: 1 }, 'not json', '[]', { category: 5, exitCode: 1 }]) assert.equal(readExitReason(write(bad)), null, JSON.stringify(bad));
    assert.equal(readExitReason(path.join(dir, 'missing.json')), null);
    assert.equal(readExitReason(undefined), null);
});

function harness(env = {}) {
    const children = [];
    const timers = [];
    const exits = [];
    const lines = [];
    let t = 0;
    const reasonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-proc-'));
    const deps = {
        spawn: (cmd, args, opts) => {
            const child = new EventEmitter();
            child.args = args;
            child.opts = opts;
            child.killed = false;
            child.kill = (sig) => { child.killed = true; child.emit('exit', null, sig); };
            children.push(child);
            return child;
        },
        exit: (c) => exits.push(c),
        setTimer: (fn, ms) => { const h = { fn, ms, cleared: false }; timers.push(h); return h; },
        clearTimer: (h) => { h.cleared = true; },
        now: () => t,
        env,
        log: { log: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push(a.join(' ')) },
        logout: () => {},
        reasonDir,
    };
    return { deps, children, timers, exits, lines, advance: (ms) => { t += ms; } };
}

test('AgentProcess restarts a transient exit after the backoff, then ends with 3 on a fatal exit', () => {
    const h = harness();
    const ap = new AgentProcess('FRCFLD', 8080, h.deps);
    ap.start(false, null, 0);
    assert.equal(h.children.length, 1);
    const reasonFile = h.children[0].opts.env.MINDCRAFT_EXIT_REASON_FILE;
    assert.ok(reasonFile && reasonFile.startsWith(h.deps.reasonDir), 'the agent is told where to write its exit reason');

    h.advance(30_000);
    h.children[0].emit('exit', 1, null);
    assert.equal(h.children.length, 1, 'not restarted at once');
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].ms, 10_000);
    h.timers[0].fn();
    assert.equal(h.children.length, 2);
    assert.ok(h.children[1].args.includes('-l') && h.children[1].args.includes('Agent process restarted.'));

    // The agent reports a ban through the reason file but exits 1 (as agent.js does today).
    fs.writeFileSync(h.children[1].opts.env.MINDCRAFT_EXIT_REASON_FILE, JSON.stringify(classifyKick('You are banned from this server.')));
    h.children[1].emit('exit', 1, null);
    assert.deepEqual(h.exits, [3]);
    assert.equal(h.timers.length, 1, 'no restart scheduled');
    assert.ok(h.lines.some(l => /FRCFLD: FATAL \(banned\)\. Not restarting; a human must act/.test(l)));
    assert.equal(fs.existsSync(reasonFile), false, 'the reason file is removed after it is read');
});

test('AgentProcess: a clean exit ends a single-bot service with 0 and leaves a multi-bot main process running', () => {
    const svc = harness({ MINDCRAFT_SINGLE_BOT_SERVICE: '1' });
    new AgentProcess('FRCFLD', 8080, svc.deps).start();
    svc.children[0].emit('exit', 0, null);
    assert.deepEqual(svc.exits, [0]);

    const multi = harness({});
    new AgentProcess('FRCFLD', 8080, multi.deps).start();
    multi.children[0].emit('exit', 0, null);
    assert.deepEqual(multi.exits, []);
    assert.equal(multi.timers.length, 0);
});

test('AgentProcess: stop() is never restarted and cancels a pending restart', () => {
    const h = harness();
    const ap = new AgentProcess('FRCFLD', 8080, h.deps);
    ap.start();
    ap.stop();
    assert.deepEqual(h.exits, []);
    assert.equal(h.timers.length, 0);

    ap.start();
    h.children[1].emit('exit', 1, null);
    assert.equal(h.timers.length, 1);
    ap.stop();
    assert.equal(h.timers[0].cleared, true);
    assert.equal(h.children.length, 2);
});

test('AgentProcess: task codes 2 and 4 end the main process with that code', () => {
    for (const code of [2, 4]) {
        const h = harness();
        new AgentProcess('FRCFLD', 8080, h.deps).start();
        h.children[0].emit('exit', code, null);
        assert.deepEqual(h.exits, [code]);
        assert.ok(h.lines.includes('Ending task'));
    }
});

test('auth-guard setup errors carry exitCode 3', () => {
    assert.throws(() => assertMicrosoftAuthSafe({ username: 'FRCFLD', profilesFolder: undefined, env: {}, liveDebug: () => false }),
        (e) => e.exitCode === EXIT.FATAL && e.fatal === true);
});
