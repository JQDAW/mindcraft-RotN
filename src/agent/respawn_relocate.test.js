// CX23 soak (rotn-v0.1.3): 14 deaths in a ring around the spawn; each raised a player zombie that
// never leaves, and the bot respawned among them. After a respawn (or a player zombie at the spawn),
// the bot first walks RELOCATE.away blocks from the spawn and the recent death spots; the agenda
// waits. Offline: fake bots; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { setImmediate } from 'node:timers';
import { DeathReporter } from './library/death_report.js';
import { RELOCATE, relocateTick, relocationReason, targetAwayFrom, placesToLeave } from './respawn_relocate.js';
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
    assert.equal(RELOCATE.away, 48);
});

test('CX23 soak: after a respawn the bot walks 48 away from the spawn and the recent death spots, once per death; the agenda waits meanwhile', async () => {
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
    assert.match(logs[0], /^\[respawn\] after a death: moving at least 48 blocks from the spawn and 2 recent death spots, towards -?\d+, -?\d+, before the agenda resumes$/);
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
    assert.equal(autonomyTick(agent, { now }), 'relocating');
    assert.equal(autonomyTick(agent, { now: now + 300 }), 'relocating');
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

