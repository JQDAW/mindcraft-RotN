// Offline tests for skills-rotn E2, the RotN agenda: steps judged from the bot's
// state (no LLM), persistence across a restart, and the driver that points the
// self-prompter at the current step. Fake bot, fake self-prompter, temp dirs; no
// server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import minecraftData from 'minecraft-data';
import settings from './settings.js';
import { __setRegistryForTest } from '../utils/mcdata.js';
import * as NIGHT_CONST from './library/night.js';
import { FOOD_BEFORE_NIGHT, foodRunsOutBeforeNight, Agenda, ROTN_EARLY_GAME, describeAgenda, SHELTER_RESERVE, SHELTER_HOLD, REPAIR_SPARE, RESERVE_LEAD_MIN, SHELTER_RESERVE_STEP, dirtPile, FOOD_RESERVE_STEP, FOOD_RETRY_MS, FOOD_DAY_RUNS, STUCK_RETRY, WEAPON_RESERVE_STEP, WEAPON_FIRST, NO_WEAPON_FOOD, FOOD_AFTER_DEATH, CLUB } from './agenda.js';
import { Vec3 } from 'vec3';
import { foodDue } from './modes.js';
import { NIGHT_START, TICKS_PER_MIN, MORNING_FREEZE, FREEZE_MIN, NightClock, sunsetEstimateMin, minutesToSunset } from './library/night.js';
import { agendaTick, agendaState, agendaGoal, TICK_MS, BACKOFF_MS, STEP_LLM_MS, autoCraftTick, AUTO_CRAFT } from './agenda_driver.js';
import { Agent } from './agent.js';
import { parseCommandMessage } from './commands/index.js';
import { TaskQueue } from './task_queue.js';
import { DeathReporter } from './library/death_report.js';

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
        // The weapon reserve (soak 3) only where a test asks for it (opts.weapon): the older tests' bots hold none.
        agenda: new Agenda('FRCFLD', { dir: tempDir(t), weapon: opts.weapon ?? null }),
        self_prompter: fakeSelfPrompter(),
        bot: fakeBot(items, opts),
        said,
        openChat: (m) => { said.push(m); },
    };
    agent.agenda.start();
    return agent;
}
const stepOf = (items, opts) => new Agenda('x', { dir: path.join(tmpdir(), `rotn-none-${Math.random()}`), weapon: null }).evaluate(agendaState(fakeBot(items, opts))).step?.id ?? null;

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

test('a stopped self-prompter is restarted after a doubling back-off; after 3 runs the step is stuck, waits for its retry, and the agenda goes on (#463 decision)', (t) => {
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
    assert.equal(agent.said.at(-1), 'agenda step rocks stuck: 3 self-prompter runs; retry 1 of 3 in 20 min or at the next full day; going on with the steps that do not need it');
    assert.equal(agent.agenda.active, true, 'not paused');
    assert.equal(agendaTick(agent, { now: t2 + 10 * BACKOFF_MS }), 'sticks', 'the next step that does not need rocks');
    assert.equal(sp.starts.length, 4);
    // It survives a restart, and a giver's start gives the step a fresh budget.
    const again = new Agenda('FRCFLD', { dir: path.dirname(agent.agenda.file) });
    assert.equal(again.active, true);
    assert.equal(again.stuck.rocks.cooling, true);
    assert.equal(again.existed, true);
    again.start();
    assert.deepEqual([again.active, again.stuck, again.spentOn('rocks').attempts], [true, {}, 0]);
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
    assert.match(agent.said.at(-1), /^agenda step rocks stuck: 5 min of self-prompting; retry 1 of 3 in 20 min or at the next full day; going on with the steps that do not need it$/);
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
    assert.equal(agent.said.at(-1), `agenda step shelter_blocks started: keep ${SHELTER_HOLD} blocks for the night's shelter and its repairs`);
    assert.match(agent.self_prompter.prompt, /^RotN agenda, step shelter_blocks \(before night\): Night is near: in about \d+ min the night routine builds a shelter\. You have no pickaxe yet, so it is built of dirt/);

    // #284 review 3: with no pickaxe the shelter places only dirt, so 10 sturdy blocks are no reserve.
    items.push(stack(SOAPSTONE, 6, 4), stack('cobblestone', 0, 6));
    assert.equal(agendaTick(agent, { now: 2 * TICK_MS }), 'shelter_blocks', '10 cobblestone and no dirt: still due');
    assert.match(agent.self_prompter.prompt, /you have 0 \(dirt, and dirt from your dirt piles\)\./);
    assert.doesNotMatch(agent.self_prompter.prompt, /cobblestone/);
    items.push(stack('dirt', 0, SHELTER_HOLD)); // soak 10 (S1): the shelter's 10 and the repair spare
    assert.equal(agendaTick(agent, { now: 3 * TICK_MS }), 'sticks');
    assert.equal(agent.said.at(-1), 'agenda resumed: sticks');
    assert.equal(agent.agenda.active, true);
});

test('G3 round 6 B: after "agenda done" the reserve still runs before dusk, and then leaves the self-prompter alone', (t) => {
    const items = [stack('stone_pickaxe', 0, 1), stack('stone_axe', 0, 1), stack('cobblestone', 0, SHELTER_HOLD)];
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

    items[2].count = SHELTER_HOLD;
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
    assert.deepEqual(agent.agenda.stuck, {}, 'no step waits');
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'sticks');

    agent.bot.time.timeOfDay = 1000; // the next morning
    assert.equal(agendaTick(agent, { now: 2 * TICK_MS }), 'sticks');
    assert.equal(agent.agenda.reserveOff, false);
    assert.equal(agent.agenda.spentOn('shelter_blocks').llm_ms, 0);
});

// G3 round 10 A: the reserve ran twice in one dusk on one budget: about 4 min on dirt (no pickaxe)
// until the bot held 80 dirt piles, then the stone pickaxe made it ask for sturdy blocks, and it
// was "stuck: 5 min of self-prompting" 70 s later. The first change of need in a dusk gets a fresh
// budget; a later change does not.
test('round 10 A: when the pickaxe changes what the reserve needs, it gets a fresh budget once per dusk', (t) => {
    const items = [stack('pyrotech:rock', 0, 6)];
    const agent = fakeAgent(t, items);
    agent.bot.time = { timeOfDay: dayAt(7) };
    let now = 0;
    const tickFor = (ms) => { // the self-prompter runs; the driver counts its time per tick
        let r = null;
        for (const end = now + ms; now < end;) { now += 10_000; r = agendaTick(agent, { now }); if (r !== 'shelter_blocks') return r; }
        return r;
    };
    // 1. No pickaxe: the reserve asks for dirt and spends 4 min; 80 piles (20 dirt) make it done.
    assert.equal(agendaTick(agent, { now }), 'shelter_blocks');
    assert.equal(tickFor(4 * 60_000), 'shelter_blocks');
    assert.ok(agent.agenda.spentOn('shelter_blocks').llm_ms >= 3.5 * 60_000);
    items.push(stack('betterwithmods:dirt_pile', 0, 80));
    now += 10_000;
    assert.equal(agendaTick(agent, { now }), 'sticks', 'enough dirt: the step it interrupted resumes');

    // 2. The stone pickaxe: now it needs sturdy blocks. A fresh budget: not stuck 1 min later.
    items.push(stack('stone_pickaxe', 0, 1));
    now += 10_000;
    assert.equal(agendaTick(agent, { now }), 'shelter_blocks');
    assert.match(agent.self_prompter.prompt, /builds a shelter from sturdy blocks/);
    assert.equal(tickFor(60_000), 'shelter_blocks', 'not stuck 1 min later');
    assert.ok(agent.agenda.spentOn('shelter_blocks').llm_ms <= 70_000, JSON.stringify(agent.agenda.spentOn('shelter_blocks')));
    assert.ok(!agent.said.some(l => /stuck/.test(l)), agent.said.join('\n'));

    // 3. A third change in the same dusk (the pickaxe is lost, the piles were used): no new budget.
    items.splice(items.findIndex(i => i.name === 'stone_pickaxe'), 1);
    items.splice(items.findIndex(i => i.name === 'betterwithmods:dirt_pile'), 1);
    now += 10_000;
    assert.equal(agendaTick(agent, { now }), 'shelter_blocks');
    assert.match(agent.self_prompter.prompt, /You have no pickaxe yet, so it is built of dirt/);
    assert.ok(agent.agenda.spentOn('shelter_blocks').llm_ms >= 60_000, 'the budget goes on');
    const thirdAt = now;
    assert.equal(tickFor(STEP_LLM_MS), 'stuck');
    assert.equal(agent.said.at(-1), `agenda step shelter_blocks stuck: ${STEP_LLM_MS / 60_000} min of self-prompting; going on without it until the night`);
    // Stuck when the rest of the second budget (5 min less the minute in part 2) is spent.
    assert.ok(now - thirdAt <= STEP_LLM_MS - 50_000, `stuck after ${(now - thirdAt) / 1000} s`);

    // The next dusk starts with a fresh budget and may change once again.
    agent.bot.time.timeOfDay = 1000;
    agendaTick(agent, { now: now += 10_000 });
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
    assert.match(prompt, /you have 4 \(dirt, and dirt from your dirt piles\)\. Dig dirt or grass by hand with !collectBlocks\("betterwithmods:dirt_pile", 40\): dug by hand \(or with a shovel below level 1\) it drops 4 piles of dirt, not a dirt block/);
    assert.doesNotMatch(prompt, /collectBlocks\("dirt"/);
    assert.doesNotMatch(prompt, /rock/i, 'no rock run before the pickaxe step');
    // The static goal (used only when goalNow fails) tells the two cases apart the same way.
    assert.match(SHELTER_RESERVE_STEP.goal, /If you have no pickaxe, it is built of dirt only, which you can dig out of by hand: dig dirt or grass by hand with !collectBlocks\("betterwithmods:dirt_pile", 56\)/);

    items[1].count = 48; // 12 dirt from piles + 2 dirt = 14 (soak 10, S1: the shelter's 10 and the repair spare)
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'sticks', 'enough dirt: the tool steps go on');

    // With a pickaxe, dirt does not count: it asks for sturdy blocks.
    const withPick = [stack('stone_pickaxe', 0, 1), stack('stone_axe', 0, 1), stack('dirt', 0, 20), stack('cobblestone', 0, 3)];
    const b = fakeAgent(t, withPick, { tableNear: true });
    b.bot.time = { timeOfDay: dayAt(7) };
    b.agenda.done_at.cobblestone = 1; // the cobblestone step was done once; the cobblestone was used since
    assert.equal(agendaTick(b, { now: 0 }), 'shelter_blocks');
    assert.match(b.self_prompter.prompt, /builds a shelter from sturdy blocks \(any cobblestone or stone\)\. It needs 10 on open ground and 4 more for repairs \(14\), and you have 3\./);
});

test('#291 nit: the pile the reserve asks for keeps its recipe variant (meta); on 3.3.4 it is betterwithmods:dirt_pile, 4 per dirt', () => {
    assert.deepEqual(dirtPile(), { name: 'betterwithmods:dirt_pile', per: 4 }, 'the real rotn-data recipe');
    const recipe = (meta) => () => [{ name: 'somemod:dirt_bits', meta, per: 8, gives: { name: 'minecraft:dirt', meta: 0 } }];
    assert.deepEqual(dirtPile(recipe(3)), { name: 'somemod:dirt_bits:3', per: 8 });
    assert.deepEqual(dirtPile(recipe(0)), { name: 'somemod:dirt_bits', per: 8 });
});

