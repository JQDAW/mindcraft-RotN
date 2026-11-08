// Offline tests for G4 #11 (agenda half), test/scenarios/g4/g4-restart-persistence.mjs. A simulated test server (1.12
// log lines, the marker's testforblock and setblock, the task whisper) and a simulated bot whose agenda and task state
// survive a stop and start (as #327's agenda.json and tasks.json do), as the CX23 service (set-up S) or a driver (T).
// No server, no ssh.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import { consoleAllowFor } from '../runner/lib/g3.mjs';
import { SSH_OPTS, serviceBot } from '../runner/lib/service.mjs';
import persist, { doneSteps, firstStepLine } from '../scenarios/g4/g4-restart-persistence.mjs';

const NAME = 'FRCFLD';
const S = 1000;
const STEPS = ['rocks', 'sticks', 'crude_axe', 'logs', 'first_plank', 'crafting_tools', 'crafting_table', 'planks_sticks', 'stone_pickaxe', 'stone_axe', 'cobblestone'];
const tick = () => new Promise((r) => setImmediate(r));
const stamp = (ms) => {
    const s = 12 * 3600 + Math.floor(ms / 1000);
    return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const line = (ms, msg) => `[${stamp(ms)}] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}`;

/**
 * opt.driver (set-up T; its console giver is on unless opt.giverOff); opt.unitActive; opt.unitBot; opt.doneBeforeStart
 * (the agenda finished in an earlier run); opt.noRejoin; opt.freshAfterRestart (the agenda starts anew); opt.redo (a step
 * done before is done again); opt.resumeAtDone (it resumes at a done step); opt.taskLost (the task does not resume).
 */
function sim(opt = {}) {
    let t = 0;
    const log = [];
    const sent = [];
    const starts = [];
    const pending = [];
    const unit = { state: opt.unitActive ? 'active' : 'inactive' };
    const at = (ms, fn) => pending.push([ms, fn]);
    const add = (msg) => log.push(line(t, msg));
    const say = (msg) => add(`<${NAME}> ${msg}`);
    // The bot's persisted state (agenda.json, tasks.json)
    const state = { idx: 0, done: [], active: !opt.doneBeforeStart, finished: Boolean(opt.doneBeforeStart), task: null };
    if (opt.doneBeforeStart) { state.done = [...STEPS]; state.idx = STEPS.length; }
    let online = false;
    let session = 0;      // bumps at every start, so the timers of an earlier process do nothing
    const output = [];
    const advance = () => {
        pending.sort((a, b) => a[0] - b[0]);
        while (pending.length && pending[0][0] <= t) pending.shift()[1]();
    };
    const runAgenda = (sess, first) => {
        if (state.finished) { say('agenda done'); return; }
        const step = STEPS[state.idx];
        say(first);
        const next = () => {
            if (sess !== session || !online || state.task?.status === 'running') return;
            state.done.push(STEPS[state.idx]);
            say(`agenda step ${STEPS[state.idx]} done`);
            state.idx++;
            if (state.idx >= STEPS.length) { state.finished = true; say('agenda done'); return; }
            say(`agenda step ${STEPS[state.idx]} started: step ${STEPS[state.idx]}`);
            at(t + 40 * S, next);
        };
        void step;
        at(t + 40 * S, next);
    };
    const join = (sess, restarted) => {
        if (sess !== session) return;
        online = true;
        log.push(`[${stamp(t)}] [User Authenticator #1/INFO] [net.minecraft.server.network.NetHandlerLoginServer]: UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`);
        add(`${NAME} joined the game`);
        if (!restarted) { runAgenda(sess, state.finished ? 'agenda done' : `agenda step ${STEPS[state.idx]} started: step ${STEPS[state.idx]}`); return; }
        if (state.task?.status === 'running') {
            if (!opt.taskLost) at(t + 2 * S, () => say(`task ${state.task.id} started: ${state.task.text} (resumed after a restart)`));
            at(t + 20 * S, () => { if (sess !== session) return; state.task.status = 'done'; say(`task ${state.task.id} done`); runAgenda(sess, `agenda resumed: ${STEPS[state.idx]}`); });
            return;
        }
        if (opt.redo) { state.idx = 0; }
        const id = opt.resumeAtDone ? state.done[0] : STEPS[state.idx];
        at(t + 3 * S, () => runAgenda(sess, opt.freshAfterRestart ? `agenda step ${id} started: step ${id}` : `agenda step ${id} started: step ${id} (resumed after a restart)`));
    };
    const server = {
        console(cmd, waitS = 1) {
            advance();
            sent.push(cmd);
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
            else if (cmd === 'seed') add('Seed: 1880465901402976865');
            else if ((m = /^testforblock (-?\d+) (-?\d+) (-?\d+) minecraft:(air|gold_block) 0$/.exec(cmd))) add(`Successfully found the block at ${m[1]}, ${m[2]}, ${m[3]}`);
            else if (/^setblock .* minecraft:gold_block$/.test(cmd)) add('Block placed');
            else if ((m = /^tell (\S+) !taskAdd\("(.*)", "normal"\)$/.exec(cmd)) && online) {
                const giver = opt.driver && !opt.giverOff;
                if (!giver) say('Sorry Server, I only run commands from task givers.');
                else {
                    state.task = { id: 't1', text: m[2], status: 'queued' };
                    say(`task t1 accepted: ${m[2]}`);
                    say('agenda paused for task t1');
                    at(t + 2 * S, () => { state.task.status = 'running'; say(`task t1 started: ${m[2]}`); });
                }
            }
            t += waitS * 1000;
            advance();
            return log.slice(before);
        },
        log: (n) => { advance(); return log.slice(-n); },
    };
    const bot = {
        ...(opt.driver ? {} : { kind: 'service', bot: opt.unitBot ?? 'frcfld' }),
        start(env = {}) {
            starts.push(env);
            sent.push('bot start');
            const restarted = starts.length > 1;
            // A driver clears the state at every start, unless the run keeps it (ROTN_DRIVER_KEEP_STATE=1).
            if (opt.driver && restarted && env.ROTN_DRIVER_KEEP_STATE !== '1') { state.idx = 0; state.done = []; state.task = null; }
            if (opt.driver) output.push(`DRIVER ${JSON.stringify({ type: 'mindcraft_start', serverTaskGiver: !opt.giverOff, botState: { fresh: !restarted } })}`);
            unit.state = 'active';
            session++;
            const sess = session;
            if (!(restarted && opt.noRejoin)) at(t + 20 * S, () => join(sess, restarted));
            return Promise.resolve();
        },
        alive: () => unit.state === 'active',
        needsStop: () => unit.state === 'active',
        exitCode: () => (unit.state === 'active' ? null : 0),
        exitSignal: () => null,
        unitState: () => unit.state,
        output: () => output,
        metrics: () => Promise.resolve({ MemoryCurrent: 1, MemoryPeak: '[not set]', NRestarts: 0, ActiveState: unit.state }),
        stop() {
            sent.push('bot stop');
            if (online) { online = false; add(`${NAME} lost connection: Disconnected`); add(`${NAME} left the game`); }
            unit.state = 'inactive';
            session++;
            return Promise.resolve();
        },
    };
    const clock = { now: () => t, sleep: async (ms) => { t += ms; advance(); for (let i = 0; i < 3; i++) await tick(); } };
    return { server, bot, clock, sent, starts, state, unit };
}
const run = (s, params = {}) => runScenario(persist, { ...s, runId: 'r1', params: { consoleWaitS: 0, lateReplyMs: 2000, latePollMs: 1000, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));

describe('g4-restart-persistence: the module and its parsers', () => {
    test('G4, no LLM record, checks, runMinutes; the console needs nothing beyond G3\'s (the marker and the whisper)', () => {
        assert.equal(persist.gate, 'G4');
        assert.equal(persist.llm, false);
        assert.deepEqual(Object.keys(persist.checks), ['login_online', 'agenda_progress', 'task_queued', 'restart_rejoin', 'agenda_resumed', 'no_step_twice', 'task_resumed']);
        assert.equal(persist.runMinutes(persist.defaults), 4 + 10 + 1.5 + 1 + 5 + 5);
        const list = consoleAllowFor(persist, persist.defaults);
        assert.ok(list.some((re) => re.test(`tell ${NAME} !taskAdd("go to the gold block at -42 68 -50 and stand on it", "normal")`)));
        assert.ok(!list.some((re) => re.test(`kick ${NAME}`)) && !list.some((re) => re.test('stop')), 'no kick or stop for this scenario');
    });

    test('doneSteps and firstStepLine', () => {
        assert.deepEqual(doneSteps(['agenda step rocks done', 'x', 'agenda steps done: sticks, crude_axe', 'agenda step logs started: y']), ['rocks', 'sticks', 'crude_axe']);
        assert.deepEqual(firstStepLine(['x', 'agenda step logs started: collect 3 logs (resumed after a restart)']), { kind: 'restart', id: 'logs', line: 'agenda step logs started: collect 3 logs (resumed after a restart)' });
        assert.deepEqual(firstStepLine(['agenda resumed: logs']), { kind: 'resumed', id: 'logs', line: 'agenda resumed: logs' });
        assert.equal(firstStepLine(['agenda step logs started: collect 3 logs']).kind, 'fresh');
        assert.equal(firstStepLine(['agenda step logs done']), null);
    });
});

describe('g4-restart-persistence on S (the CX23 service)', () => {
    test('the agenda survives a ctl stop and start and resumes; no step twice; the task half is not reached (needs a trusted giver on S)', async () => {
        const s = sim();
        const r = await run(s);
        const c = byName(r);
        for (const k of ['login_online', 'agenda_progress', 'restart_rejoin', 'agenda_resumed', 'no_step_twice']) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.match(c.agenda_resumed.detail, /^"agenda step \S+ started: .* \(resumed after a restart\)"$/);
        for (const k of ['task_queued', 'task_resumed']) assert.match(c[k].detail, /^not reached: /, k);
        assert.match(c.task_queued.detail, /needs a trusted giver on S: the human as JQDAW \(PLAN #11\)/);
        assert.ok(!s.sent.some((x) => x.startsWith('tell ')), 'no whisper on S');
        assert.deepEqual(s.sent.filter((x) => /^bot /.test(x)), ['bot start', 'bot stop', 'bot start', 'bot stop'], 'the restart, then the runner\'s cleanup stop');
        assert.ok(r.notes.doneBeforeRestart.length >= 2);
    });

    test('the agenda began anew after the restart: agenda_resumed fails', async () => {
        const c = byName(await run(sim({ freshAfterRestart: true })));
        assert.equal(c.agenda_resumed.pass, false);
        assert.match(c.agenda_resumed.detail, /^the agenda began anew: "agenda step \S+ started: step \S+" \(no "\(resumed after a restart\)"\)$/);
    });

    test('a step done before is done again: no_step_twice fails; resuming at a done step fails agenda_resumed', async () => {
        const redo = byName(await run(sim({ redo: true })));
        assert.equal(redo.no_step_twice.pass, false);
        assert.match(redo.no_step_twice.detail, /^done again after the restart: rocks/);
        const atDone = byName(await run(sim({ resumeAtDone: true })));
        assert.equal(atDone.agenda_resumed.pass, false);
        assert.match(atDone.agenda_resumed.detail, /^it resumed at rocks, a step done before the restart/);
    });

    test('the agenda was already done at the start (state from an earlier run on S): not reached, scenario timing, never a bot fail', async () => {
        const s = sim({ doneBeforeStart: true });
        const c = byName(await run(s));
        for (const k of ['agenda_progress', 'task_queued', 'restart_rejoin', 'agenda_resumed', 'no_step_twice', 'task_resumed']) {
            assert.match(c[k].detail, /^not reached: the agenda had finished before the restart \("agenda done"; 0 steps done\): a scenario-timing gap, not a bot result \(on S the agenda state persists from earlier runs: the human resets it under the GO\)$/, k);
        }
        assert.deepEqual(s.sent.filter((x) => /^bot /.test(x)), ['bot start', 'bot stop'], 'no restart (the stop is the runner\'s cleanup)');
    });

    test('no rejoin after the restart: restart_rejoin fails, the rest is not reached', async () => {
        const c = byName(await run(sim({ noRejoin: true }), { rejoinMinutes: 2 }));
        assert.equal(c.restart_rejoin.pass, false);
        assert.match(c.restart_rejoin.detail, /^no rejoin within 2 min of the start/);
        for (const k of ['agenda_resumed', 'no_step_twice']) assert.match(c[k].detail, /^not reached: the bot did not rejoin/, k);
    });

    test('a running unit, or another bot\'s unit: login_online fails and nothing is started', async () => {
        const a = sim({ unitActive: true });
        assert.match(byName(await run(a)).login_online.detail, /^the unit is active before the start/);
        assert.ok(!a.sent.includes('bot start'));
        const b = sim({ unitBot: 'otherbot' });
        assert.equal(byName(await run(b)).login_online.detail, "the service's bot 'otherbot' is not this run's bot 'FRCFLD'");
        assert.ok(!b.sent.includes('bot start'));
    });
});

describe('g4-restart-persistence on T (a spawned driver): a rehearsal with the task half', () => {
    test('a running task and the agenda both resume; the second start keeps the state (ROTN_DRIVER_KEEP_STATE=1); not-gate', async () => {
        const s = sim({ driver: true });
        const r = await run(s);
        const c = byName(r);
        for (const k of Object.keys(persist.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.equal(c.task_resumed.detail, `"task t1 started: go to the gold block at -42 68 -50 and stand on it (resumed after a restart)"`);
        assert.match(c.agenda_resumed.detail, /^"agenda resumed: \S+"$/, 'after the resumed task, the agenda resumes');
        assert.equal(s.starts.length, 2);
        assert.equal(s.starts[1].ROTN_DRIVER_KEEP_STATE, '1');
        assert.equal(s.starts[1].ROTN_SCENARIO_BOT, NAME);
        assert.equal(r.gateValid, false);
    });

    test('the task does not resume: task_resumed fails; the console giver off: the task half is not reached', async () => {
        const lost = byName(await run(sim({ driver: true, taskLost: true })));
        assert.equal(lost.task_resumed.pass, false);
        assert.match(lost.task_resumed.detail, /^no "task t1 started: \.\.\. \(resumed after a restart\)" within 5 min of the rejoin$/);
        const off = byName(await run(sim({ driver: true, giverOff: true })));
        assert.match(off.task_queued.detail, /^not reached: the driver did not turn the test-only console giver on/);
    });
});

describe('g4-restart-persistence through the real serviceBot (a fake exec as the CX23)', () => {
    test('the ctl stop and start go through the gate, both under the GO marker; the agenda resumes', async () => {
        const T0 = Date.parse('2026-11-08T12:00:00Z');
        const s = sim();
        const verbs = [];
        const exec = async (prog, argv) => {
            const [verb] = argv.slice(SSH_OPTS.length + 1);
            verbs.push(verb);
            if (verb === 'start') { await s.bot.start(); return { code: 0, stdout: '', stderr: '' }; }
            if (verb === 'stop') { await s.bot.stop(); return { code: 0, stdout: '', stderr: '' }; }
            if (verb === 'metrics') return { code: 0, stdout: `NRestarts=0\nActiveState=${s.unit.state}\n`, stderr: '' };
            if (verb === 'journal') return { code: 0, stdout: '', stderr: '' };
            return { code: s.unit.state === 'active' ? 0 : 3, stdout: '', stderr: '' };
        };
        const bot = serviceBot('frcfld', null, { exec, env: { ROTN_SERVICE_GO: 'g4-test:test-server-host-confirmed' }, now: () => T0 + s.clock.now(), sleep: (ms) => s.clock.sleep(ms) });
        const r = await runScenario(persist, { server: s.server, bot, clock: s.clock, runId: 'r1', params: { consoleWaitS: 0 } });
        const c = byName(r);
        for (const k of ['login_online', 'agenda_progress', 'restart_rejoin', 'agenda_resumed', 'no_step_twice']) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.equal(verbs.filter((v) => v === 'start').length, 2);
        assert.ok(verbs.indexOf('stop') > verbs.indexOf('start') && verbs.lastIndexOf('start') > verbs.indexOf('stop'), verbs.join(','));
    });
});
