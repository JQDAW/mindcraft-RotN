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

/**
 * A flat dirt and grass field; a break drops what RotN drops for the held tool (rotn-data #288).
 * The inventory is mineflayer's player window: slots 9-44, the hotbar 36-44 (held: the quick-bar
 * slot). unequip('hand') is mineflayer's equipEmpty: an empty hotbar slot, else the stack moves to
 * a free slot, else it is TOSSED (#291 review). held goes in hotbar slot 0, hotbar in 1-8, items
 * in the main inventory; fill fills every free slot with that block.
 */
function fakeBot({ items = [], held = null, hotbar = [], fill = null, field = 6 } = {}) {
    const calls = { equip: [], unequip: 0, switched: [], tossed: [], lost: [], collected: [], dug: [], heldAtDig: [] };
    const remaining = Array.from({ length: field }, (_, i) => block(i % 2 ? 'grass' : 'dirt', i + 1));
    const slots = new Array(46).fill(null);
    if (held) slots[36] = held;
    hotbar.forEach((it, i) => { slots[37 + i] = it; });
    items.forEach((it, i) => { slots[9 + i] = it; });
    if (fill) for (let k = 9; k < 45; k++) slots[k] ??= item(fill, 64);
    let quick = 0;
    const firstEmpty = () => { for (let k = 9; k < 45; k++) if (!slots[k]) return k; return null; };
    const bot = {
        calls, registry: reg, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival' },
        entity: { position: new Vec3(0, 64, 0), height: 1.8 }, entities: {},
        get heldItem() { return slots[36 + quick] ?? null; },
        get quickBarSlot() { return quick; },
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => slots.slice(9, 45).filter(i => i && i.count > 0), slots, firstEmptyInventorySlot: firstEmpty },
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            return remaining.filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance)
                .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
                .slice(0, count).map(b => b.position);
        },
        blockAt: (pos) => remaining.find(b => b.position.equals(pos)) ?? null,
        setQuickBarSlot: (i) => { quick = i; calls.switched.push(i); },
        equip: (it) => {
            calls.equip.push(it.name);
            const from = slots.indexOf(it), to = 36 + quick;
            if (from >= 0 && from !== to) [slots[from], slots[to]] = [slots[to], slots[from]];
            return Promise.resolve();
        },
        unequip: () => {
            calls.unequip++;
            for (let i = 0; i < 9; i++) if (!slots[36 + i]) { quick = i; return Promise.resolve(); }
            const k = firstEmpty();
            if (k == null) { calls.tossed.push(slots[36 + quick]?.name); slots[36 + quick] = null; } // mineflayer: tossStack
            else { slots[k] = slots[36 + quick]; slots[36 + quick] = null; }
            return Promise.resolve();
        },
        // Like mineflayer-tool: the fastest tool for dirt is the best shovel held.
        tool: {
            equipForBlock: () => {
                const shovel = bot.inventory.items().find(i => /shovel/.test(i.name));
                return shovel ? bot.equip(shovel) : Promise.resolve();
            },
        },
        // mineflayer-collectblock equips the fastest tool itself.
        collectBlock: { collect: async (b) => { calls.collected.push(b); await bot.tool.equipForBlock(b); breakBlock(b); } },
        dig: (b) => { calls.dug.push(b.name); calls.heldAtDig.push(bot.heldItem?.name ?? null); breakBlock(b); return Promise.resolve(); },
        pathfinder: { setMovements() {}, stop() {}, setGoal() {}, isMoving: () => false, goto: () => Promise.resolve(), getPathTo: () => ({ status: 'success', path: [] }) },
        lookAt: () => Promise.resolve(),
        nearestEntity: () => null,
    };
    function breakBlock(b) {
        remaining.splice(remaining.indexOf(b), 1);
        const [name, n] = isToolFor(bot.heldItem, SHOVEL_1) ? ['dirt', 1] : [PILE, 4];
        add(name, n);
    }
    /** Into a stack of the same item, else a free slot; with none the drop stays on the ground. */
    function add(name, n) {
        const stack = slots.slice(9, 45).find(i => i && i.name === name);
        if (stack) { stack.count += n; return; }
        const k = firstEmpty();
        if (k == null) calls.lost.push(name);
        else slots[k] = item(name, n);
    }
    return { bot, calls, add, items: () => bot.inventory.items() };
}
const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };
const count = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);

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
    const { bot, calls } = fakeBot({ held: item('iron_shovel') });
    assert.equal(await skills.collectBlock(bot, PILE, 8), true, bot.output);
    assert.equal(count(bot, PILE), 8, '2 blocks by hand, 4 piles each');
    assert.equal(count(bot, 'dirt'), 0);
    assert.ok(!calls.equip.includes('iron_shovel'), `equipped ${calls.equip}`);
    assert.deepEqual(calls.switched.slice(0, 1), [1], 'switched to an empty hotbar slot');
    assert.deepEqual(calls.heldAtDig, [null, null], 'never holding it while digging');
    assert.equal(calls.collected.length, 0, 'not mineflayer-collectblock, which equips the fastest tool');
    assert.equal(count(bot, 'iron_shovel'), 1);
});

