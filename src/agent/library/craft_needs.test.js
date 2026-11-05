// Offline tests for skills-rotn C1's recipe check (no slot clicks): what the bot
// still needs by RotN's recipes (rotn-data howToGet craft ways), judged by
// rotn-data's canFill (#152): slots are independent, so mixed rocks make a stone
// tool, while cobblestone (one recipe per rock type) still needs one type. A
// fake inventory on the 1.12.2 registry; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { parseCommandMessage, getCommand } from '../commands/index.js';
import { craftNeeds, describeNeeds, filledRecipe, fillNow } from './craft_needs.js';
import prismarineRecipe from 'prismarine-recipe';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);

const stack = (name, metadata, count) => ({ name, metadata, count, type: reg.itemsByName[name]?.id ?? 5000 });
const invBot = (items) => ({ inventory: { items: () => items, slots: [null, ...items] } });

test('mixed rocks make a stone pickaxe (rotn-data canFill: slots are independent)', () => {
    const bot = invBot([stack('pyrotech_compat:rock_metamorphic', 0, 2), stack('pyrotech_compat:rock_igneous', 7, 1), stack('stick', 0, 2)]);
    const needs = craftNeeds(bot, 'stone_pickaxe');
    assert.equal(needs.ready, true);
    assert.equal(needs.short, 0);
    assert.equal(needs.requiresTable, true);
});

test('two rocks short of one: get 1 more of any rock', () => {
    const bot = invBot([stack('pyrotech_compat:rock_metamorphic', 0, 2), stack('stick', 0, 4)]);
    const needs = craftNeeds(bot, 'stone_pickaxe');
    assert.equal(needs.ready, false);
    assert.equal(needs.short, 1);
    assert.equal(describeNeeds('stone_pickaxe', needs),
        'To craft stone_pickaxe (at a crafting table): 3 rock: you have 2 pyrotech_compat:rock_metamorphic, so get 1 more pyrotech:rock (any rock); 2 ladderMat: you have 4 stick (enough).');
});

test('the flint recipe counts too (any RotN craft way, matched by output and ingredients)', () => {
    const needs = craftNeeds(invBot([stack('flint', 0, 3), stack('stick', 0, 2)]), 'stone_pickaxe');
    assert.equal(needs.ready, true);
});

test('no rocks at all: "you have none", and the advice is any rock', () => {
    const needs = craftNeeds(invBot([stack('stick', 0, 2)]), 'stone_pickaxe');
    assert.equal(needs.ready, false);
    assert.match(describeNeeds('stone_pickaxe', needs), /3 rock: you have none, so get 3 pyrotech:rock \(any rock\)/);
});

test('an item with no RotN craft way gives null', () => {
    assert.equal(craftNeeds(invBot([]), 'pyrotech:rock:4'), null);
});

test('cobblestone still needs 4 rocks of one type (one RotN recipe per rock type)', () => {
    const needs = craftNeeds(invBot([stack('pyrotech:rock', 0, 3), stack('pyrotech:rock', 6, 2)]), 'cobblestone');
    assert.equal(needs.ready, false);
    assert.equal(describeNeeds('cobblestone', needs), 'To craft cobblestone: 4 pyrotech:rock:0: you have 3 pyrotech:rock:0, so get 1 more pyrotech:rock:0.');
    assert.equal(craftNeeds(invBot([stack('pyrotech:rock', 0, 4)]), 'cobblestone').ready, true);
});

// #151 review: the early-game messages, word for word.
test('crude axe: 1 rock and 2 sticks; with no rock the advice is any rock', () => {
    const needs = craftNeeds(invBot([stack('stick', 0, 2)]), 'pyrotech:crude_axe');
    assert.equal(describeNeeds('pyrotech:crude_axe', needs),
        'To craft pyrotech:crude_axe: 1 rock: you have none, so get 1 pyrotech:rock (any rock); 2 ladderMat: you have 2 stick (enough).');
    assert.equal(craftNeeds(invBot([stack('stick', 0, 2), stack('pyrotech_compat:rock_sedimentary', 2, 1)]), 'pyrotech:crude_axe').ready, true,
        'an Underground Biomes rock is a rock');
});

