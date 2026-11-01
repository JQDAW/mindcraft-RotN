// Writes test/fixtures/mini-dump/: a tiny, hand-made dump in format rotn-dump/1,
// used to unit-test the catalog without the real dump. The values are made up
// to look like RotN; they are NOT facts about the pack.
// Usage: node packages/rotn-data/test/fixtures/make-mini-dump.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mini-dump');
const W = 32767;
const st = (name, meta = 0) => ({ name, meta });
const ore = (k, stacks) => ({ ore: k, stacks });
const ORES = {
    rock: [st('pyrotech:rock', 0), st('pyrotech:rock', 6)],
    stickWood: [st('minecraft:stick')],
    stickMat: [st('minecraft:planks', W)],
    plankWood: [st('minecraft:planks', W)],
};
const ids = (names) => Object.fromEntries(names.map((n, i) => [n, i + 1]));
const blockNames = ['minecraft:stone', 'minecraft:log', 'minecraft:planks', 'minecraft:crafting_table', 'minecraft:cobblestone', 'pyrotech:rock'];
const itemNames = [...blockNames, 'minecraft:stick', 'minecraft:flint', 'minecraft:stone_axe', 'minecraft:stone_pickaxe', 'pyrotech:crude_axe',
    'contenttweaker:crafting_tools', 'minecraft:coal', 'minecraft:iron_ingot', 'contenttweaker:raw_iron', 'minecraft:furnace'];
