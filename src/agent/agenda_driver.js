// Drives the agenda (skills-rotn E2) from the agent's update loop: judges the
// steps every TICK_MS from the bot's state (no LLM), points the self-prompter at
// the current step, restarts it if it stopped, and says so in chat. The LLM is
// called only by the self-prompter. Task preemption and resuming come with E3.
import settings from './settings.js';
import * as world from './library/world.js';
import { countItem } from './library/rotn_names.js';
import { itemVariants } from './library/rotn_sources.js';

export const TICK_MS = 2_000;
export const RESTART_BACKOFF_MS = 30_000;

/** What a step's done check may ask about the bot. */
export function agendaState(bot) {
    return {
        // A bare name counts every variant; "pyrotech:rock" counts every rock (rotn-data's ore).
        count: (name) => itemVariants(name).reduce((n, v) => n + countItem(bot, v), 0),
        near: (block) => !!world.getNearestBlock(bot, block, 16),
    };
}

/** The self-prompt goal for a step. */
export function agendaGoal(agenda, step) {
    const n = agenda.steps.indexOf(step) + 1;
    return `RotN agenda, step ${n} of ${agenda.steps.length} (${step.id}): ${step.goal} `
        + 'When this step is done, the agenda moves on by itself.';
}

const othersOnline = (agent) => Object.keys(agent.bot?.players ?? {}).some(n => n !== agent.name);

/**
 * One agenda tick (throttled). Returns what it did, for tests and logs: null (not due or not
 * active), 'paused' (pause_when_empty and nobody else online), 'done', or the current step id.
 */
export function agendaTick(agent, { now = Date.now() } = {}) {
    const agenda = agent.agenda;
    if (!agenda?.active) return null;
    if (now - (agent._agenda_tick_at ?? -Infinity) < TICK_MS) return null;
    agent._agenda_tick_at = now;
    const sp = agent.self_prompter;

    if (settings.pause_when_empty && !othersOnline(agent)) {
        if (sp.isActive()) sp.stop(false);
        agent._agenda_paused = true;
        return 'paused';
    }

    const { step, newlyDone } = agenda.evaluate(agendaState(agent.bot));
    for (const s of newlyDone) agent.openChat(`agenda step ${s.id} done`);
    if (!step) {
        agent.openChat('agenda done');
        agenda.stop();
        if (sp.isActive()) sp.stop(false);
        agent._agenda_step = null;
        return 'done';
    }

    const goal = agendaGoal(agenda, step);
    if (agent._agenda_step !== step.id) {
        agent._agenda_step = step.id;
        agent.openChat(`agenda step ${step.id} started: ${step.short}`);
        sp.prompt = goal; // the self-prompter's next prompt uses it
    }
    // Keep it going: start it, or restart it after it stopped (for example after 3 replies with
    // no command), at most once per RESTART_BACKOFF_MS.
    if (!sp.isActive()) {
        const first = agent._agenda_paused || agent._agenda_restart_at === undefined;
        if (first || now - agent._agenda_restart_at >= RESTART_BACKOFF_MS) {
            agent._agenda_restart_at = now;
            agent._agenda_paused = false;
            sp.start(goal);
        }
    }
    return step.id;
}
