// StackUp item counts (src/stackup.js): reproduces the G3 round 3 batch C+D disconnect
// offline, byte for byte, and checks the fix.
//
// The server side is modelled by a small reader written from the server's bytecode (javap on
// the pinned pack's jars; see stackup.js): NettyPacketDecoder (VarInt packet id, then
// readPacketData, then "larger than I expected" if bytes are left), CPacketClickWindow
// (u8 window, short slot, byte button, short action, byte mode, item stack), CPacketConfirmTeleport
// (VarInt id), and PacketBuffer.readItemStack as StackUp splices it, with REID's VarInt id:
// VarInt id (-1 empty), byte count (-42: an int follows), short damage, NBT (0 = none).
// Netty's bounds message is "readerIndex(r) + length(n) exceeds writerIndex(w)".

import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { buildCustomPackets, createTypeReader, slotType, assertPristineProtocol } from '../src/reid.js';
import { readStackUpCount, writeStackUpCount, sizeOfStackUpCount, STACKUP_COUNT_TYPE, STACKUP_MARKER, STACKUP_BYTE_MAX, STACKUP_VERSION } from '../src/stackup.js';
import { attachForgeBridge } from '../src/bridge.js';
import { pinnedModList } from './helpers.js';

const require = createRequire(import.meta.url);
const { createSerializer, createDeserializer } = require('minecraft-protocol/src/transforms/serializer');
const { PartialReadError } = require('protodef').utils;

// minecraft-data's 1.12.2 protocol as it is before any test here compiles one (nmp's merge
// changes it in place). reid.js is imported above, so its own load-time check already passed.
const PRISTINE = JSON.parse(JSON.stringify(require('minecraft-data')('1.12.2').protocol));
const JAVAP = fs.readFileSync(new URL('./fixtures/stackup-0.2.5/PacketBufferWriterSplice.javap.txt', import.meta.url), 'utf8');

const hex = (s) => Buffer.from(s.replace(/\s+|\/\/[^\n]*/g, ''), 'hex');

// ---- the server's reader (Forge 1.12.2 + REID 2.2.2 + StackUp 0.2.5) ----

class ServerBuf {
    constructor(b) { this.b = b; this.r = 0; }
    need(n) {
        if (this.r + n > this.b.length) {
            const e = new Error(`readerIndex(${this.r}) + length(${n}) exceeds writerIndex(${this.b.length})`);
            e.readerIndex = this.r;
            throw e;
        }
    }
    byte() { this.need(1); return this.b.readInt8(this.r++); }
    ubyte() { this.need(1); return this.b.readUInt8(this.r++); }
    short() { this.need(2); const v = this.b.readInt16BE(this.r); this.r += 2; return v; }
    int() { this.need(4); const v = this.b.readInt32BE(this.r); this.r += 4; return v; }
    varint() {
        let v = 0;
        for (let i = 0; i < 5; i++) { const b = this.ubyte(); v |= (b & 0x7f) << (7 * i); if (!(b & 0x80)) return v | 0; }
        throw new Error('VarInt too big');
    }
    itemStack() {
        const id = this.varint(); // REID: readShort redirected to readVarInt
        if (id < 0) return null;
        let count = this.byte(); // PacketBufferWriterSplice.readItemStack line 43
        if (count === -42) count = this.int(); // lines 44-45
        const damage = this.short();
        if (this.byte() !== 0) throw new Error('NBT not modelled in this test');
        return { id, count, damage };
    }
}

const NAMES = { 0: 'CPacketConfirmTeleport', 7: 'CPacketClickWindow' };

/** NettyPacketDecoder.decode on one frame (packet id + body); throws like the server. */
function serverDecode(bytes) {
    const b = new ServerBuf(bytes);
    const id = b.varint();
    let packet;
    if (id === 0) packet = { teleportId: b.varint() };
    else if (id === 7) packet = { windowId: b.ubyte(), slot: b.short(), button: b.byte(), action: b.short(), mode: b.byte(), item: b.itemStack() };
    else throw new Error(`packet ${id} not modelled`);
    if (b.r < bytes.length) throw new Error(`Packet 0/${id} (${NAMES[id]}) was larger than I expected, found ${bytes.length - b.r} bytes extra whilst reading packet ${id}`);
    return { id, ...packet };
}