test('Crafting Tools: the crude axe, a rock and a stick', () => {
    const needs = craftNeeds(invBot([stack('pyrotech:crude_axe', 0, 1), stack('stick', 0, 1)]), 'contenttweaker:crafting_tools');
    assert.equal(describeNeeds('contenttweaker:crafting_tools', needs),
        'To craft contenttweaker:crafting_tools: 1 pyrotech:crude_axe: you have 1 pyrotech:crude_axe (enough); 1 rock: you have none, so get 1 pyrotech:rock (any rock); 1 ladderMat: you have 1 stick (enough).');
    const ready = craftNeeds(invBot([stack('pyrotech:crude_axe', 0, 1), stack('stick', 0, 1), stack('pyrotech_compat:rock_igneous', 3, 1)]), 'contenttweaker:crafting_tools');
    assert.equal(ready.ready, true);
});

test('crafting table: a plank and the Crafting Tools (no plank-only recipe)', () => {
    const needs = craftNeeds(invBot([stack('planks', 0, 1)]), 'crafting_table');
    assert.equal(describeNeeds('crafting_table', needs),
        'To craft crafting_table: 1 plankWood: you have 1 planks (enough); 1 contenttweaker:crafting_tools: you have none, so get 1 contenttweaker:crafting_tools.');
});

test('stone axe: at a crafting table, from 3 rocks (mixed is fine)', () => {
    const needs = craftNeeds(invBot([stack('pyrotech_compat:rock_igneous', 0, 2), stack('stick', 0, 2)]), 'stone_axe');
    assert.equal(describeNeeds('stone_axe', needs),
        'To craft stone_axe (at a crafting table): 3 rock: you have 2 pyrotech_compat:rock_igneous, so get 1 more pyrotech:rock (any rock); 2 ladderMat: you have 2 stick (enough).');
    assert.equal(craftNeeds(invBot([stack('pyrotech_compat:rock_igneous', 0, 2), stack('pyrotech:rock', 6, 1), stack('stick', 0, 2)]), 'stone_axe').ready, true);
});

test('!craftRecipe("stone_pickaxe", 1) without enough rocks says what to get, not a raw recipe dump', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [stack('pyrotech_compat:rock_metamorphic', 0, 2), stack('stick', 0, 4)];
    const bot = {
        ...invBot(items),
        registry: reg,
        output: '',
        entity: { position: new Vec3(0, 64, 0) },
        modes: { isOn: () => false },
        findBlocks: () => [],
        blockAt: () => null,
        recipesFor: () => [],
    };
    const agent = { bot, actions: { runAction: async (label, fn) => { await fn(); return { message: bot.output, interrupted: false }; } } };
    const { commandName, args } = parseCommandMessage('!craftRecipe("stone_pickaxe", 1)');
    await getCommand(commandName).perform(agent, ...args);
    assert.match(bot.output, /You do not have the resources to craft stone_pickaxe\. To craft stone_pickaxe \(at a crafting table\): 3 rock: you have 2 pyrotech_compat:rock_metamorphic, so get 1 more pyrotech:rock \(any rock\)/);
});

// #151 re-review: the advice is rotn-data's top-ranked choice, not the ore list's first entry,
// and a slot takes every stack the recipe slot lists (the crude axe's rock slot takes flint).
test('crude axe without sticks: the advice is stick (any ladderMat), not a Better With Mods shaft', () => {
    const needs = craftNeeds(invBot([stack('pyrotech:rock', 0, 1)]), 'pyrotech:crude_axe');
    assert.equal(describeNeeds('pyrotech:crude_axe', needs),
        'To craft pyrotech:crude_axe: 1 rock: you have 1 pyrotech:rock:0 (enough); 2 ladderMat: you have none, so get 2 stick (any ladderMat).');
});

