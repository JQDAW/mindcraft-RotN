// patches/mineflayer-collectblock+1.6.0.patch (net-forge, soak 9 craft "hang"): the pickup wait after
// a dig waited for the item's entityGone with no limit, pathfinder.stop() could not end it, and
// Mindcraft's stop loop (cancelTask every 300 ms) added a 'collectBlock_finished' and an 'error'
// listener on each pass until the 10 s kill. Offline: a fake bot with the installed (patched) plugin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import process from 'node:process';
import { setImmediate } from 'node:timers';

const require = createRequire(import.meta.url);
const { CollectBlock } = require('mineflayer-collectblock/lib/CollectBlock.js');
const Entity = require('prismarine-entity')('1.12.2');
const { Vec3 } = require('vec3');

/**
 * A bot with what collectAll touches for an item target. goto resolves at once unless `goto` is
 * given; stop() rejects a pending goto with PathStopped like mineflayer-pathfinder, unless
 * `stopIgnored`.
 */
function fakeBot({ goto = null, stopIgnored = false } = {}) {
    const bot = new EventEmitter();
    bot.version = '1.12.2';
    bot.registry = require('prismarine-registry')('1.12.2');
    bot.entity = { position: new Vec3(0, 64, 0) };
    bot.entities = {};
    bot.inventory = { emptySlotCount: () => 10 };
    bot.tool = {};
    let pending = null;
    bot.pathfinder = {
        stops: 0,
        setMovements() {},
        stop() {
            this.stops++;
            if (stopIgnored || !pending) return;
            const err = new Error('Path was stopped before it could be completed!');
            err.name = 'PathStopped';
            const p = pending;
            pending = null;
            p.reject(err);
        },
        goto(goal) {
            if (goto) return goto(goal);
            return new Promise((resolve, reject) => { pending = { reject }; setImmediate(() => { if (pending) { pending = null; resolve(); } }); });
        },
    };
    bot.collectBlock = new CollectBlock(bot);
    return bot;
}

function item(bot, id = 77) {
    const e = new Entity(id);
    e.name = 'item';
    e.type = 'object';
    e.position.set(1.5, 64, 0.5);
    bot.entities[id] = e;
    return e;
}

const ms = (t0) => Date.now() - t0;
const listeners = (bot) => ({ finished: bot.listenerCount('collectBlock_finished'), error: bot.listenerCount('error'), gone: bot.listenerCount('entityGone') });

test('the patch is in patches/ and applied to the installed plugin', () => {
    const patch = fs.readFileSync(new URL('../../../patches/mineflayer-collectblock+1.6.0.patch', import.meta.url), 'utf8');
    assert.match(patch, /lib\/CollectBlock\.js/);
    const bot = fakeBot();
    assert.equal(bot.collectBlock.pickupTimeout, 5000);
    assert.equal(bot.collectBlock.cancelTimeout, 5000);
    assert.equal(bot.collectBlock.lastPickup, null);
});

test('an item that is picked up ends the wait as before (entityGone): reason gone', async () => {
    const bot = fakeBot();
    const e = item(bot);
    const ended = [];
    bot.on('collectBlock_pickupEnded', (x) => ended.push(x));
    const before = listeners(bot);
    const collecting = bot.collectBlock.collect(e);
    setTimeout(() => { bot.emit('entityGone', e); e.isValid = false; delete bot.entities[e.id]; }, 50);
    await collecting;
    assert.equal(bot.collectBlock.lastPickup.reason, 'gone');
    assert.equal(bot.collectBlock.lastPickup.entityId, 77);
    assert.deepEqual(ended.map((x) => [x.entity, x.reason]), [[e, 'gone']]);
    assert.ok(bot.collectBlock.targets.empty);
    assert.deepEqual(listeners(bot), before, 'no listener left behind');
});

test('an item that never goes: the wait ends after pickupTimeout (reason timeout), the collect finishes', async () => {
    const bot = fakeBot();
    bot.collectBlock.pickupTimeout = 300;
    const e = item(bot);
    let finished = 0;
    bot.on('collectBlock_finished', () => finished++);
    const t0 = Date.now();
    await bot.collectBlock.collect(e);
    assert.ok(ms(t0) >= 280 && ms(t0) < 3000, `ended after ${ms(t0)} ms`);
    assert.equal(bot.collectBlock.lastPickup.reason, 'timeout');
    assert.ok(bot.collectBlock.lastPickup.ms >= 280);
    assert.ok(bot.collectBlock.targets.empty, 'the item is given up');
    assert.equal(finished, 1);
    // The per-call option wins over the plugin's.
    const e2 = item(bot, 78);
    const t1 = Date.now();
    await bot.collectBlock.collect(e2, { pickupTimeout: 100 });
    assert.ok(ms(t1) < 280, `per-call pickupTimeout (${ms(t1)} ms)`);
    assert.equal(bot.collectBlock.lastPickup.reason, 'timeout');
});

test('an item that turns invalid or leaves bot.entities without an entityGone ends the wait', async () => {
    const bot = fakeBot();
    bot.collectBlock.pickupTimeout = 60_000;
    const a = item(bot, 80);
    setTimeout(() => { a.isValid = false; }, 50);
    let t0 = Date.now();
    await bot.collectBlock.collect(a);
    assert.equal(bot.collectBlock.lastPickup.reason, 'invalid');
    assert.ok(ms(t0) < 2000);
    const b = item(bot, 81);
    setTimeout(() => { delete bot.entities[81]; }, 50);
    t0 = Date.now();
    await bot.collectBlock.collect(b);
    assert.equal(bot.collectBlock.lastPickup.reason, 'gone');
    assert.ok(ms(t0) < 2000);
    // Replaced by another object under the same id: not the item we wait for.
    const c = item(bot, 82);
    setTimeout(() => { bot.entities[82] = new Entity(82); }, 50);
    await bot.collectBlock.collect(c);
    assert.equal(bot.collectBlock.lastPickup.reason, 'gone');
});

