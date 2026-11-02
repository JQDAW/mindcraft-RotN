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
import { RotnData } from '../../rotn-data/index.js';

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
    // Local writes into a global-palette section go through the table as well.
    loaded.setBlockStateId(new Vec3(1, 0, 0), (DOUBLE_PLANT << 4) | 9);
    assert.equal(loaded.getBlockStateId(new Vec3(1, 0, 0)), (DOUBLE_PLANT << 4) | 10);
});

test("buildStateIdRemap: rotn-data's table, by registry name, with the synced id", () => {
    const { map, blocks, unknownBlocks, invalid } = buildStateIdRemap(Registry('1.12.2'), STUB);
    assert.deepEqual([...map].sort((a, b) => a[0] - b[0]), [[2808, 2810], [2809, 2810], [2811, 2810]]);
    assert.deepEqual([blocks, unknownBlocks, invalid], [['minecraft:double_plant'], [], []]);
    // A modded block uses the id the server synced (registry-extension's full-name entries).
    const modded = buildStateIdRemap({ blocksByName: { 'somemod:tall_thing': { id: 4100 } } }, { blocks: { 'somemod:tall_thing': { 12: 13 } } });
    assert.deepEqual([...modded.map], [[(4100 << 4) | 12, (4100 << 4) | 13]]);
});

test('buildStateIdRemap: unknown blocks and bad entries are skipped; chains resolve; cycles drop; no table, no map', () => {
    const registry = Registry('1.12.2');
    const r = buildStateIdRemap(registry, {
        blocks: {
            'nosuchmod:block': { 1: 2 },
            'minecraft:double_plant': { 8: 10, 16: 1, x: 1, 9: 'ten', 10: 10 },
            'minecraft:bed': { 1: 2, 2: 3 }, // chain: 1 -> 3, 2 -> 3
            'minecraft:iron_door': { 1: 2, 2: 1 }, // cycle
        },
    });
    assert.deepEqual(r.unknownBlocks, ['nosuchmod:block']);
    assert.deepEqual(r.invalid.sort(), ['minecraft:double_plant 16 -> 1', 'minecraft:double_plant 9 -> ten', 'minecraft:double_plant x -> 1', 'minecraft:iron_door 1: cycle', 'minecraft:iron_door 2: cycle'].sort());
    assert.deepEqual([...r.map].sort((a, b) => a[0] - b[0]), [[(26 << 4) | 1, (26 << 4) | 3], [(26 << 4) | 2, (26 << 4) | 3], [2808, 2810]]);
    for (const [, to] of r.map) assert.ok(!r.map.has(to), 'applying the map twice changes nothing');
    for (const table of [null, undefined, {}, { blocks: null }]) assert.equal(buildStateIdRemap(registry, table).map.size, 0);
});

test("rotn-data's mini-dump table is the double_plant entry", () => {
    assert.deepEqual(STUB, { blocks: { 'minecraft:double_plant': { 8: 10, 9: 10, 11: 10 } } });
});

test('attachStateIdRemap sets registry.stateIdRemap, removes it for an empty table, and logs only skipped names', () => {
    const registry = Registry('1.12.2');
    const lines = [];
    const report = attachStateIdRemap(registry, STUB, { log: (l) => lines.push(l) });
    assert.equal(registry.stateIdRemap.get(2811), 2810);
    assert.deepEqual(report, { tableBlocks: 1, blocks: ['minecraft:double_plant'], unknownBlocks: [], invalid: [], size: 3 });
    assert.deepEqual(lines, []);
    attachStateIdRemap(registry, { blocks: { 'nosuchmod:block': { 1: 2 } } }, { log: (l) => lines.push(l) });
    assert.deepEqual(lines, ['state-id remap: nosuchmod:block is not in the synced registry; skipped']);
    assert.equal('stateIdRemap' in registry, false);
    attachStateIdRemap(registry, null);
    assert.equal('stateIdRemap' in registry, false);
});

test("stateIdRemapStatus: the login line says whether the remap is active and what it covers", () => {
    const registry = Registry('1.12.2');
    assert.equal(stateIdRemapStatus(attachStateIdRemap(registry, STUB)), "state-id remap active: 3 state ids in 1 of the table's 1 blocks");
    assert.equal(stateIdRemapStatus(attachStateIdRemap(registry, null)), "state-id remap inactive: rotn-data's dump has no state-meta-remap table; block state ids are used as sent");
    assert.equal(stateIdRemapStatus(attachStateIdRemap(registry, { blocks: { 'a:b': { 1: 2 }, 'c:d': { 1: 2 } } })), "state-id remap inactive: none of the table's 2 blocks is in the synced registry; block state ids are used as sent");
    assert.equal(stateIdRemapStatus(undefined), 'state-id remap inactive: no Forge registry sync; block state ids are used as sent');
});
