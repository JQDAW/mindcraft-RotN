// G4 #3, ready-to-try: "Answers in chat, follows a player, comes when called, stops on command." test/scenarios/g4/
// PLAN.md item 3. Set-up S: the CX23 service (run.mjs --service frcfld, lib/service.mjs) on a fresh test server, with a
// TRUSTED PLAYER on it: the human as JQDAW (or a second scripted trusted account, the human's call; the `giver`
// parameter). The scenario gives no command itself on S: it whispers each step to the giver (`tell <giver> [g4] ...`,
// also printed on the runner's terminal), waits for the giver's own chat line, and observes. On a spawned driver (set-up
// T) it is a rehearsal of `!stop` only, from the test-only console giver `Server` (the driver's switch); the other steps
// need the trusted player and are not reached there.
//
// No prompt is ever a `say` (#399 review): on 1.12 mineflayer parses "[Server] [g4] JQDAW: ..." with its legacy chat
// pattern as chat FROM JQDAW, so an announcement would reach the bot as a giver's turn. A console whisper to the giver
// reaches only the giver. On S every `tell` is exactly `tell <giver> [g4] <text>` (the scenario's own guard).
//
// The arbiters: the server (the giver's chat lines, the bot's chat, `execute <bot> ~ ~ ~ testfor @a[name=<giver>,r=N]`
// for the distance between them, and the stat.walkOneCm/sprintOneCm/swimOneCm scoreboards for how far each one moved)
// and the bot's own log (agent.js: "<bot> received message from <giver> : <text>", then "<bot> full response to
// <giver>: ""<text>""", which ties an answer to the giver's question). The executor of `execute` is the bot: if a player
// is op, the server echoes the feedback to them as "[<executor>: Found ...]", which the bot ignores as its own name.
//
// Steps (S):
//   0. this run's bot from an inactive unit; login_online. The release's [settings] line (#385): allow_server_task_giver
//      false, Server not a giver, and the giver a task giver. The giver online (asked on the terminal to join, up to
//      promptWaitMinutes); the execute probe (`execute <bot> ~ ~ ~ testfor @a[name=<bot>,r=2]` must answer "Found <bot>").
//   1. chat_answer: the giver asks a question (no !command). Within answerS the bot's log shows the question received
//      from the giver and its full responses to the giver, and a chat line of the bot after the question is one of them
//      as openChat sends it (show_command_syntax full, shortened or none; across a split long line).
//   2. come: the giver walks at least comeFromBlocks away and calls the bot (a typed !goToPlayer("<giver>", ...) or a
//      line with "come"). The last distance read before the call line must be far. Within comeMinutes the bot is within
//      comeWithinBlocks of the giver, it moved at least comeFromBlocks - comeWithinBlocks since the call, and the giver
//      stayed put (moved at most comeGiverSlackM).
//   3. follow: the giver asks (a typed !followPlayer("<giver>", ...) or a line with "follow") and walks on for
//      followMinutes. Polled every followPollS after followGraceS: within followWithinBlocks at followInRangeShare of
//      the polls, and the bot moved at least followBotShare of the giver's distance (who must walk followGiverWalkM).
//   4. stop: the giver types !stop (or says a line with "stop") and keeps walking. The bot must have moved movingM in
//      the movingWindowS just BEFORE the stop line (the movement samples taken before it), or the stop proves nothing.
//      After stopSettleS, for stopHoldS, the bot moves at most stopSlackM while the giver walks at least stopGiverWalkM;
//      a typed !stop also gets the hold reply ("stopped; on hold until a task giver types !resume").
//   5. no_command_echo: the bot's log shows it heard nothing of the scenario's console traffic (replies, admin echoes,
//      prompts): every "received message from" line is a real chat line of that player, or (T) the console giver's
//      !stop/!resume. (The runner's begin marker is a `say`, but it comes before the bot starts.)
//   The giver is asked to type !resume (noted); the scoreboards are removed whatever happens (finally).
// Steps (T): 0 with the driver's console giver on; wait (up to movingWaitMinutes) until the agenda moves the bot, then
//   `tell <bot> !stop`, the hold reply within replyS and the same stillness window, then `tell <bot> !resume`; step 5.
// A step the giver does not start within promptWaitMinutes, or does not do their part of, is "not reached (human
// timing)", never a bot fail. A giver line that is not the step's request is ignored.
import { startSession } from '../../runner/lib/session.mjs';
import { G2_WORLD_SEED, testforVerdict } from '../../runner/lib/g2.mjs';
import { G3_DEFAULTS, G3_GATE_PARAMS, TEST_TASK_GIVER, consoleAllowFor, guardConsole, startEvent } from '../../runner/lib/g3.mjs';
import { chatLines, parseLine } from '../../runner/lib/server-log.mjs';
import { playerScores, scoreboardAddResult } from '../../runner/lib/s1.mjs';
import { lateConsole } from '../../runner/lib/late-console.mjs';
import { exitedText } from '../../runner/lib/service.mjs';
import { SETTINGS_LOOSE_RE, missingLine, productionGiversAtStart } from '../../runner/lib/start-lines.mjs';

