// Forge's two-pass block-state ids (G2 batch 4): the server sends a generated
// double_plant upper half as state 175 << 4 | 11, but a real Forge client (and the
// server's testforblock) sees meta 10. With rotn-data's table on bot.registry, the
// prismarine-chunk patch stores the client's id, so blockAt, findBlocks, palettes and
// block updates agree. Offline: mineflayer's real blocks plugin on a fake bot, the real
// chunk section (-3, -4) y 64-79 from batch 4's capture (sanitized: that section's
// block states and light only), and the table from rotn-data's real catalog API
// (stateMetaRemap().byBlock) over its mini-dump fixture.

import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildStateIdRemap, attachStateIdRemap, stateIdRemapStatus } from '../src/state-remap.js';
import { RotnData, loadRotnData, PACK_VERSION } from '../../rotn-data/index.js';
import { RegistrySnapshot } from '../src/registries.js';
import { extendRegistry } from '../src/registry-extension.js';

const require = createRequire(import.meta.url);
const Registry = require('prismarine-registry');
const blocksPlugin = require('mineflayer/lib/plugins/blocks');
const { Vec3 } = require('vec3');

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rotn-3.3.4');
const SECTION = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'chunk-m3-m4-section4.json'), 'utf8'));
// The table as initBot builds it: { blocks: stateMetaRemap().byBlock }.
const MINI_DUMP = path.join(FIXTURES, '..', '..', '..', '..', 'rotn-data', 'test', 'fixtures', 'mini-dump');
const STUB = { blocks: new RotnData(MINI_DUMP).stateMetaRemap().byBlock };

const DOUBLE_PLANT = 175;
const UPPER = [[-44, 67, -58], [-38, 70, -50], [-36, 71, -50]]; // batch 4's three failed samples
const at = ([x, y, z]) => new Vec3(x, y, z);

// A bot with mineflayer's real blocks plugin, on login, with section 4 of chunk (-3, -4) loaded.
function botWith({ table } = {}) {
    const registry = Registry('1.12.2');
    if (table) attachStateIdRemap(registry, table);
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.registry = registry;
    bot.version = '1.12.2';
    bot.supportFeature = registry.supportFeature;
    bot.game = { dimension: 'overworld', minY: 0, height: 256 };
    bot.entity = { position: new Vec3(-40, 70, -56) };
    blocksPlugin(bot, { version: '1.12.2', hideErrors: false });
    bot._client.emit('login', { dimension: 0 });
    bot._client.emit('map_chunk', {
        x: SECTION.chunkX, z: SECTION.chunkZ, groundUp: false, bitMap: SECTION.bitMap,
        chunkData: Buffer.from(SECTION.chunkData, 'base64'), blockEntities: [],
    });
    return bot;
}

function sectionStates(bot) {
    const out = [];
    const base = new Vec3(SECTION.chunkX * 16, SECTION.sectionY * 16, SECTION.chunkZ * 16);
    for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        out.push(bot.blockAt(base.offset(x, y, z)).stateId);
    }
    return out;
}

// A bot with the real blocks plugin on a given registry, after login, no chunk loaded.
function forgeBot(registry) {
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.registry = registry;
    bot.version = '1.12.2';
    bot.supportFeature = registry.supportFeature;
    bot.game = { dimension: 'overworld', minY: 0, height: 256 };
    bot.entity = { position: new Vec3(0, 65, 0) };
    blocksPlugin(bot, { version: '1.12.2', hideErrors: false });
    bot._client.emit('login', { dimension: 0 });
    return bot;
}

const findPlants = (bot, metadata) => bot.findBlocks({
    matching: (b) => b.type === DOUBLE_PLANT && b.metadata === metadata,
    point: new Vec3(-40, 70, -56), maxDistance: 32, count: 1000,
});

test('the fixture is the real section: upper halves sent as 2811 (meta 11), lower halves 2803', () => {
    const column = new (require('prismarine-chunk')('1.12.2'))();
    column.load(Buffer.from(SECTION.chunkData, 'base64'), SECTION.bitMap, true, false);
    const p = (q) => new Vec3(q[0] - SECTION.chunkX * 16, q[1], q[2] - SECTION.chunkZ * 16);
    for (const q of UPPER) {
        assert.equal(column.getBlockStateId(p(q)), (DOUBLE_PLANT << 4) | 11, String(q));
        assert.equal(column.getBlockStateId(p(q).offset(0, -1, 0)), (DOUBLE_PLANT << 4) | 3, String(q));
    }
});

