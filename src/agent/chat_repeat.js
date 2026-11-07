// skills-rotn: no chat-spam loop from reflexes (lead, low priority, after G3 round 9). Identical
// reflex lines repeated in chat: "I'm dying!" 12 times in 5 min (g3a-20261105-r2), "Fighting
// zombie_players:zombie_player!" 9 times in 5 min and "My brain disconnected, try again." 6 times
// in 60 s (g3b-20261106-r3). Ready-to-try asks for no chat-spam loop, and harness-ops' G4 no_spam
// check fails at 4 identical lines a minute or 7 in 5 min. So an identical line goes to chat at
// most once per CHAT_REPEAT_MS; the rest are logged.
//
// #344 review 1: a line counts as said only when the chat limit really sent it (its 'rotnChatSent'
// event; or when it was handed to chat with the limit off). A line still waiting in the chat queue
// holds an identical one back for at most PENDING_MS (the limit's own lowMaxWaitMs, after which a
// waiting low line is dropped), so a dropped line never blocks the same text for a minute.
// #344 review 2: "identical" is harness-ops' chatLoopKey (case, numbers and punctuation ignored).
import { CHAT_LIMIT } from './chat_limit.js';

/** How long an identical line stays out of chat after it was sent. */
export const CHAT_REPEAT_MS = 60_000;
/** How long a line handed to the chat limit but not sent yet holds an identical one back. */
export const PENDING_MS = CHAT_LIMIT.lowMaxWaitMs;

/** The models' reply when the LLM call failed (src/models/*.js). */
export const BRAIN_DISCONNECTED = /^My brain disconnected/;

/**
 * When two chat lines are "the same line": the same as harness-ops' chatLoopKey in
 * test/scenarios/g4/g4-death-report.mjs (#342), so this limit and the G4 no_spam check agree:
 * lower case, every number one '#', punctuation dropped, spaces collapsed.
 */
export const chatLoopKey = (text) => String(text ?? '').toLowerCase().replace(/-?\d+(?:\.\d+)?/g, '#').replace(/[^\p{L}#\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** A limiter: recent(text) while an identical line was sent within windowMs or waits to be sent; note/pend record it. */
export function createRepeatLimit({ windowMs = CHAT_REPEAT_MS, pendingMs = PENDING_MS } = {}) {
    const sent = new Map(), pending = new Map(); // key -> time
    const prune = (now) => {
        for (const [k, at] of sent) if (now - at >= windowMs) sent.delete(k);
        for (const [k, at] of pending) if (now - at >= pendingMs) pending.delete(k);
    };
    return {
        recent(text, now = Date.now()) { prune(now); const k = chatLoopKey(text); return sent.has(k) || pending.has(k); },
        pend(text, now = Date.now()) { prune(now); pending.set(chatLoopKey(text), now); },
        note(text, now = Date.now()) { prune(now); const k = chatLoopKey(text); pending.delete(k); sent.set(k, now); },
    };
}

/** Whether the bot's outgoing chat limit is wrapped (then it tells what it really sent). */
export const chatLimitActive = (bot) => !!bot?._client?.rotnChatLimit?.active;

function limiterOf(agent) {
    if (!agent._chatRepeat) {
        agent._chatRepeat = createRepeatLimit();
        if (typeof agent.bot?.on === 'function') agent.bot.on('rotnChatSent', (text) => agent._chatRepeat.note(text));
    }
    return agent._chatRepeat;
}

/**
 * Whether this agent may say `text` in chat now (one limiter per agent). When not, the line is
 * logged with `tag` and the caller does not send it.
 */
export function mayRepeat(agent, text, { tag = '[chat]', now = Date.now() } = {}) {
    if (!agent) return true;
    if (!limiterOf(agent).recent(text, now)) return true;
    console.log(`${tag} not repeated in chat (said within ${CHAT_REPEAT_MS / 1000} s): ${text}`);
    return false;
}

/**
 * The line was handed to chat: with the chat limit on, it waits (pending) until the limit's
 * 'rotnChatSent' says it went; with the limit off (or another way out, a bot conversation) it is said now.
 */
export function handedToChat(agent, text, { viaLimit = chatLimitActive(agent?.bot), now = Date.now() } = {}) {
    if (!agent) return;
    if (viaLimit) limiterOf(agent).pend(text, now);
    else limiterOf(agent).note(text, now);
}
