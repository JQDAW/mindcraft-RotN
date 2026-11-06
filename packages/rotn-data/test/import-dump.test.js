// tools/import-dump.mjs on a fake fetch built from the mini dump (offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { importDump, canonicalize, checkStateMetaRemap, checkEntityCollision, keepWorldDependentCollision, DT_LEAVES_PLAYER_BOX } from '../tools/import-dump.mjs';
import { RotnData, DUMP_FILES, isDtBranchNoConnectionBox } from '../src/catalog.js';

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
    // Block ids as in the mini dump's capture where it has one (the double plant is 175, which
    // state-meta-remap.json's network ids are built from).
    const capturedBlockIds = read('registry-names.json').registries['minecraft:blocks'].ids;
    const blockIds = Object.fromEntries(Object.keys(read('blocks.json').blocks).map((n, i) => [n, capturedBlockIds[n] ?? i]));
    const reg = { registries: {
        'minecraft:blocks': { ids: blockIds },
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

// state-meta-remap.json (dumper 0.2.0; lead request after net-forge's G2 double-plant finding).
test('state-meta-remap: imported sorted by networkId, with no notes when the ids match the capture', () => {
    const { root, src, pack } = fakeFetch({ mutate: (f) => { f['state-meta-remap'].remap.reverse(); } });
    try {
        const res = importDump({ src, jarSha256: JAR, outDir: pack });
        assert.deepEqual(res.problems, []);
        assert.deepEqual(res.notes.filter((n) => n.startsWith('state-meta-remap')), []); // the mini dump predates entityCollision (a note)
        const back = JSON.parse(fs.readFileSync(path.join(pack, 'state-meta-remap.json'), 'utf8'));
        assert.deepEqual(back.remap.map(x => x.networkId), [2808, 2809, 2811]);
        assert.equal(new RotnData(pack, { version: '3.3.4' }).clientMeta('minecraft:double_plant', 11), 10);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('state-meta-remap: a dump without it is refused', () => {
    const { root, src, pack } = fakeFetch();
    try {
        fs.rmSync(path.join(src, 'state-meta-remap.json'));
        assert.throws(() => importDump({ src, jarSha256: JAR, outDir: pack }), /missing state-meta-remap\.json/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('state-meta-remap: anomalies block the import unless allowErrors', () => {
    const { root, src, pack } = fakeFetch({ mutate: (f) => {
        f['state-meta-remap'].anomalies = { encodingMismatches: 3, foreignStates: 0, first: 'state x:y[a=b] of block id 4100 has network id 12' };
    } });
    try {
        const res = importDump({ src, jarSha256: JAR, outDir: pack });
        assert.deepEqual(res.written, []);
        assert.match(res.problems.join('\n'), /state-meta-remap: anomalies: 3 encoding mismatches, 0 foreign states \(first: state x:y/);
        assert.deepEqual(importDump({ src, jarSha256: JAR, outDir: pack, allowErrors: true }).problems, []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// The map-size check (dumper 0.2.1, #80 review).
test('state-meta-remap: unscanned map ids block the import unless allowErrors', () => {
    const { root, src, pack } = fakeFetch({ mutate: (f) => {
        f['state-meta-remap'].scanned.mapIds = 42;
        f['state-meta-remap'].anomalies.unscannedIds = 2;
    } });
    try {
        const res = importDump({ src, jarSha256: JAR, outDir: pack });
        assert.deepEqual(res.written, []);
        assert.match(res.problems.join('\n'), /state-meta-remap: anomalies: 2 unscanned ids \(map 42 vs 40 scanned\)/);
        assert.deepEqual(importDump({ src, jarSha256: JAR, outDir: pack, allowErrors: true }).problems, []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('state-meta-remap: an unreadable map (null) or a missing map-size field counts as non-zero', () => {
    const cases = [
        (a) => { a.unscannedIds = null; },
        (a) => { delete a.unscannedIds; },
    ];
    for (const change of cases) {
        const problems = [];
        const r = read('state-meta-remap.json');
        change(r.anomalies);
        checkStateMetaRemap(r, { 'minecraft:double_plant': 175 }, { problems, dumperVersion: '0.2.1' });
        assert.equal(problems.length, 1, String(change));
        assert.match(problems[0], /unscanned/);
    }
});

test('state-meta-remap: only a 0.2.0 dump may lack the map-size field (a note)', () => {
    const r = read('state-meta-remap.json');
    delete r.anomalies.unscannedIds;
    let problems = [];
    const notes = checkStateMetaRemap(r, { 'minecraft:double_plant': 175 }, { problems, dumperVersion: '0.2.0' });
    assert.deepEqual(problems, []);
    assert.match(notes.join('\n'), /dumper 0\.2\.0 predates the map-size check/);
    // A 0.2.0 label does not excuse a non-zero count that is present.
    r.anomalies.unscannedIds = 1;
    problems = [];
    checkStateMetaRemap(r, { 'minecraft:double_plant': 175 }, { problems, dumperVersion: '0.2.0' });
    assert.match(problems.join('\n'), /1 unscanned ids/);
});

test('state-meta-remap: inconsistent records and unsynced blocks are refused', () => {
    const { root, src, pack } = fakeFetch({ mutate: (f) => {
        const r = f['state-meta-remap'].remap;
        r[0].networkId = 2807; // not 175 << 4 | 8
        r[1].stateMeta = r[1].idMeta; // not a remap
        r.push({ ...r[2] }); // duplicate 2811
        r[2].stateNetworkId = 176 << 4 | 11; // another block's id (#80 review)
        r.push({ networkId: 99 << 4 | 1, block: 'nomod:nothing', blockId: 99, idMeta: 1, stateMeta: 0, stateNetworkId: 99 << 4, state: 'nomod:nothing' });
        f['state-meta-remap'].scanned.networkIds = 0;
    } });
    try {
        const text = importDump({ src, jarSha256: JAR, outDir: pack }).problems.join('\n');
        assert.match(text, /networkId 2807 \(minecraft:double_plant\): not blockId << 4 \| idMeta/);
        assert.match(text, /networkId 2809 \(minecraft:double_plant\): idMeta equals stateMeta/);
        assert.match(text, /networkId 2811 \(minecraft:double_plant\): duplicate/);
        assert.match(text, /networkId 2811 \(minecraft:double_plant\): stateNetworkId 2827 is not an id of block 175/);
        assert.match(text, /networkId 1585 \(nomod:nothing\): block not synced/);
        assert.match(text, /scanned\.networkIds is not positive/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('state-meta-remap: block ids that differ from the capture are a note, not a problem', () => {
    const { root, src, pack } = fakeFetch({ mutate: (f) => {
        for (const x of f['state-meta-remap'].remap) Object.assign(x, { blockId: 176, networkId: 176 << 4 | x.idMeta, stateNetworkId: 176 << 4 | 11 });
    } });
    try {
        const res = importDump({ src, jarSha256: JAR, outDir: pack });
        assert.deepEqual(res.problems, []);
        assert.match(res.notes.join('\n'), /3 block ids differ from the registry capture \(used by name only\), e.g. minecraft:double_plant 176 vs 175/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// Request 14 (net-forge #259 via the lead): the player collision boxes of dumper 0.3.0.
const FULL = [[0, 0, 0, 1, 1, 1]];
const PROBE = { entity: 'FakePlayer standing on the block (x + 0.5, y + 1, z + 0.5)', entityBoxGrow: 1, air: [0, 250, 0], solid: [0, 5, 0] };
const st = (meta, collision, entityCollision, entityCollisionVaries = false) => ({ meta, collision, entityCollision, entityCollisionVaries });
function blocks03({ leaves = DT_LEAVES_PLAYER_BOX, leavesVaries = false } = {}) {
    return {
        format: 'rotn-dump/1',
        entityCollisionProbe: PROBE,
        blocks: {
            'minecraft:stone': { defaultMeta: 0, states: [st(0, FULL, FULL)] },
            'minecraft:fence': { defaultMeta: 0, states: [st(0, [[0.375, 0, 0.375, 0.625, 1.5, 0.625]], [[0.375, 0, 0.375, 0.625, 1.5, 0.625]], true)] },
            'dynamictrees:leaves0': { defaultMeta: 0, states: [st(0, FULL, leaves, leavesVaries), st(1, FULL, DT_LEAVES_PLAYER_BOX)] },
            'dynamictrees:leaves1': { defaultMeta: 0, states: [st(0, FULL, DT_LEAVES_PLAYER_BOX)] },
            'mod:thrower': { defaultMeta: 0, states: [st(0, FULL, null, null)] },
        },
    };
}

test('entityCollision: a well-formed 0.3.0 blocks file whose leaves give the half-height box passes, with counts', () => {
    const problems = [];
    const notes = checkEntityCollision(blocks03(), { problems, dumperVersion: '0.3.0', requireLeaves: true });
    assert.deepEqual(problems, []);
    assert.deepEqual(DT_LEAVES_PLAYER_BOX, [[0.125, 0, 0.125, 0.875, 0.5, 0.875]]);
    // 6 states: the 3 leaves states differ from collision (a full cube); the fence varies; the thrower threw.
    assert.deepEqual(notes, ['entityCollision: 6 states; 3 differ from collision, 1 vary between the probes (world-dependent), 1 threw; self-check 3 dynamictrees:leaves* states ok']);
});

test('entityCollision self-check: a leaves state that is a full cube, or varies, blocks the import (even with allowErrors)', () => {
    for (const bad of [{ leaves: FULL }, { leaves: [] }, { leavesVaries: true }, { leaves: null }]) {
        const problems = [];
        checkEntityCollision(blocks03(bad), { problems, dumperVersion: '0.3.0', requireLeaves: true, allowErrors: true });
        assert.equal(problems.length, 1, JSON.stringify(bad));
        assert.match(problems[0], /self-check: 1 of 3 dynamictrees:leaves\* states do not give a player the half-height box/);
    }
    // requireLeaves: a dump without any Dynamic Trees leaves cannot pass the self-check.
    const f = blocks03();
    delete f.blocks['dynamictrees:leaves0'];
    delete f.blocks['dynamictrees:leaves1'];
    const problems = [];
    checkEntityCollision(f, { problems, dumperVersion: '0.3.0', requireLeaves: true });
    assert.deepEqual(problems, ['entityCollision: self-check: no dynamictrees:leaves* block in the dump']);
    const others = [];
    checkEntityCollision(f, { problems: others, dumperVersion: '0.3.0' });
    assert.deepEqual(others, []); // without requireLeaves (another pack): no problem
});

test('entityCollision: missing or malformed fields, and a 0.3.0 dump without the probe, are refused; older dumps get a note', () => {
    const f = blocks03();
    delete f.blocks['minecraft:stone'].states[0].entityCollisionVaries;
    f.blocks['minecraft:fence'].states[0].entityCollision = [[0, 0, 1]];
    let problems = [];
    checkEntityCollision(f, { problems, dumperVersion: '0.3.0' });
    assert.deepEqual(problems, ['entityCollision: 2 malformed states, e.g. minecraft:stone:0 lacks the fields; minecraft:fence:0 has bad boxes']);
    const noProbe = blocks03();
    delete noProbe.entityCollisionProbe;
    problems = [];
    checkEntityCollision(noProbe, { problems, dumperVersion: '0.3.0' });
    assert.deepEqual(problems, ['entityCollision: dumper 0.3.0 wrote no entityCollisionProbe']);
    problems = [];
    assert.deepEqual(checkEntityCollision(noProbe, { problems, dumperVersion: '0.2.1', requireLeaves: true }), ['entityCollision: dumper 0.2.1 predates it (getCollisionBoundingBox only)']);
    assert.deepEqual(problems, []);
    // No air probe cell: no player boxes at all.
    const noAir = blocks03();
    noAir.entityCollisionProbe = { ...PROBE, air: null, solid: null };
    problems = [];
    const notes = checkEntityCollision(noAir, { problems, dumperVersion: '0.3.0' });
    assert.deepEqual(problems, ['entityCollision: no air probe cell, so no player boxes were read']);
    assert.ok(notes.includes('entityCollision: no solid probe cell, so entityCollisionVaries is null everywhere'));
});

test('entityCollision end to end: a 0.3.0 dump on the pinned pack must contain Dynamic Trees leaves; playerCollision reads the boxes', () => {
    const add = (f) => {
        f.manifest.dumper = '0.3.0';
        f.blocks.entityCollisionProbe = PROBE;
        for (const [name, b] of Object.entries(f.blocks.blocks)) {
            for (const s of b.states) Object.assign(s, { collision: FULL, entityCollision: name === 'pyrotech:rock' ? [[0, 0, 0, 1, 0.125, 1]] : FULL, entityCollisionVaries: false });
        }
    };
    // The mini dump has no Dynamic Trees blocks: on 3.3.4 the self-check refuses it and nothing is written.
    let { root, src, pack } = fakeFetch({ mutate: add });
    try {
        const res = importDump({ src, jarSha256: JAR, outDir: pack, version: '3.3.4' });
        assert.deepEqual(res.problems, ['entityCollision: self-check: no dynamictrees:leaves* block in the dump']);
        assert.deepEqual(res.written, []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
    // Another pack version (no Dynamic Trees requirement): imported, and the catalog reads the boxes.
    ({ root, src, pack } = fakeFetch({ mutate: add }));
    try {
        const res = importDump({ src, jarSha256: JAR, outDir: pack, version: '9.9.9', expectedRecipes: [] });
        assert.deepEqual(res.problems, []);
        const cat = new RotnData(pack, { version: '9.9.9' });
        assert.deepEqual(cat.dump.blocks.entityCollisionProbe, PROBE);
        assert.deepEqual(cat.playerCollision('pyrotech:rock'), { boxes: [[0, 0, 0, 1, 0.125, 1]], varies: false, source: 'entityCollision' });
        assert.equal(cat.playerCollision('minecraft:stone').source, 'entityCollision');
        assert.equal(cat.playerCollision('nomod:nothing'), null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('playerCollision on the 3.3.4 data (dumper 0.3.0 run): half-height leaves, multi-box stairs, a varying wall, a thrown state', () => {
    const cat = new RotnData(path.join(HERE, '../3.3.4'), { version: '3.3.4' });
    assert.equal(cat.dump.manifest.dumper, '0.3.0');
    // The full cube #259 is about is gone: a player gets the half-height box.
    assert.deepEqual(cat.playerCollision('dynamictrees:leaves0'), { boxes: DT_LEAVES_PLAYER_BOX, varies: false, source: 'entityCollision' });
    assert.equal(cat.playerCollision('minecraft:oak_stairs').boxes.length, 2);
    assert.equal(cat.playerCollision('minecraft:cobblestone_wall').varies, true);
    // end_portal_frame's call threw (null): getCollisionBoundingBox stands in.
    assert.deepEqual(cat.playerCollision('minecraft:end_portal_frame'), { boxes: [[0, 0, 0, 1, 0.8125, 1]], varies: null, source: 'collision' });
});

test('playerCollision: a Dynamic Trees branch dumped with the no-connection cube gets its core box, varies true', () => {
    const cat = new RotnData(path.join(HERE, '../3.3.4'), { version: '3.3.4' });
    // Radius 1 (meta 0): dumped as a 2-block cube around the cell; the core is 2/16 wide.
    assert.deepEqual(cat.getBlock({ name: 'dynamictrees:oakbranch', meta: 0 }).state.entityCollision, [[-0.5, -0.5, -0.5, 1.5, 1.5, 1.5]]);
    assert.deepEqual(cat.playerCollision({ name: 'dynamictrees:oakbranch', meta: 0 }), { boxes: [[0.4375, 0.4375, 0.4375, 0.5625, 0.5625, 0.5625]], varies: true, source: 'collision' });
    assert.deepEqual(cat.playerCollision({ name: 'dynamictrees:oakbranch', meta: 7 }), { boxes: FULL, varies: true, source: 'collision' });
    // Radius > 8 (thick trunks) never takes that path: the dumped box is used.
    assert.deepEqual(cat.playerCollision({ name: 'dynamictrees:oakbranch', meta: 15 }), { boxes: [[-0.5, 0, -0.5, 1.5, 1, 1.5]], varies: false, source: 'entityCollision' });
    assert.equal(cat.playerCollision({ name: 'dynamictreesbop:cherrybranch', meta: 3 }).source, 'collision');
    // Rustic registers Dynamic Trees branches in its own namespace (#269 review).
    assert.deepEqual(cat.playerCollision({ name: 'rustic:olivebranch', meta: 0 }), { boxes: [[0.4375, 0.4375, 0.4375, 0.5625, 0.5625, 0.5625]], varies: true, source: 'collision' });
});

test('isDtBranchNoConnectionBox: only a block of a Dynamic Trees class with one cell-centred cube of whole-block half-size', () => {
    const basic = { class: 'com.ferreusveritas.dynamictrees.blocks.BlockBranchBasic' };
    assert.equal(isDtBranchNoConnectionBox(basic, [[-0.5, -0.5, -0.5, 1.5, 1.5, 1.5]]), true);
    assert.equal(isDtBranchNoConnectionBox({ class: 'maxhyper.dynamictreesttf.blocks.BlockBranchTwilight' }, [[-7.5, -7.5, -7.5, 8.5, 8.5, 8.5]]), true);
    assert.equal(isDtBranchNoConnectionBox({ class: 'com.mcwbridges.kikoz.objects.blocks.BridgeBlock' }, [[-0.5, -0.5, -0.5, 1.5, 1.5, 1.5]]), false);
    assert.equal(isDtBranchNoConnectionBox({}, [[-0.5, -0.5, -0.5, 1.5, 1.5, 1.5]]), false);
    assert.equal(isDtBranchNoConnectionBox(basic, [[-0.5, 0, -0.5, 1.5, 1, 1.5]]), false);
    assert.equal(isDtBranchNoConnectionBox(basic, [[-0.25, -0.25, -0.25, 1.25, 1.25, 1.25]]), false);
    assert.equal(isDtBranchNoConnectionBox({ class: 'com.ferreusveritas.dynamictrees.blocks.BlockDynamicLeaves' }, DT_LEAVES_PLAYER_BOX), false);
    assert.equal(isDtBranchNoConnectionBox(basic, [FULL[0], FULL[0]]), false);
    assert.equal(isDtBranchNoConnectionBox(basic, null), false);
});

test('entityCollision: Dynamic Trees branch states with the no-connection cube are counted in a note', () => {
    const f = blocks03();
    f.blocks['dynamictrees:oakbranch'] = { defaultMeta: 0, class: 'com.ferreusveritas.dynamictrees.blocks.BlockBranchThick', states: [st(0, [[0.4375, 0.4375, 0.4375, 0.5625, 0.5625, 0.5625]], [[-0.5, -0.5, -0.5, 1.5, 1.5, 1.5]]), st(15, [[-0.5, 0, -0.5, 1.5, 1, 1.5]], [[-0.5, 0, -0.5, 1.5, 1, 1.5]])] };
    const problems = [];
    const notes = checkEntityCollision(f, { problems, dumperVersion: '0.3.0', requireLeaves: true });
    assert.deepEqual(problems, []);
    assert.ok(notes.includes('entityCollision: 1 states of 1 Dynamic Trees branch blocks have the no-connection cube (playerCollision uses their collision, varies true)'), notes.join('\n'));
});

// #269 review: collision of neighbour-dependent states stays as it was (forge-bridge reads it).
test('keepWorldDependentCollision keeps the previous collision only for states flagged entityCollisionVaries', () => {
    const POST = [[0.25, 0, 0.25, 0.75, 1.5, 0.75]];
    const HALF = [[0, 0, 0, 0.75, 1.5, 0.75]];
    const blocks = { blocks: {
        'mod:wall': { states: [st(0, HALF, POST, true)] },
        'mod:odd': { states: [st(0, HALF, HALF, false)] },
        'mod:new': { states: [st(0, FULL, FULL)] },
    } };
    const previous = { blocks: { 'mod:wall': { states: [{ meta: 0, collision: POST }] }, 'mod:odd': { states: [{ meta: 0, collision: POST }] } } };
    assert.deepEqual(keepWorldDependentCollision(blocks, previous), { kept: ['mod:wall:0'], changed: ['mod:odd:0'] });
    assert.deepEqual(blocks.blocks['mod:wall'].states[0].collision, POST);
    assert.deepEqual(blocks.blocks['mod:odd'].states[0].collision, HALF, 'a state not flagged keeps its new value');
    assert.deepEqual(keepWorldDependentCollision(blocks, null), { kept: [], changed: [] });
});

test('the 3.3.4 data keeps the 2026-11-02 collision of the 103 neighbour-dependent states (manifest.import.collisionKept)', () => {
    const cat = new RotnData(path.join(HERE, '../3.3.4'), { version: '3.3.4' });
    const kept = cat.dump.manifest.import.collisionKept;
    assert.equal(kept.length, 103);
    assert.ok(kept.includes('aether_legacy:aerogel_wall:0'));
    assert.deepEqual(cat.getBlock({ name: 'aether_legacy:aerogel_wall', meta: 0 }).state.collision, [[0.25, 0, 0.25, 0.75, 1.5, 0.75]]);
    for (const k of kept) {
        const i = k.lastIndexOf(':');
        assert.equal(cat.getBlock({ name: k.slice(0, i), meta: Number(k.slice(i + 1)) }).state.entityCollisionVaries, true, k);
    }
});
