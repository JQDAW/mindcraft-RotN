// G4 #6, ready-to-try: "After death it respawns, reports what it lost and carries on without a chat-spam loop."
// test/scenarios/g4/PLAN.md (#316). On a test server this is a REHEARSAL, never G4 evidence: g3Policy marks every
// G4 run not-gate (G4_TEST_SERVER_NOT_GATE), and batch.mjs refuses --gate with it. G4 evidence comes only from
// the CX23 service (set-up S), with its own forced kill (PLAN.md step 7).
//
// The stimulus (lead decision, 2026-11-07): the console's `kill <bot>`, on the disposable test server only, never
// on the live server and never to fake a pass (the same rule as the P1 setup commands). It is allowed for this
// scenario alone (SCENARIO_CONSOLE_EXTRA in lib/g3.mjs), with a plain name, never a selector.
//
// What the bot does (skills-rotn's src/agent/library/death_report.js, D3; this scenario changes nothing there):
// it samples its inventory once a second while alive, respawns (asking again after 9 s), waits 3 s, and says ONE
// line: "I died at x, y, z (<cause>); lost <N key, ...>[; XP level a -> b]." with at most one such line a minute.
// RotN keeps the main hand, off hand, armor and baubles; the rest drops (Corpse Complex).
//
// Steps (the G2 world on a fresh server; production task givers, so the console sender can give no task):
//   1. login_online, fresh_bot_state. Objectives: stat.deaths (g4d_d), health (g4d_h, read-only, shows the
//      respawn) and the agenda counter (g3-task-preempts-agenda.mjs's AGENDA_COUNTER, g4d_a<n>).
//   2. After warmMinutes, the server counts what the bot holds of lossItems (count-only `clear <bot> <item> -1 0`,
//      never a real clear), every heldPollS until the total reaches minHeld, at most maxWaitHeldMin. had_items.
//      Then one more count of every item (the pre-kill sweep). One console call per item takes about a second,
//      so a sweep spans about 15 s while the bot may craft (T1, 2026-11-07: planks counted 3 in the same second
//      the bot crafted to 6). Each item's "before" is the RANGE of its last two counts, not one stale reading.
//   3. `kill <bot>` right after the pre-kill sweep. The server's own times (the reply lines' hh:mm:ss) date the
//      kill, the respawn and the chat, so the runner's clock and the server's are never mixed.
//   4. Every pollMs: `scoreboard players list <bot>`. died: g4d_d rose and the log has the bot's death line.
//      respawned: g4d_h read 0 after the kill and then above 0 (or, if the 0 fell between two polls, above 0 once
//      the death is confirmed and a second reading agrees), within respawnS of the kill. The respawn is dated by
//      the FIRST reading above 0 (after any 0), not the reading that confirms it (T1: 14:03:35, not 14:03:40).
//   5. afterRespawnS later, the same counts again: the server's loss per item is the range before - after.
//   6. The agenda counter, then every counterPollMs until both spamWindowMin after the kill and resumeMinutes
//      after the respawn have passed; the bot must stay online.
// Checks:
//   had_items      the bot held at least minHeld of lossItems before the kill (else the rest is "not reached");
//   died           the server shows the death (stat.deaths rose, and the death line);
//   respawned      the respawn within respawnS (30) of the kill, by the server's clock;
//   loss_reported  exactly one death report line from the bot from the kill to reportS (60) after the respawn (the
//                  report may come before the respawn reading: T1's came 1 s before the confirming one), and none
//                  more after the kill; its losses consistent with the server's (lossConsistency);
//   no_spam        no chat-spam LOOP in the spamWindowMin (5) minutes after the kill (lead decision after T1: the
//                  ready-to-try item says "without a chat-spam loop"; the agent's normal narration ran 13-24 lines
//                  a minute in T1, so a plain rate is no loop test):
//                    - no line repeated: at most maxRepeatPerMin (4) of the same line in any 60 s, and at most
//                      maxRepeatInWindow (7) in the window. "The same" means an EQUAL chatLoopKey (case, numbers
//                      and punctuation ignored): lines that differ only there count together; there is no fuzzy
//                      match, so lines that differ in any word count apart. Calibration (the committed G3 evidence,
//                      rounds 2-9; any 60 s and any 5 min): ordinary narration and agenda lines repeat at most 5
//                      times in 5 min and 2 in a minute ("Picking up item!", "agenda step sticks started").
//                      Reflex lines do repeat: "I'm dying!" 12 in 5 min (4 in 60 s) and "Fighting
//                      zombie_players:zombie_player!" 9 in 5 min (g3a-20261105-r2); "My brain disconnected, try
//                      again." 9 in 5 min, 6 in 60 s (g3b-20261106-r3). All three fail at 4 and 7, as intended:
//                      skills-rotn will rate-limit repeated reflex chat lines (lead, #342 review);
//                    - at most one death report line;
//                    - no spam kick, and the bot online throughout;
//                    - a backstop only: at most maxChatPerMin (40) lines in any 60 s.
//   agenda_resumed the agenda counter rose within resumeMinutes (5) after the respawn;
//   no_cheat       cheatProblems (the console's kill is not a command the bot ran).
import { startSession } from '../../runner/lib/session.mjs';
import { G2_WORLD_SEED } from '../../runner/lib/g2.mjs';
import { G3_DEFAULTS, G3_GATE_PARAMS, cheatProblems, deathLines, startEvent } from '../../runner/lib/g3.mjs';
import { chatLines, parseLine } from '../../runner/lib/server-log.mjs';
import { clearTestCommand, clearTestCount, playerScores, scoreboardAddResult } from '../../runner/lib/s1.mjs';
import { lateConsole } from '../../runner/lib/late-console.mjs';
import { PRODUCTION_GIVERS_ENV } from '../../runner/drivers/mindcraft-driver.mjs';
import { AGENDA_COUNTER } from '../g3/g3-task-preempts-agenda.mjs';