/** The server's decoder after a failed read: Netty keeps the unread bytes and decodes them again on channel close. */
function serverDecodeWithLeftover(bytes) {
    const errors = [];
    try { return { packet: serverDecode(bytes), errors }; } catch (e) {
        errors.push(e.message);
        if (e.readerIndex !== undefined) {
            try { serverDecode(bytes.subarray(e.readerIndex)); } catch (e2) { errors.push(e2.message); }
        }
    }
    return { packet: null, errors };
}

// ---- the bytes ----

// set_slot from the server for 65 pyrotech:rock (REID id 8917) in hotbar slot 36, written by
// StackUp's writeItemStack (count > 64: byte -42, then int).
const ROCKS_65 = hex(`
    d5 45          // VarInt 8917
    d6             // -42: StackUp marker
    00 00 00 41    // int count 65
    00 00          // damage 0
    00             // no NBT
`);
const CLICK = { windowId: 0, slot: 36, mouseButton: 0, action: 1, mode: 0 };

test('reproduces the batch C+D disconnect: an i8 count echoes StackUp\'s -42 marker without its int', () => {
    // Before the fix: the slot count was a plain i8 (REID id only).
    const oldReader = createTypeReader({ reid: true });
    const { value: item, size } = oldReader.read(ROCKS_65, 0, 'slot');
    assert.equal(item.itemCount, -42, 'the marker read as the count');
    assert.equal(item.itemDamage, 0, 'the first two bytes of the int read as damage');
    assert.equal(size, 6, 'four bytes of the stack left unread');

    // mineflayer clicks that slot and sends the stack back as it read it. (The window_click
    // header is u8 0, i16 36, i8 0, i16 1, i8 0 after packet id 0x07; the compiled protocol
    // in this process has the fix, so the old slot comes from the old type reader.)
    const bytes = Buffer.concat([hex('07 00 0024 00 0001 00'), oldReader.write('slot', item)]);
    assert.equal(bytes.length, 14);
    assert.deepEqual(bytes, hex('07 00 0024 00 0001 00   d5 45 d6 0000 00'));

    // Both server errors from latest.log (02:56:26 and 02:57:04), in order.
    assert.deepEqual(serverDecodeWithLeftover(bytes).errors, [
        'readerIndex(11) + length(4) exceeds writerIndex(14)',
        'Packet 0/0 (CPacketConfirmTeleport) was larger than I expected, found 1 bytes extra whilst reading packet 0',
    ]);
});

test('fixed: StackUp counts round-trip through the compiled protocol and the server accepts the click', () => {
    const customPackets = buildCustomPackets({ reid: true, stackup: true });
    const des = createDeserializer({ state: 'play', isServer: false, version: '1.12.2', customPackets });
    const setSlot = des.parsePacketBuffer(Buffer.concat([hex('16 00 0024'), ROCKS_65]));
    assert.equal(setSlot.data.name, 'set_slot');
    assert.deepEqual(setSlot.data.params.item, { blockId: 8917, itemCount: 65, itemDamage: 0, nbtData: undefined });

    const ser = createSerializer({ state: 'play', isServer: false, version: '1.12.2', customPackets });
    for (const count of [1, 64, 65, 127, 128, 256, 1024]) {
        const bytes = ser.createPacketBuffer({ name: 'window_click', params: { ...CLICK, item: { blockId: 8917, itemCount: count, itemDamage: 0 } } });
        const { packet, errors } = serverDecodeWithLeftover(bytes);
        assert.deepEqual(errors, [], `count ${count}`);
        assert.deepEqual(packet.item, { id: 8917, count, damage: 0 }, `count ${count}`);
    }
    const rocks = ser.createPacketBuffer({ name: 'window_click', params: { ...CLICK, item: setSlot.data.params.item } });
    assert.deepEqual(rocks, Buffer.concat([hex('07 00 0024 00 0001 00'), ROCKS_65]), 'the click carries the stack exactly as the server wrote it');
});