// CX23 soak (rotn-v0.1.3): "Night is near: in about 2 min" at 17:07, with sunset at about 17:19.
// The time stood at the morning freeze (3001), and the minutes counted none of the freeze still to
// run. The minutes the bot is told now count it (FREEZE_MIN less the minutes the time has stood);
// the reserve is still due from the freeze on.
test('CX23 soak: at the morning freeze the reserve says the minutes left with the freeze still to run, not the least certain time', (t) => {
    const items = [stack('pyrotech:rock', 0, 6)];
    const at = (agentNow, frozenSince) => {
        const agent = fakeAgent(t, items);
        agent.bot.time = { timeOfDay: MORNING_FREEZE };
        const clock = new NightClock({ log: () => {} });
        clock.observe(MORNING_FREEZE, frozenSince);
        agent._night = { clock };
        t.mock.timers.enable({ apis: ['Date'], now: agentNow });
        assert.equal(agendaTick(agent, { now: agentNow }), 'shelter_blocks', 'due from the freeze on, as before');
        t.mock.timers.reset();
        return /Night is near: in about (\d+) min/.exec(agent.self_prompter.prompt)?.[1];
    };
    const base = (NIGHT_START - MORNING_FREEZE) / TICKS_PER_MIN; // ~7.96 min after the freeze
    // Just frozen (the soak at 17:07): about 8 + 10 - 6 = 12 min, not 2.
    assert.equal(at(100_000, 100_000), String(Math.round(base + FREEZE_MIN - 6)));
    // Frozen for 8 min: 2 min of the freeze left: about 4.
    assert.equal(at(1_000_000, 1_000_000 - 8 * 60_000), String(Math.round(base + 2 - 6)));
    // Frozen longer than the freeze: the least certain time again.
    assert.equal(at(2_000_000, 2_000_000 - 30 * 60_000), String(Math.round(base - 6)));
    assert.equal(sunsetEstimateMin(MORNING_FREEZE, 0), minutesToSunset(MORNING_FREEZE) + FREEZE_MIN);
    assert.equal(sunsetEstimateMin(dayAt(5), 3), minutesToSunset(dayAt(5)), 'away from the freeze: unchanged');
});

test('#418 nit: just before the morning freeze (2996-3000) the freeze is counted once, not twice', () => {
    for (const t of [2996, 2998, 3000]) {
        assert.equal(sunsetEstimateMin(t, 0), minutesToSunset(t), `${t}: minutesToSunset already counts the freeze ahead`);
        assert.ok(minutesToSunset(t) > (NIGHT_START - t) / TICKS_PER_MIN + FREEZE_MIN - 0.01, `${t}: with the freeze`);
    }
    // At the freeze and just past it (the tolerance), the part still to run is added, as before.
    assert.equal(sunsetEstimateMin(MORNING_FREEZE, 0), minutesToSunset(MORNING_FREEZE) + FREEZE_MIN);
    assert.ok(Math.abs(sunsetEstimateMin(MORNING_FREEZE + 3, 4) - (minutesToSunset(MORNING_FREEZE + 3) + FREEZE_MIN - 4)) < 1e-9);
    assert.equal(sunsetEstimateMin(MORNING_FREEZE + 50, 0), minutesToSunset(MORNING_FREEZE + 50), 'well past it: as minutesToSunset');
});

