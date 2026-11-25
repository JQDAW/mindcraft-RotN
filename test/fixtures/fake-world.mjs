// A shared fake world for offline tests (the soak 16 plan (b), lead 2026-11-25): one mineflayer-shaped bot on a
// block world, in place of the per-file fake bots in src/agent/**/*.test.js. The bot surface it covers is the one
// those fake bots set and the skills code reads (the harness-ops survey, "The bot surface for a shared fake world").
//
// What it does that the per-file fakes do not:
// - Blocks come from rotn-data's dump (hardness, harvest tool and level, tool required, liquid, collision), so pack
//   blocks such as undergroundbiomes:metamorphic_stone are themselves, not "a solid block".
// - Digging uses forge-bridge's own Forge 1.12 rule (packages/forge-bridge/src/dig-time.js forgeDigTime): a block
//   that needs a pickaxe is Infinity by hand, and bot.dig throws `dig time for <name> is Infinity` as live.
// - The inventory is mineflayer's window 0: slots 0-45 (0 result, 1-4 the 2x2 grid, 5-8 armour, 9-35 main, 36-44
//   hotbar, 45 off hand) and the cursor (selectedItem); items() is slots 9-44 only, and tool.equipForBlock chooses
//   from items() only, as mineflayer-tool does. So a pickaxe in the off hand or on the cursor is out of reach of the
//   dig code, which is soak 15's trap.
// - A virtual clock: digs advance it by their dig time.
//
// Not here (yet): the real mineflayer-pathfinder (stubs: 'noPath', 'teleport', or a test's own), crafting and other
// windows (net-forge's fake-containers.js models the server side), moving mobs.
//
// Usage:
//   import { fakeWorld, pocketUnderRock, holeAtSpawn, openShaft } from '../../test/fixtures/fake-world.mjs';
//   const { bot, world, calls, clock } = pocketUnderRock();
//   __setRegistryForTest(bot.registry); // when the code under test reads mcdata's registry
//
// It is not a test file (test/fixtures/ matches none of npm test's patterns); its own tests are in
// test/unit/fake-world.test.js.
import { EventEmitter } from 'node:events';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { getBlock, getItem, registryName } from '../../packages/rotn-data/index.js';
import { forgeDigTime, pickState } from '../../packages/forge-bridge/src/dig-time.js';

/** Window 0's slots (mineflayer's player inventory window). */
export const SLOT = Object.freeze({ RESULT: 0, GRID: [1, 2, 3, 4], HEAD: 5, TORSO: 6, LEGS: 7, FEET: 8, MAIN: 9, HOTBAR: 36, OFF_HAND: 45, COUNT: 46 });
const DEST = { hand: null, 'off-hand': SLOT.OFF_HAND, head: SLOT.HEAD, torso: SLOT.TORSO, legs: SLOT.LEGS, feet: SLOT.FEET };
/** The default ground: stone below y 60, dirt to y 63, air from y 64 (the surface). */
export const DEFAULT_GROUND = Object.freeze([{ below: 60, block: 'stone' }, { below: 64, block: 'dirt' }]);
const MODDED_BLOCK_ID = 4096;
const MODDED_ITEM_ID = 32000;

const key = (p) => `${p.x},${p.y},${p.z}`;
/** A synchronous body as a promise-returning bot method (a throw becomes a rejection), as mineflayer's are. */
const promised = (fn) => (...args) => { try { return Promise.resolve(fn(...args)); } catch (err) { return Promise.reject(err); } };
/** The live bot's name for a registry name: vanilla without `minecraft:`, modded with its mod id. */
export const liveName = (n) => (n.startsWith('minecraft:') ? n.slice('minecraft:'.length) : n);
const fullOf = (n) => { try { return registryName(n); } catch { return n.includes(':') ? n : `minecraft:${n}`; } };

/**
 * minecraft-data 1.12.2 with the modded blocks and items a world uses added (synthetic ids). A copy: the shared
 * minecraft-data object is never changed.
 */
