// G3's spend stop and guards (lead, #101 and #116 review), offline: the numbers-only key usage read,
// per-scenario LLM records, the batch runner's spend stop (it stops, fetches the logs, exits 5), the
// console allowlist (no give, summon or op commands), and `Server` as a test-only task giver.
// Addresses and keys here are fakes; no network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readKeyUsage, keyFetch, countLlmCalls, spent, llmRecord, agentModels, testOverridesAllowed, LLM_CALL_LINE, OPENROUTER_KEY_URL, countLlmReplies, providerSummary, EMPTY_PROVIDER, probeModel, probeFetch, TEST_OVERRIDES } from '../runner/lib/llm-spend.mjs';
import { LLM_MODEL, modelId, modelProblems, profileModels } from '../runner/lib/g3.mjs';
import { G3_DEFAULTS, G3_GATE_PARAMS, TEST_TASK_GIVER, guardConsole, giverProblems, g3Policy } from '../runner/lib/g3.mjs';
import { weakenedParams, addNotGate } from '../runner/lib/runner.mjs';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
import { parseBatchArgs, spendGate, endVerdict, forbiddenOverrides, runOne, llmStopVerdict, llmStopSettings, EXIT_LLM_STOP, SPAWNED_LINE, markInfraFault, runIdOf, driverPreflight, EXIT_SPEND_STOP, EXIT_SPEND_UNKNOWN, scenarioTimeouts, TIMEOUT_MARGIN_MIN, TEST_DEFAULT_TIMEOUT_MIN, TIMEOUT_CAP_FACTOR, ttlProblems, BUILD_ALLOWANCE_MIN, END_ALLOWANCE_MIN, midnightWarning } from '../runner/batch.mjs';
import { loadScenarios } from '../runner/run.mjs';
import { crossCheckBatch, isG3Result, INFRA_FAULT_EXIT } from '../runner/lib/g3.mjs';
import { checkFiles, infraFaultsUnder, resultFilesUnder, jsonFilesUnder, checkEvidenceTree, g3ScenarioIds, smokeBatchesUnder, batchKind } from '../tools/g3-batch-check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BATCH = path.join(HERE, '..', 'runner', 'batch.mjs');
const FAKE_RUNNER = path.join(HERE, 'fixtures', 'fake-batch-runner.mjs');
const KEY = 'sk-or-v1-NOT-A-REAL-KEY-0123456789';
const fwd = (p) => p.replace(/\\/g, '/');
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body) });

describe('the key usage read: numbers only, the key never leaves the header', () => {
    test('a good reading: usage, limit and remaining; the default URL and a Bearer header', async () => {
        let seen;
        const fetchImpl = (url, init) => { seen = { url, init }; return Promise.resolve(resp(200, { data: { label: 'secret-label', usage: 1.25, limit: 5, limit_remaining: 3.75, is_free_tier: false } })); };
        const r = await readKeyUsage({ key: KEY, fetchImpl });
        assert.deepEqual(r, { ok: true, usage: 1.25, limit: 5, remaining: 3.75 }, 'numbers only: no label, no tier');
        assert.equal(seen.url, OPENROUTER_KEY_URL);
        assert.equal(seen.init.method, 'GET');
        assert.equal(seen.init.headers.Authorization, `Bearer ${KEY}`);
    });

    test('failures name the kind only, never the key or the response body', async () => {
        const cases = [
            [() => Promise.resolve(resp(401, { error: { message: `bad key ${KEY}` } })), 'http 401'],
            [() => Promise.resolve(resp(200, '{"data":{"usage":"1.0"}}')), 'bad response'],
            [() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error(`not json ${KEY}`)) }), 'bad response'],
            [() => Promise.reject(new Error(`ECONNREFUSED ${KEY}`)), 'network'],
        ];
        for (const [fetchImpl, error] of cases) {
            const r = await readKeyUsage({ key: KEY, fetchImpl });
            assert.deepEqual(r, { ok: false, error });
            assert.ok(!JSON.stringify(r).includes(KEY));
        }
        assert.deepEqual(await readKeyUsage({ key: '', fetchImpl: () => Promise.resolve(resp(200, {})) }), { ok: false, error: 'no key' });
        const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
        assert.deepEqual(await readKeyUsage({ key: KEY, fetchImpl: hang, timeoutMs: 50 }), { ok: false, error: 'timeout' });
    });

    test('the file-backed fake is used only in test mode', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-usage-'));
        const file = path.join(dir, 'usage.json');
        fs.writeFileSync(file, JSON.stringify({ data: { usage: 0.5 } }));
        const real = () => Promise.resolve(resp(500, {}));
        assert.equal(keyFetch({ ROTN_OPENROUTER_USAGE_FILE: file }, real), real, 'outside test mode the real endpoint is always used');
        const fake = keyFetch({ ROTN_TEST_MODE: '1', ROTN_OPENROUTER_USAGE_FILE: file }, real);
        assert.notEqual(fake, real);
        assert.deepEqual(await readKeyUsage({ key: KEY, fetchImpl: fake }), { ok: true, usage: 0.5, limit: null, remaining: null });
        // Inside a real test-server run (TEST_SERVER_CTL set, no fake cloud) the real endpoint is used.
        assert.equal(keyFetch({ ROTN_TEST_MODE: '1', ROTN_OPENROUTER_USAGE_FILE: file, TEST_SERVER_CTL: '/x/test-server.sh' }, real), real);
        assert.equal(keyFetch({ ROTN_TEST_MODE: '1', ROTN_OPENROUTER_USAGE_FILE: file, TEST_SERVER_CTL: '/x/test-server.sh', TEST_SERVER_FAKE_CLOUD: '0' }, real), real);
        assert.notEqual(keyFetch({ ROTN_TEST_MODE: '1', ROTN_OPENROUTER_USAGE_FILE: file, TEST_SERVER_CTL: '/x/test-server.sh', TEST_SERVER_FAKE_CLOUD: '1' }, real), real);
    });

    test('test-mode overrides are refused inside a real test-server run (#122 finding 2)', () => {
        const real = { TEST_SERVER_CTL: '/x/test-server.sh', TEST_SERVER_FAKE_CLOUD: '0' };
        assert.equal(testOverridesAllowed({ ROTN_TEST_MODE: '1', ...real }), false);
        assert.deepEqual(forbiddenOverrides({ ...real, ROTN_TEST_MODE: '1', ROTN_OPENROUTER_USAGE_FILE: 'u', ROTN_BATCH_RUNNER: 'r' }),
            ['ROTN_TEST_MODE', 'ROTN_OPENROUTER_USAGE_FILE', 'ROTN_BATCH_RUNNER']);
        assert.deepEqual(forbiddenOverrides({ ...real, ROTN_OPENROUTER_USAGE_FILE: 'u' }), ['ROTN_OPENROUTER_USAGE_FILE'], 'even without test mode');
        assert.deepEqual(forbiddenOverrides({ ...real }), []);
        assert.deepEqual(forbiddenOverrides({ ROTN_TEST_MODE: '1', ROTN_OPENROUTER_USAGE_FILE: 'u', TEST_SERVER_CTL: '/x', TEST_SERVER_FAKE_CLOUD: '1' }), [], 'the offline fake cloud');
        assert.deepEqual(forbiddenOverrides({ ROTN_TEST_MODE: '1', ROTN_BATCH_RUNNER: 'r' }), [], 'no test-server run at all');
    });

    test('calls, cost and the per-scenario record', () => {
        assert.equal(countLlmCalls(['a', LLM_CALL_LINE, 'Received.', `x ${LLM_CALL_LINE}`]), 2);
        assert.equal(spent({ ok: true, usage: 1.1 }, { ok: true, usage: 1.4 }), 0.3);
        assert.equal(spent({ ok: true, usage: 1 }, { ok: false, error: 'http 401' }), null);
        const start = `DRIVER ${JSON.stringify({ type: 'mindcraft_start', models: { model: LLM_MODEL, code_model: null, vision_model: null } })}`;
        assert.deepEqual(llmRecord({ ok: true, usage: 1 }, { ok: true, usage: 1.25 }, [start, LLM_CALL_LINE, LLM_CALL_LINE]),
            { models: { model: LLM_MODEL, code_model: null, vision_model: null }, calls: 2, replies: { ok: 0, memory: 0, failed: 0, disconnected: 0, empty: 0, memoryEmpty: 0 }, httpErrors: {}, providers: {}, summariesUnattributed: { ok: 0, empty: 0, failed: 0 }, usageBefore: 1, usageAfter: 1.25, usd: 0.25, error: null });
        assert.deepEqual(llmRecord({ ok: true, usage: 1 }, { ok: false, error: 'timeout' }, []),
            { models: null, calls: 0, replies: { ok: 0, memory: 0, failed: 0, disconnected: 0, empty: 0, memoryEmpty: 0 }, httpErrors: {}, providers: {}, summariesUnattributed: { ok: 0, empty: 0, failed: 0 }, usageBefore: 1, usageAfter: null, usd: null, error: 'timeout' });
    });

    test('the model of every LLM run: the OpenRouter preset (the human\'s decision, 2026-11-06), recorded from the driver', () => {
        assert.equal(LLM_MODEL, 'openrouter/@preset/glm-5-3-flash-cheap-reliable');
        assert.equal(modelId('openrouter/@preset/glm-5-3-flash-cheap-reliable'), LLM_MODEL);
        assert.equal(modelId({ api: 'openrouter', model: '@preset/glm-5-3-flash-cheap-reliable' }), LLM_MODEL, 'the object form is the same model');
        assert.equal(modelId({ api: 'openrouter', model: 'openrouter/@preset/glm-5-3-flash-cheap-reliable' }), LLM_MODEL, 'a prefixed model is not prefixed twice');
        assert.equal(modelId({ model: 'openrouter/@preset/glm-5-3-flash-cheap-reliable', params: { temperature: 0 } }), LLM_MODEL);
        for (const bad of [undefined, null, '', 3, {}, { model: 3 }]) assert.equal(modelId(bad), null, JSON.stringify(bad));
        assert.deepEqual(modelProblems({ model: LLM_MODEL }), []);
        assert.deepEqual(modelProblems({ model: LLM_MODEL, code_model: LLM_MODEL, vision_model: { api: 'openrouter', model: '@preset/glm-5-3-flash-cheap-reliable' } }), []);
        assert.equal(modelProblems({ model: 'gpt-4o' }).length, 1);
        assert.equal(modelProblems({ model: LLM_MODEL, code_model: 'claude-sonnet-4-6' }).length, 1);
        assert.deepEqual(profileModels({ model: LLM_MODEL }), { model: LLM_MODEL, code_model: null, vision_model: null });
        assert.equal(agentModels(['noise', 'DRIVER {bad', `DRIVER ${JSON.stringify({ type: 'mindcraft_start', models: { model: 'x' } })}`]).model, 'x');
        assert.equal(agentModels(['DRIVER {"type":"refused"}']), null);
    });

    test('an unknown LLM cost makes a run not gate-valid', () => {
        const r = addNotGate({ pass: true, gateValid: true, verdict: 'PASS', weakenedParams: [] }, 'the LLM cost is unknown (timeout)');
        assert.deepEqual([r.pass, r.gateValid, r.verdict, r.weakenedParams], [false, false, 'SMOKE-PASS (not a gate pass)', ['the LLM cost is unknown (timeout)']]);
        const f = addNotGate({ pass: false, gateValid: true, verdict: 'FAIL', weakenedParams: [] }, 'x');
        assert.equal(f.verdict, 'FAIL');
    });
});

