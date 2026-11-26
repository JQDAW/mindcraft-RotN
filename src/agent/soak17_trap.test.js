// Soak 17 T (the lead's decisions): the traps of soak 17, offline on a fake world.
// 18:01:53 !collectBlocks("cobblestone", 7) on UB metamorphic stone at ~y 70, a stone pickaxe (level 0) and 420 metamorphic
// rocks: the collect searched for vanilla cobblestone only (rotn-data's one cobblestone rule needs a level 1 pickaxe),
// took a buried one 44 down (81, 26, 67) and mineflayer-collectblock's own walk dug the shaft. 18:39:37
// !collectBlocks("undergroundbiomes:metamorphic_stone", 14): no rule, the plain search, stone after stone 14 down (it
// drops rocks, never itself). Now: cobble from the rocks carried first, else rocks collected and crafted; a floor at the
// collect's start y - 2 for every walk and target; a pickaxe target only open and with a way out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import prismarineRecipe from 'prismarine-recipe';
import { __setRegistryForTest } from '../utils/mcdata.js';
import { installRecipes } from '../../packages/rotn-data/index.js';
import * as skills from './library/skills.js';
import { collectFloorY, WALK_GUARD } from './library/movements.js';
import { isTrapped } from './library/escape.js';

const vanilla = minecraftData('1.12.2');
const reg = { ...vanilla, items: { ...vanilla.items }, itemsByName: { ...vanilla.itemsByName }, blocks: { ...vanilla.blocks }, blocksByName: { ...vanilla.blocksByName }, recipes: { ...vanilla.recipes } };
const MODDED = ['pyrotech:rock', 'pyrotech_compat:rock_igneous', 'pyrotech_compat:rock_metamorphic', 'pyrotech_compat:rock_sedimentary',
    'undergroundbiomes:metamorphic_cobble', 'undergroundbiomes:metamorphic_stone', 'undergroundbiomes:igneous_cobble', 'contenttweaker:chalk_cobble'];
MODDED.forEach((name, i) => {
    const item = { id: 7000 + i, name, stackSize: 64 };
    const blk = { id: 3900 + i, name, boundingBox: 'block' };
    reg.items[item.id] = item; reg.itemsByName[name] = item;
    reg.blocks[blk.id] = blk; reg.blocksByName[name] = blk;
});
installRecipes(reg);
__setRegistryForTest(reg);
void prismarineRecipe; // the recipes are installed as initBot does (installRecipes)

const STONE = 'undergroundbiomes:metamorphic_stone';
const ROCK = 'pyrotech_compat:rock_metamorphic';
const V = (x, y, z) => new Vec3(x, y, z);
const key = (p) => `${p.x},${p.y},${p.z}`;
const stack = (name, metadata, count) => ({ name, metadata, count, type: reg.itemsByName[name].id });
const pickaxe = () => ({ ...stack('stone_pickaxe', 0, 1) });

/**
 * A field of metamorphic stone up to surfaceY (air above), loaded everywhere; `extra` blocks by position override it
 * (the dungeon's vanilla cobblestone). A dug block is air. findBlocks lists the field near the start and the extras.
 */
function stoneWorld({ surfaceY = 63, half = 8, depth = 8, extra = [] } = {}) {
    const dug = new Set();
    const extras = new Map(extra.map(([name, p]) => [key(p), name]));
    const make = (name, p) => ({
        name, metadata: 0, type: name === 'air' ? 0 : reg.blocksByName[name].id, position: p,
        boundingBox: name === 'air' ? 'empty' : 'block', shapes: name === 'air' ? [] : [[0, 0, 0, 1, 1, 1]], transparent: name === 'air',
        canHarvest: () => true,
    });
    const nameAt = (p) => (dug.has(key(p)) ? 'air' : extras.get(key(p)) ?? (p.y <= surfaceY ? STONE : 'air'));
    const blockAt = (pos) => { const p = V(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)); return make(nameAt(p), p); };
    const listed = () => {
        const out = [];
        for (let x = -half; x <= half; x++) for (let z = -half; z <= half; z++) for (let y = surfaceY - depth; y <= surfaceY; y++) out.push(V(x, y, z));
        const seen = new Set(out.map(key));
        for (const k of extras.keys()) { if (seen.has(k)) continue; const [x, y, z] = k.split(',').map(Number); out.push(V(x, y, z)); }
        return out.filter(p => nameAt(p) !== 'air');
    };
    return { blockAt, dig: (p) => dug.add(key(p)), listed, dug };
}