export function makeRegistry() {
    const base = minecraftData('1.12.2');
    const reg = Object.create(base);
    reg.blocksByName = { ...base.blocksByName };
    reg.blocks = { ...base.blocks };
    reg.itemsByName = { ...base.itemsByName };
    reg.items = { ...base.items };
    let nextBlock = MODDED_BLOCK_ID;
    let nextItem = MODDED_ITEM_ID;
    reg.ensureBlock = (name) => {
        const n = liveName(fullOf(name));
        if (reg.blocksByName[n]) return reg.blocksByName[n];
        const st = pickState(getBlock(fullOf(name)), 0);
        const e = { id: nextBlock++, name: n, displayName: n, hardness: st?.hardness ?? null, boundingBox: st && !st.liquid && st.collision?.length ? 'block' : 'empty', material: st?.material, stackSize: 64, diggable: true, transparent: !st?.opaque, drops: [] };
        reg.blocksByName[n] = e;
        reg.blocks[e.id] = e;
        return e;
    };
    reg.ensureItem = (name) => {
        const n = liveName(fullOf(name));
        if (reg.itemsByName[n]) return reg.itemsByName[n];
        const it = getItem(fullOf(name));
        const e = { id: nextItem++, name: n, displayName: n, stackSize: it?.stackSize ?? 64 };
        reg.itemsByName[n] = e;
        reg.items[e.id] = e;
        return e;
    };
    return reg;
}

/** The dump's tool record of an item (`{classes, speed}`), or null for an item with no tool classes. */
function toolOf(item) {
    if (!item) return null;
    const it = getItem(fullOf(item.name));
    const classes = it?.toolClasses;
    return classes && Object.keys(classes).length ? { classes, speed: it.speed ?? {} } : null;
}

/** A block at p: the dump's state (or minecraft-data's entry), shaped as mineflayer's Block. */
function makeBlock(reg, name, p, metadata = 0) {
    const full = fullOf(name);
    const st = pickState(getBlock(full), metadata);
    const live = liveName(full);
    const e = reg.blocksByName[live] ?? reg.ensureBlock(live);
    const liquid = st ? !!st.liquid : /water|lava/.test(live);
    const boundingBox = liquid ? 'empty' : st ? (st.collision?.length ? 'block' : 'empty') : (e.boundingBox ?? 'block');
    const block = {
        name: live, type: e.id, metadata, position: p, boundingBox, material: st?.material ?? e.material,
        hardness: st?.hardness ?? e.hardness ?? null, harvestTool: st?.harvestTool ?? null, harvestLevel: st?.harvestLevel ?? 0,
        toolRequired: !!st?.toolRequired, liquid, state: st ?? null,
        /** forge-bridge's rule for the item held (an item object, or null for the hand); args as Block.digTime. */
        digTimeWith(item, { inWater = false, notOnGround = false, effects = {} } = {}) {
            if (!st) return live === 'air' ? 0 : Infinity;
            return forgeDigTime(st, toolOf(item), { registry: reg, inWater, notOnGround, effects }) ?? Infinity;
        },
        digTime(heldItemType, creative = false, inWater = false, notOnGround = false, _enchantments = [], effects = {}) {
            if (creative) return 0;
            const item = heldItemType == null ? null : { name: reg.items[heldItemType]?.name ?? '' };
            return this.digTimeWith(item, { inWater, notOnGround, effects });
        },
        canHarvest(heldItemType) { return Number.isFinite(this.digTime(heldItemType ?? null)); },
    };
    return block;
}

/**
 * The world's base: ground layers by height (`[{below: y, block}]`, the first match wins, air above the last) or a
 * function (cell) -> name. `set` / `fill` overrides on top.
 */
function makeTerrain(ground) {
    if (typeof ground === 'function') return ground;
    const layers = [...ground].sort((a, b) => a.below - b.below);
    return (q) => layers.find(l => q.y < l.below)?.block ?? 'air';
}

/**
 * One fake world and its bot.
 * @param {object} [opts]
 * @param {Array|Function} [opts.ground] DEFAULT_GROUND, other layers, or (cell) -> block name
 * @param {Object<string, string>} [opts.set] cells "x,y,z" -> block name, over the ground
 * @param {Vec3} [opts.at] the bot's feet cell (it stands at its centre)
 * @param {Object<number, Array>} [opts.slots] window-0 slot -> [name, count, metadata]
 * @param {Array} [opts.cursor] [name, count, metadata] on the cursor (bot.inventory.selectedItem)
 * @param {number} [opts.quickBarSlot] the selected hotbar slot (0-8)
 * @param {'noPath'|'teleport'|object|null} [opts.pathfinder]
 * @param {(block, bot) => Array} [opts.onDig] the drops of a dig, as [[name, count, meta]] given to the inventory
 * @param {object} [opts.extra] more bot fields (per-test stubs: craft, consume, pvp, chat, ...)
 */
