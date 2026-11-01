// Golden byte vectors for the Forge messages, written by hand from Forge's own
// serializers (PR #10 review item 6). They do not come from this package's
// encoders, so a codec bug cannot hide behind a round trip. Each vector is
// checked both ways: our decoder must read it, and our encoder must produce
// the identical bytes.
//
// Source of each layout: `javap -c -p` on the class files in
// libraries/net/minecraftforge/forge/1.12.2-14.23.5.2860/forge-1.12.2-14.23.5.2860.jar
// from the pinned RotN 3.3.4 server pack (extracted to a scratch folder outside
// the repo; nothing was run):
// - FMLHandshakeMessage$ModList.toBytes: writeVarInt(size, 2), then per mod
//   writeUTF8String(modid), writeUTF8String(version).
// - FMLHandshakeMessage$RegistryData.toBytes: writeBoolean(hasMore),
//   writeUTF8String(name), writeVarInt(ids, 3) {String, writeVarInt(id, 3)},
//   writeVarInt(dummied, 3) {String}, writeVarInt(overrides, 3) {String, String}.
// - ByteBufUtils.writeUTF8String: writeVarInt(utf8 length, 2), then the bytes.
// - FMLMessage$EntityMessage.toBytes: writeInt(entityId). EntitySpawnMessage
//   then writes: String modId, int modEntityTypeId, long msb, long lsb, double
//   x/y/z, byte yaw/pitch/headYaw (angle * 256 / 360), the entity data manager
//   entries, int throwerId and, when it is non-zero, int vx/vy/vz (motion
//   clamped to +-3.9, times 8000), then IEntityAdditionalSpawnData bytes.
// - FMLProxyPacket.toS3FPackets and NetworkDispatcher$MultiPartCustomPayload:
//   payloads of PART_SIZE = 1048496 bytes or more go out on "FML|MP" as a
//   header (String channel (max 20), unsigned byte part count, int total
//   length) and then parts (byte index, up to PART_SIZE - 1 bytes each).
// The leading discriminator byte comes from FMLHandshakeCodec / FMLRuntimeCodec:
// ModList 2, RegistryData 3 on FML|HS; EntitySpawn 2 on FML.

import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeHandshake, encodeModList, encodeRegistryData } from '../src/fml-hs.js';
import { decodeFml, encodeEntitySpawn, encodeMultipart, MultipartAssembler, PART_SIZE } from '../src/channels.js';
import { createTypeReader } from '../src/reid.js';

const hex = (s) => Buffer.from(s.replace(/\s+|\/\/[^\n]*/g, ''), 'hex');

test('golden ModList (FML|HS disc 2)', () => {
    const bytes = hex(`
        02                              // discriminator ModList
        02                              // VarInt mod count
        05 666f726765                   // "forge"
        0c 31342e32332e352e32383630     // "14.23.5.2860"
        04 6a656964                     // "jeid"
        05 322e322e32                   // "2.2.2"
    `);
    const mods = [{ modid: 'forge', version: '14.23.5.2860' }, { modid: 'jeid', version: '2.2.2' }];
    const m = decodeHandshake(bytes);
    assert.equal(m.type, 'ModList');
    assert.deepEqual(m.mods, mods);
    assert.equal(encodeModList(mods).toString('hex'), bytes.toString('hex'));
});

test('golden RegistryData (FML|HS disc 3) with 1-, 2- and 3-byte VarInt ids', () => {
    const bytes = hex(`
        03                                          // discriminator RegistryData
        01                                          // hasMore = true
        10 6d696e6563726166743a626c6f636b73         // "minecraft:blocks"
        03                                          // 3 ids
        0d 6d696e6563726166743a616972   00          // "minecraft:air" = 0
        0d 7079726f746563683a726f636b   a1 1f       // "pyrotech:rock" = 4001
        08 6a6569643a626967             c0 b8 02    // "jeid:big" = 40000 (REID range)
        01                                          // 1 dummied
        0b 6f6c646d6f643a676f6e65                   // "oldmod:gone"
        01                                          // 1 override
        0f 6d696e6563726166743a737469636b           // "minecraft:stick"
        07 736f6d656d6f64                           // "somemod"
    `);
    const expected = {
        hasMore: true,
        name: 'minecraft:blocks',
        ids: [['minecraft:air', 0], ['pyrotech:rock', 4001], ['jeid:big', 40000]],
        dummied: ['oldmod:gone'],
        overrides: [['minecraft:stick', 'somemod']],
    };
    const m = decodeHandshake(bytes);
    assert.equal(m.type, 'RegistryData');
    for (const k of Object.keys(expected)) assert.deepEqual(m[k], expected[k], k);
    assert.equal(m.trailing, 0);
    assert.equal(encodeRegistryData(expected).toString('hex'), bytes.toString('hex'));
});

