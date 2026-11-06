// Offline tests for the #225 review nit: smeltItem left a furnace it placed behind. On an aborted
// run it returned without picking it up, and after smelting the furnace is often lit
// (lit_furnace), which collectBlock(bot, 'furnace') does not match. Now the furnace it placed is
// picked up by its position, lit or not, however the skill ends. Fake bot; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { blockMatcher } from './rotn_names.js';
import * as skills from './skills.js';

const registry = minecraftData('1.12.2');
__setRegistryForTest(registry);
const FURNACE_AT = new Vec3(1, 64, 0);

/** A bot with logs, coal and a furnace item, no furnace in the world until ops.place puts one. */
function smeltBot({ abortOnPlace = false } = {}) {
    let placed = false;
    const calls = { opened: 0, pickUps: [] };
    let output = { type: registry.itemsByName.coal.id, name: 'coal', count: 1, metadata: 1 }; // charcoal
    const coal = { type: registry.itemsByName.coal.id, name: 'coal', count: 5 };
    const furnaceWindow = {
        inputItem: () => null, fuelItem: () => coal, outputItem: () => output,
        takeOutput: () => { const o = output; output = null; return Promise.resolve(o); },
        putInput: () => Promise.resolve(), takeInput: () => Promise.resolve(), takeFuel: () => Promise.resolve(),
    };
    const items = [
        { type: registry.itemsByName.log.id, name: 'log', count: 1, metadata: 0 },
        { type: registry.itemsByName.furnace.id, name: 'furnace', count: 1, metadata: 0 },
    ];
    const bot = {
        registry, output: '', interrupt_code: false,
        entity: { position: new Vec3(0, 64, 0) },
        modes: { pause() {}, unpause() {}, isOn: () => false },
        inventory: { slots: items, items: () => items },
        findBlocks: () => (placed ? [FURNACE_AT] : []),
        // after smelting the furnace still burns: lit_furnace
        blockAt: (pos) => (placed && pos.equals(FURNACE_AT) ? { name: 'lit_furnace', type: registry.blocksByName.lit_furnace.id, position: pos } : null),
        lookAt: () => Promise.resolve(),
        openFurnace: () => { calls.opened++; return Promise.resolve(furnaceWindow); },
        closeWindow: () => Promise.resolve(),
    };
    const ops = {
        place: () => {
            placed = true;
            if (abortOnPlace) bot.action_run.aborted = true; // the limit hits while it places
            return Promise.resolve(bot.blockAt(FURNACE_AT));
        },
        pickUp: (_bot, pos) => { calls.pickUps.push(pos); return Promise.resolve(true); },
    };
    return { bot, ops, calls };
}

test('#225 nit: the furnace smeltItem placed is picked up after smelting, though it is still lit', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, ops, calls } = smeltBot();
    assert.equal(await skills.smeltItem(bot, 'log', 1, ops), true, bot.output);
    assert.equal(calls.opened, 1);
    assert.deepEqual(calls.pickUps.map(String), [String(FURNACE_AT)]);
    // why the old collectBlock(bot, 'furnace') left it: a lit furnace is another block
    assert.equal(blockMatcher(['furnace'])({ name: 'lit_furnace', metadata: 0 }), false);
});

test('#225 nit: an aborted run right after placing the furnace picks it up and opens nothing', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, ops, calls } = smeltBot({ abortOnPlace: true });
    bot.action_run = { aborted: false };
    assert.equal(await skills.smeltItem(bot, 'log', 1, ops), false);
    assert.equal(calls.opened, 0);
    assert.deepEqual(calls.pickUps.map(String), [String(FURNACE_AT)]);
});

test('pickUpFurnaceAt breaks a lit furnace at its position with the right tool and takes the drop', async (t) => {
    t.mock.method(console, 'log', () => {});
    const dug = [];
    const bot = {
        output: '', game: { gameMode: 'survival' }, heldItem: null,
        entity: { position: new Vec3(0, 64, 0) },
        modes: { isOn: () => false },
        tool: { equipForBlock: () => { bot.heldItem = { type: registry.itemsByName.stone_pickaxe.id }; return Promise.resolve(); } },
        blockAt: (pos) => ({ name: dug.length ? 'air' : 'lit_furnace', position: pos, canHarvest: (id) => id != null }),
        dig: (b) => { dug.push(String(b.position)); return Promise.resolve(); },
        nearestEntity: () => null,
    };
    assert.equal(await skills.pickUpFurnaceAt(bot, FURNACE_AT), true);
    assert.deepEqual(dug, [String(FURNACE_AT)]);
    assert.equal(await skills.pickUpFurnaceAt(bot, FURNACE_AT), false, 'nothing left to pick up');
});

// #238 review 2: placeFurnaceNear identified "its" furnace as the nearest one after placing, so a
// failed placement next to someone else's furnace made smeltItem use and later pick up that one.
test('#238 review 2: placeFurnaceNear returns the furnace at its own position, never the nearest one', async () => {
    const OTHER = new Vec3(0, 64, 1); // someone's furnace, nearer than the free space
    const MINE = new Vec3(3, 64, 0);
    const make = () => {
        const world = new Map([[String(OTHER), 'furnace']]);
        const bot = {
            entity: { position: new Vec3(0, 64, 0) },
            blockAt: (p) => ({ name: world.get(String(p)) ?? 'air', position: p }),
            findBlocks: () => [OTHER],
        };
        return { bot, world };
    };
    const freeSpace = () => MINE;

    const a = make();
    const placed = await skills.placeFurnaceNear(a.bot, 16, {
        freeSpace, place: (_b, _n, x, y, z) => { a.world.set(String(new Vec3(x, y, z)), 'furnace'); return Promise.resolve(true); },
    });
    assert.equal(String(placed?.position), String(MINE), 'its own furnace');

    const b = make();
    assert.equal(await skills.placeFurnaceNear(b.bot, 16, { freeSpace, place: () => Promise.resolve(false) }), null, 'a failed placement: null, not the other furnace');

    const c = make();
    assert.equal(await skills.placeFurnaceNear(c.bot, 16, { freeSpace, place: () => Promise.resolve(true) }), null, 'reported placed, but no furnace there: null');
});

test('#238 review 2: smeltItem with a failed placement says so and picks nothing up', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { bot, ops, calls } = smeltBot();
    ops.place = () => Promise.resolve(null);
    assert.equal(await skills.smeltItem(bot, 'log', 1, ops), false);
    assert.match(bot.output, /Could not place your furnace\./);
    assert.deepEqual(calls.pickUps, []);
    assert.equal(calls.opened, 0);
});
