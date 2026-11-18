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

// Graceful stop, main-process side. SIGTERM (systemctl stop) or SIGINT (Ctrl-C):
// no more restarts; each agent gets the signal, quits its server connection
// (packages/forge-bridge/src/graceful-quit.js) and exits; then the main process
// exits 0. An agent still running after SHUTDOWN_DEADLINE_MS is killed, so the
// stop ends within a few seconds (the unit's TimeoutStopSec is 30). A second
// signal exits at once. One handler per signal source; it covers every
// AgentProcess made with that source (deps.signals, the process by default).
export const SHUTDOWN_DEADLINE_MS = 5000;
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'];
const shutdownGroups = new WeakMap();
function joinShutdownGroup(agent) {
    const { signals, exit, setTimer, clearTimer, log } = agent.deps;
    let group = shutdownGroups.get(signals);
    if (!group) {
        group = { agents: new Set(), signal: null };
        const onSignal = (signal) => {
            if (group.signal) {
                log.log(`[agent_process] ${signal} again: exiting now.`);
                exit(EXIT.CLEAN);
                return;
            }
            group.signal = signal;
            log.log(`[agent_process] ${signal}: stopping ${group.agents.size} agent(s), exiting within ${SHUTDOWN_DEADLINE_MS / 1000} s.`);
            const timer = setTimer(() => {
                for (const a of group.agents) a.killNow();
                log.log(`[agent_process] agents did not exit within ${SHUTDOWN_DEADLINE_MS / 1000} s; killed.`);
                exit(EXIT.CLEAN);
            }, SHUTDOWN_DEADLINE_MS);
            Promise.all([...group.agents].map(a => a.shutdown(signal))).then(() => {
                clearTimer(timer);
                exit(EXIT.CLEAN);
            });
        };
        for (const s of SHUTDOWN_SIGNALS) signals.on(s, onSignal);
        shutdownGroups.set(signals, group);
    }
    group.agents.add(agent);
}

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
     * @param {object} [deps] injected for tests: spawn, exit, setTimer, clearTimer, now, env, policy, guard, log, logout, reasonBase, signals
     */
    constructor(name, port, deps = {}) {
        this.name = name;
        this.port = port;
        this.deps = {
            spawn, exit: (c) => process.exit(c), setTimer: setTimeout, clearTimer: clearTimeout, now: Date.now,
            env: process.env, log: console, logout: logoutAgent, reasonBase: os.tmpdir(), signals: process,
            ...deps,
        };
        this.policy = this.deps.policy ?? createRestartPolicy();
        this.guard = this.deps.guard ?? createRequestedRestartGuard();
        this.singleBotService = this.deps.env.MINDCRAFT_SINGLE_BOT_SERVICE === '1';
        this.reasonFile = makeReasonFile(this.deps.reasonBase, this.deps.log);
        this.restartTimer = null;
        this.stopRequested = false;
        this.restartRequested = false;
        this.shuttingDown = false;
        joinShutdownGroup(this);
    }

    start(load_memory=false, init_message=null, count_id=0) {
        const d = this.deps;
        if (this.shuttingDown) return; // a stop signal came in; nothing starts again
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

    /**
     * Graceful stop for a SIGTERM/SIGINT of the main process: no restart, the agent
     * gets the same signal (it quits its server connection and exits).
     * @returns {Promise<void>} resolves when the agent process has exited
     */
    shutdown(signal = 'SIGTERM') {
        this.shuttingDown = true;
        this.cancelPendingRestart();
        if (!this.running || !this.process) return Promise.resolve();
        this.stopRequested = true;
        return new Promise((resolve) => {
            this.process.once('exit', () => resolve());
            // systemd's KillMode=control-group already signalled the agent; a second one is ignored there.
            try { this.process.kill(signal); } catch { /* already gone */ }
        });
    }

    killNow() {
        if (this.running && this.process) { try { this.process.kill('SIGKILL'); } catch { /* already gone */ } }
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
