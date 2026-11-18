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
import { FALLING_TREE, FELL_HOLD_MS, FALLING_SEEN_MAX_MS, fallingTreeNear } from './library/felling.js';

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
    assert.ok(warnings.includes('[reflex] unstuck: could not move away (Error: NoPath); re-planning instead of a restart.'));
    assert.ok(!warnings.some(w => w.includes('still stuck after')));
    assert.equal(stopped, 1);
    assert.deepEqual(agent.calls.cleanKill, []);
});

test('unstuck: any other early rejection is logged with its own reason, not as "no path" (#126 review)', async (t) => {
    const warnings = [];
    t.mock.method(console, 'warn', (...a) => warnings.push(a.join(' ')));
    t.mock.method(console, 'log', () => {});
    const agent = fakeAgent();
    agent.isIdle = () => false;
    initModes(agent);
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
            goto: () => Promise.reject(new Error('GoalChanged: The goal was changed before it could be completed!')),
            stop() {},
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

    assert.ok(warnings.includes('[reflex] unstuck: could not move away (Error: GoalChanged: The goal was changed before it could be completed!); re-planning instead of a restart.'));
    assert.ok(!warnings.some(w => w.includes('no path')));
    assert.deepEqual(agent.calls.cleanKill, []);
});

// G3 round 10 A: the bot stood still while a tree it had cut fell; unstuck (20 s in one place)
// walked it 5 blocks, into the fall, and it was crushed 4 s later. While a tree falls near the bot,
// or within FELL_HOLD_MS of its own cut, unstuck holds still: no move at all.
test('round 10 A: unstuck never moves the bot while a tree falls near it or just after its own cut', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const position = new Vec3(-78, 63, -89);
    const setup = (extra) => {
        const agent = fakeAgent();
        agent.isIdle = () => false;
        initModes(agent);
        agent.bot.modes.setOn('cheat', false);
        const gotos = [];
        Object.assign(agent.bot, {
            registry: minecraftData('1.12.2'), version: '1.12.2', output: '',
            entity: { position: position.clone() }, entities: {}, targetDigBlock: null,
            pathfinder: { setMovements() {}, getPathTo: () => ({ status: 'success', path: [] }), goto: (g) => { gotos.push(g); return Promise.resolve(); }, stop() {} },
        }, extra);
        const mode = __modeForTest('unstuck');
        mode.prev_location = position.clone();
        mode.stuck_time = mode.max_stuck_time + 1; // 20 s in one place, as at 19:24:23
        mode.last_time = Date.now();
        return { agent, mode, gotos };
    };
    const cases = {
        'a falling tree 6 blocks east': { entities: { 7: { id: 7, name: FALLING_TREE, position: position.offset(6, 2, 0) } } },
        'its own cut 5 s ago (the entity not seen)': { rotnLastFell: { at: Date.now() - 5000, pos: position.offset(-2, 0, 1) } },
    };
    for (const [name, extra] of Object.entries(cases)) {
        const { agent, mode, gotos } = setup(extra);
        await mode.update(agent);
        await new Promise(r => setTimeout(r, 20));
        assert.equal(mode.active, false, `${name}: unstuck did not start`);
        assert.equal(gotos.length, 0, `${name}: no move`);
        assert.equal(mode.stuck_time, 0, `${name}: the stuck time starts again`);
    }
    // Control: the cut long ago and no tree in the air: unstuck moves as before.
    const { agent, mode, gotos } = setup({ rotnLastFell: { at: Date.now() - FELL_HOLD_MS - 1000, pos: position } });
    await mode.update(agent);
    const started = Date.now();
    while (mode.active && Date.now() - started < 2000) await new Promise(r => setTimeout(r, 10));
    assert.equal(gotos.length, 1, 'unstuck moved away');
});

