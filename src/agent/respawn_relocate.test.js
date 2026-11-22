// CX23 soak (rotn-v0.1.3): 14 deaths in a ring around the spawn; each raised a player zombie that
// never leaves, and the bot respawned among them. After a respawn (or a player zombie at the spawn),
// the bot first walks RELOCATE.away blocks from the spawn and the recent death spots; the agenda
// waits. Offline: fake bots; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { setImmediate } from 'node:timers';
import { DeathReporter } from './library/death_report.js';
import { RELOCATE, relocateTick, relocationReason, targetAwayFrom, placesToLeave, nightRelocationPlan, walkAwayAtNight, hostileNearWay, NIGHT_RELOCATE } from './respawn_relocate.js';
import { autonomyTick } from './priority.js';

const SPAWN = new Vec3(-45, 80, -64);
const flush = () => new Promise(r => setImmediate(r));
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** An agent that died at each of `deaths` ([x, y, z, msAgo]) and now stands at `here`, by day. */
function agentAt(here, { deaths = [], now = 1_000_000, entities = {} } = {}) {
    const d = new DeathReporter();
    for (const [x, y, z, ago] of deaths) { d.died({ pos: new Vec3(x, y, z), dimension: 'overworld', now: now - ago }); d.pending = null; }
    const self = { id: 0, type: 'player', position: here.clone() };
    const stops = [];
    const agent = {
        _death: d,
        bot: { entity: self, entities: { 0: self, ...entities }, spawnPoint: SPAWN.clone(), game: { dimension: 'overworld' },
            time: { timeOfDay: 1000 }, modes: { anyActive: () => false } },
        self_prompter: { active: true, isActive() { return this.active; }, stop() { this.active = false; stops.push('stop'); } },
        actions: { runs: [], runAction(label, fn) { this.runs.push(label); return Promise.resolve(fn()).then(() => ({ interrupted: false })); } },
        stops,
    };
    return agent;
}

test('CX23 soak: the target is at least RELOCATE.away from the spawn and every death spot, straight away from their centre', () => {
    const places = [{ pos: SPAWN }, { pos: new Vec3(-63, 63, -63) }, { pos: new Vec3(-34, 69, -75) }, { pos: new Vec3(-80, 66, -38) }];
    const t = targetAwayFrom(new Vec3(-50, 75, -60), places);
    for (const p of places) assert.ok(hdist(p.pos, t) >= RELOCATE.away, `${hdist(p.pos, t)} from ${p.pos}`);
    assert.ok(hdist(new Vec3(-50, 0, -60), t) < RELOCATE.maxTarget);
    assert.equal(RELOCATE.away, 64, 'soak 10 (R4): 64, as the respawn escape');
});

test('CX23 soak: after a respawn the bot walks RELOCATE.away (64) from the spawn and the recent death spots, once per death; the agenda waits meanwhile', async () => {
    const now = 1_000_000;
    const agent = agentAt(SPAWN.offset(2, 0, 3), { deaths: [[-80, 66, -38, 60_000], [-65, 64, -77, 30_000]], now });
    assert.deepEqual(placesToLeave(agent, now).map(p => p.what), ['spawn', 'death spot', 'death spot']);
    const logs = [];
    let walkedTo = null;
    const walk = (bot, target) => { walkedTo = target; bot.entity.position = new Vec3(target.x, 70, target.z); return Promise.resolve(); };
    assert.equal(relocateTick(agent, { now, walk, log: (l) => logs.push(l) }), 'relocating');
    assert.deepEqual([agent.stops, agent._agenda_paused], [['stop'], true], 'the agenda\'s self-prompting stops (its commands would end the walk)');
    assert.equal(relocateTick(agent, { now, walk, log: (l) => logs.push(l) }), 'relocating', 'while the walk runs');
    await flush(); await flush();
    assert.deepEqual(agent.actions.runs, ['action:leaveDeathArea'], 'one walk, as an action');
    assert.match(logs[0], /^\[respawn\] after a death: moving at least 64 blocks from the spawn and 2 recent death spots, towards -?\d+, -?\d+, before the agenda resumes$/);
    assert.match(logs.at(-1), /^\[respawn\] now \d+ blocks from the spawn and 2 recent death spots at .*; the agenda resumes$/);
    for (const p of placesToLeave(agent, now)) assert.ok(hdist(p.pos, walkedTo) >= RELOCATE.away);
    assert.equal(relocateTick(agent, { now: now + 1000, walk, log: () => {} }), null, 'far away now: the agenda resumes');

    // A walk that does not get there: said, and not tried again for the same death.
    const stuck = agentAt(SPAWN.offset(2, 0, 3), { deaths: [[-80, 66, -38, 60_000]], now });
    const logs2 = [];
    assert.equal(relocateTick(stuck, { now, walk: () => Promise.resolve(), log: (l) => logs2.push(l) }), 'relocating');
    await flush(); await flush();
    assert.match(logs2.at(-1), /^\[respawn\] got only \d+ blocks from the spawn and 1 recent death spot .*; the agenda resumes$/);
    assert.equal(relocateTick(stuck, { now: now + 1000, walk: () => Promise.resolve(), log: () => {} }), null, 'once per death');
    // A new death: again.
    stuck._death.died({ pos: new Vec3(-60, 64, -60), dimension: 'overworld', now: now + 2000 }); stuck._death.pending = null;
    assert.equal(relocateTick(stuck, { now: now + 3000, walk: () => Promise.resolve(), log: () => {} }), 'relocating');
});

