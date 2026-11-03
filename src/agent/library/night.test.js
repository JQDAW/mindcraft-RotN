// Offline tests for skills-rotn D2a: the night detector (RotN 3.3.4's measured day
// cycle, Extended Days freezes included) and the shelter closure check. A fake
// block lookup built from 1.12.2 minecraft-data; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { nightPhase, minutesToSunset, isSturdy, shelterShell, shelterPlan, NightClock, NIGHT_START, NIGHT_END, SHELTER_LEAD_MIN, TICKS_PER_MIN, FREEZE_MIN, STUCK_BOUND_MIN, MORNING_FREEZE, NIGHT_FREEZE } from './night.js';

const reg = minecraftData('1.12.2');
const block = (name) => {
    const b = reg.blocksByName[name];
    return { name, metadata: 0, material: b.material, hardness: b.hardness, boundingBox: b.boundingBox, transparent: b.transparent };
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
    assert.equal(nightPhase(MORNING_FREEZE), 'day', 'at the morning freeze about 8 min are certain');
    assert.equal(nightPhase(NIGHT_START - SHELTER_LEAD_MIN * TICKS_PER_MIN), 'dusk');
    assert.equal(nightPhase(NIGHT_START - SHELTER_LEAD_MIN * TICKS_PER_MIN - TICKS_PER_MIN), 'day');
    assert.equal(nightPhase(24000 + 13000), 'night', 'the time of day wraps');
    assert.equal(nightPhase(-11000), 'night');
});

test('minutes to sunset count the morning freeze only while it is ahead', () => {
    assert.equal(minutesToSunset(15000), 0);
    assert.equal(MORNING_FREEZE, 3001, 'S1-A: the server log froze at "Time is 3001" and "Time is 16001"');
    assert.equal(NIGHT_FREEZE, 16001);
    assert.ok(Math.abs(minutesToSunset(MORNING_FREEZE) - (NIGHT_START - MORNING_FREEZE) / TICKS_PER_MIN) < 1e-9);
    assert.ok(Math.abs(minutesToSunset(3000) - ((NIGHT_START - 3000) / TICKS_PER_MIN + FREEZE_MIN)) < 1e-9, 'just before it, the freeze is ahead');
    assert.ok(Math.abs(minutesToSunset(0) - (NIGHT_START / TICKS_PER_MIN + 10)) < 1e-9);
    assert.ok(minutesToSunset(NIGHT_END) > minutesToSunset(0), 'dawn (23460) comes before 0, so it is further from sunset');
});

test('#181 review: sturdy comes from the dump: rock, a full cube and at least stone hardness; never the forge-bridge defaults', () => {
    const b = (name, metadata = 0) => ({ name, metadata, boundingBox: 'block' });
    for (const n of ['stone', 'cobblestone', 'mossy_cobblestone', 'double_stone_slab', 'undergroundbiomes:igneous_stone', 'undergroundbiomes:igneous_cobble', 'pyrotech:cobblestone'])
        assert.equal(isSturdy(b(n)), true, n);
    const not = {
        netherrack: 'rock but hardness 0.4', stone_slab: 'not a full cube', stone_stairs: 'not a full cube', cobblestone_wall: 'not a full cube',
        monster_egg: 'silverfish stone is clay', dirt: 'ground', grass: 'grass', sand: 'sand', gravel: 'sand', planks: 'wood', log: 'wood', glass: 'glass',
        'biomesoplenty:dirt': 'modded ground', 'biomesoplenty:white_sand': 'modded sand', 'biomesoplenty:planks_0': 'modded wood', 'biomesoplenty:leaves_0': 'modded leaves',
    };
    for (const [n, why] of Object.entries(not)) assert.equal(isSturdy(b(n)), false, `${n}: ${why}`);
    // forge-bridge's defaults for a block without known properties: hardness 1.5, no material, a full box.
    assert.equal(isSturdy({ name: 'somemod:unknown_block', metadata: 0, hardness: 1.5, material: undefined, boundingBox: 'block', transparent: false }), false);
    assert.equal(isSturdy({ name: 'biomesoplenty:dirt', metadata: 0, hardness: 1.5, material: undefined, boundingBox: 'block' }), false, 'the bot.registry values are not used');
    assert.equal(isSturdy(null), false, 'an unloaded block');
    assert.equal(isSturdy({ metadata: 0 }), false, 'no name');
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

test('lead decision on D2a: the server time first; stuck longer than the freeze bound plus a margin, the wall clock, logged once each way', () => {
    const logs = [];
    const clock = new NightClock({ log: (m) => logs.push(m) });
    const MIN = 60_000;
    assert.equal(clock.timeOfDay(0), null, 'no value yet');
    assert.equal(clock.phase(0), null);
    clock.observe(NaN, 0);
    assert.equal(clock.timeOfDay(0), null, 'a bad value is ignored');

    // Running normally, then Extended Days' 10 min morning freeze: still the server's time.
    clock.observe(1800, 0);
    clock.observe(MORNING_FREEZE, 1 * MIN);
    assert.equal(clock.timeOfDay(1 * MIN + FREEZE_MIN * MIN), MORNING_FREEZE);
    assert.equal(clock.timeOfDay(1 * MIN + STUCK_BOUND_MIN * MIN), MORNING_FREEZE, 'up to the bound');
    assert.deepEqual(logs, []);

    // Stuck past the bound: the wall clock, less the one freeze, at the measured rate.
    const at = 1 * MIN + (STUCK_BOUND_MIN + 3) * MIN;
    assert.equal(clock.timeOfDay(at), MORNING_FREEZE + (STUCK_BOUND_MIN + 3 - FREEZE_MIN) * TICKS_PER_MIN);
    assert.equal(clock.fallback, true);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^\[night\] the time has stayed at 3001 for 18 min \(more than 15\); using the wall clock until it advances$/);
    const late = 1 * MIN + 20 * MIN; // 10 min of running time after the freeze: 14991, night
    assert.deepEqual([clock.timeOfDay(late), clock.phase(late)], [MORNING_FREEZE + 10 * TICKS_PER_MIN, 'night']);
    assert.equal(logs.length, 1, 'logged once');

    // The value advances again: the server's time, logged once.
    clock.observe(12700, late);
    assert.deepEqual([clock.fallback, clock.timeOfDay(late)], [false, 12700]);
    assert.match(logs[1], /^\[night\] the time advances again \(3001 -> 12700\); using the server's time$/);

    // Stuck a few ticks from the night freeze (the packet came a moment late): still that freeze.
    clock.observe(NIGHT_FREEZE + 3, 0);
    assert.equal(clock.timeOfDay((STUCK_BOUND_MIN + 1) * MIN), NIGHT_FREEZE + 3 + (STUCK_BOUND_MIN + 1 - FREEZE_MIN) * TICKS_PER_MIN);

    // Stuck at a value that is no freeze point: the whole stuck time counts.
    clock.observe(8000, 0);
    assert.equal(clock.timeOfDay((STUCK_BOUND_MIN + 1) * MIN), (8000 + (STUCK_BOUND_MIN + 1) * TICKS_PER_MIN) % 24000);
});
