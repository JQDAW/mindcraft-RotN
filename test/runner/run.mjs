#!/usr/bin/env node
// Scenario runner CLI (harness-ops, brief deliverable 2).
//
//   node test/runner/run.mjs --scenario g1-login-chat-walk [--param key=value ...] [--out DIR] -- DRIVER [ARGS...]
//   node test/runner/run.mjs --list
//
// Run it on a disposable test server through the batch wrapper, which creates the server, sets
// TEST_SERVER_* and deletes everything afterwards:
//
//   deploy/test-server.sh run --yes -- node test/runner/run.mjs --scenario g1-login-chat-walk -- node <driver>
//
// DRIVER is the bot under test; it must follow test/runner/DRIVER.md. The verdict comes from the
// server's log and console. Writes result.json, server.log (the log since the scenario's marker)
// and driver.log to --out (default $TEST_SERVER_STATE_DIR/scenarios/<scenario>-<runId>).
// The driver gets an allowlisted environment (see driverEnv in lib/adapters.mjs); --pass-env NAME
// adds one more variable, e.g. OPENROUTER_API_KEY for a Mindcraft driver. Test-server and cloud
// credentials can never be passed.
// Exit code: 0 gate pass, 1 a check failed, 2 usage or setup error, 4 all checks passed but with
// parameters weaker than the gate allows (a smoke run, never a gate pass), 128+N killed by signal N.
// result.json is written from the start and rewritten after every check as a progress record
// ("verdict": "FAIL (killed)", "pass": false, notes.killed); the final result replaces it. So a runner
// that `timeout` kills leaves the checks it had done and can never look like a pass (lead, after G2
// batch 6). On Windows `timeout` ends node with TerminateProcess and no handler runs; where a signal
// can be caught (SIGTERM, SIGINT, SIGHUP), notes.killed also names it.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runScenario, addNotGate } from './lib/runner.mjs';
import { ctlServer, driverProcess, wallClock } from './lib/adapters.mjs';
import { linesAfter } from './lib/server-log.mjs';
import { guardConsole, g3Policy, LLM_MODEL } from './lib/g3.mjs';
import { keyFetch, llmRecord, readKeyUsage } from './lib/llm-spend.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Write a file atomically (temp file, then rename), so a kill mid-write never leaves half a result.json. */
export function writeAtomic(file, text) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
}
const SCENARIO_DIR = path.join(here, '..', 'scenarios');

/** Scenario modules: test/scenarios/<group>/<id>.mjs, keyed by their exported id. */
/**
 * The run's evidence server log: the lines after the begin marker. If the marker is no longer in latest.log
 * (the server rolled it over at 00:00 UTC), the same fallback as the session: the newest rolled-over file plus
 * latest.log (server.logRotated, lead #236 review). Returns {lines, files}; lines is null when the marker is
 * in neither, files is null when latest.log alone was enough.
 */
export function evidenceLog(server, logTail, marker) {
    const lines = linesAfter(server.log(logTail), marker);
    if (lines !== null || typeof server.logRotated !== 'function') return { lines, files: null };
    const r = server.logRotated(logTail);
    return { lines: linesAfter(r.lines, marker), files: r.files };
}

export async function loadScenarios(dir = SCENARIO_DIR) {
    const out = {};
    for (const group of fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
        for (const f of fs.readdirSync(path.join(dir, group.name)).filter((n) => n.endsWith('.mjs'))) {
            const mod = (await import(pathToFileURL(path.join(dir, group.name, f)).href)).default;
            if (mod?.id && typeof mod.run === 'function') out[mod.id] = mod;
        }
    }
    return out;
}

/**
 * The repo state a run tested, for result.json: {sha, dirty, untracked}. sha is HEAD's commit,
 * dirty is true if tracked files differ from it (staged or not), untracked counts files git does not
 * track (an untracked scenario module would be loaded too). All null if git cannot answer.
 */
