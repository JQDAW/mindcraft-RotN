// S1 (b) and (d), a smoke run before G3 (coord/STATUS-harness-ops.md, "G3 batches"): do the vanilla
// 1.12 commands that G3's server-side arbiters rely on answer on the real RotN server in the form the
// runner parses, and which statistics exist for the items G3 checks? Also: does a console `tell` reach
// mineflayer's 'whisper' event (which Mindcraft's agent listens to), and as which sender?
//
// Steps (console commands approved for S1 on #101: scoreboard, clear in test mode, time query, give)
//   1. login_online, as in G2.
//   2. stat_criteria: `scoreboard objectives add` for each criterion in S1_CRITERIA. Every reply must be a
//      known form, and every vanilla criterion must be 'added'. Which RotN criteria exist is the finding
//      that decides whether G3's crafted_by_bot gates for them. Then `scoreboard players list <bot>`
//      (recorded), and the objectives are removed again.
//   3. clear_test: `give <bot> minecraft:stone_pickaxe 1 0`, then the count-only `clear ... 0` must report
//      1 for it and 0 for an item the bot does not have (minecraft:diamond and the RotN pyrotech:crude_axe).
//      A second count still reports 1: the test mode removes nothing.
//   4. time_query: `time query daytime` answers with a number.
//   5. whisper_seen: `tell <bot> s1-whisper-<token>` reaches the driver's 'whisper' handler (DRIVER
//      whisper event with the token); notes.whisper records the sender name the bot saw.
import crypto from 'node:crypto';
import { startSession } from '../../runner/lib/session.mjs';
import { S1_CRITERIA, S1_NOT_GATE, clearTestCommand, clearTestCount, playerScores, scoreboardAddResult, timeQuery } from '../../runner/lib/s1.mjs';

const MS = 1000;

/** The DRIVER whisper event with this token in the driver's output, or null. */
export function whisperEvent(output, token) {
    for (const l of output) {
        if (!l.startsWith('DRIVER ')) continue;
        try {
            const e = JSON.parse(l.slice(7));
            if (e?.type === 'whisper' && e.token === token) return e;
        } catch { /* not an event */ }
    }
    return null;
}

export default {
    id: 's1-arbiters',
    gate: 'S1',
    title: 'The replies G3\'s arbiters parse (scoreboard stats, clear in test mode, time query) and the console whisper sender (a smoke run, not a gate)',
    checks: {
        login_online: 'The bot logs in with its own account (online mode)',
        stat_criteria: 'Every scoreboard reply has a known form, and the vanilla stat criteria exist',
        clear_test: '`clear <bot> <item> <meta> 0` counts without removing, in the form the runner parses',
        time_query: '`time query daytime` answers with the day time',
        whisper_seen: 'A console `tell` reaches the bot\'s whisper handler',
    },
    defaults: {
        bot: 'FRCFLD',
        dataRoot: '',
        loginTimeoutMs: 240 * MS,
        settleMs: 10 * MS,
        whisperTimeoutMs: 30 * MS,
        pollMs: 1 * MS,
        logTail: 20000,
        consoleWaitS: 1,
    },
    gateParams: {},

    async run(ctx) {
        const { server, bot, clock, params: p } = ctx;
        ctx.notGate(S1_NOT_GATE);
        const name = p.bot;
        const s = await startSession(ctx, { name });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        await clock.sleep(p.settleMs);

        // 2. stat criteria. Any s1_* objective left by an earlier run is removed first, so 'exists' never
        //    hides whether a criterion is valid (#106 review finding 4); the reply to a missing one is fine.
        for (const c of S1_CRITERIA) server.console(`scoreboard objectives remove ${c.obj}`, p.consoleWaitS);
        const criteria = [];
        for (const c of S1_CRITERIA) {
            const lines = server.console(`scoreboard objectives add ${c.obj} ${c.criteria}`, p.consoleWaitS);
            criteria.push({ ...c, result: scoreboardAddResult(lines, c.obj, c.criteria), reply: lines.slice(-2) });
        }
        const scoresLines = server.console(`scoreboard players list ${name}`, p.consoleWaitS);
        ctx.note('statCriteria', criteria.map(({ obj, criteria: cr, vanilla, result }) => ({ obj, criteria: cr, vanilla, result })));
        ctx.note('scores', playerScores(scoresLines, name));
        for (const c of criteria.filter((x) => x.result === 'added')) server.console(`scoreboard objectives remove ${c.obj}`, p.consoleWaitS);
        // 'exists' cannot happen after the removal above; treat it like an unknown reply.
        const unknownReply = criteria.filter((c) => c.result === null || c.result === 'exists');
        const vanillaMissing = criteria.filter((c) => c.vanilla && c.result !== 'added');
        ctx.check('stat_criteria', unknownReply.length === 0 && vanillaMissing.length === 0,
            criteria.map((c) => `${c.criteria}: ${c.result ?? 'no known reply'}`).join('; '));

        // 3. clear in test mode
        const given = server.console(`give ${name} minecraft:stone_pickaxe 1 0`, p.consoleWaitS);
        const counts = {};
        for (const [item, meta] of [['minecraft:stone_pickaxe', -1], ['minecraft:diamond', -1], ['pyrotech:crude_axe', -1], ['minecraft:stone_pickaxe', -1]]) {
            const lines = server.console(clearTestCommand(name, item, meta), p.consoleWaitS);
            const r = clearTestCount(lines, name);
            (counts[item] ??= []).push(r ? r.count : null);
            if (!r) ctx.note(`clearReply:${item}`, lines.slice(-3));
        }
        ctx.note('clearTest', { give: given.slice(-1), counts });
        const okClear = counts['minecraft:stone_pickaxe'].every((n) => n === 1) && counts['minecraft:diamond'][0] === 0 && counts['pyrotech:crude_axe'][0] === 0;
        ctx.check('clear_test', okClear, `stone_pickaxe ${counts['minecraft:stone_pickaxe'].join(' then ')} (want 1 then 1), diamond ${counts['minecraft:diamond'][0]} (want 0), pyrotech:crude_axe ${counts['pyrotech:crude_axe'][0]} (want 0)`);

        // 4. time query
        const tq = timeQuery(server.console('time query daytime', p.consoleWaitS));
        ctx.note('daytime', tq);
        ctx.check('time_query', tq !== null, tq === null ? 'no "Time is N" reply' : `daytime ${tq}`);

        // 5. the console whisper
        const token = crypto.randomBytes(6).toString('hex');
        server.console(`tell ${name} s1-whisper-${token}`, p.consoleWaitS);
        const ev = await ctx.waitFor(() => whisperEvent(bot.output(), token), p.whisperTimeoutMs);
        ctx.note('whisper', ev ? { username: ev.username } : null);
        ctx.check('whisper_seen', Boolean(ev), ev ? `whisper handler saw sender "${ev.username}"` : `no whisper event within ${p.whisperTimeoutMs / MS}s`);
    },
};
