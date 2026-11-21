// bettercombat.js: Better Combat's PacketMainhandAttack for bot.attack (G4 soak 7, rotn-data #518).
// Offline: the bytes against the layout read with javap, the pacing against bettercombat.cfg,
// and the wrapper on a fake bot with a manual clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
    encodeMainhandAttack, decodeMainhandAttack, bcCooldownTicks, bcReach, bcAttackSetting, attributeValue,
    isBcWeaponName, ticksForSpeed, reachDistance, installBetterCombatAttack, BC_CHANNEL, UNKNOWN_SPEED_TICKS,
} from '../index.js';
import { decodeRegister } from '../src/channels.js';

const { Vec3 } = createRequire(import.meta.url)('vec3');

const hex = (b) => Buffer.from(b).toString('hex');

test('PacketMainhandAttack bytes: discriminator 5, boolean, VarInt id of at most 4 bytes', () => {
    assert.equal(hex(encodeMainhandAttack(5)), '050105');
    assert.equal(hex(encodeMainhandAttack(300)), '0501ac02');
    assert.equal(hex(encodeMainhandAttack(1234)), '0501d209');
    assert.equal(hex(encodeMainhandAttack(70000)), '0501f0a204');
    assert.equal(hex(encodeMainhandAttack(2 ** 28 - 1)), '0501ffffff7f');
    assert.equal(hex(encodeMainhandAttack()), '0500', 'a swing at nothing');
    assert.equal(hex(encodeMainhandAttack(null)), '0500');
    for (const bad of [-1, 2 ** 28, 1.5, '3']) assert.throws(() => encodeMainhandAttack(bad), RangeError, String(bad));
    for (const id of [0, 5, 127, 128, 300, 1234, 70000, 2 ** 21, 2 ** 28 - 1]) {
        assert.deepEqual(decodeMainhandAttack(encodeMainhandAttack(id)), { disc: 5, entityId: id });
    }
    assert.deepEqual(decodeMainhandAttack(Buffer.from('0500', 'hex')), { disc: 5, entityId: null });
    assert.deepEqual(decodeMainhandAttack(Buffer.from('050205', 'hex')), { disc: 5, entityId: 5 }, 'readBoolean: any non-zero byte is true');
    assert.throws(() => decodeMainhandAttack(Buffer.from('040105', 'hex')), /discriminator 4/);
    assert.throws(() => decodeMainhandAttack(Buffer.from('0501ffffffff01', 'hex')), /VarInt too big/, 'Forge reads at most 4 bytes');
});

test('attribute value: vanilla operations 0, 1 and 2', () => {
    assert.equal(attributeValue(undefined), null);
    assert.equal(attributeValue({ value: 4, modifiers: [] }), 4);
    assert.ok(Math.abs(attributeValue({ value: 4, modifiers: [{ amount: -2.4, operation: 0 }] }) - 1.6) < 1e-9);
    assert.ok(Math.abs(attributeValue({ value: 4, modifiers: [{ amount: -2.4, operation: 0 }, { amount: 0.5, operation: 1 }] }) - 2.4) < 1e-9);
    assert.ok(Math.abs(attributeValue({ value: 4, modifiers: [{ amount: -2.4, operation: 0 }, { amount: 0.5, operation: 1 }, { amount: 0.5, operation: 2 }] }) - 3.6) < 1e-9);
});

