// Drives the agenda (skills-rotn E2) from the agent's update loop: judges the
// steps every TICK_MS from the bot's state (no LLM), points the self-prompter at
// the current step, restarts it if it stopped, and says so in chat. The LLM is
// called only by the self-prompter, and each step gets a bounded share of it
// (#164 review): at most STEP_ATTEMPTS self-prompter runs, restarted after a
// doubling back-off, and at most STEP_LLM_MS of self-prompter time. Then the
// step is stuck: "agenda step <id> stuck: <why>; retry ..." (#463 decision, #468):
// the agenda never pauses on it. The step is retried with a fresh budget after
// STUCK_RETRY.cooldownMs or at the next full day (3 times, then once at each new
// full day); meanwhile the steps that do not need it go on, else food, else the
// open goal (the model's own goal under its window budget, priority.js). A giver's
// !agendaStart retries every stuck step at once. Holds, tasks preempting the
// agenda and its resuming are in priority.js (E3), which calls agendaTick when no
// task and no hold is due.
import settings from './settings.js';
import * as world from './library/world.js';
import { countItem, formatName } from './library/rotn_names.js';
import { itemVariants, toolLevels } from './library/rotn_sources.js';
import { cobbleChoices } from './library/cobble.js';
import { isSturdy, placeableDirt, minutesToSunset, sunsetEstimateMin } from './library/night.js';
import { safeError } from './safe_error.js';
import { heldFoodPoints } from './library/food.js';
import { nearbyHuntable } from './library/hunting.js';
import { nearbyForage } from './library/foraging.js';
import { stillTrapped } from './library/escape.js';
import { hasWeapon, WEAPON } from './library/threats.js';
import { FOOD_RETRY_MS, STUCK_RETRY, RESERVE_LEAD_MIN, FOOD_BEFORE_NIGHT, foodTargetNow, SHELTER_HOLD } from './agenda.js';
import { SHELTER_LEAD_MIN } from './library/night.js';
import { loadRotnData, PACK_VERSION, botName, WILDCARD_META } from '../../packages/rotn-data/index.js';

export const TICK_MS = 2_000;
/** The wait before a step's 2nd self-prompter run; it doubles for each run after that. */
export const BACKOFF_MS = 30_000;
/** Self-prompter runs per step (a run ends when it stops itself, e.g. 3 replies with no command). */
export const STEP_ATTEMPTS = 3;
/** Self-prompter time per step, over all its runs (first_plank cannot be done before C2). */
export const STEP_LLM_MS = 5 * 60_000;
const MAX_TICK_GAP_MS = 10_000; // a stalled update loop does not count as LLM time
// LLM time is saved this often (#164 nit: was 60 s); runs are saved as they start, so a
// crash loop is bounded by the run budget anyway.
export const SAVE_EVERY_MS = 10_000;
/** Soak 10 (W2): a step's autoCraft is run as a skill at most this many times while it stays current. */
export const AUTO_CRAFT = { tries: 2 };

/** #590 review 5: the margin over the longest food backoff and a tick in foodStartMs. */
export const FOOD_START_SLACK_MS = 10_000;
/**
 * #588 nit 1: H3's wait for a picked food run to start: the longest backoff before a food run (the one
 * before its last: BACKOFF_MS doubling per run, stepBudget().attempts runs) plus a tick and
 * FOOD_START_SLACK_MS. #590 review 1 and 2: never below FOOD_BEFORE_NIGHT.startMs (120 s: the backoff
 * clock starts only once a self-prompter loop still finishing a long command is idle), never above
 * half the blocks' window (RESERVE_LEAD_MIN), so the blocks keep their time. From 6 attempts the 300 s
 * cap is below the real backoff (480 s before the sixth run): H3 then hands the window to the blocks
 * before that food run starts, by design (#590 re-review).
 */
export function foodStartMs() {
    const runs = stepBudget().attempts;
    const backoff = BACKOFF_MS * 2 ** Math.max(0, runs - 2) + TICK_MS + FOOD_START_SLACK_MS;
    return Math.min(Math.max(FOOD_BEFORE_NIGHT.startMs, backoff), RESERVE_LEAD_MIN * 60_000 / 2);
}

/** A step's budget; settings.agenda_step_attempts and agenda_step_llm_ms override it. */
export function stepBudget() {
    const n = (v, d) => (Number.isFinite(v) && v > 0 ? v : d);
    return { attempts: n(settings.agenda_step_attempts, STEP_ATTEMPTS), llm_ms: n(settings.agenda_step_llm_ms, STEP_LLM_MS) };
}

const oreNames = new Map();
/** The bot names of a rotn-data ore's members ("logWood": modded RotN trees too); a wildcard is the bare name. */
export function oreMemberNames(ore) {
    if (!oreNames.has(ore)) {
        let members = [];
        try { members = loadRotnData(PACK_VERSION).oreDict(ore) ?? []; } catch { members = []; }
        const bare = new Set(members.filter(m => m.meta == null || m.meta === WILDCARD_META).map(m => botName(m.name)));
        // A bare name counts every variant, so drop its explicit variants (no double count).
        const variants = members.filter(m => m.meta != null && m.meta !== WILDCARD_META && !bare.has(botName(m.name)))
            .map(m => formatName(botName(m.name), m.meta));
        oreNames.set(ore, [...bare, ...new Set(variants)]);
    }
    return oreNames.get(ore);
}

