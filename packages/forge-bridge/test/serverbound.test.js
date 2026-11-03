// Serverbound (C2S) packets that crafting, placing and item use need on RotN 3.3.4
// (skills-rotn Request 2), checked byte for byte against the vanilla 1.12.2 layout
// with REID's VarInt item ids, then parsed back the way a server reads them.
//
// The objects come from mineflayer 4.33.0's own plugin code (with our patch),
// injected into a stub bot, so the test covers what the bot really writes.
//
// Vanilla 1.12.2 layouts (javap on minecraft_server.1.12.2.jar, SHA-1
// 886945bfb2b978778c3a0288fd7fab09d315b25f, from the pinned pack zip; scratch only):
//   CPacketClickWindow (lf): byte windowId, short slot, byte button, short action,
//     enum ClickType (readEnumValue = VarInt ordinal), item stack.
//   CPacketPlayerTryUseItemOnBlock (ma): BlockPos, enum facing, enum hand, 3 floats.
//   CPacketPlayerTryUseItem: enum hand.
// minecraft-data types ClickType as i8. For ordinals 0-6 a VarInt is the same single byte.
// REID 2.2.2 (MixinPacketBuffer): the stack's item id, and the -1 empty marker, are VarInts.
// Item ids are the real ones from G1 Batch A's RegistryData (fixtures/rotn-3.3.4/handshake-runA.*).
//
// Scope: single clicks, placements and item use, packet by packet. The stub bot uses the
// vanilla registry (modded items have no name or stack size here), so stack merging,
// shift-clicks and bot.craft() are not covered. The offline end-to-end craft test
// through initBot covers those.

import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { buildCustomPackets } from '../src/reid.js';
import { Writer, encodeVarInt } from '../src/wire.js';
import { runAId, runARegistries } from './helpers.js';

const require = createRequire(import.meta.url);
const mc = require('minecraft-protocol');
const Vec3 = require('vec3');
const VERSION = '1.12.2';
const md = require('minecraft-data')(VERSION);
const Item = require('prismarine-item')(VERSION);

const customPackets = buildCustomPackets({ reid: true });
const c2sWrite = mc.createSerializer({ state: 'play', isServer: false, version: VERSION, customPackets });
const c2sRead = mc.createDeserializer({ state: 'play', isServer: true, version: VERSION, customPackets });

const ID = {
    crudeAxe: runAId('pyrotech:crude_axe'),
    rock: runAId('pyrotech:rock'),
    craftingTools: runAId('contenttweaker:crafting_tools'),
    craftingTable: runAId('minecraft:crafting_table'),
    stick: runAId('minecraft:stick'),
};

function packetId(name) {
    const m = md.protocol.play.toServer.types.packet[1][0].type[1].mappings;
    return parseInt(Object.keys(m).find(k => m[k] === name), 16);
}

function f32(v) { const b = Buffer.alloc(4); b.writeFloatBE(v); return b; }

function position(x, y, z) { // 1.12: x 26 bits, y 12 bits, z 26 bits
    const v = (BigInt(x & 0x3ffffff) << 38n) | (BigInt(y & 0xfff) << 26n) | BigInt(z & 0x3ffffff);
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(v);
    return b;
}

function reidStack(w, id, count, damage) {
    w.varint(id);
    if (id !== -1) w.i8(count).i16(damage).u8(0); // TAG_End: no NBT
    return w;
}

function roundTrip(name, params) {
    const buf = c2sWrite.createPacketBuffer({ name, params });
    const parsed = c2sRead.parsePacketBuffer(buf);
    assert.equal(parsed.data.name, name);
    assert.equal(parsed.metadata.size, buf.length, `${name}: the server-side reader consumes every byte`);
    return { buf, params: parsed.data.params };
}