const rockOrFlint = () => ({ stacks: [...ORES.rock, st('minecraft:flint')] });
const files = {
    'registry-names.json': { registries: {
        'minecraft:blocks': { ids: ids(blockNames) },
        'minecraft:items': { ids: ids(itemNames) },
        'minecraft:entities': { ids: ids(['minecraft:zombie', 'minecraft:cow', 'specialmobs:firecreeper']) },
        'minecraft:biomes': { ids: ids(['minecraft:plains']) },
    } },
    'mining-levels.json': { levels: { 0: 'Crude', 1: 'Sturdy' } },
    'manifest.json': { format: 'rotn-dump/1', dumper: '0.0.0-test', pack: { version: 'mini' }, dumpedAt: '2026-11-01T00:00:00Z' },
    'blocks.json': { format: 'rotn-dump/1', blocks: {
        'minecraft:stone': { displayName: 'Stone', defaultMeta: 0, states: [
            { meta: 0, props: { variant: 'stone' }, displayName: 'Stone', hardness: 1.5, material: 'rock', harvestTool: 'pickaxe', harvestLevel: 0, toolRequired: true },
            { meta: 1, props: { variant: 'granite' }, displayName: 'Granite', hardness: 1.5, material: 'rock', harvestTool: 'pickaxe', harvestLevel: 1, toolRequired: true },
        ] },
        'minecraft:log': { displayName: 'Oak Wood', defaultMeta: 0, states: [
            { meta: 0, props: { axis: 'y', variant: 'oak' }, hardness: 2, material: 'wood', harvestTool: 'axe', harvestLevel: 0, toolRequired: true },
            { meta: 4, props: { axis: 'x', variant: 'oak' }, hardness: 2, material: 'wood', harvestTool: 'axe', harvestLevel: 0, toolRequired: true },
        ] },
        'pyrotech:rock': { displayName: 'Rock', defaultMeta: 0, states: [
            { meta: 0, hardness: 0, material: 'circuits', harvestTool: null, harvestLevel: -1, toolRequired: false },
        ] },
    } },
    'items.json': { format: 'rotn-dump/1', items: {
        'pyrotech:crude_axe': { stackSize: 1, maxDamage: 8, toolClasses: { axe: 0 }, variants: [{ meta: 0, displayName: 'Crude Axe' }] },
        'pyrotech:rock': { stackSize: 64, hasSubtypes: true, variants: [{ meta: 0, displayName: 'Stone Rock' }, { meta: 6, displayName: 'Sandstone Rock' }] },
        'contenttweaker:crafting_tools': { stackSize: 1, variants: [{ meta: 0, displayName: 'Crafting Tools' }] },
        'minecraft:coal': { stackSize: 64, hasSubtypes: true, variants: [{ meta: 0, displayName: 'Coal', burnTime: 1600 }, { meta: 1, displayName: 'Charcoal', burnTime: 1600 }] },
    } },
    'oredict.json': { format: 'rotn-dump/1', ores: ORES },
    'recipes.json': { format: 'rotn-dump/1', recipes: [
        { id: 'crafttweaker:pyro_crude_axe', type: 'shaped', width: 2, height: 2, requiresTable: false, result: st('pyrotech:crude_axe'),
            slots: [rockOrFlint(), ore('stickWood', ORES.stickWood), ore('stickWood', ORES.stickWood), null] },
        { id: 'crafttweaker:crafting_tools', type: 'shapeless', requiresTable: false, result: st('contenttweaker:crafting_tools'),
            ingredients: [{ stacks: [st('pyrotech:crude_axe', W), st('minecraft:stone_axe', W)] }, rockOrFlint(), ore('stickWood', ORES.stickWood)],
            remaining: [st('pyrotech:crude_axe', 1), null, null] },
        { id: 'crafttweaker:crafting_table', type: 'shapeless', requiresTable: false, result: st('minecraft:crafting_table'),
            ingredients: [ore('stickMat', ORES.stickMat), { stacks: [st('contenttweaker:crafting_tools')] }] },
        { id: 'crafttweaker:cobble', type: 'shapeless', requiresTable: false, result: st('minecraft:cobblestone'),
            ingredients: [0, 1, 2, 3].map(() => ({ stacks: [st('pyrotech:rock')] })) },
        // CraftTweaker trims the empty column of a mirrored axe, so it is 2 wide here.
        { id: 'crafttweaker:stone_axe', type: 'shaped', width: 2, height: 3, mirrored: true, requiresTable: true, result: st('minecraft:stone_axe'),
            slots: [ore('rock', ORES.rock), ore('rock', ORES.rock), ore('rock', ORES.rock), ore('stickWood', ORES.stickWood), null, ore('stickWood', ORES.stickWood)] },
        { id: 'crafttweaker:stone_pickaxe', type: 'shaped', width: 3, height: 3, requiresTable: true, result: st('minecraft:stone_pickaxe'),
            slots: [ore('rock', ORES.rock), ore('rock', ORES.rock), ore('rock', ORES.rock), null, ore('stickWood', ORES.stickWood), null,
                null, ore('stickWood', ORES.stickWood), null] },
        { id: 'crafttweaker:stick', type: 'shaped', width: 1, height: 2, requiresTable: false, result: { name: 'minecraft:stick', meta: 0, count: 4 },
            slots: [ore('stickMat', ORES.stickMat), ore('stickMat', ORES.stickMat)] },
        { id: 'crafttweaker:furnace', type: 'shaped', width: 3, height: 3, requiresTable: true, result: st('minecraft:furnace'),
            slots: [0, 1, 2, 3, null, 5, 6, 7, 8].map(i => (i == null ? null : ore('rock', ORES.rock))) },
        { id: 'test:charcoal_by_hand', type: 'shapeless', requiresTable: false, result: st('minecraft:coal', 1), ingredients: [{ stacks: [st('minecraft:log', W)] }] },
    ] },
    'smelting.json': { format: 'rotn-dump/1', smelting: [
        { input: st('contenttweaker:raw_iron'), output: { name: 'minecraft:iron_ingot', meta: 0, count: 1 }, xp: 0.7 },
    ] },
    'entities.json': { format: 'rotn-dump/1', entities: {
        'minecraft:zombie': { modId: 'minecraft', modEntityTypeId: null, hostile: true, kinds: ['living', 'monster'], displayName: 'Zombie' },
        'minecraft:cow': { modId: 'minecraft', modEntityTypeId: null, hostile: false, kinds: ['living', 'animal'] },
        'specialmobs:firecreeper': { modId: 'specialmobs', modEntityTypeId: 7, hostile: true, kinds: ['living', 'monster'], displayName: 'Fire Creeper' },
    } },
};
for (const r of files['recipes.json'].recipes) r.result.count ??= 1;
fs.mkdirSync(DIR, { recursive: true });
for (const [n, v] of Object.entries(files)) fs.writeFileSync(path.join(DIR, n), JSON.stringify(v, null, 1) + '\n');
console.log(`wrote ${Object.keys(files).length} files to ${DIR}`);
