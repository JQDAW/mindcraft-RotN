import { testforblockVerdict } from './g2.mjs';
import { parseLine } from './server-log.mjs';

// G3 rules the runner enforces for every G3 scenario (coord/STATUS-harness-ops.md, "G3 batches";
// lead, #101 and #116 review):
//   - the batch spend stop: maxBatchUsd (USD 2) is a gate parameter compared 'equal';
//   - the console sender `Server` is the test-only task giver: never in the production settings;
//   - the console is limited to G3's approved commands; give, summon, kill and every op command
//     (gamemode, effect, op, ...) are refused before they reach the server.
export const G3_DEFAULTS = Object.freeze({ maxBatchUsd: 2 });

/**
 * The model of every LLM run (the human's decision): the OpenRouter preset @preset/glm-5-3-flash-cheap-reliable,
 * written in a Mindcraft profile as "openrouter/@preset/glm-5-3-flash-cheap-reliable". It replaced
 * @preset/glm-5-1-mindcraft (2026-11-03) on 2026-11-06, after that preset's upstream provider rate-limited G3
 * smoke round 3 (HTTP 429, tpm_rate_limit_exceeded); the human set the new one up for reliable providers.
 */
export const LLM_MODEL = 'openrouter/@preset/glm-5-3-flash-cheap-reliable';

/**
 * A profile's model setting as one "api/model" id, the way Mindcraft's selectAPI reads it: a string
 * ("openrouter/@preset/..."), or an object {api?, model} ({api: "openrouter", model: "@preset/..."} is
 * the same model). Null when the setting is absent or not understood.
 */
export function modelId(setting) {
    if (typeof setting === 'string') return setting.trim() || null;
    if (!setting || typeof setting !== 'object' || typeof setting.model !== 'string') return null;
    const m = setting.model.trim();
    const api = typeof setting.api === 'string' ? setting.api.trim() : '';
    return api && !m.startsWith(`${api}/`) ? `${api}/${m}` : m;
}

/**
 * The model problems of a profile for an LLM run: "model" must be LLM_MODEL, set in the profile itself,
 * and "code_model" and "vision_model", when set, must be the same model (Mindcraft uses them for code and
 * images instead of "model"). The embedding model is not checked. Problems as text.
 */
export function modelProblems(profile) {
    const p = [];
    const main = modelId(profile?.model);
    if (main !== LLM_MODEL) p.push(`model is '${main ?? 'not set'}', not ${LLM_MODEL} (the human's decision for every LLM run)`);
    for (const k of ['code_model', 'vision_model']) {
        if (profile && k in profile && modelId(profile[k]) !== LLM_MODEL) p.push(`${k} is '${modelId(profile[k]) ?? 'not understood'}', not ${LLM_MODEL}`);
    }
    return p;
}

/** The models a profile will use, for the run record: {model, code_model, vision_model} (null when unset). */
export const profileModels = (profile) => ({
    model: modelId(profile?.model), code_model: modelId(profile?.code_model), vision_model: modelId(profile?.vision_model),
});
export const G3_GATE_PARAMS = Object.freeze({ maxBatchUsd: 'equal' });
export const TEST_TASK_GIVER = 'Server';

const NAME = '[A-Za-z0-9_]{3,16}';
const N = '-?\\d+';
/**
 * The pinned task markers, all S1-A's confirmed surface rock piles in the G2 world
 * (test/evidence/s1/s1a-20261102/survey/result.json, notes.confirmed, group rocks):
 * - task: (c)'s task marker (lead, #207 review);
 * - untrusted: (d)'s candidates in order (lead, after smoke round 2: -20,70,-56 had Leaves above it). Each
 *   goes through the same read-only air preflight, and the first clear one is used (pickClearMarker).
 * `setblock` of the gold block is allowed at exactly these cells (G3_CONSOLE_ALLOW).
 */
