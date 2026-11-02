// End-to-end offline tests for the skills name space (#131 review): a command
// as the LLM writes it goes through the real command boundary and the real
// skill, with a fake bot on the 1.12.2 registry. One test per review scenario:
//   1. !collectBlocks("oak_log") collects oak, even when spruce is nearer and the
//      oak log lies on its side;
//   2. the names !inventory and !nearbyBlocks show ("planks:0", "dirt:0") work
//      in !discard, !equip, !putInChest, !consume and !collectBlocks;
//   3. !craftRecipe("stick", 4) with 2 planks crafts once (the limit applies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { parseCommandMessage, getCommand } from '../commands/index.js';
import { canonicalName } from './rotn_names.js';
import * as world from './world.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);

const command = (name) => getCommand(name);

// Run a command exactly as the agent does: parse (the boundary), then perform.
function run(agent, message) {
    const parsed = parseCommandMessage(message);
    assert.equal(typeof parsed, 'object', `parse failed: ${parsed}`);
    return command(parsed.commandName).perform(agent, ...parsed.args);
}

function fakeAgent(bot) {
    return {
        bot,
        actions: {
            runAction: async (label, fn) => { await fn(); return { success: true, message: bot.output, interrupted: false, timedout: false }; },
        },
    };
}

const at = (x, y = 64, z = 0) => new Vec3(x, y, z);
function placed(name, metadata, position) {
    return { name, metadata, type: reg.blocksByName[name].id, position, canHarvest: () => true, boundingBox: 'block', transparent: false };
}
const stack = (name, metadata, count, slot) => ({ name, metadata, count, slot, type: reg.itemsByName[name].id, stackSize: 64 });

// A fake bot whose findBlocks honours matching (ids or a predicate), useExtraInfo, count, and distance order.
function fakeBot({ blocks = [], items = [] } = {}) {
    const calls = { collect: [], toss: [], equip: [], deposit: [], consume: 0, craft: [] };
    const bot = {
        calls,
        registry: reg,
        version: '1.12.2',
        output: '',
        interrupt_code: false,
        game: { gameMode: 'survival' },
        entity: { position: at(0), height: 1.8 },
        heldItem: null,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => items.filter(i => i.count > 0), slots: [null, ...items], findInventoryItem: () => null },
        findBlocks({ matching, maxDistance = 16, count = 1, useExtraInfo }) {
            const ok = (b) => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type))
                && (typeof useExtraInfo !== 'function' || useExtraInfo(b));
            return blocks.filter(b => ok(b) && b.position.distanceTo(bot.entity.position) <= maxDistance)
                .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
                .slice(0, count).map(b => b.position);
        },
        blockAt: (pos) => blocks.find(b => b.position.equals(pos)) ?? null,
        tool: { equipForBlock: () => Promise.resolve() },
        armorManager: { equipAll: () => Promise.resolve() },
        collectBlock: { collect: (block) => { calls.collect.push(block); return Promise.resolve(); } },
        pathfinder: { setMovements() {}, stop() {}, goto: () => Promise.resolve(), getPathTo: () => ({ status: 'success', path: [] }) },
        toss: (type, metadata, n) => { calls.toss.push({ type, metadata, n }); const s = items.find(i => i.type === type && (metadata == null || i.metadata === metadata)); if (s) s.count -= n; return Promise.resolve(); },
        equip: (item, dest) => { calls.equip.push({ name: item.name, metadata: item.metadata, dest }); bot.heldItem = item; return Promise.resolve(); },
        consume: () => { calls.consume++; return Promise.resolve(); },
        craft: (recipe, n) => { calls.craft.push(n); return Promise.resolve(); },
        lookAt: () => Promise.resolve(),
        openContainer: () => Promise.resolve({
            deposit: (type, metadata, n) => { calls.deposit.push({ type, metadata, n }); return Promise.resolve(); },
            close: () => Promise.resolve(),
        }),
    };
    return bot;
}

test('scenario 1: !collectBlocks("oak_log", 1) collects the oak log, not "No log:0 nearby"', async (t) => {
    t.mock.method(console, 'log', () => {});
    const oak = placed('log', 4, at(9)); // oak, lying along the x axis
    const bot = fakeBot({ blocks: [placed('log', 1, at(2)), placed('log', 5, at(3)), oak, placed('dirt', 0, at(0, 63))] });

    await run(fakeAgent(bot), '!collectBlocks("oak_log", 1)');

    assert.doesNotMatch(bot.output, /No log:0 nearby/);
    assert.deepEqual(bot.calls.collect.map(b => [b.name, b.metadata]), [['log', 4]]);
});

