// Offline tests for the G4 service adapter (test/runner/lib/service.mjs): the CX23 bot driven through the ssh gate
// (ADR 0009). An async fake exec plays ssh + gate + ctl: it records argv, keeps a unit state and a journal, and can
// refuse (126), fail (255), have the ctl refuse (2), or hold a call in flight. Nothing connects anywhere.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GateRefusal, HOST, SSH_OPTS, STATUS_FAIL_LIMIT, exitReason, exitedText, keptStderr, linesFromStart, parseJournalLine, parseMetrics, redactAddresses, serviceBot, sinceStamp } from '../runner/lib/service.mjs';
import { startSession } from '../runner/lib/session.mjs';
import { runScenario } from '../runner/lib/runner.mjs';
import { parseArgs } from '../runner/run.mjs';
import { G4_SERVICE_NOT_GATE, G4_TEST_SERVER_NOT_GATE, g3Policy } from '../runner/lib/g3.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, '..', 'runner', 'lib', 'service.mjs'), 'utf8');
const T0 = Date.parse('2026-11-08T12:00:00Z');
const stamp = (ms) => new Date(ms).toISOString().slice(0, 19) + '+0000';
const GO = { ROTN_SERVICE_GO: 'g4-s1-20261108:frcfld:test-server-host-confirmed' };
// Addresses built at run time, so the source holds only <ip>-style placeholders (#371 review): an IPv4 and an IPv6.
const IP4 = ['192', '0', '2', '7'].join('.');
const IP6 = ['fd00', '', '7'].join(':');

/** A fake CX23 behind ssh. opts.refuse(verb) -> 126; opts.fail(verb) -> 255 (opts.failTimes of them); opts.ctl2(verb) -> 2; opts.hold(verb) -> held until released. */
function fakeCx23(opts = {}) {
    const clock = { t: T0 };
    const calls = [];
    const st = { state: 'inactive' };
    const journal = [`${stamp(T0 - 30000)} node[90]: [agent_process] FRCFLD: an OLD run's line`];
    const failsLeft = {};
    const held = [];
    const add = (ms, ident, msg) => journal.push(`${stamp(ms)} ${ident}: ${msg}`);
    const answer = (verb, bot, rest) => {
        if (opts.refuse?.(verb)) return { code: 126, stdout: '', stderr: 'rotn-ssh-gate: refused. Allowed: status|start|stop|metrics BOT; journal BOT [--since ...]\n' };
        if (opts.fail?.(verb)) {
            failsLeft[verb] = failsLeft[verb] ?? opts.failTimes ?? 99;
            if (failsLeft[verb] > 0) {
                failsLeft[verb]--;
                return { code: 255, stdout: '', stderr: 'ssh: connect to host cx23.example.net port 22: Connection timed out\n' };
            }
        }
        if (opts.ctl2?.(verb)) return { code: 2, stdout: '', stderr: `Warning: Permanently added 'cx23.example.net' (ED25519) to the list of known hosts.\nmindcraft-rotn-ctl: no env file for '${bot}' (run bootstrap.sh add-bot ${bot})\n` };
        if (st.state === 'activating' && clock.t - st.startedAt >= 8000) { st.state = 'active'; add(st.startedAt + 8000, 'node[123]', 'FRCFLD spawned.'); }
        switch (verb) {
            case 'start':
                if (st.state === 'inactive' || st.state === 'failed') { st.state = 'activating'; st.startedAt = clock.t; add(clock.t, 'systemd[1]', `Starting mindcraft-rotn@${bot}.service - Mindcraft RotN bot ${bot}...`); }
                return { code: 0, stdout: '', stderr: '' };
            case 'stop':
                if (!opts.stuck) { st.state = 'inactive'; add(clock.t, 'systemd[1]', `Stopped mindcraft-rotn@${bot}.service.`); }
                return { code: 0, stdout: '', stderr: '' };
            case 'metrics':
                return { code: 0, stdout: `MemoryCurrent=314572800\nMemoryPeak=[not set]\nNRestarts=0\nActiveState=${st.state}\n`, stderr: '' };
            case 'status':
                return { code: st.state === 'active' ? 0 : 3, stdout: `● mindcraft-rotn@${bot}.service\n     Active: ${st.state}\n`, stderr: '' };
            case 'journal': {
                const since = Date.parse(String(rest[1]).replace(/Z?$/, 'Z'));
                return { code: 0, stdout: journal.filter((l) => !(since > Date.parse(l.slice(0, 19) + 'Z'))).join('\n') + '\n', stderr: '' };
            }
            default:
                return { code: 126, stdout: '', stderr: '' };
        }
    };
    const exec = (prog, argv, o) => {
        calls.push({ prog, argv, o });
        const [verb, bot, ...rest] = argv.slice(SSH_OPTS.length + 1);
        if (opts.hold?.(verb)) return new Promise((resolve) => held.push(() => resolve(answer(verb, bot, rest))));
        return Promise.resolve(answer(verb, bot, rest));
    };
    return { clock, calls, st, add, exec, held, verbs: () => calls.map((c) => c.argv[SSH_OPTS.length + 1]) };
}
const mk = (cx, extra = {}) => serviceBot('frcfld', extra.outFile ?? null, {
    exec: cx.exec, env: GO, now: () => cx.clock.t, sleep: (ms) => { cx.clock.t += ms; return Promise.resolve(); }, ...extra,
});