test('golden StackUp count bytes (PacketBufferWriterSplice writeItemStack 28-71 / readItemStack 13-28)', () => {
    const cases = [[0, '00'], [1, '01'], [64, '40'], [65, 'd6 00000041'], [256, 'd6 00000100'], [-1, 'd6 ffffffff'], [-42, 'd6 ffffffd6']];
    for (const [count, h] of cases) {
        const want = hex(h);
        const buf = Buffer.alloc(sizeOfStackUpCount(count));
        assert.equal(writeStackUpCount(count, buf, 0), want.length, `write ${count}`);
        assert.deepEqual(buf, want, `bytes of ${count}`);
        assert.deepEqual(readStackUpCount(want, 0), { value: count, size: want.length }, `read ${h}`);
    }
    // A byte other than -42 is the count as is, also above 64 (StackUp's reader accepts it).
    assert.deepEqual(readStackUpCount(hex('7f'), 0), { value: 127, size: 1 });
});

test('a truncated marker is a PartialReadError, and a non-integer count is never written', () => {
    assert.throws(() => readStackUpCount(hex('d6 0000'), 0), PartialReadError);
    assert.throws(() => readStackUpCount(Buffer.alloc(0), 0), PartialReadError);
    for (const bad of [NaN, Infinity, 1.5, undefined, 2 ** 31]) {
        assert.throws(() => sizeOfStackUpCount(bad), TypeError, String(bad));
        assert.throws(() => writeStackUpCount(bad, Buffer.alloc(5), 0), TypeError, String(bad));
    }
});

test('item-entity metadata (slot type 5) reads StackUp counts too', () => {
    const reader = createTypeReader({ reid: true, stackup: true });
    const meta = Buffer.concat([hex('06 05'), ROCKS_65, hex('ff')]);
    const { value } = reader.readMetadata(meta, 0);
    assert.deepEqual(value.map(m => [m.key, m.value.itemCount]), [[6, 65]]);
});

test('the bridge turns StackUp on from the server mod list only', () => {
    const itemCountType = (slot) => slot[1].find(f => f.anon).type[1].default[1].find(f => f.name === 'itemCount').type;
    assert.equal(itemCountType(slotType('1.12.2', { reid: true, stackup: true })), STACKUP_COUNT_TYPE);
    assert.equal(itemCountType(slotType('1.12.2', { reid: true })), 'i8');

    const attach = (modList) => {
        const client = new EventEmitter();
        client.write = () => true;
        client.setSerializer = function () { this.deserializer = { parsePacketBuffer: () => ({ data: {}, metadata: { size: 0 } }) }; };
        return { bridge: attachForgeBridge(client, { modList, log: () => {} }), client };
    };
    const withStackUp = attach(pinnedModList());
    assert.equal(withStackUp.bridge.stackup?.version, '0.2.5');
    assert.equal(itemCountType(withStackUp.client.customPackets['1.12'].types.slot), STACKUP_COUNT_TYPE);
    const without = attach(pinnedModList().filter(m => m.modid !== 'stackup'));
    assert.equal(without.bridge.stackup, null);
    assert.equal(itemCountType(without.client.customPackets['1.12'].types.slot), 'i8'); // REID's slot only
});

test('a validating ProtoDef over the merged types (as nmp\'s pluginChannels builds one) knows stackUpCount', () => {
    // nmp merges customPackets into minecraft-data's protocol in place, and pluginChannels then
    // validates those types before it adds nmp's native ones. Without the 'native' declaration
    // the e2e login failed with "validation error".
    const { ProtoDef } = require('protodef');
    const merge = require('lodash.merge');
    const nbt = require('prismarine-nbt');
    const custom = buildCustomPackets({ reid: true, stackup: true })['1.12'];
    assert.equal(custom.types[STACKUP_COUNT_TYPE], 'native');
    const validating = (types) => { const proto = new ProtoDef(true); nbt.addTypesToInterpreter('big', proto); proto.addTypes(types); };
    const merged = merge(JSON.parse(JSON.stringify(require('minecraft-data')('1.12.2').protocol.types)), custom.types);
    assert.doesNotThrow(() => validating(merged));
    const undeclared = { ...merged };
    delete undeclared[STACKUP_COUNT_TYPE];
    assert.throws(() => validating(undeclared), /validation error/, 'the failure this declaration prevents');
});

