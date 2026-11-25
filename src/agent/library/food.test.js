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

test('D1, soak 14 (F1): with the pack values, the least valuable first: berries (1.1) before cooked beef (2.8) before bread (4.2); the most valuable at EAT_NOW_AT', () => {
    const bread = stack('bread', 0, 3), berries = stack('rustic:wildberries', 0, 4), beef = stack('cooked_beef', 0, 1);
    assert.equal(chooseFood(invBot([bread, berries, beef])), berries);
    assert.equal(chooseFood(invBot([bread, beef])), beef);
    assert.equal(chooseFood(invBot([bread, berries, beef]), { largest: true }), bread, 'at EAT_NOW_AT: the most valuable');
    assert.equal(chooseFood(invBot([bread, stack('fish', 3, 2)])), bread, 'a pufferfish is never the alternative');
    assert.equal(chooseFood(invBot([stack('fish', 0, 1), stack('fish', 3, 1)])).metadata, 0, 'cod, by meta');
});

test('D1, soak 14 (F1): the least valuable first (largest: the most), bread no last resort, given-up foods skipped', () => {
    const values = { 'minecraft:bread:0': 3, 'rustic:wildberries:0': 1, 'minecraft:cooked_beef:0': 2 };
    const valueFn = (item) => (values[foodKey(item)] ? { hunger: values[foodKey(item)], saturation: 0 } : null);
    const bread = stack('bread', 0, 3), berries = stack('rustic:wildberries', 0, 4), beef = stack('cooked_beef', 0, 1);
    assert.equal(chooseFood(invBot([bread, berries]), { valueFn }), berries, 'the least valuable first');
    assert.equal(chooseFood(invBot([bread, beef]), { valueFn }), beef);
    assert.equal(chooseFood(invBot([bread, berries, beef]), { valueFn, largest: true }), bread, 'largest: the most hunger');
    assert.equal(chooseFood(invBot([bread, beef]), { valueFn, skip: new Set(['minecraft:cooked_beef:0']) }), bread, 'beef given up: bread is all that is left');
    assert.equal(chooseFood(invBot([]), { valueFn }), null);
});

