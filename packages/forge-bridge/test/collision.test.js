// src/collision.js: modded blocks get rotn-data's dumped collision, with the exceptions in
// data/collision-overrides-3.3.4.json (#256 review question: Dynamic Trees leaves were a full cube
// to the bot; players collide with a half-height box). Offline: real prismarine-registry,
// prismarine-block and prismarine-physics for 1.12.2, the committed dump and a javap fixture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { RegistrySnapshot } from '../src/registries.js';
import { extendRegistry } from '../src/registry-extension.js';
import { applyCollisionShapes, shapesFromDump, loadCollisionOverrides, DYNAMIC_LEAVES_BOX } from '../src/collision.js';
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
    'biomesoplenty:waterlily': { defaultMeta: 0, states: [state(0, [])] },
    'somemod:slab': { defaultMeta: 0, states: [state(0, BOTTOM), state(8, TOP)] },
    'somemod:gate': { defaultMeta: 0, states: [state(0, [[0, 0, 0.375, 1, 1.5, 0.625]]), state(4, [])] },
    'somemod:broken': { defaultMeta: 0, states: [state(0, [[0, 0, 0, 1, NaN, 1]])] },
};
const IDS = [['minecraft:air', 0], ['minecraft:stone', 1], ['pyrotech:rock', 4001], ['dynamictrees:leaves0', 4002],
    ['biomesoplenty:waterlily', 4003], ['somemod:slab', 4004], ['somemod:gate', 4005], ['somemod:broken', 4006], ['somemod:nodata', 4007]];

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

test('shapesFromDump: one shape, per-state shapes by metadata, or null for missing or malformed data', () => {
    assert.deepEqual(shapesFromDump(MINI_DUMP['pyrotech:rock']), { shapes: [] });
    const slab = shapesFromDump(MINI_DUMP['somemod:slab']);
    assert.deepEqual(slab.shapes, BOTTOM);
    assert.equal(slab.stateShapes.length, 16);
    assert.deepEqual(slab.stateShapes[8], TOP);
    assert.deepEqual(slab.stateShapes[3], BOTTOM, 'a meta with no state takes the default state\'s shape');
    assert.equal(shapesFromDump(MINI_DUMP['somemod:broken']), null);
    assert.equal(shapesFromDump({ defaultMeta: 0, states: [{ meta: 0 }] }), null, 'collision unknown');
    assert.equal(shapesFromDump({ defaultMeta: 0, states: [] }), null);
    assert.equal(shapesFromDump(undefined), null);
});

test('applyCollisionShapes: rock piles walk-through, leaves half height, overrides kept solid, per-state slabs; vanilla untouched', () => {
    const registry = extended(IDS);
    const logs = [];
    const report = applyCollisionShapes(registry, MINI_DUMP, { log: (m) => logs.push(m) });
    assert.deepEqual(report, { fromDump: 3, perState: 2, walkThrough: 1, overridden: { dynamicLeaves: 1, fullCube: 1 }, noDumpData: 2, unchanged: 1 });
    assert.match(logs[0], /^collision shapes: 3 modded blocks from the dump \(2 per state, 1 walk-through\), overridden: 1 dynamicLeaves, 1 fullCube; 2 without dump data keep a full cube$/);

    const Block = require('prismarine-block')(registry); // a Block class made after (uses the shape table)
    const at = (id, meta) => Block.fromStateId((id << 4) | meta, 1);
    const rock = at(4001, 6);
    assert.equal(rock.boundingBox, 'empty');
    assert.deepEqual(rock.shapes, []);
    const leaves = at(4002, 0);
    assert.equal(leaves.boundingBox, 'block');
    assert.deepEqual(leaves.shapes, [DYNAMIC_LEAVES_BOX]);
    assert.equal(registry.blocksByName['dynamictrees:leaves0'].forge.collision, 'dynamicLeaves');
    assert.deepEqual(at(4003, 0).shapes, FULL, 'the lily pad: the dump has no box, the class adds one');
    assert.deepEqual(at(4004, 0).shapes, BOTTOM);
    assert.deepEqual(at(4004, 8).shapes, TOP, 'a top slab is not a bottom slab');
    const gate = at(4005, 4);
    assert.deepEqual(gate.shapes, [], 'the open state has no box');
    assert.equal(gate.boundingBox, 'block', 'but one state collides, so the block is never treated as walk-through');
    assert.deepEqual(at(4006, 0).shapes, FULL, 'malformed dump data keeps the default');
    assert.deepEqual(at(4007, 0).shapes, FULL, 'no dump data keeps the default');
    assert.equal(at(1, 0).name, 'stone');
    assert.deepEqual(at(1, 0).shapes, FULL);
    assert.equal(registry.blocksByName.stone.forge, undefined, 'vanilla entries are not touched');
});

