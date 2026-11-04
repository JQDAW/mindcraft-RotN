// skills-rotn D1: eating by rotn-data's food values, offline (the real 3.3.4 dump, a fake bot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseFood, foodValue, isAvoided, wantsToEat, EAT_AT, EAT_NOW_AT } from './food.js';
import { __modeForTest } from '../modes.js';

const stack = (name, metadata, count = 1) => ({ name, metadata, count });
const invBot = (items, food = 20) => ({ food, inventory: { items: () => items } });
// The mode does not await execute(): let its action run to the end.
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

test('D1: food values come from the dump, RotN foods included; non-foods have none', () => {
    assert.deepEqual(foodValue(stack('rustic:wildberries', 0)), { hunger: 2, saturation: foodValue(stack('rustic:wildberries', 0)).saturation });
    assert.equal(foodValue(stack('bread', 0)).hunger, 5);
    assert.equal(foodValue(stack('cobblestone', 0)), null);
    assert.equal(foodValue(stack('pyrotech:rock', 0)), null);
    assert.equal(foodValue(stack('no_such_mod:thing', 0)), null);
});

test('D1: hawthorn berries, cloudsbluff, pufferfish and the vanilla bad foods are never chosen', () => {
    for (const s of [stack('biomesoplenty:berries', 0), stack('rustic:cloudsbluff', 0), stack('fish', 3), stack('rotten_flesh', 0), stack('spider_eye', 0), stack('chicken', 0), stack('golden_apple', 1)])
        assert.equal(isAvoided(s), true, s.name);
    assert.equal(isAvoided(stack('fish', 0)), false, 'raw cod is fine');
    assert.equal(chooseFood(invBot([stack('biomesoplenty:berries', 0, 5), stack('rustic:cloudsbluff', 0, 5), stack('fish', 3, 2)])), null);
});

test('D1: RotN foods are eaten before the bread, which is kept as the last resort', () => {
    const bread = stack('bread', 0, 3), berries = stack('rustic:wildberries', 0, 4), cod = stack('fish', 0, 1);
    assert.equal(chooseFood(invBot([bread, berries])), berries);
    assert.notEqual(chooseFood(invBot([bread, berries, cod])), bread, 'any other safe food first');
    assert.equal(chooseFood(invBot([bread, stack('cooked_beef', 0, 1), berries])).name, 'cooked_beef', 'the most hunger first (8 over 2)');
    assert.equal(chooseFood(invBot([bread, stack('biomesoplenty:berries', 0, 9)])), bread, 'bread when nothing safe is left');
    assert.equal(chooseFood(invBot([])), null);
});

test('D1: eat at 12 or lower when idle, at 6 or lower during an action', () => {
    assert.equal(EAT_AT, 12);
    assert.equal(wantsToEat(13, true), false);
    assert.equal(wantsToEat(12, true), true);
    assert.equal(wantsToEat(12, false), false, 'an action is not cut for a food level of 12');
    assert.equal(wantsToEat(EAT_NOW_AT, false), true);
    assert.equal(wantsToEat(undefined, true), false);
});

function modeAgent(items, food, idle = true) {
    const eaten = [];
    const bot = {
        ...invBot(items, food),
        equip: (item) => { bot.held = item; return Promise.resolve(); },
        consume: () => { eaten.push(bot.held.name); bot.food += 2; return Promise.resolve(); },
    };
    const agent = {
        bot,
        isIdle: () => idle,
        actions: { currentActionLabel: idle ? '' : 'action:collectBlocks', resume_func: null, runAction: async (label, fn) => { await fn(); return { message: 'ok', interrupted: false }; } },
    };
    return { agent, eaten };
}

test('D1: the eating mode eats the chosen food, and only when it should', async (t) => {
    const logs = [], warns = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    const mode = __modeForTest('eating');
    assert.ok(mode, 'registered');
    assert.deepEqual(mode.interrupts, ['all']);

    const full = modeAgent([stack('rustic:wildberries', 0, 3)], 13);
    await mode.update(full.agent);
    assert.deepEqual(full.eaten, []);

    const idle = modeAgent([stack('bread', 0, 1), stack('rustic:wildberries', 0, 3)], 12);
    await mode.update(idle.agent);
    await settled();
    assert.deepEqual(idle.eaten, ['rustic:wildberries']);
    assert.ok(logs.includes('[reflex] ate rustic:wildberries at food 12'));

    const busy = modeAgent([stack('rustic:wildberries', 0, 3)], 10, false);
    await mode.update(busy.agent);
    assert.deepEqual(busy.eaten, [], 'not during an action at 10');
    busy.agent.bot.food = 6;
    await mode.update(busy.agent);
    await settled();
    assert.deepEqual(busy.eaten, ['rustic:wildberries'], 'at 6 it eats during the action');

    mode.last_miss_at = -Infinity;
    const none = modeAgent([stack('biomesoplenty:berries', 0, 9)], 8);
    await mode.update(none.agent);
    await mode.update(none.agent);
    assert.deepEqual(none.eaten, []);
    assert.equal(warns.filter(w => w.includes('no safe food')).length, 1, 'said once per retry window');
    mode.last_miss_at = -Infinity;
});