/** What a step's done check may ask about the bot. `clock`: the night routine's NightClock, when there is one. */
export function agendaState(bot, clock = null) {
    return {
        // A bare name counts every variant; "pyrotech:rock" counts every rock (rotn-data's ore).
        count: (name) => itemVariants(name).reduce((n, v) => n + countItem(bot, v), 0),
        countOre: (ore) => oreMemberNames(ore).reduce((n, v) => n + countItem(bot, v), 0),
        near: (block) => !!world.getNearestBlock(bot, block, 16),
        // the cobblestones the held rocks make, most rocks first (G3 round 3 A)
        cobble: () => cobbleChoices(bot),
        // G3 round 6 B: the shelter's blocks held (every cobblestone and stone of the pack), and the
        // minutes of running time to sunset (Infinity when the time is not known).
        shelterBlocks: () => (bot.inventory?.items?.() ?? [])
            .filter(i => isSturdy({ name: i.name, metadata: i.metadata ?? 0 })).reduce((n, i) => n + i.count, 0),
        minutesToSunset: () => (Number.isFinite(bot.time?.timeOfDay) ? minutesToSunset(bot.time.timeOfDay) : Infinity),
        timeOfDay: () => bot.time?.timeOfDay, // #463 decision: a stuck step's retry at the next full day
        // CX23 soak: the minutes the bot is told, with the morning freeze's part still to run.
        sunsetEstimateMin: () => (Number.isFinite(bot.time?.timeOfDay) ? sunsetEstimateMin(bot.time.timeOfDay, clock?.frozenMin?.(Date.now()) ?? 0) : Infinity),
        // #284 review 2: any pickaxe held; the dirt blocks held or made from the dirt piles held.
        hasPickaxe: () => toolLevels(bot, 'pickaxe').length > 0,
        hasWeapon: () => hasWeapon(bot), // the before-night weapon reserve (soak 3)
        // Soak 10 (W1): a weapon with a kill's worth of hits left (the weapon reserve's done).
        weaponReady: () => hasWeapon(bot, { minHits: WEAPON.killHits }),
        dirtBlocks: () => placeableDirt(bot.inventory?.items?.() ?? []),
        // G4 #5: the food level, the hunger value of the safe food held, and the wild animals and
        // ripe wild food near that the bot may take (never what may belong to a player).
        food: () => bot.food,
        // Soak 7 (d): ms since the last death, Infinity when none. #523 nit 1: from the death times
        // (death_report's DeathReporter.deaths), not the spots, so a death at an unknown position counts.
        sinceDeathMs: () => {
            const at = typeof bot.rotnLastDeathAt === 'function' ? bot.rotnLastDeathAt() : null;
            return Number.isFinite(at) ? Date.now() - at : Infinity;
        },
        day: () => bot.time?.day, // the in-game day (the food reserve's runs per day)
        foodHeld: () => heldFoodPoints(bot), // soak 14 (F1): points (hunger + saturation)
        saturation: () => bot.foodSaturation ?? 0,
        huntable: () => { try { return [...new Set(nearbyHuntable(bot, { bases: bot.rotnBases?.() ?? [] }))]; } catch { return []; } },
        // the ripe wild food blocks near that the bot may take (foraging.js; full block names)
        forageable: () => { try { return nearbyForage(bot, { bases: bot.rotnBases?.() ?? [] }); } catch { return []; } },
        // Soak 16 (E4): where a failed escape left the bot trapped (escape.stillTrapped), or null.
        trapped: () => { try { return stillTrapped(bot); } catch { return null; } },
    };
}

/** The self-prompt goal for a step; a step's goalNow(state) names what the bot holds now. */
export function agendaGoal(agenda, step, state = null) {
    const n = agenda.steps.indexOf(step) + 1;
    let text = step.goal;
    if (state && typeof step.goalNow === 'function') {
        try { text = step.goalNow(state, { finished: !!agenda.finished }) || step.goal; } catch { text = step.goal; }
    }
    let when = step.when ?? 'before night';
    if (state && typeof step.whenNow === 'function') { try { when = step.whenNow(state) || when; } catch { /* the plain label */ } }
    // Soak 16 (E4): trapped after a failed escape: the way out first, whatever the step.
    let trap = null;
    try { trap = state?.trapped?.() ?? null; } catch { trap = null; }
    if (trap) text = `You are trapped at ${trap.x}, ${trap.y}, ${trap.z} (no walkable way to open ground): get out first with !goToSurface (it goes on from where you are). Then: ${text}`;
    if (step.reserve) return `RotN agenda, step ${step.id} (${when}): ${text} When you hold enough, the agenda moves on by itself.`;
    return `RotN agenda, step ${n} of ${agenda.steps.length} (${step.id}): ${text} `
        + 'When this step is done, the agenda moves on by itself.';
}

