// G4 #5: the hunting reflex acts only when food is due (the food reserve's rule), in full daylight,
// with no threat near, when idle; never on an animal that may belong to a player. !attack refuses
// such an animal and takes a wild one of the same kind instead. Fake bots; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { setImmediate } from 'node:timers';
import { __setRegistryForTest } from '../utils/mcdata.js';
import './agent.js'; // the real import order (commands/index.js first)
import { __modeForTest, __resetThreatLease } from './modes.js';
import { executeCommand } from './commands/index.js';
import { NIGHT_START, NightClock } from './library/night.js';
import { HUNT } from './library/hunting.js';
import { ATTACK_PROGRESS, isUnreachable, markUnreachable, KILL_DROPS, pickupKillDrops, killDropsText } from './library/skills.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const flush = () => new Promise(r => setImmediate(r));
const cow = (id, x, extra = {}) => ({ id, name: 'animania:cow_holstein', type: 'mob', position: new Vec3(x + 0.5, 64, 0.5), height: 1.4, ...extra, metadata: { 7: 10, ...(extra.metadata ?? {}) } });

// Soak 5 (#500 follow-up 1 and 2): no hunt with no weapon; these bots hold a sword unless a case says unarmed.
const SWORD = { name: 'iron_sword', count: 1, metadata: 0, type: reg.itemsByName.iron_sword.id };
function huntAgent({ food = 12, items = [], timeOfDay = 1000, animals = [], idle = true, blocks = {}, armed = true } = {}) {
    if (armed && !items.includes(SWORD)) items.push(SWORD); // the caller's own list (some tests add to it)
    __resetThreatLease();
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0.5, 64, 0.5), height: 1.8 };
    const runs = [];
    const bot = {
        username: 'FRCFLD', entity: self, entities: Object.fromEntries([[0, self], ...animals.map(a => [a.id, a])]),
        registry: reg, version: '1.12.2', food, health: 20, isAlive: true, time: { timeOfDay },
        inventory: { items: () => items, slots: [] }, heldItem: null, output: '',
        blockAt: (p) => (blocks[`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`] ? { name: blocks[`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`], position: p } : null),
        findBlocks: ({ point, maxDistance, matching }) => Object.entries(blocks).map(([k, name]) => ({ name, position: new Vec3(...k.split(',').map(Number)) }))
            .filter(b => b.position.distanceTo(point ?? self.position) <= maxDistance && matching(b)).map(b => b.position),
        pathfinder: { goal: null, getPathFromTo: function* () { yield { result: { status: 'success', path: [] } }; } },
        modes: { behavior_log: '', pause() {}, unpause() {} },
        nearestEntity: (match) => Object.values(bot.entities).filter(e => e !== self && match(e))[0] ?? null,
        clearControlStates() {}, setControlState() {},
    };
    const agent = {
        bot, shut_up: true, openChat() {}, isIdle: () => idle, runs,
        agenda: { finished: false },
        actions: { currentActionLabel: '', resume_func: null, runAction(label) { runs.push(label); return Promise.resolve({ message: '', interrupted: false }); } },
    };
    return agent;
}
const hunt = async (agent) => { const m = __modeForTest('hunting'); m.active = false; m.skipped_said = ''; m.forage_none_at = -Infinity; await m.update(agent); await flush(); m.active = false; return agent.runs; };
/** Wild food blocks ({ "x,y,z": [name, meta] }) in the agent's world, findBlocks as mineflayer's. */
function withCrops(agent, crops) {
    const self = agent.bot.entity;
    const at = (k) => { const [name, metadata] = crops[k]; return { name, metadata, position: new Vec3(...k.split(',').map(Number)) }; };
    agent.bot.blockAt = (p) => { const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`; return crops[k] ? at(k) : { name: 'air', metadata: 0, position: p }; };
    agent.bot.findBlocks = ({ point, maxDistance, matching }) => Object.keys(crops).map(at)
        .filter(b => b.position.distanceTo(point ?? self.position) <= maxDistance && matching(b)).map(b => b.position);
    return agent;
}

test('G4 #5: the hunting reflex hunts a wild animal when food is due, by day, with no threat near, when idle', async (t) => {
    t.mock.method(console, 'log', () => {});
    assert.deepEqual(await hunt(huntAgent({ animals: [cow(1, 6)] })), ['mode:hunting'], 'food 12, nothing held, a wild cow');
});

test('G4 #5 forage: ripe wild food comes before a hunt; a bare bush, an unripe herb or a player\'s garden does not', async (t) => {
    t.mock.method(console, 'log', () => {});
    // A ripe wildberry bush in reach and a wild cow: the reflex's action picks the berries (a
    // right-click), and starts no hunt.
    const items = [];
    const crops = { '2,64,0': ['rustic:wildberry_bush', 1] };
    const ripe = withCrops(huntAgent({ animals: [cow(1, 3)], items }), crops);
    const attacked = [];
    ripe.bot.pvp = { attack: (e) => attacked.push(e), stop() {} };
    ripe.bot.activateBlock = () => { crops['2,64,0'] = ['rustic:wildberry_bush', 0]; items.push({ name: 'rustic:wildberries', metadata: 0, count: 1 }); return Promise.resolve(); };
    ripe.actions.runAction = async (label, fn) => { ripe.runs.push(label); await fn(); return { message: '', interrupted: false }; };
    assert.deepEqual(await hunt(ripe), ['mode:hunting']);
    assert.match(ripe.bot.output, /Foraged 1 block: got 1 rustic:wildberries/);
    assert.deepEqual(attacked, [], 'no hunt');
    assert.deepEqual(crops['2,64,0'], ['rustic:wildberry_bush', 0], 'the bush stays');
    const bare = withCrops(huntAgent({ animals: [] }), { '6,64,0': ['rustic:wildberry_bush', 0], '7,64,0': ['rustic:ginseng', 2], '8,64,0': ['biomesoplenty:plant_0', 5] });
    assert.deepEqual(await hunt(bare), [], 'nothing ripe, no animal: nothing');
    const yard = withCrops(huntAgent({ animals: [] }), { '6,64,0': ['harvestcraft:aridgarden', 0], '9,64,0': ['oak_fence', 0] });
    assert.deepEqual(await hunt(yard), [], 'a garden by a fence may be a player\'s');
    assert.deepEqual(await hunt(withCrops(huntAgent({ food: 18, animals: [] }), { '6,64,0': ['rustic:wildberry_bush', 1] })), [], 'food not due: no foraging either');
});

test('#427 review: a forage run that got nothing (bushes out of reach) does not hold food up: the next tick hunts', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    // Eight ripe bushes no walk reaches (a run tries at most FORAGE_RUN.max = 6) and a wild cow.
    const crops = Object.fromEntries([6, 7, 8, 9, 10, 11, 12, 13].map(x => [`${x},64,8`, ['rustic:wildberry_bush', 1]]));
    const agent = withCrops(huntAgent({ animals: [cow(1, 3)] }), crops);
    const bot = agent.bot;
    Object.assign(bot.pathfinder, { setMovements() {}, stop() {}, setGoal() {}, isMoving: () => false,
        getPathTo: () => ({ status: 'noPath', path: [] }), goto: () => Promise.reject(new Error('No path to the goal!')) });
    const attacked = [];
    bot.pvp = { attack: (e) => { attacked.push(e.name); delete bot.entities[e.id]; }, stop() {} };
    bot.activateBlock = () => Promise.reject(new Error('never reached'));
    agent.actions.runAction = async (label, fn) => { agent.runs.push(label); await fn(); return { message: '', interrupted: false }; };
    const m = __modeForTest('hunting');
    m.active = false; m.skipped_said = ''; m.forage_none_at = -Infinity;
    await m.update(agent); await flush();
    assert.match(bot.output, /Foraged 0 blocks, got nothing/);
    assert.deepEqual(attacked, [], 'the first tick foraged');
    // Two bushes were never tried; still, the next tick hunts.
    m.active = false;
    await m.update(agent); await flush();
    assert.deepEqual(attacked, ['animania:cow_holstein'], 'the next tick hunts');
});

test('soak 2: a hunt that got stuck (the sow uphill) is not started again on the same animal; another one is hunted', async (t) => {
    t.mock.method(console, 'log', () => {});
    const saved = { ...HUNT };
    Object.assign(HUNT, { checkMs: 10, stuckMs: 60 });
    t.after(() => Object.assign(HUNT, saved));
    // Two breeds: two cows of one breed are a herd (#448), which is not hunted.
    const agent = huntAgent({ animals: [cow(1, 3), cow(2, 9, { name: 'animania:cow_angus' })] });
    const attacked = [];
    agent.bot.pvp = { attack: (e) => attacked.push(e.id), stop() {} };
    agent.actions.runAction = async (label, fn) => { agent.runs.push(label); await fn(); return { message: '', interrupted: false }; };
    await hunt(agent);
    await new Promise(r => setTimeout(r, 250)); // the hunt runs to its stuck end
    assert.deepEqual(attacked, [1], 'the nearest cow: stuck');
    assert.ok(agent.bot.rotnHuntSkip?.get(1) > Date.now(), 'left alone a while');
    await hunt(agent);
    await new Promise(r => setTimeout(r, 250));
    assert.deepEqual(attacked, [1, 2], 'the next tick hunts the other one, not the same');
});

test('#431 review 7: a hunt stopped by the unstuck reflex leaves the animal alone a while; one stopped by a fight does not', async (t) => {
    t.mock.method(console, 'log', () => {});
    const saved = { ...HUNT };
    Object.assign(HUNT, { checkMs: 10, stuckMs: 60_000 });
    t.after(() => Object.assign(HUNT, saved));
    const run = async (by) => {
        const agent = huntAgent({ animals: [cow(1, 3)] });
        agent.bot.pvp = { attack: () => {
            setTimeout(() => { agent.rotnLastInterrupt = { by, of: 'mode:hunting', at: Date.now() }; agent.bot.interrupt_code = true; }, 30);
        }, stop() {} };
        agent.actions.runAction = async (label, fn) => { agent.runs.push(label); await fn(); return { message: '', interrupted: true }; };
        await hunt(agent);
        await new Promise(r => setTimeout(r, 150));
        return agent.bot.rotnHuntSkip?.get(1) > Date.now();
    };
    assert.equal(await run('unstuck'), true, 'stopped by unstuck: skipped');
    assert.equal(await run('self_defense'), false, 'stopped by a fight: hunted again later');
});

test('#431 review 7 (owed): an older hunt\'s unstuck stop is not held against this hunt', async (t) => {
    t.mock.method(console, 'log', () => {});
    const saved = { ...HUNT };
    Object.assign(HUNT, { checkMs: 10, stuckMs: 60_000 });
    t.after(() => Object.assign(HUNT, saved));
    const agent = huntAgent({ animals: [cow(1, 3)] });
    agent.rotnLastInterrupt = { by: 'unstuck', of: 'mode:hunting', at: 1 };
    agent.bot.pvp = { attack: () => { setTimeout(() => { agent.bot.interrupt_code = true; }, 30); }, stop() {} };
    agent.actions.runAction = async (label, fn) => { agent.runs.push(label); await fn(); return { message: '', interrupted: true }; };
    await hunt(agent);
    await new Promise(r => setTimeout(r, 150));
    assert.equal(agent.bot.rotnHuntSkip?.get(1), undefined, 'not skipped: this hunt was not stopped by unstuck');
});

// #448 (soak 2's 22:48 "gored to death"): an Animania bull charges whoever hurts it or its herd,
// and Animania cows call every cow of their breed within 16 when one is hurt.
test('#448: no hunt near a bull or of a cow in a herd that calls for help; a lone cow is hunted; !attack says why', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { retaliationRisk, nearbyHuntable } = await import('./library/hunting.js');
    const bull = (id, x) => ({ id, name: 'animania:bull_holstein', type: 'mob', position: new Vec3(x + 0.5, 64, 0.5), height: 1.6, metadata: { 7: 10 } });
    const angus = (id, x) => cow(id, x, { name: 'animania:cow_angus' });
    // A bull 10 blocks off: nothing is hunted, and the reason names it.
    const withBull = huntAgent({ animals: [cow(1, 4), bull(2, 14)] });
    assert.deepEqual(await hunt(withBull), [], 'no hunt near a bull');
    assert.match(retaliationRisk(withBull.bot, withBull.bot.entities[1]), /^a animania:bull_holstein within 16 blocks/);
    assert.deepEqual(nearbyHuntable(withBull.bot), []);
    // A herd: two Holsteins 3 apart.
    const herd = huntAgent({ animals: [cow(1, 4), cow(2, 7)] });
    assert.deepEqual(await hunt(herd), [], 'no hunt of a herd that calls for help');
    assert.match(retaliationRisk(herd.bot, herd.bot.entities[1]), /^in a herd: another animania:cow_holstein within 16 blocks/);
    // A lone Holstein, an Angus nearby (another breed does not answer): hunted.
    const lone = huntAgent({ animals: [cow(1, 4), angus(2, 7)] });
    assert.equal(retaliationRisk(lone.bot, lone.bot.entities[1]), null);
    assert.deepEqual(await hunt(lone), ['mode:hunting']);
    // A bull 20 from the cow but 15 from the bot still counts (the walk takes the bot near it).
    const behind = huntAgent({ animals: [cow(1, 4), bull(2, -15)] });
    assert.match(retaliationRisk(behind.bot, behind.bot.entities[1]), /bull_holstein within 16/);
    // !attack refuses with the reason.
    const cmd = huntAgent({ animals: [cow(1, 4), bull(2, 14)] });
    cmd.bot.pvp = { attack: () => assert.fail('never attacked'), stop() {} };
    cmd.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: cmd.bot.output, interrupted: false }));
    await executeCommand(cmd, '!attack("animania:cow_holstein")');
    assert.match(cmd.bot.output, /Not attacking animania:cow_holstein: a animania:bull_holstein within 16 blocks \(it charges whoever hurts it or its herd; never hunt near one\)\. Find a lone one, away from bulls\./);
});

test('#453 review 2 and 3: the model never !attacks a never-fight animal, hurt or not; a task giver may, warned; a giver may override the bull and herd refusal, never ownership; both reasons are said', async (t) => {
    t.mock.method(console, 'log', () => {});
    const bull = (id, x, extra = {}) => ({ id, name: 'animania:bull_holstein', type: 'mob', position: new Vec3(x + 0.5, 64, 0.5), height: 1.6, metadata: { 7: 24 }, ...extra });
    const run = async (animals, cmd, context, setup = () => {}) => {
        const agent = huntAgent({ animals });
        const hit = [];
        agent.bot.pvp = { attack: (e) => { hit.push(e.id); delete agent.bot.entities[e.id]; }, stop() {} };
        agent.bot.equip = () => Promise.resolve();
        setup(agent);
        agent.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: agent.bot.output, interrupted: false }));
        await executeCommand(agent, cmd, context);
        return { out: agent.bot.output, hit };
    };
    const hurtNow = (agent) => { agent.bot.lastDamageTime = Date.now(); agent.bot.lastDamageTaken = 5; };
    // The model: never, also right after the bull hurt it.
    let r = await run([bull(1, 2)], '!attack("animania:bull_holstein")', undefined, hurtNow);
    assert.deepEqual(r.hit, []);
    assert.match(r.out, /Not attacking animania:bull_holstein: it must never be fought \(it hits for 5 and has 24 health\)\. Get away from it instead\./);
    // A giver who types it: attacked, with a warning.
    r = await run([bull(1, 2)], '!attack("animania:bull_holstein")', { sender: 'JQDAW' });
    assert.deepEqual(r.hit, [1]);
    assert.match(r.out, /Warning: JQDAW asked for it, so attacking animania:bull_holstein, which is never fought otherwise/);
    // ... but never a bull that may be a player's.
    r = await run([bull(1, 2, { metadata: { 7: 24, 2: 'Ferdinand' } })], '!attack("animania:bull_holstein")', { sender: 'JQDAW' });
    assert.deepEqual(r.hit, []);
    assert.match(r.out, /it may belong to a player \(it has a name tag\)/);
    // A cow near a bull: the model is refused; a giver gets it, warned.
    r = await run([cow(1, 4), bull(2, 14)], '!attack("animania:cow_holstein")');
    assert.deepEqual(r.hit, []);
    r = await run([cow(1, 4), bull(2, 14)], '!attack("animania:cow_holstein")', { sender: 'JQDAW' });
    assert.deepEqual(r.hit, [1]);
    assert.match(r.out, /Warning: JQDAW asked for it, so attacking animania:cow_holstein although a animania:bull_holstein within 16 blocks/);
    // Refused for two reasons (a named cow, and a lone-in-a-herd one): both are said.
    r = await run([cow(1, 4, { metadata: { 7: 10, 2: 'Bessie' } }), cow(2, 7)], '!attack("animania:cow_holstein")');
    assert.deepEqual(r.hit, []);
    assert.match(r.out, /Not attacking animania:cow_holstein: it may belong to a player \(it has a name tag\); and in a herd: another animania:cow_holstein within 16 blocks.*\. Find a lone, wild one away from bulls, fences, farms and houses\./);
});

test('G4 #5: the hunting reflex does nothing when food is not due, at dusk or night, with a threat near, when busy, or sheltered', async (t) => {
    t.mock.method(console, 'log', () => {});
    assert.deepEqual(await hunt(huntAgent({ animals: [cow(1, 6)], food: 16 })), [], 'food 16: not due');
    assert.deepEqual(await hunt(huntAgent({ animals: [cow(1, 6)], items: [{ name: 'bread', metadata: 0, count: 2 }] })), [], 'food held: the eating reflex eats it');
    assert.deepEqual(await hunt(huntAgent({ animals: [cow(1, 6)], timeOfDay: NIGHT_START + 100 })), [], 'night');
    assert.deepEqual(await hunt(huntAgent({ animals: [cow(1, 6)], timeOfDay: NIGHT_START - 1000 })), [], 'dusk: the night routine');
    const zombie = { id: 9, name: 'zombie', type: 'mob', metadata: {}, position: new Vec3(4.5, 64, 0.5), height: 1.95 };
    assert.deepEqual(await hunt(huntAgent({ animals: [cow(1, 6), zombie] })), [], 'a threat near');
    assert.deepEqual(await hunt(huntAgent({ animals: [cow(1, 6)], idle: false })), [], 'busy');
    const sheltered = huntAgent({ animals: [cow(1, 6)] });
    sheltered.bot.rotnSheltered = true;
    assert.deepEqual(await hunt(sheltered), [], 'sheltered');
});

test('G4 #5: the hunting reflex never hunts an animal that may belong to a player (and says which, once)', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    assert.deepEqual(await hunt(huntAgent({ animals: [cow(1, 6, { metadata: { 2: 'Bessie' } })] })), []);
    assert.deepEqual(await hunt(huntAgent({ animals: [cow(1, 6)], blocks: { '9,64,0': 'fence' } })), [], 'near a fence');
    assert.ok(logs.includes('[reflex] hunting: left alone, it may belong to a player: animania:cow_holstein: it has a name tag'), logs.join('\n'));
});

test('G4 #5: !attack refuses an animal that may belong to a player, and takes a wild one of the same kind', async (t) => {
    t.mock.method(console, 'log', () => {});
    // The wild one more than 16 blocks from the named one: together they would be a herd (#448).
    const named = cow(1, 3, { metadata: { 2: 'Bessie' } }), wild = cow(2, -20);
    const agent = huntAgent({ animals: [named, wild] });
    const attacked = [];
    agent.bot.pvp = { attack: (e) => { attacked.push(e.id); delete agent.bot.entities[e.id]; }, stop() {} };
    agent.bot.equip = () => Promise.resolve();
    agent.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: agent.bot.output, interrupted: false }));
    await executeCommand(agent, '!attack("animania:cow_holstein")');
    assert.deepEqual(attacked, [2], 'the wild one, not the named one');
    // Only owned ones: refused, with why.
    const only = huntAgent({ animals: [cow(1, 3, { vehicle: { id: 5 } })] });
    only.bot.pvp = { attack: () => assert.fail('never attacked'), stop() {} };
    only.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: only.bot.output, interrupted: false }));
    await executeCommand(only, '!attack("animania:cow_holstein")');
    assert.match(only.bot.output, /Not attacking animania:cow_holstein: it may belong to a player \(it is on a leash\)\. Find a wild one away from fences, farms and houses\./);
});

// Soak 2 (rotn-v0.1.4): at food 4 or lower (Normal) Hunger Overhaul's weakness leaves a bare hand doing
// nothing; the bot chased a sow it could not hurt until food 0 killed it.
test('soak 2: at food 4 or lower no hunt, by the reflex or by !attack on an animal; foraging still runs; a hostile mob is still fought', async (t) => {
    t.mock.method(console, 'log', () => {});
    assert.deepEqual(await hunt(huntAgent({ food: 4, animals: [cow(1, 3)] })), [], 'the reflex: no hunt at food 4');
    assert.deepEqual(await hunt(huntAgent({ food: 5, animals: [cow(1, 3)] })), ['mode:hunting'], 'food 5: it hunts');
    const crop = withCrops(huntAgent({ food: 4, animals: [cow(1, 3)] }), { '6,64,0': ['rustic:wildberry_bush', 1] });
    assert.deepEqual(await hunt(crop), ['mode:hunting'], 'foraging still runs at food 4');
    const weak = huntAgent({ food: 4, animals: [cow(1, 3)] });
    weak.bot.pvp = { attack: () => assert.fail('never attacked'), stop() {} };
    weak.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: weak.bot.output, interrupted: false }));
    await executeCommand(weak, '!attack("animania:cow_holstein")');
    assert.match(weak.bot.output, /Not hunting animania:cow_holstein: your food is 4, and at 4 or lower you are too weak to hurt it \(weakness\)\. Eat anything you hold, or !forage nearby; food 0 kills you at once on this pack\./);
    // A zombie is not an animal: !attack still fights it.
    const zombie = { id: 7, name: 'zombie', type: 'mob', position: new Vec3(3.5, 64, 0.5), height: 1.9, metadata: { 7: 20 } };
    const fight = huntAgent({ food: 4, animals: [zombie] });
    const hit = [];
    fight.bot.pvp = { attack: (e) => { hit.push(e.name); delete fight.bot.entities[e.id]; }, stop() {} };
    fight.bot.equip = () => Promise.resolve();
    fight.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: fight.bot.output, interrupted: false }));
    await executeCommand(fight, '!attack("zombie")');
    assert.doesNotMatch(fight.bot.output, /Not hunting/);
});

// Soak 2: food 8 -> 1 in 9 min from two !moveAway(64) and searches out to 256 blocks.
test('soak 2: below food 8 the model\'s !moveAway and searches go 32 blocks at most, and say why; at food 8 as asked', async (t) => {
    t.mock.method(console, 'log', () => {});
    const far = cow(1, 40);
    const run = async (food, cmd) => {
        const agent = huntAgent({ food, animals: [far] });
        agent.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: agent.bot.output, interrupted: false }), () => ({ message: agent.bot.output, interrupted: false }));
        await executeCommand(agent, cmd);
        return agent.bot.output;
    };
    // Soak 14 (F1): an animal of the kind asked in sight lifts the cap (that walk is the food); a kind not in sight is capped.
    assert.match(await run(7, '!searchForEntity("animania:sow_old_spot", 128)'), /Searching 32 blocks at most at food 7, not 128: walking costs hunger, and food 0 kills you at once on this pack\. Eat or !forage first\.[\s\S]*Could not find any animania:sow_old_spot in 32 blocks/);
    assert.match(await run(7, '!searchForEntity("animania:cow_holstein", 128)'), /Searching past 32 blocks at food 7: animania:cow_holstein is in sight, and it is the food\.[\s\S]*Found animania:cow_holstein/);
    const fed = await run(8, '!searchForEntity("animania:cow_holstein", 128)');
    assert.doesNotMatch(fed, /at most at food/);
    assert.match(fed, /Found animania:cow_holstein/);
    assert.match(await run(7, '!moveAway(64)'), /Moving away 32 blocks at most at food 7, not 64/);
    assert.doesNotMatch(await run(7, '!moveAway(20)'), /at most at food/, 'a short walk is not capped');
});

test('#432 nit: below food 8, !goToCoordinates and !goToPlayer walk 32 blocks at most toward a far target, and !collectBlocks looks 32 blocks out; at food 8 as asked', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { hungryCloseness } = await import('./commands/actions.js');
    const run = async (food, cmd, setup = () => {}) => {
        const agent = huntAgent({ food, blocks: { '40,64,0': 'dirt' } });
        setup(agent);
        agent.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: agent.bot.output, interrupted: false }), () => ({ message: agent.bot.output, interrupted: false }));
        await executeCommand(agent, cmd);
        return agent.bot.output;
    };
    assert.match(await run(7, '!goToCoordinates(100.5, 64, 0.5, 2)'), /Walking 32 blocks at most toward 100\.5, 64, 0\.5 at food 7, not 100: walking costs hunger, and food 0 kills you at once on this pack\. Eat or !forage first\./);
    assert.doesNotMatch(await run(8, '!goToCoordinates(100.5, 64, 0.5, 2)'), /at most/);
    assert.doesNotMatch(await run(7, '!goToCoordinates(20.5, 64, 0.5, 2)'), /at most/, 'a short walk is not capped');
    const player = (agent) => { agent.bot.players = { JQDAW: { username: 'JQDAW', entity: { id: 5, type: 'player', username: 'JQDAW', position: new Vec3(60.5, 64, 0.5), height: 1.8 } } }; };
    assert.match(await run(7, '!goToPlayer("JQDAW", 3)', player), /Walking 32 blocks at most toward JQDAW at food 7, not 60/);
    assert.doesNotMatch(await run(9, '!goToPlayer("JQDAW", 3)', player), /at most/);
    const hungryCollect = await run(7, '!collectBlocks("dirt", 1)');
    assert.match(hungryCollect, /Collecting within 32 blocks at most at food 7, not 64/);
    assert.doesNotMatch(await run(8, '!collectBlocks("dirt", 1)'), /at most/);
    // The closeness left after the capped walk: the target 100 away, so the goal is met 68 from it.
    const agent = huntAgent({ food: 7 });
    assert.equal(hungryCloseness(agent, 'there', new Vec3(100.5, 64, 0.5), 2), 68);
    assert.equal(hungryCloseness(agent, 'there', new Vec3(30.5, 64, 0.5), 2), 2, 'within 32: unchanged');
});

test('#443 review 1: a task giver\'s typed command is never capped while hungry; the model\'s same command is', async (t) => {
    t.mock.method(console, 'log', () => {});
    const run = async (cmd, context) => {
        const agent = huntAgent({ food: 7, animals: [cow(1, 40)], blocks: { '40,64,0': 'dirt' } });
        agent.bot.players = { JQDAW: { username: 'JQDAW', entity: { id: 5, type: 'player', username: 'JQDAW', position: new Vec3(60.5, 64, 0.5), height: 1.8 } } };
        agent.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: agent.bot.output, interrupted: false }), () => ({ message: agent.bot.output, interrupted: false }));
        await executeCommand(agent, cmd, context);
        return agent.bot.output;
    };
    for (const cmd of ['!goToCoordinates(100.5, 64, 0.5, 2)', '!goToPlayer("JQDAW", 3)', '!collectBlocks("dirt", 1)', '!moveAway(64)',
        '!searchForEntity("animania:sow_old_spot", 128)', '!searchForBlock("dirt", 128)']) { // soak 14: a kind not in sight (one in sight is not capped)
        assert.match(await run(cmd), /at most at food 7|at most toward .* at food 7/, `the model's ${cmd} is capped`);
        assert.doesNotMatch(await run(cmd, { sender: 'JQDAW' }), /at most/, `a giver's typed ${cmd} is not`);
    }
});

