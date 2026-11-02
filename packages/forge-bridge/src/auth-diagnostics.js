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
    const state = { log, lastFailure: null };
    const say = (line) => { try { state.log(line); } catch { /* never mask the auth result */ } };
    const fetchProfile = async function (...args) {
        const start = now();
        let profile;
        try {
            profile = await original.apply(this, args);
        } catch (err) {
            const info = describeProfileFetchError(err);
            const ms = now() - start;
            state.lastFailure = { ...info, ms: Math.round(ms) };
            say(formatProfileFetchFailure(info, ms));
            throw err;
        }
        state.lastFailure = null;
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

/**
 * The facts about the last failed profile fetch in this process (status, class,
 * code, ms), or null after a success or without instrumentProfileFetch. nmp's
 * own error ("Failed to obtain profile data") carries no status; g1-driver
 * classifies the failure from this.
 */
export function lastProfileFetchFailure(TokenManager) {
    let Manager = TokenManager;
    if (!Manager) {
        try { Manager = loadJavaTokenManager(); } catch { return null; }
    }
    return Manager?.prototype?.fetchProfile?.[WRAPPED]?.lastFailure ?? null;
}

/** HTTP statuses that mean the login cannot succeed by retrying (ADR 0003 decision 5). */
export const PERMANENT_AUTH_STATUSES = Object.freeze([401, 403, 404]);

/**
 * XSTS XErr codes that are account states a retry cannot fix (no Xbox profile, a
 * ban, a child account, terms not accepted, region, proof of age, playtime limit):
 * prismarine-auth's own xboxLiveErrors table, from the copy nmp loads. Our patch
 * (patches/prismarine-auth+3.1.1.patch) attaches the code to the error as `xerr`.
 */
export const PERMANENT_XSTS_XERRS = Object.freeze(loadXboxLiveErrorCodes());

function loadXboxLiveErrorCodes() {
    try {
        const fromNmp = createRequire(createRequire(import.meta.url).resolve('minecraft-protocol'));
        const { xboxLiveErrors } = createRequire(fromNmp.resolve('prismarine-auth'))('./src/common/Constants.js');
        const codes = Object.keys(xboxLiveErrors ?? {}).map(Number).filter(Number.isSafeInteger);
        if (codes.length) return codes;
    } catch { /* fall through */ }
    // prismarine-auth 3.1.1's table, if it cannot be read.
    return [2148916227, 2148916229, 2148916233, 2148916234, 2148916235, 2148916236, 2148916237, 2148916238];
}

// Exit-code classes for a login that fails before the bot joins (ADR 0003 decision 5):
// 401, 403 (the profile fetch or Xbox), 404 (no Minecraft) and a permanent XSTS XErr
// are permanent (3); network errors, timeouts, 5xx, other statuses and other XErrs
// are transient (1).
const NMP_PROFILE_FAILURE = /^Failed to obtain profile data\b/;
const NETWORK_CLASSES = new Set(['TypeError', 'AbortError', 'TimeoutError', 'FetchError']);

/**
 * Classify an error that ended a login before the bot joined. Reads the error's
 * message only to find a leading status number and nmp's profile-failure prefix;
 * the result never contains the message.
 * @param {unknown} err
 * @param {{ profileFailure?: { status: number|null } | null }} [opts] lastProfileFetchFailure()
 * @returns {{ errorClass: string, code: string|null, status: number|null, statusSource: 'error'|'profile-fetch'|null, xerr: number|null, kind: string, fatal: boolean }}
 */
export function classifyBeforeJoinError(err, { profileFailure = null } = {}) {
    const d = describeProfileFetchError(err);
    const message = typeof err?.message === 'string' ? err.message : '';
    const nmpProfile = NMP_PROFILE_FAILURE.test(message);
    let status = d.status;
    let statusSource = status !== null ? 'error' : null;
    if (status === null && nmpProfile && Number.isInteger(profileFailure?.status)) {
        status = profileFailure.status;
        statusSource = 'profile-fetch';
    }
    const code = d.causeCode ?? (nmpProfile ? safeCode(profileFailure?.causeCode) : null);
    const xerr = Number.isSafeInteger(err?.xerr) ? err.xerr : null;
    let kind;
    if (xerr !== null) kind = PERMANENT_XSTS_XERRS.includes(xerr) ? 'auth-permanent' : 'xsts-other';
    else if (status !== null && PERMANENT_AUTH_STATUSES.includes(status)) kind = 'auth-permanent';
    else if (status !== null && status >= 500) kind = 'http-5xx';
    else if (status !== null) kind = 'http-other';
    else if (code || NETWORK_CLASSES.has(d.errorClass)) kind = 'network';
    else if (nmpProfile) kind = 'auth-unknown';
    else kind = 'other';
    return { errorClass: d.errorClass, code, status, statusSource, xerr, kind, fatal: kind === 'auth-permanent' };
}

/** One log line for an error before login: its classified facts, never its message. */
export function formatBeforeJoinError(info) {
    const parts = [info.errorClass];
    if (info.code) parts.push(info.code);
    if (info.status !== null) parts.push(`HTTP ${info.status}${info.statusSource === 'profile-fetch' ? ' (profile fetch)' : ''}`);
    if (info.xerr !== null && info.xerr !== undefined) parts.push(`XErr ${info.xerr}`);
    return `${parts.join(', ')}; ${info.kind} (message not logged)`;
}

/**
 * initBot's bot error listener, in place of mineflayer's `logErrors` (which prints
 * whole error objects; before login those can hold HTTP response bodies). Always
 * attaches a listener, so an 'error' never throws as an unhandled EventEmitter
 * error, even with `hideErrors` (mineflayer's own listener is then a no-op too).
 * Before login it logs formatBeforeJoinError's facts only; after login, the error
 * as mineflayer logged it. Call it with mineflayer's logErrors turned off.
 * @param {import('node:events').EventEmitter} bot
 * @param {{ logErrors?: boolean, hideErrors?: boolean, log?: (...a: unknown[]) => void, profileFailure?: () => object|null }} [opts]
 */
export function attachBotErrorLogger(bot, { logErrors = true, hideErrors = false, log = (...a) => console.log(...a), profileFailure = () => lastProfileFetchFailure() } = {}) {
    const quiet = !logErrors || hideErrors;
    let loggedIn = false;
    bot.once('login', () => { loggedIn = true; });
    bot.on('error', (err) => {
        if (quiet) return;
        if (loggedIn) { log(err); return; }
        let failure = null;
        try { failure = profileFailure(); } catch { /* none */ }
        log(`[mcdata] bot error before login: ${formatBeforeJoinError(classifyBeforeJoinError(err, { profileFailure: failure }))}`);
    });
}
