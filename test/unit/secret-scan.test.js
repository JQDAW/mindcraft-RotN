// Offline tests for test/tools/secret-scan.mjs (G4 #8: no secrets in the repo). Every secret-shaped input is built at
// run time from parts, so this file itself stays clean under the scan.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isRealIPv4, loadAllow, scanRepo, scanText, secretFile } from '../tools/secret-scan.mjs';

const kinds = (text, p = 'x.js', allow) => scanText(p, text, allow).map((f) => f.kind);
const PEM = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
const SSH = ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' ');
const OR_KEY = ['sk', 'or', 'v1', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6'].join('-');
const HETZNER = 'Ab3' + 'x'.repeat(30) + 'Q9z' + 'k'.repeat(28);          // 64 letters and digits, not hex
const REAL_IP = [93, 184, 216, 34].join('.');

describe('secret-scan: the content rules', () => {
    test('private keys, OpenRouter keys, Hetzner tokens and real IPv4 addresses are found', () => {
        assert.equal(HETZNER.length, 64);
        assert.deepEqual(kinds(`key: ${PEM}`), ['private-key']);
        assert.deepEqual(kinds(SSH), ['private-key']);
        assert.deepEqual(kinds(`OPENROUTER_API_KEY=${OR_KEY}`), ['openrouter-key']);
        assert.deepEqual(kinds(`HCLOUD_TOKEN=${HETZNER}`), ['hetzner-token']);
        assert.deepEqual(kinds(`ssh root@${REAL_IP}`), ['ipv4']);
        assert.deepEqual(kinds(`host "${REAL_IP}"`), ['ipv4']);
        const f = scanText('a/b.md', `x\ny ${REAL_IP}\n`)[0];
        assert.deepEqual({ path: f.path, line: f.line, kind: f.kind, match: f.match }, { path: 'a/b.md', line: 2, kind: 'ipv4', match: REAL_IP });
    });

    test('not secrets: the key prefix alone, a SHA-256, base64 fragments, and the doc ranges, loopback and 0.0.0.0', () => {
        assert.deepEqual(kinds(['sk', 'or', 'v1', ''].join('-')), [], 'a prefix (safe_error.js names it)');
        assert.deepEqual(kinds(crypto.createHash('sha256').update('x').digest('hex')), [], 'a SHA-256 is hex');
        const b64 = crypto.randomBytes(96).toString('base64');
        assert.deepEqual(kinds(`"integrity": "sha512-${b64}"`), [], 'package-lock integrity');
        for (const ip of ['192.0.2.10', '198.51.100.7', '203.0.113.250', '127.0.0.53', '0.0.0.0']) assert.deepEqual(kinds(`at ${ip}`), [], ip);
    });

    test('version-shaped quads are not addresses: leading zeros, longer runs, version contexts, a JSON "version" value', () => {
        for (const s of ['forge 1.12.2.024', 'mod-1.2.3.4.jar', 'v1.2.3.4', 'x 1.2.3.4.5', 'a1.2.3.4', '1.2.3.4-beta',
            '"version": "1.6.0.23"', '"version":"8.0.99.99"', '300.1.1.1', '1.2.3.256']) {
            assert.deepEqual(kinds(s), [], s);
        }
        assert.equal(isRealIPv4('8.8.8.8'), true);
        assert.equal(isRealIPv4('08.8.8.8'), false);
        assert.deepEqual(kinds('"name": "1.6.0.23"'), ['ipv4'], 'only a "version" value is exempt');
        assert.deepEqual(kinds('mod@1.6.0.23'), ['ipv4'], 'user@host is an address: "@" is no version context (FML\'s modid@version lines are evidence, skipped)');
    });

    test('the allowlist: an exact match in its own file only', () => {
        const allow = new Set([`t/x.test.js\t${OR_KEY}`]);
        assert.deepEqual(kinds(`k=${OR_KEY}`, 't/x.test.js', allow), []);
        assert.deepEqual(kinds(`k=${OR_KEY}`, 't/y.test.js', allow), ['openrouter-key'], 'another file still counts');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-scan-'));
        const f = path.join(dir, 'allow.txt');
        fs.writeFileSync(f, `# a comment\n\nt/x.test.js\t${OR_KEY}\ta reason\nbroken line\n`);
        assert.deepEqual([...loadAllow(f)], [`t/x.test.js\t${OR_KEY}`]);
    });
});

describe('secret-scan: file names that must never be committed', () => {
    test('env files, keys.json, token files, nmp-cache, SSH private keys, key and certificate files', () => {
        for (const p of ['.env', 'deploy/.env.local', 'keys.json', 'a/b.token', 'x/nmp-cache/f.json', 'id_ed25519', 'k/id_rsa', 'c.pem', 'c.key', 'c.p12', 'c.pfx']) {
            assert.ok(secretFile(p), p);
        }
        for (const p of ['.env.example', 'id_ed25519.pub', 'keys.example.json', 'src/tokens.js', 'deploy/cx23/bot.env.example', 'environment.md']) {
            assert.equal(secretFile(p), null, p);
        }
    });
});

describe('secret-scan: a git checkout', () => {
    test('tracked files only; test/evidence skipped (its own leak check); binaries skipped; a secret file name and its content both reported', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-scan-repo-'));
        const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { encoding: 'utf8' });
        git('init', '-q');
        fs.writeFileSync(path.join(dir, 'ok.js'), 'const x = 1;\n');
        fs.writeFileSync(path.join(dir, 'leak.md'), `host ${REAL_IP}\n`);
        fs.writeFileSync(path.join(dir, '.env'), `OPENROUTER_API_KEY=${OR_KEY}\n`);
        fs.mkdirSync(path.join(dir, 'test', 'evidence'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'test', 'evidence', 'run.log'), `at ${REAL_IP}\n`);
        fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, ...Buffer.from(OR_KEY)]));
        fs.writeFileSync(path.join(dir, 'untracked.md'), `host ${REAL_IP}\n`);
        git('add', 'ok.js', 'leak.md', '.env', 'test/evidence/run.log', 'bin.dat');
        const r = scanRepo(dir, { allowFile: path.join(dir, 'none.txt') });
        const got = r.findings.map((f) => `${f.path}:${f.kind}`).sort();
        assert.deepEqual(got, ['.env:openrouter-key', '.env:secret-file', 'leak.md:ipv4']);
        assert.equal(r.files, 5);
        assert.ok(r.ms < 5000, `${r.ms} ms`);
    });
});
