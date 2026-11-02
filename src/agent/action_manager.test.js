// Offline test (skills-rotn A1, #103 review finding 4): when an action throws,
// neither the log nor the agent-visible result message (which reaches the LLM
// and its history) carries the raw error text, its own properties or a long
// stack. A fake agent; no bot, no server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionManager } from './action_manager.js';

const FAKE_KEY = 'sk-or-v1-0123456789abcdefABCDEF0123456789abcdef';

function fakeAgent() {
    return {
        clearBotLogs() {},
        cleanKill() {},
        bot: { interrupt_code: false, output: 'did a thing', emit() {} },
    };
}

test('a throwing action gives a safe, capped error message', async (t) => {
    const logged = [];
    t.mock.method(console, 'error', (...args) => logged.push(args));
    t.mock.method(console, 'log', () => {});

    const err = new Error(`request failed: Authorization: Bearer ${FAKE_KEY} {"body":"secret response body"}`);
    err.config = { headers: { Authorization: `Bearer ${FAKE_KEY}` } };
    const manager = new ActionManager(fakeAgent());

    const result = await manager.runAction('test:throw', () => Promise.reject(err), { timeout: 0 });

    assert.equal(result.success, false);
    assert.equal(result.interrupted, false);
    const lines = result.message.split('\n');
    assert.ok(result.message.startsWith('Action output:\ndid a thing!!Code threw exception!!\n'));
    // Both the Bearer rule and the authorization key rule fire; the body is cut.
    assert.ok(result.message.includes('Error: Error: request failed: Authorization: [redacted] [redacted] {...}'));
    // At most 4 frames after the summary line, and no "undefined" stack.
    const frames = lines.filter(l => l.startsWith('    at '));
    assert.ok(frames.length >= 1 && frames.length <= 4);
    assert.ok(!result.message.includes('undefined'));

    const everything = result.message + '\n' + logged.flat().map(String).join('\n');
    for (const leak of [FAKE_KEY, 'secret response body']) {
        assert.ok(!everything.includes(leak), `leaked ${leak}`);
    }
    // The log gets strings only, never the error object.
    assert.ok(logged.flat().every(a => typeof a === 'string'));
    assert.equal(manager.executing, false);
});