test('without the table: the bot reads upper double_plant as meta 11 (the network id), as before', () => {
    const bot = botWith();
    for (const q of UPPER) {
        const b = bot.blockAt(at(q));
        assert.deepEqual([b.name, b.type, b.metadata, b.stateId], ['double_plant', DOUBLE_PLANT, 11, (DOUBLE_PLANT << 4) | 11], String(q));
        assert.equal(bot.blockAt(at(q).offset(0, -1, 0)).metadata, 3);
    }
    assert.equal(findPlants(bot, 11).length, 17);
    assert.equal(findPlants(bot, 10).length, 0);
});

test('with the table: upper double_plant reads as meta 10 everywhere (blockAt, stateId, blocksByStateId, findBlocks)', () => {
    const bot = botWith({ table: STUB });
    for (const q of UPPER) {
        const b = bot.blockAt(at(q));
        assert.deepEqual([b.name, b.type, b.metadata, b.stateId], ['double_plant', DOUBLE_PLANT, 10, (DOUBLE_PLANT << 4) | 10], String(q));
        assert.equal(bot.registry.blocksByStateId[b.stateId].name, b.name);
        const lower = bot.blockAt(at(q).offset(0, -1, 0));
        assert.deepEqual([lower.name, lower.metadata, lower.stateId], ['double_plant', 3, (DOUBLE_PLANT << 4) | 3], 'lower half unchanged');
    }
    // findBlocks checks the section palette first, so the palette holds the client's id too.
    const found = findPlants(bot, 10);
    assert.equal(found.length, 17);
    assert.equal(findPlants(bot, 11).length, 0);
    for (const q of UPPER) assert.ok(found.some((v) => v.equals(at(q))), String(q));
    assert.equal(findPlants(bot, 3).length, 17, 'lower halves found as before');
    const column = bot.world.getColumn(SECTION.chunkX, SECTION.chunkZ);
    assert.ok(column.sections[SECTION.sectionY].palette.includes((DOUBLE_PLANT << 4) | 10));
    assert.ok(!column.sections[SECTION.sectionY].palette.includes((DOUBLE_PLANT << 4) | 11));
});

test('with the table, every other block in the section is unchanged', () => {
    const plain = sectionStates(botWith());
    const remapped = sectionStates(botWith({ table: STUB }));
    let changed = 0;
    for (let i = 0; i < plain.length; i++) {
        if (plain[i] === remapped[i]) continue;
        changed++;
        assert.deepEqual([plain[i], remapped[i]], [(DOUBLE_PLANT << 4) | 11, (DOUBLE_PLANT << 4) | 10], `index ${i}`);
    }
    assert.equal(changed, 17);
});

test('block updates go through the table; lower halves, doors and beds are unchanged', () => {
    const bot = botWith({ table: STUB });
    const updates = [];
    bot.on('blockUpdate', (oldBlock, newBlock) => updates.push(newBlock));
    const p = new Vec3(-40, 75, -60); // air in the fixture section
    const put = (stateId) => {
        bot._client.emit('block_change', { location: p, type: stateId });
        return bot.blockAt(p);
    };
    for (const meta of [8, 9, 10, 11]) {
        const b = put((DOUBLE_PLANT << 4) | meta);
        assert.deepEqual([b.name, b.metadata, b.stateId], ['double_plant', 10, (DOUBLE_PLANT << 4) | 10], `network meta ${meta}`);
        assert.equal(updates.at(-1).metadata, 10, 'the blockUpdate event sees the client id too');
    }
    // Not in the table: unchanged, including other blocks' meta 8-11.
    const unchanged = [
        ['double_plant', DOUBLE_PLANT, 3], ['double_plant', DOUBLE_PLANT, 2], ['double_plant', DOUBLE_PLANT, 5],
        ['bed', 26, 10], ['bed', 26, 2], ['bed', 26, 11], // head (8 | facing) and foot
        ['iron_door', 71, 8], ['iron_door', 71, 3], // upper (8 | hinge | powered) and lower
        ['wooden_door', 64, 11], ['wooden_door', 64, 9], ['wooden_door', 64, 0],
        ['tallgrass', 31, 1], ['tallgrass', 31, 2],
    ];
    for (const [name, id, meta] of unchanged) {
        const b = put((id << 4) | meta);
        assert.deepEqual([b.name, b.metadata, b.stateId], [name, meta, (id << 4) | meta], `${name} ${meta}`);
    }
    // multi_block_change (1.12 records) goes the same way.
    bot._client.emit('multi_block_change', {
        chunkX: SECTION.chunkX, chunkZ: SECTION.chunkZ,
        records: [{ horizontalPos: (8 << 4) | 4, y: 75, blockId: (DOUBLE_PLANT << 4) | 11 }, { horizontalPos: (9 << 4) | 4, y: 75, blockId: (26 << 4) | 10 }],
    });
    assert.equal(bot.blockAt(new Vec3(-40, 75, -60)).metadata, 10);
    assert.equal(bot.blockAt(new Vec3(-39, 75, -60)).metadata, 10, 'bed head 10 stays 10');
    assert.equal(bot.blockAt(new Vec3(-39, 75, -60)).name, 'bed');
});

