// play.advancements with Triumph 3.19.2's ExtendedDisplayInfo (G1 Batch B+C root
// cause). Uses the two real packets the RotN 3.3.4 test server sent
// (test/fixtures/rotn-3.3.4/advancements-triumph.*). Offline.

import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers';
import { buildCustomPackets, triumphTypes, OPAQUE_PACKET_TYPE } from '../src/reid.js';
import { attachForgeBridge } from '../src/bridge.js';
import { FIXTURES, pinnedModList } from './helpers.js';

const require = createRequire(import.meta.url);
// Take minecraft-data's vanilla definitions before anything in this process merges overrides into them.
const md = require('minecraft-data')('1.12.2');
const vanillaTypes = structuredClone(md.protocol.types);
const vanillaAdvancements = structuredClone(md.protocol.play.toClient.types.packet_advancements);

const DIR = path.join(FIXTURES, 'rotn-3.3.4');
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'advancements-triumph.json'), 'utf8'));
const raw = zlib.brotliDecompressSync(fs.readFileSync(path.join(DIR, 'advancements-triumph.bin.br')));
let off = 0;
const packets = index.packets.map((p) => {
    const b = raw.subarray(off, off + p.len);
    off += p.len;
    assert.equal(crypto.createHash('sha256').update(b).digest('hex'), p.sha256);
    return b;
});
const body = (pkt) => pkt.subarray(1); // packet id 0x4d is one VarInt byte

// An interpreted ProtoDef with the minecraft datatypes, NBT, REID's slot and the given advancements type.
function reader(advancementsType) {
    const { ProtoDef } = require('protodef');
    const nbt = require('prismarine-nbt');
    const types = structuredClone(vanillaTypes);
    Object.assign(types, buildCustomPackets({ reid: true })['1.12'].types);
    const proto = new ProtoDef(false);
    nbt.addTypesToInterpreter('big', proto);
    proto.addTypes(require('minecraft-protocol/src/datatypes/minecraft'));
    proto.addTypes(types);
    proto.addTypes({ packet_advancements: advancementsType });
    return (buf) => proto.read(buf, 0, 'packet_advancements', {});
}

test('the real packets do not parse with minecraft-data\'s vanilla advancements layout', () => {
    const vanilla = reader(vanillaAdvancements);
    for (const pkt of packets) {
        let failedOrShort = false;
        try {
            const r = vanilla(body(pkt));
            failedOrShort = r.size !== body(pkt).length;
        } catch {
            failedOrShort = true;
        }
        assert.ok(failedOrShort, 'vanilla must not read the Triumph packet cleanly');
    }
});

test('offline decoder: with Triumph\'s ExtendedDisplayInfo both real packets parse to the last byte', () => {
    const triumph = reader(triumphTypes().toClient.packet_advancements);
    const expected = [150, 174];
    packets.forEach((pkt, i) => {
        const { value, size } = triumph(body(pkt));
        assert.equal(size, body(pkt).length, `packet ${i}: read ${size} of ${body(pkt).length}`);
        assert.equal(value.advancementMapping.length, expected[i]);
        const displays = value.advancementMapping.map(a => a.value.displayData).filter(Boolean);
        assert.ok(displays.length > 0);
        assert.ok(displays.every(d => d.flags.triumph_extended === 1 && d.triumph && Array.isArray(d.triumph.extraConnections)));
        assert.ok(displays.every(d => Number.isFinite(d.xCord) && Number.isFinite(d.yCord)));
    });
    const first = triumph(body(packets[0])).value.advancementMapping[0];
    assert.match(first.key, /^triumph:advancements\//);
    assert.ok(first.value.displayData.icon.blockId > 4095, 'icon is a REID-range modded item');
});

test('wire override: through nmp\'s real deserializer stream the real packets are opaque, and the stream continues', async () => {
    const { createDeserializer } = require('minecraft-protocol/src/transforms/serializer');
    const d = createDeserializer({ state: 'play', isServer: false, version: '1.12.2', customPackets: buildCustomPackets({ reid: true, triumph: true }) });
    packets.forEach((pkt) => {
        const p = d.parsePacketBuffer(pkt);
        assert.equal(p.data.name, 'advancements');
        assert.equal(p.metadata.size, pkt.length);
        assert.ok(p.data.params.data.equals(body(pkt)), 'the whole body is kept as an opaque buffer');
    });
    const seen = [];
    let error = null;
    d.on('data', (pk) => seen.push(pk.data.name));
    d.on('error', (e) => { error = e; });
    for (const pkt of packets) d.write(pkt);
    d.write(Buffer.from('1f0000000000000539', 'hex')); // keep_alive 1337
    await new Promise((r) => setImmediate(r));
    assert.equal(error, null);
    assert.deepEqual(seen, ['advancements', 'advancements', 'keep_alive']);
});

test('Triumph overrides are only built when the ModList has triumph', () => {
    assert.equal(buildCustomPackets({ reid: true })['1.12'].play.toClient.types.packet_advancements, undefined);
    assert.equal(buildCustomPackets({ reid: true, triumph: true })['1.12'].play.toClient.types.packet_advancements, OPAQUE_PACKET_TYPE);
    const client = new EventEmitter();
    client.write = () => true;
    client.setSerializer = () => {};
    const bridge = attachForgeBridge(client, { modList: pinnedModList(), log: () => {} });
    assert.deepEqual(bridge.triumph, { modid: 'triumph', version: '3.19.2' });
    assert.equal(client.customPackets['1.12'].play.toClient.types.packet_advancements, OPAQUE_PACKET_TYPE);
    const noTriumph = new EventEmitter();
    noTriumph.write = () => true;
    noTriumph.setSerializer = () => {};
    const b2 = attachForgeBridge(noTriumph, { modList: pinnedModList().filter(m => m.modid !== 'triumph'), log: () => {} });
    assert.equal(b2.triumph, null);
    assert.equal(noTriumph.customPackets['1.12'].play.toClient.types.packet_advancements, undefined);
});

test('the safety net drops only allowlisted packets; an essential one and login-state errors stay fatal', () => {
    const client = new EventEmitter();
    client.write = () => true;
    client.setSerializer = function () { this.deserializer = { parsePacketBuffer: () => { throw new Error('Read error for undefined : unexpected tag end'); } }; };
    const logs = [];
    const bridge = attachForgeBridge(client, { modList: pinnedModList(), log: (m) => logs.push(m) });
    client.setSerializer('play');
    let err;
    try { client.deserializer.parsePacketBuffer(Buffer.from([0x4d, 0x01])); } catch (e) { err = e; }
    assert.ok(err, 'still throws, so protodef sees it');
    assert.equal(err.partialReadError, true, 'marked partial: protodef drops the packet and keeps the stream');
    assert.equal(err.forgeBridgeDropped, true);
    assert.equal(bridge.stats.parseErrors, 1);
    assert.equal(bridge.stats.droppedPackets.advancements, 1);

    let chunkErr;
    try { client.deserializer.parsePacketBuffer(Buffer.from([0x20, 0x01])); } catch (e) { chunkErr = e; } // map_chunk
    assert.notEqual(chunkErr.partialReadError, true, 'map_chunk is essential: it still fails loudly');
    assert.equal(bridge.stats.droppedPackets.map_chunk, undefined);

    client.setSerializer('login');
    let loginErr;
    try { client.deserializer.parsePacketBuffer(Buffer.from([0x02])); } catch (e) { loginErr = e; }
    assert.notEqual(loginErr.partialReadError, true, 'login-state errors stay fatal');
});
