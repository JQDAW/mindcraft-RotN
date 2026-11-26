// Round 17 V (Fable verdict 2, S2): one inventory view, every reader through it, and the idle repair of the hands.
// Offline: fake window-0 inventories, and a static check of the sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as espree from 'espree';
import { view, carried, everyStack, freeUsableSlot, hotbar, offHand, wornArmor, gridSlotsHeld, SLOTS } from './inventory_view.js';
import { findItem, countItem, carriedItems } from './rotn_names.js';
import { getInventoryCounts, getInventoryTotals } from './world.js';
import { heldFoodPoints } from './food.js';
import { armsWrong, idleHands, handsAfter } from './hands.js';

const st = (name, count, slot, metadata = 0) => ({ name, count, slot, metadata, type: 1 });

/** One inventory with a stack in every section: the table test's (the lead: grid rocks, result dirt, cursor and off-hand pickaxes, armour). */
function everySection() {
    const slots = new Array(46).fill(null);
    slots[0] = st('dirt', 1, 0); // the phantom result (soak 15, 22:51:15)
    slots[1] = st('pyrotech:rock', 3, 1); // a failed craft's leftovers
    slots[2] = st('pyrotech:rock', 2, 2);
    slots[5] = st('leather_helmet', 1, 5);
    slots[8] = st('iron_boots', 1, 8);
    slots[9] = st('pyrotech:rock', 4, 9);
    slots[10] = st('bread', 2, 10);
    slots[36] = st('spartanweaponry:club_wood', 1, 36);
    slots[45] = st('stone_pickaxe', 1, 45);
    const items = () => slots.slice(9, 45).filter(Boolean);
    return { slots, inventory: { slots, items, selectedItem: st('wooden_pickaxe', 1, -1) } };
}

test('round 17 V: view() names every section of window 0 and the cursor; carried is the usable stacks and the off hand', () => {
    const bot = everySection();
    const v = view(bot);
    assert.deepEqual(v.usable.map(s => s.slot), [9, 10, 36]);
    assert.equal(v.offHand.name, 'stone_pickaxe');
    assert.equal(v.cursor.name, 'wooden_pickaxe');
    assert.deepEqual(v.grid.map(s => s.slot), [1, 2]);
    assert.equal(v.result.name, 'dirt');
    assert.deepEqual([v.armor.head?.name, v.armor.torso, v.armor.legs, v.armor.feet?.name], ['leather_helmet', null, null, 'iron_boots']);
    assert.deepEqual(carried(bot).map(s => s.slot), [9, 10, 36, 45]);
    assert.equal(everyStack(bot).length, 10, 'every slot and the cursor');
    assert.equal(offHand(bot).slot, 45);
    assert.equal(wornArmor(bot).length, 2);
    assert.deepEqual(gridSlotsHeld(bot), [1, 2]);
    assert.equal(hotbar(bot)[0].name, 'spartanweaponry:club_wood');
    assert.equal(freeUsableSlot(bot), 11);
    assert.equal(freeUsableSlot({ inventory: { slots: new Array(46).fill(null) } }, 9), 10);
    assert.deepEqual(view({}).usable, [], 'no inventory: empty, never a throw');
    assert.equal(SLOTS.OFF_HAND, 45);
});

test('round 17 V (the lead): every reader gives the same answer on one inventory with a stack in every section', () => {
    const bot = everySection();
    // Crafting and placing: the usable stacks only (never the grid, the result or the cursor).
    assert.equal(findItem(bot, 'pyrotech:rock')?.slot, 9);
    assert.equal(findItem(bot, 'dirt'), null, 'the result slot holds no dirt the bot has');
    // Counts of what the bot carries: the usable stacks and the off hand.
    assert.equal(countItem(bot, 'pyrotech:rock'), 4, 'the 5 rocks in the grid do not count');
    assert.equal(countItem(bot, 'stone_pickaxe'), 1, 'the off hand counts');
    assert.equal(countItem(bot, 'wooden_pickaxe'), 0, 'the cursor does not');
    assert.deepEqual(carriedItems(bot).map(s => s.slot), [9, 10, 36, 45]);
    // world.getInventoryCounts (the crafting plan, the state report): carried, no grid, result, cursor or armour.
    const counts = getInventoryCounts(bot);
    assert.equal(counts['pyrotech:rock:0'] ?? counts['pyrotech:rock'], 4);
    assert.equal(counts.dirt, undefined, 'no phantom dirt (soak 15)');
    assert.equal(counts.leather_helmet, undefined, 'worn armour is not carried');
    assert.equal(counts.stone_pickaxe, 1);
    // world.getInventoryTotals (the crafting planner's bare names): the usable stacks.
    assert.deepEqual(getInventoryTotals(bot), { 'pyrotech:rock': 4, bread: 2, 'spartanweaponry:club_wood': 1 });
    // The food held: bread in slot 10 (and an off-hand food would count too).
    const food = heldFoodPoints(bot);
    assert.ok(food > 0);
    bot.slots[45] = st('bread', 1, 45);
    assert.ok(heldFoodPoints(bot) > food, 'off-hand food counts');
});

