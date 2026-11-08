// Offline tests for the CX23 tooling in deploy/cx23/ (brief deliverable 5): the unit template, the
// env check, the control wrapper, bootstrap.sh and deploy.sh. System commands are fakes
// (fixtures/fake-sys.sh) and every path is under a temp ROOT; deploy.sh uses real git and tar on a
// throwaway local repo. Nothing connects to the CX23.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { windowsShellSkip } from './fixtures/windows-skip.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const CX = path.join(repo, 'deploy', 'cx23');
const fwd = (p) => p.replace(/\\/g, '/');
// An absolute path as bash sees it (C:/x -> /c/x on Windows), for values the scripts check with [[ $p == /* ]].
const posix = (p) => fwd(p).replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
const FPR = '6F71F525282841EEDAF851B42F59B5F99B1BE0B4';
const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFake test@example.invalid';

function findBash() {
    if (process.env.BASH_BIN) return process.env.BASH_BIN;
    if (process.platform === 'win32') {
        for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) {
            if (fs.existsSync(p)) return p;
        }
    }
    return 'bash';
}
const BASH = findBash();

const FAKES = ['id', 'getent', 'useradd', 'usermod', 'passwd', 'chown', 'chmod', 'chgrp', 'apt-get', 'curl', 'gpg', 'node',
    'swapon', 'fallocate', 'mkswap', 'sysctl', 'ufw', 'visudo', 'sshd', 'systemctl', 'npm', 'sudo', 'ln', 'journalctl'];
const ACCEPTED = 'Accepted publickey for deploy from 203.0.113.5 port 50122 ssh2: ED25519 SHA256:AAAAfakefakefake';

let tmp, ROOT, bin, logFile;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-cx23-'));
    ROOT = fwd(path.join(tmp, 'root'));
    bin = path.join(tmp, 'bin');
    logFile = fwd(path.join(tmp, 'calls.log'));
    fs.mkdirSync(bin);
    fs.mkdirSync(ROOT);
    for (const n of FAKES) {
        fs.writeFileSync(path.join(bin, n), `#!/usr/bin/env bash\nexec bash "${fwd(path.join(here, 'fixtures', 'fake-sys.sh'))}" ${n} "$@"\n`, { mode: 0o755 });
    }
});

// run SCRIPT ARGS with the fakes first on PATH (Git Bash puts /usr/bin first, so PATH is set inside bash).
function run(scriptPath, args, extraEnv = {}, fakes = true) {
    const argv = fakes
        ? ['-c', 'PATH="$(cygpath -u "$1" 2>/dev/null || echo "$1"):$PATH"; shift; exec bash "$@"', '_', fwd(bin), fwd(scriptPath), ...args]
        : [fwd(scriptPath), ...args];
    // A value of undefined removes that variable (so an inherited DEBUG or NODE_OPTIONS cannot leak in).
    const e = { ...process.env, ROOT, FAKE_LOG: logFile, ...extraEnv };
    for (const [k, v] of Object.entries(e)) if (v === undefined) delete e[k];
    const r = spawnSync(BASH, argv, { env: e, encoding: 'utf8', timeout: 120000 });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, all: `${r.stdout}\n${r.stderr}` };
}
const calls = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')) : []);
const called = (name) => calls().filter((c) => c[0] === name);
const callIndex = (pred) => calls().findIndex(pred);
const rootFile = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rootFile(p), 'utf8');
const exists = (p) => fs.existsSync(rootFile(p));

