#!/usr/bin/env node
// The G3 driver (coord/STATUS-harness-ops.md, "The G3 driver"): runs the REAL Mindcraft agent
// (main.js with a RotN profile) under the runner's driver contract (test/runner/DRIVER.md).
//
//   node test/runner/run.mjs --scenario <g3 scenario> --pass-env OPENROUTER_API_KEY -- \
//     node test/runner/drivers/mindcraft-driver.mjs --profile profiles/<g3 test profile>.json
//
// What it does:
//   - Checks before anything starts; any problem is a setup error, exit 3 (ADR 0003 decision 5):
//       * no Mindcraft task files, ever (lead, 2026-11-02): task files run op commands (/give, /tp, ...)
//         regardless of cheat mode, so --task_path / --task_id (or any argument it does not know) refuse;
//       * the environment must not carry INSECURE_CODING or BLOCKED_ACTIONS (main.js honours any value,
//         even "false"), nor SETTINGS_JSON (the driver writes its own), nor skills-rotn's test-only
//         MINDCRAFT_ROTN_ALLOW_TASK_FILES (#110), nor a DEBUG that would make prismarine-auth print tokens
//         (forge-bridge's own rule);
//       * the settings.js next to main.js (the file main.js really imports; there is no option to check
//         another one) must evaluate to allow_insecure_coding === false, as deploy.sh checks;
//       * the profile must exist, parse, carry no task, and be named as the runner's bot;
//       * the profile's model must be openrouter/@preset/glm-5-1-mindcraft (LLM_MODEL in lib/g3.mjs; the
//         human's decision for every LLM run), and so must code_model and vision_model when set.
//   - Starts `node main.js` with MINDCRAFT_SINGLE_BOT_SERVICE=1, PROFILES=[profile], a free local
//     MINDSERVER_PORT, and SETTINGS_JSON={"host","port","auth":"microsoft","auto_open_ui":false,
//     "allow_server_task_giver":true} from the runner's TEST_SERVER_HOST/PORT (the last is skills-rotn's
//     test-only switch for the console giver "Server", #146; see mindcraftEnv). OPENROUTER_API_KEY comes only through the runner's --pass-env and is
//     never printed. Output goes straight to the runner (stdio inherit).
//   - Stopping leaves no process behind. main.js starts the agent as a child process:
//       * POSIX: main.js runs in its own process group; on SIGTERM/SIGINT the driver signals the whole
//         group, waits graceMs, then SIGKILLs the group, and exits 0 (DRIVER.md behaviour item 5).
//       * Windows: node cannot catch the runner's stop there (it is TerminateProcess). libuv puts every
//         non-detached child into a kill-on-close job object, so ending the driver ends main.js, and
//         main.js's own job ends the agent. That is why main.js is NOT detached on Windows; a unit test
//         proves no process survives.
//   - Exit: main.js's own exit code passes through (0 clean stop, 1 transient, 3 fatal).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { giverProblems, modelProblems, profileModels } from '../lib/g3.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const EXIT_FATAL = 3;
const event = (type, data = {}) => console.log(`DRIVER ${JSON.stringify({ t: new Date().toISOString(), type, ...data })}`);

/**
 * The settings.js that main.js really imports: `./settings.js` next to it (#116 review finding 1). The
 * driver checks exactly this file; there is no option to point the check anywhere else.
 */
export const settingsFileOf = (main) => path.join(path.dirname(path.resolve(main)), 'settings.js');

