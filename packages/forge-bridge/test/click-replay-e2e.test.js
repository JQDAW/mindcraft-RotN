// The fake-server task (/home/rv/fake-forge-server-plan.md): soak 15's window clicks replayed through
// Mindcraft's real initBot and mineflayer's real bot.clickWindow against the fake Forge server, whose
// window model follows the 1.12.2 / Forge bytecode (fake-containers.js) with the pack's StackUp sizes
// from rotn-data's dump. Loopback only.
//
// Cases A, B and C (/home/rv/soak15-net-forge-clicks.md): with #618's sizes the client predicts each
// click as the server does it; with the registry's old 64 the same click is accepted, the views part
// silently, and the next click on that slot is rejected, as in soak 15. Then the 2x2 grid's return on
// a close of window 0, #619's returnGrid with no phantom cursor, and a number-key swap.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpFile } from './helpers.js';
import { startRotnWorld, stopCraftWorld, within } from './craft-world.js';
import { inventoryDiff } from './fake-containers.js';

const PILE = 'betterwithmods:dirt_pile';
const ROCK = 'pyrotech:rock';
let world;
after(() => stopCraftWorld(world ?? {}));

test('soak 15 clicks through real mineflayer: cases A, B and C with and without #618; the grid return; returnGrid; a number-key swap', { timeout: 60000 }, async () => {
    world = await startRotnWorld({
        itemNames: [PILE, ROCK, 'minecraft:cobblestone', 'minecraft:planks', 'minecraft:stone_pickaxe', 'minecraft:stick'],
        inventory: { 36: { name: 'minecraft:planks', count: 1 } },
        recipes: [{ shapeless: [ROCK, ROCK, ROCK, ROCK], result: 'minecraft:cobblestone' }],
        captureFile: tmpFile('click-replay.jsonl'),
    });
    const { bot, ids } = world;
    const c = world.containers();
    const st = c.state;
    const P = ids[PILE], R = ids[ROCK];
    // mineflayer 4.33 ignores the server's cursor packet; the agent follows it (skills-rotn's
    // inventory_sync, from agent.js's guardInventory). The same here, without the guard's retries.
    const { followServerCursor, returnGrid } = await import('../../../src/agent/library/inventory_sync.js');
    followServerCursor(bot);
    // initBot logs the click-rejected lines with console.log; collect them.
    const lines = [];
    const realLog = console.log;
    console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[forge-bridge] click rejected:')) lines.push(a[0]); realLog(...a); };
    after(() => { console.log = realLog; });

    const click = async (slot, button = 0, mode = 0) => {
        try { await within(5000, bot.clickWindow(slot, button, mode), `click ${slot}`); return 'accepted'; } catch (e) {
            if (/Server rejected transaction/.test(e.message)) return 'rejected';
            throw e;
        }
    };
    // The server's window 0 and cursor, resent; wait until mineflayer shows them.
    const reset = async (slots, cursor = null) => {
        const byId = Object.fromEntries(Object.entries(slots).map(([s, x]) => [s, { id: ids[x.name], count: x.count }]));
        c.setInventory(byId, cursor ? { id: ids[cursor.name], count: cursor.count } : null);
        for (let w = 0; inventoryDiff(bot.inventory, st).length && w < 3000; w += 20) await sleep(20);
        assert.deepEqual(inventoryDiff(bot.inventory, st), [], 'in step after the resend');
    };
    const view = (slot) => ({ slot: bot.inventory.slots[slot]?.count ?? 0, cursor: bot.inventory.selectedItem?.count ?? 0 });
    const server = (slot) => ({ slot: st.inv[slot]?.count ?? 0, cursor: st.cursor?.count ?? 0 });
    assert.equal(bot.registry.items[P].stackSize, 256, '#618: the dump\'s size in bot.registry');
    assert.equal(c.serverView().slots.length, 46);

    // With #618 (the dump's sizes on both sides): A, B and C as the server does them, all accepted.
    const rejectedBefore = st.rejected.length;
    await reset({ 20: { name: PILE, count: 60 }, 21: { name: PILE, count: 12 } });
    assert.equal(await click(21), 'accepted'); // pick up 12
    assert.equal(await click(20), 'accepted'); // A: put them onto 60
    assert.deepEqual([view(20), server(20)], [{ slot: 72, cursor: 0 }, { slot: 72, cursor: 0 }], 'A');
    await reset({ 11: { name: PILE, count: 72 }, 12: { name: PILE, count: 4 } });
    await click(12);
    assert.equal(await click(11), 'accepted'); // B: 4 onto 72
    assert.deepEqual([view(11), server(11)], [{ slot: 76, cursor: 0 }, { slot: 76, cursor: 0 }], 'B');
    await reset({ 11: { name: PILE, count: 72 }, 12: { name: PILE, count: 10 } });
    await click(12);
    assert.equal(await click(11, 1), 'accepted'); // C: right-click one onto 72
    assert.deepEqual([view(11), server(11)], [{ slot: 73, cursor: 9 }, { slot: 73, cursor: 9 }], 'C');
    assert.deepEqual(inventoryDiff(bot.inventory, st), []);
    assert.equal(st.rejected.length, rejectedBefore, 'no rejection with #618');

    // Without #618 (the registry's 64, as before it): the same clicks part the views silently, and the
    // next click on the phantom stack is rejected (soak 15's slot-11 chain).
    const entry = bot.registry.items[P];
    bot.registry.items[P] = { ...entry, stackSize: 64 };
    try {
        await reset({ 20: { name: PILE, count: 60 }, 21: { name: PILE, count: 12 } });
        await click(21);
        assert.equal(await click(20), 'accepted', 'A is accepted: slot 20 held 60 on both sides');
        assert.deepEqual([view(20), server(20)], [{ slot: 64, cursor: 8 }, { slot: 72, cursor: 0 }], 'A without #618: a phantom 8 on the cursor');
        assert.deepEqual(inventoryDiff(bot.inventory, st), ['slot 20: client ' + P + 'x64, server ' + P + 'x72', 'cursor: client ' + P + 'x8, server -']);
        assert.equal(await click(22), 'accepted', 'the phantom put down: a no-op on the server');
        const rejections = st.rejected.length;
        assert.equal(await click(22), 'rejected', 'picking up the phantom stack');
        assert.equal(st.rejected.length, rejections + 1);
        for (let w = 0; !lines.length && w < 2000; w += 20) await sleep(20);
        assert.match(lines.at(-1), new RegExp(`^\\[forge-bridge\\] click rejected: window 0 slot 22 \\(mode 0, button 0, action \\d+\\); client before the click: slot ${PILE} x8, cursor -, grid \\[-, -, -, -\\]; server after it: slot -, cursor -, grid \\[-, -, -, -\\]$`));
        for (let w = 0; inventoryDiff(bot.inventory, st).length && w < 2000; w += 20) await sleep(20);
        assert.deepEqual(inventoryDiff(bot.inventory, st), [], 'the resend after the rejection puts them back in step');

        await reset({ 11: { name: PILE, count: 72 }, 12: { name: PILE, count: 4 } });
        await click(12);
        await click(11);
        assert.deepEqual([view(11), server(11)], [{ slot: 64, cursor: 12 }, { slot: 76, cursor: 0 }], 'B without #618');
        await reset({ 11: { name: PILE, count: 72 }, 12: { name: PILE, count: 10 } });
        await click(12);
        await click(11, 1);
        assert.deepEqual([view(11), server(11)], [{ slot: 72, cursor: 10 }, { slot: 73, cursor: 9 }], 'C without #618');
    } finally {
        bot.registry.items[P] = entry;
    }

    // The 2x2 grid's return: two rocks left in the grid (as after a failed craft), then the client's
    // close of window 0. The server puts them on the held stack (storeItemStack: the held slot first),
    // sends set_slot window -2 (ignored by mineflayer) and, a tick later, the window-0 slots.
    await reset({ 1: { name: ROCK, count: 1 }, 2: { name: ROCK, count: 1 }, 36: { name: ROCK, count: 5 }, 20: { name: ROCK, count: 3 } });
    bot.setQuickBarSlot(0);
    await sleep(50);
    bot._client.write('close_window', { windowId: 0 });
    for (let w = 0; (bot.inventory.slots[1] || bot.inventory.slots[2]) && w < 2000; w += 20) await sleep(20);
    assert.deepEqual([st.inv[1], st.inv[2], st.inv[36]?.count, st.inv[20]?.count], [null, null, 7, 3], 'onto the held stack, not slot 20');
    assert.deepEqual(st.returned.map(r => [r.slot, r.count]), [[36, 1], [36, 1]]);
    assert.deepEqual(inventoryDiff(bot.inventory, st), [], 'the client sees the grid empty and the held stack at 7');

    // A cursor stack at the close is dropped on the server, with no packet: the client keeps a phantom.
    await reset({ 1: { name: ROCK, count: 1 } }, { name: 'minecraft:stick', count: 2 });
    bot._client.write('close_window', { windowId: 0 });
    for (let w = 0; bot.inventory.slots[1] && w < 2000; w += 20) await sleep(20);
    assert.deepEqual(st.dropped.at(-1), { id: ids['minecraft:stick'], count: 2, meta: 0, why: 'cursor' });
    assert.equal(st.cursor, null);
    assert.equal(bot.inventory.selectedItem?.name, 'stick', 'the phantom cursor the server never reports');

    // #619's returnGrid (skills-rotn) after a craft rejected part-way: no phantom, nothing dropped.
    await reset({ 36: { name: ROCK, count: 8 } });
    st.inv[4] = { id: R, count: 1, meta: 0 }; // a leftover the client does not know: the craft's first grid click (slot 4) is rejected
    const { Recipe } = (await import('prismarine-recipe')).default(bot.registry);
    const cobble = new Recipe({ ingredients: [R, R, R, R], result: { id: ids['minecraft:cobblestone'], count: 1, metadata: 0 } });
    await assert.rejects(within(10000, bot.craft(cobble, 1, null), 'craft'), /Server rejected transaction/);
    for (let w = 0; !bot.inventory.slots[4] && w < 2000; w += 20) await sleep(20);
    assert.ok(bot.inventory.slots[4] || bot.inventory.selectedItem, 'after the resend the client sees the grid or cursor');
    const dropsBefore = st.dropped.length;
    const r = await returnGrid(bot, 'test');
    assert.ok(r, 'returnGrid acted');
    for (let w = 0; inventoryDiff(bot.inventory, st).length && w < 2000; w += 20) await sleep(20);
    assert.deepEqual(inventoryDiff(bot.inventory, st), [], 'no phantom: the client and the server agree');
    assert.equal(bot.inventory.selectedItem, null);
    assert.equal(st.dropped.length, dropsBefore, 'nothing dropped');
    assert.equal(c.count(R), 8 + 1, 'every rock is back in the inventory (and the leftover with them)');

    // A number-key swap (mode 2, skills' equipToHand) is never rejected and never echoed: predicted
    // right, the views agree; with a stack on the cursor, mineflayer predicts nothing while the server
    // swaps anyway, and only a comparison of the views shows it.
    await reset({ 20: { name: 'minecraft:stone_pickaxe', count: 1 }, 36: { name: 'minecraft:planks', count: 1 } });
    assert.equal(await click(20, 0, 2), 'accepted');
    assert.deepEqual([bot.inventory.slots[36]?.name, st.inv[36]?.id], ['stone_pickaxe', ids['minecraft:stone_pickaxe']]);
    assert.deepEqual(inventoryDiff(bot.inventory, st), []);
    await reset({ 20: { name: 'minecraft:stone_pickaxe', count: 1 }, 36: { name: 'minecraft:planks', count: 1 } }, { name: 'minecraft:stick', count: 1 });
    assert.equal(await click(20, 0, 2), 'accepted');
    assert.deepEqual(inventoryDiff(bot.inventory, st).sort(), [`slot 20: client ${ids['minecraft:stone_pickaxe']}x1, server ${ids['minecraft:planks']}x1`, `slot 36: client ${ids['minecraft:planks']}x1, server ${ids['minecraft:stone_pickaxe']}x1`].sort());
    assert.ok(st.swaps.length >= 2);
});

test('known gap: mineflayer builds prismarine-windows from bot.version, so a stack it splits off itself has the plain 1.12.2 size', { todo: 'mineflayer inventory.js: prismarine-windows(bot.version) instead of bot.registry (a one-line patch, not in this PR)', timeout: 30000 }, async () => {
    const { bot, ids } = world;
    const c = world.containers();
    const P = ids[PILE];
    c.setInventory({ 11: { id: P, count: 40 } });
    for (let w = 0; bot.inventory.slots[11]?.count !== 40 && w < 2000; w += 20) await sleep(20);
    await within(5000, bot.clickWindow(11, 1, 0), 'split'); // right-click: half onto the cursor, made by prismarine-windows
    await within(5000, bot.clickWindow(12, 0, 0), 'put down');
    await within(5000, bot.clickWindow(11, 0, 0), 'pick up the rest');
    await within(5000, bot.clickWindow(12, 0, 0), 'merge onto the split stack');
    assert.deepEqual(inventoryDiff(bot.inventory, c.state), [], 'the split stack merges as the server does');
});
