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
    // A felled tree drops sticks, by hand too (bytecode). Dynamic Trees' own leaf drops have none, but
    // Pyrotech's leaf handler adds them (round 8 A correction): only leaves-sticks names leaves.
    const stick = pack.howToGet('stick');
    assert.deepEqual(stick.ways[0].id, 'fell-tree');
    assert.equal(stick.ways[0].tool, null);
    assert.equal(stick.ways[0].confidence, 'documented');
    assert.ok(stick.ways[0].blocks.some((b) => b.name === 'dynamictrees:oakbranch'));
    assert.deepEqual(stick.ways.filter((w) => w.kind === 'world' && w.blocks.some((b) => /leaves/.test(b.name))).map((w) => w.id), ['leaves-sticks']);
    assert.equal(way(pack.howToGet('oak_log'), 'fell-tree').tool, null);
    // #252 review: the axe stays preferred (equip it when the bot has one), not required.
    assert.deepEqual(stick.ways[0].preferredTool, { type: 'axe', minLevel: 0 });
    assert.deepEqual(way(pack.howToGet('oak_log'), 'fell-tree').preferredTool, { type: 'axe', minLevel: 0 });
    assert.equal('preferredTool' in way(pack.howToGet('pyrotech:rock', { meta: 0 }), 'rock-pile'), false);
    // #252 review: the bytecode is the evidence; the round 4 B log only supports it.
    assert.match(stick.ways[0].evidence.find((e) => /round 4 batch B/.test(e)), /^Supporting only \(the bytecode above is the evidence\)/);
});

test('round 5 A: with an axe, a placed plank gives 2 sticks, and any axe (level 0) debarks and splits logs', () => {
    // Hit With Axe 1.5.1: a right-click with any item whose tool classes contain "axe", level 0 here.
    const AXE = { type: 'axe', minLevel: 0 };
    assert.deepEqual(way(pack.howToGet('hitwithaxe:debarked_oak'), 'debark-log').tool, AXE);
    const plank = way(pack.howToGet('oak_planks'), 'plank-from-debarked-log');
    assert.deepEqual(plank.tool, AXE);
    assert.equal(plank.count, 1);
    assert.deepEqual(pack.getItem('pyrotech:crude_axe').toolClasses, { axe: 0 }, 'the crude axe qualifies');
    // wood_stripping_boards.zs line 779: minecraft:planks (any meta) -> 2 sticks; after felling, before crafting.
    const stick = pack.howToGet('stick');
    assert.deepEqual(stick.ways.slice(0, 2).map((w) => w.id), ['fell-tree', 'sticks-from-planks']);
    const chop = way(stick, 'sticks-from-planks');
    assert.equal(chop.action, 'use-tool-on-block');
    assert.deepEqual(chop.tool, AXE);
    assert.equal(chop.count, 2);
    assert.equal(chop.confidence, 'documented');
    assert.deepEqual(chop.blocks.map((b) => b.name), ['minecraft:planks', 'biomesoplenty:planks_0', 'rustic:planks', 'randomthings:spectreplank', 'hitwithaxe:debarked_dead']);
    for (const b of chop.blocks) assert.ok(pack.names.blocks.has(b.name), b.name);
    assert.match(formatHowToGet(pack.howToGet('stick')), /Place a planks block, then right-click it with an axe .* With an axe\./);
    // No vanilla log makes planks in the 2x2 grid: every wood's log -> planks recipe needs the table (#272 review: oak too).
    for (const wood of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak']) {
        const fromLog = pack.howToGet(`${wood}_planks`).ways.filter((x) => x.kind === 'craft' && x.inputs.some((i) => i.choices.some((c) => /^minecraft:log2?$/.test(c.name))));
        assert.ok(fromLog.length >= 1, wood);
        for (const w of fromLog) assert.equal(w.requiresTable, true, wood);
    }
});

