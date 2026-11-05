// G3 (c), ready-to-try item 10 (task part): a task giver's task interrupts the REAL agent's agenda, the
// agent does it and reports, and then its agenda resumes. The plan: coord/STATUS-harness-ops.md, "Scenario
// g3-task-preempts-agenda" (lead, #101).
//
// Driver: test/runner/drivers/mindcraft-driver.mjs with the pinned model (llm: true). The driver turns on
// skills-rotn's test-only switch allow_server_task_giver, so the console sender `Server` is a task giver here
// only (never in production; g3-untrusted-refused shows it is refused there). Gate-valid only under
// batch.mjs's spend stop (maxBatchUsd 2, 'equal').
//
// Pinned (lead, #207 review; PINNED is true):
//   - the marker: S1-A's server-confirmed surface rock pile at -42 68 -50 in the G2 world, about 19 blocks
//     from the spawn (-50.5 64 -66.5), inside the spawn chunks. No sampled surface cell lies exactly 20-30
//     blocks out; this is the nearest (the next is 32 blocks, (d)'s marker). The gold block replaces the
//     pile, so it is the top solid block. "Dry and reachable" is checked at run time by the preflight: the
//     two cells above it must be air (water is not air), or the task steps fail with "site not clear";
//   - the agenda counter: stat.mineBlock for the rock piles and logs, plus stat.craftItem for the five
//     early-game crafts. No pickup stat (item-collecting modes raise those). Every criterion must be added,
//     or the run is not gate-valid.
//
// State (#207 review): the driver moves the bot's tasks.json and agenda.json aside before main.js starts
// (fresh_bot_state checks its start event), and this scenario ends with no open task: a task still open at
// the end is cancelled with the giver's `!taskCancel("<id>")`.
//
// Steps (no tp of any form, lead #201; the server is the arbiter, the agent's chat is checked against it):
//   1. login_online, fresh_bot_state; objectives g3c_a<n> for every criterion of agendaCounter (the counter
//      is their sum; one the server rejects is recorded, not counted, and makes the run not gate-valid).
//   2. Warm-up: the agent plays its agenda for warmMinutes (5). agenda_active: the counter rose.
//   3. The preflight, read-only: `testforblock X Y+1 Z minecraft:air 0` and the same for Y+2. Then
//      `setblock <marker> minecraft:gold_block` (approved for the task marker only), confirmed read-only with
//      `testforblock <marker> minecraft:gold_block 0` (placeGoldMarker; no proof: the task steps fail), then the test-only
//      giver whispers what a player would type: `tell <bot> !taskAdd("go to the gold block at X Y Z and
//      stand on it", "normal")`, but only while the agenda is active (lead, after smoke round 2: there the
//      agenda had paused itself as stuck 13 s before the task, so there was no preemption to see). The
//      agenda's state is read from its own chat (agendaActive). It waits up to activeWaitMinutes (5); if
//      the agenda is not active by then, the task steps are "not reached: agenda not active at the task"
//      (not a pass, and not a task failure), and no task is whispered.
//   4. task_accepted: "task <id> accepted: ..." in the bot's chat within acceptS (60 s).
//   5. task_done: within taskMinutes (5), the server finds the bot standing on the marker, by
//      `testfor @a[name=<bot>,x=X,y=Y+1,z=Z,dx=0,dy=1,dz=0]` (1.12's volume selector: the bot's box is in the
//      two cells above the gold block), polled every taskPollMs, AND the bot says "task <id> done", AND it
//      said "agenda paused for task <id>" (the preemption itself, #207 review).
//      "task <id> failed: ..." ends the step early.
//   6. agenda_resumed: within resumeMinutes (5) after the done line, the counter rises above its value at
//      the done line. When task_done failed, it is "not reached" with the part of task_done that was missing.
//   7. no_cheat (cheatProblems). The objectives are removed; the gold block stays (the server is disposable,
//      and setting the old block back is not an approved command).
// Notes: "agenda paused for task <id>" and "agenda resumed: <step>" (the agent's own view of the preemption),
// the counter readings, the minute the server first saw the bot on the marker.
import { startSession } from '../../runner/lib/session.mjs';
import { G2_WORLD_SEED, parseCentre, testforVerdict } from '../../runner/lib/g2.mjs';
import { G3_DEFAULTS, G3_GATE_PARAMS, G3_MARKERS, TEST_TASK_GIVER, airAbove, cheatProblems, guardConsole, notClearText, placeGoldMarker, startEvent, statCriterion } from '../../runner/lib/g3.mjs';
import { playerScores, scoreboardAddResult } from '../../runner/lib/s1.mjs';
import { chatLines } from '../../runner/lib/server-log.mjs';
import { lateConsole } from '../../runner/lib/late-console.mjs';

