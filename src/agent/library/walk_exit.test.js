// Soak 12 (rotn-v0.1.18, deaths 2-16): the scroll's respawn point was the night-2 hole shelter's cell; the
// escape never digs and ended 0 to 2 blocks out 15 times. walk_exit: a way out on foot (walkableExit) and
// the lead's bounded dig-out (stairOutPlan / stairOut: at most 6 quick blocks, away from the hostiles).
// A fake world (dirt below y 64, air above, plus what a test sets), the real 3.3.4 dump for hardness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { walkableExit, stairOutPlan, stairOut, quickDig, DIG_OUT, WALK_EXIT } from './walk_exit.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const key = (p) => `${p.x},${p.y},${p.z}`;

/** The world: `ground` below y 64, air above; `set` overrides cells. The bot digs (air) and walks where sent. */
/** #593 review 5: dig times by name and held tool type (ms): stone 7.5 s by hand, 0.4 s with a stone pickaxe; dirt 0.75 s. */
const PICK = reg.itemsByName.stone_pickaxe.id;
const DIG_MS = { stone: (t) => (t === PICK ? 400 : 7500), dirt: () => 750, gravel: () => 900, sand: () => 750, clay: () => 1500 };
function world({ set = {}, ground = 'dirt', at = new Vec3(0, 64, 0), items = [] } = {}) {
    const cells = new Map(Object.entries(set));
    const blockAt = (p) => {
        const q = p.floored();
        const v = cells.get(key(q)) ?? (q.y < 64 ? ground : 'air');
        const b = reg.blocksByName[v];
        return { name: v, metadata: 0, boundingBox: b?.boundingBox ?? 'block', material: b?.material, position: q, canHarvest: () => true,
            digTime: (type) => (DIG_MS[v] ?? (() => 60_000))(type) };
    };
    const calls = { digs: [], gotos: [] };
    const bot = {
        output: '', interrupt_code: false, entities: {}, registry: reg, version: '1.12.2', game: { gameMode: 'survival' },
        entity: { position: at.offset(0.5, 0, 0.5), onGround: true },
        inventory: { items: () => items }, heldItem: null, tool: { equipForBlock: async () => {} },
        blockAt, equip: () => Promise.resolve(), lookAt: () => Promise.resolve(), setControlState: () => {},
        digTime: () => 500,
        dig: (b) => { calls.digs.push(key(b.position)); cells.set(key(b.position), 'air'); return Promise.resolve(); },
        pathfinder: {
            setMovements() {}, setGoal() {}, stop() {}, isMoving: () => false, getPathTo: () => ({ status: 'success', path: [] }),
            goto(goal) { calls.gotos.push(goal); if (goal.x !== undefined) bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); return Promise.resolve(); },
        },
    };
    return { bot, cells, calls };
}
/** A hole shelter: the bot's two cells at y 61-62 dug out of the ground, sealed above. */
const HOLE = new Vec3(0, 61, 0);
const hole = (opts = {}) => world({ ...opts, at: HOLE, set: { [key(HOLE)]: 'air', [key(HOLE.offset(0, 1, 0))]: 'air', ...(opts.set ?? {}) } });

test('soak 12 (B): a way out on foot: open ground has one; a sealed hole shelter has none; nor a cell walled in on the surface, unless its walls count as removable', () => {
    assert.deepEqual([WALK_EXIT.reach, DIG_OUT.maxBlocks], [8, 6]);
    assert.ok(walkableExit(world().bot, new Vec3(0, 64, 0)), 'open ground');
    assert.equal(walkableExit(hole().bot, HOLE), null, 'the hole: walled in by ground');
    const walls = {};
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1]) walls[key(new Vec3(dx, 64 + dy, dz))] = 'cobblestone';
    const shut = world({ set: walls });
    assert.equal(walkableExit(shut.bot, new Vec3(0, 64, 0)), null, 'a closed shelter on the ground');
    assert.ok(walkableExit(shut.bot, new Vec3(0, 64, 0), { free: new Set(Object.keys(walls)) }), 'its walls come down in the morning');
    // A step up and a step down are walked; a 2-block wall is not.
    const step = world({ set: { [key(new Vec3(1, 64, 0))]: 'dirt' } });
    assert.ok(walkableExit(step.bot, new Vec3(0, 64, 0)));
});