export function gitInfo(cwd = path.join(here, '..', '..'), exec = execFileSync) {
    const git = (args) => exec('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    try {
        const sha = git(['rev-parse', '--verify', 'HEAD']).trim();
        if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error('bad sha');
        const lines = git(['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean);
        return { sha, dirty: lines.some((l) => !l.startsWith('??')), untracked: lines.filter((l) => l.startsWith('??')).length };
    } catch {
        return { sha: null, dirty: null, untracked: null };
    }
}

/**
 * --param key=value: numbers stay numbers, everything else is a string. An integer too large for a JS
 * number to hold exactly (beyond Number.MAX_SAFE_INTEGER, e.g. a 19-digit world seed) stays a string,
 * so `--param worldSeed=1880465901402976865` keeps every digit.
 */
export function parseArgs(argv) {
    const o = { params: {}, driver: [], list: false, scenario: null, out: null, passEnv: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--') { o.driver = argv.slice(i + 1); break; }
        if (a === '--list') o.list = true;
        else if (a === '--scenario') o.scenario = argv[++i];
        else if (a === '--out') o.out = argv[++i];
        else if (a === '--pass-env') o.passEnv.push(argv[++i]);
        else if (a === '--param') {
            const [k, ...v] = (argv[++i] ?? '').split('=');
            if (!k || !v.length) throw new Error(`--param needs key=value, got '${argv[i]}'`);
            const s = v.join('=');
            const numeric = /^-?\d+(\.\d+)?$/.test(s);
            const unsafeInt = /^-?\d+$/.test(s) && !Number.isSafeInteger(Number(s));
            o.params[k] = numeric && !unsafeInt ? Number(s) : s;
        } else throw new Error(`unknown argument '${a}'`);
    }
    return o;
}

async function main(argv) {
    let o;
    try {
        o = parseArgs(argv);
    } catch (e) {
        console.error(e.message);
        return 2;
    }
    const scenarios = await loadScenarios();
    if (o.list) {
        for (const s of Object.values(scenarios)) console.log(`${s.id}\t${s.gate}\t${s.title}\tchecks: ${Object.keys(s.checks).join(', ')}`);
        return 0;
    }
    const scenario = scenarios[o.scenario];
    if (!scenario) { console.error(`unknown --scenario '${o.scenario}' (try --list)`); return 2; }
    if (!o.driver.length) { console.error('give the bot driver after --, e.g. -- node path/to/driver.mjs'); return 2; }
    for (const k of Object.keys(o.params)) {
        if (!(k in scenario.defaults)) { console.error(`scenario ${scenario.id} has no parameter '${k}'`); return 2; }
    }

    const runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')}-${crypto.randomBytes(3).toString('hex')}`.toLowerCase();
    const outDir = o.out ?? path.join(process.env.TEST_SERVER_STATE_DIR ?? '.', 'scenarios', `${scenario.id}-${runId}`);
    fs.mkdirSync(outDir, { recursive: true });
    const log = (m) => console.error(`[scenario ${new Date().toISOString().slice(11, 19)}] ${m}`);

    let server;
    try {
        server = ctlServer(process.env.TEST_SERVER_CTL);
    } catch (e) {
        console.error(e.message);
        return 2;
    }
    let bot;
    try {
        bot = driverProcess(o.driver, path.join(outDir, 'driver.log'), { passEnv: o.passEnv });
    } catch (e) {
        console.error(e.message);
        return 2;
    }
    // The code under test, read before the run starts: a dirty tree is not reproducible gate evidence.
    const git = gitInfo();
    log(`${scenario.id} (${scenario.gate}) run ${runId}; git ${git.sha ?? 'unknown'}${git.dirty ? ' (DIRTY: uncommitted changes)' : ''}; driver: ${o.driver.join(' ')}; out: ${outDir}`);
    const resultFile = path.join(outDir, 'result.json');
    // G3 (#116 and #122 reviews): the console allowlist whenever the real agent runs or the gate is G3, and a
    // G3 run is gate-valid only under batch.mjs's spend stop (its ROTN_G3_BATCH marker).
    const policy = g3Policy(scenario, process.env, o.params.maxBatchUsd ?? scenario.defaults?.maxBatchUsd);
    let usageBefore = null;
    // Every record, the progress and killed ones too, carries the LLM calls so far (#122 review nit): a run
    // that never finishes still shows what it used. The after-reading exists only in the final result.
    const stamp = (r) => Object.assign(r, { git, server: process.env.TEST_SERVER_NAME ?? null, driver: o.driver.join(' ') },
        scenario.llm && !r.llm ? { llm: llmRecord(usageBefore, { ok: false, error: 'the run did not finish' }, bot.output()) } : {},
        scenario.gate === 'G3' ? { batch: policy.batch } : {});
    let finished = false;
    const onProgress = (rec) => {
        if (finished) return;
        try {
            writeAtomic(resultFile, JSON.stringify(stamp(rec), null, 2) + '\n');
        } catch (e) {
            log(`could not write the progress record: ${e.message}`);
        }
    };
    const control = {};
    const signals = { SIGTERM: 15, SIGINT: 2, SIGHUP: 1 };
    const onSignal = (sig) => {
        if (finished) return;
        finished = true;
        log(`killed by ${sig}: result.json keeps the checks done so far (FAIL, never a pass)`);
        try {
            writeAtomic(resultFile, JSON.stringify(stamp(control.progress(sig)), null, 2) + '\n');
        } catch (e) {
            log(`could not write the killed record: ${e.message}`);
        }
        // Stop the driver (SIGTERM, then SIGKILL after its grace), but never wait more than 20 s.
        Promise.race([bot.stop(), new Promise((r) => setTimeout(r, 20000))]).finally(() => process.exit(128 + signals[sig]));
    };
    for (const sig of Object.keys(signals)) process.on(sig, () => onSignal(sig));
    // Only the approved console commands reach the server (no give, summon or op commands); a scenario that
    // runs the real agent (llm: true) records its LLM calls and cost.
    const scenarioServer = policy.guard ? guardConsole(server) : server;
    const readUsage = () => readKeyUsage({ key: process.env.OPENROUTER_API_KEY, fetchImpl: keyFetch(process.env) });
    if (scenario.llm) usageBefore = await readUsage();
    const result = stamp(await runScenario(scenario, { server: scenarioServer, bot, clock: wallClock, params: o.params, runId, log, onProgress, control }));
    if (finished) return new Promise(() => {});   // a signal arrived first: its handler writes and exits
    finished = true;
    if (scenario.llm) {
        result.llm = llmRecord(usageBefore, await readUsage(), bot.output());
        // Requests sent, then what came back (lead, after round 3: failed calls are never counted as calls).
        const http = Object.entries(result.llm.httpErrors ?? {}).map(([st, n]) => `${n} x HTTP ${st}`).join(', ');
        const rp = result.llm.replies ?? {};
        log(`${scenario.id}: ${result.llm.calls} LLM requests (${rp.ok ?? '?'} replies, ${rp.memory ?? '?'} memory summaries, ${rp.failed ?? '?'} failed${http ? `; ${http}` : ''}), USD ${result.llm.usd ?? 'unknown'}`);
        if (result.llm.usd === null) addNotGate(result, `the LLM cost is unknown (${result.llm.error}): a G3 run must record its spend`);
        // Every LLM run uses the preset model (the human's decision, 2026-11-06). The Mindcraft driver refuses
        // any other; a G3 run whose recorded model is not it (or is unknown) is never a gate run.
        log(`${scenario.id}: model ${result.llm.models?.model ?? 'not reported by the driver'}`);
        if (scenario.gate === 'G3' && result.llm.models?.model !== LLM_MODEL) {
            addNotGate(result, `the run's model is ${result.llm.models?.model ?? 'not reported'}, not ${LLM_MODEL}`);
        }
    }
    if (policy.notGate) addNotGate(result, policy.notGate);
    try {
        const ev = evidenceLog(server, result.params.logTail, `scenario-${runId}-begin`);
        if (ev.files) {
            result.notes = { ...(result.notes ?? {}), evidenceLogFiles: ev.files };
            log(`server.log: the marker was rolled over; saved from ${ev.files.join(', ')}`);
        }
        fs.writeFileSync(path.join(outDir, 'server.log'), ev.lines === null ? '(scenario marker not in the fetched log tail)\n' : ev.lines.join('\n') + '\n');
    } catch (e) {
        log(`could not save the server log: ${e.message}`);
    }
    writeAtomic(resultFile, JSON.stringify(result, null, 2) + '\n');
    log(`${scenario.id}: ${result.verdict}; ${result.passed} passed, ${result.failed} failed (${outDir}/result.json)`);
    if (result.pass) return 0;
    return result.checksPassed ? 4 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => {
        console.error(e);
        process.exitCode = 2;
    });
}
