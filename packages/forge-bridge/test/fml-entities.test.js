// FML EntitySpawn into bot.entities (src/fml-entities.js, brief item 6). Offline:
// a minimal bot object with the real prismarine-entity, prismarine-registry
// (extended with forge-bridge's registry extension) and mineflayer conversions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { spawnFmlEntity, attachFmlEntities, fmlEntityName, fmlEntityTable, looksLiving, LIVING_METADATA } from '../src/fml-entities.js';
import * as rotnData from '../../rotn-data/index.js';
import { extendRegistry } from '../src/registry-extension.js';
import { RegistrySnapshot } from '../src/registries.js';
import { syntheticRegistries, FIXTURES } from './helpers.js';
import { decodeFml, encodeEntitySpawn } from '../src/channels.js';
import { createTypeReader } from '../src/reid.js';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const require = createRequire(import.meta.url);
const conv = require('mineflayer/lib/conversions');

function fakeBot() {
    const bot = new EventEmitter();
    bot.version = '1.12.2';
    bot.entities = {};
    bot.registry = require('prismarine-registry')('1.12.2');
    const snap = new RegistrySnapshot();
    const regs = syntheticRegistries();
    regs.forEach((r, i) => snap.add({ ...r, hasMore: i < regs.length - 1 }));
    extendRegistry(bot.registry, snap);
    return bot;
}

const SPAWN = {
    type: 'EntitySpawn', entityId: 4242, modId: 'iceandfire', modEntityTypeId: 7,
    uuid: '12345678-9abc-def0-1234-56789abcdef0',
    x: 100.5, y: 64, z: -200.25, yaw: 90, pitch: -45, headYaw: 180,
    metadata: [{ key: 0, type: 0, value: 1 }, { key: 12, type: 6, value: true }],
    throwerId: 0, velocity: null, extra: null, metadataError: null,
};

test('with a mod-local entity table the entity gets its registry name and registry data', () => {
    const bot = fakeBot();
    const seen = [];
    bot.on('entitySpawn', (e) => seen.push(e));
    const e = spawnFmlEntity(bot, SPAWN, { modEntityTable: { iceandfire: { 7: 'dragon' } } });
    assert.equal(bot.entities[4242], e);
    assert.deepEqual(seen, [e]);
    assert.equal(e.name, 'iceandfire:dragon');
    assert.equal(e.displayName, 'Dragon', 'from bot.registry (extended with the synced entities)');
    assert.equal(e.entityType, 300);
    assert.equal(e.type, 'other', 'a name-only table entry gives no type: not "mob", so isHostile stays false');
    assert.equal(e.uuid, SPAWN.uuid);
    assert.deepEqual([e.position.x, e.position.y, e.position.z], [100.5, 64, -200.25]);
    assert.equal(e.yaw, conv.fromNotchianYaw(90));
    assert.equal(e.pitch, conv.fromNotchianPitch(-45));
    assert.equal(e.metadata[0], 1, 'metadata by key, as mineflayer stores it');
    assert.equal(e.metadata[12], true);
    assert.deepEqual(e.forge, { modId: 'iceandfire', modEntityTypeId: 7, nameKnown: true, throwerId: 0, metadataError: null });
});

test('without the table the name is a clear placeholder (TODO rotn-data)', () => {
    assert.deepEqual(fmlEntityName(SPAWN), { name: 'iceandfire:entity_7', known: false, type: null, category: null, width: null, height: null, displayName: null });
    assert.deepEqual(fmlEntityName(SPAWN, { iceandfire: { 7: 'iceandfire:dragon' } }), { name: 'iceandfire:dragon', known: true, type: null, category: null, width: null, height: null, displayName: null });
    const e = spawnFmlEntity(fakeBot(), SPAWN);
    assert.equal(e.name, 'iceandfire:entity_7');
    assert.equal(e.displayName, 'iceandfire:entity_7');
    assert.equal(e.kind, 'unknown', 'like mineflayer for an unknown entity (PR #38 nit)');
    assert.equal(e.forge.nameKnown, false);
    assert.equal(e.type, 'other');
    assert.deepEqual([e.width, e.height], [0, 0], 'size unknown without rotn-data: prismarine-entity defaults');
});