test('CX23 soak: no recent death, but a player zombie within 24 of the spawn while the bot is near it: it leaves too, at most once per RELOCATE.retryMs; far away, nothing', () => {
    const now = 5_000_000;
    const zombie = { id: 7, name: 'zombie_players:zombie_player', type: 'mob', position: SPAWN.offset(10, -10, 5) };
    const agent = agentAt(SPAWN.offset(5, 0, 0), { now, entities: { 7: zombie } });
    assert.equal(relocationReason(agent, now)?.kind, 'zombie');
    assert.equal(relocateTick(agent, { now, walk: () => Promise.resolve(), log: () => {} }), 'relocating');
    agent._relocate.job = null;
    assert.equal(relocateTick(agent, { now: now + 1000, walk: () => Promise.resolve(), log: () => {} }), null, 'not again within retryMs');
    assert.equal(relocationReason(agent, now + RELOCATE.retryMs)?.kind, 'zombie', 'again after retryMs');
    // An ordinary zombie, or a player zombie far from the spawn: nothing.
    assert.equal(relocationReason(agentAt(SPAWN.offset(5, 0, 0), { now, entities: { 7: { ...zombie, name: 'zombie' } } }), now), null);
    assert.equal(relocationReason(agentAt(SPAWN.offset(5, 0, 0), { now, entities: { 7: { ...zombie, position: SPAWN.offset(60, 0, 0) } } }), now), null);
    // Already 48 away from the spawn and every death spot: nothing, also right after a death.
    const far = agentAt(SPAWN.offset(120, 0, 0), { deaths: [[-80, 66, -38, 10_000]], now, entities: { 7: zombie } });
    assert.equal(relocationReason(far, now), null);
    // An old death (over RELOCATE.recentMs): no walk for it.
    assert.equal(relocationReason(agentAt(SPAWN.offset(2, 0, 3), { deaths: [[-80, 66, -38, RELOCATE.recentMs + 1]], now }), now), null);
});

test('CX23 soak: in the priority stack the walk away comes before the agenda (agendaTick is not reached)', async (t) => {
    t.mock.method(console, 'log', () => {});
    const now = 2_000_000;
    const agent = agentAt(SPAWN.offset(2, 0, 3), { deaths: [[-80, 66, -38, 60_000]], now });
    let agendaTicks = 0;
    agent.agenda = { get active() { agendaTicks++; return true; } };
    agent.tasks = { current: () => null, get: () => null };
    agent.actions.runAction = () => new Promise(() => {}); // the walk runs on
    // Soak 10 (R1): right after a death near the spawn the respawn escape comes first (respawn_escape.js);
    // the relocate's walk is its day-time follow-up. The agenda waits either way.
    assert.equal(autonomyTick(agent, { now }), 'escaping');
    assert.equal(autonomyTick(agent, { now: now + 300 }), 'escaping');
    assert.equal(agendaTicks, 0, 'the agenda waits');
    await flush();
});

