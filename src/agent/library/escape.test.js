// Soak 8 (rotn-v0.1.14, #558): the flooded pit. The bot sat 36 min in one block, legs in flowing
// water, stone below and a stone overhang above; the lead's escape plan (PR 1). Fake worlds (the real
// 3.3.4 dump for what is dug with what), a fake bot that digs, places, jumps and lands; fake
// pathfinders. No server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { escape, nextStep, isOut, openSky, skyY, escapeTarget, escapeMovements, pillarUp, stepInto, placeHere, ESCAPE } from './escape.js';
import { planPath, goToGoal } from './skills.js';
import { initModes, __modeForTest } from '../modes.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const key = (p) => `${p.x},${p.y},${p.z}`;
const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };

/** The flooded pit: stone up to y 70 (the overhang), air above; the bot's legs in water (0, 60, 0), its head cell (0, 61, 0) air, as in soak 8. */
const pit = (q) => (q.y > 70 ? 'air' : q.x === 0 && q.z === 0 && q.y === 60 ? 'water' : q.x === 0 && q.z === 0 && q.y === 61 ? 'air' : 'stone');
/** The same with the head under water too. */
const deepPit = (q) => (q.x === 0 && q.z === 0 && q.y === 61 ? 'water' : pit(q));
/** A well: stone up to 70 except the 0, 0 column: water at 64 and 65, air from 66 up (open sky). */
const well = (q) => (q.x === 0 && q.z === 0 ? (q.y < 64 ? 'stone' : q.y <= 65 ? 'water' : 'air') : q.y > 70 ? 'air' : 'stone');

function fakeBot({ world = pit, at = new Vec3(0, 60, 0), items = [], pathfinder = null } = {}) {
    const set = new Map();
    const nameAt = (q) => set.get(key(q)) ?? world(q);
    const blockAt = (p) => {
        const q = p.floored();
        const v = nameAt(q);
        const b = reg.blocksByName[v];
        return { name: v, metadata: 0, type: b?.id ?? 1, boundingBox: b?.boundingBox ?? 'block', material: b?.material, position: q, canHarvest: () => true };
    };
    const solidAt = (q) => blockAt(q).boundingBox === 'block' && !/water|lava/.test(blockAt(q).name);
    const stack = (name, count) => ({ name, metadata: 0, count, type: reg.itemsByName[name]?.id });
    const inv = items.map(([n, c]) => stack(n, c));
    const calls = { dug: [], placed: [], looks: 0 };
    const bot = {
        output: '', interrupt_code: false, entities: {}, registry: reg, version: '1.12.2',
        game: { gameMode: 'survival' },
        entity: { position: at.offset(0.5, 0, 0.5), yaw: 0, onGround: true },
        inventory: { items: () => inv.filter(i => i.count > 0) },
        heldItem: null,
        modes: { isOn: () => false },
        tool: { equipForBlock: async () => {} },
        blockAt,
        digTime: () => 100,
        dig: (b) => { calls.dug.push(key(b.position)); set.set(key(b.position), 'air'); return Promise.resolve(); },
        equip: (item) => { bot.heldItem = item; return Promise.resolve(); },
        look: () => { calls.looks++; return Promise.resolve(); },
        lookAt: () => Promise.resolve(),
        // A jump lifts the bot 1.2; letting go lands it on the first solid block below.
        setControlState: (c, on) => {
            if (c !== 'jump') return;
            const p = bot.entity.position;
            if (on) { bot.entity.position = p.offset(0, 1.2, 0); return; }
            let y = Math.floor(p.y);
            while (y > 0 && !solidAt(new Vec3(Math.floor(p.x), y - 1, Math.floor(p.z)))) y--;
            bot.entity.position = new Vec3(p.x, y, p.z);
        },
        clearControlStates: () => {},
        placeBlock: (ref, face) => {
            const target = ref.position.plus(face);
            const was = blockAt(target);
            if (was.boundingBox === 'block' && !/water/.test(was.name)) return Promise.reject(new Error('occupied'));
            if (bot.entity.position.floored().equals(target)) return Promise.reject(new Error('the bot is in the way'));
            bot.heldItem.count--;
            set.set(key(target), bot.heldItem.name);
            calls.placed.push(key(target));
            return Promise.resolve();
        },
        pathfinder,
    };
    return { bot, set, calls, inv };
}
/** The stair move: into the cell (the tests' moveTo). */
const teleport = (bot, to) => { bot.entity.position = to.offset(0.5, 0, 0.5); return Promise.resolve(true); };
const noPath = () => ({ setMovements() {}, stop() {}, setGoal() {}, isMoving: () => false, getPathTo: () => ({ status: 'noPath', path: [] }), goto: () => Promise.reject(new Error('no path')) });

