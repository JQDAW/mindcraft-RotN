// src/collision.js: modded blocks get rotn-data's dumped collision, with
// data/collision-overrides-3.3.4.json (#256 review question; #259 review: walk-through is opt-in,
// modded fluids are liquid, traps, fires, portals, webs and lava are hazards). Offline: real
// prismarine-registry, prismarine-block, prismarine-physics and mineflayer-pathfinder's Movements for
// 1.12.2, the committed dump, the committed data and a javap fixture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { RegistrySnapshot } from '../src/registries.js';
import { extendRegistry } from '../src/registry-extension.js';
import { applyCollisionShapes, dumpShapesByMeta, validateCollisionOverrides, loadCollisionOverrides, DYNAMIC_LEAVES_BOX } from '../src/collision.js';
import { loadRotnData } from '../../rotn-data/index.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const JAVAP = fs.readFileSync(new URL('./fixtures/dynamictrees-0.13.4/BlockDynamicLeaves.javap.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n'); // autocrlf checkouts
const FULL = [[0, 0, 0, 1, 1, 1]];
const BOTTOM = [[0, 0, 0, 1, 0.5, 1]];
const TOP = [[0, 0.5, 0, 1, 1, 1]];

function extended(blockIds) {
    const registry = require('prismarine-registry')('1.12.2');
    const snap = new RegistrySnapshot();
    const regs = [
        { name: 'minecraft:blocks', ids: blockIds, dummied: [], overrides: [] },
        { name: 'minecraft:items', ids: [['minecraft:stone', 1]], dummied: [], overrides: [] },
        { name: 'minecraft:entities', ids: [['minecraft:zombie', 54]], dummied: [], overrides: [] },
        { name: 'minecraft:biomes', ids: [['minecraft:plains', 1]], dummied: [], overrides: [] },
    ];
    regs.forEach((r, i) => snap.add({ ...r, hasMore: i < regs.length - 1 }));
    extendRegistry(registry, snap);
    return registry;
}

const state = (meta, collision) => ({ meta, collision });
const MINI_DUMP = {
    'pyrotech:rock': { defaultMeta: 0, states: [state(0, []), state(6, [])] },
    'dynamictrees:leaves0': { defaultMeta: 0, states: [state(0, FULL)] }, // what the dump records
    'somemod:slab': { defaultMeta: 0, states: [state(0, BOTTOM), state(8, TOP)] },
    'somemod:gate': { defaultMeta: 0, states: [state(0, [[0, 0, 0.375, 1, 1.5, 0.625]]), state(4, [])] },
    'somemod:broken': { defaultMeta: 0, states: [state(0, [[0, 0, 0, 1, NaN, 1]])] },
    'somemod:molten_bronze': { defaultMeta: 0, states: [state(0, [])] },
    'somemod:spikes': { defaultMeta: 0, states: [state(0, [])] },
    'somemod:portal': { defaultMeta: 0, states: [state(0, [])] },
    'somemod:unreviewed': { defaultMeta: 0, states: [state(0, [])] },
    'somemod:plant': { defaultMeta: 0, states: [state(0, []), state(4, [])] },
};
const MINI_DATA = {
    shapes: { dynamicLeaves: { shapes: [DYNAMIC_LEAVES_BOX] } },
    blocks: {
        'pyrotech:rock': { walkThrough: 'all' },
        'dynamictrees:leaves0': { shapes: 'dynamicLeaves' },
        'somemod:molten_bronze': { liquid: true, hazard: 'lava' },
        'somemod:spikes': { hazard: 'trap' },
        'somemod:portal': { hazard: 'portal' },
        'somemod:plant': { walkThrough: [0], hazardByMeta: { 4: 'trap' } },
        'somemod:nodata': { hazard: 'fire' },
    },
};
const NAMES = ['pyrotech:rock', 'dynamictrees:leaves0', 'somemod:slab', 'somemod:gate', 'somemod:broken', 'somemod:molten_bronze',
    'somemod:spikes', 'somemod:portal', 'somemod:unreviewed', 'somemod:plant', 'somemod:nodata'];
const IDS = [['minecraft:air', 0], ['minecraft:stone', 1], ...NAMES.map((n, i) => [n, 4001 + i])];
const ID = Object.fromEntries(IDS);

function fixedMini() {
    const registry = extended(IDS);
    const report = applyCollisionShapes(registry, MINI_DUMP, { overrides: MINI_DATA });
    return { registry, report, Block: require('prismarine-block')(registry) };
}
const blockOf = (Block, name, meta = 0) => Block.fromStateId((ID[name] << 4) | meta, 1);