export function fakeWorld({ ground = DEFAULT_GROUND, set = {}, at = new Vec3(0, 64, 0), slots = {}, cursor = null, quickBarSlot = 0, pathfinder = 'noPath', onDig = null, health = 20, food = 20, timeOfDay = 6000, spawnPoint = null, extra = {} } = {}) {
    const reg = makeRegistry();
    const terrain = makeTerrain(ground);
    const cells = new Map(Object.entries(set));
    const nameAt = (q) => cells.get(key(q)) ?? terrain(q);
    for (const n of new Set([...Object.values(set)])) reg.ensureBlock(n);
    const calls = { dug: [], placed: [], refused: [], looks: [], equips: [], gotos: [], jumps: 0 };
    let now = 0;
    const clock = { now: () => now, advance: (ms) => { now += ms; } };

    const blockAt = (p) => { const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); return makeBlock(reg, nameAt(q), q); };
    const solidAt = (q) => blockAt(q).boundingBox === 'block';
    const world = {
        blockAt, nameAt,
        set: (p, name) => { reg.ensureBlock(name); cells.set(key(p), name); },
        fill: (a, b, name) => {
            reg.ensureBlock(name);
            for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) for (let z = Math.min(a.z, b.z); z <= Math.max(a.z, b.z); z++) cells.set(key({ x, y, z }), name);
        },
    };

    // The inventory: window 0.
    const slotArr = Array(SLOT.COUNT).fill(null);
    const stack = (name, count, metadata = 0, slot = null) => { const e = reg.ensureItem(name); return { name: e.name, type: e.id, count, metadata, stackSize: e.stackSize, slot }; };
    for (const [s, [n, c, m]] of Object.entries(slots)) slotArr[Number(s)] = stack(n, c, m ?? 0, Number(s));
    const inventory = {
        slots: slotArr,
        selectedItem: cursor ? stack(cursor[0], cursor[1], cursor[2] ?? 0) : null,
        items: () => slotArr.slice(SLOT.MAIN, SLOT.OFF_HAND).filter(Boolean),
        count: (type, metadata = null) => inventory.items().filter(i => i.type === type && (metadata == null || i.metadata === metadata)).reduce((n, i) => n + i.count, 0),
        findInventoryItem: (type, metadata = null) => inventory.items().find(i => i.type === type && (metadata == null || i.metadata === metadata)) ?? null,
        emptySlotCount: () => slotArr.slice(SLOT.MAIN, SLOT.OFF_HAND).filter(s => !s).length,
    };
    const put = (s, item) => { slotArr[s] = item && item.count > 0 ? Object.assign(item, { slot: s }) : null; };
    /** Gives items as a pickup does: onto matching stacks (hotbar, then main) up to the stack size, then into empty slots. */
    const give = (name, count, metadata = 0) => {
        const e = reg.ensureItem(name);
        const order = [...Array(9).keys()].map(i => SLOT.HOTBAR + i).concat([...Array(27).keys()].map(i => SLOT.MAIN + i));
        let left = count;
        for (const s of order) { const it = slotArr[s]; if (left && it && it.type === e.id && it.metadata === metadata && it.count < e.stackSize) { const n = Math.min(left, e.stackSize - it.count); it.count += n; left -= n; } }
        for (const s of order) { if (left && !slotArr[s]) { const n = Math.min(left, e.stackSize); put(s, stack(name, n, metadata)); left -= n; } }
        return count - left;
    };

    const bot = new EventEmitter();
    let qbs = quickBarSlot;
    const effects = {};
    Object.assign(bot, {
        username: 'BOT', version: '1.12.2', registry: reg, output: '', interrupt_code: false,
        game: { gameMode: 'survival', dimension: 'minecraft:overworld' },
        entity: { position: at.offset(0.5, 0, 0.5), yaw: 0, pitch: 0, onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0), effects },
        entities: {}, health, food, foodSaturation: 5, time: { timeOfDay, day: 0, age: 0 },
        spawnPoint: spawnPoint ? spawnPoint.offset(0.5, 0, 0.5) : null,
        modes: { on: new Set(), isOn(n) { return this.on.has(n); }, anyActive: () => false, pause() {}, unpause() {} },
        inventory, blockAt,
    });
    Object.defineProperty(bot, 'quickBarSlot', { get: () => qbs, enumerable: true });
    Object.defineProperty(bot, 'heldItem', { get: () => slotArr[SLOT.HOTBAR + qbs], enumerable: true });
    bot.setQuickBarSlot = (n) => { qbs = n; };
    const fall = () => {
        const p = bot.entity.position;
        let y = Math.floor(p.y);
        while (y > 0 && !solidAt(new Vec3(Math.floor(p.x), y - 1, Math.floor(p.z)))) y--;
        bot.entity.position = new Vec3(p.x, y, p.z);
        bot.entity.onGround = true;
    };
    const inWaterNow = () => blockAt(bot.entity.position).liquid;
    bot.digTime = (block) => block.digTimeWith(bot.heldItem, { inWater: inWaterNow(), notOnGround: !bot.entity.onGround, effects });
    bot.dig = promised((block) => {
        const ms = bot.digTime(block);
        if (!Number.isFinite(ms)) { calls.refused.push({ cell: key(block.position), held: bot.heldItem?.name ?? null }); throw new Error(`dig time for ${block.name} is Infinity`); }
        clock.advance(ms);
        calls.dug.push({ cell: key(block.position), name: block.name, ms, held: bot.heldItem?.name ?? null });
        world.set(block.position, 'air');
        for (const [n, c, m] of onDig?.(block, bot) ?? []) give(n, c, m ?? 0);
        fall();
    });
    bot.equip = promised((item, dest = 'hand') => {
        if (!(dest in DEST)) throw new Error(`invalid destination: ${dest}`);
        const from = slotArr.indexOf(item);
        if (from < 0) throw new Error('Invalid item object in equip');
        const to = DEST[dest] ?? SLOT.HOTBAR + qbs;
        calls.equips.push({ name: item.name, from, to });
        if (from === to) return;
        const was = slotArr[to];
        put(to, item);
        put(from, was);
    });
    bot.unequip = promised((dest = 'hand') => {
        const from = DEST[dest] ?? SLOT.HOTBAR + qbs;
        const it = slotArr[from];
        if (!it) return;
        const free = [...Array(36).keys()].map(i => SLOT.MAIN + i).find(s => s !== from && !slotArr[s]);
        if (free === undefined) throw new Error('no room to unequip');
        put(free, it);
        put(from, null);
    });
    /** mineflayer-tool's choice: the fastest tool in items() (never the off hand, the grid or the cursor), or the hand. */
    bot.tool = {
        equipForBlock: async (block) => {
            let best = null;
            let bestMs = block.digTimeWith(null);
            for (const it of inventory.items()) { const ms = block.digTimeWith(it); if (ms < bestMs) { best = it; bestMs = ms; } }
            if (best && best !== bot.heldItem) await bot.equip(best, 'hand');
        },
    };
    bot.placeBlock = promised((ref, face) => {
        const target = ref.position.plus(face);
        const was = blockAt(target);
        if (ref.boundingBox !== 'block') throw new Error('no solid block to place against');
        if (was.boundingBox === 'block') throw new Error('occupied');
        if (bot.entity.position.floored().equals(target) || bot.entity.position.floored().offset(0, 1, 0).equals(target)) throw new Error('the bot is in the way');
        const held = bot.heldItem;
        if (!held) throw new Error('nothing held');
        world.set(target, held.name);
        calls.placed.push({ cell: key(target), name: held.name });
        held.count--;
        if (held.count <= 0) put(SLOT.HOTBAR + qbs, null);
    });
    bot.setControlState = (c, on) => {
        if (c !== 'jump') return;
        if (on) { calls.jumps++; bot.entity.position = bot.entity.position.offset(0, 1.2, 0); bot.entity.onGround = false; return; }
        fall();
    };
    bot.clearControlStates = () => {};
    bot.look = promised((yaw, pitch) => { calls.looks.push({ yaw, pitch }); bot.entity.yaw = yaw; });
    bot.lookAt = promised((p) => { calls.looks.push({ at: p }); });
    bot.nearestEntity = (filter = () => true) => {
        const p = bot.entity.position;
        return Object.values(bot.entities).filter(filter).sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p))[0] ?? null;
    };
    let nextEntity = 1;
    const addEntity = ({ name, position, type = 'mob', health: h = 20, ...rest }) => {
        const e = { id: nextEntity++, name, type, position, health: h, height: 1.8, ...rest };
        bot.entities[e.id] = e;
        return e;
    };
    bot.pathfinder = pathfinder === 'noPath' ? noPath() : pathfinder === 'teleport' ? teleport(bot, calls) : pathfinder;
    Object.assign(bot, extra);
    return { bot, world, calls, clock, registry: reg, give, addEntity, stack };
}

