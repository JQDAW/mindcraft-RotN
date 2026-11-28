// The craft-refused line (soak 16): patches/mineflayer's craftResultRefused, logged with a cap.
// The craft-result line (soak 18): craftResultDropped, a result thrown on the ground, with its own cap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachCraftRefusedLog, craftRefusedLine, craftRefusedCapLine, craftDroppedLine, craftDroppedCapLine, CRAFT_REFUSED } from '../index.js';

test('craftRefusedLine: another item, no result, missing fields', () => {
    assert.equal(craftRefusedLine({ windowId: 1, windowType: 'minecraft:crafting_table', expected: 'planks x1', server: 'ancientbeasts:stick_wall x1' }),
        'craft refused: window 1 (minecraft:crafting_table): the server makes ancientbeasts:stick_wall x1 from this grid, not planks x1; nothing taken');
    assert.equal(craftRefusedLine({ windowId: 0, windowType: 'minecraft:inventory', expected: 'planks x1', server: null }),
        'craft refused: window 0 (minecraft:inventory): the server has no result for this grid, expected planks x1; nothing taken');
    assert.equal(craftRefusedLine(undefined), 'craft refused: window ?: the server has no result for this grid, expected ?; nothing taken');
});

test('attachCraftRefusedLog: one line per event, once per bot, then the cap notice', () => {
    const bot = new EventEmitter();
    const logs = [];
    const report = attachCraftRefusedLog(bot, { log: (m) => logs.push(m), maxLines: 2 });
    assert.equal(attachCraftRefusedLog(bot, { log: () => assert.fail('attached twice') }), report);
    const ev = { windowId: 3, windowType: 'minecraft:crafting', expected: 'planks x1', server: 'ancientbeasts:stick_wall x1' };
    for (let i = 0; i < 4; i++) bot.emit('craftResultRefused', ev);
    assert.deepEqual(logs, [craftRefusedLine(ev), craftRefusedLine(ev), craftRefusedCapLine(2)]);
    assert.equal(logs[2], 'craft refused: 2 lines logged; further refusals on this connection are not');
    assert.deepEqual(report, { lines: 2, dropped: 2, thrown: { lines: 0, dropped: 0 } });
    assert.equal(CRAFT_REFUSED.maxLines, 50);
});

test('craftDroppedLine: all of it thrown, part of it, missing fields', () => {
    const ev = { windowId: 0, windowType: 'minecraft:inventory', result: 'undergroundbiomes:igneous_cobble:2 x1', name: 'undergroundbiomes:igneous_cobble', metadata: 2, count: 1, thrown: 1, position: { x: -169, y: 69, z: -133 } };
    assert.equal(craftDroppedLine(ev),
        'craft result undergroundbiomes:igneous_cobble:2 x1: thrown on the ground at -169, 69, -133 (window 0, minecraft:inventory): no inventory slot had room');
    assert.equal(craftDroppedLine({ ...ev, result: 'planks x4', name: 'planks', metadata: 0, count: 4, thrown: 2 }),
        'craft result planks x4: 2 into the inventory, 2 thrown on the ground at -169, 69, -133 (window 0, minecraft:inventory): no inventory slot had room for them');
    assert.equal(craftDroppedLine(undefined), 'craft result ?: thrown on the ground (window ?): no inventory slot had room');
});

test('attachCraftRefusedLog: craftResultDropped has its own cap; the refusals\' cap is untouched', () => {
    const bot = new EventEmitter();
    const logs = [];
    const report = attachCraftRefusedLog(bot, { log: (m) => logs.push(m), maxLines: 2 });
    const ev = { windowId: 0, windowType: 'minecraft:inventory', result: 'cobblestone x1', count: 1, thrown: 1, position: { x: 1, y: 64, z: 2 } };
    for (let i = 0; i < 3; i++) bot.emit('craftResultDropped', ev);
    bot.emit('craftResultRefused', { windowId: 0, expected: 'planks x1', server: null });
    assert.deepEqual(logs, [craftDroppedLine(ev), craftDroppedLine(ev), craftDroppedCapLine(2), craftRefusedLine({ windowId: 0, expected: 'planks x1', server: null })]);
    assert.equal(logs[2], 'craft result: 2 lines logged; further thrown results on this connection are not');
    assert.deepEqual(report, { lines: 1, dropped: 0, thrown: { lines: 2, dropped: 1 } });
});
