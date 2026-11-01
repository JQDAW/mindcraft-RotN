// src/process/agent_process.js consumes the ADR 0003 exit-code contract (net-forge
// brief item 8): 0 clean, 1 transient with backoff, 3 fatal, 2/4 task codes.
// Offline: a fake spawn, fake timers and a fake process.exit; no child process starts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn as realSpawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
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

function harness(env = {}, { killEmits = true } = {}) {
    const children = [];
    const timers = [];
    const exits = [];
    const lines = [];
    let t = 0;
    const reasonBase = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-proc-'));
    const deps = {
        spawn: (cmd, args, opts) => {
            const child = new EventEmitter();
            child.args = args;
            child.opts = opts;
            child.killed = false;
            child.kill = (sig) => { child.killed = true; if (killEmits) child.emit('exit', null, sig); };
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
        reasonBase,
    };
    return { deps, children, timers, exits, lines, advance: (ms) => { t += ms; } };
}

test('AgentProcess restarts a transient exit after the backoff, then ends with 3 on a fatal exit', () => {
    const h = harness();
    const ap = new AgentProcess('FRCFLD', 8080, h.deps);
    ap.start(false, null, 0);
    assert.equal(h.children.length, 1);
    const reasonFile = h.children[0].opts.env.MINDCRAFT_EXIT_REASON_FILE;
    assert.ok(reasonFile && reasonFile.startsWith(path.join(h.deps.reasonBase, 'mindcraft-exit-')), 'the agent is told where to write its exit reason');

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

// PR #19 review follow-ups.
const writeReason = (child, r) => fs.writeFileSync(child.opts.env.MINDCRAFT_EXIT_REASON_FILE, JSON.stringify(r));

test('a requested restart restarts at once and leaves the backoff streak alone', () => {
    const h = harness();
    new AgentProcess('FRCFLD', 8080, h.deps).start();
    h.children[0].emit('exit', 1, null);
    assert.equal(h.timers.at(-1).ms, 10_000);
    h.timers.at(-1).fn();
    h.children[1].emit('exit', 1, null);
    assert.equal(h.timers.at(-1).ms, 20_000);
    h.timers.at(-1).fn();
    writeReason(h.children[2], { category: 'requested_restart', exitCode: 1 });
    h.children[2].emit('exit', 1, null);
    assert.equal(h.timers.at(-1).ms, 0, '!restart, the stuck mode or restart-agent: no wait');
    h.timers.at(-1).fn();
    h.children[3].emit('exit', 1, null);
    assert.equal(h.timers.at(-1).ms, 40_000, 'the streak continued where it was');
});

test('a runaway loop of requested restarts falls back to the backoff after 5 in 10 min', () => {
    const h = harness();
    new AgentProcess('FRCFLD', 8080, h.deps).start();
    const delays = [];
    for (let i = 0; i < 7; i++) {
        writeReason(h.children.at(-1), { category: 'requested_restart', exitCode: 1 });
        h.children.at(-1).emit('exit', 1, null);
        delays.push(h.timers.at(-1).ms);
        h.advance(1000);
        h.timers.at(-1).fn();
    }
    assert.deepEqual(delays, [0, 0, 0, 0, 0, 10_000, 20_000]);
});

test('the auth retry cap and the 10-minute reset work through AgentProcess', () => {
    const h = harness();
    new AgentProcess('FRCFLD', 8080, h.deps).start();
    const auth = classifyKick('Failed to verify username!');
    writeReason(h.children[0], auth);
    h.advance(5_000);
    h.children[0].emit('exit', 1, null);
    h.timers.at(-1).fn();
    writeReason(h.children[1], auth);
    h.advance(5_000);
    h.children[1].emit('exit', 1, null);
    assert.equal(h.timers.at(-1).ms, 20_000);
    h.timers.at(-1).fn();
    // This session stays up 11 minutes: the streak and the backoff reset.
    writeReason(h.children[2], auth);
    h.advance(11 * MIN);
    h.children[2].emit('exit', 1, null);
    assert.equal(h.timers.at(-1).ms, 10_000);
    assert.deepEqual(h.exits, []);
    h.timers.at(-1).fn();
    for (const i of [3, 4]) {
        writeReason(h.children[i], auth);
        h.advance(5_000);
        h.children[i].emit('exit', 1, null);
        if (i === 3) h.timers.at(-1).fn();
    }
    assert.deepEqual(h.exits, [3], 'third auth kick in a row since the reset: fatal');
    assert.ok(h.lines.some(l => /FATAL \(auth: 3 times in a row\)/.test(l)));
});

test('a child that exits with a code after stop() is not restarted', () => {
    const h = harness({}, { killEmits: false });
    const ap = new AgentProcess('FRCFLD', 8080, h.deps);
    ap.start();
    ap.stop();
    h.children[0].emit('exit', 1, null); // e.g. the agent's own SIGINT handler exits 1
    assert.equal(h.timers.length, 0);
    assert.deepEqual(h.exits, []);
});

test('single-bot service: a requested stop ends the main process with 0; multi-bot stays up', () => {
    const svc = harness({ MINDCRAFT_SINGLE_BOT_SERVICE: '1' });
    const a = new AgentProcess('FRCFLD', 8080, svc.deps);
    a.start();
    a.stop();
    assert.deepEqual(svc.exits, [0]);

    const multi = harness();
    const b = new AgentProcess('FRCFLD', 8080, multi.deps);
    b.start();
    b.stop();
    assert.deepEqual(multi.exits, []);
});

test('forceRestart restarts once, at once, and never ends the main process (also as a service)', () => {
    for (const env of [{}, { MINDCRAFT_SINGLE_BOT_SERVICE: '1' }]) {
        const h = harness(env);
        const ap = new AgentProcess('FRCFLD', 8080, h.deps);
        ap.start();
        ap.forceRestart();
        assert.equal(h.children.length, 2, 'one new agent');
        assert.equal(h.timers.length, 0, 'no backoff');
        assert.deepEqual(h.exits, []);
        assert.ok(h.children[1].args.includes('Agent process restarted.'));
        // forceRestart also cancels a pending backoff restart.
        h.children[1].emit('exit', 1, null);
        assert.equal(h.timers.length, 1);
        ap.forceRestart();
        assert.equal(h.timers[0].cleared, true);
        assert.equal(h.children.length, 3);
    }
});

test('the reason file sits in a private, unpredictable folder per agent', () => {
    const h = harness();
    const a = new AgentProcess('FRCFLD', 8080, h.deps);
    const b = new AgentProcess('FRCFLD', 8080, h.deps);
    assert.notEqual(path.dirname(a.reasonFile), path.dirname(b.reasonFile));
    assert.match(path.basename(path.dirname(a.reasonFile)), /^mindcraft-exit-.{6}$/);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.dirname(a.reasonFile)).mode & 0o777, 0o700);
});

// PR #23 review.
test('a requested restart after a long session still applies the 10-minute reset (review 1)', () => {
    const h = harness();
    new AgentProcess('FRCFLD', 8080, h.deps).start();
    const auth = classifyKick('Failed to verify username!');
    for (const i of [0, 1]) {
        writeReason(h.children[i], auth);
        h.advance(5_000);
        h.children[i].emit('exit', 1, null);
        h.timers.at(-1).fn();
    }
    // A 5-hour session ended by !restart: adds nothing to the streak, but resets it.
    writeReason(h.children[2], { category: 'requested_restart', exitCode: 1 });
    h.advance(5 * 60 * MIN);
    h.children[2].emit('exit', 1, null);
    assert.equal(h.timers.at(-1).ms, 0);
    h.timers.at(-1).fn();
    // One auth hiccup now is the first of a new streak, with the first backoff step.
    writeReason(h.children[3], auth);
    h.advance(5_000);
    h.children[3].emit('exit', 1, null);
    assert.deepEqual(h.exits, [], 'not "auth: 3 times in a row"');
    assert.equal(h.timers.at(-1).ms, 10_000);
});

test('single-bot service: stop() during a pending backoff ends the main process with 0 (review 2)', () => {
    const h = harness({ MINDCRAFT_SINGLE_BOT_SERVICE: '1' });
    const ap = new AgentProcess('FRCFLD', 8080, h.deps);
    ap.start();
    h.children[0].emit('exit', 1, null);
    assert.equal(h.timers.length, 1);
    ap.stop();
    assert.equal(h.timers[0].cleared, true);
    assert.deepEqual(h.exits, [0]);
});

test('readExitReason rejects files over the size cap without parsing them (review 3)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-exit-big-'));
    const f = path.join(dir, 'reason.json');
    fs.writeFileSync(f, JSON.stringify({ category: 'banned', exitCode: 3, pad: 'x'.repeat(5000) }));
    let parsed = false;
    assert.equal(readExitReason(f, { readFile: () => { parsed = true; return '{}'; } }), null);
    assert.equal(parsed, false, 'the size check comes before the read');
    fs.mkdirSync(path.join(dir, 'a-dir'));
    assert.equal(readExitReason(path.join(dir, 'a-dir')), null);
});

