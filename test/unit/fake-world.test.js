// test/fixtures/fake-world.mjs: the shared fake world's own tests (offline: rotn-data's dump and forge-bridge's dig
// rule, no server). The last tests run the real escape code (src/agent/library/escape.js, #624) on the three
// scenarios, to show the fixture is usable as the skills tests' world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { fakeWorld, pocketUnderRock, holeAtSpawn, openShaft, noPath, teleport, SLOT, DEFAULT_GROUND, liveName } from '../fixtures/fake-world.mjs';
import { __setRegistryForTest } from '../../src/utils/mcdata.js';
import { isTrapped, isOut, surfaceTarget } from '../../src/agent/library/escape.js';
import { goToSurface } from '../../src/agent/library/skills.js';

const V = (x, y, z) => new Vec3(x, y, z);
const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };
/** The code under test reads mcdata's registry: the fixture's, given back afterwards (#628 review 8). */
const useRegistry = (t, bot) => { __setRegistryForTest(bot.registry); t.after(() => __setRegistryForTest(null)); };

test('blocks come from rotn-data\'s dump, named as the live bot names them; the shared minecraft-data is not changed', () => {
    const { bot } = fakeWorld({ set: { '0,64,0': 'undergroundbiomes:metamorphic_stone', '1,64,0': 'water' } });
    const stone = bot.blockAt(V(0, 10, 0));
    assert.deepEqual([stone.name, stone.boundingBox, stone.hardness, stone.harvestTool, stone.harvestLevel, stone.toolRequired], ['stone', 'block', 1.5, 'pickaxe', 0, true]);
    const ub = bot.blockAt(V(0, 64, 0));
    assert.deepEqual([ub.name, ub.boundingBox, ub.harvestTool, ub.toolRequired], ['undergroundbiomes:metamorphic_stone', 'block', 'pickaxe', true]);
    assert.ok(ub.type >= 4096 && bot.registry.blocks[ub.type].name === ub.name, 'a synthetic id in the copy of the registry');
    assert.equal(minecraftData('1.12.2').blocksByName['undergroundbiomes:metamorphic_stone'], undefined, 'the shared registry is not changed');
    assert.deepEqual([bot.blockAt(V(0, 64.7, 0.3)).position.toString(), bot.blockAt(V(0, 70, 0)).boundingBox], ['(0, 64, 0)', 'empty']);
    const water = bot.blockAt(V(1, 64, 0));
    assert.deepEqual([water.boundingBox, water.liquid], ['empty', true]);
    assert.deepEqual([bot.blockAt(V(0, 61, 0)).name, bot.blockAt(V(0, 59, 0)).name], ['dirt', 'stone']); // DEFAULT_GROUND
    assert.equal(DEFAULT_GROUND.length, 2);
    assert.equal(liveName('minecraft:stone'), 'stone');
});

test('ground layers or a function; set and fill override it', () => {
    const { bot, world } = fakeWorld({ ground: (q) => (q.y < 50 ? 'gravel' : 'air') });
    assert.equal(bot.blockAt(V(3, 49, 3)).name, 'gravel');
    world.fill(V(0, 60, 0), V(1, 60, 1), 'leaves');
    assert.deepEqual([bot.blockAt(V(1, 60, 1)).name, bot.blockAt(V(2, 60, 1)).name], ['leaves', 'air']);
    world.set(V(0, 60, 0), 'air');
    assert.equal(bot.blockAt(V(0, 60, 0)).name, 'air');
});

test('the inventory is window 0: items() is slots 9-44 only (not the grid, armour, off hand or cursor); heldItem is the hotbar slot', () => {
    const { bot } = fakeWorld({ slots: { 1: ['pyrotech:rock', 4], 5: ['leather_helmet', 1], 9: ['dirt', 10], 36: ['planks', 3], 38: ['stick', 2], 45: ['stone_pickaxe', 1] }, cursor: ['bread', 1] });
    assert.deepEqual(bot.inventory.items().map(i => i.name), ['dirt', 'planks', 'stick']);
    assert.equal(bot.inventory.slots[SLOT.OFF_HAND].name, 'stone_pickaxe');
    assert.equal(bot.inventory.selectedItem.name, 'bread');
    assert.equal(bot.heldItem.name, 'planks');
    bot.setQuickBarSlot(2);
    assert.equal(bot.heldItem.name, 'stick');
    assert.equal(bot.inventory.count(bot.registry.itemsByName.dirt.id), 10);
    assert.equal(bot.inventory.findInventoryItem(bot.registry.itemsByName.stick.id).slot, 38);
    assert.equal(bot.inventory.emptySlotCount(), 33);
});

