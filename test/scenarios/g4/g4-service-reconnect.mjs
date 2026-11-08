// G4 #1, ready-to-try: "The service logs in with its own account and reconnects after a kick or a server restart."
// test/scenarios/g4/PLAN.md item 1. Set-up S: the bot is the CX23's mindcraft-rotn@<bot> unit, driven through the ssh
// gate (run.mjs --service <bot>, lib/service.mjs); the harness reads the test server as in G3. On a spawned driver
// (set-up T) it is a rehearsal: the service-only checks are "not reached", and every G4 run is not-gate on a test
// server anyway (g3Policy: G4_TEST_SERVER_NOT_GATE) until the lead sets how an S run becomes G4 evidence.
//
// The stimuli (lead, 2026-11-07; the console rules in lib/g3.mjs SCENARIO_CONSOLE_EXTRA, this scenario only): the
// console's `kick <bot>` (this run's bot by its exact name), then a server restart: `test-server.sh restart` (the
// console `stop`, the process exit, a new start, a new Done line; #324), which guardConsole admits only with `stop`.
// Both are disposable-test-server only, by construction (test-server.sh reaches only the servers it created).
//
// What the bot does (net-forge's agent_process.js and exit-contract.js; this scenario changes nothing there): a kick
// or a server stop ends the agent's session with exit 1 (transient: kicked_by_operator, server_stopping, network,
// timeout, ...), and agent_process restarts it IN-PROCESS with backoff (10 s, doubling, capped at 5 min, reset after
// 10 min connected), logging "[agent_process] <bot>: <class>; restarting in N s." A FATAL class logs "FATAL (...)"
// and ends the main process with 3. So a kick or a server stop never reaches systemd: NRestarts stays unchanged.
//
// Steps:
//   1. The unit's bot must be this run's bot (case aside), and the unit inactive before the start (metrics'
//      ActiveState), else the run's log would be another run's. login_online: start through the ctl, the join, an
//      online (v4) UUID. effective_settings: main.js's "[settings] effective allow_insecure_coding=false" (#325) in
//      the journal from this start (PLAN #1 and #8).
//   2. warmMinutes online.
//   3. `kick <bot>`; the server shows the bot gone. kick_rejoin: the journal has a new restart line of class
//      kicked_by_operator, and the server shows the bot joining again within kickRejoinMinutes of the kick.
//   4. server.restart(restartTimeoutS) (the ctl's restart; the server log rolls over: sinceMarker reads the rotated
//      window). restart_rejoin: a new restart line of class server_stopping or network, and the bot joins again within
//      restartRejoinMinutes of the new Done.
//   5. settleMinutes online, then no_systemd_restart: NRestarts is what it was before the kick (service only; not
//      reached when no kick landed).
//   6. clean_stop: the ctl's stop; the unit ends inactive (not failed), with no restart line after the stop and
//      NRestarts unchanged (service only).
// Every count of restart lines is taken after a forced journal read (bot.refresh(): output() is a 15 s cache).
// llm is false: on S the bot's calls go to the CX23's own key, which the runner cannot read. A T rehearsal (a spawned
// driver) therefore records no LLM spend either (DRIVER.md).
// Notes: every restart line with its class and delay, the join and gone events with the server's times, and the
// metrics before and after.
import { startSession } from '../../runner/lib/session.mjs';
import { G2_WORLD_SEED } from '../../runner/lib/g2.mjs';
import { consoleAllowFor, guardConsole } from '../../runner/lib/g3.mjs';

const MS = 1000;
const MIN = 60 * MS;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * agent_process.js's restart and fatal lines for one bot, in log order:
 *   "[agent_process] FRCFLD: kicked_by_operator; restarting in 10 s." -> {kind: 'restart', reason, delayS}
 *   "[agent_process] FRCFLD: FATAL (not_whitelisted). Not restarting; ..." -> {kind: 'fatal', reason}
 * A requested restart (reason requested_restart) is the main process's own, not a reconnect: kind 'requested'.
 */
export function restartLines(lines, name) {
    const n = esc(name);
    const restart = new RegExp(`^\\[agent_process\\] ${n}: (.+); restarting in (\\d+) s\\.$`);
    const fatal = new RegExp(`^\\[agent_process\\] ${n}: FATAL \\((.*)\\)\\. Not restarting`);
    const out = [];
    lines.forEach((l, at) => {
        let m;
        if ((m = restart.exec(l))) out.push({ at, kind: m[1] === 'requested_restart' ? 'requested' : 'restart', reason: m[1], delayS: Number(m[2]) });
        else if ((m = fatal.exec(l))) out.push({ at, kind: 'fatal', reason: m[1] });
    });
    return out;
}

