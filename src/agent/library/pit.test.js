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
import { pitProblem, choosePit, digPit, pitOut, PIT, DIG_STALL } from './pit.js';
import { buildShelter, retreatPlan, backAway } from './shelter.js';

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
        entity: { position: at.offset(0.5, 0, 0.5), onGround: true },
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
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) noStairs[`${x},63,${z}`] = 'stone'; // step 1's head space cannot be dug
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


// ---- #337 review (lead, REQUEST CHANGES on 36bb947) ----

test('#337 review 1, 3, 4: no hole with rock beside its bottom on every side, with no dirt-pile block in the column, or on a falling floor', () => {
    const at = new Vec3(0, 64, 0);
    const p = (set) => pitProblem(fakeBot({ set }).bot, at)?.why ?? null;
    // Rock beside the bottom cell (y 61) all round: without a pickaxe the shelter refuses the roof.
    const rock61 = {};
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) rock61[`${x},61,${z}`] = 'stone';
    assert.match(p(rock61), /no side beside the bottom of the hole could be dug out by hand/);
    const oneSide = { ...rock61 }; delete oneSide['1,61,0'];
    assert.equal(p(oneSide), null, 'one side of dirt is enough');
    // A clay column digs by hand but gives no dirt piles for the roof.
    assert.match(p({ '0,63,0': 'clay', '0,62,0': 'clay', '0,61,0': 'clay' }), /gives dirt piles for the roof/);
    assert.equal(p({ '0,63,0': 'clay', '0,62,0': 'clay' }), null, 'one dirt in the column is enough');
    // Gravel as the floor (over a cave).
    assert.match(p({ '0,60,0': 'gravel' }), /no firm floor at 0, 60, 0/);
});

test('#337 review 2: a walk to the hole that runs out of time stops the pathfinder', async (t) => {
    t.mock.method(console, 'log', () => {});
    const saved = { ...PIT };
    Object.assign(PIT, { walkMs: 50 });
    t.after(() => Object.assign(PIT, saved));
    const { bot } = fakeBot({ set: { '0,62,0': 'stone' } }); // the bot's own cell is no place: it must walk
    let stops = 0, pending = null;
    // Never arrives; mineflayer's pathfinder.stop() ends the walk with PathStopped.
    bot.pathfinder.goto = () => new Promise((resolve, reject) => { pending = reject; });
    bot.pathfinder.stop = () => { stops++; pending?.(Object.assign(new Error('stopped'), { name: 'PathStopped' })); };
    assert.equal(await digPit(bot), null);
    assert.ok(stops >= 1, 'stopped, not left walking');
    assert.match(bot.output, /Could not reach the place for a hole shelter/);
});

test('#337 review 5: with no side to dig stairs out of, the roof stays on in the morning; stairs may be dug through ground', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, items, calls, world } = fakeBot();
    const feet = await digPit(bot);
    await buildShelter(bot, { site: feet, keepSoft: true, craft: craft(items) });
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) world.set(`${x},63,${z}`, 'stone'); // every step 1 blocked
    calls.digs.length = 0;
    assert.equal(await pitOut(bot, feet), null);
    assert.deepEqual(calls.digs, [], 'the roof was not dug');
    assert.match(bot.output, /No side of the hole shelter at 0, 61, 0 to dig stairs out of by hand; staying in it\./);

    // A hillside: the exit cell is dirt, not air: dug as part of the stairs.
    const hill = fakeBot({ set: { '3,64,0': 'dirt' } });
    const f2 = await digPit(hill.bot);
    await buildShelter(hill.bot, { site: f2, keepSoft: true, craft: craft(hill.items) });
    hill.calls.digs.length = 0;
    const exit = await pitOut(hill.bot, f2);
    assert.ok(exit, hill.bot.output);
    assert.ok(hill.calls.digs.includes('0,63,0'), 'the roof');
});

test('#337 review 6: an interrupted dig goes on in the same hole', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, calls } = fakeBot();
    const progress = {};
    bot.interrupt_code = false;
    const dig = bot.dig;
    bot.dig = (b) => { const r = dig(b); if (calls.digs.length === 1) bot.interrupt_code = true; return r; }; // stopped after the first
    assert.equal(await digPit(bot, { progress }), null);
    assert.ok(progress.P?.equals(new Vec3(0, 64, 0)));
    bot.interrupt_code = false;
    bot.dig = dig;
    const feet = await digPit(bot, { progress });
    assert.ok(feet?.equals(new Vec3(0, 61, 0)), `feet ${feet}`);
    assert.deepEqual(calls.digs, ['0,63,0', '0,62,0', '0,61,0'], 'the same column, no new hole');
    assert.match(bot.output, /Going on with a hole shelter at 0, 64, 0/);
});

