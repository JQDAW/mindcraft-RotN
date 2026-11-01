// attachForgeBridge: turns a node-minecraft-protocol client into a Forge 1.12.2
// (FML protocol 2) client (ADR 0003 decision 1). Call it before the socket
// connects: it sets tagHost, which nmp appends to the handshake host.

import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { HS_CHANNEL, decodeHandshake } from './fml-hs.js';
import { ClientHandshake, CORE_CHANNELS } from './handshake.js';
import { decodeRegister, decodeFml, decodeForge, decodeJeid, MultipartAssembler } from './channels.js';
import { hasReid, findMod, REID_MODID } from './modlist.js';
import { buildCustomPackets, createTypeReader, reidEffectIdFromTail, rotnMetadataSerializers, MC_VERSION } from './reid.js';
import { classifyKick, classifySocketError } from './kicks.js';

const require = createRequire(import.meta.url);

export const FML_TAG = '\0FML\0';

const DEFAULT_CAPTURED_PACKETS = {
    login: 5, map_chunk: 40, window_items: 50, set_slot: 300,
    entity_effect: 100, remove_entity_effect: 100, kick_disconnect: 5,
    spawn_entity_living: 100, spawn_entity: 100, entity_metadata: 300, open_window: 20,
};
const DEFAULT_CAPTURED_C2S = { window_click: 50, set_creative_slot: 20, held_item_slot: 20 };

const RING_SIZE = 200;

/**
 * @param {import('minecraft-protocol').Client} client  nmp client, not yet connected
 * @param {object} opts
 * @param {{modid:string,version:string}[]} opts.modList  the server's mod list (ping or fixture)
 * @param {import('./capture.js').CaptureWriter} [opts.capture]
 * @param {boolean} [opts.echoServerChannels=true]  register the server's channels back, like a modded client
 * @param {(msg:string)=>void} [opts.log]
 * @param {string} [opts.version]
 */