export const G3_MARKERS = Object.freeze({
    task: '-42,68,-50',
    untrusted: Object.freeze(['-20,70,-56', '-25,71,-28', '-57,70,-32', '-5,74,-68']),
});
/** Every cell where G3 may place its gold block, as "x y z". */
export const G3_MARKER_CELLS = Object.freeze([G3_MARKERS.task, ...G3_MARKERS.untrusted].map((m) => m.split(',').join(' ')));
const markerCells = G3_MARKER_CELLS.join('|');

/** G3's approved console commands (lead, #101), anchored. Nothing else reaches the test server. */
export const G3_CONSOLE_ALLOW = [
    /^say scenario-[0-9a-z-]+-begin$/,                                     // the runner's begin marker
    /^seed$/,
    // No tp of any form (lead, #201 review): even `tp <bot> ~ ~ ~` is a teleport in 1.12 (it dismounts, zeroes
    // motionY, sets onGround and forces a position packet). Life evidence comes from stat.deaths and the log.
    // No time change of any form either (lead, #203 review): `time set day` is gone; only the query below.
    new RegExp(`^tell ${NAME} .+$`),                                       // the test-only task giver `Server`
    // Read-only checks approved for G3 (lead, #203 review): testforblock and testfor, and the gamerule query.
    new RegExp(`^testforblock ${N} ${N} ${N} \\S+ \\d+$`),                 // read-only: does the block match
    /^testfor @[aep]\[[^\]]*\]$/,                                          // read-only: does a selector match
    new RegExp(`^clear ${NAME} \\S+ ${N} 0$`),                             // count only: maxCount 0, never a real clear
    /^scoreboard objectives add [A-Za-z0-9_]{1,16} stat\.[A-Za-z0-9_.]+$/,
    /^scoreboard objectives add [A-Za-z0-9_]{1,16} food$/,                 // read-only food level, evidence only (lead, #203)
    /^scoreboard objectives remove [A-Za-z0-9_]{1,16}$/,
    new RegExp(`^scoreboard players list ${NAME}$`),
    /^time query daytime$/,
    /^gamerule [A-Za-z]+$/,                                                // read-only: the query form only, never a value
    new RegExp(`^setblock (${markerCells}) minecraft:gold_block$`),        // the pinned task markers only (#208 review, G3_MARKERS)
];

/**
 * What run.mjs applies to a scenario (#122 review findings 3 and 4):
 *   guard:   the console allowlist, for every G3 scenario and every scenario that runs the real agent;
 *   notGate: a reason when a G3 run did not come from batch.mjs (no ROTN_G3_BATCH marker "<id>:<limit>"),
 *            or the marker's limit is not the run's maxBatchUsd: such a run had no spend stop over it.
 */
export function g3Policy(scenario, env, maxBatchUsd) {
    const guard = scenario.gate === 'G3' || scenario.llm === true;
    const marker = env.ROTN_G3_BATCH ?? null;
    let notGate = null;
    if (scenario.gate === 'G3') {
        const m = /^[0-9A-Za-z-]+:(\d+(?:\.\d+)?)$/.exec(marker ?? '');
        if (!m) notGate = 'a G3 run outside batch.mjs has no spend stop (no ROTN_G3_BATCH marker)';
        else if (Number(m[1]) !== Number(maxBatchUsd)) notGate = `the batch's spend limit ${m[1]} is not this run's maxBatchUsd ${maxBatchUsd}`;
    }
    return { guard, notGate, batch: marker };
}

/** The exit batch.mjs records for a scenario its LLM-failure rule stopped: an infra fault (EXIT_LLM_STOP there). */
export const INFRA_FAULT_EXIT = 125;

