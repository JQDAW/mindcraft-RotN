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
// - A virtual clock, as a record only: a dig adds its dig time to it; nothing waits for it (the code under test still
//   sleeps in real time, and moves here are instant).
// - Moving: lookAt and look set the yaw; 'forward' moves one cell along it when that cell and the head cell above it
//   are passable; 'forward' with 'jump' steps up one onto a solid block (the stair step escape.js's stepInto takes);
//   'jump' alone lifts 1.2 under the first solid cell above the head; letting go lands on the first solid block below.
// - equip / unequip as mineflayer 4.33's simple_inventory.js (the hand: select a hotbar slot that holds it or is empty,
//   else the next LRU hotbar slot, and swap with moveSlotItem; other places: moveSlotItem); clickWindow (mode 0,
//   left button), moveSlotItem, firstEmptyInventorySlot and firstEmptySlotRange as mineflayer and prismarine-windows.
// - Stack sizes from the dump for every item (vanilla too, as live: forge-bridge's dumpStackSizes, #618).
// - canHarvest as prismarine-block: strict only for a block whose registry entry has harvestTools (vanilla);
//   permissive for a modded block, whose extended entry has none (as live).
//
// - findBlocks / findBlock as mineflayer 4.33 (lib/plugins/blocks.js:116-130): per 16-cube section the matcher runs on
//   the section's palette first (blocks with no position, as Block.fromStateId(stateId, 0)), then on positioned blocks;
//   so a matcher that needs a position skips every section, as live (the #630 review's "exposed first" bug).
// - A minimal mineflayer-collectblock (bot.collectBlock.collect: out of reach, the pathfinder's goto with a look-at-block
//   goal, `{x, y, z, lookAtBlock: true}`, which 'teleport' meets by standing NEXT to the block, never on it, as
//   GoalLookAtBlock; then mineflayer-tool's choice from items() and the dig), so skills.collectBlock runs on a scenario
//   (soak 15's refused collect in the pocket). Not modelled from the real plugin (#631 review 1): its safeToBreak and
//   canHarvest skips (with requireHarvest), drops as item entities and the pickup walk (drops go straight to the
//   inventory through onDig), the nearest-first queue over several targets (targets are taken in the order given),
//   and its events (collectBlock_finished, the errors it emits).
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
import { getBlock, getItem, registryName, loadRotnData, PACK_VERSION } from '../../packages/rotn-data/index.js';
import { forgeDigTime, pickState } from '../../packages/forge-bridge/src/dig-time.js';
import { dumpStackSizes } from '../../packages/forge-bridge/src/stack-sizes.js';

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
let stackProps = null;
/** How often the dump's stack sizes were computed in this process (#631 review 3: cached, so 1 at most). */
export const fixtureStats = { stackSizeComputations: 0 };

export function makeRegistry() {
    const base = minecraftData('1.12.2');
    const reg = Object.create(base);
    reg.blocksByName = { ...base.blocksByName };
    reg.blocks = { ...base.blocks };
    reg.itemsByName = { ...base.itemsByName };
    reg.items = { ...base.items };
    // The dump's stack sizes (StackUp) over copies of the entries that differ (vanilla too, as live; #628 review 2).
    // Computed once per process (#628 re-review: a world per test should not redo 9,710 items).
    if (!stackProps) { fixtureStats.stackSizeComputations++; stackProps = dumpStackSizes(loadRotnData(PACK_VERSION).dump?.items?.items, base).properties; }
    const properties = stackProps;
    for (const [name, { stackSize }] of Object.entries(properties.items)) {
        const short = liveName(name);
        const e = reg.itemsByName[short] ?? reg.itemsByName[name];
        if (!e) continue;
        const copy = { ...e, stackSize };
        reg.itemsByName[e.name] = copy;
        reg.items[e.id] = copy;
    }
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
    // One template per name and metadata (a findBlocks scan builds many blocks); each block is a copy with its position.
    reg.blockTemplates ??= new Map();
    const tk = `${name}|${metadata}`;
    if (!reg.blockTemplates.has(tk)) reg.blockTemplates.set(tk, blockTemplate(reg, name, metadata));
    return { ...reg.blockTemplates.get(tk), position: p };
}

