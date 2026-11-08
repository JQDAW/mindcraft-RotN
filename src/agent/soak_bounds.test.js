// G4 #7 (the 2-hour soak, MemoryHigh=1G, MemoryMax=1536M): nothing in the agent may grow without
// bound over hours of play. The two growths the audit found are capped (the behavior log between
// LLM messages, finished tasks), and respawning leaves the listener count flat. Offline: a fake
// mineflayer bot (an EventEmitter) with the agent's real binders; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { __setRegistryForTest } from '../utils/mcdata.js';
import { Agent } from './agent.js';
import { __sayForTest, BEHAVIOR_LOG_MAX } from './modes.js';
import { TaskQueue, FINISHED_KEPT } from './task_queue.js';
import { installChatLimit } from './chat_limit.js';
import { guardInventory } from './library/inventory_sync.js';
import { mayRepeat, handedToChat } from './chat_repeat.js';

__setRegistryForTest(minecraftData('1.12.2'));
const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };

test('G4 #7: the behavior log kept between two LLM messages is capped at BEHAVIOR_LOG_MAX; the newest lines stay', async () => {
    const agent = { shut_up: true, bot: { modes: { behavior_log: '' } } };
    // Two hours of reflex lines with no LLM message (a hold, the night shelter, nothing to do).
    for (let i = 0; i < 5000; i++) await __sayForTest(agent, `Picking up item! (${i})`);
    const log = agent.bot.modes.behavior_log;
    assert.ok(log.length <= BEHAVIOR_LOG_MAX, `${log.length} chars`);
    assert.ok(log.endsWith('Picking up item! (4999)\n'), 'the newest line is kept');
    assert.ok(BEHAVIOR_LOG_MAX >= 500, 'at least what handleMessage reads (its last 500 chars)');
});

test('G4 #7: finished tasks are capped at FINISHED_KEPT (the newest), open tasks are never dropped, ids never reused', (t) => {
    quiet(t);
    const dir = mkdtempSync(path.join(tmpdir(), 'soak-tasks-'));
    let clock = 0;
    const q = new TaskQueue('FRCFLD', { dir, now: () => ++clock });
    const open = [q.add({ text: 'keep me', giver: 'JQDAW' }), q.add({ text: 'me too', giver: 'JQDAW' })];
    for (let i = 0; i < 300; i++) {
        const task = q.add({ text: `task ${i}`, giver: 'JQDAW' });
        q.start(task.id);
        if (i % 3 === 0) q.fail(task.id, 'no'); else q.done(task.id);
    }
    assert.equal(q.tasks.length, FINISHED_KEPT + open.length);
    for (const o of open) assert.equal(q.get(o.id)?.status, 'queued', `${o.id} kept`);
    assert.ok(q.get('t302'), 'the newest finished task kept');
    assert.equal(q.get('t3'), null, 'the oldest finished ones dropped');
    const saved = JSON.parse(readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
    assert.equal(saved.tasks.length, FINISHED_KEPT + open.length, 'the file too');
    assert.equal(q.add({ text: 'next', giver: 'JQDAW' }).id, 't303', 'ids go on');

    // A tasks.json from before the cap (every task ever given) is pruned at load; nextId is kept.
    const old = mkdtempSync(path.join(tmpdir(), 'soak-tasks-'));
    const tasks = Array.from({ length: 400 }, (_, i) => ({ id: `t${i + 1}`, text: `x${i}`, priority: 'normal', giver: 'JQDAW', assignee: 'FRCFLD',
        status: i >= 398 ? 'queued' : 'done', result: null, created_at: i, updated_at: i }));
    writeFileSync(path.join(old, 'tasks.json'), JSON.stringify({ version: 1, nextId: 401, tasks }));
    const loaded = new TaskQueue('FRCFLD', { dir: old });
    assert.equal(loaded.tasks.length, FINISHED_KEPT + 2);
    assert.deepEqual(loaded.open().map(t => t.id).sort(), ['t399', 't400']);
    assert.equal(JSON.parse(readFileSync(path.join(old, 'tasks.json'), 'utf8')).tasks.length, FINISHED_KEPT + 2, 'saved pruned');
    assert.equal(loaded.add({ text: 'y', giver: 'JQDAW' }).id, 't401');
});

/** A mineflayer-like bot: an EventEmitter with the fields the binders and their handlers touch. */
function fakeBot() {
    const bot = new EventEmitter();
    bot.setMaxListeners(0);
    const client = new EventEmitter();
    client.setMaxListeners(0);
    client.chat = () => {};
    Object.assign(bot, {
        _client: client, username: 'FRCFLD', version: '1.12.2', registry: minecraftData('1.12.2'),
        entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, health: 20, food: 20, isAlive: true,
        game: { dimension: 'overworld' }, time: { timeOfDay: 1000 }, experience: { level: 0 },
        inventory: { items: () => [], slots: new Array(46).fill(null) }, heldItem: null, quickBarSlot: 0,
        pathfinder: { setMovements() {}, stop() {}, movements: null },
        modes: { behavior_log: '', unPauseAll() {} },
        clearControlStates() {}, respawn() {}, chat() {}, whisper() {},
        equip: () => Promise.resolve(), unequip: () => Promise.resolve(), toss: () => Promise.resolve(),
        tossStack: () => Promise.resolve(), craft: () => Promise.resolve(), moveSlotItem: () => Promise.resolve(),
    });
    return bot;
}
const listeners = (emitter) => emitter.eventNames().reduce((n, e) => n + emitter.listenerCount(e), 0);

test('G4 #7: dying and respawning N times (and logging in again) leaves the bot\'s and client\'s listener counts flat', (t) => {
    quiet(t);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); // the update loop and death timers never run here
    const bot = fakeBot();
    // The agent's real binders, as Agent.start and startEvents call them.
    installChatLimit(bot);
    guardInventory(bot);
    const agent = Object.assign(Object.create(Agent.prototype), {
        name: 'FRCFLD', bot, shut_up: true, openChat() {},
        actions: { currentActionLabel: '', executing: false, cancelResume() {}, stop: () => Promise.resolve(), resumeAction() {} },
        npc: { init() {} }, memory_bank: { rememberPlace() {} },
    });
    agent.startEvents();
    agent.bindLoginHandler();
    agent.onLogin = () => {}; // no mindserver here
    mayRepeat(agent, 'hello'); handedToChat(agent, 'hello'); // the chat repeat limiter's one listener
    const cycle = () => {
        bot.health = 0; bot.isAlive = false;
        bot.emit('health');
        bot.emit('death');
        bot.emit('respawn');
        bot.isAlive = true; bot.health = 20;
        bot.emit('spawn');
        bot.emit('health');
        bot.emit('physicsTick');
        bot.emit('forcedMove');
        bot.emit('login'); // a login wraps the chat limit and the inventory guard again
        mayRepeat(agent, 'I\'m dying!'); handedToChat(agent, 'I\'m dying!');
    };
    cycle();
    const after1 = { bot: listeners(bot), client: listeners(bot._client) };
    for (let i = 0; i < 100; i++) cycle();
    assert.deepEqual({ bot: listeners(bot), client: listeners(bot._client) }, after1, 'no listener added per death, respawn or login');
    assert.ok(after1.bot > 10, `the agent's listeners are really installed (${after1.bot})`);
    t.mock.timers.reset();
});
