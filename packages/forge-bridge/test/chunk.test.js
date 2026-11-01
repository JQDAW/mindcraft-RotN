// prismarine-chunk 1.9 loader with patches/prismarine-chunk+1.41.0.patch:
// the packet's bitsPerBlock is used for global-palette sections, and REID's
// VarInt biome array is read from the end of the chunk data.

import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Writer } from '../src/wire.js';

const require = createRequire(import.meta.url);
const ChunkColumn = require('prismarine-chunk')('1.12.2');
const BitArray = require('prismarine-chunk/src/pc/common/BitArray');
const { SmartBuffer } = require('smart-buffer');

// One section using the global palette at `bits` bits per block.
function globalPaletteSection(bits, stateAt) {
    const data = new BitArray({ bitsPerValue: bits, capacity: 4096 });
    for (let i = 0; i < 4096; i++) data.set(i, stateAt(i));
    const sb = new SmartBuffer();
    data.writeBuffer(sb);
    const longs = sb.toBuffer();
    return new Writer()
        .u8(bits).varint(0) // bits per block, empty palette
        .varint(longs.length / 8).bytes(longs)
        .bytes(Buffer.alloc(2048, 0xff)) // block light
        .bytes(Buffer.alloc(2048, 0xff)) // sky light
        .toBuffer();
}

function varintBiomes(fn) {
    const w = new Writer().varint(256);
    for (let i = 0; i < 256; i++) w.varint(fn(i));
    return w.toBuffer();
}

// Section index i = y << 8 | z << 4 | x.
const MODDED = (4001 << 4) | 3; // pyrotech-like block id 4001, meta 3: needs 16 bits
const stateAt = (i) => (i >> 8) === 0 ? MODDED : (i & 1 ? (1 << 4) : 0);

test('global-palette section at 16 bits per block and REID VarInt biomes load', () => {
    const section = globalPaletteSection(16, stateAt);
    const biomes = varintBiomes((i) => (i === 0 ? 300 : 1)); // 300 needs REID
    const col = new ChunkColumn();
    col.load(Buffer.concat([section, biomes]), 0b1, true, true);
    assert.equal(col.biomesFormat, 'varint');
    assert.equal(col.getBlockStateId({ x: 0, y: 0, z: 0 }), MODDED);
    assert.equal(col.getBlockType({ x: 5, y: 0, z: 9 }), 4001);
    assert.equal(col.getBlockData({ x: 5, y: 0, z: 9 }), 3);
    assert.equal(col.getBlockStateId({ x: 1, y: 1, z: 0 }), 1 << 4); // stone
    assert.equal(col.getBlockStateId({ x: 0, y: 1, z: 0 }), 0);      // air
    assert.equal(col.getBiome({ x: 0, y: 0, z: 0 }), 300);
    assert.equal(col.getBiome({ x: 1, y: 0, z: 0 }), 1);
});

test('vanilla 13-bit global palette and byte biomes still load', () => {
    const section = globalPaletteSection(13, (i) => (i & 3) === 0 ? (2 << 4) : 0);
    const col = new ChunkColumn();
    col.load(Buffer.concat([section, Buffer.alloc(256, 4)]), 0b1, true, true);
    assert.equal(col.biomesFormat, 'byte');
    assert.equal(col.getBlockType({ x: 0, y: 0, z: 0 }), 2);
    assert.equal(col.getBiome({ x: 7, y: 0, z: 7 }), 4);
});

test('a stock chunk dump round-trips (section palette path unchanged)', () => {
    const a = new ChunkColumn();
    a.setBlockStateId({ x: 1, y: 2, z: 3 }, 1 << 4);
    a.setBiome({ x: 1, y: 0, z: 3 }, 6);
    const b = new ChunkColumn();
    b.load(a.dump(), a.getMask(), true, true);
    assert.equal(b.getBlockStateId({ x: 1, y: 2, z: 3 }), 1 << 4);
    assert.equal(b.getBiome({ x: 1, y: 0, z: 3 }), 6);
    assert.equal(b.biomesFormat, 'byte');
});

test('non-full chunks have no biome tail', () => {
    const section = globalPaletteSection(16, stateAt);
    const col = new ChunkColumn();
    col.load(section, 0b1, true, false);
    assert.equal(col.getBlockStateId({ x: 0, y: 0, z: 0 }), MODDED);
    assert.equal(col.biomesFormat, undefined);
});

// Local writes (block_change, multi_block_change) of Forge/REID state ids wider
// than the vanilla 13 bits must not be truncated (PR #10 review item 5).
const WIDE = (40000 << 4) | 5; // REID block id 40000, meta 5: needs 20 bits

test('a wide state id written into a vanilla 13-bit global section is kept', () => {
    const col = new ChunkColumn();
    col.load(Buffer.concat([globalPaletteSection(13, () => 1 << 4), Buffer.alloc(256, 1)]), 0b1, true, true);
    col.setBlockStateId({ x: 2, y: 3, z: 4 }, WIDE);
    assert.equal(col.getBlockStateId({ x: 2, y: 3, z: 4 }), WIDE);
    assert.equal(col.getBlockStateId({ x: 3, y: 3, z: 4 }), 1 << 4, 'neighbours survive the resize');
    assert.equal(col.sections[0].data.getBitsPerValue(), 20);
});

test('a palette section switching to the global palette keeps wide ids', () => {
    const col = new ChunkColumn();
    // 300 distinct modded states overflow the 8-bit section palette.
    for (let i = 0; i < 300; i++) col.setBlockStateId({ x: i & 15, y: i >> 8, z: (i >> 4) & 15 }, WIDE + (i << 4));
    for (let i = 0; i < 300; i++) assert.equal(col.getBlockStateId({ x: i & 15, y: i >> 8, z: (i >> 4) & 15 }), WIDE + (i << 4));
    assert.equal(col.sections[0].palette, null);
    assert.ok(col.sections[0].data.getBitsPerValue() >= 20);
});

test('a caller can seed the column width; the default stays vanilla', () => {
    assert.equal(new ChunkColumn({ maxBitsPerBlock: 18 }).maxBitsPerBlock, 18);
    assert.ok(new ChunkColumn().maxBitsPerBlock <= 13);
});

test('dump writes REID VarInt biomes back, and the dump reloads (review item 7)', () => {
    const a = new ChunkColumn();
    a.load(Buffer.concat([globalPaletteSection(16, stateAt), varintBiomes((i) => (i === 0 ? 300 : 1))]), 0b1, true, true);
    a.setBlockStateId({ x: 9, y: 9, z: 9 }, WIDE);
    const b = new ChunkColumn();
    b.load(a.dump(), a.getMask(), true, true);
    assert.equal(b.biomesFormat, 'varint');
    assert.equal(b.getBiome({ x: 0, y: 0, z: 0 }), 300);
    assert.equal(b.getBlockStateId({ x: 0, y: 0, z: 0 }), MODDED);
    assert.equal(b.getBlockStateId({ x: 9, y: 9, z: 9 }), WIDE);
});

test('dump switches to VarInt biomes when an id does not fit in a byte', () => {
    const a = new ChunkColumn();
    a.setBlockStateId({ x: 0, y: 0, z: 0 }, 1 << 4);
    a.setBiome({ x: 4, y: 0, z: 4 }, 260);
    const b = new ChunkColumn();
    b.load(a.dump(), a.getMask(), true, true);
    assert.equal(b.biomesFormat, 'varint');
    assert.equal(b.getBiome({ x: 4, y: 0, z: 4 }), 260);
});
