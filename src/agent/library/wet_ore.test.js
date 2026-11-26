// Soak 8 (rotn-v0.1.14, #558), the lead's escape plan PR 2 (4): the model mined copper ore by
// flowing water under a stone overhang, the drowning reflex stopped it 4 times, and the bot ended
// in a flooded pit for 36 min. A fake world (stone below y 64, air above, plus what a test sets) and
// collectBlock's own fake bot, as collect_rotn.test.js. No server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { isOre, wetOreRefusal, wetOreSkip, liquidKind, footingFor, liquidNear, noteDrowning, WET_ORE } from './wet_ore.js';
import * as skills from './skills.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const key = (p) => `${p.x},${p.y},${p.z}`;

// modded: extra blocks by name ({ id, name, boundingBox, liquid }), in the bot's registry only.
function fakeBot({ set = {}, at = new Vec3(0, 64, 0), items = [], modded = {} } = {}) {
    const world = new Map(Object.entries(set));
    const calls = { dug: [] };
    const registry = Object.keys(modded).length ? Object.assign(Object.create(reg), { blocks: { ...reg.blocks, ...Object.fromEntries(Object.values(modded).map(m => [m.id, m])) } }) : reg;
    const blockOf = (q) => {
        const v = world.get(key(q)) ?? (q.y < 64 ? 'stone' : 'air');
        const b = reg.blocksByName[v] ?? modded[v];
        return { name: v, metadata: 0, type: b?.id ?? 1, position: q, boundingBox: b?.boundingBox ?? 'block', transparent: false, shapes: [[0, 0, 0, 1, 1, 1]], canHarvest: () => true };
    };
    const bot = {
        calls, registry, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival', dimension: 'overworld' },
        entity: { position: at.offset(0.5, 0, 0.5), height: 1.8 }, entities: {}, heldItem: null,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        inventory: { items: () => items.filter(i => i.count > 0), slots: [] },
        blockAt: (p) => blockOf(p.floored()),
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            const out = [];
            for (const [k, v] of world) {
                const [x, y, z] = k.split(',').map(Number);
                const b = blockOf(new Vec3(x, y, z));
                if (v === 'air' || !(typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type))) continue;
                if (b.position.distanceTo(bot.entity.position) <= maxDistance) out.push(b);
            }
            return out.sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, count).map(b => b.position);
        },
        equip: (item) => { bot.heldItem = item; return Promise.resolve(); },
        tool: { equipForBlock: () => Promise.resolve() },
        collectBlock: { collect: (b) => { dig(b); return Promise.resolve(); } },
        dig: (b) => { dig(b); return Promise.resolve(); },
        pathfinder: { setMovements() {}, stop() {}, setGoal() {}, isMoving: () => false, getPathTo: () => ({ status: 'success', path: [] }),
            goto: (goal) => { if (Number.isFinite(goal?.x)) bot.entity.position = new Vec3(Math.floor(goal.x) + 0.5, Math.floor(goal.y), Math.floor(goal.z) + 0.5); return Promise.resolve(); } },
        lookAt: () => Promise.resolve(),
        nearestEntity: () => null,
    };
    function dig(b) {
        calls.dug.push(key(b.position));
        world.set(key(b.position), 'air');
        const stack = items.find(i => i.name === b.name);
        if (stack) stack.count++; else items.push({ name: b.name, metadata: 0, count: 1, type: reg.itemsByName[b.name]?.id });
    }
    return bot;
}

test('PR 2 (4): ores by name', () => {
    for (const n of ['iron_ore', 'minecraft:coal_ore', 'osv:simpleores_copper_ore_undergroundbiomes_metamorphic_stone', 'redstone_ore', 'lit_redstone_ore']) assert.equal(isOre({ name: n }), true, n);
    for (const n of ['stone', 'oreless', 'dirt', 'store', 'pyrotech:rock', 'sand']) assert.equal(isOre({ name: n }), false, n);
});

