// Soak 10 (rotn-v0.1.16, 15:51-16:16): 53 deaths in a ring around the world spawn; each raised a
// player zombie that never leaves or burns, the bot respawned among them, and two flights (cowardice
// and the night routine's 24-block walk) cut each other off. R1-R6 (the lead's plan): one respawn
// escape job, sprinting 64 blocks from every recent death spot and the spawn square; the night
// shelter there, a hole first; the Scroll of New Life used once by skill at a far, quiet shelter.
// Offline: fake bots; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { setImmediate } from 'node:timers';
import { DeathReporter, spawnCampNote, SPAWN_CAMP } from './library/death_report.js';
import { ESCAPE_RUN, ESCAPE_PAUSES, escapeReason, respawnEscapeTick, escapeRun, aimPoint, placeDistance, escapedRecently, escapeMovements,
    SCROLL, scrollRefusal, useSpawnScroll, isSpawnScroll } from './respawn_escape.js';
import { placesToLeave } from './respawn_relocate.js';
import { replanHold } from './library/night.js';
import * as skills from './library/skills.js';

// The soak 10 world spawn and a few of its 53 death spots (x -39..-84, z -48..-86).
const SPAWN = new Vec3(-58, 64, -62);
const DEATHS = [[-43, 63, -62], [-76, 60, -54], [-49, 63, -69], [-63, 64, -48], [-45, 65, -67], [-58, 61, -60]];
const flush = () => new Promise(r => setImmediate(r));
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const zombie = (id, x, z) => ({ id, type: 'mob', name: 'zombie_players:zombie_player', position: new Vec3(x, 64, z) });

/** An agent that died at each death spot (the last `lastAgo` ms ago) and stands at `here`. */
function agentAt(here, { deaths = DEATHS, now = 1_000_000, lastAgo = 10_000, entities = {}, food = 20, items = [] } = {}) {
    const d = new DeathReporter();
    deaths.forEach(([x, y, z], i) => { d.died({ pos: new Vec3(x, y, z), dimension: 'overworld', now: now - lastAgo - (deaths.length - 1 - i) * 20_000 }); d.pending = null; });
    const self = { id: 0, type: 'player', position: here.clone() };
    const paused = new Set(), events = [];
    const agent = {
        _death: d,
        bot: { entity: self, entities: { 0: self, ...entities }, spawnPoint: SPAWN.clone(), game: { dimension: 'overworld' }, health: 20, food,
            time: { timeOfDay: 1000 }, inventory: { items: () => items },
            modes: { pause: (m) => { paused.add(m); events.push(`pause ${m}`); }, unpause: (m) => { paused.delete(m); events.push(`unpause ${m}`); }, anyActive: () => true } },
        self_prompter: { active: true, isActive() { return this.active; }, stop() { this.active = false; events.push('stop'); } },
        actions: { runs: [], runAction(label, fn) { this.runs.push(label); return Promise.resolve(fn()).then(() => ({ interrupted: false })); } },
        paused, events,
    };
    return agent;
}
const SOAK10_ZOMBIES = () => Object.fromEntries(DEATHS.map(([x, , z], i) => [i + 1, zombie(i + 1, x + 0.5, z + 0.5)]));

test('soak 10 (R1): the spawn square: a death spot by its point, the spawn by its nearest point (spawnRadius 10)', () => {
    assert.deepEqual([ESCAPE_RUN.away, ESCAPE_RUN.spawnRadius, ESCAPE_RUN.trigger, ESCAPE_RUN.maxMs], [64, 10, 48, 60_000]);
    const spawn = { pos: SPAWN, what: 'spawn' };
    assert.equal(placeDistance(SPAWN.offset(5, 0, 5), spawn), 0, 'inside the square');
    assert.equal(placeDistance(SPAWN.offset(15, 0, 0), spawn), 5);
    assert.equal(placeDistance(SPAWN.offset(13, 0, 14), spawn), 5);
    assert.equal(placeDistance(SPAWN.offset(3, 0, 4), { pos: SPAWN, what: 'death spot' }), 5);
});