test('the table can supply type, category and size; a known FML entity is a mob only then', async () => {
    const { isHostile } = await import('../../../src/utils/mcdata.js');
    const table = { iceandfire: { 7: { name: 'dragon', type: 'mob', category: 'Hostile mobs', width: 4, height: 3 } } };
    const dragon = spawnFmlEntity(fakeBot(), SPAWN, { modEntityTable: table });
    assert.deepEqual([dragon.type, dragon.kind, dragon.width, dragon.height], ['mob', 'Hostile mobs', 4, 3]);
    assert.equal(isHostile(dragon), true);
    const unknown = spawnFmlEntity(fakeBot(), SPAWN);
    assert.equal(isHostile(unknown), false, 'an unknown entity whose metadata does not look living is not hostile');
});

test('thrown entities keep their velocity (blocks/tick) and thrower; an existing entity object is reused', () => {
    const bot = fakeBot();
    const Entity = require('prismarine-entity')('1.12.2');
    const before = bot.entities[4242] = new Entity(4242);
    const e = spawnFmlEntity(bot, { ...SPAWN, throwerId: 99, velocity: { x: 0.5, y: -0.25, z: 1 } });
    assert.equal(e, before);
    assert.deepEqual([e.velocity.x, e.velocity.y, e.velocity.z], [0.5, -0.25, 1]);
    assert.equal(e.forge.throwerId, 99);
    assert.equal(e.type, 'projectile', 'thrown: a projectile, never a hostile mob');
});

test('an FML spawn whose metadata has an unknown serializer survives with metadataError (AquaAcrobatics type 14)', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'rotn-3.3.4', 'entity-metadata-aqua-pose.json'), 'utf8'));
    const pkt = Buffer.from(fixture.hex, 'hex');
    // play.entity_metadata: packet id 0x3c, VarInt entity id (2 bytes here), then the metadata entries.
    assert.equal(pkt[0], 0x3c);
    const metadata = pkt.subarray(3);
    const reader = createTypeReader({ reid: true });
    const msg = decodeFml(encodeEntitySpawn({ ...SPAWN, throwerId: 0 }, metadata), { readMetadata: reader.readMetadata });
    assert.equal(msg.type, 'EntitySpawn');
    assert.ok(msg.metadataError, 'type 14 is unknown to the 1.12.2 metadata type');
    assert.equal(msg.metadata, null);
    const bot = fakeBot();
    const e = spawnFmlEntity(bot, msg);
    assert.equal(bot.entities[4242], e, 'the spawn is applied anyway');
    assert.equal(e.forge.metadataError, msg.metadataError);
    assert.deepEqual([e.position.x, e.position.y, e.position.z], [100.5, 64, -200.25]);
});