test('#416 review 1: a goal a task giver typed (or a paused conversation) is never stopped: the walk away waits for it', () => {
    const now = 1_000_000;
    const agent = agentAt(SPAWN.offset(2, 0, 3), { deaths: [[-80, 66, -38, 60_000]], now });
    Object.assign(agent.self_prompter, { goal_by: 'JQDAW', prompt: 'build a hut' });
    const logs = [];
    assert.equal(relocateTick(agent, { now, walk: () => Promise.resolve(), log: (l) => logs.push(l) }), null);
    assert.deepEqual([agent.stops, agent.actions.runs, logs], [[], [], []], 'the giver\'s goal runs on');
    assert.equal(agent.self_prompter.isActive(), true);
    // Paused (a bot-to-bot conversation): waits too.
    const paused = agentAt(SPAWN.offset(2, 0, 3), { deaths: [[-80, 66, -38, 60_000]], now });
    paused.self_prompter.isPaused = () => true;
    assert.equal(relocateTick(paused, { now, walk: () => Promise.resolve(), log: () => {} }), null);
    // Once the goal is over, the walk is still due (once per death, not used up).
    agent.self_prompter.goal_by = null;
    assert.equal(relocateTick(agent, { now: now + 1000, walk: () => Promise.resolve(), log: () => {} }), 'relocating');
});

test('#416 review 3: not while a reflex acts; a walk a reflex interrupted is tried again after RELOCATE.waitMs, at most RELOCATE.tries walks', async () => {
    const now = 1_000_000;
    const agent = agentAt(SPAWN.offset(2, 0, 3), { deaths: [[-80, 66, -38, 60_000]], now });
    let reflex = true;
    agent.bot.modes.anyActive = () => reflex;
    assert.equal(relocateTick(agent, { now, walk: () => Promise.resolve(), log: () => {} }), 'relocating:wait', 'the agenda waits with it');
    assert.deepEqual([agent.stops, agent.actions.runs], [[], []], 'nothing started');
    reflex = false;
    // Each walk is interrupted (runAction says so) and gets nowhere.
    agent.actions.runAction = function (label, fn) { this.runs.push(label); return Promise.resolve(fn()).then(() => ({ interrupted: true })); };
    const logs = [];
    let t = now;
    for (let i = 0; i < 5; i++) {
        assert.equal(relocateTick(agent, { now: t + 1, clock: () => t, walk: () => Promise.resolve(), log: (l) => logs.push(l) }) === null, i >= RELOCATE.tries, `tick ${i}`);
        await flush(); await flush();
        if (i < RELOCATE.tries - 1) assert.equal(relocateTick(agent, { now: t + 2, clock: () => t, log: () => {} }), null, 'waits RELOCATE.waitMs');
        t += RELOCATE.waitMs + 10;
    }
    assert.equal(agent.actions.runs.length, RELOCATE.tries, 'at most RELOCATE.tries walks for one death');
    assert.equal(logs.filter(l => /was interrupted at \d+ blocks \(try \d of 3\); trying again in 5 s/.test(l)).length, RELOCATE.tries - 1);
    assert.match(logs.at(-1), /got only \d+ blocks .*; the agenda resumes/);
});

test('#416 review 4: the zombie-at-spawn trigger waits while an action runs (never cuts into running work)', () => {
    const now = 5_000_000;
    const zombie = { id: 7, name: 'zombie_players:zombie_player', type: 'mob', position: SPAWN.offset(10, -10, 5) };
    const agent = agentAt(SPAWN.offset(5, 0, 0), { now, entities: { 7: zombie } });
    agent.actions.executing = true;
    assert.equal(relocationReason(agent, now), null, 'an action runs: not now');
    agent.actions.executing = false;
    assert.equal(relocationReason(agent, now)?.kind, 'zombie', 'between steps: now');
    // After a death it leaves even with an action running (a respawn follows the death; the agenda's step waits anyway).
    const died = agentAt(SPAWN.offset(5, 0, 0), { deaths: [[-80, 66, -38, 10_000]], now });
    died.actions.executing = true;
    assert.equal(relocationReason(died, now)?.kind, 'death');
});

test('#416 nit: the target is not on water (where loaded): it goes farther out', () => {
    const places = [{ pos: SPAWN }];
    const dryFrom = 60;
    const t = targetAwayFrom(SPAWN.offset(5, 0, 0), places, { surfaceOk: (x) => x - SPAWN.x >= dryFrom });
    assert.ok(t.x - SPAWN.x >= dryFrom, `${t.x}`);
    assert.equal(targetAwayFrom(SPAWN.offset(5, 0, 0), places, { surfaceOk: () => false }), null, 'water all the way: none');
});


