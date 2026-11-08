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
import { Agenda, ROTN_EARLY_GAME, describeAgenda, SHELTER_RESERVE, RESERVE_LEAD_MIN, SHELTER_RESERVE_STEP, dirtPile } from './agenda.js';
import { NIGHT_START, TICKS_PER_MIN } from './library/night.js';
import { agendaTick, agendaState, agendaGoal, TICK_MS, BACKOFF_MS, STEP_LLM_MS } from './agenda_driver.js';
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

test('first_plank needs a plank in the inventory: a debarked log (a !useOn block change) is not one (#216 review)', () => {
    const before = [stack('pyrotech:rock', 0, 6), stack('stick', 0, 4), stack('pyrotech:crude_axe', 0, 1), stack('log', 0, 3)];
    assert.equal(stepOf(before), 'first_plank');
    // !useOn debarked a placed log and returned true: the world changed, the inventory did not.
    assert.equal(stepOf(before), 'first_plank', 'a block change alone does not finish the step');
    // A debarked log picked up is logWood (rotn-data), not plankWood.
    assert.equal(stepOf([...before, stack('hitwithaxe:debarked_oak', 0, 1)]), 'first_plank');
    assert.equal(stepOf([...before, stack('planks', 0, 2)]), 'crafting_tools', 'a real plank gain does');
});

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
    assert.equal(stepOf([stack('stone_pickaxe', 0, 1), stack('stone_axe', 0, 1), stack('cobblestone', 0, 9)], { tableNear: true }), 'cobblestone', '9 do not make a shelter');
    assert.equal(stepOf([stack('stone_pickaxe', 0, 1), stack('stone_axe', 0, 1), stack('cobblestone', 0, 10)], { tableNear: true }), null);
    assert.ok(ROTN_EARLY_GAME.every(s => /^[a-z_]+$/.test(s.id) && s.goal.length > 20));
});

test('the agenda survives a restart; a corrupt file is moved aside', (t) => {
    const dir = tempDir(t);
    const a = new Agenda('FRCFLD', { dir, now: () => 7 });
    assert.equal(a.existed, false, 'a fresh bot: autostart starts it');
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
    assert.deepEqual(agent.said.slice(1), ['agenda step rocks done', 'agenda step sticks started: collect 3 sticks']);
    assert.equal(agent.self_prompter.starts.length, 1, 'already running: only the prompt changes');
    assert.match(agent.self_prompter.prompt, /\(sticks\): Get at least 3 sticks: 2 for the crude axe and 1 for the Crafting Tools\. !collectBlocks\("stick", 3\)/);
});

test('a stopped self-prompter is restarted after a doubling back-off; after 3 runs the step is stuck and the agenda pauses', (t) => {
    const agent = fakeAgent(t);
    const sp = agent.self_prompter;
    agendaTick(agent, { now: 0 });
    assert.equal(sp.starts.length, 1);
    sp.stop(); // e.g. three replies without a command
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'rocks');
    assert.equal(sp.starts.length, 1, 'not yet: back-off');
    agendaTick(agent, { now: TICK_MS + BACKOFF_MS - TICK_MS });
    assert.equal(sp.starts.length, 1, 'still backing off');
    agendaTick(agent, { now: TICK_MS + BACKOFF_MS });
    assert.equal(sp.starts.length, 2, 'run 2 after BACKOFF_MS');
    sp.stop();
    const t2 = TICK_MS + BACKOFF_MS + TICK_MS;
    agendaTick(agent, { now: t2 });
    agendaTick(agent, { now: t2 + 2 * BACKOFF_MS - TICK_MS });
    assert.equal(sp.starts.length, 2, 'the back-off doubled');
    agendaTick(agent, { now: t2 + 2 * BACKOFF_MS });
    assert.equal(sp.starts.length, 3, 'run 3 after 2 x BACKOFF_MS');
    sp.stop();
    assert.equal(agendaTick(agent, { now: t2 + 2 * BACKOFF_MS + TICK_MS }), 'stuck');
    assert.equal(agent.said.at(-1), 'agenda step rocks stuck: 3 self-prompter runs; agenda paused');
    assert.equal(agent.agenda.active, false);
    assert.equal(agendaTick(agent, { now: t2 + 10 * BACKOFF_MS }), null, 'paused: no more runs');
    assert.equal(sp.starts.length, 3);
    // It survives a restart, and a giver's start gives the step a fresh budget.
    const again = new Agenda('FRCFLD', { dir: path.dirname(agent.agenda.file) });
    assert.equal(again.active, false);
    assert.equal(again.stuck.id, 'rocks');
    assert.equal(again.existed, true, 'so autostart leaves it paused');
    again.start();
    assert.deepEqual([again.active, again.stuck, again.spentOn('rocks').attempts], [true, null, 0]);
});