test('soak 8, the flooded pit: in water under rock, not out; the sky starts at y 71; no dry ground with open sky within reach', () => {
    const { bot } = fakeBot();
    assert.equal(isOut(bot), false);
    assert.equal(openSky(bot, new Vec3(0, 60, 0)), false, 'the overhang');
    assert.equal(skyY(bot), 71);
    assert.equal(escapeTarget(bot), null);
    assert.equal(isOut(fakeBot({ world: (q) => (q.y < 64 ? 'stone' : 'air'), at: new Vec3(0, 64, 0) }).bot), true, 'dry ground under the sky');
});

test('escape plan 1: the pathfinder gets a real search (planPath, tick by tick) and digging, towers, no flow, no parkour; a way found is walked: out', async (t) => {
    quiet(t);
    // planPath: getPathFromTo's ticks, yielding between them, until success.
    let ticks = 0, turns = 0;
    const spin = setInterval(() => { turns++; }, 0);
    const gen = function* () { for (let i = 0; i < 3; i++) { ticks++; yield { result: { status: 'partial', path: [] } }; } ticks++; yield { result: { status: 'success', path: [1, 2] } }; };
    const r = await planPath({ entity: { position: new Vec3(0, 0, 0) }, pathfinder: { getPathFromTo: gen } }, {}, null, 5000);
    clearInterval(spin);
    assert.deepEqual([r.status, ticks], ['success', 4]);
    assert.ok(turns >= 1, 'the event loop ran between ticks');
    assert.equal((await planPath({ entity: {}, pathfinder: { getPathTo: () => ({ status: 'noPath' }) } }, {}, null, 10)).status, 'noPath', 'no getPathFromTo: getPathTo');

    const seen = [];
    const pathfinder = {
        setMovements(m) { seen.push(m); }, stop() {}, setGoal() {}, isMoving: () => false,
        getPathTo: (m, goal) => { seen.push(m); return { status: 'success', path: [goal] }; },
        goto: (goal) => { bot.entity.position = new Vec3(5.5, goal.y, 0.5); return Promise.resolve(); }, // up onto the surface
    };
    const { bot } = fakeBot({ pathfinder, items: [['stone_pickaxe', 1], ['dirt', 10]] });
    const m = escapeMovements(bot);
    assert.deepEqual([m.canDig, m.allow1by1towers, m.allowParkour, m.dontCreateFlow], [true, true, false, true]);
    assert.ok(m.placeCost > m.digCost, 'digging before placing');
    assert.deepEqual(m.scafoldingBlocks, [reg.itemsByName.dirt.id]);
    const lines = [];
    const out = await escape(bot, { say: (l) => lines.push(l) });
    assert.deepEqual([out.out, out.how], [true, 'pathfinder'], out.why);
    assert.equal(seen[0].canDig, true);
    assert.ok(lines[0].startsWith('[escape] stuck at 0, 60, 0 in water: getting out upward (the sky starts at y 71)'), lines[0]);
    assert.match(lines.at(-1), /^\[escape\] out at 5, 71, 0 \(pathfinder; dug 0, placed 0\) in \d+\.\d s$/);
    assert.equal(bot.rotnEscaping, false);
});

