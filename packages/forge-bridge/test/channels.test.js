import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writer } from '../src/wire.js';
import {
    decodeRegister, decodeFml, encodeEntitySpawn, decodeForge, decodeJeid,
    MultipartAssembler, encodeMultipart, PART_SIZE,
} from '../src/channels.js';
import { createTypeReader } from '../src/reid.js';

test('REGISTER splits on NUL and ignores empty names', () => {
    assert.deepEqual(decodeRegister(Buffer.from('FML|HS\0FML\0FML|MP\0FML\0FORGE\0', 'utf8')), ['FML|HS', 'FML', 'FML|MP', 'FML', 'FORGE']);
});

test('FML EntitySpawn decodes fields, VarInt-typed metadata and the thrower tail', () => {
    const reader = createTypeReader({ reid: true });
    // Two entries: key 0 byte 0x01; key 12 bool true (1.12 baby flag index); then 0xFF.
    const metadata = Buffer.from([0x00, 0x00, 0x01, 0x0c, 0x06, 0x01, 0xff]);
    const spawn = {
        entityId: 4242, modId: 'iceandfire', modEntityTypeId: 7,
        uuid: '12345678-9abc-def0-1234-56789abcdef0',
        x: 100.5, y: 64, z: -200.25, yaw: 90, pitch: -45, headYaw: 180,
        throwerId: 99, velocity: { x: 0.5, y: -0.25, z: 1 }, extra: Buffer.from([1, 2, 3]),
    };
    const m = decodeFml(encodeEntitySpawn(spawn, metadata), { readMetadata: reader.readMetadata });
    assert.equal(m.type, 'EntitySpawn');
    assert.equal(m.entityId, 4242);
    assert.equal(m.modId, 'iceandfire');
    assert.equal(m.modEntityTypeId, 7);
    assert.equal(m.uuid, spawn.uuid);
    assert.deepEqual([m.x, m.y, m.z], [100.5, 64, -200.25]);
    assert.deepEqual([m.yaw, m.pitch], [90, -45]);
    assert.equal(m.headYaw, -180, 'angles are signed bytes, 180 deg wraps to -180');
    assert.deepEqual(m.metadata, [{ key: 0, type: 0, value: 1 }, { key: 12, type: 6, value: true }]);
    assert.equal(m.throwerId, 99);
    assert.deepEqual(m.velocity, { x: 0.5, y: -0.25, z: 1 });
    assert.deepEqual([...m.extra], [1, 2, 3]);
    assert.equal(m.metadataError, null);
});

test('FML EntitySpawn with an unknown mod serializer keeps the rest raw', () => {
    const reader = createTypeReader({ reid: true });
    const metadata = Buffer.from([0x02, 0x80, 0x02, 0x01, 0xff]); // type 256 (2-byte VarInt)
    const m = decodeFml(encodeEntitySpawn({
        entityId: 1, modId: 'somemod', modEntityTypeId: 0, uuid: '00000000-0000-0000-0000-000000000001',
        x: 0, y: 0, z: 0, yaw: 0, pitch: 0, headYaw: 0,
    }, metadata), { readMetadata: reader.readMetadata });
    assert.equal(m.metadata, null);
    assert.match(m.metadataError, /256/);
    assert.ok(m.extra.length >= metadata.length);
});

test('FML OpenGui decodes', () => {
    const buf = new Writer().i8(1).i32(3).string('pyrotech').i32(2).i32(10).i32(64).i32(-5).toBuffer();
    assert.deepEqual(decodeFml(buf), { type: 'OpenGui', disc: 1, windowId: 3, modId: 'pyrotech', modGuiId: 2, x: 10, y: 64, z: -5 });
});

test('FORGE DimensionRegister and FluidIdMap decode', () => {
    const provider = Buffer.from('twilightforest', 'utf8');
    const dim = new Writer().i8(1).i32(7).i16(provider.length).bytes(provider).toBuffer();
    assert.deepEqual(decodeForge(dim), { type: 'DimensionRegister', disc: 1, dimensionId: 7, providerId: 'twilightforest' });
    const fluids = new Writer().i8(2).i32(2).string('water').i32(1).string('lava').i32(2).string('minecraft:water').string('minecraft:lava').toBuffer();
    assert.deepEqual(decodeForge(fluids), { type: 'FluidIdMap', disc: 2, fluids: [['water', 1], ['lava', 2]], defaults: ['minecraft:water', 'minecraft:lava'] });
    const noDefaults = new Writer().i8(2).i32(1).string('water').i32(1).toBuffer();
    assert.deepEqual(decodeForge(noDefaults).defaults, []);
});

test('jeid channel: the three REID 2.2.2 biome messages, with negative coordinates', () => {
    const chunk = new Writer().u8(0).varint(-3).varint(12).varint(256);
    for (let i = 0; i < 256; i++) chunk.varint(i === 0 ? 300 : 1);
    const c = decodeJeid(chunk.toBuffer());
    assert.equal(c.type, 'BiomeChunkChange');
    assert.deepEqual([c.chunkX, c.chunkZ, c.biomes.length, c.biomes[0], c.biomes[1]], [-3, 12, 256, 300, 1]);
    assert.deepEqual(decodeJeid(new Writer().u8(1).varint(-100).varint(50).varint(42).toBuffer()),
        { type: 'BiomePositionChange', disc: 1, x: -100, z: 50, biomeId: 42 });
    assert.deepEqual(decodeJeid(new Writer().u8(2).varint(10).varint(-20).varint(3).varint(260).toBuffer()),
        { type: 'BiomeAreaChange', disc: 2, x: 10, z: -20, radius: 3, biomeId: 260 });
});

test('FML|MP reassembles a payload split over several parts', () => {
    const big = Buffer.alloc(PART_SIZE * 2 + 1234);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7) & 0xff;
    const packets = encodeMultipart('FML|HS', big);
    assert.equal(packets.length, 1 + 3);
    const a = new MultipartAssembler();
    let done = null;
    for (const p of packets) done = a.accept(p) ?? done;
    assert.equal(done.channel, 'FML|HS');
    assert.equal(done.data.length, big.length);
    assert.ok(done.data.equals(big));
    assert.equal(a.pending, false);
});

test('FML|MP rejects out-of-order parts and bad headers', () => {
    const packets = encodeMultipart('FML|HS', Buffer.alloc(PART_SIZE + 10, 1));
    const a = new MultipartAssembler();
    a.accept(packets[0]);
    assert.throws(() => a.accept(packets[2]), /out of order/);
    const bad = new Writer().string('FML|HS').u8(1).i32(0).toBuffer();
    assert.throws(() => new MultipartAssembler().accept(bad), /bad header/);
});
