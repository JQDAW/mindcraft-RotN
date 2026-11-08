// Offline tests for .github/workflows/ci-ubuntu-2604.yml against deploy/cx23/bootstrap.sh (G4 step 0 C1, 2026-11-08:
// npm ci on the CX23 failed because gl's webgl.node needs libX11.so.6 and libXext.so.6, which CI had only through a
// Recommends chain). The workflow installs exactly bootstrap.sh's SETUP_PACKAGES with --no-install-recommends, and
// after npm ci every native binding must link (ldd). The steps' own bash runs here with a fake apt-get and a fake
// ldd; nothing is installed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { windowsShellSkip } from './fixtures/windows-skip.mjs';
import { stepScript, stepShell } from './fixtures/workflow-step.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const WF = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci-ubuntu-2604.yml'), 'utf8');
const BOOT = fs.readFileSync(path.join(ROOT, 'deploy', 'cx23', 'bootstrap.sh'), 'utf8');
const LIST = /^readonly SETUP_PACKAGES="([a-z0-9.+ -]*)"$/m.exec(BOOT)?.[1].split(' ');

describe('ci-ubuntu-2604 and bootstrap.sh: one package list, no recommends', () => {
    test('bootstrap.sh has one SETUP_PACKAGES line with gl\'s X libraries, and installs it (and nodejs) with --no-install-recommends', () => {
        assert.deepEqual(LIST, ['unattended-upgrades', 'git', 'ufw', 'ca-certificates', 'curl', 'gnupg', 'libx11-6', 'libxext6']);
        assert.match(BOOT, /libx11-6, libxext6: gl's prebuilt binding .*webgl\.node.* needs libX11\.so\.6 and\n#\s+libXext\.so\.6/);
        const installs = BOOT.split('\n').filter((l) => /apt-get install/.test(l) && !/^\s*#/.test(l));
        assert.equal(installs.length, 2);
        for (const l of installs) assert.match(l, /apt-get install -y -q --no-install-recommends /, l);
        assert.ok(installs.some((l) => l.endsWith('--no-install-recommends $SETUP_PACKAGES')));
    });

    test('every apt-get install in the workflow has --no-install-recommends; the checkout\'s git and ca-certificates are on the list; the step order', () => {
        const installs = WF.split('\n').filter((l) => /apt-get install/.test(l) && !/^\s*#/.test(l));
        assert.equal(installs.length, 4);
        for (const l of installs) assert.match(l, /apt-get install -y -q --no-install-recommends /, l);
        assert.match(WF, /apt-get install -y -q --no-install-recommends git ca-certificates\n/);
        // The test-only tools, after the native checks: jq, and ssh-keygen for the test-server tooling's tests
        // (#409's second CI run: 44 tests failed on "ssh-keygen: command not found" once git's Recommends were cut).
        assert.match(WF, /apt-get install -y -q --no-install-recommends jq openssh-client\n/);
        for (const p of ['git', 'ca-certificates']) assert.ok(LIST.includes(p), p);
        const at = (n) => WF.indexOf(`- name: ${n}`);
        const order = [at('git and ca-certificates for the checkout'), WF.indexOf('uses: actions/checkout@'), at('apt packages, exactly bootstrap.sh'), at('Node 22 from NodeSource'),
            at('npm ci'), at('Every native binding links'), at('The native modules load'), at('Test-only tools (jq, openssh-client'), at('npm test')];
        assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), String(order));
    });
});

describe('the workflow\'s own bash (fakes on PATH)', { skip: windowsShellSkip('ci-ubuntu-2604 steps', '2 s') }, () => {
    const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-ci2604-'));
    const fake = (dir, name, body) => fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });

    test('the package step installs exactly bootstrap.sh\'s list, with no recommends; a missing line, or git not on it, fails', () => {
        const t = tmp();
        const bin = path.join(t, 'bin');
        fs.mkdirSync(bin);
        fake(bin, 'apt-get', `printf '%s\\n' "$*" >> "${t}/apt.calls"`);
        // Under the shell GitHub uses for it: a container job's default is `sh -e` (dash).
        const [sh, ...shArgs] = stepShell(WF, 'apt packages, exactly bootstrap.sh', { container: true });
        assert.equal(sh, 'sh');
        const script = stepScript(WF, 'apt packages, exactly bootstrap.sh');
        const run = (ws) => spawnSync(sh, [...shArgs, script], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, GITHUB_WORKSPACE: ws } });
        const r = run(ROOT);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(fs.readFileSync(path.join(t, 'apt.calls'), 'utf8').trim(), `install -y -q --no-install-recommends ${LIST.join(' ')}`);
        // A copy of bootstrap.sh without the line, or with a list that lacks git: refused, nothing installed.
        for (const [label, text, re] of [['no line', BOOT.replace(/^readonly SETUP_PACKAGES=.*$/m, ''), /no SETUP_PACKAGES line/],
            ['no git', BOOT.replace(/^(readonly SETUP_PACKAGES=".*?) git /m, '$1 '), /git was installed for the checkout but is not on bootstrap\.sh's list/]]) {
            const ws = tmp();
            fs.mkdirSync(path.join(ws, 'deploy', 'cx23'), { recursive: true });
            fs.writeFileSync(path.join(ws, 'deploy', 'cx23', 'bootstrap.sh'), text);
            fs.rmSync(path.join(t, 'apt.calls'), { force: true });
            const x = run(ws);
            assert.equal(x.status, 1, label);
            assert.match(x.stdout, re, label);
            assert.ok(!fs.existsSync(path.join(t, 'apt.calls')), `${label}: nothing installed`);
        }
    });

    test('every run step of this container job parses under the shell GitHub gives it (sh -e unless it declares bash)', () => {
        const names = [...WF.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1]).filter((n) => /\n {8}(shell: \S+\n {8})?run: \|/.test(WF.slice(WF.indexOf(`- name: ${n}`), WF.indexOf(`- name: ${n}`) + 400)));
        assert.ok(names.length >= 8, names.join(' | '));
        for (const n of names) {
            const [sh] = stepShell(WF, n, { container: true });
            const r = spawnSync(sh, ['-n', '-c', stepScript(WF, n)], { encoding: 'utf8' });
            assert.equal(r.status, 0, `${n} (${sh}): ${r.stderr}`);
        }
    });

    test('the ldd gate: every ELF .node must link; a "not found" fails, named; non-ELF files are skipped; no binding at all fails', () => {
        const script = stepScript(WF, 'Every native binding links');
        // It needs bash (process substitution), so it declares it: under the container default `sh -e` it fails to parse.
        const [sh, ...shArgs] = stepShell(WF, 'Every native binding links', { container: true });
        assert.equal(sh, 'bash', 'the ldd step declares shell: bash');
        const setup = (files) => {
            const ws = tmp();
            const bin = path.join(ws, '.bin');
            fs.mkdirSync(bin);
            // The fake ldd: a file whose name contains "missing" lacks libX11.so.6, the others link.
            fake(bin, 'ldd', 'case "$1" in *missing*) printf \'\\tlibX11.so.6 => not found\\n\\tlibc.so.6 => /lib/libc.so.6\\n\' ;; *) printf \'\\tlibc.so.6 => /lib/libc.so.6\\n\' ;; esac');
            for (const [rel, elf] of files) {
                fs.mkdirSync(path.join(ws, 'node_modules', path.dirname(rel)), { recursive: true });
                fs.writeFileSync(path.join(ws, 'node_modules', rel), elf ? Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(16)]) : 'MZ not an ELF');
            }
            return spawnSync(sh, [...shArgs, script], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, GITHUB_WORKSPACE: ws } });
        };
        const ok = setup([['canvas/build/Release/canvas.node', true], ['gl/build/Release/webgl.node', true], ['x/prebuilds/win32-x64/x.node', false]]);
        assert.equal(ok.status, 0, ok.stdout + ok.stderr);
        assert.match(ok.stdout, /links: node_modules\/canvas\/build\/Release\/canvas\.node/);
        assert.match(ok.stdout, /skipped \(not ELF\): node_modules\/x\/prebuilds\/win32-x64\/x\.node/);
        assert.match(ok.stdout, /2 native binding\(s\) checked/);
        const bad = setup([['canvas/build/Release/canvas.node', true], ['gl/build/Release/webgl-missing.node', true]]);
        assert.equal(bad.status, 1);
        assert.match(bad.stdout, /::error::node_modules\/gl\/build\/Release\/webgl-missing\.node needs a library that the CX23's packages do not provide:\n\s+libX11\.so\.6 => not found/);
        assert.match(bad.stdout, /links: node_modules\/canvas\/build\/Release\/canvas\.node/, 'the others are still checked');
        const none = setup([['x/prebuilds/win32-x64/x.node', false]]);
        assert.equal(none.status, 1);
        assert.match(none.stdout, /::error::no native \.node binding under node_modules/);
    });
});