test('#272 review: all 18 vanilla log -> planks recipes need the table; the table-free log recipes are modded', () => {
    const ore = (n) => new Set(pack.dump.oredict.ores[n].map((s) => (s.meta === 32767 ? `${s.name}:*` : `${s.name}:${s.meta}`)));
    const logs = ore('logWood');
    const planks = ore('plankWood');
    const has = (set, s) => set.has(`${s.name}:${s.meta}`) || set.has(`${s.name}:*`);
    const fromLogs = pack.dump.recipes.recipes.filter((r) => r.result && has(planks, r.result) && (() => {
        const ings = (r.ingredients ?? r.slots ?? []).filter(Boolean);
        return ings.length > 0 && ings.every((i) => (i.stacks ?? []).some((s) => has(logs, s)));
    })());
    const vanilla = fromLogs.filter((r) => r.result.name === 'minecraft:planks' && (r.ingredients ?? r.slots).filter(Boolean).every((i) => i.stacks.some((s) => /^minecraft:log2?$/.test(s.name))));
    assert.equal(vanilla.length, 18);
    for (const r of vanilla) assert.deepEqual([r.requiresTable, r.width, r.height, r.result.count], [true, 1, 3, 3], r.id);
    assert.deepEqual(fromLogs.filter((r) => !r.requiresTable).map((r) => r.id).sort(), [
        'biomesoplenty:mangrove_planks',
        'harvestcraft:minecraft_planks_meta_1_x4_pammaple',
        'harvestcraft:minecraft_planks_meta_3_x4_pamcinnamon',
        'harvestcraft:minecraft_planks_meta_3_x4_pampaperbark',
        'stygian:end_planks',
        'twilightforest:dark_tower/tower_wood',
        'twilightforest:wood/twilight_oak_planks',
    ]);
    assert.match(way(pack.howToGet('oak_planks'), 'plank-from-debarked-log').summary, /mangrove log/);
});

