// Offline tests for skills-rotn D2c: the modes react to mobs by rotn-data's threat
// table (threatOf), not by type 'mob'. Real rotn-data entries, a fake bot with
// entities at fixed distances; no server, no LLM.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { threatFor, threatPlan, doNotLook, doNotLookNear, isAngry, nightThreatNote, RANGES, shelterTarget, shelterEnemy, fightRefusal, maxHitOf,
    meleeReach, inMeleeReach, hurtingInReach, weaponCooldownMs, WEAPON_COOLDOWN_MS, fightNumbers, fightOdds, shelterEatBlock, EAT_SAFE } from './threats.js';
import { __modeForTest, __resetThreatLease } from '../modes.js';

let nextId = 1;
const mob = (name, x, type = 'mob') => ({ id: nextId++, name, type, position: new Vec3(x, 64, 0), height: 1.8 });
/**
 * rotn-data #518: a zombie's maxDamage is data (12.5, then 10.5): the health thresholds below come
 * from it. ZOMBIE_HIT: what a zombie may hit for; UNDER: the whole health just below it (12, or 10);
 * OVER: the whole health just above it (13, or 11).
 */
const ZOMBIE_HIT = maxHitOf({ name: 'zombie', type: 'mob' });
const UNDER = Number.isInteger(ZOMBIE_HIT) ? ZOMBIE_HIT - 1 : Math.floor(ZOMBIE_HIT);
const OVER = Math.floor(ZOMBIE_HIT) + 1;
function fakeBot(entities, extra = {}) {
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0, 64, 0) };
    const all = { 0: self };
    for (const e of entities) all[e.id] = e;
    // Soak 5: a fight in the open needs a weapon and health above the mob's maxDamage (threats.fightRefusal); the fake
    // bot holds an iron sword at full health unless a case says otherwise.
    return { entity: self, entities: all, lastDamageTime: 0, health: 20, inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: [] }, ...extra };
}

test('threatFor reads rotn-data: zombie fight, creeper keep-distance, skeleton take-cover, dragon avoid, enderman do-not-look', () => {
    const r = (name, type) => threatFor(mob(name, 1, type));
    assert.deepEqual([r('zombie').reaction, r('zombie').doNotLook], ['fight', false]);
    assert.deepEqual([r('creeper').reaction, r('creeper').explodes], ['keep-distance', true]);
    assert.deepEqual([r('skeleton').reaction, r('skeleton').ranged], ['take-cover', true]);
    assert.equal(r('iceandfire:firedragon').reaction, 'avoid');
    assert.deepEqual([r('enderman').reaction, r('enderman').doNotLook], ['ignore-unless-provoked', true]);
    assert.equal(r('ancientbeasts:rifted_enderman').doNotLook, true);
    assert.equal(r('cow').reaction, 'ignore');
    assert.equal(r('JQDAW', 'player'), null, 'players are no threat');
    assert.equal(threatFor({ name: 'item', type: 'object', position: new Vec3(1, 64, 0) }), null);
    assert.equal(r('somemod:unknown_beast').reaction, 'fight', 'an unknown hostile mob falls back to fight');
    assert.equal(doNotLook(mob('enderman', 3)), true);
    assert.equal(doNotLook(mob('zombie', 3)), false);
    // rotn-data #187's lookAt, beyond the ignore-unless-provoked mobs the old summary regex covered:
    assert.deepEqual([r('specialmobs:endercreeper').reaction, r('specialmobs:endercreeper').doNotLook], ['keep-distance', true], 'the ender creeper');
    assert.deepEqual([r('iceandfire:if_cockatrice').reaction, r('iceandfire:if_cockatrice').doNotLook], ['avoid', true], 'the cockatrice');
    assert.deepEqual([r('iceandfire:gorgon').reaction, r('iceandfire:gorgon').doNotLook], ['avoid', true], 'the gorgon (rotn-data #188)');
    assert.equal(r('creeper').doNotLook, false);
});

test('the plan, first match wins: dangerous > explodes > outnumbered > ranged > melee > provoked', () => {
    const plan = (...es) => threatPlan(fakeBot(es));
    const lone = plan(mob('zombie', 5));
    assert.deepEqual([lone.action, lone.why], ['fight', 'melee']);

    const two = plan(mob('zombie', 5), mob('husk', 6));
    assert.deepEqual([two.action, two.why, two.away], ['flee', 'outnumbered', RANGES.fight.away]);

    const creeper = mob('creeper', 5);
    const boom = plan(creeper, mob('zombie', 3));
    assert.deepEqual([boom.action, boom.why, boom.from], ['flee', 'explodes', creeper]);
    assert.equal(boom.isEnemy(mob('zombie', 1)), false, 'it backs off from the creeper, not the zombie');
    assert.equal(plan(mob('creeper', RANGES['keep-distance'].near + 1)), null, 'a far creeper is left alone');

    const dragon = plan(mob('iceandfire:firedragon', 20), mob('creeper', 2));
    assert.deepEqual([dragon.action, dragon.why], ['flee', 'dangerous']);

    assert.deepEqual([plan(mob('skeleton', 10)).action, plan(mob('skeleton', 10)).why], ['flee', 'ranged']);
    assert.equal(plan(mob('skeleton', RANGES['take-cover'].near + 2)), null);
    assert.equal(plan(mob('cow', 2)), null);
    assert.equal(plan(), null);
});

test('nightThreats becomes one line for the night routine (D2b)', () => {
    const note = nightThreatNote({ limit: 6 });
    assert.match(note, /^Tonight expect: /);
    assert.match(note, /Creeper \(keep-distance, explodes\)/);
    assert.ok(note.split('; ').length <= 6);
});

// The modes act on the plan. isClearPath runs on a fake pathfinder; the skill itself is not run.
function modeAgent(entities) {
    __resetThreatLease(); // one fake agent per case; the lease is per process
    const bot = fakeBot(entities, {
        registry: minecraftData('1.12.2'), version: '1.12.2',
        pathfinder: { getPathFromTo: function* () { yield { result: { status: 'success', path: [] } }; } },
        modes: { behavior_log: '' },
    });
    bot.nearestEntity = () => null;
    const ran = [];
    return {
        ran, bot, shut_up: true,
        actions: { currentActionLabel: '', resume_func: null, runAction: (label) => { ran.push(label); return Promise.resolve({ message: 'ok', interrupted: false }); } },
        openChat() {},
    };
}
async function tick(agent) {
    for (const name of ['cowardice', 'self_defense']) {
        const mode = __modeForTest(name);
        await mode.update(agent);
        if (agent.ran.length) return;
    }
}

test('modes: cowardice backs off from a creeper, self_defense fights a lone zombie, nobody touches an enderman', async (t) => {
    t.mock.method(console, 'log', () => {});
    const a = modeAgent([mob('creeper', 4)]);
    await tick(a);
    assert.deepEqual(a.ran, ['mode:cowardice']);
    assert.match(a.bot.modes.behavior_log, /Backing off: creeper \(explodes\)!/);

    const b = modeAgent([mob('zombie', 4)]);
    await tick(b);
    assert.deepEqual(b.ran, ['mode:self_defense']);
    assert.match(b.bot.modes.behavior_log, /Fighting zombie!/);

    const c = modeAgent([mob('zombie', 4), mob('zombie', 5)]);
    await tick(c);
    assert.deepEqual(c.ran, ['mode:cowardice'], 'two at once: retreat');

    const d = modeAgent([mob('enderman', 3)]);
    await tick(d);
    assert.deepEqual(d.ran, [], 'neither fought nor fled');
});

