// Soak 16 trap (21:17-21:20, the lead's go on /home/rv/soak16-trap-skills.md): a destructive !goToCoordinates used up
// the stone pickaxe tunnelling into a hill; the walk ended "Unable to reach" (no post-condition); !goToSurface said "no
// stair step, and no room to pillar up" (every stone needs a pickaxe); with the standing goal's budget spent nothing
// re-planned. Offline: harness-ops' fake world (test/fixtures/fake-world.mjs) and fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { setImmediate } from 'node:timers';
import { pocketUnderRock, fakeWorld, SLOT } from '../../test/fixtures/fake-world.mjs';
import { __setRegistryForTest } from '../utils/mcdata.js';
import { nextStep, escape, escapeText, isTrapped, surfaceTarget, ESCAPE, ESCAPE_HOLD } from './library/escape.js';
import { pickaxePlan, makePickaxe, bestPickaxe, usesLeft, PICKAXE } from './library/pickaxe.js';
import { walkFloorY, guardWalkBreaks, WALK_GUARD } from './library/skills.js';
import { installDigHands, TOOL_BREAK } from './library/hands.js';
import { trappedTick, TRAP_JOB, PICKAXE_RESERVE } from './trapped_job.js';

const V = (x, y, z) => new Vec3(x, y, z);
const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };
const useRegistry = (t, bot) => { __setRegistryForTest(bot.registry); t.after(() => __setRegistryForTest(null)); };
const DAY = { placed: 0, budget: { maxPlaced: 32, reserve: 14, kind: 'day' } };
// Soak 16's bag at 21:20 (the appendix: no pickaxe; cobble from the shelter_blocks runs, planks, the table picked up).
const BAG = { 36: ['stone_axe', 1], 9: ['undergroundbiomes:metamorphic_cobble', 8], 10: ['undergroundbiomes:igneous_cobble', 5], 11: ['planks', 4], 12: ['crafting_table', 1], 13: ['dirt', 6] };

test('soak 16 trap (1): no pickaxe in a stone pocket: the why names the cell over the head, its block and the missing pickaxe', (t) => {
    quiet(t);
    const { bot } = pocketUnderRock({ slots: { 36: ['planks', 1, 1], 9: ['dirt', 6] } });
    useRegistry(t, bot);
    const step = nextStep(bot, V(0, 64, 0), { ...DAY });
    assert.equal(step.why, 'no stair step, and no room to pillar up above 0, 56, 0: 0, 58, 0 is undergroundbiomes:metamorphic_stone, which needs a pickaxe (you carry none)');
    // The model is told how to make one, with real commands only.
    const text = escapeText({ out: false, why: step.why, dug: 0, placed: 0, at: V(0, 56, 0), ms: 5000 });
    assert.match(text, /You have no pickaxe, and every stone here needs one: a stone pickaxe is 3 rocks and 2 sticks at a crafting table .*!craftRecipe\("stone_pickaxe", 1\) and !goToSurface\./);
    // With the pickaxe (off hand, as #614 keeps it) the same cell is a stair.
    const w = pocketUnderRock();
    assert.equal(nextStep(w.bot, V(0, 64, 0), { ...DAY }).kind, 'stair');
});

test('soak 16 trap (1): a level-1 ore (gold) over the head: a step sideways (at most 2), then the climb goes on from there', (t) => {
    quiet(t);
    const { bot } = pocketUnderRock({ set: { '0,56,0': 'air', '0,57,0': 'air', '0,58,0': 'gold_ore' } });
    useRegistry(t, bot);
    const step = nextStep(bot, V(0, 64, 0), { ...DAY });
    assert.equal(step.kind, 'side', JSON.stringify(step));
    assert.equal(step.dig.length, 2, 'the side cell and the one above it');
    assert.ok(Math.abs(step.to.x) + Math.abs(step.to.z) === 1 && step.to.y === 56);
    const spent = nextStep(bot, V(0, 64, 0), { ...DAY, sides: ESCAPE.sideSteps });
    assert.match(spent.why, /no room to pillar up above 0, 56, 0: 0, 58, 0 is gold_ore, which needs a level 1 pickaxe \(yours: level 0\)/);
});