function fakeBot({ world, items, start }) {
    const calls = { dug: [], collected: [], walks: [], trappedAfter: [], floorDuringDig: [] };
    const bot = {
        calls, registry: reg, version: '1.12.2', output: '', interrupt_code: false,
        game: { gameMode: 'survival', dimension: 'overworld', minY: 0 },
        entity: { position: start.clone(), height: 1.8, eyeHeight: 1.62 },
        entities: {}, heldItem: null,
        modes: { isOn: () => false, pause() {}, unpause() {} },
        armorManager: { equipAll() {} },
        inventory: { items: () => items.filter(i => i.count > 0), get slots() { return [null, null, null, null, null, null, null, null, null, ...items]; }, selectedItem: null },
        findBlocks({ matching, maxDistance = 16, count = 1 }) {
            const here = bot.entity.position;
            return world.listed().map(p => world.blockAt(p))
                .filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .filter(b => b.position.distanceTo(here) <= maxDistance)
                .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))
                .slice(0, count).map(b => b.position);
        },
        blockAt: (p) => world.blockAt(p),
        world: { getBlockStateId: (p) => { const b = world.blockAt(p); return b.name === 'air' ? 0 : b.type; } },
        equip: (item) => { bot.heldItem = item; return Promise.resolve(); },
        tool: { equipForBlock: () => { bot.heldItem = items.find(i => /pickaxe/.test(i.name)) ?? null; return Promise.resolve(); } },
        collectBlock: { collect: (b) => { calls.collected.push(b.position); return dig(b); }, movements: { exclusionAreasBreak: [], exclusionAreasStep: [], getLandingBlock: () => null } },
        dig: (b) => dig(b),
        pathfinder: {
            setMovements() {}, stop() {}, setGoal() {}, isMoving: () => false,
            getPathTo: () => ({ status: 'success', path: [] }),
            // A walk arrives on top of the goal's column (standing on solid ground, in air).
            goto: (goal) => {
                calls.walks.push(goal);
                if (Number.isFinite(goal?.x)) {
                    let p = V(Math.floor(goal.x), Math.floor(goal.y ?? bot.entity.position.y), Math.floor(goal.z));
                    while (world.blockAt(p).name !== 'air' || world.blockAt(p.offset(0, -1, 0)).name === 'air') {
                        p = world.blockAt(p).name !== 'air' ? p.offset(0, 1, 0) : p.offset(0, -1, 0);
                        if (p.y > 300 || p.y < 0) break;
                    }
                    bot.entity.position = V(p.x + 0.5, p.y, p.z + 0.5);
                }
                return Promise.resolve();
            },
        },
        lookAt: () => Promise.resolve(),
        nearestEntity: () => null,
        recipesFor: () => [],
        // The 2x2 rock recipes: 4 of the recipe's rock in, its cobble out (as the server).
        craft: (recipe, count = 1) => {
            for (let n = 0; n < count; n++) {
                const cells = (recipe.ingredients ?? recipe.inShape.flat()).filter(c => c && c.id !== -1);
                const r = cells[0];
                const rock = items.find(i => i.type === r.id && i.metadata === (r.metadata ?? 0));
                if (!rock || rock.count < cells.length) return Promise.reject(new Error('missing ingredient'));
                rock.count -= cells.length;
                const out = recipe.result;
                const name = reg.items[out.id].name;
                const have = items.find(i => i.type === out.id && i.metadata === (out.metadata ?? 0));
                if (have) have.count += out.count; else items.push(stack(name, out.metadata ?? 0, out.count));
            }
            return Promise.resolve();
        },
    };
    function dig(b) {
        calls.dug.push(b.position.clone());
        calls.floorDuringDig.push(collectFloorY(bot));
        const name = world.blockAt(b.position).name;
        world.dig(b.position);
        const level0 = /stone_pickaxe/.test(bot.heldItem?.name ?? '');
        const drop = name === STONE ? (level0 ? [ROCK, 0, 4] : null) : name === 'cobblestone' ? ['cobblestone', 0, 1] : null;
        if (drop) {
            const have = items.find(i => i.name === drop[0] && i.metadata === drop[1]);
            if (have) have.count += drop[2]; else items.push(stack(...drop));
        }
        // Gravity: dug from under the feet, the bot falls to the next solid block (how the plain search went down).
        let feet = bot.entity.position.floored();
        while (feet.y > 0 && world.blockAt(feet.offset(0, -1, 0)).name === 'air') feet = feet.offset(0, -1, 0);
        bot.entity.position = V(feet.x + 0.5, feet.y, feet.z + 0.5);
        calls.trappedAfter.push(isTrapped(bot).trapped);
        return Promise.resolve();
    }
    return bot;
}