test('PR 2 (4): an ore with a liquid beside it, or no dry footing within reach, is refused; one on dry ground is not; other blocks by water are not', () => {
    const ore = (x, y, z) => ({ name: 'iron_ore', position: new Vec3(x, y, z) });
    // Beside water.
    assert.equal(wetOreRefusal(fakeBot({ set: { '3,64,0': 'iron_ore', '4,64,0': 'water' } }), ore(3, 64, 0)), 'a liquid beside it');
    // In a wall over a pool: every cell within reach is water or rock (soak 8's overhang).
    const pool = {};
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) for (let y = 64; y <= 74; y++) pool[`${x},${y},${z}`] = y <= 66 && Math.abs(x) <= 5 && Math.abs(z) <= 5 ? 'water' : 'stone';
    pool['0,68,0'] = 'iron_ore';
    const deep = fakeBot({ set: pool, at: new Vec3(0, 66, 0) });
    assert.equal(footingFor(deep, new Vec3(0, 68, 0)), null);
    assert.equal(wetOreRefusal(deep, ore(0, 68, 0)), 'no dry footing within reach');
    // On dry ground.
    const dry = fakeBot({ set: { '3,64,0': 'iron_ore' } });
    assert.ok(footingFor(dry, new Vec3(3, 64, 0)));
    assert.equal(wetOreRefusal(dry, ore(3, 64, 0)), null);
    // Not an ore: sand by water is still collected (clay and sugar cane grow by water).
    assert.equal(wetOreRefusal(fakeBot({ set: { '3,64,0': 'sand', '4,64,0': 'water' } }), { name: 'sand', position: new Vec3(3, 64, 0) }), null);
});

test('PR 2 (4): the drowning reflex fired twice going for a block: it is refused (any block), for drownMemoryMs', () => {
    const bot = fakeBot({ set: { '3,64,0': 'sand' } });
    const sand = { name: 'sand', position: new Vec3(3, 64, 0) };
    assert.equal(noteDrowning(bot), 0, 'no collect going: nothing counted');
    bot.rotnCollectTarget = sand.position;
    const t0 = 1_000_000;
    assert.equal(noteDrowning(bot, t0), 1);
    assert.equal(wetOreRefusal(bot, sand, t0), null, 'once is not enough');
    assert.equal(noteDrowning(bot, t0 + 1000), 2);
    assert.equal(wetOreRefusal(bot, sand, t0 + 1000), 'the drowning reflex fired twice going for it');
    assert.equal(wetOreRefusal(bot, sand, t0 + 1000 + WET_ORE.drownMemoryMs + 1), null, 'forgotten after drownMemoryMs');
});

/**
 * A pool (water at y 64 and 65 over x 0..10, z -5..5) on a stone floor: an ore in the floor under it
 * touches no water (collectBlock's own safeToBreak lets it be), but every cell within reach to stand
 * in is water (soak 8: the ore by the river, the bot's legs in it).
 */
function pool(extra = {}, liquid = 'water', z0 = -5) {
    const set = { ...extra };
    // Soak 17 T: a collect takes stone and ore only where it lies open, so each ore in the bed gets a 1-high air pocket
    // under it (an open face, but no cell to stand in): the footing rule, not "buried", is what leaves it.
    for (const [k, v] of Object.entries(extra)) if (v === 'iron_ore') { const [x, y, z] = k.split(',').map(Number); if (y < 64) set[`${x},${y - 1},${z}`] ??= 'air'; }
    for (let x = 0; x <= 10; x++) for (let z = z0; z <= z0 + 10; z++) for (const y of [64, 65]) set[`${x},${y},${z}`] = liquid;
    return set;
}

test('PR 2 (4): collectBlock leaves an ore with no dry footing within reach (under a pool) and mines a dry one farther off; one reason line', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [{ name: 'stone_pickaxe', metadata: 0, count: 1, type: reg.itemsByName.stone_pickaxe.id }];
    const bot = fakeBot({ set: pool({ '5,62,0': 'iron_ore', '-6,64,-9': 'iron_ore' }), at: new Vec3(5, 64, -7), items });
    await skills.collectBlock(bot, 'iron_ore', 1);
    assert.deepEqual(bot.calls.dug, ['-6,64,-9'], `the dry one, though it is farther: ${bot.output}`);
    assert.equal((bot.output.match(/Skipped \d+ iron_ore that would put you in the water/g) ?? []).length, 1, bot.output);
    assert.match(bot.output, /Skipped 1 iron_ore that would put you in the water: no dry footing within reach \(1\)\. Look for some on dry ground\./);
    assert.equal(bot.rotnCollectTarget, null, 'cleared after the collect');
    // Only wet ones: none collected, the line once.
    const wet = fakeBot({ set: pool({ '3,62,0': 'iron_ore', '7,62,0': 'iron_ore' }), at: new Vec3(5, 64, -7), items: [...items] });
    await skills.collectBlock(wet, 'iron_ore', 2);
    assert.deepEqual(wet.calls.dug, []);
    assert.match(wet.output, /Skipped 2 iron_ore that would put you in the water: no dry footing within reach \(2\)/);
    assert.equal((wet.output.match(/Skipped \d+ iron_ore/g) ?? []).length, 1);
});

