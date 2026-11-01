// tools/import-dump.mjs on a fake fetch built from the mini dump (offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { importDump, canonicalize } from '../tools/import-dump.mjs';
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

test('dropped entries (manifest.entryErrors) block the import unless allowErrors', () => {
    const { root, src, pack } = fakeFetch({ mutate: (f) => { f.manifest.entryErrors = { items: { count: 2, first: 'entry 7: java.lang.NullPointerException' } }; } });
    try {
        const res = importDump({ src, jarSha256: JAR, outDir: pack });
        assert.deepEqual(res.written, []);
        assert.match(res.problems.join('\n'), /dropped entries: items 2 \(first: entry 7/);
        const ok = importDump({ src, jarSha256: JAR, outDir: pack, allowErrors: true });
        assert.deepEqual(ok.problems, []);
        assert.ok(ok.written.some(p => p.endsWith('serializers.json')));
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
        assert.ok(m.import.rawSha256.DONE && m.import.rawSha256['blocks.json'] && m.import.rawSha256['serializers.json']);
        assert.match(m.import.rawSha256['blocks.json'], /^[0-9a-f]{64}$/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a dump without serializers.json is refused', () => {
    const { root, src, pack } = fakeFetch();
    try {
        fs.rmSync(path.join(src, 'serializers.json'));
        assert.throws(() => importDump({ src, jarSha256: JAR, outDir: pack }), /missing serializers\.json/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('files over 1 MiB are written as .json.br, smaller ones as .json (PR #55 review)', () => {
    const { root, src, pack } = fakeFetch();
    try {
        // Pad one item so items.json is over 1 MiB; the other files stay small.
        const items = JSON.parse(fs.readFileSync(path.join(src, 'items.json'), 'utf8'));
        items.items['pyrotech:crude_axe'].padding = 'x'.repeat((1 << 20) + 1000);
        fs.writeFileSync(path.join(src, 'items.json'), JSON.stringify(items));
        const res = importDump({ src, jarSha256: JAR, outDir: pack });
        assert.deepEqual(res.problems, []);
        assert.ok(fs.existsSync(path.join(pack, 'items.json.br')) && !fs.existsSync(path.join(pack, 'items.json')));
        assert.ok(fs.existsSync(path.join(pack, 'smelting.json')) && !fs.existsSync(path.join(pack, 'smelting.json.br')));
        const back = JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(path.join(pack, 'items.json.br'))).toString('utf8'));
        assert.equal(back.items['pyrotech:crude_axe'].padding.length, (1 << 20) + 1000);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('the jar SHA-256 is compared case-insensitively (PR #55 review)', () => {
    const { root, src, pack } = fakeFetch();
    try {
        assert.deepEqual(importDump({ src, jarSha256: JAR.toUpperCase(), outDir: pack }).problems, []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('canonicalize sorts hash-set lists but keeps positional ones', () => {
    const st = (name, meta = 0, nbt) => (nbt ? { name, meta, nbt } : { name, meta });
    const files = {
        oredict: { ores: { rock: [st('z:z'), st('a:a', 6), st('a:a', 0)] } },
        recipes: { recipes: [{ id: 'x', type: 'shapeless', ingredients: [{ stacks: [st('b:b'), st('a:a')], ores: ['z', 'a'] }, null], remaining: [st('b:b'), null] },
            { id: 'y', type: 'shaped', slots: [null, { stacks: [st('m:m', 0, '{b}'), st('m:m', 0, '{a}')] }] }] },
        spawns: { biomes: { 'minecraft:plains': { monster: [{ entity: 'minecraft:zombie', weight: 95, min: 4, max: 4, class: 'Z' }, { entity: 'minecraft:creeper', weight: 100, min: 4, max: 4, class: 'C' }] } } },
        smelting: { smelting: [{ input: st('r:n', 10, '{b}'), output: st('o:o') }, { input: st('r:n', 10, '{a}'), output: st('o:o') }] },
    };
    canonicalize(files);
    assert.deepEqual(files.oredict.ores.rock, [st('a:a', 0), st('a:a', 6), st('z:z')]);
    assert.deepEqual(files.recipes.recipes[0].ingredients[0], { stacks: [st('a:a'), st('b:b')], ores: ['a', 'z'] });
    assert.equal(files.recipes.recipes[0].ingredients[1], null); // positions kept
    assert.deepEqual(files.recipes.recipes[0].remaining, [st('b:b'), null]);
    assert.equal(files.recipes.recipes[1].slots[0], null);
    assert.deepEqual(files.recipes.recipes[1].slots[1].stacks.map(s => s.nbt), ['{a}', '{b}']);
    assert.deepEqual(files.spawns.biomes['minecraft:plains'].monster.map(e => e.entity), ['minecraft:creeper', 'minecraft:zombie']);
    assert.deepEqual(files.smelting.smelting.map(s => s.input.nbt), ['{a}', '{b}']);
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
