// Soak 14 (death 1): the attack packets that left the client, and the Better Combat wrapper's
// call counts, printed as numbers: a minute with a change, every death, the end of the connection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { attachAttackCounts, attackCountsLine, ATTACK_COUNTS_STATUS } from '../src/attack-counts.js';
import { installBetterCombatAttack } from '../src/bettercombat.js';
import { callerOf, parseFrame, targetName } from '../src/attack-caller.js';
import { Vec3 } from 'vec3';

function fakeBot() {
    const bot = new EventEmitter();
    bot.sent = [];
    bot._client = { write: (name, params) => bot.sent.push(name) };
    return bot;
}

/** An injected interval: tick() runs the callback once. */
function fakeInterval() {
    const t = { cb: null, ms: null, cleared: false };
    t.setTimer = (cb, ms) => { t.cb = cb; t.ms = ms; return { unref() { t.unref = true; } }; };
    t.clearTimer = () => { t.cleared = true; };
    t.tick = () => t.cb();
    return t;
}

const ZERO_CALLS = 'calls bettercombat 0, vanilla 0, waits 0, replaced 0, gone 0, cancelled 0, reach 0, sight 0, misses 0';

test('counts only attack packets: bettercombat payloads and use_entity with mouse 1; every packet still goes out', () => {
    const bot = fakeBot();
    const t = fakeInterval();
    const r = attachAttackCounts(bot, { log: () => {}, setTimer: t.setTimer, clearTimer: t.clearTimer });
    bot._client.write('custom_payload', { channel: 'bettercombat', data: Buffer.from([5]) });
    bot._client.write('custom_payload', { channel: 'FML|HS', data: Buffer.from([1]) });
    bot._client.write('use_entity', { target: 7, mouse: 1 });
    bot._client.write('use_entity', { target: 7, mouse: 0 }); // interact
    bot._client.write('use_entity', { target: 7, mouse: 2, x: 0, y: 0, z: 0 }); // interact_at
    bot._client.write('arm_animation', { hand: 0 });
    assert.deepEqual(r.packets, { bettercombat: 1, use_entity: 1 });
    assert.equal(bot.sent.length, 6, 'all written');
    assert.equal(t.ms, 60_000);
    assert.equal(t.unref, true, 'the timer does not hold the process');
    assert.equal(attachAttackCounts(bot, { log: () => assert.fail('attached twice') }), r, 'once per bot');
});

