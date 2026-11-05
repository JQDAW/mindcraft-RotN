// skills-rotn D1: eating, offline (the real 3.3.4 data, a fake bot). Food values are the pack's,
// from rotn-data's foodValues (#209): Hunger Overhaul, then the pack scripts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import * as rotnData from '../../../packages/rotn-data/index.js';
import { chooseFood, foodValue, foodKey, isAvoided, avoidReason, autoEatBannedFood, wantsToEat, eatFood, EAT_AT, EAT_NOW_AT } from './food.js';
import { __modeForTest, initModes } from '../modes.js';

const stack = (name, metadata, count = 1) => ({ name, metadata, count });
const invBot = (items, food = 20) => ({ food, inventory: { items: () => items } });
// The mode does not await execute(): let its action run to the end.
const settled = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };

test('#206 review 1: the pack food values are used (bread 3 and cooked beef 2 by scripts/food.zs, berries by Hunger Overhaul)', () => {
    assert.deepEqual(foodValue(stack('bread', 0)), { hunger: 3, saturation: rotnData.foodValues('minecraft:bread', 0).saturation, source: 'crafttweaker' });
    assert.equal(foodValue(stack('cooked_beef', 0)).hunger, 2);
    assert.equal(foodValue(stack('rustic:wildberries', 0)).hunger, 1);
    assert.equal(foodValue(stack('rustic:wildberries', 0)).source, 'hungeroverhaul-rule');
    // A food rotn-data could not compute counts, with an estimate (vanilla / 2, at least 1).
    const juice = foodValue(stack('harvestcraft:applejuiceitem', 0));
    assert.equal(juice.source, 'estimate');
    assert.ok(juice.hunger >= 1);
    for (const s of [stack('cobblestone', 0), stack('pyrotech:rock', 0), stack('no_such_mod:thing', 0)])
        assert.equal(foodValue(s), null, s.name);
});

test('D1: rotn-data avoidFood (by meta) and the local list: never chosen', () => {
    for (const s of [stack('biomesoplenty:berries', 0), stack('rustic:cloudsbluff', 0), stack('fish', 3), stack('rotten_flesh', 0), stack('spider_eye', 0), stack('chicken', 0), stack('golden_apple', 1), stack('rustic:ironberries', 0), stack('iceandfire:pixie_dust', 0), stack('chorus_fruit', 0)])
        assert.equal(isAvoided(s), true, s.name);
    assert.ok(avoidReason(stack('fish', 3)).length > 0, 'the pufferfish has its effects as the reason');
    assert.match(avoidReason(stack('biomesoplenty:berries', 0)), /hawthorn/);
    assert.equal(isAvoided(stack('fish', 0)), false, 'raw cod is fine');
    assert.equal(chooseFood(invBot([stack('biomesoplenty:berries', 0, 5), stack('rustic:cloudsbluff', 0, 5), stack('fish', 3, 2)])), null);
});

test('#206 review: auto-eat (it sees names only) bans every food harmful at any meta, by name: all of fish', () => {
    const banned = autoEatBannedFood();
    for (const n of ['fish', 'rotten_flesh', 'spider_eye', 'chicken', 'poisonous_potato', 'biomesoplenty:berries', 'rustic:cloudsbluff', 'rustic:ironberries', 'golden_apple', 'chorus_fruit'])
        assert.ok(banned.includes(n), n);
    for (const n of ['bread', 'cooked_beef', 'rustic:wildberries']) assert.ok(!banned.includes(n), n);
});

test('D1: with the pack values, cooked beef (2) before berries (1), bread (3) only as the last resort', () => {
    const bread = stack('bread', 0, 3), berries = stack('rustic:wildberries', 0, 4), beef = stack('cooked_beef', 0, 1);
    assert.equal(chooseFood(invBot([bread, berries, beef])), beef);
    assert.equal(chooseFood(invBot([bread, berries])), berries);
    assert.equal(chooseFood(invBot([bread, stack('fish', 3, 2)])), bread, 'a pufferfish is never the alternative');
    assert.equal(chooseFood(invBot([stack('fish', 0, 1), stack('fish', 3, 1)])).metadata, 0, 'cod, by meta');
});

