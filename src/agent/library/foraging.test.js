// G4 #5 food, foraging (lead, after rotn-data #423): ripe wild food before hunting, by rotn-data's
// forageFood / forageSources / forageHazard. Only ready states; the Rustic wildberry bush is
// right-clicked, never broken; never the hawthorn, poison ivy or thorns (walks step around the touch
// hazards); never avoided food; never a crop that may be a player's. A fake world; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import * as rotnData from '../../../packages/rotn-data/index.js';
import { FORAGE, FORAGE_BLOCK_NAME, forageSources, forageInfo, usable, touchHazards, plantSafe, mayBeAPlayersCrop,
    breakRefusal, rightClickRefusal, forageTargets, forageTarget, nearbyForage, markTried } from './foraging.js';
import * as skills from './skills.js';

// The 1.12.2 registry plus the modded blocks these tests name (ids past vanilla's), as forge-bridge adds them.
const vanilla = minecraftData('1.12.2');
const reg = { ...vanilla, blocks: { ...vanilla.blocks }, blocksByName: { ...vanilla.blocksByName }, items: { ...vanilla.items }, itemsByName: { ...vanilla.itemsByName } };
['rustic:ginseng', 'rustic:wildberries', 'rustic:wildberry_bush'].forEach((name, i) => {
    const it = { id: 5200 + i, name, displayName: name, stackSize: 64 };
    reg.items[it.id] = it; reg.itemsByName[name] = it;
});
['biomesoplenty:plant_0', 'biomesoplenty:plant_1', 'rustic:wildberry_bush', 'rustic:ginseng', 'rustic:core_root', 'harvestcraft:aridgarden', 'rustic:crop_stake'].forEach((name, i) => {
    const b = { id: 3000 + i, name, displayName: name, boundingBox: 'empty', hardness: 0, diggable: true, drops: [], transparent: true };
    reg.blocks[b.id] = b; reg.blocksByName[name] = b;
});
__setRegistryForTest(reg);
const key = (p) => `${p.x},${p.y},${p.z}`;
const BUSH = 'rustic:wildberry_bush';
const GARDEN = 'harvestcraft:aridgarden';
const IVY = ['biomesoplenty:plant_0', 4];
const HAWTHORN = ['biomesoplenty:plant_0', 5];

/**
 * A bot at 0 64 0 with `blocks` ({ "x,y,z": [name, meta] or name }); findBlocks as mineflayer's (with
 * `point`). Right-clicking a bush with berries makes it bare (meta 0, rotn-data rightClick.becomesMeta)
 * and gives 1 wildberries; digging a block removes it and gives `digGives`.
 */