test('cooldown: Better Combat client pacing from bettercombat.cfg', () => {
    assert.equal(ticksForSpeed(1.5), 13);
    assert.equal(ticksForSpeed(4), 8, 'minimum 8 ticks');
    assert.equal(ticksForSpeed(0), 200, 'speed clamped to 0.1');
    assert.equal(bcCooldownTicks({}), 13, 'empty hand: 1.5');
    assert.equal(bcCooldownTicks({ itemName: null, attackSpeed: 4 }), 13, 'empty hand ignores the attribute');
    assert.equal(bcCooldownTicks({ itemName: 'stone_sword', attackSpeed: 1.6 }), 13, '1.6 - 0.1 (Sword Tweaker)');
    assert.equal(bcCooldownTicks({ itemName: 'diamond_sword', attackSpeed: 1.6 }), 13);
    assert.equal(bcCooldownTicks({ itemName: 'golden_sword', attackSpeed: 1.6 }), 11, '1.6 + 0.2');
    assert.equal(bcCooldownTicks({ itemName: 'stone_sword', attackSpeed: 1.0 }), 22, 'the stone sword tweak: 0.9, not 1.0 (20)');
    assert.equal(bcCooldownTicks({ itemName: 'stone_axe', attackSpeed: 0.4 }), 50, 'Material Changer');
    assert.equal(bcCooldownTicks({ itemName: 'pyrotech:crude_axe', attackSpeed: 0.9 }), 22);
    assert.equal(bcCooldownTicks({ itemName: 'stone_axe', attackSpeed: null }), null, 'unknown speed');
    assert.equal(bcCooldownTicks({ itemName: 'stick', attackSpeed: 4 }), 13, 'a non-weapon: never faster than 1.5');
    assert.equal(bcCooldownTicks({ itemName: 'mystery_blade', attackSpeed: 0.5 }), 40, 'unknown kind: the slower of the two');
    assert.ok(isBcWeaponName('stone_pickaxe') && isBcWeaponName('iron_shovel') && isBcWeaponName('wooden_hoe') && isBcWeaponName('pyrotech:crude_axe'));
    assert.ok(!isBcWeaponName('stick') && !isBcWeaponName('axe_head') && !isBcWeaponName(null));
    assert.equal(bcReach('stone_sword'), 4.0);
    assert.equal(bcReach(null), 3.5);
    assert.equal(bcReach('stick'), 3.5);
    // javap: ItemCrudeAxe < ItemAxeBase < ItemAxe < ItemTool, matched by Class.isInstance.
    assert.equal(bcReach('pyrotech:crude_axe'), 4.0, 'the crude axe is a Better Combat weapon');
    assert.ok(['crude_pickaxe', 'crude_shovel', 'crude_hoe'].every((n) => isBcWeaponName(`pyrotech:${n}`)));
    assert.equal(bcCooldownTicks({ itemName: 'pyrotech:crude_axe', attackSpeed: 0.9 }), 22);
    // rotn-data weapons.json: Earthworks' hand axe is a plain Item, a Better Combat non-weapon.
    assert.ok(!isBcWeaponName('earthworks:tool_hand_axe'));
    assert.equal(bcReach('earthworks:tool_hand_axe'), 3.5);
    assert.equal(UNKNOWN_SPEED_TICKS, 50, 'the pack\'s slowest speed, 0.4');
});

test('setting: off by default; FORGE_BC_ATTACK wins over bc_attack', () => {
    assert.deepEqual(bcAttackSetting(null, undefined), { on: false, source: 'default', warning: null });
    assert.deepEqual(bcAttackSetting(null, true), { on: true, source: 'bc_attack', warning: null });
    assert.deepEqual(bcAttackSetting('on', false), { on: true, source: 'FORGE_BC_ATTACK', warning: null });
    assert.deepEqual(bcAttackSetting('off', true), { on: false, source: 'FORGE_BC_ATTACK', warning: null });
    const bad = bcAttackSetting('maybe', true);
    assert.equal(bad.on, true);
    assert.match(bad.warning, /FORGE_BC_ATTACK "maybe" ignored/);
    const badSetting = bcAttackSetting(undefined, 'yes');
    assert.equal(badSetting.on, false);
    assert.match(badSetting.warning, /bc_attack "yes" ignored/);
});

test('reach: eye to the nearest point of the hitbox', () => {
    const eye = { x: 0, y: 65.62, z: 0 };
    assert.ok(Math.abs(reachDistance(eye, { position: new Vec3(0, 64, 2), width: 0.6, height: 1.95 }) - 1.7) < 1e-9);
    assert.equal(reachDistance(eye, { position: new Vec3(0, 64, 0), width: 0.6, height: 1.95 }), 0);
});

// ---- the wrapper on a fake bot ----

