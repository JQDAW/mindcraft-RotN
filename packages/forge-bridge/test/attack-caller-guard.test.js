// #653 review 1 (c): the attack lines name the code that called bot.attack, not skills-rotn's guard above
// the bridge (#652's installAttackGuard, src/agent/library/hands.js), for a direct hit and for one
// mineflayer-pvp sends from its tick. Offline; the guard and its threat lookup are the real ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { attachAttackCounts } from '../src/attack-counts.js';
import { installBetterCombatAttack } from '../src/bettercombat.js';
import { attachPvpCallers } from '../src/attack-caller.js';
import { installAttackGuard, noteAttackTarget } from '../../../src/agent/library/hands.js';

test('with #652\'s real guard on top: the line names selfDefense and attackEntity (via mineflayer-pvp), never "guarded hands.js"', async () => {
    const bot = new EventEmitter();
    const clock = { t: 10_000, timers: [] };
    bot._client = { write: () => {} };
    // mineflayer's vanilla attack, with a sourceURL under node_modules/mineflayer (its frame is skipped).
    bot.attack = new Function('bot', 'return function attack(target) { bot._client.write(\'use_entity\', { target: target.id, mouse: 1 }); };\n//# sourceURL=/w/node_modules/mineflayer/lib/plugins/entities.js')(bot);
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
    const logs = [];
    const minute = { cb: null };
    attachAttackCounts(bot, {
        stats: () => bc.stats, caller: () => bc.firingCaller, takeReplacements: () => bc.takeReplacements(), log: (m) => logs.push(m),
        setTimer: (cb) => { minute.cb = cb; return {}; }, clearTimer: () => {},
    });
    // mineflayer-pvp: attack(target) sets the target; its physicsTick update calls bot.attack (frames in its package).
    bot.pvp = { target: null, attack(target) { this.target = target; } };
    bot.on('physicsTick', new Function('bot', 'return function update() { if (bot.pvp.target) bot.attack(bot.pvp.target); };\n//# sourceURL=/w/node_modules/mineflayer-pvp/lib/PVP.js')(bot));
    attachPvpCallers(bot);
    const at = (id, name, z = 2) => { const e = { id, name, position: new Vec3(0, 64, z), width: 0.6, height: 1.95 }; (bot.entities ??= {})[id] = e; return e; };
    const zombie = at(77, 'zombie');
    const hen = at(1234, 'animania:hen_rhode_island_red');
    const reactions = { 77: 'hostile', 1234: 'ignore-unless-provoked' };
    const saved = console.log;
    const said = [];
    console.log = (m) => { said.push(m); };
    try {
        installAttackGuard(bot, { threatFor: (e) => ({ reaction: reactions[e.id] }) });
        assert.equal(bot.attack.rotnGuard, true, 'the real guard is on top of the bridge\'s wrapper');
        // A direct hit on a hostile: never refused.
        function selfDefense() { return bot.attack(zombie); }
        assert.equal((await selfDefense()).sent, true);
        await advance(700);
        // The hen, named by the skill for the guard, hit by mineflayer-pvp from its tick.
        function attackEntity(e) { noteAttackTarget(bot, e, 'attackEntity'); bot.pvp.attack(e); }
        attackEntity(hen);
        bot.emit('physicsTick');
        await advance(700);
        // A hen hit nobody named: the guard refuses it, and no packet goes out.
        bot.pvp.target = null;
        noteAttackTarget(bot, { id: 999 }, 'someoneElse');
        function stray() { return bot.attack(hen); }
        assert.equal((await stray()).reason, 'guard');
    } finally { console.log = saved; }
    minute.cb();
    assert.equal(logs.length, 1);
    const tail = logs[0].slice(logs[0].indexOf('; targets '));
    assert.match(tail, /^; targets zombie#77 x1 \(selfDefense attack-caller-guard\.test\.js:\d+(?: < [^)]+)?\), animania:hen_rhode_island_red#1234 x1 \(attackEntity attack-caller-guard\.test\.js:\d+(?: < [^)]+)? via mineflayer-pvp\)$/);
    assert.doesNotMatch(logs[0], /guarded|hands\.js/, 'the guard\'s frame is skipped');
    assert.ok(said.some((l) => /^\[attack\] refused: animania:hen_rhode_island_red#1234/.test(l)), 'the guard refused the stray hit');
});
