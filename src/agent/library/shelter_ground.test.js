// Soak 8 (rotn-v0.1.14, night 2): the bot at sunset in a river channel (feet at y 59, flowing water,
// sand bed), the dry bank 5 blocks higher, outside the shelter search's 2 up or down. A fake world
// of columns (the real 3.3.4 dump for what is sturdy, a wall, falling or dug by hand) and a fake bot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { groundPlan, walkToGround, stepToDry, dryCell, inWater, fitsAt, surfaceAt, planText, GROUND } from './shelter_ground.js';
import { buildShelter, chooseSite, standsIn, tallyText } from './shelter.js';
import { digPit } from './pit.js';

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

test('soak 8 (b): the dry bank 8 blocks off and 5 up (outside the shelter search) is found, with what it takes', () => {
    const bot = fakeBot();
    assert.equal(surfaceAt(bot, 8, 0, 59).y, 64, 'the bank surface, 5 up');
    assert.equal(surfaceAt(bot, 0, 0, 59), null, 'the channel: water all the way up');
    assert.equal(fitsAt(bot, new Vec3(7, 64, 0)), null, 'the edge: a wall over the water has nothing to go against');
    const plan = groundPlan(bot);
    assert.ok(plan, 'a place');
    assert.equal(plan.kind, 'shelter');
    assert.equal(Math.abs(plan.feet.x), 8);
    assert.equal(plan.feet.y, 64);
    assert.ok(plan.blocks > 0 && plan.blocks <= 10, `blocks ${plan.blocks}`);
    assert.match(planText(plan), /^a shelter there needs \d+ blocks$/);
    assert.ok(Math.abs(plan.d - 8) < 1);
});

test('soak 8 (b): a place with a hostile mob near the way is skipped; places walked to (skip) are not chosen again; none within the radius', () => {
    // A zombie 20 west: the west bank's way passes within 12 of it, the east bank's not within 16.
    const bot = fakeBot({ entities: { 1: zombie(-20, 64, 0) } });
    const plan = groundPlan(bot);
    assert.equal(plan.feet.x, 8, 'the east bank');
    const again = groundPlan(fakeBot(), { skip: [new Vec3(-8, 64, 0), new Vec3(8, 64, 0)] });
    assert.ok(again && !(Math.abs(again.feet.x) === 8 && again.feet.z === 0), `another place: ${again?.feet}`);
    // A river 30 wide: no bank within 24 (nor within 12).
    assert.equal(groundPlan(fakeBot({ world: river({ half: 30 }) })), null);
    // A bank 16 off: within 24, not within the 12 of a night with no weapon.
    const wide = fakeBot({ world: river({ half: 14 }) });
    assert.equal(groundPlan(wide, { radius: GROUND.unarmedRadius }), null);
    assert.equal(Math.abs(groundPlan(wide, { radius: GROUND.radius }).feet.x), 16);
});

test('soak 8 (b): the last shelter comes first within 48 blocks, if a shelter still fits there; else the best place', () => {
    const last = new Vec3(-30, 64, 20);
    const plan = groundPlan(fakeBot(), { lastShelter: last });
    assert.equal(plan.kind, 'last');
    assert.ok(plan.feet.equals(last));
    assert.equal(planText(plan), 'the last shelter');
    assert.equal(groundPlan(fakeBot(), { lastShelter: new Vec3(-55, 64, 20) }).kind, 'shelter', 'more than 48 off');
    assert.equal(groundPlan(fakeBot(), { lastShelter: new Vec3(3, 59, 0) }).kind, 'shelter', 'in the river: no shelter fits');
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
