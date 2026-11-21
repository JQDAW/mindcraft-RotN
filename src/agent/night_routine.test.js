// skills-rotn D2b-2: the night routine, offline. A fake agent (self-prompter, actions, chat) with
// the world operations replaced (build, dig out, the shelter check), plus digOut and the quiet
// modes against a small fake world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
import { __setRegistryForTest } from '../utils/mcdata.js';
import { nightTick, nightState, resetNight, isFullDay, resumeNightGoal, digOut, CHECK_MS, RETRY_MS, BUILD_ATTEMPTS, DUSK_WAIT_MS, FREE_INTERRUPTS, THREAT_INTERRUPTS, EXPOSED_RETRY_MS, EXPOSED_RETRIES } from './night_routine.js';
import settings from './settings.js';
import { autonomyTick } from './priority.js';
import { maxHitOf } from './library/threats.js';
import { shelterQuiet, SHELTER_QUIET_MODES, __modeForTest } from './modes.js';
import { NIGHT_START, TICKS_PER_MIN } from './library/night.js';
import { PIT } from './library/pit.js';
import { nightRelocationPlan, NIGHT_RELOCATE, RELOCATE } from './respawn_relocate.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);

const DUSK = NIGHT_START - 3 * TICKS_PER_MIN; // 3 min before sunset
const NIGHT = 15000, SUNRISE = 23600, MORNING = 1000;
const SITE = new Vec3(0, 64, 0);
/**
 * rotn-data #518: what a zombie may hit for is data (12.5, then 10.5): the health thresholds come from
 * it. UNDER/OVER: the whole healths just below and above it. LOW: a health at or below it and below
 * MORNING.fleeHealth (12), so a morning fight leaves (11, or 10).
 */
const ZOMBIE_HIT = maxHitOf({ name: 'zombie', type: 'mob' });
const UNDER = Number.isInteger(ZOMBIE_HIT) ? ZOMBIE_HIT - 1 : Math.floor(ZOMBIE_HIT);
const OVER = Math.floor(ZOMBIE_HIT) + 1;
const LOW = Math.min(11, UNDER);

function fakeAgent({ t = MORNING } = {}) {
    const chat = [], calls = { stop: 0, builds: [], digs: 0 };
    const agent = {
        chat, calls,
        openChat: (l) => { chat.push(l); },
        modeActive: false,
        bot: { time: { timeOfDay: t }, entity: { position: new Vec3(0.5, 64, 0.5) }, output: '', modes: { anyActive: () => agent.modeActive } },
        self_prompter: { active: true, loop_active: false, isActive() { return this.active; }, stop() { this.active = false; calls.stop++; }, isPaused: () => false },
        actions: {
            executing: false, currentActionLabel: '', stops: 0, interruptNext: false,
            stop() { this.stops++; this.executing = false; return Promise.resolve(); },
            async runAction(label, fn) {
                if (this.interruptNext) { this.interruptNext = false; return { message: '', interrupted: true }; } // stopped before fn finished
                await fn();
                return { message: '', interrupted: false };
            },
        },
        control: { blocking: () => null },
    };
    return agent;
}
function ops({ closed = true, open = [], side = SITE.offset(1, 0, 0) } = {}) {
    const o = { builds: [], digs: 0, open };
    o.buildShelter = (bot, opts = {}) => { o.builds.push(opts.site ?? null); return Promise.resolve({ closed, feet: SITE, line: closed ? 'Shelter closed' : 'A shelter at 0, 64, 0 needs 10 sturdy blocks (cobblestone or stone); you have 3.' }); };
    o.digOut = () => { o.digs++; return Promise.resolve(side); };
    o.siteNeeds = () => ({ todo: o.open });
    return o;
}
const settle = async (agent) => { while (nightState(agent).job) await nightState(agent).job; };
const quiet = (t) => t.mock.method(console, 'log', () => {}) && t.mock.method(console, 'warn', () => {});

test('D2b-2: full daylight, the sunrise and the night are told apart', () => {
    assert.equal(isFullDay(MORNING), true);
    assert.equal(isFullDay(SUNRISE), false, 'the sun is still rising');
    assert.equal(isFullDay(DUSK), false);
    assert.equal(isFullDay(NIGHT), false);
});

test('D2b-2: by day the routine does nothing; at dusk it stops autonomy at the checkpoint and builds a shelter', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: MORNING });
    const o = ops();
    assert.equal(nightTick(agent, { now: 0, ops: o }), null);
    assert.equal(agent.calls.stop, 0);

    agent.bot.time.timeOfDay = DUSK;
    agent.self_prompter.loop_active = true; // a command is still running
    assert.equal(nightTick(agent, { now: 1000, ops: o }), 'night:waiting');
    assert.deepEqual(o.builds, [], 'no build while the self-prompter finishes its command');
    agent.self_prompter.loop_active = false;
    assert.equal(nightTick(agent, { now: 2000, ops: o }), 'night:building');
    assert.equal(agent._agenda_paused, true, 'the agenda resumes later without a new run');
    await settle(agent);
    assert.deepEqual(o.builds, [null]);
    assert.equal(nightState(agent).state, 'inside');
    assert.equal(agent.bot.rotnSheltered, true);
    assert.deepEqual(agent.chat, ['[night] sunset is near: building a shelter', '[night] in the shelter at 0, 64, 0 until morning']);
    assert.equal(nightTick(agent, { now: 3000, ops: o }), 'night:inside');
});

test('D2b-2: inside, a breach is repaired at the same site; with a wall open self_defense may fight', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    o.open = [SITE.offset(1, 1, 0)];
    nightTick(agent, { now: 1, ops: o }); // the first tick inside starts the check clock
    assert.equal(nightTick(agent, { now: CHECK_MS, ops: o }), 'night:inside', 'not checked before CHECK_MS');
    assert.equal(o.builds.length, 1);
    nightTick(agent, { now: CHECK_MS + 1, ops: o });
    assert.equal(agent.bot.rotnSheltered, 'open');
    await settle(agent);
    assert.deepEqual(o.builds, [null, SITE], 'the repair names the site');
    assert.equal(agent.bot.rotnSheltered, true);
    assert.match(agent.chat.at(-1), /\[night\] the shelter is open at 1, 65, 0: repairing/);
});

test('D2b-2: out of the shelter at night (pushed, AggroTP) it builds a new one where it is', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    nightTick(agent, { now: 1, ops: o });
    agent.bot.entity.position = new Vec3(20.5, 70, 3.5);
    assert.equal(nightTick(agent, { now: CHECK_MS + 1, ops: o }), 'night:building');
    assert.equal(agent.bot.rotnSheltered, false);
    assert.match(agent.chat.at(-1), /no longer in the shelter at 0, 64, 0: building a new one/);
    nightTick(agent, { now: CHECK_MS + 2, ops: o });
    await settle(agent);
    assert.equal(o.builds.length, 2);
});

test('D2b-2: when no shelter can be built it retries after RETRY_MS, then stays put until morning', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops({ closed: false });
    let now = 0;
    nightTick(agent, { now, ops: o });
    await settle(agent);
    for (let i = 1; i < BUILD_ATTEMPTS; i++) {
        const failedAt = ++now; // the first tick after a failed build starts the wait
        nightTick(agent, { now, ops: o });
        now = failedAt + RETRY_MS - 1;
        nightTick(agent, { now, ops: o });
        await settle(agent);
        assert.equal(o.builds.length, i, 'not before RETRY_MS');
        now = failedAt + RETRY_MS;
        nightTick(agent, { now, ops: o });
        await settle(agent);
    }
    assert.equal(o.builds.length, BUILD_ATTEMPTS);
    assert.ok(RETRY_MS >= 10_000);
    assert.equal(nightState(agent).state, 'exposed');
    assert.match(agent.chat.at(-1), /\[night\] no shelter after 3 tries \(A shelter at 0, 64, 0 needs 10 sturdy blocks \(cobblestone or stone\); you have 3\.\); staying here until morning/);
    assert.equal(nightTick(agent, { now: now + 1, ops: o }), 'night:exposed');
    agent.bot.time.timeOfDay = MORNING;
    assert.equal(nightTick(agent, { now: now + 2, ops: o }), null, 'morning: back to work');
});

test('#381 review 2: a build refused because the bot was not at rest on the floor is no try: planned again at once, a hole is not next; after SETTLE.retries in a row one counts', async (t) => {
    quiet(t);
    const { SETTLE } = await import('./library/shelter.js');
    const agent = fakeAgent({ t: NIGHT });
    const o = ops({ closed: false });
    let unsettled = true;
    const build = o.buildShelter;
    o.buildShelter = (bot, opts) => (unsettled
        ? (o.builds.push(null), Promise.resolve({ closed: false, unsettled: true, feet: SITE, line: 'Not building the shelter at 0, 64, 0: you are not standing on its floor (at 0.50, 65.40, 0.50 (in the air)).' }))
        : build(bot, opts));
    o.digPit = () => { o.calls = (o.calls ?? []).concat('pit'); return Promise.resolve(null); };
    for (let i = 0; i < SETTLE.retries; i++) {
        nightTick(agent, { now: i, ops: o });
        await settle(agent);
        assert.equal(nightState(agent).attempts, 0, `not a try (${i + 1})`);
        assert.equal(nightState(agent).nextAt, 0, 'planned again at once');
        assert.equal(nightState(agent).pitNext, false, 'no hole instead');
    }
    assert.equal(o.builds.length, SETTLE.retries);
    // One more in a row counts as a failed build (bounded: a bot bobbing all night is not stuck here).
    nightTick(agent, { now: 10, ops: o });
    await settle(agent);
    assert.equal(nightState(agent).attempts, 1);
    // A closed shelter clears the count.
    unsettled = false;
    o.buildShelter = (bot, opts) => { o.builds.push(opts?.site ?? null); return Promise.resolve({ closed: true, feet: SITE, line: 'Shelter closed' }); };
    nightState(agent).pitNext = false;
    nightTick(agent, { now: 20, ops: o });
    await settle(agent);
    assert.equal(nightState(agent).state, 'inside');
    assert.equal(nightState(agent).unsettled, 0);
});

test('D2b-2: at the sunrise it stays in; at full daylight it digs out and hands back to the agenda', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    agent.bot.time.timeOfDay = SUNRISE;
    assert.equal(nightTick(agent, { now: 1, ops: o }), 'night:inside');
    assert.equal(o.digs, 0);
    agent.bot.time.timeOfDay = MORNING;
    assert.equal(nightTick(agent, { now: 2, ops: o }), 'night:inside', 'digging out');
    await settle(agent);
    assert.equal(o.digs, 1);
    assert.equal(agent.bot.rotnSheltered, false);
    assert.match(agent.chat.at(-1), /\[night\] morning: dug out of the shelter at 1, 64, 0; back to work/);
    assert.equal(nightTick(agent, { now: 3, ops: o }), null, 'the priority stack goes on to tasks and the agenda');
});

test('gate2 B: out of its shelter, the log says where the bot was and its floor block at closing, and where it is and what the floor is now', async (t) => {
    quiet(t);
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    const agent = fakeAgent({ t: NIGHT });
    const world = { '0,63,0': 'stone_slab' };
    Object.assign(agent.bot, { blockAt: (p) => ({ name: world[`${p.x},${p.y},${p.z}`] ?? 'dirt', position: p }) });
    agent.bot.entity.onGround = true;
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    assert.ok(logs.some(l => /in the shelter at 0, 64, 0 until morning/.test(l)), logs.join('\n'));
    // The floor went and the bot is one block lower (gate2 B, 00:19:39).
    world['0,63,0'] = 'air';
    Object.assign(agent.bot.entity, { position: new Vec3(0.5, 63, 0.5), onGround: true });
    nightTick(agent, { now: 1, ops: o });
    assert.equal(nightTick(agent, { now: CHECK_MS + 1, ops: o }), 'night:building');
    assert.ok(logs.includes('[night] out of the shelter at 0, 64, 0: at closing at 0.50, 64.00, 0.50 (on the ground) on stone_slab; '
        + 'now at 0.50, 63.00, 0.50 (on the ground), its floor at 0, 63, 0 is air'), logs.join('\n'));
    assert.match(agent.chat.at(-1), /no longer in the shelter at 0, 64, 0: building a new one$/, 'the chat line stays short');
});

test('D2b-2: in the priority stack a control hold beats the night, and the night beats a queued task', (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    agent.control = { blocking: () => 'stop' };
    assert.equal(autonomyTick(agent, { now: 0 }), 'held:stop');
    assert.equal(nightState(agent).state, 'day', 'the night routine did not run under the hold');
    agent.control = { blocking: () => null };
    let started = 0;
    agent.tasks = { current: () => ({ id: 't1', status: 'queued', text: 'x' }), get: () => null, start: () => { started++; } };
    const res = autonomyTick(agent, { now: 1 });
    assert.match(res, /^night:/);
    assert.equal(started, 0, 'the task waits for the morning');
});

test('D2b-2: modes that would walk, dig or light the bot out are quiet while it is sheltered', () => {
    const bot = { rotnSheltered: true };
    for (const m of SHELTER_QUIET_MODES) assert.equal(shelterQuiet(m, bot), true, m);
    assert.equal(shelterQuiet('self_preservation', bot), false, 'fire, lava and falling blocks always count');
    bot.rotnSheltered = 'open';
    assert.equal(shelterQuiet('self_defense', bot), false, 'fights at the opening');
    assert.equal(shelterQuiet('cowardice', bot), true);
    bot.rotnSheltered = false;
    assert.equal(shelterQuiet('cowardice', bot), false);
});

test('D2b-2: digOut opens the lower and upper wall on a side with no water or lava outside', async (t) => {
    quiet(t);
    const key = (p) => `${p.x},${p.y},${p.z}`;
    const world = new Map();
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { world.set(`${x},64,${z}`, 'cobblestone'); world.set(`${x},65,${z}`, 'cobblestone'); }
    world.set('2,64,0', 'water'); // east is wet outside
    const dug = [];
    const blockOf = (name, position) => ({ name, metadata: 0, boundingBox: reg.blocksByName[name].boundingBox, position, canHarvest: () => true });
    const bot = {
        output: '',
        entity: { position: new Vec3(0.5, 64, 0.5) },
        modes: { isOn: () => false },
        game: { gameMode: 'survival' },
        tool: { equipForBlock: async () => {} },
        heldItem: null,
        blockAt: (p) => blockOf(world.get(key(p.floored())) ?? (p.y < 64 ? 'dirt' : 'air'), p.floored()),
        dig: (b) => { world.set(key(b.position), 'air'); dug.push(key(b.position)); return Promise.resolve(); },
    };
    withPick(bot);
    const side = await digOut(bot, SITE);
    assert.ok(side.equals(new Vec3(-1, 64, 0)), `opened ${side}`);
    assert.deepEqual(dug, ['-1,65,0', '-1,64,0']);
});

// #204 review.
test('#204 review 1: while a reflex acts nothing starts; an interrupted build is not a try', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    agent.modeActive = true; // self_defense is fighting
    assert.equal(nightTick(agent, { now: 0, ops: o }), 'night:day');
    assert.deepEqual(o.builds, [], 'no build while the fight runs');
    agent.modeActive = false;
    agent.actions.interruptNext = true; // the next build is stopped by a reflex
    nightTick(agent, { now: 1, ops: o });
    await settle(agent);
    assert.equal(nightState(agent).attempts, 0, 'not counted');
    assert.equal(nightState(agent).state, 'building');
    nightTick(agent, { now: 2, ops: o }); // at once, no RETRY_MS wait
    await settle(agent);
    assert.equal(nightState(agent).state, 'inside');
});

test('#204 review 2: a shelter that is no longer usable (fire, lava, a block inside) is left for a new one', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    nightTick(agent, { now: 1, ops: o });
    o.siteNeeds = () => null;
    o.siteProblem = () => ({ text: 'lava at 0, 65, 0 (lava in the 1x2 space)' });
    assert.equal(nightTick(agent, { now: CHECK_MS + 1, ops: o }), 'night:building');
    assert.equal(agent.bot.rotnSheltered, false, 'the movers are back on');
    assert.match(agent.chat.at(-1), /the shelter at 0, 64, 0 is no longer usable: lava at 0, 65, 0 \(lava in the 1x2 space\); building a new one/);
});

test('#204 review 3: at dusk a running action gets DUSK_WAIT_MS, then it is stopped; by night at once', (t) => {
    quiet(t);
    const agent = fakeAgent({ t: DUSK });
    const o = ops();
    agent.actions.executing = true;
    agent.actions.currentActionLabel = 'action:collectBlocks';
    agent.actions.stop = function () { this.stops++; return Promise.resolve(); }; // it takes a moment to stop
    assert.equal(nightTick(agent, { now: 0, ops: o }), 'night:waiting');
    assert.equal(nightTick(agent, { now: DUSK_WAIT_MS - 1, ops: o }), 'night:waiting');
    assert.equal(agent.actions.stops, 0);
    nightTick(agent, { now: DUSK_WAIT_MS, ops: o });
    nightTick(agent, { now: DUSK_WAIT_MS + 1, ops: o });
    assert.equal(agent.actions.stops, 1, 'stopped once');

    const late = fakeAgent({ t: NIGHT });
    late.actions.executing = true;
    nightTick(late, { now: 0, ops: o });
    assert.equal(late.actions.stops, 1, 'at night at once');
    assert.equal(nightTick(late, { now: 1, ops: o }), 'night:building', 'then it builds');
});

test("#204 review 4: a giver's typed !goal runs first at night, and the giver is told once", (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    agent.self_prompter.goal_by = 'JQDAW'; // isGiverGoal: active, not the routine's prompt, typed by a giver
    const o = ops();
    assert.equal(nightTick(agent, { now: 0, ops: o }), 'night:yield');
    assert.equal(nightTick(agent, { now: 1, ops: o }), 'night:yield');
    assert.equal(agent.calls.stop, 0, 'the goal is not stopped');
    assert.deepEqual(o.builds, []);
    assert.deepEqual(agent.chat, ['[night] it is night; your goal runs first, and I see to the shelter when it is done']);
    agent.self_prompter.goal_by = null;
    assert.match(nightTick(agent, { now: 2, ops: o }), /^night:/);
    assert.equal(agent.calls.stop, 1, 'its goal done, the routine takes over');
});

test('#204 review 6: death, spawn and turning the routine off clear the shelter; a job ending after a reset changes nothing', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    let finish;
    const o = ops();
    o.buildShelter = () => new Promise(resolve => { finish = resolve; });
    nightTick(agent, { now: 0, ops: o });
    await new Promise(resolve => setTimeout(resolve, 0)); // the build is under way
    resetNight(agent, 'death');
    finish({ closed: true, feet: SITE, line: 'Shelter closed' });
    await settle(agent);
    assert.equal(nightState(agent).state, 'day', 'the build finished after the death: no shelter recorded');
    assert.equal(agent.bot.rotnSheltered, false);

    const off = fakeAgent({ t: NIGHT });
    nightTick(off, { now: 0, ops: ops() });
    await settle(off);
    assert.equal(off.bot.rotnSheltered, true);
    settings.night_shelter = false;
    try {
        assert.equal(nightTick(off, { now: 1, ops: ops() }), null);
        assert.equal(off.bot.rotnSheltered, false);
        assert.equal(nightState(off).state, 'day');
    } finally {
        delete settings.night_shelter;
    }
});

test('#204 review 5: digOut skips a side under gravel, a hillside and a side it cannot open, and opens a safe one', async (t) => {
    quiet(t);
    const key = (p) => `${p.x},${p.y},${p.z}`;
    const world = new Map();
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { world.set(`${x},64,${z}`, 'cobblestone'); world.set(`${x},65,${z}`, 'cobblestone'); }
    world.set('1,66,0', 'gravel'); // east: gravel above the upper opening
    world.set('-2,64,0', 'stone'); world.set('-2,65,0', 'stone'); // west: a hillside
    world.set('0,64,1', 'bedrock'); // south: cannot be dug
    const blockOf = (name, position) => ({ name, metadata: 0, boundingBox: reg.blocksByName[name].boundingBox, position, canHarvest: () => name !== 'bedrock' });
    const dug = [];
    const bot = {
        output: '',
        entity: { position: new Vec3(0.5, 64, 0.5) },
        modes: { isOn: () => false },
        game: { gameMode: 'survival' },
        tool: { equipForBlock: async () => {} },
        heldItem: null,
        blockAt: (p) => blockOf(world.get(key(p.floored())) ?? (p.y < 64 ? 'dirt' : 'air'), p.floored()),
        dig: (b) => { world.set(key(b.position), 'air'); dug.push(key(b.position)); return Promise.resolve(); },
    };
    withPick(bot);
    const side = await digOut(bot, SITE);
    assert.ok(side.equals(new Vec3(0, 64, -1)), `opened ${side}`);
    assert.ok(!dug.includes('1,65,0') && !dug.includes('-1,65,0'), 'east and west untouched');
    assert.ok(dug.includes('0,64,-1') && dug.includes('0,65,-1'));
});

test('#204 review 6: the agent clears the shelter on death and on spawn', async () => {
    const { EventEmitter } = await import('node:events');
    const { Agent } = await import('./agent.js');
    const agent = Object.create(Agent.prototype);
    agent.bot = new EventEmitter();
    agent.bindNightReset();
    for (const event of ['death', 'spawn']) {
        agent.bot.rotnSheltered = true;
        agent._night = { state: 'inside', site: SITE, gen: 0 };
        agent.bot.emit(event);
        assert.equal(agent.bot.rotnSheltered, false, event);
        assert.equal(agent._night.state, 'day', event);
        assert.equal(agent._night.gen, 1, `${event}: a job still running changes nothing`);
    }
});

test("#204 re-review 1: a giver's !goal or typed command from inside the shelter turns the shelter's rules off; afterwards it shelters again", async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    assert.equal(agent.bot.rotnSheltered, true);

    agent.self_prompter.goal_by = 'JQDAW'; // the giver typed !goal: it runs the self-prompter
    agent.self_prompter.active = true;
    assert.equal(nightTick(agent, { now: 1, ops: o }), 'night:yield');
    assert.equal(agent.bot.rotnSheltered, false, 'cowardice and self_defense act again outside');
    assert.equal(nightState(agent).state, 'building');
    agent.self_prompter.goal_by = null; // the goal is done
    agent.self_prompter.active = false;
    nightTick(agent, { now: 2, ops: o });
    await settle(agent);
    assert.equal(o.builds.length, 2, 'built again (or found closed) after the goal');
    assert.equal(agent.bot.rotnSheltered, true);

    // A typed command (a control hold of kind 'command') does the same; !stop does not.
    agent.control = { blocking: () => 'stop' };
    assert.equal(autonomyTick(agent, { now: 3 }), 'held:stop');
    assert.equal(agent.bot.rotnSheltered, true, '!stop keeps it in place, so still sheltered');
    agent.control = { typed: 1, blocking: () => 'command' }; // a real Control: 'command' means typed > 0
    assert.equal(autonomyTick(agent, { now: 4 }), 'held:command');
    assert.equal(agent.bot.rotnSheltered, false);
    assert.equal(nightState(agent).state, 'building');
});