test('soak 16 trap (1): water beside the headroom: the why names it', (t) => {
    quiet(t);
    const { bot } = pocketUnderRock({ set: { '0,56,0': 'air', '0,57,0': 'air', '1,58,0': 'water', '-1,58,0': 'water', '0,58,1': 'water', '0,58,-1': 'water' }, slots: { 45: ['stone_pickaxe', 1], 9: ['dirt', 6] } });
    useRegistry(t, bot);
    const step = nextStep(bot, null, { ...DAY, sides: ESCAPE.sideSteps });
    assert.match(step.why, /0, 58, 0 \(undergroundbiomes:metamorphic_stone\) has water next to it/);
});

test('soak 16 trap (1): the pickaxe plan from soak 16\'s bag: 1 cobble into rocks, sticks from planks, then the pickaxe at the carried table', (t) => {
    quiet(t);
    const { bot } = pocketUnderRock({ slots: BAG });
    useRegistry(t, bot);
    assert.deepEqual(pickaxePlan(bot), { ready: true, crafts: [['pyrotech_compat:rock_metamorphic', 1], ['stick', 1], ['stone_pickaxe', 1]], why: null });
    const bare = pocketUnderRock({ slots: { 36: ['stone_axe', 1] } });
    assert.deepEqual(pickaxePlan(bare.bot).ready, false);
    assert.match(pickaxePlan(bare.bot).why, /a stone pickaxe needs 3 rocks \(you have 0, and no cobble that breaks down into rocks\), 2 sticks .*, a crafting table \(none carried or near\)/);
    assert.equal(usesLeft({ name: 'stone_pickaxe', metadata: 0 }), 132, '131 uses, then the one that breaks it');
    assert.equal(usesLeft({ name: 'stone_pickaxe', metadata: 131 }), 1);
});

test('soak 16 trap (1): the real escape in the pocket with soak 16\'s bag: it makes the stone pickaxe first, then gets out', async (t) => {
    quiet(t);
    const w = pocketUnderRock({ slots: BAG });
    useRegistry(t, w.bot);
    const crafts = [];
    const craft = (bot, item, n) => {
        crafts.push([item, n]);
        if (item === 'stone_pickaxe') w.give('stone_pickaxe', 1);
        else if (item === 'stick') w.give('stick', 4 * n);
        else w.give(item, 4 * n);
        return Promise.resolve(true);
    };
    const r = await escape(w.bot, { budget: 'day', target: surfaceTarget(w.bot), craft });
    assert.deepEqual(crafts, [['pyrotech_compat:rock_metamorphic', 1], ['stick', 1], ['stone_pickaxe', 1]]);
    assert.equal(r.out, true, JSON.stringify({ why: r.why, at: r.at }));
    assert.equal(r.pickaxe, 'made');
    assert.ok(w.calls.dug.length > 0);
    // Without the makings: no craft, and the why says what is missing (the model's line names the recipe).
    const bare = pocketUnderRock({ slots: { 36: ['planks', 1, 1], 9: ['dirt', 6] } });
    const r2 = await escape(bare.bot, { budget: 'day', target: surfaceTarget(bare.bot), craft: () => { throw new Error('no craft'); } });
    assert.equal(r2.out, false);
    assert.match(r2.why, /needs a pickaxe \(you carry none\)/);
});

test('soak 16 trap (2): the walks\' break floor and the pickaxe\'s last uses (WALK_GUARD)', (t) => {
    quiet(t);
    const w = fakeWorld({ at: V(0, 79, 0), slots: { 45: ['stone_pickaxe', 1] } });
    useRegistry(t, w.bot);
    assert.equal(walkFloorY(w.bot, { x: 10, y: 69, z: 0 }), 67, 'min(start 79, goal 69) - 2 with a pickaxe');
    assert.equal(walkFloorY(w.bot, { x: 10, y: 69, z: 0 }, { pickaxe: false }), 69, 'no pickaxe: no dig below the lower end');
    assert.equal(walkFloorY(w.bot, { x: 10, z: 0 }), 77, 'a goal with no y: the start');
    const m = { exclusionAreasBreak: [] };
    guardWalkBreaks(w.bot, m, 67);
    const cost = (name, y) => m.exclusionAreasBreak.reduce((n, f) => n + f({ name, metadata: 0, position: V(0, y, 0), type: w.registry.blocksByName[name]?.id }), 0);
    assert.equal(cost('dirt', 66), WALK_GUARD.breakNever, 'below the floor: never');
    assert.equal(cost('dirt', 67), 0);
    assert.equal(cost('undergroundbiomes:metamorphic_stone', 70), 0, 'a fresh pickaxe digs stone on a walk');
    // The pickaxe with fewer than walkKeepUses uses left: a walk breaks no block that needs a pickaxe (the escape may).
    w.bot.inventory.slots[SLOT.OFF_HAND].metadata = 131 - PICKAXE.walkKeepUses + 2;
    const m2 = guardWalkBreaks(w.bot, { exclusionAreasBreak: [] }, 0);
    assert.equal(m2.exclusionAreasBreak.reduce((n, f) => n + f({ name: 'undergroundbiomes:metamorphic_stone', metadata: 0, position: V(0, 70, 0) }), 0), WALK_GUARD.breakNever);
    assert.equal(m2.exclusionAreasBreak.reduce((n, f) => n + f({ name: 'dirt', metadata: 0, position: V(0, 70, 0) }), 0), 0, 'dirt by hand is fine');
});

