// Offline tests for test/tools/status-ping.mjs against a fake 1.12.2 status server on localhost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Buffer } from 'node:buffer';
import { setImmediate } from 'node:timers';
import {
    encodeVarInt, decodeVarInt, buildHandshake, parseStatusResponse, summarize, ping, PROTOCOL_1_12_2,
} from '../tools/status-ping.mjs';

// A loopback connect can fail at the OS level when the machine is saturated: a reviewer saw
// `connect ETIMEDOUT` once in 231 runs under heavy load. That says nothing about ping's own code, so
// connect-level errors are retried, with a generous timeout. Protocol errors are never retried.
const CONNECT_ERRORS = new Set(['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET']);
async function pingLocal(port, { tries = 3, timeout = 30000, pingFn = ping } = {}) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await pingFn({ host: '127.0.0.1', port, timeout });
        } catch (e) {
            if (!CONNECT_ERRORS.has(e.code) || attempt >= tries) throw e;
        }
    }
}

test('pingLocal retries only connect-level errors, and at most `tries` times', async () => {
    const flaky = (codes) => {
        let n = 0;
        return () => {
            const code = codes[n++];
            return code ? Promise.reject(Object.assign(new Error(`connect ${code}`), { code })) : Promise.resolve('ok');
        };
    };
    assert.equal(await pingLocal(1, { pingFn: flaky(['ETIMEDOUT', 'ECONNRESET']) }), 'ok');
    await assert.rejects(pingLocal(1, { pingFn: flaky(['ETIMEDOUT', 'ETIMEDOUT', 'ETIMEDOUT']) }), /connect ETIMEDOUT/);
    await assert.rejects(pingLocal(1, { pingFn: () => Promise.reject(new Error('bad VarInt')) }), /bad VarInt/, 'no retry for a protocol error');
});

test('VarInt round-trips, including multi-byte and negative values', () => {
    for (const v of [0, 1, 127, 128, 255, 25565, 2097151, 2147483647, -1]) {
        const enc = encodeVarInt(v);
        assert.equal(decodeVarInt(enc).value, v >>> 0);
        assert.equal(decodeVarInt(enc).size, enc.length);
    }
    assert.deepEqual([...encodeVarInt(300)], [0xac, 0x02]);
    assert.equal(decodeVarInt(Buffer.from([0x80])), null, 'incomplete VarInt');
});

test('handshake packet layout for 1.12.2 status', () => {
    const pkt = buildHandshake('a.b', 25565);
    // len, id 0, protocol 340 (0xd4 0x02), host "a.b", port 0x63dd, next state 1
    assert.deepEqual([...pkt], [10, 0x00, 0xd4, 0x02, 3, 0x61, 0x2e, 0x62, 0x63, 0xdd, 0x01]);
    assert.equal(PROTOCOL_1_12_2, 340);
});

function statusPacket(obj) {
    const json = Buffer.from(JSON.stringify(obj), 'utf8');
    const body = Buffer.concat([encodeVarInt(0), encodeVarInt(json.length), json]);
    return Buffer.concat([encodeVarInt(body.length), body]);
}

const forgeStatus = {
    version: { name: '1.12.2', protocol: 340 },
    players: { max: 10, online: 0 },
    description: { text: 'RotN 3.3.4 test' },
    modinfo: {
        type: 'FML',
        modList: [
            { modid: 'minecraft', version: '1.12.2' },
            { modid: 'forge', version: '14.23.5.2860' },
            { modid: 'jeid', version: '2.2.2' },
            ...Array.from({ length: 400 }, (_, i) => ({ modid: `mod${i}`, version: '1.0.0-with-a-long-version-string' })),
        ],
    },
};

test('parseStatusResponse waits for the whole packet', () => {
    const pkt = statusPacket(forgeStatus);
    assert.equal(parseStatusResponse(pkt.subarray(0, 100)), null);
    assert.deepEqual(JSON.parse(parseStatusResponse(pkt)), forgeStatus);
});

test('summarize picks out forge, jeid and the mod count', () => {
    assert.deepEqual(summarize(forgeStatus), {
        version: '1.12.2', protocol: 340, modinfoType: 'FML', modCount: 403,
        forge: '14.23.5.2860', jeid: '2.2.2', playersOnline: 0, playersMax: 10,
    });
});

test('ping talks to a fake server and reassembles a large, chunked response', async () => {
    const server = net.createServer((sock) => {
        let got = Buffer.alloc(0);
        sock.on('data', (d) => {
            got = Buffer.concat([got, d]);
            // handshake + status request received: reply in small chunks
            if (got.length >= buildHandshake('127.0.0.1', server.address().port).length + 2) {
                const pkt = statusPacket(forgeStatus);
                let off = 0;
                const pump = () => {
                    if (off >= pkt.length) return;
                    sock.write(pkt.subarray(off, off + 1000));
                    off += 1000;
                    setImmediate(pump);
                };
                pump();
            }
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
        const status = await pingLocal(server.address().port);
        assert.equal(summarize(status).jeid, '2.2.2');
        assert.ok(JSON.stringify(status).length > 10000);
    } finally {
        server.close();
    }
});

test('ping rejects when the server closes without answering', async () => {
    // A hang-up server: it reads the request, then closes cleanly (FIN, not RST).
    const server = net.createServer((sock) => sock.once('data', () => sock.end()));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
        await assert.rejects(pingLocal(server.address().port), /connection closed before a status response/);
    } finally {
        server.close();
    }
});
