// #463 review 1 (soak 3, rotn-v0.1.5): a night death's re-plan prompt is held while the night
// routine runs and goes once at full day; the routine's own jobs must not drop it. Real routine jobs
// through a real ActionManager, offline (fake world operations). Own file: modes.js keeps the last
// re-plan prompt time per process (MIN_GAP_MS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { __setRegistryForTest } from '../utils/mcdata.js';
import { requestReplan, hasReplan, QUIET_MS } from './replan.js';
import { initModes } from './modes.js';
import { nightTick, nightState } from './night_routine.js';
import { ActionManager } from './action_manager.js';
import { PIT } from './library/pit.js';

__setRegistryForTest(minecraftData('1.12.2'));
const quiet = { log: () => {} };

// #463 review 1: the routine's own jobs (action:...) used to drop the held request (clearReplan:
// "a new action started"), so the death was never prompted. Real jobs through a real ActionManager.
test('#463 review 1: a night death\'s re-plan survives the routine\'s jobs (leaveDeathSpot, buildShelter, digPit with its roof, leaveShelter) and goes once at full day, with no agenda or task', async (t) => {
    const lines = [];
    t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    t.mock.method(console, 'warn', () => {});
    const NIGHT = 15000, MORNING = 1000;
    const SITE = new Vec3(0, 64, 0);
    const calls = { handleMessage: [] };
    const agent = {
        name: 'FRCFLD', calls, task: null, chat: [],
        prompter: { getInitModes: () => ({}) },
        openChat(l) { agent.chat.push(l); },
        bot: { time: { timeOfDay: NIGHT }, entity: { position: new Vec3(0.5, 64, 0.5) }, output: '', interrupt_code: false, emit() {} },
        self_prompter: { isActive: () => false, stop() {}, stopLoop() {}, isPaused: () => false },
        handleMessage: (...args) => { calls.handleMessage.push(args); return Promise.resolve(true); },
        clearBotLogs() { agent.bot.output = ''; agent.bot.interrupt_code = false; },
        requestInterrupt() {}, cleanKill() {}, history: { add() {} },
        control: { blocking: () => null },
        isIdle: () => !agent.actions.executing,
    };
    agent.actions = new ActionManager(agent);
    initModes(agent);
    for (const name of ['self_preservation', 'unstuck', 'cowardice', 'self_defense', 'hunting', 'item_collecting', 'torch_placing', 'elbow_room', 'idle_staring']) {
        agent.bot.modes.setOn(name, false);
    }
    const labels = [];
    const run = agent.actions.runAction.bind(agent.actions);
    agent.actions.runAction = (label, fn, opts) => { labels.push(label); return run(label, fn, opts); };
    const o = { calls: [] };
    o.nightRelocation = () => ({ mode: 'short', target: { x: 30, z: 0 }, places: [], away: 24, line: '[night] I died near here recently: moving away before sheltering' });
    o.walkAwayAtNight = () => { o.calls.push('away'); return Promise.resolve({ arrived: true, nearest: 30, stopped: null }); };
    o.buildShelter = (bot, opts = {}) => {
        o.calls.push(opts.site ? 'roof' : 'build');
        return Promise.resolve(opts.site ? { closed: true, feet: opts.site, line: 'Shelter closed' }
            : { closed: false, feet: null, line: 'Not building a shelter at 0, 64, 0: you have 0 dirt and 0 dirt piles' });
    };
    o.digPit = () => { o.calls.push('pit'); return Promise.resolve(SITE.offset(0, -3, 0)); };
    o.pitOut = () => { o.calls.push('pitOut'); return Promise.resolve(SITE.offset(3, 0, 0)); };
    o.digOut = () => Promise.resolve(SITE.offset(1, 0, 0));
    o.siteNeeds = () => ({ todo: [] });

    // Died a minute ago, 9 blocks off; the death asks for a prompt (due).
    agent._death = { last: { at: Date.now() - 60_000, pos: { x: -8.5, y: 64, z: 0.5 }, dimension: null } };
    requestReplan(agent, 'death', 'action:repairShelter', { now: Date.now() - QUIET_MS - 1, due: true, note: 'You died at -60, 60, -66 and respawned.', ...quiet });
    // Real wall-clock times: replanHold reads the routine's clock at Date.now() (a clock fed at
    // made-up times 1, 2, 3 would look stuck for decades and fall back to the wall clock).
    let now = Date.now();
    const tick = async () => {
        nightTick(agent, { now: ++now, ops: o });
        while (nightState(agent).job) await nightState(agent).job;
        await new Promise(r => setTimeout(r, 25)); // real ActionManager: no fast-loop alarm
        await agent.bot.modes.update();
    };
    await tick(); await tick(); await tick();
    assert.deepEqual(o.calls, ['away', 'build', 'pit', 'roof']);
    assert.equal(nightState(agent).state, 'inside');
    assert.equal(calls.handleMessage.length, 0, 'held all night');
    assert.equal(hasReplan(agent), true, 'the jobs kept the request');
    agent.bot.time.timeOfDay = MORNING;
    await tick();
    assert.equal(o.calls.at(-1), 'pitOut');
    assert.equal(nightState(agent).state, 'day');
    for (let i = 0; i < 3; i++) await agent.bot.modes.update();
    assert.deepEqual(labels, ['action:leaveDeathSpot', 'action:buildShelter', 'action:digPit', 'action:leaveShelter'], 'the roof is part of the hole job');
    assert.equal(calls.handleMessage.length, 1, 'one prompt at full day');
    assert.match(calls.handleMessage[0][1], /^\(AUTO MESSAGE\) Reflexes \(death\) interrupted 'action:repairShelter'\. You died at -60, 60, -66 and respawned\./);
    assert.equal(hasReplan(agent), false, 'delivered, so never again');
    assert.ok(!lines.some(l => l.startsWith('[reflex] re-plan request dropped')), 'never dropped by a routine job');
    assert.equal(lines.filter(l => l.startsWith('[reflex] re-plan prompt held: the night routine is running; it goes once at full day')).length, 1);
    assert.equal(PIT.awayFrom, 28);
});