const MS = 1000;
const MIN = 60 * MS;
/** Every prompt to the giver starts with this. */
export const PROMPT_TAG = '[g4]';
/** How far a player moved: these stats' scoreboards, summed (cm). */
export const MOVE_STATS = Object.freeze({ g4cWalk: 'stat.walkOneCm', g4cSprint: 'stat.sprintOneCm', g4cSwim: 'stat.swimOneCm' });
/** actions.js !stop, typed by a task giver (E3). */
export const HOLD_REPLY = 'stopped; on hold until a task giver types !resume';
/** Mindcraft's command pattern (src/agent/commands/index.js commandRegex). */
export const COMMAND_RE = /!(\w+)(?:\(((?:-?\d+(?:\.\d+)?|true|false|"[^"]*")(?:\s*,\s*(?:-?\d+(?:\.\d+)?|true|false|"[^"]*"))*)\))?/;
const ESC = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const key = (s) => String(s ?? '').replace(/\s+/g, '');
export const isCommandText = (t) => /^\s*!\w+/.test(String(t));
export const promptTell = (giver, text) => `tell ${giver} ${PROMPT_TAG} ${text}`;

/** What the giver's line must be for each step (#399 review): the typed command naming the giver, or the word. */
export const REQUESTS = Object.freeze({
    come: (t, giver) => new RegExp(`^\\s*!goToPlayer\\(\\s*"${ESC(giver)}"`).test(t) || (!isCommandText(t) && /\bcome\b/i.test(t)),
    follow: (t, giver) => new RegExp(`^\\s*!followPlayer\\(\\s*"${ESC(giver)}"`).test(t) || (!isCommandText(t) && /\bfollow\b/i.test(t)),
    stop: (t) => /^\s*!stop\b/.test(t) || (!isCommandText(t) && /\bstop\b/i.test(t)),
});

/** The index of the console's own line for a prompt whisper ("You whisper to <giver>: [g4] <text>"), or -1. */
export function promptIndex(lines, giver, text) {
    const want = `You whisper to ${giver}: ${PROMPT_TAG} ${text}`;
    for (let i = lines.length - 1; i >= 0; i--) if ((parseLine(lines[i])?.msg ?? lines[i]) === want) return i;
    return -1;
}

/** The effective task_givers from the release's [settings] line (#385): {givers} or {error}. */
export function giversAtStart(lines) {
    const line = lines.find((l) => SETTINGS_LOOSE_RE.test(l));
    if (!line) return { error: missingLine('[settings] effective task_givers=... allow_server_task_giver=...') };
    try {
        const v = JSON.parse(SETTINGS_LOOSE_RE.exec(line)[1]);
        return Array.isArray(v) ? { givers: v.map(String), line } : { error: `task_givers is not a JSON array: ${line}` };
    } catch { return { error: `task_givers is not JSON: ${line}` }; }
}

/**
 * agent.js's log of a player's message and its answers: "<bot> received message from <giver> : <text>", then every
 * "<bot> full response to <giver>: ""<response>""" after it (a response with newlines spans log lines, up to the one
 * ending in ""). -> [response text], possibly empty, or null when the question was never received.
 */