export function attachForgeBridge(client, opts) {
    const {
        modList, capture = null, echoServerChannels = true,
        log = (m) => console.log(`[forge-bridge] ${m}`),
        version = MC_VERSION,
        capturedPackets = DEFAULT_CAPTURED_PACKETS,
        capturedC2S = DEFAULT_CAPTURED_C2S,
        // Extra entity-metadata serializer ids, { id: name } (reid.js METADATA_SERIALIZER_TYPES),
        // e.g. 15-18 from rotn-data's dumper. Merged over rotnMetadataSerializers(modList).
        metadataSerializers: extraSerializers = {},
    } = opts;
    if (!Array.isArray(modList) || modList.length === 0) throw new Error('attachForgeBridge: modList is required');

    const bridge = new EventEmitter();
    const reid = hasReid(modList);
    bridge.reid = reid ? findMod(modList, REID_MODID) : null;
    // Triumph's ExtendedDisplayInfo changes play.advancements (reid.js triumphTypes).
    bridge.triumph = findMod(modList, 'triumph') ?? null;
    bridge.metadataSerializers = { ...rotnMetadataSerializers(modList), ...extraSerializers };
    bridge.modList = modList;
    bridge.serverChannels = [];
    bridge.serverMods = null;
    bridge.registries = null;
    bridge.overrideDimension = 0;
    bridge.lastKick = null;
    bridge.ring = [];
    bridge.stats = {
        payloadsIn: 0, payloadsOut: 0, byChannel: {},
        parseErrors: 0, partialReadErrors: 0, partialPackets: {}, droppedPackets: {},
        entitySpawns: 0, openGuis: 0, jeidMessages: 0, reidEffectTails: 0,
    };
    bridge.handshakeDone = false;

    // 1. Handshake marker and protocol overrides (must precede Login Success).
    client.tagHost = FML_TAG;
    client.customPackets = mergeCustom(client.customPackets, buildCustomPackets({ reid, triumph: !!bridge.triumph, version, metadataSerializers: bridge.metadataSerializers }));
    const typeReader = createTypeReader({ reid, version, metadataSerializers: bridge.metadataSerializers });
    log(`attached; ${modList.length} mods; REID ${reid ? bridge.reid.version : 'absent'}; Triumph ${bridge.triumph ? bridge.triumph.version : 'absent'}`);
    capture?.event('bridge_attached', { mods: modList.length, reid: bridge.reid, triumph: bridge.triumph, version });

    if (capture) {
        Object.assign(capture.packetLimits, capturedPackets);
        for (const [name, limit] of Object.entries(capturedC2S)) capture.packetLimits[`C2S:${name}`] = limit;
    }

    const send = (channel, data) => client.write('custom_payload', { channel, data });

    const handshake = new ClientHandshake({
        modList,
        send,
        channels: () => echoServerChannels && bridge.serverChannels.length
            ? [...new Set([...CORE_CHANNELS, ...bridge.serverChannels])]
            : CORE_CHANNELS,
    });
    bridge.handshake = handshake;
    handshake.on('state', (s) => { capture?.event('hs_state', s); bridge.emit('handshakeState', s); });
    handshake.on('unexpected', (u) => { log(`unexpected ${u.message} in ${u.state}`); capture?.event('hs_unexpected', u); });
    handshake.on('serverModList', ({ mods, diff }) => {
        bridge.serverMods = mods;
        if (!diff.equal) log(`server ModList differs from ours: ${JSON.stringify(diff).slice(0, 400)}`);
        const serverReid = hasReid(mods);
        if (serverReid !== reid) {
            log(`REID mismatch: server ${serverReid ? 'has' : 'lacks'} '${REID_MODID}', overrides ${reid ? 'on' : 'off'}`);
            capture?.event('reid_mismatch', { serverReid, clientReid: reid });
            bridge.emit('reidMismatch', { serverReid, clientReid: reid });
        }
        capture?.event('server_modlist', { count: mods.length, diff });
    });
    handshake.on('registries', (snap) => {
        // The Forge-registry serializer ids (>= 256) were fixed before the protocol was
        // compiled; check them against what the server synced and say so if they differ.
        for (const [id, name] of Object.entries(bridge.metadataSerializers)) {
            if (Number(id) < 256) continue;
            const synced = snap.nameOf('minecraft:dataserializers', Number(id));
            if (synced !== name) {
                log(`entity-metadata serializer ${id}: expected ${name}, server synced ${synced ?? 'nothing'}; metadata of that type will misparse`);
                capture?.event('metadata_serializer_mismatch', { id: Number(id), expected: name, synced: synced ?? null });
            }
        }
        bridge.registries = snap;
        const sizes = snap.sizes();
        log(`registries: ${Object.entries(sizes).map(([k, v]) => `${k}=${v}`).join(' ')}`);
        capture?.event('registries', { sizes, blockNamespaces: snap.namespaces('minecraft:blocks') });
        bridge.emit('registries', snap);
    });
    handshake.on('complete', (info) => {
        bridge.handshakeDone = true;
        bridge.overrideDimension = info.overrideDimension;
        log(`handshake complete (overrideDimension ${info.overrideDimension})`);
        capture?.event('hs_complete', { overrideDimension: info.overrideDimension, sent: handshake.sent });
        bridge.emit('handshakeComplete', info);
    });
    handshake.on('reset', () => { bridge.handshakeDone = false; capture?.event('hs_reset'); });

    // 2. Parse-error instrumentation on every deserializer nmp creates.
    instrumentDeserializers(client, bridge, capture, log, version);

    // 3. Outgoing capture.
    const origWrite = client.write.bind(client);
    client.write = function (name, params) {
        if (name === 'custom_payload') {
            bridge.stats.payloadsOut++;
            capture?.payload('C2S', params.channel, Buffer.isBuffer(params.data) ? params.data : Buffer.from([]));
        } else if (capture && capturedC2S[name] !== undefined) {
            capture.packet('C2S', name, null, { params: summarize(params) });
        }
        return origWrite(name, params);
    };

    const multipart = new MultipartAssembler();

    function handlePayload(channel, data, viaMultipart = false) {
        bridge.stats.payloadsIn++;
        bridge.stats.byChannel[channel] = (bridge.stats.byChannel[channel] ?? 0) + 1;
        if (!viaMultipart) {
            bridge.ring.push({ at: Date.now(), channel, disc: data.length ? data[0] : null, len: data.length, answered: false });
            if (bridge.ring.length > RING_SIZE) bridge.ring.shift();
        }
        let decoded = null;
        try {
            switch (channel) {
            case 'REGISTER':
                bridge.serverChannels = decodeRegister(data);
                decoded = { channels: bridge.serverChannels.length };
                break;
            case HS_CHANNEL: {
                const msg = decodeHandshake(data);
                decoded = msg.type === 'RegistryData'
                    ? { type: msg.type, name: msg.name, hasMore: msg.hasMore, ids: msg.ids.length, dummied: msg.dummied.length, overrides: msg.overrides.length }
                    : msg.type === 'ModList' ? { type: msg.type, mods: msg.mods.length } : msg;
                markAnswered();
                handshake.handle(msg);
                break;
            }
            case 'FML|MP': {
                const done = multipart.accept(data);
                decoded = { multipart: done ? 'complete' : 'part', inner: done?.channel };
                if (done) {
                    if (done.filled !== done.data.length) log(`FML|MP ${done.channel}: ${done.filled} bytes received, header said ${done.data.length}`);
                    capture?.payload('S2C', `${done.channel}<-FML|MP`, done.data, { reassembled: true, filled: done.filled });
                    handlePayload(done.channel, done.data, true);
                    // Re-emit on the inner channel (spec 1.6) for mineflayer or mod handlers.
                    client.emit('custom_payload', { channel: done.channel, data: done.data, viaMultipart: true });
                }
                break;
            }
            case 'FML': {
                const msg = decodeFml(data, { readMetadata: typeReader.readMetadata });
                decoded = summarizeFml(msg);
                if (msg.type === 'EntitySpawn') { bridge.stats.entitySpawns++; bridge.emit('entitySpawn', msg); }
                if (msg.type === 'OpenGui') { bridge.stats.openGuis++; bridge.emit('openGui', msg); }
                break;
            }
            case 'FORGE':
                decoded = decodeForge(data);
                bridge.emit('forgeMessage', decoded);
                break;
            case 'jeid':
                decoded = decodeJeid(data);
                bridge.stats.jeidMessages++;
                if (decoded.type === 'BiomeChunkChange') decoded = { ...decoded, biomes: decoded.biomes.length };
                bridge.emit('jeid', decoded);
                break;
            default:
                bridge.emit('modPayload', { channel, data });
            }
        } catch (e) {
            decoded = { error: e.message };
            log(`decode error on ${channel}: ${e.message}`);
        }
        // Reassembled payloads were captured once, as '<channel><-FML|MP'.
        if (!viaMultipart) capture?.payload('S2C', channel, data, decoded ? { decoded } : {});
    }

    function markAnswered() {
        const last = bridge.ring[bridge.ring.length - 1];
        if (last) last.answered = true;
    }

    // 'packet' fires before the named event, so we see custom_payload bytes
    // before nmp's pluginChannels parses REGISTER in place, and fix entity_effect
    // before mineflayer reads it.
    client.on('packet', (data, meta, _buffer, fullBuffer) => {
        if (meta.state !== 'play') {
            if (meta.name === 'success') onLoginSuccess(data);
            if (meta.name === 'disconnect') onKick(data.reason, 'login');
            return;
        }
        if (meta.name === 'custom_payload') {
            if (Buffer.isBuffer(data.data)) handlePayload(data.channel, data.data);
            return;
        }
        if (meta.name === 'entity_effect' && reid) {
            const id = reidEffectIdFromTail(data.reidEffectId);
            if (id !== null) { data.effectId = id; bridge.stats.reidEffectTails++; }
        }
        if (meta.name === 'kick_disconnect') onKick(data.reason, 'play');
        if (capture && capturedPackets[meta.name] !== undefined) {
            capture.packet('S2C', meta.name, fullBuffer, meta.name === 'map_chunk'
                ? { x: data.x, z: data.z, groundUp: data.groundUp, bitMap: data.bitMap, chunkDataLen: data.chunkData?.length }
                : { params: summarize(data) });
        }
    });

    // Runs before nmp's own 'success' handler, so read identity from the packet.
    function onLoginSuccess(data) {
        capture?.setIdentity({ username: data.username, uuid: data.uuid });
        capture?.event('login_success');
        handshake.start();
    }

    function onKick(reason, state) {
        const c = classifyKick(reason);
        const recent = bridge.ring.filter(r => Date.now() - r.at < 10000 && !r.answered && r.channel !== 'REGISTER');
        bridge.lastKick = { ...c, state, handshakeState: handshake.stateName, recentUnanswered: recent.map(r => r.channel) };
        log(`kicked (${state}, ${c.category}${c.fatal ? ', fatal' : ''}): ${c.text.slice(0, 300)}`);
        capture?.event('kick', bridge.lastKick);
        bridge.emit('kick', bridge.lastKick);
    }

    client.on('error', (err) => {
        capture?.event('client_error', { message: String(err?.message ?? err).slice(0, 500), code: err?.code });
        if (!bridge.lastKick && err?.code) bridge.lastSocketError = classifySocketError(err);
    });
    client.on('end', (reason) => {
        capture?.event('end', { reason: String(reason ?? ''), handshakeState: handshake.stateName, stats: bridge.stats });
        capture?.close();
    });

    client.forgeBridge = bridge;
    return bridge;
}