test('#432 nit: the eating mode names the emergency foods and never cloudsbluff as allowed', () => {
    const d = __modeForTest('eating').description;
    assert.match(d, /At food 5 or lower with nothing else \(food 0 kills on this pack\): a golden apple, raw venison, raw tofenison, raw chicken, rotten flesh, then hawthorn berries, in that order; never cloudsbluff, chorus fruit, pufferfish, raw eggs\./);
    assert.doesNotMatch(d, /except/);
});

test('#422 review 1: a hunt running when dusk falls ends (the night routine is not held up), and pvp stops', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const saved = { ...HUNT };
    Object.assign(HUNT, { checkMs: 20 });
    t.after(() => Object.assign(HUNT, saved));
    const agent = huntAgent({ animals: [cow(1, 6)] });
    const pvp = [];
    agent.bot.pvp = { attack: () => pvp.push('attack'), stop: () => pvp.push('stop') }; // an unreachable cow: never dies
    agent.bot.equip = () => Promise.resolve();
    let finished = null;
    agent.actions.runAction = (label, fn) => { agent.runs.push(label); finished = Promise.resolve(fn()); return finished.then(() => ({ interrupted: false })); };
    const m = __modeForTest('hunting');
    m.active = false;
    await m.update(agent);
    await flush();
    assert.deepEqual(agent.runs, ['mode:hunting']);
    agent.bot.time.timeOfDay = NIGHT_START - 1000; // dusk
    await finished;
    assert.deepEqual(pvp, ['attack', 'stop']);
    assert.ok(logs.includes('[reflex] hunting animania:cow_holstein: stopped'), logs.join('\n'));
});

