// Soak 17 PR S (the lead's scope, /home/rv/soak17-lead-decisions.md): the smaller soak 17 findings, offline, from the
// evidence (test/evidence/g4/g4soak-17-20261126, driver.log lines named).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { fakeWorld } from '../../test/fixtures/fake-world.mjs';
import { __setRegistryForTest } from '../utils/mcdata.js';
import './agent.js'; // the real import order (commands/index.js first)
import { describeAgenda, STANDING_GOAL_PREFIX } from './agenda.js';
import { freshGoalText } from './agenda_driver.js';
import { inventorySettled, settleForTurn, INVENTORY_SETTLE } from './self_prompter.js';
import { emptyFacts, recordFailure, buildMemory, MEMORY_FACTS } from './memory_facts.js';
import { craftNeeds, describeNeeds } from './library/craft_needs.js';
import * as skills from './library/skills.js';
import { queryList } from './commands/queries.js';

const quiet = (t, lines = null) => { t.mock.method(console, 'log', (...a) => lines?.push(a.join(' '))); t.mock.method(console, 'warn', () => {}); };
const useRegistry = (t, bot) => { __setRegistryForTest(bot.registry); t.after(() => __setRegistryForTest(null)); };

// ---- L1: the agenda line (driver.log:45, :681, :697) ----
test('soak 17 L1: the agenda line says "no step chosen yet" before a step is picked (dl:45), never names a step already done (dl:681, dl:697), and "all steps done" only when they are', () => {
    const steps = [{ id: 'weapon', short: 'hold a weapon' }, { id: 'stone_pickaxe', short: 'craft a stone pickaxe' }, { id: 'shelter_blocks', short: 'keep 14 blocks' }];
    const fresh = { steps, active: true, done_at: {} };
    assert.equal(describeAgenda(fresh, null), 'agenda: active, no step chosen yet; done: none', '17:17:05: was "active, all steps done; done: none"');
    const lagging = { steps, active: true, done_at: { weapon: 1, stone_pickaxe: 2 } };
    assert.equal(describeAgenda(lagging, steps[1]), 'agenda: active, no step chosen yet; done: weapon, stone_pickaxe', '17:22:20: was "active, step stone_pickaxe" with stone_pickaxe done');
    assert.equal(describeAgenda(lagging, steps[2]), 'agenda: active, step shelter_blocks (keep 14 blocks); done: weapon, stone_pickaxe');
    const all = { steps, active: false, finished: true, done_at: { weapon: 1, stone_pickaxe: 2, shelter_blocks: 3 } };
    assert.match(describeAgenda(all, null), /^agenda: done \(before night it still keeps the shelter blocks\), all steps done; done: weapon, stone_pickaxe, shelter_blocks$/);
});

// ---- S6: the standing goal's food figure (driver.log:2838, :2923) ----
test('soak 17 S6: the standing goal\'s "(you hold H)" is read at the turn (18:38:40: 2.3 while the facts said 4.3); the drivers\' identity follows', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 9: ['bread', 2] } });
    useRegistry(t, w.bot);
    const old = `${STANDING_GOAL_PREFIX}keep food worth at least 12 points (you hold 2.3) and 14 blocks for the night's shelter`;
    const agent = { bot: w.bot, _autonomy_prompt: old, _agenda_open_goal: old, _open_goal_prompt: old };
    const next = freshGoalText(agent, old);
    assert.notEqual(next, old);
    assert.match(next, /\(you hold (\d+(\.\d+)?)\)/);
    assert.notEqual(next.match(/\(you hold ([0-9.]+)\)/)[1], '2.3');
    assert.deepEqual([agent._autonomy_prompt, agent._agenda_open_goal, agent._open_goal_prompt], [next, next, next]);
    assert.equal(freshGoalText(agent, 'RotN agenda, step 1 of 2 (weapon): (you hold 2.3)'), 'RotN agenda, step 1 of 2 (weapon): (you hold 2.3)', 'only the standing goal');
});

