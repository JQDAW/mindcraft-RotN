// Soak 14: a starvation death left Hunger Overhaul's Mining Fatigue IV in bot.entity.effects, so
// after the respawn every dig time read it (dirt by hand 926 s) and digs hung. patches/mineflayer
// (entities.js) drops the effects on every respawn packet, as the vanilla client's new player
// entity has none; forge-bridge logs what was dropped. These tests run mineflayer's real
// entities and digging plugins on a fake client, with the Forge dig-time rule from the dump.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { attachDigTime, dumpDigSources } from '../src/dig-time.js';
import { attachRespawnEffectsLog, effectList } from '../src/respawn-effects.js';
import * as rotnData from '../../rotn-data/index.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const rd = rotnData.loadRotnData(rotnData.PACK_VERSION);

const BOT_ID = 42;
const MINING_FATIGUE = 4; // 1.12.2 effect ids
const SLOWNESS = 2;
const DIRT_AT = new Vec3(8, 64, 8);

/** A fake client and bot with mineflayer's real entities and digging plugins, the Forge rule, and dirt at DIRT_AT. */
function botWithPlugins() {
    const registry = require('prismarine-registry')('1.12.2');
    const Chunk = require('prismarine-chunk')(registry);
    const chunk = new Chunk();
    chunk.setBlockType(DIRT_AT, registry.blocksByName.dirt.id);
    const bot = new EventEmitter();
    bot.version = '1.12.2';
    bot.registry = registry;
    bot.supportFeature = () => false;
    bot.writes = [];
    bot._client = new EventEmitter();
    bot._client.write = (name, data) => bot.writes.push([name, data]);
    bot.blockAt = (pos) => {
        const b = chunk.getBlock(pos);
        b.position = pos.clone();
        return b;
    };
    // The dig resolves on the client's own predicted air (finishDigging), as in mineflayer's blocks plugin.
    bot._updateBlockState = (pos, stateId) => {
        const old = bot.blockAt(pos);
        chunk.setBlockStateId(pos, stateId);
        bot.emit(`blockUpdate:${pos}`, old, bot.blockAt(pos));
    };
    bot.game = { gameMode: 'survival' };
    bot.heldItem = null;
    bot.inventory = { slots: [], items: () => [] };
    bot.getEquipmentDestSlot = () => 5;
    bot.swingArm = () => {};
    bot.lookAt = async () => {};
    require('mineflayer/lib/plugins/entities.js')(bot);
    require('mineflayer/lib/plugins/digging.js')(bot);
    bot._client.emit('login', { entityId: BOT_ID });
    bot.entity.onGround = true;
    bot.entity.position = new Vec3(8.5, 65, 8.5);
    const report = attachDigTime(bot, dumpDigSources(rd, registry), { log: () => {} });
    bot.emit('chunkColumnLoad', new Vec3(0, 0, 0));
    assert.equal(report.installed, true);
    return bot;
}

/** The block_dig packets sent (mineflayer's swings are left out). */
const digs = (bot) => bot.writes.filter(([n]) => n === 'block_dig').map(([, d]) => `status ${d.status}`);
const effect = (bot, effectId, amplifier) => bot._client.emit('entity_effect', { entityId: BOT_ID, effectId, amplifier, duration: 19, hideParticles: 1 });
const respawn = (bot) => bot._client.emit('respawn', { dimension: 0, difficulty: 2, gamemode: 0, levelType: 'default' });