test('#422 review 6 and 7: the hunting mode interrupts nothing; its phase comes from the night routine\'s freeze-aware clock', async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    assert.deepEqual(__modeForTest('hunting').interrupts, [], 'never a giver\'s follow');
    // The server's value says morning, but the clock (it saw the time stuck long past a freeze) says dusk.
    const agent = huntAgent({ animals: [cow(1, 6)] });
    const clock = new NightClock({ log: () => {} });
    clock.observe(1000, Date.now() - 16 * 60_000); // stuck at 1000 for 16 min (over STUCK_BOUND_MIN): the wall clock runs it on, into the night
    agent._night = { clock };
    assert.notEqual(clock.timeOfDay(Date.now()), 1000);
    assert.deepEqual(await hunt(agent), [], 'not daylight by the clock: no hunt');
});

test('#422 review 2: !attack checks ownership for any target that is not a hostile mob or a player (an FML placeholder, an unknown name)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const placeholder = { id: 1, name: 'animania:entity_7', type: 'mob', position: new Vec3(3.5, 64, 0.5), metadata: { 7: 10, 2: 'Daisy' } };
    const agent = huntAgent({ animals: [placeholder] });
    agent.bot.pvp = { attack: () => assert.fail('never attacked'), stop() {} };
    agent.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: agent.bot.output, interrupted: false }));
    await executeCommand(agent, '!attack("animania:entity_7")');
    assert.match(agent.bot.output, /Not attacking animania:entity_7: it may belong to a player \(it has a name tag\)/);
    // A hostile mob is attacked as before (no ownership check).
    const z = huntAgent({ animals: [{ id: 2, name: 'zombie', type: 'mob', position: new Vec3(3.5, 64, 0.5), metadata: {} }] });
    let hit = 0;
    z.bot.pvp = { attack: (e) => { hit++; delete z.bot.entities[e.id]; }, stop() {} };
    z.bot.equip = () => Promise.resolve();
    z.bot.modes.pause = () => {};
    z.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: z.bot.output, interrupted: false }));
    await executeCommand(z, '!attack("zombie")');
    assert.equal(hit, 1);
});


