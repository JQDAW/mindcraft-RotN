// src/dig-time.js: dig times by the Forge 1.12.2 server's rule from rotn-data's dump (#593 review).
// mineflayer's bot.dig, pathfinder's dig costs and bestHarvestTool read Block.digTime, which knew
// only vanilla item ids: a pyrotech:flint_pickaxe on stone waited 7.5 s instead of 0.6 s.
// Real 1.12.2 prismarine-registry, prismarine-block, prismarine-chunk, mineflayer's digging plugin,
// mineflayer-pathfinder and the real rotn-data 3.3.4 dump. Offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { forgeDigTime, pickState, dumpDigSources, believableZero, installDigTime, attachDigTime, originalDigTime, TICK_MS } from '../src/dig-time.js';
import * as rotnData from '../../rotn-data/index.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const rd = rotnData.loadRotnData(rotnData.PACK_VERSION);

const FLINT_PICKAXE = 4500; // a modded item id, as extendRegistry would add it

/** A fresh 1.12.2 registry with pyrotech:flint_pickaxe added (prismarine-registry copies shallowly). */
function registryWithFlint() {
    const registry = require('prismarine-registry')('1.12.2');
    const flint = { id: FLINT_PICKAXE, name: 'pyrotech:flint_pickaxe', displayName: 'Flint Pickaxe', stackSize: 1, registryName: 'pyrotech:flint_pickaxe' };
    registry.items = { ...registry.items, [FLINT_PICKAXE]: flint };
    registry.itemsByName = { ...registry.itemsByName, 'pyrotech:flint_pickaxe': flint };
    return registry;
}

const state = (name, meta = 0) => pickState(rd.getBlock(name), meta);
const toolData = (name) => { const it = rd.getItem(name); return { classes: it.toolClasses, speed: it.speed }; };

/** A world column with `blocks` ({x, y, z, name, meta}) on a new prismarine-chunk class for `registry`. */
function column(registry, blocks) {
    const Chunk = require('prismarine-chunk')(registry);
    const c = new Chunk();
    for (const b of blocks) {
        const p = new Vec3(b.x, b.y, b.z);
        c.setBlockType(p, registry.blocksByName[b.name].id);
        if (b.meta) c.setBlockData(p, b.meta);
    }
    const blockAt = (pos) => {
        if (pos.y < 0 || pos.y > 255 || pos.x < 0 || pos.x > 15 || pos.z < 0 || pos.z > 15) return null;
        const b = c.getBlock(new Vec3(pos.x, pos.y, pos.z));
        b.position = new Vec3(pos.x, pos.y, pos.z);
        return b;
    };
    return { chunk: c, blockAt };
}

/** A fake mineflayer bot over one column, with the Forge rule attached and the column loaded. */
function fakeBot(registry, blocks, { inventory = [], logs = [] } = {}) {
    const world = column(registry, blocks);
    const bot = new EventEmitter();
    bot.registry = registry;
    bot.blockAt = world.blockAt;
    bot.entity = { position: new Vec3(8.5, 65, 8.5), onGround: true, effects: {}, eyeHeight: 1.62, height: 1.8 };
    bot.entities = {};
    bot.game = { gameMode: 'survival' };
    bot.heldItem = null;
    bot.inventory = { slots: [], items: () => inventory };
    bot.getEquipmentDestSlot = () => 5;
    bot.writes = [];
    bot._client = { write: (name, data) => bot.writes.push([name, data]) };
    bot.swingArm = () => {};
    bot.lookAt = async () => {};
    bot._updateBlockState = () => {};
    const report = attachDigTime(bot, dumpDigSources(rd, registry), { log: (m) => logs.push(m) });
    bot.emit('chunkColumnLoad', new Vec3(0, 0, 0));
    return { bot, report, world };
}

