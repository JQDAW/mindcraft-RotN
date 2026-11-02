// Offline tests for skills-rotn A4 (quiet reflexes): a reflex records a
// re-plan request instead of stopping the self-prompter and prompting the LLM;
// execute() never rejects; the unstuck mode re-plans instead of killing the
// agent; isClearPath is bounded. Fake agents and bots; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { requestReplan, takeReplanNote, replanPromptDue, hasReplan, QUIET_MS, MIN_GAP_MS } from './replan.js';
import { initModes, execute, __modeForTest } from './modes.js';
import { SelfPrompter } from './self_prompter.js';
import { isClearPath, CLEAR_PATH_LIMITS } from './library/world.js';

const quiet = { log: () => {} };

test('requestReplan records and coalesces; takeReplanNote returns one note and clears it', () => {
    const agent = {};
    requestReplan(agent, 'self_defense', 'action:collectBlocks', { now: 1000, ...quiet });
    requestReplan(agent, 'self_defense', 'action:collectBlocks', { now: 2000, ...quiet });
    requestReplan(agent, 'cowardice', 'mode:self_defense', { now: 3000, ...quiet });
    assert.equal(hasReplan(agent), true);
    assert.equal(takeReplanNote(agent),
        "Reflexes (self_defense x2, cowardice) interrupted 'mode:self_defense'. Check your state and re-plan from here.");
    assert.equal(takeReplanNote(agent), null);
    assert.equal(hasReplan(agent), false);
});

test('replanPromptDue waits for quiet, idleness, no reflex, no self-prompting, and the gap', () => {
    const agent = {};
    requestReplan(agent, 'self_defense', 'action:collectBlocks', { now: 100_000, ...quiet });
    const base = { idle: true, reflexActive: false, selfPrompting: false, lastPromptAt: 0 };
    assert.equal(replanPromptDue(agent, { ...base, now: 100_000 + QUIET_MS - 1 }), false, 'not quiet yet');
    assert.equal(replanPromptDue(agent, { ...base, now: 100_000 + QUIET_MS }), true);
    assert.equal(replanPromptDue(agent, { ...base, idle: false, now: 200_000 }), false);
    assert.equal(replanPromptDue(agent, { ...base, reflexActive: true, now: 200_000 }), false);
    assert.equal(replanPromptDue(agent, { ...base, selfPrompting: true, now: 200_000 }), false, 'the self-prompter carries the note');
    assert.equal(replanPromptDue(agent, { ...base, lastPromptAt: 200_000 - MIN_GAP_MS + 1, now: 200_000 }), false, 'one prompt per gap');
    assert.equal(replanPromptDue({}, { ...base, now: 200_000 }), false, 'nothing requested');
});

function fakeAgent({ runAction } = {}) {
    const calls = { stopLoop: 0, handleMessage: [], cleanKill: [] };
    const agent = {
        name: 'FRCFLD',
        calls,
        bot: {},
        task: null,
        prompter: { getInitModes: () => ({}) },
        actions: {
            currentActionLabel: 'action:collectBlocks',
            resume_func: null,
            runAction: runAction ?? (async (label, fn) => { await fn(); return { message: 'ok', interrupted: false }; }),
        },
        self_prompter: { isActive: () => true, stopLoop: () => { calls.stopLoop++; } },
        handleMessage: (...args) => { calls.handleMessage.push(args); return Promise.resolve(true); },
        cleanKill: (...args) => { calls.cleanKill.push(args); },
        isIdle: () => true,
    };
    return agent;
}

test('a reflex that interrupts an action records a re-plan: no stopLoop, no LLM prompt', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    const agent = fakeAgent();
    const mode = { name: 'self_defense', active: false };
    let ran = false;

    await execute(mode, agent, () => { ran = true; return Promise.resolve(); });

    assert.equal(ran, true);
    assert.equal(mode.active, false);
    assert.equal(agent.calls.stopLoop, 0);
    assert.deepEqual(agent.calls.handleMessage, []);
    assert.ok(lines.includes("[reflex] self_defense interrupted 'action:collectBlocks'; re-plan requested (no LLM call now)."));
    assert.match(takeReplanNote(agent), /^Reflexes \(self_defense\) interrupted 'action:collectBlocks'/);
});

