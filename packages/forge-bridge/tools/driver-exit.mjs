// g1-driver's error logging and exit decision (ADR 0003 decision 5,
// test/runner/DRIVER.md): 0 only for a requested stop (SIGTERM/SIGINT), 3 for a
// fatal failure, 1 for everything else.
//
// G2 batch 2: Microsoft auth failed ("Failed to obtain profile data"), and nmp
// reports that only as a client 'error'. The socket never opened, so no 'end'
// followed, and with nothing left in the event loop Node exited 0. Now:
//   - an 'error' before the bot has joined ends the driver at once;
//   - an event loop that drains without a requested stop is never a clean exit (1);
//   - every exit event says whether the bot ever joined (`joined`, `beforeJoin`),
//     so the runner can tell "exited before join" from a later disconnect.
//
// Before join, an error's MESSAGE is never logged: prismarine-auth's checkStatus
// puts the whole HTTP response body in it (Xbox user, device and title auth, Live
// token refresh). Only the error class, its code (ECONNREFUSED stays visible) and a
// leading HTTP status number are logged.
//
// Exit code for a failure before join, by the HTTP status (the error's own, or for
// nmp's "Failed to obtain profile data" the status the profile-fetch diagnostics
// captured):
//   - 401, 403 (the profile fetch or Xbox) and 404 (the account does not own
//     Minecraft) are permanent: exit 3.
//   - Network errors, timeouts, 5xx and any other status are transient: exit 1.
// Auth-guard refusals and a needed device-code login exit 3 before any bot exists
// (g1-driver's fatalSetup).

import process from 'node:process';
import { classifyBeforeJoinError, PERMANENT_AUTH_STATUSES } from '../src/auth-diagnostics.js';

export { classifyBeforeJoinError, PERMANENT_AUTH_STATUSES };

/**
 * @param {{ emit: (type: string, data?: object) => void, exit?: (code: number) => void, onFinish?: () => void,
 *           profileFailure?: () => ({ status: number|null } | null) }} opts
 */
export function createExitTracker({ emit, exit = (code) => process.exit(code), onFinish = () => {}, profileFailure = () => null }) {
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
    const readProfileFailure = () => { try { return profileFailure(); } catch { return null; } };
    const tracker = {
        state,
        exitCode: code,
        /** The play-state login arrived: the bot has joined. */
        joined() { state.joined = true; },
        /** A fatal kick or failure (its category); the eventual exit is 3. */
        fatal(category) { state.fatal = category ?? 'fatal'; },
        /** A requested stop: the eventual exit is 0. */
        stopping() { state.stopping = true; },
        /**
         * bot 'error'. After join: logged with its message, and 'end' decides. Before
         * join: logged without its message, classified, and the driver ends at once.
         */
        botError(err) {
            if (state.joined) {
                emit('error', { message: String(err?.message ?? err).slice(0, 2000) });
                return;
            }
            const info = classifyBeforeJoinError(err, { profileFailure: readProfileFailure() });
            const { fatal, ...logged } = info;
            emit('error', { phase: 'before_join', ...logged });
            if (state.stopping) return;
            if (fatal) state.fatal = 'auth';
            finish('error before join', logged);
        },
        /** process 'unhandledRejection': logged the same way; it never decides the exit. */
        unhandledRejection(err) {
            if (state.joined) {
                emit('error', { message: `unhandled rejection: ${String(err?.message ?? err).slice(0, 2000)}` });
                return;
            }
            const { fatal: _fatal, ...logged } = classifyBeforeJoinError(err, { profileFailure: readProfileFailure() });
            emit('error', { phase: 'before_join', unhandledRejection: true, ...logged });
        },
        /** bot 'end'. */
        end(why, extra = {}) { finish(String(why ?? ''), extra); },
        /** process 'beforeExit': nothing left to do, and no exit was decided. */
        drained() { finish('event loop drained without a stop'); },
        finish,
    };
    return tracker;
}
