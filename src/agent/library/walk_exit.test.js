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
function world({ set = {}, ground = 'dirt', at = new Vec3(0, 64, 0), items = [] } = {}) {
    const cells = new Map(Object.entries(set));
    const blockAt = (p) => {
        const q = p.floored();
        const v = cells.get(key(q)) ?? (q.y < 64 ? ground : 'air');
        const b = reg.blocksByName[v];
        return { name: v, metadata: 0, boundingBox: b?.boundingBox ?? 'block', material: b?.material, position: q, canHarvest: () => true };
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
    const pick = hole({ ground: 'stone', items: [{ name: 'stone_pickaxe', metadata: 0, count: 1 }] });
    assert.ok(stairOutPlan(pick.bot, HOLE), 'with a pickaxe');
    const wet = hole({ set: Object.fromEntries([[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => [key(new Vec3(2 * x, 62, 2 * z)), 'water'])) });
    const p = stairOutPlan(wet.bot, HOLE);
    assert.ok(!p || p.dig.every(c => quickDig(wet.bot, c)), 'no dug block next to water');
    assert.equal(stairOutPlan(hole().bot, HOLE, { maxBlocks: 2 }), null, 'a 2-block budget is too little from 3 deep');
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