export default {
    id: 'g4-service-reconnect',
    gate: 'G4',
    // The bot's LLM calls go to the CX23's own key (its env file), which the runner cannot read: no usage record here.
    llm: false,
    title: 'The CX23 service reconnects in-process after a console kick and a test-server restart; a ctl stop ends it cleanly',
    checks: {
        login_online: 'Starting the service makes the bot log in with its own account (online mode), from an inactive unit',
        effective_settings: 'The running process logs "[settings] effective allow_insecure_coding=false" at the start (PLAN #8)',
        kick_rejoin: 'After a console kick, agent_process restarts in-process (kicked_by_operator) and the bot joins again in time',
        restart_rejoin: 'After a test-server restart, agent_process restarts in-process (server_stopping or network) and the bot joins again in time after the new Done',
        no_systemd_restart: 'A kick or a server stop never reaches systemd: NRestarts unchanged (service only)',
        clean_stop: 'The ctl\'s stop ends the unit inactive (not failed), with no restart after it (service only)',
    },
    defaults: {
        bot: 'FRCFLD',
        worldSeed: G2_WORLD_SEED,
        warmMinutes: 2,
        kickRejoinMinutes: 3,
        restartTimeoutS: 300,
        restartRejoinMinutes: 10,
        settleMinutes: 1,
        settingsWaitS: 60,
        loginTimeoutMs: 240 * MS,
        pollMs: 5 * MS,
        logTail: 20000,
        consoleWaitS: 1,
    },
    gateParams: { warmMinutes: 'equal', kickRejoinMinutes: 'equal', restartRejoinMinutes: 'equal', settleMinutes: 'equal' },
    // The login wait, the settings line's wait, the warm-up, the kick's rejoin window, the restart (its stop and its start, each up to
    // restartTimeoutS, plus the ctl's margin), the restart's rejoin window, the settle time and the stop (1 min).
    runMinutes: (p) => p.loginTimeoutMs / MIN + p.settingsWaitS / 60 + p.warmMinutes + p.kickRejoinMinutes + (2 * p.restartTimeoutS + 60) / 60
        + p.restartRejoinMinutes + p.settleMinutes + 1,

    async run(ctx) {
        const { bot, clock, params: p } = ctx;
        // run.mjs guards too; here, with this scenario's own list: G3's plus `kick <bot>` and `stop` (which admits the restart)
        const server = guardConsole(ctx.server, consoleAllowFor({ id: 'g4-service-reconnect' }, p));
        const name = p.bot;
        const service = bot.kind === 'service';
        const rest = ['effective_settings', 'kick_rejoin', 'restart_rejoin', 'no_systemd_restart', 'clean_stop'];
        const notReached = (keys, why) => { for (const k of keys) ctx.check(k, false, `not reached: ${why}`); };
        if (!service) ctx.notGate('not the CX23 service (set-up T): a rehearsal; the service-only checks are not reached');
        const fresh = async () => { if (typeof bot.refresh === 'function') await bot.refresh(); };   // bypass output()'s cache

        // 1. this run's bot, and the start from an inactive unit (service only: a running unit's log would be another run's)
        if (service && String(bot.bot).toLowerCase() !== String(name).toLowerCase()) {
            ctx.check('login_online', false, `the service's bot '${bot.bot}' is not this run's bot '${name}'`);
            notReached(rest, 'the service is another bot');
            return;
        }
        const m0 = service ? await bot.metrics() : null;
        ctx.note('metricsBefore', m0);
        if (service && m0?.ActiveState !== 'inactive' && m0?.ActiveState !== 'failed') {
            ctx.check('login_online', false, `the unit is ${m0?.ActiveState ?? 'unknown'} before the start: stop it first (a running unit's journal is not this run's)`);
            notReached(rest, 'the unit was not inactive at the start');
            return;
        }
        const s = await startSession(ctx, { name, checkNaming: false });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) { notReached(rest, 'the bot did not log in'); return; }
        // main.js (#325) logs the value every agent receives, after all overrides.
        const settingsRe = /^\[settings\] effective allow_insecure_coding=(.*)$/;
        const settingsLine = () => bot.output().map((l) => settingsRe.exec(l)).find(Boolean);
        await fresh();
        const st = settingsLine() ?? await ctx.waitFor(async () => { await fresh(); return settingsLine(); }, p.settingsWaitS * MS, p.pollMs);
        ctx.check('effective_settings', st?.[1] === 'false', st ? `the running process says allow_insecure_coding=${st[1]}` : `no "[settings] effective allow_insecure_coding=" line within ${p.settingsWaitS} s of the join`);
        const joins = () => s.events().filter((e) => e.type === 'joined');
        const goneEv = () => s.events().filter(s.gone);
        const restarts = () => restartLines(bot.output(), name);
        const note = () => ctx.note('reconnect', { events: s.events().filter((e) => e.type !== 'chat').map(({ type, time, reason }) => ({ type, time, reason })),
            restartLines: restarts().map(({ kind, reason, delayS }) => ({ kind, reason, delayS })) });

        // 2. online for warmMinutes
        await clock.sleep(p.warmMinutes * MIN);
        const nr0 = service ? (await bot.metrics()).NRestarts : null;
        ctx.note('nRestartsBeforeKick', nr0);

        // 3. the kick
        const j1 = joins().length;
        const g1 = goneEv().length;
        await fresh();
        const r1 = restarts().length;
        const kickAt = clock.now();
        server.console(`kick ${name}`, p.consoleWaitS);
        const kicked = await ctx.waitFor(() => goneEv().length > g1, MIN, p.pollMs);
        const kickClass = (rs) => rs.some((r) => r.kind === 'restart' && r.reason === 'kicked_by_operator');
        const kickBack = kicked && await ctx.waitFor(() => joins().length > j1 && kickClass(restarts().slice(r1)), Math.max(0, p.kickRejoinMinutes * MIN - (clock.now() - kickAt)), p.pollMs);
        await fresh();
        const kr = restarts().slice(r1);
        const fatal1 = kr.find((r) => r.kind === 'fatal');
        note();
        ctx.check('kick_rejoin', Boolean(kickBack) && !fatal1 && kickClass(kr),
            !kicked ? 'the server never showed the bot gone after `kick`'
                : fatal1 ? `agent_process ended FATAL (${fatal1.reason}) after the kick`
                    : kickBack ? `gone, then joined again within ${Math.round((clock.now() - kickAt) / MS)} s; agent_process: ${kr.filter((r) => r.kind === 'restart').map((r) => `${r.reason}, ${r.delayS} s`).join('; ')}`
                        : `no rejoin with a kicked_by_operator restart line within ${p.kickRejoinMinutes} min of the kick (joins ${joins().length - j1}, restart lines ${kr.map((r) => r.reason).join(', ') || 'none'})`);
        if (!kickBack) { notReached(['restart_rejoin'], 'the kick\'s rejoin failed'); }

        // 4. the server restart (only after a good kick: a second stimulus on a bot that did not come back proves nothing)
        if (kickBack) {
            const j2 = joins().length;
            await fresh();
            const r2 = restarts().length;
            let restarted;
            try { restarted = server.restart(p.restartTimeoutS); } catch (e) { restarted = { error: String(e.message ?? e) }; }
            ctx.note('serverRestart', restarted);
            const doneAt = clock.now();
            const restartClass = (rs) => rs.some((r) => r.kind === 'restart' && ['server_stopping', 'network'].includes(r.reason));
            const back = !restarted?.error && await ctx.waitFor(() => joins().length > j2 && restartClass(restarts().slice(r2)), p.restartRejoinMinutes * MIN, p.pollMs);
            await fresh();
            const rr = restarts().slice(r2);
            const fatal2 = rr.find((r) => r.kind === 'fatal');
            note();
            ctx.check('restart_rejoin', Boolean(back) && !fatal2 && restartClass(rr),
                restarted?.error ? `the test-server restart failed: ${restarted.error}`
                    : fatal2 ? `agent_process ended FATAL (${fatal2.reason}) after the server restart`
                        : back ? `joined again ${Math.round((clock.now() - doneAt) / MS)} s after the new Done; agent_process: ${rr.filter((r) => r.kind === 'restart').map((r) => `${r.reason}, ${r.delayS} s`).join('; ')}`
                            : `no rejoin with a server_stopping or network restart line within ${p.restartRejoinMinutes} min of the new Done (joins ${joins().length - j2}, restart lines ${rr.map((r) => r.reason).join(', ') || 'none'})`);
        }

        // 5. NRestarts (service only)
        await clock.sleep(p.settleMinutes * MIN);
        if (service && !kicked) notReached(['no_systemd_restart'], 'no kick landed (nothing to keep in-process)');
        else if (service) {
            const m1 = await bot.metrics();
            ctx.note('metricsAfterReconnects', m1);
            ctx.check('no_systemd_restart', m1.NRestarts === nr0, `NRestarts ${nr0} -> ${m1.NRestarts}${m1.NRestarts === nr0 ? ': the reconnects stayed in-process' : ': systemd restarted the unit'}`);
        } else notReached(['no_systemd_restart'], 'not the CX23 service (no NRestarts)');

        // 6. the ctl's stop (service only)
        if (!service) { notReached(['clean_stop'], 'not the CX23 service'); return; }
        await fresh();
        const r3 = restarts().length;
        let stopError = null;
        try { await bot.stop(); } catch (e) { stopError = String(e.message ?? e); }
        let m2;
        try { m2 = await bot.metrics(); } catch (e) { m2 = { error: String(e.message ?? e) }; }
        await fresh().catch(() => {});
        ctx.note('metricsAfterStop', m2);
        const after = restarts().slice(r3);
        note();
        ctx.check('clean_stop', !stopError && m2.ActiveState === 'inactive' && m2.NRestarts === nr0 && !after.some((r) => r.kind === 'restart' || r.kind === 'fatal'),
            stopError ? `the stop failed: ${stopError}`
                : `ActiveState ${m2.ActiveState}, NRestarts ${m2.NRestarts}${after.length ? `; after the stop: ${after.map((r) => `${r.kind} ${r.reason}`).join('; ')}` : '; no restart line after the stop'}`);
    },
};
