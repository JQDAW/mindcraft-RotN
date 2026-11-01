// Catalog API (rotn-data brief deliverable 2) on a synthetic mini dump
// (test/fixtures/mini-dump, made by make-mini-dump.mjs; values are not pack facts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { RotnData, loadRotnData } from '../index.js';
import { recipeMatches, trimGrid } from '../src/crosscheck.js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const mini = new RotnData(path.join(HERE, 'fixtures/mini-dump'), { version: 'mini' });
const expected = require('./fixtures/scripts-3.3.4-early-recipes.json').recipes;

test('mini dump loads', () => {
    assert.equal(mini.hasDump, true);
    assert.equal(mini.version, 'mini');
});

test('getBlock accepts registry, old and 1.21 names, and picks the state', () => {
    const a = mini.getBlock('minecraft:stone');
    assert.equal(a.propertiesKnown, true);
    assert.equal(a.state.props.variant, 'stone');
    assert.equal(mini.getBlock('stone:1').state.props.variant, 'granite');
    assert.equal(mini.getBlock('granite').state.props.variant, 'granite');
    assert.equal(mini.getBlock('oak_log').name, 'minecraft:log');
    assert.equal(mini.getBlock({ name: 'log', metadata: 4 }).state.props.axis, 'x');
    assert.equal(mini.getBlock('pyrotech:rock').state.material, 'circuits');
    assert.equal(mini.getBlock('planks').propertiesKnown, false); // in the registry, not in this dump
    assert.equal(mini.getBlock('nope:nope'), null);
});

test('harvestInfo reports tool, level and its Tool Progression name', () => {
    assert.deepEqual(mini.harvestInfo('stone'), {
        block: 'minecraft:stone', meta: 0, hardness: 1.5, tool: 'pickaxe', level: 0, levelName: 'Crude', toolRequired: true, material: 'rock',
    });
    assert.equal(mini.harvestInfo('granite').levelName, 'Sturdy');
    assert.equal(mini.harvestInfo('stone', 1).level, 1);
    const rock = mini.harvestInfo('pyrotech:rock');
    assert.equal(rock.tool, null);
    assert.equal(rock.level, -1);
    assert.equal(rock.levelName, null);
    assert.equal(mini.harvestInfo('planks'), null); // no dump data: null, not a guess
});

test('getItem returns the variant for the metadata', () => {
    assert.equal(mini.getItem('charcoal').variant.displayName, 'Charcoal');
    assert.equal(mini.getItem('coal').variant.displayName, 'Coal');
    assert.equal(mini.getItem('pyrotech:rock:6').variant.displayName, 'Sandstone Rock');
    assert.equal(mini.getItem('pyrotech:crude_axe').maxDamage, 8);
});

test('recipesFor returns the prismarine-like named shape', () => {
    const [axe] = mini.recipesFor('pyrotech:crude_axe');
    assert.equal(axe.type, 'shaped');
    assert.equal(axe.requiresTable, false);
    assert.equal(axe.inShape.length, 2);
    assert.equal(axe.inShape[1][1], null);
    assert.deepEqual(axe.inShape[0][1].stacks, [{ name: 'minecraft:stick', meta: 0 }]);
    const [tools] = mini.recipesFor('crafting_tools'.replace(/^/, 'contenttweaker:'));
    assert.equal(tools.type, 'shapeless');
    assert.equal(tools.ingredients.length, 3);
    assert.deepEqual(tools.remaining[0], { name: 'pyrotech:crude_axe', meta: 1 });
    // 1.21 names work, and metadata filters results.
    assert.equal(mini.recipesFor('crafting_table').length, 1);
    assert.equal(mini.recipesFor('charcoal').length, 1);
    assert.equal(mini.recipesFor('coal').length, 0);
    assert.deepEqual(mini.recipesFor('nope:nope'), []);
});

test('the script cross-check matcher accepts the mini dump recipes and rejects wrong ones', () => {
    const ore = (k) => mini.oreDict(k);
    for (const e of expected) {
        const found = mini.recipesFor(e.result.name).filter(r => recipeMatches(e, r, ore));
        assert.equal(found.length, 1, e.key);
    }
    const pick = mini.recipesFor('minecraft:stone_pickaxe')[0];
    const axeExp = expected.find(e => e.key === 'stone_axe');
    assert.equal(recipeMatches({ ...axeExp, result: pick.result }, pick, ore), false);
    // A mirrored shape only matches when the script says mirrored.
    const axe = mini.recipesFor('minecraft:stone_axe')[0];
    const flipped = { ...axe, inShape: axe.inShape.map(r => [...r].reverse()) };
    assert.equal(recipeMatches(axeExp, flipped, ore), true);
    assert.equal(recipeMatches({ ...axeExp, mirrored: false }, flipped, ore), false);
    // Wrong count.
    const stick = mini.recipesFor('minecraft:stick')[0];
    assert.equal(recipeMatches(expected.find(e => e.key === 'sticks'), { ...stick, result: { ...stick.result, count: 2 } }, ore), false);
});

test('trimGrid removes empty rows and columns', () => {
    assert.deepEqual(trimGrid([[null, null, null], [null, 1, null], [null, 2, 3]]), [[1, null], [2, 3]]);
    assert.deepEqual(trimGrid([[null]]), []);
});

test('smelting and entities', () => {
    assert.equal(mini.smeltingFor('iron_ingot')[0].input.name, 'contenttweaker:raw_iron');
    assert.equal(mini.smeltingOf('contenttweaker:raw_iron').output.name, 'minecraft:iron_ingot');
    assert.equal(mini.smeltingOf('cobblestone'), null);
    assert.equal(mini.entity('zombie').hostile, true);
    assert.equal(mini.entity({ name: 'cow' }).hostile, false);
    assert.equal(mini.entityByModId('specialmobs', 7).name, 'specialmobs:firecreeper');
    assert.equal(mini.entityByModId('specialmobs', 8), null);
    assert.equal(mini.entity('nope:nope'), null);
});

test('lookup finds by registry name, 1.21 alias and display name', () => {
    assert.equal(mini.lookup('crude axe')[0].name, 'pyrotech:crude_axe');
    assert.equal(mini.lookup('Fire Creeper')[0].name, 'specialmobs:firecreeper');
    assert.equal(mini.lookup('charcoal')[0].name, 'minecraft:coal:1');
    assert.equal(mini.lookup('sandstone rock')[0].name, 'pyrotech:rock:6');
    assert.ok(mini.lookup('rock', { kind: 'entity' }).length === 0);
    assert.deepEqual(mini.lookup(''), []);
});

test('the real 3.3.4 pack works before a dump: names yes, properties null', () => {
    const pack = loadRotnData('3.3.4');
    const b = pack.getBlock('pyrotech:rock');
    assert.equal(b.name, 'pyrotech:rock');
    if (!pack.hasDump) {
        assert.equal(b.propertiesKnown, false);
        assert.equal(pack.harvestInfo('stone'), null);
        assert.deepEqual(pack.recipesFor('pyrotech:crude_axe'), []);
    }
    assert.equal(pack.entity('specialmobs:firecreeper').name, 'specialmobs:firecreeper');
    assert.equal(pack.lookup('crude axe')[0].name, 'pyrotech:crude_axe');
});
