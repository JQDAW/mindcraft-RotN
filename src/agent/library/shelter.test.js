// skills-rotn D2b: building the first-night shelter from inside, offline. A fake world (dirt
// below y 64, air above, plus what a test sets), a fake bot that places and digs in it the way the
// server would allow (the target must be free, against a solid block, outside the bot's hitbox and
// within reach), and the real 3.3.4 dump for what is sturdy, liquid or falling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { shelterItems, siteNeeds, chooseSite, buildShelter, LATE_UPDATE_MS } from './shelter.js';
import { getCommand } from '../commands/index.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const key = (p) => `${p.x},${p.y},${p.z}`;
const blockOf = (name, position) => {
    const b = reg.blocksByName[name];
    return { name, metadata: 0, boundingBox: b.boundingBox, material: b.material, position, canHarvest: () => true };
};
const REACH = 4.5;

/** The bot's hitbox (0.6 wide, 1.8 high) overlaps the cell at q. */
const hitsBot = (pos, q) => pos.x + 0.3 > q.x && pos.x - 0.3 < q.x + 1 && pos.z + 0.3 > q.z && pos.z - 0.3 < q.z + 1
    && pos.y + 1.8 > q.y && pos.y < q.y + 1;

function fakeBot({ cobble = 10, pickaxe = true, set = {}, at = new Vec3(0.5, 64, 0.5), late = {} } = {}) {
    const world = new Map(Object.entries(set));
    const items = [];
    if (cobble > 0) items.push({ name: 'cobblestone', metadata: 0, count: cobble });
    if (pickaxe) items.push({ name: 'stone_pickaxe', metadata: 0, count: 1 });
    const placed = [], dug = [], tries = [];
    let looking = null;
    const bot = {
        output: '',
        entity: { position: at.clone() },
        inventory: { items: () => items.filter(i => i.count > 0) },
        modes: { isOn: () => false },
        game: { gameMode: 'survival' },
        tool: { equipForBlock: async () => {} },
        heldItem: null,
        blockAt: (p) => {
            const q = p.floored();
            return blockOf(world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air'), q);
        },
        equip: async () => {},
        lookAt: (p) => { looking = p; return Promise.resolve(); },
        // Walking forward moves the bot 0.1 towards where it looks (sneaking pace).
        setControlState: (control, on) => {
            if (control !== 'forward' || !on || !looking) return;
            const pos = bot.entity.position, dx = looking.x - pos.x, dz = looking.z - pos.z, d = Math.hypot(dx, dz);
            if (d > 0) bot.entity.position = pos.offset(dx / d * Math.min(0.1, d), 0, dz / d * Math.min(0.1, d));
        },
        placeBlock: (ref, face) => {
            const target = ref.position.plus(face);
            tries.push(key(target));
            assert.notEqual(ref.boundingBox, 'empty', 'placed against a solid block');
            const eye = bot.entity.position.offset(0, 1.62, 0);
            if (hitsBot(bot.entity.position, target)) return Promise.reject(new Error('the block would hit the bot'));
            if (eye.distanceTo(target.offset(0.5, 0.5, 0.5)) > REACH) return Promise.reject(new Error('out of reach'));
            if (bot.blockAt(target).boundingBox !== 'empty' && !/water/.test(bot.blockAt(target).name)) return Promise.reject(new Error('occupied'));
            const how = late[key(target)];
            if (how === 'dropped') { delete late[key(target)]; return Promise.resolve(); } // the server lost it
            items.find(i => i.name === 'cobblestone').count--;
            placed.push(key(target));
            if (how === 'late') { // the update comes after mineflayer gave up
                delete late[key(target)];
                setTimeout(() => world.set(key(target), 'cobblestone'), 100);
                return Promise.reject(new Error('Event blockUpdate did not fire within timeout of 2000ms'));
            }
            world.set(key(target), 'cobblestone');
            return Promise.resolve();
        },
        dig: (b) => { world.set(key(b.position), 'air'); dug.push(key(b.position)); return Promise.resolve(); },
    };
    return { bot, placed, dug, tries, world };
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** A finished cobblestone shelter at 0 64 0, with changes. */
function shellAt(changes = {}) {
    const set = {};
    for (const [x, z] of SIDES) { set[`${x},64,${z}`] = 'cobblestone'; set[`${x},65,${z}`] = 'cobblestone'; }
    set['0,66,0'] = 'cobblestone';
    return { ...set, ...changes };
}

test('D2b: on flat dirt with 10 cobblestone the bot closes a shelter in its own cell, from inside', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, placed } = fakeBot();
    const r = await buildShelter(bot);
    assert.equal(r.closed, true, bot.output);
    assert.equal(r.placed, 10, '8 walls, a block to hold the roof, the roof');
    assert.ok(r.feet.equals(new Vec3(0, 64, 0)));
    assert.ok(!placed.includes('0,64,0') && !placed.includes('0,65,0'), 'the 1x2 space stays free');
    assert.equal(placed.at(-1), '0,66,0', 'the roof last');
    assert.match(bot.output, /Shelter closed at 0, 64, 0: placed 10 blocks\. The floor is dirt, not rock\./);
    assert.equal(bot.rotnStationary, false, 'unstuck is back on afterwards');
});