// Soak 3 (rotn-v0.1.5), the lead's C: at night after a death, the night routine first walks away by
// this rule, not 28 blocks from the last death spot only.
const SOAK3_DEATHS = () => [[-60, 60, -66, 4 * 60_000], [-35, 66, -56, 3 * 60_000], [-62, 60, -63, 2 * 60_000], [-29, 72, -86, 60_000]];
const zombieAt = (x, z) => ({ id: 9, type: 'mob', name: 'zombie', position: new Vec3(x, 64, z) });

test('soak 3 C: armed at night, no mob near the way: at least RELOCATE.away (64; soak 10 R4) blocks from the spawn and every recent death spot', () => {
    const now = 1_000_000;
    const agent = agentAt(new Vec3(-52, 63, -63), { deaths: SOAK3_DEATHS(), now }); // the 20:00:57 respawn
    const plan = nightRelocationPlan(agent, now, { night: true, armed: true });
    assert.equal(plan.mode, 'full');
    assert.equal(plan.away, 64);
    assert.equal(plan.places.length, 5, 'the spawn and all four death spots, not only the last');
    for (const p of plan.places) assert.ok(hdist(p.pos, plan.target) >= 64);
    assert.match(plan.line, /^\[night\] I died near here recently: moving at least 64 blocks from the spawn and 4 recent death spots, towards -?\d+, -?\d+, before sheltering$/);
    // Dusk, unarmed: still the full walk (not yet night).
    assert.equal(nightRelocationPlan(agent, now, { night: false, armed: false }).mode, 'full');
});

test('soak 3 C (the lead\'s change): no weapon at night, or a hostile mob within 16 of the way: the first spot 24 blocks from every recent death spot', () => {
    const now = 1_000_000;
    const unarmed = agentAt(new Vec3(-52, 63, -63), { deaths: SOAK3_DEATHS(), now });
    const plan = nightRelocationPlan(unarmed, now, { night: true, armed: false });
    assert.equal(plan.mode, 'short');
    assert.equal(plan.away, 24);
    assert.equal(plan.places.length, 4, 'the death spots only');
    for (const p of plan.places) assert.ok(hdist(p.pos, plan.target) >= 24);
    assert.match(plan.line, /, and it is night and I have no weapon: moving to the first spot at least 24 blocks from 4 recent death spots, towards/);
    // Armed, but a zombie near the full walk's way.
    const full = nightRelocationPlan(agentAt(new Vec3(-52, 63, -63), { deaths: SOAK3_DEATHS(), now }), now, { night: true, armed: true });
    const mid = { x: (-52 + full.target.x) / 2, z: (-63 + full.target.z) / 2 };
    const near = agentAt(new Vec3(-52, 63, -63), { deaths: SOAK3_DEATHS(), now, entities: { 9: zombieAt(mid.x + 10, mid.z) } });
    const p2 = nightRelocationPlan(near, now, { night: true, armed: true });
    assert.equal(p2.mode, 'short');
    assert.match(p2.line, /, and a zombie is near the way: moving to the first spot at least 24 blocks/);
    // 20 blocks off the way: not near.
    const atStart = agentAt(new Vec3(-52, 63, -63), { deaths: SOAK3_DEATHS(), now, entities: { 9: zombieAt(-52, -63 + 0) } });
    assert.ok(hostileNearWay(atStart.bot, new Vec3(-52, 63, -63), full.target), 'a mob at the start is near the way');
    assert.equal(hostileNearWay(atStart.bot, new Vec3(-100, 63, -63), new Vec3(-100, 63, 63)), null, '48 blocks off: not near');
});

test('soak 3 C: no walk when no death is recent (30 min), or the bot is already far enough', () => {
    const now = 1_000_000;
    assert.equal(nightRelocationPlan(agentAt(new Vec3(-52, 63, -63), { now }), now, { night: true }), null, 'no death');
    assert.equal(nightRelocationPlan(agentAt(new Vec3(-52, 63, -63), { deaths: [[-60, 60, -66, NIGHT_RELOCATE.recentMs + 1000]], now }), now, { night: true }), null, 'over 30 min ago');
    // 30 blocks from the only death spot: far enough for the short rule.
    assert.equal(nightRelocationPlan(agentAt(new Vec3(-30, 63, -66), { deaths: [[-60, 60, -66, 60_000]], now }), now, { night: true, armed: false }), null);
    // 60 blocks from it and the spawn: far enough for the full rule.
    assert.equal(nightRelocationPlan(agentAt(new Vec3(20, 63, -66), { deaths: [[-60, 60, -66, 60_000]], now }), now, { night: true, armed: true }), null);
});