const MS = 1000;
const MIN = 60 * MS;

/**
 * What the server counts before the kill and after the respawn: the early agenda's items, from the death
 * reports in the G3 smoke evidence (rounds 3-8) and the pack's first-join kit. Base ids (any data value).
 */
export const LOSS_ITEMS = [
    'pyrotech:rock', 'pyrotech_compat:rock_igneous', 'pyrotech_compat:rock_metamorphic', 'pyrotech_compat:rock_sedimentary',
    'minecraft:stick', 'minecraft:log', 'minecraft:log2', 'minecraft:planks', 'betterwithmods:dirt_pile', 'dynamictrees:oakseed',
    'undergroundbiomes:igneous_cobble', 'undergroundbiomes:metamorphic_cobble', 'minecraft:cobblestone', 'minecraft:bread', 'bundles:bundle',
].join(',');

/** death_report.js's chat line: "I died at x, y, z[ (cause)]; lost <items>[; XP level a -> b]." */
const REPORT = /^I died at (-?\d+), (-?\d+), (-?\d+)(?: \((.*)\))?; lost (.+?)(?:; XP level (\d+) -> (\d+))?\.$/;

/** The server item id a report key names: "log:1" -> minecraft:log, "pyrotech_compat:rock_metamorphic:6" -> pyrotech_compat:rock_metamorphic. */
export function reportBaseId(key) {
    const k = String(key).replace(/:\d+$/, '');
    return k.includes(':') ? k : `minecraft:${k}`;
}

/**
 * A death report chat line, or null if the text is not one: {at: [x, y, z], cause, items: {baseId: count},
 * named: [{key, count}], moreKinds, nothing, xp: [before, after] | null}.
 */
export function parseDeathReport(text) {
    const m = REPORT.exec(String(text));
    if (!m) return null;
    let list = m[5];
    let moreKinds = 0;
    const more = / and (\d+) more kinds$/.exec(list);
    if (more) { moreKinds = Number(more[1]); list = list.slice(0, more.index); }
    const nothing = list === 'nothing';
    const named = [];
    if (!nothing) {
        for (const part of list.split(', ')) {
            const e = /^(\d+) (\S+)$/.exec(part);
            if (!e) return null;   // not death_report.js's format: never guessed
            named.push({ key: e[2], count: Number(e[1]) });
        }
    }
    const items = {};
    for (const n of named) items[reportBaseId(n.key)] = (items[reportBaseId(n.key)] ?? 0) + n.count;
    return { at: [Number(m[1]), Number(m[2]), Number(m[3])], cause: m[4] ?? null, items, named, moreKinds, nothing, xp: m[6] ? [Number(m[6]), Number(m[7])] : null };
}