function mergeCustom(a, b) {
    if (!a) return b;
    const merge = require('lodash.merge');
    return merge({}, a, b);
}

function summarize(v, depth = 0) {
    if (v == null || typeof v !== 'object') return typeof v === 'bigint' ? v.toString() : v;
    if (Buffer.isBuffer(v)) return { bytes: v.length };
    if (depth > 3) return '[deep]';
    if (Array.isArray(v)) return v.length > 64 ? { array: v.length, head: v.slice(0, 8).map(x => summarize(x, depth + 1)) } : v.map(x => summarize(x, depth + 1));
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = summarize(x, depth + 1);
    return out;
}

function summarizeFml(msg) {
    if (msg.type !== 'EntitySpawn') return msg;
    return {
        type: msg.type, entityId: msg.entityId, modId: msg.modId, modEntityTypeId: msg.modEntityTypeId,
        x: msg.x, y: msg.y, z: msg.z, metadataEntries: msg.metadata?.length ?? null,
        metadataError: msg.metadataError, throwerId: msg.throwerId, extraLen: msg.extra?.length ?? 0,
    };
}

// Packet-name lookup from the raw packet id, for parse-error reports.
function packetNamer(state, version) {
    try {
        const md = require('minecraft-data')(version);
        const mappings = md.protocol[state]?.toClient?.types?.packet?.[1]?.[0]?.type?.[1]?.mappings ?? {};
        return (id) => mappings[`0x${id.toString(16).padStart(2, '0')}`] ?? `0x${id.toString(16)}`;
    } catch {
        return (id) => `0x${id.toString(16)}`;
    }
}

