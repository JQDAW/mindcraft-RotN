// Offline tests for the G4 service adapter (test/runner/lib/service.mjs): the CX23 bot driven through the ssh gate
// (ADR 0009). A fake `ssh` (the injected spawn) plays the gate and the ctl: it records argv, keeps a unit state and a
// journal, and can refuse (126), drop the connection (255) or have the ctl refuse (2). Nothing connects anywhere.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { GateRefusal, SSH_OPTS, linesFromStart, parseJournalLine, parseMetrics, serviceBot, sinceStamp } from '../runner/lib/service.mjs';
import { parseArgs } from '../runner/run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse('2026-11-08T12:00:00Z');
const stamp = (ms) => new Date(ms).toISOString().slice(0, 19) + '+0000';

/** A fake CX23: ssh argv in, {status, stdout, stderr} out. opts.refuse(verb) -> 126; opts.drop: n first calls 255; opts.ctl2(verb) -> 2. */
function fakeCx23(opts = {}) {
    const clock = { t: T0 };
    const calls = [];
    const st = { state: 'inactive', nrestarts: 0, startedAt: null };
    // The journal holds a previous run's tail first (it must never count as this run's log).
    const journal = [`${stamp(T0 - 30000)} node[90]: [agent_process] FRCFLD: an OLD run's line`];
    let drops = opts.drop ?? 0;
    const add = (ms, ident, msg) => journal.push(`${stamp(ms)} ${ident}: ${msg}`);
    const spawn = (prog, argv, o) => {
        calls.push({ prog, argv, shell: o?.shell });
        if (drops > 0) { drops--; return { status: 255, stdout: '', stderr: 'ssh: connect to host cx23 port 22: Connection timed out' }; }
        const [verb, bot, ...rest] = argv.slice(SSH_OPTS.length + 1);
        if (opts.refuse?.(verb)) return { status: 126, stdout: '', stderr: 'rotn-ssh-gate: refused. Allowed: status|start|stop|metrics BOT; journal BOT [--since ...]\n' };
        if (opts.ctl2?.(verb)) return { status: 2, stdout: '', stderr: `mindcraft-rotn-ctl: no env file for '${bot}'\n` };
        if (st.state === 'activating' && clock.t - st.startedAt >= 8000) {
            st.state = 'active';
            add(st.startedAt + 8000, 'node[123]', 'FRCFLD spawned.');
        }
        switch (verb) {
            case 'start':
                if (st.state === 'inactive' || st.state === 'failed') {
                    st.state = 'activating';
                    st.startedAt = clock.t;
                    add(clock.t, 'systemd[1]', `Starting mindcraft-rotn@${bot}.service - Mindcraft RotN bot ${bot}...`);
                }
                return { status: 0, stdout: '', stderr: '' };
            case 'stop':
                if (!opts.stuck) { st.state = 'inactive'; add(clock.t, 'systemd[1]', `Stopped mindcraft-rotn@${bot}.service.`); }
                return { status: 0, stdout: '', stderr: '' };
            case 'metrics':
                return { status: 0, stdout: `MemoryCurrent=314572800\nMemoryPeak=[not set]\nNRestarts=${st.nrestarts}\nActiveState=${st.state}\n`, stderr: '' };
            case 'status':
                return { status: st.state === 'active' ? 0 : 3, stdout: `● mindcraft-rotn@${bot}.service\n     Active: ${st.state}\n`, stderr: '' };
            case 'journal': {
                const since = rest[1] ? Date.parse(rest[1].replace(/Z?$/, 'Z')) : -Infinity;
                return { status: 0, stdout: journal.filter((l) => Date.parse(l.slice(0, 19) + 'Z') >= since).join('\n') + '\n', stderr: '' };
            }
            default:
                return { status: 126, stdout: '', stderr: 'rotn-ssh-gate: refused.\n' };
        }
    };
    return { clock, calls, st, add, spawn };
}
const mk = (cx, extra = {}) => serviceBot('frcfld', extra.outFile ?? null, {
    spawn: cx.spawn, now: () => cx.clock.t, sleep: (ms) => { cx.clock.t += ms; return Promise.resolve(); }, pause: () => {}, ...extra,
});