test('soak 16 trap (2): goToCoordinates that ends "Unable to reach" is a failed walk; the walk post-condition runs the escape', async (t) => {
    quiet(t);
    await import('./agent.js'); // the real import order (commands/index.js first)
    const skills = await import('./library/skills.js');
    const { postEscape } = await import('./commands/actions.js');
    const w = fakeWorld({ at: V(0, 64, 0) });
    useRegistry(t, w.bot);
    const bot = w.bot;
    // The walk resolves without getting there (a partial path): goToPosition's "Unable to reach" branch.
    bot.pathfinder.getPathTo = () => ({ status: 'success' });
    bot.pathfinder.goto = () => Promise.resolve();
    bot.modes = { isOn: () => false };
    bot.action_run = { aborted: false };
    const t0 = Date.now();
    assert.equal(await skills.goToPosition(bot, 100, 64, 0, 2), false);
    assert.match(bot.output, /Unable to reach 100, 64, 0/);
    assert.ok((bot.rotnWalkFailedAt ?? 0) >= t0, 'stamped');
    const runs = [];
    const fake = (b, o) => { runs.push(o.minDepth); return Promise.resolve('escaped'); };
    bot.rotnDigs = { count: 9 };
    assert.equal(await postEscape({ bot }, 'goToCoordinates', { t: t0, digs: 1, at: V(0, 64, 0) }, { escapeIfTrapped: fake }), 'escaped');
    // A walk that "reached" but ended 3 or more blocks down after digging is checked too (minDepth 3).
    const down = { entity: { position: V(0.5, 60, 0.5) }, rotnDigs: { count: 3 } };
    await postEscape({ bot: down }, 'goToCoordinates', { t: Date.now(), digs: 1, at: V(0, 64, 0) }, { escapeIfTrapped: fake });
    assert.deepEqual(runs, [0, 3]);
});

test('soak 16 trap: a held tool that breaks on a dig is logged ("[tool] <name> broke")', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const slots = new Array(46).fill(null);
    const pick = { name: 'stone_pickaxe', metadata: 131, count: 1, slot: 36 };
    slots[36] = pick;
    const bot = { inventory: { slots, items: () => slots.slice(9, 45).filter(Boolean) }, heldItem: pick, dig: () => { slots[36] = null; bot.heldItem = null; return Promise.resolve(); } };
    installDigHands(bot);
    await bot.dig({ name: 'undergroundbiomes:metamorphic_stone', position: V(9, 70, -63) });
    t.mock.timers.tick(TOOL_BREAK.checkMs);
    assert.ok(lines.includes('[tool] stone_pickaxe broke (used up) on undergroundbiomes:metamorphic_stone at 9, 70, -63'), lines.join('\n'));
    // A fresh pickaxe moved away by the model is no break.
    slots[36] = { name: 'stone_pickaxe', metadata: 3, count: 1, slot: 36 };
    bot.heldItem = slots[36];
    lines.length = 0;
    await bot.dig({ name: 'dirt', position: V(0, 64, 0) });
    t.mock.timers.tick(TOOL_BREAK.checkMs);
    assert.ok(!lines.some(l => /broke/.test(l)));
});

function idleAgent(bot, extra = {}) {
    const runs = [];
    return {
        bot, runs,
        actions: { executing: false, runAction: (label, fn) => { runs.push(label); return Promise.resolve(fn()); } },
        self_prompter: { isActive: () => false },
        _night: { state: 'day' },
        ...extra,
    };
}

