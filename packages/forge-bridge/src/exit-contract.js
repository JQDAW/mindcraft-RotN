// The ADR 0003 decision 5 process exit-code contract, both sides:
// - the agent side (src/agent/agent.js, through bot.forge.recordExit from initBot)
//   writes why it exits to MINDCRAFT_EXIT_REASON_FILE and picks the exit code;
// - the main-process side (src/process/agent_process.js) reads that file and
//   decides: restart (with or without backoff), stay up, or end the main process.
//
//   0  clean stop. Not restarted. A single-bot service (MINDCRAFT_SINGLE_BOT_SERVICE=1)
//      ends the main process with 0, also after a requested stop, so systemd sees it.
//   1  transient. Restarted with backoff (createRestartPolicy). A deliberate restart
//      (category requested_restart: !restart, the stuck mode, mindserver restart-agent)
//      restarts at once without touching the backoff streak.
//   3  fatal. Not restarted; the main process ends with 3.
//   2, 4  reserved for Mindcraft's task framework.

import fs from 'node:fs';
import process from 'node:process';
import { EXIT, classifyKick } from './kicks.js';

export const REQUESTED_RESTART = 'requested_restart';
const TASK_CODES = new Set([2, 4]);
const STOP_SIGNALS = new Set(['SIGINT', 'SIGTERM']);
// The file holds one small JSON object; anything bigger is not ours.
export const MAX_EXIT_REASON_BYTES = 4096;

/** Reads and validates the agent's exit-reason file; null if absent, too big or malformed. */
export function readExitReason(file, { readFile = fs.readFileSync, stat = fs.statSync } = {}) {
    if (!file) return null;
    try {
        const st = stat(file);
        if (!st.isFile() || st.size > MAX_EXIT_REASON_BYTES) return null;
    } catch { return null; }
    let raw;
    try { raw = readFile(file, 'utf8'); } catch { return null; }
    let r;
    try { r = JSON.parse(raw); } catch { return null; }
    if (!r || typeof r !== 'object') return null;
    const category = typeof r.category === 'string' ? r.category.slice(0, 64) : null;
    const exitCode = [EXIT.CLEAN, EXIT.TRANSIENT, EXIT.FATAL].includes(r.exitCode) ? r.exitCode : null;
    if (!category || exitCode === null) return null;
    const out = { category, exitCode, fatal: exitCode === EXIT.FATAL };
    if (Number.isInteger(r.retryCap) && r.retryCap > 0) out.retryCap = r.retryCap;
    return out;
}

/** Best effort: writes {category, exitCode, retryCap?} to the file the main process named. */
export function writeExitReason({ category, exitCode, retryCap }, { env = process.env, writeFile = fs.writeFileSync } = {}) {
    const file = env.MINDCRAFT_EXIT_REASON_FILE;
    if (!file) return false;
    const body = { category: String(category).slice(0, 64), exitCode };
    if (Number.isInteger(retryCap) && retryCap > 0) body.retryCap = retryCap;
    try { writeFile(file, JSON.stringify(body)); return true; } catch { return false; }
}

/**
 * Agent side: records why the agent is exiting and returns the exit code to use.
 * @param {object} o
 * @param {{category:string, exitCode:number, retryCap?:number}|null} [o.kick] forge-bridge's bridge.lastKick
 * @param {string} [o.event] 'Kicked' or 'Disconnected' (agent.js onDisconnect)
 * @param {*} [o.reason] the raw kick reason, classified when there is no bridge
 * @param {Error} [o.error] a startup error; exitCode 3 on it means fatal (auth-guard)
 * @param {boolean} [o.requestedRestart] cleanKill: a deliberate restart
 * @param {boolean} [o.clientEnded] the Minecraft connection is already gone
 */
export function recordAgentExit({ kick = null, event, reason, error, requestedRestart = false, clientEnded = false } = {}, io = {}) {
    let r;
    if (error) {
        const code = error.exitCode === EXIT.FATAL ? EXIT.FATAL : EXIT.TRANSIENT;
        r = { category: error.category ?? (code === EXIT.FATAL ? 'setup' : 'error'), exitCode: code };
    } else if (requestedRestart && !clientEnded) {
        r = { category: REQUESTED_RESTART, exitCode: EXIT.TRANSIENT };
    } else {
        // A disconnect, or cleanKill from the kicked/end handlers: report the kick.
        const k = kick ?? (event === 'Kicked' && reason != null ? classifyKick(typeof reason === 'string' ? reason : JSON.stringify(reason)) : null);
        r = k ? { category: k.category, exitCode: k.exitCode, retryCap: k.retryCap } : { category: 'disconnect', exitCode: EXIT.TRANSIENT };
    }
    writeExitReason(r, io);
    return r.exitCode;
}

/**
 * Deliberate restarts are immediate, but a runaway loop of them (more than
 * `max` within `windowMs`) falls back to the normal backoff, so a bot cannot
 * hammer the session servers with logins.
 */
export function createRequestedRestartGuard({ max = 5, windowMs = 600_000 } = {}) {
    const times = [];
    return {
        allowImmediate(now) {
            while (times.length && now - times[0] > windowMs) times.shift();
            if (times.length >= max) return false;
            times.push(now);
            return true;
        },
    };
}

/**
 * Main-process side: what to do when an agent process ends. Pure apart from the
 * policy and guard state it is given.
 * `connectedMs` is measured from spawn, not from the Minecraft login: the
 * ADR's "10 minutes connected" reset therefore includes the time to log in.
 * @returns {{action: 'none'|'exit'|'restart', code?: number, delayMs?: number, reason: string}}
 */
export function decideAgentExit({
    code, signal, requestedStop = false, restartRequested = false, singleBotService = false,
    connectedMs = 0, reason = null, now = Date.now(),
}, policy, guard = null) {
    if (restartRequested) return { action: 'none', reason: 'restart requested by the main process' };
    if (requestedStop || STOP_SIGNALS.has(signal)) {
        return singleBotService
            ? { action: 'exit', code: EXIT.CLEAN, reason: 'stop requested (single-bot service)' }
            : { action: 'none', reason: 'stop requested' };
    }
    if (code === EXIT.FATAL || (code === EXIT.TRANSIENT && reason?.fatal)) {
        return { action: 'exit', code: EXIT.FATAL, reason: reason?.category ?? 'fatal (exit 3)' };
    }
    if (TASK_CODES.has(code)) return { action: 'exit', code, reason: 'task ended' };
    if (code === EXIT.CLEAN) {
        return singleBotService ? { action: 'exit', code: EXIT.CLEAN, reason: 'clean stop (single-bot service)' } : { action: 'none', reason: 'clean stop' };
    }
    if (typeof code === 'number' && code > EXIT.FATAL) return { action: 'exit', code, reason: `exit ${code}` };
    if (code === EXIT.TRANSIENT && reason?.category === REQUESTED_RESTART && (!guard || guard.allowImmediate(now))) {
        // Adds nothing to the streak, but a long session still resets it (PR #23 review 1).
        policy.noteSession?.(connectedMs);
        return { action: 'restart', delayMs: 0, reason: REQUESTED_RESTART };
    }
    // 1, or killed by a signal the main process did not send: transient.
    const c = reason && !reason.fatal ? reason : { category: code === null ? `signal ${signal}` : 'transient', fatal: false, exitCode: EXIT.TRANSIENT };
    const next = policy.next({ ...c, exitCode: EXIT.TRANSIENT }, connectedMs);
    if (!next.restart) return { action: 'exit', code: EXIT.FATAL, reason: next.reason };
    return { action: 'restart', delayMs: next.delayMs, reason: next.reason };
}