test('gone during the walk: entityGone before goto ends counts, no limit started', async () => {
    let release;
    const bot = fakeBot({ goto: () => new Promise((resolve) => { release = resolve; }) });
    bot.collectBlock.pickupTimeout = 60_000;
    const e = item(bot);
    const collecting = bot.collectBlock.collect(e);
    await new Promise((r) => setImmediate(r));
    bot.emit('entityGone', e);
    release();
    await collecting;
    assert.equal(bot.collectBlock.lastPickup.reason, 'gone');
});

test('cancelTask during the pickup wait ends it at once (reason cancelled); the collect resolves', async () => {
    const bot = fakeBot();
    bot.collectBlock.pickupTimeout = 60_000;
    const e = item(bot);
    const before = listeners(bot);
    const collecting = bot.collectBlock.collect(e);
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    assert.equal(await bot.collectBlock.cancelTask(), 'finished');
    await collecting;
    assert.ok(ms(t0) < 500, `cancel took ${ms(t0)} ms`);
    assert.equal(bot.collectBlock.lastPickup.reason, 'cancelled');
    assert.ok(bot.collectBlock.targets.empty);
    assert.deepEqual(listeners(bot), before);
    // A new collect after the cancel runs normally (a fresh run, not the cancelled one).
    bot.collectBlock.pickupTimeout = 100;
    const e2 = item(bot, 90);
    await bot.collectBlock.collect(e2, { append: true });
    assert.equal(bot.collectBlock.lastPickup.reason, 'timeout');
});

test('the stop loop: cancelTask every pass shares one wait (no listener per call), bounded by cancelTimeout', async () => {
    // A collect stuck where a cancel cannot reach (a goto that ignores stop()).
    const bot = fakeBot({ goto: () => new Promise(() => {}), stopIgnored: true });
    bot.collectBlock.cancelTimeout = 400;
    const e = item(bot);
    const warnings = [];
    const onWarning = (w) => warnings.push(w.name);
    process.on('warning', onWarning);
    const before = listeners(bot);
    bot.collectBlock.collect(e).catch(() => {});
    await new Promise((r) => setImmediate(r));
    const timeouts = [];
    bot.on('collectBlock_cancelTimeout', (x) => timeouts.push(x.ms));
    const calls = [];
    for (let i = 0; i < 15; i++) {
        calls.push(bot.collectBlock.cancelTask());
        assert.ok(bot.listenerCount('collectBlock_finished') <= before.finished + 1, `pass ${i}: one shared listener`);
        assert.equal(bot.listenerCount('error'), before.error, `pass ${i}: no error listener`);
        await new Promise((r) => setTimeout(r, 10));
    }
    const t0 = Date.now();
    const reasons = await Promise.all(calls);
    assert.ok(reasons.every((r) => r === 'timeout'), reasons.join());
    assert.ok(ms(t0) < 1000);
    assert.deepEqual(timeouts, [400], 'one timeout for the shared wait');
    assert.equal(bot.pathfinder.stops, 1, 'pathfinder.stop once per cancel, not per call');
    assert.ok(bot.collectBlock.targets.empty, 'targets cleared, so the next collect is not blocked');
    assert.equal(bot.listenerCount('collectBlock_finished'), before.finished);
    await new Promise((r) => setImmediate(r));
    process.off('warning', onWarning);
    assert.ok(!warnings.includes('MaxListenersExceededWarning'), warnings.join());
    // A cancel with nothing to cancel returns at once, as before; the callback form still works.
    let cb = 0;
    assert.equal(await bot.collectBlock.cancelTask(() => cb++), undefined);
    assert.equal(cb, 1);
});

test('a goto stopped by cancelTask (PathStopped) leaves no entityGone listener behind', async () => {
    const bot = fakeBot({ goto: () => new Promise(() => {}) });
    const pending = [];
    bot.pathfinder.goto = () => new Promise((resolve, reject) => { pending.push(reject); });
    bot.pathfinder.stop = function () {
        const err = new Error('stopped');
        err.name = 'PathStopped';
        for (const r of pending.splice(0)) r(err);
    };
    const e = item(bot);
    const before = listeners(bot);
    const collecting = bot.collectBlock.collect(e);
    await new Promise((r) => setImmediate(r));
    assert.equal(bot.listenerCount('entityGone'), before.gone + 1, 'waiting during the walk');
    assert.equal(await bot.collectBlock.cancelTask(), 'finished');
    await collecting;
    assert.deepEqual(listeners(bot), before);
});

test('a goto that fails by itself (NoPath) rejects the collect as before and leaves no entityGone listener', async () => {
    const bot = fakeBot({
        goto: () => Promise.reject(Object.assign(new Error('No path to the goal!'), { name: 'NoPath' })),
    });
    const e = item(bot);
    const before = listeners(bot);
    await assert.rejects(bot.collectBlock.collect(e), { name: 'NoPath' });
    assert.deepEqual(listeners(bot), before, 'the pickup wait was cleaned up');
    assert.ok(bot.collectBlock.targets.empty, 'targets cleared on an error, as before');
});