test('PR 2 (4): a block the drowning reflex fired twice for is left alone by the next collect', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = fakeBot({ set: { '3,64,0': 'sand', '0,64,6': 'sand' } });
    bot.rotnCollectTarget = new Vec3(3, 64, 0);
    noteDrowning(bot);
    noteDrowning(bot);
    bot.rotnCollectTarget = null;
    await skills.collectBlock(bot, 'sand', 1);
    assert.deepEqual(bot.calls.dug, ['0,64,6']);
    assert.match(bot.output, /Skipped 1 sand that would put you in the water: the drowning reflex fired twice going for it \(1\)/);
});

test('PR 2 (4): the drowning reflex counts the swim-up against the block a collect is going for', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    t.mock.method(console, 'error', () => {});
    const { initModes, __modeForTest } = await import('../modes.js');
    const agent = {
        name: 'FRCFLD', bot: {}, task: null, prompter: { getInitModes: () => ({}) }, isIdle: () => false,
        actions: { currentActionLabel: 'action:collectBlocks', resume_func: null, runAction: async (label, fn) => { try { await fn(); } catch { /* the fake cannot swim */ } return { message: 'ok', interrupted: false }; } },
        self_prompter: { isActive: () => true, stopLoop: () => {} }, handleMessage: () => Promise.resolve(true), cleanKill: () => {},
    };
    initModes(agent);
    const water = { name: 'water', boundingBox: 'empty' };
    Object.assign(agent.bot, {
        registry: reg, version: '1.12.2', output: '', entity: { position: new Vec3(0.5, 61, 0.5) }, oxygenLevel: 10,
        blockAt: () => water, setControlState() {}, clearControlStates() {},
        pathfinder: { goal: {}, stop() {}, setGoal() {} },
        rotnCollectTarget: new Vec3(-86, 62, -125),
    });
    const mode = __modeForTest('self_preservation');
    await mode.update(agent);
    assert.equal(agent.bot.rotnDrowned.get('-86,62,-125').n, 1);
    assert.ok(logs.includes('[reflex] the swim-up is the first going for -86, 62, -125'), logs.join('\n'));
    for (let i = 0; i < 50 && mode.active; i++) await new Promise(r => setTimeout(r, 10));
    await mode.update(agent);
    assert.ok(logs.includes('[reflex] the swim-up is number 2 going for -86, 62, -125; that block is left alone now'), logs.join('\n'));
});

// ---- #564 review 1: the footing rule only with a liquid near ----

test('#564 review 1: a buried ore with no liquid near (24 down in solid stone) is not skipped as "no dry footing" (soak 17 T: it is below the collect floor)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [{ name: 'stone_pickaxe', metadata: 0, count: 1, type: reg.itemsByName.stone_pickaxe.id }];
    const bot = fakeBot({ set: { '2,40,0': 'iron_ore' }, items });
    const ore = { name: 'iron_ore', position: new Vec3(2, 40, 0) };
    assert.equal(footingFor(bot, ore.position), null, 'no air cell within reach of it');
    assert.equal(liquidNear(bot, ore.position), null);
    assert.equal(wetOreRefusal(bot, ore), null);
    // Soak 17 T: 24 down is below the collect floor (start y 64 - 2): left alone, said once; never "no dry footing".
    await skills.collectBlock(bot, 'iron_ore', 1);
    assert.deepEqual(bot.calls.dug, [], bot.output);
    assert.match(bot.output, /Left 1 block for iron_ore below y 62 alone/);
    assert.doesNotMatch(bot.output, /Skipped/);
});