test('the constants match StackUp 0.2.5\'s bytecode (fixture: javap of PacketBufferWriterSplice)', () => {
    const method = (sig) => {
        const start = JAVAP.indexOf(sig);
        assert.ok(start >= 0, `method ${sig} in the fixture`);
        const end = JAVAP.indexOf('LineNumberTable', start);
        return JAVAP.slice(start, end).split('\n').map((l) => l.replace(/\s*\/\/.*$/, '').trim()).filter((l) => /^\d+:/.test(l)).map((l) => l.replace(/^\d+:\s+/, '').replace(/\s+/g, ' '));
    };
    // readItemStack: readByte, compare with -42, then readInt.
    const read = method('func_150791_c()');
    const r = read.indexOf(`bipush ${STACKUP_MARKER}`);
    assert.ok(r > 0 && read[r - 3].startsWith('invokevirtual #31') && read[r + 1].startsWith('if_icmpne') && read[r + 3].startsWith('invokevirtual #35'), read.join(' | '));
    assert.match(JAVAP, /#31 +\/\/ Method readByte:\(\)B/);
    assert.match(JAVAP, /#35 +\/\/ Method readInt:\(\)I/);
    // writeItemStack: count < 0 or count > 64 -> writeByte(-42), writeInt(count); else writeByte(count).
    const write = method('func_150788_a(');
    assert.ok(write.includes(`bipush ${STACKUP_BYTE_MAX}`) && write.includes('if_icmpgt 56') && write.includes('iflt 56'), write.join(' | '));
    const w = write.indexOf(`bipush ${STACKUP_MARKER}`);
    assert.ok(w > 0 && write[w + 1].startsWith('invokevirtual #81') && write.slice(w + 2, w + 7).some((l) => l.startsWith('invokevirtual #84')), write.join(' | '));
    assert.match(JAVAP, /#81 +\/\/ Method writeByte:\(I\)Lio\/netty\/buffer\/ByteBuf;/);
    assert.match(JAVAP, /#84 +\/\/ Method writeInt:\(I\)Lio\/netty\/buffer\/ByteBuf;/);
    assert.ok(JAVAP.includes(`mods/StackUp-${STACKUP_VERSION}.jar`), 'the fixture is from the version stackup.js follows');
});

test('the bridge warns when the server runs another StackUp version', () => {
    const attach = (version) => {
        const client = new EventEmitter();
        client.write = () => true;
        client.setSerializer = function () { this.deserializer = { parsePacketBuffer: () => ({ data: {}, metadata: { size: 0 } }) }; };
        const logs = [];
        const modList = pinnedModList().map((m) => (m.modid === 'stackup' ? { ...m, version } : m));
        attachForgeBridge(client, { modList, log: (m) => logs.push(m) });
        return logs.filter((l) => /StackUp/.test(l) && /warning/.test(l));
    };
    assert.deepEqual(attach(STACKUP_VERSION), []);
    const w = attach('0.3.0');
    assert.equal(w.length, 1);
    assert.match(w[0], /warning: StackUp 0\.3\.0 on the server; the item-count layout was read from 0\.2\.5/);
});

test('reid.js refuses a minecraft-data protocol that nmp already merged overrides into', () => {
    assert.doesNotThrow(() => assertPristineProtocol(PRISTINE));
    const merge = require('lodash.merge');
    const merged = merge(JSON.parse(JSON.stringify(PRISTINE)), buildCustomPackets({ reid: true, stackup: true })['1.12']);
    assert.throws(() => assertPristineProtocol(merged), /already has forge-bridge overrides \(slot\.blockId "varint", slot\.itemCount "stackUpCount", packet_entity_effect\.reidEffectId\)/);
});
