// Soak 14 (death 1): the attack packets that left the client, and the Better Combat wrapper's
// call counts, printed as numbers: a minute with a change, every death, the end of the connection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { attachAttackCounts, attackCountsLine } from '../src/attack-counts.js';
import { installBetterCombatAttack } from '../src/bettercombat.js';

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
    assert.deepEqual(logs, [`attacks (death): packets bettercombat 0, use_entity 0; ${ZERO_CALLS}`], 'a death prints the zeros');
    bot._client.write('custom_payload', { channel: 'bettercombat', data: Buffer.from([5]) });
    calls = { bettercombat: 1 };
    t.tick();
    t.tick();
    assert.equal(logs.length, 2, 'one minute line for the change, none for the unchanged minute');
    assert.equal(logs[1], 'attacks (minute): packets bettercombat 1, use_entity 0; calls bettercombat 1, vanilla 0, waits 0, replaced 0, gone 0, cancelled 0, reach 0, sight 0, misses 0');
    calls = { bettercombat: 1, reach: 2 }; // calls that sent nothing count as a change too
    t.tick();
    assert.match(logs[2], /^attacks \(minute\): .* reach 2,/);
    bot.emit('end');
    assert.match(logs[3], /^attacks \(end\): packets bettercombat 1, use_entity 0;/);
    assert.equal(t.cleared, true);
});

test('a throwing stats source still prints the packet counts', () => {
    const bot = fakeBot();
    const t = fakeInterval();
    const logs = [];
    attachAttackCounts(bot, { stats: () => { throw new Error('gone'); }, log: (m) => logs.push(m), setTimer: t.setTimer, clearTimer: t.clearTimer });
    bot.emit('death');
    assert.deepEqual(logs, [attackCountsLine('death', { bettercombat: 0, use_entity: 0 })]);
});

test('with the real Better Combat wrapper (bc_attack off): bot.attack is counted as one use_entity packet and one vanilla call', async () => {
    const bot = fakeBot();
    bot.attack = (target) => bot._client.write('use_entity', { target: target.id, mouse: 1 }); // mineflayer's vanilla attack
    const bc = installBetterCombatAttack(bot, { bridge: () => null, enabled: false, log: () => {} });
    const t = fakeInterval();
    const logs = [];
    attachAttackCounts(bot, { stats: () => bc.stats, log: (m) => logs.push(m), setTimer: t.setTimer, clearTimer: t.clearTimer });
    await bot.attack({ id: 9 });
    bot.emit('end');
    assert.deepEqual(logs, ['attacks (end): packets bettercombat 0, use_entity 1; calls bettercombat 0, vanilla 1, waits 0, replaced 0, gone 0, cancelled 0, reach 0, sight 0, misses 0']);
});