describe('the service adapter: argv through the gate, never a shell string', () => {
    test('every request is ssh [BatchMode, ConnectTimeout, no forwarding of any kind, -T] cx23-ctl VERB BOT [...]', async () => {
        const cx = fakeCx23();
        const b = mk(cx);
        await b.start();
        b.alive();
        await b.settle();
        b.output();
        await b.settle();
        await b.statusText();
        assert.deepEqual(SSH_OPTS, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ClearAllForwardings=yes', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no', '-T']);
        assert.equal(HOST, 'cx23-ctl');
        assert.deepEqual(cx.calls.map((c) => c.argv), [
            [...SSH_OPTS, 'cx23-ctl', 'start', 'frcfld'],
            [...SSH_OPTS, 'cx23-ctl', 'metrics', 'frcfld'],
            [...SSH_OPTS, 'cx23-ctl', 'journal', 'frcfld', '--since', '2026-11-08T11:59:00Z'],
            [...SSH_OPTS, 'cx23-ctl', 'status', 'frcfld'],
        ]);
        assert.ok(cx.calls.every((c) => c.prog === 'ssh'));
        assert.equal(sinceStamp(T0 - 60000), '2026-11-08T11:59:00Z');
    });

    test('#371 review 4 and 6: async execFile with shell false, no spawnSync or Atomics.wait; the alias is hard-wired (no host option)', () => {
        assert.match(SRC, /execFile\(prog, argv, \{ encoding: 'utf8', timeout, maxBuffer, shell: false \}/);
        const code = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
        assert.ok(!/spawnSync|Atomics\.wait/.test(code), 'nothing blocks the event loop');
        assert.ok(!/\bhost\s*=/.test(code), 'no host parameter');
        assert.match(SRC, /^export const HOST = 'cx23-ctl';$/m);
    });

    test('a bad bot name or --since is refused before anything is sent', async () => {
        const cx = fakeCx23();
        for (const bad of ['FRCFLD', '-x', 'a b', 'a;id', '', 'a'.repeat(33)]) assert.throws(() => serviceBot(bad, null, { exec: cx.exec, env: GO }), /not a valid bot name/, bad);
        const b = mk(cx);
        for (const bad of ['2026-11-08 12:00', '1h', 'yesterday', '@', '2026-11-08T12:00:00+01:00']) await assert.rejects(() => b.journal(bad), /bad --since/, bad);
        assert.equal(cx.calls.length, 0);
    });
});

