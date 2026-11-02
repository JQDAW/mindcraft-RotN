// The agent's update loop and its error reporting (skills-rotn A3).
//
// Upstream ran `while (true) await this.update()` with no try/catch, so one
// throwing mode (for example a modded block with no name) ended the loop for
// good: no reflexes and no self-prompting until a restart. Here a throw is
// logged, rate-limited, and the loop carries on with the next tick.
import { safeError } from './safe_error.js';

/**
 * A reporter that logs at most one line per key every `everyMs`, counting the
 * throws it held back in between, so a mode that throws every 300 ms tick
 * cannot flood the log.
 * @returns {(key: string, err: unknown) => boolean} true when it logged
 */
export function createErrorReporter(label, { everyMs = 30_000, now = Date.now, log = (line) => console.error(line) } = {}) {
    const seen = new Map(); // key -> { at, suppressed }
    return (key, err) => {
        const t = now();
        const entry = seen.get(key);
        if (entry && t - entry.at < everyMs) {
            entry.suppressed++;
            return false;
        }
        const held = entry ? entry.suppressed : 0;
        seen.set(key, { at: t, suppressed: 0 });
        log(`[${label}] ${key} threw${held ? ` (${held} more since the last report)` : ''}: ${safeError(err)}`);
        return true;
    };
}

/**
 * Calls `step(delta)` one at a time, at most once per `interval` ms, even when
 * a step takes longer than that. A step that throws goes to `onError`; the
 * loop continues. Runs until `shouldStop()` is true (never, for the agent).
 */
export async function runUpdateLoop(step, {
    interval = 300,
    onError = () => {},
    shouldStop = () => false,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
    let last = now();
    while (!shouldStop()) {
        const start = now();
        try {
            await step(start - last);
        } catch (err) {
            onError(err);
        }
        const remaining = interval - (now() - start);
        if (remaining > 0) await sleep(remaining);
        last = start;
    }
}
