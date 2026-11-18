// Soak 3 (rotn-v0.1.5), night 1: six deaths in 3.5 min after respawns. Offline tests for the night
// safety rules: the re-plan prompt waits for the night routine; the item-pickup reflex leaves items
// near a recent death spot or with a hostile mob near. Fake agents and bots; no server, no LLM.
// (Own file: modes.js keeps the last re-plan prompt time per process.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../utils/mcdata.js';
import settings from './settings.js';
import { requestReplan, replanPromptDue, hasReplan, QUIET_MS } from './replan.js';
import { initModes, __modeForTest } from './modes.js';
import { nightRoutineActive, replanHold, NIGHT_START, TICKS_PER_MIN } from './library/night.js';
import { ActionManager } from './action_manager.js';
import { itemPickupRefusal, pickupNearbyItems, ITEM_PICKUP, COLLECT_LIMITS } from './library/skills.js';
import { DEATH_SPOT_RADIUS } from './library/death_report.js';

__setRegistryForTest(minecraftData('1.12.2'));
const quiet = { log: () => {} };

test('soak 3: nightRoutineActive is the routine\'s state: anything but day (the dawn gap included)', () => {
    assert.equal(nightRoutineActive({}), false, 'no routine state yet');
    assert.equal(nightRoutineActive({ _night: { state: 'day' } }), false);
    for (const state of ['building', 'inside', 'exposed']) assert.equal(nightRoutineActive({ _night: { state } }), true, state);
});

test('#463 nit 3: with the night routine off (night_shelter false) the clock does not hold the prompt', (t) => {
    const before = settings.night_shelter;
    t.after(() => { settings.night_shelter = before; });
    const dark = { _night: { state: 'day' }, bot: { time: { timeOfDay: NIGHT_START + 100 } } };
    assert.equal(replanHold(dark), 'it is not full day yet');
    settings.night_shelter = false;
    assert.equal(replanHold(dark), null);
});

test('soak 3: replanPromptDue holds the prompt while held (night.replanHold)', () => {
    const agent = {};
    requestReplan(agent, 'death', null, { now: 100_000, due: true, note: 'You died.', ...quiet });
    const base = { idle: true, reflexActive: false, selfPrompting: false, lastPromptAt: 0, now: 200_000 };
    assert.equal(replanPromptDue(agent, { ...base, held: 'the night routine is running' }), false);
    assert.equal(replanPromptDue(agent, base), true, 'once nothing holds it, the prompt goes');
});

test('#463 review 3: replanHold: the routine running, or not full day yet (the dawn gap, dusk, night); full day: none', () => {
    const at = (timeOfDay, state = 'day') => ({ _night: { state }, bot: { time: { timeOfDay } } });
    assert.equal(replanHold(at(1000, 'inside')), 'the night routine is running');
    assert.equal(replanHold(at(23500)), 'it is not full day yet', 'the dawn gap with the routine done (a death after it ended)');
    assert.equal(replanHold(at(NIGHT_START + 100)), 'it is not full day yet', 'night, routine not started');
    assert.equal(replanHold(at(NIGHT_START - 2 * TICKS_PER_MIN)), 'it is not full day yet', 'dusk');
    assert.equal(replanHold(at(1000)), null, 'full day');
    assert.equal(replanHold({ bot: {} }), null, 'no time known, no routine: nothing holds it');
    // The routine's clock first (its wall-clock fallback when the server time is stuck).
    const clocked = { _night: { state: 'day', clock: { timeOfDay: () => 23700 } }, bot: { time: { timeOfDay: 1000 } } };
    assert.equal(replanHold(clocked), 'it is not full day yet');
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

test('#463 review 2: the item-pickup reflex: 40 items over several ticks; only those within 8 blocks are judged; one line per refused item; the lines\' map is pruned when an item is gone', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    const mode = __modeForTest('item_collecting');
    mode.refusedSaid.clear();
    mode.noticed_at = -1;
    const bot = itemBot({ deathSpots: [{ pos: new Vec3(-54, 60, -66), at: Date.now() - 60_000, dimension: 'overworld' }] });
    bot.entity.position = new Vec3(-46, 60, -66);
    bot.inventory = { emptySlotCount: () => 30 };
    // 20 within 8 blocks of the bot, 20 beyond 8: all within 24 of the death spot.
    for (let i = 0; i < 40; i++) {
        const near = i < 20;
        const j = i % 20;
        bot.entities[100 + i] = item(100 + i, new Vec3(-46 - (near ? 0 : 9) - (j % 5), 60, -68 + Math.floor(j / 5)));
    }
    const judged = new Set();
    const spots = bot.rotnDeathSpots;
    let current = null;
    bot.rotnDeathSpots = (...a) => { judged.add(current); return spots(...a); };
    const nearest = bot.nearestEntity;
    bot.nearestEntity = (match) => nearest((e) => { current = e.id; return match(e); });
    let ran = 0;
    const agent = { bot, actions: { runAction: () => { ran++; return Promise.resolve({}); } } };
    for (let tick = 0; tick < 5; tick++) await mode.update(agent);
    const said = lines.filter(l => l.startsWith('[reflex] item pickup:'));
    assert.equal(said.length, 20, 'one line per refused item, over 5 ticks');
    assert.equal(new Set(said).size, 20);
    assert.ok(said.every(l => / alone: within 24 blocks of where you died recently/.test(l)));
    assert.ok([...judged].every(id => id < 120), 'no item beyond 8 blocks was judged');
    assert.equal(mode.refusedSaid.size, 20);
    assert.equal(mode.noticed_at, -1, 'never noticed');
    assert.equal(ran, 0, 'no pickup started');
    // Ten of them are gone (picked up by someone, despawned): their entries go on the next tick.
    for (let i = 0; i < 10; i++) delete bot.entities[100 + i];
    await mode.update(agent);
    assert.equal(mode.refusedSaid.size, 10);
    assert.equal(lines.filter(l => l.startsWith('[reflex] item pickup:')).length, 20, 'no line said again');
    // A backstop: an entry older than saidKeptMs goes even if its item is still there.
    for (const id of mode.refusedSaid.keys()) mode.refusedSaid.set(id, Date.now() - ITEM_PICKUP.saidKeptMs - 1);
    bot.entities = {};
    await mode.update(agent);
    assert.equal(mode.refusedSaid.size, 0);
});

test('#463 nit: an animal provoked by a hit (threatPlan) keeps the pickup off too', () => {
    const now = 2_000_000;
    const at = item(1, here.offset(3, 0, 0));
    const bull = { id: 5, type: 'mob', name: 'animania:bull_holstein', position: here.offset(1.5, 0, 0) };
    const calm = itemBot({ entities: { 5: bull } });
    assert.equal(itemPickupRefusal(calm, at, now), null, 'a calm bull: no refusal (it is not hostile)');
    const hit = itemBot({ entities: { 5: bull } });
    Object.assign(hit, { lastDamageTime: now - 1000, lastDamageTaken: 5 });
    assert.equal(itemPickupRefusal(hit, at, now), 'a animania:bull_holstein near fights back after a hit (provoked)');
    const later = itemBot({ entities: { 5: bull } });
    Object.assign(later, { lastDamageTime: now - 10_000, lastDamageTaken: 5 });
    assert.equal(itemPickupRefusal(later, at, now), null, 'the hit was long ago');
});
