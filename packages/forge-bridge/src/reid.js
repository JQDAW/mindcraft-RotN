// node-minecraft-protocol customPackets for Forge 1.12.2, with the
// RoughlyEnoughIDs (REID, mod id 'jeid') 2.2.2 wire changes (fml-spec.md section R).
//
// Confirmed from the REID 2.2.2 class files:
//   MixinPacketBuffer / MixinPacketUtil: slot item id (and the -1 empty marker) is a VarInt.
//   MixinSPacketRemoveEntityEffect: the effect id byte is replaced by an i32.
//   MixinSPacketEntityEffect: TAIL injection, so the vanilla packet is unchanged
//     and a VarInt effect id follows it. We read it as `reidEffectId` (restBuffer)
//     and the bridge copies it into effectId; an empty tail keeps the vanilla byte.
//   MixinSPacketChunkData: biome VarInt array inside chunkData, handled by the
//     prismarine-chunk patch, not here.
//
// The overrides are built from minecraft-data's own 1.12.2 definitions, so
// lodash.merge in nmp's createProtocol replaces exactly the changed leaves.
//
// Caveat: nmp caches compiled protocols by state, direction and version only
// (transforms/serializer.js), not by customPackets. The first play-state
// client for a version in a process fixes the protocol for that process.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const MC_VERSION = '1.12.2';

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function mcData(version = MC_VERSION) {
    const md = require('minecraft-data')(version);
    if (!md) throw new Error(`no minecraft-data for ${version}`);
    return md;
}

function fieldOf(container, name) {
    const f = container[1].find(x => x.name === name);
    if (!f) throw new Error(`field ${name} not found`);
    return f;
}

/** Overrides that apply to every Forge 1.12.2 server. */
export function forgeTypes(version = MC_VERSION) {
    const p = mcData(version).protocol;
    // Entity metadata type id is a VarInt in 1.12 (minecraft-data says i8).
    // Forge mod DataSerializers start at 256 and need two VarInt bytes.
    const meta = clone(p.types.entityMetadata);
    const keyType = meta[1].type[1][0].type[1];
    fieldOf(['container', keyType], 'type').type = 'varint';
    return { entityMetadata: meta };
}

/** REID-only overrides. */
export function reidTypes(version = MC_VERSION) {
    const p = mcData(version).protocol;
    const slot = clone(p.types.slot);
    fieldOf(slot, 'blockId').type = 'varint';

    const tc = p.play.toClient.types;
    const effect = clone(tc.packet_entity_effect);
    effect[1].push({ name: 'reidEffectId', type: 'restBuffer' });
    const removeEffect = clone(tc.packet_remove_entity_effect);
    fieldOf(removeEffect, 'effectId').type = 'i32';

    return {
        types: { slot },
        toClient: { packet_entity_effect: effect, packet_remove_entity_effect: removeEffect },
    };
}

/**
 * customPackets object for nmp's createClient / client.customPackets.
 * @param {{reid?: boolean, version?: string}} opts
 */
export function buildCustomPackets({ reid = false, version = MC_VERSION } = {}) {
    const major = mcData(version).version.majorVersion;
    const out = { types: { ...forgeTypes(version) } };
    if (reid) {
        const r = reidTypes(version);
        Object.assign(out.types, r.types);
        out.play = { toClient: { types: r.toClient } };
    }
    return { [major]: out };
}

/** Decode the trailing REID VarInt of entity_effect, or null if absent. */
export function reidEffectIdFromTail(tail) {
    if (!tail || tail.length === 0) return null;
    let result = 0;
    for (let i = 0; i < Math.min(tail.length, 5); i++) {
        const b = tail[i];
        result |= (b & 0x7f) << (7 * i);
        if ((b & 0x80) === 0) return result | 0;
    }
    return null;
}

/**
 * An interpreted ProtoDef that can read single types (entityMetadata, slot)
 * with the same overrides as the play protocol. Used for FML EntitySpawn.
 */
export function createTypeReader({ reid = false, version = MC_VERSION } = {}) {
    const { ProtoDef } = require('protodef');
    const minecraft = require('minecraft-protocol/src/datatypes/minecraft');
    const nbt = require('prismarine-nbt');
    const merge = require('lodash.merge');
    const md = mcData(version);
    const custom = buildCustomPackets({ reid, version })[md.version.majorVersion];
    const types = merge(clone(md.protocol.types), custom.types);
    const proto = new ProtoDef(false);
    nbt.addTypesToInterpreter('big', proto);
    proto.addTypes(minecraft); // first: JSON types capture their base types when added
    proto.addTypes(types);
    return {
        read(buf, offset, type) { return proto.read(buf, offset, type, {}); },
        readMetadata(buf, offset) { return proto.read(buf, offset, 'entityMetadata', {}); },
        write(type, value) { return proto.createPacketBuffer(type, value); },
    };
}
