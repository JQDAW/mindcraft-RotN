// G3 round 5 batch A: promptMemSaving returned null ("TypeError: cannot read length of null" at
// history.js:44) and the agent restarted 5 times. A null, empty, non-text or failure reply, or a
// throw, must keep the previous memory and log it. Offline: a fake prompter, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History, isMemoryReply } from './history.js';

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
