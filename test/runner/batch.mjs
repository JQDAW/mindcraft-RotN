#!/usr/bin/env node
// G3 batch runner with the spend stop (lead, #101 and #116 review). Run it inside the test-server
// batch wrapper, which deletes the server when it exits, whatever its exit code:
//
//   deploy/test-server.sh run --yes --ttl-hours 4 --seed 1880465901402976865 -- \
//     node test/runner/batch.mjs --gate --max-batch-usd 2 --logs-out captures/raw/g3/server --summary captures/raw/g3/batch.json \
//       --scenario g3-rocks-to-stone-tools --out captures/raw/g3-rocks \
//       --scenario g3-first-night --out captures/raw/g3-night \
//       -- node test/runner/drivers/mindcraft-driver.mjs --profile profiles/<g3 test profile>.json
//
// What it does:
//   0. The preflight (lead, #169 review): the driver must be the Mindcraft driver, and its arguments, the
//      profile (its model must be LLM_MODEL: profileProblems and modelProblems) and settings.js are checked
//      (driverPreflight). `deploy/test-server.sh run` runs `batch.mjs --preflight <same arguments>` BEFORE it
//      creates the server: that runs these checks plus one usage reading, and exits 0 or 2 without running
//      anything. Only after it passed does test-server.sh set ROTN_BATCH_PREFLIGHT=passed (never inherited),
//      and inside a test-server run the batch refuses without it. The batch repeats the checks itself.
//      Smoke is the default (lead, #220 decision): without --gate the summary says gate: false, smoke: true,
//      and the batch is never gate evidence. Only --gate writes gate: true (smoke: false); g3-batch-check.mjs
//      and the evidence check accept a G3 result as gate evidence only under a batch.json with gate: true.
//   1. Reads the OpenRouter key's usage (numbers only; lib/llm-spend.mjs). If it cannot, it refuses to
//      start (exit 2): a batch whose spend cannot be watched does not run.
//   2. Before each scenario, reads the usage again. If the batch has spent MORE than --max-batch-usd since
//      its start, or the usage cannot be read, it stops: no further scenario starts.
//   3. Runs each scenario through run.mjs with --param maxBatchUsd=<the limit> (an 'equal' gate parameter
//      of every G3 scenario, so a batch with another limit is never a gate pass) and --pass-env
//      OPENROUTER_API_KEY, under that scenario's runner timeout: ceil(its runMinutes + TIMEOUT_MARGIN_MIN),
//      derived from the scenario itself (lead, after #230; scenarioTimeouts). A --timeout-min before it may only
//      raise it; a lower one is refused, in the preflight too. A scenario stopped by that
//      timeout is recorded as 124 whatever run.mjs exits with (143 on SIGTERM); one whose runner cannot start
//      at all is recorded as 127. Each is recorded with its output folder and the runId from its
//      result.json, so the gate evidence check
//      (crossCheckBatch in lib/g3.mjs, test/tools/g3-batch-check.mjs) can tie every result to this batch.
//   4. Always fetches the server logs at the end (TEST_SERVER_CTL fetch logs --out <logs-out>).
//   5. After the last scenario, reads the usage once more: spend over the limit exits 5, and a failed
//      reading exits 6 (the end of a batch fails closed too; #122 review).
//   6. Prints `BATCH {json}` (and writes it to --summary): per scenario its exit code and the spend before
//      it; the totals; why it stopped; testMode. Never the key.
//   Exit: 0 if every scenario exited 0 (gate pass), 5 if the spend went over the limit (stop or end), 6 if
//   the spend could not be read at the end, 2 if it could not start, else 1. The wrapper deletes the server.
//   With --preflight: 0 if every check passed, else 2. --preflight-files (test-server.sh's --dry-run) runs
//   the same checks without the key's usage reading, so a dry run never contacts OpenRouter (#176 review nit).
//
// Limits (#122 review nits): the spend is checked BETWEEN scenarios, not during one, so a single scenario
// can run past the limit; and OpenRouter's usage figure can lag behind the newest requests by a little.
// The key's own credit limit (USD 5 for the test key) is the hard backstop behind the spend stop.
//
// The scenarios it starts carry ROTN_G3_BATCH (this batch's id and limit): a G3 run without it is not a
// gate run (run.mjs), because only a run under this spend stop counts (#122 review finding 4).
// Test mode (ROTN_TEST_MODE=1 with a fake key-usage file or a fake runner) is for the offline tests only:
// inside a real test-server run (TEST_SERVER_CTL set, TEST_SERVER_FAKE_CLOUD not 1) any of those
// variables makes it refuse to start (#122 review finding 2).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { keyFetch, readKeyUsage, spent, testOverridesAllowed, TEST_OVERRIDES } from './lib/llm-spend.mjs';
import { findBash } from './lib/adapters.mjs';
import { checkProfile, parseDriverArgs, settingsProblems } from './drivers/mindcraft-driver.mjs';
import { loadScenarios } from './run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXIT_SPEND_STOP = 5;
export const EXIT_SPEND_UNKNOWN = 6;
const MINDCRAFT_DRIVER = path.join(HERE, 'drivers', 'mindcraft-driver.mjs');
/** Set by deploy/test-server.sh run (never inherited) once `batch.mjs --preflight` passed, before the create. */
export const PREFLIGHT_MARK = 'ROTN_BATCH_PREFLIGHT';

