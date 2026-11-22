// Soak 8 (rotn-v0.1.14, night 2): the bot at sunset in a river channel (feet at y 59, flowing water,
// sand bed), the dry bank 5 blocks higher, outside the shelter search's 2 up or down. A fake world
// of columns (the real 3.3.4 dump for what is sturdy, a wall, falling or dug by hand) and a fake bot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { groundPlan, walkToGround, stepToDry, dryCell, inWater, fitsAt, surfaceAt, planText, mobOnWay, goodFloor, pureWalk, GROUND } from './shelter_ground.js';
import { buildShelter, chooseSite, standsIn, tallyText } from './shelter.js';
import { digPit } from './pit.js';
import { setImmediate } from 'node:timers';
import pf from 'mineflayer-pathfinder';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);

/**
 * A river along z: |x| <= half is the channel (sand at y 58, water from 59 to 63); elsewhere dirt
 * up to 63 and air above (the bank's surface: feet at 64). `set`: cells by "x,y,z".
 */
function river({ half = 6, set = {} } = {}) {
    return (q) => {
        const s = set[`${q.x},${q.y},${q.z}`];
        if (s) return s;
        if (Math.abs(q.x) <= half) return q.y < 58 ? 'dirt' : q.y === 58 ? 'sand' : q.y <= 63 ? 'water' : 'air';
        return q.y < 64 ? 'dirt' : 'air';
    };
}

function fakeBot({ world = river(), at = new Vec3(0, 59, 0), entities = {} } = {}) {
    const blockAt = (p) => {
        const q = p.floored();
        if (Math.abs(q.x) > 60 || Math.abs(q.z) > 60) return null; // not loaded
        const v = world(q);
        const b = reg.blocksByName[v];
        return { name: v, metadata: 0, type: b?.id ?? 1, boundingBox: b?.boundingBox ?? 'block', material: b?.material, position: q, canHarvest: () => true };
    };
    const bot = {
        output: '', interrupt_code: false, entities, registry: reg, version: '1.12.2',
        entity: { position: at.offset(0.5, 0, 0.5), onGround: true },
        inventory: { items: () => [] },
        modes: { isOn: () => false },
        game: { gameMode: 'survival' },
        tool: { equipForBlock: async () => {} },
        heldItem: null,
        blockAt,
        equip: () => Promise.resolve(),
        lookAt: () => Promise.resolve(),
        setControlState: () => {},
        pathfinder: { stops: 0, stop() { this.stops++; }, setGoal() {}, setMovements() {} },
    };
    return bot;
}
const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };
const zombie = (x, y, z) => ({ name: 'zombie', type: 'mob', position: new Vec3(x, y, z) });

test('soak 8 (a): in the river every shelter site is refused; the line counts why and says where the bot is (in water); a hole too', async (t) => {
    quiet(t);
    const bot = fakeBot();
    const tally = new Map();
    assert.equal(chooseSite(bot, 4, { tally }), null);
    assert.ok((tally.get('water in the space') ?? 0) > 0, tallyText(tally));
    assert.equal(standsIn(bot), 'at 0, 59, 0, head in water');
    assert.equal(standsIn(fakeBot({ at: new Vec3(0, 63, 0) })), 'at 0, 63, 0, feet in water');
    assert.equal(standsIn(fakeBot({ at: new Vec3(9, 64, 0) })), 'at 9, 64, 0, on dirt');
    const r = await buildShelter(bot, { craft: () => Promise.resolve(false) });
    assert.equal(r.closed, false);
    assert.equal(r.noPlace, true, r.line);
    assert.match(r.line, /Found no place for a shelter within 4 blocks \(.*\)\. Refused: water in the space \d+.*; at 0, 59, 0, head in water\./);
    assert.match(r.refused, /^water in the space \d+.*; at 0, 59, 0, head in water$/);

    const progress = {};
    assert.equal(await digPit(bot, { progress }), null);
    assert.equal(progress.noPlace, true);
    assert.match(progress.why, /^found no place to dig a hole shelter within 3 blocks \(refused: water in the space \d+.*; at 0, 59, 0, head in water\)$/);
    assert.match(bot.output, /No place for a hole shelter within 3 blocks \(.*\)\. Refused: water in the space \d+/);
});

