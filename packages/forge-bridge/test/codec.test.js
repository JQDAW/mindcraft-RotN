import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reader, Writer, encodeVarInt } from '../src/wire.js';
import * as hs from '../src/fml-hs.js';
import { modListFromPing, hasReid, findMod, diffModLists } from '../src/modlist.js';
import { pinnedModList, syntheticRegistries } from './helpers.js';
import fs from 'node:fs';
import { PING_FIXTURE } from './helpers.js';

test('VarInt round-trips, including negatives and the -1 empty-slot marker', () => {
    for (const v of [0, 1, 127, 128, 255, 300, 4095, 32000, 2097151, 2147483647, -1, -2147483648]) {
        const buf = encodeVarInt(v);
        const r = new Reader(buf);
        assert.equal(r.varint(), v, `value ${v}`);
        assert.equal(r.remaining, 0);
    }
    assert.deepEqual([...encodeVarInt(-1)], [0xff, 0xff, 0xff, 0xff, 0x0f]);
    assert.deepEqual([...encodeVarInt(300)], [0xac, 0x02]);
});

test('VarInt respects Forge byte caps', () => {
    const r = new Reader(encodeVarInt(70000)); // 3 bytes
    assert.throws(() => r.varint(2), /VarInt too big/);
});

test('strings are VarInt-length UTF-8', () => {
    const buf = new Writer().string('FML|HS').string('héllo').toBuffer();
    const r = new Reader(buf);
    assert.equal(r.string(), 'FML|HS');
    assert.equal(r.string(), 'héllo');
});

test('reader refuses to read past the end', () => {
    assert.throws(() => new Reader(Buffer.from([1, 2])).i32(), /read past end/);
});

test('ServerHello with protocol 2 carries overrideDimension', () => {
    const m = hs.decodeHandshake(hs.encodeServerHello(2, -1));
    assert.deepEqual(m, { type: 'ServerHello', disc: 0, fmlProtocol: 2, overrideDimension: -1 });
    const old = hs.decodeHandshake(hs.encodeServerHello(1));
    assert.equal(old.overrideDimension, 0);
});

test('ClientHello, Ack and Reset bytes match the Forge codec', () => {
    assert.deepEqual([...hs.encodeClientHello()], [0x01, 0x02]);
    assert.deepEqual([...hs.encodeAck(2)], [0xff, 0x02]);
    assert.deepEqual([...hs.encodeAck(5)], [0xff, 0x05]);
    assert.deepEqual([...hs.encodeReset()], [0xfe]);
    assert.deepEqual(hs.decodeHandshake(Buffer.from([0xff, 0x03])), { type: 'HandshakeAck', disc: -1, phase: 3 });
    assert.deepEqual(hs.decodeHandshake(Buffer.from([0xfe])), { type: 'HandshakeReset', disc: -2 });
});

test('ModList round-trips the pinned 346-entry RotN 3.3.4 list', () => {
    const mods = pinnedModList();
    assert.equal(mods.length, 346);
    const m = hs.decodeHandshake(hs.encodeModList(mods));
    assert.equal(m.type, 'ModList');
    assert.deepEqual(m.mods, mods);
});

test('RegistryData decodes ids, then dummied, then overrides (Forge 14.23.5 order)', () => {
    for (const reg of syntheticRegistries()) {
        const m = hs.decodeHandshake(hs.encodeRegistryData({ hasMore: true, ...reg }));
        assert.equal(m.type, 'RegistryData');
        assert.equal(m.name, reg.name);
        assert.deepEqual(m.ids, reg.ids);
        assert.deepEqual(m.dummied, reg.dummied);
        assert.deepEqual(m.overrides, reg.overrides);
        assert.equal(m.trailing, 0);
    }
});

test('unknown FML|HS discriminator throws', () => {
    assert.throws(() => hs.decodeHandshake(Buffer.from([0x09])), /unknown FML\|HS discriminator/);
});

test('pinned ping fixture: FML modinfo with REID as jeid 2.2.2 and Forge 14.23.5.2860', () => {
    const ping = JSON.parse(fs.readFileSync(PING_FIXTURE, 'utf8'));
    assert.equal(ping.version.protocol, 340);
    const mods = modListFromPing(ping);
    assert.ok(hasReid(mods));
    assert.equal(findMod(mods, 'jeid').version, '2.2.2');
    assert.equal(findMod(mods, 'forge').version, '14.23.5.2860');
    assert.equal(findMod(mods, 'roughlyenoughids'), null);
    assert.equal(modListFromPing({ version: {}, description: 'vanilla' }), null);
});

test('diffModLists reports missing, extra and version mismatches', () => {
    const d = diffModLists(
        [{ modid: 'a', version: '1' }, { modid: 'b', version: '1' }, { modid: 'x', version: '1' }],
        [{ modid: 'a', version: '1' }, { modid: 'b', version: '2' }, { modid: 'c', version: '1' }],
    );
    assert.deepEqual(d.missingOnClient, ['c']);
    assert.deepEqual(d.extraOnClient, ['x']);
    assert.deepEqual(d.versionMismatch, [{ modid: 'b', client: '1', server: '2' }]);
    assert.equal(d.equal, false);
    assert.equal(diffModLists(pinnedModList(), pinnedModList()).equal, true);
});
