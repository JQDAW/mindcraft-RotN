// FML EntitySpawn into mineflayer's bot.entities (net-forge brief item 6).
//
// Forge spawns most mod entities with an FML message on the "FML" channel
// (disc 2, decoded in channels.js), not with vanilla spawn packets, so stock
// mineflayer never sees them. This adds them to bot.entities the way mineflayer's
// spawn_entity_living handler does, and emits 'entitySpawn'. Later vanilla packets
// for the same entity id (moves, teleports, metadata, destroy) then update and
// remove it through mineflayer's own fetchEntity().
//
// Names: the message carries the mod id and a MOD-LOCAL entity type id
// (EntityRegistry.registerModEntity's id), which RegistryData does not map to a
// name. That table comes from rotn-data's dump (ADR 0004; rotn-data coordinates
// the shape through coord/STATUS-rotn-data.md).
// TODO(rotn-data): pass its mod-local entity table as `modEntityTable`:
//   { [modId]: { [modEntityTypeId]: 'modid:name' | { name, type?, category?, width?, height? } } }.
//   Until then the name is the placeholder `<modId>:entity_<modEntityTypeId>` with
//   forge.nameKnown false.
//
// Type: not 'mob' by default, because Mindcraft's isHostile treats every 'mob' as
// hostile, and FML also spawns projectiles, vehicles and decorations. It is the
// table's `type` when given, else 'projectile' for a thrown entity (throwerId != 0),
// else 'other'. Hostility belongs to rotn-data's table and skills-rotn.
// Size: the table's (or bot.registry's) width and height when known; otherwise
// prismarine-entity's defaults, 0 x 0, which pvp aim and collision checks should
// treat as unknown.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * The registry name for an FML-spawned entity.
 * @returns {{ name: string, known: boolean }}
 */
export function fmlEntityName(msg, modEntityTable = null) {
    const fromTable = modEntityTable?.[msg.modId]?.[msg.modEntityTypeId];
    const info = typeof fromTable === 'string' ? { name: fromTable } : fromTable;
    if (info?.name) {
        const name = info.name.includes(':') ? info.name : `${msg.modId}:${info.name}`;
        return { name, known: true, type: info.type ?? null, category: info.category ?? null, width: info.width ?? null, height: info.height ?? null };
    }
    return { name: `${msg.modId}:entity_${msg.modEntityTypeId}`, known: false, type: null, category: null, width: null, height: null };
}

/**
 * Applies one decoded FML EntitySpawn message to the bot. Returns the entity.
 * @param {object} bot  a mineflayer bot (bot.entities, bot.registry, bot.version, bot.emit)
 * @param {object} msg  decodeFml() EntitySpawn: {entityId, modId, modEntityTypeId, uuid, x, y, z, yaw, pitch, headYaw, metadata, throwerId, velocity}
 */
export function spawnFmlEntity(bot, msg, { modEntityTable = null, Entity = null, conv = null, Vec3 = null } = {}) {
    Entity ??= require('prismarine-entity')(bot.version);
    conv ??= require('mineflayer/lib/conversions');
    Vec3 ??= require('vec3').Vec3;
    const existed = msg.entityId in bot.entities;
    const entity = bot.entities[msg.entityId] ?? (bot.entities[msg.entityId] = new Entity(msg.entityId));
    try {
        apply(entity);
    } catch (e) {
        if (!existed) delete bot.entities[msg.entityId]; // never leave a half-made entity behind
        throw e;
    }
    bot.emit('entitySpawn', entity);
    return entity;

    function apply(entity) {
        const info = fmlEntityName(msg, modEntityTable);
        const { name, known } = info;
        const entry = bot.registry?.entitiesByName?.[name] ?? null;
        entity.type = info.type ?? (msg.throwerId ? 'projectile' : 'other');
        entity.uuid = msg.uuid;
        entity.name = name;
        entity.displayName = entry?.displayName ?? name;
        // Like mineflayer for an unknown entity: kind "unknown" until the name is known.
        entity.kind = info.category ?? (known ? 'Modded' : 'unknown');
        entity.entityType = entry?.id ?? null;
        const height = info.height ?? entry?.height;
        const width = info.width ?? entry?.width;
        if (height != null) entity.height = height;
        if (width != null) entity.width = width;
        entity.position.set(msg.x, msg.y, msg.z);
        entity.yaw = conv.fromNotchianYaw(msg.yaw);
        entity.pitch = conv.fromNotchianPitch(msg.pitch);
        entity.headYaw = conv.fromNotchianYaw(msg.headYaw);
        // FML sends motion * 8000 as ints; decodeFml already divided by 8000 (blocks/tick).
        if (msg.velocity) entity.velocity.update(new Vec3(msg.velocity.x, msg.velocity.y, msg.velocity.z));
        entity.metadata ??= {};
        for (const { key, value } of msg.metadata ?? []) entity.metadata[key] = value;
        entity.forge = {
            modId: msg.modId, modEntityTypeId: msg.modEntityTypeId, nameKnown: known,
            throwerId: msg.throwerId ?? null, metadataError: msg.metadataError ?? null,
        };
    }
}

/** Wires a bridge's 'entitySpawn' events to spawnFmlEntity for this bot. */
export function attachFmlEntities(bot, bridge, opts = {}) {
    let count = 0;
    bridge.on('entitySpawn', (msg) => {
        try {
            spawnFmlEntity(bot, msg, opts);
            count++;
        } catch (e) {
            opts.log?.(`FML EntitySpawn ${msg.modId}#${msg.modEntityTypeId} (entity ${msg.entityId}) not applied: ${e.message}`);
        }
    });
    return { get spawned() { return count; } };
}