function rig(o = {}) {
    const {
        enabled = true, mods = [{ modid: 'bettercombat', version: 'x' }], channels = ['FML|HS', 'bettercombat'],
        held = 'stone_sword', attackSpeed = { value: 4, modifiers: [{ amount: -2.4, operation: 0 }] },
        lineOfSight = () => true, defineAttack = true,
    } = o;
    const bot = new EventEmitter();
    const clock = { t: 10_000, timers: [] };
    bot.writes = [];
    bot._client = { write: (name, params) => bot.writes.push({ name, params }) };
    const vanilla = (target, swing = true) => {
        bot.writes.push({ name: 'use_entity', params: { target: target.id, mouse: 1 } });
        if (swing) bot.writes.push({ name: 'arm_animation', params: { hand: 0 } });
    };
    if (defineAttack) bot.attack = vanilla;
    bot.heldItem = held ? { name: held } : null;
    bot.entity = { position: new Vec3(0, 64, 0), eyeHeight: 1.62, attributes: attackSpeed ? { 'generic.attackSpeed': attackSpeed } : {} };
    const bridge = { serverMods: mods, serverChannels: channels };
    const lines = [];
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
    const bc = installBetterCombatAttack(bot, {
        bridge: () => bridge, enabled, log: (m) => lines.push(m), setTimer, clearTimer,
        ...(o.defaultClock ? {} : { now: () => clock.t }),
        ...(o.defaultSight ? {} : { lineOfSight }),
    });
    const target = (id = 1234, z = 2) => ({ id, position: new Vec3(0, 64, z), width: 0.6, height: 1.95 });
    const names = () => bot.writes.map((w) => w.name);
    return { bot, bc, clock, advance, target, lines, names, bridge, vanilla };
}

test('wrapper: arm_animation then the bettercombat payload, never use_entity', async () => {
    const r = rig();
    assert.equal(typeof r.bot.attackVanilla, 'function');
    const res = await r.bot.attack(r.target());
    assert.deepEqual(res, { sent: true, path: 'bettercombat', waitedMs: 0 });
    assert.deepEqual(r.names(), ['arm_animation', 'custom_payload']);
    assert.deepEqual(r.bot.writes[0].params, { hand: 0 });
    assert.equal(r.bot.writes[1].params.channel, BC_CHANNEL);
    assert.equal(hex(r.bot.writes[1].params.data), '0501d209');
    assert.equal(r.bc.active, true);
    assert.equal(r.bc.status(), 'bettercombat attack: on');

    const quiet = rig();
    await quiet.bot.attack(quiet.target(), false);
    assert.deepEqual(quiet.names(), ['custom_payload'], 'swing=false: no arm_animation');
});

test('wrapper: paced at the cooldown; a newer call replaces a waiting one', async () => {
    const r = rig(); // stone sword: 13 ticks = 650 ms
    await r.bot.attack(r.target());
    const p1 = r.bot.attack(r.target(1));
    await r.advance(100);
    const p2 = r.bot.attack(r.target(2));
    assert.deepEqual(await p1, { sent: false, path: null, waitedMs: 100, reason: 'replaced' });
    await r.advance(549);
    assert.equal(r.names().filter((n) => n === 'custom_payload').length, 1, 'not before 650 ms');
    await r.advance(1);
    const res = await p2;
    assert.deepEqual(res, { sent: true, path: 'bettercombat', waitedMs: 550 });
    const payloads = r.bot.writes.filter((w) => w.name === 'custom_payload').map((w) => decodeMainhandAttack(w.params.data).entityId);
    assert.deepEqual(payloads, [1234, 2]);
    assert.deepEqual(r.bc.stats, { bettercombat: 2, vanilla: 0, waits: 2, replaced: 1, gone: 0, cancelled: 0, reach: 0, sight: 0, misses: 1 }, 'the first hit got no hurt within 500 ms');
    assert.equal(r.bc.cooldownTicks(), 13);
});

test('wrapper: the default clock is monotonic: a wall-clock step does not send early', async (t) => {
    const r = rig({ defaultClock: true });
    await r.bot.attack(r.target());
    const realNow = Date.now;
    t.after(() => { Date.now = realNow; });
    Date.now = () => realNow() + 3_600_000; // an NTP step one hour forward
    const p = r.bot.attack(r.target());
    await Promise.resolve();
    assert.equal(r.names().filter((n) => n === 'custom_payload').length, 1, 'the second hit waits for its cooldown');
    r.bot.emit('end');
    assert.equal((await p).reason, 'ended');
});

