// FML OpenGui for FastWorkbench (RotN's minecraft:crafting_table) becomes the
// open_window a vanilla server would send, so mineflayer opens the window.
// Layouts: javap on Forge 14.23.5.2860 (FMLMessage.OpenGui.toBytes, FMLNetworkHandler.openGui)
// and FastWorkbench-1.12.2-1.7.4 (BlockFastBench, Handler) from the pinned pack; see src/mod-guis.js.

import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { attachForgeBridge } from '../src/bridge.js';
import { CaptureWriter, readCapture } from '../src/capture.js';
import { decodeFml, encodeOpenGui } from '../src/channels.js';
import { modGuiWindow, MOD_GUI_WINDOWS } from '../src/mod-guis.js';
import { pinnedModList, tmpFile, runARegistries } from './helpers.js';

const require = createRequire(import.meta.url);

// disc 1, windowId 1, "fastbench" (VarInt length 9), gui 0, x -45, y 66, z -66
const OPEN_GUI_HEX = '01' + '00000001' + '09' + Buffer.from('fastbench').toString('hex') + '00000000' + 'ffffffd3' + '00000042' + 'ffffffbe';
const MSG = { windowId: 1, modId: 'fastbench', modGuiId: 0, x: -45, y: 66, z: -66 };

function setup() {
    const client = new EventEmitter();
    client.write = () => true;
    client.setSerializer = function () {};
    const file = tmpFile('mod-gui.jsonl');
    const capture = new CaptureWriter({ file, redact: { username: 'FRCFLD', uuid: '0123456789abcdef0123456789abcdef' } });
    const logs = [];
    const bridge = attachForgeBridge(client, { modList: pinnedModList(), capture, log: (m) => logs.push(m) });
    const play = (name, data) => client.emit('packet', data, { name, state: 'play' }, null, null);
    // nmp emits 'packet' and then the named event; the bridge listens on 'packet'.
    const payload = (data) => { const p = { channel: 'FML', data }; play('custom_payload', p); client.emit('custom_payload', p); };
    return { client, bridge, capture, file, logs, play, payload };
}

test('OpenGui golden vector: decode and encode agree with the Forge layout', () => {
    const buf = Buffer.from(OPEN_GUI_HEX, 'hex');
    assert.deepEqual(decodeFml(buf), { type: 'OpenGui', disc: 1, ...MSG });
    assert.equal(encodeOpenGui(MSG).toString('hex'), OPEN_GUI_HEX);
});

test('FastWorkbench is the crafting table in Run A, and only its gui 0 maps to a vanilla window', () => {
    for (const reg of ['minecraft:blocks', 'minecraft:items']) {
        assert.equal(runARegistries().get(reg).overrides.get('minecraft:crafting_table'), 'fastbench', reg);
    }
    assert.ok('fastbench:0' in MOD_GUI_WINDOWS);
    assert.deepEqual(modGuiWindow(MSG), { windowId: 1, inventoryType: 'minecraft:crafting_table', windowTitle: '{"translate":"container.crafting"}', slotCount: 0 });
    assert.equal(modGuiWindow({ ...MSG, modGuiId: 1 }), null);
    assert.equal(modGuiWindow({ ...MSG, modId: 'craftingcraft' }), null);
    assert.equal(modGuiWindow({ ...MSG, windowId: 0 }), null);
    assert.equal(modGuiWindow({ ...MSG, windowId: 256 }), null);
});

test('the bridge emits open_window for FastWorkbench before the window_items that follows', () => {
    const { client, bridge, capture, file, payload } = setup();
    const order = [];
    client.on('open_window', (p) => order.push(['open_window', p]));
    client.on('window_items', () => order.push(['window_items']));
    payload(encodeOpenGui({ ...MSG, windowId: 7 }));
    client.emit('window_items', { windowId: 7, items: [] });
    assert.deepEqual(order.map(o => o[0]), ['open_window', 'window_items']);
    assert.equal(order[0][1].windowId, 7);
    assert.equal(order[0][1].inventoryType, 'minecraft:crafting_table');
    assert.equal(bridge.stats.openGuis, 1);
    assert.equal(bridge.stats.modWindows, 1);
    capture.close();
    const ev = readCapture(file).find(l => l.kind === 'event' && l.name === 'mod_window');
    assert.equal(ev?.windowId, 7);
});

test('a throwing open_window handler is logged on its own; openGui still fires and FML decoding is not blamed', () => {
    const { client, bridge, logs, payload, capture, file } = setup();
    client.on('open_window', () => { throw new Error('handler broke'); });
    const seen = [];
    bridge.on('openGui', (m) => seen.push(m.windowId));
    payload(encodeOpenGui({ ...MSG, windowId: 9 }));
    assert.deepEqual(seen, [9]);
    assert.equal(bridge.stats.modWindows, 1);
    assert.equal(bridge.stats.modWindowErrors, 1);
    assert.ok(logs.some(l => l.includes('synthetic open_window for fastbench:0 window 9: handler threw Error: handler broke')), logs.join('\n'));
    assert.ok(!logs.some(l => l.includes('decode error')), logs.join('\n'));
    capture.close();
    assert.ok(readCapture(file).some(l => l.kind === 'event' && l.name === 'mod_window_error' && l.windowId === 9));
});

test('an unknown mod GUI is logged and opens no window', () => {
    const { client, bridge, logs, payload } = setup();
    let opened = 0;
    client.on('open_window', () => opened++);
    payload(encodeOpenGui({ ...MSG, modId: 'craftingcraft', modGuiId: 0 }));
    assert.equal(opened, 0);
    assert.equal(bridge.stats.openGuis, 1);
    assert.equal(bridge.stats.modWindows, 0);
    assert.ok(logs.some(l => l.includes('OpenGui craftingcraft:0') && l.includes('ignored')), logs.join('\n'));
});

test('prismarine-windows builds the crafting-table window from the synthetic packet', () => {
    const windows = require('prismarine-windows')('1.12.2');
    const p = modGuiWindow(MSG);
    const w = windows.createWindow(p.windowId, p.inventoryType, p.windowTitle, p.slotCount);
    assert.equal(w.type, 'minecraft:crafting_table');
    assert.equal(w.craftingResultSlot, 0);
    assert.equal(w.inventoryStart, 10);
    assert.equal(w.inventoryEnd, 46);
    assert.equal(w.requiresConfirmation, true);
});
