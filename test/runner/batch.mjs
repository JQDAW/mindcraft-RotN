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
//   the spend could not be read at the end, 2 if it could not start, 125 if the LLM-failure rule stopped a
//   scenario (an infra fault: the model did not answer; summary.infraFault, and the scenario's result.json says
//   "INFRA FAULT"), else 1 (a check failed). The wrapper deletes the server.
//   Per scenario: 124 timeout, 125 LLM-failure stop, 127 the runner could not start, else the runner's own exit.
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
import { countLlmReplies, keyFetch, probeFetch, probeModel, readKeyUsage, spent, testOverridesAllowed, TEST_OVERRIDES } from './lib/llm-spend.mjs';
import { findBash, notStarted, retryNotStarted } from './lib/adapters.mjs';
import { INFRA_FAULT_EXIT, LLM_MODEL } from './lib/g3.mjs';
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
/** An explicit --timeout-min may raise the derived timeout up to this many times it, no further (lead, after #231). */
export const TIMEOUT_CAP_FACTOR = 3;
/** The TTL check (lead, after #231): minutes allowed for the server build before the batch starts (observed
 *  3-5 min), and for the log fetch and teardown after its last scenario. */
export const BUILD_ALLOWANCE_MIN = 20;
export const END_ALLOWANCE_MIN = 5;
/** The runner timeout of a scenario without runMinutes, in the offline test mode only (fake scenario ids). */
export const TEST_DEFAULT_TIMEOUT_MIN = 15;

/**
 * Each scenario's runner timeout, derived from the scenario itself (lead, after #230): ceil(runMinutes(its
 * defaults, with this batch's maxBatchUsd) + TIMEOUT_MARGIN_MIN). An explicit --timeout-min may only raise it,
 * up to TIMEOUT_CAP_FACTOR times the derived value: one below would stop the scenario before its own limits, and
 * one above lets a hung scenario run on (spend and server time), so both are problems. A --timeout-min applies
 * to its following --scenario AND every later one, until the next --timeout-min (parseBatchArgs). A scenario
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
        if (sc.timeoutMin !== null && sc.timeoutMin > TIMEOUT_CAP_FACTOR * derivedMin) {
            problems.push(`scenario ${sc.id}: --timeout-min ${sc.timeoutMin} is more than ${TIMEOUT_CAP_FACTOR}x its derived ${derivedMin} (cap ${TIMEOUT_CAP_FACTOR * derivedMin}); a --timeout-min carries over to later scenarios`);
            continue;
        }
        timeouts.push({ id: sc.id, timeoutMin: sc.timeoutMin ?? derivedMin, derivedMin, runMinutes });
    }
    return { timeouts, problems };
}

/**
 * A warning, never a refusal (lead, after round 3 batch B): whether this batch could still be running at 00:00 UTC,
 * when log4j rolls the server's logs/latest.log over. The session then reads the rolled-over file too
 * (lib/session.mjs, notes.logWindow), so a run survives it; the warning says to expect that. From nowMs: buildMin
 * (the preflight: BUILD_ALLOWANCE_MIN; the batch start: 0), the runner timeouts and END_ALLOWANCE_MIN.
 * Returns the warning text, or null.
 */
export function midnightWarning(timeouts, nowMs, { buildMin = 0 } = {}) {
    const mins = buildMin + timeouts.reduce((n, t) => n + t.timeoutMin, 0) + END_ALLOWANCE_MIN;
    const end = new Date(nowMs + mins * 60000);
    if (end.toISOString().slice(0, 10) === new Date(nowMs).toISOString().slice(0, 10)) return null;
    return `this batch may run past 00:00 UTC (up to ${end.toISOString().slice(11, 16)} UTC on ${end.toISOString().slice(0, 10)}), when the server log rolls over; the session then also reads the rolled-over log (notes.logWindow)`;
}

/**
 * Whether the server lives long enough for this batch (lead, after #231). The scenarios run one after another,
 * so the batch needs the sum of their runner timeouts plus END_ALLOWANCE_MIN.
 * - ttlMinutes (the preflight, before the create: test-server.sh passes ROTN_BATCH_TTL_MINUTES): the TTL must
 *   also cover BUILD_ALLOWANCE_MIN for the build.
 * - remainingMinutes (the batch start, inside the run: minutes left before the server's delete-after): the time
 *   left must cover it, whatever the build really took.
 * Returns {needMin, problems}; a null input is not checked.
 */
