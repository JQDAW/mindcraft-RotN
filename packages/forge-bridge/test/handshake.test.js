// The outgoing handshake sequence, against server messages built from the
// pinned RotN 3.3.4 ModList. Replaced by real captured server messages once the
// G1 Run B capture exists (fixtures/rotn-3.3.4/handshake.jsonl).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as hs from '../src/fml-hs.js';
import { ClientHandshake, ClientState, CORE_CHANNELS } from '../src/handshake.js';
import { decodeRegister, encodeRegister } from '../src/channels.js';
import { pinnedModList, syntheticRegistries } from './helpers.js';

function serverScript(mods, registries) {
    // What a Forge server sends, in order, given a compliant client
    // (FMLHandshakeServerState: START, HELLO, WAITINGCACK, COMPLETE).
    return {
        hello: hs.encodeServerHello(2, 0),
        modList: hs.encodeModList(mods),
        registries: registries.map((r, i) => hs.encodeRegistryData({ ...r, hasMore: i < registries.length - 1 })),
        ack2: hs.encodeAck(2),
        ack3: hs.encodeAck(3),
    };
}

function makeClient(mods, channels) {
    const out = [];
    const c = new ClientHandshake({ modList: mods, send: (channel, data) => out.push({ channel, data }), channels });
    return { c, out };
}

test('client sends exactly REGISTER, ClientHello, ModList, ack 2, 3, 4, 5', () => {
    const mods = pinnedModList();
    const regs = syntheticRegistries();
    const s = serverScript(mods, regs);
    const { c, out } = makeClient(mods);
    const events = [];
    c.on('complete', () => events.push('complete'));
    c.on('registries', (snap) => events.push(`registries:${snap.names().length}`));

    c.handle(hs.decodeHandshake(s.hello));
    assert.equal(c.state, ClientState.WAITINGSERVERDATA);
    assert.equal(out.length, 3);
    c.handle(hs.decodeHandshake(s.modList));
    assert.equal(out.length, 4);
    for (const r of s.registries) c.handle(hs.decodeHandshake(r));
    assert.equal(out.length, 5, 'ack 3 only after the last RegistryData');
    c.handle(hs.decodeHandshake(s.ack2));
    c.handle(hs.decodeHandshake(s.ack3));
    assert.equal(c.state, ClientState.DONE);

    assert.deepEqual(out.map(o => o.channel), ['REGISTER', 'FML|HS', 'FML|HS', 'FML|HS', 'FML|HS', 'FML|HS', 'FML|HS']);
    assert.deepEqual(decodeRegister(out[0].data), CORE_CHANNELS);
    assert.deepEqual(out[1].data, hs.encodeClientHello(2));
    assert.deepEqual(out[2].data, hs.encodeModList(mods), 'our ModList is the server list, byte for byte');
    assert.deepEqual(out.slice(3).map(o => [...o.data]), [[0xff, 2], [0xff, 3], [0xff, 4], [0xff, 5]]);
    assert.deepEqual(c.sent.map(s => s.kind), ['REGISTER', 'ClientHello', 'ModList', 'Ack2', 'Ack3', 'Ack4', 'Ack5']);
    assert.deepEqual(events, [`registries:${regs.length}`, 'complete']);
    assert.equal(c.modDiff.equal, true);
});

test('registry snapshot exposes name <-> id maps for modded entries', () => {
    const mods = pinnedModList();
    const s = serverScript(mods, syntheticRegistries());
    const { c } = makeClient(mods);
    c.handle(hs.decodeHandshake(s.hello));
    c.handle(hs.decodeHandshake(s.modList));
    for (const r of s.registries) c.handle(hs.decodeHandshake(r));
    const reg = c.registries;
    assert.equal(reg.complete, true);
    assert.equal(reg.idOf('minecraft:blocks', 'pyrotech:rock'), 4001);
    assert.equal(reg.nameOf('minecraft:items', 5003), 'pyrotech:crude_axe');
    assert.equal(reg.idOf('minecraft:entities', 'iceandfire:dragon'), 300);
    assert.ok(reg.get('minecraft:items').dummied.has('oldmod:gone'));
    assert.equal(reg.get('minecraft:items').overrides.get('minecraft:stick'), 'somemod');
    assert.deepEqual(reg.namespaces('minecraft:blocks'), { minecraft: 3, pyrotech: 2 });
    assert.equal(reg.sizes()['minecraft:biomes'], 2);
});

test('REGISTER echoes the server channels when a channel source is given', () => {
    const mods = pinnedModList();
    const serverChannels = ['FML|HS', 'FML', 'FML|MP', 'FML', 'FORGE', 'jeid', 'pyrotech'];
    const { c, out } = makeClient(mods, () => [...new Set([...CORE_CHANNELS, ...serverChannels])]);
    c.handle(hs.decodeHandshake(hs.encodeServerHello()));
    assert.deepEqual(decodeRegister(out[0].data), ['FML|HS', 'FML', 'FML|MP', 'FORGE', 'jeid', 'pyrotech']);
    assert.equal(encodeRegister(['a', 'b', 'a']).toString(), 'a\0b');
});

test('out-of-order messages do not advance the state machine', () => {
    const mods = pinnedModList();
    const { c, out } = makeClient(mods);
    const seen = [];
    c.on('unexpected', (u) => seen.push(u));
    c.handle(hs.decodeHandshake(hs.encodeModList(mods))); // ModList before ServerHello
    assert.equal(c.state, ClientState.HELLO);
    assert.equal(out.length, 0);
    assert.deepEqual(seen, [{ state: 'HELLO', message: 'ModList' }]);
    c.handle(hs.decodeHandshake(hs.encodeServerHello()));
    c.handle(hs.decodeHandshake(hs.encodeAck(2))); // ack before the server ModList
    assert.equal(c.state, ClientState.WAITINGSERVERDATA);
    assert.equal(out.length, 3);
});

test('HandshakeReset in DONE returns to HELLO and clears registries', () => {
    const mods = pinnedModList();
    const s = serverScript(mods, syntheticRegistries());
    const { c, out } = makeClient(mods);
    for (const b of [s.hello, s.modList, ...s.registries, s.ack2, s.ack3]) c.handle(hs.decodeHandshake(b));
    assert.equal(c.state, ClientState.DONE);
    c.handle(hs.decodeHandshake(hs.encodeReset()));
    assert.equal(c.state, ClientState.HELLO);
    assert.equal(c.registries.names().length, 0);
    c.handle(hs.decodeHandshake(s.hello));
    assert.equal(out.length, 7 + 3, 'a fresh REGISTER, ClientHello and ModList');
});

test('server ModList that differs is reported, not fatal on the client', () => {
    const mods = pinnedModList();
    const { c } = makeClient(mods);
    let diff = null;
    c.on('serverModList', (e) => { diff = e.diff; });
    c.handle(hs.decodeHandshake(hs.encodeServerHello()));
    c.handle(hs.decodeHandshake(hs.encodeModList(mods.filter(m => m.modid !== 'jeid'))));
    assert.deepEqual(diff.extraOnClient, ['jeid']);
    assert.equal(c.state, ClientState.WAITINGSERVERCOMPLETE);
});
