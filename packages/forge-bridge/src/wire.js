// Minimal big-endian reader/writer for Forge and vanilla 1.12 wire types.
// VarInts follow net.minecraft.network.PacketBuffer: 7 bits per byte, signed
// 32-bit result, at most 5 bytes (Forge's ByteBufUtils caps some fields lower).

import { Buffer } from 'node:buffer';
export class WireError extends Error {
    constructor(message, offset) {
        super(message);
        this.name = 'WireError';
        this.offset = offset;
    }
}

export class Reader {
    constructor(buf, offset = 0) {
        this.buf = buf;
        this.offset = offset;
    }

    get remaining() { return this.buf.length - this.offset; }

    need(n) {
        if (this.offset + n > this.buf.length) {
            throw new WireError(`read past end: need ${n} at ${this.offset}, have ${this.remaining}`, this.offset);
        }
    }

    u8() { this.need(1); return this.buf.readUInt8(this.offset++); }
    i8() { this.need(1); return this.buf.readInt8(this.offset++); }
    bool() { return this.u8() !== 0; }
    i16() { this.need(2); const v = this.buf.readInt16BE(this.offset); this.offset += 2; return v; }
    u16() { this.need(2); const v = this.buf.readUInt16BE(this.offset); this.offset += 2; return v; }
    i32() { this.need(4); const v = this.buf.readInt32BE(this.offset); this.offset += 4; return v; }
    i64() { this.need(8); const v = this.buf.readBigInt64BE(this.offset); this.offset += 8; return v; }
    u64() { this.need(8); const v = this.buf.readBigUInt64BE(this.offset); this.offset += 8; return v; }
    f64() { this.need(8); const v = this.buf.readDoubleBE(this.offset); this.offset += 8; return v; }

    varint(maxBytes = 5) {
        let result = 0;
        let shift = 0;
        for (let i = 0; i < maxBytes; i++) {
            const b = this.u8();
            result |= (b & 0x7f) << shift;
            if ((b & 0x80) === 0) return result | 0;
            shift += 7;
        }
        throw new WireError(`VarInt too big (more than ${maxBytes} bytes)`, this.offset);
    }

    bytes(n) {
        this.need(n);
        const out = this.buf.subarray(this.offset, this.offset + n);
        this.offset += n;
        return out;
    }

    rest() { return this.bytes(this.remaining); }

    // VarInt byte length + UTF-8 (PacketBuffer.readString / ByteBufUtils.readUTF8String).
    string(maxLenBytes = 5) {
        const len = this.varint(maxLenBytes);
        if (len < 0) throw new WireError(`negative string length ${len}`, this.offset);
        return this.bytes(len).toString('utf8');
    }

    // Two longs, most significant first, as a dashed UUID string.
    uuid() {
        const hex = this.bytes(16).toString('hex');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
}

export class Writer {
    constructor() { this.parts = []; }

    push(buf) { this.parts.push(buf); return this; }
    u8(v) { const b = Buffer.alloc(1); b.writeUInt8(v & 0xff); return this.push(b); }
    i8(v) { const b = Buffer.alloc(1); b.writeInt8(v); return this.push(b); }
    bool(v) { return this.u8(v ? 1 : 0); }
    i16(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); return this.push(b); }
    i32(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); return this.push(b); }
    i64(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); return this.push(b); }
    f64(v) { const b = Buffer.alloc(8); b.writeDoubleBE(v); return this.push(b); }
    varint(v) { return this.push(encodeVarInt(v)); }
    bytes(buf) { return this.push(Buffer.from(buf)); }

    string(s) {
        const body = Buffer.from(s, 'utf8');
        this.varint(body.length);
        return this.push(body);
    }

    uuid(s) { return this.push(Buffer.from(s.replace(/-/g, ''), 'hex')); }

    toBuffer() { return Buffer.concat(this.parts); }
}

export function encodeVarInt(value) {
    let v = value >>> 0; // two's complement for negatives, as Java does
    const out = [];
    do {
        let b = v & 0x7f;
        v >>>= 7;
        if (v !== 0) b |= 0x80;
        out.push(b);
    } while (v !== 0);
    return Buffer.from(out);
}

export function varIntSize(value) {
    return encodeVarInt(value).length;
}