/** The prompt prefixes the agenda and tasks write; a model's !goal may not use them (#174 re-review). */
export const AUTONOMY_PREFIXES = ['RotN agenda, step ', 'Player task '];
export const hasAutonomyPrefix = (prompt) => typeof prompt === 'string'
    && AUTONOMY_PREFIXES.some(p => prompt.trimStart().startsWith(p));

/**
 * Point the self-prompter at the agenda's or a task's goal and remember it as the drivers' own.
 * Whether the running goal is autonomy's is decided by this identity, never by its text (#174
 * re-review: a model !goal that copied the prefix ran unbounded).
 */
export function driveTo(agent, prompt, { start = false } = {}) {
    agent._autonomy_prompt = prompt;
    if (start) agent.self_prompter.start(prompt);
    else agent.self_prompter.prompt = prompt;
}

/** Whether the self-prompter runs the goal a driver set (driveTo), not one a player or the model set. */
export const ownsPrompt = (agent) => agent._autonomy_prompt != null && agent.self_prompter.prompt === agent._autonomy_prompt;

/**
 * Whether the self-prompter runs a goal a task giver typed (!goal with a sender, goal_by): the only
 * self-prompting the agenda and tasks wait for without counting it (#174 review 3).
 */
export const isGiverGoal = (agent) => agent.self_prompter.isActive() && !ownsPrompt(agent) && !!agent.self_prompter.goal_by;

const othersOnline = (agent) => Object.keys(agent.bot?.players ?? {}).some(n => n !== agent.name);

// A chat line; a failed send is logged, never an unhandled rejection (#164 review nit).
export function say(agent, line) {
    try {
        // Normal priority for the chat limit (chat_limit.js): queued when chat is busy, never dropped
        // (harness-ops reads these lines).
        Promise.resolve(agent.openChat(line)).catch(err => console.warn(`[agenda] chat failed: ${safeError(err)}`));
    } catch (err) {
        console.warn(`[agenda] chat failed: ${safeError(err)}`);
    }
}

export const minutes = (ms) => `${Math.round(ms / 6_000) / 10} min`;

/**
 * The agenda state for a tick, with foodRunning: the food reserve's self-prompter run is going now
 * (the per-day cap stops a new run, never the one running: #422 nit).
 */
function tickState(agent) {
    const state = agendaState(agent.bot, agent._night?.clock);
    state.foodRunning = () => agent._agenda_step != null && agent._agenda_step === agent.agenda?.food?.id && !!agent.self_prompter?.isActive?.();
    state.foodStartMs = () => foodStartMs(); // #588 nit 1: H3's wait for its run, from this budget
    // Soak 16 (F2): a step's scripted job between its runs (the step is not due meanwhile), and where its last run
    // found nothing in reach (the model then picks a direction).
    state.jobWaiting = (id) => jobWaiting(agent, id);
    state.jobFoundNone = (id) => jobFoundNone(agent, id);
    return state;
}

/**
 * Soak 16 (F2, Fable S3, the lead): a step whose solution is known gets a scripted body, and the model is the
 * fallback. step.autoJob names a job in AUTO_JOBS: {label, perDay, gapMs, moveOn, ready(agent, state) -> why not
 * or null, run(agent, state) -> {why, none, text}}. The job runs as an action (the hands rule around it); between
 * runs (gapMs) the step is not due (state.jobWaiting), so the other steps go on; a run that found nothing in reach
 * (none) hands the step to the model until the bot is moveOn blocks from there (state.jobFoundNone); after perDay runs
 * in an in-game day, the model as before. agent._agenda_jobs[stepId]: {day, runs, lastAt, lastEnd, noneAt, running}.
 * R (soak 16) adds the shelter_blocks job here.
 */
export const AUTO_JOBS = {
    food: {
        // shortMs (#627 review 7): a run stopped (a reflex, a command) within this does not count toward perDay.
        // maxMs (soak 16 R, the lead's watchdog): FOOD_RUN.day's 4 min and the pickup and re-arm after it.
        label: 'action:foodJob', perDay: 4, gapMs: 3 * 60_000, moveOn: 32, shortMs: 30_000, maxMs: 5 * 60_000,
        ready: (agent, state) => {
            const m = state.minutesToSunset?.() ?? Infinity;
            if (!(m > RESERVE_LEAD_MIN)) return 'not in full daylight (the night routine has food from the before-night window on)';
            return null;
        },
        run: async (agent, state, { foodRun: runFood = null } = {}) => {
            const bot = agent.bot;
            const [{ foodRun: realRun, FOOD_RUN }, { DAY_FOOD }, night] = await Promise.all([import('./library/food_run.js'), import('./library/food.js'), import('./night_routine.js')]);
            const foodRun = runFood ?? realRun;
            const target = foodTargetNow(state, { finished: !!agent.agenda?.finished });
            const held = state.foodHeld?.() ?? 0;
            const need = Math.max(1, (target ?? held) + DAY_FOOD.fill - held);
            const stop = () => {
                const m = state.minutesToSunset?.() ?? Infinity;
                if (!(m > RESERVE_LEAD_MIN)) return 'the before-night window';
                // #627 review 4: a hostile within FOOD_RUN.hostileRange (16), as the sunset run (night_routine.hostileNear).
                try { const mob = night.hostileNear(bot, FOOD_RUN.hostileRange); return mob ? `${mob.name ? `a ${mob.name}` : 'a hostile mob'} within ${FOOD_RUN.hostileRange} blocks` : null; } catch { return null; }
            };
            const r = await foodRun(bot, { ...FOOD_RUN.day, need, stop });
            const why = r?.why ?? 'no result';
            // none: nothing in reach here ('none': the model picks a direction); 'noWeapon' (#627 review 3): nothing ripe
            // and no weapon to hunt the animals in sight with (the model makes one, or looks for wild food elsewhere).
            const none = /^no ripe wild food, and no weapon/.test(why) ? 'noWeapon' : /^no ripe wild food and no animal to hunt/.test(why) ? 'none' : null;
            return { why, none, text: `+${r?.points ?? 0} food points in ${Math.round((r?.ms ?? 0) / 1000)} s (${why})` };
        },
    },
};
/**
 * Soak 16 (R5, Fable S3): the shelter reserve's scripted body, with a pickaxe (sturdy blocks): cobblestone from the
 * rocks held (4 of one kind each), then, still short, a rock collect bounded to collectMs (skills.collectBlock: loose
 * piles within 48 first, then stone open to the air with a way out, never into a hole), then cobblestone again.
 * Nothing gained and nothing collected: nothing in reach here (the model). Without a pickaxe (a dirt shelter): the model.
 */