test('modes: idle_staring never looks at an enderman', () => {
    const ender = mob('enderman', 3);
    const looked = [];
    const agent = { bot: { ...fakeBot([ender]), nearestEntity: () => ender, lookAt: (p) => looked.push(p), look: () => {} } };
    const mode = __modeForTest('idle_staring');
    mode.last_entity = null;
    mode.next_change = Date.now() + 60_000;
    mode.update(agent);
    assert.deepEqual(looked, []);
    const zombie = mob('zombie', 3);
    agent.bot.nearestEntity = () => zombie;
    mode.update(agent);
    assert.equal(looked.length, 1, 'a zombie is looked at');
});

test('#186 review 2: an enderman is fought back only when it is angry (its screaming flag), never for any damage', () => {
    const now = 100_000;
    const calm = mob('enderman', 2);
    assert.equal(threatPlan(fakeBot([calm])), null, 'calm, no damage');
    assert.equal(threatPlan(fakeBot([calm], { lastDamageTime: now - 500 }), { now }), null, 'fall damage next to a calm enderman: no attack');
    const angry = { ...mob('enderman', 2), metadata: { 13: true } };
    assert.equal(isAngry(angry), true);
    assert.equal(isAngry(calm), false);
    const hit = threatPlan(fakeBot([angry, mob('cow', 1)]), { now });
    assert.deepEqual([hit.action, hit.why, hit.from], ['fight', 'provoked', angry]);
    assert.equal(hit.isEnemy(angry), true);
    assert.equal(hit.isEnemy(mob('enderman', 2)), false, 'only that one');
    assert.equal(threatPlan(fakeBot([{ ...mob('enderman', 6), metadata: { 13: true } }])), null, 'an angry one further off is left alone');

    // A do-not-look mob whose anger cannot be read: never attacked; after a hit next to it, back off.
    const rifted = mob('ancientbeasts:rifted_enderman', 2);
    assert.equal(isAngry(rifted), null);
    assert.equal(threatPlan(fakeBot([rifted])), null);
    const back = threatPlan(fakeBot([rifted], { lastDamageTime: now - 500 }), { now });
    assert.deepEqual([back.action, back.why, back.isEnemy(rifted)], ['flee', 'provoked', true]);
});

/** #497 review 6: wait for a mode's action to end, at most 5 s (a hang fails the test, not the run). */
async function untilIdle(name, ms = 5000) {
    const deadline = Date.now() + ms;
    while (__modeForTest(name).active) {
        if (Date.now() > deadline) throw new Error(`${name} still active after ${ms} ms`);
        await new Promise(r => setTimeout(r, 10));
    }
}

// A bot whose pathfinder and pvp are fakes, so defendSelf and avoidEnemies really run.
// #518 (rotn-lead): a test that fails with its fight still running (untilIdle throws) left defendSelf
// looping, and the file never exited. After the file's tests every such fight is interrupted, so a
// failure ends the run.
const fightBots = [];
after(() => { for (const b of fightBots) b.interrupt_code = true; });
function fightBot(entities) {
    const bot = fakeBot(entities, {
        registry: minecraftData('1.12.2'), version: '1.12.2', output: '',
        inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: [] }, heldItem: { name: 'iron_sword' }, equip: async () => {},
        modes: { pause() {}, behavior_log: '' },
        pvp: { attacks: [], attack(e) { this.attacks.push(e.name); }, stop() {} },
    });
    bot.nearestEntity = (pred) => Object.values(bot.entities)
        .filter(e => e !== bot.entity && pred(e))
        .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] ?? null;
    bot.pathfinder = {
        goals: [],
        getPathFromTo: function* () { yield { result: { status: 'success', path: [] } }; },
        setMovements() {}, goto: () => Promise.resolve(), stop() {},
        setGoal(goal) { this.goals.push(goal); bot.interrupt_code = true; }, // one flee step, then stop
    };
    fightBots.push(bot);
    return bot;
}

test('#186 review 1: a creeper arriving mid-fight ends the fight, and the bot backs off', async (t) => {
    t.mock.method(console, 'log', () => {});
    const zombie = mob('zombie', 3);
    const bot = fightBot([zombie]);
    const attack = bot.pvp.attack.bind(bot.pvp);
    bot.pvp.attack = (e) => { attack(e); const c = mob('creeper', 4); bot.entities[c.id] = c; }; // it arrives
    const agent = { bot, shut_up: true, openChat() {}, actions: { currentActionLabel: '', resume_func: null,
        runAction: async (label, fn) => { await fn(); return { message: 'ok', interrupted: false }; } } };
    await __modeForTest('self_defense').update(agent);
    await untilIdle('self_defense');
    assert.deepEqual(bot.pvp.attacks, ['zombie'], 'one round, then it stopped');
    assert.match(bot.output, /Stopped fighting: the situation changed\./);
    assert.match(bot.modes.behavior_log, /Fighting zombie!\nBacking off: creeper \(explodes\)!/);
    assert.equal(bot.pathfinder.goals.length, 1, 'it moved away');
});

test('#186 review 1: defendSelf keeps fighting while keepFighting says so (the default), and stops when it does not', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { defendSelf } = await import('./skills.js');
    const zombie = mob('zombie', 3);
    const bot = fightBot([zombie]);
    let rounds = 0;
    const attack = bot.pvp.attack.bind(bot.pvp);
    bot.pvp.attack = (e) => { attack(e); if (++rounds === 2) delete bot.entities[zombie.id]; }; // dies in round 2
    assert.equal(await defendSelf(bot, 8, (e) => e.name === 'zombie'), true);
    assert.equal(rounds, 2);
    const again = fightBot([mob('zombie', 3)]);
    assert.equal(await defendSelf(again, 8, (e) => e.name === 'zombie', () => false), true);
    assert.equal(again.pvp.attacks.length, 1);
});

test('#186 review 3: no random looks either while a do-not-look mob is loaded nearby', () => {
    const ender = mob('enderman', 30);
    const looks = [];
    const agent = { bot: { ...fakeBot([ender]), nearestEntity: () => null, lookAt() {}, look: (...a) => looks.push(a) } };
    assert.equal(doNotLookNear(agent.bot), true);
    const mode = __modeForTest('idle_staring');
    const random = Math.random;
    Math.random = () => 0.9; // "not staring": the random-look branch
    try {
        mode.next_change = 0;
        mode.update(agent);
        assert.deepEqual(looks, [], 'no random look with an enderman 30 blocks away');
        delete agent.bot.entities[ender.id];
        mode.next_change = 0;
        mode.update(agent);
        assert.equal(looks.length, 1, 'with none near, it looks around again');
    } finally {
        Math.random = random;
    }
});

