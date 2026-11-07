// G3 round 9 batch B, fix (c): self_defense never takes the bot out of its night shelter.
// At 13:35:22 a digging zombie (Epic Siege Mod: minecraft:zombie has "Digging": true) opened one side
// of the dirt shelter; the night routine started the repair, self_defense interrupted it
// (driver.log 471: "mode:self_defense" trying to interrupt current action "action:buildShelter"),
// defendSelf walked out after the zombie (pvp.attack follows its target), and the bot died outside
// at -78 58 -60 (driver.log 487). Now, with a wall open: the night's repair is not interrupted, and
// the fight is from where the bot stands (no walk), only at mobs within reach.
// Fake bot and agent; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { setImmediate } from 'node:timers';
import { __setRegistryForTest } from '../utils/mcdata.js';
import './agent.js'; // the real import order (commands/index.js first)
import { __modeForTest, __resetThreatLease } from './modes.js';
import { REPAIR_LABEL } from './night_routine.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const flush = () => new Promise(resolve => setImmediate(resolve));

/** The bot in its shelter at 0 64 0, a wall open to the east, a zombie in the opening (x 1) or farther. */
function shelter({ zombieAt = 1, label = '' } = {}) {
    __resetThreatLease();
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0.5, 64, 0.5), height: 1.8 };
    const zombie = { id: 1, name: 'zombie', type: 'mob', position: new Vec3(zombieAt + 0.5, 64, 0.5), height: 1.8 };
    const calls = { gotos: [], pvp: [], attacks: [], looks: 0 };
    const bot = {
        username: 'FRCFLD', entity: self, entities: { 0: self, 1: zombie },
        registry: reg, version: '1.12.2', health: 20, food: 20, isAlive: true, lastDamageTime: -1e9, lastDamageTaken: 0,
        rotnSheltered: 'open', interrupt_code: false, output: '',
        blockAt: () => null, clearControlStates() {}, setControlState() {},
        inventory: { items: () => [], slots: [] }, heldItem: null,
        equip: () => Promise.resolve(),
        lookAt: () => { calls.looks++; return Promise.resolve(); },
        attack: (e) => { calls.attacks.push(e.id); if (calls.attacks.length >= 2) delete bot.entities[1]; }, // dies after two hits
        pvp: { attack: (e) => calls.pvp.push(e.id), stop() {} },
        pathfinder: {
            goal: null, setMovements() {}, setGoal() {}, stop() {}, isMoving: () => false,
            goto: (g) => { calls.gotos.push(g); return Promise.resolve(); },
            getPathFromTo: function* () { yield { result: { status: 'success', path: [] } }; },
        },
        modes: { behavior_log: '', pause() {}, unpause() {} },
        nearestEntity: (match) => Object.values(bot.entities).filter(e => e !== self && match(e))
            .sort((a, b) => a.position.distanceTo(self.position) - b.position.distanceTo(self.position))[0] ?? null,
    };
    const ran = [], interrupts = [];
    let current = label ? { label } : null;
    const agent = {
        bot, shut_up: true, openChat() {}, isIdle: () => !current,
        actions: {
            resume_func: null,
            get currentActionLabel() { return current?.label ?? ''; },
            async runAction(l, fn) {
                if (current) interrupts.push({ of: current.label, by: l });
                current = { label: l };
                ran.push(l);
                await fn();
                current = null;
                return { message: '', interrupted: false };
            },
        },
    };
    return { agent, bot, calls, ran, interrupts, self };
}

async function selfDefense(agent) {
    const mode = __modeForTest('self_defense');
    await mode.update(agent);
    for (let i = 0; i < 50 && mode.active; i++) await new Promise(resolve => setTimeout(resolve, 50));
    await flush();
    return mode;
}

