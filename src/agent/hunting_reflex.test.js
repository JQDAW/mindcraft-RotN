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
import { NIGHT_START } from './library/night.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const flush = () => new Promise(r => setImmediate(r));
const cow = (id, x, extra = {}) => ({ id, name: 'animania:cow_holstein', type: 'mob', metadata: {}, position: new Vec3(x + 0.5, 64, 0.5), height: 1.4, ...extra });

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
const hunt = async (agent) => { const m = __modeForTest('hunting'); m.active = false; m.skipped_said = ''; await m.update(agent); await flush(); m.active = false; return agent.runs; };

test('G4 #5: the hunting reflex hunts a wild animal when food is due, by day, with no threat near, when idle', async (t) => {
    t.mock.method(console, 'log', () => {});
    assert.deepEqual(await hunt(huntAgent({ animals: [cow(1, 6)] })), ['mode:hunting'], 'food 12, nothing held, a wild cow');
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