// G3 round 7 B: self_defense's equip was rejected by the server, the error ended the fight, and a
// zombie killed the bot without it hitting back.
test('G3 round 7 B and #296 review 2: an equip the server rejects does not end self-defense: the bot fights with what is in hand for the rest of the fight, with no more equip tries, and says so once', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { defendSelf } = await import('./skills.js');
    const zombie = mob('zombie', 3);
    const bot = fightBot([zombie]);
    const sword = { name: 'stone_sword', count: 1, slot: 16 };
    bot.inventory = { items: () => [sword], slots: [] };
    bot.heldItem = { name: 'wheat_seeds', count: 1, slot: 36 };
    let equips = 0;
    bot.equip = () => { equips++; return Promise.reject(new Error('Server rejected transaction for clicking on slot 16, on window with id 0.')); };
    let rounds = 0;
    const attack = bot.pvp.attack.bind(bot.pvp);
    bot.pvp.attack = (e) => { attack(e); if (++rounds === 2) delete bot.entities[zombie.id]; }; // dies in round 2
    assert.equal(await defendSelf(bot, 8, (e) => e.name === 'zombie'), true);
    assert.deepEqual(bot.pvp.attacks, ['zombie', 'zombie'], 'it fought on');
    assert.equal(equips, 1, 'no second try in this fight: each can wait about 11 s without attacking');
    assert.equal(bot.output.match(/Could not take/g)?.length, 1, bot.output);
    assert.match(bot.output, /Could not take the stone_sword in hand \(Error: Server rejected transaction for clicking on slot 16, on window with id 0\.\); fighting with wheat_seeds for the rest of this fight\./);

    // The next fight tries the weapon again.
    const next = fightBot([mob('zombie', 3)]);
    next.inventory = bot.inventory;
    let held = null;
    next.equip = (it) => { held = it; return Promise.resolve(); };
    next.pvp.attack = (e) => { delete next.entities[e.id]; };
    assert.equal(await defendSelf(next, 8, (e) => e.name === 'zombie'), true);
    assert.equal(held, sword);
    assert.match(bot.output, /Successfully defended self\./);
});

// Soak 2 (rotn-v0.1.4, 22:47): fighting a slime bare-handed took the bot from health 20 to 2 in about 4 s.
test('soak 2: a big slime is kept away from without a weapon or below health 14; a tiny one is fought; with a weapon and health it is fought', async () => {
    const { SLIME, isBigSlime, slimeSize } = await import('./threats.js');
    assert.deepEqual(SLIME, { bigSize: 2, minHealth: 14, sizeIndex: 12, minAttack: 4 });
    const slime = (id, size, name = 'slime') => ({ id, name, type: 'mob', position: new Vec3(3, 64, 0), metadata: size === null ? {} : { 12: size } });
    assert.equal(slimeSize(slime(1, 4)), 4);
    assert.equal(isBigSlime(slime(1, 4)), true);
    assert.equal(isBigSlime(slime(1, 1)), false, 'a tiny slime');
    assert.equal(isBigSlime(slime(1, null)), true, 'size unknown: taken as big');
    assert.equal(isBigSlime(slime(1, 3, 'specialmobs:lemonslime')), true, 'a modded slime');
    assert.equal(isBigSlime({ name: 'zombie', metadata: { 12: 4 } }), false);
    const sword = { name: 'iron_sword', count: 1 };
    const plan = (e, { health = 20, items = [] } = {}) => threatPlan(fakeBot([e], { health, inventory: { items: () => items, slots: [] } }));
    const bare = plan(slime(1, 4));
    assert.equal(bare.action, 'flee');
    assert.equal(bare.why, 'a big slime of size 4, and no weapon of attack 4 or more, or health under 14');
    assert.equal(bare.away, RANGES.fight.away);
    assert.equal(plan(slime(1, 4), { items: [sword], health: 10 }).action, 'flee', 'a weapon but health 10');
    assert.equal(plan(slime(1, 4), { items: [sword], health: 18 }).action, 'fight', 'a weapon and health 18: fought');
    assert.equal(plan(slime(1, 1), { items: [sword] }).action, 'fight', 'a tiny one: fought with a weapon');
    assert.equal(plan(slime(1, 1)).action, 'flee', 'soak 5: a tiny one is not fought bare-handed either');
});

test('#434 review: a crude axe or a stone sword is no real weapon for a big slime (attack 4 or more); a creeper or a crowd still decides first; magma cubes too', async () => {
    const { bestAttack, isBigSlime } = await import('./threats.js');
    const slime = (id, x = 3) => ({ id, name: 'slime', type: 'mob', position: new Vec3(x, 64, 0), metadata: { 12: 4 } });
    const plan = (es, items, health = 20) => threatPlan(fakeBot(es, { health, inventory: { items: () => items, slots: [] } }));
    for (const [item, attack] of [['pyrotech:crude_axe', 3], ['stone_sword', 3.5], ['stone_axe', 3]]) {
        assert.equal(bestAttack({ inventory: { items: () => [{ name: item }], slots: [] } }), attack, item);
        assert.equal(plan([slime(1)], [{ name: item }]).action, 'flee', `${item}: kept away from`);
    }
    assert.equal(plan([slime(1)], [{ name: 'iron_sword' }]).action, 'fight', 'an iron sword (6): fought');
    assert.equal(plan([slime(1)], [{ name: 'pyrotech:flint_axe' }]).action, 'flee', 'a weapon of unknown attack: not counted');
    // A creeper near as well: the plan is the creeper's.
    const creeper = { id: 9, name: 'creeper', type: 'mob', position: new Vec3(4, 64, 0) };
    const both = plan([slime(1), creeper], []);
    assert.equal(both.why, 'explodes');
    assert.equal(both.from, creeper);
    // Two melee mobs: outnumbered decides.
    assert.equal(plan([slime(1), { id: 8, name: 'zombie', type: 'mob', position: new Vec3(-3, 64, 0) }], []).why, 'outnumbered');
    assert.equal(isBigSlime({ name: 'magma_cube', metadata: { 12: 3 } }), true);
    assert.equal(isBigSlime({ name: 'magma_cube', metadata: { 12: 1 } }), false);
});

test('#434 nit: a ranged mob near a big slime steers the flee, and the walk keeps away from the slime too', () => {
    const slime = { id: 1, name: 'slime', type: 'mob', position: new Vec3(3, 64, 0), metadata: { 12: 4 } };
    const skeleton = { id: 2, name: 'skeleton', type: 'mob', position: new Vec3(-10, 64, 0) };
    const plan = (items) => threatPlan(fakeBot([slime, skeleton], { health: 20, inventory: { items: () => items, slots: [] } }));
    const bare = plan([]);
    assert.equal(bare.why, 'ranged');
    assert.equal(bare.from, skeleton);
    assert.equal(bare.away, RANGES['take-cover'].away);
    assert.equal(bare.isEnemy(skeleton), true);
    assert.equal(bare.isEnemy(slime), true, 'the slime is kept away from as well');
    // With a real weapon the slime is no reason to flee: the ranged mob alone.
    const armed = plan([{ name: 'iron_sword' }]);
    assert.equal(armed.why, 'ranged');
    assert.equal(armed.isEnemy(slime), false);
});