describe('maxBatchUsd: USD 2, an equal gate parameter of every G3 scenario', () => {
    test('another limit weakens the run', () => {
        assert.equal(G3_DEFAULTS.maxBatchUsd, 2);
        const sc = { defaults: { ...G3_DEFAULTS }, gateParams: { ...G3_GATE_PARAMS } };
        assert.deepEqual(weakenedParams(sc, { maxBatchUsd: 2 }), []);
        assert.deepEqual(weakenedParams(sc, { maxBatchUsd: 3 }), ['maxBatchUsd=3 (gate needs = 2)']);
        assert.deepEqual(weakenedParams(sc, { maxBatchUsd: 1 }), ['maxBatchUsd=1 (gate needs = 2)']);
    });

    test('the spend gate: go while within the limit, stop above it or without a reading', () => {
        const base = { ok: true, usage: 10 };
        assert.deepEqual(spendGate(base, { ok: true, usage: 11.5 }, 2), { go: true, spent: 1.5 });
        assert.deepEqual(spendGate(base, { ok: true, usage: 12 }, 2), { go: true, spent: 2 }, 'exactly the limit is not more than it');
        assert.match(spendGate(base, { ok: true, usage: 12.01 }, 2).reason, /spent USD 2.01 since the batch start, more than maxBatchUsd 2/);
        assert.match(spendGate(base, { ok: false, error: 'http 401' }, 2).reason, /usage cannot be read \(http 401\)/);
    });

    test('the end of the batch fails closed: over the limit 5, no reading 6 (#122 finding 1)', () => {
        const base = { ok: true, usage: 1 };
        assert.deepEqual(endVerdict(base, { ok: true, usage: 2.5 }, 2, 0), { exit: 0, reason: null });
        assert.deepEqual(endVerdict(base, { ok: true, usage: 2.5 }, 2, 1), { exit: 1, reason: null });
        assert.equal(endVerdict(base, { ok: true, usage: 3.5 }, 2, 0).exit, EXIT_SPEND_STOP);
        assert.match(endVerdict(base, { ok: true, usage: 3.5 }, 2, 0).reason, /spent USD 2.5 by the end of the batch, more than maxBatchUsd 2/);
        assert.equal(endVerdict(base, { ok: false, error: 'network' }, 2, 0).exit, EXIT_SPEND_UNKNOWN);
        assert.equal(endVerdict(base, null, 2, 0).exit, EXIT_SPEND_UNKNOWN);
        assert.equal(endVerdict({ ok: false }, { ok: true, usage: 1 }, 2, 0).exit, EXIT_SPEND_UNKNOWN, 'a null spend');
    });

    test('g3Policy: the guard whenever the agent runs or the gate is G3; a G3 run needs batch.mjs\'s marker with the same limit', () => {
        assert.deepEqual(g3Policy({ gate: 'G3', llm: true }, { ROTN_G3_BATCH: '20261102T2100-123:2' }, 2), { guard: true, notGate: null, batch: '20261102T2100-123:2' });
        assert.match(g3Policy({ gate: 'G3', llm: true }, {}, 2).notGate, /a G3 run outside batch\.mjs has no spend stop/);
        assert.match(g3Policy({ gate: 'G3', llm: true }, { ROTN_G3_BATCH: 'x' }, 2).notGate, /no ROTN_G3_BATCH marker/);
        assert.match(g3Policy({ gate: 'G3', llm: true }, { ROTN_G3_BATCH: 'b-1:3' }, 2).notGate, /spend limit 3 is not this run's maxBatchUsd 2/);
        assert.deepEqual(g3Policy({ gate: 'S1', llm: true }, {}, undefined), { guard: true, notGate: null, batch: null }, 'any real-agent run is guarded');
        assert.deepEqual(g3Policy({ gate: 'G2' }, {}, undefined), { guard: false, notGate: null, batch: null });
    });

    test('every G3 scenario runs the real agent and carries maxBatchUsd 2 compared equal (#122 finding 3)', async (t) => {
        const all = Object.values(await loadScenarios());
        assert.ok(all.length > 0, 'loadScenarios found scenarios at all, so an empty G3 list below is real');
        const g3 = all.filter((sc) => sc.gate === 'G3');
        // #122 nit 2, #129 review: never a silent pass over an empty list.
        if (!g3.length) {
            t.skip('no G3 scenarios yet');
            return;
        }
        for (const sc of g3) {
            assert.equal(sc.llm, true, `${sc.id}: llm`);
            assert.equal(sc.defaults?.maxBatchUsd, 2, `${sc.id}: default maxBatchUsd`);
            assert.equal(sc.gateParams?.maxBatchUsd, 'equal', `${sc.id}: maxBatchUsd compared equal`);
        }
    });

    test('batch arguments', () => {
        const ok = parseBatchArgs(['--max-batch-usd', '2', '--logs-out', 'L', '--scenario', 'a', '--out', 'A', '--timeout-min', '55', '--scenario', 'b', '--out', 'B', '--', 'node', 'd.mjs']);
        assert.deepEqual(ok.problems, []);
        assert.deepEqual(ok.options.scenarios, [{ id: 'a', out: 'A', timeoutMin: null }, { id: 'b', out: 'B', timeoutMin: 55 }], 'no --timeout-min: null, derived later (scenarioTimeouts)');
        assert.deepEqual(ok.options.driver, ['node', 'd.mjs']);
        const bad = parseBatchArgs(['--scenario', 'a', '--bogus']);
        for (const m of [/unknown argument '--bogus'/, /--max-batch-usd must be a positive/, /--logs-out is required/, /--scenario a has no --out/, /driver comes after --/]) {
            assert.ok(bad.problems.some((p) => m.test(p)), `${m}: ${JSON.stringify(bad.problems)}`);
        }
    });
});

/** batch.mjs with the fake runner, a fake key-usage file and a fake TEST_SERVER_CTL that records the fetch. */
function runBatch({ spend = '1.5', usage = 0, maxUsd = '2', scenarios = ['a', 'b', 'c'], key = KEY, usageFile = true, runExit = '0', fakeCloud = '1', breakUsage = '', hang = '', timeoutMin = null,
    driver = ['node', 'driver.mjs'], preflight = false, mark = 'passed', mode = null, extraEnv = {} } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-batch-'));
    const file = path.join(dir, 'usage.json');
    if (usageFile) fs.writeFileSync(file, JSON.stringify({ data: { usage, limit: 5, limit_remaining: 5 - usage } }));
    const ctl = path.join(dir, 'ctl.sh');
    fs.writeFileSync(ctl, `#!/usr/bin/env bash\necho "$*" >> "${fwd(path.join(dir, 'ctl.txt'))}"\n`);
    const args = [BATCH, ...(preflight ? [preflight === true ? '--preflight' : preflight] : []), '--max-batch-usd', maxUsd, '--logs-out', fwd(path.join(dir, 'logs')), '--summary', path.join(dir, 'batch.json')];
    if (mode) args.push(mode);
    if (timeoutMin) args.push('--timeout-min', timeoutMin);
    for (const s of scenarios) args.push('--scenario', s, '--out', path.join(dir, `out-${s}`));
    args.push('--', ...driver);
    const env = { ...process.env, ROTN_TEST_MODE: '1', ROTN_OPENROUTER_USAGE_FILE: file, ROTN_BATCH_RUNNER: FAKE_RUNNER,
        FAKE_DIR: dir, FAKE_SPEND: spend, FAKE_RUN_EXIT: runExit, TEST_SERVER_CTL: fwd(ctl), TEST_SERVER_FAKE_CLOUD: fakeCloud, FAKE_BREAK_USAGE: breakUsage, FAKE_HANG: hang, OPENROUTER_API_KEY: key,
        ROTN_BATCH_PREFLIGHT: mark };
    Object.assign(env, extraEnv);
    if (!key) delete env.OPENROUTER_API_KEY;
    if (!mark) delete env.ROTN_BATCH_PREFLIGHT;
    return new Promise((resolve) => {
        const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', (b) => { out += b; });
        child.stderr.on('data', (b) => { out += b; });
        child.on('exit', (code) => {
            const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
            resolve({ code, out, dir, ran: read('ran.txt').trim().split('\n').filter(Boolean), ctl: read('ctl.txt'), summary: JSON.parse(read('batch.json') || 'null') });
        });
    });
}

describe('batch.mjs: the spend stop', () => {
    test('stops before the scenario that would start above the limit, still fetches the logs, exits 5', { timeout: 60000 }, async () => {
        const r = await runBatch({ spend: '1.5' });
        assert.equal(r.code, EXIT_SPEND_STOP, r.out);
        assert.deepEqual(r.ran, ['a maxBatchUsd=2 key:set batch:set', 'b maxBatchUsd=2 key:set batch:set'], 'c never starts: USD 3 spent > 2; each run had the marker');
        assert.equal(r.summary.testMode, true);
        assert.match(r.summary.batchId, /^[0-9T]+-\d+$/);
        assert.match(r.ctl, /^fetch logs --out .*\/logs$/m, 'the logs are fetched');
        assert.match(r.out, /spend stop before c: spent USD 3 since the batch start, more than maxBatchUsd 2/);
        assert.equal(r.summary.stopped, 'before c: spent USD 3 since the batch start, more than maxBatchUsd 2');
        assert.deepEqual(r.summary.scenarios.map((s) => [s.id, s.exit, s.spentBefore]), [['a', 0, 0], ['b', 0, 1.5]]);
        assert.deepEqual([r.summary.usageAtStart, r.summary.usageAtEnd, r.summary.spentUsd, r.summary.logsFetched], [0, 3, 3, true]);
        assert.ok(!r.out.includes(KEY) && !JSON.stringify(r.summary).includes(KEY), 'the key is never printed');
    });

    test('within the limit every scenario runs and the batch exits 0', { timeout: 60000 }, async () => {
        const r = await runBatch({ spend: '0.5' });
        assert.equal(r.code, 0, r.out);
        assert.equal(r.ran.length, 3);
        assert.equal(r.summary.stopped, null);
        assert.match(r.ctl, /fetch logs/);
    });

    test('spend over the limit by the end of the last scenario exits 5 (#122 finding 1)', { timeout: 60000 }, async () => {
        const r = await runBatch({ spend: '1.5', scenarios: ['a', 'b'] });
        assert.equal(r.code, EXIT_SPEND_STOP, r.out);
        assert.equal(r.ran.length, 2, 'both ran: the spend was within the limit before each');
        assert.equal(r.summary.stopped, 'after the last scenario: spent USD 3 by the end of the batch, more than maxBatchUsd 2');
        assert.match(r.ctl, /fetch logs/);
    });

    test('a failed usage reading at the end exits 6 (#122 finding 1)', { timeout: 60000 }, async () => {
        const r = await runBatch({ spend: '0.1', scenarios: ['a', 'b'], breakUsage: 'b' });
        assert.equal(r.code, EXIT_SPEND_UNKNOWN, r.out);
        assert.equal(r.ran.length, 2);
        assert.equal(r.summary.usageAtEnd, null);
        assert.match(r.summary.stopped, /after the last scenario: the key's usage cannot be read at the end/);
        assert.match(r.ctl, /fetch logs/);
    });

    test('inside a real test-server run the test-mode overrides make it refuse to start (#122 finding 2)', { timeout: 60000 }, async () => {
        const r = await runBatch({ fakeCloud: '0' });
        assert.equal(r.code, 2, r.out);
        assert.match(r.out, /refused: ROTN_TEST_MODE, ROTN_OPENROUTER_USAGE_FILE, ROTN_BATCH_RUNNER set inside a real test-server run/);
        assert.deepEqual(r.ran, []);
    });

    test('a failing scenario does not stop the batch, but the batch exits 1', { timeout: 60000 }, async () => {
        const r = await runBatch({ spend: '0', runExit: '1' });
        assert.equal(r.code, 1);
        assert.equal(r.ran.length, 3);
    });

    test('no usage reading at the start: nothing runs, the logs are still fetched, exit 2', { timeout: 60000 }, async () => {
        for (const opt of [{ key: '' }, { usageFile: false }]) {
            const r = await runBatch(opt);
            assert.equal(r.code, 2, r.out);
            assert.deepEqual(r.ran, []);
            assert.match(r.out, /a batch whose spend cannot be watched does not run/);
            assert.match(r.ctl, /fetch logs/);
        }
    });
});

describe('batch.mjs: the preflight before any server exists (lead, #169 review)', () => {
    const DRIVER = path.join(HERE, '..', 'runner', 'drivers', 'mindcraft-driver.mjs');
    const profiles = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-pre-'));
    const prof = (name, body) => { const f = path.join(profiles, name); fs.writeFileSync(f, JSON.stringify(body)); return f; };
    const good = prof('good.json', { name: 'FRCFLD', model: LLM_MODEL });
    const other = prof('other.json', { name: 'FRCFLD', model: 'openrouter/openai/gpt-4o' });
    const code = prof('code.json', { name: 'FRCFLD', model: LLM_MODEL, code_model: 'openrouter/x/y' });

    test('driverPreflight: the Mindcraft driver with a profile on the preset passes; another model, a bad profile or a task argument refuses', async () => {
        assert.deepEqual(await driverPreflight(['node', DRIVER, '--profile', good], {}), []);
        assert.deepEqual(await driverPreflight(['node', fwd(DRIVER), '--profile', good], {}), [], 'forward slashes name the same driver');
        assert.match((await driverPreflight(['node', DRIVER, '--profile', other], {})).join('; '), /^driver: profile .*model is 'openrouter\/openai\/gpt-4o', not openrouter\/@preset\/glm-5-3-flash-cheap-reliable/);
        assert.match((await driverPreflight(['node', DRIVER, '--profile', code], {})).join('; '), /code_model is 'openrouter\/x\/y'/);
        assert.match((await driverPreflight(['node', DRIVER, '--profile', path.join(profiles, 'none.json')], {})).join('; '), /not found/);
        assert.match((await driverPreflight(['node', DRIVER], {})).join('; '), /--profile is required/);
        assert.match((await driverPreflight(['node', DRIVER, '--profile', good, '--task_path', 't.json'], {})).join('; '), /never loads Mindcraft task files/);
    });

    test('driverPreflight: any other driver is refused outside test mode, and allowed only with the offline test overrides', async () => {
        assert.match((await driverPreflight(['node', 'driver.mjs'], {}))[0], /the driver must be .*mindcraft-driver\.mjs/);
        assert.match((await driverPreflight(['node', 'mindcraft-driver.mjs'], {}))[0], /the driver must be/, 'a file of the same name elsewhere is not the driver');
        assert.deepEqual(await driverPreflight(['node', 'driver.mjs'], { ROTN_TEST_MODE: '1' }), []);
        assert.match((await driverPreflight(['node', 'driver.mjs'], { ROTN_TEST_MODE: '1', TEST_SERVER_CTL: 'ctl', TEST_SERVER_FAKE_CLOUD: '0' }))[0], /the driver must be/, 'not inside a real test-server run');
    });

    test('--preflight: passes with the preset and a usage reading, runs nothing, fetches nothing, writes no summary', { timeout: 60000 }, async () => {
        const r = await runBatch({ preflight: true, mark: '', driver: ['node', DRIVER, '--profile', good] });
        assert.equal(r.code, 0, r.out);
        assert.match(r.out, /preflight passed: driver, profile, model and settings checked; the key's usage can be read; the LLM probe was skipped \(offline test mode, no probe file\); 3 scenario\(s\)/);
        assert.deepEqual([r.ran, r.ctl, r.summary], [[], '', null]);
        assert.ok(!r.out.includes(KEY), 'the key is never printed');
    });

    test('--preflight-files (a dry run): the same file checks, no usage reading at all (#176 review nit)', { timeout: 60000 }, async () => {
        // No usage file: --preflight would refuse, so passing shows the usage was not read.
        const ok = await runBatch({ preflight: '--preflight-files', mark: '', usageFile: false, driver: ['node', DRIVER, '--profile', good] });
        assert.equal(ok.code, 0, ok.out);
        assert.match(ok.out, /preflight passed \(files only, a dry run\): driver, profile, model and settings checked; the key's usage was not read/);
        assert.deepEqual([ok.ran, ok.ctl, ok.summary], [[], '', null]);
        const bad = await runBatch({ preflight: '--preflight-files', mark: '', usageFile: false, driver: ['node', DRIVER, '--profile', other] });
        assert.equal(bad.code, 2, bad.out);
        assert.match(bad.out, /refused: driver: profile .*model is 'openrouter\/openai\/gpt-4o'/);
        const p = parseBatchArgs(['--preflight-files', '--max-batch-usd', '2', '--logs-out', 'l', '--scenario', 'a', '--out', 'o', '--', 'node', 'd.mjs']);
        assert.deepEqual([p.options.preflight, p.options.readUsage, p.problems], [true, false, []]);
        assert.equal(parseBatchArgs(['--preflight', '--max-batch-usd', '2', '--logs-out', 'l', '--scenario', 'a', '--out', 'o', '--', 'node', 'd.mjs']).options.readUsage, true);
    });

    test('--preflight: another model, or no usage reading, refuses with 2 and runs nothing', { timeout: 60000 }, async () => {
        const m = await runBatch({ preflight: true, mark: '', driver: ['node', DRIVER, '--profile', other] });
        assert.equal(m.code, 2, m.out);
        assert.match(m.out, /refused: driver: profile .*model is 'openrouter\/openai\/gpt-4o'/);
        const u = await runBatch({ preflight: true, mark: '', usageFile: false, driver: ['node', DRIVER, '--profile', good] });
        assert.equal(u.code, 2, u.out);
        assert.match(u.out, /preflight refused: the key's usage cannot be read/);
        for (const r of [m, u]) assert.deepEqual([r.ran, r.ctl, r.summary], [[], '', null]);
    });

    test('the batch itself repeats the checks, and inside a test-server run refuses without the preflight mark', { timeout: 60000 }, async () => {
        const m = await runBatch({ driver: ['node', DRIVER, '--profile', other] });
        assert.equal(m.code, 2, m.out);
        assert.match(m.out, /refused: driver: profile .*model is/);
        const n = await runBatch({ mark: '' });
        assert.equal(n.code, 2, n.out);
        assert.match(n.out, /refused: inside a test-server run without ROTN_BATCH_PREFLIGHT=passed/);
        const w = await runBatch({ mark: 'yes' });
        assert.equal(w.code, 2, 'only the exact value test-server.sh sets');
        for (const r of [m, n, w]) assert.deepEqual(r.ran, [], 'no scenario started');
    });

    test('parseBatchArgs: --preflight is a flag; everything else is checked the same', () => {
        const a = ['--max-batch-usd', '2', '--logs-out', 'l', '--scenario', 'a', '--out', 'o', '--', 'node', 'd.mjs'];
        assert.equal(parseBatchArgs(a).options.preflight, false);
        const p = parseBatchArgs(['--preflight', ...a]);
        assert.deepEqual([p.options.preflight, p.problems], [true, []]);
        assert.match(parseBatchArgs(['--preflight', '--logs-out', 'l']).problems.join('; '), /--max-batch-usd/);
    });
});

describe('batch.mjs: timeouts, spawn errors and the summary (#122 nits 1, 3, 4)', () => {
    test('a scenario stopped by the batch\'s timeout is recorded as 124 (run.mjs itself exits 143)', { timeout: 60000 }, async () => {
        const r = await runBatch({ spend: '0', scenarios: ['a', 'b'], hang: 'a', timeoutMin: '0.02' });
        assert.deepEqual(r.summary.scenarios.map((x) => [x.id, x.exit]), [['a', 124], ['b', 0]], r.out);
        assert.equal(r.code, 1);
        assert.match(r.out, /a: timeout after 0.02 min, stopping it/);
    });

    test('a runner that cannot start is logged and recorded as 127', async () => {
        const fakeSpawn = () => { const c = new EventEmitter(); c.kill = () => {}; setImmediate(() => c.emit('error', Object.assign(new Error('spawn failed'), { code: 'EACCES' }))); return c; };
        const code = await runOne({ id: 'a', out: 'A', timeoutMin: 1 }, { maxBatchUsd: 2, driver: ['node', 'd.mjs'] }, {}, { spawnImpl: fakeSpawn });
        assert.equal(code, 127);
    });

    test('the summary records each scenario\'s output folder, its runId and the batch\'s exit', { timeout: 60000 }, async () => {
        const r = await runBatch({ spend: '0', scenarios: ['a'] });
        assert.equal(r.summary.exit, 0);
        const a = r.summary.scenarios[0];
        assert.ok(path.isAbsolute(a.out) && a.out.endsWith('out-a'));
        assert.equal(a.runId, JSON.parse(fs.readFileSync(path.join(a.out, 'result.json'), 'utf8')).runId, 'the runId read back from the run\'s result.json');
        assert.match(a.runId, /^fake-a-\d+$/);
    });

    test('runIdOf: the runId from result.json, or null without one', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-runid-'));
        assert.equal(runIdOf(dir), null);
        fs.writeFileSync(path.join(dir, 'result.json'), '{');
        assert.equal(runIdOf(dir), null);
        fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ runId: 'r1' }));
        assert.equal(runIdOf(dir), 'r1');
    });
});

describe('the G3 gate evidence cross-check: a forged marker is not enough (#122 nit 1)', () => {
    const summary = { batchId: '20261102T2200-42', testMode: false, maxBatchUsd: 2, scenarios: [{ id: 'g3-a', runId: 'run-a', exit: 0 }, { id: 'g3-b', runId: 'run-b', exit: 1 }], exit: 1 };
    const res = (scenario, extra = {}) => ({ file: `${scenario}/result.json`, result: { scenario, gate: 'G3', pass: false, batch: '20261102T2200-42:2', runId: `run-${scenario.slice(3)}`, ...extra } });

    test('consistent results pass', () => {
        assert.deepEqual(crossCheckBatch(summary, [res('g3-a', { pass: true }), res('g3-b')]), []);
    });

    test('a forged marker, a scenario the batch never ran, a passing result the batch saw fail, test mode', () => {
        assert.match(crossCheckBatch(summary, [res('g3-a', { batch: 'x-1:2' })])[0], /marker 'x-1:2' is not this batch's '20261102T2200-42:2'/);
        assert.match(crossCheckBatch(summary, [res('g3-c')])[0], /ran g3-c 0 time\(s\), not once/);
        assert.match(crossCheckBatch(summary, [res('g3-b', { pass: true })])[0], /a passing result, but the batch recorded exit 1 for g3-b/);
        assert.match(crossCheckBatch({ ...summary, testMode: true }, [res('g3-a')])[0], /ran in test mode/);
        assert.match(crossCheckBatch({ ...summary, testMode: undefined }, [res('g3-a')])[0], /ran in test mode \(or does not say\)/);
        const twice = { ...summary, scenarios: [...summary.scenarios, { id: 'g3-a', runId: 'run-a2', exit: 0 }] };
        assert.match(crossCheckBatch(twice, [res('g3-a')])[0], /ran g3-a 2 time\(s\), not once/);
        assert.match(crossCheckBatch(null, [res('g3-a')])[0], /no batch summary/);
        assert.match(crossCheckBatch(summary, [])[0], /no G3 result\.json to check/);
        assert.deepEqual(crossCheckBatch(summary, [{ file: 'x', result: { gate: 'G2', scenario: 'g2-x' } }, res('g3-a')]), [], 'non-G3 results are not this check\'s business');
    });

    test('a second, hand-run result under a reused batch id fails on its runId (#129 review)', () => {
        assert.match(crossCheckBatch(summary, [res('g3-a', { runId: 'hand-run' })])[0], /its runId 'hand-run' is not the run batch 20261102T2200-42 recorded for g3-a \('run-a'\)/);
        assert.match(crossCheckBatch(summary, [res('g3-a', { runId: undefined })])[0], /its runId 'none'/);
        const noRun = { ...summary, scenarios: [{ id: 'g3-a', runId: null, exit: 0 }] };
        assert.match(crossCheckBatch(noRun, [res('g3-a')])[0], /recorded for g3-a \('none'\)/, 'a batch that recorded no runId vouches for nothing');
    });

    test('a g3- scenario without the gate field is still a G3 result', () => {
        assert.equal(isG3Result({ gate: 'G3' }), true);
        assert.equal(isG3Result({ scenario: 'g3-first-night' }), true);
        assert.equal(isG3Result({ gate: 'G2', scenario: 'g2-blocks-named' }), false);
        assert.match(crossCheckBatch(summary, [res('g3-a', { gate: undefined, batch: 'x-1:2' })])[0], /marker 'x-1:2'/);
    });

    test('the gate in any case or spacing, and a scenario loadScenarios marks G3, are G3 results too (#129 re-review nit 2)', () => {
        for (const gate of ['g3', 'G3', ' g3 ', 'G3\n']) assert.equal(isG3Result({ gate, scenario: 'first-night' }), true, JSON.stringify(gate));
        assert.equal(isG3Result({ scenario: 'G3-First-Night' }), true);
        assert.equal(isG3Result({ scenario: 'first-night' }), false, 'no gate and no g3- prefix: only the scenario list can tell');
        assert.equal(isG3Result({ scenario: 'First-Night' }, ['first-night']), true, 'a scenario loadScenarios marks G3, without case');
        assert.equal(isG3Result({ scenario: 'first-night' }, [' First-Night\n']), true, 'the scenario list ids are trimmed too (#139 review nit 1)');
        assert.equal(isG3Result({ scenario: '' }, ['']), false);
        assert.equal(isG3Result({ scenario: ' ' }, [' ']), false, 'a blank id never matches a blank list entry');
        for (const notObject of [null, [], 'G3', 3]) assert.equal(isG3Result(notObject), false);
        // The review's case: gate 'g3' with an unprefixed scenario id and a forged marker is cross-checked.
        assert.match(crossCheckBatch(summary, [{ file: 'x', result: { gate: 'g3', scenario: 'first-night', batch: 'x-1:2' } }])[0], /marker 'x-1:2'/);
        assert.match(crossCheckBatch(summary, [{ file: 'x', result: { scenario: 'first-night', batch: 'x-1:2' } }], { g3Scenarios: ['first-night'] })[0], /marker 'x-1:2'/);
    });

    test('the CLI helper reads the files; unreadable files are problems', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-check-'));
        fs.writeFileSync(path.join(dir, 'batch.json'), JSON.stringify(summary));
        fs.mkdirSync(path.join(dir, 'a'));
        fs.writeFileSync(path.join(dir, 'a', 'result.json'), JSON.stringify(res('g3-a').result));
        assert.deepEqual(checkFiles(path.join(dir, 'batch.json'), resultFilesUnder(dir)), []);
        fs.writeFileSync(path.join(dir, 'a', 'result.json'), '{');
        assert.match(checkFiles(path.join(dir, 'batch.json'), resultFilesUnder(dir))[0], /cannot be read as JSON/);
        assert.match(checkFiles(path.join(dir, 'none.json'), [])[0], /cannot be read as JSON \(ENOENT\)/);
    });

    test('the tree check: a G3 result no batch.json covers fails; a covered one passes; non-G3 results are ignored (#129 review)', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-tree-'));
        const put = (rel, obj) => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), typeof obj === 'string' ? obj : JSON.stringify(obj));
        };
        const all = () => checkEvidenceTree(root).join('\n');
        put('g2/batch-8/blocks/result.json', { gate: 'G2', scenario: 'g2-blocks-named' });
        assert.deepEqual(checkEvidenceTree(root), [], 'no G3 results: nothing to vouch for');
        // The review's case: a forged marker, a G3 result.json, no batch.json anywhere above it.
        put('g3/foo/result.json', res('g3-a', { batch: 'x-1:2' }).result);
        assert.match(all(), /g3[\\/]foo[\\/]result\.json: a G3 result that no batch\.json covers/);
        fs.rmSync(path.join(root, 'g3', 'foo'), { recursive: true });
        // A real batch: batch.json at the batch folder, results nested below it.
        put('g3/b1/batch.json', { ...summary, gate: true, smoke: false });   // a gate batch (#220 decision: only --gate writes gate: true)
        put('g3/b1/a/result.json', res('g3-a', { pass: true }).result);
        put('g3/b1/b/result.json', res('g3-b').result);
        assert.deepEqual(checkEvidenceTree(root), []);
        // A G3 result outside any batch folder is not covered by b1's batch.json.
        put('s1/stray/result.json', { scenario: 'g3-a', runId: 'run-a', batch: '20261102T2200-42:2' });
        assert.match(all(), /s1[\\/]stray[\\/]result\.json: a G3 result that no batch\.json covers/);
        fs.rmSync(path.join(root, 's1'), { recursive: true });
        // A covered result that its batch does not vouch for, then an unreadable result.
        put('g3/b1/c/result.json', res('g3-c').result);
        assert.match(all(), /ran g3-c 0 time\(s\), not once/);
        put('g3/b1/c/result.json', '{');
        assert.match(all(), /cannot be read as JSON .* may hide a G3 result/);
        assert.deepEqual(checkEvidenceTree(path.join(root, 'none')), []);
    });

    test('the tree check reads every *.json, whatever its name; a batch.json that is a G3 result is a problem (#129 re-review nit 1)', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-names-'));
        const put = (rel, obj) => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), typeof obj === 'string' ? obj : JSON.stringify(obj));
        };
        const forged = res('g3-a', { batch: 'x-1:2' }).result;
        for (const name of ['g3-result.json', 'Result.json', 'RESULT.JSON', 'notes/run.json']) {
            put(`g3/hand/${name}`, forged);
            assert.match(checkEvidenceTree(root).join('\n'), /a G3 result that no batch\.json covers/, name);
            fs.rmSync(path.join(root, 'g3'), { recursive: true });
        }
        // An unprefixed scenario with a lower-case gate, or one only loadScenarios knows as G3.
        put('g3/hand/r.json', { gate: 'g3', scenario: 'first-night', batch: 'x-1:2' });
        assert.match(checkEvidenceTree(root).join('\n'), /a G3 result that no batch\.json covers/);
        put('g3/hand/r.json', { scenario: 'first-night', batch: 'x-1:2' });
        assert.deepEqual(checkEvidenceTree(root), [], 'without the scenario list it cannot tell');
        assert.match(checkEvidenceTree(root, { g3Scenarios: ['first-night'] }).join('\n'), /a G3 result that no batch\.json covers/);
        fs.rmSync(path.join(root, 'g3'), { recursive: true });
        // A result hidden in a file named batch.json.
        put('g3/hand/batch.json', forged);
        assert.match(checkEvidenceTree(root).join('\n'), /a batch\.json that is itself a G3 result/);
        fs.rmSync(path.join(root, 'g3'), { recursive: true });
        // Any unreadable *.json is a problem, since it could hide one.
        put('g2/x/notes.json', '{');
        assert.match(checkEvidenceTree(root).join('\n'), /notes\.json: cannot be read as JSON .* may hide a G3 result/);
        assert.deepEqual(jsonFilesUnder(root).map((p) => path.basename(p)), ['notes.json']);
    });

    test('CI: every G3 result in any *.json under test/evidence/ is covered and vouched for by its batch.json', async (t) => {
        const root = path.join(HERE, '..', 'evidence');
        const g3Scenarios = await g3ScenarioIds();
        assert.deepEqual(checkEvidenceTree(root, { g3Scenarios }), []);
        const g3 = resultFilesUnder(root).filter((f) => {
            try {
                return isG3Result(JSON.parse(fs.readFileSync(f, 'utf8')), g3Scenarios);
            } catch {
                return false;
            }
        });
        t.diagnostic(`${jsonFilesUnder(root).length} *.json read, ${g3.length} G3 result(s), ${g3Scenarios.length} G3 scenario(s) known`);
    });
});

