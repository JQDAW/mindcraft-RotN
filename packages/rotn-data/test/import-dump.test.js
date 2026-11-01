// tools/import-dump.mjs on a fake fetch built from the mini dump (offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importDump } from '../tools/import-dump.mjs';
import { RotnData, DUMP_FILES } from '../src/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JAR = 'ab'.repeat(32); // the expected dumper jar SHA-256 in these tests
const MINI = path.join(HERE, 'fixtures/mini-dump');
const read = (f) => JSON.parse(fs.readFileSync(path.join(MINI, f), 'utf8'));

// A fetched folder plus a registry capture that agrees with it.
function fakeFetch({ mutate } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-import-test-'));
    const src = path.join(root, 'rotn-dump');
    const pack = path.join(root, 'pack');
    fs.mkdirSync(src);
    fs.mkdirSync(pack);
    const files = Object.fromEntries(DUMP_FILES.map(f => [f, read(`${f}.json`)]));
    files.manifest = { ...files.manifest, format: 'rotn-dump/1', forge: '14.23.5.2860', errors: [], dumperJar: { file: 'rotndump-0.1.0.jar', bytes: 1, sha256: JAR } };
    mutate?.(files);
    for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(src, `${f}.json`), JSON.stringify(v));
    fs.writeFileSync(path.join(src, 'DONE'), '[rotndump] wrote {...}\n');
    const ids = (o) => Object.fromEntries(Object.keys(o).map((n, i) => [n, i]));
    const reg = { registries: {
        'minecraft:blocks': { ids: ids(read('blocks.json').blocks) },
        'minecraft:items': { ids: ids(Object.fromEntries([...Object.keys(read('items.json').items), ...Object.keys(read('registry-names.json').registries['minecraft:items'].ids)].map(n => [n, 0]))) },
        'minecraft:entities': { ids: ids(read('entities.json').entities) },
    } };
    // items.json in the mini dump lists only a few items; make the dump list every registry item.
    files.items.items = Object.fromEntries(Object.keys(reg.registries['minecraft:items'].ids).map(n => [n, files.items.items[n] ?? { stackSize: 64, variants: [{ meta: 0 }] }]));
    fs.writeFileSync(path.join(src, 'items.json'), JSON.stringify(files.items));
    fs.writeFileSync(path.join(pack, 'registry-names.json'), JSON.stringify(reg));
    return { root, src, pack };
}

test('a complete, consistent dump imports and loads', () => {
    const { root, src, pack } = fakeFetch();
    try {
        const res = importDump({ src, jarSha256: JAR, outDir: pack, version: '3.3.4' });
        assert.deepEqual(res.problems, []);
        assert.ok(res.crosscheck.length >= 8 && res.crosscheck.every(c => c.ok));
        assert.equal(res.written.length, DUMP_FILES.length);
        const cat = new RotnData(pack, { version: '3.3.4' });
        assert.equal(cat.hasDump, true);
        assert.equal(cat.dump.manifest.pack.zipSha256, '90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205');
        assert.equal(cat.recipesFor('pyrotech:crude_axe').length, 1);
        assert.deepEqual(Object.keys(cat.dump.blocks.blocks), [...Object.keys(cat.dump.blocks.blocks)].sort());
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('the dumper jar must be the expected one (PR #47 review)', () => {
    const { root, src, pack } = fakeFetch();
    try {
        const wrong = importDump({ src, jarSha256: 'cd'.repeat(32), outDir: pack });
        assert.deepEqual(wrong.written, []);
        assert.match(wrong.problems.join('\n'), /dumperJar\.sha256 (ab){32} is not the expected (cd){32}/);
        const missing = importDump({ src, outDir: pack });
        assert.match(missing.problems.join('\n'), /no expected jar SHA-256/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('the manifest records the SHA-256 of every raw file', () => {
    const { root, src, pack } = fakeFetch();
    try {
        const res = importDump({ src, jarSha256: JAR, outDir: pack });
        assert.deepEqual(res.problems, []);
        const m = JSON.parse(fs.readFileSync(path.join(pack, 'manifest.json'), 'utf8'));
        assert.equal(m.import.expectedJarSha256, JAR);
        assert.ok(m.import.rawSha256.DONE && m.import.rawSha256['blocks.json']);
        assert.match(m.import.rawSha256['blocks.json'], /^[0-9a-f]{64}$/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('no DONE marker: refused', () => {
    const { root, src, pack } = fakeFetch();
    try {
        fs.rmSync(path.join(src, 'DONE'));
        assert.throws(() => importDump({ src, jarSha256: JAR, outDir: pack }), /DONE is missing/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('names missing from the dump, dumper errors, wrong Forge or a lost recipe: nothing is written', () => {
    const { root, src, pack } = fakeFetch({ mutate: (f) => {
        delete f.blocks.blocks['pyrotech:rock'];
        f.manifest.errors = ['recipes: java.lang.NullPointerException'];
        f.manifest.forge = '14.23.5.2859';
        f.recipes.recipes = f.recipes.recipes.filter(r => r.id !== 'crafttweaker:cobble');
    } });
    try {
        const res = importDump({ src, jarSha256: JAR, outDir: pack });
        assert.deepEqual(res.written, []);
        const text = res.problems.join('\n');
        assert.match(text, /blocks: 1 synced but not dumped, e.g. pyrotech:rock/);
        assert.match(text, /manifest lists 1 errors/);
        assert.match(text, /Forge 14\.23\.5\.2859/);
        assert.match(text, /no dumped recipe matches rocks_to_cobblestone/);
        assert.ok(!fs.existsSync(path.join(pack, 'blocks.json')));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
