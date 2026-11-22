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
import { ATTACK_PROGRESS, isUnreachable, markUnreachable } from './library/skills.js';

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
    assert.match(await run(7, '!searchForEntity("animania:cow_holstein", 128)'), /Searching 32 blocks at most at food 7, not 128: walking costs hunger, and food 0 kills you at once on this pack\. Eat or !forage first\.[\s\S]*Could not find any animania:cow_holstein in 32 blocks/);
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
        '!searchForEntity("animania:cow_holstein", 128)', '!searchForBlock("dirt", 128)']) {
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