test('#291 review: with a full inventory the held shovel is never tossed: another hotbar item is held, or the dig is skipped with the reason', { timeout: 20000 }, async (t) => {
    quiet(t);
    // Full, but the hotbar holds stone too: hold the stone (a block is not a shovel) and dig.
    const full = fakeBot({ held: item('iron_shovel'), hotbar: [item('stone', 64)], fill: 'stone' });
    assert.equal(full.bot.inventory.firstEmptyInventorySlot(), null);
    await skills.collectBlock(full.bot, PILE, 4);
    assert.deepEqual(full.calls.tossed, [], 'nothing thrown away');
    assert.equal(full.calls.unequip, 0, 'no unequip: with no free slot it would toss the shovel');
    assert.equal(count(full.bot, 'iron_shovel'), 1);
    assert.deepEqual(full.calls.heldAtDig.slice(0, 1), ['stone']);

    // Full, and every hotbar slot holds a level-1 shovel: no way to let go without tossing it.
    const shovels = fakeBot({ held: item('iron_shovel'), hotbar: Array.from({ length: 8 }, () => item('iron_shovel')), fill: 'stone' });
    assert.equal(await skills.collectBlock(shovels.bot, PILE, 4), false);
    assert.deepEqual(shovels.calls.tossed, []);
    assert.equal(shovels.calls.unequip, 0);
    assert.deepEqual(shovels.calls.dug, [], 'the dig is skipped');
    assert.equal(count(shovels.bot, 'iron_shovel'), 9);
    assert.match(shovels.bot.output, /Not digging dirt: you hold iron_shovel, which would make it drop dirt instead of betterwithmods:dirt_pile, and with a full inventory and no other item in the hotbar it could only be let go by throwing it away\. Free a slot first\./);

    // A free inventory slot but a full hotbar of shovels: unequip moves it there, nothing is tossed.
    const roomy = fakeBot({ held: item('iron_shovel'), hotbar: Array.from({ length: 8 }, () => item('iron_shovel')) });
    assert.equal(await skills.collectBlock(roomy.bot, PILE, 4), true, roomy.bot.output);
    assert.equal(roomy.calls.unequip, 1);
    assert.deepEqual(roomy.calls.tossed, []);
    assert.equal(count(roomy.bot, 'iron_shovel'), 9);
    assert.deepEqual(roomy.calls.heldAtDig, [null]);
});

