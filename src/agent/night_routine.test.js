// skills-rotn D2b-2: the night routine, offline. A fake agent (self-prompter, actions, chat) with
// the world operations replaced (build, dig out, the shelter check), plus digOut and the quiet
// modes against a small fake world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../utils/mcdata.js';
import { nightTick, nightState, isFullDay, digOut, CHECK_MS, RETRY_MS, BUILD_ATTEMPTS } from './night_routine.js';
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
        bot: { time: { timeOfDay: t }, entity: { position: new Vec3(0.5, 64, 0.5) }, output: '' },
        self_prompter: { active: true, loop_active: false, isActive() { return this.active; }, stop() { this.active = false; calls.stop++; }, isPaused: () => false },
        actions: { runAction: async (label, fn) => { await fn(); return { message: '', interrupted: false }; } },
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