/**
 * Is the report consistent with what the server counted? serverLoss: {id: n | [lo, hi]} for every counted item,
 * the server's loss as a number or as the range the pre-kill counts span (the bot may craft during a sweep).
 * The report's loss of an item is the sum of its named variants (parseDeathReport), R. Per item, the tolerance is
 * tol = max(tolAbs, ceil(tolRel * max(hi, R))).
 * - Over-reporting: R - tol <= hi for every item.
 * - Under-reporting: what the server counted beyond the named part, sum over items of max(0, lo - R - tol), must fit
 *   in what "and K more kinds" can hold: K kinds of at most m each (m: the smallest named count; death_report.js
 *   names the largest six first), ONE budget of K * m shared by all items (#342 review: never K * m per item). T1:
 *   "3 rock_metamorphic:6" named, 7 of all variants counted, the rest among the 10 more kinds.
 * - Each item the server surely lost (lo > 0) but the report does not name at all needs one of the K kinds, so
 *   there are at most K such items; with no "more kinds" (K = 0) there are none: every sure loss must be named.
 * - "lost nothing" fails if the server's count allows any loss (some hi > 0): the same bound the scenario uses for
 *   "not reached" (nothing lost: every hi <= 0), so the two never disagree (#342 review).
 * Items the report names that the server did not count (not in lossItems) are not judged. Returns {ok, problems}.
 */
export function lossConsistency(serverLoss, report, { tolAbs = 2, tolRel = 0.25 } = {}) {
    const problems = [];
    const range = (v) => { const [a, b] = Array.isArray(v) ? v : [v, v]; return [Math.max(0, Math.min(a, b)), Math.max(0, a, b)]; };
    const show = ([lo, hi]) => (lo === hi ? `${lo}` : `${lo}-${hi}`);
    const most = lossUpperBound(serverLoss);
    if (report.nothing) {
        if (most > 0) problems.push(`the report says "lost nothing", but the server's count allows up to ${most} lost`);
        return { ok: problems.length === 0, problems };
    }
    const K = report.moreKinds;
    const m = report.named.length ? Math.min(...report.named.map((n) => n.count)) : 0;
    const budget = K * m;
    const beyond = [];
    const unnamed = [];
    for (const [id, v] of Object.entries(serverLoss)) {
        const [lo, hi] = range(v);
        const R = report.items[id] ?? 0;
        const tol = Math.max(tolAbs, Math.ceil(tolRel * Math.max(hi, R)));
        if (R - tol > hi) problems.push(`${id}: the report says ${R} lost, the server counts ${show([lo, hi])} (tolerance ${tol})`);
        if (R === 0 && lo > 0) unnamed.push(`${show([lo, hi])} ${id}`);
        const over = lo - R - tol;
        if (over > 0) beyond.push({ id, over, text: `${id} ${show([lo, hi])} counted, ${R} named (tolerance ${tol})` });
    }
    if (unnamed.length > K) {
        problems.push(K ? `the server counts ${unnamed.length} items lost that the report does not name (${unnamed.join(', ')}), more than its ${K} more kinds`
            : unnamed.map((u) => `the server counts ${u} lost; the report does not name it`).join('; '));
    }
    const sumOver = beyond.reduce((a, b) => a + b.over, 0);
    if (sumOver > budget) problems.push(`the server counts ${sumOver} more than the report names, beyond the tolerance (${beyond.map((b) => b.text).join('; ')}); its ${K} more kinds hold at most ${budget}`);
    return { ok: problems.length === 0, problems };
}

/** The most the server's count allows to be lost in all: the sum of every item's upper bound (hi), never below 0. */
export const lossUpperBound = (serverLoss) => Object.values(serverLoss).reduce((a, v) => a + Math.max(0, ...[v].flat()), 0);

/**
 * The key two chat lines share when they are "the same line" for the loop test: lower case, every number one
 * '#', punctuation dropped, spaces collapsed. "Got 5 rocks!" and "got 7 rocks" share a key. The loop test groups
 * lines by EQUAL keys only (no fuzzy or edit-distance match): "Got 5 rocks!" and "Got 5 more rocks" count apart.
 */
