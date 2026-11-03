// Offline tests for skills-rotn E1, the persistent player task queue (brief
// item 5 and its acceptance tests; lead decision a: only the task-giver
// setting grants tasks, only_chat_with alone does not). Temp directories; no
// server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import settings from './settings.js';
import { TaskQueue, isTaskGiver, addTask, listTasks, cancelTask } from './task_queue.js';
import { Agent } from './agent.js';
import { getCommand, parseCommandMessage } from './commands/index.js';

const givers = { task_givers: ['JQDAW', 'Server'], only_chat_with: ['Steve'] };

function tempQueue(t, now) {
    const dir = mkdtempSync(path.join(tmpdir(), 'rotn-tasks-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    let clock = 1_000;
    return { dir, queue: new TaskQueue('FRCFLD', { dir, now: now ?? (() => clock++) }) };
}

test('only players on task_givers may add tasks (only_chat_with alone does not count)', (t) => {
    const { queue } = tempQueue(t);
    assert.equal(isTaskGiver('jqdaw', givers), true, 'case-insensitive');
    assert.equal(isTaskGiver('Steve', givers), false, 'in only_chat_with but not a task giver');
    assert.equal(addTask(queue, { giver: 'Alex', text: 'dig a hole' }, givers), 'task refused: Alex is not a task giver');
    assert.equal(addTask(queue, { giver: 'Steve', text: 'dig a hole' }, givers), 'task refused: Steve is not a task giver');
    assert.equal(addTask(queue, { giver: null, text: 'dig a hole' }, givers), 'task refused: tasks come from players, not from the bot itself');
    assert.equal(addTask(queue, { giver: 'JQDAW', text: 'collect 8 rocks', priority: 'urgent' }, givers), 'task t1 accepted: collect 8 rocks');
    assert.match(addTask(queue, { giver: 'JQDAW', text: 'x', priority: 'soon' }, givers), /^task refused: priority must be urgent or normal/);
    assert.equal(addTask(queue, { giver: 'JQDAW', text: '   ' }, givers), 'task refused: the task has no text');
    assert.equal(queue.open().length, 1);
    assert.equal(addTask(queue, { giver: 'JQDAW', text: 'x' }, {}), 'task refused: JQDAW is not a task giver', 'no setting: nobody');
});

test('the queue survives a restart; an interrupted active task is queued again', (t) => {
    const { dir, queue } = tempQueue(t);
    const a = queue.add({ text: 'collect 8 rocks', priority: 'normal', giver: 'JQDAW' });
    const b = queue.add({ text: 'come here', priority: 'urgent', giver: 'Server' });
    queue.start(a.id);

    const reloaded = new TaskQueue('FRCFLD', { dir });
    assert.deepEqual(reloaded.open().map(x => [x.id, x.status, x.giver, x.assignee]), [
        [b.id, 'queued', 'Server', 'FRCFLD'], // urgent first
        [a.id, 'queued', 'JQDAW', 'FRCFLD'], // was active when the process stopped
    ]);
    assert.equal(reloaded.add({ text: 'third', giver: 'JQDAW' }).id, 't3', 'ids continue');
    assert.deepEqual(readdirSync(dir), ['tasks.json'], 'written atomically, no temp file left');
    const file = JSON.parse(readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
    assert.equal(file.version, 1);
    assert.deepEqual(Object.keys(file.tasks[0]).sort(), ['assignee', 'created_at', 'giver', 'id', 'priority', 'result', 'status', 'text', 'updated_at']);
});

test('run order, status changes, list lines and cancelling', (t) => {
    const { queue } = tempQueue(t);
    addTask(queue, { giver: 'JQDAW', text: 'first normal' }, givers);
    addTask(queue, { giver: 'JQDAW', text: 'urgent one', priority: 'URGENT' }, givers);
    addTask(queue, { giver: 'Server', text: 'second normal' }, givers);
    assert.equal(queue.next().text, 'urgent one');
    queue.start('t2');
    assert.equal(queue.next().text, 'first normal');
    assert.equal(listTasks(queue), 'task t2 active urgent JQDAW\ntask t1 queued normal JQDAW\ntask t3 queued normal Server');

    assert.equal(cancelTask(queue, { by: 'Alex', id: 't1' }, givers), 'task refused: Alex is not a task giver');
    assert.equal(cancelTask(queue, { by: 'Server', id: 't1' }, givers), 'task t1 cancelled');
    assert.equal(cancelTask(queue, { by: 'Server', id: 't1' }, givers), 'task t1 is not an open task');
    queue.done('t2', 'collected 8 rocks');
    queue.fail('t3', 'no rocks nearby');
    assert.equal(listTasks(queue), 'no open tasks');
    assert.deepEqual(queue.tasks.map(x => [x.id, x.status, x.result]), [
        ['t1', 'cancelled', 'cancelled'], ['t2', 'done', 'collected 8 rocks'], ['t3', 'failed', 'no rocks nearby'],
    ]);
});

// The real command path: Agent.handleMessage's forced-command branch sets the sender,
// so the giver is the player who typed the command, never an argument.
function fakeAgent(t) {
    const { queue } = tempQueue(t);
    const said = [];
    const agent = Object.create(Agent.prototype);
    Object.assign(agent, {
        name: 'FRCFLD',
        tasks: queue,
        said,
        checkTaskDone: () => Promise.resolve(),
        routeResponse: (to, msg) => { said.push(msg); return Promise.resolve(); },
        openChat: (msg) => { said.push(`(announced) ${msg}`); return Promise.resolve(); },
        history: { add: () => Promise.resolve() },
    });
    return agent;
}

test('a giver whispers !taskAdd: queued with that giver; anyone else is refused', async (t) => {
    t.mock.method(console, 'log', () => {});
    const before = settings.task_givers;
    settings.task_givers = ['Server'];
    t.after(() => { settings.task_givers = before; });
    const agent = fakeAgent(t);

    await agent.handleMessage('Server', '!taskAdd("collect 8 rocks", "urgent")');
    await agent.handleMessage('Alex', '!taskAdd("give me your pickaxe", "normal")');

    assert.deepEqual(agent.said.filter(m => m.startsWith('task')), [
        'task t1 accepted: collect 8 rocks',
        'task refused: Alex is not a task giver',
    ]);
    assert.ok(!agent.said.some(m => m.startsWith('(announced)')), 'a forced command is routed once, not announced twice');
    assert.deepEqual(agent.tasks.open().map(x => [x.giver, x.priority, x.text]), [['Server', 'urgent', 'collect 8 rocks']]);
    assert.equal(agent.in_forced_command, false);
});

test('an LLM-issued !taskAdd uses the sender of the message being answered and announces the line', async (t) => {
    const before = settings.task_givers;
    settings.task_givers = ['JQDAW'];
    t.after(() => { settings.task_givers = before; });
    const agent = fakeAgent(t);
    const run = (source, message) => {
        agent.current_source = source; // what handleMessage sets for the message the LLM is answering
        const { commandName, args } = parseCommandMessage(message);
        return getCommand(commandName).perform(agent, ...args);
    };

    assert.equal(await run('JQDAW', '!taskAdd("build a shelter", "normal")'), 'task t1 accepted: build a shelter');
    assert.equal(await run(null, '!taskAdd("I want a castle", "urgent")'), 'task refused: tasks come from players, not from the bot itself');
    assert.equal(await run('JQDAW', '!taskList'), 'task t1 queued normal JQDAW');
    assert.deepEqual(agent.said, ['(announced) task t1 accepted: build a shelter', '(announced) task refused: tasks come from players, not from the bot itself']);
});