test('the rule on the real dump: modded tools at their speed, Tool Progression blocks Infinity', () => {
    const stone = state('minecraft:stone');
    assert.equal(forgeDigTime(stone, toolData('pyrotech:flint_pickaxe')), 600, 'flint pickaxe (pickaxe 1, speed 3.8): 12 ticks');
    assert.equal(forgeDigTime(stone, toolData('minecraft:stone_pickaxe')), 600, 'stone pickaxe (level 0 on RotN, speed 4)');
    assert.equal(forgeDigTime(stone, toolData('minecraft:wooden_pickaxe')), 1150, 'wooden pickaxe: 23 ticks, as vanilla');
    assert.equal(forgeDigTime(stone, null), Infinity, 'the hand on stone: Tool Progression cancels BreakSpeed, the server never breaks it');
    assert.equal(forgeDigTime(stone, toolData('pyrotech:crude_axe')), Infinity, 'an axe has no pickaxe level');
    assert.equal(forgeDigTime(state('minecraft:log'), null), 3000, 'an oak log by hand (needs no tool): 60 ticks');
    assert.equal(forgeDigTime(state('minecraft:log'), toolData('pyrotech:crude_axe')), 1500, 'the crude axe (axe speed 2) on a log: 30 ticks');
    // brick_block: hardness 36 on this pack (2 in vanilla), pickaxe level 1.
    assert.equal(state('minecraft:brick_block').hardness, 36);
    assert.equal(forgeDigTime(state('minecraft:brick_block'), toolData('minecraft:stone_pickaxe')), Infinity, 'level 0 is below the brick\'s level 1');
    assert.equal(forgeDigTime(state('minecraft:brick_block'), toolData('minecraft:iron_pickaxe')), 9050, '6 / 36 / 30 per tick: 181 ticks');
    // Tool required but no harvest tool named (web): Tool Progression does not cancel; Forge falls back to
    // the item's vanilla harvest check (x100 when it fails).
    const web = state('minecraft:web');
    assert.equal(web.harvestTool, null);
    assert.equal(forgeDigTime(web, null), 20000, 'the hand on a web: 1 / 4 / 100 per tick');
    assert.equal(forgeDigTime(web, null, { vanillaSpeed: 15, vanillaCanHarvest: true }), 400, 'a sword or shears on a web (vanilla speed 15)');
});

test('the rule: hardness, modifiers and rounding as prismarine-block computes them', () => {
    const registry = require('prismarine-registry')('1.12.2');
    const st = { hardness: 1.5, harvestTool: 'pickaxe', harvestLevel: 0, toolRequired: true };
    const pick = { classes: { pickaxe: 1 }, speed: { pickaxe: 3.8 } };
    assert.equal(forgeDigTime({ ...st, hardness: -1 }, pick), Infinity, 'unbreakable');
    assert.equal(forgeDigTime({ hardness: 0, toolRequired: false }, null), 0, 'hardness 0: instant, even by hand');
    assert.equal(forgeDigTime({ ...st, hardness: 0 }, null), Infinity, 'hardness 0 but a pickaxe required: the cancelled speed gives 0 / 0, never');
    assert.equal(forgeDigTime({ hardness: null }, pick), null, 'no hardness: the caller keeps prismarine\'s time');
    assert.equal(forgeDigTime(undefined, pick), null);
    assert.equal(forgeDigTime(st, pick, { notOnGround: true }), 3000, 'not on the ground: speed / 5 (60 ticks)');
    assert.equal(forgeDigTime(st, pick, { registry, enchantments: [{ name: 'efficiency', lvl: 2 }] }), 300, 'efficiency II: + 5 (8.8 / 1.5 / 30: 6 ticks)');
    const haste = registry.effectsByName.Haste.id;
    assert.equal(forgeDigTime(st, pick, { registry, effects: { [haste]: { amplifier: 1 } } }), 450, 'haste II: x 1.4 (9 ticks)');
    const fatigue = registry.effectsByName.MiningFatigue.id;
    assert.equal(forgeDigTime(st, pick, { registry, effects: { [fatigue]: { amplifier: 0 } } }), 2000, 'mining fatigue I: x 0.3 (40 ticks)');
    assert.equal(forgeDigTime({ ...st, harvestLevel: 2 }, pick), Infinity, 'level 1 below the block\'s 2');
    assert.equal(forgeDigTime({ ...st, harvestLevel: -1 }, { classes: { pickaxe: 0 }, speed: { pickaxe: 2 } }), 1150, 'a negative harvest level counts as 0');
    assert.equal(forgeDigTime(st, { classes: { pickaxe: 1 } }), 2300, 'a tool with a class but no speed: speed 1, can harvest (x30); 45 ticks, 46 in floating point as prismarine (one tick long is safe)');
    assert.equal(forgeDigTime({ hardness: 2, toolRequired: false, harvestTool: 'axe' }, pick, { vanillaSpeed: 8 }), 3000, 'a tool without the block\'s class: speed 1, not its vanilla table speed');
    assert.equal(forgeDigTime({ hardness: 2, toolRequired: false, harvestTool: 'axe' }, null, { vanillaSpeed: 8 }), 400, 'an item with no tool classes: its vanilla speed (8 ticks)');
    assert.equal(forgeDigTime({ hardness: 0.05, toolRequired: false, harvestTool: 'pickaxe' }, pick), 0, 'one tick breaks it: 0 ms, as prismarine');
    assert.equal(forgeDigTime({ hardness: 0.05, toolRequired: false }, pick), 100, 'no harvest tool: the pickaxe digs at speed 1 (2 ticks)');
    assert.equal(TICK_MS, 50);
});