test('global-palette sections (more than 8 bits) are remapped too, and nothing else in them', () => {
    const plainRegistry = Registry('1.12.2');
    const remapRegistry = Registry('1.12.2');
    attachStateIdRemap(remapRegistry, STUB);
    const Plain = require('prismarine-chunk')(plainRegistry);
    const Remapping = require('prismarine-chunk')(remapRegistry);
    const source = new Plain();
    const state = (i) => (i === 7 ? (DOUBLE_PLANT << 4) | 11 : i === 8 ? (26 << 4) | 10 : 16 + i); // 300 distinct ids
    for (let i = 0; i < 300; i++) source.setBlockStateId(new Vec3(i & 15, i >> 8, (i >> 4) & 15), state(i));
    assert.equal(source.sections[0].palette, null, 'the section uses the global palette');
    const loaded = new Remapping();
    loaded.load(source.dump(), source.getMask(), true, false);
    for (let i = 0; i < 300; i++) {
        const want = i === 7 ? (DOUBLE_PLANT << 4) | 10 : state(i);
        assert.equal(loaded.getBlockStateId(new Vec3(i & 15, i >> 8, (i >> 4) & 15)), want, `index ${i}`);
    }
    // A local write holds a client id already and is never remapped.
    loaded.setBlockStateId(new Vec3(1, 0, 0), (DOUBLE_PLANT << 4) | 9);
    assert.equal(loaded.getBlockStateId(new Vec3(1, 0, 0)), (DOUBLE_PLANT << 4) | 9);
});

test('global-palette data: a target that does not fit the section bit width is left as sent, counted and logged once', (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const registry = Registry('1.12.2');
    const Plain = require('prismarine-chunk')(Registry('1.12.2'));
    const source = new Plain();
    for (let i = 0; i < 300; i++) source.setBlockStateId(new Vec3(i & 15, i >> 8, (i >> 4) & 15), 16 + i);
    // Two positions hold 17, one holds 18 (index 0 is 16, index 1 is 17, index 2 is 18).
    source.setBlockStateId(new Vec3(3, 0, 0), 17);
    const bits = source.sections[0].data.getBitsPerValue();
    assert.equal(source.sections[0].palette, null, 'the section uses the global palette');
    // Hand-built: buildStateIdRemap only makes same-block entries, which always fit.
    const tooWide = 2 ** bits;
    registry.stateIdRemap = new Map([[17, tooWide], [18, 33]]);
    const loaded = new (require('prismarine-chunk')(registry))();
    loaded.load(source.dump(), source.getMask(), true, false);
    const id = (x) => loaded.getBlockStateId(new Vec3(x, 0, 0));
    assert.deepEqual([id(0), id(1), id(2), id(3)], [16, 17, 33, 17]);
    assert.equal(registry.stateIdRemap.skippedTooWide, 2);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(warn.mock.calls[0].arguments[0], new RegExp(`target ${tooWide} \\(from 17\\) does not fit the section's ${bits} bits`));
});

test("buildStateIdRemap: rotn-data's table, by registry name, with the synced id", () => {
    const { map, blocks, unknownBlocks, invalid } = buildStateIdRemap(Registry('1.12.2'), STUB);
    assert.deepEqual([...map].sort((a, b) => a[0] - b[0]), [[2808, 2810], [2809, 2810], [2811, 2810]]);
    assert.deepEqual([blocks, unknownBlocks, invalid], [['minecraft:double_plant'], [], []]);
    // A modded block uses the id the server synced (registry-extension's full-name entries).
    const modded = buildStateIdRemap({ blocksByName: { 'somemod:tall_thing': { id: 4100 } } }, { blocks: { 'somemod:tall_thing': { 12: 13 } } });
    assert.deepEqual([...modded.map], [[(4100 << 4) | 12, (4100 << 4) | 13]]);
});