test('soak 2 (night 2): a column with Dynamic Trees rooty dirt (hardness 20, 30 s by hand) is no place for a hole', () => {
    const P = new Vec3(0, 64, 0);
    const { bot } = fakeBot({ set: { '0,63,0': 'dynamictrees:rootydirt' } });
    assert.match(pitProblem(bot, P)?.why ?? '', /dynamictrees:rootydirt at 0, 63, 0 cannot be dug by hand/);
    const chosen = choosePit(bot, 1);
    assert.ok(chosen && !chosen.equals(P), `another spot: ${chosen}`);
    assert.equal(pitProblem(fakeBot().bot, P), null, 'plain dirt is fine');
});

test('soak 2: the bot is still on purpose while it digs (the unstuck reflex leaves it alone); a dig past its limit gives up the spot, which is not chosen again', async (t) => {
    t.mock.method(console, 'log', () => {});
    const warns = [];
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    // Soak 14 (F2): the limit is DIG_STALL.factor x the estimate + slackMs.
    const saved = DIG_STALL.slackMs;
    DIG_STALL.slackMs = 200;
    t.after(() => { DIG_STALL.slackMs = saved; });
    const { bot, calls } = fakeBot();
    const stationary = [];
    const dig = bot.dig;
    bot.digTime = () => 10;
    let hang = true;
    let stopped = 0;
    bot.stopDigging = () => { stopped++; bot.targetDigBlock = null; };
    bot.entity.effects = { 4: { amplifier: 1 } }; // mining fatigue II
    bot.registry = { ...reg, effects: { 4: { id: 4, name: 'MiningFatigue' } } };
    bot.dig = (b) => { stationary.push(bot.rotnStationary); if (!hang) return dig(b); bot.targetDigBlock = b; return new Promise(() => {}); };
    const progress = {};
    assert.equal(await digPit(bot, { progress }), null);
    assert.deepEqual(stationary, [true], 'still on purpose while digging');
    assert.equal(bot.rotnStationary, false, 'and not after');
    assert.equal(stopped, 1, 'the hanging dig is stopped');
    assert.match(bot.output, /Digging dirt at 0, 63, 0 \(about 0\.0 s by hand\)\./);
    assert.match(bot.output, /Gave up the hole shelter at 0, 64, 0: dirt:0 at 0, 63, 0 was not dug within 0\.2 s\. The next hole is dug elsewhere\./);
    // #431 review 3: why it hung, for the next soak.
    assert.ok(warns.some(w => w === '[night] hole shelter: dirt:0 at 0, 63, 0 was not dug within 0.2 s (onGround true, isInWater undefined, effects MiningFatigue:1, held nothing)'), warns.join('\n'));
    assert.equal(progress.why, 'dirt:0 at 0, 63, 0 was not dug within 0.2 s; the next hole is dug elsewhere', 'the night routine\'s reason');
    assert.ok(progress.bad.has('0, 64, 0'));
    hang = false;
    const feet = await digPit(bot, { progress });
    assert.ok(feet, 'a hole elsewhere');
    assert.notEqual(`${feet.x},${feet.z}`, '0,0', 'not the spot it gave up');
    assert.equal(calls.digs.length, 3);
});

test('#431 review 6: no dig starts once the time is up (an equip still running when digPit gives up)', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    // Soak 14 (F2): the limit is DIG_STALL.factor x the estimate + slackMs.
    const saved = DIG_STALL.slackMs;
    DIG_STALL.slackMs = 100;
    t.after(() => { DIG_STALL.slackMs = saved; });
    const { bot, calls } = fakeBot();
    bot.digTime = () => 10;
    bot.stopDigging = () => {};
    bot.tool = { equipForBlock: () => new Promise(resolve => setTimeout(resolve, 250)) }; // slower than the limit
    assert.equal(await digPit(bot, { progress: {} }), null);
    await new Promise(resolve => setTimeout(resolve, 350)); // the equip ends after digPit returned
    assert.deepEqual(calls.digs, [], 'no dig started afterwards');
});

