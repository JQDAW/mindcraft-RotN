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
import { GateRefusal, HOST, SSH_OPTS, keptStderr, linesFromStart, parseJournalLine, parseMetrics, serviceBot, sinceStamp } from '../runner/lib/service.mjs';
import { runScenario } from '../runner/lib/runner.mjs';
import { parseArgs } from '../runner/run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, '..', 'runner', 'lib', 'service.mjs'), 'utf8');
const T0 = Date.parse('2026-11-08T12:00:00Z');
const stamp = (ms) => new Date(ms).toISOString().slice(0, 19) + '+0000';
const GO = { ROTN_SERVICE_GO: 'g4-s1-20261108:test-server-host-confirmed' };

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
    test('start and stop refuse without ROTN_SERVICE_GO=<GO id>:test-server-host-confirmed; nothing is sent', async () => {
        for (const env of [{}, { ROTN_SERVICE_GO: '' }, { ROTN_SERVICE_GO: 'g4-s1' }, { ROTN_SERVICE_GO: 'g4-s1:yes' }, { ROTN_SERVICE_GO: ':test-server-host-confirmed' },
            { ROTN_SERVICE_GO: 'a b:test-server-host-confirmed' }, { ROTN_SERVICE_GO: 'g4-s1:test-server-host-confirmed ' }]) {
            const cx = fakeCx23();
            const b = serviceBot('frcfld', null, { exec: cx.exec, env });
            assert.throws(() => b.start(), /service start refused: no GO marker\. Set ROTN_SERVICE_GO=<the lead's GO id>:test-server-host-confirmed only under the lead's written GO, after the human confirmed/, JSON.stringify(env));
            assert.equal(cx.calls.length, 0);
            assert.equal(b.needsStop(), false);
        }
        // stop needs it too (a start sent under one GO, the marker gone at the stop).
        const cx = fakeCx23();
        const env = { ...GO };
        const b = serviceBot('frcfld', null, { exec: cx.exec, env, now: () => cx.clock.t, sleep: () => Promise.resolve() });
        await b.start();
        assert.equal(b.goId, 'g4-s1-20261108');
        delete env.ROTN_SERVICE_GO;
        await assert.rejects(() => b.stop(), /service stop refused: no GO marker/);
        assert.deepEqual(cx.verbs(), ['start']);
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

    test('#371 review 2: start and stop are never retried on 255 (state unknown); the reads are retried twice', async () => {
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
        const cs = fakeCx23({ fail: (v) => v === 'stop' });
        const s = mk(cs);
        await s.start();
        await assert.rejects(() => s.stop(), /service stop: 'stop frcfld' exited 255/);
        assert.equal(cs.verbs().filter((v) => v === 'stop').length, 1, 'stop not retried');
        const reads = fakeCx23({ fail: (v) => v === 'metrics', failTimes: 2 });
        const r = mk(reads);
        assert.equal((await r.metrics()).ActiveState, 'inactive');
        assert.equal(reads.calls.length, 3, 'two retries');
        const three = fakeCx23({ fail: (v) => v === 'metrics', failTimes: 3 });
        await assert.rejects(() => mk(three).metrics(), /exited 255/);
    });

    test('#371 review 5: ssh\'s own stderr is never kept (hosts, addresses); the gate\'s and the ctl\'s lines are, addresses redacted', async () => {
        assert.equal(keptStderr('ssh: connect to host cx23.example.net port 22: Connection timed out', 255), '(ssh failed; its stderr is not kept)');
        assert.equal(keptStderr("Warning: Permanently added '203.0.113.7' (ED25519) to the list of known hosts.\nmindcraft-rotn-ctl: no env file for 'frcfld'", 2),
            "mindcraft-rotn-ctl: no env file for 'frcfld' (1 other stderr line not kept)");
        assert.equal(keptStderr('rotn-ssh-gate: refused from 203.0.113.7 and 2001:db8::1', 126), 'rotn-ssh-gate: refused from <ip> and <ip>');
        const cx = fakeCx23({ ctl2: (v) => v === 'metrics' });
        await assert.rejects(() => mk(cx).metrics(), (e) => !(e instanceof GateRefusal) && /exited 2 \(the ctl refused it\): mindcraft-rotn-ctl: no env file/.test(e.message)
            && !/example\.net|203\.0\.113/.test(e.message));
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
        assert.match(src, /driver: driverName \},\n\s+bot\.kind === 'service' \? \{ service: \{ goId: bot\.goId \?\? null, startError: bot\.startError \?\? null, incident: bot\.incident \?\? null \} \} : \{\},/);
        assert.match(src, /log\(`INCIDENT: \$\{bot\.incident\}`\);\n\s+addNotGate\(result, `an ADR 0009 incident: \$\{bot\.incident\}`\);/);
    });
});
