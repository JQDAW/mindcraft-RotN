// Evidence redaction (test/tools/redact-evidence.mjs) and the CI check over test/evidence/**.
// Fixture addresses are from the documentation ranges (RFC 5737 for IPv4, RFC 3849 for IPv6).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact, findLeaks, evidenceFiles } from '../tools/redact-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const kinds = (t) => findLeaks(t).map((l) => l.kind);
// Both ways: the raw text is flagged, and the redacted text is exactly `want` and clean.
const both = (raw, want, kind) => {
    assert.ok(kinds(raw).includes(kind), `${raw}: flagged as ${kind} (got ${JSON.stringify(kinds(raw))})`);
    assert.equal(redact(raw), want);
    assert.deepEqual(kinds(redact(raw)), [], `${want}: clean after redaction`);
};

describe('IPv4 in log context is redacted, and flagged when left', () => {
    test('the 1.12 login line, [ ], host:port and JSON values', () => {
        both('[22:31:05] [Server thread/INFO]: FRCFLD[/203.0.113.7:51234] logged in with entity id 1',
            '[22:31:05] [Server thread/INFO]: FRCFLD[/<ip>:51234] logged in with entity id 1', 'ipv4');
        both('lost connection from [198.51.100.9]', 'lost connection from [<ip>]', 'ipv4');
        both('Disconnecting /198.51.100.9 (timed out)', 'Disconnecting /<ip> (timed out)', 'ipv4');
        both('connecting to 192.0.2.10:25565 now', 'connecting to <ip>:25565 now', 'ipv4');
        both('{"host": "192.0.2.10", "port": 25565}', '{"host": "<ip>", "port": 25565}', 'ipv4');
    });
});

describe('IPv6 (PR #66 review findings 1 and 3)', () => {
    test('Java 8 login line: /full:form:port, also inside [ ]', () => {
        both('FRCFLD[/2001:db8:0:0:0:0:0:1:51234] logged in', 'FRCFLD[/<ip>:51234] logged in', 'ipv6');
        both('Disconnecting /2001:db8:0:0:0:0:0:1:51234', 'Disconnecting /<ip>:51234', 'ipv6');
    });

    test('compressed with a port, bracketed with a port, and plain', () => {
        both('from /2001:db8::1:51234 now', 'from /<ip>:51234 now', 'ipv6');
        both('from [2001:db8::1]:51234 now', 'from [<ip>]:51234 now', 'ipv6');
        both('peer 2001:db8:85a3::8a2e:370:7334 joined', 'peer <ip> joined', 'ipv6');
        both('peer 2001:0db8:0000:0000:0000:ff00:0042:8329.', 'peer <ip>.', 'ipv6');
    });

    test('IPv4-mapped IPv6 goes whole: no ".0.113.7" left', () => {
        both('from ::ffff:203.0.113.7 now', 'from <ip> now', 'ipv6');
        both('FRCFLD[/::ffff:203.0.113.7:51234] logged in', 'FRCFLD[/<ip>:51234] logged in', 'ipv6');
        assert.ok(!redact('x ::ffff:203.0.113.7 y').includes('113'));
    });

    test('partial leftovers next to a redaction are flagged', () => {
        assert.deepEqual(kinds('from <ip>.0.113.7 now'), ['partial-ip']);
        assert.deepEqual(kinds('from 203.0.<ip> now'), ['partial-ip']);
        assert.deepEqual(kinds('from 2001:db8:<ip> now'), ['partial-ip']);
        assert.deepEqual(kinds('FRCFLD[/<ip>:51234] logged in'), [], 'a port after <ip> is fine');
    });

    test('clock times, "::" and hex words are not IPv6', () => {
        const t = '[22:10:20] [Server thread/INFO]: at 22:10:20.123 Foo::bar ::  cafe:babe:1 minecraft:stone';
        assert.deepEqual(findLeaks(t), []);
        assert.equal(redact(t), t);
    });
});