describe('G3 console: only the approved commands reach the server (no give, summon or op commands)', () => {
    const sent = [];
    const g = guardConsole({ console: (cmd) => { sent.push(cmd); return []; }, log: () => [] });
    test('approved commands pass through', () => {
        const ok = ['say scenario-20261102t1-abc-begin', 'seed', 'tell FRCFLD !task add go to the gold block',
            'testforblock -45 65 -66 minecraft:dirt 2', 'testfor @e[tag=t1,type=minecraft:zombie,x=1,y=2,z=3,r=3]', 'clear FRCFLD minecraft:stone_pickaxe -1 0',
            'scoreboard objectives add g3_c_table stat.craftItem.minecraft.crafting_table', 'scoreboard objectives add g3b_food food', 'scoreboard objectives remove g3_c_table',
            'scoreboard players list FRCFLD', 'time query daytime', 'gamerule doDaylightCycle', 'gamerule keepInventory', 'setblock -42 68 -50 minecraft:gold_block', 'setblock -20 70 -56 minecraft:gold_block'];
        for (const c of ok) g.console(c);
        assert.deepEqual(sent, ok);
    });
    test('give, summon, kill, op commands, any tp, a real clear, time or rule changes and other blocks are refused before sending', () => {
        sent.length = 0;
        const refused = ['give FRCFLD minecraft:stone_pickaxe 1 0', 'summon minecraft:zombie 0 64 0', 'kill @e[type=minecraft:zombie]', 'op FRCFLD',
            'gamemode creative FRCFLD', 'effect FRCFLD minecraft:regeneration 30', 'clear FRCFLD minecraft:stone_pickaxe -1 1', 'clear FRCFLD',
            'time set night', 'time set day', 'time add 1000', 'gamerule doDaylightCycle false', 'gamerule keepInventory true', 'setblock 0 64 0 minecraft:chest', 'setblock -20 70 -40 minecraft:gold_block', 'setblock -42 68 -51 minecraft:gold_block', 'difficulty peaceful', 'tp FRCFLD @p',
            'tp FRCFLD ~ ~ ~', 'tp FRCFLD -45 66 -66',   // no tp in G3 at all (lead, #201 review)
            'scoreboard objectives add g3_h health', 'scoreboard objectives add g3_f food x', 'scoreboard objectives add g3_d dummy',   // only the food criterion besides stat.*
            'say hello', 'xp 30 FRCFLD'];
        for (const c of refused) assert.throws(() => g.console(c), /console command refused in G3/, c);
        assert.deepEqual(sent, [], 'nothing reached the server');
        assert.throws(() => g.console('give FRCFLD x 1'), (e) => !e.message.includes('FRCFLD x'), 'the error names the verb only');
    });
});