test('#432 review 4: a hunt under way stops once food falls to 4 (too weak to hurt it); pvp stops', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    const saved = { ...HUNT };
    Object.assign(HUNT, { checkMs: 10, stuckMs: 60_000 });
    t.after(() => Object.assign(HUNT, saved));
    const agent = huntAgent({ food: 6, animals: [cow(1, 3)] });
    const calls = [];
    agent.bot.pvp = { attack: () => { calls.push('attack'); setTimeout(() => { agent.bot.food = 4; }, 40); }, stop: () => calls.push('stop') };
    agent.actions.runAction = async (label, fn) => { agent.runs.push(label); await fn(); return { message: '', interrupted: false }; };
    await hunt(agent);
    await new Promise(r => setTimeout(r, 200));
    assert.deepEqual(calls, ['attack', 'stop']);
    assert.ok(lines.includes('[reflex] hunting animania:cow_holstein: stopped'), lines.join('\n'));
});

// Soak 5 (#500 follow-ups 1 and 2, Fix H): after a death the bot hunted a sow bare-handed with
// zombies near. With no weapon the hunting reflex forages only, and the model's !attack on a food
// animal is refused; a task giver who types it may, warned; never an animal that may be a player's.
test('#500 follow-up 1: with no weapon the hunting reflex never hunts (said once); foraging still runs; armed it hunts', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    assert.deepEqual(await hunt(huntAgent({ armed: false, animals: [cow(1, 3)] })), [], 'unarmed: no hunt');
    assert.deepEqual(await hunt(huntAgent({ armed: false, animals: [cow(1, 3)] })), []);
    assert.equal(logs.filter(l => l === '[reflex] hunting: no weapon, so no hunt (foraging only)').length, 1, 'said once');
    const crop = withCrops(huntAgent({ armed: false, animals: [cow(1, 3)] }), { '6,64,0': ['rustic:wildberry_bush', 1] });
    assert.deepEqual(await hunt(crop), ['mode:hunting'], 'unarmed: it still forages');
    assert.deepEqual(await hunt(huntAgent({ animals: [cow(1, 3)] })), ['mode:hunting'], 'armed: it hunts');
});