test('a self-prompter that never stops is bounded by STEP_LLM_MS of self-prompting for the step', (t) => {
    const agent = fakeAgent(t);
    let now = 0, result = null;
    while (now <= STEP_LLM_MS + 10 * TICK_MS && result !== 'stuck') {
        result = agendaTick(agent, { now });
        now += TICK_MS;
    }
    assert.equal(result, 'stuck');
    assert.ok(now >= STEP_LLM_MS && now <= STEP_LLM_MS + 3 * TICK_MS, `stuck after about STEP_LLM_MS (${now} ms)`);
    assert.equal(agent.self_prompter.isActive(), false);
    assert.equal(agent.self_prompter.starts.length, 1);
    assert.match(agent.said.at(-1), /^agenda step rocks stuck: 5 min of self-prompting; agenda paused$/);
});

test('resuming after pause_when_empty is not a new run; a restart keeps the runs already spent', (t) => {
    const before = settings.pause_when_empty;
    settings.pause_when_empty = true;
    t.after(() => { settings.pause_when_empty = before; });
    const agent = fakeAgent(t);
    agendaTick(agent, { now: 0 });
    delete agent.bot.players.JQDAW;
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'paused');
    agent.bot.players.JQDAW = {};
    agendaTick(agent, { now: 2 * TICK_MS });
    assert.equal(agent.self_prompter.starts.length, 2);
    assert.equal(agent.agenda.spentOn('rocks').attempts, 1);
    assert.equal(new Agenda('FRCFLD', { dir: path.dirname(agent.agenda.file) }).spentOn('rocks').attempts, 1);
});

test('wood comes from rotn-data: modded RotN logs and planks count (logWood, plankWood)', () => {
    const early = [stack('pyrotech:rock', 0, 6), stack('stick', 0, 4), stack('pyrotech:crude_axe', 0, 1)];
    assert.equal(stepOf([...early, stack('biomesoplenty:log_0', 4, 3)]), 'first_plank');
    assert.equal(stepOf([...early, stack('biomesoplenty:log_0', 4, 2), stack('log', 2, 1)]), 'first_plank', 'mixed woods add up');
    assert.equal(stepOf([...early, stack('biomesoplenty:log_0', 4, 3), stack('biomesoplenty:planks_0', 2, 1)]), 'crafting_tools');
});

test('a chat line that fails is logged, not an unhandled rejection', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const agent = fakeAgent(t);
    agent.openChat = () => Promise.reject(new Error('chat down'));
    assert.equal(agendaTick(agent, { now: 0 }), 'rocks');
    await new Promise(r => setTimeout(r, 0));
    assert.ok(warn.mock.calls.some(c => /^\[agenda\] chat failed: /.test(c.arguments[0])));
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
    const agent = fakeAgent(t, [stack('stone_pickaxe', 0, 1), stack('stone_axe', 0, 1), stack('cobblestone', 0, 10)], { tableNear: true });
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
    // #164 review: the query records nothing, so the driver still posts "agenda step rocks done".
    agent.bot.inventory = fakeBot([stack('pyrotech:rock', 0, 6)]).inventory;
    await agent.handleMessage('JQDAW', '!agenda');
    assert.ok(said.includes('JQDAW: agenda: active, step sticks (collect 3 sticks); done: rocks'));
    assert.deepEqual(agent.agenda.done_at, {});
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
    assert.ok(!agent.said.some(m => m === 'agenda step sticks started: collect 3 sticks'), 'never back to sticks');
});