/**
 * The gate evidence cross-check (#122 nit 1). The ROTN_G3_BATCH marker alone can be forged (export it and
 * run run.mjs directly), so a G3 result counts only if the batch summary that batch.mjs wrote (BATCH,
 * batch.json) vouches for it:
 *   - the summary is from a real batch (testMode false) and names its batchId and maxBatchUsd;
 *   - the result's marker is exactly "<that batchId>:<that maxBatchUsd>";
 *   - the batch ran that scenario exactly once, the result's runId is the one the batch read back from
 *     that run's result.json, and its recorded exit agrees with the result (a passing result needs exit 0;
 *     run.mjs exits 0 only for a gate pass).
 * test/tools/g3-batch-check.mjs checkEvidenceTree makes it compulsory: every G3 result under test/evidence/
 * must sit under a folder with a batch.json that vouches for it.
 * results: [{file, result}] with each result.json's contents; g3Scenarios: the ids loadScenarios marks
 * gate G3 (isG3Result). gate: true for a gate claim (lead, #218 review and #220 decision): the summary must
 * also say gate: true (only batch.mjs --gate writes it; smoke is the default) and not smoke: true, so a
 * smoke batch, or a summary that does not say gate: true, is never gate evidence. An infra fault (#248 review:
 * the batch's exit 125 for a scenario and its result's infraFault, which must agree) is never gate evidence
 * either. Returns the problems (empty = consistent).
 */
export function crossCheckBatch(summary, results, { g3Scenarios = [], gate = false } = {}) {
    if (!summary || typeof summary.batchId !== 'string' || !summary.batchId) return ['no batch summary with a batchId (batch.json from batch.mjs)'];
    const p = [];
    if (summary.testMode !== false) p.push(`batch ${summary.batchId} ran in test mode (or does not say): not gate evidence`);
    if (gate && (summary.gate !== true || summary.smoke === true)) {
        p.push(summary.smoke === true ? `batch ${summary.batchId} is a smoke batch (smoke: true): never gate evidence`
            : `batch ${summary.batchId} does not say gate: true (only batch.mjs --gate writes it): not gate evidence`);
    }
    const marker = `${summary.batchId}:${summary.maxBatchUsd}`;
    const ran = (summary.scenarios ?? []).reduce((m, s) => m.set(s.id, [...(m.get(s.id) ?? []), s]), new Map());
    const g3 = results.filter(({ result }) => isG3Result(result, g3Scenarios));
    if (!g3.length) p.push('no G3 result.json to check');
    for (const { file, result } of g3) {
        if (result.batch !== marker) p.push(`${file}: its batch marker '${result.batch ?? 'none'}' is not this batch's '${marker}'`);
        const runs = ran.get(result.scenario) ?? [];
        if (runs.length !== 1) {
            p.push(`${file}: batch ${summary.batchId} ran ${result.scenario} ${runs.length} time(s), not once`);
            continue;
        }
        // The run itself, not only the batch id: a second, hand-run result under a reused batch id fails here (#129 review).
        if (typeof runs[0].runId !== 'string' || !runs[0].runId || result.runId !== runs[0].runId) {
            p.push(`${file}: its runId '${result.runId ?? 'none'}' is not the run batch ${summary.batchId} recorded for ${result.scenario} ('${runs[0].runId ?? 'none'}')`);
        }
        if (result.pass === true && runs[0].exit !== 0) p.push(`${file}: a passing result, but the batch recorded exit ${runs[0].exit} for ${result.scenario}`);
        // An infra fault (the LLM-failure stop, exit 125; #248 review) is recorded on both sides, or neither.
        const stopped = runs[0].exit === INFRA_FAULT_EXIT;
        if (stopped && !result.infraFault) p.push(`${file}: the batch stopped ${result.scenario} as an infra fault (exit ${INFRA_FAULT_EXIT}), but its result does not say infraFault`);
        if (!stopped && result.infraFault) p.push(`${file}: its result says infraFault, but the batch recorded exit ${runs[0].exit} for ${result.scenario}, not ${INFRA_FAULT_EXIT}`);
        if (gate && result.infraFault) p.push(`${file}: an infra fault (${result.infraFault.kind ?? 'unknown'}), not a bot result: never gate evidence`);
    }
    return p;
}

/**
 * A G3 result, so that neither dropping nor re-spelling a field dodges the cross-check (#129 re-review nit 2):
 * its gate is G3 in any case or spacing, or its scenario starts with g3- (any case), or its scenario is one
 * that loadScenarios marks gate G3 (g3Scenarios: those ids, compared without case or surrounding spaces,
 * #139 review nit 1). Only the top-level object is a result: one wrapped in an array or a parent object is
 * not detected (#139 review nit 2; DRIVER.md says so, and the evidence review covers it).
 */