const cobbleCount = (items) => items.filter(i => /cobble/.test(i.name)).reduce((n, i) => n + i.count, 0);

test('soak 17 18:01:53: !collectBlocks("cobblestone", 7) with 420 metamorphic rocks crafts 7 cobble from them: no dig, no walk to the buried cobblestone', async (t) => {
    t.mock.method(console, 'log', () => {});
    const world = stoneWorld({ surfaceY: 69, extra: [['cobblestone', V(81, 26, 67)], ['cobblestone', V(82, 26, 67)], ['cobblestone', V(81, 26, 68)]] });
    const items = [pickaxe(), stack(ROCK, 0, 420)];
    const bot = fakeBot({ world, items, start: V(79.5, 70, 68.5) });
    assert.equal(await skills.collectBlock(bot, 'cobblestone', 7), true, bot.output);
    assert.deepEqual(bot.calls.dug, [], 'nothing dug');
    assert.deepEqual(bot.calls.collected, [], 'mineflayer-collectblock never called');
    assert.equal(cobbleCount(items), 7, bot.output);
    assert.match(bot.output, /Stone here drops rocks with a pickaxe below Sturdy \(cobblestone needs a level 1 pickaxe, such as iron\): crafting 7 cobble from the rocks you carry first\./);
    assert.match(bot.output, /Cobblestone from your rocks: 7 undergroundbiomes:metamorphic_cobble:0 \(4 pyrotech_compat:rock_metamorphic:0 each\)\./);
    assert.match(bot.output, /Crafted 7 cobble from your rocks, of 7 asked\./);
    assert.equal(collectFloorY(bot), null, 'the floor ends with the collect');
});

test('soak 17 T: with no rocks, the cobble collect mines rocks from open stone within the floor (start y - 2), never the buried cobblestone 44 down', async (t) => {
    t.mock.method(console, 'log', () => {});
    // The dungeon's cobblestone 44 straight below the bot (soak 17: 81, 26, 67 under 79, 70, 68).
    const world = stoneWorld({ surfaceY: 69, extra: [['cobblestone', V(0, 26, 0)], ['cobblestone', V(1, 26, 0)]] });
    const items = [pickaxe()];
    const bot = fakeBot({ world, items, start: V(0.5, 70, 0.5) });
    await skills.collectBlock(bot, 'cobblestone', 2);
    assert.ok(bot.calls.dug.length >= 2, bot.output);
    for (const p of bot.calls.dug) assert.ok(p.y >= 70 - WALK_GUARD.floorBelow, `dug ${p} at or above the floor 68`);
    assert.ok(!bot.calls.dug.some(p => p.y === 26), 'never the buried cobblestone');
    assert.ok(bot.calls.floorDuringDig.every(f => f === 68), 'every dig inside the collect floor');
    assert.equal(cobbleCount(items), 2, bot.output);
    assert.match(bot.output, /collecting 8 rocks \(pyrotech:rock\) to craft 2 cobble/);
});

test('soak 17 T: a cobblestone collect with a Sturdy pickaxe takes an open cobblestone; the buried one below the floor is left and said once', async (t) => {
    t.mock.method(console, 'log', () => {});
    const surface = V(6, 64, 0), deep = V(0, 20, 0), underFoot = V(1, 62, 0);
    const world = stoneWorld({ surfaceY: 63, extra: [['cobblestone', surface], ['cobblestone', deep], ['cobblestone', underFoot]] });
    const items = [{ ...stack('iron_pickaxe', 0, 1) }];
    const bot = fakeBot({ world, items, start: V(0.5, 64, 0.5) });
    await skills.collectBlock(bot, 'cobblestone', 3);
    assert.deepEqual(bot.calls.dug.map(key), [key(surface)], 'the open one only');
    assert.match(bot.output, /Left 1 block for cobblestone below y 62 alone \(more than 2 under where this collect started\): a collect never digs or walks below that\./);
    assert.match(bot.output, /Left 1 block for cobblestone buried in the rock \(no open face\)/);
    assert.equal((bot.output.match(/below y 62 alone/g) ?? []).length, 1, 'said once');
});