describe('`Server` is a test-only task giver: never in the production settings', () => {
    test('a giver list with Server (any case) is a problem; without it, none', () => {
        assert.equal(TEST_TASK_GIVER, 'Server');
        assert.match(giverProblems({ task_givers: ['JQDAW', 'Server'] })[0], /settings\.task_givers contains 'Server'/);
        assert.match(giverProblems({ taskGivers: 'server' })[0], /settings\.taskGivers contains 'Server'/);
        assert.deepEqual(giverProblems({ task_givers: ['JQDAW'], only_chat_with: ['Server'] }), [], 'only giver keys count');
        assert.deepEqual(giverProblems(null), []);
    });
    test('allow_server_task_giver (#146) is test-only: anything but false (or absent) in the settings is a problem', () => {
        for (const v of [true, 'true', 1, null]) {
            assert.match(giverProblems({ allow_server_task_giver: v })[0], /settings\.allow_server_task_giver is not false: it is test-only/, String(v));
        }
        assert.deepEqual(giverProblems({ allow_server_task_giver: false, task_givers: ['JQDAW'] }), []);
        assert.deepEqual(giverProblems({ task_givers: ['JQDAW'] }), []);
    });
    test('the repo\'s settings.js has no Server giver', async () => {
        const s = (await import(new URL('../../settings.js', import.meta.url).href)).default;
        assert.deepEqual(giverProblems(s), []);
    });
});