export function isG3Result(result, g3Scenarios = []) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
    if (String(result.gate ?? '').trim().toUpperCase() === 'G3') return true;
    const id = String(result.scenario ?? '').trim().toLowerCase();
    return id.startsWith('g3-') || (id !== '' && g3Scenarios.some((s) => String(s).trim().toLowerCase() === id));
}

/** The verb of a console command, for error messages (never the arguments). */
const verb = (cmd) => String(cmd).trim().split(/\s+/)[0] || '(empty)';

/** A server whose console refuses anything not on the allowlist (it throws; nothing is sent). */
export function guardConsole(server, allow = G3_CONSOLE_ALLOW) {
    return {
        ...server,
        console(cmd, waitS) {
            if (!allow.some((re) => re.test(cmd))) {
                throw new Error(`console command refused in G3: '${verb(cmd)}' is not on the approved list (give, summon and op commands never reach the server)`);
            }
            return server.console(cmd, waitS);
        },
    };
}

/**
 * The test-only task giver must never be in the production settings (lead, #116 review): every settings
 * key that names task givers (any key matching /giver/i) is checked for TEST_TASK_GIVER. Problems as text.
 */
export function giverProblems(settings) {
    const p = [];
    // skills-rotn's test-only switch (#146): only the G3 driver turns it on, through SETTINGS_JSON.
    if (settings && 'allow_server_task_giver' in settings && settings.allow_server_task_giver !== false) {
        p.push('settings.allow_server_task_giver is not false: it is test-only, turned on by the G3 driver alone, never in production');
    }
    for (const [k, v] of Object.entries(settings ?? {})) {
        if (!/giver/i.test(k)) continue;
        const list = Array.isArray(v) ? v : [v];
        if (list.some((x) => String(x).toLowerCase() === TEST_TASK_GIVER.toLowerCase())) {
            p.push(`settings.${k} contains '${TEST_TASK_GIVER}': the console sender is a test-only task giver, never in production`);
        }
    }
    return p;
}

// ---- Server-side arbiters shared by the G3 scenarios (coord/STATUS-harness-ops.md, "Server-side arbiters") ----

/** A 1.12 stat criterion for an item: stat.<kind>.<mod>.<item> (kind craftItem, useItem, mineBlock, ...). */
export const statCriterion = (kind, item) => `stat.${kind}.${item.replace(':', '.')}`;

/**
 * The pack's own commands on a fresh world's first join, which the server logs as the bot's
 * ("[<bot>: ...]"; P1 attempts 1 and 2, test/evidence/probe/p1-20261103-a2/server.log lines 20-24).
 * They are allowed once each, within FIRST_JOIN_WINDOW_S of the bot's first join; the two gamerules
 * also at any time (PACK_ANY_TIME). Nothing else is.
 */
export const PACK_FIRST_JOIN = Object.freeze([
    { id: 'gamerule_commandBlockOutput', re: () => /^Game rule commandBlockOutput has been updated to false$/ },
    { id: 'gamerule_sendCommandFeedback', re: () => /^Game rule sendCommandFeedback has been updated to false$/ },
    { id: 'give_bread', re: (bot) => new RegExp(`^Given\\s+\\[Bread\\] \\* 1 to ${esc(bot)}$`) },
    { id: 'give_bundle', re: (bot) => new RegExp(`^Given\\s+\\[Bundle\\] \\* 1 to ${esc(bot)}$`) },
]);
export const FIRST_JOIN_WINDOW_S = 10;
/**
 * The pack re-runs its two gamerules as the bot later on (G3 smoke batches A and B, 2026-11-05: about
 * 2.5 min after the join, as the bot finished collecting logs). The lead allowed exactly these two lines,
 * value false only, at any time (2026-11-05). They are recorded in packRepeats, never as a problem.
 */
