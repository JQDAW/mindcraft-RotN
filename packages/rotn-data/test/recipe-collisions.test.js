// Recipe collisions (soak 16, net-forge's recipe report item B): recipe-collisions.json and installRecipes' `shadowed`
// option against the dump. A grid two recipes match gives the one the server registered first, which the dump does not
// record; rotn-data drops the recipe that never wins (planks from 9 sticks: the stick wall wins) and puts the variants
// another recipe also accepts last, so the first variant of a result is one only its own recipe matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRotnData } from '../src/catalog.js';
import { installRecipes, acceptsItems, convertRecipe } from '../src/registry-recipes.js';
import { installRecipes as installFromIndex } from '../index.js';
import { buildRecipeCollisions, scanCollisions, collisionListText } from '../tools/build-recipe-collisions.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pack = loadRotnData('3.3.4');
const data = pack.recipeCollisionsData;
const R = pack.dump.recipes.recipes;
const byId = new Map(R.map((r) => [r.id, r]));
const bot = (n) => (n.startsWith('minecraft:') ? n.slice('minecraft:'.length) : n);

/** A registry with an item id for every name the dump's recipes use (minecraft-data style names). */
function dumpRegistry() {
    const names = new Set();
    for (const r of R) {
        if (r.result) names.add(r.result.name);
        for (const c of (r.slots ?? r.ingredients ?? [])) for (const s of c?.stacks ?? []) names.add(s.name);
    }
    const itemsByName = {};
    const nameOf = {};
    let i = 1;
    for (const n of names) {
        itemsByName[bot(n)] = { id: i, name: bot(n) };
        nameOf[i++] = n;
    }
    return { itemsByName, nameOf, recipes: {} };
}
const itemsOf = (reg, v) => (v.inShape ? v.inShape.flat() : v.ingredients).filter(Boolean).map((x) => `${reg.nameOf[x.id]}:${x.metadata}`);

test('the data: every listed recipe is in the dump; the dropped one is planks from 9 sticks, which the stick wall shares', () => {
    assert.equal(Object.keys(data.collisions).length, 207);
    assert.equal(data.firstRankedCount, 83);
    for (const [a, others] of Object.entries(data.collisions)) {
        assert.ok(byId.has(a), a);
        assert.ok(others.length > 0, a);
        for (const b of others) {
            assert.ok(byId.has(b), `${a} -> ${b}`);
            assert.notDeepEqual(byId.get(b).result, byId.get(a).result, `${a} and ${b} give different results`);
        }
    }
    assert.deepEqual(Object.keys(data.drop), ['dungeontactics:misc/convenience/planks_from_sticks']);
    const planks = byId.get('dungeontactics:misc/convenience/planks_from_sticks');
    const wall = byId.get('ancientbeasts:stick_wall');
    assert.deepEqual(planks.result, { name: 'minecraft:planks', meta: 0, count: 1 });
    for (const r of [planks, wall]) {
        assert.equal(r.slots.length, 9);
        for (const c of r.slots) assert.ok(c.stacks.some((s) => s.name === 'minecraft:stick'), r.id);
    }
    // The cases the soak 16 report names.
    for (const [a, b] of [['crafttweaker:gravel_to_flint', 'undergroundbiomes:vanilla_gravel'], ['minecraft:iron_block', 'crafttweaker:wrought_block'],
        ['minecraft:iron_nugget', 'crafttweaker:wrought_to_nugget'], ['crafttweaker:stick', 'aether_legacy:skyroot_stick'],
        ['crafttweaker:crafting_table', 'crafttweaker:skyroot_crafting_table'], ['crafttweaker:bowl', 'aether_legacy:skyroot_bucket']]) {
        assert.ok(data.collisions[a].includes(b), `${a} -> ${b}`);
    }
});

test('acceptsItems: a one-to-one multiset match, wildcard metadata, a count mismatch fails', () => {
    const m = [new Map([[1, null]]), new Map([[2, new Set([0, 3])]])];
    assert.equal(acceptsItems(m, [{ id: 2, metadata: 3 }, { id: 1, metadata: 7 }]), true);
    assert.equal(acceptsItems(m, [{ id: 2, metadata: 1 }, { id: 1, metadata: 0 }]), false);
    assert.equal(acceptsItems(m, [{ id: 1, metadata: 0 }]), false);
    assert.equal(acceptsItems(m, [{ id: 1, metadata: 0 }, { id: 1, metadata: 0 }]), false, 'each ingredient takes its own item');
    assert.equal(acceptsItems(null, []), false);
});

test('installRecipes drops planks from 9 sticks; the index installs with the pack\'s collisions by default', () => {
    const reg = dumpRegistry();
    const report = installFromIndex(reg, {});
    assert.equal(report.dropped, 1);
    const planks = reg.recipes[reg.itemsByName.planks.id];
    assert.ok(planks.length > 0);
    for (const v of planks) assert.ok(!itemsOf(reg, v).every((s) => s.startsWith('minecraft:stick:')), 'no planks from sticks');
    // #639 review 2: an explicit `shadowed: undefined` keeps the pack's collisions too.
    const undef = dumpRegistry();
    assert.equal(installFromIndex(undef, { shadowed: undefined }).dropped, 1);
    // `shadowed: null` keeps the dump as is (the recipe is still there, last resort for a caller that wants it).
    const raw = dumpRegistry();
    installFromIndex(raw, { shadowed: null });
    assert.ok(raw.recipes[raw.itemsByName.planks.id].some((v) => itemsOf(raw, v).every((s) => s.startsWith('minecraft:stick:'))));
});