const samePath = (a, b) => {
    const [x, y] = [path.resolve(a), path.resolve(b)];
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/**
 * The driver checks that need no server (lead, #169 review): the driver must be the Mindcraft driver, and
 * its own refusals that depend only on files run here too: its arguments (parseDriverArgs), the profile
 * with its model (checkProfile: profileProblems and modelProblems) and the settings.js main.js imports
 * (settingsProblems). The profile's bot name and the driver's environment are checked per scenario, by
 * the driver, because they come from the runner. Offline tests may use a fake driver (test mode only).
 * Returns the problems (empty = go).
 */
export async function driverPreflight(driver, env) {
    const i = driver.findIndex((a) => samePath(a, MINDCRAFT_DRIVER));
    if (i < 0) {
        return testOverridesAllowed(env) ? [] : [`the driver must be ${path.relative(process.cwd(), MINDCRAFT_DRIVER)} (a G3 batch runs the real agent, and only that driver checks its model)`];
    }
    const { options, problems } = parseDriverArgs(driver.slice(i + 1));
    const p = [...problems];
    if (options.profile) p.push(...checkProfile(options.profile).problems);
    p.push(...(await settingsProblems(options.settings)));
    return p.map((m) => `driver: ${m}`);
}

/** Test-mode overrides that would weaken a real batch: their names, if any is set while not allowed. */
export function forbiddenOverrides(env) {
    if (testOverridesAllowed(env)) return [];
    return TEST_OVERRIDES.filter((k) => Object.prototype.hasOwnProperty.call(env, k));
}

/** The end-of-batch decision: 5 over the limit, 6 without a reading, else the scenarios' exit code. */
export function endVerdict(base, end, maxBatchUsd, exit) {
    if (!end?.ok) return { exit: EXIT_SPEND_UNKNOWN, reason: `the key's usage cannot be read at the end (${end?.error ?? 'unknown'})` };
    const s = spent(base, end);
    if (s === null) return { exit: EXIT_SPEND_UNKNOWN, reason: 'the spend at the end is unknown' };
    if (s > maxBatchUsd) return { exit: EXIT_SPEND_STOP, reason: `spent USD ${s} by the end of the batch, more than maxBatchUsd ${maxBatchUsd}` };
    return { exit, reason: null };
}
const modeText = (o) => (o.gate ? 'a GATE batch (gate: true)' : 'a SMOKE batch (the default: gate: false, smoke: true, never gate evidence)');
const log = (m) => console.error(`[batch ${new Date().toISOString().slice(11, 19)}] ${m}`);

/** Minutes added to a scenario's runMinutes for its runner timeout: the runner's own console setup and teardown
 *  (the begin marker, objectives and their removal, late console replies, the closing cancel). */
export const TIMEOUT_MARGIN_MIN = 8;
/** The runner timeout of a scenario without runMinutes, in the offline test mode only (fake scenario ids). */
export const TEST_DEFAULT_TIMEOUT_MIN = 15;

/**
 * Each scenario's runner timeout, derived from the scenario itself (lead, after #230): ceil(runMinutes(its
 * defaults, with this batch's maxBatchUsd) + TIMEOUT_MARGIN_MIN). An explicit --timeout-min may only raise it:
 * one below the derived value would stop the scenario before its own limits, so it is a problem. A scenario
 * without runMinutes is a problem too, except in the offline test mode (fake ids), where --timeout-min or
 * TEST_DEFAULT_TIMEOUT_MIN is used. registry: loadScenarios() output. Returns {timeouts: [{id, timeoutMin,
 * derivedMin, runMinutes}], problems}; the scenarios are not changed.
 */
export function scenarioTimeouts(scenarios, registry, { maxBatchUsd, testMode = false } = {}) {
    const timeouts = [];
    const problems = [];
    for (const sc of scenarios) {
        const def = registry?.[sc.id];
        if (!def || typeof def.runMinutes !== 'function') {
            if (testMode) timeouts.push({ id: sc.id, timeoutMin: sc.timeoutMin ?? TEST_DEFAULT_TIMEOUT_MIN, derivedMin: null, runMinutes: null });
            else problems.push(`scenario ${sc.id}: ${def ? 'no runMinutes' : 'unknown'}, so its runner timeout cannot be derived`);
            continue;
        }
        const runMinutes = def.runMinutes({ ...def.defaults, maxBatchUsd });
        if (!(runMinutes > 0)) { problems.push(`scenario ${sc.id}: runMinutes is ${runMinutes}, not a positive number`); continue; }
        const derivedMin = Math.ceil(runMinutes + TIMEOUT_MARGIN_MIN);
        if (sc.timeoutMin !== null && sc.timeoutMin < derivedMin) {
            problems.push(`scenario ${sc.id}: --timeout-min ${sc.timeoutMin} is below its derived ${derivedMin} (runMinutes ${Math.round(runMinutes * 10) / 10} + margin ${TIMEOUT_MARGIN_MIN}); it would be stopped before its own limits`);
            continue;
        }
        timeouts.push({ id: sc.id, timeoutMin: sc.timeoutMin ?? derivedMin, derivedMin, runMinutes });
    }
    return { timeouts, problems };
}

/** Arguments: [--preflight | --preflight-files] [--gate] --max-batch-usd N --logs-out DIR [--summary FILE] ([--timeout-min M] --scenario ID --out DIR)+ -- DRIVER... */
export function parseBatchArgs(argv) {
    const o = { preflight: false, readUsage: true, gate: false, maxBatchUsd: null, logsOut: null, summary: null, scenarios: [], driver: [] };
    const problems = [];
    let timeoutMin = null;   // explicit --timeout-min only; the timeout is derived (scenarioTimeouts)
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--') { o.driver = argv.slice(i + 1); break; }
        if (a === '--preflight') o.preflight = true;
        else if (a === '--preflight-files') { o.preflight = true; o.readUsage = false; }
        // Smoke is the default; only --gate makes a gate batch (lead, #220 decision).
        else if (a === '--gate') o.gate = true;
        else if (a === '--max-batch-usd') o.maxBatchUsd = Number(argv[++i]);
        else if (a === '--logs-out') o.logsOut = argv[++i];
        else if (a === '--summary') o.summary = argv[++i];
        else if (a === '--timeout-min') timeoutMin = Number(argv[++i]);
        else if (a === '--scenario') o.scenarios.push({ id: argv[++i], out: null, timeoutMin });
        else if (a === '--out') {
            const s = o.scenarios[o.scenarios.length - 1];
            if (!s || s.out) problems.push('--out must follow its --scenario');
            else s.out = argv[++i];
        } else problems.push(`unknown argument '${a}'`);
    }
    if (!(o.maxBatchUsd > 0)) problems.push('--max-batch-usd must be a positive number of US dollars');
    if (!o.logsOut) problems.push('--logs-out is required (the logs are always fetched)');
    if (!o.scenarios.length) problems.push('at least one --scenario is required');
    for (const s of o.scenarios) {
        if (!s.out) problems.push(`--scenario ${s.id} has no --out`);
        if (s.timeoutMin !== null && !(s.timeoutMin > 0)) problems.push(`--scenario ${s.id}: --timeout-min must be positive`);
    }
    if (!o.driver.length) problems.push('the driver comes after --');
    return { options: o, problems };
}