export function journalResponses(lines, bot, giver, text) {
    const got = new RegExp(`^${ESC(bot)} received message from ${ESC(giver)} : (.*)$`, 'i');
    const full = new RegExp(`^${ESC(bot)} full response to ${ESC(giver)}: ""(.*)$`, 'i');
    const i = lines.findIndex((l) => { const m = got.exec(l); return m && key(m[1]) === key(text); });
    if (i < 0) return null;
    const out = [];
    for (let j = i + 1; j < lines.length; j++) {
        const m = full.exec(lines[j]);
        if (!m) continue;
        const parts = [m[1]];
        let k = j;
        while (!/""$/.test(parts.at(-1)) && k + 1 < lines.length && k - j < 50) parts.push(lines[++k]);
        out.push(parts.join('\n').replace(/""$/, ''));
        j = k;
    }
    return out;
}

/**
 * The chat text(s) agent.js sends for one response (openChat; newlines become spaces): no command, the response;
 * with a command, by show_command_syntax: full, the response cut after the command (truncCommandMessage); shortened,
 * "<before>  *used <cmd>*"; none, the text before it. Compared without whitespace.
 */
export function chatForms(res) {
    const m = COMMAND_RE.exec(String(res));
    if (!m) return [key(res)].filter(Boolean);
    const pre = String(res).slice(0, m.index).trim();
    return [key(String(res).slice(0, m.index + m[0].length)), key(pre ? `${pre}  *used ${m[1]}*` : `*used ${m[1]}*`), key(pre)].filter(Boolean);
}

/** The bot's chat line after index `after` that is one of the responses as sent (or the first piece of a long one). */
export function answerLine(lines, bot, after, responses) {
    const forms = responses.flatMap(chatForms);
    return chatLines(lines, bot).find((c) => {
        const t = key(c.text);
        return c.at > after && t && forms.some((f) => f === t || (t.length >= 150 && f.startsWith(t)));
    }) ?? null;
}

/**
 * What the bot heard that no player said (no_command_echo): its "received message from <who> : <text>" lines that are
 * not a real "<who> <text>" chat line in the server log, nor one of `allowed` ({from, text}). -> [{from, text}]
 */
export function heardEchoes(output, serverLines, bot, { allowed = [] } = {}) {
    const got = new RegExp(`^${ESC(bot)} received message from (\\S+) : (.*)$`, 'i');
    const said = new Set();
    for (const l of serverLines) { const m = /^<(\w+)> (.*)$/.exec(parseLine(l)?.msg ?? ''); if (m) said.add(`${m[1]}\u0000${key(m[2])}`); }
    for (const a of allowed) said.add(`${a.from}\u0000${key(a.text)}`);
    const echoes = [];
    for (const l of output) {
        const m = got.exec(l);
        if (m && !said.has(`${m[1]}\u0000${key(m[2])}`)) echoes.push({ from: m[1], text: m[2] });
    }
    return echoes;
}

