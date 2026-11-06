// Offline tests for rotn-data #288 (the human's play report, confirmed by rotn-data): dirt and grass
// dug by hand, or with any tool but a shovel of level 1 or higher, drop 4 betterwithmods:dirt_pile,
// not a dirt block; 4 piles make 1 dirt in the inventory grid. A shovel of level 1+ (flint, bone,
// quartz, redstone, iron) gets the dirt block. So: worldSources passes the rule's unlessTool on;
// collecting dirt piles never equips or keeps holding such a shovel; and !collectBlocks("dirt")
// without one collects piles and crafts them. A fake bot on the 1.12.2 registry plus the modded
// pile item; the real rotn-data rules and tool levels. No server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { worldSources, handRoute, isToolFor } from './rotn_sources.js';
import * as skills from './skills.js';

const PILE = 'betterwithmods:dirt_pile';
const vanilla = minecraftData('1.12.2');
const reg = { ...vanilla, items: { ...vanilla.items }, itemsByName: { ...vanilla.itemsByName } };
reg.items[5100] = { id: 5100, name: PILE, stackSize: 64 };
reg.itemsByName[PILE] = reg.items[5100];
__setRegistryForTest(reg);

const SHOVEL_1 = { type: 'shovel', minLevel: 1 };
const block = (name, x) => ({
    name, metadata: 0, type: reg.blocksByName[name].id, position: new Vec3(x, 63, 0),
    canHarvest: () => true, boundingBox: 'block', transparent: false, shapes: [[0, 0, 0, 1, 1, 1]],
});
const item = (name, count = 1) => ({ name, metadata: 0, count, type: reg.itemsByName[name].id });

/** A flat dirt and grass field; a break drops what RotN drops for the held tool (rotn-data #288). */
function fakeBot({ items = [], held = null, field = 6 } = {}) {
    const calls = { equip: [], unequip: 0, collected: [], dug: [], heldAtDig: [] };
    const remaining = Array.from({ length: field }, (_, i) => block(i % 2 ? 'grass' : 'dirt', i + 1));
    const bot = {
        calls, registry: reg, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival' },
        entity: { position: new Vec3(0, 64, 0), height: 1.8 }, entities: {},
        heldItem: held,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => items.filter(i => i.count > 0), slots: [] },
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            return remaining.filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance)
                .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
                .slice(0, count).map(b => b.position);
        },
        blockAt: (pos) => remaining.find(b => b.position.equals(pos)) ?? null,
        equip: (it) => { calls.equip.push(it.name); bot.heldItem = it; return Promise.resolve(); },
        unequip: () => { calls.unequip++; bot.heldItem = null; return Promise.resolve(); },
        // Like mineflayer-tool: the fastest tool for dirt is the best shovel held.
        tool: {
            equipForBlock: () => {
                const shovel = items.find(i => /shovel/.test(i.name));
                if (shovel) { calls.equip.push(shovel.name); bot.heldItem = shovel; }
                return Promise.resolve();
            },
        },
        // mineflayer-collectblock equips the fastest tool itself.
        collectBlock: { collect: (b) => { calls.collected.push(b); bot.tool.equipForBlock(b); breakBlock(b); return Promise.resolve(); } },
        dig: (b) => { calls.dug.push(b.name); calls.heldAtDig.push(bot.heldItem?.name ?? null); breakBlock(b); return Promise.resolve(); },
        pathfinder: { setMovements() {}, stop() {}, setGoal() {}, isMoving: () => false, goto: () => Promise.resolve(), getPathTo: () => ({ status: 'success', path: [] }) },
        lookAt: () => Promise.resolve(),
        nearestEntity: () => null,
    };
    function breakBlock(b) {
        remaining.splice(remaining.indexOf(b), 1);
        const [name, count] = isToolFor(bot.heldItem, SHOVEL_1) ? ['dirt', 1] : [PILE, 4];
        const stack = items.find(i => i.name === name);
        if (stack) stack.count += count;
        else items.push(item(name, count));
    }
    return { bot, items, calls };
}
const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };
const count = (items, name) => items.filter(i => i.name === name).reduce((n, i) => n + i.count, 0);