test('crafting table without planks: the advice is planks (any plankWood), not skyroot', () => {
    const needs = craftNeeds(invBot([stack('contenttweaker:crafting_tools', 0, 1)]), 'crafting_table');
    assert.equal(describeNeeds('crafting_table', needs),
        'To craft crafting_table: 1 plankWood: you have none, so get 1 planks (any plankWood); 1 contenttweaker:crafting_tools: you have 1 contenttweaker:crafting_tools (enough).');
});

test('crude axe from flint and sticks is ready (the recipe slot lists flint)', () => {
    const needs = craftNeeds(invBot([stack('flint', 0, 1), stack('stick', 0, 2)]), 'pyrotech:crude_axe');
    assert.equal(needs.ready, true);
    assert.equal(needs.inputs[0].short, 0);
    assert.deepEqual(needs.inputs[0].kinds, [{ name: 'flint', have: 1 }]);
});

// #151 re-review: craftRecipe's messages must not throw (getItemCraftingRecipes gives null
// for an item without recipes; the raw-recipe text read [0][0] of it).
async function craftLog(items, name) {
    const bot = {
        ...invBot(items),
        registry: reg,
        output: '',
        entity: { position: new Vec3(0, 64, 0) },
        modes: { isOn: () => false },
        findBlocks: () => [],
        blockAt: () => null,
        recipesFor: () => [],
    };
    const agent = { bot, actions: { runAction: async (label, fn) => { await fn(); return { message: bot.output, interrupted: false }; } } };
    const { commandName, args } = parseCommandMessage(`!craftRecipe("${name}", 1)`);
    await getCommand(commandName).perform(agent, ...args);
    return bot.output;
}

test('!craftRecipe: items that fit a RotN recipe but no registry variant and no table: a message, not a throw', async (t) => {
    t.mock.method(console, 'log', () => {});
    const out = await craftLog([stack('pyrotech:rock', 0, 3), stack('stick', 0, 2)], 'stone_pickaxe');
    assert.match(out, /Crafting stone_pickaxe requires a crafting table\./, 'C1: it tries the canFill craft, which needs a table');
});

test('!craftRecipe: an item with no crafting recipe gives a message, not a TypeError', async (t) => {
    t.mock.method(console, 'log', () => {});
    const out = await craftLog([], 'bedrock');
    assert.match(out, /bedrock is either not an item, or it does not have a crafting recipe!/);
});

test('#151 nit: each input counts its own recipe slot (soaking_pot: string fits the twine slot, not the 1-stack slot beside it)', () => {
    const needs = craftNeeds(invBot([stack('string', 0, 5)]), 'pyrotech:soaking_pot');
    const one = needs.inputs.filter(i => i.count === 1 && !i.ore);
    assert.equal(one.length, 1);
    assert.deepEqual([one[0].kinds, one[0].short], [[], 1], 'string does not fill the 1-stack slot');
    const twine = needs.inputs.find(i => i.ore === 'twine');
    assert.deepEqual([twine.kinds, twine.short], [[{ name: 'string', have: 5 }], 0], 'it fills the twine slot');
});

// C1: crafting from canFill, for a mix of kinds bot.registry's capped variants leave out.
// A registry with the two modded rocks (their ids are made up; only the mapping matters).
const IGN = 5001, MET = 5002;
const modReg = { ...reg, itemsByName: { ...reg.itemsByName,
    'pyrotech_compat:rock_igneous': { id: IGN, name: 'pyrotech_compat:rock_igneous' },
    'pyrotech_compat:rock_metamorphic': { id: MET, name: 'pyrotech_compat:rock_metamorphic' } } };
const mixed = () => [stack('pyrotech_compat:rock_igneous', 0, 1), stack('pyrotech_compat:rock_metamorphic', 0, 2), stack('stick', 0, 2)];