/** --profile P [--main M] [--grace-ms N]; anything else (task arguments and --settings included) is refused. */
export function parseDriverArgs(argv) {
    const o = { profile: null, main: path.join(REPO, 'main.js'), graceMs: 10000 };
    const problems = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (/^--task[_-]?(path|id)(=|$)/.test(a)) problems.push(`${a.split('=')[0]}: G3 never loads Mindcraft task files (they run op commands)`);
        else if (a === '--profile') o.profile = argv[++i] ?? null;
        else if (a === '--main') o.main = argv[++i];
        else if (a === '--grace-ms') o.graceMs = Number(argv[++i]);
        else problems.push(`unknown argument '${a}'`);
    }
    if (!o.profile) problems.push('--profile is required');
    if (!(o.graceMs >= 0)) problems.push('--grace-ms must be a number of milliseconds');
    o.settings = settingsFileOf(o.main);
    return { options: o, problems };
}

/** Problems in the driver's own environment (names only, never values). debugEnables: forge-bridge's rule. */
export function envProblems(env, { debugEnables = () => false } = {}) {
    const p = [];
    const has = (k) => Object.prototype.hasOwnProperty.call(env, k);
    if (has('INSECURE_CODING')) p.push('INSECURE_CODING is set (main.js turns insecure coding on for any value)');
    if (has('BLOCKED_ACTIONS')) p.push('BLOCKED_ACTIONS is set (it would replace settings.js\'s list)');
    if (has('SETTINGS_JSON')) p.push('SETTINGS_JSON is set (the driver writes its own: host, port, auth, auto_open_ui and the test-only Server giver switch)');
    // skills-rotn's test-only opt-in for task files (#110, src/agent/tasks/task_guard.js): never in a G3 run.
    if (has('MINDCRAFT_ROTN_ALLOW_TASK_FILES')) p.push('MINDCRAFT_ROTN_ALLOW_TASK_FILES is set (G3 never loads Mindcraft task files)');
    if (has('DEBUG') && debugEnables(env.DEBUG)) p.push('DEBUG would make prismarine-auth print tokens');
    for (const k of ['TEST_SERVER_HOST', 'TEST_SERVER_PORT', 'MINDCRAFT_PROFILES_FOLDER', 'ROTN_SCENARIO_BOT']) if (!env[k]) p.push(`${k} is not set`);
    return p;
}

/**
 * Problems with the profile file: missing, not JSON, a task in it, a task-giver key, a different bot name,
 * or a model other than LLM_MODEL (the human's decision for every LLM run, 2026-11-03).
 */
export const profileProblems = (file, bot) => checkProfile(file, bot).problems;

/**
 * The profile, read once (#169 review nit), and its problems (profileProblems): {profile, problems}.
 * profile is null when the file cannot be read as a JSON object.
 */
export function checkProfile(file, bot) {
    let prof;
    try {
        prof = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return { profile: null, problems: [`profile ${file}: ${e.code === 'ENOENT' ? 'not found' : 'not valid JSON'}`] };
    }
    // null, a number, a string or an array is valid JSON but no profile (#116 review finding 2).
    if (prof === null || typeof prof !== 'object' || Array.isArray(prof)) return { profile: null, problems: [`profile ${file}: not a JSON object`] };
    const p = [];
    for (const k of ['task', 'task_path', 'task_id']) if (k in prof) p.push(`profile ${file}: has '${k}' (G3 never runs Mindcraft tasks)`);
    // Task givers come from settings.js and, for the test-only "Server", from the driver alone (#146).
    for (const k of Object.keys(prof).filter((x) => /giver/i.test(x))) p.push(`profile ${file}: has '${k}' (task givers are settings, and the test-only Server giver is the driver's alone)`);
    if (bot && prof.name !== bot) p.push(`profile ${file}: name '${prof.name}' is not the runner's bot '${bot}'`);
    for (const m of modelProblems(prof)) p.push(`profile ${file}: ${m}`);
    return { profile: prof, problems: p };
}

/** The repo's settings, as main.js imports them: allow_insecure_coding must be exactly false. */
export async function settingsProblems(file) {
    try {
        const s = (await import(pathToFileURL(path.resolve(file)).href)).default;
        const p = s?.allow_insecure_coding === false ? [] : [`${file}: allow_insecure_coding is not false`];
        // The console sender `Server` is a test-only task giver; never in the production settings (#116 review).
        return [...p, ...giverProblems(s).map((m) => `${file}: ${m}`)];
    } catch (e) {
        return [`${file}: cannot be imported (${e.message})`];
    }
}

