// Soak 12 (C, death 2 at 15:14:40): the fight held raw mutton with the club in the off hand, and nothing
// in the journal said why (equipHighestAttack's texts went only to the action's output). Now: the
// off-hand club, once moved, is read back for 2 ticks before the weapon is picked; and every way it
// returns false is logged once per fight ("[survival] no weapon in hand: ...").
// Offline: a fake inventory (slots 9-44 the inventory, 45 the off hand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equipHighestAttack, EQUIP_READBACK } from './skills.js';

const club = () => ({ name: 'spartanweaponry:club_wood', metadata: 48, count: 1, type: 1 });
const mutton = () => ({ name: 'animania:raw_prime_mutton', metadata: 0, count: 1, type: 2, slot: 36 });

/** moveMs: the moved stack shows in its new slot this long after the move resolved (a server's update). */
function fakeBot({ moveMs = 0, equipFails = false, offHand = club() } = {}) {
    const slots = new Array(46).fill(null);
    slots[45] = offHand;
    const held = mutton();
    slots[36] = held;
    const bot = {
        heldItem: held, output: '',
        inventory: { slots, items: () => slots.slice(9, 45).filter(Boolean), firstEmptyInventorySlot: () => slots.findIndex((s, i) => i >= 9 && i < 45 && !s) },
        moveSlotItem: (from, to) => {
            const s = slots[from];
            slots[from] = null;
            if (moveMs) setTimeout(() => { slots[to] = { ...s, slot: to }; }, moveMs);
            else slots[to] = { ...s, slot: to };
            return Promise.resolve();
        },
        equip: (item) => (equipFails ? Promise.reject(new Error('rejected')) : (bot.heldItem = item, Promise.resolve())),
    };
    return bot;
}

test('soak 12 (C): the club moved out of the off hand shows a tick late: read back, then held (death 2 held mutton)', async (t) => {
    t.mock.method(console, 'log', () => {});
    assert.deepEqual(EQUIP_READBACK, { tries: 2, stepMs: 50 });
    const bot = fakeBot({ moveMs: 30 });
    assert.equal(await equipHighestAttack(bot, {}), true);
    assert.equal(bot.heldItem.name, 'spartanweaponry:club_wood');
});

test('soak 12 (C): every false path is logged to the journal, once per fight', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    // The moved club never shows (the server undid the click).
    const lost = fakeBot({ moveMs: 10_000 });
    const fight = {};
    assert.equal(await equipHighestAttack(lost, fight), false);
    assert.equal(await equipHighestAttack(lost, fight), false);
    assert.deepEqual(logs.filter(l => l.startsWith('[survival] no weapon in hand')),
        ['[survival] no weapon in hand: the spartanweaponry:club_wood moved out of the off hand, but no weapon is in the inventory; holding animania:raw_prime_mutton'], 'once per fight');
    // The equip rejected.
    logs.length = 0;
    assert.equal(await equipHighestAttack(fakeBot({ equipFails: true }), {}), false);
    assert.ok(logs.some(l => /^\[survival\] no weapon in hand: the spartanweaponry:club_wood could not be taken in hand \(.*rejected.*\); holding animania:raw_prime_mutton$/.test(l)), logs.join('\n'));
    // No weapon at all.
    logs.length = 0;
    assert.equal(await equipHighestAttack(fakeBot({ offHand: null }), {}), false);
    assert.deepEqual(logs, ['[survival] no weapon in hand: none held; holding animania:raw_prime_mutton']);
});

test('#593 review 6: outside a fight (an attack, the hunt\'s equip: no fight object) "none held" is not logged', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    assert.equal(await equipHighestAttack(fakeBot({ offHand: null })), false);
    assert.deepEqual(logs, []);
    // A failure with a weapon held is still said outside a fight.
    assert.equal(await equipHighestAttack(fakeBot({ equipFails: true })), false);
    assert.equal(logs.filter(l => l.startsWith('[survival] no weapon in hand')).length, 1);
});