test('wrapper: a waiting call whose target is gone sends nothing and is not a miss', async () => {
    // isValid false (mineflayer's entity_destroy)
    const r = rig();
    await r.bot.attack(r.target());
    r.bot.emit('entityHurt', { id: 1234 });
    const dead = r.target(7);
    const p = r.bot.attack(dead);
    await r.advance(100);
    dead.isValid = false;
    await r.advance(600);
    assert.deepEqual(await p, { sent: false, path: null, waitedMs: 650, reason: 'gone' });
    assert.equal(r.names().filter((n) => n === 'custom_payload').length, 1);
    assert.equal(r.bc.stats.gone, 1);
    assert.equal(r.bc.stats.misses, 0);

    // no longer in bot.entities; one still there is hit
    const e = rig();
    const kept = e.target(8), left = e.target(9);
    e.bot.entities = { 8: kept, 9: left };
    await e.bot.attack(kept);
    const q = e.bot.attack(left);
    delete e.bot.entities[9];
    await e.advance(650);
    assert.equal((await q).reason, 'gone');
    const q2 = e.bot.attack(kept);
    await e.advance(650);
    assert.equal((await q2).path, 'bettercombat');

    // a hit target that leaves the bot's view: its check is dropped, not a miss
    const g = rig();
    await g.bot.attack(g.target());
    g.bot.emit('entityGone', { id: 1234 });
    await g.advance(600);
    assert.equal(g.bc.stats.misses, 0);
});

test('wrapper: cancel() ends a waiting call at once and sends nothing; a no-op when nothing waits', async () => {
    const r = rig(); // stone sword: 13 ticks = 650 ms
    assert.equal(r.bc.cancel('interrupt'), false, 'nothing waits');
    await r.bot.attack(r.target());
    r.bot.emit('entityHurt', { id: 1234 });
    const before = r.bot.writes.length;
    const p = r.bot.attack(r.target());
    await r.advance(200);
    assert.equal(r.bc.cancel('interrupt'), true);
    assert.deepEqual(await p, { sent: false, path: null, waitedMs: 200, reason: 'interrupt' });
    await r.advance(5000);
    assert.equal(r.bot.writes.length, before, 'no swing and no payload, even after the cooldown');
    assert.equal(r.bc.cancel(), false, 'a second cancel is a no-op');
    assert.equal(r.bc.stats.cancelled, 1);
    assert.equal(r.bc.stats.misses, 0, 'not counted in the self-check');
    assert.equal(r.bc.tripped, false);

    // The default reason, and the next call is paced from the last real swing, not the cancel.
    const q = r.bot.attack(r.target());
    assert.deepEqual(await q, { sent: true, path: 'bettercombat', waitedMs: 0 });
    const w = r.bot.attack(r.target());
    r.bc.cancel();
    assert.equal((await w).reason, 'cancelled');

    // Pinned (#536 review): a cancel does not restart the cooldown. Swing at t0, cancel at t0+200,
    // call at t0+650: it goes out at once.
    const c = rig();
    await c.bot.attack(c.target());
    c.bot.emit('entityHurt', { id: 1234 });
    const w2 = c.bot.attack(c.target());
    await c.advance(200);
    c.bc.cancel('interrupt');
    await w2;
    await c.advance(450);
    const now650 = c.bot.attack(c.target());
    const payloadsNow = c.names().filter((n) => n === 'custom_payload').length;
    c.bc.cancel('cleanup'); // a no-op if it went out; keeps a broken build from hanging
    assert.equal(payloadsNow, 2, 'the payload went out at t0+650');
    assert.deepEqual(await now650, { sent: true, path: 'bettercombat', waitedMs: 0 });

    // Off: vanilla calls never wait, so there is nothing to cancel.
    const off = rig({ enabled: false });
    await off.bot.attack(off.target());
    assert.equal(off.bc.cancel('interrupt'), false);
    assert.deepEqual(off.names(), ['use_entity', 'arm_animation']);
});

