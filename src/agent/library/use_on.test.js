// Offline tests for the bounded !useOn (skills-rotn; G3 batch A finding: !useOn("pyrotech:crude_axe",
// "log") walked to a log and never returned). A fake bot on the 1.12.2 registry plus the crude axe;
// its pathfinder can be told never to arrive (as mineflayer-pathfinder's goto can keep going). No
// server, no LLM. On the old code the "never arrives" tests hang until the per-test timeout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import * as skills from './skills.js';

const vanilla = minecraftData('1.12.2');
const reg = { ...vanilla, items: { ...vanilla.items }, itemsByName: { ...vanilla.itemsByName } };
const AXE = { id: 5100, name: 'pyrotech:crude_axe', stackSize: 1 };
reg.items[AXE.id] = AXE; reg.itemsByName[AXE.name] = AXE;
__setRegistryForTest(reg);

const LIMITS = { walkMs: 200, totalMs: 1000, settleMs: 200 };
const T = { timeout: 5000 }; // the old code hangs here: fail instead of stalling the run

const at = (x, y = 64, z = 0) => new Vec3(x, y, z);
const block = (name, position, metadata = 0) => ({
    name, metadata, type: reg.blocksByName[name].id, position,
    boundingBox: 'block', transparent: false, shapes: [[0, 0, 0, 1, 1, 1]],
});
const stack = (name, count, metadata = 0) => ({ name, count, metadata, type: reg.itemsByName[name].id });

/**
 * arrive: 'never' (goto pends until pathfinder.stop, which rejects it as the real one does),
 * or 'yes' (the bot ends next to the goal). onUse(block, bot) simulates the server's answer.
 */
function fakeBot({ blocks = [], arrive = 'yes', onUse = () => {} } = {}) {
    const calls = { goto: 0, stop: 0, used: [] };
    const slots = new Array(46).fill(null);
    slots[36] = stack('pyrotech:crude_axe', 1);
    let pending = null;
    const bot = {
        calls, registry: reg, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival' },
        entity: { position: at(0), height: 1.8 },
        entities: {}, heldItem: null,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { slots, items: () => slots.filter(Boolean) },
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            return blocks.filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance)
                .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
                .slice(0, count).map(b => b.position);
        },
        blockAt: (pos) => blocks.find(b => b.position.equals(pos)) ?? null,
        blockAtCursor: () => null,
        equip: (item) => { bot.heldItem = item; return Promise.resolve(); },
        unequip: () => Promise.resolve(),
        lookAt: () => Promise.resolve(),
        activateBlock: (b) => { calls.used.push(b.position); onUse(b, bot); return Promise.resolve(); },
        activateItem: () => Promise.resolve(),
        pathfinder: {
            setMovements() {}, setGoal() {}, isMoving: () => false,
            getPathTo: () => ({ status: arrive === 'yes' ? 'success' : 'noPath', path: [] }),
            stop() { calls.stop++; if (pending) { const r = pending; pending = null; r(new Error('Path was stopped before it could be completed!')); } },
            goto(goal) {
                calls.goto++;
                if (arrive === 'yes') { bot.entity.position = at(goal.x + 1, goal.y, goal.z); return Promise.resolve(); }
                return new Promise((_, reject) => { pending = reject; });
            },
        },
    };
    return bot;
}

test('useOn: no reachable log ends with a clear failure, not a hang', T, async () => {
    const bot = fakeBot({ blocks: [block('log', at(20)), block('log', at(-25))], arrive: 'never' });
    const t0 = Date.now();
    const ok = await skills.useToolOn(bot, 'pyrotech:crude_axe', 'log', LIMITS);
    assert.equal(ok, false);
    assert.ok(Date.now() - t0 < 1500, 'within the total limit');
    assert.equal(bot.calls.goto, 2, 'each candidate tried once');
    assert.ok(bot.calls.stop >= 2, 'each timed-out walk stopped the pathfinder');
    assert.equal(bot.calls.used.length, 0, 'never used from afar');
    assert.match(bot.output, /Could not reach the log at 20, 64, 0 within 0\.2 s\./);
    assert.match(bot.output, /useOn failed: could not reach any of the 2 nearest log within 32 blocks \(20, 64, 0; -25, 64, 0\) in \d+ s\./);
});

test('useOn: the total time limit holds over many unreachable logs', T, async () => {
    const logs = [10, 12, 14, 16].map(x => block('log', at(x)));
    const bot = fakeBot({ blocks: logs, arrive: 'never' });
    const t0 = Date.now();
    const ok = await skills.useToolOn(bot, 'pyrotech:crude_axe', 'log', { walkMs: 400, totalMs: 600, settleMs: 100 });
    assert.equal(ok, false);
    assert.ok(Date.now() - t0 < 1200, `stopped near 600 ms, took ${Date.now() - t0}`);
    assert.equal(bot.calls.goto, 2, 'the third walk never started');
    assert.match(bot.output, /useOn failed: time limit of 0\.6 s reached \(tried 2 of the 4 nearest log\)\./);
});