test('#425 review: stuck at 2996-3000 (the freeze window) the minutes already frozen come off, at most FREEZE_MIN', () => {
    const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`);
    for (const t of [2996, 2998, 3000]) {
        near(sunsetEstimateMin(t, 4), minutesToSunset(t) - 4, `${t}, frozen 4 min`);
        near(sunsetEstimateMin(t, 30), minutesToSunset(t) - FREEZE_MIN, `${t}, frozen 30 min: the whole freeze, no more`);
        near(sunsetEstimateMin(t, -2), minutesToSunset(t), `${t}: a negative frozen time counts as 0`);
    }
    // Stuck at 3000 for 4 min reads the same as stuck at 3001 for 4 min (within a tick's worth).
    assert.ok(Math.abs(sunsetEstimateMin(3000, 4) - sunsetEstimateMin(MORNING_FREEZE, 4)) < 0.01);
    // Outside the window: unchanged.
    near(sunsetEstimateMin(2990, 4), minutesToSunset(2990), '2990 is not the freeze');
});

// G4 #5 (CX23 soak m1, test/evidence/g4/g4soak-m1-20261108): the agenda was done after 8.5 min,
// nothing then got food, and food fell to 1 (food_floor and ate_when_low failed). The food reserve:
// after the shelter reserve and before the step, after "agenda done" too, with its own budget.
// Soak 5 (Fix H): an unarmed bot is told to forage, not hunt; these bots hold an axe unless a case says unarmed.
function foodAgent(t, items, { food = 12, timeOfDay = 1000, finished = true, now = () => Date.now(), entities = {}, armed = true } = {}) {
    const agent = fakeAgent(t, armed ? [...items, stack('stone_axe', 0, 1)] : items);
    agent.agenda = new Agenda('FRCFLD', { dir: tempDir(t), now, weapon: null });
    if (finished) agent.agenda.finish(); else agent.agenda.start();
    const self = { id: 0, type: 'player', position: new Vec3(0.5, 64, 0.5) };
    Object.assign(agent.bot, { food, time: { timeOfDay }, entity: self, entities: { 0: self, ...entities } });
    return agent;
}

test('G4 #5: the soak\'s case (agenda done, nothing held, food 12, by day): the food reserve runs, naming the wild animals near and the rules', (t) => {
    const cow = { id: 1, type: 'mob', name: 'animania:cow_holstein', metadata: { 7: 10 }, position: new Vec3(6.5, 64, 0.5) };
    const named = { id: 2, type: 'mob', name: 'animania:sow_old_spot', metadata: { 7: 10, 2: 'Wilbur' }, position: new Vec3(3.5, 64, 0.5) };
    const agent = foodAgent(t, [], { entities: { 1: cow, 2: named } });
    assert.equal(agendaTick(agent, { now: 0 }), 'food');
    assert.equal(agent.said.at(-1), 'agenda step food started: hold food items for the day and the night (not the hunger bar)');
    const p = agent.self_prompter.prompt;
    // Soak 13 (C3a): the step wants food held; the bar does not count (the model read "food 13 ... at least 12" as met).
    // Soak 14 (F1): in food points (hunger + saturation), the drain rotn-data measured, and the eat rule.
    assert.match(p, /^RotN agenda, step food \(food\): Food: you hold food worth 0 points in your inventory; this step wants food worth at least 12 points held \(your hunger bar, 12 of 20, does not count toward it\)\. On this pack food falls about 1 point every 4 minutes at rest \(a sealed night costs about 7\) and about 1 every 1\.5 minutes while walking or hunting, and starving kills\. .*You eat by yourself at food 8 or lower, the least valuable food first: keep the rest\. /);
    assert.doesNotMatch(p, /get to at least/);
    assert.match(p, /Near you: animania:cow_holstein: kill one with !attack\("animania:cow_holstein"\)/);
    assert.doesNotMatch(p, /sow_old_spot/, 'a named animal is never offered');
    assert.match(p, /Never an animal with a name tag, on a leash, tamed, or near fences, farms or houses/);
    assert.equal(foodDue(agent), true, 'the hunting reflex agrees');
    // Food worth 12 held: done; the agenda is idle again.
    agent.bot.inventory = { items: () => [stack('bread', 0, 4)], slots: [] };
    assert.equal(agendaTick(agent, { now: TICK_MS }), null);
    assert.equal(foodDue(agent), false);
});

test('G4 #5: during the agenda only an urgent need; before night the night\'s need (soak 14: points), after the shelter blocks; at night never', (t) => {
    // Running agenda, by day, bread held, food 15: the steps go on.
    const busy = foodAgent(t, [stack('bread', 0, 1)], { food: 15, finished: false });
    assert.equal(agendaTick(busy, { now: 0 }), 'rocks');
    // Food 12 and nothing held: food first.
    const hungry = foodAgent(t, [], { food: 12, finished: false });
    assert.equal(agendaTick(hungry, { now: 0 }), 'food');
    // Before night: the shelter blocks first, then food (soak 14: the night's need, 7 + 0.3 x 26 - food = 6.8 points at food 8).
    const pick = stack('stone_pickaxe', 0, 1);
    const dusk = foodAgent(t, [pick, stack('bread', 0, 1)], { food: 18, finished: true, timeOfDay: dayAt(7) });
    assert.equal(agendaTick(dusk, { now: 0 }), 'shelter_blocks');
    const ready = foodAgent(t, [pick, stack('cobblestone', 0, SHELTER_HOLD), stack('bread', 0, 1)], { food: 8, finished: true, timeOfDay: dayAt(7) });
    assert.equal(agendaTick(ready, { now: 0 }), 'food', 'blocks held, 4.2 points held of 6.8: food');
    const fed = foodAgent(t, [pick, stack('cobblestone', 0, SHELTER_HOLD), stack('bread', 0, 2)], { food: 8, finished: true, timeOfDay: dayAt(7) });
    assert.equal(agendaTick(fed, { now: 0 }), null, '8.4 points held: nothing to do');
    const full = foodAgent(t, [pick, stack('cobblestone', 0, SHELTER_HOLD)], { food: 20, finished: true, timeOfDay: dayAt(7) });
    assert.equal(agendaTick(full, { now: 0 }), null, 'a full bar (20): the night needs nothing more');
    // Night: never out for food, starving or not.
    const night = foodAgent(t, [], { food: 2, finished: true, timeOfDay: NIGHT_START + 500 });
    assert.equal(agendaTick(night, { now: 0 }), null);
    assert.equal(foodDue(night), false);
});

test('G4 #5: the food reserve\'s own budget: spent, it says so and is not asked again for FOOD_RETRY_MS; then a fresh budget', (t) => {
    let clock = 1_000_000;
    const agent = foodAgent(t, [], { now: () => clock });
    assert.equal(agendaTick(agent, { now: clock }), 'food');
    agent.agenda.spent.food = { attempts: 99, llm_ms: 1e9 };
    assert.equal(agendaTick(agent, { now: clock + TICK_MS }), 'stuck');
    assert.match(agent.said.at(-1), /^agenda step food stuck: .*; going on without it for 10 min$/);
    clock += FOOD_RETRY_MS - 1000;
    assert.equal(agendaTick(agent, { now: clock }), null, 'not asked again yet');
    clock += 2000;
    assert.equal(agendaTick(agent, { now: clock }), 'food', 'asked again');
    assert.deepEqual(agent.agenda.spentOn('food').attempts <= 1, true, 'with a fresh budget');
    assert.equal(FOOD_RESERVE_STEP.when, 'food');
});

test('#422 review 8: at most FOOD_DAY_RUNS self-prompter runs for the food reserve per in-game day; the next day it runs again', (t) => {
    const agent = foodAgent(t, []);
    agent.bot.time.day = 4;
    const state = agendaState(agent.bot);
    assert.equal(agent.agenda.foodWanted(state)?.id, 'food');
    for (let i = 0; i < FOOD_DAY_RUNS; i++) agent.agenda.recordAttempt('food');
    assert.equal(agent.agenda.foodWanted(state), null, 'this day\'s runs are used');
    agent.bot.time.day = 5;
    assert.equal(agent.agenda.foodWanted(agendaState(agent.bot))?.id, 'food', 'a new day');
    assert.ok(FOOD_DAY_RUNS <= 3, 'bounded spend (ADR 0010)');
});

test('G4 #5 forage: the food reserve names the ripe wild food near (full block names) and asks for !forage before a hunt', (t) => {
    const cow = { id: 1, type: 'mob', name: 'animania:cow_holstein', metadata: { 7: 10 }, position: new Vec3(6.5, 64, 0.5) };
    const agent = foodAgent(t, [], { entities: { 1: cow } });
    const crops = { '4,64,0': ['rustic:wildberry_bush', 1], '5,64,0': ['rustic:wildberry_bush', 0], '-6,64,0': ['harvestcraft:aridgarden', 0], '8,64,8': ['biomesoplenty:plant_0', 5] };
    const at = (k) => ({ name: crops[k][0], metadata: crops[k][1], position: new Vec3(...k.split(',').map(Number)) });
    agent.bot.blockAt = (p) => { const k = `${p.x},${p.y},${p.z}`; return crops[k] ? at(k) : { name: 'air', metadata: 0, position: p }; };
    agent.bot.findBlocks = ({ point, maxDistance, matching }) => Object.keys(crops).map(at)
        .filter(b => b.position.distanceTo(point ?? agent.bot.entity.position) <= maxDistance && matching(b)).map(b => b.position);
    assert.equal(agendaTick(agent, { now: 0 }), 'food');
    const p = agent.self_prompter.prompt;
    assert.match(p, /Ripe wild food near you: rustic:wildberry_bush, harvestcraft:aridgarden: gather it first with !forage/);
    assert.ok(p.indexOf('!forage') < p.indexOf('!attack'), 'foraging before hunting');
    assert.doesNotMatch(p, /plant_0/, 'never the hawthorn');
    assert.match(FOOD_RESERVE_STEP.goal, /Gather ripe wild food first with !forage/);
});

test('soak 2: the food reserve says food 0 kills at once; at food 4 or lower it asks for no hunt (weakness) but eating what it holds and !forage; at food 5 or lower it names the emergency foods (#432 nit)', (t) => {
    assert.match(FOOD_RESERVE_STEP.goal, /food 0 kills you at once, at any health/);
    const cow = { id: 1, type: 'mob', name: 'animania:cow_holstein', metadata: { 7: 10 }, position: new Vec3(6.5, 64, 0.5) };
    const weak = foodAgent(t, [], { food: 4, entities: { 1: cow } });
    assert.equal(agendaTick(weak, { now: 0 }), 'food');
    const p = weak.self_prompter.prompt;
    assert.match(p, /Food 0 kills you at once on this pack, at any health, and long walks cost hunger: stay near\./);
    assert.match(p, /At food 4 you are too weak to hunt \(weakness\): eat the food you hold, and !forage nearby; do not walk far\./);
    assert.doesNotMatch(p, /!attack\(/, 'no hunt offered');
    // #432 review 3: no "never eat" contradicting it.
    assert.doesNotMatch(p, /Do not eat raw chicken or rotten flesh/);
    // #432 nit: the allowed emergency foods are named, in order, and nothing wider.
    assert.match(p, /At food 5 or lower, with no other food, eat only these, in this order: a golden apple, raw venison, raw tofenison, raw chicken, rotten flesh, then hawthorn berries; never cloudsbluff, chorus fruit, pufferfish, raw eggs or any other food\./);
    assert.doesNotMatch(p, /anything edible|eat anything/);
    assert.match(FOOD_RESERVE_STEP.goal, /Do not eat raw chicken or rotten flesh unless your food is 5 or lower, and then only these, in this order: a golden apple, raw venison, raw tofenison, raw chicken, rotten flesh, then hawthorn berries; never cloudsbluff, chorus fruit, pufferfish, raw eggs or any other food\./);
    const fed = foodAgent(t, [], { food: 10, entities: { 1: cow } });
    agendaTick(fed, { now: 0 });
    assert.match(fed.self_prompter.prompt, /!attack\("animania:cow_holstein"\)/, 'at food 10 the hunt is offered');
    assert.match(fed.self_prompter.prompt, /Do not eat raw chicken or rotten flesh; cooked meat and bread are good night food\./);
});

test('#422 nit: the day\'s last food run is not stopped as it starts: it runs until it ends, and only then is no new one started', (t) => {
    const agent = foodAgent(t, []);
    agent.bot.time.day = 4;
    const sp = agent.self_prompter;
    let clock = 0;
    const tick = () => { clock += TICK_MS; return agendaTick(agent, { now: clock }); };
    // Two runs this day already (each ended by the model).
    agent.agenda.foodDay = { key: 'day 4', runs: FOOD_DAY_RUNS - 1 };
    assert.equal(tick(), 'food');
    assert.equal(sp.starts.length, 1, 'the last run starts');
    assert.equal(agent.agenda.foodDay.runs, FOOD_DAY_RUNS, 'and is counted');
    // On develop the next tick saw the cap reached and stopped it about 2 s in.
    for (let i = 0; i < 5; i++) assert.equal(tick(), 'food', `tick ${i}: the running one goes on`);
    assert.equal(sp.stops, 0, 'never stopped by the cap');
    assert.equal(sp.isActive(), true);
    // The run ends: the cap now holds, and no new run starts this day.
    sp.stop();
    clock += BACKOFF_MS * 8;
    assert.equal(tick(), null);
    assert.equal(sp.starts.length, 1, 'no 4th run');
    assert.equal(agent._agenda_step, null);
});


// #463 decision (soak 3, rotn-v0.1.5: stone_axe stuck at 20:12 paused the agenda, and the bot
// idled for 67 min, food 8 -> 2): an autonomous bot never goes idle. A stuck step is retried with a
// fresh budget after STUCK_RETRY.cooldownMs or at the next full day, at most STUCK_RETRY.max times;
// meanwhile the steps that do not need it go on, else food, else the shelter's blocks.
function doneAgent(t, doneIds, items = [], { food = 18, timeOfDay = 1000, day = 1, clock } = {}) {
    const agent = fakeAgent(t, items);
    agent.agenda = new Agenda('FRCFLD', { dir: tempDir(t), now: () => clock.now });
    agent.agenda.start();
    for (const id of doneIds) agent.agenda.done_at[id] = 1;
    const self = { id: 0, type: 'player', position: new Vec3(0.5, 64, 0.5) };
    Object.assign(agent.bot, { food, time: { timeOfDay, day }, entity: self, entities: { 0: self } });
    return agent;
}
const FIRST_NINE = ['rocks', 'sticks', 'crude_axe', 'logs', 'first_plank', 'crafting_tools', 'crafting_table', 'planks_sticks', 'stone_pickaxe'];

test('#463 decision: stone_axe stuck: the agenda stays active and goes on with cobblestone (it does not need the axe); the retry comes after the cooldown, with a fresh budget, and is said', (t) => {
    const clock = { now: 1_000_000 };
    const agent = doneAgent(t, FIRST_NINE, [stack('bread', 0, 4), stack('stone_pickaxe', 0, 1)], { clock });
    let now = 0;
    const tick = () => { now += TICK_MS; return agendaTick(agent, { now }); };
    assert.equal(tick(), 'stone_axe');
    agent.agenda.spent.stone_axe = { attempts: 1, llm_ms: STEP_LLM_MS };
    assert.equal(tick(), 'stuck');
    assert.equal(agent.said.at(-1), 'agenda step stone_axe stuck: 5 min of self-prompting; retry 1 of 3 in 20 min or at the next full day; going on with the steps that do not need it');
    assert.equal(agent.agenda.active, true);
    assert.equal(tick(), 'cobblestone', 'cobblestone needs the pickaxe, not the axe');
    assert.match(agent.self_prompter.prompt, /^RotN agenda, step 11 of 11 \(cobblestone\)/);
    assert.equal(agent.self_prompter.isActive(), true, 'self-prompting, not idle');
    clock.now += STUCK_RETRY.cooldownMs - 1000;
    assert.equal(tick(), 'cobblestone', 'not yet');
    clock.now += 1000;
    assert.equal(tick(), 'stone_axe', 'retried: back to the first step not done');
    assert.ok(agent.said.includes('agenda step stone_axe retried (1 of 3): a fresh budget'));
    assert.deepEqual(agent.agenda.spentOn('stone_axe').llm_ms, 0, 'a fresh budget');
});

test('#463 decision: the retry also comes at the next full day, if that is sooner than the cooldown', (t) => {
    const clock = { now: 1_000_000 };
    const agent = doneAgent(t, FIRST_NINE, [stack('bread', 0, 4), stack('stone_pickaxe', 0, 1)], { clock, day: 4, timeOfDay: 1000 });
    let now = 0;
    const tick = () => { now += TICK_MS; return agendaTick(agent, { now }); };
    tick();
    agent.agenda.spent.stone_axe = { attempts: 1, llm_ms: STEP_LLM_MS };
    assert.equal(tick(), 'stuck');
    clock.now += 5 * 60_000;
    agent.bot.time = { timeOfDay: 23700, day: 4 }; // the sunrise: not full day yet
    tick();
    assert.equal(agent.agenda.stuck.stone_axe.cooling, true);
    agent.bot.time = { timeOfDay: 1000, day: 5 }; // the next day, full daylight
    assert.equal(tick(), 'stone_axe');
    assert.ok(agent.said.includes('agenda step stone_axe retried (1 of 3): a fresh budget'));
});

test('#468 review 2: after 3 retries the step is never given up: one retry at each new full day, without limit; the steps that do not need it still go on', (t) => {
    const clock = { now: 1_000_000 };
    const agent = doneAgent(t, FIRST_NINE, [stack('bread', 0, 4), stack('stone_pickaxe', 0, 1)], { clock, day: 1 });
    let now = 0;
    const tick = () => { now += TICK_MS; return agendaTick(agent, { now }); };
    const stuckNow = () => { agent.agenda.spent.stone_axe = { attempts: 1, llm_ms: STEP_LLM_MS }; return tick(); };
    for (let retry = 1; retry <= 3; retry++) {
        assert.equal(tick(), 'stone_axe');
        assert.equal(stuckNow(), 'stuck');
        assert.match(agent.said.at(-1), new RegExp(`retry ${retry} of 3 in 20 min`));
        clock.now += STUCK_RETRY.cooldownMs;
    }
    assert.equal(tick(), 'stone_axe');
    assert.equal(stuckNow(), 'stuck');
    assert.equal(agent.said.at(-1), 'agenda step stone_axe stuck: 5 min of self-prompting; its 3 retries are spent: one retry at each new full day; going on with the steps that do not need it');
    clock.now += 10 * STUCK_RETRY.cooldownMs;
    assert.equal(tick(), 'cobblestone', 'the cooldown alone no longer retries it');
    assert.match(describeAgenda(agent.agenda, agent.agenda.judge(agendaState(agent.bot), { readOnly: true }).step), /; stuck: stone_axe waits for its retry at the next full day \(3 retries spent\)/);
    for (let day = 2; day <= 4; day++) {
        agent.bot.time = { timeOfDay: 1000, day };
        assert.equal(tick(), 'stone_axe', `day ${day}: retried`);
        assert.equal(agent.said.filter(l => l === `agenda step stone_axe retried (${day + 2}, at a new full day): a fresh budget`).length, 1);
        assert.equal(stuckNow(), 'stuck');
        assert.equal(tick(), 'cobblestone', 'not again the same day');
    }
    assert.equal(agent.agenda.active, true);
    assert.ok(!agent.said.includes('agenda done'), 'never finished by giving up');
});

test('#468 review 1: every step left waits on the stuck one: food first (a standing duty); fed: agendaTick returns null with the open goal (which step, what failed, when retried), never "agenda done"', (t) => {
    const clock = { now: 1_000_000 };
    // rocks stuck: everything but sticks needs it; sticks done.
    const agent = doneAgent(t, ['sticks'], [stack('iron_sword', 0, 1)], { clock, food: 14 }); // armed (a sword no step needs): food, not the weapon (Fix H)
    let now = 0;
    const tick = () => { now += TICK_MS; return agendaTick(agent, { now }); };
    assert.equal(tick(), 'rocks');
    agent.agenda.spent.rocks = { attempts: 1, llm_ms: STEP_LLM_MS };
    assert.equal(tick(), 'stuck');
    assert.equal(tick(), 'food', 'food 14, none held: the day\'s target as a standing duty');
    assert.equal(agent._agenda_open_goal, null);
    agent.bot.inventory = { items: () => [stack('bread', 0, 4), stack('iron_sword', 0, 1)], slots: [] };
    assert.equal(tick(), null, 'nothing runnable');
    assert.match(agent._agenda_open_goal, /^Open goal while the agenda waits: step rocks \(collect 6 rocks\) is stuck: 5 min of self-prompting; it is retried with a fresh budget in about 20 min or at the next full day\. Its goal was: Collect at least 6 rocks/);
    assert.match(agent._agenda_open_goal, /Until then: gather the materials it needs, and explore nearby for them .*Keep food worth at least \d+ points, and keep 14 blocks of dirt \(no pickaxe yet\) for the night's shelter and its repairs: do not place them\.$/);
    assert.equal(agent.said.filter(l => l === 'agenda open goal: step rocks waits; self-prompting on gathering for it').length, 1);
    clock.now += 5 * 60_000;
    assert.equal(tick(), null);
    assert.match(agent._agenda_open_goal, /in about 15 min/, 'kept current');
    assert.equal(agent.said.filter(l => /^agenda open goal/.test(l)).length, 1, 'said once');
    assert.ok(!agent.said.includes('agenda done'));
    clock.now += STUCK_RETRY.cooldownMs;
    assert.equal(tick(), 'rocks');
    assert.equal(agent._agenda_open_goal, null);
});

test('#468 review 5: !agenda (judge readOnly) changes no reserve\'s budget', (t) => {
    const clock = { now: 1_000_000 };
    const agent = doneAgent(t, [], [stack('stone_axe', 0, 1)], { clock, food: 12 }); // armed (Fix H)
    const a = agent.agenda;
    a.spent.food = { attempts: 2, llm_ms: 1000 };
    a.foodOffUntil = clock.now - 1; // its wait is over: a write would give a fresh budget
    a.spent.shelter_blocks = { attempts: 1, llm_ms: 5 };
    a.reserveOff = true;
    const before = JSON.stringify({ spent: a.spent, off: a.foodOffUntil, day: a.foodDay, reserveOff: a.reserveOff });
    agent.bot.time = { timeOfDay: 1000, day: 7 };
    assert.equal(a.judge(agendaState(agent.bot), { readOnly: true }).step.id, 'food');
    agent.bot.time = { timeOfDay: NIGHT_START - 2 * 1199, day: 7 }; // dusk: the shelter reserve's window
    a.judge(agendaState(agent.bot), { readOnly: true });
    agent.bot.time = { timeOfDay: NIGHT_START + 500, day: 7 }; // night: nothing due
    a.judge(agendaState(agent.bot), { readOnly: true });
    assert.equal(JSON.stringify({ spent: a.spent, off: a.foodOffUntil, day: a.foodDay, reserveOff: a.reserveOff }), before);
    // The query command uses it.
    assert.match(readFileSync(new URL('./commands/queries.js', import.meta.url), 'utf8'), /agent\.agenda\.judge\(agendaState\(agent\.bot, agent\._night\?\.clock\), \{ readOnly: true \}\)/);
});

test('#468 review 4: an agenda.json from before (one stuck step, the agenda paused) keeps the agenda inactive, with that step waiting; a giver\'s !agendaStart resumes it', (t) => {
    const dir = tempDir(t);
    writeFileSync(path.join(dir, 'agenda.json'), JSON.stringify({ version: 1, active: false, finished: false, done_at: {}, spent: { stone_axe: { attempts: 1, llm_ms: STEP_LLM_MS } }, stuck: { id: 'stone_axe', why: '5 min of self-prompting', at: 5 } }));
    const a = new Agenda('FRCFLD', { dir, now: () => 10 });
    assert.equal(a.active, false, 'not reactivated');
    assert.deepEqual(a.stuck.stone_axe, { why: '5 min of self-prompting', at: 5, day: null, retries: 0, cooling: true, capped: false });
    a.save();
    const b = new Agenda('FRCFLD', { dir, now: () => 10 });
    assert.equal(b.stuck.stone_axe.cooling, true, 'the new form round-trips');
    b.start();
    assert.deepEqual([b.active, b.stuck, b.spentOn('stone_axe').attempts], [true, {}, 0]);
});

// Soak 3 (rotn-v0.1.5): after the first death the bot never held a weapon again; bare hands did not
// hurt the zombies digging into its shelter, which hit for 6-8 (12 deaths). The lead's decision: a
// weapon in the before-night reserve.
test('soak 3, soak 10 (W2): before night, after the shelter\'s blocks and before food, the weapon reserve asks for a wooden club (2 logs, no table); a crude axe is no weapon; a club held: done', (t) => {
    const blocks = [stack('pyrotech:rock', 0, 6), stack('dirt', 0, SHELTER_HOLD), stack('stick', 0, 1)];
    const agent = fakeAgent(t, blocks, { weapon: WEAPON_RESERVE_STEP });
    agent.bot.time = { timeOfDay: dayAt(7) };
    assert.equal(agendaTick(agent, { now: 0 }), 'weapon');
    assert.equal(agent.said.at(-1), 'agenda step weapon started: hold a weapon for the night');
    const p = agent.self_prompter.prompt;
    assert.match(p, /^RotN agenda, step weapon \(before night\): Night is near and you hold no weapon\. Zombies here hit for 3 each, several at once/);
    assert.match(p, /You hold 0 logs\. Craft a wooden club from 2 logs in your inventory grid \(no crafting table needed\): !craftRecipe\("spartanweaponry:club_wood", 1\)\. It hits for 4 and lasts 131 hits/);
    assert.match(p, /The crude axe is a tool, not a weapon: it breaks on its 5th hit, before it kills one zombie/);
    assert.doesNotMatch(p, /stone_axe|!craftRecipe\("pyrotech:crude_axe"/);
    // Soak 10 (W1): a crude axe held is no weapon: still the reserve.
    blocks.push(stack('pyrotech:crude_axe', 0, 1));
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'weapon');
    // A wooden club held: the step goes on.
    blocks.push(stack('spartanweaponry:club_wood', 0, 1));
    assert.equal(agendaTick(agent, { now: 2 * TICK_MS }), 'sticks');
    // The shelter's blocks come first.
    const few = fakeAgent(t, [stack('pyrotech:rock', 0, 6)], { weapon: WEAPON_RESERVE_STEP });
    few.bot.time = { timeOfDay: dayAt(7) };
    assert.equal(agendaTick(few, { now: 0 }), 'shelter_blocks');
    // By day (not near night) and at night: not asked.
    const day = fakeAgent(t, blocks.slice(0, 3), { weapon: WEAPON_RESERVE_STEP });
    day.bot.time = { timeOfDay: 1000 };
    assert.equal(agendaTick(day, { now: 0 }), 'sticks');
    const night = fakeAgent(t, blocks.slice(0, 3), { weapon: WEAPON_RESERVE_STEP });
    night.bot.time = { timeOfDay: NIGHT_START + 500 };
    assert.equal(night.agenda.weaponWanted(agendaState(night.bot)), null);
});

test('soak 3: the weapon reserve\'s own budget: spent, not again until the night is past; then fresh', (t) => {
    const agent = fakeAgent(t, [stack('pyrotech:rock', 0, 6), stack('dirt', 0, SHELTER_HOLD)], { weapon: WEAPON_RESERVE_STEP });
    agent.bot.time = { timeOfDay: dayAt(7) };
    assert.equal(agendaTick(agent, { now: 0 }), 'weapon');
    agent.agenda.spent.weapon = { attempts: 1, llm_ms: STEP_LLM_MS };
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'stuck');
    assert.equal(agent.said.at(-1), `agenda step weapon stuck: ${STEP_LLM_MS / 60_000} min of self-prompting; going on without it until the night`);
    assert.equal(agent.agenda.active, true);
    assert.equal(agendaTick(agent, { now: 2 * TICK_MS }), 'sticks', 'the step goes on');
    agent.bot.time = { timeOfDay: 1000 }; // the next morning
    agendaTick(agent, { now: 3 * TICK_MS });
    agent.bot.time = { timeOfDay: dayAt(7) };
    assert.equal(agendaTick(agent, { now: 4 * TICK_MS }), 'weapon', 'fresh again at the next dusk');
    assert.equal(agent.agenda.spentOn('weapon').llm_ms, 0);
});

test('#470 nit: a giver\'s !agendaStart clears a stuck step\'s saved open-goal window', (t) => {
    const dir = tempDir(t);
    const a = new Agenda('FRCFLD', { dir, now: () => 10 });
    a.start();
    a.markStuck('stone_axe', '5 min of self-prompting');
    a.stuck.stone_axe.openGoal = { key: 'stone_axe@10', llmMs: 120_000, starts: 4, lastStartAt: 9, ended: true };
    a.save();
    const b = new Agenda('FRCFLD', { dir, now: () => 20 });
    assert.equal(b.stuck.stone_axe.openGoal.llmMs, 120_000, 'saved');
    b.start();
    const c = new Agenda('FRCFLD', { dir, now: () => 30 });
    assert.deepEqual(c.stuck, {}, 'cleared, with its window');
});

// Soak 5 (the lead's Fix H, which updates the soak 3 decision): after a death the bot went hunting
// with no weapon and no food (~30 commands, !attack on a sow bare-handed) and died to zombies by day.
// With no weapon the weapon reserve comes before food at any time of day, unless food is 6 or lower;
// unarmed, the food step says forage first and names no animal.
function hFixAgent(t, items, { food = 12, timeOfDay = 1000, finished = true, entities = {} } = {}) {
    const agent = fakeAgent(t, items);
    agent.agenda = new Agenda('FRCFLD', { dir: tempDir(t), weapon: WEAPON_RESERVE_STEP });
    if (finished) agent.agenda.finish(); else agent.agenda.start();
    const self = { id: 0, type: 'player', position: new Vec3(0.5, 64, 0.5) };
    Object.assign(agent.bot, { food, time: { timeOfDay }, entity: self, entities: { 0: self, ...entities } });
    return agent;
}

test('soak 5 (Fix H): unarmed and short of food by day, the weapon comes before food; once armed, food (and the hunt is offered)', (t) => {
    assert.deepEqual(WEAPON_FIRST, { foodAtMost: 6 });
    const cow = { id: 1, type: 'mob', name: 'animania:cow_holstein', metadata: { 7: 10 }, position: new Vec3(6.5, 64, 0.5) };
    const items = [stack('pyrotech:rock', 0, 2)];
    const agent = hFixAgent(t, items, { entities: { 1: cow } });
    assert.equal(agendaTick(agent, { now: 0 }), 'weapon');
    const p = agent.self_prompter.prompt;
    assert.match(p, /^RotN agenda, step weapon \(no weapon, before food\): You hold no weapon and you are short of food: the weapon comes first \(hunting needs one, and zombies attack by day too\); the agenda goes on to food once you hold one\. /);
    assert.match(p, /You hold 0 logs\. Craft a wooden club/);
    assert.doesNotMatch(p, /Night is near/);
    // A wooden club made (soak 10: the crude axe is no weapon): food next, with the hunt offered.
    items.push(stack('spartanweaponry:club_wood', 0, 1));
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'food');
    assert.match(agent.self_prompter.prompt, /Near you: animania:cow_holstein: kill one with !attack\("animania:cow_holstein"\)/);
    // Running agenda too (not only once it is done).
    const running = hFixAgent(t, [], { finished: false });
    assert.equal(agendaTick(running, { now: 0 }), 'weapon');
    // Not short of food: no weapon asked by day (the steps go on), as before.
    const fed = hFixAgent(t, [], { food: 18, finished: false });
    assert.equal(agendaTick(fed, { now: 0 }), 'rocks');
});

test('soak 5 (Fix H): unarmed at food 6 or lower, food first; the food step says forage and names no animal; before night the weapon label is unchanged', (t) => {
    const cow = { id: 1, type: 'mob', name: 'animania:cow_holstein', metadata: { 7: 10 }, position: new Vec3(6.5, 64, 0.5) };
    const low = hFixAgent(t, [], { food: 6, entities: { 1: cow } });
    assert.equal(agendaTick(low, { now: 0 }), 'food');
    const p = low.self_prompter.prompt;
    assert.match(p, /You hold no weapon: gather ripe wild food with !forage \(berry bushes, wild herbs, HarvestCraft gardens; look around nearby, do not walk far\); hunting waits until you hold a weapon\./);
    assert.doesNotMatch(p, /!attack\(|cow_holstein|!searchForEntity/, 'no animal named, no hunt offered');
    // At food 7 the weapon comes first again.
    const seven = hFixAgent(t, [], { food: 7 });
    assert.equal(agendaTick(seven, { now: 0 }), 'weapon');
    // Before night: the soak 3 label and text.
    const dusk = hFixAgent(t, [stack('dirt', 0, SHELTER_HOLD), stack('bread', 0, 4)], { food: 18, timeOfDay: dayAt(7) });
    assert.equal(agendaTick(dusk, { now: 0 }), 'weapon');
    assert.match(dusk.self_prompter.prompt, /^RotN agenda, step weapon \(before night\): Night is near and you hold no weapon\./);
});

test('soak 5 (Fix H): the weapon\'s budget spent by day: food then, not the weapon again while food stays short', (t) => {
    const agent = hFixAgent(t, []);
    assert.equal(agendaTick(agent, { now: 0 }), 'weapon');
    agent.agenda.spent.weapon = { attempts: 1, llm_ms: STEP_LLM_MS };
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'stuck');
    assert.equal(agent.said.at(-1), `agenda step weapon stuck: ${STEP_LLM_MS / 60_000} min of self-prompting; going on without it while food is short (food first)`);
    assert.equal(agendaTick(agent, { now: 2 * TICK_MS }), 'food');
    assert.equal(agendaTick(agent, { now: 3 * TICK_MS }), 'food', 'still food');
    // !agenda (readOnly) agrees and changes nothing.
    const fresh = hFixAgent(t, []);
    assert.equal(fresh.agenda.judge(agendaState(fresh.bot), { readOnly: true }).step.id, 'weapon');
});

// #500 follow-up 3: the weapon asked by day (before food) and spent gets a fresh budget once its
// window turns to before night (#470's dusk weapon).
test('#500 follow-up 3: a weapon spent by day (before food) is asked again with a fresh budget once it is before night', (t) => {
    const agent = hFixAgent(t, [stack('dirt', 0, SHELTER_HOLD)]);
    assert.equal(agendaTick(agent, { now: 0 }), 'weapon');
    agent.agenda.spent.weapon = { attempts: 1, llm_ms: STEP_LLM_MS };
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'stuck');
    assert.equal(agendaTick(agent, { now: 2 * TICK_MS }), 'food', 'off by day while food is short');
    agent.bot.time = { timeOfDay: dayAt(7) }; // dusk: the before-night window; food still short
    assert.equal(agendaTick(agent, { now: 3 * TICK_MS }), 'weapon', 'a fresh dusk budget');
    assert.equal(agent.agenda.spentOn('weapon').llm_ms, 0);
    assert.match(agent.self_prompter.prompt, /step weapon \(before night\): Night is near and you hold no weapon\./);
    // Spent at dusk: not again until the night is past (as in soak 3).
    agent.agenda.spent.weapon = { attempts: 1, llm_ms: STEP_LLM_MS };
    assert.equal(agendaTick(agent, { now: 4 * TICK_MS }), 'stuck');
    assert.notEqual(agendaTick(agent, { now: 5 * TICK_MS }), 'weapon');
    // A query (readOnly) never resets it.
    const q = hFixAgent(t, []);
    q.agenda.weaponOff = true;
    q.agenda.weaponWindow = 'no weapon, before food';
    q.bot.time = { timeOfDay: dayAt(7) };
    q.agenda.judge(agendaState(q.bot), { readOnly: true });
    assert.equal(q.agenda.weaponOff, true);
});

// #500 follow-ups 4 and 5: the standing goal, the open goal and the static food text never send an
// unarmed bot hunting.
test('#500 follow-ups 4 and 5: unarmed, the standing and open goals say forage, do not hunt; the static food goal names no !attack', (t) => {
    assert.equal(NO_WEAPON_FOOD, 'with no weapon: forage for food (!forage), do not hunt; make a weapon first');
    const a = new Agenda('FRCFLD', { dir: tempDir(t) });
    const unarmed = agendaState(fakeBot([]));
    const armed = agendaState(fakeBot([stack('stone_axe', 0, 1)]));
    assert.match(a.standingGoal(unarmed), /for the night's shelter and its repairs \(you have 0; dirt \(no pickaxe yet\)\); with no weapon: forage for food \(!forage\), do not hunt; make a weapon first; keep a weapon/);
    assert.doesNotMatch(a.standingGoal(armed), /with no weapon/);
    a.start();
    a.markStuck('rocks', '5 min of self-prompting');
    assert.match(a.openGoal(unarmed), /Keep food worth at least \d+ points \(with no weapon: forage for food \(!forage\), do not hunt; make a weapon first\), and keep/);
    assert.doesNotMatch(a.openGoal(armed), /with no weapon/);
    assert.doesNotMatch(FOOD_RESERVE_STEP.goal, /!attack/);
    assert.match(FOOD_RESERVE_STEP.goal, /with no weapon, do not hunt: make a weapon first/);
});

// #502 nit 4: the weapon's window is kept in agenda.json, so a budget spent by day still gets its
// fresh dusk budget after a restart (weaponOff itself is rebuilt from the saved spent budget).
test('#502 nit 4: after a restart, a weapon spent by day still gets a fresh budget at dusk', (t) => {
    const dir = tempDir(t);
    const agent = hFixAgent(t, [stack('dirt', 0, SHELTER_HOLD)]);
    agent.agenda = new Agenda('FRCFLD', { dir, weapon: WEAPON_RESERVE_STEP });
    agent.agenda.finish();
    assert.equal(agendaTick(agent, { now: 0 }), 'weapon');
    agent.agenda.spent.weapon = { attempts: 1, llm_ms: STEP_LLM_MS };
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'stuck');
    agent.agenda.save();
    // The restart: a new Agenda from the same file, at dusk.
    const after = hFixAgent(t, [stack('dirt', 0, SHELTER_HOLD)], { timeOfDay: dayAt(7) });
    after.agenda = new Agenda('FRCFLD', { dir, weapon: WEAPON_RESERVE_STEP });
    assert.equal(after.agenda.weaponWindow, 'no weapon, before food', 'the window came back');
    assert.ok(after.agenda.spentOn('weapon').llm_ms >= STEP_LLM_MS, 'and the spent budget');
    assert.equal(agendaTick(after, { now: 0 }), 'weapon', 'a fresh dusk budget, not stuck at once');
    assert.equal(after.agenda.spentOn('weapon').llm_ms, 0);
});

// Soak 7 (rotn-v0.1.13, ate_when_low FAIL): the bot died at 23:24:33 and respawned at food 12 with an
// empty inventory; the agenda put the shelter blocks (night ~12 min off) and the weapon first, food at
// 23:27:21, and the bot first ate 5 min 48 s after its "low" food line (the check allows 5 min). The
// lead's rule (d): after a respawn, hungry with nothing to eat, getting food comes first.
test('soak 7 (d): within FOOD_AFTER_DEATH.windowMs of a death (its time, with or without a spot: #523 nit 1), at food 12 or lower with no food held, food comes before the shelter blocks and the weapon', (t) => {
    assert.deepEqual(FOOD_AFTER_DEATH, { windowMs: 4 * 60_000 });
    const cow = { id: 1, type: 'mob', name: 'animania:cow_holstein', metadata: { 7: 10 }, position: new Vec3(6.5, 64, 0.5) };
    // death_report's own reporter: the death time comes from DeathReporter.deaths (#523 nit 1).
    const died = (agent, agoMs, pos = { x: 0, y: 64, z: 0 }) => {
        const d = new DeathReporter();
        d.died({ pos, dimension: 'overworld', now: Date.now() - agoMs });
        agent.bot.rotnDeathSpots = (now) => d.recentSpots(now);
        agent.bot.rotnLastDeathAt = () => d.lastDeathAt();
        return agent;
    };
    const soak7 = (items = [], opts = {}) => hFixAgent(t, items, { food: 12, timeOfDay: dayAt(7), entities: { 1: cow }, ...opts });
    // No death: the shelter blocks first, as before (night is near).
    assert.equal(agendaTick(soak7(), { now: 0 }), 'shelter_blocks');
    // Soak 14 (F2, the lead): with the night 15 min away or less and too few shelter blocks, the blocks come first
    // after a death (SHELTER_AFTER_DEATH); soak 7's food-first holds when the night is farther (the morning, before the freeze).
    assert.equal(agendaTick(died(soak7(), 20_000), { now: 0 }), 'shelter_blocks', 'night 7 min away: the blocks first');
    const far = (items = [], opts = {}) => soak7(items, { timeOfDay: 1000, ...opts });
    // 20 s after the death (the respawn walk): food first; unarmed, it forages and names no animal (Fix H).
    const after = died(far(), 20_000);
    assert.equal(agendaTick(after, { now: 0 }), 'food');
    // #523 nit 1: a death at an unknown position (no death spot) opens the window too.
    const nowhere = died(far(), 20_000, null);
    assert.deepEqual(nowhere.bot.rotnDeathSpots(), [], 'no spot for a death at an unknown position');
    assert.equal(agendaTick(nowhere, { now: 0 }), 'food');
    assert.match(after.self_prompter.prompt, /You hold no weapon: gather ripe wild food with !forage/);
    assert.doesNotMatch(after.self_prompter.prompt, /!attack\(/);
    // By day too (Fix H would put the weapon first at food 12).
    assert.equal(agendaTick(died(hFixAgent(t, [], { food: 12 }), 20_000), { now: 0 }), 'food');
    assert.equal(agendaTick(hFixAgent(t, [], { food: 12 }), { now: 0 }), 'weapon', 'no death: Fix H as before');
    // Bounded: past the window, the night near, the shelter blocks come first again.
    assert.equal(agendaTick(died(soak7(), FOOD_AFTER_DEATH.windowMs + 1000), { now: 0 }), 'shelter_blocks');
    // Food held, or food above 12: no food first.
    assert.notEqual(agendaTick(died(far([stack('bread', 0, 1)]), 20_000), { now: 0 }), 'food');
    assert.notEqual(agendaTick(died(far([], { food: 13 }), 20_000), { now: 0 }), 'food');
    // !agenda (readOnly) shows the same step.
    const shown = died(far(), 20_000);
    assert.equal(shown.agenda.judge(agendaState(shown.bot), { readOnly: true }).step.id, 'food');
});

test('#552 nit (rotn-data #551): the crude axe text says when it breaks, from its durability: its 9th block (1 a block) and its 5th hit (2 a hit)', async () => {
    const { weaponStats } = await import('../../packages/rotn-data/index.js');
    const axe = weaponStats('pyrotech:crude_axe');
    // An item breaks only when its damage goes above its durability.
    const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
    const block = ordinal(axe.durability + 1), hit = ordinal(Math.floor(axe.durability / axe.durabilityPerHit) + 1);
    assert.deepEqual([block, hit], ['9th', '5th']);
    const step = ROTN_EARLY_GAME.find(s => s.id === 'crude_axe');
    assert.ok(step.goal.includes(`breaks on its ${block} block`) && step.goal.includes(`breaks on the ${hit} hit`), step.goal);
    // Soak 10: the reserve asks for a wooden club, and says the crude axe breaks on its 5th hit.
    assert.ok(WEAPON_RESERVE_STEP.goal.includes(`breaks on its ${hit} hit, before it kills one zombie`), WEAPON_RESERVE_STEP.goal);
    for (const g of [step.goal, WEAPON_RESERVE_STEP.goal]) assert.doesNotMatch(g, /about 8 uses/);
});

// Soak 10 (W2, the lead's answer 3): the wooden club (2 logs, no table) is the weapon; the reserve is
// due at any time once the logs for it are held, and the driver crafts it itself (no model call).
test('soak 10 (W2): with no weapon and 2 logs held the weapon reserve is due by day too; 1 log is not; a club worn to its last hits does not end it', (t) => {
    assert.deepEqual(CLUB, { item: 'spartanweaponry:club_wood', logs: 2 });
    const items = [stack('pyrotech:rock', 0, 6), stack('stick', 0, 4), stack('pyrotech:crude_axe', 0, 1), stack('log', 1, 1)];
    const agent = fakeAgent(t, items, { weapon: WEAPON_RESERVE_STEP });
    agent.bot.time = { timeOfDay: 1000 }; // full day, not near night
    agent.bot.food = 20;
    assert.equal(agendaTick(agent, { now: 0 }), 'logs', 'one log: the steps go on');
    items[3].count = 2;
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'weapon');
    const p = agent.self_prompter.prompt;
    assert.match(p, /^RotN agenda, step weapon \(no weapon, logs held\): You hold no weapon, and you have the logs for one\. /);
    assert.match(p, /You hold 2 logs, enough for a club\. Craft a wooden club from 2 logs/);
    // A club with 2 hits left (131 durability, 1 a hit): no kill's worth, so the reserve goes on.
    const worn = stack('spartanweaponry:club_wood', 0, 1);
    worn.metadata = 130;
    items.push(worn);
    assert.equal(agentdone(agent), false);
    worn.metadata = 0;
    assert.equal(agentdone(agent), true);
    assert.equal(agendaTick(agent, { now: 2 * TICK_MS }), 'logs');
});
const agentdone = (agent) => WEAPON_RESERVE_STEP.done(agendaState(agent.bot));

test('soak 10 (W2): the driver crafts the club itself when the logs are held (no model call), at most AUTO_CRAFT.tries times; not over another running action', async (t) => {
    const items = [stack('pyrotech:rock', 0, 6), stack('log', 1, 2)];
    const agent = fakeAgent(t, items, { weapon: WEAPON_RESERVE_STEP });
    agent.bot.time = { timeOfDay: 1000 };
    agent.bot.food = 20;
    const runs = [];
    agent.actions = { executing: false, currentActionLabel: '', runAction: (label, fn) => { runs.push(label); return Promise.resolve(fn()); } };
    const crafted = [];
    const step = WEAPON_RESERVE_STEP;
    const state = agendaState(agent.bot);
    const craft = (bot, item) => { crafted.push(item); return Promise.resolve(false); };
    assert.equal(autoCraftTick(agent, step, state, { craft }), 'weapon');
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(crafted, ['spartanweaponry:club_wood']);
    assert.deepEqual(runs, ['action:craftRecipe:spartanweaponry:club_wood']);
    assert.match(agent.said.at(-1), /^agenda step weapon: crafting spartanweaponry:club_wood \(try 1 of 2\)$/);
    assert.equal(AUTO_CRAFT.tries, 2);
    // Another action running: not over it.
    agent.actions.executing = true;
    agent.actions.currentActionLabel = 'action:collectBlocks';
    assert.equal(autoCraftTick(agent, step, state, { craft }), null);
    // Its own craft running: the step waits for it.
    agent.actions.currentActionLabel = 'action:craftRecipe:spartanweaponry:club_wood';
    assert.equal(autoCraftTick(agent, step, state, { craft }), 'weapon');
    agent.actions.executing = false;
    assert.equal(autoCraftTick(agent, step, state, { craft }), 'weapon', 'the second try');
    assert.equal(autoCraftTick(agent, step, state, { craft }), null, 'two tries: the model gets the step');
    assert.equal(crafted.length, 2);
    // Too few logs: not ready.
    const one = fakeAgent(t, [stack('log', 1, 1)], { weapon: WEAPON_RESERVE_STEP });
    one.actions = agent.actions;
    assert.equal(autoCraftTick(one, step, agendaState(one.bot), { craft }), null);
    // Through agendaTick: the reserve's tick crafts and drives no prompt.
    const driven = fakeAgent(t, [stack('pyrotech:rock', 0, 6), stack('log', 1, 2)], { weapon: WEAPON_RESERVE_STEP });
    driven.bot.time = { timeOfDay: 1000 };
    driven.bot.food = 20;
    driven.actions = { executing: true, currentActionLabel: 'action:craftRecipe:spartanweaponry:club_wood', runAction: () => Promise.resolve() };
    assert.equal(agendaTick(driven, { now: 0 }), 'weapon');
    assert.equal(driven.self_prompter.prompt, '', 'no model prompt while the craft runs');
});

// #579 review 1: the try counter was per process (the early return came before the step tracking):
// after 2 club crafts the reserve never auto-crafted again until a restart.
test('#579 review 1: weapon, other, weapon, other, weapon: each time the weapon reserve is current again it gets fresh craft tries', async (t) => {
    const agent = fakeAgent(t, [stack('log', 1, 2)], { weapon: WEAPON_RESERVE_STEP });
    agent.actions = { executing: false, currentActionLabel: '', runAction: (label, fn) => Promise.resolve(fn()) };
    const crafted = [];
    const craft = (bot, item) => { crafted.push(item); return Promise.resolve(false); };
    const state = agendaState(agent.bot);
    const other = { id: 'logs' };
    for (let round = 0; round < 3; round++) {
        assert.equal(autoCraftTick(agent, WEAPON_RESERVE_STEP, state, { craft }), 'weapon', `round ${round}: first try`);
        assert.equal(autoCraftTick(agent, WEAPON_RESERVE_STEP, state, { craft }), 'weapon', `round ${round}: second try`);
        assert.equal(autoCraftTick(agent, WEAPON_RESERVE_STEP, state, { craft }), null, `round ${round}: the model's`);
        assert.equal(autoCraftTick(agent, other, state, { craft }), null, 'another step in between');
    }
    await new Promise(r => setTimeout(r, 0));
    assert.equal(crafted.length, 6);
});