test('equip and unequip as mineflayer 4.33 (simple_inventory.js): the hand selects a hotbar slot or the first empty one; by item.slot or type', async () => {
    const { bot, calls } = fakeWorld({ slots: { 36: ['planks', 1], 45: ['stone_pickaxe', 1], 9: ['stick', 3], 38: ['dirt', 5] } });
    // From the off hand into the hand: into the first empty hotbar slot (37), selected; the planks stay at 36.
    await bot.equip(bot.inventory.slots[SLOT.OFF_HAND], 'hand');
    assert.deepEqual([bot.quickBarSlot, bot.heldItem.name, bot.inventory.slots[36].name, bot.inventory.slots[45]], [1, 'stone_pickaxe', 'planks', null]);
    // A hotbar stack: only selected.
    await bot.equip(bot.inventory.slots[38], 'hand');
    assert.deepEqual([bot.quickBarSlot, bot.heldItem.name], [2, 'dirt']);
    // By type (a number), into the off hand: moveSlotItem.
    await bot.equip(bot.registry.itemsByName.stick.id, 'off-hand');
    assert.deepEqual([bot.inventory.slots[45].name, bot.inventory.slots[9]], ['stick', null]);
    // unequip the hand: an empty hotbar slot is selected; nothing moves.
    await bot.unequip('hand');
    assert.equal(bot.heldItem, null);
    assert.equal(bot.inventory.slots[38].name, 'dirt');
    await bot.unequip('off-hand'); // put away: the first free slot, hotbar first
    assert.deepEqual([bot.inventory.slots[45], bot.inventory.slots[39].name], [null, 'stick']);
    await assert.rejects(bot.equip(null), /Invalid item object/);
    assert.deepEqual(calls.equips.map(e => [e.name, e.from, e.dest]), [['stone_pickaxe', 45, 'hand'], ['dirt', 38, 'hand'], ['stick', 9, 'off-hand']]);
});

test('equip into a full hotbar takes the next LRU slot and swaps; unequip with a full hotbar moves the held stack to a free slot', async () => {
    const slots = {};
    for (let i = 0; i < 9; i++) slots[36 + i] = ['dirt', 1];
    slots[9] = ['stone_pickaxe', 1];
    const { bot } = fakeWorld({ slots });
    await bot.equip(bot.inventory.slots[9], 'hand');
    assert.deepEqual([bot.quickBarSlot, bot.heldItem.name, bot.inventory.slots[9].name], [0, 'stone_pickaxe', 'dirt']);
    await bot.unequip('hand');
    assert.equal(bot.heldItem, null);
    assert.equal(bot.inventory.slots[10].name, 'stone_pickaxe');
});

test('clickWindow (mode 0), moveSlotItem and the free-slot helpers that offHandToolBack\'s stow uses (#628 review 5)', async () => {
    const { bot } = fakeWorld({ slots: { 9: ['dirt', 100], 10: ['dirt', 100], 45: ['stone_pickaxe', 1] } });
    assert.equal(bot.inventory.firstEmptyInventorySlot(), 36);
    assert.equal(bot.inventory.firstEmptyInventorySlot(false), 11);
    assert.equal(bot.inventory.firstEmptySlotRange(9, 11), null);
    await bot.clickWindow(9, 0, 0);
    assert.equal(bot.inventory.selectedItem.count, 100);
    await bot.clickWindow(10, 0, 0); // merge up to the dump's 128 for dirt
    assert.deepEqual([bot.inventory.slots[10].count, bot.inventory.selectedItem.count], [128, 72]);
    await bot.clickWindow(-999, 0, 0);
    assert.equal(bot.inventory.selectedItem, null);
    await bot.moveSlotItem(45, 36);
    assert.deepEqual([bot.inventory.slots[36].name, bot.inventory.slots[45]], ['stone_pickaxe', null]);
    await assert.rejects(bot.clickWindow(9, 0, 1), /not modelled/);
});