test('pickState and believableZero: the dump state per metadata; a dumped 0 that is probably a misread is not used', () => {
    assert.equal(pickState(rd.getBlock('minecraft:stone'), 1).props.variant, 'granite');
    assert.equal(pickState(rd.getBlock('minecraft:stone'), 99), null);
    assert.equal(pickState(null, 0), null);
    const registry = require('prismarine-registry')('1.12.2');
    const known = new Set(['minecraft:tnt']);
    const zero = { hardness: 0, solid: true };
    assert.equal(believableZero(zero, 'minecraft:sponge', registry.blocksByName.sponge, known), false, 'sponge: minecraft-data says 0.6');
    assert.equal(believableZero(zero, 'minecraft:tnt', registry.blocksByName.tnt, known), true, 'rotn-data lists tnt as a real 0');
    assert.equal(believableZero({ hardness: 0, solid: false }, 'minecraft:torch', registry.blocksByName.torch, known), true, 'vanilla says 0 too');
    assert.equal(believableZero(zero, 'mod:thing', { forge: { modded: true } }, known), false, 'a solid modded 0');
    assert.equal(believableZero({ hardness: 0, solid: false }, 'mod:plant', { forge: { modded: true } }, known), true, 'a modded plant');
    assert.equal(believableZero({ hardness: 1.5 }, 'mod:thing', null, known), true);
    // Through dumpDigSources: sponge keeps prismarine's time (null state).
    const src = dumpDigSources(rd, registry);
    const Block = require('prismarine-block')(registry);
    assert.equal(src.stateOf(new Block(registry.blocksByName.sponge.id, 0, 0)), null);
    assert.equal(src.stateOf(new Block(registry.blocksByName.stone.id, 0, 1)).props.variant, 'granite');
    assert.equal(src.toolOf(registry.itemsByName.stick.id), null, 'a stick has no tool classes');
    assert.deepEqual(src.toolOf(registry.itemsByName.stone_pickaxe.id), { classes: { pickaxe: 0 }, speed: { pickaxe: 4 } });
});