test('#448: a provoked animal reacts only to its own hit (its damage, or within its reach): a bull or a polar bear is fled, a rooster hit back; starving next to one is not', () => {
    const now = 100_000;
    const at = (name, x, extra = {}) => ({ ...mob(name, x), ...extra });
    const hit = (entities, damage) => threatPlan(fakeBot(entities, { lastDamageTime: now - 500, lastDamageTaken: damage }), { now });
    const bull = at('animania:bull_holstein', 1.5);
    const gored = hit([bull], 5);
    assert.deepEqual([gored.action, gored.why, gored.from, gored.away], ['flee', 'provoked', bull, RANGES.fight.away]);
    assert.equal(gored.isEnemy(bull), true);
    // 3.5 away (beyond its reach 2 + 1): a hit of 5 is its own; starving (1) is not.
    const far = at('animania:bull_holstein', 3.5);
    assert.equal(hit([far], 5).action, 'flee');
    assert.equal(hit([far], 1), null, 'starving or a fall next to a bull: no flee');
    assert.equal(threatPlan(fakeBot([bull]), { now }), null, 'no hit, no reaction');
    // A rooster can be fought back (fightBack true); its metadata is read, so it is not taken for a player's.
    const rooster = at('animania:rooster_leghorn', 1.2, { metadata: { 7: 6 } });
    const peck = hit([rooster], 2);
    assert.deepEqual([peck.action, peck.why, peck.from], ['fight', 'provoked', rooster]);
    // A polar bear calls the others: they are kept away from too.
    const bear = at('minecraft:polar_bear', 1.5), other = at('minecraft:polar_bear', 6);
    const mauled = hit([bear, other], 6);
    assert.equal(mauled.action, 'flee');
    assert.equal(mauled.isEnemy(other), true);
});

test('#448: two cows of one herd within reach at a hit: back off from the herd; one cow (the hunt\'s) is no reason', () => {
    const now = 100_000;
    const cow = (x, name = 'animania:cow_holstein') => mob(name, x);
    const hit = (entities) => threatPlan(fakeBot(entities, { lastDamageTime: now - 500, lastDamageTaken: 2 }), { now });
    const a = cow(1.5), b = cow(-2);
    const herd = hit([a, b]);
    assert.deepEqual([herd.action, herd.why, herd.away], ['flee', 'a herd fights back', RANGES.fight.away]);
    assert.equal(herd.isEnemy(b), true);
    assert.equal(hit([cow(1.5)]), null, 'one cow hitting back during its hunt');
    assert.equal(hit([cow(1.5), cow(-2, 'animania:cow_angus')]), null, 'two breeds do not answer each other');
    assert.equal(threatPlan(fakeBot([a, b]), { now }), null, 'no hit');
});

test('#444 review 3: avoidEnemies keeps away from all the enemies at once, near ones weighing most, not only from the nearest', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { avoidEnemies, enemiesPoint } = await import('./skills.js');
    const slime = { id: 901, name: 'slime', type: 'mob', position: new Vec3(3, 64, 0), height: 1 };
    const skeleton = { id: 902, name: 'skeleton', type: 'mob', position: new Vec3(0, 64, -10), height: 1.9 };
    const bot = fightBot([slime, skeleton]);
    const p = enemiesPoint(bot, () => true, 16);
    assert.ok(p.x > 2.5 && p.x < 3 && p.z < -0.5 && p.z > -1.5, `the point leans to the slime, a little towards the skeleton: ${p}`);
    await avoidEnemies(bot, 16, (e) => ['slime', 'skeleton'].includes(e.name), () => false);
    assert.equal(bot.pathfinder.goals.length, 1);
    const goal = bot.pathfinder.goals[0];
    assert.equal(goal.goal?.constructor?.name, 'GoalNear', 'away from one point, not following the nearest mob');
    // Away from both: a step south-west scores better than one north-west (towards the skeleton);
    // following only the slime they would score the same.
    const score = (x, z) => goal.heuristic({ x, y: 64, z });
    assert.ok(score(-4, 2) < score(-4, -2), `${score(-4, 2)} vs ${score(-4, -2)}`);
    assert.equal(enemiesPoint(fightBot([]), () => true, 16), null);
});

test('#449 review: avoidEnemies sets its goal again when the pathfinder stopped (a failed flee path), not while it moves', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { avoidEnemies } = await import('./skills.js');
    const run = async (moving) => {
        const bot = fightBot([{ id: 911, name: 'slime', type: 'mob', position: new Vec3(3, 64, 0), height: 1 }]);
        bot.pathfinder.isMoving = () => moving;
        bot.pathfinder.setGoal = function (goal) { this.goals.push(goal); }; // the enemy stays; nothing ends the walk
        setTimeout(() => { bot.interrupt_code = true; }, 1300); // about three ticks of 500 ms
        await avoidEnemies(bot, 16, (e) => e.name === 'slime', () => false);
        return bot.pathfinder.goals.length;
    };
    assert.ok(await run(false) >= 2, 'not moving: the goal is set again');
    assert.equal(await run(true), 1, 'moving: the goal stands');
});

// #453 review 1 (BLOCKER): a false fight would hit a player's wolf or llama on the live server.
test('#453 review 1: starving or falling next to a rooster or wolf is no fight; an owned wolf is fled, never fought; the herd flee ignores a fall', () => {
    const now = 100_000;
    const at = (name, x, metadata = { 7: 8 }) => ({ ...mob(name, x), metadata });
    const plan = (entities, extra) => threatPlan(fakeBot(entities, { lastDamageTime: now - 500, food: 12, ...extra }), { now });
    const rooster = at('animania:rooster_leghorn', 1.2), wolf = at('minecraft:wolf', 1.5);
    for (const animal of [rooster, wolf]) {
        assert.equal(plan([animal], { lastDamageTaken: 2 })?.action, 'fight', `${animal.name}: its own hit is fought back`);
        assert.equal(plan([animal], { lastDamageTaken: 1, food: 0 }), null, `${animal.name}: starving next to it`);
        assert.equal(plan([animal], { lastDamageTaken: 1, lastDamageCause: 'starving' }), null);
        assert.equal(plan([animal], { lastDamageTaken: 4, lastDamageCause: 'fall' }), null, `${animal.name}: a fall next to it`);
        assert.equal(plan([animal], { lastDamageTaken: 1 }), null, `${animal.name}: less than its damage`);
    }
    assert.equal(plan([at('minecraft:wolf', 3.5)], { lastDamageTaken: 2 }), null, 'beyond its reach + 1: not its hit to fight back');
    // A tamed wolf (an owner UUID in its metadata) hits: back off, never hit it.
    const owned = at('minecraft:wolf', 1.5, { 7: 8, 16: '12345678-1234-1234-1234-123456789abc' });
    const tamed = plan([owned], { lastDamageTaken: 2 });
    assert.deepEqual([tamed.action, tamed.why], ['flee', 'provoked, and it may be a player\'s']);
    assert.equal(tamed.isEnemy(owned), true);
    // Unreadable metadata counts as maybe a player's.
    assert.equal(plan([{ ...mob('minecraft:wolf', 1.5) }], { lastDamageTaken: 2 }).action, 'flee');
    // A bull next to a fall or starving: no flee either.
    assert.equal(plan([at('animania:bull_holstein', 1.5)], { lastDamageTaken: 4, lastDamageCause: 'fall' }), null);
    // The herd flee: never for a fall.
    const herd = [at('animania:cow_holstein', 1.5), at('animania:cow_holstein', -2)];
    assert.equal(plan(herd, { lastDamageTaken: 2 }).why, 'a herd fights back');
    assert.equal(plan(herd, { lastDamageTaken: 4, lastDamageCause: 'fall' }), null);
});