// A stub bot with mineflayer's real inventory and generic_place plugins.
function stubBot() {
    const bot = new EventEmitter();
    bot.registry = require('prismarine-registry')(VERSION);
    bot.version = VERSION;
    bot.supportFeature = bot.registry.supportFeature;
    bot._client = new EventEmitter();
    bot.writes = [];
    bot._client.write = (name, params) => bot.writes.push({ name, params });
    bot.entity = { yaw: 0.5, pitch: -0.25, position: new Vec3(0, 64, 0) };
    bot.QUICK_BAR_START = 36;
    bot.lookAt = async () => {};
    bot.swingArm = () => bot.writes.push({ name: 'arm_animation', params: { hand: 0 } });
    require('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true });
    require('mineflayer/lib/plugins/generic_place.js')(bot);
    bot.quickBarSlot = 0;
    return bot;
}

test('the Run A ids used here are real; the modded ones lie beyond the block-id range (4095)', () => {
    assert.equal(runARegistries().get('minecraft:items').overrides.get('minecraft:crafting_table'), 'fastbench');
    assert.equal(ID.craftingTable, 58);
    assert.equal(ID.stick, 280);
    for (const id of [ID.crudeAxe, ID.rock, ID.craftingTools]) assert.ok(id > 4095, `modded id ${id}`);
});

test('window_click from mineflayer clickWindow: vanilla layout, REID VarInt item id, server reads it back', async () => {
    const bot = stubBot();
    bot.inventory.updateSlot(36, new Item(ID.crudeAxe, 1, 0));
    const done = bot.clickWindow(36, 0, 0);
    const click = bot.writes.find(w => w.name === 'window_click');
    assert.ok(click, 'mineflayer wrote window_click');
    bot._client.emit('transaction', { windowId: 0, action: click.params.action, accepted: true });
    await done;
    // The inventory window needs the server's confirmation, so the accepted transaction
    // completes the click and mineflayer writes nothing else (no "faulty transaction" reply).
    assert.deepEqual(bot.writes.map(w => w.name), ['window_click']);

    const { buf, params } = roundTrip('window_click', click.params);
    const expected = reidStack(new Writer().varint(packetId('window_click')).u8(0).i16(36).i8(0).i16(click.params.action).bytes(encodeVarInt(0)), ID.crudeAxe, 1, 0).toBuffer();
    assert.equal(buf.toString('hex'), expected.toString('hex'));
    assert.deepEqual(params, { windowId: 0, slot: 36, mouseButton: 0, action: click.params.action, mode: 0, item: { blockId: ID.crudeAxe, itemCount: 1, itemDamage: 0, nbtData: undefined } });
});

test('window_click item stacks: empty slot, meta, a 3-byte VarInt id and NBT all round-trip', () => {
    const empty = roundTrip('window_click', { windowId: 3, slot: 1, mouseButton: 1, action: 7, mode: 0, item: Item.toNotch(null) });
    assert.ok(empty.buf.subarray(-5).equals(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x0f])), 'empty = VarInt -1, 5 bytes');
    assert.deepEqual(empty.params.item, { blockId: -1 });

    const rock = roundTrip('window_click', { windowId: 3, slot: 10, mouseButton: 0, action: 8, mode: 0, item: Item.toNotch(new Item(ID.rock, 7, 6)) });
    assert.deepEqual(rock.params.item, { blockId: ID.rock, itemCount: 7, itemDamage: 6, nbtData: undefined });
    assert.ok(rock.buf.subarray(-6).equals(Buffer.concat([encodeVarInt(ID.rock), Buffer.from([7, 0, 6, 0])])));

    // REID allows ids past a signed short; the Run A maximum is 13394 (2 bytes), so this one is synthetic.
    const big = roundTrip('window_click', { windowId: 3, slot: 10, mouseButton: 0, action: 9, mode: 0, item: { blockId: 40000, itemCount: 1, itemDamage: 0 } });
    assert.equal(encodeVarInt(40000).length, 3);
    assert.equal(big.params.item.blockId, 40000);

    const nbt = { type: 'compound', name: '', value: { display: { type: 'compound', value: { Name: { type: 'string', value: 'Axe' } } } } };
    const named = roundTrip('window_click', { windowId: 0, slot: 36, mouseButton: 0, action: 10, mode: 0, item: Item.toNotch(new Item(ID.crudeAxe, 1, 3, nbt)) });
    assert.deepEqual(named.params.item.nbtData, nbt);
    assert.equal(named.params.item.itemDamage, 3);
});

test('set_creative_slot uses the same REID slot (the slot type is overridden globally)', () => {
    const { buf, params } = roundTrip('set_creative_slot', { slot: 36, item: Item.toNotch(new Item(ID.craftingTools, 1, 0)) });
    const expected = reidStack(new Writer().varint(packetId('set_creative_slot')).i16(36), ID.craftingTools, 1, 0).toBuffer();
    assert.equal(buf.toString('hex'), expected.toString('hex'));
    assert.equal(params.item.blockId, ID.craftingTools);
});