/** The spend decision before a scenario: {go: true} or {go: false, reason}. */
export function spendGate(base, now, maxBatchUsd) {
    if (!now?.ok) return { go: false, reason: `the key's usage cannot be read (${now?.error ?? 'unknown'})` };
    const s = spent(base, now);
    if (s > maxBatchUsd) return { go: false, reason: `spent USD ${s} since the batch start, more than maxBatchUsd ${maxBatchUsd}` };
    return { go: true, spent: s };
}

/** The runId in a scenario's result.json (run.mjs writes it from the start), or null if there is none. */
export function runIdOf(outDir) {
    try {
        const id = JSON.parse(fs.readFileSync(path.join(outDir, 'result.json'), 'utf8')).runId;
        return typeof id === 'string' && id ? id : null;
    } catch {
        return null;
    }
}

/** Run one scenario (the runner is run.mjs; tests may swap it in test mode). Resolves the exit code. */
export function runOne(s, o, env, { spawnImpl = spawn } = {}) {
    const runner = testOverridesAllowed(env) && env.ROTN_BATCH_RUNNER ? env.ROTN_BATCH_RUNNER : path.join(HERE, 'run.mjs');
    const args = [runner, '--scenario', s.id, '--out', s.out, '--param', `maxBatchUsd=${o.maxBatchUsd}`, '--pass-env', 'OPENROUTER_API_KEY', '--', ...o.driver];
    return new Promise((resolve) => {
        let timedOut = false;
        let done = false;
        const settle = (code) => { if (!done) { done = true; clearTimeout(timer); resolve(code); } };
        const child = spawnImpl(process.execPath, args, { stdio: 'inherit', env });
        const timer = setTimeout(() => {
            timedOut = true;
            log(`${s.id}: timeout after ${s.timeoutMin} min, stopping it`);
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 20000).unref();
        }, s.timeoutMin * 60000);
        // A timeout is 124 whatever the runner's own exit was (run.mjs exits 143 on SIGTERM; #122 nit 3).
        child.on('exit', (code, signal) => settle(timedOut ? 124 : signal || code === null ? 124 : code));
        // The runner could not start (#122 nit 4): logged and recorded as 127, and the batch goes on to its
        // end-of-batch spend check, the log fetch and the summary.
        child.on('error', (e) => {
            log(`${s.id}: the runner could not start (${e.code ?? e.message})`);
            settle(127);
        });
    });
}