test('#204 nit: a typed command during a stored !stfu or !pause hold also turns the shelter rules off', async (t) => {
    quiet(t);
    for (const kind of ['quiet', 'pause', 'stop']) {
        const agent = fakeAgent({ t: NIGHT });
        nightTick(agent, { now: 0, ops: ops() });
        await settle(agent);
        assert.equal(agent.bot.rotnSheltered, true);
        agent.control = { typed: 0, blocking() { return kind; } };
        assert.equal(autonomyTick(agent, { now: 1 }), `held:${kind}`);
        assert.equal(agent.bot.rotnSheltered, true, `${kind} alone keeps it sheltered`);
        agent.control.typed = 1; // a giver's typed action runs under the hold
        assert.equal(autonomyTick(agent, { now: 2 }), `held:${kind}`);
        assert.equal(agent.bot.rotnSheltered, false, `${kind} + a typed action: the rules are off`);
        assert.equal(nightState(agent).state, 'building');
    }
});

// #229 review: the bot built its shelter with a pickaxe in the off hand, then could not dig out:
// mineflayer-tool's equipForBlock looks in inventory.items() only. digOut moves it back first.
test('#229 review: digOut with the pickaxe in the off hand moves it back, equips it and digs', async (t) => {
    quiet(t);
    const key = (p) => `${p.x},${p.y},${p.z}`;
    const world = new Map();
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { world.set(`${x},64,${z}`, 'cobblestone'); world.set(`${x},65,${z}`, 'cobblestone'); }
    const dug = [];
    const blockOf = (name, position) => ({ name, metadata: 0, boundingBox: reg.blocksByName[name].boundingBox, position, canHarvest: () => true });
    const slots = new Array(46).fill(null);
    slots[45] = { name: 'stone_pickaxe', count: 1, metadata: 0 };
    const inventory = {
        slots, selectedItem: null,
        items: () => slots.slice(9, 45).filter(Boolean),
        firstEmptyInventorySlot: () => { const i = slots.findIndex((x, k) => k >= 9 && k < 45 && !x); return i < 0 ? null : i; },
    };
    const bot = {
        output: '', inventory,
        entity: { position: new Vec3(0.5, 64, 0.5) },
        modes: { isOn: () => false },
        game: { gameMode: 'survival' },
        heldItem: null,
        // like mineflayer-tool: the best tool among inventory.items() only
        tool: { equipForBlock: () => { bot.heldItem = inventory.items().find(i => /pickaxe/.test(i.name)) ?? null; return Promise.resolve(); } },
        moveSlotItem: (from, to) => { slots[to] = slots[from]; slots[from] = null; return Promise.resolve(); },
        equip: (item) => { bot.heldItem = item; return Promise.resolve(); },
        blockAt: (p) => blockOf(world.get(key(p.floored())) ?? (p.y < 64 ? 'dirt' : 'air'), p.floored()),
        // like the server: cobblestone does not break by hand
        dig: (b) => {
            if (!/pickaxe/.test(bot.heldItem?.name ?? '')) return Promise.reject(new Error('no pickaxe in hand'));
            world.set(key(b.position), 'air'); dug.push(key(b.position)); return Promise.resolve();
        },
    };
    const side = await digOut(bot, SITE);
    assert.ok(side, 'it got out');
    assert.equal(dug.length, 2);
    assert.equal(slots[45], null, 'the pickaxe left the off hand');
});

// G3 round 6 B: a shelter of dirt (the fallback, or after a death with no pickaxe).
test('G3 round 6 B: inside a dirt shelter its dirt walls are no breach, and a repair keeps them', async (t) => {
    quiet(t);
    const { siteNeeds } = await import('./library/shelter.js');
    const key = (p) => `${p.x},${p.y},${p.z}`;
    const world = new Map();
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { world.set(`${x},64,${z}`, 'dirt'); world.set(`${x},65,${z}`, 'dirt'); }
    world.set('0,66,0', 'dirt');
    const agent = fakeAgent({ t: NIGHT });
    agent.bot.blockAt = (p) => {
        const q = p.floored();
        const name = world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air');
        return { name, metadata: 0, boundingBox: reg.blocksByName[name].boundingBox, position: q };
    };
    const o = ops();
    const opts = [];
    o.buildShelter = (bot, op = {}) => { opts.push(op); return Promise.resolve({ closed: true, feet: SITE, line: 'Shelter closed' }); };
    o.siteNeeds = siteNeeds; // the real check, on the dirt shell
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    nightTick(agent, { now: 1, ops: o });
    nightTick(agent, { now: CHECK_MS + 1, ops: o });
    await settle(agent);
    assert.equal(opts.length, 1, 'no repair: dirt walls are walls');
    assert.equal(agent.bot.rotnSheltered, true);

    world.set('1,65,0', 'air'); // a mob dug through
    nightTick(agent, { now: 2 * CHECK_MS + 2, ops: o });
    await settle(agent);
    assert.equal(opts.length, 2);
    assert.deepEqual({ site: opts[1].site, keepSoft: opts[1].keepSoft }, { site: SITE, keepSoft: true }, 'the repair fills the hole and keeps the dirt');
    assert.match(agent.chat.at(-1), /\[night\] the shelter is open at 1, 65, 0: repairing/);
});

test('G3 round 6 B: digOut opens a dirt side first (by hand), not the cobblestone ones', async (t) => {
    quiet(t);
    const key = (p) => `${p.x},${p.y},${p.z}`;
    const world = new Map();
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { world.set(`${x},64,${z}`, 'cobblestone'); world.set(`${x},65,${z}`, 'cobblestone'); }
    world.set('0,64,1', 'dirt'); world.set('0,65,1', 'dirt'); // south: dirt
    const dug = [];
    const bot = {
        output: '',
        entity: { position: new Vec3(0.5, 64, 0.5) },
        modes: { isOn: () => false },
        game: { gameMode: 'survival' },
        tool: { equipForBlock: async () => {} },
        heldItem: null,
        inventory: { items: () => [], slots: [] },
        blockAt: (p) => {
            const q = p.floored();
            const name = world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air');
            return { name, metadata: 0, boundingBox: reg.blocksByName[name].boundingBox, position: q, canHarvest: () => true };
        },
        dig: (b) => { world.set(key(b.position), 'air'); dug.push(key(b.position)); return Promise.resolve(); },
    };
    const side = await digOut(bot, SITE);
    assert.ok(side.equals(new Vec3(0, 64, 1)), `opened ${side}`);
    assert.deepEqual(dug, ['0,65,1', '0,64,1'], 'only the dirt side');
});

// G3 round 7 B: the bot left a closed shelter at night ("no longer usable (fire, lava or a block
// inside)", naming nothing), and a zombie killed it outside.
test('G3 round 7 B: inside, a dropped item, a carpet or snow in the space, or a wall of a block named "...fire..." keeps the shelter; a solid block or lava ends it, and the line says what and where', async (t) => {
    quiet(t);
    const { siteNeeds, siteProblem } = await import('./library/shelter.js');
    const key = (p) => `${p.x},${p.y},${p.z}`;
    const world = new Map();
    const walls = () => {
        for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { world.set(`${x},64,${z}`, 'cobblestone'); world.set(`${x},65,${z}`, 'cobblestone'); }
        world.set('0,66,0', 'cobblestone');
    };
    walls();
    const shelter = () => {
        const agent = fakeAgent({ t: NIGHT });
        agent.bot.blockAt = (p) => {
            const q = p.floored();
            const name = world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air');
            // A block the vanilla registry does not know (a modded one) is a whole block here.
            return { name, metadata: 0, boundingBox: reg.blocksByName[name]?.boundingBox ?? 'block', position: q };
        };
        // A dropped stack where the bot stands: an entity, never a block.
        agent.bot.entities = { 7: { type: 'object', name: 'item', position: new Vec3(0.5, 64.2, 0.5) } };
        const o = ops();
        o.siteNeeds = siteNeeds; // the real checks
        o.siteProblem = siteProblem;
        return { agent, o };
    };
    const { agent, o } = shelter();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    nightTick(agent, { now: 1, ops: o });
    let now = 1;
    const check = () => { now += CHECK_MS + 1; return nightTick(agent, { now, ops: o }); };

    world.set('0,64,0', 'carpet'); // mineflayer: a 'block' bounding box; rotn-data: not solid
    assert.equal(check(), 'night:inside');
    world.set('0,64,0', 'snow_layer');
    assert.equal(check(), 'night:inside');
    world.set('1,64,0', 'iceandfire:chared_stone'); // "fire" in the name, rock: a wall
    assert.equal(check(), 'night:inside');
    assert.equal(o.builds.length, 1, 'no new shelter and no repair');
    assert.equal(agent.bot.rotnSheltered, true);
    assert.ok(!agent.chat.some(l => /no longer usable/.test(l)), agent.chat.join('\n'));

    world.set('0,65,0', 'cobblestone'); // a solid block where the bot's head is
    assert.equal(check(), 'night:building');
    assert.match(agent.chat.at(-1), /^\[night\] the shelter at 0, 64, 0 is no longer usable: cobblestone at 0, 65, 0 \(a solid block in the 1x2 space\); building a new one$/);

    world.clear(); walls();
    world.set('0,64,-1', 'lava');
    const lava = shelter();
    lava.o.siteNeeds = () => ({ todo: [] }); // closed when it was built
    nightTick(lava.agent, { now: 0, ops: lava.o });
    await settle(lava.agent);
    nightTick(lava.agent, { now: 1, ops: lava.o });
    lava.o.siteNeeds = siteNeeds;
    assert.equal(nightTick(lava.agent, { now: CHECK_MS + 2, ops: lava.o }), 'night:building');
    assert.match(lava.agent.chat.at(-1), /no longer usable: lava at 0, 64, -1 \(lava in the walls or roof\); building a new one$/);

    // #296 review 1: water at the bot's feet keeps the shelter; water at head height drowns it.
    world.clear(); walls();
    const wet = shelter();
    nightTick(wet.agent, { now: 0, ops: wet.o });
    await settle(wet.agent);
    nightTick(wet.agent, { now: 1, ops: wet.o });
    world.set('0,64,0', 'water');
    assert.equal(nightTick(wet.agent, { now: CHECK_MS + 2, ops: wet.o }), 'night:inside');
    world.set('0,65,0', 'water');
    assert.equal(nightTick(wet.agent, { now: 2 * CHECK_MS + 3, ops: wet.o }), 'night:building');
    assert.match(wet.agent.chat.at(-1), /no longer usable: water at 0, 65, 0 \(a liquid at head height: the bot would drown\); building a new one$/);
});

test('#331 review 4: while a wall is known open, every tick checks and repairs (not every CHECK_MS); the line is said once', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    nightTick(agent, { now: 1, ops: o }); // starts the check clock
    o.open = [SITE.offset(1, 1, 0)];
    // The repair makes progress but does not close it (one of two cells placed).
    o.buildShelter = (bot, opts = {}) => { o.builds.push(opts.site ?? null); return Promise.resolve({ closed: false, feet: SITE, placed: 1 }); };
    nightTick(agent, { now: CHECK_MS + 2, ops: o });
    await settle(agent);
    assert.equal(agent.bot.rotnSheltered, 'open');
    assert.equal(o.builds.length, 2);
    nightTick(agent, { now: CHECK_MS + 3, ops: o }); // one tick later: not CHECK_MS later
    await settle(agent);
    assert.equal(o.builds.length, 3, 'repaired again at once');
    assert.equal(agent.chat.filter(l => /the shelter is open/.test(l)).length, 1, 'said once, then logged');
    o.open = []; // closed again (another repair, a block placed)
    nightTick(agent, { now: CHECK_MS + 4, ops: o });
    assert.equal(agent.bot.rotnSheltered, true, 'the shelter\'s rules are back');
});

test('#331 re-review: a repair that placed nothing waits CHECK_MS again (no repair every tick all night), unless a fight in place ended since', async (t) => {
    quiet(t);
    const warns = [];
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    nightTick(agent, { now: 1, ops: o });
    o.open = [SITE.offset(1, 0, 0)];
    // No blocks left (or a mob in the cell): the repair places nothing.
    o.buildShelter = (bot, opts = {}) => { o.builds.push(opts.site ?? null); return Promise.resolve({ closed: false, feet: SITE, placed: 0, line: 'no dirt' }); };
    let now = CHECK_MS + 2;
    nightTick(agent, { now, ops: o });
    await settle(agent);
    assert.equal(o.builds.length, 2, 'the first repair');
    for (let i = 0; i < 20; i++) { now += 300; nightTick(agent, { now, ops: o }); await settle(agent); } // 6 s of ticks
    assert.equal(o.builds.length, 2, 'no repair on every tick');
    now += CHECK_MS;
    nightTick(agent, { now, ops: o });
    await settle(agent);
    assert.equal(o.builds.length, 3, 'again after CHECK_MS');
    assert.equal(warns.filter(w => /placed nothing/.test(w)).length, 1, 'said once in the log, not on every try');
    // A fight in place ends (the mob in the cell is gone or knocked back): the next tick tries at once.
    agent.bot.rotnFightEndedAt = 12345;
    now += 300;
    nightTick(agent, { now, ops: o });
    await settle(agent);
    assert.equal(o.builds.length, 4, 'at once after a fight');
});

// ---- G3 round 9 batch B, fix (e): a mob digging a shelter block is noticed while it digs ----
// At 13:35:22 the check found the east side already open, with the zombie in it (Epic Siege Mod's
// digging zombies). The dig shows first as block break progress, which mineflayer emits as
// blockBreakProgressObserved(block, destroyStage, entity).

test('round 9 B (e): digging seen on a shelter block makes the next tick check at once (not after CHECK_MS) with a block in hand', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const events = new EventEmitter();
    const equipped = [];
    Object.assign(agent.bot, {
        on: events.on.bind(events), emit: events.emit.bind(events),
        inventory: { items: () => [{ name: 'dirt', metadata: 0, count: 4 }] },
        heldItem: null,
        equip: (item) => { equipped.push(item.name); return Promise.resolve(); },
    });
    const o = ops();
    let checks = 0;
    const needs = o.siteNeeds;
    o.siteNeeds = (...a) => { checks++; return needs(...a); };
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    assert.equal(nightState(agent).state, 'inside');
    nightTick(agent, { now: 1, ops: o }); // starts the check clock

    // Digging next to the shelter but not at it: nothing.
    agent.bot.emit('blockBreakProgressObserved', { position: new Vec3(5, 64, 0) }, 2, { name: 'zombie' });
    nightTick(agent, { now: 2, ops: o });
    assert.equal(checks, 0);

    // A zombie digs the east wall (stage 3 of 9).
    agent.bot.emit('blockBreakProgressObserved', { position: SITE.offset(1, 0, 0) }, 3, { name: 'zombie' });
    nightTick(agent, { now: 3, ops: o });
    assert.equal(checks, 1, 'checked at once, not after CHECK_MS');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(equipped, ['dirt'], 'a block in hand for the repair');

    // It breaks through: the repair starts on the next tick.
    o.open = [SITE.offset(1, 0, 0)];
    nightTick(agent, { now: 4, ops: o });
    assert.equal(agent.bot.rotnSheltered, 'open');
    await settle(agent);
    assert.deepEqual(o.builds, [null, SITE], 'repaired at once');
});

// ---- #334 after #331 (lead): the dig alarm and #331's no-progress stall, and the fight's weapon ----

test('#334 after #331: digging seen at the shelter ends a no-progress stall wait: the next tick checks and repairs', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const events = new EventEmitter();
    Object.assign(agent.bot, { on: events.on.bind(events), emit: events.emit.bind(events), inventory: { items: () => [] }, heldItem: null, equip: () => Promise.resolve() });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    nightTick(agent, { now: 1, ops: o });
    o.open = [SITE.offset(1, 0, 0)];
    o.buildShelter = (bot, opts = {}) => { o.builds.push(opts.site ?? null); return Promise.resolve({ closed: false, feet: SITE, placed: 0 }); };
    let now = CHECK_MS + 2;
    nightTick(agent, { now, ops: o });
    await settle(agent);
    now += 300;
    nightTick(agent, { now, ops: o });
    await settle(agent);
    assert.equal(o.builds.length, 2, 'stalled: no repair on the next tick');
    agent.bot.emit('blockBreakProgressObserved', { position: SITE.offset(-1, 1, 0) }, 4, { name: 'zombie' });
    now += 300;
    nightTick(agent, { now, ops: o });
    await settle(agent);
    assert.equal(o.builds.length, 3, 'the dig alarm ends the stall wait');
});

test('#334 after #331: the dig alarm puts no block in hand while a fight in place runs (its weapon stays)', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const events = new EventEmitter();
    const equipped = [];
    Object.assign(agent.bot, {
        on: events.on.bind(events), emit: events.emit.bind(events),
        inventory: { items: () => [{ name: 'dirt', metadata: 0, count: 4 }] }, heldItem: { name: 'stone_sword' },
        equip: (item) => { equipped.push(item.name); return Promise.resolve(); },
    });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    agent.bot.rotnFightingInPlace = true;
    agent.bot.emit('blockBreakProgressObserved', { position: SITE.offset(1, 0, 0) }, 3, { name: 'zombie' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(equipped, [], 'no dirt in hand mid-fight');
    assert.ok(nightState(agent).digAt, 'the alarm itself is still raised');
});

test('#334 re-review: one dig at one block, with events on every tick, ends a no-progress stall at most once (no repair every 300 ms)', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const events = new EventEmitter();
    Object.assign(agent.bot, { on: events.on.bind(events), emit: events.emit.bind(events), inventory: { items: () => [] }, heldItem: null, equip: () => Promise.resolve() });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    nightTick(agent, { now: 1, ops: o });
    o.open = [SITE.offset(1, 0, 0)];
    o.buildShelter = (bot, opts = {}) => { o.builds.push(opts.site ?? null); return Promise.resolve({ closed: false, feet: SITE, placed: 0 }); };
    let now = CHECK_MS + 2;
    nightTick(agent, { now, ops: o });
    await settle(agent);
    const afterStall = o.builds.length;
    // An Epic Siege Mod zombie digs the west wall: an event every few ticks, 20 ticks (6 s).
    for (let i = 0; i < 20; i++) {
        agent.bot.emit('blockBreakProgressObserved', { position: SITE.offset(-1, 0, 0) }, i % 10, { name: 'zombie' });
        now += 300;
        nightTick(agent, { now, ops: o });
        await settle(agent);
    }
    assert.ok(o.builds.length - afterStall <= 1, `${o.builds.length - afterStall} repairs in 20 ticks of digging (the reviewer saw 20)`);
    // Digging at another block is new digging: the stall ends once more.
    const before = o.builds.length;
    agent.bot.emit('blockBreakProgressObserved', { position: SITE.offset(0, 2, 0) }, 1, { name: 'zombie' });
    now += 300;
    nightTick(agent, { now, ops: o });
    await settle(agent);
    assert.equal(o.builds.length, before + 1);
});

test('#334 re-review 2: two diggers on different shelter blocks, events alternating, let a stalled repair through at most once per block', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const events = new EventEmitter();
    Object.assign(agent.bot, { on: events.on.bind(events), emit: events.emit.bind(events), inventory: { items: () => [] }, heldItem: null, equip: () => Promise.resolve() });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    nightTick(agent, { now: 1, ops: o });
    o.open = [SITE.offset(1, 0, 0)];
    o.buildShelter = (bot, opts = {}) => { o.builds.push(opts.site ?? null); return Promise.resolve({ closed: false, feet: SITE, placed: 0 }); };
    let now = CHECK_MS + 2;
    nightTick(agent, { now, ops: o });
    await settle(agent);
    const afterStall = o.builds.length;
    const A = SITE.offset(-1, 0, 0), B = SITE.offset(0, 0, 1);
    for (let i = 0; i < 30; i++) {
        agent.bot.emit('blockBreakProgressObserved', { position: i % 2 ? B : A }, i % 10, { name: 'zombie' });
        now += 300;
        nightTick(agent, { now, ops: o });
        await settle(agent);
    }
    assert.ok(o.builds.length - afterStall <= 2, `${o.builds.length - afterStall} repairs in 30 ticks (the reviewer saw 30)`);
});

test('#334 re-review 2 nit: a reset, leaving for a giver and a new shelter clear the repair stall', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    const n = nightState(agent);
    n.repairStall = { fightEndedAt: null, dug: new Set(['1,64,0']), retry: false };
    resetNight(agent, 'death');
    assert.equal(n.repairStall, null, 'reset');
    nightTick(agent, { now: 1, ops: o });
    await settle(agent);
    assert.equal(n.state, 'inside');
    n.repairStall = { fightEndedAt: null, dug: new Set(), retry: false };
    const { leaveShelterFor } = await import('./night_routine.js');
    leaveShelterFor(agent, 'a test');
    assert.equal(n.repairStall, null, 'leaving for a giver');
    n.repairStall = { fightEndedAt: null, dug: new Set(), retry: false };
    nightTick(agent, { now: 2, ops: o });
    await settle(agent);
    assert.equal(n.state, 'inside');
    assert.equal(n.repairStall, null, 'a new shelter');
});

// ---- G3 round 9 batch B, fix (h): after a night-time death with nothing ----
// The bot respawned 9 blocks from where it died, at night, with nothing (driver.log 502); the
// shelter was refused for want of dirt (501), and it died again to the zombie risen at the spot
// (server.log 575: "slain by Zombie FRCFLD").

/** A death record (death_report's shape) at time `at`, 9 blocks west of the shelter site. */
const deathAt = (at) => {
    const last = { at, pos: new Vec3(-8.5, 64, 0.5), dimension: null };
    return { last, recentSpots: (now) => (now - at < 30 * 60_000 ? [last] : []) };
};

function deathOps() {
    const o = { calls: [], away: null };
    // The real plan (respawn_relocate.nightRelocationPlan), a fake walk that gets there.
    o.nightRelocation = (agent, now, opts) => { o.relocOpts = opts; return nightRelocationPlan(agent, now, opts); };
    o.walkAwayAtNight = (bot, plan) => { o.calls.push('away'); o.away = plan; return Promise.resolve({ arrived: true, nearest: plan.away, stopped: null }); };
    o.buildShelter = (bot, opts = {}) => {
        o.calls.push(opts.site ? 'roof' : 'build');
        return Promise.resolve(opts.site
            ? { closed: true, feet: opts.site, line: 'Shelter closed' }
            : { closed: false, feet: null, line: 'Not building a shelter at 0, 64, 0: you have 0 dirt and 0 dirt piles' });
    };
    o.digPit = () => { o.calls.push('pit'); return Promise.resolve(SITE.offset(0, -3, 0)); };
    o.pitOut = () => { o.calls.push('pitOut'); return Promise.resolve(SITE.offset(3, 0, 0)); };
    o.digOut = () => { o.calls.push('digOut'); return Promise.resolve(SITE.offset(1, 0, 0)); };
    o.siteNeeds = () => ({ todo: [] });
    return o;
}

