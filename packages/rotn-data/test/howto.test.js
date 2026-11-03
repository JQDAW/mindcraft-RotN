// howToGet, rockRecipes and world-sources.json (Phase 3 PR 2), on the committed RotN 3.3.4 data.
// Offline: the catalog reads packages/rotn-data/3.3.4 only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';
import { stonePairs, formatHowToGet } from '../src/howto.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pack = loadRotnData('3.3.4');
const sources = JSON.parse(fs.readFileSync(path.join(HERE, '../3.3.4/world-sources.json'), 'utf8'));
const way = (r, id) => r.ways.find((w) => w.id === id);

test('world-sources.json: well formed, cited, and every name and meta exists on the server and in the dump', () => {
    assert.equal(sources.format, 'rotn-world-sources/1');
    const ids = new Set();
    const blockMetas = (n) => (pack.dump.blocks.blocks[n]?.states ?? []).map((s) => s.meta);
    const itemMetas = (n) => (pack.dump.items.items[n]?.variants ?? []).map((v) => v.meta);
    const checkBlock = (b, id) => {
        assert.ok(pack.names.blocks.has(b.name), `${id}: block ${b.name} is not synced`);
        if (b.meta != null) assert.ok(blockMetas(b.name).includes(b.meta), `${id}: ${b.name} has no meta ${b.meta}`);
    };
    const checkItem = (i, id) => {
        assert.ok(pack.names.items.has(i.name), `${id}: item ${i.name} is not synced`);
        if (Number.isInteger(i.meta)) assert.ok(itemMetas(i.name).includes(i.meta), `${id}: ${i.name} has no meta ${i.meta}`);
    };
    for (const s of sources.sources) {
        assert.ok(s.id && !ids.has(s.id), `unique id ${s.id}`);
        ids.add(s.id);
        assert.ok(['break', 'use-tool-on-block', 'start-kit'].includes(s.action), `${s.id}: action`);
        assert.ok(s.summary && s.evidence?.length > 0, `${s.id}: summary and evidence`);
        assert.ok(['documented', 'inferred'].includes(s.confidence), `${s.id}: confidence`);
        assert.ok(Array.isArray(s.unverified), `${s.id}: unverified list`);
        for (const b of s.blocks ?? []) { checkBlock(b, s.id); if (b.item) checkItem({ name: b.item }, s.id); }
        if (s.gives) checkItem(s.gives, s.id);
        for (const p of s.pairs ?? []) { checkBlock(p.block, s.id); checkItem(p.item, s.id); }
        for (const f of s.stoneFamilies ?? []) {
            checkBlock({ name: f.block }, s.id);
            for (const r of f.rocks) checkItem({ name: r }, s.id);
        }
        if (s.tool?.item) checkItem({ name: s.tool.item }, s.id);
    }
    assert.deepEqual(pack.worldSources.map((s) => s.id), [...ids]);
});

test('stone -> rocks pairs come from the dumped names (documented only for stone meta 0)', () => {
    const pairs = stonePairs(pack, sources.sources.find((s) => s.id === 'mine-stone-for-rocks'));
    const find = (b, m) => pairs.find((p) => p.block.name === b && p.block.meta === m);
    assert.deepEqual(find('minecraft:stone', 0), { block: { name: 'minecraft:stone', meta: 0 }, item: { name: 'pyrotech:rock', meta: 0 }, documented: true });
    assert.deepEqual(find('minecraft:stone', 1).item, { name: 'pyrotech:rock', meta: 1 }); // granite
    assert.deepEqual(find('minecraft:stone', 3).item, { name: 'pyrotech:rock', meta: 2 }); // diorite
    assert.deepEqual(find('minecraft:stone', 5).item, { name: 'pyrotech:rock', meta: 3 }); // andesite
    assert.equal(find('minecraft:stone', 2), undefined, 'smooth granite has no rock');
    for (let m = 0; m < 8; m++) {
        assert.deepEqual(find('undergroundbiomes:igneous_stone', m).item, { name: 'pyrotech_compat:rock_igneous', meta: m });
        assert.deepEqual(find('undergroundbiomes:metamorphic_stone', m).item, { name: 'pyrotech_compat:rock_metamorphic', meta: m });
    }
    // Sedimentary metas are offset: limestone is a pyrotech rock, chalk is rock_sedimentary 0.
    assert.deepEqual(find('undergroundbiomes:sedimentary_stone', 0).item, { name: 'pyrotech:rock', meta: 8 });
    assert.deepEqual(find('undergroundbiomes:sedimentary_stone', 1).item, { name: 'pyrotech_compat:rock_sedimentary', meta: 0 });
    assert.equal(find('undergroundbiomes:sedimentary_stone', 4), undefined, 'lignite has no sedimentary rock');
    assert.equal(pairs.filter((p) => p.documented).length, 1);
});