test('round 17 V: !inventory prints the view\'s sections, the crafting result slot named apart', async (t) => {
    t.mock.method(console, 'log', () => {});
    await import('../agent.js'); // the real import order (commands/index.js first)
    const { queryList } = await import('../commands/queries.js');
    const bot = { ...everySection(), game: { gameMode: 'survival' } };
    const out = queryList.find(q => q.name === '!inventory').perform({ bot });
    assert.match(out, /- pyrotech:rock(:0)?: 4\n/);
    assert.match(out, /IN THE 2x2 CRAFTING GRID \(not usable until moved back; the next craft returns them first\): 5 pyrotech:rock/);
    assert.match(out, /IN THE CRAFTING RESULT SLOT \(not held: what the grid would make\): 1 dirt/);
    assert.match(out, /ON THE CURSOR: 1 wooden_pickaxe/);
    assert.match(out, /IN THE OFF HAND: 1 stone_pickaxe \(kept at a death/);
    assert.match(out, /WEARING: \nHead: leather_helmet\nFeet: iron_boots/);
    assert.doesNotMatch(out, /- dirt/);
});

// The static check (the lead's plan): no module reads window slots itself; only the view and the window click layer.
const ALLOWED_FILES = new Set(['library/inventory_view.js', 'library/inventory_sync.js']);
test('round 17 V: no module under src/agent reads inventory slots itself (only inventory_view.js and the click layer, inventory_sync.js)', () => {
    const root = new URL('..', import.meta.url).pathname;
    const files = [];
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js') && !p.endsWith('.test.js')) files.push(p); } };
    walk(root);
    const bad = [];
    for (const f of files) {
        const rel = relative(root, f);
        if (ALLOWED_FILES.has(rel)) continue;
        const ast = espree.parse(readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', loc: true });
        const visit = (n) => {
            if (!n || typeof n.type !== 'string') return;
            // x.slots / x?.slots on an inventory (bot.inventory.slots, inv.slots...), and x.selectedItem.
            if (n.type === 'MemberExpression' && !n.computed && ['slots', 'selectedItem'].includes(n.property?.name)) {
                const obj = n.object;
                const objName = obj?.type === 'MemberExpression' ? obj.property?.name : obj?.name;
                if (/inventory|^inv$/.test(objName ?? '')) bad.push(`${rel}:${n.loc.start.line} ${objName}.${n.property.name}`);
            }
            for (const k of Object.keys(n)) {
                if (k === 'loc') continue;
                const v = n[k];
                if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v);
            }
        };
        visit(ast);
    }
    assert.deepEqual(bad, []);
});

// ---- V2: the idle repair of the hands ----
function idleBot({ held = null, off = null, items = [] } = {}) {
    const slots = new Array(46).fill(null);
    items.forEach((it, i) => { slots[9 + i] = { ...it, slot: 9 + i }; });
    if (off) slots[45] = { ...off, slot: 45 };
    const bot = { inventory: { slots, items: () => slots.slice(9, 45).filter(Boolean), selectedItem: null }, heldItem: held, modes: { anyActive: () => false } };
    return bot;
}

test('round 17 V2: armsWrong: a pickaxe carried but not in the off hand, a weapon carried but not in the main hand', () => {
    const pick = { name: 'stone_pickaxe', count: 1, metadata: 0 }, club = { name: 'spartanweaponry:club_wood', count: 1, metadata: 0 };
    assert.equal(armsWrong(idleBot({ off: pick, held: club, items: [club] })), null, 'both right');
    const w = armsWrong(idleBot({ held: null, items: [pick, club] }));
    assert.deepEqual([w.pickWrong, w.weaponWrong], [true, true]);
    assert.equal(armsWrong(idleBot({ items: [] })), null, 'nothing to arm');
});

test('round 17 V2: idle with the pickaxe in the inventory: re-armed once per state; never while the model\'s !equip holds, a container is open, a reflex acts or an action runs', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    t.mock.method(console, 'warn', () => {});
    const pick = { name: 'stone_pickaxe', count: 1, metadata: 0 };
    const bot = idleBot({ items: [pick] });
    let rearms = 0;
    // rearmWeapon moves the pickaxe to the off hand through bot.equip; a fake that does so.
    bot.equip = (item, dest) => { rearms++; if (dest === 'off-hand') { bot.inventory.slots[45] = { ...item, slot: 45 }; bot.inventory.slots[item.slot] = null; } return Promise.resolve(); };
    const agent = { bot, actions: { executing: false } };
    await idleHands(agent);
    assert.ok(rearms >= 1, 'the pickaxe goes to the off hand');
    assert.equal(bot.inventory.slots[45]?.name, 'stone_pickaxe');
    assert.ok(lines.some(l => /^\[hands\] idle: the pickaxe is not in the off hand: re-arming$/.test(l)), lines.join('\n'));
    const before = rearms;
    await idleHands(agent);
    assert.equal(rearms, before, 'right now: nothing more');
    // The model's !equip holds until its next action.
    const b2 = idleBot({ items: [pick] });
    b2.equip = () => { throw new Error('no re-arm'); };
    await handsAfter(b2, 'action:equip');
    assert.equal(b2.rotnModelEquip, true);
    assert.equal(await idleHands({ bot: b2, actions: { executing: false } }), null);
    // A container open, a reflex acting, an action running: no click.
    const b3 = idleBot({ items: [pick] });
    b3.equip = () => { throw new Error('no click'); };
    b3.currentWindow = { id: 5 };
    assert.equal(await idleHands({ bot: b3, actions: { executing: false } }), null);
    b3.currentWindow = null;
    b3.modes = { anyActive: () => true };
    assert.equal(await idleHands({ bot: b3, actions: { executing: false } }), null);
    b3.modes = { anyActive: () => false };
    assert.equal(await idleHands({ bot: b3, actions: { executing: true } }), null);
});