AUTO_JOBS.shelter_blocks = {
    label: 'action:shelterBlocks', perDay: 2, gapMs: 60_000, moveOn: 32, shortMs: 30_000, maxMs: 4 * 60_000, collectMs: 3 * 60_000,
    ready: (agent, state) => {
        if (!state.hasPickaxe?.()) return 'no pickaxe (a dirt shelter: the model gathers dirt piles)';
        // #630 review 7, re-review 3 (the lead): a run must end before the night routine starts (SHELTER_LEAD_MIN before
        // sunset): it needs its maxMs + 1 min more than that (6 + 4 + 1 = 11 min before sunset).
        const m = state.minutesToSunset?.() ?? Infinity;
        if ((m - SHELTER_LEAD_MIN) * 60_000 < AUTO_JOBS.shelter_blocks.maxMs + 60_000) return `too close to dusk (${Math.round(m * 10) / 10} min to sunset; the night routine starts at ${SHELTER_LEAD_MIN})`;
        return null;
    },
    run: async (agent, state, { craft = null, collect = null } = {}) => {
        const bot = agent.bot;
        const skills = await import('./library/skills.js');
        const have = () => state.shelterBlocks?.() ?? 0;
        const need = () => Math.max(0, SHELTER_HOLD - have());
        const doCraft = craft ?? ((b, n) => skills.craftRecipe(b, 'cobblestone', n));
        // #630 review 8: the job's collect is no model command, so E's post-condition (actions.js POST_ESCAPE) does not
        // run after it; its own rule (loose rocks first, only stone that keeps a walkable way out) keeps it out of holes.
        const doCollect = collect ?? ((b, n) => skills.collectBlock(b, 'pyrotech:rock', n, null, 64, { ...skills.COLLECT_LIMITS, totalMs: AUTO_JOBS.shelter_blocks.collectMs }));
        const craftNow = async () => {
            const c = state.cobble?.()?.[0];
            const n = c ? Math.min(Math.floor(c.have / 4), need()) : 0;
            if (n > 0) { try { await doCraft(bot, n); } catch (err) { console.warn(`[agenda] shelter blocks: the cobblestone craft failed: ${safeError(err)}`); } }
            return n;
        };
        const start = have();
        let collected = null;
        const t0 = Date.now();
        if (need() > 0) await craftNow();
        if (need() > 0 && !bot.interrupt_code) {
            collected = !!(await doCollect(bot, need() * 4));
            if (need() > 0 && !bot.interrupt_code) await craftNow();
        }
        const gained = have() - start;
        // #630 review 6: "none found" only when the collect ended for lack of blocks (bot.rotnCollectEnd.reason
        // 'none'), not on its time limit or a target out of reach.
        const end = (bot.rotnCollectEnd?.at ?? 0) >= t0 ? bot.rotnCollectEnd : null;
        const why = need() <= 0 ? 'enough' : bot.interrupt_code ? 'stopped'
            : collected === false && gained <= 0 && end?.reason === 'none' ? 'no loose rocks within 48 and no stone open to the air with a way out'
            : end?.reason === 'capped' ? 'the stone search was cut short (too many to check)'
            : end?.reason === 'time' ? 'the collect\'s time limit' : end?.lastWalkFailed ? 'a target out of reach' : 'short';
        return { why, none: why.startsWith('no loose rocks') ? 'none' : null, text: `+${gained} shelter blocks (${have()} of ${SHELTER_HOLD}; ${why})` };
    },
};

