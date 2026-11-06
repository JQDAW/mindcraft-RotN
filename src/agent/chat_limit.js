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
// - 'high': a reply to a task giver, or a refusal: it goes before anything waiting; never dropped.
// - 'normal' (the default): agenda lines, self-prompted replies, replies to other players: waits its
//   turn; dropped only when the queue is full (the oldest normal line, after any low one).
// - 'low': reflex narration ("I'm stuck!"): dropped when lowQueueMax low lines already wait, or
//   when it has waited longer than lowMaxWaitMs.
// A line may carry a key (a refusal: "refusal:<sender>", #256 review 1). At most one line per key
// waits: a repeat replaces the waiting one. And a keyed line is not sent until keyGapMs after the
// last one with that key, so a player who keeps typing commands gets at most one refusal per 10 s
// and cannot starve the agenda lines the harness reads. A line in its gap holds up nothing: lines
// that may go now still go when the budget allows (#256 follow-up). The queue holds at most
// queueMax lines (high lines aside). Waiting high lines are bounded too: replies to task givers,
// and at most one refusal per player who is not one, so their number is at most the number of
// players (plus the givers' replies).

export const CHAT_LIMIT = { perPacket: 20, budget: 100, refillPerSec: 10, lowQueueMax: 3, lowMaxWaitMs: 15_000, queueMax: 20, keyGapMs: 10_000 };
const RANK = { high: 0, normal: 1, low: 2 };

/**
 * Run fn (a synchronous bot.chat or bot.whisper call) with this priority (and collapse key) for the
 * packets it sends. mineflayer sends them synchronously, so they apply to exactly those packets.
 */
export function withChatPriority(bot, priority, fn, key = null) {
    const before = [bot?.rotnChatPriority, bot?.rotnChatKey];
    if (bot) {
        bot.rotnChatPriority = RANK[priority] === undefined ? 'normal' : priority;
        bot.rotnChatKey = key ?? undefined;
    }
    try { return fn(); }
    finally { if (bot) [bot.rotnChatPriority, bot.rotnChatKey] = before; }
}

const OFF = '[chat] no bot._client.chat to wrap: the outgoing chat limit is OFF for this bot.';

/**
 * Wrap bot._client.chat with the limit. minecraft-protocol assigns client.chat only when the login
 * completes (client/play.js onReady), after initBot returns: G3 round 5 batch A ran with the limit
 * off ("no bot._client.chat to wrap"). So when it is not there yet this does not give up: it wraps
 * on the client's 'playerJoin' (right after onReady), the bot's 'login' and every 'spawn'. Those
 * also wrap again if client.chat was replaced, or the client of a reconnect. A spawn with still
 * nothing to wrap warns that the limit is off (#256 review 2: never silently off).
 * Returns the limiter ({ active, pending(), sent, dropped, collapsed }; active once wrapped), or
 * null with the warning when the bot has no client and no events to wait on. Idempotent.
 * now/setTimer/clearTimer/log/warn are for tests.
 */
export function installChatLimit(bot, opts = {}) {
    const { log = (m) => console.log(m), warn = (m) => console.warn(m) } = opts;
    const attach = (when) => {
        const client = bot?._client;
        if (!client) return null;
        if (!client.rotnChatLimit) {
            const limiter = createLimiter(bot, client, opts);
            client.rotnChatLimit = limiter.state;
            client.rotnChatWrap = limiter.wrap;
            client.on?.('playerJoin', () => limiter.wrap('playerJoin'));
        }
        client.rotnChatWrap(when);
        return client.rotnChatLimit;
    };
    const state = attach('install');
    const waits = typeof bot?.on === 'function';
    if (waits && !bot.rotnChatLimitHooked) {
        bot.rotnChatLimitHooked = true;
        bot.on('login', () => attach('login'));
        bot.on('spawn', () => { if (!attach('spawn')?.active) warn(OFF); });
    }
    if (state?.active) return state;
    if (!waits) { warn(OFF); return null; }
    log('[chat] no bot._client.chat yet (it comes with the login): the outgoing chat limit wraps it on login');
    return state;
}

