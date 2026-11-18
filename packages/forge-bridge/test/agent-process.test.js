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
import { setImmediate } from 'node:timers';
import { AgentProcess, decideAgentExit, readExitReason } from '../../../src/process/agent_process.js';
import { createRestartPolicy, createCrashLoopGuard, crashSignature, attachSpawnTimeoutReason, classifyBeforeJoinError, writeExitReason, classifyKick, EXIT } from '../index.js';
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
        signals: new EventEmitter(), // never the test runner's own process
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
            signals: new EventEmitter(),
        });
        ap.start();
    });
    assert.equal(await exited, 3);
    assert.ok(lines.some(l => /exited with code 3/.test(l)), 'the child itself exited 3');
    assert.ok(lines.some(l => /FRCFLD: FATAL \(banned\)/.test(l)), 'the main process read the reason file');
});

test('crashSignature: unexplained exit 1, a recorded startup error and foreign signals are crashes; kicks are not', () => {
    assert.equal(crashSignature({ code: 1 }), 'exit 1 without a reason');
    assert.equal(crashSignature({ code: 1, reason: { category: 'error', exitCode: 1, fatal: false } }), 'startup error');
    assert.equal(crashSignature({ code: null, signal: 'SIGABRT' }), 'signal SIGABRT');
    assert.equal(crashSignature({ code: null, signal: 'SIGKILL' }), 'signal SIGKILL');
    for (const category of ['disconnect', 'network', 'timeout', 'server_stopping', 'auth', 'requested_restart']) {
        assert.equal(crashSignature({ code: 1, reason: { category, exitCode: 1, fatal: false } }), null, category);
    }
    for (const signal of ['SIGINT', 'SIGTERM']) assert.equal(crashSignature({ code: null, signal }), null, signal);
    for (const code of [0, 2, 3, 4]) assert.equal(crashSignature({ code }), null, `exit ${code}`);
});

test('decideAgentExit: the 5th quick identical crash in a row ends with 3; a long session, another crash or a disconnect starts the count again', () => {
    const run = (exits) => {
        const policy = createRestartPolicy();
        const crashGuard = createCrashLoopGuard();
        return exits.map(e => decideAgentExit({ connectedMs: 20_000, ...e }, policy, null, crashGuard));
    };
    const five = run(Array.from({ length: 5 }, () => ({ code: 1 })));
    assert.deepEqual(five.slice(0, 4).map(d => d.action), ['restart', 'restart', 'restart', 'restart']);
    assert.deepEqual(five.slice(0, 4).map(d => d.delayMs), [10_000, 20_000, 40_000, 80_000], 'the backoff is unchanged');
    assert.deepEqual(five[4], { action: 'exit', code: 3, reason: 'crash_loop: exit 1 without a reason, 5 times in a row, each within 5 min of the start' });

    const startup = run(Array.from({ length: 5 }, () => ({ code: 1, reason: { category: 'error', exitCode: 1, fatal: false } })));
    assert.equal(startup[4].code, 3);
    assert.match(startup[4].reason, /^crash_loop: startup error, 5 times/);

    const long = run([{ code: 1 }, { code: 1 }, { code: 1 }, { code: 1, connectedMs: 5 * MIN }, { code: 1 }, { code: 1 }]);
    assert.ok(long.every(d => d.action === 'restart'), 'a 5-minute session is not a quick crash');

    const mixed = run([{ code: 1 }, { code: 1 }, { code: 1 }, { code: 1 }, { code: null, signal: 'SIGABRT' }, { code: 1 }]);
    assert.ok(mixed.every(d => d.action === 'restart'), 'a different crash starts the count again');

    const disconnect = { category: 'disconnect', exitCode: 1, fatal: false };
    const flap = run([{ code: 1 }, { code: 1 }, { code: 1 }, { code: 1 }, { code: 1, reason: disconnect }, { code: 1 }, { code: 1 }]);
    assert.ok(flap.every(d => d.action === 'restart'), 'a disconnect between crashes starts the count again');

    const restartReq = { category: 'requested_restart', exitCode: 1, fatal: false };
    const req = run([{ code: 1 }, { code: 1 }, { code: 1 }, { code: 1 }, { code: 1, reason: restartReq }, { code: 1 }]);
    assert.ok(req.every(d => d.action === 'restart'), 'a requested restart starts the count again');
});

test('decideAgentExit: a server that stays down is retried for as long as it takes, never a crash loop', () => {
    const policy = createRestartPolicy();
    const crashGuard = createCrashLoopGuard();
    const network = { category: 'network', exitCode: 1, fatal: false };
    for (let i = 0; i < 30; i++) {
        const d = decideAgentExit({ code: 1, reason: i % 2 ? network : { ...network, category: 'disconnect' }, connectedMs: 3_000 }, policy, null, crashGuard);
        assert.equal(d.action, 'restart', `exit ${i}`);
    }
});