test('a Block class made before the shapes were applied sees them too', () => {
    const registry = extended(IDS);
    const Block = require('prismarine-block')(registry);
    applyCollisionShapes(registry, MINI_DUMP);
    assert.deepEqual(Block.fromStateId((4004 << 4) | 8, 1).shapes, TOP);
    assert.equal(Block.fromStateId((4001 << 4) | 0, 1).boundingBox, 'empty');
});

test('refuses a registry extendRegistry did not extend', () => {
    assert.throws(() => applyCollisionShapes(require('prismarine-registry')('1.12.2'), MINI_DUMP), /not extended/);
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

test('mineflayer physics: the bot lands on leaves at +0.5 and falls through a rock pile onto the stone under it', () => {
    const column = { 63: 1, 64: 4002 }; // stone, leaves on top
    assert.equal(landingY(extended(IDS), column), 65, 'before: the leaves were a full cube');
    const fixed = extended(IDS);
    applyCollisionShapes(fixed, MINI_DUMP);
    assert.equal(landingY(fixed, column), 64.5);
    assert.equal(landingY(fixed, { 63: 1, 64: 4001 }), 64, 'a rock pile has no box');
    assert.equal(landingY(fixed, { 63: 1, 64: 4003 }), 65, 'the lily pad stays solid');
});

test('the real 3.3.4 dump: every modded block is covered, the overrides name dumped blocks, and the known cases come out right', (t) => {
    const pack = loadRotnData('3.3.4');
    if (!pack.hasDump) return t.skip('no dump');
    const dumped = pack.dump.blocks.blocks;
    const data = loadCollisionOverrides();
    for (const [name, o] of Object.entries(data.blocks)) {
        assert.ok(dumped[name], `${name} is in the dump`);
        assert.ok(data.shapes[o.use], `${name}: shape '${o.use}' exists`);
    }
    const leavesClasses = new Set(Object.values(data.blocks).filter((o) => o.use === 'dynamicLeaves').map((o) => o.class));
    for (const [name, b] of Object.entries(dumped)) {
        if (leavesClasses.has(b.class)) assert.equal(data.blocks[name]?.use, 'dynamicLeaves', `${name} (${b.class})`);
    }
    const modded = Object.keys(dumped).filter((n) => !n.startsWith('minecraft:'));
    const registry = extended([['minecraft:air', 0], ...modded.map((n, i) => [n, 4000 + i])]);
    const report = applyCollisionShapes(registry, dumped);
    const counts = {};
    for (const o of Object.values(data.blocks)) counts[o.use] = (counts[o.use] ?? 0) + 1;
    assert.deepEqual(report.overridden, counts);
    assert.equal(report.fromDump + report.noDumpData + Object.values(counts).reduce((a, n) => a + n, 0), modded.length);
    assert.equal(report.noDumpData, modded.filter((n) => !dumped[n].states?.length).length);
    const Block = require('prismarine-block')(registry);
    const byName = (n, meta = 0) => Block.fromStateId((registry.blocksByName[n].id << 4) | meta, 1);
    assert.equal(byName('pyrotech:rock').boundingBox, 'empty');
    assert.deepEqual(byName('dynamictrees:leaves0').shapes, [DYNAMIC_LEAVES_BOX]);
    assert.deepEqual(byName('dynamictreesbop:leaves_palm').shapes, [DYNAMIC_LEAVES_BOX]);
    assert.deepEqual(byName('biomesoplenty:waterlily').shapes, FULL);
});
