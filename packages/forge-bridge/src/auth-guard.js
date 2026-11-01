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

// The `debug` package's own rule (v4.4: src/common.js enable/enabled): the value
// is split on commas and whitespace, `-name` entries are skips, and `*` matches
// any run of characters.
function globMatch(name, template) {
    const body = template.split('*').map(s => s.replace(/[.+?^$(){}|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp('^' + body + '$').test(name);
}

/** True if this DEBUG value would enable `namespace` in the `debug` package. */
export function debugValueEnables(value, namespace = PRISMARINE_AUTH_DEBUG_NAMESPACE) {
    const parts = (typeof value === 'string' ? value : '').trim().replace(/\s+/g, ',').split(',').filter(Boolean);
    const skips = parts.filter(p => p[0] === '-').map(p => p.slice(1));
    const names = parts.filter(p => p[0] !== '-');
    if (skips.some(s => globMatch(namespace, s))) return false;
    return names.some(n => globMatch(namespace, n));
}

// The `debug` instance prismarine-auth itself resolves, if it is installed. It
// shows the state actually in effect, even if DEBUG was changed after load.
function liveDebugEnables(namespace) {
    try {
        const require = createRequire(import.meta.url);
        const authEntry = require.resolve('prismarine-auth');
        const debug = createRequire(authEntry)('debug');
        return typeof debug.enabled === 'function' && debug.enabled(namespace);
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
        throw new Error(`${who}: refusing Microsoft auth because DEBUG enables "${PRISMARINE_AUTH_DEBUG_NAMESPACE}" debug output, `
            + 'which prints access and refresh tokens. Unset DEBUG, or exclude it (for example DEBUG=minecraft-protocol), and start again.');
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
