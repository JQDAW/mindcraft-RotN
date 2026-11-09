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
import { nightTick, nightState, resetNight, isFullDay, digOut, CHECK_MS, RETRY_MS, BUILD_ATTEMPTS, DUSK_WAIT_MS, FREE_INTERRUPTS, THREAT_INTERRUPTS, EXPOSED_RETRY_MS, EXPOSED_RETRIES } from './night_routine.js';
import settings from './settings.js';
import { autonomyTick } from './priority.js';
import { shelterQuiet, SHELTER_QUIET_MODES } from './modes.js';
import { NIGHT_START, TICKS_PER_MIN } from './library/night.js';
import { PIT } from './library/pit.js';

const reg = minecraftData('1.12.2');
__setRegistryForTest(reg);

const DUSK = NIGHT_START - 3 * TICKS_PER_MIN; // 3 min before sunset
const NIGHT = 15000, SUNRISE = 23600, MORNING = 1000;
const SITE = new Vec3(0, 64, 0);

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

function deathOps() {
    const o = { calls: [], away: null };
    o.moveAwayFrom = (bot, pos, dist) => { o.calls.push('away'); o.away = { pos, dist }; return Promise.resolve(true); };
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
    agent._death = { last: { at: -60_000, pos: { x: -8.5, y: 64, z: 0.5 }, dimension: null } }; // a minute ago, 9 blocks off
    const o = deathOps();
    let now = 0;
    const run = async () => { nightTick(agent, { now: ++now, ops: o }); await settle(agent); };
    await run();
    assert.deepEqual(o.calls, ['away'], 'first away from the spot');
    assert.equal(o.away.dist, 28);
    assert.match(agent.chat.at(-1), /\[night\] I died 9 blocks from here; moving at least 28 away before sheltering/);
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
    old._death = { last: { at: -30 * 60_000, pos: { x: -8.5, y: 64, z: 0.5 }, dimension: null } };
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
function exitWorld(extra = {}, { canHarvest = (name) => name !== 'bedrock' } = {}) {
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
test('#435 review 1: with no tool for the rock, no plan is begun: a dirt roof over stone stays on', async (t) => {
    const logs = [];
    t.mock.method(console, 'log', (l) => logs.push(String(l)));
    const PICK = 274;
    const canHarvest = (name, tool) => !/stone/.test(name) || tool === PICK;
    const pit = { ...quarry(), '0,66,0': 'dirt' };
    const { bot, world, dug } = exitWorld(pit, { canHarvest });
    assert.equal(await digOut(bot, SITE), null, 'no way out it can dig');
    assert.deepEqual(dug, [], 'nothing was dug');
    assert.equal(world.get('0,66,0'), 'dirt', 'the roof stays on');
    assert.ok(logs.some(l => /no stairs up on the east side \(no tool to break (cobble)?stone at /.test(l)), logs.join('\n'));
    // With a pickaxe in the inventory the same stairs are dug, and the roof goes first.
    const armed = exitWorld(pit, { canHarvest });
    armed.bot.inventory.items = () => [{ name: 'stone_pickaxe', type: PICK }];
    armed.bot.tool.equipForBlock = () => { armed.bot.heldItem = { name: 'stone_pickaxe', type: PICK }; return Promise.resolve(); };
    assert.ok((await digOut(armed.bot, SITE))?.equals(new Vec3(3, 66, 0)));
    assert.equal(armed.dug[0], '0,66,0');
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
    assert.match(agent.chat.at(-1), /\[night\] morning: a hostile mob is within 8 blocks of the shelter at 0, 64, 0; staying in until it leaves \(checking every 30 s\)/);
    mob = false;
    nightTick(agent, { now: 10 + RETRY_MS, ops: o });
    await settle(agent);
    assert.equal(o.digs, 1);
    assert.equal(nightState(agent).state, 'day');
    assert.match(agent.chat.at(-1), /dug out of the shelter at 1, 64, 0; back to work/);
});

test('#364 follow-up (b), #372 review: a mob that stays near keeps the bot shut in and held past EXIT_TRIES and past the old 3 min, for the full day; at its end a warning naming the mob, and the bot stays in for the night', async (t) => {
    quiet(t);
    const warns = [];
    t.mock.method(console, 'warn', (l) => warns.push(String(l)));
    const { EXIT_TRIES, hostileNear, isFullDay } = await import('./night_routine.js');
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
    // The morning: the time stands at the freeze (3001) for 10 min; 9 checks are 4 min, past
    // EXIT_TRIES and past the old 3-min mark.
    agent.bot.time.timeOfDay = MORNING_FREEZE;
    for (let i = 0; i < 9; i++) {
        // A night:... result holds the agenda and tasks in the priority stack: nothing else runs (and digs out).
        assert.equal(nightTick(agent, { now: 10 + i * RETRY_MS, ops: o }), 'night:inside');
        await settle(agent);
        assert.equal(nightState(agent).state, 'inside', `still in at check ${i + 1}`);
        assert.equal(agent.bot.rotnSheltered, true);
        assert.equal(nightTick(agent, { now: 11 + i * RETRY_MS, ops: o }), 'night:inside', 'held between checks');
    }
    assert.ok(9 > EXIT_TRIES && 8 * RETRY_MS > 3 * 60_000);
    assert.equal(o.digs, 0, 'never opened');
    assert.equal(agent.chat.length - chats, 1, `the wait is said once: ${agent.chat.slice(chats).join(' | ')}`);
    assert.match(agent.chat.at(-1), /a zombie at 3, 64, -3 is within 8 blocks of the shelter at 0, 64, 0; staying in until it leaves \(checking every 30 s\)/);
    // The end of the full day with the zombie still there: a warning naming it; no hand-back, the
    // bot stays in this shelter for the night (never handed back with the mob near).
    agent.bot.time.timeOfDay = 5400;
    assert.equal(nightTick(agent, { now: 10 + 9 * RETRY_MS, ops: o }), 'night:inside');
    await settle(agent);
    const warning = /\[night\] warning: a zombie at 3, 64, -3 is still within 8 blocks of the shelter at 0, 64, 0 at the end of the day \(waited 5 min\); staying in it for the night/;
    assert.match(agent.chat.at(-1), warning);
    assert.ok(warns.some(l => warning.test(l)), warns.join('\n'));
    assert.equal(nightState(agent).state, 'inside');
    assert.equal(agent.bot.rotnSheltered, true);
    assert.equal(o.digs, 0);
    assert.equal(nightState(agent).mobSince, null);
    nightTick(agent, { now: 11 + 10 * RETRY_MS, ops: o });
    assert.equal(warns.filter(l => warning.test(l)).length, 1, 'said once');
    // The next morning with the zombie gone: the usual exit.
    mob = null;
    agent.bot.time.timeOfDay = MORNING;
    nightTick(agent, { now: 20 * 60_000, ops: o });
    await settle(agent);
    assert.equal(o.digs, 1);
    assert.equal(nightState(agent).state, 'day');

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
    for (let i = 4; i < 4 + EXIT_TRIES; i++) { nightTick(later, { now: 10 + i * RETRY_MS, ops: o2 }); await settle(later); }
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
    mob = null; // it leaves: the next check is a try (no side opens here), and the wait is over
    nightTick(agent, { now: 10 + RETRY_MS, ops: o });
    await settle(agent);
    assert.equal(o.digs, 1);
    assert.equal(nightState(agent).mobSince, null);
    assert.match(agent.chat.at(-1), /try 1 of 3/);
    mob = zombie; // a later mob: its own wait, said in chat again
    nightTick(agent, { now: 10 + 2 * RETRY_MS, ops: o });
    await settle(agent);
    assert.equal(nightState(agent).mobSince, 10 + 2 * RETRY_MS);
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
    o2.descend = () => { calls2.push('descend'); return Promise.resolve(false); };
    const build2 = o2.buildShelter;
    o2.buildShelter = (bot, opts) => { calls2.push('build'); return build2(bot, opts); };
    t.mock.method(console, 'warn', () => {});
    for (let i = 0; i < 4; i++) { nightTick(stuck, { now: i * RETRY_MS * 2, ops: o2 }); await settle(stuck); }
    assert.equal(calls2.filter(c => c === 'descend').length, 1, 'once per build phase');
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