describe('smoke is the default; only --gate makes gate evidence (lead, #218 review and #220 decision)', () => {
    const summary = { batchId: '20261105T1724-1', testMode: false, maxBatchUsd: 2, scenarios: [{ id: 'g3-a', runId: 'run-a', exit: 0 }], exit: 0 };
    const res = { file: 'a/result.json', result: { gate: 'G3', scenario: 'g3-a', batch: '20261105T1724-1:2', runId: 'run-a', pass: true, gateValid: true } };
    const A = ['--max-batch-usd', '2', '--logs-out', 'l', '--scenario', 'a', '--out', 'o', '--', 'node', 'd.mjs'];

    test('the defaults: no flag is a smoke batch, --gate a gate batch; --smoke is not an argument', () => {
        assert.deepEqual([parseBatchArgs(A).options.gate, parseBatchArgs(A).problems], [false, []]);
        assert.deepEqual([parseBatchArgs(['--gate', ...A]).options.gate, parseBatchArgs(['--gate', ...A]).problems], [true, []]);
        assert.match(parseBatchArgs(['--smoke', ...A]).problems.join('; '), /unknown argument '--smoke'/);
    });

    test('the summary: by default gate: false and smoke: true; only --gate writes gate: true', { timeout: 60000 }, async () => {
        const smoke = await runBatch({ scenarios: ['a'] });
        assert.deepEqual([smoke.summary.gate, smoke.summary.smoke], [false, true], smoke.out);
        assert.match(smoke.out, /batch \S+: a SMOKE batch \(the default: gate: false, smoke: true, never gate evidence\)/);
        const gate = await runBatch({ scenarios: ['a'], mode: '--gate' });
        assert.deepEqual([gate.summary.gate, gate.summary.smoke], [true, false], gate.out);
        assert.match(gate.out, /batch \S+: a GATE batch \(gate: true\)/);
    });

    test('the gate claim check accepts only gate: true (and not smoke: true)', () => {
        assert.deepEqual(crossCheckBatch({ ...summary, gate: true, smoke: false }, [res], { gate: true }), []);
        assert.deepEqual(crossCheckBatch({ ...summary, gate: true }, [res], { gate: true }), []);
        assert.match(crossCheckBatch({ ...summary, smoke: true }, [res], { gate: true }).join('; '), /is a smoke batch \(smoke: true\): never gate evidence/);
        assert.match(crossCheckBatch({ ...summary, gate: true, smoke: true }, [res], { gate: true }).join('; '), /smoke batch/);
        assert.match(crossCheckBatch(summary, [res], { gate: true }).join('; '), /does not say gate: true \(only batch\.mjs --gate writes it\): not gate evidence/);
        for (const v of ['true', 1, false, null]) assert.equal(crossCheckBatch({ ...summary, gate: v }, [res], { gate: true }).length, 1, `gate: ${JSON.stringify(v)}`);
        assert.deepEqual(crossCheckBatch({ ...summary, smoke: true }, [res]), [], 'consistency alone does not look at the mode');
        assert.deepEqual([batchKind({ gate: true }), batchKind({ smoke: true }), batchKind({ gate: true, smoke: true }), batchKind({}), batchKind({ gate: 'true' })],
            ['gate', 'smoke', 'both', 'neither', 'neither']);
    });

    test('the evidence check rejects G3 results under a batch.json without gate: true, unless it is a smoke record', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-smoke-'));
        const b = path.join(dir, 's1', 'batch.json');
        fs.mkdirSync(path.join(dir, 's1', 'a'), { recursive: true });
        fs.writeFileSync(path.join(dir, 's1', 'a', 'result.json'), JSON.stringify(res.result));
        const files = resultFilesUnder(path.join(dir, 's1'));
        const write = (extra) => fs.writeFileSync(b, JSON.stringify({ ...summary, ...extra }));
        write({});
        assert.match(checkEvidenceTree(dir).join('; '), /says neither gate: true nor smoke: true, so its 1 G3 result\(s\) are rejected/);
        write({ gate: true, smoke: true });
        assert.match(checkEvidenceTree(dir).join('; '), /says both gate: true and smoke: true/);
        write({ smoke: true });
        assert.deepEqual(checkEvidenceTree(dir), [], 'a smoke record stays');
        assert.deepEqual(smokeBatchesUnder(dir), ['s1/batch.json']);
        assert.match(checkFiles(b, files, { gate: true }).join('; '), /smoke batch/, 'but never as gate evidence');
        write({ gate: true, smoke: false });
        assert.deepEqual(checkEvidenceTree(dir), []);
        assert.deepEqual(checkFiles(b, files, { gate: true }), []);
        assert.deepEqual(smokeBatchesUnder(dir), []);
    });

    test('the committed 2026-11-05 G3 smoke batches are marked smoke: true and never pass the gate claim check', () => {
        const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'g3');
        for (const name of ['g3a-20261105', 'g3b-20261105', 'g3cd-20261105']) {
            const b = path.join(root, name, 'batch.json');
            assert.equal(batchKind(JSON.parse(fs.readFileSync(b, 'utf8'))), 'smoke', name);
            assert.match(checkFiles(b, resultFilesUnder(path.join(root, name)), { gate: true }).join('; '), /smoke batch/, name);
        }
    });
});

describe('batch.mjs derives each runner timeout from the scenario (lead, after #230)', () => {
    const DRIVER = path.join(HERE, '..', 'runner', 'drivers', 'mindcraft-driver.mjs');
    // A plain environment, as outside the offline tests: no test-mode override and no test-server run.
    const realEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ROTN_TEST_MODE|ROTN_OPENROUTER_USAGE_FILE|ROTN_BATCH_RUNNER|TEST_SERVER_.*|ROTN_BATCH_PREFLIGHT)$/.test(k)));
    const G3 = ['g3-rocks-to-stone-tools', 'g3-first-night', 'g3-task-preempts-agenda', 'g3-untrusted-refused'];
    const sc = (id, timeoutMin = null) => ({ id, out: 'o', timeoutMin });

    test('every G3 scenario has runMinutes; the derived timeouts cover their own limits plus the margin', async () => {
        const reg = await loadScenarios();
        for (const id of G3) assert.equal(typeof reg[id]?.runMinutes, 'function', id);
        const { timeouts, problems } = scenarioTimeouts(G3.map((id) => sc(id)), reg, { maxBatchUsd: 2 });
        assert.deepEqual(problems, []);
        assert.equal(TIMEOUT_MARGIN_MIN, 8);
        assert.deepEqual(timeouts.map((t) => [t.id, t.timeoutMin]), [['g3-rocks-to-stone-tools', 37], ['g3-first-night', 67], ['g3-task-preempts-agenda', 34], ['g3-untrusted-refused', 16]]);
        // (c) used to need --timeout-min 33 by hand; derived it is above that, and above each scenario's own limits.
        const c = reg['g3-task-preempts-agenda'].defaults;
        const cOwn = 4 + c.warmMinutes + c.activeWaitMinutes + c.acceptS / 60 + c.taskMinutes + c.resumeMinutes + c.cancelS / 60;
        assert.ok(timeouts[2].timeoutMin >= 33 && timeouts[2].timeoutMin > cOwn);
        for (const id of ['g3-rocks-to-stone-tools', 'g3-first-night']) {
            const t = timeouts.find((x) => x.id === id);
            assert.ok(t.timeoutMin > reg[id].defaults.maxMinutes + reg[id].defaults.loginTimeoutMs / 60000, `${id}: beyond maxMinutes and the login wait`);
        }
    });

    test('a longer scenario gets a longer timeout (it follows the parameters, e.g. maxMinutes)', () => {
        const reg = { x: { defaults: { maxMinutes: 25, loginTimeoutMs: 240000 }, runMinutes: (p) => p.loginTimeoutMs / 60000 + p.maxMinutes } };
        assert.equal(scenarioTimeouts([sc('x')], reg).timeouts[0].timeoutMin, 37);
        reg.x.defaults.maxMinutes = 55;
        assert.equal(scenarioTimeouts([sc('x')], reg).timeouts[0].timeoutMin, 67);
    });

    test('--timeout-min may only raise it; below the derived value it is refused', async () => {
        const reg = await loadScenarios();
        assert.equal(scenarioTimeouts([sc('g3-task-preempts-agenda', 40)], reg).timeouts[0].timeoutMin, 40);
        const low = scenarioTimeouts([sc('g3-task-preempts-agenda', 28)], reg);
        assert.deepEqual(low.timeouts, []);
        assert.match(low.problems[0], /^scenario g3-task-preempts-agenda: --timeout-min 28 is below its derived 34 \(runMinutes 25\.5 \+ margin 8\); it would be stopped before its own limits$/);
    });

    test('an unknown scenario, or one without runMinutes, is refused outside the offline test mode', () => {
        const reg = { y: { defaults: {} } };
        assert.match(scenarioTimeouts([sc('nope')], reg).problems[0], /^scenario nope: unknown, so its runner timeout cannot be derived$/);
        assert.match(scenarioTimeouts([sc('y')], reg).problems[0], /^scenario y: no runMinutes/);
        assert.match(scenarioTimeouts([sc('z')], { z: { defaults: {}, runMinutes: () => NaN } }).problems[0], /runMinutes is NaN/);
        const test = scenarioTimeouts([sc('nope'), sc('y', 3)], reg, { testMode: true });
        assert.deepEqual([test.problems, test.timeouts.map((t) => t.timeoutMin)], [[], [TEST_DEFAULT_TIMEOUT_MIN, 3]]);
    });

    test('the preflight shows the derived timeouts and refuses a low --timeout-min before anything runs', { timeout: 60000 }, () => {
        const ok = spawnSync(process.execPath, [BATCH, '--preflight-files', '--max-batch-usd', '2', '--logs-out', 'l', '--scenario', 'g3-task-preempts-agenda', '--out', 'o',
            '--scenario', 'g3-untrusted-refused', '--out', 'o2', '--', 'node', DRIVER, '--profile', 'profiles/rotn-bot.json'], { encoding: 'utf8', env: realEnv() });
        assert.equal(ok.status, 0, ok.stderr);
        assert.match(ok.stderr, /\(timeouts: g3-task-preempts-agenda 34 min, g3-untrusted-refused 16 min\)/);
        const low = spawnSync(process.execPath, [BATCH, '--preflight-files', '--max-batch-usd', '2', '--logs-out', 'l', '--timeout-min', '28', '--scenario', 'g3-task-preempts-agenda', '--out', 'o',
            '--', 'node', DRIVER, '--profile', 'profiles/rotn-bot.json'], { encoding: 'utf8', env: realEnv() });
        assert.equal(low.status, 2);
        assert.match(low.stderr, /refused: scenario g3-task-preempts-agenda: --timeout-min 28 is below its derived 34/);
    });

    test('the batch summary records each scenario\'s timeout', { timeout: 60000 }, async () => {
        const r = await runBatch({ scenarios: ['a'], timeoutMin: '3' });
        assert.equal(r.summary.scenarios[0].timeoutMin, 3, r.out);
        assert.match(r.out, /a: start \(spent so far USD [\d.]+ of 2; runner timeout 3 min\)/);
    });
});

