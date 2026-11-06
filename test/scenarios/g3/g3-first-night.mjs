// G3 (b), ready-to-try item 5: the REAL Mindcraft agent survives its first night, from a fresh spawn, with
// the time untouched. The plan: coord/STATUS-harness-ops.md, "Scenario g3-first-night" (lead, #101:
// survival is the night gate; shelter is evidence, recorded only).
//
// Driver: test/runner/drivers/mindcraft-driver.mjs with the pinned model (llm: true); gate-valid only under
// batch.mjs's spend stop (maxBatchUsd, USD 2, 'equal'). The runner whispers nothing and sets nothing about
// time: no `time set`, no gamerule (the guard would allow `time set day` from G2's list; this scenario
// never sends it, and its unit test checks that).
//
// The dawn bound (pinned by the lead after G3 smoke round 6; set after S1-A and confirmed by round 5's B rerun,
// dusk at minute 19.5, the night at 20.6, dawn at 40.1, with both Extended Days holds):
// `time query daytime` every pollMs. A night counts only if dusk was seen: a sample below nightFrom (13000),
// then one at or above it (the night), then dawn, the first sample below dawnBelow (12000) after that, i.e.
// the time has wrapped past 24000 (#203 review: a run that joins mid-night must wait for the next full night). S1-A measured
// a cycle of about 40 min with Extended Days (two freezes of about 10 min, at 3000 and 16000), so dawn is
// expected about 40 min after a fresh server's first join; maxMinutes is 55, compared 'equal'.
//
// Steps:
//   1. login_online (startSession; the G3 world, the G2 seed), then fresh_start as in (a): none of (a)'s target
//      items held (count-only clear) and the pack's first-join Bread and Bundle in this run's log. Each (b)
//      batch runs on its own fresh server (lead, #203 review).
//   2. Objectives g3b_deaths (stat.deaths), g3b_played (stat.playOneMinute) and g3b_food (the read-only `food`
//      criterion, approved for G3 as evidence only, lead #203; as in P1). The uncounted gap: 1.12
//      never backfills a new objective, so a death between the join and the add is not in the stat; the
//      log's death line still catches it (deathLines), so it fails safe.
//   3. Every pollMs (60 s): `time query daytime` and `scoreboard players list <bot>` (deaths). No tp of any
//      form (lead, #201 review): even `tp <bot> ~ ~ ~` is a teleport in 1.12. So there is no position, and
//      the plan's midnight shelter snapshot (testforblock around the bot; evidence, never gating) is not
//      taken: notes.shelterAtMidnight says why. Survival is the gate (lead, #101).
//   4. The run ends at dawn, at a death (stat or log line), when the bot leaves or its driver exits, or at
//      maxMinutes.
// Checks:
//   fresh_start     a fresh spawn: no target items, and the pack's first-join gives seen;
//   survived_night  dawn after a full night was reached, stat.deaths is 0 and no death line is in the log;
//   stayed_online   no leave, lost-connection or kick line for the bot from the join to the end;
//   no_cheat        cheatProblems (lib/g3.mjs), as in (a).
// Evidence, never gating: the bot's food level at the end (notes.foodAtEnd). 1.12 writes a `food` score only
// once the level changes after the objective exists (P1), so no score means "unchanged since the add", not 0.
import { startSession } from '../../runner/lib/session.mjs';
import { G2_WORLD_SEED } from '../../runner/lib/g2.mjs';
import { G3_DEFAULTS, G3_GATE_PARAMS, cheatProblems, deathLines, guardConsole } from '../../runner/lib/g3.mjs';
import { clearTestCommand, clearTestCount, playerScores, scoreboardAddResult, timeQuery } from '../../runner/lib/s1.mjs';
import { FIRST_JOIN_KIT, START_EMPTY, cobbleOutputs } from './g3-rocks-to-stone-tools.mjs';
import { chatLines } from '../../runner/lib/server-log.mjs';
import { lateConsole } from '../../runner/lib/late-console.mjs';

const MS = 1000;
export const G3B_STATS = Object.freeze([
    { obj: 'g3b_deaths', criteria: 'stat.deaths' },
    { obj: 'g3b_played', criteria: 'stat.playOneMinute' },
    { obj: 'g3b_food', criteria: 'food' },
]);
/**
 * The dawn rule over the daytime samples so far ([{min, daytime}], null daytimes skipped):
 * {dusk: the last sample below nightFrom before the night, night: the first sample >= nightFrom after a dusk
 * sample, dawn: the first sample < dawnBelow after the night}, each null until seen. Samples at or above
 * nightFrom before any dusk (a run that joined mid-night) never start a night (#203 review).
 */
