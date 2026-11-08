// Offline tests for the G3 round 2 batch A findings (skills-rotn) and the #227 review:
// 1. Threat arbitration: the lower threat modes (cowardice, self_defense) hold the threat for
//    THREAT_HOLD_MS while their action runs and never interrupt each other in that time; the
//    low-health flee (self_preservation) overrides the hold at once; the hold ends when the
//    owner's action ends or fails. No flee while dead. A stopped walk is an interrupt (use_on).
// 2. The player zombie (zombie_players:zombie_player, matched by entity type): fought only with a
//    weapon and health above half, else avoided. The walking commands refuse the death spot for
//    5 min, at dusk or night within one Minecraft day of the death, and while a player zombie is
//    there; never the bot's shelter or home; never in another dimension.
// 3. !attack refuses a mob that only fights back (ignore-unless-provoked) unless it hurt the bot.
// Fake bots and agents; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { setImmediate } from 'node:timers';
import { __setRegistryForTest } from '../utils/mcdata.js';
import './agent.js'; // the real import order (commands/index.js first)
import { __modeForTest, __resetThreatLease, THREAT_HOLD_MS, claimThreat, execute } from './modes.js';
import { threatPlan, PLAYER_ZOMBIE } from './library/threats.js';
import { DeathReporter, deathSpotBlocked, DEATH_SPOT_WAIT_MS, DEATH_SPOT_NIGHT_MS } from './library/death_report.js';
import { ActionManager } from './action_manager.js';
import { bindDamageRecord } from './damage_record.js';
import { actionsList } from './commands/actions.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);
const flush = () => new Promise(resolve => setImmediate(resolve));

let nextId = 1;
const mob = (name, x, extra = {}) => ({ id: nextId++, name, type: 'mob', position: new Vec3(x, 64, 0), height: 1.8, ...extra });
const item = (name) => ({ name, count: 1, metadata: 0, type: reg.itemsByName[name]?.id ?? 9999 });

