// Offline unit tests for deploy/test-server.sh (gate G0). No Hetzner, no network, no Minecraft:
// hcloud, ssh and scp are fakes (test/unit/fixtures/), driven through the real bash script.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const script = path.join(repo, 'deploy', 'test-server.sh');
const fixtures = path.join(here, 'fixtures');
const PIN = '90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205';
const NOW = 1793534400; // 2026-11-01T12:00:00Z
const fwd = (p) => p.replace(/\\/g, '/');

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
    env = {
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
    };
    delete env.HCLOUD_TOKEN;
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
const state = () => JSON.parse(fs.readFileSync(env.FAKE_HCLOUD_STATE, 'utf8'));
const verbOf = (argv) => argv.filter((a) => !a.startsWith('-')).slice(0, 2).join(' ');
const mutating = () => hcloudCalls().filter((a) => /^(\S+) (create|delete)$/.test(verbOf(a)));
const indexOfCall = (pred) => hcloudCalls().findIndex(pred);
const flagValues = (argv, flag) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]] : []));

function seed(st) {
    fs.writeFileSync(env.FAKE_HCLOUD_STATE, JSON.stringify(st));
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
        assert.match(cfg, /^WHITELIST=FRCFLD\\ JQDAW$/m, 'default whitelist is the bot and the task giver');
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
        assert.match(cfg, /^WHITELIST=FRCFLD$/m);
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
        assert.match(r.stderr, /EUR 0\.1381\/h gross; worst case \(TTL 8h\) EUR 1\.10/);
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
        assert.match(again.stderr, /already exist: mcr-test-keep/);

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

    test('overdue watchdog-control servers raise an alert but are never deleted', () => {
        seed({ servers: [
            { id: 7, name: 'mcr-wdctl-x', labels: { purpose: 'mindcraft-rotn-watchdog-control', 'delete-after': String(NOW - 1) }, created: iso(NOW - 3 * 3600) },
            { id: 8, name: 'mcr-wdctl-y', labels: { purpose: 'mindcraft-rotn-watchdog-control', 'delete-after': String(NOW + 3600) }, created: iso(NOW - 60) },
        ], primary_ips: [], ssh_keys: [] });
        const r = run(['sweep']);
        assert.notEqual(r.code, 0);
        assert.match(r.stderr, /overdue watchdog-control server\(s\), delete them by hand: mcr-wdctl-x$/m);
        assert.equal(state().servers.length, 2);
        assert.equal(mutating().length, 0);
    });

    test('--dry-run deletes nothing', () => {
        world();
        const before = state();
        const r = run(['sweep', '--dry-run']);
        assert.match(r.stderr, /DRY-RUN: hcloud server delete 1/);
        assert.deepEqual(state(), before);
    });

    test('fails loudly without hcloud auth', () => {
        const r = run(['sweep'], { FAKE_HCLOUD_NOAUTH: '1' });
        assert.notEqual(r.code, 0);
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