describe('the service adapter: argv through the gate, never a shell string', () => {
    test('every request is ssh [-o BatchMode=yes -o ConnectTimeout=15 -T] cx23-ctl VERB BOT [...], as separate argv, no shell', () => {
        const cx = fakeCx23();
        const b = mk(cx);
        b.start();
        b.alive();
        b.output();
        b.statusText();
        assert.deepEqual(cx.calls.map((c) => c.argv), [
            [...SSH_OPTS, 'cx23-ctl', 'start', 'frcfld'],
            [...SSH_OPTS, 'cx23-ctl', 'metrics', 'frcfld'],
            [...SSH_OPTS, 'cx23-ctl', 'journal', 'frcfld', '--since', sinceStamp(T0 - 60000)],
            [...SSH_OPTS, 'cx23-ctl', 'status', 'frcfld'],
        ]);
        assert.ok(cx.calls.every((c) => c.prog === 'ssh' && c.shell === undefined));
        assert.deepEqual(SSH_OPTS, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-T']);
        assert.equal(sinceStamp(T0 - 60000), '2026-11-08T11:59:00Z', 'the gate\'s T form, 60 s before the start (clock skew)');
    });

    test('a bad bot name, ssh alias or --since is refused here, before anything is sent', () => {
        const cx = fakeCx23();
        for (const bad of ['FRCFLD', '-x', 'a b', 'a;id', '', 'a'.repeat(33)]) assert.throws(() => serviceBot(bad, null, { spawn: cx.spawn }), /not a valid bot name/, bad);
        for (const bad of ['cx23 ctl', '-oProxyCommand=x', '', 'a;b']) assert.throws(() => serviceBot('frcfld', null, { host: bad, spawn: cx.spawn }), /not an ssh alias name/, bad);
        const b = mk(cx);
        for (const bad of ['2026-11-08 12:00', '1h', 'yesterday', '@', '2026-11-08T12:00:00+01:00']) assert.throws(() => b.journal(bad), /bad --since/, bad);
        assert.equal(cx.calls.length, 0);
        assert.deepEqual(b.journal('2026-11-08T11:59:00Z'), [`${stamp(T0 - 30000)} node[90]: [agent_process] FRCFLD: an OLD run's line`]);
    });
});

describe('the service adapter: state, journal, stop', () => {
    test('alive() follows ActiveState: activating (start-pre, auto-restart) and active are up; inactive and failed are not; cached', () => {
        const cx = fakeCx23();
        const b = mk(cx, { statusRefreshMs: 10000 });
        assert.equal(b.alive(), false, 'not started: not alive, nothing sent');
        assert.equal(cx.calls.length, 0);
        b.start();
        assert.equal(b.alive(), true, 'activating');
        const n = cx.calls.length;
        cx.clock.t += 5000;
        assert.equal(b.alive(), true);
        assert.equal(cx.calls.length, n, 'cached within statusRefreshMs');
        cx.clock.t += 6000;
        assert.equal(b.alive(), true, 'active');
        assert.equal(cx.st.state, 'active');
        assert.equal(b.exitCode(), null);
        cx.st.state = 'failed';
        cx.clock.t += 10000;
        assert.equal(b.alive(), false);
        assert.equal(b.exitCode(), 'failed');
    });

    test('output() is the journal from this start on: messages only, a previous run\'s tail never counts; cached', () => {
        const cx = fakeCx23();
        const b = mk(cx, { journalRefreshMs: 15000 });
        b.start();
        cx.clock.t += 9000;
        cx.add(cx.clock.t, 'node[123]', '[agent_process] FRCFLD: kicked (transient); restarting in 5 s.');
        const out = b.output();
        assert.ok(out[0].startsWith('Starting mindcraft-rotn@frcfld.service'), out[0]);
        assert.ok(out.includes('[agent_process] FRCFLD: kicked (transient); restarting in 5 s.'), JSON.stringify(out));
        assert.ok(!out.some((l) => /OLD run/.test(l)), 'the old line is before this start');
        const n = cx.calls.length;
        b.output();
        assert.equal(cx.calls.length, n, 'cached within journalRefreshMs');
    });

    test('linesFromStart and parseJournalLine: +0000, +00:00 and Z offsets; no start line yet means nothing', () => {
        assert.deepEqual(parseJournalLine('2026-11-08T12:00:01+0000 node[123]: hello: world'), { time: '2026-11-08T12:00:01', ident: 'node', msg: 'hello: world' });
        assert.deepEqual(parseJournalLine('2026-11-08T12:00:01+00:00 systemd[1]: Started x.'), { time: '2026-11-08T12:00:01', ident: 'systemd', msg: 'Started x.' });
        assert.equal(parseJournalLine('-- No entries --'), null);
        assert.equal(parseJournalLine('mindcraft-rotn-ctl: journal cut at 8388608 bytes'), null);
        assert.deepEqual(linesFromStart(['2026-11-08T12:00:01+0000 node[9]: old'], 'frcfld'), []);
        const raw = ['2026-11-08T11:59:30+0000 node[9]: old', '2026-11-08T12:00:00+0000 systemd[1]: Starting mindcraft-rotn@frcfld.service...',
            '2026-11-08T12:00:09+0000 node[123]: new', '2026-11-08T12:10:00+0000 systemd[1]: Starting mindcraft-rotn@frcfld.service...', '2026-11-08T12:10:05+0000 node[200]: after a systemd restart'];
        assert.deepEqual(linesFromStart(raw, 'frcfld').map((p) => p.msg), ['Starting mindcraft-rotn@frcfld.service...', 'new', 'Starting mindcraft-rotn@frcfld.service...', 'after a systemd restart'],
            'from the FIRST start on: a later systemd restart stays in the log');
        assert.deepEqual(linesFromStart(['2026-11-08T12:00:00+0000 systemd[1]: Starting mindcraft-rotn@other.service...'], 'frcfld'), []);
    });

    test('parseMetrics: numbers stay numbers, [not set] stays a string', () => {
        assert.deepEqual(parseMetrics(['MemoryCurrent=314572800', 'MemoryPeak=[not set]', 'NRestarts=0', 'ActiveState=active', 'junk']),
            { MemoryCurrent: 314572800, MemoryPeak: '[not set]', NRestarts: 0, ActiveState: 'active' });
    });

    test('stop(): `stop`, waits for inactive, writes the journal from this start to the driver log; a unit that stays up is an error', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-svc-'));
        const outFile = path.join(tmp, 'driver.log');
        const cx = fakeCx23();
        const b = mk(cx, { outFile });
        b.start();
        cx.clock.t += 9000;
        await b.stop();
        assert.ok(cx.calls.some((c) => c.argv.at(-2) === 'stop' || c.argv.at(-1) === 'frcfld' && c.argv.at(-2) === 'stop'));
        assert.equal(cx.st.state, 'inactive');
        const log = fs.readFileSync(outFile, 'utf8');
        assert.match(log, /systemd\[1\]: Starting mindcraft-rotn@frcfld\.service/);
        assert.match(log, /node\[123\]: FRCFLD spawned\./);
        assert.match(log, /Stopped mindcraft-rotn@frcfld\.service\./);
        assert.equal(b.alive(), false);
        const cs = fakeCx23({ stuck: true });
        const s = mk(cs, { stopWaitMs: 10000 });
        s.start();
        await assert.rejects(() => s.stop(), /still active 10s after 'stop'/);
    });
});

