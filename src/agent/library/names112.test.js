// Offline tests for skills-rotn B1: the 1.12.2 names and entity facts the
// skills now use, checked against minecraft-data 1.12.2, plus the crash fixes
// (useDoor with no door, an unknown biome id) and the 1.12 world height.
// Fake bots on the 1.12.2 registry; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import * as names112 from './names112.js';
import * as world from './world.js';
import * as skills from './skills.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);

test('every 1.12 block name the skills use exists in minecraft-data 1.12.2', () => {
    const all = [
        ...names112.WATER_BLOCKS, ...names112.LAVA_BLOCKS, ...names112.FURNACE_BLOCKS,
        ...names112.EMPTY_BLOCKS, ...names112.WOODEN_DOORS, names112.GRASS_BLOCK,
    ];
    for (const name of all) assert.ok(reg.blocksByName[name], `${name} is not a 1.12.2 block`);
});

test('the 1.21 names they replace do not exist in 1.12.2 (so the old code never matched)', () => {
    for (const name of ['grass_block', 'short_grass', 'tall_grass', 'dead_bush', 'fern', 'oak_door', 'mangrove_door', 'cherry_door']) {
        assert.equal(reg.blocksByName[name], undefined, name);
    }
    // In 1.12 "grass" is the solid grass block, so it must not count as empty.
    assert.equal(reg.blocksByName.grass.boundingBox, 'block');
    assert.ok(!names112.EMPTY_BLOCKS.includes('grass'));
});

test('liquid and furnace predicates cover the 1.12 split blocks', () => {
    assert.ok(names112.isWater('flowing_water') && names112.isWater('water'));
    assert.ok(names112.isLava('flowing_lava') && names112.isLava('lava'));
    assert.ok(names112.isLiquid('flowing_lava') && !names112.isLiquid('stone') && !names112.isLiquid(undefined));
    assert.ok(names112.isFurnace('lit_furnace') && names112.isFurnace('furnace') && !names112.isFurnace('crafting_table'));
});

test('isBaby reads the 1.12 index 12, not the 1.21 index 16', () => {
    assert.equal(names112.isBaby({ metadata: { 12: true } }), true);
    assert.equal(names112.isBaby({ metadata: { 12: false, 16: true } }), false);
    assert.equal(names112.isBaby({ metadata: {} }), false);
    assert.equal(names112.isBaby({}), false);
});

test('isDoorOpen reads 1.12 door metadata (lower half bit 4; the upper half reads the block below)', () => {
    const at = (y, metadata) => ({ name: 'wooden_door', metadata, position: new Vec3(0, y, 0), _properties: {} });
    const bot = (lower) => ({ blockAt: (pos) => (pos.y === 64 ? lower : null) });
    assert.equal(names112.isDoorOpen(bot(null), at(64, 4)), true);
    assert.equal(names112.isDoorOpen(bot(null), at(64, 0)), false);
    assert.equal(names112.isDoorOpen(bot(at(64, 4 | 1)), at(65, 8)), true, 'upper half of an open door');
    assert.equal(names112.isDoorOpen(bot(at(64, 1)), at(65, 8)), false, 'upper half of a closed door');
    assert.equal(names112.isDoorOpen(bot(null), { ...at(64, 0), _properties: { open: true } }), true, 'properties win when present');
    assert.equal(names112.isDoorOpen(bot(null), null), false);
});

test('getVillagerProfession reads the 1.12 index 13; getBiomeName survives an unknown biome', () => {
    assert.equal(world.getVillagerProfession({ metadata: { 13: 1 } }), 'Librarian');
    assert.equal(world.getVillagerProfession({ metadata: { 13: 5 } }), 'Nitwit');
    const bot = { entity: { position: new Vec3(0, 64, 0) }, world: { getBiome: () => 9999 } };
    assert.equal(world.getBiomeName(bot), 'unknown');
    bot.world.getBiome = () => reg.biomesByName.plains.id;
    assert.equal(world.getBiomeName(bot), 'plains');
});

test('useDoor with no door nearby returns false instead of throwing', async () => {
    const bot = {
        output: '',
        entity: { position: new Vec3(0, 64, 0) },
        findBlocks: () => [],
        blockAt: () => null,
    };
    assert.equal(await skills.useDoor(bot), false);
    assert.match(bot.output, /Could not find a door to use/);
});

test('goToSurface scans the 1.12 height, 255 down to 0', async () => {
    const ys = [];
    const bot = { output: '', entity: { position: new Vec3(0, 64, 0) }, blockAt: (pos) => { ys.push(pos.y); return null; } };
    assert.equal(await skills.goToSurface(bot), false);
    assert.equal(Math.max(...ys), 255);
    assert.equal(Math.min(...ys), 0);
    assert.equal(ys.length, 256);
});