function world({ blocks = {}, items = [], held = null, digGives = [] } = {}) {
    const cells = new Map(Object.entries(blocks).map(([k, v]) => [k, Array.isArray(v) ? v : [v, 0]]));
    const self = { id: 0, type: 'player', position: new Vec3(0.5, 64, 0.5) };
    const inv = [...items];
    const calls = { activate: [], dig: [], unequip: 0, sneak: [], goto: [], collected: [] };
    const blockAt = (p) => {
        const k = key({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
        const [name, metadata] = cells.get(k) ?? ['air', 0];
        return { name, metadata, type: reg.blocksByName[name]?.id, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
            boundingBox: 'empty', shapes: [], transparent: true, canHarvest: () => true };
    };
    const bot = {
        entity: self, entities: { 0: self }, heldItem: held, output: '', interrupt_code: false, registry: reg, version: '1.12.2',
        equip: (item) => { bot.heldItem = item; return Promise.resolve(); }, lookAt: () => Promise.resolve(), blockAtCursor: () => null,
        game: { gameMode: 'survival' },
        modes: { behavior_log: '', pause() {}, unpause() {}, isOn: () => false },
        inventory: { items: () => inv, slots: [null, ...inv], emptySlotCount: () => 20 },
        blockAt,
        findBlocks({ point, maxDistance, matching, count = 64 }) {
            const c = point ?? self.position;
            return [...cells.keys()].map(k => blockAt(new Vec3(...k.split(',').map(Number))))
                .filter(b => b.position.distanceTo(c) <= maxDistance && (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .sort((a, b) => a.position.distanceTo(c) - b.position.distanceTo(c)).slice(0, count).map(b => b.position);
        },
        nearestEntity: () => null,
        setControlState: (c, v) => calls.sneak.push([c, v]),
        unequip: () => { calls.unequip++; bot.heldItem = null; return Promise.resolve(); },
        activateBlock: (b) => {
            calls.activate.push(key(b.position));
            const [name, meta] = cells.get(key(b.position));
            if (name === BUSH && meta === 1) { cells.set(key(b.position), [BUSH, 0]); inv.push({ name: 'rustic:wildberries', metadata: 0, count: 1 }); }
            return Promise.resolve();
        },
        dig: (b) => { calls.dig.push(key(b.position)); cells.delete(key(b.position)); inv.push(...digGives.map(i => ({ ...i }))); return Promise.resolve(); },
        pathfinder: {
            getPathTo: () => ({ status: 'success', path: [] }),
            setMovements() {}, stop() {}, setGoal() {}, isMoving: () => false,
            goto: (goal) => { calls.goto.push([goal.x, goal.y, goal.z]); self.position = new Vec3(goal.x + 1.5, goal.y, goal.z + 0.5); return Promise.resolve(); },
        },
        calls, cells,
        tool: { equipForBlock: async () => {} },
        // mineflayer-collectblock: digs the block (the drops land in the inventory here).
        collectBlock: { collect: async (b) => { calls.collected.push(key(b.position)); await bot.dig(b); } },
    };
    return bot;
}

test('G4 #5 forage: the sources are rotn-data\'s, by full block name, ready states only; never the hawthorn, mushrooms or cloudsbluff', () => {
    const s = forageSources();
    assert.deepEqual([...s.get(BUSH)], [1], 'a wildberry bush with berries only (meta 0 is bare)');
    for (const herb of ['rustic:ginseng', 'rustic:marsh_mallow', 'rustic:core_root']) assert.deepEqual([...s.get(herb)], [3], `${herb}: ripe only`);
    for (const g of ['aridgarden', 'frostgarden', 'shadedgarden', 'soggygarden', 'tropicalgarden', 'windygarden']) assert.ok(s.has(`harvestcraft:${g}`), g);
    assert.equal(s.has('biomesoplenty:plant_0'), false, 'the hawthorn (its right-click poisons and hurts) is never a source');
    assert.equal(s.has('rustic:cloudsbluff'), false, 'avoided food');
    assert.equal(s.has('minecraft:brown_mushroom') || s.has('brown_mushroom'), false, 'food only once smelted');
    assert.ok([...s.keys()].every(n => /^[a-z_]+:[a-z_]+$/.test(n)), 'full namespaced names');
});

test('G4 #5 forage: what is taken and how: right-click a bush with berries, break a ripe herb or a garden; nothing else', () => {
    const at = (name, metadata) => usable(forageInfo({ name, metadata }));
    assert.equal(at(BUSH, 1), 'right-click');
    assert.equal(at(BUSH, 0), null, 'a bare bush waits to regrow');
    assert.equal(at('rustic:ginseng', 3), 'break');
    for (const m of [0, 1, 2]) assert.equal(at('rustic:ginseng', m), null, `an unripe herb (meta ${m})`);
    assert.equal(at(GARDEN, 0), 'break');
    assert.equal(at(...HAWTHORN), null, 'the hawthorn');
    assert.equal(at(...IVY), null, 'poison ivy');
    assert.equal(at('rustic:cloudsbluff', 3), null, 'avoided food');
    assert.equal(at('brown_mushroom', 0), null, 'a mushroom is not foraged');
    assert.equal(forageInfo({ name: 'log', metadata: 0 }), null);
});

test('G4 #5 forage: the name prefilter covers every block forage-food.json names (sources and hazards)', () => {
    const data = rotnData.loadRotnData(rotnData.PACK_VERSION).forageData;
    const names = [...data.blocks.map(b => b.block), ...data.hazards.map(h => h.block)];
    assert.ok(names.length > 10);
    for (const n of names) {
        assert.match(n, FORAGE_BLOCK_NAME, n);
        assert.match(rotnData.botName(n), FORAGE_BLOCK_NAME, `${n} as the bot names it`);
    }
    assert.doesNotMatch('log', FORAGE_BLOCK_NAME);
});

test('G4 #5 forage: walks step around poison ivy and thorns (touch hazards), not around other plants', () => {
    const moves = { exclusionAreasStep: [] };
    assert.equal(plantSafe(plantSafe(moves)), moves);
    assert.equal(moves.exclusionAreasStep.length, 1, 'added once');
    const cost = moves.exclusionAreasStep[0];
    assert.ok(cost({ name: IVY[0], metadata: IVY[1] }) >= 100, 'poison ivy');
    assert.ok(cost({ name: 'biomesoplenty:plant_1', metadata: 2 }) >= 100, 'thorns');
    assert.ok(cost({ name: 'biomesoplenty:plant_1', metadata: 6 }) >= 100, 'tiny cactus');
    assert.equal(cost({ name: 'biomesoplenty:plant_0', metadata: 0 }), 0, 'another BoP plant');
    assert.equal(cost({ name: BUSH, metadata: 1 }), 0);
    assert.equal(cost({ name: 'grass', metadata: 0 }), 0);
    assert.equal(touchHazards({ name: HAWTHORN[0], metadata: HAWTHORN[1] }).length, 0, 'the hawthorn harms on a right-click, not on touch');
    assert.equal(FORAGE.hazardCost >= 100, true);
});

test('G4 #5 forage: never broken: a berry bush (any state), an unripe herb, a hazard plant; a ripe herb or a mushroom may be', () => {
    const bot = world();
    const b = (name, metadata) => ({ name, metadata, position: new Vec3(3, 64, 0) });
    assert.match(breakRefusal(bot, b(BUSH, 1)) ?? '', /berry bush: never break it/);
    assert.match(breakRefusal(bot, b(BUSH, 0)) ?? '', /berry bush: never break it/);
    assert.match(breakRefusal(bot, b('rustic:ginseng', 1)) ?? '', /not ripe/);
    assert.match(breakRefusal(bot, b(...HAWTHORN)) ?? '', /hazard plant \(hawthorn\)/);
    assert.equal(breakRefusal(bot, b('rustic:ginseng', 3)), null);
    assert.equal(breakRefusal(bot, b('brown_mushroom', 0)), null);
    assert.equal(breakRefusal(bot, b('log', 0)), null);
    // Right-click: never the hawthorn.
    assert.match(rightClickRefusal(b(...HAWTHORN)) ?? '', /hurts on a right-click/);
    assert.equal(rightClickRefusal(b(BUSH, 1)), null);
});

test('G4 #5 forage: a crop near player-built blocks, farmland or a known base may be a player\'s: left alone like animals', () => {
    const p = new Vec3(4, 64, 0);
    assert.equal(mayBeAPlayersCrop(world(), p), null, 'wild');
    for (const name of ['fence', 'chest', 'torch', 'bed', 'farmland', 'rustic:crop_stake', 'flower_pot']) {
        const bot = world({ blocks: { '10,64,0': name } });
        assert.match(mayBeAPlayersCrop(bot, p) ?? '', new RegExp(`it is near a ${name} at 10, 64, 0`), name);
    }
    assert.equal(mayBeAPlayersCrop(world({ blocks: { '13,64,0': 'fence' } }), p), null, '9 away: wild');
    assert.match(mayBeAPlayersCrop(world(), p, { bases: [{ x: 30, y: 64, z: 0 }] }) ?? '', /player's base/);
    // The bot's own torch does not count.
    const own = world({ blocks: { '6,64,0': 'torch' } });
    own.rotnPlaced = new Set(['6,64,0']);
    assert.equal(mayBeAPlayersCrop(own, p), null);
    // And a garden in a player's yard is refused by a collect too.
    const yard = world({ blocks: { '6,64,0': 'fence' } });
    assert.match(breakRefusal(yard, { name: GARDEN, metadata: 0, position: p }) ?? '', /may be a player's: it is near a fence/);
});

test('G4 #5 forage: targets: ready and not a player\'s, nearest first; bare bushes, unripe herbs, hazards and tried blocks skipped', () => {
    const bot = world({ blocks: {
        '2,64,0': [BUSH, 0], // bare
        '3,64,0': ['rustic:ginseng', 2], // unripe
        '4,64,0': HAWTHORN,
        '5,64,0': IVY,
        '7,64,0': [BUSH, 1],
        '-9,64,0': [GARDEN, 0],
        '15,64,10': ['rustic:core_root', 3],
        '17,64,12': 'fence', // that root is near a fence
    } });
    const skipped = [];
    const ts = forageTargets(bot, { skipped });
    assert.deepEqual(ts.map(t => [key(t.block.position), t.how]), [['7,64,0', 'right-click'], ['-9,64,0', 'break']]);
    assert.match(skipped.join('; '), /rustic:core_root at 15, 64, 10: it is near a fence/);
    assert.equal(forageTarget(bot).info.block, BUSH);
    assert.deepEqual(nearbyForage(bot), [BUSH, GARDEN]);
    markTried(bot, new Vec3(7, 64, 0));
    assert.equal(forageTarget(bot).info.block, GARDEN, 'a block that failed is left alone for a while');
    assert.equal(forageTarget(bot, { now: Date.now() + FORAGE.triedMs + 1 }).info.block, BUSH, 'then tried again');
});

test('G4 #5 forage: the bush is right-clicked (never dug), not with bone meal in hand; a garden is broken, not sneaking', async () => {
    const bot = world({ blocks: { '6,64,0': [BUSH, 1], '-8,64,0': [GARDEN, 0] }, held: { name: 'dye', metadata: 15, count: 3 },
        digGives: [{ name: 'harvestcraft:cactusfruititem', metadata: 0, count: 1 }] });
    const got = await skills.forageNearby(bot);
    assert.equal(got, true);
    assert.deepEqual(bot.calls.activate, ['6,64,0'], 'the bush: right-clicked once');
    assert.ok(!bot.calls.dig.includes('6,64,0'), 'never broken');
    assert.deepEqual(bot.cells.get('6,64,0'), [BUSH, 0], 'it stays (bare, it regrows)');
    assert.equal(bot.calls.unequip >= 1, true, 'bone meal let go first (it would grow the bush instead)');
    assert.deepEqual(bot.calls.dig, ['-8,64,0'], 'the garden: broken');
    assert.ok(bot.calls.sneak.some(([c, v]) => c === 'sneak' && v === false), 'not sneaking (a garden broken sneaking drops itself)');
    assert.match(bot.output, /Foraged 2 blocks: got 1 rustic:wildberries, 1 harvestcraft:cactusfruititem/);
});

test('G4 #5 forage: nothing ripe, a hawthorn and poison ivy only: nothing touched, and it says so', async () => {
    const bot = world({ blocks: { '3,64,0': HAWTHORN, '4,64,0': IVY, '5,64,0': [BUSH, 0], '6,64,0': ['rustic:ginseng', 1] } });
    assert.equal(await skills.forageNearby(bot), false);
    assert.deepEqual(bot.calls.activate, []);
    assert.deepEqual(bot.calls.dig, []);
    assert.match(bot.output, /No ripe wild food within 24 blocks/);
});

test('G4 #5 forage: a block whose right-click does nothing is given up and left alone (bounded, no loop)', async () => {
    const bot = world({ blocks: { '6,64,0': [BUSH, 1] } });
    bot.activateBlock = (b) => { bot.calls.activate.push(key(b.position)); return Promise.resolve(); }; // nothing happens
    assert.equal(await skills.forageNearby(bot, { limits: { settleMs: 50, checkMs: 10 } }), false);
    assert.deepEqual(bot.calls.activate, ['6,64,0'], 'tried once');
    assert.equal(forageTarget(bot), null, 'then left alone');
    assert.match(bot.output, /Foraged 0 blocks, got nothing/);
});

test('G4 #5 forage: !activate and !useOn never right-click the hawthorn (nor touch poison ivy); another plant_0 is fine', async () => {
    const bot = world({ blocks: { '3,64,0': HAWTHORN, '4,64,0': IVY } });
    assert.equal(await skills.activateNearestBlock(bot, 'biomesoplenty:plant_0'), false);
    assert.equal(await skills.useToolOn(bot, 'hand', 'biomesoplenty:plant_0', { walkMs: 200, totalMs: 1000, settleMs: 100 }), false);
    assert.deepEqual(bot.calls.activate, [], 'never right-clicked');
    assert.match(bot.output, /Not activating biomesoplenty:plant_0: biomesoplenty:plant_0 hurts on a right-click/);
    assert.match(bot.output, /useOn refused: biomesoplenty:plant_0 hurts on a right-click/);
    // A harmless plant_0 (meta 0) behind them is activated.
    bot.cells.set('6,64,0', ['biomesoplenty:plant_0', 0]);
    assert.equal(await skills.activateNearestBlock(bot, 'biomesoplenty:plant_0'), true);
    assert.deepEqual(bot.calls.activate, ['6,64,0']);
});

test('G4 #5 forage: !collectBlocks never breaks a berry bush or an unripe herb, says why, and takes a ripe herb', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bush = world({ blocks: { '3,64,0': [BUSH, 1], '4,64,0': [BUSH, 0] } });
    assert.equal(await skills.collectBlock(bush, BUSH, 1), false);
    assert.deepEqual(bush.calls.dig, [], 'no bush broken');
    assert.match(bush.output, /rustic:wildberry_bush is a berry bush: never break it; pick its berries with !forage/);
    const herbs = world({ blocks: { '3,64,0': ['rustic:ginseng', 1], '5,64,0': ['rustic:ginseng', 3] }, digGives: [{ name: 'rustic:ginseng', metadata: 0, count: 1 }] });
    assert.equal(await skills.collectBlock(herbs, 'rustic:ginseng', 1), true);
    assert.deepEqual(herbs.calls.dig, ['5,64,0'], 'the ripe one only (the nearer one is unripe)');
});