test('buildStateIdRemap: the table is taken literally (chains and cycles as is); unknown blocks and bad entries are skipped; no table, no map', () => {
    const registry = Registry('1.12.2');
    const r = buildStateIdRemap(registry, {
        blocks: {
            'nosuchmod:block': { 1: 2 },
            'minecraft:double_plant': { 8: 10, 16: 1, x: 1, 9: 'ten', 10: 10 },
            'minecraft:bed': { 1: 2, 2: 3 }, // a chain: network 1 is client 2, network 2 is client 3
            'minecraft:iron_door': { 1: 2, 2: 1 }, // a cycle (swap)
        },
    });
    assert.deepEqual(r.unknownBlocks, ['nosuchmod:block']);
    assert.deepEqual(r.invalid.sort(), ['minecraft:double_plant 16 -> 1', 'minecraft:double_plant 9 -> ten', 'minecraft:double_plant x -> 1'].sort());
    assert.deepEqual(r.conflicts, []);
    assert.deepEqual([...r.map].sort((a, b) => a[0] - b[0]), [
        [(26 << 4) | 1, (26 << 4) | 2], [(26 << 4) | 2, (26 << 4) | 3],
        [(71 << 4) | 1, (71 << 4) | 2], [(71 << 4) | 2, (71 << 4) | 1],
        [2808, 2810],
    ]);
    assert.deepEqual(r.blocks, ['minecraft:double_plant', 'minecraft:bed', 'minecraft:iron_door']);
    for (const table of [null, undefined, {}, { blocks: null }]) assert.equal(buildStateIdRemap(registry, table).map.size, 0);
});

test('buildStateIdRemap: only true conflicts (one network id, two different client ids) are skipped, and logged', () => {
    // Two table names resolving to one synced block (an alias) is the only way to get one.
    const registry = { blocksByName: { 'mod:a': { id: 900 }, 'mod:a_alias': { id: 900 }, 'mod:b': { id: 901 } } };
    const table = { blocks: { 'mod:a': { 1: 2, 3: 4 }, 'mod:a_alias': { 1: 5, 3: 4 }, 'mod:b': { 0: 1, 1: 0 } } };
    const r = buildStateIdRemap(registry, table);
    assert.deepEqual(r.conflicts, ['network id 14401: mod:a 1 -> 2 vs mod:a_alias 1 -> 5']);
    assert.equal(r.map.has((900 << 4) | 1), false, 'the conflicting id is left unmapped');
    assert.equal(r.map.get((900 << 4) | 3), (900 << 4) | 4, 'the same target from both names is not a conflict');
    assert.equal(r.map.get((901 << 4) | 0), (901 << 4) | 1);
    assert.equal(r.map.get((901 << 4) | 1), (901 << 4) | 0);
    const lines = [];
    const report = attachStateIdRemap(registry, table, { log: (l) => lines.push(l) });
    assert.deepEqual(lines, ['state-id remap: conflict, network id 14401: mod:a 1 -> 2 vs mod:a_alias 1 -> 5; skipped']);
    assert.equal(stateIdRemapStatus(report), "state-id remap active: applied 3 state ids in 2 of the table's 3 blocks; conflicts 1 skipped");
});

test("rotn-data's real 3.3.4 table: every entry applies, including those in cycles and chains; no conflicts", () => {
    const byBlock = loadRotnData(PACK_VERSION).stateMetaRemap().byBlock;
    const names = Object.keys(byBlock);
    // A registry that syncs every table block (ids are arbitrary but distinct).
    const registry = { blocksByName: Object.fromEntries(names.map((n, i) => [n, { id: 1000 + i }])) };
    const r = buildStateIdRemap(registry, { blocks: byBlock });
    const entries = names.flatMap((n) => Object.entries(byBlock[n]).filter(([m, to]) => Number(m) !== to));
    assert.deepEqual([r.conflicts, r.invalid, r.unknownBlocks], [[], [], []]);
    assert.equal(r.map.size, entries.length);
    assert.equal(r.blocks.length, names.length);
    assert.deepEqual(byBlock['pyrotech:worktable'], { 0: 1, 1: 2, 2: 0 });
});

test("rotn-data's mini-dump table is the double_plant entry", () => {
    assert.deepEqual(STUB, { blocks: { 'minecraft:double_plant': { 8: 10, 9: 10, 11: 10 } } });
});

