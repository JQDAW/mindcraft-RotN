// Offline tests for skills-rotn E2, the RotN agenda: steps judged from the bot's
// state (no LLM), persistence across a restart, and the driver that points the
// self-prompter at the current step. Fake bot, fake self-prompter, temp dirs; no
// server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import minecraftData from 'minecraft-data';
import settings from './settings.js';
import { __setRegistryForTest } from '../utils/mcdata.js';
import { Agenda, ROTN_EARLY_GAME, describeAgenda } from './agenda.js';
import { agendaTick, agendaState, TICK_MS, RESTART_BACKOFF_MS } from './agenda_driver.js';
import { Agent } from './agent.js';
import { parseCommandMessage } from './commands/index.js';
import { TaskQueue } from './task_queue.js';

__setRegistryForTest(minecraftData('1.12.2'));

function tempDir(t) {
    const dir = mkdtempSync(path.join(tmpdir(), 'rotn-agenda-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}
const stack = (name, metadata, count) => ({ name, metadata, count });
function fakeBot(items = [], { tableNear = false, players = { FRCFLD: {}, JQDAW: {} } } = {}) {
    return {
        players,
        entity: { position: { x: 0, y: 64, z: 0 } },
        inventory: { items: () => items, slots: [null, ...items] },
        findBlocks: () => (tableNear ? [{ x: 1, y: 64, z: 0 }] : []),
        blockAt: (p) => ({ name: 'crafting_table', position: p }),
    };
}
function fakeSelfPrompter() {
    const sp = { state: 'stopped', prompt: '', starts: [], stops: 0 };
    sp.isActive = () => sp.state === 'active';
    sp.isStopped = () => sp.state === 'stopped';
    sp.start = (prompt) => { sp.state = 'active'; sp.prompt = prompt; sp.starts.push(prompt); };
    sp.stop = () => { sp.state = 'stopped'; sp.stops++; };
    return sp;
}
function fakeAgent(t, items = [], opts = {}) {
    const said = [];
    const agent = {
        name: 'FRCFLD',
        agenda: new Agenda('FRCFLD', { dir: tempDir(t) }),
        self_prompter: fakeSelfPrompter(),
        bot: fakeBot(items, opts),
        said,
        openChat: (m) => { said.push(m); },
    };
    agent.agenda.start();
    return agent;
}
const stepOf = (items, opts) => new Agenda('x', { dir: path.join(tmpdir(), `rotn-none-${Math.random()}`) }).evaluate(agendaState(fakeBot(items, opts))).step?.id ?? null;

test('the steps follow the RotN first day, judged from the inventory', () => {
    assert.equal(stepOf([]), 'rocks');
    const rocks = [stack('pyrotech_compat:rock_metamorphic', 0, 4), stack('pyrotech:rock', 0, 2)]; // any rock counts
    assert.equal(stepOf(rocks), 'sticks');
    assert.equal(stepOf([...rocks, stack('stick', 0, 4)]), 'crude_axe');
    assert.equal(stepOf([...rocks, stack('stick', 0, 4), stack('pyrotech:crude_axe', 0, 1)]), 'logs');
    const logs = [...rocks, stack('stick', 0, 4), stack('pyrotech:crude_axe', 0, 1), stack('log', 0, 2), stack('log2', 1, 1)];
    assert.equal(stepOf(logs), 'first_plank');
    assert.equal(stepOf([...logs, stack('planks', 0, 1)]), 'crafting_tools');
    assert.equal(stepOf([...logs, stack('planks', 0, 1), stack('contenttweaker:crafting_tools', 0, 1)]), 'crafting_table');
    assert.equal(stepOf([...logs, stack('planks', 0, 1)], { tableNear: true }), 'planks_sticks', 'a placed table counts');
    assert.equal(stepOf([stack('stone_pickaxe', 0, 1), stack('stick', 0, 2)], { tableNear: true }), 'stone_axe');
    assert.equal(stepOf([stack('stone_pickaxe', 0, 1), stack('stone_axe', 0, 1)], { tableNear: true }), 'cobblestone');
    assert.equal(stepOf([stack('stone_pickaxe', 0, 1), stack('stone_axe', 0, 1), stack('cobblestone', 0, 8)], { tableNear: true }), null);
    assert.ok(ROTN_EARLY_GAME.every(s => /^[a-z_]+$/.test(s.id) && s.goal.length > 20));
});

test('the agenda survives a restart; a corrupt file is moved aside', (t) => {
    const dir = tempDir(t);
    const a = new Agenda('FRCFLD', { dir, now: () => 7 });
    a.start();
    a.evaluate(agendaState(fakeBot([stack('pyrotech:rock', 0, 6)])));
    const b = new Agenda('FRCFLD', { dir });
    assert.equal(b.active, true);
    assert.deepEqual(b.done_at, { rocks: 7 });
    assert.deepEqual(readdirSync(dir), ['agenda.json']);

    t.mock.method(console, 'warn', () => {});
    writeFileSync(path.join(dir, 'agenda.json'), 'nonsense');
    const c = new Agenda('FRCFLD', { dir, now: () => 9 });
    assert.equal(c.active, false);
    assert.match(c.loadProblem, /moved it to .*agenda\.json\.corrupt-9/);
});

test('the driver points the self-prompter at the current step and moves on when it is done', (t) => {
    const items = [];
    const agent = fakeAgent(t, items);
    assert.equal(agendaTick(agent, { now: 1_000 }), 'rocks');
    assert.deepEqual(agent.said, ['agenda step rocks started: collect 6 rocks']);
    assert.equal(agent.self_prompter.starts.length, 1);
    assert.match(agent.self_prompter.prompt, /^RotN agenda, step 1 of 11 \(rocks\): Collect at least 6 rocks with !collectBlocks\("pyrotech:rock", 6\)/);

    assert.equal(agendaTick(agent, { now: 1_000 + TICK_MS - 1 }), null, 'throttled');
    items.push(stack('pyrotech_compat:rock_igneous', 0, 6));
    assert.equal(agendaTick(agent, { now: 1_000 + TICK_MS }), 'sticks');
    assert.deepEqual(agent.said.slice(1), ['agenda step rocks done', 'agenda step sticks started: collect 4 sticks']);
    assert.equal(agent.self_prompter.starts.length, 1, 'already running: only the prompt changes');
    assert.match(agent.self_prompter.prompt, /\(sticks\): Get at least 4 sticks with !collectBlocks\("stick", 4\)/);
});

test('a stopped self-prompter is restarted, at most once per back-off', (t) => {
    const agent = fakeAgent(t);
    agendaTick(agent, { now: 0 });
    agent.self_prompter.stop(); // e.g. three replies without a command
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'rocks');
    assert.equal(agent.self_prompter.starts.length, 1, 'not yet: back-off');
    agendaTick(agent, { now: RESTART_BACKOFF_MS });
    assert.equal(agent.self_prompter.starts.length, 2);
});

test('pause_when_empty: no other player online pauses the agenda; a player back resumes it', (t) => {
    const before = settings.pause_when_empty;
    settings.pause_when_empty = true;
    t.after(() => { settings.pause_when_empty = before; });
    const agent = fakeAgent(t, [], { players: { FRCFLD: {} } });
    assert.equal(agendaTick(agent, { now: 0 }), 'paused');
    assert.equal(agent.self_prompter.starts.length, 0);
    agent.bot.players.JQDAW = {};
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'rocks');
    assert.equal(agent.self_prompter.starts.length, 1);
});

test('all steps done: "agenda done", the agenda stops', (t) => {
    const agent = fakeAgent(t, [stack('stone_pickaxe', 0, 1), stack('stone_axe', 0, 1), stack('cobblestone', 0, 8)], { tableNear: true });
    assert.equal(agendaTick(agent, { now: 0 }), 'done');
    assert.equal(agent.said.at(-1), 'agenda done');
    assert.equal(agent.agenda.active, false);
});

test('after a restart the agenda resumes at the step the world is at', (t) => {
    const dir = tempDir(t);
    const first = new Agenda('FRCFLD', { dir });
    first.start();
    const agent = { name: 'FRCFLD', agenda: new Agenda('FRCFLD', { dir }), self_prompter: fakeSelfPrompter(), said: [], openChat(m) { this.said.push(m); },
        bot: fakeBot([stack('pyrotech:rock', 0, 6), stack('stick', 0, 4)]) };
    assert.equal(agent.agenda.active, true);
    assert.equal(agendaTick(agent, { now: 0 }), 'crude_axe');
    assert.equal(agent.self_prompter.starts.length, 1);
});

test('commands: !agenda describes it; !agendaStop/!agendaStart only when a giver types them; !collectBlocks takes "stick"', async (t) => {
    const before = { ...settings };
    Object.assign(settings, { language: 'en', task_givers: ['JQDAW'], only_chat_with: [] });
    t.after(() => { for (const k of Object.keys(settings)) delete settings[k]; Object.assign(settings, before); });
    t.mock.method(console, 'log', () => {});
    const said = [];
    const agent = Object.create(Agent.prototype);
    Object.assign(agent, {
        name: 'FRCFLD', shut_up: false,
        agenda: new Agenda('FRCFLD', { dir: tempDir(t) }),
        tasks: new TaskQueue('FRCFLD', { dir: tempDir(t) }),
        self_prompter: Object.assign(fakeSelfPrompter(), { shouldInterrupt: () => false, handleUserPromptedCmd() {} }),
        bot: { ...fakeBot([]), players: {}, modes: { flushBehaviorLog: () => '' } },
        checkTaskDone: () => Promise.resolve(),
        routeResponse: (to, m) => { said.push(`${to}: ${m}`); return Promise.resolve(); },
        history: { add: () => Promise.resolve(), getHistory: () => [], save() {} },
    });
    agent.agenda.start();
    await agent.handleMessage('JQDAW', '!agenda');
    assert.ok(said.includes('JQDAW: agenda: active, step rocks (collect 6 rocks); done: none'));
    await agent.handleMessage('Alex', '!agendaStop');
    assert.equal(agent.agenda.active, true, 'not a task giver');
    await agent.handleMessage('JQDAW', '!agendaStop');
    assert.equal(agent.agenda.active, false);
    assert.ok(said.includes('JQDAW: agenda stopped'));
    await agent.handleMessage('JQDAW', '!agendaStart');
    assert.equal(agent.agenda.active, true);

    assert.deepEqual(parseCommandMessage('!collectBlocks("stick", 2)').args, ['stick', 2]);
    assert.equal(describeAgenda({ steps: ROTN_EARLY_GAME, active: false, done_at: {} }, null), 'agenda: stopped, all steps done; done: none');
});

test('a step once done stays done: crafting the crude axe uses up sticks, the agenda does not go back', (t) => {
    const items = [stack('pyrotech:rock', 0, 6), stack('stick', 0, 4)];
    const agent = fakeAgent(t, items);
    assert.equal(agendaTick(agent, { now: 0 }), 'crude_axe');
    // The bot crafts the crude axe: 1 rock and 2 sticks are used up.
    items[0].count = 5; items[1].count = 2; items.push(stack('pyrotech:crude_axe', 0, 1));
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'logs');
    assert.ok(!agent.said.some(m => m === 'agenda step sticks started: collect 4 sticks'), 'never back to sticks');
});