test('the minute line only when the numbers changed; death and end always (zeros too); end stops the timer', () => {
    const bot = fakeBot();
    const t = fakeInterval();
    const logs = [];
    let calls = {};
    attachAttackCounts(bot, { stats: () => calls, log: (m) => logs.push(m), setTimer: t.setTimer, clearTimer: t.clearTimer });
    t.tick();
    assert.deepEqual(logs, [], 'nothing sent yet: no minute line');
    bot.emit('death');
    assert.deepEqual(logs, [`attacks (death): written bettercombat 0, use_entity 0; ${ZERO_CALLS}; targets -`], 'a death prints the zeros');
    bot._client.write('custom_payload', { channel: 'bettercombat', data: Buffer.from([5]) });
    calls = { bettercombat: 1 };
    t.tick();
    t.tick();
    assert.equal(logs.length, 2, 'one minute line for the change, none for the unchanged minute');
    // A payload with no entity id (a 1-byte stub): the target is unknown, the caller is this test.
    assert.match(logs[1], /^attacks \(minute\): written bettercombat 1, use_entity 0; calls bettercombat 1, vanilla 0, waits 0, replaced 0, gone 0, cancelled 0, reach 0, sight 0, misses 0; targets \?#\? x1 \(attack-counts\.test\.js:\d+\)$/);
    calls = { bettercombat: 1, reach: 2 }; // calls that sent nothing count as a change too
    t.tick();
    assert.match(logs[2], /^attacks \(minute\): .* reach 2, .*; targets -$/, 'no packet since the last line');
    bot.emit('end');
    assert.match(logs[3], /^attacks \(end\): written bettercombat 1, use_entity 0;/);
    assert.equal(t.cleared, true);
});

test('a throwing stats source still prints the packet counts', () => {
    const bot = fakeBot();
    const t = fakeInterval();
    const logs = [];
    attachAttackCounts(bot, { stats: () => { throw new Error('gone'); }, log: (m) => logs.push(m), setTimer: t.setTimer, clearTimer: t.clearTimer });
    bot.emit('death');
    assert.deepEqual(logs, [attackCountsLine('death', { bettercombat: 0, use_entity: 0 }, {}, { targets: new Map(), replaced: [] })]);
    assert.match(logs[0], /; targets -$/);
});

test('with the real Better Combat wrapper (bc_attack off): bot.attack is counted as one use_entity packet and one vanilla call', async () => {
    const bot = fakeBot();
    bot.attack = (target) => bot._client.write('use_entity', { target: target.id, mouse: 1 }); // mineflayer's vanilla attack
    const bc = installBetterCombatAttack(bot, { bridge: () => null, enabled: false, log: () => {} });
    const t = fakeInterval();
    const logs = [];
    attachAttackCounts(bot, { stats: () => bc.stats, caller: () => bc.firingCaller, takeReplacements: () => bc.takeReplacements(), log: (m) => logs.push(m), setTimer: t.setTimer, clearTimer: t.clearTimer });
    bot.entities = { 9: { id: 9, name: 'animania:hen_rhode_island_red' } };
    async function huntHen() { await bot.attack({ id: 9 }); }
    await huntHen();
    bot.emit('end');
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^attacks \(end\): written bettercombat 0, use_entity 1; calls bettercombat 0, vanilla 1, waits 0, replaced 0, gone 0, cancelled 0, reach 0, sight 0, misses 0; targets animania:hen_rhode_island_red#9 x1 \(huntHen attack-counts\.test\.js:\d+(?: < [^)>]+)?\)$/, 'the wrapper\'s caller: who called bot.attack');
});

test('#610 review 3: one status line at the first spawn says the counter is on', () => {
    const bot = fakeBot();
    const t = fakeInterval();
    const logs = [];
    attachAttackCounts(bot, { log: (m) => logs.push(m), setTimer: t.setTimer, clearTimer: t.clearTimer });
    bot.emit('spawn');
    bot.emit('spawn'); // a respawn
    assert.deepEqual(logs, [ATTACK_COUNTS_STATUS]);
    assert.match(ATTACK_COUNTS_STATUS, /^attack counts: on/);
});

// Better Combat's path, active, on an injected clock (the shape of bettercombat.test.js's rig).
function bcRig() {
    const bot = new EventEmitter();
    const clock = { t: 10_000, timers: [] };
    bot.writes = [];
    bot._client = { write: (name, params) => bot.writes.push({ name, params }) };
    bot.attack = (target) => bot._client.write('use_entity', { target: target.id, mouse: 1 });
    bot.heldItem = { name: 'stone_sword' };
    bot.entity = { position: new Vec3(0, 64, 0), eyeHeight: 1.62, attributes: { 'generic.attackSpeed': { value: 4, modifiers: [{ amount: -2.4, operation: 0 }] } } };
    const bridge = { serverMods: [{ modid: 'bettercombat', version: 'x' }], serverChannels: ['FML|HS', 'bettercombat'] };
    const setTimer = (fn, ms) => { const h = { fn, at: clock.t + ms, cleared: false }; clock.timers.push(h); return h; };
    const clearTimer = (h) => { if (h) h.cleared = true; };
    const advance = async (ms) => {
        const end = clock.t + ms;
        for (;;) {
            const due = clock.timers.filter((h) => !h.cleared && h.at <= end).sort((a, b) => a.at - b.at)[0];
            if (!due) break;
            clock.t = due.at;
            due.cleared = true;
            due.fn();
            await Promise.resolve();
        }
        clock.t = end;
        await Promise.resolve();
    };
    const bc = installBetterCombatAttack(bot, { bridge: () => bridge, enabled: true, log: () => {}, setTimer, clearTimer, now: () => clock.t, lineOfSight: () => true });
    const t = fakeInterval();
    const logs = [];
    const counts = attachAttackCounts(bot, { stats: () => bc.stats, caller: () => bc.firingCaller, takeReplacements: () => bc.takeReplacements(), log: (m) => logs.push(m), setTimer: t.setTimer, clearTimer: t.clearTimer });
    const at = (id, name, z = 2) => { const e = { id, name, position: new Vec3(0, 64, z), width: 0.6, height: 1.95 }; (bot.entities ??= {})[id] = e; return e; };
    return { bot, bc, advance, t, logs, counts, at };
}

test('soak 16 death 2: each Better Combat packet\'s target and caller, a hit sent after its cooldown wait included, and a replaced call with both callers', async () => {
    const r = bcRig();
    const hen = r.at(1234, 'animania:hen_rhode_island_red');
    const zombie = r.at(77, 'zombie');
    function huntHen() { return r.bot.attack(hen); }
    function selfDefense() { return r.bot.attack(zombie); }
    assert.equal((await huntHen()).sent, true, 'the first hit goes out at once');
    const waiting = huntHen(); // within the cooldown: waits
    await r.advance(100);
    const defend = selfDefense(); // replaces the waiting hen hit
    assert.equal((await waiting).reason, 'replaced');
    await r.advance(600);
    assert.equal((await defend).sent, true, 'sent from the timer after the cooldown');
    r.t.tick();
    assert.equal(r.logs.length, 1);
    const line = r.logs[0];
    assert.match(line, /^attacks \(minute\): written bettercombat 2, use_entity 0; calls bettercombat 2, vanilla 0, waits 2, replaced 1, /);
    const tail = line.slice(line.indexOf('; targets '));
    // The waited zombie hit names selfDefense (the wrapper's caller), not the timer that sent it.
    assert.match(tail, /^; targets animania:hen_rhode_island_red#1234 x1 \(huntHen attack-counts\.test\.js:\d+(?: < [^)>]+)?\), zombie#77 x1 \(selfDefense attack-counts\.test\.js:\d+(?: < [^)>]+)?\); replaced huntHen attack-counts\.test\.js:\d+(?: < \S+)? -> animania:hen_rhode_island_red#1234 by selfDefense attack-counts\.test\.js:\d+(?: < \S+)? -> zombie#77$/);
    // The next line has only what came after: nothing.
    r.bot.emit('death');
    assert.match(r.logs[1], /^attacks \(death\): .*; targets -$/);
    assert.deepEqual(r.bc.takeReplacements(), [], 'taken by the line');
});

test('a packet written outside the wrapper (bot.attackVanilla) is named from the stack at the write; an unknown entity is ?#id', () => {
    const r = bcRig();
    // (The rig's stand-in for mineflayer's attack is in this file, so it is named first; mineflayer's own is skipped.)
    function directSwing() { r.bot.attackVanilla({ id: 5 }); }
    directSwing();
    r.bot.emit('death');
    assert.match(r.logs[0], /; targets \?#5 x1 \((?:bot\.attack attack-counts\.test\.js:\d+ < )?directSwing attack-counts\.test\.js:\d+\)$/);
});

test('at most 8 targets and 4 replacements on a line, then "+N more"', () => {
    const detail = { targets: new Map(), replaced: [] };
    for (let i = 0; i < 10; i++) detail.targets.set(JSON.stringify([`zombie#${i}`, null]), 1);
    for (let i = 0; i < 6; i++) detail.replaced.push({ replaced: { caller: 'a x.js:1', target: `zombie#${i}` }, by: { caller: null, target: 'zombie#9' } });
    const line = attackCountsLine('minute', { bettercombat: 10, use_entity: 0 }, {}, detail);
    assert.match(line, /; targets zombie#0 x1, (?:zombie#\d x1, ){6}zombie#7 x1, \+2 more; replaced a x\.js:1 -> zombie#0 by \? -> zombie#9, (?:[^,]+, ){2}a x\.js:1 -> zombie#3 by \? -> zombie#9, \+2 more$/);
});

test('callerOf: the first two frames outside forge-bridge\'s src, mineflayer and node; file names only', () => {
    const stack = [
        'Error',
        '    at attack (file:///home/u/w/packages/forge-bridge/src/bettercombat.js:430:24)',
        '    at Bot.attack [as attack] (/home/u/w/node_modules/mineflayer/lib/plugins/entities.js:10:3)',
        '    at attackEntity (file:///home/u/w/src/agent/library/skills.js:1234:15)',
        '    at async huntAnimal (file:///home/u/w/src/agent/library/skills.js:980:5)',
        '    at async Object.execute (file:///home/u/w/src/agent/commands/actions.js:77:9)',
        '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ].join('\n');
    assert.equal(callerOf(stack), 'attackEntity skills.js:1234 < huntAnimal skills.js:980');
    assert.equal(callerOf(stack, 3), 'attackEntity skills.js:1234 < huntAnimal skills.js:980 < execute actions.js:77');
    assert.equal(callerOf('Error\n    at Timeout._onTimeout (node:internal/timers:1:1)'), null, 'a timer: no caller');
    assert.equal(callerOf(undefined), null);
    assert.deepEqual(parseFrame('    at file:///x/y/modes.js:410:7'), { fn: null, file: '/x/y/modes.js', line: 410 });
    assert.deepEqual(parseFrame('    at TestContext.<anonymous> (/x/t.test.js:5:1)'), { fn: null, file: '/x/t.test.js', line: 5 });
    assert.equal(parseFrame('not a frame'), null);
    assert.equal(targetName({ entities: { 3: { name: 'animania:hog_old_spot' } } }, 3), 'animania:hog_old_spot#3');
    assert.equal(targetName({ entities: { 4: { type: 'player' } } }, 4), 'player#4');
    assert.equal(targetName({}, null), '?#?');
});