// #356 review 2: a falling tree entity in sight held unstuck with no time limit (a missed destroy
// packet, someone else's tree that never lands).
test('#356 review 2: a falling tree entity seen for FALLING_SEEN_MAX_MS no longer holds unstuck; a new one does', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    assert.equal(FALLING_SEEN_MAX_MS, 60_000);
    const here = new Vec3(0, 64, 0);
    const bot = { entity: { position: here }, entities: { 7: { id: 7, name: FALLING_TREE, position: here.offset(5, 2, 0) } } };
    assert.ok(fallingTreeNear(bot, { now: 1000 }), 'first seen: held');
    assert.ok(fallingTreeNear(bot, { now: 1000 + FALLING_SEEN_MAX_MS - 1 }), 'still within the cap');
    assert.equal(fallingTreeNear(bot, { now: 1000 + FALLING_SEEN_MAX_MS }), null, 'seen too long: ignored');
    bot.entities[8] = { id: 8, name: FALLING_TREE, position: here.offset(-4, 2, 0) };
    assert.ok(fallingTreeNear(bot, { now: 1000 + FALLING_SEEN_MAX_MS + 1 }), 'another tree falls: held again');
    // Gone and back (a new entity with the same id after a respawn): seen afresh.
    delete bot.entities[7]; delete bot.entities[8];
    assert.equal(fallingTreeNear(bot, { now: 2 * FALLING_SEEN_MAX_MS }), null);
    bot.entities[7] = { id: 7, name: FALLING_TREE, position: here.offset(5, 2, 0) };
    assert.ok(fallingTreeNear(bot, { now: 2 * FALLING_SEEN_MAX_MS + 1 }));

    // In the reflex: an entity in sight since more than the cap, the bot stuck 20 s: unstuck moves.
    const position = new Vec3(-78, 63, -89);
    const agent = fakeAgent();
    agent.isIdle = () => false;
    initModes(agent);
    agent.bot.modes.setOn('cheat', false);
    const gotos = [];
    Object.assign(agent.bot, {
        registry: minecraftData('1.12.2'), version: '1.12.2', output: '',
        entity: { position: position.clone() }, targetDigBlock: null,
        entities: { 9: { id: 9, name: FALLING_TREE, position: position.offset(6, 2, 0) } },
        pathfinder: { setMovements() {}, getPathTo: () => ({ status: 'success', path: [] }), goto: (g) => { gotos.push(g); return Promise.resolve(); }, stop() {} },
    });
    fallingTreeNear(agent.bot, { now: Date.now() - FALLING_SEEN_MAX_MS - 1000 }); // first seen over a minute ago
    const mode = __modeForTest('unstuck');
    mode.prev_location = position.clone();
    mode.stuck_time = mode.max_stuck_time + 1;
    mode.last_time = Date.now();
    await mode.update(agent);
    const started = Date.now();
    while (mode.active && Date.now() - started < 2000) await new Promise(r => setTimeout(r, 10));
    assert.equal(gotos.length, 1, 'unstuck moved away');
});

