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
import { inventorySettled, INVENTORY_SETTLE } from './self_prompter.js';
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

test('soak 17 S6: a turn waits for the inventory to settle after a slot change (the forage\'s pickup), and not at all otherwise', async () => {
    const inventory = new EventEmitter();
    const bot = { inventory };
    let t0 = Date.now();
    await inventorySettled(bot);
    assert.ok(Date.now() - t0 < 100, 'nothing changed: no wait');
    inventory.emit('updateSlot');
    t0 = Date.now();
    await inventorySettled(bot);
    const waited = Date.now() - t0;
    assert.ok(waited >= INVENTORY_SETTLE.quietMs - 60 && waited <= INVENTORY_SETTLE.maxMs + 200, `${waited} ms`);
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
    assert.match(text, /1 pyrotech:crude_axe: you have none \(1 stone_axe in the off hand, which a craft does not take: !craftRecipe moves it into the inventory first\), so get 1 pyrotech:crude_axe/);
    assert.doesNotMatch(text, /get 1 more stone_axe/);
    assert.equal(craftNeeds(w.bot, 'contenttweaker:crafting_tools', { offHand: true }).ready, true);
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

// ---- L3: !getCraftingPlan (18:07:32, 18:07:18) ----
test('soak 17 L3: !getCraftingPlan("cobblestone") names the rocks\' craft (was "a base item"); a stone pickaxe with any rock is ready', (t) => {
    quiet(t);
    const plan = queryList.find(c => c.name === '!getCraftingPlan');
    const w = fakeWorld({ slots: { 9: ['pyrotech_compat:rock_metamorphic', 64], 10: ['stick', 3] } });
    useRegistry(t, w.bot);
    const cobble = plan.perform({ bot: w.bot }, 'cobblestone', 5);
    assert.match(cobble, /Cobblestone comes from 4 rocks of one kind in your inventory grid .*You have enough: 64 pyrotech_compat:rock_metamorphic(:0)? make 16 undergroundbiomes:metamorphic_cobble(:0)?\. Craft it with !craftRecipe\("cobblestone", 5\)\./);
    assert.doesNotMatch(cobble, /base item/);
    const none = fakeWorld({ slots: { 10: ['stick', 3] } });
    assert.match(plan.perform({ bot: none.bot }, 'cobblestone', 2), /You have no 4 rocks of one kind; for 2 more, collect 8 rocks with !collectBlocks\("pyrotech:rock", 8\)/);
    const pick = plan.perform({ bot: w.bot }, 'stone_pickaxe', 1);
    assert.doesNotMatch(pick, /missing the following items:\s*- 3 pyrotech:rock:0/);
});
