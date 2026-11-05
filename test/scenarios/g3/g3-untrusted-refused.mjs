// G3 (d), ready-to-try item 10 (last sentence): "Untrusted players' tasks are politely refused." A short
// session of the REAL agent with the PRODUCTION task-giver list: the console sender `Server` is not a giver
// here, so its task must be refused politely and must not be queued or acted on. The plan:
// coord/STATUS-harness-ops.md, "Scenario g3-task-preempts-agenda", "Untrusted refusal" (lead, #101).
//
// Driver: test/runner/drivers/mindcraft-driver.mjs. This scenario starts it with ROTN_G3_PRODUCTION_GIVERS=1,
// which turns skills-rotn's test-only allow_server_task_giver OFF (it can only turn it off), so the agent
// runs with settings.js's task_givers (JQDAW only). The driver's mindcraft_start event reports
// serverTaskGiver, and the scenario requires it to be false. Gate-valid only under the spend stop
// (maxBatchUsd 2, 'equal').
//
// Steps (no tp; the runner gives no hints):
//   1. login_online; the driver's start event says serverTaskGiver false (production_givers).
//   2. After settleS (60 s, for the agent to be listening), the console whispers what an untrusted player
//      would type: `tell <bot> !taskAdd("collect 5 dirt for me", "normal")`.
//   3. refused_politely: within acceptS (60 s) the bot's public chat shows skills-rotn's refusal, addressed to
//      the sender: "Sorry Server, I only run commands from task givers." (agent.js) or "task refused: Server
//      is not a task giver" (task_queue.js).
//   4. no_task: for observeS (90 s) after the whisper, no "task <id> accepted|started" line, no "agenda
//      paused for task" line and no "*Server used taskAdd*" line (the agent's echo of a command it runs).
//      The runner reads only chat, never the bot's queue file; the !taskList query is a command, which
//      the untrusted sender cannot run either.
//   5. no_cheat (cheatProblems).
import { startSession } from '../../runner/lib/session.mjs';
import { G2_WORLD_SEED } from '../../runner/lib/g2.mjs';
import { G3_DEFAULTS, G3_GATE_PARAMS, TEST_TASK_GIVER, cheatProblems, guardConsole } from '../../runner/lib/g3.mjs';
import { chatLines } from '../../runner/lib/server-log.mjs';
import { PRODUCTION_GIVERS_ENV } from '../../runner/drivers/mindcraft-driver.mjs';

const MS = 1000;
export const UNTRUSTED_TASK = 'collect 5 dirt for me';
/** skills-rotn's refusals of a non-giver (agent.js forced-command guard; task_queue.js addTask). */
export const REFUSALS = (giver) => [`Sorry ${giver}, I only run commands from task givers.`, `task refused: ${giver} is not a task giver`];
/** Chat lines that would mean the task was queued, started or run. */
export const TASK_TAKEN = (giver) => new RegExp(`^(task \\S+ (accepted|started): |agenda paused for task |\\*${giver} used taskAdd\\*)`);

/** The driver's mindcraft_start event in its output, or null. */
export function startEvent(output) {
    for (const l of output) {
        if (!l.startsWith('DRIVER ')) continue;
        try {
            const e = JSON.parse(l.slice(7));
            if (e?.type === 'mindcraft_start') return e;
        } catch { /* not an event */ }
    }
    return null;
}

export default {
    id: 'g3-untrusted-refused',
    gate: 'G3',
    llm: true,
    title: 'With the production giver list, an untrusted sender\'s task is politely refused and never queued (the server log shows it)',
    checks: {
        login_online: 'Starting the bot makes it log in with its own account (online mode)',
        production_givers: 'The agent runs with the production task-giver list (the test-only Server giver is off)',
        refused_politely: 'An untrusted player\'s task gets a polite refusal in chat',
        no_task: 'The refused task is never accepted, started or run',
        no_cheat: 'No give, game mode change, op or command by the bot during the run (the pack\'s first-join commands aside)',
    },
    defaults: {
        bot: 'FRCFLD',
        worldSeed: G2_WORLD_SEED,
        settleS: 60,
        acceptS: 60,
        observeS: 90,
        ...G3_DEFAULTS,
        loginTimeoutMs: 240 * MS,
        pollMs: 2 * MS,
        logTail: 20000,
        consoleWaitS: 1,
    },
    gateParams: { settleS: 'equal', acceptS: 'equal', observeS: 'equal', ...G3_GATE_PARAMS },

    async run(ctx) {
        const { bot, clock, params: p } = ctx;
        const server = guardConsole(ctx.server);   // run.mjs guards too
        const name = p.bot;
        const giver = TEST_TASK_GIVER;
        const s = await startSession(ctx, { name, checkNaming: false, env: { [PRODUCTION_GIVERS_ENV]: '1' } });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        const out = () => (typeof bot.output === 'function' ? bot.output() : []);
        const start = startEvent(out());
        ctx.note('driverStart', start ? { serverTaskGiver: start.serverTaskGiver ?? null, models: start.models ?? null } : null);
        ctx.check('production_givers', start?.serverTaskGiver === false,
            start ? `the driver reports serverTaskGiver ${start.serverTaskGiver ?? 'not reported'}` : 'no mindcraft_start event from the driver');

        const gone = () => s.events().find(s.gone) ?? (!bot.alive() ? { type: 'exited', reason: `code ${bot.exitCode()}` } : null);
        await clock.sleep(p.settleS * MS);
        const said = () => chatLines(s.sinceMarker(), name).map((c) => c.text);
        const before = said().length;
        server.console(`tell ${name} !taskAdd("${UNTRUSTED_TASK}", "normal")`, p.consoleWaitS);
        const sentAt = clock.now();
        const refusals = REFUSALS(giver);
        const refusal = await ctx.waitFor(() => said().slice(before).find((t) => refusals.includes(t)) || (gone() && { gone: gone() }), p.acceptS * MS);
        const refusedText = typeof refusal === 'string' ? refusal : null;
        ctx.check('refused_politely', Boolean(refusedText),
            refusedText ? `the bot said "${refusedText}"` : refusal?.gone ? `the bot is gone: ${refusal.gone.type}` : `no refusal within ${p.acceptS}s`);

        const observeEnd = sentAt + p.observeS * MS;
        while (clock.now() < observeEnd && !gone()) await clock.sleep(Math.min(p.pollMs * 5, Math.max(MS, observeEnd - clock.now())));
        const after = said().slice(before);
        const taken = after.filter((t) => TASK_TAKEN(giver).test(t));
        ctx.note('chatAfterWhisper', after.slice(0, 20));
        ctx.check('no_task', taken.length === 0 && !gone(),
            taken.length ? `the task was taken: ${taken.slice(0, 3).join(' | ')}` : gone() ? `the bot is gone: ${gone().type}` : `no task line in ${p.observeS}s after the whisper`);

        const cheat = cheatProblems(s.sinceMarker(), name);
        ctx.note('packFirstJoin', cheat.packFirstJoin);
        ctx.check('no_cheat', cheat.problems.length === 0, cheat.problems.length ? cheat.problems.slice(0, 5).join('; ') : `nothing found (the pack's first-join commands: ${cheat.packFirstJoin.join(', ') || 'none'})`);
    },
};