test('soak 8 (a): a shelter that only lacks blocks is no "no place" (the night routine does not walk for it)', async (t) => {
    quiet(t);
    const bot = fakeBot({ world: (q) => (q.y < 64 ? 'dirt' : 'air'), at: new Vec3(0, 64, 0) });
    const r = await buildShelter(bot, { craft: () => Promise.resolve(false) });
    assert.equal(r.closed, false);
    assert.equal(r.noPlace, false, r.line);
    assert.doesNotMatch(r.line, /no place/i);
});

test('soak 8 (b): the dry bank 8 blocks off and 5 up (outside the shelter search) is found, with what it takes', async () => {
    const bot = fakeBot();
    assert.equal(surfaceAt(bot, 8, 0, 59).y, 64, 'the bank surface, 5 up');
    assert.equal(surfaceAt(bot, 0, 0, 59), null, 'the channel: water all the way up');
    assert.equal(fitsAt(bot, new Vec3(7, 64, 0)), null, 'the edge: a wall over the water has nothing to go against');
    const plan = await groundPlan(bot);
    assert.ok(plan, 'a place');
    assert.equal(plan.kind, 'shelter');
    assert.equal(Math.abs(plan.feet.x), 8);
    assert.equal(plan.feet.y, 64);
    assert.ok(plan.blocks > 0 && plan.blocks <= 10, `blocks ${plan.blocks}`);
    assert.match(planText(plan), /^a shelter there needs \d+ blocks$/);
    assert.ok(Math.abs(plan.d - 8) < 1);
});

test('soak 8 (b), #557 review 1: a hostile mob ahead near the way skips a place; one behind the bot does not; places reached (skip) are not chosen again; none within the radius', async () => {
    // A zombie between the bot and the west bank: the east bank.
    const report = {};
    assert.equal((await groundPlan(fakeBot({ entities: { 1: zombie(-5, 64, 3) } }), { report })).feet.x, 8, 'the east bank');
    assert.equal(report.mobSkipped, 1);
    // #557 review 1: a zombie 12 behind the bot (east of it, past the east bank's way start) blocked
    // every plan before; now only the east bank, which it is ahead on the way to, is left out.
    const behind = await groundPlan(fakeBot({ entities: { 1: zombie(12, 59, 0) } }));
    assert.equal(behind?.feet.x, -8, 'the west bank: the zombie is behind the bot on that way');
    assert.equal(mobOnWay(fakeBot({ entities: { 1: zombie(-13, 59, 0) } }), new Vec3(0.5, 59, 0.5), new Vec3(8, 64, 0)), null, '13 behind');
    assert.equal(mobOnWay(fakeBot({ entities: { 1: zombie(10, 64, 0) } }), new Vec3(0.5, 59, 0.5), new Vec3(8, 64, 0))?.name, 'zombie', 'just past the place, nearer it than the bot: it waits there');
    assert.equal(mobOnWay(fakeBot({ entities: { 1: zombie(0, 59, 10) } }), new Vec3(0.5, 59, 0.5), new Vec3(8, 64, 0)), null, 'level with the bot, to the side');
    assert.equal(mobOnWay(fakeBot({ entities: { 1: zombie(30, 64, 0) } }), new Vec3(0.5, 59, 0.5), new Vec3(8, 64, 0)), null, 'far past the place, farther from it than the bot');
    assert.equal(mobOnWay(fakeBot({ entities: { 1: zombie(4, 64, 6) } }), new Vec3(0.5, 59, 0.5), new Vec3(8, 64, 0))?.name, 'zombie', 'ahead, 6 off the way');
    // Zombies ahead on every way: none, and the report says why.
    const all = {};
    const ring = Object.fromEntries([...Array(16).keys()].map(i => [i + 1, zombie(10 * Math.cos(i * Math.PI / 8), 64, 10 * Math.sin(i * Math.PI / 8))]));
    assert.equal(await groundPlan(fakeBot({ entities: ring }), { report: all }), null);
    assert.ok(all.mobSkipped > 0 && all.mob === 'zombie', JSON.stringify(all));
    const again = await groundPlan(fakeBot(), { skip: [new Vec3(-8, 64, 0), new Vec3(8, 64, 0)] });
    assert.ok(again && !(Math.abs(again.feet.x) === 8 && again.feet.z === 0), `another place: ${again?.feet}`);
    // A river 30 wide: no bank within 24 (nor within 12).
    const none = {};
    assert.equal(await groundPlan(fakeBot({ world: river({ half: 30 }) }), { report: none }), null);
    assert.equal(none.mobSkipped, 0);
    // A bank 16 off: within 24, not within the 12 of a night with no weapon.
    const wide = fakeBot({ world: river({ half: 14 }) });
    assert.equal(await groundPlan(wide, { radius: GROUND.unarmedRadius }), null);
    assert.equal(Math.abs((await groundPlan(wide, { radius: GROUND.radius })).feet.x), 16);
});