/**
 * The environment main.js runs with. SETTINGS_JSON is the driver's own: the test server's host and port,
 * online auth, no UI, and skills-rotn's TEST-ONLY allow_server_task_giver (#146): with it, the console's
 * whisper sender "Server" (the runner's G3 task giver) may give tasks, and only from the console.
 * This is the one place it is turned on: it never sits in a committed settings.js (settingsProblems) or
 * profile (profileProblems), and the CX23 refuses it (deploy/cx23/check-env.mjs). task_givers (players)
 * stay as the lead's settings.js has them; "Server" needs no entry there.
 * PRODUCTION_GIVERS_ENV=1 (set by g3-untrusted-refused through the runner's start env) turns the switch OFF,
 * so the agent runs with the production giver list and `Server` is refused. It can only turn the test giver
 * off, never on.
 */
export const PRODUCTION_GIVERS_ENV = 'ROTN_G3_PRODUCTION_GIVERS';
export const serverGiverOn = (env) => env[PRODUCTION_GIVERS_ENV] !== '1';
export function mindcraftEnv(env, { profile, mindserverPort }) {
    const out = { ...env };
    for (const k of ['TEST_SERVER_HOST', 'TEST_SERVER_PORT', PRODUCTION_GIVERS_ENV]) delete out[k];
    out.SETTINGS_JSON = JSON.stringify({
        host: env.TEST_SERVER_HOST, port: Number(env.TEST_SERVER_PORT), auth: 'microsoft', auto_open_ui: false,
        allow_server_task_giver: serverGiverOn(env),
    });
    out.PROFILES = JSON.stringify([profile]);
    out.MINDSERVER_PORT = String(mindserverPort);
    out.MINDCRAFT_SINGLE_BOT_SERVICE = '1';
    return out;
}

/** The bot state files that must not carry over between runs (#207 review): an open task or agenda progress. */
export const BOT_STATE_FILES = ['tasks.json', 'agenda.json'];
/** How many of the driver's own backups (<file>.g3-<stamp>.bak) to keep per state file (#207 review nit). */
export const KEEP_BACKUPS = 5;

/**
 * On EVERY start of this driver, before main.js starts: move the bot's tasks.json and agenda.json aside
 * (renamed to <file>.g3-<stamp>.bak), so a run never inherits an open task from an earlier one (a (c) task
 * must not run in (d) under the production giver list) and the agenda autostarts as on a fresh bot. There is
 * no G3 gate inside: this driver is the G3 driver, and only the G3 scenarios start it (DRIVER.md, "G3").
 * Then keep only the newest `keep` of the driver's own backups per state file and delete the older ones
 * (the stamps sort by time); nothing else in the folder is touched. dir is ./bots/<name> relative to the
 * cwd main.js and its agent run in (they inherit the driver's). Returns {dir, movedAside, pruned, fresh}.
 */
export function clearBotState(dir, { stamp = new Date().toISOString().replace(/[:.]/g, '-'), keep = KEEP_BACKUPS } = {}) {
    const movedAside = [];
    const pruned = [];
    for (const f of BOT_STATE_FILES) {
        const p = path.join(dir, f);
        if (!fs.existsSync(p)) continue;
        const to = `${p}.g3-${stamp}.bak`;
        fs.renameSync(p, to);
        movedAside.push(path.basename(to));
    }
    if (fs.existsSync(dir)) {
        const names = fs.readdirSync(dir);
        for (const f of BOT_STATE_FILES) {
            const prefix = `${f}.g3-`;
            const baks = names.filter((n) => n.startsWith(prefix) && n.endsWith('.bak')).sort();
            for (const n of baks.slice(0, Math.max(0, baks.length - keep))) {
                fs.rmSync(path.join(dir, n));
                pruned.push(n);
            }
        }
    }
    const left = BOT_STATE_FILES.filter((f) => fs.existsSync(path.join(dir, f)));
    return { dir, movedAside, pruned, fresh: left.length === 0 };
}