test('escape plan 2: no way for the pathfinder: a staircase dug by hand up through the overhang to the sky (pickaxe), no block placed', async (t) => {
    quiet(t);
    const { bot, calls } = fakeBot({ pathfinder: noPath(), items: [['stone_pickaxe', 1], ['dirt', 10]] });
    const lines = [];
    const r = await escape(bot, { moveTo: teleport, say: (l) => lines.push(l) });
    assert.equal(r.out, true, r.why);
    assert.equal(r.how, 'by hand');
    // Out once the dug stair is dry under open sky: feet at 69, the head cell at 70 dug, air from 71.
    assert.equal(r.at.y, 69);
    assert.equal(r.stairs, 9);
    assert.equal(r.placed, 0, 'digging, not placing');
    assert.equal(r.dug, calls.dug.length);
    assert.ok(lines.includes('[escape] the pathfinder found no way (noPath); digging out by hand'), lines.join('\n'));
    assert.ok(isOut(bot));
});

test('escape plan 2: a well with no pickaxe: no stair step, so a pillar (jump, place below) twice: out of the water under the sky', async (t) => {
    quiet(t);
    const { bot, calls } = fakeBot({ world: well, at: new Vec3(0, 64, 0), pathfinder: noPath(), items: [['dirt', 4]] });
    assert.equal(nextStep(bot, null, { placed: 0 }).kind, 'pillar');
    const r = await escape(bot, { say: () => {} }); // the real pillarUp
    assert.equal(r.out, true, r.why);
    assert.deepEqual([r.pillars, r.placed, r.at.y], [2, 2, 66]);
    assert.deepEqual(calls.placed, ['0,64,0', '0,65,0'], 'into the water cells, under the feet');
    assert.ok(calls.looks >= 2, 'looked down before each');
    // pillarUp alone: no floor under the feet, no pillar.
    const air = fakeBot({ world: (q) => (q.y === 70 ? 'stone' : 'air'), at: new Vec3(0, 64, 0), items: [['dirt', 4]] });
    assert.equal(await pillarUp(air.bot, air.inv[0]), false);
});

test('escape plan 2: never a cell next to or under a liquid; the block budget for pillars', async (t) => {
    quiet(t);
    // Water over the +x stair's head cell: that step is refused, another side is taken.
    const wet = (q) => (q.x === 1 && q.y === 63 && q.z === 0 ? 'water' : pit(q));
    const step = nextStep(fakeBot({ world: wet, items: [['stone_pickaxe', 1]] }).bot, null, { placed: 0 });
    assert.equal(step.kind, 'stair');
    assert.ok(!(step.d.x === 1 && step.d.z === 0), `not toward the water: ${step.d}`);
    // Water over every stair's head cell and no block to place: no step.
    const soaked = (q) => ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([x, z]) => q.x === x && q.z === z && q.y === 63) ? 'water' : pit(q));
    assert.match(nextStep(fakeBot({ world: soaked, items: [['stone_pickaxe', 1]] }).bot, null, { placed: 0 }).why, /no block to pillar up with/);
    // The budget: one block for pillars, a well that takes two.
    const saved = ESCAPE.maxPlaced;
    t.after(() => { ESCAPE.maxPlaced = saved; });
    ESCAPE.maxPlaced = 1;
    const { bot } = fakeBot({ world: well, at: new Vec3(0, 64, 0), pathfinder: noPath(), items: [['dirt', 4]] });
    const r = await escape(bot, { say: () => {} });
    assert.equal(r.out, false);
    assert.match(r.why, /the 1 blocks for pillars are spent/);
    assert.equal(r.placed, 1);
});

test('escape plan (2): goToGoal searches again for up to 5 s (planPath) when both quick checks come back partial', async (t) => {
    quiet(t);
    let longSearches = 0;
    const pathfinder = {
        setMovements() {}, stop() {}, setGoal() {}, isMoving: () => false,
        getPathTo: () => ({ status: 'partial', path: [] }), // one 40 ms tick: not done
        *getPathFromTo(m, from, goal, { timeout }) { longSearches++; assert.equal(timeout, 5000); yield { result: { status: 'partial' } }; yield { result: { status: 'success', path: [] } }; },
        goto: () => Promise.resolve(),
    };
    const { bot } = fakeBot({ world: (q) => (q.y < 64 ? 'stone' : 'air'), at: new Vec3(0, 64, 0), pathfinder });
    await goToGoal(bot, new pf.goals.GoalBlock(5, 64, 0));
    assert.equal(longSearches, 1);
    assert.match(bot.output, /Found destructive path \(after a longer search\)\./);
});