test('#500 follow-up 2: the model\'s !attack on a food animal with no weapon is refused; a task giver may, warned; ownership still refuses the giver', async (t) => {
    t.mock.method(console, 'log', () => {});
    const run = async (animals, context, { armed = false } = {}) => {
        const agent = huntAgent({ animals, armed });
        const hit = [];
        agent.bot.pvp = { attack: (e) => { hit.push(e.id); delete agent.bot.entities[e.id]; }, stop() {} };
        agent.bot.equip = () => Promise.resolve();
        agent.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: agent.bot.output, interrupted: false }));
        await executeCommand(agent, '!attack("animania:cow_holstein")', context);
        return { out: agent.bot.output, hit };
    };
    let r = await run([cow(1, 3)]);
    assert.deepEqual(r.hit, [], 'the model, unarmed: refused');
    assert.match(r.out, /Not hunting animania:cow_holstein: you hold no weapon\. Forage for food first \(!forage\); make a weapon \(a wooden club from 2 logs, no table: !craftRecipe\("spartanweaponry:club_wood", 1\)\) before you hunt\./);
    r = await run([cow(1, 3)], { sender: 'JQDAW' });
    assert.deepEqual(r.hit, [1], 'a giver typed it: hunted');
    assert.match(r.out, /Warning: JQDAW asked for it, so hunting animania:cow_holstein with no weapon\./);
    r = await run([cow(1, 3, { metadata: { 2: 'Bessie' } })], { sender: 'JQDAW' });
    assert.deepEqual(r.hit, [], 'never a named one, giver or not');
    assert.match(r.out, /it may belong to a player/);
    r = await run([cow(1, 3)], undefined, { armed: true });
    assert.deepEqual(r.hit, [1], 'armed: hunted as before');
});

// #501 decision (reviewer nit 1): unarmed, the model's !attack is refused for a provoked food animal
// too (#497 flees from it unarmed); a task giver may still override.
test('#501 decision: unarmed, !attack on a food animal that just hurt the bot is refused for the model; a giver may, warned', async (t) => {
    t.mock.method(console, 'log', () => {});
    const run = async (context) => {
        const agent = huntAgent({ armed: false, animals: [cow(1, 1)] });
        Object.assign(agent.bot, { lastDamageTime: Date.now(), lastDamageTaken: 5 });
        const hit = [];
        agent.bot.pvp = { attack: (e) => { hit.push(e.id); delete agent.bot.entities[e.id]; }, stop() {} };
        agent.bot.equip = () => Promise.resolve();
        agent.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: agent.bot.output, interrupted: false }));
        await executeCommand(agent, '!attack("animania:cow_holstein")', context);
        return { out: agent.bot.output, hit };
    };
    let r = await run();
    assert.deepEqual(r.hit, [], 'provoked, unarmed, the model: refused');
    assert.match(r.out, /Not hunting animania:cow_holstein: you hold no weapon\./);
    r = await run({ sender: 'JQDAW' });
    assert.deepEqual(r.hit, [1]);
    assert.match(r.out, /Warning: JQDAW asked for it, so hunting animania:cow_holstein with no weapon\./);
});

// Soak 5 (00:21-00:31): !attack on a sow it could not reach ran ~50 s each time until the unstuck
// reflex ended it, 8 times. Now it gives up after ATTACK_PROGRESS.stallMs with no closer step and no
// hit, and that animal is left alone for skipMs; a chase that gets closer goes on.
test('soak 5: an !attack chase with no progress gives up after stallMs and leaves that animal alone; one that closes in goes on', async (t) => {
    t.mock.method(console, 'log', () => {});
    assert.deepEqual(ATTACK_PROGRESS, { stallMs: 10_000, skipMs: 5 * 60_000, tickMs: 1000 });
    const saved = { ...ATTACK_PROGRESS };
    Object.assign(ATTACK_PROGRESS, { stallMs: 300, tickMs: 50 });
    t.after(() => Object.assign(ATTACK_PROGRESS, saved));
    const sow = { id: 5, name: 'animania:sow_old_spot', type: 'mob', position: new Vec3(10.5, 64, 0.5), height: 1, metadata: { 7: 10 } };
    const agent = huntAgent({ animals: [sow] });
    let stops = 0;
    agent.bot.pvp = { attack() {}, stop() { stops++; } }; // it never gets there
    agent.bot.equip = () => Promise.resolve();
    agent.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: agent.bot.output, interrupted: false }));
    await executeCommand(agent, '!attack("animania:sow_old_spot")');
    assert.equal(stops, 1);
    assert.match(agent.bot.output, /Could not reach the animania:sow_old_spot at 10, 64, 0: no closer and no hit for 0\.3 s; leaving it alone for 5 min\. Try another one, or !forage\./);
    agent.bot.output = '';
    await executeCommand(agent, '!attack("animania:sow_old_spot")');
    assert.match(agent.bot.output, /Not attacking animania:sow_old_spot: the ones it could not reach in the last 5 min are left alone\. Try another one, another place, or !forage\./);
    // A chase that closes in (a block per tick) is not stopped; it ends when the animal dies.
    const pig = { id: 6, name: 'animania:sow_old_spot', type: 'mob', position: new Vec3(12.5, 64, 0.5), height: 1, metadata: { 7: 10 } };
    const near = huntAgent({ animals: [pig] });
    let ticks = 0;
    near.bot.pvp = { attack() {}, stop() { assert.fail('not stopped'); } };
    near.bot.equip = () => Promise.resolve();
    const timer = setInterval(() => { ticks++; pig.position = pig.position.offset(-1, 0, 0); if (ticks === 10) delete near.bot.entities[6]; }, 50);
    t.after(() => clearInterval(timer));
    near.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: near.bot.output, interrupted: false }));
    await executeCommand(near, '!attack("animania:sow_old_spot")');
    clearInterval(timer);
    assert.match(near.bot.output, /Successfully killed animania:sow_old_spot\./);
});

// #502 nit 3: expired "could not reach" entries are pruned (the map never only grows).
test('#502 nit 3: rotnUnreachable drops expired entries when one is marked or looked up', () => {
    const bot = {};
    markUnreachable(bot, { id: 1 }, 0);
    markUnreachable(bot, { id: 2 }, 1000);
    assert.deepEqual([...bot.rotnUnreachable.keys()], [1, 2]);
    assert.equal(isUnreachable(bot, { id: 1 }, ATTACK_PROGRESS.skipMs - 1), true);
    assert.equal(isUnreachable(bot, { id: 1 }, ATTACK_PROGRESS.skipMs), false, 'expired');
    assert.deepEqual([...bot.rotnUnreachable.keys()], [2], 'and gone from the map');
    markUnreachable(bot, { id: 3 }, 1000 + ATTACK_PROGRESS.skipMs);
    assert.deepEqual([...bot.rotnUnreachable.keys()], [3], 'marking prunes the expired ones');
});