// #472 follow-up 1: the whole night of a hole shelter on the fake world's real geometry: dug with
// nothing held, roofed from its own piles, the side pocket (piles crafted into the seal's dirt), and
// out in the morning from the pocket.
test('#472 follow-up: digPit, the roof, retreatPlan and backAway into the side pocket, then pitOut from the pocket', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, items, world, calls } = fakeBot();
    // The pocket's step into its middle walks (sneaking): 0.1 a step towards where the bot looks.
    let looking = null;
    bot.lookAt = (p) => { looking = p; return Promise.resolve(); };
    bot.setControlState = (control, on) => {
        if (control !== 'forward' || !on || !looking) return;
        const pos = bot.entity.position, dx = looking.x - pos.x, dz = looking.z - pos.z, d = Math.hypot(dx, dz);
        if (d > 0) bot.entity.position = pos.offset(dx / d * Math.min(0.1, d), 0, dz / d * Math.min(0.1, d));
    };
    const feet = await digPit(bot);
    assert.ok(feet.equals(new Vec3(0, 61, 0)));
    assert.equal((await buildShelter(bot, { site: feet, keepSoft: true, craft: craft(items) })).closed, true, bot.output);
    // The roof kept SHELTER_SPARE dirt; say a repair used it up and the bot holds piles instead
    // (dug cells give piles, not dirt blocks): the pocket crafts its seal from them.
    const dirt = items.find(i => i.name === 'dirt');
    assert.equal(dirt?.count, 2, 'the spare dirt');
    dirt.count = 0;
    const piles = items.find(i => i.name === PILE.name) ?? (items.push({ ...PILE, count: 0 }), items.at(-1));
    piles.count = 8;

    const plan = retreatPlan(bot, feet, []);
    assert.ok(plan, 'the piles count towards the seal');
    assert.equal(key(plan.to), '1,61,0');
    const r = await backAway(bot, plan, { craft: craft(items) });
    assert.deepEqual(r, { site: new Vec3(1, 61, 0) }, bot.output);
    assert.equal(world.get('0,61,0'), 'dirt');
    assert.equal(world.get('0,62,0'), 'dirt');
    assert.equal(piles.count, 8, 'the 8 piles made the two dirt of the seal before the dig; the pocket\'s two cells gave 8 more');
    assert.equal(world.get('0,63,0'), 'dirt', 'the roof still on');
    assert.deepEqual(['1,61,0', '1,62,0'].map(k => world.get(k)), ['air', 'air'], 'in the pocket');
    // The pocket's ceiling is natural ground: only the two seals were placed (the lead's soak note).
    assert.equal(world.get('1,63,0') ?? 'dirt', 'dirt');

    calls.digs.length = 0;
    const exit = await pitOut(bot, plan.to);
    assert.ok(exit, `out of the pocket in the morning: ${bot.output}`);
    assert.ok(bot.entity.position.floored().equals(exit));
    assert.equal(exit.y, 64, 'up on the ground');
});

test('soak 4: pitOut away from a mob takes the stairs whose top is farthest from it', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, items } = fakeBot();
    const feet = await digPit(bot);
    await buildShelter(bot, { site: feet, keepSoft: true, craft: craft(items) });
    const exit = await pitOut(bot, feet, { away: new Vec3(4.5, 64, 0.5) });
    assert.ok(exit && exit.x < 0, `out on the west, away from the zombie in the east: ${exit}`);
});