test('D1: the most hunger first, the bread only as the last resort, given-up foods skipped', () => {
    const values = { 'minecraft:bread:0': 3, 'rustic:wildberries:0': 1, 'minecraft:cooked_beef:0': 2 };
    const valueFn = (item) => (values[foodKey(item)] ? { hunger: values[foodKey(item)], saturation: 0 } : null);
    const bread = stack('bread', 0, 3), berries = stack('rustic:wildberries', 0, 4), beef = stack('cooked_beef', 0, 1);
    assert.equal(chooseFood(invBot([bread, berries]), { valueFn }), berries, 'bread kept although it gives more');
    assert.equal(chooseFood(invBot([bread, berries, beef]), { valueFn }), beef, 'the most hunger of the others');
    assert.equal(chooseFood(invBot([bread, beef]), { valueFn, skip: new Set(['minecraft:cooked_beef:0']) }), bread, 'beef given up: bread is all that is left');
    assert.equal(chooseFood(invBot([]), { valueFn }), null);
});

test('D1: eat at 12 or lower when idle and safe, at 6 or lower always', () => {
    assert.equal(EAT_AT, 12);
    assert.equal(wantsToEat(13, { idle: true }), false);
    assert.equal(wantsToEat(12, { idle: true }), true);
    assert.equal(wantsToEat(12, { idle: false }), false, 'an action is not cut for a food level of 12');
    assert.equal(wantsToEat(10, { idle: true, threatened: true }), false, 'not with a mob near');
    assert.equal(wantsToEat(EAT_NOW_AT, { idle: false, threatened: true }), true, 'at 6 in a fight too');
    assert.equal(wantsToEat(undefined, { idle: true }), false);
});

/** A bot whose consume() does `how`: 'ok' (food +3), 'late' (throws, but food rose) or 'lost' (throws, nothing). */
function eatBot(items, food, how = 'ok') {
    const eaten = [];
    const bot = {
        ...invBot(items, food),
        entity: { position: new Vec3(0, 64, 0) },
        entities: {},
        equip: (item) => { bot.held = item; return Promise.resolve(); },
        consume: () => {
            if (how === 'lost') return Promise.reject(new Error('Promise timed out.'));
            eaten.push(bot.held.name);
            bot.held.count--;
            bot.food += 3;
            return how === 'late' ? Promise.reject(new Error('Promise timed out.')) : Promise.resolve();
        },
    };
    return { bot, eaten };
}

test('#206 review 2: a consume that times out is judged by the food level and the item count', async () => {
    const ok = eatBot([stack('rustic:wildberries', 0, 2)], 10, 'ok');
    assert.deepEqual(await eatFood(ok.bot, ok.bot.inventory.items()[0], { checkMs: 1 }), { ate: true, threw: null, before: 10, after: 13 });
    const late = eatBot([stack('rustic:wildberries', 0, 2)], 10, 'late');
    const r = await eatFood(late.bot, late.bot.inventory.items()[0], { checkMs: 1 });
    assert.equal(r.ate, true, 'the eat went through although mineflayer gave up');
    assert.match(r.threw.message, /timed out/);
    const lost = eatBot([stack('rustic:wildberries', 0, 2)], 10, 'lost');
    assert.equal((await eatFood(lost.bot, lost.bot.inventory.items()[0], { checkMs: 1 })).ate, false);
});

function modeAgent(bot, { idle = true, label = '' } = {}) {
    return {
        bot,
        isIdle: () => idle,
        actions: { currentActionLabel: label, resume_func: null, runAction: async (l, fn) => { await fn(); return { message: 'ok', interrupted: false }; } },
    };
}
function freshMode() {
    const mode = __modeForTest('eating');
    Object.assign(mode, { wait_until: -Infinity, fails: {}, given_up: new Set(), check_ms: 1 });
    return mode;
}

