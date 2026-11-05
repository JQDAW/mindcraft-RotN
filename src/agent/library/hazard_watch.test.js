// skills-rotn D1b: re-plan after a teleport (AggroTP) or a horde warning, offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { JumpWatch, hordeWarning, JUMP_BLOCKS, HORDE_START_KEY } from './hazard_watch.js';
import { Agent } from '../agent.js';

test('D1b: JumpWatch judges only forced moves, against the last physics tick', () => {
    const w = new JumpWatch();
    assert.equal(w.forced(new Vec3(0, 64, 0)), null, 'no sample yet: the login position packet');
    w.sample(new Vec3(0, 64, 0));
    w.sample(new Vec3(1.5, 64, 0.5));
    w.sample(new Vec3(1.5, 40, 0.5));
    assert.equal(w.forced(new Vec3(3, 40, 0.5)), null, 'a 1.5-block correction is no teleport');
    const jump = w.forced(new Vec3(10, 40, 0.5));
    assert.ok(jump && jump.blocks >= JUMP_BLOCKS, 'a 7-block forced move is a teleport');
    assert.equal(Math.round(jump.blocks), 7);
    assert.deepEqual(jump.from, { x: 3, y: 40, z: 0.5 });
    assert.equal(w.forced(new Vec3(10, 90, 0.5)), null, 'vertical only: not counted');
    assert.equal(w.forced(new Vec3(40, 90, 0.5), { riding: true }), null, 'riding: not counted');
    w.reset();
    assert.equal(w.forced(new Vec3(500, 70, 500)), null, 'after a reset (death, respawn): a fresh start');
});

test('D1b: the horde warning is message.hordes.EventStart only, as a key or inside a component', () => {
    assert.deepEqual(hordeWarning(HORDE_START_KEY), { key: HORDE_START_KEY });
    assert.deepEqual(hordeWarning('{"translate":"message.hordes.EventStart"}'), { key: HORDE_START_KEY });
    assert.deepEqual(hordeWarning({ translate: 'chat.type.announcement', with: ['Server', { translate: HORDE_START_KEY }] }), { key: HORDE_START_KEY });
    for (const t of ['message.hordes.EventEnd', 'message.hordes.TrySleep', '{"translate":"message.hordes.EventEnd"}',
        '{"translate":"message.hordes.TrySleep"}', '{"text":"You hear the howls of a nearby horde"}', '{"text":"Day 3"}',
        '{"translate":"advancements.story.root.title"}', 'Hordeland map', 'not json at all', null, undefined])
        assert.equal(hordeWarning(t), null, String(t));
});

function fakeAgent() {
    const calls = { stops: 0, pathStops: 0 };
    const agent = Object.create(Agent.prototype);
    agent.bot = new EventEmitter();
    agent.bot._client = new EventEmitter();
    agent.bot.entity = { position: new Vec3(0.5, 64, 0.5) };
    agent.bot.health = 20;
    agent.bot.isAlive = true;
    agent.bot.pathfinder = { stop: () => { calls.pathStops++; } };
    agent.actions = { currentActionLabel: 'action:collectBlocks', stop: () => { calls.stops++; return Promise.resolve(); } };
    return { agent, calls };
}