test('wrapper: a different held item restarts the cooldown; a durability change does not', async () => {
    const r = rig();
    await r.bot.attack(r.target());
    await r.advance(1000); // the sword is ready again
    r.bot.emit('heldItemChanged', r.bot.heldItem); // durability: same item
    let res = await r.bot.attack(r.target());
    assert.equal(res.waitedMs, 0);
    await r.advance(1000);
    r.bot.heldItem = { name: 'stone_axe' };
    r.bot.entity.attributes['generic.attackSpeed'] = { value: 4, modifiers: [{ amount: -3.6, operation: 0 }] }; // 0.4
    r.bot.emit('heldItemChanged', r.bot.heldItem);
    const p = r.bot.attack(r.target());
    await r.advance(2499);
    assert.equal(r.names().filter((n) => n === 'custom_payload').length, 2);
    await r.advance(1);
    res = await p;
    assert.deepEqual(res, { sent: true, path: 'bettercombat', waitedMs: 2500 }, '50 ticks after the switch');
});

test('wrapper: vanilla only when off, or the server lacks the mod or the channel', async () => {
    const cases = [
        ['setting off', rig({ enabled: false })],
        ['no mod', rig({ mods: [{ modid: 'jei', version: '1' }] })],
        ['no channel', rig({ channels: ['FML|HS'] })],
    ];
    for (const [why, r] of cases) {
        const res = await r.bot.attack(r.target());
        assert.deepEqual(res, { sent: true, path: 'vanilla', waitedMs: 0 }, why);
        assert.deepEqual(r.names(), ['use_entity', 'arm_animation'], why);
    }
    assert.equal(cases[0][1].bc.status(), 'bettercombat attack: off (bc_attack), vanilla attack');
    assert.match(cases[2][1].bc.status(), /lacks the bettercombat channel/);
});

test('wrapper: with Better Combat active, nothing for a target out of its reach or sight', async () => {
    const unsent = (reason) => ({ sent: false, path: null, waitedMs: 0, reason });
    const sight = rig({ lineOfSight: () => false });
    assert.deepEqual(await sight.bot.attack(sight.target()), unsent('sight'));
    assert.deepEqual(sight.names(), [], 'no use_entity, no swing');
    assert.equal(sight.bc.stats.sight, 1);

    const sword = rig();
    assert.equal((await sword.bot.attack(sword.target(1, 4.2))).path, 'bettercombat', '3.9 from the eye: within 4.0');
    const far = rig();
    assert.deepEqual(await far.bot.attack(far.target(1, 4.5)), unsent('reach'), '4.2: beyond 4.0');
    assert.deepEqual(far.names(), []);
    assert.equal(far.bc.stats.reach, 1);
    const hand = rig({ held: null });
    assert.deepEqual(await hand.bot.attack(hand.target(1, 3.9)), unsent('reach'), 'empty hand: 3.6 beyond 3.5');
    const hand2 = rig({ held: null });
    assert.equal((await hand2.bot.attack(hand2.target(1, 3.6))).path, 'bettercombat', 'empty hand: 3.3');
    const handAxe = rig({ held: 'earthworks:tool_hand_axe' });
    assert.deepEqual(await handAxe.bot.attack(handAxe.target(1, 3.9)), unsent('reach'), 'a non-weapon by class: 3.5');
    const noPos = rig();
    assert.deepEqual(await noPos.bot.attack({ id: 5 }), unsent('reach'), 'no position: not shown to be in reach');
    assert.deepEqual(noPos.names(), []);

    // Checked again when a wait ends: the target walked out of reach meanwhile.
    const r = rig();
    await r.bot.attack(r.target());
    const mob = r.target(7);
    const p = r.bot.attack(mob);
    await r.advance(300);
    mob.position = mob.position.offset(0, 0, 3);
    await r.advance(350);
    assert.deepEqual(await p, { sent: false, path: null, waitedMs: 650, reason: 'reach' });
    assert.equal(r.names().filter((n) => n === 'custom_payload').length, 1);
    assert.equal(r.bc.stats.misses, 1, 'only the first hit had a check; reach is not a miss');
});