test('D1: the eating mode eats the chosen food, and only when it should', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    t.mock.method(console, 'warn', () => {});
    const mode = freshMode();
    assert.deepEqual(mode.interrupts, ['all']);

    const full = eatBot([stack('rustic:wildberries', 0, 3)], 13);
    await mode.update(modeAgent(full.bot));
    await settled();
    assert.deepEqual(full.eaten, []);

    const idle = eatBot([stack('bread', 0, 1), stack('rustic:wildberries', 0, 3)], 12);
    await mode.update(modeAgent(idle.bot));
    await settled();
    assert.deepEqual(idle.eaten, ['rustic:wildberries']);
    assert.ok(logs.includes('[reflex] ate rustic:wildberries:0 at food 12'), logs.join('\n'));

    const busy = eatBot([stack('rustic:wildberries', 0, 3)], 10);
    await mode.update(modeAgent(busy.bot, { idle: false, label: 'action:collectBlocks' }));
    await settled();
    assert.deepEqual(busy.eaten, [], 'not during an action at 10');
});

test('#206 review 4: in a fight it eats at food 6 or lower, not above; eating comes before the fight modes', async (t) => {
    quiet(t);
    const mode = freshMode();
    const fight = eatBot([stack('rustic:wildberries', 0, 3)], 10);
    fight.bot.entities = { 1: fight.bot.entity, 2: { name: 'zombie', type: 'mob', position: new Vec3(2, 64, 0), metadata: [] } };
    const agent = modeAgent(fight.bot, { idle: false, label: 'mode:self_defense' });
    await mode.update(agent);
    await settled();
    assert.deepEqual(fight.eaten, [], 'at 10 the fight goes on');
    fight.bot.food = 6;
    await mode.update(agent);
    await settled();
    assert.deepEqual(fight.eaten, ['rustic:wildberries'], 'at 6 it eats in the fight');

    // The mode loop stops at the first active mode, so eating must come before them.
    const a = { bot: {}, prompter: { getInitModes: () => ({}) }, actions: {}, isIdle: () => true };
    initModes(a);
    const order = a.bot.modes.getMiniDocs().split('\n').slice(1).map(l => l.replace(/^- (\w+)\(.*$/, '$1'));
    assert.ok(order.indexOf('eating') < order.indexOf('cowardice') && order.indexOf('eating') < order.indexOf('self_defense'), order.join(', '));
});

test('#206 review 2: an eat that did not happen backs off, and a food that always fails is given up', async (t) => {
    const warns = [];
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    const mode = freshMode();
    const { bot, eaten } = eatBot([stack('rustic:wildberries', 0, 3)], 5, 'lost');
    const agent = modeAgent(bot);
    for (let i = 1; i <= mode.max_fails; i++) {
        await mode.update(agent);
        await settled(5);
        assert.equal(mode.fails['rustic:wildberries:0'], i);
        if (i < mode.max_fails) {
            assert.ok(mode.wait_until > Date.now(), 'backs off');
            await mode.update(agent); // within the back-off: nothing
            await settled(5);
            assert.equal(mode.fails['rustic:wildberries:0'], i);
            mode.wait_until = -Infinity;
        }
    }
    assert.ok(mode.given_up.has('rustic:wildberries:0'));
    assert.ok(warns.some(w => w.includes('rustic:wildberries:0 could not be eaten 3 times; not trying it again')), warns.join('\n'));
    mode.wait_until = -Infinity;
    await mode.update(agent);
    await settled(5);
    assert.ok(warns.at(-1).includes('no safe food'), 'the given-up food is not chosen again');
    assert.deepEqual(eaten, []);
    Object.assign(mode, { wait_until: -Infinity, fails: {}, given_up: new Set() });
});
