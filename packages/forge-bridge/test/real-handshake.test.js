// The handshake against REAL server messages (net-forge brief, G1 spike): every
// plugin-channel payload a RotN 3.3.4 test server sent to forge-bridge in G1
// Batch A, replayed into attachForgeBridge. The bridge must answer with exactly
// the bytes it really sent, and decode every registry. Offline: the fixture is
// test/fixtures/rotn-3.3.4/handshake-runA.{json,bin.br} (sanitized; see its description).

import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { attachForgeBridge } from '../src/bridge.js';
import { decodeHandshake } from '../src/fml-hs.js';
import { decodeForge } from '../src/channels.js';
import { FIXTURES, pinnedModList } from './helpers.js';

const DIR = path.join(FIXTURES, 'rotn-3.3.4');

function loadRunA() {
    const index = JSON.parse(fs.readFileSync(path.join(DIR, 'handshake-runA.json'), 'utf8'));
    const raw = zlib.brotliDecompressSync(fs.readFileSync(path.join(DIR, 'handshake-runA.bin.br')));
    assert.equal(raw.length, index.bytes);
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), index.sha256);
    let off = 0;
    const records = index.records.map((r) => {
        const data = raw.subarray(off, off + r.len);
        off += r.len;
        return { ...r, data };
    });
    return { index, records };
}

const { index, records } = loadRunA();
const s2c = records.filter(r => r.dir === 'S2C');
const c2s = records.filter(r => r.dir === 'C2S');

function replay() {
    const client = new EventEmitter();
    const written = [];
    client.write = (name, params) => { if (name === 'custom_payload') written.push({ channel: params.channel, data: Buffer.from(params.data) }); return true; };
    client.setSerializer = () => {};
    const bridge = attachForgeBridge(client, { modList: pinnedModList(), log: () => {} });
    const registries = [];
    bridge.on('registries', (snap) => registries.push(snap));
    client.emit('packet', { uuid: '00000000-0000-0000-0000-000000000000', username: 'BOT' }, { name: 'success', state: 'login' }, null, null);
    for (const r of s2c) client.emit('packet', { channel: r.channel, data: r.data }, { name: 'custom_payload', state: 'play' }, null, null);
    return { bridge, written, registries };
}

test('the fixture is the full Batch A handshake: ServerHello, ModList, every RegistryData, two acks', () => {
    const hs = s2c.filter(r => r.channel === 'FML|HS').map(r => decodeHandshake(r.data));
    assert.equal(hs[0].type, 'ServerHello');
    assert.equal(hs[0].fmlProtocol, 2);
    assert.equal(hs[1].type, 'ModList');
    assert.equal(hs[1].mods.length, 346);
    const rd = hs.filter(m => m.type === 'RegistryData');
    assert.equal(rd.length, hs.length - 4);
    assert.ok(rd.slice(0, -1).every(m => m.hasMore) && rd.at(-1).hasMore === false, 'hasMore is false only on the last one');
    assert.ok(rd.every(m => m.trailing === 0), 'every RegistryData is read to its last byte');
    assert.deepEqual(hs.slice(-2).map(m => m.type), ['HandshakeAck', 'HandshakeAck']);
});

test('replayed into the bridge, the real server messages produce exactly the bytes forge-bridge really sent', () => {
    const { bridge, written } = replay();
    assert.equal(bridge.handshakeDone, true);
    assert.equal(bridge.handshake.stateName, 'DONE');
    assert.equal(written.length, c2s.length);
    for (let i = 0; i < c2s.length; i++) {
        assert.equal(written[i].channel, c2s[i].channel, `message ${i}`);
        assert.ok(written[i].data.equals(c2s[i].data), `message ${i} (${c2s[i].channel}) differs from the real one`);
    }
    const acks = written.filter(w => w.channel === 'FML|HS' && w.data[0] === 0xff).map(w => w.data[1]);
    assert.deepEqual(acks, [2, 3, 4, 5]);
    assert.deepEqual(index.events.find(e => e.name === 'hs_complete').sent.map(s => s.kind),
        ['REGISTER', 'ClientHello', 'ModList', 'Ack2', 'Ack3', 'Ack4', 'Ack5']);
});

test('our ModList has the server\'s own 346 entries (the pinned ping fixture matches the live server)', () => {
    const serverMods = decodeHandshake(s2c.find(r => r.channel === 'FML|HS' && r.data[0] === 2).data).mods;
    const ours = decodeHandshake(c2s.find(r => r.channel === 'FML|HS' && r.data[0] === 2).data).mods;
    // Same entries; the order differs (we send the status-ping order, the server its
    // map order). Forge reads ModList into a map, and the real server accepted it.
    const key = (m) => `${m.modid}@${m.version}`;
    assert.deepEqual(ours.map(key).sort(), serverMods.map(key).sort());
    assert.equal(ours.length, 346);
    assert.deepEqual(serverMods.find(m => m.modid === 'jeid'), { modid: 'jeid', version: '2.2.2' });
    assert.deepEqual(serverMods.find(m => m.modid === 'forge'), { modid: 'forge', version: '14.23.5.2860' });
});

test('the real registries decode: sizes from Batch A and REID-range ids', () => {
    const { registries } = replay();
    assert.equal(registries.length, 1);
    const snap = registries[0];
    const sizes = snap.sizes();
    assert.equal(sizes['minecraft:blocks'], 4896);
    assert.equal(sizes['minecraft:items'], 9710);
    assert.equal(sizes['minecraft:entities'], 971);
    assert.equal(sizes['minecraft:biomes'], 175);
    assert.equal(snap.idOf('minecraft:blocks', 'minecraft:stone'), 1, 'vanilla ids are kept');
    const maxBlock = Math.max(...snap.get('minecraft:blocks').byId.keys());
    assert.ok(maxBlock > 4095, `block ids above 4095 need REID (max ${maxBlock})`);

    const pyro = [...snap.get('minecraft:blocks').byName.keys()].filter(n => n.startsWith('pyrotech:'));
    assert.ok(pyro.length > 10, 'pyrotech blocks are synced');
});

test('the FORGE FluidIdMap from the real server decodes', () => {
    const fluids = decodeForge(s2c.find(r => r.channel === 'FORGE').data);
    assert.equal(fluids.type, 'FluidIdMap');
    assert.ok(fluids.fluids.length > 10);
    assert.deepEqual(fluids.fluids.slice(0, 2), [['water', 1], ['lava', 2]]);
});