test('soak 10 (R1): right after a respawn among the death spots and player zombies, at any time of day: an escape; not when far, late or dead', () => {
    const now = 1_000_000;
    const ringed = agentAt(SPAWN.offset(2, 0, 3), { now, entities: SOAK10_ZOMBIES() });
    const why = escapeReason(ringed, now);
    assert.ok(why, 'right after the respawn');
    assert.deepEqual(why.places.map(p => p.what), ['spawn', ...DEATHS.map(() => 'death spot')]);
    ringed.bot.time.timeOfDay = 18000; // night: the same
    assert.ok(escapeReason(ringed, now));
    // A player zombie at the spawn, no death spot near (deaths far away): still.
    const z = agentAt(SPAWN.offset(2, 0, 3), { now, deaths: [[400, 64, 400]], entities: { 9: zombie(9, SPAWN.x + 4, SPAWN.z) } });
    assert.ok(escapeReason(z, now));
    // Neither near: none.
    assert.equal(escapeReason(agentAt(SPAWN.offset(2, 0, 3), { now, deaths: [[400, 64, 400]] }), now), null);
    // 64 from all of them already: none.
    assert.equal(escapeReason(agentAt(SPAWN.offset(-90, 0, -60), { now }), now), null);
    // More than afterDeathMs after the death: none (the day relocate's case).
    assert.equal(escapeReason(agentAt(SPAWN.offset(2, 0, 3), { now, lastAgo: ESCAPE_RUN.afterDeathMs + 1 }), now), null);
    // Still dead (before the respawn): none.
    const dead = agentAt(SPAWN.offset(2, 0, 3), { now });
    dead.bot.health = 0;
    assert.equal(escapeReason(dead, now), null);
});

test('soak 10 (R1): the aim is away from the weighted centre of the death spots, the spawn square and the hostiles near', () => {
    const now = 1_000_000;
    // East of the ring, a zombie close on the west: west is never the way.
    const a = agentAt(new Vec3(-30, 64, -60), { now, entities: { 9: zombie(9, -33, -60) } });
    const t = aimPoint(a.bot, placesToLeave(a, now));
    assert.ok(t.x > -30, `east: ${JSON.stringify(t)}`);
    assert.ok(Math.abs(hdist(t, a.bot.entity.position) - ESCAPE_RUN.ahead) < 1.5);
    // A zombie alone, straight north of the bot: it steers south.
    const north = agentAt(new Vec3(100, 64, 100), { now, deaths: [], entities: { 9: zombie(9, 100, 97) } });
    const s = aimPoint(north.bot, [], Object.values(north.bot.entities).filter(e => e.id === 9));
    assert.ok(s.z > 100 && Math.abs(s.x - 100) <= 1, JSON.stringify(s));
    // Nothing pulls (no places, no hostiles): away from the spawn, else +x.
    assert.deepEqual(aimPoint(north.bot, [], []), { x: 100 + ESCAPE_RUN.ahead, z: 100 });
});

test('soak 10 (R1): the run re-aims every second and ends 64 blocks from every place; capped at 60 s; a stop ends it', async () => {
    const now0 = 1_000_000;
    const a = agentAt(SPAWN.offset(2, 0, 3), { now: now0, entities: SOAK10_ZOMBIES() });
    const places = placesToLeave(a, now0);
    let clock = 0;
    const aims = [];
    // 5 blocks a second toward the goal (a sprint is about 5.6).
    const setGoal = (bot, x, z) => { aims.push({ x, z }); bot._goal = { x, z }; };
    const sleep = (ms) => {
        clock += ms;
        const g = a.bot._goal, p = a.bot.entity.position;
        if (g) { const d = Math.hypot(g.x - p.x, g.z - p.z), step = Math.min(d, 5 * ms / 1000); if (d > 0) a.bot.entity.position = p.offset((g.x - p.x) / d * step, 0, (g.z - p.z) / d * step); }
        return Promise.resolve();
    };
    const r = await escapeRun(a.bot, places, { now: () => clock, sleep, setGoal });
    assert.equal(r.arrived, true, JSON.stringify(r));
    for (const p of places) assert.ok(placeDistance(a.bot.entity.position, p) >= ESCAPE_RUN.away - 0.01, `${p.what} at ${placeDistance(a.bot.entity.position, p)}`);
    assert.ok(r.ms < ESCAPE_RUN.maxMs && aims.length >= Math.floor(r.ms / ESCAPE_RUN.aimMs), `${aims.length} aims in ${r.ms} ms`);
    // Never moving: the cap.
    const stuck = agentAt(SPAWN.offset(2, 0, 3), { now: now0 });
    let c2 = 0;
    const r2 = await escapeRun(stuck.bot, placesToLeave(stuck, now0), { now: () => c2, sleep: (ms) => { c2 += ms; return Promise.resolve(); }, setGoal: () => {} });
    assert.deepEqual([r2.arrived, r2.stopped, r2.ms], [false, 'time', ESCAPE_RUN.maxMs]);
    // A stop (the drowning reflex): it ends.
    const stop = agentAt(SPAWN.offset(2, 0, 3), { now: now0 });
    let c3 = 0;
    const r3 = await escapeRun(stop.bot, placesToLeave(stop, now0), { now: () => c3, sleep: (ms) => { c3 += ms; stop.bot.interrupt_code = c3 >= 1000; return Promise.resolve(); }, setGoal: () => {} });
    assert.equal(r3.stopped, 'interrupted');
});