// Soak 14 (F2, the lead; net-forge (C)): the stall limit is 3 x the expected time + 2 s, taken after the equip from the
// tool that digs (morning 1: the hand's Infinity gave the 4 s floor for cobble that took 16.7 s with the pickaxe under
// Mining Fatigue II); a dig expected past 60 s (or the caller's cap) is not started; the [dig] line says why, with the
// held item and slot, the effects and the time since the spawn.
test('soak 14 (F2): digBudget 3 x + 2 s; digWithin takes it after the equip; a dig too slow is not started; [dig] lines', async (t) => {
    const { digBudget, digWithin, DIG_STALL, digLine } = await import('./pit.js');
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    assert.deepEqual([DIG_STALL.factor, DIG_STALL.slackMs, DIG_STALL.maxEstMs], [3, 2000, 60_000]);
    const block = { name: 'contenttweaker:limestone_cobble', metadata: 0, position: new Vec3(1, 66, 0) };
    const pick = { name: 'stone_pickaxe', count: 1 };
    const bot = { game: { gameMode: 'survival' }, heldItem: null, quickBarSlot: 2, rotnSpawnedAt: Date.now() - 30_000, entity: { effects: { 4: { amplifier: 1 } } },
        registry: { effects: { 4: { name: 'MiningFatigue' } } }, blockAt: () => block,
        digTime: () => (bot.heldItem === pick ? 16_700 : Infinity) };
    assert.deepEqual(digBudget(bot, block), { estMs: Infinity, limitMs: DIG_STALL.unknownMs }, 'the hand: no estimate, the floor');
    let dug = 0;
    bot.dig = () => { dug++; return Promise.resolve(); };
    const equip = () => { bot.heldItem = pick; return Promise.resolve(true); };
    assert.equal(await digWithin(bot, block, Infinity, { equip }), true, 'the pickaxe\'s 16.7 s: limit 52.1 s, not the 4 s floor');
    assert.deepEqual(bot.rotnLastDig, { estMs: 16_700, limitMs: 3 * 16_700 + 2000 });
    assert.equal(dug, 1);
    // Too slow for the caller's cap: not started, said why.
    bot.heldItem = null;
    assert.equal(await digWithin(bot, block, 10_000, { equip }), false);
    assert.equal(dug, 1, 'not started');
    assert.ok(logs.includes('[dig] contenttweaker:limestone_cobble:0 at 1, 66, 0: not started: it would take 16.7 s, over 10.0 s; expected 16.7 s with stone_pickaxe (slot 2); effects MiningFatigue:1; 30 s since the spawn; the block is still there'), logs.join('\n'));
    // A stale Mining Fatigue IV: dirt by hand 926 s, over 60 s: not started.
    const dirt = { name: 'dirt', metadata: 0, position: new Vec3(0, 63, 0) };
    const stale = { game: { gameMode: 'survival' }, heldItem: null, entity: { effects: { 4: { amplifier: 3 } } }, registry: { effects: { 4: { name: 'MiningFatigue' } } },
        blockAt: () => dirt, digTime: () => 926_000, tool: { equipForBlock: () => Promise.resolve() }, dig: () => { throw new Error('never'); } };
    assert.equal(await digWithin(stale, dirt, Infinity), false);
    assert.match(digLine(stale, dirt, { what: 'x', estMs: 926_000 }), /^\[dig\] dirt:0 at 0, 63, 0: x; expected 926\.0 s with the hand \(slot \?\); effects MiningFatigue:3; no spawn time; the block is still there$/);
});

// #614 review 6 and 7: digWithin clears the last dig's record at entry (a later equip failure is not blamed on an
// earlier refusal); its equip (and the off-hand pickaxe's move) has its own cap, DIG_STALL.equipMs, even with no caller cap.
test('#614 review 6 and 7: rotnLastDig is cleared at entry; the equip is capped by DIG_STALL.equipMs', async (t) => {
    const { digWithin, DIG_STALL } = await import('./pit.js');
    t.mock.method(console, 'log', () => {});
    const block = { name: 'stone', metadata: 0, position: new Vec3(1, 64, 0) };
    const bot = { game: { gameMode: 'survival' }, heldItem: null, blockAt: () => block, digTime: () => 120_000, dig: () => Promise.resolve() };
    assert.equal(await digWithin(bot, block, Infinity, { equip: () => Promise.resolve(true) }), false);
    assert.equal(bot.rotnLastDig.refused, true);
    assert.equal(await digWithin(bot, block, Infinity, { equip: () => Promise.resolve(false) }), false);
    assert.equal(bot.rotnLastDig, null, 'the equip failed: no stale refusal');
    const saved = DIG_STALL.equipMs;
    DIG_STALL.equipMs = 50;
    t.after(() => { DIG_STALL.equipMs = saved; });
    assert.equal(DIG_STALL.equipMs, 50);
    const t0 = Date.now();
    assert.equal(await digWithin(bot, block, Infinity, { equip: () => new Promise(() => {}) }), 'timeout');
    assert.ok(Date.now() - t0 < 1000, 'the hung equip is cut');
});
