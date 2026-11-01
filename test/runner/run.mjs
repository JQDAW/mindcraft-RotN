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
// parameters weaker than the gate allows (a smoke run, never a gate pass).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runScenario } from './lib/runner.mjs';
import { ctlServer, driverProcess, wallClock } from './lib/adapters.mjs';
import { linesAfter } from './lib/server-log.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = path.join(here, '..', 'scenarios');

/** Scenario modules: test/scenarios/<group>/<id>.mjs, keyed by their exported id. */
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

/** --param key=value: numbers stay numbers, everything else is a string. */
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
            o.params[k] = /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
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
    const result = await runScenario(scenario, { server, bot, clock: wallClock, params: o.params, runId, log });
    result.git = git;
    result.server = process.env.TEST_SERVER_NAME ?? null;
    result.driver = o.driver.join(' ');
    try {
        const since = linesAfter(server.log(result.params.logTail), `scenario-${runId}-begin`);
        fs.writeFileSync(path.join(outDir, 'server.log'), since === null ? '(scenario marker not in the fetched log tail)\n' : since.join('\n') + '\n');
    } catch (e) {
        log(`could not save the server log: ${e.message}`);
    }
    fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
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
