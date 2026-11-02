#!/usr/bin/env node
// Cuts one chunk section out of a forge-bridge capture's map_chunk packet, as a
// sanitized test fixture: only that section's bytes (bits per block, palette, block
// states, block and sky light). No biomes, no block entities, nothing else from the
// packet or the capture. The capture itself stays in captures/raw/ and is never committed.
//
//   node packages/forge-bridge/tools/chunk-section-fixture.mjs <capture.jsonl> <chunkX> <chunkZ> <sectionY> > fixture.json
//
// The output loads with ChunkColumn.load(chunkData, bitMap, true, false).

import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import process from 'node:process';

const [file, cxArg, czArg, syArg] = process.argv.slice(2);
if (!file || cxArg === undefined || czArg === undefined || syArg === undefined) {
    console.error('usage: chunk-section-fixture.mjs <capture.jsonl> <chunkX> <chunkZ> <sectionY>');
    process.exit(2);
}
const [cx, cz, sy] = [cxArg, czArg, syArg].map(Number);

let rec = null;
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"map_chunk"')) continue;
    const o = JSON.parse(line);
    if (o.name === 'map_chunk' && o.x === cx && o.z === cz && o.b64) { rec = o; break; }
}
if (!rec) { console.error(`no map_chunk for chunk (${cx}, ${cz}) with bytes in the capture`); process.exit(1); }

const buf = Buffer.from(rec.b64, 'base64');
let o = 0;
const varint = (b) => { let r = 0, s = 0, x; do { x = b[o++]; r |= (x & 0x7f) << s; s += 7; } while (x & 0x80); return r >>> 0; };
varint(buf); // packet id
o += 8; // chunk x, z
o += 1; // ground-up
const bitMap = varint(buf);
const dataLen = varint(buf);
const data = buf.subarray(o, o + dataLen);
if (!(bitMap & (1 << sy))) { console.error(`chunk (${cx}, ${cz}) has no section ${sy}`); process.exit(1); }

// Walk the sections (overworld: sky light sent) to find section sy's bytes.
o = 0;
let section = null;
for (let y = 0; y < 16; y++) {
    if (!(bitMap & (1 << y))) continue;
    const start = o;
    o += 1; // bits per block
    const paletteLength = varint(data);
    for (let i = 0; i < paletteLength; i++) varint(data);
    const longs = varint(data); // (read before `o +=`, which would use the old offset)
    o += longs * 8; // data array longs
    o += 2048 + 2048; // block light, sky light
    if (y === sy) { section = data.subarray(start, o); break; }
}

process.stdout.write(JSON.stringify({
    source: `forge-bridge capture map_chunk, chunk (${cx}, ${cz}), section ${sy} only (block states and light)`,
    chunkX: cx, chunkZ: cz, sectionY: sy,
    bitMap: 1 << sy,
    chunkData: section.toString('base64'),
}, null, 1) + '\n');
