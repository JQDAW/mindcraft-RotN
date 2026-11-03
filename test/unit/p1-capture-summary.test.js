// test/tools/p1-capture-summary.mjs on a small synthetic capture, offline: clicks are paired with their
// transactions, REID ids (4096 and up) are counted, the fastbench window bounds the table craft, and no
// payload bytes reach the summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCapture, summarize, REID_MIN_ID } from '../tools/p1-capture-summary.mjs';

const click = (t, windowId, action, id, slot = 1) => ({ t, kind: 'packet', dir: 'C2S', name: 'window_click', params: { windowId, slot, mouseButton: 0, action, mode: 0, item: id === null ? { blockId: -1 } : { blockId: id, itemCount: 1, itemDamage: 0 } } });
const answer = (t, windowId, action, accepted) => ({ t, kind: 'packet', dir: 'S2C', name: 'transaction', params: { windowId, action, accepted }, b64: 'EQAAAQE=' });
const CAPTURE = [
    { t: 1, kind: 'event', name: 'login_success' },
    click(10, 0, 1, 8917), answer(12, 0, 1, true),
    click(20, 0, 2, 280), answer(25, 0, 2, false),
    click(30, 0, 3, 9075),   // never answered
    { t: 40, kind: 'packet', dir: 'C2S', name: 'block_place', params: { location: { x: -43, y: 66, z: -66 }, direction: 1 } },
    { t: 41, kind: 'event', name: 'mod_window', modId: 'fastbench', windowId: 1, inventoryType: 'minecraft:crafting_table', windowTitle: '{"translate":"container.crafting"}' },
    { t: 42, kind: 'payload', dir: 'S2C', channel: 'fastbench', disc: 0, len: 5, b64: 'AAAAKKc=' },
    click(43, 1, 1, 12510), answer(44, 1, 1, true),
    { t: 45, kind: 'packet', dir: 'S2C', name: 'set_slot', params: { windowId: 1, slot: 0, item: { blockId: 274, itemCount: 1, itemDamage: 0 } } },
    { t: 46, kind: 'packet', dir: 'C2S', name: 'close_window', params: { windowId: 1 } },
    { t: 5000, kind: 'packet', dir: 'S2C', name: 'set_slot', params: { windowId: 0, slot: 36, item: { blockId: 4, itemCount: 8, itemDamage: 0 } } },
    { t: 6000, kind: 'event', name: 'channel_limit', dir: 'S2C', channel: 'aether_legacy', limit: 2000 },
];
const text = `${CAPTURE.map((e) => JSON.stringify(e)).join('\n')}\nnot json\n`;

test('clicks are paired with their transactions; REID ids are counted; unanswered clicks are kept apart', () => {
    const s = summarize(readCapture(text));
    assert.equal(REID_MIN_ID, 4096);
    assert.deepEqual([s.windowClicks.total, s.windowClicks.accepted, s.windowClicks.rejected, s.windowClicks.unanswered], [4, 2, 1, 1]);
    assert.deepEqual([s.windowClicks.reidClicks, s.windowClicks.reidRejected, s.windowClicks.maxItemId], [3, 1, 12510], 'the unanswered 9075 click counts as not accepted');
    assert.deepEqual(s.clicks.map((c) => [c.item?.id, c.accepted, c.answerMs]), [[8917, true, 2], [280, false, 5], [9075, null, null], [12510, true, 1]]);
    assert.deepEqual(s.windowClicks.items.map((x) => [x.id, x.clicks, x.reid]), [[280, 1, false], [8917, 1, true], [9075, 1, true], [12510, 1, true]]);
});

test('the fastbench window bounds the table craft: its clicks, its set_slots (to close + 1 s), its payloads', () => {
    const s = summarize(readCapture(text));
    assert.deepEqual(s.fastbench.modWindows.map((w) => [w.modId, w.windowId, w.inventoryType]), [['fastbench', 1, 'minecraft:crafting_table']]);
    assert.equal(s.fastbench.payloads, 1);
    assert.deepEqual([s.tableCraft.windowId, s.tableCraft.openedT, s.tableCraft.closedT, s.tableCraft.fastbenchPayloads], [1, 41, 46, 1]);
    assert.deepEqual(s.tableCraft.clicks.map((c) => c.item.id), [12510]);
    assert.deepEqual(s.tableCraft.setSlots.map((x) => [x.windowId, x.slot, x.item.id]), [[1, 0, 274]], 'the set_slot at t 5000 is outside the window');
    assert.deepEqual(s.blockPlaces, [{ t: 40, location: { x: -43, y: 66, z: -66 }, direction: 1 }]);
    assert.deepEqual(s.limits.map((l) => [l.name, l.channel]), [['channel_limit', 'aether_legacy']]);
});

test('--names labels ids from a table and leaves unknown ids null; no payload bytes in the summary', () => {
    const s = summarize(readCapture(text), { names: new Map([[8917, 'pyrotech:rock'], [274, 'minecraft:stone_pickaxe']]) });
    assert.equal(s.windowClicks.items.find((x) => x.id === 8917).name, 'pyrotech:rock');
    assert.equal(s.windowClicks.items.find((x) => x.id === 9075).name, null);
    assert.equal(s.tableCraft.setSlots[0].item.name, 'minecraft:stone_pickaxe');
    assert.ok(!JSON.stringify(s).includes('b64') && !JSON.stringify(s).includes('AAAAKKc='));
    assert.equal(summarize([]).tableCraft, null, 'no fastbench window: no table craft');
});
