// Guards for a bot that logs in with Microsoft auth (used by initBot in
// src/utils/mcdata.js). Read-only: nothing here reads, writes or prints a token.
//
// - The token cache must be the bot's own folder (MINDCRAFT_PROFILES_FOLDER),
//   outside every git work tree. Without it nmp uses its shared default cache.
// - prismarine-auth's `debug` output prints access and refresh tokens. A bot
//   process cannot clear DEBUG in time (ES-module imports load `debug` before
//   any main.js code runs), so a matching DEBUG refuses to start instead.
// - A bot never shows a device code: that login is the human's step
//   (tools/msa-login.mjs).

import process from 'node:process';
import { createRequire } from 'node:module';
import { assertOutsideGitWorkTrees } from './secret-folder.js';

export const PRISMARINE_AUTH_DEBUG_NAMESPACE = 'prismarine-auth';

// A DEBUG value is parsed by the `debug` package's own rule (v4.4: src/common.js
// enable/enabled): split on commas and whitespace, `-name` entries are skips,
// and `*` matches any run of characters.
function parseDebugValue(value) {
    const parts = (typeof value === 'string' ? value : '').trim().replace(/\s+/g, ',').split(',').filter(Boolean);
    return { names: parts.filter(p => p[0] !== '-'), skips: parts.filter(p => p[0] === '-').map(p => p.slice(1)) };
}

// Could this enabled pattern match `prefix` or any namespace that starts with it
// (prismarine-auth, prismarine-auth:live, a future sub-namespace)? Strict on
// purpose: anything that might reach a prismarine-auth* name counts.
export function patternMayEnablePrefix(pattern, prefix = PRISMARINE_AUTH_DEBUG_NAMESPACE) {
    if (pattern.startsWith(prefix)) return true;
    const star = pattern.indexOf('*');
    // With a `*`, everything after the first star can absorb the rest of the
    // prefix plus a suffix, so it can match iff the part before it fits the prefix.
    return star >= 0 && prefix.startsWith(pattern.slice(0, star));
}

// A skip excludes every prismarine-auth* namespace only in the plain form
// `<start of prefix>*`, for example `-*`, `-prismarine*` or `-prismarine-auth*`.
// An exact skip such as `-prismarine-auth` leaves sub-namespaces enabled.
function skipCoversPrefix(skip, prefix = PRISMARINE_AUTH_DEBUG_NAMESPACE) {
    const star = skip.indexOf('*');
    return star >= 0 && star === skip.length - 1 && prefix.startsWith(skip.slice(0, star));
}

/**
 * True if this DEBUG value could enable `prefix` or any sub-namespace of it.
 * That is: an enabled pattern may match a name starting with the prefix, and no
 * skip covers every such name.
 */
export function debugValueEnables(value, prefix = PRISMARINE_AUTH_DEBUG_NAMESPACE) {
    const { names, skips } = parseDebugValue(value);
    if (skips.some(s => skipCoversPrefix(s, prefix))) return false;
    return names.some(n => patternMayEnablePrefix(n, prefix));
}

// The `debug` instance prismarine-auth itself resolves, if it is installed. It
// shows the state actually in effect, even if DEBUG was changed after load:
// the namespace itself, a sample sub-namespace, and the enabled patterns
// (strings in debug 4.4) under the same strict rule as DEBUG.
function liveDebugEnables(prefix) {
    try {
        const require = createRequire(import.meta.url);
        const authEntry = require.resolve('prismarine-auth');
        const debug = createRequire(authEntry)('debug');
        if (typeof debug.enabled !== 'function') return false;
        if (debug.enabled(prefix) || debug.enabled(`${prefix}:sub`)) return true;
        const names = Array.isArray(debug.names) ? debug.names.filter(n => typeof n === 'string') : [];
        const skips = Array.isArray(debug.skips) ? debug.skips.filter(n => typeof n === 'string') : [];
        if (skips.some(s => skipCoversPrefix(s, prefix))) return false;
        return names.some(n => patternMayEnablePrefix(n, prefix));
    } catch {
        return false;
    }
}

/**
 * Throws a clear Error if a Microsoft-auth bot must not start: no token-cache
 * folder, a folder inside a git work tree, or prismarine-auth debug output on.
 * Creates nothing.
 */
export function assertMicrosoftAuthSafe({ username, profilesFolder, env = process.env, liveDebug = liveDebugEnables }) {
    const who = `bot ${username}`;
    if (!profilesFolder) {
        throw new Error(`${who}: auth is "microsoft" but MINDCRAFT_PROFILES_FOLDER is not set. `
            + 'Set it to this bot\'s own token cache folder, outside every git repository; see coord/NEEDS-HUMAN.md.');
    }
    try {
        assertOutsideGitWorkTrees(profilesFolder);
    } catch (e) {
        throw new Error(`${who}: MINDCRAFT_PROFILES_FOLDER: ${e.message}`);
    }
    if (debugValueEnables(env.DEBUG) || liveDebug(PRISMARINE_AUTH_DEBUG_NAMESPACE)) {
        throw new Error(`${who}: refusing Microsoft auth because DEBUG enables "${PRISMARINE_AUTH_DEBUG_NAMESPACE}" debug output `
            + '(or a pattern that could reach one of its namespaces), which prints access and refresh tokens. '
            + `Unset DEBUG, narrow it (for example DEBUG=minecraft-protocol), or add -${PRISMARINE_AUTH_DEBUG_NAMESPACE}*, and start again.`);
    }
}

/**
 * The default device-code callback for a bot: one line that says a human login
 * is needed. It never prints the code, the message or the URL from `res`.
 * prismarine-auth keeps polling until the code expires (about 15 min), then the
 * login fails with an error.
 */
export function quietMsaCodeHandler(username, log = (line) => console.error(line)) {
    return () => { log(`[mcdata] ${username}: device-code login needed, see coord/NEEDS-HUMAN.md`); };
}
