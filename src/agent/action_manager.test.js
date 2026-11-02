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

// A4b (lead, before any G3 batch): a new non-mode action drops a pending
// reflex re-plan request, so it cannot cause an extra LLM call later.
test('a new non-mode action clears a pending re-plan request; a mode action keeps it', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    const agent = fakeAgent();
    agent.replan = { modes: { self_defense: 1 }, interrupted: 'action:collectBlocks', first_at: 0, last_at: 0 };
    const manager = new ActionManager(agent);

    await manager.runAction('mode:cowardice', () => Promise.resolve(), { timeout: 0 });
    assert.ok(agent.replan, 'a reflex action keeps the request');

    await manager.runAction('action:craftRecipe', () => Promise.resolve(), { timeout: 0 });
    assert.equal(agent.replan, null);
    assert.ok(lines.includes('[reflex] re-plan request dropped: a new action started (action:craftRecipe).'));

    lines.length = 0;
    await manager.runAction('action:goToPlayer', () => Promise.resolve(), { timeout: 0 });
    assert.ok(!lines.some(l => l.includes('re-plan request dropped')), 'nothing to drop, nothing logged');
});

test('only player and LLM commands (action:) drop a pending re-plan; npc:, itemGoal: and BuildGoal keep it (#126 review)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const agent = fakeAgent();
    const manager = new ActionManager(agent);
    for (const label of ['npc:moveAway', 'itemGoal:next', 'BuildGoal', 'mode:self_defense']) {
        agent.replan = { modes: { self_defense: 1 }, interrupted: 'action:collectBlocks', first_at: 0, last_at: 0 };
        await manager.runAction(label, () => Promise.resolve(), { timeout: 0 });
        assert.ok(agent.replan, `${label} keeps the request`);
    }
    await manager.runAction('action:collectBlocks', () => Promise.resolve(), { timeout: 0 });
    assert.equal(agent.replan, null);
});
