// Scenario engine. A scenario is a module exporting
//   { id, gate, title, checks: {name: readyToTryItem}, defaults: {...params},
//     gateParams: {param: 'min' | 'equal'}, async run(ctx) }
// run(ctx) drives a test server and a bot and calls ctx.check(name, pass, detail) for each check.
// The engine is I/O-free: the server, bot and clock are injected, so unit tests can run a
// 10-minute scenario on a fake clock in milliseconds.
//
//   server: { console(cmd, waitS) -> string[] (new log lines), log(n) -> string[] (tail) }
//   bot:    { start(env), stop() -> Promise, alive() -> bool, exitCode() -> number|null, output() -> string[],
//             exitSignal?() -> string|null }
//   result.botExitCode: the driver's exit code; 128 means it ended by a signal (botExitSignal), which
//   is what the runner's own SIGTERM at the end of every scenario gives (botStoppedByRunner: true).
//   clock:  { now() -> ms, sleep(ms) -> Promise }

/** Poll fn() every pollMs until it returns a truthy value or timeoutMs passes. Returns the value or null. */
export async function waitFor(clock, fn, timeoutMs, pollMs) {
    // A scenario without a pollMs default once made this sleep NaN and never time out (P1, offline):
    // a missing or bad poll interval is 1 s.
    const step = Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 1000;
    const end = clock.now() + timeoutMs;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (clock.now() >= end) return null;
        await clock.sleep(Math.min(step, Math.max(1, end - clock.now())));
    }
}

/**
 * Parameters that make a run weaker than the gate allows: lower than the default for 'min',
 * different for 'equal'. A weakened run can pass its checks but is never a gate pass.
 */
export function weakenedParams(scenario, params) {
    const out = [];
    for (const [k, rule] of Object.entries(scenario.gateParams ?? {})) {
        const d = scenario.defaults[k];
        const v = params[k] ?? d;
        if ((rule === 'min' && !(v >= d)) || (rule === 'equal' && v !== d)) out.push(`${k}=${v} (gate needs ${rule === 'min' ? '>=' : '='} ${d})`);
    }
    return out;
}

/**
 * Mark a finished result as not a gate run, after the fact (e.g. its LLM cost could not be read): the
 * reason joins weakenedParams, and pass, gateValid and the verdict follow the same rule as in runScenario.
 */
export function addNotGate(result, reason) {
    result.weakenedParams = [...(result.weakenedParams ?? []), String(reason)];
    result.gateValid = false;
    result.pass = false;
    if (result.verdict === 'PASS') result.verdict = 'SMOKE-PASS (not a gate pass)';
    return result;
}

/** notes.killed in a progress record (P2, lead after G2 batch 6). */
export const KILLED_NOTE = 'the runner did not finish: it rewrites result.json after every check and replaces it when the run ends, '
    + 'so a file that still says this was left by a killed (e.g. `timeout`) or crashed runner. Never a pass.';

/**
 * Run one scenario. Returns the result object (also what run.mjs writes as result.json).
 * Every declared check appears in the result: a check the scenario never reached is a FAIL with
 * detail "not reached", so a crash or early stop can never look like a pass.
 *
 * onProgress(record), if given, is called at the start and after every check, note and notGate with a
 * PROGRESS record: the checks and notes so far, `pass: false`, `gateValid: false`, `verdict: 'FAIL (killed)'`
 * and notes.killed.
 * run.mjs writes it as result.json, so a runner killed by `timeout` leaves the checks it had done
 * (G2 batch 6: on Windows `timeout` ends node with TerminateProcess, so no signal handler runs).
 * progress(killedBy) returns the same record on demand, with notes.killed naming the signal.
 */