test('soak 12 (B, D3): the dig-out of a hole: stairs up by hand in at most 6 quick blocks, ending at a way out; away from a hostile, the other side', () => {
    const h = hole();
    const plan = stairOutPlan(h.bot, HOLE);
    assert.ok(plan, 'a plan');
    assert.ok(plan.dig.length <= DIG_OUT.maxBlocks, `${plan.dig.length} blocks`);
    assert.ok(plan.to.y >= 63, `up near the surface: ${plan.to}`);
    // A zombie on the east rim: the stairs go another way, ending farther from it than the bot is.
    const z = { position: new Vec3(2.5, 64, 0.5) };
    const away = stairOutPlan(h.bot, HOLE, { hostiles: [z] });
    assert.ok(away);
    assert.notEqual(away.side.x, 1, 'not toward the zombie');
    const d = (p) => Math.hypot(p.x + 0.5 - z.position.x, p.z + 0.5 - z.position.z);
    assert.ok(d(away.to) > d(HOLE));
    // Zombies on every side: no way away from them.
    const ring = [[3, 0], [-3, 0], [0, 3], [0, -3]].map(([x, zz]) => ({ position: new Vec3(x + 0.5, 64, zz + 0.5) }));
    assert.equal(stairOutPlan(h.bot, HOLE, { hostiles: ring }), null);
});

test('soak 12 (the lead\'s decision 1): only quick blocks: stone not without a pickaxe (with one: yes); never a block next to water; never more than maxBlocks', () => {
    const rock = hole({ ground: 'stone' });
    assert.equal(quickDig(rock.bot, HOLE.offset(1, 0, 0)), false, 'stone by hand: no');
    assert.equal(stairOutPlan(rock.bot, HOLE), null);
    const pick = hole({ ground: 'stone', items: [{ name: 'stone_pickaxe', metadata: 0, count: 1, type: PICK }] });
    assert.ok(stairOutPlan(pick.bot, HOLE), 'with a pickaxe');
    const wet = hole({ set: Object.fromEntries([[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => [key(new Vec3(2 * x, 62, 2 * z)), 'water'])) });
    const p = stairOutPlan(wet.bot, HOLE);
    assert.ok(!p || p.dig.every(c => quickDig(wet.bot, c)), 'no dug block next to water');
    assert.equal(stairOutPlan(hole().bot, HOLE, { maxBlocks: 2 }), null, 'a 2-block budget is too little from 3 deep');
    // #593 review 5: the dig time decides (a melon block, hardness 1, 1.5 s by hand: no; clay 0.9 s: yes), not a hardness bucket.
    assert.equal(quickDig(hole({ ground: 'melon_block' }).bot, HOLE.offset(1, 0, 0)), false);
    assert.equal(stairOutPlan(hole({ ground: 'melon_block' }).bot, HOLE), null);
    assert.equal(quickDig(hole({ ground: 'clay' }).bot, HOLE.offset(1, 0, 0)), true);
});

// #593 re-review 1: prismarine's digTime knows only vanilla ids: a flint pickaxe on stone read 7.5 s, so
// stone was never a quick dig with the pack's pickaxes. rotn-data's tool data now (speed 3.8: 0.6 s).
test('#593 re-review 1: stone with the pickaxes: pyrotech:flint_pickaxe by rotn-data\'s speed (about 0.6 s), minecraft:stone_pickaxe too; by hand, never; a tool rotn-data does not know is the hand (#593 re-review nit)', async () => {
    const { toolDigMs } = await import('./walk_exit.js');
    const stone = { name: 'stone', metadata: 0 };
    const bot = { inventory: { items: () => [] } };
    assert.ok(Math.abs(toolDigMs(bot, stone, { name: 'pyrotech:flint_pickaxe' }) - 1.5 * 1.5 / 3.8 * 1000) < 1);
    assert.ok(Math.abs(toolDigMs(bot, stone, { name: 'stone_pickaxe' }) - 1.5 * 1.5 / 4 * 1000) < 1);
    assert.equal(toolDigMs(bot, stone, null), Infinity, 'a pickaxe is required (Tool Progression)');
    // An unknown tool: Infinity where a tool is required (allowedTool would refuse it), the hand's time otherwise.
    assert.equal(toolDigMs(bot, stone, { name: 'nosuchmod:odd_pickaxe' }), Infinity);
    assert.equal(toolDigMs(bot, { name: 'melon_block', metadata: 0 }, { name: 'nosuchmod:odd_pickaxe' }), 1500, 'a melon block: 1.5 s, as by hand');
    for (const name of ['pyrotech:flint_pickaxe', 'minecraft:stone_pickaxe']) {
        const w = hole({ ground: 'stone', items: [{ name, metadata: 0, count: 1, type: 9999 }] });
        assert.equal(quickDig(w.bot, HOLE.offset(1, 0, 0)), true, name);
        assert.ok(stairOutPlan(w.bot, HOLE), `${name}: a dig-out from a stone hole`);
    }
});

// #593 review 1 (blocking): gravel over the hole's roof dropped down the column the dig-out opened.
test('#593 review 1: never a dig under a falling block: gravel over the hole\'s roof, or sand over a tunnel cell, refuses that cell (another way, or none)', () => {
    const roof = HOLE.offset(0, 2, 0); // the dirt over the bot's head; the gravel above it is at the surface (y 64)
    const g = hole({ set: { [key(HOLE.offset(0, 3, 0))]: 'gravel' } });
    assert.equal(quickDig(g.bot, roof), false, 'the roof under the gravel');
    const plan = stairOutPlan(g.bot, HOLE);
    assert.ok(!plan || !plan.dig.some(c => c.equals(roof)), `never the roof: ${plan?.dig.join(' ')}`);
    // Sand over every first tunnel cell's head: those cells are refused.
    const sandy = {};
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) sandy[key(new Vec3(x, 63, z))] = 'sand';
    const s = hole({ set: sandy });
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.equal(quickDig(s.bot, new Vec3(x, 62, z)), false);
    const p2 = stairOutPlan(s.bot, HOLE);
    assert.ok(!p2 || p2.dig.every(c => quickDig(s.bot, c)), 'every dug cell checked');
});