test('round 9 B (h): after a night death nearby: away from the death spot first, then a shelter; with no dirt a hole; out of the hole in the morning', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    agent._death = deathAt(-60_000); // a minute ago, 9 blocks off
    const o = deathOps();
    let now = 0;
    const run = async () => { nightTick(agent, { now: ++now, ops: o }); await settle(agent); };
    await run();
    assert.deepEqual(o.calls, ['away'], 'first away from the spot');
    assert.equal(o.away.mode, 'short', 'no weapon at night: the first spot 24 blocks from the death spots');
    assert.equal(o.away.away, 24);
    assert.deepEqual(o.relocOpts, { night: true, armed: false });
    assert.match(agent.chat.at(-1), /^\[night\] I died near here recently, and it is night and I have no weapon: moving to the first spot at least 24 blocks from 1 recent death spot, towards -?\d+, -?\d+, before sheltering$/);
    await run();
    assert.deepEqual(o.calls, ['away', 'build'], 'then the shelter, which is refused: no dirt');
    await run();
    assert.deepEqual(o.calls, ['away', 'build', 'pit', 'roof'], 'then a hole, roofed with the shelter\'s repair');
    assert.equal(nightState(agent).state, 'inside');
    assert.equal(nightState(agent).pit, true);
    assert.ok(nightState(agent).site.equals(SITE.offset(0, -3, 0)));

    agent.bot.time.timeOfDay = MORNING;
    await run();
    assert.deepEqual(o.calls.slice(-1), ['pitOut'], 'out of the hole by its stairs, not digOut');
    assert.equal(nightState(agent).state, 'day');
});

test('round 9 B (h): no walk away when the death was long ago or far off; a hole is tried once a night', async (t) => {
    quiet(t);
    const old = fakeAgent({ t: NIGHT });
    old._death = deathAt(-30 * 60_000);
    const o = deathOps();
    o.digPit = () => { o.calls.push('pit'); return Promise.resolve(null); }; // no place for a hole
    for (let now = 1; now < 3; now++) { nightTick(old, { now, ops: o }); await settle(old); }
    assert.deepEqual(o.calls, ['build', 'pit'], 'no walk: the death was 30 min ago');
    nightTick(old, { now: 3, ops: o }); // sets the next try's time
    nightTick(old, { now: 4 + RETRY_MS, ops: o }); await settle(old);
    assert.deepEqual(o.calls, ['build', 'pit', 'build'], 'the hole only once; then the build tries go on');
});

test('round 9 B (h): exposed with no weapon, the bot keeps away from mobs (cowardice) until morning', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const on = { cowardice: false };
    agent.bot.modes = { anyActive: () => false, isOn: (m) => on[m], setOn: (m, v) => { on[m] = v; return true; } };
    agent.bot.inventory = { items: () => [], slots: [] };
    const o = ops({ closed: false });
    let now = 0;
    for (let i = 0; i < 4 * BUILD_ATTEMPTS && nightState(agent).state !== 'exposed'; i++) { now += RETRY_MS + 1; nightTick(agent, { now, ops: o }); await settle(agent); }
    assert.equal(nightState(agent).state, 'exposed');
    assert.equal(on.cowardice, true);
    agent.bot.time.timeOfDay = MORNING;
    nightTick(agent, { now: now + 1, ops: o });
    assert.equal(on.cowardice, false, 'back as it was');

    const armed = fakeAgent({ t: NIGHT });
    const on2 = { cowardice: false };
    armed.bot.modes = { anyActive: () => false, isOn: (m) => on2[m], setOn: (m, v) => { on2[m] = v; return true; } };
    armed.bot.inventory = { items: () => [{ name: 'stone_sword', count: 1 }], slots: [] };
    now = 0;
    for (let i = 0; i < 4 * BUILD_ATTEMPTS && nightState(armed).state !== 'exposed'; i++) { now += RETRY_MS + 1; nightTick(armed, { now, ops: o }); await settle(armed); }
    assert.equal(nightState(armed).state, 'exposed');
    assert.equal(on2.cowardice, false, 'with a weapon its reflexes stay as they are');
});

// ---- #337 review (lead, REQUEST CHANGES on 36bb947) ----

test('#337 review 6: an interrupted hole is tried again next, in the same hole (its progress is kept)', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = deathOps();
    const seen = [];
    o.digPit = (bot, { progress }) => { seen.push(progress); progress.P ??= SITE; o.calls.push('pit'); return Promise.resolve(SITE.offset(0, -3, 0)); };
    let now = 0;
    const run = async () => { nightTick(agent, { now: ++now, ops: o }); await settle(agent); };
    await run(); // build: refused
    agent.actions.interruptNext = true;
    await run(); // the hole: interrupted (a reflex)
    assert.equal(nightState(agent).pitNext, true, 'the hole is still next');
    await run(); // the hole again
    assert.deepEqual(o.calls, ['build', 'pit', 'roof']);
    assert.equal(seen.length, 1);
    assert.equal(seen[0], nightState(agent).pitProgress, 'the same progress object');
    assert.equal(nightState(agent).state, 'inside');
});

test('soak 2 (night 2): a hole interrupted again and again (the unstuck loop) counts after FREE_INTERRUPTS; the night ends, never loops', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    agent.bot.modes = { anyActive: () => false, isOn: () => true, setOn: () => true };
    agent.bot.inventory = { items: () => [], slots: [] };
    const o = deathOps();
    // Every run is stopped by a reflex before it finishes (as unstuck did every ~22 s).
    agent.actions.runAction = (label) => { o.calls.push(`stopped ${label}`); return Promise.resolve({ message: '', interrupted: true }); };
    let now = 0;
    for (let i = 0; i < 40 && nightState(agent).state !== 'exposed'; i++) { now += RETRY_MS + 1; nightTick(agent, { now, ops: o }); await settle(agent); }
    assert.equal(nightState(agent).state, 'exposed', `the night ends (runs: ${o.calls.length})`);
    assert.ok(o.calls.length <= FREE_INTERRUPTS + BUILD_ATTEMPTS + 1, `bounded: ${o.calls.join(', ')}`);
    assert.equal(nightState(agent).attempts, BUILD_ATTEMPTS);
    assert.match(agent.chat.at(-1), /no shelter after 3 tries and a hole shelter \(interrupted again \(more than 2 times\)\)/);
});

test('soak 2: the first FREE_INTERRUPTS interruptions of a build phase (not by a threat reflex) are still free', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    for (let k = 1; k <= FREE_INTERRUPTS; k++) {
        agent.actions.interruptNext = true;
        nightTick(agent, { now: k, ops: o });
        await settle(agent);
        assert.equal(nightState(agent).attempts, 0, `interruption ${k}: not counted`);
    }
    nightTick(agent, { now: 10, ops: o });
    await settle(agent);
    assert.equal(nightState(agent).state, 'inside');
});

test('#431 review 4: a hole given up after a dig timed out says so as the night\'s reason (not "no place")', async (t) => {
    quiet(t);
    const warns = [];
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    const agent = fakeAgent({ t: NIGHT });
    const o = deathOps();
    o.digPit = (bot, { progress }) => { o.calls.push('pit'); progress.why = 'dirt:0 at 0, 63, 0 was not dug within 4.0 s; the next hole is dug elsewhere'; return Promise.resolve(null); };
    let now = 0;
    for (let i = 0; i < 3; i++) { now += RETRY_MS + 1; nightTick(agent, { now, ops: o }); await settle(agent); }
    assert.ok(o.calls.includes('pit'));
    assert.ok(warns.some(w => w.includes('(dirt:0 at 0, 63, 0 was not dug within 4.0 s; the next hole is dug elsewhere)')), warns.join('\n'));
    assert.ok(!warns.some(w => w.includes('found no place to dig a hole shelter')));
});

test('#431 review 2: a night of repeated fights (self_defense stops the build again and again) still ends in a completed shelter once it is quiet', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    agent.bot.modes = { anyActive: () => false, isOn: () => true, setOn: () => true };
    agent.bot.inventory = { items: () => [], slots: [] };
    const o = ops();
    let fights = 9, runs = 0; // 6 free threat interruptions, then the 3 tries
    o.hostileNear = () => fights > 0; // a zombie near while the fights go on
    agent.actions.runAction = async (label, fn) => {
        runs++;
        if (fights > 0) {
            fights--;
            agent.rotnLastInterrupt = { by: 'self_defense', of: label, at: 0 };
            return { message: '', interrupted: true };
        }
        await fn();
        return { message: '', interrupted: false };
    };
    let now = 0;
    const counts = [];
    for (let i = 0; i < 60 && nightState(agent).state !== 'inside'; i++) {
        now += RETRY_MS + 1;
        agent.bot.time.timeOfDay = NIGHT + i; // the night goes on (a frozen time switches the clock to the wall clock)
        nightTick(agent, { now, ops: o });
        await settle(agent);
        counts.push(nightState(agent).threatInterrupts ?? 0);
    }
    assert.equal(nightState(agent).state, 'inside', `a shelter in the end (${runs} runs)`);
    assert.ok(Math.max(...counts) <= THREAT_INTERRUPTS, 'threat interruptions bounded by THREAT_INTERRUPTS');
    assert.ok(agent.chat.some(l => /\[night\] no shelter after 3 tries \(interrupted again \(more than 6 times by a threat reflex\)\)/.test(l)), agent.chat.join('\n'));
    assert.ok(agent.chat.some(l => l === `[night] quiet for ${EXPOSED_RETRY_MS / 1000} s: trying a shelter again (1 of ${EXPOSED_RETRIES})`), 'the retry once quiet');
    assert.equal(agent.chat.at(-1), '[night] in the shelter at 0, 64, 0 until morning');
});

test('#431 review 2 (owed): an older run\'s stopper is not counted for this run', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    agent.bot.modes = { anyActive: () => false, isOn: () => true, setOn: () => true };
    agent.bot.inventory = { items: () => [], slots: [] };
    agent.rotnLastInterrupt = { by: 'self_defense', of: 'action:buildShelter', at: 1 };
    agent.actions.runAction = () => Promise.resolve({ message: '', interrupted: true }); // stopped, by no reflex this time
    nightTick(agent, { now: RETRY_MS + 1, ops: ops() });
    await settle(agent);
    assert.equal(nightState(agent).threatInterrupts ?? 0, 0, 'not counted as a threat reflex');
    assert.equal(nightState(agent).interrupts, 1);
});

test('#431 review 2: an exposed night does not retry while a hostile mob is near, nor more than EXPOSED_RETRIES times', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    agent.bot.modes = { anyActive: () => false, isOn: () => true, setOn: () => true };
    agent.bot.inventory = { items: () => [], slots: [] };
    const o = ops({ closed: false });
    let near = true;
    o.hostileNear = () => near;
    let now = 0, k = 0;
    const tick = async (ms) => { now += ms; agent.bot.time.timeOfDay = NIGHT + (k++ % 50); nightTick(agent, { now, ops: o }); await settle(agent); };
    for (let i = 0; i < 20 && nightState(agent).state !== 'exposed'; i++) await tick(RETRY_MS + 1);
    assert.equal(nightState(agent).state, 'exposed');
    const builds = o.builds.length;
    for (let i = 0; i < 5; i++) await tick(EXPOSED_RETRY_MS + 1);
    assert.equal(o.builds.length, builds, 'a mob near: no retry');
    near = false;
    for (let i = 0; i < 200; i++) await tick(RETRY_MS + 1);
    assert.equal(nightState(agent).exposedRetries, EXPOSED_RETRIES, 'bounded');
    assert.equal(nightState(agent).state, 'exposed');
});

test('#337 review 7 and 8: the tries are the 3 builds, the hole is one more; the exposed line matches what the bot does', async (t) => {
    quiet(t);
    const play = async (items) => {
        const agent = fakeAgent({ t: NIGHT });
        const on = { cowardice: false };
        agent.bot.modes = { anyActive: () => false, isOn: (m) => on[m], setOn: (m, v) => { on[m] = v; return true; } };
        agent.bot.inventory = { items: () => items, slots: [] };
        const o = deathOps();
        o.digPit = () => { o.calls.push('pit'); return Promise.resolve(null); };
        let now = 0;
        for (let i = 0; i < 20 && nightState(agent).state !== 'exposed'; i++) { now += RETRY_MS + 1; nightTick(agent, { now, ops: o }); await settle(agent); }
        return { agent, o, on };
    };
    const bare = await play([]);
    assert.deepEqual(bare.o.calls, ['build', 'pit', 'build', 'build'], '3 builds and one hole');
    assert.match(bare.agent.chat.at(-1), /no shelter after 3 tries and a hole shelter \(.*\); no weapon: keeping away from mobs until morning$/);
    assert.equal(bare.on.cowardice, true);
    const armed = await play([{ name: 'stone_sword', count: 1 }]);
    assert.match(armed.agent.chat.at(-1), /no shelter after 3 tries and a hole shelter \(.*\); staying here until morning$/);
    assert.equal(armed.on.cowardice, false);
});

// G3 gate B (0daeef2d): a pillaring zombie (Epic Siege Mod's pillar block, contenttweaker:scaffolding)
// put a block into the bot's head cell; the check called the closed stone shelter "no longer usable",
// the bot dug out into the night, fought the zombie outside and died. Then the night line was said
// twice (once while dead, once after the spawn).
function gateShelter() {
    const key = (p) => `${p.x},${p.y},${p.z}`;
    const world = new Map();
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { world.set(`${x},64,${z}`, 'cobblestone'); world.set(`${x},65,${z}`, 'cobblestone'); }
    world.set('0,66,0', 'cobblestone');
    const agent = fakeAgent({ t: NIGHT });
    agent.bot.blockAt = (p) => {
        const q = p.floored();
        const name = world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air');
        return { name, metadata: 0, boundingBox: reg.blocksByName[name]?.boundingBox ?? 'block', position: q };
    };
    // A zombie 3 blocks away, on the shelter's side.
    agent.bot.entities = { 9: { id: 9, type: 'mob', name: 'zombie', position: new Vec3(3.5, 64, 0.5), height: 1.95 } };
    return { agent, world, key };
}
async function gateOps(world, key, { breaks = true } = {}) {
    const { siteNeeds, siteProblem } = await import('./library/shelter.js');
    const { hostileNear } = await import('./night_routine.js');
    const o = ops();
    o.siteNeeds = siteNeeds; // the real checks
    o.siteProblem = siteProblem;
    o.hostileNear = hostileNear;
    o.clears = [];
    o.clearSpace = (bot, pos) => { o.clears.push(key(pos)); if (breaks) world.delete(key(pos)); return Promise.resolve(breaks); };
    return o;
}

test('G3 gate B (a): a pillar block in the head cell is broken from inside; the bot stays in its shelter', async (t) => {
    quiet(t);
    const { agent, world, key } = gateShelter();
    const o = await gateOps(world, key);
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    nightTick(agent, { now: 1, ops: o });
    world.set('0,65,0', 'contenttweaker:scaffolding');
    assert.equal(nightTick(agent, { now: CHECK_MS + 2, ops: o }), 'night:inside');
    await settle(agent);
    assert.deepEqual(o.clears, ['0,65,0'], 'the head cell is broken');
    assert.deepEqual(o.builds, [null], 'no new shelter');
    assert.equal(nightState(agent).state, 'inside');
    assert.equal(agent.bot.rotnSheltered, true, "the shelter's rules stay on");
    assert.ok(!agent.chat.some(l => /no longer usable/.test(l)), agent.chat.join('\n'));
    assert.match(agent.chat.at(-1), /^\[night\] contenttweaker:scaffolding at 0, 65, 0 \(a solid block in the 1x2 space\): breaking it from inside; staying in the shelter$/);
    assert.equal(nightTick(agent, { now: CHECK_MS + 3, ops: o }), 'night:inside', 'checked again at once: clear');
    assert.equal(o.clears.length, 1);
});

test('G3 gate B (b): a pillar block that keeps coming back is broken SPACE_CLEAR.maxClears times, then kept: the bot stays, said once', async (t) => {
    quiet(t);
    const { SPACE_CLEAR } = await import('./night_routine.js');
    const { agent, world, key } = gateShelter();
    const o = await gateOps(world, key);
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    nightTick(agent, { now: 1, ops: o });
    let now = CHECK_MS + 2;
    for (let i = 0; i < SPACE_CLEAR.maxClears + 3; i++) {
        world.set('0,65,0', 'contenttweaker:scaffolding'); // the zombie places it again
        assert.equal(nightTick(agent, { now, ops: o }), 'night:inside');
        await settle(agent);
        now += 100;
    }
    assert.equal(o.clears.length, SPACE_CLEAR.maxClears, 'bounded');
    assert.deepEqual(o.builds, [null], 'no new shelter');
    assert.equal(nightState(agent).state, 'inside');
    assert.equal(agent.bot.rotnSheltered, true);
    assert.equal(agent.chat.filter(l => /breaking it from inside/.test(l)).length, 1, 'said once, then logged');
    assert.equal(agent.chat.filter(l => /keeps coming back/.test(l)).length, 1);
    // A breach is still seen and repaired with the block kept.
    world.delete('1,64,0');
    now += CHECK_MS;
    assert.equal(nightTick(agent, { now, ops: o }), 'night:inside');
    await settle(agent);
    assert.equal(o.builds.length, 2, 'the repair ran');
    assert.ok(o.builds[1].equals(SITE));
});

test('G3 gate B (c): deadly problems still end the shelter: lava at once; a suffocating block only after the bounded breaks fail', async (t) => {
    quiet(t);
    const { SPACE_CLEAR } = await import('./night_routine.js');
    const lava = gateShelter();
    lava.agent.bot.entities = {};
    const lo = await gateOps(lava.world, lava.key);
    nightTick(lava.agent, { now: 0, ops: lo });
    await settle(lava.agent);
    nightTick(lava.agent, { now: 1, ops: lo });
    lava.world.set('0,64,0', 'lava');
    assert.equal(nightTick(lava.agent, { now: CHECK_MS + 2, ops: lo }), 'night:building');
    assert.deepEqual(lo.clears, [], 'no break for lava');
    assert.equal(lava.agent.bot.rotnSheltered, false, 'no mob near: the movers are back on');

    const rock = gateShelter();
    rock.agent.bot.entities = {};
    const ro = await gateOps(rock.world, rock.key, { breaks: false }); // no pickaxe: it cannot be broken
    nightTick(rock.agent, { now: 0, ops: ro });
    await settle(rock.agent);
    nightTick(rock.agent, { now: 1, ops: ro });
    rock.world.set('0,65,0', 'cobblestone'); // a full cube at the head: it suffocates
    let now = CHECK_MS + 2, r = null;
    for (let i = 0; i < SPACE_CLEAR.maxClears + 1; i++) { r = nightTick(rock.agent, { now, ops: ro }); await settle(rock.agent); now += 100; }
    assert.equal(ro.clears.length, SPACE_CLEAR.maxClears, 'tried first');
    assert.equal(r, 'night:building');
    assert.match(rock.agent.chat.at(-1), /no longer usable: cobblestone at 0, 65, 0 \(a solid block in the 1x2 space\); building a new one$/);
});

test('G3 gate B (d): between a death and the respawn the routine does nothing: one night line, no build while dead', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    agent.chat.length = 0;
    agent.bot.isAlive = false; // mineflayer: false before 'death' is emitted
    resetNight(agent, 'death');
    assert.equal(nightTick(agent, { now: 1, ops: o }), 'night:dead');
    assert.equal(nightTick(agent, { now: RETRY_MS + 2, ops: o }), 'night:dead');
    assert.equal(o.builds.length, 1, 'no build while dead');
    agent.bot.isAlive = true;
    resetNight(agent, 'spawn');
    nightTick(agent, { now: RETRY_MS + 3, ops: o });
    await settle(agent);
    assert.deepEqual(agent.chat, ['[night] it is night: building a shelter', '[night] in the shelter at 0, 64, 0 until morning']);
    assert.equal(o.builds.length, 2);
});

test('#355 review 2: a block that hurts on contact (cactus) in the bot\'s space is never kept: after the bounded breaks fail the bot leaves', async (t) => {
    quiet(t);
    const { SPACE_CLEAR } = await import('./night_routine.js');
    const { siteProblem } = await import('./library/shelter.js');
    const { agent, world, key } = gateShelter();
    agent.bot.entities = {};
    const o = await gateOps(world, key, { breaks: false });
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    nightTick(agent, { now: 1, ops: o });
    world.set('0,64,0', 'cactus'); // at the feet: it does not suffocate, it hurts
    const p = siteProblem(agent.bot, SITE, { occupied: true, tolerateBody: true });
    assert.equal(p?.kind, 'body', 'not tolerated');
    assert.deepEqual([p.suffocates, p.hurts], [false, true]);
    world.set('0,64,0', 'contenttweaker:scaffolding');
    assert.equal(siteProblem(agent.bot, SITE, { occupied: true, tolerateBody: true }), null, 'the pillar block is');
    world.set('0,64,0', 'cactus');
    let now = CHECK_MS + 2, r = null;
    for (let i = 0; i < SPACE_CLEAR.maxClears + 1; i++) { r = nightTick(agent, { now, ops: o }); await settle(agent); now += 100; }
    assert.equal(o.clears.length, SPACE_CLEAR.maxClears, 'tried first');
    assert.equal(r, 'night:building');
    assert.ok(!agent.chat.some(l => /keeps coming back/.test(l)), agent.chat.join('\n'));
    assert.match(agent.chat.at(-1), /no longer usable: cactus at 0, 64, 0 \(a solid block in the 1x2 space\); building a new one$/);
});

