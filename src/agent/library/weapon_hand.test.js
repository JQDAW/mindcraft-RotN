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