/** A pathfinder that finds no path to any goal (soak 15's "Path not found"). */
export function noPath() {
    return { movements: null, setMovements(m) { this.movements = m; }, setGoal() {}, stop() {}, isMoving: () => false, getPathTo: () => ({ status: 'noPath', path: [] }), goto: () => Promise.reject(new Error('No path to the goal!')) };
}

/** A pathfinder whose goto puts the bot on the goal's cell (goals with x, y, z), and records it. */
export function teleport(bot, calls = { gotos: [] }) {
    return {
        movements: null, setMovements(m) { this.movements = m; }, setGoal() {}, stop() {}, isMoving: () => false,
        getPathTo: () => ({ status: 'success', path: [] }),
        goto: (goal) => { calls.gotos.push(goal); if (goal?.x !== undefined) bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); return Promise.resolve(); },
    };
}

/**
 * Soak 15 (rotn-v0.1.21, 22:42 to 00:01): the bot 8 below the ground in a pocket, under dirt (60-63) over
 * Underground Biomes metamorphic stone (below 60); its cell (0, 56, 0) and head (0, 57, 0) open. The stone pickaxe
 * is in the off hand (slot 45, where #614's re-arm put it), planks in the hand: out of items(), so equipForBlock
 * keeps the planks and every stone dig is Infinity.
 */
