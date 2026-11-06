// Offline tests for Hit With Axe sticks (the lead's decision after G3 round 5 A rerun; rotn-data
// #272): before a crafting table exists, logs become planks and planks sticks only by using an axe
// (any axe of level 0 or more) on the placed block. A log: the first use debarks it (+1 bark), the
// second gives 1 plank; a plank gives 2 sticks; each use costs 1 axe durability; the drop lands one
// block toward the player. A fake world and inventory; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import * as skills from './skills.js';

const vanilla = minecraftData('1.12.2');
const reg = { ...vanilla, blocks: { ...vanilla.blocks }, blocksByName: { ...vanilla.blocksByName } };
__setRegistryForTest(reg);
const T = { timeout: 20_000 };
const at = (x, y = 64, z = 0) => new Vec3(x, y, z);
const key = (p) => `${p.x},${p.y},${p.z}`;
const WOOD = ['oak', 'spruce', 'birch', 'jungle'];

/**
 * A bot at 0 64 0 on flat dirt holding `held` ([name, meta, count]); `axeUses`: the axe breaks after
 * that many uses. `dud`: a placed log the axe does nothing to (a log with no Hit With Axe recipe).
 */
function fakeBot(held, { axeUses = 8, dud = false, table = false } = {}) {
    const items = held.map(([name, metadata, count]) => ({ name, metadata, count, type: reg.itemsByName[name]?.id ?? 5000 }));
    const world = new Map();
    if (table) world.set(key(at(-1)), 'crafting_table');
    const entities = {};
    let nextId = 1;
    const log = { clicks: 0, placed: [], crafted: [] };
    const add = (name, metadata, count) => {
        const s = items.find(i => i.name === name && i.metadata === metadata);
        if (s) s.count += count; else items.push({ name, metadata, count, type: reg.itemsByName[name]?.id ?? 5000 });
    };
    const drop = (pos, name, metadata, count) => { const id = nextId++; entities[id] = { id, name: 'item', position: pos.offset(-0.5, 0, 0.5), drop: [name, metadata, count] }; };
    const blockAt = (p) => {
        const q = p.floored ? p.floored() : p;
        const cell = world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air');
        const [name, meta] = cell.split('@');
        return { name, metadata: Number(meta ?? 0), position: q, boundingBox: name === 'air' ? 'empty' : 'block', type: reg.blocksByName[name]?.id ?? 5000 };
    };
    const bot = {
        log, world, entities, registry: reg, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival' },
        entity: { position: at(0).offset(0.5, 0, 0.5), height: 1.8 },
        heldItem: null,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => items.filter(i => i.count > 0), slots: [] },
        blockAt,
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            return [...world.keys()].map(k => blockAt(at(...k.split(',').map(Number))))
                .filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance).slice(0, count).map(b => b.position);
        },
        equip: (item) => { bot.heldItem = item; return Promise.resolve(); },
        lookAt: () => Promise.resolve(),
        activateBlock: (b) => {
            log.clicks++;
            const axe = bot.heldItem;
            if (axe && --axeUses <= 0) axe.count = 0; // it broke
            const cell = world.get(key(b.position));
            if (dud || !cell) return Promise.resolve();
            const [name, meta] = cell.split('@');
            const m = Number(meta ?? 0);
            if (name === 'log') { world.set(key(b.position), `hitwithaxe:debarked_${WOOD[m]}@0`); drop(b.position, 'stick', 99, 0); } // bark: not modelled as an item
            else if (name.startsWith('hitwithaxe:debarked_')) { world.delete(key(b.position)); drop(b.position, 'planks', WOOD.indexOf(name.slice(20)), 1); }
            else if (name === 'planks') { world.delete(key(b.position)); drop(b.position, 'stick', 0, 2); }
            return Promise.resolve();
        },
        recipesFor: (id, meta, n, tbl) => {
            if (id !== reg.itemsByName.stick.id || tbl) return [];
            const p = items.find(i => i.name === 'planks' && i.count >= 2);
            return p ? [{ result: { id, count: 4 }, plank: p, inShape: [[{ id: reg.itemsByName.planks.id, metadata: p.metadata, count: 1 }], [{ id: reg.itemsByName.planks.id, metadata: p.metadata, count: 1 }]] }] : [];
        },
        craft: (r, count) => { log.crafted.push(count); r.plank.count -= 2 * count; add('stick', 0, 4 * count); return Promise.resolve(); },
        armorManager: { equipAll() {} },
        pathfinder: { setMovements() {}, setGoal() {}, stop() {}, isMoving: () => false, goto: () => Promise.resolve() },
    };
    const ops = {
        // Place the named item ("log:1") east of the bot, one block per placement.
        place: (b, name) => {
            const [n, m] = name.split(':');
            const meta = Number(m ?? 0);
            const s = items.find(i => i.name === n && i.metadata === meta && i.count > 0);
            if (!s) return Promise.resolve(null);
            s.count--;
            const pos = at(1 + log.placed.length);
            world.set(key(pos), `${n}@${meta}`);
            log.placed.push(name);
            return Promise.resolve(blockAt(pos));
        },
        pickup: (b, pos) => {
            for (const [id, e] of Object.entries(entities)) {
                if (e.position.distanceTo(pos) > 3) continue;
                delete entities[id];
                const [name, meta, count] = e.drop;
                if (count > 0) add(name, meta, count);
            }
            return Promise.resolve();
        },
    };
    return { bot, ops, count: (name, meta) => items.filter(i => i.name === name && (meta == null || i.metadata === meta)).reduce((n, i) => n + i.count, 0) };
}