describe('batch.mjs: the --timeout-min cap, its carry-over, and the TTL check (lead, after #231)', () => {
    const DRIVER = path.join(HERE, '..', 'runner', 'drivers', 'mindcraft-driver.mjs');
    const realEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ROTN_TEST_MODE|ROTN_OPENROUTER_USAGE_FILE|ROTN_BATCH_RUNNER|TEST_SERVER_.*|ROTN_BATCH_PREFLIGHT|ROTN_BATCH_TTL_MINUTES)$/.test(k)));
    const sc = (id, timeoutMin = null) => ({ id, out: 'o', timeoutMin });

    test('an explicit --timeout-min is capped at 3x the derived value', async () => {
        const reg = await loadScenarios();
        assert.equal(TIMEOUT_CAP_FACTOR, 3);
        assert.equal(scenarioTimeouts([sc('g3-task-preempts-agenda', 102)], reg).timeouts[0].timeoutMin, 102, '3 x 34: allowed');
        const over = scenarioTimeouts([sc('g3-task-preempts-agenda', 103)], reg);
        assert.deepEqual(over.timeouts, []);
        assert.equal(over.problems[0], 'scenario g3-task-preempts-agenda: --timeout-min 103 is more than 3x its derived 34 (cap 102); a --timeout-min carries over to later scenarios');
    });

    test('a --timeout-min carries over to every later scenario, so it must suit each of them', async () => {
        const a = ['--max-batch-usd', '2', '--logs-out', 'l', '--timeout-min', '40', '--scenario', 'g3-task-preempts-agenda', '--out', 'c',
            '--scenario', 'g3-untrusted-refused', '--out', 'd', '--', 'node', 'd.mjs'];
        const parsed = parseBatchArgs(a).options.scenarios;
        assert.deepEqual(parsed.map((x) => x.timeoutMin), [40, 40], 'one value before (c) also applies to (d)');
        const reg = await loadScenarios();
        assert.deepEqual(scenarioTimeouts(parsed, reg).problems, [], '40: at least 34 for (c), at most 3 x 16 = 48 for (d)');
        const fifty = parseBatchArgs(a.map((x) => (x === '40' ? '50' : x))).options.scenarios;
        assert.match(scenarioTimeouts(fifty, reg).problems.join('; '), /^scenario g3-untrusted-refused: --timeout-min 50 is more than 3x its derived 16 \(cap 48\)/);
        const reset = parseBatchArgs(['--max-batch-usd', '2', '--logs-out', 'l', '--timeout-min', '40', '--scenario', 'x', '--out', 'x', '--timeout-min', '20', '--scenario', 'y', '--out', 'y', '--', 'n']).options.scenarios;
        assert.deepEqual(reset.map((x) => x.timeoutMin), [40, 20], 'until the next --timeout-min');
    });

    test('ttlProblems: the TTL covers the timeouts plus the build and the end; the time left covers the timeouts plus the end', () => {
        const t = [{ timeoutMin: 34 }, { timeoutMin: 16 }];
        assert.deepEqual([BUILD_ALLOWANCE_MIN, END_ALLOWANCE_MIN], [20, 5]);
        assert.equal(ttlProblems(t).needMin, 55);
        assert.deepEqual(ttlProblems(t, { ttlMinutes: 75 }).problems, [], '50 + 5 + 20 = 75 fits exactly');
        assert.equal(ttlProblems(t, { ttlMinutes: 74 }).problems[0], '--ttl-hours 1.23 (74 min) cannot cover this batch: its runner timeouts sum to 50 min, plus 5 for the logs and teardown and 20 for the build, 75 min');
        assert.deepEqual(ttlProblems(t, { remainingMinutes: 55 }).problems, []);
        assert.equal(ttlProblems(t, { remainingMinutes: 54.6 }).problems[0], 'only 54 min are left before the server\'s delete-after, and this batch needs 55 (its runner timeouts sum to 50 min, plus 5 for the logs and teardown)');
        // Round 2's layout with its TTLs fits: A 37 of 2 h, B 67 of 3 h, C+D 34 + 16 of 2 h.
        for (const [mins, ttl] of [[[37], 120], [[67], 180], [[34, 16], 120]]) assert.deepEqual(ttlProblems(mins.map((m) => ({ timeoutMin: m })), { ttlMinutes: ttl }).problems, [], `${mins} in ${ttl}`);
    });

    test('the preflight refuses a TTL that cannot cover the batch, before anything exists', { timeout: 60000 }, () => {
        const args = (extra = []) => [BATCH, '--preflight-files', '--max-batch-usd', '2', '--logs-out', 'l', ...extra, '--scenario', 'g3-task-preempts-agenda', '--out', 'o',
            '--scenario', 'g3-untrusted-refused', '--out', 'o2', '--', 'node', DRIVER, '--profile', 'profiles/rotn-bot.json'];
        const short = spawnSync(process.execPath, args(), { encoding: 'utf8', env: { ...realEnv(), ROTN_BATCH_TTL_MINUTES: '60' } });
        assert.equal(short.status, 2, short.stderr);
        assert.match(short.stderr, /refused: --ttl-hours 1 \(60 min\) cannot cover this batch: its runner timeouts sum to 50 min, plus 5 for the logs and teardown and 20 for the build, 75 min/);
        const ok = spawnSync(process.execPath, args(), { encoding: 'utf8', env: { ...realEnv(), ROTN_BATCH_TTL_MINUTES: '120' } });
        assert.equal(ok.status, 0, ok.stderr);
    });

    test('at the start, too little time before the server\'s delete-after refuses the batch before any scenario', { timeout: 60000 }, async () => {
        // 10 min left (test-server.sh's own count); one fake scenario needs 15 + 5.
        const r = await runBatch({ scenarios: ['a'], extraEnv: { TEST_SERVER_SECONDS_LEFT: String(10 * 60) } });
        assert.equal(r.code, 2, r.out);
        assert.match(r.out, /refused: only 10 min are left before the server's delete-after, and this batch needs 20/);
        assert.deepEqual(r.ran, [], 'no scenario started');
        assert.equal((await runBatch({ scenarios: ['a'], extraEnv: { TEST_SERVER_SECONDS_LEFT: '-60' } })).code, 2, 'already past it');
        assert.equal((await runBatch({ scenarios: ['a'], extraEnv: { TEST_SERVER_SECONDS_LEFT: String(60 * 60) } })).code, 0);
    });

    test('a real test-server run without the server\'s delete-after is refused (fails closed), before anything is read', { timeout: 60000 }, () => {
        const r = spawnSync(process.execPath, [BATCH, '--max-batch-usd', '2', '--logs-out', 'l', '--scenario', 'g3-untrusted-refused', '--out', 'o',
            '--', 'node', DRIVER, '--profile', 'profiles/rotn-bot.json'], { encoding: 'utf8', env: { ...realEnv(), TEST_SERVER_CTL: 'ctl.sh' } });
        assert.equal(r.status, 2, r.stderr);
        assert.match(r.stderr, /refused: inside a test-server run without the time left before the server's delete-after \(TEST_SERVER_SECONDS_LEFT\)/);
    });
});

describe('batch.mjs warns (never refuses) when a batch may run past 00:00 UTC (lead, after round 3 batch B)', () => {
    const t = (...m) => m.map((timeoutMin) => ({ timeoutMin }));
    const at = (iso) => Date.parse(iso);

    test('the window: build (preflight only) + the runner timeouts + the end allowance', () => {
        // Round 3 batch B: started 23:28, 67-min timeout. Preflight: 20 + 67 + 5 = 92 min -> 01:00 the next day.
        assert.equal(midnightWarning(t(67), at('2026-11-05T23:28:00Z'), { buildMin: 20 }),
            'this batch may run past 00:00 UTC (up to 01:00 UTC on 2026-11-06), when the server log rolls over; the session then also reads the rolled-over log (notes.logWindow)');
        assert.equal(midnightWarning(t(37), at('2026-11-05T20:15:00Z'), { buildMin: 20 }), null, 'round 2 batch A: ends 21:17');
        // At the batch start the build is over: 34 + 16 + 5 = 55 min from 23:04 ends 23:59, the same day.
        assert.equal(midnightWarning(t(34, 16), at('2026-11-05T23:04:00Z')), null);
        assert.match(midnightWarning(t(34, 16), at('2026-11-05T23:06:00Z')), /up to 00:01 UTC on 2026-11-06/);
    });

    test('the preflight prints it as a warning and still passes', { timeout: 60000 }, () => {
        // The real clock decides: the warning appears exactly when (b)'s window (20 + 67 + 5 min) crosses the next 00:00 UTC.
        const DRIVER = path.join(HERE, '..', 'runner', 'drivers', 'mindcraft-driver.mjs');
        const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ROTN_TEST_MODE|ROTN_OPENROUTER_USAGE_FILE|ROTN_BATCH_RUNNER|TEST_SERVER_.*|ROTN_BATCH_PREFLIGHT|ROTN_BATCH_TTL_MINUTES)$/.test(k)));
        const r = spawnSync(process.execPath, [BATCH, '--preflight-files', '--max-batch-usd', '2', '--logs-out', 'l', '--scenario', 'g3-first-night', '--out', 'o',
            '--', 'node', DRIVER, '--profile', 'profiles/rotn-bot.json'], { encoding: 'utf8', env });
        assert.equal(r.status, 0, r.stderr);
        const crosses = midnightWarning(t(67), Date.now(), { buildMin: 20 }) !== null;
        assert.equal(/warning: this batch may run past 00:00 UTC/.test(r.stderr), crosses, r.stderr);
    });
});

