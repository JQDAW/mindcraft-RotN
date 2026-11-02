// Offline tests for skills-rotn A3: the update loop survives a throwing mode,
// !smeltItem no longer restarts the process, and no /skin is sent at login.
// Fake clock, fake agent and fake bot; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runUpdateLoop, createErrorReporter } from './update_loop.js';
import { initModes } from './modes.js';

const FAKE_KEY = 'sk-or-v1-0123456789abcdefABCDEF0123456789abcdef';

function fakeClock() {
    let t = 1_000;
    return { now: () => t, sleep: (ms) => { t += ms; return Promise.resolve(); }, advance: (ms) => { t += ms; } };
}

test('runUpdateLoop carries on after a step throws', async () => {
    const clock = fakeClock();
    const calls = [];
    const errors = [];
    await runUpdateLoop((delta) => {
        calls.push(delta);
        clock.advance(50); // each step takes 50 ms
        if (calls.length === 2) throw new Error('mode blew up');
    }, {
        interval: 300,
        onError: (err) => errors.push(err.message),
        shouldStop: () => calls.length >= 5,
        now: clock.now,
        sleep: clock.sleep,
    });
    assert.equal(calls.length, 5, 'the loop kept going after the throw');
    assert.deepEqual(errors, ['mode blew up']);
    // One step per 300 ms interval: the first delta is 0, then 300 each.
    assert.deepEqual(calls, [0, 300, 300, 300, 300]);
});

test('runUpdateLoop also survives a rejected promise and a non-Error throw', async () => {
    const clock = fakeClock();
    let n = 0;
    const errors = [];
    await runUpdateLoop(async () => {
        n++;
        if (n === 1) throw 'a string';
        if (n === 2) await Promise.reject(new TypeError('x is undefined'));
    }, { onError: (e) => errors.push(e), shouldStop: () => n >= 3, now: clock.now, sleep: clock.sleep });
    assert.equal(n, 3);
    assert.equal(errors.length, 2);
});

test('createErrorReporter logs once per key per window, safely, and counts the rest', () => {
    const clock = fakeClock();
    const lines = [];
    const report = createErrorReporter('modes', { everyMs: 30_000, now: clock.now, log: (l) => lines.push(l) });

    assert.equal(report('self_defense', new Error(`boom Bearer ${FAKE_KEY}`)), true);
    clock.advance(300);
    assert.equal(report('self_defense', new Error('boom')), false);
    assert.equal(report('self_defense', new Error('boom')), false);
    assert.equal(report('hunting', new Error('other')), true, 'keys are independent');
    clock.advance(30_000);
    assert.equal(report('self_defense', new Error('boom again')), true);

    assert.deepEqual(lines, [
        '[modes] self_defense threw: Error: boom Bearer [redacted]',
        '[modes] hunting threw: Error: other',
        '[modes] self_defense threw (2 more since the last report): Error: boom again',
    ]);
});

// A fake agent whose bot throws on any property a mode reads, so every
// enabled mode's update() throws.
function throwingAgent(profileModes) {
    const target = {};
    const bot = new Proxy(target, {
        get(obj, key) {
            if (key in obj) return obj[key];
            throw new TypeError(`Cannot read bot.${String(key)} (modded block with no name)`);
        },
        set(obj, key, value) { obj[key] = value; return true; },
    });
    const agent = {
        bot,
        task: null,
        isIdle: () => true,
        actions: { currentActionLabel: '' },
        prompter: { getInitModes: () => profileModes },
    };
    initModes(agent);
    return agent;
}

test('ModeController.update survives throwing modes and still runs the later ones', async (t) => {
    const lines = [];
    t.mock.method(console, 'error', (...args) => lines.push(args.join(' ')));
    t.mock.method(console, 'log', () => {});
    const agent = throwingAgent({
        self_preservation: true, unstuck: true, cowardice: true, self_defense: true,
        hunting: true, item_collecting: true, torch_placing: true, elbow_room: true, idle_staring: true,
    });

    await agent.bot.modes.update(); // must not throw
    const first = lines.filter(l => l.startsWith('[modes] '));
    const names = new Set(first.map(l => l.split(' ')[1]));
    assert.ok(names.size >= 2, `more than one mode ran after a throw: ${[...names]}`);
    assert.ok(names.has('self_preservation'), 'the first mode in the list threw and was reported');

    await agent.bot.modes.update(); // the next tick runs, and the repeat throws are rate-limited
    assert.equal(lines.filter(l => l.startsWith('[modes] ')).length, first.length);
});

// The !smeltItem and /skin checks are behavioural tests in smelt_and_login.test.js (A4, #109 follow-up).