// #571 review 3: within() ends on a stop with TIMED_OUT; goToGoal said "time limit of 3 min reached".
test('#571 review 3: a stop during goToGoal\'s walk is a stopped walk (false, said), not the time limit', async (t) => {
    quiet(t);
    const pathfinder = {
        setMovements() {}, stop() {}, setGoal() {}, isMoving: () => true,
        getPathTo: () => ({ status: 'success', path: [] }),
        goto: () => new Promise(() => {}), // never ends; the stop does not reject it
    };
    const { bot } = fakeBot({ world: (q) => (q.y < 64 ? 'stone' : 'air'), at: new Vec3(0, 64, 0), pathfinder });
    setTimeout(() => { bot.interrupt_code = true; }, 150);
    const start = Date.now();
    assert.equal(await goToGoal(bot, new pf.goals.GoalBlock(5, 64, 0)), false);
    assert.ok(Date.now() - start < 1500, `${Date.now() - start} ms`);
    assert.match(bot.output, /Walk stopped \(interrupted\)\./);
    assert.doesNotMatch(bot.output, /time limit/);
});

function unstuckAgent() {
    const agent = {
        name: 'FRCFLD', bot: {}, task: null, prompter: { getInitModes: () => ({}) },
        actions: { currentActionLabel: 'action:goToSurface', resume_func: null, runAction: async (label, fn) => { await fn(); return { message: 'ok', interrupted: false }; } },
        self_prompter: { isActive: () => true, stopLoop: () => {} },
        handleMessage: () => Promise.resolve(true), cleanKill: () => {}, isIdle: () => false,
    };
    initModes(agent);
    const position = new Vec3(-89.5, 61, -126.7);
    let rejectGoto = null;
    Object.assign(agent.bot, {
        registry: reg, version: '1.12.2', output: '', entity: { position }, targetDigBlock: null,
        pathfinder: { setMovements() {}, getPathTo: () => ({ status: 'success', path: [] }), goto: () => new Promise((res, rej) => { rejectGoto = rej; }), stop: () => rejectGoto?.(new Error('PathStopped')) },
    });
    const mode = __modeForTest('unstuck');
    mode.free_timeout_ms = 30;
    const fire = async () => {
        mode.prev_location = agent.bot.entity.position.clone();
        mode.stuck_time = mode.max_stuck_time + 1;
        mode.last_time = Date.now();
        await mode.update(agent);
        for (let i = 0; i < 100 && mode.active; i++) await new Promise(r => setTimeout(r, 10));
    };
    /** The 5-min hold ends (as if 5 min passed; the last fire is still within 10 min). */
    const holdEnds = () => { agent.bot.rotnUnstuck.holdUntil = 0; };
    return { agent, mode, fire, holdEnds, position };
}

test('escape plan (2), #562 review 1: unstuck again in the same cell runs the escape; failed, it holds 5 min; after the hold a second escape (the failure not said again); then the walk away there, no third', async (t) => {
    const warns = [], logs = [];
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const { agent, mode, fire, holdEnds, position } = unstuckAgent();
    agent.bot.modes.behavior_log = '';
    const escapes = [];
    mode.escape = (bot) => { escapes.push(bot.entity.position.floored()); return Promise.resolve({ out: false, interrupted: false, why: 'no stair step, and no block to pillar up with' }); };
    await fire();
    assert.equal(escapes.length, 0, 'the first time: the walk away, as before');
    await fire();
    assert.equal(escapes.length, 1, 'again in the same cell: the escape');
    assert.ok(warns.includes('[reflex] unstuck: the escape failed (no stair step, and no block to pillar up with), 1 of 2 here; holding off for 5 min'), warns.join('\n'));
    assert.ok(agent.bot.rotnUnstuck.holdUntil > Date.now() + 4 * 60_000);
    await fire();
    assert.equal(escapes.length, 1, 'held off');
    // After the hold, still within 10 min of the last fire: the second escape.
    holdEnds();
    await fire();
    assert.equal(escapes.length, 2);
    assert.ok(warns.includes('[reflex] unstuck: the escape failed (no stair step, and no block to pillar up with), 2 of 2 here; holding off for 5 min'));
    const failLines = agent.bot.modes.behavior_log.split('\n').filter(l => l.startsWith("I'm stuck at -90, 61, -127 and could not dig or climb out"));
    assert.equal(failLines.length, 1, 'the failure said once for this cell');
    // After the second hold: no escape left here: the walk away, said once.
    holdEnds();
    await fire();
    await fire();
    assert.equal(escapes.length, 2, 'no third escape in this cell');
    assert.equal(logs.filter(l => l === '[reflex] unstuck: no escape left at -90, 61, -127 (2 failed, 0 stopped); the walk away instead').length, 1, logs.join('\n'));
    // Another cell 5 blocks off, a repeat there: an escape again (its own count).
    agent.bot.entity.position = position.offset(-5, 0, 0);
    await fire();
    await fire();
    assert.equal(escapes.length, 3);
});