test('give merges up to the dump\'s stack size (StackUp: dirt piles 256), hotbar first', () => {
    const { bot, give } = fakeWorld({ slots: { 9: ['betterwithmods:dirt_pile', 250] } });
    assert.equal(bot.registry.itemsByName['betterwithmods:dirt_pile'].stackSize, 256);
    // Vanilla items get the dump's sizes too, on copies of their entries (#628 review 2).
    assert.deepEqual([bot.registry.itemsByName.stick.stackSize, bot.registry.itemsByName.dirt.stackSize, bot.registry.items[bot.registry.itemsByName.stick.id].stackSize], [256, 128, 256]);
    assert.equal(minecraftData('1.12.2').itemsByName.stick.stackSize, 64, 'the shared registry is not changed');
    assert.equal(give('betterwithmods:dirt_pile', 10), 10);
    assert.deepEqual([bot.inventory.slots[9].count, bot.inventory.slots[36].count], [256, 4]);
});

test('digging is forge-bridge\'s rule: stone by hand is Infinity and dig throws; the stone pickaxe 600 ms; the clock advances; the bot falls', async () => {
    const { bot, calls, clock } = fakeWorld({ at: V(0, 64, 0), slots: { 36: ['stone_pickaxe', 1], 37: ['planks', 1] } });
    const below = bot.blockAt(V(0, 63, 0)); // dirt
    const stone = bot.blockAt(V(1, 59, 0));
    assert.equal(stone.digTimeWith(null), Infinity);
    assert.equal(stone.digTimeWith({ name: 'stone_pickaxe' }), 600);
    assert.equal(below.digTimeWith(null), 750); // dirt by hand: hardness 0.5, speed 1, harvestable: 15 ticks
    bot.setQuickBarSlot(1); // planks in the hand
    await assert.rejects(bot.dig(stone), /dig time for stone is Infinity/);
    assert.deepEqual(calls.refused, [{ cell: '1,59,0', held: 'planks' }]);
    bot.setQuickBarSlot(0);
    await bot.dig(stone);
    assert.equal(clock.now(), 600);
    await bot.dig(below);
    assert.equal(bot.entity.position.y, 63, 'fell one block, onto the dirt at y 62');
    assert.equal(calls.dug.length, 2);
    assert.equal(bot.blockAt(V(0, 63, 0)).name, 'air');
});

test('tool.equipForBlock chooses from items() only, like mineflayer-tool: a pickaxe in the off hand is not chosen', async () => {
    const { bot } = fakeWorld({ slots: { 36: ['planks', 1], 45: ['stone_pickaxe', 1] } });
    const stone = bot.blockAt(V(0, 10, 0));
    await bot.tool.equipForBlock(stone);
    assert.equal(bot.heldItem.name, 'planks');
    const w2 = fakeWorld({ slots: { 36: ['planks', 1], 12: ['stone_pickaxe', 1] } });
    await w2.bot.tool.equipForBlock(w2.bot.blockAt(V(0, 10, 0)));
    assert.equal(w2.bot.heldItem.name, 'stone_pickaxe');
});

test('onDig gives the drops; placeBlock rejects an occupied cell or the bot\'s own; jump and land', async () => {
    const { bot, calls } = fakeWorld({ at: V(0, 64, 0), slots: { 36: ['dirt', 2] }, onDig: (b) => (b.name === 'dirt' ? [['betterwithmods:dirt_pile', 4]] : []) });
    await bot.dig(bot.blockAt(V(1, 63, 0)));
    assert.equal(bot.inventory.items().find(i => i.name === 'betterwithmods:dirt_pile').count, 4);
    const floor = bot.blockAt(V(2, 63, 0));
    await assert.rejects(bot.placeBlock(bot.blockAt(V(2, 62, 0)), V(0, 1, 0)), /occupied/);
    await assert.rejects(bot.placeBlock(bot.blockAt(V(0, 63, 0)), V(0, 1, 0)), /in the way/);
    await bot.placeBlock(floor, V(0, 1, 0));
    assert.deepEqual([bot.blockAt(V(2, 64, 0)).name, bot.heldItem.count, calls.placed.length], ['dirt', 1, 1]);
    bot.setControlState('jump', true);
    assert.equal(bot.entity.position.y, 65.2);
    bot.setControlState('jump', false);
    assert.equal(bot.entity.position.y, 64);
    assert.equal(calls.jumps, 1);
});

test('canHarvest as prismarine-block: strict for a vanilla block (harvestTools), permissive for a modded one (#628 review 4)', () => {
    const { bot } = fakeWorld({ set: { '0,64,0': 'undergroundbiomes:metamorphic_stone' } });
    const stone = bot.blockAt(V(0, 10, 0));
    const pick = bot.registry.itemsByName.stone_pickaxe.id;
    assert.deepEqual([stone.canHarvest(null), stone.canHarvest(pick)], [false, true]);
    const ub = bot.blockAt(V(0, 64, 0));
    assert.equal(ub.harvestTools, undefined);
    assert.equal(ub.canHarvest(null), true, 'permissive, as live');
    assert.equal(ub.digTime(null), Infinity, 'the Forge rule still refuses it by hand');
    assert.equal(bot.blockAt(V(0, 61, 0)).canHarvest(null), true); // dirt: no harvestTools
});