test('soak 16 trap (3): idle and trapped with the standing budget spent: the scripted escape runs, then one due re-plan per hold per cell', async (t) => {
    quiet(t);
    const w = pocketUnderRock({ slots: { 36: ['planks', 1, 1], 9: ['dirt', 6] } });
    useRegistry(t, w.bot);
    const agent = idleAgent(w.bot);
    let escapes = 0;
    const run = () => { escapes++; return Promise.resolve({ out: false, why: 'no stair step, and no room to pillar up above 0, 56, 0: 0, 58, 0 is undergroundbiomes:metamorphic_stone, which needs a pickaxe (you carry none)', dug: 0, placed: 0, at: V(0, 56, 0), ms: 5000 }); };
    let now = 1_000_000;
    assert.equal(trappedTick(agent, { now, run }), 'escape');
    await new Promise(setImmediate);
    assert.deepEqual([escapes, agent.runs], [1, [TRAP_JOB.label]]);
    assert.equal(w.bot.rotnEscapeFails.length, 1);
    // The fail is fresh (Date.now() in the job): the next look is a due re-plan, not a second escape.
    w.bot.rotnEscapeFails[0].t = now;
    now += TRAP_JOB.checkMs;
    assert.equal(trappedTick(agent, { now, run }), 'replan');
    assert.equal(agent.replan?.due, true);
    assert.match(agent.replan.notes.at(-1), /You are trapped at 0, 56, 0: no walkable way to open ground\. The escape failed here \(.*needs a pickaxe \(you carry none\)\)\. You have no pickaxe: a stone pickaxe is 3 rocks and 2 sticks/);
    now += TRAP_JOB.checkMs;
    assert.equal(trappedTick(agent, { now, run }), 'held', 'once per hold per cell');
    assert.equal(escapes, 1);
    // After the hold: the escape again.
    now += ESCAPE_HOLD.ms;
    assert.equal(trappedTick(agent, { now, run }), 'escape');
});

test('soak 16 trap (3): no job while an action runs, a reflex acts, at night, on a hold, or while self-prompting', (t) => {
    quiet(t);
    const w = pocketUnderRock();
    useRegistry(t, w.bot);
    const busy = [
        { actions: { executing: true, runAction() {} } },
        { _night: { state: 'inside' } },
        { control: { hold: { kind: 'stop' } } },
        { self_prompter: { isActive: () => true } },
    ];
    for (const extra of busy) assert.equal(trappedTick(idleAgent(w.bot, extra), { now: 5e6, run: () => { throw new Error('no'); } }), null, JSON.stringify(Object.keys(extra)));
    w.bot.modes = { anyActive: () => true };
    assert.equal(trappedTick(idleAgent(w.bot), { now: 5e6 }), null);
});

test('soak 16 trap: the post-agenda pickaxe reserve: the stone_pickaxe step done, none carried, the makings held: crafted by script, twice a day at most', async (t) => {
    quiet(t);
    const w = fakeWorld({ at: V(0, 64, 0), slots: BAG });
    useRegistry(t, w.bot);
    w.bot.time = { day: 3 };
    const agent = idleAgent(w.bot, { agenda: { done_at: { stone_pickaxe: 1 } } });
    const crafted = [];
    const craft = (bot, item, n) => { crafted.push(item); if (item === 'stone_pickaxe') w.give('stone_pickaxe', 1); else w.give(item, 4 * n); return Promise.resolve(true); };
    assert.equal(trappedTick(agent, { now: 1e6, craft }), 'pickaxe');
    await new Promise(setImmediate);
    await new Promise(setImmediate);
    assert.ok(bestPickaxe(w.bot), 'a pickaxe now');
    assert.deepEqual(agent.runs, [PICKAXE_RESERVE.label]);
    assert.equal(crafted.at(-1), 'stone_pickaxe');
    assert.equal(trappedTick(agent, { now: 1e6 + TRAP_JOB.checkMs, craft }), null, 'held one now: nothing');
    // Not before the agenda's pickaxe step (the agenda makes the first one).
    const early = idleAgent(fakeWorld({ at: V(0, 64, 0), slots: BAG }).bot, { agenda: { done_at: {} } });
    assert.equal(trappedTick(early, { now: 1e6, craft }), null);
});
