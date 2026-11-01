import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { logoutAgent } from '../mindcraft/mindserver.js';
import {
    createRestartPolicy, createRequestedRestartGuard, decideAgentExit, readExitReason, EXIT,
} from '../../packages/forge-bridge/index.js';

// The contract itself (codes, decisions, the exit-reason file) lives in
// packages/forge-bridge/src/exit-contract.js; these are re-exported for callers.
export { decideAgentExit, readExitReason };

const init_agent_path = fileURLToPath(new URL('./init_agent.js', import.meta.url));

// One private mkdtemp folder per AgentProcess, removed when the main process exits.
const reasonDirs = new Set();
let reasonCleanupHooked = false;
function makeReasonFile(base, log) {
    try {
        const dir = fs.mkdtempSync(path.join(base, 'mindcraft-exit-'));
        reasonDirs.add(dir);
        if (!reasonCleanupHooked) {
            reasonCleanupHooked = true;
            process.once('exit', () => {
                for (const d of reasonDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
            });
        }
        return path.join(dir, 'reason.json');
    } catch (err) {
        // Without the file the contract still works on exit codes alone.
        log.error(`[agent_process] no exit-reason folder (${err.message}); using exit codes only`);
        return null;
    }
}
const TASK_CODES = new Set([2, 4]);

// Exit-code contract, ADR 0003 decision 5 (net-forge brief item 8):
//   0  clean stop: not restarted. A single-bot service (MINDCRAFT_SINGLE_BOT_SERVICE=1,
//      set by the mindcraft-rotn@<bot> unit) ends the main process with 0, also after
//      a requested stop (mindserver stopAgent/destroyAgent), so systemd sees the stop.
//   1  transient: restarted in-process with backoff. A deliberate restart
//      (requested_restart) restarts at once without touching the backoff.
//   3  fatal: not restarted; the main process ends with 3 and logs a line for the human.
//      In multi-bot mode (one main process, several agents) this ends the main
//      process and so stops the sibling agents too, as upstream's "code > 1" did:
//      run each bot as its own single-bot service if one bot must not stop the others.
//   2, 4  reserved for Mindcraft's task framework: the main process ends with that code.
// The agent writes {category, exitCode, retryCap?} to MINDCRAFT_EXIT_REASON_FILE
// before it exits (bot.forge.recordExit). The file sits in a private mkdtemp folder
// per agent, so its path is not predictable.
export class AgentProcess {
    /**
     * @param {string} name
     * @param {number} port
     * @param {object} [deps] injected for tests: spawn, exit, setTimer, clearTimer, now, env, policy, guard, log, logout, reasonBase
     */
    constructor(name, port, deps = {}) {
        this.name = name;
        this.port = port;
        this.deps = {
            spawn, exit: (c) => process.exit(c), setTimer: setTimeout, clearTimer: clearTimeout, now: Date.now,
            env: process.env, log: console, logout: logoutAgent, reasonBase: os.tmpdir(),
            ...deps,
        };
        this.policy = this.deps.policy ?? createRestartPolicy();
        this.guard = this.deps.guard ?? createRequestedRestartGuard();
        this.singleBotService = this.deps.env.MINDCRAFT_SINGLE_BOT_SERVICE === '1';
        this.reasonFile = makeReasonFile(this.deps.reasonBase, this.deps.log);
        this.restartTimer = null;
        this.stopRequested = false;
        this.restartRequested = false;
    }

    start(load_memory=false, init_message=null, count_id=0) {
        const d = this.deps;
        this.count_id = count_id;
        this.running = true;
        this.stopRequested = false;
        this.restartRequested = false;
        this.restartTimer = null;

        let args = [init_agent_path, this.name];
        args.push('-n', this.name);
        args.push('-c', count_id);
        if (load_memory)
            args.push('-l', load_memory);
        if (init_message)
            args.push('-m', init_message);
        args.push('-p', this.port);

        const reasonFile = this.reasonFile;
        if (reasonFile) { try { fs.rmSync(reasonFile, { force: true }); } catch { /* not there */ } }

        const agentProcess = d.spawn(process.execPath, args, {
            stdio: 'inherit',
            stderr: 'inherit',
            env: reasonFile ? { ...d.env, MINDCRAFT_EXIT_REASON_FILE: reasonFile } : { ...d.env },
        });
        // "Connected" time for the backoff reset is measured from spawn.
        const startedAt = d.now();

        agentProcess.on('exit', (code, signal) => {
            d.log.log(`Agent process exited with code ${code} and signal ${signal}`);
            this.running = false;
            d.logout(this.name);
            const reason = readExitReason(reasonFile);
            if (reasonFile) { try { fs.rmSync(reasonFile, { force: true }); } catch { /* not there */ } }

            const decision = decideAgentExit({
                code, signal, requestedStop: this.stopRequested, restartRequested: this.restartRequested,
                singleBotService: this.singleBotService, connectedMs: d.now() - startedAt, reason, now: d.now(),
            }, this.policy, this.guard);
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
        if (!this.running) {
            // A single-bot service waiting out a backoff: the stop ends the main process (systemd sees it).
            if (this.singleBotService) this.deps.exit(EXIT.CLEAN);
            return;
        }
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
            this.restartRequested = true; // not a stop: the once('exit') above restarts it
            this.stop(); // sends SIGINT
        } else {
             this.start(true, 'Agent process restarted.', this.count_id);
        }
    }
}