function readPacketId(buf) {
    let result = 0;
    for (let i = 0; i < Math.min(5, buf.length); i++) {
        result |= (buf[i] & 0x7f) << (7 * i);
        if ((buf[i] & 0x80) === 0) return result;
    }
    return -1;
}

// nmp recreates its deserializer on every state change (Client#setSerializer).
// Wrap each one so misparsed packets are counted and kept, not silently dropped
// (protodef logs PartialReadError and drops the packet; trailing bytes are ignored).
// Clientbound play packets the bot never needs: a parse failure in one of these
// is logged and the packet dropped instead of ending the stream. Not here, on
// purpose (PR #28 review): world_particles (mineflayer's fishing waits for the
// bobber's particles) and title (RotN may announce invasions in titles).
//
// PartialReadError is different: protodef itself drops a packet whose read ran
// past its end, for ANY packet, essential or not, and never ends the stream
// (that is upstream behaviour, not this safety net). The bridge counts those in
// stats.partialReadErrors, logs them, captures their bytes and emits
// 'parseError', so an essential packet lost that way is visible, not silent.
export const DROPPABLE_ON_PARSE_ERROR = new Set([
    'advancements', 'select_advancement_tab', 'statistics', 'unlock_recipes', 'craft_recipe_response',
    'boss_bar', 'playerlist_header', 'sound_effect', 'named_sound_effect',
]);

