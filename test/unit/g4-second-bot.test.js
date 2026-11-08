// Offline tests for G4 #12, test/scenarios/g4/g4-second-bot.mjs: a simulated test server and a simulated second unit
// (mindcraft-rotn@rotnbot2) as the CX23 service, and one run through the real serviceBot with a fake exec as the CX23,
// so the argv the gate gets is the one checked. No server, no ssh.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import { SSH_OPTS, goMarker, serviceBot } from '../runner/lib/service.mjs';
import second, { FIRST_BOT, deviceCodeNeeded, stateNames } from '../scenarios/g4/g4-second-bot.mjs';

const NAME = 'RotnBot2';
const UNIT = 'rotnbot2';
const GO = { ROTN_SERVICE_GO: `g4-12a:${UNIT}:test-server-host-confirmed` };
const NO_ENV_FILE = `service metrics: 'metrics ${UNIT}' exited 2 (the ctl refused it): mindcraft-rotn-ctl: no env file for '${UNIT}' (run bootstrap.sh add-bot ${UNIT})`;
const S = 1000;
const tick = () => new Promise((r) => setImmediate(r));
const stamp = (ms) => {
    const s = 12 * 3600 + Math.floor(ms / 1000);
    return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const line = (ms, msg) => `[${stamp(ms)}] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}`;

/**
 * opt.driver (set-up T); opt.unit (the service's unit, default rotnbot2); opt.unitActive; opt.noJoin; opt.offline (a
 * version-3 UUID); opt.stateName (the name in the [state] line; null: none); opt.kickAt (seconds after the join);
 * opt.stopFails; opt.stuckActive (the unit stays active after the stop); opt.noLeaveLine; opt.env (the run's
 * environment for the adapter's per-bot marker, default GO); opt.noEnvFile (the ctl refuses: no env file);
 * opt.metricsDown (ssh fails); opt.deviceCode (no join: the account's first device-code login is not done).
 */
function sim(opt = {}) {
    let t = 0;
    const log = [];
    const sent = [];
    const pending = [];
    const output = [];
    const unit = { state: opt.unitActive ? 'active' : 'inactive' };
    const at = (ms, fn) => pending.push([ms, fn]);
    const add = (msg) => log.push(line(t, msg));
    let online = false;
    const advance = () => {
        pending.sort((a, b) => a[0] - b[0]);
        while (pending.length && pending[0][0] <= t) pending.shift()[1]();
    };
    const server = {
        console(cmd, waitS = 1) {
            advance();
            sent.push(cmd);
            const before = log.length;
            const m = /^say (.*)$/.exec(cmd);
            if (m) add(`[Server] ${m[1]}`);
            t += waitS * 1000;
            advance();
            return log.slice(before);
        },
        log: (n) => { advance(); return log.slice(-n); },
    };
    const bot = {
        ...(opt.driver ? {} : { kind: 'service', bot: opt.unit ?? UNIT, refresh: () => { advance(); return Promise.resolve(); },
            goStatus: () => goMarker(opt.env ?? GO, opt.unit ?? UNIT) }),
        start() {
            sent.push('bot start');
            unit.state = 'active';
            output.push('[settings] effective task_givers=["JQDAW"] allow_server_task_giver=false');
            if (opt.stateName !== null) output.push(`[state] ${opt.stateName ?? NAME} at start: tasks=absent agenda=absent memory=absent`);
            if (opt.deviceCode) output.push(`[mcdata] ${NAME}: device-code login needed, see coord/NEEDS-HUMAN.md`);
            if (!opt.noJoin && !opt.deviceCode) {
                at(t + 20 * S, () => {
                    online = true;
                    log.push(`[${stamp(t)}] [User Authenticator #1/INFO] [net.minecraft.server.network.NetHandlerLoginServer]: UUID of player ${NAME} is ${opt.offline ? '0a1b2c3d-4e5f-3a7b-8c9d-0e1f2a3b4c5d' : '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d'}`);
                    add(`${NAME} joined the game`);
                    if (opt.kickAt) at(t + opt.kickAt * S, () => { online = false; add(`${NAME} lost connection: Kicked by an operator.`); add(`${NAME} left the game`); });
                });
            }
            return Promise.resolve();
        },
        alive: () => unit.state === 'active',
        needsStop: () => unit.state === 'active',
        exitCode: () => null,
        exitSignal: () => null,
        unitState: () => unit.state,
        output: () => output,
        metrics: () => (opt.noEnvFile ? Promise.reject(Object.assign(new Error(NO_ENV_FILE), { exitCode: 2 }))
            : opt.metricsDown ? Promise.reject(Object.assign(new Error(`service metrics: 'metrics ${UNIT}' exited 255`), { exitCode: 255 }))
                : Promise.resolve({ MemoryCurrent: 1, MemoryPeak: '[not set]', NRestarts: 0, ActiveState: unit.state })),
        stop() {
            sent.push('bot stop');
            if (opt.stopFails) return Promise.reject(new Error("service stop: 'stop rotnbot2' exited 1"));
            if (!opt.stuckActive) unit.state = 'inactive';
            if (online) { online = false; add(`${NAME} lost connection: Disconnected`); if (!opt.noLeaveLine) add(`${NAME} left the game`); }
            return Promise.resolve();
        },
    };
    const clock = { now: () => t, sleep: async (ms) => { t += ms; advance(); for (let i = 0; i < 3; i++) await tick(); } };
    return { server, bot, clock, sent, unit };
}
const run = (s, { params = {} } = {}) => runScenario(second, { server: s.server, bot: s.bot, clock: s.clock, runId: 'r1', params: { bot: NAME, consoleWaitS: 0, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));
const AFTER = ['login_online', 'own_profile', 'stays_up', 'stopped'];

describe('g4-second-bot: the module and its helpers', () => {
    test('G4, S only, no runner LLM accounting; the checks; runMinutes', () => {
        assert.equal(second.gate, 'G4');
        assert.equal(second.llm, false);
        assert.deepEqual(Object.keys(second.checks), ['second_bot_go', ...AFTER]);
        assert.deepEqual(FIRST_BOT, { unit: 'frcfld', account: 'FRCFLD' });
        assert.ok(!('firstBot' in second.defaults), 'the first bot is pinned, not a parameter');
        assert.ok(second.runMinutes(second.defaults) > 4);
    });

    test('stateNames finds this bot\'s [state] line; deviceCodeNeeded finds forge-bridge\'s line for this bot only', () => {
        assert.equal(deviceCodeNeeded(['x', '[mcdata] RotnBot2: device-code login needed, see coord/NEEDS-HUMAN.md'], 'rotnbot2'), '[mcdata] RotnBot2: device-code login needed, see coord/NEEDS-HUMAN.md');
        assert.equal(deviceCodeNeeded(['[mcdata] FRCFLD: device-code login needed, see coord/NEEDS-HUMAN.md'], NAME), null);
        const st = stateNames(['x', `[state] ${NAME} at start: tasks=absent agenda=absent memory=absent`], 'rotnbot2');
        assert.equal(st.own.name, NAME);
        assert.equal(stateNames(['[state] FRCFLD at start: tasks=0 agenda=all-done memory=3'], NAME).own, null);
    });
});

describe('g4-second-bot on a simulated second unit', () => {
    test('all well: the marker names the unit; it joins online, is its own profile, stays up, and the ctl stop ends it', async () => {
        const s = sim();
        const r = await run(s);
        const c = byName(r);
        for (const k of Object.keys(second.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.equal(c.second_bot_go.detail, 'GO g4-12a names rotnbot2; the account RotnBot2 is not the first bot\'s');
        assert.match(c.login_online.detail, /^RotnBot2 joined; UUID .* \(version 4, Mojang account\) \(unit rotnbot2\)$/);
        assert.equal(c.own_profile.detail, '[state] RotnBot2 at start: tasks=absent agenda=absent memory=absent');
        assert.equal(c.stopped.detail, 'the unit is inactive and RotnBot2 left the game');
        assert.deepEqual(s.sent.filter((x) => /^bot /.test(x)), ['bot start', 'bot stop']);
        assert.equal(r.notes.secondBotGo.goId, 'g4-12a');
    });

    test('no marker, the old form, a marker for another unit, the first bot\'s unit or account, or no bot parameter: nothing starts', async () => {
        for (const [label, o, params, re] of [
            ['no marker', { env: {} }, {}, /^no GO marker\. Set ROTN_SERVICE_GO=<the lead's GO id>:rotnbot2:test-server-host-confirmed/],
            ['old form', { env: { ROTN_SERVICE_GO: 'g4-12a:test-server-host-confirmed' } }, {}, /^the GO marker has the old form without a unit/],
            ['other unit', { env: { ROTN_SERVICE_GO: 'g4-12a:frcfld:test-server-host-confirmed' } }, {}, /^the GO marker names frcfld, not this unit rotnbot2$/],
            ['first unit', { unit: 'frcfld', env: { ROTN_SERVICE_GO: 'g4-12a:frcfld:test-server-host-confirmed' } }, {}, /^the service is the first bot \(frcfld\), not a second one$/],
            ['first account', {}, { bot: 'frcfld' }, /^the account frcfld is the first bot's \(FRCFLD\), not a second one$/],
            ['no bot param', {}, { bot: '' }, /^no valid bot parameter/],
        ]) {
            const s = sim(o);
            const c = byName(await run(s, { params }));
            assert.equal(c.second_bot_go.pass, false, label);
            assert.match(c.second_bot_go.detail, re, label);
            for (const k of AFTER) assert.equal(c[k].detail, 'not reached: no GO marker for this second bot, or it is the first bot; nothing started', `${label}: ${k}`);
            assert.deepEqual(s.sent, [], `${label}: nothing sent (no start, no say)`);
        }
    });

    test('setup gaps (#401 review): no env file on the CX23 (the ctl refuses), or the first device-code login not done: not reached, never a bot fail', async () => {
        const nofile = sim({ noEnvFile: true });
        const c = byName(await run(nofile));
        assert.equal(c.second_bot_go.pass, true);
        for (const k of AFTER) assert.match(c[k].detail, /^not reached: setup gap: the CX23 has no env file for rotnbot2 \(the human's bootstrap\.sh add-bot rotnbot2\): service metrics: .*no env file for 'rotnbot2'/, k);
        assert.ok(!nofile.sent.includes('bot start'));
        assert.match(byName(await run(sim({ metricsDown: true }))).login_online.detail, /^not reached: the unit's metrics could not be read \(infra\): .*exited 255$/);
        const dc = byName(await run(sim({ deviceCode: true }), { params: { loginTimeoutMs: 30 * S } }));
        for (const k of AFTER) assert.equal(dc[k].detail, 'not reached: setup gap: the first device-code login for RotnBot2 is not done (the human\'s step); the journal says "[mcdata] RotnBot2: device-code login needed, see coord/NEEDS-HUMAN.md"', k);
        assert.match(byName(await run(sim({ noJoin: true }), { params: { loginTimeoutMs: 30 * S } })).login_online.detail, /^no join within 30s/, 'no join without that line is a fail');
    });

    test('T (a spawned driver): no template unit, every check not reached, nothing starts, not-gate', async () => {
        const s = sim({ driver: true });
        const r = await run(s);
        for (const c of r.checks) assert.match(c.detail, /^not reached: S only/);
        assert.ok(!s.sent.includes('bot start'));
        assert.equal(r.gateValid, false);
    });

    test('login: a running unit refuses; no join, or an offline-mode UUID, fails', async () => {
        assert.match(byName(await run(sim({ unitActive: true }))).login_online.detail, /^the unit rotnbot2 is active before the start/);
        const off = byName(await run(sim({ offline: true })));
        assert.equal(off.login_online.pass, false);
        assert.match(off.login_online.detail, /NOT an online-mode login/);
    });

    test('own_profile: the [state] line names another bot, or there is none: a fail', async () => {
        assert.equal(byName(await run(sim({ stateName: 'FRCFLD' }))).own_profile.detail, 'the [state] line names FRCFLD, not RotnBot2');
        assert.match(byName(await run(sim({ stateName: null }))).own_profile.detail, /^the release prints no \[state\] RotnBot2 at start: \.\.\. line \(setup gap\?\)$/);
    });

    test('stays_up and stopped: a kick fails stays_up (and stopped is not reached); a failed or stuck stop, or no leave line, fails stopped', async () => {
        const kicked = byName(await run(sim({ kickAt: 30 })));
        assert.match(kicked.stays_up.detail, /^gone \d+ s after the join: lost$/);
        assert.equal(kicked.stopped.detail, 'not reached: the bot was already gone');
        assert.match(byName(await run(sim({ stopFails: true }))).stopped.detail, /^the ctl's stop failed: service stop: 'stop rotnbot2' exited 1; the unit is active after the stop/);
        assert.match(byName(await run(sim({ stuckActive: true }))).stopped.detail, /the unit is active after the stop/);
        assert.match(byName(await run(sim({ noLeaveLine: true }))).stopped.detail, /^no "RotnBot2 left the game" within 30 s of the stop$/);
    });
});

describe('g4-second-bot through the real serviceBot (a fake exec as the CX23)', () => {
    test('start, metrics, journal and stop go to the gate for the SECOND unit, under the adapter\'s GO marker', async () => {
        const T0 = Date.parse('2026-11-08T12:00:00Z');
        const s = sim();
        const calls = [];
        const iso = () => new Date(T0 + s.clock.now()).toISOString().replace(/\.\d+Z$/, '+0000');
        const journal = [];
        const exec = async (prog, argv) => {
            const [host, verb, unitArg] = argv.slice(SSH_OPTS.length);
            calls.push(`${host} ${verb} ${unitArg}`);
            if (verb === 'start') {
                await s.bot.start();
                journal.push(`${iso()} systemd[1]: Starting mindcraft-rotn@${UNIT}.service - Mindcraft RotN bot ${UNIT}...`,
                    `${iso()} node[42]: [state] ${NAME} at start: tasks=absent agenda=absent memory=absent`);
                return { code: 0, stdout: '', stderr: '' };
            }
            if (verb === 'stop') { await s.bot.stop(); return { code: 0, stdout: '', stderr: '' }; }
            if (verb === 'metrics') return { code: 0, stdout: `NRestarts=0\nActiveState=${s.unit.state}\n`, stderr: '' };
            if (verb === 'journal') return { code: 0, stdout: journal.join('\n'), stderr: '' };
            return { code: s.unit.state === 'active' ? 0 : 3, stdout: '', stderr: '' };
        };
        const bot = serviceBot(UNIT, null, { exec, env: GO, now: () => T0 + s.clock.now(), sleep: (ms) => s.clock.sleep(ms) });
        const r = await runScenario(second, { server: s.server, bot, clock: s.clock, runId: 'r1', params: { bot: NAME, consoleWaitS: 0 } });
        const c = byName(r);
        for (const k of Object.keys(second.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.ok(calls.length > 0 && calls.every((x) => x.startsWith(`cx23-ctl `) && x.endsWith(` ${UNIT}`)), calls.join('\n'));
        assert.deepEqual(calls.filter((x) => / (start|stop) /.test(x)), [`cx23-ctl start ${UNIT}`, `cx23-ctl stop ${UNIT}`]);
    });

    test('a frcfld GO marker with the second unit: second_bot_go fails with the adapter\'s reason; nothing reaches the CX23 or the server', async () => {
        const s = sim();
        const calls = [];
        const exec = (prog, argv) => { calls.push(argv.slice(SSH_OPTS.length).join(' ')); return Promise.resolve({ code: 0, stdout: '', stderr: '' }); };
        const bot = serviceBot(UNIT, null, { exec, env: { ROTN_SERVICE_GO: 'g4-1a:frcfld:test-server-host-confirmed' } });
        const c = byName(await runScenario(second, { server: s.server, bot, clock: s.clock, runId: 'r1', params: { bot: NAME, consoleWaitS: 0 } }));
        assert.equal(c.second_bot_go.detail, 'the GO marker names frcfld, not this unit rotnbot2');
        assert.deepEqual(calls, []);
        assert.deepEqual(s.sent, []);
    });
});
