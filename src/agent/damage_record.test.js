// #453 review 1: what caused the last damage (a fall, starving), so threats.js never takes it for an animal's hit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { bindDamageRecord, FALL } from './damage_record.js';

function fakeBot() {
    const bot = new EventEmitter();
    Object.assign(bot, { health: 20, food: 12, entity: { position: new Vec3(0, 70, 0), onGround: true } });
    bindDamageRecord(bot);
    const move = (y, onGround) => { bot.entity.position = new Vec3(0, y, 0); bot.entity.onGround = onGround; bot.emit('move'); };
    const hurt = (n) => { bot.health -= n; bot.emit('health'); };
    return { bot, move, hurt };
}

test('#453 review 1: a drop of more than 3 blocks just before the damage is a fall; a hit on flat ground is not', () => {
    assert.deepEqual(FALL, { minDrop: 3, landedMs: 1000 });
    const { bot, move, hurt } = fakeBot();
    move(70, false); move(66, false); move(65, true); // left the ground at 70, landed at 65
    hurt(2);
    assert.equal(bot.lastDamageCause, 'fall');
    assert.equal(bot.lastDamageTaken, 2);
    // Still in the air, 5 below where it left the ground (the health update came first).
    const air = fakeBot();
    air.move(70, false); air.move(64, false);
    air.hurt(3);
    assert.equal(air.bot.lastDamageCause, 'fall');
    // A jump (a drop of 1) and then a hit: a mob's.
    const jump = fakeBot();
    jump.move(71, false); jump.move(70, true);
    jump.hurt(2);
    assert.equal(jump.bot.lastDamageCause, null);
});

test('#453 review 1: food 0 and 1 damage is starving; a death clears the cause', () => {
    const { bot, hurt } = fakeBot();
    bot.food = 0;
    hurt(1);
    assert.equal(bot.lastDamageCause, 'starving');
    bot.food = 0;
    hurt(3);
    assert.equal(bot.lastDamageCause, null, 'more than 1 at food 0: something hit it');
    bot.emit('death');
    assert.deepEqual([bot.lastDamageTime, bot.lastDamageTaken, bot.lastDamageCause], [0, 0, null]);
});
