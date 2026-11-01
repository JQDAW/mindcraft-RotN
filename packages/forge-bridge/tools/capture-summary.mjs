#!/usr/bin/env node
// Summarize a forge-bridge capture (JSONL) for evidence and fixtures:
// payload counts per channel and direction, handshake events, kicks, parse
// errors, chunk bits per block, REID facts. Prints JSON.
//
//   node packages/forge-bridge/tools/capture-summary.mjs captures/raw/FRCFLD-....jsonl

import process from 'node:process';
import { Buffer } from 'node:buffer';
import { readCapture } from '../src/capture.js';
import { Reader } from '../src/wire.js';

// Bits per block of each section in a map_chunk packet (full packet bytes).
// skyLight: true in the overworld (the dimension mineflayer passes to the loader).
export function chunkSectionBits(packetBuf, skyLight = true) {
    const r = new Reader(packetBuf);
    r.varint(); // packet id
    r.i32(); r.i32(); // x, z
    const groundUp = r.bool();
    const bitMap = r.varint();
    const len = r.varint();
    const data = new Reader(r.bytes(len));
    const bits = [];
    for (let y = 0; y < 16; y++) {
        if (!((bitMap >> y) & 1)) continue;
        const b = data.u8();
        const paletteLen = data.varint();
        for (let i = 0; i < paletteLen; i++) data.varint();
        const longs = data.varint();
        data.bytes(longs * 8);
        data.bytes(2048); // block light
        if (skyLight) data.bytes(2048);
        bits.push(b);
    }
    const tail = data.remaining;
    return { bits, groundUp, biomeTailBytes: tail, biomeFormat: !groundUp ? 'none' : tail === 256 ? 'byte' : 'varint?' };
}

export function summarize(lines) {
    const out = {
        lines: lines.length,
        durationS: lines.length ? Math.round(lines[lines.length - 1].t / 1000) : 0,
        payloads: {},
        events: {},
        handshake: [],
        registries: null,
        kicks: [],
        parseErrors: [],
        partialPackets: {},
        packets: {},
        chunkBits: {},
        biomeFormats: {},
        entitySpawnMods: {},
        jeid: {},
        reidEffectTails: 0,
        end: null,
    };
    for (const l of lines) {
        if (l.kind === 'payload') {
            const k = `${l.dir} ${l.channel}`;
            out.payloads[k] = (out.payloads[k] ?? 0) + 1;
            if (l.channel === 'FML' && l.decoded?.type === 'EntitySpawn') {
                out.entitySpawnMods[l.decoded.modId] = (out.entitySpawnMods[l.decoded.modId] ?? 0) + 1;
            }
            if (l.channel === 'jeid' && l.decoded?.type) out.jeid[l.decoded.type] = (out.jeid[l.decoded.type] ?? 0) + 1;
        } else if (l.kind === 'event') {
            out.events[l.name] = (out.events[l.name] ?? 0) + 1;
            if (l.name === 'hs_state') out.handshake.push(`${l.from}->${l.to}@${l.t}ms`);
            if (l.name === 'registries') out.registries = l.sizes;
            if (l.name === 'kick') out.kicks.push({ t: l.t, category: l.category, fatal: l.fatal, text: l.text, state: l.state, recentUnanswered: l.recentUnanswered });
            if (l.name === 'end') out.end = { t: l.t, reason: l.reason, handshakeState: l.handshakeState, stats: l.stats };
        } else if (l.kind === 'parse_error') {
            out.parseErrors.push({ t: l.t, name: l.name, partial: l.partial, message: l.message });
        } else if (l.kind === 'partial_packet') {
            out.partialPackets[l.name] = (out.partialPackets[l.name] ?? 0) + 1;
        } else if (l.kind === 'packet') {
            const k = `${l.dir} ${l.name}`;
            out.packets[k] = (out.packets[k] ?? 0) + 1;
            if (l.name === 'map_chunk' && l.b64) {
                try {
                    const s = chunkSectionBits(Buffer.from(l.b64, 'base64'));
                    for (const b of s.bits) out.chunkBits[b] = (out.chunkBits[b] ?? 0) + 1;
                    out.biomeFormats[s.biomeFormat] = (out.biomeFormats[s.biomeFormat] ?? 0) + 1;
                } catch (e) {
                    out.chunkBits.error = e.message;
                }
            }
        }
    }
    if (out.end?.stats) out.reidEffectTails = out.end.stats.reidEffectTails;
    return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
    const file = process.argv[2];
    if (!file) { console.error('usage: capture-summary.mjs <capture.jsonl>'); process.exit(2); }
    console.log(JSON.stringify(summarize(readCapture(file)), null, 2));
}