test('#453 review 4: avoidEnemies sets its goal again only after 2 ticks in a row not moving', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { avoidEnemies } = await import('./skills.js');
    const run = async (moving) => {
        const bot = fightBot([{ id: 921, name: 'slime', type: 'mob', position: new Vec3(3, 64, 0), height: 1 }]);
        let n = 0;
        bot.pathfinder.isMoving = () => moving(n++);
        bot.pathfinder.setGoal = function (goal) { this.goals.push(goal); };
        setTimeout(() => { bot.interrupt_code = true; }, 2300); // about five ticks
        await avoidEnemies(bot, 16, (e) => e.name === 'slime', () => false);
        return bot.pathfinder.goals.length;
    };
    assert.equal(await run((i) => i % 2 === 1), 1, 'one tick still, then moving again: the path stands');
    assert.ok(await run(() => false) >= 2, 'still for 2 ticks: set again');
});

test('#453 nit 1: an animal that did not react hides neither a second one that did nor the herd', () => {
    const now = 100_000;
    const at = (name, x) => ({ ...mob(name, x), metadata: { 7: 6 } });
    const plan = (entities, damage) => threatPlan(fakeBot(entities, { lastDamageTime: now - 500, lastDamageTaken: damage, food: 12 }), { now });
    // A peck of 1: the rooster (damage 2) did not do it; the ferret (damage 1) next to it did.
    const rooster = at('animania:rooster_leghorn', 1.2), ferret = at('animania:ferret_grey', 2.5);
    const peck = plan([rooster, ferret], 1);
    assert.deepEqual([peck?.action, peck?.from], ['fight', ferret]);
    // A rooster that did not react, and a Holstein herd in reach: the herd is fled.
    const herd = plan([rooster, at('animania:cow_holstein', 1.5), at('animania:cow_holstein', -2)], 1);
    assert.equal(herd?.why, 'a herd fights back');
});

// Soak 5 (rotn-v0.1.11): from its pocket shelter the bot swung six times at an Ice and Fire troll
// (avoid: 18 attack, 200 health), took one hit of 18 and died (00:46). The lead's rule: only a melee
// mob is hit from a shelter; the others are still seen (shelterEnemy) but never hit.
test('soak 5: shelterTarget is a melee mob only (never a troll, a creeper, a skeleton, an enderman or an animal); shelterEnemy still sees them', () => {
    const is = (name) => shelterTarget(mob(name, 1));
    assert.equal(is('zombie'), true);
    assert.equal(is('zombie_players:zombie_player'), true, 'the player zombie is a melee mob');
    for (const name of ['iceandfire:if_troll', 'iceandfire:firedragon', 'creeper', 'skeleton', 'enderman', 'cow', 'iceandfire:if_cockatrice'])
        assert.equal(is(name), false, name);
    assert.equal(shelterTarget({ name: 'JQDAW', type: 'player', position: new Vec3(1, 64, 0) }), false, 'never a player');
    for (const name of ['iceandfire:if_troll', 'creeper', 'skeleton']) assert.equal(shelterEnemy(mob(name, 1)), true, `${name}: still a threat near the shelter`);
});

// Soak 5 (rotn-v0.1.11), the lead's rule after deaths 2 and 3: at health 1.5 the bot fought a zombie
// in the open and died within a second; respawned with no weapon, it fought one by hand for 15 s and
// died. In the open a melee mob is fled from with no weapon or at a health one hit of it may take:
// PR 5, that mob's maxDamage (rotn-data mob-melee.json, with Rough Mobs' worst weapon: ZOMBIE_HIT),
// UNKNOWN_MELEE (18) with no entry. Fix G used 8 for every mob.
test('PR 5: in the open a melee mob is fled from with no weapon or at a health its maxDamage may take; armed above it it is fought', () => {
    const sword = { name: 'iron_sword', count: 1 };
    const zombie = mob('zombie', 3);
    const plan = ({ items = [sword], health = 20, of = zombie } = {}) => threatPlan(fakeBot([of], { health, inventory: { items: () => items, slots: [] } }));
    const bare = plan({ items: [] });
    assert.deepEqual([bare.action, bare.why, bare.from, bare.away, bare.isEnemy(zombie)], ['flee', 'melee, and no weapon', zombie, RANGES.fight.away, true]);
    assert.ok(ZOMBIE_HIT > 3 && ZOMBIE_HIT < 18, `a zombie's maxDamage from rotn-data: ${ZOMBIE_HIT}`);
    const low = plan({ health: UNDER });
    assert.deepEqual([low.action, low.why], ['flee', `melee, and health ${UNDER}, a zombie hits up to ${ZOMBIE_HIT}`], 'the lead accepted it: armed just below it, a zombie is fled from');
    assert.equal(plan({ health: ZOMBIE_HIT }).action, 'flee', 'equal: one hit may kill');
    assert.equal(plan({ health: 1.5 }).why, `melee, and health 1.5, a zombie hits up to ${ZOMBIE_HIT}`, 'death 2');
    assert.equal(plan({ health: OVER }).action, 'fight');
    // A spider hits for 2: fought down to health 2.1.
    const spider = mob('spider', 3);
    assert.equal(maxHitOf(spider), 2);
    assert.equal(plan({ of: spider, health: 3 }).action, 'fight');
    assert.deepEqual([plan({ of: spider, health: 2 }).action, plan({ of: spider, health: 2 }).why], ['flee', 'melee, and health 2, a spider hits up to 2']);
    // No melee entry (twilightforest:kobold, a hostile mob that is fought by default; an unknown
    // hostile mob): UNKNOWN_MELEE, never zero. The example must stay without a melee entry in
    // rotn-data (rats:illager_piper got one in #511).
    for (const name of ['twilightforest:kobold', 'somemod:unknown_beast']) {
        const m = mob(name, 3);
        assert.equal(maxHitOf(m), 18, name);
        assert.equal(plan({ of: m, health: 18 }).action, 'flee', `${name} at 18`);
        assert.equal(plan({ of: m, health: 18.5 }).action, 'fight', `${name} at 18.5`);
    }
    assert.equal(maxHitOf(mob('ancientbeasts:sandy', 3)), 18, 'an avoid mob with no melee entry');
    assert.equal(maxHitOf(null), 18, 'no mob: unknown');
    assert.equal(plan({ items: [{ name: 'pyrotech:crude_axe', count: 1 }] }).action, 'fight', 'a crude axe is a weapon');
    assert.equal(plan({ items: [{ name: 'stone_pickaxe', count: 1 }] }).action, 'flee', 'a pickaxe is not');
    assert.equal(fightRefusal({ health: 20, inventory: { items: () => [sword], slots: [] } }), null, 'above UNKNOWN_MELEE');
    assert.equal(fightRefusal({ health: 20, inventory: { items: () => [sword], slots: [] } }, zombie), null);
    assert.equal(fightRefusal({ health: 18, inventory: { items: () => [sword], slots: [] } }), 'health 18, an unknown mob hits up to 18', 'no mob named: UNKNOWN_MELEE');
    assert.equal(fightRefusal({ health: undefined, inventory: { items: () => [sword], slots: [] } }, zombie), null, 'health unknown: no refusal for it');
    // A provoked animal that fights back (a rooster's own hit) is not fought bare-handed either.
    const now = 100_000;
    const rooster = { ...mob('animania:rooster_leghorn', 1.2), metadata: { 7: 8 } };
    const peck = (items, health = 20) => threatPlan(fakeBot([rooster], { health, lastDamageTime: now - 500, lastDamageTaken: 2, food: 12, inventory: { items: () => items, slots: [] } }), { now });
    assert.equal(peck([sword]).action, 'fight');
    // #507 review 2: no melee entry, but its provoked damage (2): not the unknown 18.
    assert.deepEqual([maxHitOf(rooster), maxHitOf(mob('wolf', 2)), maxHitOf(mob('llama', 2))], [2, 2, 1]);
    assert.equal(peck([sword], 15).action, 'fight', 'a rooster at health 15: fought back');
    assert.equal(peck([sword], 2).action, 'flee', 'at 2: one peck may take it');
    assert.deepEqual([peck([]).action, peck([]).why], ['flee', 'provoked, and no weapon']);
});