// #579 nit 3: the exact soak 10 inventory at 15:30 (40 spruce logs, 1 stick, the crude axe worn to meta 6):
// the reserve is due by day for the logs, and the driver crafts the club with no model prompt.
test('#579 nit 3: the soak 10 inventory (40 logs, 1 stick, a worn crude axe): the club, crafted by the driver, no model prompt', (t) => {
    const items = [stack('log', 1, 40), stack('stick', 0, 1), stack('pyrotech:crude_axe', 6, 1), stack('pyrotech_compat:rock_metamorphic', 6, 3), stack('betterwithmods:dirt_pile', 0, 56)];
    const agent = fakeAgent(t, items, { weapon: WEAPON_RESERVE_STEP });
    agent.bot.time = { timeOfDay: 1000 };
    agent.bot.food = 20;
    const runs = [];
    agent.actions = { executing: false, currentActionLabel: '', runAction: (label) => { runs.push(label); return Promise.resolve(); } };
    agent.agenda.done_at = { rocks: 1, sticks: 1, crude_axe: 1, logs: 1, first_plank: 1 };
    assert.equal(agendaTick(agent, { now: 0 }), 'weapon');
    assert.deepEqual(runs, ['action:craftRecipe:spartanweaponry:club_wood']);
    assert.equal(agent.self_prompter.prompt, '', 'no model prompt');
});

