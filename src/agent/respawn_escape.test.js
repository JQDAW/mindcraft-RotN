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
import { ESCAPE_RUN, ESCAPE_PAUSES, escapeReason, respawnEscapeTick, escapeRun, aimPoint, placeDistance, escapedRecently, escapeMovements, hostilesNear,
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
    // #581 review 6: a new goal only when the direction turned (each goal resets the path and the sprint).
    assert.ok(r.ms < ESCAPE_RUN.maxMs && aims.length >= 1 && aims.length < Math.floor(r.ms / ESCAPE_RUN.aimMs), `${aims.length} goals in ${r.ms} ms`);
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
    assert.match(logs[0], /^\[respawn\] escape \(try 1 of 3\): sprinting at least 64 blocks from the spawn and 6 recent death spots, 6 player zombies near; no digging unless walled in, no pickups, no fights unless cornered$/);
    await flush();
    assert.deepEqual(a.actions.runs, ['action:respawnEscape']);
    // #581 re-review 1: paused once the escape action runs (not before runAction).
    for (const m of ['cowardice', 'self_defense', 'unstuck', 'item_collecting', 'hunting', 'eating']) assert.ok(a.paused.has(m), m);
    assert.ok(!ESCAPE_PAUSES.includes('self_preservation'));
    assert.deepEqual([a.bot.rotnSprint, a.bot.rotnEscaping, a.self_prompter.active, a._agenda_paused], [true, true, false, true]);
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
    hungry.bot.rotnSprint = true; // set by an earlier reflex
    respawnEscapeTick(hungry, { now, run: () => new Promise(() => {}), log: (l) => hl.push(l) });
    await flush();
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
    assert.deepEqual(await useSpawnScroll(bot, { waitMs: 300 }), { used: true, by: 'the stack shrank', tries: 1 });
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

// #581 review 1: the escape waits while self_preservation acts (a swim-up, a low-health move away),
// and neither that interrupt nor a death counts as a try.
test('#581 review 1: self_preservation acting: the escape waits (no try); interrupted by it: no try; a death ends it without "running it again"', async () => {
    const now = 1_000_000;
    const a = agentAt(SPAWN.offset(2, 0, 3), { now });
    let active = true;
    a.bot.modes.isActive = (m) => m === 'self_preservation' && active;
    assert.equal(respawnEscapeTick(a, { now, run: () => Promise.resolve({ arrived: true, ms: 1 }), log: () => {} }), 'escaping:wait');
    assert.equal(a._escape.tries, 0);
    active = false;
    const logs = [];
    const cut = () => { a.rotnLastInterrupt = { by: 'self_preservation', of: 'action:respawnEscape', at: now }; return Promise.resolve({ arrived: false, far: 10, ms: 1000, stopped: 'interrupted' }); };
    for (let i = 0; i < 5; i++) {
        assert.equal(respawnEscapeTick(a, { now: now + i, run: cut, log: (l) => logs.push(l) }), 'escaping', `run ${i + 1}: never out of tries`);
        await flush(); await flush();
    }
    assert.equal(a._escape.tries, 0, logs.join('\n'));
    assert.match(logs.at(-1), /was interrupted by self_preservation at \d+ blocks .*; running it again$/);
    // A death during the run: no "running it again" for the old death.
    const d = agentAt(SPAWN.offset(2, 0, 3), { now });
    const dl = [];
    const dies = (bot) => { d._death.died({ pos: SPAWN.offset(1, 0, 1), dimension: 'overworld', now: now + 5000 }); d._death.pending = null; return Promise.resolve({ arrived: false, far: 3, ms: 5000, stopped: 'interrupted' }); };
    respawnEscapeTick(d, { now, run: dies, log: (l) => dl.push(l) });
    await flush(); await flush();
    assert.match(dl.at(-1), /^\[respawn\] the escape ended with a death at \d+ blocks/);
});

// #581 review 2: the guard missed name variants.
test('#581 review 2: the scroll guard catches name variants and the slot the name would equip', async (t) => {
    t.mock.method(console, 'log', () => {});
    const scroll = { name: 'lifescroll:spawnscroll', count: 1, type: 9000, metadata: 0 };
    let activated = 0;
    const bot = { output: '', inventory: { items: () => [scroll], slots: [null, scroll] }, game: { gameMode: 'survival' }, equip: () => Promise.resolve(), activateItem: () => { activated++; } };
    for (const name of ['lifescroll:spawnscroll:0', 'LIFESCROLL:SPAWNSCROLL', 'Lifescroll:Spawnscroll', 'lifescroll:spawnscroll ', 'spawnscroll']) {
        bot.output = '';
        assert.equal(await skills.useToolOn(bot, name, 'nothing'), false, name);
        assert.match(bot.output, /Not using the Scroll of New Life/, name);
    }
    assert.equal(activated, 0);
});

// #581 review 3: R2 only after an escape that got there; after one that fell short, the full night walk.
test('#581 review 3: escapedRecently only when the escape arrived or the bot is 64 away; else escapeFellShort', async () => {
    const { escapeFellShort } = await import('./respawn_escape.js');
    const now = Date.now();
    const short = agentAt(SPAWN.offset(2, 0, 3), { now });
    short._escape = { endedAt: now, arrived: false };
    assert.equal(escapedRecently(short, now), false);
    assert.equal(escapeFellShort(short, now), true);
    short._escape.arrived = true;
    assert.equal(escapedRecently(short, now), true);
    const far = agentAt(SPAWN.offset(120, 0, 0), { now });
    far._escape = { endedAt: now, arrived: false };
    assert.equal(escapedRecently(far, now), true, 'timed out, but 64 away from every place');
    assert.equal(escapeFellShort(far, now), false);
});

// #581 review 4: a task giver's goal is paused for the escape (it was skipped), then resumed.
test('#581 review 4: a task giver\'s goal is paused (kept) for the escape and resumed after; a command is refused while it runs', async () => {
    const now = 1_000_000;
    const a = agentAt(SPAWN.offset(2, 0, 3), { now });
    const sp = { state: 'active', prompt: 'build a hut', goal_by: 'giver', starts: [], loops: 0,
        isActive() { return this.state === 'active'; }, isPaused() { return this.state === 'paused'; },
        setPromptPaused(p) { this.prompt = p; this.state = 'paused'; }, stopLoop() { this.loops++; return Promise.resolve(); },
        start(p) { this.state = 'active'; this.starts.push(p); }, stop() { this.state = 'stopped'; } };
    a.self_prompter = sp;
    let release;
    respawnEscapeTick(a, { now, run: () => new Promise(res => { release = () => res({ arrived: true, ms: 1000 }); }), log: () => {} });
    assert.deepEqual([sp.state, sp.prompt, sp.loops], ['paused', 'build a hut', 1]);
    const { getCommand } = await import('./commands/index.js');
    const out = await getCommand('!moveAway').perform(a, 10);
    assert.match(out, /^Not now: the respawn escape is running/);
    release();
    await flush(); await flush();
    assert.deepEqual(sp.starts, ['build a hut'], 'the giver\'s goal again');
    // #581 re-review nit 5: also while the escape is due but waiting (self_preservation acting).
    const due = agentAt(SPAWN.offset(2, 0, 3), { now: Date.now() });
    due.bot.modes.isActive = (m) => m === 'self_preservation';
    assert.equal(respawnEscapeTick(due, { now: Date.now(), log: () => {} }), 'escaping:wait');
    assert.equal(due._escape.due, true);
    assert.match(await getCommand('!moveAway').perform(due, 10), /^Not now: the respawn escape is running/);
});

// #581 review 5: animals (mcdata's isHostile counted every 'mob') neither steer the aim nor block the scroll.
test('#581 review 5: a cow or a villager is no hostile; a zombie and a player zombie are', () => {
    const a = agentAt(new Vec3(0, 64, 0), { deaths: [], entities: {
        1: { id: 1, type: 'mob', name: 'animania:cow_holstein', position: new Vec3(3, 64, 0) },
        2: { id: 2, type: 'mob', name: 'villager', position: new Vec3(0, 64, 3) },
        3: { id: 3, type: 'mob', name: 'zombie', position: new Vec3(-3, 64, 0) },
        4: zombie(4, 0, -3) } });
    assert.deepEqual(hostilesNear(a.bot).map(e => e.id).sort(), [3, 4]);
});

// #581 review 7: the movements from before the run come back, and a food drop during it ends the sprint.
test('#581 review 7: the run restores the movements it replaced, and stops sprinting when food falls to 6', async () => {
    const now0 = 1_000_000;
    const a = agentAt(SPAWN.offset(2, 0, 3), { now: now0 });
    Object.assign(a.bot, { registry: minecraftData('1.12.2'), version: '1.12.2', rotnSprint: true });
    const before = { name: 'before', allowSprinting: false };
    const sets = [];
    a.bot.pathfinder = { movements: before, setMovements(m) { this.movements = m; sets.push(m === before ? 'before' : 'escape'); }, setGoal() {} };
    let clock = 0;
    const r = await escapeRun(a.bot, placesToLeave(a, now0), { now: () => clock, sleep: (ms) => { clock += ms; if (clock >= 2000) a.bot.food = 5; return Promise.resolve(); } });
    assert.equal(r.stopped, 'time');
    assert.deepEqual(sets, ['escape', 'before']);
    assert.equal(a.bot.rotnSprint, false, 'food 5: no sprint');
});

// #581 nit 11: the day relocate still runs from the priority stack once an escape timed out.
test('#581 nit 11: after a timed-out escape, autonomyTick runs the relocate walk', async () => {
    const { autonomyTick } = await import('./priority.js');
    const now = 1_000_000;
    const a = agentAt(SPAWN.offset(2, 0, 3), { now });
    a.bot.modes.anyActive = () => false;
    a._escape = { forDeath: a._death.last.at, done: true, tries: 1, job: null, endedAt: now, arrived: false };
    a.agenda = { get active() { return true; } };
    a.tasks = { current: () => null, get: () => null };
    a.actions.runAction = () => new Promise(() => {});
    assert.equal(autonomyTick(a, { now }), 'relocating');
});

/**
 * #581 re-review 1 and 2: the real ActionManager, ModeController and update loop (the reviewer's
 * race.mjs). An agent whose bot respawned near the spawn, with a running cowardice flee that notices
 * an interrupt within 500 ms (avoidEnemies polls every 500 ms).
 */
async function realAgent() {
    const { ActionManager } = await import('./action_manager.js');
    const { initModes } = await import('./modes.js');
    const now = Date.now();
    const d = new DeathReporter();
    d.died({ pos: new Vec3(-50, 64, -60), dimension: 'overworld', now: now - 10_000 }); d.pending = null;
    const self = { id: 0, type: 'player', position: new Vec3(-56, 64, -60) };
    const bot = { entity: self, entities: { 0: self }, spawnPoint: SPAWN.clone(), game: { dimension: 'overworld' }, health: 20, food: 20, oxygenLevel: 20,
        interrupt_code: false, output: '', inventory: { items: () => [], slots: [] }, blockAt: () => ({ name: 'air' }),
        pathfinder: { goal: null, stop() {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, emit() {} };
    const agent = { bot, _death: d, task: null, prompter: { getInitModes: () => ({}) }, self_prompter: { isActive: () => false },
        requestInterrupt() { bot.interrupt_code = true; }, clearBotLogs() { bot.output = ''; bot.interrupt_code = false; },
        isIdle() { return !this.actions.executing; }, cleanKill() {}, handleMessage: () => Promise.resolve(true) };
    agent.actions = new ActionManager(agent);
    initModes(agent);
    return agent;
}

test('#581 re-review 1: over a running cowardice flee, with the real action manager and modes, every pause holds when the escape run begins', { timeout: 60_000 }, async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const { __modeForTest } = await import('./modes.js');
    const { runUpdateLoop } = await import('./update_loop.js');
    for (const offset of [0, 150, 300, 450]) {
        const agent = await realAgent();
        const bot = agent.bot;
        const flee = agent.actions.runAction('mode:cowardice', async () => { while (!bot.interrupt_code) await new Promise(r => setTimeout(r, 500)); });
        let pausedAtStart = null, stop = false, ticked = false;
        const t0 = Date.now();
        const loop = runUpdateLoop(async () => {
            await bot.modes.update();
            await new Promise(r => setTimeout(r, 2));
            if (!ticked && Date.now() - t0 >= 100 + offset) {
                ticked = true;
                respawnEscapeTick(agent, { run: () => { pausedAtStart = ['cowardice', 'self_defense', 'unstuck', 'eating'].map(m => __modeForTest(m).paused); return Promise.resolve({ arrived: true, ms: 1 }); }, log: () => {} });
            }
        }, { interval: 300, shouldStop: () => stop });
        await flee;
        await new Promise(r => setTimeout(r, 1200));
        stop = true;
        await loop;
        assert.deepEqual(pausedAtStart, [true, true, true, true], `offset ${offset} ms`);
    }
});

test('#581 re-review 2: a real self_preservation swim-up over a running escape is no try; a zombie and a hit during the run do not cut it', { timeout: 60_000 }, async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const agent = await realAgent();
    const bot = agent.bot;
    const logs = [];
    let release = null;
    // The run: until released or stopped.
    const run = () => new Promise(res => {
        release = () => res({ arrived: true, ms: 5000 });
        const poll = setInterval(() => { if (bot.interrupt_code) { clearInterval(poll); res({ arrived: false, ms: 2000, stopped: 'interrupted' }); } }, 50);
    });
    assert.equal(respawnEscapeTick(agent, { run, log: (l) => logs.push(l) }), 'escaping');
    await new Promise(r => setTimeout(r, 50));
    assert.equal(agent.actions.currentActionLabel, 'action:respawnEscape');
    // A zombie at 2 blocks and a hit (20 to 14): cowardice and self_defense are paused; nothing cuts the run.
    bot.entities[5] = { id: 5, type: 'mob', name: 'zombie', position: bot.entity.position.offset(2, 0, 0), height: 1.95 };
    bot.health = 14;
    await bot.modes.update();
    await new Promise(r => setTimeout(r, 100));
    assert.equal(agent.actions.currentActionLabel, 'action:respawnEscape', 'still escaping after the hit');
    // Under water, out of air, a walk going: the real self_preservation swims up (it interrupts the escape).
    let wet = true;
    bot.blockAt = () => ({ name: wet ? 'water' : 'air' });
    bot.oxygenLevel = 4;
    bot.pathfinder.goal = {};
    setTimeout(() => { wet = false; }, 300);
    await bot.modes.update();
    for (let i = 0; i < 60 && agent._escape.job; i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(agent._escape.job, null, logs.join('\n'));
    assert.equal(agent._escape.tries, 0, `a self_preservation interrupt is no try: ${logs.join(' | ')}`);
    assert.match(logs.at(-1), /was interrupted by self_preservation/);
    void release;
});

// #581 follow-up 1: autonomyTick returns held:<kind> before respawnEscapeTick, so a giver's !stop or
// !pause during the escape window left agent._escape.due true, and every typed command under the hold
// was refused for hours. The flag holds commands only while fresh (dueUntil).
test('#581 follow-up 1: a due flag no tick refreshed (a control hold) stops holding commands after ESCAPE_RUN.dueFreshMs; under a hold, typed commands run', async () => {
    const { getCommand } = await import('./commands/index.js');
    const { autonomyTick } = await import('./priority.js');
    assert.equal(ESCAPE_RUN.dueFreshMs, 2000);
    const now = Date.now();
    const a = agentAt(SPAWN.offset(2, 0, 3), { now });
    a.bot.modes.isActive = (m) => m === 'self_preservation';
    assert.equal(respawnEscapeTick(a, { now, log: () => {} }), 'escaping:wait');
    assert.ok(a._escape.due && a._escape.dueUntil > Date.now(), 'fresh: due');
    // #583 nit 1: the tick sets dueUntil about dueFreshMs ahead.
    assert.ok(Math.abs(a._escape.dueUntil - Date.now() - ESCAPE_RUN.dueFreshMs) < 200, `${a._escape.dueUntil - Date.now()} ms ahead`);
    a.actions.runAction = () => Promise.resolve({ message: 'ran', interrupted: false });
    assert.match(await getCommand('!moveAway').perform(a, 10), /^Not now: the respawn escape is running/);
    // A giver's !stop: the priority stack holds, no escape tick refreshes the flag.
    a.control = { blocking: () => 'stop', typed: 0 };
    a.agenda = { get active() { return true; } };
    a.tasks = { current: () => null, get: () => null };
    assert.equal(autonomyTick(a, { now }), 'held:stop');
    a._escape.dueUntil = Date.now() - 1; // ESCAPE_RUN.dueFreshMs later
    assert.equal(a._escape.due, true, 'the flag itself is still set');
    assert.equal(await getCommand('!moveAway').perform(a, 10), 'ran', 'a typed command under the hold runs');
});

// #581 follow-up 2 (re-review nit 3): a stale record of an earlier escape's stopper is cleared at the
// job's start, so a later run a !stop ends is a try again.
test('#581 follow-up 2: a stale self_preservation record from an earlier escape does not make the next interrupted run free', async () => {
    const now = 1_000_000;
    const a = agentAt(SPAWN.offset(2, 0, 3), { now });
    a.rotnLastInterrupt = { by: 'self_preservation', of: 'action:respawnEscape', at: now - 60_000 };
    const logs = [];
    respawnEscapeTick(a, { now, run: () => Promise.resolve({ arrived: false, far: 10, ms: 1000, stopped: 'interrupted' }), log: (l) => logs.push(l) });
    assert.equal(a.rotnLastInterrupt, null, 'cleared at the start');
    await flush(); await flush();
    assert.equal(a._escape.tries, 1, 'counted');
    assert.match(logs.at(-1), /was interrupted at \d+ blocks/);
    assert.doesNotMatch(logs.at(-1), /by self_preservation/);
});

// #581 follow-up 3 (re-review nit 5): between tries (the run cut short, the next not started yet),
// commands are still held.
test('#581 follow-up 3: in the gap between tries, before the next tick, a command is refused', async () => {
    const { getCommand } = await import('./commands/index.js');
    const now = Date.now();
    const a = agentAt(SPAWN.offset(2, 0, 3), { now });
    let ran = 0;
    // A run longer than ESCAPE_RUN.dueFreshMs: the flag the starting tick set has expired when it ends.
    const run = () => new Promise(res => setTimeout(() => { a._escape.dueUntil = Date.now() - 1; res({ arrived: false, far: 10, ms: 2500, stopped: 'interrupted' }); }, 20));
    respawnEscapeTick(a, { now, run, log: () => {} });
    for (let i = 0; i < 40 && a._escape.job; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(a._escape.job, null, 'the run ended');
    assert.equal(a._escape.tries, 1);
    // #583 nit 1: refreshed at the run's end, about dueFreshMs ahead (the test set it to the past during the run).
    assert.ok(Math.abs(a._escape.dueUntil - Date.now() - ESCAPE_RUN.dueFreshMs) < 300, `${a._escape.dueUntil - Date.now()} ms ahead`);
    a.actions.runAction = () => { ran++; return Promise.resolve({ message: 'ran', interrupted: false }); };
    assert.match(await getCommand('!moveAway').perform(a, 10), /^Not now: the respawn escape is running/);
    assert.equal(ran, 0);
});

// Soak 11 (F1): 21:31:58 the scroll was used in the same second as an eat; the server log has no
// lifescroll line (the use never reached it), and the skill said only "no answer from the server".
const scrollBot = ({ answer = 'shrink', onTry = 1, eating = false, chatLine = 'Your spawnpoint is now 55, 76, -27!', position = 'system', scrolls = 1 } = {}) => {
    const scroll = { name: 'lifescroll:spawnscroll', count: scrolls, slot: 37 };
    const club = { name: 'spartanweaponry:club_wood', count: 1, slot: 36 };
    const items = [scroll, club];
    const listeners = new Set();
    const bot = { heldItem: club, usingHeldItem: eating, uses: [], inventory: { items: () => items.filter(i => i.count > 0) },
        equip: (i) => { bot.heldItem = i; return Promise.resolve(); },
        on: (ev, f) => { if (ev === 'messagestr') listeners.add(f); },
        removeListener: (ev, f) => listeners.delete(f),
        say: (line, pos) => listeners.forEach(f => f(line, pos)),
        activateItem: () => {
            bot.uses.push({ eating: bot.usingHeldItem, held: bot.heldItem?.name });
            if (bot.uses.length < onTry) return;
            if (answer === 'shrink') scroll.count--;
            else if (answer === 'chat') setTimeout(() => bot.say(chatLine, position), 5);
            else if (answer === 'both') { bot.say(chatLine, position); scroll.count--; }
        } };
    return { bot, scroll, club, listeners };
};

test('soak 11 (F1): the scroll waits until an eat is over (and 1 s after it), then is used; seen by the shrink; still eating after the wait: not used', async () => {
    const { bot } = scrollBot({ eating: true });
    setTimeout(() => { bot.usingHeldItem = false; bot.rotnAteAt = Date.now(); }, 60);
    const r = await useSpawnScroll(bot, { waitMs: 300, afterEatMs: 100, settleMs: 2000, step: 10 });
    assert.deepEqual(r, { used: true, by: 'the stack shrank', tries: 1 });
    assert.deepEqual(bot.uses, [{ eating: false, held: 'lifescroll:spawnscroll' }], 'never used while eating');
    // #587 nit 2: still eating when settleMs is up: not used now (the next shelter tries again).
    const busy = scrollBot({ eating: true });
    assert.deepEqual(await useSpawnScroll(busy.bot, { waitMs: 50, settleMs: 40, step: 10 }), { used: false, why: 'still eating after 40 ms' });
    assert.deepEqual(busy.bot.uses, []);
});

// #587 review 1: "<griefer> your spawnpoint is now 0, 0, 0" counted as the scroll's use, with the scroll still held.
test('#587 review 1: only a shrinking stack counts; a player\'s chat, a whisper, or the server\'s own line alone never does (the server\'s line is a hint in the journal)', async () => {
    const player = scrollBot({ answer: 'chat', chatLine: '<griefer> your spawnpoint is now 0, 0, 0', position: 'chat' });
    const p = await useSpawnScroll(player.bot, { waitMs: 50, step: 10 });
    assert.equal(p.used, false);
    assert.equal(player.scroll.count, 1);
    const whisper = scrollBot({ answer: 'chat', chatLine: 'griefer whispers to you: Your spawnpoint is now 0, 0, 0!', position: 'system' });
    assert.equal((await useSpawnScroll(whisper.bot, { waitMs: 50, step: 10 })).used, false);
    // The server's exact line, but no shrink: not used; the journal says the server answered, and no retry.
    const sys = scrollBot({ answer: 'chat' });
    const r = await useSpawnScroll(sys.bot, { waitMs: 50, step: 10 });
    assert.equal(r.used, false);
    assert.match(r.why, /^the scroll was not used up \(try 1: the stack did not shrink in 50 ms \(held lifescroll:spawnscroll in slot 37\); no try 2: the server answered try 1; the server said "Your spawnpoint is now 55, 76, -27!"; other chat seen \(player text, quoted\): none\)$/);
    assert.equal(sys.bot.uses.length, 1);
    // A shrink with the server's line: used, and both said.
    const both = scrollBot({ answer: 'both' });
    assert.deepEqual(await useSpawnScroll(both.bot, { waitMs: 50, step: 10 }), { used: true, by: 'the stack shrank and the server said so', tries: 1 });
    assert.equal(both.listeners.size, 0, 'the listener is removed');
});

test('soak 11 (F1): a first try with no answer gets one retry (one scroll held; never with two); a throw or a stop ends that try', async () => {
    const retry = scrollBot({ onTry: 2 });
    assert.deepEqual(await useSpawnScroll(retry.bot, { waitMs: 50, step: 10 }), { used: true, by: 'the stack shrank', tries: 2 });
    assert.equal(retry.bot.uses.length, 2);
    assert.equal(retry.bot.heldItem, retry.club, 'the club back in hand');
    // #587 nit 5: two scrolls held: no retry (a late answer to try 1 would spend a second one).
    const two = scrollBot({ onTry: 2, scrolls: 2 });
    const t2 = await useSpawnScroll(two.bot, { waitMs: 50, step: 10 });
    assert.equal(t2.used, false);
    assert.equal(two.bot.uses.length, 1);
    assert.match(t2.why, /no try 2: 2 scrolls held \(a late answer could spend two\)/);
    // #587 nit 3: an equip that throws ends try 1 only.
    const thrown = scrollBot({ onTry: 1 });
    let equips = 0;
    const equip = thrown.bot.equip;
    thrown.bot.equip = (i, w) => (++equips === 1 ? Promise.reject(new Error('window click refused')) : equip(i, w));
    assert.deepEqual(await useSpawnScroll(thrown.bot, { waitMs: 50, step: 10 }), { used: true, by: 'the stack shrank', tries: 2 });
    // #587 nit 4: a stop during the wait ends it.
    const stop = scrollBot({ onTry: 9 });
    setTimeout(() => { stop.bot.interrupt_code = true; }, 20);
    const started = Date.now();
    const s = await useSpawnScroll(stop.bot, { waitMs: 5000, step: 10 });
    assert.ok(Date.now() - started < 1000, 'not the whole 5 s');
    assert.match(s.why, /try 1: stopped/);
});

test('soak 11 (F1): no answer on both tries, or the scroll not in hand: the reason says which, with the chat seen', async () => {
    const none = scrollBot({ onTry: 9 });
    none.bot.on = (ev, f) => { if (ev === 'messagestr') setTimeout(() => f('[Server] hello', 'chat'), 5); };
    const r = await useSpawnScroll(none.bot, { waitMs: 50, step: 10 });
    assert.equal(r.used, false);
    assert.equal(r.why, 'the scroll was not used up (try 1: the stack did not shrink in 50 ms (held lifescroll:spawnscroll in slot 37); try 2: the stack did not shrink in 50 ms (held lifescroll:spawnscroll in slot 37); other chat seen (player text, quoted): "[Server] hello")');
    const hand = scrollBot();
    hand.bot.equip = () => Promise.resolve(); // the equip does not take
    const h = await useSpawnScroll(hand.bot, { waitMs: 50, step: 10 });
    assert.deepEqual(hand.bot.uses, [], 'never right-clicked with the club in hand');
    assert.match(h.why, /^the scroll was not used up \(try 1: the scroll was not in hand \(held spartanweaponry:club_wood\); try 2: the scroll was not in hand/);
});

// ---- Soak 12 (rotn-v0.1.18): the death loop at the scroll's respawn point (-70, 65, 87) ----
// Death 1 (15:11) was 158 blocks from the scroll's respawn point: no death spot near, no escape; the bot
// stood there 3.5 min until a zombie came. Then 15 deaths within 3 blocks of it: the spot was the night-2
// hole shelter's cell, the escape never digs (0 to 2 blocks out), self_preservation's low-health flee
// interrupted 8 runs, and each death started a new "try 1 of 3".
import { LOOP, loopAt, breakLoop, preArm, respawnPoint } from './respawn_escape.js';

const RESPAWN = new Vec3(-70, 65, 87);
const NIGHT_T = 15000;
const zmb = (id, p) => ({ id, type: 'mob', name: 'zombie', position: p, height: 1.95 });
/** The tick with every world-facing step stubbed: the run, the way-out check, the dig-out, the breaker, the pre-arm. */
const stubs = (over = {}) => {
    const s = { runs: [], digs: [], breaks: 0, logs: [] };
    s.opts = { log: (l) => s.logs.push(l), run: (bot, places) => { s.runs.push(places.map(p => p.what)); return Promise.resolve({ arrived: true, ms: 1 }); },
        walkable: () => new Vec3(0, 0, 0), dig: (bot, from) => { s.digs.push(from); return Promise.resolve({ to: null, dug: 0, why: 'stub' }); },
        breaker: () => { s.breaks++; return Promise.resolve({ broke: 'fought', why: 'no step' }); }, arm: () => Promise.resolve(false), ...over };
    return s;
};

test('soak 12 (B(ii) step 1): at night, a fresh respawn with a hostile within 16 escapes from the respawn point (no death spot near); by day, or with nothing near, not', async () => {
    const now = 1_000_000;
    const a = agentAt(RESPAWN.offset(0.5, 0, 0.5), { deaths: [[16, 64, -46]], now, lastAgo: 6_000 });
    a.bot.time.timeOfDay = NIGHT_T;
    const s = stubs();
    assert.equal(respawnEscapeTick(a, { now, ...s.opts }), null, 'nothing near yet');
    assert.ok(respawnPoint(a, a._death.last.at)?.equals(RESPAWN), 'the respawn point is noted');
    a.bot.entities[9] = zmb(9, RESPAWN.offset(6, 0, 3));
    assert.equal(respawnEscapeTick(a, { now: now + 1000, ...s.opts }), 'escaping');
    await flush(); await flush();
    assert.deepEqual(s.runs, [['spawn', 'death spot', 'respawn point']]);
    assert.match(s.logs[0], /^\[respawn\] escape \(try 1 of 3\): sprinting at least 64 blocks from the spawn and the respawn point and 1 recent death spot;/);
    // By day: the same zombie is no reason (soak 10's rule as before).
    const day = agentAt(RESPAWN.offset(0.5, 0, 0.5), { deaths: [[16, 64, -46]], now, lastAgo: 6_000, entities: { 9: zmb(9, RESPAWN.offset(6, 0, 3)) } });
    assert.equal(respawnEscapeTick(day, { now, ...stubs().opts }), null);
});

test('soak 12 (B(ii) step 2): a respawn spot with no walkable way out is dug out of first (bounded), then the run; no dig-out: the loop breaker, no try used', async () => {
    const now = 1_000_000;
    const mk = () => { const a = agentAt(RESPAWN.offset(0.5, 0, 0.5), { deaths: [[16, 64, -46]], now, lastAgo: 6_000, entities: { 9: zmb(9, RESPAWN.offset(2, 2, 0)) } }); a.bot.time.timeOfDay = NIGHT_T; return a; };
    const ok = mk();
    const s = stubs({ walkable: () => null, dig: (bot, from, opts) => { s.digs.push(opts); return Promise.resolve({ to: RESPAWN.offset(3, 2, 0), dug: 4 }); } });
    respawnEscapeTick(ok, { now, ...s.opts });
    await flush(); await flush();
    assert.equal(s.digs.length, 1);
    assert.equal(s.digs[0].maxBlocks, 6);
    assert.equal(s.digs[0].hostiles.length, 1, 'away from the zombie');
    assert.ok(s.logs.includes('[respawn] dug out of the enclosed respawn spot at -70, 65, 87: 4 blocks, now at -67, 67, 87'), s.logs.join('\n'));
    assert.equal(s.runs.length, 1, 'then the run');
    const shut = mk();
    const t = stubs({ walkable: () => null });
    respawnEscapeTick(shut, { now, ...t.opts });
    await flush(); await flush();
    assert.equal(t.runs.length, 0);
    assert.equal(shut._escape.tries, 0, 'no try used');
    assert.ok(t.logs.some(l => /no walkable way out of .* and no dig-out \(stub\)/.test(l)), t.logs.join('\n'));
    respawnEscapeTick(shut, { now: now + 500, ...t.opts });
    await flush(); await flush();
    assert.equal(t.breaks, 1, 'the loop breaker');
    assert.equal(shut._escape.done, true);
    assert.equal(respawnEscapeTick(shut, { now: now + 1000, ...t.opts }), null, 'done for this death');
});

test('soak 12 (B(ii) step 5): 2 deaths within 8 blocks of the same respawn point within 5 min: no more runs from it; the loop breaker, said once', async () => {
    assert.deepEqual(LOOP, { deaths: 2, radius: 8, windowMs: 5 * 60_000, samePoint: 2 });
    const now = 1_000_000;
    const a = agentAt(RESPAWN.offset(0.5, 0, 0.5), { deaths: [[16, 64, -46]], now, lastAgo: 6_000 });
    a.bot.time.timeOfDay = NIGHT_T;
    const s = stubs();
    const die = (at, p) => { a._death.died({ pos: p, dimension: 'overworld', now: at }); a._death.pending = null; a.bot.entity.position = RESPAWN.offset(0.5, 0, 0.5); };
    respawnEscapeTick(a, { now, ...s.opts }); // the respawn after death 1: noted, nothing near
    a.bot.entities[9] = zmb(9, RESPAWN.offset(1, 0, 1));
    die(now + 200_000, RESPAWN.offset(1, -1, 1)); // death 2 at the respawn point
    respawnEscapeTick(a, { now: now + 205_000, ...s.opts });
    await flush(); await flush();
    assert.equal(s.runs.length, 1, 'one death there: still the run');
    assert.equal(loopAt(a, now + 205_000), null);
    die(now + 230_000, RESPAWN.offset(-1, -2, 2)); // death 3, 25 s later
    respawnEscapeTick(a, { now: now + 235_000, ...s.opts });
    await flush(); await flush();
    assert.equal(s.runs.length, 1, 'no run');
    assert.equal(s.breaks, 1, 'the loop breaker');
    const said = '[respawn] the respawn point at -70, 65, 87 has killed me 2 times in 1 min: not running from it again; a step down and sealed, else hitting back';
    assert.ok(s.logs.includes(said), s.logs.join('\n'));
    // The world spawn scatters respawns (soak 10): two deaths there at different respawn points are no loop.
    const ring = agentAt(SPAWN.offset(2, 0, 3), { now });
    respawnEscapeTick(ring, { now, ...stubs().opts });
    await flush(); await flush(); // its escape run ends
    // Two deaths within 8 blocks of the second respawn point (one of soak 10's and this one), but the first
    // respawn was 9 blocks away: not the same spawn.
    ring._death.died({ pos: SPAWN.offset(-5, 0, 6), dimension: 'overworld', now: now + 20_000 }); ring._death.pending = null;
    ring.bot.entity.position = SPAWN.offset(-7, 0, 8);
    respawnEscapeTick(ring, { now: now + 25_000, ...stubs().opts });
    assert.ok(respawnPoint(ring, ring._death.last.at), 'the second respawn point is noted');
    assert.equal(loopAt(ring, now + 25_000), null, 'not the same respawn point');
});

test('soak 12 (B(ii) step 5): the loop breaker burrows a step down; no step: it stays and hits back (cornered, no health limit); nothing near: it stays', async () => {
    const z = zmb(9, new Vec3(1.5, 64, 0.5));
    const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 9: z } };
    let fought = null;
    const dug = await breakLoop(bot, { burrow: (b, m, o) => Promise.resolve({ steps: 1, site: new Vec3(0, 63, 0), o }), fight: () => { fought = true; } });
    assert.deepEqual([dug.broke, fought], ['burrowed', null]);
    const stuck = await breakLoop(bot, { burrow: (b, m, o) => { assert.deepEqual(o, { maxSteps: 1, prefer: 'down' }); return Promise.resolve({ steps: 0, stopped: 'cornered', why: 'down: stone' }); },
        fight: (b, isEnemy, keep) => { fought = keep(z); } });
    assert.deepEqual([stuck.broke, stuck.why, fought], ['fought', 'down: stone', true]);
    assert.deepEqual(await breakLoop({ entity: bot.entity, entities: {} }), { broke: 'quiet' });
});

test('soak 12 (B(ii) step 4): cornered in the run (no gain for stallMs, a melee mob within 2), armed: 3 hits back, then it runs on; unarmed: no hit', async () => {
    const run = async (items) => {
        const a = agentAt(SPAWN.offset(2, 0, 3), { now: 1_000_000, items });
        a.bot.inventory.slots = [];
        a.bot.entities[9] = zmb(9, a.bot.entity.position.offset(1, 0, 0));
        let c = 0; const hits = []; const logs = [];
        const r = await escapeRun(a.bot, placesToLeave(a, 1_000_000), { now: () => c, sleep: (ms) => { c += ms; return Promise.resolve(); }, setGoal: () => {},
            hitBack: (b, m) => { hits.push(m.id); return Promise.resolve(true); }, log: (l) => logs.push(l) });
        return { r, hits, logs };
    };
    const armed = await run([{ name: 'stone_sword', metadata: 0, count: 1 }]);
    assert.deepEqual(armed.hits, [9, 9, 9]);
    assert.match(armed.logs[0], /^\[respawn\] cornered by a zombie 1\.0 blocks away with no way on: hitting back \(at most 3 hits\), then running on$/);
    assert.equal(armed.r.stopped, 'time', 'then it ran on to its cap');
    const bare = await run([]);
    assert.deepEqual(bare.hits, []);
});

test('soak 12 (C): right after a respawn with a hostile within 16, the club goes from the off hand to the main hand (death 2 fought holding mutton); nothing near: not', async () => {
    const club = { name: 'spartanweaponry:club_wood', metadata: 48, count: 1, type: 1 };
    const mutton = { name: 'animania:raw_prime_mutton', metadata: 0, count: 1, type: 2, slot: 36 };
    const mk = (entities) => {
        const slots = new Array(46).fill(null);
        slots[45] = club; slots[36] = mutton;
        const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities, heldItem: mutton, quickBarSlot: 0,
            inventory: { slots, items: () => slots.slice(9, 45).filter(Boolean), firstEmptyInventorySlot: () => slots.findIndex((s, i) => i >= 9 && i < 45 && !s) },
            moveSlotItem: (from, to) => { slots[to] = { ...slots[from], slot: to }; slots[from] = null; return Promise.resolve(); },
            equip: (item) => { bot.heldItem = item; return Promise.resolve(); } };
        return bot;
    };
    const logs = [];
    const near = mk({ 9: zmb(9, new Vec3(5.5, 64, 0.5)) });
    assert.equal(await preArm(near, { log: (l) => logs.push(l) }), true);
    assert.equal(near.heldItem.name, 'spartanweaponry:club_wood');
    assert.deepEqual(logs, ['[respawn] spartanweaponry:club_wood from the off hand into the main hand: a hostile within 16 blocks']);
    const quiet = mk({});
    assert.equal(await preArm(quiet, { log: () => {} }), false);
    assert.equal(quiet.heldItem.name, 'animania:raw_prime_mutton');
});

test('soak 12 (B(i)): the scroll is never used in a hole shelter, below the surface, or in a cell with no walkable way out; on open ground with its walls, it is', () => {
    const scroll = { name: 'lifescroll:spawnscroll', metadata: 0, count: 1 };
    const site = new Vec3(150, 64, -62);
    const a = agentAt(site, { now: Date.now(), deaths: [], items: [scroll] });
    const reg = minecraftData('1.12.2');
    const ground = (extra = {}) => (p) => {
        const q = p.floored();
        const v = extra[`${q.x},${q.y},${q.z}`] ?? (q.y < 64 ? 'dirt' : 'air');
        return { name: v, boundingBox: reg.blocksByName[v]?.boundingBox ?? 'block', position: q };
    };
    a.bot.blockAt = ground();
    assert.equal(scrollRefusal(a, site), null, 'open ground');
    assert.match(scrollRefusal(a, site, { pit: true }), /^a hole shelter: no walkable way out of it/);
    assert.match(scrollRefusal(a, site, { below: true }), /^below the surface after a burrow/);
    // Its walls come down in the morning (counted free); a pit of ground around them does not.
    const walls = {};
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1]) walls[`${150 + dx},${64 + dy},${-62 + dz}`] = 'cobblestone';
    a.bot.blockAt = ground(walls);
    assert.equal(scrollRefusal(a, site), null, 'a closed shelter on open ground');
    const sunk = {};
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (const dy of [0, 1, 2]) if (Math.abs(x) + Math.abs(z) > 0) sunk[`${150 + x},${64 + dy},${-62 + z}`] = 'dirt';
    a.bot.blockAt = ground(sunk);
    assert.match(scrollRefusal(a, site), /^no walkable way out of 150, 64, -62 to 8 blocks/);
});