test('attachStateIdRemap sets registry.stateIdRemap, removes it for an empty table, and logs only skipped names', () => {
    const registry = Registry('1.12.2');
    const lines = [];
    const report = attachStateIdRemap(registry, STUB, { log: (l) => lines.push(l) });
    assert.equal(registry.stateIdRemap.get(2811), 2810);
    assert.deepEqual(report, { tableBlocks: 1, blocks: ['minecraft:double_plant'], unknownBlocks: [], invalid: [], conflicts: [], size: 3 });
    assert.deepEqual(lines, []);
    attachStateIdRemap(registry, { blocks: { 'nosuchmod:block': { 1: 2 } } }, { log: (l) => lines.push(l) });
    assert.deepEqual(lines, ['state-id remap: nosuchmod:block is not in the synced registry; skipped']);
    assert.equal('stateIdRemap' in registry, false);
    attachStateIdRemap(registry, null);
    assert.equal('stateIdRemap' in registry, false);
});

test("stateIdRemapStatus: the login line says whether the remap is active and what it covers", () => {
    const registry = Registry('1.12.2');
    assert.equal(stateIdRemapStatus(attachStateIdRemap(registry, STUB)), "state-id remap active: applied 3 state ids in 1 of the table's 1 blocks; conflicts 0 skipped");
    assert.equal(stateIdRemapStatus(attachStateIdRemap(registry, null)), "state-id remap inactive: rotn-data's dump has no state-meta-remap table; block state ids are used as sent");
    assert.equal(stateIdRemapStatus(attachStateIdRemap(registry, { blocks: { 'a:b': { 1: 2 }, 'c:d': { 1: 2 } } })), "state-id remap inactive: nothing applied from the table's 2 blocks (not in the synced registry: 2; conflicts 0 skipped); block state ids are used as sent");
    assert.equal(stateIdRemapStatus(undefined), 'state-id remap inactive: no Forge registry sync; block state ids are used as sent');
});

test('one rotn-data table, two servers with different synced ids for the same block: each remap uses its own server\'s ids (#82)', () => {
    // #82: Quark's colored flowerpots are 1203-1218 on the test server but 1263-1278 in the
    // registry capture. The table is keyed by name, so each connection must build its map
    // from the ids its own server synced (here the flowerpot entry is illustrative).
    const FLOWERPOT = 'quark:colored_flowerpot_white';
    const table = { blocks: { ...STUB.blocks, [FLOWERPOT]: { 9: 1 } } };
    const serverWith = (flowerpotId) => {
        const registry = Registry('1.12.2');
        const snap = new RegistrySnapshot();
        snap.add({ name: 'minecraft:blocks', ids: [['minecraft:air', 0], ['minecraft:stone', 1], ['minecraft:double_plant', DOUBLE_PLANT], [FLOWERPOT, flowerpotId]], dummied: [], overrides: [], hasMore: false });
        extendRegistry(registry, snap);
        assert.equal(registry.blocksByName[FLOWERPOT].id, flowerpotId);
        return registry;
    };
    const testServer = serverWith(1203);
    const capture = serverWith(1263);
    const a = attachStateIdRemap(testServer, table);
    const b = attachStateIdRemap(capture, table);
    assert.equal(a.size, 4);
    assert.equal(b.size, 4);
    const sorted = (m) => [...m].sort((x, y) => x[0] - y[0]);
    assert.deepEqual(sorted(testServer.stateIdRemap), [[2808, 2810], [2809, 2810], [2811, 2810], [(1203 << 4) | 9, (1203 << 4) | 1]]);
    assert.deepEqual(sorted(capture.stateIdRemap), [[2808, 2810], [2809, 2810], [2811, 2810], [(1263 << 4) | 9, (1263 << 4) | 1]]);
    assert.ok(!testServer.stateIdRemap.has((1263 << 4) | 9), "the other server's id is not in this server's map");
    assert.ok(!capture.stateIdRemap.has((1203 << 4) | 9));

    // Through the patched chunk load: each column remaps its own server's id and leaves the other's alone.
    for (const [registry, own, other] of [[testServer, 1203, 1263], [capture, 1263, 1203]]) {
        const sent = new (require('prismarine-chunk')('1.12.2'))();
        sent.setBlockStateId(new Vec3(0, 64, 0), (own << 4) | 9);
        sent.setBlockStateId(new Vec3(1, 64, 0), (other << 4) | 9);
        const column = new (require('prismarine-chunk')(registry))();
        column.load(sent.dump(), sent.getMask(), true, true);
        assert.equal(column.getBlockStateId(new Vec3(0, 64, 0)), (own << 4) | 1, `server with ${own}`);
        assert.equal(column.getBlockStateId(new Vec3(1, 64, 0)), (other << 4) | 9, `server with ${own}: id ${other} is some other block here`);
    }
});