test('moving: lookAt sets the yaw; forward goes one cell when it and the head cell are passable; forward + jump steps up one; a jump stops under the ceiling', async () => {
    const { bot, world } = fakeWorld({ at: V(0, 64, 0) });
    await bot.lookAt(V(1.5, 65.6, 0.5)); // east
    bot.setControlState('forward', true);
    assert.equal(bot.entity.position.floored().toString(), '(1, 64, 0)');
    bot.setControlState('forward', false);
    world.set(V(2, 64, 0), 'stone'); // a step east
    bot.setControlState('forward', true);
    assert.equal(bot.entity.position.floored().toString(), '(1, 64, 0)', 'a wall: no move without a jump');
    bot.setControlState('jump', true);
    assert.equal(bot.entity.position.floored().toString(), '(2, 65, 0)', 'up onto the step');
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
    assert.equal(bot.entity.position.y, 65);
    world.set(V(2, 67, 0), 'stone'); // a ceiling over the head cell
    bot.setControlState('jump', true);
    assert.ok(Math.abs(bot.entity.position.y - 65.2) < 1e-9, `${bot.entity.position.y}: the head stops under the ceiling`);
    bot.setControlState('jump', false);
    assert.equal(bot.entity.position.y, 65);
    await bot.look(Math.PI, 0); // yaw pi faces +z
    world.set(V(2, 65, 1), 'stone');
    bot.setControlState('forward', true);
    assert.equal(bot.entity.position.floored().toString(), '(2, 65, 0)', 'blocked south');
});

test('placeBlock places a block only, with the held stack\'s metadata (#628 review 7)', async () => {
    const { bot } = fakeWorld({ at: V(0, 64, 0), slots: { 36: ['planks', 2, 1], 37: ['stick', 4] } });
    await bot.placeBlock(bot.blockAt(V(3, 63, 0)), V(0, 1, 0));
    const placed = bot.blockAt(V(3, 64, 0));
    assert.deepEqual([placed.name, placed.metadata], ['planks', 1]);
    bot.setQuickBarSlot(1);
    await assert.rejects(bot.placeBlock(bot.blockAt(V(4, 63, 0)), V(0, 1, 0)), /stick is not a block/);
});

test('pathfinder choices: noPath rejects every goal; teleport puts the bot on the goal; entities and nearestEntity', async () => {
    const a = fakeWorld();
    assert.equal(a.bot.pathfinder.getPathTo().status, 'noPath');
    await assert.rejects(a.bot.pathfinder.goto({ x: 1, y: 64, z: 1 }), /No path/);
    const b = fakeWorld({ pathfinder: 'teleport' });
    await b.bot.pathfinder.goto({ x: 5, y: 64, z: -2 });
    assert.equal(b.bot.entity.position.toString(), '(5.5, 64, -1.5)');
    assert.equal(b.calls.gotos.length, 1);
    assert.equal(typeof noPath().setMovements, 'function');
    assert.equal(typeof teleport(b.bot).goto, 'function');
    const z = b.addEntity({ name: 'zombie', position: V(8, 64, 0) });
    b.addEntity({ name: 'cow', position: V(20, 64, 0) });
    assert.equal(b.bot.nearestEntity(), z);
    assert.equal(b.bot.nearestEntity(e => e.name === 'cow').name, 'cow');
    const c = fakeWorld({ extra: { craft: () => 'stub' } });
    assert.equal(c.bot.craft(), 'stub');
    assert.equal(c.bot.modes.isOn('cowardice'), false);
});