test('soak 10 (R1): the escape\'s movements never dig, tower, scaffold or jump gaps', () => {
    const m = escapeMovements({ registry: minecraftData('1.12.2'), version: '1.12.2' });
    assert.deepEqual([m.canDig, m.allow1by1towers, m.allowParkour, m.scafoldingBlocks.length], [false, false, false, 0]);
});

test('soak 10 (R1): the tick: one job owns the bot (cowardice, self_defense, unstuck, pickups paused; self_preservation not), sprinting; the model stops; then all back', async () => {
    const now = 1_000_000;
    const a = agentAt(SPAWN.offset(2, 0, 3), { now, entities: SOAK10_ZOMBIES() });
    const logs = [];
    let release;
    const run = (bot, places) => new Promise(res => { release = () => { bot.entity.position = new Vec3(SPAWN.x + 90, 64, SPAWN.z); res({ arrived: true, far: 70, ms: 12_000 }); }; });
    assert.equal(respawnEscapeTick(a, { now, run, log: (l) => logs.push(l) }), 'escaping');
    assert.match(logs[0], /^\[respawn\] escape \(try 1 of 3\): sprinting at least 64 blocks from the spawn and 6 recent death spots, 6 player zombies near; no digging, no pickups, no fights$/);
    for (const m of ['cowardice', 'self_defense', 'unstuck', 'item_collecting', 'hunting', 'eating']) assert.ok(a.paused.has(m), m);
    assert.ok(!ESCAPE_PAUSES.includes('self_preservation'));
    assert.deepEqual([a.bot.rotnSprint, a.bot.rotnEscaping, a.self_prompter.active, a._agenda_paused], [true, true, false, true]);
    await flush();
    assert.deepEqual(a.actions.runs, ['action:respawnEscape']);
    assert.equal(respawnEscapeTick(a, { now: now + 500, run, log: (l) => logs.push(l) }), 'escaping', 'while it runs');
    assert.equal(replanHold(a, now + 500), 'the respawn escape is running', 'the model\'s re-plan waits');
    release();
    await flush(); await flush();
    assert.equal(a.paused.size, 0, 'every mode back');
    assert.deepEqual([a.bot.rotnSprint, a.bot.rotnEscaping], [false, false]);
    assert.match(logs.at(-1), /^\[respawn\] escape done: \d+ blocks from the spawn and 6 recent death spots at .* in 12 s$/);
    assert.equal(escapedRecently(a, Date.now()), true);
    assert.equal(respawnEscapeTick(a, { now: now + 1000, run, log: () => {} }), null, 'done for this death');
    // Food 6: at a walk.
    const hungry = agentAt(SPAWN.offset(2, 0, 3), { now, food: 6 });
    const hl = [];
    respawnEscapeTick(hungry, { now, run: () => new Promise(() => {}), log: (l) => hl.push(l) });
    assert.equal(hungry.bot.rotnSprint, false);
    assert.match(hl[0], /walking \(food 6\)/);
});

test('soak 10 (R1): an escape a reflex cut short runs again, at most ESCAPE_RUN.tries times for one death', async () => {
    const now = 1_000_000;
    const a = agentAt(SPAWN.offset(2, 0, 3), { now });
    const logs = [];
    const run = () => Promise.resolve({ arrived: false, far: 20, ms: 3000, stopped: 'interrupted' });
    for (let i = 1; i <= ESCAPE_RUN.tries; i++) {
        assert.equal(respawnEscapeTick(a, { now: now + i, run, log: (l) => logs.push(l) }), 'escaping', `try ${i}`);
        await flush(); await flush();
    }
    assert.equal(respawnEscapeTick(a, { now: now + 10, run, log: (l) => logs.push(l) }), null, 'no fourth');
    assert.match(logs.find(l => /was interrupted/.test(l)), /running it again$/);
});

test('soak 10 (R6): the Scroll of New Life: used only at least 100 blocks from the spawn square and every death spot, with no hostile near', () => {
    const now = 1_000_000;
    const scroll = { name: 'lifescroll:spawnscroll', count: 1 };
    assert.equal(isSpawnScroll(scroll), true);
    assert.equal(SCROLL.away, 100);
    const far = agentAt(new Vec3(150, 64, -62), { now, items: [scroll] });
    assert.equal(scrollRefusal(far, new Vec3(150, 64, -62)), null);
    const near = agentAt(SPAWN.offset(70, 0, 0), { now, items: [scroll] });
    assert.match(scrollRefusal(near, SPAWN.offset(70, 0, 0)), /blocks from the (spawn|death spot at .*) \(it needs 100\)/);
    const mob = agentAt(new Vec3(150, 64, -62), { now, items: [scroll], entities: { 9: zombie(9, 155, -62) } });
    assert.match(scrollRefusal(mob, new Vec3(150, 64, -62)), /zombie_players:zombie_player is within 16 blocks/);
    assert.equal(scrollRefusal(agentAt(new Vec3(150, 64, -62), { now }), new Vec3(150, 64, -62)), 'no scroll held');
});