test('G3 round 3 A: the cobblestone step\'s goal names the cobblestone the held rocks make, with one command', () => {
    const agenda = new Agenda('x', { dir: path.join(tmpdir(), `rotn-none-${Math.random()}`) });
    const step = ROTN_EARLY_GAME.find(s => s.id === 'cobblestone');
    const goal = (items) => agendaGoal(agenda, step, agendaState(fakeBot(items)));
    assert.match(goal([stack('pyrotech_compat:rock_sedimentary', 0, 8)]),
        /Your pyrotech_compat:rock_sedimentary:0 rocks make contenttweaker:chalk_cobble:0, 4 rocks each: craft it with !craftRecipe\("cobblestone", 2\)\./);
    // #234 nit: the real number, at most what the step still needs (10 cobblestone)
    assert.match(goal([stack('pyrotech_compat:rock_sedimentary', 0, 40)]), /!craftRecipe\("cobblestone", 10\)/);
    assert.match(goal([stack('pyrotech_compat:rock_sedimentary', 0, 40), stack('cobblestone', 0, 7)]), /!craftRecipe\("cobblestone", 3\)/);
    assert.match(goal([stack('pyrotech_compat:rock_igneous', 3, 4)]), /make undergroundbiomes:igneous_cobble:3/);
    assert.match(goal([stack('pyrotech_compat:rock_metamorphic', 0, 4)]), /make undergroundbiomes:metamorphic_cobble:0/);
    const plain = goal([stack('pyrotech:rock', 0, 4)]);
    assert.match(plain, /Your pyrotech:rock:0 rocks make cobblestone, 4 rocks each/);
    assert.equal(plain.match(/!craftRecipe/g).length, 1, '#233 review 3: one command, not the same one twice');
    // too few rocks of one kind: the general goal
    assert.match(goal([stack('pyrotech:rock', 0, 3)]), /make cobblestone from 4 rocks of one kind with !craftRecipe\("cobblestone", 1\): each rock kind makes its own cobblestone/);
});

test('#233 review 2: the rock-specific goal reaches the prompt once the bot has the rocks; not a new run', (t) => {
    const items = [stack('stone_pickaxe', 0, 1), stack('stone_axe', 0, 1)];
    const agent = fakeAgent(t, items, { tableNear: true });
    assert.equal(agendaTick(agent, { now: 1_000 }), 'cobblestone');
    const sp = agent.self_prompter;
    assert.match(sp.prompt, /each rock kind makes its own cobblestone/, 'no rocks yet: the general goal');
    const runs = agent.agenda.spentOn('cobblestone').attempts;
    items.push(stack('pyrotech_compat:rock_sedimentary', 0, 4)); // it mined rocks
    agendaTick(agent, { now: 1_000 + TICK_MS });
    assert.match(sp.prompt, /make contenttweaker:chalk_cobble:0/);
    assert.equal(agent.agenda.spentOn('cobblestone').attempts, runs, 'the same run');
});

// G3 round 4 C+D: an inventory left over from an earlier run completed every step at once; the 12
// lines in one second got the bot kicked for spamming. Now one line names the steps done together.
test('round 4 C+D: steps done together get one summary line, not one line each', (t) => {
    const all = fakeAgent(t, [stack('stone_pickaxe', 0, 1), stack('stone_axe', 0, 1), stack('crafting_table', 0, 1), stack('cobblestone', 0, 10)]);
    assert.equal(agendaTick(all, { now: 1_000 }), 'done');
    assert.equal(all.said.length, 2, JSON.stringify(all.said));
    assert.equal(all.said[0], `agenda steps done: ${ROTN_EARLY_GAME.map(s => s.id).join(', ')}`);
    assert.equal(all.said[1], 'agenda done', 'the line the harness ends on');

    const two = fakeAgent(t, [stack('pyrotech:rock', 0, 6), stack('stick', 0, 4)]);
    assert.equal(agendaTick(two, { now: 1_000 }), 'crude_axe');
    assert.deepEqual(two.said, ['agenda steps done: rocks, sticks', 'agenda step crude_axe started: craft a crude axe']);

    const one = fakeAgent(t, [stack('pyrotech:rock', 0, 6)]);
    agendaTick(one, { now: 1_000 });
    assert.equal(one.said[0], 'agenda step rocks done', 'one step keeps its own line');
});

test('round 5 A rerun: the sticks step needs 3 stickWood, and River Cane or bamboo count (rotn-data: ore:stickWood)', () => {
    const rocks = [stack('pyrotech:rock', 0, 6)];
    assert.equal(stepOf([...rocks, stack('stick', 0, 2)]), 'sticks', '2 sticks: one short of the axe and the Crafting Tools');
    assert.equal(stepOf([...rocks, stack('stick', 0, 3)]), 'crude_axe', '3 sticks do (4 were needed before)');
    assert.equal(stepOf([...rocks, stack('stick', 0, 1), stack('biomesoplenty:plant_1', 5, 2)]), 'crude_axe', '1 stick and 2 River Cane');
    assert.equal(stepOf([...rocks, stack('biomesoplenty:bamboo', 0, 3)]), 'crude_axe', '3 bamboo');
    assert.equal(stepOf([...rocks, stack('biomesoplenty:plant_1', 0, 3)]), 'sticks', 'another plant_1 kind is not River Cane');
});