test('#564 review 1: an ore under a river bed is skipped (water within reach, every footing in it)', () => {
    // A river (water at 64 and 65, x -3..3) over the stone; the ore two below its bed.
    const set = {};
    for (let x = -3; x <= 3; x++) for (let z = -10; z <= 10; z++) for (const y of [64, 65]) set[`${x},${y},${z}`] = 'water';
    set['0,61,0'] = 'iron_ore';
    const bot = fakeBot({ set, at: new Vec3(0, 64, -8) });
    const ore = { name: 'iron_ore', position: new Vec3(0, 61, 0) };
    assert.ok(liquidNear(bot, ore.position));
    assert.equal(wetOreRefusal(bot, ore), 'no dry footing within reach');
});

test('#564 review 1: soak 8\'s ore by flowing water under a stone overhang is skipped', () => {
    // Soak 8 (-86, 62, -125): a channel of flowing water at 60 and 61 beside the ore's wall, stone
    // over it all to y 78 (the surface at 79); the only open cells near the ore hold water.
    const set = {};
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) for (let y = 62; y <= 78; y++) set[`${x},${y},${z}`] = 'stone';
    for (let x = -4; x <= 1; x++) for (let z = -3; z <= 3; z++) for (const y of [60, 61]) set[`${x},${y},${z}`] = 'flowing_water';
    set['3,62,0'] = 'osv:simpleores_copper_ore_undergroundbiomes_metamorphic_stone';
    set['2,61,0'] = 'flowing_water'; // the channel reaches under the ore's corner, not beside it
    const bot = fakeBot({ set, at: new Vec3(-2, 60, 0) });
    const ore = { name: 'osv:simpleores_copper_ore_undergroundbiomes_metamorphic_stone', position: new Vec3(3, 62, 0) };
    assert.ok(liquidNear(bot, ore.position));
    assert.equal(footingFor(bot, ore.position), null);
    assert.equal(wetOreRefusal(bot, ore), 'no dry footing within reach');
});

test('#564 review 3: the skips yield to the event loop (no long block over many ores)', async (t) => {
    t.mock.method(console, 'log', () => {});
    // Twelve ores in a pool's bed, no dry one: each is looked at and skipped.
    const set = {};
    for (let x = -6; x <= 19; x++) for (let z = -6; z <= 6; z++) for (const y of [64, 65]) set[`${x},${y},${z}`] = 'water'; // wide: no footing at its edges
    for (let x = 1; x <= 12; x++) { set[`${x},62,0`] = 'iron_ore'; set[`${x},61,0`] = 'air'; } // soak 17 T: open (a 1-high pocket)
    const bot = fakeBot({ set, at: new Vec3(6, 64, -8) });
    let turns = 0;
    const spin = setInterval(() => { turns++; }, 0);
    await skills.collectBlock(bot, 'iron_ore', 1);
    clearInterval(spin);
    assert.match(bot.output, /Skipped 12 iron_ore that would put you in the water: no dry footing within reach \(12\)/);
    assert.ok(turns >= 5, `the event loop ran between the skips (${turns} turns)`);
});

// #564 review nit: the skip line said "would put you in the water" when lava caused the skip.
test('#564 nit: each skip names its liquids: water, lava, or both', () => {
    const ore = (x, y, z) => ({ name: 'iron_ore', position: new Vec3(x, y, z) });
    assert.deepEqual(wetOreSkip(fakeBot({ set: { '3,64,0': 'iron_ore', '4,64,0': 'water' } }), ore(3, 64, 0)), { why: 'a liquid beside it', liquids: ['water'] });
    assert.deepEqual(wetOreSkip(fakeBot({ set: { '3,64,0': 'iron_ore', '4,64,0': 'flowing_lava' } }), ore(3, 64, 0)), { why: 'a liquid beside it', liquids: ['lava'] });
    assert.deepEqual(new Set(wetOreSkip(fakeBot({ set: { '3,64,0': 'iron_ore', '4,64,0': 'lava', '2,64,0': 'water' } }), ore(3, 64, 0)).liquids), new Set(['water', 'lava']));
    assert.deepEqual(wetOreSkip(fakeBot({ set: pool({ '5,62,0': 'iron_ore' }, 'lava') }), ore(5, 62, 0)), { why: 'no dry footing within reach', liquids: ['lava'] });
    assert.equal(wetOreRefusal(fakeBot({ set: pool({ '5,62,0': 'iron_ore' }, 'lava') }), ore(5, 62, 0)), 'no dry footing within reach');
    const bot = fakeBot({ set: { '3,64,0': 'sand' } });
    bot.rotnCollectTarget = new Vec3(3, 64, 0);
    noteDrowning(bot);
    noteDrowning(bot);
    assert.deepEqual(wetOreSkip(bot, { name: 'sand', position: new Vec3(3, 64, 0) }), { why: 'the drowning reflex fired twice going for it', liquids: ['water'] });
});

