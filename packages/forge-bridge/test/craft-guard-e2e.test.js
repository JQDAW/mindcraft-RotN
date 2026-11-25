// Soak 16's rejected craft (/home/rv/soak16-net-forge-recipe.md) through Mindcraft's real initBot and
// mineflayer's real bot.craft, against the fake Forge server. Loopback only.
//
// 9 sticks in the 3x3 grid are two pack recipes: AncientBeasts' stick_wall and DungeonTactics'
// planks_from_sticks. The server makes the first in its registry, the stick wall. mineflayer 4.33 wrote
// the chosen recipe's result (planks x1) into slot 0 and clicked it: the server took the stick wall,
// used up the 9 sticks and rejected the click. patches/mineflayer (craft.js grabResult) now takes the
// server's slot 0: another item is never clicked, the same item with another count is taken as the
// server has it, and an empty slot 0 throws after 500 ms.
// The client's recipes are built here (prismarine-recipe), not taken from the installed RotN recipes:
// this tests the guard, whatever rotn-data offers (#639 drops planks_from_sticks from bot.recipesFor).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpFile } from './helpers.js';
import { startRotnWorld, stopCraftWorld, within, TABLE } from './craft-world.js';
import { inventoryDiff } from './fake-containers.js';

const require = createRequire(import.meta.url);
const Vec3 = require('vec3');
const STICK = 'minecraft:stick';
const PLANKS = 'minecraft:planks';
const WALL = 'ancientbeasts:stick_wall';
let world;
after(() => stopCraftWorld(world ?? {}));

test('soak 16: a grid the server makes into another item is never clicked; the sticks stay; the server\'s count is taken; an empty result throws (patches/mineflayer craft.js)', { timeout: 60000 }, async () => {
    const nine = Array.from({ length: 3 }, () => [STICK, STICK, STICK]);
    world = await startRotnWorld({
        itemNames: [STICK, PLANKS, WALL],
        inventory: { 36: { name: STICK, count: 21 } },
        // The server's registry order: the stick wall first (soak 16), then planks_from_sticks.
        recipes: [{ shaped: nine, result: WALL }, { shaped: nine, result: PLANKS }],
        captureFile: tmpFile('craft-guard.jsonl'),
    });
    const { bot, ids } = world;
    const c = world.containers();
    const st = c.state;
    const lines = [];
    const realLog = console.log;
    console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[forge-bridge] craft refused:')) lines.push(a[0]); realLog(...a); };
    after(() => { console.log = realLog; });
    const { returnGrid } = await import('../../../src/agent/library/inventory_sync.js');
    const tableBlock = bot.blockAt(new Vec3(TABLE.x, TABLE.y, TABLE.z));
    const craft = (recipe, table) => within(20000, bot.craft(recipe, 1, table), 'craft').then(() => null, (e) => e);
    const inStep = async () => {
        for (let w = 0; (st.tableWindow || inventoryDiff(bot.inventory, st).length) && w < 3000; w += 20) await sleep(20);
        assert.equal(st.tableWindow, null, 'the table window is closed');
        assert.deepEqual(inventoryDiff(bot.inventory, st), [], 'the bot\'s view matches the server');
    };
    const resultClicks = () => st.clicks.filter(k => k.slot === 0 && k.mode === 0);

    // The client's recipes: DungeonTactics' planks_from_sticks as soak 16's bot had it (9 sticks, 3x3,
    // planks x1), and AncientBeasts' stick_wall (the same grid).
    const { Recipe } = require('prismarine-recipe')(bot.registry);
    const sticks9 = nine.map(row => row.map(() => ids[STICK]));
    const planks = new Recipe({ inShape: sticks9, result: { id: ids[PLANKS], count: 1, metadata: 0 } });
    assert.equal(planks.requiresTable, true);

    // Without the craft.js patch: "Server rejected transaction for clicking on slot 0", 9 sticks used up,
    // the stick wall dropped.
    const err = await craft(planks, tableBlock);
    for (let w = 0; st.tableWindow && w < 3000; w += 20) await sleep(20);
    assert.equal(c.count(ids[STICK]), 21, `the 9 sticks are back in the inventory (the table's close); ${err?.message}`);
    assert.deepEqual(st.dropped, [], 'nothing dropped (without the patch: the stick wall on the cursor, dropped by the close)');
    assert.deepEqual(resultClicks(), [], 'no click on slot 0');
    assert.deepEqual(st.rejected, []);
    assert.match(String(err?.message), /crafting: the server makes ancientbeasts:stick_wall x1 from this grid, not planks x1/);
    assert.doesNotMatch(String(err?.message), /Server rejected transaction|Server didn't respond to transaction/, 'not inventory_sync\'s REJECTED: no guard retry');
    await inStep();
    assert.equal(c.count(ids[WALL]), 0);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[forge-bridge\] craft refused: window \d+ \(minecraft:crafting[^)]*\): the server makes ancientbeasts:stick_wall x1 from this grid, not planks x1; nothing taken$/);

    // The recipe the server does make: accepted and taken as before.
    const wall = new Recipe({ inShape: sticks9, result: { id: ids[WALL], count: 1, metadata: 0 } });
    assert.equal(await craft(wall, tableBlock), null);
    await inStep();
    assert.deepEqual([c.count(ids[STICK]), c.count(ids[WALL])], [12, 1]);

    // The same item with another count (a recipe that says 2, the server makes 1): the server's stack
    // is clicked, so the click is accepted (develop sent x2 and was rejected).
    const wallTwo = new Recipe({ inShape: sticks9, result: { id: ids[WALL], count: 2, metadata: 0 } });
    assert.equal(await craft(wallTwo, tableBlock), null);
    await inStep();
    assert.deepEqual([c.count(ids[STICK]), c.count(ids[WALL])], [3, 2], 'one wall made, as the server says');
    assert.deepEqual(st.rejected, []);
    assert.equal(resultClicks().length, 2, 'only the two crafts the server makes clicked slot 0');

    // A grid with no server recipe (2 sticks side by side in the 2x2): no click on slot 0, an error after
    // about 500 ms, and the grid back through returnGrid (#619).
    const pair = new Recipe({ inShape: [[ids[STICK], ids[STICK]]], result: { id: ids[PLANKS], count: 1, metadata: 0 } });
    assert.equal(pair.requiresTable, false);
    const t0 = Date.now();
    const none = await craft(pair, null);
    assert.match(String(none?.message), /crafting: the server has no result for this grid \(expected planks x1\)/);
    assert.ok(Date.now() - t0 >= 450, `waited for slot 0 (${Date.now() - t0} ms)`);
    assert.equal(resultClicks().length, 2, 'no click on slot 0');
    assert.match(lines.at(-1), /^\[forge-bridge\] craft refused: window 0 \(minecraft:inventory\): the server has no result for this grid, expected planks x1; nothing taken$/);
    await returnGrid(bot, 'test');
    await inStep();
    assert.equal(c.count(ids[STICK]), 3, 'the 2 sticks are back from the 2x2 grid');
    assert.deepEqual(st.rejected, []);
});
