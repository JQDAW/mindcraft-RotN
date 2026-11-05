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
export function requestReplan(agent, modeName, interruptedAction, { now = Date.now(), log = (l) => console.log(l), note = null, due = false } = {}) {
    if (!agent.replan) agent.replan = { modes: {}, interrupted: null, first_at: now, last_at: now };
    const r = agent.replan;
    r.modes[modeName] = (r.modes[modeName] || 0) + 1;
    if (interruptedAction) r.interrupted = interruptedAction;
    if (note) r.notes = [...(r.notes || []).slice(-2), note]; // D3: what happened (the bot's own state only)
    if (due) r.due = true; // D3: a death is worth a prompt even when no action was interrupted
    r.last_at = now;
    log(`[reflex] ${modeName} interrupted '${interruptedAction || 'nothing'}'; re-plan requested (no LLM call now).`);
}

/**
 * Drop a pending request because a new non-mode action started (A4b): that
 * action is a fresh decision, so the request is stale and must not cause a
 * re-plan prompt later.
 */
export function clearReplan(agent, reason, { log = (l) => console.log(l) } = {}) {
    const r = agent.replan;
    if (!r) return false;
    // D3 (#215 nit 4): a note (a death) is still news to the LLM, so it rides on the next prompt;
    // the request itself (and whether it is due) is dropped.
    agent.replan = r.notes?.length ? { modes: {}, interrupted: null, notes: r.notes, first_at: r.first_at, last_at: r.last_at } : null;
    log(`[reflex] re-plan request dropped: ${reason}${agent.replan ? ' (its notes are kept for the next prompt)' : ''}.`);
    return true;
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
    const parts = [];
    if (modes) parts.push(`Reflexes (${modes}) ${what}.`);
    if (r.notes?.length) parts.push(...r.notes);
    parts.push('Check your state and re-plan from here.');
    return parts.join(' ');
}

/**
 * Whether the coalesced re-plan prompt is due (only when not self-prompting,
 * which carries the note itself).
 */
export function replanPromptDue(agent, { now = Date.now(), idle, reflexActive, selfPrompting, lastPromptAt = 0 } = {}) {
    const r = agent.replan;
    if (!r || !(r.interrupted || r.due)) return false;
    if (!idle || reflexActive || selfPrompting) return false;
    if (now - r.last_at < QUIET_MS) return false;
    return now - lastPromptAt >= MIN_GAP_MS;
}