test('#564 nit: collectBlock says "in the lava" for an ore under a lava pool, and "in the water or the lava" for both', async (t) => {
    t.mock.method(console, 'log', () => {});
    const items = [{ name: 'stone_pickaxe', metadata: 0, count: 1, type: reg.itemsByName.stone_pickaxe.id }];
    const lava = fakeBot({ set: pool({ '5,62,0': 'iron_ore', '-6,64,-9': 'iron_ore' }, 'lava'), at: new Vec3(5, 64, -7), items });
    await skills.collectBlock(lava, 'iron_ore', 1);
    assert.deepEqual(lava.calls.dug, ['-6,64,-9'], lava.output);
    assert.match(lava.output, /Skipped 1 iron_ore that would put you in the lava: no dry footing within reach \(1\)\. Look for some away from the lava\./);
    assert.doesNotMatch(lava.output, /in the water/);
    // A water pool (z -5..5) and a lava pool (z 12..22), an ore under each: one line names both.
    const both = fakeBot({ set: { ...pool({ '5,62,0': 'iron_ore' }), ...pool({ '5,62,17': 'iron_ore' }, 'lava', 12) }, at: new Vec3(5, 64, 8), items: [...items] });
    await skills.collectBlock(both, 'iron_ore', 2);
    assert.deepEqual(both.calls.dug, []);
    assert.match(both.output, /Skipped 2 iron_ore that would put you in the water or the lava: no dry footing within reach \(2\)\. Look for some on dry ground away from the lava\./);
    assert.equal((both.output.match(/Skipped \d+ iron_ore/g) ?? []).length, 1);
});

// #567 nit 4: a modded fluid that is neither water nor lava (registry liquid, no lava hazard) is "a liquid".
test('#567 nit: a modded fluid (not water, not lava) is the generic liquid, named "a liquid" in the skip line', async (t) => {
    t.mock.method(console, 'log', () => {});
    const modded = { 'rotn:test_fluid': { id: 4000, name: 'rotn:test_fluid', boundingBox: 'empty', liquid: true } };
    const fluid = fakeBot({ set: { '3,64,0': 'iron_ore', '4,64,0': 'rotn:test_fluid' }, modded });
    assert.equal(liquidKind(fluid, fluid.blockAt(new Vec3(4, 64, 0))), 'liquid');
    assert.equal(liquidKind(fluid, fluid.blockAt(new Vec3(0, 70, 0))), null, 'air is no liquid');
    assert.deepEqual(wetOreSkip(fluid, { name: 'iron_ore', position: new Vec3(3, 64, 0) }), { why: 'a liquid beside it', liquids: ['liquid'] });
    const items = [{ name: 'stone_pickaxe', metadata: 0, count: 1, type: reg.itemsByName.stone_pickaxe.id }];
    const bot = fakeBot({ set: pool({ '5,62,0': 'iron_ore', '-6,64,-9': 'iron_ore' }, 'rotn:test_fluid'), at: new Vec3(5, 64, -7), items, modded });
    await skills.collectBlock(bot, 'iron_ore', 1);
    assert.deepEqual(bot.calls.dug, ['-6,64,-9'], bot.output);
    assert.match(bot.output, /Skipped 1 iron_ore that would put you in a liquid: no dry footing within reach \(1\)\. Look for some on dry ground\./);
});