function instrumentDeserializers(client, bridge, capture, log, version) {
    const origSet = client.setSerializer.bind(client);
    client.setSerializer = function (state) {
        origSet(state);
        const d = client.deserializer;
        const parse = d.parsePacketBuffer.bind(d);
        const name = packetNamer(state, version);
        d.parsePacketBuffer = (buf) => {
            let p;
            try {
                p = parse(buf);
            } catch (e) {
                const pname = name(readPacketId(buf));
                if (e.partialReadError) bridge.stats.partialReadErrors++;
                else bridge.stats.parseErrors++;
                // See DROPPABLE_ON_PARSE_ERROR: a non-partial error would end nmp's packet
                // stream; for allowlisted cosmetic packets it is dropped instead.
                const drop = !e.partialReadError && state === 'play' && DROPPABLE_ON_PARSE_ERROR.has(pname);
                const how = drop ? ' (dropped, allowlisted)' : e.partialReadError ? ' (dropped by protodef)' : '';
                log(`${e.partialReadError ? 'PartialReadError' : 'parse error'} in ${state}.${pname} (${buf.length} bytes)${how}: ${String(e.message).slice(0, 160)}`);
                // Keep the whole packet (up to 8 MiB): the bytes are what explains a parse error.
                capture?.record({ kind: 'parse_error', state, name: pname, partial: !!e.partialReadError, message: String(e.message).slice(0, 300), len: buf.length, b64: capture.b64(buf, 8 << 20) });
                bridge.emit('parseError', { state, name: pname, error: e });
                // A non-partial error makes protodef's parser end nmp's packet stream:
                // nothing arrives after it and the keep-alive times out (G1 Batch B+C).
                // Packets are length-framed, so dropping one keeps the stream in step.
                // Only cosmetic packets the bot never needs are dropped (marked partial,
                // so protodef drops them; counted and captured). Essential ones (chunks,
                // entities, slots, keep_alive, position, ...) still fail loudly.
                if (drop) {
                    const n = (bridge.stats.droppedPackets[pname] ?? 0) + 1;
                    bridge.stats.droppedPackets[pname] = n;
                    // Once per packet name, so a listener (skills, a harness) learns a kind of
                    // packet is being lost without a flood.
                    if (n === 1) bridge.emit('droppedPacket', { state, name: pname, message: String(e.message).slice(0, 300) });
                    e.partialReadError = true;
                    e.forgeBridgeDropped = true;
                }
                throw e;
            }
            if (p.metadata.size !== buf.length) {
                const pname = p.data?.name ?? name(readPacketId(buf));
                const n = (bridge.stats.partialPackets[pname] ?? 0) + 1;
                bridge.stats.partialPackets[pname] = n;
                if (n <= 3) log(`partial packet ${state}.${pname}: read ${p.metadata.size} of ${buf.length} bytes`);
                if (n <= 20) capture?.record({ kind: 'partial_packet', state, name: pname, read: p.metadata.size, len: buf.length, b64: capture.b64(buf, 8 << 20) });
            }
            return p;
        };
    };
}
