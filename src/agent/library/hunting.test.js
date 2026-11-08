// G4 #5: hunting for food, but never an animal that may belong to a player (the lead's hard rule for
// the live server): a name tag, tamed or owned, leashed, near player-built blocks the bot did not
// place, or near a known player base. A fake world; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { isHuntableAnimal, mayBelongToPlayer, huntTarget, knownBases, trackBotPlaced, nearbyHuntable, HUNT } from './hunting.js';

__setRegistryForTest(minecraftData('1.12.2'));
const key = (p) => `${p.x},${p.y},${p.z}`;

/** A bot at 0 64 0 with `animals` and `blocks` ({ "x,y,z": name }); findBlocks as mineflayer's (with `point`). */
function world({ animals = [], blocks = {} } = {}) {
    const cells = new Map(Object.entries(blocks));
    const self = { id: 0, type: 'player', position: new Vec3(0.5, 64, 0.5) };
    const bot = {
        entity: self,
        entities: Object.fromEntries([[0, self], ...animals.map((a, i) => [i + 1, { id: i + 1, type: 'mob', metadata: {}, ...a }])]),
        blockAt: (p) => { const k = key(p.floored ? p.floored() : p); return cells.has(k) ? { name: cells.get(k), position: p } : { name: 'air', position: p }; },
        findBlocks({ point, maxDistance, matching, count }) {
            const c = point ?? self.position;
            return [...cells.entries()].map(([k, name]) => ({ name, position: new Vec3(...k.split(',').map(Number)) }))
                .filter(b => b.position.distanceTo(c) <= maxDistance && matching(b)).slice(0, count).map(b => b.position);
        },
        placeBlock: () => Promise.resolve(),
    };
    return bot;
}
const cow = (x, extra = {}) => ({ name: 'animania:cow_holstein', position: new Vec3(x + 0.5, 64, 0.5), ...extra });

test('G4 #5: what may be hunted: vanilla adults and Animania\'s adult females; never young, males or hostile mobs', () => {
    for (const name of ['cow', 'pig', 'sheep', 'animania:cow_holstein', 'animania:sow_old_spot', 'animania:ewe_jacob', 'animania:doe_cottontail', 'animania:hen_wyandotte'])
        assert.equal(isHuntableAnimal({ name, metadata: {} }), true, name);
    for (const name of ['animania:calf_holstein', 'animania:piglet_old_spot', 'animania:bull_angus', 'animania:hog_old_spot', 'animania:ram_jacob', 'animania:rooster_wyandotte', 'zombie', 'wolf', 'villager'])
        assert.equal(isHuntableAnimal({ name, metadata: {} }), false, name);
    assert.equal(isHuntableAnimal({ name: 'cow', metadata: { 12: true } }), false, 'a vanilla calf (the baby flag)');
});

test('G4 #5: each exclusion: a name tag, an owner UUID, a tamed llama, a leash', () => {
    const bot = world();
    assert.equal(mayBelongToPlayer(bot, cow(3)), null, 'a wild cow');
    assert.equal(mayBelongToPlayer(bot, cow(3, { metadata: { 2: 'Bessie' } })), 'it has a name tag');
    assert.equal(mayBelongToPlayer(bot, cow(3, { metadata: { 2: { text: 'Bessie' } } })), 'it has a name tag', 'a component name');
    assert.equal(mayBelongToPlayer(bot, cow(3, { metadata: { 2: '' } })), null, 'an empty name is no name');
    assert.equal(mayBelongToPlayer(bot, cow(3, { metadata: { 14: '0f5c4ad2-1234-4abc-8def-0123456789ab' } })), 'it is tamed', 'an owner UUID');
    assert.equal(mayBelongToPlayer(bot, { name: 'llama', position: new Vec3(3, 64, 0), metadata: { 13: 0x02 } }), 'it is tamed', 'the tame bit');
    assert.equal(mayBelongToPlayer(bot, cow(3, { vehicle: { id: 99, name: 'leash_knot' } })), 'it is on a leash');
});

test('G4 #5: near player-built blocks (fences, gates, walls, beds, chests, tables, torches) within 8: left alone; the bot\'s own placed blocks do not count', async () => {
    for (const name of ['fence', 'spruce_fence', 'fence_gate', 'cobblestone_wall', 'bed', 'chest', 'trapped_chest', 'crafting_table', 'torch', 'biomesoplenty:fir_fence']) {
        const bot = world({ blocks: { '8,64,0': name } });
        assert.match(mayBelongToPlayer(bot, cow(3)) ?? '', new RegExp(`it is near a ${name} at 8, 64, 0`), name);
    }
    // 9 or more blocks away: wild.
    assert.equal(mayBelongToPlayer(world({ blocks: { '13,64,0': 'fence' } }), cow(3)), null);
    // Not a player-built block: wild.
    assert.equal(mayBelongToPlayer(world({ blocks: { '5,64,0': 'stone', '6,64,0': 'log' } }), cow(3)), null);
    // The bot's own crafting table and torch: they never make an animal look owned.
    const bot = world({ blocks: { '4,64,0': 'crafting_table', '5,65,0': 'torch' } });
    trackBotPlaced(bot);
    await bot.placeBlock({ position: new Vec3(4, 63, 0) }, new Vec3(0, 1, 0));
    await bot.placeBlock({ position: new Vec3(5, 64, 0) }, new Vec3(0, 1, 0));
    assert.equal(mayBelongToPlayer(bot, cow(3)), null);
    assert.ok(bot.rotnPlaced.size <= HUNT.placedMax);
});

test('G4 #5: within 32 blocks of a known player base (a place in memory named base or home): left alone', () => {
    const agent = { memory_bank: { memory: { 'JQDAW base': [40, 64, 0], home: [-300, 70, 0], 'last_death_position': [5, 64, 5], 'nice spot': [0, 64, 0] } } };
    const bases = knownBases(agent);
    assert.deepEqual(bases.map(b => b.x).sort((a, b) => a - b), [-300, 40]);
    assert.equal(mayBelongToPlayer(world(), cow(10), { bases }), 'it is near a player\'s base');
    assert.equal(mayBelongToPlayer(world(), cow(-20), { bases }), null, '60 blocks away');
});

test('G4 #5: the target is the nearest animal that may not belong to a player; the others are named', () => {
    const bot = world({ animals: [cow(2, { metadata: { 2: 'Bessie' } }), cow(5, { vehicle: { id: 9 } }), cow(9), { name: 'animania:calf_holstein', position: new Vec3(1.5, 64, 0.5) }], blocks: {} });
    const skipped = [];
    const t = huntTarget(bot, { skipped });
    assert.equal(t?.position.x, 9.5);
    assert.deepEqual(skipped, ['animania:cow_holstein: it has a name tag', 'animania:cow_holstein: it is on a leash']);
    assert.deepEqual(nearbyHuntable(bot), ['animania:cow_holstein']);
    assert.equal(huntTarget(world({ animals: [cow(2, { metadata: { 2: 'Bessie' } })] })), null);
});