test('window_click modes 0-6 encode as one byte, the same bytes as vanilla readEnumValue', () => {
    for (let mode = 0; mode <= 6; mode++) {
        const { buf, params } = roundTrip('window_click', { windowId: 0, slot: 9, mouseButton: 0, action: 1, mode, item: { blockId: -1 } });
        // id, windowId, slot (2), button, action (2), then the mode byte
        assert.ok(buf.subarray(7, 8).equals(encodeVarInt(mode)), `mode ${mode}`);
        assert.equal(params.mode, mode);
    }
});

test('a rejected click: mineflayer answers with the transaction confirm a 1.12 server waits for', async () => {
    const bot = stubBot();
    bot.inventory.updateSlot(36, new Item(ID.stick, 4, 0));
    const done = bot.clickWindow(36, 0, 0).then(() => null, (e) => e);
    const click = bot.writes.find(w => w.name === 'window_click');
    bot._client.emit('transaction', { windowId: 0, action: click.params.action, accepted: false });
    const err = await done;
    assert.match(String(err?.message), /rejected transaction/);
    // NetHandlerPlayServer ignores clicks in that window until this arrives (pendingTransactions).
    const confirm = bot.writes.find(w => w.name === 'transaction');
    assert.deepEqual(roundTrip('transaction', confirm.params).params, { windowId: 0, action: click.params.action, accepted: true });
});

test('block_place from mineflayer _genericPlace on 1.12.2: position, face, hand, float cursor', async () => {
    const bot = stubBot();
    bot.inventory.updateSlot(36, new Item(ID.craftingTable, 1, 0));
    const ref = { position: new Vec3(-45, 66, -66) };
    await bot._genericPlace(ref, new Vec3(0, 1, 0), { swingArm: 'right' });
    const place = bot.writes.find(w => w.name === 'block_place');
    assert.deepEqual(Object.keys(place.params).sort(), ['cursorX', 'cursorY', 'cursorZ', 'direction', 'hand', 'location']);

    const { buf, params } = roundTrip('block_place', place.params);
    const expected = new Writer().varint(packetId('block_place')).bytes(position(-45, 66, -66))
        .varint(1).varint(0).bytes(f32(0.5)).bytes(f32(1)).bytes(f32(0.5)).toBuffer();
    assert.equal(buf.toString('hex'), expected.toString('hex'));
    assert.deepEqual({ ...params, location: { ...params.location } }, { location: { x: -45, y: 66, z: -66 }, direction: 1, hand: 0, cursorX: 0.5, cursorY: 1, cursorZ: 0.5 });

    await bot._genericPlace(ref, new Vec3(-1, 0, 0), { offhand: false, half: 'top' });
    const side = roundTrip('block_place', bot.writes.filter(w => w.name === 'block_place')[1].params).params;
    assert.equal(side.direction, 4);
    assert.equal(side.cursorY, 0.75);
});

test('use_item from mineflayer activateItem: only the hand goes on the wire (patched sequence and rotation are dropped)', () => {
    const bot = stubBot();
    bot.activateItem();
    bot.activateItem(true);
    const uses = bot.writes.filter(w => w.name === 'use_item');
    assert.equal(uses.length, 2);
    assert.ok('rotation' in uses[0].params && 'sequence' in uses[0].params, 'the patch adds 1.21 fields');
    const main = roundTrip('use_item', uses[0].params);
    assert.equal(main.buf.toString('hex'), Buffer.concat([encodeVarInt(packetId('use_item')), encodeVarInt(0)]).toString('hex'));
    assert.deepEqual(main.params, { hand: 0 });
    assert.deepEqual(roundTrip('use_item', uses[1].params).params, { hand: 1 });
});

test('block_dig status 5 from deactivateItem (release a used item) round-trips', () => {
    const bot = stubBot();
    bot.deactivateItem();
    const dig = bot.writes.find(w => w.name === 'block_dig');
    const { params } = roundTrip('block_dig', dig.params);
    assert.deepEqual({ ...params, location: { ...params.location } }, { status: 5, location: { x: 0, y: 0, z: 0 }, face: 0 });
});
