// Offline tests for G3 (c), test/scenarios/g3/g3-task-preempts-agenda.mjs. A simulated server answers the
// scenario's commands in 1.12's forms (testfor: "Found <name>" or "Selector '...' found nothing", as in the
// G2 logs), and a fake agent plays its agenda (an agenda stat rises every minute), takes the test-only
// giver's !taskAdd whisper, walks to the marker and reports in skills-rotn's chat formats. No server, no LLM.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import { G3_CONSOLE_ALLOW, statCriterion } from '../runner/lib/g3.mjs';
import g3c, { PINNED, PROVISIONAL_COUNTER, onMarkerCommand, taskText } from '../scenarios/g3/g3-task-preempts-agenda.mjs';

const NAME = 'FRCFLD';
const MIN = 60000;
const MARKER = [-20, 70, -40];
const tick = () => new Promise((r) => setImmediate(r));
const stamp = (ms) => {
    const s = 12 * 3600 + Math.floor(ms / 1000);
    return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const line = (ms, msg) => `[${stamp(ms)}] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}`;
const ROCK = statCriterion('mineBlock', 'pyrotech_compat:rock_igneous');

/**
 * opt.noAgenda: the agenda stat never rises; opt.noResume: it stops rising once the task starts;
 * opt.ignore: the bot never answers the task; opt.neverThere: it says done but never stands on the marker;
 * opt.fail: it reports the task failed; opt.wrongId: its done line names another task.
 */
function sim(opt = {}) {
    const log = [];
    let t = 0;
    let joinT = null;
    let alive = false;
    let online = false;
    const stats = new Map();
    const objectives = new Map();
    const sent = [];
    const add = (msg) => log.push(line(t, msg));
    const say = (msg) => add(`<${NAME}> ${msg}`);
    let task = null;   // {at, phase}
    let lastMinute = 0;
    const advance = () => {
        if (joinT === null || !online) return;
        const m = Math.floor((t - joinT) / MIN);
        for (; lastMinute < m; lastMinute++) {
            const busy = task && task.phase !== 'done';
            const stopped = opt.noResume && task;
            if (!opt.noAgenda && !busy && !stopped) stats.set(ROCK, (stats.get(ROCK) ?? 0) + 1);
        }
        if (task && task.phase === 'going' && t - task.at >= 2 * MIN) {
            task.phase = 'there';
            if (opt.fail) { say('task t1 failed: no path to the gold block'); task.phase = 'done'; }
        }
        if (task && task.phase === 'there' && t - task.at >= 2.5 * MIN) {
            say(opt.wrongId ? 'task t9 done' : 'task t1 done');
            say('agenda resumed: logs');
            task.phase = 'done';
        }
    };
    const server = {
        console(cmd, waitS = 1) {
            advance();
            sent.push(cmd);
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
            else if (cmd === 'seed') add('Seed: 1880465901402976865');
            else if ((m = /^scoreboard objectives add (\S+) (\S+)$/.exec(cmd))) {
                objectives.set(m[1], m[2]);
                add(`Added new objective '${m[1]}' successfully`);
            } else if ((m = /^scoreboard objectives remove (\S+)$/.exec(cmd))) {
                add(objectives.delete(m[1]) ? `Removed objective '${m[1]}' successfully` : `No objective was found by the name '${m[1]}'`);
            } else if (cmd === `scoreboard players list ${NAME}`) {
                const shown = [...objectives].map(([o, c]) => [o, stats.get(c) ?? 0]).filter(([, v]) => v > 0);
                if (!shown.length) add(`Player ${NAME} has no scores recorded`);
                else {
                    add(`Showing ${shown.length} tracked objective(s) for ${NAME}:`);
                    for (const [o, v] of shown) add(`- ${o}: ${v} (${o})`);
                }
            } else if ((m = /^setblock (-?\d+) (-?\d+) (-?\d+) minecraft:gold_block$/.exec(cmd))) add('Block placed');
            else if (cmd.startsWith('testfor ')) {
                const there = task && ['there', 'done'].includes(task.phase) && !opt.neverThere && !opt.fail && cmd === onMarkerCommand(NAME, MARKER);
                add(there ? `Found ${NAME}` : `Selector '${cmd.slice(8)}' found nothing`);
            } else if ((m = /^tell (\S+) !taskAdd\("(.*)", "normal"\)$/.exec(cmd)) && online && !opt.ignore) {
                say(`*Server used taskAdd*`);
                say(`task t1 accepted: ${m[2]}`);
                say('agenda paused for task t1');
                task = { at: t, phase: 'going' };
            }
            t += waitS * 1000;
            return log.slice(before);
        },
        log: (n) => { advance(); return log.slice(-n); },
    };
    const bot = {
        start() {
            alive = true;
            online = true;
            joinT = t;
            log.push(`[${stamp(t)}] [User Authenticator #1/INFO] [net.minecraft.server.network.NetHandlerLoginServer]: UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`);
            add(`${NAME} joined the game`);
        },
        alive: () => alive,
        exitCode: () => (alive ? null : 0),
        output: () => [],
        stop() { alive = false; online = false; return Promise.resolve(); },
    };
    const clock = { now: () => t, sleep: async (ms) => { t += ms; for (let i = 0; i < 3; i++) await tick(); } };
    return { server, bot, clock, sent };
}

const fast = { consoleWaitS: 0, lateReplyMs: 2000, latePollMs: 1000, marker: MARKER.join(',') };
const run = (s, params = {}) => runScenario(g3c, { ...s, runId: 'r1', params: { ...fast, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));

describe('g3-task-preempts-agenda on a simulated server', () => {
    test('the module: G3, the real agent, the step limits, marker and counter compared equal; provisional until pinned', () => {
        assert.equal(g3c.gate, 'G3');
        assert.equal(g3c.llm, true);
        for (const k of ['marker', 'agendaCounter', 'warmMinutes', 'acceptS', 'taskMinutes', 'resumeMinutes', 'maxBatchUsd']) assert.equal(g3c.gateParams[k], 'equal', k);
        assert.equal(g3c.defaults.marker, '', 'no marker until the lead pins one');
        assert.equal(g3c.defaults.agendaCounter, PROVISIONAL_COUNTER);
        assert.equal(PINNED, false);
        assert.equal(taskText(MARKER), 'go to the gold block at -20 70 -40 and stand on it');
        assert.equal(onMarkerCommand(NAME, MARKER), 'testfor @a[name=FRCFLD,x=-20,y=71,z=-40,dx=0,dy=1,dz=0]');
    });

    test('the task preempts the agenda, is done on the marker and reported, and the agenda resumes: every check passes', async () => {
        const s = sim();
        const r = await run(s);
        const c = byName(r);
        for (const k of Object.keys(g3c.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.equal(r.notes.taskResult.id, 't1');
        assert.equal(r.notes.taskResult.preempted, true, 'the agent said "agenda paused for task t1"');
        assert.match(c.agenda_resumed.detail, /the agent said "agenda resumed"/);
        assert.ok(s.sent.includes(`tell ${NAME} !taskAdd("go to the gold block at -20 70 -40 and stand on it", "normal")`));
        assert.ok(s.sent.includes('setblock -20 70 -40 minecraft:gold_block'));
        for (const cmd of s.sent) {
            assert.ok(G3_CONSOLE_ALLOW.some((re) => re.test(cmd)), `not approved: ${cmd}`);
            assert.ok(!/^tp /.test(cmd), `no tp in G3: ${cmd}`);
        }
        // Provisional marker and counter: never a gate pass yet.
        assert.equal(r.gateValid, false);
        assert.ok(r.weakenedParams.some((w) => /provisional/.test(w)), r.weakenedParams.join('; '));
    });

    test('no marker given: the task steps cannot run and fail, and no task is whispered', async () => {
        const s = sim();
        const r = await run(s, { marker: '' });
        const c = byName(r);
        assert.equal(c.agenda_active.pass, true);
        for (const k of ['task_accepted', 'task_done', 'agenda_resumed']) assert.match(c[k].detail, /^not reached: no task marker/, k);
        assert.ok(!s.sent.some((x) => x.startsWith('tell ') || x.startsWith('setblock ')));
        assert.equal(c.no_cheat.pass, true);
    });

    test('an idle agent fails agenda_active; a bot that never answers fails task_accepted', async () => {
        assert.equal(byName(await run(sim({ noAgenda: true }))).agenda_active.pass, false);
        const r = await run(sim({ ignore: true }));
        assert.equal(byName(r).task_accepted.pass, false);
        assert.match(byName(r).task_done.detail, /not reached: the task was not accepted/);
    });

    test('a done report without the server finding the bot on the marker fails task_done (the agent\'s word is not enough)', async () => {
        const r = await run(sim({ neverThere: true }));
        const c = byName(r);
        assert.equal(c.task_done.pass, false);
        assert.match(c.task_done.detail, /^the server never found the bot on the marker; the bot said "task t1 done"/);
    });

    test('a failed task or a done line for another task id fails task_done', async () => {
        const failed = await run(sim({ fail: true }));
        assert.match(byName(failed).task_done.detail, /the bot said "task t1 failed: no path to the gold block"/);
        assert.equal(byName(failed).task_done.pass, false);
        const wrong = await run(sim({ wrongId: true }));
        assert.equal(byName(wrong).task_done.pass, false);
        assert.match(byName(wrong).task_done.detail, /no done report/);
    });

    test('the agenda does not resume after the task: agenda_resumed fails after resumeMinutes', async () => {
        const r = await run(sim({ noResume: true }));
        const c = byName(r);
        assert.equal(c.task_done.pass, true);
        assert.equal(c.agenda_resumed.pass, false);
        assert.match(c.agenda_resumed.detail, /within 5 min after the done line/);
    });
});