test('for every listed recipe, its variants a recipe it may share a grid with also accepts are the tail of that result', () => {
    const reg = dumpRegistry();
    installRecipes(reg, R, { shadowed: data });
    const matchers = new Map();
    const matcherOf = (rid) => {
        if (!matchers.has(rid)) {
            const r = byId.get(rid);
            matchers.set(rid, (r.slots ?? r.ingredients ?? []).filter(Boolean).map((c) => {
                const m = new Map();
                for (const st of c.stacks) {
                    const id = reg.itemsByName[bot(st.name)].id;
                    if (st.meta === 32767) m.set(id, null);
                    else if (m.get(id) !== null) m.set(id, (m.get(id) ?? new Set()).add(st.meta));
                }
                return m;
            }));
        }
        return matchers.get(rid);
    };
    const flat = (v) => (v.inShape ? v.inShape.flat() : v.ingredients).filter(Boolean);
    // Expected tail per result id: the variants of each listed recipe that one of its listed recipes accepts.
    const tails = new Map();
    for (const [a, others] of Object.entries(data.collisions)) {
        if (a in data.drop) continue; // dropped before ordering
        const r = byId.get(a);
        const id = reg.itemsByName[bot(r.result.name)].id;
        const { variants } = convertRecipe(reg, r);
        const risky = variants.filter((v) => others.some((o) => acceptsItems(matcherOf(o), flat(v))));
        tails.set(id, [...(tails.get(id) ?? []), ...risky.map((v) => JSON.stringify(v))]);
    }
    let withTail = 0;
    for (const [id, tail] of tails) {
        const list = (reg.recipes[id] ?? []).map((v) => JSON.stringify(v));
        const got = list.slice(list.length - tail.length);
        assert.deepEqual([...got].sort(), [...tail].sort(), `${reg.nameOf[id]}: the last ${tail.length} variants are the shadowable ones`);
        if (tail.length && tail.length < list.length) withTail++;
    }
    assert.ok(withTail >= 20, `results with both kinds: ${withTail}`);
});

test('the named cases: the first variant is the safe one; the shadowable one is last', () => {
    const reg = dumpRegistry();
    installRecipes(reg, R, { shadowed: data });
    const first = (n) => itemsOf(reg, reg.recipes[reg.itemsByName[n].id][0]);
    const last = (n) => { const l = reg.recipes[reg.itemsByName[n].id]; return itemsOf(reg, l[l.length - 1]); };
    assert.deepEqual(first('flint'), ['minecraft:gravel:0', 'minecraft:gravel:0']);
    assert.match(last('flint')[0], /^undergroundbiomes:\w+_gravel:/);
    assert.ok(first('iron_block').every((s) => s === 'minecraft:iron_ingot:0'));
    assert.ok(last('iron_block').every((s) => s === 'contenttweaker:material_part:49'), 'wrought iron last');
    assert.deepEqual(first('iron_nugget'), ['minecraft:iron_ingot:0']);
    assert.deepEqual(last('iron_nugget'), ['contenttweaker:material_part:49']);
    assert.ok(!first('stick').includes('aether_legacy:skyroot_plank:0'));
    assert.ok(!first('crafting_table').includes('aether_legacy:skyroot_plank:0'));
    assert.ok(!first('bowl').includes('aether_legacy:skyroot_plank:0'));
    for (const n of ['stick', 'crafting_table', 'bowl']) {
        const l = reg.recipes[reg.itemsByName[n].id];
        const i = l.findIndex((v) => itemsOf(reg, v).includes('aether_legacy:skyroot_plank:0'));
        assert.ok(i > 0, n);
    }
    // A result whose first variant changes (develop put the shadowable variant first): the chain link's iron
    // nuggets also make minetraps nails, so a grid of another nugget the chain link accepts comes first.
    const chain = first('iceandfire:chain_link');
    assert.ok(!chain.includes('minecraft:iron_nugget:0'), chain.join(' '));
});

test('#639 review 1: the committed file is exactly tools/build-recipe-collisions.mjs\'s output from the dump', () => {
    // #643 nit 1: each mode is scanned once, for both the file and the list text.
    const scans = { any: scanCollisions(R, true), first: scanCollisions(R, false) };
    const built = buildRecipeCollisions(R, scans);
    const file = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../3.3.4/recipe-collisions.json'), 'utf8'));
    assert.deepEqual(built, file);
    assert.match(file.description, / 170 recipes were not scanned /);
    // The tool's first-ranked list is the one net-forge's scan printed (83 recipes), whose header the report quotes.
    const first = collisionListText(scans.first);
    assert.match(first.split('\n')[0], /^recipe types \{"shaped":4036,"shapeless":2053\} scanned 5919 colliding 83$/);
    assert.match(first, /^ancientbeasts:stick_wall -> 1 ancientbeasts:stick_wall:0x1 {2}\[3x3\] grid (minecraft:stick:0 ?){9}\n {4}also: dungeontactics:misc\/convenience\/planks_from_sticks -> 1 minecraft:planks:0x1$/m);
});