test('pocketUnderRock (soak 15): 8 below the ground under dirt over metamorphic stone; the pickaxe in the off hand is out of reach', async (t) => {
    quiet(t);
    const { bot, calls } = pocketUnderRock();
    useRegistry(t, bot);
    assert.equal(bot.entity.position.toString(), '(0.5, 56, 0.5)');
    assert.deepEqual([bot.blockAt(V(0, 58, 0)).name, bot.blockAt(V(0, 61, 0)).name, bot.blockAt(V(0, 64, 0)).name], ['undergroundbiomes:metamorphic_stone', 'dirt', 'air']);
    assert.equal(bot.inventory.slots[SLOT.OFF_HAND].name, 'stone_pickaxe');
    assert.equal(bot.inventory.items().some(i => /pickaxe/.test(i.name)), false);
    const wall = bot.blockAt(V(1, 56, 0));
    await bot.tool.equipForBlock(wall);
    assert.equal(bot.heldItem.name, 'planks', 'equipForBlock cannot see the off hand');
    await assert.rejects(bot.dig(wall), /dig time for undergroundbiomes:metamorphic_stone is Infinity/);
    assert.equal(isTrapped(bot).trapped, true);
    assert.equal(isOut(bot), false);
    // With the pickaxe back in the hand the same dig works (950 ms: hardness 2.475, the stone pickaxe's speed 4).
    await bot.equip(bot.inventory.slots[SLOT.OFF_HAND], 'hand');
    await bot.dig(wall);
    assert.deepEqual(calls.dug.map(d => [d.cell, d.ms]), [['1,56,0', 950]]);
});

// #628 review 1: the real escape steps on this world (escape.js's stepInto: lookAt, forward and jump), no teleport.
const surfaceRun = async (t, w) => {
    quiet(t);
    useRegistry(t, w.bot);
    const out = await goToSurface(w.bot);
    return { out, at: w.bot.entity.position.floored(), trapped: isTrapped(w.bot).trapped, strictOut: isOut(w.bot, null, true) };
};

test('the real !goToSurface on pocketUnderRock: the pickaxe comes back from the off hand and the bot digs out to open ground', async (t) => {
    const w = pocketUnderRock();
    const r = await surfaceRun(t, w);
    assert.equal(r.out, true, w.bot.output);
    assert.ok(r.at.y >= 63, `${r.at}`);
    assert.deepEqual([r.trapped, r.strictOut], [false, true]);
    assert.equal(w.calls.refused.length, 0, 'no dig refused: the pickaxe was taken from the off hand first');
    assert.ok(w.calls.dug.length >= 8, `dug ${w.calls.dug.length}`);
    assert.equal(w.bot.inventory.slots[SLOT.OFF_HAND], null);
    assert.match(w.bot.output, /Reached open ground/);
});

test('the real !goToSurface on holeAtSpawn: out of the hole to open ground', async (t) => {
    const w = holeAtSpawn();
    const r = await surfaceRun(t, w);
    assert.equal(r.out, true, w.bot.output);
    assert.ok(r.at.y >= 63, `${r.at}`);
    assert.deepEqual([r.trapped, r.strictOut], [false, true]);
    assert.notEqual(r.at.toString(), w.bot.spawnPoint.floored().toString());
});

test('the real !goToSurface on openShaft: up the 12-deep shaft to the rim\'s ground', async (t) => {
    const w = openShaft();
    const r = await surfaceRun(t, w);
    assert.equal(r.out, true, w.bot.output);
    assert.ok(r.at.y >= 63, `${r.at}`);
    assert.deepEqual([r.trapped, r.strictOut], [false, true]);
    assert.equal(w.calls.refused.length, 0);
});

test('holeAtSpawn (soak 12): a roofed hole shelter at the spawn point; trapped, not out', (t) => {
    quiet(t);
    const { bot } = holeAtSpawn();
    useRegistry(t, bot);
    assert.equal(bot.spawnPoint.floored().toString(), bot.entity.position.floored().toString());
    assert.deepEqual([bot.blockAt(V(0, 63, 0)).name, bot.blockAt(V(0, 62, 0)).name, bot.blockAt(V(0, 60, 0)).name, bot.blockAt(V(1, 63, 0)).name], ['dirt', 'air', 'dirt', 'grass']);
    assert.equal(isTrapped(bot).trapped, true);
    assert.equal(isOut(bot), false);
});

test('openShaft (#624 review 1): 12 deep and open to the sky; not out at the bottom, and the target is the rim at y 64', (t) => {
    quiet(t);
    const { bot } = openShaft();
    useRegistry(t, bot);
    assert.deepEqual([bot.entity.position.y, bot.blockAt(V(0, 51, 0)).name, bot.blockAt(V(0, 63, 0)).name], [52, 'stone', 'air']);
    assert.equal(isTrapped(bot).trapped, true);
    assert.equal(surfaceTarget(bot).y, 64);
    assert.equal(openShaft({ depth: 9 }).bot.entity.position.y, 55);
});
