// Kick classification (fml-spec.md section 4) and the ADR 0003 exit-code contract:
//   0 clean stop, 1 transient (restart with backoff), 3 fatal (no restart).

export const EXIT = Object.freeze({ CLEAN: 0, TRANSIENT: 1, FATAL: 3 });

// Flatten a 1.12 chat component (JSON string or object) to plain text.
export function chatToText(reason) {
    if (reason == null) return '';
    let obj = reason;
    if (typeof reason === 'string') {
        const s = reason.trim();
        if (!(s.startsWith('{') || s.startsWith('[') || s.startsWith('"'))) return reason;
        try { obj = JSON.parse(s); } catch { return reason; }
    }
    const parts = [];
    const walk = (c) => {
        if (c == null) return;
        if (typeof c === 'string' || typeof c === 'number') { parts.push(String(c)); return; }
        if (Array.isArray(c)) { c.forEach(walk); return; }
        if (c.text != null) parts.push(String(c.text));
        if (c.translate) {
            parts.push(c.translate);
            if (Array.isArray(c.with)) { parts.push(' '); c.with.forEach(walk); }
        }
        if (Array.isArray(c.extra)) c.extra.forEach(walk);
    };
    walk(obj);
    return parts.join('');
}

// First match wins. `fatal` means a human has to act before a retry can help.
// `retryCap` makes a transient category fatal after that many kicks in a row
// (see createRestartPolicy): a session-server hiccup clears on retry, a revoked
// or expired login does not.
const RULES = [
    { category: 'mod_rejection', fatal: true, re: /Server Mod rejections|Mod rejections|mod is not found on client|but client has/i },
    { category: 'vanilla_client_rejected', fatal: true, re: /require FML\/Forge to be installed|No modded response received/i },
    { category: 'not_whitelisted', fatal: true, re: /not white-?listed|multiplayer\.disconnect\.not_whitelisted/i },
    // Anchored: only the vanilla ban screens, never a mod message that merely contains "banned".
    { category: 'banned', fatal: true, re: /^\s*(You are banned|Your IP address is banned)|^\s*multiplayer\.disconnect\.banned/i },
    { category: 'no_license', fatal: true, re: /does the account own minecraft/i },
    { category: 'auth', fatal: false, retryCap: 3, re: /Failed to verify username|Invalid session|multiplayer\.disconnect\.unverified_username/i },
    { category: 'outdated', fatal: true, re: /Outdated (server|client)|multiplayer\.disconnect\.outdated/i },
    { category: 'server_starting', fatal: false, re: /Server is still starting/i },
    { category: 'server_stopping', fatal: false, re: /Server closed|ServerShutdown|multiplayer\.disconnect\.server_shutdown|Server is restarting|Server (is )?stopping/i },
    { category: 'duplicate_login', fatal: false, re: /logged in from another location|multiplayer\.disconnect\.duplicate_login/i },
    { category: 'timeout', fatal: false, re: /Timed out|disconnect\.timeout|ReadTimeout|keepalive/i },
    { category: 'idle', fatal: false, re: /idle too long|multiplayer\.disconnect\.idling/i },
    { category: 'flying_or_movement', fatal: false, re: /Flying is not enabled|moved too quickly|moved wrongly|invalid_player_movement/i },
    { category: 'server_exception', fatal: false, re: /Internal Exception|Internal server error|Exception/i },
    { category: 'kicked_by_operator', fatal: false, re: /Kicked by an operator|multiplayer\.disconnect\.kicked/i },
];

/**
 * @param {string|object} reason kick reason (chat JSON or text)
 * @returns {{category:string, fatal:boolean, exitCode:number, text:string, retryCap?:number}}
 */
export function classifyKick(reason) {
    const text = chatToText(reason);
    for (const rule of RULES) {
        if (rule.re.test(text)) {
            const c = { category: rule.category, fatal: rule.fatal, exitCode: rule.fatal ? EXIT.FATAL : EXIT.TRANSIENT, text };
            if (rule.retryCap) c.retryCap = rule.retryCap;
            return c;
        }
    }
    // Anything else is a mod's own message (spec section 4); treat as transient,
    // the capture's ring buffer shows which channel preceded it.
    return { category: 'other', fatal: false, exitCode: EXIT.TRANSIENT, text };
}

// Socket-level errors (no kick packet) are always transient.
export function classifySocketError(err) {
    const code = err?.code ?? '';
    return { category: 'network', fatal: false, exitCode: EXIT.TRANSIENT, text: `${code} ${err?.message ?? err}`.trim() };
}

/**
 * The ADR 0003 restart rule for exit code 1: wait 10 s, doubling, capped at
 * 5 min, reset after 10 min connected. A category with `retryCap` becomes
 * fatal once it has ended that many sessions in a row. Not wired in yet: the
 * consumer is src/process/agent_process.js (net-forge brief item 8).
 */
export function createRestartPolicy({ baseMs = 10_000, maxMs = 300_000, resetAfterMs = 600_000 } = {}) {
    let attempt = 0;
    let lastCategory = null;
    let streak = 0;
    return {
        /**
         * @param {{category:string, fatal:boolean, exitCode:number, retryCap?:number}} c a classifyKick/classifySocketError result
         * @param {number} connectedMs how long the session that just ended was connected
         * @returns {{exitCode:number, restart:boolean, delayMs:number, attempt:number, reason:string}}
         */
        next(c, connectedMs = 0) {
            if (connectedMs >= resetAfterMs) { attempt = 0; streak = 0; lastCategory = null; }
            if (c.exitCode === EXIT.CLEAN) return { exitCode: EXIT.CLEAN, restart: false, delayMs: 0, attempt, reason: 'clean' };
            if (c.fatal || c.exitCode === EXIT.FATAL) return { exitCode: EXIT.FATAL, restart: false, delayMs: 0, attempt, reason: c.category };
            streak = c.category === lastCategory ? streak + 1 : 1;
            lastCategory = c.category;
            if (c.retryCap && streak >= c.retryCap) {
                return { exitCode: EXIT.FATAL, restart: false, delayMs: 0, attempt, reason: `${c.category}: ${streak} times in a row` };
            }
            const delayMs = Math.min(maxMs, baseMs * 2 ** attempt);
            attempt++;
            return { exitCode: EXIT.TRANSIENT, restart: true, delayMs, attempt, reason: c.category };
        },
    };
}
