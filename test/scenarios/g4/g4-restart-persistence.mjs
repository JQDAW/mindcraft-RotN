// G4 #11, ready-to-try: "The task queue and the agenda survive a service restart." test/scenarios/g4/PLAN.md item 11,
// step 3 (the agenda half on S). Set-up S: the CX23 service through the ssh gate (run.mjs --service frcfld,
// lib/service.mjs); the restart is the ctl's `stop` then `start` (the gate has no restart verb, ADR 0009). On a spawned
// driver (set-up T) it is a rehearsal: the restart is the driver's stop and a new start with ROTN_DRIVER_KEEP_STATE=1
// (else the driver moves the state aside at every start), and the run is not-gate. Every G4 run is not-gate on a test
// server anyway (G4_TEST_SERVER_NOT_GATE) until step 7.
//
// What the bot does (skills-rotn #327): agenda.json and tasks.json are on disk. After a process restart the first step
// the agenda names says "agenda step <id> started: <text> (resumed after a restart)" (its done steps stay done), and a
// task that was running is queued again and says "task <id> started: <text> (resumed after a restart)".
//
// Steps:
//   1. The service's bot must be this run's bot (case aside) and its unit inactive; login_online.
//   2. agenda_progress: within progressMaxMinutes, the agenda is active (agendaActive) with at least minDoneSteps
//      steps done (the bot's own "agenda step <id> done" / "agenda steps done: a, b" lines). An agenda that finished
//      first is "not reached: ... scenario timing", never a bot fail.
//   3. task_queued, the task half: only where the console sender is a task giver (the T driver turns the test-only
//      switch on; on S, Server is never a giver, so "not reached: needs a trusted giver on S"). The gold marker as in
//      g3-task-preempts-agenda, then the whisper; the restart follows as soon as "task <id> started" is seen.
//   4. restart_rejoin: stop (service: the ctl's stop, waits for inactive; driver: the process stop), then start; the
//      bot joins again within rejoinMinutes.
//   5. agenda_resumed: within resumeMinutes of the rejoin, the agenda's first step line is "agenda step <id> started:
//      ... (resumed after a restart)", or "agenda resumed: <id>" only when a task was running at the restart (the
//      agenda resumes after it), for a step not done before. A plain "started" (no restart suffix) is a fail: the
//      agenda began anew. With agenda_progress failed, nothing after it runs: no stop or start is sent.
//   6. no_step_twice: for observeMinutes after the rejoin, no step done before the restart is reported done again.
//   7. task_resumed (task half): "task <id> started: ... (resumed after a restart)" within resumeMinutes of the rejoin.
// Notes: the done steps before and after, the agenda and task lines around the restart, the metrics (service).
import { startSession } from '../../runner/lib/session.mjs';
import { G2_WORLD_SEED, parseCentre } from '../../runner/lib/g2.mjs';
import { G3_MARKERS, airAbove, consoleAllowFor, guardConsole, notClearText, placeGoldMarker } from '../../runner/lib/g3.mjs';
import { chatLines } from '../../runner/lib/server-log.mjs';
import { lateConsole } from '../../runner/lib/late-console.mjs';
import { exitedText } from '../../runner/lib/service.mjs';
import { agendaActive, taskText } from '../g3/g3-task-preempts-agenda.mjs';

const MS = 1000;
const MIN = 60 * MS;
const RESTART_SUFFIX = ' (resumed after a restart)';

/** Steps the bot says are done, in order: "agenda step <id> done" and "agenda steps done: a, b". */
export function doneSteps(lines) {
    const out = [];
    for (const t of lines) {
        let m;
        if ((m = /^agenda step (\S+) done$/.exec(t))) out.push(m[1]);
        else if ((m = /^agenda steps done: (.+)$/.exec(t))) out.push(...m[1].split(',').map((x) => x.trim()).filter(Boolean));
    }
    return out;
}

/**
 * The agenda's first step line in `lines`: {kind: 'restart' | 'resumed' | 'fresh', id, line} for
 * "agenda step <id> started: ... (resumed after a restart)", "agenda resumed: <id>" or a plain "agenda step <id> started: ...".
 */