test('rocks: rock piles and mined stone first, with tool, count and confidence', () => {
    const r = pack.howToGet('pyrotech:rock:0');
    assert.deepEqual(r.item, { name: 'pyrotech:rock', meta: 0 });
    assert.deepEqual(r.ways.slice(0, 2).map((w) => w.id), ['rock-pile', 'mine-stone-for-rocks']);
    assert.deepEqual(way(r, 'rock-pile').blocks, [{ name: 'pyrotech:rock', meta: 0, inOre: true }]);
    assert.equal(way(r, 'rock-pile').tool, null);
    const mine = way(r, 'mine-stone-for-rocks');
    assert.deepEqual(mine.blocks, [{ name: 'minecraft:stone', meta: 0, inOre: true }]);
    assert.deepEqual(mine.tool, { type: 'pickaxe', maxLevel: 0 });
    assert.equal(mine.count, 4);
    assert.equal(mine.confidence, 'documented');
    assert.ok(mine.evidence.length > 0 && mine.unverified.length > 0);
    assert.ok(r.ways.some((w) => w.kind === 'craft' && w.inputs[0].choices[0].name === 'minecraft:cobblestone'), 'cobblestone -> 4 rocks');

    const ub = pack.howToGet('pyrotech_compat:rock_igneous:3');
    assert.deepEqual(way(ub, 'mine-stone-for-rocks').blocks, [{ name: 'undergroundbiomes:igneous_stone', meta: 3, inOre: true }]);
    assert.equal(way(ub, 'mine-stone-for-rocks').confidence, 'inferred');
    // A meta the pile block does not have is no way.
    assert.equal(way(pack.howToGet('pyrotech:rock', { meta: 15 }), 'rock-pile'), undefined);
});

test('the G3 chain: crude axe, Crafting Tools, crafting table, stone tools, first plank', () => {
    const axe = pack.howToGet('pyrotech:crude_axe').ways[0];
    assert.equal(axe.kind, 'craft');
    assert.equal(axe.requiresTable, false);
    assert.deepEqual(axe.inputs.map((i) => [i.ore ?? null, i.choices[0], i.count]), [['rock', { name: 'pyrotech:rock', meta: 0 }, 1], ['ladderMat', { name: 'minecraft:stick', meta: 0 }, 2]]);

    const pick = pack.howToGet('stone_pickaxe').ways[0];
    assert.equal(pick.requiresTable, true);
    assert.deepEqual(pick.inputs.map((i) => [i.choices[0].name, i.count]), [['pyrotech:rock', 3], ['minecraft:stick', 2]]);
    assert.deepEqual(pack.howToGet('stone_axe').ways[0].inputs.map((i) => [i.choices[0].name, i.count]), [['pyrotech:rock', 3], ['minecraft:stick', 2]]);

    const tools = pack.howToGet('contenttweaker:crafting_tools').ways[0];
    assert.deepEqual(tools.inputs.map((i) => i.choices[0].name), ['pyrotech:crude_axe', 'pyrotech:rock', 'minecraft:stick']);
    const table = pack.howToGet('crafting_table').ways[0];
    assert.deepEqual(table.inputs.map((i) => [i.ore ?? null, i.count]), [['plankWood', 1], [null, 1]]);
    assert.equal(table.inputs[1].choices[0].name, 'contenttweaker:crafting_tools');
    assert.equal(table.requiresTable, false);

    // The first plank comes from debarking, before any recipe (which needs a table).
    const oak = pack.howToGet('oak_planks');
    assert.equal(oak.ways[0].id, 'plank-from-debarked-log');
    assert.deepEqual(oak.ways[0].blocks, [{ name: 'hitwithaxe:debarked_oak' }]);
    assert.ok(oak.ways.filter((w) => w.kind === 'craft').every((w) => w.requiresTable || w.inputs.every((i) => !i.choices.some((c) => c.name === 'minecraft:log'))), 'log -> planks needs a table');
    assert.deepEqual(pack.howToGet('spruce_planks').ways[0].blocks, [{ name: 'hitwithaxe:debarked_spruce' }]);
    assert.deepEqual(way(pack.howToGet('hitwithaxe:debarked_oak'), 'debark-log').blocks, [{ name: 'minecraft:log', meta: 0 }]);
    assert.deepEqual(way(pack.howToGet('spruce_log'), 'fell-tree').blocks, [{ name: 'dynamictrees:sprucebranch' }]);
    assert.deepEqual(pack.howToGet('stick').ways[0].id, 'sticks-from-leaves');
});