test('attachFmlEntities applies every bridge entitySpawn and never throws into the bridge', () => {
    const bot = fakeBot();
    const bridge = new EventEmitter();
    const logs = [];
    const h = attachFmlEntities(bot, bridge, { log: (m) => logs.push(m) });
    bridge.emit('entitySpawn', SPAWN);
    bridge.emit('entitySpawn', { ...SPAWN, entityId: 5, metadata: 5 }); // not iterable: throws inside
    assert.equal(h.spawned, 1);
    assert.ok(bot.entities[4242]);
    assert.equal(logs.length, 2);
    assert.match(logs[0], /FML entity iceandfire#7 is not in the mod entity table/, 'no table: unknown, logged once');
    assert.match(logs[1], /FML EntitySpawn iceandfire#7 \(entity 5\) not applied/);
    assert.equal(5 in bot.entities, false, 'no half-made entity is left behind');
});

// The lead's G2 prerequisite: rotn-data's real mod-local entity table (the RotN 3.3.4
// dump on develop), through its catalog API exactly as initBot passes it.
test('the real rotn-data table: FML mobs get their registry names, type and category', async () => {
    const { isHostile } = await import('../../../src/utils/mcdata.js');
    const table = fmlEntityTable({ modEntityTable: rotnData.modEntityTable, entityByModId: rotnData.entityByModId });
    assert.ok(Object.keys(table).length >= 50, `a table for the pack's mods (${Object.keys(table).length})`);
    const bot = fakeBot();
    let nextId = 10000;
    const spawn = (modId, modEntityTypeId, extra = {}) => spawnFmlEntity(bot, { ...SPAWN, entityId: nextId++, modId, modEntityTypeId, ...extra }, { modEntityTable: table });

    // What each entity must become, from rotn-data's catalog API: the same entityByModId
    // facts (dump plus rotn-data's threat overrides) the bot's table is built from, not
    // literals. A living entity is hostile or passive by rotn-data's `hostile`; anything
    // else keeps the spawn rule (`other`, or `projectile` when thrown).
    const expected = (modId, id) => {
        const f = rotnData.entityByModId(modId, id);
        const living = Array.isArray(f.kinds) && f.kinds.includes('living');
        const hostile = living && !!f.hostile;
        return {
            name: f.name, displayName: f.displayName ?? f.name, hostile,
            type: living ? (hostile ? 'hostile' : 'passive') : 'other',
            kind: living ? (hostile ? 'Hostile mobs' : 'Passive mobs') : 'Modded',
        };
    };
    const got = (e) => ({ name: e.name, displayName: e.displayName, hostile: isHostile(e), type: e.type, kind: e.kind });

    // Every entry of the mod-local table spawns as the catalog says, into bot.entities.
    // Counted per branch of rotn-data's rule (hostile = imob || targetsPlayers), so a
    // branch that empties out (for example every override reverted) is noticed.
    const branches = { imob: 0, override: 0, passive: 0, nonLiving: 0 };
    for (const [modId, byId] of Object.entries(rotnData.modEntityTable())) {
        for (const id of Object.keys(byId).map(Number)) {
            const want = expected(modId, id);
            const entityId = nextId;
            const e = spawn(modId, id);
            assert.equal(bot.entities[entityId], e, `${modId} #${id} is in bot.entities`);
            assert.deepEqual(got(e), want, `${modId} #${id}`);
            assert.equal(e.forge.nameKnown, true);
            const f = rotnData.entityByModId(modId, id);
            if (want.type === 'other') branches.nonLiving++;
            else if (!want.hostile) branches.passive++;
            else if (f.imob) branches.imob++;
            else branches.override++;
        }
    }
    const count = Object.values(branches).reduce((a, b) => a + b, 0);
    assert.ok(count >= 500 && branches.imob >= 50 && branches.passive >= 100 && branches.nonLiving >= 50 && branches.override >= 1, JSON.stringify(branches));

    // Every modded mob in rotn-data's common-mobs.json (G2's mobs_named list, which the
    // console summons) is in the table under its own registry name.
    const common = JSON.parse(fs.readFileSync(new URL('../../rotn-data/3.3.4/common-mobs.json', import.meta.url), 'utf8')).mobs;
    const modded = common.filter((m) => m.modded);
    assert.ok(modded.length >= 10, `common-mobs.json has modded mobs (${modded.length})`);
    for (const m of modded) {
        const { modId, modEntityTypeId } = rotnData.entity(m.name);
        assert.deepEqual(got(spawn(modId, modEntityTypeId)), expected(modId, modEntityTypeId), `${m.name} (${modId} #${modEntityTypeId})`);
    }

    // Pinned: one literal case per branch, so the rule itself cannot drift.
    const pin = (e) => [e.name, e.displayName, e.type, e.kind, isHostile(e)];
    // Hostile because the class implements IMob (the dump's fact).
    assert.deepEqual(pin(spawn('aether_legacy', 7)), ['aether_legacy:cockatrice', 'Cockatrice', 'hostile', 'Hostile mobs', true]);
    // Hostile through a rotn-data override (not IMob; targetsPlayers, verified from bytecode).
    assert.deepEqual(pin(spawn('iceandfire', 905)), ['iceandfire:firedragon', 'Fire Dragon', 'hostile', 'Hostile mobs', true]);
    // Living, neither IMob nor an override: passive.
    assert.deepEqual(pin(spawn('butterflies', 0)), ['butterflies:butterfly', 'Butterfly', 'passive', 'Passive mobs', false]);
    // Not living: no type from the table, so the spawn rule applies, unthrown and thrown.
    assert.deepEqual(pin(spawn('iceandfire', 902)), ['iceandfire:dragonarrow', 'Dragon Bone Arrow', 'other', 'Modded', false]);
    assert.deepEqual(pin(spawn('iceandfire', 902, { throwerId: 4243 })), ['iceandfire:dragonarrow', 'Dragon Bone Arrow', 'projectile', 'Modded', false]);
    // An id the dump lacks keeps the placeholder.
    assert.deepEqual(pin(spawn('iceandfire', 4)), ['iceandfire:entity_4', 'iceandfire:entity_4', 'other', 'unknown', false]);
});

test('fmlEntityTable tolerates a missing or empty catalog', () => {
    assert.deepEqual(fmlEntityTable(), {});
    assert.deepEqual(fmlEntityTable({ modEntityTable: () => null, entityByModId: () => null }), {});
    assert.deepEqual(fmlEntityTable({ modEntityTable: () => ({ m: { 3: 'm:thing' } }) }), { m: { 3: { name: 'm:thing', displayName: null } } });
});

// #550 review: an unknown FML entity that looks living is a 'mob', so the bot reacts to an
// unknown modded hostile (rotn-data failed to load, or the server has an id the dump lacks).
const LIVING = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'rotn-3.3.4', 'entity-spawn-living-pattern.json'), 'utf8'));
const hexOf = (f) => {
    const buf = Buffer.from(f.hex, 'hex');
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), f.sha256);
    return buf;
};
const fmlSpawn = (f, reader) => decodeFml(hexOf(f), { readMetadata: reader.readMetadata });