test('soak 5: modes: unarmed, a lone zombie makes cowardice back off, not self_defense fight', async (t) => {
    t.mock.method(console, 'log', () => {});
    const a = modeAgent([mob('zombie', 4)]);
    a.bot.inventory = { items: () => [], slots: [] };
    await tick(a);
    assert.deepEqual(a.ran, ['mode:cowardice']);
    assert.match(a.bot.modes.behavior_log, /Backing off: zombie \(melee, and no weapon\)!/);
    const low = modeAgent([mob('zombie', 4)]);
    low.bot.health = UNDER;
    await tick(low);
    assert.deepEqual(low.ran, ['mode:cowardice'], `armed at health ${UNDER}: back off (a zombie hits up to ${ZOMBIE_HIT})`);
});

test('soak 5 / PR 5: a fight that drops just below what a zombie may hit for (ZOMBIE_HIT) ends, and the bot backs off from the same zombie', async (t) => {
    t.mock.method(console, 'log', () => {});
    const zombie = mob('zombie', 3);
    const bot = fightBot([zombie]);
    bot.health = 20;
    const attack = bot.pvp.attack.bind(bot.pvp);
    bot.pvp.attack = (e) => { attack(e); bot.health = UNDER; }; // one exchange of hits
    const agent = { bot, shut_up: true, openChat() {}, actions: { currentActionLabel: '', resume_func: null,
        runAction: async (label, fn) => { await fn(); return { message: 'ok', interrupted: false }; } } };
    await __modeForTest('self_defense').update(agent);
    await untilIdle('self_defense');
    assert.deepEqual(bot.pvp.attacks, ['zombie'], 'one round, then it stopped');
    assert.ok(bot.modes.behavior_log.includes(`Fighting zombie!\nBacking off: zombie (melee, and health ${UNDER}, a zombie hits up to ${ZOMBIE_HIT})!`), bot.modes.behavior_log);
    assert.equal(bot.pathfinder.goals.length, 1, 'it moved away');
});

// #497 review 3 (the lead's decision): in the open, cornered means the flee is blocked (the pathfinder
// has not moved for AVOID.blockedTicks ticks in a row), not "within 3 blocks". A bot getting away
// never swings, however close the mob; a blocked one hits a fight mob, never a troll or a creeper.
test('#497 review 3: avoidEnemies hits a close fight mob only when the flee is blocked; never one canHit refuses', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { avoidEnemies, AVOID } = await import('./skills.js');
    assert.deepEqual(AVOID, { blockedTicks: 2 });
    const run = async (name, moving, canHit = (e) => shelterTarget(e)) => {
        const e = { id: 931, name, type: 'mob', position: new Vec3(2, 64, 0), height: 1.8 };
        const bot = fightBot([e]);
        bot.inventory = { items: () => [], slots: [] }; // unarmed
        bot.lookAt = () => Promise.resolve();
        const hits = [];
        bot.attack = (x) => { hits.push(x.name); return Promise.resolve(); };
        bot.pathfinder.isMoving = () => moving;
        bot.pathfinder.setGoal = function (goal) { this.goals.push(goal); }; // the mob stays 2 blocks away
        setTimeout(() => { bot.interrupt_code = true; }, 2300); // about five ticks of 500 ms
        await avoidEnemies(bot, 16, (x) => x.id === e.id, canHit);
        return hits;
    };
    assert.deepEqual(await run('zombie', true), [], 'getting away: no swing, however close');
    const blocked = await run('zombie', false);
    assert.ok(blocked.length >= 1 && blocked.every(n => n === 'zombie'), `blocked: it hits back (${blocked})`);
    assert.deepEqual(await run('iceandfire:if_troll', false), [], 'blocked by a troll: never a swing');
    assert.deepEqual(await run('creeper', false), [], 'nor at a creeper');
});

// #497 review 2: the morning leave (NIGHT_OPS.awayFromMobs) keeps away from every threat, and when
// blocked it may hit a melee mob only (threats.shelterTarget), never a troll or a creeper.
test('#497 review 2: the morning leave never swings at a troll or a creeper, even blocked; a blocked zombie is hit', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { NIGHT_OPS } = await import('../night_routine.js');
    const run = async (name) => {
        const e = { id: 941, name, type: 'mob', position: new Vec3(2, 64, 0), height: 1.8 };
        const bot = fightBot([e]);
        bot.lookAt = () => Promise.resolve();
        const hits = [];
        bot.attack = (x) => { hits.push(x.name); return Promise.resolve(); };
        bot.pathfinder.isMoving = () => false; // blocked
        bot.pathfinder.setGoal = function (goal) { this.goals.push(goal); };
        setTimeout(() => { bot.interrupt_code = true; }, 2300);
        await NIGHT_OPS.awayFromMobs(bot);
        return { hits, goals: bot.pathfinder.goals.length };
    };
    for (const name of ['iceandfire:if_troll', 'creeper']) {
        const r = await run(name);
        assert.deepEqual(r.hits, [], `${name}: no swing`);
        assert.ok(r.goals >= 1, `${name}: it still tries to get away`);
    }
    assert.ok((await run('zombie')).hits.length >= 1, 'a blocked zombie is hit');
});