function blockTemplate(reg, name, metadata) {
    const full = fullOf(name);
    const st = pickState(getBlock(full), metadata);
    const live = liveName(full);
    const e = reg.blocksByName[live] ?? reg.ensureBlock(live);
    const liquid = st ? !!st.liquid : /water|lava/.test(live);
    const boundingBox = liquid ? 'empty' : st ? (st.collision?.length ? 'block' : 'empty') : (e.boundingBox ?? 'block');
    const block = {
        name: live, type: e.id, metadata, position: null, boundingBox, material: st?.material ?? e.material,
        hardness: st?.hardness ?? e.hardness ?? null, harvestTool: st?.harvestTool ?? null, harvestLevel: st?.harvestLevel ?? 0,
        toolRequired: !!st?.toolRequired, liquid, state: st ?? null, harvestTools: e.harvestTools,
        // prismarine-block's collision boxes ([x0, y0, z0, x1, y1, z1] per box) from the dump; none for a liquid or air.
        shapes: liquid ? [] : st ? (st.collision ?? []).map(b => [...b]) : (boundingBox === 'block' ? [[0, 0, 0, 1, 1, 1]] : []),
        // prismarine-block copies minecraft-data's diggable (index.js:152): 1.12.2 has air true, water and lava false, as live
        // (#631 review 5); a block with no minecraft-data value (modded): not air or a liquid, and a hardness >= 0.
        diggable: typeof e.diggable === 'boolean' ? e.diggable : (live !== 'air' && !liquid && (st?.hardness ?? 0) >= 0), transparent: st ? !st.opaque : boundingBox !== 'block',
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
        // prismarine-block: no harvestTools (a modded block's extended entry): any item; else the held type must be one.
        canHarvest(heldItemType) { if (!this.harvestTools) return true; return !!(heldItemType != null && this.harvestTools[heldItemType]); },
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
    const f = (q) => layers.find(l => q.y < l.below)?.block ?? 'air';
    f.layers = layers;
    return f;
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
    // Every block the world names is in the registry from the start (a lookup by name before any blockAt: mcdata's
    // getBlockId, findBlocks' ids); a ground function's blocks join on their first blockAt.
    for (const n of new Set([...Object.values(set), ...(terrain.layers ?? []).map(l => l.block), 'air'])) reg.ensureBlock(n);
    const calls = { dug: [], placed: [], refused: [], looks: [], equips: [], gotos: [], jumps: 0 };
    let now = 0;
    const clock = { now: () => now, advance: (ms) => { now += ms; } };

    const metas = new Map();
    const blockAt = (p) => { const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); return makeBlock(reg, nameAt(q), q, metas.get(key(q)) ?? 0); };
    /** findBlocks' scan: the template as prototype and its own position (no copy); the result goes through blockAt. */
    const scanBlock = (q) => { makeBlock(reg, nameAt(q), null, metas.get(key(q)) ?? 0); const b = Object.create(reg.blockTemplates.get(`${nameAt(q)}|${metas.get(key(q)) ?? 0}`)); b.position = q; return b; };
    const solidAt = (q) => blockAt(q).boundingBox === 'block';
    const world = {
        blockAt, nameAt,
        set: (p, name, metadata = 0) => { reg.ensureBlock(name); cells.set(key(p), name); if (metadata) metas.set(key(p), metadata); else metas.delete(key(p)); },
        fill: (a, b, name) => {
            reg.ensureBlock(name);
            for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) for (let z = Math.min(a.z, b.z); z <= Math.max(a.z, b.z); z++) { cells.set(key({ x, y, z }), name); metas.delete(key({ x, y, z })); }
        },
    };

    // The inventory: window 0.
    const slotArr = Array(SLOT.COUNT).fill(null);
    const stack = (name, count, metadata = 0, slot = null) => { const e = reg.ensureItem(name); return { name: e.name, type: e.id, count, metadata, stackSize: e.stackSize, slot }; };
    for (const [s, [n, c, m]] of Object.entries(slots)) slotArr[Number(s)] = stack(n, c, m ?? 0, Number(s));
    const firstEmptySlotRange = (from, to) => { for (let i = from; i < to; i++) if (!slotArr[i]) return i; return null; };
    const inventory = {
        slots: slotArr,
        selectedItem: cursor ? stack(cursor[0], cursor[1], cursor[2] ?? 0) : null,
        inventoryStart: SLOT.MAIN, inventoryEnd: SLOT.OFF_HAND, hotbarStart: SLOT.HOTBAR,
        items: () => slotArr.slice(SLOT.MAIN, SLOT.OFF_HAND).filter(Boolean),
        count: (type, metadata = null) => inventory.items().filter(i => i.type === type && (metadata == null || i.metadata === metadata)).reduce((n, i) => n + i.count, 0),
        findInventoryItem: (type, metadata = null) => inventory.items().find(i => i.type === type && (metadata == null || i.metadata === metadata)) ?? null,
        emptySlotCount: () => slotArr.slice(SLOT.MAIN, SLOT.OFF_HAND).filter(s => !s).length,
        firstEmptySlotRange,
        /** prismarine-windows: the hotbar first, then the main inventory; null when full. */
        firstEmptyInventorySlot: (hotbarFirst = true) => (hotbarFirst ? firstEmptySlotRange(SLOT.HOTBAR, SLOT.OFF_HAND) : null) ?? firstEmptySlotRange(SLOT.MAIN, SLOT.OFF_HAND),
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
    // mineflayer 4.33's window clicks (mode 0, left button), on window 0 only: -999 drops the cursor; a slot picks
    // up, puts down, merges up to the stack size or swaps with the cursor.
    bot.currentWindow = null;
    bot.clickWindow = promised((slot, mouseButton = 0, mode = 0) => {
        if (mode !== 0 || mouseButton !== 0) throw new Error(`click mode ${mode} button ${mouseButton} is not modelled`);
        const cur = inventory.selectedItem;
        if (slot === -999) { inventory.selectedItem = null; return; }
        const it = slotArr[slot];
        if (!cur) { inventory.selectedItem = it ? Object.assign(it, { slot: null }) : null; put(slot, null); return; }
        if (!it) { put(slot, cur); inventory.selectedItem = null; return; }
        if (it.type === cur.type && it.metadata === cur.metadata) {
            const n = Math.min(cur.count, it.stackSize - it.count);
            it.count += n; cur.count -= n;
            if (cur.count <= 0) inventory.selectedItem = null;
            return;
        }
        put(slot, cur);
        inventory.selectedItem = Object.assign(it, { slot: null });
    });
    bot.closeWindow = () => {};
    /** mineflayer: click the source, click the destination, and put a swapped stack back in the source. */
    bot.moveSlotItem = async (from, to) => {
        await bot.clickWindow(from, 0, 0);
        await bot.clickWindow(to, 0, 0);
        if (inventory.selectedItem) await bot.clickWindow(from, 0, 0);
    };
    let nextQuickBarSlot = 0; // mineflayer's LRU over the hotbar when it is full
    /** mineflayer 4.33 simple_inventory.js equip: by item.slot (or a type, found in the inventory). */
    bot.equip = async (item, dest = 'hand') => {
        if (typeof item === 'number') item = inventory.findInventoryItem(item);
        if (item == null || typeof item !== 'object') throw new Error('Invalid item object in equip (item is null or typeof item is not object)');
        if (!dest) dest = 'hand';
        if (!(dest in DEST)) throw new Error(`invalid destination: ${dest}`);
        const from = item.slot;
        // #628 re-review: a stack on the cursor is in no slot; mineflayer would click slot null.
        if (from == null || item === inventory.selectedItem) throw new Error(`${item.name} is on the cursor (selectedItem), not in a window slot: put it down first`);
        let to = DEST[dest] ?? SLOT.HOTBAR + qbs;
        calls.equips.push({ name: item.name, from, dest });
        if (from === to) return;
        if (dest !== 'hand') { await bot.moveSlotItem(from, to); return; }
        if (from >= SLOT.HOTBAR && from < SLOT.OFF_HAND) { bot.setQuickBarSlot(from - SLOT.HOTBAR); return; }
        to = firstEmptySlotRange(SLOT.HOTBAR, SLOT.OFF_HAND);
        if (to == null) { to = SLOT.HOTBAR + nextQuickBarSlot; nextQuickBarSlot = (nextQuickBarSlot + 1) % 9; }
        bot.setQuickBarSlot(to - SLOT.HOTBAR);
        await bot.moveSlotItem(from, to);
    };
    /** mineflayer 4.33 unequip: the hand selects an empty hotbar slot (else moves the held stack to a free slot, else
     * tosses it); other places put their stack away into the first free slot (hotbar first). */
    bot.unequip = async (dest = 'hand') => {
        if (dest === 'hand') {
            const empty = firstEmptySlotRange(SLOT.HOTBAR, SLOT.OFF_HAND);
            if (empty != null) { bot.setQuickBarSlot(empty - SLOT.HOTBAR); return; }
            const free = inventory.firstEmptyInventorySlot();
            if (free == null) { put(SLOT.HOTBAR + qbs, null); return; } // tossed
            await bot.clickWindow(SLOT.HOTBAR + qbs, 0, 0);
            await bot.clickWindow(free, 0, 0);
            return;
        }
        if (!(dest in DEST)) throw new Error(`invalid destination: ${dest}`);
        const from = DEST[dest];
        if (!slotArr[from]) return;
        const free = inventory.firstEmptyInventorySlot();
        if (free == null) throw new Error('no room to put it away');
        await bot.clickWindow(from, 0, 0);
        await bot.clickWindow(free, 0, 0);
    };
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
        // #628 review 7: only a block can be placed, with the held stack's metadata.
        if (!reg.blocksByName[held.name] && !getBlock(fullOf(held.name))) throw new Error(`${held.name} is not a block`);
        world.set(target, held.name, held.metadata ?? 0);
        calls.placed.push({ cell: key(target), name: held.name, metadata: held.metadata ?? 0 });
        held.count--;
        if (held.count <= 0) put(SLOT.HOTBAR + qbs, null);
    });
    // Moving (#628 review 1): the yaw from look/lookAt; forward steps one cell along it; forward + jump steps up one.
    const controls = { forward: false, jump: false };
    const passable = (q) => { const b = blockAt(q); return b.boundingBox === 'empty' && !b.liquid; };
    const dir = () => { // mineflayer's yaw: 0 faces -z; the cell ahead along the major axis
        const dx = -Math.sin(bot.entity.yaw), dz = -Math.cos(bot.entity.yaw);
        return Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz));
    };
    const feet = () => bot.entity.position.floored();
    const moveTo = (q) => { bot.entity.position = q.offset(0.5, 0, 0.5); fall(); };
    /** Under the first solid cell above the head: the highest the feet can be (a jump's cap; #628 review 6). */
    const ceilingCap = (p) => { for (let y = p.y + 2; y <= p.y + 3; y++) if (!passable(new Vec3(p.x, y, p.z))) return y - bot.entity.height; return Infinity; };
    /** A control switched on: forward (with jump: a step up) moves a cell; jump alone lifts. */
    const apply = (changed) => {
        const p = feet();
        if (controls.forward) {
            const ahead = p.plus(dir());
            if (controls.jump && !passable(ahead) && passable(ahead.offset(0, 1, 0)) && passable(ahead.offset(0, 2, 0)) && passable(p.offset(0, 2, 0))) { moveTo(ahead.offset(0, 1, 0)); return; }
            if (passable(ahead) && passable(ahead.offset(0, 1, 0))) { moveTo(ahead); return; }
        }
        if (changed === 'jump' && bot.entity.onGround) {
            calls.jumps++;
            bot.entity.position = bot.entity.position.offset(0, Math.min(1.2, Math.max(0, ceilingCap(p) - bot.entity.position.y)), 0);
            bot.entity.onGround = false;
        }
    };
    bot.setControlState = (c, on) => {
        if (!(c in controls)) return;
        controls[c] = !!on;
        if (on) apply(c);
        else if (c === 'jump') fall();
    };
    bot.clearControlStates = () => { controls.forward = false; controls.jump = false; fall(); };
    bot.look = promised((yaw, pitch) => { calls.looks.push({ yaw, pitch }); bot.entity.yaw = yaw; bot.entity.pitch = pitch; });
    bot.lookAt = promised((p) => {
        const e = bot.entity.position.offset(0, 1.62, 0);
        const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
        if (dx !== 0 || dz !== 0) bot.entity.yaw = Math.atan2(-dx, -dz);
        bot.entity.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        calls.looks.push({ at: p });
    });
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

    // findBlocks as mineflayer 4.33 (lib/plugins/blocks.js): per 16-cube section, the matcher first runs on the
    // section's palette, blocks with no position (Block.fromStateId(stateId, 0)); a section whose palette has no match
    // is skipped. Then on each block in reach, positioned (with useExtraInfo a function: matcher and it). The whole
    // reach is searched in effect: the nearest `count`, by distance. Mineflayer instead stops after the first octahedron
    // layer of sections that has enough, so live it can return a farther block than this does (#631 review 2): a test
    // here never sees that miss.
    const paletteOf = (sx, sy, sz) => {
        const names = new Set();
        const y0 = sy * 16;
        if (terrain.layers) {
            let lo = -Infinity;
            for (const l of terrain.layers) { if (l.below > y0 && lo < y0 + 16) names.add(`${l.block}|0`); lo = l.below; }
            if (lo < y0 + 16) names.add('air|0');
        } else {
            for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) names.add(`${terrain(new Vec3(sx * 16 + x, y0 + y, sz * 16 + z))}|0`);
        }
        for (const [k, n] of cells) {
            const [x, y, z] = k.split(',').map(Number);
            if (Math.floor(x / 16) === sx && Math.floor(y / 16) === sy && Math.floor(z / 16) === sz) names.add(`${n}|${metas.get(k) ?? 0}`);
        }
        return [...names].map(t => { const i = t.lastIndexOf('|'); return makeBlock(reg, t.slice(0, i), null, Number(t.slice(i + 1))); });
    };
    bot.findBlocks = (options = {}) => {
        const matching = options.matching;
        const ids = typeof matching === 'function' ? null : [].concat(matching);
        const matcher = ids ? (b) => b !== null && ids.includes(b.type) : matching;
        const point = (options.point ?? bot.entity.position).floored();
        const maxDistance = options.maxDistance || 16;
        const count = options.count || 1;
        const extra = options.useExtraInfo || false;
        const full = typeof extra === 'boolean' ? (b) => matcher(b) : (b) => matcher(b) && extra(b);
        const found = [];
        const lo = (v) => Math.floor((v - maxDistance) / 16), hi = (v) => Math.floor((v + maxDistance) / 16);
        // Sections nearest first (by their nearest point); stop once `count` are found and no section left can hold
        // a nearer block: the same result as a full search, fast when the targets are near (as mineflayer's layers).
        const sections = [];
        const gap = (v, s0) => Math.max(0, s0 - v, v - (s0 + 15));
        for (let sx = lo(point.x); sx <= hi(point.x); sx++) for (let sy = Math.max(0, lo(point.y)); sy <= Math.min(15, hi(point.y)); sy++) for (let sz = lo(point.z); sz <= hi(point.z); sz++) {
            const d = Math.hypot(gap(point.x, sx * 16), gap(point.y, sy * 16), gap(point.z, sz * 16));
            if (d <= maxDistance) sections.push({ sx, sy, sz, d });
        }
        sections.sort((a, b) => a.d - b.d);
        const dist = (q) => q.distanceTo(point);
        for (const { sx, sy, sz, d } of sections) {
            if (found.length >= count) {
                found.sort((a, b) => dist(a) - dist(b));
                if (d > dist(found[count - 1])) break;
            }
            if (extra !== true && !paletteOf(sx, sy, sz).some(b => matcher(b))) continue;
            for (let x = sx * 16; x < sx * 16 + 16; x++) for (let y = sy * 16; y < sy * 16 + 16; y++) for (let z = sz * 16; z < sz * 16 + 16; z++) {
                const q = new Vec3(x, y, z);
                if (dist(q) > maxDistance) continue;
                if (full(scanBlock(q))) found.push(q);
            }
        }
        found.sort((a, b) => dist(a) - dist(b));
        return found.slice(0, count);
    };
    bot.findBlock = (options) => { const [p] = bot.findBlocks(options); return p ? blockAt(p) : null; };

    // A minimal mineflayer-collectblock (skills.collectBlock's plugin path): walk into reach through the pathfinder
    // (noPath: it throws as the plugin does), the fastest tool from items() (mineflayer-tool), dig, the dig's drops.
    bot.collectBlock = {
        movements: null,
        collect: async (target) => {
            for (const block of [].concat(target)) {
                const eye = bot.entity.position.offset(0, 1.62, 0);
                if (eye.distanceTo(block.position.offset(0.5, 0.5, 0.5)) > 4.5) await bot.pathfinder.goto({ x: block.position.x, y: block.position.y, z: block.position.z, lookAtBlock: true });
                await bot.tool.equipForBlock(block);
                await bot.dig(blockAt(block.position));
            }
        },
        cancelTask: () => Promise.resolve(),
    };
    Object.assign(bot, extra);
    return { bot, world, calls, clock, registry: reg, give, addEntity, stack };
}