test('D1b: the agent re-plans on a forced move of 5+ blocks, never on its own walking; death resets', (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    t.mock.method(console, 'warn', () => {});
    const { agent, calls } = fakeAgent();
    agent.bindNightReset();
    agent.bindTeleportWatch();
    agent.bot.emit('physicsTick');

    // self_preservation's moveAway: 8 blocks of walking, tick by tick, no forcedMove.
    for (let x = 1; x <= 8.5; x += 0.5) { agent.bot.entity.position = new Vec3(x, 64, 0.5); agent.bot.emit('physicsTick'); }
    assert.equal(agent.replan, undefined, 'walking is no teleport');
    assert.equal(calls.stops, 0);

    // A server correction of 1 block: no teleport.
    agent.bot.entity.position = new Vec3(9.5, 64, 0.5);
    agent.bot.emit('forcedMove');
    assert.equal(agent.replan, undefined);

    // AggroTP: 7 blocks.
    agent.bot.entity.position = new Vec3(16.5, 64, 0.5);
    agent.bot.emit('forcedMove');
    assert.equal(agent.replan?.modes?.teleport, 1, 're-plan requested');
    assert.equal(agent.replan.interrupted, 'action:collectBlocks');
    assert.equal(calls.stops, 1, 'the action stopped');
    assert.equal(calls.pathStops, 1, 'the pathfinder stopped');
    assert.ok(logs.includes('[reflex] teleported 7.0 blocks (9, 64, 0 -> 16, 64, 0); re-planning'), logs.join('\n'));

    // Death (#212 re-review 1): physics keeps ticking while dead; then the respawn packet, then
    // the far position packet (forcedMove) before update_health sends 'spawn'. No teleport.
    agent.bot.health = 0; agent.bot.isAlive = false;
    agent.bot.emit('death');
    agent.bot.emit('physicsTick');
    agent.bot.emit('respawn');
    agent.bot.entity.position = new Vec3(300, 70, 300);
    agent.bot.emit('forcedMove');
    agent.bot.health = 20; agent.bot.isAlive = true;
    agent.bot.emit('spawn');
    agent.bot.emit('physicsTick');
    agent.bot.entity.position = new Vec3(300, 70, 302);
    agent.bot.emit('forcedMove');
    assert.equal(agent.replan.modes.teleport, 1, 'the respawn is no teleport');

    // A dimension change: 'respawn' with no death; the position packet comes while isAlive is false.
    agent.bot.isAlive = false;
    agent.bot.emit('respawn');
    agent.bot.entity.position = new Vec3(37, 40, 37);
    agent.bot.emit('forcedMove');
    agent.bot.isAlive = true;
    agent.bot.emit('physicsTick');
    assert.equal(agent.replan.modes.teleport, 1, 'a dimension change is no teleport');

    // A ride (re-review 3): physics stops on mount; the dismount packet comes after bot.vehicle clears.
    agent.bot.emit('physicsTick');
    agent.bot.vehicle = { id: 7 };
    agent.bot.emit('mount');
    agent.bot.vehicle = null;
    agent.bot.emit('dismount');
    agent.bot.entity.position = new Vec3(90, 40, 37);
    agent.bot.emit('forcedMove');
    assert.equal(agent.replan.modes.teleport, 1, 'a ride is no teleport');

    // After all that, a real teleport still counts.
    agent.bot.emit('physicsTick');
    agent.bot.entity.position = new Vec3(98, 40, 37);
    agent.bot.emit('forcedMove');
    assert.equal(agent.replan.modes.teleport, 2);
    assert.equal(calls.stops, 2);
});

test('D1b: horde warnings by forge-bridge or the title fallback, at most once a minute', (t) => {
    const logs = [];
    t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
    const { agent } = fakeAgent();
    let now = 0;
    agent.bindHordeWatch({ now: () => now });
    agent.bot._client.emit('title', { action: 0, text: '{"text":"Day 3"}' });
    agent.bot._client.emit('title', { action: 0, text: '{"translate":"message.hordes.EventEnd"}' });
    assert.equal(agent.replan, undefined, 'any other title: nothing');

    // forge-bridge's decoded event (#214): end, wave and other messages do nothing; start does.
    agent.bot.emit('rotn:horde', { kind: 'end', key: 'message.hordes.EventEnd' });
    agent.bot.emit('rotn:horde', { kind: 'wave', sound: 'hordes:horde', direction: { x: 1, z: 0 } });
    agent.bot.emit('rotn:horde', { kind: 'message', key: 'some.other.text' });
    agent.bot.emit('rotn:horde', null);
    assert.equal(agent.replan, undefined, 'only the start counts');
    agent.bot.emit('rotn:horde', { kind: 'start', key: HORDE_START_KEY });
    assert.equal(agent.replan.modes.horde_warning, 1);
    assert.equal(agent.onHordeMessage(HORDE_START_KEY, { now, via: 'forge' }), false, 'once a minute');
    assert.ok(logs.includes('[reflex] horde warning (message.hordes.EventStart, by forge): re-planning'), logs.join('\n'));

    now = 30_000;
    agent.bot._client.emit('title', { action: 1, text: '{"translate":"message.hordes.EventStart"}' });
    assert.equal(agent.replan.modes.horde_warning, 1, 'not again within a minute');

    now = 61_000;
    agent.bot._client.emit('title', { action: 2, text: '{"translate":"message.hordes.EventStart"}' });
    assert.equal(agent.replan.modes.horde_warning, 1, 'title action 2 (times) is ignored');
    agent.bot._client.emit('title', { action: 1, text: '{"translate":"message.hordes.EventStart"}' });
    assert.equal(agent.replan.modes.horde_warning, 2);
    assert.ok(logs.includes('[reflex] horde warning (message.hordes.EventStart, by title): re-planning'), logs.join('\n'));
});
