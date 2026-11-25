// G4 #5: hunting for food, but never an animal that may belong to a player (the lead's hard rule for
// the live server): a name tag, tamed or owned, leashed, near player-built blocks the bot did not
// place, or near a known player base. A fake world; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../../utils/mcdata.js';
import { isHuntableAnimal, mayBelongToPlayer, huntTarget, knownBases, trackBotPlaced, nearbyHuntable, huntAnimal, HUNT, matchesKind, retaliationRisk, weaponSweepOf, attackWeapon, SWEEP } from './hunting.js';

__setRegistryForTest(minecraftData('1.12.2'));
const key = (p) => `${p.x},${p.y},${p.z}`;

/** A bot at 0 64 0 with `animals` and `blocks` ({ "x,y,z": name }); findBlocks as mineflayer's (with `point`). */
function world({ animals = [], blocks = {} } = {}) {
    const cells = new Map(Object.entries(blocks));
    const self = { id: 0, type: 'player', position: new Vec3(0.5, 64, 0.5) };
    const bot = {
        entity: self,
        entities: Object.fromEntries([[0, self], ...animals.map((a, i) => [i + 1, { id: i + 1, type: 'mob', metadata: { 7: 10 }, ...a }])]),
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
const HEALTH = { 7: 10 }; // 1.12 EntityLivingBase health: what a real animal's metadata always has
const cow = (x, extra = {}) => ({ name: 'animania:cow_holstein', position: new Vec3(x + 0.5, 64, 0.5), ...extra, metadata: { ...HEALTH, ...(extra.metadata ?? {}) } });

test('G4 #5: what may be hunted: vanilla adults and Animania\'s adult females; never young, males or hostile mobs', () => {
    // Soak 16 (F4): hogs too (no attack AI; 2-8 pork).
    for (const name of ['cow', 'mooshroom', 'pig', 'rabbit', 'sheep', 'animania:cow_holstein', 'animania:sow_old_spot', 'animania:hog_old_spot', 'animania:ewe_jacob', 'animania:doe_cottontail'])
        assert.equal(isHuntableAnimal({ name, metadata: {} }), true, name);
    // #422 review 5: no chicken or hen (raw chicken is avoided food), no llama (no meat).
    for (const name of ['chicken', 'animania:hen_wyandotte', 'llama', 'animania:calf_holstein', 'animania:piglet_old_spot', 'animania:bull_angus', 'animania:ram_jacob', 'animania:rooster_wyandotte', 'zombie', 'wolf', 'villager'])
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
    assert.equal(mayBelongToPlayer(bot, { name: 'llama', position: new Vec3(3, 64, 0), metadata: { 7: 10, 13: 0x02 } }), 'it is tamed', 'the tame bit');
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
    // The wild one is an Angus: three Holsteins within 16 would be a herd (#448), which is not hunted.
    const bot = world({ animals: [cow(2, { metadata: { 2: 'Bessie' } }), cow(5, { vehicle: { id: 9 } }), cow(9, { name: 'animania:cow_angus' }), { name: 'animania:calf_holstein', position: new Vec3(1.5, 64, 0.5), metadata: HEALTH }], blocks: {} });
    const skipped = [];
    const t = huntTarget(bot, { skipped });
    assert.equal(t?.position.x, 9.5);
    assert.deepEqual(skipped, ['animania:cow_holstein (may belong to a player: it has a name tag)', 'animania:cow_holstein (may belong to a player: it is on a leash)']);
    assert.deepEqual(nearbyHuntable(bot), ['animania:cow_angus']);
    assert.equal(huntTarget(world({ animals: [cow(2, { metadata: { 2: 'Bessie' } })] })), null);
});

test('#422 review 3: unknown metadata (missing, empty, or forge-bridge\'s metadataError) is never taken for wild', () => {
    const bot = world();
    const base = { name: 'animania:cow_holstein', position: new Vec3(3.5, 64, 0.5) };
    for (const e of [{ ...base }, { ...base, metadata: null }, { ...base, metadata: {} }, { ...base, metadata: { 7: 10 }, forge: { metadataError: 'bad serializer' } }])
        assert.equal(mayBelongToPlayer(bot, e), 'its data (metadata) is unknown', JSON.stringify(e.metadata ?? null));
    assert.equal(mayBelongToPlayer(bot, { ...base, metadata: { 7: 10 }, forge: { metadataError: null } }), null);
});

test('#422 review 9: a saddled pig, an animal carrying a passenger, and a sheep that is not white are left alone', () => {
    const bot = world();
    const at = new Vec3(3.5, 64, 0.5);
    assert.equal(mayBelongToPlayer(bot, { name: 'pig', position: at, metadata: { 7: 10, 13: true } }), 'it has a saddle');
    assert.equal(mayBelongToPlayer(bot, { name: 'pig', position: at, metadata: { 7: 10, 13: false } }), null);
    assert.equal(mayBelongToPlayer(bot, cow(3, { passengers: [{ id: 5 }] })), 'it carries a passenger');
    assert.equal(mayBelongToPlayer(bot, { name: 'sheep', position: at, metadata: { 7: 8, 13: 14 } }), 'it is not a white sheep (dyed or bred)', 'red');
    assert.equal(mayBelongToPlayer(bot, { name: 'sheep', position: at, metadata: { 7: 8, 13: 0x10 } }), null, 'white, sheared');
    assert.equal(mayBelongToPlayer(bot, { name: 'sheep', position: at, metadata: { 7: 8, 13: 0 } }), null, 'white');
});

test('#422 review 1: a hunt is bounded: it ends when keepGoing says no (dusk), after maxMs, or when the animal is dead; pvp always stops', async () => {
    const saved = { ...HUNT };
    Object.assign(HUNT, { checkMs: 10 });
    try {
        const run = async ({ keepGoing, maxMs, dies = false }) => {
            const target = cow(5);
            const bot = world({ animals: [target] });
            const e = bot.entities[1];
            const calls = [];
            bot.pvp = { attack: () => { calls.push('attack'); if (dies) setTimeout(() => delete bot.entities[1], 30); }, stop: () => calls.push('stop') };
            const end = await huntAnimal(bot, e, { keepGoing, maxMs });
            return { end, calls };
        };
        let n = 0;
        const dusk = await run({ keepGoing: () => ++n < 3, maxMs: 60_000 });
        assert.deepEqual(dusk, { end: 'stopped', calls: ['attack', 'stop'] }, 'the phase turned');
        const slow = await run({ keepGoing: () => true, maxMs: 50 });
        assert.deepEqual(slow, { end: 'time', calls: ['attack', 'stop'] }, 'an unreachable cow');
        const kill = await run({ keepGoing: () => true, maxMs: 60_000, dies: true });
        assert.equal(kill.end, 'killed');
        assert.equal(kill.calls.at(-1), 'stop');
    } finally { Object.assign(HUNT, saved); }
});


test('soak 2: a hunt that gets nowhere (no move, no closer, no hit) ends stuck after stuckMs; any progress keeps it going', async () => {
    const saved = { ...HUNT };
    Object.assign(HUNT, { checkMs: 10 });
    try {
        const run = async (onTick) => {
            const bot = world({ animals: [cow(5)] });
            const e = bot.entities[1];
            const calls = [];
            bot.pvp = { attack: () => calls.push('attack'), stop: () => calls.push('stop') };
            let ticks = 0;
            const t0 = Date.now();
            const end = await huntAnimal(bot, e, { keepGoing: () => { onTick?.(bot, e, ++ticks); return true; }, maxMs: 400, stuckMs: 100 });
            return { end, calls, ms: Date.now() - t0 };
        };
        const stuck = await run();
        assert.equal(stuck.end, 'stuck', 'the sow uphill, out of reach');
        assert.ok(stuck.ms < 300, `before maxMs: ${stuck.ms} ms`);
        assert.deepEqual(stuck.calls, ['attack', 'stop']);
        // The bot walks a block every few ticks: not stuck (it runs to maxMs).
        assert.equal((await run((bot, e, n) => { if (n % 5 === 0) bot.entity.position = bot.entity.position.offset(1, 0, 0); })).end, 'time');
        // #431 review 5: going up and down in place (a jump, a slope) is no move and no closing in.
        assert.equal((await run((bot, e, n) => { bot.entity.position = bot.entity.position.offset(0, n % 2 ? 1.5 : -1.5, 0); })).end, 'stuck');
        // Its hits land (the animal's health falls): not stuck.
        assert.equal((await run((bot, e, n) => { if (n % 5 === 0) e.metadata[7] = 10 - n / 100; })).end, 'time');
    } finally { Object.assign(HUNT, saved); }
});

test('soak 2: an animal the hunt could not get is left alone for HUNT.skipMs (the target and the prompt\'s list)', async () => {
    const { skipAnimal } = await import('./hunting.js');
    const bot = world({ animals: [cow(4), cow(9, { name: 'animania:cow_angus' })] }); // two breeds: no herd (#448)
    assert.equal(huntTarget(bot).id, 1);
    skipAnimal(bot, 1);
    assert.equal(huntTarget(bot).id, 2, 'the next one');
    assert.equal(nearbyHuntable(bot).length, 1);
    skipAnimal(bot, 2);
    assert.equal(huntTarget(bot), null, 'both left alone now');
    bot.rotnHuntSkip.set(1, Date.now() - 1);
    assert.equal(huntTarget(bot).id, 1, 'after skipMs, again');
});

test('soak 7 (c): a hunt takes the best weapon (equipHighestAttack) before its first attack, and logs it', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const { equipHighestAttack } = await import('./skills.js');
    const saved = { ...HUNT };
    Object.assign(HUNT, { checkMs: 10 });
    t.after(() => Object.assign(HUNT, saved));
    const bot = world({ animals: [cow(2)] });
    Object.assign(bot, { heldItem: null, inventory: { items: () => [{ name: 'pyrotech:crude_axe', count: 1 }, { name: 'stone_axe', count: 1 }, { name: 'stone_sword', count: 1 }], slots: [] } });
    bot.equip = (item) => { bot.heldItem = item; return Promise.resolve(); };
    const held = [];
    bot.pvp = { attack: () => { held.push(bot.heldItem?.name ?? 'hand'); setTimeout(() => delete bot.entities[1], 20); }, stop() {} };
    assert.equal(await huntAnimal(bot, bot.entities[1], { equip: (b) => equipHighestAttack(b), maxMs: 2000 }), 'killed');
    assert.deepEqual(held, ['stone_sword']);
    assert.ok(logs.includes('[survival] weapon stone_sword (hunt)'), logs.join('\n'));
});

// Soak 16 (F4, F5; rotn-data's soak 15 food answer): hogs are food (no attack AI); a bull charges only what hurt it,
// so it is no reason unless the weapon the bot will hit with may sweep onto it; the herd (same-breed cows) is
// checked again during the chase.
const bull = (x, extra = {}) => ({ name: 'animania:bull_holstein', position: new Vec3(x + 0.5, 64, 0.5), height: 1.6, ...extra, metadata: { ...HEALTH, ...(extra.metadata ?? {}) } });
// The bot's attacks go through Better Combat's packet (bc_attack on, as on the soak server): attackPath 'bettercombat'.
const BC = { bcAttack: { active: true } };
const held = (bot, items, hand = null) => Object.assign(bot, { inventory: { items: () => items, slots: [] }, heldItem: hand, forge: BC });
const item = (name) => ({ name, count: 1, metadata: 0 });

test('soak 16 (F4): a hog is hunted like a sow, and "pig" finds both; a piglet never', () => {
    assert.equal(isHuntableAnimal({ name: 'animania:hog_old_spot', metadata: {} }), true);
    assert.equal(isHuntableAnimal({ name: 'animania:piglet_old_spot', metadata: {} }), false, 'no drop');
    assert.equal(matchesKind({ name: 'animania:hog_old_spot' }, 'pig'), true);
    assert.equal(matchesKind({ name: 'animania:sow_large_black' }, 'pig'), true);
    // Soak 15 00:10:51: a lone hog with a bull 10 blocks off was refused; now it is the target.
    const bot = held(world({ animals: [{ name: 'animania:hog_old_spot', position: new Vec3(4.5, 64, 0.5) }, bull(14)] }), [item('spartanweaponry:club_wood')]);
    assert.equal(huntTarget(bot)?.name, 'animania:hog_old_spot');
});

test('soak 16 (F5): the sweep of the weapon the bot will hit with: swords sweep, clubs, axes and pickaxes do not, an unknown item may (2.5 blocks)', () => {
    const bot = { forge: BC };
    // #627 review 6: on the vanilla fallback path (no Better Combat packet) rotn-data has the club sweep like a sword,
    // with no radius: reach 2.5.
    assert.deepEqual(weaponSweepOf({}, item('spartanweaponry:club_wood')), { sweeps: true, reach: SWEEP.unknownReach }, 'the vanilla path');
    assert.deepEqual(weaponSweepOf(bot, item('iron_sword')).sweeps, true);
    assert.equal(weaponSweepOf(bot, item('spartanweaponry:club_wood')).sweeps, false);
    assert.equal(weaponSweepOf(bot, item('stone_pickaxe')).sweeps, false);
    assert.equal(weaponSweepOf(bot, item('pyrotech:crude_axe')).reach, 0);
    const unknown = weaponSweepOf(bot, item('stick'));
    assert.equal(unknown.sweeps, null, 'an item not listed may sweep');
    assert.equal(unknown.reach, SWEEP.unknownReach);
    assert.deepEqual(SWEEP, { margin: 0.9, unknownReach: 2.5 });
    // The weapon after the hunt's equip, not the stick in hand: the club in the inventory.
    const b = held(world(), [item('spartanweaponry:club_wood'), item('stick')], item('stick'));
    assert.equal(attackWeapon(b).name, 'spartanweaponry:club_wood');
});

test('soak 16 (F5): a bull counts only within the sweep of the weapon: a club never; a sword when it stands within reach of the cow', () => {
    const near = (weapon) => held(world({ animals: [cow(4), bull(5)] }), [item(weapon)]);
    const c = near('spartanweaponry:club_wood');
    assert.equal(retaliationRisk(c, c.entities[1]), null, 'a club does not sweep');
    const s = near('iron_sword');
    assert.match(retaliationRisk(s, s.entities[1]), /^a animania:bull_holstein 1\.0 blocks from it, within your weapon's sweep \(2\.\d blocks\): a hit on it would make it charge$/);
    const far = held(world({ animals: [cow(4), bull(8)] }), [item('iron_sword')]);
    assert.equal(retaliationRisk(far, far.entities[1]), null, '4 blocks off: out of the sword\'s sweep');
    // A polar bear (fightBack false, calls for help) keeps the 16-block rule.
    const bear = held(world({ animals: [cow(4), { name: 'polar_bear', position: new Vec3(14.5, 64, 0.5) }] }), [item('spartanweaponry:club_wood')]);
    assert.match(retaliationRisk(bear, bear.entities[1]), /^a polar_bear within 16 blocks/);
    // The herd: same-breed cows only (the breed's class); an Angus beside a Holstein is no herd.
    const angus = held(world({ animals: [cow(4), cow(6, { name: 'animania:cow_angus' })] }), [item('spartanweaponry:club_wood')]);
    assert.equal(retaliationRisk(angus, angus.entities[1]), null);
    const herd = held(world({ animals: [cow(4), cow(6)] }), [item('spartanweaponry:club_wood')]);
    assert.match(retaliationRisk(herd, herd.entities[1]), /^in a herd: another animania:cow_holstein within 16 blocks/);
});

test('soak 16 (F5): the herd rule is checked again during the chase: a herd that gathers ends the hunt as "risk", and the animal is skipped', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bot = held(world({ animals: [cow(4)] }), [item('spartanweaponry:club_wood')], item('spartanweaponry:club_wood'));
    const target = bot.entities[1];
    bot.pvp = { attack() {}, stop() {} };
    const saved = HUNT.checkMs;
    HUNT.checkMs = 5;
    t.after(() => { HUNT.checkMs = saved; });
    setTimeout(() => { bot.entities[2] = { id: 2, type: 'mob', name: 'animania:cow_holstein', metadata: { ...HEALTH }, position: new Vec3(7.5, 64, 0.5) }; }, 12);
    const end = await huntAnimal(bot, target, { maxMs: 2000 });
    assert.equal(end, 'risk');
    assert.match(bot.rotnHuntRisk, /^in a herd: another animania:cow_holstein/);
    assert.ok(bot.rotnHuntSkip.get(target.id) > Date.now(), 'left alone for a while');
});
