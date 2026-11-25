// Soak 15: a dig the Forge rule refuses (bot.dig's "dig time for X is Infinity") logs the block, the
// held item and where every tool of the block's class is, once per block and position. Run on
// mineflayer's real digging plugin with the rule from the real dump installed, as initBot does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { attachDigTime, dumpDigSources } from '../src/dig-time.js';
import { attachDigRefusedLog, digRefusedLine, slotPlace } from '../src/dig-refused.js';
import * as rotnData from '../../rotn-data/index.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const rd = rotnData.loadRotnData(rotnData.PACK_VERSION);

/** A fake bot over one column (stone at 8,64,8 and 9,64,8; dirt at 10,64,8), the Forge rule, mineflayer's digging plugin. */
function fakeBot({ logs = [] } = {}) {
    const registry = require('prismarine-registry')('1.12.2');
    const Item = require('prismarine-item')(registry);
    const Chunk = require('prismarine-chunk')(registry);
    const chunk = new Chunk();
    for (const [x, name] of [[8, 'stone'], [9, 'stone'], [10, 'dirt']]) chunk.setBlockType(new Vec3(x, 64, 8), registry.blocksByName[name].id);
    const bot = new EventEmitter();
    bot.registry = registry;
    bot.blockAt = (pos) => { const b = chunk.getBlock(pos); b.position = pos.clone(); return b; };
    bot.entity = { position: new Vec3(8.5, 65, 8.5), onGround: true, effects: {}, eyeHeight: 1.62, height: 1.8 };
    bot.game = { gameMode: 'survival' };
    bot.quickBarSlot = 0;
    bot.inventory = { slots: new Array(46).fill(null), selectedItem: null, items: () => [] };
    Object.defineProperty(bot, 'heldItem', { get: () => bot.inventory.slots[36 + bot.quickBarSlot] ?? null });
    bot.getEquipmentDestSlot = () => 5;
    bot.writes = [];
    bot._client = { write: (name, data) => bot.writes.push([name, data]) };
    bot.swingArm = () => {};
    bot.lookAt = async () => {};
    bot._updateBlockState = () => {};
    const sources = dumpDigSources(rd, registry);
    attachDigTime(bot, sources, { log: () => {} });
    bot.emit('chunkColumnLoad', new Vec3(0, 0, 0));
    require('mineflayer/lib/plugins/digging.js')(bot);
    const item = (name, count = 1, meta = 0) => new Item(registry.itemsByName[name].id, count, meta);
    return { bot, sources, item, logs };
}

test('the soak 15 trap: the stone pickaxe in the off hand, planks in hand: bot.dig still throws, and the line says where the pickaxe is', async () => {
    const { bot, item } = fakeBot();
    const logs = [];
    const report = attachDigRefusedLog(bot, dumpDigSources(rd, bot.registry), { log: (m) => logs.push(m) });
    bot.inventory.slots[36] = item('planks');
    bot.inventory.slots[45] = item('stone_pickaxe');
    const stone = bot.blockAt(new Vec3(8, 64, 8));
    await assert.rejects(bot.dig(stone, true), /dig time for stone is Infinity/, 'the error is rethrown unchanged');
    assert.deepEqual(logs, ['dig refused: stone:0 at 8, 64, 8 (pickaxe level 0, hardness 1.5); held planks (no pickaxe level); pickaxe tools: stone_pickaxe (level 0) off hand; rule: held Infinity, stone_pickaxe 600 ms']);
    assert.deepEqual(bot.writes, [], 'no packet, as before');
    await assert.rejects(bot.dig(stone, true), /is Infinity/);
    assert.equal(logs.length, 1, 'once per block and position');
    await assert.rejects(bot.dig(bot.blockAt(new Vec3(9, 64, 8)), true), /is Infinity/);
    assert.equal(logs.length, 2, 'another position: another line');
    assert.equal(report.lines, 2);
});

test('every place a tool can be: hotbar, main, armour, grid, cursor; none carried; a dig that works logs nothing', async () => {
    const { bot, item, sources } = fakeBot();
    const logs = [];
    attachDigRefusedLog(bot, sources, { log: (m) => logs.push(m) });
    const stone = bot.blockAt(new Vec3(8, 64, 8));
    await assert.rejects(bot.dig(stone, true), /is Infinity/);
    assert.equal(logs[0], 'dig refused: stone:0 at 8, 64, 8 (pickaxe level 0, hardness 1.5); held nothing (no pickaxe level); pickaxe tools: none carried; rule: held Infinity');
    bot.inventory.slots[2] = item('wooden_pickaxe');
    bot.inventory.slots[20] = item('iron_pickaxe');
    bot.inventory.selectedItem = item('stone_pickaxe');
    bot.inventory.slots[37] = item('golden_pickaxe');
    // The pack's speeds (the dump): golden 10 (250 ms), not vanilla's 12.
    assert.equal(digRefusedLine(bot, stone, sources),
        'dig refused: stone:0 at 8, 64, 8 (pickaxe level 0, hardness 1.5); held nothing (no pickaxe level); pickaxe tools: wooden_pickaxe (level 0) grid 2, iron_pickaxe (level 1) main 20, golden_pickaxe (level 0) hotbar 1, stone_pickaxe (level 0) cursor; rule: held Infinity, wooden_pickaxe 1150 ms, iron_pickaxe 400 ms, golden_pickaxe 250 ms, stone_pickaxe 600 ms');
    bot.inventory.slots[36] = item('stone_pickaxe');
    const result = await Promise.race([bot.dig(bot.blockAt(new Vec3(9, 64, 8)), true).then(() => 'dug', (e) => e.message), new Promise((r) => setTimeout(() => r('timer'), 50))]);
    bot.stopDigging();
    assert.notEqual(result, 'dig time for stone is Infinity', 'with the pickaxe in hand it digs');
    assert.equal(logs.length, 1);
    assert.deepEqual([1, 5, 9, 36, 44, 45, 'cursor'].map(slotPlace), ['grid 1', 'armour 5', 'main 9', 'hotbar 0', 'hotbar 8', 'off hand', 'cursor']);
});

test('other errors pass through with no line; attaching twice wraps once; before mineflayer adds bot.dig it waits for inject_allowed', async () => {
    const { bot, sources } = fakeBot();
    const logs = [];
    const real = bot.dig;
    bot.dig = () => Promise.reject(new Error('Digging aborted'));
    attachDigRefusedLog(bot, sources, { log: (m) => logs.push(m) });
    await assert.rejects(bot.dig(bot.blockAt(new Vec3(8, 64, 8))), /Digging aborted/);
    assert.deepEqual(logs, []);
    const wrapped = bot.dig;
    attachDigRefusedLog(bot, sources, { log: () => assert.fail('attached twice') });
    assert.equal(bot.dig, wrapped);
    assert.notEqual(real, wrapped);

    const late = new EventEmitter();
    attachDigRefusedLog(late, sources, { log: (m) => logs.push(m) });
    late.dig = () => Promise.reject(new Error('dig time for stone is Infinity'));
    late.emit('inject_allowed');
    late.inventory = { slots: [], selectedItem: null };
    late.entity = { onGround: true, effects: {} };
    const stone = bot.blockAt(new Vec3(8, 64, 8));
    await assert.rejects(late.dig(stone), /is Infinity/);
    assert.equal(logs.length, 1, 'installed on inject_allowed');
});