test('#107 review: confidence is never stronger than the source', () => {
    // Per pair: the research names the oak debarked log and the oak plank only.
    assert.equal(pack.howToGet('oak_planks').ways[0].confidence, 'documented');
    assert.equal(pack.howToGet('spruce_planks').ways[0].confidence, 'inferred');
    assert.equal(way(pack.howToGet('hitwithaxe:debarked_oak'), 'debark-log').confidence, 'documented');
    assert.equal(way(pack.howToGet('hitwithaxe:debarked_spruce'), 'debark-log').confidence, 'inferred');
    // Which log a tree drops is UNVERIFIED in the research, so every fell-tree pair is inferred.
    assert.equal(way(pack.howToGet('oak_log'), 'fell-tree').confidence, 'inferred');
    assert.equal(way(pack.howToGet('spruce_log'), 'fell-tree').confidence, 'inferred');
    // Raw iron from the ore is UNVERIFIED in the research.
    assert.equal(way(pack.howToGet('contenttweaker:raw_iron'), 'raw-iron').confidence, 'inferred');
    // Flint tools are level 1 (Sturdy): the rocks rule does not offer them.
    const rule = sources.sources.find((s) => s.id === 'mine-stone-for-rocks');
    assert.doesNotMatch(rule.summary, /flint/);
    assert.match(rule.note, /pyrotech:flint_pickaxe\) is level 1/);
    assert.equal(pack.getItem('pyrotech:flint_pickaxe').toolClasses.pickaxe, 1);
    for (const s of sources.sources) for (const p of s.pairs ?? []) assert.ok(p.documented === undefined || p.documented === true, `${s.id}: documented is true or absent`);
});

test('#107 nit: a bare rock name means its rock variants (the rock ore dictionary metas)', () => {
    const r = pack.howToGet('pyrotech:rock');
    const metas = pack.oreDict('rock').filter((s) => s.name === 'pyrotech:rock').map((s) => s.meta).sort((a, b) => a - b);
    assert.deepEqual(r.item, { name: 'pyrotech:rock', meta: null, metas });
    assert.ok(!metas.includes(4) && !metas.includes(5) && !metas.includes(7), 'no dirt clump, sand pile or wood chips');
    assert.deepEqual(way(r, 'rock-pile').blocks, metas.map((m) => ({ name: 'pyrotech:rock', meta: m, inOre: true })));
    for (const w of r.ways.filter((x) => x.kind === 'craft')) assert.ok(metas.includes(w.gives.meta), `craft gives meta ${w.gives.meta}`);
    for (const b of way(r, 'mine-stone-for-rocks').blocks) assert.ok(b.name === 'minecraft:stone' || b.name === 'undergroundbiomes:sedimentary_stone');
    // An explicit meta still works, rock or not (and says it is not a rock).
    assert.deepEqual(way(pack.howToGet('pyrotech:rock:4'), 'rock-pile').blocks, [{ name: 'pyrotech:rock', meta: 4, inOre: false }]);
});