async function main(argv) {
    const { options: o, problems } = parseBatchArgs(argv);
    if (problems.length) {
        for (const p of problems) log(`refused: ${p}`);
        return 2;
    }
    const forbidden = forbiddenOverrides(process.env);
    if (forbidden.length) {
        log(`refused: ${forbidden.join(', ')} set inside a real test-server run; test-mode overrides are for the offline tests only`);
        return 2;
    }
    // The driver's file checks (the model among them) run before the usage reading and, through
    // test-server.sh's --preflight call, before any server exists (lead, #169 review).
    const pre = await driverPreflight(o.driver, process.env);
    if (pre.length) {
        for (const p of pre) log(`refused: ${p}`);
        return 2;
    }
    // Each scenario's runner timeout comes from the scenario (lead, after #230), in the preflight too.
    const tos = scenarioTimeouts(o.scenarios, await loadScenarios(), { maxBatchUsd: o.maxBatchUsd, testMode: testOverridesAllowed(process.env) });
    if (tos.problems.length) {
        for (const p of tos.problems) log(`refused: ${p}`);
        return 2;
    }
    for (const [i, t] of tos.timeouts.entries()) {
        o.scenarios[i].timeoutMin = t.timeoutMin;
        o.scenarios[i].derivedMin = t.derivedMin;
    }
    const timeoutText = tos.timeouts.map((t) => `${t.id} ${t.timeoutMin} min`).join(', ');
    if (o.preflight && !o.readUsage) {
        log(`preflight passed (files only, a dry run): driver, profile, model and settings checked; the key's usage was not read; ${o.scenarios.length} scenario(s) (timeouts: ${timeoutText}); ${modeText(o)}`);
        return 0;
    }
    if (o.preflight) {
        const u = await readKeyUsage({ key: process.env.OPENROUTER_API_KEY, fetchImpl: keyFetch(process.env) });
        if (!u.ok) {
            log(`preflight refused: the key's usage cannot be read (${u.error}); a batch whose spend cannot be watched does not run`);
            return 2;
        }
        log(`preflight passed: driver, profile, model and settings checked; the key's usage can be read; ${o.scenarios.length} scenario(s) (timeouts: ${timeoutText}); ${modeText(o)}`);
        return 0;
    }
    // Inside a test-server run, the server exists already: the same checks must have passed before it was
    // created. deploy/test-server.sh run sets the mark only after `batch.mjs --preflight` exited 0.
    if (process.env.TEST_SERVER_CTL && process.env[PREFLIGHT_MARK] !== 'passed') {
        log(`refused: inside a test-server run without ${PREFLIGHT_MARK}=passed; start the batch as \`deploy/test-server.sh run ... -- node test/runner/batch.mjs ...\`, which runs its preflight before the create`);
        return 2;
    }
    const testMode = testOverridesAllowed(process.env);
    const batchId = `${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}-${process.pid}`;
    // The marker run.mjs requires for a gate-valid G3 run: this batch's id and its spend limit.
    const env = { ...process.env, ROTN_G3_BATCH: `${batchId}:${o.maxBatchUsd}` };
    const read = () => readKeyUsage({ key: env.OPENROUTER_API_KEY, fetchImpl: keyFetch(env) });
    const summary = { batchId, testMode, gate: o.gate, smoke: !o.gate, maxBatchUsd: o.maxBatchUsd, scenarios: [], stopped: null };
    log(`batch ${batchId}: ${modeText(o)}`);
    const base = await read();
    summary.usageAtStart = base.ok ? base.usage : null;
    if (!base.ok) {
        log(`refused: the key's usage cannot be read (${base.error}); a batch whose spend cannot be watched does not run`);
        summary.stopped = `no usage reading at the start (${base.error})`;
        summary.exit = 2;
        finish(o, summary);
        return 2;
    }
    let exit = 0;
    for (const s of o.scenarios) {
        const gate = spendGate(base, await read(), o.maxBatchUsd);
        if (!gate.go) {
            log(`spend stop before ${s.id}: ${gate.reason}`);
            summary.stopped = `before ${s.id}: ${gate.reason}`;
            exit = EXIT_SPEND_STOP;
            break;
        }
        log(`${s.id}: start (spent so far USD ${gate.spent} of ${o.maxBatchUsd}; runner timeout ${s.timeoutMin} min${s.derivedMin ? `, derived ${s.derivedMin}` : ''})`);
        const code = await runOne(s, o, env);
        // The output folder and the run's own runId tie this batch to the result.json it wrote
        // (crossCheckBatch; #122 nit 1, #129 review).
        summary.scenarios.push({ id: s.id, out: path.resolve(s.out), runId: runIdOf(s.out), exit: code, spentBefore: gate.spent, timeoutMin: s.timeoutMin });
        if (code !== 0 && exit === 0) exit = 1;
    }
    const end = await read();
    summary.usageAtEnd = end.ok ? end.usage : null;
    summary.spentUsd = spent(base, end);
    const verdict = endVerdict(base, end, o.maxBatchUsd, exit);
    if (verdict.reason) {
        log(`spend check at the end: ${verdict.reason}`);
        summary.stopped ??= `after the last scenario: ${verdict.reason}`;
    }
    summary.exit = verdict.exit;
    finish(o, summary);
    return verdict.exit;
}

/** Always: fetch the server logs, then print and write the summary. */
function finish(o, summary) {
    if (process.env.TEST_SERVER_CTL) {
        const r = spawnSync(findBash(), [process.env.TEST_SERVER_CTL, 'fetch', 'logs', '--out', o.logsOut], { stdio: 'inherit' });
        summary.logsFetched = r.status === 0;
        if (r.status !== 0) log(`log fetch failed (${r.status})`);
    } else {
        summary.logsFetched = false;
        log('TEST_SERVER_CTL is not set: no logs to fetch (not inside deploy/test-server.sh run)');
    }
    const line = JSON.stringify(summary);
    console.log(`BATCH ${line}`);
    if (o.summary) {
        fs.mkdirSync(path.dirname(path.resolve(o.summary)), { recursive: true });
        fs.writeFileSync(o.summary, `${JSON.stringify(summary, null, 2)}\n`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => {
        log(`error: ${e?.message ?? e}`);
        process.exitCode = 1;
    });
}
