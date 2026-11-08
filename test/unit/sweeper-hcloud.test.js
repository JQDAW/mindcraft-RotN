// Offline tests for the test-server sweeper's hcloud install (.github/workflows/test-server-sweeper.yml): the step's
// own bash, taken from the workflow file, runs with a fake `curl` on PATH (real sha256sum and tar) against a stand-in
// tarball whose SHA-256 is the pin. The cached copy is verified on every run, a bad one is never used, a download is
// retried a bounded number of times, and nothing unverified is extracted. Plus the static pins. No network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { windowsShellSkip } from './fixtures/windows-skip.mjs';
import { stepScript } from './fixtures/workflow-step.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WF = fs.readFileSync(path.join(here, '..', '..', '.github', 'workflows', 'test-server-sweeper.yml'), 'utf8');

const SCRIPT = stepScript(WF, 'Install hcloud');

function setup() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-hcloud-'));
    const dirs = { home: path.join(tmp, 'home'), runner: path.join(tmp, 'runner'), bin: path.join(tmp, 'fakebin'), src: path.join(tmp, 'src') };
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
    // The stand-in release tarball, holding an `hcloud` file, and its SHA-256 as the pin.
    fs.writeFileSync(path.join(dirs.src, 'hcloud'), '#!/bin/sh\necho hcloud stand-in\n', { mode: 0o755 });
    const good = path.join(tmp, 'good.tar.gz');
    assert.equal(spawnSync('tar', ['-czf', good, '-C', dirs.src, 'hcloud']).status, 0);
    const bad = path.join(tmp, 'bad.tar.gz');
    fs.writeFileSync(bad, 'not the pinned release');
    const sha = crypto.createHash('sha256').update(fs.readFileSync(good)).digest('hex');
    // A fake curl: logs each call; fails the first FAKE_CURL_FAIL calls (exit 22, as -f does on a 504); then writes
    // FAKE_CURL_BODY to the -o target.
    const calls = path.join(tmp, 'curl.calls');
    fs.writeFileSync(path.join(dirs.bin, 'curl'), `#!/usr/bin/env bash
echo "$*" >> "${calls}"
n=$(wc -l < "${calls}")
if [ "$n" -le "\${FAKE_CURL_FAIL:-0}" ]; then echo "curl: (22) The requested URL returned error: 504" >&2; exit 22; fi
out=; prev=
for a in "$@"; do [ "$prev" = "-o" ] && out=$a; prev=$a; done
cp "\${FAKE_CURL_BODY}" "$out"
`, { mode: 0o755 });
    const out = path.join(tmp, 'github_output');
    const gpath = path.join(tmp, 'github_path');
    const cached = path.join(dirs.home, '.cache', 'rotn-hcloud', 'hcloud-linux-amd64.tar.gz');
    const run = (env = {}) => {
        const r = spawnSync('bash', ['-c', SCRIPT], {
            encoding: 'utf8', timeout: 60000,
            env: { PATH: `${dirs.bin}:${process.env.PATH}`, HOME: dirs.home, RUNNER_TEMP: dirs.runner, GITHUB_OUTPUT: out, GITHUB_PATH: gpath,
                HCLOUD_VERSION: 'v0.0.0', HCLOUD_SHA256: sha, HCLOUD_RETRY_S: '0', FAKE_CURL_BODY: good, ...env },
        });
        const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
        return { code: r.status, all: `${r.stdout}\n${r.stderr}`, curl: read(calls).split('\n').filter(Boolean), output: read(out), path: read(gpath),
            extracted: fs.existsSync(path.join(dirs.runner, 'bin', 'hcloud')) };
    };
    const cache = (file) => { fs.mkdirSync(path.dirname(cached), { recursive: true }); fs.copyFileSync(file, cached); };
    return { run, cache, cached, good, bad, sha };
}