test('C1: filledRecipe puts the stacks canFill assigned into the rotn-data recipe shape', () => {
    const fill = fillNow(invBot(mixed()), 'crafttweaker:stone_pickaxe');
    assert.equal(fill.ok, true);
    const v = filledRecipe(modReg, 'crafttweaker:stone_pickaxe', fill.assignment);
    const stick = reg.itemsByName.stick.id;
    const ids = v.inShape.map(row => row.map(c => c && `${c.id}:${c.metadata}`));
    assert.deepEqual(ids, [[`${MET}:0`, `${MET}:0`, `${IGN}:0`], [null, `${stick}:0`, null], [null, `${stick}:0`, null]]);
    assert.deepEqual(v.result, { id: reg.itemsByName.stone_pickaxe.id, metadata: 0, meta: 0, count: 1 });
    const { Recipe } = prismarineRecipe(modReg);
    assert.equal(new Recipe(v).requiresTable, true, 'a 3x3 shape: at the table');
    assert.throws(() => filledRecipe(reg, 'crafttweaker:stone_pickaxe', fill.assignment), /pyrotech_compat:rock_metamorphic is not in bot.registry/);
    assert.throws(() => filledRecipe(modReg, 'crafttweaker:stone_pickaxe', fill.assignment.slice(0, 2)), /no stack for slot 3/);
});

test('C1: !craftRecipe with mixed rocks and no registry variant crafts at the nearby table from the canFill stacks', async (t) => {
    t.mock.method(console, 'log', () => {});
    let items = mixed();
    const crafts = [];
    const tablePos = new Vec3(1, 64, 0);
    const bot = {
        inventory: { items: () => items, slots: [] },
        registry: modReg,
        output: '',
        entity: { position: new Vec3(0, 64, 0) },
        modes: { isOn: () => false },
        findBlocks: () => [tablePos],
        blockAt: (p) => ({ name: 'crafting_table', position: p }),
        recipesFor: () => [], // the capped variants have no such mix
        craft: (recipe, count, table) => {
            crafts.push({ recipe, count, table });
            items = [stack('stone_pickaxe', 0, 1)]; // the server took the rocks and sticks
            return Promise.resolve();
        },
    };
    const agent = { bot, actions: { runAction: async (label, fn) => { await fn(); return { message: bot.output, interrupted: false }; } } };
    const { commandName, args } = parseCommandMessage('!craftRecipe("stone_pickaxe", 2)');
    await getCommand(commandName).perform(agent, ...args);
    assert.equal(crafts.length, 1, 'one craft; then the items no longer fit');
    assert.equal(crafts[0].count, 1);
    assert.equal(crafts[0].table.name, 'crafting_table');
    assert.deepEqual(crafts[0].recipe.inShape[0].map(c => `${c.id}:${c.metadata}`), [`${MET}:0`, `${MET}:0`, `${IGN}:0`]);
    assert.match(bot.output, /Crafted 1 of 2 stone_pickaxe from mixed items; not enough for more\. You now have 1 stone_pickaxe\./);
});

test('C1: filledRecipe refuses an NBT result and a recipe that leaves items in the grid (net-forge rules)', () => {
    assert.throws(() => filledRecipe(modReg, 'betterwithmods:baiting_recipe', []), /has an NBT result/);
    assert.throws(() => filledRecipe(modReg, 'aether_legacy:poison_dart', []), /leaves items in the grid/);
});

test('C1: craftPausingAutoEat disables auto-eat for the craft, waits out an eat, and restores it', async () => {
    const { craftPausingAutoEat } = await import('./skills.js');
    const autoEat = { disabled: false, isEating: true, disable() { this.disabled = true; }, enable() { this.disabled = false; } };
    const seen = [];
    const bot = { autoEat, craft: () => { seen.push({ disabled: autoEat.disabled, eating: autoEat.isEating }); return Promise.resolve(); } };
    setTimeout(() => { autoEat.isEating = false; }, 150);
    await craftPausingAutoEat(bot, {}, 1, null);
    assert.deepEqual(seen, [{ disabled: true, eating: false }]);
    assert.equal(autoEat.disabled, false, 'on again after the craft');

    const failing = { autoEat, craft: () => Promise.reject(new Error('click rejected')) };
    await assert.rejects(craftPausingAutoEat(failing, {}, 1, null), /click rejected/);
    assert.equal(autoEat.disabled, false, 'on again after a failed craft');

    autoEat.disabled = true; // turned off by someone else: stays off
    await craftPausingAutoEat(bot, {}, 1, null);
    assert.equal(autoEat.disabled, true);
});