describe('#371 review 1: the per-run GO marker', () => {
    test('start and stop refuse without ROTN_SERVICE_GO=<GO id>:<unit>:test-server-host-confirmed; nothing is sent', async () => {
        for (const env of [{}, { ROTN_SERVICE_GO: '' }, { ROTN_SERVICE_GO: 'g4-s1' }, { ROTN_SERVICE_GO: 'g4-s1:yes' }, { ROTN_SERVICE_GO: ':frcfld:test-server-host-confirmed' },
            { ROTN_SERVICE_GO: 'a b:frcfld:test-server-host-confirmed' }, { ROTN_SERVICE_GO: 'g4-s1:frcfld:test-server-host-confirmed ' }, { ROTN_SERVICE_GO: 'g4-s1:FRCFLD:test-server-host-confirmed' }]) {
            const cx = fakeCx23();
            const b = serviceBot('frcfld', null, { exec: cx.exec, env });
            assert.throws(() => b.start(), /service start refused: no GO marker\. Set ROTN_SERVICE_GO=<the lead's GO id>:frcfld:test-server-host-confirmed only under the lead's written GO for frcfld, after the human confirmed/, JSON.stringify(env));
            assert.equal(cx.calls.length, 0);
            assert.equal(b.needsStop(), false);
        }
        // #401 review: the old form without a unit is named as such.
        const old = serviceBot('frcfld', null, { exec: fakeCx23().exec, env: { ROTN_SERVICE_GO: 'g4-s1:test-server-host-confirmed' } });
        assert.throws(() => old.start(), /service start refused: the GO marker has the old form without a unit\. Set ROTN_SERVICE_GO=<the lead's GO id>:frcfld:test-server-host-confirmed/);
        // #401 re-review: a stop with no start sends nothing; once a start went out under a checked marker, the stop uses
        // that start's GO and unit, even with the marker gone by then (the cleanup must stop what was started).
        const none = fakeCx23();
        await serviceBot('frcfld', null, { exec: none.exec, env: {} }).stop();
        await serviceBot('frcfld', null, { exec: none.exec, env: GO }).stop();
        assert.equal(none.calls.length, 0, 'no start, no stop sent');
        const cx = fakeCx23();
        const env = { ...GO };
        const b = serviceBot('frcfld', null, { exec: cx.exec, env, now: () => cx.clock.t, sleep: () => Promise.resolve() });
        await b.start();
        assert.equal(b.goId, 'g4-s1-20261108');
        delete env.ROTN_SERVICE_GO;
        await b.stop();
        assert.deepEqual(cx.verbs().filter((v) => v === 'start' || v === 'stop'), ['start', 'stop']);
        assert.equal(b.goId, 'g4-s1-20261108');
    });

    test('#401 review: the marker is per bot: a frcfld GO cannot start rotnbot2, nor a rotnbot2 GO frcfld (nothing sent); a started unit\'s stop is its own', async () => {
        for (const [unit, other] of [['rotnbot2', 'frcfld'], ['frcfld', 'rotnbot2']]) {
            const cx = fakeCx23();
            const env = { ROTN_SERVICE_GO: `g4-12a:${other}:test-server-host-confirmed` };
            const b = serviceBot(unit, null, { exec: cx.exec, env, now: () => cx.clock.t, sleep: () => Promise.resolve() });
            assert.deepEqual(b.goStatus(), { ok: false, why: `the GO marker names ${other}, not this unit ${unit}` });
            assert.throws(() => b.start(), new RegExp(`^Error: service start refused: the GO marker names ${other}, not this unit ${unit}$`));
            assert.equal(cx.calls.length, 0, `${unit}: nothing sent`);
            // A start under this unit's own GO, then the marker switched to the other unit: the stop still stops THIS unit
            // (the GO and unit of its start, #401 re-review), and nothing ever goes to the other unit.
            env.ROTN_SERVICE_GO = `g4-12a:${unit}:test-server-host-confirmed`;
            assert.deepEqual(b.goStatus(), { ok: true, goId: 'g4-12a' });
            await b.start();
            env.ROTN_SERVICE_GO = `g4-12a:${other}:test-server-host-confirmed`;
            await b.stop();
            assert.deepEqual(cx.verbs().filter((v) => v === 'start' || v === 'stop'), ['start', 'stop'], `${unit}: its own start and stop`);
            assert.ok(cx.calls.every((c) => c.argv[SSH_OPTS.length + 2] === unit), `${unit}: nothing to ${other}`);
        }
    });

    test('#401 re-review: the runner\'s cleanup stops a unit it started even when the marker breaks after the start and the scenario throws', async () => {
        const cx = fakeCx23();
        const env = { ...GO };
        const b = serviceBot('frcfld', null, { exec: cx.exec, env, now: () => cx.clock.t, sleep: (ms) => { cx.clock.t += ms; return Promise.resolve(); } });
        const breaks = {
            id: 'marker-breaks', gate: 'G4', title: 'test', checks: { started: 'x' }, defaults: {},
            async run(ctx) {
                await ctx.bot.start();
                ctx.check('started', true, 'sent');
                delete env.ROTN_SERVICE_GO;
                throw new Error('the scenario failed after the start');
            },
        };
        const r = await runScenario(breaks, { server: { console: () => [], log: () => [] }, bot: b, clock: { now: () => cx.clock.t, sleep: () => Promise.resolve() }, runId: 'r1' });
        assert.match(r.error, /the scenario failed after the start/);
        assert.equal(r.botStoppedByRunner, true);
        assert.deepEqual(cx.verbs().filter((v) => v === 'start' || v === 'stop'), ['start', 'stop']);
        assert.deepEqual(cx.calls.filter((c) => c.argv[SSH_OPTS.length + 1] === 'stop').map((c) => c.argv.slice(SSH_OPTS.length)), [[HOST, 'stop', 'frcfld']]);
        assert.equal(cx.st.state, 'inactive');
    });

    test('#401 review: a failed request carries its exit code (exitCode), so the ctl\'s refusal (2) is told apart', async () => {
        const cx = fakeCx23({ ctl2: (v) => v === 'metrics' });
        const b = serviceBot('rotnbot2', null, { exec: cx.exec, env: GO });
        const e = await b.metrics().then(() => null, (x) => x);
        assert.equal(e.exitCode, 2);
        assert.match(e.message, /exited 2 \(the ctl refused it\): mindcraft-rotn-ctl: no env file for 'rotnbot2' \(run bootstrap\.sh add-bot rotnbot2\)/);
    });
});

describe('the service adapter: state, journal, stop', () => {
    test('#371 review 4: alive() never blocks: true while the start is in flight, then cached ActiveState refreshed in the background', async () => {
        const cx = fakeCx23({ hold: (v) => v === 'start' });
        const b = mk(cx, { statusRefreshMs: 10000 });
        assert.equal(b.alive(), false, 'not started');
        const p = b.start();
        assert.equal(b.alive(), true, 'the start is in flight: up (synchronously)');
        cx.held.shift()();
        await p;
        assert.equal(b.alive(), true, 'activating, a refresh started in the background');
        await b.settle();
        const n = cx.calls.length;
        cx.clock.t += 5000;
        assert.equal(b.alive(), true);
        assert.equal(cx.calls.length, n, 'cached within statusRefreshMs');
        cx.clock.t += 6000;
        b.alive();
        await b.settle();
        assert.equal(b.unitState(), 'active');
        cx.st.state = 'failed';
        cx.clock.t += 10000;
        b.alive();
        await b.settle();
        assert.equal(b.alive(), false);
        assert.equal(b.unitState(), 'failed');
        assert.equal(b.exitCode(), null, '#371 review 8: a number or null; the state is unitState()');
    });

    test('output() is the journal from this start on, refreshed in the background; a previous run\'s tail never counts', async () => {
        const cx = fakeCx23();
        const b = mk(cx, { journalRefreshMs: 15000 });
        await b.start();
        cx.clock.t += 9000;
        cx.add(cx.clock.t, 'node[123]', '[agent_process] FRCFLD: kicked_by_operator; restarting in 10 s.');
        assert.deepEqual(b.output(), [], 'not read yet: the refresh runs in the background');
        await b.settle();
        const out = b.output();
        assert.ok(out[0].startsWith('Starting mindcraft-rotn@frcfld.service'), out[0]);
        assert.ok(out.includes('[agent_process] FRCFLD: kicked_by_operator; restarting in 10 s.'));
        assert.ok(!out.some((l) => /OLD run/.test(l)));
        const n = cx.calls.length;
        b.output();
        assert.equal(cx.calls.length, n, 'cached within journalRefreshMs');
        await b.refresh();
        assert.equal(cx.calls.length, n + 2, 'refresh() forces metrics and the journal');
    });

    test('linesFromStart, parseJournalLine, parseMetrics', () => {
        assert.deepEqual(parseJournalLine('2026-11-08T12:00:01+0000 node[123]: hello: world'), { time: '2026-11-08T12:00:01', ident: 'node', msg: 'hello: world' });
        assert.deepEqual(parseJournalLine('2026-11-08T12:00:01+00:00 systemd[1]: Started x.'), { time: '2026-11-08T12:00:01', ident: 'systemd', msg: 'Started x.' });
        assert.equal(parseJournalLine('-- No entries --'), null);
        assert.deepEqual(linesFromStart(['2026-11-08T12:00:01+0000 node[9]: old'], 'frcfld'), []);
        const raw = ['2026-11-08T11:59:30+0000 node[9]: old', '2026-11-08T12:00:00+0000 systemd[1]: Starting mindcraft-rotn@frcfld.service...',
            '2026-11-08T12:00:09+0000 node[123]: new', '2026-11-08T12:10:00+0000 systemd[1]: Starting mindcraft-rotn@frcfld.service...', '2026-11-08T12:10:05+0000 node[200]: after'];
        assert.deepEqual(linesFromStart(raw, 'frcfld').map((p) => p.msg), ['Starting mindcraft-rotn@frcfld.service...', 'new', 'Starting mindcraft-rotn@frcfld.service...', 'after']);
        assert.deepEqual(parseMetrics(['MemoryCurrent=314572800', 'MemoryPeak=[not set]', 'NRestarts=0', 'ActiveState=active', 'junk']),
            { MemoryCurrent: 314572800, MemoryPeak: '[not set]', NRestarts: 0, ActiveState: 'active' });
    });

    test('stop(): `stop`, waits for inactive, writes the journal to the driver log; a unit that stays up is an error; no start, no stop', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-svc-'));
        const outFile = path.join(tmp, 'driver.log');
        const cx = fakeCx23();
        const b = mk(cx, { outFile });
        await b.stop();
        assert.equal(cx.calls.length, 0, 'never started: nothing to stop');
        await b.start();
        cx.clock.t += 9000;
        await b.stop();
        assert.equal(cx.st.state, 'inactive');
        assert.equal(b.needsStop(), false);
        assert.equal(b.alive(), false);
        const log = fs.readFileSync(outFile, 'utf8');
        assert.match(log, /Starting mindcraft-rotn@frcfld\.service/);
        assert.match(log, /Stopped mindcraft-rotn@frcfld\.service\./);
        const cs = fakeCx23({ stuck: true });
        const s = mk(cs, { stopWaitMs: 10000 });
        await s.start();
        await assert.rejects(() => s.stop(), /still (active|activating) 10s after 'stop'/);
        assert.equal(s.needsStop(), true, 'still to stop');
    });
});