test('D2b review 5 and 7: off the middle of the cell it first sneaks to the middle, so no wall hits its hitbox', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, tries } = fakeBot({ at: new Vec3(0.75, 64, 0.2) });
    const r = await buildShelter(bot);
    assert.equal(r.closed, true, bot.output);
    assert.equal(tries.length, 10, 'no placement was refused for hitting the bot');

    const stuck = fakeBot({ at: new Vec3(0.75, 64, 0.2) });
    stuck.bot.setControlState = () => {}; // it cannot move
    const s = await buildShelter(stuck.bot);
    assert.equal(s.closed, false);
    assert.deepEqual(stuck.tries, []);
    assert.match(stuck.bot.output, /Could not stand in the middle of the shelter site at 0, 64, 0, so a wall could hit you; not building\./);
});

test('D2b: too few sturdy blocks: it says how many it needs and places nothing', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, placed } = fakeBot({ cobble: 9 });
    const r = await buildShelter(bot);
    assert.equal(r.closed, false);
    assert.deepEqual(placed, []);
    assert.match(bot.output, /A shelter at 0, 64, 0 needs 10 sturdy blocks \(cobblestone or stone\); you have 9\./);
    assert.deepEqual(shelterItems(fakeBot({ cobble: 0 }).bot), [], 'dirt, logs and the pickaxe do not count');
});

test('D2b review 2: without a pickaxe it does not seal itself in', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, placed } = fakeBot({ pickaxe: false });
    const r = await buildShelter(bot);
    assert.equal(r.closed, false);
    assert.deepEqual(placed, []);
    assert.match(bot.output, /Not building a shelter at 0, 64, 0: without a pickaxe you could not dig out of it again\./);
});

test('D2b: a breached shelter is repaired with one block; dirt in a wall is dug and replaced', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, placed, dug } = fakeBot({ cobble: 2, set: shellAt({ '1,65,0': 'air', '-1,64,0': 'dirt' }) });
    assert.equal(siteNeeds(bot, new Vec3(0, 64, 0)).blocks, 2);
    const r = await buildShelter(bot);
    assert.equal(r.closed, true);
    assert.deepEqual(dug, ['-1,64,0']);
    assert.deepEqual(placed.sort(), ['-1,64,0', '1,65,0']);
});