// Soak 14 (F2, the lead): death 2 lost the stone pickaxe (Corpse Complex keeps only the two hands), and every later
// hole site was "not quick to dig by hand". From the stone pickaxe on: the pickaxe in the off hand, the weapon in the
// main hand; before a dig the off-hand pickaxe goes back into the inventory (inventory.items() leaves slot 45 out).
function handsBot({ off = null, items = [] } = {}) {
    const slots = new Array(46).fill(null);
    slots[45] = off;
    items.forEach((it, i) => { slots[36 + i] = { ...it, slot: 36 + i }; });
    const bot = {
        heldItem: null, output: '',
        inventory: { slots, items: () => slots.slice(9, 45).filter(Boolean), firstEmptyInventorySlot: () => slots.findIndex((s, i) => i >= 9 && i < 45 && !s) },
        moveSlotItem: (from, to) => { const s = slots[from]; slots[from] = null; slots[to] = s ? { ...s, slot: to } : null; return Promise.resolve(); },
        equip: (item, dest) => {
            const from = slots.findIndex(s => s && s.name === item.name);
            if (dest === 'off-hand') { const prev = slots[45]; slots[45] = { ...item, slot: 45 }; slots[from] = prev ? { ...prev, slot: from } : null; }
            else { slots[from] = bot.heldItem ? { ...bot.heldItem, slot: from } : null; bot.heldItem = { ...item }; }
            return Promise.resolve();
        },
    };
    return { bot, slots };
}

test('soak 14 (F2): rearmWeapon puts the stone pickaxe in the off hand and the weapon in the main hand; with no pickaxe the weapon goes to the off hand as before', async () => {
    const { rearmWeapon, offHandToolBack, isPickaxeItem } = await import('./skills.js');
    const pick = { name: 'stone_pickaxe', metadata: 0, count: 1, type: 3 };
    assert.equal(isPickaxeItem(pick), true);
    assert.equal(isPickaxeItem(club()), false);
    const { bot, slots } = handsBot({ off: club(), items: [pick] });
    assert.equal(await rearmWeapon(bot), true);
    assert.equal(slots[45].name, 'stone_pickaxe', 'the pickaxe in the off hand (kept at a death)');
    assert.equal(bot.heldItem.name, 'spartanweaponry:club_wood', 'the club in the main hand');
    // Before a dig: the pickaxe back into the inventory, where the tool lookups see it.
    assert.equal(await offHandToolBack(bot), true);
    assert.equal(slots[45], null);
    assert.ok(bot.inventory.items().some(i => i.name === 'stone_pickaxe'));
    assert.equal(await offHandToolBack(bot), false, 'nothing there: no move');
    // No pickaxe: the club in the off hand, as before (soak 11 A3).
    const plain = handsBot({ items: [club()] });
    assert.equal(await rearmWeapon(plain.bot), true);
    assert.equal(plain.slots[45].name, 'spartanweaponry:club_wood');
});

// #614 review 1 (blocking): an off-hand pickaxe was invisible to toolLevels/allowedTool/hasPickaxe/carriedTools/countItem
// (inventory.items() skips slot 45): after rearmWeapon the bot believed it had none. Now one carriedItems reads both.
test('#614 review 1: after rearmWeapon the off-hand pickaxe is a held pickaxe: toolLevels, allowedTool, hasPickaxe, burrowDiggable(stone), digMs(stone), countItem, the agenda', async () => {
    const { rearmWeapon } = await import('./skills.js');
    const { toolLevels, allowedTool } = await import('./rotn_sources.js');
    const { countItem, carriedItems } = await import('./rotn_names.js');
    const { hasPickaxe } = await import('./shelter_ground.js');
    const { burrowDiggable } = await import('./burrow.js');
    const { digMs } = await import('./walk_exit.js');
    const { agendaState } = await import('../agenda_driver.js');
    const pick = { name: 'stone_pickaxe', metadata: 0, count: 1, type: 3 };
    const { bot, slots } = handsBot({ off: club(), items: [pick] });
    await rearmWeapon(bot);
    assert.equal(slots[45].name, 'stone_pickaxe');
    assert.ok(!bot.inventory.items().some(i => i.name === 'stone_pickaxe'), 'not in inventory.items() (as mineflayer)');
    assert.ok(carriedItems(bot).some(i => i.name === 'stone_pickaxe'));
    assert.deepEqual(toolLevels(bot, 'pickaxe'), [0]);
    assert.equal(allowedTool(bot, { type: 'pickaxe', minLevel: 0 })?.name, 'stone_pickaxe', 'equipped straight from the off hand');
    assert.equal(hasPickaxe(bot), true);
    assert.equal(countItem(bot, 'stone_pickaxe'), 1);
    const stone = { name: 'stone', metadata: 0, boundingBox: 'block', position: { x: 1, y: 63, z: 0 } };
    assert.equal(burrowDiggable(bot, stone), true, 'a burrow (and the respawn escape) digs stone with it');
    assert.ok(Number.isFinite(digMs(bot, stone)) && digMs(bot, stone) < 1000, `stone with the stone pickaxe: ${digMs(bot, stone)} ms`);
    Object.assign(bot, { time: { timeOfDay: 1000 }, entity: { position: { x: 0, y: 64, z: 0 } }, entities: {} });
    assert.equal(agendaState(bot).hasPickaxe(), true, 'the agenda: no "no pickaxe yet"');
});