test('wrapper: an unknown attack speed sends Better Combat\'s packet at the slowest pacing (50 ticks)', async () => {
    const r = rig({ attackSpeed: null });
    assert.equal(r.bc.cooldownTicks(), 50);
    assert.equal((await r.bot.attack(r.target())).path, 'bettercombat');
    const p = r.bot.attack(r.target());
    await r.advance(2499);
    assert.equal(r.names().filter((n) => n === 'custom_payload').length, 1);
    await r.advance(1);
    assert.deepEqual(await p, { sent: true, path: 'bettercombat', waitedMs: 2500 });
});

test('wrapper: the vanilla fallback is paced, replaced and cancelled like Better Combat\'s path; off is not', async () => {
    const r = rig({ channels: ['FML|HS'] }); // stone sword: 13 ticks
    assert.equal((await r.bot.attack(r.target())).path, 'vanilla');
    const p1 = r.bot.attack(r.target(1));
    const p2 = r.bot.attack(r.target(2));
    assert.equal((await p1).reason, 'replaced');
    await r.advance(649);
    assert.equal(r.names().filter((n) => n === 'use_entity').length, 1, 'not before 650 ms');
    await r.advance(1);
    assert.deepEqual(await p2, { sent: true, path: 'vanilla', waitedMs: 650 });
    assert.deepEqual(r.bot.writes.filter((w) => w.name === 'use_entity').map((w) => w.params.target), [1234, 2]);
    const p3 = r.bot.attack(r.target());
    await r.advance(100);
    assert.equal(r.bc.cancel('interrupt'), true);
    assert.equal((await p3).reason, 'interrupt');
    await r.advance(2000);
    assert.equal(r.names().filter((n) => n === 'use_entity').length, 2, 'nothing after the cancel');
    // Out of Better Combat's reach on the fallback: vanilla as before (the server judges it), paced.
    assert.equal((await r.bot.attack(r.target(3, 5))).path, 'vanilla');

    const off = rig({ enabled: false });
    for (let i = 0; i < 3; i++) assert.deepEqual(await off.bot.attack(off.target()), { sent: true, path: 'vanilla', waitedMs: 0 });
    assert.equal(off.names().filter((n) => n === 'use_entity').length, 3, 'off: unpaced, as mineflayer sends it');
});

test('wrapper: the default line of sight uses the world raycast', async () => {
    const r = rig({ defaultSight: true });
    r.bot.world = { raycast: () => null };
    assert.equal((await r.bot.attack(r.target())).path, 'bettercombat');
    const blocked = rig({ defaultSight: true });
    blocked.bot.world = { raycast: () => ({ name: 'stone' }) };
    assert.equal((await blocked.bot.attack(blocked.target())).reason, 'sight');
    assert.deepEqual(blocked.names(), []);
    const noWorld = rig({ defaultSight: true });
    assert.equal((await noWorld.bot.attack(noWorld.target())).reason, 'sight', 'no world: no claim of sight');
});

test('self-check: five hits in a row without a hurt go back to vanilla; a hurt resets the count', async () => {
    const r = rig();
    for (let i = 0; i < 4; i++) { await r.bot.attack(r.target()); await r.advance(700); }
    assert.equal(r.bc.stats.misses, 4);
    await r.bot.attack(r.target());
    r.bot.emit('entityHurt', { id: 1234 });
    await r.advance(700);
    assert.equal(r.bc.tripped, false);
    for (let i = 0; i < 4; i++) { await r.bot.attack(r.target()); await r.advance(700); }
    assert.equal(r.bc.tripped, false, 'the hurt reset the count');
    await r.bot.attack(r.target());
    r.bot.emit('entityDead', { id: 1234 });
    await r.advance(700);
    assert.equal(r.bc.tripped, false, 'a death counts as a hurt');

    const t = rig();
    for (let i = 0; i < 5; i++) { await t.bot.attack(t.target()); await t.advance(700); }
    assert.equal(t.bc.tripped, true);
    assert.deepEqual(t.lines, ['bettercombat attack: 5 hits without a hurt, back to vanilla for this connection']);
    t.bot.writes.length = 0;
    assert.equal((await t.bot.attack(t.target())).path, 'vanilla');
    assert.deepEqual(t.names(), ['use_entity', 'arm_animation']);
    // Tripped: the vanilla fallback, paced from its own swing.
    const next = t.bot.attack(t.target());
    assert.equal(t.names().length, 2, 'the next one waits');
    await t.advance(650);
    assert.deepEqual(await next, { sent: true, path: 'vanilla', waitedMs: 650 });
});

