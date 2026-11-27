// Soak 18: the stone sword's handle needs twine, twine needs 3 tinder, and the planner said "pyrotech:tinder is a base
// item, you need to find 3 more in the world" with no hint where. RotN removes tinder's crafting recipe; grass drops it
// (Dropt). world-sources.json rule grass-tinder says so, with the odds from scripts/dropt.zs.
// Offline: the committed 3.3.4 data and fixtures (forage-food-3.3.4/dropt.zs is the pack's whole dropt.zs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';
import { formatHowToGet } from '../src/howto.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pack = loadRotnData('3.3.4');
const read = (f) => fs.readFileSync(path.join(HERE, 'fixtures', f), 'utf8').replace(/\r\n/g, '\n');
const rule = pack.worldSources.find((r) => r.id === 'grass-tinder');

// One Dropt list's rule text, from Dropt.list("<name>") to the next list.
const droptList = (src, name) => {
    const start = src.indexOf(`Dropt.list("${name}")`);
    assert.ok(start >= 0, name);
    const end = src.indexOf('Dropt.list(', start + 1);
    return src.slice(start, end < 0 ? undefined : end);
};
// [weight, item or null] per drop of a list (one rule each here).
const weights = (list) => [...list.matchAll(/\.selector\(Dropt\.weight\((\d+)\)\)\s*(?:\/\/[^\n]*)?\s*(?:\.items\(\[<([^>]+)>\]\))?/g)]
    .map((m) => [Number(m[1]), m[2] ?? null]);

test('grass-tinder: howToGet says grass and ferns drop tinder by hand, 0 or 1 per break', () => {
    assert.ok(rule, 'world-sources.json has the grass-tinder rule');
    const w = pack.howToGet('pyrotech:tinder').ways.find((x) => x.id === 'grass-tinder');
    assert.equal(w.kind, 'world');
    assert.equal(w.action, 'break');
    assert.equal(w.tool, null);
    assert.equal(w.confidence, 'documented');
    assert.deepEqual(w.blocks, [
        { name: 'minecraft:tallgrass', meta: 1 }, { name: 'minecraft:tallgrass', meta: 2 },
        { name: 'minecraft:double_plant', meta: 2 }, { name: 'minecraft:double_plant', meta: 3 },
    ]);
    assert.deepEqual(w.countRange, { min: 0, max: 1, mean: 0.077 });
    // The dump: tall grass 1 and fern 2 (0 is the dead shrub); double tall grass 2 and large fern 3, lower halves.
    const states = (n) => Object.fromEntries(pack.dump.blocks.blocks[n].states.map((s) => [s.meta, s]));
    assert.equal(states('minecraft:tallgrass')[1].props.type, 'tall_grass');
    assert.equal(states('minecraft:tallgrass')[2].props.type, 'fern');
    assert.deepEqual(['double_grass', 'double_fern'], [2, 3].map((m) => states('minecraft:double_plant')[m].props.variant));
    assert.deepEqual([2, 3].map((m) => states('minecraft:double_plant')[m].props.half), ['lower', 'lower']);
    const text = formatHowToGet(pack.howToGet('pyrotech:tinder'));
    assert.match(text, /Break grass or ferns/);
    assert.match(text, /about 1 time in 13 drops 1 tinder/);
    assert.match(text, /Tinder has no crafting recipe on RotN/);
});