test('AgentProcess: a deterministic startup crash restarts 4 times with backoff, then ends the main process with 3 (CX23 step 0)', () => {
    const h = harness({ MINDCRAFT_SINGLE_BOT_SERVICE: '1' });
    const ap = new AgentProcess('FRCFLD', 8080, h.deps);
    ap.start();
    for (let i = 0; i < 5; i++) {
        h.advance(20_000);
        h.children[i].emit('exit', 1, null); // uncaught ENOENT: exit 1, no reason file
        if (i < 4) h.timers[i].fn();
    }
    assert.equal(h.children.length, 5);
    assert.deepEqual(h.timers.map(t => t.ms), [10_000, 20_000, 40_000, 80_000]);
    assert.deepEqual(h.exits, [3]);
    assert.ok(h.lines.some(l => /^\[agent_process\] FRCFLD: FATAL \(crash_loop: exit 1 without a reason, 5 times in a row, each within 5 min of the start\)\. Not restarting; a human must act/.test(l)), h.lines.join('\n'));
});

test('decideAgentExit: exit 0, task codes and codes above 3 also start the crash count again (#441 review 3)', () => {
    for (const other of [0, 2, 4, 7]) {
        const policy = createRestartPolicy();
        const crashGuard = createCrashLoopGuard();
        const seq = [1, 1, 1, 1, other, 1, 1, 1, 1].map(code => decideAgentExit({ code, connectedMs: 20_000 }, policy, null, crashGuard));
        assert.ok(!seq.some(d => d.code === 3), `exit ${other} between crashes: ${JSON.stringify(seq.map(d => d.code ?? d.action))}`);
    }
    // A requested stop resets it too.
    const policy = createRestartPolicy();
    const crashGuard = createCrashLoopGuard();
    const seq = [{ code: 1 }, { code: 1 }, { code: 1 }, { code: 1 }, { code: 1, requestedStop: true }, { code: 1 }, { code: 1 }, { code: 1 }, { code: 1 }]
        .map(e => decideAgentExit({ connectedMs: 20_000, ...e }, policy, null, crashGuard));
    assert.ok(!seq.some(d => d.code === 3));
});

function spawnTimeoutRig({ spawnTimeoutMs = 30_000 } = {}) {
    const proc = new EventEmitter();
    proc.env = { MINDCRAFT_EXIT_REASON_FILE: '/reason.json' };
    const bot = new EventEmitter();
    const writes = [];
    let t = 1_000_000;
    let recorded = false;
    const handle = attachSpawnTimeoutReason(bot, {
        spawnTimeoutMs, proc, now: () => t, classify: classifyBeforeJoinError, recorded: () => recorded,
        writeFile: (file, body) => writes.push([file, JSON.parse(body)]),
    });
    return { proc, bot, writes, handle, advance: (ms) => { t += ms; }, record: () => { recorded = true; } };
}

test('attachSpawnTimeoutReason: the spawn-timeout exit(1) gets spawn_timeout[:kind]; crashes, early exits, a spawn or a recorded reason do not (#441 review 1)', () => {
    const plain = spawnTimeoutRig();
    plain.advance(30_000);
    plain.proc.emit('exit', 1);
    assert.deepEqual(plain.writes, [['/reason.json', { category: 'spawn_timeout', exitCode: 1 }]]);

    const dns = spawnTimeoutRig();
    dns.bot.emit('error', Object.assign(new Error('getaddrinfo ENOTFOUND sessionserver.mojang.com'), { code: 'ENOTFOUND' }));
    dns.advance(30_500);
    dns.proc.emit('exit', 1);
    assert.deepEqual(dns.writes.map(w => w[1]), [{ category: 'spawn_timeout:network', exitCode: 1 }]);

    const http = spawnTimeoutRig();
    http.bot.emit('error', new Error('503 Service Unavailable'));
    http.advance(31_000);
    http.proc.emit('exit', 1);
    assert.equal(http.writes[0]?.[1].category, 'spawn_timeout:http-5xx');

    const cases = {
        spawned: (r) => { r.bot.emit('spawn'); r.advance(30_000); r.proc.emit('exit', 1); },
        uncaught: (r) => { r.advance(30_000); r.proc.emit('uncaughtExceptionMonitor', new Error('ENOENT'), 'uncaughtException'); r.proc.emit('exit', 1); },
        rejection: (r) => { r.advance(30_000); r.proc.emit('uncaughtExceptionMonitor', new Error('x'), 'unhandledRejection'); r.proc.emit('exit', 1); },
        recorded: (r) => { r.record(); r.advance(30_000); r.proc.emit('exit', 1); },
        early: (r) => { r.advance(5_000); r.proc.emit('exit', 1); },
        exit3: (r) => { r.advance(30_000); r.proc.emit('exit', 3); },
        exit0: (r) => { r.advance(30_000); r.proc.emit('exit', 0); },
    };
    for (const [name, run] of Object.entries(cases)) {
        const r = spawnTimeoutRig();
        run(r);
        assert.deepEqual(r.writes, [], name);
    }
    const disposed = spawnTimeoutRig();
    disposed.handle.dispose();
    assert.equal(disposed.proc.listenerCount('exit'), 0);
    assert.equal(disposed.proc.listenerCount('uncaughtExceptionMonitor'), 0);
});