// Soak 10 (S1, the lead: 4): the reserve held exactly the shelter's 10 dirt; the dusk build used them
// all and the repair after a zombie dug a wall placed nothing. It now keeps a repair spare.
test('soak 10 (S1): the shelter reserve keeps the shelter\'s 10 blocks and a repair spare of 4: done at 14, not at 10; the ask says so', (t) => {
    assert.deepEqual([SHELTER_RESERVE, REPAIR_SPARE, SHELTER_HOLD], [10, 4, 14]);
    const items = [stack('pyrotech:rock', 0, 6), stack('dirt', 0, 10)];
    const agent = fakeAgent(t, items);
    agent.bot.time = { timeOfDay: dayAt(7) };
    assert.equal(agendaTick(agent, { now: 0 }), 'shelter_blocks', '10 dirt: the shelter only, no spare');
    assert.match(agent.self_prompter.prompt, /It needs 10 blocks on open ground and 4 more for repairs \(14\), and you have 10 \(dirt, and dirt from your dirt piles\)\. Dig dirt or grass by hand with !collectBlocks\("betterwithmods:dirt_pile", 16\)/);
    assert.equal(agent.said.at(-1), 'agenda step shelter_blocks started: keep 14 blocks for the night\'s shelter and its repairs');
    items.push(stack('betterwithmods:dirt_pile', 0, 16)); // 4 more dirt
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'sticks');
    assert.match(SHELTER_RESERVE_STEP.goal, /keeps 4 more to repair it when a zombie digs a wall open/);
});