const MS = 1000;
const MIN = 60 * MS;

/** The marker and the agenda counter are pinned (lead, #207 review). */
export const PINNED = true;
/** S1-A's confirmed surface rock pile nearest the 20-30 block band (about 19 blocks from the spawn). */
export const MARKER = G3_MARKERS.task;

/** The agenda counter (lead, #207 review): mineBlock for the rock piles and logs, craftItem for the five crafts. */
export const AGENDA_COUNTER = [
    statCriterion('mineBlock', 'pyrotech:rock'),
    statCriterion('mineBlock', 'pyrotech_compat:rock_igneous'),
    statCriterion('mineBlock', 'pyrotech_compat:rock_metamorphic'),
    statCriterion('mineBlock', 'pyrotech_compat:rock_sedimentary'),
    statCriterion('mineBlock', 'minecraft:log'),
    statCriterion('mineBlock', 'minecraft:log2'),
    statCriterion('craftItem', 'pyrotech:crude_axe'),
    statCriterion('craftItem', 'contenttweaker:crafting_tools'),
    statCriterion('craftItem', 'minecraft:crafting_table'),
    statCriterion('craftItem', 'minecraft:stone_pickaxe'),
    statCriterion('craftItem', 'minecraft:stone_axe'),
].join(',');

/** What a task giver would type (the runner gives no other hint). */
export const taskText = ([x, y, z]) => `go to the gold block at ${x} ${y} ${z} and stand on it`;
/** The server's check that the bot stands on the marker: its box in the two cells above the block. */
export const onMarkerCommand = (bot, [x, y, z]) => `testfor @a[name=${bot},x=${x},y=${y + 1},z=${z},dx=0,dy=1,dz=0]`;

/**
 * The agenda's state from its own chat lines (skills-rotn's agenda_driver.js, priority.js, actions.js), the
 * last relevant line wins: active after "agenda step <id> started: ...", "agenda resumed: <id>" or "agenda
 * started"; not active after "agenda step <id> stuck: ...; agenda paused", "agenda paused for task <id>",
 * "agenda done" or "agenda stopped". "agenda step <id> done" changes nothing. No such line yet: not active.
 * Returns {active, last} (last: the deciding line, or null).
 */