test('AgentProcess: 30 spawn timeouts in a row (an outage before login) are retried with backoff and never end with 3 (#441 review 1)', () => {
    const h = harness({ MINDCRAFT_SINGLE_BOT_SERVICE: '1' });
    const ap = new AgentProcess('FRCFLD', 8080, h.deps);
    ap.start();
    const kinds = [null, 'network', 'http-5xx', 'xsts-other'];
    for (let i = 0; i < 30; i++) {
        const child = h.children[i];
        const kind = kinds[i % kinds.length];
        writeExitReason({ category: kind ? `spawn_timeout:${kind}` : 'spawn_timeout', exitCode: 1 }, { env: child.opts.env });
        h.advance(30_000);
        child.emit('exit', 1, null);
        assert.deepEqual(h.exits, [], `spawn timeout ${i + 1}`);
        assert.equal(h.timers.length, i + 1);
        h.timers[i].fn();
    }
    assert.equal(h.children.length, 31);
    assert.equal(h.timers.at(-1).ms, 300_000, 'the backoff reached its cap');
});

test('end to end in real children: a spawn-timeout exit(1) writes spawn_timeout:network; an uncaught throw or rejection before spawn writes nothing', async () => {
    const contract = new URL('../src/exit-contract.js', import.meta.url).href;
    const diag = new URL('../src/auth-diagnostics.js', import.meta.url).href;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-timeout-'));
    const run = async (name, ending) => {
        const file = path.join(dir, `${name}.json`);
        const child = [
            `import { EventEmitter } from 'node:events';`,
            `import { attachSpawnTimeoutReason } from ${JSON.stringify(contract)};`,
            `import { classifyBeforeJoinError } from ${JSON.stringify(diag)};`,
            `const bot = new EventEmitter();`,
            `bot.on('error', () => {});`,
            `attachSpawnTimeoutReason(bot, { spawnTimeoutMs: 1000, classify: classifyBeforeJoinError });`,
            `bot.emit('error', Object.assign(new Error('getaddrinfo ENOTFOUND example.invalid'), { code: 'ENOTFOUND' }));`,
            `setTimeout(() => { ${ending} }, 300);`,
        ].join('\n');
        const code = await new Promise((resolve) => {
            realSpawn(process.execPath, ['--input-type=module', '-e', child], {
                env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, MINDCRAFT_EXIT_REASON_FILE: file }, stdio: 'ignore',
            }).on('exit', resolve);
        });
        return { code, reason: readExitReason(file) };
    };
    try {
        assert.deepEqual(await run('timeout', 'process.exit(1);'), { code: 1, reason: { category: 'spawn_timeout:network', exitCode: 1, fatal: false } });
        assert.deepEqual(await run('throw', "throw new Error('ENOENT: no such file');"), { code: 1, reason: null });
        assert.deepEqual(await run('reject', "Promise.reject(new Error('ENOENT'));"), { code: 1, reason: null });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const tick = () => new Promise((r) => setImmediate(r));

test('SIGTERM on the main process: the agent gets it, nothing restarts, the main process exits 0 once the agent has exited', async () => {
    const h = harness({ MINDCRAFT_SINGLE_BOT_SERVICE: '1' }, { killEmits: false });
    const kills = [];
    const ap = new AgentProcess('FRCFLD', 8080, h.deps);
    ap.start();
    h.children[0].kill = (sig) => kills.push(sig);
    h.deps.signals.emit('SIGTERM', 'SIGTERM');
    assert.deepEqual(kills, ['SIGTERM']);
    assert.deepEqual(h.exits, [], 'waits for the agent');
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].ms, 5000, 'the deadline');
    h.children[0].emit('exit', 0, null); // graceful-quit.js: quit, then exit 0
    await tick();
    assert.deepEqual(h.exits, [0], 'exit(0) once (#442 nit)');
    assert.equal(h.timers[0].cleared, true, 'the deadline is cleared');
    assert.equal(h.timers.length, 1, 'no restart scheduled');
    assert.equal(h.children.length, 1);
    assert.ok(h.lines.some(l => /^\[agent_process\] SIGTERM: stopping 1 agent\(s\), exiting within 5 s\.$/.test(l)));
});