// Round 10 B: at dawn "found no safe side to open; back to work" and the bot stayed walled in at
// -34 64 -49: digOut only took a side with the two cells beyond it free, and the ground on the west
// was one block higher (the crafting table stood on it). In this terrain the other sides failed too.
const PICK = { name: 'stone_pickaxe', type: 274, metadata: 0, count: 1 };
/** #435 review: the bot of a rock shelter carries a pickaxe (the dump says rock needs one); equip puts an item in hand. */
const withPick = (bot, items = [PICK]) => Object.assign(bot, { inventory: { items: () => items, slots: [] }, equip: (item) => { bot.heldItem = item; return Promise.resolve(); } });
function exitWorld(extra = {}, { canHarvest = (name) => name !== 'bedrock', items = [PICK] } = {}) {
    const key = (p) => `${p.x},${p.y},${p.z}`;
    const world = new Map();
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { world.set(`${x},64,${z}`, 'cobblestone'); world.set(`${x},65,${z}`, 'cobblestone'); }
    world.set('0,66,0', 'cobblestone'); // the roof
    for (const [k, v] of Object.entries(extra)) world.set(k, v);
    const dug = [];
    const bot = {
        output: '',
        entity: { position: new Vec3(0.5, 64, 0.5) },
        modes: { isOn: () => false },
        game: { gameMode: 'survival' },
        tool: { equipForBlock: async () => {} },
        heldItem: null,
        inventory: { items: () => [], slots: [] },
        blockAt: (p) => {
            const q = p.floored();
            const name = world.get(key(q)) ?? (q.y < 64 ? 'dirt' : 'air');
            return { name, metadata: 0, boundingBox: reg.blocksByName[name]?.boundingBox ?? 'block', position: q, canHarvest: (tool) => canHarvest(name, tool) }; // a modded name: a solid block
        },
        dig: (b) => { world.set(key(b.position), 'air'); dug.push(key(b.position)); return Promise.resolve(); },
    };
    withPick(bot, items);
    return { bot, world, dug };
}
const ring = (y, name, k = 2) => Object.fromEntries([[k, 0], [-k, 0], [0, k], [0, -k]].map(([x, z]) => [`${x},${y},${z}`, name]));
/** Soak 2: solid stone from y 66 up to `top` within r of the shelter, so no stairs lead up (the sideways tests keep their meaning). */
const lid = (top = 72, r = 6) => Object.fromEntries(Array.from({ length: (2 * r + 1) ** 2 * (top - 65) }, (_, i) => {
    const x = (i % (2 * r + 1)) - r, z = (Math.floor(i / (2 * r + 1)) % (2 * r + 1)) - r, y = 66 + Math.floor(i / (2 * r + 1) ** 2);
    return [`${x},${y},${z}`, 'stone'];
}));

test('round 10 B: digOut takes a side whose ground is one block higher, and digs the headroom over the opening', async (t) => {
    quiet(t);
    // Every side: the ground beyond the wall is one block higher; the ring over the walls is stone.
    const { bot, world, dug } = exitWorld({ ...ring(64, 'stone'), ...ring(66, 'stone', 1) });
    const side = await digOut(bot, SITE);
    assert.ok(side?.equals(new Vec3(1, 64, 0)), `opened ${side}`);
    assert.deepEqual(dug.sort(), ['1,64,0', '1,65,0', '1,66,0'], 'the two walls and the headroom over the opening');
    assert.equal(world.get('2,64,0'), 'stone', 'the step stays');
    assert.equal(world.get('0,66,0'), 'cobblestone', 'the roof over the bot stays');
});

test('round 10 B: digOut tunnels through a hillside on every side, up to EXIT_DEPTH, to the nearest open cell', async (t) => {
    quiet(t);
    const { EXIT_DEPTH } = await import('./night_routine.js');
    // Every side: a two-high wall of stone beyond the shelter; east is open after it, the rest
    // only after two more.
    const hill = { ...ring(64, 'stone'), ...ring(65, 'stone'), ...ring(64, 'stone', 3), ...ring(65, 'stone', 3), ...ring(66, 'stone', 3) };
    delete hill['3,64,0']; delete hill['3,65,0']; delete hill['3,66,0'];
    const { bot, dug } = exitWorld(hill);
    const side = await digOut(bot, SITE);
    assert.ok(side?.equals(new Vec3(1, 64, 0)), `opened ${side}`);
    assert.deepEqual(dug.sort(), ['1,64,0', '1,65,0', '2,64,0', '2,65,0']);
    assert.equal(EXIT_DEPTH, 3);
    // Deeper than EXIT_DEPTH on every side: nothing is dug.
    const deep = exitWorld(Object.assign(lid(), ...[2, 3, 4].flatMap(k => [ring(64, 'stone', k), ring(65, 'stone', k)])));
    assert.equal(await digOut(deep.bot, SITE), null);
    assert.deepEqual(deep.dug, []);
});

test('#364 follow-up (a): digOut walks through no cell without firm ground right under it (a tunnel over a cave, a wall cell over a hole)', async (t) => {
    const air = (x, z, from, to) => Object.fromEntries(Array.from({ length: from - to + 1 }, (_, i) => [`${x},${from - i},${z}`, 'air']));
    // The hillside of the tunnel test: east opens after 2 cells, the other sides after 3. East has
    // a cave under its 2nd tunnel cell, west under its 3rd, north under its 2nd; south is sound.
    const hill = { ...ring(64, 'stone'), ...ring(65, 'stone'), ...ring(64, 'stone', 3), ...ring(65, 'stone', 3), ...ring(66, 'stone', 3) };
    delete hill['3,64,0']; delete hill['3,65,0']; delete hill['3,66,0'];
    const { bot, dug } = exitWorld({ ...hill, ...air(2, 0, 63, 58), ...air(-3, 0, 63, 58), ...air(0, -2, 63, 58) });
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    const side = await digOut(bot, SITE);
    assert.ok(side?.equals(new Vec3(0, 64, 1)), `opened ${side}`);
    assert.deepEqual(dug.sort(), ['0,64,1', '0,64,2', '0,64,3', '0,65,1', '0,65,2', '0,65,3'], 'only the south tunnel');
    for (const [name, cell] of [['east', '2, 64, 0'], ['west', '-3, 64, 0'], ['north', '0, 64, -2']])
        assert.ok(logs.some(l => l.includes(`not the ${name} side (no firm floor under ${cell} (air))`)), logs.join('\n'));
    // A level side whose wall cell stands over a hole: refused; the next level side opens.
    const hole = exitWorld(air(1, 0, 63, 60));
    assert.ok((await digOut(hole.bot, SITE))?.equals(new Vec3(-1, 64, 0)));
    assert.ok(!hole.dug.some(k => k.startsWith('1,')), `east untouched: ${hole.dug}`);
});

test('round 10 B: digOut never digs a step-up or tunnel side with lava next to its cells, and logs why each side was refused', async (t) => {
    quiet(t);
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    // Step-ups everywhere; east has lava over its step.
    const { bot, dug } = exitWorld({ ...ring(64, 'stone'), '2,65,0': 'lava' });
    const side = await digOut(bot, SITE);
    assert.ok(side?.equals(new Vec3(-1, 64, 0)), `opened ${side}`);
    assert.ok(!dug.some(k => k.startsWith('1,')), `east untouched: ${dug}`);
    assert.ok(logs.some(l => /dig out: not the east side \(liquid or fire (next to|at) /.test(l)), logs.join('\n'));
    // A hill on every side, with lava beside each tunnel's second cell: no side is dug at all.
    const tunnel = exitWorld({ ...lid(), ...ring(64, 'stone'), ...ring(65, 'stone'), '2,64,1': 'lava', '-2,64,1': 'lava', '1,64,2': 'lava', '-1,64,-2': 'lava' });
    assert.equal(await digOut(tunnel.bot, SITE), null);
    assert.deepEqual(tunnel.dug, [], 'every side is planned before anything is dug');
});

/** Rock 4 deep on every side of the shelter at its level and one higher; the surface beyond is open. */
const quarry = () => Object.assign({}, ...[2, 3, 4].flatMap(k => [ring(64, 'stone', k), ring(65, 'stone', k)]), ring(66, 'stone', 1), ring(66, 'stone', 2));

// Soak 2 (rotn-v0.1.4, 23:21): the night shelter was a quarry pit, rock on every side for more than
// EXIT_DEPTH; digOut only went sideways and handed back still enclosed.
test('soak 2: a shelter at the bottom of a pit (no sideways exit) is left by stairs up, at most UP_STEPS', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    const { UP_STEPS } = await import('./night_routine.js');
    assert.equal(UP_STEPS, 4);
    // Rock 4 deep on every side at the bot's level (y 64-65) and one higher (y 66) out to 2; the
    // surface (y 66 beyond 2, y 67 everywhere) is open.
    const pit = quarry();
    const { bot, world, dug } = exitWorld(pit);
    const side = await digOut(bot, SITE);
    assert.ok(side?.equals(new Vec3(3, 66, 0)), `out at the top: ${side}`);
    // Step 1: the roof over the bot and the cells at x 1, y 65-66; step 2: the headroom at x 1, y 67 and x 2, y 66-67.
    assert.deepEqual(dug.sort(), ['0,66,0', '1,65,0', '1,66,0', '2,66,0'].sort(), `the stairs: ${dug}`);
    assert.equal(world.get('1,64,0'), 'cobblestone', 'the first step stays');
    assert.equal(world.get('2,65,0'), 'stone', 'the second step stays');
    assert.ok(logs.some(l => /dig out: the east side \(stairs up, 2 steps, 4 blocks\)/.test(l)), logs.join('\n'));
    // A lid of stone over everything: no stairs either, nothing dug.
    const closed = exitWorld({ ...lid(), ...pit });
    assert.equal(await digOut(closed.bot, SITE), null);
    assert.deepEqual(closed.dug, []);
});

test('round 10 B: in the morning a shelter with no way out is tried again RETRY_MS later, EXIT_TRIES times, then the bot hands back saying it is still enclosed', async (t) => {
    quiet(t);
    const { EXIT_TRIES } = await import('./night_routine.js');
    const agent = fakeAgent({ t: NIGHT });
    const o = ops({ side: null });
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    agent.bot.time.timeOfDay = MORNING;
    let now = 10;
    nightTick(agent, { now, ops: o });
    await settle(agent);
    assert.equal(o.digs, 1);
    assert.equal(nightState(agent).state, 'inside', 'not back to work walled in');
    assert.equal(agent.bot.rotnSheltered, true);
    assert.match(agent.chat.at(-1), /\[night\] morning: no safe side of the shelter at 0, 64, 0 to open yet \(try 1 of 3\); trying again in 30 s/);
    assert.equal(nightTick(agent, { now: now + RETRY_MS - 1, ops: o }), 'night:inside');
    await settle(agent);
    assert.equal(o.digs, 1, 'waits RETRY_MS');
    for (let i = 2; i <= EXIT_TRIES; i++) {
        now += RETRY_MS;
        nightTick(agent, { now, ops: o });
        await settle(agent);
        assert.equal(o.digs, i);
    }
    assert.equal(nightState(agent).state, 'day');
    assert.equal(agent.bot.rotnSheltered, false);
    assert.match(agent.chat.at(-1), /\[night\] morning: could not leave the shelter at 0, 64, 0 after 3 tries \(no safe side of the shelter at 0, 64, 0 to open yet\); back to work, still enclosed: dig a way out$/);
    assert.equal(nightTick(agent, { now: now + 1, ops: o }), null);
    // A later night starts with no tries counted.
    assert.equal(nightState(agent).exitTries, 0);
});

test('#435 review 4: a failed try that left the bot part-way up its stairs does not hand back as out of the shelter', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops({ side: null });
    o.digOut = () => { o.digs++; agent.bot.entity.position = new Vec3(2.5, 66, 0.5); return Promise.resolve(null); };
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    agent.bot.time.timeOfDay = MORNING;
    nightTick(agent, { now: 10, ops: o });
    await settle(agent);
    assert.equal(o.digs, 1);
    nightTick(agent, { now: 11, ops: o });
    await settle(agent);
    assert.equal(nightState(agent).state, 'day');
    assert.ok(!agent.chat.some(l => /morning: out of the shelter at 0, 64, 0; back to work$/.test(l)), agent.chat.join('\n'));
    assert.match(agent.chat.at(-1), /a way out of the shelter at 0, 64, 0 failed part-way and the bot is at 2, 66, 0; back to work, maybe still enclosed: dig a way out$/);
});

test('round 10 B: out of the shelter between two morning tries (pushed, or it dug itself out), the bot hands back at once', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops({ side: null });
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    agent.bot.time.timeOfDay = MORNING;
    nightTick(agent, { now: 10, ops: o });
    await settle(agent);
    assert.equal(nightState(agent).state, 'inside');
    agent.bot.entity.position = new Vec3(3.5, 64, 0.5);
    nightTick(agent, { now: 11, ops: o });
    await settle(agent);
    assert.equal(o.digs, 1, 'no second dig');
    assert.equal(nightState(agent).state, 'day');
    assert.equal(agent.bot.rotnSheltered, false);
    assert.match(agent.chat.at(-1), /\[night\] morning: out of the shelter at 0, 64, 0; back to work$/);
});

// #364 review (REQUEST CHANGES on 625af577).
// #435 review (on d47b1ee9): forge-bridge's extendRegistry leaves harvestTools unset for modded
// blocks, so the registry's canHarvest says yes to Underground Biomes rock by hand; and with no
// material every tool digs it alike, so equipForBlock keeps whatever is held.
test('#435 review 1-3: modded rock (registry canHarvest yes by hand): with no pickaxe no plan is begun; a pickaxe not in hand is put in hand for each rock dig', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    const UB = 'undergroundbiomes:metamorphic_stone';
    const rock = Object.fromEntries(Object.keys({ ...quarry(), ...ring(64, 'x', 1), ...ring(65, 'x', 1) }).map(k => [k, UB]));
    const pit = { ...rock, '0,66,0': 'dirt' }; // a dirt roof over the rock
    const registryDefault = () => true; // harvestTools undefined
    const bare = exitWorld(pit, { canHarvest: registryDefault, items: [] });
    assert.equal(await digOut(bare.bot, SITE), null, 'no way out it can dig');
    assert.deepEqual(bare.dug, [], 'nothing was dug');
    assert.equal(bare.world.get('0,66,0'), 'dirt', 'the roof stays on');
    assert.ok(logs.some(l => /no stairs up on the east side \(no tool to break undergroundbiomes:metamorphic_stone at /.test(l)), logs.join('\n'));
    // A pickaxe in the inventory, dirt in hand; equipForBlock keeps what is held.
    const armed = exitWorld(pit, { canHarvest: registryDefault });
    armed.bot.heldItem = { name: 'dirt', type: 3, metadata: 0 };
    const held = [];
    const dig = armed.bot.dig;
    armed.bot.dig = (b, ...rest) => { held.push(`${b.name} with ${armed.bot.heldItem?.name}`); return dig(b, ...rest); };
    assert.ok((await digOut(armed.bot, SITE))?.equals(new Vec3(3, 66, 0)));
    assert.equal(armed.dug[0], '0,66,0', 'the roof first');
    const rockDigs = held.filter(h => h.startsWith(UB));
    assert.ok(rockDigs.length >= 2, held.join('; '));
    assert.deepEqual([...new Set(rockDigs)], [`${UB} with stone_pickaxe`], held.join('; '));
});

test('#435 review 4: a stairs plan that fails part-way up walks the bot back to the shelter before the next plan', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    const saved = PIT.digSlackMs;
    PIT.digSlackMs = 30;
    t.after(() => { PIT.digSlackMs = saved; });
    // Rock rising away from the shelter: the way up is 4 steps, and the top step is out of reach from the floor.
    const tops = [[1, 66], [2, 66], [3, 67], [4, 68], [5, 67]];
    const terrace = Object.assign({}, ...tops.flatMap(([k, top]) => Array.from({ length: top - 63 }, (_, i) => ring(64 + i, 'stone', k))));
    const { bot, dug } = exitWorld(terrace);
    bot.digTime = () => 10;
    bot.stopDigging = () => {};
    const dig = bot.dig;
    bot.dig = (b, ...rest) => (b.position.x === 4 ? new Promise(() => {}) : dig(b, ...rest)); // the east top step never breaks
    const walks = [];
    const walk = (b, goal) => {
        walks.push(`${goal.constructor.name} ${goal.x},${goal.y},${goal.z}`);
        b.entity.position = goal.constructor.name === 'GoalBlock' ? new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5)
            : new Vec3(goal.x - Math.sign(goal.x) * 2 + 0.5, goal.y - 1, goal.z + 0.5);
        return Promise.resolve();
    };
    const out = await digOut(bot, SITE, { walk });
    assert.deepEqual(walks.slice(0, 2), ['GoalNear 4,68,0', 'GoalBlock 0,64,0'], walks.join('; '));
    assert.ok(walks.slice(2).length > 0 && walks.slice(2).every(w => w.startsWith('GoalNear -')), `then only the west steps: ${walks.join('; ')}`);
    assert.ok(out?.equals(new Vec3(-5, 68, 0)), `out on the west: ${out}`);
    assert.ok(dug.includes('-4,68,0'));
    assert.ok(logs.some(l => /could not open the east side/.test(l)), logs.join('\n'));
    // The walk back fails: no other plan is tried from part-way up.
    const stuck = exitWorld(terrace);
    Object.assign(stuck.bot, { digTime: () => 10, stopDigging: () => {} });
    const sdig = stuck.bot.dig;
    stuck.bot.dig = (b, ...rest) => (b.position.x === 4 ? new Promise(() => {}) : sdig(b, ...rest));
    const noWayBack = (b, goal) => { if (goal.constructor.name !== 'GoalBlock') b.entity.position = new Vec3(2.5, 67, 0.5); return Promise.resolve(); };
    assert.equal(await digOut(stuck.bot, SITE, { walk: noWayBack }), null);
    assert.ok(!stuck.dug.some(k => k.startsWith('-')), 'nothing dug on the west');
    assert.ok(logs.some(l => /could not get back to 0, 64, 0 after a failed way out/.test(l)));
});

test('#435 review 2: an exit dig has the per-block limit: a hung dig ends that plan and the next side is tried; a quick side beats a slow hand-diggable one', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    const saved = PIT.digSlackMs;
    PIT.digSlackMs = 30;
    t.after(() => { PIT.digSlackMs = saved; });
    const walls = { ...ring(64, 'dirt', 1), ...ring(65, 'dirt', 1) };
    const { bot, world, dug } = exitWorld(walls);
    let stopped = 0;
    const dig = bot.dig;
    bot.digTime = () => 10;
    bot.stopDigging = () => { stopped++; };
    bot.dig = (b, ...rest) => {
        if (b.position.x !== 1) return dig(b, ...rest);
        bot.targetDigBlock = b;
        return new Promise(() => {}); // the east wall never breaks
    };
    assert.ok((await digOut(bot, SITE))?.equals(new Vec3(-1, 64, 0)), 'the next side');
    assert.equal(stopped, 1, 'the hung dig was stopped');
    assert.equal(world.get('1,65,0'), 'dirt');
    assert.deepEqual(dug.sort(), ['-1,64,0', '-1,65,0']);
    assert.ok(logs.some(l => /dig out: dirt at 1, 6[45], 0 was not dug within 0\.0 s/.test(l)), logs.join('\n'));
    // Rooty dirt is hand-diggable but slow (hardness 20): the dirt side goes first, though east comes first otherwise.
    const slow = exitWorld({ ...walls, '1,64,0': 'dynamictrees:rootydirt', '1,65,0': 'dynamictrees:rootydirt' });
    assert.ok((await digOut(slow.bot, SITE))?.equals(new Vec3(-1, 64, 0)));
    assert.equal(slow.world.get('1,64,0'), 'dynamictrees:rootydirt');
});

test('#435 review 3: stairs that end under rock are refused and report nothing dug out; leaves overhead do not count', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    const over = (name) => Object.fromEntries([[3, 0], [-3, 0], [0, 3], [0, -3]].map(([x, z]) => [`${x},70,${z}`, name]));
    const cave = exitWorld({ ...quarry(), ...over('stone') });
    assert.equal(await digOut(cave.bot, SITE), null);
    assert.deepEqual(cave.dug, []);
    assert.ok(logs.some(l => /no stairs up on the east side \(no open sky over 3, 66, 0\)/.test(l)), logs.join('\n'));
    const forest = exitWorld({ ...quarry(), ...over('leaves') });
    assert.ok((await digOut(forest.bot, SITE))?.equals(new Vec3(3, 66, 0)));
});

test('#435 review 4: an unloaded cell (blockAt null) in a plan refuses it, with no throw and nothing dug', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    const { bot, dug } = exitWorld(quarry());
    const base = bot.blockAt;
    const unloaded = new Set(['1,66,0', '-1,66,0', '0,66,1', '0,66,-1']);
    bot.blockAt = (p) => (unloaded.has(`${p.x},${p.y},${p.z}`) ? null : base(p));
    assert.equal(await digOut(bot, SITE), null);
    assert.deepEqual(dug, []);
    assert.ok(logs.some(l => /no stairs up on the east side \(an unloaded cell at or next to /.test(l)), logs.join('\n'));
});