test('rotn-data #288: worldSources passes unlessTool on (dirt piles unless a shovel of level 1+); dirt itself needs that shovel', () => {
    const piles = worldSources(PILE).find(s => s.id === 'dirt-piles');
    assert.ok(piles, 'the dirt-piles rule');
    assert.equal(piles.tool, null, 'by hand');
    assert.deepEqual(piles.unlessTool, SHOVEL_1);
    assert.ok(piles.blocks.includes('grass') && piles.blocks.some(b => /^dirt/.test(b)));
    const dirt = worldSources('dirt');
    assert.equal(dirt[0].id, 'dirt-with-shovel', 'the first way to dirt is now the shovel route');
    assert.deepEqual(dirt[0].tool, SHOVEL_1);
    for (const s of worldSources('pyrotech:rock')) assert.equal(s.unlessTool, null, 'other rules carry none');
    assert.equal(isToolFor(item('iron_shovel'), SHOVEL_1), true);
    assert.equal(isToolFor(item('stone_shovel'), SHOVEL_1), false, 'stone shovels are level 0');
});

test('rotn-data #288: collecting dirt piles never equips a level-1+ shovel, and puts away one held, digging by hand', { timeout: 20000 }, async (t) => {
    quiet(t);
    const { bot, items, calls } = fakeBot({ items: [item('iron_shovel')], held: item('iron_shovel') });
    assert.equal(await skills.collectBlock(bot, PILE, 8), true, bot.output);
    assert.equal(count(items, PILE), 8, '2 blocks by hand, 4 piles each');
    assert.equal(count(items, 'dirt'), 0);
    assert.ok(!calls.equip.includes('iron_shovel'), `equipped ${calls.equip}`);
    assert.ok(calls.unequip >= 1, 'the held iron shovel was put away');
    assert.deepEqual(calls.heldAtDig, [null, null], 'never holding it while digging');
    assert.equal(calls.collected.length, 0, 'not mineflayer-collectblock, which equips the fastest tool');
});

test('rotn-data #288: !collectBlocks("dirt") without a level-1 shovel collects 4 piles per dirt and crafts them; with one it digs dirt', { timeout: 20000 }, async (t) => {
    quiet(t);
    const route = handRoute(fakeBot().bot, 'dirt');
    assert.deepEqual({ input: route.input, per: route.per, gives: route.gives }, { input: PILE, per: 4, gives: 'dirt:0' });

    const { bot, items, calls } = fakeBot({ items: [item('stone_shovel'), item(PILE, 2)] });
    const crafts = [];
    t.mock.method(skills.COLLECT_ROUTE_OPS, 'craft', (b, name, n) => {
        crafts.push([name, n]);
        items.find(i => i.name === PILE).count -= 4 * n;
        items.push(item('dirt', n));
        return Promise.resolve(true);
    });
    assert.equal(await skills.collectBlock(bot, 'dirt', 3), true, bot.output);
    assert.deepEqual(crafts, [['dirt:0', 3]]);
    assert.equal(count(items, 'dirt'), 3);
    assert.equal(calls.dug.length, 3, '10 piles still needed (2 held): 3 blocks by hand');
    assert.match(bot.output, /dirt drops itself only with a shovel of level 1 or higher\. By hand: .*Collecting betterwithmods:dirt_pile \(4 per dirt\) and crafting\./);
    assert.match(bot.output, /Collected 3 dirt \(crafted from betterwithmods:dirt_pile\)\./);
    assert.doesNotMatch(bot.output, /got no dirt/);

    // A level-1 shovel: the shovel route, no piles, no crafting.
    const withShovel = fakeBot({ items: [item('iron_shovel')] });
    crafts.length = 0;
    assert.equal(await skills.collectBlock(withShovel.bot, 'dirt', 2), true, withShovel.bot.output);
    assert.equal(count(withShovel.items, 'dirt'), 2);
    assert.equal(count(withShovel.items, PILE), 0);
    assert.deepEqual(crafts, []);
    assert.deepEqual(withShovel.calls.heldAtDig, ['iron_shovel', 'iron_shovel']);
});