// mineflayer-pathfinder's own walkability: `safe` = may be walked through.
function movementsOver(registry, Block, at) {
    const { Movements } = require('mineflayer-pathfinder');
    const bot = { registry, version: '1.12.2', blockAt: (p) => { const b = at(p); b.position = p.clone(); return b; } };
    return new Movements(bot);
}

test('the javap fixture: Dynamic Trees leaves give a player AxisAlignedBB(0.125, 0, 0.125, 0.875, 0.5, 0.875) unless a flag says otherwise', () => {
    const add = JAVAP.slice(JAVAP.indexOf('public void func_185477_a('));
    // The flags, in order: Passable Leaves loaded or vanillaLeavesCollision -> vanilla's full cube; isLeavesPassable -> nothing.
    const order = ['Field passableLeavesModLoaded:Z', 'ModConfigs.vanillaLeavesCollision:Z', 'ModConfigs.isLeavesPassable:Z', 'new           #418'];
    const at = order.map((s) => add.indexOf(s));
    assert.ok(at.every((i, k) => i > 0 && (k === 0 || i > at[k - 1])), `flag order ${at}`);
    // The constructor's six arguments: ldc2_w 0.125, dconst_0, 0.125, 0.875, 0.5, 0.875.
    const ctor = add.slice(add.indexOf('new           #418'), add.indexOf('AxisAlignedBB."<init>":(DDDDDD)V'));
    const args = [...ctor.matchAll(/ldc2_w\s+#\d+\s+\/\/ double ([\d.]+)d|(dconst_0)/g)].map((m) => (m[2] ? 0 : Number(m[1])));
    assert.deepEqual(args, DYNAMIC_LEAVES_BOX);
    assert.match(JAVAP, /String passableleaves\n.*Loader\.isModLoaded[^\n]*\n.*putstatic.*BlockDynamicLeaves\.passableLeavesModLoaded/);
    assert.match(JAVAP.slice(JAVAP.indexOf('func_176205_b(')), /ModConfigs\.isLeavesPassable:Z\n\s+18: ireturn/, 'isPassable is the config flag');
    const data = loadCollisionOverrides();
    assert.deepEqual(data.shapes.dynamicLeaves.shapes, [DYNAMIC_LEAVES_BOX], 'the pack config selects the box (isLeavesPassable=false, vanillaLeavesCollision=false)');
    assert.match(data.shapes.dynamicLeaves.evidence, /isLeavesPassable=false \(line 60\), vanillaLeavesCollision=false \(line 66\), mod passableleaves not in the pack/);
});

test('dumpShapesByMeta: 16 shapes by metadata, or null for missing or malformed data', () => {
    const slab = dumpShapesByMeta(MINI_DUMP['somemod:slab']);
    assert.equal(slab.shapes.length, 16);
    assert.deepEqual(slab.shapes[8], TOP);
    assert.deepEqual(slab.shapes[3], BOTTOM, 'a meta with no state takes the default state\'s shape');
    assert.equal(dumpShapesByMeta(MINI_DUMP['somemod:broken']), null);
    assert.equal(dumpShapesByMeta({ defaultMeta: 0, states: [{ meta: 0 }] }), null, 'collision unknown');
    assert.equal(dumpShapesByMeta({ defaultMeta: 0, states: [] }), null);
    assert.equal(dumpShapesByMeta(undefined), null);
});

test('walk-through is opt-in: reviewed rock piles and plant states only; an unreviewed state without a box is a solid full cube', () => {
    const { registry, report, Block } = fixedMini();
    assert.deepEqual(report, { fromDump: 8, noDumpData: 2, walkThroughBlocks: 1, walkThroughSomeStates: 1, perStateEntries: 2, liquid: 1, hazard: { lava: 1, trap: 2, portal: 1, fire: 1 }, shapes: { dynamicLeaves: 1 } });
    const rock = blockOf(Block, 'pyrotech:rock', 6);
    assert.equal(rock.boundingBox, 'empty');
    assert.deepEqual(rock.shapes, []);
    const unreviewed = blockOf(Block, 'somemod:unreviewed');
    assert.equal(unreviewed.boundingBox, 'block', 'no box in the dump, not reviewed: stays solid');
    assert.deepEqual(unreviewed.shapes, FULL);
    const gate = blockOf(Block, 'somemod:gate', 4);
    assert.deepEqual(gate.shapes, FULL, 'the open state of an unreviewed block is solid too (every state is checked)');
    assert.deepEqual(blockOf(Block, 'somemod:gate', 0).shapes, [[0, 0, 0.375, 1, 1.5, 0.625]]);
    // A reviewed plant whose meta 4 harms: meta 0 walk-through, meta 4 solid and a hazard.
    const plant0 = blockOf(Block, 'somemod:plant', 0);
    const plant4 = blockOf(Block, 'somemod:plant', 4);
    assert.equal(plant0.boundingBox, 'empty');
    assert.deepEqual(plant0.shapes, []);
    assert.equal(plant4.boundingBox, 'block');
    assert.deepEqual(plant4.shapes, FULL);
    assert.equal(registry.blocksByStateId[(ID['somemod:plant'] << 4) | 4].forge.hazard, 'trap');
    assert.equal(registry.blocksByStateId[(ID['somemod:plant'] << 4) | 0].forge.hazard, undefined);
    assert.equal(registry.blocksByName['somemod:plant'].boundingBox, 'block', 'the block entry is walk-through only when every state is');
    assert.equal(plant4.name, 'somemod:plant');
    assert.equal(plant4.metadata, 4, 'the per-state entry keeps minStateId');
    // Shapes.
    assert.deepEqual(blockOf(Block, 'dynamictrees:leaves0').shapes, [DYNAMIC_LEAVES_BOX]);
    assert.deepEqual(blockOf(Block, 'somemod:slab', 8).shapes, TOP, 'a top slab is not a bottom slab');
    assert.deepEqual(blockOf(Block, 'somemod:broken').shapes, FULL, 'malformed dump data keeps the default');
    assert.equal(blockOf(Block, 'minecraft:stone').name, 'stone');
    assert.equal(registry.blocksByName.stone.forge, undefined, 'vanilla entries are not touched');
});

test('#259: a molten metal, a spike trap and a modded portal stay non-walkable, with liquid and hazard flags', () => {
    const { registry, Block } = fixedMini();
    const molten = registry.blocksByName['somemod:molten_bronze'];
    assert.equal(molten.liquid, true);
    assert.equal(molten.forge.hazard, 'lava');
    assert.equal(registry.blocksByName['somemod:spikes'].forge.hazard, 'trap');
    assert.equal(registry.blocksByName['somemod:portal'].forge.hazard, 'portal');
    assert.equal(registry.blocksByName['somemod:nodata'].forge.hazard, 'fire', 'flags apply without dump data');
    assert.deepEqual(blockOf(Block, 'somemod:nodata').shapes, FULL);
    const names = ['somemod:molten_bronze', 'somemod:spikes', 'somemod:portal', 'pyrotech:rock'];
    const movements = movementsOver(registry, Block, (p) => blockOf(Block, names[p.x]));
    const walkable = names.map((n, x) => movements.getBlock(new Vec3(x, 64, 0), 0, 0, 0).safe);
    assert.deepEqual(walkable, [false, false, false, true], 'the pathfinder walks through the rock pile only');
});

test('a bad override fails before anything changes: every modded block stays a full cube', () => {
    const registry = extended(IDS);
    const bad = { ...MINI_DATA, blocks: { ...MINI_DATA.blocks, 'zzz:last': { hazard: 'lava-ish' } } };
    assert.throws(() => applyCollisionShapes(registry, MINI_DUMP, { overrides: bad }), /unknown hazard 'lava-ish'/);
    const Block = require('prismarine-block')(registry);
    for (const n of NAMES) {
        const b = blockOf(Block, n);
        assert.deepEqual([b.boundingBox, b.shapes], ['block', FULL], n);
        assert.equal(registry.blocksByName[n].forge.collision, undefined, n);
    }
    assert.throws(() => validateCollisionOverrides({ shapes: {}, blocks: { a: { shapes: 'nope' } } }), /unknown shape/);
    assert.throws(() => validateCollisionOverrides({ shapes: {}, blocks: { a: { walkThrough: 'all', liquid: true } } }), /cannot be walk-through/);
    assert.throws(() => validateCollisionOverrides({ shapes: {}, blocks: { a: { walkThrough: [16] } } }), /walkThrough/);
});

test('a Block class made before the shapes were applied sees them too', () => {
    const registry = extended(IDS);
    const Block = require('prismarine-block')(registry);
    applyCollisionShapes(registry, MINI_DUMP, { overrides: MINI_DATA });
    assert.deepEqual(blockOf(Block, 'somemod:slab', 8).shapes, TOP);
    assert.equal(blockOf(Block, 'pyrotech:rock').boundingBox, 'empty');
    assert.equal(blockOf(Block, 'somemod:plant', 4).boundingBox, 'block');
});

test('refuses a registry extendRegistry did not extend', () => {
    assert.throws(() => applyCollisionShapes(require('prismarine-registry')('1.12.2'), MINI_DUMP, { overrides: MINI_DATA }), /not extended/);
});

// prismarine-physics, the bot's own physics: drop a player from y 67 onto a column at x 0, z 0.
function landingY(registry, column) {
    const Block = require('prismarine-block')(registry);
    const { Physics, PlayerState } = require('prismarine-physics');
    const world = {
        getBlock(pos) {
            const id = pos.x === 0 && pos.z === 0 ? column[pos.y] ?? 0 : 0;
            const b = Block.fromStateId(id << 4, 1);
            b.position = pos.clone();
            return b;
        },
    };
    const physics = Physics(registry, world);
    const bot = {
        version: '1.12.2', jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0, inventory: { slots: [] },
        entity: { position: new Vec3(0.5, 67, 0.5), velocity: new Vec3(0, 0, 0), onGround: false, isInWater: false, isInLava: false, isInWeb: false,
            isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false, yaw: 0, pitch: 0, effects: {} },
    };
    const controls = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false };
    for (let i = 0; i < 60; i++) {
        const st = new PlayerState(bot, controls);
        physics.simulatePlayer(st, world).apply(bot);
    }
    assert.ok(bot.entity.onGround, 'landed');
    return bot.entity.position.y;
}

test('mineflayer physics: the bot lands on leaves at +0.5 and falls through a rock pile, not through an unreviewed block', () => {
    const column = { 63: 1, 64: ID['dynamictrees:leaves0'] }; // stone, leaves on top
    assert.equal(landingY(extended(IDS), column), 65, 'before: the leaves were a full cube');
    const { registry } = fixedMini();
    assert.equal(landingY(registry, column), 64.5);
    assert.equal(landingY(registry, { 63: 1, 64: ID['pyrotech:rock'] }), 64, 'a rock pile has no box');
    assert.equal(landingY(registry, { 63: 1, 64: ID['somemod:unreviewed'] }), 65, 'an unreviewed block without a box stays solid');
});

test('the real 3.3.4 dump and data: molten metal, spikes and a modded portal non-walkable; rock piles and BOP grass walk-through, poison ivy not', (t) => {
    const pack = loadRotnData('3.3.4');
    if (!pack.hasDump) return t.skip('no dump');
    const dumped = pack.dump.blocks.blocks;
    const data = validateCollisionOverrides(loadCollisionOverrides());
    for (const name of Object.keys(data.blocks)) assert.ok(dumped[name], `${name} is in the dump`);
    const modded = Object.keys(dumped).filter((n) => !n.startsWith('minecraft:'));
    const registry = extended([['minecraft:air', 0], ...modded.map((n, i) => [n, 4000 + i])]);
    const report = applyCollisionShapes(registry, dumped);
    assert.equal(report.fromDump + report.shapes.dynamicLeaves + report.noDumpData, modded.length);
    assert.equal(report.liquid, data.counts.blocks.liquid);
    assert.equal(report.walkThroughBlocks + report.walkThroughSomeStates, data.counts.blocks.walkThrough);
    const Block = require('prismarine-block')(registry);
    const byName = (n, meta = 0) => Block.fromStateId((registry.blocksByName[n].id << 4) | meta, 1);
    const cases = [
        ['contenttweaker:bronze_molten', 0, false, 'lava'], ['minetraps:spikes', 0, false, 'trap'], ['netherex:nether_portal', 0, false, 'portal'],
        ['aether_legacy:aether_portal', 0, false, 'portal'], ['minetraps:bear_trap', 0, false, 'trap'], ['netherex:blue_fire', 0, false, 'fire'],
        ['dungeontactics:wither_web', 0, false, 'web'], ['biomesoplenty:poison', 0, false, 'trap'],
        ['pyrotech:rock', 0, true, undefined], ['pyrotech_compat:rock_igneous', 3, true, undefined],
        ['biomesoplenty:plant_0', 0, true, undefined], ['biomesoplenty:plant_0', 4, false, 'trap'], // shortgrass, poison ivy
        ['biomesoplenty:flower_0', 2, false, 'trap'], ['biomesoplenty:flower_0', 15, false, 'fire'], ['biomesoplenty:flower_0', 0, true, undefined],
        ['biomesoplenty:waterlily', 0, false, undefined], // its class adds a box the dump did not see
    ];
    const movements = movementsOver(registry, Block, (p) => byName(cases[p.x][0], cases[p.x][1]));
    cases.forEach(([n, meta, walk, hazard], x) => {
        assert.equal(movements.getBlock(new Vec3(x, 64, 0), 0, 0, 0).safe, walk, `${n}:${meta} walk-through`);
        assert.equal(registry.blocksByStateId[(registry.blocksByName[n].id << 4) | meta].forge.hazard, hazard, `${n}:${meta} hazard`);
    });
    assert.equal(registry.blocksByName['contenttweaker:bronze_molten'].liquid, true);
    assert.deepEqual(byName('dynamictrees:leaves0').shapes, [DYNAMIC_LEAVES_BOX]);
    assert.deepEqual(byName('dynamictreesbop:leaves_palm').shapes, [DYNAMIC_LEAVES_BOX]);
});
