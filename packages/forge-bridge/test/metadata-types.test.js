// Mod entity-metadata serializers (reid.js METADATA_SERIALIZER_TYPES,
// rotnMetadataSerializers; lead's Phase 2 item 3). Offline: real packet bytes
// from G1 and hand-written golden bytes from each serializer's write() (javap).

import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { buildCustomPackets, createTypeReader, forgeTypes, rotnMetadataSerializers, metadataSerializersFromDump, METADATA_SERIALIZER_TYPES, METADATA_SERIALIZER_CLASSES } from '../src/reid.js';
import { loadRotnData, PACK_VERSION } from '../../rotn-data/index.js';
import { attachForgeBridge } from '../src/bridge.js';
import { FIXTURES, pinnedModList } from './helpers.js';

const require = createRequire(import.meta.url);
const DIR = path.join(FIXTURES, 'rotn-3.3.4');
const hex = (s) => Buffer.from(s.replace(/\s+|\/\/[^\n]*/g, ''), 'hex');

test('the RotN 3.3.4 defaults from the ModList: 14 = AquaAcrobatics pose, 256/257 = DoggyTalents', () => {
    assert.deepEqual(rotnMetadataSerializers(pinnedModList()), {
        14: 'aquaacrobatics:pose', 256: 'doggytalents:talent_level_list', 257: 'doggytalents:optional_text_component',
    });
    assert.deepEqual(rotnMetadataSerializers([]), {});
    for (const name of Object.values(rotnMetadataSerializers(pinnedModList()))) assert.ok(METADATA_SERIALIZER_TYPES[name], name);
});

test('the real G1 player entity_metadata (key 17 = serializer 14) now parses through nmp\'s compiled deserializer', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(DIR, 'entity-metadata-aqua-pose.json'), 'utf8'));
    const pkt = Buffer.from(fixture.hex, 'hex');
    const { createDeserializer } = require('minecraft-protocol/src/transforms/serializer');
    const d = createDeserializer({ state: 'play', isServer: false, version: '1.12.2', customPackets: buildCustomPackets({ reid: true, metadataSerializers: rotnMetadataSerializers(pinnedModList()) }) });
    const p = d.parsePacketBuffer(pkt);
    assert.equal(p.data.name, 'entity_metadata');
    assert.equal(p.metadata.size, pkt.length, 'read to the last byte');
    const byKey = Object.fromEntries(p.data.params.metadata.map((m) => [m.key, m]));
    assert.deepEqual(byKey[17], { key: 17, type: 14, value: 0 }, 'AquaAcrobatics pose STANDING');
    assert.deepEqual(byKey[18], { key: 18, type: 6, value: false });
});

// One metadata entry of `type` with `value` bytes, then the 0xff terminator, read with the type reader.
function readOne(id, name, valueHex) {
    const reader = createTypeReader({ reid: true, metadataSerializers: { [id]: name } });
    const varintId = id < 128 ? hex(id.toString(16).padStart(2, '0')) : hex(((id & 0x7f) | 0x80).toString(16) + (id >> 7).toString(16).padStart(2, '0'));
    const buf = Buffer.concat([hex('05'), varintId, hex(valueHex), hex('ff')]);
    const r = reader.readMetadata(buf, 0);
    assert.equal(r.size, buf.length, `${name}: read to the terminator`);
    return r.value[0].value;
}

test('golden bytes for every mod serializer format (from each write() in the pack)', () => {
    assert.equal(readOne(14, 'aquaacrobatics:pose', '03'), 3);
    assert.deepEqual(readOne(15, 'base:resource_location', '09 6d696e656372616674 05 73746f6e65'), { namespace: 'minecraft', path: 'stone' });
    assert.deepEqual(readOne(17, 'charset:quaternion', '3f800000 00000000 00000000 bf800000'), { w: 1, x: 0, y: 0, z: -1 }, 'w first, as DataSerializersCharset$1 writes it');
    assert.deepEqual(readOne(16, 'mowziesmobs:optional_trade', 'ffffffff0f'), { input: { blockId: -1 } }, 'no trade: an empty input stack only');
    const trade = readOne(16, 'mowziesmobs:optional_trade', '01 02 0000 00   b802 01 0000 00   0000000a');
    assert.equal(trade.input.blockId, 1);
    assert.equal(trade.output.blockId, 312);
    assert.equal(trade.weight, 10);
    assert.equal(readOne(18, 'requious:spark_effect', '00000002'), 2);
    assert.deepEqual(readOne(256, 'doggytalents:talent_level_list', '00000002 0a 646f6767793a62697465 03 0a 646f6767793a6a756d70 01'),
        [{ talent: 'doggy:bite', level: 3 }, { talent: 'doggy:jump', level: 1 }]);
    assert.equal(readOne(257, 'doggytalents:optional_text_component', '01 0e 7b2274657874223a22526578227d'), '{"text":"Rex"}');
    assert.equal(readOne(257, 'doggytalents:optional_text_component', '00'), undefined);
});