test('D2b review 1 and 7: no digging under gravel or sand, or next to water or lava outside the shell', async (t) => {
    t.mock.method(console, 'log', () => {});
    const feet = new Vec3(0, 64, 0);
    // A dirt roof with gravel on it: digging the roof drops the gravel into the head space.
    const gravel = fakeBot({ set: shellAt({ '0,66,0': 'dirt', '0,67,0': 'gravel' }) });
    assert.match(siteNeeds(gravel.bot, feet).unsafe, /gravel above 0, 66, 0 would fall in/);
    const r = await buildShelter(gravel.bot, { site: feet });
    assert.equal(r.closed, false);
    assert.deepEqual(gravel.dug, [], 'nothing dug');
    assert.match(gravel.bot.output, /Cannot build the shelter at 0, 64, 0: gravel above 0, 66, 0 would fall in\./);
    // Sand above a dirt wall, water behind a dirt wall, lava behind a dirt wall.
    assert.match(siteNeeds(fakeBot({ set: shellAt({ '1,65,0': 'dirt', '1,66,0': 'sand' }) }).bot, feet).unsafe, /sand above 1, 65, 0/);
    assert.match(siteNeeds(fakeBot({ set: shellAt({ '-1,64,0': 'dirt', '-2,64,0': 'water' }) }).bot, feet).unsafe, /water next to -1, 64, 0 would flow in/);
    assert.match(siteNeeds(fakeBot({ set: shellAt({ '0,64,1': 'dirt', '0,64,2': 'lava' }) }).bot, feet).unsafe, /lava next to 0, 64, 1/);
    // Water next to an air cell that is only filled, not dug, is fine.
    assert.equal(siteNeeds(fakeBot({ set: shellAt({ '1,64,0': 'air', '2,64,0': 'water' }) }).bot, feet).unsafe, null);
    // chooseSite never picks an unsafe site: with gravel on its roof, the bot builds elsewhere.
    const elsewhere = chooseSite(fakeBot({ set: { '0,66,0': 'dirt', '0,67,0': 'gravel' } }).bot, 4);
    assert.ok(!elsewhere.feet.equals(feet));
});

test('D2b review 3 and 7: on a ledge a wall cell with nothing to stand on is no site; the bot picks one with support', (t) => {
    t.mock.method(console, 'log', () => {});
    // A drop to the west: the column below x = -1 is air down to y 60.
    const set = {};
    for (let x = -5; x <= -1; x++) for (let z = -5; z <= 5; z++) for (let y = 60; y < 64; y++) set[`${x},${y},${z}`] = 'air';
    const { bot } = fakeBot({ set });
    const need = siteNeeds(bot, new Vec3(0, 64, 0));
    assert.deepEqual(need.unsupported.map(key), ['-1,64,0', '-1,65,0'], 'the west lower wall has nothing to be placed against, so neither has the wall above it');
    const site = chooseSite(bot, 4);
    assert.equal(site.unsupported.length, 0);
    assert.ok(site.feet.x >= 1, `chose ${site.feet}, away from the edge`);
});

test('D2b: the site needing the fewest blocks wins; a site next to lava or with no floor is never used', (t) => {
    t.mock.method(console, 'log', () => {});
    // A stone corner 2 blocks east: its walls on two sides and its roof are already there.
    const set = {};
    for (const p of ['3,64,0', '3,65,0', '2,64,1', '2,65,1', '2,66,0']) set[p] = 'stone';
    const { bot } = fakeBot({ set });
    const site = chooseSite(bot, 4);
    assert.ok(site.feet.equals(new Vec3(2, 64, 0)), `chose ${site.feet}`);
    assert.equal(site.blocks, 4);
    assert.equal(siteNeeds(fakeBot({ set: { '1,64,0': 'lava' } }).bot, new Vec3(0, 64, 0)), null);
    assert.equal(siteNeeds(fakeBot({ set: { '0,63,0': 'air' } }).bot, new Vec3(0, 64, 0)), null);
});

test('D2b review 4: a late block update is waited for, not placed twice; a lost placement is tried once more', async (t) => {
    t.mock.method(console, 'log', () => {});
    assert.ok(LATE_UPDATE_MS >= 1158, 'longer than the slowest placement P1 measured');
    const late = fakeBot({ cobble: 2, set: shellAt({ '1,65,0': 'air', '0,65,1': 'air' }), late: { '1,65,0': 'late', '0,65,1': 'dropped' } });
    const r = await buildShelter(late.bot);
    assert.equal(r.closed, true, late.bot.output);
    assert.deepEqual(late.tries.filter(k => k === '1,65,0').length, 1, 'the late one: one try, then it showed up');
    assert.deepEqual(late.tries.filter(k => k === '0,65,1').length, 2, 'the lost one: tried again');
});