function createLimiter(bot, client, { limits = CHAT_LIMIT, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
    log = (m) => console.log(m) } = {}) {
    let raw = null;         // the client's own chat, once wrapped
    let level = 0;          // the counter as the server sees it, by our estimate
    let at = now();
    let seq = 0;
    const queue = [];       // { text, priority, key, since, seq }
    const keySentAt = new Map();
    let timer = null;
    const state = { active: false, dropped: 0, collapsed: 0, sent: 0, pending: () => queue.map(q => ({ text: q.text, priority: q.priority, key: q.key })) };

    const refill = () => {
        const t = now();
        level = Math.max(0, level - ((t - at) / 1000) * limits.refillPerSec);
        at = t;
    };
    const fits = () => level + limits.perPacket <= limits.budget;
    const send = (q) => {
        level += limits.perPacket;
        state.sent++;
        if (q.key) keySentAt.set(q.key, now());
        raw(q.text);
    };
    const short = (text) => (text.length > 60 ? `${text.slice(0, 57)}...` : text);
    const drop = (q, why) => {
        state.dropped++;
        log(`[chat] dropped a ${q.priority} line (${why}): ${short(q.text)}`);
    };
    // When a line may go: a keyed one keyGapMs after the last line sent with its key.
    const eligibleAt = (q) => (q.key ? (keySentAt.get(q.key) ?? -Infinity) + limits.keyGapMs : -Infinity);
    // The next one to go: of the lines that may go, the highest priority, then the oldest; or -1.
    const next = () => queue.reduce((best, q, i) => (eligibleAt(q) > now() ? best
        : best < 0 || RANK[q.priority] < RANK[queue[best].priority]
        || (RANK[q.priority] === RANK[queue[best].priority] && q.seq < queue[best].seq) ? i : best), -1);
    const oldest = (priority) => queue.reduce((best, q, i) => (q.priority === priority && (best < 0 || q.seq < queue[best].seq) ? i : best), -1);
    const drain = () => {
        timer = null;
        timerAt = Infinity;
        refill();
        for (let i = queue.length - 1; i >= 0; i--) {
            if (queue[i].priority === 'low' && now() - queue[i].since > limits.lowMaxWaitMs) drop(queue.splice(i, 1)[0], 'it waited too long');
        }
        while (queue.length && fits()) {
            const i = next();
            if (i < 0) break; // only keyed lines in their gap wait
            send(queue.splice(i, 1)[0]);
        }
        schedule();
    };
    let timerAt = Infinity;
    // The drain timer: when the budget allows a packet and some line may go. A new line that may go
    // sooner than the timer set for a keyed line in its gap moves the timer earlier (#256 follow-up).
    const schedule = () => {
        if (!queue.length) return;
        const budgetWait = ((level + limits.perPacket - limits.budget) / limits.refillPerSec) * 1000;
        const soonest = Math.min(...queue.map(eligibleAt)) - now();
        const wait = Math.max(50, budgetWait, soonest);
        if (timer && now() + wait >= timerAt) return;
        if (timer) clearTimer(timer);
        timerAt = now() + wait;
        timer = setTimer(drain, wait);
        timer?.unref?.();
    };

    const limited = (text) => {
        refill();
        const key = bot.rotnChatKey ?? null;
        const priority = bot.rotnChatPriority ?? 'normal';
        const line = { text, priority, key, since: now(), seq: seq++ };
        // A high-priority line (a reply to a giver, a refusal) goes at once when the budget allows,
        // ahead of lines that wait; a keyed one only after its gap (#256 review 1). Any other line
        // goes at once when nothing that may go now waits before it: a refusal in its gap does not
        // hold up a normal line (#256 follow-up).
        // At most one waiting line per key: the newest text replaces the waiting one. Checked first
        // (#260 nit 1): a new keyed line never goes ahead of an older one with its key that waits,
        // so per-key order holds (a late drain timer left a moment where the budget fit).
        const same = key ? queue.find(q => q.key === key) : null;
        const readyWaiting = queue.some(q => eligibleAt(q) <= now());
        if (!same && fits() && (!readyWaiting || priority === 'high') && eligibleAt(line) <= now()) return send(line);
        if (same) {
            same.text = text;
            if (RANK[priority] < RANK[same.priority]) same.priority = priority;
            state.collapsed++;
            log(`[chat] collapsed a repeat into the waiting line (${key}): ${short(text)}`);
            return;
        }
        if (priority === 'low' && queue.filter(q => q.priority === 'low').length >= limits.lowQueueMax) {
            drop(line, 'chat is busy');
            return;
        }
        if (queue.length >= limits.queueMax) {
            // Make room: a low line, else the oldest normal one. High lines are never dropped (their
            // number is bounded: replies to givers, one refusal per sender).
            if (priority === 'low') { drop(line, 'the chat queue is full'); return; }
            const victim = oldest('low') >= 0 ? oldest('low') : oldest('normal');
            if (victim >= 0) drop(queue.splice(victim, 1)[0], 'the chat queue is full');
            else if (priority !== 'high') { drop(line, 'the chat queue is full'); return; }
        }
        queue.push(line);
        schedule();
    };
    // A disconnect ends the queue: lines for the old connection must not go to the next one.
    client.once?.('end', () => { if (timer) clearTimer(timer); timer = null; timerAt = Infinity; queue.length = 0; }); // #260 nit 2: timerAt too
    // Wrap the client's chat when it has one, and again if it was replaced. True when wrapped.
    const wrap = (when) => {
        if (client.chat === limited) return true;
        if (typeof client.chat !== 'function') return false;
        raw = client.chat.bind(client);
        client.chat = limited;
        state.active = true;
        if (when !== 'install') log(`[chat] the outgoing chat limit is on (wrapped on ${when})`);
        return true;
    };
    return { state, wrap };
}
