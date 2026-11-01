// FML EntitySpawn into bot.entities (src/fml-entities.js, brief item 6). Offline:
// a minimal bot object with the real prismarine-entity, prismarine-registry
// (extended with forge-bridge's registry extension) and mineflayer conversions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { spawnFmlEntity, attachFmlEntities, fmlEntityName } from '../src/fml-entities.js';
import { extendRegistry } from '../src/registry-extension.js';
import { RegistrySnapshot } from '../src/registries.js';
import { syntheticRegistries } from './helpers.js';

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
    assert.equal(e.type, 'mob');
    assert.equal(e.uuid, SPAWN.uuid);
    assert.deepEqual([e.position.x, e.position.y, e.position.z], [100.5, 64, -200.25]);
    assert.equal(e.yaw, conv.fromNotchianYaw(90));
    assert.equal(e.pitch, conv.fromNotchianPitch(-45));
    assert.equal(e.metadata[0], 1, 'metadata by key, as mineflayer stores it');
    assert.equal(e.metadata[12], true);
    assert.deepEqual(e.forge, { modId: 'iceandfire', modEntityTypeId: 7, nameKnown: true, throwerId: 0, metadataError: null });
});

test('without the table the name is a clear placeholder (TODO rotn-data)', () => {
    assert.deepEqual(fmlEntityName(SPAWN), { name: 'iceandfire:entity_7', known: false });
    assert.deepEqual(fmlEntityName(SPAWN, { iceandfire: { 7: 'iceandfire:dragon' } }), { name: 'iceandfire:dragon', known: true });
    const e = spawnFmlEntity(fakeBot(), SPAWN);
    assert.equal(e.name, 'iceandfire:entity_7');
    assert.equal(e.displayName, 'iceandfire:entity_7');
    assert.equal(e.kind, 'Modded');
    assert.equal(e.forge.nameKnown, false);
});

test('thrown entities keep their velocity (blocks/tick) and thrower; an existing entity object is reused', () => {
    const bot = fakeBot();
    const Entity = require('prismarine-entity')('1.12.2');
    const before = bot.entities[4242] = new Entity(4242);
    const e = spawnFmlEntity(bot, { ...SPAWN, throwerId: 99, velocity: { x: 0.5, y: -0.25, z: 1 } });
    assert.equal(e, before);
    assert.deepEqual([e.velocity.x, e.velocity.y, e.velocity.z], [0.5, -0.25, 1]);
    assert.equal(e.forge.throwerId, 99);
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