test('AgentProcess does not throw without a usable temp folder; it falls back to exit codes (review 4)', () => {
    const h = harness();
    const ap = new AgentProcess('FRCFLD', 8080, { ...h.deps, reasonBase: path.join(h.deps.reasonBase, 'missing', 'deeper') });
    assert.equal(ap.reasonFile, null);
    ap.start();
    assert.equal(h.children[0].opts.env.MINDCRAFT_EXIT_REASON_FILE, undefined);
    h.children[0].emit('exit', 3, null);
    assert.deepEqual(h.exits, [3]);
    assert.ok(h.lines.some(l => /no exit-reason folder/.test(l)));
});

test('end to end: a ban in a real agent child -> recordAgentExit -> reason file -> AgentProcess -> exit(3) (review 6)', async () => {
    const contract = new URL('../src/exit-contract.js', import.meta.url).href;
    const kicks = new URL('../src/kicks.js', import.meta.url).href;
    // The child stands in for agent.js onDisconnect: bridge.lastKick is the classified ban.
    const child = [
        `import { recordAgentExit } from ${JSON.stringify(contract)};`,
        `import { classifyKick } from ${JSON.stringify(kicks)};`,
        `const lastKick = classifyKick('{"translate":"multiplayer.disconnect.banned.reason","with":["griefing"]}');`,
        `process.exit(recordAgentExit({ kick: lastKick, event: 'Kicked', clientEnded: true }));`,
    ].join('\n');
    const lines = [];
    const exited = new Promise((resolve) => {
        const ap = new AgentProcess('FRCFLD', 8080, {
            spawn: (cmd, args, opts) => realSpawn(process.execPath, ['--input-type=module', '-e', child], { env: opts.env, stdio: 'ignore' }),
            exit: resolve,
            log: { log: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push(a.join(' ')) },
            logout: () => {},
            env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT },
        });
        ap.start();
    });
    assert.equal(await exited, 3);
    assert.ok(lines.some(l => /exited with code 3/.test(l)), 'the child itself exited 3');
    assert.ok(lines.some(l => /FRCFLD: FATAL \(banned\)/.test(l)), 'the main process read the reason file');
});