/** A free local TCP port for the MindServer (bound to localhost by Mindcraft). */
export function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.unref();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });
}

async function main(argv) {
    const { options: o, problems } = parseDriverArgs(argv);
    let debugEnables = () => false;
    try {
        ({ debugValueEnables: debugEnables } = await import(pathToFileURL(path.join(REPO, 'packages', 'forge-bridge', 'index.js')).href));
    } catch { /* tests without forge-bridge: the name checks still run */ }
    problems.push(...envProblems(process.env, { debugEnables }));
    // Read once (#169 review nit): the same parsed profile is checked here and recorded at the start.
    const checked = o.profile ? checkProfile(o.profile, process.env.ROTN_SCENARIO_BOT) : { profile: null, problems: [] };
    problems.push(...checked.problems);
    problems.push(...(await settingsProblems(o.settings)));
    const bot = process.env.ROTN_SCENARIO_BOT ?? '';
    if (bot && !/^[A-Za-z0-9_]{3,16}$/.test(bot)) problems.push(`ROTN_SCENARIO_BOT '${bot}' is not a player name`);
    if (problems.length) {
        for (const m of problems) console.error(`mindcraft-driver: refused: ${m}`);
        event('refused', { problems });
        return EXIT_FATAL;
    }

    // No state from an earlier run (#207 review): no open task, and the agenda starts as on a fresh bot.
    const botState = clearBotState(path.resolve(process.cwd(), 'bots', bot));
    const mindserverPort = await freePort();
    const posix = process.platform !== 'win32';
    const child = spawn(process.execPath, [o.main], {
        env: mindcraftEnv(process.env, { profile: o.profile, mindserverPort }),
        stdio: 'inherit',
        detached: posix,   // POSIX: its own process group, so a stop reaches the agent too; never on Windows (job object)
    });
    // The paths of what runs and of the settings file that was checked (the one main.js imports).
    // The models the agent will use (checked above to be LLM_MODEL), for the run record (run.mjs, result.llm.models).
    const models = profileModels(checked.profile);
    // serverTaskGiver: whether the test-only console giver `Server` is on (g3-untrusted-refused needs it off);
    // botState: the tasks.json and agenda.json moved aside before the start (#207 review).
    event('mindcraft_start', { pid: child.pid, main: path.resolve(o.main), settings: o.settings, profile: o.profile, mindserverPort, models, serverTaskGiver: serverGiverOn(process.env), botState });

    let stopping = false;
    const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
    const signalGroup = (sig) => {
        try {
            if (posix) process.kill(-child.pid, sig);
            else child.kill(sig);
        } catch { /* already gone */ }
    };
    const stop = async (sig) => {
        if (stopping) return;
        stopping = true;
        event('stopping', { signal: sig });
        signalGroup('SIGTERM');
        const timer = new Promise((r) => setTimeout(() => r(null), o.graceMs));
        if ((await Promise.race([exited, timer])) === null) signalGroup('SIGKILL');
        await exited;
        // POSIX: main.js has exited, but its agent may still be in the group; it must not outlive the stop
        // (#116 review finding 3). On Windows the job object already ended it. Exit 0: a requested stop.
        if (posix) signalGroup('SIGKILL');
        process.exit(0);
    };
    for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => stop(sig));

    const { code, signal } = await exited;
    if (stopping) return 0;
    event('mindcraft_exit', { code, signal });
    if (posix) signalGroup('SIGKILL');   // no agent may outlive main.js
    return code ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => {
        console.error(`mindcraft-driver: ${e?.stack ?? e}`);
        process.exitCode = EXIT_FATAL;
    });
}
