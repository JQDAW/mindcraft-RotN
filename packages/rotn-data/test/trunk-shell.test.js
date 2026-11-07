// The Dynamic Trees trunk shell (lead task from G3 smoke round 9 B, 2026-11-07): breaking a
// dynamictrees:trunkshell block fells the tree from the trunk block it belongs to, and the shell
// itself drops nothing. Each claim of fell-tree's trunkShell is checked against the dump and the
// javap excerpts in fixtures/trunk-shell-3.3.4/ (from the pinned pack zip; nothing was run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pack = loadRotnData('3.3.4');
const javap = fs.readFileSync(path.join(HERE, 'fixtures/trunk-shell-3.3.4/trunk-shell.javap.txt'), 'utf8').replace(/\r\n/g, '\n');
const section = (title) => {
    const i = javap.indexOf(`\n## ${title}\n`);
    assert.ok(i >= 0, `fixture section ${title}`);
    return javap.slice(i + 1).split(/\n## /)[0];
};
/** One method's code from a section, by its exact javap signature line. */
const method = (sec, sig) => {
    const i = sec.indexOf(`  ${sig}\n`);
    assert.ok(i >= 0, `method ${sig}`);
    return sec.slice(i).split(/\n(?= {2}\S)/)[0];
};
const shellSec = section('BlockTrunkShell');
const fellTree = pack.howToGet('log').ways.find((w) => w.id === 'fell-tree');
const shell = fellTree?.trunkShell;
const blocks = pack.dump.blocks.blocks;

test('howToGet passes fell-tree\'s trunkShell through, as a copy', () => {
    assert.ok(shell, 'fell-tree has trunkShell');
    assert.equal(shell.block, 'dynamictrees:trunkshell');
    assert.equal(shell.fells, true);
    assert.deepEqual(shell.drops, []);
    shell.coreOffsets['0'][2] = 99;
    assert.deepEqual(pack.howToGet('log').ways.find((w) => w.id === 'fell-tree').trunkShell.coreOffsets['0'], [0, 0, -1]);
    shell.coreOffsets['0'][2] = -1;
    // Only fell-tree carries it.
    const others = ['stick', 'cobblestone', 'dirt'].flatMap((n) => pack.howToGet(n)?.ways ?? []).filter((w) => w.id !== 'fell-tree');
    assert.ok(others.length > 0);
    assert.ok(others.every((w) => !('trunkShell' in w)));
    assert.match(fellTree.summary, /trunkshell/);
});

test('breaking a shell breaks the trunk block it belongs to, which queues the felling', () => {
    const removed = method(shellSec, 'public boolean removedByPlayer(net.minecraft.block.state.IBlockState, net.minecraft.world.World, net.minecraft.util.math.BlockPos, net.minecraft.entity.player.EntityPlayer, boolean);');
    assert.match(removed, /Method getMuse:/);
    assert.match(removed, /ShellMuse\.state/);
    assert.match(removed, /ShellMuse\.pos/);
    assert.match(removed, /Method net\/minecraft\/block\/Block\.removedByPlayer:/);
    // The muse is a thick branch (the only IMusable), whose BlockBranch.removedByPlayer queues a FutureBreak.
    const unchecked = method(shellSec, 'public com.ferreusveritas.dynamictrees.blocks.BlockTrunkShell$ShellMuse getMuseUnchecked(net.minecraft.world.IBlockAccess, net.minecraft.block.state.IBlockState, net.minecraft.util.math.BlockPos);');
    assert.match(unchecked, /instanceof +#\d+ +\/\/ class com\/ferreusveritas\/dynamictrees\/blocks\/IMusable/);
    assert.match(unchecked, /Surround\.getOffset/);
    assert.match(unchecked, /BlockPos\.func_177971_a/); // pos.add(offset)
    const thick = section('BlockBranchThick');
    assert.match(thick, /class com\.ferreusveritas\.dynamictrees\.blocks\.BlockBranchThick extends com\.ferreusveritas\.dynamictrees\.blocks\.BlockBranchBasic implements com\.ferreusveritas\.dynamictrees\.blocks\.IMusable/);
    assert.match(method(thick, 'public boolean isMusable();'), /iconst_1\n\s+1: ireturn/);
    const branch = section('BlockBranch');
    assert.match(method(branch, 'public boolean removedByPlayer(net.minecraft.block.state.IBlockState, net.minecraft.world.World, net.minecraft.util.math.BlockPos, net.minecraft.entity.player.EntityPlayer, boolean);'), /Method removedByEntity:/);
    const byEntity = method(branch, 'public boolean removedByEntity(net.minecraft.block.state.IBlockState, net.minecraft.world.World, net.minecraft.util.math.BlockPos, net.minecraft.entity.EntityLivingBase);');
    assert.match(byEntity, /FutureBreak\.add/);
    assert.match(byEntity, /iconst_0\n\s+17: ireturn/);
    assert.match(section('FutureBreak'), /IFutureBreakable\.futureBreak/);
});

test('#332 nits: a shell with no trunk is air on the server; next to a thin trunk the break still goes to it', () => {
    // isAir: true when getMuse finds no muse (a position given).
    const isAir = method(shellSec, 'public boolean isAir(net.minecraft.block.state.IBlockState, net.minecraft.world.IBlockAccess, net.minecraft.util.math.BlockPos);');
    assert.match(isAir, /Method getMuse:[\s\S]*13: ifnonnull +20\n\s+16: iconst_1/);
    assert.match(shell.summary, /reports itself as air on the server \(isAir\)/);
    // getMuse returns the muse even when it schedules clearing (radius <= 8): removedByPlayer still uses it.
    const getMuse = method(shellSec, 'public com.ferreusveritas.dynamictrees.blocks.BlockTrunkShell$ShellMuse getMuse(net.minecraft.world.IBlockAccess, net.minecraft.block.state.IBlockState, net.minecraft.util.math.BlockPos);');
    assert.match(getMuse, /Method scheduleForClearing:[^\n]*\n\s+30: aload +4\n\s+32: areturn/);
    assert.ok(fellTree.evidence.some((e) => /still passes the break to that trunk before the clearing tick, so the tree is felled/.test(e)));
    assert.ok(fellTree.unverified.some((u) => /keep this unverified until a run breaks a shell/.test(u)));
});

test('the shell drops nothing of its own', () => {
    assert.match(method(shellSec, 'public net.minecraft.item.Item func_180660_a(net.minecraft.block.state.IBlockState, java.util.Random, int);'), /aconst_null\n\s+1: areturn/);
    assert.match(method(shellSec, 'public int func_149745_a(java.util.Random);'), /iconst_0\n\s+1: ireturn/);
});

test('coreOffsets: meta 0-7 is coredir N, NW, W, SW, S, SE, E, NE, summed from EnumFacing vectors', () => {
    const facing = { NORTH: [0, 0, -1], SOUTH: [0, 0, 1], WEST: [-1, 0, 0], EAST: [1, 0, 0], UP: [0, 1, 0], DOWN: [0, -1, 0] };
    const init = method(section('CoordUtils$Surround'), 'static {};');
    // Each enum constant: its name, then the EnumFacing fields of its varargs array.
    const parts = init.split(/ldc +#\d+ +\/\/ String (?=[A-Z]+\n)/).slice(1);
    const derived = {};
    parts.forEach((p, ordinal) => {
        const facings = [...p.matchAll(/Field net\/minecraft\/util\/EnumFacing\.([A-Z]+):/g)].map((m) => m[1]);
        assert.ok(facings.length >= 1 && facings.length <= 2, `constant ${ordinal}`);
        derived[String(ordinal)] = facings.reduce((a, f) => a.map((v, i) => v + facing[f][i]), [0, 0, 0]);
    });
    assert.equal(Object.keys(derived).length, 8);
    assert.deepEqual(shell.coreOffsets, derived);
    // The constructor sums EnumFacing.getDirectionVec (func_176730_m) into the offset.
    assert.match(section('CoordUtils$Surround'), /EnumFacing\.func_176730_m/);
    // The dump's coredir names follow the same order.
    const names = ['n', 'nw', 'w', 'sw', 's', 'se', 'e', 'ne'];
    for (const s of blocks['dynamictrees:trunkshell'].states) assert.equal(s.props.coredir, names[s.meta]);
});

test('a shell exists only around a trunk of radius 9 or more; thickTrunks are exactly those blocks', () => {
    const getMuse = method(shellSec, 'public com.ferreusveritas.dynamictrees.blocks.BlockTrunkShell$ShellMuse getMuse(net.minecraft.world.IBlockAccess, net.minecraft.block.state.IBlockState, net.minecraft.util.math.BlockPos);');
    assert.match(getMuse, /ShellMuse\.getRadius:\(\)I\n\s+19: bipush +8\n\s+21: if_icmpgt/);
    assert.match(getMuse, /Method scheduleForClearing:/);
    assert.equal(shell.minTrunkRadius, 9);
    // radius = meta + 1, or meta + 17 on the extended block (BlockBranchThick.getRadius).
    const radius = method(section('BlockBranchThick'), 'public int getRadius(net.minecraft.block.state.IBlockState);');
    assert.match(radius, /bipush +17[\s\S]*iconst_1\n\s+46: iadd/);
    const radiusOf = (name, meta) => (name.endsWith('x') ? Math.min(meta + 17, 24) : meta + 1);
    // Every vanilla-family branch state with radius >= 9 is listed, and nothing else.
    const listed = new Set(shell.thickTrunks.flatMap((t) => (t.metas ?? blocks[t.name].states.map((s) => s.meta)).map((m) => `${t.name}:${m}`)));
    const expected = new Set();
    for (const wood of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'darkoak']) {
        for (const name of [`dynamictrees:${wood}branch`, `dynamictrees:${wood}branchx`]) {
            for (const s of blocks[name]?.states ?? []) if (radiusOf(name, s.meta) >= 9) expected.add(`${name}:${s.meta}`);
        }
    }
    assert.deepEqual([...listed].sort(), [...expected].sort());
    // Birch and acacia stop at radius 8: no shells.
    assert.equal(blocks['dynamictrees:birchbranch'].states.length, 8);
    assert.equal(blocks['dynamictrees:acaciabranch'].states.length, 8);
    assert.equal(blocks['dynamictrees:birchbranchx'], undefined);
    // Their dumped hardness is the trunk's real one: 2 x radius^2 / 8.
    for (const t of shell.thickTrunks) {
        for (const s of blocks[t.name].states.filter((x) => !t.metas || t.metas.includes(x.meta))) {
            assert.equal(s.hardness, 2 * radiusOf(t.name, s.meta) ** 2 / 8, `${t.name}:${s.meta}`);
            assert.equal(blocks[t.name].class, 'com.ferreusveritas.dynamictrees.blocks.BlockBranchThick');
        }
    }
});

test('the dump\'s shell hardness, tool and collision are the no-trunk values, not the real ones', () => {
    assert.deepEqual(shell.dumpUnreliable, ['hardness', 'harvestTool', 'collision']);
    for (const s of blocks['dynamictrees:trunkshell'].states) {
        assert.equal(s.hardness, 0);
        assert.equal(s.harvestTool, null);
        assert.equal(s.material, 'wood');
        assert.deepEqual(s.collision, [[0, 0, 0, 0, 0, 0]]);
    }
    // In game they come from the trunk block (the muse); with no muse, hardness 0 and an empty box.
    const hardness = method(shellSec, 'public float func_176195_g(net.minecraft.block.state.IBlockState, net.minecraft.world.World, net.minecraft.util.math.BlockPos);');
    assert.match(hardness, /Method net\/minecraft\/block\/Block\.func_176195_g:/);
    assert.match(hardness, /51: fconst_0/);
    assert.match(method(shellSec, 'public net.minecraft.util.math.AxisAlignedBB func_180640_a(net.minecraft.block.state.IBlockState, net.minecraft.world.World, net.minecraft.util.math.BlockPos);'), /ShellMuse\.pos/);
    // Material WOOD (needs no tool).
    assert.match(method(shellSec, 'public com.ferreusveritas.dynamictrees.blocks.BlockTrunkShell();'), /Material\.field_151575_d/);
    // A branch's hardness grows with the radius, under maxTreeHardness=200.
    assert.match(section('config/dynamictrees.cfg (pinned pack zip)'), /S:maxTreeHardness=200\.0/);
});
