// g1-driver's exit decision (ADR 0003 decision 5, test/runner/DRIVER.md):
// 0 only for a requested stop (SIGTERM/SIGINT); 3 after a fatal kick; 1 for
// everything else, including a login that fails before the bot joins.
//
// G2 batch 2: Microsoft auth failed ("Failed to obtain profile data"), and nmp
// reports that only as a client 'error'. The socket never opened, so no 'end'
// followed, and with nothing left in the event loop Node exited 0. Now:
//   - an 'error' before the bot has joined ends the driver at once (1, or 3 if a
//     fatal kick was seen);
//   - an event loop that drains without a requested stop is never a clean exit (1);
//   - every exit event says whether the bot ever joined (`joined`, `beforeJoin`),
//     so the runner can tell "exited before join" from a later disconnect.
// Fatal setup errors (auth-guard refusals, a needed device-code login) exit 3
// before any bot exists (g1-driver's fatalSetup).

import process from 'node:process';

const safeName = (s) => (typeof s === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(s) ? s : null);

/**
 * @param {{ emit: (type: string, data?: object) => void, exit?: (code: number) => void, onFinish?: () => void }} opts
 */
export function createExitTracker({ emit, exit = (code) => process.exit(code), onFinish = () => {} }) {
    const state = { joined: false, stopping: false, fatal: null, finished: false };
    const code = () => (state.stopping ? 0 : state.fatal ? 3 : 1);
    const finish = (reason, extra = {}) => {
        if (state.finished) return;
        state.finished = true;
        const exitCode = code();
        emit('end', { reason, exitCode, joined: state.joined, beforeJoin: !state.joined, ...extra });
        try { onFinish(); } catch { /* best effort */ }
        exit(exitCode);
    };
    return {
        state,
        exitCode: code,
        /** The play-state login arrived: the bot has joined. */
        joined() { state.joined = true; },
        /** A fatal kick (its category); the eventual exit is 3. */
        fatal(category) { state.fatal = category ?? 'fatal'; },
        /** A requested stop: the eventual exit is 0. */
        stopping() { state.stopping = true; },
        /** bot 'error': before join it ends the driver; after join, 'end' does. */
        error(err) {
            if (state.joined || state.stopping) return;
            finish('error before join', { errorClass: safeName(err?.name) ?? safeName(err?.constructor?.name) ?? typeof err });
        },
        /** bot 'end'. */
        end(why, extra = {}) { finish(String(why ?? ''), extra); },
        /** process 'beforeExit': nothing left to do, and no exit was decided. */
        drained() { finish('event loop drained without a stop'); },
        finish,
    };
}