export default {
    id: 'g4-control-commands',
    gate: 'G4',
    llm: true,
    title: 'A trusted player\'s chat and commands: the bot answers, comes when called, follows, and stops on !stop (the server checks)',
    checks: {
        login_online: 'The bot logs in with its own account (online mode); on S from an inactive unit of this run\'s bot',
        chat_answer: 'It answers the trusted player\'s question in chat (its log ties the answer to the question)',
        come: 'Called from afar, it comes to the trusted player (the server measures the distance)',
        follow: 'Asked to follow, it keeps close to the trusted player as they walk (the server measures)',
        stop: 'On !stop it stops and stays put while the player walks on (on T: the console giver\'s !stop)',
        no_command_echo: 'The bot hears none of the scenario\'s console traffic (replies, admin echoes, prompts) as chat',
    },
    defaults: {
        bot: 'FRCFLD',
        giver: 'JQDAW',
        worldSeed: G2_WORLD_SEED,
        promptWaitMinutes: 3,
        answerS: 90,
        comeFromBlocks: 20,
        comeWithinBlocks: 4,
        comeMinutes: 2,
        comeGiverSlackM: 5,
        followMinutes: 2,
        followPollS: 10,
        followGraceS: 20,
        followWithinBlocks: 8,
        followInRangeShare: 0.66,
        followGiverWalkM: 20,
        followBotShare: 0.5,
        movingWindowS: 30,
        movingM: 3,
        movingWaitMinutes: 5,
        replyS: 30,
        stopSettleS: 5,
        stopHoldS: 30,
        stopSlackM: 2,
        stopGiverWalkM: 8,
        ...G3_DEFAULTS,
        loginTimeoutMs: 240 * MS,
        pollMs: 5 * MS,
        distPollMs: 5 * MS,
        logTail: 20000,
        consoleWaitS: 1,
        lateReplyMs: 5 * MS,
        latePollMs: 1 * MS,
    },
    gateParams: {
        answerS: 'equal', comeFromBlocks: 'equal', comeWithinBlocks: 'equal', comeMinutes: 'equal', followMinutes: 'equal',
        followWithinBlocks: 'equal', followInRangeShare: 'equal', followGiverWalkM: 'equal', followBotShare: 'equal',
        movingWindowS: 'equal', movingM: 'equal', stopHoldS: 'equal', stopSlackM: 'equal', stopGiverWalkM: 'equal', ...G3_GATE_PARAMS,
    },
    // The login, the giver's join, then per step the prompt waits and the step's own window, and the !resume prompt.
    runMinutes: (p) => p.loginTimeoutMs / MIN + p.promptWaitMinutes * 7 + p.answerS / 60 + p.comeMinutes + p.followMinutes
        + (p.stopSettleS + p.stopHoldS + p.replyS) / 60 + p.movingWaitMinutes + 2,

    async run(ctx) {
        const { bot, clock, params: p } = ctx;
        const name = p.bot;
        const service = bot.kind === 'service';
        const giver = service ? p.giver : TEST_TASK_GIVER;
        const guarded = guardConsole(ctx.server, consoleAllowFor({ id: 'g4-control-commands' }, p));
        // On S the only tell is the prompt whisper to the giver (#399 review); the bot is never told anything.
        const tellRe = new RegExp(`^tell ${ESC(p.giver)} ${ESC(PROMPT_TAG)} [ -~]{1,240}$`);
        const server = service ? { ...guarded, console(cmd, waitS) {
            if (/^tell /.test(cmd) && !tellRe.test(cmd)) throw new Error(`console command refused on S: only '${promptTell(p.giver, '<text>')}' is a tell here`);
            return guarded.console(cmd, waitS);
        } } : guarded;
        const lc = lateConsole(server, clock, { waitS: p.consoleWaitS, lateMs: p.lateReplyMs, pollMs: p.latePollMs });
        const steps = ['chat_answer', 'come', 'follow', 'stop', 'no_command_echo'];
        const done = new Set();
        const check = (k, pass, detail) => { done.add(k); ctx.check(k, pass, detail); };
        const notReached = (keys, why) => { for (const k of keys) if (!done.has(k)) check(k, false, `not reached: ${why}`); };
        const human = (what) => `the giver gave no ${what} within ${p.promptWaitMinutes} min (human timing, not a bot result)`;
        const round1 = (x) => Math.round(x * 10) / 10;
        if (!service) ctx.notGate('not the CX23 service (set-up T): a rehearsal of !stop only');

        // 0. this run's bot, from an inactive unit (S)
        if (service && String(bot.bot).toLowerCase() !== String(name).toLowerCase()) {
            ctx.check('login_online', false, `the service's bot '${bot.bot}' is not this run's bot '${name}'`);
            notReached(steps, 'the service is another bot');
            return;
        }
        const m0 = service ? await bot.metrics() : null;
        if (service && m0?.ActiveState !== 'inactive' && m0?.ActiveState !== 'failed') {
            ctx.check('login_online', false, `the unit is ${m0?.ActiveState ?? 'unknown'} before the start: stop it first`);
            notReached(steps, 'the unit was not inactive at the start');
            return;
        }
        const s = await startSession(ctx, { name, checkNaming: false });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) { notReached(steps, 'the bot did not log in'); return; }
        const fresh = async () => { if (typeof bot.refresh === 'function') await bot.refresh().catch(() => {}); };
        const gone = () => s.events().find(s.gone)?.type ?? (!bot.alive() && bot.unitState?.() !== 'unknown' ? exitedText(bot) : null);
        const lines = () => s.sinceMarker();
        const goneNow = () => { const g = gone(); if (g) notReached(steps.filter((k) => k !== 'no_command_echo'), `the bot is gone: ${g}`); return Boolean(g); };

        // The giver: the release's production settings and a task giver (S), or the driver's console giver (T)
        if (service) {
            await fresh();
            const prod = productionGiversAtStart(bot.output());
            const g = giversAtStart(bot.output());
            ctx.note('taskGivers', { production: prod.detail, givers: g.givers ?? g.error });
            if (!prod.pass) { notReached(steps, prod.line ? `the release's settings are not production's: ${prod.detail}` : prod.detail); return; }
            if (g.error) { notReached(steps, g.error); return; }
            if (!g.givers.includes(giver)) { notReached(steps, `${giver} is not a task giver in this release (task_givers ${JSON.stringify(g.givers)})`); return; }
        } else {
            notReached(['chat_answer', 'come', 'follow'], 'set-up T rehearses !stop only, from the test-only console giver (lead); answer, come and follow need the trusted player on S');
            if (startEvent(bot.output())?.serverTaskGiver !== true) { notReached(['stop', 'no_command_echo'], 'the T driver\'s console giver is off'); return; }
        }

        // The server's answers. The executor of execute is always the bot (an op's admin echo then names the bot).
        const found = (cmd) => lc.confirm(cmd, (ls) => testforVerdict(ls).ok).then((ls) => testforVerdict(ls).ok);
        const near = (r) => found(`execute ${name} ~ ~ ~ testfor @a[name=${giver},r=${r}]`);
        const online = (player) => found(`testfor @a[name=${player}]`);
        const moved = async (player) => {
            const sc = playerScores(await lc.confirm(`scoreboard players list ${player}`, (ls) => playerScores(ls, player) !== null), player);
            if (!sc) return null;
            return Object.keys(MOVE_STATS).reduce((a, k) => a + (sc[k] ?? 0), 0) / 100;
        };
        // Movement samples of the bot; n is the log length after the read, so a sample is before a line at index >= n.
        const track = [];
        const sample = async (extra = {}) => { const m = await moved(name); track.push({ t: clock.now(), m, n: lines().length, ...extra }); return m; };
        const movedBefore = (at) => {
            const before = track.filter((x) => x.n <= at && x.m !== null);
            const last = before.at(-1);
            const ref = last ? before.find((x) => x.t >= last.t - p.movingWindowS * MS) : null;
            return last && ref && ref !== last ? round1(last.m - ref.m) : null;
        };
        const prompt = (text) => {
            ctx.log(`[g4] to ${giver}: ${text}`);
            lc.con(promptTell(giver, text));
            const i = promptIndex(lines(), giver, text);
            return i < 0 ? lines().length - 1 : i;
        };
        /** The giver's first line after index `after` that passes `pred`; `each` runs at every poll before the look. */
        const giverLine = async (after, pred, ms, each = null) => {
            let hit = null;
            await ctx.waitFor(async () => {
                if (each) await each();
                hit = chatLines(lines(), giver).find((c) => c.at > after && pred(c.text)) ?? null;
                return hit || gone();
            }, ms, p.pollMs);
            return hit;
        };

        const objectives = [];
        for (const [obj, crit] of Object.entries(MOVE_STATS)) {
            const r = scoreboardAddResult(await lc.confirm(`scoreboard objectives add ${obj} ${crit}`, (ls) => scoreboardAddResult(ls, obj, crit) !== null), obj, crit);
            if (r === 'added' || r === 'exists') objectives.push(obj);
            else {
                notReached(steps, `the server did not add the ${crit} scoreboard (${r ?? 'no reply'})`);
                for (const o of objectives) lc.con(`scoreboard objectives remove ${o}`);
                return;
            }
        }
        try {
            const probe = await found(`execute ${name} ~ ~ ~ testfor @a[name=${name},r=2]`);
            ctx.note('executeProbe', probe);
            if (!probe) { notReached(steps, 'the server did not answer "Found" to the execute probe (execute ... testfor), so distances cannot be read'); return; }
            if (service) await withGiver(); else await rehearseStop();
            // 5. no_command_echo (also when a step was not reached: the console traffic so far counts)
            await fresh();
            const allowed = service ? [] : [{ from: TEST_TASK_GIVER, text: '!stop' }, { from: TEST_TASK_GIVER, text: '!resume' }];
            const echoes = heardEchoes(bot.output(), lines(), name, { allowed });
            ctx.note('heardEchoes', echoes.slice(0, 10));
            check('no_command_echo', echoes.length === 0, echoes.length
                ? `${echoes.length} message(s) heard that no player said, e.g. from ${echoes[0].from}: "${echoes[0].text}"`
                : `every message the bot heard is a real chat line${service ? '' : ' or the console giver\'s !stop/!resume'}`);
        } finally {
            for (const o of objectives) { try { lc.con(`scoreboard objectives remove ${o}`); } catch (e) { ctx.log(`scoreboard remove ${o} failed: ${e?.message ?? e}`); } }
            ctx.note('lateReplies', lc.late());
        }

        /** S: the giver's four steps. */
        async function withGiver() {
            if (!(await online(giver))) {
                // A whisper cannot reach a player who is not online: this one is for the runner's terminal (#399 review).
                ctx.log(`[g4] ${giver}: please join the test server for the ${name} control test (waiting ${p.promptWaitMinutes} min)`);
                if (!(await ctx.waitFor(() => online(giver), p.promptWaitMinutes * MIN, p.distPollMs))) {
                    notReached(steps.slice(0, 4), `${giver} was not online within ${p.promptWaitMinutes} min (human timing, not a bot result)`); return;
                }
            }

            // 1. chat_answer
            let i = prompt(`1/4 answer: ask ${name} a question in chat, e.g. "${name}, what are you doing?" (no !command)`);
            const q = await giverLine(i, (t) => !isCommandText(t), p.promptWaitMinutes * MIN);
            if (goneNow()) return;
            if (!q) notReached(['chat_answer'], human('question'));
            else {
                let resps = null, ans = null;
                await ctx.waitFor(async () => {
                    await fresh();
                    resps = journalResponses(bot.output(), name, giver, q.text);
                    ans = resps?.length ? answerLine(lines(), name, q.at, resps) : null;
                    return ans;
                }, p.answerS * MS, p.pollMs);
                ctx.note('answer', { question: q.text, responses: resps, chat: ans?.text ?? null });
                check('chat_answer', Boolean(ans), ans ? `asked "${q.text}", answered "${ans.text}"`
                    : !resps?.length ? `no answer to ${giver} in the bot's log within ${p.answerS} s (received and full-response lines)`
                        : `the bot's log has ${resps.length} response(s), but no chat line of one within ${p.answerS} s`);
            }

            // 2. come
            i = prompt(`2/4 come: walk at least ${p.comeFromBlocks + 5} blocks away from ${name} and wait there`);
            const far = await ctx.waitFor(async () => (await online(giver)) && !(await near(p.comeFromBlocks)), p.promptWaitMinutes * MIN, p.distPollMs);
            if (goneNow()) return;
            if (!far) notReached(['come'], `${giver} was still within ${p.comeFromBlocks} blocks of the bot after ${p.promptWaitMinutes} min (human timing, not a bot result)`);
            else {
                i = prompt(`2/4 come: now call ${name}: say "${name}, come here" or type !goToPlayer("${giver}", 2), and stay where you are`);
                const call = await giverLine(i, (t) => REQUESTS.come(t, giver), p.promptWaitMinutes * MIN,
                    async () => { const f = !(await near(p.comeFromBlocks)); await sample({ far: f }); });
                if (!call) notReached(['come'], human('call ("come" or !goToPlayer)'));
                else {
                    // The distance and the bot's movement from the last sample before the call line (#399 review 3).
                    const before = track.filter((x) => x.n <= call.at && x.far !== undefined).at(-1) ?? null;
                    const g0 = await moved(giver);
                    const arrived = await ctx.waitFor(() => near(p.comeWithinBlocks), p.comeMinutes * MIN, p.distPollMs);
                    const b1 = await moved(name);
                    const g1 = await moved(giver);
                    const gMove = g0 === null || g1 === null ? null : round1(g1 - g0);
                    const bMove = before?.m == null || b1 === null ? null : round1(b1 - before.m);
                    const need = p.comeFromBlocks - p.comeWithinBlocks;
                    ctx.note('come', { call: call.text, typed: isCommandText(call.text), farBeforeCall: before?.far ?? null, botMovedM: bMove, giverMovedM: gMove });
                    if (!before?.far) notReached(['come'], `the bot was within ${p.comeFromBlocks} blocks of ${giver} at the last read before the call (human timing, not a bot result)`);
                    else if (gMove !== null && gMove > p.comeGiverSlackM) notReached(['come'], `${giver} moved ${gMove} m while waiting (more than ${p.comeGiverSlackM}): human timing, not a bot result`);
                    else {
                        const why = [!arrived && `not within ${p.comeWithinBlocks} blocks of ${giver} ${p.comeMinutes} min after "${call.text}"`,
                            arrived && (bMove === null || bMove < need) && `the bot moved ${bMove ?? '?'} m since the call (need ${need})`].filter(Boolean);
                        check('come', why.length === 0, why.length ? why.join('; ') : `within ${p.comeWithinBlocks} blocks of ${giver} after "${call.text}", moving ${bMove} m`);
                    }
                }
            }

            // 3. follow
            i = prompt(`3/4 follow: say "${name}, follow me" or type !followPlayer("${giver}", 3), then walk on (on land, not sprinting) for ${p.followMinutes} min`);
            const fl = await giverLine(i, (t) => REQUESTS.follow(t, giver), p.promptWaitMinutes * MIN);
            if (goneNow()) return;
            if (!fl) { notReached(['follow'], human('follow request ("follow" or !followPlayer)')); notReached(['stop'], 'the follow did not start, so a stop has nothing to stop'); return; }
            const t0 = clock.now();
            const g0 = await moved(giver);
            const b0 = await sample();
            const polls = [];
            while (clock.now() - t0 < p.followMinutes * MIN) {
                await clock.sleep(p.followPollS * MS);
                const inRange = await near(p.followWithinBlocks);
                polls.push({ s: Math.round((clock.now() - t0) / MS), inRange, botM: await sample() });
            }
            const g1 = await moved(giver);
            const counted = polls.filter((x) => x.s >= p.followGraceS);
            const share = counted.length ? counted.filter((x) => x.inRange).length / counted.length : 0;
            const gWalk = g0 === null || g1 === null ? null : round1(g1 - g0);
            const bWalk = b0 === null || polls.at(-1)?.botM == null ? null : round1(polls.at(-1).botM - b0);
            ctx.note('follow', { request: fl.text, typed: isCommandText(fl.text), giverWalkM: gWalk, botWalkM: bWalk, inRangeShare: Math.round(share * 100) / 100, polls });
            if (gWalk === null || bWalk === null) notReached(['follow'], 'the movement scoreboards could not be read');
            else if (gWalk < p.followGiverWalkM) notReached(['follow'], `${giver} walked only ${gWalk} m (need ${p.followGiverWalkM}): human timing, not a bot result`);
            else {
                check('follow', share >= p.followInRangeShare && bWalk >= p.followBotShare * gWalk,
                    `within ${p.followWithinBlocks} blocks at ${Math.round(share * 100)}% of ${counted.length} polls (need ${Math.round(p.followInRangeShare * 100)}%); the bot moved ${bWalk} m as ${giver} walked ${gWalk} m (need ${Math.round(p.followBotShare * 100)}%)`);
            }

            // 4. stop: the movement samples go on until the stop line, so "moving" is measured right before it
            i = prompt(`4/4 stop: type !stop, then keep walking for about ${p.stopSettleS + p.stopHoldS} s`);
            const sl = await giverLine(i, (t) => REQUESTS.stop(t), p.promptWaitMinutes * MIN, () => sample());
            if (goneNow()) return;
            if (!sl) notReached(['stop'], human('!stop'));
            else await stillness(sl, movedBefore(sl.at));

            // !resume (noted)
            i = prompt(`done: thank you. Type !resume so ${name} goes back to its agenda`);
            const rs = await giverLine(i, (t) => /^\s*!resume\b/.test(t), p.promptWaitMinutes * MIN);
            ctx.note('resume', rs ? rs.text : 'not typed within the prompt wait');
        }

        /** The stillness window after a stop line `sl` (S: the giver's; T: the console's), and the stop check. */
        async function stillness(sl, movingBefore) {
            const typed = /^\s*!stop\b/.test(sl.text);
            await clock.sleep(p.stopSettleS * MS);
            const b0 = await moved(name);
            const g0 = service ? await moved(giver) : null;
            await clock.sleep(p.stopHoldS * MS);
            const b1 = await moved(name);
            const g1 = service ? await moved(giver) : null;
            const hold = chatLines(lines(), name).find((c) => c.at > sl.at && c.text === HOLD_REPLY) ?? null;
            const bMove = b0 === null || b1 === null ? null : round1(b1 - b0);
            const gMove = g0 === null || g1 === null ? null : round1(g1 - g0);
            ctx.note('stop', { line: sl.text, typed, holdReply: Boolean(hold), movingBeforeM: movingBefore, botMovedM: bMove, giverMovedM: gMove });
            if (movingBefore === null || movingBefore < p.movingM) { notReached(['stop'], `the bot was not moving just before the stop (${movingBefore ?? '?'} m in the last ${p.movingWindowS} s; need ${p.movingM}), so a stop proves nothing`); return; }
            if (bMove === null) { notReached(['stop'], 'the movement scoreboards could not be read'); return; }
            if (service && (gMove === null || gMove < p.stopGiverWalkM)) { notReached(['stop'], `${giver} walked only ${gMove ?? '?'} m after the stop (need ${p.stopGiverWalkM}): human timing, not a bot result`); return; }
            const why = [bMove > p.stopSlackM && `the bot moved ${bMove} m in the ${p.stopHoldS} s after the stop (at most ${p.stopSlackM})`,
                typed && !hold && `no "${HOLD_REPLY}" reply to the typed !stop`].filter(Boolean);
            check('stop', why.length === 0, why.length ? why.join('; ') : `"${sl.text}": the bot moved ${bMove} m in ${p.stopHoldS} s${service ? ` while ${giver} walked ${gMove} m` : ''}${hold ? ', with the hold reply' : typed ? '' : ' (said, not typed: no hold)'}`);
        }

        /** T: wait for the agenda to move the bot, then the console giver's !stop, the stillness window, and !resume. */
        async function rehearseStop() {
            const moving = await ctx.waitFor(async () => {
                await sample();
                const v = movedBefore(Infinity);
                return v !== null && v >= p.movingM ? v : false;
            }, p.movingWaitMinutes * MIN, p.distPollMs);
            if (goneNow()) return;
            if (!moving) { notReached(['stop'], `the agenda did not move the bot ${p.movingM} m within ${p.movingWindowS} s in ${p.movingWaitMinutes} min, so a stop proves nothing`); return; }
            const before = lines().length - 1;
            lc.con(`tell ${name} !stop`);
            const sl = { at: before, text: '!stop' };
            await ctx.waitFor(() => chatLines(lines(), name).some((c) => c.at > before && c.text === HOLD_REPLY), p.replyS * MS, p.pollMs);
            await stillness(sl, moving);
            lc.con(`tell ${name} !resume`);
        }
    },
};
