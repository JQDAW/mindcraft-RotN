// Offline tests for skills-rotn B1b, the skills name space (lead decision on
// STATUS Request 8): the command boundary hands skills the bot's 1.12 names
// ("log" = any log, "log:0" = oak), inventory counts and block searches honour
// the variant, and LLM-facing names use the same form. 1.12.2 registry plus
// rotn-data's RotN 3.3.4 dump; fake bots; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { parseCommandMessage } from '../commands/index.js';
import * as names from './rotn_names.js';
import * as world from './world.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);

test('canonicalName: 1.21 names map to their exact variant, the bot\'s own 1.12 names stay as written', () => {
    const cases = [
        // [input, kind, expected]
        ['oak_log', 'items', 'log:0'], // lead decision: oak only
        ['log', 'items', 'log'], // lead decision: any log
        ['spruce_log', 'items', 'log:1'],
        ['log:1', 'items', 'log:1'],
        ['oak_planks', 'items', 'planks:0'],
        ['planks', 'items', 'planks'],
        ['charcoal', 'items', 'coal:1'],
        ['crafting_table', 'items', 'crafting_table'], // no subtypes: never a meta
        ['stone_pickaxe', 'items', 'stone_pickaxe'],
        ['cobblestone', 'items', 'cobblestone'],
        ['grass_block', 'blocks', 'grass'],
        ['short_grass', 'blocks', 'tallgrass:1'],
        ['oak_log', 'blocks', 'log:0'],
        ['nonsense_block', 'items', null],
    ];
    for (const [input, kind, expected] of cases) {
        assert.equal(names.canonicalName(input, kind), expected, `${input} (${kind})`);
    }
});

test('hasSubtypes comes from the dump: logs, planks, coal and rocks yes; tools and the table no', () => {
    for (const n of ['log', 'planks', 'coal', 'pyrotech:rock']) assert.equal(names.hasSubtypes(n), true, n);
    for (const n of ['stone_pickaxe', 'pyrotech:crude_axe', 'crafting_table', 'stick']) assert.equal(names.hasSubtypes(n), false, n);
    assert.equal(names.formatName('pyrotech:rock', 6), 'pyrotech:rock:6');
    assert.equal(names.formatName('crafting_table', 0), 'crafting_table');
});

const item = (name, metadata, count) => ({ name, metadata, count, type: reg.itemsByName[name]?.id });
function inventoryBot(items) {
    return { inventory: { items: () => items, slots: [null, ...items, null] } };
}

test('countItem and getInventoryCounts: variants are told apart, a bare name counts them all', () => {
    const bot = inventoryBot([item('log', 0, 3), item('log', 1, 2), item('stone_pickaxe', 12, 1), item('stick', 0, 4)]);
    assert.equal(names.countItem(bot, 'log'), 5);
    assert.equal(names.countItem(bot, 'log:0'), 3);
    assert.equal(names.countItem(bot, 'log:1'), 2);
    assert.equal(names.countItem(bot, 'stone_pickaxe'), 1, 'tool damage is not a variant');
    assert.equal(names.countItem(bot, 'oak_log'), 0, 'skills get canonical names from the boundary, not 1.21 ones');
    assert.deepEqual(world.getInventoryCounts(bot), { 'log:0': 3, 'log:1': 2, stone_pickaxe: 1, stick: 4 });
});

function blockBot(blocks) {
    const calls = [];
    return {
        calls,
        entity: { position: new Vec3(0, 64, 0) },
        // Like mineflayer: ids narrow the search, useExtraInfo(block) filters inside it, count caps it.
        findBlocks: (opts) => {
            calls.push(opts);
            const ids = opts.matching == null ? null : [].concat(opts.matching);
            return blocks.filter(b => (!ids || typeof opts.matching === 'function' || ids.includes(b.type))
                && (typeof opts.useExtraInfo !== 'function' || opts.useExtraInfo(b)))
                .slice(0, opts.count ?? blocks.length).map(b => b.position);
        },
        blockAt: (pos) => blocks.find(b => b.position.equals(pos)) ?? null,
    };
}
const logBlock = (x, metadata) => ({ name: 'log', type: reg.blocksByName.log.id, metadata, position: new Vec3(x, 64, 0) });