describe('LLM replies are counted as successful or failed, and the preflight probes the model (lead, after round 3)', () => {
    const DRIVER = path.join(HERE, '..', 'runner', 'drivers', 'mindcraft-driver.mjs');
    const fakeRes = (status, body) => () => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
    const RATE_LIMITED = { error: { message: 'Provider returned error', code: 429, metadata: { provider_name: 'Baidu', provider_error_code: 'tpm_rate_limit_exceeded', raw: 'z-ai/glm-5.1 is temporarily rate-limited upstream' } } };

    // The reply counts without the provider fields (those have their own test).
    const counts = (lines) => { const { providers: _p, summariesUnattributed: _u, ...r } = countLlmReplies(lines); return r; };

    test('countLlmReplies: round 3 batch B\'s pattern counts as failures, not calls', () => {
        const lines = [LLM_CALL_LINE, 'Error while awaiting response: Error [429] (status 429): 429 Provider returned error',
            'Generated response: My brain disconnected, try again.', LLM_CALL_LINE, 'Generated response: On it! !collectBlocks("pyrotech:rock", 6)',
            'Error while awaiting response: Error [429] (status 429): 429 Provider returned error', 'Error [500] (status 500): x', 'NoError [429]'];
        assert.deepEqual(counts(lines), { ok: 1, memory: 0, failed: 1, disconnected: 1, empty: 0, memoryEmpty: 0, httpErrors: { 429: 2, 500: 1 } });
        assert.equal(countLlmCalls(lines), 2, 'calls stays the number of requests sent');
        const rec = llmRecord({ ok: true, usage: 1 }, { ok: true, usage: 1 }, lines);
        assert.deepEqual([rec.calls, rec.replies, rec.httpErrors], [2, { ok: 1, memory: 0, failed: 1, disconnected: 1, empty: 0, memoryEmpty: 0 }, { 429: 2, 500: 1 }]);
        assert.deepEqual(counts([]), { ok: 0, memory: 0, failed: 0, disconnected: 0, empty: 0, memoryEmpty: 0, httpErrors: {} });
    });

    test('countLlmReplies: memory summaries count apart; an empty answer and a failed summary are failures (round 3 continuation A and round 3 B)', () => {
        // Round 3 continuation A: 62 requests = 46 agent replies + 13 memory summaries + 3 empty answers.
        const a = [
            ...Array(46).fill('Generated response: On it! !collectBlocks("pyrotech:rock", 6)'),
            ...Array(13).fill('Memory updated to:  RotN agenda: done rocks, sticks.'),
            ...Array(3).fill(null).flatMap(() => ['Error: Generated response is not a string null', 'Error during message generation or file writing: Error: Generated response is not a string']),
        ];
        assert.deepEqual(counts(a), { ok: 46, memory: 13, failed: 3, disconnected: 0, empty: 3, memoryEmpty: 0, httpErrors: {} });
        // Round 3 B: 11 requests, all failed; one was a memory summary that stored the stand-in.
        const b = [...Array(10).fill('Generated response: My brain disconnected, try again.'), 'FRCFLD full response to system: ""My brain disconnected, try again.""',
            'Memory updated to:  My brain disconnected, try again.', ...Array(11).fill('Error while awaiting response: Error [429] (status 429): 429 Provider returned error')];
        assert.deepEqual(counts(b), { ok: 0, memory: 0, failed: 11, disconnected: 11, empty: 0, memoryEmpty: 0, httpErrors: { 429: 11 } });
        // #246 review 2: Mindcraft's other stand-in (a completion with no choices) is a failed reply, not an answer.
        assert.deepEqual(counts(['Generated response: No response received.', 'Generated response: ok']),
            { ok: 1, memory: 0, failed: 1, disconnected: 1, empty: 0, memoryEmpty: 0, httpErrors: {} });
    });

    test('countLlmReplies: an empty memory summary is a failed reply (lead, round 5 A: five null summaries crashed the agent, none counted)', () => {
        // Round 5 A's pattern: the summary starts, its request gets null content, history.js throws, the agent exits.
        const crash = ['Storing memories...', 'parsed command: { commandName: \'!collectBlocks\', args: [ \'stick\', 4 ] }', LLM_CALL_LINE, 'Received.',
            'Agent FRCFLD disconnected', 'Agent process exited with code 1 and signal null', '[agent_process] FRCFLD: transient; restarting in 10 s.',
            'TypeError: Cannot read properties of null (reading \'length\')'];
        const r5a = [...Array(11).fill('Generated response: !inventory'), ...Array(5).fill(crash).flat()];
        assert.deepEqual(counts(r5a), { ok: 11, memory: 0, failed: 5, disconnected: 0, empty: 5, memoryEmpty: 5, httpErrors: {} });
        // A summary cut short by the next one, and an empty or "null" stored memory, are empty too.
        assert.deepEqual(counts(['Storing memories...', 'Storing memories...', 'Memory updated to:  ', 'Storing memories...', 'Memory updated to:  null']),
            { ok: 0, memory: 0, failed: 3, disconnected: 0, empty: 3, memoryEmpty: 3, httpErrors: {} });
        // Mindcraft's no-choices stand-in stored as the memory is a disconnected reply, not a memory.
        assert.deepEqual(counts(['Storing memories...', 'Memory updated to:  No response received.']),
            { ok: 0, memory: 0, failed: 1, disconnected: 1, empty: 0, memoryEmpty: 0, httpErrors: {} });
        // Not empty: a summary that stored a memory, a clean exit after it, and one still waiting when the log ends.
        assert.deepEqual(counts(['Storing memories...', 'Memory updated to:  RotN agenda: done rocks.', 'Agent process exited with code 0 and signal null', 'Storing memories...']),
            { ok: 0, memory: 1, failed: 0, disconnected: 0, empty: 0, memoryEmpty: 0, httpErrors: {} });
        // The early-stop rule still needs no answer at all: empty summaries next to agent replies do not fire it.
        assert.equal(llmStopVerdict(r5a).stop, false);
        assert.equal(llmStopVerdict(Array(5).fill(crash).flat()).stop, true, 'five empty summaries and nothing answered: the rule fires');
    });

    test('countLlmReplies: history.js\'s own summary lines (round 5 A rerun and B), and an exit only counts when non-zero (#267 review)', () => {
        const kept = '[memory] summary returned failure reply "No response received."; keeping the previous memory';
        // B: 11 summaries, each answered "No response received." (empty content since #266): 11 empty, not 10.
        assert.deepEqual(counts(Array(11).fill(['Storing memories...', 'Saved memory to: ./bots/FRCFLD/memory.json', LLM_CALL_LINE, kept]).flat()),
            { ok: 0, memory: 0, failed: 11, disconnected: 0, empty: 11, memoryEmpty: 11, httpErrors: {} });
        assert.deepEqual(counts(['Storing memories...', '[memory] summary returned an empty reply; keeping the previous memory', 'Storing memories...',
            '[memory] summary returned a null reply; keeping the previous memory', 'Storing memories...',
            '[memory] summary returned failure reply "My brain disconnected, try again."; keeping the previous memory', 'Storing memories...',
            '[memory] summary failed (boom); keeping the previous memory']),
        { ok: 0, memory: 0, failed: 4, disconnected: 2, empty: 2, memoryEmpty: 2, httpErrors: {} });
        // An open summary at an exit with code 0 or a signal (the bot was stopped) is still waiting, not empty.
        for (const exit of ['Agent process exited with code 0 and signal null', 'Agent process exited with code null and signal SIGTERM']) {
            assert.equal(counts(['Storing memories...', exit]).memoryEmpty, 0, exit);
        }
        assert.equal(counts(['Storing memories...', 'Agent process exited with code 1 and signal null']).memoryEmpty, 1);
    });

    test('countLlmReplies: providers from openrouter.js\'s line (#271), and summaries attributed only when unambiguous (lead, after round 5 B)', () => {
        const pl = (name, chars, reason = 'stop') => `[openrouter] provider ${name}, finish_reason ${reason}, content ${chars} chars`;
        const kept = '[memory] summary returned failure reply "No response received."; keeping the previous memory';
        const lines = [
            // A summary alone in flight: its completion is the only one while it is open, so it is OpenInference's.
            'Storing memories...', LLM_CALL_LINE, pl('OpenInference', 'null'), 'Empty content returned (model x, finish_reason stop)', kept,
            LLM_CALL_LINE, pl('Wafer', 42), 'Generated response: !inventory',
            // A summary that stored, alone in flight: Wafer's.
            'Storing memories...', LLM_CALL_LINE, pl('Wafer', 80), 'Memory updated to:  RotN agenda: done rocks.',
            // Two completions while open (an agent reply came back too): not attributed.
            'Storing memories...', LLM_CALL_LINE, LLM_CALL_LINE, pl('Wafer', 12), 'Generated response: ok', pl('OpenInference', 0), kept,
            // One completion while open, but a request failed then: the completion may not be the summary's, so not attributed.
            'Storing memories...', LLM_CALL_LINE, LLM_CALL_LINE, 'Error while awaiting response: Error [500] (status 500): x', pl('Wafer', 50),
            'Memory updated to:  RotN agenda: done sticks.',
            // An odd provider name, sanitised by openrouter.js.
            LLM_CALL_LINE, pl('Some? Host-1.ai', 5, 'length'),
        ];
        const r = countLlmReplies(lines);
        assert.deepEqual(r.providers, {
            OpenInference: { requests: 2, empty: 2, summaries: { ok: 0, empty: 1, failed: 0 } },
            Wafer: { requests: 4, empty: 0, summaries: { ok: 1, empty: 0, failed: 0 } },
            'Some? Host-1.ai': { requests: 1, empty: 0, summaries: { ok: 0, empty: 0, failed: 0 } },
        });
        assert.deepEqual(r.summariesUnattributed, { ok: 1, empty: 1, failed: 0 });
        assert.deepEqual([r.memory, r.memoryEmpty], [2, 2]);
        assert.equal(providerSummary(r.providers, r.summariesUnattributed),
            'OpenInference: 2 requests (2 empty), summaries 0 ok, 1 empty; Wafer: 4 requests (0 empty), summaries 1 ok, 0 empty; '
            + 'Some? Host-1.ai: 1 requests (0 empty), summaries 0 ok, 0 empty; summaries not attributed: 1 ok, 1 empty');
        // Logs from before #271 have no provider line: every summary is unattributed, and the summary says so.
        const old = countLlmReplies(['Storing memories...', 'Memory updated to:  x']);
        assert.deepEqual([old.providers, old.summariesUnattributed], [{}, { ok: 1, empty: 0, failed: 0 }]);
        assert.equal(providerSummary({}, { ok: 0, empty: 0, failed: 0 }), 'no provider lines');
        // Not a provider line: a different prefix, a missing field, or a name longer than openrouter.js lets through.
        for (const bad of [`x ${pl('Wafer', 1)}`, '[openrouter] provider Wafer, content 1 chars', pl('W'.repeat(41), 1), pl('Wafer', 'many')]) {
            assert.deepEqual(countLlmReplies([bad]).providers, {}, bad);
        }
        // result.llm carries them next to the replies.
        const rec = llmRecord({ ok: true, usage: 1 }, { ok: true, usage: 1 }, lines);
        assert.deepEqual([rec.providers, rec.summariesUnattributed], [r.providers, r.summariesUnattributed]);
    });

    test('#273 review nits: an empty provider name counts; a failed summary is never charged to another request\'s provider', () => {
        const pl = (name, chars) => `[openrouter] provider ${name}, finish_reason stop, content ${chars} chars`;
        // 3: an empty name (a completion without a provider) is a request of its own, never dropped.
        const e = countLlmReplies([LLM_CALL_LINE, pl('', 'null'), LLM_CALL_LINE, pl('Wafer', 5)]);
        assert.deepEqual(e.providers, {
            [EMPTY_PROVIDER]: { requests: 1, empty: 1, summaries: { ok: 0, empty: 0, failed: 0 } },
            Wafer: { requests: 1, empty: 0, summaries: { ok: 0, empty: 0, failed: 0 } },
        });
        // 2: the summary's request threw (no completion); the one completion while it was open was an agent reply's.
        for (const end of ['[memory] summary failed (Error: socket hang up); keeping the previous memory',
            '[memory] summary returned failure reply "My brain disconnected, try again."; keeping the previous memory']) {
            const f = countLlmReplies(['Storing memories...', LLM_CALL_LINE, LLM_CALL_LINE, pl('Wafer', 30), 'Generated response: ok', end]);
            assert.deepEqual(f.providers.Wafer.summaries, { ok: 0, empty: 0, failed: 0 }, end);
            assert.deepEqual(f.summariesUnattributed, { ok: 0, empty: 0, failed: 1 }, end);
        }
        // An empty summary with exactly one completion while open is still that completion's (it came back empty).
        const ok = countLlmReplies(['Storing memories...', LLM_CALL_LINE, pl('OpenInference', 'null'),
            '[memory] summary returned failure reply "No response received."; keeping the previous memory']);
        assert.deepEqual(ok.providers.OpenInference.summaries, { ok: 0, empty: 1, failed: 0 });
    });

    test('probeModel: 200 names the provider; 429 gives the provider\'s error code; no key, network and timeout are reasons; the key never comes back', async () => {
        const seen = [];
        const ok = await probeModel({ key: 'sk-test-secret', model: '@preset/x', fetchImpl: (url, init) => { seen.push({ url, init }); return fakeRes(200, { provider: 'OpenInference', model: 'z-ai/glm-5.3-flash', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })(); } });
        assert.deepEqual(ok, { ok: true, status: 200, provider: 'OpenInference', model: 'z-ai/glm-5.3-flash', error: null });
        assert.equal(seen[0].url, 'https://openrouter.ai/api/v1/chat/completions');
        assert.equal(seen[0].init.headers.Authorization, 'Bearer sk-test-secret');
        assert.deepEqual(JSON.parse(seen[0].init.body).max_tokens, 16);
        assert.equal(JSON.parse(seen[0].init.body).model, '@preset/x');
        const bad = await probeModel({ key: 'sk-test-secret', model: '@preset/x', fetchImpl: fakeRes(429, RATE_LIMITED) });
        assert.deepEqual(bad, { ok: false, status: 429, provider: 'Baidu', model: null, error: 'tpm_rate_limit_exceeded' });
        assert.ok(!JSON.stringify(bad).includes('sk-test-secret'));
        assert.equal((await probeModel({ key: '', model: 'm', fetchImpl: fakeRes(200, {}) })).error, 'no key');
        // #246 review 1: a 200 is not enough. An error in the body, or no choices, fails; empty content passes.
        const e200 = await probeModel({ key: 'k', model: 'm', fetchImpl: fakeRes(200, { error: { code: 502, message: 'Provider returned error', metadata: { provider_name: 'X' } } }) });
        assert.deepEqual(e200, { ok: false, status: 200, provider: 'X', model: null, error: '502' });
        assert.deepEqual(await probeModel({ key: 'k', model: 'm', fetchImpl: fakeRes(200, { error: { message: 'm' } }) }), { ok: false, status: 200, provider: null, model: null, error: 'error in a 200 response' });
        for (const body of [{ provider: 'P' }, { provider: 'P', choices: [] }, null]) {
            const r = await probeModel({ key: 'k', model: 'm', fetchImpl: fakeRes(200, body) });
            assert.equal(r.ok, false, JSON.stringify(body));
            assert.equal(r.error, 'no choices in the response');
        }
        const emptyText = await probeModel({ key: 'k', model: 'm', fetchImpl: fakeRes(200, { provider: 'OpenInference', choices: [{ message: { content: null }, finish_reason: 'length' }] }) });
        assert.equal(emptyText.ok, true, 'the 02:42Z probe: 16 tokens spent before any text still passes');
        // #246 review 4: provider and model are capped like the error.
        const long = await probeModel({ key: 'k', model: 'm', fetchImpl: fakeRes(200, { provider: 'p'.repeat(500), model: 'm'.repeat(500), choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }) });
        assert.deepEqual([long.provider.length, long.model.length], [80, 80]);
        assert.equal((await probeModel({ key: 'k', model: 'm', fetchImpl: () => Promise.reject(new Error('down')) })).error, 'network');
        assert.equal((await probeModel({ key: 'k', model: 'm', fetchImpl: fakeRes(503, null) })).error, 'bad response');
    });

    test('probeFetch: the real fetch outside test mode; in test mode a probe file, or no probe at all (never the network)', () => {
        const real = () => 'real';
        assert.equal(probeFetch({}, real), real);
        assert.equal(probeFetch({ ROTN_TEST_MODE: '1' }, real), null);
        assert.equal(probeFetch({ ROTN_TEST_MODE: '1', TEST_SERVER_CTL: 'ctl', TEST_SERVER_FAKE_CLOUD: '0', ROTN_OPENROUTER_PROBE_FILE: 'f' }, real), real, 'never inside a real test-server run');
        assert.ok(TEST_OVERRIDES.includes('ROTN_OPENROUTER_PROBE_FILE'));
    });

    test('the preflight: a probe that answers passes and names the provider; a 429 refuses before anything runs', { timeout: 60000 }, async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-probe-'));
        const good = path.join(dir, 'good.json');
        fs.writeFileSync(good, JSON.stringify({ name: 'FRCFLD', model: LLM_MODEL }));
        const probeFile = path.join(dir, 'probe.json');
        fs.writeFileSync(probeFile, JSON.stringify({ status: 200, body: { provider: 'OpenInference', model: 'z-ai/glm-5.3-flash', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } }));
        const ok = await runBatch({ preflight: true, mark: '', driver: ['node', DRIVER, '--profile', good], extraEnv: { ROTN_OPENROUTER_PROBE_FILE: probeFile } });
        assert.equal(ok.code, 0, ok.out);
        assert.match(ok.out, /the LLM probe answered \(HTTP 200, provider OpenInference, z-ai\/glm-5\.3-flash\)/);
        fs.writeFileSync(probeFile, JSON.stringify({ status: 429, body: RATE_LIMITED }));
        const bad = await runBatch({ preflight: true, mark: '', driver: ['node', DRIVER, '--profile', good], extraEnv: { ROTN_OPENROUTER_PROBE_FILE: probeFile } });
        assert.equal(bad.code, 2, bad.out);
        assert.match(bad.out, /preflight refused: the LLM probe of openrouter\/@preset\/glm-5-3-flash-cheap-reliable failed \(HTTP 429, provider Baidu, tpm_rate_limit_exceeded\)/);
        assert.deepEqual([bad.ran, bad.ctl, bad.summary], [[], '', null]);
        assert.ok(!bad.out.includes(KEY), 'the key is never printed');
    });
});

