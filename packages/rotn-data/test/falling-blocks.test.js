// falling-blocks.json (tools/build-falling-blocks.mjs) and the catalog's falls / fallInfo.
// Offline: reads only the committed data. The rebuild from the pinned pack zip is
// `node packages/rotn-data/tools/build-falling-blocks.mjs --pack <zip> --check`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';
import { REVIEWED } from '../tools/build-falling-blocks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(HERE, '../3.3.4/falling-blocks.json'), 'utf8'));
const pack = loadRotnData('3.3.4');
const B = pack.dump.blocks.blocks;

test('built from the pinned pack, with nothing left undecided', () => {
    assert.equal(data.source.packZipSha256, '90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205');
    assert.deepEqual(data.unreviewed, {}, 'every block that makes a falling entity is decided');
    assert.deepEqual(data.unresolved, [], 'every dumped block class chain resolves');
    assert.ok(data.source.modJars >= 345, 'the jars in mods/ and its subfolders are read');
    assert.ok(data.fallingEntityClasses.includes('net.minecraft.entity.item.EntityFallingBlock'));
});

test('every entry is a dumped block, with its class and a known way and condition', () => {
    const vias = new Set(['BlockFalling', 'own-code', 'contenttweaker-gravity', 'osv-background']);
    const whens = new Set(['unsupported-below', 'loses-support', 'player-nearby', 'redstone-powered']);
    for (const [n, e] of Object.entries(data.blocks)) {
        assert.ok(B[n], `${n} is dumped`);
        assert.equal(e.class, B[n].class, n);
        assert.ok(vias.has(e.via), `${n}: via ${e.via}`);
        assert.ok(whens.has(e.when), `${n}: when ${e.when}`);
        if (e.via === 'BlockFalling') {
            assert.equal(e.chain[0], e.class, n);
            assert.equal(e.chain.at(-1), 'net.minecraft.block.BlockFalling', n);
        }
        if (e.via === 'own-code') assert.ok(REVIEWED[e.reviewed]?.falls && e.evidence === REVIEWED[e.reviewed].evidence, `${n}: reviewed`);
        if (e.via === 'contenttweaker-gravity') assert.match(e.script, /^scripts\/.+\.zs line \d+: \w+\.setGravity\(true\);$/, n);
        if (e.via === 'osv-background') assert.equal(data.blocks[e.background]?.via, 'BlockFalling', `${n}: background ${e.background} extends BlockFalling`);
    }
    for (const [rule, r] of Object.entries(data.notFalling)) {
        assert.ok(r.evidence.length >= 2, rule);
        for (const n of r.blocks) assert.ok(B[n] && !data.blocks[n], `${rule}: ${n}`);
    }
});

test('falls: vanilla and modded falling blocks, by any accepted name', () => {
    for (const n of ['sand', 'red_sand', 'gravel', 'white_concrete_powder', 'minecraft:anvil', 'dragon_egg',
        'undergroundbiomes:igneous_sand', 'undergroundbiomes:sedimentary_gravel', 'defiledlands:sand_defiled', 'iceandfire:ash',
        'contenttweaker:loose_mud_bricks', 'osv:clay_deposits_gravel']) {
        assert.equal(pack.falls(n), true, n);
    }
    for (const n of ['stone', 'dirt', 'oak_log', 'cobblestone', 'sandstone', 'osv:coal_ore_sandstone', 'contenttweaker:acacia_boards', 'pyrotech:rock']) {
        assert.equal(pack.falls(n), false, n);
    }
    assert.equal(pack.falls('no_such_block'), null);
    assert.equal(pack.fallInfo('stone'), null);
    // The anvil on this pack is Inspirations' smashing anvil, still a BlockAnvil.
    assert.deepEqual(pack.fallInfo('anvil').chain, ['knightminer.inspirations.recipes.block.BlockSmashingAnvil', 'net.minecraft.block.BlockAnvil', 'net.minecraft.block.BlockFalling']);
});

test('conditional falls say when', () => {
    assert.equal(pack.fallInfo('quark:gravisand').when, 'redstone-powered');
    assert.equal(pack.fallInfo('charm:iron_lantern').when, 'loses-support');
    assert.equal(pack.fallInfo('futuremc:scaffolding').when, 'loses-support');
    assert.equal(pack.fallInfo('dynamictreesphc:fruitcoconut').when, 'player-nearby');
    assert.equal(pack.fallInfo('gravel').when, 'unsupported-below');
    // Concrete powder overrides the fall methods (it hardens next to water); listed, not reviewed.
    assert.ok(data.overridesFall['minecraft:concrete_powder'].some((m) => m.includes('onBlockAdded')));
});

test('getBlock carries falls and fallsWhen', () => {
    assert.deepEqual([pack.getBlock('sand').falls, pack.getBlock('sand').fallsWhen], [true, 'unsupported-below']);
    assert.deepEqual([pack.getBlock('stone').falls, pack.getBlock('stone').fallsWhen], [false, null]);
});