test('round 5 A rerun (lead: Hit With Axe): the Crafting Tools step names the axe path for a missing stick', () => {
    const tools = ROTN_EARLY_GAME.find(s => s.id === 'crafting_tools');
    assert.match(tools.goal, /With no stick left, !collectBlocks\("stick", 1\) chops a placed log and plank with the crude axe for 2 sticks/);
});

// G3 round 6 B (the lead): before dusk the agenda keeps at least 9 sturdy blocks for the shelter.
// Any cobblestone or stone counts (night.js isSturdy): soapstone cobble too.
const SOAPSTONE = 'undergroundbiomes:metamorphic_cobble';
const dayAt = (min) => NIGHT_START - min * TICKS_PER_MIN; // min minutes before sunset (after the morning freeze: at most 7.9)

test('G3 round 6 B: near dusk the shelter reserve comes before the current step; with the blocks held the step resumes', (t) => {
    const items = [stack('pyrotech:rock', 0, 6)];
    const agent = fakeAgent(t, items);
    agent.bot.time = { timeOfDay: 1000 };
    assert.equal(agendaTick(agent, { now: 0 }), 'sticks', 'by day: the current step');
    assert.ok(RESERVE_LEAD_MIN > 6 && SHELTER_RESERVE >= 9);

    agent.bot.time.timeOfDay = dayAt(7);
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'shelter_blocks');
    assert.equal(agent.said.at(-1), `agenda step shelter_blocks started: keep ${SHELTER_RESERVE} blocks for the night's shelter`);
    assert.match(agent.self_prompter.prompt, /^RotN agenda, step shelter_blocks \(before night\): Night is near: in about \d+ min the night routine builds a shelter\. You have no pickaxe yet, so it is built of dirt/);

    // #284 review 3: with no pickaxe the shelter places only dirt, so 10 sturdy blocks are no reserve.
    items.push(stack(SOAPSTONE, 6, 4), stack('cobblestone', 0, 6));
    assert.equal(agendaTick(agent, { now: 2 * TICK_MS }), 'shelter_blocks', '10 cobblestone and no dirt: still due');
    assert.match(agent.self_prompter.prompt, /you have 0 \(dirt, and dirt from your dirt piles\)\./);
    assert.doesNotMatch(agent.self_prompter.prompt, /cobblestone/);
    items.push(stack('dirt', 0, 10));
    assert.equal(agendaTick(agent, { now: 3 * TICK_MS }), 'sticks');
    assert.equal(agent.said.at(-1), 'agenda resumed: sticks');
    assert.equal(agent.agenda.active, true);
});

test('G3 round 6 B: after "agenda done" the reserve still runs before dusk, and then leaves the self-prompter alone', (t) => {
    const items = [stack('stone_pickaxe', 0, 1), stack('stone_axe', 0, 1), stack('cobblestone', 0, 10)];
    const agent = fakeAgent(t, items, { tableNear: true });
    agent.bot.time = { timeOfDay: 1000 };
    assert.equal(agendaTick(agent, { now: 0 }), 'done');
    assert.equal(agent.agenda.active, false);
    assert.equal(agent.agenda.finished, true);
    assert.equal(agendaTick(agent, { now: TICK_MS }), null, 'by day nothing runs');

    items[2].count = 3; // the cobblestone was used by day
    agent.bot.time.timeOfDay = dayAt(7);
    assert.equal(agendaTick(agent, { now: 2 * TICK_MS }), 'shelter_blocks');
    assert.equal(agent.self_prompter.isActive(), true);
    assert.match(agent.self_prompter.prompt, /you have 3\./);

    items[2].count = 10;
    assert.equal(agendaTick(agent, { now: 3 * TICK_MS }), null);
    assert.equal(agent.self_prompter.isActive(), false, 'its own run stopped');
    assert.equal(agent.said.filter(l => l === 'agenda done').length, 1, '"agenda done" once');
    assert.match(describeAgenda(agent.agenda, null), /agenda: done \(before night it still keeps the shelter blocks\)/);

    // A giver's !agendaStop stops the reserve too.
    agent.agenda.stop();
    items[2].count = 0;
    assert.equal(agendaTick(agent, { now: 4 * TICK_MS }), null);
});

