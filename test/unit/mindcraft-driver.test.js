// The G3 driver (test/runner/drivers/mindcraft-driver.mjs): its refusals (no Mindcraft task files, no
// insecure settings), the environment it gives main.js, and that stopping it leaves no process behind.
// main.js is replaced by test/unit/fixtures/fake-mindcraft-main.mjs, which starts an "agent" child the way
// Mindcraft does. Offline: no Minecraft server, no LLM.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseDriverArgs, envProblems, profileProblems, settingsProblems, settingsFileOf, mindcraftEnv, freePort, EXIT_FATAL } from '../runner/drivers/mindcraft-driver.mjs';

// A profile as skills-rotn's RotN profile sets it: the bot's name and the preset model (lib/g3.mjs LLM_MODEL).
const GOOD_PROFILE = JSON.stringify({ name: 'FRCFLD', model: 'openrouter/@preset/glm-5-1-mindcraft' });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.join(HERE, '..', 'runner', 'drivers', 'mindcraft-driver.mjs');
const FAKE_MAIN = path.join(HERE, 'fixtures', 'fake-mindcraft-main.mjs');
const SAFE = path.join(HERE, 'fixtures', 'settings-safe.mjs');
const INSECURE = path.join(HERE, 'fixtures', 'settings-insecure.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const runnerEnv = (extra = {}) => ({
    TEST_SERVER_HOST: '192.0.2.10', TEST_SERVER_PORT: '25565', MINDCRAFT_PROFILES_FOLDER: '/cache', ROTN_SCENARIO_BOT: 'FRCFLD', ...extra,
});