test('an unknown name or a vanilla id is refused', () => {
    assert.throws(() => forgeTypes('1.12.2', { 15: 'nope:thing' }), /unknown entity-metadata serializer/);
    assert.throws(() => forgeTypes('1.12.2', { 5: 'aquaacrobatics:pose' }), /is vanilla/);
});

// The real Batch A handshake replayed into a bridge, to fire 'registries'.
function replayRunA(opts) {
    const index = JSON.parse(fs.readFileSync(path.join(DIR, 'handshake-runA.json'), 'utf8'));
    const raw = zlib.brotliDecompressSync(fs.readFileSync(path.join(DIR, 'handshake-runA.bin.br')));
    const client = new EventEmitter();
    client.write = () => true;
    client.setSerializer = () => {};
    const logs = [];
    const bridge = attachForgeBridge(client, { modList: pinnedModList(), log: (m) => logs.push(m), ...opts });
    client.emit('packet', { uuid: '00000000-0000-0000-0000-000000000000', username: 'BOT' }, { name: 'success', state: 'login' }, null, null);
    let off = 0;
    for (const r of index.records) {
        const data = raw.subarray(off, off + r.len);
        off += r.len;
        if (r.dir === 'S2C') client.emit('packet', { channel: r.channel, data }, { name: 'custom_payload', state: 'play' }, null, null);
    }
    return { bridge, logs };
}

test('the Forge-registry serializer ids match what the real server synced; a wrong map is reported', () => {
    const ok = replayRunA({});
    assert.equal(ok.bridge.handshakeDone, true);
    assert.deepEqual(ok.bridge.metadataSerializers, rotnMetadataSerializers(pinnedModList()));
    assert.equal(ok.logs.filter((l) => /entity-metadata serializer/.test(l)).length, 0);

    const bad = replayRunA({ metadataSerializers: { 256: 'doggytalents:optional_text_component', 257: 'doggytalents:talent_level_list' } });
    assert.equal(bad.logs.filter((l) => /entity-metadata serializer 25[67]: expected .* server synced doggytalents:/.test(l)).length, 2);
});

test("the ids come from rotn-data's dump (catalog serializers()): 14-18 and 256/257, each with a known format", () => {
    const dump = loadRotnData(PACK_VERSION).serializers();
    assert.ok(dump, 'rotn-data has the 3.3.4 serializer table');
    const { map, unknown } = metadataSerializersFromDump(dump);
    assert.deepEqual(unknown, [], 'every mod serializer class in the pack has a format');
    assert.deepEqual(map, {
        14: 'aquaacrobatics:pose', 15: 'base:resource_location', 16: 'mowziesmobs:optional_trade',
        17: 'charset:quaternion', 18: 'requious:spark_effect',
        256: 'doggytalents:talent_level_list', 257: 'doggytalents:optional_text_component',
    });
    for (const name of Object.values(METADATA_SERIALIZER_CLASSES)) assert.ok(METADATA_SERIALIZER_TYPES[name], name);
    // 14 is confirmed: the dump agrees with the ModList defaults (G1's inference by fit).
    for (const [id, name] of Object.entries(rotnMetadataSerializers(pinnedModList()))) assert.equal(map[id], name, `id ${id}`);
    // The dump's usage: which entity uses which serializer, at which key.
    const used = Object.fromEntries(Object.entries(dump.usage).map(([e, us]) => [e, us.map((u) => `${u.index}:${map[u.serializerId]}`)]));
    assert.deepEqual(used, {
        'doggytalents:dog': ['21:doggytalents:talent_level_list', '30:doggytalents:optional_text_component'],
        'mowziesmobs:barakoaya': ['16:mowziesmobs:optional_trade'],
        'requious:spear': ['8:requious:spark_effect'],
    });
});

test('metadataSerializersFromDump skips vanilla ids and reports an unknown class', () => {
    const { map, unknown } = metadataSerializersFromDump({ serializers: [
        { id: 3, class: 'net.minecraft.network.datasync.DataSerializers$4', vanilla: true },
        { id: 15, class: 'com.teamacronymcoders.base.entities.dataserializers.ResourceLocationDataSerializer', vanilla: false },
        { id: 19, class: 'some.mod.NewSerializer', vanilla: false },
    ] });
    assert.deepEqual(map, { 15: 'base:resource_location' });
    assert.deepEqual(unknown, [{ id: 19, class: 'some.mod.NewSerializer' }]);
    assert.deepEqual(metadataSerializersFromDump(null), { map: {}, unknown: [] });
});

test("a requious:spear metadata entry at key 8 (serializer 18) parses with the dump's ids", () => {
    const { map } = metadataSerializersFromDump(loadRotnData(PACK_VERSION).serializers());
    const reader = createTypeReader({ reid: true, metadataSerializers: map });
    // key 8, type 18, int ordinal 1; key 16, type 16, an empty trade (no trade); terminator.
    const buf = hex('08 12 00000001   10 10 ffffffff0f   ff');
    const r = reader.readMetadata(buf, 0);
    assert.equal(r.size, buf.length);
    assert.deepEqual(r.value, [{ key: 8, type: 18, value: 1 }, { key: 16, type: 16, value: { input: { blockId: -1 } } }]);
});