test('soak 17 S6: a turn waits for the inventory to settle after a slot change (the forage\'s pickup), and not at all otherwise (#670 nit 3: fake timers)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const inventory = new EventEmitter();
    const bot = { inventory };
    let done = false;
    await inventorySettled(bot).then(() => { done = true; });
    assert.equal(done, true, 'nothing changed: no wait');
    inventory.emit('updateSlot'); // at fake time T
    done = false;
    const p = inventorySettled(bot).then(() => { done = true; });
    const step = 50;
    let waited = 0;
    while (!done && waited <= INVENTORY_SETTLE.maxMs + step) {
        t.mock.timers.tick(step);
        waited += step;
        for (let i = 0; i < 5; i++) await Promise.resolve();
    }
    await p;
    assert.ok(waited >= INVENTORY_SETTLE.quietMs && waited <= INVENTORY_SETTLE.quietMs + 2 * step, `settled after ${waited} ms of fake time`);
    // A slot that keeps changing: at most maxMs.
    done = false;
    inventory.emit('updateSlot');
    const q = inventorySettled(bot).then(() => { done = true; });
    waited = 0;
    while (!done && waited <= INVENTORY_SETTLE.maxMs + 4 * step) {
        inventory.emit('updateSlot');
        t.mock.timers.tick(step);
        waited += step;
        for (let i = 0; i < 5; i++) await Promise.resolve();
    }
    await q;
    assert.ok(waited >= INVENTORY_SETTLE.maxMs && waited <= INVENTORY_SETTLE.maxMs + 2 * step, `capped after ${waited} ms`);
});

test('#671 review 2: the slot watcher is on from the first turn: an agenda-step turn does not wait, and the first standing-goal turn after it sees a change made meanwhile', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const inventory = new EventEmitter();
    const bot = { inventory };
    const agent = { bot };
    const step = 'RotN agenda, step 2 of 9 (sticks): collect 2 sticks.';
    let done = false;
    const a = settleForTurn(agent, step).then((p) => { done = p; });
    for (let i = 0; i < 3; i++) await Promise.resolve();
    assert.equal(done, step, 'off the standing goal: the text at once');
    assert.equal(bot.rotnInvWatch, true, 'the watcher is on already');
    await a;
    inventory.emit('updateSlot'); // a pickup right after that turn
    done = false;
    const standing = `${STANDING_GOAL_PREFIX}keep food worth at least 12 points (you hold 2.3) and 14 blocks`;
    const b = settleForTurn(agent, standing).then(() => { done = true; });
    for (let i = 0; i < 3; i++) await Promise.resolve();
    assert.equal(done, false, 'the standing goal waits for the change to settle');
    let waited = 0;
    while (!done && waited <= INVENTORY_SETTLE.maxMs) { t.mock.timers.tick(50); waited += 50; for (let i = 0; i < 5; i++) await Promise.resolve(); }
    await b;
    assert.ok(waited >= INVENTORY_SETTLE.quietMs, `${waited} ms`);
});

// ---- S7: the failures list (R4, the ewe) ----
test('soak 17 S7 (R4): a failure stays listed while its 5-min leave-alone holds, though newer failures came (18:01:03 lost the ewe from a 3-entry list)', () => {
    const facts = emptyFacts();
    const t0 = 1_000_000;
    recordFailure(facts, { cmd: '!attack("animania:ewe_dorset")', why: 'Could not reach animania:ewe_dorset: no closer and no hit for 10 s; leaving it alone for 5 min.', at: t0 });
    for (let i = 0; i < 3; i++) recordFailure(facts, { cmd: `!searchForEntity("${['pig', 'cow', 'sheep'][i]}", 64)`, why: 'Could not find any in 64 blocks.', at: t0 + 8_000 + i * 15_000 });
    const shown = buildMemory({}, { facts, now: t0 + 51_000 }).split('\n');
    assert.ok(shown.some(l => l.startsWith('!attack("animania:ewe_dorset")')), shown.join('\n'));
    assert.equal(shown.filter(l => l.startsWith('!searchForEntity')).length, 3);
    const list = shown.slice(shown.indexOf('Recent failures (newest first):') + 1).filter(l => l.startsWith('!'));
    assert.ok(list.reduce((n, l) => n + l.length + 1, 0) <= MEMORY_FACTS.failuresChars);
});