test('round 9 B (c): with a wall open, self_defense does not interrupt the night\'s repair', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, interrupts, calls } = shelter({ label: REPAIR_LABEL });
    await selfDefense(agent);
    assert.deepEqual(interrupts, [], 'the repair runs on');
    assert.deepEqual([calls.gotos.length, calls.pvp.length, calls.attacks.length], [0, 0, 0]);
});

test('round 9 B (c): with a wall open, the bot fights the mob in the opening from where it stands: no walk, no pvp follow', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, bot, calls, ran, self } = shelter();
    const before = self.position.clone();
    await selfDefense(agent);
    assert.deepEqual(ran, ['mode:self_defense']);
    assert.deepEqual(calls.gotos, [], 'no pathfinder walk (defendSelf walked out after the zombie)');
    assert.deepEqual(calls.pvp, [], 'no mineflayer-pvp attack (it follows its target)');
    assert.deepEqual(calls.attacks, [1, 1], 'hit in place until it died');
    assert.ok(self.position.equals(before), 'still in the shelter');
    assert.equal(bot.rotnSheltered, 'open');
});

test('round 9 B (c): with a wall open, a mob out of reach is not chased', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, calls, ran } = shelter({ zombieAt: 5 });
    await selfDefense(agent);
    assert.deepEqual(ran, [], 'no fight started');
    assert.deepEqual([calls.gotos.length, calls.pvp.length, calls.attacks.length], [0, 0, 0]);
});

// ---- The lead's decision (1) after round 9 B: low health in the shelter at night ----
// self_preservation's low-health flee walked the bot 20 blocks away (moveAway), out of the shelter,
// into the night. In the shelter it now stays: the night's repair goes on (it closes the opening);
// otherwise it hits what is in reach, in place, or eats; it leaves only for fire, lava or drowning.

async function selfPreservation(agent) {
    const mode = __modeForTest('self_preservation');
    await mode.update(agent);
    for (let i = 0; i < 50 && mode.active; i++) await new Promise(resolve => setTimeout(resolve, 50));
    await flush();
    return mode;
}
const hurt = (bot) => Object.assign(bot, { health: 3, lastDamageTime: Date.now(), lastDamageTaken: 2, setControlState() {}, clearControlStates() {} });

test('decision (1): hurt in the open shelter, the bot hits the mob in reach in place instead of fleeing out', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, bot, calls, ran, self } = shelter();
    hurt(bot);
    const before = self.position.clone();
    await selfPreservation(agent);
    assert.deepEqual(ran, ['mode:self_preservation']);
    assert.deepEqual(calls.gotos, [], 'no walk (moveAway walked 20 blocks out)');
    assert.deepEqual(calls.attacks, [1, 1], 'hit in place');
    assert.ok(self.position.equals(before));
});

test('decision (1): hurt in the shelter with nothing in reach, the bot eats instead of fleeing; it never interrupts the repair', async (t) => {
    t.mock.method(console, 'log', () => {});
    const { agent, bot, calls, ran } = shelter({ zombieAt: 6 });
    hurt(bot);
    bot.food = 10;
    const bread = { name: 'bread', metadata: 0, count: 2, type: 297 };
    const eaten = [];
    bot.inventory = { items: () => (bread.count > 0 ? [bread] : []), slots: [] };
    bot.consume = () => { eaten.push(bot.heldItem?.name); bread.count--; bot.food += 5; return Promise.resolve(); };
    bot.equip = (item) => { bot.heldItem = item; return Promise.resolve(); };
    await selfPreservation(agent);
    assert.deepEqual(ran, ['mode:self_preservation']);
    assert.deepEqual(eaten, ['bread']);
    assert.deepEqual([calls.gotos.length, calls.attacks.length], [0, 0], 'no walk, no fight out of reach');

    const busy = shelter({ label: REPAIR_LABEL });
    hurt(busy.bot);
    await selfPreservation(busy.agent);
    assert.deepEqual(busy.interrupts, [], 'the repair goes on');
    assert.deepEqual(busy.calls.gotos, []);
});
