// Diagnostics for the Minecraft profile fetch in Microsoft auth (G2 batch 2: a
// session failed one second in with nmp's "Failed to obtain profile data for
// <bot>", and the same token cache worked 20 s later).
//
// prismarine-auth's getMinecraftJavaToken catches a failed fetchProfile and
// reports it only through debug('prismarine-auth'), which auth-guard forbids
// because that output prints tokens. nmp then throws without the cause. This
// wraps MinecraftJavaTokenManager.prototype.fetchProfile, in the prismarine-auth
// copy that minecraft-protocol loads, and logs ONE line when it fails:
//   - the HTTP status number (and its standard name, from node:http, not from
//     the response);
//   - the error's class, and for a network error its cause's class and code;
//   - how long the fetch took.
// It never logs the error message (prismarine-auth puts the response body in
// it), the response body, headers, the access token, or anything from the
// profiles folder. The error is rethrown unchanged, so auth behaves as before.

import http from 'node:http';
import { createRequire } from 'node:module';

const WRAPPED = Symbol.for('forge-bridge.profileFetchDiagnostics');

// Only identifier-like names and upper-case codes are ever logged.
const safeName = (s) => (typeof s === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(s) ? s : null);
const safeCode = (s) => (typeof s === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(s) ? s : null);

/**
 * The loggable facts about a failed profile fetch. prismarine-auth's checkStatus
 * throws `Error("<status> <statusText> <body>")`; only the leading status number
 * is read from it. A network failure (Node's fetch) is a TypeError with a cause.
 * @returns {{ status: number|null, statusName: string|null, errorClass: string, causeClass: string|null, causeCode: string|null }}
 */
export function describeProfileFetchError(err) {
    const message = typeof err?.message === 'string' ? err.message : '';
    const m = /^([1-5]\d\d) /.exec(message);
    const status = m ? Number(m[1]) : null;
    return {
        status,
        statusName: status !== null ? (http.STATUS_CODES[status] ?? null) : null,
        errorClass: safeName(err?.name) ?? safeName(err?.constructor?.name) ?? typeof err,
        causeClass: safeName(err?.cause?.name) ?? safeName(err?.cause?.constructor?.name),
        causeCode: safeCode(err?.cause?.code) ?? safeCode(err?.code),
    };
}

export function formatProfileFetchFailure(info, ms) {
    const what = info.status !== null
        ? `HTTP ${info.status}${info.statusName ? ` ${info.statusName}` : ''}`
        : 'no HTTP response';
    const cause = [info.causeClass, info.causeCode].filter(Boolean).join(' ');
    return `Minecraft profile fetch failed after ${Math.round(ms)} ms: ${what} (${info.errorClass}${cause ? `; cause ${cause}` : ''})`;
}

/** prismarine-auth's MinecraftJavaTokenManager, resolved from minecraft-protocol (the copy nmp uses). */
export function loadJavaTokenManager() {
    const fromNmp = createRequire(createRequire(import.meta.url).resolve('minecraft-protocol'));
    return createRequire(fromNmp.resolve('prismarine-auth'))('./src/TokenManagers/MinecraftJavaTokenManager.js');
}

/**
 * Wrap fetchProfile once per process (a second call only replaces the log
 * function). Returns false if prismarine-auth's layout is not the expected one;
 * auth then runs unwrapped.
 * @param {{ log?: (line: string) => void, TokenManager?: Function, now?: () => number }} [opts]
 */
export function instrumentProfileFetch({ log = (line) => console.warn(line), TokenManager, now = Date.now } = {}) {
    let Manager = TokenManager;
    if (!Manager) {
        try { Manager = loadJavaTokenManager(); } catch { return false; }
    }
    const proto = Manager?.prototype;
    if (!proto || typeof proto.fetchProfile !== 'function') return false;
    if (proto.fetchProfile[WRAPPED]) {
        proto.fetchProfile[WRAPPED].log = log;
        return true;
    }
    const original = proto.fetchProfile;
    const state = { log };
    const say = (line) => { try { state.log(line); } catch { /* never mask the auth result */ } };
    const fetchProfile = async function (...args) {
        const start = now();
        let profile;
        try {
            profile = await original.apply(this, args);
        } catch (err) {
            say(formatProfileFetchFailure(describeProfileFetchError(err), now() - start));
            throw err;
        }
        // A 2xx answer that nmp still rejects (`profile.error`): say so, without its value.
        if (profile && typeof profile === 'object' && profile.error !== undefined) {
            say(`Minecraft profile fetch answered after ${Math.round(now() - start)} ms with an error field (value not logged)`);
        }
        return profile;
    };
    fetchProfile[WRAPPED] = state;
    proto.fetchProfile = fetchProfile;
    return true;
}