test('useOn: success is the plank gain counted in the inventory', T, async () => {
    const bot = fakeBot({
        blocks: [block('log', at(3))],
        onUse: (_b, b) => { b.inventory.slots[9] = stack('planks', 2); },
    });
    const ok = await skills.useToolOn(bot, 'pyrotech:crude_axe', 'log', LIMITS);
    assert.equal(ok, true);
    assert.match(bot.output, /Used pyrotech:crude_axe on log at 3, 64, 0: gained 2 planks\./);
});

test('useOn: a use with no gain and no block change is a failure; one too far is never used', T, async () => {
    const bot = fakeBot({ blocks: [block('log', at(3))] });
    assert.equal(await skills.useToolOn(bot, 'pyrotech:crude_axe', 'log', LIMITS), false);
    assert.match(bot.output, /no effect \(no item gained, the block is unchanged\)\./);

    // A debarked log (the block changed, no item): a success.
    const b2 = fakeBot({ blocks: [block('log', at(3))], onUse: (b) => { b.metadata = 12; } });
    assert.equal(await skills.useToolOn(b2, 'pyrotech:crude_axe', 'log', LIMITS), true);
    assert.match(b2.output, /it is now log; no item gained \(not a plank or any other item yet\)\./);

    // The walk "succeeds" but leaves the bot far away: not used.
    const b3 = fakeBot({ blocks: [block('log', at(8))] });
    b3.pathfinder.goto = () => Promise.resolve();
    assert.equal(await skills.useToolOn(b3, 'pyrotech:crude_axe', 'log', LIMITS), false);
    assert.equal(b3.calls.used.length, 0);
    assert.match(b3.output, /Could not reach the log at 8, 64, 0\./);

    const b4 = fakeBot({ blocks: [block('log', at(40))] });
    assert.equal(await skills.useToolOn(b4, 'pyrotech:crude_axe', 'log', LIMITS), false);
    assert.match(b4.output, /Could not find any log within 32 blocks\./);
});

// #216 review follow-ups: the entity path is bounded and interruptible; the upstream creative check.
function entityBot(opts = {}) {
    const bot = fakeBot(opts);
    const cow = { name: 'cow', position: at(3) };
    bot.nearestEntity = (pred) => (pred(cow) ? cow : null);
    bot.calls.useOn = 0;
    bot.useOn = () => { bot.calls.useOn++; return Promise.resolve(); };
    return bot;
}

test('useOn entity: an equip that never answers ends at the total limit; nothing is used', T, async () => {
    const bot = entityBot();
    bot.equip = () => new Promise(() => {});
    const t0 = Date.now();
    assert.equal(await skills.useToolOn(bot, 'pyrotech:crude_axe', 'cow', { ...LIMITS, totalMs: 400 }), false);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(bot.calls.useOn, 0);
    assert.match(bot.output, /useOn failed: time limit of 0\.4 s reached\./);

    const b2 = entityBot();
    b2.unequip = () => new Promise(() => {});
    assert.equal(await skills.useToolOn(b2, 'hand', 'cow', { ...LIMITS, totalMs: 400 }), false, 'unequip is bounded too');
    assert.equal(b2.calls.useOn, 0);
});

test('useOn entity: an interrupt during the walk stops before the use; the walk message gives the real limit', T, async () => {
    const bot = entityBot();
    bot.pathfinder.goto = (goal) => { bot.interrupt_code = true; bot.entity.position = at(goal.x + 1); return Promise.resolve(); };
    assert.equal(await skills.useToolOn(bot, 'pyrotech:crude_axe', 'cow', LIMITS), false);
    assert.equal(bot.calls.useOn, 0);

    const b2 = entityBot({ arrive: 'never' });
    assert.equal(await skills.useToolOn(b2, 'pyrotech:crude_axe', 'cow', { walkMs: 2000, totalMs: 300, settleMs: 100 }), false);
    assert.match(b2.output, /useOn failed: could not reach the cow within 0\.3 s \(the 0\.3 s limit\)\./);

    const b3 = entityBot();
    assert.equal(await skills.useToolOn(b3, 'pyrotech:crude_axe', 'cow', LIMITS), true);
    assert.equal(b3.calls.useOn, 1);
});

test('useOn: a missing tool is refused at once (the upstream check was always false); "hand" needs none', T, async () => {
    const bot = fakeBot({ blocks: [block('log', at(3))] });
    bot.inventory.slots[36] = null;
    assert.equal(await skills.useToolOn(bot, 'pyrotech:crude_axe', 'log', LIMITS), false);
    assert.match(bot.output, /^You do not have any pyrotech:crude_axe to use\.\n$/);
    assert.equal(bot.calls.goto, 0, 'no walk');

    const b2 = entityBot();
    b2.inventory.slots[36] = null;
    assert.equal(await skills.useToolOn(b2, 'hand', 'cow', LIMITS), true);
});

