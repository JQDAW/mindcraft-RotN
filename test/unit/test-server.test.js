// Offline unit tests for deploy/test-server.sh (gate G0). No Hetzner, no network, no Minecraft:
// hcloud, ssh and scp are fakes (test/unit/fixtures/), driven through the real bash script.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeAtomic, readJsonRetry } from './fixtures/atomic-write.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const script = path.join(repo, 'deploy', 'test-server.sh');
const fixtures = path.join(here, 'fixtures');
const PIN = '90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205';
const NOW = 1793534400; // 2026-11-01T12:00:00Z
const fwd = (p) => p.replace(/\\/g, '/');
// Fake profiles (not the real accounts' UUIDs); the API returns undashed ids and canonical case.
const PROFILES = { FRCFLD: '000000000000400080000000000000f1', JQDAW: '000000000000400080000000000000a2' };
const UUID_FRCFLD = '00000000-0000-4000-8000-0000000000f1';
const UUID_JQDAW = '00000000-0000-4000-8000-0000000000a2';

function findBash() {
    if (process.env.BASH_BIN) return process.env.BASH_BIN;
    if (process.platform === 'win32') {
        // Not C:\Windows\System32\bash.exe, which is WSL.
        for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) {
            if (fs.existsSync(p)) return p;
        }
    }
    return 'bash';
}
const BASH = findBash();

let tmp;
let env;

function writeExe(file, body) {
    fs.writeFileSync(file, body, { mode: 0o755 });
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-ts-'));
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    const node = fwd(process.execPath);
    writeExe(path.join(bin, 'hcloud'), `#!/usr/bin/env bash\nexec "${node}" "${fwd(fixtures)}/fake-hcloud.mjs" "$@"\n`);
    writeExe(path.join(bin, 'ssh'), `#!/usr/bin/env bash\nexec "${node}" "${fwd(fixtures)}/fake-ssh.mjs" ssh "$@"\n`);
    writeExe(path.join(bin, 'scp'), `#!/usr/bin/env bash\nexec "${node}" "${fwd(fixtures)}/fake-ssh.mjs" scp "$@"\n`);
    writeExe(path.join(bin, 'ping'), `#!/usr/bin/env bash\necho "fake status ping $*" >&2\n`);
    writeExe(path.join(bin, 'gh'), `#!/usr/bin/env bash\nexec "${node}" "${fwd(fixtures)}/fake-gh.mjs" "$@"\n`);
    // Offline stand-in for Mojang's profile API (curl reads file:// URLs).
    const profiles = path.join(tmp, 'profiles');
    fs.mkdirSync(profiles);
    for (const [name, id] of Object.entries(PROFILES)) {
        fs.writeFileSync(path.join(profiles, name), JSON.stringify({ id, name }));
    }
    env = {
        MOJANG_PROFILE_URL: pathToFileURL(profiles).href,
        ...process.env,
        HCLOUD_BIN: fwd(path.join(bin, 'hcloud')),
        SSH_BIN: fwd(path.join(bin, 'ssh')),
        SCP_BIN: fwd(path.join(bin, 'scp')),
        STATUS_PING_CMD: fwd(path.join(bin, 'ping')),
        FAKE_HCLOUD_STATE: fwd(path.join(tmp, 'hcloud-state.json')),
        FAKE_HCLOUD_LOG: fwd(path.join(tmp, 'hcloud-log.jsonl')),
        FAKE_SSH_LOG: fwd(path.join(tmp, 'ssh-log.jsonl')),
        ROTN_TEST_STATE_DIR: fwd(path.join(tmp, 'state')),
        ROTN_TEST_POLL_SECONDS: '0',
        ROTN_TEST_NOW: String(NOW),
        TEST_SERVER_NAME: '',
        HCLOUD_CONTEXT: '',
        ROTN_TEST_WHITELIST: '',
        ROTN_TEST_ALLOW_FROM: '',
        GH_BIN: fwd(path.join(bin, 'gh')),
        FAKE_GH_STATE: fwd(path.join(tmp, 'gh-state.json')),
        FAKE_GH_LOG: fwd(path.join(tmp, 'gh-log.jsonl')),
        FAKE_GH_BASH: fwd(BASH),
    };
    // By default the scheduled sweeper ran successfully 10 minutes ago (the preflight passes).
    ghRuns([{ databaseId: 1001, event: 'schedule', status: 'completed', conclusion: 'success', createdAt: isoZ(NOW - 600), headBranch: 'develop' }]);
    for (const k of ['HCLOUD_TOKEN', 'HCLOUD_ENDPOINT', 'HCLOUD_CONFIG']) delete env[k];
});

// prependPath: a directory of fake tools put in front of PATH inside bash (Git Bash puts /usr/bin
// ahead of the inherited PATH, so setting PATH from Node is not enough on Windows).
function run(args, extraEnv = {}, prependPath = null) {
    const argv = prependPath
        ? ['-c', 'PATH="$(cygpath -u "$1" 2>/dev/null || echo "$1"):$PATH"; shift; exec bash "$@"', '_', fwd(prependPath), fwd(script), ...args]
        : [fwd(script), ...args];
    const r = spawnSync(BASH, argv, { env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 120000 });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, all: `${r.stdout}\n${r.stderr}` };
}

const readJsonl = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const hcloudCalls = () => readJsonl(env.FAKE_HCLOUD_LOG);
const sshCalls = () => readJsonl(env.FAKE_SSH_LOG);
const state = () => readJsonRetry(env.FAKE_HCLOUD_STATE);
const withoutContext = (argv) => (argv[0] === '--context' ? argv.slice(2) : argv);
const verbOf = (argv) => withoutContext(argv).filter((a) => !a.startsWith('-')).slice(0, 2).join(' ');
const mutating = () => hcloudCalls().filter((a) => /^(\S+) (create|delete)$/.test(verbOf(a)));
const indexOfCall = (pred) => hcloudCalls().findIndex(pred);
const flagValues = (argv, flag) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]] : []));

const isoZ = (epoch) => new Date(epoch * 1000).toISOString().replace('.000Z', 'Z');
function ghRuns(runs, repos = {}) {
    writeAtomic(env.FAKE_GH_STATE, JSON.stringify({ runs, repos }));
}

function seed(st) {
    writeAtomic(env.FAKE_HCLOUD_STATE, JSON.stringify(st));
}

function decodeWriteFiles(userData) {
    const files = {};
    const re = /- path: (\S+)\n\s+permissions: '(\d+)'\n\s+encoding: b64\n\s+content: (\S+)/g;
    let m;
    while ((m = re.exec(userData))) files[m[1]] = { mode: m[2], content: Buffer.from(m[3], 'base64').toString('utf8') };
    return files;
}

describe('scripts', () => {
    test('all shell scripts pass bash -n', () => {
        for (const f of ['deploy/test-server.sh', 'deploy/test-server/build.sh', 'deploy/test-server/rotn-test.sh',
            'test/scenarios/g0-test-server.sh', 'test/scenarios/g0-watchdog.sh']) {
            const r = spawnSync(BASH, ['-n', fwd(path.join(repo, f))], { encoding: 'utf8' });
            assert.equal(r.status, 0, `${f}: ${r.stderr}`);
        }
    });

    test('no script uses the non-existent --enable-ipv4 flag', () => {
        for (const f of ['deploy/test-server.sh', 'test/scenarios/g0-watchdog.sh']) {
            const src = fs.readFileSync(path.join(repo, f), 'utf8');
            assert.ok(!src.split('\n').some((l) => !l.trim().startsWith('#') && l.includes('--enable-ipv4')), f);
        }
    });
});