test('#562 review 5: an escape something else stopped (the swim-up) is no failure: no hold, no failure line; bounded per cell', async (t) => {
    const warns = [], logs = [];
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const { agent, mode, fire } = unstuckAgent();
    agent.bot.modes.behavior_log = '';
    let escapes = 0;
    mode.escape = () => { escapes++; return Promise.resolve({ out: false, interrupted: true, why: 'interrupted' }); };
    await fire();
    await fire();
    assert.equal(escapes, 1);
    assert.equal(agent.bot.rotnUnstuck.holdUntil, 0, 'no hold');
    assert.ok(!warns.some(w => w.includes('the escape failed')));
    assert.ok(!agent.bot.modes.behavior_log.includes('could not dig or climb out'));
    assert.ok(logs.includes('[reflex] unstuck: the escape was stopped by something else (interrupted); not a failure'));
    for (let i = 0; i < 4; i++) await fire();
    assert.equal(escapes, mode.max_interrupted, 'at most max_interrupted stopped escapes here');
});

test('escape: the unstuck reflex is held off while it runs (bot.rotnEscaping)', async (t) => {
    quiet(t);
    let during = null;
    const { bot } = fakeBot({ pathfinder: noPath(), items: [['stone_pickaxe', 1]] });
    await escape(bot, { moveTo: (b, to) => { during ??= b.rotnEscaping; return teleport(b, to); }, say: () => {} });
    assert.equal(during, true);
    assert.equal(bot.rotnEscaping, false);
    const agent = { isIdle: () => false, bot: { rotnEscaping: true, entity: { position: new Vec3(0, 0, 0) } } };
    const mode = __modeForTest('unstuck');
    mode.stuck_time = 5;
    await mode.update(agent);
    assert.equal(mode.stuck_time, 0, 'reset, nothing fired');
});


test('#562 review 2: the placements are the drops in the held blocks, not netted against digs; the planner sees only the budget left', async (t) => {
    quiet(t);
    // A walk that digs 3 dirt and places 2, by turns: net +1, placed 2.
    let goal = null;
    const pathfinder = {
        movements: null, setMovements(m) { this.movements = m; }, stop() {}, setGoal() {}, isMoving: () => false,
        getPathTo: () => ({ status: 'success', path: [1] }),
        goto: async (g) => {
            goal = g;
            const dirt = inv.find(i => i.name === 'dirt');
            for (const d of [+1, -1, +1, -1, +1]) { dirt.count += d; await new Promise(r => setTimeout(r, 3 * ESCAPE.countMs)); }
            bot.entity.position = new Vec3(5.5, 71, 0.5);
        },
    };
    const { bot, inv } = fakeBot({ pathfinder, items: [['stone_pickaxe', 1], ['dirt', 10]] });
    const r = await escape(bot, { say: () => {} });
    assert.ok(goal);
    assert.deepEqual([r.out, r.placed], [true, 2], `placed ${r.placed}`);
    const state = { placed: 6 };
    const m = escapeMovements(bot, state);
    assert.equal(m.countScaffoldingItems(), 2, 'the planner: 8 - 6 left, though 11 dirt are held');
    state.placed = 8;
    assert.equal(m.countScaffoldingItems(), 0);
});