test('rotn-data #288: !collectBlocks("dirt") without a level-1 shovel collects 4 piles per dirt and crafts them; with one it digs dirt', { timeout: 20000 }, async (t) => {
    quiet(t);
    const route = handRoute(fakeBot().bot, 'dirt');
    assert.deepEqual({ input: route.input, per: route.per, gives: route.gives }, { input: PILE, per: 4, gives: 'dirt:0' });

    const { bot, calls, add } = fakeBot({ items: [item('stone_shovel'), item(PILE, 2)] });
    const crafts = [];
    t.mock.method(skills.COLLECT_ROUTE_OPS, 'craft', (b, name, n) => {
        crafts.push([name, n]);
        b.inventory.items().find(i => i.name === PILE).count -= 4 * n;
        add('dirt', n);
        return Promise.resolve(true);
    });
    assert.equal(await skills.collectBlock(bot, 'dirt', 3), true, bot.output);
    assert.deepEqual(crafts, [['dirt:0', 3]]);
    assert.equal(count(bot, 'dirt'), 3);
    assert.equal(calls.dug.length, 3, '10 piles still needed (2 held): 3 blocks by hand');
    assert.match(bot.output, /dirt drops itself only with a shovel of level 1 or higher\. By hand: .*Collecting betterwithmods:dirt_pile \(4 per dirt\) and crafting\./);
    assert.match(bot.output, /Collected 3 dirt \(crafted from betterwithmods:dirt_pile\)\./);
    assert.doesNotMatch(bot.output, /got no dirt/);

    // A level-1 shovel: the shovel route, no piles, no crafting.
    const withShovel = fakeBot({ items: [item('iron_shovel')] });
    crafts.length = 0;
    assert.equal(await skills.collectBlock(withShovel.bot, 'dirt', 2), true, withShovel.bot.output);
    assert.equal(count(withShovel.bot, 'dirt'), 2);
    assert.equal(count(withShovel.bot, PILE), 0);
    assert.deepEqual(crafts, []);
    assert.deepEqual(withShovel.calls.heldAtDig, ['iron_shovel', 'iron_shovel']);
});

// G3 round 9 B (#330 correction, harness-ops): after the second death, !collectBlocks("dirt", 10)
// (13:35:51) ignored the night routine's stop: action_manager.stop() asked every 300 ms
// (requestInterrupt: interrupt_code true, stopDigging, pathfinder.stop), each cancelled dig threw,
// collectBlock's catch logged it and went on to the next block, and after 10 s cleanKill killed the
// agent ("Code execution refused stop after 10 seconds. Killing process.", exit 1). On the live
// server the bot would leave and rejoin.
test('round 9 B: a stop during !collectBlocks("dirt") ends the collect at once: no next block, no craft', { timeout: 20000 }, async (t) => {
    quiet(t);
    const { bot, calls } = fakeBot({ field: 20 });
    const crafts = [];
    t.mock.method(skills.COLLECT_ROUTE_OPS, 'craft', (b, name, n) => { crafts.push([name, n]); return Promise.resolve(true); });
    // The stop arrives during the first dig: mineflayer's dig rejects when stopDigging cancels it.
    bot.dig = (b) => {
        calls.dug.push(b.name);
        bot.interrupt_code = true;
        return Promise.reject(new Error('Digging aborted'));
    };
    const started = Date.now();
    assert.equal(await skills.collectBlock(bot, 'dirt', 10), false, bot.output);
    assert.equal(calls.dug.length, 1, `no block after the stop: ${calls.dug.length} digs`);
    assert.deepEqual(crafts, [], 'no craft after the stop');
    assert.ok(Date.now() - started < 2000, 'ends well within the 10 s before the process is killed');
});

test('round 9 B: an interrupted collect of any block stops at the next block, also when its break threw', { timeout: 20000 }, async (t) => {
    quiet(t);
    const { bot, calls } = fakeBot({ field: 20 });
    // A walk the stop cancelled: the break throws (PathStopped), and the interrupt is up.
    bot.dig = () => { calls.dug.push('x'); bot.interrupt_code = true; return Promise.reject(Object.assign(new Error('Path was stopped before it could be completed!'), { name: 'PathStopped' })); };
    await skills.collectBlock(bot, PILE, 40);
    assert.equal(calls.dug.length, 1);
});
