// test/tools/p1-capture-summary.mjs on a small synthetic capture, offline: clicks are paired with their
// transactions, REID ids (4096 and up) are counted, the fastbench window bounds the table craft, and no
// payload bytes reach the summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCapture, summarize, CAPTURE_CAPS, REID_MIN_ID } from '../tools/p1-capture-summary.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

test('CAPTURE_CAPS is exactly forge-bridge\'s default caps in bridge.js (it does not export them)', () => {
    const src = fs.readFileSync(path.join(HERE, '..', '..', 'packages', 'forge-bridge', 'src', 'bridge.js'), 'utf8');
    const table = (name) => {
        const m = new RegExp(`const ${name} = \\{([^}]*)\\};`).exec(src);
        assert.ok(m, `${name} is in bridge.js`);
        return Object.fromEntries([...m[1].matchAll(/([a-z_]+):\s*(\d+)/g)].map(([, k, v]) => [k, Number(v)]));
    };
    assert.deepEqual({ ...CAPTURE_CAPS.S2C }, table('DEFAULT_CAPTURED_PACKETS'));
    assert.deepEqual({ ...CAPTURE_CAPS.C2S }, table('DEFAULT_CAPTURED_C2S'));
});

test('a packet stream at its cap is reported (block_change included); a capped click stream makes the counts incomplete (#189 nit 1)', () => {
    const changes = Array.from({ length: CAPTURE_CAPS.S2C.block_change }, (_, i) => ({ t: i, kind: 'packet', dir: 'S2C', name: 'block_change', params: {} }));
    const s = summarize([...changes, ...CAPTURE]);
    assert.deepEqual(s.limits.filter((l) => l.name === 'packet_cap').map((l) => [l.dir, l.packet, l.limit, l.lastT]), [['S2C', 'block_change', 300, 299]]);
    assert.equal(s.windowClicks.complete, true, 'the click and transaction streams are below their caps');
    const many = Array.from({ length: CAPTURE_CAPS.C2S.window_click }, (_, i) => click(100 + i, 0, 100 + i, 280));
    const c = summarize([...CAPTURE, ...many]);
    assert.equal(c.windowClicks.complete, false);
    assert.ok(c.limits.some((l) => l.packet === 'window_click' && l.dir === 'C2S'));
    assert.equal(summarize(readCapture(text)).limits.filter((l) => l.name === 'packet_cap').length, 0);
});

test('transactions no click claimed are listed as unpaired (#189 nit 2)', () => {
    const s = summarize([...CAPTURE, answer(50, 0, 99, true), answer(51, 1, 1, false)]);
    assert.deepEqual([s.transactions.total, s.transactions.paired], [5, 3]);
    assert.deepEqual(s.transactions.unpaired.map((u) => [u.windowId, u.action, u.accepted]), [[0, 99, true], [1, 1, false]], 'a second answer to an already answered click is unpaired too');
    assert.deepEqual(summarize(readCapture(text)).transactions.unpaired, []);
});

test('no close_window: the table craft ends 10 s after the window opened (#189 nit 5)', () => {
    const noClose = CAPTURE.filter((e) => e.name !== 'close_window');
    const slot = (t, id) => ({ t, kind: 'packet', dir: 'S2C', name: 'set_slot', params: { windowId: 1, slot: 0, item: { blockId: id, itemCount: 1, itemDamage: 0 } } });
    const s = summarize([...noClose, slot(41 + 9999, 77), slot(41 + 10001, 291)]);
    assert.equal(s.tableCraft.closedT, null);
    assert.deepEqual(s.tableCraft.setSlots.map((x) => x.item.id), [274, 4, 77], 'everything inside 10 s is kept (the t 5000 slot too), nothing after it');
});

test('--names labels ids from a table and leaves unknown ids null; no payload bytes in the summary', () => {
    const s = summarize(readCapture(text), { names: new Map([[8917, 'pyrotech:rock'], [274, 'minecraft:stone_pickaxe']]) });
    assert.equal(s.windowClicks.items.find((x) => x.id === 8917).name, 'pyrotech:rock');
    assert.equal(s.windowClicks.items.find((x) => x.id === 9075).name, null);
    assert.equal(s.tableCraft.setSlots[0].item.name, 'minecraft:stone_pickaxe');
    assert.ok(!JSON.stringify(s).includes('b64') && !JSON.stringify(s).includes('AAAAKKc='));
    assert.equal(summarize([]).tableCraft, null, 'no fastbench window: no table craft');
});
