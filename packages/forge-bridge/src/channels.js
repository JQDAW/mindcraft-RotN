// Decoders for the Forge core plugin channels and REID's 'jeid' channel.
// Sources: fml-spec.md sections 1.5, 1.6, 3 and R. The jeid layouts were read
// from the RoughlyEnoughIDs 2.2.2 class files (javap), see the package README.

import { Buffer } from 'node:buffer';
import { Reader, Writer, WireError } from './wire.js';

// ---- REGISTER / UNREGISTER: NUL-separated channel names, no length prefix ----

export function decodeRegister(buf) {
    return buf.toString('utf8').split('\0').filter(s => s.length > 0);
}

export function encodeRegister(channels) {
    return Buffer.from([...new Set(channels)].join('\0'), 'utf8');
}

// ---- FML channel (FMLRuntimeCodec): 1 OpenGui, 2 EntitySpawn ----

export const FML_DISC = Object.freeze({ COMPLETE_HANDSHAKE: 0, OPEN_GUI: 1, ENTITY_SPAWN: 2 });

const ANGLE = 360 / 256;

/**
 * @param {Buffer} buf
 * @param {object} [opts]
 * @param {(buf:Buffer, offset:number) => {value:any, size:number}} [opts.readMetadata]
 *        vanilla entity-metadata reader; without it the metadata and tail stay raw.
 */
export function decodeFml(buf, opts = {}) {
    const r = new Reader(buf);
    const disc = r.i8();
    if (disc === FML_DISC.OPEN_GUI) {
        return {
            type: 'OpenGui', disc,
            windowId: r.i32(), modId: r.string(2), modGuiId: r.i32(),
            x: r.i32(), y: r.i32(), z: r.i32(),
        };
    }
    if (disc === FML_DISC.ENTITY_SPAWN) return decodeEntitySpawn(r, disc, opts);
    return { type: 'Unknown', disc, raw: r.rest() };
}

function decodeEntitySpawn(r, disc, { readMetadata }) {
    const msg = {
        type: 'EntitySpawn', disc,
        entityId: r.i32(),
        modId: r.string(2),
        modEntityTypeId: r.i32(),
        uuid: r.uuid(),
        x: r.f64(), y: r.f64(), z: r.f64(),
        yaw: r.i8() * ANGLE, pitch: r.i8() * ANGLE, headYaw: r.i8() * ANGLE,
        metadata: null,
        metadataError: null,
        throwerId: null,
        velocity: null,
        extra: null,
    };
    const metaStart = r.offset;
    if (!readMetadata) {
        msg.metadataError = 'no metadata reader';
        msg.extra = r.rest();
        return msg;
    }
    try {
        const { value, size } = readMetadata(r.buf, metaStart);
        msg.metadata = value;
        r.offset = metaStart + size;
    } catch (e) {
        // Unknown serializer ids cannot be skipped: keep everything raw (fml-spec.md section 3).
        msg.metadataError = e.message;
        r.offset = metaStart;
        msg.extra = r.rest();
        return msg;
    }
    try {
        msg.throwerId = r.i32();
        if (msg.throwerId !== 0) {
            msg.velocity = { x: r.i32() / 8000, y: r.i32() / 8000, z: r.i32() / 8000 };
        }
        msg.extra = r.rest(); // IEntityAdditionalSpawnData, mod specific
    } catch (e) {
        msg.metadataError = `tail: ${e.message}`;
    }
    return msg;
}

export function encodeEntitySpawn(m, metadataBuf = Buffer.from([0xff])) {
    const w = new Writer().i8(FML_DISC.ENTITY_SPAWN)
        .i32(m.entityId).string(m.modId).i32(m.modEntityTypeId).uuid(m.uuid)
        .f64(m.x).f64(m.y).f64(m.z)
        .i8(Math.round(m.yaw / ANGLE) << 24 >> 24)
        .i8(Math.round(m.pitch / ANGLE) << 24 >> 24)
        .i8(Math.round(m.headYaw / ANGLE) << 24 >> 24)
        .bytes(metadataBuf)
        .i32(m.throwerId ?? 0);
    if (m.throwerId) {
        w.i32(Math.round(m.velocity.x * 8000)).i32(Math.round(m.velocity.y * 8000)).i32(Math.round(m.velocity.z * 8000));
    }
    if (m.extra) w.bytes(m.extra);
    return w.toBuffer();
}