/** A pathfinder that finds no path to any goal (soak 15's "Path not found"). */
export function noPath() {
    return { movements: null, setMovements(m) { this.movements = m; }, setGoal() {}, stop() {}, isMoving: () => false, getPathTo: () => ({ status: 'noPath', path: [] }), goto: () => Promise.reject(new Error('No path to the goal!')) };
}

/**
 * Where a bot can stand to reach and see block `b`, as GoalLookAtBlock (#631 review 1): a free cell (feet and head
 * passable, a solid floor) beside it, at its level, one up (on the ground next to it) or one down; never on top of it.
 * The nearest to the bot; null if none.
 */
function standNextTo(bot, b) {
    const free = (q) => { const x = bot.blockAt(q); return x.boundingBox === 'empty' && !x.liquid; };
    const solidQ = (q) => bot.blockAt(q).boundingBox === 'block';
    const from = bot.entity.position.floored();
    const cands = [];
    for (const d of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]) for (const dy of [0, 1, -1]) cands.push(b.plus(d).offset(0, dy, 0));
    return cands.filter(q => free(q) && free(q.offset(0, 1, 0)) && solidQ(q.offset(0, -1, 0))).sort((a, c) => a.distanceTo(from) - c.distanceTo(from))[0] ?? null;
}

/** A pathfinder whose goto puts the bot on the goal's cell (goals with x, y, z), or next to the block for a look-at-block goal; recorded. */
export function teleport(bot, calls = { gotos: [] }) {
    return {
        movements: null, setMovements(m) { this.movements = m; }, setGoal() {}, stop() {}, isMoving: () => false,
        getPathTo: () => ({ status: 'success', path: [] }),
        goto: (goal) => {
            calls.gotos.push(goal);
            if (goal?.x === undefined) return Promise.resolve();
            const at = goal.lookAtBlock ? standNextTo(bot, new Vec3(goal.x, goal.y, goal.z)) : new Vec3(goal.x, goal.y, goal.z);
            if (!at) return Promise.reject(new Error('No path to the goal!'));
            bot.entity.position = at.offset(0.5, 0, 0.5);
            return Promise.resolve();
        },
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
