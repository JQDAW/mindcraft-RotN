// FML|HS message codec (Forge 1.12.x FMLHandshakeMessage / FMLHandshakeCodec).
// docs/research/fml-spec.md section 1.2.

import { Reader, Writer, WireError } from './wire.js';

export const HS_CHANNEL = 'FML|HS';

export const HS = Object.freeze({
    SERVER_HELLO: 0,
    CLIENT_HELLO: 1,
    MOD_LIST: 2,
    REGISTRY_DATA: 3,
    HANDSHAKE_ACK: -1,   // 0xFF on the wire
    HANDSHAKE_RESET: -2, // 0xFE on the wire
});

export const FML_PROTOCOL_VERSION = 2;

export function decodeHandshake(buf) {
    const r = new Reader(buf);
    const disc = r.i8();
    switch (disc) {
    case HS.SERVER_HELLO: {
        const fmlProtocol = r.i8();
        // overrideDimension is only present for protocol > 1.
        const overrideDimension = fmlProtocol > 1 ? r.i32() : 0;
        return { type: 'ServerHello', disc, fmlProtocol, overrideDimension };
    }
    case HS.CLIENT_HELLO:
        return { type: 'ClientHello', disc, fmlProtocol: r.i8() };
    case HS.MOD_LIST: {
        const n = r.varint(2);
        const mods = [];
        for (let i = 0; i < n; i++) {
            const modid = r.string(2);
            const version = r.string(2);
            mods.push({ modid, version });
        }
        return { type: 'ModList', disc, mods };
    }
    case HS.REGISTRY_DATA: {
        const hasMore = r.bool();
        const name = r.string(2);
        const nIds = r.varint(3);
        const ids = new Array(nIds);
        for (let i = 0; i < nIds; i++) {
            const key = r.string(2);
            const id = r.varint(3);
            ids[i] = [key, id];
        }
        const nDummied = r.varint(3);
        const dummied = new Array(nDummied);
        for (let i = 0; i < nDummied; i++) dummied[i] = r.string(2);
        const nOverrides = r.varint(3);
        const overrides = new Array(nOverrides);
        for (let i = 0; i < nOverrides; i++) {
            const key = r.string(2);
            const value = r.string(2);
            overrides[i] = [key, value];
        }
        return { type: 'RegistryData', disc, hasMore, name, ids, dummied, overrides, trailing: r.remaining };
    }
    case HS.HANDSHAKE_ACK:
        return { type: 'HandshakeAck', disc, phase: r.i8() };
    case HS.HANDSHAKE_RESET:
        return { type: 'HandshakeReset', disc };
    default:
        throw new WireError(`unknown FML|HS discriminator ${disc}`, 0);
    }
}

export function encodeServerHello(fmlProtocol = FML_PROTOCOL_VERSION, overrideDimension = 0) {
    const w = new Writer().i8(HS.SERVER_HELLO).i8(fmlProtocol);
    if (fmlProtocol > 1) w.i32(overrideDimension);
    return w.toBuffer();
}

export function encodeClientHello(fmlProtocol = FML_PROTOCOL_VERSION) {
    return new Writer().i8(HS.CLIENT_HELLO).i8(fmlProtocol).toBuffer();
}

export function encodeModList(mods) {
    const w = new Writer().i8(HS.MOD_LIST).varint(mods.length);
    for (const { modid, version } of mods) w.string(modid).string(version);
    return w.toBuffer();
}

export function encodeRegistryData({ hasMore, name, ids = [], dummied = [], overrides = [] }) {
    const w = new Writer().i8(HS.REGISTRY_DATA).bool(hasMore).string(name);
    w.varint(ids.length);
    for (const [key, id] of ids) w.string(key).varint(id);
    w.varint(dummied.length);
    for (const key of dummied) w.string(key);
    w.varint(overrides.length);
    for (const [key, value] of overrides) w.string(key).string(value);
    return w.toBuffer();
}

export function encodeAck(phase) {
    return new Writer().i8(HS.HANDSHAKE_ACK).i8(phase).toBuffer();
}

export function encodeReset() {
    return new Writer().i8(HS.HANDSHAKE_RESET).toBuffer();
}