test('soak 10 (R6): useSpawnScroll right-clicks it once, by skill (the guard lets it through), and holds the item it held before', async () => {
    const scroll = { name: 'lifescroll:spawnscroll', count: 1 };
    const club = { name: 'spartanweaponry:club_wood', count: 1 };
    const items = [scroll, club];
    const seen = [];
    const bot = { heldItem: club, inventory: { items: () => items.filter(i => i.count > 0) },
        equip: (i) => { bot.heldItem = i; return Promise.resolve(); },
        activateItem: () => { seen.push(bot.rotnScrollBySkill); if (bot.heldItem === scroll) scroll.count--; } };
    assert.deepEqual(await useSpawnScroll(bot, { waitMs: 300 }), { used: true });
    assert.deepEqual(seen, [true]);
    assert.equal(bot.rotnScrollBySkill, false);
    assert.equal(bot.heldItem, club, 'the club back in hand');
    assert.deepEqual(await useSpawnScroll(bot, { waitMs: 100 }), { used: false, why: 'no scroll held' });
});

test('soak 10 (R6): the model never uses the scroll: !consume and !useOn are refused with why; the skill is let through', async (t) => {
    t.mock.method(console, 'log', () => {});
    const scroll = { name: 'lifescroll:spawnscroll', count: 1, type: 9000, metadata: 0 };
    let consumed = 0;
    const bot = { output: '', inventory: { items: () => [scroll], slots: [null, scroll] }, game: { gameMode: 'survival' }, equip: () => Promise.resolve(), consume: () => { consumed++; return Promise.resolve(); }, food: 20 };
    assert.equal(await skills.consume(bot, 'lifescroll:spawnscroll'), false);
    assert.match(bot.output, /Not using the Scroll of New Life \(lifescroll:spawnscroll\): it sets your respawn point where you stand and does not teleport\..*never use it yourself\./);
    assert.equal(consumed, 0);
    bot.output = '';
    assert.equal(await skills.useToolOn(bot, 'lifescroll:spawnscroll', 'nothing'), false);
    assert.match(bot.output, /Not using the Scroll of New Life/);
    assert.equal(skills.spawnScrollRefused({ rotnScrollBySkill: true }, scroll), false, 'the night routine\'s own use');
});

test('soak 10 (R5): the death note says the spawn is camped after 2 deaths near it within 10 min, and that the scroll is never the model\'s', () => {
    const now = 1_000_000;
    assert.deepEqual(SPAWN_CAMP, { deaths: 2, withinMs: 600_000, range: 48 });
    const camped = agentAt(SPAWN.offset(2, 0, 3), { now, items: [{ name: 'lifescroll:spawnscroll', count: 1 }] });
    const note = spawnCampNote(camped, now);
    assert.match(note, /You keep dying near the spawn: a player zombie stands where you died, never leaves and never burns.*sprinting at least 64 blocks/);
    assert.match(note, /Never use the lifescroll:spawnscroll yourself: it sets your respawn point where you stand \(it does not teleport\)/);
    assert.equal(spawnCampNote(agentAt(SPAWN.offset(2, 0, 3), { now, deaths: [[-43, 63, -62]] }), now), '', 'one death, no scroll: nothing');
});

// Soak 10 (R5): cowardice's flee said "Moved 32 away from enemies." even when the bot was caught, and its
// movements could dig ("Found destructive path" while fleeing).
test('soak 10 (R5): the flee never digs, and its line says how far it really got', async (t) => {
    t.mock.method(console, 'log', () => {});
    const z = { id: 1, type: 'mob', name: 'zombie', position: new Vec3(3, 64, 0) };
    let looks = 0;
    const moves = [];
    const bot = { registry: minecraftData('1.12.2'), version: '1.12.2', output: '', interrupt_code: false,
        entity: { position: new Vec3(0, 64, 0) }, entities: { 1: z },
        modes: { pause() {}, unpause() {} },
        nearestEntity: (pred) => (looks++ < 2 && pred(z) ? z : null), // gone after the first round; the bot never moved
        pathfinder: { setMovements: (m) => moves.push(m), setGoal() {}, isMoving: () => true, stop() {} } };
    assert.equal(await skills.avoidEnemies(bot, 16, (e) => e.name === 'zombie'), true);
    assert.equal(moves[0].canDig, false, 'no digging while fleeing');
    assert.match(bot.output, /Moved away from enemies, but only to 3 blocks of the 16\./);
    assert.doesNotMatch(bot.output, /Moved 16 away/);
});
