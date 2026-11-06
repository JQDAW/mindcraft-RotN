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
import { applyCollisionShapes, dumpShapesByMeta, validateCollisionOverrides, loadCollisionOverrides, hazardBlockIds, partialHazardBlockIds, liquidBlockIds, stateHazard, DYNAMIC_LEAVES_BOX } from '../src/collision.js';
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
// The mini fixture runs applyCollisionShapes without playerCollision, on the dumped `collision` only, and
// gives the leaves the generic `shapes` override. initBot no longer takes either path on 3.3.4 (#279: it
// passes rotn-data's playerCollision, and the leaves box comes from that data), but both stay supported:
// the fallback for a dump without player data, and an override for a box a later dump might miss. The
// #269 tests below and the real-dump test cover the 3.3.4 path.
const MINI_DUMP = {
    'pyrotech:rock': { defaultMeta: 0, states: [state(0, []), state(6, [])] },
    'dynamictrees:leaves0': { defaultMeta: 0, states: [state(0, FULL)] }, // getCollisionBoundingBox's full cube
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
    // Since #269 the box comes from rotn-data's playerCollision; the overrides tool checks every leaves state against it.
    assert.deepEqual(data.checks.dynamicLeaves.shapes, [DYNAMIC_LEAVES_BOX], 'the pack config selects the box (isLeavesPassable=false, vanillaLeavesCollision=false)');
    assert.equal(data.counts.dynamicLeavesChecked, 26);
    assert.equal(data.shapes, undefined, 'no shape override is needed any more');
    assert.match(data.checks.dynamicLeaves.evidence, /isLeavesPassable=false \(line 60\), vanillaLeavesCollision=false \(line 66\), mod passableleaves not in the pack/);
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

// rotn-data's playerCollision shape: (regName, meta) => { boxes, varies } (RotnData.playerCollision).
const LILY = [[0.0625, 0, 0.0625, 0.9375, 0.09375, 0.9375]];
const STAIRS = [[0, 0, 0, 1, 0.5, 1], [0.5, 0.5, 0, 1, 1, 1]];
const PLAYER = {
    'somemod:lily': { 0: { boxes: LILY, varies: false } },
    'somemod:stairs': { 0: { boxes: STAIRS, varies: false } },
    'somemod:fence': { 0: { boxes: [[0.375, 0, 0.375, 0.625, 1.5, 0.625]], varies: true } },
    'somemod:branch': { 0: { boxes: [[0.4375, 0.4375, 0.4375, 0.5625, 0.5625, 0.5625]], varies: true } },
    'somemod:pane': { 0: { boxes: [], varies: true } },
    'somemod:grass': { 0: { boxes: [], varies: false } },
    'somemod:plantgrass': { 0: { boxes: [], varies: false } },
    'somemod:odd': { 0: { boxes: [[0, 0, 0, 1, 'x', 1]], varies: false } },
    'somemod:shell': { 0: { boxes: [[0, 0, 0, 0, 0, 0]], varies: false } }, // a Dynamic Trees trunk shell: a point
    'somemod:tube': { 0: { boxes: [[0.2, 0.8, 0.2, 0.8, 0.8, 0.8]], varies: false } }, // a Rats tube: a plane
    'somemod:cage': { 0: { boxes: [[0, 0, 0, 1, 0.5, 1], [0, 1, 0, 1, 1, 1]], varies: false } }, // a plane beside a real box
    'somemod:thick': { 0: { boxes: [[-1, 0, -1, 2, 1, 2]], varies: false } }, // a radius-24 trunk reaches into its 8 neighbours
    'somemod:bridge': { 0: { boxes: [[-0.625, 0, 0, 1.625, 0.25, 1]], varies: false } }, // a bridge deck overhangs plain air
    'dynamictrees:leaves0': { 0: { boxes: [DYNAMIC_LEAVES_BOX], varies: false } },
};
const playerCollision = (name, meta) => PLAYER[name]?.[meta] ?? null;

test('#269: dumpShapesByMeta takes what a player collides with; a neighbour-dependent state gets one full-width box', () => {
    const shape = (name, collision) => dumpShapesByMeta({ defaultMeta: 0, states: [state(0, collision)] }, { name, playerCollision });
    assert.deepEqual(shape('somemod:lily', []).shapes[0], LILY, 'a box the dumped collision did not have');
    assert.deepEqual(shape('somemod:stairs', FULL).shapes[0], STAIRS, 'several boxes');
    assert.deepEqual(shape('somemod:grass', [[0.25, 0, 0.25, 0.75, 0.625, 0.75]]).shapes[0], [], 'no player box');
    assert.deepEqual(shape('somemod:fence', FULL).shapes[0], [[0, 0, 0, 1, 1.5, 1]], 'a fence: full width, as tall as its post');
    assert.deepEqual(shape('somemod:branch', [[0.4375, 0.4375, 0.4375, 0.5625, 0.5625, 0.5625]]).shapes[0], FULL, 'a branch core: at least a full cube');
    assert.deepEqual(shape('somemod:pane', []).shapes[0], FULL, 'no box seen, but neighbours matter: solid');
    assert.deepEqual(shape('somemod:odd', BOTTOM).shapes[0], BOTTOM, 'malformed player data keeps the dumped collision');
    assert.deepEqual(shape('somemod:unknown', TOP).shapes[0], TOP, 'no player data keeps the dumped collision');
    assert.deepEqual(shape('somemod:fence', FULL).sources, { player: 0, varies: 1, collision: 0 });
    assert.deepEqual(shape('somemod:stairs', FULL).sources, { player: 1, varies: 0, collision: 0 });
    // Boxes with no volume: the real shape comes from elsewhere (the trunk next to a shell, a tube's tile entity).
    assert.deepEqual(shape('somemod:shell', [[0, 0, 0, 0, 0, 0]]).shapes[0], FULL, 'a point: a full cube');
    assert.deepEqual(shape('somemod:tube', [[0.2, 0.2, 0.2, 0.8, 0.8, 0.8]]).shapes[0], FULL, 'a plane: a full cube');
    assert.deepEqual(shape('somemod:shell', []).sources, { player: 0, varies: 1, collision: 0 });
    assert.deepEqual(shape('somemod:cage', FULL).shapes[0], [[0, 0, 0, 1, 0.5, 1], [0, 1, 0, 1, 1, 1]], 'a plane beside a real box is kept');
});

test('#269: applyCollisionShapes with playerCollision: lily pads and stairs as a player meets them, leaves from the data, opt-in walk-through kept', () => {
    const names = ['somemod:lily', 'somemod:stairs', 'somemod:fence', 'somemod:grass', 'somemod:plantgrass', 'dynamictrees:leaves0'];
    const registry = extended([['minecraft:air', 0], ['minecraft:stone', 1], ...names.map((n, i) => [n, 5001 + i])]);
    const dump = Object.fromEntries(names.map((n) => [n, { defaultMeta: 0, states: [state(0, n === 'somemod:lily' ? [] : FULL)] }]));
    const data = { blocks: { 'somemod:plantgrass': { walkThrough: 'all' } } };
    const report = applyCollisionShapes(registry, dump, { overrides: data, playerCollision });
    assert.deepEqual(report.states, { player: 5, varies: 1, collision: 0 });
    const Block = require('prismarine-block')(registry);
    const idOf = (n) => registry.blocksByName[n].id;
    const at = (n) => Block.fromStateId(idOf(n) << 4, 1);
    assert.deepEqual(at('somemod:lily').shapes, LILY, 'not a full cube any more');
    assert.deepEqual(at('somemod:stairs').shapes, STAIRS);
    assert.deepEqual(at('somemod:fence').shapes, [[0, 0, 0, 1, 1.5, 1]]);
    assert.deepEqual(at('somemod:grass').shapes, FULL, 'no player box, not reviewed: stays a solid full cube');
    assert.equal(at('somemod:plantgrass').boundingBox, 'empty', 'reviewed: walk-through');
    assert.deepEqual(at('dynamictrees:leaves0').shapes, [DYNAMIC_LEAVES_BOX], 'from the data, no shape override');
    assert.equal(landingY(registry, { 63: 1, 64: idOf('somemod:lily') }), 64.09375, 'the bot stands on the lily pad');
    assert.equal(landingY(registry, { 63: 1, 64: idOf('somemod:fence') }), 65.5, 'and on top of a fence');
    assert.equal(landingY(registry, { 63: 1, 64: idOf('somemod:plantgrass') }), 64, 'and falls through reviewed grass');
});

test('#279 nit: a thick trunk reaching into its neighbours: the shells around it are solid to the pathfinder and physics; an overhang into air is not seen', () => {
    const names = ['somemod:thick', 'somemod:shell', 'somemod:bridge'];
    const registry = extended([['minecraft:air', 0], ['minecraft:stone', 1], ...names.map((n, i) => [n, 5101 + i])]);
    const dump = Object.fromEntries(names.map((n) => [n, { defaultMeta: 0, states: [state(0, PLAYER[n][0].boxes)] }]));
    applyCollisionShapes(registry, dump, { overrides: { blocks: {} }, playerCollision });
    const Block = require('prismarine-block')(registry);
    const idOf = (n) => registry.blocksByName[n].id;
    assert.deepEqual(Block.fromStateId(idOf('somemod:thick') << 4, 1).shapes, [[-1, 0, -1, 2, 1, 2]], 'the trunk keeps its overhanging box');
    // A trunk at x 0, z 0, y 64 with its 8 shells, on stone at y 63.
    const tree = (p) => (p.y === 63 ? 1 : p.y === 64 && Math.abs(p.x) <= 1 && Math.abs(p.z) <= 1 ? idOf(p.x === 0 && p.z === 0 ? 'somemod:thick' : 'somemod:shell') : 0);
    const movements = movementsOver(registry, Block, (p) => Block.fromStateId(tree(p) << 4, 1));
    for (const [x, z] of [[1, 0], [-1, 1], [0, -1]]) {
        const b = movements.getBlock(new Vec3(x, 64, z), 0, 0, 0);
        assert.equal(b.safe, false, `shell ${x},${z}: not walked into`);
        assert.equal(b.physical, true, `shell ${x},${z}: stood on`);
        assert.equal(b.height, 65, `shell ${x},${z}: its top is the trunk's`);
    }
    assert.equal(movements.getBlock(new Vec3(2, 64, 0), 0, 0, 0).safe, true, 'beyond the shells: air');
    assert.equal(landingAt(registry, tree, 1.5, 0.5), 65, 'physics: the bot lands on a shell at the trunk\'s top');
    // Known limit: an overhang into a plain air cell (a bridge deck at x 0) is seen only from its own cell.
    const bridge = (p) => (p.y === 63 ? 1 : p.y === 64 && p.x === 0 && p.z === 0 ? idOf('somemod:bridge') : 0);
    const mb = movementsOver(registry, Block, (p) => Block.fromStateId(bridge(p) << 4, 1));
    assert.equal(mb.getBlock(new Vec3(-1, 64, 0), 0, 0, 0).safe, true, 'the cell under the overhang is air to the pathfinder');
    assert.equal(landingAt(registry, bridge, -0.6, 0.5), 64, 'physics: a bot wholly in the next cell falls past the overhang');
    assert.equal(landingAt(registry, bridge, 0.5, 0.5), 64.25, 'and lands on the deck in its own cell');
});

test('walk-through is opt-in: reviewed rock piles and plant states only; an unreviewed state without a box is a solid full cube', () => {
    const { registry, report, Block } = fixedMini();
    assert.deepEqual(report, { fromDump: 8, noDumpData: 2, walkThroughBlocks: 1, walkThroughSomeStates: 1, perStateEntries: 15, liquid: 1, hazard: { lava: 1, trap: 2, portal: 1, fire: 1 }, shapes: { dynamicLeaves: 1 }, states: { player: 0, varies: 0, collision: 12 } }); // no playerCollision: every state from `collision`, but leaves0 (its `shapes` override)
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
    assert.equal(registry.blocksByName['somemod:plant'].forge.hazard, 'trap', 'the block entry is a hazard when any state is (an avoid list by id)');
    assert.deepEqual(registry.blocksByName['somemod:plant'].forge.hazardByMeta, { 4: 'trap' });
    assert.equal(registry.blocksByStateId[(ID['somemod:plant'] << 4) | 7].forge.hazard, undefined, 'a harmless state keeps no hazard');
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

test('hazardBlockIds (whole-block by default), partialHazardBlockIds, liquidBlockIds and stateHazard', () => {
    const { registry, Block } = fixedMini();
    const id = (n) => ID[n];
    // The default is the set for Movements.blocksToAvoid: whole-block hazards only; the partial plant goes through stateHazard.
    assert.deepEqual([...hazardBlockIds(registry)].sort(), ['somemod:molten_bronze', 'somemod:spikes', 'somemod:portal', 'somemod:nodata'].map(id).sort());
    assert.deepEqual([...hazardBlockIds(registry, { kinds: ['portal', 'fire'] })].sort(), [id('somemod:portal'), id('somemod:nodata')].sort());
    assert.ok(!hazardBlockIds(registry, { kinds: ['trap'] }).has(id('somemod:plant')), 'a partial hazard is not in the default set');
    assert.deepEqual([...hazardBlockIds(registry, { includePartial: true })].sort(), ['somemod:molten_bronze', 'somemod:spikes', 'somemod:portal', 'somemod:plant', 'somemod:nodata'].map(id).sort(), 'only on explicit request');
    assert.deepEqual([...partialHazardBlockIds(registry)], [id('somemod:plant')]);
    assert.deepEqual([...partialHazardBlockIds(registry, { kinds: ['fire'] })], []);
    assert.deepEqual([...liquidBlockIds(registry)], [id('somemod:molten_bronze')]);
    assert.equal(stateHazard(registry, blockOf(Block, 'somemod:plant', 4)), 'trap');
    assert.equal(stateHazard(registry, blockOf(Block, 'somemod:plant', 0)), null);
    assert.equal(stateHazard(registry, (id('somemod:portal') << 4)), 'portal');
    assert.equal(stateHazard(registry, { type: id('somemod:spikes'), metadata: 0 }), 'trap');
    assert.equal(stateHazard(registry, blockOf(Block, 'minecraft:stone')), null);
    assert.equal(stateHazard(registry, undefined), null);
});

test('#263: a hazardByMeta that covers every state (or a block without dump states) is a whole-block hazard', () => {
    const ids = [['minecraft:air', 0], ['somemod:allbad', 4001], ['somemod:nostates', 4002], ['somemod:somebad', 4003]];
    const registry = extended(ids);
    const dump = {
        'somemod:allbad': { defaultMeta: 0, states: [state(0, FULL), state(1, FULL)] },
        'somemod:somebad': { defaultMeta: 0, states: [state(0, FULL), state(1, FULL)] },
    };
    const data = { shapes: {}, blocks: {
        'somemod:allbad': { hazardByMeta: { 0: 'trap', 1: 'fire' } },
        'somemod:nostates': { hazardByMeta: { 3: 'trap' } },
        'somemod:somebad': { hazardByMeta: { 1: 'fire' } },
    } };
    applyCollisionShapes(registry, dump, { overrides: data });
    const all = registry.blocksByName['somemod:allbad'].forge;
    assert.equal(all.hazardByMeta, undefined, 'every state harms: not partial');
    assert.equal(all.hazard, 'trap');
    assert.deepEqual(all.hazardKinds, ['trap', 'fire']);
    assert.equal(registry.blocksByName['somemod:nostates'].forge.hazardByMeta, undefined, 'states unknown: the safe side');
    assert.deepEqual(registry.blocksByName['somemod:somebad'].forge.hazardByMeta, { 1: 'fire' });
    assert.deepEqual([...hazardBlockIds(registry)].sort(), [4001, 4002], 'both whole-block hazards are in the blocksToAvoid set');
    assert.deepEqual([...hazardBlockIds(registry, { kinds: ['fire'] })], [4001], 'a whole-block hazard is found by any of its states\' kinds');
    assert.deepEqual([...partialHazardBlockIds(registry)], [4003]);
    assert.equal(stateHazard(registry, (4001 << 4) | 1), 'fire', 'per state, each state\'s own kind');
    assert.equal(stateHazard(registry, (4002 << 4) | 7), 'trap');
    assert.equal(stateHazard(registry, (4003 << 4) | 0), null);
});

test('a bad override fails before anything changes: every modded block stays a full cube', () => {
    const registry = extended(IDS);
    const bad = { ...MINI_DATA, blocks: { ...MINI_DATA.blocks, 'zzz:last': { hazard: 'lava-ish' } } };
    const table = registry.blockCollisionShapes;
    assert.throws(() => applyCollisionShapes(registry, MINI_DUMP, { overrides: bad }), /unknown hazard 'lava-ish'/);
    assert.equal(registry.blockCollisionShapes, table, 'the shape table is not replaced');
    const Block = require('prismarine-block')(registry);
    for (const n of NAMES) {
        const b = blockOf(Block, n);
        assert.deepEqual([b.boundingBox, b.shapes], ['block', FULL], n);
        assert.equal(registry.blocksByName[n].forge.collision, undefined, n);
    }
    assert.throws(() => validateCollisionOverrides({ shapes: {}, blocks: { a: { shapes: 'nope' } } }), /unknown shape/);
    assert.throws(() => validateCollisionOverrides({ shapes: {}, blocks: { a: { walkThrough: 'all', liquid: true } } }), /cannot be walk-through/);
    assert.throws(() => validateCollisionOverrides({ shapes: {}, blocks: { a: { walkThrough: [16] } } }), /walkThrough/);
    assert.throws(() => validateCollisionOverrides({ shapes: {}, blocks: { a: { hazard: 'trap', hazardByMeta: { 4: 'trap' } } } }), /together/);
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
    return landingAt(registry, (p) => (p.x === 0 && p.z === 0 ? column[p.y] ?? 0 : 0), 0.5, 0.5);
}

// Drop a player from y 67 at x, z into a world given as (pos) => block id (meta 0).
function landingAt(registry, idAt, x, z) {
    const Block = require('prismarine-block')(registry);
    const { Physics, PlayerState } = require('prismarine-physics');
    const world = {
        getBlock(pos) {
            const b = Block.fromStateId(idAt(pos) << 4, 1);
            b.position = pos.clone();
            return b;
        },
    };
    const physics = Physics(registry, world);
    const bot = {
        version: '1.12.2', jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0, inventory: { slots: [] },
        entity: { position: new Vec3(x, 67, z), velocity: new Vec3(0, 0, 0), onGround: false, isInWater: false, isInLava: false, isInWeb: false,
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
    const report = applyCollisionShapes(registry, dumped, { playerCollision: (name, meta) => pack.playerCollision({ name, metadata: meta }) });
    assert.equal(report.fromDump + report.noDumpData, modded.length);
    assert.deepEqual(report.shapes, {}, 'no shape overrides: every box is from the data');
    assert.equal(report.states.collision, 0, 'every dumped state has player data');
    assert.ok(report.states.varies > 300, JSON.stringify(report.states));
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
        ['biomesoplenty:waterlily', 0, true, undefined], // #269: a box 0.09375 high, a carpet to the pathfinder (under 0.1)
        // The allowlist after #279: rails, signs, torches, buttons, levers; never pressure plates.
        ['betterwithaddons:rail_rusted', 0, true, undefined], ['betterwithmods:detector_rail_stone', 0, true, undefined],
        ['aether_legacy:skyroot_standing_sign', 0, true, undefined], ['harvestcraft:candledeco1', 0, true, undefined],
        ['quark:iron_button', 0, true, undefined], ['twilightforest:canopy_button', 0, true, undefined], ['aether_legacy:aether_lever', 0, true, undefined],
        ['aether_legacy:skyroot_pressure_plate', 0, false, undefined], ['betternether:bone_plate', 0, false, undefined],
        ['pyrotech:torch_fiber', 0, false, 'trap'], // a burning torch that sets entities on fire
        ['dynamictrees:trunkshell', 0, false, undefined], // a point box: a full cube
    ];
    const movements = movementsOver(registry, Block, (p) => byName(cases[p.x][0], cases[p.x][1]));
    cases.forEach(([n, meta, walk, hazard], x) => {
        assert.equal(movements.getBlock(new Vec3(x, 64, 0), 0, 0, 0).safe, walk, `${n}:${meta} walk-through`);
        assert.equal(registry.blocksByStateId[(registry.blocksByName[n].id << 4) | meta].forge.hazard, hazard, `${n}:${meta} hazard`);
    });
    assert.equal(registry.blocksByName['contenttweaker:bronze_molten'].liquid, true);
    const partialTraps = hazardBlockIds(registry, { kinds: ['trap'], includePartial: true });
    assert.ok(partialTraps.has(registry.blocksByName['biomesoplenty:plant_0'].id), 'with includePartial, poison ivy makes plant_0 a trap block (a partial one)');
    assert.ok(hazardBlockIds(registry, { kinds: ['fire'], includePartial: true }).has(registry.blocksByName['biomesoplenty:flower_0'].id), 'burning blossom, partial');
    const whole = hazardBlockIds(registry);
    const idOf = (n) => registry.blocksByName[n].id;
    for (const n of ['biomesoplenty:plant_0', 'biomesoplenty:plant_1', 'biomesoplenty:flower_0']) {
        assert.ok(!whole.has(idOf(n)), `${n}: partial, not for blocksToAvoid (it would avoid the harmless grass)`);
        assert.ok(partialHazardBlockIds(registry).has(idOf(n)), n);
    }
    for (const n of ['minetraps:spikes', 'netherex:nether_portal', 'contenttweaker:bronze_molten', 'dungeontactics:wither_web']) assert.ok(whole.has(idOf(n)), n);
    assert.equal(partialHazardBlockIds(registry).size, 3, 'only the reviewed per-variant BOP blocks are partial');
    assert.ok(liquidBlockIds(registry).has(registry.blocksByName['contenttweaker:bronze_molten'].id));
    assert.equal(liquidBlockIds(registry).size, data.counts.blocks.liquid);
    assert.deepEqual(byName('dynamictrees:leaves0').shapes, [DYNAMIC_LEAVES_BOX]);
    assert.deepEqual(byName('dynamictreesbop:leaves_palm').shapes, [DYNAMIC_LEAVES_BOX]);
    // #269: what a player collides with.
    assert.deepEqual(byName('biomesoplenty:waterlily').shapes, [[0.0625, 0, 0.0625, 0.9375, 0.09375, 0.9375]]);
    assert.deepEqual(byName('biomesoplenty:sacred_oak_stairs').shapes, [[0, 0, 0, 1, 0.5, 1], [0.5, 0.5, 0, 1, 1, 1]], 'stairs: two boxes, not a cube');
    assert.deepEqual(byName('biomesoplenty:cherry_fence').shapes, [[0, 0, 0, 1, 1.5, 1]], 'a fence: neighbour-dependent, full width, 1.5 high');
    assert.deepEqual(byName('quark:bark_acacia_wall').shapes, [[0, 0, 0, 1, 1.5, 1]]);
    assert.deepEqual(byName('dynamictrees:oakbranch').shapes, FULL, 'a thin branch: its arms reach the neighbours, so a full cube');
    assert.deepEqual(byName('contenttweaker:cave_grass').shapes, FULL, 'no player box but not reviewed: solid');
    assert.deepEqual(byName('dynamictrees:trunkshell').shapes, FULL, 'a shell: solid, its box is the trunk\'s');
    assert.deepEqual(byName('rats:rat_tube_red').shapes, FULL, 'a tube: solid, its box comes from its tile entity');
    assert.deepEqual(data.counts.utilityWalkThrough, { lever: 1, torch: 25, button: 41, sign: 2, rail: 4 });
    assert.deepEqual(data.counts.neverWalkThrough, { 'net.minecraft.block.BlockBasePressurePlate': 24 });
    for (const [n, o] of Object.entries(data.blocks)) {
        if (o.walkThrough) assert.ok(!/PressurePlate|TripWire/.test(o.rules.join(' ') + o.class), `${n}: never a pressure plate or tripwire`);
    }
});
