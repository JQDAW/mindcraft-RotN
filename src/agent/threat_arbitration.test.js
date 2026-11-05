// Offline tests for the G3 round 2 batch A findings (skills-rotn):
// 1. self_preservation and self_defense interrupted each other while a mob attacked; the flee
//    threw "PathStopped". Now one threat mode owns the threat for THREAT_HOLD_MS, and a stopped
//    walk is an interrupt, not an exception.
// 2. The bot walked back to its death spot, where a zombie carrying its name killed it again.
//    Now that mob is a strong threat (flee), and the walking commands refuse the death spot too
//    soon, at dusk or night, or while such a mob is there.
// Fake bots and agents; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { setImmediate } from 'node:timers';
import { __setRegistryForTest } from '../utils/mcdata.js';
import './agent.js'; // the real import order (commands/index.js first)
import { __modeForTest, __resetThreatLease, THREAT_HOLD_MS } from './modes.js';
import { threatPlan, namedAfter } from './library/threats.js';
import { DeathReporter, deathSpotBlocked, DEATH_SPOT_WAIT_MS } from './library/death_report.js';
import { ActionManager } from './action_manager.js';
import { actionsList } from './commands/actions.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const flush = () => new Promise(resolve => setImmediate(resolve));

let nextId = 1;
const mob = (name, x, extra = {}) => ({ id: nextId++, name, type: 'mob', position: new Vec3(x, 64, 0), height: 1.8, ...extra });

/**
 * A bot with one zombie 3 blocks away, and fake actions: a new action interrupts the running one
 * (as ActionManager.runAction does); each interruption is recorded with how long the interrupted
 * action had run. The flee (self_preservation) ends by itself after FLEE_MS; a fight runs until
 * interrupted.
 */
const FLEE_MS = 1000;
function arena() {
    __resetThreatLease();
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0, 64, 0), height: 1.8 };
    const zombie = mob('zombie', 3);
    const bot = {
        username: 'FRCFLD', entity: self, entities: { 0: self, [zombie.id]: zombie },
        registry: reg, version: '1.12.2', health: 20, isAlive: true, lastDamageTime: -1e9, lastDamageTaken: 0,
        blockAt: () => null, clearControlStates() {}, setControlState() {},
        pathfinder: { goal: null, getPathFromTo: function* () { yield { result: { status: 'success', path: [] } }; } },
        modes: { behavior_log: '' },
        nearestEntity: () => null,
    };
    const log = { ran: [], interrupts: [] };
    let current = null;
    const agent = {
        bot, log, shut_up: true, openChat() {}, isIdle: () => !current,
        actions: {
            resume_func: null,
            get currentActionLabel() { return current?.label ?? ''; },
            runAction(label) {
                const now = Date.now();
                if (current) {
                    log.interrupts.push({ of: current.label, by: label, after: now - current.start });
                    current.resolve({ message: '', interrupted: true });
                }
                log.ran.push({ label, at: now });
                return new Promise(resolve => { current = { label, start: now, resolve }; });
            },
        },
        // the test's clock: the flee ends by itself after FLEE_MS
        settle(now) {
            if (current?.label === 'mode:self_preservation' && now - current.start >= FLEE_MS) {
                const c = current; current = null; c.resolve({ message: '', interrupted: false });
            }
        },
    };
    return agent;
}

// The threat modes, in ModeController's order and with its rule: skip an active mode; stop at
// the first active one.
const THREAT_ORDER = ['self_preservation', 'cowardice', 'self_defense'];
async function tick(agent) {
    for (const name of THREAT_ORDER) {
        const mode = __modeForTest(name);
        if (!mode.active) await mode.update(agent);
        await flush();
        if (mode.active) break;
    }
}

async function fight(t, { until = 12_000, step = 250, hits = [1000, 5000, 9000] } = {}) {
    t.mock.method(console, 'log', () => {});
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    const agent = arena();
    for (let now = 0; now <= until; now += step) {
        t.mock.timers.setTime(now);
        if (hits.includes(now)) { agent.bot.lastDamageTime = now; agent.bot.lastDamageTaken = 3; agent.bot.health = 4; }
        agent.settle(now);
        await flush();
        await tick(agent);
    }
    for (const name of THREAT_ORDER) __modeForTest(name).active = false;
    return agent.log;
}