test('soak 8 (b): the last shelter comes first within 48 blocks, if a shelter still fits there; else the best place', async () => {
    const last = new Vec3(-30, 64, 20);
    const plan = await groundPlan(fakeBot(), { lastShelter: last });
    assert.equal(plan.kind, 'last');
    assert.ok(plan.feet.equals(last));
    assert.equal(planText(plan), 'the last shelter');
    assert.equal((await groundPlan(fakeBot(), { lastShelter: new Vec3(-55, 64, 20) })).kind, 'shelter', 'more than 48 off');
    assert.equal((await groundPlan(fakeBot(), { lastShelter: new Vec3(3, 59, 0) })).kind, 'shelter', 'in the river: no shelter fits');
});

test('soak 8 (b): the walk gets there; it stops when a hostile mob comes within 8; it stops at its time cap', async (t) => {
    quiet(t);
    const plan = { feet: new Vec3(8, 64, 0), kind: 'shelter', blocks: 9, d: 8 };
    const bot = fakeBot();
    const there = await walkToGround(bot, plan, { walk: (b, f) => { b.entity.position = f.offset(0.5, 0, 0.5); return Promise.resolve(); } });
    assert.deepEqual([there.arrived, there.stopped], [true, null]);

    const saved = { ...GROUND };
    t.after(() => Object.assign(GROUND, saved));
    Object.assign(GROUND, { checkMs: 20, walkMs: 3000 });
    const met = fakeBot();
    setTimeout(() => { met.entities[1] = zombie(5, 59, 0); }, 50);
    const t0 = Date.now();
    const r = await walkToGround(met, plan, { walk: () => new Promise(() => {}) });
    assert.deepEqual([r.arrived, r.stopped, r.mob], [false, 'hostile', 'zombie']);
    assert.ok(Date.now() - t0 < 2000, `stopped early (${Date.now() - t0} ms)`);
    assert.ok(met.pathfinder.stops > 0, 'the pathfinder is stopped');
    GROUND.walkMs = 200;
    const slow = await walkToGround(fakeBot(), plan, { walk: () => new Promise(() => {}) });
    assert.equal(slow.stopped, 'time');
});

test('soak 8 (c): out of the water to the nearest dry ground; nothing to do when dry; said when there is none', async (t) => {
    quiet(t);
    const bot = fakeBot({ at: new Vec3(5, 63, 0) });
    assert.equal(inWater(bot), true);
    assert.ok(dryCell(bot).equals(new Vec3(7, 64, 0)));
    const walks = [];
    const r = await stepToDry(bot, { walk: (b, p) => { walks.push(p); b.entity.position = p.offset(0.5, 0, 0.5); return Promise.resolve(); } });
    assert.deepEqual([r.dry, r.moved, `${r.at}`], [true, true, `${new Vec3(7, 64, 0)}`]);
    const dry = await stepToDry(bot, { walk: () => { walks.push('again'); return Promise.resolve(); } });
    assert.deepEqual([dry.dry, dry.moved, walks.length], [true, false, 1]);
    const deep = await stepToDry(fakeBot({ world: river({ half: 30 }) }), { walk: () => Promise.resolve() });
    assert.deepEqual([deep.dry, deep.moved, deep.why], [false, false, 'no dry ground within 8 blocks']);
});