describe('render-user-data', () => {
    test('embeds the remote scripts byte-for-byte (LF) and the pinned config', () => {
        const r = run(['render-user-data', '--name', 'mcr-test-unit']);
        assert.equal(r.code, 0, r.stderr);
        assert.ok(r.stdout.startsWith('#cloud-config\n'));
        assert.ok(Buffer.byteLength(r.stdout) < 32768, 'user-data under 32 KiB');
        assert.match(r.stdout, /packages:\n(\s+- \S+\n)*\s+- openjdk-8-jre-headless/);
        assert.match(r.stdout, /runcmd:\n\s+- \[\/usr\/local\/sbin\/rotn-test-build\]/);
        const files = decodeWriteFiles(r.stdout);
        const lf = (p) => fs.readFileSync(path.join(repo, p), 'utf8').replace(/\r/g, '');
        assert.equal(files['/usr/local/sbin/rotn-test-build'].content, lf('deploy/test-server/build.sh'));
        assert.equal(files['/usr/local/sbin/rotn-test'].content, lf('deploy/test-server/rotn-test.sh'));
        assert.equal(files['/etc/systemd/system/rotn-server.service'].content, lf('deploy/test-server/rotn-server.service'));
        assert.equal(files['/usr/local/sbin/rotn-test-build'].mode, '0755');
        const cfg = files['/etc/rotn-test/config.env'].content;
        assert.match(cfg, new RegExp(`^PACK_SHA256=${PIN}$`, 'm'));
        assert.match(cfg, /^FORGE_JAR=forge-1\.12\.2-14\.23\.5\.2860\.jar$/m);
        assert.match(cfg, /^PACK_URL=https:\/\/mediafilez\.forgecdn\.net\/files\/7564\/549\//m);
        assert.equal(cfg.match(/^WHITELIST_ENTRIES=(.*)$/m)[1], `FRCFLD:${UUID_FRCFLD}\\ JQDAW:${UUID_JQDAW}`,
            'default whitelist is the bot and the task giver, with UUIDs resolved on the PC');
        assert.match(cfg, /^CAPTURE=0$/m);
        assert.match(cfg, /^HOLD_START=0$/m);
        assert.match(cfg, /^HEAP_MIN=4G$/m);
        assert.match(cfg, /^HEAP_MAX=8G$/m);
        assert.doesNotMatch(r.stdout + cfg, /HCLOUD_TOKEN|OPENROUTER|password/i);
    });

    test('--capture sets the FML debug flag; --extra-mod holds the start; upload drops the URL', () => {
        const jar = path.join(tmp, 'rotn-dumper-0.1.jar');
        fs.writeFileSync(jar, 'jar');
        const r = run(['render-user-data', '--name', 'mcr-test-unit', '--capture', '--extra-mod', fwd(jar),
            '--pack-source', 'upload', '--whitelist', 'FRCFLD']);
        assert.equal(r.code, 0, r.stderr);
        const cfg = decodeWriteFiles(r.stdout)['/etc/rotn-test/config.env'].content;
        assert.match(cfg, /^CAPTURE=1$/m);
        assert.match(cfg, /^JVM_EXTRA=-Dfml\.debugNetworkHandshake=true$/m);
        assert.match(cfg, /^HOLD_START=1$/m);
        assert.match(cfg, /^PACK_URL=''$/m);
        assert.equal(cfg.match(/^WHITELIST_ENTRIES=(.*)$/m)[1], `FRCFLD:${UUID_FRCFLD}`);
    });

    test('whitelist: NAME:UUID skips the lookup; an unknown name fails before anything is created', () => {
        const r = run(['render-user-data', '--whitelist', 'Steve:00000000000040008000000000000ABC'],
            { MOJANG_PROFILE_URL: 'file:///nonexistent' });
        assert.equal(r.code, 0, r.stderr);
        const cfg = decodeWriteFiles(r.stdout)['/etc/rotn-test/config.env'].content;
        assert.match(cfg, /^WHITELIST_ENTRIES=Steve:00000000-0000-4000-8000-000000000abc$/m);

        const up = run(['up', '--yes', '--whitelist', 'NoSuchPlayer']);
        assert.notEqual(up.code, 0);
        assert.match(up.stderr, /could not resolve the UUID of 'NoSuchPlayer'/);
        assert.equal(hcloudCalls().length, 0, 'no hcloud call at all');
    });

    test('rejects bad input', () => {
        assert.notEqual(run(['render-user-data', '--ttl-hours', '25']).code, 0);
        assert.notEqual(run(['render-user-data', '--ttl-hours', '0']).code, 0);
        assert.notEqual(run(['render-user-data', '--whitelist', 'bad name;rm']).code, 0);
        assert.notEqual(run(['render-user-data', '--extra-mod', '/no/such.jar']).code, 0);
        assert.notEqual(run(['render-user-data', '--fetch', '../etc/shadow']).code, 0);
        assert.notEqual(run(['render-user-data', '--pack-source', 'ftp']).code, 0);
    });
});

describe('up / run / down', () => {
    test('no hcloud auth: fails before any mutating call', () => {
        const r = run(['up', '--yes'], { FAKE_HCLOUD_NOAUTH: '1' });
        assert.notEqual(r.code, 0);
        assert.match(r.stderr, /not authenticated/);
        assert.equal(mutating().length, 0);
    });

    test('without --yes and without a terminal it refuses to spend money', () => {
        const r = run(['up']);
        assert.notEqual(r.code, 0);
        assert.match(r.stderr, /pass --yes/);
        assert.equal(mutating().length, 0);
    });

    test('--dry-run prints the labelled create commands and creates nothing', () => {
        const r = run(['up', '--dry-run', '--name', 'mcr-test-dry']);
        assert.equal(r.code, 0, r.stderr);
        assert.equal(mutating().length, 0);
        assert.match(r.stderr, /DRY-RUN: hcloud primary-ip create --name mcr-test-dry-ipv4 --type ipv4 --location nbg1 --auto-delete=true/);
        assert.match(r.stderr, /DRY-RUN: hcloud server create --name mcr-test-dry --type cpx42 --image ubuntu-24\.04 --location nbg1 --ssh-key mcr-test-dry --primary-ipv4 mcr-test-dry-ipv4 --without-ipv6/);
        assert.match(r.stderr, new RegExp(`--label delete-after=${NOW + 8 * 3600}`));
        assert.match(r.stderr, /EUR 0\.1381\/h gross; worst case \(TTL 8h, sweeper deletes it\) ~9 billed hours, EUR 1\.24/);
        assert.deepEqual(fs.readdirSync(path.join(env.ROTN_TEST_STATE_DIR, 'active')), [], 'no stale state left behind');
        assert.ok(fs.existsSync(path.join(env.ROTN_TEST_STATE_DIR, 'dry-run-user-data.yaml')));
    });

    test('run: creates labelled resources in order, runs the command, then deletes server before IP', () => {
        const marker = path.join(tmp, 'cmd-env.txt');
        const r = run(['run', '--yes', '--name', 'mcr-test-run', '--', BASH, '-c',
            `env | grep ^TEST_SERVER_ > "${fwd(marker)}"`]);
        assert.equal(r.code, 0, r.all);

        const calls = hcloudCalls();
        const iKey = indexOfCall((a) => verbOf(a) === 'ssh-key create');
        const iIp = indexOfCall((a) => verbOf(a) === 'primary-ip create');
        const iSrv = indexOfCall((a) => verbOf(a) === 'server create');
        const iSrvDel = indexOfCall((a) => verbOf(a) === 'server delete');
        assert.ok(iKey >= 0 && iKey < iIp && iIp < iSrv && iSrv < iSrvDel, 'create key, IP, server; then delete');
        const delIp = indexOfCall((a) => verbOf(a) === 'primary-ip delete');
        assert.ok(delIp === -1 || delIp > iSrvDel, 'IP is never deleted before the server');

        for (const i of [iKey, iIp, iSrv]) {
            const labels = flagValues(calls[i], '--label');
            assert.deepEqual(labels, ['purpose=mindcraft-rotn-test', `delete-after=${NOW + 8 * 3600}`, 'batch=mcr-test-run']);
        }
        assert.ok(!calls.flat().includes('--enable-ipv4'));

        const st = state();
        assert.equal(st.servers.length, 0);
        assert.equal(st.primary_ips.length, 0);
        assert.equal(st.ssh_keys.length, 0);

        const seen = fs.readFileSync(marker, 'utf8');
        assert.match(seen, /^TEST_SERVER_NAME=mcr-test-run$/m);
        assert.match(seen, /^TEST_SERVER_HOST=203\.0\.113\.\d+$/m);
        assert.match(seen, /^TEST_SERVER_PORT=25565$/m);

        const ledger = readJsonl(path.join(env.ROTN_TEST_STATE_DIR, 'ledger.jsonl'));
        assert.deepEqual(ledger.map((e) => e.event), ['created', 'deleted']);
        assert.equal(ledger[1].price_hourly_gross_eur, '0.1381');
        assert.equal(ledger[1].hours_billed, 1);
        assert.equal(ledger[1].cost_estimate_eur, '0.1381');

        const archive = fs.readdirSync(path.join(env.ROTN_TEST_STATE_DIR, 'archive'));
        assert.equal(archive.length, 1);
        assert.ok(!fs.existsSync(path.join(env.ROTN_TEST_STATE_DIR, 'archive', archive[0], 'id_ed25519')), 'private key removed');
        assert.match(r.stderr, /verified gone: server, Primary IPv4 and SSH key of mcr-test-run/);
    });

    test('run: a failing command still tears down and its exit code is returned', () => {
        const r = run(['run', '--yes', '--name', 'mcr-test-fail', '--', BASH, '-c', 'exit 7']);
        assert.equal(r.code, 7, r.all);
        const st = state();
        assert.equal(st.servers.length + st.primary_ips.length + st.ssh_keys.length, 0);
    });

    test('up: a failed server create cleans up the IP and key already created', () => {
        const r = run(['up', '--yes', '--name', 'mcr-test-crfail'], { FAKE_HCLOUD_FAIL: 'server create' });
        assert.notEqual(r.code, 0);
        const st = state();
        assert.equal(st.primary_ips.length, 0);
        assert.equal(st.ssh_keys.length, 0);
        assert.match(r.stderr, /EXIT trap: tearing down mcr-test-crfail/);
    });

    test('up: cloud-init finishing without starting the build fails early and tears down', () => {
        const r = run(['up', '--yes', '--name', 'mcr-test-ci'], { FAKE_SSH_PHASES: 'booting:running,booting:error' });
        assert.notEqual(r.code, 0);
        assert.match(r.stderr, /cloud-init finished \(booting:error\) but the build never started/);
        const st = state();
        assert.equal(st.servers.length + st.primary_ips.length + st.ssh_keys.length, 0);
    });

    test('up: a failed build tears everything down and shows the build log', () => {
        const r = run(['up', '--yes', '--name', 'mcr-test-bfail'], { FAKE_SSH_PHASES: 'booting,packages,failed:java is not version 8' });
        assert.notEqual(r.code, 0);
        assert.match(r.stderr, /build failed: failed:java is not version 8/);
        assert.match(r.stderr, /fake build log/);
        const st = state();
        assert.equal(st.servers.length + st.primary_ips.length + st.ssh_keys.length, 0);
    });

    test('up: success leaves the server running until down; down verifies everything is gone', () => {
        const up = run(['up', '--yes', '--name', 'mcr-test-keep', '--console', 'list']);
        assert.equal(up.code, 0, up.all);
        assert.equal(state().servers.length, 1);
        assert.match(up.stderr, /READY: mcr-test-keep at 203\.0\.113\.\d+:25565/);
        assert.ok(sshCalls().some((c) => c.join(' ').includes('rotn-test console --wait 5 -- list')));
        const verify = fs.readFileSync(path.join(env.ROTN_TEST_STATE_DIR, 'active', 'mcr-test-keep', 'verify.txt'), 'utf8');
        assert.match(verify, /^phase=ready$/m);

        const again = run(['up', '--yes', '--name', 'mcr-test-second']);
        assert.notEqual(again.code, 0, 'refuses a second server without --allow-multiple');
        assert.match(again.stderr, /already exist: server: mcr-test-keep; primary-ip: mcr-test-keep-ipv4; ssh-key: mcr-test-keep;/);

        const down = run(['down']);
        assert.equal(down.code, 0, down.all);
        const st = state();
        assert.equal(st.servers.length + st.primary_ips.length + st.ssh_keys.length, 0);
    });

    test('down: reports failure when a server will not go away', () => {
        assert.equal(run(['up', '--yes', '--name', 'mcr-test-sticky']).code, 0);
        const down = run(['down', '--name', 'mcr-test-sticky'], { FAKE_HCLOUD_STICKY: 'server' });
        assert.notEqual(down.code, 0);
        assert.match(down.stderr, /INCOMPLETE/);
    });

    test('need-pack: verifies the local zip against the pin, then uploads it', () => {
        const zip = path.join(tmp, 'pack.zip');
        fs.writeFileSync(zip, 'not really a zip');
        const fakes = path.join(tmp, 'packbin');
        fs.mkdirSync(fakes);
        writeExe(path.join(fakes, 'sha256sum'), `#!/usr/bin/env bash\necho "${PIN}  $1"\n`);
        writeExe(path.join(fakes, 'stat'), '#!/usr/bin/env bash\necho 791130136\n');
        const r = run(['run', '--yes', '--name', 'mcr-test-upload', '--pack-zip', fwd(zip), '--', 'true'], {
            FAKE_SSH_PHASES: 'booting,pack,need-pack,need-pack,unpack,ready',
        }, fakes);
        assert.equal(r.code, 0, r.all);
        const scps = sshCalls().filter((c) => c[0] === 'scp');
        assert.equal(scps.length, 1, 'uploaded exactly once');
        assert.ok(scps[0].some((a) => a.endsWith(':/opt/rotn/incoming/pack.zip.part')));
        assert.ok(sshCalls().some((c) => c.join(' ').includes('mv -f /opt/rotn/incoming/pack.zip.part /opt/rotn/incoming/pack.zip')));
    });

    test('need-pack with a zip that does not match the pin aborts and tears down', () => {
        const zip = path.join(tmp, 'pack.zip');
        fs.writeFileSync(zip, 'wrong');
        const r = run(['up', '--yes', '--name', 'mcr-test-badzip', '--pack-zip', fwd(zip)], {
            FAKE_SSH_PHASES: 'need-pack',
        });
        assert.notEqual(r.code, 0);
        assert.match(r.stderr, /pack zip is \d+ bytes, expected 791130136/);
        assert.equal(sshCalls().filter((c) => c[0] === 'scp').length, 0);
        assert.equal(state().servers.length, 0);
    });

    test('hold: uploads extra mods, then releases the start', () => {
        const jar = path.join(tmp, 'rotn-dumper-0.1.jar');
        fs.writeFileSync(jar, 'jar');
        const r = run(['run', '--yes', '--name', 'mcr-test-hold', '--extra-mod', fwd(jar), '--fetch', 'dumps', '--', BASH, '-c', 'true'], {
            FAKE_SSH_PHASES: 'booting,configured,hold,hold,starting,ready',
        });
        assert.equal(r.code, 0, r.all);
        const calls = sshCalls();
        const iUp = calls.findIndex((c) => c[0] === 'scp' && c.some((a) => a.endsWith(':/opt/rotn/server/mods/rotn-dumper-0.1.jar')));
        const iStart = calls.findIndex((c) => c.join(' ').includes('rotn-test start'));
        assert.ok(iUp >= 0 && iStart > iUp, 'mod uploaded before the start is released');
        assert.ok(calls.some((c) => c[0] === 'scp' && c.includes('-r') && c.some((a) => a.endsWith(':/opt/rotn/server/dumps'))));
    });
});

describe('sweep (watchdog)', () => {
    const P = { purpose: 'mindcraft-rotn-test' };
    const iso = (epoch) => new Date(epoch * 1000).toISOString().replace('.000Z', '+00:00');

    function world() {
        seed({
            next_id: 5000,
            servers: [
                { id: 1, name: 'expired', labels: { ...P, 'delete-after': String(NOW - 60) }, created: iso(NOW - 9 * 3600), public_net: { ipv4: { id: 11 } } },
                { id: 2, name: 'fresh', labels: { ...P, 'delete-after': String(NOW + 3600) }, created: iso(NOW - 600), public_net: { ipv4: { id: 12 } } },
                { id: 3, name: 'unlabelled-old', labels: { 'delete-after': String(NOW - 99999) }, created: iso(NOW - 99 * 3600), public_net: { ipv4: { id: 13 } } },
                { id: 4, name: 'no-deadline-old', labels: { ...P }, created: iso(NOW - 9 * 3600), public_net: { ipv4: null } },
                { id: 5, name: 'no-deadline-new', labels: { ...P }, created: iso(NOW - 3600), public_net: { ipv4: null } },
                { id: 6, name: 'bot-cx23', labels: {}, created: iso(NOW - 999 * 3600), public_net: { ipv4: { id: 16 } } },
            ],
            primary_ips: [
                { id: 11, name: 'expired-ipv4', labels: { ...P, 'delete-after': String(NOW - 60) }, assignee_id: 1, auto_delete: false, created: iso(NOW - 9 * 3600) },
                { id: 12, name: 'fresh-ipv4', labels: { ...P, 'delete-after': String(NOW + 3600) }, assignee_id: 2, auto_delete: true, created: iso(NOW - 600) },
                { id: 13, name: 'foreign-ipv4', labels: { ...P, 'delete-after': String(NOW - 60) }, assignee_id: 3, auto_delete: false, created: iso(NOW - 9 * 3600) },
                { id: 14, name: 'orphan-ipv4', labels: { ...P, 'delete-after': String(NOW - 60) }, assignee_id: null, auto_delete: false, created: iso(NOW - 9 * 3600) },
                { id: 16, name: 'bot-ipv4', labels: {}, assignee_id: 6, auto_delete: false, created: iso(NOW - 999 * 3600) },
            ],
            ssh_keys: [
                { id: 21, name: 'expired', labels: { ...P, 'delete-after': String(NOW - 60) }, created: iso(NOW - 9 * 3600) },
                { id: 22, name: 'fresh', labels: { ...P, 'delete-after': String(NOW + 3600) }, created: iso(NOW - 600) },
                { id: 23, name: 'human-key', labels: {}, created: iso(NOW - 999 * 3600) },
            ],
        });
    }

    test('deletes only expired labelled resources; never touches unlabelled ones', () => {
        world();
        const r = run(['sweep']);
        const st = state();
        assert.deepEqual(st.servers.map((s) => s.name).sort(), ['bot-cx23', 'fresh', 'no-deadline-new', 'unlabelled-old']);
        assert.deepEqual(st.primary_ips.map((s) => s.name).sort(), ['bot-ipv4', 'foreign-ipv4', 'fresh-ipv4']);
        assert.deepEqual(st.ssh_keys.map((s) => s.name).sort(), ['fresh', 'human-key']);
        // foreign-ipv4 is labelled and expired but assigned to an unlabelled server: skipped and reported.
        assert.match(r.stderr, /foreign-ipv4 .* not labelled: skipping/);
        assert.notEqual(r.code, 0, 'an expired labelled resource remains, so the sweep alerts');
        const deletes = mutating().filter((a) => verbOf(a).endsWith('delete'));
        for (const a of deletes) assert.ok(!['3', '6', '16', '23'].includes(a[a.length - 1]), `touched ${a}`);
        const iSrv = indexOfCall((a) => verbOf(a) === 'server delete');
        const iIp = indexOfCall((a) => verbOf(a) === 'primary-ip delete');
        assert.ok(iSrv < iIp, 'servers are deleted before IPs');
    });

    test('a clean project sweeps with exit 0', () => {
        seed({ servers: [], primary_ips: [], ssh_keys: [] });
        const r = run(['sweep']);
        assert.equal(r.code, 0, r.all);
        assert.match(r.stderr, /sweep done: 0 deletion/);
    });

    test('only lists by a purpose label selector', () => {
        world();
        run(['sweep']);
        for (const a of hcloudCalls().filter((x) => verbOf(x).endsWith('list'))) {
            assert.match(flagValues(a, '-l')[0] ?? '', /^purpose=mindcraft-rotn-(test|watchdog-control)(,|$)/, `unselected list: ${a.join(' ')}`);
        }
    });

    test('watchdog-control: an expired delete-after is ignored; control-expires + 30 min grace deletes it', () => {
        const C = { purpose: 'mindcraft-rotn-watchdog-control', 'delete-after': String(NOW - 600) };
        seed({ servers: [
            { id: 7, name: 'ctl-live', labels: { ...C, 'control-expires': String(NOW + 600) }, created: iso(NOW - 600) },
            { id: 8, name: 'ctl-in-grace', labels: { ...C, 'control-expires': String(NOW - 1700) }, created: iso(NOW - 5400) },
            { id: 9, name: 'ctl-overdue', labels: { ...C, 'control-expires': String(NOW - 1900) }, created: iso(NOW - 5400) },
            { id: 10, name: 'ctl-no-expiry-old', labels: { ...C }, created: iso(NOW - 3 * 3600) },
            { id: 11, name: 'target', labels: { ...P, 'delete-after': String(NOW - 600) }, created: iso(NOW - 600) },
        ], primary_ips: [], ssh_keys: [] });
        const r = run(['sweep']);
        assert.notEqual(r.code, 0, 'ctl-no-expiry-old has no control-expires: the sweep alerts (finding 10)');
        assert.match(r.stderr, /ALERT: watchdog-control server ctl-no-expiry-old \(10\) has no valid control-expires/);
        assert.deepEqual(state().servers.map((s) => s.name).sort(), ['ctl-in-grace', 'ctl-live']);
        assert.match(r.stderr, /overdue watchdog-control server ctl-overdue \(9\): deleting/);
    });

    test('--dry-run deletes nothing', () => {
        world();
        const before = state();
        const r = run(['sweep', '--dry-run']);
        assert.match(r.stderr, /DRY-RUN: hcloud server delete 1/);
        assert.deepEqual(state(), before);
    });

    test('a far-future delete-after cannot keep a labelled server past created + 24 h + grace', () => {
        seed({ servers: [
            { id: 31, name: 'hand-set', labels: { ...P, 'delete-after': '9999999999' }, created: iso(NOW - 25 * 3600) },
            { id: 32, name: 'young', labels: { ...P, 'delete-after': '9999999999' }, created: iso(NOW - 23 * 3600) },
        ], primary_ips: [], ssh_keys: [] });
        const r = run(['sweep']);
        assert.equal(r.code, 0, r.all);
        assert.deepEqual(state().servers.map((s) => s.name), ['young']);
    });

    test('fails loudly without hcloud auth', () => {
        const r = run(['sweep'], { FAKE_HCLOUD_NOAUTH: '1' });
        assert.notEqual(r.code, 0);
    });

    test('finding 10: a missing or unparsable delete-after alerts; deletion waits for created + 8 h', () => {
        seed({ servers: [
            { id: 41, name: 'no-label-young', labels: { ...P }, created: iso(NOW - 3600) },
            { id: 42, name: 'garbage-young', labels: { ...P, 'delete-after': 'tomorrow' }, created: iso(NOW - 3600) },
            { id: 43, name: 'no-label-old', labels: { ...P }, created: iso(NOW - 9 * 3600) },
            { id: 44, name: 'good', labels: { ...P, 'delete-after': String(NOW + 600) }, created: iso(NOW - 60) },
        ], primary_ips: [], ssh_keys: [{ id: 45, name: 'key-no-label', labels: { ...P }, created: iso(NOW - 60) }] });
        const r = run(['sweep']);
        assert.notEqual(r.code, 0, 'the job must fail so GitHub notifies someone');
        for (const [n, id] of [['no-label-young', 41], ['garbage-young', 42], ['no-label-old', 43]]) {
            assert.match(r.stderr, new RegExp(`ALERT: labelled server ${n} \\(${id}\\) has no valid delete-after`));
        }
        assert.match(r.stderr, /ALERT: labelled ssh-key key-no-label \(45\)/);
        assert.doesNotMatch(r.stderr, /ALERT: .*good/);
        assert.deepEqual(state().servers.map((x) => x.name).sort(), ['garbage-young', 'good', 'no-label-young']);
        assert.deepEqual(state().ssh_keys.map((x) => x.name), ['key-no-label']);
    });
});

describe('sweeper preflight before any create (finding 5, lead rule 2026-11-01)', () => {
    const upArgs = ['up', '--yes', '--name', 'mcr-test-pre'];
    const refuses = (r, re) => {
        assert.notEqual(r.code, 0, r.all);
        assert.match(r.stderr, re);
        assert.match(r.stderr, /Refusing to create anything/);
        assert.equal(mutating().length, 0, 'nothing created');
    };

    test('a recent successful scheduled run lets up proceed and is logged', () => {
        const r = run(upArgs);
        assert.equal(r.code, 0, r.all);
        assert.match(r.stderr, /sweeper OK: scheduled run 1001 on JQDAW\/mindcraft-RotN succeeded 10 min ago \(limit 120 min\)/);
        const list = readJsonl(env.FAKE_GH_LOG).find((a) => a[0] === 'run' && a[1] === 'list' && flagValues(a, '--event').length);
        assert.deepEqual([flagValues(list, '--event')[0], flagValues(list, '--branch')[0], flagValues(list, '--workflow')[0]],
            ['schedule', 'develop', 'test-server-sweeper.yml']);
    });

    test('no scheduled run yet (only dispatch runs) refuses', () => {
        ghRuns([{ databaseId: 7, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', createdAt: isoZ(NOW - 60), headBranch: 'develop' }]);
        refuses(run(upArgs), /no successful scheduled run of test-server-sweeper.yml on develop yet/);
    });

    test('a failed, unfinished or other-branch scheduled run does not count', () => {
        ghRuns([
            { databaseId: 8, event: 'schedule', status: 'completed', conclusion: 'failure', createdAt: isoZ(NOW - 60), headBranch: 'develop' },
            { databaseId: 9, event: 'schedule', status: 'in_progress', conclusion: '', createdAt: isoZ(NOW - 30), headBranch: 'develop' },
            { databaseId: 10, event: 'schedule', status: 'completed', conclusion: 'success', createdAt: isoZ(NOW - 30), headBranch: 'agent/x' },
            { databaseId: 12, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', createdAt: isoZ(NOW - 40), headBranch: 'develop' },
        ]);
        refuses(run(upArgs), /no successful scheduled run/);
    });

    test('a stale scheduled run refuses; ROTN_SWEEPER_MAX_AGE_MIN sets the limit', () => {
        ghRuns([{ databaseId: 11, event: 'schedule', status: 'completed', conclusion: 'success', createdAt: isoZ(NOW - 3 * 3600), headBranch: 'develop' }]);
        refuses(run(upArgs), /scheduled sweeper run \(11\) is 180 min old \(limit 120\)/);
        assert.equal(run(upArgs, { ROTN_SWEEPER_MAX_AGE_MIN: '240' }).code, 0);
    });

    test('ROTN_SWEEPER_MAX_AGE_MIN must be 15..240 (PR #7 review)', () => {
        for (const bad of ['abc', '5', '241', '99999', '-1']) {
            const r = run(upArgs, { ROTN_SWEEPER_MAX_AGE_MIN: bad });
            assert.notEqual(r.code, 0, bad);
            assert.match(r.stderr, /ROTN_SWEEPER_MAX_AGE_MIN must be 15\.\.240/, bad);
        }
        assert.equal(mutating().length, 0);
    });

    test('every gh call names the repo; GH_REPO and GH_HOST cannot redirect it (PR #7 review)', () => {
        const r = run(upArgs, { GH_REPO: 'evil/repo', GH_HOST: 'evil.example' });
        assert.equal(r.code, 0, r.all);
        const calls = readJsonl(env.FAKE_GH_LOG);
        assert.ok(calls.length > 0);
        for (const a of calls) assert.deepEqual(a.slice(-2), ['--repo', 'JQDAW/mindcraft-RotN'], a.join(' '));
        seed({ servers: [], primary_ips: [], ssh_keys: [] });
        const bad = run(upArgs, { ROTN_GH_REPO: 'not a repo' });
        assert.notEqual(bad.code, 0);
        assert.match(bad.stderr, /bad ROTN_GH_REPO/);
    });

    // (b): the helper repo's scheduled dispatch, then a sweeper run on develop (lead, 2026-11-01).
    const HELPER = 'JQDAW/rotn-sweeper-cron';
    const helperRun = (o) => ({ repo: HELPER, workflow: 'dispatch-sweeper.yml', headBranch: 'main', event: 'schedule',
        status: 'completed', conclusion: 'success', ...o });
    const sweepRun = (o) => ({ event: 'workflow_dispatch', status: 'completed', conclusion: 'success', headBranch: 'develop', ...o });

    test('helper path: a scheduled helper run within 40 min plus a later sweeper run lets up proceed', () => {
        ghRuns([
            { databaseId: 11, event: 'schedule', status: 'completed', conclusion: 'success', createdAt: isoZ(NOW - 5 * 3600), headBranch: 'develop' },
            helperRun({ databaseId: 2001, createdAt: isoZ(NOW - 600) }),
            sweepRun({ databaseId: 3001, createdAt: isoZ(NOW - 591) }),
        ]);
        const r = run(upArgs);
        assert.equal(r.code, 0, r.all);
        assert.match(r.stderr, /sweeper OK \(via helper\): helper scheduled run 2001 on JQDAW\/rotn-sweeper-cron succeeded 10 min ago \(limit 40 min\), then sweeper run 3001 \(workflow_dispatch\) on develop succeeded/);
        const calls = readJsonl(env.FAKE_GH_LOG);
        for (const a of calls) {
            if (a[0] === 'api') {
                assert.deepEqual(a, ['api', '-X', 'GET', `repos/${HELPER}`, '--jq', '.pushed_at'], 'the keep-alive reminder is one read-only GET');
                continue;
            }
            assert.deepEqual(a.slice(0, 2), ['run', 'list'], `read-only calls only: ${a.join(' ')}`);
            assert.ok(['JQDAW/mindcraft-RotN', HELPER].includes(a.at(-1)) && a.at(-2) === '--repo', a.join(' '));
        }
        const helperCall = calls.find((a) => a.at(-1) === HELPER);
        assert.deepEqual([flagValues(helperCall, '--workflow')[0], flagValues(helperCall, '--event')[0]], ['dispatch-sweeper.yml', 'schedule']);
    });

    test('helper path: GH_REPO and GH_HOST cannot redirect the helper call', () => {
        ghRuns([helperRun({ databaseId: 2001, createdAt: isoZ(NOW - 600) }), sweepRun({ databaseId: 3001, createdAt: isoZ(NOW - 500) })]);
        const r = run(upArgs, { GH_REPO: 'evil/repo', GH_HOST: 'evil.example' });
        assert.equal(r.code, 0, r.all);
        assert.ok(readJsonl(env.FAKE_GH_LOG).some((a) => a.at(-1) === HELPER));
        seed({ servers: [], primary_ips: [], ssh_keys: [] });
        const bad = run(upArgs, { ROTN_SWEEPER_HELPER_REPO: 'not a repo' });
        assert.notEqual(bad.code, 0);
        assert.match(bad.stderr, /bad ROTN_SWEEPER_HELPER_REPO/);
    });

    test('helper path: a plain dispatch run without a scheduled helper run never counts', () => {
        ghRuns([sweepRun({ databaseId: 3001, createdAt: isoZ(NOW - 60) })]);
        refuses(run(upArgs), /no successful scheduled run of test-server-sweeper.yml on develop yet; and via the helper: no successful scheduled run of dispatch-sweeper.yml in JQDAW\/rotn-sweeper-cron/);
    });

    test('helper path: the helper\'s own manual, failed or wrong-repo runs do not count', () => {
        const later = sweepRun({ databaseId: 3001, createdAt: isoZ(NOW - 60) });
        for (const h of [
            helperRun({ databaseId: 2001, createdAt: isoZ(NOW - 600), event: 'workflow_dispatch' }),
            helperRun({ databaseId: 2002, createdAt: isoZ(NOW - 600), conclusion: 'failure' }),
            helperRun({ databaseId: 2003, createdAt: isoZ(NOW - 600), status: 'in_progress', conclusion: '' }),
            helperRun({ databaseId: 2004, createdAt: isoZ(NOW - 600), repo: 'JQDAW/mindcraft-RotN' }),
            helperRun({ databaseId: 2005, createdAt: isoZ(NOW - 600), workflow: 'other.yml' }),
        ]) {
            ghRuns([h, later]);
            refuses(run(upArgs), /via the helper: no successful scheduled run of dispatch-sweeper.yml/);
        }
    });

    test('helper path: a helper run older than 40 min refuses; 40 min still passes', () => {
        ghRuns([helperRun({ databaseId: 2001, createdAt: isoZ(NOW - 41 * 60) }), sweepRun({ databaseId: 3001, createdAt: isoZ(NOW - 60) })]);
        refuses(run(upArgs), /via the helper: the last successful scheduled helper run \(2001\) is 41 min old \(limit 40\)/);
        ghRuns([helperRun({ databaseId: 2001, createdAt: isoZ(NOW - 40 * 60) }), sweepRun({ databaseId: 3001, createdAt: isoZ(NOW - 60) })]);
        assert.equal(run(upArgs).code, 0);
    });

    test('helper path: the sweeper run must succeed on develop and be created after the helper run', () => {
        const h = helperRun({ databaseId: 2001, createdAt: isoZ(NOW - 600) });
        for (const s of [
            sweepRun({ databaseId: 3001, createdAt: isoZ(NOW - 601) }),
            sweepRun({ databaseId: 3002, createdAt: isoZ(NOW - 600) }),
            sweepRun({ databaseId: 3004, createdAt: isoZ(NOW - 300), status: 'in_progress', conclusion: '' }),
            sweepRun({ databaseId: 3005, createdAt: isoZ(NOW - 300), headBranch: 'agent/x' }),
        ]) {
            ghRuns([h, s]);
            refuses(run(upArgs), /via the helper: no successful test-server-sweeper.yml run on develop after helper run 2001/);
        }
    });

    test('helper path: keep-alive reminder from day 45 of no pushes to the helper repo; it never refuses', () => {
        const runs = [helperRun({ databaseId: 2001, createdAt: isoZ(NOW - 600) }), sweepRun({ databaseId: 3001, createdAt: isoZ(NOW - 500) })];
        ghRuns(runs, { [HELPER]: { pushed_at: isoZ(NOW - 44 * 86400) } });
        const fresh = run(['up', '--yes', '--name', 'mcr-test-ka1']);
        assert.equal(fresh.code, 0, fresh.all);
        assert.doesNotMatch(fresh.stderr, /last pushed/);
        seed({ servers: [], primary_ips: [], ssh_keys: [] });
        ghRuns(runs, { [HELPER]: { pushed_at: isoZ(NOW - 50 * 86400) } });
        const idle = run(['up', '--yes', '--name', 'mcr-test-ka2']);
        assert.equal(idle.code, 0, idle.all);
        assert.match(idle.stderr, /WARNING: JQDAW\/rotn-sweeper-cron was last pushed 50 days ago; GitHub disables its scheduled workflow after 60 days without activity\. Push any small commit/);
        seed({ servers: [], primary_ips: [], ssh_keys: [] });
        ghRuns(runs);
        const unknown = run(['up', '--yes', '--name', 'mcr-test-ka3']);
        assert.equal(unknown.code, 0, unknown.all);
        assert.match(unknown.stderr, /WARNING: could not read the last push of JQDAW\/rotn-sweeper-cron/);
    });

    // (c): an external cron service dispatches the sweeper every 15 min (lead and human, 2026-11-01).
    const cadence = (...agesS) => agesS.map((a, i) => sweepRun({ databaseId: 4000 + i, createdAt: isoZ(NOW - a) }));
    const refusesCadence = (runs, re) => {
        ghRuns(runs);
        refuses(run(upArgs), new RegExp(`; and via the cadence: ${re.source}`));
    };

    test('cadence path: 3 dispatch runs 15 min apart, newest 1 min old, lets up proceed', () => {
        ghRuns(cadence(60, 960, 1860));
        const r = run(upArgs);
        assert.equal(r.code, 0, r.all);
        assert.match(r.stderr, /sweeper OK \(via cadence\): cadence of 3 dispatch runs on develop in the last 50 min, gaps 15, 15 min, newest 4000 1 min ago/);
        const calls = readJsonl(env.FAKE_GH_LOG);
        for (const a of calls) {
            assert.deepEqual(a.slice(0, 2), ['run', 'list'], `read-only calls only: ${a.join(' ')}`);
            assert.equal(a.at(-2), '--repo', a.join(' '));
        }
        const c = calls.find((a) => flagValues(a, '--event')[0] === 'workflow_dispatch');
        assert.deepEqual([flagValues(c, '--workflow')[0], flagValues(c, '--branch')[0], c.at(-1)], ['test-server-sweeper.yml', 'develop', 'JQDAW/mindcraft-RotN']);
        seed({ servers: [], primary_ips: [], ssh_keys: [] });
        ghRuns(cadence(300, 1200, 2100, 3000));
        assert.equal(run(['up', '--yes', '--name', 'mcr-test-cad4']).code, 0, '4 runs, newest 5 min, oldest exactly 50 min');
    });

    test('cadence path: gaps too short (an extra dispatch) or too long (a missed one) refuse', () => {
        refusesCadence(cadence(60, 300, 960, 1860), /dispatch-run gaps 15, 11, 4 min are not all 10\.\.20 min/);
        refusesCadence(cadence(60, 960, 2400), /dispatch-run gaps 24, 15 min are not all 10\.\.20 min/);
        refusesCadence(cadence(60, 120, 180), /dispatch-run gaps 1, 1 min are not all 10\.\.20 min/);
    });

    test('cadence path: too few runs, including a one-off manual dispatch, refuse', () => {
        refusesCadence(cadence(60), /only 1 successful dispatch runs on develop in the last 50 min \(need 3\)/);
        refusesCadence(cadence(60, 960), /only 2 successful/);
        refusesCadence(cadence(60, 960, 3060), /only 2 successful/);
    });

    test('cadence path: boundaries pinned, the passing side (PR #21 review finding 2)', () => {
        for (const [name, ages] of [
            ['mcr-test-b600', [60, 660, 1260]], // gaps of exactly 600 s
            ['mcr-test-b1200', [60, 1260, 2460]], // gaps of exactly 1200 s
            ['mcr-test-bwin', [1140, 2100, 3000]], // the oldest exactly 50 min old is inside the window
            ['mcr-test-bnew', [1194, 2094, 2994]], // newest 19.9 min
        ]) {
            seed({ servers: [], primary_ips: [], ssh_keys: [] });
            ghRuns(cadence(...ages));
            const r = run(['up', '--yes', '--name', name]);
            assert.equal(r.code, 0, `${ages}: ${r.all}`);
            assert.match(r.stderr, /sweeper OK \(via cadence\)/);
        }
    });

    test('cadence path: boundaries pinned, the refusing side (PR #21 review finding 2)', () => {
        refusesCadence(cadence(60, 654, 1254), /dispatch-run gaps 10, 9\.9 min are not all 10\.\.20 min/); // 594 s (gaps listed oldest first)
        refusesCadence(cadence(60, 1266, 2466), /dispatch-run gaps 20, 20\.1 min are not all 10\.\.20 min/); // 1206 s
        refusesCadence(cadence(1140, 2100, 3006), /only 2 successful dispatch runs on develop in the last 50 min/); // 50 min 6 s
        refusesCadence(cadence(1200, 2100, 3000), /the newest dispatch run \(4000\) is 20 min old \(limit 20\)/);
    });

    test('a newest completed sweeper run that failed blocks every path (PR #21 review finding 1)', () => {
        const failed = (event, o = {}) => ({ databaseId: 5000, event, status: 'completed', conclusion: 'failure', createdAt: isoZ(NOW - 60), headBranch: 'develop', ...o });
        const okSched = { databaseId: 1001, event: 'schedule', status: 'completed', conclusion: 'success', createdAt: isoZ(NOW - 600), headBranch: 'develop' };
        // (a) would pass on its own:
        ghRuns([okSched, failed('schedule')]);
        refuses(run(upArgs), /the newest completed schedule sweeper run on develop \(5000, \S+\) concluded failure/);
        // (b) would pass on its own:
        ghRuns([helperRun({ databaseId: 2001, createdAt: isoZ(NOW - 600) }), sweepRun({ databaseId: 3001, createdAt: isoZ(NOW - 500) }), failed('workflow_dispatch')]);
        refuses(run(upArgs), /newest completed workflow_dispatch sweeper run on develop \(5000, \S+\) concluded failure/);
        // (c) would pass on its own (the reviewer's case: successes 16, 31 and 46 min ago, a failure 1 min ago):
        ghRuns([...cadence(960, 1860, 2760), failed('workflow_dispatch')]);
        refuses(run(upArgs), /concluded failure/);
        for (const conclusion of ['timed_out', 'startup_failure']) {
            ghRuns([okSched, failed('workflow_dispatch', { conclusion })]);
            refuses(run(upArgs), new RegExp(`concluded ${conclusion}`));
        }
        // An older failure, a failure on another branch, a cancelled or an unfinished newer run do not block.
        for (const [i, extra] of [
            failed('schedule', { createdAt: isoZ(NOW - 900) }),
            failed('schedule', { headBranch: 'agent/x' }),
            failed('workflow_dispatch', { conclusion: 'cancelled' }),
            failed('workflow_dispatch', { status: 'in_progress', conclusion: '' }),
        ].entries()) {
            seed({ servers: [], primary_ips: [], ssh_keys: [] });
            ghRuns([okSched, extra]);
            const r = run(['up', '--yes', '--name', `mcr-test-nf${i}`]);
            assert.equal(r.code, 0, `${JSON.stringify(extra)}: ${r.all}`);
        }
    });

    test('cadence path: a stale cadence refuses (newest must be under 20 min)', () => {
        refusesCadence(cadence(1200, 2100, 3000), /the newest dispatch run \(4000\) is 20 min old \(limit 20\)/);
    });

    test('cadence path: failed, unfinished, scheduled or other-branch runs do not count', () => {
        const [a, b, c] = cadence(60, 960, 1860);
        refusesCadence([a, { ...b, conclusion: 'failure' }, c], /only 2 successful/);
        refusesCadence([a, { ...b, status: 'in_progress', conclusion: '' }, c], /only 2 successful/);
        refusesCadence([a, { ...b, headBranch: 'agent/x' }, c], /only 2 successful/);
        refusesCadence([a, { ...b, event: 'push' }, c], /only 2 successful/);
        refusesCadence([a, { ...b, repo: HELPER }, c], /only 2 successful/);
    });

    test('helper path: gh failing only on the helper repo refuses, with every path\'s reason (review nit 4)', () => {
        ghRuns([sweepRun({ databaseId: 3001, createdAt: isoZ(NOW - 60) })]);
        refuses(run(upArgs, { FAKE_GH_FAIL_REPO: HELPER }),
            /no successful scheduled run of test-server-sweeper.yml on develop yet; and via the helper: 'gh run list' on JQDAW\/rotn-sweeper-cron failed; and via the cadence: only 1 successful/);
        assert.ok(readJsonl(env.FAKE_GH_LOG).some((a) => a.at(-1) === HELPER), 'the helper repo was asked');
    });

    test('gh failing refuses before any path is tried', () => {
        refuses(run(upArgs, { FAKE_GH_FAIL: '1' }), /ERROR: 'gh run list' failed \(not logged in\?\)\. Refusing/);
    });

    test('the refusal points at ALERT lines (a persistent ALERT keeps refusing on purpose)', () => {
        ghRuns([]);
        assert.match(run(upArgs).stderr, /ALERT lines fails on purpose/);
    });

    test('gh failing (logged out) refuses', () => {
        refuses(run(upArgs, { FAKE_GH_FAIL: '1' }), /'gh run list' failed/);
    });

    test('--dry-run only warns; --skip-sweeper-check proceeds with a warning', () => {
        ghRuns([]);
        const dry = run([...upArgs, '--dry-run']);
        assert.equal(dry.code, 0, dry.all);
        assert.match(dry.stderr, /WARNING: sweeper check would refuse/);
        assert.doesNotMatch(dry.stderr, /sweeper OK/, 'a refusal must not fall through to the OK line');
        const skip = run([...upArgs, '--skip-sweeper-check']);
        assert.equal(skip.code, 0, skip.all);
        assert.match(skip.stderr, /--skip-sweeper-check: not checking the scheduled sweeper/);
    });

    test('the sweep itself never needs gh', () => {
        seed({ servers: [], primary_ips: [], ssh_keys: [] });
        assert.equal(run(['sweep'], { FAKE_GH_FAIL: '1' }).code, 0);
    });
});

describe('name validation for every command (finding 7)', () => {
    test('a bad --name or TEST_SERVER_NAME is refused before any hcloud call', () => {
        for (const [args, extra] of [
            [['down', '--name', 'x;rm -rf'], {}],
            [['down', '--name', 'MCR-TEST'], {}],
            [['console', '--name', '../etc', 'list'], {}],
            [['verify'], { TEST_SERVER_NAME: 'mcr test' }],
        ]) {
            const r = run(args, extra);
            assert.notEqual(r.code, 0, args.join(' '));
            assert.match(r.stderr, /bad --name/);
        }
        assert.equal(mutating().length, 0);
    });

    test('a bad name found in the state directory is refused too', () => {
        fs.mkdirSync(path.join(tmp, 'state', 'active', 'Bad Name'), { recursive: true });
        const r = run(['down']);
        assert.notEqual(r.code, 0);
        assert.match(r.stderr, /bad --name 'Bad Name'/);
    });
});

describe('--allow-from (finding 8)', () => {
    const cfgOf = (stdout) => decodeWriteFiles(stdout)['/etc/rotn-test/config.env'].content;
    const wl = ['--whitelist', `FRCFLD:${UUID_FRCFLD}`];

    test('CIDRs reach config.env; ROTN_TEST_ALLOW_FROM is the default; none means open', () => {
        let r = run(['render-user-data', ...wl, '--allow-from', '203.0.113.7/32', '--allow-from', '198.51.100.0/24']);
        assert.equal(r.code, 0, r.all);
        assert.match(cfgOf(r.stdout), /^ALLOW_FROM=203\.0\.113\.7\/32\\ 198\.51\.100\.0\/24$/m);
        r = run(['render-user-data', ...wl], { ROTN_TEST_ALLOW_FROM: '198.51.100.0/24' });
        assert.match(cfgOf(r.stdout), /^ALLOW_FROM=198\.51\.100\.0\/24$/m);
        r = run(['render-user-data', ...wl]);
        assert.match(cfgOf(r.stdout), /^ALLOW_FROM=''$/m);
    });

    test('bad CIDRs are refused', () => {
        // IPv6 is refused for now: test servers are created --without-ipv6 (PR #7 review).
        for (const c of ['1.2.3.4', '300.1.1.1/32', '1.2.3.4/33', 'any', '1.2.3.4/32;reboot', '::1/129', 'abc/8', '1.2.3.4/',
            '2001:db8::/48', ':::::/64', '1.2.3.4/032']) {
            const r = run(['render-user-data', ...wl, '--allow-from', c]);
            assert.notEqual(r.code, 0, c);
            assert.match(r.stderr, /--allow-from: bad CIDR/, c);
        }
    });
});

describe('g0-watchdog.sh sweeper attribution (PR #5 review nit 3)', () => {
    const wd = fwd(path.join(repo, 'test', 'scenarios', 'g0-watchdog.sh'));
    const TS = '20261101-130000';
    function runWd(args, extraEnv = {}) {
        const e = { ...env, WATCHDOG_TS: TS, WATCHDOG_POLL_SECONDS: '0', WATCHDOG_ATTRIBUTION_WAIT_S: '2', ...extraEnv };
        delete e.ROTN_TEST_NOW;
        const r = spawnSync(BASH, [wd, ...args], { env: e, encoding: 'utf8', timeout: 120000 });
        return { code: r.status, stderr: r.stderr, all: `${r.stdout}\n${r.stderr}` };
    }
    const result = () => JSON.parse(fs.readFileSync(path.join(tmp, 'state', 'watchdog', `mcr-wd-${TS}`, 'result.json'), 'utf8'));

    test('dispatch: PASS only when the dispatched run log names all three target IDs', () => {
        ghRuns([]);
        const r = runWd(['--yes', '--mode', 'dispatch', '--timeout', '1'], {
            FAKE_GH_DISPATCH_CMD: `HCLOUD_CONTEXT=mindcraft-rotn-test "${fwd(script)}" sweep` });
        assert.equal(r.code, 0, r.all);
        assert.match(r.stderr, /PASS: .* deleted by the sweeper .*\(IDs \d+, \d+, \d+ in its log/);
        const res = result();
        assert.equal(res.deleted_by_sweeper_log, true);
        assert.deepEqual(res.sweeper_logs_read, [{ id: '90000001', event: 'workflow_dispatch' }]);
        assert.equal(res.evidence_event, 'workflow_dispatch');
        for (const a of readJsonl(env.FAKE_GH_LOG)) assert.deepEqual(a.slice(-2), ['--repo', 'JQDAW/mindcraft-RotN'], a.join(' '));
        assert.equal(res.control_untouched, true);
    });

    test('dispatch: resources gone but not by the sweeper is a FAIL', () => {
        ghRuns([]);
        // The "sweeper" run deletes the target behind the sweeper's back: no "expired ... (ID): deleting" lines.
        const sneaky = `for k in server primary-ip ssh-key; do for id in $("${env.HCLOUD_BIN}" $k list -l purpose=mindcraft-rotn-test -o json | jq -r '.[].id' | tr -d '\\r'); do "${env.HCLOUD_BIN}" $k delete $id >/dev/null; done; done; echo "sweep done: 0 deletion(s), status 0"`;
        const r = runWd(['--yes', '--mode', 'dispatch', '--timeout', '1'], { FAKE_GH_DISPATCH_CMD: sneaky });
        assert.equal(r.code, 1, r.all);
        assert.match(r.stderr, /FAIL: .*deleted_by_sweeper_log=false/);
        assert.equal(result().deleted_by_sweeper_log, false);
        const st = state();
        assert.equal(st.servers.length + st.primary_ips.length + st.ssh_keys.length, 0, 'cleanup still removes the control');
    });

    // Scheduled mode: the script dispatches nothing and waits. The test plays GitHub: once both servers
    // exist it runs the real sweep and records it as a sweeper run with the given event.
    function runScheduled(event) {
        return new Promise((resolve) => {
            const e = { ...env, WATCHDOG_TS: TS, WATCHDOG_POLL_SECONDS: '1', WATCHDOG_ATTRIBUTION_WAIT_S: '3' };
            delete e.ROTN_TEST_NOW;
            ghRuns([]);
            const child = spawn(BASH, [wd, '--yes', '--mode', 'scheduled', '--timeout', '1'], { env: e });
            let stderr = '';
            child.stderr.on('data', (d) => { stderr += d; });
            let swept = false;
            const poll = setInterval(() => {
                let servers;
                try {
                    servers = state()?.servers ?? [];
                } catch {
                    return; // being replaced right now: look again on the next tick
                }
                if (swept || servers.length < 2) return;
                swept = true;
                const sw = spawnSync(BASH, [fwd(script), 'sweep'], { env: { ...env, ROTN_TEST_NOW: '', HCLOUD_CONTEXT: 'mindcraft-rotn-test' }, encoding: 'utf8' });
                const ts = new Date().toISOString();
                const log = sw.stderr.split('\n').filter(Boolean).map((l) => `sweep\tSweep\t${ts} ${l}\n`).join('');
                ghRuns([{ databaseId: 555, event, status: 'completed', conclusion: 'success', createdAt: ts.replace(/\.\d+Z$/, 'Z'), headBranch: 'develop', log }]);
            }, 200);
            child.on('exit', (code) => {
                clearInterval(poll);
                resolve({ code, stderr });
            });
        });
    }

    test('scheduled: a schedule-event sweeper run that deleted the IDs is a PASS', async () => {
        const r = await runScheduled('schedule');
        assert.equal(r.code, 0, r.stderr);
        const res = result();
        assert.equal(res.evidence_event, 'schedule');
        assert.deepEqual(res.sweeper_logs_read, [{ id: '555', event: 'schedule' }]);
    });

    test('scheduled: the same deletion by a workflow_dispatch run is NOT evidence (PR #7 review finding 1)', async () => {
        const r = await runScheduled('workflow_dispatch');
        assert.equal(r.code, 1, r.stderr);
        assert.match(r.stderr, /deleted_by_sweeper_log=false/);
        assert.deepEqual(result().sweeper_logs_read, []);
        const st = state();
        assert.equal(st.servers.length + st.primary_ips.length + st.ssh_keys.length, 0, 'cleanup still removes the control');
    });

    test('local: the local sweep output is the log that is checked', () => {
        const r = runWd(['--yes', '--mode', 'local', '--timeout', '1']);
        assert.equal(r.code, 0, r.all);
        assert.equal(result().deleted_by_sweeper_log, true);
        assert.match(r.stderr, /in its log .*sweeper\.log/);
    });
});

describe('hcloud context pin (review finding 1)', () => {
    test('every hcloud call carries --context mindcraft-rotn-test and never sees HCLOUD_TOKEN', () => {
        const r = run(['run', '--yes', '--name', 'mcr-test-ctx', '--', 'true'],
            { HCLOUD_TOKEN: 'not-a-real-token', HCLOUD_CONTEXT: 'mindcraft-rotn-test' });
        assert.equal(r.code, 0, r.all);
        const calls = hcloudCalls();
        assert.ok(calls.length > 5);
        for (const a of calls) assert.deepEqual(a.slice(0, 2), ['--context', 'mindcraft-rotn-test'], a.join(' '));
        assert.ok(!fs.existsSync(env.FAKE_HCLOUD_LOG + '.env'), 'HCLOUD_TOKEN/HCLOUD_CONTEXT stripped from hcloud env');
    });

    test('HCLOUD_ENDPOINT and HCLOUD_CONFIG never reach hcloud (another API or config file cannot redirect a create)', () => {
        const redirect = { HCLOUD_ENDPOINT: 'http://127.0.0.1:9/v1', HCLOUD_CONFIG: fwd(path.join(tmp, 'other-cli.toml')) };
        const r = run(['run', '--yes', '--name', 'mcr-test-ep', '--', 'true'], redirect);
        assert.equal(r.code, 0, r.all);
        assert.ok(hcloudCalls().length > 5);
        assert.ok(!fs.existsSync(env.FAKE_HCLOUD_LOG + '.env'),
            `leaked to hcloud: ${fs.existsSync(env.FAKE_HCLOUD_LOG + '.env') ? fs.readFileSync(env.FAKE_HCLOUD_LOG + '.env', 'utf8') : ''}`);
    });

    test('any other context is refused before the first hcloud call', () => {
        for (const args of [['up', '--yes'], ['sweep'], ['down', '--name', 'mcr-test-x'], ['list']]) {
            const r = run(args, { HCLOUD_CONTEXT: 'production' });
            assert.notEqual(r.code, 0);
            assert.match(r.stderr, /refusing hcloud context 'production'/);
        }
        assert.notEqual(run(['up', '--yes', '--context', 'other']).code, 0);
        assert.equal(hcloudCalls().length, 0);
    });

    test('env-token mode (no context) is accepted only inside GitHub Actions', () => {
        seed({ servers: [], primary_ips: [], ssh_keys: [] });
        const off = run(['sweep'], { ROTN_HCLOUD_AUTH: 'env-token', GITHUB_ACTIONS: '' });
        assert.notEqual(off.code, 0);
        assert.match(off.stderr, /only for the GitHub sweeper/);
        assert.equal(hcloudCalls().length, 0);
        const on = run(['sweep'], { ROTN_HCLOUD_AUTH: 'env-token', GITHUB_ACTIONS: 'true', HCLOUD_TOKEN: 'x' });
        assert.equal(on.code, 0, on.all);
        for (const a of hcloudCalls()) assert.ok(!a.includes('--context'));
    });
});

describe('pre-create guard (review finding 6)', () => {
    for (const [kind, key] of [['primary-ip', 'primary_ips'], ['ssh-key', 'ssh_keys']]) {
        test(`a leftover labelled ${kind} blocks a new batch`, () => {
            seed({ servers: [], primary_ips: [], ssh_keys: [],
                [key]: [{ id: 1, name: 'leftover', labels: { purpose: 'mindcraft-rotn-test', 'delete-after': String(NOW + 60) }, created: '2026-11-01T11:00:00+00:00' }] });
            const r = run(['up', '--yes', '--name', 'mcr-test-guard']);
            assert.notEqual(r.code, 0);
            assert.match(r.stderr, new RegExp(`already exist: ${kind}: leftover;`));
            assert.equal(mutating().length, 0);
        });
    }
});

describe('g0-watchdog.sh against the fake API (review findings 1, 2, 4)', () => {
    const wd = fwd(path.join(repo, 'test', 'scenarios', 'g0-watchdog.sh'));
    const TS = '20261101-120000';
    function runWd(args, extraEnv = {}) {
        const e = { ...env, WATCHDOG_TS: TS, WATCHDOG_POLL_SECONDS: '0', GH_BIN: 'false', ...extraEnv };
        delete e.ROTN_TEST_NOW; // the scenario and the sweep use the real clock
        const r = spawnSync(BASH, [wd, ...args], { env: e, encoding: 'utf8', timeout: 120000 });
        return { code: r.status, stderr: r.stderr, all: `${r.stdout}\n${r.stderr}` };
    }

    test('local mode: sweep deletes the expired target and its IP, leaves the bait control; cleanup removes the control by ID', () => {
        const r = runWd(['--yes', '--mode', 'local', '--timeout', '1']);
        assert.equal(r.code, 0, r.all);
        assert.match(r.stderr, /PASS: target server, Primary IPv4 and SSH key deleted/);
        const calls = hcloudCalls();
        const ctlCreate = calls.find((a) => verbOf(a) === 'server create' && a.includes('mcr-wdctl-' + TS));
        const labels = flagValues(ctlCreate, '--label');
        assert.ok(!labels.includes('purpose=mindcraft-rotn-test'), 'control has no test label');
        assert.ok(labels.some((l) => /^delete-after=\d+$/.test(l) && Number(l.split('=')[1]) < Date.now() / 1000), 'control has an expired delete-after');
        assert.ok(labels.some((l) => /^control-expires=\d+$/.test(l)));
        // every delete is by numeric ID; the control is deleted by the cleanup, not the sweep
        for (const a of calls.filter((x) => verbOf(x).endsWith('delete'))) assert.match(a[a.length - 1], /^\d+$/, a.join(' '));
        const st = state();
        assert.equal(st.servers.length + st.primary_ips.length + st.ssh_keys.length, 0);
        for (const a of calls) assert.deepEqual(a.slice(0, 2), ['--context', 'mindcraft-rotn-test']);
    });

    test('a failed create never deletes a pre-existing resource that has the same name', () => {
        seed({ servers: [{ id: 77, name: `mcr-wdctl-${TS}`, labels: {}, created: '2026-01-01T00:00:00+00:00' }],
            primary_ips: [], ssh_keys: [{ id: 78, name: 'human-key', labels: {}, created: '2026-01-01T00:00:00+00:00' }] });
        const r = runWd(['--yes', '--mode', 'local']);
        assert.notEqual(r.code, 0, 'control create fails with a name clash');
        const st = state();
        assert.deepEqual(st.servers.map((s) => s.id), [77], 'the pre-existing server with the control name survives');
        assert.deepEqual(st.ssh_keys.map((s) => s.id), [78]);
        assert.equal(st.primary_ips.length, 0, 'the IP this run created is cleaned up');
        assert.match(r.stderr, /cleanup verified/);
        for (const a of hcloudCalls().filter((x) => verbOf(x).endsWith('delete'))) assert.notEqual(a[a.length - 1], '77');
    });

    test('HCLOUD_TOKEN, HCLOUD_CONTEXT, HCLOUD_ENDPOINT and HCLOUD_CONFIG never reach hcloud', () => {
        const r = runWd(['--yes', '--mode', 'local', '--timeout', '1'], {
            HCLOUD_TOKEN: 'not-a-real-token', HCLOUD_CONTEXT: 'mindcraft-rotn-test',
            HCLOUD_ENDPOINT: 'http://127.0.0.1:9/v1', HCLOUD_CONFIG: fwd(path.join(tmp, 'other-cli.toml')) });
        assert.equal(r.code, 0, r.all);
        assert.ok(hcloudCalls().length > 5);
        assert.ok(!fs.existsSync(env.FAKE_HCLOUD_LOG + '.env'), 'redirecting HCLOUD_* variables stripped from hcloud env');
    });

    test('refuses any other context', () => {
        const r = runWd(['--yes', '--context', 'production']);
        assert.equal(r.code, 2);
        assert.match(r.stderr, /refusing hcloud context 'production'/);
        assert.equal(hcloudCalls().length, 0);
    });
});

describe('build.sh helpers (sourced)', () => {
    function bashFn(snippet) {
        const src = fwd(path.join(repo, 'deploy/test-server/build.sh'));
        return spawnSync(BASH, ['-c', `source "${src}"; ${snippet}`], { encoding: 'utf8' });
    }

    test('set_prop replaces, appends and strips CRLF', () => {
        const f = fwd(path.join(tmp, 'server.properties'));
        fs.writeFileSync(f, '#c\r\nonline-mode=false\r\nwhite-list=false\r\nmotd=Rebirth of the Night\\!\r\n');
        const r = bashFn(`set_prop "${f}" online-mode true; set_prop "${f}" white-list true; set_prop "${f}" level-seed 42; get_prop "${f}" motd`);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout, 'Rebirth of the Night\\!\n');
        assert.equal(fs.readFileSync(f, 'utf8'), '#c\nonline-mode=true\nwhite-list=true\nmotd=Rebirth of the Night\\!\nlevel-seed=42\n');
    });

    test('write_whitelist and check_whitelist', () => {
        const dir = fwd(tmp);
        const entries = `FRCFLD:${UUID_FRCFLD} JQDAW:${UUID_JQDAW}`;
        const r = bashFn(`WHITELIST_ENTRIES="${entries}"; write_whitelist`);
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(JSON.parse(r.stdout), [{ uuid: UUID_FRCFLD, name: 'FRCFLD' }, { uuid: UUID_JQDAW, name: 'JQDAW' }]);

        fs.mkdirSync(path.join(tmp, 'server'));
        fs.mkdirSync(path.join(tmp, 'state'));
        fs.writeFileSync(path.join(tmp, 'server', 'whitelist.json'), JSON.stringify([{ uuid: UUID_FRCFLD, name: 'frcfld' }]));
        const ctx = `SERVER="${dir}/server"; STATE="${dir}/state"; WHITELIST_ENTRIES="${entries}"`;
        const chk = bashFn(`${ctx}; check_whitelist`);
        assert.notEqual(chk.status, 0, 'JQDAW missing must fail the build');
        assert.equal(fs.readFileSync(path.join(tmp, 'state', 'phase'), 'utf8').trim(), 'failed:not whitelisted after start: JQDAW');
        fs.writeFileSync(path.join(tmp, 'server', 'whitelist.json'), r.stdout);
        assert.equal(bashFn(`${ctx}; check_whitelist`).status, 0);
    });

    test('setup_firewall: open by default, only the --allow-from CIDRs otherwise (finding 8)', () => {
        const dir = fwd(tmp);
        const open = bashFn(`STATE="${dir}"; UFW_BIN=echo; setup_firewall`);
        assert.equal(open.status, 0, open.stderr);
        assert.equal(open.stdout, 'allow 22/tcp\nallow 25565/tcp\n--force enable\n');
        assert.equal(fs.readFileSync(path.join(tmp, 'firewall-allow-from'), 'utf8'), 'any\n');
        const only = bashFn(`STATE="${dir}"; UFW_BIN=echo; ALLOW_FROM="203.0.113.7/32 198.51.100.0/24"; setup_firewall`);
        assert.equal(only.stdout, [
            'allow proto tcp from 203.0.113.7/32 to any port 22', 'allow proto tcp from 203.0.113.7/32 to any port 25565',
            'allow proto tcp from 198.51.100.0/24 to any port 22', 'allow proto tcp from 198.51.100.0/24 to any port 25565',
            '--force enable', ''].join('\n'));
        assert.doesNotMatch(only.stdout, /allow 22\/tcp/);
    });

    test('has_done_line recognises the vanilla ready line only', () => {
        const ok = fwd(path.join(tmp, 'ok.log'));
        const no = fwd(path.join(tmp, 'no.log'));
        fs.writeFileSync(ok, '[12:00:00] [Server thread/INFO] [minecraft/DedicatedServer]: Done (41.234s)! For help, type "help" or "?"\n');
        fs.writeFileSync(no, '[12:00:00] [Server thread/INFO] [FML]: Done loading mods\n');
        assert.equal(bashFn(`has_done_line "${ok}"`).status, 0);
        assert.notEqual(bashFn(`has_done_line "${no}"`).status, 0);
    });

    test('the generated start script uses the configured heap and capture flag', () => {
        const r = bashFn('HEAP_MIN=4G HEAP_MAX=8G JVM_EXTRA=-Dfml.debugNetworkHandshake=true render_start_script forge-1.12.2-14.23.5.2860.jar');
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /^exec java -Xms4G -Xmx8G -Dfml\.debugNetworkHandshake=true -jar forge-1\.12\.2-14\.23\.5\.2860\.jar nogui$/m);
    });
});