// #194 review (lead, required before the G3 (a) batch): 2x2-grid canFill crafts, real inventory
// gain per craft, and a placed table picked up also when bot.craft throws. Nits 3 and 4.
const CRUDE = 5101, TOOLS = 5102, ROCK = 5103;
const fillReg = { ...reg, itemsByName: { ...reg.itemsByName,
    'pyrotech:crude_axe': { id: CRUDE, name: 'pyrotech:crude_axe' },
    'contenttweaker:crafting_tools': { id: TOOLS, name: 'contenttweaker:crafting_tools' },
    'pyrotech:rock': { id: ROCK, name: 'pyrotech:rock' } } };
const cellIds = (r) => (r.inShape ? r.inShape.flat() : r.ingredients).map(c => (c && c.id !== -1 ? `${c.id}:${c.metadata}` : null)); // prismarine-recipe: id -1 is an empty cell

/** A bot whose bot.craft runs `serve(recipe, items)`, which returns the inventory after the craft. */
function fillBot(start, serve) {
    let items = start;
    const crafts = [];
    const bot = {
        inventory: { items: () => items, get slots() { return [null, ...items]; } },
        get _items() { return items; },
        registry: fillReg,
        output: '',
        entity: { position: new Vec3(0, 64, 0) },
        craft: (recipe, count, table) => {
            crafts.push({ recipe, count, table });
            try { items = serve(recipe, items); } catch (err) { return Promise.reject(err); }
            return Promise.resolve();
        },
    };
    return { bot, crafts };
}
const take = (items, name, n) => items.map(i => (i.name === name ? { ...i, count: i.count - n } : i)).filter(i => i.count > 0);

test('#194 review 5: a crude axe in the 2x2 grid from canFill stacks, twice, each counted by the real gain', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftByFill } = await import('./skills.js');
    const { bot, crafts } = fillBot([stack('pyrotech:rock', 0, 2), stack('stick', 0, 4)],
        (r, items) => { // the server takes 1 rock and 2 sticks and gives one more axe
            const axes = items.find(i => i.name === 'pyrotech:crude_axe')?.count ?? 0;
            const rest = take(take(items.filter(i => i.name !== 'pyrotech:crude_axe'), 'pyrotech:rock', 1), 'stick', 2);
            return [...rest, stack('pyrotech:crude_axe', 0, axes + 1)];
        });
    const needs = craftNeeds(bot, 'pyrotech:crude_axe');
    assert.equal(needs.ready, true);
    assert.equal(needs.requiresTable, false);
    assert.equal(await craftByFill(bot, 'pyrotech:crude_axe', 2, needs), true);
    assert.equal(crafts.length, 2);
    assert.ok(crafts.every(c => c.table === null && c.count === 1), 'the 2x2 grid, one at a time');
    const stick = reg.itemsByName.stick.id;
    assert.deepEqual(cellIds(crafts[0].recipe), [`${ROCK}:0`, `${stick}:0`, `${stick}:0`, null]);
    assert.match(bot.output, /Successfully crafted pyrotech:crude_axe from mixed items, you now have 2 pyrotech:crude_axe\./);
});

