// StackUp 0.2.5 (mod id 'stackup', in RotN 3.3.4) item stack count on the wire.
//
// Found from G3 smoke round 3 batch C+D (untrusted scenario, 02:56:26 and 02:57:04 UTC): the
// server dropped the bot with "DecoderException: IndexOutOfBoundsException: readerIndex(11) +
// length(4) exceeds writerIndex(14)" in CPacketClickWindow.readPacketData ->
// PacketBuffer.readItemStack -> readInt (PacketBuffer.java:45), then "Packet 0/0
// (CPacketConfirmTeleport) was larger than I expected, found 1 bytes extra".
//
// `javap -c -p -l` on pl.asie.stackup.core.PacketBufferWriterSplice (StackUp-0.2.5.jar in the
// pinned pack; scratch only), which StackUp splices into PacketBuffer:
// - readItemStack (func_150791_c) 13-28, source lines 43-45: count = readByte(); if
//   count == -42 then count = readInt().
// - writeItemStack (func_150788_a) 28-71, lines 60-64: a count in 0..64 is written as a byte;
//   any other count (above 64, or negative) as the byte -42 (0xD6) and then an int.
// The id and damage are unchanged (REID still makes the id a VarInt: P1 had 33/33 clicks
// accepted). Damage stays a short and NBT follows as usual.
//
// RotN's config/stackup/*.stackup raise stack sizes: pyrotech:rock and many materials to 256,
// all blocks to 128 (maxStackSize=1024). So a bot that collects rocks soon holds a stack over
// 64. A plain i8 count read 0xD6 as -42 and the int's first bytes as damage and NBT; the bot
// then sent that stack back in a window click as "-42" with no int, which the server reads past
// the end of. The 3 unread bytes (damage 00 00, NBT end 00) were then decoded again when the
// channel closed: packet id 0 = CPacketConfirmTeleport, teleport id 0, 1 byte extra.
//
// The native type below is registered on node-minecraft-protocol's compiler and interpreter
// type tables (installStackUpType), so the slot's itemCount carries the real count in both
// directions, in every packet and in entity metadata.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const STACKUP_MODID = 'stackup';
export const STACKUP_MARKER = -42;
export const STACKUP_COUNT_TYPE = 'stackUpCount';
/** Largest count StackUp still writes as a single byte (writeItemStack 32-41). */
export const STACKUP_BYTE_MAX = 64;

const fitsByte = (count) => count >= 0 && count <= STACKUP_BYTE_MAX;

function checkCount(value) {
    if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
        throw new TypeError(`StackUp item count must be a 32-bit integer, got ${value}`);
    }
}

function partial(message) {
    const { PartialReadError } = require('protodef').utils;
    return new PartialReadError(message);
}

/** Read: (buffer, offset) -> { value, size }, as PacketBufferWriterSplice.readItemStack. */
export function readStackUpCount(buffer, offset) {
    if (offset + 1 > buffer.length) throw partial('StackUp count: missing count byte');
    const count = buffer.readInt8(offset);
    if (count !== STACKUP_MARKER) return { value: count, size: 1 };
    if (offset + 5 > buffer.length) throw partial('StackUp count: marker -42 without its int count');
    return { value: buffer.readInt32BE(offset + 1), size: 5 };
}

/** Write: (value, buffer, offset) -> new offset, as PacketBufferWriterSplice.writeItemStack. */
export function writeStackUpCount(value, buffer, offset) {
    checkCount(value);
    if (fitsByte(value)) {
        buffer.writeInt8(value, offset);
        return offset + 1;
    }
    buffer.writeInt8(STACKUP_MARKER, offset);
    buffer.writeInt32BE(value, offset + 1);
    return offset + 5;
}

export function sizeOfStackUpCount(value) {
    checkCount(value);
    return fitsByte(value) ? 1 : 5;
}

/**
 * Registers the native type on node-minecraft-protocol's type tables: the compiled protocol
 * (src/datatypes/compiler-minecraft.js, added by transforms/serializer.js createProtocol) and
 * the interpreter (src/datatypes/minecraft.js). Idempotent. Must run before the first
 * play-state client compiles its protocol (buildCustomPackets calls it).
 */
export function installStackUpType() {
    const compiled = require('minecraft-protocol/src/datatypes/compiler-minecraft');
    const interpreted = require('minecraft-protocol/src/datatypes/minecraft');
    if (!compiled?.Read || !compiled?.Write || !compiled?.SizeOf || typeof interpreted !== 'object') {
        throw new Error('minecraft-protocol datatype tables not found; StackUp item counts cannot be registered');
    }
    compiled.Read[STACKUP_COUNT_TYPE] = ['native', readStackUpCount];
    compiled.Write[STACKUP_COUNT_TYPE] = ['native', writeStackUpCount];
    compiled.SizeOf[STACKUP_COUNT_TYPE] = ['native', sizeOfStackUpCount];
    interpreted[STACKUP_COUNT_TYPE] = [readStackUpCount, writeStackUpCount, sizeOfStackUpCount];
}