test('D2b: !buildShelter runs as an action; unstuck leaves the bot alone only while it builds at the site', async (t) => {
    t.mock.method(console, 'log', () => {});
    const cmd = getCommand('!buildShelter');
    assert.ok(cmd, 'registered');
    assert.deepEqual(Object.keys(cmd.params ?? {}), []);
    const { bot } = fakeBot();
    let label = null;
    const agent = { bot, actions: { runAction: async (l, fn) => { label = l; await fn(); return { message: bot.output, interrupted: false }; } } };
    await cmd.perform(agent);
    assert.equal(label, 'action:buildShelter');
    assert.match(bot.output, /Shelter closed at/);

    const { __modeForTest } = await import('../modes.js');
    const mode = __modeForTest('unstuck');
    const position = new Vec3(0.5, 64, 0.5);
    const a = { isIdle: () => false, actions: { currentActionLabel: 'action:buildShelter' }, bot: { entity: { position }, targetDigBlock: null, rotnStationary: true } };
    mode.prev_location = position.clone();
    mode.stuck_time = mode.max_stuck_time + 1;
    mode.last_time = Date.now() - 1000;
    await mode.update(a);
    assert.equal(mode.stuck_time, 0);
    assert.equal(mode.active, false, 'no move-away while building');

    a.bot.rotnStationary = false; // walking to the site, or any other action
    mode.prev_location = position.clone();
    mode.stuck_time = 1;
    mode.last_time = Date.now() - 1000;
    await mode.update(a);
    assert.ok(mode.stuck_time > 1, 'standing still is counted as stuck again');
});

test('#195 nit: a site the caller names is refused, not half-built, when a cell has nothing to be placed against', async (t) => {
    t.mock.method(console, 'log', () => {});
    const set = {};
    for (let x = -5; x <= -1; x++) for (let z = -5; z <= 5; z++) for (let y = 60; y < 64; y++) set[`${x},${y},${z}`] = 'air';
    const { bot, placed } = fakeBot({ set });
    const r = await buildShelter(bot, { site: new Vec3(0, 64, 0) });
    assert.equal(r.closed, false);
    assert.deepEqual(placed, []);
    assert.match(r.line, /Cannot build the shelter at 0, 64, 0: nothing to place a block against at -1, 64, 0; -1, 65, 0\./);
});

test('#204 nit 7: a mob standing in a wall cell is named, and that cell stays open', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, placed } = fakeBot({ cobble: 1, set: shellAt({ '1,64,0': 'air' }) });
    bot.entities = { 1: bot.entity, 7: { name: 'zombie', type: 'mob', position: new Vec3(1.5, 64, 0.5), height: 1.95 } };
    const r = await buildShelter(bot);
    assert.equal(r.closed, false);
    assert.deepEqual(placed, []);
    assert.match(bot.output, /Cannot close 1, 64, 0: zombie stands in it\./);
});

test('isFalling uses rotn-data falls() (#205): soul sand (material sand) does not fall, gravel and anvils do', async () => {
    const { isFalling } = await import('./shelter.js');
    const b = (name) => ({ name, metadata: 0 });
    assert.equal(isFalling(b('gravel')), true);
    assert.equal(isFalling(b('anvil')), true);
    assert.equal(isFalling(b('soul_sand')), false, 'the material rule alone said it falls');
    assert.equal(isFalling(b('cobblestone')), false);
});

test('#204 re-review 2: only mobs and players block a cell, not dropped items, XP orbs or arrows', async () => {
    const { mobIn } = await import('./shelter.js');
    const cell = new Vec3(1, 64, 0);
    const at = new Vec3(1.5, 64, 0.5);
    const self = { type: 'player', position: new Vec3(0.5, 64, 0.5) };
    const bot = (e) => ({ entity: self, entities: { 0: self, 1: e } });
    for (const type of ['object', 'orb', 'global', 'other'])
        assert.equal(mobIn(bot({ type, name: type === 'object' ? 'item' : 'xp_orb', position: at }), cell), null, type);
    assert.equal(mobIn(bot({ type: 'mob', name: 'zombie', position: at }), cell)?.name, 'zombie');
    assert.equal(mobIn(bot({ type: 'player', username: 'JQDAW', position: at }), cell)?.username, 'JQDAW');
    assert.equal(mobIn(bot({ type: 'hostile', name: 'skeleton', position: at }), cell)?.name, 'skeleton');
});

