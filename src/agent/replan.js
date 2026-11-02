// Re-plan requests from reflexes (skills-rotn A4, PLAN priority 1: reflexes
// run every tick without the LLM).
//
// Upstream, every mode action stopped the self-prompt loop and, when it had
// interrupted an action, prompted the LLM at once ("Respond accordingly").
// During a fight or an invasion that is an LLM call per reflex. Now a reflex
// only records a re-plan request here and logs one line. The LLM hears about
// it at the next decision point:
// - while self-prompting, the next self-prompt carries the note;
// - otherwise one coalesced re-plan prompt is sent once the bot has been
//   quiet for QUIET_MS, at most once per MIN_GAP_MS.

export const QUIET_MS = 5_000;
export const MIN_GAP_MS = 60_000;

/** Record that a reflex (mode) interrupted `interruptedAction`. No LLM call. */
export function requestReplan(agent, modeName, interruptedAction, { now = Date.now(), log = (l) => console.log(l) } = {}) {
    if (!agent.replan) agent.replan = { modes: {}, interrupted: null, first_at: now, last_at: now };
    const r = agent.replan;
    r.modes[modeName] = (r.modes[modeName] || 0) + 1;
    if (interruptedAction) r.interrupted = interruptedAction;
    r.last_at = now;
    log(`[reflex] ${modeName} interrupted '${interruptedAction || 'nothing'}'; re-plan requested (no LLM call now).`);
}

export function hasReplan(agent) {
    return !!agent.replan;
}

/** The note for the LLM, and clear the request. Null when there is none. */
export function takeReplanNote(agent) {
    const r = agent.replan;
    if (!r) return null;
    agent.replan = null;
    const modes = Object.entries(r.modes).map(([m, n]) => (n > 1 ? `${m} x${n}` : m)).join(', ');
    const what = r.interrupted ? `interrupted '${r.interrupted}'` : 'ran';
    return `Reflexes (${modes}) ${what}. Check your state and re-plan from here.`;
}

/**
 * Whether the coalesced re-plan prompt is due (only when not self-prompting,
 * which carries the note itself).
 */
export function replanPromptDue(agent, { now = Date.now(), idle, reflexActive, selfPrompting, lastPromptAt = 0 } = {}) {
    const r = agent.replan;
    if (!r || !r.interrupted) return false;
    if (!idle || reflexActive || selfPrompting) return false;
    if (now - r.last_at < QUIET_MS) return false;
    return now - lastPromptAt >= MIN_GAP_MS;
}