test('execute never rejects and always resets mode.active', async (t) => {
    const errors = [];
    t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')));
    t.mock.method(console, 'log', () => {});
    const agent = fakeAgent({ runAction: () => Promise.reject(new TypeError('block.name is undefined')) });
    const mode = { name: 'item_collecting', active: false };

    await execute(mode, agent, async () => {}); // must resolve
    assert.equal(mode.active, false);
    assert.ok(errors.some(e => e.startsWith('[modes] item_collecting threw: TypeError: block.name is undefined')));
    assert.equal(hasReplan(agent), false);
});

test('ModeController.update sends one coalesced re-plan prompt when quiet and not self-prompting', async (t) => {
    t.mock.method(console, 'log', () => {});
    const agent = fakeAgent();
    agent.self_prompter.isActive = () => false;
    initModes(agent);
    for (const name of ['self_preservation', 'unstuck', 'cowardice', 'self_defense', 'hunting', 'item_collecting', 'torch_placing', 'elbow_room', 'idle_staring']) {
        agent.bot.modes.setOn(name, false);
    }
    requestReplan(agent, 'self_defense', 'action:collectBlocks', { now: Date.now() - QUIET_MS - 1, ...quiet });

    await agent.bot.modes.update();
    assert.equal(agent.calls.handleMessage.length, 1);
    assert.match(agent.calls.handleMessage[0][1], /^\(AUTO MESSAGE\) Reflexes \(self_defense\) interrupted 'action:collectBlocks'/);
    assert.equal(hasReplan(agent), false);

    // Another reflex soon after: no second prompt within the gap.
    requestReplan(agent, 'self_defense', 'action:collectBlocks', { now: Date.now() - QUIET_MS - 1, ...quiet });
    await agent.bot.modes.update();
    assert.equal(agent.calls.handleMessage.length, 1);
});

test('unstuck: still stuck after the bounded attempt -> stop, log and re-plan; never cleanKill', async (t) => {
    const warnings = [];
    t.mock.method(console, 'warn', (...a) => warnings.push(a.join(' ')));
    t.mock.method(console, 'log', () => {});
    const agent = fakeAgent();
    agent.isIdle = () => false;
    initModes(agent);
    agent.bot.modes.setOn('cheat', false);
    let stopped = 0;
    let rejectGoto = null;
    const position = new Vec3(10, 64, 10);
    Object.assign(agent.bot, {
        registry: minecraftData('1.12.2'),
        version: '1.12.2',
        output: '',
        entity: { position },
        targetDigBlock: null,
        pathfinder: {
            setMovements() {},
            getPathTo: () => ({ status: 'success', path: [] }),
            // Never gets free; like mineflayer, stop() makes the pending goto reject.
            goto: () => new Promise((resolve, reject) => { rejectGoto = reject; }),
            stop: () => { stopped++; rejectGoto?.(new Error('PathStopped')); },
        },
    });
    const mode = __modeForTest('unstuck');
    mode.free_timeout_ms = 60;
    mode.prev_location = position.clone();
    mode.stuck_time = mode.max_stuck_time + 1;
    mode.last_time = Date.now();

    const started = Date.now();
    await mode.update(agent);
    while (mode.active || Date.now() - started < 20) await new Promise(r => setTimeout(r, 10));

    assert.ok(Date.now() - started >= 60, 'the bounded attempt ran to its timeout');
    assert.deepEqual(agent.calls.cleanKill, []);
    assert.equal(stopped, 1);
    assert.ok(warnings.includes('[reflex] unstuck: still stuck after 0.06 s; re-planning instead of a restart.'));
    assert.match(takeReplanNote(agent), /^Reflexes \(unstuck\) interrupted 'action:collectBlocks'/);
    // And no kill shows up later either (upstream's 10 s timer).
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(agent.calls.cleanKill, []);
});