// #579 re-review nit: agendaTick returned early ("agenda done, no reserve wanted", "nothing runnable")
// before autoCraftTick, so the craft tries never reset there: with a finished agenda and the club lost
// again and again, the crafts went 1, 2, 2, 2 and then the model got it.
test('#579 re-review nit: a finished agenda, the club lost three times: each time the weapon reserve crafts a new one itself', (t) => {
    const items = [stack('log', 1, 2)];
    const agent = fakeAgent(t, items);
    agent.agenda = new Agenda('FRCFLD', { dir: tempDir(t), weapon: WEAPON_RESERVE_STEP, food: null, reserve: null });
    agent.agenda.start();
    agent.agenda.finish();
    agent.bot.time = { timeOfDay: 1000 };
    agent.bot.food = 20;
    const runs = [];
    const club = () => stack('spartanweaponry:club_wood', 0, 1);
    agent.actions = { executing: false, currentActionLabel: '', runAction: (label) => { runs.push(label); items.push(club()); return Promise.resolve(); } };
    let now = 0;
    const tick = () => { now += TICK_MS; return agendaTick(agent, { now }); };
    for (let round = 1; round <= 3; round++) {
        assert.equal(tick(), 'weapon', `round ${round}: the club is lost, the logs held`);
        assert.equal(runs.length, round, `round ${round}: crafted by the driver`);
        assert.equal(tick(), null, `round ${round}: a club held, no reserve wanted`);
        // Lost (a death, worn out): the logs for another one.
        items.splice(items.findIndex(i => i.name === 'spartanweaponry:club_wood'), 1);
        items.find(i => i.name === 'log').count = 2;
    }
    assert.equal(agent.self_prompter.prompt, '', 'never the model\'s');
});