test('scenario 2: names from !inventory and !nearbyBlocks work in the commands that take names', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [stack('planks', 0, 3, 36), stack('planks', 1, 5, 37), stack('apple', 0, 2, 38)];
    const dirt = placed('dirt', 0, at(2, 63));
    const bot = fakeBot({ items, blocks: [dirt, placed('chest', 2, at(1))] });
    const agent = fakeAgent(bot);

    // What the LLM sees.
    const shown = Object.keys(world.getInventoryCounts(bot));
    assert.ok(shown.includes('planks:0') && shown.includes('planks:1'));
    assert.ok(world.getNearbyBlockTypes(bot, 16).includes('dirt:0'));

    await run(agent, '!equip("planks:0")');
    assert.deepEqual(bot.calls.equip[0], { name: 'planks', metadata: 0, dest: 'hand' });

    await run(agent, '!discard("planks:1", 2)');
    assert.deepEqual(bot.calls.toss, [{ type: reg.itemsByName.planks.id, metadata: 1, n: 2 }], 'spruce planks, not oak');

    await run(agent, '!putInChest("planks:0", 1)');
    assert.deepEqual(bot.calls.deposit, [{ type: reg.itemsByName.planks.id, metadata: 0, n: 1 }]);

    await run(agent, '!consume("apple")');
    assert.equal(bot.calls.consume, 1);

    await run(agent, '!collectBlocks("dirt:0", 1)');
    assert.deepEqual(bot.calls.collect.map(b => b.name), ['dirt']);
    assert.doesNotMatch(bot.output, /do not have any|No dirt:0 nearby/);
});

test('scenario 3: !craftRecipe("stick", 4) with 2 planks crafts once, and says why', async (t) => {
    t.mock.method(console, 'log', () => {});
    const planksId = reg.itemsByName.planks.id;
    const recipe = {
        result: { id: reg.itemsByName.stick.id, count: 4 },
        inShape: [[{ id: planksId, metadata: null, count: 1 }], [{ id: planksId, metadata: null, count: 1 }]],
        requiresTable: false,
    };
    const bot = fakeBot({ items: [stack('planks', 0, 2, 36)] });
    bot.recipesFor = () => [recipe];

    await run(fakeAgent(bot), '!craftRecipe("stick", 4)');

    assert.deepEqual(bot.calls.craft, [1], 'limited to the planks the bot has');
    assert.match(bot.output, /Not enough planks to craft 4, crafted 1/);
    assert.doesNotMatch(bot.output, /undefined/);
});

// #131 re-review.
test('re-review 1: !getCraftingPlan("stick", 4) with 4 oak planks plans from the planks, not from logs', async () => {
    const bot = fakeBot({ items: [stack('planks', 0, 4, 36)] });
    const plan = await run(fakeAgent(bot), '!getCraftingPlan("stick", 4)');
    assert.match(plan, /You have all items required to craft this item!/);
    assert.match(plan, /Craft 2 planks -> 4 stick/);
    assert.doesNotMatch(plan, /log/);
    // A 1.21 or variant target works too.
    assert.match(await run(fakeAgent(bot), '!getCraftingPlan("oak_planks", 4)'), /You already have 4 planks in your inventory/);
});

test('re-review 2: !smeltItem("sand:0", 1), a name copied from !inventory, is accepted as sand', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot({ items: [stack('sand', 0, 4, 36)] });
    assert.ok(Object.keys(world.getInventoryCounts(bot)).includes('sand:0'), 'what !inventory shows');
    await run(fakeAgent(bot), '!smeltItem("sand:0", 1)');
    assert.doesNotMatch(bot.output, /Cannot smelt/);
    assert.match(bot.output, /There is no furnace nearby and you have no furnace/, 'it got past the smeltable check');
});

test('re-review nit 3: the craft limit counts only the variant the recipe asks for', async (t) => {
    t.mock.method(console, 'log', () => {});
    const planksId = reg.itemsByName.planks.id;
    const recipe = {
        result: { id: reg.itemsByName.stick.id, count: 4 },
        inShape: [[{ id: planksId, metadata: 0, count: 1 }], [{ id: planksId, metadata: 0, count: 1 }]], // oak only
        requiresTable: false,
    };
    const bot = fakeBot({ items: [stack('planks', 0, 2, 36), stack('planks', 1, 6, 37)] });
    bot.recipesFor = () => [recipe];
    await run(fakeAgent(bot), '!craftRecipe("stick", 3)');
    assert.deepEqual(bot.calls.craft, [1], '2 oak planks make one craft; the 6 spruce do not count');
});

test('re-review nit 4: an ambiguous name shown to the LLM comes back to the same thing', () => {
    const bot = fakeBot({ items: [stack('snow', 0, 3, 36)], blocks: [placed('grass', 0, at(1, 63))] });
    const shownItem = Object.keys(world.getInventoryCounts(bot))[0];
    const shownBlock = world.getNearbyBlockTypes(bot, 16)[0];
    assert.equal(shownItem, 'minecraft:snow');
    assert.equal(shownBlock, 'minecraft:grass');
    assert.equal(canonicalName(shownItem, 'items'), 'snow', 'the 1.12 snow block, not the layer');
    assert.equal(canonicalName(shownBlock, 'blocks'), 'grass');
    assert.equal(canonicalName('snow', 'items'), 'snow_layer', 'a bare LLM "snow" keeps the 1.21 meaning');
});
