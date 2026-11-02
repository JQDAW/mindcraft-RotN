// Offline tests for skills-rotn A2b: Mindcraft task files (op commands such as
// /give, /tp, /clear) are refused unless the test-only opt-in env var is set.
// Fake agent; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALLOW_TASK_FILES_ENV, taskFilesAllowed } from './task_guard.js';
import { Task } from './tasks.js';

// A cooking task file entry, shaped like Mindcraft's benchmark tasks.
const TASK = {
    task_id: 'multiagent_cooking_1_bread',
    type: 'cooking',
    goal: 'Make bread',
    conversation: 'Let us make bread',
    agent_count: 1,
    human_count: 0,
    initial_inventory: { 0: { wheat: 3 } },
    blocked_actions: { 0: ['!craftRecipe'] },
    timeout: 300,
};

class Sentinel extends Error {}
function fakeAgent() {
    const chats = [];
    return {
        name: 'FRCFLD',
        count_id: 0,
        chats,
        bot: { chat(msg) { chats.push(msg); throw new Sentinel('stop after the first command'); } },
    };
}

test('the opt-in is off by default and only exactly "1" turns it on', () => {
    assert.equal(ALLOW_TASK_FILES_ENV, 'MINDCRAFT_ROTN_ALLOW_TASK_FILES');
    assert.equal(taskFilesAllowed({}), false);
    assert.equal(taskFilesAllowed(undefined), false);
    for (const v of ['0', 'true', 'yes', ' 1', '']) assert.equal(taskFilesAllowed({ [ALLOW_TASK_FILES_ENV]: v }), false, v);
    assert.equal(taskFilesAllowed({ [ALLOW_TASK_FILES_ENV]: '1' }), true);
});

test('this test process does not have the opt-in set', () => {
    assert.equal(taskFilesAllowed(), false);
});

test('a task file is refused by default: no data, no goal, no blocked actions, a log line', async (t) => {
    const warnings = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
    t.mock.method(console, 'log', () => {});
    const agent = fakeAgent();

    const task = new Task(agent, TASK); // the default reads the real environment

    assert.equal(task.data, null);
    assert.equal(task.validator, null);
    assert.deepEqual(task.blocked_actions, []);
    assert.equal(task.goal, undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^\[tasks\] Refused to load task multiagent_cooking_1_bread: Mindcraft task files send op commands/);
    assert.match(warnings[0], /MINDCRAFT_ROTN_ALLOW_TASK_FILES=1 only on a disposable test server/);

    // initBotTask sends nothing, not even its /clear.
    await task.initBotTask();
    assert.deepEqual(agent.chats, []);
});

test('control: with the opt-in, the task loads and initBotTask starts with /clear', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const agent = fakeAgent();

    const task = new Task(agent, TASK, null, { allowTaskFiles: true });

    assert.equal(task.data, TASK);
    assert.deepEqual(task.blocked_actions, ['!craftRecipe', '!endGoal', '!endConversation']);
    await assert.rejects(task.initBotTask(), Sentinel);
    assert.deepEqual(agent.chats, ['/clear FRCFLD']);
});

test('no task file: nothing is refused and nothing is sent', async (t) => {
    const warnings = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
    t.mock.method(console, 'log', () => {});
    const agent = fakeAgent();
    const task = new Task(agent, null);
    assert.equal(task.data, null);
    assert.deepEqual(warnings, []);
    await task.initBotTask();
    assert.deepEqual(agent.chats, []);
});

test('agent.js starts a task only when one was loaded, not on settings.task alone', () => {
    const source = readFileSync(new URL('../agent.js', import.meta.url), 'utf8');
    assert.ok(!/if \(settings\.task\)/.test(source), 'agent.js still branches on settings.task');
    // The two task-start sites; checkTaskDone has its own older this.task.data check.
    assert.equal(source.match(/if \(this\.task\.data\) \{ \/\/ a loaded task; a refused task file is null/g)?.length, 2);
});