export function ttlProblems(timeouts, { ttlMinutes = null, remainingMinutes = null } = {}) {
    const sum = timeouts.reduce((n, t) => n + t.timeoutMin, 0);
    const needMin = sum + END_ALLOWANCE_MIN;
    const parts = `its runner timeouts sum to ${sum} min, plus ${END_ALLOWANCE_MIN} for the logs and teardown`;
    const problems = [];
    if (ttlMinutes !== null && needMin + BUILD_ALLOWANCE_MIN > ttlMinutes) {
        problems.push(`--ttl-hours ${Math.round((ttlMinutes / 60) * 100) / 100} (${ttlMinutes} min) cannot cover this batch: ${parts} and ${BUILD_ALLOWANCE_MIN} for the build, ${needMin + BUILD_ALLOWANCE_MIN} min`);
    }
    if (remainingMinutes !== null && needMin > remainingMinutes) {
        problems.push(`only ${Math.floor(remainingMinutes)} min are left before the server's delete-after, and this batch needs ${needMin} (${parts})`);
    }
    return { needMin, problems };
}

/** Arguments: [--preflight | --preflight-files] [--gate] --max-batch-usd N --logs-out DIR [--summary FILE] ([--timeout-min M] --scenario ID --out DIR)+ -- DRIVER... */
/*  A --timeout-min applies to the --scenario after it and to every later one, until the next --timeout-min. */
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

/** The exit recorded for a scenario, and the batch, stopped by the LLM-failure rule (an infra fault, not a bot result). */
export const EXIT_LLM_STOP = INFRA_FAULT_EXIT;

/**
 * The LLM-failure stop rule (lead, round 3 continuation; #248 review): in a scenario's first windowMs (5 min)
 * counted from the bot's spawn (the driver log's "<bot> spawned." line, so the driver start, the Forge join and
 * the agent start do not eat into it), minFailed (5) or more failed LLM replies and no successful reply or memory
 * summary is an infra fault (the model does not answer), not a bot result: the scenario is stopped, and the batch
 * starts no further one.
 * - Without a spawn line the window never opens, so the rule never fires; watching stops capMs (10 min) after
 *   the scenario's start (#248 review nit, as in DRIVER.md).
 * - A late spawn gets a shorter window: it still ends at that cap, so a spawn at minute 7 leaves 3 minutes.
 * - The driver log is read every pollMs (15 s), so a stop comes up to one poll after the 5th failure, and the
 *   window's edges are only as sharp as one poll.
 * The offline tests may shorten pollMs, windowMs and capMs (ROTN_LLM_STOP_*; test mode only).
 */
export function llmStopSettings(env = {}) {
    const t = testOverridesAllowed(env);
    const n = (v, d) => (t && /^\d+$/.test(v ?? '') ? Number(v) : d);
    return {
        windowMs: n(env.ROTN_LLM_STOP_WINDOW_MS, 5 * 60000), capMs: n(env.ROTN_LLM_STOP_CAP_MS, 10 * 60000),
        pollMs: n(env.ROTN_LLM_STOP_POLL_MS, 15000), minFailed: 5,
    };
}

/** The bot's spawn in the driver log: Mindcraft prints "<bot> spawned." once the bot is in the world. */
export const SPAWNED_LINE = /^[A-Za-z0-9_]{3,16} spawned\.$/;

/** Whether the rule fires on these driver.log lines: {stop, ok, memory, failed, httpErrors}. */
export function llmStopVerdict(lines, { minFailed = 5 } = {}) {
    const r = countLlmReplies(lines);
    return { stop: r.failed >= minFailed && r.ok === 0 && r.memory === 0, ok: r.ok, memory: r.memory, failed: r.failed, httpErrors: r.httpErrors };
}