test('#194 review 5: Crafting Tools (shapeless, 2x2) uses the damaged crude axe the bot has, not the wildcard meta', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftByFill } = await import('./skills.js');
    const { bot, crafts } = fillBot([stack('pyrotech:crude_axe', 3, 1), stack('pyrotech:rock', 0, 1), stack('stick', 0, 1)],
        () => [stack('contenttweaker:crafting_tools', 0, 1)]);
    const needs = craftNeeds(bot, 'contenttweaker:crafting_tools');
    assert.equal(needs.requiresTable, false);
    assert.equal(await craftByFill(bot, 'contenttweaker:crafting_tools', 1, needs), true);
    assert.equal(crafts[0].table, null);
    assert.ok(cellIds(crafts[0].recipe).includes(`${CRUDE}:3`), `cells ${cellIds(crafts[0].recipe)}`);
    assert.match(bot.output, /Successfully crafted contenttweaker:crafting_tools/);
});

test('#194 review 1: a craft that gives nothing is not counted, and the loop stops there', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftByFill } = await import('./skills.js');
    const { bot, crafts } = fillBot([stack('pyrotech:rock', 0, 3), stack('stick', 0, 6)], (r, items) => items);
    const needs = craftNeeds(bot, 'pyrotech:crude_axe');
    assert.equal(await craftByFill(bot, 'pyrotech:crude_axe', 3, needs), false);
    assert.equal(crafts.length, 1, 'no second try after a craft that gave nothing');
    assert.match(bot.output, /Could not craft pyrotech:crude_axe: the craft gave no pyrotech:crude_axe\./);
});

test('#194 review 2: a table placed for the craft is picked up again when bot.craft throws, and after a craft', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftByFill } = await import('./skills.js');
    const table = { name: 'crafting_table', position: new Vec3(1, 64, 0) };
    const mixedIn = () => [...mixed(), stack('crafting_table', 0, 1)];
    for (const [serve, result, line] of [
        [() => { throw new Error('click rejected'); }, false, /Could not craft stone_pickaxe: the craft failed \(Error: click rejected\)/],
        [() => [stack('stone_pickaxe', 0, 1)], true, /Successfully crafted stone_pickaxe from mixed items/],
    ]) {
        const { bot, crafts } = fillBot(mixedIn(), serve);
        bot.registry = { ...fillReg, itemsByName: { ...fillReg.itemsByName, ...modReg.itemsByName } };
        bot.findBlocks = () => []; // no table nearby
        const ops = { placed: 0, picked: 0 };
        ops.place = () => { ops.placed++; return Promise.resolve(table); };
        ops.pickUp = () => { ops.picked++; return Promise.resolve(); };
        const needs = craftNeeds(bot, 'stone_pickaxe');
        assert.equal(await craftByFill(bot, 'stone_pickaxe', 1, needs, null, false, ops), result);
        assert.equal(crafts[0].table, table);
        assert.deepEqual([ops.placed, ops.picked], [1, 1], 'placed once, picked up once');
        assert.match(bot.output, line);
    }
});

test('#194 nits 3 and 4: no recipe id says so; no free space for a table says so', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftByFill, CRAFT_TABLE_OPS } = await import('./skills.js');
    const { bot } = fillBot([], () => []);
    assert.equal(await craftByFill(bot, 'stone_pickaxe', 1, { requiresTable: true, recipeId: null, inputs: [], short: 0, ready: true }), false);
    assert.match(bot.output, /Could not craft stone_pickaxe: rotn-data names no recipe for these items\./);
    bot.findBlocks = () => [];
    bot.output = '';
    assert.equal(await CRAFT_TABLE_OPS.place(bot, 'stone_pickaxe'), null);
    assert.match(bot.output, /Could not place a crafting table to craft stone_pickaxe: no free space nearby\./);
});