// ---------------------------------------------------------------- unit template
describe('mindcraft-rotn@.service', () => {
    const unit = fs.readFileSync(path.join(CX, 'mindcraft-rotn@.service'), 'utf8');
    const section = (name) => {
        const m = new RegExp(`^\\[${name}\\]\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm').exec(unit.replace(/\r/g, ''));
        return m ? m[1].split('\n').filter((l) => l && !l.startsWith('#')) : [];
    };
    const svc = section('Service');
    const has = (lines, kv) => lines.includes(kv);

    test('restart policy follows ADR 0003: always, but never after exit 0 or 3; rate-limited in [Unit]', () => {
        assert.ok(has(svc, 'Restart=always'));
        assert.ok(has(svc, 'RestartPreventExitStatus=0 3'));
        assert.ok(has(section('Unit'), 'StartLimitIntervalSec=600') && has(section('Unit'), 'StartLimitBurst=6'));
        assert.ok(!svc.some((l) => l.startsWith('StartLimit')), 'StartLimit* belongs in [Unit]');
    });

    test('the root-run name check comes before the service-user check', () => {
        assert.ok(svc.indexOf('ExecStartPre=+/usr/local/lib/mindcraft-rotn/check-env-names /etc/mindcraft-rotn/%i.env')
            < svc.indexOf('ExecStartPre=/usr/local/lib/mindcraft-rotn/check-env /etc/mindcraft-rotn/%i.env'));
    });

    test('single-bot service, per-bot env file, env check before start, non-root user, umask 0077', () => {
        for (const kv of ['Environment=MINDCRAFT_SINGLE_BOT_SERVICE=1', 'EnvironmentFile=/etc/mindcraft-rotn/%i.env',
            'ExecStartPre=+/usr/local/lib/mindcraft-rotn/check-env-names /etc/mindcraft-rotn/%i.env',
            'ExecStartPre=/usr/local/lib/mindcraft-rotn/check-env /etc/mindcraft-rotn/%i.env',
            'ExecStart=/usr/bin/node /opt/mindcraft-rotn/current/main.js', 'WorkingDirectory=/opt/mindcraft-rotn/current',
            'User=mindcraft-rotn', 'Group=mindcraft-rotn', 'UMask=0077']) assert.ok(has(svc, kv), kv);
    });

    test('hardening and caps from ops.md section 2; never MemoryDenyWriteExecute; no INSECURE_CODING', () => {
        for (const kv of ['NoNewPrivileges=yes', 'ProtectSystem=strict', 'ProtectHome=yes', 'PrivateTmp=yes', 'MemoryMax=1536M', 'MemoryHigh=1G'])
            assert.ok(has(svc, kv), kv);
        assert.ok(!/^MemoryDenyWriteExecute/m.test(unit));
        assert.ok(!/^[^#]*INSECURE_CODING/m.test(unit));
        assert.ok(has(svc, 'ReadWritePaths=/var/lib/mindcraft-rotn/%i /var/lib/mindcraft-rotn/bots'));
    });

    test('bot.env.example: token cache under the bot\'s state dir, placeholder key, nothing insecure', () => {
        const ex = fs.readFileSync(path.join(CX, 'bot.env.example'), 'utf8');
        assert.match(ex, /^MINDCRAFT_PROFILES_FOLDER=\/var\/lib\/mindcraft-rotn\/__BOT__\/msa$/m);
        assert.match(ex, /^OPENROUTER_API_KEY=<set-by-human-never-in-repo>$/m);
        assert.ok(!/^[^#]*INSECURE_CODING/m.test(ex));
        assert.ok(!/^[^#]*allow_insecure_coding/m.test(ex));
        assert.ok(!/^MINDCRAFT_SINGLE_BOT_SERVICE/m.test(ex), 'the unit sets it');
        assert.match(ex, /"auto_open_ui":false/);
        // G4 step 0: the default profile is one the repo has (FRCFLD's), not ./profiles/<bot>.json.
        assert.match(ex, /^PROFILES=\["\.\/profiles\/rotn-bot\.json"\]$/m);
        assert.ok(fs.existsSync(path.join(CX, '..', '..', 'profiles', 'rotn-bot.json')));
    });
});

// ---------------------------------------------------------------- check-env
describe('check-env (ExecStartPre)', () => {
    const good = () => {
        const pf = posix(path.join(tmp, 'msa'));
        const envf = posix(path.join(tmp, 'bot.env'));
        fs.mkdirSync(path.join(tmp, 'msa'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'bot.env'), 'x=1\n');
        const map = fwd(path.join(tmp, 'stat.map'));
        fs.writeFileSync(map, `${pf}\t700 mindcraft-rotn\n${envf}\t600 root\n`);
        fs.writeFileSync(path.join(bin, 'fake-stat'), `#!/usr/bin/env bash\nawk -F'\\t' -v p="\${@: -1}" '$1 == p { print $2 }' "${map}"\n`, { mode: 0o755 });
        return {
            envf, pf, map,
            env: { FAKE_OUT_id: 'mindcraft-rotn', MINDCRAFT_SINGLE_BOT_SERVICE: '1', MINDCRAFT_PROFILES_FOLDER: pf,
                OPENROUTER_API_KEY: 'sk-or-v1-SECRET-VALUE-123', SETTINGS_JSON: '{"host":"mc.example.invalid","port":25565,"auth":"microsoft","auto_open_ui":false}',
                NODE_OPTIONS: '--max-old-space-size=768', PROFILES: '["./profiles/rotn-bot.json"]', MINECRAFT_PORT: '25565', MINDSERVER_PORT: '8080',
                INSECURE_CODING: undefined, BLOCKED_ACTIONS: undefined, DEBUG: undefined, NODE_PATH: undefined },
        };
    };
    // Tool paths are flags (the unit passes none): real node, a fake stat, this repo as the "release".
    const check = (g, over = {}) => run(path.join(CX, 'check-env.sh'),
        ['--node', fwd(process.execPath), '--stat', fwd(path.join(bin, 'fake-stat')), '--release', fwd(repo), g.envf], { ...g.env, ...over });

    test('a safe environment passes', () => {
        const g = good();
        const r = check(g);
        assert.equal(r.code, 0, r.all);
        assert.equal(check(g, { DEBUG: 'minecraft-protocol,-prismarine-auth*' }).code, 0, 'a DEBUG that cannot reach prismarine-auth is fine');
        assert.equal(check(g, { SETTINGS_JSON: undefined }).code, 0, 'no SETTINGS_JSON is fine');
    });

    test('values are parsed like main.js: escaped, unknown and disallowed SETTINGS_JSON keys refuse (PR #30 finding 1)', () => {
        const g = good();
        for (const [json, re] of [
            ['{"allow_insecure_coding":true}', /keys outside auth, host, port, auto_open_ui: "allow_insecure_coding"/],
            ['{"\\u0061llow_insecure_coding":true}', /keys outside .*"allow_insecure_coding"/], // escaped: grep would miss it
            ['{"host":"x","blocked_actions":[]}', /keys outside .*"blocked_actions"/],
            ['{"__proto__":{"allow_insecure_coding":true}}', /keys outside .*"__proto__"/],
            ['{"profiles":["./x.json"]}', /keys outside .*"profiles"/],
            // skills-rotn's task givers (#146): settings.js only; the Server switch is test-only, never on the CX23.
            ['{"allow_server_task_giver":true}', /keys outside .*"allow_server_task_giver"/],
            ['{"allow_server_task_giver":false}', /keys outside .*"allow_server_task_giver"/],
            ['{"task_givers":["Server"]}', /keys outside .*"task_givers"/],
            ['{"host":"x","task_givers":["JQDAW"]}', /keys outside .*"task_givers"/],
            ['{"auto_open_ui":true}', /auto_open_ui may only be false/],
            ['{"auth":"offline"}', /auth must be "microsoft"/],
            ['{"port":"25565"}', /port must be an integer/],
            ['{"host":"a b"}', /host must be a host name/],
            ['[1]', /must be a JSON object/],
            ['null', /must be a JSON object/],
            ['{"host":', /not valid JSON/],
        ]) {
            const r = check(g, { SETTINGS_JSON: json });
            assert.equal(r.code, 1, json);
            assert.match(r.stderr, re, json);
        }
    });

    test('INSECURE_CODING and BLOCKED_ACTIONS refuse when set at all; DEBUG reaching prismarine-auth refuses; NODE_OPTIONS only a heap size', () => {
        const g = good();
        for (const [over, re] of [
            [{ INSECURE_CODING: '' }, /INSECURE_CODING is set/],
            [{ INSECURE_CODING: 'false' }, /INSECURE_CODING is set/],
            [{ BLOCKED_ACTIONS: '[]' }, /BLOCKED_ACTIONS is set/],
            [{ BLOCKED_ACTIONS: '' }, /BLOCKED_ACTIONS is set/],
            [{ DEBUG: 'prismarine-auth' }, /DEBUG could enable prismarine-auth/],
            [{ DEBUG: '*' }, /DEBUG could enable prismarine-auth/],
            [{ DEBUG: 'minecraft-protocol prismarine-*' }, /DEBUG could enable prismarine-auth/],
            [{ NODE_OPTIONS: '--max-old-space-size=768 --require /tmp/x.js' }, /NODE_OPTIONS may only hold --max-old-space-size/],
            [{ NODE_OPTIONS: '--import=data:text/javascript,0' }, /NODE_OPTIONS may only hold/],
            [{ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, /NODE_TLS_REJECT_UNAUTHORIZED is set: not allowed/],
            [{ HTTPS_PROXY: 'http://proxy.example.invalid:3128' }, /HTTPS_PROXY is set/],
            [{ https_proxy: 'http://proxy.example.invalid:3128' }, /https_proxy is set/],
            [{ ALL_PROXY: 'socks5://x.invalid' }, /ALL_PROXY is set/],
            // LD_PRELOAD is in the deny list too, but setting it here would affect the test's own bash; the
            // check-env-names tests cover it in the env file.
            [{ NODE_EXTRA_CA_CERTS: '/tmp/ca.pem' }, /NODE_EXTRA_CA_CERTS is set/],
            [{ NODE_PATH: '/tmp/mods' }, /NODE_PATH is set/],
            // Values of the other allowlisted names (PR #58 review follow-up).
            [{ PROFILES: '["/etc/passwd"]' }, /PROFILES must be a non-empty JSON array of "\.\/profiles\/<name>\.json" paths/],
            [{ PROFILES: '["./profiles/../settings.json"]' }, /PROFILES must be/],
            [{ PROFILES: '["./andy.json"]' }, /PROFILES must be/],
            [{ PROFILES: '[]' }, /PROFILES must be/],
            [{ PROFILES: '"./profiles/x.json"' }, /PROFILES must be/],
            [{ PROFILES: '[./profiles/x.json' }, /PROFILES is not valid JSON/],
            // G4 step 0 (2026-11-08): a profile path the release does not have (the old example's frcfld.json) refuses,
            // before main.js would die with ENOENT and systemd hit its start limit.
            [{ PROFILES: '["./profiles/frcfld.json"]' }, /PROFILES names \.\/profiles\/frcfld\.json, which the release \(.*\) does not have/],
            [{ PROFILES: '["./profiles/rotn-bot.json", "./profiles/nope.json"]' }, /PROFILES names \.\/profiles\/nope\.json, which the release/],
            [{ MINECRAFT_PORT: '0' }, /MINECRAFT_PORT must be a port number 1\.\.65535/],
            [{ MINECRAFT_PORT: '70000' }, /MINECRAFT_PORT must be a port/],
            [{ MINDSERVER_PORT: '80a' }, /MINDSERVER_PORT must be a port/],
            [{ MINDSERVER_PORT: '' }, /MINDSERVER_PORT must be a port/],
        ]) {
            const r = check(g, over);
            assert.equal(r.code, 1, JSON.stringify(over));
            assert.match(r.stderr, re, JSON.stringify(over));
        }
        // Without the release's auth guard, any DEBUG refuses (fail closed).
        const r = run(path.join(CX, 'check-env.sh'), ['--node', fwd(process.execPath), '--stat', fwd(path.join(bin, 'fake-stat')),
            '--release', fwd(path.join(tmp, 'no-release')), g.envf], { ...g.env, DEBUG: 'minecraft-protocol' });
        assert.equal(r.code, 1);
        assert.match(r.stderr, /auth guard could not be loaded/);
    });

    test('the checker\'s tool paths are fixed: env vars cannot redirect them; NODE_OPTIONS does not reach the checker', () => {
        const src = fs.readFileSync(path.join(CX, 'check-env.sh'), 'utf8');
        assert.match(src, /^NODE_BIN=\/usr\/bin\/node STAT_BIN=\/usr\/bin\/stat RELEASE=\/opt\/mindcraft-rotn\/current/m);
        assert.ok(!/\$\{(NODE_BIN|STAT_BIN|RELEASE):-/.test(src), 'no env defaults for tool paths');
        assert.match(src, /env -u NODE_OPTIONS -u NODE_PATH/);
        const g = good();
        // A STAT_BIN in the environment is ignored: the fake stat given by flag still decides.
        assert.equal(check(g, { STAT_BIN: '/bin/false' }).code, 0);
    });

    test('every unsafe setting refuses, and no variable value is ever printed', () => {
        const g = good();
        const cases = [
            [{ INSECURE_CODING: '1' }, /INSECURE_CODING is set/],
            [{ SETTINGS_JSON: '{"allow_insecure_coding":true}', OPENROUTER_API_KEY: 'sk-or-v1-SECRET-VALUE-123' }, /keys outside/],
            [{ MINDCRAFT_SINGLE_BOT_SERVICE: '0' }, /MINDCRAFT_SINGLE_BOT_SERVICE must be 1/],
            [{ MINDCRAFT_SINGLE_BOT_SERVICE: '' }, /MINDCRAFT_SINGLE_BOT_SERVICE must be 1/],
            [{ MINDCRAFT_PROFILES_FOLDER: '' }, /MINDCRAFT_PROFILES_FOLDER is not set/],
            [{ MINDCRAFT_PROFILES_FOLDER: 'msa' }, /must be an absolute path/],
            [{ MINDCRAFT_PROFILES_FOLDER: posix(path.join(tmp, 'nope')) }, /is not a directory/],
            [{ OPENROUTER_API_KEY: '' }, /OPENROUTER_API_KEY is empty or still the placeholder/],
            [{ OPENROUTER_API_KEY: '<set-by-human-never-in-repo>' }, /still the placeholder/],
        ];
        for (const [over, re] of cases) {
            const r = check(g, over);
            assert.equal(r.code, 1, JSON.stringify(over));
            assert.match(r.stderr, re, JSON.stringify(over));
            assert.match(r.stderr, /refusing to start/);
            assert.ok(!r.all.includes('SECRET-VALUE'), 'the key is never printed');
        }
    });

    test('a loose token-cache folder or env file refuses', () => {
        for (const [pfLine, envLine, re] of [
            ['755 mindcraft-rotn', '600 root', /has mode 755, must be 700/],
            ['700 deploy', '600 root', /owned by deploy, must be mindcraft-rotn/],
            ['700 mindcraft-rotn', '640 root', /env file has mode 640, must be 0600/], // group-readable: deploy could read the key
            ['700 mindcraft-rotn', '644 root', /env file has mode 644/],
            ['700 mindcraft-rotn', '660 root', /env file has mode 660/],
            ['700 mindcraft-rotn', '600 deploy', /env file is owned by deploy, must be root/],
        ]) {
            const g = good();
            fs.writeFileSync(g.map, `${g.pf}\t${pfLine}\n${g.envf}\t${envLine}\n`);
            const r = check(g);
            assert.equal(r.code, 1, `${pfLine} / ${envLine}`);
            assert.match(r.stderr, re);
        }
    });
});

// ---------------------------------------------------------------- mindcraft-rotn-ctl
describe('check-env-names (root, the env file\'s variable names; PR #30 re-review)', () => {
    const names = (content) => {
        const f = path.join(tmp, 'bot.env');
        fs.writeFileSync(f, content);
        return run(path.join(CX, 'check-env-names.sh'), [fwd(f)]);
    };
    const example = fs.readFileSync(path.join(CX, 'bot.env.example'), 'utf8')
        .replace(/__BOT__/g, 'rotn-bot').replace(/__MINDSERVER_PORT__/g, '8080').replace('<set-by-human-never-in-repo>', 'sk-or-v1-SECRET-VALUE-9');

    test('the env file from bot.env.example passes, also with CRLF line ends', () => {
        assert.equal(names(example).code, 0, names(example).all);
        assert.equal(names(example.replace(/\n/g, '\r\n')).code, 0);
    });

    test('any name outside the allowlist refuses, with its line number and never a value', () => {
        for (const line of ['NODE_TLS_REJECT_UNAUTHORIZED=0', 'HTTPS_PROXY=http://proxy.example.invalid:3128', 'https_proxy=http://p.invalid',
            'ALL_PROXY=socks5://x.invalid', 'LD_PRELOAD=/tmp/x.so', 'NODE_EXTRA_CA_CERTS=/tmp/ca.pem', 'INSECURE_CODING=1', 'BLOCKED_ACTIONS=[]',
            'NODE_PATH=/tmp/x', 'MINDCRAFT_SINGLE_BOT_SERVICE=0', 'DEBUG=*']) {
            const r = names(`${example}${line}\n`);
            const name = line.split('=')[0];
            assert.equal(r.code, 1, line);
            assert.match(r.stderr, new RegExp(`line \\d+ sets ${name}, which is not allowed in a bot env file`), line);
            assert.ok(!r.all.includes('SECRET-VALUE'), 'values are never printed');
        }
    });

    test('a missing or unreadable env file refuses (fails closed; PR #58 review)', (t) => {
        const missing = run(path.join(CX, 'check-env-names.sh'), [fwd(path.join(tmp, 'missing.env'))]);
        assert.equal(missing.code, 1);
        assert.match(missing.stderr, /a regular file/);
        const src = fs.readFileSync(path.join(CX, 'check-env-names.sh'), 'utf8');
        assert.match(src, /\[\[ -r \$file \]\] \|\| \{ echo "check-env-names: cannot read the env file; refusing to start" >&2; exit 1; \}/);
        assert.match(src, /done < "\$file" \|\| \{ echo "check-env-names: reading the env file failed; refusing to start" >&2; exit 1; \}/);
        // A real unreadable file where the OS enforces it (Linux CI, non-root); Windows and root cannot.
        const f = path.join(tmp, 'locked.env');
        fs.writeFileSync(f, 'PROFILES=["./profiles/x.json"]\n');
        fs.chmodSync(f, 0o000);
        const probe = spawnSync(BASH, ['-c', '[[ -r "$1" ]]', '_', fwd(f)]);
        if (probe.status === 0) {
            fs.chmodSync(f, 0o600);
            t.skip('this platform or user can still read a mode-000 file');
            return;
        }
        const r = run(path.join(CX, 'check-env-names.sh'), [fwd(f)]);
        fs.chmodSync(f, 0o600);
        assert.equal(r.code, 1, r.all);
        assert.match(r.stderr, /cannot read the env file; refusing to start/);
    });

    test('export, a line continuation, leading spaces or a malformed line refuse', () => {
        assert.match(names(`${example}export OPENROUTER_API_KEY=x\n`).stderr, /line \d+ is not NAME=value/);
        assert.match(names(`${example}PROFILES=["a"] \\\nLD_PRELOAD=/x\n`).stderr, /continues onto the next line/);
        assert.match(names(`${example}  NODE_OPTIONS=--max-old-space-size=512\n`).stderr, /is not NAME=value/);
        assert.match(names(`${example}just text\n`).stderr, /is not NAME=value/);
        assert.equal(names(`# comment\n; also a comment\n\nPROFILES=["./profiles/x.json"]\n`).code, 0);
        assert.equal(run(path.join(CX, 'check-env-names.sh'), [fwd(path.join(tmp, 'missing.env'))]).code, 1);
    });
});

describe('mindcraft-rotn-ctl (the only thing deploy may sudo)', () => {
    // The wrapper's paths are fixed (root runs it). The tests run a copy with exactly those two lines
    // pointed at the fake systemctl and a temp /etc; everything else is the real file.
    const SRC = fs.readFileSync(path.join(CX, 'mindcraft-rotn-ctl.sh'), 'utf8').replace(/\r/g, '');
    const ctl = (args, extraEnv = {}, { bytes = null } = {}) => {
        const etc = path.join(ROOT, 'etc', 'mindcraft-rotn');
        fs.mkdirSync(etc, { recursive: true });
        fs.writeFileSync(path.join(etc, 'rotn-bot.env'), 'x=1\n');
        fs.writeFileSync(path.join(etc, 'bot.env.example'), 'x=1\n');
        const copy = path.join(tmp, 'ctl-under-test.sh');
        const body = SRC.replace(/^PATH=.*$/m, '')
            .replace('readonly SYSTEMCTL=/usr/bin/systemctl', `readonly SYSTEMCTL=${posix(path.join(bin, 'systemctl'))}`)
            .replace('readonly JOURNALCTL=/usr/bin/journalctl', `readonly JOURNALCTL=${posix(path.join(bin, 'journalctl'))}`)
            .replace('readonly ETC_DIR=/etc/mindcraft-rotn', `readonly ETC_DIR=${fwd(etc)}`)
            .replace('readonly JOURNAL_BYTES=8388608', `readonly JOURNAL_BYTES=${bytes ?? 8388608}`);
        assert.notEqual(body, SRC);
        fs.writeFileSync(copy, body);
        return run(copy, args, extraEnv);
    };

    test('systemctl and /etc are hard-coded and PATH is reset: the caller\'s environment cannot redirect root (PR #30 finding 8)', () => {
        assert.match(SRC, /^readonly SYSTEMCTL=\/usr\/bin\/systemctl$/m);
        assert.match(SRC, /^readonly JOURNALCTL=\/usr\/bin\/journalctl$/m);
        assert.match(SRC, /^readonly HEAD=\/usr\/bin\/head$/m);
        for (const tool of ['mktemp', 'stat', 'rm']) assert.match(SRC, new RegExp(`^readonly ${tool.toUpperCase()}=/usr/bin/${tool}$`, 'm'), tool);
        assert.match(SRC, /^readonly JOURNAL_BYTES=8388608$/m);
        assert.match(SRC, /^readonly ETC_DIR=\/etc\/mindcraft-rotn$/m);
        assert.match(SRC, /^PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin$/m);
        assert.ok(!/\$\{(SYSTEMCTL|JOURNALCTL|HEAD|MKTEMP|STAT|RM|MINDCRAFT_ROTN_ETC|ETC_DIR|JOURNAL_LINES|JOURNAL_BYTES|METRICS):-/.test(SRC), 'no env overrides');
    });

    test('valid actions run systemctl on exactly mindcraft-rotn@BOT.service', () => {
        assert.equal(ctl(['restart', 'rotn-bot']).code, 0);
        assert.equal(ctl(['status', 'rotn-bot']).code, 0);
        assert.equal(ctl(['is-enabled', 'rotn-bot']).code, 0);
        assert.deepEqual(called('systemctl'), [['systemctl', 'restart', 'mindcraft-rotn@rotn-bot.service'],
            ['systemctl', 'status', '--no-pager', 'mindcraft-rotn@rotn-bot.service'], ['systemctl', 'is-enabled', 'mindcraft-rotn@rotn-bot.service']]);
        assert.equal(ctl(['list']).stdout.trim(), 'rotn-bot');
    });

    test('journal (G4, read-only): journalctl on exactly mindcraft-rotn@BOT.service, UTC ISO times, a line cap; --since strictly parsed', () => {
        const base = ['journalctl', '--unit=mindcraft-rotn@rotn-bot.service', '--no-pager', '--no-hostname', '--utc', '--output=short-iso', '--lines=20000'];
        const out = ctl(['journal', 'rotn-bot'], { FAKE_OUT_journalctl: '2026-11-07T05:31:00+0000 node[123]: FRCFLD joined' });
        assert.equal(out.code, 0, out.all);
        assert.match(out.stdout, /FRCFLD joined/);
        for (const [since, want] of [['2026-11-07 05:31:00', '--since=2026-11-07 05:31:00 UTC'], ['2026-11-07 05:31', '--since=2026-11-07 05:31 UTC'],
            ['2026-11-07T05:31:00Z', '--since=2026-11-07 05:31:00 UTC'], ['2026-11-07T05:31', '--since=2026-11-07 05:31 UTC'], ['@1794015555', '--since=@1794015555']]) {
            assert.equal(ctl(['journal', 'rotn-bot', '--since', since]).code, 0, since);
            assert.deepEqual(called('journalctl').at(-1), [...base, want], since);
        }
        assert.deepEqual(called('journalctl')[0], base);
        assert.equal(called('systemctl').length, 0, 'journal never calls systemctl');
    });

    test('journal: every other shape is refused before journalctl runs', () => {
        const bad = [['journal'], ['journal', 'rotn-bot', '--since'], ['journal', 'rotn-bot', '--until', '2026-11-07 05:31'], ['journal', 'rotn-bot', 'x', 'y'],
            ['journal', 'rotn-bot', '--since', '2026-11-07 05:31', 'extra'], ['journal', 'other-bot'], ['journal', 'Rotn'], ['journal', '../x'],
            ['journal', 'rotn-bot', 'rotn-bot']];
        for (const since of ['yesterday', '-10min', 'today', '2026-11-07', '2026-11-07 5:31', '2026-11-07 05:31:00; rm -rf /', '2026-11-07T05:31:00+02:00',
            '@', '@123abc', '@1234567890123', '2026-11-07  05:31', ' 2026-11-07 05:31', '2026-11-07 05:31 UTC', '$(id)']) bad.push(['journal', 'rotn-bot', '--since', since]);
        for (const args of bad) {
            const r = ctl(args);
            assert.equal(r.code, 2, JSON.stringify(args));
        }
        assert.equal(called('journalctl').length, 0);
    });

    test('#326 review: --since must be a real date and time (exit 2 before journalctl), read in base 10', () => {
        for (const since of ['2026-02-30 05:31', '2026-13-01 00:00', '2026-00-10 00:00', '2026-11-31 00:00', '2026-11-00 00:00', '2026-11-07 24:00',
            '2026-11-07 23:60', '2026-11-07 23:59:60', '2025-02-29 00:00', '2100-02-29 00:00', '2026-04-31T10:00Z']) {
            const r = ctl(['journal', 'rotn-bot', '--since', since]);
            assert.equal(r.code, 2, since);
            assert.match(r.stderr, /not a real date and time/, since);
        }
        assert.equal(called('journalctl').length, 0, 'never reached journalctl');
        for (const since of ['2024-02-29 00:00', '2000-02-29 12:00', '2026-08-09 08:09:09', '2026-12-31T23:59:59Z', '2026-01-01 00:00']) {
            assert.equal(ctl(['journal', 'rotn-bot', '--since', since]).code, 0, since);
        }
        assert.deepEqual(called('journalctl').at(-3).at(-1), '--since=2026-08-09 08:09:09 UTC', '08 and 09 are not octal');
    });

    test('#326 re-review: the byte cap is decided from what arrived, also just past it (no SIGPIPE): at most the cap is printed, a cut always noted', () => {
        const before = fs.readdirSync('/tmp').filter((f) => f.startsWith('mindcraft-rotn-journal.')).length;
        // The fake prints the value and a newline: 999 x's are exactly the cap of 1000 bytes.
        for (const n of [999, 1000, 4999, 59999, 100000]) {
            const r = ctl(['journal', 'rotn-bot'], { FAKE_OUT_journalctl: 'x'.repeat(n) }, { bytes: 1000 });
            const arrived = n + 1;
            assert.equal(r.code, 0, `${arrived} bytes: ${r.stderr}`);
            assert.equal(r.stdout.length, Math.min(arrived, 1000), `${arrived} bytes`);
            if (arrived > 1000) assert.match(r.stderr, /journal cut at 1000 bytes/, `${arrived} bytes`);
            else assert.equal(r.stderr, '', 'exactly the cap is no cut');
        }
        const small = ctl(['journal', 'rotn-bot'], { FAKE_OUT_journalctl: 'one line' }, { bytes: 1000 });
        assert.equal(small.stdout, 'one line\n');
        assert.equal(small.stderr, '');
        // journalctl's own failure keeps its exit code, after what it printed.
        const failed = ctl(['journal', 'rotn-bot'], { FAKE_OUT_journalctl: 'partial', FAKE_RC_journalctl: '1' });
        assert.equal(failed.code, 1, 'not hidden by the pipe');
        assert.equal(failed.stdout, 'partial\n');
        const after = fs.readdirSync('/tmp').filter((f) => f.startsWith('mindcraft-rotn-journal.')).length;
        assert.ok(after <= before, 'the temp file is removed');
    });

    test('metrics (G4, read-only): systemctl show of exactly the four properties on mindcraft-rotn@BOT.service; nothing else', () => {
        const r = ctl(['metrics', 'rotn-bot'], { FAKE_OUT_systemctl: 'MemoryCurrent=412345678\nMemoryPeak=598765432\nNRestarts=0\nActiveState=active' });
        assert.equal(r.code, 0, r.all);
        assert.match(r.stdout, /^NRestarts=0$/m);
        assert.deepEqual(called('systemctl'), [['systemctl', 'show', '--no-pager', '--property=MemoryCurrent,MemoryPeak,NRestarts,ActiveState', 'mindcraft-rotn@rotn-bot.service']]);
        for (const args of [['metrics'], ['metrics', 'rotn-bot', 'x'], ['metrics', 'other-bot'], ['metrics', 'Rotn'], ['metrics', 'rotn-bot', '--property=ExecStart'], ['show', 'rotn-bot']]) {
            assert.equal(ctl(args).code, 2, args.join(' '));
        }
        assert.equal(called('systemctl').length, 1, 'no further systemctl call');
    });

    test('anything else is refused before systemctl runs', () => {
        for (const args of [['restart', 'rotn-bot', 'ssh.service'], ['restart', 'Rotn'], ['restart', '../x'], ['restart', 'a b'],
            ['restart', 'other-bot'], ['kill', 'rotn-bot'], ['restart'], ['daemon-reload', 'x'], []]) {
            const r = ctl(args);
            assert.equal(r.code, 2, args.join(' '));
        }
        assert.equal(called('systemctl').length, 0);
    });
});

// ---------------------------------------------------------------- bootstrap.sh
describe('bootstrap.sh', { skip: windowsShellSkip('bootstrap.sh', '148 s') }, () => {
    const ubuntu = (version = '26.04', sshdConfig = 'Include /etc/ssh/sshd_config.d/*.conf\n\nKbdInteractiveAuthentication no\nUsePAM yes\n') => {
        fs.mkdirSync(rootFile('etc/ssh'), { recursive: true });
        fs.writeFileSync(rootFile('etc/os-release'), `NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="${version}"\n`);
        fs.writeFileSync(rootFile('etc/ssh/sshd_config'), sshdConfig);
    };
    let keyN = 0;
    const keyFile = (content = KEY) => {
        const f = fwd(path.join(tmp, `deploy-${keyN++}.pub`));
        fs.writeFileSync(f, `${content}\n`);
        return f;
    };
    const ok = { FAKE_OUT_id: '0', FAKE_RC_getent: '2', FAKE_OUT_gpg: `fpr:::::::::${FPR}:`, FAKE_OUT_node: 'v22.11.0', NODESOURCE_KEY_FPR: undefined, SSH_CONNECTION: undefined };
    const boot = (args, extra = {}) => run(path.join(CX, 'bootstrap.sh'), args, { ...ok, ...extra });

    test('setup: users, key, sudoers, upgrades, Node 22, swap, firewall, unit; password login off, root login stays on', () => {
        ubuntu();
        const r = boot(['setup', '--deploy-key-file', keyFile()]);
        assert.equal(r.code, 0, r.all);
        // users
        assert.ok(called('useradd').some((c) => c.includes('--system') && c.includes('/usr/sbin/nologin') && c.at(-1) === 'mindcraft-rotn'));
        assert.ok(called('useradd').some((c) => c.at(-1) === 'deploy'));
        assert.deepEqual(called('passwd')[0], ['passwd', '--lock', 'deploy']);
        assert.deepEqual(called('usermod')[0], ['usermod', '--append', '--groups', 'sudo,mindcraft-rotn', 'deploy']);
        // key: exactly the given line, 0600, owned by deploy
        assert.equal(read('home/deploy/.ssh/authorized_keys'), `${KEY}\n`);
        assert.ok(called('chmod').some((c) => c[1] === '0700' && c[2].endsWith('/home/deploy/.ssh')));
        // sudoers: only the wrapper, checked by visudo before it is moved into place
        const sudoers = read('etc/sudoers.d/mindcraft-rotn');
        assert.deepEqual(sudoers.split('\n').filter((l) => l && !l.startsWith('#')), ['deploy ALL=(root) NOPASSWD: /usr/local/sbin/mindcraft-rotn-ctl']);
        assert.ok(called('visudo').length === 1 && called('chmod').some((c) => c[1] === '0440'));
        // unattended security upgrades
        assert.equal(read('etc/apt/apt.conf.d/20auto-upgrades'), 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n');
        // G4 step 0 C1: the one list (gl's X libraries in it), with no recommends, exactly as ci-ubuntu-2604 installs it.
        assert.ok(called('apt-get').some((c) => c.join(' ') === 'apt-get install -y -q --no-install-recommends unattended-upgrades git ufw ca-certificates curl gnupg libx11-6 libxext6'),
            JSON.stringify(called('apt-get')));
        // Node 22 from NodeSource, key pinned
        assert.ok(called('curl').some((c) => c.includes('https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key') && c.includes('=https')));
        assert.equal(read('etc/apt/sources.list.d/nodesource.list'),
            'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n');
        assert.ok(exists('etc/apt/keyrings/nodesource.gpg'));
        assert.ok(called('apt-get').some((c) => c.join(' ') === 'apt-get install -y -q --no-install-recommends nodejs'));
        assert.ok(called('apt-get').filter((c) => c[1] === 'install').every((c) => c.includes('--no-install-recommends')));
        // swap
        assert.deepEqual(called('fallocate')[0].slice(0, 3), ['fallocate', '-l', '2G']);
        assert.ok(called('mkswap').length === 1 && called('swapon').length === 2);
        assert.match(read('etc/fstab'), /^\/swapfile none swap sw 0 0$/m);
        // firewall: SSH allowed before ufw is enabled; deny incoming by default
        const allow = callIndex((c) => c[0] === 'ufw' && c[1] === 'allow' && c[2] === '22/tcp');
        const enable = callIndex((c) => c[0] === 'ufw' && c.includes('enable'));
        assert.ok(allow >= 0 && enable > allow, 'allow 22 before enabling');
        assert.ok(called('ufw').some((c) => c.join(' ') === 'ufw default deny incoming'));
        assert.equal(called('ufw').filter((c) => c[1] === 'allow').length, 1, 'only SSH is opened');
        // files: the repo's unit, check-env and wrapper; folders
        // Installed byte for byte, minus any carriage returns (a copy from a Windows checkout may have CRLF).
        const lf = (f) => fs.readFileSync(path.join(CX, f), 'utf8').replace(/\r/g, '');
        assert.equal(read('etc/systemd/system/mindcraft-rotn@.service'), lf('mindcraft-rotn@.service'));
        assert.equal(read('usr/local/lib/mindcraft-rotn/check-env'), lf('check-env.sh'));
        assert.equal(read('usr/local/sbin/mindcraft-rotn-ctl'), lf('mindcraft-rotn-ctl.sh'));
        assert.equal(read('usr/local/lib/mindcraft-rotn/check-env.mjs'), lf('check-env.mjs'), 'the parser next to check-env');
        assert.equal(read('usr/local/lib/mindcraft-rotn/check-env-names'), lf('check-env-names.sh'), 'the root-run name check');
        assert.ok(called('chmod').some((c) => c[1] === '0755' && c[2].includes('/usr/local/lib/mindcraft-rotn/check-env-names')));
        assert.match(read('etc/mindcraft-rotn/.setup-epoch'), /^\d{10}\n$/, 'lockdown looks for a key login after this');
        for (const f of ['usr/local/lib/mindcraft-rotn/check-env', 'usr/local/sbin/mindcraft-rotn-ctl', 'etc/mindcraft-rotn/bot.env.example'])
            assert.ok(!read(f).includes('\r'), `${f} has no CR`);
        for (const d of ['opt/mindcraft-rotn/releases', 'var/lib/mindcraft-rotn/bots', 'etc/mindcraft-rotn']) assert.ok(exists(d), d);
        // G4 step 0: deploy (in the group) installs the tracked bots/ files there, so the shared folder is 2770.
        assert.ok(called('chmod').some((c) => c.join(' ') === `chmod 2770 ${ROOT}/var/lib/mindcraft-rotn/bots`), JSON.stringify(called('chmod').filter((c) => /bots/.test(c.join(' ')))));
        assert.ok(called('systemctl').some((c) => c[1] === 'daemon-reload'));
        // password login off (the human's decision for GO 2); root login untouched; no lockdown drop-in
        assert.ok(exists(SSHD_DROPIN));
        assert.ok(!exists('etc/ssh/sshd_config.d/00-mindcraft-rotn.conf'), 'setup never writes the lockdown drop-in');
        assert.match(r.stderr, /SSH password login is OFF; root keeps its key login/);
        assert.ok(!/Root and password login are still ON/.test(r.stderr));
    });

    // ---- GO 2: SSH password login off (the human's decision), verified before ssh is reloaded
    const SSHD_DROPIN = 'etc/ssh/sshd_config.d/10-mindcraft-rotn.conf';
    const cloudInit = (value = 'yes') => {
        fs.mkdirSync(rootFile('etc/ssh/sshd_config.d'), { recursive: true });
        fs.writeFileSync(rootFile('etc/ssh/sshd_config.d/50-cloud-init.conf'), `PasswordAuthentication ${value}\n`);
    };
    const setup = (extra = {}) => boot(['setup', '--deploy-key-file', keyFile()], extra);
    const reloaded = () => called('systemctl').some((c) => c.join(' ') === 'systemctl reload ssh');
    const sshdChecks = () => called('sshd').filter((c) => c[1] === '-t').length; // the sshd step's own check, not preflight's sshd -T

    test('sshd: the drop-in turns password and keyboard-interactive login off and leaves PermitRootLogin alone', () => {
        ubuntu();
        cloudInit('yes');
        const r = setup();
        assert.equal(r.code, 0, r.all);
        const lines = read(SSHD_DROPIN).split('\n').filter((l) => l && !l.startsWith('#'));
        assert.deepEqual(lines, ['PasswordAuthentication no', 'KbdInteractiveAuthentication no']);
        assert.ok(!/^\s*PermitRootLogin/im.test(read(SSHD_DROPIN)), 'root keeps its key login');
        assert.equal(read('etc/ssh/sshd_config.d/50-cloud-init.conf'), 'PasswordAuthentication yes\n', 'cloud-init\'s file is not edited');
        assert.ok(called('chmod').some((c) => c[1] === '0644' && c[2].includes('/etc/ssh/sshd_config.d/10-mindcraft-rotn.conf')));
        assert.ok(called('chown').some((c) => c[1] === 'root:root' && c[2].includes('/etc/ssh/sshd_config.d/10-mindcraft-rotn.conf')));
        assert.match(r.stderr, /password login off \(verified with sshd -T\); root login 'prohibit-password' is unchanged; ssh reloaded/);
    });

    test('sshd: the drop-in sorts before cloud-init\'s 50- file, because sshd keeps the first value it reads', () => {
        assert.ok(path.basename(SSHD_DROPIN) < '50-cloud-init.conf');
        assert.match(fs.readFileSync(path.join(CX, 'bootstrap.sh'), 'utf8'), /^readonly SSHD_DROPIN=\/etc\/ssh\/sshd_config\.d\/10-mindcraft-rotn\.conf$/m);
        // The fake sshd -T keeps the first value too: a file that sorts earlier and says yes wins over ours.
        ubuntu();
        fs.mkdirSync(rootFile('etc/ssh/sshd_config.d'), { recursive: true });
        fs.writeFileSync(rootFile('etc/ssh/sshd_config.d/05-other.conf'), 'PasswordAuthentication yes\n');
        const r = setup();
        assert.equal(r.code, 1, r.all);
        assert.match(r.stderr, /sshd -T does not show 'passwordauthentication no' \(sshd_config or a file read before \/etc\/ssh\/sshd_config\.d\/10-mindcraft-rotn\.conf sets it\); put back what was there, ssh not reloaded/);
        assert.ok(!exists(SSHD_DROPIN), 'the ineffective drop-in is removed');
        assert.ok(!reloaded());
        // A value in sshd_config itself, above the Include line, is read first too.
        fs.rmSync(rootFile('etc/ssh/sshd_config.d/05-other.conf'));
        ubuntu('26.04', 'PasswordAuthentication yes\nInclude /etc/ssh/sshd_config.d/*.conf\n');
        const main = setup();
        assert.equal(main.code, 1);
        assert.match(main.stderr, /sshd -T does not show 'passwordauthentication no'/);
        assert.ok(!exists(SSHD_DROPIN));
        assert.ok(!reloaded());
    });

    test('sshd: sshd -t runs before sshd -T, and ssh is reloaded only after both pass', () => {
        ubuntu();
        cloudInit('yes');
        assert.equal(setup().code, 0);
        const t = callIndex((c) => c.join(' ') === 'sshd -t');
        const T = calls().findIndex((c, i) => i > t && c.join(' ') === 'sshd -T');
        const reload = callIndex((c) => c.join(' ') === 'systemctl reload ssh');
        assert.ok(t >= 0 && T > t && reload > T, `order: sshd -t ${t}, sshd -T ${T}, reload ${reload}`);
        assert.ok(exists('run/sshd'), 'the privilege separation folder sshd -t needs');
        // #137 re-review nit 2: setup_sshd makes /run/sshd BEFORE it writes the drop-in, so no unchecked drop-in
        // can be left behind if that fails.
        const write = callIndex((c) => c[0] === 'chmod' && c[1] === '0644' && c[2].includes('/etc/ssh/sshd_config.d/10-mindcraft-rotn.conf'));
        const runDir = calls().findLastIndex((c, i) => i < write && c[0] === 'chmod' && c[1] === '0755' && c[2].endsWith('/run/sshd'));
        const lastPreflightT = calls().findIndex((c) => c.join(' ') === 'sshd -T');
        assert.ok(write > 0 && runDir > lastPreflightT, `/run/sshd made again in setup_sshd (${runDir}) before the drop-in is written (${write})`);
        assert.ok(!calls().some((c, i) => i > write && c[0] === 'chmod' && c[2].endsWith('/run/sshd')), 'not made after the write');
    });

    test('sshd: a config sshd -t rejects is taken out again (or the earlier one put back), and ssh is not reloaded', () => {
        ubuntu();
        const r = setup({ FAKE_RC_sshd: '255' });
        assert.equal(r.code, 1, r.all);
        assert.match(r.stderr, /sshd -t rejected the config; put back what was there, ssh not reloaded/);
        assert.ok(!exists(SSHD_DROPIN));
        const tFailed = callIndex((c) => c.join(' ') === 'sshd -t');
        assert.ok(tFailed >= 0 && !calls().some((c, i) => i > tFailed && c.join(' ') === 'sshd -T'), 'no -T after a failed -t');
        assert.ok(!reloaded());
        // An earlier drop-in of ours is restored as it was, with no backup left behind.
        fs.writeFileSync(rootFile(SSHD_DROPIN), '# an earlier version\nPasswordAuthentication no\n');
        assert.equal(setup({ FAKE_RC_sshd: '255' }).code, 1);
        assert.equal(read(SSHD_DROPIN), '# an earlier version\nPasswordAuthentication no\n');
        assert.deepEqual(fs.readdirSync(rootFile('etc/ssh/sshd_config.d')).filter((f) => f.includes('.bak')), []);
    });

    test('sshd: keyboard-interactive set to yes earlier also fails the sshd -T check', () => {
        ubuntu();
        fs.mkdirSync(rootFile('etc/ssh/sshd_config.d'), { recursive: true });
        fs.writeFileSync(rootFile('etc/ssh/sshd_config.d/01-x.conf'), 'KbdInteractiveAuthentication yes\n');
        const r = setup();
        assert.equal(r.code, 1);
        assert.match(r.stderr, /sshd -T does not show 'kbdinteractiveauthentication no'/);
        assert.ok(!reloaded());
    });

    test('sshd: a re-run is idempotent; with ssh.service inactive (socket activation) nothing is reloaded', () => {
        ubuntu();
        cloudInit('yes');
        assert.equal(setup().code, 0);
        const first = read(SSHD_DROPIN);
        fs.writeFileSync(logFile, '');
        const again = setup({ FAKE_RC_getent: '0', FAKE_SSH_INACTIVE: '1' });
        assert.equal(again.code, 0, again.all);
        assert.equal(read(SSHD_DROPIN), first);
        assert.deepEqual(fs.readdirSync(rootFile('etc/ssh/sshd_config.d')).sort(), ['10-mindcraft-rotn.conf', '50-cloud-init.conf'], 'no backup left behind');
        assert.ok(!reloaded());
        assert.match(again.stderr, /ssh\.service is not running \(socket activation\), so the next connection reads it/);
    });

    test('setup refuses: not root, not Ubuntu 24.04, no or bad key; nothing is created', () => {
        assert.ok(!/sudo bash bootstrap/.test(fs.readFileSync(path.join(CX, 'bootstrap.sh'), 'utf8')), 'no message suggests running it through sudo (#144 review nit 3)');
        ubuntu();
        const cases = [
            [['setup', '--deploy-key-file', keyFile()], { FAKE_OUT_id: '1000' }, /run as root, from a root SSH login \(ssh root@<cx23>, then bash bootstrap\.sh \.\.\.\); setup --ssh-from needs that login, because sudo drops SSH_CONNECTION/],
            [['setup'], {}, /needs --deploy-key-file/],
            [['setup', '--deploy-key-file', keyFile('-----BEGIN OPENSSH PRIVATE KEY-----')], {}, /one OpenSSH public key line/],
            [['setup', '--deploy-key-file', keyFile('not a key')], {}, /one OpenSSH public key line/],
            [['setup', '--deploy-key-file', keyFile(), '--ssh-from', '2001:db8::/32'], {}, /--ssh-from must be an IPv4 CIDR/],
        ];
        for (const [args, extra, re] of cases) {
            const r = boot(args, extra);
            assert.equal(r.code, 1, args.join(' '));
            assert.match(r.stderr, re);
        }
        ubuntu('22.04');
        assert.match(boot(['setup', '--deploy-key-file', keyFile()]).stderr, /this is for Ubuntu 26\.04 \(ADR 0007\) or 24\.04/);
        assert.equal(called('useradd').length, 0);
    });

    test('Ubuntu 26.04 (ADR 0007) and 24.04 are accepted', () => {
        for (const v of ['26.04', '24.04']) {
            ubuntu(v);
            const r = boot(['setup', '--deploy-key-file', keyFile()]);
            assert.equal(r.code, 0, `${v}: ${r.all}`);
        }
        assert.match(fs.readFileSync(path.join(CX, 'bootstrap.sh'), 'utf8').split('\n')[1], /Ubuntu 26\.04, ADR 0007/);
    });

    // ---- ADR 0007: the system steps the CI container cannot test are checked on the server itself
    test('preflight: no ssh.service unit, or an sshd_config without the drop-in Include, stops setup before any change', () => {
        ubuntu();
        const noUnit = boot(['setup', '--deploy-key-file', keyFile()], { FAKE_NO_SSH_UNIT: '1' });
        assert.equal(noUnit.code, 1);
        assert.match(noUnit.stderr, /there is no ssh\.service unit/);
        assert.deepEqual(called('systemctl')[0], ['systemctl', 'cat', 'ssh.service']);
        ubuntu('26.04', 'PasswordAuthentication no\nUsePAM yes\n');
        const noInclude = boot(['setup', '--deploy-key-file', keyFile()]);
        assert.equal(noInclude.code, 1);
        assert.match(noInclude.stderr, /does not include \/etc\/ssh\/sshd_config\.d\/\*\.conf/);
        assert.equal(called('useradd').length + called('apt-get').length + called('ufw').length + called('sshd').length, 0, 'nothing was changed');
    });

    test('sudo (sudo-rs on 26.04): a rule that sudo -l does not show is removed and setup stops, before ufw and sshd', () => {
        ubuntu();
        const r = boot(['setup', '--deploy-key-file', keyFile()], { FAKE_SUDO_IGNORES_DROPIN: '1' });
        assert.equal(r.code, 1);
        assert.match(r.stderr, /sudo \(sudo-rs 0\.2\.8\) does not show the rule for deploy after install \(sudo -l -U deploy\); removed it/);
        assert.ok(!exists('etc/sudoers.d/mindcraft-rotn'));
        assert.equal(called('ufw').length + sshdChecks(), 0, 'the firewall and sshd are untouched (only the read-only preflight sshd -T ran)');
        assert.ok(called('sudo').some((c) => c.join(' ') === 'sudo -l -U deploy'));
        const ok = boot(['setup', '--deploy-key-file', keyFile()]);
        assert.equal(ok.code, 0, ok.all);
        assert.match(ok.stderr, /sudoers: deploy may run only mindcraft-rotn-ctl without a password \(sudo-rs 0\.2\.8\)/);
    });

    test('ufw: never enabled when the SSH rule did not take; an enable that does not take stops setup; sshd is untouched', () => {
        ubuntu();
        const noRule = boot(['setup', '--deploy-key-file', keyFile()], { FAKE_UFW_DROP_RULES: '1' });
        assert.equal(noRule.code, 1);
        assert.match(noRule.stderr, /ufw does not list the SSH rule \(ufw show added\); not enabling the firewall/);
        assert.ok(!called('ufw').some((c) => c.includes('enable')), 'ufw was not enabled');
        assert.equal(sshdChecks(), 0, 'the sshd step never ran');
        const noEnable = boot(['setup', '--deploy-key-file', keyFile()], { FAKE_UFW_NO_ENABLE: '1' });
        assert.equal(noEnable.code, 1);
        assert.match(noEnable.stderr, /ufw is not active after 'ufw --force enable' \(ufw status\)/);
        assert.equal(sshdChecks(), 0, 'the sshd step never ran');
        assert.ok(!exists(SSHD_DROPIN));
    });

    test('--ssh-from must contain this SSH session\'s client address, or setup refuses before any change (#137 review)', () => {
        ubuntu();
        const from = (cidr, env) => boot(['setup', '--deploy-key-file', keyFile(), '--ssh-from', cidr], env);
        const cases = [
            ['203.0.113.0/24', {}, /--ssh-from needs this to run in an SSH session over IPv4 \(SSH_CONNECTION\).*Run setup from a root SSH login \(ssh root@<cx23>\), not through sudo: sudo drops SSH_CONNECTION/],
            ['203.0.113.0/24', { SSH_CONNECTION: '2001:db8::5 50122 2001:db8::1 22' }, /needs this to run in an SSH session over IPv4/],
            ['203.0.113.0/24', { SSH_CONNECTION: '198.51.100.7 50122 192.0.2.10 22' }, /--ssh-from 203\.0\.113\.0\/24 does not contain this SSH session's client address/],
            ['203.0.113.4/32', { SSH_CONNECTION: '203.0.113.5 50122 192.0.2.10 22' }, /does not contain this SSH session's client address/],
            ['203.0.113.0/33', { SSH_CONNECTION: '203.0.113.5 50122 192.0.2.10 22' }, /the prefix \/33 is not 0\.\.32/],
            ['203.0.113.300/24', { SSH_CONNECTION: '203.0.113.5 50122 192.0.2.10 22' }, /203\.0\.113\.300 is not an IPv4 address/],
        ];
        for (const [cidr, env, re] of cases) {
            const r = from(cidr, env);
            assert.equal(r.code, 1, cidr);
            assert.match(r.stderr, re, `${cidr} ${JSON.stringify(env)}`);
            assert.ok(!r.stderr.includes('198.51.100.7') && !r.stderr.includes('203.0.113.5'), 'the client address is never printed');
        }
        assert.equal(calls().length, 0, 'refused before any system command ran');
        for (const cidr of ['203.0.113.5/32', '203.0.113.0/24', '203.0.0.0/16', '0.0.0.0/0', '203.000.113.005/32']) {
            assert.equal(from(cidr, { SSH_CONNECTION: '203.0.113.5 50122 192.0.2.10 22' }).code, 0, cidr);
        }
    });

    test('preflight: a Match block anywhere in the sshd config refuses setup before any change (#137 re-review nit 3)', () => {
        const inc = 'Include /etc/ssh/sshd_config.d/*.conf\n';
        const cases = [
            [`${inc}Match User deploy\n    PasswordAuthentication yes\n`, null, /\(\/etc\/ssh\/sshd_config\)/],
            [`${inc}  match address 10.0.0.0/8\n`, null, /\(\/etc\/ssh\/sshd_config\)/],
            [inc, 'Match Group sftp\n  ForceCommand internal-sftp\n', /\(\/etc\/ssh\/sshd_config\.d\/60-x\.conf\)/],
            [`${inc}Match=User deploy\n`, null, /\(\/etc\/ssh\/sshd_config\)/],
        ];
        for (const [main, dropin, re] of cases) {
            ubuntu('26.04', main);
            fs.rmSync(rootFile('etc/ssh/sshd_config.d'), { recursive: true, force: true });
            if (dropin) {
                fs.mkdirSync(rootFile('etc/ssh/sshd_config.d'), { recursive: true });
                fs.writeFileSync(rootFile('etc/ssh/sshd_config.d/60-x.conf'), dropin);
            }
            const r = boot(['setup', '--deploy-key-file', keyFile()]);
            assert.equal(r.code, 1, main);
            assert.match(r.stderr, /the sshd config has Match blocks/);
            assert.match(r.stderr, re);
            assert.match(r.stderr, /sshd -T cannot verify password login under them, so setup does not change anything/);
        }
        assert.equal(called('useradd').length + called('ufw').length + called('apt-get').length + called('sshd').length, 0, 'refused before any change');
        // A commented-out Match, or a word that only starts with Match, is fine.
        ubuntu('26.04', `${inc}# Match User deploy\n`);
        fs.rmSync(rootFile('etc/ssh/sshd_config.d'), { recursive: true, force: true });
        assert.equal(boot(['setup', '--deploy-key-file', keyFile()]).code, 0);
    });

    test('preflight: an Include of anything but sshd_config.d/*.conf, or any Include in a drop-in, refuses setup (#144 review nit 1)', () => {
        const inc = 'Include /etc/ssh/sshd_config.d/*.conf\n';
        const cases = [
            [`${inc}Include /etc/ssh/extra/*.conf\n`, null, /\(\/etc\/ssh\/sshd_config\)/],
            [`${inc}  include=/root/x.conf\n`, null, /\(\/etc\/ssh\/sshd_config\)/],
            [inc, 'Include /etc/ssh/elsewhere.conf\n', /\(\/etc\/ssh\/sshd_config\.d\/60-x\.conf\)/],
            [inc, 'Include /etc/ssh/sshd_config.d/*.conf\n', /\(\/etc\/ssh\/sshd_config\.d\/60-x\.conf\)/],
        ];
        for (const [main, dropin, re] of cases) {
            ubuntu('26.04', main);
            fs.rmSync(rootFile('etc/ssh/sshd_config.d'), { recursive: true, force: true });
            if (dropin) {
                fs.mkdirSync(rootFile('etc/ssh/sshd_config.d'), { recursive: true });
                fs.writeFileSync(rootFile('etc/ssh/sshd_config.d/60-x.conf'), dropin);
            }
            const r = boot(['setup', '--deploy-key-file', keyFile()]);
            assert.equal(r.code, 1, `${main} | ${dropin}`);
            assert.match(r.stderr, /the sshd config includes files other than \/etc\/ssh\/sshd_config\.d\/\*\.conf/);
            assert.match(r.stderr, re);
        }
        assert.equal(called('useradd').length + called('ufw').length + called('apt-get').length + called('sshd').length, 0, 'refused before any change');
        // The standard Include alone (Ubuntu's sshd_config) and a commented-out Include pass.
        ubuntu('26.04', `${inc}# Include /etc/ssh/extra/*.conf\n`);
        fs.rmSync(rootFile('etc/ssh/sshd_config.d'), { recursive: true, force: true });
        assert.equal(boot(['setup', '--deploy-key-file', keyFile()]).code, 0);
    });

    test('preflight: sshd must listen on port 22 only, since ufw opens only 22 (#137 review nit 4)', () => {
        for (const conf of ['Include /etc/ssh/sshd_config.d/*.conf\nPort 2222\n', 'Include /etc/ssh/sshd_config.d/*.conf\nPort 22\nPort 2222\n']) {
            ubuntu('26.04', conf);
            const r = boot(['setup', '--deploy-key-file', keyFile()]);
            assert.equal(r.code, 1);
            assert.match(r.stderr, /sshd listens on port\(s\) '(2222|22 2222)', but ufw will allow only 22; not changing anything/);
        }
        assert.equal(called('useradd').length + called('ufw').length + called('apt-get').length, 0);
    });

    test('ufw: with --ssh-from, the narrow rule is what must be listed before enabling', () => {
        ubuntu();
        const r = boot(['setup', '--deploy-key-file', keyFile(), '--ssh-from', '203.0.113.0/24'], { SSH_CONNECTION: '203.0.113.5 50122 192.0.2.10 22' });
        assert.equal(r.code, 0, r.all);
        const show = callIndex((c) => c.join(' ') === 'ufw show added');
        const enable = callIndex((c) => c.join(' ') === 'ufw --force enable');
        assert.ok(show >= 0 && enable > show, 'checked, then enabled');
    });

    test('setup refuses a NodeSource key with another fingerprint, before adding the repo', () => {
        ubuntu();
        const r = boot(['setup', '--deploy-key-file', keyFile()], { FAKE_OUT_gpg: 'fpr:::::::::0000000000000000000000000000000000000000:' });
        assert.equal(r.code, 1);
        assert.match(r.stderr, /NodeSource key fingerprint is '0000000000000000000000000000000000000000', expected 6F71/);
        assert.ok(!exists('etc/apt/sources.list.d/nodesource.list'));
        assert.ok(!called('apt-get').some((c) => c.includes('nodejs')));
    });

    test('the pinned fingerprint changes only with NODESOURCE_KEY_FPR and --allow-fpr-override together (PR #30 finding 4)', () => {
        ubuntu();
        const other = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
        const env = { NODESOURCE_KEY_FPR: other, FAKE_OUT_gpg: `fpr:::::::::${other}:` };
        const noFlag = boot(['setup', '--deploy-key-file', keyFile()], env);
        assert.equal(noFlag.code, 1);
        assert.match(noFlag.stderr, /NODESOURCE_KEY_FPR is set but --allow-fpr-override is not/);
        assert.equal(called('useradd').length, 0, 'refused before anything was done');
        assert.match(boot(['setup', '--deploy-key-file', keyFile(), '--allow-fpr-override'], { NODESOURCE_KEY_FPR: undefined }).stderr,
            /--allow-fpr-override needs NODESOURCE_KEY_FPR=<40 hex digits>/);
        const r = boot(['setup', '--deploy-key-file', keyFile(), '--allow-fpr-override'], env);
        assert.equal(r.code, 0, r.all);
        assert.match(r.stderr, new RegExp(`WARNING: NodeSource key fingerprint overridden to ${other} \\(pinned: ${FPR}\\)`));
        // The pinned value in the environment needs no flag.
        assert.equal(boot(['setup', '--deploy-key-file', keyFile()], { NODESOURCE_KEY_FPR: FPR }).code, 0);
        assert.match(fs.readFileSync(path.join(CX, 'bootstrap.sh'), 'utf8'), /readonly NODESOURCE_KEY_FPR_PINNED=6F71F525282841EEDAF851B42F59B5F99B1BE0B4/);
    });

    test('setup refuses a Node that is not 22, and a sudoers rule visudo rejects', () => {
        ubuntu();
        assert.match(boot(['setup', '--deploy-key-file', keyFile()], { FAKE_OUT_node: 'v20.18.0' }).stderr, /node --version is 'v20\.18\.0', expected v22\.x/);
        fs.rmSync(rootFile('etc/sudoers.d'), { recursive: true, force: true }); // written by the run above, before node failed
        const r = boot(['setup', '--deploy-key-file', keyFile()], { FAKE_RC_visudo: '1' });
        assert.equal(r.code, 1);
        assert.match(r.stderr, /visudo rejected/);
        assert.ok(!exists('etc/sudoers.d/mindcraft-rotn') && !exists('etc/sudoers.d/.mindcraft-rotn.new'));
    });

    test('setup is idempotent: existing users and swap are left alone; --ssh-from limits SSH', () => {
        ubuntu();
        const r = boot(['setup', '--deploy-key-file', keyFile(), '--ssh-from', '203.0.113.0/24'],
            { FAKE_RC_getent: '0', FAKE_OUT_swapon: '/swapfile file 2G 0B -2', SSH_CONNECTION: '203.0.113.5 50122 192.0.2.10 22' });
        assert.equal(r.code, 0, r.all);
        assert.equal(called('useradd').length, 0);
        assert.equal(called('fallocate').length, 0);
        // The narrow rule first, then the open 22/tcp rule of an earlier run is removed (PR #30 finding 5).
        const allowFrom = callIndex((c) => c.join(' ') === 'ufw allow proto tcp from 203.0.113.0/24 to any port 22');
        const delOpen = callIndex((c) => c.join(' ') === 'ufw delete allow 22/tcp');
        assert.ok(allowFrom >= 0 && delOpen > allowFrom, 'allow from CIDR, then delete the open rule');
        assert.ok(!called('ufw').some((c) => c.join(' ') === 'ufw allow 22/tcp'), 'no open rule added');
    });

    test('authorized_keys: a missing key is appended, existing keys are kept, a re-run adds no duplicate (PR #30 finding 5)', () => {
        ubuntu();
        const other = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherOtherOtherOtherOtherOtherOtherOther other@example.invalid';
        fs.mkdirSync(rootFile('home/deploy/.ssh'), { recursive: true });
        fs.writeFileSync(rootFile('home/deploy/.ssh/authorized_keys'), `${other}\r\n`);
        assert.equal(boot(['setup', '--deploy-key-file', keyFile()], { FAKE_RC_getent: '0' }).code, 0);
        assert.equal(read('home/deploy/.ssh/authorized_keys'), `${other}\n${KEY}\n`);
        const again = boot(['setup', '--deploy-key-file', keyFile()], { FAKE_RC_getent: '0' });
        assert.match(again.stderr, /deploy already has this key/);
        assert.equal(read('home/deploy/.ssh/authorized_keys'), `${other}\n${KEY}\n`);
    });

    test('add-bot: 0700 token cache, 0600 root:root env file from the template, ports count up, never overwrites', () => {
        ubuntu();
        const env = { FAKE_RC_getent: '0' };
        assert.equal(boot(['add-bot', 'rotn-bot'], env).code, 0);
        const e = read('etc/mindcraft-rotn/rotn-bot.env');
        assert.match(e, /^MINDCRAFT_PROFILES_FOLDER=\/var\/lib\/mindcraft-rotn\/rotn-bot\/msa$/m);
        assert.match(e, /^MINDSERVER_PORT=8080$/m);
        assert.match(e, /^PROFILES=\["\.\/profiles\/rotn-bot\.json"\]$/m);
        assert.ok(!e.includes('__BOT__') && !e.includes('__MINDSERVER_PORT__'));
        assert.ok(!e.includes('\r'), 'no CR in env values (MINDSERVER_PORT=8080 followed by CR would break)');
        assert.ok(called('chmod').some((c) => c[1] === '0700' && c[2].endsWith('/var/lib/mindcraft-rotn/rotn-bot/msa')));
        // root only: the deploy user is in group mindcraft-rotn and must not read the key (PR #30 finding 6)
        const envMode = called('chmod').filter((c) => c[2].includes('/etc/mindcraft-rotn/rotn-bot.env')).map((c) => c[1]);
        const envOwner = called('chown').filter((c) => c[2].includes('/etc/mindcraft-rotn/rotn-bot.env')).map((c) => c[1]);
        assert.deepEqual([envMode, envOwner], [['0600'], ['root:root']]);
        assert.equal(boot(['add-bot', 'bot-two'], env).code, 0);
        assert.match(read('etc/mindcraft-rotn/bot-two.env'), /^MINDSERVER_PORT=8081$/m);
        fs.writeFileSync(rootFile('etc/mindcraft-rotn/rotn-bot.env'), 'OPENROUTER_API_KEY=human-set\n');
        const again = boot(['add-bot', 'rotn-bot'], env);
        assert.match(again.stderr, /exists; not touching it/);
        assert.equal(read('etc/mindcraft-rotn/rotn-bot.env'), 'OPENROUTER_API_KEY=human-set\n');
        for (const bad of ['Rotn', '../x', 'a b', '']) assert.equal(boot(['add-bot', bad], env).code, 1, bad);
    });

    test('lockdown refuses until deploy has a key and a sudo password, and without the explicit flag', () => {
        ubuntu();
        // Not run on this CX23 (ADR 0007): without its own flag it refuses, whatever else is given (#137 review).
        for (const args of [['lockdown'], ['lockdown', '--i-tested-deploy-login']]) {
            const r = boot(args, { FAKE_OUT_passwd: 'deploy P' });
            assert.equal(r.code, 1);
            assert.match(r.stderr, /lockdown turns root SSH login off \(PermitRootLogin no, AllowUsers deploy\); it is not run on this project's CX23 \(ADR 0007\)\. Only on the lead's written decision, add --turn-off-root-ssh/);
        }
        assert.match(boot(['lockdown', '--turn-off-root-ssh']).stderr, /pass --i-tested-deploy-login/);
        assert.match(boot(['lockdown', '--turn-off-root-ssh', '--yes']).stderr, /lockdown: unknown option --yes/);
        assert.match(boot(['lockdown', '--turn-off-root-ssh', '--i-tested-deploy-login'], { FAKE_OUT_passwd: 'deploy P' }).stderr, /deploy has no authorized key/);
        fs.mkdirSync(rootFile('home/deploy/.ssh'), { recursive: true });
        fs.writeFileSync(rootFile('home/deploy/.ssh/authorized_keys'), `${KEY}\n`);
        assert.match(boot(['lockdown', '--turn-off-root-ssh', '--i-tested-deploy-login'], { FAKE_OUT_passwd: 'deploy L 2026-11-01 0 99999 7 -1' }).stderr,
            /deploy has no usable password \(passwd --status says 'L'\)/);
        assert.ok(!exists('etc/ssh/sshd_config.d/00-mindcraft-rotn.conf'));
        assert.ok(!called('systemctl').some((c) => c[1] === 'reload'));
    });

    test('lockdown needs a real key login for deploy in the ssh journal since setup, not just the flag (PR #30 finding 3)', () => {
        ubuntu();
        fs.mkdirSync(rootFile('home/deploy/.ssh'), { recursive: true });
        fs.writeFileSync(rootFile('home/deploy/.ssh/authorized_keys'), `${KEY}\n`);
        const env = { FAKE_OUT_passwd: 'deploy P 2026-11-01 0 99999 7 -1' };
        assert.match(boot(['lockdown', '--turn-off-root-ssh', '--i-tested-deploy-login'], { ...env, FAKE_OUT_journalctl: ACCEPTED }).stderr, /no setup timestamp/);
        fs.mkdirSync(rootFile('etc/mindcraft-rotn'), { recursive: true });
        fs.writeFileSync(rootFile('etc/mindcraft-rotn/.setup-epoch'), '1793534400\n');
        for (const journal of ['', 'Accepted password for deploy from 203.0.113.5 port 50122 ssh2',
            'Accepted publickey for root from 203.0.113.5 port 50122 ssh2: ED25519 SHA256:x',
            'Failed publickey for deploy from 203.0.113.5 port 50122 ssh2', `Invalid user x: ${ACCEPTED}`]) {
            const r = boot(['lockdown', '--turn-off-root-ssh', '--i-tested-deploy-login'], { ...env, FAKE_OUT_journalctl: journal });
            assert.equal(r.code, 1, journal);
            assert.match(r.stderr, /no 'Accepted publickey for deploy' in the ssh journal since setup/, journal);
        }
        assert.ok(!exists('etc/ssh/sshd_config.d/00-mindcraft-rotn.conf'));
        const j = called('journalctl')[0];
        assert.deepEqual(j, ['journalctl', '-u', 'ssh', '-u', 'sshd', '--since', '@1793534400', '--no-pager', '-o', 'cat']);
        const r = boot(['lockdown', '--turn-off-root-ssh', '--i-tested-deploy-login'], { ...env, FAKE_OUT_journalctl: `Server listening on 0.0.0.0 port 22.\n${ACCEPTED}` });
        assert.equal(r.code, 0, r.all);
    });

    test('lockdown turns root and password login off, checked by sshd -t; a rejected config is removed', () => {
        ubuntu();
        fs.mkdirSync(rootFile('home/deploy/.ssh'), { recursive: true });
        fs.writeFileSync(rootFile('home/deploy/.ssh/authorized_keys'), `${KEY}\n`);
        fs.mkdirSync(rootFile('etc/mindcraft-rotn'), { recursive: true });
        fs.writeFileSync(rootFile('etc/mindcraft-rotn/.setup-epoch'), '1793534400\n');
        const env = { FAKE_OUT_passwd: 'deploy P 2026-11-01 0 99999 7 -1', FAKE_OUT_journalctl: ACCEPTED };
        const bad = boot(['lockdown', '--turn-off-root-ssh', '--i-tested-deploy-login'], { ...env, FAKE_RC_sshd: '255' });
        assert.equal(bad.code, 1);
        assert.match(bad.stderr, /sshd -t rejected the config; removed it/);
        assert.ok(!exists('etc/ssh/sshd_config.d/00-mindcraft-rotn.conf'));
        assert.ok(!called('systemctl').some((c) => c[1] === 'reload'));
        const r = boot(['lockdown', '--turn-off-root-ssh', '--i-tested-deploy-login'], env);
        assert.equal(r.code, 0, r.all);
        const conf = read('etc/ssh/sshd_config.d/00-mindcraft-rotn.conf');
        for (const l of ['PermitRootLogin no', 'PasswordAuthentication no', 'KbdInteractiveAuthentication no', 'AllowUsers deploy'])
            assert.match(conf, new RegExp(`^${l}$`, 'm'));
        const t = callIndex((c) => c[0] === 'sshd' && c[1] === '-t');
        const reload = callIndex((c) => c.join(' ') === 'systemctl reload ssh');
        assert.ok(t >= 0 && reload > t, 'sshd -t before the reload');
    });
});

// ---------------------------------------------------------------- deploy.sh
describe('deploy.sh (real git and tar on a local repo)', { skip: windowsShellSkip('deploy.sh (real git and tar on a local repo)', '20 s') }, () => {
    const git = (cwd, ...args) => {
        const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args],
            { cwd, encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        return r.stdout.trim();
    };
    let src;
    // settings.js is a real ES module, evaluated by the real node (the fake node is removed below).
    const commit = (insecure, msg, body = null) => {
        fs.writeFileSync(path.join(src, 'settings.js'),
            body ?? `const settings = {\n    "allow_insecure_coding": ${insecure}, // comment\n};\n\nexport default settings;\n`);
        fs.writeFileSync(path.join(src, 'main.js'), `// ${msg}\n`);
        git(src, 'add', '-A');
        git(src, 'commit', '-q', '-m', msg);
        return git(src, 'rev-parse', 'HEAD');
    };
    const setupRepo = () => {
        src = path.join(tmp, 'src');
        fs.mkdirSync(src);
        git(src, 'init', '-q', '-b', 'develop');
        fs.writeFileSync(path.join(src, 'package.json'), '{"name":"x","version":"1.0.0","type":"module"}\n');
        // The Coder's tracked templates (G4 step 0): v1 at rotn-v0.0.1, then v2 from rotn-v0.0.2 on.
        fs.mkdirSync(path.join(src, 'bots'));
        fs.writeFileSync(path.join(src, 'bots', 'execTemplate.js'), '// exec v1\n');
        fs.writeFileSync(path.join(src, 'bots', 'lintTemplate.js'), '// lint v1\n');
        commit('false', 'one'); git(src, 'tag', 'rotn-v0.0.1');
        fs.writeFileSync(path.join(src, 'bots', 'execTemplate.js'), '// exec v2\n');
        commit('false', 'two'); git(src, 'tag', 'rotn-v0.0.2');
        commit('false', 'three'); git(src, 'tag', 'rotn-v0.0.3'); git(src, 'tag', 'rotn-v0.0.3-rc.1');
        git(src, 'tag', 'v0.1.0', 'rotn-v0.0.1');   // like upstream Mindcraft's tags: on develop, but not a RotN release
        commit('true', 'insecure'); git(src, 'tag', 'rotn-v0.9.0-insecure');
        // A grep for '"allow_insecure_coding": false' would pass these; evaluating settings.js does not (PR #30 finding 7).
        // 0 also catches a loose == false.
        commit(null, 'sneaky', 'const settings = {\n    // "allow_insecure_coding": false,\n    "allow_insecure_coding": true,\n};\nexport default settings;\n');
        git(src, 'tag', 'rotn-v0.9.0-sneaky');
        commit(null, 'override', 'const settings = { "allow_insecure_coding": false };\nsettings.allow_insecure_coding = 0;\nexport default settings;\n');
        git(src, 'tag', 'rotn-v0.9.0-string');
        // skills-rotn's task givers (#146, #157 review): the test-only switch and a Server giver never reach the CX23.
        commit(null, 'giverflag', 'export default { "allow_insecure_coding": false, "allow_server_task_giver": true };\n');
        git(src, 'tag', 'rotn-v0.9.0-giverflag');
        commit(null, 'giverflagnull', 'export default { "allow_insecure_coding": false, "allow_server_task_giver": null };\n');
        git(src, 'tag', 'rotn-v0.9.0-giverflagnull');
        commit(null, 'giverserver', 'export default { "allow_insecure_coding": false, "task_givers": ["JQDAW", "server"] };\n');
        git(src, 'tag', 'rotn-v0.9.0-giverserver');
        commit(null, 'giverok', 'export default { "allow_insecure_coding": false, "allow_server_task_giver": false, "task_givers": ["JQDAW"] };\n');
        git(src, 'tag', 'rotn-v0.9.0-giverok');
        git(src, 'checkout', '-q', '-b', 'side', 'rotn-v0.0.1');
        commit('false', 'side'); git(src, 'tag', 'rotn-v0.9.0-side');
        git(src, 'checkout', '-q', 'develop');
        fs.mkdirSync(rootFile('opt/mindcraft-rotn/releases'), { recursive: true });
        fs.mkdirSync(rootFile('var/lib/mindcraft-rotn/bots'), { recursive: true });   // bootstrap.sh makes it (2770)
    };
    const BASE = 'opt/mindcraft-rotn';
    const env = () => ({ MINDCRAFT_ROTN_REPO_URL: fwd(src), HEALTH_WAIT_S: '0', NPM_CI_RETRY_S: '0', FAKE_BOTS: 'rotn-bot idle-bot', FAKE_ENABLED: 'rotn-bot',
        FAKE_CURRENT_FILE: fwd(rootFile(`${BASE}/current`)) });
    const dep = (args, extra = {}) => {
        fs.rmSync(path.join(bin, 'node'), { force: true }); // deploy.sh evaluates settings.js with the real node
        return run(path.join(CX, 'deploy.sh'), args, { ...env(), ...extra });
    };
    const state = () => Object.fromEntries(read(`${BASE}/state`).trim().split('\n').map((l) => l.split('=')));
    const releases = () => fs.readdirSync(rootFile(`${BASE}/releases`)).sort();

    test('deploy a develop tag: extract, npm ci in the release, link bots, switch, restart only enabled bots', () => {
        setupRepo();
        const r = dep(['deploy', 'rotn-v0.0.1']);
        assert.equal(r.code, 0, r.all);
        const [rel] = releases();
        assert.match(rel, /^rotn-v0\.0\.1-[0-9a-f]{12}$/);
        assert.ok(exists(`${BASE}/releases/${rel}/.release-ok`) && exists(`${BASE}/releases/${rel}/main.js`));
        assert.deepEqual(state(), { current: rel, previous: '' });
        assert.equal(read(`${BASE}/current`).trim(), `releases/${rel}`);
        assert.equal(read(`${BASE}/releases/${rel}/bots`).trim(), '/var/lib/mindcraft-rotn/bots');
        const npm = called('npm');
        assert.equal(npm.length, 1);
        assert.deepEqual(npm[0].slice(0, 4), ['npm', 'ci', '--no-audit', '--no-fund']);
        assert.match(npm[0][4], new RegExp(`/releases/\\.tmp-${rel}-`), 'npm ci runs inside the new release');
        const sudo = called('sudo').map((c) => c.slice(3).join(' '));
        assert.deepEqual(sudo, ['list', 'is-enabled rotn-bot', 'is-enabled idle-bot', 'restart rotn-bot', 'is-active rotn-bot']);
        assert.ok(called('sudo').every((c) => c[1] === '-n' && c[2] === '/usr/local/sbin/mindcraft-rotn-ctl'), 'only the wrapper, non-interactive');
        assert.ok(called('chgrp').some((c) => c.join(' ').startsWith('chgrp -R mindcraft-rotn')));
        assert.match(read(`${BASE}/deploys.log`), /deploy rotn-v0\.0\.1 [0-9a-f]{40} rotn-v0\.0\.1-[0-9a-f]{12} ok bots=rotn-bot/);
    });

    // G4 step 0 (2026-11-08): the release's bots/ is the link to the shared folder, so deploy.sh installs the tracked
    // bots/ files (the Coder's templates) there before the switch; deleting them crash-looped the bot.
    const shared = (f) => rootFile(`var/lib/mindcraft-rotn/bots/${f}`);
    const resolve = (rel, f) => {
        const link = read(`${BASE}/releases/${rel}/bots`).trim();   // the fake ln writes the link's target
        return fs.readFileSync(rootFile(`${link.replace(/^\//, '')}/${f}`), 'utf8');
    };
    test('the release resolves bots/execTemplate.js and bots/lintTemplate.js after the switch; a stale copy is overwritten', () => {
        setupRepo();
        fs.writeFileSync(shared('execTemplate.js'), '// the human\'s hand copy, older\n');
        fs.mkdirSync(shared('frcfld'));
        fs.writeFileSync(shared('frcfld/memory.json'), '{}');
        const r = dep(['deploy', 'rotn-v0.0.1']);
        assert.equal(r.code, 0, r.all);
        const cur = state().current;
        assert.equal(resolve(cur, 'execTemplate.js'), '// exec v1\n');
        assert.equal(resolve(cur, 'lintTemplate.js'), '// lint v1\n');
        assert.equal(read(`${BASE}/releases/${cur}/.bots-files`), 'bots/execTemplate.js\nbots/lintTemplate.js\n');
        assert.equal(read(`${BASE}/releases/${cur}/.bots-tracked/execTemplate.js`), '// exec v1\n');
        assert.equal(fs.readFileSync(shared('frcfld/memory.json'), 'utf8'), '{}', 'a bot\'s own folder is left alone');
        assert.ok(called('chmod').some((c) => c[1] === '0644' && /\.execTemplate\.js\.new-\d+$/.test(c[2])), '0644 before the rename');
        assert.match(r.stderr, /installed 2 tracked bots\/ file\(s\) into \/var\/lib\/mindcraft-rotn\/bots/);
        assert.ok(!fs.readdirSync(rootFile('var/lib/mindcraft-rotn/bots')).some((n) => n.includes('.new-')), 'no temp file left');
    });

    test('each deploy and each rollback installs its own release\'s files: v2 after the upgrade, v1 again after the rollback', () => {
        setupRepo();
        assert.equal(dep(['deploy', 'rotn-v0.0.1']).code, 0);
        assert.equal(dep(['deploy', 'rotn-v0.0.2']).code, 0);
        assert.equal(fs.readFileSync(shared('execTemplate.js'), 'utf8'), '// exec v2\n');
        const rb = dep(['rollback']);
        assert.equal(rb.code, 0, rb.all);
        assert.equal(fs.readFileSync(shared('execTemplate.js'), 'utf8'), '// exec v1\n');
    });

    test('a shared folder deploy cannot use refuses before the switch; a template gone after the restart fails the health check and rolls back', () => {
        setupRepo();
        assert.equal(dep(['deploy', 'rotn-v0.0.1']).code, 0);
        const before = state();
        fs.rmSync(rootFile('var/lib/mindcraft-rotn/bots'), { recursive: true });
        const r = dep(['deploy', 'rotn-v0.0.2']);
        assert.equal(r.code, 1);
        assert.match(r.stderr, /\/var\/lib\/mindcraft-rotn\/bots is not a folder deploy can write: as root, once: chmod 2770 \/var\/lib\/mindcraft-rotn\/bots/);
        assert.deepEqual(state(), before, 'nothing switched');
        fs.mkdirSync(rootFile('var/lib/mindcraft-rotn/bots'), { recursive: true });
        const gone = dep(['deploy', 'rotn-v0.0.2'], { FAKE_RESTART_RM: shared('execTemplate.js') });
        assert.equal(gone.code, 1);
        assert.match(gone.stderr, /missing or different in \/var\/lib\/mindcraft-rotn\/bots: execTemplate\.js/);
        assert.match(gone.stderr, /health check failed: rolling back to /);
        assert.deepEqual(state(), before, 'rolled back');
        assert.match(read(`${BASE}/deploys.log`), /deploy rotn-v0\.0\.2 [0-9a-f]{40} \S+ FAILED rolled-back-to=/);
    });

    test('deploy then rollback: current and previous swap; the same tag again is a no-op without --force', () => {
        setupRepo();
        assert.equal(dep(['deploy', 'rotn-v0.0.1']).code, 0);
        assert.equal(dep(['deploy', 'rotn-v0.0.2']).code, 0);
        const [r1, r2] = releases();
        assert.deepEqual(state(), { current: r2, previous: r1 });
        const rb = dep(['rollback']);
        assert.equal(rb.code, 0, rb.all);
        assert.deepEqual(state(), { current: r1, previous: r2 });
        assert.equal(read(`${BASE}/current`).trim(), `releases/${r1}`);
        assert.match(read(`${BASE}/deploys.log`), new RegExp(`rollback to ${r1} from ${r2} ok`));
        const before = called('sudo').length;
        assert.match(dep(['deploy', 'rotn-v0.0.1']).stderr, /is already current/);
        assert.equal(called('sudo').length, before, 'nothing restarted');
        assert.equal(dep(['deploy', 'rotn-v0.0.1', '--force']).code, 0);
        assert.equal(called('npm').length, 2, 'an existing release is reused, not rebuilt');
    });

    test('refuses a tag that is not on develop, an unknown or malformed tag, and a release with insecure coding', () => {
        setupRepo();
        const cases = [
            [['deploy', 'rotn-v0.9.0-side'], /is not on develop; refusing/],
            [['deploy', 'rotn-v9.9.9'], /no tag 'rotn-v9\.9\.9'/],
            [['deploy', '../../etc'], /bad tag/],
            [['deploy', '--force'], /bad tag/],
            [['deploy', 'rotn-v0.9.0-insecure'], /settings\.js does not evaluate to allow_insecure_coding === false; refusing/],
            [['deploy', 'rotn-v0.9.0-sneaky'], /settings\.js does not evaluate to allow_insecure_coding === false/],
            [['deploy', 'rotn-v0.9.0-string'], /settings\.js does not evaluate to allow_insecure_coding === false/],
            [['deploy', 'rotn-v0.9.0-giverflag'], /settings\.js has allow_server_task_giver not false: it is test-only .* never on the CX23; refusing/],
            [['deploy', 'rotn-v0.9.0-giverflagnull'], /settings\.js has allow_server_task_giver not false/],
            [['deploy', 'rotn-v0.9.0-giverserver'], /settings\.js names "Server" as a task giver: the console sender is a test-only giver, never on the CX23; refusing/],
        ];
        for (const [args, re] of cases) {
            const r = dep(args);
            assert.equal(r.code, 1, args.join(' '));
            assert.match(r.stderr, re);
        }
        assert.deepEqual(releases(), [], 'no release and no temp dir left');
        assert.ok(!exists(`${BASE}/state`));
        assert.equal(called('sudo').length, 0, 'no bot was touched');
        assert.ok(!exists(`${BASE}/.deploy.lock`), 'the lock is released');
    });

    test('lead, rotn-v0.1.0: only rotn-vX.Y.Z[-suffix] tags; upstream\'s v0.x (on develop) and other shapes are refused before anything runs', () => {
        setupRepo();
        for (const bad of ['v0.1.0', 'v1', 'rotn-v1', 'rotn-v0.1', 'rotn-0.1.0', 'Rotn-v0.1.0', 'ROTN-v0.1.0', 'rotn-v0.1.0-', 'rotn-v0.1.0+x',
            'rotn-v0.1.0-rc_1', 'rotn-v0.1.0-rc/1', 'xrotn-v0.1.0', 'rotn-v0.1.0x', 'rotn-va.b.c', '']) {
            const r = dep(['deploy', bad]);
            assert.equal(r.code, 1, bad);
            assert.match(r.stderr, /usage: deploy\.sh deploy rotn-vX\.Y\.Z\[-suffix\] \[--force\] \(bad tag '.*': only this fork's rotn-v release tags are deployed; v0\.x tags are upstream Mindcraft's\)/, bad);
        }
        assert.ok(!exists(`${BASE}/repo.git`), 'refused before the clone');
        assert.deepEqual(releases(), []);
        assert.equal(called('sudo').length, 0);
        // A pre-release suffix is a RotN release too.
        const rc = dep(['deploy', 'rotn-v0.0.3-rc.1']);
        assert.equal(rc.code, 0, rc.all);
        assert.match(state().current, /^rotn-v0\.0\.3-rc\.1-[0-9a-f]{12}$/);
    });

    test('the giver settings the lead keeps in settings.js deploy: task_givers with players, the switch false (#157 review)', () => {
        setupRepo();
        const r = dep(['deploy', 'rotn-v0.9.0-giverok']);
        assert.equal(r.code, 0, r.all);
        assert.equal(state().current.startsWith('rotn-v0.9.0-giverok-'), true, JSON.stringify(state()));
    });

    test('a failed health check switches back to the previous release by itself', () => {
        setupRepo();
        assert.equal(dep(['deploy', 'rotn-v0.0.1']).code, 0);
        const r = dep(['deploy', 'rotn-v0.0.2'], { FAKE_BAD_RELEASE: 'rotn-v0.0.2-' });
        assert.equal(r.code, 1);
        assert.match(r.stderr, /health check failed: rolling back to rotn-v0\.0\.1-/);
        const [r1, r2] = releases();
        assert.deepEqual(state(), { current: r1, previous: '' });
        assert.equal(read(`${BASE}/current`).trim(), `releases/${r1}`);
        assert.match(read(`${BASE}/deploys.log`), new RegExp(`deploy rotn-v0\\.0\\.2 [0-9a-f]{40} ${r2} FAILED rolled-back-to=${r1}`));
    });

    test('npm ci is retried (GitHub release-download outage, 2026-11-08): two failures, then the third try deploys; the wait is NPM_CI_RETRY_S', () => {
        setupRepo();
        const r = dep(['deploy', 'rotn-v0.0.1'], { FAKE_FAIL_FIRST_npm: '2' });
        assert.equal(r.code, 0, r.all);
        const npm = called('npm');
        assert.equal(npm.length, 3);
        assert.equal(new Set(npm.map((c) => c.at(-1))).size, 1, 'every try runs in the same new release');
        assert.match(r.stderr, /npm ci failed \(try 1 of 3\); trying again in 0 s/);
        assert.match(r.stderr, /npm ci failed \(try 2 of 3\); trying again in 0 s/);
        assert.equal(releases().length, 1);
        assert.match(fs.readFileSync(path.join(CX, 'deploy.sh'), 'utf8'), /^NPM_CI_RETRY_S=\$\{NPM_CI_RETRY_S:-120\}$/m, 'two minutes apart by default');
        assert.match(fs.readFileSync(path.join(CX, 'deploy.sh'), 'utf8'), /^readonly NPM_CI_TRIES=3$/m);
    });

    test('npm ci failing leaves no release behind; a held lock refuses; old releases are pruned, never current or previous', () => {
        setupRepo();
        const r = dep(['deploy', 'rotn-v0.0.1'], { FAKE_RC_npm: '1' });
        assert.equal(r.code, 1);
        assert.match(r.stderr, /npm ci failed \(3 tries; if it says "No prebuilt binaries found", check GitHub's release downloads\)/);
        assert.equal(called('npm').length, 3, 'three tries, then it gives up');
        assert.deepEqual(releases(), []);
        fs.mkdirSync(rootFile(`${BASE}/.deploy.lock`));
        assert.match(dep(['deploy', 'rotn-v0.0.1']).stderr, /another deploy is running/);
        fs.rmdirSync(rootFile(`${BASE}/.deploy.lock`));
        for (const t of ['rotn-v0.0.1', 'rotn-v0.0.2', 'rotn-v0.0.3']) assert.equal(dep(['deploy', t], { KEEP_RELEASES: '0' }).code, 0, t);
        const left = releases();
        assert.equal(left.length, 2);
        assert.ok(left.every((d) => /^rotn-v0\.0\.[23]-/.test(d)), left.join(','));
    });
});