// Soak 11 (H3): 22:03:42 (about 8 min before sunset) the shelter blocks came before food at food 7-8
// with nothing to eat; food came back at food 6, and night 4 began at food 4 with no food.
test('soak 11 (H3): before night with no food held, when food would reach 6 by sunset, food comes before the shelter blocks; the weapon stays first', (t) => {
    assert.deepEqual(FOOD_BEFORE_NIGHT, { minPerHunger: 2, startMs: 120_000, startSlackMs: 10_000 });
    const club = () => stack('spartanweaponry:club_wood', 0, 1);
    const at = (food, min, items = [club()]) => hFixAgent(t, items, { food, timeOfDay: dayAt(min) });
    // 7 min before sunset, armed, food 9 (9 - 3.5 = 5.5): food first.
    const hungry = at(9, 7);
    assert.equal(hungry.agenda.judge(agendaState(hungry.bot), { readOnly: true }).step.id, 'food', '!agenda shows it');
    assert.equal(agendaTick(hungry, { now: 0 }), 'food');
    // Food 12 (12 - 3.5 = 8.5): the shelter blocks first, as before.
    assert.equal(agendaTick(at(12, 7), { now: 0 }), 'shelter_blocks');
    // Food held: as before.
    assert.equal(agendaTick(at(9, 7, [club(), stack('bread', 0, 1)]), { now: 0 }), 'shelter_blocks');
    // Unarmed: the weapon stays ahead (2 logs), food after it, the blocks last.
    assert.equal(agendaTick(at(9, 7, []), { now: 0 }), 'weapon');
    // The rule itself.
    const s = (food, m, held = 0) => ({ food: () => food, minutesToSunset: () => m, foodHeld: () => held });
    assert.equal(foodRunsOutBeforeNight(s(9, 7)), true);
    assert.equal(foodRunsOutBeforeNight(s(10, 7)), false, '10 - 3.5 = 6.5');
    assert.equal(foodRunsOutBeforeNight(s(9, 7, 2)), false, 'food held');
    assert.equal(foodRunsOutBeforeNight(s(9, 0)), false, 'night');
});

// Soak 11 night 4, replayed (H3): after the 21:57 death the club was made (21:58-22:03); at 22:03:42,
// about 8 min before the 22:12 sunset, food 8 with no food held, the agenda chose the shelter blocks;
// food came back at 22:06 at food 6, and the bot sealed in at food 4 with nothing to eat (death 5:
// starved in the sealed side pocket).
test('soak 11 night 4 replay (H3, #588 review 1): club held, no food, food 8, 7.5 min before sunset (the blocks\' window, before the night routine takes over at 6): food for ONE run, then the blocks for the rest of the window, whatever the food', (t) => {
    const { SHELTER_LEAD_MIN } = NIGHT_CONST;
    assert.ok(7.5 > SHELTER_LEAD_MIN && 7.5 <= RESERVE_LEAD_MIN, 'inside the blocks\' window');
    const agent = hFixAgent(t, [stack('spartanweaponry:club_wood', 0, 1)], { food: 8, timeOfDay: dayAt(7.5) });
    assert.equal(agendaTick(agent, { now: 0 }), 'food', '22:03:42: food, not the shelter blocks');
    assert.equal(agent.self_prompter.isActive(), true, 'its run started');
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'food', 'the run goes on');
    // The run ends (no food found; at food 4 too weak to hunt): the blocks win for the rest of the window.
    agent.self_prompter.stop();
    agent.bot.food = 4;
    assert.equal(agendaTick(agent, { now: 2 * TICK_MS }), 'shelter_blocks');
    assert.equal(agendaTick(agent, { now: 3 * TICK_MS }), 'shelter_blocks', 'not food again in this window');
    // A new window (the next day's dusk): food may have its one run again.
    agent.bot.time = { timeOfDay: 1000 };
    agendaTick(agent, { now: 4 * TICK_MS });
    agent.self_prompter.stop();
    agent.bot.time = { timeOfDay: dayAt(7.5) };
    agent.bot.inventory.items = () => [stack('spartanweaponry:club_wood', 0, 1)]; // the blocks used up
    assert.equal(agent.agenda.foodBeforeBlocks(agendaState(agent.bot), { readOnly: true }), true);
});

// Soak 11 night 2 (E): 21:16 to 21:24 the weapon reserve ran with 0 logs (its budget spent on the
// search for logs, reflex interrupts restarting the runs); 21:25 the bot held 33 logs and no weapon,
// but the spent reserve stayed off until the night, and the club was never crafted.
test('soak 11 (E1): a spent weapon reserve before night comes back when the logs for a club are held, and the driver crafts it', (t) => {
    const items = [stack('pyrotech:rock', 0, 6), stack('dirt', 0, SHELTER_HOLD)];
    const agent = fakeAgent(t, items, { weapon: WEAPON_RESERVE_STEP });
    agent.bot.time = { timeOfDay: dayAt(7) };
    agent.bot.food = 20;
    assert.equal(agendaTick(agent, { now: 0 }), 'weapon');
    agent.agenda.spent.weapon = { attempts: 3, llm_ms: STEP_LLM_MS };
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'stuck');
    assert.equal(agent.agenda.weaponOff, true);
    assert.notEqual(agendaTick(agent, { now: 2 * TICK_MS }), 'weapon', 'spent: off');
    // The logs come (21:25, 33 logs): the reserve again, and the driver crafts the club.
    items.push(stack('log', 1, 33));
    const runs = [];
    agent.actions = { executing: false, currentActionLabel: '', runAction: (label) => { runs.push(label); return Promise.resolve(); } };
    assert.equal(agendaTick(agent, { now: 3 * TICK_MS }), 'weapon');
    assert.deepEqual(runs, ['action:craftRecipe:spartanweaponry:club_wood']);
});

test('soak 11 (E2): a death after the weapon reserve was spent gives it a fresh budget', (t) => {
    const items = [stack('pyrotech:rock', 0, 6), stack('dirt', 0, SHELTER_HOLD)];
    const agent = fakeAgent(t, items, { weapon: WEAPON_RESERVE_STEP });
    agent.bot.time = { timeOfDay: dayAt(7) };
    agent.bot.food = 20;
    assert.equal(agendaTick(agent, { now: 0 }), 'weapon');
    agent.agenda.spent.weapon = { attempts: 3, llm_ms: STEP_LLM_MS };
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'stuck');
    assert.notEqual(agendaTick(agent, { now: 2 * TICK_MS }), 'weapon');
    // A death after it went off (the club lost with it): the reserve again.
    const deathAt = Date.now() + 1000;
    agent.bot.rotnLastDeathAt = () => deathAt;
    agent.agenda.now = () => deathAt + 5000;
    assert.equal(agendaTick(agent, { now: 3 * TICK_MS }), 'weapon');
    assert.equal(agent.agenda.weaponOff, false);
});

test('#587 nit 8: a death before the weapon reserve went off gives no fresh budget; when it went off is saved and kept through a restart', (t) => {
    const items = [stack('pyrotech:rock', 0, 6), stack('dirt', 0, SHELTER_HOLD)];
    const agent = fakeAgent(t, items, { weapon: WEAPON_RESERVE_STEP });
    agent.bot.time = { timeOfDay: dayAt(7) };
    agent.bot.food = 20;
    const deathAt = Date.now() - 60_000; // before it went off
    agent.bot.rotnLastDeathAt = () => deathAt;
    assert.equal(agendaTick(agent, { now: 0 }), 'weapon');
    agent.agenda.spent.weapon = { attempts: 3, llm_ms: STEP_LLM_MS };
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'stuck');
    const offAt = agent.agenda.weaponOffAt;
    assert.ok(Number.isFinite(offAt) && offAt > deathAt);
    assert.notEqual(agendaTick(agent, { now: 2 * TICK_MS }), 'weapon', 'the death came before: still off');
    // A restart: weaponOffAt comes back from agenda.json.
    const again = new Agenda('FRCFLD', { dir: path.dirname(agent.agenda.file), weapon: WEAPON_RESERVE_STEP });
    again.load();
    assert.equal(again.weaponOffAt, offAt);
});

test('#587 nit 6 and 7: with the logs for a club held all day, a weapon reserve spent by day is off until the dusk (said so), and the dusk gives it a fresh budget', (t) => {
    const items = [stack('log', 1, 4), stack('dirt', 0, SHELTER_HOLD)];
    const agent = fakeAgent(t, items, { weapon: WEAPON_RESERVE_STEP });
    agent.bot.time = { timeOfDay: 1000 };
    agent.bot.food = 20;
    assert.equal(agendaTick(agent, { now: 0 }), 'weapon');
    assert.equal(WEAPON_RESERVE_STEP.whenNow(agendaState(agent.bot)), 'no weapon, logs held');
    agent.agenda.spent.weapon = { attempts: 3, llm_ms: STEP_LLM_MS };
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'stuck');
    assert.match(agent.said.at(-1), /^agenda step weapon stuck: .*; going on without it until the dusk$/);
    assert.notEqual(agendaTick(agent, { now: 2 * TICK_MS }), 'weapon');
    agent.bot.time = { timeOfDay: dayAt(7) };
    assert.equal(WEAPON_RESERVE_STEP.whenNow(agendaState(agent.bot)), 'no weapon, logs held', 'the same window at dusk');
    assert.equal(agendaTick(agent, { now: 3 * TICK_MS }), 'weapon', 'the dusk: a fresh budget');
});

