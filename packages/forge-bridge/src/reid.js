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
 * Triumph (mod id 'triumph', 3.19.2 in RotN 3.3.4) overrides.
 *
 * com.bloodnbonesgaming.triumph.advancements.display.ExtendedDisplayInfo.func_192290_a
 * (javap on the pack's Triumph-1.12.2-3.19.2.jar) writes the vanilla display
 * fields with flag bit 8 set, then: 4 optional i32 (uncompleted/completed icon
 * and title colours), an optional bool (drawDirectLines), 2 optional i32
 * (uncompleted/completed line colours), an optional bool (hideLines), an i32
 * count of extra connection ids (ResourceLocation strings), and 2 optional
 * i32 (posX, posY). Each optional is a bool, then the value if true.
 * Without it, minecraft-data's vanilla layout fails on these packets (G1 Batch B+C).
 * Not used on the wire: buildCustomPackets keeps advancements opaque. Kept as a
 * decoder checked against the real packets, for analysis and later use.
 */
export function triumphTypes(version = MC_VERSION) {
    const adv = clone(mcData(version).protocol.play.toClient.types.packet_advancements);
    const mapping = fieldOf(adv, 'advancementMapping');
    const value = fieldOf(mapping.type[1].type, 'value');
    const display = fieldOf(value.type, 'displayData').type[1]; // ['container', [...]] inside the option
    const flags = fieldOf(display, 'flags');
    const bits = flags.type[1];
    const unused = bits.find((b) => b.name === '_unused');
    unused.size -= 1;
    bits.splice(bits.indexOf(unused) + 1, 0, { name: 'triumph_extended', size: 1, signed: false });
    const oi32 = ['option', 'i32'];
    const obool = ['option', 'bool'];
    display[1].push({
        name: 'triumph',
        type: ['switch', {
            compareTo: 'flags/triumph_extended',
            fields: {
                1: ['container', [
                    { name: 'uncompletedIconColor', type: oi32 },
                    { name: 'completedIconColor', type: oi32 },
                    { name: 'uncompletedTitleColor', type: oi32 },
                    { name: 'completedTitleColor', type: oi32 },
                    { name: 'drawDirectLines', type: obool },
                    { name: 'uncompletedLineColor', type: oi32 },
                    { name: 'completedLineColor', type: oi32 },
                    { name: 'hideLines', type: obool },
                    { name: 'extraConnections', type: ['array', { countType: 'i32', type: 'string' }] },
                    { name: 'posX', type: oi32 },
                    { name: 'posY', type: oi32 },
                ]],
            },
            default: 'void',
        }],
    });
    return { toClient: { packet_advancements: adv } };
}

// The bot never needs advancements. With Triumph present they are kept as an
// opaque buffer (lead decision after G1 Batch B+C) instead of being parsed with
// triumphTypes(), which is kept as a tested offline decoder.
// packet_advancements is pointed at a named type: nmp's lodash.merge merges
// arrays index by index, so a shorter container would leave vanilla fields in
// place, while a string replaces the whole definition.
export const OPAQUE_PACKET_TYPE = 'forge_bridge_opaque_packet';

/**
 * customPackets object for nmp's createClient / client.customPackets.
 * @param {{reid?: boolean, triumph?: boolean, version?: string}} opts
 */
export function buildCustomPackets({ reid = false, triumph = false, version = MC_VERSION } = {}) {
    const major = mcData(version).version.majorVersion;
    const out = { types: { ...forgeTypes(version) } };
    const toClient = {};
    if (reid) {
        const r = reidTypes(version);
        Object.assign(out.types, r.types);
        Object.assign(toClient, r.toClient);
    }
    if (triumph) {
        out.types[OPAQUE_PACKET_TYPE] = ['container', [{ name: 'data', type: 'restBuffer' }]];
        toClient.packet_advancements = OPAQUE_PACKET_TYPE;
    }
    if (Object.keys(toClient).length) out.play = { toClient: { types: toClient } };
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