test('#562 review 3: the 90 s is hard: each dig gets at most the time left, and none starts past it', async (t) => {
    quiet(t);
    const saved = { ...ESCAPE };
    t.after(() => Object.assign(ESCAPE, saved));
    Object.assign(ESCAPE, { totalMs: 1500 });
    const { bot } = fakeBot({ pathfinder: noPath(), items: [['stone_pickaxe', 1]] });
    // Warm (rotn-data's dump loaded), so the time goes to the dig, not to the first checks.
    nextStep(bot, null, { placed: 0 });
    escapeTarget(bot);
    // Digs that never end on their own (a dig is stopped by digWithin at its limit: 2 min here).
    let digs = 0;
    bot.dig = () => { digs++; return new Promise(() => {}); };
    bot.digTime = () => 60_000;
    const t0 = Date.now();
    const r = await escape(bot, { moveTo: teleport, say: () => {} });
    assert.ok(digs >= 1, 'a dig was started');
    assert.equal(r.out, false);
    assert.match(r.why, /the 1.5 s ran out/);
    assert.ok(Date.now() - t0 < 3000, `ended in ${Date.now() - t0} ms, not at the dig's 2 min`);
});

test('#562 review 4: the movements the pathfinder had before the escape come back after it', async (t) => {
    quiet(t);
    const before = { mine: true };
    const sets = [];
    const pathfinder = {
        movements: before, setMovements(m) { sets.push(m); this.movements = m; }, stop() {}, setGoal() {}, isMoving: () => false,
        getPathTo: () => ({ status: 'success', path: [1] }),
        goto: () => Promise.reject(new Error('stuck')),
    };
    const { bot } = fakeBot({ pathfinder, items: [['stone_pickaxe', 1]] });
    await escape(bot, { moveTo: teleport, say: () => {} });
    assert.equal(sets[0].canDig, true, 'the escape movements first');
    assert.equal(pathfinder.movements, before, 'then the ones from before');
});

test('#562 review 6: with the head under water, no stair (its cells would let the water through): a pillar instead', (t) => {
    quiet(t);
    const { bot } = fakeBot({ world: deepPit, items: [['stone_pickaxe', 1], ['dirt', 4]] });
    assert.equal(nextStep(bot, null, { placed: 0 }).kind, 'pillar');
    assert.equal(nextStep(fakeBot({ world: deepPit, items: [['stone_pickaxe', 1]] }).bot, null, { placed: 0 }).why, 'no stair step, and no block to pillar up with');
    assert.equal(nextStep(fakeBot({ items: [['stone_pickaxe', 1]] }).bot, null, { placed: 0 }).kind, 'stair', 'only the legs in water: stairs');
});

test('#562 review 7: a jump that does not get the feet out of the cell places nothing', async (t) => {
    quiet(t);
    const { bot, calls, inv } = fakeBot({ world: well, at: new Vec3(0, 64, 0), items: [['dirt', 4]] });
    let tries = 0;
    const place = bot.placeBlock;
    bot.placeBlock = (...a) => { tries++; return place(...a); };
    bot.setControlState = (c, on) => { if (c === 'jump' && on) bot.entity.position = bot.entity.position.offset(0, 0.4, 0); if (c === 'jump' && !on) bot.entity.position = new Vec3(0.5, 64, 0.5); };
    const saved = ESCAPE.jumpMs;
    t.after(() => { ESCAPE.jumpMs = saved; });
    ESCAPE.jumpMs = 100;
    assert.equal(await pillarUp(bot, inv[0]), false);
    assert.equal(tries, 0, 'not even tried: the cell is the bot\'s own');
    assert.deepEqual(calls.placed, []);
});

// ---- Escape plan PR 2 (3): !placeHere in the bot's own cell; #562 nits ----

const flat = (q) => (q.y < 64 ? 'stone' : 'air');