// #497 review 5 / PR 5: one low-health rule for the open fight and the shelter: the mob's maxDamage.
test('PR 5: BACK_AWAY has no fixed lowHealth any more (threats.maxHitOf per mob)', async () => {
    const { BACK_AWAY } = await import('./shelter.js');
    assert.equal(BACK_AWAY.lowHealth, undefined);
});

// Soak 6 (18:39-18:51): self_defense fought a betteranimalsplus:eel_freshwater in the water 26 times;
// each fight ran about 30 s until the unstuck reflex ended it, and the next began. The eel never hurt
// the bot. A melee mob under water is not fought (nor counted as a second one); a mob whose fights
// end interrupted three times in a row is given up on for 5 min.
test('soak 6 (a): a melee mob under water is neither fought nor counted; at the surface it is', async () => {
    const { submerged } = await import('./threats.js');
    const eel = (id, x, y) => ({ id, name: 'betteranimalsplus:eel_freshwater', type: 'mob', position: new Vec3(x, y, 0.5), height: 0.5 });
    assert.equal(threatFor(eel(1, 2, 62)).reaction, 'fight', 'rotn-data: a default fight mob (asked: ignore?)');
    // Water from y 60 to 62 at x 1-5; air above.
    const water = (p) => ({ name: p.x >= 1 && p.x <= 5 && p.y >= 60 && p.y <= 62 ? 'water' : p.y < 64 ? 'dirt' : 'air' });
    const bot = (...es) => fakeBot(es, { blockAt: (p) => water(p.floored()) });
    const deep = eel(2, 3.5, 61.2);
    assert.equal(submerged(bot(deep), deep), true);
    assert.equal(threatPlan(bot(deep)), null, 'under water: no fight');
    assert.equal(threatPlan(bot(deep, eel(3, 4.5, 60.5))), null, 'two under water: not outnumbered either');
    const top = eel(4, 3.5, 62.6); // its top (63.1) out of the water
    assert.equal(submerged(bot(top), top), false);
    assert.equal(threatPlan(bot(top)).action, 'fight');
    assert.equal(submerged(fakeBot([deep]), deep), false, 'no world to read: as before');
    // #508 review 2: a small mob in a 1-deep puddle (water in its feet block only) is in reach.
    const puddle = (p) => ({ name: p.y === 63 && p.x >= 1 && p.x <= 5 ? 'water' : p.y < 63 ? 'dirt' : 'air' });
    for (const [name, h] of [['spider', 0.9], ['cave_spider', 0.5], ['silverfish', 0.3], ['zombie', 0.98], ['slime', 0.51]]) {
        const m = { id: 70, name, type: 'mob', position: new Vec3(3.5, 63, 0.5), height: h };
        assert.equal(submerged(fakeBot([m], { blockAt: (p) => puddle(p.floored()) }), m), false, `${name} in a puddle`);
    }
    // #508 review 1: one that is hurting the bot is fought as before, under water or not.
    const now = 2_000_000;
    const biting = eel(5, 1.5, 61.2); // 1 block away
    const hurt = fakeBot([biting], { blockAt: (p) => water(p.floored()), lastDamageTime: now - 500, lastDamageTaken: 2 });
    assert.equal(threatPlan(hurt, { now }).action, 'fight', 'a submerged eel that just bit: fight');
    const fell = fakeBot([biting], { blockAt: (p) => water(p.floored()), lastDamageTime: now - 500, lastDamageTaken: 2, lastDamageCause: 'fall' });
    assert.equal(threatPlan(fell, { now }), null, 'a fall is not its hit');
});

test('soak 6 (a): three fights in a row on one mob that end interrupted give it up for 5 min; any other end starts the count again', async () => {
    const { noteFightEnd, FIGHT_GIVE_UP, UNREACHABLE, isUnreachable } = await import('./threats.js');
    const { ATTACK_PROGRESS, markUnreachable } = await import('./skills.js');
    assert.deepEqual([FIGHT_GIVE_UP.maxInterrupted, UNREACHABLE.skipMs, ATTACK_PROGRESS.skipMs], [3, 300_000, 300_000]);
    assert.equal(typeof markUnreachable, 'function', 'still exported from skills.js');
    const zombie = mob('zombie', 3);
    const bot = fakeBot([zombie]);
    const now = 1_000_000;
    assert.equal(noteFightEnd(bot, zombie, 'interrupted', now), null);
    assert.equal(noteFightEnd(bot, zombie, 'gone', now), null, 'reset');
    assert.equal(noteFightEnd(bot, zombie, 'interrupted', now), null);
    assert.equal(noteFightEnd(bot, zombie, 'interrupted', now), null);
    assert.equal(threatPlan(bot, { now }).action, 'fight');
    assert.equal(noteFightEnd(bot, zombie, 'interrupted', now), 3);
    assert.equal(isUnreachable(bot, zombie, now), true);
    assert.equal(threatPlan(bot, { now }), null, 'given up: no fight');
    assert.equal(threatPlan(bot, { now: now + UNREACHABLE.skipMs }).action, 'fight', '5 min later: fought again');
    // #508 review 1: given up, but hitting the bot now: fought, and its mark is cleared.
    markUnreachable(bot, zombie, now);
    Object.assign(bot, { lastDamageTime: now - 1000, lastDamageTaken: 3 });
    assert.equal(threatPlan(bot, { now }).action, 'fight', 'it hurts the bot: fight');
    assert.equal(isUnreachable(bot, zombie, now), false, 'the hit cleared its mark');
    // #508 review 7: a mob no longer loaded leaves the count.
    const gone = mob('zombie', 5);
    noteFightEnd(bot, gone, 'interrupted', now);
    assert.equal(bot.rotnFightStops.has(gone.id), true);
    noteFightEnd(bot, zombie, 'interrupted', now);
    assert.deepEqual([...bot.rotnFightStops.keys()], [zombie.id], 'the unloaded one is pruned');
});

test('#508 review 5: defendSelf fights the zombie, not a given-up eel nearer to it', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { defendSelf, markUnreachable } = await import('./skills.js');
    const eel = { id: 80, name: 'betteranimalsplus:eel_freshwater', type: 'mob', position: new Vec3(1.5, 64, 0), height: 0.5 };
    const zombie = mob('zombie', 3);
    const bot = fightBot([eel, zombie]);
    markUnreachable(bot, eel);
    bot.pvp.attack = (e) => { bot.pvp.attacks.push(e.name); bot.interrupt_code = true; };
    await defendSelf(bot, 8, (e) => threatFor(e)?.reaction === 'fight');
    assert.deepEqual(bot.pvp.attacks, ['zombie']);
});