test('#364 review 1: digOut never digs a Dynamic Trees branch or trunk shell (it would fell the tree onto the bot)', async (t) => {
    quiet(t);
    // A hill on every side; the east and west tunnels go through a trunk, south through a thick
    // trunk's shell, north is open after the hill.
    const hill = { ...ring(64, 'stone'), ...ring(65, 'stone'), '2,64,0': 'dynamictrees:sprucebranch', '2,65,0': 'dynamictrees:sprucebranch',
        '-2,64,0': 'dynamictrees:oakbranch', '0,65,2': 'dynamictrees:trunkshell' };
    const { bot, dug } = exitWorld(hill);
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    const side = await digOut(bot, SITE);
    assert.ok(side?.equals(new Vec3(0, 64, -1)), `opened ${side}`);
    assert.ok(!dug.some(k => ['2,64,0', '2,65,0', '-2,64,0', '0,65,2'].includes(k)), `no tree block dug: ${dug}`);
    assert.ok(logs.some(l => /not the east side \(a tree's dynamictrees:sprucebranch at 2, 6[45], 0\)/.test(l)), logs.join('\n'));
    assert.ok(logs.some(l => /not the south side \(a tree's dynamictrees:trunkshell at 0, 65, 2\)/.test(l)), logs.join('\n'));
});

test('#364 review 2: digOut opens no side over a drop of more than MAX_SAFE_DROP, and never tunnels into a cave\'s drop', async (t) => {
    quiet(t);
    const air = (x, z, from, to) => Object.fromEntries(Array.from({ length: from - to + 1 }, (_, i) => [`${x},${from - i},${z}`, 'air']));
    // East: a 9-block cliff right beyond the wall. West: a two-high hill, then a cave with no floor
    // within 3. South: a 3-block fall (safe: fall_safety's MAX_SAFE_DROP). North: a hill deeper than EXIT_DEPTH.
    const world = { ...air(2, 0, 63, 55), '-2,64,0': 'stone', '-2,65,0': 'stone', ...air(-3, 0, 63, 58), ...air(0, 2, 63, 61),
        ...Object.assign({}, ...[2, 3, 4].map(k => ({ [`0,64,${-k}`]: 'stone', [`0,65,${-k}`]: 'stone' }))) };
    const { bot, dug } = exitWorld(world);
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    const side = await digOut(bot, SITE);
    assert.ok(side?.equals(new Vec3(0, 64, 1)), `opened ${side}`);
    assert.ok(!dug.some(k => /^(1|-1|-2),/.test(k)), `east and west untouched: ${dug}`);
    assert.ok(logs.some(l => /not the east side \(a drop of more than 3 blocks beyond 2, 64, 0\)/.test(l)), logs.join('\n'));
    assert.ok(logs.some(l => /not the west side \(a drop of more than 3 blocks beyond -3, 64, 0\)/.test(l)), logs.join('\n'));
    // Every side a cliff: nothing opens, nothing is dug.
    const cliffs = exitWorld({ ...air(2, 0, 63, 55), ...air(-2, 0, 63, 55), ...air(0, 2, 63, 55), ...air(0, -2, 63, 55) });
    assert.equal(await digOut(cliffs.bot, SITE), null);
    assert.deepEqual(cliffs.dug, []);
});

test('#364 review 3: in the morning no side is opened while a hostile mob is near; the bot opens once it is gone', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    let mob = true;
    o.hostileNear = () => mob;
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    agent.bot.time.timeOfDay = MORNING;
    assert.equal(nightTick(agent, { now: 10, ops: o }), 'night:inside');
    await settle(agent);
    assert.equal(o.digs, 0, 'not opened with a mob near');
    assert.equal(agent.bot.rotnSheltered, true);
    assert.match(agent.chat.at(-1), /\[night\] morning: a hostile mob is within 8 blocks of the shelter at 0, 64, 0; staying in until it leaves \(checking every 30 s, at most 2 min\)/);
    mob = false;
    // #477 nit: a mob out of range for less than MORNING.goneMs (30 s) keeps the wait; then it is gone.
    nightTick(agent, { now: 10 + RETRY_MS, ops: o });
    await settle(agent);
    assert.equal(o.digs, 0, 'gone for less than 30 s: still waiting');
    nightTick(agent, { now: 10 + 2 * RETRY_MS, ops: o });
    await settle(agent);
    assert.equal(o.digs, 1);
    assert.equal(nightState(agent).state, 'day');
    assert.match(agent.chat.at(-1), /dug out of the shelter at 1, 64, 0; back to work/);
});

test('#364 follow-up (b), soak 4: a mob that stays near holds the bot in for MORNING.waitMs (2 min) only; then (unarmed) it leaves by the side away from the mob; the wait uses no try', async (t) => {
    quiet(t);
    const warns = [];
    t.mock.method(console, 'warn', (l) => warns.push(String(l)));
    const { EXIT_TRIES, hostileNear, isFullDay, MORNING: RULE } = await import('./night_routine.js');
    const { MORNING_FREEZE } = await import('./library/night.js');
    // The lead's noon bound (6000) is past the full day on this pack's clock (dusk from about 5348).
    assert.equal(isFullDay(6000), false);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    const zombie = { name: 'zombie', type: 'hostile', kind: 'Hostile mobs', position: new Vec3(3.4, 64, -2.7) };
    let mob = zombie;
    o.hostileNear = () => mob;
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    const chats = agent.chat.length;
    const outs = [];
    o.digOut = (bot, feet, opts) => { o.digs++; outs.push(opts?.away ?? null); return Promise.resolve(new Vec3(-1, 64, 0)); };
    let fled = 0;
    o.awayFromMobs = () => { fled++; return Promise.resolve(); };
    agent.bot.time.timeOfDay = MORNING_FREEZE;
    // The grace: checks RETRY_MS apart, held, nothing opened, said once.
    for (let i = 0; i < 4; i++) {
        assert.equal(nightTick(agent, { now: 10 + i * RETRY_MS, ops: o }), 'night:inside');
        await settle(agent);
        assert.equal(nightState(agent).state, 'inside', `still in at check ${i + 1}`);
    }
    assert.equal(o.digs, 0, 'not opened in the grace');
    assert.equal(agent.chat.length - chats, 1, agent.chat.slice(chats).join(' | '));
    assert.match(agent.chat.at(-1), /a zombie at 3, 64, -3 is within 8 blocks of the shelter at 0, 64, 0; staying in until it leaves \(checking every 30 s, at most 2 min\)/);
    // The grace is over (2 min): the mob's state, then (no weapon) out by the side away from it.
    assert.equal(nightTick(agent, { now: 10 + RULE.waitMs, ops: o }), 'night:inside');
    await settle(agent);
    assert.ok(agent.chat.some(l => /^\[night\] morning: after 120 s a zombie at 3, 64, -3 has not moved; health unknown, holds nothing, helmet none, sky light unknown$/.test(l)), agent.chat.join('\n'));
    assert.ok(agent.chat.includes('[night] morning: no weapon: leaving the shelter at 0, 64, 0 by the side away from a zombie at 3, 64, -3'));
    assert.equal(o.digs, 1);
    assert.deepEqual(outs[0], zombie.position, 'dig out away from the zombie');
    assert.equal(fled, 1, 'then away from it');
    assert.equal(nightState(agent).state, 'day');
    assert.match(agent.chat.at(-1), /left the shelter at -1, 64, 0 on the side away from a zombie at 3, 64, -3; back to work/);
    assert.ok(!warns.some(l => /at the end of the day/.test(l)), 'never the whole day');

    // The wait used no try: a mob that leaves after 2 min, then 3 failed tries, still hands back after EXIT_TRIES.
    const later = fakeAgent({ t: NIGHT });
    const o2 = ops({ side: null });
    let near = true;
    o2.hostileNear = () => near;
    nightTick(later, { now: 0, ops: o2 });
    await settle(later);
    later.bot.time.timeOfDay = MORNING;
    for (let i = 0; i < 4; i++) { nightTick(later, { now: 10 + i * RETRY_MS, ops: o2 }); await settle(later); }
    near = false;
    for (let i = 4; i < 5 + EXIT_TRIES; i++) { nightTick(later, { now: 10 + i * RETRY_MS, ops: o2 }); await settle(later); } // the first: gone under 30 s
    assert.equal(o2.digs, EXIT_TRIES);
    assert.ok(later.chat.some(l => /no safe side of the shelter at 0, 64, 0 to open yet \(try 1 of 3\)/.test(l)), later.chat.join('\n'));
    assert.match(later.chat.at(-1), /could not leave the shelter at 0, 64, 0 after 3 tries \(no safe side/);

    // hostileNear names the nearest hostile mob in range (null when none).
    const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {} };
    bot.entities = { 1: bot.entity, 2: { ...zombie, position: new Vec3(6, 64, 0) }, 3: zombie, 4: { name: 'cow', type: 'animal', position: new Vec3(1, 64, 1) } };
    assert.equal(hostileNear(bot, 8), zombie);
    assert.equal(hostileNear(bot, 2), null);
});

test('#372 review: a mob that leaves ends its wait; a later mob gets its own wait, said again', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops({ side: null });
    const skeleton = { name: 'skeleton', position: new Vec3(-4, 64, 2) }, zombie = { name: 'zombie', position: new Vec3(5, 64, 0) };
    let mob = skeleton;
    o.hostileNear = () => mob;
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    agent.bot.time.timeOfDay = MORNING;
    nightTick(agent, { now: 10, ops: o });
    await settle(agent);
    assert.equal(nightState(agent).mobSince, 10);
    assert.match(agent.chat.at(-1), /a skeleton at -4, 64, 2 is within 8 blocks/);
    mob = null; // it leaves: once gone 30 s (MORNING.goneMs), the next check is a try (no side opens here), and the wait is over
    nightTick(agent, { now: 10 + RETRY_MS, ops: o });
    await settle(agent);
    assert.equal(nightState(agent).mobSince, 10, 'gone less than 30 s: the wait stays');
    nightTick(agent, { now: 10 + 2 * RETRY_MS, ops: o });
    await settle(agent);
    assert.equal(o.digs, 1);
    assert.equal(nightState(agent).mobSince, null);
    assert.match(agent.chat.at(-1), /try 1 of 3/);
    mob = zombie; // a later mob: its own wait, said in chat again
    nightTick(agent, { now: 10 + 3 * RETRY_MS, ops: o });
    await settle(agent);
    assert.equal(nightState(agent).mobSince, 10 + 3 * RETRY_MS);
    assert.match(agent.chat.at(-1), /a zombie at 5, 64, 0 is within 8 blocks of the shelter at 0, 64, 0; staying in until it leaves/);
    assert.equal(nightState(agent).state, 'inside');
    assert.equal(o.digs, 1);
});

test('#364 review 4: between two morning tries a breach is still found and repaired', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops({ side: null });
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    agent.bot.time.timeOfDay = MORNING;
    nightTick(agent, { now: 10, ops: o });
    await settle(agent);
    assert.match(agent.chat.at(-1), /try 1 of 3/);
    o.open = [SITE.offset(1, 1, 0)]; // a zombie broke a wall while the bot waits for the next try
    nightTick(agent, { now: 11, ops: o });
    nightTick(agent, { now: 11 + CHECK_MS, ops: o });
    await settle(agent);
    assert.deepEqual(o.builds, [null, SITE], 'the repair names the site');
    assert.ok(agent.chat.some(l => /\[night\] the shelter is open at 1, 65, 0: repairing/.test(l)), agent.chat.join('\n'));
    assert.equal(o.digs, 1, 'no new dig before RETRY_MS');
    assert.equal(nightState(agent).state, 'inside');
});

test('CX23 soak: up on a tree at night (a respawn in the canopy), the routine climbs down first, once per build phase, then shelters', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    let onTree = true;
    const calls = [];
    o.onTree = () => onTree;
    o.descend = () => { calls.push('descend'); onTree = false; return Promise.resolve(true); };
    const build = o.buildShelter;
    o.buildShelter = (bot, opts) => { calls.push('build'); return build(bot, opts); };
    assert.equal(nightTick(agent, { now: 0, ops: o }), 'night:building');
    await settle(agent);
    assert.ok(agent.chat.includes('[night] up on a tree: climbing down before sheltering'), agent.chat.join('\n'));
    nightTick(agent, { now: 1, ops: o });
    await settle(agent);
    assert.deepEqual(calls, ['descend', 'build']);
    assert.equal(nightState(agent).state, 'inside');

    // No way down: one try, then it shelters from where it is (no climb loop).
    const stuck = fakeAgent({ t: NIGHT });
    const o2 = ops({ closed: false });
    const calls2 = [];
    o2.onTree = () => true;
    o2.descend = (bot) => { calls2.push('descend'); bot.rotnTreeWhy = 'Not digging down: dynamictrees:trunkshell is under you'; return Promise.resolve(false); };
    const build2 = o2.buildShelter;
    o2.buildShelter = (bot, opts) => { calls2.push('build'); return build2(bot, opts); };
    const warns = [];
    t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
    for (let i = 0; i < 4; i++) { nightTick(stuck, { now: i * RETRY_MS * 2, ops: o2 }); await settle(stuck); }
    assert.equal(calls2.filter(c => c === 'descend').length, 1, 'once per build phase');
    // Soak 5 (00:47): the journal says why it is still up there.
    assert.ok(warns.includes('[night] still on the tree (Not digging down: dynamictrees:trunkshell is under you); sheltering from here'), warns.join('\n'));
    assert.ok(calls2.includes('build'));

    // On the ground: no climb at all.
    const ground = fakeAgent({ t: NIGHT });
    const o3 = ops();
    let tried = 0;
    o3.onTree = () => false;
    o3.descend = () => { tried++; return Promise.resolve(true); };
    nightTick(ground, { now: 0, ops: o3 });
    await settle(ground);
    assert.equal(tried, 0);
    assert.equal(nightState(ground).state, 'inside');
});

test('CX23 soak: a repair that placed some blocks but left cells open says which and why in the journal', async (t) => {
    quiet(t);
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    nightTick(agent, { now: 0, ops: o });
    await settle(agent);
    o.open = [SITE.offset(1, 0, 0), SITE.offset(1, 1, 0)];
    const line = 'Shelter at 0, 64, 0 is not closed: 1 open (1, 64, 0: a zombie stands in it (hit 6 times)); placed 1.';
    o.buildShelter = () => Promise.resolve({ closed: false, placed: 1, feet: SITE, line });
    nightTick(agent, { now: 1, ops: o });
    nightTick(agent, { now: CHECK_MS + 2, ops: o });
    await settle(agent);
    assert.ok(logs.includes(`[night] the repair placed 1 but left some open (${line})`), logs.join('\n'));
});

test('G4 #5: at dusk the night routine logs the food held for the night (6 wanted); with too little it stays sealed anyway', async (t) => {
    quiet(t);
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    const agent = fakeAgent({ t: DUSK });
    Object.assign(agent.bot, { food: 14, inventory: { items: () => [{ name: 'bread', metadata: 0, count: 2 }] } });
    nightTick(agent, { now: 0, ops: ops() });
    await settle(agent);
    assert.ok(logs.includes('[night] food for the night: food worth 6 hunger held, food 14; enough'), logs.join('\n'));
    const poor = fakeAgent({ t: DUSK });
    Object.assign(poor.bot, { food: 9, inventory: { items: () => [] } });
    nightTick(poor, { now: 0, ops: ops() });
    await settle(poor);
    assert.ok(logs.includes('[night] food for the night: food worth 0 hunger held, food 9; less than 6: staying sealed anyway (never out for food at night)'), logs.join('\n'));
    assert.equal(nightState(poor).state, 'inside', 'it shelters as usual');
});


// #463 rework (soak 3, rotn-v0.1.5): the lead's rule: after full day the self-prompter runs again if
// it ran at dusk, agenda or not. The agenda's own goal resumes through agendaTick; the model's own
// goal had nothing to start it again.
test('#463 rework: the model\'s own goal stopped at dusk starts again, once, after full day; the agenda\'s is left to agendaTick', async (t) => {
    quiet(t);
    const withGoal = (prompt, { owned = false } = {}) => {
        const agent = fakeAgent({ t: DUSK });
        const sp = agent.self_prompter;
        sp.prompt = prompt;
        sp.starts = [];
        sp.start = function (p) { this.starts.push(p); this.prompt = p; this.active = true; };
        if (owned) agent._autonomy_prompt = prompt;
        return agent;
    };
    const night = async (agent) => {
        const o = ops();
        nightTick(agent, { now: Date.now(), ops: o }); // real times: resumeNightGoal reads the routine's clock now
        await settle(agent);
        assert.equal(nightState(agent).state, 'inside');
        assert.equal(agent.self_prompter.active, false, 'stopped at dusk');
        assert.equal(resumeNightGoal(agent), false, 'not while the routine runs');
        agent.bot.time.timeOfDay = MORNING;
        nightTick(agent, { now: Date.now() + 1, ops: o });
        await settle(agent);
        assert.equal(nightState(agent).state, 'day');
    };
    const model = withGoal('Gather 3 rocks and craft a stone axe');
    await night(model);
    assert.equal(resumeNightGoal(model), true);
    assert.deepEqual(model.self_prompter.starts, ['Gather 3 rocks and craft a stone axe']);
    model.self_prompter.active = false;
    assert.equal(resumeNightGoal(model), false, 'once');

    const agenda = withGoal('RotN agenda, step 10 of 11 (stone_axe): ...', { owned: true });
    await night(agenda);
    assert.equal(resumeNightGoal(agenda), false, 'the agenda\'s goal: agendaTick restarts it');
    assert.deepEqual(agenda.self_prompter.starts, []);

    const other = withGoal('Gather 3 rocks');
    await night(other);
    other.self_prompter.active = true; // something else drives it already (a task, a giver's goal)
    assert.equal(resumeNightGoal(other), false);
    other.self_prompter.active = false;
    assert.equal(resumeNightGoal(other), false, 'forgotten, not started later');

    // Through the priority stack: after full day, the goal starts again (no task, no agenda).
    const full = withGoal('Gather 3 rocks');
    await night(full);
    assert.equal(autonomyTick(full, { now: Date.now() + 2 }), 'night-goal');
    assert.deepEqual(full.self_prompter.starts, ['Gather 3 rocks']);
});

test('#463 nits 1 and 2: a giver\'s !endGoal or !stop forgets the goal the night stopped; it waits for full day (a dawn-gap death)', async (t) => {
    quiet(t);
    const { getCommand } = await import('./commands/index.js');
    const make = () => {
        const agent = fakeAgent({ t: MORNING });
        const sp = agent.self_prompter;
        sp.active = false;
        sp.starts = [];
        sp.start = function (p) { this.starts.push(p); this.active = true; };
        agent._night = { state: 'day' };
        agent._night_goal = 'Gather 3 rocks';
        return agent;
    };
    // Nit 2: the routine is back to day, but the time is the dawn gap (not full day): it waits.
    const dawn = make();
    dawn.bot.time.timeOfDay = SUNRISE;
    assert.equal(resumeNightGoal(dawn), false);
    assert.equal(dawn._night_goal, 'Gather 3 rocks', 'kept for full day');
    dawn.bot.time.timeOfDay = MORNING;
    assert.equal(resumeNightGoal(dawn), true);
    assert.deepEqual(dawn.self_prompter.starts, ['Gather 3 rocks']);
    // Nit 1: a giver's !endGoal forgets it; the model's does not.
    const endGoal = getCommand('!endGoal').perform;
    const model = make();
    await endGoal(model, {});
    assert.equal(model._night_goal, 'Gather 3 rocks', 'the model\'s own !endGoal: kept');
    const giver = make();
    await endGoal(giver, { sender: 'JQDAW' });
    assert.equal(giver._night_goal, null);
    assert.equal(resumeNightGoal(giver), false);
    // A giver's !stop (with a sender) forgets it too.
    const stop = getCommand('!stop').perform;
    const stopped = make();
    Object.assign(stopped, { control: { setHold() {} }, clearBotLogs() {} });
    Object.assign(stopped.actions, { cancelResume() {} });
    stopped.bot.emit = () => {};
    await stop(stopped, { sender: 'JQDAW' });
    assert.equal(stopped._night_goal, null);
});

test('#468 review 2: the night does not save the open goal (the agenda gives it again, under its window budget)', async (t) => {
    quiet(t);
    const { OPEN_GOAL_PREFIX } = await import('./agenda.js');
    const agent = fakeAgent({ t: DUSK });
    agent.self_prompter.prompt = `${OPEN_GOAL_PREFIX}step stone_axe (craft a stone axe) is stuck: 5 min of self-prompting; …`;
    nightTick(agent, { now: Date.now(), ops: ops() });
    await settle(agent);
    assert.equal(agent.self_prompter.active, false, 'stopped at dusk');
    assert.equal(agent._night_goal, undefined, 'not saved');
    agent.bot.time.timeOfDay = MORNING;
    nightTick(agent, { now: Date.now() + 1, ops: ops() });
    await settle(agent);
    assert.equal(resumeNightGoal(agent), false, 'nothing to restart');
});

// Soak 3 (rotn-v0.1.5), the lead's (b) and #470 review: with no weapon, a cell a mob holds is left out
// of the repair (the others are repaired); at health 8 or lower the bot backs away (once per shelter),
// else hits back by hand; a back-away that ends in plan.to keeps the shelter there.
function heldSetup({ weapon = false, plan = true, health = 20, held = 'feet', backAway = null } = {}) {
    const agent = fakeAgent({ t: NIGHT });
    agent.bot.health = health;
    const opening = [SITE.offset(1, 0, 0), SITE.offset(1, 1, 0)];
    const zombie = { id: 7, name: 'zombie', position: new Vec3(1.5, 64, 0.5) };
    const o = ops();
    o.repairs = [];
    o.buildShelter = (bot, opts = {}) => {
        o.builds.push(opts.site ?? null);
        if (opts.site) o.repairs.push({ site: opts.site, skip: (opts.skip ?? []).map(c => `${c.x},${c.y},${c.z}`) });
        // A repair that leaves a held cell out does not close the shelter.
        const closed = !(opts.skip?.length);
        return Promise.resolve({ closed, feet: opts.site ?? SITE, placed: 1, line: closed ? 'Shelter closed' : 'Shelter is not closed: 1 open' });
    };
    o.hasWeapon = () => weapon;
    o.heldCells = (bot, site, open) => (held === 'none' ? [] : open.filter(c => held === 'both' || c.equals(opening[0])).map(cell => ({ cell, mob: zombie })));
    o.retreatPlan = () => (plan ? { to: SITE.offset(-1, 0, 0), dig: [], seal: [SITE, SITE.offset(0, 1, 0)] } : null);
    o.backAway = backAway ?? ((bot, p) => { o.backs = (o.backs ?? 0) + 1; o.open = []; bot.entity.position = p.to.offset(0.5, 0, 0.5); return Promise.resolve({ site: p.to }); });
    const labels = [];
    const run = agent.actions.runAction.bind(agent.actions);
    agent.actions.runAction = (label, fn) => { labels.push(label); return run(label, fn); };
    return { agent, o, labels, opening };
}
async function breachAt(s, now = CHECK_MS + 1) {
    nightTick(s.agent, { now: 0, ops: s.o });
    await settle(s.agent);
    assert.equal(nightState(s.agent).state, 'inside');
    s.o.open = s.opening;
    nightTick(s.agent, { now: 1, ops: s.o });
    nightTick(s.agent, { now, ops: s.o });
    await settle(s.agent);
}

test('#470 review 2: no weapon, a zombie in one open cell: that cell is left out of the repair, the other is repaired; all held: no repair', async (t) => {
    quiet(t);
    // Soak 5 (death 4), the lead's rule: unarmed at any health, cornered (no way to back away), it hits back.
    const one = heldSetup({ plan: false });
    await breachAt(one);
    assert.deepEqual(one.o.repairs, [{ site: SITE, skip: ['1,64,0'] }]);
    assert.ok(one.agent.chat.includes('[night] no weapon and a zombie in the opening at 1, 64, 0: not repairing under it; repairing the other open cells'));
    assert.ok(one.agent.chat.includes('[night] no weapon, health 20, and no way to back away from a zombie in the opening at 1, 64, 0: hitting back by hand'));
    assert.equal(nightState(one.agent).handFight, true, 'cornered: it hits back by hand');
    const all = heldSetup({ held: 'both', plan: false });
    await breachAt(all);
    assert.deepEqual(all.o.repairs, [], 'every open cell held: nothing to repair');
    assert.equal(all.agent.bot.rotnSheltered, 'open');
    const armed = heldSetup({ weapon: true });
    await breachAt(armed);
    assert.deepEqual(armed.o.repairs, [{ site: SITE, skip: [] }], 'with a weapon: the whole repair (and the fight in place)');
});

test('#470 review 2: no weapon, held, health 8 or lower: back away (once per shelter); with no way to back away, hit back by hand', async (t) => {
    quiet(t);
    const back = heldSetup({ health: 8 });
    await breachAt(back);
    assert.deepEqual(back.labels, ['action:buildShelter', 'action:backAway']);
    assert.ok(nightState(back.agent).site.equals(SITE.offset(-1, 0, 0)), 'the new shelter');
    assert.equal(back.agent.bot.rotnSheltered, true);
    assert.ok(back.agent.chat.includes('[night] no weapon, health 8, and a zombie in the opening at 1, 64, 0: backing away into -1, 64, 0'));
    assert.ok(back.agent.chat.includes('[night] backed away: in the shelter at -1, 64, 0, the cells behind sealed'));
    assert.ok(!back.o.builds.slice(1).includes(null), 'never a fresh build');
    // #471 nit 6: a back-away that closes the shelter clears the hand fight.
    const flag = heldSetup({ health: 8 });
    const back2 = flag.o.backAway;
    flag.o.backAway = (bot, p) => { nightState(flag.agent).handFight = true; return back2(bot, p); }; // as set by an earlier check
    await breachAt(flag);
    assert.equal(flag.labels.at(-1), 'action:backAway');
    assert.equal(flag.agent.bot.rotnSheltered, true);
    assert.equal(nightState(flag.agent).handFight, false, 'cleared when the back-away closes the shelter');

    const hit = heldSetup({ health: 6, plan: false });
    await breachAt(hit);
    assert.equal(nightState(hit.agent).handFight, true);
    assert.ok(hit.agent.chat.includes('[night] no weapon, health 6, and no way to back away from a zombie in the opening at 1, 64, 0: hitting back by hand'));
    assert.deepEqual(hit.o.repairs, [{ site: SITE, skip: ['1,64,0'] }], 'the other cell is still repaired');
    // The zombie leaves the cell: the repair closes the shelter, and the fight by hand ends with it (#470 nit).
    hit.o.heldCells = () => [];
    hit.o.open = [hit.opening[0]];
    nightState(hit.agent).handFight = true;
    nightState(hit.agent).repairStall = null;
    hit.agent.bot.rotnSheltered = 'open';
    nightTick(hit.agent, { now: 3 * CHECK_MS, ops: hit.o });
    assert.equal(nightState(hit.agent).handFight, false, 'no hand fight while nothing holds a cell');
    nightState(hit.agent).handFight = true; // as set before this repair started
    await settle(hit.agent);
    assert.equal(hit.agent.bot.rotnSheltered, true);
    assert.equal(nightState(hit.agent).handFight, false, 'cleared when the repair closes the shelter');
});

test('#470 review 3: a back-away whose seal fails with the bot in plan.to keeps the shelter there: held or repaired, never built afresh beside the mob (each seal step)', async (t) => {
    quiet(t);
    for (const lost of ['0, 64, 0', '0, 65, 0']) {
        const s = heldSetup({ health: 5, backAway: (bot, p) => { bot.entity.position = p.to.offset(0.5, 0, 0.5); return Promise.resolve({ why: `could not seal ${lost}` }); } });
        await breachAt(s);
        assert.ok(nightState(s.agent).site.equals(SITE.offset(-1, 0, 0)), `${lost}: the shelter is plan.to`);
        assert.equal(s.agent.bot.rotnSheltered, 'open');
        assert.ok(s.agent.chat.includes(`[night] backed away into -1, 64, 0, but could not seal ${lost}; holding or repairing there`));
        // The next checks: the open cells at plan.to are repaired there (the zombie is not in them).
        s.o.heldCells = () => [];
        nightTick(s.agent, { now: 3 * CHECK_MS, ops: s.o });
        await settle(s.agent);
        assert.deepEqual(s.o.repairs.at(-1), { site: SITE.offset(-1, 0, 0), skip: [] });
        assert.ok(!s.o.builds.slice(1).includes(null), 'never a fresh build');
        assert.equal(nightState(s.agent).state, 'inside');
    }
    // Not in plan.to (the dig failed): it stays in the old shelter.
    const stay = heldSetup({ health: 5, backAway: () => Promise.resolve({ why: 'could not dig -1, 65, 0' }) });
    await breachAt(stay);
    assert.ok(nightState(stay.agent).site.equals(SITE));
});

// Soak 5 (death 4: a zombie dug into the dirt shelter and hit the bot from 20 to 0 while it fought
// back from the opening), the lead's rule: unarmed at any health, or at a health one hit of the mob
// may take armed or not (PR 5: its maxDamage, a zombie ZOMBIE_HIT, a spider 2; Fix G used 8), with a melee
// mob in the opening or in reach through it, the bot backs away; only cornered does it hit back.
// Armed above that health it fights from the shelter as before.
test('soak 5 (death 4): unarmed at full health or armed at health 8 or less, a mob in the opening or in reach: back away; cornered: hit back; armed and healthy: the whole repair', async (t) => {
    quiet(t);
    const unarmed = heldSetup({ health: 20 });
    await breachAt(unarmed);
    assert.deepEqual(unarmed.labels, ['action:buildShelter', 'action:backAway'], 'unarmed at health 20: backed away');
    assert.ok(unarmed.agent.chat.includes('[night] no weapon, health 20, and a zombie in the opening at 1, 64, 0: backing away into -1, 64, 0'));

    const reach = (s) => { s.o.mobInReach = () => ({ id: 8, name: 'zombie', position: new Vec3(1.5, 64, 1.5) }); return s; };
    const low = reach(heldSetup({ weapon: true, health: 6 }));
    await breachAt(low);
    assert.deepEqual(low.labels, ['action:buildShelter', 'action:backAway'], 'armed at health 6: backed away');
    assert.ok(low.agent.chat.includes('[night] health 6, and a zombie in reach at 1, 64, 1: backing away into -1, 64, 0'));

    const cornered = reach(heldSetup({ weapon: true, health: 6, plan: false }));
    await breachAt(cornered);
    // handFight is set for the fight while the repair runs; the fake repair closes the shelter, which clears it.
    assert.ok(cornered.agent.chat.includes('[night] health 6, and no way to back away from a zombie in reach at 1, 64, 1: hitting back'), 'cornered: it hits back with its weapon');
    assert.deepEqual(cornered.o.repairs, [{ site: SITE, skip: [] }], 'armed: no cell left out; the repair goes on');

    const nobody = heldSetup({ weapon: true, health: 6 });
    await breachAt(nobody);
    assert.deepEqual(nobody.labels.filter(l => l === 'action:backAway'), [], 'nothing in reach: no back-away, the repair');
    assert.deepEqual(nobody.o.repairs, [{ site: SITE, skip: [] }]);

    const twelve = reach(heldSetup({ weapon: true, health: UNDER }));
    await breachAt(twelve);
    assert.deepEqual(twelve.labels, ['action:buildShelter', 'action:backAway'], `PR 5: armed at health ${UNDER}, a zombie (up to ${ZOMBIE_HIT}): backed away`);

    const spider = heldSetup({ weapon: true, health: 6 });
    spider.o.mobInReach = () => ({ id: 11, name: 'spider', position: new Vec3(1.5, 64, 1.5) });
    await breachAt(spider);
    assert.deepEqual(spider.labels.filter(l => l === 'action:backAway'), [], 'PR 5: armed at health 6, a spider (up to 2): no back-away');

    const healthy = reach(heldSetup({ weapon: true, health: OVER }));
    await breachAt(healthy);
    assert.deepEqual(healthy.labels.filter(l => l === 'action:backAway'), [], `armed at health ${OVER}: no back-away`);
    assert.equal(nightState(healthy.agent).handFight, false);
    assert.deepEqual(healthy.o.repairs, [{ site: SITE, skip: [] }]);
});

// #497 review 1: a threat the shelter never hits (a troll, a creeper, a skeleton) in the opening or
// in reach starts the back-away, armed or not, at any health; cornered, the bot never hits it (a
// troll: when no burrow step was found either, PR 5); a cell it holds is left out of the repair.
test('#497 review 1: an armed bot at full health backs away from a troll (or a creeper) in reach or in the opening; cornered, it never hits it', async (t) => {
    quiet(t);
    const troll = { id: 9, name: 'iceandfire:if_troll', type: 'mob', position: new Vec3(1.5, 64, 1.5) };
    const near = heldSetup({ weapon: true, health: 20, held: 'none' });
    near.o.dangerInReach = () => troll;
    await breachAt(near);
    assert.deepEqual(near.labels, ['action:buildShelter', 'action:backAway'], 'armed, health 20, a troll in reach: backed away');
    assert.ok(near.agent.chat.includes('[night] an iceandfire:if_troll (avoid) in reach at 1, 64, 1: backing away into -1, 64, 0'), near.agent.chat.join('\n'));

    const cornered = heldSetup({ weapon: true, health: 20, held: 'none', plan: false });
    cornered.o.dangerInReach = () => troll;
    await breachAt(cornered);
    assert.equal(nightState(cornered.agent).handFight, false, 'never a hit at the troll');
    assert.ok(cornered.agent.chat.includes('[night] an iceandfire:if_troll (avoid) in reach at 1, 64, 1, and no way to back away or burrow: not hitting it'));
    assert.deepEqual(cornered.o.repairs, [{ site: SITE, skip: [] }], 'nothing in the opening: the repair goes on');

    const inIt = heldSetup({ weapon: true, health: 20, plan: false });
    const creeper = { id: 10, name: 'creeper', type: 'mob', position: new Vec3(1.5, 64, 0.5) };
    inIt.o.heldCells = (bot, site, open) => open.filter(c => c.equals(inIt.opening[0])).map(cell => ({ cell, mob: creeper }));
    await breachAt(inIt);
    assert.equal(nightState(inIt.agent).handFight, false);
    assert.ok(inIt.agent.chat.includes('[night] a creeper (keep-distance) in the opening at 1, 64, 0, and no way to back away: not hitting it'));
    assert.ok(inIt.agent.chat.includes('[night] a creeper in the opening at 1, 64, 0: not repairing under it; repairing the other open cells'));
    assert.deepEqual(inIt.o.repairs, [{ site: SITE, skip: ['1,64,0'] }], 'armed: the creeper\'s cell is still left out');

    const unarmed = heldSetup({ plan: false });
    const big = { ...troll, position: new Vec3(1.5, 64, 0.5) };
    unarmed.o.heldCells = (bot, site, open) => open.filter(c => c.equals(unarmed.opening[0])).map(cell => ({ cell, mob: big }));
    await breachAt(unarmed);
    assert.equal(nightState(unarmed.agent).handFight, false, 'unarmed: no hand fight at a troll either');
    assert.ok(unarmed.agent.chat.includes('[night] an iceandfire:if_troll (avoid) in the opening at 1, 64, 0, and no way to back away or burrow: not hitting it'));
});

test('#497 review 6: mobInReach finds the nearest melee mob within the shelter fight\'s reach (3); dangerInReach the nearest troll, creeper or skeleton', async () => {
    const { mobInReach, notMelee, NIGHT_OPS } = await import('./night_routine.js');
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0.5, 64, 0.5) };
    const m = (id, name, x) => ({ id, name, type: 'mob', position: new Vec3(x + 0.5, 64, 0.5), height: 1.8 });
    const bot = (...es) => ({ entity: self, entities: Object.fromEntries([[0, self], ...es.map(e => [e.id, e])]) });
    assert.equal(mobInReach(bot()), null);
    assert.equal(mobInReach(bot(m(1, 'zombie', 4))), null, 'out of reach (4 blocks)');
    assert.equal(mobInReach(bot(m(1, 'zombie', 3), m(2, 'zombie', 2))).id, 2, 'the nearest');
    assert.equal(mobInReach(bot(m(1, 'iceandfire:if_troll', 1))), null, 'a troll is no melee target');
    assert.equal(mobInReach(bot(m(1, 'cow', 1))), null);
    assert.equal(mobInReach({ entities: {} }), null, 'no position');
    assert.equal(NIGHT_OPS.dangerInReach(bot(m(1, 'iceandfire:if_troll', 2), m(2, 'zombie', 1))).id, 1, 'the troll, not the zombie');
    assert.equal(NIGHT_OPS.dangerInReach(bot(m(1, 'skeleton', 3))).id, 1);
    assert.equal(NIGHT_OPS.dangerInReach(bot(m(1, 'zombie', 1), m(2, 'cow', 1), m(3, 'enderman', 1))), null, 'a zombie, a cow, an enderman: none');
    assert.deepEqual(['creeper', 'skeleton', 'iceandfire:if_troll', 'zombie', 'cow'].map(n => notMelee(m(9, n, 1))), [true, true, true, false, false]);
});