/** Soak 16 (R, the lead): a job running past its maxMs + marginMs is stale (a hung action): it frees the agenda. */
export const JOB_WATCHDOG = { marginMs: 60_000 };
function staleCheck(agent, id, j, now = Date.now()) {
    if (!j?.running) return false;
    const spec = AUTO_JOBS[id];
    const limit = (spec?.maxMs ?? Infinity) + JOB_WATCHDOG.marginMs;
    if (!(now - (j.startedAt ?? now) > limit)) return false;
    Object.assign(j, { running: false, token: (j.token ?? 0) + 1, lastAt: now, lastEnd: 'stale', lastNone: false, noneKind: null, noneAt: null });
    say(agent, `agenda step ${id}: the scripted job is stale (running over ${Math.round(limit / 1000)} s): stopping it; the agenda goes on without it`);
    // #630 review 2: the hung action is stopped too (else the next run waits on it while it "executes").
    if (agent.actions?.executing && agent.actions.currentActionLabel === spec?.label) {
        try { Promise.resolve(agent.actions.stop?.()).catch(() => {}); } catch { /* best effort */ }
    }
    return true;
}
const jobOf = (agent, id) => (agent?._agenda_jobs ?? {})[id] ?? null;
function jobWaiting(agent, id, now = Date.now()) {
    const j = jobOf(agent, id);
    return !!j && !j.running && j.lastEnd != null && !j.lastNone && now - j.lastAt < (AUTO_JOBS[agent.agenda?.steps?.find?.(s => s.id === id)?.autoJob ?? id]?.gapMs ?? 0);
}
/** Where the last run found nothing in reach: its kind ('none' | 'noWeapon') while the bot is still there, else null. */
function jobFoundNone(agent, id) {
    const j = jobOf(agent, id);
    const here = agent?.bot?.entity?.position;
    const spec = AUTO_JOBS[id];
    return j?.noneAt && here && here.distanceTo(j.noneAt) < (spec?.moveOn ?? 32) ? (j.noneKind ?? 'none') : null;
}
/** #627 review 2: the step whose job runs now, or null: the agenda keeps it current until the job ends. */
export function runningJob(agent, now = Date.now()) {
    for (const [id, j] of Object.entries(agent?._agenda_jobs ?? {})) if (j?.running && !staleCheck(agent, id, j, now)) return id;
    return null;
}

/**
 * The step's scripted job (AUTO_JOBS[step.autoJob]): the step id while it runs (no model call), else null (the model
 * gets the step's goal: nothing in reach here, the day's runs spent, or not ready). `jobs` and `now` are for tests.
 */
export function autoJobTick(agent, step, state, { jobs = AUTO_JOBS, now = Date.now() } = {}) {
    const spec = step?.autoJob ? jobs[step.autoJob] : null;
    if (!spec || typeof agent.actions?.runAction !== 'function') return null;
    const all = agent._agenda_jobs ??= {};
    const j = all[step.id] ??= { day: null, runs: 0, lastAt: -Infinity, lastEnd: null, lastNone: false, noneAt: null, noneKind: null, running: false };
    if (j.running && !staleCheck(agent, step.id, j, now)) return step.id;
    const day = state.day?.() ?? Math.floor(now / (20 * 60_000));
    if (j.day !== day) Object.assign(j, { day, runs: 0, waitSince: null });
    // #630 re-review 2: the wait on another action counts from when it began: cleared whenever nothing runs.
    if (!agent.actions.executing) j.waitSince = null;
    if (j.runs >= spec.perDay) return null; // the model, as before the job
    // Nothing in reach here: the model picks a direction (or, with no weapon, makes one: once armed the job runs again).
    if (j.noneAt && agent.bot?.entity?.position?.distanceTo(j.noneAt) < spec.moveOn && !(j.noneKind === 'noWeapon' && state.hasWeapon?.())) return null;
    if (now - j.lastAt < spec.gapMs) return null;
    let notReady = null;
    try { notReady = spec.ready?.(agent, state) ?? null; } catch (err) { notReady = safeError(err); }
    if (notReady) return null;
    // #627 review 1: the job would run but another action is running: wait for it (the step id: no model run is started
    // for food, and none is counted against FOOD_DAY_RUNS); the next tick starts the job. #630 review 2: never longer
    // than the job's own maxMs + the watchdog's margin (an action that never ends): then the model, as before the job.
    if (agent.actions.executing) {
        j.waitSince ??= now;
        if (now - j.waitSince <= (spec.maxMs ?? Infinity) + JOB_WATCHDOG.marginMs) return step.id;
        return null;
    }
    j.waitSince = null;
    j.runs++;
    j.running = true;
    j.lastAt = now;
    const sp = agent.self_prompter;
    if (sp?.isActive?.() && ownsPrompt(agent)) { sp.stop(false); agent._agenda_paused = true; }
    say(agent, `agenda step ${step.id}: the scripted job (run ${j.runs} of ${spec.perDay} today)`);
    let result = null, stopped = false;
    const started = Date.now();
    j.startedAt = now;
    const token = j.token = (j.token ?? 0) + 1;
    Promise.resolve(agent.actions.runAction(spec.label, async () => { result = await spec.run(agent, state); }))
        .then((ret) => { stopped = !!ret?.interrupted || result?.why === 'stopped'; })
        .catch(err => { result = { why: safeError(err), none: null, text: `failed: ${safeError(err)}` }; })
        .finally(() => {
            if (j.token !== token) return; // the watchdog has called it stale: a later run owns the state
            j.running = false;
            j.lastAt = Date.now();
            j.lastEnd = result?.why ?? (stopped ? 'stopped' : 'no result');
            j.lastNone = !!result?.none;
            j.noneKind = result?.none ?? null;
            j.noneAt = result?.none ? (agent.bot?.entity?.position?.clone?.() ?? null) : null;
            // #627 review 7 (the lead): a run stopped (a reflex, a command) within shortMs is not counted; the gap holds.
            const short = stopped && j.lastAt - started < (spec.shortMs ?? 0);
            if (short) j.runs = Math.max(0, j.runs - 1);
            const then = result?.none === 'noWeapon' ? '; no weapon: the model makes one' : result?.none ? '; the model picks a direction' : short ? '; stopped early: not counted' : '';
            say(agent, `agenda step ${step.id}: the scripted job ended: ${result?.text ?? j.lastEnd}${then}`);
        });
    return step.id;
}