describe('versions with four numbers: three exact forms are kept, everything else fails closed (review finding 2)', () => {
    test('kept: FML\'s join list, {x} in the mod table, -x.jar file names, Forge versions', () => {
        const kept = [
            // The shape of FML's join line in the real G2 server log (2026-11-01), with made-up mods.
            '[22:13:18] [Netty Epoll Server IO #3/INFO] [FML]: Client attempting to join with 6 mods : somemod@1.2.3.4,FML@8.0.99.99,othermod@1.12.2-1.0.5,'
                + 'endermod@1.12.2-4.5.6.7,mixmod@2.3.4.5-mixins8,lastmod@4.3.2.1',
            'UCHIJAAAA\tsomemod{1.2.3.4} [Some Mod] (somemod-1.2.3.4.jar)',
            'Found FMLCorePluginContainsFMLMod marker in AdPother-1.12.2-1.2.3.4-build.0673.jar.',
            'Forge 14.23.5.2860 on Minecraft 1.12.2; 256.1.1.1 and 1.2.3.4.5 and 10.20.30.400 are not addresses',
        ].join('\n');
        assert.deepEqual(findLeaks(kept), [], 'not flagged');
        assert.equal(redact(kept), kept, 'not redacted');
    });

    test('flagged: addresses that only look like versions', () => {
        for (const t of ['ip-203.0.113.7', 'host_203.0.113.7', 'rev203.0.113.7', 'v203.0.113.7', '203.0.113.7-', '203.0.113.7abc',
            'ssh root@203.0.113.7', 'ssh root@203.0.113.7,x', 'server at 192.0.2.10 ready', 'ip=198.51.100.9',
            'version 192.0.2.10', '{192.0.2.10 }', 'a-192.0.2.10.jarx', '-192.0.2.10.jar', 'x-192.0.2.10.tar']) {
            assert.deepEqual(kinds(t), ['ipv4'], t);
        }
    });

    test('flagged: modid@x outside FML\'s join line, or not followed by "," or the line end', () => {
        assert.deepEqual(kinds('[INFO]: somemod@203.0.113.7,othermod@1.0'), ['ipv4'], 'not the join line');
        assert.deepEqual(kinds('[FML]: Client attempting to join with 2 mods : a@203.0.113.7 b'), ['ipv4'], 'followed by a space');
        assert.deepEqual(kinds('[FML]: Client attempting to join with 2 mods : a@1.0,see 203.0.113.7'), ['ipv4'], 'an entry that is not modid@version');
        assert.deepEqual(kinds('[FML]: Client attempting to join with 1 mods : 203.0.113.7@1.0'), ['ipv4'], 'before the @');
        assert.deepEqual(kinds('somemod@203.0.113.7 [FML]: Client attempting to join with 1 mods : x@1.0'), ['ipv4'], 'before the list');
        assert.deepEqual(kinds('{"version": "192.0.2.10"}'), ['ipv4'], 'a JSON version is not exempt');
        assert.equal(redact('{"version": "192.0.2.10"}'), '{"version": "<ip>"}', 'and it is redacted (fail closed)');
    });
});

describe('UUIDs, the bot name and local paths', () => {
    test('redacted and flagged', () => {
        both('UUID 0f9e2c4a-1b2c-4d3e-8f40-123456789abc', 'UUID <uuid-v4>', 'uuid');
        both('offline 0f9e2c4a-1b2c-3d3e-8f40-123456789abc', 'offline <uuid-v3>', 'uuid');
        assert.equal(redact('UUID of player FRCFLD is x', { bot: 'FRCFLD' }), 'UUID of player <bot> is x');
        both('at C:\\Users\\someone\\x', 'at <local>\\x', 'local-path');
        assert.equal(redact('C:/Users/someone/y and /c/Users/someone/z and "C:\\\\Users\\\\someone\\\\w"'),
            '<local>/y and <local>/z and "<local>\\\\w"');
    });

    test('line numbers are reported, never the address', () => {
        const raw = 'line one\nFRCFLD[/203.0.113.7:51234] logged in\nUUID 0f9e2c4a-1b2c-4d3e-8f40-123456789abc';
        assert.deepEqual(findLeaks(raw), [{ kind: 'ipv4', line: 2 }, { kind: 'uuid', line: 3 }]);
    });
});

describe('committed evidence has no unredacted addresses, UUIDs or local paths', () => {
    // G2 evidence and every later gate's. (G0 and G1 predate this check and are reviewed by hand.)
    const dirs = ['g2'].map((d) => path.join(ROOT, 'test', 'evidence', d));
    test('test/evidence/g2/** is clean', () => {
        const found = [];
        for (const dir of dirs) {
            for (const f of evidenceFiles(dir)) {
                for (const l of findLeaks(fs.readFileSync(f, 'utf8'))) found.push(`${path.relative(ROOT, f)}:${l.line} ${l.kind}`);
            }
        }
        assert.deepEqual(found, [], 'redact these with test/tools/redact-evidence.mjs (never widen the version allowlist for an address)');
    });
});