/** A walk that moves the bot 1 block east every 20 ms until the pathfinder is stopped (or `cap` blocks). */
function stepWalk(cap = Infinity) {
    return (bot) => new Promise(resolve => {
        let moved = 0;
        const iv = setInterval(() => { if (moved++ < cap) bot.entity.position = bot.entity.position.offset(1, 0, 0); }, 20);
        bot.pathfinder = { stop: () => { clearInterval(iv); resolve(false); } };
    });
}

test('soak 3 C: the short walk stops at the first spot 24 blocks from every death spot; the full walk stops early there once a mob comes near; a walk out of time says so', async (t) => {
    const saved = { ...NIGHT_RELOCATE };
    t.after(() => Object.assign(NIGHT_RELOCATE, saved));
    Object.assign(NIGHT_RELOCATE, { checkMs: 10, walkMs: 3000 });
    const now = 1_000_000;
    const death = [[0, 64, 0, 60_000]];
    const short = agentAt(new Vec3(5, 64, 0), { deaths: death, now });
    const sp = { mode: 'short', target: { x: 200, z: 0 }, places: placesToLeave(short, now).filter(p => p.what === 'death spot'), away: 24 };
    const r = await walkAwayAtNight(short.bot, sp, { walk: stepWalk() });
    assert.equal(r.stopped, 'far');
    assert.equal(r.arrived, true);
    assert.ok(short.bot.entity.position.x >= 24 && short.bot.entity.position.x <= 27, `stopped at ${short.bot.entity.position.x}`);

    const full = agentAt(new Vec3(5, 64, 0), { deaths: death, now });
    const fp = { mode: 'full', target: { x: 200, z: 0 }, places: placesToLeave(full, now), away: 48 };
    const z = zombieAt(40, 0);
    full.bot.entities[9] = z;
    const r2 = await walkAwayAtNight(full.bot, fp, { walk: stepWalk() });
    assert.equal(r2.stopped, 'hostile');
    assert.equal(r2.arrived, true, '24 from the death spot already');
    assert.ok(full.bot.entity.position.x >= 24 && full.bot.entity.position.x < 48);

    const slow = agentAt(new Vec3(5, 64, 0), { deaths: death, now });
    const r3 = await walkAwayAtNight(slow.bot, { ...sp, places: placesToLeave(slow, now).filter(p => p.what === 'death spot') }, { walk: stepWalk(3) });
    assert.equal(r3.stopped, 'time');
    assert.equal(r3.arrived, false);
});

// #471 nits: the fallbacks, the dimension, the walk's guards.
test('#471 nit 6: no 48-block spot (water beyond 44): the short walk instead; no dry spot at all: no walk', () => {
    const now = 1_000_000;
    const ringed = agentAt(new Vec3(-52, 63, -63), { deaths: SOAK3_DEATHS(), now });
    const centre = new Vec3(-50, 0, -65);
    ringed.bot.blockAt = (p) => (hdist(p, centre) >= 44 ? { name: 'water', boundingBox: 'empty' } : { name: 'air', boundingBox: 'empty' });
    const plan = nightRelocationPlan(ringed, now, { night: true, armed: true });
    assert.equal(plan.mode, 'short');
    assert.match(plan.line, /, and there is no place 64 blocks away: moving to the first spot at least 24 blocks/);
    const sea = agentAt(new Vec3(-52, 63, -63), { deaths: SOAK3_DEATHS(), now });
    sea.bot.blockAt = () => ({ name: 'water', boundingBox: 'empty' });
    assert.equal(nightRelocationPlan(sea, now, { night: true, armed: false }), null, 'a null short target: no walk');
});

