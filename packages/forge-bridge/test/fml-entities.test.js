// FML EntitySpawn into bot.entities (src/fml-entities.js, brief item 6). Offline:
// a minimal bot object with the real prismarine-entity, prismarine-registry
// (extended with forge-bridge's registry extension) and mineflayer conversions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { spawnFmlEntity, attachFmlEntities, fmlEntityName, fmlEntityTable } from '../src/fml-entities.js';
import * as rotnData from '../../rotn-data/index.js';
import { extendRegistry } from '../src/registry-extension.js';
import { RegistrySnapshot } from '../src/registries.js';
import { syntheticRegistries, FIXTURES } from './helpers.js';
import { decodeFml, encodeEntitySpawn } from '../src/channels.js';
import { createTypeReader } from '../src/reid.js';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
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

test('the table can supply type, category and size; only then is an FML entity a mob', async () => {
    const { isHostile } = await import('../../../src/utils/mcdata.js');
    const table = { iceandfire: { 7: { name: 'dragon', type: 'mob', category: 'Hostile mobs', width: 4, height: 3 } } };
    const dragon = spawnFmlEntity(fakeBot(), SPAWN, { modEntityTable: table });
    assert.deepEqual([dragon.type, dragon.kind, dragon.width, dragon.height], ['mob', 'Hostile mobs', 4, 3]);
    assert.equal(isHostile(dragon), true);
    const unknown = spawnFmlEntity(fakeBot(), SPAWN);
    assert.equal(isHostile(unknown), false, 'Mindcraft does not attack an entity it knows nothing about');
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
    assert.match(logs[0], /FML EntitySpawn iceandfire#7 \(entity 5\) not applied/);
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

    // Every entry of the mod-local table spawns as the catalog says.
    let count = 0;
    let hostileCount = 0;
    for (const [modId, byId] of Object.entries(rotnData.modEntityTable())) {
        for (const id of Object.keys(byId).map(Number)) {
            const want = expected(modId, id);
            const e = spawn(modId, id);
            assert.deepEqual(got(e), want, `${modId} #${id}`);
            assert.equal(e.forge.nameKnown, true);
            count++;
            if (want.hostile) hostileCount++;
        }
    }
    assert.ok(count >= 500 && hostileCount >= 50 && count - hostileCount >= 100, `${count} entities, ${hostileCount} hostile`);

    // Every modded mob in rotn-data's common-mobs.json (G2's mobs_named list, which the
    // console summons) is in the table under its own registry name.
    const common = JSON.parse(fs.readFileSync(new URL('../../rotn-data/3.3.4/common-mobs.json', import.meta.url), 'utf8')).mobs;
    const modded = common.filter((m) => m.modded);
    assert.ok(modded.length >= 10, `common-mobs.json has modded mobs (${modded.length})`);
    for (const m of modded) {
        const { modId, modEntityTypeId } = rotnData.entity(m.name);
        assert.deepEqual(got(spawn(modId, modEntityTypeId)), expected(modId, modEntityTypeId), `${m.name} (${modId} #${modEntityTypeId})`);
    }

    // Pinned: cases that must not drift whatever rotn-data's overrides say.
    const dragon = spawn('iceandfire', 905);
    assert.deepEqual([dragon.name, dragon.displayName], ['iceandfire:firedragon', 'Fire Dragon']);
    assert.ok(['hostile', 'passive'].includes(dragon.type), 'a dragon is a living mob (its hostility is rotn-data\'s call)');
    const cockatrice = spawn('aether_legacy', 7);
    assert.deepEqual([cockatrice.name, cockatrice.type, cockatrice.kind, isHostile(cockatrice)], ['aether_legacy:cockatrice', 'hostile', 'Hostile mobs', true]);
    const butterfly = spawn('butterflies', 0);
    assert.deepEqual([butterfly.name, butterfly.type, isHostile(butterfly)], ['butterflies:butterfly', 'passive', false]);
    const arrow = spawn('iceandfire', 902, { throwerId: 4243 });
    assert.deepEqual([arrow.name, arrow.type, isHostile(arrow)], ['iceandfire:dragonarrow', 'projectile', false], 'not living: the thrower rule applies');
    const unknown = spawn('iceandfire', 4);
    assert.deepEqual([unknown.name, unknown.type, unknown.kind], ['iceandfire:entity_4', 'other', 'unknown'], 'an id the dump lacks keeps the placeholder');
});

test('fmlEntityTable tolerates a missing or empty catalog', () => {
    assert.deepEqual(fmlEntityTable(), {});
    assert.deepEqual(fmlEntityTable({ modEntityTable: () => null, entityByModId: () => null }), {});
    assert.deepEqual(fmlEntityTable({ modEntityTable: () => ({ m: { 3: 'm:thing' } }) }), { m: { 3: { name: 'm:thing', displayName: null } } });
});
