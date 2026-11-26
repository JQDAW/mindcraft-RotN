// Soak 17, 18:03:58 (/home/rv/soak17-net-forge.md): "[forge-bridge] click rejected: window 0 slot 31 (mode 0, ...);
// client before the click: slot stone_pickaxe:79 x1 ...; server after it: ... cursor stone_pickaxe:80 x1". The
// escape dug with the pickaxe, then at once equipped a block (skills-rotn's equipToHand: a mode-2 swap, the
// pickaxe into slot 31), then rearmWeapon put the pickaxe in the off hand (mineflayer's moveSlotItem: a mode-0 click
// on slot 31 carrying the pickaxe). The STOP and the swap ran in the same server tick, and the accepted swap's
// quantity-only detectAndSendChanges recorded the new damage as sent without sending it.
// Here the same three steps run through Mindcraft's real initBot, mineflayer (with the patch's dig-click hold) and
// skills-rotn's real equipToHand against the fake server with its tick (fake-tick.js) and tool damage. Without the
// hold (develop's mineflayer) the off-hand equip is rejected with the client one behind; with it nothing is.
// Loopback only.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { tmpFile } from './helpers.js';
import { startRotnWorld, stopCraftWorld, within } from './craft-world.js';
import { inventoryDiff } from './fake-containers.js';

const require = createRequire(import.meta.url);
const Vec3 = require('vec3');
let world;
after(() => { world?.tick?.()?.stop(); return stopCraftWorld(world ?? {}); });

test('a click right after a dig waits for the server\'s answer: the pickaxe\'s damage arrives first, and no click is rejected', { timeout: 60000 }, async () => {
    const at = (x) => ({ x, y: 64, z: 6 });
    // A full hotbar (the pickaxe and eight planks), the block to pillar with in slot 31.
    const hotbar = (pickMeta) => ({
        36: { name: 'minecraft:stone_pickaxe', count: 1, meta: pickMeta },
        ...Object.fromEntries([37, 38, 39, 40, 41, 42, 43, 44].map(s => [s, { name: 'minecraft:planks', count: 1 }])),
        31: { name: 'minecraft:cobblestone', count: 8 },
    });
    world = await startRotnWorld({
        itemNames: ['minecraft:planks', 'minecraft:stone_pickaxe', 'minecraft:cobblestone'],
        inventory: hotbar(10),
        digBlocks: [8, 9, 10].map(x => ({ ...at(x), name: 'minecraft:stone' })),
        serverTick: true,
        captureFile: tmpFile('dig-click-e2e.jsonl'),
    });
    const { bot, ids } = world;
    const c = world.containers();
    const dig = world.dig();
    const tick = world.tick();
    const { followServerCursor, equipToHand } = await import('../../../src/agent/library/inventory_sync.js');
    followServerCursor(bot);
    const block = (x, z = 6) => bot.blockAt(new Vec3(x, 64, z));
    const until = async (ok, ms = 3000) => { for (let w = 0; !ok() && w < ms; w += 20) await sleep(20); return ok(); };
    const id = (name) => ids[`minecraft:${name}`];
    const tickOf = (what) => tick.state.log.find(t => t.packets.includes(what))?.tick ?? null;
    bot.setQuickBarSlot(0);
    assert.ok(await until(() => bot.entity.onGround && bot.heldItem?.name === 'stone_pickaxe', 5000), 'on the floor, the pickaxe held');

    // Soak 17's three steps: the dig, the pillar's equip of the cobblestone (a mode-2 swap with the pickaxe's
    // hotbar slot), rearmWeapon's off-hand equip of the pickaxe (a mode-0 click on slot 31 carrying it).
    await within(5000, bot.dig(block(10), true), 'dig');
    await equipToHand(bot, bot.equip, [bot.inventory.slots[31], 'hand']);
    assert.equal(bot.inventory.slots[31]?.name, 'stone_pickaxe', 'the swap put the pickaxe into slot 31');
    await within(8000, bot.equip(bot.inventory.slots[31], 'off-hand'), 'off-hand equip');
    assert.equal(dig.state.digs.at(-1).outcome, 'broken', 'the server broke the block at the STOP');
    assert.deepEqual(c.state.rejected.map(r => `slot ${r.click.slot}: client ${r.click.item?.itemDamage}, server ${r.server?.meta}`), [], 'no click rejected');
    const stop = tickOf('block_dig 2');
    const swap = tickOf('window_click 31 mode 2');
    assert.ok(stop !== null && swap !== null && swap > stop, `the swap ran in a later tick than the STOP (${stop}, ${swap}): ${JSON.stringify(tick.state.log)}`);
    assert.deepEqual(c.state.inv[45], { id: id('stone_pickaxe'), count: 1, meta: 11 }, 'the server: the pickaxe in the off hand, damage 11');
    assert.equal(bot.inventory.slots[45]?.metadata, 11, 'the client has the same damage');
    assert.deepEqual(inventoryDiff(bot.inventory, c.state), []);

    // The same with the block sent as a multi_block_change (a server batches the changes of one chunk section).
    dig.state.multiBlockChange = true;
    c.setInventory(Object.fromEntries(Object.entries(hotbar(11)).map(([s, st]) => [s, { id: ids[st.name], count: st.count, meta: st.meta ?? 0 }])));
    assert.ok(await until(() => bot.heldItem?.name === 'stone_pickaxe' && bot.heldItem.metadata === 11 && bot.inventory.slots[31]?.name === 'cobblestone'));
    await within(5000, bot.dig(block(9), true), 'dig');
    await equipToHand(bot, bot.equip, [bot.inventory.slots[31], 'hand']);
    await within(8000, bot.equip(bot.inventory.slots[31], 'off-hand'), 'off-hand equip');
    assert.equal(dig.state.digs.at(-1).outcome, 'broken');
    assert.deepEqual(c.state.rejected, [], 'no click rejected');
    assert.equal(c.state.inv[45]?.meta, 12);
    assert.equal(bot.inventory.slots[45]?.metadata, 12);
    assert.deepEqual(inventoryDiff(bot.inventory, c.state), []);

    // A dig the server never answers (a block it does not know: no block update comes): the next click waits
    // the cap, 500 ms, and then goes. A click with no dig before it does not wait.
    dig.state.multiBlockChange = false;
    c.setInventory(Object.fromEntries(Object.entries(hotbar(12)).map(([s, st]) => [s, { id: ids[st.name], count: st.count, meta: st.meta ?? 0 }])));
    assert.ok(await until(() => bot.heldItem?.name === 'stone_pickaxe' && bot.heldItem.metadata === 12));
    assert.equal(block(8, 7).name, 'stone', 'the client sees stone at 8, 64, 7; the server has no block there');
    await within(5000, bot.dig(block(8, 7), true), 'dig');
    let t0 = Date.now();
    await bot.clickWindow(30, 0, 0); // an empty slot, an empty cursor: nothing moves
    const capped = Date.now() - t0;
    assert.ok(capped >= 450, `held about 500 ms: ${capped} ms`);
    t0 = Date.now();
    await bot.clickWindow(30, 0, 0);
    const free = Date.now() - t0;
    assert.ok(free < capped, `no hold without a dig: ${free} ms (the capped one ${capped} ms)`);
    assert.deepEqual(c.state.rejected, []);
});