test('#471 nit 5: the spawn point is a place to leave only in the overworld', () => {
    const now = 1_000_000;
    const agent = agentAt(new Vec3(0, 64, 0), { deaths: [[0, 64, 0, 60_000]], now });
    assert.deepEqual(placesToLeave(agent, now).map(p => p.what), ['spawn', 'death spot']);
    agent.bot.game.dimension = 'the_nether';
    assert.deepEqual(placesToLeave(agent, now).map(p => p.what), [], 'the death was in the overworld too');
    // #472 nit 3: names compared without the namespace; an unknown modded dimension is not the overworld.
    agent.bot.game.dimension = 'minecraft:overworld';
    assert.deepEqual(placesToLeave(agent, now).map(p => p.what), ['spawn', 'death spot'], 'minecraft:overworld is the overworld');
    // #474 review 1: mineflayer leaves a modded dimension (Twilight Forest is 7) undefined: unknown,
    // never the overworld; no spawn to leave and no overworld death spot there.
    agent.bot.game.dimension = undefined;
    assert.deepEqual(placesToLeave(agent, now).map(p => p.what), [], 'an unnamed (modded) dimension');
    agent.bot.rotnDimensionId = 7;
    assert.deepEqual(placesToLeave(agent, now).map(p => p.what), []);
});

test('#471 nits 2-4: a full walk stops at 24 once night falls unarmed; a walk that throws is logged; no position is no crash', async (t) => {
    const saved = { ...NIGHT_RELOCATE };
    t.after(() => Object.assign(NIGHT_RELOCATE, saved));
    Object.assign(NIGHT_RELOCATE, { checkMs: 10, walkMs: 1500 });
    const now = 1_000_000;
    const death = [[0, 64, 0, 60_000]];
    const a = agentAt(new Vec3(5, 64, 0), { deaths: death, now });
    const fp = { mode: 'full', target: { x: 200, z: 0 }, places: placesToLeave(a, now), away: 48 };
    let nightNow = false;
    setTimeout(() => { nightNow = true; }, 100); // dusk turns to night during the walk
    const r = await walkAwayAtNight(a.bot, fp, { walk: stepWalk(), shortNow: () => nightNow });
    assert.equal(r.stopped, 'night');
    assert.equal(r.arrived, true);
    assert.ok(a.bot.entity.position.x >= 24 && a.bot.entity.position.x < 48, `${a.bot.entity.position.x}`);

    const logs = [];
    const b = agentAt(new Vec3(5, 64, 0), { deaths: death, now });
    const r2 = await walkAwayAtNight(b.bot, { ...fp, places: placesToLeave(b, now) }, { walk: () => Promise.reject(new Error('No path to the goal!')), log: (l) => logs.push(l) });
    assert.deepEqual(logs, ['[night] the walk away: Error: No path to the goal!']);
    assert.equal(r2.arrived, false);

    const c = agentAt(new Vec3(5, 64, 0), { deaths: death, now });
    const r3 = await walkAwayAtNight(c.bot, { ...fp, places: placesToLeave(c, now) }, { walk: (bot) => new Promise(res => { setTimeout(() => { bot.entity = null; }, 30); setTimeout(() => res(false), 120); }) });
    assert.deepEqual(r3, { arrived: false, nearest: 0, stopped: null });
});

test('#474 review 1: a death in an unnamed (modded) dimension is recorded as unknown:<id>, and matches only there', async () => {
    const { dimensionKey, sameDimension, bindDeathReport } = await import('./library/death_report.js');
    assert.equal(dimensionKey({}), null, 'no game yet: no dimension known');
    assert.equal(dimensionKey({ game: { dimension: 'overworld' } }), 'overworld');
    assert.equal(dimensionKey({ game: { dimension: 'minecraft:the_nether' } }), 'the_nether');
    assert.equal(dimensionKey({ game: { dimension: undefined } }), 'unknown');
    assert.equal(dimensionKey({ game: { dimension: undefined }, rotnDimensionId: 7 }), 'unknown:7');
    const tf = { game: { dimension: undefined }, rotnDimensionId: 7 };
    assert.equal(sameDimension(tf, 'unknown:7'), true);
    assert.equal(sameDimension(tf, 'overworld'), false);
    assert.equal(sameDimension({ game: { dimension: 'overworld' } }, 'unknown:7'), false, 'an unknown-dimension spot does not match the overworld');
    assert.equal(sameDimension({ game: { dimension: 'overworld' } }, null), false, 'a spot with no dimension matches no known dimension');
    assert.equal(sameDimension({}, 'overworld'), true, 'no game: no filter');
    // bindDeathReport keeps the packet's id and records the key at a death.
    const { EventEmitter } = await import('node:events');
    const client = new EventEmitter();
    const bot = Object.assign(new EventEmitter(), { _client: client, game: { dimension: undefined }, entity: { position: new Vec3(1, 70, 2) }, health: 20 });
    const agent = { bot, actions: {}, memory_bank: {} };
    bindDeathReport(agent, { setTimer: () => 0, clearTimer: () => {}, now: () => 1000 });
    client.emit('respawn', { dimension: 7 });
    assert.equal(bot.rotnDimensionId, 7);
    const logs = [];
    const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
    try { bot.emit('death'); } finally { console.log = orig; }
    assert.equal(agent._death.pending.dimension, 'unknown:7');
});