test('#272 review: the cited script lines and Hit With Axe bytecode are fixtures, and the rules match them', () => {
    // "<line>: <text>" lines from the pack's scripts/wood_stripping_boards.zs (header lines start with #).
    const zs = new Map(fs.readFileSync(path.join(HERE, 'fixtures/rotn-3.3.4/wood_stripping_boards.excerpt.zs'), 'utf8')
        .split(/\r?\n/).filter((l) => /^\d+: /.test(l)).map((l) => [Number(l.slice(0, l.indexOf(':'))), l.slice(l.indexOf(':') + 2)]));
    const chop = (n) => zs.get(n).match(/^Chopping\.addRecipe\("([^"]+)", (\d+)(?:, "([^"]+)", (\d+))?, <([^>]+)>(?: \* (\d+))?\);/);
    // Lines 11-25: the oak planks crafts are 1x3 columns of 3 planks.
    for (const n of [11, 16, 21]) assert.match(zs.get(n), /^recipes\.add(Hidden)?Shaped\("oak_planks\d?", <minecraft:planks>\*3,\[$/);
    // Lines 26-28: each axis of an oak log -> the debarked oak log and oak bark.
    const debark = way(pack.howToGet('hitwithaxe:debarked_oak'), 'debark-log');
    for (const n of [26, 27, 28]) {
        const [, block, meta, out, , drop] = chop(n);
        assert.deepEqual([block, out, drop], ['minecraft:log', 'hitwithaxe:debarked_oak', 'hitwithaxe:bark:15'], `line ${n}`);
        // The pair names the wood (meta & 3); bits 4 and 8 are the placed log's axis ("any axis" in the summary).
        assert.ok(debark.blocks.some((b) => b.name === block && b.meta === (Number(meta) & 3)), `line ${n}`);
    }
    // Line 29: the debarked oak log (any meta) -> one plank, the block becomes air.
    assert.deepEqual(chop(29).slice(1, 7), ['hitwithaxe:debarked_oak', '32767', undefined, undefined, 'minecraft:planks', undefined]);
    assert.equal(way(pack.howToGet('oak_planks'), 'plank-from-debarked-log').count, 1);
    // Lines 777-793: every "<block>, any meta -> 2 sticks" whose block is in this pack is in the rule, and no other.
    const stickLines = [...zs.keys()].filter((n) => n >= 777 && n <= 793 && zs.get(n).startsWith('Chopping'));
    const stickBlocks = stickLines.map(chop).filter((m) => m[5] === 'minecraft:stick' && m[6] === '2' && m[2] === '32767').map((m) => m[1]);
    assert.equal(stickBlocks.length, stickLines.length);
    const rule = way(pack.howToGet('stick'), 'sticks-from-planks');
    assert.deepEqual(rule.blocks.map((b) => b.name).sort(), stickBlocks.filter((b) => pack.names.blocks.has(b)).sort());
    assert.equal(rule.count, 2);

    const javap = fs.readFileSync(path.join(HERE, 'fixtures/hitwithaxe-1.5.1/HitWithAxe.javap.txt'), 'utf8').replace(/\r\n/g, '\n');
    const section = (name) => javap.slice(javap.indexOf(`## ${name}`)).split(/\n## /)[0];
    // onItemUse: the held item's tool classes must contain "axe", and its axe level must be >= the recipe's.
    const use = section('shadows.hitwithaxe.HitWithAxe');
    assert.match(use, /Item\.getToolClasses[^\n]*\n[^\n]*String axe\n[^\n]*Set\.contains/);
    assert.match(use, /String axe\n(?:[^\n]*\n){2}[^\n]*Item\.getHarvestLevel[^\n]*\n[^\n]*\n[^\n]*TransformRecipe\.getHarvestLevel[^\n]*\n[^\n]*if_icmplt/);
    // call: the stack drops one block toward the player (offset(facing, -1)); the held axe takes 1 damage.
    const call = section('shadows.hitwithaxe.DefaultTransformCall');
    assert.match(call, /EntityPlayer\.func_174811_aO[^\n]*\n[^\n]*iconst_m1\n[^\n]*BlockPos\.func_177967_a/);
    assert.match(call, /iconst_1\n[^\n]*\n[^\n]*ItemStack\.func_77972_a/);
    // The script's overloads (lines 26-28: 5 arguments; 29 and 779: 3 arguments) pass harvest level 0.
    const crt = section('shadows.hitwithaxe.crt.Chopping');
    assert.match(crt, /addRecipe\(java\.lang\.String, int, java\.lang\.String, int, crafttweaker\.api\.item\.IItemStack\);\n\s+Code:\n(?:[^\n]*\n){4}\s+4: iconst_0\n/);
    assert.match(crt, /addRecipe\(java\.lang\.String, int, crafttweaker\.api\.item\.IItemStack\);\n\s+Code:\n(?:[^\n]*\n){3}\s+4: iconst_0\n\s+5: iconst_0\n/);
    assert.deepEqual(rule.tool, { type: 'axe', minLevel: 0 });
    assert.deepEqual(debark.tool, { type: 'axe', minLevel: 0 });
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
    assert.equal(way(pack.howToGet('stick'), 'fell-tree').ore, undefined);
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
    const covered = new Set(way(stick, 'fell-tree').blocks.map((b) => b.name));
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

test('#284: dirt and grass broken by hand (or with a shovel below level 1) drop 4 Piles of Dirt; a level 1 shovel gets the dirt block', () => {
    // The pack's lines, "<line>: <text>" under "## <path>" headers.
    const sections = new Map();
    let cur = null;
    for (const l of fs.readFileSync(path.join(HERE, 'fixtures/rotn-3.3.4/dirt-drops.excerpt.txt'), 'utf8').split(/\r?\n/)) {
        if (l.startsWith('## ')) sections.set((cur = l.slice(3).split(' (SHA-256')[0]), new Map());
        else if (cur && /^\d+: /.test(l)) sections.get(cur).set(Number(l.slice(0, l.indexOf(':'))), l.slice(l.indexOf(':') + 2));
    }
    const dropt = sections.get('scripts/dropt_loose_materials.zs');
    assert.equal(dropt.get(4), 'Dropt.list("pile_dirt")');
    assert.match(dropt.get(10), /\.mainHand\("BLACKLIST", \[\], "shovel;1;-1"\)/);
    assert.match(dropt.get(14), /\.items\(\[<betterwithmods:dirt_pile>\], Dropt\.range\(4\)\)/);
    // A block named without a meta is meta 0 (athenaeum's parser); "name:meta" names that meta.
    const scriptBlocks = JSON.parse(dropt.get(7).match(/\.matchBlocks\((\[.*\])\)/)[1]).map((n) => {
        const [mod, id, meta] = n.split(':');
        return `${mod}:${id}:${meta ?? 0}`;
    });
    const piles = way(pack.howToGet('betterwithmods:dirt_pile'), 'dirt-piles');
    assert.deepEqual(piles.blocks.map((b) => `${b.name}:${b.meta}`).sort(), scriptBlocks.sort());
    for (const b of piles.blocks) assert.ok(pack.names.blocks.has(b.name), b.name);
    assert.equal(piles.count, 4);
    assert.equal(piles.tool, null);
    assert.deepEqual(piles.unlessTool, { type: 'shovel', minLevel: 1 });
    assert.equal(piles.confidence, 'documented');
    assert.match(piles.evidence.at(-1), /^Supporting only: the human, who plays the pack/);
    assert.equal(pack.getItem('betterwithmods:dirt_pile').variant.displayName, 'Pile of Dirt');
    // Better With Mods' own piles and Pyrotech's dirt and grass rules are off.
    assert.equal(sections.get('config/betterwithmods.cfg').get(495).trim(), 'B:HCPiles=false');
    assert.deepEqual([22, 26].map((n) => sections.get('config/pyrotech/plugin.Dropt.cfg').get(n).trim()), ['B:dirt=false', 'B:grass=false']);
    // 4 piles -> 1 dirt: shapeless, no table (minecraft_(max-file-size).zs 218 and 268).
    const mc = sections.get('scripts/minecraft_(max-file-size).zs');
    assert.match(mc.get(218), /<minecraft:dirt> : <betterwithmods:dirt_pile>,/);
    assert.match(mc.get(268), /recipes\.addShapeless\(cobble, \[rock,rock,rock,rock\]\);/);
    const fromPiles = pack.howToGet('dirt').ways.find((w) => w.kind === 'craft' && w.inputs.length === 1 && w.inputs[0].choices.some((c) => c.name === 'betterwithmods:dirt_pile'));
    assert.deepEqual([fromPiles.inputs[0].count, fromPiles.gives.count, fromPiles.requiresTable], [4, 1, false]);
    assert.match(formatHowToGet(pack.howToGet('betterwithmods:dirt_pile')), /By hand or with any tool except a shovel of mining level 1 or higher\./);

    // Dropt's matcher: a BLACKLIST rule fails only for a held item of that tool class within [min, max]; max -1 is unbounded; range(4) is fixed.
    const javap = fs.readFileSync(path.join(HERE, 'fixtures/dropt-1.19.4/Dropt.javap.txt'), 'utf8').replace(/\r\n/g, '\n');
    assert.match(javap, /Set\.contains[^\n]*\n[^\n]*istore +12\n[^\n]*iload +12\n[^\n]*ifeq[^\n]*\n[^\n]*iload +11\n[^\n]*ifeq[^\n]*\n(?:[^\n]*\n){2,8}[^\n]*String \[MATCH\] \[!!\] Held item is excluded:/);
    assert.match(javap, /_maxHarvestLevel:I\n[^\n]*ifge[^\n]*\n(?:[^\n]*\n)?[^\n]*int 2147483647\n[^\n]*putfield[^\n]*_maxHarvestLevel/);
    assert.match(javap, /RandomFortuneInt range\(int\);[\s\S]*?putfield[^\n]*RandomFortuneInt\.fixed:I/);
    assert.match(javap, /ParseResult\."<init>"[^\n]*\n(?:[^\n]*\n){1,3}[^\n]*iconst_0\n[^\n]*ParseResult\.setMeta/);

    // With a level 1 shovel the rule does not fire: the plain drops (the dump) are the pairs.
    const dug = way(pack.howToGet('dirt'), 'dirt-with-shovel');
    assert.deepEqual(dug.tool, { type: 'shovel', minLevel: 1 });
    assert.deepEqual(pack.howToGet('dirt').ways[0].id, 'dirt-with-shovel');
    const rule = pack.worldSources.find((r) => r.id === 'dirt-with-shovel');
    for (const p of rule.pairs) {
        const drops = pack.getBlock({ name: p.block.name, meta: p.block.meta }).state.drops;
        assert.deepEqual(drops, [{ ...p.item, count: 1 }], `${p.block.name}:${p.block.meta}`);
    }
    assert.deepEqual(rule.pairs.map((p) => `${p.block.name}:${p.block.meta}`).sort(), scriptBlocks.filter((b) => !b.startsWith('growthcraft_rice:')).sort());
    // Level 1 and up: flint, bone and iron shovels; the crude, stone and wooden shovels are level 0.
    for (const [item, level] of [['pyrotech:flint_shovel', 1], ['pyrotech:bone_shovel', 1], ['minecraft:iron_shovel', 1], ['pyrotech:crude_shovel', 0], ['minecraft:stone_shovel', 0], ['minecraft:wooden_shovel', 0]]) {
        assert.equal(pack.getItem(item).toolClasses.shovel, level, item);
    }
});
