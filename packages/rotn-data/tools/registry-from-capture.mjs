// Builds packages/rotn-data/3.3.4/registry-names.json from net-forge's real
// RegistryData capture of the RotN 3.3.4 test server (G1 Batch A,
// packages/forge-bridge/test/fixtures/rotn-3.3.4/handshake-runA.*).
// Names only: the dumper (tools/dumper, ADR 0004) supplies properties.
// Numeric ids are kept for reference but are NOT a stable key (ADR 0004).
//
// Usage: node packages/rotn-data/tools/registry-from-capture.mjs [--check]
//   --check  exit 1 if the committed file differs from what would be written.
import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodeHandshake } from '../../forge-bridge/src/fml-hs.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '../../forge-bridge/test/fixtures/rotn-3.3.4');
const OUT = path.join(HERE, '../3.3.4/registry-names.json');
const KEEP = ['minecraft:blocks', 'minecraft:items', 'minecraft:entities', 'minecraft:biomes', 'minecraft:enchantments', 'minecraft:potions'];

export function buildRegistryNames() {
    const index = JSON.parse(fs.readFileSync(path.join(FIX, 'handshake-runA.json'), 'utf8'));
    const raw = zlib.brotliDecompressSync(fs.readFileSync(path.join(FIX, 'handshake-runA.bin.br')));
    const sha = crypto.createHash('sha256').update(raw).digest('hex');
    if (sha !== index.sha256) throw new Error('capture sha256 mismatch');
    let off = 0;
    const out = { source: 'packages/forge-bridge/test/fixtures/rotn-3.3.4/handshake-runA (G1 Batch A RegistryData)', captureSha256: sha, capturedAt: index.capturedAt, registries: {} };
    for (const r of index.records) {
        const data = raw.subarray(off, off + r.len);
        off += r.len;
        if (r.dir !== 'S2C' || r.channel !== 'FML|HS') continue;
        const m = decodeHandshake(data);
        if (m.type !== 'RegistryData' || !KEEP.includes(m.name)) continue;
        const dummied = new Set(m.dummied);
        const ids = Object.fromEntries([...m.ids].filter(([n]) => !dummied.has(n)).sort((a, b) => a[0].localeCompare(b[0])));
        out.registries[m.name] = { count: Object.keys(ids).length, dummied: [...dummied].sort(), ids };
    }
    return JSON.stringify(out, null, 1) + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const text = buildRegistryNames();
    if (process.argv.includes('--check')) {
        const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
        if (cur !== text) { console.error('registry-names.json is stale; rerun without --check'); process.exit(1); }
        console.log('registry-names.json is up to date');
    } else {
        fs.mkdirSync(path.dirname(OUT), { recursive: true });
        fs.writeFileSync(OUT, text);
        console.log(`wrote ${OUT} (${text.length} bytes)`);
    }
}
