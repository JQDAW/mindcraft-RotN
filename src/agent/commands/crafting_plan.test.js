// Offline test (skills-rotn, with rotn-data #153): !getCraftingPlan passes the
// variant-keyed inventory (world.getInventoryCounts) to mcdata's planner, so a
// variant-restricted recipe is not "everything" with the wrong variant: dirt
// clumps (pyrotech:rock:4) are not the rocks the stone pickaxe needs. The
// registry is minecraft-data 1.12.2 plus the modded rocks, with RotN's recipes
// installed by rotn-data's installRecipes (as initBot does). No server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { installRecipes } from '../../../packages/rotn-data/index.js';
import '../agent.js'; // the real import order (commands/index.js before queries.js)
import { queryList } from './queries.js';

const vanilla = minecraftData('1.12.2');
const reg = { ...vanilla, items: { ...vanilla.items }, itemsByName: { ...vanilla.itemsByName }, recipes: { ...vanilla.recipes } };
['pyrotech:rock', 'pyrotech_compat:rock_igneous'].forEach((name, i) => {
    const item = { id: 5000 + i, name, stackSize: 64 };
    reg.items[item.id] = item;
    reg.itemsByName[name] = item;
});
installRecipes(reg);
__setRegistryForTest(reg);

const plan = (items, target, n) => queryList.find(c => c.name === '!getCraftingPlan')
    .perform({ bot: { inventory: { slots: items, items: () => items } } }, target, n);

test('3 dirt clumps are not the rocks a stone pickaxe needs', () => {
    const out = plan([{ name: 'pyrotech:rock', metadata: 4, count: 3 }, { name: 'stick', metadata: 0, count: 2 }], 'stone_pickaxe', 1);
    assert.match(out, /You are missing the following items:\s+- 3 pyrotech:rock:0/);
    assert.doesNotMatch(out, /You have all items required/);
});

test('3 stone rocks and 2 sticks are everything for a stone pickaxe', () => {
    const out = plan([{ name: 'pyrotech:rock', metadata: 0, count: 3 }, { name: 'stick', metadata: 0, count: 2 }], 'stone_pickaxe', 1);
    assert.match(out, /You have all items required to craft this item!/);
    assert.match(out, /Craft 3 pyrotech:rock:0 \+ 2 stick -> 1 stone_pickaxe/);
});

test('the target already held counts across its variants', () => {
    const out = plan([{ name: 'planks', metadata: 0, count: 2 }, { name: 'planks', metadata: 1, count: 3 }], 'oak_planks', 4);
    assert.match(out, /^\s*You already have 5 planks in your inventory\./);
});