/**
 * A bot with one zombie 3 blocks away, and fake actions: a new action interrupts the running one
 * (as ActionManager.runAction does); each interruption is recorded with how long the interrupted
 * action had run. A flee (self_preservation, cowardice) ends by itself after FLEE_MS; a fight
 * runs until interrupted.
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
        inventory: { items: () => [] },
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
        settle(now) {
            if (['mode:self_preservation', 'mode:cowardice'].includes(current?.label) && now - current.start >= FLEE_MS) {
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

async function run(t, agent, { until = 12_000, step = 250, each = () => {} } = {}) {
    t.mock.method(console, 'log', () => {});
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    for (let now = 0; now <= until; now += step) {
        t.mock.timers.setTime(now);
        each(now, agent);
        agent.settle(now);
        await flush();
        await tick(agent);
    }
    for (const name of THREAT_ORDER) __modeForTest(name).active = false;
    return agent.log;
}

const LOWER = ['mode:cowardice', 'mode:self_defense'];

test('round 2 flap: the lower threat modes never interrupt each other within THREAT_HOLD_MS', async (t) => {
    // A second zombie walks in and out of range every second: the plan flips between fighting
    // one (self_defense) and retreating from two (cowardice).
    const agent = arena();
    const second = mob('zombie', 5);
    const log = await run(t, agent, {
        each: (now, a) => {
            if (Math.floor(now / 1000) % 2) a.bot.entities[second.id] = second;
            else delete a.bot.entities[second.id];
        },
    });
    assert.equal(log.ran[0].label, 'mode:self_defense');
    const quick = log.interrupts.filter(i => LOWER.includes(i.by) && i.of !== i.by && i.after < THREAT_HOLD_MS);
    assert.deepEqual(quick, [], `interrupted within the hold: ${JSON.stringify(quick)}`);
    assert.ok(log.ran.some(r => r.label === 'mode:cowardice'), 'the retreat still comes, after the hold');
});

test('#227 review 2: the low-health flee takes over a fight at once; the fight does not take it back', async (t) => {
    const agent = arena();
    const log = await run(t, agent, {
        until: 3000,
        each: (now, a) => { if (now === 1000) Object.assign(a.bot, { lastDamageTime: now, lastDamageTaken: 3, health: 4 }); },
    });
    const flee = log.ran.find(r => r.label === 'mode:self_preservation');
    assert.equal(flee?.at, 1000, 'the flee starts at the hit, not after the fight\'s hold');
    assert.deepEqual(log.interrupts.filter(i => i.of === 'mode:self_preservation' && LOWER.includes(i.by)), []);
});

test('#227 review 3: the hold ends when the owner\'s action ends or fails', async (t) => {
    t.mock.method(console, 'log', () => {});
    __resetThreatLease();
    assert.equal(claimThreat('cowardice', 0), true);
    assert.equal(claimThreat('self_defense', 100), false, 'held while the retreat runs');
    // The retreat finds no path and ends at once (execute's action resolves): the threat is free.
    const agent = { bot: {}, actions: { currentActionLabel: '', resume_func: null, runAction: async (label, fn) => { await fn(); return { interrupted: false }; } } };
    await execute(__modeForTest('cowardice'), agent, async () => {});
    assert.equal(claimThreat('self_defense', 200), true, 'self_defense may act right away');
    // A fight that ended does not block a retreat from a creeper either.
    await execute(__modeForTest('self_defense'), agent, async () => {});
    assert.equal(claimThreat('cowardice', 300), true);
});

test('self_preservation does not flee while the bot is dead (the death hit is recent)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const agent = arena();
    for (const k of Object.keys(agent.bot.entities)) if (k !== '0') delete agent.bot.entities[k];
    Object.assign(agent.bot, { health: 0, isAlive: false, lastDamageTime: Date.now(), lastDamageTaken: 20 });
    await __modeForTest('self_preservation').update(agent);
    await flush();
    assert.deepEqual(agent.log.ran, []);
});

// G3 round 10 A: crushed at full health (20 -> 0); after the respawn (health 20 again) the fatal hit
// was still the last damage, so "damage >= health" held for 3 s: "I'm dying!" and a 20-block flee
// from the spawn point. The death clears the damage record (damage_record.js).
test('round 10 A: after a respawn the fatal hit does not make self_preservation flee; a new hit does', async (t) => {
    t.mock.method(console, 'log', () => {});
    const agent = arena();
    for (const k of Object.keys(agent.bot.entities)) if (k !== '0') delete agent.bot.entities[k];
    const bot = agent.bot;
    const handlers = {};
    bot.on = (event, fn) => { (handlers[event] ??= []).push(fn); };
    const emit = (event) => { for (const fn of handlers[event] ?? []) fn(); };
    bot.health = 20;
    bindDamageRecord(bot);
    // Crushed: 20 -> 0, then the death, then the respawn at full health.
    Object.assign(bot, { health: 0, isAlive: false }); emit('health'); emit('death');
    Object.assign(bot, { health: 20, isAlive: true }); emit('health');
    await __modeForTest('self_preservation').update(agent);
    await flush();
    assert.deepEqual(agent.log.ran, [], 'no flee at full health after the respawn');

    // A real hit after the respawn still counts: 20 -> 4.
    bot.health = 4; emit('health');
    assert.equal(bot.lastDamageTaken, 16);
    await __modeForTest('self_preservation').update(agent);
    await flush();
    assert.deepEqual(agent.log.ran.map(r => r.label), ['mode:self_preservation']);
});

function zombieBot({ x, health = 20, items = [] }) {
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0, 64, 0) };
    const z = mob(PLAYER_ZOMBIE, x);
    return { bot: { username: 'FRCFLD', health, entity: self, entities: { 0: self, [z.id]: z }, inventory: { items: () => items } }, z };
}

test('#227 review 1: the player zombie (by entity type): fight it only with a weapon and health above half', () => {
    // No weapon: avoided from the avoid range.
    let { bot, z } = zombieBot({ x: 15 });
    let plan = threatPlan(bot);
    assert.equal(plan?.action, 'flee');
    assert.equal(plan.from, z);
    assert.match(plan.why, /player zombie/);
    // A weapon but health at half: avoided.
    ({ bot } = zombieBot({ x: 3, health: 10, items: [item('stone_sword')] }));
    assert.equal(threatPlan(bot)?.action, 'flee');
    // A weapon (a crude axe counts, a pickaxe does not) and health above half: fought like a zombie.
    ({ bot } = zombieBot({ x: 3, health: 18, items: [{ name: 'pyrotech:crude_axe', count: 1 }] }));
    assert.equal(threatPlan(bot)?.action, 'fight');
    ({ bot } = zombieBot({ x: 3, health: 18, items: [item('stone_pickaxe')] }));
    assert.equal(threatPlan(bot)?.action, 'flee', 'a pickaxe is no weapon here');
    // A plain zombie at 15 blocks: nothing.
    const self = { id: 0, position: new Vec3(0, 64, 0) };
    assert.equal(threatPlan({ health: 20, entity: self, entities: { 0: self, 9: mob('zombie', 15) }, inventory: { items: () => [] } }), null);
});

const DEATH_AT = 1_000_000;
function deadAgent({ timeOfDay = 1000, entities = {}, dimension = 'overworld', memory = {}, here = 'overworld' } = {}) {
    const d = new DeathReporter();
    d.died({ pos: new Vec3(100, 70, 200), dimension, now: DEATH_AT });
    const self = { id: 0, position: new Vec3(0, 64, 0) };
    return {
        _death: d, memory_bank: { memory },
        bot: { username: 'FRCFLD', entity: self, entities: { 0: self, ...entities }, time: { timeOfDay }, game: { dimension: here } },
    };
}

test('#227 review 4: the death spot rules: a wait, a night rule that ends, the player zombie, home, dimension', () => {
    const spot = { x: 104, y: 70, z: 198 };
    const later = DEATH_AT + DEATH_SPOT_WAIT_MS;
    assert.match(deathSpotBlocked(deadAgent(), spot, { now: DEATH_AT + 60_000 }), /you died there 60 s ago .* wait 4 more min/);
    assert.equal(deathSpotBlocked(deadAgent(), spot, { now: later }), null, 'later, by day: allowed');
    assert.equal(deathSpotBlocked(deadAgent(), { x: 300, y: 70, z: 200 }, { now: DEATH_AT + 1000 }), null, 'far from the spot');
    // Night: refused within one Minecraft day of the death, allowed after (the rule ends).
    assert.match(deathSpotBlocked(deadAgent({ timeOfDay: 18000 }), spot, { now: later }), /it is night/);
    assert.equal(deathSpotBlocked(deadAgent({ timeOfDay: 18000 }), spot, { now: DEATH_AT + DEATH_SPOT_NIGHT_MS }), null);
    // A player zombie loaded near the spot: refused.
    const z = { id: 5, name: PLAYER_ZOMBIE, type: 'mob', position: new Vec3(101, 70, 201) };
    assert.match(deathSpotBlocked(deadAgent({ entities: { 5: z } }), spot, { now: later }), /player zombie/);
    // The bot's shelter or home: always allowed, even right after the death.
    assert.equal(deathSpotBlocked(deadAgent({ memory: { home: [103, 70, 199] } }), spot, { now: DEATH_AT + 1000 }), null);
    // Another dimension: not the death spot.
    assert.equal(deathSpotBlocked(deadAgent({ here: 'the_nether' }), spot, { now: DEATH_AT + 1000 }), null);
});

function commandAgent(a) {
    Object.assign(a.bot, {
        output: '', interrupt_code: false, emit() {},
        pathfinder: { goto: () => { a.walks++; return Promise.resolve(); }, setMovements() {}, stop() {}, setGoal() {} },
    });
    Object.assign(a, {
        walks: 0,
        clearBotLogs() { a.bot.output = ''; a.bot.interrupt_code = false; },
        requestInterrupt() {}, cleanKill() {}, history: { add() {} },
    });
    a.actions = new ActionManager(a);
    return a;
}

test('!goToRememberedPlace("last_death_position") right after a death does not walk', async (t) => {
    t.mock.method(console, 'log', () => {});
    const a = commandAgent(deadAgent({ memory: { last_death_position: [100, 70, 200] } }));
    a.memory_bank.recallPlace = (name) => a.memory_bank.memory[name];
    t.mock.timers.enable({ apis: ['Date'], now: DEATH_AT + 30_000 });
    const out = await actionsList.find(c => c.name === '!goToRememberedPlace').perform(a, 'last_death_position');
    assert.equal(a.walks, 0);
    assert.match(out, /Not going to 100, 70, 200: it is near where you died, and you died there 30 s ago/);
});

test('#226 review: !attack refuses a mob that only fights back unless it hurt the bot', async (t) => {
    t.mock.method(console, 'log', () => {});
    const sprite = mob('primitivemobs:grovesprite', 3);
    const self = { id: 0, position: new Vec3(0, 64, 0) };
    let attacks = 0;
    const a = commandAgent({
        bot: {
            entity: self, entities: { 0: self, [sprite.id]: sprite }, lastDamageTime: -1e9, health: 20,
            inventory: { items: () => [] }, modes: { pause() {}, unpause() {} },
            pvp: { attack: () => { attacks++; delete a.bot.entities[sprite.id]; }, stop() {} },
            nearestEntity: () => null, equip: () => Promise.resolve(), heldItem: null,
        },
    });
    const attack = actionsList.find(c => c.name === '!attack').perform;
    const out = await attack(a, 'primitivemobs:grovesprite');
    assert.equal(attacks, 0);
    assert.match(out, /Not attacking primitivemobs:grovesprite: it attacks only when hurt, and it has not hurt you\./);

    // It hit the bot (a hit right now, 3 blocks away): the bot may fight back.
    a.bot.lastDamageTime = Date.now();
    const out2 = await attack(a, 'primitivemobs:grovesprite');
    assert.equal(attacks, 1);
    assert.doesNotMatch(out2 ?? '', /Not attacking/);
});

test('#227 nit: a weapon in the off hand counts for the player zombie policy', () => {
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0, 64, 0) };
    const z = mob(PLAYER_ZOMBIE, 3);
    const slots = new Array(46).fill(null);
    slots[45] = item('stone_sword');
    const bot = { health: 18, entity: self, entities: { 0: self, [z.id]: z }, inventory: { items: () => [], slots } };
    assert.equal(threatPlan(bot)?.action, 'fight');
    slots[45] = null;
    assert.equal(threatPlan(bot)?.action, 'flee');
});

// #259 (lead, before smoke round 5): molten metal is lethal like lava. A modded fluid with
// forge.hazard 'lava' at the bot's feet makes self_preservation act, as vanilla lava does.
test('#259: molten metal at the feet makes self_preservation act, like lava; milk does not', async (t) => {
    t.mock.method(console, 'log', () => {});
    const withFluid = (name, hazard) => {
        const agent = arena();
        for (const k of Object.keys(agent.bot.entities)) if (k !== '0') delete agent.bot.entities[k];
        const id = 4410;
        const forge = { modded: true, ...(hazard ? { hazard } : {}) };
        const entry = { id, name, liquid: true, boundingBox: 'block', forge };
        agent.bot.registry = { ...reg, blocks: { ...reg.blocks, [id]: entry }, blocksByStateId: { ...reg.blocksByStateId, [id << 4]: entry } };
        agent.bot.inventory = { items: () => [], findInventoryItem: () => null }; // no water bucket
        agent.bot.blockAt = (p) => (Math.floor(p.y) === 64 ? { name, type: id, metadata: 0, position: p } : { name: 'air', type: 0, metadata: 0, position: p });
        return agent;
    };
    const molten = withFluid('contenttweaker:tin_molten', 'lava');
    await __modeForTest('self_preservation').update(molten);
    await flush();
    assert.deepEqual(molten.log.ran.map(r => r.label), ['mode:self_preservation'], 'it gets out');
    const milk = withFluid('animania:milk_holstein', null);
    await __modeForTest('self_preservation').update(milk);
    await flush();
    assert.deepEqual(milk.log.ran, [], 'milk is a liquid, not lethal');
});

// #264 review 3: a modded fire block (forge.hazard 'fire': 14 on 3.3.4) burns like vanilla fire, at
// the feet or at the head.
test('#264 review 3: a modded fire block at the feet or the head makes self_preservation act; a modded trap does not', async (t) => {
    t.mock.method(console, 'log', () => {});
    const withBlock = (name, hazard, y) => {
        const agent = arena();
        for (const k of Object.keys(agent.bot.entities)) if (k !== '0') delete agent.bot.entities[k];
        const id = 4420;
        const entry = { id, name, boundingBox: 'empty', forge: { modded: true, hazard } };
        agent.bot.registry = { ...reg, blocks: { ...reg.blocks, [id]: entry }, blocksByStateId: { ...reg.blocksByStateId, [id << 4]: entry } };
        agent.bot.inventory = { items: () => [], findInventoryItem: () => null };
        agent.bot.blockAt = (p) => (Math.floor(p.y) === y ? { name, type: id, metadata: 0, position: p } : { name: 'air', type: 0, metadata: 0, position: p });
        return agent;
    };
    for (const y of [64, 65]) { // the feet cell, the head cell
        const agent = withBlock('netherex:blue_fire', 'fire', y);
        await __modeForTest('self_preservation').update(agent);
        await flush();
        assert.deepEqual(agent.log.ran.map(r => r.label), ['mode:self_preservation'], `fire at y ${y}`);
    }
    const trap = withBlock('minetraps:spikes', 'trap', 64);
    await __modeForTest('self_preservation').update(trap);
    await flush();
    assert.deepEqual(trap.log.ran, [], 'a trap is avoided by the walks, not a burn');
});
