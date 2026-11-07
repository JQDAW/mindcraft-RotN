// skills-rotn: no chat-spam loop from reflexes (lead, low priority, after G3 round 9). Identical
// reflex lines repeated in chat: "I'm dying!" 12 times in 5 min (g3a-20261105-r2), "Fighting
// zombie_players:zombie_player!" 9 times in 5 min and "My brain disconnected, try again." 6 times
// in 60 s (g3b-20261106-r3). Ready-to-try asks for no chat-spam loop, and harness-ops' G4 no_spam
// check fails at 4 identical lines a minute or 7 in 5 min. So an identical line goes to chat at
// most once per CHAT_REPEAT_MS; the rest are logged.

/** How long an identical line stays out of chat after it was said. */
export const CHAT_REPEAT_MS = 60_000;

/** The models' reply when the LLM call failed (src/models/*.js). */
export const BRAIN_DISCONNECTED = /^My brain disconnected/;

/** A limiter: (text, now) -> whether the text may go to chat now (and it is recorded when it may). */
export function createRepeatLimit({ windowMs = CHAT_REPEAT_MS } = {}) {
    const said = new Map(); // text -> when it last went to chat
    return (text, now = Date.now()) => {
        const key = String(text ?? '').trim();
        for (const [k, at] of said) if (now - at >= windowMs) said.delete(k);
        if (said.has(key)) return false;
        said.set(key, now);
        return true;
    };
}

/**
 * Whether this agent may say `text` in chat now (one limiter per agent). When not, the line is
 * logged with `tag` and the caller does not send it.
 */
export function mayRepeat(agent, text, { tag = '[chat]', now = Date.now() } = {}) {
    if (!agent) return true;
    agent._chatRepeat ??= createRepeatLimit();
    if (agent._chatRepeat(text, now)) return true;
    console.log(`${tag} not repeated in chat (said within ${CHAT_REPEAT_MS / 1000} s): ${text}`);
    return false;
}