export function pocketUnderRock(opts = {}) {
    return fakeWorld({
        ground: [{ below: 60, block: 'undergroundbiomes:metamorphic_stone' }, { below: 64, block: 'dirt' }],
        set: { '0,56,0': 'air', '0,57,0': 'air' },
        at: new Vec3(0, 56, 0),
        slots: { 36: ['planks', 1, 1], 45: ['stone_pickaxe', 1], 9: ['betterwithmods:dirt_pile', 60] },
        ...opts,
    });
}

/**
 * Soak 12 (rotn-v0.1.18, deaths 2-16): a hole shelter at the respawn point. Dirt to y 62 under grass (63); the
 * bot's cells (0, 61, 0) and (0, 62, 0) dug out, a dirt roof at (0, 63, 0); the spawn point is the bot's cell.
 */
export function holeAtSpawn(opts = {}) {
    return fakeWorld({
        ground: [{ below: 63, block: 'dirt' }, { below: 64, block: 'grass' }],
        set: { '0,61,0': 'air', '0,62,0': 'air', '0,63,0': 'dirt' },
        at: new Vec3(0, 61, 0),
        spawnPoint: new Vec3(0, 61, 0),
        slots: {},
        ...opts,
    });
}

/**
 * #624 review 1: a 1x1 shaft open to the sky, `depth` deep (12 by default, deeper than 8): stone below y 60, dirt
 * 60-63, the shaft's cells (0, 64 - depth .. 63, 0) open; the bot at the bottom with a stone pickaxe in the hand.
 */
export function openShaft({ depth = 12, ...opts } = {}) {
    const set = {};
    for (let y = 64 - depth; y < 64; y++) set[`0,${y},0`] = 'air';
    return fakeWorld({ set, at: new Vec3(0, 64 - depth, 0), slots: { 36: ['stone_pickaxe', 1] }, ...opts });
}
