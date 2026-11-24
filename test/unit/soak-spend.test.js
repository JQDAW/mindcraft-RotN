// test/tools/soak-spend.mjs: the per-window LLM spend of a soak's driver.log (offline, no LLM).
import './isolate-tmp.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseJournal, calls, windows, soakSpend, render } from '../tools/soak-spend.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOL = path.join(ROOT, 'test/tools/soak-spend.mjs');

// One journal line at hh:mm:ss on 2026-11-25 (or the given date).
const L = (time, msg, date = '2026-11-25') => `${date}T${time}+00:00 node[1]: ${msg}`;
const call = (time, prompt, completion, usd, reasoning, provider = 'Wafer') => [
    L(time, 'Awaiting openrouter api response...'),
    L(time, `[openrouter] provider ${provider}, finish_reason stop, content 100 chars`),
    L(time, `[openrouter] usage prompt_tokens ${prompt}, completion_tokens ${completion}, cost_usd ${usd}`),
    ...(reasoning === null ? [] : [L(time, `[openrouter] reasoning_tokens ${reasoning}`)]),
];
const summary = (time, prompt, completion, usd, reasoning) => [
    L(time, '[memory] summary turns 10 kept 5'),
    L(time, '[openrouter] reasoning effort=none for this call'),
    ...call(time, prompt, completion, usd, reasoning),
];

test('soak 14 rule: a summary is the usage line after a [memory] marker, whatever its prompt size', () => {
    const text = [
        L('10:00:00', 'starting self-prompt loop'),
        ...call('10:00:05', 1500, 100, 0.0001, 90), // a small command prompt: not a summary under the marker rule
        ...summary('10:00:10', 2600, 40, 0.0002, 0), // a 10-turn summary over 2,000 tokens: a summary
        ...call('10:00:20', 4000, 200, 0.0003, null), // no reasoning_tokens line
    ].join('\n');
    const { memoryRule, list } = calls(parseJournal(text));
    assert.equal(memoryRule, 'marker');
    assert.deepEqual(list.map(c => c.memory), [false, true, false]);
    assert.equal(list[1].effort, 'effort=none');
    assert.equal(list[0].effort, null);
    assert.deepEqual(list.map(c => c.reasoning), [90, 0, null]);
    const r = soakSpend(text);
    assert.equal(r.memory.calls, 1);
    assert.equal(r.memory.reasoning, 0);
    assert.equal(r.memoryWithEffort, 1);
    assert.equal(r.effortLines, 1);
    assert.equal(r.other.calls, 2);
    assert.equal(r.total.reasoningLines, 2);
    assert.match(render(r), /counted by: the `\[memory\] summary turns` marker \(1 markers\)/);
});

test('before #601 (no marker in the log): the old rule, a prompt under 2,000 tokens, and it says so', () => {
    const text = [...call('10:00:05', 1999, 10, 0.0001, 5), ...call('10:00:06', 2000, 10, 0.0001, 5)].join('\n');
    const r = soakSpend(text);
    assert.equal(r.memoryRule, 'prompt-size');
    assert.equal(r.memory.calls, 1);
    assert.match(render(r), /a prompt under 2,000 tokens \(no `\[memory\] summary turns` marker in this log\)/);
});

test('two markers before their calls (overlap): each claims the next usage line in order', () => {
    const text = [
        L('10:00:00', '[memory] summary turns 10 kept 5'),
        L('10:00:00', '[memory] summary turns 10 kept 5'),
        ...call('10:00:01', 900, 10, 0.0001, 0),
        ...call('10:00:02', 900, 10, 0.0001, 0),
        ...call('10:00:03', 900, 10, 0.0001, 0),
    ].join('\n');
    assert.deepEqual(calls(parseJournal(text)).list.map(c => c.memory), [true, true, false]);
});

test('windows: a night from sunset (or "it is night") to its first [night] morning line; a call at the boundary goes to the next window', () => {
    const text = [
        L('23:50:00', '[release] x'),
        ...call('23:55:00', 3000, 10, 0.001, 5),
        L('23:58:00', '[night] sunset is near: building a shelter'),
        ...call('23:58:00', 3000, 10, 0.002, 5), // at the night's start: night 1
        L('00:20:00', '[night] morning: dug out of the shelter at 1, 2, 3; back to work', '2026-11-26'),
        L('00:20:01', '[night] morning: a second morning line, same night', '2026-11-26'),
        ...call('00:21:00', 3000, 10, 0.004, 5).map(l => l.replace('2026-11-25', '2026-11-26')),
        L('00:30:00', '[night] it is night: building a shelter', '2026-11-26'),
        L('00:40:00', 'last line', '2026-11-26'),
    ].join('\n');
    const r = soakSpend(text);
    assert.deepEqual(r.windows.map(w => [w.name, w.all.calls]), [['Day 1', 1], ['Night 1', 1], ['Day 2', 1], ['Night 2 (open at the end)', 0]]);
    assert.equal(r.windows[1].to - r.windows[1].from, 22 * 60_000); // across midnight UTC
    assert.ok(Math.abs(r.total.usd - 0.007) < 1e-12);
    assert.equal(windows([]).length, 0);
});

test('self-prompting by line order: a call after the stop line in the same second is outside', () => {
    const text = [
        L('10:00:00', 'starting self-prompt loop'),
        ...call('10:00:10', 3000, 10, 0.001, 5),
        L('10:01:00', 'self prompt loop stopped'),
        ...call('10:01:00', 3000, 10, 0.002, 5),
        L('10:02:00', 'starting self-prompt loop'),
        ...call('10:02:30', 3000, 10, 0.004, 5),
        L('10:03:00', 'end'),
    ].join('\n');
    const sp = soakSpend(text).selfPrompting;
    assert.equal(sp.calls, 2);
    assert.ok(Math.abs(sp.usd - 0.005) < 1e-12);
    assert.equal(sp.runs, 2);
    assert.equal(sp.openAtEnd, true);
    assert.equal(sp.ms, 60_000 + 60_000);
});

test('the soak 13 evidence: the README numbers (268 calls, USD 0.110436, 69 summaries by prompt size, 262 self-prompting calls)', () => {
    const file = path.join(ROOT, 'test/evidence/g4/g4soak-13-20261124/driver.log');
    const r = soakSpend(fs.readFileSync(file, 'utf8'));
    assert.equal(r.memoryRule, 'prompt-size');
    assert.equal(r.total.calls, 268);
    assert.equal(r.total.usd.toFixed(6), '0.110436');
    assert.equal(r.memory.calls, 69);
    assert.equal(r.memory.usd.toFixed(6), '0.046646');
    assert.equal(r.total.reasoning, 349462);
    assert.deepEqual(r.windows.map(w => w.all.calls), [89, 0, 52, 0, 124, 0, 3]);
    assert.equal(r.selfPrompting.calls, 262);
    assert.deepEqual(r.providers, { Wafer: 267, 'Near AI': 1 });
});

test('the CLI: usage errors exit 2, a file with no usage line exits 1, --json parses', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soak-spend-'));
    try {
        const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
        assert.equal(run().status, 2);
        assert.equal(run(path.join(dir, 'missing.log')).status, 2);
        const empty = path.join(dir, 'empty.log');
        fs.writeFileSync(empty, L('10:00:00', 'nothing'));
        assert.equal(run(empty).status, 1);
        const one = path.join(dir, 'one.log');
        fs.writeFileSync(one, call('10:00:00', 3000, 10, 0.001, 5).join('\n'));
        const out = run(one, '--json');
        assert.equal(out.status, 0, out.stderr);
        assert.equal(JSON.parse(out.stdout).total.calls, 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
