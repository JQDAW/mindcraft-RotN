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
import { parseJournal, calls, windows, soakSpend, render, gateUsage } from '../tools/soak-spend.mjs';

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
// The caller's lines after a reply: a command call's (agent.js) and a memory summary's (history.js).
const reply = (time, kind) => [L(time, 'Received.'), L(time, kind === 'summary' ? 'Memory updated to:  some memory' : 'Generated response: !stats')];
const command = (time, prompt, completion, usd, reasoning) => [...call(time, prompt, completion, usd, reasoning), ...reply(time, 'command')];
const summary = (time, prompt, completion, usd, reasoning) => [
    L(time, '[memory] summary turns 10 kept 5'),
    L(time, '[openrouter] reasoning effort=none for this call'),
    ...call(time, prompt, completion, usd, reasoning),
    ...reply(time, 'summary'),
];

test('a summary is the call whose reply goes to history.js (Memory updated to:), whatever its prompt size', () => {
    const text = [
        L('10:00:00', 'starting self-prompt loop'),
        ...command('10:00:05', 1500, 100, 0.0001, 90), // a small command prompt: still a command
        ...summary('10:00:10', 2600, 40, 0.0002, 0), // a 10-turn summary over 2,000 tokens: a summary
        ...command('10:00:20', 4000, 200, 0.0003, null), // no reasoning_tokens line
        L('10:00:21', '[openrouter] the reasoning setting may have been refused (status 400); retrying without it'),
    ].join('\n');
    const { list, unclear } = calls(parseJournal(text));
    assert.deepEqual(list.map(c => [c.kind, c.memory]), [['command', false], ['summary', true], ['command', false]]);
    assert.equal(unclear, 0);
    assert.deepEqual(list.map(c => c.reasoning), [90, 0, null]);
    const r = soakSpend(text);
    assert.equal(r.memory.calls, 1);
    assert.equal(r.memory.reasoning, 0);
    assert.equal(r.summaryPromptsOver, 1);
    assert.equal(r.markers, 1);
    assert.equal(r.summaryEnds, 1);
    assert.equal(r.effortLines, 1);
    assert.equal(r.effortRefused, 1);
    assert.equal(r.other.calls, 2);
    assert.match(render(r), /: 1 summaries \(1 with a prompt of 2,000 tokens or more\), 1 summary end lines, 1 `\[memory\] summary turns` markers; 0 calls not clearly paired/);
});

test('soak 14: a summary and a command call overlap and the command reply comes first; each is paired with its own reply', () => {
    // history.js prints the marker and starts the summary; the next command's prompt goes out at once.
    const text = [
        L('14:45:28', '[memory] summary turns 11 kept 4'),
        L('14:45:30', 'Awaiting openrouter api response...'),
        L('14:45:30', 'Awaiting openrouter api response...'),
        ...call('14:45:31', 3442, 123, 0.000167, 92), ...reply('14:45:31', 'command'), // the command's reply first
        ...call('14:45:36', 901, 300, 0.0002, 159), ...reply('14:45:36', 'summary'),
    ].join('\n');
    const { list } = calls(parseJournal(text));
    assert.deepEqual(list.map(c => [c.prompt, c.kind]), [[3442, 'command'], [901, 'summary']]);
});

test('a failed summary (`[memory] summary returned …`) is a summary; a call not clearly paired falls back to the prompt size and is counted', () => {
    const failed = [...call('10:00:00', 900, 5, 0.0001, 0), L('10:00:00', 'Received.'), L('10:00:00', '[memory] summary returned an empty reply; keeping the previous memory')];
    assert.deepEqual(calls(parseJournal(failed.join('\n'))).list.map(c => c.kind), ['summary']);
    // Two replies before either caller line: neither is clear; the prompt-size rule decides each.
    const mixed = [
        ...call('10:00:01', 1999, 10, 0.0001, 5), L('10:00:01', 'Received.'),
        ...call('10:00:02', 2000, 10, 0.0001, 5), L('10:00:02', 'Received.'),
        L('10:00:02', 'Generated response: !stats'),
    ].join('\n');
    const r = calls(parseJournal(mixed));
    assert.deepEqual(r.list.map(c => [c.kind, c.memory]), [['unclear', true], ['command', false]]);
    assert.equal(r.unclear, 1);
    // No caller lines at all (a log from before these lines): every call by the prompt size.
    const old = [...call('10:00:05', 1999, 10, 0.0001, 5), ...call('10:00:06', 2000, 10, 0.0001, 5)].join('\n');
    const o = soakSpend(old);
    assert.equal(o.unclear, 2);
    assert.equal(o.memory.calls, 1);
    assert.match(render(o), /2 calls not clearly paired \(the prompt-size rule for them\)/);
    // A summary end line with no call waiting is counted.
    assert.equal(calls(parseJournal(L('10:00:07', 'Memory updated to:  x'))).orphanEnds, 1);
});