// Soak 5: a repair that closed the shelter is said in the journal (00:31:47 said nothing); after a
// back-away or the pocket move the "out of the shelter" line names the new cell (00:46:55 named the
// hole's closing spot).
test('soak 5: the repair that closed the shelter is logged; a back-away refreshes where the shelter closed', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    t.mock.method(console, 'warn', () => {});
    const armed = heldSetup({ weapon: true, held: 'none' });
    await breachAt(armed);
    assert.ok(logs.includes('[night] the repair closed the shelter at 0, 64, 0'), logs.join('\n'));
    const back = heldSetup({ health: 8 });
    await breachAt(back);
    assert.ok(nightState(back.agent).site.equals(SITE.offset(-1, 0, 0)));
    assert.match(nightState(back.agent).closedOn.at, /^-0\.50, 64\.00, 0\.50 /, 'where the bot stands in the new cell');
});

// Soak 3 (rotn-v0.1.5), the lead's C: a walk away a reflex cut short is tried again 5 s later, three
// walks in all; one that ran out of time is not; the plan is told whether it is night and armed.
test('soak 3 C: an interrupted walk away is tried again NIGHT_RELOCATE.waitMs later, 3 walks in all, then the shelter; a timed-out walk is not tried again', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = deathOps();
    o.hasWeapon = () => true;
    let plans = 0;
    o.nightRelocation = (a, now, opts) => { plans++; o.relocOpts = opts; return { mode: 'full', target: { x: 60, z: 0 }, places: [], away: 48, line: '[night] I died near here recently: moving at least 48 blocks from the spawn and 1 recent death spot, towards 60, 0, before sheltering' }; };
    const tick = async (now) => { nightTick(agent, { now, ops: o }); await settle(agent); };
    agent.actions.interruptNext = true;
    await tick(1);
    assert.deepEqual(o.relocOpts, { night: true, armed: true });
    assert.equal(nightState(agent).leftDeathSpot, false, 'interrupted: not done');
    await tick(2); // starts the wait
    await tick(2 + NIGHT_RELOCATE.waitMs - 1);
    assert.equal(plans, 1, 'waiting');
    agent.actions.interruptNext = true;
    await tick(2 + NIGHT_RELOCATE.waitMs);
    assert.equal(plans, 2);
    assert.ok(agent.chat.some(l => l.endsWith('before sheltering (walk 2 of 3)')));
    await tick(3 + NIGHT_RELOCATE.waitMs);
    agent.actions.interruptNext = true;
    await tick(4 + 2 * NIGHT_RELOCATE.waitMs);
    assert.equal(plans, 3);
    assert.equal(nightState(agent).leftDeathSpot, true, 'after 3 walks: shelter where it is');
    await tick(5 + 2 * NIGHT_RELOCATE.waitMs);
    assert.deepEqual(o.calls, ['build'], 'then the shelter (the walks never ran: interrupted)');

    const late = fakeAgent({ t: NIGHT });
    const o2 = deathOps();
    o2.nightRelocation = () => ({ mode: 'short', target: { x: 30, z: 0 }, places: [], away: 24, line: '[night] walk' });
    o2.walkAwayAtNight = () => { o2.calls.push('away'); return Promise.resolve({ arrived: false, nearest: 10, stopped: 'time' }); };
    nightTick(late, { now: 1, ops: o2 }); await settle(late);
    nightTick(late, { now: 2, ops: o2 }); await settle(late);
    assert.deepEqual(o2.calls, ['away', 'build'], 'out of time: no second walk, the shelter next');
});

// Soak 3, the lead's (a): a hole shelter, once closed, moves the bot into a side pocket at its bottom
// and seals the shaft behind, so a zombie that digs the roof finds a sealed column, not the bot.
test('soak 3 (a): a closed hole shelter: into a side pocket once (the shaft sealed); a built shelter gets none; no enclosed side: it stays', async (t) => {
    quiet(t);
    const P = SITE.offset(0, -3, 0);
    const holeAgent = ({ plan = true } = {}) => {
        const agent = fakeAgent({ t: NIGHT });
        const o = deathOps();
        o.pockets = [];
        o.retreatPlan = (bot, site, open) => { o.pockets.push({ site, open }); return plan ? { to: P.offset(-1, 0, 0), dig: [], seal: [P, P.offset(0, 1, 0)] } : null; };
        o.backAway = (bot, p) => { bot.entity.position = p.to.offset(0.5, 0, 0.5); return Promise.resolve({ site: p.to }); };
        const labels = [];
        const run = agent.actions.runAction.bind(agent.actions);
        agent.actions.runAction = (label, fn) => { labels.push(label); return run(label, fn); };
        return { agent, o, labels };
    };
    const { agent, o, labels } = holeAgent();
    let now = 0;
    const run = async (at) => { nightTick(agent, { now: at, ops: o }); await settle(agent); };
    await run(++now); // build refused: no dirt
    await run(++now); // the hole, roofed
    assert.equal(nightState(agent).pit, true);
    assert.equal(nightState(agent).state, 'inside');
    agent.bot.entity.position = P.offset(0.5, 0, 0.5);
    await run(++now); // the first check starts the clock
    await run(now + CHECK_MS + 1);
    assert.equal(labels.at(-1), 'action:sidePocket');
    assert.deepEqual(o.pockets.map(x => x.open), [[]], 'planned with no opening');
    assert.ok(nightState(agent).site.equals(P.offset(-1, 0, 0)));
    assert.equal(agent.bot.rotnSheltered, true);
    assert.ok(agent.chat.includes(`[night] the hole shelter at ${P.x}, ${P.y}, ${P.z}: moving into a side pocket at ${P.x - 1}, ${P.y}, ${P.z} and sealing the shaft behind`));
    assert.ok(agent.chat.includes(`[night] moved into the side pocket: in the shelter at ${P.x - 1}, ${P.y}, ${P.z}, the cells behind sealed`));
    await run(now + 3 * CHECK_MS);
    assert.equal(o.pockets.length, 1, 'once');

    // No enclosed side: it stays under the roof.
    const none = holeAgent({ plan: false });
    for (let k = 1; k <= 3; k++) { nightTick(none.agent, { now: k, ops: none.o }); await settle(none.agent); }
    none.agent.bot.entity.position = P.offset(0.5, 0, 0.5);
    nightTick(none.agent, { now: 4 + CHECK_MS, ops: none.o }); await settle(none.agent);
    assert.equal(none.o.pockets.length, 1);
    assert.ok(nightState(none.agent).site.equals(P));
    assert.ok(!none.labels.includes('action:sidePocket'));

    // A built shelter (not a hole): no pocket.
    const built = fakeAgent({ t: NIGHT });
    const bo = ops();
    bo.retreatPlan = () => { throw new Error('no pocket for a built shelter'); };
    bo.backAway = () => Promise.resolve(null);
    nightTick(built, { now: 0, ops: bo }); await settle(built);
    nightTick(built, { now: 1, ops: bo });
    nightTick(built, { now: CHECK_MS + 2, ops: bo }); await settle(built);
    assert.equal(nightState(built).state, 'inside');
});

// Soak 4 (rotn-v0.1.7): a zombie stood 14 min at the shelter's corner (-58,65,-81 by -59,65,-82),
// never digging or hitting, and the bot waited the whole day. The lead's morning rule.
test('soak 4: morningChoice: fight only armed, health 14 or more, one hostile mob near and nothing that explodes or shoots; else leave', async () => {
    const { morningChoice, sideToward } = await import('./night_routine.js');
    const zombie = (id, x, z) => ({ id, name: 'zombie', type: 'mob', position: new Vec3(x, 64, z) });
    const botWith = ({ weapon = true, health = 20, mobs = [zombie(2, 1.5, 1.5)] } = {}) => ({
        health, entity: { position: new Vec3(0.5, 64, 0.5) },
        inventory: { items: () => (weapon ? [{ name: 'stone_axe', count: 1 }] : []), slots: [] },
        entities: Object.fromEntries(mobs.map(m => [m.id, m])),
    });
    // Soak 7 (A): a fight only when it is winnable by the numbers (here given; rotn-data has none yet).
    const winnable = () => ({ health: 20, mobHealth: 20, mobHit: 2, mobIntervalMs: 1000, hitDamage: 10, cooldownMs: 1250 });
    assert.deepEqual(morningChoice(botWith(), SITE, { numbers: winnable }),
        { action: 'fight', why: 'armed, health 20, one zombie near (2 hits in about 1.3 s, taking about 4: health 16 left)' });
    const close = () => ({ health: 20, mobHealth: 20, mobHit: 3, mobIntervalMs: 1000, hitDamage: 5, cooldownMs: 1250 });
    assert.deepEqual(morningChoice(botWith(), SITE, { numbers: close }),
        { action: 'leave', why: `armed, health 20, but 4 hits in about 3.8 s, taking about 12: health 8 left, not above the ${ZOMBIE_HIT} it may hit for` });
    // Today (rotn-data has no mob health, attack interval or weapon damage): leave.
    assert.deepEqual(morningChoice(botWith(), SITE),
        { action: 'leave', why: 'armed, health 20, but the fight cannot be judged yet (unknown: its health, its attack interval, our weapon damage)' });
    assert.deepEqual(morningChoice(botWith({ weapon: false }), SITE, { numbers: winnable }), { action: 'leave', why: 'no weapon' });
    assert.deepEqual(morningChoice(botWith({ health: 13 }), SITE, { numbers: winnable }), { action: 'leave', why: 'armed, but health 13' });
    assert.deepEqual(morningChoice(botWith({ mobs: [zombie(2, 1.5, 1.5), zombie(3, -4, 2)] }), SITE), { action: 'leave', why: '2 hostile mobs near' });
    const creeper = { id: 4, name: 'creeper', type: 'mob', position: new Vec3(12, 64, 0) };
    assert.deepEqual(morningChoice(botWith({ mobs: [zombie(2, 1.5, 1.5), creeper] }), SITE), { action: 'leave', why: 'a creeper near (keep-distance)' });
    // The side toward a mob: the diagonal corner of soak 4 (+1, +1) takes the x side; else the nearer axis.
    assert.deepEqual(sideToward(SITE, new Vec3(1.5, 64, 1.5)), new Vec3(1, 0, 0));
    assert.deepEqual(sideToward(SITE, new Vec3(0.2, 64, -3)), new Vec3(0, 0, -1));
});