test('D1, soak 14 (F1): eat at 8 or lower when idle and safe, at 6 or lower always', () => {
    assert.equal(EAT_AT, 8);
    assert.equal(wantsToEat(9, { idle: true }), false, 'soak 14: not at 9 (12 ate every find at once)');
    assert.equal(wantsToEat(8, { idle: true }), true);
    assert.equal(wantsToEat(8, { idle: false }), false, 'an action is not cut for a food level of 8');
    assert.equal(wantsToEat(7, { idle: true, threatened: true }), false, 'not with a mob near');
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

    const full = eatBot([stack('rustic:wildberries', 0, 3)], 9);
    await mode.update(modeAgent(full.bot));
    await settled();
    assert.deepEqual(full.eaten, []);

    const idle = eatBot([stack('bread', 0, 1), stack('rustic:wildberries', 0, 3)], 8);
    await mode.update(modeAgent(idle.bot));
    await settled();
    assert.deepEqual(idle.eaten, ['rustic:wildberries']);
    assert.ok(logs.includes('[reflex] ate rustic:wildberries:0 at food 8'), logs.join('\n'));
    // G4 #5: the journal's eat line, with the food level after it.
    assert.ok(logs.includes('[survival] ate rustic:wildberries:0 food 8->11'), logs.join('\n'));

    const busy = eatBot([stack('rustic:wildberries', 0, 3)], 7);
    await mode.update(modeAgent(busy.bot, { idle: false, label: 'action:collectBlocks' }));
    await settled();
    assert.deepEqual(busy.eaten, [], 'not during an action at 7');
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

// G4 #5 (CX23 soak m1: food fell to 1): the food reserve's rule, shared by the agenda and the hunting reflex.
test('G4 #5, soak 14 (F1): foodShortfall: never at night; before night the night\'s need in points; once the agenda is done 12; at food 12 or lower with none held, always', async () => {
    const { foodShortfall, FOOD_TARGET } = await import('./food.js');
    assert.deepEqual(FOOD_TARGET, { day: 12 });
    const f = (o) => foodShortfall({ food: 15, held: 0, minutesToSunset: 30, finished: false, reserveLeadMin: 10, ...o });
    assert.equal(f({ minutesToSunset: 0 }), null, 'night: never (stays sealed)');
    assert.equal(f({ minutesToSunset: 0, food: 2 }), null, 'not even starving');
    // need = 7 + 0.3 x 26 - (food + saturation) (#611 review): food 8, saturation 0: 6.8; food 12, saturation 2: 0.8.
    assert.equal(f({ minutesToSunset: 8, food: 8, held: 6.7 }), 6.8, 'before night: the need');
    assert.equal(f({ minutesToSunset: 8, food: 8, held: 6.8 }), null);
    assert.equal(f({ minutesToSunset: 8, food: 12, saturation: 2, held: 0.5 }), 0.8);
    assert.equal(f({ minutesToSunset: 8, held: 0 }), null, 'food 15: the bar covers the night');
    assert.equal(f({ minutesToSunset: 8, food: 20, saturation: 5, held: 0 }), null, 'a full bar: no need');
    // Soak 16 (F1): by day the day reserve at any time: the night's need at the bar projected to sunset (0.5 a
    // minute), + 4. Food 15, 14 min to sunset: 8 at sunset, need 7 + 7.8 - 8 = 6.8, reserve 10.8.
    const day = (o) => f({ minutesToSunset: 14, ...o });
    assert.equal(day({ held: 10 }), 10.8, 'during the agenda by day: the day reserve');
    assert.equal(day({ held: 10.8 }), null);
    assert.equal(day({ food: 20, held: 3 }), 5.8, 'a full bar at noon: 13 at sunset, need 1.8, + 4');
    assert.equal(day({ food: 20, held: 11, finished: true }), 12, 'agenda done: 12 when more than the reserve');
    assert.equal(day({ food: 20, held: 12, finished: true }), null);
    assert.equal(day({ food: 12, held: 0 }), 13.8, 'food 12: 5 at sunset, need 9.8, + 4 (more than the urgent 12)');
    assert.equal(f({ minutesToSunset: Infinity, food: 15, held: 3 }), 4, 'time unknown: the need at the bar now (0), + 4');
    assert.equal(f({ food: undefined }), null, 'food unknown: never');
});

test('G4 #5, soak 14: heldFoodPoints counts the safe food held by pack values (hunger + saturation); avoided food (raw chicken, rotten flesh) does not count', async () => {
    const { heldFoodPoints } = await import('./food.js');
    const bot = invBot([stack('bread', 0, 2), stack('beef', 0, 3), stack('chicken', 0, 5), stack('rotten_flesh', 0, 4), stack('stick', 0, 9)], 10);
    assert.equal(heldFoodPoints(bot), 13.2, 'bread 4.2 each, raw beef 1.6 each');
    assert.equal(heldFoodPoints(invBot([], 10)), 0);
});


// Soak 2 (rotn-v0.1.4): food 0 is instant death on this pack (Hunger Overhaul damageOnStarve=200);
// the bot reached food 1 with nothing it would eat, and starved at full health.
test('soak 2: at EMERGENCY_FOOD or lower, avoided food is eaten when no safe food is held (safe food still first; never chorus fruit)', async () => {
    const { EMERGENCY_FOOD } = await import('./food.js');
    assert.equal(EMERGENCY_FOOD, 5);
    const bot = (items) => ({ inventory: { items: () => items } });
    const flesh = stack('rotten_flesh', 0, 2), chicken = stack('chicken', 0, 1), chorus = stack('chorus_fruit', 0, 4), berries = stack('rustic:wildberries', 0, 1);
    assert.ok(isAvoided(flesh) && isAvoided(chicken));
    assert.equal(chooseFood(bot([flesh, chicken])), null, 'not in an emergency: never');
    assert.equal(chooseFood(bot([flesh, chicken]), { emergency: true })?.name, 'chicken', '#432 review 2: raw chicken (hunger 30%) before rotten flesh (80%)');
    assert.equal(chooseFood(bot([flesh]), { emergency: true })?.name, 'rotten_flesh');
    for (const [name, meta] of [['rustic:cloudsbluff', 0], ['fish', 3], ['betterwithmods:raw_egg', 0], ['cyclicmagic:inventory_food', 0], ['spider_eye', 0]])
        assert.equal(chooseFood(bot([stack(name, meta, 1)]), { emergency: true }), null, `${name}:${meta}: never, not even in an emergency`);
    assert.equal(chooseFood(bot([flesh, berries]), { emergency: true }).name, 'rustic:wildberries', 'safe food first');
    assert.equal(chooseFood(bot([chorus]), { emergency: true }), null, 'never chorus fruit');
});

test('soak 2: the eating reflex eats rotten flesh at food 5 with nothing else, and says why; at food 6 it does not', async (t) => {
    const warns = [];
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    const run = async (food) => {
        const mode = freshMode();
        const { bot, eaten } = eatBot([stack('rotten_flesh', 0, 2)], food);
        await mode.update(modeAgent(bot));
        await settled(20);
        Object.assign(mode, { wait_until: -Infinity, fails: {}, given_up: new Set() });
        return eaten;
    };
    assert.deepEqual(await run(5), ['rotten_flesh']);
    assert.ok(warns.some(w => /eating: food 5 \(food 0 kills on this pack\): eating minecraft:rotten_flesh:0 although it is avoided/.test(w)), warns.join('\n'));
    assert.deepEqual(await run(6), [], 'food 6: not yet');
});

// Soak 4 (rotn-v0.1.7): a zombie stood at the corner of the closed shelter all morning; the eating
// reflex took it for a threat and waited for food 6 (food 20 -> 11 with food held, no eat line).
test('soak 4: in a closed night shelter a mob outside is no threat to eating (food 8 eats); with a wall open it is', async (t) => {
    quiet(t);
    const mode = freshMode();
    const zombie = { name: 'zombie', type: 'mob', position: new Vec3(1.5, 64, 1.5), metadata: [] };
    const shut = eatBot([stack('rustic:wildberries', 0, 3)], 8);
    shut.bot.entities = { 1: shut.bot.entity, 2: zombie };
    shut.bot.rotnSheltered = true;
    await mode.update(modeAgent(shut.bot));
    await settled();
    assert.deepEqual(shut.eaten, ['rustic:wildberries'], 'sealed in: it eats at 8');
    const open = eatBot([stack('rustic:wildberries', 0, 3)], 8);
    open.bot.entities = { 1: open.bot.entity, 2: zombie };
    open.bot.rotnSheltered = 'open';
    Object.assign(mode, { wait_until: -Infinity });
    await mode.update(modeAgent(open.bot));
    await settled();
    assert.deepEqual(open.eaten, [], 'a wall open: the zombie is a threat, it waits for 6');
});

// Soak 4 evidence (#478), ate_when_low failed: "low" at food 12 (11:56:59) while the night routine
// held the bot in its closed shelter in the morning, a zombie at the corner (-58,65,-81 by
// -59,65,-82); the reflex ate only at food 6, 24 min later. The same sequence now eats at 12.
test('#478 ate_when_low: held in the closed shelter with a zombie at the corner, food 9 -> 8 ("low", soak 14: EAT_AT 8) eats at 8, not at 6', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    t.mock.method(console, 'warn', () => {});
    const { foodCheck } = await import('./survival_log.js');
    const mode = freshMode();
    // The soak's held food: bread, a zucchini, a sweet potato, garlic (bread last).
    const held = eatBot([stack('bread', 0, 1), stack('harvestcraft:zucchiniitem', 0, 1), stack('harvestcraft:sweetpotatoitem', 0, 1), stack('harvestcraft:garlicitem', 0, 1)], 9);
    const bot = held.bot;
    Object.assign(bot, { health: 20, entity: { position: new Vec3(-58.5, 65, -81.5) }, rotnSheltered: true });
    bot.entities = { 1: bot.entity, 2: { id: 2, name: 'zombie', type: 'mob', position: new Vec3(-57.5, 65, -80.5), metadata: [] } };
    const agent = modeAgent(bot); // nothing runs: the routine holds the bot inside
    const state = {};
    foodCheck(state, bot, 0);
    await mode.update(agent);
    await settled();
    assert.deepEqual(held.eaten, [], 'at 9 it does not eat yet');
    bot.food = 8;
    assert.equal(foodCheck(state, bot, 1000), '[survival] food 8 health 20 (low)');
    await mode.update(agent);
    await settled();
    assert.equal(held.eaten.length, 1, 'it eats at 8');
    assert.notEqual(held.eaten[0], 'bread', 'the least valuable first: not the bread');
    assert.ok(logs.some(l => /^\[reflex\] ate \S+ at food 8$/.test(l)), logs.join('\n'));
});

// Soak 6 (b): during the eel loop food fell from 12 to 10 over 8 min (18:41:12 to 18:49:30): the
// eating reflex at food 12 waited for an idle bot with no threat, and self_defense and unstuck took
// turns all along. Now a reflex's own action is no work to wait for, and a melee mob that is not
// within 4 blocks and has not hurt the bot in 10 s does not put off the eat.
test('soak 6 (b): between fights (a reflex\'s action) at food 8 or lower it eats unless the melee mob is close or hurt it lately; never cuts the model\'s action at 7', async (t) => {
    quiet(t);
    const zombieAt = (x) => ({ 1: null, 2: { id: 2, name: 'zombie', type: 'mob', position: new Vec3(x, 64, 0), metadata: [] } });
    const run = async ({ x = 6, label = 'mode:unstuck', hurtAgo = Infinity, sword = false, food = 7 } = {}) => {
        const mode = freshMode();
        const items = [stack('rustic:wildberries', 0, 3), ...(sword ? [stack('iron_sword', 0, 1)] : [])];
        const b = eatBot(items, food);
        b.bot.entities = { ...zombieAt(x), 1: b.bot.entity };
        b.bot.lastDamageTime = Date.now() - hurtAgo;
        await mode.update(modeAgent(b.bot, { idle: false, label }));
        await settled();
        return b.eaten;
    };
    assert.deepEqual(await run({ sword: true }), ['rustic:wildberries'], 'armed (a fight plan), the zombie 6 away, an unstuck walk: eats');
    // #508 review 3: a refused fight (unarmed, or low health) is a flee: it still blocks; and a flee
    // (cowardice) is never cut.
    assert.deepEqual(await run(), [], 'unarmed: a flee, not now');
    assert.deepEqual(await run({ sword: true, label: 'mode:cowardice' }), [], 'never during cowardice');
    assert.deepEqual(await run({ sword: true, label: 'mode:self_preservation' }), [], 'nor during the low-health flee');
    assert.deepEqual(await run({ label: 'mode:self_defense', sword: true }), ['rustic:wildberries'], 'a fight action: its turn too');
    assert.deepEqual(await run({ x: 3, sword: true }), [], 'the zombie within 4: not now');
    assert.deepEqual(await run({ hurtAgo: 5_000, sword: true }), [], 'hurt 5 s ago: not now');
    assert.deepEqual(await run({ label: 'action:collectBlocks' }), [], 'the model\'s action is not cut at 7');
    assert.deepEqual(await run({ food: 9 }), [], 'not hungry');
});

// ---- Soak 12 (rotn-v0.1.18), death 1 at 15:11 ----
// The eating reflex ate raw prime mutton 9 times at "food 12->12", about 0.5 s apart, with a zombie in
// the bot's cell 0.6 m away hitting it: a closed shelter counted as safe (soak 4), and every consume
// that resolved counted as an eat, while mineflayer ends an eat as done on any held-item change. The 2
// mutton were still held.

test('soak 12 (A3): only a food level or item count change is an eat; a consume that resolves with neither is cut; a change a tick after the resolve counts', async () => {
    const cut = eatBot([stack('animania:raw_prime_mutton', 0, 2)], 12);
    cut.bot.consume = () => Promise.resolve(); // resolved by a held-item change: nothing eaten
    const r = await eatFood(cut.bot, cut.bot.inventory.items()[0], { settleMs: 20, step: 5 });
    assert.equal(r.ate, false);
    assert.equal(r.cut, true);
    assert.ok(Number.isFinite(r.ms));
    const late = eatBot([stack('animania:raw_prime_mutton', 0, 2)], 12);
    late.bot.consume = () => { setTimeout(() => { late.bot.food = 13; late.bot.held.count--; }, 10); return Promise.resolve(); };
    const ok = await eatFood(late.bot, late.bot.inventory.items()[0], { settleMs: 100, step: 5 });
    assert.equal(ok.ate, true, 'the server\'s update a tick later');
    assert.equal(ok.cut, undefined);
});

test('soak 12 (A2, death 1): in a closed shelter a zombie in the bot\'s cell (or the roof cell over it) puts off the eat at food 8; one outside the walls does not (soak 4); hurt just now, not now', async (t) => {
    quiet(t);
    const run = async (pos, { hurtAgo = Infinity, site = null } = {}) => {
        const mode = freshMode();
        const b = eatBot([stack('animania:raw_prime_mutton', 0, 2)], 8);
        b.bot.entities = { 1: b.bot.entity, 2: { id: 2, name: 'zombie', type: 'mob', position: pos, height: 1.95, metadata: [] } };
        b.bot.rotnSheltered = true;
        b.bot.lastDamageTime = Date.now() - hurtAgo;
        const agent = modeAgent(b.bot);
        if (site) agent._night = { site };
        await mode.update(agent);
        await settled();
        return b.eaten;
    };
    assert.deepEqual(await run(new Vec3(0.6, 64, 0.9)), [], 'the zombie in the bot\'s cell, 0.6 m away');
    assert.deepEqual(await run(new Vec3(0.5, 66.2, 0.5)), [], 'over it, in the roof cell');
    assert.deepEqual(await run(new Vec3(0.6, 64, 0.9), { site: new Vec3(0, 64, 0) }), [], 'the night routine\'s site');
    assert.deepEqual(await run(new Vec3(1.5, 64, 1.5)), ['animania:raw_prime_mutton'], 'outside the walls (soak 4): it eats');
    assert.deepEqual(await run(new Vec3(1.5, 64, 1.5), { hurtAgo: 4000 }), [], 'hurt 4 s ago: not now');
});

test('soak 12 (A3, the lead): a cut eat is no failure of that food (never given up); it waits cut_ms; that wait never holds off an emergency eat with no hostile within EAT_SAFE.distance', async (t) => {
    const warns = [];
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    const mode = freshMode();
    const b = eatBot([stack('animania:raw_prime_mutton', 0, 3)], 8);
    let cuts = 0;
    b.bot.consume = () => { cuts++; return Promise.resolve(); };
    const agent = modeAgent(b.bot);
    for (let k = 0; k < 4; k++) { mode.wait_until = -Infinity; await mode.update(agent); await settled(200); }
    assert.equal(cuts, 4);
    assert.equal(mode.given_up.size, 0, 'four cuts: still not given up (3 failures would give it up)');
    assert.deepEqual(mode.fails, {});
    assert.ok(warns.some(l => /^\[reflex\] eating: the eat of animania:raw_prime_mutton:0 was cut after \d+ ms \(no food or count change, food 8\); trying again in 3 s$/.test(l)), warns.join('\n'));
    // Within the cut wait: at 8 it waits; at EAT_NOW_AT with nothing near it eats now; with a zombie
    // within 4 blocks it waits.
    assert.ok(mode.wait_until > Date.now() && mode.cut_wait);
    await mode.update(agent);
    await settled(200);
    assert.equal(cuts, 4, 'food 8: the wait holds');
    b.bot.food = EAT_NOW_AT;
    b.bot.entities = { 1: b.bot.entity, 2: { id: 2, name: 'zombie', type: 'mob', position: new Vec3(3, 64, 0), metadata: [] } };
    await mode.update(agent);
    await settled(200);
    assert.equal(cuts, 4, 'a zombie 3 blocks away: the wait holds');
    b.bot.entities = { 1: b.bot.entity };
    b.bot.consume = () => { cuts++; b.bot.held.count--; b.bot.food += 3; return Promise.resolve(); };
    await mode.update(agent);
    await settled(200);
    assert.equal(cuts, 5, `food ${EAT_NOW_AT}, nothing near: it eats despite the wait`);
    assert.equal(b.bot.food, EAT_NOW_AT + 3);
});

test('#592 review nit 3: the settle is 300 ms (a lagging server); a change that shows after the eat was judged cut counts as that eat (no second item eaten)', async (t) => {
    const { EAT_SETTLE } = await import('./food.js');
    assert.equal(EAT_SETTLE.ms, 300);
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    t.mock.method(console, 'warn', () => {});
    const mode = freshMode();
    const b = eatBot([stack('animania:raw_prime_mutton', 0, 2)], 8);
    let consumes = 0;
    // The server's update arrives 400 ms after the resolve: past the settle.
    b.bot.consume = () => { consumes++; setTimeout(() => { b.bot.food = 9; b.bot.held.count--; }, 400); return Promise.resolve(); };
    const agent = modeAgent(b.bot);
    await mode.update(agent);
    await settled(350);
    assert.ok(mode.cut_wait, 'judged cut at 300 ms');
    await settled(150);
    await mode.update(agent);
    await settled(50);
    assert.ok(logs.includes('[reflex] ate animania:raw_prime_mutton:0 at food 8 (it showed after the eat was judged cut)'), logs.join('\n'));
    // #592 re-review nit 1: and the journal's line, which the harness's ate_when_low counts.
    assert.ok(logs.includes('[survival] ate animania:raw_prime_mutton:0 food 8->9'), logs.join('\n'));
    assert.equal(consumes, 1, 'food 9: no second eat');
    assert.equal(mode.cut_wait, false);
});

// Soak 14 (F1, the lead): the reflex ate each find at once (food 9 to 12) and held nothing at any sunset.
// Now it eats at EAT_AT (8), the least valuable first (the best is kept for the night); at EAT_NOW_AT (6) the most.
test('soak 14 (F1): the eating mode eats berries before bread at 8; at 6 the bread first; at 9 nothing', async (t) => {
    quiet(t);
    const run = async (food) => {
        const mode = freshMode();
        const b = eatBot([stack('bread', 0, 1), stack('rustic:wildberries', 0, 2)], food);
        await mode.update(modeAgent(b.bot));
        await settled();
        return b.eaten;
    };
    assert.deepEqual(await run(9), []);
    assert.deepEqual(await run(8), ['rustic:wildberries']);
    assert.deepEqual(await run(6), ['bread']);
});