// Soak 11 (H1): 22:08:51 "hunting animania:doe_cottontail: killed", then the model's next command at
// once, and the night began with 0 food held: nothing said whether the meat was picked up.
test('soak 11 (H1): after a kill the hunt waits for the drop where the animal died and says what it picked up, or that none was seen', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (l) => lines.push(String(l)));
    const saved = { ...KILL_DROPS }, savedHunt = { ...HUNT };
    Object.assign(KILL_DROPS, { maxMs: 50, step: 10, settleMs: 10 });
    Object.assign(HUNT, { checkMs: 10 });
    t.after(() => { Object.assign(KILL_DROPS, saved); Object.assign(HUNT, savedHunt); });
    const agent = huntAgent({ animals: [cow(1, 3)] });
    agent.bot.pvp = { attack: () => { delete agent.bot.entities[1]; }, stop() {} };
    agent.actions.runAction = async (label, fn) => { agent.runs.push(label); await fn(); return { message: '', interrupted: false }; };
    await hunt(agent);
    for (let i = 0; i < 100 && !lines.some(l => /^\[reflex\] hunting animania:cow_holstein: /.test(l)); i++) await new Promise(r => setTimeout(r, 20));
    assert.ok(lines.includes('[reflex] hunting animania:cow_holstein: killed; no drop seen within 4 blocks in 50 ms'), lines.join('\n'));
});

test('soak 11 (H1): pickupKillDrops picks up only drops near the kill spot, through the pickup refusals, and counts what came in', async () => {
    const at = new Vec3(3.5, 64, 0.5);
    const items = [];
    const drop = (id, x, extra = {}) => ({ id, name: 'item', type: 'object', position: new Vec3(x, 64, 0.5), ...extra });
    const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 5: drop(5, 4), 6: drop(6, 20) }, inventory: { items: () => items } };
    const allowed = [];
    const pickup = (b, { allow }) => { for (const e of Object.values(b.entities)) if (allow(e)) { allowed.push(e.id); items.push({ name: 'rabbit', count: 1 }); } return Promise.resolve(); };
    const r = await pickupKillDrops(bot, at, { maxMs: 50, step: 10, settleMs: 0, pickup });
    assert.deepEqual(allowed, [5], 'not the drop 16 blocks away');
    assert.deepEqual(r, { picked: [{ name: 'rabbit', count: 1 }], seen: 1, refused: null });
    assert.equal(killDropsText(r), 'picked up 1 rabbit');
    // None within reach in the wait: nothing tried.
    const empty = { entity: bot.entity, entities: {}, inventory: { items: () => [] } };
    const none = await pickupKillDrops(empty, at, { maxMs: 30, step: 10, pickup: () => { throw new Error('no pickup'); } });
    assert.deepEqual(none, { picked: [], seen: 0, refused: null });
    assert.equal(killDropsText(none, 4, 3000), 'no drop seen within 4 blocks in 3 s');
    // A drop the refusals keep (a zombie near it): left, and said why.
    const zombie = { id: 9, name: 'zombie', type: 'mob', position: new Vec3(5, 64, 0.5), height: 1.95 };
    const kept = { entity: bot.entity, entities: { 5: drop(5, 4), 9: zombie }, inventory: { items: () => [] } };
    const k = await pickupKillDrops(kept, at, { maxMs: 30, step: 10, settleMs: 0, pickup: (b, { allow }) => { Object.values(b.entities).forEach(allow); return Promise.resolve(); } });
    assert.equal(k.seen, 1);
    assert.ok(k.refused, 'a refusal named');
    assert.match(killDropsText(k), /^1 drop left: /);
});

// Soak 11 (H2, rotn-data's soak 11 Animania food answer): a cottontail drops 0-2 rabbit (none in a
// quarter of kills); a regular pig, cow or sheep 2-8 vanilla meat, a prime one 1-4 prime meat. Raw
// meat is safe (only raw chicken gives Hunger); the prime meats are 1 hunger, the rabbit 2.
test('soak 11 (H2): a pig, cow or sheep in range is hunted before a nearer rabbit, and named first; the meats every breed drops count as safe food', async () => {
    const { huntTarget, nearbyHuntable, meatRank } = await import('./library/hunting.js');
    const { foodValue, avoidReason, heldFoodHunger } = await import('./library/food.js');
    const doe = { id: 3, name: 'animania:doe_cottontail', type: 'mob', position: new Vec3(3.5, 64, 0.5), height: 0.5, metadata: { 7: 3 } };
    const sow = { id: 4, name: 'animania:sow_large_white', type: 'mob', position: new Vec3(12.5, 64, 0.5), height: 0.9, metadata: { 7: 10 } };
    assert.deepEqual([meatRank(doe), meatRank(sow), meatRank({ name: 'rabbit' }), meatRank(cow(1, 1))], [1, 0, 1, 0]);
    // #588 nit 2: every rabbit breed by name; a goat doe keeps the default rank.
    for (const breed of ['cottontail', 'dutch', 'havana', 'jack', 'lop', 'rex', 'new_zealand', 'chinchilla']) assert.equal(meatRank({ name: `animania:doe_${breed}` }), 1, breed);
    assert.deepEqual([meatRank({ name: 'animania:doe_alpine' }), meatRank({ name: 'animania:doe_kiko' })], [0, 0], 'goat does are not rabbits');
    const both = huntAgent({ animals: [doe, sow] });
    assert.equal(huntTarget(both.bot)?.id, 4, 'the sow, though the rabbit is nearer');
    assert.deepEqual(nearbyHuntable(both.bot), ['animania:sow_large_white', 'animania:doe_cottontail']);
    const rabbitOnly = huntAgent({ animals: [doe] });
    assert.equal(huntTarget(rabbitOnly.bot)?.id, 3, 'a rabbit when there is nothing else');
    // What each breed drops (vanilla meat from regular breeds, prime meat from prime ones): safe food.
    const meats = { 'minecraft:rabbit': 2, 'minecraft:porkchop': 1, 'minecraft:beef': 1, 'minecraft:mutton': 1,
        'animania:raw_prime_pork': 1, 'animania:raw_prime_beef': 1, 'animania:raw_prime_mutton': 1, 'animania:raw_prime_rabbit': 1, 'animania:raw_prime_chicken': 1 };
    for (const [name, hunger] of Object.entries(meats)) {
        const item = { name, metadata: 0, count: 1 };
        assert.equal(foodValue(item)?.hunger, hunger, name);
        assert.equal(avoidReason(item), null, `${name} is safe raw`);
    }
    assert.ok(avoidReason({ name: 'minecraft:chicken', metadata: 0 }), 'raw chicken: Hunger 30% of the time');
    // Raw chicken only when starving (food 5 or lower, EMERGENCY_FOOD), and never before safe meat.
    const { chooseFood } = await import('./library/food.js');
    const inv = (...names) => ({ inventory: { items: () => names.map(name => ({ name, metadata: 0, count: 1 })) } });
    assert.equal(chooseFood(inv('minecraft:chicken')), null, 'not hungry enough');
    assert.equal(chooseFood(inv('minecraft:chicken'), { emergency: true })?.name, 'minecraft:chicken', 'starving: eaten');
    assert.equal(chooseFood(inv('minecraft:chicken', 'minecraft:porkchop'), { emergency: true })?.name, 'minecraft:porkchop', 'safe raw meat first');
    assert.equal(chooseFood(inv('minecraft:beef'))?.name, 'minecraft:beef', 'raw beef eaten as it is');
    // The night's "food worth N hunger held" counts them.
    const held = { inventory: { items: () => [{ name: 'minecraft:porkchop', metadata: 0, count: 5 }, { name: 'animania:raw_prime_beef', metadata: 0, count: 2 }] } };
    assert.equal(heldFoodHunger(held), 7);
    // The food step's texts say so.
    const { FOOD_RESERVE_STEP } = await import('./agenda.js');
    assert.match(FOOD_RESERVE_STEP.goal, /hunt a wild pig, cow or sheep near you \(2 to 8 meat each; a rabbit drops 0 to 2, a young animal nothing\)/);
    const prompt = FOOD_RESERVE_STEP.goalNow({ food: () => 9, foodHeld: () => 0, huntable: () => ['animania:sow_large_white'], forageable: () => [], hasWeapon: () => true }, {});
    assert.match(prompt, /a kill is food only once its meat is in your inventory/);
    assert.match(prompt, /Raw meat is safe \(1 hunger each, a rabbit 2; never raw chicken\)/);
});

