// Evidence redaction (test/tools/redact-evidence.mjs) and the CI check over test/evidence/**.
// Fixture addresses are from the documentation ranges (RFC 5737, RFC 3849).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact, findLeaks, evidenceFiles } from '../tools/redact-evidence.mjs';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const kinds = (t) => findLeaks(t).map((l) => l.kind);

describe('redact: real addresses in log context', () => {
    test('the 1.12 login line, [ ], host:port and JSON values become <ip>', () => {
        assert.equal(redact('[22:31:05] [Server thread/INFO]: FRCFLD[/203.0.113.7:51234] logged in with entity id 1'),
            '[22:31:05] [Server thread/INFO]: FRCFLD[/<ip>:51234] logged in with entity id 1');
        assert.equal(redact('lost connection from [198.51.100.9]'), 'lost connection from [<ip>]');
        assert.equal(redact('Disconnecting /198.51.100.9 (timed out)'), 'Disconnecting /<ip> (timed out)', 'after "/" without a port');
        assert.equal(redact('connecting to 192.0.2.10:25565 now'), 'connecting to <ip>:25565 now');
        assert.equal(redact('{"host": "192.0.2.10", "port": 25565}'), '{"host": "<ip>", "port": 25565}');
        assert.deepEqual(kinds(redact('FRCFLD[/203.0.113.7:51234] and 192.0.2.10:25565')), []);
    });

    test('IPv6, UUIDs, the bot name and local paths', () => {
        assert.equal(redact('/2001:db8:85a3::8a2e:370:7334 joined'), '/<ip> joined');
        assert.equal(redact('UUID of player FRCFLD is 0f9e2c4a-1b2c-4d3e-8f40-123456789abc', { bot: 'FRCFLD' }),
            'UUID of player <bot> is <uuid-v4>');
        assert.equal(redact('offline 0f9e2c4a-1b2c-3d3e-8f40-123456789abc'), 'offline <uuid-v3>');
        assert.equal(redact('at C:\\Users\\someone\\x and C:/Users/someone/y and /c/Users/someone/z and "C:\\\\Users\\\\someone\\\\w"'),
            'at <local>\\x and <local>/y and <local>/z and "<local>\\\\w"');
    });

    test('mod version strings with four numbers are kept (not addresses)', () => {
        const modList = [
            'UCHIJAAAA\tbaubles{1.5.2} [Baubles] (Baubles-1.12-1.5.2.jar)',
            'UCHIJAAAA\tsomemod{1.2.3.4} [Some Mod] (somemod-1.2.3.4.jar)',
            'Found mod somemod_1.2.3.4 version 1.2.3.4, v1.2.3.4, 1.2.3.4-beta, 1.2.3.4+build',
            '{"version": "1.2.3.4"}',
            'Forge 14.23.5.2860 on Minecraft 1.12.2',
            // The shape of FML's join line in the real G2 server log (2026-11-01), with made-up mods.
            '[22:13:18] [Netty Epoll Server IO #3/INFO] [FML]: Client attempting to join with 3 mods : somemod@1.2.3.4,FML@8.0.99.99,othermod@1.12.2-1.0.5,lastmod@4.3.2.1',
            'AdPother-1.12.2-1.2.3.4-build.0673.jar',
        ].join('\n');
        assert.equal(redact(modList), modList, 'nothing in a mod list is redacted');
        assert.deepEqual(findLeaks(modList), [], 'and the check does not flag it');
    });

    test('clock times and coordinates are not IPv6 or IPv4', () => {
        const t = '[22:10:20] [Server thread/INFO]: Teleported FRCFLD to 120.5, 64.0, -33.5; at 22:10:20.123 tick 12.3.4';
        assert.deepEqual(findLeaks(t), []);
    });
});

describe('findLeaks: the CI check flags any address left', () => {
    test('an address in any context that is not a version fails', () => {
        assert.deepEqual(kinds('server at 192.0.2.10 ready'), ['ipv4'], 'bare, out of any log context');
        assert.deepEqual(kinds('FRCFLD[/203.0.113.7:51234] logged in'), ['ipv4']);
        assert.deepEqual(kinds('ip=198.51.100.9'), ['ipv4']);
        assert.deepEqual(kinds('ssh root@192.0.2.10 uptime'), ['ipv4'], 'user@address is not a mod list entry');
        assert.deepEqual(kinds('ssh root@192.0.2.10:22'), ['ipv4']);
        assert.deepEqual(kinds('"host":"192.0.2.10"'), ['ipv4']);
        assert.deepEqual(kinds('from 2001:db8::1 now'), ['ipv6']);
        assert.deepEqual(kinds('from 2001:0db8:0000:0000:0000:ff00:0042:8329 now'), ['ipv6']);
        assert.deepEqual(kinds('player 0f9e2c4a-1b2c-4d3e-8f40-123456789abc'), ['uuid']);
        assert.deepEqual(kinds('file C:\\Users\\someone\\x'), ['local-path']);
    });

    test('a redacted text has no leaks; the line number is reported', () => {
        const raw = 'line one\nFRCFLD[/203.0.113.7:51234] logged in\nUUID 0f9e2c4a-1b2c-4d3e-8f40-123456789abc';
        assert.deepEqual(findLeaks(raw).map((l) => [l.kind, l.line]), [['ipv4', 2], ['uuid', 3]]);
        assert.deepEqual(findLeaks(redact(raw)), []);
    });

    test('invalid octets and longer dotted runs are not addresses', () => {
        assert.deepEqual(kinds('256.1.1.1 and 1.2.3.4.5 and 10.20.30.400'), []);
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
