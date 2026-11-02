// G3's spend stop and guards (lead, #101 and #116 review), offline: the numbers-only key usage read,
// per-scenario LLM records, the batch runner's spend stop (it stops, fetches the logs, exits 5), the
// console allowlist (no give, summon or op commands), and `Server` as a test-only task giver.
// Addresses and keys here are fakes; no network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readKeyUsage, keyFetch, countLlmCalls, spent, llmRecord, testOverridesAllowed, LLM_CALL_LINE, OPENROUTER_KEY_URL } from '../runner/lib/llm-spend.mjs';
import { G3_DEFAULTS, G3_GATE_PARAMS, TEST_TASK_GIVER, guardConsole, giverProblems, g3Policy } from '../runner/lib/g3.mjs';
import { weakenedParams, addNotGate } from '../runner/lib/runner.mjs';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
import { parseBatchArgs, spendGate, endVerdict, forbiddenOverrides, runOne, runIdOf, EXIT_SPEND_STOP, EXIT_SPEND_UNKNOWN } from '../runner/batch.mjs';
import { loadScenarios } from '../runner/run.mjs';
import { crossCheckBatch, isG3Result } from '../runner/lib/g3.mjs';
import { checkFiles, resultFilesUnder, checkEvidenceTree } from '../tools/g3-batch-check.mjs';

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
        assert.deepEqual(llmRecord({ ok: true, usage: 1 }, { ok: true, usage: 1.25 }, [LLM_CALL_LINE, LLM_CALL_LINE]),
            { calls: 2, usageBefore: 1, usageAfter: 1.25, usd: 0.25, error: null });
        assert.deepEqual(llmRecord({ ok: true, usage: 1 }, { ok: false, error: 'timeout' }, []),
            { calls: 0, usageBefore: 1, usageAfter: null, usd: null, error: 'timeout' });
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
        assert.deepEqual(ok.options.scenarios, [{ id: 'a', out: 'A', timeoutMin: 15 }, { id: 'b', out: 'B', timeoutMin: 55 }]);
        assert.deepEqual(ok.options.driver, ['node', 'd.mjs']);
        const bad = parseBatchArgs(['--scenario', 'a', '--bogus']);
        for (const m of [/unknown argument '--bogus'/, /--max-batch-usd must be a positive/, /--logs-out is required/, /--scenario a has no --out/, /driver comes after --/]) {
            assert.ok(bad.problems.some((p) => m.test(p)), `${m}: ${JSON.stringify(bad.problems)}`);
        }
    });
});

/** batch.mjs with the fake runner, a fake key-usage file and a fake TEST_SERVER_CTL that records the fetch. */
function runBatch({ spend = '1.5', usage = 0, maxUsd = '2', scenarios = ['a', 'b', 'c'], key = KEY, usageFile = true, runExit = '0', fakeCloud = '1', breakUsage = '', hang = '', timeoutMin = null } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-batch-'));
    const file = path.join(dir, 'usage.json');
    if (usageFile) fs.writeFileSync(file, JSON.stringify({ data: { usage, limit: 5, limit_remaining: 5 - usage } }));
    const ctl = path.join(dir, 'ctl.sh');
    fs.writeFileSync(ctl, `#!/usr/bin/env bash\necho "$*" >> "${fwd(path.join(dir, 'ctl.txt'))}"\n`);
    const args = [BATCH, '--max-batch-usd', maxUsd, '--logs-out', fwd(path.join(dir, 'logs')), '--summary', path.join(dir, 'batch.json')];
    if (timeoutMin) args.push('--timeout-min', timeoutMin);
    for (const s of scenarios) args.push('--scenario', s, '--out', path.join(dir, `out-${s}`));
    args.push('--', 'node', 'driver.mjs');
    const env = { ...process.env, ROTN_TEST_MODE: '1', ROTN_OPENROUTER_USAGE_FILE: file, ROTN_BATCH_RUNNER: FAKE_RUNNER,
        FAKE_DIR: dir, FAKE_SPEND: spend, FAKE_RUN_EXIT: runExit, TEST_SERVER_CTL: fwd(ctl), TEST_SERVER_FAKE_CLOUD: fakeCloud, FAKE_BREAK_USAGE: breakUsage, FAKE_HANG: hang, OPENROUTER_API_KEY: key };
    if (!key) delete env.OPENROUTER_API_KEY;
    return new Promise((resolve) => {
        const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', (b) => { out += b; });
        child.stderr.on('data', (b) => { out += b; });
        child.on('exit', (code) => {
            const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
            resolve({ code, out, ran: read('ran.txt').trim().split('\n').filter(Boolean), ctl: read('ctl.txt'), summary: JSON.parse(read('batch.json') || 'null') });
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
        put('g3/b1/batch.json', summary);
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

    test('CI: every G3 result.json under test/evidence/ is covered and vouched for by its batch.json', (t) => {
        const root = path.join(HERE, '..', 'evidence');
        assert.deepEqual(checkEvidenceTree(root), []);
        const g3 = resultFilesUnder(root).filter((f) => {
            try {
                return isG3Result(JSON.parse(fs.readFileSync(f, 'utf8')));
            } catch {
                return false;
            }
        });
        t.diagnostic(`${g3.length} G3 result(s) under test/evidence/`);
    });
});

describe('G3 console: only the approved commands reach the server (no give, summon or op commands)', () => {
    const sent = [];
    const g = guardConsole({ console: (cmd) => { sent.push(cmd); return []; }, log: () => [] });
    test('approved commands pass through', () => {
        const ok = ['say scenario-20261102t1-abc-begin', 'seed', 'tp FRCFLD ~ ~ ~', 'tp FRCFLD -45 66 -66', 'tell FRCFLD !task add go to the gold block',
            'testforblock -45 65 -66 minecraft:dirt 2', 'testfor @e[tag=t1,type=minecraft:zombie,x=1,y=2,z=3,r=3]', 'clear FRCFLD minecraft:stone_pickaxe -1 0',
            'scoreboard objectives add g3_c_table stat.craftItem.minecraft.crafting_table', 'scoreboard objectives remove g3_c_table',
            'scoreboard players list FRCFLD', 'time query daytime', 'time set day', 'gamerule doDaylightCycle', 'setblock -20 70 -40 minecraft:gold_block'];
        for (const c of ok) g.console(c);
        assert.deepEqual(sent, ok);
    });
    test('give, summon, kill, op commands, a real clear, time or rule changes and other blocks are refused before sending', () => {
        sent.length = 0;
        const refused = ['give FRCFLD minecraft:stone_pickaxe 1 0', 'summon minecraft:zombie 0 64 0', 'kill @e[type=minecraft:zombie]', 'op FRCFLD',
            'gamemode creative FRCFLD', 'effect FRCFLD minecraft:regeneration 30', 'clear FRCFLD minecraft:stone_pickaxe -1 1', 'clear FRCFLD',
            'time set night', 'time add 1000', 'gamerule doDaylightCycle false', 'setblock 0 64 0 minecraft:chest', 'difficulty peaceful', 'tp FRCFLD @p',
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
    test('the repo\'s settings.js has no Server giver', async () => {
        const s = (await import(new URL('../../settings.js', import.meta.url).href)).default;
        assert.deepEqual(giverProblems(s), []);
    });
});