// Soak 2 (rotn-v0.1.4, night 2): unstuck moved the bot off its hole shelter every ~22 s while it dug
// a slow block, and stopped a hunt 6 times. Lead's rule: unstuck never moves the bot while the
// action makes progress (a block broken or placed, a dig within 2 x its time, the target closer).
test('soak 2: unstuck never moves the bot while the action makes progress; with none it still does', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const position = new Vec3(-42, 67, -53);
    const setup = (extra = {}, memo = {}) => {
        const agent = fakeAgent();
        agent.isIdle = () => false;
        initModes(agent);
        agent.bot.modes.setOn('cheat', false);
        const gotos = [];
        Object.assign(agent.bot, {
            registry: minecraftData('1.12.2'), version: '1.12.2', output: '',
            entity: { position: position.clone() }, entities: {}, targetDigBlock: null,
            pathfinder: { setMovements() {}, getPathTo: () => ({ status: 'success', path: [] }), goto: (g) => { gotos.push(g); return Promise.resolve(); }, stop() {} },
        }, extra);
        const mode = __modeForTest('unstuck');
        mode.prev_location = position.clone();
        mode.stuck_time = mode.max_stuck_time + 1; // 20 s in one place
        mode.last_time = Date.now();
        mode.progress_memo = memo;
        mode.prev_dig_block = null; // a case before may have left its dig here
        return { agent, mode, gotos };
    };
    const run = async ({ agent, mode, gotos }) => {
        await mode.update(agent);
        for (let i = 0; i < 100 && (mode.active || i < 2); i++) await new Promise(r => setTimeout(r, 10)); // let a started move finish
        return { moved: gotos.length > 0, mode };
    };
    const dirt = { name: 'dynamictrees:rootydirt', position: position.offset(0, -1, 0) };
    // A block broken or placed since the last tick.
    let r = await run(setup({ rotnProgressAt: Date.now() }, { progressSeen: Date.now() - 1000 }));
    assert.equal(r.moved, false, 'a block broken or placed: no move');
    assert.equal(r.mode.stuck_time, 0);
    // A slow dig (30 s by hand): its start is only recorded (#431 review 1); on the next tick, and
    // 50 s in (within 2 x 30 s), it is progress.
    const memo = {};
    const started = setup({ targetDigBlock: dirt, digTime: () => 30_000 }, memo);
    started.mode.stuck_time = 0; // the dig starts after a moment in place
    r = await run(started);
    assert.ok(memo.digs.has('-42,66,-53'), 'the start is recorded');
    r = await run(setup({ targetDigBlock: dirt, digTime: () => 30_000 }, memo));
    assert.equal(r.moved, false, 'the same dig on the next tick: no move');
    const key = '-42,66,-53';
    r = await run(setup({ targetDigBlock: dirt, digTime: () => 30_000 }, { digs: new Map([[key, { since: Date.now() - 50_000, at: Date.now() - 1000, allowMs: 60_000 }]]) }));
    assert.equal(r.moved, false, 'a dig within twice its time: no move');
    // The fight's target getting closer.
    const sow = { id: 9, position: position.offset(4, 0, 0) };
    r = await run(setup({ pvp: { target: sow } }, { targetKey: 'pvp:9', targetBest: 8 }));
    assert.equal(r.moved, false, 'the target is closer than before: no move');
    // No progress: the dig past twice its time, the target no closer: it moves the bot, as before.
    r = await run(setup({ targetDigBlock: dirt, digTime: () => 30_000 }, { digs: new Map([[key, { since: Date.now() - 61_000, at: Date.now() - 1000, allowMs: 60_000 }]]) }));
    assert.equal(r.moved, true, 'a dig past twice its time: stuck');
    r = await run(setup({ pvp: { target: sow } }, { targetKey: 'pvp:9', targetBest: 4 }));
    assert.equal(r.moved, true, 'the target no closer: stuck');
});

test('soak 2: installProgress stamps a block broken (diggingCompleted) or placed by the bot', async () => {
    const { installProgress } = await import('./library/progress.js');
    const { EventEmitter } = await import('node:events');
    const bot = new EventEmitter();
    bot.placeBlock = () => Promise.resolve('placed');
    assert.equal(installProgress(bot), true);
    assert.equal(installProgress(bot), false, 'once');
    assert.equal(bot.rotnProgressAt, undefined);
    bot.emit('diggingCompleted', {});
    const dug = bot.rotnProgressAt;
    assert.ok(dug > 0);
    await new Promise(r => setTimeout(r, 5));
    assert.equal(await bot.placeBlock({}, {}), 'placed');
    assert.ok(bot.rotnProgressAt > dug);
});