// #593 review 4: one reach for "walled in" and "out": a pocket 5 wide is walled in, and the dig-out
// from it ends at a real way out (8 blocks), never "dug out" with 0 blocks.
test('#593 review 4: a pocket 5 wide is not a way out; the dig-out from it digs', () => {
    const pocket = {};
    for (let x = -2; x <= 2; x++) { pocket[key(new Vec3(x, 61, 0))] = 'air'; pocket[key(new Vec3(x, 62, 0))] = 'air'; }
    const w = world({ at: HOLE, set: pocket });
    assert.equal(walkableExit(w.bot, HOLE), null);
    const plan = stairOutPlan(w.bot, HOLE);
    assert.ok(plan && plan.dig.length > 0, 'a plan that digs');
});

test('soak 12 (B, D3): stairOut digs the plan and walks out; nothing to dig out by: null with why', async () => {
    const h = hole();
    const r = await stairOut(h.bot, HOLE);
    assert.ok(r.to, r.why);
    assert.ok(h.calls.digs.length >= 1 && h.calls.digs.length <= DIG_OUT.maxBlocks, h.calls.digs.join(' '));
    assert.equal(h.calls.gotos.length, 1);
    const rock = hole({ ground: 'stone' });
    const none = await stairOut(rock.bot, HOLE);
    assert.equal(none.to, null);
    assert.match(none.why, /no way out within 6 quick blocks/);
    assert.deepEqual(rock.calls.digs, []);
});

// Soak 14 (F2, net-forge): Hunger Overhaul's Mining Fatigue at low food slows every dig (food 3: II x0.09): the dig
// estimates (quickDig, the scroll's kept-items rule, the dig-out plan) count it.
test('soak 14 (F2): digSpeedFactor: Mining Fatigue I-IV x0.3/0.09/0.0027/0.00081, Haste +20% a level; dirt by hand is no quick dig under Mining Fatigue II', async () => {
    const { digSpeedFactor, digMs } = await import('./walk_exit.js');
    const fx = (amp, name = 'MiningFatigue') => ({ registry: { effects: { 4: { name } } }, entity: { effects: { 4: { amplifier: amp } } } });
    assert.equal(digSpeedFactor({}), 1);
    assert.equal(digSpeedFactor(fx(0)), 0.3);
    assert.equal(digSpeedFactor(fx(1)), 0.09);
    assert.equal(digSpeedFactor(fx(3)), 0.00081);
    assert.equal(digSpeedFactor(fx(9)), 0.00081);
    assert.ok(Math.abs(digSpeedFactor(fx(1, 'Haste')) - 1.4) < 1e-9);
    const w = world();
    assert.equal(quickDig(w.bot, new Vec3(1, 63, 0)), true, 'dirt by hand, 750 ms');
    Object.assign(w.bot, fx(1));
    assert.ok(Math.abs(digMs(w.bot, w.bot.blockAt(new Vec3(1, 63, 0))) - 750 / 0.09) < 1);
    assert.equal(quickDig(w.bot, new Vec3(1, 63, 0)), false, 'Mining Fatigue II: 8.3 s');
});