test('the 1.12 living pattern (key 6 byte, key 7 float) is pinned from a captured vanilla zombie spawn', () => {
    const reader = createTypeReader({ reid: true });
    const pkt = hexOf(LIVING.vanillaZombie);
    assert.equal(pkt[0], 0x03, 'play.spawn_entity_living');
    assert.equal(pkt[19], 54, 'entity type 54 (VarInt, one byte): minecraft:zombie');
    assert.equal(fakeBot().registry.entities[54].name, 'zombie');
    // The same entityMetadata reader the FML EntitySpawn decoder uses; it reads exactly to the packet's end.
    const { value: metadata, size } = reader.readMetadata(pkt, LIVING.vanillaZombie.metadataOffset);
    assert.equal(LIVING.vanillaZombie.metadataOffset + size, pkt.length);
    const at = (key) => metadata.find((m) => m.key === key);
    assert.deepEqual(at(6), { key: 6, type: 0, value: 0 }, 'HAND_STATES: serializer 0, a byte');
    assert.deepEqual(at(7), { key: 7, type: 2, value: 20 }, 'HEALTH: serializer 2, a float (a zombie\'s 20)');
    assert.deepEqual({ ...LIVING_METADATA }, { 6: 0, 7: 2 });
    assert.equal(looksLiving(metadata), true);
});

test('looksLiving: both keys with their serializer, else false', () => {
    const base = [{ key: 0, type: 0, value: 0 }, { key: 1, type: 1, value: 300 }];
    assert.equal(looksLiving([...base, { key: 6, type: 0, value: 0 }, { key: 7, type: 2, value: 4 }]), true);
    assert.equal(looksLiving([...base, { key: 6, type: 0, value: 1 }, { key: 7, type: 1, value: -1 }]), false, 'an arrow: crit byte, then a VarInt colour');
    assert.equal(looksLiving([...base, { key: 6, type: 1, value: 0 }, { key: 7, type: 1, value: 1 }, { key: 8, type: 2, value: 0 }]), false, 'a boat or cart: VarInts, then a float damage at 8');
    assert.equal(looksLiving([...base, { key: 6, type: 2, value: 3 }, { key: 7, type: 1, value: 0 }]), false, 'an area-effect cloud: float radius at 6');
    assert.equal(looksLiving([...base, { key: 7, type: 2, value: 20 }]), false, 'key 6 missing');
    assert.equal(looksLiving([...base, { key: 6, type: 0, value: 0 }]), false, 'key 7 missing');
    assert.equal(looksLiving(base), false);
    assert.equal(looksLiving(null), false, 'no metadata (metadataError): not living');
    assert.equal(looksLiving(5), false);
});