/**
 * One agenda tick (throttled). Returns what it did, for tests and logs: null (not due or not
 * active), 'paused' (pause_when_empty and nobody else online), 'yield' (someone else's self-prompting
 * or a paused conversation), 'done', 'stuck', or the current step id; null too when nothing is
 * runnable (every step left waits on a stuck one): agent._agenda_open_goal then holds the open goal.
 */
export function agendaTick(agent, { now = Date.now() } = {}) {
    const agenda = agent.agenda;
    // A stuck step no longer pauses the agenda (#463 decision, STUCK_RETRY): it stays active.
    if (!agenda?.active && !agenda?.finished) { agent._agenda_open_goal = agent._agenda_open_key = null; return null; }
    if (now - (agent._agenda_tick_at ?? -Infinity) < TICK_MS) return null;
    const last = agent._agenda_tick_at;
    agent._agenda_tick_at = now;
    const sp = agent.self_prompter;
    // "agenda done": only the reserves run (G3 round 6 B, G4 #5), and otherwise nothing is touched
    // (the model's own goal, a giver's goal), as before.
    if (!agenda.active && !agenda.anyReserveWanted(tickState(agent))) {
        // #579 re-review nit: no step is current here, so the next weapon reserve gets fresh craft tries.
        agent._agenda_auto_step = null;
        if (agenda.isReserveId(agent._agenda_step)) {
            if (sp.isActive() && ownsPrompt(agent)) sp.stop(false);
            agent._agenda_step = null;
        }
        // Soak 4 (#478): a finished agenda hands over to the standing goal (the model's own goal,
        // priority.js modelGoalTick, one budget window per in-game day).
        if (agenda.finished) {
            const state = tickState(agent);
            agent._agenda_open_goal = agenda.standingGoal(state, { shelter: agent._night?.lastShelter ?? null });
            agent._agenda_open_key = agenda.standingKey(state, now);
        } else {
            agent._agenda_open_goal = agent._agenda_open_key = null;
        }
        return null;
    }

    if (settings.pause_when_empty && !othersOnline(agent)) {
        if (sp.isActive()) sp.stop(false);
        agent._agenda_paused = true;
        return 'paused';
    }

    // A goal a task giver typed, or self-prompting a bot-to-bot conversation paused: the agenda
    // waits, counts none of it against the step and never stops it as stuck, and resumes
    // afterwards without a new run (#164 nits). Any other goal (the model's own) is taken over
    // below and counts (#174 review 3).
    if (isGiverGoal(agent) || sp.isPaused?.()) {
        agent._agenda_paused = true;
        return 'yield';
    }

    // The self-prompter's time since the last tick goes to the step it was pointed at.
    if (agent._agenda_step && sp.isActive() && last !== undefined) {
        agenda.addLlmTime(agent._agenda_step, Math.min(now - last, MAX_TICK_GAP_MS));
        agent._agenda_saved_at ??= last; // the first counted tick (#164 nit: `?? last` alone never saved)
        if (now - agent._agenda_saved_at >= SAVE_EVERY_MS) {
            agenda.save();
            agent._agenda_saved_at = now;
        }
    }

    const state = tickState(agent);
    // #627 review 2: while a step's scripted job runs, that step stays current (the model is not started on the next
    // step over the job, whose own commands would stop it; the food job fills to the reserve + 2 before it ends).
    const busy = runningJob(agent, now);
    if (busy) return busy;
    const { step, newlyDone, retried = [], waiting = false } = agenda.evaluate(state);
    // #463 decision: each retry of a stuck step, with its fresh budget, is said.
    for (const r of retried) {
        say(agent, r.capped ? `agenda step ${r.id} retried (${r.retry}, at a new full day): a fresh budget`
            : `agenda step ${r.id} retried (${r.retry} of ${STUCK_RETRY.max}): a fresh budget`);
    }
    // One line for the steps done in this tick (G3 round 4 C+D: an inventory left over from an
    // earlier run completed all 11 steps at once, and 12 lines in one second got the bot kicked
    // for spam). One step keeps the "agenda step <id> done" line the harness reads.
    if (newlyDone.length === 1) say(agent, `agenda step ${newlyDone[0].id} done`);
    else if (newlyDone.length > 1) say(agent, `agenda steps done: ${newlyDone.map(s => s.id).join(', ')}`);
    if (!step && waiting) {
        // #468 review 1: nothing runnable (every step left waits on a stuck one, no reserve wanted):
        // null, and the priority stack runs the open goal as the model's own goal (modelGoalTick),
        // under the model-goal LLM budget, until a retry is due (agenda.retryDue).
        if (agent._agenda_step && sp.isActive() && ownsPrompt(agent)) sp.stop(false);
        agent._agenda_step = null;
        agent._agenda_auto_step = null; // #579 re-review nit: as above
        const open = agenda.openGoal(state);
        // #469 review: in open-goal mode the agenda still says that it resumed after a task, or after
        // a restart, in the forms the scenarios read ("agenda resumed: <id>"; the restart suffix).
        const waits = agenda.steps.find(s => agenda.isWaiting(s.id));
        if (waits && (agent._agenda_preempted || agenda.loadedActive === true)) {
            const resumed = !!agent._agenda_preempted;
            agent._agenda_preempted = false;
            agenda.loadedActive = false;
            say(agent, resumed ? `agenda resumed: ${waits.id}` : `agenda step ${waits.id} started: ${waits.short}, waiting for its retry (resumed after a restart)`);
        }
        if (open && agent._agenda_open_goal == null) say(agent, `agenda open goal: step ${agenda.steps.find(s => agenda.isWaiting(s.id))?.id} waits; self-prompting on gathering for it`);
        agent._agenda_open_goal = open;
        agent._agenda_open_key = open ? agenda.openGoalKey() : null;
        return null;
    }
    agent._agenda_open_goal = agent._agenda_open_key = null;
    if (!step) {
        say(agent, 'agenda done');
        agenda.finish();
        if (sp.isActive()) sp.stop(false);
        agent._agenda_step = null;
        return 'done';
    }

    // Soak 10 (W2): a step that can craft what it asks for now (the weapon reserve's club from 2 logs)
    // crafts it as a skill: no model call. A craft that did not end the step leaves it to the model.
    const auto = autoCraftTick(agent, step, state) ?? autoJobTick(agent, step, state, { now });
    if (auto) return auto;

    const goal = agendaGoal(agenda, step, state);
    if (agent._agenda_step !== step.id) {
        const prev = agent._agenda_step;
        agent._agenda_step = step.id;
        agent._agenda_stopped_at = undefined;
        // After a task (E3) the agenda says it resumed, not that the step started anew; so does
        // the step the before-night reserve interrupted (G3 round 6 B), when the reserve is done.
        const fromReserve = agenda.isReserveId(prev) && agent._agenda_before_reserve === step.id;
        if (step.reserve && !agenda.isReserveId(prev)) agent._agenda_before_reserve = prev;
        const resumed = agent._agenda_preempted || fromReserve;
        agent._agenda_preempted = false;
        // The first step after a process restart (agenda.json said active) is not a new start (G4
        // #11 prep): its done steps stay done and its spent runs are kept. The line keeps the
        // "agenda step <id> started: " form the harness parses (g3-task-preempts-agenda agendaActive).
        const afterRestart = agenda.loadedActive === true;
        agenda.loadedActive = false;
        say(agent, resumed ? `agenda resumed: ${step.id}`
            : `agenda step ${step.id} started: ${step.short}${afterRestart ? ' (resumed after a restart)' : ''}`);
        driveTo(agent, goal); // the self-prompter's next prompt uses it
        // A run still going from the step before now works on this one: it is this step's run
        // (#164 nit: it was not counted, so a step could get one run more than its budget).
        if (sp.isActive()) agenda.recordAttempt(step.id);
    } else if (sp.isActive() && !ownsPrompt(agent)) {
        // The model's own goal (or one restored after a restart, whose giver is unknown): the step
        // takes the running loop over, and the run counts against it (#174 review 3).
        driveTo(agent, goal);
        agenda.recordAttempt(step.id);
    } else if (ownsPrompt(agent) && agent._autonomy_prompt !== goal) {
        // The step's goal names what the bot holds now (the cobblestone its rocks make): the next
        // prompt uses the new text; not a new run (#233 review 2).
        driveTo(agent, goal);
    }

    // The step's budget: spent means stuck, and the agenda pauses (no more LLM calls for it).
    const budget = stepBudget();
    const spent = agenda.spentOn(step.id);
    let why = null;
    if (spent.llm_ms >= budget.llm_ms) why = `${minutes(spent.llm_ms)} of self-prompting`;
    else if (!sp.isActive() && spent.attempts >= budget.attempts) why = `${spent.attempts} self-prompter runs`;
    if (why && step.reserve) {
        // A reserve does not pause the agenda: the shelter crafts what it can at dusk; food is asked
        // again after FOOD_RETRY_MS (G4 #5).
        if (sp.isActive()) sp.stop(false);
        agenda.reserveStuck(step.id);
        agent._agenda_step = null;
        // Soak 5 (Fix H): the weapon asked by day (before food) is off while food stays short.
        // #587 nit 6: with the logs for a club held (soak 11 E1) the window is that one, before night too:
        // by day it is off until the dusk (#587 nit 7), at dusk until the night.
        let window = null, dusk = false;
        try { window = step.id === agenda.weapon?.id ? step.whenNow?.(state) ?? null : null; } catch { window = null; }
        try { const m = state.minutesToSunset?.() ?? Infinity; dusk = m > 0 && m <= RESERVE_LEAD_MIN; } catch { dusk = false; }
        const until = step.id === agenda.food?.id ? `for ${Math.round(FOOD_RETRY_MS / 60_000)} min`
            : window === 'no weapon, before food' ? 'while food is short (food first)'
            : window === 'no weapon, logs held' && !dusk ? 'until the dusk' : 'until the night';
        say(agent, `agenda step ${step.id} stuck: ${why}; going on without it ${until}`);
        return 'stuck';
    }
    if (why) {
        // #463 decision: an autonomous bot never idles here. The step waits for a retry with a fresh
        // budget (STUCK_RETRY: cooldownMs or the next full day, at most max), and the agenda goes on
        // with the steps that do not need it, else food and the shelter's blocks.
        if (sp.isActive()) sp.stop(false);
        const e = agenda.markStuck(step.id, why, state);
        agent._agenda_step = null;
        say(agent, e.capped
            ? `agenda step ${step.id} stuck: ${why}; its ${STUCK_RETRY.max} retries are spent: one retry at each new full day; going on with the steps that do not need it`
            : `agenda step ${step.id} stuck: ${why}; retry ${e.retries + 1} of ${STUCK_RETRY.max} in ${Math.round(STUCK_RETRY.cooldownMs / 60_000)} min or at the next full day; going on with the steps that do not need it`);
        return 'stuck';
    }

    // Keep it going: start it, or restart it after it stopped, after BACKOFF_MS doubling per run.
    // Resuming after a pause (pause_when_empty, an E3 hold or a task) is not a new run.
    // A stopped loop still finishing its command is waited for (E3: the safe checkpoint).
    if (!sp.isActive() && !sp.loop_active) {
        const resuming = !!agent._agenda_paused;
        if (agent._agenda_stopped_at === undefined) agent._agenda_stopped_at = now;
        const wait = resuming || spent.attempts === 0 ? 0 : BACKOFF_MS * 2 ** (spent.attempts - 1);
        if (now - agent._agenda_stopped_at >= wait) {
            if (!resuming || spent.attempts === 0) agenda.recordAttempt(step.id);
            agent._agenda_paused = false;
            agent._agenda_stopped_at = undefined;
            driveTo(agent, goal, { start: true });
        }
    }
    return step.id;
}