test('getNearestBlocks honours a variant, in every orientation; a bare name finds all', () => {
    const blocks = [logBlock(1, 0), logBlock(2, 5), logBlock(3, 9), logBlock(4, 1), logBlock(5, 4)];
    const bot = blockBot(blocks);
    assert.deepEqual(world.getNearestBlocks(bot, 'log:1', 16).map(b => b.metadata), [5, 9, 1], 'spruce, any axis');
    assert.deepEqual(world.getNearestBlocks(bot, 'log:0', 16, 1).map(b => b.metadata), [0]);
    assert.equal(world.getNearestBlocks(bot, 'log', 16).length, 5);
    assert.deepEqual(bot.calls[0].matching, [reg.blocksByName.log.id]);
    assert.equal(typeof bot.calls[0].useExtraInfo, 'function', 'the variant is checked inside findBlocks (#131 review nit)');
});

test('getNearbyBlockTypes shows canonical names: a sideways spruce log is log:1', () => {
    const blocks = [logBlock(1, 9), logBlock(2, 4), { name: 'furnace', type: reg.blocksByName.furnace.id, metadata: 3, position: new Vec3(6, 64, 0) }];
    assert.deepEqual(world.getNearbyBlockTypes(blockBot(blocks), 16), ['log:1', 'log:0', 'furnace']);
});

test('the command boundary hands skills canonical names', () => {
    assert.deepEqual(parseCommandMessage('!collectBlocks("oak_log", 10)'), { commandName: '!collectBlocks', args: ['log:0', 10] });
    assert.deepEqual(parseCommandMessage('!collectBlocks("log", 5)'), { commandName: '!collectBlocks', args: ['log', 5] });
    assert.deepEqual(parseCommandMessage('!craftRecipe("charcoal", 1)').args, ['coal:1', 1]);
    assert.deepEqual(parseCommandMessage('!craftRecipe("crafting_table", 1)').args, ['crafting_table', 1]);
    assert.match(parseCommandMessage('!collectBlocks("not_a_block", 1)'), /Invalid block type: not_a_block/);
});

test('no dead 1.21-only names (wall_torch, cave_air, deepslate_) in the skills code paths', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['./skills.js', './world.js', '../modes.js', '../commands/queries.js', '../commands/actions.js']) {
        const lines = readFileSync(new URL(file, import.meta.url), 'utf8').split(/\r?\n/);
        const hits = lines.filter(l => /wall_torch|cave_air|deepslate_/.test(l.replace(/\/\/.*$/, '')));
        assert.deepEqual(hits, [], file);
    }
});

test('craftRecipe asks recipesFor for the named variant ("planks:1" spruce), not any (lead, #124 review)', async () => {
    const skills = await import('./skills.js');
    const metas = new Set();
    const bot = {
        output: '',
        registry: reg,
        entity: { position: new Vec3(0, 64, 0) },
        inventory: { items: () => [], slots: [] },
        findBlocks: () => [],
        blockAt: () => null,
        recipesFor: (id, meta) => { metas.add(meta); return []; },
        modes: { isOn: () => false },
    };
    for (const [name, expected] of [['planks:1', 1], ['planks:0', 0], ['planks', null]]) {
        metas.clear();
        await skills.craftRecipe(bot, name, 1).catch(() => {});
        assert.deepEqual([...metas], [expected], name);
    }
});

test('#131 nit: "minecraft:" is recognised after leading spaces too', () => {
    assert.equal(names.canonicalName('  minecraft:snow', 'items'), 'snow', 'the 1.12 snow block, as written');
    assert.equal(names.canonicalName('minecraft:snow', 'items'), 'snow');
    assert.equal(names.canonicalName('snow', 'items'), 'snow_layer');
});
