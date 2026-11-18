// Offline tests for test/tools/secret-scan.mjs (G4 #8: no secrets in the repo). Every secret-shaped input, IPv4 quads
// included, is built at run time from parts, so this file itself stays clean under the scan (#390 review).
import './isolate-tmp.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ALLOW, formatFinding, isRealIPv4, loadAllow, matchHash, scanFile, scanRepo, scanText, secretFile } from '../tools/secret-scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const q = (...n) => n.join('.');                                         // a dotted quad from its parts
const kinds = (text, p = 'x.js', allow, opts) => scanText(p, text, allow, opts).map((f) => f.kind);
const PEM = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
const SSH = ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' ');
const PPK = ['PuTTY', 'User', 'Key', 'File', '3: ssh-ed25519'].join('-');
const OR_KEY = ['sk', 'or', 'v1', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6'].join('-');
const HETZNER = ['Ab3', 'x'.repeat(30), 'Q9z', 'k'.repeat(28)].join('');   // 64 letters and digits, not hex
const REAL = q(93, 184, 216, 34);
const GOOGLE = q(8, 8, 8, 8);

describe('#390 review 1 and 2: the allowlist holds hashes, never plaintext; the output never shows a match', () => {
    test('an entry is path + the match\'s hash; a plaintext entry is ignored; the same match in another file still counts', () => {
        const allow = new Set([`t/x.test.js\t${matchHash(OR_KEY)}`]);
        assert.deepEqual(kinds(`k=${OR_KEY}`, 't/x.test.js', allow), []);
        assert.deepEqual(kinds(`k=${OR_KEY}`, 't/y.test.js', allow), ['openrouter-key']);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-scan-'));
        const f = path.join(dir, 'allow.txt');
        fs.writeFileSync(f, `# c\n\nt/x.test.js\t${matchHash(OR_KEY)}\twhy\nt/x.test.js\t${OR_KEY}\tplaintext\nt/k.pem\tsecret-file\twhy\nbroken\n`);
        assert.deepEqual([...loadAllow(f)].sort(), [`t/k.pem\tsecret-file`, `t/x.test.js\t${matchHash(OR_KEY)}`].sort(), 'the plaintext line is not an entry');
        assert.equal(matchHash('x').length, 16);
    });

    test('the repo\'s own allowlist file is clean under the scan and holds only hash or secret-file keys', () => {
        const text = fs.readFileSync(DEFAULT_ALLOW, 'utf8');
        assert.deepEqual(scanText('test/tools/secret-scan-allow.txt', text), []);
        for (const l of text.split('\n').filter((x) => x.trim() && !x.startsWith('#'))) {
            const [p, h, why] = l.split('\t');
            assert.ok(p && /^([0-9a-f]{16}|secret-file)$/.test(h) && why?.trim(), l);
        }
    });

    test('a finding prints its kind, length, at most 6 leading characters and its hash, never the match', () => {
        for (const secret of [OR_KEY, HETZNER, PEM]) {
            const [f] = scanText('a.md', `x ${secret}`);
            const out = formatFinding(f);
            assert.ok(!out.includes(secret), out);
            assert.ok(f.prefix.length <= 6, f.prefix);
            assert.match(out, new RegExp(`^a\\.md:1: ${f.kind} \\(length ${secret.length}, starts "[^"]{0,6}", hash ${matchHash(secret)}\\)$`));
        }
        // #390 re-review: an ipv4 finding shows no start at all (a few octets narrow an address down).
        assert.equal(formatFinding(scanText('a.md', `x ${REAL}`)[0]), `a.md:1: ipv4 (length ${REAL.length}, hash ${matchHash(REAL)})`);
    });
});

describe('the content rules', () => {
    test('private keys (PEM, OpenSSH, PuTTY), OpenRouter keys, Hetzner tokens and real IPv4 addresses are found', () => {
        assert.deepEqual(kinds(`key: ${PEM}`), ['private-key']);
        assert.deepEqual(kinds(SSH), ['private-key']);
        assert.deepEqual(kinds(PPK), ['private-key']);
        assert.deepEqual(kinds(`OPENROUTER_API_KEY=${OR_KEY}`), ['openrouter-key']);
        assert.deepEqual(kinds(`HCLOUD_TOKEN=${HETZNER}`), ['hetzner-token']);
        assert.deepEqual(kinds(`ssh root@${REAL}`), ['ipv4']);
    });

    test('#390 review 6: a Hetzner token after "/" or before "=" counts; only a sha512-/sha1- (integrity) value is left alone', () => {
        assert.deepEqual(kinds(`https://x/${HETZNER}`), ['hetzner-token']);
        assert.deepEqual(kinds(`${HETZNER}=`), ['hetzner-token']);
        const b64 = crypto.randomBytes(96).toString('base64');
        assert.deepEqual(kinds(`"integrity": "sha512-${b64}"`), []);
        assert.deepEqual(kinds(`sha1-${crypto.randomBytes(48).toString('base64')}`), []);
        assert.deepEqual(kinds(crypto.createHash('sha256').update('x').digest('hex')), [], 'a SHA-256 is hex');
        assert.deepEqual(kinds(['sk', 'or', 'v1', ''].join('-')), [], 'the key prefix alone');
    });

    test('#390 review 5: IPv4 after "-" or "." and before "-" counts, and the reversed form in a your-server.de name', () => {
        for (const s of [`host-${REAL}`, `a.${REAL}`, `${REAL}-x`, `"${REAL}"`, `dev${REAL}`]) assert.deepEqual(kinds(s), ['ipv4'], s);
        const rev = q(34, 216, 184, 93);
        assert.deepEqual(kinds(`static.${rev}.clients.your-server.de`), ['ipv4'], 'reversed in a Hetzner name, once');
        assert.deepEqual(kinds(`static.${q(7, 2, 0, 192)}.clients.your-server.de`), [], 'a documentation address reversed');
    });

    test('#390 review 5: only version contexts are exempt: v prefix, .jar, a longer dotted run, a leading zero, a JSON "version" value', () => {
        for (const s of [`v${GOOGLE}`, `mod-${GOOGLE}.jar`, `x ${GOOGLE}.5`, `${q(1, 2)}.${GOOGLE}`, `forge ${q(1, 12, 2, '024')}`, `"version": "${GOOGLE}"`]) {
            assert.deepEqual(kinds(s), [], s);
        }
        assert.deepEqual(kinds(`"name": "${GOOGLE}"`), ['ipv4'], 'only a "version" value');
        for (const ip of [q(192, 0, 2, 10), q(198, 51, 100, 7), q(203, 0, 113, 250), q(127, 0, 0, 53), q(0, 0, 0, 0), q(300, 1, 1, 1)]) {
            assert.deepEqual(kinds(`at ${ip}`), [], ip);
        }
        assert.equal(isRealIPv4(GOOGLE), true);
    });
});

describe('#390 review 4: file names that must never be committed', () => {
    test('env files, token caches, SSH and PuTTY keys, any case of nmp-cache', () => {
        for (const p of ['.env', 'deploy/.env.local', 'deploy/bot.env', '.envrc', 'keys.json', 'a/b.token', 'x/nmp-cache/f.json', 'x/NMP-Cache/f.json',
            'a/1a2b_live-cache.json', 'a/x_mca-cache.json', 'a/x_xbl-cache.json', 'id_ed25519', 'k/id_deploy', 'k/deploy_ed25519', 'k/x_rsa', 'k/x_ecdsa',
            'c.pem', 'c.key', 'c.p12', 'c.pfx', 'c.ppk']) {
            assert.ok(secretFile(p), p);
        }
        for (const p of ['.env.example', 'deploy/cx23/bot.env.example', 'id_ed25519.pub', 'k/deploy_ed25519.pub', 'keys.example.json', 'src/tokens.js', 'environment.md', 'x/cache.json']) {
            assert.equal(secretFile(p), null, p);
        }
    });
});

describe('a git checkout', () => {
    test('#390 review 3 and 7: test/evidence gets every rule but ipv4; symlinks and binaries skipped; a large file scanned in chunks', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-scan-repo-'));
        const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { encoding: 'utf8' });
        git('init', '-q');
        fs.writeFileSync(path.join(dir, 'ok.js'), 'const x = 1;\n');
        fs.writeFileSync(path.join(dir, 'leak.md'), `host ${REAL}\n`);
        fs.writeFileSync(path.join(dir, '.env'), `OPENROUTER_API_KEY=${OR_KEY}\n`);
        fs.mkdirSync(path.join(dir, 'test', 'evidence'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'test', 'evidence', 'run.log'), `at ${REAL} key ${OR_KEY}\n`);
        fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, ...Buffer.from(OR_KEY)]));
        fs.writeFileSync(path.join(dir, 'big.txt'), `${OR_KEY}\n${'x'.repeat(5000)}\n`);
        fs.symlinkSync('leak.md', path.join(dir, 'link.md'));
        git('add', '-A');
        const r = scanRepo(dir, { allowFile: path.join(dir, 'none.txt'), chunkBytes: 1024 });
        const got = r.findings.map((f) => `${f.path}:${f.kind}`).sort();
        assert.deepEqual(got, ['.env:openrouter-key', '.env:secret-file', 'big.txt:openrouter-key', 'leak.md:ipv4', 'test/evidence/run.log:openrouter-key']);
        assert.equal(r.skippedLinks, 1);
    });

    test('#390 re-review: a file is read in chunks of whole lines: a secret late in a big file, or across a chunk edge, is found on its line', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-scan-chunk-'));
        const f = path.join(dir, 'big.txt');
        const filler = Array.from({ length: 300 }, (_, i) => `line ${i} ${'y'.repeat(40)}`).join('\n');
        fs.writeFileSync(f, `${filler}\nkey ${OR_KEY}\n${filler}\nhost ${REAL}`);
        for (const chunkBytes of [64, 1000, 4096, 1 << 20]) {
            const found = scanFile('big.txt', f, new Set(), { chunkBytes });
            assert.deepEqual(found.map((x) => `${x.line}:${x.kind}`), ['301:openrouter-key', '602:ipv4'], `chunk ${chunkBytes}`);
        }
        fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([1, 0, 2]));
        assert.equal(scanFile('bin.dat', path.join(dir, 'bin.dat'), new Set()), null, 'binary');
    });

    test('the CLI scans a 3 MB file in full, names skipped symlinks, and prints no match', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-scan-cli-'));
        const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
        git('init', '-q');
        fs.writeFileSync(path.join(dir, 'leak.md'), `host ${REAL}\n`);
        fs.writeFileSync(path.join(dir, 'big.txt'), `${'x'.repeat(3 * 1024 * 1024)}\nhost ${REAL}\n`);
        fs.symlinkSync('leak.md', path.join(dir, 'link.md'));
        git('add', '-A');
        let out = '';
        try { execFileSync(process.execPath, [path.join(here, '..', 'tools', 'secret-scan.mjs'), '--root', dir], { encoding: 'utf8' }); } catch (e) { out = e.stdout; assert.equal(e.status, 1); }
        assert.match(out, /^leak\.md:1: ipv4 \(length \d+, hash [0-9a-f]{16}\)$/m);
        assert.match(out, /^big\.txt:2: ipv4 \(length \d+, hash [0-9a-f]{16}\)$/m, 'past 3 MB, on its line');
        assert.match(out, /secret-scan: 2 finding\(s\) in 3 tracked files \(\d+ ms\); 1 symlink\(s\) skipped/);
        assert.ok(!out.includes(REAL), 'the address is never printed');
    });
});
