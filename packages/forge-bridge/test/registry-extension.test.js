// src/registry-extension.js: bot.registry gains the Forge-synced ids (brief
// item 4, ADR 0003 decision 4). Uses the real prismarine-registry,
// prismarine-block and prismarine-item for 1.12.2. Offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RegistrySnapshot } from '../src/registries.js';
import { extendRegistry } from '../src/registry-extension.js';
import { syntheticRegistries } from './helpers.js';

const require = createRequire(import.meta.url);
const freshRegistry = () => require('prismarine-registry')('1.12.2');

function snapshotOf(regs) {
    const snap = new RegistrySnapshot();
    regs.forEach((r, i) => snap.add({ ...r, hasMore: i < regs.length - 1 }));
    return snap;
}

test('modded blocks get names, 16 states and a solid default shape; prismarine-block sees them', () => {
    const registry = freshRegistry();
    const report = extendRegistry(registry, snapshotOf(syntheticRegistries()));
    assert.equal(report.added.blocks, 2);
    const rock = registry.blocks[4001];
    assert.equal(rock.name, 'pyrotech:rock');
    assert.equal(rock.registryName, 'pyrotech:rock');
    assert.equal(rock.displayName, 'Rock');
    assert.deepEqual(rock.forge, { modded: true, propertiesKnown: false });
    assert.equal(registry.blocksByName['pyrotech:rock'], rock);
    assert.equal(registry.blocksByStateId[(4001 << 4) | 3], rock);
    assert.equal(registry.blocksByStateId[(4002 << 4) | 15].name, 'pyrotech:log_pile');

    const Block = require('prismarine-block')(registry);
    const b = Block.fromStateId((4001 << 4) | 3, 1);
    assert.equal(b.name, 'pyrotech:rock');
    assert.equal(b.metadata, 3);
    assert.equal(b.boundingBox, 'block', 'solid: the bot can stand on it');
    assert.deepEqual(b.shapes, [[0, 0, 0, 1, 1, 1]]);
    assert.equal(Block.fromStateId(1 << 4, 1).name, 'stone', 'vanilla unchanged');
    assert.equal(Block.fromStateId(1 << 4, 1).hardness, 1.5);
});

test('modded items, entities and biomes get names; prismarine-item sees them', () => {
    const registry = freshRegistry();
    extendRegistry(registry, snapshotOf(syntheticRegistries()));
    assert.equal(registry.items[5003].name, 'pyrotech:crude_axe');
    assert.equal(registry.itemsByName['pyrotech:rock'].id, 4001);
    const Item = require('prismarine-item')(registry);
    const axe = new Item(5003, 1);
    assert.equal(axe.name, 'pyrotech:crude_axe');
    assert.equal(axe.stackSize, 64);
    assert.equal(new Item(280, 3).name, 'stick');
    assert.equal(registry.entities[300].name, 'iceandfire:dragon');
    assert.equal(registry.entities[300].type, 'mob');
    assert.equal(registry.entities[54].name, 'zombie');
    assert.equal(registry.biomes[300].name, 'biomesoplenty:bayou');
    assert.equal(registry.biomes[1].name, 'plains');
});

test('the process-wide minecraft-data object stays vanilla', () => {
    const registry = freshRegistry();
    extendRegistry(registry, snapshotOf(syntheticRegistries()));
    const md = require('minecraft-data')('1.12.2');
    assert.equal(md.blocks[4001], undefined);
    assert.equal(md.blocksByStateId[(4001 << 4) | 3], undefined);
    assert.equal(md.items[5003], undefined);
    assert.equal(freshRegistry().blocks[4001], undefined, 'a new registry starts vanilla');
});

test('dummied entries are skipped; a vanilla name moved to another id is rebound', () => {
    const registry = freshRegistry();
    const regs = [
        { name: 'minecraft:blocks', ids: [['minecraft:stone', 1], ['minecraft:dirt', 3000], ['oldmod:gone', 3001]], dummied: ['oldmod:gone'], overrides: [] },
    ];
    const report = extendRegistry(registry, snapshotOf(regs));
    assert.equal(registry.blocks[3001], undefined);
    assert.equal(report.rebound.blocks, 1);
    assert.equal(registry.blocks[3000].name, 'dirt');
    assert.equal(registry.blocks[3000].minStateId, 3000 << 4);
    assert.equal(registry.blocks[3], undefined, 'the old dirt slot is free');
    assert.equal(registry.blocksByName.dirt.id, 3000);
    assert.equal(registry.blocksByStateId[3 << 4], undefined);
    assert.equal(require('minecraft-data')('1.12.2').blocksByName.dirt.id, 3, 'the shared copy is untouched');
});

test('rotn-data properties fill in modded and override vanilla fields, keyed by registry name', () => {
    const registry = freshRegistry();
    extendRegistry(registry, snapshotOf(syntheticRegistries()), {
        properties: {
            blocks: { 'pyrotech:rock': { hardness: 0.5, boundingBox: 'empty', shapes: [] }, 'minecraft:stone': { hardness: 3 } },
            items: { 'pyrotech:crude_axe': { stackSize: 1 } },
        },
    });
    assert.equal(registry.blocks[4001].hardness, 0.5);
    assert.equal(registry.blocks[4001].boundingBox, 'empty');
    assert.equal(registry.blocks[4001].forge.propertiesKnown, true);
    assert.equal(registry.blocks[4001].name, 'pyrotech:rock', 'properties cannot rename');
    assert.equal(registry.blocks[1].hardness, 3);
    assert.equal(require('minecraft-data')('1.12.2').blocks[1].hardness, 1.5, 'the override is a copy');
    assert.equal(registry.items[5003].stackSize, 1);
});

test('a Block class made before the extension (as mineflayer does) also sees modded blocks with shapes', () => {
    const registry = freshRegistry();
    const Block = require('prismarine-block')(registry); // mineflayer's blocks plugin, at inject
    extendRegistry(registry, snapshotOf(syntheticRegistries()));
    const b = Block.fromStateId(4002 << 4, 1);
    assert.equal(b.name, 'pyrotech:log_pile');
    assert.deepEqual(b.shapes, [[0, 0, 0, 1, 1, 1]]);
    // ...and a class made later keeps the shapes too (prismarine-block resets them by name).
    assert.deepEqual(require('prismarine-block')(registry).fromStateId(4002 << 4, 1).shapes, [[0, 0, 0, 1, 1, 1]]);
});
