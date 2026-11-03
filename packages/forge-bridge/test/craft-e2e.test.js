// Offline end-to-end for skills-rotn Request 2: Mindcraft's real initBot, through
// forge-bridge and REID, crafts in the 2x2 grid and at RotN's crafting table
// (FastWorkbench, opened with FML OpenGui), places a block and eats, against the
// in-process fake Forge server plus fake-containers.js (a model of the 1.12.2 server
// code read with javap). Item ids are the real Run A ids. Loopback only.
//
// The recipes are built the way skills-rotn's C1 will build them: prismarine-recipe
// objects from rotn-data's recipes (rock, sticks, Crafting Tools, ...), passed to bot.craft.

import process from 'node:process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpFile, runARegistries } from './helpers.js';
import { readCapture } from '../src/capture.js';
import { I, TABLE, within, startCraftWorld, stopCraftWorld } from './craft-world.js';

const require = createRequire(import.meta.url);
const Vec3 = require('vec3');

let world;
after(() => stopCraftWorld(world));

test('crafts in the 2x2 grid and at the FastWorkbench table, places a block and eats, through initBot', { timeout: 240000 }, async () => {
    assert.equal(runARegistries().get('minecraft:blocks').overrides.get('minecraft:crafting_table'), 'fastbench');
    const captureFile = tmpFile('craft-capture.jsonl');
    world = await startCraftWorld({ captureFile });
    const { bot } = world;
    const containers = world.containers();
    assert.equal(bot.registry.items[I.crudeAxe]?.name, 'pyrotech:crude_axe', 'modded names from the registry sync');
    assert.equal(bot.inventory.slots[36]?.type, I.rock);
    const { Recipe } = require('prismarine-recipe')(bot.registry);
    const st = containers.state;
    // On failure, show the server model's view (rejected clicks, slots, cursor) next to mineflayer's.
    const craftOrExplain = async (run, what) => {
        try { await within(30000, run(), what); } catch (e) {
            const local = bot.inventory.slots.map((s, i) => s && `${i}:${s.type}x${s.count}`).filter(Boolean).join(' ');
            throw new Error(`${what}: ${e.message}
rejected: ${JSON.stringify(st.rejected)}
server slots: ${JSON.stringify(st.inv)}
cursor: ${JSON.stringify(st.cursor)}
bot slots: ${local}
clicks: ${JSON.stringify(st.clicks.map(c => [c.windowId, c.slot, c.mouseButton, c.item.blockId, c.item.itemCount]))}`);
        }
    };

    // 2x2: crude axe (shaped), Crafting Tools and the crafting table (shapeless).
    const crudeAxe = new Recipe({ inShape: [[I.rock, I.stick], [I.stick, null]], result: { id: I.crudeAxe, count: 1, metadata: 0 } });
    assert.equal(crudeAxe.requiresTable, false);
    await craftOrExplain(() => bot.craft(crudeAxe, 1, null), 'craft crude axe');
    const tools = new Recipe({ ingredients: [I.crudeAxe, I.rock, I.stick], result: { id: I.craftingTools, count: 1, metadata: 0 } });
    await craftOrExplain(() => bot.craft(tools, 1, null), 'craft Crafting Tools');
    const tableRecipe = new Recipe({ ingredients: [I.planks, I.craftingTools], result: { id: I.table, count: 1, metadata: 0 } });
    await craftOrExplain(() => bot.craft(tableRecipe, 1, null), 'craft crafting table');
    assert.deepEqual([containers.count(I.crudeAxe), containers.count(I.craftingTools), containers.count(I.table)], [0, 0, 1], 'server-side inventory after the 2x2 crafts');
    assert.equal(containers.count(I.rock), 3);

    // The FastWorkbench table: activateBlock -> FML OpenGui -> synthetic open_window -> 3x3 craft.
    const tableBlock = bot.blockAt(new Vec3(TABLE.x, TABLE.y, TABLE.z));
    assert.equal(tableBlock.name, 'crafting_table');
    const pickaxe = new Recipe({ inShape: [[I.rock, I.rock, I.rock], [null, I.stick, null], [null, I.stick, null]], result: { id: I.stonePickaxe, count: 1, metadata: 0 } });
    assert.equal(pickaxe.requiresTable, true);
    await craftOrExplain(() => bot.craft(pickaxe, 1, tableBlock), 'craft stone pickaxe at the FastWorkbench table');
    assert.equal(containers.count(I.stonePickaxe), 1, 'stone pickaxe in the server-side inventory');
    assert.equal(containers.count(I.rock), 0);
    assert.equal(bot.forge.bridge.stats.modWindows, 1);
    // bot.craft writes close_window last; wait for it to reach the server.
    for (let waited = 0; st.tableWindow && waited < 5000; waited += 50) await sleep(50);
    assert.equal(st.tableWindow, null, 'the bot closed the table window');
    assert.equal(st.closedTableGrid, 0, 'nothing left in the table grid');
    assert.equal(bot.inventory.slots.filter(Boolean).find(s => s.type === I.stonePickaxe)?.name, 'stone_pickaxe');

    // Every click was accepted on the first try (the clicked item matched the server's stack).
    assert.deepEqual(st.rejected, []);
    assert.deepEqual(st.unsupported, []);
    assert.deepEqual(st.ignored, []);
    assert.ok(st.clicks.length >= 15, `${st.clicks.length} clicks`);

    // Place cobblestone on the floor; the server confirms it with block_change.
    await bot.equip(bot.inventory.items().find(i => i.type === I.cobble), 'hand');
    const floor = bot.blockAt(new Vec3(6, 64, 6));
    await within(10000, bot.placeBlock(floor, new Vec3(0, 1, 0)), 'placeBlock');
    assert.equal(bot.blockAt(new Vec3(6, 65, 6)).name, 'cobblestone');
    assert.deepEqual(st.placed.map(p => p.target), [{ x: 6, y: 65, z: 6 }]);
    assert.equal(containers.count(I.cobble), 7);

    // Eat bread: use_item with the main hand, finished by entity_status 9. The bot starts at
    // food 20 so that mineflayer-auto-eat (loaded by initBot) stays idle during the crafts;
    // here it is turned off so that bot.consume() is the only eater.
    bot.autoEat.disable();
    containers.setFood(15);
    for (let waited = 0; bot.food !== 15 && waited < 5000; waited += 50) await sleep(50);
    await bot.equip(bot.inventory.items().find(i => i.type === I.bread), 'hand');
    await within(10000, bot.consume(), 'consume');
    assert.deepEqual(st.uses.map(u => u.hand), [0]);
    assert.equal(st.food, 20);
    assert.equal(containers.count(I.bread), 1);

    // The capture records the clicks, transactions and the mod window for live debugging.
    bot.quit();
    await sleep(300);
    const cap = readCapture(captureFile);
    const named = (dir, name) => cap.filter(l => l.kind === 'packet' && l.dir === dir && l.name === name).length;
    assert.ok(named('C2S', 'window_click') >= 15);
    assert.ok(named('S2C', 'transaction') >= 15);
    assert.ok(named('C2S', 'block_place') >= 2);
    assert.ok(cap.some(l => l.kind === 'event' && l.name === 'mod_window' && l.modId === 'fastbench'));
    assert.ok(!JSON.stringify(cap).includes('FRCFLD'), 'username redacted');
});
