// Soak 14 (F1, the lead): the bounded food run (forage, then hunt), and the night's need in points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { foodRun, FOOD_RUN } from './food_run.js';
import { nightFoodNeed, heldFoodPoints, NIGHT_FOOD } from './food.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const SWORD = { name: 'iron_sword', count: 1, metadata: 0, type: reg.itemsByName.iron_sword.id };

function runBot({ food = 10, items = [], health = 20 } = {}) {
    return { food, health, interrupt_code: false, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, inventory: { items: () => items } };
}

test('soak 14 (F1, #611 review): the night\'s need is 7 + 0.3/min x 26 min - (food + saturation), at least 0, at most 16; held food counts in points (hunger + saturation)', () => {
    assert.deepEqual(NIGHT_FOOD, { floor: 7, perMin: 0.3, nightMin: 26, cap: 16 });
    assert.equal(nightFoodNeed({ food: 12, saturation: 2 }), 0.8);
    assert.equal(nightFoodNeed({ food: 10, saturation: 0 }), 4.8, 'soak 14 sunset 1 (food 10)');
    assert.equal(nightFoodNeed({ food: 2, saturation: 0 }), 12.8, 'sunset 3 (food 2)');
    assert.equal(nightFoodNeed({ food: -2, saturation: 0 }), 16, 'capped');
    assert.equal(nightFoodNeed({ food: 20, saturation: 5 }), 0);
    assert.equal(nightFoodNeed({ food: undefined }), null);
    const bot = runBot({ items: [{ name: 'bread', metadata: 0, count: 2 }, { name: 'rotten_flesh', metadata: 0, count: 3 }, { name: 'cooked_beef', metadata: 0, count: 1 }] });
    assert.equal(heldFoodPoints(bot), 11.2, '2 bread 8.4 + cooked beef 2.8; rotten flesh never');
});

test('soak 14 (F1): a food run forages first, then hunts the nearest animal and picks up its meat; it ends when enough came in, at its time, at stop(), or with nothing to get', async () => {
    const calls = [];
    const items = [SWORD];
    const bot = runBot({ items });
    const cow = { id: 5, name: 'animania:cow_holstein', position: new Vec3(10.5, 64, 0.5) };
    let forages = 0;
    const deps = {
        forageNearby: (b, opts) => { calls.push(`forage ${opts.radius}`); forages++; if (forages === 1) { items.push({ name: 'rustic:wildberries', metadata: 0, count: 1 }); return Promise.resolve(true); } return Promise.resolve(false); },
        huntTarget: (b, opts) => { calls.push(`target ${opts.radius}`); return calls.filter(c => c.startsWith('hunt ')).length ? null : cow; },
        huntAnimal: (b, e) => { calls.push(`hunt ${e.name}`); return Promise.resolve('killed'); },
        pickupKillDrops: () => { calls.push('pickup'); items.push({ name: 'beef', metadata: 0, count: 3 }); return Promise.resolve(); },
        equip: () => Promise.resolve(), rearm: () => { calls.push('rearm'); return Promise.resolve(); },
    };
    const r = await foodRun(bot, { ...FOOD_RUN.sunset, deps });
    assert.deepEqual(calls, ['forage 24', 'forage 24', 'target 32', 'hunt animania:cow_holstein', 'pickup', 'rearm', 'target 32']);
    assert.equal(r.points, 1.1 + 4.8);
    assert.equal(r.why, 'no ripe wild food and no animal to hunt within 32 blocks');
    // Enough: it ends as soon as the need came in.
    const items2 = [SWORD];
    const enough = await foodRun(runBot({ items: items2 }), { ...FOOD_RUN.night, need: 1, deps: { ...deps, forageNearby: () => { items2.push({ name: 'bread', metadata: 0, count: 1 }); return Promise.resolve(true); } } });
    assert.equal(enough.why, 'enough');
    // stop(): a hostile at dusk ends it at once.
    const stopped = await foodRun(runBot({ items: [SWORD] }), { ...FOOD_RUN.sunset, stop: () => 'a zombie within 16 blocks', deps });
    assert.deepEqual([stopped.why, stopped.points], ['a zombie within 16 blocks', 0]);
    // Its time.
    const late = await foodRun(runBot({ items: [SWORD] }), { maxMs: 0, forage: 24, hunt: 32, deps });
    assert.equal(late.why, 'time');
    // No weapon, or too weak (food 4): no hunt.
    const none = { ...deps, forageNearby: () => Promise.resolve(false) };
    assert.equal((await foodRun(runBot({ items: [] }), { ...FOOD_RUN.sunset, deps: none })).why, 'no ripe wild food, and no weapon to hunt with');
    assert.equal((await foodRun(runBot({ items: [SWORD], food: 4 }), { ...FOOD_RUN.night, deps: none })).why, 'no ripe wild food, and too weak to hunt');
    assert.deepEqual([FOOD_RUN.sunset.maxMs, FOOD_RUN.sunset.forage, FOOD_RUN.sunset.hunt, FOOD_RUN.night.maxMs, FOOD_RUN.night.forage, FOOD_RUN.night.hunt, FOOD_RUN.emergencyAt, FOOD_RUN.minHealth],
        [180_000, 24, 32, 240_000, 16, 16, 4, 8]);
});

// #612 review 1 (the lead): at food 4 or lower (Hunger Overhaul's weakness) the emergency hunts anyway, armed.
test('#612 review 1: weakHunt: at food 4, armed, the run hunts; without it, it does not', async () => {
    const cow = { id: 5, name: 'animania:cow_holstein', position: new Vec3(8.5, 64, 0.5) };
    const calls = [];
    const deps = {
        forageNearby: () => Promise.resolve(false),
        huntTarget: () => (calls.length ? null : cow),
        huntAnimal: (b, e, opts) => { calls.push(`hunt ${opts.keepGoing()}`); return Promise.resolve('killed'); },
        pickupKillDrops: () => Promise.resolve(), equip: () => Promise.resolve(), rearm: () => Promise.resolve(),
    };
    const weak = await foodRun(runBot({ items: [SWORD], food: 4 }), { ...FOOD_RUN.night, weakHunt: true, deps });
    assert.deepEqual(calls, ['hunt true'], 'hunted, and the hunt goes on though weak');
    assert.equal(weak.why, 'no ripe wild food and no animal to hunt within 16 blocks');
    calls.length = 0;
    const plain = await foodRun(runBot({ items: [SWORD], food: 4 }), { ...FOOD_RUN.night, deps });
    assert.deepEqual(calls, []);
    assert.equal(plain.why, 'no ripe wild food, and too weak to hunt');
});
