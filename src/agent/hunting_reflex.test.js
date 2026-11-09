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

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const flush = () => new Promise(r => setImmediate(r));
const cow = (id, x, extra = {}) => ({ id, name: 'animania:cow_holstein', type: 'mob', position: new Vec3(x + 0.5, 64, 0.5), height: 1.4, ...extra, metadata: { 7: 10, ...(extra.metadata ?? {}) } });

function huntAgent({ food = 12, items = [], timeOfDay = 1000, animals = [], idle = true, blocks = {} } = {}) {
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
    const named = cow(1, 3, { metadata: { 2: 'Bessie' } }), wild = cow(2, 8);
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