// #198 review: craftRecipe's own path picks a table it placed up again however it ends; a table it
// found stays; a missing free space is guarded; results with a count over 1, on top of a held stack.
const tablePos = new Vec3(1, 64, 0);
const tableBlock = { name: 'crafting_table', position: tablePos };
function tableOps({ place = tableBlock } = {}) {
    const ops = { placed: 0, picked: 0 };
    ops.place = () => { ops.placed++; return Promise.resolve(place); };
    ops.pickUp = () => { ops.picked++; return Promise.resolve(); };
    return ops;
}
/** A bot for craftRecipe: recipesFor finds the vanilla recipe only at a table (none at all with `fill`). */
function craftRecipeBot({ items, tableNear = false, fill = false, serve, registry = reg }) {
    const { Recipe } = prismarineRecipe(reg);
    const recipe = Recipe.find(reg.itemsByName.stone_pickaxe.id, null)[0];
    const { bot, crafts } = fillBot(items, serve);
    Object.assign(bot, {
        registry,
        modes: { isOn: () => false },
        armorManager: { equipAll() {} },
        findBlocks: () => (tableNear ? [tablePos] : []),
        blockAt: (p) => (tableNear && p.equals(tablePos) ? tableBlock : null),
        recipesFor: (id, meta, n, table) => (table === null || (fill && table !== true) ? [] : [recipe]),
    });
    return { bot, crafts };
}
const pickInputs = () => [stack('cobblestone', 0, 3), stack('stick', 0, 2), stack('crafting_table', 0, 1)];

test('#198 review: a table craftRecipe placed is picked up after the craft, and when bot.craft throws', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftRecipe } = await import('./skills.js');
    const ok = craftRecipeBot({ items: pickInputs(), serve: () => [stack('stone_pickaxe', 0, 1)] });
    const okOps = tableOps();
    const okRes = await craftRecipe(ok.bot, 'stone_pickaxe', 1, okOps);
    assert.equal(okRes, true);
    assert.equal(ok.crafts[0].table, tableBlock);
    assert.deepEqual([okOps.placed, okOps.picked], [1, 1]);

    const bad = craftRecipeBot({ items: pickInputs(), serve: () => { throw new Error('click rejected'); } });
    const badOps = tableOps();
    await assert.rejects(craftRecipe(bad.bot, 'stone_pickaxe', 1, badOps), /click rejected/);
    assert.deepEqual([badOps.placed, badOps.picked], [1, 1], 'picked up although the craft threw');
});

test('#198 review: a table the bot found nearby is used and left where it is', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftRecipe } = await import('./skills.js');
    const { bot, crafts } = craftRecipeBot({ items: pickInputs(), tableNear: true, serve: () => [stack('stone_pickaxe', 0, 1)] });
    const ops = tableOps();
    assert.equal(await craftRecipe(bot, 'stone_pickaxe', 1, ops), true);
    assert.equal(crafts[0].table, tableBlock);
    assert.deepEqual([ops.placed, ops.picked], [0, 0]);
});

test('#198 review: placed by craftRecipe, then crafted by canFill: the table is picked up once, not twice', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftRecipe } = await import('./skills.js');
    const { bot, crafts } = craftRecipeBot({ items: [...mixed(), stack('crafting_table', 0, 1)], fill: true,
        registry: { ...fillReg, itemsByName: { ...fillReg.itemsByName, ...modReg.itemsByName } },
        serve: () => [stack('stone_pickaxe', 0, 1)] });
    const ops = tableOps();
    assert.equal(await craftRecipe(bot, 'stone_pickaxe', 1, ops), true);
    assert.equal(crafts[0].table, tableBlock, 'craftByFill used the table craftRecipe placed');
    assert.deepEqual([ops.placed, ops.picked], [1, 1]);
    assert.match(bot.output, /Successfully crafted stone_pickaxe from mixed items/);
});

test('#198 review: when no table can be placed, craftRecipe says so and crafts nothing', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftRecipe, CRAFT_TABLE_OPS } = await import('./skills.js');
    const { bot, crafts } = craftRecipeBot({ items: pickInputs(), serve: () => [] });
    const ops = { ...tableOps(), place: CRAFT_TABLE_OPS.place }; // the real one: no free space (findBlocks finds none)
    assert.equal(await craftRecipe(bot, 'stone_pickaxe', 1, ops), false);
    assert.deepEqual(crafts, []);
    assert.equal(ops.picked, 0);
    assert.match(bot.output, /Could not place a crafting table to craft stone_pickaxe: no free space nearby\./);
});

