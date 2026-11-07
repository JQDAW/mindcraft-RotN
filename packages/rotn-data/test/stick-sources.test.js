// Stick sources after G3 smoke round 8 A (lead task, 2026-11-07): a dead bush broken by hand gives
// 0-2 sticks, leaves broken by hand give 1 stick half the time (Pyrotech), and every Dynamic Trees
// species uses the same felled-tree stick rule. Each claim is checked against the dump and the
// javap excerpts in fixtures/stick-sources-3.3.4/ (from the pinned pack zip; nothing was run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';
import { formatHowToGet } from '../src/howto.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pack = loadRotnData('3.3.4');
const way = (result, id) => result.ways.find((w) => w.id === id);
const javap = fs.readFileSync(path.join(HERE, 'fixtures/stick-sources-3.3.4/stick-sources.javap.txt'), 'utf8').replace(/\r\n/g, '\n');
const section = (title) => {
    const i = javap.indexOf(`\n## ${title}`);
    assert.ok(i >= 0, `fixture section ${title}`);
    return javap.slice(i + 1).split(/\n## /)[0];
};
const srg = section('SRG');
/** One method's code from a section, by its exact javap signature line. */
const method = (sec, sig) => {
    const i = sec.indexOf(`  ${sig}\n`);
    assert.ok(i >= 0, `method ${sig}`);
    return sec.slice(i).split(/\n(?= {2}\S)/)[0];
};

test('deadbush-sticks: break a dead bush by hand for 0-2 sticks', () => {
    const w = way(pack.howToGet('stick'), 'deadbush-sticks');
    assert.ok(w, 'howToGet("stick") offers the dead bush');
    assert.equal(w.kind, 'world');
    assert.equal(w.action, 'break');
    assert.deepEqual(w.blocks, [{ name: 'minecraft:deadbush', meta: 0 }]);
    assert.equal(w.tool, null);
    assert.equal(w.count, null);
    assert.deepEqual(w.countRange, { min: 0, max: 2, mean: 1 });
    assert.equal(w.confidence, 'documented');
    assert.match(w.summary, /shears/);
    assert.ok(!('unlessTool' in w), 'shears have no tool class, so no unlessTool');
    assert.equal(pack.getItem('minecraft:shears').toolClasses.shears, undefined);
    // The dump: one state, breaks at once, needs no tool; its fixed-seed drop sample is empty, which is
    // why the plain block drops miss it.
    const b = pack.dump.blocks.blocks['minecraft:deadbush'];
    assert.equal(b.class, 'net.minecraft.block.BlockDeadBush');
    assert.deepEqual(b.states.map((s) => [s.meta, s.hardness, s.toolRequired, s.drops.length]), [[0, 0, false, 0]]);
});

test('deadbush-sticks: the Forge-patched BlockDeadBush drops Items.STICK x Random.nextInt(3)', () => {
    // The SRG table names the obfuscated members.
    assert.match(srg, /^CL: apu net\/minecraft\/block\/BlockDeadBush$/m);
    assert.match(srg, /^FD: air\/B net\/minecraft\/init\/Items\/field_151055_y$/m); // Items.STICK
    assert.match(srg, /^FD: air\/bm net\/minecraft\/init\/Items\/field_151097_aZ$/m); // Items.SHEARS
    assert.match(srg, /^MD: apu\/a \(Ljava\/util\/Random;\)I net\/minecraft\/block\/BlockDeadBush\/func_149745_a /m); // quantityDropped
    assert.match(srg, /^MD: apu\/a \(Lawt;Ljava\/util\/Random;I\)Lain; net\/minecraft\/block\/BlockDeadBush\/func_180660_a /m); // getItemDropped
    const apu = section('apu');
    assert.match(apu, /^public class apu extends apc implements net\.minecraftforge\.common\.IShearable \{/m);
    // quantityDropped: nextInt(3), so 0..2: the rule's range.
    const qty = method(apu, 'public int a(java.util.Random);');
    assert.match(qty, /iconst_3\n[^\n]*Random\.nextInt:\(I\)I\n[^\n]*ireturn/);
    const w = way(pack.howToGet('stick'), 'deadbush-sticks');
    assert.equal(w.countRange.max, 3 - 1);
    assert.equal(w.countRange.mean, (0 + 1 + 2) / 3);
    // getItemDropped: Items.STICK for any state and fortune.
    assert.match(method(apu, 'public ain a(awt, java.util.Random, int);'), /^\s+0: getstatic[^\n]*Field air\.B:Lain;\n\s+3: areturn$/m);
    // harvestBlock: with Items.SHEARS the bush drops itself (Blocks.DEADBUSH, aox.I).
    const harvest = method(apu, 'public void a(amu, aed, et, awt, avj, aip);');
    assert.match(harvest, /Field air\.bm:Lajl;\n[^\n]*if_acmpne/);
    assert.match(harvest, /Field aox\.I:Lapu;/);
    assert.match(apu, /public java\.util\.List<aip> onSheared\(/);
    // canSustainBush: sand, hardened clay, stained hardened clay, dirt (the summary's soils).
    const soil = method(apu, 'protected boolean x(awt);');
    for (const f of ['aox.m', 'aox.cz', 'aox.cu', 'aox.d']) assert.match(soil, new RegExp(`Field ${f.replace('.', '\\.')}:`));
    for (const [f, n] of [['m', 'field_150354_m'], ['cz', 'field_150405_ch'], ['cu', 'field_150406_ce'], ['d', 'field_150346_d']]) {
        assert.match(srg, new RegExp(`^FD: aox/${f} net/minecraft/init/Blocks/${n}$`, 'm'));
    }
});

test('leaves-sticks: Pyrotech adds 1 stick half the time when a player breaks leaves', () => {
    const w = way(pack.howToGet('stick'), 'leaves-sticks');
    assert.ok(w);
    assert.equal(w.action, 'break');
    assert.equal(w.tool, null);
    assert.equal(w.count, null);
    assert.deepEqual(w.countRange, { min: 0, max: 1, mean: 0.5 });
    assert.equal(w.confidence, 'documented');
    assert.deepEqual(w.blocks.map((b) => b.name), ['dynamictrees:leaves0', 'dynamictrees:leaves1', 'minecraft:leaves', 'minecraft:leaves2']);
    for (const b of w.blocks) assert.ok(pack.dump.blocks.blocks[b.name], `${b.name} is in the dump`);
    // Registered only with DROP_STICKS_FROM_LEAVES, which the pack's config turns on.
    assert.match(section('com.codetaylor.mc.pyrotech.modules.core.ModuleCore'), /DROP_STICKS_FROM_LEAVES:Z\n[^\n]*ifeq[^\n]*\n(?:[^\n]*\n){3}[^\n]*HarvestDropsEventHandler\$Sticks\."<init>"/);
    assert.match(section('config/pyrotech/core.cfg'), /^\s+B:DROP_STICKS_FROM_LEAVES=true$/m);
    // The handler: pick-block item in ore treeLeaves; a player harvester -> nextFloat() < 0.5 -> 1 stick.
    const on = section('com.codetaylor.mc.pyrotech.modules.core.event.HarvestDropsEventHandler$Sticks');
    assert.match(on, /Block\.func_185473_a/);
    assert.match(on, /String treeLeaves\n(?:[^\n]*\n){1}[^\n]*OreDictHelper\.contains/);
    assert.match(on, /110: ifnonnull\s+147/);
    assert.match(on, /147: invokestatic[^\n]*RandomHelper\.random[^\n]*\n[^\n]*nextFloat[^\n]*\n[^\n]*f2d\n[^\n]*double 0\.5d/);
    assert.match(on, /Items\.field_151055_y/);
    assert.equal(w.countRange.mean, 0.5);
    // Which leaves: the vanilla leaves are in treeLeaves at every meta...
    const leafOre = pack.oreDict('treeLeaves');
    for (const n of ['minecraft:leaves', 'minecraft:leaves2']) assert.ok(leafOre.some((s) => s.name === n && s.meta === 32767), `${n} in treeLeaves`);
    // ...and Dynamic Trees leaves pick the vanilla leaves of their family.
    assert.match(section('com.ferreusveritas.dynamictrees.blocks.BlockDynamicLeaves'), /getPrimitiveLeavesItemStack/);
    assert.match(section('com.ferreusveritas.dynamictrees.blocks.BlockDynamicLeaves'), /overrides of harvestBlock, dropBlockAsItemWithChance, dropBlockAsItem, removedByPlayer: 0/);
    const common = section('DramaticTrees assets/dynamictrees/leaves/common.json');
    for (const v of ['minecraft:leaves variant=oak', 'minecraft:leaves variant=spruce', 'minecraft:leaves variant=birch', 'minecraft:leaves variant=jungle', 'minecraft:leaves2 variant=acacia', 'minecraft:leaves2 variant=dark_oak']) {
        assert.ok(common.includes(`"leaves":"${v}"`), v);
    }
    // The harvest event fires with the player: BlockLeaves has no harvestBlock of its own, and Block's
    // drop path fires it with harvesters.get().
    assert.doesNotMatch(section('arr'), /void a\(amu, aed, et, awt, avj, aip\)/);
    assert.match(section('aow (net.minecraft.block.Block, Forge-patched): dropBlockAsItemWithChance'), /Field harvesters[^\n]*\n[^\n]*ThreadLocal\.get[^\n]*\n(?:[^\n]*\n)*?[^\n]*ForgeEventFactory\.fireBlockHarvesting/);
});

test('fell-tree: one stick rule for every species, and no more "leaves never drop sticks"', () => {
    const w = way(pack.howToGet('stick'), 'fell-tree');
    assert.doesNotMatch(w.summary, /leaves never/);
    assert.match(w.summary, /same rule \(spruce and dark oak too\)/);
    assert.ok(!('countRange' in w), 'logs and sticks: no single range');
    assert.ok(w.evidence.some((e) => /^Species \(lead's question/.test(e)));
    assert.ok(w.evidence.some((e) => /CORRECTION \(2026-11-07/.test(e)));
    // logs = (int) V, sticks = (int) ((V - logs) * 8): the leftover eighths.
    const sticks = method(section('com.ferreusveritas.dynamictrees.trees.Species'), 'public com.ferreusveritas.dynamictrees.trees.Species$LogsAndSticks getLogsAndSticks(float);');
    assert.match(sticks, /f2i\n[^\n]*istore_2\n[^\n]*fload_1\n[^\n]*iload_2\n[^\n]*i2f\n[^\n]*fsub\n[^\n]*float 8\.0f\n[^\n]*fmul\n[^\n]*f2i/);
    const volume = section('com.ferreusveritas.dynamictrees.systems.nodemappers.NodeNetVolume');
    assert.match(volume, /iload\s+5\n[^\n]*iload\s+5\n[^\n]*imul\n[^\n]*bipush\s+64\n[^\n]*imul/);
    assert.match(volume, /float 4096\.0f/);
    assert.match(section('com.ferreusveritas.dynamictrees.blocks.BlockBranch'), /treeHarvestMultiplier:F\n[^\n]*fmul/);
});

test('countRange appears only on rules that name one, and the text answer still forms', () => {
    const stick = pack.howToGet('stick');
    const withRange = stick.ways.filter((w) => 'countRange' in w).map((w) => w.id).sort();
    assert.deepEqual(withRange, ['deadbush-sticks', 'leaves-sticks']);
    for (const w of stick.ways.filter((x) => x.countRange)) assert.ok(w.countRange.min <= w.countRange.mean && w.countRange.mean <= w.countRange.max);
    assert.deepEqual(stick.ways.slice(0, 4).map((w) => w.id), ['fell-tree', 'sticks-from-planks', 'leaves-sticks', 'deadbush-sticks'], 'formatHowToGet shows all four by default');
    const text = formatHowToGet(stick, { maxWays: 8 });
    assert.match(text, /dead bush/);
    assert.match(text, /leaves/i);
});
