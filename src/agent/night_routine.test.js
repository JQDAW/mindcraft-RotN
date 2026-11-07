// skills-rotn D2b-2: the night routine, offline. A fake agent (self-prompter, actions, chat) with
// the world operations replaced (build, dig out, the shelter check), plus digOut and the quiet
// modes against a small fake world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../utils/mcdata.js';
import { nightTick, nightState, resetNight, isFullDay, digOut, CHECK_MS, RETRY_MS, BUILD_ATTEMPTS, DUSK_WAIT_MS } from './night_routine.js';
import settings from './settings.js';
import { autonomyTick } from './priority.js';
import { shelterQuiet, SHELTER_QUIET_MODES } from './modes.js';
import { NIGHT_START, TICKS_PER_MIN } from './library/night.js';

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