describe('the service adapter: refusals and failures', () => {
    test('exit 126 is a GateRefusal: an incident, never retried; from the start it is kept and shown', async () => {
        const cx = fakeCx23({ refuse: (v) => v === 'metrics' });
        const b = mk(cx);
        await assert.rejects(() => b.metrics(), (e) => e instanceof GateRefusal && e.incident === true && e.exitCode === 126
            && /refused 'metrics frcfld' \(exit 126\): an ADR 0009 incident; stop and report to the human \(rotn-ssh-gate: refused\./.test(e.message));
        assert.equal(cx.calls.length, 1, 'no retry');
        assert.match(b.incident, /an ADR 0009 incident/);
        const cs = fakeCx23({ refuse: (v) => v === 'start' });
        const s = mk(cs);
        await s.start();
        assert.equal(s.alive(), false);
        assert.match(s.startError, /refused 'start frcfld' \(exit 126\).*\(the unit's state is unknown\)$/);
        assert.ok(s.output().some((l) => /^\[service\] INCIDENT: /.test(l)));
        assert.equal(s.needsStop(), true, 'a start was sent: the cleanup still stops');
    });

    test('#371 review 2: start is never retried on 255 (state unknown); the reads and stop are retried twice', async () => {
        const cx = fakeCx23({ fail: (v) => v === 'start' });
        const b = mk(cx);
        await b.start();
        assert.deepEqual(cx.verbs(), ['start'], 'one start only');
        assert.equal(b.alive(), false);
        assert.match(b.startError, /exited 255: \(ssh failed; its stderr is not kept\) \(the unit's state is unknown\)$/);
        assert.ok(b.output().includes(`[service] start failed: ${b.startError}`));
        assert.equal(b.needsStop(), true);
        await b.stop();
        assert.ok(cx.verbs().includes('stop'), 'the stop is still sent after a failed start');
        assert.equal(cx.verbs().filter((v) => v === 'start').length, 1, 'never a second start');
        // stop is idempotent in systemd: up to 2 retries on 255 (#371 review); a third 255 is an error.
        const cs = fakeCx23({ fail: (v) => v === 'stop', failTimes: 2 });
        const s = mk(cs);
        await s.start();
        await s.stop();
        assert.equal(cs.verbs().filter((v) => v === 'stop').length, 3, 'two retries, then the stop went through');
        assert.equal(s.needsStop(), false);
        const c3 = fakeCx23({ fail: (v) => v === 'stop', failTimes: 3 });
        const s3 = mk(c3);
        await s3.start();
        await assert.rejects(() => s3.stop(), /service stop: 'stop frcfld' exited 255/);
        assert.equal(c3.verbs().filter((v) => v === 'stop').length, 3);
        assert.equal(c3.verbs().filter((v) => v === 'start').length, 1, 'a start is never sent twice');
        const reads = fakeCx23({ fail: (v) => v === 'metrics', failTimes: 2 });
        const r = mk(reads);
        assert.equal((await r.metrics()).ActiveState, 'inactive');
        assert.equal(reads.calls.length, 3, 'two retries');
        const three = fakeCx23({ fail: (v) => v === 'metrics', failTimes: 3 });
        await assert.rejects(() => mk(three).metrics(), /exited 255/);
    });

    test('#371 review 5: ssh\'s own stderr is never kept (hosts, addresses); the gate\'s and the ctl\'s lines are, addresses redacted', async () => {
        assert.equal(keptStderr('ssh: connect to host cx23.example.net port 22: Connection timed out', 255), '(ssh failed; its stderr is not kept)');
        assert.equal(keptStderr(`Warning: Permanently added '${IP4}' (ED25519) to the list of known hosts.\nmindcraft-rotn-ctl: no env file for 'frcfld'`, 2),
            "mindcraft-rotn-ctl: no env file for 'frcfld' (1 other stderr line not kept)");
        assert.equal(keptStderr(`rotn-ssh-gate: refused from ${IP4} and ${IP6}`, 126), 'rotn-ssh-gate: refused from <ip> and <ip>');
        // A time is not an address (#371 review: the IPv6 pattern took 12:34:56).
        assert.equal(redactAddresses(`mindcraft-rotn-ctl: at 12:34:56 and 2026-11-08T00:00:30Z, from ${IP6}`), 'mindcraft-rotn-ctl: at 12:34:56 and 2026-11-08T00:00:30Z, from <ip>');
        assert.equal(redactAddresses('12:34 1:2:3 ab:cd:ef'), '12:34 1:2:3 ab:cd:ef', 'not IPv6 by node\'s own parser');
        const cx = fakeCx23({ ctl2: (v) => v === 'metrics' });
        await assert.rejects(() => mk(cx).metrics(), (e) => !(e instanceof GateRefusal) && /exited 2 \(the ctl refused it\): mindcraft-rotn-ctl: no env file/.test(e.message)
            && !/example\.net/.test(e.message) && !e.message.includes(IP4));
        const c255 = fakeCx23({ fail: (v) => v === 'metrics' });
        await assert.rejects(() => mk(c255).metrics(), (e) => !/example\.net|connect to host/.test(e.message));
    });
});

describe('#371 review 3: the runner\'s cleanup always stops a service whose start was sent', () => {
    const scenario = { id: 'x', gate: 'G4', checks: { a: 'a' }, defaults: {}, async run(ctx) { ctx.bot.start(); await ctx.clock.sleep(1); ctx.check('a', true, 'ok'); } };
    const fakeBot = (o) => {
        const calls = [];
        return {
            calls, kind: 'service', start() { calls.push('start'); return Promise.resolve(); },
            alive() { if (o.aliveThrows) throw new Error('metrics failed'); return o.alive ?? false; },
            needsStop: () => o.needsStop ?? true, exitCode: () => null, exitSignal: () => null, output: () => [],
            stop() { calls.push('stop'); return o.stopThrows ? Promise.reject(new Error('ssh down')) : Promise.resolve(); },
        };
    };
    const clock = { now: () => 0, sleep: () => Promise.resolve() };
    const server = { console: () => [], log: () => [] };
    test('alive() throws: the stop still runs; a failed start (needsStop, not alive): the stop runs; a failing stop is the run\'s error', async () => {
        const a = fakeBot({ aliveThrows: true });
        await runScenario(scenario, { server, bot: a, clock, runId: 'r', params: {} });
        assert.deepEqual(a.calls, ['start', 'stop']);
        const b = fakeBot({ alive: false, needsStop: true });
        await runScenario(scenario, { server, bot: b, clock, runId: 'r', params: {} });
        assert.deepEqual(b.calls, ['start', 'stop']);
        const c = fakeBot({ alive: true, stopThrows: true });
        const r = await runScenario(scenario, { server, bot: c, clock, runId: 'r', params: {} });
        assert.match(r.error ?? '', /bot\.stop\(\) failed at the end: ssh down/);
        const d = fakeBot({ alive: false, needsStop: false });
        await runScenario(scenario, { server, bot: d, clock, runId: 'r', params: {} });
        assert.deepEqual(d.calls, ['start'], 'nothing to stop');
    });
});

describe('run.mjs --service', () => {
    test('parseArgs: --service BOT; --service-host is gone (the alias is hard-wired)', () => {
        assert.equal(parseArgs(['--scenario', 'x', '--service', 'frcfld']).service, 'frcfld');
        assert.equal(parseArgs(['--scenario', 'x', '--', 'node', 'd.mjs']).service, null);
        assert.throws(() => parseArgs(['--service', 'frcfld', '--service-host', 'other']), /unknown argument '--service-host'/);
    });

    test('run.mjs refuses --service with a driver or --pass-env, and a run with neither', () => {
        const run = (args) => spawnSync(process.execPath, [path.join(here, '..', 'runner', 'run.mjs'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
        const both = run(['--scenario', 'g3-untrusted-refused', '--service', 'frcfld', '--', 'node', 'x.mjs']);
        assert.equal(both.status, 2);
        assert.match(both.stderr, /--service and a driver after -- exclude each other/);
        const pe = run(['--scenario', 'g3-untrusted-refused', '--service', 'frcfld', '--pass-env', 'OPENROUTER_API_KEY']);
        assert.equal(pe.status, 2);
        assert.match(pe.stderr, /--pass-env does not apply to --service/);
        const none = run(['--scenario', 'g3-untrusted-refused']);
        assert.equal(none.status, 2);
        assert.match(none.stderr, /or --service BOT for the CX23 service/);
    });

    test('#371 review 9: the result records the driver as "service <bot> via cx23-ctl", with the GO id and any incident', () => {
        const src = fs.readFileSync(path.join(here, '..', 'runner', 'run.mjs'), 'utf8');
        assert.match(src, /const driverName = o\.service !== null \? `service \$\{o\.service\} via \$\{HOST\}` : o\.driver\.join\(' '\);/);
        assert.match(src, /driver: driverName \},\n\s+bot\.kind === 'service' \? \{ service: \{ goId: bot\.goId \?\? null, startError: bot\.startError \?\? null, incident: bot\.incident \?\? null, stateUnknown: bot\.stateUnknown \?\? null \} \} : \{\},/);
        assert.match(src, /log\(`INCIDENT: \$\{bot\.incident\}`\);\n\s+addNotGate\(result, `an ADR 0009 incident: \$\{bot\.incident\}`\);/);
    });

    test('#433 review: a G4 service run (S) gets its own not-gate reason, "not an acceptance run"; a spawned driver (T) keeps the rehearsal one', () => {
        const g4 = { id: 'g4-soak-2h', gate: 'G4', llm: false };
        const s = g3Policy(g4, {}, undefined, { service: true });
        assert.equal(s.notGate, G4_SERVICE_NOT_GATE);
        assert.match(s.notGate, /CX23 service \(set-up S\) is not an acceptance run: G4 evidence comes only from the step-7 acceptance runs/);
        assert.doesNotMatch(s.notGate, /test server|rehearsal/);
        assert.equal(g3Policy(g4, {}, undefined, { service: false }).notGate, G4_TEST_SERVER_NOT_GATE);
        assert.equal(g3Policy(g4, {}, undefined).notGate, G4_TEST_SERVER_NOT_GATE, 'no opts: the rehearsal reason');
        assert.equal(g3Policy(g4, {}, undefined, { service: 'frcfld' }).notGate, G4_TEST_SERVER_NOT_GATE, 'only a boolean true marks S');
        // Not G4: the service flag changes nothing.
        assert.deepEqual(g3Policy({ gate: 'G3', llm: true }, { ROTN_G3_BATCH: 'b-1:2' }, 2, { service: true }), { guard: true, notGate: null, batch: 'b-1:2' });
        assert.equal(g3Policy({ gate: 'S1', llm: true }, {}, undefined, { service: true }).notGate, null);
        // run.mjs passes the bot's kind: S only for the service adapter.
        const src = fs.readFileSync(path.join(here, '..', 'runner', 'run.mjs'), 'utf8');
        assert.match(src, /g3Policy\(scenario, process\.env, [^\n]*, \{ service: bot\.kind === 'service' \}\);/);
    });

});

describe('#371 review 3: alive() reports the state unknown when status checks keep failing', () => {
    test(`after ${STATUS_FAIL_LIMIT} failed background refreshes in a row: not alive, unitState 'unknown', stateUnknown recorded; a good one recovers`, async () => {
        const cx = fakeCx23();
        const b = mk(cx, { statusRefreshMs: 10000 });
        await b.start();
        b.alive();
        await b.settle();
        assert.equal(b.unitState(), 'activating');
        let failing = true;
        const real = cx.exec;
        const exec = (prog, argv, o) => (failing && argv[SSH_OPTS.length + 1] === 'metrics'
            ? Promise.resolve({ code: 2, stdout: '', stderr: 'mindcraft-rotn-ctl: no env file\n' }) : real(prog, argv, o));
        const b2 = serviceBot('frcfld', null, { exec, env: GO, now: () => cx.clock.t, sleep: () => Promise.resolve(), statusRefreshMs: 10000 });
        await b2.start();
        for (let i = 1; i <= STATUS_FAIL_LIMIT; i++) {
            cx.clock.t += 10000;
            const up = b2.alive();
            await b2.settle();
            if (i < STATUS_FAIL_LIMIT) assert.equal(up, true, `failure ${i}: the last state stands for now`);
        }
        assert.equal(b2.alive(), false, 'never a stale active');
        assert.equal(b2.unitState(), 'unknown');
        assert.equal(b2.stateUnknown.failures, STATUS_FAIL_LIMIT);
        assert.match(b2.stateUnknown.lastError, /the ctl refused it/);
        failing = false;
        cx.clock.t += 10000;
        b2.alive();
        await b2.settle();
        assert.equal(b2.alive(), true, 'a good refresh recovers');
        assert.ok(['activating', 'active'].includes(b2.unitState()), b2.unitState());
    });
});

describe('#371 review 1 and 6: startSession and the service', () => {
    const NAME = 'FRCFLD';
    const mkServer = () => {
        const log = [];
        return {
            console(cmd) { const m = /^say (.*)$/.exec(cmd); if (m) log.push(`[12:00:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: [Server] ${m[1]}`); if (cmd === 'seed') log.push('[12:00:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: Seed: 1'); return log.slice(-1); },
            log: () => log,
        };
    };
    test('a service whose start fails before joining: one start only (no login retry), and the reason names the unit, not an exit code', async () => {
        const calls = [];
        const bot = {
            kind: 'service', start() { calls.push('start'); }, alive: () => false, exitCode: () => null, unitState: () => 'failed',
            startError: 'service start: \'start frcfld\' exited 1 (the unit\'s state is unknown)',
            output: () => [`Error: Failed to obtain profile data for ${NAME}, does the account own minecraft?`],
        };
        const notes = {};
        const ctx = { server: mkServer(), bot, clock: { now: () => 0, sleep: () => Promise.resolve() }, params: { consoleWaitS: 0, logTail: 100, loginTimeoutMs: 1000, pollMs: 100 },
            runId: 'r', note: (k, v) => { notes[k] = v; }, notGate: () => {}, waitFor: (fn) => Promise.resolve(fn()) };
        const s = await startSession(ctx, { name: NAME, checkNaming: false });
        assert.deepEqual(calls, ['start'], 'never a second start for the service');
        assert.equal(notes.loginRetry.retried, false);
        assert.equal(s.ok, false);
        assert.equal(s.why, "the service was not up before joining (unit failed; service start: 'start frcfld' exited 1 (the unit's state is unknown))");
        assert.doesNotMatch(s.why, /code null/);
    });

});

describe('#379 review: bounded redaction work; how a stopped bot is named', () => {
    test('redactAddresses stays fast on long input (it took 26 s on 4000 characters); keptStderr cuts each line to 300 first', () => {
        for (const n of [4000, 100000]) {
            const t = Date.now();
            redactAddresses('a:'.repeat(n / 2) + 'x');
            assert.ok(Date.now() - t < 500, `${n} characters took ${Date.now() - t} ms`);
        }
        const long = `mindcraft-rotn-ctl: ${'b:'.repeat(3000)} ${IP4}`;
        const t = Date.now();
        const kept = keptStderr(long, 2);
        assert.ok(Date.now() - t < 500);
        assert.ok(kept.length <= 300, String(kept.length));
        assert.equal(redactAddresses(`from ${IP6} at 12:34:56`), 'from <ip> at 12:34:56', 'the bound changes nothing for real input');
    });

    test('exitReason and exitedText: a driver by its exit code, the service by its unit state and start error', () => {
        const driver = { exitCode: () => 1 };
        assert.equal(exitReason(driver), 'code 1');
        assert.equal(exitedText(driver), 'the driver exited with code 1');
        const svc = { kind: 'service', exitCode: () => null, unitState: () => 'failed', startError: null };
        assert.equal(exitReason(svc), 'unit failed');
        assert.equal(exitedText(svc), 'the service is down (unit failed)');
        const svc2 = { kind: 'service', exitCode: () => null, unitState: () => null, startError: "service start: 'start frcfld' exited 255 (the unit's state is unknown)" };
        assert.equal(exitedText(svc2), "the service is down (unit state unknown; service start: 'start frcfld' exited 255 (the unit's state is unknown))");
        assert.doesNotMatch(exitedText(svc), /code null/);
    });
});