describe('the LLM-failure stop rule (lead, round 3 continuation; #248 review): 5+ failed replies and none answered in the first 5 min after the bot spawned', () => {
    const fail = ['Error while awaiting response: Error [429] (status 429): 429 Provider returned error', 'Generated response: My brain disconnected, try again.'];
    const stopEnv = (extra = {}) => ({ ROTN_LLM_STOP_WINDOW_MS: '20000', ROTN_LLM_STOP_POLL_MS: '100', ...extra });

    test('llmStopVerdict: 5 failures and nothing answered stops; one reply or one memory summary does not; 4 do not', () => {
        const n = (k) => Array.from({ length: k }, () => fail).flat();
        assert.deepEqual(llmStopVerdict(n(5)), { stop: true, ok: 0, memory: 0, failed: 5, httpErrors: { 429: 5 } });
        assert.equal(llmStopVerdict(n(4)).stop, false);
        assert.equal(llmStopVerdict([...n(6), 'Generated response: On it!']).stop, false, 'the model answered once');
        assert.equal(llmStopVerdict([...n(6), 'Memory updated to:  RotN agenda: step 1']).stop, false, 'a memory summary is an answer');
        assert.equal(llmStopVerdict(Array(5).fill('Generated response: No response received.')).stop, true, 'the other stand-in counts');
        assert.equal(llmStopVerdict(Array(5).fill('Error: Generated response is not a string null')).stop, true, 'empty answers count');
    });

    test('round 3 B, from its committed server log: the 5th failure came 53 s after the join, with no answer before it', () => {
        // The bot said each stand-in in chat, so the server log times them (driver.log has no per-line times).
        const log = fs.readFileSync(path.join(HERE, '..', 'evidence', 'g3', 'g3b-20261106-r3', 'night', 'server-across-rollover.log'), 'utf8').split('\n');
        const at = (l) => { const m = /^\[(\d\d):(\d\d):(\d\d)\]/.exec(l); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null; };
        const joined = at(log.find((l) => l.includes('joined the game')));
        const chat = log.filter((l) => /<<bot>> /.test(l));
        const failures = chat.filter((l) => l.includes('My brain disconnected, try again.')).map(at);
        assert.ok(failures.length >= 5);
        assert.equal(failures[4] - joined, 53, '23:31:28 -> 23:32:21');
        // Before it, the bot's only other chat is not an LLM answer: the agenda's own line and Mindcraft's notice.
        const other = chat.filter((l) => at(l) <= failures[4] && !l.includes('My brain disconnected'));
        assert.ok(other.every((l) => /<<bot>> (agenda step \S+ started: |Agent did not use command in the last 3 auto-prompts)/.test(l)), JSON.stringify(other));
        assert.ok(failures[4] - joined < 300, 'well inside 5 min of the spawn');
    });

    test('llmStopSettings: 5 min from the spawn, a 10 min cap from the start, 15 s polls, 5 failures; shorter only in test mode', () => {
        assert.deepEqual(llmStopSettings({}), { windowMs: 300000, capMs: 600000, pollMs: 15000, minFailed: 5 });
        assert.deepEqual(llmStopSettings({ ROTN_LLM_STOP_WINDOW_MS: '1', ROTN_LLM_STOP_CAP_MS: '1', ROTN_LLM_STOP_POLL_MS: '1' }), { windowMs: 300000, capMs: 600000, pollMs: 15000, minFailed: 5 }, 'ignored outside test mode');
        assert.deepEqual(llmStopSettings({ ROTN_TEST_MODE: '1', ROTN_LLM_STOP_WINDOW_MS: '800', ROTN_LLM_STOP_CAP_MS: '900', ROTN_LLM_STOP_POLL_MS: '50' }), { windowMs: 800, capMs: 900, pollMs: 50, minFailed: 5 });
        for (const k of ['ROTN_LLM_STOP_WINDOW_MS', 'ROTN_LLM_STOP_CAP_MS', 'ROTN_LLM_STOP_POLL_MS']) assert.ok(TEST_OVERRIDES.includes(k), `${k} is refused in a real batch`);
        assert.ok(SPAWNED_LINE.test('FRCFLD spawned.') && !SPAWNED_LINE.test('Generated response: FRCFLD spawned.'));
    });

    test('a batch whose first scenario gets only failures: an infra fault (125), the next scenario never starts, the result says INFRA FAULT', { timeout: 150000 }, async () => {
        // timeoutMin 1 (#248 review 3): if the rule ever failed to fire, the fake would be stopped after a minute, not 15.
        const r = await runBatch({ scenarios: ['a', 'b'], timeoutMin: '1', extraEnv: stopEnv({ FAKE_LLM: 'a:6:0' }) });
        assert.equal(r.code, EXIT_LLM_STOP, r.out);
        assert.equal(EXIT_LLM_STOP, 125);
        assert.deepEqual(r.ran.map((l) => l.split(' ')[0]), ['a'], 'b never started');
        assert.equal(r.summary.exit, 125);
        assert.equal(r.summary.scenarios[0].exit, 125);
        const stop = r.summary.scenarios[0].llmStop;
        assert.deepEqual([stop.failed, stop.ok, stop.httpErrors], [6, 0, { 429: 6 }]);
        assert.ok(stop.afterSpawnS <= stop.afterStartS);
        assert.deepEqual([r.summary.infraFault.kind, r.summary.infraFault.scenario, r.summary.infraFault.failed], ['llm-failure-stop', 'a', 6]);
        assert.match(r.summary.stopped, /^LLM-failure stop: 6 failed LLM replies and none answered within \d+ s of the bot's spawn in a \(an infra fault, not a bot result\)$/);
        assert.match(r.out, /a: LLM-failure stop: 6 failed LLM replies and none answered within \d+ s of the bot's spawn \(6 x HTTP 429\); an infra fault, stopping it and the batch/);
        assert.match(r.ctl, /fetch logs/, 'the logs are still fetched');
        // The scenario's own record says so (#248 review 1): not a check fail.
        const res = JSON.parse(fs.readFileSync(path.join(r.dir, 'out-a', 'result.json'), 'utf8'));
        assert.deepEqual([res.verdict, res.pass, res.infraFault.kind, res.infraFault.failed], ['INFRA FAULT', false, 'llm-failure-stop', 6]);
        assert.match(res.infraFault.reason, /^LLM-failure stop: 6 failed LLM replies/);
    });

    test('runOne: no spawn line means no window (until the cap); a model that answered once is never stopped; failures after the window are not counted', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-llmstop-'));
        const child = () => {
            const c = new EventEmitter();
            c.killed = [];
            c.kill = (sig) => { c.killed.push(sig); if (sig === 'SIGTERM') setImmediate(() => c.emit('exit', 143, null)); };
            return c;
        };
        const run1 = async (lines, llmStop, { writeAfterMs = 0, waitMs = 600 } = {}) => {
            fs.rmSync(path.join(dir, 'driver.log'), { force: true });
            if (!writeAfterMs) fs.writeFileSync(path.join(dir, 'driver.log'), lines.join('\n'));
            let c;
            const p = runOne({ id: 'x', out: dir, timeoutMin: 1 }, { maxBatchUsd: 2, driver: ['node', 'd.mjs'] }, {}, { spawnImpl: () => (c = child()), llmStop });
            if (writeAfterMs) { await new Promise((res) => setTimeout(res, writeAfterMs)); fs.writeFileSync(path.join(dir, 'driver.log'), lines.join('\n')); }
            await new Promise((res) => setTimeout(res, waitMs));
            if (!c.killed.length) c.emit('exit', 0, null);
            return { code: await p, killed: c.killed };
        };
        const settings = { windowMs: 400, capMs: 5000, pollMs: 50, minFailed: 5 };
        const fails = Array(9).fill('Generated response: My brain disconnected, try again.');
        // With the spawn line: stopped (the control).
        assert.deepEqual(await run1(['FRCFLD spawned.', ...fails], settings), { code: 125, killed: ['SIGTERM'] });
        // No spawn line: the window never opens, and after the cap it never will.
        assert.deepEqual(await run1(fails, { ...settings, capMs: 300 }), { code: 0, killed: [] });
        // Six failures and one answer: not stopped.
        assert.deepEqual(await run1(['FRCFLD spawned.', ...fails.slice(0, 6), 'Generated response: On it!'], settings), { code: 0, killed: [] });
        // The spawn and the failures appear only after the cap: not counted.
        assert.deepEqual(await run1(['FRCFLD spawned.', ...fails], { ...settings, capMs: 200 }, { writeAfterMs: 400, waitMs: 400 }), { code: 0, killed: [] });
    });

    test('the evidence tooling shows an infra fault as such (#248 review 1): the batch and the result must agree; never gate evidence', () => {
        const summary = { batchId: 'b1', testMode: false, gate: true, maxBatchUsd: 2, scenarios: [{ id: 'g3-a', runId: 'run-a', exit: 125 }], exit: 125 };
        const res = (extra = {}) => ({ file: 'a/result.json', result: { gate: 'G3', scenario: 'g3-a', batch: 'b1:2', runId: 'run-a', pass: false, verdict: 'INFRA FAULT', infraFault: { kind: 'llm-failure-stop', failed: 6 }, ...extra } });
        assert.equal(INFRA_FAULT_EXIT, 125);
        assert.deepEqual(crossCheckBatch(summary, [res()]), [], 'consistent: both sides say infra fault');
        assert.match(crossCheckBatch(summary, [res({ infraFault: undefined, verdict: 'FAIL' })]).join('; '), /stopped g3-a as an infra fault \(exit 125\), but its result does not say infraFault/);
        assert.match(crossCheckBatch({ ...summary, scenarios: [{ id: 'g3-a', runId: 'run-a', exit: 1 }] }, [res()]).join('; '), /its result says infraFault, but the batch recorded exit 1 for g3-a, not 125/);
        assert.match(crossCheckBatch(summary, [res()], { gate: true }).join('; '), /an infra fault \(llm-failure-stop\), not a bot result: never gate evidence/);
        // --tree names infra faults apart from check fails.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-infra-'));
        fs.mkdirSync(path.join(dir, 'b1', 'a'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'b1', 'batch.json'), JSON.stringify({ ...summary, gate: false, smoke: true }));
        fs.writeFileSync(path.join(dir, 'b1', 'a', 'result.json'), JSON.stringify(res().result));
        assert.deepEqual(checkEvidenceTree(dir), []);
        assert.deepEqual(infraFaultsUnder(dir), ['b1/a/result.json (llm-failure-stop)']);
        // markInfraFault: what batch.mjs does to the killed run's record.
        fs.writeFileSync(path.join(dir, 'b1', 'a', 'result.json'), JSON.stringify({ scenario: 'g3-a', verdict: 'FAIL', pass: false, checks: [{ check: 'x', pass: false }] }));
        assert.equal(markInfraFault(path.join(dir, 'b1', 'a'), { kind: 'llm-failure-stop', failed: 6 }, 'why'), true);
        const marked = JSON.parse(fs.readFileSync(path.join(dir, 'b1', 'a', 'result.json'), 'utf8'));
        assert.deepEqual([marked.verdict, marked.pass, marked.infraFault, marked.checks], ['INFRA FAULT', false, { kind: 'llm-failure-stop', failed: 6, reason: 'why' }, [{ check: 'x', pass: false }]]);
        assert.equal(markInfraFault(path.join(dir, 'none'), {}, 'why'), false);
    });
});