test('respawn: Mining Fatigue IV makes dirt by hand 926 s; the respawn packet drops it (750 ms); an effect sent after the respawn is kept', () => {
    const bot = botWithPlugins();
    const dirt = bot.blockAt(DIRT_AT);
    assert.equal(bot.digTime(dirt), 750, 'dirt by hand');
    effect(bot, MINING_FATIGUE, 3); // Hunger Overhaul at food 1 or less, difficulty normal
    effect(bot, SLOWNESS, 1);
    assert.equal(bot.digTime(dirt), 925950, 'x 0.00081: 18,519 ticks (the soak\'s 926 s)');

    const ended = [];
    const cleared = [];
    bot.on('entityEffectEnd', (entity, e) => ended.push([entity === bot.entity, e.id, e.amplifier]));
    bot.on('respawnEffectsCleared', (list) => cleared.push(list.map((e) => e.id)));
    respawn(bot);
    assert.deepEqual(bot.entity.effects, {}, 'the new player entity has no effects');
    assert.deepEqual(ended, [[true, SLOWNESS, 1], [true, MINING_FATIGUE, 3]], 'entityEffectEnd for each');
    assert.deepEqual(cleared, [[SLOWNESS, MINING_FATIGUE]]);
    assert.equal(bot.digTime(dirt), 750, 'dirt by hand again');

    effect(bot, MINING_FATIGUE, 0); // sent after the respawn: a real effect of the new entity
    assert.equal(bot.entity.effects[MINING_FATIGUE]?.amplifier, 0, 'kept');
    assert.equal(bot.digTime(dirt), 2500, 'x 0.3');
    bot._client.emit('remove_entity_effect', { entityId: BOT_ID, effectId: MINING_FATIGUE });
    assert.equal(bot.digTime(dirt), 750, 'remove_entity_effect still ends it');

    respawn(bot); // nothing to drop: no event
    assert.equal(cleared.length, 1);
});

test('respawn: bot.dig on dirt waits out a stale fatigue; after the respawn it finishes in about 750 ms with a STOP', async () => {
    const bot = botWithPlugins();
    effect(bot, MINING_FATIGUE, 3);
    const stale = bot.dig(bot.blockAt(DIRT_AT), true).then(() => 'dug', (err) => err.message);
    const early = await Promise.race([stale, new Promise((resolve) => setTimeout(() => resolve('still digging'), 1000))]);
    const startsSent = digs(bot);
    bot.stopDigging(); // before any assertion: a failure must not leave the dig's swing interval running
    assert.equal(early, 'still digging', 'the soak\'s hang: mineflayer waits 926 s before its STOP');
    assert.deepEqual(startsSent, ['status 0'], 'START only, no STOP');
    assert.equal(await stale, 'Digging aborted');

    respawn(bot);
    bot.writes.length = 0;
    const started = Date.now();
    const fresh = bot.dig(bot.blockAt(DIRT_AT), true).then(() => 'dug', (err) => err.message);
    const result = await Promise.race([fresh, new Promise((resolve) => setTimeout(() => resolve('still digging after 5 s'), 5000))]);
    const took = Date.now() - started;
    bot.stopDigging(); // a no-op once dug; without the fix it ends the 926 s dig
    assert.equal(result, 'dug');
    // #610 review 4: the lower bound is mineflayer's own 750 ms timer; the upper bound leaves a loaded runner
    // room (the stale effect would make it 926 s).
    assert.ok(took >= 700 && took < 4000, `dug in ${took} ms`);
    assert.deepEqual(digs(bot), ['status 0', 'status 2'], 'START, then STOP');
});

test('forge-bridge logs the effects a respawn dropped, once per respawn, only when there were any', () => {
    const bot = botWithPlugins();
    const logs = [];
    const report = attachRespawnEffectsLog(bot, { log: (m) => logs.push(m) });
    assert.equal(attachRespawnEffectsLog(bot, { log: () => assert.fail('attached twice') }), report, 'once per bot');
    respawn(bot);
    assert.deepEqual(logs, [], 'no effects, no line');
    effect(bot, MINING_FATIGUE, 3);
    effect(bot, 300, 1); // an id the registry does not name (REID)
    respawn(bot);
    assert.deepEqual(logs, ['respawn: dropped stale effects MiningFatigue:3 300:1 (effect:amplifier; the new player entity has none)']);
    assert.deepEqual(report, { respawns: 1, dropped: 2 });
    assert.equal(effectList(bot.registry, [{ id: 2, amplifier: 1 }]), 'Slowness:1');
});
