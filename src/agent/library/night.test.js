// Offline tests for skills-rotn D2a: the night detector (RotN 3.3.4's measured day
// cycle, Extended Days freezes included) and the shelter closure check. A fake
// block lookup built from 1.12.2 minecraft-data; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { nightPhase, minutesToSunset, isSturdy, shelterShell, shelterPlan, NIGHT_START, NIGHT_END, SHELTER_LEAD_MIN, TICKS_PER_MIN } from './night.js';

const reg = minecraftData('1.12.2');
const block = (name) => {
    const b = reg.blocksByName[name];
    return { name, material: b.material, hardness: b.hardness, boundingBox: b.boundingBox, transparent: b.transparent };
};
const key = (p) => `${p.x},${p.y},${p.z}`;
// A world: everything is `fill` unless set.
function world(fill, set = {}) {
    return { blockAt: (p) => (key(p) in set ? set[key(p)] : fill === null ? null : block(fill)) };
}

test('night is 12542-23460 (S1-A); dusk is the last SHELTER_LEAD_MIN of running time before it', () => {
    assert.equal(nightPhase(NIGHT_START), 'night');
    assert.equal(nightPhase(20000), 'night');
    assert.equal(nightPhase(NIGHT_END - 1), 'night');
    assert.equal(nightPhase(NIGHT_END), 'day', 'dawn: about 11 min of running time plus the morning freeze to sunset');
    assert.equal(nightPhase(0), 'day');
    assert.equal(nightPhase(3000), 'day', 'at the morning freeze about 8 min are certain');
    assert.equal(nightPhase(NIGHT_START - SHELTER_LEAD_MIN * TICKS_PER_MIN), 'dusk');
    assert.equal(nightPhase(NIGHT_START - SHELTER_LEAD_MIN * TICKS_PER_MIN - TICKS_PER_MIN), 'day');
    assert.equal(nightPhase(24000 + 13000), 'night', 'the time of day wraps');
    assert.equal(nightPhase(-11000), 'night');
});

test('minutes to sunset count the morning freeze only while it is ahead', () => {
    assert.equal(minutesToSunset(15000), 0);
    assert.ok(Math.abs(minutesToSunset(3000) - (NIGHT_START - 3000) / TICKS_PER_MIN) < 1e-9);
    assert.ok(Math.abs(minutesToSunset(0) - (NIGHT_START / TICKS_PER_MIN + 10)) < 1e-9);
    assert.ok(minutesToSunset(NIGHT_END) > minutesToSunset(0), 'dawn (23460) comes before 0, so it is further from sunset');
});

test('sturdy: rock (stone, cobblestone), or a solid modded block as hard as stone; never dirt, sand, gravel, wood or leaves', () => {
    for (const n of ['stone', 'cobblestone']) assert.equal(isSturdy(block(n)), true, n);
    for (const n of ['dirt', 'grass', 'sand', 'gravel', 'planks', 'log', 'leaves', 'glass', 'air', 'water']) assert.equal(isSturdy(block(n)), false, n);
    assert.equal(isSturdy({ name: 'undergroundbiomes:igneous_stone', boundingBox: 'block', transparent: false, hardness: 1.5 }), true);
    assert.equal(isSturdy({ name: 'somemod:soft', boundingBox: 'block', transparent: false, hardness: 0.5 }), false);
    assert.equal(isSturdy(null), false, 'an unloaded block');
});

test('a shelter: 10 shell blocks around a 1x2 space; in the open all 10 are missing, in a stone pocket none', () => {
    const feet = new Vec3(5.7, 64, -3.2);
    const shell = shelterShell(feet).map(key);
    assert.equal(new Set(shell).size, 10);
    assert.ok(shell.includes('5,63,-4') && shell.includes('5,66,-4'), 'floor and roof');
    assert.ok(!shell.includes('5,64,-4') && !shell.includes('5,65,-4'), 'not the space itself');

    const interior = { '5,64,-4': block('air'), '5,65,-4': block('air') };
    const open = world('air', { '5,63,-4': block('grass') });
    const plan = shelterPlan(open, feet);
    assert.deepEqual([plan.interiorClear, plan.missing.length, plan.closed], [true, 10, false]);
    assert.equal(plan.missing.find(m => key(m.pos) === '5,63,-4').block, 'grass', 'a grass floor is replaced');

    assert.deepEqual(shelterPlan(world('stone', interior), feet), { interiorClear: true, missing: [], closed: true });

    const dirtWall = shelterPlan(world('stone', { ...interior, '6,65,-4': block('dirt') }), feet);
    assert.deepEqual(dirtWall.missing.map(m => [key(m.pos), m.block]), [['6,65,-4', 'dirt']]);
    assert.equal(dirtWall.closed, false);

    const flooded = shelterPlan(world('stone', { ...interior, '5,64,-4': block('water') }), feet);
    assert.deepEqual([flooded.interiorClear, flooded.closed], [false, false]);

    const unloaded = shelterPlan(world('stone', { ...interior, '4,64,-4': null }), feet);
    assert.deepEqual(unloaded.missing.map(m => m.block), ['unloaded']);
});