test('regression: where the dump agrees with minecraft-data, every vanilla tool digs every vanilla block in prismarine\'s time', () => {
    const registry = require('prismarine-registry')('1.12.2');
    const Block = require('prismarine-block')(registry);
    const src = dumpDigSources(rd, registry);
    installDigTime(new Block(1, 0, 0), { ...src, registry });
    const original = originalDigTime(new Block(1, 0, 0));
    assert.equal(typeof original, 'function');
    const names = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe', 'wooden_axe', 'stone_axe', 'iron_axe', 'diamond_axe',
        'wooden_shovel', 'stone_shovel', 'iron_shovel', 'diamond_shovel', 'iron_sword', 'shears', 'stick'];
    const items = [null, ...names.map(n => registry.itemsByName[n].id)];
    let agreed = 0;
    let differ = 0;
    for (const entry of registry.blocksArray) {
        const block = new Block(entry.id, 0, 0);
        const st = src.stateOf(block);
        if (!st || !Number.isFinite(entry.hardness) || Math.abs(entry.hardness - st.hardness) > 1e-9) continue;
        for (const type of items) {
            const tool = type == null ? null : src.toolOf(type);
            const cls = st.harvestTool;
            const level = cls ? tool?.classes?.[cls] : undefined;
            // The dump's harvest answer and speed, as the server sees them ...
            const dumpCan = !st.toolRequired || (cls ? Number.isInteger(level) && level >= Math.max(0, st.harvestLevel ?? 0) : !!block.harvestTools?.[type]);
            const tableSpeed = (type != null && registry.materials[block.material]?.[type]) || 1;
            const dumpSpeed = Number.isInteger(level) && level >= 0 ? (tool.speed?.[cls] ?? 1) : (tool ? 1 : tableSpeed);
            // ... and prismarine's (vanilla tables).
            const vanillaCan = !!block.canHarvest(type);
            if (st.toolRequired && cls && !dumpCan) continue; // Tool Progression: Infinity on purpose
            const ours = block.digTime(type, false, false, false, [], {});
            const theirs = original.call(block, type, false, false, false, [], {});
            if (dumpCan === vanillaCan && dumpSpeed === tableSpeed) {
                assert.equal(ours, theirs, `${entry.name} with ${type == null ? 'the hand' : registry.items[type].name}`);
                agreed++;
            } else differ++;
        }
    }
    assert.ok(agreed > 1500, `compared ${agreed} block x item pairs (${differ} differ in the pack's levels, speeds or the 1.12 tool rules)`);
});

test('install: the world\'s Block class gets the rule (bot.blockAt blocks); other classes and minecraft-data keep prismarine\'s', () => {
    const registry = registryWithFlint();
    const logs = [];
    const { bot, report } = fakeBot(registry, [{ x: 8, y: 64, z: 8, name: 'stone' }, { x: 9, y: 64, z: 8, name: 'sponge' }], { logs });
    assert.equal(report.installed, true);
    assert.match(logs.join('\n'), /the Forge 1\.12 rule from the dump is installed/);
    const stone = bot.blockAt(new Vec3(8, 64, 8));
    assert.equal(stone.digTime(FLINT_PICKAXE, false, false, false, [], {}), 600, 'was 7500 (hand speed)');
    assert.equal(stone.digTime(null, false, false, false, [], {}), Infinity);
    assert.equal(stone.digTime(null, true, false, false, [], {}), 0, 'creative');
    // A block whose dumped 0 is not believable: prismarine's own time, logged once.
    const sponge = bot.blockAt(new Vec3(9, 64, 8));
    assert.equal(sponge.digTime(null, false, false, false, [], {}), 900);
    sponge.digTime(null, false, false, false, [], {});
    assert.equal(report.fallbacks, 2);
    assert.equal(logs.filter(l => l.includes('sponge:0 is not in the dump')).length, 1, 'logged once');
    // Other classes are untouched: a new prismarine-block class and another chunk class.
    const Plain = require('prismarine-block')(require('prismarine-registry')('1.12.2'));
    assert.equal(new Plain(1, 0, 0).digTime(null, false, false, false, [], {}), 7500, 'minecraft-data\'s vanilla class');
    const other = column(registry, [{ x: 1, y: 1, z: 1, name: 'stone' }]).blockAt(new Vec3(1, 1, 1));
    assert.equal(other.digTime(FLINT_PICKAXE, false, false, false, [], {}), 7500, 'another bot\'s world class');
    assert.equal(originalDigTime(other), undefined);
    // Idempotent: a second install on the same class does nothing; attachDigTime once per bot.
    assert.equal(installDigTime(stone, { ...dumpDigSources(rd, registry), registry }), false);
    assert.equal(attachDigTime(bot, dumpDigSources(rd, registry)), report);
    assert.equal(bot.listenerCount('chunkColumnLoad'), 0, 'the listener is gone once installed');
});

