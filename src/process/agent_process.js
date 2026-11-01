import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { logoutAgent } from '../mindcraft/mindserver.js';
import { createRestartPolicy, EXIT } from '../../packages/forge-bridge/index.js';

const init_agent_path = fileURLToPath(new URL('./init_agent.js', import.meta.url));

// Exit-code contract, ADR 0003 decision 5 (net-forge brief item 8):
//   0  clean stop. Not restarted. A single-bot service (MINDCRAFT_SINGLE_BOT_SERVICE=1,
//      set by the mindcraft-rotn@<bot> unit) ends the main process with 0 too.
//   1  transient. Restarted in-process with backoff: 10 s doubling to 5 min, reset
//      after 10 min connected (createRestartPolicy in packages/forge-bridge).
//   3  fatal. Not restarted; the main process ends with 3 and logs a line for the human.
//   2, 4  reserved for Mindcraft's task framework: the main process ends with that code.
// The agent may also write {category, exitCode, retryCap?} as JSON to the file named
// by MINDCRAFT_EXIT_REASON_FILE before it exits (for example from
// bot.forge.bridge.lastKick). Then a fatal kick is fatal even if the process exit
// code was 1, and a capped category (auth) becomes fatal at its cap.
const TASK_CODES = new Set([2, 4]);
const REQUESTED_STOP_SIGNALS = new Set(['SIGINT', 'SIGTERM']);

/** Reads and validates the agent's exit-reason file; null if absent or malformed. */
export function readExitReason(file, { readFile = fs.readFileSync } = {}) {
    if (!file) return null;
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

/**
 * What the main process does when an agent process ends. Pure, so it is unit-tested.
 * @returns {{action: 'none'|'exit'|'restart', code?: number, delayMs?: number, reason: string}}
 */
export function decideAgentExit({ code, signal, requestedStop = false, singleBotService = false, connectedMs = 0, reason = null }, policy) {
    if (requestedStop || REQUESTED_STOP_SIGNALS.has(signal)) return { action: 'none', reason: 'stop requested' };
    if (code === EXIT.FATAL || (code === EXIT.TRANSIENT && reason?.fatal)) {
        return { action: 'exit', code: EXIT.FATAL, reason: reason?.category ?? 'fatal (exit 3)' };
    }
    if (TASK_CODES.has(code)) return { action: 'exit', code, reason: 'task ended' };
    if (code === EXIT.CLEAN) {
        return singleBotService ? { action: 'exit', code: EXIT.CLEAN, reason: 'clean stop (single-bot service)' } : { action: 'none', reason: 'clean stop' };
    }
    if (typeof code === 'number' && code > EXIT.FATAL) return { action: 'exit', code, reason: `exit ${code}` };
    // 1, or killed by a signal we did not send: transient.
    const c = reason && !reason.fatal ? reason : { category: code === null ? `signal ${signal}` : 'transient', fatal: false, exitCode: EXIT.TRANSIENT };
    const next = policy.next({ ...c, exitCode: EXIT.TRANSIENT }, connectedMs);
    if (!next.restart) return { action: 'exit', code: EXIT.FATAL, reason: next.reason };
    return { action: 'restart', delayMs: next.delayMs, reason: next.reason };
}

export class AgentProcess {
    /**
     * @param {string} name
     * @param {number} port
     * @param {object} [deps] injected for tests: spawn, exit, setTimer, clearTimer, now, env, policy, log, logout, reasonDir
     */
    constructor(name, port, deps = {}) {
        this.name = name;
        this.port = port;
        this.deps = {
            spawn, exit: (c) => process.exit(c), setTimer: setTimeout, clearTimer: clearTimeout, now: Date.now,
            env: process.env, log: console, logout: logoutAgent, reasonDir: os.tmpdir(),
            ...deps,
        };
        this.policy = this.deps.policy ?? createRestartPolicy();
        this.singleBotService = this.deps.env.MINDCRAFT_SINGLE_BOT_SERVICE === '1';
        this.restartTimer = null;
        this.stopRequested = false;
    }

    start(load_memory=false, init_message=null, count_id=0) {
        const d = this.deps;
        this.count_id = count_id;
        this.running = true;
        this.stopRequested = false;
        this.restartTimer = null;

        let args = [init_agent_path, this.name];
        args.push('-n', this.name);
        args.push('-c', count_id);
        if (load_memory)
            args.push('-l', load_memory);
        if (init_message)
            args.push('-m', init_message);
        args.push('-p', this.port);

        const reasonFile = path.join(d.reasonDir, `mindcraft-exit-${this.name.replace(/[^A-Za-z0-9_-]/g, '_')}-${process.pid}.json`);
        try { fs.rmSync(reasonFile, { force: true }); } catch { /* not there */ }

        const agentProcess = d.spawn(process.execPath, args, {
            stdio: 'inherit',
            stderr: 'inherit',
            env: { ...d.env, MINDCRAFT_EXIT_REASON_FILE: reasonFile },
        });
        const startedAt = d.now();

        agentProcess.on('exit', (code, signal) => {
            d.log.log(`Agent process exited with code ${code} and signal ${signal}`);
            this.running = false;
            d.logout(this.name);
            const reason = readExitReason(reasonFile);
            try { fs.rmSync(reasonFile, { force: true }); } catch { /* not there */ }

            const decision = decideAgentExit({
                code, signal, requestedStop: this.stopRequested, singleBotService: this.singleBotService,
                connectedMs: d.now() - startedAt, reason,
            }, this.policy);
            this.lastDecision = decision;

            if (decision.action === 'exit') {
                if (decision.code === EXIT.FATAL) {
                    d.log.error(`[agent_process] ${this.name}: FATAL (${decision.reason}). Not restarting; a human must act (see coord/NEEDS-HUMAN.md).`);
                } else if (TASK_CODES.has(decision.code)) {
                    d.log.log(`Ending task`);
                } else {
                    d.log.log(`[agent_process] ${this.name}: ${decision.reason}; ending the main process with ${decision.code}.`);
                }
                d.exit(decision.code);
            } else if (decision.action === 'restart') {
                d.log.log(`[agent_process] ${this.name}: ${decision.reason}; restarting in ${Math.round(decision.delayMs / 1000)} s.`);
                this.restartTimer = d.setTimer(() => {
                    this.restartTimer = null;
                    this.start(true, 'Agent process restarted.', this.count_id);
                }, decision.delayMs);
            }
        });

        agentProcess.on('error', (err) => {
            d.log.error('Agent process error:', err);
        });

        this.process = agentProcess;
    }

    cancelPendingRestart() {
        if (this.restartTimer) {
            this.deps.clearTimer(this.restartTimer);
            this.restartTimer = null;
        }
    }

    stop() {
        this.cancelPendingRestart();
        if (!this.running) return;
        this.stopRequested = true;
        this.process.kill('SIGINT');
    }

    forceRestart() {
        this.cancelPendingRestart();
        if (this.running && this.process && !this.process.killed) {
            console.log(`Agent process for ${this.name} is still running. Attempting to force restart.`);

            const restartTimeout = setTimeout(() => {
                console.warn(`Agent ${this.name} did not stop in time. It might be stuck.`);
            }, 5000); // 5 seconds to exit

            this.process.once('exit', () => {
                 clearTimeout(restartTimeout);
                 console.log(`Stopped hanging agent ${this.name}. Now restarting.`);
                 this.start(true, 'Agent process restarted.', this.count_id);
            });
            this.stop(); // sends SIGINT
        } else {
             this.start(true, 'Agent process restarted.', this.count_id);
        }
    }
}