test('soak 17 18:39:37 (the lead): !collectBlocks("undergroundbiomes:metamorphic_stone", 14) on a flat stone field: rocks from blocks at or above start y - 2, never trapped, the cobble named', async (t) => {
    t.mock.method(console, 'log', () => {});
    const world = stoneWorld({ surfaceY: 63, half: 10, depth: 10 });
    const items = [pickaxe()];
    const bot = fakeBot({ world, items, start: V(0.5, 64, 0.5) });
    await skills.collectBlock(bot, STONE, 14);
    assert.ok(bot.calls.dug.length >= 14, bot.output);
    for (const p of bot.calls.dug) assert.ok(p.y >= 62, `dug ${p}: at or above start y - 2`);
    assert.deepEqual(bot.calls.trappedAfter.filter(Boolean), [], 'a walkable way out after every break');
    assert.match(bot.output, /undergroundbiomes:metamorphic_stone drops 4 rocks with your stone_pickaxe, never itself: collecting 56 rocks \(pyrotech:rock\) to craft 14 cobble \(4 rocks of one kind make 1 cobble of that kind, not undergroundbiomes:metamorphic_stone\)\./);
    assert.match(bot.output, /Cobblestone from your rocks: \d+ undergroundbiomes:metamorphic_cobble:0/);
    assert.match(bot.output, /Crafted 14 cobble from your rocks \(instead of undergroundbiomes:metamorphic_stone\), of 14 asked\./);
});

test('soak 17 T: during a collect, mineflayer-collectblock\'s own movements are guarded by the collect floor (a step below it under rock too)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const world = stoneWorld({ surfaceY: 63, extra: [['cobblestone', V(3, 64, 0)]] });
    const items = [{ ...stack('iron_pickaxe', 0, 1) }];
    const bot = fakeBot({ world, items, start: V(0.5, 64, 0.5) });
    let seen = null;
    // #665 review 2: a pickaxe target is dug by the collect itself (the walk, then bot.dig), so the plugin's movements are
    // read at the dig, while the collect floor holds.
    const dig = bot.dig;
    bot.dig = (b) => {
        const m = bot.collectBlock.movements;
        const cost = (y) => m.exclusionAreasBreak.reduce((n, f) => n + f({ name: STONE, metadata: 0, position: V(0, y, 0) }), 0);
        seen ??= { below: cost(61), at: cost(62), step: m.exclusionAreasStep.reduce((n, f) => n + f({ position: V(0, 61, 0) }), 0) };
        return dig(b);
    };
    await skills.collectBlock(bot, 'cobblestone', 1);
    assert.deepEqual(seen, { below: WALK_GUARD.breakNever, at: 0, step: WALK_GUARD.breakNever }, bot.output);
});

// ---- #665 review round 1 ----
test('#665 review 1: a collect inside a collect leaves the outer floor in place (the soak 17 trap again otherwise)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const world = stoneWorld({ surfaceY: 63, extra: [['cobblestone', V(3, 64, 0)]] });
    const items = [{ ...stack('iron_pickaxe', 0, 1) }];
    const bot = fakeBot({ world, items, start: V(0.5, 64, 0.5) });
    let after = 'not run';
    const dig = bot.dig;
    bot.dig = async (b) => {
        if (after === 'not run') { await skills.collectBlock(bot, 'dirt', 1); after = collectFloorY(bot); } // as a table pickup
        return dig(b);
    };
    await skills.collectBlock(bot, 'cobblestone', 1);
    assert.equal(after, 62, 'the outer floor after the nested collect returned');
    assert.equal(collectFloorY(bot), null, 'and cleared by the outer one at its end');
});

test('#665 review 2: a pickaxe target is dug by the collect itself (never dropped silently by the plugin), also with the pickaxe at its keep', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { walkKeep } = await import('./library/pickaxe.js');
    const keep = walkKeep({ name: 'iron_pickaxe' });
    const world = stoneWorld({ surfaceY: 63, extra: [['cobblestone', V(3, 64, 0)]] });
    const items = [{ ...stack('iron_pickaxe', 250 + 1 - keep, 1) }]; // uses left == its keep
    const bot = fakeBot({ world, items, start: V(0.5, 64, 0.5) });
    await skills.collectBlock(bot, 'cobblestone', 1);
    assert.deepEqual(bot.calls.collected, [], 'not through mineflayer-collectblock');
    assert.deepEqual(bot.calls.dug.map(key), ['3,64,0'], bot.output);
});

