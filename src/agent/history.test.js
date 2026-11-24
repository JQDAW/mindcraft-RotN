// G3 round 5 batch A: promptMemSaving returned null ("TypeError: cannot read length of null" at
// history.js:44) and the agent restarted 5 times. A null, empty, non-text or failure reply, or a
// throw, must keep the previous memory and log it. Offline: a fake prompter, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History, isMemoryReply, summaryChunkSize } from './history.js';
import settings from './settings.js';
import process from 'node:process';

function history(reply) {
    const h = Object.create(History.prototype); // no constructor: it makes ./bots/<name>/ dirs
    h.memory = 'previous: logs at 10 64 -3';
    h.agent = { prompter: { promptMemSaving: () => Promise.resolve().then(() => (typeof reply === 'function' ? reply() : reply)) } };
    return h;
}

async function quietly(fn) {
    const warned = [];
    const [log, warn] = [console.log, console.warn];
    console.log = () => {};
    console.warn = (...a) => warned.push(a.join(' '));
    try { await fn(); } finally { [console.log, console.warn] = [log, warn]; }
    return warned;
}

test('round 5 A: a null, empty, non-text or failure memory reply, or a throw, keeps the previous memory and is logged', async () => {
    const cases = [null, undefined, '', '   ', 42, { content: 'x' },
        'No response received.', 'My brain disconnected, try again.', 'No response from Claude.',
        'No response data.', 'An unexpected error occurred, please try again.',
        () => { throw new Error('socket hang up'); }];
    for (const reply of cases) {
        const h = history(reply);
        const warned = await quietly(() => h.summarizeMemories([{ role: 'user', content: 'hi' }]));
        assert.equal(h.memory, 'previous: logs at 10 64 -3', `kept for ${String(reply)}`);
        assert.match(warned.join('\n'), /\[memory\] summary .*keeping the previous memory/, `logged for ${String(reply)}`);
    }
});

test('round 5 A: a real summary still replaces the memory (trimmed, truncated at 500)', async () => {
    const h = history('  Logs at 10 64 -3. Lead is Alice.  ');
    await quietly(() => h.summarizeMemories([]));
    assert.equal(h.memory, 'Logs at 10 64 -3. Lead is Alice.');
    const long = history('a'.repeat(600));
    await quietly(() => long.summarizeMemories([]));
    assert.ok(long.memory.startsWith('a'.repeat(500) + '...(Memory truncated'));
    assert.equal(isMemoryReply('No response received.'), false);
    assert.equal(isMemoryReply('ok'), true);
});

test('#268 follow-up 4: a memory.json from an earlier run holding a failure reply is dropped on load', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'rotn-mem-'));
    try {
        const loaded = async (memory) => {
            const h = Object.create(History.prototype);
            h.memory_fp = join(dir, 'memory.json');
            writeFileSync(h.memory_fp, JSON.stringify({ memory, turns: [{ role: 'user', content: 'hi' }] }));
            const warned = await quietly(() => { h.load(); });
            return [h.memory, h.turns.length, warned.join('\n')];
        };
        for (const bad of ['My brain disconnected, try again.', 'No response received.', 42]) {
            const [memory, turns, warned] = await loaded(bad);
            assert.equal(memory, '', `dropped: ${bad}`);
            assert.equal(turns, 1, 'the turns are kept');
            assert.match(warned, /\[memory\] the saved memory was not a summary/);
        }
        assert.deepEqual((await loaded('Logs at 10 64 -3.')).slice(0, 2), ['Logs at 10 64 -3.', 1], 'a real summary is kept');
        assert.equal((await loaded(''))[2], '', 'no memory: no warning');
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

// G3 round 5 A rerun: all 4 memory summaries came back empty (finish_reason stop). promptMemSaving
// sends the prompt with the default stop sequence '*' (src/models/*.js sendRequest), so a summary
// that opens with markdown ("**Memory:**", "* item") stops at its first character.
test('round 5 A rerun: the memory prompt asks for plain text with no asterisks (the stop sequence is "*")', async () => {
    const { readFileSync } = await import('node:fs');
    const profile = JSON.parse(readFileSync(new URL('../../profiles/defaults/_default.json', import.meta.url), 'utf8'));
    assert.match(profile.saving_memory, /Write plain text only: no markdown, no asterisks, no bullet points, no headings, and no thinking out loud; start with the memory itself\./);
    assert.ok(!profile.saving_memory.includes('*'), 'the prompt itself shows no asterisk to copy');
});

// Soak 13 (C2, the lead): with max_messages 15 and upstream's chunk of 5 a summary ran every 5 turns (69 in
// 2 h, 26% of the calls). Now the chunk is max_messages - 5 (at least 5): every 10 turns at 15, 5 turns kept;
// each summary call logs "[memory] summary turns <n> kept <k>" (the harness counts summaries by it).
test('soak 13 C2: at max_messages 15 a summary takes 10 turns and keeps 5, so 25 turns make 2 summaries, not 4; each logs its marker', async (t) => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const before = settings.max_messages;
    settings.max_messages = 15;
    const cwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'rotn-hist-'));
    t.after(() => { settings.max_messages = before; process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); });
    process.chdir(dir); // History writes ./bots/<name>/
    const logged = [];
    t.mock.method(console, 'log', (...a) => logged.push(a.join(' ')));
    const summaries = [];
    const h = new History({ name: 'FRCFLD', prompter: { promptMemSaving: (turns) => { summaries.push(turns.length); return Promise.resolve('memory'); } } });
    assert.equal(h.summary_chunk_size, 10);
    for (let i = 0; i < 25; i++) await h.add(i % 2 ? 'FRCFLD' : 'system', `turn ${i}`);
    assert.deepEqual(summaries, [10, 10]);
    assert.deepEqual(logged.filter(l => l.startsWith('[memory] summary')), ['[memory] summary turns 10 kept 5', '[memory] summary turns 10 kept 5']);
    assert.equal(h.turns.length, 5);
    // The rule: max_messages - 5, never below upstream's 5.
    assert.equal(summaryChunkSize(15), 10);
    assert.equal(summaryChunkSize(20), 15);
    assert.equal(summaryChunkSize(6), 5);
    assert.equal(summaryChunkSize(undefined), 5);
});
