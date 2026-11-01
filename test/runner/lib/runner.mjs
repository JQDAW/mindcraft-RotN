// Scenario engine. A scenario is a module exporting
//   { id, gate, title, checks: {name: readyToTryItem}, defaults: {...params},
//     gateParams: {param: 'min' | 'equal'}, async run(ctx) }
// run(ctx) drives a test server and a bot and calls ctx.check(name, pass, detail) for each check.
// The engine is I/O-free: the server, bot and clock are injected, so unit tests can run a
// 10-minute scenario on a fake clock in milliseconds.
//
//   server: { console(cmd, waitS) -> string[] (new log lines), log(n) -> string[] (tail) }
//   bot:    { start(env), stop() -> Promise, alive() -> bool, exitCode() -> number|null, output() -> string[] }
//   clock:  { now() -> ms, sleep(ms) -> Promise }

/** Poll fn() every pollMs until it returns a truthy value or timeoutMs passes. Returns the value or null. */
export async function waitFor(clock, fn, timeoutMs, pollMs) {
    const end = clock.now() + timeoutMs;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (clock.now() >= end) return null;
        await clock.sleep(Math.min(pollMs, Math.max(1, end - clock.now())));
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
 * Run one scenario. Returns the result object (also what run.mjs writes as result.json).
 * Every declared check appears in the result: a check the scenario never reached is a FAIL with
 * detail "not reached", so a crash or early stop can never look like a pass.
 */
export async function runScenario(scenario, { server, bot, clock, params = {}, runId, log = () => {} }) {
    const p = { ...scenario.defaults, ...params };
    const results = new Map();
    const notes = {};
    const notGate = [];
    const ctx = {
        server, bot, clock, params: p, runId, log,
        check(name, pass, detail) {
            if (!(name in scenario.checks)) throw new Error(`scenario ${scenario.id} has no check '${name}'`);
            results.set(name, { check: name, pass: Boolean(pass), detail: String(detail ?? '') });
            log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail ?? ''}`);
        },
        note(key, value) { notes[key] = value; },
        // The run cannot count for the gate (e.g. its gate data is missing), whatever its checks say.
        notGate(reason) { notGate.push(String(reason)); log(`not a gate run: ${reason}`); },
        waitFor: (fn, timeoutMs, pollMs = p.pollMs) => waitFor(clock, fn, timeoutMs, pollMs),
    };
    const started = clock.now();
    let error = null;
    try {
        await scenario.run(ctx);
    } catch (e) {
        error = e?.stack ?? String(e);
        log(`scenario error: ${error}`);
    } finally {
        if (bot.alive()) await bot.stop();
    }
    const checks = Object.entries(scenario.checks).map(([name, readyToTry]) => ({
        ...(results.get(name) ?? { check: name, pass: false, detail: error ? 'not reached (scenario error)' : 'not reached' }),
        readyToTry,
    }));
    const passed = checks.filter((c) => c.pass).length;
    const checksPassed = !error && passed === checks.length;
    const weakened = [...weakenedParams(scenario, p), ...notGate];
    const gateValid = weakened.length === 0;
    if (!gateValid) log(`SMOKE run, not a ${scenario.gate} pass: ${weakened.join(', ')}`);
    return {
        scenario: scenario.id, gate: scenario.gate, title: scenario.title, runId,
        // pass means "counts for the gate"; a weakened run never does (PR #9 review finding 1).
        pass: checksPassed && gateValid, checksPassed, gateValid, weakenedParams: weakened,
        verdict: checksPassed ? (gateValid ? 'PASS' : 'SMOKE-PASS (not a gate pass)') : 'FAIL',
        passed, failed: checks.length - passed,
        durationS: Math.round((clock.now() - started) / 1000), params: p, checks, notes,
        botExitCode: bot.exitCode(), error,
    };
}