// The Underground Biomes rock piles: the main rock source at the G3 spawn (S1-A).
test('Underground Biomes rock piles: the dump backs every claim, and howToGet offers them', () => {
    const rockOre = pack.oreDict('rock');
    for (const n of ['pyrotech_compat:rock_igneous', 'pyrotech_compat:rock_metamorphic', 'pyrotech_compat:rock_sedimentary']) {
        const states = pack.dump.blocks.blocks[n].states;
        const variants = pack.dump.items.items[n].variants;
        assert.ok(states.length >= 6, n);
        for (const s of states) {
            assert.deepEqual(s.collision, [], `${n}:${s.meta} has no collision box`);
            assert.equal(s.hardness, 0.1);
            assert.equal(s.harvestTool ?? null, null);
            assert.deepEqual(s.drops, [{ name: n, meta: s.meta, count: 1 }], `${n}:${s.meta} drops itself, same meta`);
            const label = variants.find((v) => v.meta === s.meta).displayName.toLowerCase().replace(/\s+/g, '_');
            assert.equal(`${s.props.variant}`, `rock_${label.replace(/_rock$/, '')}`, `${n}:${s.meta} state name = item name`);
        }
        assert.ok(rockOre.some((x) => x.name === n), `${n} is in the rock ore dictionary`);
    }
    // The metas S1-A saw near the G3 spawn.
    for (const [n, m] of [['pyrotech_compat:rock_metamorphic', 0], ['pyrotech_compat:rock_metamorphic', 6], ['pyrotech_compat:rock_igneous', 0],
        ['pyrotech_compat:rock_igneous', 7], ['pyrotech_compat:rock_sedimentary', 0], ['pyrotech_compat:rock_sedimentary', 2]]) {
        const r = pack.howToGet(n, { meta: m });
        const pile = way(r, 'rock-pile');
        assert.deepEqual(pile.blocks, [{ name: n, meta: m, inOre: true }], `${n}:${m}`);
        assert.equal(pile.confidence, 'inferred', 'the research does not name them');
        assert.equal(pile.tool, null);
        assert.equal(r.ways[0].id, 'rock-pile', 'the pile comes first');
        assert.ok(!r.ways.some((w) => w.kind === 'block-drop' && w.blocks.some((b) => b.name === n)), 'not also a plain drop');
    }
    // pyrotech:rock stays documented and only names its own block.
    const stone = way(pack.howToGet('pyrotech:rock:0'), 'rock-pile');
    assert.deepEqual([stone.blocks, stone.confidence], [[{ name: 'pyrotech:rock', meta: 0, inOre: true }], 'documented']);
    // A bare name: any meta of that pile.
    assert.deepEqual(way(pack.howToGet('pyrotech_compat:rock_igneous'), 'rock-pile').blocks, [{ name: 'pyrotech_compat:rock_igneous' }]);
    // The Grass Clump is not a rock pile in this rule.
    assert.equal(way(pack.howToGet('pyrotech:rock_grass'), 'rock-pile'), undefined);
});

// Lead (#142): which rock-pile metas count as rock (the 'rock' ore dictionary), for skills-rotn B2.
test('rock piles and stone: the ways say which block metas give a rock in the rock ore dictionary', () => {
    const pile = way(pack.howToGet('pyrotech:rock'), 'rock-pile');
    assert.equal(pile.ore.name, 'rock');
    assert.deepEqual(pile.ore.members, pack.oreDict('rock').map((s) => ({ name: s.name, meta: s.meta === 32767 ? null : s.meta })));
    assert.deepEqual(pile.ore.blocks, [
        { name: 'pyrotech:rock', metas: [0, 6, 8] },
        { name: 'pyrotech_compat:rock_igneous', metas: [0, 1, 2, 3, 4, 5, 6, 7] },
        { name: 'pyrotech_compat:rock_metamorphic', metas: [0, 1, 2, 3, 4, 5, 6, 7] },
        { name: 'pyrotech_compat:rock_sedimentary', metas: [0, 1, 2, 3, 4, 5] },
    ]);
    // Cross-check against the dump: each listed block meta drops an item in the ore dictionary,
    // and the crude axe's rock slot accepts exactly those items.
    const ore = pack.oreDict('rock');
    const inOre = (d) => ore.some((m) => m.name === d.name && (m.meta === 32767 || m.meta === d.meta));
    const axeRock = pack.recipesFor('pyrotech:crude_axe')[0].inShape.flat().find((c) => c?.ores?.includes('rock')).stacks;
    for (const { name, metas } of pile.ore.blocks) {
        for (const s of pack.dump.blocks.blocks[name].states) {
            assert.equal(inOre(s.drops[0]), metas.includes(s.meta), `${name}:${s.meta}`);
            const accepted = axeRock.some((x) => x.name === s.drops[0].name && (x.meta === 32767 || x.meta === s.drops[0].meta));
            assert.equal(accepted, metas.includes(s.meta), `crude axe accepts ${name}:${s.meta}`);
        }
    }
    // Per listed block: inOre. Clumps and piles that are not rocks are false, rocks true.
    for (const m of [4, 5, 7, 9]) assert.deepEqual(way(pack.howToGet('pyrotech:rock', { meta: m }), 'rock-pile').blocks, [{ name: 'pyrotech:rock', meta: m, inOre: false }], `pyrotech:rock:${m}`);
    for (const m of [0, 6, 8]) assert.equal(way(pack.howToGet('pyrotech:rock', { meta: m }), 'rock-pile').blocks[0].inOre, true);
    assert.equal(way(pack.howToGet('pyrotech_compat:rock_metamorphic', { meta: 6 }), 'rock-pile').blocks[0].inOre, true);
    // Stone: only plain stone (meta 0) gives a rock in the ore; granite gives pyrotech:rock 1, which is not.
    const mine = way(pack.howToGet('pyrotech:rock', { meta: 1 }), 'mine-stone-for-rocks');
    assert.deepEqual(mine.blocks, [{ name: 'minecraft:stone', meta: 1, inOre: false }]);
    assert.deepEqual(mine.ore.blocks.find((b) => b.name === 'minecraft:stone').metas, [0]);
    assert.deepEqual(mine.ore.blocks.find((b) => b.name === 'undergroundbiomes:igneous_stone').metas, [0, 1, 2, 3, 4, 5, 6, 7]);
    // A way from a rule without 'ore' has no ore field.
    assert.equal(way(pack.howToGet('stick'), 'sticks-from-leaves').ore, undefined);
});