test('soak 4: armed after the grace, the wall toward the mob opens and the fight runs from the shelter; once the mob is gone the usual exit; a fight below health 12 leaves away from it; the cap hands back', async (t) => {
    quiet(t);
    const { MORNING: RULE } = await import('./night_routine.js');
    const zombie = { id: 2, name: 'zombie', position: new Vec3(1.5, 64, 1.5) };
    const setup = () => {
        const agent = fakeAgent({ t: NIGHT });
        const o = ops();
        let mob = zombie;
        o.hostileNear = () => mob;
        o.morningChoice = () => ({ action: 'fight', why: 'armed, health 20, one zombie near' });
        o.opened = [];
        o.openToward = (bot, feet, pos) => { o.opened.push(pos); return Promise.resolve([feet.offset(1, 1, 0), feet.offset(1, 0, 0)]); };
        o.awayFromMobs = () => Promise.resolve();
        o.outs = [];
        o.digOut = (bot, feet, opts) => { o.digs++; o.outs.push(opts?.away ?? null); return Promise.resolve(SITE.offset(-1, 0, 0)); };
        return { agent, o, gone: () => { mob = null; } };
    };
    const morning = async ({ agent, o }, until) => {
        nightTick(agent, { now: 0, ops: o }); await settle(agent);
        agent.bot.time.timeOfDay = MORNING;
        for (let now = 10; now <= until; now += RETRY_MS) { nightTick(agent, { now, ops: o }); await settle(agent); }
    };
    const fight = setup();
    await morning(fight, 10 + RULE.waitMs);
    assert.deepEqual(fight.o.opened, [zombie.position], 'the wall toward the zombie');
    assert.equal(fight.agent.bot.rotnSheltered, 'open', 'the in-shelter fight (armed) hits it in reach');
    assert.ok(fight.agent.chat.includes('[night] morning: armed, health 20, one zombie near: opening the wall toward a zombie at 1, 64, 1 to fight it from the shelter'));
    assert.equal(fight.o.digs, 0);
    fight.gone(); // killed
    nightTick(fight.agent, { now: 20 + RULE.waitMs + RETRY_MS, ops: fight.o }); await settle(fight.agent);
    assert.equal(fight.o.digs, 0, 'gone for less than 30 s');
    nightTick(fight.agent, { now: 20 + RULE.waitMs + 2 * RETRY_MS, ops: fight.o }); await settle(fight.agent);
    assert.equal(fight.o.digs, 1);
    assert.deepEqual(fight.o.outs, [null], 'the usual exit');
    assert.equal(nightState(fight.agent).state, 'day');

    // Hurt below MORNING.fleeHealth in the fight: out by the side away from it.
    const hurt = setup();
    await morning(hurt, 10 + RULE.waitMs);
    hurt.agent.bot.health = RULE.fleeHealth - 1;
    nightTick(hurt.agent, { now: 20 + RULE.waitMs, ops: hurt.o }); await settle(hurt.agent);
    assert.deepEqual(hurt.o.outs, [zombie.position]);
    assert.ok(hurt.agent.chat.includes(`[night] morning: health ${RULE.fleeHealth - 1} in the fight: leaving the shelter at 0, 64, 0 by the side away from a zombie at 1, 64, 1`));
    assert.equal(nightState(hurt.agent).state, 'day');

    // The zombie never comes into reach and the bot is not hurt: back to work at MORNING.capMs.
    const cap = setup();
    await morning(cap, 10 + RULE.capMs - 1000);
    assert.equal(nightState(cap.agent).state, 'inside');
    nightTick(cap.agent, { now: 10 + RULE.capMs, ops: cap.o }); await settle(cap.agent);
    assert.equal(nightState(cap.agent).state, 'day');
    assert.match(cap.agent.chat.at(-1), /^\[night\] morning: a zombie at 1, 64, 1 still near the shelter at 0, 64, 0 after 5 min; back to work/);
});

test('soak 4: openToward opens the wall (head and feet) on the mob\'s side; digOut away from a mob takes the far side first', async (t) => {
    quiet(t);
    const { openToward } = await import('./night_routine.js');
    const { bot, dug } = exitWorld();
    const cells = await openToward(bot, SITE, new Vec3(1.5, 64, 1.5));
    assert.deepEqual(cells.map(c => `${c.x},${c.y},${c.z}`), ['1,65,0', '1,64,0']);
    assert.deepEqual(dug, ['1,65,0', '1,64,0']);
    const far = exitWorld();
    const side = await digOut(far.bot, SITE, { away: new Vec3(1.5, 64, 1.5) });
    assert.ok(side?.equals(new Vec3(-1, 64, 0)) || side?.equals(new Vec3(0, 64, -1)), `opened ${side}: a side away from the zombie`);
    const near = exitWorld();
    const plain = await digOut(near.bot, SITE);
    assert.ok(plain?.equals(new Vec3(1, 64, 0)), 'without a mob: the first side, as before');
});

test('soak 4: the mob\'s state at the grace end: moved or not, health, held item, helmet, sky light', async () => {
    const { mobStateLine } = await import('./night_routine.js');
    const zombie = { name: 'zombie', position: new Vec3(-57.5, 65, -80.5), health: 20, heldItem: null, equipment: [null, null, null, null, null, { name: 'iron_helmet' }] };
    const bot = { blockAt: () => ({ skyLight: 4 }) };
    assert.equal(mobStateLine(bot, zombie, { pos: zombie.position.clone() }, 120_000),
        '[night] morning: after 120 s a zombie at -58, 65, -81 has not moved; health 20, holds nothing, helmet iron_helmet, sky light 4');
    assert.match(mobStateLine({}, { ...zombie, position: new Vec3(-55.5, 65, -80.5), equipment: [{ name: 'stone_pickaxe' }] }, { pos: zombie.position }, 60_000),
        /after 60 s a zombie at -56, 65, -81 moved 2 blocks; health 20, holds stone_pickaxe, helmet none, sky light unknown$/);
});

// #477 review: a hole never opens toward a mob; the fight ends when a second mob or a creeper comes;
// a mob out of range for a moment keeps the wait and the cap.
test('#477 review 1: a hole or side-pocket shelter always leaves by its far stairs; never opened toward the mob', async (t) => {
    quiet(t);
    const { morningChoice, MORNING: RULE } = await import('./night_routine.js');
    const armed = { health: 20, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [{ name: 'stone_axe', count: 1 }], slots: [] },
        entities: { 2: { id: 2, name: 'zombie', type: 'mob', position: new Vec3(1.5, 64, 1.5) } } };
    assert.deepEqual(morningChoice(armed, SITE, { pit: true }), { action: 'leave', why: 'a hole shelter' });
    const agent = fakeAgent({ t: NIGHT });
    Object.assign(agent.bot, { health: 20, inventory: armed.inventory, entities: armed.entities });
    const o = ops();
    const zombie = armed.entities[2];
    o.hostileNear = () => zombie;
    o.openToward = () => { throw new Error('a hole is never opened toward a mob'); };
    const outs = [];
    o.pitOut = (bot, feet, opts) => { outs.push(opts?.away ?? null); return Promise.resolve(SITE.offset(-3, 3, 0)); };
    o.awayFromMobs = () => Promise.resolve();
    nightTick(agent, { now: 0, ops: o }); await settle(agent);
    nightState(agent).pit = true;
    agent.bot.time.timeOfDay = MORNING;
    for (let now = 10; now <= 10 + RULE.waitMs; now += RETRY_MS) { nightTick(agent, { now, ops: o }); await settle(agent); }
    assert.deepEqual(outs, [zombie.position]);
    assert.ok(agent.chat.includes('[night] morning: a hole shelter: leaving the shelter at 0, 64, 0 by the side away from a zombie at 1, 64, 1'));
    assert.equal(nightState(agent).state, 'day');
});

test('#477 review 2: mid-fight, a second zombie or a creeper ends the fight at once: out away from them; no melee in the opening while leaving', async (t) => {
    quiet(t);
    const { MORNING: RULE } = await import('./night_routine.js');
    // Two blocks out (soak 7 (C): a zombie within its reach of the bot is not left past; tested below).
    const zombie = { id: 2, name: 'zombie', type: 'mob', position: new Vec3(2.6, 64, 0.5) };
    const fightWith = async (arrival) => {
        const agent = fakeAgent({ t: NIGHT });
        Object.assign(agent.bot, { health: 20, inventory: { items: () => [{ name: 'stone_axe', count: 1 }], slots: [] }, entities: { 2: zombie } });
        const o = ops();
        o.hostileNear = () => zombie;
        o.morningChoice = () => ({ action: 'fight', why: 'armed, health 20, one zombie near' }); // soak 7 (A): no fight is judged winnable yet
        o.openToward = (bot, feet) => Promise.resolve([feet.offset(1, 1, 0), feet.offset(1, 0, 0)]);
        o.outs = [];
        o.digOut = (bot, feet, opts) => { o.digs++; o.outs.push(opts?.away ?? null); return Promise.resolve(SITE.offset(-1, 0, 0)); };
        o.awayFromMobs = () => Promise.resolve();
        nightTick(agent, { now: 0, ops: o }); await settle(agent);
        agent.bot.time.timeOfDay = MORNING;
        let now = 10;
        for (; now <= 10 + RULE.waitMs; now += RETRY_MS) { nightTick(agent, { now, ops: o }); await settle(agent); }
        assert.equal(agent.bot.rotnSheltered, 'open', 'the fight began');
        assert.equal(nightState(agent).morningAct, 'fight');
        agent.bot.entities[arrival.id] = arrival;
        let leaving = null;
        o.digOut = (bot, feet, opts) => { leaving = nightState(agent).morningAct; o.digs++; o.outs.push(opts?.away ?? null); return Promise.resolve(SITE.offset(-1, 0, 0)); };
        nightTick(agent, { now: now + 1, ops: o }); await settle(agent); // the very next tick
        return { agent, o, leaving };
    };
    const two = await fightWith({ id: 3, name: 'zombie', type: 'mob', position: new Vec3(-3, 64, 4) });
    assert.deepEqual(two.o.outs, [zombie.position], 'out away from the zombie in the opening');
    assert.ok(two.agent.chat.includes('[night] morning: 2 hostile mobs near in the fight: leaving the shelter at 0, 64, 0 by the side away from a zombie at 2, 64, 0'), two.agent.chat.join('\n'));
    assert.equal(two.leaving, 'leaving', 'no melee meanwhile (modes.nightRoutineBusy)');
    const boom = await fightWith({ id: 4, name: 'creeper', type: 'mob', position: new Vec3(10, 64, 0) });
    assert.ok(boom.agent.chat.includes('[night] morning: a creeper near (keep-distance) in the fight: leaving the shelter at 0, 64, 0 by the side away from a zombie at 2, 64, 0'), boom.agent.chat.join('\n'));
    assert.equal(nightState(boom.agent).state, 'day');
});

test('#477 nits: a mob out of range for less than 30 s keeps the wait\'s start and the cap; mobStateLine names a different mob', async (t) => {
    quiet(t);
    const { MORNING: RULE, mobStateLine } = await import('./night_routine.js');
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    o.morningChoice = () => ({ action: 'fight', why: 'armed, health 20, one zombie near' });
    o.morningDanger = () => null;
    o.openToward = (bot, feet) => Promise.resolve([feet.offset(1, 0, 0)]);
    const zombie = { id: 2, name: 'zombie', position: new Vec3(1.5, 64, 1.5) };
    let mob = zombie;
    o.hostileNear = () => mob;
    nightTick(agent, { now: 0, ops: o }); await settle(agent);
    agent.bot.time.timeOfDay = MORNING;
    nightTick(agent, { now: 10, ops: o }); await settle(agent);
    assert.equal(nightState(agent).mobSince, 10);
    mob = null; // steps out of range for 20 s
    nightTick(agent, { now: 10 + RETRY_MS, ops: o }); await settle(agent);
    assert.equal(nightState(agent).mobSince, 10);
    mob = zombie;
    nightTick(agent, { now: 10 + RETRY_MS + 20_000, ops: o }); await settle(agent);
    assert.equal(nightState(agent).mobSince, 10, 'the same wait');
    for (let now = 10 + 2 * RETRY_MS; now < 10 + RULE.capMs; now += RETRY_MS) { nightTick(agent, { now, ops: o }); await settle(agent); }
    nightTick(agent, { now: 10 + RULE.capMs, ops: o }); await settle(agent);
    assert.equal(nightState(agent).state, 'day', 'the cap counts from the first sight');
    assert.match(mobStateLine({}, { id: 9, name: 'zombie', position: new Vec3(2.5, 64, 0.5) }, { id: 2, pos: zombie.position }, 120_000),
        /^\[night\] morning: after 120 s a zombie at 2, 64, 0 is a different mob from the first one; /);
});

test('#477 review 1-3: leaveShelterFor clears the morning state; a failed leave try keeps morningLeaving; the wall opened for the fight is not rebuilt while the mob is out of range', async (t) => {
    quiet(t);
    const { MORNING: RULE, leaveShelterFor } = await import('./night_routine.js');
    const zombie = { id: 2, name: 'zombie', position: new Vec3(1.5, 64, 1.5) };
    // A failed leave try (no side away opens): still leaving between the tries.
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    o.hostileNear = () => zombie;
    o.digOut = () => { o.digs++; return Promise.resolve(null); };
    nightTick(agent, { now: 0, ops: o }); await settle(agent);
    agent.bot.time.timeOfDay = MORNING;
    for (let now = 10; now <= 10 + RULE.waitMs; now += RETRY_MS) { nightTick(agent, { now, ops: o }); await settle(agent); }
    assert.equal(o.digs, 1, 'the first leave try failed');
    assert.equal(nightState(agent).morningAct, 'leave');
    assert.equal(nightState(agent).morningLeaving, true, 'busy until the hand-back');
    // A giver's command takes over: the morning state goes with the shelter's rules.
    assert.equal(leaveShelterFor(agent, "a task giver's command"), true);
    assert.deepEqual([nightState(agent).morningAct, nightState(agent).morningLeaving, nightState(agent).mobFirst, nightState(agent).mobGoneAt], [null, false, null, null]);

    // The fight's opening: the mob steps out of range (the 30 s window): no repair of that wall.
    const f = fakeAgent({ t: NIGHT });
    const fo = ops();
    let mob = zombie;
    fo.hostileNear = () => mob;
    fo.morningChoice = () => ({ action: 'fight', why: 'armed, health 20, one zombie near' });
    fo.morningDanger = () => null;
    fo.openToward = (bot, feet) => { fo.open = [feet.offset(1, 0, 0), feet.offset(1, 1, 0)]; return Promise.resolve(fo.open); };
    nightTick(f, { now: 0, ops: fo }); await settle(f);
    f.bot.time.timeOfDay = MORNING;
    let now = 10;
    for (; now <= 10 + RULE.waitMs; now += RETRY_MS) { nightTick(f, { now, ops: fo }); await settle(f); }
    const builds = fo.builds.length;
    mob = null;
    for (let k = 1; k <= 5; k++) { nightTick(f, { now: now + k * 5000, ops: fo }); await settle(f); }
    assert.equal(fo.builds.length, builds, 'the opened wall is not rebuilt in the window');
    assert.equal(f.bot.rotnSheltered, 'open');
});

// #477 review 4 (#478, ate_when_low): the routine holds the bot in its closed shelter (the morning
// grace, and at night) with a zombie at the corner; the eating mode eats at food 12.
test('#477 review 4: held by the morning grace, and at night, with a zombie at the corner, the eating mode eats at food 12', async (t) => {
    quiet(t);
    const zombie = { id: 2, name: 'zombie', type: 'mob', position: new Vec3(1.5, 64, 1.5), metadata: [] };
    const eatingAt = async (agent) => {
        const bot = agent.bot;
        const items = [{ name: 'harvestcraft:zucchiniitem', metadata: 0, count: 1 }, { name: 'bread', metadata: 0, count: 1 }];
        const eaten = [];
        Object.assign(bot, {
            food: 12, health: 20, entities: { 1: bot.entity, 2: zombie },
            inventory: { items: () => items.filter(i => i.count > 0), slots: [] },
            equip: (item) => { bot.held = item; return Promise.resolve(); },
            consume: () => { eaten.push(bot.held.name); bot.held.count--; bot.food += 3; return Promise.resolve(); },
        });
        const mode = __modeForTest('eating');
        Object.assign(mode, { wait_until: -Infinity, fails: {}, given_up: new Set(), check_ms: 1 });
        const modeAgent = { bot, isIdle: () => true, actions: { currentActionLabel: '', resume_func: null, runAction: async (l, fn) => { await fn(); return { interrupted: false }; } } };
        await mode.update(modeAgent);
        await new Promise(r => setTimeout(r, 20));
        return eaten;
    };
    // The morning grace: the routine holds the bot in (sealed) with the zombie near.
    const morning = fakeAgent({ t: NIGHT });
    const o = ops();
    o.hostileNear = () => zombie;
    nightTick(morning, { now: 0, ops: o }); await settle(morning);
    morning.bot.time.timeOfDay = MORNING;
    assert.equal(nightTick(morning, { now: 10, ops: o }), 'night:inside');
    assert.match(morning.chat.at(-1), /staying in until it leaves/);
    assert.equal(morning.bot.rotnSheltered, true);
    assert.deepEqual(await eatingAt(morning), ['harvestcraft:zucchiniitem'], 'eats at 12 in the grace');
    // At night, sealed in, the zombie at the corner.
    const night = fakeAgent({ t: NIGHT });
    nightTick(night, { now: 0, ops: ops() }); await settle(night);
    assert.equal(nightState(night).state, 'inside');
    assert.equal(night.bot.rotnSheltered, true);
    assert.deepEqual(await eatingAt(night), ['harvestcraft:zucchiniitem'], 'eats at 12 at night');
});

test('#478: the night does not save the standing goal; the hand-back keeps the last shelter for it', async (t) => {
    quiet(t);
    const { STANDING_GOAL_PREFIX } = await import('./agenda.js');
    const agent = fakeAgent({ t: DUSK });
    agent.self_prompter.prompt = `${STANDING_GOAL_PREFIX}keep food worth at least 12 hunger …`;
    nightTick(agent, { now: Date.now(), ops: ops() });
    await settle(agent);
    assert.equal(agent._night_goal, undefined, 'not saved');
    agent.bot.time.timeOfDay = MORNING;
    nightTick(agent, { now: Date.now() + 1, ops: ops() });
    await settle(agent);
    assert.equal(nightState(agent).state, 'day');
    assert.ok(nightState(agent).lastShelter.equals(SITE), 'the last shelter, for the standing goal');
    assert.equal(resumeNightGoal(agent), false);
});

test('#477 nit: the end-of-day fallback clears the morning state too', async (t) => {
    quiet(t);
    const agent = fakeAgent({ t: NIGHT });
    const o = ops();
    nightTick(agent, { now: 0, ops: o }); await settle(agent);
    Object.assign(nightState(agent), { mobSince: 5, morningAct: 'leave', morningLeaving: true, morningWhy: 'no weapon', mobFirst: {}, mobStateSaid: true, mobGoneAt: 7 });
    agent.bot.time.timeOfDay = 5400; // past the full day: the fallback
    nightTick(agent, { now: 10, ops: o }); await settle(agent);
    const n = nightState(agent);
    assert.deepEqual([n.mobSince, n.morningAct, n.morningLeaving, n.morningWhy, n.mobFirst, n.mobStateSaid, n.mobGoneAt], [null, null, false, null, null, false, null]);
});

test('#479 nit 3: lastShelter is kept on the no-shelter morning path (where the night was spent) and by leaveShelterFor', async (t) => {
    quiet(t);
    const { leaveShelterFor } = await import('./night_routine.js');
    // Exposed all night (no shelter): the morning keeps where the bot spent it.
    const exposed = fakeAgent({ t: NIGHT });
    const o = ops({ closed: false });
    o.digPit = () => Promise.resolve(null);
    for (let now = 1; now < 6 * RETRY_MS; now += RETRY_MS + 1) { nightTick(exposed, { now, ops: o }); await settle(exposed); }
    assert.notEqual(nightState(exposed).state, 'inside');
    exposed.bot.entity.position = new Vec3(7.5, 64, -3.5);
    exposed.bot.time.timeOfDay = MORNING;
    nightTick(exposed, { now: 10 * RETRY_MS, ops: o });
    assert.equal(nightState(exposed).state, 'day');
    assert.ok(nightState(exposed).lastShelter.equals(new Vec3(7, 64, -4)));
    // A giver's command takes the bot out of its shelter: that shelter is kept.
    const inside = fakeAgent({ t: NIGHT });
    nightTick(inside, { now: 0, ops: ops() }); await settle(inside);
    assert.equal(leaveShelterFor(inside, "a task giver's command"), true);
    assert.ok(nightState(inside).lastShelter.equals(SITE));
});

