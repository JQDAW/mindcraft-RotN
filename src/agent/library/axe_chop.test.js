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
 * A bot at 0 64 0 on flat dirt holding `held` ([name, meta, count]). An axe's metadata is its damage
 * (1.12): each use adds 1, and it breaks past rotn-data's maxDamage (the crude axe's is 8). `axeUses`:
 * it breaks after that many uses anyway (damage the bot did not know of). `dud`: a placed log the axe
 * does nothing to (a log with no Hit With Axe recipe). `abortAt`: the run is aborted at that click.
 */
const MAX_DAMAGE = { 'pyrotech:crude_axe': 8, stone_axe: 131 };
function fakeBot(held, { axeUses = Infinity, dud = false, table = false, abortAt = 0, run = null } = {}) {
    const items = held.map(([name, metadata, count]) => ({ name, metadata, count, type: reg.itemsByName[name]?.id ?? 5000 }));
    const world = new Map();
    if (table) world.set(key(at(-1)), 'crafting_table');
    const entities = {};
    let nextId = 1;
    const log = { clicks: 0, placed: [], crafted: [], digs: [], pickups: 0 };
    const add = (name, metadata, count) => {
        const s = items.find(i => i.name === name && i.metadata === metadata);
        if (s) s.count += count; else items.push({ name, metadata, count, type: reg.itemsByName[name]?.id ?? 5000 });
    };
    const drop = (pos, name, metadata, count) => { const id = nextId++; entities[id] = { id, name: 'item', position: pos.offset(-0.5, 0, 0.5), drop: [name, metadata, count] }; };
    const blockAt = (p) => {
        const q = p.floored ? p.floored() : p;
        const cell = world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air');
        const [name, meta] = cell.split('@');
        const empty = ['air', 'water', 'lava', 'flowing_water', 'flowing_lava'].includes(name);
        return { name, metadata: Number(meta ?? 0), position: q, boundingBox: empty ? 'empty' : 'block', type: reg.blocksByName[name]?.id ?? 5000 };
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
        unequip: () => { bot.heldItem = null; return Promise.resolve(); },
        // Breaking a placed block by hand drops it as an item (a debarked log as itself).
        dig: (b) => {
            if (bot.heldItem) throw new Error('dug with the axe');
            const cell = world.get(key(b.position));
            if (!cell) return Promise.resolve();
            const [name, meta] = cell.split('@');
            world.delete(key(b.position));
            log.digs.push(name);
            drop(b.position, name, Number(meta ?? 0), 1);
            return Promise.resolve();
        },
        lookAt: () => Promise.resolve(),
        activateBlock: (b) => {
            log.clicks++;
            const axe = bot.heldItem;
            if (axe) {
                axe.metadata += 1;
                if (axe.metadata > (MAX_DAMAGE[axe.name] ?? Infinity) || --axeUses <= 0) { axe.count = 0; bot.heldItem = null; } // it broke
            }
            if (abortAt && log.clicks === abortAt && run) run.aborted = true;
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
            log.pickups++;
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

// ---- #274 review 1: the axe keeps a use for the Crafting Tools ----

test('#274 review 1: a worn crude axe chops only while it keeps 1 use; it says so and keeps the axe', T, async (t) => {
    quiet(t);
    // Damage 3 (5 uses left): two logs (4 uses) leave 1, so the plank is not chopped.
    const worn = fakeBot([['pyrotech:crude_axe', 3, 1], ['log', 1, 2]]);
    assert.equal(await skills.sticksByAxe(worn.bot, 1, { aborted: false }, worn.ops), 0);
    assert.equal(worn.bot.log.clicks, 4);
    assert.equal(worn.count('pyrotech:crude_axe'), 1, 'the axe is still there');
    assert.match(worn.bot.output, /Keeping the axe for the Crafting Tools: it has 1 use left, and chopping a plank takes 1; stopping\./);

    // Damage 2 (6 left): the whole chain (5 uses) fits and 1 use is kept.
    const ok = fakeBot([['pyrotech:crude_axe', 2, 1], ['log', 1, 2]]);
    assert.equal(await skills.sticksByAxe(ok.bot, 1, { aborted: false }, ok.ops), 2);
    assert.equal(ok.bot.inventory.items().find(i => i.name === 'pyrotech:crude_axe').metadata, 7, '1 use left');

    // Damage 7 (1 left): nothing is placed.
    const spent = fakeBot([['pyrotech:crude_axe', 7, 1], ['log', 1, 2]]);
    assert.equal(await skills.sticksByAxe(spent.bot, 1, { aborted: false }, spent.ops), 0);
    assert.deepEqual(spent.bot.log.placed, []);
    assert.match(spent.bot.output, /it has 1 use left, and chopping a log takes 2; stopping\./);
});

test('#274 review 1: with a stone axe held too, the stone axe does the chopping and the crude axe is untouched', T, async (t) => {
    quiet(t);
    const { bot, ops } = fakeBot([['pyrotech:crude_axe', 0, 1], ['stone_axe', 0, 1], ['log', 1, 2]]);
    assert.equal(await skills.sticksByAxe(bot, 1, { aborted: false }, ops), 2);
    const axe = (n) => bot.inventory.items().find(i => i.name === n).metadata;
    assert.deepEqual([axe('pyrotech:crude_axe'), axe('stone_axe')], [0, 5]);
});

// ---- #274 review 3: every early exit takes the placed block back and picks up the drops ----

test('#274 review 3: a click that changes nothing, the use cap and an abort each break the placed block back by hand', T, async (t) => {
    quiet(t);
    const blocks = (b) => [...b.world.keys()];
    const dud = fakeBot([['pyrotech:crude_axe', 0, 1], ['log', 1, 3]], { dud: true });
    await skills.sticksByAxe(dud.bot, 2, { aborted: false }, dud.ops);
    assert.deepEqual(dud.bot.log.digs, ['log']);
    assert.deepEqual(blocks(dud.bot), [], 'nothing left in the world');
    assert.equal(dud.count('log'), 3, 'the log is back in the inventory');

    const capped = fakeBot([['stone_axe', 0, 1], ['log', 0, 3]]);
    await skills.sticksByAxe(capped.bot, 2, { aborted: false }, capped.ops, { clicks: 1 });
    assert.deepEqual(capped.bot.log.digs, ['hitwithaxe:debarked_oak']);
    assert.deepEqual(blocks(capped.bot), []);
    assert.equal(capped.count('hitwithaxe:debarked_oak'), 1, 'the debarked log was picked up');
    assert.equal(capped.count('stone_axe'), 1);
    assert.equal(capped.bot.inventory.items().find(i => i.name === 'stone_axe').metadata, 1, 'broken back by hand, not with the axe');

    const run = { aborted: false };
    const stopped = fakeBot([['pyrotech:crude_axe', 0, 1], ['log', 0, 3]], { abortAt: 1, run });
    await skills.sticksByAxe(stopped.bot, 2, run, stopped.ops);
    assert.equal(stopped.bot.log.clicks, 1);
    assert.deepEqual(stopped.bot.log.digs, ['hitwithaxe:debarked_oak'], 'broken back even when stopped');
    assert.deepEqual(blocks(stopped.bot), []);
    assert.equal(stopped.bot.log.pickups, 0, 'no walk after the drops once stopped');
    assert.match(stopped.bot.output, /Stopped; the drops are left near/);
});

// ---- #274 review 4: where the block is placed ----

test('#274 review 4: chopSpot: firm ground in reach, never leaves, a liquid or hazard near, or a ledge', () => {
    const { bot } = fakeBot([]);
    const spot = skills.chopSpot(bot);
    assert.ok(spot, 'flat dirt has a spot');
    const h = Math.hypot(spot.x, spot.z);
    assert.ok(spot.y === 64 && h >= 1.5 && h <= 3, `${spot}`);

    const p = at(2);
    assert.equal(skills.chopSpotOk(bot, p), true);
    const with_ = (cells) => { const f = fakeBot([]); for (const [pos, name] of cells) f.bot.world.set(key(pos), name); return f.bot; };
    assert.equal(skills.chopSpotOk(with_([[at(2, 63), 'leaves']]), p), false, 'on leaves');
    assert.equal(skills.chopSpotOk(with_([[at(3, 63, 1), 'lava']]), p), false, 'lava diagonally below');
    assert.equal(skills.chopSpotOk(with_([[at(2, 64, 1), 'water']]), p), false, 'water beside');
    assert.equal(skills.chopSpotOk(with_([[at(3, 63), 'air']]), p), false, 'a hole beside: a ledge the drop falls off');
    assert.equal(skills.chopSpotOk(with_([[at(2), 'stone']]), p), false, 'not empty');

    // Lava all along one side: the spot is on the other side.
    const lavaEast = with_([...Array(9)].flatMap((_, i) => [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(z => [at(1 + Math.floor(i / 3), 63, z), 'lava'])));
    const s2 = skills.chopSpot(lavaEast);
    assert.ok(s2 && s2.x <= -1, `away from the lava: ${s2}`);
});