test('#557 review 2: the walks only walk: no digging, no 1x1 tower, no scaffolding (the shelter blocks stay held)', async () => {
    const seen = [];
    const bot = fakeBot();
    bot.pathfinder = {
        setMovements(m) { seen.push(m); }, stop() {}, setGoal() {}, isMoving: () => false,
        getPathTo(m) { seen.push(m); return { status: 'success', path: [] }; },
        goto() { return Promise.resolve(); },
    };
    await pureWalk(bot, new pf.goals.GoalNear(8, 64, 0, 1));
    assert.ok(seen.length >= 2);
    for (const m of seen) assert.deepEqual([m.canDig, m.allow1by1towers, m.scafoldingBlocks], [false, false, []]);
});

test('#557 review 3: the search yields to the event loop (no long block) and stops once distance alone cannot win', async () => {
    const bot = fakeBot({ world: river({ half: 30 }) }); // nothing to find: every column looked at
    let last = Date.now(), maxGap = 0;
    const beat = setInterval(() => { const t = Date.now(); maxGap = Math.max(maxGap, t - last); last = t; }, 1);
    const report = {};
    const t0 = Date.now();
    try { assert.equal(await groundPlan(bot, { report }), null); } finally { clearInterval(beat); }
    const all = report.columns;
    assert.ok(all > 1700, `columns ${all}`);
    // #557 nit: a timing bound flakes on a shared VPS; the yields are counted, and the gap bound is loose.
    assert.equal(report.yields, Math.floor(all / GROUND.yieldEvery), 'a yield every GROUND.yieldEvery columns');
    assert.ok(maxGap < 250, `the longest block of the event loop: ${maxGap} ms (whole search ${Date.now() - t0} ms)`);
    // The bank 8 off scores about 9 x 4 + 8 = 44 > 24: every column is still looked at; a place that
    // needs few blocks (a cell walled in by rock on 4 sides, open above) ends it early.
    const nook = {};
    for (const [x, z] of [[9, 0], [11, 0], [10, 1], [10, -1]]) for (const y of [64, 65]) nook[`${x},${y},${z}`] = 'stone';
    const pick = {};
    const plan = await groundPlan(fakeBot({ world: river({ set: nook }) }), { report: pick, pickaxe: true });
    assert.ok(plan.feet.equals(new Vec3(10, 64, 0)) && plan.blocks <= 2, `${plan.feet} ${plan.blocks}`);
    // Its score (2 blocks x 4 + 10 away = 18) leaves only the columns within 18: about pi x 18^2.
    assert.ok(pick.columns < Math.PI * 19 * 19 && pick.columns < all * 0.65, `pruned: ${pick.columns} of ${all}`);
});

