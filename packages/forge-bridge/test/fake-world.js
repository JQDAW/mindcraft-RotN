// The fake Forge world shared by the offline end-to-end tests: one chunk with a
// stone floor at y=64 and a modded block, REID slots, an effect, an FML entity
// spawn and a jeid biome message. Loopback only.

import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { Writer, encodeVarInt } from '../src/wire.js';
import { encodeEntitySpawn } from '../src/channels.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const BitArray = require('prismarine-chunk/src/pc/common/BitArray');
const { SmartBuffer } = require('smart-buffer');

export const MODDED = (4001 << 4) | 3;

// One section (y 64-79): stone floor at y=64, a modded block at (0,64,0), air above.
function chunkData() {
    const data = new BitArray({ bitsPerValue: 16, capacity: 4096 });
    for (let i = 0; i < 256; i++) data.set(i, 1 << 4);
    data.set(0, MODDED);
    const sb = new SmartBuffer();
    data.writeBuffer(sb);
    const longs = sb.toBuffer();
    const w = new Writer().u8(16).varint(0).varint(longs.length / 8).bytes(longs)
        .bytes(Buffer.alloc(2048, 0xff)).bytes(Buffer.alloc(2048, 0xff));
    w.varint(256);
    for (let i = 0; i < 256; i++) w.varint(i === 0 ? 300 : 1); // REID VarInt biomes
    return w.toBuffer();
}

// The two real play.advancements packets from G1 Batch C (Triumph ExtendedDisplayInfo).
export function realAdvancementsPackets() {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rotn-3.3.4');
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'advancements-triumph.json'), 'utf8'));
    const raw = zlib.brotliDecompressSync(fs.readFileSync(path.join(dir, 'advancements-triumph.bin.br')));
    let off = 0;
    return index.packets.map((p) => { const b = raw.subarray(off, off + p.len); off += p.len; return b; });
}

export function joinFakeWorld(client) {
    client.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 2, maxPlayers: 10, levelType: 'default', reducedDebugInfo: false });
    client.write('map_chunk', { x: 0, z: 0, groundUp: true, bitMap: 1 << 4, chunkData: chunkData(), blockEntities: [] });
    const items = Array.from({ length: 46 }, () => ({ blockId: -1 }));
    items[36] = { blockId: 1, itemCount: 64, itemDamage: 0 };   // minecraft:stone
    items[37] = { blockId: 280, itemCount: 3, itemDamage: 0 };  // minecraft:stick
    items[38] = { blockId: 5003, itemCount: 1, itemDamage: 0 }; // modded, above 4095
    client.write('window_items', { windowId: 0, items });
    client.write('set_slot', { windowId: 0, slot: 39, item: { blockId: 40000, itemCount: 2, itemDamage: 1 } });
    client.write('position', { x: 8.5, y: 65, z: 8.5, yaw: 0, pitch: 0, flags: 0, teleportId: 1 });
    client.write('update_health', { health: 20, food: 20, foodSaturation: 5 });
    client.write('entity_effect', { entityId: 1, effectId: ((300 & 0xff) << 24) >> 24, amplifier: 1, duration: 200, hideParticles: 0, reidEffectId: encodeVarInt(300) });
    client.write('custom_payload', {
        channel: 'FML',
        data: encodeEntitySpawn({
            entityId: 77, modId: 'iceandfire', modEntityTypeId: 4, uuid: '00000000-0000-0000-0000-00000000004d',
            x: 10, y: 65, z: 10, yaw: 0, pitch: 0, headYaw: 0,
        }),
    });
    client.write('custom_payload', { channel: 'jeid', data: new Writer().u8(1).varint(-5).varint(7).varint(300).toBuffer() });
    // What the RotN server sends right after spawn; it broke G1 Batch B+C before the Triumph override.
    for (const pkt of realAdvancementsPackets()) client.writeRaw(pkt);
}