export function agendaActive(lines) {
    let active = false;
    let last = null;
    for (const t of lines) {
        if (/^agenda step \S+ started: /.test(t) || /^agenda resumed: \S+$/.test(t) || t === 'agenda started') { active = true; last = t; }
        else if (/^agenda step \S+ stuck: .*; agenda paused$/.test(t) || /^agenda paused for task \S+$/.test(t) || t === 'agenda done' || t === 'agenda stopped') { active = false; last = t; }
    }
    return { active, last };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default {
    id: 'g3-task-preempts-agenda',
    gate: 'G3',
    llm: true,
    title: 'A task giver\'s task interrupts the agent\'s agenda; the agent does it, reports, and its agenda resumes (the server checks)',
    checks: {
        login_online: 'Starting the bot makes it log in with its own account (online mode)',
        fresh_bot_state: 'The bot starts with no task queue or agenda state from an earlier run',
        agenda_active: 'Left alone, it pursues its agenda (the server\'s agenda counter rises)',
        task_accepted: 'A task giver\'s task is accepted in chat',
        task_done: 'It does the task (the server finds it on the marker) and reports it done',
        agenda_resumed: 'Afterwards its agenda resumes (the counter rises again)',
        no_cheat: 'No give, game mode change, op or command by the bot during the run (the pack\'s first-join commands aside)',
    },
    defaults: {
        bot: 'FRCFLD',
        worldSeed: G2_WORLD_SEED,
        marker: MARKER,
        agendaCounter: AGENDA_COUNTER,
        cancelS: 30,
        warmMinutes: 5,
        activeWaitMinutes: 5,
        acceptS: 60,
        taskMinutes: 5,
        resumeMinutes: 5,
        ...G3_DEFAULTS,
        loginTimeoutMs: 240 * MS,
        counterPollMs: 60 * MS,
        taskPollMs: 5 * MS,
        pollMs: 1 * MS,
        logTail: 20000,
        consoleWaitS: 1,
        lateReplyMs: 5 * MS,
        latePollMs: 1 * MS,
    },
    gateParams: { marker: 'equal', agendaCounter: 'equal', warmMinutes: 'equal', activeWaitMinutes: 'equal', acceptS: 'equal', taskMinutes: 'equal', resumeMinutes: 'equal', ...G3_GATE_PARAMS },

    async run(ctx) {
        const { bot, clock, params: p } = ctx;
        const server = guardConsole(ctx.server);   // run.mjs guards too
        const name = p.bot;
        if (!PINNED) ctx.notGate('the task marker and the agenda counter are provisional: the lead pins them before a gate batch (#101)');
        const marker = parseCentre(p.marker);
        const s = await startSession(ctx, { name, checkNaming: false });   // say and seed only
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        const start = startEvent(typeof bot.output === 'function' ? bot.output() : []);
        ctx.check('fresh_bot_state', start?.botState?.fresh === true,
            start?.botState ? `the driver moved aside: ${start.botState.movedAside.join(', ') || 'nothing (none there)'}` : 'no botState in the driver\'s start event');
        const lc = lateConsole(server, clock, { waitS: p.consoleWaitS, lateMs: p.lateReplyMs, pollMs: p.latePollMs });
        const confirm = async (cmd, accept) => {
            const n = lc.late().length;
            const lines = await lc.confirm(cmd, accept);
            if (lc.late().length > n) ctx.note('lateReplies', lc.late());
            return lines;
        };

        // 1. the counter's objectives (the uncounted gap before they exist fails safe: it can only miss a rise)
        const stats = String(p.agendaCounter).split(',').map((c) => c.trim()).filter(Boolean).map((criteria, i) => ({ obj: `g3c_a${i}`, criteria }));
        for (const st of stats) lc.con(`scoreboard objectives remove ${st.obj}`);
        for (const st of stats) {
            st.result = scoreboardAddResult(await confirm(`scoreboard objectives add ${st.obj} ${st.criteria}`,
                (l) => scoreboardAddResult(l, st.obj, st.criteria) !== null), st.obj, st.criteria);
        }
        ctx.note('counterObjectives', stats);
        const counted = stats.filter((st) => st.result === 'added');
        const missing = stats.filter((st) => st.result !== 'added');
        if (missing.length) ctx.notGate(`agenda counter objectives not added: ${missing.map((st) => `${st.criteria} (${st.result ?? 'no reply'})`).join(', ')}`);
        const readings = [];
        const counter = async (label) => {
            const sc = playerScores(await confirm(`scoreboard players list ${name}`, (l) => playerScores(l, name) !== null), name);
            const v = sc ? counted.reduce((n, st) => n + (sc[st.obj] ?? 0), 0) : null;   // no score yet is 0 (S1-A)
            readings.push({ label, min: Math.round(((clock.now() - s.joinedAt) / MIN) * 10) / 10, value: v });
            ctx.note('counterReadings', readings);
            return v;
        };
        const gone = () => s.events().find(s.gone) ?? (!bot.alive() ? { type: 'exited', reason: `code ${bot.exitCode()}` } : null);
        const goneText = (g) => `the bot is gone: ${g.type}${g.reason ? ` (${g.reason})` : ''}`;
        const said = () => chatLines(s.sinceMarker(), name).map((c) => c.text);
        let openTask = null;   // accepted, with no done or failed line yet
        const finish = async () => {
            if (openTask) {
                // End with no open task (#207 review): the giver cancels it, so nothing carries over.
                const before = said().length;
                lc.con(`tell ${name} !taskCancel("${openTask}")`);
                const cancelled = await ctx.waitFor(() => said().slice(before).includes(`task ${openTask} cancelled`), p.cancelS * MS);
                ctx.note('openTaskAtEnd', { id: openTask, cancelled: Boolean(cancelled) });
            }
            for (const st of stats) lc.con(`scoreboard objectives remove ${st.obj}`);
            ctx.note('agendaChat', said().filter((t) => /^(agenda|task) /.test(t)));
            const cheat = cheatProblems(s.sinceMarker(), name);
            ctx.note('packFirstJoin', cheat.packFirstJoin);
            ctx.note('packRepeats', cheat.packRepeats);
            ctx.check('no_cheat', cheat.problems.length === 0, cheat.problems.length ? cheat.problems.slice(0, 5).join('; ') : `nothing found (the pack's first-join commands: ${cheat.packFirstJoin.join(', ') || 'none'})`);
        };
        const notReached = (why) => { for (const k of ['task_accepted', 'task_done', 'agenda_resumed']) ctx.check(k, false, `not reached: ${why}`); };

        // 2. the warm-up
        const c0 = await counter('start');
        const warmEnd = s.joinedAt + p.warmMinutes * MIN;
        while (clock.now() < warmEnd && !gone()) await clock.sleep(Math.min(p.counterPollMs, Math.max(MS, warmEnd - clock.now())));
        const c1 = await counter('before the task');
        ctx.check('agenda_active', counted.length > 0 && c1 > c0,
            counted.length ? `counter ${c0 ?? '?'} -> ${c1 ?? '?'} over ${p.warmMinutes} min (${counted.length}/${stats.length} objectives)` : 'no counter objective was added');
        if (gone()) { notReached(goneText(gone())); return finish(); }
        if (!marker) { notReached(`no task marker: '${p.marker}' is not "x,y,z" (the lead pins it, #101)`); return finish(); }

        // 3. the preflight (read-only): the two cells above the marker must be air, then the marker and the task
        const above = await airAbove(confirm, marker);
        ctx.note('markerPreflight', above);
        if (!above.every((c) => c.air)) { notReached(`site not clear: ${notClearText(above)}`); return finish(); }
        const placed = await placeGoldMarker(confirm, marker);
        ctx.note('marker', placed);
        if (!placed.goldBlock) { notReached(`the gold block is not at the marker: ${placed.detail}`); return finish(); }
        // only while the agenda is active (lead, after smoke round 2), bounded by activeWaitMinutes
        const waitFrom = clock.now();
        const activeEnd = waitFrom + p.activeWaitMinutes * MIN;
        let ag = agendaActive(said());
        while (!ag.active && clock.now() < activeEnd && !gone()) {
            await clock.sleep(Math.min(p.pollMs, Math.max(MS, activeEnd - clock.now())));
            ag = agendaActive(said());
        }
        ctx.note('agendaAtTask', { active: ag.active, waitedS: Math.round((clock.now() - waitFrom) / MS), last: ag.last });
        if (gone()) { notReached(goneText(gone())); return finish(); }
        if (!ag.active) {
            notReached(`agenda not active at the task (not active for ${p.activeWaitMinutes} min; its last agenda line: ${ag.last ? `"${ag.last}"` : 'none'})`);
            return finish();
        }
        const chatBefore = said().length;
        const text = taskText(marker);
        lc.con(`tell ${name} !taskAdd("${text}", "normal")`);
        ctx.note('task', { giver: TEST_TASK_GIVER, text, sentMin: Math.round(((clock.now() - s.joinedAt) / MIN) * 10) / 10 });

        // 4. accepted
        const acceptRe = /^task (t?\d+) accepted: (.*)$/;
        const acc = await ctx.waitFor(() => said().slice(chatBefore).map((t) => acceptRe.exec(t)).find(Boolean) || (gone() && { gone: true }), p.acceptS * MS);
        const id = acc && !acc.gone ? acc[1] : null;
        ctx.check('task_accepted', Boolean(id), id ? `task ${id} accepted: ${acc[2]}` : acc?.gone ? goneText(gone()) : `no "task <id> accepted" within ${p.acceptS}s`);
        if (!id) { ctx.check('task_done', false, 'not reached: the task was not accepted'); ctx.check('agenda_resumed', false, 'not reached: the task was not accepted'); return finish(); }
        openTask = id;

        // 5. done: the server's view and the agent's report
        const doneRe = new RegExp(`^task ${esc(id)} done$`);
        const failRe = new RegExp(`^task ${esc(id)} failed: (.*)$`);
        const taskEnd = clock.now() + p.taskMinutes * MIN;
        let onMarkerMin = null;
        let report = null;
        while (clock.now() < taskEnd && !gone()) {
            if (onMarkerMin === null) {
                const v = testforVerdict(await confirm(onMarkerCommand(name, marker), (l) => l.some((x) => /Found |found nothing|cannot be found|No entity/i.test(x))));
                if (v.ok) onMarkerMin = Math.round(((clock.now() - s.joinedAt) / MIN) * 10) / 10;
            }
            const lines = said().slice(chatBefore);
            report = lines.find((t) => doneRe.test(t)) ?? lines.find((t) => failRe.test(t)) ?? null;
            if (report && onMarkerMin !== null) break;
            if (report && failRe.test(report)) break;
            await clock.sleep(Math.min(p.taskPollMs, Math.max(MS, taskEnd - clock.now())));
        }
        const doneAt = clock.now();
        if (report) openTask = null;   // done or failed: closed
        const preempted = said().slice(chatBefore).includes(`agenda paused for task ${id}`);
        ctx.note('taskResult', { id, onMarkerMin, report, preempted });
        const done = onMarkerMin !== null && report !== null && doneRe.test(report) && preempted;
        ctx.check('task_done', done, `${onMarkerMin !== null ? `the server found the bot on the marker at minute ${onMarkerMin}` : 'the server never found the bot on the marker'}; ${report ? `the bot said "${report}"` : 'no done report'}; ${preempted ? 'the agenda was paused for it' : `no "agenda paused for task ${id}" line`}${gone() ? `; ${goneText(gone())}` : ''}`);
        if (!done) {
            const missing = [onMarkerMin === null && 'the server never found the bot on the marker', !report && 'no done report',
                report && !doneRe.test(report) && `the bot said "${report}"`,
                !preempted && `no "agenda paused for task ${id}" line (no preemption seen)`].filter(Boolean);
            ctx.check('agenda_resumed', false, `not reached: task_done failed (${missing.join('; ') || 'see task_done'})`);
            return finish();
        }

        // 6. the agenda resumes
        const c2 = await counter('at the done line');
        const resumeEnd = doneAt + p.resumeMinutes * MIN;
        let c3 = c2;
        while (!(c3 > c2) && clock.now() < resumeEnd && !gone()) {
            await clock.sleep(Math.min(p.counterPollMs, Math.max(MS, resumeEnd - clock.now())));
            c3 = await counter('after the task');
        }
        ctx.check('agenda_resumed', c2 !== null && c3 > c2, `counter ${c2 ?? '?'} -> ${c3 ?? '?'} within ${p.resumeMinutes} min after the done line${said().some((t) => /^agenda resumed: /.test(t)) ? ' (the agent said "agenda resumed")' : ''}`);
        await finish();
    },
};