test('self-check: a drop in the target\'s health metadata within 500 ms is a hurt (#540: no entity_status 2)', async () => {
    // 1.12 EntityLivingBase health is metadata 7; mineflayer merges entity_metadata, then emits entityUpdate.
    const r = rig();
    const mob = { ...r.target(), metadata: { 7: 20 } };
    for (let i = 0; i < 5; i++) {
        await r.bot.attack(mob);
        await r.advance(100);
        mob.metadata[7] -= 2.733; // the hit lowered the health; no status packet came
        r.bot.emit('entityUpdate', mob);
        await r.advance(600);
    }
    assert.equal(r.bc.stats.misses, 0);
    assert.equal(r.bc.tripped, false, 'five real hits with no status packet do not trip it');

    // Not a hurt: an update with the same health, a rise, another entity's drop, or no health known at the hit.
    const n = rig();
    const same = { ...n.target(), metadata: { 7: 20 } };
    await n.bot.attack(same);
    n.bot.emit('entityUpdate', same);
    same.metadata[7] = 20.5;
    n.bot.emit('entityUpdate', same);
    n.bot.emit('entityUpdate', { id: 99, metadata: { 7: 1 } });
    await n.advance(700);
    assert.equal(n.bc.stats.misses, 1);
    const unknown = { ...n.target(), metadata: {} };
    await n.bot.attack(unknown);
    unknown.metadata[7] = 5;
    n.bot.emit('entityUpdate', unknown);
    await n.advance(700);
    assert.equal(n.bc.stats.misses, 2, 'no health at the hit: nothing to compare');
    // A drop after the 500 ms window is too late.
    const late = { ...n.target(), metadata: { 7: 20 } };
    await n.bot.attack(late);
    await n.advance(600);
    late.metadata[7] = 10;
    n.bot.emit('entityUpdate', late);
    assert.equal(n.bc.stats.misses, 3);
    // mineflayer's entity.health wins over the metadata when it is set.
    const h = rig();
    const player = { ...h.target(), health: 18, metadata: { 7: 18 } };
    await h.bot.attack(player);
    player.health = 15;
    h.bot.emit('entityUpdate', player);
    await h.advance(700);
    assert.equal(h.bc.stats.misses, 0);
});

test('wrapper: installs after mineflayer injects bot.attack; the end resolves a waiting call', async () => {
    const r = rig({ defineAttack: false });
    assert.equal(r.bot.attack, undefined);
    r.bot.attack = r.vanilla; // mineflayer's plugins inject first
    r.bot.emit('inject_allowed');
    assert.equal(r.bot.attackVanilla, r.vanilla);
    assert.notEqual(r.bot.attack, r.vanilla);
    await r.bot.attack(r.target());
    const p = r.bot.attack(r.target());
    r.bot.emit('end');
    assert.deepEqual(await p, { sent: false, path: null, waitedMs: 0, reason: 'ended' });
    assert.equal(r.clock.timers.filter((h) => !h.cleared).length, 0, 'no timer left');
});

test('G1 Run A: the real server registered bettercombat, and our echoed REGISTER carried it', () => {
    const dir = new URL('./fixtures/rotn-3.3.4/', import.meta.url);
    const index = JSON.parse(fs.readFileSync(new URL('handshake-runA.json', dir), 'utf8'));
    const raw = zlib.brotliDecompressSync(fs.readFileSync(new URL('handshake-runA.bin.br', dir)));
    let off = 0;
    const register = {};
    for (const r of index.records) {
        const data = raw.subarray(off, off + r.len);
        off += r.len;
        if (r.channel === 'REGISTER') register[r.dir] = decodeRegister(data);
    }
    assert.ok(register.S2C.includes(BC_CHANNEL), 'the server has the channel');
    assert.ok(register.C2S.includes(BC_CHANNEL), 'and we registered it back');
});
