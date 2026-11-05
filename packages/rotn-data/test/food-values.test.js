// food-values.json (tools/build-food-values.mjs), foodValues / avoidFood and installFoods.
// Offline: reads only the committed data. The rebuild from the pinned pack zip is
// `node packages/rotn-data/tools/build-food-values.mjs --pack <zip> --check`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import minecraftData from 'minecraft-data';
import { loadRotnData } from '../src/catalog.js';
import { installFoods } from '../index.js';
import { parseFoodScripts, stripComments } from '../tools/build-food-values.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(HERE, '../3.3.4/food-values.json'), 'utf8'));
const pack = loadRotnData('3.3.4');

test('the scripts win (HungerTweaker runs last): bread 3, cooked beef 2, as P1 measured (bread +3)', () => {
    const bread = pack.foodValues('bread');
    assert.deepEqual([bread.hunger, bread.saturationModifier, bread.saturation, bread.source], [3, 0.2, 1.2, 'crafttweaker']);
    assert.deepEqual(bread.script, ['scripts/food.zs:21', 'scripts/food.zs:22']);
    assert.deepEqual(bread.vanilla, { hunger: 5, saturationModifier: 0.6 });
    assert.deepEqual([pack.foodValues('cooked_beef').hunger, pack.foodValues('cooked_beef').saturationModifier], [2, 0.2]);
    // opItems.zs, not food.zs, zeroes the miner's stew.
    assert.deepEqual(pack.foodValues('harvestcraft:minerstewitem').script, ['scripts/opItems.zs:8', 'scripts/opItems.zs:9']);
    // HungerTweaker casts hunger to int: food.zs line 766 sets 0.1, the game uses 0.
    const mm = pack.foodValues('harvestcraft:marshmellowsitem');
    assert.deepEqual([mm.hunger, mm.scriptHunger, mm.saturation], [0, 0.1, 0]);
});

test('foods no script sets get Hunger Overhaul\'s values (its table, else its rule with the pack config)', () => {
    const apple = pack.foodValues('apple');
    assert.deepEqual([apple.hunger, apple.saturationModifier, apple.source, apple.hoTableAt], [1, 0.05, 'hungeroverhaul-table', 69]);
    // Rule: max(1, round(5 / 2)) = 3, saturationModifier 3 / 15 (HungerOverhaul.cfg foodHungerDivider=2, foodHungerToSaturationDivider=15).
    const rabbit = pack.foodValues('cooked_rabbit');
    assert.deepEqual([rabbit.hunger, rabbit.saturationModifier, rabbit.source], [3, 0.2, 'hungeroverhaul-rule']);
    const c = data.hungerOverhaul.config;
    assert.deepEqual([c.modifyFoodValues.value, c.useHOFoodValues.value, c.foodHungerDivider.value, c.foodHungerToSaturationDivider.value, c.foodSaturationDivider.value], [true, true, 2, 15, 1]);
    // The table keys meta 0 only, so the pufferfish (fish meta 3) gets the rule: max(1, round(1 / 2)) = 1.
    assert.equal(pack.foodValues('pufferfish').source, 'hungeroverhaul-rule');
    assert.equal(pack.foodValues('cod').source, 'hungeroverhaul-table');
});