test('#584 nit 6: the weapon reserve\'s auto-craft puts the crafted club in the off hand at once (a day death would drop it from the inventory)', async (t) => {
    const items = [stack('log', 1, 4), stack('dirt', 0, SHELTER_HOLD)];
    const agent = fakeAgent(t, items, { weapon: WEAPON_RESERVE_STEP });
    agent.bot.time = { timeOfDay: 1000 };
    agent.bot.food = 20;
    const order = [];
    let done;
    const finished = new Promise(r => { done = r; });
    agent.actions = { executing: false, currentActionLabel: '', runAction: async (label, fn) => { order.push(label); await fn(); done(); } };
    const step = agent.agenda.weaponWanted(agendaState(agent.bot));
    assert.equal(step?.id, 'weapon');
    assert.equal(autoCraftTick(agent, step, agendaState(agent.bot), {
        craft: () => { order.push('craft'); return Promise.resolve('crafted'); },
        rearmAfter: () => { order.push('rearm'); return Promise.resolve(true); },
    }), 'weapon');
    await finished;
    assert.deepEqual(order, ['action:craftRecipe:spartanweaponry:club_wood', 'craft', 'rearm']);
});

test('#587 re-review nit 4: whether the weapon reserve was last judged before night is saved, so a restart by day still gets the dusk\'s fresh budget', (t) => {
    const items = [stack('log', 1, 4), stack('dirt', 0, SHELTER_HOLD)];
    const agent = fakeAgent(t, items, { weapon: WEAPON_RESERVE_STEP });
    agent.bot.time = { timeOfDay: 1000 };
    agent.bot.food = 20;
    assert.equal(agendaTick(agent, { now: 0 }), 'weapon');
    agent.agenda.spent.weapon = { attempts: 3, llm_ms: STEP_LLM_MS };
    assert.equal(agendaTick(agent, { now: TICK_MS }), 'stuck');
    // A restart by day: the saved weaponDusk (false) comes back, not null.
    const again = new Agenda('FRCFLD', { dir: path.dirname(agent.agenda.file), weapon: WEAPON_RESERVE_STEP });
    again.load();
    assert.equal(again.weaponDusk, false);
    agent.agenda = again;
    agent.agenda.start();
    agent.agenda.reserveStuck('weapon'); // rebuilt from the spent budget, as after a restart
    agent.bot.time = { timeOfDay: dayAt(7) };
    assert.equal(agendaTick(agent, { now: 2 * TICK_MS }), 'weapon', 'the dusk: a fresh budget');
});

// #588 re-review nit 2: with 2 food runs already that day the driver waits 60 s (BACKOFF_MS doubling)
// before starting the next; the 60 s grace ended H3 before its one run started.
test('#588 re-review nit 2: H3\'s one food run survives the driver\'s backoff (counted from the driver\'s own start), then the blocks', (t) => {
    let clock = 0;
    const agent = hFixAgent(t, [stack('spartanweaponry:club_wood', 0, 1)], { food: 8, timeOfDay: dayAt(7.5) });
    agent.agenda.now = () => clock;
    agent.agenda.spent.food = { attempts: 2, llm_ms: 0 }; // two food runs today: the next waits BACKOFF_MS * 2
    assert.equal(agendaTick(agent, { now: 0 }), 'food');
    assert.equal(agent.self_prompter.isActive(), false, 'the backoff: not started yet');
    clock = 30_000;
    assert.equal(agendaTick(agent, { now: clock }), 'food');
    clock = 2 * BACKOFF_MS + 1000;
    assert.equal(agendaTick(agent, { now: clock }), 'food', 'still food when the backoff is over');
    assert.equal(agent.self_prompter.isActive(), true, 'its run started');
    assert.ok(agent.agenda.h3Run.started != null, 'counted from the driver\'s start');
    agent.self_prompter.stop();
    clock += 20_000;
    assert.equal(agendaTick(agent, { now: clock }), 'shelter_blocks', 'its one run over: the blocks');
});

test('#588 nit 1, #590 review: H3\'s wait for its food run to start comes from the driver\'s budget (stepBudget, BACKOFF_MS, TICK_MS, FOOD_START_SLACK_MS), at least 120 s, at most half the blocks\' window', async (t) => {
    const { foodStartMs, FOOD_START_SLACK_MS } = await import('./agenda_driver.js');
    const settings = (await import('./settings.js')).default;
    const saved = settings.agenda_step_attempts;
    t.after(() => { settings.agenda_step_attempts = saved; });
    const backoff = (runs) => BACKOFF_MS * 2 ** (runs - 2) + TICK_MS + FOOD_START_SLACK_MS;
    settings.agenda_step_attempts = undefined;
    assert.equal(backoff(3), 72_000);
    assert.equal(foodStartMs(), FOOD_BEFORE_NIGHT.startMs, '3 runs: the 120 s floor (a loop finishing a long command first)');
    settings.agenda_step_attempts = 4;
    assert.equal(foodStartMs(), backoff(4), '4 runs: the 120 s wait before the fourth, plus a tick and the slack (132 s)');
    assert.ok(foodStartMs() > FOOD_BEFORE_NIGHT.startMs, 'past the floor: why it is computed');
    settings.agenda_step_attempts = 5;
    assert.equal(foodStartMs(), backoff(5), '5 runs: the 240 s wait before the fifth (252 s)');
    settings.agenda_step_attempts = 6;
    assert.equal(foodStartMs(), RESERVE_LEAD_MIN * 60_000 / 2, '6 runs (480 s): capped at half the blocks\' window');
    // The agenda uses the bound the state carries.
    let clock = 0;
    const agenda = new Agenda('x', { dir: tempDir(t), weapon: null });
    agenda.now = () => clock;
    const state = { minutesToSunset: () => 7.5, food: () => 8, foodHeld: () => 0, foodRunning: () => false, foodStartMs: () => 5000 };
    agenda.foodBeforeBlocksRan();
    // #590 re-review nit: a bound under the 120 s floor (5 s here) is raised to it.
    clock = 6000;
    assert.equal(agenda.foodBeforeBlocks(state), true, 'a 5 s bound is raised to the 120 s floor');
    clock = FOOD_BEFORE_NIGHT.startMs + 1000;
    assert.equal(agenda.foodBeforeBlocks(state), false, 'past the floor: never started, the blocks');
    // A bound above the floor is kept.
    const longer = new Agenda('y', { dir: tempDir(t), weapon: null });
    longer.now = () => clock;
    clock = 0;
    longer.foodBeforeBlocksRan();
    clock = FOOD_BEFORE_NIGHT.startMs + 1000;
    assert.equal(longer.foodBeforeBlocks({ ...state, foodStartMs: () => 200_000 }), true, 'within a 200 s bound');
});

test('#588 nit 2: one wait formatter for the scroll and the kill-drop lines', async () => {
    const { waitText } = await import('./library/wait_text.js');
    const esc = await import('./respawn_escape.js');
    const { killDropsText } = await import('./library/skills.js');
    assert.equal(esc.waitText, waitText);
    assert.deepEqual([waitText(50), waitText(999), waitText(1000), waitText(1500), waitText(5000)], ['50 ms', '999 ms', '1 s', '1.5 s', '5 s']);
    assert.equal(killDropsText({ picked: [], seen: 0, refused: null }, 4, 3000), 'no drop seen within 4 blocks in 3 s');
    assert.equal(killDropsText({ picked: [], seen: 0, refused: null }, 4, 50), 'no drop seen within 4 blocks in 50 ms');
});

test('#588 nit 1, #590 review 3: with 5 attempts the backoff before the last food run is 240 s, and H3 keeps its one run past the 120 s floor until it starts', (t) => {
    const saved = settings.agenda_step_attempts;
    t.after(() => { settings.agenda_step_attempts = saved; });
    settings.agenda_step_attempts = 5;
    let clock = 0;
    const agent = hFixAgent(t, [stack('spartanweaponry:club_wood', 0, 1)], { food: 8, timeOfDay: dayAt(7.5) });
    agent.agenda.now = () => clock;
    agent.agenda.spent.food = { attempts: 4, llm_ms: 0 }; // four runs today: the fifth waits BACKOFF_MS * 8
    assert.equal(agendaTick(agent, { now: 0 }), 'food');
    clock = FOOD_BEFORE_NIGHT.startMs + 5_000; // past the 120 s floor, the backoff not over
    assert.equal(agendaTick(agent, { now: clock }), 'food', 'still food past 120 s');
    assert.equal(agent.self_prompter.isActive(), false, 'not started yet');
    clock = 8 * BACKOFF_MS + 1_000;
    assert.equal(agendaTick(agent, { now: clock }), 'food', 'the backoff is over: its run');
    assert.equal(agent.self_prompter.isActive(), true);
});

// Soak 14 (F2, the lead): after a respawn by day, the night 15 min away or less and too few shelter blocks: the blocks first.
test('soak 14 (F2): shelterFirstAfterDeath: within 15 min of a death, the night 15 min away or less, fewer than SHELTER_HOLD blocks', async () => {
    const { shelterFirstAfterDeath, SHELTER_AFTER_DEATH } = await import('./agenda.js');
    assert.deepEqual(SHELTER_AFTER_DEATH, { windowMs: 15 * 60_000, nightMin: 15 });
    const s = (o = {}) => ({ sinceDeathMs: () => 60_000, minutesToSunset: () => 7, hasPickaxe: () => true, shelterBlocks: () => 3, ...o });
    assert.equal(shelterFirstAfterDeath(s()), true);
    assert.equal(shelterFirstAfterDeath(s({ sinceDeathMs: () => Infinity })), false, 'no death');
    assert.equal(shelterFirstAfterDeath(s({ sinceDeathMs: () => 16 * 60_000 })), false, 'long ago');
    assert.equal(shelterFirstAfterDeath(s({ minutesToSunset: () => 20 })), false, 'the night far');
    assert.equal(shelterFirstAfterDeath(s({ minutesToSunset: () => 0 })), false, 'night: the night routine');
    assert.equal(shelterFirstAfterDeath(s({ shelterBlocks: () => SHELTER_HOLD })), false, 'enough blocks');
    assert.equal(shelterFirstAfterDeath(s({ hasPickaxe: () => false, dirtBlocks: () => 2 })), true, 'no pickaxe: dirt counts');
});

// #612 review 6 (the lead): in the before-night window the need counts the bar: "N more points held beyond your
// hunger bar"; by day the bar does not count; second person throughout.
test('#612 review 6: the food goal before night asks for points beyond the hunger bar; the static goal speaks to the model', (t) => {
    const pick = stack('stone_pickaxe', 0, 1);
    const agent = foodAgent(t, [pick, stack('cobblestone', 0, SHELTER_HOLD), stack('bread', 0, 1)], { food: 8, finished: true, timeOfDay: dayAt(7) });
    assert.equal(agendaTick(agent, { now: 0 }), 'food');
    assert.match(agent.self_prompter.prompt, /Food: you hold food worth 4\.2 points in your inventory; for the night you need food worth at least 6\.8 points held beyond your hunger bar \(8 of 20\)\./);
    assert.doesNotMatch(FOOD_RESERVE_STEP.goal, /the bot should|Keep the bread for last/);
    assert.match(FOOD_RESERVE_STEP.goal, /you should end the night at food 7 or more/);
});