// G3 round 2 B: at sunset the night routine said "without a pickaxe" while the bot owned a stone
// pickaxe. The real dump: the pickaxe is level 0 by either name form, and the shell blocks the bot
// used (Underground Biomes metamorphic cobble) need level 0. bot.inventory.items() covers slots
// 9-44 only: a pickaxe on the cursor (an equip cut short) or in the off hand was not seen.
test('G3 round 2 B: the real dump: a stone pickaxe is level 0; metamorphic cobble needs level 0', async () => {
    const { toolLevels } = await import('./rotn_sources.js');
    const { dumpState } = await import('./night.js');
    for (const name of ['stone_pickaxe', 'minecraft:stone_pickaxe'])
        assert.deepEqual(toolLevels({ inventory: { items: () => [{ name, count: 1, metadata: 17 }] } }, 'pickaxe'), [0], name);
    for (const meta of [0, 1, 7])
        assert.equal(dumpState({ name: 'undergroundbiomes:metamorphic_cobble', metadata: meta })?.harvestLevel, 0);
});

/**
 * Slots like mineflayer's player window: 9-44 the inventory (items()), 45 the off hand, plus the
 * cursor (selectedItem). clickWindow drops the cursor stack into a slot; moveSlotItem moves one.
 */
function slotInventory(bot, { cursor = null, offHand = null } = {}) {
    const slots = new Array(46).fill(null);
    bot.inventory.items().forEach((it, i) => { slots[9 + i] = it; });
    slots[45] = offHand;
    const inv = {
        slots, selectedItem: cursor,
        items: () => slots.slice(9, 45).filter(i => i && i.count > 0),
        firstEmptyInventorySlot: () => { const i = slots.findIndex((x, k) => k >= 9 && k < 45 && !x); return i < 0 ? null : i; },
    };
    bot.inventory = inv;
    bot.clickWindow = (slot) => { slots[slot] = inv.selectedItem; inv.selectedItem = null; return Promise.resolve(); };
    bot.moveSlotItem = (from, to) => { slots[to] = slots[from]; slots[from] = null; return Promise.resolve(); };
    return inv;
}

test('#229 review: a pickaxe on the cursor or in the off hand is moved back into the inventory first', async (t) => {
    t.mock.method(console, 'log', () => {});
    const pick = () => ({ name: 'stone_pickaxe', metadata: 3, count: 1 });
    const cursor = fakeBot({ pickaxe: false });
    const ci = slotInventory(cursor.bot, { cursor: pick() });
    assert.equal((await buildShelter(cursor.bot)).closed, true, cursor.bot.output);
    assert.equal(ci.selectedItem, null);
    assert.ok(ci.items().some(i => i.name === 'stone_pickaxe'), 'in the inventory, where allowedTool and equipForBlock look');
    assert.match(cursor.bot.output, /Moved stone_pickaxe from the cursor back into the inventory\./);

    const off = fakeBot({ pickaxe: false });
    const oi = slotInventory(off.bot, { offHand: pick() });
    assert.equal((await buildShelter(off.bot)).closed, true, off.bot.output);
    assert.equal(oi.slots[45], null);
    assert.ok(oi.items().some(i => i.name === 'stone_pickaxe'));
});

test('#229 review: with no pickaxe anywhere the refusal (after the resync wait) logs every place it looked', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    const none = fakeBot({ pickaxe: false });
    slotInventory(none.bot, { offHand: { name: 'torch', count: 1 } });
    await buildShelter(none.bot);
    assert.match(none.bot.output, /without a pickaxe you could not dig out of it again\. Pickaxes: inventory: none; off hand: torch; cursor: empty; held: nothing\./);
    assert.ok(lines.some(l => /^\[shelter\] pickaxe check: need level 0; inventory: none; off hand: torch/.test(l)));
});

