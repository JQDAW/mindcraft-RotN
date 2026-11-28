// Soak 18 (/home/rv/s18-craft-result-netforge.md): a 2x2 craft of 4 rhyolite rocks into a cobblestone with the
// inventory full. The rock stack (5) was not used up, so no slot was free for the result: mineflayer's putAway
// threw it on the ground (a slot -999 click; the server drops the cursor at the bot's feet, and a full inventory
// cannot pick it up), and bot.craft resolved as if it had worked. patches/mineflayer now emits cursorTossed
// (inventory.js) and craftResultDropped (craft.js grabResult), and forge-bridge logs
// "[forge-bridge] craft result <item> xN: thrown on the ground at ...". Nothing else changes.
// Through Mindcraft's real initBot and mineflayer's real bot.craft, against the fake Forge server. Loopback only.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpFile } from './helpers.js';
import { startRotnWorld, stopCraftWorld, within } from './craft-world.js';
import { inventoryDiff } from './fake-containers.js';

const require = createRequire(import.meta.url);
const ROCK = 'pyrotech:rock';
const COBBLE = 'minecraft:cobblestone';
const DIRT = 'minecraft:dirt';
const LOG = 'minecraft:log';
const PLANKS = 'minecraft:planks';
let world;
let restoreLog = null;
after(() => { restoreLog?.(); return stopCraftWorld(world ?? {}); });

// Window 0's slots 9-44 full: the given stacks, every other slot a full stack of dirt. The stack sizes are the
// pack's (StackUp, rotn-data's dump): dirt, cobblestone, logs and planks 128.
const full = (stacks) => Object.fromEntries(Array.from({ length: 36 }, (_, i) => 9 + i).map(s => [s, stacks[s] ?? { name: DIRT, count: 128 }]));

test('soak 18: a craft result with no room in the inventory is thrown on the ground, and a line says so; with room, no line', { timeout: 90000 }, async () => {
    const lines = [];
    world = await startRotnWorld({
        itemNames: [ROCK, COBBLE, DIRT, LOG, PLANKS],
        inventory: full({ 36: { name: ROCK, count: 5 } }),
        recipes: [{ shapeless: [ROCK, ROCK, ROCK, ROCK], result: COBBLE }, { shapeless: [LOG], result: PLANKS, count: 4 }],
        captureFile: tmpFile('craft-full-e2e.jsonl'),
    });
    const realLog = console.log;
    console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[forge-bridge] craft result')) lines.push(a[0]); realLog(...a); };
    restoreLog = () => { console.log = realLog; };
    const { bot, ids } = world;
    const c = world.containers();
    const st = c.state;
    const { Recipe } = require('prismarine-recipe')(bot.registry);
    const cobbleRecipe = new Recipe({ ingredients: [ids[ROCK], ids[ROCK], ids[ROCK], ids[ROCK]], result: { id: ids[COBBLE], count: 1, metadata: 0 } });
    const planksRecipe = new Recipe({ ingredients: [ids[LOG]], result: { id: ids[PLANKS], count: 4, metadata: 0 } });
    assert.equal(cobbleRecipe.requiresTable, false);
    const events = [];
    bot.on('craftResultDropped', (ev) => events.push(ev));
    const settled = async () => {
        for (let w = 0; inventoryDiff(bot.inventory, st).length && w < 3000; w += 20) await sleep(20);
        assert.deepEqual(inventoryDiff(bot.inventory, st), [], 'the bot\'s view matches the server');
    };
    const setAll = async (stacks) => {
        c.setInventory(Object.fromEntries(Object.entries(full(stacks)).map(([s, x]) => [s, { id: ids[x.name], count: x.count, meta: 0 }])));
        for (let w = 0; (inventoryDiff(bot.inventory, st).length || bot.inventory.slots[9]?.name !== 'dirt') && w < 3000; w += 20) await sleep(20);
        await settled();
    };
    const thrownOf = (name) => st.thrown.filter(t => t.id === ids[name]);
    await settled();
    assert.equal(bot.inventory.emptySlotCount(), 0, 'slots 9-44 are full');

    // 1. Soak 18's shape: 5 rocks, 4 used, the 5th back in its slot; no slot for the cobblestone.
    await within(20000, bot.craft(cobbleRecipe, 1, null), 'craft');
    await settled();
    assert.equal(c.count(ids[COBBLE]), 0, 'the cobblestone is not in the inventory');
    assert.equal(bot.inventory.count(ids[COBBLE]), 0);
    assert.deepEqual(st.inv[36], { id: ids[ROCK], count: 1, meta: 0 }, 'the 5th rock is back in its slot');
    assert.deepEqual(thrownOf(COBBLE).map(t => [t.windowId, t.count]), [[0, 1]], 'the server threw the cobblestone out of the cursor (slot -999)');
    assert.equal(st.cursor, null);
    assert.deepEqual(st.rejected, []);
    assert.equal(events.length, 1);
    const pos = bot.entity.position.floored();
    assert.deepEqual({ ...events[0], position: { ...events[0].position } }, {
        windowId: 0, windowType: 'minecraft:inventory', result: 'cobblestone x1', name: 'cobblestone', metadata: 0, count: 1, thrown: 1,
        position: { x: pos.x, y: pos.y, z: pos.z },
    }, 'the event skills can read');
    assert.deepEqual(lines, [`[forge-bridge] craft result cobblestone x1: thrown on the ground at ${pos.x}, ${pos.y}, ${pos.z} (window 0, minecraft:inventory): no inventory slot had room`]);

    // 2. The control: a cobblestone stack with room. The result joins it, and there is no line.
    await setAll({ 36: { name: ROCK, count: 5 }, 20: { name: COBBLE, count: 10 } });
    await within(20000, bot.craft(cobbleRecipe, 1, null), 'craft');
    await settled();
    assert.equal(c.count(ids[COBBLE]), 11, 'the cobblestone joined the stack');
    assert.equal(thrownOf(COBBLE).length, 1, 'nothing more thrown');
    assert.equal(events.length, 1);
    assert.equal(lines.length, 1, 'no line');

    // 3. Part of it: planks x4 with one planks stack at 126 and 2 logs (1 back in its slot). 2 join, 2 are thrown.
    await setAll({ 36: { name: LOG, count: 2 }, 21: { name: PLANKS, count: 126 } });
    await within(20000, bot.craft(planksRecipe, 1, null), 'craft');
    await settled();
    assert.equal(c.count(ids[PLANKS]), 128, '2 planks joined the stack');
    assert.deepEqual(thrownOf(PLANKS).map(t => t.count), [2], '2 planks thrown');
    assert.equal(events.length, 2);
    assert.equal(events[1].count, 4);
    assert.equal(events[1].thrown, 2);
    assert.match(lines[1], /^\[forge-bridge\] craft result planks x4: 2 into the inventory, 2 thrown on the ground at -?\d+, -?\d+, -?\d+ \(window 0, minecraft:inventory\): no inventory slot had room for them$/);
    assert.deepEqual(st.rejected, []);
});
