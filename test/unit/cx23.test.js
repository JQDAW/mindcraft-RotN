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
    const ctl = (args, extraEnv = {}) => {
        const etc = path.join(ROOT, 'etc', 'mindcraft-rotn');
        fs.mkdirSync(etc, { recursive: true });
        fs.writeFileSync(path.join(etc, 'rotn-bot.env'), 'x=1\n');
        fs.writeFileSync(path.join(etc, 'bot.env.example'), 'x=1\n');
        const copy = path.join(tmp, 'ctl-under-test.sh');
        const body = SRC.replace(/^PATH=.*$/m, '')
            .replace('readonly SYSTEMCTL=/usr/bin/systemctl', `readonly SYSTEMCTL=${posix(path.join(bin, 'systemctl'))}`)
            .replace('readonly ETC_DIR=/etc/mindcraft-rotn', `readonly ETC_DIR=${fwd(etc)}`);
        assert.notEqual(body, SRC);
        fs.writeFileSync(copy, body);
        return run(copy, args, extraEnv);
    };

    test('systemctl and /etc are hard-coded and PATH is reset: the caller\'s environment cannot redirect root (PR #30 finding 8)', () => {
        assert.match(SRC, /^readonly SYSTEMCTL=\/usr\/bin\/systemctl$/m);
        assert.match(SRC, /^readonly ETC_DIR=\/etc\/mindcraft-rotn$/m);
        assert.match(SRC, /^PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin$/m);
        assert.ok(!/\$\{(SYSTEMCTL|MINDCRAFT_ROTN_ETC|ETC_DIR):-/.test(SRC), 'no env overrides');
    });

    test('valid actions run systemctl on exactly mindcraft-rotn@BOT.service', () => {
        assert.equal(ctl(['restart', 'rotn-bot']).code, 0);
        assert.equal(ctl(['status', 'rotn-bot']).code, 0);
        assert.equal(ctl(['is-enabled', 'rotn-bot']).code, 0);
        assert.deepEqual(called('systemctl'), [['systemctl', 'restart', 'mindcraft-rotn@rotn-bot.service'],
            ['systemctl', 'status', '--no-pager', 'mindcraft-rotn@rotn-bot.service'], ['systemctl', 'is-enabled', 'mindcraft-rotn@rotn-bot.service']]);
        assert.equal(ctl(['list']).stdout.trim(), 'rotn-bot');
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
describe('bootstrap.sh', () => {
    const ubuntu = (version = '24.04') => {
        fs.mkdirSync(rootFile('etc'), { recursive: true });
        fs.writeFileSync(rootFile('etc/os-release'), `NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="${version}"\n`);
    };
    let keyN = 0;
    const keyFile = (content = KEY) => {
        const f = fwd(path.join(tmp, `deploy-${keyN++}.pub`));
        fs.writeFileSync(f, `${content}\n`);
        return f;
    };
    const ok = { FAKE_OUT_id: '0', FAKE_RC_getent: '2', FAKE_OUT_gpg: `fpr:::::::::${FPR}:`, FAKE_OUT_node: 'v22.11.0', NODESOURCE_KEY_FPR: undefined };
    const boot = (args, extra = {}) => run(path.join(CX, 'bootstrap.sh'), args, { ...ok, ...extra });

    test('setup: users, key, sudoers, upgrades, Node 22, swap, firewall, unit; root login stays on', () => {
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
        assert.ok(called('apt-get').some((c) => c.includes('unattended-upgrades') && c.includes('git') && c.includes('ufw')));
        // Node 22 from NodeSource, key pinned
        assert.ok(called('curl').some((c) => c.includes('https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key') && c.includes('=https')));
        assert.equal(read('etc/apt/sources.list.d/nodesource.list'),
            'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n');
        assert.ok(exists('etc/apt/keyrings/nodesource.gpg'));
        assert.ok(called('apt-get').some((c) => c.includes('nodejs')));
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
        assert.ok(called('systemctl').some((c) => c[1] === 'daemon-reload'));
        // root login and password login are NOT touched by setup
        assert.ok(!exists('etc/ssh/sshd_config.d/00-mindcraft-rotn.conf'));
        assert.equal(called('sshd').length, 0);
        assert.match(r.stderr, /Root and password login are still ON/);
    });

    test('setup refuses: not root, not Ubuntu 24.04, no or bad key; nothing is created', () => {
        ubuntu();
        const cases = [
            [['setup', '--deploy-key-file', keyFile()], { FAKE_OUT_id: '1000' }, /run as root/],
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
        assert.match(boot(['setup', '--deploy-key-file', keyFile()]).stderr, /for Ubuntu 24.04/);
        assert.equal(called('useradd').length, 0);
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
            { FAKE_RC_getent: '0', FAKE_OUT_swapon: '/swapfile file 2G 0B -2' });
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
        assert.match(boot(['lockdown']).stderr, /pass --i-tested-deploy-login/);
        assert.match(boot(['lockdown', '--i-tested-deploy-login'], { FAKE_OUT_passwd: 'deploy P' }).stderr, /deploy has no authorized key/);
        fs.mkdirSync(rootFile('home/deploy/.ssh'), { recursive: true });
        fs.writeFileSync(rootFile('home/deploy/.ssh/authorized_keys'), `${KEY}\n`);
        assert.match(boot(['lockdown', '--i-tested-deploy-login'], { FAKE_OUT_passwd: 'deploy L 2026-11-01 0 99999 7 -1' }).stderr,
            /deploy has no usable password \(passwd --status says 'L'\)/);
        assert.ok(!exists('etc/ssh/sshd_config.d/00-mindcraft-rotn.conf'));
        assert.ok(!called('systemctl').some((c) => c[1] === 'reload'));
    });

    test('lockdown needs a real key login for deploy in the ssh journal since setup, not just the flag (PR #30 finding 3)', () => {
        ubuntu();
        fs.mkdirSync(rootFile('home/deploy/.ssh'), { recursive: true });
        fs.writeFileSync(rootFile('home/deploy/.ssh/authorized_keys'), `${KEY}\n`);
        const env = { FAKE_OUT_passwd: 'deploy P 2026-11-01 0 99999 7 -1' };
        assert.match(boot(['lockdown', '--i-tested-deploy-login'], { ...env, FAKE_OUT_journalctl: ACCEPTED }).stderr, /no setup timestamp/);
        fs.mkdirSync(rootFile('etc/mindcraft-rotn'), { recursive: true });
        fs.writeFileSync(rootFile('etc/mindcraft-rotn/.setup-epoch'), '1793534400\n');
        for (const journal of ['', 'Accepted password for deploy from 203.0.113.5 port 50122 ssh2',
            'Accepted publickey for root from 203.0.113.5 port 50122 ssh2: ED25519 SHA256:x',
            'Failed publickey for deploy from 203.0.113.5 port 50122 ssh2', `Invalid user x: ${ACCEPTED}`]) {
            const r = boot(['lockdown', '--i-tested-deploy-login'], { ...env, FAKE_OUT_journalctl: journal });
            assert.equal(r.code, 1, journal);
            assert.match(r.stderr, /no 'Accepted publickey for deploy' in the ssh journal since setup/, journal);
        }
        assert.ok(!exists('etc/ssh/sshd_config.d/00-mindcraft-rotn.conf'));
        const j = called('journalctl')[0];
        assert.deepEqual(j, ['journalctl', '-u', 'ssh', '-u', 'sshd', '--since', '@1793534400', '--no-pager', '-o', 'cat']);
        const r = boot(['lockdown', '--i-tested-deploy-login'], { ...env, FAKE_OUT_journalctl: `Server listening on 0.0.0.0 port 22.\n${ACCEPTED}` });
        assert.equal(r.code, 0, r.all);
    });

    test('lockdown turns root and password login off, checked by sshd -t; a rejected config is removed', () => {
        ubuntu();
        fs.mkdirSync(rootFile('home/deploy/.ssh'), { recursive: true });
        fs.writeFileSync(rootFile('home/deploy/.ssh/authorized_keys'), `${KEY}\n`);
        fs.mkdirSync(rootFile('etc/mindcraft-rotn'), { recursive: true });
        fs.writeFileSync(rootFile('etc/mindcraft-rotn/.setup-epoch'), '1793534400\n');
        const env = { FAKE_OUT_passwd: 'deploy P 2026-11-01 0 99999 7 -1', FAKE_OUT_journalctl: ACCEPTED };
        const bad = boot(['lockdown', '--i-tested-deploy-login'], { ...env, FAKE_RC_sshd: '255' });
        assert.equal(bad.code, 1);
        assert.match(bad.stderr, /sshd -t rejected the config; removed it/);
        assert.ok(!exists('etc/ssh/sshd_config.d/00-mindcraft-rotn.conf'));
        assert.ok(!called('systemctl').some((c) => c[1] === 'reload'));
        const r = boot(['lockdown', '--i-tested-deploy-login'], env);
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
describe('deploy.sh (real git and tar on a local repo)', () => {
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
        commit('false', 'one'); git(src, 'tag', 'v1');
        commit('false', 'two'); git(src, 'tag', 'v2');
        commit('false', 'three'); git(src, 'tag', 'v3');
        commit('true', 'insecure'); git(src, 'tag', 'vinsecure');
        // A grep for '"allow_insecure_coding": false' would pass these; evaluating settings.js does not (PR #30 finding 7).
        // 0 also catches a loose == false.
        commit(null, 'sneaky', 'const settings = {\n    // "allow_insecure_coding": false,\n    "allow_insecure_coding": true,\n};\nexport default settings;\n');
        git(src, 'tag', 'vsneaky');
        commit(null, 'override', 'const settings = { "allow_insecure_coding": false };\nsettings.allow_insecure_coding = 0;\nexport default settings;\n');
        git(src, 'tag', 'vstring');
        git(src, 'checkout', '-q', '-b', 'side', 'v1');
        commit('false', 'side'); git(src, 'tag', 'vside');
        git(src, 'checkout', '-q', 'develop');
        fs.mkdirSync(rootFile('opt/mindcraft-rotn/releases'), { recursive: true });
    };
    const BASE = 'opt/mindcraft-rotn';
    const env = () => ({ MINDCRAFT_ROTN_REPO_URL: fwd(src), HEALTH_WAIT_S: '0', FAKE_BOTS: 'rotn-bot idle-bot', FAKE_ENABLED: 'rotn-bot',
        FAKE_CURRENT_FILE: fwd(rootFile(`${BASE}/current`)) });
    const dep = (args, extra = {}) => {
        fs.rmSync(path.join(bin, 'node'), { force: true }); // deploy.sh evaluates settings.js with the real node
        return run(path.join(CX, 'deploy.sh'), args, { ...env(), ...extra });
    };
    const state = () => Object.fromEntries(read(`${BASE}/state`).trim().split('\n').map((l) => l.split('=')));
    const releases = () => fs.readdirSync(rootFile(`${BASE}/releases`)).sort();

    test('deploy a develop tag: extract, npm ci in the release, link bots, switch, restart only enabled bots', () => {
        setupRepo();
        const r = dep(['deploy', 'v1']);
        assert.equal(r.code, 0, r.all);
        const [rel] = releases();
        assert.match(rel, /^v1-[0-9a-f]{12}$/);
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
        assert.match(read(`${BASE}/deploys.log`), /deploy v1 [0-9a-f]{40} v1-[0-9a-f]{12} ok bots=rotn-bot/);
    });

    test('deploy then rollback: current and previous swap; the same tag again is a no-op without --force', () => {
        setupRepo();
        assert.equal(dep(['deploy', 'v1']).code, 0);
        assert.equal(dep(['deploy', 'v2']).code, 0);
        const [r1, r2] = releases();
        assert.deepEqual(state(), { current: r2, previous: r1 });
        const rb = dep(['rollback']);
        assert.equal(rb.code, 0, rb.all);
        assert.deepEqual(state(), { current: r1, previous: r2 });
        assert.equal(read(`${BASE}/current`).trim(), `releases/${r1}`);
        assert.match(read(`${BASE}/deploys.log`), new RegExp(`rollback to ${r1} from ${r2} ok`));
        const before = called('sudo').length;
        assert.match(dep(['deploy', 'v1']).stderr, /is already current/);
        assert.equal(called('sudo').length, before, 'nothing restarted');
        assert.equal(dep(['deploy', 'v1', '--force']).code, 0);
        assert.equal(called('npm').length, 2, 'an existing release is reused, not rebuilt');
    });

    test('refuses a tag that is not on develop, an unknown or malformed tag, and a release with insecure coding', () => {
        setupRepo();
        const cases = [
            [['deploy', 'vside'], /is not on develop; refusing/],
            [['deploy', 'nope'], /no tag 'nope'/],
            [['deploy', '../../etc'], /bad tag/],
            [['deploy', '--force'], /bad tag/],
            [['deploy', 'vinsecure'], /settings\.js does not evaluate to allow_insecure_coding === false; refusing/],
            [['deploy', 'vsneaky'], /settings\.js does not evaluate to allow_insecure_coding === false/],
            [['deploy', 'vstring'], /settings\.js does not evaluate to allow_insecure_coding === false/],
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

    test('a failed health check switches back to the previous release by itself', () => {
        setupRepo();
        assert.equal(dep(['deploy', 'v1']).code, 0);
        const r = dep(['deploy', 'v2'], { FAKE_BAD_RELEASE: 'v2-' });
        assert.equal(r.code, 1);
        assert.match(r.stderr, /health check failed: rolling back to v1-/);
        const [r1, r2] = releases();
        assert.deepEqual(state(), { current: r1, previous: '' });
        assert.equal(read(`${BASE}/current`).trim(), `releases/${r1}`);
        assert.match(read(`${BASE}/deploys.log`), new RegExp(`deploy v2 [0-9a-f]{40} ${r2} FAILED rolled-back-to=${r1}`));
    });

    test('npm ci failing leaves no release behind; a held lock refuses; old releases are pruned, never current or previous', () => {
        setupRepo();
        const r = dep(['deploy', 'v1'], { FAKE_RC_npm: '1' });
        assert.equal(r.code, 1);
        assert.match(r.stderr, /npm ci failed/);
        assert.deepEqual(releases(), []);
        fs.mkdirSync(rootFile(`${BASE}/.deploy.lock`));
        assert.match(dep(['deploy', 'v1']).stderr, /another deploy is running/);
        fs.rmdirSync(rootFile(`${BASE}/.deploy.lock`));
        for (const t of ['v1', 'v2', 'v3']) assert.equal(dep(['deploy', t], { KEEP_RELEASES: '0' }).code, 0, t);
        const left = releases();
        assert.equal(left.length, 2);
        assert.ok(left.every((d) => /^v[23]-/.test(d)), left.join(','));
    });
});