test('pyrotech:worktable (0 -> 1, 1 -> 2, 2 -> 0) reads correctly through chunk load and block_change, and nothing is remapped twice', () => {
    const WORKTABLE = 1500;
    const registry = Registry('1.12.2');
    const snap = new RegistrySnapshot();
    snap.add({ name: 'minecraft:blocks', ids: [['minecraft:air', 0], ['minecraft:stone', 1], ['pyrotech:worktable', WORKTABLE]], dummied: [], overrides: [], hasMore: false });
    extendRegistry(registry, snap);
    const report = attachStateIdRemap(registry, { blocks: loadRotnData(PACK_VERSION).stateMetaRemap().byBlock });
    assert.ok(report.blocks.includes('pyrotech:worktable'));
    assert.deepEqual(report.conflicts, []);
    const net = (m) => (WORKTABLE << 4) | m;

    const bot = forgeBot(registry);
    // The server sends network metas 0, 1, 2 in a chunk (palette) ...
    const sent = new (require('prismarine-chunk')('1.12.2'))();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) sent.setBlockStateId(new Vec3(x, 64, z), 1 << 4);
    [0, 1, 2].forEach((m, i) => sent.setBlockStateId(new Vec3(i, 65, 0), net(m)));
    const sendChunk = () => bot._client.emit('map_chunk', { x: 0, z: 0, groundUp: true, bitMap: sent.getMask(), chunkData: sent.dump(), blockEntities: [] });
    sendChunk();
    const meta = (x, y = 65, z = 0) => bot.blockAt(new Vec3(x, y, z)).metadata;
    assert.deepEqual([meta(0), meta(1), meta(2)], [1, 2, 0], 'chunk load');
    assert.equal(bot.blockAt(new Vec3(0, 65, 0)).name, 'pyrotech:worktable');
    // ... and in block_change and multi_block_change.
    [0, 1, 2].forEach((m, i) => bot._client.emit('block_change', { location: { x: i, y: 66, z: 0 }, type: net(m) }));
    assert.deepEqual([meta(0, 66), meta(1, 66), meta(2, 66)], [1, 2, 0], 'block_change');
    bot._client.emit('multi_block_change', { chunkX: 0, chunkZ: 0, records: [0, 1, 2].map((m, i) => ({ horizontalPos: (i << 4) | 1, y: 66, blockId: net(m) })) });
    assert.deepEqual([meta(0, 66, 1), meta(1, 66, 1), meta(2, 66, 1)], [1, 2, 0], 'multi_block_change');

    // Network data sent again gives the same result. This is a consistency check only: it
    // cannot catch a double remap, because block_change and load each decode fresh network
    // bytes (load replaces the sections), so a stray remap would have nothing stale to act on.
    bot._client.emit('block_change', { location: { x: 0, y: 66, z: 0 }, type: net(0) });
    assert.equal(meta(0, 66), 1);
    sendChunk();
    assert.deepEqual([meta(0), meta(1), meta(2)], [1, 2, 0], 'the same chunk again');
    // The real double-remap test: local writes of client ids (mineflayer's digging and sign
    // updates, pathfinder) must never be remapped.
    const column = bot.world.getColumn(0, 0);
    for (const x of [0, 1, 2]) {
        const p = new Vec3(x, 65, 0);
        const before = bot.blockAt(p).stateId;
        // Checked after each write: the worktable is a 3-cycle, so three stray remaps in a
        // row would land back on the start and hide the bug.
        const writes = [
            ['digging (bot._updateBlockState)', () => bot._updateBlockState(p, before)],
            ["update_sign's column.setBlock (type, then metadata)", () => column.setBlock(p, bot.blockAt(p))],
            ["pathfinder's world.setBlockStateId", () => bot.world.setBlockStateId(p, before)],
            ['column.setBlockType', () => column.setBlockType(p, WORKTABLE)],
            ['column.setBlockData', () => column.setBlockData(p, before & 15)],
        ];
        for (const [what, write] of writes) {
            write();
            assert.equal(bot.blockAt(p).stateId, before, `x ${x}: ${what} must not remap a client id`);
        }
    }
    assert.deepEqual([meta(0), meta(1), meta(2)], [1, 2, 0]);
});
