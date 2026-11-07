// Offline tests: an identical reflex line (and the models' "My brain disconnected" reply) goes to
// chat at most once per CHAT_REPEAT_MS; the rest are logged (no chat-spam loop: G3 rounds 2 and 3,
// harness-ops' G4 no_spam check: 4 identical lines a minute or 7 in 5 min fail it). No server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import settings from './settings.js';
import { createRepeatLimit, mayRepeat, CHAT_REPEAT_MS } from './chat_repeat.js';
import { __sayForTest } from './modes.js';
import { Agent } from './agent.js';

test('the limiter: an identical line once per CHAT_REPEAT_MS; other lines are not held up', () => {
    const ok = createRepeatLimit();
    assert.equal(CHAT_REPEAT_MS, 60_000);
    assert.equal(ok("I'm dying!", 0), true);
    assert.equal(ok("I'm dying!", 30_000), false);
    assert.equal(ok('Fighting zombie!', 30_000), true, 'another line');
    assert.equal(ok("I'm dying!", 59_999), false);
    assert.equal(ok("I'm dying!", 60_000), true, 'a minute later');
});

test('reflex lines: "I\'m dying!" 12 times in 5 min (g3a r2) reaches chat 5 times at most; the behavior log keeps every one', async (t) => {
    t.mock.method(console, 'log', () => {});
    const saved = settings.narrate_behavior;
    settings.narrate_behavior = true;
    t.after(() => { settings.narrate_behavior = saved; });
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    const chat = [];
    const agent = { shut_up: false, bot: { modes: { behavior_log: '' } }, openChat: (m) => chat.push(m) };
    for (let i = 0; i < 12; i++) { t.mock.timers.setTime(i * 25_000); await __sayForTest(agent, "I'm dying!"); }
    assert.ok(chat.length <= 5, `${chat.length} in chat`);
    assert.equal(chat.length, 4, 'at 0, 75, 150 and 225 s (each at least 60 s after the last)');
    assert.equal(agent.bot.modes.behavior_log.split('\n').filter(Boolean).length, 12);
});

test('"My brain disconnected, try again." (g3b r3: 6 times in 60 s) goes to chat once a minute; other replies are not limited', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    const chat = [];
    const me = { name: 'FRCFLD', shut_up: false, last_sender: null, isTaskGiver: () => true, openChat: (m) => { chat.push(m); return Promise.resolve(); } };
    for (let i = 0; i < 6; i++) { t.mock.timers.setTime(i * 10_000); await Agent.prototype.routeResponse.call(me, 'giver', 'My brain disconnected, try again.'); }
    assert.deepEqual(chat, ['My brain disconnected, try again.']);
    for (let i = 0; i < 3; i++) await Agent.prototype.routeResponse.call(me, 'giver', 'On my way.');
    assert.equal(chat.filter(m => m === 'On my way.').length, 3, 'a normal reply is never held back');
    assert.equal(mayRepeat(null, 'x'), true);
});