// G3 smoke C+D: !searchForBlock("log", 64) never returned (goToNearestBlock -> goToPosition ->
// goToGoal, whose pathfinder.goto has no time limit). Every goToGoal walk is bounded now.
test('goToGoal: a walk that never arrives ends at GO_TO_LIMITS; the search reports failure', T, async (t) => {
    const saved = skills.GO_TO_LIMITS.totalMs;
    t.after(() => { skills.GO_TO_LIMITS.totalMs = saved; });
    skills.GO_TO_LIMITS.totalMs = 300;
    const bot = fakeBot({ blocks: [block('log', at(20))], arrive: 'never' });
    const t0 = Date.now();
    assert.equal(await skills.goToNearestBlock(bot, 'log', 4, 64), false);
    assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
    assert.ok(bot.calls.stop >= 1, 'the walk was stopped');
    assert.match(bot.output, /Found log at .*Navigating\.\.\./s);
    assert.match(bot.output, /Pathfinding stopped: time limit of 0\.3 s reached\./);

    const b2 = fakeBot({ blocks: [block('log', at(20))] });
    assert.equal(await skills.goToNearestBlock(b2, 'log', 4, 64), true, 'a walk that arrives is unchanged');
});

// #221 review: the raw pathfinder.goto calls (defendSelf, moveAwayFromEntity) and
// bot.collectBlock.collect had no time limit.
test('moveAwayFromEntity: a flee that never ends stops at GO_TO_LIMITS.fleeMs', T, async (t) => {
    const saved = skills.GO_TO_LIMITS.fleeMs;
    t.after(() => { skills.GO_TO_LIMITS.fleeMs = saved; });
    skills.GO_TO_LIMITS.fleeMs = 300;
    const bot = fakeBot({ arrive: 'never' });
    const t0 = Date.now();
    assert.equal(await skills.moveAwayFromEntity(bot, { name: 'zombie', position: at(2) }, 16), false);
    assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
    assert.ok(bot.calls.stop >= 1);
});

test('defendSelf: a step toward an enemy that never ends stops at GO_TO_LIMITS.stepMs; the fight goes on', T, async (t) => {
    const saved = skills.GO_TO_LIMITS.stepMs;
    t.after(() => { skills.GO_TO_LIMITS.stepMs = saved; });
    skills.GO_TO_LIMITS.stepMs = 300;
    const bot = fakeBot({ arrive: 'never' });
    bot.entities[7] = { id: 7, name: 'zombie', type: 'mob', position: at(6), height: 1.8, isValid: true };
    let hits = 0;
    bot.pvp = { attack: () => { hits++; delete bot.entities[7]; }, stop() {} };
    bot.nearestEntity = (pred) => Object.values(bot.entities).find(pred) ?? null;
    const t0 = Date.now();
    assert.equal(await skills.defendSelf(bot, 9, () => true), true);
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
    assert.equal(hits, 1);
});

test('collectBlock: a collect that never returns gives the block up at COLLECT_LIMITS.blockMs', T, async (t) => {
    const saved = { ...skills.COLLECT_LIMITS };
    t.after(() => Object.assign(skills.COLLECT_LIMITS, saved));
    Object.assign(skills.COLLECT_LIMITS, { blockMs: 300, totalMs: 1000 });
    const dirt = { ...block('dirt', at(3)), canHarvest: () => true };
    const bot = fakeBot({ blocks: [dirt] });
    // Like mineflayer-collectblock: the collect never ends by itself; cancelTask ends it (a moment later).
    let cancelled = 0;
    let settled = false;
    let endCollect = null;
    bot.collectBlock = {
        collect: () => new Promise((_, reject) => { endCollect = () => { settled = true; reject(new Error('Cancelled')); }; }),
        cancelTask: () => { cancelled++; setTimeout(() => endCollect?.(), 150); return Promise.resolve(); },
    };
    bot.tool = { equipForBlock: () => Promise.resolve() };
    bot.stopDigging = () => {};
    const t0 = Date.now();
    assert.equal(await skills.collectBlock(bot, 'dirt', 2), false);
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
    assert.ok(cancelled >= 1, 'the collect was cancelled');
    assert.match(bot.output, /Gave up on dirt at 3, 64, 0: time limit of 0\.3 s reached\./);
    assert.match(bot.output, /No more dirt nearby to collect\.|No dirt nearby to collect\./, 'the given-up block is not tried again');
    assert.equal(settled, true, 'the cancelled collect ended before collectBlock went on (#224 review 2)');
});
