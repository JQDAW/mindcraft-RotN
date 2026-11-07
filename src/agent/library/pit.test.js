// G3 round 9 batch B, fix (h): the hole shelter, which needs nothing in the inventory. After the
// night-time death the bot respawned with nothing next to where it died; the shelter needs 10 dirt
// and was refused (driver.log 501), and the bot died again digging dirt there (server.log 575).
// A fake world (dirt below y 64, air above, plus what a test sets) and a fake bot that digs (a dug
// dirt gives 4 dirt piles; a block dug under its feet drops it), places against solid blocks and
// walks where it is sent; the real 3.3.4 dump for what is a wall and what is dug by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { pitProblem, choosePit, digPit, pitOut, moveAwayFrom, PIT } from './pit.js';
import { buildShelter } from './shelter.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const key = (p) => `${p.x},${p.y},${p.z}`;
const PILE = { name: 'betterwithmods:dirt_pile', metadata: 0 };
const DIRT = { name: 'dirt', metadata: 0 };

function fakeBot({ set = {}, at = new Vec3(0, 64, 0) } = {}) {
    const world = new Map(Object.entries(set));
    const items = [];
    const give = (stack, n) => { const s = items.find(i => i.name === stack.name && i.metadata === stack.metadata); if (s) s.count += n; else items.push({ ...stack, count: n }); };
    const calls = { digs: [], placed: [], gotos: [] };
    const blockAt = (p) => {
        const q = p.floored();
        const v = world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air');
        const b = reg.blocksByName[v];
        return { name: v, metadata: 0, boundingBox: b?.boundingBox ?? 'block', material: b?.material, position: q, canHarvest: () => true };
    };
    const fall = () => {
        let p = bot.entity.position.floored();
        while (p.y > 0 && blockAt(p.offset(0, -1, 0)).boundingBox === 'empty') p = p.offset(0, -1, 0);
        bot.entity.position = p.offset(0.5, 0, 0.5);
    };
    const bot = {
        output: '', interrupt_code: false, entities: {}, registry: reg, version: '1.12.2',
        entity: { position: at.offset(0.5, 0, 0.5) },
        inventory: { items: () => items.filter(i => i.count > 0) },
        modes: { isOn: () => false },
        game: { gameMode: 'survival' },
        tool: { equipForBlock: async () => {} },
        heldItem: null,
        blockAt,
        equip: (item) => { bot.heldItem = item; return Promise.resolve(); },
        lookAt: () => Promise.resolve(),
        setControlState: () => {},
        dig: (b) => {
            calls.digs.push(key(b.position));
            if (b.name === 'dirt') give(PILE, 4);
            world.set(key(b.position), 'air');
            fall();
            return Promise.resolve();
        },
        placeBlock: (ref, face) => {
            const target = ref.position.plus(face);
            assert.notEqual(ref.boundingBox, 'empty', 'placed against a solid block');
            bot.heldItem.count--;
            world.set(key(target), bot.heldItem.name);
            calls.placed.push(key(target));
            return Promise.resolve();
        },
        pathfinder: {
            setMovements() {}, stop() {}, isMoving: () => false,
            getPathTo: () => ({ status: 'success', path: [] }),
            goto(goal) {
                calls.gotos.push(goal);
                if (goal.x !== undefined) bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5);
                return Promise.resolve();
            },
        },
    };
    return { bot, world, items, calls };
}

/** Crafting as the server would: 4 dirt piles make a dirt block. */
const craft = (items) => (bot, name, want) => {
    const s = items.find(i => i.name === PILE.name && i.count >= 4);
    if (name !== 'dirt:0' || !s) return Promise.resolve(false);
    const made = Math.min(want, Math.floor(s.count / 4));
    s.count -= 4 * made;
    const d = items.find(i => i.name === 'dirt'); if (d) d.count += made; else items.push({ ...DIRT, count: made });
    return Promise.resolve(true);
};

test('round 9 B (h): with nothing held, a hole 3 deep is dug by hand and roofed with dirt from its own piles: a closed shelter', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, items, calls } = fakeBot();
    assert.deepEqual(items, [], 'nothing held, as after the death');
    const feet = await digPit(bot);
    assert.ok(feet?.equals(new Vec3(0, 61, 0)), `feet ${feet}`);
    assert.deepEqual(calls.digs, ['0,63,0', '0,62,0', '0,61,0']);
    assert.equal(items.find(i => i.name === PILE.name)?.count, 12, '3 dirt dug by hand: 12 piles');

    const r = await buildShelter(bot, { site: feet, keepSoft: true, craft: craft(items) });
    assert.equal(r.closed, true, bot.output);
    assert.deepEqual(calls.placed, ['0,63,0'], 'only the roof, flush with the ground');
});

test('round 9 B (h): no hole where the column is not hand-diggable, by water or sand, or with no side to dig stairs out of', () => {
    const at = new Vec3(0, 64, 0);
    const p = (set) => pitProblem(fakeBot({ set }).bot, at)?.why ?? null;
    assert.equal(p({}), null, 'flat dirt');
    assert.match(p({ '0,62,0': 'stone' }), /stone at 0, 62, 0 cannot be dug by hand/);
    assert.match(p({ '1,62,0': 'water' }), /water at 1, 62, 0/);
    assert.match(p({ '2,63,0': 'sand' }), /sand at 2, 63, 0 would flow or fall in/);
    const noStairs = {};
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) noStairs[`${x},62,${z}`] = 'stone'; // step 1 cannot be dug
    assert.match(p(noStairs), /no side to dig stairs out of by hand/);
    // choosePit takes the nearest good cell.
    const { bot } = fakeBot({ set: { '0,62,0': 'stone' } });
    const P = choosePit(bot);
    assert.ok(P && !P.equals(at) && P.y === 64, `chose ${P}`);
});

test('round 9 B (h): in the morning the roof and one side\'s stairs are dug by hand and the bot walks up them', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, items, calls } = fakeBot();
    const feet = await digPit(bot);
    await buildShelter(bot, { site: feet, keepSoft: true, craft: craft(items) });
    calls.digs.length = 0;
    const exit = await pitOut(bot, feet);
    assert.ok(exit?.equals(new Vec3(3, 64, 0)), `exit ${exit}`);
    assert.deepEqual(calls.digs, ['0,63,0', '1,62,0', '1,63,0', '2,63,0'], 'the roof, then the stairs');
    assert.ok(bot.entity.position.floored().equals(exit));
});

test('round 9 B (h): moveAwayFrom walks until at least PIT.awayFrom from the death spot', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, calls } = fakeBot({ at: new Vec3(-70, 64, -57) });
    const spot = { x: -78.5, y: 58, z: -59.5 };
    bot.pathfinder.goto = (goal) => { calls.gotos.push(goal); bot.entity.position = new Vec3(-40.5, 64, -57.5); return Promise.resolve(); };
    assert.equal(PIT.awayFrom, 28);
    assert.equal(await moveAwayFrom(bot, spot), true);
    assert.equal(calls.gotos.length, 1);
    const g = calls.gotos[0];
    assert.equal(g.constructor.name, 'GoalInvert');
    assert.equal(g.goal.constructor.name, 'GoalNear');
    assert.deepEqual([g.goal.x, g.goal.z, g.goal.rangeSq], [-79, -60, 28 * 28]);
    assert.equal(await moveAwayFrom(bot, spot), true, 'already far: no walk');
    assert.equal(calls.gotos.length, 1);
});