test('SIGINT with several agents (multi-bot main process): every agent is stopped, then one exit 0', async () => {
    const h = harness({}, { killEmits: false });
    const a = new AgentProcess('A1', 8080, h.deps);
    const b = new AgentProcess('B2', 8080, h.deps);
    a.start(); b.start();
    const kills = [];
    for (const c of h.children) c.kill = (sig) => kills.push(sig);
    h.deps.signals.emit('SIGINT', 'SIGINT');
    assert.deepEqual(kills, ['SIGINT', 'SIGINT']);
    h.children[0].emit('exit', 0, null);
    await tick();
    assert.deepEqual(h.exits, [], 'B2 is still running');
    h.children[1].emit('exit', null, 'SIGINT'); // an agent without the handler still counts as stopped
    await tick();
    assert.deepEqual(h.exits, [0]);
    assert.equal(h.children.length, 2, 'nothing restarted');
});

test('SIGTERM: an agent that does not exit is killed at the deadline; a pending restart is cancelled; a second signal exits at once', async () => {
    const stuck = harness({ MINDCRAFT_SINGLE_BOT_SERVICE: '1' }, { killEmits: false });
    const ap = new AgentProcess('FRCFLD', 8080, stuck.deps);
    ap.start();
    const kills = [];
    stuck.children[0].kill = (sig) => kills.push(sig);
    stuck.deps.signals.emit('SIGTERM', 'SIGTERM');
    stuck.timers[0].fn();
    assert.deepEqual(kills, ['SIGTERM', 'SIGKILL']);
    assert.deepEqual(stuck.exits, [0]);

    const backoff = harness({ MINDCRAFT_SINGLE_BOT_SERVICE: '1' });
    const bp = new AgentProcess('FRCFLD', 8080, backoff.deps);
    bp.start();
    backoff.children[0].emit('exit', 1, null);
    assert.equal(backoff.timers.length, 1, 'restart pending');
    backoff.deps.signals.emit('SIGTERM', 'SIGTERM');
    assert.equal(backoff.timers[0].cleared, true, 'the pending restart is cancelled');
    await tick();
    assert.deepEqual(backoff.exits, [0]);
    bp.start(true, 'Agent process restarted.', 0); // a forceRestart's late once('exit') path
    assert.equal(backoff.children.length, 1, 'nothing starts after a stop signal');

    const twice = harness({}, { killEmits: false });
    new AgentProcess('FRCFLD', 8080, twice.deps).start();
    twice.children[0].kill = () => {};
    twice.deps.signals.emit('SIGINT', 'SIGINT');
    assert.deepEqual(twice.exits, []);
    twice.deps.signals.emit('SIGINT', 'SIGINT');
    assert.deepEqual(twice.exits, [0]);
    assert.ok(twice.lines.some(l => /SIGINT again: exiting now/.test(l)));
});

test('a stop signal ends the main process with exactly one exit(0), also when the deadline and the agent exit race (#442 nit)', async () => {
    const h = harness({ MINDCRAFT_SINGLE_BOT_SERVICE: '1' }, { killEmits: false });
    const ap = new AgentProcess('FRCFLD', 8080, h.deps);
    ap.start();
    h.children[0].kill = () => {};
    h.deps.signals.emit('SIGTERM', 'SIGTERM');
    h.timers[0].fn(); // the deadline fires first
    h.children[0].emit('exit', 0, null); // then the agent exits
    await tick();
    h.deps.signals.emit('SIGTERM', 'SIGTERM'); // and a second signal
    assert.deepEqual(h.exits, [0]);
    assert.ok(h.lines.some(l => /FRCFLD: stopped \(stop requested \(single-bot service\)\)\./.test(l)), h.lines.join('\n'));
});

test('attachSpawnTimeoutReason: a second initBot in the same process replaces the listeners, the newest bot counts (#441 nit)', () => {
    const proc = new EventEmitter();
    proc.env = { MINDCRAFT_EXIT_REASON_FILE: '/reason.json' };
    const writes = [];
    let t = 0;
    const opts = { spawnTimeoutMs: 1000, proc, now: () => t, writeFile: (f, b) => writes.push(JSON.parse(b)) };
    const first = new EventEmitter();
    const h1 = attachSpawnTimeoutReason(first, opts);
    const second = new EventEmitter();
    attachSpawnTimeoutReason(second, opts);
    assert.equal(proc.listenerCount('exit'), 1);
    assert.equal(proc.listenerCount('uncaughtExceptionMonitor'), 1);
    h1.dispose(); // the old handle no longer owns the listeners
    assert.equal(proc.listenerCount('exit'), 1);
    t = 5_000;
    proc.emit('exit', 1); // neither bot spawned: one reason, not one per initBot
    assert.deepEqual(writes, [{ category: 'spawn_timeout', exitCode: 1 }]);
});
