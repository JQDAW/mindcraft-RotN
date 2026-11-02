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
import { readKeyUsage, keyFetch, countLlmCalls, spent, llmRecord, LLM_CALL_LINE, OPENROUTER_KEY_URL } from '../runner/lib/llm-spend.mjs';
import { G3_DEFAULTS, G3_GATE_PARAMS, TEST_TASK_GIVER, guardConsole, giverProblems } from '../runner/lib/g3.mjs';
import { weakenedParams, addNotGate } from '../runner/lib/runner.mjs';
import { parseBatchArgs, spendGate, EXIT_SPEND_STOP } from '../runner/batch.mjs';

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
function runBatch({ spend = '1.5', usage = 0, maxUsd = '2', scenarios = ['a', 'b', 'c'], key = KEY, usageFile = true, runExit = '0' } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-batch-'));
    const file = path.join(dir, 'usage.json');
    if (usageFile) fs.writeFileSync(file, JSON.stringify({ data: { usage, limit: 5, limit_remaining: 5 - usage } }));
    const ctl = path.join(dir, 'ctl.sh');
    fs.writeFileSync(ctl, `#!/usr/bin/env bash\necho "$*" >> "${fwd(path.join(dir, 'ctl.txt'))}"\n`);
    const args = [BATCH, '--max-batch-usd', maxUsd, '--logs-out', fwd(path.join(dir, 'logs')), '--summary', path.join(dir, 'batch.json')];
    for (const s of scenarios) args.push('--scenario', s, '--out', path.join(dir, `out-${s}`));
    args.push('--', 'node', 'driver.mjs');
    const env = { ...process.env, ROTN_TEST_MODE: '1', ROTN_OPENROUTER_USAGE_FILE: file, ROTN_BATCH_RUNNER: FAKE_RUNNER,
        FAKE_DIR: dir, FAKE_SPEND: spend, FAKE_RUN_EXIT: runExit, TEST_SERVER_CTL: fwd(ctl), OPENROUTER_API_KEY: key };
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
        assert.deepEqual(r.ran, ['a maxBatchUsd=2 key:set', 'b maxBatchUsd=2 key:set'], 'c never starts: USD 3 spent > 2');
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