test('the self-prompter holds while a reflex runs and carries the re-plan note', async (t) => {
    t.mock.method(console, 'log', () => {});
    let reflex = true;
    const prompts = [];
    const agent = { bot: { modes: { anyActive: () => reflex } } };
    const sp = new SelfPrompter(agent);
    sp.prompt = 'get stone tools';
    sp.state = 1; // ACTIVE
    agent.handleMessage = (source, msg) => {
        prompts.push(msg);
        sp.interrupt = true; // end the loop after this prompt
        return Promise.resolve(true);
    };
    requestReplan(agent, 'self_defense', 'action:collectBlocks', quiet);

    const loop = sp.startLoop();
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(prompts, [], 'no prompt while the reflex runs');
    reflex = false;
    await loop;
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /^Reflexes \(self_defense\) interrupted 'action:collectBlocks'\. Check your state and re-plan from here\. You are self-prompting with the goal: 'get stone tools'/);
});

test('a self-prompt reply that lands during a reflex is dropped and not counted as "no command"', (t) => {
    t.mock.method(console, 'log', () => {});
    let reflex = true;
    const agent = { bot: { modes: { anyActive: () => reflex } } };
    const sp = new SelfPrompter(agent);
    sp.state = 1; // ACTIVE
    sp.loop_active = true;
    assert.equal(sp.shouldInterrupt(true), true);
    assert.equal(sp.dropped_for_reflex, true);
    assert.equal(sp.shouldInterrupt(false), false, 'player messages are not dropped');
    reflex = false;
    sp.dropped_for_reflex = false;
    assert.equal(sp.shouldInterrupt(true), false);
});

function pathBot({ status = 'success', distance = 5 } = {}) {
    const calls = [];
    return {
        calls,
        registry: minecraftData('1.12.2'),
        version: '1.12.2',
        entity: { position: new Vec3(0, 64, 0) },
        pathfinder: {
            getPathFromTo: function* (movements, start, goal, options) {
                calls.push(options);
                yield { result: { status, path: [] } };
            },
        },
        target: { position: new Vec3(distance, 64, 0) },
    };
}

test('isClearPath is bounded: distance gate, search radius and time', async () => {
    assert.deepEqual(CLEAR_PATH_LIMITS, { maxDistance: 20, searchRadius: 24, timeoutMs: 50 });
    const near = pathBot({ distance: 5 });
    assert.equal(await isClearPath(near, near.target), true);
    assert.deepEqual(near.calls, [{ timeout: 50, tickTimeout: 50, searchRadius: 24 }]);

    const far = pathBot({ distance: 21 });
    assert.equal(await isClearPath(far, far.target), false);
    assert.deepEqual(far.calls, [], 'no A* search for a target beyond maxDistance');

    const partial = pathBot({ status: 'partial' });
    assert.equal(await isClearPath(partial, partial.target), false);
    assert.equal(await isClearPath(near, { position: null }), false);
});

test('unstuck: a fast no-path failure says so (not "after 10 s") and still never cleanKills', async (t) => {
    const warnings = [];
    t.mock.method(console, 'warn', (...a) => warnings.push(a.join(' ')));
    t.mock.method(console, 'log', () => {});
    const agent = fakeAgent();
    agent.isIdle = () => false;
    initModes(agent);
    let stopped = 0;
    const position = new Vec3(10, 64, 10);
    Object.assign(agent.bot, {
        registry: minecraftData('1.12.2'),
        version: '1.12.2',
        output: '',
        entity: { position },
        targetDigBlock: null,
        pathfinder: {
            setMovements() {},
            getPathTo: () => ({ status: 'noPath', path: [] }),
            goto: () => Promise.reject(new Error('NoPath')),
            stop: () => { stopped++; },
        },
    });
    const mode = __modeForTest('unstuck');
    mode.free_timeout_ms = 5_000;
    mode.prev_location = position.clone();
    mode.stuck_time = mode.max_stuck_time + 1;
    mode.last_time = Date.now();

    const started = Date.now();
    await mode.update(agent);
    while (mode.active || Date.now() - started < 20) await new Promise(r => setTimeout(r, 10));

    assert.ok(Date.now() - started < 1_000, 'it did not wait for the 5 s timeout');
    assert.ok(warnings.includes('[reflex] unstuck: could not move away (no path); re-planning instead of a restart.'));
    assert.ok(!warnings.some(w => w.includes('still stuck after')));
    assert.equal(stopped, 1);
    assert.deepEqual(agent.calls.cleanKill, []);
});