test('PR 2 (3): !placeHere with a full block jumps and puts it under the bot (soak 8: "Failed to place … at the bot\'s own cell")', async (t) => {
    quiet(t);
    const { bot, calls } = fakeBot({ world: flat, at: new Vec3(0, 64, 0), items: [['dirt', 3]] });
    assert.equal(await placeHere(bot, 'dirt'), true);
    assert.deepEqual(calls.placed, ['0,64,0']);
    assert.equal(bot.entity.position.floored().y, 65, 'standing on it');
    assert.match(bot.output, /Placed dirt at 0, 64, 0 by jumping and putting it under you: you now stand on it at 0, 65, 0\./);
    // In the flooded well: into the water cell, out of it one step.
    const w = fakeBot({ world: well, at: new Vec3(0, 64, 0), items: [['cobblestone', 2]] });
    assert.equal(await placeHere(w.bot, 'cobblestone'), true);
    assert.deepEqual(w.calls.placed, ['0,64,0']);
});

test('PR 2 (3): !placeHere refuses with the reason when there is no floor or no room above; a torch goes the upstream way', async (t) => {
    quiet(t);
    const roofed = fakeBot({ world: (q) => (q.y === 66 ? 'stone' : flat(q)), at: new Vec3(0, 64, 0), items: [['dirt', 3]] });
    assert.equal(await placeHere(roofed.bot, 'dirt'), false);
    assert.deepEqual(roofed.calls.placed, []);
    assert.match(roofed.bot.output, /Cannot place dirt where you stand at 0, 64, 0: you are in that cell, and the stone above your head leaves no room/);
    const air = fakeBot({ world: (q) => (q.y === 60 ? 'stone' : 'air'), at: new Vec3(0, 64, 0), items: [['dirt', 3]] });
    assert.equal(await placeHere(air.bot, 'dirt'), false);
    assert.match(air.bot.output, /nothing solid under your feet/);
    const torches = [];
    const lit = fakeBot({ world: flat, at: new Vec3(0, 64, 0), items: [['torch', 3]] });
    await placeHere(lit.bot, 'torch', { place: (bot, type, x, y, z) => { torches.push([type, x, y, z]); return Promise.resolve(true); } });
    assert.deepEqual(torches, [['torch', 0, 64, 0]], 'placeBlock, as upstream');
    assert.deepEqual(lit.calls.placed, []);
});

test('PR 2 (3): the !placeHere command uses placeHere', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../commands/actions.js', import.meta.url), 'utf8');
    const cmd = src.slice(src.indexOf("name: '!placeHere'"), src.indexOf("name: '!buildShelter'"));
    assert.match(cmd, /await placeHere\(agent\.bot, type\);/);
    assert.match(cmd, /goes under you by a jump/);
});

test('#562 nit: the stair step and the pillar never wait past the deadline', async (t) => {
    quiet(t);
    const { bot, inv } = fakeBot({ world: flat, at: new Vec3(0, 64, 0), items: [['dirt', 3]] });
    bot.setControlState = () => {}; // the jump never lifts the bot
    let t0 = Date.now();
    assert.equal(await pillarUp(bot, inv[0], Date.now() + 80), false);
    assert.ok(Date.now() - t0 < 400, `pillarUp waited ${Date.now() - t0} ms (its jump wait is ${ESCAPE.jumpMs})`);
    t0 = Date.now();
    assert.equal(await stepInto(bot, new Vec3(1, 65, 0), Date.now() + 80), false);
    assert.ok(Date.now() - t0 < 400, `stepInto waited ${Date.now() - t0} ms (its wait is ${ESCAPE.moveMs})`);
});

test('#562 nit: "stuck here again: digging or climbing out" is said once per cell, not on every escape', async (t) => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'log', () => {});
    const { agent, mode, fire, holdEnds } = unstuckAgent();
    agent.bot.modes.behavior_log = '';
    mode.escape = () => Promise.resolve({ out: false, interrupted: false, why: 'no stair step, and no block to pillar up with' });
    await fire();
    await fire();
    holdEnds();
    await fire();
    const starts = agent.bot.modes.behavior_log.split('\n').filter(l => l === "I'm stuck here again: digging or climbing out.");
    assert.equal(starts.length, 1, agent.bot.modes.behavior_log);
});
