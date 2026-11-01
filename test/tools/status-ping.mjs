#!/usr/bin/env node
// Minecraft 1.12.2 server list ping (handshake + status request), no dependencies.
// Used by deploy/test-server.sh and the G0 scenario to prove from outside that the test
// server runs Forge with the RotN mod list. Saves the raw status JSON (fml-spec section 6: ping.json).
//
//   node test/tools/status-ping.mjs --host 1.2.3.4 [--port 25565] [--out ping.json] [--timeout 10000]
//
// Prints a one-line summary; exits 1 if the server cannot be pinged.
import net from 'node:net';
import fs from 'node:fs';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';

export const PROTOCOL_1_12_2 = 340;

export function encodeVarInt(value) {
    const bytes = [];
    let v = value >>> 0;
    do {
        let b = v & 0x7f;
        v >>>= 7;
        if (v !== 0) b |= 0x80;
        bytes.push(b);
    } while (v !== 0);
    return Buffer.from(bytes);
}

// Returns { value, size } or null if the buffer does not hold a complete VarInt yet.
export function decodeVarInt(buf, offset = 0) {
    let value = 0;
    for (let i = 0; i < 5; i++) {
        if (offset + i >= buf.length) return null;
        const b = buf[offset + i];
        value |= (b & 0x7f) << (7 * i);
        if ((b & 0x80) === 0) return { value: value >>> 0, size: i + 1 };
    }
    throw new Error('VarInt too long');
}

function encodeString(s) {
    const body = Buffer.from(s, 'utf8');
    return Buffer.concat([encodeVarInt(body.length), body]);
}

function framePacket(id, payload) {
    const body = Buffer.concat([encodeVarInt(id), payload]);
    return Buffer.concat([encodeVarInt(body.length), body]);
}

export function buildHandshake(host, port, protocol = PROTOCOL_1_12_2) {
    const portBuf = Buffer.alloc(2);
    portBuf.writeUInt16BE(port);
    return framePacket(0x00, Buffer.concat([encodeVarInt(protocol), encodeString(host), portBuf, encodeVarInt(1)]));
}

export function buildStatusRequest() {
    return framePacket(0x00, Buffer.alloc(0));
}

// Parses one status-response packet from buf. Returns the JSON string, or null if incomplete.
export function parseStatusResponse(buf) {
    const len = decodeVarInt(buf, 0);
    if (!len || buf.length < len.size + len.value) return null;
    let off = len.size;
    const id = decodeVarInt(buf, off);
    if (id.value !== 0x00) throw new Error(`unexpected packet id ${id.value}`);
    off += id.size;
    const slen = decodeVarInt(buf, off);
    off += slen.size;
    return buf.subarray(off, off + slen.value).toString('utf8');
}

export function summarize(status) {
    const mods = status?.modinfo?.modList ?? [];
    const find = (id) => mods.find((m) => m.modid === id)?.version ?? null;
    return {
        version: status?.version?.name ?? null,
        protocol: status?.version?.protocol ?? null,
        modinfoType: status?.modinfo?.type ?? null,
        modCount: mods.length,
        forge: find('forge'),
        jeid: find('jeid'),
        playersOnline: status?.players?.online ?? null,
        playersMax: status?.players?.max ?? null,
    };
}

export function ping({ host, port = 25565, timeout = 10000 }) {
    return new Promise((resolve, reject) => {
        const sock = net.connect({ host, port });
        let buf = Buffer.alloc(0);
        const timer = setTimeout(() => {
            sock.destroy();
            reject(new Error(`timeout after ${timeout} ms`));
        }, timeout);
        const done = (err, val) => {
            clearTimeout(timer);
            sock.destroy();
            if (err) reject(err); else resolve(val);
        };
        sock.on('connect', () => {
            sock.write(Buffer.concat([buildHandshake(host, port), buildStatusRequest()]));
        });
        sock.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            try {
                const json = parseStatusResponse(buf);
                if (json !== null) done(null, JSON.parse(json));
            } catch (e) {
                done(e);
            }
        });
        sock.on('error', (e) => done(e));
        sock.on('close', () => done(new Error('connection closed before a status response')));
    });
}

function parseArgs(argv) {
    const opts = { port: 25565, timeout: 10000 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--host') opts.host = argv[++i];
        else if (a === '--port') opts.port = Number(argv[++i]);
        else if (a === '--out') opts.out = argv[++i];
        else if (a === '--timeout') opts.timeout = Number(argv[++i]);
        else throw new Error(`unknown argument ${a}`);
    }
    if (!opts.host) throw new Error('--host is required');
    return opts;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const status = await ping(opts);
    if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(status, null, 2) + '\n');
    console.log('status-ping ' + JSON.stringify(summarize(status)));
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    main().catch((e) => {
        console.error(`status-ping failed: ${e.message}`);
        process.exit(1);
    });
}
