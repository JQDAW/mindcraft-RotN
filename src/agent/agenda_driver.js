// Drives the agenda (skills-rotn E2) from the agent's update loop: judges the
// steps every TICK_MS from the bot's state (no LLM), points the self-prompter at
// the current step, restarts it if it stopped, and says so in chat. The LLM is
// called only by the self-prompter, and each step gets a bounded share of it
// (#164 review): at most STEP_ATTEMPTS self-prompter runs, restarted after a
// doubling back-off, and at most STEP_LLM_MS of self-prompter time. Then the
// step is stuck: "agenda step <id> stuck: <why>", and the agenda pauses until a
// giver types !agendaStart. Holds, tasks preempting the agenda and its resuming
// are in priority.js (E3), which calls agendaTick when no task and no hold is due.
import settings from './settings.js';
import * as world from './library/world.js';
import { countItem, formatName } from './library/rotn_names.js';
import { itemVariants } from './library/rotn_sources.js';
import { safeError } from './safe_error.js';
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

/** What a step's done check may ask about the bot. */
export function agendaState(bot) {
    return {
        // A bare name counts every variant; "pyrotech:rock" counts every rock (rotn-data's ore).
        count: (name) => itemVariants(name).reduce((n, v) => n + countItem(bot, v), 0),
        countOre: (ore) => oreMemberNames(ore).reduce((n, v) => n + countItem(bot, v), 0),
        near: (block) => !!world.getNearestBlock(bot, block, 16),
    };
}

/** The self-prompt goal for a step. */
export function agendaGoal(agenda, step) {
    const n = agenda.steps.indexOf(step) + 1;
    return `RotN agenda, step ${n} of ${agenda.steps.length} (${step.id}): ${step.goal} `
        + 'When this step is done, the agenda moves on by itself.';
}

/** Whether a self-prompt is the agenda's or a task's own (E3); any other is a player's or the model's !goal. */
export const isAutonomyPrompt = (prompt) => typeof prompt === 'string'
    && (prompt.startsWith('RotN agenda, step ') || prompt.startsWith('Player task '));

/**
 * Whether the self-prompter runs a goal a task giver typed (!goal with a sender, goal_by): the only
 * self-prompting the agenda and tasks wait for without counting it (#174 review 3).
 */
export const isGiverGoal = (sp) => sp.isActive() && !isAutonomyPrompt(sp.prompt) && !!sp.goal_by;

const othersOnline = (agent) => Object.keys(agent.bot?.players ?? {}).some(n => n !== agent.name);

// A chat line; a failed send is logged, never an unhandled rejection (#164 review nit).
export function say(agent, line) {
    try {
        Promise.resolve(agent.openChat(line)).catch(err => console.warn(`[agenda] chat failed: ${safeError(err)}`));
    } catch (err) {
        console.warn(`[agenda] chat failed: ${safeError(err)}`);
    }
}

export const minutes = (ms) => `${Math.round(ms / 6_000) / 10} min`;

/**
 * One agenda tick (throttled). Returns what it did, for tests and logs: null (not due or not
 * active), 'paused' (pause_when_empty and nobody else online), 'yield' (someone else's self-prompting
 * or a paused conversation), 'done', 'stuck', or the current step id.
 */
export function agendaTick(agent, { now = Date.now() } = {}) {
    const agenda = agent.agenda;
    if (!agenda?.active) return null;
    if (now - (agent._agenda_tick_at ?? -Infinity) < TICK_MS) return null;
    const last = agent._agenda_tick_at;
    agent._agenda_tick_at = now;
    const sp = agent.self_prompter;

    if (settings.pause_when_empty && !othersOnline(agent)) {
        if (sp.isActive()) sp.stop(false);
        agent._agenda_paused = true;
        return 'paused';
    }

    // A goal a task giver typed, or self-prompting a bot-to-bot conversation paused: the agenda
    // waits, counts none of it against the step and never stops it as stuck, and resumes
    // afterwards without a new run (#164 nits). Any other goal (the model's own) is taken over
    // below and counts (#174 review 3).
    if (isGiverGoal(sp) || sp.isPaused?.()) {
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

    const { step, newlyDone } = agenda.evaluate(agendaState(agent.bot));
    for (const s of newlyDone) say(agent, `agenda step ${s.id} done`);
    if (!step) {
        say(agent, 'agenda done');
        agenda.stop();
        if (sp.isActive()) sp.stop(false);
        agent._agenda_step = null;
        return 'done';
    }

    const goal = agendaGoal(agenda, step);
    if (agent._agenda_step !== step.id) {
        agent._agenda_step = step.id;
        agent._agenda_stopped_at = undefined;
        // After a task (E3) the agenda says it resumed, not that the step started anew.
        const resumed = agent._agenda_preempted;
        agent._agenda_preempted = false;
        say(agent, resumed ? `agenda resumed: ${step.id}` : `agenda step ${step.id} started: ${step.short}`);
        sp.prompt = goal; // the self-prompter's next prompt uses it
        // A run still going from the step before now works on this one: it is this step's run
        // (#164 nit: it was not counted, so a step could get one run more than its budget).
        if (sp.isActive()) agenda.recordAttempt(step.id);
    } else if (sp.isActive() && !isAutonomyPrompt(sp.prompt)) {
        // The model's own goal (or one restored after a restart, whose giver is unknown): the step
        // takes the running loop over, and the run counts against it (#174 review 3).
        sp.prompt = goal;
        agenda.recordAttempt(step.id);
    }

    // The step's budget: spent means stuck, and the agenda pauses (no more LLM calls for it).
    const budget = stepBudget();
    const spent = agenda.spentOn(step.id);
    let why = null;
    if (spent.llm_ms >= budget.llm_ms) why = `${minutes(spent.llm_ms)} of self-prompting`;
    else if (!sp.isActive() && spent.attempts >= budget.attempts) why = `${spent.attempts} self-prompter runs`;
    if (why) {
        if (sp.isActive()) sp.stop(false);
        agenda.markStuck(step.id, why);
        agent._agenda_step = null;
        say(agent, `agenda step ${step.id} stuck: ${why}; agenda paused`);
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
            sp.start(goal);
        }
    }
    return step.id;
}
