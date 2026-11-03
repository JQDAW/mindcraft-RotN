// Offline tests for skills-rotn D2c: the modes react to mobs by rotn-data's threat
// table (threatOf), not by type 'mob'. Real rotn-data entries, a fake bot with
// entities at fixed distances; no server, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { threatFor, threatPlan, doNotLook, nightThreatNote, RANGES } from './threats.js';
import { __modeForTest } from '../modes.js';

let nextId = 1;
const mob = (name, x, type = 'mob') => ({ id: nextId++, name, type, position: new Vec3(x, 64, 0), height: 1.8 });
function fakeBot(entities, extra = {}) {
    const self = { id: 0, name: 'player', type: 'player', position: new Vec3(0, 64, 0) };
    const all = { 0: self };
    for (const e of entities) all[e.id] = e;
    return { entity: self, entities: all, lastDamageTime: 0, ...extra };
}

test('threatFor reads rotn-data: zombie fight, creeper keep-distance, skeleton take-cover, dragon avoid, enderman do-not-look', () => {
    const r = (name, type) => threatFor(mob(name, 1, type));
    assert.deepEqual([r('zombie').reaction, r('zombie').doNotLook], ['fight', false]);
    assert.deepEqual([r('creeper').reaction, r('creeper').explodes], ['keep-distance', true]);
    assert.deepEqual([r('skeleton').reaction, r('skeleton').ranged], ['take-cover', true]);
    assert.equal(r('iceandfire:firedragon').reaction, 'avoid');
    assert.deepEqual([r('enderman').reaction, r('enderman').doNotLook], ['ignore-unless-provoked', true]);
    assert.equal(r('ancientbeasts:rifted_enderman').doNotLook, true);
    assert.equal(r('cow').reaction, 'ignore');
    assert.equal(r('JQDAW', 'player'), null, 'players are no threat');
    assert.equal(threatFor({ name: 'item', type: 'object', position: new Vec3(1, 64, 0) }), null);
    assert.equal(r('somemod:unknown_beast').reaction, 'fight', 'an unknown hostile mob falls back to fight');
    assert.equal(doNotLook(mob('enderman', 3)), true);
    assert.equal(doNotLook(mob('zombie', 3)), false);
});

test('the plan, first match wins: dangerous > explodes > outnumbered > ranged > melee > provoked', () => {
    const plan = (...es) => threatPlan(fakeBot(es));
    const lone = plan(mob('zombie', 5));
    assert.deepEqual([lone.action, lone.why], ['fight', 'melee']);

    const two = plan(mob('zombie', 5), mob('husk', 6));
    assert.deepEqual([two.action, two.why, two.away], ['flee', 'outnumbered', RANGES.fight.away]);

    const creeper = mob('creeper', 5);
    const boom = plan(creeper, mob('zombie', 3));
    assert.deepEqual([boom.action, boom.why, boom.from], ['flee', 'explodes', creeper]);
    assert.equal(boom.isEnemy(mob('zombie', 1)), false, 'it backs off from the creeper, not the zombie');
    assert.equal(plan(mob('creeper', RANGES['keep-distance'].near + 1)), null, 'a far creeper is left alone');

    const dragon = plan(mob('iceandfire:firedragon', 20), mob('creeper', 2));
    assert.deepEqual([dragon.action, dragon.why], ['flee', 'dangerous']);

    assert.deepEqual([plan(mob('skeleton', 10)).action, plan(mob('skeleton', 10)).why], ['flee', 'ranged']);
    assert.equal(plan(mob('skeleton', RANGES['take-cover'].near + 2)), null);
    assert.equal(plan(mob('cow', 2)), null);
    assert.equal(plan(), null);
});

test('an enderman is never fought or fled from unless it just hit the bot; then only it is fought', () => {
    const ender = mob('enderman', 2);
    assert.equal(threatPlan(fakeBot([ender])), null, 'not provoked');
    const now = 100_000;
    const hit = threatPlan(fakeBot([ender, mob('cow', 1)], { lastDamageTime: now - 1000 }), { now });
    assert.deepEqual([hit.action, hit.why, hit.from], ['fight', 'provoked', ender]);
    assert.equal(hit.isEnemy(ender), true);
    assert.equal(hit.isEnemy(mob('enderman', 2)), false, 'only the one that is near');
    assert.equal(threatPlan(fakeBot([ender], { lastDamageTime: now - 10_000 }), { now }), null, 'an old hit');
});

test('nightThreats becomes one line for the night routine (D2b)', () => {
    const note = nightThreatNote({ limit: 6 });
    assert.match(note, /^Tonight expect: /);
    assert.match(note, /Creeper \(keep-distance, explodes\)/);
    assert.ok(note.split('; ').length <= 6);
});

// The modes act on the plan. isClearPath runs on a fake pathfinder; the skill itself is not run.
function modeAgent(entities) {
    const bot = fakeBot(entities, {
        registry: minecraftData('1.12.2'), version: '1.12.2',
        pathfinder: { getPathFromTo: function* () { yield { result: { status: 'success', path: [] } }; } },
        modes: { behavior_log: '' },
    });
    bot.nearestEntity = () => null;
    const ran = [];
    return {
        ran, bot, shut_up: true,
        actions: { currentActionLabel: '', resume_func: null, runAction: (label) => { ran.push(label); return Promise.resolve({ message: 'ok', interrupted: false }); } },
        openChat() {},
    };
}
async function tick(agent) {
    for (const name of ['cowardice', 'self_defense']) {
        const mode = __modeForTest(name);
        await mode.update(agent);
        if (agent.ran.length) return;
    }
}

test('modes: cowardice backs off from a creeper, self_defense fights a lone zombie, nobody touches an enderman', async (t) => {
    t.mock.method(console, 'log', () => {});
    const a = modeAgent([mob('creeper', 4)]);
    await tick(a);
    assert.deepEqual(a.ran, ['mode:cowardice']);
    assert.match(a.bot.modes.behavior_log, /Backing off: creeper \(explodes\)!/);

    const b = modeAgent([mob('zombie', 4)]);
    await tick(b);
    assert.deepEqual(b.ran, ['mode:self_defense']);
    assert.match(b.bot.modes.behavior_log, /Fighting zombie!/);

    const c = modeAgent([mob('zombie', 4), mob('zombie', 5)]);
    await tick(c);
    assert.deepEqual(c.ran, ['mode:cowardice'], 'two at once: retreat');

    const d = modeAgent([mob('enderman', 3)]);
    await tick(d);
    assert.deepEqual(d.ran, [], 'neither fought nor fled');
});

test('modes: idle_staring never looks at an enderman', () => {
    const ender = mob('enderman', 3);
    const looked = [];
    const agent = { bot: { ...fakeBot([ender]), nearestEntity: () => ender, lookAt: (p) => looked.push(p), look: () => {} } };
    const mode = __modeForTest('idle_staring');
    mode.last_entity = null;
    mode.next_change = Date.now() + 60_000;
    mode.update(agent);
    assert.deepEqual(looked, []);
    const zombie = mob('zombie', 3);
    agent.bot.nearestEntity = () => zombie;
    mode.update(agent);
    assert.equal(looked.length, 1, 'a zombie is looked at');
});