test('round 2 flap: no threat mode interrupts another within THREAT_HOLD_MS of its start', async (t) => {
    const log = await fight(t);
    assert.equal(log.ran[0].label, 'mode:self_defense', 'the fight starts');
    const quick = log.interrupts.filter(i => i.of !== i.by && i.after < THREAT_HOLD_MS);
    assert.deepEqual(quick, [], `interrupted within the hold: ${JSON.stringify(quick)}`);
    // the low-health flee still takes over, once the fight's hold is over
    const flee = log.ran.find(r => r.label === 'mode:self_preservation');
    assert.ok(flee && flee.at >= THREAT_HOLD_MS, `the flee started at ${flee?.at}`);
    // and the fight does not take it back while the flee renews its hold
    const after = log.ran.filter(r => r.at > flee.at).map(r => r.label);
    assert.ok(!after.includes('mode:self_defense'), `after the flee: ${after.join(', ')}`);
});

test('self_preservation does not flee while the bot is dead (the death hit is recent)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const agent = arena();
    delete agent.bot.entities[Object.keys(agent.bot.entities).find(k => k !== '0')];
    Object.assign(agent.bot, { health: 0, isAlive: false, lastDamageTime: Date.now(), lastDamageTaken: 20 });
    await __modeForTest('self_preservation').update(agent);
    await flush();
    assert.deepEqual(agent.log.ran, []);
});

test('a mob carrying the bot\'s name is a strong threat: flee, from farther than a fight', () => {
    __resetThreatLease();
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0, 64, 0) };
    const risen = mob('zombie', 15, { metadata: { 2: 'FRCFLD' } });
    const bot = { username: 'FRCFLD', entity: self, entities: { 0: self, [risen.id]: risen } };
    const plan = threatPlan(bot);
    assert.equal(plan?.action, 'flee');
    assert.match(plan.why, /carries your name/);
    assert.equal(plan.from, risen);
    assert.equal(namedAfter(self, 'FRCFLD'), false, 'never the bot itself');
    assert.equal(namedAfter({ type: 'player', username: 'FRCFLD' }, 'FRCFLD'), false);
    assert.equal(namedAfter(mob('zombie', 1, { customName: 'Zombie FRCFLD' }), 'FRCFLD'), true);
    assert.equal(threatPlan({ ...bot, entities: { 0: self, 99: mob('zombie', 15) } }), null, 'a plain zombie at 15 blocks: nothing');
});

function deadAgent({ timeOfDay = 1000, entities = {} } = {}) {
    const d = new DeathReporter();
    d.died({ pos: new Vec3(100, 70, 200), now: 1_000_000 });
    const self = { id: 0, position: new Vec3(0, 64, 0) };
    return { _death: d, bot: { username: 'FRCFLD', entity: self, entities: { 0: self, ...entities }, time: { timeOfDay } } };
}

test('the death spot: refused right after the death, at night, and while a mob carrying the bot\'s name is there', () => {
    const spot = { x: 104, y: 70, z: 198 };
    const a = deadAgent();
    assert.match(deathSpotBlocked(a, spot, { now: 1_000_000 + 60_000 }), /you died there 60 s ago .* wait 4 more min/);
    assert.equal(deathSpotBlocked(a, spot, { now: 1_000_000 + DEATH_SPOT_WAIT_MS }), null, 'later, by day: allowed');
    assert.equal(deathSpotBlocked(a, { x: 300, y: 70, z: 200 }, { now: 1_000_000 + 1000 }), null, 'far from the spot: allowed');
    assert.match(deathSpotBlocked(deadAgent({ timeOfDay: 18000 }), spot, { now: 1_000_000 + DEATH_SPOT_WAIT_MS }), /it is night/);
    const risen = { id: 5, name: 'zombie', type: 'mob', position: new Vec3(101, 70, 201), metadata: { 2: 'FRCFLD' } };
    assert.match(deathSpotBlocked(deadAgent({ entities: { 5: risen } }), spot, { now: 1_000_000 + DEATH_SPOT_WAIT_MS }), /carrying your name/);
});

test('!goToRememberedPlace("last_death_position") right after a death does not walk', async (t) => {
    t.mock.method(console, 'log', () => {});
    const a = deadAgent();
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 + 30_000 });
    let walks = 0;
    Object.assign(a.bot, {
        output: '', interrupt_code: false, emit() {},
        pathfinder: { goto: () => { walks++; return Promise.resolve(); }, setMovements() {}, stop() {}, setGoal() {} },
    });
    Object.assign(a, {
        memory_bank: { recallPlace: (name) => (name === 'last_death_position' ? [100, 70, 200] : null) },
        clearBotLogs() { a.bot.output = ''; a.bot.interrupt_code = false; },
        requestInterrupt() {}, cleanKill() {}, history: { add() {} },
    });
    a.actions = new ActionManager(a);
    const out = await actionsList.find(c => c.name === '!goToRememberedPlace').perform(a, 'last_death_position');
    assert.equal(walks, 0);
    assert.match(out, /Not going to 100, 70, 200: it is near where you died, and you died there 30 s ago/);
});