// Soak 5 Fix B (PR 5), the lead's rule: at night a mob that digs through anything (the troll) within
// ~7 blocks of the bot in its shelter, closed or open, starts the burrow at once (not CHECK_MS later);
// where it ends up is the shelter; the night has BURROW.maxSteps steps; never a hit at the troll.
test('PR 5 (Fix B): a troll near the closed shelter: the burrow starts at once; the new cell is the shelter; the night\'s steps run out; cornered, retried only after CHECK_MS', async (t) => {
    quiet(t);
    const { BURROW } = await import('./library/burrow.js');
    const s = heldSetup({ weapon: true });
    const tr = { id: 9, name: 'iceandfire:if_troll', type: 'mob', position: new Vec3(4.5, 64, 0.5) };
    s.agent.bot.entities = { 9: tr };
    let near = false;
    const asked = [];
    let result = { steps: 5, stopped: 'far' };
    s.o.burrowThreat = () => (near ? { mob: tr, d: 4, ranges: { start: 6.97, stop: 7.97 } } : null);
    s.o.burrowAway = (bot, mob, opts) => {
        asked.push(opts.maxSteps);
        if (result.steps) bot.entity.position = bot.entity.position.offset(-result.steps, 0, 0);
        return Promise.resolve({ steps: result.steps, site: null, stopped: result.stopped, why: result.why });
    };
    nightTick(s.agent, { now: 0, ops: s.o });
    await settle(s.agent);
    assert.equal(nightState(s.agent).state, 'inside');
    near = true;
    nightTick(s.agent, { now: 1, ops: s.o }); // closed, 1 ms after the last check: still at once
    await settle(s.agent);
    assert.ok(s.labels.includes('action:burrowAway'), s.labels.join(','));
    assert.deepEqual(asked, [BURROW.maxSteps]);
    assert.ok(s.agent.chat.includes('[night] an iceandfire:if_troll (digs through anything) 4.0 blocks from the shelter at 0, 64, 0: burrowing away from it'), s.agent.chat.join('\n'));
    assert.ok(s.agent.chat.includes('[night] burrowed 5 steps into -5, 64, 0, 9.0 blocks from an iceandfire:if_troll: far enough; sealed behind'), s.agent.chat.join('\n'));
    const n = nightState(s.agent);
    assert.deepEqual([n.site, n.burrowSteps, s.agent.bot.rotnSheltered], [new Vec3(-5, 64, 0), 5, true]);
    assert.equal(n.handFight ?? false, false);
    // It comes again: the rest of the night's steps; then none are left.
    result = { steps: 11, stopped: 'budget' };
    nightTick(s.agent, { now: 2, ops: s.o });
    await settle(s.agent);
    assert.deepEqual(asked, [16, 11]);
    assert.ok(s.agent.chat.includes(`[night] burrowed 11 steps into -16, 64, 0, 20.0 blocks from an iceandfire:if_troll: the night's ${BURROW.maxSteps} burrow steps are used; not hitting it`), s.agent.chat.join('\n'));
    nightTick(s.agent, { now: 3 + CHECK_MS, ops: s.o });
    await settle(s.agent);
    assert.deepEqual(asked, [16, 11], 'budget used: no more burrows tonight');

    // Cornered: said, and not tried again until CHECK_MS has passed.
    const c = heldSetup({ weapon: true });
    c.agent.bot.entities = { 9: tr };
    const tries = [];
    c.o.burrowThreat = () => (tries.length >= 0 && c.go ? { mob: tr, d: 4 } : null);
    c.o.burrowAway = () => { tries.push(1); return Promise.resolve({ steps: 0, site: null, stopped: 'cornered', why: 'no blocks to seal with' }); };
    // #507 review 4: the wait counts from when the burrow ended (the ops clock), not from its start.
    c.o.now = () => 5_000;
    nightTick(c.agent, { now: 0, ops: c.o });
    await settle(c.agent);
    c.go = true;
    nightTick(c.agent, { now: 1, ops: c.o });
    await settle(c.agent);
    assert.ok(c.agent.chat.includes('[night] did not burrow (still at 0, 64, 0), 4.0 blocks from an iceandfire:if_troll: no step further (no blocks to seal with); not hitting it'), c.agent.chat.join('\n'));
    nightTick(c.agent, { now: 2, ops: c.o });
    await settle(c.agent);
    assert.equal(tries.length, 1, 'not again within CHECK_MS');
    nightTick(c.agent, { now: 2 + CHECK_MS, ops: c.o });
    await settle(c.agent);
    assert.equal(tries.length, 1, 'CHECK_MS after the start, but not after the end (5 s): not yet');
    nightTick(c.agent, { now: 5_000 + CHECK_MS, ops: c.o });
    await settle(c.agent);
    assert.equal(tries.length, 2, 'again CHECK_MS after the burrow ended');
});

// #507 review 3: pitOut assumes the hole's 3 below the surface; a burrow that changed the bot's level
// leaves the hole shelter, and the morning digs out with digOut from the new cell.
test('#507 review 3: a burrow down from a hole shelter clears n.pit (the morning uses digOut); a level burrow keeps it', async (t) => {
    quiet(t);
    for (const [dy, pit] of [[-2, false], [0, true]]) {
        const s = heldSetup({ weapon: true });
        const tr = { id: 9, name: 'iceandfire:if_troll', type: 'mob', position: new Vec3(4.5, 64, 0.5) };
        s.agent.bot.entities = { 9: tr };
        let near = false;
        s.o.burrowThreat = () => (near ? { mob: tr, d: 4 } : null);
        s.o.burrowAway = (bot) => { bot.entity.position = bot.entity.position.offset(dy ? 0 : -1, dy, 0); return Promise.resolve({ steps: 1, site: null, stopped: 'far' }); };
        nightTick(s.agent, { now: 0, ops: s.o });
        await settle(s.agent);
        nightState(s.agent).pit = true;
        near = true;
        nightTick(s.agent, { now: 1, ops: s.o });
        await settle(s.agent);
        assert.equal(nightState(s.agent).site.y, 64 + dy);
        assert.equal(nightState(s.agent).pit, pit, `dy ${dy}`);
    }
});

// ---- Soak 7 (rotn-v0.1.13, death 1, 23:22:19-23:24:33) ----
// A zombie at the shelter's corner for 120 s; armed at health 20 the morning rule opened the wall
// toward it; it walked into the bot's cell, the bot fell to 11 and "left by the side away from a
// zombie at -44, 80, -122" (the shelter cell itself), stood still and died.

test('soak 7 replay (A): armed at health 20, a zombie at the corner for 120 s: no wall is opened; the bot leaves by the far side', async (t) => {
    quiet(t);
    const { MORNING: RULE } = await import('./night_routine.js');
    const agent = fakeAgent({ t: NIGHT });
    const zombie = { id: 2, name: 'zombie', type: 'mob', position: new Vec3(-0.5, 64, -0.5) }; // the diagonal cell, as -45, 80, -123 by -44, 80, -122
    Object.assign(agent.bot, { health: 20, inventory: { items: () => [{ name: 'stone_axe', count: 1 }], slots: [] }, entities: { 2: zombie } });
    const o = ops();
    o.hostileNear = () => zombie;
    o.openToward = () => { throw new Error('no wall is opened toward the zombie'); };
    o.outs = [];
    o.digOut = (bot, feet, opts) => { o.digs++; o.outs.push(opts?.away ?? null); return Promise.resolve(SITE.offset(1, 0, 0)); };
    o.awayFromMobs = () => Promise.resolve();
    nightTick(agent, { now: 0, ops: o }); await settle(agent);
    agent.bot.time.timeOfDay = MORNING;
    for (let now = 10; now <= 10 + RULE.waitMs; now += RETRY_MS) { nightTick(agent, { now, ops: o }); await settle(agent); }
    assert.deepEqual(o.outs, [zombie.position], 'out by the side away from it');
    assert.ok(agent.chat.includes('[night] morning: armed, health 20, but the fight cannot be judged yet (unknown: its health, its attack interval, our weapon damage): leaving the shelter at 0, 64, 0 by the side away from a zombie at -1, 64, -1'), agent.chat.join('\n'));
    assert.equal(nightState(agent).state, 'day');
});

/** Soak 7 (C): a morning fight under way (the wall opened toward a mob), then the mob comes close. */
async function closeMorning(mob, { health = LOW, armed = true } = {}) {
    const { MORNING: RULE } = await import('./night_routine.js');
    const agent = fakeAgent({ t: NIGHT });
    Object.assign(agent.bot, { health: 20, inventory: { items: () => (armed ? [{ name: 'stone_axe', count: 1 }] : []), slots: [] }, entities: { 2: mob } });
    const o = ops();
    o.hostileNear = () => mob;
    o.morningChoice = () => ({ action: 'fight', why: 'armed, health 20, one zombie near' });
    o.openToward = (bot, feet) => Promise.resolve([feet.offset(1, 1, 0), feet.offset(1, 0, 0)]);
    o.heldCells = () => [];
    o.outs = [];
    o.digOut = (bot, feet, opts) => { o.digs++; o.outs.push({ feet, away: opts?.away ?? null }); return Promise.resolve(feet.offset(-1, 0, 0)); };
    o.awayFromMobs = () => Promise.resolve();
    o.burrows = [];
    o.burrowAway = (bot, m, opts) => { o.burrows.push(opts); return Promise.resolve({ steps: 0, site: null, stopped: 'cornered', why: 'down: a body in 0, 64, 0, which the step seals' }); };
    nightTick(agent, { now: 0, ops: o }); await settle(agent);
    agent.bot.time.timeOfDay = MORNING;
    let now = 10;
    for (; now <= 10 + RULE.waitMs; now += RETRY_MS) { nightTick(agent, { now, ops: o }); await settle(agent); }
    assert.equal(agent.bot.rotnSheltered, 'open', 'the fight began');
    agent.bot.health = health;
    const tick = async (at = null) => { now = at ?? now + 1000; const r = nightTick(agent, { now, ops: o }); await settle(agent); return r; };
    return { agent, o, tick };
}

test('soak 7 replay (C): the zombie in the bot\'s cell at health LOW (11): no leave past it; the burrow finds no step (a body in the cell); the bot hits back', async (t) => {
    quiet(t);
    const zombie = { id: 2, name: 'zombie', type: 'mob', position: new Vec3(1.5, 64, 1.5) };
    const { agent, o, tick } = await closeMorning(zombie);
    zombie.position = new Vec3(0.7, 64, 0.2); // it walked in through the opening
    assert.equal(await tick(), 'night:inside');
    assert.equal(o.digs, 0, 'no leave');
    assert.equal(o.burrows.length, 1);
    assert.equal(o.burrows[0].prefer, 'down');
    assert.equal(o.burrows[0].maxSteps, 3);
    assert.ok(Math.abs(o.burrows[0].stopAt - (Math.sqrt(1.2 ** 2 + 0.6) + 0.5)) < 1e-9, 'its reach + 0.5');
    assert.ok(agent.chat.includes(`[night] morning: a zombie in the bot's cell at 0, 64, 0: not leaving past it; health ${LOW}, and it may hit for ${ZOMBIE_HIT}: burrowing away from it (a step down first)`), agent.chat.join('\n'));
    assert.ok(agent.chat.includes('[night] morning: did not burrow (still at 0, 64, 0): down: a body in 0, 64, 0, which the step seals'), agent.chat.join('\n'));
    assert.equal(await tick(), 'night:inside');
    assert.equal(nightState(agent).handFight, true, 'cornered: modes.fightInShelter hits back at any health');
    assert.equal(agent.chat.at(-1), `[night] morning: a zombie in the bot's cell at 0, 64, 0: not leaving past it; health ${LOW}, and no burrow step (down: a body in 0, 64, 0, which the step seals): hitting back`);
    assert.deepEqual([o.digs, o.burrows.length], [0, 1], 'one burrow try per mob; still no leave');
    // It is killed (gone): the morning goes on with the usual exit.
    delete agent.bot.entities[2];
    o.hostileNear = () => null;
    await tick();
    assert.equal(nightState(agent).handFight, false);
});

test('soak 7 (C): a mob in reach through the opening, the opening itself empty: the shelter is closed again first, then the bot leaves away from it', async (t) => {
    quiet(t);
    const zombie = { id: 2, name: 'zombie', type: 'mob', position: new Vec3(1.5, 64, 1.5) }; // diagonal, 1.4 from the bot
    const { agent, o, tick } = await closeMorning(zombie);
    o.open = [SITE.offset(1, 0, 0), SITE.offset(1, 1, 0)];
    const builds = o.builds.length;
    await tick();
    assert.equal(o.builds.length, builds + 1, 'the repair');
    assert.equal(o.digs, 0);
    assert.ok(agent.chat.includes('[night] morning: a zombie 1.4 blocks away, in its reach: not leaving past it; closing the shelter again at 1, 64, 0; 1, 65, 0'), agent.chat.join('\n'));
    assert.equal(agent.bot.rotnSheltered, true, 'closed (the fake repair closes it)');
    o.open = [];
    await tick();
    assert.equal(o.digs, 1, 'closed: out by the far side');
    assert.deepEqual(o.outs[0].away, zombie.position);
});

test('soak 7 (C): armed and above what the mob in reach may hit for (a spider, 2): fight on from the shelter; no weapon: no fight, the burrow', async (t) => {
    quiet(t);
    const spider = { id: 2, name: 'spider', type: 'mob', position: new Vec3(1.5, 64, 1.5) }; // 1.4 m, its reach 2.14
    const fit = await closeMorning(spider);
    await fit.tick();
    assert.equal(fit.o.digs, 0);
    assert.equal(fit.o.burrows.length, 0);
    assert.equal(nightState(fit.agent).handFight, false);
    assert.equal(fit.agent.chat.at(-1), `[night] morning: a spider 1.4 blocks away, in its reach: not leaving past it; armed, health ${LOW} above the 2 it may hit for: fighting it from the shelter`);
    const bare = await closeMorning({ ...spider }, { armed: false });
    await bare.tick();
    assert.equal(bare.o.burrows.length, 1);
    assert.ok(bare.agent.chat.join('\n').includes(`not leaving past it; no weapon, health ${LOW}, and it may hit for 2: burrowing away from it`), bare.agent.chat.join('\n'));
});

test('soak 7 (C): a burrow step out of its reach moves the shelter; then the bot leaves from the new cell', async (t) => {
    quiet(t);
    const zombie = { id: 2, name: 'zombie', type: 'mob', position: new Vec3(1.5, 64, 0.5) }; // in the opening, 1 m away
    const { agent, o, tick } = await closeMorning(zombie);
    o.burrowAway = (bot) => { bot.entity.position = new Vec3(0.5, 62, 0.5); return Promise.resolve({ steps: 1, site: new Vec3(0, 62, 0), stopped: 'far' }); };
    await tick();
    assert.ok(nightState(agent).site.equals(new Vec3(0, 62, 0)), 'the new cell is the shelter');
    assert.ok(agent.chat.includes('[night] morning: burrowed 1 step into 0, 62, 0: out of its reach; sealed behind'), agent.chat.join('\n'));
    assert.equal(o.digs, 0);
    await tick();
    assert.equal(o.digs, 1);
    assert.ok(o.outs[0].feet.equals(new Vec3(0, 62, 0)), 'dug out from the new cell');
});

test('#514 review 1: a re-seal that fails is tried once per mob and opening; then the order goes on (the burrow, then hitting back)', async (t) => {
    quiet(t);
    const zombie = { id: 2, name: 'zombie', type: 'mob', position: new Vec3(1.5, 64, 1.5) }; // diagonal, in reach
    const { agent, o, tick } = await closeMorning(zombie);
    o.open = [SITE.offset(1, 0, 0), SITE.offset(1, 1, 0)];
    o.buildShelter = (bot, opts = {}) => { o.builds.push(opts.site ?? null); return Promise.resolve({ closed: false, placed: 0, line: 'no block left to place' }); };
    const builds = o.builds.length;
    await tick();
    assert.equal(o.builds.length, builds + 1, 'one re-seal try');
    await tick();
    assert.equal(o.burrows.length, 1, 'then the burrow');
    await tick();
    await tick();
    assert.equal(o.builds.length, builds + 1, 'no second re-seal of the same opening for the same mob');
    assert.equal(nightState(agent).handFight, true, 'no burrow step: it hits back, never held off by a repair');
    assert.equal(o.digs, 0);
});

test('#514 review 2: at MORNING.capMs with the mob still in the bot\'s cell (or in reach) there is no hand-back: it stays sheltered and hits back; once the mob is gone it leaves', async (t) => {
    quiet(t);
    const { MORNING: RULE } = await import('./night_routine.js');
    const zombie = { id: 2, name: 'zombie', type: 'mob', position: new Vec3(1.5, 64, 1.5) };
    const { agent, o, tick } = await closeMorning(zombie);
    zombie.position = new Vec3(0.7, 64, 0.2);
    await tick();
    await tick();
    assert.equal(nightState(agent).handFight, true);
    assert.equal(await tick(10 + RULE.capMs + 1), 'night:inside');
    assert.equal(nightState(agent).state, 'inside', 'no hand-back');
    assert.notEqual(agent.bot.rotnSheltered, false, 'still sheltered: threatPlan would flee past it');
    assert.equal(nightState(agent).handFight, true, 'it keeps hitting back');
    assert.equal(agent.chat.at(-1), '[night] morning: 5 min are up, but a zombie is still in the bot\'s cell at 0, 64, 0: staying sheltered until it is gone');
    await tick(10 + RULE.capMs + 30_000);
    assert.equal(nightState(agent).state, 'inside');
    assert.equal(o.digs, 0);
    // Gone (killed): after the goneMs window the usual exit, then the hand-back.
    delete agent.bot.entities[2];
    o.hostileNear = () => null;
    await tick(10 + RULE.capMs + 31_000);
    await tick(10 + RULE.capMs + 31_000 + RULE.goneMs);
    assert.equal(o.digs, 1);
    assert.equal(nightState(agent).state, 'day');
    assert.equal(nightState(agent).handFight, false);

    // The fight still under way at the cap (health 20, the zombie in the cell): no hand-back either.
    const fight = await closeMorning({ ...zombie, position: new Vec3(0.7, 64, 0.2) }, { health: 20 });
    assert.equal(await fight.tick(10 + RULE.capMs + 1), 'night:inside');
    assert.equal(nightState(fight.agent).state, 'inside');
    assert.match(fight.agent.chat.at(-1), /5 min are up, but a zombie is still in the bot's cell at 0, 64, 0: staying sheltered until it is gone$/);
});

test('#514 re-review: past the cap, a mob in reach (not in the cell) that has not hurt the bot for 30 s lets the far-side leave go ahead; one that hurt it within 30 s, or one in the cell, still holds it', async (t) => {
    quiet(t);
    const { MORNING: RULE } = await import('./night_routine.js');
    assert.equal(RULE.capQuietMs, 30_000);
    const zombie = { id: 2, name: 'zombie', type: 'mob', position: new Vec3(1.5, 64, 1.5) }; // diagonal, 1.4 m: in reach, not in the cell
    const { agent, o, tick } = await closeMorning(zombie);
    Object.assign(agent.bot, { lastDamageTime: Date.now(), lastDamageTaken: 3, food: 20 }); // it hit the bot just now
    await tick();
    await tick();
    assert.equal(nightState(agent).handFight, true, 'held: no burrow step, hitting back');
    assert.equal(await tick(10 + RULE.capMs + 1), 'night:inside');
    assert.equal(o.digs, 0, 'hurt within 30 s: held past the cap');
    assert.equal(agent.chat.at(-1), '[night] morning: 5 min are up, but a zombie is still in reach and hurt the bot within 30 s at 0, 64, 0: staying sheltered until it is gone');
    agent.bot.lastDamageTime = Date.now() - RULE.capQuietMs - 1000; // quiet for 31 s
    await tick(10 + RULE.capMs + 31_000);
    assert.equal(o.digs, 1, 'the far-side leave');
    assert.deepEqual(o.outs[0].away, zombie.position, 'away from it');
    assert.ok(agent.chat.includes('[night] morning: 5 min are up and a zombie 1.4 blocks away has not hurt the bot for 30 s: leaving by the side away from it'), agent.chat.join('\n'));
    assert.equal(nightState(agent).handFight, false);
    assert.equal(nightState(agent).state, 'day', 'left, then handed back');

    // In the bot's cell and quiet for 31 s: never past it.
    const cell = await closeMorning({ ...zombie, position: new Vec3(0.7, 64, 0.2) });
    cell.agent.bot.lastDamageTime = Date.now() - RULE.capQuietMs - 1000;
    await cell.tick();
    assert.equal(await cell.tick(10 + RULE.capMs + 1), 'night:inside');
    await cell.tick(10 + RULE.capMs + 31_000);
    assert.equal(cell.o.digs, 0);
    assert.ok(cell.agent.chat.includes('[night] morning: 5 min are up, but a zombie is still in the bot\'s cell at 0, 64, 0: staying sheltered until it is gone'), cell.agent.chat.join('\n'));
    assert.equal(cell.o.digs, 0, 'still no leave');
});

test('#514 re-review: the fight still under way at the cap with a quiet mob in reach (not in the cell): the far-side leave instead of the hand-back', async (t) => {
    quiet(t);
    const { MORNING: RULE } = await import('./night_routine.js');
    const zombie = { id: 2, name: 'zombie', type: 'mob', position: new Vec3(1.5, 64, 1.5) };
    const { agent, o, tick } = await closeMorning(zombie, { health: 20 });
    await tick();
    assert.equal(nightState(agent).morningAct, 'fight');
    await tick(10 + RULE.capMs + 1);
    assert.equal(nightState(agent).morningAct, 'leave');
    await tick(10 + RULE.capMs + 2);
    assert.equal(o.digs, 1);
    assert.ok(agent.chat.includes('[night] morning: 5 min are up: leaving the shelter at 0, 64, 0 by the side away from a zombie at 1, 64, 1'), agent.chat.join('\n'));
    assert.equal(nightState(agent).state, 'day');
});

test('#517 review: before the past-cap leave, the opening toward the quiet mob is re-sealed once (no body in it); a failed re-seal is said and the bot leaves with it open', async (t) => {
    quiet(t);
    const { MORNING: RULE } = await import('./night_routine.js');
    const zombie = { id: 2, name: 'zombie', type: 'mob', position: new Vec3(1.5, 64, 1.5) }; // diagonal, in reach, quiet
    const run = async (closes) => {
        const m = await closeMorning({ ...zombie });
        m.o.open = [SITE.offset(1, 0, 0), SITE.offset(1, 1, 0)];
        // The morning order (C) already tried its one re-seal; here it failed and the bot hit back.
        m.o.buildShelter = (bot, opts = {}) => { m.o.builds.push(opts.site ?? null); return Promise.resolve({ closed: false, placed: 0, line: 'no block left to place' }); };
        await m.tick();
        await m.tick();
        await m.tick();
        const before = m.o.builds.length;
        m.o.buildShelter = (bot, opts = {}) => {
            m.o.builds.push(opts.site ?? null);
            if (closes) m.o.open = [];
            return Promise.resolve(closes ? { closed: true } : { closed: false, placed: 0, line: 'no block left to place' });
        };
        await m.tick(10 + RULE.capMs + 1);
        assert.equal(m.o.builds.length, before + 1, 'one more re-seal');
        assert.equal(m.o.digs, 0, 'not yet');
        assert.ok(m.agent.chat.includes('[night] morning: closing the opening at 1, 64, 0; 1, 65, 0 before leaving'), m.agent.chat.join('\n'));
        await m.tick(10 + RULE.capMs + 2);
        await m.tick(10 + RULE.capMs + 3);
        assert.equal(m.o.builds.length, before + 1, 'only once');
        return m;
    };
    const closed = await run(true);
    assert.equal(closed.o.digs, 1, 'then the far-side leave');
    assert.equal(closed.agent.bot.rotnSheltered, false, 'handed back');
    const open = await run(false);
    assert.equal(open.o.digs, 1, 'the leave goes ahead with it open');
    assert.ok(open.agent.chat.includes('[night] morning: the opening at 1, 64, 0; 1, 65, 0 did not close (no block left to place); leaving with it open'), open.agent.chat.join('\n'));
    // A body in the opening: no re-seal; said, and the leave goes ahead.
    const held = await closeMorning({ ...zombie });
    held.o.open = [SITE.offset(1, 0, 0), SITE.offset(1, 1, 0)];
    held.o.heldCells = () => [{ cell: SITE.offset(1, 0, 0), mob: { name: 'zombie' } }];
    await held.tick();
    await held.tick();
    const b = held.o.builds.length;
    await held.tick(10 + RULE.capMs + 1);
    assert.equal(held.o.builds.length, b);
    assert.ok(held.agent.chat.includes('[night] morning: the opening at 1, 64, 0; 1, 65, 0 stays open (a zombie holds it); leaving anyway'), held.agent.chat.join('\n'));
    assert.equal(held.o.digs, 1);
});
