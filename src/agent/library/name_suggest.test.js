// Soak 13 (C3b, the lead): an unknown block or item name says up to 3 closest real names (by shared words),
// so the model does not guess again (day 3: 3 calls to reach rustic:wildberry_bush).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { parseCommandMessage } from '../commands/index.js';
import { suggestNames, suggestText } from './name_suggest.js';

const PACK = ['rustic:wildberry_bush', 'rustic:chili_crop', 'rustic:apple_leaves', 'rustic:grape_stem', 'harvestcraft:soggygarden',
    'contenttweaker:chalk_cobble', 'contenttweaker:siltstone_cobble', 'cobblestone', 'harvestcraft:rasberrybush',
    'harvestcraft:blackberrybush', 'pyrotech:rock', 'undergroundbiomes:sedimentary_stone'];

test('soak 13 C3b: the closest real names by shared words, at most 3', () => {
    // Day 3's three guesses all name the real bush first.
    assert.equal(suggestNames('rustic:wildberries', PACK)[0], 'rustic:wildberry_bush');
    assert.equal(suggestNames('wildberry_bush', PACK)[0], 'rustic:wildberry_bush');
    assert.equal(suggestNames('contenttweaker:wildberry_bush', PACK)[0], 'rustic:wildberry_bush');
    assert.deepEqual(suggestNames('chalk_cobblestone', PACK), ['contenttweaker:chalk_cobble', 'cobblestone', 'contenttweaker:siltstone_cobble']);
    assert.ok(suggestNames('cobble', PACK).length <= 3);
    assert.deepEqual(suggestNames('sedimentary_stone:2', PACK), ['undergroundbiomes:sedimentary_stone'], 'a meta suffix is no word');
    assert.deepEqual(suggestNames('diamond_sword', PACK), [], 'nothing shared: no hint');
    assert.deepEqual(suggestNames('rustic:', PACK), [], 'a namespace alone is no match');
    assert.equal(suggestText('rustic:wildberries', ['rustic:wildberry_bush']), ' Did you mean rustic:wildberry_bush?');
    assert.equal(suggestText('x_y', ['x_a', 'y_b']), ' Did you mean x_a or y_b?');
    assert.equal(suggestText('zzz', PACK), '');
});

test('soak 13 C3b: a command with an unknown block or item name says the closest names', () => {
    __setRegistryForTest(minecraftData('1.12.2'));
    const block = parseCommandMessage('!searchForBlock("diamond_ores", 32)');
    assert.equal(typeof block, 'string');
    assert.match(block, /^Invalid block type: diamond_ores\. Did you mean diamond_ore(, [a-z_]+)*( or [a-z_]+)?\?$/);
    const item = parseCommandMessage('!craftRecipe("stone_pickaxes", 1)');
    assert.match(item, /^Invalid item type: stone_pickaxes\. Did you mean stone_pickaxe/);
    assert.equal(parseCommandMessage('!searchForBlock("zzzq", 32)'), 'Invalid block type: zzzq.', 'nothing close: as before');
});
