// The bot's outgoing chat limit (G3 round 4 C+D, and round 3 D before it: "Kicked for spamming").
//
// Vanilla 1.12 (NetHandlerPlayServer): every chat packet, a /command or a whisper included, adds 20
// to a counter that drops by 1 per server tick; above 200 a player who is not an op is kicked
// ("disconnect.spam"). That allows about 10 packets at once, then about 1 per second. The RotN
// 3.3.4 server pack sets no other limit (no config in the pinned zip mentions chat spam; checked
// 2026-11-06), so this keeps well under vanilla's: a budget of half (100) that refills at half the
// rate (10 per second, so a server at 10 TPS is still covered). That is 5 packets at once, then one
// every 2 s.
//
// The limit sits at the one place every packet passes: mineflayer's bot._client.chat (bot.chat,
// bot.whisper and each piece of a long line). A packet over the budget waits in a queue.
// Priorities, set by the caller around its bot.chat/whisper call (withChatPriority):
// - 'high': a reply to a player, a refusal included: it goes before anything waiting; never dropped.
// - 'normal' (the default): agenda lines, self-prompted replies: waits its turn; never dropped.
// - 'low': reflex narration ("I'm stuck!"): dropped when LOW_QUEUE_MAX low lines already wait,
//   or when it has waited longer than lowMaxWaitMs.

export const CHAT_LIMIT = { perPacket: 20, budget: 100, refillPerSec: 10, lowQueueMax: 3, lowMaxWaitMs: 15_000 };
const RANK = { high: 0, normal: 1, low: 2 };

/**
 * Run fn (a synchronous bot.chat or bot.whisper call) with this priority for the packets it sends.
 * mineflayer sends them synchronously, so the priority applies to exactly those packets.
 */
export function withChatPriority(bot, priority, fn) {
    const before = bot?.rotnChatPriority;
    if (bot) bot.rotnChatPriority = RANK[priority] === undefined ? 'normal' : priority;
    try { return fn(); }
    finally { if (bot) bot.rotnChatPriority = before; }
}

/**
 * Wrap bot._client.chat with the limit. Returns the limiter ({ pending(), dropped }); idempotent.
 * now/setTimer/clearTimer/log are for tests.
 */
export function installChatLimit(bot, { limits = CHAT_LIMIT, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = (m) => console.log(m) } = {}) {
    const client = bot?._client;
    if (!client || typeof client.chat !== 'function') return null;
    if (client.rotnChatLimit) return client.rotnChatLimit;
    const raw = client.chat.bind(client);
    let level = 0;          // the counter as the server sees it, by our estimate
    let at = now();
    let seq = 0;
    const queue = [];       // { text, priority, since, seq }
    let timer = null;
    const state = { dropped: 0, sent: 0, pending: () => queue.map(q => ({ text: q.text, priority: q.priority })) };

    const refill = () => {
        const t = now();
        level = Math.max(0, level - ((t - at) / 1000) * limits.refillPerSec);
        at = t;
    };
    const fits = () => level + limits.perPacket <= limits.budget;
    const send = (text) => {
        level += limits.perPacket;
        state.sent++;
        raw(text);
    };
    const short = (text) => (text.length > 60 ? `${text.slice(0, 57)}...` : text);
    const drop = (q, why) => {
        state.dropped++;
        log(`[chat] dropped a low-priority line (${why}): ${short(q.text)}`);
    };
    // The next one to go: the highest priority, then the oldest.
    const next = () => queue.reduce((best, q, i) => (best < 0 || RANK[q.priority] < RANK[queue[best].priority]
        || (RANK[q.priority] === RANK[queue[best].priority] && q.seq < queue[best].seq) ? i : best), -1);
    const drain = () => {
        timer = null;
        refill();
        for (let i = queue.length - 1; i >= 0; i--) {
            if (queue[i].priority === 'low' && now() - queue[i].since > limits.lowMaxWaitMs) drop(queue.splice(i, 1)[0], 'it waited too long');
        }
        while (queue.length && fits()) send(queue.splice(next(), 1)[0].text);
        schedule();
    };
    const schedule = () => {
        if (timer || !queue.length) return;
        const wait = Math.max(50, ((level + limits.perPacket - limits.budget) / limits.refillPerSec) * 1000);
        timer = setTimer(drain, wait);
        timer?.unref?.();
    };

    client.chat = (text) => {
        refill();
        const priority = bot.rotnChatPriority ?? 'normal';
        // A high-priority line (a reply to a player, a refusal) goes at once when the budget allows,
        // ahead of lines that wait.
        if (fits() && (!queue.length || priority === 'high')) return send(text);
        if (priority === 'low' && queue.filter(q => q.priority === 'low').length >= limits.lowQueueMax) {
            drop({ text }, 'chat is busy');
            return;
        }
        queue.push({ text, priority, since: now(), seq: seq++ });
        schedule();
    };
    // A disconnect ends the queue: lines for the old connection must not go to the next one.
    client.once?.('end', () => { if (timer) clearTimer(timer); timer = null; queue.length = 0; });
    client.rotnChatLimit = state;
    return state;
}