test('#665 round 1 (decision 4): an ore at the bot\'s level behind one stone is taken again; one below the feet that keeps no way out is not', async (t) => {
    t.mock.method(console, 'log', () => {});
    // A wall of stone at y 64-65 east of the bot, the ore inside it at 3, 64, 0 (no air face).
    const wall = [];
    for (let x = 2; x <= 6; x++) for (let y = 64; y <= 65; y++) for (let z = -2; z <= 2; z++) wall.push([x === 3 && y === 64 && z === 0 ? 'iron_ore' : STONE, V(x, y, z)]);
    const world = stoneWorld({ surfaceY: 63, extra: wall });
    const items = [pickaxe()];
    const bot = fakeBot({ world, items, start: V(0.5, 64, 0.5) });
    await skills.collectBlock(bot, 'iron_ore', 1);
    assert.ok(bot.calls.dug.map(key).includes('3,64,0'), bot.output);
    // Under the floor of a 1-wide pit at the feet: no way out once broken: skipped and said.
    const deep = stoneWorld({ surfaceY: 63, extra: [['iron_ore', V(0, 62, 0)], ['air', V(0, 63, 0)]] });
    const b2 = fakeBot({ world: deep, items: [pickaxe()], start: V(1.5, 64, 0.5) });
    await skills.collectBlock(b2, 'iron_ore', 1);
    assert.deepEqual(b2.calls.dug, [], b2.output);
    assert.match(b2.output, /Skipped 1 block to mine \(iron_ore at 0, 62, 0\): breaking it would leave no walkable way out\./);
});

test('#665 round 1 (the surface exception): a cobblestone boulder in a valley 6 below the start is taken; one in a cave mouth below the floor is never', async (t) => {
    t.mock.method(console, 'log', () => {});
    // The bot on a hill (stone up to 69 for x <= 2); east of x 2 a valley down to y 63 under open sky; a cave under the
    // hill at y 60-61 (x -4..-2), its cobblestone at -3, 60, 0 under rock.
    const extra = [];
    for (let x = -8; x <= 2; x++) for (let z = -8; z <= 8; z++) for (let y = 64; y <= 69; y++) extra.push([STONE, V(x, y, z)]);
    for (let x = -4; x <= -2; x++) for (let y = 60; y <= 61; y++) extra.push(['air', V(x, y, 0)]);
    extra.push(['cobblestone', V(6, 64, 0)], ['cobblestone', V(-3, 60, 0)]);
    const world = stoneWorld({ surfaceY: 63, extra });
    const items = [{ ...stack('iron_pickaxe', 0, 1) }];
    const bot = fakeBot({ world, items, start: V(0.5, 70, 0.5) });
    await skills.collectBlock(bot, 'cobblestone', 2);
    assert.deepEqual(bot.calls.dug.map(key), ['6,64,0'], `the valley's boulder (6 below the start, under open sky), never the cave's: ${bot.output}`);
    assert.match(bot.output, /Left 1 block for cobblestone below y 68 alone/);
});

test('#665 review 8: rocks carried enough, but the craft fails: said, and no rocks are dug for it', async (t) => {
    t.mock.method(console, 'log', () => {});
    const world = stoneWorld({ surfaceY: 69 });
    const items = [pickaxe(), stack(ROCK, 0, 40)];
    const bot = fakeBot({ world, items, start: V(0.5, 70, 0.5) });
    bot.craft = () => Promise.reject(new Error('the server refused the craft'));
    await skills.collectBlock(bot, 'cobblestone', 3);
    assert.deepEqual(bot.calls.dug, []);
    assert.match(bot.output, /Crafted 0 of 3 cobble from the rocks you carry: the craft stopped \(see above\), so no more rocks are collected for it\./);
});

test('#665 round 1 (decision 6): a hazard walk (keep: false) may dig with a pickaxe at its keep; an ordinary walk may not', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { walkKeep } = await import('./library/pickaxe.js');
    const keep = walkKeep({ name: 'stone_pickaxe' });
    const world = stoneWorld({ surfaceY: 63 });
    const items = [{ ...stack('stone_pickaxe', 131 + 1 - keep, 1) }];
    const bot = fakeBot({ world, items, start: V(0.5, 64, 0.5) });
    const seen = [];
    bot.pathfinder.getPathTo = (m) => { seen.push(m); return { status: 'noPath', path: [] }; };
    const pf = (await import('mineflayer-pathfinder')).default;
    const goal = new pf.goals.GoalInvert(new pf.goals.GoalNear(0, 64, 0, 5));
    await skills.goToGoal(bot, goal);
    assert.equal(new Set(seen).size, 1, 'keep: only the non-destructive movements (no destructive fallback at the keep)');
    seen.length = 0;
    await skills.goToGoal(bot, goal, { keep: false });
    assert.equal(new Set(seen).size, 2, 'keep false: the destructive fallback too');
    const stoneCost = (m) => m.exclusionAreasBreak.reduce((n, f) => n + f({ name: STONE, metadata: 0, position: V(0, 63, 0) }), 0);
    assert.equal(stoneCost(seen[1]), 0, 'and it may break stone with that pickaxe');
});
