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
const RULES = [
    { category: 'mod_rejection', fatal: true, re: /Server Mod rejections|Mod rejections|mod is not found on client|but client has/i },
    { category: 'vanilla_client_rejected', fatal: true, re: /require FML\/Forge to be installed|No modded response received/i },
    { category: 'not_whitelisted', fatal: true, re: /not white-?listed|multiplayer\.disconnect\.not_whitelisted/i },
    { category: 'banned', fatal: true, re: /banned|multiplayer\.disconnect\.banned/i },
    { category: 'auth', fatal: true, re: /Failed to verify username|Invalid session|multiplayer\.disconnect\.unverified_username|does the account own minecraft/i },
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
 * @returns {{category:string, fatal:boolean, exitCode:number, text:string}}
 */
export function classifyKick(reason) {
    const text = chatToText(reason);
    for (const rule of RULES) {
        if (rule.re.test(text)) {
            return { category: rule.category, fatal: rule.fatal, exitCode: rule.fatal ? EXIT.FATAL : EXIT.TRANSIENT, text };
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
