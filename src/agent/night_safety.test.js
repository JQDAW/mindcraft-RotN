// Soak 3 (rotn-v0.1.5), night 1: six deaths in 3.5 min after respawns. Offline tests for the night
// safety rules: the re-plan prompt waits for the night routine; the item-pickup reflex leaves items
// near a recent death spot or with a hostile mob near. Fake agents and bots; no server, no LLM.
// (Own file: modes.js keeps the last re-plan prompt time per process.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../utils/mcdata.js';
import { requestReplan, replanPromptDue, hasReplan, QUIET_MS } from './replan.js';
import { initModes, __modeForTest } from './modes.js';
import { nightRoutineActive } from './library/night.js';
import { itemPickupRefusal, pickupNearbyItems, ITEM_PICKUP, COLLECT_LIMITS } from './library/skills.js';
import { DEATH_SPOT_RADIUS } from './library/death_report.js';

__setRegistryForTest(minecraftData('1.12.2'));
const quiet = { log: () => {} };

test('soak 3: nightRoutineActive is the routine\'s state: anything but day (the dawn gap included)', () => {
    assert.equal(nightRoutineActive({}), false, 'no routine state yet');
    assert.equal(nightRoutineActive({ _night: { state: 'day' } }), false);
    for (const state of ['building', 'inside', 'exposed']) assert.equal(nightRoutineActive({ _night: { state } }), true, state);
});

test('soak 3: replanPromptDue holds the prompt while the night routine runs', () => {
    const agent = {};
    requestReplan(agent, 'death', null, { now: 100_000, due: true, note: 'You died.', ...quiet });
    const base = { idle: true, reflexActive: false, selfPrompting: false, lastPromptAt: 0, now: 200_000 };
    assert.equal(replanPromptDue(agent, { ...base, nightRoutine: true }), false);
    assert.equal(replanPromptDue(agent, base), true, 'once it ends, the prompt goes');
});

function fakeAgent() {
    const calls = { handleMessage: [] };
    return {
        name: 'FRCFLD', calls, bot: {}, task: null,
        prompter: { getInitModes: () => ({}) },
        actions: { currentActionLabel: '', resume_func: null, runAction: async (label, fn) => { await fn(); return { message: 'ok', interrupted: false }; } },
        self_prompter: { isActive: () => false, stopLoop() {} },
        handleMessage: (...args) => { calls.handleMessage.push(args); return Promise.resolve(true); },
        cleanKill() {},
        isIdle: () => true,
    };
}

test('soak 3: the death re-plan prompt waits (logged once) while the night routine runs, and goes at full day', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    const agent = fakeAgent();
    initModes(agent);
    for (const name of ['self_preservation', 'unstuck', 'cowardice', 'self_defense', 'hunting', 'item_collecting', 'torch_placing', 'elbow_room', 'idle_staring']) {
        agent.bot.modes.setOn(name, false);
    }
    agent._night = { state: 'building' };
    requestReplan(agent, 'death', 'mode:self_preservation', { now: Date.now() - QUIET_MS - 1, due: true, note: 'You died at -60, 60, -66 and respawned.', ...quiet });
    await agent.bot.modes.update();
    await agent.bot.modes.update();
    assert.equal(agent.calls.handleMessage.length, 0, 'no model prompt while the routine runs');
    assert.equal(hasReplan(agent), true, 'the request is kept');
    assert.equal(lines.filter(l => l.startsWith('[reflex] re-plan prompt held: the night routine is running')).length, 1, 'said once');
    agent._night.state = 'inside';
    await agent.bot.modes.update();
    assert.equal(agent.calls.handleMessage.length, 0, 'in the shelter: still held');
    agent._night.state = 'day';
    await agent.bot.modes.update();
    assert.equal(agent.calls.handleMessage.length, 1, 'full day: the prompt goes');
    assert.match(agent.calls.handleMessage[0][1], /You died at -60, 60, -66 and respawned\./);
});

const here = new Vec3(-45, 64, -60);
function itemBot({ deathSpots = [], entities = {}, dimension = 'overworld' } = {}) {
    const bot = {
        entity: { position: here },
        game: { dimension },
        entities,
        rotnDeathSpots: () => deathSpots,
        output: '',
        interrupt_code: false,
    };
    bot.nearestEntity = (match) => Object.values(bot.entities).filter(e => e !== bot.entity && match(e))
        .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))[0] ?? null;
    return bot;
}
const item = (id, pos) => ({ id, name: 'item', type: 'object', position: pos });