describe('mindcraft-driver: checks before anything starts', () => {
    test('task files are refused in every spelling; unknown arguments too; --profile is required', () => {
        for (const a of [['--task_path', 'tasks/x.json'], ['--task_id', 'a'], ['--task_path=tasks/x.json'], ['--task-path', 'x'], ['--taskid', '1']]) {
            const { problems } = parseDriverArgs(['--profile', 'p.json', ...a]);
            assert.ok(problems.some((p) => /never loads Mindcraft task files/.test(p)), `${a.join(' ')}: ${JSON.stringify(problems)}`);
        }
        assert.match(parseDriverArgs(['--profile', 'p.json', '--cheat']).problems[0], /unknown argument '--cheat'/);
        assert.match(parseDriverArgs(['--profile', 'p.json', '--settings', 'other.js']).problems[0], /unknown argument '--settings'/, 'the check cannot be pointed elsewhere (#116 finding 1)');
        assert.equal(parseDriverArgs(['--profile', 'p.json', '--main', path.join('app', 'main.js')]).options.settings, path.resolve('app', 'settings.js'));
        assert.equal(settingsFileOf(path.join(HERE, '..', '..', 'main.js')), path.join(path.resolve(HERE, '..', '..'), 'settings.js'));
        assert.match(parseDriverArgs([]).problems[0], /--profile is required/);
        const ok = parseDriverArgs(['--profile', 'p.json', '--grace-ms', '500']);
        assert.deepEqual([ok.problems, ok.options.profile, ok.options.graceMs], [[], 'p.json', 500]);
    });

    test('the environment: INSECURE_CODING (any value), BLOCKED_ACTIONS, SETTINGS_JSON, a token-printing DEBUG, missing runner vars', () => {
        assert.deepEqual(envProblems(runnerEnv()), []);
        assert.match(envProblems(runnerEnv({ INSECURE_CODING: 'false' }))[0], /INSECURE_CODING is set/);
        assert.match(envProblems(runnerEnv({ INSECURE_CODING: '' }))[0], /INSECURE_CODING is set/, 'even empty');
        assert.match(envProblems(runnerEnv({ BLOCKED_ACTIONS: '[]' }))[0], /BLOCKED_ACTIONS is set/);
        assert.match(envProblems(runnerEnv({ SETTINGS_JSON: '{}' }))[0], /SETTINGS_JSON is set/);
        for (const v of ['1', '0', '']) {
            assert.match(envProblems(runnerEnv({ MINDCRAFT_ROTN_ALLOW_TASK_FILES: v }))[0], /MINDCRAFT_ROTN_ALLOW_TASK_FILES is set/, `skills-rotn's opt-in (#110), value '${v}'`);
        }
        assert.match(envProblems(runnerEnv({ DEBUG: 'prismarine-auth' }), { debugEnables: (v) => /prismarine/.test(v) })[0], /DEBUG would make prismarine-auth print tokens/);
        assert.deepEqual(envProblems(runnerEnv({ DEBUG: 'other' }), { debugEnables: () => false }), []);
        const missing = envProblems({});
        for (const k of ['TEST_SERVER_HOST', 'TEST_SERVER_PORT', 'MINDCRAFT_PROFILES_FOLDER', 'ROTN_SCENARIO_BOT']) assert.ok(missing.includes(`${k} is not set`), k);
    });

    test('the profile: missing, not JSON, a task in it, or another bot\'s name', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcd-prof-'));
        const f = (name, body) => { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; };
        assert.match(profileProblems(path.join(dir, 'none.json'), 'FRCFLD')[0], /not found/);
        assert.match(profileProblems(f('bad.json', '{'), 'FRCFLD')[0], /not valid JSON/);
        for (const body of ['null', '42', '"FRCFLD"', '[]']) assert.match(profileProblems(f('odd.json', body), 'FRCFLD')[0], /not a JSON object/, body);
        assert.match(profileProblems(f('task.json', JSON.stringify({ ...JSON.parse(GOOD_PROFILE), task: { goal: 'x' } })), 'FRCFLD')[0], /has 'task'/);
        assert.match(profileProblems(f('other.json', '{"name":"Andy"}'), 'FRCFLD')[0], /name 'Andy' is not the runner's bot 'FRCFLD'/);
        assert.deepEqual(profileProblems(f('ok.json', GOOD_PROFILE), 'FRCFLD'), []);
        // The model of every LLM run (the human's decision, 2026-11-03): the OpenRouter preset, in any profile form.
        assert.deepEqual(profileProblems(f('obj.json', JSON.stringify({ name: 'FRCFLD', model: { api: 'openrouter', model: '@preset/glm-5-1-mindcraft' } })), 'FRCFLD'), []);
        for (const [body, re] of [
            ['{"name":"FRCFLD"}', /model is 'not set', not openrouter\/@preset\/glm-5-1-mindcraft/],
            ['{"name":"FRCFLD","model":"openrouter/anthropic/claude-sonnet-4-6"}', /model is 'openrouter\/anthropic\/claude-sonnet-4-6', not openrouter\/@preset/],
            ['{"name":"FRCFLD","model":"@preset/glm-5-1-mindcraft"}', /model is '@preset\/glm-5-1-mindcraft', not openrouter\/@preset/],
            ['{"name":"FRCFLD","model":{"api":"openai","model":"@preset/glm-5-1-mindcraft"}}', /model is 'openai\/@preset\/glm-5-1-mindcraft'/],
            [JSON.stringify({ name: 'FRCFLD', model: 'openrouter/@preset/glm-5-1-mindcraft', code_model: 'gpt-4o' }), /code_model is 'gpt-4o', not openrouter\/@preset/],
            [JSON.stringify({ name: 'FRCFLD', model: 'openrouter/@preset/glm-5-1-mindcraft', vision_model: {} }), /vision_model is 'not understood'/],
        ]) assert.match(profileProblems(f('model.json', body), 'FRCFLD').join('; '), re, body);
        // Givers are settings; the test-only Server giver is the driver's alone (#146).
        for (const k of ['allow_server_task_giver', 'task_givers', 'TaskGivers']) {
            assert.match(profileProblems(f('giver.json', JSON.stringify({ name: 'FRCFLD', [k]: k === 'allow_server_task_giver' ? true : ['Server'] })), 'FRCFLD')[0], new RegExp(`has '${k}'`));
        }
    });

    test('settings.js must evaluate to allow_insecure_coding === false', async () => {
        assert.deepEqual(await settingsProblems(SAFE), []);
        assert.match((await settingsProblems(INSECURE))[0], /allow_insecure_coding is not false/);
        assert.match((await settingsProblems(path.join(HERE, 'fixtures', 'no-such-settings.mjs')))[0], /cannot be imported/);
    });

    test('the repo\'s own settings.js passes (the real check G3 batches run)', async () => {
        assert.deepEqual(await settingsProblems(path.join(HERE, '..', '..', 'settings.js')), []);
    });

    test('main.js gets host, port, auth, auto_open_ui and the test-only Server giver switch; one profile; the single-bot service; no runner vars', async () => {
        const e = mindcraftEnv(runnerEnv({ OPENROUTER_API_KEY: 'not-a-key' }), { profile: 'profiles/g3.json', mindserverPort: 40123 });
        // skills-rotn's test-only allow_server_task_giver (#146): turned on here and nowhere else; task_givers
        // (the players) are left to settings.js.
        assert.deepEqual(JSON.parse(e.SETTINGS_JSON), { host: '192.0.2.10', port: 25565, auth: 'microsoft', auto_open_ui: false, allow_server_task_giver: true });
        assert.ok(!('task_givers' in JSON.parse(e.SETTINGS_JSON)));
        assert.deepEqual(JSON.parse(e.PROFILES), ['profiles/g3.json']);
        assert.equal(e.MINDCRAFT_SINGLE_BOT_SERVICE, '1');
        assert.equal(e.MINDSERVER_PORT, '40123');
        assert.equal(e.OPENROUTER_API_KEY, 'not-a-key', 'the key the runner passed through');
        assert.ok(!('TEST_SERVER_HOST' in e) && !('TEST_SERVER_PORT' in e));
        assert.ok(!('INSECURE_CODING' in e) && !('BLOCKED_ACTIONS' in e));
        const port = await freePort();
        assert.ok(port > 0 && port < 65536);
    });
});