test('every computed entry is consistent, and nothing is guessed', () => {
    for (const [n, metas] of Object.entries(data.foods)) {
        for (const [m, e] of Object.entries(metas)) {
            const v = pack.dump.items.items[n].variants.find((x) => x.meta === Number(m));
            assert.ok(v?.food, `${n}:${m} is a dumped food`);
            assert.ok(Number.isInteger(e.hunger) && e.hunger >= 0, `${n}:${m} hunger`);
            assert.ok(Math.abs(e.saturation - e.hunger * e.saturationModifier * 2) <= 1e-3 + e.hunger * 2e-4, `${n}:${m} saturation (saturationModifier is rounded to 4 places)`);
            if (e.source.startsWith('crafttweaker')) assert.ok(e.script.every((s) => /^scripts\/.+\.zs:\d+$/.test(s)), n);
            if (e.source === 'hungeroverhaul-rule') assert.equal(e.hunger, Math.max(1, Math.round(v.food.hunger / 2)), `${n}:${m}`);
        }
    }
    for (const n of Object.keys(data.notComputed)) assert.ok(['harvestcraft', 'biomesoplenty'].includes(n.split(':')[0]), `${n}: only the unread Hunger Overhaul tables are left out`);
    const berries = pack.foodValues('biomesoplenty:berries');
    assert.deepEqual([berries.hunger, berries.saturation, berries.source], [null, null, 'not-computed']);
    assert.equal(pack.foodValues('stone'), null);
    assert.deepEqual(data.hungerOverhaulImc, [], 'no other mod sends Hunger Overhaul IMC');
    assert.deepEqual(Object.keys(data.foodValueListeners).sort(), [
        'mods/AppleCore-mc1.12.2-3.4.0.jar', 'mods/BetterWithMods-1.12-2.3.24.jar', 'mods/HungerOverhaul-1.12.2-1.3.3.jenkins148.jar', 'mods/HungerTweaker-1.12.2-1.3.0.jar',
    ], 'the food-value listeners are the modelled ones');
    assert.equal(data.betterWithModsHCHunger.value, false);
});

test('avoid: harmful foods, cited', () => {
    assert.deepEqual(pack.avoidFood('rotten_flesh').effects, [{ effect: 'hunger', seconds: 30, level: 1, chance: 0.8 }]);
    assert.equal(pack.avoidFood('pufferfish').effects[0].effect, 'poison');
    assert.equal(pack.avoidFood('cod'), null, 'only fish meta 3 (pufferfish)');
    assert.equal(pack.avoidFood('cyclicmagic:inventory_food').confidence, 'verified');
    assert.match(pack.avoidFood('rustic:ironberries').evidence[0], /^scripts\/events\.zs lines 177, 179: /);
    assert.equal(pack.avoidFood('twilightforest:raw_venison').ore, 'listAllvenisonraw');
    assert.equal(pack.avoidFood('rustic:cloudsbluff').confidence, 'documented');
    assert.equal(pack.avoidFood('bread'), null);
    assert.ok(pack.foodValues('spider_eye').avoid, 'foodValues carries avoid');
    for (const n of Object.keys(data.avoid)) assert.ok(pack.dump.items.items[n], n);
});

test('installFoods puts the pack values into a minecraft-data registry, in place', () => {
    const mc = minecraftData('1.12.2');
    const registry = { itemsArray: mc.itemsArray, foods: { ...mc.foods }, foodsByName: { ...mc.foodsByName }, foodsArray: [...mc.foodsArray] };
    const foods = registry.foods, arr = registry.foodsArray;
    const r = installFoods(registry);
    assert.equal(registry.foods, foods, 'same object');
    assert.equal(registry.foodsArray, arr, 'same array');
    assert.deepEqual([registry.foodsByName.bread.foodPoints, registry.foodsByName.bread.saturation], [3, 1.2]);
    assert.equal(registry.foods[registry.foodsByName.cooked_beef.id].foodPoints, 2);
    assert.ok(r.installed >= 25);
    assert.deepEqual(r.left.sort(), ['cake', 'carrots', 'melon_block', 'potatoes'], 'only the block entries of minecraft-data\'s table drop out');
});

test('the script parser: comments, metas, last line wins, unreadable lines refused', () => {
    assert.equal(stripComments('a // b\n/* c\nd */ e "//x"'), 'a \n\n e "//x"');
    const ct = parseFoodScripts([['s.zs', '<a:b>.foodValues.hunger = 1;\n/*\n<a:b>.foodValues.hunger = 9;\n*/\n<a:b:2>.foodValues.saturationModifier = 0.5;\n<a:b>.foodValues.hunger = 4;']]);
    assert.deepEqual(ct.get('a:b|0'), { hunger: 4, lines: ['s.zs:1', 's.zs:6'] });
    assert.deepEqual(ct.get('a:b|2'), { saturationModifier: 0.5, lines: ['s.zs:5'] });
    assert.throws(() => parseFoodScripts([['s.zs', 'val x = <a:b>.foodValues;']]), /cannot read/);
    assert.throws(() => parseFoodScripts([['a.zs', '<a:b>.foodValues.hunger = 1;'], ['b.zs', '<a:b>.foodValues.hunger = 2;']]), /load order/);
});