describe('the service adapter: refusals and failures', () => {
    test('exit 126 is a GateRefusal: an ADR 0009 incident, thrown at once, never retried', () => {
        const cx = fakeCx23({ refuse: (v) => v === 'start' });
        const b = mk(cx);
        assert.throws(() => b.start(), (e) => e instanceof GateRefusal && e.incident === true && e.exitCode === 126
            && /refused 'start frcfld' \(exit 126\): an ADR 0009 incident; stop and report to the human/.test(e.message));
        assert.equal(cx.calls.length, 1, 'no retry');
        const cj = fakeCx23({ refuse: (v) => v === 'journal' });
        const j = mk(cj);
        j.start();
        assert.throws(() => j.output(), GateRefusal);
    });

    test('ssh\'s own failure (255) is retried twice; a third 255 is an error naming it', () => {
        const ok = fakeCx23({ drop: 2 });
        mk(ok).start();
        assert.equal(ok.calls.length, 3);
        assert.equal(ok.st.state, 'activating');
        const bad = fakeCx23({ drop: 3 });
        assert.throws(() => mk(bad).start(), /service start: 'start frcfld' exited 255: ssh: connect to host/);
        assert.equal(bad.calls.length, 3);
    });

    test('the ctl\'s own refusal (2) is an ordinary error, not an incident', () => {
        const cx = fakeCx23({ ctl2: (v) => v === 'start' });
        assert.throws(() => mk(cx).start(), (e) => !(e instanceof GateRefusal) && /exited 2 \(the ctl refused it\): mindcraft-rotn-ctl: no env file/.test(e.message));
    });
});

describe('run.mjs --service', () => {
    test('parseArgs: --service BOT and --service-host ALIAS (default cx23-ctl)', () => {
        assert.deepEqual([parseArgs(['--scenario', 'x', '--service', 'frcfld']).service, parseArgs(['--scenario', 'x', '--service', 'frcfld']).serviceHost], ['frcfld', 'cx23-ctl']);
        assert.equal(parseArgs(['--service', 'frcfld', '--service-host', 'cx23-other']).serviceHost, 'cx23-other');
        assert.equal(parseArgs(['--scenario', 'x', '--', 'node', 'd.mjs']).service, null);
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
});