export const PACK_ANY_TIME = Object.freeze(PACK_FIRST_JOIN.filter((x) => x.id.startsWith('gamerule_')));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LOG_LINE = /^\[(\d\d):(\d\d):(\d\d)\] \[[^\]]*\/[A-Z]+\](?: \[[^\]]*\])?: (.*)$/;
const secs = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + Number(s);

/**
 * The no_cheat arbiter (G3 plan, arbiter 6): in the log lines of the run, any of these is a problem:
 *   - a command the bot ran, which 1.12 logs as "[<bot>: ...]" (only an op can run one), except the
 *     pack's first-join commands (PACK_FIRST_JOIN, once each, within the window after the first join)
 *     and the pack's two gamerule lines at any time (PACK_ANY_TIME);
 *   - another sender's logged command that names the bot ("[<other>: ... <bot> ...]");
 *   - a console give to the bot ("Given [x] * n to <bot>"), a game mode change or "Opped <bot>".
 * The runner itself gives nothing in G3 (guardConsole refuses give).
 * Returns {problems, packFirstJoin, packRepeats}; packRepeats lists "<id> at hh:mm:ss" for each allowed repeat.
 */
export function cheatProblems(lines, bot, { windowS = FIRST_JOIN_WINDOW_S } = {}) {
    const b = esc(bot);
    const named = new RegExp(`(^|[^A-Za-z0-9_])${b}([^A-Za-z0-9_]|$)`);
    const problems = [];
    const packFirstJoin = [];
    const packRepeats = [];
    const used = new Set();
    let joinedAt = null;
    for (const line of lines) {
        const m = LOG_LINE.exec(String(line).replace(/\r$/, ''));
        if (!m) continue;
        const [, h, mi, s, msg] = m;
        const t = secs(h, mi, s);
        if (joinedAt === null && msg === `${bot} joined the game`) joinedAt = t;
        const admin = /^\[([^\]:]+): (.*)\]$/.exec(msg);
        if (admin && admin[1] === bot) {
            const inWindow = joinedAt !== null && ((t - joinedAt + 86400) % 86400) <= windowS;
            const pack = inWindow && PACK_FIRST_JOIN.find((x) => !used.has(x.id) && x.re(bot).test(admin[2]));
            const repeat = !pack && PACK_ANY_TIME.find((x) => x.re(bot).test(admin[2]));
            if (pack) {
                used.add(pack.id);
                packFirstJoin.push(pack.id);
            } else if (repeat) packRepeats.push(`${repeat.id} at ${h}:${mi}:${s}`);
            else problems.push(`the bot ran a command: ${msg}`);
        } else if (admin && named.test(admin[2])) problems.push(`a logged command names the bot: ${msg}`);
        else if (new RegExp(`^Given\\s+\\[.*\\] \\* \\d+ to ${b}$`).test(msg)) problems.push(`a give to the bot: ${msg}`);
        else if (/game mode/i.test(msg) && named.test(msg)) problems.push(`a game mode change: ${msg}`);
        else if (new RegExp(`^Opped ${b}$`).test(msg)) problems.push(`the bot was opped: ${msg}`);
    }
    return { problems, packFirstJoin, packRepeats };
}

/**
 * The 1.12 death messages ("death.attack.*" and "death.fell.*" in en_us.lang) all start with the
 * player's name and one of these phrases. A mod's own death type that the dedicated server cannot
 * translate is logged as its raw key ("death.attack.<type>"), so that form counts too.
 */
