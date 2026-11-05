// Offline tests for G3 (c), test/scenarios/g3/g3-task-preempts-agenda.mjs. A simulated server answers the
// scenario's commands in 1.12's forms (testfor: "Found <name>" or "Selector '...' found nothing", as in the
// G2 logs), and a fake agent plays its agenda (an agenda stat rises every minute), takes the test-only
// giver's !taskAdd whisper, walks to the marker and reports in skills-rotn's chat formats. No server, no LLM.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import { G3_CONSOLE_ALLOW, statCriterion } from '../runner/lib/g3.mjs';
import g3c, { AGENDA_COUNTER, MARKER as PINNED_MARKER, PINNED, agendaActive, onMarkerCommand, taskText } from '../scenarios/g3/g3-task-preempts-agenda.mjs';

const NAME = 'FRCFLD';
const MIN = 60000;
const MARKER = PINNED_MARKER.split(',').map(Number);
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
 * opt.fail: it reports the task failed; opt.wrongId: its done line names another task; opt.noPause: it never
 * says "agenda paused for task t1"; opt.blocked: the cell above the marker is water; opt.stale: the driver
 * reports bot state it could not clear; opt.badCriterion: a counter criterion the server rejects;
 * opt.stuckAt (minutes after the join): the agenda says its step is stuck and pauses (the counter stops);
 * opt.restartAt: later it starts its next step (the counter runs again); opt.noAgendaLine: no agenda chat at all.
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
    const output = [];
    const add = (msg) => log.push(line(t, msg));
    const say = (msg) => add(`<${NAME}> ${msg}`);
    let task = null;   // {at, phase}
    let lastMinute = 0;
    let stuck = false;
    let restarted = false;
    const advance = () => {
        if (joinT === null || !online) return;
        if (opt.stuckAt !== undefined && !stuck && t - joinT >= opt.stuckAt * MIN) { say('agenda step rocks stuck: 5 min of self-prompting; agenda paused'); stuck = true; }
        if (opt.restartAt !== undefined && stuck && !restarted && t - joinT >= opt.restartAt * MIN) { say('agenda step sticks started: collect 4 sticks'); restarted = true; }
        const m = Math.floor((t - joinT) / MIN);
        for (; lastMinute < m; lastMinute++) {
            const busy = task && task.phase !== 'done';
            const stopped = opt.noResume && task;
            if (!opt.noAgenda && !busy && !stopped && !(stuck && !restarted)) stats.set(ROCK, (stats.get(ROCK) ?? 0) + 1);
        }
        if (task && task.phase === 'going' && t - task.at >= 2 * MIN) {
            task.phase = 'there';
            if (opt.fail) { say('task t1 failed: no path to the gold block'); task.phase = 'done'; task.closed = true; }
        }
        if (task && task.phase === 'there' && t - task.at >= 2.5 * MIN) {
            say(opt.wrongId ? 'task t9 done' : 'task t1 done');
            if (!opt.wrongId) task.closed = true;
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
                if (m[2] === opt.badCriterion) add(`Invalid objective criteria type '${m[2]}'`);
                else { objectives.set(m[1], m[2]); add(`Added new objective '${m[1]}' successfully`); }
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
            else if ((m = /^testforblock (-?\d+) (-?\d+) (-?\d+) minecraft:gold_block 0$/.exec(cmd))) {
                add(opt.noGold ? `The block at ${m[1]}, ${m[2]}, ${m[3]} is Air (expected: Gold Block).` : `Successfully found the block at ${m[1]}, ${m[2]}, ${m[3]}`);
            } else if ((m = /^testforblock (-?\d+) (-?\d+) (-?\d+) minecraft:air 0$/.exec(cmd))) {
                add(opt.blocked && Number(m[2]) === MARKER[1] + 1 ? `The block at ${m[1]}, ${m[2]}, ${m[3]} is Water (expected: Air).` : `Successfully found the block at ${m[1]}, ${m[2]}, ${m[3]}`);
            } else if ((m = /^tell (\S+) !taskCancel\("(t\d+)"\)$/.exec(cmd)) && online) {
                if (task && !task.closed) { say(`task ${m[2]} cancelled`); task.closed = true; task.phase = 'done'; }
            }
            else if (cmd.startsWith('testfor ')) {
                const there = task && ['there', 'done'].includes(task.phase) && !opt.neverThere && !opt.fail && cmd === onMarkerCommand(NAME, MARKER);
                add(there ? `Found ${NAME}` : `Selector '${cmd.slice(8)}' found nothing`);
            } else if ((m = /^tell (\S+) !taskAdd\("(.*)", "normal"\)$/.exec(cmd)) && online && !opt.ignore) {
                say(`*Server used taskAdd*`);
                say(`task t1 accepted: ${m[2]}`);
                if (!opt.noPause) say('agenda paused for task t1');
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
            output.push(`DRIVER ${JSON.stringify({ type: 'mindcraft_start', botState: { dir: 'bots/FRCFLD', movedAside: opt.stale ? [] : ['tasks.json.g3-S.bak'], fresh: !opt.stale } })}`);
            log.push(`[${stamp(t)}] [User Authenticator #1/INFO] [net.minecraft.server.network.NetHandlerLoginServer]: UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`);
            add(`${NAME} joined the game`);
            if (!opt.noAgendaLine) say('agenda step rocks started: collect 6 rocks');
        },
        alive: () => alive,
        exitCode: () => (alive ? null : 0),
        output: () => output,
        stop() { alive = false; online = false; return Promise.resolve(); },
    };
    const clock = { now: () => t, sleep: async (ms) => { t += ms; advance(); for (let i = 0; i < 3; i++) await tick(); } };
    return { server, bot, clock, sent };
}