/** Spawns the driver with the fake main.js. Returns {child, dir, exited}. */
function startDriver({ env = {}, args = [], profileBody = GOOD_PROFILE, settings = SAFE } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcd-run-'));
    const profile = path.join(dir, 'profile.json');
    fs.writeFileSync(profile, profileBody);
    // main.js imports ./settings.js, so the fake app has both side by side (#116 finding 1).
    const app = path.join(dir, 'app');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'package.json'), '{"type":"module"}');
    fs.copyFileSync(FAKE_MAIN, path.join(app, 'main.js'));
    fs.copyFileSync(settings, path.join(app, 'settings.js'));
    const base = Object.fromEntries(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']
        .filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
    const child = spawn(process.execPath, [DRIVER, '--profile', profile, '--main', path.join(app, 'main.js'), '--grace-ms', '2000', ...args], {
        env: { ...base, ...runnerEnv({ MINDCRAFT_PROFILES_FOLDER: dir, OPENROUTER_API_KEY: 'not-a-key' }), FAKE_DIR: dir, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal, out })));
    const outNow = () => out;
    // After each test, even a failing one: close the pipes (a surviving main.js would hold them open and
    // hang the test run) and end any process this run recorded that is still alive.
    const cleanup = () => {
        child.stdout.destroy();
        child.stderr.destroy();
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        const pids = readJson(path.join(dir, 'pids.json'));
        for (const pid of [pids?.main, pids?.agent]) if (pid && alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    };
    return { child, dir, app, exited, cleanup, out: outNow };
}
async function waitFor(fn, ms = 15000) {
    for (let t = 0; t < ms; t += 100) { const v = fn(); if (v) return v; await sleep(100); }
    return null;
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

describe('mindcraft-driver end to end with a fake main.js', () => {
    test('a refused start exits 3 and starts nothing', async (t) => {
        const { dir, exited, cleanup } = startDriver({ args: ['--task_path', 'tasks/x.json'], env: { INSECURE_CODING: 'false' } });
        t.after(cleanup);
        const r = await exited;
        assert.equal(r.code, EXIT_FATAL);
        assert.match(r.out, /refused: --task_path: G3 never loads Mindcraft task files/);
        assert.match(r.out, /refused: INSECURE_CODING is set/);
        assert.match(r.out, /DRIVER \{.*"type":"refused"/);
        assert.equal(fs.existsSync(path.join(dir, 'pids.json')), false, 'main.js never started');
    });

    test('an insecure settings.js is refused before main.js starts', async (t) => {
        const { dir, exited, cleanup } = startDriver({ settings: INSECURE });
        t.after(cleanup);
        const r = await exited;
        assert.equal(r.code, EXIT_FATAL);
        assert.match(r.out, /allow_insecure_coding is not false/);
        assert.equal(fs.existsSync(path.join(dir, 'pids.json')), false);
    });

    test('a production settings.js with `Server` as a task giver is refused (it is test-only)', async (t) => {
        const { dir, exited, cleanup } = startDriver({ settings: path.join(HERE, 'fixtures', 'settings-server-giver.mjs') });
        t.after(cleanup);
        const r = await exited;
        assert.equal(r.code, EXIT_FATAL);
        assert.match(r.out, /refused: .*settings\.js: settings\.task_givers contains 'Server'/);
        assert.equal(fs.existsSync(path.join(dir, 'pids.json')), false);
    });

    test('a null profile is refused with a reason, not a crash (#116 finding 2)', async (t) => {
        const { dir, exited, cleanup } = startDriver({ profileBody: 'null' });
        t.after(cleanup);
        const r = await exited;
        assert.equal(r.code, EXIT_FATAL);
        assert.match(r.out, /refused: profile .*: not a JSON object/);
        assert.doesNotMatch(r.out, /TypeError/);
        assert.equal(fs.existsSync(path.join(dir, 'pids.json')), false);
    });

    test('main.js starts with the driver\'s settings, and the runner\'s stop leaves no process behind', { timeout: 60000 }, async (t) => {
        const { child, dir, app, exited, cleanup, out } = startDriver();
        t.after(cleanup);
        const pids = await waitFor(() => readJson(path.join(dir, 'pids.json')));
        assert.ok(pids, 'the fake main.js and its agent started');
        const seen = readJson(path.join(dir, 'seen.json'));
        assert.deepEqual(seen.settingsKeys, ['allow_server_task_giver', 'auth', 'auto_open_ui', 'host', 'port']);
        assert.equal(seen.allowServerTaskGiver, true, 'the test-only Server giver switch reaches main.js (#146)');
        assert.deepEqual(seen.settings, { host: '192.0.2.10', port: 25565, auth: 'microsoft', auto_open_ui: false });
        assert.equal(seen.singleBot, '1');
        assert.equal(seen.argv.length, 0, 'no arguments for main.js: no task files');
        assert.deepEqual([seen.hasOpenRouterKey, seen.hasTestServerVars, seen.insecure], [true, false, false]);
        assert.ok(seen.mindserverPort > 0);
        const start = JSON.parse(/DRIVER (\{.*"type":"mindcraft_start".*\})/.exec(await waitFor(() => (/mindcraft_start/.test(out()) ? out() : null)))[1]);
        assert.equal(start.main, path.join(app, 'main.js'));
        assert.equal(start.settings, path.join(app, 'settings.js'), 'the settings file main.js imports was the one checked');
        assert.deepEqual(start.models, { model: 'openrouter/@preset/glm-5-1-mindcraft', code_model: null, vision_model: null },
            'the model goes into the run record (run.mjs result.llm.models)');
        assert.ok(alive(pids.main) && alive(pids.agent));
        // The runner's stop: SIGTERM (on Windows node turns this into TerminateProcess of the driver alone).
        child.kill('SIGTERM');
        const r = await exited;
        if (process.platform !== 'win32') assert.equal(r.code, 0, `a requested stop exits 0 (${r.out})`);
        assert.ok(await waitFor(() => !alive(pids.main) && !alive(pids.agent), 15000), `main.js ${pids.main} or its agent ${pids.agent} survived the stop`);
    });

    test('a hard kill of the driver (SIGKILL; TerminateProcess on Windows) leaves no process behind',
        { timeout: 60000, skip: process.platform !== 'win32' && 'POSIX relies on the SIGTERM stop above: a SIGKILLed parent cannot signal its group' },
        async (t) => {
            const { child, dir, exited, cleanup } = startDriver();
            t.after(cleanup);
            const pids = await waitFor(() => readJson(path.join(dir, 'pids.json')));
            assert.ok(pids);
            child.kill('SIGKILL');
            await exited;
            assert.ok(await waitFor(() => !alive(pids.main) && !alive(pids.agent), 15000), `main.js ${pids.main} or its agent ${pids.agent} survived the hard kill`);
        });

    test('main.js\'s own exit code passes through (3: fatal), and its agent does not outlive it', { timeout: 60000 }, async (t) => {
        const { dir, exited, cleanup } = startDriver({ env: { FAKE_EXIT_CODE: '3' } });
        t.after(cleanup);
        const r = await exited;
        assert.equal(r.code, 3, r.out);
        assert.match(r.out, /DRIVER \{.*"type":"mindcraft_exit","code":3/);
        const pids = readJson(path.join(dir, 'pids.json'));
        assert.ok(await waitFor(() => !alive(pids.agent), 15000), `the agent ${pids.agent} outlived main.js`);
    });
});
