// JSONL capture of plugin-channel traffic and selected play packets
// (fml-spec.md section 6.5). One JSON object per line, written synchronously so
// nothing is lost when Mindcraft calls process.exit().
//
// Privacy: payloads are redacted at write time. The bot's username and UUID are
// replaced by same-length placeholders (lengths and prefixes stay valid), in raw,
// dashed and undashed forms. Login-state packets (encryption, session) are never
// recorded. Still keep raw captures out of git: the default folder is
// captures/raw/, which .gitignore covers.

import { Buffer } from 'node:buffer';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

export function redactBuffer(buf, { username, uuid } = {}) {
    let out = buf;
    const swap = (needle, filler) => {
        if (!needle || needle.length === 0) return;
        let idx = out.indexOf(needle);
        if (idx === -1) return;
        out = Buffer.from(out); // copy once before mutating
        while (idx !== -1) {
            filler.copy(out, idx, 0, needle.length);
            idx = out.indexOf(needle, idx + needle.length);
        }
    };
    if (username) {
        const u = Buffer.from(username, 'utf8');
        swap(u, Buffer.alloc(u.length, 'X'));
    }
    if (uuid) {
        const hex = uuid.replace(/-/g, '').toLowerCase();
        if (/^[0-9a-f]{32}$/.test(hex)) {
            swap(Buffer.from(hex, 'hex'), Buffer.alloc(16, 0));
            const dashed = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
            const zeroDashed = '00000000-0000-0000-0000-000000000000';
            swap(Buffer.from(dashed, 'utf8'), Buffer.from(zeroDashed, 'utf8'));
            swap(Buffer.from(dashed.toUpperCase(), 'utf8'), Buffer.from(zeroDashed, 'utf8'));
            swap(Buffer.from(hex, 'utf8'), Buffer.alloc(32, '0'));
            swap(Buffer.from(hex.toUpperCase(), 'utf8'), Buffer.alloc(32, '0'));
        }
    }
    return out;
}

export function redactString(s, ids) {
    return redactBuffer(Buffer.from(String(s), 'utf8'), ids).toString('utf8');
}

export class CaptureWriter {
    /**
     * @param {object} opts
     * @param {string} opts.file JSONL output path (parent folders are created)
     * @param {{username?:string, uuid?:string}} [opts.redact]
     * @param {Record<string, number>} [opts.packetLimits] max records per play packet name
     */
    constructor({ file, redact = {}, packetLimits = {} }) {
        this.file = file;
        this.redact = { ...redact };
        this.packetLimits = { map_chunk: 40, window_items: 50, set_slot: 300, entity_effect: 100, remove_entity_effect: 100, ...packetLimits };
        this.counts = {};
        this.start = Date.now();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        this.fd = fs.openSync(file, 'a');
        this.closed = false;
        this.lines = 0;
    }

    setIdentity({ username, uuid }) {
        if (username) this.redact.username = username;
        if (uuid) this.redact.uuid = uuid;
    }

    record(entry) {
        if (this.closed) return;
        const line = { t: Date.now() - this.start, ...entry };
        const json = redactString(JSON.stringify(line, jsonReplacer), this.redact);
        fs.writeSync(this.fd, json + '\n');
        this.lines++;
    }

    payload(dir, channel, data, extra = {}) {
        const red = redactBuffer(data, this.redact);
        this.record({
            kind: 'payload', dir, channel,
            disc: data.length ? data.readInt8(0) : null,
            len: data.length,
            b64: red.toString('base64'),
            ...extra,
        });
    }

    // Returns false once the per-name limit is reached.
    packet(dir, name, buffer, extra = {}) {
        const n = (this.counts[name] ?? 0) + 1;
        this.counts[name] = n;
        const limit = this.packetLimits[name];
        if (limit !== undefined && n > limit) return false;
        this.record({
            kind: 'packet', dir, name, n,
            len: buffer?.length ?? 0,
            b64: buffer ? redactBuffer(buffer, this.redact).toString('base64') : null,
            ...extra,
        });
        return true;
    }

    event(name, data = {}) { this.record({ kind: 'event', name, ...data }); }

    close() {
        if (this.closed) return;
        this.event('capture_closed', { lines: this.lines, packetCounts: this.counts });
        this.closed = true;
        try { fs.closeSync(this.fd); } catch { /* already closed */ }
    }
}

function jsonReplacer(_key, value) {
    if (typeof value === 'bigint') return value.toString();
    if (value && value.type === 'Buffer' && Array.isArray(value.data)) return { b64: Buffer.from(value.data).toString('base64') };
    if (value instanceof Map) return Object.fromEntries(value);
    if (value instanceof Set) return [...value];
    return value;
}

/** Read a capture back (tests, fixture tools). */
export function readCapture(file) {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