function quiet(t) { t.mock.method(console, 'log', () => {}); }

test('no axe: gives up at once with the reason, places nothing', T, async (t) => {
    quiet(t);
    const { bot, ops } = fakeBot([['log', 1, 3]]);
    assert.equal(await skills.sticksByAxe(bot, 2, { aborted: false }, ops), 0);
    assert.deepEqual(bot.log.placed, []);
    assert.match(bot.output, /Not making sticks with an axe: you hold no axe \(a crude, flint or stone axe works\)\./);
});

test('2 logs and a crude axe, no table: 2 planks (one kept for the table), the other chopped for 2 sticks; 5 axe uses', T, async (t) => {
    quiet(t);
    const { bot, ops, count } = fakeBot([['pyrotech:crude_axe', 0, 1], ['log', 1, 2]]);
    assert.equal(await skills.sticksByAxe(bot, 1, { aborted: false }, ops), 2);
    assert.deepEqual(bot.log.placed, ['log:1', 'log:1', 'planks:1'], 'place a log, a log, then a plank');
    assert.equal(bot.log.clicks, 5, '2 + 2 + 1 axe uses');
    assert.equal(count('stick'), 2);
    assert.equal(count('planks'), 1, 'one plank kept for the crafting table');
    assert.equal(count('log'), 0);
    assert.match(bot.output, /Chopping a placed log:1 with the axe for a plank \(2 uses\)\./);
    assert.match(bot.output, /Chopping a placed planks:1 with the axe for 2 sticks\./);
});

test('4 sticks from 3 logs: 3 planks, one kept, the other two crafted in the grid (no axe use for that)', T, async (t) => {
    quiet(t);
    const { bot, ops, count } = fakeBot([['pyrotech:crude_axe', 0, 1], ['log', 0, 3]]);
    assert.equal(await skills.sticksByAxe(bot, 4, { aborted: false }, ops), 4);
    assert.equal(bot.log.clicks, 6);
    assert.deepEqual(bot.log.crafted, [1]);
    assert.equal(count('planks'), 1);
});

test('bounded: a click that changes nothing stops it; the axe breaking stops it; the use cap stops it', T, async (t) => {
    quiet(t);
    const dud = fakeBot([['pyrotech:crude_axe', 0, 1], ['log', 1, 3]], { dud: true });
    assert.equal(await skills.sticksByAxe(dud.bot, 2, { aborted: false }, dud.ops), 0);
    assert.equal(dud.bot.log.clicks, 1);
    assert.match(dud.bot.output, /Using the axe on the placed log changed nothing; stopping\./);

    const worn = fakeBot([['pyrotech:crude_axe', 0, 1], ['log', 1, 3]], { axeUses: 3 });
    assert.equal(await skills.sticksByAxe(worn.bot, 2, { aborted: false }, worn.ops), 0);
    assert.equal(worn.bot.log.clicks, 3);
    assert.match(worn.bot.output, /Your axe broke; stopping\./);

    const capped = fakeBot([['stone_axe', 0, 1], ['log', 1, 3]]);
    assert.equal(await skills.sticksByAxe(capped.bot, 2, { aborted: false }, capped.ops, { clicks: 3 }), 0);
    assert.equal(capped.bot.log.clicks, 3);
    assert.match(capped.bot.output, /Stopped chopping: 3 axe uses in this collect\./);
});

test('nothing to chop: only the plank kept for the table: it is not used, and it says why', T, async (t) => {
    quiet(t);
    const { bot, ops, count } = fakeBot([['pyrotech:crude_axe', 0, 1], ['planks', 0, 1]]);
    assert.equal(await skills.sticksByAxe(bot, 2, { aborted: false }, ops), 0);
    assert.equal(count('planks'), 1);
    assert.match(bot.output, /No logs or spare planks \(one is kept for the crafting table\) to chop with the axe\./);
});

test('!collectBlocks("stick") with no tree and no table near: the axe path makes them', T, async (t) => {
    quiet(t);
    const { bot, ops, count } = fakeBot([['pyrotech:crude_axe', 0, 1], ['log', 1, 2]]);
    const saved = { ...skills.AXE_CHOP_OPS };
    t.after(() => Object.assign(skills.AXE_CHOP_OPS, saved));
    Object.assign(skills.AXE_CHOP_OPS, ops);
    assert.equal(await skills.collectBlock(bot, 'stick', 1), true, bot.output);
    assert.equal(count('stick'), 2);
    assert.match(bot.output, /Collected 2 stick, 2 of them made from planks\./);
});