// ---- FORGE channel (ForgeRuntimeCodec): 1 DimensionRegister, 2 FluidIdMap ----

export function decodeForge(buf) {
    const r = new Reader(buf);
    const disc = r.i8();
    if (disc === 1) {
        const dimensionId = r.i32();
        const len = r.i16();
        const providerId = r.bytes(len).toString('utf8');
        return { type: 'DimensionRegister', disc, dimensionId, providerId };
    }
    if (disc === 2) {
        const n = r.i32();
        const fluids = [];
        for (let i = 0; i < n; i++) fluids.push([r.string(2), r.i32()]);
        const defaults = [];
        if (r.remaining > 0) for (let i = 0; i < n; i++) defaults.push(r.string(2));
        return { type: 'FluidIdMap', disc, fluids, defaults };
    }
    return { type: 'Unknown', disc, raw: r.rest() };
}

// ---- jeid channel (REID 2.2.2 MessageManager, SimpleNetworkWrapper) ----
// 0 BiomeChunkChange: varint chunkX, varint chunkZ, varint n, n x varint biome
// 1 BiomePositionChange: varint x, varint z, varint biomeId
// 2 BiomeAreaChange: varint x, varint z, varint radius, varint biomeId

export function decodeJeid(buf) {
    const r = new Reader(buf);
    const disc = r.u8();
    if (disc === 0) {
        const chunkX = r.varint(), chunkZ = r.varint();
        const n = r.varint();
        const biomes = new Array(n);
        for (let i = 0; i < n; i++) biomes[i] = r.varint();
        return { type: 'BiomeChunkChange', disc, chunkX, chunkZ, biomes };
    }
    if (disc === 1) return { type: 'BiomePositionChange', disc, x: r.varint(), z: r.varint(), biomeId: r.varint() };
    if (disc === 2) return { type: 'BiomeAreaChange', disc, x: r.varint(), z: r.varint(), radius: r.varint(), biomeId: r.varint() };
    return { type: 'Unknown', disc, raw: r.rest() };
}

// ---- FML|MP multipart (FMLProxyPacket / MultiPartCustomPayload), S->C only ----

export const PART_SIZE = 0x100000 - 0x50;

export class MultipartAssembler {
    constructor() { this.current = null; }

    get pending() { return this.current !== null; }

    /** Feed one FML|MP payload. Returns {channel, data} when complete, else null. */
    accept(buf) {
        const r = new Reader(buf);
        if (!this.current) {
            const channel = r.string();
            const parts = r.u8();
            const length = r.i32();
            if (length <= 0 || length >= PART_SIZE * parts) {
                throw new WireError(`FML|MP bad header: ${parts} parts, ${length} bytes`, 0);
            }
            this.current = { channel, parts, length, data: Buffer.alloc(length), next: 0, filled: 0 };
            return null;
        }
        const c = this.current;
        const index = r.u8();
        if (index !== c.next) {
            this.current = null;
            throw new WireError(`FML|MP part ${index} out of order, expected ${c.next}`, 0);
        }
        const body = r.rest();
        const offset = index * (PART_SIZE - 1);
        body.copy(c.data, offset);
        c.filled += body.length;
        c.next++;
        if (c.next < c.parts) return null;
        this.current = null;
        return { channel: c.channel, data: c.data, filled: c.filled };
    }
}

export function encodeMultipart(channel, data) {
    const parts = Math.ceil(data.length / (PART_SIZE - 1));
    const out = [new Writer().string(channel).u8(parts).i32(data.length).toBuffer()];
    for (let i = 0; i < parts; i++) {
        const chunk = data.subarray(i * (PART_SIZE - 1), (i + 1) * (PART_SIZE - 1));
        out.push(Buffer.concat([Buffer.from([i]), chunk]));
    }
    return out;
}