test('golden FML EntitySpawn (FML disc 2) with metadata, thrower and spawn data', () => {
    const metadata = hex('00 00 00  ff'); // entry key 0, serializer 0 (byte), value 0; terminator
    const bytes = hex(`
        02                                  // discriminator EntitySpawn
        000004d2                            // entityId 1234
        0a 696365616e6466697265             // modId "iceandfire"
        00000007                            // modEntityTypeId 7
        0123456789abcdef fedcba9876543210   // UUID msb, lsb
        4059200000000000                    // x 100.5
        4050000000000000                    // y 64.0
        c034400000000000                    // z -20.25
        40 e0 80                            // yaw 90, pitch -45, headYaw -180 (angle bytes)
        00 00 00 ff                         // entity data manager entries
        000004d3                            // throwerId 1235
        00000fa0 ffffe0c0 00000000          // velocity 0.5, -1.0, 0 (times 8000)
        abcd                                // IEntityAdditionalSpawnData
    `);
    const reader = createTypeReader({ reid: true });
    const m = decodeFml(bytes, { readMetadata: reader.readMetadata });
    assert.equal(m.type, 'EntitySpawn');
    assert.equal(m.metadataError, null);
    assert.equal(m.entityId, 1234);
    assert.equal(m.modId, 'iceandfire');
    assert.equal(m.modEntityTypeId, 7);
    assert.equal(m.uuid, '01234567-89ab-cdef-fedc-ba9876543210');
    assert.deepEqual([m.x, m.y, m.z], [100.5, 64, -20.25]);
    assert.deepEqual([m.yaw, m.pitch, m.headYaw], [90, -45, -180]);
    assert.deepEqual(m.metadata, [{ key: 0, type: 0, value: 0 }]);
    assert.equal(m.throwerId, 1235);
    assert.deepEqual(m.velocity, { x: 0.5, y: -1, z: 0 });
    assert.equal(m.extra.toString('hex'), 'abcd');
    const out = encodeEntitySpawn({
        entityId: 1234, modId: 'iceandfire', modEntityTypeId: 7, uuid: m.uuid,
        x: 100.5, y: 64, z: -20.25, yaw: 90, pitch: -45, headYaw: -180,
        throwerId: 1235, velocity: { x: 0.5, y: -1, z: 0 }, extra: Buffer.from('abcd', 'hex'),
    }, metadata);
    assert.equal(out.toString('hex'), bytes.toString('hex'));
});

test('golden FML|MP header and parts (Forge PART_SIZE 1048496)', () => {
    assert.equal(PART_SIZE, 1048496);
    // 1048498 bytes: the first part carries PART_SIZE - 1 = 1048495 bytes, the second 3.
    const total = PART_SIZE - 1 + 3;
    const inner = Buffer.alloc(total);
    for (let i = 0; i < total; i++) inner[i] = (i * 31) & 0xff;
    const header = hex(`
        07 736f6d656d6f64   // channel "somemod"
        02                  // 2 parts
        000fffb2            // total length 1048498
    `);
    const part0 = Buffer.concat([hex('00'), inner.subarray(0, PART_SIZE - 1)]);
    const part1 = Buffer.concat([hex('01'), inner.subarray(PART_SIZE - 1)]);
    assert.equal(part1.length, 4);

    const asm = new MultipartAssembler();
    assert.equal(asm.accept(header), null);
    assert.equal(asm.accept(part0), null);
    const done = asm.accept(part1);
    assert.equal(done.channel, 'somemod');
    assert.ok(done.data.equals(inner));

    const ours = encodeMultipart('somemod', inner);
    assert.equal(ours.length, 3);
    assert.equal(ours[0].toString('hex'), header.toString('hex'));
    assert.ok(ours[1].equals(part0));
    assert.ok(ours[2].equals(part1));
});