test('install: a throwing stateOf or toolOf keeps prismarine\'s time; missing sources throw (initBot only warns)', () => {
    const registry = registryWithFlint();
    const { blockAt } = column(registry, [{ x: 2, y: 2, z: 2, name: 'stone' }]);
    const stone = blockAt(new Vec3(2, 2, 2));
    let fallbacks = 0;
    installDigTime(stone, { stateOf: () => { throw new Error('bad dump'); }, toolOf: () => null, registry, onFallback: () => fallbacks++ });
    assert.equal(stone.digTime(FLINT_PICKAXE, false, false, false, [], {}), 7500, 'prismarine\'s vanilla time');
    assert.equal(fallbacks, 1);
    const b2 = column(registry, [{ x: 2, y: 2, z: 2, name: 'stone' }]).blockAt(new Vec3(2, 2, 2));
    installDigTime(b2, { stateOf: () => state('minecraft:stone'), toolOf: () => { throw new Error('bad item'); }, registry });
    assert.equal(b2.digTime(FLINT_PICKAXE, false, false, false, [], {}), Infinity, 'an unreadable tool counts as the hand');
    assert.throws(() => attachDigTime(new EventEmitter(), {}), /stateOf and toolOf are required/);
    // No block in the first column yet: it waits for the next one.
    const bot = new EventEmitter();
    bot.registry = registry;
    let calls = 0;
    bot.blockAt = () => (calls++ === 0 ? null : blockAt(new Vec3(2, 2, 2)));
    const report = attachDigTime(bot, dumpDigSources(rd, registry));
    bot.emit('chunkColumnLoad', new Vec3(0, 0, 0));
    assert.equal(report.installed, false);
    bot.emit('chunkColumnLoad', new Vec3(16, 0, 0));
    assert.equal(report.installed, true);
});

test('mineflayer bot.dig: the hand on stone rejects at once (no packet, no hang); the flint pickaxe waits 600 ms', async () => {
    const registry = registryWithFlint();
    const { bot } = fakeBot(registry, [{ x: 8, y: 64, z: 8, name: 'stone' }]);
    require('mineflayer/lib/plugins/digging.js')(bot);
    const stone = bot.blockAt(new Vec3(8, 64, 8));
    const started = Date.now();
    await assert.rejects(Promise.race([
        bot.dig(stone, true),
        new Promise((resolve) => setTimeout(() => resolve('still digging after 1 s'), 1000)),
    ]), /dig time for stone is Infinity/);
    assert.ok(Date.now() - started < 500, 'rejected promptly');
    assert.deepEqual(bot.writes, [], 'no START_DESTROY was sent');
    assert.equal(bot.targetDigBlock, null);
    bot.heldItem = { type: FLINT_PICKAXE, enchants: [] };
    assert.equal(bot.digTime(stone), 600, 'mineflayer\'s own bot.digTime');
    bot.entity.onGround = false;
    assert.equal(bot.digTime(stone), 3000, 'in the air: x5');
});

test('pathfinder: bestHarvestTool picks the flint pickaxe; a hand-only dig through stone is not planned', () => {
    const registry = registryWithFlint();
    const flint = { type: FLINT_PICKAXE, name: 'pyrotech:flint_pickaxe', nbt: null };
    const stick = { type: registry.itemsByName.stick.id, name: 'stick', nbt: null };
    const inventory = [stick, flint];
    const { bot } = fakeBot(registry, [{ x: 8, y: 64, z: 8, name: 'stone' }, { x: 8, y: 65, z: 9, name: 'stone' }], { inventory });
    const { pathfinder, Movements } = require('mineflayer-pathfinder');
    pathfinder(bot);
    const stone = bot.blockAt(new Vec3(8, 65, 9));
    assert.equal(bot.pathfinder.bestHarvestTool(stone), flint, 'was the stick (every item dug at hand speed)');
    const moves = new Movements(bot);
    const withFlint = moves.safeOrBreak(stone, []);
    assert.equal(withFlint, 1 + 3 * 600 / 1000, 'labor cost from 0.6 s (was 23.5 from 7.5 s)');
    inventory.splice(1, 1); // only the stick
    assert.equal(bot.pathfinder.bestHarvestTool(stone), null);
    assert.equal(moves.safeOrBreak(stone, []), Infinity, 'cost Infinity: pathfinder drops moves over 100');
});
