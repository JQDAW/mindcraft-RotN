// Graceful stop on SIGTERM/SIGINT, agent side (G4: "how to stop it").
//
// A `systemctl stop` (KillMode=control-group) sends SIGTERM to the main process
// and the agent process at once. Without a handler Node dies on the spot, the
// TCP connection is reset, and the server logs "lost connection: Connection
// reset by peer" (CX23 runs, 2026-11-08). With this handler the agent quits the
// server connection (bot.quit, a FIN instead of a reset), records a clean stop
// for the main process (exit 0, category stop_signal), and exits once the
// connection has closed, or after `deadlineMs` at the latest.
// The main-process side is in src/process/agent_process.js (shutdown()).

import process from 'node:process';
import { setImmediate } from 'node:timers';

export const GRACEFUL_STOP_SIGNALS = Object.freeze(['SIGTERM', 'SIGINT']);
export const STOP_SIGNAL_CATEGORY = 'stop_signal';

// One handler per process object; the bot it quits is the newest one installed.
const installed = new WeakMap();

/**
 * @param {object} bot a mineflayer bot (bot.quit, bot.once('end'), bot.forge.recordExit)
 * @param {object} [o]
 * @param {object} [o.proc] the process (tests pass an EventEmitter with exit())
 * @param {number} [o.deadlineMs] exit after this long even if the connection did not close
 * @param {(msg:string) => void} [o.log]
 * @param {Function} [o.setTimer]
 * @returns {{stopping: string|null, dispose: () => void}}
 */
export function installGracefulQuit(bot, { proc = process, deadlineMs = 3000, log = (m) => console.log(m), setTimer = setTimeout } = {}) {
    let state = installed.get(proc);
    if (!state) {
        state = { bot: null, stopping: null, log, deadlineMs, setTimer };
        const onSignal = (signal) => {
            if (state.stopping) return; // the main process forwards the same signal; one stop is enough
            state.stopping = signal;
            const b = state.bot;
            if (b?.forge) b.forge.stopSignal = signal;
            // Writes {category: stop_signal, exitCode: 0} for the main process; 0 also without a bot.
            const code = b?.forge?.recordExit?.({}) ?? 0;
            const exit = () => proc.exit(code);
            state.log(`[forge-bridge] ${signal}: quitting the server connection, exiting within ${Math.round(state.deadlineMs / 1000)} s`);
            state.setTimer(() => {
                state.log(`[forge-bridge] the server connection did not close within ${state.deadlineMs} ms; exiting`);
                exit();
            }, state.deadlineMs);
            if (!b || b._client?.ended === true) { exit(); return; }
            // agent.js's own 'end' handler exits first (with recordExit, so also 0);
            // this one covers a bot without it (tools, harness scripts).
            b.once?.('end', () => setImmediate(exit));
            try {
                b.quit('disconnect.quitting');
            } catch (err) {
                state.log(`[forge-bridge] quit failed (${err?.message ?? err}); exiting`);
                exit();
            }
        };
        for (const s of GRACEFUL_STOP_SIGNALS) proc.on(s, onSignal);
        state.dispose = () => { for (const s of GRACEFUL_STOP_SIGNALS) proc.removeListener(s, onSignal); installed.delete(proc); };
        installed.set(proc, state);
    }
    state.bot = bot;
    state.log = log;
    state.deadlineMs = deadlineMs;
    state.setTimer = setTimer;
    return {
        get stopping() { return state.stopping; },
        dispose: () => { if (state.bot === bot) state.dispose(); },
    };
}