// #614 review 2 (blocking): with no free slot the off-hand pickaxe could not move back for a dig: now it is swapped
// straight into the main hand, and said.
test('#614 review 2: a full inventory: the off-hand pickaxe is swapped into the main hand for the dig, with a log line', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const { offHandToolBack } = await import('./skills.js');
    const pick = { name: 'stone_pickaxe', metadata: 0, count: 1, type: 3, slot: 45 };
    const { bot, slots } = handsBot({ off: pick, items: [club()] });
    for (let i = 9; i < 45; i++) slots[i] ??= { name: 'dirt', metadata: 0, count: 64, type: 4, slot: i };
    const equips = [];
    bot.equip = (item, dest) => { equips.push(`${item.name}@${dest}`); bot.heldItem = item; return Promise.resolve(); };
    assert.equal(await offHandToolBack(bot), true);
    assert.deepEqual(equips, ['stone_pickaxe@hand']);
    assert.ok(logs.includes('[inventory] no free slot: the stone_pickaxe swapped from the off hand into the main hand for the dig'), logs.join('\n'));
});

// #614 review 3: the no-weapon fallback reads the off hand too.
test('#614 review 3: equipHighestAttack with no weapon takes the off-hand pickaxe', async (t) => {
    t.mock.method(console, 'log', () => {});
    const pick = { name: 'stone_pickaxe', metadata: 0, count: 1, type: 3, slot: 45 };
    const { bot } = handsBot({ off: pick, items: [] });
    assert.equal(await equipHighestAttack(bot, {}), true);
    assert.equal(bot.heldItem.name, 'stone_pickaxe');
});

// #614 review 3 (the lead): the eating reflex takes the food into the main hand; at dusk or night it re-arms after the eat
// (the club back in hand, the pickaxe in the off hand), so a death keeps both. By day it does not.
test('#614 review 3: after an eat at night the weapon is back in the main hand; by day the hands are left', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const { __modeForTest } = await import('../modes.js');
    const { NIGHT_START } = await import('./night.js');
    const run = async (timeOfDay) => {
        const pick = { name: 'stone_pickaxe', metadata: 0, count: 1, type: 3, slot: 45 };
        const bread = { name: 'bread', metadata: 0, count: 2, type: 5 };
        const { bot } = handsBot({ off: pick, items: [club(), bread] });
        bot.heldItem = bot.inventory.items().find(i => i.name === 'spartanweaponry:club_wood');
        Object.assign(bot, { food: 6, health: 20, time: { timeOfDay }, entity: { position: { x: 0.5, y: 64, z: 0.5 } }, entities: {},
            consume: () => { bot.heldItem.count--; bot.food += 3; return Promise.resolve(); } });
        const mode = __modeForTest('eating');
        Object.assign(mode, { wait_until: -Infinity, fails: {}, given_up: new Set(), check_ms: 1, cut_eat: null, cut_wait: false });
        const agent = { bot, isIdle: () => true, actions: { currentActionLabel: '', resume_func: null, runAction: async (l, fn) => { await fn(); return { message: 'ok', interrupted: false }; } } };
        await mode.update(agent);
        await new Promise(r => setTimeout(r, 50));
        return bot;
    };
    const night = await run(NIGHT_START + 2000);
    assert.equal(night.food, 9, 'it ate');
    assert.equal(night.heldItem.name, 'spartanweaponry:club_wood', 'night: re-armed');
    assert.equal(night.inventory.slots[45].name, 'stone_pickaxe');
    const day = await run(1000);
    assert.equal(day.food, 9);
    assert.equal(day.heldItem.name, 'bread', 'day: no re-arm');
});