test('#198 review: a result with a count over 1, on top of a stack already held, counts each craft by the gain', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftByFill } = await import('./skills.js');
    // RotN's stick recipe gives 4; the bot already holds 3 sticks.
    const { bot, crafts } = fillBot([stack('planks', 0, 4), stack('stick', 0, 3)], (r, items) => {
        const sticks = items.find(i => i.name === 'stick')?.count ?? 0;
        return [...take(items.filter(i => i.name !== 'stick'), 'planks', 2), stack('stick', 0, sticks + 4)];
    });
    const needs = craftNeeds(bot, 'stick');
    assert.equal(needs.gives.count, 4);
    assert.equal(await craftByFill(bot, 'stick', 3, needs), true);
    assert.equal(crafts.length, 2, 'two crafts; then the planks run out');
    assert.match(bot.output, /Crafted 2 of 3 stick from mixed items; not enough for more\. You now have 11 stick\./);
});

// #202 review nits: a table placed by the caller is picked up when craftByFill ends early (no
// recipe id) or needs no table (a 2x2 craft); a late block update after placing a table.
test('#202 nit: placed=true into craftByFill with no recipe id, or a 2x2 recipe, is picked up once', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { craftByFill } = await import('./skills.js');
    const a = fillBot([], () => []);
    const aOps = tableOps();
    assert.equal(await craftByFill(a.bot, 'stone_pickaxe', 1, { requiresTable: true, recipeId: null, inputs: [], short: 0, ready: true }, tableBlock, true, aOps), false);
    assert.deepEqual([aOps.placed, aOps.picked], [0, 1]);

    const b = fillBot([stack('pyrotech:rock', 0, 1), stack('stick', 0, 2)], () => [stack('pyrotech:crude_axe', 0, 1)]);
    const bOps = tableOps();
    const needs = craftNeeds(b.bot, 'pyrotech:crude_axe');
    assert.equal(await craftByFill(b.bot, 'pyrotech:crude_axe', 1, needs, tableBlock, true, bOps), true);
    assert.equal(b.crafts[0].table, null, 'the 2x2 grid, not the table');
    assert.deepEqual([bOps.placed, bOps.picked], [0, 1]);
});

test('#202 nit: a crafting table whose block update comes late is found on a second look, not left behind', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { CRAFT_TABLE_OPS } = await import('./skills.js');
    const free = new Vec3(3, 64, 0);
    let standing = false;
    const air = (p) => ({ name: 'air', boundingBox: 'empty', position: p, drops: [], diggable: false });
    const bot = {
        output: '',
        inventory: { items: () => [stack('crafting_table', 0, 1)], slots: [null, stack('crafting_table', 0, 1)] },
        entity: { position: new Vec3(0.5, 64, 0.5) },
        modes: { isOn: () => false },
        game: { gameMode: 'survival' },
        // Air search (a function) for the free space; the table search (ids) finds it once it stands.
        findBlocks: ({ matching }) => (typeof matching === 'function' ? [free] : standing ? [free] : []),
        blockAt: (p) => (p.equals(free) && standing ? { name: 'crafting_table', boundingBox: 'block', position: p }
            : p.equals(free.offset(0, -1, 0)) ? { name: 'dirt', boundingBox: 'block', position: p, drops: [1], diggable: true } : air(p)),
        equip: async () => {},
        lookAt: async () => {},
        // The server places it, but the update arrives after mineflayer gave up.
        placeBlock: () => { setTimeout(() => { standing = true; }, 20); return Promise.reject(new Error('Event blockUpdate did not fire within timeout of 2000ms')); },
    };
    const place = CRAFT_TABLE_OPS.place;
    const table = await place(bot, 'stone_pickaxe', 100);
    assert.ok(table, bot.output);
    assert.ok(table.position.equals(free));
    assert.doesNotMatch(bot.output, /Could not place a crafting table to craft/);
});
