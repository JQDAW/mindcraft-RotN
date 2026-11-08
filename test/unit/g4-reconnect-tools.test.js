// Offline tests for the pieces g4-service-reconnect (G4 #1) needs, built before the scenario itself (lead,
// 2026-11-07): the ctl's server restart (ctlServer.restart, never re-sent), and the scenario's console rules
// (`kick <bot>` for this run's bot only, the server's `stop`, which also gates the restart). The on-server helper
// and test-server.sh's restart verb are tested in test-server.test.js. No server.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ctlServer } from '../runner/lib/adapters.mjs';
import { G3_CONSOLE_ALLOW, SCENARIO_CONSOLE_EXTRA, consoleAllowFor, guardConsole } from '../runner/lib/g3.mjs';
import { loadScenarios } from '../runner/run.mjs';

const RECONNECT = { id: 'g4-service-reconnect', gate: 'G4', defaults: { bot: 'FRCFLD' } };
const ok = (list, cmd) => list.some((re) => re.test(cmd));

describe('ctlServer.restart: test-server.sh restart, never re-sent', () => {
    test('one call with the timeout; its output; the call\'s own time limit covers the stop and the start', () => {
        const seen = [];
        const ctl = ctlServer('/ctl', { spawn: (bash, args, o) => { seen.push({ args, timeout: o.timeout }); return { status: 0, stdout: 'restarted: [12:10:00] ... Done (41.2s)! For help\n' }; }, pause: () => {} });
        assert.deepEqual(ctl.restart(), ['restarted: [12:10:00] ... Done (41.2s)! For help']);
        assert.deepEqual(seen[0].args, ['/ctl', 'restart', '300']);
        assert.equal(seen[0].timeout, (2 * 300 + 60) * 1000);
        ctl.restart(120);
        assert.deepEqual(seen[1].args, ['/ctl', 'restart', '120']);
    });

    test('#347 (ADR 0008): the error carries the exit code, so a scenario can tell a Mod Director re-check failure (125)', () => {
        const ctl = ctlServer('/ctl', { spawn: () => ({ status: 125, stderr: 'rotn-test: after the restart, Mod Director\'s downloads fail the pinned check (ADR 0008); the server is stopped\n' }), pause: () => {} });
        assert.throws(() => ctl.restart(), (e) => e.exitCode === 125 && /restart failed \(125\): rotn-test: after the restart, Mod Director/.test(e.message));
        const five = ctlServer('/ctl', { spawn: () => ({ status: 5, stderr: 'x' }), pause: () => {} });
        assert.throws(() => five.restart(), (e) => e.exitCode === 5);
        const killed = ctlServer('/ctl', { spawn: () => ({ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } }), pause: () => {} });
        assert.throws(() => killed.restart(), (e) => e.exitCode === null);
    });

    test('an ordinary failure (the helper\'s exit 4 or 5, or ssh) is never retried: a second restart is not harmless', () => {
        let calls = 0;
        const pauses = [];
        const ctl = ctlServer('/ctl', { spawn: () => { calls++; return { status: 5, stderr: 'rotn-test: no new Done line 300s after the start' }; }, pause: (ms) => pauses.push(ms) });
        assert.throws(() => ctl.restart(), /restart failed \(5\): rotn-test: no new Done line 300s after the start \(after 1 attempts: /);
        assert.equal(calls, 1);
        assert.deepEqual(pauses, []);
        // The reads keep their two retries.
        calls = 0;
        assert.throws(() => ctl.log(5));
        assert.equal(calls, 3);
    });

    test('a bash that never started (nothing ran) is retried, as for every call', () => {
        let calls = 0;
        const ctl = ctlServer('/ctl', { spawn: () => (++calls === 1 ? { status: 3221225794 } : { status: 0, stdout: 'restarted: x\n' }), pause: () => {} });
        assert.deepEqual(ctl.restart(), ['restarted: x']);
        assert.equal(calls, 2);
    });
});

describe('g4-service-reconnect\'s console rules: kick this run\'s bot only, and stop (which gates the restart)', () => {
    test('kick: only this run\'s bot, by its exact name; never another player or a selector; built from the run\'s parameters', () => {
        for (const list of [consoleAllowFor(RECONNECT), consoleAllowFor(RECONNECT, { bot: 'FRCFLD' })]) {
            assert.equal(ok(list, 'kick FRCFLD'), true);
            for (const bad of ['kick JQDAW', 'kick Steve', 'kick FRCFLD2', 'kick frcfld', 'kick @a', 'kick @p', 'kick @e[type=Zombie]', 'kick', 'kick FRCFLD reason', 'kick FRCFLD JQDAW']) {
                assert.equal(ok(list, bad), false, bad);
            }
        }
        assert.equal(ok(consoleAllowFor(RECONNECT, { bot: 'Other_Bot' }), 'kick Other_Bot'), true);
        assert.equal(ok(consoleAllowFor(RECONNECT, { bot: 'Other_Bot' }), 'kick FRCFLD'), false);
        for (const bad of ['', 'x.*', 'a b', '@a', 'ab']) {
            assert.ok(!consoleAllowFor(RECONNECT, { bot: bad }).some((re) => /^\^kick /.test(re.source)), `no kick rule for bot '${bad}'`);
        }
    });

    test('stop exactly; no other new command; the G3 list and every other scenario get neither kick nor stop', async () => {
        const list = consoleAllowFor(RECONNECT);
        assert.equal(ok(list, 'stop'), true);
        for (const bad of ['stop now', ' stop', 'stop ', 'restart', 'kill FRCFLD', 'op FRCFLD', 'whitelist remove FRCFLD']) assert.equal(ok(list, bad), false, bad);
        assert.equal(list.length, G3_CONSOLE_ALLOW.length + 2, 'kick and stop only');
        assert.deepEqual(Object.keys(SCENARIO_CONSOLE_EXTRA).sort(), ['g4-control-commands', 'g4-death-report', 'g4-service-reconnect']);
        for (const sc of Object.values(await loadScenarios())) {
            if (sc.id === RECONNECT.id) continue;
            for (const cmd of ['kick FRCFLD', 'stop']) assert.equal(ok(consoleAllowFor(sc), cmd), false, `${sc.id}: ${cmd}`);
        }
        assert.equal(ok(G3_CONSOLE_ALLOW, 'stop'), false);
    });

    test('guardConsole: restart counts as the console\'s stop: refused for any list without it, passed through with it', () => {
        const calls = [];
        const server = { console: (cmd) => { calls.push(cmd); return []; }, restart: (t) => { calls.push(`restart ${t}`); return ['restarted: x']; } };
        assert.throws(() => guardConsole(server).restart(300), /server restart refused: this scenario's console list does not admit 'stop'/);
        assert.throws(() => guardConsole(server, consoleAllowFor({ id: 'g4-death-report', defaults: { bot: 'FRCFLD' } })).restart(300), /refused/);
        assert.deepEqual(calls, [], 'nothing reached the server');
        const g = guardConsole(server, consoleAllowFor(RECONNECT));
        assert.deepEqual(g.restart(300), ['restarted: x']);
        g.console('kick FRCFLD');
        assert.throws(() => g.console('kick JQDAW'), /not on the approved list/);
        assert.deepEqual(calls, ['restart 300', 'kick FRCFLD']);
        assert.throws(() => guardConsole({ console: () => [] }, consoleAllowFor(RECONNECT)).restart(300), /this server has no restart/);
    });
});