test('windows: a night from sunset (or "it is night") to its first [night] morning line; a call at the boundary goes to the next window', () => {
    const text = [
        L('23:50:00', '[release] x'),
        L('23:50:30', 'BOT spawned.'),
        ...call('23:55:00', 3000, 10, 0.001, 5),
        ...call('23:58:00', 3000, 10, 0.0005, 5), // the same second as the sunset line, printed before it: day 1
        L('23:58:00', '[night] sunset is near: building a shelter'),
        ...call('23:58:00', 3000, 10, 0.002, 5), // printed after it, the same second: night 1
        L('00:20:00', '[night] morning: dug out of the shelter at 1, 2, 3; back to work', '2026-11-26'),
        L('00:20:01', '[night] morning: a second morning line, same night', '2026-11-26'),
        ...call('00:21:00', 3000, 10, 0.004, 5).map(l => l.replace('2026-11-25', '2026-11-26')),
        L('00:30:00', '[night] it is night: building a shelter', '2026-11-26'),
        L('00:40:00', 'last line', '2026-11-26'),
    ].join('\n');
    const r = soakSpend(text);
    assert.deepEqual(r.windows.map(w => [w.name, w.all.calls]), [['Day 1', 2], ['Night 1', 1], ['Day 2', 1], ['Night 2 (open at the end)', 0]]);
    assert.equal(r.windows[0].from, Date.parse('2026-11-25T23:50:30Z')); // day 1 is named from the spawn line
    assert.equal(r.windows[1].to - r.windows[1].from, 22 * 60_000); // across midnight UTC
    assert.ok(Math.abs(r.windows[0].all.usd - 0.0015) < 1e-12);
    assert.ok(Math.abs(r.total.usd - 0.0075) < 1e-12);
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

test('the soak 13 evidence: the README numbers (268 calls, USD 0.110436, 69 summaries paired with their replies, 262 self-prompting calls)', () => {
    const file = path.join(ROOT, 'test/evidence/g4/g4soak-13-20261124/driver.log');
    const r = soakSpend(fs.readFileSync(file, 'utf8'));
    assert.equal(r.summaryEnds, 69);
    assert.equal(r.unclear, 4); // all four have prompts over 2,000 tokens: commands by the fallback
    assert.equal(r.total.calls, 268);
    assert.equal(r.total.usd.toFixed(6), '0.110436');
    assert.equal(r.memory.calls, 69);
    assert.equal(r.memory.usd.toFixed(6), '0.046646');
    assert.equal(r.total.reasoning, 349462);
    assert.deepEqual(r.windows.map(w => w.all.calls), [89, 0, 52, 0, 124, 0, 3]);
    assert.equal(r.selfPrompting.calls, 262);
    assert.deepEqual(r.providers, { Wafer: 267, 'Near AI': 1 });
    assert.equal(r.usdPerHour.source, 'journal span'); // no result.json passed
    const result = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'result.json'), 'utf8'));
    const g = soakSpend(fs.readFileSync(file, 'utf8'), { result }).usdPerHour;
    assert.deepEqual(g, { source: 'gate', value: 0.055172, minutes: 120, gateUsd: 0.110436, matches: true });
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

test('#602 review 8: an `unknown` usage field is null, adds nothing and is counted', () => {
    const text = [
        L('10:00:00', '[openrouter] usage prompt_tokens unknown, completion_tokens unknown, cost_usd unknown'),
        ...call('10:00:01', 3000, 10, 0.001, 5),
    ].join('\n');
    const r = soakSpend(text);
    assert.equal(r.total.calls, 2);
    assert.equal(r.total.unknownUsd, 1);
    assert.equal(r.total.usd, 0.001);
    assert.equal(r.memory.calls, 0); // an unknown prompt is not a summary under the old rule either
    assert.match(render(r), /1 usage line\(s\) have cost_usd unknown/);
});

test('#602 review 4: one USD/h, the gate\'s from result.json; without it, the journal span, labelled not the gate\'s', () => {
    const text = [L('10:00:00', 'x'), ...call('10:30:00', 3000, 10, 0.01, 5), L('11:00:00', 'y')].join('\n');
    assert.equal(gateUsage({}), null);
    const span = soakSpend(text);
    assert.deepEqual(span.usdPerHour, { source: 'journal span', value: 0.01, minutes: 60 });
    assert.match(render(span), /\*\*Not the gate's figure\*\*/);
    const g = soakSpend(text, { result: { notes: { llmUsage: { usdPerHour: 0.012, usd: 0.02, minutes: 50, calls: 2 } } } });
    assert.deepEqual(g.usdPerHour, { source: 'gate', value: 0.012, minutes: 50, gateUsd: 0.02, matches: false });
    assert.match(render(g), /\*\*differs from\*\*/);
});

test('#602 review 7: a summary started inside a loop run whose usage line follows the stop counts outside it', () => {
    const text = [
        L('10:00:00', 'starting self-prompt loop'),
        L('10:00:01', '[memory] summary turns 10 kept 5'),
        L('10:00:02', 'self prompt loop stopped'),
        ...call('10:00:03', 2500, 10, 0.001, 0), ...reply('10:00:03', 'summary'),
    ].join('\n');
    const r = soakSpend(text);
    assert.equal(r.memory.calls, 1);
    assert.equal(r.selfPrompting.calls, 0);
});