test('G3 round 6 B: a reserve that used its budget does not pause the agenda; it is fresh again the next day', (t) => {
    const agent = fakeAgent(t, [stack('pyrotech:rock', 0, 6)]);
    agent.bot.time = { timeOfDay: dayAt(7) };
    agent.agenda.spent.shelter_blocks = { attempts: 1, llm_ms: STEP_LLM_MS };
    assert.equal(agendaTick(agent, { now: 0 }), 'stuck');
    assert.equal(agent.said.at(-1), `agenda step shelter_blocks stuck: ${STEP_LLM_MS / 60_000} min of self-prompting; going on without it until the night`);
    assert.equal(agent.agenda.active, true, 'not paused');
    assert.equal(agent.agenda.stuck, null);
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'sticks');

    agent.bot.time.timeOfDay = 1000; // the next morning
    assert.equal(agendaTick(agent, { now: 2 * TICK_MS }), 'sticks');
    assert.equal(agent.agenda.reserveOff, false);
    assert.equal(agent.agenda.spentOn('shelter_blocks').llm_ms, 0);
});

// #284 review.
test('#284 review 1: the reserve is not due at night (minutesToSunset is 0), so it never sends the bot out in the dark', (t) => {
    const agent = fakeAgent(t, [stack('pyrotech:rock', 0, 6)]);
    for (const timeOfDay of [NIGHT_START, 15000, 23000]) {
        agent.bot.time = { timeOfDay };
        assert.equal(agendaState(agent.bot).minutesToSunset(), 0);
        assert.equal(agent.agenda.judge(agendaState(agent.bot)).step.id, 'sticks', `time ${timeOfDay}`);
    }
});

test('#284 review 2: with no pickaxe the reserve counts dirt and dirt piles and asks for dirt, never rocks; with a pickaxe it asks for sturdy blocks', (t) => {
    const items = [stack('pyrotech:rock', 0, 6), stack('betterwithmods:dirt_pile', 0, 8), stack('dirt', 0, 2)];
    const agent = fakeAgent(t, items);
    agent.bot.time = { timeOfDay: dayAt(7) };
    assert.equal(agendaTick(agent, { now: 0 }), 'shelter_blocks');
    const prompt = agent.self_prompter.prompt;
    // rotn-data #288: dirt dug by hand drops 4 betterwithmods:dirt_pile, so the ask is piles, 4 per
    // dirt block still missing; !collectBlocks("dirt") would count 0.
    assert.match(prompt, /you have 4 \(dirt, and dirt from your dirt piles\)\. Dig dirt or grass by hand with !collectBlocks\("betterwithmods:dirt_pile", 24\): dug by hand \(or with a shovel below level 1\) it drops 4 piles of dirt, not a dirt block/);
    assert.doesNotMatch(prompt, /collectBlocks\("dirt"/);
    assert.doesNotMatch(prompt, /rock/i, 'no rock run before the pickaxe step');
    // The static goal (used only when goalNow fails) tells the two cases apart the same way.
    assert.match(SHELTER_RESERVE_STEP.goal, /If you have no pickaxe, it is built of dirt only, which you can dig out of by hand: dig dirt or grass by hand with !collectBlocks\("betterwithmods:dirt_pile", 40\)/);

    items[1].count = 32; // 8 dirt from piles + 2 dirt = 10
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'sticks', 'enough dirt: the tool steps go on');

    // With a pickaxe, dirt does not count: it asks for sturdy blocks.
    const withPick = [stack('stone_pickaxe', 0, 1), stack('stone_axe', 0, 1), stack('dirt', 0, 20), stack('cobblestone', 0, 3)];
    const b = fakeAgent(t, withPick, { tableNear: true });
    b.bot.time = { timeOfDay: dayAt(7) };
    b.agenda.done_at.cobblestone = 1; // the cobblestone step was done once; the cobblestone was used since
    assert.equal(agendaTick(b, { now: 0 }), 'shelter_blocks');
    assert.match(b.self_prompter.prompt, /builds a shelter from sturdy blocks \(any cobblestone or stone\)\. It needs 10 on open ground, and you have 3\./);
});

test('#291 nit: the pile the reserve asks for keeps its recipe variant (meta); on 3.3.4 it is betterwithmods:dirt_pile, 4 per dirt', () => {
    assert.deepEqual(dirtPile(), { name: 'betterwithmods:dirt_pile', per: 4 }, 'the real rotn-data recipe');
    const recipe = (meta) => () => [{ name: 'somemod:dirt_bits', meta, per: 8, gives: { name: 'minecraft:dirt', meta: 0 } }];
    assert.deepEqual(dirtPile(recipe(3)), { name: 'somemod:dirt_bits:3', per: 8 });
    assert.deepEqual(dirtPile(recipe(0)), { name: 'somemod:dirt_bits', per: 8 });
});