test('#557 review 4: a dusk walk of more than 12 blocks stops after 12 once night falls with no weapon', async (t) => {
    quiet(t);
    const saved = { ...GROUND };
    t.after(() => Object.assign(GROUND, saved));
    Object.assign(GROUND, { checkMs: 10, walkMs: 5000 });
    const bot = fakeBot({ at: new Vec3(0, 64, 30), world: (q) => (q.y < 64 ? 'dirt' : 'air') });
    const plan = { feet: new Vec3(20, 64, 30), kind: 'shelter', blocks: 9, d: 20 };
    let night = false;
    const step = (b) => new Promise(() => { const iv = setInterval(() => { b.entity.position = b.entity.position.offset(1, 0, 0); if (b.entity.position.x > 6) night = true; if (b.entity.position.x > 25) clearInterval(iv); }, 5); });
    const r = await walkToGround(bot, plan, { walk: step, shortNow: () => night });
    assert.equal(r.stopped, 'night');
    assert.ok(bot.entity.position.x >= 12 && bot.entity.position.x < 16, `stopped at x ${bot.entity.position.x}`);
    // Armed (shortNow false), or a place within 12: no such stop.
    const near = await walkToGround(fakeBot({ at: new Vec3(0, 64, 30), world: (q) => (q.y < 64 ? 'dirt' : 'air') }), { ...plan, feet: new Vec3(10, 64, 30), d: 10 },
        { walk: (b, f) => { b.entity.position = f.offset(0.5, 0, 0.5); return Promise.resolve(); }, shortNow: () => true });
    assert.equal(near.arrived, true);
});

test('#557 review 1: the walk stops for a hostile mob ahead within 8 or any within 3, not for one behind', async (t) => {
    quiet(t);
    const saved = { ...GROUND };
    t.after(() => Object.assign(GROUND, saved));
    Object.assign(GROUND, { checkMs: 10, walkMs: 300 });
    const plan = { feet: new Vec3(8, 64, 0), kind: 'shelter', blocks: 9, d: 8 };
    const hang = () => new Promise(() => {});
    const behind = await walkToGround(fakeBot({ entities: { 1: zombie(-6, 59, 0) } }), plan, { walk: hang });
    assert.equal(behind.stopped, 'time', 'a zombie 6 behind: the walk goes on');
    const close = await walkToGround(fakeBot({ entities: { 1: zombie(-2, 59, 0) } }), plan, { walk: hang });
    assert.deepEqual([close.stopped, close.mob], ['hostile', 'zombie'], 'within 3, behind or not');
    const ahead = await walkToGround(fakeBot({ entities: { 1: zombie(6, 60, 0) } }), plan, { walk: hang });
    assert.equal(ahead.stopped, 'hostile');
});

test('#557 review 6: with no pickaxe a shelter fits only with a side to dig out by hand', () => {
    // A 1x1 trench in stone, 2 deep: the walls are rock. With a pickaxe: fits (the roof only).
    const set = {};
    for (const [x, z] of [[9, 0], [11, 0], [10, 1], [10, -1]]) for (const y of [64, 65]) set[`${x},${y},${z}`] = 'stone';
    const bot = fakeBot({ world: river({ set }) });
    const feet = new Vec3(10, 64, 0);
    assert.equal(fitsAt(bot, feet, { pickaxe: true })?.kind, 'shelter');
    assert.equal(fitsAt(bot, feet, { pickaxe: false }), null, 'no side of stone could be dug out by hand; no hole in it either');
    assert.equal(fitsAt(bot, new Vec3(20, 64, 0), { pickaxe: false })?.kind, 'shelter', 'open ground: its dirt walls can be dug out');
});

test('#557 review 8: dry ground is a good floor: not magma, not leaves, not sand over water', () => {
    // The bot in the river at its east edge; the nearest bank cells made bad one by one.
    const at = new Vec3(5, 63, 0);
    const good = fakeBot({ at });
    assert.ok(dryCell(good).equals(new Vec3(7, 64, 0)));
    const bad = { '7,63,0': 'magma', '7,63,1': 'leaves', '7,63,-1': 'sand', '7,62,-1': 'water' };
    const bot = fakeBot({ at, world: river({ set: bad }) });
    for (const p of [new Vec3(7, 64, 0), new Vec3(7, 64, 1), new Vec3(7, 64, -1)]) assert.equal(goodFloor(bot, p), false, `${p}`);
    const d = dryCell(bot);
    assert.ok(d && !d.equals(new Vec3(7, 64, 0)) && !d.equals(new Vec3(7, 64, 1)) && !d.equals(new Vec3(7, 64, -1)), `${d}`);
    assert.equal(goodFloor(bot, new Vec3(9, 64, 5)), true, 'dirt');
});