const DEATH_PHRASE = /^(was |died|drowned|blew up|hit the ground|fell |went up in flames|walked into|burned to death|tried to swim in lava|suffocated|starved|withered away|experienced kinetic energy|discovered (the )?floor was lava|didn't want to live)/;

/**
 * The bot's death lines in the log: [{time, msg}]. stat.deaths is the main arbiter (G3 plan, arbiter 5);
 * these lines are the second, independent one, so a death the stat missed still fails survival.
 */
export function deathLines(lines, bot) {
    const out = [];
    const prefix = `${bot} `;
    for (const line of lines) {
        const m = LOG_LINE.exec(String(line).replace(/\r$/, ''));
        if (!m) continue;
        const msg = m[4];
        const rawKey = /\bdeath\.(attack|fell)\.\S+/.test(msg) && msg.includes(bot);
        if (rawKey || (msg.startsWith(prefix) && DEATH_PHRASE.test(msg.slice(prefix.length)))) out.push({ time: `${m[1]}:${m[2]}:${m[3]}`, msg });
    }
    return out;
}

/** The Mindcraft driver's mindcraft_start event in its output ({serverTaskGiver, botState, models, ...}), or null. */
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

/**
 * 1.12's own setblock answers (commands.setblock.success / noChange / outOfWorld), matched against the
 * WHOLE server message after "]: " (#220 review nit: anchored), so a chat line such as "<bot> Block placed"
 * or one that merely contains the words never counts.
 */
const SETBLOCK_ANSWERS = /^(?:Block placed|The block couldn't be placed|Cannot place block outside of the world)$/;
export const isSetblockReply = (line) => SETBLOCK_ANSWERS.test(parseLine(String(line))?.msg ?? String(line).replace(/\r$/, ''));

/** The read-only site preflight (#207 review): `testforblock` air at Y+1 and Y+2 above the marker. Returns [{cell, air, detail}]. */
export async function airAbove(confirm, marker) {
    const above = [];
    for (const dy of [1, 2]) {
        const cell = [marker[0], marker[1] + dy, marker[2]];
        const v = testforblockVerdict(await confirm(`testforblock ${cell.join(' ')} minecraft:air 0`,
            (l) => { const x = testforblockVerdict(l, cell); return x.ok || /^The block at /.test(x.detail ?? ''); }), cell);
        above.push({ cell, air: v.ok, detail: v.ok ? 'air' : v.detail });
    }
    return above;
}

/** The "site not clear" text: each cell above a marker that is not air, with what the server found there. */
export const notClearText = (above) => above.filter((c) => !c.air).map((c) => `${c.cell.join(' ')}: ${c.detail}`).join('; ');

/**
 * (d)'s marker (lead, after smoke round 2): try the candidates in order, each through the same read-only air
 * preflight (airAbove), and take the first whose two cells above are air. Nothing is placed here.
 * Returns {marker, index, tried: [{at, clear, above}]}; marker is null when no candidate is clear.
 */
export async function pickClearMarker(confirm, candidates) {
    const tried = [];
    for (const [index, at] of candidates.entries()) {
        const above = await airAbove(confirm, at);
        const clear = above.every((c) => c.air);
        tried.push({ at, clear, above });
        if (clear) return { marker: at, index, tried };
    }
    return { marker: null, index: null, tried };
}

/** Parse a ";"-separated list of "x,y,z" markers; null if empty or any entry is not "x,y,z". */
export function parseMarkerList(text, parse) {
    const parts = String(text ?? '').split(';').map((x) => x.trim()).filter(Boolean);
    const cells = parts.map((x) => parse(x));
    return parts.length && cells.every(Boolean) ? cells : null;
}

/**
 * Place a task marker (gold block) with the allowlisted `setblock` and confirm it read-only with
 * `testforblock <marker> minecraft:gold_block 0` (#207 review nit). confirm(cmd, done) is the scenario's
 * lateConsole confirm. reply is the setblock answer line itself (smoke batch C+D: the last returned line
 * could be a later chat line). Returns {at, reply, goldBlock, detail}; goldBlock false means the marker is
 * not proven, and the scenario must not count on it.
 */
export async function placeGoldMarker(confirm, marker) {
    const placed = await confirm(`setblock ${marker.join(' ')} minecraft:gold_block`, (l) => l.some(isSetblockReply));
    const reply = placed.find(isSetblockReply) ?? null;
    const v = testforblockVerdict(await confirm(`testforblock ${marker.join(' ')} minecraft:gold_block 0`,
        (l) => { const x = testforblockVerdict(l, marker); return x.ok || /^The block at /.test(x.detail ?? ''); }), marker);
    return { at: marker, reply, goldBlock: v.ok, detail: v.ok ? 'found' : v.detail };
}