test('an unknown FML entity that looks living is a mob (captured charm:spectre); a non-living one stays other (captured scent marker)', async () => {
    const { isHostile } = await import('../../../src/utils/mcdata.js');
    const reader = createTypeReader({ reid: true });
    const spectre = fmlSpawn(LIVING.fmlSpectre, reader);
    const scent = fmlSpawn(LIVING.fmlScent, reader);
    assert.deepEqual([spectre.modId, spectre.modEntityTypeId, spectre.throwerId, spectre.metadataError], ['charm', 2, 0, null]);
    assert.deepEqual([scent.modId, scent.modEntityTypeId, scent.throwerId, scent.metadataError], ['zombieawareness', 0, 0, null]);
    // rotn-data's facts agree with the pattern for both.
    assert.ok(rotnData.entityByModId('charm', 2).kinds.includes('living'));
    assert.ok(!rotnData.entityByModId('zombieawareness', 0).kinds.includes('living'));
    assert.equal(looksLiving(spectre.metadata), true);
    assert.equal(looksLiving(scent.metadata), false, 'its keys 6 and 7 are VarInts');

    // No table (rotn-data failed to load): the living one is a mob, so isHostile (threatFor's fallback) sees it.
    const pin = (e) => [e.name, e.type, e.kind, e.forge.nameKnown, isHostile(e)];
    assert.deepEqual(pin(spawnFmlEntity(fakeBot(), spectre)), ['charm:entity_2', 'mob', 'unknown', false, true]);
    assert.deepEqual(pin(spawnFmlEntity(fakeBot(), scent)), ['zombieawareness:entity_0', 'other', 'unknown', false, false]);
    // Thrown stays a projectile, even with a living pattern.
    assert.equal(spawnFmlEntity(fakeBot(), { ...spectre, throwerId: 9, velocity: { x: 0, y: 0, z: 0 } }).type, 'projectile');
    // Metadata that could not be read: not living.
    assert.equal(spawnFmlEntity(fakeBot(), { ...spectre, metadata: null, metadataError: 'x' }).type, 'other');
    // An id the table lacks, with the real table: the same rule.
    const table = fmlEntityTable({ modEntityTable: rotnData.modEntityTable, entityByModId: rotnData.entityByModId });
    assert.equal(table.charm[999], undefined);
    assert.deepEqual(pin(spawnFmlEntity(fakeBot(), { ...spectre, modEntityTypeId: 999 }, { modEntityTable: table })), ['charm:entity_999', 'mob', 'unknown', false, true]);

    // Known entries are unchanged: the table's type, or the old rule when it gives none.
    assert.deepEqual(pin(spawnFmlEntity(fakeBot(), spectre, { modEntityTable: table })), ['charm:spectre', 'hostile', 'Hostile mobs', true, true]);
    assert.deepEqual(pin(spawnFmlEntity(fakeBot(), scent, { modEntityTable: table })), ['zombieawareness:entityscent', 'other', 'Modded', true, false]);
    // A known name without a type stays other even with a living pattern (never 'mob' by the pattern).
    assert.equal(spawnFmlEntity(fakeBot(), spectre, { modEntityTable: { charm: { 2: 'charm:spectre' } } }).type, 'other');
});

test('attachFmlEntities logs each unknown modId#typeId once: name, looks living, type', () => {
    const reader = createTypeReader({ reid: true });
    const spectre = fmlSpawn(LIVING.fmlSpectre, reader);
    const scent = fmlSpawn(LIVING.fmlScent, reader);
    const bot = fakeBot();
    const bridge = new EventEmitter();
    const logs = [];
    const h = attachFmlEntities(bot, bridge, { log: (m) => logs.push(m), modEntityTable: { iceandfire: { 7: 'iceandfire:dragon' } } });
    bridge.emit('entitySpawn', spectre);
    bridge.emit('entitySpawn', { ...spectre, entityId: spectre.entityId + 1 });
    bridge.emit('entitySpawn', scent);
    bridge.emit('entitySpawn', { ...SPAWN, entityId: 1 }); // known: not logged
    bridge.emit('entitySpawn', { ...SPAWN, entityId: 2, modEntityTypeId: 8, metadata: null, metadataError: 'unknown serializer' });
    assert.equal(h.spawned, 5);
    assert.deepEqual(logs, [
        'FML entity charm#2 is not in the mod entity table: named charm:entity_2, looks living: yes, type mob (logged once)',
        'FML entity zombieawareness#0 is not in the mod entity table: named zombieawareness:entity_0, looks living: no, type other (logged once)',
        'FML entity iceandfire#8 is not in the mod entity table: named iceandfire:entity_8, looks living: unknown (no metadata), type other (logged once)',
    ]);
    assert.deepEqual(h.unknown, ['charm#2', 'zombieawareness#0', 'iceandfire#8']);
    assert.equal(bot.entities[spectre.entityId + 1].type, 'mob', 'every spawn gets the rule, only the log is once');
});
