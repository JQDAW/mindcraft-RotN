// The craft-refused line (soak 16): patches/mineflayer's craftResultRefused, logged with a cap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachCraftRefusedLog, craftRefusedLine, craftRefusedCapLine, CRAFT_REFUSED } from '../index.js';

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
    assert.deepEqual(report, { lines: 2, dropped: 2 });
    assert.equal(CRAFT_REFUSED.maxLines, 50);
});
