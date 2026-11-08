// Offline tests for G4 #1, test/scenarios/g4/g4-service-reconnect.mjs. A simulated test server (1.12's log lines,
// the console's kick, the ctl's restart, optionally a log roll-over at the restart) and a simulated CX23 service
// (lib/service.mjs's interface: metrics, a journal with agent_process's restart lines, a ctl stop). No server, no ssh.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import { consoleAllowFor } from '../runner/lib/g3.mjs';
import reconnect, { restartLines } from '../scenarios/g4/g4-service-reconnect.mjs';
import { SSH_OPTS, serviceBot } from '../runner/lib/service.mjs';

const NAME = 'FRCFLD';
const S = 1000;
const tick = () => new Promise((r) => setImmediate(r));
const stamp = (ms) => {
    const s = 12 * 3600 + Math.floor(ms / 1000);
    return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const line = (ms, msg) => `[${stamp(ms)}] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}`;

/**
 * opt.driver: a spawned driver (set-up T), not the service; opt.activeAtStart: the unit runs already;
 * opt.noKickRejoin; opt.fatalAfterKick; opt.systemdRestart (NRestarts rises at the kick); opt.restartFails;
 * opt.restartRejoinS (default 60 after the new Done); opt.rotate: the restart rolls latest.log over;
 * opt.stopFailed (the unit ends failed); opt.restartAfterStop (a restart line after the stop);
 * opt.kickIgnored (the server never shows the bot gone); opt.noKickLine (it rejoins with no restart line);
 * opt.kickClass / opt.restartClass (another class in the restart line); opt.unitBot (the service's bot name);
 * opt.insecure (the settings line says true); opt.noSettings (no settings line).
 */
function sim(opt = {}) {
    let t = 0;
    let rolled = [];     // the rolled-over file after a restart (opt.rotate)
    let log = [];
    const journal = [];
    const journalAt = [];   // the sim time of each journal line (for the serviceBot test's fake journalctl)
    const sent = [];
    const unit = { state: opt.activeAtStart ? 'active' : 'inactive', nrestarts: 0 };
    const pending = [];  // [atMs, fn]
    const at = (ms, fn) => pending.push([ms, fn]);
    const add = (msg) => log.push(line(t, msg));
    const jr = (msg) => { journal.push(msg); journalAt.push(t); };
    let online = false;
    const join = () => {
        online = true;
        log.push(`[${stamp(t)}] [User Authenticator #1/INFO] [net.minecraft.server.network.NetHandlerLoginServer]: UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`);
        add(`${NAME} joined the game`);
    };
    const leave = (reason) => { if (!online) return; online = false; add(`${NAME} lost connection: ${reason}`); add(`${NAME} left the game`); };
    const advance = () => {
        pending.sort((a, b) => a[0] - b[0]);
        while (pending.length && pending[0][0] <= t) pending.shift()[1]();
    };
    const server = {
        console(cmd, waitS = 1) {
            advance();
            sent.push(cmd);
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
            else if (cmd === 'seed') add('Seed: 1880465901402976865');
            else if (cmd === `kick ${NAME}` && online && !opt.kickIgnored) {
                add(`Kicked ${NAME} from the game: 'Kicked by an operator'`);
                leave('Kicked by an operator');
                if (opt.systemdRestart) unit.nrestarts++;
                if (opt.fatalAfterKick) at(t + 1 * S, () => jr(`[agent_process] ${NAME}: FATAL (kicked_by_operator: 3 times in a row). Not restarting; a human must act (see coord/NEEDS-HUMAN.md).`));
                else {
                    if (!opt.noKickLine) at(t + 1 * S, () => jr(`[agent_process] ${NAME}: ${opt.kickClass ?? 'kicked_by_operator'}; restarting in 10 s.`));
                    if (!opt.noKickRejoin) at(t + 15 * S, join);
                }
            }
            t += waitS * 1000;
            advance();
            return log.slice(before);
        },
        log: (n) => { advance(); return log.slice(-n); },
        logRotated: (n) => { advance(); return { files: opt.rotate ? ['2026-11-08-1.log.gz', 'latest.log'] : ['latest.log'], lines: [...rolled, ...log].slice(-n) }; },
        restart(timeoutS) {
            sent.push(`restart ${timeoutS}`);
            if (opt.restartFails) throw new Error('restart failed (5): rotn-test: no new Done line 300s after the start');
            add('Stopping server');
            leave('Server closed');
            jr(`[agent_process] ${NAME}: ${opt.restartClass ?? 'server_stopping'}; restarting in 20 s.`);
            t += 90 * S;
            jr(`[agent_process] ${NAME}: ${opt.restartClass ?? 'network'}; restarting in 40 s.`);
            if (opt.rotate) { rolled = log; log = []; }
            add('Done (41.2s)! For help, type "help" or "?"');
            at(t + (opt.restartRejoinS ?? 60) * S, join);
            return [`restarted: [${stamp(t)}] Done (41.2s)! For help`];
        },
    };
    const bot = {
        ...(opt.driver ? {} : { kind: 'service', bot: opt.unitBot ?? 'frcfld' }),
        start() {
            sent.push('ctl start');
            unit.state = 'active';
            jr(`Starting mindcraft-rotn@frcfld.service - Mindcraft RotN bot frcfld...`);
            if (!opt.noSettings) at(t + 5 * S, () => jr(`[settings] effective allow_insecure_coding=${opt.insecure ? 'true' : 'false'}`));
            at(t + 20 * S, join);
        },
        alive: () => unit.state === 'active',
        exitCode: () => (unit.state === 'active' ? null : unit.state),
        exitSignal: () => null,
        output: () => { advance(); return journal; },
        metrics: () => ({ MemoryCurrent: 314572800, MemoryPeak: '[not set]', NRestarts: unit.nrestarts, ActiveState: unit.state }),
        stop() {
            sent.push('ctl stop');
            if (unit.state !== 'active') return Promise.resolve();
            leave('Disconnected');
            jr(`[agent_process] ${NAME}: stop requested (single-bot service); ending the main process with 0.`);
            if (opt.restartAfterStop) jr(`[agent_process] ${NAME}: network; restarting in 10 s.`);
            unit.state = opt.stopFailed ? 'failed' : 'inactive';
            return Promise.resolve();
        },
    };
    const clock = { now: () => t, sleep: async (ms) => { t += ms; advance(); for (let i = 0; i < 3; i++) await tick(); } };
    return { server, bot, clock, sent, unit, journal, journalAt };
}

const run = (s, params = {}) => runScenario(reconnect, { ...s, runId: 'r1', params: { consoleWaitS: 0, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));

describe('g4-service-reconnect: the module', () => {
    test('G4, set-up S, no LLM record (the CX23 key is not the runner\'s); the console allows exactly kick <bot> and stop', () => {
        assert.equal(reconnect.gate, 'G4');
        assert.equal(reconnect.llm, false);
        assert.deepEqual(Object.keys(reconnect.checks), ['login_online', 'effective_settings', 'kick_rejoin', 'restart_rejoin', 'no_systemd_restart', 'clean_stop']);
        const list = consoleAllowFor(reconnect, reconnect.defaults);
        assert.ok(list.some((re) => re.test(`kick ${NAME}`)) && list.some((re) => re.test('stop')));
        assert.ok(!list.some((re) => re.test('kick JQDAW')) && !list.some((re) => re.test('kill FRCFLD')));
        // run time: login 4 + settings 1 + warm 2 + kick 3 + restart 11 + rejoin 10 + settle 1 + stop 1
        assert.equal(reconnect.runMinutes(reconnect.defaults), 33);
    });

    test('restartLines: restart, fatal and requested lines of this bot only, in order', () => {
        const r = restartLines(['[agent_process] FRCFLD: kicked_by_operator; restarting in 10 s.', '[agent_process] OTHER: network; restarting in 5 s.',
            '[agent_process] FRCFLD: requested_restart; restarting in 0 s.', 'x', '[agent_process] FRCFLD: FATAL (not_whitelisted). Not restarting; a human must act.'], NAME);
        assert.deepEqual(r.map(({ kind, reason, delayS }) => ({ kind, reason, delayS })), [
            { kind: 'restart', reason: 'kicked_by_operator', delayS: 10 }, { kind: 'requested', reason: 'requested_restart', delayS: 0 }, { kind: 'fatal', reason: 'not_whitelisted', delayS: undefined }]);
    });
});

describe('g4-service-reconnect on a simulated server and service', () => {
    test('the kick and the server restart both reconnect in-process; NRestarts unchanged; the ctl stop ends inactive: every check passes', async () => {
        const s = sim();
        const r = await run(s);
        const c = byName(r);
        for (const k of Object.keys(reconnect.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.match(c.kick_rejoin.detail, /agent_process: kicked_by_operator, 10 s/);
        assert.match(c.restart_rejoin.detail, /joined again \d+ s after the new Done; agent_process: server_stopping, 20 s; network, 40 s/);
        assert.equal(c.no_systemd_restart.detail, 'NRestarts 0 -> 0: the reconnects stayed in-process');
        assert.equal(c.clean_stop.detail, 'ActiveState inactive, NRestarts 0; no restart line after the stop');
        assert.deepEqual(s.sent.filter((x) => !/^say |^seed$/.test(x)), ['ctl start', `kick ${NAME}`, 'restart 300', 'ctl stop']);
        assert.equal(c.effective_settings.detail, 'the running process says allow_insecure_coding=false');
    });

    test('the restart rolls latest.log over: the rejoin is still found (the rotated window)', async () => {
        const r = await run(sim({ rotate: true }));
        const c = byName(r);
        assert.equal(c.restart_rejoin.pass, true, c.restart_rejoin.detail);
        assert.ok(r.notes.logWindow?.some((w) => w.files === '2026-11-08-1.log.gz,latest.log'), JSON.stringify(r.notes.logWindow));
    });

    test('a unit already running at the start: login_online fails and nothing else runs', async () => {
        const s = sim({ activeAtStart: true });
        const c = byName(await run(s));
        assert.match(c.login_online.detail, /^the unit is active before the start: stop it first/);
        for (const k of ['effective_settings', 'kick_rejoin', 'restart_rejoin', 'no_systemd_restart', 'clean_stop']) assert.match(c[k].detail, /^not reached: the unit was not inactive/, k);
        assert.ok(!s.sent.includes('ctl start'));
    });

    test('no rejoin after the kick: kick_rejoin fails, the restart is not tried', async () => {
        const s = sim({ noKickRejoin: true });
        const c = byName(await run(s));
        assert.equal(c.kick_rejoin.pass, false);
        assert.match(c.kick_rejoin.detail, /^no rejoin with a kicked_by_operator restart line within 3 min of the kick/);
        assert.match(c.restart_rejoin.detail, /^not reached: the kick's rejoin failed/);
        assert.ok(!s.sent.some((x) => x.startsWith('restart ')));
    });

    test('agent_process ends FATAL after the kick: kick_rejoin fails naming it', async () => {
        const c = byName(await run(sim({ fatalAfterKick: true })));
        assert.equal(c.kick_rejoin.pass, false);
        assert.match(c.kick_rejoin.detail, /no rejoin|FATAL \(kicked_by_operator: 3 times in a row\)/);
    });

    test('systemd restarted the unit (NRestarts rose): no_systemd_restart and clean_stop fail', async () => {
        const c = byName(await run(sim({ systemdRestart: true })));
        assert.equal(c.no_systemd_restart.pass, false);
        assert.equal(c.no_systemd_restart.detail, 'NRestarts 0 -> 1: systemd restarted the unit');
        assert.equal(c.clean_stop.pass, false);
    });

    test('a slow rejoin after the restart (past restartRejoinMinutes) fails restart_rejoin; a failing ctl restart is named', async () => {
        const slow = byName(await run(sim({ restartRejoinS: 11 * 60 })));
        assert.equal(slow.restart_rejoin.pass, false);
        assert.match(slow.restart_rejoin.detail, /^no rejoin with a server_stopping or network restart line within 10 min of the new Done/);
        const failed = byName(await run(sim({ restartFails: true })));
        assert.match(failed.restart_rejoin.detail, /^the test-server restart failed: restart failed \(5\)/);
    });

    test('the stop leaves the unit failed, or a restart line follows it: clean_stop fails', async () => {
        const f = byName(await run(sim({ stopFailed: true })));
        assert.equal(f.clean_stop.pass, false);
        assert.match(f.clean_stop.detail, /^ActiveState failed/);
        const a = byName(await run(sim({ restartAfterStop: true })));
        assert.equal(a.clean_stop.pass, false);
        assert.match(a.clean_stop.detail, /after the stop: restart network/);
    });

    test('on a spawned driver (set-up T): a rehearsal, not-gate; the service-only checks are not reached', async () => {
        const r = await run(sim({ driver: true }));
        const c = byName(r);
        assert.equal(c.kick_rejoin.pass, true, c.kick_rejoin.detail);
        assert.equal(c.restart_rejoin.pass, true, c.restart_rejoin.detail);
        assert.match(c.no_systemd_restart.detail, /^not reached: not the CX23 service/);
        assert.match(c.clean_stop.detail, /^not reached: not the CX23 service/);
        assert.equal(r.gateValid, false);
        assert.ok(r.weakenedParams.some((w) => /not the CX23 service \(set-up T\)/.test(w)), r.weakenedParams.join('; '));
    });

    test('#374 review 6: a rejoin without a restart line fails kick_rejoin (a reconnect the journal does not show is not agent_process\'s)', async () => {
        const c = byName(await run(sim({ noKickLine: true })));
        assert.equal(c.kick_rejoin.pass, false);
        assert.match(c.kick_rejoin.detail, /restart lines none\)$/);
    });

    test('#374 review 1: the restart line\'s class is checked: kicked_by_operator for the kick; server_stopping or network for the restart', async () => {
        const k = byName(await run(sim({ kickClass: 'network' })));
        assert.equal(k.kick_rejoin.pass, false);
        assert.match(k.kick_rejoin.detail, /restart lines network\)$/);
        const r = byName(await run(sim({ restartClass: 'timeout' })));
        assert.equal(r.kick_rejoin.pass, true);
        assert.equal(r.restart_rejoin.pass, false);
        assert.match(r.restart_rejoin.detail, /restart lines timeout, timeout\)$/);
    });

    test('#374 review 2 and 6: no kick landed: kick_rejoin fails and no_systemd_restart is not reached', async () => {
        const c = byName(await run(sim({ kickIgnored: true })));
        assert.equal(c.kick_rejoin.detail, 'the server never showed the bot gone after `kick`');
        assert.match(c.no_systemd_restart.detail, /^not reached: no kick landed/);
        assert.equal(c.no_systemd_restart.pass, false);
    });

    test('#374 review 4: the service\'s bot must be this run\'s bot, case aside', async () => {
        const ok = byName(await run(sim({ unitBot: 'frcfld' }), { bot: 'FRCFLD' }));
        assert.equal(ok.login_online.pass, true);
        const s = sim({ unitBot: 'otherbot' });
        const c = byName(await run(s));
        assert.equal(c.login_online.detail, "the service's bot 'otherbot' is not this run's bot 'FRCFLD'");
        assert.ok(!s.sent.includes('ctl start'));
    });

    test('effective_settings (#325): the running process\'s "[settings] effective allow_insecure_coding=false"; true or missing fails', async () => {
        const bad = byName(await run(sim({ insecure: true })));
        assert.equal(bad.effective_settings.pass, false);
        assert.equal(bad.effective_settings.detail, 'the running process says allow_insecure_coding=true');
        const none = byName(await run(sim({ noSettings: true })));
        assert.equal(none.effective_settings.pass, false);
        assert.match(none.effective_settings.detail, /^no "\[settings\] effective allow_insecure_coding=" line within 60 s of the join$/);
    });

});

describe('#374 review: the scenario through the real serviceBot (a fake exec), so its forced journal reads are exercised', () => {
    test('every check passes, and the last remote call before the kick, the server restart and the stop is a journal read', async () => {
        const T0 = Date.parse('2026-11-08T12:00:00Z');
        const s = sim();
        const ops = [];
        const iso = (ms) => new Date(T0 + ms).toISOString().slice(0, 19) + '+0000';
        const exec = async (prog, argv) => {
            const [verb] = argv.slice(SSH_OPTS.length + 1);
            ops.push(`ssh:${verb}`);
            if (verb === 'start') { s.bot.start(); return { code: 0, stdout: '', stderr: '' }; }
            if (verb === 'stop') { await s.bot.stop(); return { code: 0, stdout: '', stderr: '' }; }
            if (verb === 'metrics') {
                const m = s.bot.metrics();
                return { code: 0, stdout: Object.entries(m).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', stderr: '' };
            }
            if (verb === 'journal') {
                s.bot.output();   // let the sim run its pending events first
                const out = s.journal.map((msg, i) => `${iso(s.journalAt[i])} ${msg.startsWith('Starting ') ? 'systemd[1]' : 'node[123]'}: ${msg}`);
                return { code: 0, stdout: out.join('\n') + '\n', stderr: '' };
            }
            return { code: s.unit.state === 'active' ? 0 : 3, stdout: '', stderr: '' };
        };
        const server = {
            console: (cmd, w) => { ops.push(`console:${cmd}`); return s.server.console(cmd, w); },
            log: (n) => s.server.log(n),
            logRotated: (n) => s.server.logRotated(n),
            restart: (sec) => { ops.push('restart'); return s.server.restart(sec); },
        };
        const svc = serviceBot('frcfld', null, { exec, env: { ROTN_SERVICE_GO: 'g4-test:test-server-host-confirmed' }, now: () => T0 + s.clock.now(),
            sleep: (ms) => s.clock.sleep(ms), statusRefreshMs: 10000, journalRefreshMs: 15000 });
        // The real adapter, with the scenario's own refresh() completions and output() reads recorded in the same log.
        const bot = new Proxy(svc, {
            get(target, prop) {
                if (prop === 'refresh') return async () => { await target.refresh(); ops.push('refresh-done'); };
                if (prop === 'output') return () => { ops.push('output'); return target.output(); };
                if (prop === 'stop') return () => { ops.push('stop'); return target.stop(); };
                const v = Reflect.get(target, prop, target);
                return typeof v === 'function' ? v.bind(target) : v;
            },
        });
        const r = await runScenario(reconnect, { server, bot, clock: s.clock, runId: 'r1', params: { consoleWaitS: 0 } });
        const c = byName(r);
        for (const k of Object.keys(reconnect.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        // Each count (r1 before the kick, r2 before the restart, r3 before the stop) is an output() read right after a
        // finished refresh(): the scenario's own reads, ssh calls and background refreshes aside.
        const readsBefore = (op) => {
            const i = ops.indexOf(op);
            assert.ok(i > 0, `${op} happened`);
            return ops.slice(0, i).filter((o) => o === 'refresh-done' || o === 'output').slice(-2);
        };
        assert.deepEqual(readsBefore(`console:kick ${NAME}`), ['refresh-done', 'output'], 'r1 counted after a forced read');
        assert.deepEqual(readsBefore('restart'), ['refresh-done', 'output'], 'r2 counted after a forced read');
        assert.deepEqual(readsBefore('stop'), ['refresh-done', 'output'], 'r3 counted after a forced read');
        assert.equal(ops.filter((o) => o === 'ssh:start').length, 1, 'one start');
    });
});