// #588 nit 5: the reflex's line when the drop is picked up, and when a pickup refusal keeps it.
test('#588 nit 5: after a kill the hunting reflex says what it picked up, or why the drop was left (a recent death spot)', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (l) => lines.push(String(l)));
    const saved = { ...KILL_DROPS }, savedHunt = { ...HUNT };
    Object.assign(HUNT, { checkMs: 10 });
    t.after(() => { Object.assign(KILL_DROPS, saved); Object.assign(HUNT, savedHunt); });
    const hunted = (setup) => {
        const items = [];
        const agent = huntAgent({ animals: [cow(1, 3)], items });
        agent.bot.pvp = { attack: () => {
            delete agent.bot.entities[1];
            agent.bot.entities[50] = { id: 50, name: 'item', type: 'object', position: new Vec3(3.5, 64, 0.5) }; // the drop, where it died
        }, stop() {} };
        agent.actions.runAction = async (label, fn) => { agent.runs.push(label); await fn(); return { message: '', interrupted: false }; };
        setup?.(agent, items);
        return agent;
    };
    const lineOf = async (agent) => {
        lines.length = 0;
        await hunt(agent);
        for (let i = 0; i < 100 && !lines.some(l => /^\[reflex\] hunting animania:cow_holstein: /.test(l)); i++) await new Promise(r => setTimeout(r, 20));
        return lines.find(l => /^\[reflex\] hunting animania:cow_holstein: /.test(l));
    };
    // Picked up: the pickup (the real one walks to it) brings 3 beef in.
    Object.assign(KILL_DROPS, { maxMs: 200, step: 10, settleMs: 10 });
    const got = hunted((agent, items) => {
        KILL_DROPS.pickup = (bot, { allow }) => { if (allow(bot.entities[50])) { items.push({ name: 'beef', count: 3, metadata: 0 }); delete bot.entities[50]; } return Promise.resolve(); };
    });
    assert.equal(await lineOf(got), '[reflex] hunting animania:cow_holstein: killed; picked up 3 beef');
    // Refused: the drop lies within the radius of a recent death spot.
    const kept = hunted((agent) => {
        KILL_DROPS.pickup = (bot, { allow }) => { allow(bot.entities[50]); return Promise.resolve(); };
        agent.bot.rotnDeathSpots = (now) => [{ pos: { x: 3, y: 64, z: 0 }, at: now - 1000, dimension: 'overworld' }];
    });
    assert.match(await lineOf(kept), /^\[reflex\] hunting animania:cow_holstein: killed; 1 drop left: within \d+ blocks of where you died recently/);
});

// Soak 12 (E, 14:51:18): the model's !attack killed the ewe and said "Picked up 0 items." at once, before the
// drop fell (after the death animation). Its kill now waits for the drop where the animal died, as the hunt's.
test('soak 12 (E): !attack waits for the kill\'s drop where the animal died, picks it up and says what', async (t) => {
    t.mock.method(console, 'log', () => {});
    const saved = { ...ATTACK_PROGRESS }, savedDrops = { ...KILL_DROPS };
    Object.assign(ATTACK_PROGRESS, { stallMs: 2000, tickMs: 20 });
    const items = [];
    Object.assign(KILL_DROPS, { maxMs: 500, step: 10, settleMs: 10, pickup: (b, { allow }) => {
        for (const e of Object.values(b.entities)) if (allow(e)) { delete b.entities[e.id]; items.push({ name: 'animania:raw_prime_mutton', metadata: 0, count: 2 }); }
        return Promise.resolve();
    } });
    t.after(() => { Object.assign(ATTACK_PROGRESS, saved); Object.assign(KILL_DROPS, savedDrops); });
    const ewe = { id: 6, name: 'animania:ewe_dorset', type: 'mob', position: new Vec3(2.5, 64, 0.5), height: 1, metadata: { 7: 6 } };
    const agent = huntAgent({ animals: [ewe], items });
    agent.bot.equip = () => Promise.resolve();
    let hits = 0;
    agent.bot.pvp = { attack() { if (++hits === 1) setTimeout(() => {
        delete agent.bot.entities[6];
        // The drop falls 150 ms after the death, where it died.
        setTimeout(() => { agent.bot.entities[50] = { id: 50, name: 'item', type: 'object', position: new Vec3(2.5, 64, 0.5) }; }, 150);
    }, 30); }, stop() {} };
    agent.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: agent.bot.output, interrupted: false }));
    await executeCommand(agent, '!attack("animania:ewe_dorset")');
    assert.match(agent.bot.output, /Successfully killed animania:ewe_dorset\./);
    assert.match(agent.bot.output, /Its drop: picked up 2 animania:raw_prime_mutton\./);
    assert.doesNotMatch(agent.bot.output, /Picked up 0 items/);
});

// Soak 13 (C1, the lead): day 3 ran !searchForEntity 35 times (8 kinds, 64 to 511 blocks) with no find; each
// miss named only the kind asked. Now a generic kind also finds its Animania food adults, the range is what the
// bot can see (64: Animania's tracking box, rotn-data), a miss lists the animals in sight, and the 3rd miss within 64 blocks (10 min) says no animals
// are near, the kinds searched, and to move away or do something else. A task giver's typed command: plain.
test('soak 13 C1: !searchForEntity finds Animania adults by generic kind, says what is in sight, and after 3 misses in an area says no animals are near', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { matchesKind } = await import('./library/hunting.js');
    const { SEARCH_MISSES, ENTITY_SIGHT } = await import('./library/entity_search.js');
    assert.equal(ENTITY_SIGHT, 64);
    assert.equal(SEARCH_MISSES.moveAway, 128, 'two tracking boxes: the new box shares nothing with the old');
    const search = async (agent, cmd, context) => {
        agent.bot.output = '';
        agent.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: agent.bot.output, interrupted: false }), () => ({ message: agent.bot.output, interrupted: false }));
        await executeCommand(agent, cmd, context);
        return agent.bot.output;
    };
    // The generic kinds and the hunt's food adults agree.
    const named = (name) => ({ name });
    assert.equal(matchesKind(named('animania:cow_holstein'), 'cow'), true);
    assert.equal(matchesKind(named('animania:sow_old_spot'), 'pig'), true);
    assert.equal(matchesKind(named('animania:ewe_dorset'), 'sheep'), true);
    assert.equal(matchesKind(named('animania:doe_cottontail'), 'rabbit'), true);
    assert.equal(matchesKind(named('animania:doe_alpine'), 'rabbit'), false, 'a goat doe is no rabbit');
    assert.equal(matchesKind(named('animania:bull_holstein'), 'cow'), false, 'a bull is left alone, as by the hunt');
    assert.equal(matchesKind(named('animania:calf_holstein'), 'cow'), false, 'a calf is no food');
    assert.equal(matchesKind(named('animania:hen_leghorn'), 'chicken'), false, 'no hen: hunting never takes one');
    assert.equal(matchesKind(named('chicken'), 'chicken'), true);
    assert.equal(matchesKind(named('animania:cow_holstein'), 'animania:cow_holstein'), true);

    // A generic "cow" finds the Holstein (soak 13: "cow" never matched an Animania cow).
    const found = await search(huntAgent({ animals: [cow(1, 20)] }), '!searchForEntity("cow", 64)');
    assert.match(found, /Found animania:cow_holstein/);

    // A miss lists what is in sight; a range past 80 says a larger range finds no more.
    const ewe = { id: 2, name: 'animania:ewe_dorset', type: 'mob', position: new Vec3(30.5, 64, 0.5), height: 1.2, metadata: { 7: 10 } };
    const sight = await search(huntAgent({ animals: [ewe] }), '!searchForEntity("pig", 128)');
    assert.match(sight, /Could not find any pig in 64 blocks\. You asked for 128: the bot sees animals only within 64 blocks, so a larger range finds no more\. Animals in sight: animania:ewe_dorset\./);

    // The server's box is square (|dx|, |dz| <= 64): an ewe toward its corner (85 blocks) is in sight, and a search of 64 finds it.
    const corner = { ...ewe, position: new Vec3(60.5, 64, 60.5) };
    assert.match(await search(huntAgent({ animals: [corner] }), '!searchForEntity("sheep", 64)'), /Found animania:ewe_dorset/);
    // Below 64 the asked range holds.
    assert.match(await search(huntAgent({ animals: [{ ...ewe, position: new Vec3(40.5, 64, 0.5) }] }), '!searchForEntity("sheep", 32)'), /Could not find any sheep in 32 blocks\. Animals in sight: animania:ewe_dorset\./);

    // Nothing at all: the 1st and 2nd misses say so; the 3rd (any kinds, within 64 blocks) says no animals near here.
    const agent = huntAgent({ animals: [] });
    assert.match(await search(agent, '!searchForEntity("pig", 64)'), /Could not find any pig in 64 blocks\. No animal of any kind is in sight \(64 blocks\)\.\n$/);
    assert.doesNotMatch(await search(agent, '!searchForEntity("cow", 128)'), /No animals near here/);
    agent.bot.entity.position = new Vec3(30.5, 64, 0.5); // 30 blocks on: the same area
    const third = await search(agent, '!searchForEntity("sheep", 256)');
    assert.match(third, /No animals near here: you searched for pig, cow, sheep \(3 times within 64 blocks\) and no animal is in sight\. Searching again here finds nothing more: move more than 128 blocks away, or do something else \(!forage, or the agenda's other needs\)\./);
    assert.match(await search(agent, '!searchForEntity("animania:cow_holstein", 128)'), /you searched for pig, cow, sheep, animania:cow_holstein \(4 times within 64 blocks\)/, 'a 4th repeats it');

    // More than 64 blocks from the first miss: a new area, a new count.
    agent.bot.entity.position = new Vec3(65.5, 64, 0.5);
    const moved = await search(agent, '!searchForEntity("pig", 64)');
    assert.doesNotMatch(moved, /No animals near here/);
    assert.equal(agent.searchMisses.count, 1);
    // 10 min after the first miss: a new count too.
    await search(agent, '!searchForEntity("cow", 64)');
    agent.searchMisses.time -= SEARCH_MISSES.windowMs + 1;
    assert.doesNotMatch(await search(agent, '!searchForEntity("sheep", 64)'), /No animals near here/);
    assert.equal(agent.searchMisses.count, 1);
    // A find forgets the misses.
    await search(agent, '!searchForEntity("cow", 64)');
    agent.bot.entities[1] = cow(1, 70);
    assert.match(await search(agent, '!searchForEntity("cow", 64)'), /Found animania:cow_holstein/);
    assert.equal(agent.searchMisses, null);

    // A task giver's typed command: the plain line, not counted.
    const giver = huntAgent({ animals: [] });
    for (let i = 0; i < 3; i++) assert.equal(await search(giver, '!searchForEntity("pig", 64)', { sender: 'JQDAW' }), 'Could not find any pig in 64 blocks.\n');
    assert.equal(giver.searchMisses, undefined);
});

