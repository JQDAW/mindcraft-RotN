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
import { formatHowToGet, leadClause } from '../src/howto.js';

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

test('worldHint: the planner\'s short hint is each break rule\'s lead clause and its odds; null without a rule', () => {
    assert.equal(pack.worldHint('pyrotech:tinder'), 'break grass or ferns by hand or with any tool except shears (about 1 in 13 drops one)');
    // Two rules: the first two break ways, the parentheses left out; a countRange mean of 0.5 is 1 in 2.
    assert.equal(pack.worldHint('stick'), 'break a Dynamic Trees branch, by hand or with an axe; or break leaves by hand (about 1 in 2 drops one)');
    assert.equal(pack.worldHint('pyrotech:rock:0'), 'break a rock pile on the ground by hand; or mine stone with a pickaxe below Sturdy');
    assert.equal(pack.worldHint('coal'), 'mine coal ore with a pickaxe of level 0 or better');
    // Only break rules: bread's start kit, feathers (no rule) and an unknown item give none.
    for (const item of ['bread', 'feather', 'nosuch:item']) assert.equal(pack.worldHint(item), null, item);
});

// #674 review nit 2: the "any tool except shears" claim, from the Forge-patched bytecode.
test('grass-tinder: shears skip the harvest, so Dropt never sees a sheared grass or fern (Forge-patched bytecode)', () => {
    const javap = read('grass-shears-3.3.4/grass-shears.javap.txt');
    const section = (title) => { const i = javap.indexOf(`## ${title}`); assert.ok(i >= 0, title); const j = javap.indexOf('\n## ', i + 1); return javap.slice(i, j < 0 ? undefined : j); };
    assert.match(javap, /forge-1\.12\.2-14\.23\.5\.2860\.jar cd3fbf85d7ca744507fd6a37a41b90122d43e616a4f8962332b1b658655e8a64/);
    assert.match(javap, /^MD: or\/b \(Let;\)Z net\/minecraft\/server\/management\/PlayerInteractionManager\/func_180237_b /m);
    // tryHarvestBlock: the held item's onBlockStartBreak true -> return false, before any harvest.
    assert.match(section('or '), /ain\.onBlockStartBreak:\(Laip;Let;Laed;\)Z\n\s+122: ifeq +127\n\s+125: iconst_0\n\s+126: ireturn/);
    // ItemShears: an IShearable whose isShearable is true is sheared (onSheared), set to air (Blocks.AIR, flags 11), true.
    const shears = section('ajl ');
    assert.match(shears, /instanceof +#\d+ +\/\/ class net\/minecraftforge\/common\/IShearable/);
    assert.match(shears, /IShearable\.isShearable:\(Laip;Lamy;Let;\)Z\n\s+65: ifeq +288/);
    assert.match(shears, /IShearable\.onSheared:/);
    assert.match(shears, /Field aox\.a:Laow;\n[^\n]*aow\.t:\(\)Lawt;\n[^\n]*bipush +11\n[^\n]*amu\.a:\(Let;Lawt;I\)Z\n[^\n]*pop\n[^\n]*286: iconst_1\n[^\n]*287: ireturn/);
    // Tall grass is always shearable; a double plant on its lower half (aqb$a.b = LOWER) when GRASS (c) or FERN (d).
    assert.match(section('aun '), /implements aoz,net\.minecraftforge\.common\.IShearable[^]*isShearable\(aip, amy, et\);\n\s+Code:\n\s+0: iconst_1\n\s+1: ireturn/);
    const dp = section('aqb (');
    assert.match(dp, /Field c:Laxh;[^]*Field aqb\$a\.b:Laqb\$a;\n\s+37: if_acmpne[^]*Field aqb\$b\.d:Laqb\$b;\n\s+45: if_acmpeq[^]*Field aqb\$b\.c:Laqb\$b;/);
    assert.match(section('aqb$a '), /String UPPER\n[^\n]*Field a:Laqb\$a;\n[^\n]*String LOWER\n[^\n]*Field b:Laqb\$a;/);
    assert.match(section('aqb$b '), /String GRASS\n[^\n]*Field c:Laqb\$b;\n[^\n]*String FERN\n[^\n]*Field d:Laqb\$b;/);
    assert.match(section('aqb static'), /String variant\n[^\n]*Field a:Laxh;\n[^\n]*String half\n[^\n]*Field c:Laxh;/);
    // Neither Dropt list has a held-item matcher; the rule cites the fixture.
    const src = read('forage-food-3.3.4/dropt.zs');
    for (const list of ['tall_grass_base_drops', 'double_tall_grass_base_drops']) assert.doesNotMatch(droptList(src, list), /heldItem|HeldItem|mainHand/, list);
    for (const id of ['grass-tinder', 'grass-plant-fiber']) {
        assert.ok(pack.worldSources.find((r) => r.id === id).evidence.some((e) => e.includes('fixtures/grass-shears-3.3.4/grass-shears.javap.txt')), id);
    }
});

test('grass-plant-fiber: the same grass gives plant fiber (pyrotech:material:12) about 2 times in 13; it dries into tinder', () => {
    const fiber = pack.worldSources.find((r) => r.id === 'grass-plant-fiber');
    assert.deepEqual(fiber.blocks, rule.blocks, 'the same blocks as grass-tinder');
    const w = pack.howToGet('pyrotech:material:12').ways.find((x) => x.id === 'grass-plant-fiber');
    assert.deepEqual([w.kind, w.action, w.tool, w.confidence], ['world', 'break', null, 'documented']);
    assert.deepEqual(w.countRange, { min: 0, max: 1, mean: 0.153 });
    const src = read('forage-food-3.3.4/dropt.zs');
    for (const list of ['tall_grass_base_drops', 'double_tall_grass_base_drops']) {
        const ws = weights(droptList(src, list));
        const total = ws.reduce((a, [n]) => a + n, 0);
        const n = ws.filter(([, item]) => item === 'pyrotech:material:12').reduce((a, [x]) => a + x, 0);
        assert.ok(Math.abs(n / total - fiber.countRange.mean) < 0.001, `${list}: ${n}/${total}`);
    }
    assert.equal(pack.worldHint('pyrotech:material:12'), 'break grass or ferns by hand or with any tool except shears (about 1 in 7 drops one)');
    // The tinder rule is still the only way for tinder; the rack is 2 plant fiber + 1 timber (the dump).
    assert.deepEqual(pack.howToGet('pyrotech:tinder').ways.map((x) => x.id), ['grass-tinder']);
    const rack = pack.planRecipes('pyrotech:drying_rack', { meta: 0 }).find((x) => x.recipeId === 'crafttweaker:hanging_dryingrack');
    assert.deepEqual(rack.inputs.map((i) => [i.count, i.label]), [[2, 'pyrotech:material:12'], [1, 'earthworks:item_timber']]);
    assert.match(read('rotn-3.3.4/tinder-twine.excerpt.zs'), /^219: CrudeDryingRack\.addRecipe\("dried_fiber_fresh", <pyrotech:tinder>, <pyrotech:material:12>/m);
});

// #674 review nit 3: every break rule's hint is a clean clause, and a "." ends it only before a new sentence.
test('worldHint over every break rule: a non-empty lowercase clause with no parentheses; leadClause keeps "e.g. "', () => {
    const breaks = pack.worldSources.filter((r) => r.action === 'break');
    assert.ok(breaks.length >= 9);
    for (const r of breaks) {
        const c = leadClause(r.summary);
        assert.match(c, /^[a-z]/, `${r.id}: ${c}`);
        assert.doesNotMatch(c, /[()]|[,:;.]$/, `${r.id}: ${c}`);
        assert.ok(c.length >= 15 && c.length <= 200, `${r.id}: ${c.length}`);
        assert.ok(r.summary.toLowerCase().startsWith(c.slice(0, 10).toLowerCase()), r.id);
        if (r.gives?.name) {
            const item = Number.isInteger(r.gives.meta) ? `${r.gives.name}:${r.gives.meta}` : r.gives.name;
            const hint = pack.worldHint(item, { maxWays: 99 });
            assert.ok(hint?.includes(c), `${r.id}: ${item}: ${hint}`);
        }
    }
    assert.equal(leadClause('Break a bush, e.g. a dead bush, by hand. Shears give the bush.'), 'break a bush, e.g. a dead bush, by hand');
    assert.equal(leadClause('Mine ore (level 0; any pickaxe: see below) with a pickaxe: it drops raw ore.'), 'mine ore with a pickaxe');
    assert.equal(leadClause('Given at the first spawn.'), 'given at the first spawn');
    assert.equal(leadClause('Break approx. 3 leaves by hand; then more.'), 'break approx. 3 leaves by hand');
});