/**
 * Soak 10 (W2): step.autoCraft ({item, ready(state)}) crafts its item as a skill (skills.craftRecipe)
 * when ready, at most AUTO_CRAFT.tries times while the step stays current, never over an action
 * that is running (the next tick tries). Returns the step id while its craft runs, else null (the
 * step goes on as usual: the model gets its goal). `craft` is for tests.
 */
export function autoCraftTick(agent, step, state, { craft = null, rearmAfter = null } = {}) {
    const a = step?.autoCraft;
    const tries = agent._agenda_auto ??= {};
    // #579 review 1: the step is tracked before anything else, so another step in between gives the
    // next weapon reserve fresh tries (it was per process: after 2 crafts, never again until a restart).
    if (agent._agenda_auto_step !== step?.id) { agent._agenda_auto_step = step?.id ?? null; if (step?.id != null) tries[step.id] = 0; }
    if (!a) return null;
    const label = `action:craftRecipe:${a.item}`;
    if (agent.actions?.executing) return agent.actions.currentActionLabel === label ? step.id : null;
    let ready = false;
    try { ready = !!a.ready(state); } catch { ready = false; }
    if (!ready || (tries[step.id] ?? 0) >= AUTO_CRAFT.tries || typeof agent.actions?.runAction !== 'function') return null;
    tries[step.id] = (tries[step.id] ?? 0) + 1;
    const sp = agent.self_prompter;
    // #579 nit 2: the run this stops is no run of the step it served: it resumes after the craft as
    // after any pause (no recordAttempt, no backoff).
    if (sp?.isActive?.() && ownsPrompt(agent)) { sp.stop(false); agent._agenda_paused = true; }
    // agent._agenda_step is left as it is: a craft that did not end the step hands it to the model as usual.
    say(agent, `agenda step ${step.id}: crafting ${formatName(a.item)} (try ${tries[step.id]} of ${AUTO_CRAFT.tries})`);
    const run = craft ?? (async (bot, item) => (await import('./library/skills.js')).craftRecipe(bot, item, 1));
    // #584 nit 6: a crafted weapon goes to the off hand at once (in the inventory a day death drops it).
    const rearm = rearmAfter ?? (async (bot) => (await import('./library/skills.js')).rearmWeapon(bot));
    const craftAndRearm = async () => {
        const r = await run(agent.bot, a.item);
        try { await rearm(agent.bot); } catch (err) { console.warn(`[agenda] after crafting ${a.item}: ${safeError(err)}`); }
        return r;
    };
    Promise.resolve(agent.actions.runAction(label, craftAndRearm))
        .catch(err => console.warn(`[agenda] crafting ${a.item}: ${safeError(err)}`));
    return step.id;
}