test('#431 review 1 (owed): a dig that stops and restarts at one position has one allowance across short gaps', async () => {
    const { actionProgress, PROGRESS } = await import('./library/progress.js');
    const block = (x) => ({ name: 'dirt', position: new Vec3(x, 63, 1) });
    const [a, b] = [block(1), block(2)];
    const bot = { digTime: () => 1000, entity: { position: new Vec3(1, 64, 1) }, targetDigBlock: null, rotnProgressAt: 0 };
    let memo = {};
    const tick = (ms, dig) => { bot.targetDigBlock = dig; return actionProgress(bot, memo, ms); };
    // The allowance of a: max(5000, 2 x 1000) from 1000.
    assert.equal(tick(1000, a), null, 'its start is only recorded');
    assert.equal(tick(2000, a), 'a dig underway');
    assert.equal(tick(3000, null), null, 'a gap');
    assert.equal(tick(4000, a), 'a dig underway', 'the same allowance after the gap');
    assert.equal(tick(5500, null), null);
    assert.equal(tick(6000, a), 'a dig underway', 'still within it');
    assert.equal(tick(6500, null), null);
    assert.equal(tick(7000, a), null, 'spent: restarting did not renew it');
    assert.equal(tick(8000, a), null);
    // Two positions in turn: each has its own one allowance, neither renews the other.
    assert.equal(tick(8500, b), null, 'b starts');
    assert.equal(tick(9000, a), null, 'a is still spent');
    assert.equal(tick(9500, b), 'a dig underway');
    assert.equal(tick(14000, b), null, 'b is spent too');
    // Not seen for digForgetMs: a new dig there.
    const later = 14000 + PROGRESS.digForgetMs + 1;
    assert.equal(tick(later, a), null, 'recorded anew');
    assert.equal(tick(later + 1000, a), 'a dig underway');
    // A block really broken renews it.
    memo = {};
    assert.equal(tick(1000, a), null);
    bot.rotnProgressAt = 1500;
    assert.equal(tick(2000, a), 'a block broken or placed');
    assert.equal(tick(7500, a), null, 'recorded anew, not spent');
    assert.equal(tick(8000, a), 'a dig underway');
});

test('#431 review 1: a retry loop that starts over in place (a new goal or a new dig each time, no closer) is still freed by unstuck', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const { GoalNear } = (await import('mineflayer-pathfinder')).default.goals;
    const position = new Vec3(5, 64, 5);
    const setup = (extra, memo) => {
        const agent = fakeAgent();
        agent.isIdle = () => false;
        initModes(agent);
        agent.bot.modes.setOn('cheat', false);
        const gotos = [];
        Object.assign(agent.bot, {
            registry: minecraftData('1.12.2'), version: '1.12.2', output: '',
            entity: { position: position.clone() }, entities: {}, targetDigBlock: null,
            pathfinder: { setMovements() {}, getPathTo: () => ({ status: 'success', path: [] }), goto: (g) => { gotos.push(g); return Promise.resolve(); }, stop() {} },
        });
        Object.assign(agent.bot.pathfinder, extra.pathfinder ?? {});
        if (extra.targetDigBlock) agent.bot.targetDigBlock = extra.targetDigBlock;
        const mode = __modeForTest('unstuck');
        Object.assign(mode, { prev_location: position.clone(), stuck_time: mode.max_stuck_time + 1, last_time: Date.now(), progress_memo: memo, prev_dig_block: null });
        return { agent, mode, gotos };
    };
    const run = async (s) => { await s.mode.update(s.agent); for (let i = 0; i < 100 && (s.mode.active || i < 2); i++) await new Promise(r => setTimeout(r, 10)); return s.gotos.length > 0; };
    // A command retrying its walk: a new goal object each time, never closer.
    const memo = { targetKey: new GoalNear(30, 64, 5, 1), targetBest: 25 };
    assert.equal(await run(setup({ pathfinder: { goal: new GoalNear(30, 64, 5, 1) } }, memo)), true, 'a new goal is no progress: freed');
    // A dig that keeps starting over on new blocks it never finishes.
    const memo2 = { digs: new Map([['5,63,5', { since: Date.now(), at: Date.now(), allowMs: 60_000 }]]) };
    assert.equal(await run(setup({ targetDigBlock: { name: 'dirt', position: new Vec3(6, 63, 5) } }, memo2)), true, 'a new dig is no progress: freed');
});

test('#431 review 2 and 7: a reflex that stops an action records who stopped which (agent.rotnLastInterrupt)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const agent = fakeAgent();
    agent.actions.currentActionLabel = 'action:digPit';
    await execute({ name: 'unstuck', active: false }, agent, () => Promise.resolve());
    assert.equal(agent.rotnLastInterrupt.by, 'unstuck');
    assert.equal(agent.rotnLastInterrupt.of, 'action:digPit');
    agent.actions.currentActionLabel = '';
    await execute({ name: 'self_defense', active: false }, agent, () => Promise.resolve());
    assert.equal(agent.rotnLastInterrupt.by, 'unstuck', 'nothing was stopped: unchanged');
});