/**
 * Mark a scenario's result.json as an infra fault (#248 review): the runner wrote it as a killed run ("FAIL"),
 * which would read as a bot failure. The record keeps every check as written and gains infraFault and the verdict
 * "INFRA FAULT"; pass stays false. A missing or unreadable result.json is left alone (the summary still says it).
 */
export function markInfraFault(out, infraFault, reason) {
    const f = path.join(out, 'result.json');
    try {
        const r = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
        fs.writeFileSync(f, JSON.stringify({ ...r, verdict: 'INFRA FAULT', pass: false, infraFault: { ...infraFault, reason } }, null, 2) + '\n');
        return true;
    } catch {
        return false;
    }
}

/** Run one scenario (the runner is run.mjs; tests may swap it in test mode). Resolves the exit code. */
export function runOne(s, o, env, { spawnImpl = spawn, llmStop = llmStopSettings(env) } = {}) {
    const runner = testOverridesAllowed(env) && env.ROTN_BATCH_RUNNER ? env.ROTN_BATCH_RUNNER : path.join(HERE, 'run.mjs');
    const args = [runner, '--scenario', s.id, '--out', s.out, '--param', `maxBatchUsd=${o.maxBatchUsd}`, '--pass-env', 'OPENROUTER_API_KEY', '--', ...o.driver];
    return new Promise((resolve) => {
        let timedOut = false;
        let llmStopped = false;
        let done = false;
        const started = Date.now();
        const settle = (code) => { if (!done) { done = true; clearTimeout(timer); clearInterval(watch); resolve(code); } };
        const child = spawnImpl(process.execPath, args, { stdio: 'inherit', env });
        // The LLM-failure stop rule: read the scenario's driver.log from the bot's spawn for windowMs (capped).
        let spawnedAt = null;
        const watch = setInterval(() => {
            const now = Date.now();
            let lines = null;
            try { lines = fs.readFileSync(path.join(s.out, 'driver.log'), 'utf8').split('\n').map((l) => l.replace(/\r$/, '')); } catch { /* not yet */ }
            if (spawnedAt === null && lines?.some((l) => SPAWNED_LINE.test(l))) spawnedAt = now;
            // The window: windowMs from the spawn, cut short by the cap for a late spawn; checked once per poll (up to 15 s late).
            const end = Math.min(spawnedAt === null ? Infinity : spawnedAt + llmStop.windowMs, started + llmStop.capMs);
            if (now > end) { clearInterval(watch); return; }
            if (!lines || spawnedAt === null) return;   // the window opens at the spawn
            const v = llmStopVerdict(lines, llmStop);
            if (!v.stop || llmStopped) return;
            llmStopped = true;
            clearInterval(watch);
            const http = Object.entries(v.httpErrors).map(([st, k]) => `${k} x HTTP ${st}`).join(', ');
            s.llmStop = { failed: v.failed, ok: v.ok, memory: v.memory, httpErrors: v.httpErrors, afterSpawnS: Math.round((now - spawnedAt) / 1000), afterStartS: Math.round((now - started) / 1000) };
            log(`${s.id}: LLM-failure stop: ${v.failed} failed LLM replies and none answered within ${s.llmStop.afterSpawnS} s of the bot's spawn${http ? ` (${http})` : ''}; an infra fault, stopping it and the batch`);
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 20000).unref();
        }, llmStop.pollMs);
        const timer = setTimeout(() => {
            timedOut = true;
            log(`${s.id}: timeout after ${s.timeoutMin} min, stopping it`);
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 20000).unref();
        }, s.timeoutMin * 60000);
        // A timeout is 124 whatever the runner's own exit was (run.mjs exits 143 on SIGTERM; #122 nit 3).
        child.on('exit', (code, signal) => settle(llmStopped ? EXIT_LLM_STOP : timedOut ? 124 : signal || code === null ? 124 : code));
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
    // The server must live long enough (lead, after #231): the TTL before the create, the time left at the start.
    const realRun = Boolean(process.env.TEST_SERVER_CTL) && process.env.TEST_SERVER_FAKE_CLOUD !== '1' && !o.preflight;
    const ttlEnv = process.env.ROTN_BATCH_TTL_MINUTES;
    // TEST_SERVER_SECONDS_LEFT: the seconds before the server's delete-after, by test-server.sh's own clock.
    const leftEnv = process.env.TEST_SERVER_SECONDS_LEFT;
    if (realRun && !/^-?\d+$/.test(leftEnv ?? '')) {
        log(`refused: inside a test-server run without the time left before the server's delete-after (TEST_SERVER_SECONDS_LEFT), so it cannot be checked`);
        return 2;
    }
    const ttl = ttlProblems(tos.timeouts, {
        ttlMinutes: o.preflight && /^\d+$/.test(ttlEnv ?? '') ? Number(ttlEnv) : null,
        remainingMinutes: !o.preflight && /^-?\d+$/.test(leftEnv ?? '') ? Number(leftEnv) / 60 : null,
    });
    if (ttl.problems.length) {
        for (const p of ttl.problems) log(`refused: ${p}`);
        return 2;
    }
    // A warning only (lead, after round 3 batch B): the server rolls its log over at 00:00 UTC.
    const midnight = midnightWarning(tos.timeouts, Date.now(), { buildMin: o.preflight ? BUILD_ALLOWANCE_MIN : 0 });
    if (midnight) log(`warning: ${midnight}`);
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
        // One tiny request to the run's model (lead, after round 3: the old preset's provider answered 429 for
        // hours, and two batches ran without one LLM reply). A failed probe refuses before any server exists.
        const probeImpl = probeFetch(process.env);
        let probeText = 'the LLM probe was skipped (offline test mode, no probe file)';
        if (probeImpl) {
            const pr = await probeModel({ key: process.env.OPENROUTER_API_KEY, model: LLM_MODEL.replace(/^openrouter\//, ''), fetchImpl: probeImpl });
            if (!pr.ok) {
                log(`preflight refused: the LLM probe of ${LLM_MODEL} failed (HTTP ${pr.status ?? '-'}, provider ${pr.provider ?? 'unknown'}, ${pr.error}); no batch runs on a model that does not answer`);
                return 2;
            }
            probeText = `the LLM probe answered (HTTP ${pr.status}, provider ${pr.provider ?? 'unknown'}, ${pr.model ?? 'model unknown'})`;
        }
        log(`preflight passed: driver, profile, model and settings checked; the key's usage can be read; ${probeText}; ${o.scenarios.length} scenario(s) (timeouts: ${timeoutText}); ${modeText(o)}`);
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
        summary.scenarios.push({ id: s.id, out: path.resolve(s.out), runId: runIdOf(s.out), exit: code, spentBefore: gate.spent, timeoutMin: s.timeoutMin, ...(s.llmStop ? { llmStop: s.llmStop } : {}) });
        if (code !== 0 && exit === 0) exit = 1;
        // The LLM-failure stop rule: the model does not answer, so no further scenario starts. The outcome is an
        // infra fault, distinct from a check fail (#248 review): the batch exits 125, the summary says
        // infraFault, and the scenario's own result.json is marked (verdict "INFRA FAULT", infraFault).
        if (code === EXIT_LLM_STOP) {
            const reason = `LLM-failure stop: ${s.llmStop?.failed ?? '?'} failed LLM replies and none answered within ${s.llmStop?.afterSpawnS ?? '?'} s of the bot's spawn`;
            summary.stopped = `${reason} in ${s.id} (an infra fault, not a bot result)`;
            summary.infraFault = { kind: 'llm-failure-stop', scenario: s.id, ...s.llmStop };
            markInfraFault(s.out, summary.infraFault, reason);
            exit = EXIT_LLM_STOP;
            break;
        }
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
        // A bash that never started (low memory on this machine, round 5 B) is retried with the long backoff: fetching is safe to repeat.
        const r = retryNotStarted(() => spawnSync(findBash(), [process.env.TEST_SERVER_CTL, 'fetch', 'logs', '--out', o.logsOut], { stdio: 'inherit' }),
            { onRetry: (why, ms) => log(`log fetch: bash did not start (${why}); retrying in ${ms / 1000} s`) });
        summary.logsFetched = r.status === 0;
        if (r.status !== 0) log(`log fetch failed (${r.status ?? r.error?.code}${notStarted(r) ? ` ${notStarted(r)}` : ''})`);
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