test('soak 3: itemPickupRefusal: items near a recent death spot or with a hostile mob near are left alone', () => {
    const now = 1_000_000;
    const at = item(1, new Vec3(-50, 60, -66)); // 20:01:19: the dropped items at the death spot
    const spot = { pos: new Vec3(-54, 60, -66), at: now - 60_000, dimension: 'overworld' };
    assert.match(itemPickupRefusal(itemBot({ deathSpots: [spot] }), at, now), new RegExp(`^within ${DEATH_SPOT_RADIUS} blocks of where you died recently`));
    assert.equal(itemPickupRefusal(itemBot({ deathSpots: [{ ...spot, at: now - COLLECT_LIMITS.deathSpotMs }] }), at, now), null, 'an older death spot no longer counts');
    assert.equal(itemPickupRefusal(itemBot({ deathSpots: [{ ...spot, dimension: 'the_nether' }] }), at, now), null, 'another dimension');
    const far = item(2, new Vec3(spot.pos.x + DEATH_SPOT_RADIUS + 1, 60, spot.pos.z));
    assert.equal(itemPickupRefusal(itemBot({ deathSpots: [spot] }), far, now), null, 'outside the radius (horizontal)');
    // Hostile mobs: near the item, or near the bot.
    const zp = { id: 7, type: 'mob', name: 'zombie_players:zombie_player', position: new Vec3(-51, 60, -66) };
    assert.match(itemPickupRefusal(itemBot({ entities: { 7: zp } }), at, now), new RegExp(`^a zombie_players:zombie_player is within ${ITEM_PICKUP.hostileRange} blocks$`));
    const byBot = { id: 8, type: 'mob', name: 'zombie', position: here.offset(3, 0, 0) };
    const awayItem = item(3, here.offset(-6, 0, -20));
    assert.match(itemPickupRefusal(itemBot({ entities: { 8: byBot } }), awayItem, now), /^a zombie is within/);
    // Not hostile: a scent marker, a soul, a sheep, a bull (ignore-unless-provoked).
    const harmless = {
        1: { id: 11, type: 'mob', name: 'zombieawareness:entityscent', position: here },
        2: { id: 12, type: 'mob', name: 'randomthings:playersoul', position: at.position },
        3: { id: 13, type: 'mob', name: 'sheep', position: at.position.offset(1, 0, 0) },
        4: { id: 14, type: 'mob', name: 'animania:bull_holstein', position: at.position.offset(2, 0, 0) },
    };
    assert.equal(itemPickupRefusal(itemBot({ entities: harmless }), at, now), null);
    const farZombie = { id: 9, type: 'mob', name: 'zombie', position: new Vec3(-50 + ITEM_PICKUP.hostileRange + 1, 60, -100) };
    assert.equal(itemPickupRefusal(itemBot({ entities: { 9: farZombie } }), at, now), null, 'beyond hostileRange of the item and of the bot');
});

test('soak 3: pickupNearbyItems walks to no item its allow refuses', async (t) => {
    t.mock.method(console, 'log', () => {});
    const at = item(1, here.offset(2, 0, 0));
    const bot = itemBot({ entities: { 1: at } });
    bot.blockAt = () => ({ name: 'grass', boundingBox: 'block' });
    let walks = 0;
    bot.pathfinder = { setMovements() {}, getPathTo() { walks++; return { status: 'noPath' }; }, goto() { walks++; return Promise.resolve(); }, stop() {} };
    await pickupNearbyItems(bot, { allow: () => false });
    assert.equal(walks, 0);
    assert.match(bot.output, /Picked up 0 items\./);
});

test('soak 3: the item-pickup reflex leaves the items at a recent death spot alone (one log line per item)', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    const mode = __modeForTest('item_collecting');
    const at = item(41, new Vec3(-50, 60, -66));
    const bot = itemBot({ entities: { 41: at }, deathSpots: [{ pos: new Vec3(-54, 60, -66), at: Date.now() - 60_000, dimension: 'overworld' }] });
    bot.entity.position = new Vec3(-46, 60, -66);
    bot.inventory = { emptySlotCount: () => 30 };
    let ran = 0;
    const agent = { bot, actions: { runAction: () => { ran++; return Promise.resolve({}); } } };
    mode.noticed_at = -1;
    await mode.update(agent);
    await mode.update(agent);
    assert.equal(mode.noticed_at, -1, 'never noticed');
    assert.equal(ran, 0, 'no pickup started');
    assert.deepEqual(lines.filter(l => l.startsWith('[reflex] item pickup:')),
        [`[reflex] item pickup: leaving the item at -50, 60, -66 alone: within ${DEATH_SPOT_RADIUS} blocks of where you died recently (a player zombie rises there and never leaves)`]);
});