export const chatLoopKey = (text) => String(text).toLowerCase().replace(/-?\d+(?:\.\d+)?/g, '#').replace(/[^\p{L}#\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * Chat lines [{t: seconds since a common start, text}] grouped by chatLoopKey: [{key, text, in60, total}] (in60:
 * the most of that line in any 60 s; total: all of it; text: its first wording), most repeated first.
 */
export function repeatedLines(lines) {
    const by = new Map();
    for (const l of lines) {
        const k = chatLoopKey(l.text);
        if (!by.has(k)) by.set(k, { key: k, text: l.text, times: [] });
        by.get(k).times.push(l.t);
    }
    return [...by.values()].map((e) => ({ key: e.key, text: e.text, in60: maxPerMinute(e.times), total: e.times.length }))
        .sort((a, b) => b.in60 - a.in60 || b.total - a.total);
}

/** "hh:mm:ss" -> seconds of the day. */
export const secondsOf = (hms) => { const [h, m, s] = String(hms).split(':').map(Number); return h * 3600 + m * 60 + s; };
/** Seconds from `from` to `to` ("hh:mm:ss" each), across midnight at most once. */
export const secondsBetween = (from, to) => (secondsOf(to) - secondsOf(from) + 86400) % 86400;

/** The most chat lines in any 60 s: times are seconds since a common start. */
export function maxPerMinute(times) {
    const t = [...times].sort((a, b) => a - b);
    let best = 0;
    for (let i = 0, j = 0; j < t.length; j++) {
        while (t[j] - t[i] >= 60) i++;
        best = Math.max(best, j - i + 1);
    }
    return best;
}

/** The last server time ("hh:mm:ss") among console reply lines, or null. */
const replyTime = (lines) => { for (const l of [...lines].reverse()) { const p = parseLine(String(l)); if (p) return p.time; } return null; };

export default {
    id: 'g4-death-report',
    gate: 'G4',
    llm: true,
    title: 'After a forced death the bot respawns, reports what it lost (as the server counted it) and carries on without a chat-spam loop',
    checks: {
        login_online: 'Starting the bot makes it log in with its own account (online mode)',
        fresh_bot_state: 'The bot starts with no task queue or agenda state from an earlier run',
        had_items: 'Before the death the bot holds items it can lose (the server counts them)',
        died: 'The server shows the death (stat.deaths and the death message)',
        respawned: 'After death it respawns (within 30 s, by the server)',
        loss_reported: 'It reports what it lost, once, consistent with what the server counted',
        no_spam: 'It carries on without a chat-spam loop (for 5 min: no repeated line, one death report, no spam kick)',
        agenda_resumed: 'It carries on: its agenda counter rises again after the respawn',
        no_cheat: 'No give, game mode change, op or command by the bot during the run (the pack\'s first-join commands aside)',
    },
    defaults: {
        bot: 'FRCFLD',
        worldSeed: G2_WORLD_SEED,
        lossItems: LOSS_ITEMS,
        agendaCounter: AGENDA_COUNTER,
        warmMinutes: 3,
        minHeld: 6,
        heldPollS: 60,
        maxWaitHeldMin: 8,
        respawnS: 30,
        afterRespawnS: 5,
        reportS: 60,
        spamWindowMin: 5,
        maxRepeatPerMin: 4,
        maxRepeatInWindow: 7,
        maxChatPerMin: 40,
        resumeMinutes: 5,
        lossTolAbs: 2,
        lossTolRel: 0.25,
        ...G3_DEFAULTS,
        loginTimeoutMs: 240 * MS,
        counterPollMs: 60 * MS,
        pollMs: 2 * MS,
        logTail: 20000,
        consoleWaitS: 1,
        lateReplyMs: 5 * MS,
        latePollMs: 1 * MS,
    },
    gateParams: {
        lossItems: 'equal', agendaCounter: 'equal', minHeld: 'equal', respawnS: 'equal', reportS: 'equal', spamWindowMin: 'equal',
        maxChatPerMin: 'equal', maxRepeatPerMin: 'equal', maxRepeatInWindow: 'equal', resumeMinutes: 'equal', lossTolAbs: 'equal', lossTolRel: 'equal', ...G3_GATE_PARAMS,
    },
    // The most minutes a run can take: the login wait, warmMinutes plus the wait for items (each count round is
    // one count-only clear per item, each up to a late reply), the pre-kill sweep, the respawn wait, and the longer
    // of the spam window and the resume window (with one more count round and the counter reads).
    runMinutes: (p) => {
        const perCall = (p.consoleWaitS + p.lateReplyMs / MS) / 60;
        const items = String(p.lossItems).split(',').length;
        const rounds = Math.ceil((p.maxWaitHeldMin * 60) / p.heldPollS) + 3;
        return p.loginTimeoutMs / MIN + p.warmMinutes + p.maxWaitHeldMin + rounds * items * perCall
            + (p.respawnS + 15 + p.afterRespawnS) / 60 + Math.max(p.spamWindowMin, p.resumeMinutes + p.respawnS / 60) + 2;
    },

    async run(ctx) {
        const { bot, clock, params: p } = ctx;
        const server = ctx.server;   // run.mjs guards it with consoleAllowFor(this scenario)
        const name = p.bot;
        const items = String(p.lossItems).split(',').map((x) => x.trim()).filter(Boolean);
        const s = await startSession(ctx, { name, checkNaming: false, env: { [PRODUCTION_GIVERS_ENV]: '1' } });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        const start = startEvent(typeof bot.output === 'function' ? bot.output() : []);
        ctx.check('fresh_bot_state', start?.botState?.fresh === true,
            start?.botState ? `the driver moved aside: ${start.botState.movedAside.join(', ') || 'nothing (none there)'}` : 'no botState in the driver\'s start event');
        const lc = lateConsole(server, clock, { waitS: p.consoleWaitS, lateMs: p.lateReplyMs, pollMs: p.latePollMs });
        const confirm = lc.confirm;
        const gone = () => s.events().find(s.gone) ?? (!bot.alive() ? { type: 'exited', reason: `code ${bot.exitCode()}` } : null);
        const goneText = (g) => `the bot is gone: ${g.type}${g.reason ? ` (${g.reason})` : ''}`;

        // 1. objectives: deaths, health (read-only) and the agenda counter
        const counter = String(p.agendaCounter).split(',').map((c) => c.trim()).filter(Boolean).map((criteria, i) => ({ obj: `g4d_a${i}`, criteria }));
        const objs = [{ obj: 'g4d_d', criteria: 'stat.deaths' }, { obj: 'g4d_h', criteria: 'health' }, ...counter];
        for (const o of objs) lc.con(`scoreboard objectives remove ${o.obj}`);
        for (const o of objs) o.result = scoreboardAddResult(await confirm(`scoreboard objectives add ${o.obj} ${o.criteria}`, (l) => scoreboardAddResult(l, o.obj, o.criteria) !== null), o.obj, o.criteria);
        ctx.note('objectives', objs);
        const scores = async () => {
            const lines = await confirm(`scoreboard players list ${name}`, (l) => playerScores(l, name) !== null);
            return { sc: playerScores(lines, name), time: replyTime(lines) };
        };
        const counted = counter.filter((o) => o.result === 'added');
        const counterValue = (sc) => (sc ? counted.reduce((n, o) => n + (sc[o.obj] ?? 0), 0) : null);
        const count = async (item) => clearTestCount(await confirm(clearTestCommand(name, item, -1), (l) => clearTestCount(l, name) !== null), name)?.count ?? null;
        const countAll = async () => { const out = {}; for (const it of items) out[it] = await count(it); return out; };
        const sum = (c) => Object.values(c).reduce((a, b) => a + (b ?? 0), 0);
        const finish = () => {
            for (const o of objs) lc.con(`scoreboard objectives remove ${o.obj}`);
            const cheat = cheatProblems(s.sinceMarker(), name);
            ctx.note('packFirstJoin', cheat.packFirstJoin);
            ctx.note('packRepeats', cheat.packRepeats);
            ctx.check('no_cheat', cheat.problems.length === 0, cheat.problems.length ? cheat.problems.slice(0, 5).join('; ') : `nothing found (the pack's first-join commands: ${cheat.packFirstJoin.join(', ') || 'none'})`);
        };
        const after = ['died', 'respawned', 'loss_reported', 'no_spam', 'agenda_resumed'];
        const notReached = (why, from = 'had_items') => {
            for (const k of ['had_items', ...after].slice(['had_items', ...after].indexOf(from))) ctx.check(k, false, `not reached: ${why}`);
            finish();
        };
        if (objs.slice(0, 2).some((o) => o.result !== 'added')) return notReached(`the deaths or health objective was not added (${objs.slice(0, 2).map((o) => `${o.criteria}: ${o.result ?? 'no reply'}`).join(', ')})`);

        // 2. warm-up, then what the bot holds
        await clock.sleep(p.warmMinutes * MIN);
        if (gone()) return notReached(goneText(gone()));
        const heldDeadline = clock.now() + p.maxWaitHeldMin * MIN;
        let before = await countAll();
        const rounds = [{ min: Math.round(((clock.now() - s.joinedAt) / MIN) * 10) / 10, total: sum(before) }];
        while (sum(before) < p.minHeld && clock.now() < heldDeadline && !gone()) {
            await clock.sleep(p.heldPollS * MS);
            before = await countAll();
            rounds.push({ min: Math.round(((clock.now() - s.joinedAt) / MIN) * 10) / 10, total: sum(before) });
        }
        ctx.note('heldRounds', rounds);
        ctx.note('heldBefore', before);
        if (gone()) return notReached(goneText(gone()));
        const unread = items.filter((it) => before[it] === null);
        ctx.check('had_items', sum(before) >= p.minHeld && unread.length === 0,
            unread.length ? `no count from the server for ${unread.join(', ')}` : `the server counts ${sum(before)} of the loss items (at least ${p.minHeld} needed): ${Object.entries(before).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')}`);
        if (sum(before) < p.minHeld || unread.length) return notReached(`the bot held ${sum(before)} of the loss items after ${p.maxWaitHeldMin} min`, 'died');

        // 3. the forced death (the test server's console; this scenario's stimulus only). Never without our own driver's
        // start event: the driver refuses a profile whose name is not this run's bot (checkProfile), so a wrong `bot`
        // parameter (for example a human's name) starts no agent, and nothing is killed (#320 review).
        if (!start) return notReached('the driver reported no mindcraft_start event: no agent of this run to kill', 'died');
        // The pre-kill sweep: every item once more, then the kill at once. Each item's "before" is the range of
        // this count and the one before it (lossConsistency), so a craft during the counts is no false mismatch.
        const preKill = await countAll();
        ctx.note('heldPreKill', preKill);
        if (gone()) return notReached(goneText(gone()), 'died');
        const beforeRange = Object.fromEntries(items.map((it) => [it, preKill[it] === null ? [before[it], before[it]] : [Math.min(before[it], preKill[it]), Math.max(before[it], preKill[it])]]));
        const changed = items.filter((it) => beforeRange[it][0] !== beforeRange[it][1]);
        ctx.note('heldChangedDuringCounts', changed.map((it) => `${it} ${before[it]} -> ${preKill[it]}`));
        const first = await scores();
        const deathsBefore = first.sc?.g4d_d ?? 0;
        const chatBefore = chatLines(s.sinceMarker(), name).length;
        const killLines = await confirm(`kill ${name}`, (l) => l.some((x) => parseLine(String(x))?.msg === `Killed ${name}`));
        const killAt = clock.now();
        const killTime = killLines.map((x) => parseLine(String(x))).find((x) => x?.msg === `Killed ${name}`)?.time ?? replyTime(killLines);
        ctx.note('kill', { time: killTime, reply: killLines.map((x) => parseLine(String(x))?.msg).filter(Boolean).slice(-3) });
        if (!killTime) return notReached('the kill got no reply from the server (no server time to measure from)', 'died');

        // 4. the death and the respawn, by the server's scores
        const healthSeen = [];
        let deathAt = null;
        let respawnTime = null;
        let respawnAt = null;
        let sawZero = false;
        let firstAbove = null;   // the first reading above 0 after the confirmed death (and after any 0)
        while (clock.now() - killAt <= (p.respawnS + 15) * MS && respawnTime === null && !gone()) {
            const r = await scores();
            const h = r.sc?.g4d_h ?? null;
            const d = r.sc?.g4d_d ?? null;
            healthSeen.push({ time: r.time, health: h, deaths: d });
            if (d !== null && d > deathsBefore && deathAt === null) deathAt = r.time;
            if (h !== null && h <= 0) { sawZero = true; firstAbove = null; }
            if (deathAt !== null && h !== null && h > 0 && firstAbove === null) firstAbove = { time: r.time, at: clock.now(), index: healthSeen.length };
            // Confirmed by a 0 before it, or by a second reading above 0 after it. The respawn is dated by the FIRST
            // reading above 0 (the respawn happened at or before it; respawned's seconds are an upper bound), never
            // by the confirming one (T1, 2026-11-07: 14:03:35, not 14:03:40, 2 s after the kill, not 7).
            if (firstAbove && (sawZero || healthSeen.length > firstAbove.index)) { respawnTime = firstAbove.time; respawnAt = firstAbove.at; break; }
            await clock.sleep(p.pollMs);
        }
        ctx.note('healthAfterKill', healthSeen.slice(0, 30));
        const deathMsgs = deathLines(s.sinceMarker(), name).filter((x) => killTime && secondsBetween(killTime, x.time) < 3600);
        ctx.note('deathLines', deathMsgs);
        ctx.check('died', deathAt !== null && deathMsgs.length > 0,
            deathAt === null ? `stat.deaths did not rise after the kill (${healthSeen.length} readings)` : !deathMsgs.length ? 'stat.deaths rose, but the log has no death line for the bot'
                : `stat.deaths ${deathsBefore} -> more; "${deathMsgs[0].msg}" at ${deathMsgs[0].time}`);
        const respawnS = respawnTime && killTime ? secondsBetween(killTime, respawnTime) : null;
        ctx.check('respawned', respawnS !== null && respawnS <= p.respawnS,
            respawnS === null ? (gone() ? goneText(gone()) : `no health above 0 within ${p.respawnS + 15}s of the kill${sawZero ? ' (it read 0)' : ''}`)
                : `health above 0 at ${respawnTime}, ${respawnS}s after the kill${sawZero ? '' : ' (the 0 fell between two readings)'}${respawnS > p.respawnS ? ` (limit ${p.respawnS}s)` : ''}`);
        if (respawnTime === null) {
            for (const k of ['loss_reported', 'agenda_resumed']) ctx.check(k, false, `not reached: no respawn`);
        }

        // 5. what the bot still holds, so the server's loss per item
        let lossServer = null;
        let lossNotReached = null;   // why the loss cannot be judged (then loss_reported is "not reached")
        let v0 = null;
        if (respawnTime !== null) {
            await clock.sleep(p.afterRespawnS * MS);
            const afterCounts = await countAll();
            ctx.note('heldAfter', afterCounts);
            // An unread count is never read as "none left", so never as a full loss (#320 review 3): as for had_items.
            const unreadAfter = items.filter((it) => afterCounts[it] === null);
            if (unreadAfter.length) lossNotReached = `no count from the server after the respawn for ${unreadAfter.join(', ')}`;
            else {
                lossServer = Object.fromEntries(items.map((it) => {
                    const [lo, hi] = beforeRange[it];
                    return [it, lo === hi ? lo - afterCounts[it] : [lo - afterCounts[it], hi - afterCounts[it]]];
                }));
                ctx.note('lossServer', lossServer);
                // Nothing lost by the server's count (everything held was kept: main hand, off hand, armor, baubles):
                // a report could only say "lost nothing", which proves nothing about reporting a loss (#320 review 2).
                const total = lossUpperBound(lossServer);   // the same bound lossConsistency's "lost nothing" uses
                if (total <= 0) lossNotReached = `the server counts no loss (everything held was kept: ${Object.entries(afterCounts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing'})`;
            }
            v0 = counterValue((await scores()).sc);
        }

        // 6. the spam and resume windows
        const readings = [{ label: 'after respawn', value: v0 }];
        const endAt = Math.max(killAt + p.spamWindowMin * MIN, (respawnAt ?? killAt) + p.resumeMinutes * MIN);
        let rose = null;
        while (clock.now() < endAt && !gone()) {
            await clock.sleep(Math.min(p.counterPollMs, Math.max(MS, endAt - clock.now())));
            if (respawnTime !== null && rose === null) {
                const r = await scores();
                const v = counterValue(r.sc);
                readings.push({ label: 'poll', time: r.time, value: v });
                if (v0 !== null && v !== null && v > v0 && respawnAt !== null && clock.now() - respawnAt <= p.resumeMinutes * MIN) rose = { time: r.time, from: v0, to: v };
            }
        }
        ctx.note('counterReadings', readings);
        const chat = chatLines(s.sinceMarker(), name).slice(chatBefore);
        ctx.note('chatAfterKill', chat.slice(0, 30).map((c) => `${c.time} ${c.text}`));

        // the report
        if (respawnTime !== null) {
            const reports = chat.map((c) => ({ ...c, report: parseDeathReport(c.text) })).filter((c) => c.report);
            // From the kill (every line here is after it: chatBefore) to reportS after the respawn reading: a report can
            // only follow the respawn, but it may come before the reading that shows it (T1: 1 s before the confirming one).
            const inWindow = reports.filter((c) => secondsBetween(killTime, c.time) <= secondsBetween(killTime, respawnTime) + p.reportS);
            const rep = inWindow[0] ?? null;
            const cons = rep && lossServer ? lossConsistency(lossServer, rep.report, { tolAbs: p.lossTolAbs, tolRel: p.lossTolRel }) : null;
            ctx.note('deathReports', reports.map((c) => ({ time: c.time, text: c.text })));
            ctx.note('lossConsistency', cons);
            ctx.check('loss_reported', lossNotReached === null && rep !== null && reports.length === 1 && cons.ok,
                lossNotReached ? `not reached: ${lossNotReached}` : !rep ? (reports.length ? `a death report came, but not by ${p.reportS}s after the respawn: "${reports[0].text}" at ${reports[0].time}` : `no death report line in chat (${chat.length} lines after the kill)`)
                    : reports.length > 1 ? `${reports.length} death report lines for one death: ${reports.map((c) => `${c.time} "${c.text}"`).slice(0, 3).join('; ')}`
                        : !cons.ok ? `the report "${rep.text}" does not match the server's count: ${cons.problems.slice(0, 4).join('; ')}`
                            : `"${rep.text}" at ${rep.time}, ${secondsBetween(killTime, rep.time)}s after the kill; consistent with the server's count (${Object.entries(lossServer).filter(([, n]) => Math.max(...[n].flat()) > 0).map(([k, n]) => `${[n].flat().map((x) => Math.max(0, x)).join('-')} ${k}`).join(', ')})`);
            ctx.check('agenda_resumed', rose !== null,
                rose ? `the agenda counter rose ${rose.from} -> ${rose.to} by ${rose.time}` : gone() ? goneText(gone()) : v0 === null ? 'no counter reading after the respawn' : `the agenda counter stayed at ${v0} for ${p.resumeMinutes} min after the respawn`);
        }

        // no spam loop (lead decision after T1): a repeated line, more than one death report, a spam kick, the bot
        // gone; the per-minute rate is a backstop only
        const inSpam = chat.filter((c) => killTime && secondsBetween(killTime, c.time) <= p.spamWindowMin * 60);
        const perMin = maxPerMinute(inSpam.map((c) => secondsBetween(killTime, c.time)));
        const reps = repeatedLines(inSpam.map((c) => ({ t: secondsBetween(killTime, c.time), text: c.text })));
        const loop = reps.find((e) => e.in60 > p.maxRepeatPerMin || e.total > p.maxRepeatInWindow) ?? null;
        const reportLines = inSpam.filter((c) => parseDeathReport(c.text)).length;
        const spamKick = s.events().filter(s.gone).find((e) => /spam/i.test(e.reason ?? ''));
        const g = gone();
        const top = reps[0] ?? null;
        ctx.note('chatPerMinute', { lines: inSpam.length, maxIn60s: perMin, backstop: p.maxChatPerMin });
        ctx.note('chatRepeats', reps.slice(0, 3).map((e) => ({ text: e.text.slice(0, 120), in60: e.in60, total: e.total })));
        const repText = (e) => `"${e.text.slice(0, 80)}" ${e.total} times, ${e.in60} in one 60 s`;
        ctx.check('no_spam', !loop && reportLines <= 1 && perMin <= p.maxChatPerMin && !spamKick && !g,
            spamKick ? `kicked for spamming: ${spamKick.reason}` : g ? goneText(g)
                : loop ? `a repeated line: ${repText(loop)} (at most ${p.maxRepeatPerMin} in 60 s and ${p.maxRepeatInWindow} in ${p.spamWindowMin} min)`
                    : reportLines > 1 ? `${reportLines} death report lines in ${p.spamWindowMin} min for one death`
                        : perMin > p.maxChatPerMin ? `${perMin} chat lines in one 60 s (backstop ${p.maxChatPerMin}); ${inSpam.length} in ${p.spamWindowMin} min`
                            : `no loop: ${inSpam.length} chat lines in ${p.spamWindowMin} min after the kill, ${reportLines} death report, most repeated ${top ? repText(top) : 'none'}; at most ${perMin} lines in any 60 s (backstop ${p.maxChatPerMin}); online throughout`);
        finish();
    },
};