test('grass-tinder: the odds and blocks are scripts/dropt.zs tall_grass_base_drops and double_tall_grass_base_drops', () => {
    const src = read('forage-food-3.3.4/dropt.zs');
    const tall = droptList(src, 'tall_grass_base_drops');
    const double = droptList(src, 'double_tall_grass_base_drops');
    for (const [list, blocks] of [[tall, ['minecraft:tallgrass:1', 'minecraft:tallgrass:2']], [double, ['minecraft:double_plant:2', 'minecraft:double_plant:3']]]) {
        for (const b of blocks) assert.ok(list.includes(`"${b}"`), b);
        assert.match(list, /\.replaceStrategy\("ADD"\)/);
        assert.doesNotMatch(list, /fallthrough|dropCount/);
        const ws = weights(list);
        const total = ws.reduce((a, [n]) => a + n, 0);
        const tinder = ws.filter(([, item]) => item === 'pyrotech:tinder').reduce((a, [n]) => a + n, 0);
        assert.equal(tinder, 420);
        assert.equal(Math.round((tinder / total) * 1000) / 1000, rule.countRange.mean, `${tinder}/${total}`);
        assert.equal(ws.filter(([, item]) => item === 'pyrotech:material:12')[0][0], 840, 'plant fiber, twice as often');
    }
    assert.equal(weights(tall).reduce((a, [n]) => a + n, 0), 5489);
    assert.match(tall, /\.matchHarvester\(Dropt\.harvester\(\)\s*\.type\("PLAYER"\)/);
    // No other list names these blocks (Dropt keeps the first matching rule: no fallthrough anywhere in the file).
    for (const b of ['minecraft:tallgrass', 'minecraft:double_plant']) {
        const lists = [...src.matchAll(/Dropt\.list\("([^"]+)"\)/g)].map((m) => m[1]).filter((n) => droptList(src, n).includes(`"${b}`));
        assert.deepEqual(lists, [b === 'minecraft:tallgrass' ? 'tall_grass_base_drops' : 'double_tall_grass_base_drops'], b);
    }
    assert.doesNotMatch(src, /fallthrough/);
    const javap = read('forage-food-3.3.4/forage-food.javap.txt');
    assert.match(javap, /Rule\.fallthrough:Z/);
    assert.match(javap, /WeightedPicker\.add/);
});

test('grass-tinder: tinder has no crafting recipe; 3 tinder make 3 twine, and twine and a stick make the handle', () => {
    const ex = read('rotn-3.3.4/tinder-twine.excerpt.zs');
    assert.match(ex, /^41: recipes\.remove\(<pyrotech:tinder>\);$/m);
    assert.match(ex, /^130: recipes\.addShaped\("dry_to_twine", twine\*3,$/m);
    assert.match(ex, /^175: recipes\.addShapeless\("string_twine_handle",<spartanweaponry:material:0>,\[<ore:stickWood>,<minecraft:string>\|<pyrotech:material:14>\]\);$/m);
    assert.match(ex, /^219: CrudeDryingRack\.addRecipe\("dried_fiber_fresh", <pyrotech:tinder>, <pyrotech:material:12>, 5 \* 60 \* 20, true\);$/m);
    for (const sha of rule.evidence.join(' ').match(/[0-9a-f]{64}/g).filter((s) => !['62cd3a64', '21837ce8'].includes(s.slice(0, 8)))) {
        assert.ok(ex.includes(sha), `the excerpt names ${sha.slice(0, 12)}`);
    }
    // The dump agrees: no recipe makes tinder; the twine and handle recipes are there.
    assert.deepEqual(pack.planRecipes('pyrotech:tinder'), []);
    assert.ok(!Object.values(pack.dump.recipes.recipes).some((r) => r.result?.name === 'pyrotech:tinder'));
    const twine = pack.planRecipes('pyrotech:material', { meta: 14 }).find((w) => w.recipeId === 'crafttweaker:dry_to_twine');
    assert.deepEqual([twine.gives.count, twine.inputs.map((i) => [i.count, i.label])], [3, [[3, 'pyrotech:tinder']]]);
    const handle = pack.planRecipes('spartanweaponry:material', { meta: 0 })[0];
    assert.equal(handle.recipeId, 'crafttweaker:string_twine_handle');
    assert.deepEqual(handle.inputs[1].keys, ['pyrotech:material:14', 'string']);
    const sword = pack.planRecipes('stone_sword')[0];
    assert.ok(sword.inputs.some((i) => i.keys.includes('spartanweaponry:material:0')), 'the stone sword takes the handle');
});
