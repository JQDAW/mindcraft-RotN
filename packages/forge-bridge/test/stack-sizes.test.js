// Soak 15 (N1): bot.registry gets the server's item stack sizes from rotn-data's dump (StackUp), so
// prismarine-windows predicts each click as the 1.12 server performs it. The cases are those of
// /home/rv/soak15-net-forge-clicks.md: before, each predicted wrongly and the server, accepting the
// click, sent nothing to correct it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RegistrySnapshot } from '../src/registries.js';
import { extendRegistry } from '../src/registry-extension.js';
import { applyStackSizes, dumpStackSizes } from '../src/stack-sizes.js';
import { syntheticRegistries } from './helpers.js';
import * as rotnData from '../../rotn-data/index.js';

const require = createRequire(import.meta.url);
const rd = rotnData.loadRotnData(rotnData.PACK_VERSION);
const DUMP_ITEMS = rd.dump.items.items;
const PILE = 5100;
const AEROMETER = 5101; // adpother:aerometer: stacks to 1 on the server

/** A 1.12.2 registry extended with the synthetic registries plus dirt piles and a stack-1 modded item. */
function extended() {
    const registry = require('prismarine-registry')('1.12.2');
    const regs = syntheticRegistries();
    regs[1].ids.push(['betterwithmods:dirt_pile', PILE], ['adpother:aerometer', AEROMETER]);
    const snap = new RegistrySnapshot();
    regs.forEach((r, i) => snap.add({ ...r, hasMore: i < regs.length - 1 }));
    extendRegistry(registry, snap);
    return registry;
}

/** The player window (id 0) on `registry`, with `slots` ({slot: [type, count]}) and a cursor stack. */
function playerWindow(registry, slots, cursor) {
    const Item = require('prismarine-item')(registry);
    const w = require('prismarine-windows')(registry).createWindow(0, 'minecraft:inventory', 'inv', 46);
    for (const [slot, [type, count]] of Object.entries(slots)) w.updateSlot(Number(slot), new Item(type, count));
    if (cursor) w.selectedItem = new Item(cursor[0], cursor[1]);
    return w;
}
const click = (w, slot, mouseButton) => w.acceptClick({ slot, mouseButton, mode: 0, item: w.slots[slot] });
const state = (w, slot) => ({ slot: w.slots[slot]?.count ?? 0, cursor: w.selectedItem?.count ?? 0 });

test('the dump differs from the registry: StackUp sizes, both vanilla and modded; the dump\'s values are the server\'s', () => {
    assert.equal(DUMP_ITEMS['betterwithmods:dirt_pile'].stackSize, 256);
    assert.equal(DUMP_ITEMS['minecraft:dirt'].stackSize, 128);
    assert.equal(DUMP_ITEMS['minecraft:stick'].stackSize, 256);
    assert.equal(DUMP_ITEMS['pyrotech:crude_axe'].stackSize, 1);
    const registry = extended();
    const { properties, vanilla, modded } = dumpStackSizes(DUMP_ITEMS, registry);
    assert.deepEqual(properties.items['betterwithmods:dirt_pile'], { stackSize: 256 });
    assert.deepEqual(properties.items['minecraft:dirt'], { stackSize: 128 });
    assert.equal(properties.items['minecraft:stone_pickaxe'], undefined, 'already 1 in minecraft-data: left out');
    assert.ok(vanilla > 200, `vanilla ${vanilla}`);
    assert.equal(modded, 4, 'the registry\'s modded items that differ: pyrotech:rock, pyrotech:crude_axe, the dirt pile, the aerometer');
});

test('applyStackSizes: bot.registry has the server\'s sizes; minecraft-data\'s shared entries are not changed', () => {
    const registry = extended();
    const shared = require('minecraft-data')('1.12.2');
    const logs = [];
    const report = applyStackSizes(registry, DUMP_ITEMS, { log: (m) => logs.push(m) });
    assert.equal(registry.itemsByName['betterwithmods:dirt_pile'].stackSize, 256);
    assert.equal(registry.items[PILE].stackSize, 256, 'by id too');
    assert.equal(registry.itemsByName['pyrotech:rock'].stackSize, 256);
    assert.equal(registry.itemsByName['pyrotech:crude_axe'].stackSize, 1, 'a modded tool stacks to 1');
    assert.equal(registry.itemsByName['adpother:aerometer'].stackSize, 1);
    assert.equal(registry.itemsByName.dirt.stackSize, 128, 'vanilla dirt');
    assert.equal(registry.itemsByName.stick.stackSize, 256);
    assert.equal(registry.itemsArray.find((i) => i.name === 'dirt').stackSize, 128, 'the array too');
    assert.equal(shared.itemsByName.dirt.stackSize, 64, 'minecraft-data\'s own entry is untouched');
    assert.equal(require('prismarine-registry')('1.12.2').itemsByName.dirt.stackSize, 64, 'a fresh registry still has 64');
    assert.equal(report.changed, report.vanilla + report.modded);
    assert.equal(report.modded, 4);
    assert.deepEqual(report.missing, []);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^stack sizes: \d+ items from the dump \(\d+ vanilla, 4 modded\) differ from 64 or minecraft-data, e\.g\. betterwithmods:dirt_pile 256, pyrotech:rock 256, minecraft:dirt 128, minecraft:stick 256, pyrotech:crude_axe 1$/);
});

test('applyStackSizes refuses an unextended registry (minecraft-data\'s shared maps)', () => {
    assert.throws(() => applyStackSizes(require('prismarine-registry')('1.12.2'), DUMP_ITEMS), /was not extended/);
});

test('prismarine-windows now predicts the soak 15 clicks as the server does them (cases A, B and C)', () => {
    for (const [label, sized, expect] of [['before (64)', false, 'client'], ['after (the dump)', true, 'server']]) {
        const registry = extended();
        if (sized) applyStackSizes(registry, DUMP_ITEMS);
        // A: left-click with 12 piles on a slot of 60. The server (256): slot 72, cursor empty.
        let w = playerWindow(registry, { 20: [PILE, 60] }, [PILE, 12]);
        click(w, 20, 0);
        const a = state(w, 20);
        // B: left-click with 4 piles on a slot of 72. The server: slot 76, cursor empty.
        w = playerWindow(registry, { 11: [PILE, 72] }, [PILE, 4]);
        click(w, 11, 0);
        const b = state(w, 11);
        // C: right-click with 10 piles on a slot of 72. The server: slot 73, cursor 9.
        w = playerWindow(registry, { 11: [PILE, 72] }, [PILE, 10]);
        click(w, 11, 1);
        const c = state(w, 11);
        if (expect === 'client') {
            assert.deepEqual([a, b, c], [{ slot: 64, cursor: 8 }, { slot: 64, cursor: 12 }, { slot: 72, cursor: 10 }], `${label}: the soak 15 mispredictions`);
        } else {
            assert.deepEqual([a, b, c], [{ slot: 72, cursor: 0 }, { slot: 76, cursor: 0 }, { slot: 73, cursor: 9 }], `${label}: the server's results`);
        }
    }
});

test('a modded tool that stacks to 1: a second one swaps instead of merging, as on the server', () => {
    const registry = extended();
    applyStackSizes(registry, DUMP_ITEMS);
    const w = playerWindow(registry, { 36: [5003, 1] }, [5003, 1]);
    click(w, 36, 0);
    assert.deepEqual(state(w, 36), { slot: 1, cursor: 1 }, 'swapped, not 2 in one slot');
});