describe('the sweeper workflow: the hcloud pins, the cache and the steps', () => {
    test('the version and checksum pins are kept; the cache key is both; cache actions pinned by SHA; save only after a fresh verified download', () => {
        assert.match(WF, /^ {6}HCLOUD_VERSION: v1\.70\.2$/m);
        assert.match(WF, /^ {6}HCLOUD_SHA256: b844bd28240112b0254183ba5266d0a0f59a6167c196636936459755efb88050$/m);
        const keys = [...WF.matchAll(/^ {10}key: (.*)$/gm)].map((m) => m[1]);
        assert.deepEqual(keys, Array(2).fill('hcloud-linux-amd64-${{ env.HCLOUD_VERSION }}-${{ env.HCLOUD_SHA256 }}'));
        for (const m of WF.matchAll(/uses: (\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
        assert.match(WF, /if: steps\.hcloud\.outputs\.fresh == 'true' && steps\.hcloud-cache\.outputs\.cache-hit != 'true'\n {8}uses: actions\/cache\/save@/);
        const order = ['Restore the verified hcloud download', 'Install hcloud', 'Save the verified hcloud download', 'Sweep expired labelled test resources'].map((n) => WF.indexOf(`- name: ${n}`));
        assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), String(order));
        assert.match(SCRIPT, /^verified "\$tgz"$/m, 'verified again right before the extract');
    });
});

describe('the hcloud install step (its own bash, a fake curl)', { skip: windowsShellSkip('the hcloud install step', '2 s') }, () => {
    test('a cached copy that matches the pin: no download, extracted, fresh=false', () => {
        const s = setup();
        s.cache(s.good);
        const r = s.run();
        assert.equal(r.code, 0, r.all);
        assert.deepEqual(r.curl, []);
        assert.match(r.all, /the cached download matches HCLOUD_SHA256/);
        assert.equal(r.output.trim(), 'fresh=false');
        assert.ok(r.extracted);
        assert.match(r.path, /runner\/bin/);
    });

    test('no cache: one download, verified, kept for the cache, extracted, fresh=true', () => {
        const s = setup();
        const r = s.run();
        assert.equal(r.code, 0, r.all);
        assert.equal(r.curl.length, 1);
        assert.match(r.curl[0], /--proto =https --tlsv1\.2 --max-time 45 -o .*hcloud-linux-amd64\.tar\.gz\.part https:\/\/github\.com\/hetznercloud\/cli\/releases\/download\/v0\.0\.0\/hcloud-linux-amd64\.tar\.gz$/);
        assert.equal(r.output.trim(), 'fresh=true');
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(s.cached)).digest('hex'), s.sha);
        assert.ok(r.extracted);
    });

    test('an outage: two 504s, then the third try succeeds', () => {
        const s = setup();
        const r = s.run({ FAKE_CURL_FAIL: '2' });
        assert.equal(r.code, 0, r.all);
        assert.equal(r.curl.length, 3);
        assert.match(r.all, /hcloud download try 1 failed .*trying again in 0 s/);
        assert.match(r.all, /hcloud download try 2 failed/);
        assert.ok(r.extracted);
    });

    test('a longer outage with no cache: three tries, then a clear error; nothing extracted or cached', () => {
        const s = setup();
        const r = s.run({ FAKE_CURL_FAIL: '9' });
        assert.equal(r.code, 1);
        assert.equal(r.curl.length, 3, 'bounded');
        assert.match(r.all, /::error::no verified hcloud v0\.0\.0: 3 downloads failed \(GitHub release downloads down\?\) and no verified cached copy/);
        assert.ok(!r.extracted);
        assert.ok(!fs.existsSync(s.cached) && !fs.existsSync(`${s.cached}.part`));
    });

    test('a cached copy that does not match the pin is discarded, never used: a fresh verified download replaces it', () => {
        const s = setup();
        s.cache(s.bad);
        const r = s.run();
        assert.equal(r.code, 0, r.all);
        assert.match(r.all, /::warning::the cached hcloud download does not match HCLOUD_SHA256: discarded, downloading/);
        assert.equal(r.curl.length, 1);
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(s.cached)).digest('hex'), s.sha);
    });

    test('a download that does not match the pin counts as failed (retried), and is never extracted', () => {
        const s = setup();
        const r = s.run({ FAKE_CURL_BODY: s.bad });
        assert.equal(r.code, 1);
        assert.equal(r.curl.length, 3);
        assert.match(r.all, /did not match HCLOUD_SHA256/);
        assert.ok(!r.extracted);
        const corrupt = setup();
        corrupt.cache(corrupt.bad);
        const r2 = corrupt.run({ FAKE_CURL_FAIL: '9' });
        assert.equal(r2.code, 1, 'a bad cache and an outage: an error, never the bad copy');
        assert.ok(!r2.extracted);
    });
});