export async function runScenario(scenario, { server, bot, clock, params = {}, runId, log = () => {}, onProgress = null, control = {} }) {
    const p = { ...scenario.defaults, ...params };
    const results = new Map();
    const notes = {};
    const notGate = [];
    const started = clock.now();
    let botStoppedByRunner = false;
    // The result, final or (killed set) a progress record that can never pass.
    const build = (error, killed = null) => {
        const checks = Object.entries(scenario.checks).map(([name, readyToTry]) => ({
            ...(results.get(name) ?? { check: name, pass: false,
                detail: killed ? 'not reached (runner killed)' : error ? 'not reached (scenario error)' : 'not reached' }),
            readyToTry,
        }));
        const passed = checks.filter((c) => c.pass).length;
        const checksPassed = !killed && !error && passed === checks.length;
        const weakened = [...weakenedParams(scenario, p), ...notGate];
        // A killed run is never gate-valid either (lead, #92 review), whatever its parameters.
        const gateValid = !killed && weakened.length === 0;
        return {
            scenario: scenario.id, gate: scenario.gate, title: scenario.title, runId,
            // pass means "counts for the gate"; a weakened run never does (PR #9 review finding 1).
            pass: checksPassed && gateValid, checksPassed, gateValid, weakenedParams: weakened,
            verdict: killed ? 'FAIL (killed)' : checksPassed ? (gateValid ? 'PASS' : 'SMOKE-PASS (not a gate pass)') : 'FAIL',
            passed, failed: checks.length - passed,
            durationS: Math.round((clock.now() - started) / 1000), params: p, checks,
            notes: killed ? { ...notes, killed } : notes,
            botExitCode: bot.exitCode(), botExitSignal: typeof bot.exitSignal === 'function' ? bot.exitSignal() : null, botStoppedByRunner,
            error: killed ? 'runner killed before the scenario finished' : error,
        };
    };
    const progress = (killedBy = null) => build(null, killedBy ? `${KILLED_NOTE} Killed by ${killedBy}.` : KILLED_NOTE);
    control.progress = progress;
    const report = () => { if (onProgress) onProgress(progress()); };
    const ctx = {
        server, bot, clock, params: p, runId, log,
        check(name, pass, detail) {
            if (!(name in scenario.checks)) throw new Error(`scenario ${scenario.id} has no check '${name}'`);
            results.set(name, { check: name, pass: Boolean(pass), detail: String(detail ?? '') });
            log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail ?? ''}`);
            report();
        },
        note(key, value) { notes[key] = value; report(); },
        // The run cannot count for the gate (e.g. its gate data is missing), whatever its checks say.
        notGate(reason) { notGate.push(String(reason)); log(`not a gate run: ${reason}`); report(); },
        waitFor: (fn, timeoutMs, pollMs = p.pollMs) => waitFor(clock, fn, timeoutMs, pollMs),
    };
    let error = null;
    report();
    try {
        await scenario.run(ctx);
    } catch (e) {
        error = e?.stack ?? String(e);
        log(`scenario error: ${error}`);
    } finally {
        // A driver still running at the end is stopped by the runner (SIGTERM). Its exit code is then
        // 128 (adapters.mjs: "ended by a signal") with botExitSignal "SIGTERM" and botStoppedByRunner
        // true: the normal end of a scenario, not a crash (G2 batch 5, lead question 3).
        // The service adapter (G4 set-up S, #371 review): stop once a start was sent (needsStop), even when alive()
        // fails or a failed start left the unit's state unknown; a throwing alive() never skips the stop.
        let alive = true;
        try { alive = bot.alive(); } catch (e) { log(`bot.alive() failed at the end (${e?.message ?? e}); stopping it anyway`); }
        if (alive || bot.needsStop?.() === true) {
            botStoppedByRunner = true;
            try { await bot.stop(); } catch (e) {
                log(`bot.stop() failed: ${e?.message ?? e}`);
                if (!error) error = `bot.stop() failed at the end: ${e?.message ?? e}`;
            }
        }
    }
    const result = build(error);
    if (!result.gateValid) log(`SMOKE run, not a ${scenario.gate} pass: ${result.weakenedParams.join(', ')}`);
    return result;
}
