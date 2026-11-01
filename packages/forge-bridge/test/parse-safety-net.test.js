// The parse safety net (bridge.js DROPPABLE_ON_PARSE_ERROR), through nmp's real
// deserializer stream. Its own file, so its process never merges the Triumph
// override: here advancements keep minecraft-data's vanilla layout and the real
// G1 Batch C packets fail with a genuine non-partial error ("unexpected tag end").
// Offline.

import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers';
import { attachForgeBridge, DROPPABLE_ON_PARSE_ERROR } from '../src/bridge.js';
import { pinnedModList } from './helpers.js';
import { realAdvancementsPackets } from './fake-world.js';

const require = createRequire(import.meta.url);
const { createDeserializer } = require('minecraft-protocol/src/transforms/serializer');

const KEEP_ALIVE = Buffer.from('1f0000000000000539', 'hex'); // id 0x1f, keepAliveId 1337 (i64)

// set_slot (essential) whose item NBT has a tag name containing NUL: the same
// non-partial "unexpected tag end" error, in a packet that must not be dropped.
const BAD_SET_SLOT = Buffer.from([
    0x16, 0x00, 0x00, 0x24, // id, windowId 0, slot 36
    0x01, 0x01, 0x00, 0x00, // REID VarInt item 1, count 1, damage 0
    0x0a, 0x00, 0x00, // TAG_Compound, empty root name
    0x01, 0x00, 0x01, 0x00, 0x00, // TAG_Byte named "\0", value 0
    0x00, // TAG_End
]);

// A fake nmp client whose deserializer is nmp's real one; attachForgeBridge wraps it.
function bridgedStream(modList) {
    const client = new EventEmitter();
    client.write = () => true;
    client.setSerializer = function (state) {
        this.deserializer = createDeserializer({ state, isServer: false, version: '1.12.2', customPackets: this.customPackets });
    };
    const logs = [];
    const bridge = attachForgeBridge(client, { modList, log: (m) => logs.push(m) });
    client.setSerializer('play');
    const seen = [];
    let error = null;
    client.deserializer.on('data', (p) => seen.push(p.data.name));
    client.deserializer.on('error', (e) => { error = e; });
    const feed = (bufs) => new Promise((resolve) => {
        for (const b of bufs) client.deserializer.write(b);
        setImmediate(resolve);
    });
    return { bridge, seen, logs, feed, error: () => error };
}

const withoutTriumph = () => pinnedModList().filter((m) => m.modid !== 'triumph');

test('the allowlist is cosmetic packets only', () => {
    for (const name of ['advancements', 'statistics', 'unlock_recipes']) assert.ok(DROPPABLE_ON_PARSE_ERROR.has(name), name);
    for (const name of ['map_chunk', 'keep_alive', 'set_slot', 'window_items', 'position', 'spawn_entity_living', 'entity_metadata', 'custom_payload', 'chat', 'kick_disconnect']) {
        assert.equal(DROPPABLE_ON_PARSE_ERROR.has(name), false, name);
    }
});

test('a malformed allowlisted packet (real Triumph advancements, vanilla layout) is dropped and the next keep_alive still parses', async () => {
    const s = bridgedStream(withoutTriumph());
    assert.equal(s.bridge.triumph, null, 'no Triumph override in this process');
    const [adv0, adv1] = realAdvancementsPackets();
    await s.feed([adv0, adv1, KEEP_ALIVE]);
    assert.equal(s.error(), null, 'the stream did not end');
    assert.deepEqual(s.seen, ['keep_alive']);
    assert.equal(s.bridge.stats.droppedPackets.advancements, 1, 'the non-partial one was dropped by the safety net');
    assert.ok(s.logs.some((l) => /parse error in play\.advancements/.test(l)));
});

test('a malformed essential packet still fails loudly: the stream ends', async () => {
    const s = bridgedStream(withoutTriumph());
    await s.feed([BAD_SET_SLOT, KEEP_ALIVE]);
    assert.ok(s.error(), 'set_slot parse error reaches the client');
    assert.match(s.error().message, /unexpected tag end/);
    assert.equal(s.bridge.stats.droppedPackets.set_slot, undefined);
    assert.deepEqual(s.seen, [], 'nothing after it is delivered');
});

// PR #28 review follow-ups.
test('world_particles (fishing) and title (invasion warnings) are not droppable', () => {
    assert.equal(DROPPABLE_ON_PARSE_ERROR.has('world_particles'), false);
    assert.equal(DROPPABLE_ON_PARSE_ERROR.has('title'), false);
});

test('a drop is logged as "(dropped, allowlisted)" and emits droppedPacket once per packet name', async () => {
    const s = bridgedStream(withoutTriumph());
    const events = [];
    s.bridge.on('droppedPacket', (e) => events.push(e));
    const [, adv1] = realAdvancementsPackets();
    await s.feed([adv1, adv1, adv1, KEEP_ALIVE]);
    assert.equal(s.bridge.stats.droppedPackets.advancements, 3);
    assert.equal(events.length, 1, 'once per name, not per packet');
    assert.equal(events[0].name, 'advancements');
    assert.match(events[0].message, /unexpected tag end/);
    assert.ok(s.logs.some((l) => /parse error in play\.advancements \(\d+ bytes\) \(dropped, allowlisted\)/.test(l)));
    assert.deepEqual(s.seen, ['keep_alive']);
});

test('documented: a PartialReadError on an essential packet is dropped by protodef, and the bridge makes it visible', async () => {
    const s = bridgedStream(withoutTriumph());
    const parseErrors = [];
    s.bridge.on('parseError', (e) => parseErrors.push(e.name));
    await s.feed([Buffer.from('1f0000', 'hex'), KEEP_ALIVE]); // keep_alive cut short, then a good one
    assert.equal(s.error(), null, 'protodef drops partial reads; the stream continues');
    assert.deepEqual(s.seen, ['keep_alive']);
    assert.equal(s.bridge.stats.partialReadErrors, 1);
    assert.deepEqual(parseErrors, ['keep_alive']);
    assert.equal(s.bridge.stats.droppedPackets.keep_alive, undefined, 'not the safety net: protodef dropped it');
    assert.ok(s.logs.some((l) => /PartialReadError in play\.keep_alive .*\(dropped by protodef\)/.test(l)));
});