test('G3 round 2 B: the model\'s !buildShelter is refused by day (the night routine builds at dusk); a giver\'s is obeyed', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { ActionManager } = await import('../action_manager.js');
    const make = (timeOfDay, typed = 0) => {
        const { bot, placed } = fakeBot();
        Object.assign(bot, { time: { timeOfDay }, emit() {}, interrupt_code: false });
        const agent = {
            bot, control: { typed },
            clearBotLogs() { bot.output = ''; bot.interrupt_code = false; },
            requestInterrupt() {}, cleanKill() {}, history: { add() {} },
        };
        agent.actions = new ActionManager(agent);
        return { agent, placed };
    };
    const perform = getCommand('!buildShelter').perform;
    const day = make(1000);
    assert.match(await perform(day.agent), /Not building a shelter by day: the night routine builds one at dusk\./);
    assert.deepEqual(day.placed, [], 'no cobblestone spent');
    const dusk = make(12000);
    await perform(dusk.agent);
    assert.ok(dusk.placed.length > 0, 'at dusk it builds');
    const giver = make(1000, 1);
    await perform(giver.agent);
    assert.ok(giver.placed.length > 0, 'a task giver who typed it is obeyed by day');
});

// #229 review 2: with a chest or table open, clickWindow acts on that window and the cursor is its
// selectedItem. stowCarried puts that stack into the window's inventory part, closes the window
// (closing a 1.12 container throws a cursor stack on the ground), and bounds each click.
function openWindow(bot, inv, { cursor = null, freeSlot = 54 } = {}) {
    const win = { selectedItem: cursor, firstEmptyInventorySlot: () => freeSlot, dropped: [] };
    bot.currentWindow = win;
    const playerClick = bot.clickWindow;
    bot.clickWindow = (slot, ...rest) => {
        if (bot.currentWindow !== win) return playerClick(slot, ...rest);
        // a chest window's slot 54 is the player's first inventory slot
        const free = inv.firstEmptyInventorySlot();
        inv.slots[free] = win.selectedItem; win.selectedItem = null;
        return Promise.resolve();
    };
    bot.closeWindow = (w) => { if (w.selectedItem) w.dropped.push(w.selectedItem); bot.currentWindow = null; };
    return win;
}

test('#229 review 2: an open chest with the pickaxe on its cursor: put down, the chest closed, nothing dropped', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot } = fakeBot({ pickaxe: false });
    const inv = slotInventory(bot);
    const win = openWindow(bot, inv, { cursor: { name: 'stone_pickaxe', metadata: 0, count: 1 } });
    assert.equal((await buildShelter(bot)).closed, true, bot.output);
    assert.equal(bot.currentWindow, null, 'the chest was closed');
    assert.deepEqual(win.dropped, [], 'nothing thrown on the ground');
    assert.ok(inv.items().some(i => i.name === 'stone_pickaxe'));
});

test('#229 review 2: with no free slot the open window is left open (closing would drop the stack)', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const { stowCarried } = await import('./rotn_sources.js');
    const { bot } = fakeBot({ pickaxe: false });
    const inv = slotInventory(bot);
    const win = openWindow(bot, inv, { cursor: { name: 'stone_pickaxe', count: 1 }, freeSlot: null });
    assert.deepEqual(await stowCarried(bot, () => true, { resyncMs: 0 }), []);
    assert.equal(bot.currentWindow, win);
    assert.deepEqual(win.dropped, []);
});

test('#229 review 2: a click the server never answers ends at STOW_CLICK_MS; no hang', { timeout: 5000 }, async (t) => {
    const warns = [];
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    const { stowCarried } = await import('./rotn_sources.js');
    const { bot } = fakeBot({ pickaxe: false });
    slotInventory(bot, { offHand: { name: 'stone_pickaxe', count: 1 } });
    bot.moveSlotItem = () => new Promise(() => {}); // never answered
    const t0 = Date.now();
    assert.deepEqual(await stowCarried(bot, () => true, { resyncMs: 0, clickMs: 200 }), []);
    assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
    assert.ok(warns.some(w => /moving the off-hand stack got no answer within 0\.2 s/.test(w)));
});