test('recipes that differ only in their id are listed once', () => {
    const crafts = pack.howToGet('oak_planks').ways.filter((w) => w.kind === 'craft');
    const keys = crafts.map((w) => JSON.stringify([w.requiresTable, w.gives, w.inputs]));
    assert.equal(new Set(keys).size, keys.length);
});

test('smelting and plain drops; plain drops skip blocks a world rule covers', () => {
    const iron = pack.howToGet('iron_ingot');
    assert.ok(iron.ways.some((w) => w.kind === 'smelt' && w.input.name === 'contenttweaker:raw_iron' && w.station === 'furnace'));
    assert.equal(way(pack.howToGet('contenttweaker:raw_iron'), 'raw-iron').blocks[0].name, 'minecraft:iron_ore');
    const flint = pack.howToGet('flint').ways.find((w) => w.kind === 'block-drop');
    assert.equal(flint.confidence, 'dump-sample');
    assert.equal(flint.blocks[0].name, 'minecraft:gravel');
    const stick = pack.howToGet('stick');
    const covered = new Set(way(stick, 'sticks-from-leaves').blocks.map((b) => b.name));
    for (const w of stick.ways.filter((x) => x.kind === 'block-drop')) for (const b of w.blocks) assert.ok(!covered.has(b.name));
    assert.equal(pack.howToGet('bread').ways[0].id, 'start-kit');
});

test('unknown items give null', () => {
    assert.equal(pack.howToGet('nosuchmod:thing'), null);
    assert.equal(pack.howToGet(''), null);
});

test('rockRecipes: every "4 identical rocks -> block" recipe (the G3 cobblestone check accepts any)', () => {
    const rr = pack.rockRecipes();
    assert.equal(rr.length, 35);
    const rockOre = new Set(pack.oreDict('rock').map((s) => s.name));
    for (const x of rr) assert.ok(rockOre.has(x.rock.name));
    const out = (n, m) => rr.find((x) => x.rock.name === n && x.rock.meta === m)?.gives;
    assert.deepEqual(out('pyrotech:rock', 0), { name: 'minecraft:cobblestone', meta: 0, count: 1 });
    assert.deepEqual(out('pyrotech:rock', 8), { name: 'contenttweaker:limestone_cobble', meta: 0, count: 1 });
    assert.deepEqual(out('pyrotech:rock', 6), { name: 'minecraft:sandstone', meta: 0, count: 1 });
    assert.deepEqual(out('pyrotech_compat:rock_igneous', 0), { name: 'undergroundbiomes:igneous_cobble', meta: 0, count: 1 });
    assert.equal(out('pyrotech:rock', 4), undefined, 'a dirt clump is not a rock');
});

test('formatHowToGet: a short plain-text answer', () => {
    const t = formatHowToGet(pack.howToGet('pyrotech:rock:0'), { maxWays: 2 });
    assert.match(t, /^pyrotech:rock:0:\n- Break a rock pile .* By hand\.\n- Mine stone .*With a pickaxe of mining level 0 or lower\./);
    assert.match(t, /\(\d+ more\)$/);
    assert.match(formatHowToGet(pack.howToGet('stone_pickaxe')), /Craft 3 any rock \(e\.g\. pyrotech:rock:0\) \+ 2 any ladderMat \(e\.g\. minecraft:stick:0\) -> 1 minecraft:stone_pickaxe:0 \(crafting table\)/);
    assert.equal(formatHowToGet(null), 'Unknown item.');
});
