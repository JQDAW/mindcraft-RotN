// skills-rotn D1b: re-plan after a teleport (AggroTP) or a horde warning, offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { JumpWatch, hordeWarning, JUMP_BLOCKS, MAX_SAMPLE_GAP_MS } from './hazard_watch.js';
import { __modeForTest, resetJumpWatch } from '../modes.js';
import { Agent } from '../agent.js';

test('D1b: walking and falling are no teleport; a horizontal jump of 5 or more blocks is', () => {
    const w = new JumpWatch();
    assert.equal(w.observe(new Vec3(0, 64, 0), 0), null, 'the first sample');
    assert.equal(w.observe(new Vec3(1.5, 64, 0.5), 300), null, 'sprinting');
    assert.equal(w.observe(new Vec3(1.5, 40, 0.5), 600), null, 'a fall of 24 blocks');
    const jump = w.observe(new Vec3(8.5, 40, 0.5), 900);
    assert.ok(jump && jump.blocks >= JUMP_BLOCKS, 'a 7-block teleport');
    assert.equal(Math.round(jump.blocks), 7);
    assert.equal(w.observe(new Vec3(30, 40, 0), 1200, { riding: true }), null, 'riding: not compared');
    assert.equal(w.observe(new Vec3(60, 40, 0), 1200 + MAX_SAMPLE_GAP_MS + 1), null, 'after a stall: not compared');
    w.reset();
    assert.equal(w.observe(new Vec3(500, 70, 500), 5000), null, 'after a reset (death, respawn): a fresh start');
});

test('D1b: only a title naming a horde is a horde warning, by translation key or text', () => {
    assert.deepEqual(hordeWarning('{"translate":"message.hordes.HordeStart"}'), { key: 'message.hordes.HordeStart', text: '' });
    assert.equal(hordeWarning('{"text":"","extra":[{"text":"The "},{"text":"Horde","color":"red"},{"text":" approaches"}]}').text, 'The Horde approaches');
    assert.equal(hordeWarning({ translate: 'chat.type.announcement', with: ['Server', { translate: 'hordes.wave.start' }] }).key, 'hordes.wave.start');
    for (const t of ['{"text":"Welcome to Rebirth of the Night"}', '{"text":"Day 3"}', '{"translate":"advancements.story.root.title"}', 'Hordeland map', 'not json at all'])
        assert.equal(hordeWarning(t), null, t);
});

function modeAgent(label = 'action:collectBlocks') {
    const calls = { stops: 0, pathStops: 0 };
    const agent = {
        bot: { entity: { position: new Vec3(0.5, 64, 0.5) }, pathfinder: { stop: () => { calls.pathStops++; } } },
        actions: { currentActionLabel: label, stop: () => { calls.stops++; return Promise.resolve(); } },
    };
    return { agent, calls };
}

test('D1b: teleport_watch stops the running action and asks for a re-plan; it never blocks the other modes', (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const mode = __modeForTest('teleport_watch');
    assert.ok(mode, 'registered');
    assert.deepEqual(mode.interrupts, ['all']);
    resetJumpWatch();
    const { agent, calls } = modeAgent();
    mode.update(agent);
    agent.bot.entity.position = new Vec3(1, 64, 0.5);
    mode.update(agent);
    assert.equal(calls.stops, 0, 'no jump yet');
    agent.bot.entity.position = new Vec3(8.5, 64, 0.5);
    mode.update(agent);
    assert.equal(calls.stops, 1);
    assert.equal(calls.pathStops, 1);
    assert.equal(mode.active, false, 'it never becomes active');
    assert.ok(agent.replan?.modes?.teleport_watch === 1, 're-plan requested');
    assert.equal(agent.replan.interrupted, 'action:collectBlocks');
    assert.ok(logs.some(l => /^\[reflex\] position jumped 7\.5 blocks \(1, 64, 0 -> 8, 64, 0\): a teleport; re-planning$/.test(l)), logs.join('\n'));
    resetJumpWatch();
});

test('D1b: the agent reads horde warnings from the raw title packet, at most once a minute; death and spawn reset the jump watch', (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const agent = Object.create(Agent.prototype);
    agent.bot = new EventEmitter();
    agent.bot._client = new EventEmitter();
    agent.actions = { currentActionLabel: '' };
    let now = 0;
    agent.bindHordeWatch({ now: () => now });
    agent.bot._client.emit('title', { action: 0, text: '{"text":"Day 3"}' });
    assert.equal(agent.replan, undefined, 'any other title: nothing');
    agent.bot._client.emit('title', { action: 0, text: '{"translate":"message.hordes.HordeStart"}' });
    assert.equal(agent.replan.modes.horde_warning, 1);
    assert.ok(logs.includes('[reflex] horde warning: "" (message.hordes.HordeStart); re-planning'), logs.join('\n'));
    now = 30_000;
    agent.bot._client.emit('title', { action: 1, text: '{"text":"A horde is coming"}' });
    assert.equal(agent.replan.modes.horde_warning, 1, 'not again within a minute');
    now = 61_000;
    agent.bot._client.emit('title', { action: 1, text: '{"text":"A horde is coming"}' });
    assert.equal(agent.replan.modes.horde_warning, 2);

    // Death and spawn: the bot is elsewhere, which is no teleport.
    const mode = __modeForTest('teleport_watch');
    resetJumpWatch();
    agent.bindNightReset();
    const { agent: a2, calls } = modeAgent('');
    mode.update(a2);
    agent.bot.emit('death');
    a2.bot.entity.position = new Vec3(300, 70, 300);
    mode.update(a2);
    assert.equal(calls.pathStops, 0, 'the respawn jump is not a teleport');
    resetJumpWatch();
});