// ---- L4: the craft text and the off hand (18:06:34) ----
test('soak 17 L4: the stone axe in the off hand is named as such, and what to get is the input\'s own choice (was "you have 1 stone_axe, so get 1 more stone_axe")', (t) => {
    quiet(t);
    const w = fakeWorld({ slots: { 45: ['stone_axe', 1], 10: ['pyrotech:rock', 90, 8], 11: ['stick', 3] } });
    useRegistry(t, w.bot);
    const needs = craftNeeds(w.bot, 'contenttweaker:crafting_tools');
    assert.equal(needs.ready, false, 'a craft takes only the inventory');
    const text = describeNeeds('contenttweaker:crafting_tools', needs);
    // #670 nit 1: the off-hand stack that fills the input is what will do, never also "get" for that input.
    assert.match(text, /1 pyrotech:crude_axe: you have none \(1 stone_axe in the off hand, which a craft does not take: !craftRecipe moves it into the inventory first, and it will do\);/);
    assert.doesNotMatch(text, /get 1 (more )?(stone_axe|pyrotech:crude_axe)/);
    assert.equal(craftNeeds(w.bot, 'contenttweaker:crafting_tools', { offHand: true }).ready, true);
    // Another input short (no stick): that one says what to get; the off hand's still will do.
    const noStick = fakeWorld({ slots: { 45: ['stone_axe', 1], 10: ['pyrotech:rock', 90, 8] } });
    const t2 = describeNeeds('contenttweaker:crafting_tools', craftNeeds(noStick.bot, 'contenttweaker:crafting_tools'));
    assert.match(t2, /in the off hand, which a craft does not take: !craftRecipe moves it into the inventory first, and it will do\);/);
    assert.match(t2, /1 ladderMat: you have none, so get 1 /);
    // The off-hand stack's own count (not a literal 1): 3 rocks there fill a stone pickaxe's 3.
    const rocks = fakeWorld({ slots: { 45: ['pyrotech_compat:rock_metamorphic', 3], 10: ['stick', 2] } });
    const t3 = describeNeeds('stone_pickaxe', craftNeeds(rocks.bot, 'stone_pickaxe'));
    assert.match(t3, /\(3 pyrotech_compat:rock_metamorphic in the off hand, which a craft does not take: !craftRecipe moves it into the inventory first, and it will do\)/, t3);
    // #671 review 3: an off-hand stack that fills only part of an input: its count, then what is still to get.
    const part = fakeWorld({ slots: { 45: ['pyrotech_compat:rock_metamorphic', 1], 9: ['pyrotech_compat:rock_metamorphic', 1], 10: ['stick', 2] } });
    const t4 = describeNeeds('stone_pickaxe', craftNeeds(part.bot, 'stone_pickaxe'));
    assert.match(t4, /3 rock: you have 1 pyrotech_compat:rock_metamorphic \(1 pyrotech_compat:rock_metamorphic in the off hand, which a craft does not take: !craftRecipe moves it into the inventory first\), so get 1 more /, t4);
    assert.doesNotMatch(t4, /it will do/);
});

test('soak 17 L4: !craftRecipe takes an input only the off hand holds into the inventory first', async (t) => {
    const lines = [];
    quiet(t, lines);
    const w = fakeWorld({ slots: { 45: ['stone_axe', 1], 10: ['pyrotech:rock', 90, 8], 11: ['stick', 3] } });
    useRegistry(t, w.bot);
    await skills.craftRecipe(w.bot, 'contenttweaker:crafting_tools', 1).catch(() => false);
    assert.match(w.bot.output, /Took the stone_axe from the off hand into the inventory for this craft\./);
    assert.equal(w.bot.inventory.slots[45], null);
    assert.ok(w.bot.inventory.items().some(i => i.name === 'stone_axe'));
});

