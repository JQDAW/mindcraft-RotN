// REID packet overrides, run through node-minecraft-protocol's real compiled
// 1.12.2 play protocol. One REID protocol per process: nmp caches compiled
// protocols without the customPackets in the key (see src/reid.js).

import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildCustomPackets, reidEffectIdFromTail, createTypeReader } from '../src/reid.js';
import { Writer, encodeVarInt } from '../src/wire.js';

const require = createRequire(import.meta.url);
const mc = require('minecraft-protocol');
const customPackets = buildCustomPackets({ reid: true });
const toClient = mc.createDeserializer({ state: 'play', isServer: false, version: '1.12.2', customPackets });
const toServer = mc.createSerializer({ state: 'play', isServer: false, version: '1.12.2', customPackets });
const md = require('minecraft-data')('1.12.2');

function packetId(dir, name) {
    const m = md.protocol.play[dir].types.packet[1][0].type[1].mappings;
    return parseInt(Object.keys(m).find(k => m[k] === name), 16);
}

function reidSlot(w, id, count = 1, damage = 0) {
    w.varint(id);
    if (id === -1) return w;
    return w.i8(count).i16(damage).u8(0); // TAG_End: no NBT
}

test('window_items with REID VarInt item ids parses, including ids above 32767 and empty slots', () => {
    const w = new Writer().varint(packetId('toClient', 'window_items')).u8(0).i16(4);
    reidSlot(w, 1, 64, 0);       // minecraft:stone
    reidSlot(w, -1);             // empty slot as VarInt -1 (5 bytes)
    reidSlot(w, 5003, 1, 12);    // a modded item id above 4095
    reidSlot(w, 40000, 2, 3);    // above a signed short
    const buf = w.toBuffer();
    const p = toClient.parsePacketBuffer(buf);
    assert.equal(p.data.name, 'window_items');
    assert.equal(p.metadata.size, buf.length, 'no trailing bytes');
    assert.deepEqual(p.data.params.items, [
        { blockId: 1, itemCount: 64, itemDamage: 0, nbtData: undefined },
        { blockId: -1 },
        { blockId: 5003, itemCount: 1, itemDamage: 12, nbtData: undefined },
        { blockId: 40000, itemCount: 2, itemDamage: 3, nbtData: undefined },
    ]);
});

test('set_slot with a REID slot parses', () => {
    const w = new Writer().varint(packetId('toClient', 'set_slot')).i8(0).i16(36);
    reidSlot(w, 4001, 4, 0);
    const p = toClient.parsePacketBuffer(w.toBuffer());
    assert.deepEqual(p.data.params, { windowId: 0, slot: 36, item: { blockId: 4001, itemCount: 4, itemDamage: 0, nbtData: undefined } });
});

test('remove_entity_effect carries an i32 effect id', () => {
    const buf = new Writer().varint(packetId('toClient', 'remove_entity_effect')).varint(77).i32(300).toBuffer();
    const p = toClient.parsePacketBuffer(buf);
    assert.deepEqual(p.data.params, { entityId: 77, effectId: 300 });
    assert.equal(p.metadata.size, buf.length);
});

test('entity_effect keeps the vanilla fields and exposes the trailing REID VarInt', () => {
    const buf = new Writer().varint(packetId('toClient', 'entity_effect'))
        .varint(77).i8(((300 & 0xff) << 24) >> 24).i8(1).varint(600).i8(0) // vanilla byte: id & 0xff
        .bytes(encodeVarInt(300)).toBuffer();
    const p = toClient.parsePacketBuffer(buf);
    assert.equal(p.metadata.size, buf.length, 'tail consumed, no partial packet');
    assert.equal(p.data.params.amplifier, 1);
    assert.equal(p.data.params.duration, 600);
    assert.equal(reidEffectIdFromTail(p.data.params.reidEffectId), 300);
});

test('entity_effect without a tail still parses (vanilla server)', () => {
    const buf = new Writer().varint(packetId('toClient', 'entity_effect')).varint(1).i8(5).i8(0).varint(20).i8(1).toBuffer();
    const p = toClient.parsePacketBuffer(buf);
    assert.equal(p.data.params.effectId, 5);
    assert.equal(reidEffectIdFromTail(p.data.params.reidEffectId), null);
});

test('serverbound window_click writes the REID VarInt slot', () => {
    const buf = toServer.createPacketBuffer({
        name: 'window_click',
        params: { windowId: 0, slot: 36, mouseButton: 0, action: 1, mode: 0, item: { blockId: 5003, itemCount: 1, itemDamage: 0 } },
    });
    const expectedTail = Buffer.concat([encodeVarInt(5003), Buffer.from([1, 0, 0, 0])]);
    assert.ok(buf.subarray(buf.length - expectedTail.length).equals(expectedTail), buf.toString('hex'));
});

test('entity_metadata type ids are VarInts (Forge serializers start at 256)', () => {
    const r = createTypeReader({ reid: false });
    const v = r.readMetadata(Buffer.from([0x00, 0x00, 0x05, 0xff]), 0);
    assert.deepEqual(v.value, [{ key: 0, type: 0, value: 5 }]);
    assert.throws(() => r.readMetadata(Buffer.from([0x00, 0x80, 0x02, 0x05, 0xff]), 0), /256/);
});

test('without REID the slot override is absent', () => {
    const c = buildCustomPackets({ reid: false })['1.12'];
    assert.equal(c.types.slot, undefined);
    assert.equal(c.play, undefined);
    assert.ok(c.types.entityMetadata);
});