test('soak 6 (a): defendSelf counts its interrupted ends: the third gives the mob up, with a line', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const { defendSelf } = await import('./skills.js');
    const zombie = mob('zombie', 3);
    const bot = fightBot([zombie]);
    bot.pvp.attack = (e) => { bot.pvp.attacks.push(e.name); bot.interrupt_code = true; }; // unstuck takes over
    for (let i = 0; i < 3; i++) { bot.interrupt_code = false; await defendSelf(bot, 8, (e) => e.name === 'zombie'); }
    assert.deepEqual(bot.pvp.attacks, ['zombie', 'zombie', 'zombie']);
    assert.ok(logs.includes('[survival] giving up on zombie: 3 fights in a row on it were interrupted; leaving it alone for 5 min'), logs.join('\n'));
    assert.equal(threatPlan(bot), null);
});

test('soak 6 (a): self_defense starts no fight with an eel under water', async (t) => {
    t.mock.method(console, 'log', () => {});
    const a = modeAgent([{ id: 50, name: 'betteranimalsplus:eel_freshwater', type: 'mob', position: new Vec3(3.5, 61.2, 0.5), height: 0.5 }]);
    a.bot.blockAt = (p) => ({ name: p.floored().y <= 62 && p.floored().y >= 60 && p.x >= 1 ? 'water' : 'air' });
    await tick(a);
    assert.deepEqual(a.ran, []);
});

// ---- Soak 7 (rotn-v0.1.13, death 1, 23:24:19-33) ----
// Armed at health 20, the morning rule opened the wall toward a zombie; it walked into the bot's
// cell, the shelter fight was capped ("4 hits did not hurt the zombie") while it hit the bot, the
// bot ate okra while being hit, then "left by the side away" from a zombie in its own cell and died.

test('soak 7: meleeReach is rotn-data\'s reach, else the vanilla rule from the width (a zombie 1.43); inMeleeReach with REACH_SLACK', () => {
    const zombie = mob('zombie', 0.8);
    assert.ok(Math.abs(meleeReach(zombie) - Math.sqrt(1.2 ** 2 + 0.6)) < 1e-9, 'no reach in rotn-data: the vanilla rule');
    assert.equal(meleeReach(mob('spider', 1)), 2.14);
    assert.equal(meleeReach(mob('iceandfire:if_troll', 1)), 2);
    assert.equal(inMeleeReach(fakeBot([zombie]), zombie), true, '0.8 m: soak 7');
    const wall = mob('zombie', 1.8);
    assert.equal(inMeleeReach(fakeBot([wall]), wall), false, 'against the far side of a 1-block wall, the bot in the middle of its cell (0.3 + 1 + 0.5)');
});

test('soak 7 (B): hurtingInReach: a hit within 3 s that the world did not do, with the mob in its reach', () => {
    const now = 100_000;
    const zombie = mob('zombie', 0.8);
    const hit = (extra) => fakeBot([zombie], { lastDamageTime: now - 1000, lastDamageTaken: 3, food: 13, ...extra });
    assert.equal(hurtingInReach(hit(), zombie, now), true);
    assert.equal(hurtingInReach(hit({ lastDamageTime: now - 4000 }), zombie, now), false, '4 s ago');
    assert.equal(hurtingInReach(hit({ lastDamageCause: 'fall' }), zombie, now), false, 'a fall');
    const far = mob('zombie', 2.5);
    assert.equal(hurtingInReach(fakeBot([far], { lastDamageTime: now - 1000, lastDamageTaken: 3, food: 13 }), far, now), false, 'out of its reach');
});

test('soak 7 (B): weaponCooldownMs: the vanilla attack speeds (an axe 1.25 s, a sword 0.625 s), at least Better Combat\'s 8 ticks', () => {
    assert.equal(weaponCooldownMs({ name: 'stone_axe' }), 1250);
    assert.equal(weaponCooldownMs({ name: 'pyrotech:crude_axe' }), 1250);
    assert.equal(weaponCooldownMs({ name: 'stone_pickaxe' }), WEAPON_COOLDOWN_MS.pickaxe, 'a pickaxe is no axe');
    assert.equal(weaponCooldownMs({ name: 'stone_sword' }), 625);
    assert.equal(weaponCooldownMs({ name: 'stone_shovel' }), 1000);
    assert.equal(weaponCooldownMs(null), 400, 'the hand');
});

test('soak 7 (A): fightOdds: unknown numbers are no fight; with numbers, the fight must end above what the mob may hit for', () => {
    const zombie = mob('zombie', 1);
    const armed = fakeBot([zombie], { inventory: { items: () => [{ name: 'pyrotech:crude_axe', count: 1 }, { name: 'stone_axe', count: 1 }], slots: [] } });
    const n = fightNumbers(armed, zombie);
    assert.deepEqual(n, { health: 20, mobHealth: null, mobHit: 3, mobIntervalMs: null, hitDamage: null, cooldownMs: 1250 }, 'rotn-data: no mob health, no zombie interval, no weapon damage yet');
    assert.equal(fightNumbers(armed, { ...zombie, heldItem: { name: 'stone_axe' } }).mobHit, ZOMBIE_HIT, 'holding a weapon: its maxDamage');
    assert.equal(fightNumbers(armed, mob('iceandfire:if_troll', 1)).mobIntervalMs, 1000);
    assert.deepEqual(fightOdds(n, maxHitOf(zombie)), { winnable: false, why: 'the fight cannot be judged yet (unknown: its health, its attack interval, our weapon damage)' });
    // Soak 7's zombie as estimated: 30 health (Rough Mobs x1.5), 7 a hit at best with a stone axe, 3 a second from it.
    const soak7 = { health: 20, mobHealth: 30, mobHit: 3, mobIntervalMs: 1000, hitDamage: 7, cooldownMs: 1250 };
    assert.deepEqual(fightOdds(soak7, 12.5), { winnable: false, why: '5 hits in about 5 s, taking about 18: health 2 left, not above the 12.5 it may hit for' });
    assert.deepEqual(fightOdds({ ...soak7, mobHealth: 14 }, 12.5), { winnable: true, why: '2 hits in about 1.3 s, taking about 6: health 14 left' });
});

test('soak 7 (D): shelterEatBlock: a hostile mob within EAT_SAFE.distance, or a hurt within EAT_SAFE.hurtMs that the world did not do', () => {
    const now = 100_000;
    const near = mob('zombie', 0.8);
    assert.equal(shelterEatBlock(fakeBot([near]), { now }), 'zombie 0.8 blocks away');
    const far = mob('zombie', 6);
    assert.equal(shelterEatBlock(fakeBot([far]), { now }), null);
    assert.equal(shelterEatBlock(fakeBot([far], { lastDamageTime: now - 5000, lastDamageTaken: 3, food: 13 }), { now }), 'hurt 5 s ago');
    assert.equal(shelterEatBlock(fakeBot([far], { lastDamageTime: now - EAT_SAFE.hurtMs - 1, food: 13 }), { now }), null);
    assert.equal(shelterEatBlock(fakeBot([far], { lastDamageTime: now - 5000, lastDamageTaken: 1, food: 0 }), { now }), null, 'starving');
    assert.equal(shelterEatBlock(fakeBot([far], { lastDamageTime: now - 5000, lastDamageTaken: 3, food: 13 }), { now, withHurt: false }), null);
    assert.equal(shelterEatBlock(fakeBot([mob('cow', 1)]), { now }), null, 'not a hostile mob');
});