export function dawnOf(samples, { nightFrom = 13000, dawnBelow = 12000 } = {}) {
    let dusk = null;
    let night = null;
    for (const s of samples) {
        if (!Number.isFinite(s.daytime)) continue;
        if (!night) {
            if (s.daytime < nightFrom) dusk = s;
            else if (dusk) night = s;
        } else if (s.daytime < dawnBelow) return { dusk, night, dawn: s };
    }
    return { dusk, night, dawn: null };
}

export default {
    id: 'g3-first-night',
    gate: 'G3',
    llm: true,
    title: 'From a fresh spawn the agent lives through its first full night (the time untouched; the server is the arbiter)',
    checks: {
        login_online: 'Starting the bot makes it log in with its own account (online mode)',
        fresh_start: 'It starts as a fresh spawn: none of the early-game items held, and the pack\'s first-join gives seen',
        survived_night: 'It reaches the first dawn after a full night with no death (stat.deaths 0, no death line)',
        stayed_online: 'It stays online from the join to dawn (no leave, lost connection or kick)',
        no_cheat: 'No give, game mode change, op or command by the bot during the run (the pack\'s first-join commands aside)',
    },
    defaults: {
        bot: 'FRCFLD',
        worldSeed: G2_WORLD_SEED,
        maxMinutes: 55,
        nightFrom: 13000,
        dawnBelow: 12000,
        ...G3_DEFAULTS,
        loginTimeoutMs: 240 * MS,
        pollMs: 60 * MS,
        logTail: 20000,
        consoleWaitS: 1,
        lateReplyMs: 5 * MS,
        latePollMs: 1 * MS,
    },
    gateParams: { maxMinutes: 'equal', nightFrom: 'equal', dawnBelow: 'equal', ...G3_GATE_PARAMS },
    // The most minutes a run can take from its start (batch.mjs derives its runner timeout from it, plus a margin):
    // the login wait, then maxMinutes from the join.
    runMinutes: (p) => p.loginTimeoutMs / (60 * MS) + p.maxMinutes,

    async run(ctx) {
        const { bot, clock, params: p } = ctx;
        const server = guardConsole(ctx.server);   // run.mjs guards too
        const name = p.bot;
        const s = await startSession(ctx, { name, checkNaming: false });   // say and seed only
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        const lc = lateConsole(server, clock, { waitS: p.consoleWaitS, lateMs: p.lateReplyMs, pollMs: p.latePollMs });
        const confirm = async (cmd, accept) => {
            const n = lc.late().length;
            const lines = await lc.confirm(cmd, accept);
            if (lc.late().length > n) ctx.note('lateReplies', lc.late());
            return lines;
        };
        for (const st of G3B_STATS) lc.con(`scoreboard objectives remove ${st.obj}`);
        const added = {};
        for (const st of G3B_STATS) {
            added[st.obj] = scoreboardAddResult(await confirm(`scoreboard objectives add ${st.obj} ${st.criteria}`,
                (l) => scoreboardAddResult(l, st.obj, st.criteria) !== null), st.obj, st.criteria);
        }
        ctx.note('objectives', G3B_STATS.map((st) => ({ ...st, result: added[st.obj] })));

        // fresh_start, as in (a) (#203 review)
        const startNames = [...START_EMPTY, ...new Set(cobbleOutputs().map((o) => o.name))];
        const start = {};
        for (const item of startNames) {
            start[item] = clearTestCount(await confirm(clearTestCommand(name, item), (l) => clearTestCount(l, name) !== null), name)?.count ?? null;
        }
        const held = Object.entries(start).filter(([, n]) => n !== 0);
        const kit = FIRST_JOIN_KIT.filter((id) => !cheatProblems(s.sinceMarker(), name).packFirstJoin.includes(id));
        ctx.note('startCounts', start);
        ctx.check('fresh_start', held.length === 0 && kit.length === 0,
            [held.length ? `held at the start: ${held.map(([i, n]) => `${i} ${n ?? 'no reply'}`).join(', ')}` : `none of ${startNames.length} target items held`,
                kit.length ? `not a first join: the pack's ${kit.join(' and ')} not in this run's log` : 'the pack\'s first-join Bread and Bundle seen'].join('; '));

        const joinedAt = s.joinedAt;
        const minutes = () => Math.round(((clock.now() - joinedAt) / (60 * MS)) * 10) / 10;
        const samples = [];
        let deaths = null;
        let end = null;
        let dn = { dusk: null, night: null, dawn: null };
        while (!end) {
            const daytime = timeQuery(await confirm('time query daytime', (l) => timeQuery(l) !== null));
            const sc = playerScores(await confirm(`scoreboard players list ${name}`, (l) => playerScores(l, name) !== null), name);
            if (sc) deaths = sc.g3b_deaths ?? 0;   // no score yet is 0 (S1-A)
            const food = sc ? sc.g3b_food ?? null : null;   // no food score: unchanged since the add (not 0)
            samples.push({ min: minutes(), daytime, deaths, food });
            ctx.note('samples', samples);
            dn = dawnOf(samples, p);
            const died = deathLines(s.sinceMarker(), name);
            const gone = s.events().find(s.gone);
            if (dn.dawn) end = `dawn: daytime ${dn.dawn.daytime} at minute ${dn.dawn.min}, after dusk at minute ${dn.dusk.min} (${dn.dusk.daytime}) and the night at minute ${dn.night.min} (${dn.night.daytime})`;
            else if (deaths >= 1 || died.length) end = `the bot died: ${died[0]?.msg ?? `stat.deaths ${deaths}`}`;
            else if (gone) end = `the bot is gone: ${gone.type}${gone.reason ? ` (${gone.reason})` : ''}`;
            else if (!bot.alive()) end = `the driver exited with code ${bot.exitCode()}`;
            else if (clock.now() - joinedAt >= p.maxMinutes * 60 * MS) end = `maxMinutes (${p.maxMinutes}) reached before dawn`;
            else await clock.sleep(Math.min(p.pollMs, Math.max(MS, joinedAt + p.maxMinutes * 60 * MS - clock.now())));
        }
        ctx.note('end', { reason: end, minutes: minutes() });
        ctx.note('night', dn);
        const lastFood = samples.at(-1)?.food;
        ctx.note('foodAtEnd', { food: lastFood ?? null, objective: added.g3b_food ?? null, gating: false,
            why: lastFood == null ? (added.g3b_food === 'added' ? 'no food score: the level has not changed since the objective was added (1.12)' : 'the food objective was not added') : 'the last food score before the end' });
        const log = s.sinceMarker();
        const died = deathLines(log, name);
        ctx.note('deathLines', died);
        ctx.note('agendaChat', chatLines(log, name).map((c) => c.text).filter((t) => /^(agenda|task) /.test(t)));
        ctx.note('shelterAtMidnight', { taken: false, why: 'no tp in G3 (lead, #201 review), so no position to test around; survival is the gate' });
        for (const st of G3B_STATS) lc.con(`scoreboard objectives remove ${st.obj}`);

        const statOk = added.g3b_deaths === 'added' && deaths === 0;
        ctx.check('survived_night', Boolean(dn.dawn) && statOk && died.length === 0,
            `${dn.dawn ? 'dawn reached' : `no dawn (${end})`}; stat.deaths ${added.g3b_deaths === 'added' ? deaths ?? 'no reply' : `objective ${added.g3b_deaths ?? 'no reply'}`}; death lines ${died.length}${died.length ? `: ${died[0].msg}` : ''}`);
        const left = s.events().filter((e) => s.gone(e));
        ctx.check('stayed_online', left.length === 0 && bot.alive(),
            left.length ? left.map((e) => `${e.type}${e.reason ? ` (${e.reason})` : ''}`).join('; ') : bot.alive() ? `online from the join to the end (${minutes()} min)` : `the driver exited with code ${bot.exitCode()}`);
        const cheat = cheatProblems(log, name);
        ctx.note('packFirstJoin', cheat.packFirstJoin);
        ctx.note('packRepeats', cheat.packRepeats);
        ctx.check('no_cheat', cheat.problems.length === 0, cheat.problems.length ? cheat.problems.slice(0, 5).join('; ') : `nothing found (the pack's first-join commands: ${cheat.packFirstJoin.join(', ') || 'none'})`);
    },
};