// #601 review 1, 2, 4: the miss count and the animal lines are for animal kinds only (a zombie or a villager
// search is upstream's: the asked range, the plain line, nothing counted); with other animals in sight the 3rd
// miss says "None of <kinds> near here", not "No animals"; a record from a miss with no position starts again.
test('#601 review: a zombie or villager search is not counted and gets no animal lines; other animals in sight: "None of …"; a record with no position does not throw', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { noteSearchMiss, isAnimalKind } = await import('./library/entity_search.js');
    const search = async (agent, cmd) => {
        agent.bot.output = '';
        agent.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: agent.bot.output, interrupted: false }), () => ({ message: agent.bot.output, interrupted: false }));
        await executeCommand(agent, cmd);
        return agent.bot.output;
    };
    for (const k of ['cow', 'Pig', 'chicken', 'rabbit', 'animania:bull_holstein', 'horse']) assert.equal(isAnimalKind(k), true, k);
    for (const k of ['zombie', 'villager', 'skeleton', 'zombie_players:zombie_player']) assert.equal(isAnimalKind(k), false, k);
    const bull = { id: 3, name: 'animania:bull_holstein', type: 'mob', position: new Vec3(20.5, 64, 0.5), height: 1.6, metadata: { 7: 10 } };
    const agent = huntAgent({ animals: [bull] });
    for (const cmd of ['!searchForEntity("zombie", 128)', '!searchForEntity("villager", 64)', '!searchForEntity("zombie", 64)']) {
        const out = await search(agent, cmd);
        assert.match(out, /^Could not find any (zombie|villager) in (128|64) blocks\.\n$/, `${cmd}: the plain line, the asked range`);
    }
    assert.equal(agent.searchMisses, undefined, 'not counted');
    // A zombie in range is still found (upstream's search).
    const z = huntAgent({ animals: [{ id: 4, name: 'zombie', type: 'mob', position: new Vec3(70.5, 64, 0.5), height: 1.9, metadata: {} }] });
    assert.match(await search(z, '!searchForEntity("zombie", 128)'), /Found zombie/);
    // A bull in sight, three food kinds searched: "None of …", no "No animals near here".
    await search(agent, '!searchForEntity("pig", 64)');
    await search(agent, '!searchForEntity("cow", 64)');
    const third = await search(agent, '!searchForEntity("sheep", 64)');
    assert.match(third, /Animals in sight: animania:bull_holstein\. None of pig, cow, sheep near here: you searched for them \(3 times within 64 blocks\), and only the animals above are in sight\. Searching again here for them finds nothing more: move more than 128 blocks away/);
    assert.doesNotMatch(third, /No animals near here/);
    // #601 review 4: a first miss with no position, then one with a position: a new record, no throw.
    const a = { bot: { entity: {} } };
    noteSearchMiss(a, 'pig', 0);
    a.bot.entity.position = new Vec3(0.5, 64, 0.5);
    const r = noteSearchMiss(a, 'cow', 1);
    assert.equal(r.count, 1);
    assert.ok(r.at);
});

// Soak 14 (F1): !consume("wheat") at food 2 ended in "Promise timed out" 3 s later (wheat is no food).
test('soak 14 (F1): !consume of an item that is no food on this pack says so at once and eats nothing', async (t) => {
    t.mock.method(console, 'log', () => {});
    const wheat = { name: 'wheat', count: 1, metadata: 0, type: reg.itemsByName.wheat.id };
    const agent = huntAgent({ food: 2, items: [wheat], armed: false });
    let consumed = 0;
    Object.assign(agent.bot, { equip: () => Promise.resolve(), consume: () => { consumed++; return Promise.resolve(); } });
    agent.actions.runAction = (label, fn) => Promise.resolve(fn()).then(() => ({ message: agent.bot.output, interrupted: false }));
    await executeCommand(agent, '!consume("wheat")');
    assert.match(agent.bot.output, /wheat is not food on this pack: nothing to eat\. 3 wheat make bread at a crafting table\./);
    assert.equal(consumed, 0);
});

// Soak 14 (F3, the lead): death 1's low-health flee said "flee zombie" (9 m off) while the grove sprite that
// hit followed. The flee now names the mob the last hurt line named (recentHitter) and goes away from it.
test('soak 14 (F3): the low-health flee names the mob the hurt line named (a grove sprite), not the nearest hostile', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const agent = huntAgent({ animals: [] });
    const bot = agent.bot;
    const sprite = { id: 7, name: 'primitivemobs:grovesprite', type: 'mob', position: new Vec3(1.5, 64, 0.5), height: 1 };
    const zombie = { id: 8, name: 'zombie', type: 'mob', position: new Vec3(9.5, 64, 0.5), height: 1.95, metadata: {} };
    Object.assign(bot.entities, { 7: sprite, 8: zombie });
    Object.assign(bot, { health: 1, lastDamageTime: Date.now(), lastDamageTaken: 5.5, rotnLastHitter: { id: 7, at: Date.now() }, blockAt: () => ({ name: 'air' }) });
    bot.pathfinder.goal = null;
    const ran = [];
    agent.actions.runAction = (label) => { ran.push(label); return Promise.resolve({ message: '', interrupted: false }); };
    await __modeForTest('self_preservation').update(agent);
    assert.ok(logs.includes('[survival] flee primitivemobs:grovesprite (low health 1)'), logs.join('\n'));
    assert.deepEqual(ran, ['mode:self_preservation']);
    // No recent hitter: the nearest hostile, as before.
    logs.length = 0;
    bot.rotnLastHitter = null;
    await __modeForTest('self_preservation').update(agent);
    assert.ok(logs.includes('[survival] flee zombie (low health 1)'), logs.join('\n'));
});