// ---- L5: a by-hand dig with the club held (17:29:25) ----
test('soak 17 L5: a rock pile is broken holding nothing that wears (the wooden club broke on one at 17:29:25)', async (t) => {
    quiet(t);
    const w = fakeWorld({ set: { '1,64,0': 'pyrotech_compat:rock_metamorphic' }, slots: { 36: ['spartanweaponry:club_wood', 1], 37: ['dirt', 4] }, pathfinder: 'teleport', timeOfDay: 1000 });
    useRegistry(t, w.bot);
    assert.equal(w.bot.heldItem?.name, 'spartanweaponry:club_wood');
    await skills.collectBlock(w.bot, 'pyrotech:rock', 1);
    assert.ok(w.calls.dug.length >= 1, w.bot.output);
    assert.equal(w.calls.dug[0].name, 'pyrotech_compat:rock_metamorphic');
    assert.notEqual(w.calls.dug[0].held, 'spartanweaponry:club_wood', `held ${w.calls.dug[0].held}`);
});

// ---- L3: !getCraftingPlan (18:07:32, 18:07:18): the planner answers (#669); #670 nit 4: no workaround in queries.js ----
test('soak 17 L3: !getCraftingPlan("cobblestone") names the rocks\' craft (was "a base item"); a stone pickaxe with any rock is ready', (t) => {
    quiet(t);
    const plan = queryList.find(c => c.name === '!getCraftingPlan');
    const w = fakeWorld({ slots: { 9: ['pyrotech_compat:rock_metamorphic', 64], 10: ['stick', 3] } });
    useRegistry(t, w.bot);
    const cobble = plan.perform({ bot: w.bot }, 'cobblestone', 5);
    assert.match(cobble, /your pyrotech_compat:rock_metamorphic(:0)? rocks make undergroundbiomes:metamorphic_cobble(:0)? \(4 rocks each\)/);
    assert.match(cobble, /You have all items required to craft this item!/);
    assert.doesNotMatch(cobble, /base item/);
    const none = fakeWorld({ slots: { 10: ['stick', 3] } });
    assert.match(plan.perform({ bot: none.bot }, 'cobblestone', 2), /4 rocks of any one kind make that kind's cobblestone/);
    const pick = plan.perform({ bot: w.bot }, 'stone_pickaxe', 1);
    assert.match(pick, /You have all items required to craft this item!/);
    assert.doesNotMatch(pick, /pyrotech:rock:0/);
});

test('soak 17 (#669 review): 18:06:37\'s rock counts are each stack once: 420 metamorphic rocks in 7 stacks, 90 rock:8 in 2 (the 18:04:02 lines named crafts, not counts)', (t) => {
    quiet(t);
    // The 18:06:37 inventory (driver.log:2274): 6 x 64 + 36 metamorphic rocks, 64 + 26 rock:8, 3 igneous, 3 sedimentary,
    // 3 sticks; the stone axe in the off hand. Consistent with the death at 18:09:50 (453 and 269 lost, after the 53
    // cells dug at 18:07:40 and in escape 4, mostly limestone, and 5 cobble crafted at 18:07:35).
    const slots = {};
    [64, 64, 64, 64, 64, 64, 36].forEach((n, i) => { slots[9 + i] = ['pyrotech_compat:rock_metamorphic', n]; });
    slots[16] = ['pyrotech:rock', 64, 8];
    slots[17] = ['pyrotech:rock', 26, 8];
    slots[18] = ['pyrotech_compat:rock_igneous', 3];
    slots[19] = ['pyrotech_compat:rock_sedimentary', 3];
    slots[20] = ['stick', 3];
    slots[45] = ['stone_axe', 1];
    const w = fakeWorld({ slots });
    useRegistry(t, w.bot);
    const text = describeNeeds('contenttweaker:crafting_tools', craftNeeds(w.bot, 'contenttweaker:crafting_tools'));
    assert.match(text, /1 rock: you have 420 pyrotech_compat:rock_metamorphic, 90 pyrotech:rock:8, 3 pyrotech_compat:rock_igneous, 3 pyrotech_compat:rock_sedimentary \(enough\)/, text);
});