export function firstStepLine(lines) {
    for (const t of lines) {
        let m;
        if ((m = /^agenda step (\S+) started: (.*)$/.exec(t))) return { kind: m[2].endsWith(RESTART_SUFFIX) ? 'restart' : 'fresh', id: m[1], line: t };
        if ((m = /^agenda resumed: (\S+)$/.exec(t))) return { kind: 'resumed', id: m[1], line: t };
    }
    return null;
}

export default {
    id: 'g4-restart-persistence',
    gate: 'G4',
    // On S the bot's calls go to the CX23's own key, which the runner cannot read; a T rehearsal's spend shows in the
    // batch's key reading (lead, #374 review).
    llm: false,
    title: 'The agenda (and, where a giver can queue one, a running task) survives a stop and start of the bot and resumes; no step is done twice',
    checks: {
        login_online: 'The bot logs in with its own account (online mode); on S from an inactive unit of this run\'s bot',
        agenda_progress: 'Before the restart the agenda runs and has done some steps',
        task_queued: 'A task giver\'s task is running at the restart (only where the console is a giver: T; on S it needs a trusted player)',
        restart_rejoin: 'After a stop and a start (the ctl on S), the bot joins again in time',
        agenda_resumed: 'The agenda resumes after the restart ("resumed after a restart"), at a step not done before',
        no_step_twice: 'No step done before the restart is done again after it',
        task_resumed: 'The running task resumes after the restart ("resumed after a restart")',
    },
    defaults: {
        bot: 'FRCFLD',
        worldSeed: G2_WORLD_SEED,
        marker: G3_MARKERS.task,
        minDoneSteps: 2,
        progressMaxMinutes: 10,
        taskStartS: 90,
        rejoinMinutes: 5,
        resumeMinutes: 5,
        observeMinutes: 5,
        loginTimeoutMs: 240 * MS,
        pollMs: 5 * MS,
        logTail: 20000,
        consoleWaitS: 1,
        lateReplyMs: 5 * MS,
        latePollMs: 1 * MS,
    },
    gateParams: { marker: 'equal', minDoneSteps: 'equal', rejoinMinutes: 'equal', resumeMinutes: 'equal', observeMinutes: 'equal' },
    // The login wait, the progress window, the task's start, the stop (1 min) and the rejoin, the resume and the
    // observation windows.
    runMinutes: (p) => p.loginTimeoutMs / MIN + p.progressMaxMinutes + p.taskStartS / 60 + 1 + p.rejoinMinutes + Math.max(p.resumeMinutes, p.observeMinutes),

    async run(ctx) {
        const { bot, clock, params: p } = ctx;
        const server = guardConsole(ctx.server, consoleAllowFor({ id: 'g4-restart-persistence' }, p));
        const name = p.bot;
        const service = bot.kind === 'service';
        const after = ['agenda_progress', 'task_queued', 'restart_rejoin', 'agenda_resumed', 'no_step_twice', 'task_resumed'];
        const notReached = (keys, why) => { for (const k of keys) ctx.check(k, false, `not reached: ${why}`); };
        if (!service) ctx.notGate('not the CX23 service (set-up T): a rehearsal');

        // 1. this run's bot, from an inactive unit (service only)
        if (service && String(bot.bot).toLowerCase() !== String(name).toLowerCase()) {
            ctx.check('login_online', false, `the service's bot '${bot.bot}' is not this run's bot '${name}'`);
            notReached(after, 'the service is another bot');
            return;
        }
        const m0 = service ? await bot.metrics() : null;
        ctx.note('metricsBefore', m0);
        if (service && m0?.ActiveState !== 'inactive' && m0?.ActiveState !== 'failed') {
            ctx.check('login_online', false, `the unit is ${m0?.ActiveState ?? 'unknown'} before the start: stop it first`);
            notReached(after, 'the unit was not inactive at the start');
            return;
        }
        const s = await startSession(ctx, { name, checkNaming: false });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) { notReached(after, 'the bot did not log in'); return; }
        const said = () => chatLines(s.sinceMarker(), name).map((c) => c.text);
        const joins = () => s.events().filter((e) => e.type === 'joined');
        const gone = () => (bot.alive() ? null : exitedText(bot));

        // 2. the agenda runs and has done some steps
        const enough = () => { const t = said(); const a = agendaActive(t); return (a.active && doneSteps(t).length >= p.minDoneSteps) || a.last === 'agenda done' || a.last === 'agenda stopped'; };
        await ctx.waitFor(() => enough() || gone(), p.progressMaxMinutes * MIN, p.pollMs);
        const before = said();
        const ag = agendaActive(before);
        const doneBefore = doneSteps(before);
        ctx.note('doneBeforeRestart', doneBefore);
        if (gone()) { ctx.check('agenda_progress', false, gone()); notReached(after.slice(1), 'the bot is gone'); return; }
        if (ag.last === 'agenda done' || ag.last === 'agenda stopped') {
            // Never a silent bot fail: there is no running agenda to restart (on S, agenda.json may hold an earlier run's).
            notReached(after, `the agenda had finished before the restart ("${ag.last}"; ${doneBefore.length} steps done): a scenario-timing gap, not a bot result`
                + `${service ? ' (on S the agenda state persists from earlier runs: the human resets it under the GO)' : ''}`);
            return;
        }
        const progressed = ag.active && doneBefore.length >= p.minDoneSteps;
        ctx.check('agenda_progress', progressed,
            `${doneBefore.length} steps done (${doneBefore.join(', ') || 'none'}); the agenda is ${ag.active ? 'active' : `not active (last: ${ag.last ?? 'none'})`}`);
        if (!progressed) {
            // No restart without a running agenda that has done steps (#383 review): nothing to resume or to do twice.
            notReached(after.slice(1), `the agenda had not progressed before the restart (${doneBefore.length} of ${p.minDoneSteps} steps done within ${p.progressMaxMinutes} min); no stop or start was sent`);
            return;
        }

        // 3. the task half: only where the console sender is a task giver
        const start = !service && typeof bot.output === 'function' ? bot.output().map((l) => { try { return l.startsWith('DRIVER ') ? JSON.parse(l.slice(7)) : null; } catch { return null; } })
            .find((e) => e?.type === 'mindcraft_start') : null;
        const giver = !service && start?.serverTaskGiver === true;
        let taskId = null;
        if (!giver) {
            notReached(['task_queued'], service ? 'needs a trusted giver on S: the human as JQDAW (PLAN #11); the console sender is never a giver under the production settings'
                : 'the driver did not turn the test-only console giver on');
        } else {
            const marker = parseCentre(p.marker);
            const lc = lateConsole(server, clock, { waitS: p.consoleWaitS, lateMs: p.lateReplyMs, pollMs: p.latePollMs });
            const confirm = (cmd, accept) => lc.confirm(cmd, accept);
            const above = marker ? await airAbove(confirm, marker) : [];
            const placed = marker && above.every((c) => c.air) ? await placeGoldMarker(confirm, marker) : null;
            if (!placed?.goldBlock) {
                notReached(['task_queued'], marker ? (above.every((c) => c.air) ? `the gold block is not at the marker: ${placed?.detail}` : `site not clear: ${notClearText(above)}`) : `no task marker '${p.marker}'`);
            } else {
                const from = said().length;
                server.console(`tell ${name} !taskAdd("${taskText(marker)}", "normal")`, p.consoleWaitS);
                const started = await ctx.waitFor(() => said().slice(from).map((t) => /^task (t?\d+) started: /.exec(t)).find(Boolean), p.taskStartS * MS, p.pollMs);
                taskId = started?.[1] ?? null;
                ctx.check('task_queued', Boolean(taskId), taskId ? `task ${taskId} running at the restart` : `no "task <id> started" within ${p.taskStartS} s of the whisper`);
            }
        }

        // 4. the restart: stop, then start (the ctl's on S; on T the same driver with the state kept)
        const j0 = joins().length;
        const said0 = said().length;
        let restartError = null;
        try {
            await bot.stop();
            if (service) bot.start(); else bot.start({ ROTN_SCENARIO_BOT: name, ROTN_SCENARIO_RUN: ctx.runId, ROTN_DRIVER_KEEP_STATE: '1' });
        } catch (e) { restartError = String(e?.message ?? e); }
        const restartAt = clock.now();
        const back = !restartError && await ctx.waitFor(() => joins().length > j0 || (!bot.alive() && bot.needsStop?.() !== true && { gone: true }), p.rejoinMinutes * MIN, p.pollMs);
        const rejoined = Boolean(back) && !back.gone && joins().length > j0;
        ctx.note('metricsAfterRestart', service ? await bot.metrics().catch((e) => ({ error: String(e?.message ?? e) })) : null);
        ctx.check('restart_rejoin', rejoined, restartError ? `the restart failed: ${restartError}`
            : rejoined ? `joined again ${Math.round((clock.now() - restartAt) / MS)} s after the start` : `no rejoin within ${p.rejoinMinutes} min of the start${gone() ? `; ${gone()}` : ''}`);
        if (!rejoined) {
            notReached(['agenda_resumed', 'no_step_twice'], 'the bot did not rejoin after the restart');
            notReached(['task_resumed'], taskId ? 'the bot did not rejoin after the restart' : giver ? 'no task was running at the restart' : 'no task (see task_queued)');
            return;
        }

        // 5. the agenda resumes, at a step not done before
        const afterLines = () => said().slice(said0);
        const first = await ctx.waitFor(() => firstStepLine(afterLines()), p.resumeMinutes * MIN, p.pollMs);
        ctx.note('firstAgendaLineAfterRestart', first?.line ?? null);
        // "agenda resumed: <id>" is the agenda coming back after a task, so it counts only when a task was running at the
        // restart (#383 review); without one, the restart line is the one to see.
        const resumedWithoutTask = first?.kind === 'resumed' && !taskId;
        ctx.check('agenda_resumed', Boolean(first) && first.kind !== 'fresh' && !resumedWithoutTask && !doneBefore.includes(first.id),
            !first ? `no agenda step line within ${p.resumeMinutes} min of the rejoin`
                : first.kind === 'fresh' ? `the agenda began anew: "${first.line}" (no "${RESTART_SUFFIX.trim()}")`
                    : resumedWithoutTask ? `"${first.line}" with no task running at the restart: not the restart's "${RESTART_SUFFIX.trim()}" line`
                        : doneBefore.includes(first.id) ? `it resumed at ${first.id}, a step done before the restart: "${first.line}"` : `"${first.line}"`);

        // 7 (before 6's wait): the task resumes
        if (taskId) {
            const re = new RegExp(`^task ${taskId} started: .*\\(resumed after a restart\\)$`);
            const tr = afterLines().find((t) => re.test(t)) ?? await ctx.waitFor(() => afterLines().find((t) => re.test(t)), p.resumeMinutes * MIN, p.pollMs);
            ctx.check('task_resumed', Boolean(tr), tr ? `"${tr}"` : `no "task ${taskId} started: ... (resumed after a restart)" within ${p.resumeMinutes} min of the rejoin`);
        } else notReached(['task_resumed'], giver ? 'no task was running at the restart' : 'no task (see task_queued)');

        // 6. no step done twice
        const until = restartAt + p.observeMinutes * MIN;
        while (clock.now() < until && !gone()) await clock.sleep(Math.min(p.pollMs, Math.max(MS, until - clock.now())));
        const doneAfter = doneSteps(afterLines());
        const twice = doneAfter.filter((id) => doneBefore.includes(id));
        ctx.note('doneAfterRestart', doneAfter);
        ctx.check('no_step_twice', twice.length === 0, twice.length ? `done again after the restart: ${twice.join(', ')}` : `${doneAfter.length} steps done after the restart (${doneAfter.join(', ') || 'none'}), none of them done before`);
    },
};