const fast = { consoleWaitS: 0, lateReplyMs: 2000, latePollMs: 1000 };
const run = (s, params = {}) => runScenario(g3c, { ...s, runId: 'r1', params: { ...fast, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));

describe('g3-task-preempts-agenda on a simulated server', () => {
    test('the module: G3, the real agent, the step limits, marker and counter compared equal; pinned (lead, #207 review)', () => {
        assert.equal(g3c.gate, 'G3');
        assert.equal(g3c.llm, true);
        for (const k of ['marker', 'agendaCounter', 'warmMinutes', 'activeWaitMinutes', 'acceptS', 'taskMinutes', 'resumeMinutes', 'maxBatchUsd']) assert.equal(g3c.gateParams[k], 'equal', k);
        assert.equal(PINNED, true);
        assert.equal(g3c.defaults.marker, '-42,68,-50', "S1-A's confirmed surface rock pile");
        assert.equal(g3c.defaults.agendaCounter, AGENDA_COUNTER);
        const crit = AGENDA_COUNTER.split(',');
        assert.equal(crit.length, 11);
        assert.ok(crit.every((c) => /^stat\.(mineBlock|craftItem)\./.test(c)), 'mineBlock and craftItem only: no pickup stat (#207 review)');
        assert.equal(crit.filter((c) => c.startsWith('stat.craftItem.')).length, 5);
        assert.equal(taskText(MARKER), 'go to the gold block at -42 68 -50 and stand on it');
        assert.equal(onMarkerCommand(NAME, MARKER), 'testfor @a[name=FRCFLD,x=-42,y=69,z=-50,dx=0,dy=1,dz=0]');
    });

    test('the task preempts the agenda, is done on the marker and reported, and the agenda resumes: every check passes', async () => {
        const s = sim();
        const r = await run(s);
        const c = byName(r);
        for (const k of Object.keys(g3c.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.equal(r.notes.taskResult.id, 't1');
        assert.equal(r.notes.taskResult.preempted, true, 'the agent said "agenda paused for task t1"');
        assert.match(c.agenda_resumed.detail, /the agent said "agenda resumed"/);
        assert.ok(s.sent.includes(`tell ${NAME} !taskAdd("go to the gold block at -42 68 -50 and stand on it", "normal")`));
        assert.ok(s.sent.indexOf('testforblock -42 69 -50 minecraft:air 0') < s.sent.indexOf('setblock -42 68 -50 minecraft:gold_block'), 'the preflight comes first');
        assert.ok(s.sent.includes('testforblock -42 70 -50 minecraft:air 0'));
        // #207 review nit: the gold block is confirmed read-only after the setblock, before the whisper.
        const gold = s.sent.indexOf('testforblock -42 68 -50 minecraft:gold_block 0');
        assert.ok(gold > s.sent.indexOf('setblock -42 68 -50 minecraft:gold_block') && gold < s.sent.findIndex((x) => x.startsWith('tell ')), 'confirm after the setblock, before the task');
        assert.deepEqual({ ...r.notes.marker, reply: undefined }, { at: [-42, 68, -50], reply: undefined, goldBlock: true, detail: 'found' });
        assert.match(r.notes.marker.reply, /: Block placed$/);
        assert.ok(!s.sent.some((x) => x.includes('!taskCancel')), 'a done task needs no cancel');
        for (const cmd of s.sent) {
            assert.ok(G3_CONSOLE_ALLOW.some((re) => re.test(cmd)), `not approved: ${cmd}`);
            assert.ok(!/^tp /.test(cmd), `no tp in G3: ${cmd}`);
        }
        // Pinned marker and counter, every objective added: gate-valid (under batch.mjs's spend stop in a real run).
        assert.equal(r.gateValid, true, r.weakenedParams.join('; '));
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

    test('#207 review: no "agenda paused" line fails task_done; a blocked site stops before the setblock; stale state fails fresh_bot_state', async () => {
        const noPause = await run(sim({ noPause: true }));
        assert.equal(byName(noPause).task_done.pass, false);
        assert.match(byName(noPause).task_done.detail, /no "agenda paused for task t1" line/);
        const sb = sim({ blocked: true });
        const blocked = await run(sb);
        assert.match(byName(blocked).task_accepted.detail, /^not reached: site not clear: -42 69 -50: The block at -42, 69, -50 is Water/);
        assert.ok(!sb.sent.some((x) => x.startsWith('setblock ') || x.startsWith('tell ')), 'nothing placed or whispered');
        assert.equal(byName(await run(sim({ stale: true }))).fresh_bot_state.pass, false);
    });

    test('#207 review nit: a gold block the server does not confirm stops the task steps, and nothing is whispered', async () => {
        const s = sim({ noGold: true });
        const r = await run(s);
        assert.match(byName(r).task_accepted.detail, /^not reached: the gold block is not at the marker: The block at -42, 68, -50 is Air/);
        assert.equal(r.notes.marker.goldBlock, false);
        assert.ok(!s.sent.some((x) => x.startsWith('tell ')), 'no task without a proven marker');
    });

    test('#207 review: a task left open at the end is cancelled by the giver; a rejected counter criterion makes the run not gate-valid', async () => {
        const s = sim({ wrongId: true });
        const r = await run(s);
        assert.ok(s.sent.includes(`tell ${NAME} !taskCancel("t1")`));
        assert.deepEqual(r.notes.openTaskAtEnd, { id: 't1', cancelled: true });
        const bad = await run(sim({ badCriterion: statCriterion('mineBlock', 'minecraft:log2') }));
        assert.equal(bad.gateValid, false);
        assert.ok(bad.weakenedParams.some((w) => /agenda counter objectives not added: stat\.mineBlock\.minecraft\.log2 \(invalid\)/.test(w)), bad.weakenedParams.join('; '));
    });

    test('the agenda does not resume after the task: agenda_resumed fails after resumeMinutes', async () => {
        const r = await run(sim({ noResume: true }));
        const c = byName(r);
        assert.equal(c.task_done.pass, true);
        assert.equal(c.agenda_resumed.pass, false);
        assert.match(c.agenda_resumed.detail, /within 5 min after the done line/);
    });
});

describe('g3-task-preempts-agenda: the task only while the agenda is active (lead, after smoke round 2)', () => {
    test('agendaActive reads the agenda\'s own chat; the last relevant line wins', () => {
        const a = (lines) => agendaActive(lines).active;
        assert.equal(a([]), false, 'no agenda line yet');
        assert.equal(a(['agenda step rocks started: collect 6 rocks']), true);
        assert.equal(a(['agenda step rocks started: x', 'agenda step rocks done']), true, 'a done step changes nothing');
        assert.equal(a(['agenda step rocks started: x', 'agenda step rocks stuck: 5 min of self-prompting; agenda paused']), false);
        assert.equal(a(['agenda step rocks started: x', 'agenda paused for task t1']), false);
        assert.equal(a(['agenda paused for task t1', 'agenda resumed: logs']), true);
        assert.equal(a(['agenda started']), true);
        for (const end of ['agenda done', 'agenda stopped']) assert.equal(a(['agenda step rocks started: x', end]), false, end);
        assert.equal(a(['agenda step rocks started: x', 'I think the agenda paused']), true, 'free chat is not an agenda line');
        assert.deepEqual(agendaActive(['agenda step rocks started: x', 'agenda done']), { active: false, last: 'agenda done' });
    });

    test('round 2\'s case: the agenda paused itself before the task and never restarts: not reached, no task whispered', async () => {
        const s = sim({ stuckAt: 4.9 });
        const r = await run(s);
        const c = byName(r);
        for (const k of ['task_accepted', 'task_done', 'agenda_resumed']) {
            assert.match(c[k].detail, /^not reached: agenda not active at the task \(not active for 5 min; its last agenda line: "agenda step rocks stuck: 5 min of self-prompting; agenda paused"\)$/, k);
            assert.equal(c[k].pass, false, k);
        }
        assert.ok(!s.sent.some((x) => x.startsWith('tell ')), 'no task without an active agenda');
        assert.equal(r.notes.agendaAtTask.active, false);
        assert.ok(r.notes.agendaAtTask.waitedS >= 300, `waited the full bound: ${r.notes.agendaAtTask.waitedS}s`);
        assert.equal(c.no_cheat.pass, true);
    });

    test('the agenda paused, then started its next step within the bound: the task waits for it and every check passes', async () => {
        const s = sim({ stuckAt: 4.9, restartAt: 7 });
        const r = await run(s);
        const c = byName(r);
        for (const k of Object.keys(g3c.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail}`);
        assert.equal(r.notes.agendaAtTask.active, true);
        assert.equal(r.notes.agendaAtTask.last, 'agenda step sticks started: collect 4 sticks');
        assert.ok(r.notes.agendaAtTask.waitedS > 0, 'it waited');
        assert.ok(r.notes.task.sentMin >= 7, `sent after the restart: minute ${r.notes.task.sentMin}`);
    });

    test('an agenda that never said anything is not active: not reached', async () => {
        const r = await run(sim({ noAgendaLine: true }));
        assert.match(byName(r).task_done.detail, /^not reached: agenda not active at the task \(.*its last agenda line: none\)$/);
    });

    test('agenda_resumed names what task_done missed (no longer "the task was not done")', async () => {
        const noPause = byName(await run(sim({ noPause: true })));
        assert.equal(noPause.agenda_resumed.detail, 'not reached: task_done failed (no "agenda paused for task t1" line (no preemption seen))');
        const never = byName(await run(sim({ neverThere: true })));
        assert.equal(never.agenda_resumed.detail, 'not reached: task_done failed (the server never found the bot on the marker)');
        const failed = byName(await run(sim({ fail: true })));
        assert.match(failed.agenda_resumed.detail, /^not reached: task_done failed \(the server never found the bot on the marker; the bot said "task t1 failed: no path to the gold block"\)$/);
    });
});
