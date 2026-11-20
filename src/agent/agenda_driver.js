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
import { heldFoodHunger } from './library/food.js';
import { nearbyHuntable } from './library/hunting.js';
import { nearbyForage } from './library/foraging.js';
import { hasWeapon } from './library/threats.js';
import { FOOD_RETRY_MS, STUCK_RETRY } from './agenda.js';
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
        dirtBlocks: () => placeableDirt(bot.inventory?.items?.() ?? []),
        // G4 #5: the food level, the hunger value of the safe food held, and the wild animals and
        // ripe wild food near that the bot may take (never what may belong to a player).
        food: () => bot.food,
        day: () => bot.time?.day, // the in-game day (the food reserve's runs per day)
        foodHeld: () => heldFoodHunger(bot),
        huntable: () => { try { return [...new Set(nearbyHuntable(bot, { bases: bot.rotnBases?.() ?? [] }))]; } catch { return []; } },
        // the ripe wild food blocks near that the bot may take (foraging.js; full block names)
        forageable: () => { try { return nearbyForage(bot, { bases: bot.rotnBases?.() ?? [] }); } catch { return []; } },
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
    return state;
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
        let byDay = false;
        try { byDay = step.id === agenda.weapon?.id && step.whenNow?.(state) !== 'before night'; } catch { byDay = false; }
        const until = step.id === agenda.food?.id ? `for ${Math.round(FOOD_RETRY_MS / 60_000)} min` : byDay ? 'while food is short (food first)' : 'until the night';
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