// Soak 5 (00:56:18): respawned up the spawn tree, the walk away found no path and "got only 4 blocks";
// the agenda resumed up there. Now: down from the tree first; a failed walk is tried again.
test('soak 5: up on a tree, the walk away climbs down first; a failed climb down or walk is tried again (3 walks), then said', async () => {
    const now = 1_000_000;
    let clock = now;
    const agent = agentAt(SPAWN.offset(2, 0, 3), { deaths: [[-80, 66, -38, 60_000]], now });
    const logs = [];
    let up = true, descents = 0, walks = 0;
    const opts = () => ({ now: clock, clock: () => clock, log: (l) => logs.push(l), onTree: () => up,
        descend: (bot) => { descents++; bot.rotnTreeWhy = 'Not digging down: dynamictrees:trunkshell is under you'; return Promise.resolve(false); },
        walk: () => { walks++; return Promise.resolve({ failed: true, why: 'NoPath' }); } });
    assert.equal(relocateTick(agent, opts()), 'relocating');
    await flush(); await flush();
    assert.ok(logs.includes('[respawn] up on a tree: climbing down before the walk away'));
    assert.equal(descents, 1);
    assert.equal(walks, 0, 'no walk from the tree');
    assert.match(logs.at(-1), /^\[respawn\] the walk away failed \(still up on the tree: Not digging down: dynamictrees:trunkshell is under you\) at \d+ blocks \(try 1 of 3\); trying again in 5 s$/);
    // Down now; the walk fails (no path): tried again.
    up = false;
    clock += RELOCATE.waitMs;
    assert.equal(relocateTick(agent, opts()), 'relocating');
    await flush(); await flush();
    assert.equal(walks, 1);
    assert.match(logs.at(-1), /the walk away failed \(NoPath\) at \d+ blocks \(try 2 of 3\)/);
    clock += RELOCATE.waitMs;
    assert.equal(relocateTick(agent, opts()), 'relocating');
    await flush(); await flush();
    assert.match(logs.at(-1), /^\[respawn\] the walk away failed at \d+ blocks from the spawn and 1 recent death spot \(NoPath\) after 3 tries; the agenda resumes$/);
    clock += RELOCATE.waitMs;
    assert.equal(relocateTick(agent, opts()), null, 'no fourth walk for this death');
    // On the ground, a walk that arrives: as before.
    const fine = agentAt(SPAWN.offset(2, 0, 3), { deaths: [[-80, 66, -38, 60_000]], now });
    const logs2 = [];
    relocateTick(fine, { now, log: (l) => logs2.push(l), onTree: () => false, descend: () => { throw new Error('not on a tree'); },
        walk: (bot, target) => { bot.entity.position = new Vec3(target.x, 70, target.z); return Promise.resolve(null); } });
    await flush(); await flush();
    assert.match(logs2.at(-1), /^\[respawn\] now \d+ blocks from/);
});

// #581 re-review nit 4: after a short escape (full: true) with no place 64 blocks away, the short walk,
// not sheltering on the spot.
test('#581 re-review nit 4: full asked but no full target: the short walk instead of none', () => {
    const now = 1_000_000;
    const ringed = agentAt(new Vec3(-52, 63, -63), { deaths: SOAK3_DEATHS(), now });
    const centre = new Vec3(-50, 0, -65);
    ringed.bot.blockAt = (p) => (hdist(p, centre) >= 44 ? { name: 'water', boundingBox: 'empty' } : { name: 'air', boundingBox: 'empty' });
    const plan = nightRelocationPlan(ringed, now, { night: true, armed: false, full: true });
    assert.equal(plan?.mode, 'short');
    const open = agentAt(new Vec3(-52, 63, -63), { deaths: SOAK3_DEATHS(), now });
    assert.equal(nightRelocationPlan(open, now, { night: true, armed: false, full: true }).mode, 'full', 'a full target: the full walk');
});
