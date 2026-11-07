// Offline tests for the pinned Mod Director downloads (ADR 0008): `rotn-test mod-director` on a fake server
// directory, build.sh's check at Done (sourced, with a fake systemctl), and the committed list itself. No server,
// no network.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const helper = path.join(repo, 'deploy', 'test-server', 'rotn-test.sh');
const build = path.join(repo, 'deploy', 'test-server', 'build.sh');
const committed = path.join(repo, 'deploy', 'test-server', 'mod-director.sha256');
const fwd = (p) => p.replace(/\\/g, '/');
function findBash() {
    if (process.env.BASH_BIN) return process.env.BASH_BIN;
    if (process.platform === 'win32') {
        for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) if (fs.existsSync(p)) return p;
    }
    return 'bash';
}
const BASH = findBash();
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const ESM = 'mods/esmtweaks-1.12.2-0.4.5.jar';
const BUNDLE = 'config/mod-director/file-director_requisites.bundle.json';
const ESM_BYTES = Buffer.from('fake esmtweaks jar');
const BUNDLE_BYTES = Buffer.from('{"url": []}\n');

/**
 * A fake server after its first Done: the pinned zip's files (a top-level jar, Mod Director, Forge's subfolders),
 * what Mod Director installed, what Forge extracted at run time; the build's pack file list; a pinned list.
 */
let t;
beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-moddir-'));
    const server = path.join(root, 'server');
    const state = path.join(root, 'state');
    fs.mkdirSync(state);
    const put = (rel, bytes = Buffer.from(rel)) => { fs.mkdirSync(path.dirname(path.join(server, rel)), { recursive: true }); fs.writeFileSync(path.join(server, rel), bytes); };
    const zip = ['mods/', 'mods/!mod-director-launchwrapper-1.9.1.jar', 'mods/mowziesmobs-1.5.8.jar', 'mods/1.12.2/', 'mods/1.12.2/Guidebook-1.12.2-2.9.1.s5.jar',
        'mods/memory_repo/', 'mods/memory_repo/a/b/core-3.6.0.jar', 'config/mod-director/requisites.remote.json'];
    for (const z of zip) if (!z.endsWith('/')) put(z);
    fs.writeFileSync(path.join(state, 'pack-files.list'), zip.join('\n') + '\n');
    // What build.sh's hash_pack_jars writes right after the unpack: the zip's top-level jars, by full SHA-256.
    fs.writeFileSync(path.join(state, 'pack-jars.sha256'), zip.filter((z) => /^mods\/[^/]+\.jar$/.test(z)).map((z) => `${sha(Buffer.from(z))}  ${z}`).join('\n') + '\n');
    put(ESM, ESM_BYTES);                                     // Mod Director's install, top level
    put(BUNDLE, BUNDLE_BYTES);                               // its copy of the list, if it keeps one
    put('mods/1.12.2/chunkgenlimiter-1.1-core.jar');         // Forge's ContainedDep extraction (round 9's log)
    put('mods/memory_repo/x/y/new-lib.jar');
    put('mods/musictriggers.toml');                          // a top-level non-jar: never compared
    const list = path.join(root, 'mod-director.sha256');
    fs.writeFileSync(list, `# a comment\n${sha(BUNDLE_BYTES)}  ${BUNDLE}\n${sha(ESM_BYTES)}  ${ESM}\n`);
    const env = { ...process.env, ROTN_TEST_SERVER_DIR: fwd(server), ROTN_TEST_REMOTE_STATE_DIR: fwd(state), ROTN_TEST_MODDIR_LIST: fwd(list) };
    t = { root, server, state, list, put, env };
});
const check = () => spawnSync(BASH, [fwd(helper), 'mod-director'], { encoding: 'utf8', env: t.env });

describe('rotn-test mod-director (ADR 0008)', () => {
    test('OK: the pinned jar and the list copy match; the zip\'s top-level jars are there; subfolders are never compared', () => {
        const r = check();
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.match(r.stdout, new RegExp(`^mod-director: pinned ${ESM.replace(/\./g, '\\.')} sha256 ${sha(ESM_BYTES)} OK$`, 'm'));
        assert.match(r.stdout, new RegExp(`^mod-director: pinned ${BUNDLE.replace(/\./g, '\\.')} sha256 ${sha(BUNDLE_BYTES)} OK$`, 'm'));
        assert.match(r.stdout, /^mod-director: OK: 2 pinned download\(s\) match; 2 jars of the pinned zip match; 0 extra mod\(s\)$/m);
        assert.doesNotMatch(r.stdout, /mowziesmobs/, 'the zip\'s jars only as a count when they match');
        assert.doesNotMatch(r.stdout, /chunkgenlimiter|memory_repo|1\.12\.2\/|musictriggers/, 'subfolders and non-jars are not compared');
    });

    test('the list copy is checked only if Mod Director kept it on disk', () => {
        fs.rmSync(path.join(t.server, BUNDLE));
        const r = check();
        assert.equal(r.status, 0, r.stdout);
        assert.match(r.stdout, /^mod-director: pinned config\/mod-director\/file-director_requisites\.bundle\.json not on disk: Mod Director kept no copy here \(not checked\)$/m);
        fs.writeFileSync(path.join(t.server, BUNDLE), 'a different list');
        const bad = check();
        assert.equal(bad.status, 1);
        assert.match(bad.stdout, /^mod-director: MISMATCH config\/mod-director\/file-director_requisites\.bundle\.json sha256 [0-9a-f]{64} != [0-9a-f]{64} \(pinned\)$/m);
    });

    test('fails closed: the jar\'s bytes differ, the pinned jar is missing, a zip jar is missing, an unexpected top-level jar', () => {
        fs.writeFileSync(path.join(t.server, ESM), 'a different jar');
        let r = check();
        assert.equal(r.status, 1);
        assert.match(r.stdout, new RegExp(`^mod-director: MISMATCH ${ESM.replace(/\./g, '\\.')} sha256 ${sha(Buffer.from('a different jar'))} != ${sha(ESM_BYTES)} \\(pinned\\)$`, 'm'));
        assert.match(r.stdout, /^mod-director: FAILED: 1 problem\(s\)$/m);
        fs.rmSync(path.join(t.server, ESM));
        r = check();
        assert.equal(r.status, 1);
        assert.match(r.stdout, /^mod-director: MISSING mods\/esmtweaks-1\.12\.2-0\.4\.5\.jar \(pinned\)$/m);
        fs.writeFileSync(path.join(t.server, ESM), ESM_BYTES);
        fs.rmSync(path.join(t.server, 'mods/mowziesmobs-1.5.8.jar'));
        t.put('mods/esmtweaks-1.12.2-0.4.6.jar', Buffer.from('a newer list named a newer jar'));
        r = check();
        assert.equal(r.status, 1);
        assert.match(r.stdout, /^mod-director: MISSING mods\/mowziesmobs-1\.5\.8\.jar \(pack\)$/m);
        assert.match(r.stdout, /^mod-director: EXTRA mods\/esmtweaks-1\.12\.2-0\.4\.6\.jar sha256 [0-9a-f]{64} \(not in the pinned zip or the pinned list\)$/m);
        assert.match(r.stdout, /^mod-director: FAILED: 2 problem\(s\)$/m);
    });

    test('#347 review: the zip\'s jars are checked by their bytes, not only by name', () => {
        fs.writeFileSync(path.join(t.server, 'mods/mowziesmobs-1.5.8.jar'), 'same name, other bytes');
        const r = check();
        assert.equal(r.status, 1);
        assert.match(r.stdout, /^mod-director: MISMATCH mods\/mowziesmobs-1\.5\.8\.jar sha256 [0-9a-f]{64} != [0-9a-f]{64} \(pack\)$/m);
    });

    test('#347 review: a symlinked top-level jar is compared too (! -type d), a dangling one as unreadable', () => {
        const target = path.join(t.root, 'outside.jar');
        fs.writeFileSync(target, 'outside');
        fs.symlinkSync(target, path.join(t.server, 'mods/linked.jar'));
        let r = check();
        assert.equal(r.status, 1);
        assert.match(r.stdout, new RegExp(`^mod-director: EXTRA mods/linked\\.jar sha256 ${sha(Buffer.from('outside'))} \\(not in the pinned zip or the pinned list\\)$`, 'm'));
        fs.rmSync(target);
        r = check();
        assert.equal(r.status, 1);
        assert.match(r.stdout, /^mod-director: EXTRA mods\/linked\.jar sha256 unreadable /m);
        // A symlink in place of the pinned jar is judged by the bytes it points to.
        fs.rmSync(path.join(t.server, 'mods/linked.jar'));
        fs.renameSync(path.join(t.server, ESM), path.join(t.root, 'esm-real.jar'));
        fs.symlinkSync(path.join(t.root, 'esm-real.jar'), path.join(t.server, ESM));
        assert.equal(check().status, 0);
    });

    test('an --extra-mod the harness uploaded is accepted at its recorded hash only', () => {
        t.put('mods/extra-test.jar', Buffer.from('ours'));
        assert.equal(check().status, 1, 'not recorded: an unexpected jar');
        fs.writeFileSync(path.join(t.state, 'extra-mods.sha256'), `${sha(Buffer.from('ours'))}  mods/extra-test.jar\n`);
        const ok = check();
        assert.equal(ok.status, 0, ok.stdout);
        assert.match(ok.stdout, /^mod-director: extra-mod mods\/extra-test\.jar sha256 [0-9a-f]{64} OK$/m);
        assert.match(ok.stdout, /1 extra mod\(s\)$/m);
        fs.writeFileSync(path.join(t.server, 'mods/extra-test.jar'), 'changed after the start');
        assert.equal(check().status, 1);
    });

    test('cannot check is a failure too (exit 3): no list, no pack file list, a bad line, a pinned subfolder jar', () => {
        const bad = (listText) => { fs.writeFileSync(t.list, listText); return check(); };
        let r = bad(`${'0'.repeat(63)}  ${ESM}\n`);
        assert.equal(r.status, 3);
        assert.match(r.stdout, /^mod-director: FAILED: cannot check: a bad line in /m);
        assert.equal(bad(`${sha(ESM_BYTES)}  mods/1.12.2/x.jar\n`).status, 3, 'only a top-level jar can be pinned under mods/');
        assert.equal(bad(`${sha(ESM_BYTES)}  ../etc/passwd\n`).status, 3);
        assert.equal(bad(`${sha(ESM_BYTES)}  /etc/passwd\n`).status, 3);
        fs.rmSync(t.list);
        r = check();
        assert.equal(r.status, 3);
        assert.match(r.stdout, /cannot check: no pinned list/);
        fs.writeFileSync(t.list, `${sha(ESM_BYTES)}  ${ESM}\n`);
        fs.rmSync(path.join(t.state, 'pack-jars.sha256'));
        r = check();
        assert.equal(r.status, 3);
        assert.match(r.stdout, /cannot check: no hashes of the pinned zip's jars/);
    });
});

describe('build.sh at Done (sourced; a fake systemctl)', () => {
    const buildFn = (snippet) => spawnSync(BASH, ['-c', `source "${fwd(build)}"; systemctl() { echo "systemctl $*" >> "${fwd(t.state)}/systemctl.calls"; }; ${snippet}`], {
        encoding: 'utf8',
        env: { ...t.env, ROTN_TEST_STATE: fwd(t.state), ROTN_TEST_ROOT: fwd(t.root), ROTN_TEST_BUILD_LOG: fwd(path.join(t.root, 'build.log')), ROTN_TEST_HELPER: fwd(helper) },
    });
    const phase = () => fs.readFileSync(path.join(t.state, 'phase'), 'utf8').trim();

    test('a match: the report is stored for the run log; the server keeps running', () => {
        const r = buildFn('check_mod_director; echo survived');
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /survived/);
        assert.match(fs.readFileSync(path.join(t.state, 'mod-director.txt'), 'utf8'), /^mod-director: OK: 2 pinned download\(s\) match/m);
        assert.ok(!fs.existsSync(path.join(t.state, 'systemctl.calls')));
    });

    test('a mismatch: the server is stopped and the phase is failed:mod-director with the first problem', () => {
        fs.writeFileSync(path.join(t.server, ESM), 'tampered');
        const r = buildFn('check_mod_director; echo survived');
        assert.equal(r.status, 1);
        assert.doesNotMatch(r.stdout, /survived/);
        assert.equal(fs.readFileSync(path.join(t.state, 'systemctl.calls'), 'utf8'), 'systemctl stop rotn-server\n');
        assert.match(phase(), /^failed:mod-director: MISMATCH mods\/esmtweaks-1\.12\.2-0\.4\.5\.jar sha256 [0-9a-f]{64} != [0-9a-f]{64} \(pinned\)$/);
        assert.match(fs.readFileSync(path.join(t.state, 'mod-director.txt'), 'utf8'), /FAILED: 1 problem/);
    });

    test('#347 review: hash_pack_jars hashes the zip\'s top-level jars only, from the zip\'s own file list', () => {
        fs.rmSync(path.join(t.state, 'pack-jars.sha256'));
        const r = buildFn('hash_pack_jars');
        assert.equal(r.status, 0, r.stderr);
        assert.equal(fs.readFileSync(path.join(t.state, 'pack-jars.sha256'), 'utf8'),
            ['mods/!mod-director-launchwrapper-1.9.1.jar', 'mods/mowziesmobs-1.5.8.jar'].map((z) => `${sha(Buffer.from(z))}  ${z}`).join('\n') + '\n');
    });

    test('#347 review: an --extra-mod that would replace a jar of the pinned zip is refused before the start', () => {
        fs.writeFileSync(path.join(t.server, 'mods/mowziesmobs-1.5.8.jar'), 'an upload with a zip jar\'s name');
        const r = buildFn('record_extra_mods; echo survived');
        assert.equal(r.status, 1);
        assert.doesNotMatch(r.stdout, /survived/);
        assert.equal(phase(), 'failed:extra-mod: mowziesmobs-1.5.8.jar would replace a jar of the pinned zip');
        // The same bytes under the zip's name change nothing: not refused, and not recorded as an extra.
        fs.writeFileSync(path.join(t.server, 'mods/mowziesmobs-1.5.8.jar'), 'mods/mowziesmobs-1.5.8.jar');
        const same = buildFn('record_extra_mods; echo survived');
        assert.match(same.stdout, /survived/, same.stderr);
        assert.doesNotMatch(fs.readFileSync(path.join(t.state, 'extra-mods.sha256'), 'utf8'), /mowziesmobs/);
    });

    test('record_extra_mods hashes only the top-level jars the zip does not have (symlinks included)', () => {
        t.put('mods/extra-test.jar', Buffer.from('ours'));
        fs.writeFileSync(path.join(t.root, 'linked-target.jar'), 'linked');
        fs.symlinkSync(path.join(t.root, 'linked-target.jar'), path.join(t.server, 'mods/linked-extra.jar'));
        const r = buildFn('record_extra_mods');
        assert.equal(r.status, 0, r.stderr);
        // The pinned download is also outside the zip; before the first start it is not there yet. Here it is, so it is
        // recorded too, which is harmless: the pinned list is checked first, with its own hash.
        const rec = fs.readFileSync(path.join(t.state, 'extra-mods.sha256'), 'utf8');
        assert.match(rec, new RegExp(`^${sha(Buffer.from('ours'))}  mods/extra-test\\.jar$`, 'm'));
        assert.match(rec, new RegExp(`^${sha(Buffer.from('linked'))}  mods/linked-extra\\.jar$`, 'm'));
        assert.doesNotMatch(rec, /mowziesmobs|memory_repo|1\.12\.2\/|musictriggers/);
    });

    // G3 round 10 A (infra fault, exit 125): 16 of the pinned zip's 337 top-level jars have spaces in their names, and
    // the check refused its own pack-jars.sha256 ("a bad line"); record_extra_mods' awk $2 saw only the first word.
    // These are real names from the zip (`unzip -Z1`): spaces, quotes, brackets, parentheses, a backtick, a plus.
    const ODD = ['mods/Aether Continuation v1.3.0.jar', 'mods/EndReborn [0.3.9].jar', 'mods/Fish\'s Undead Rising-1.3.2.jar',
        'mods/GlareTorch_Ver.8.11_[MC1.12](forge-1.12-14.21.1.2387).jar', 'mods/Mapmaker\'s+Gadgets-1.2_for_1.12.x.jar',
        'mods/MineTraps-1.12.2-(v.1.0.4).jar', 'mods/Pam\'s HarvestCraft 1.12.2zg.jar', 'mods/[___MixinCompat-1.1-1.12.2___].jar',
        'mods/`FermiumBooter-1.4.1.jar'];
    const addOdd = () => {
        for (const z of ODD) t.put(z);
        fs.appendFileSync(path.join(t.state, 'pack-files.list'), ODD.join('\n') + '\n');
        fs.rmSync(path.join(t.state, 'pack-jars.sha256'));
    };

    test('round 10 A: the zip\'s jar names with spaces, quotes and brackets go through the whole chain: hash, extras, check', () => {
        addOdd();
        const r = buildFn('hash_pack_jars && record_extra_mods && check_mod_director && echo survived');
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.match(r.stdout, /survived/);
        const packJars = fs.readFileSync(path.join(t.state, 'pack-jars.sha256'), 'utf8');
        for (const z of ODD) assert.ok(packJars.includes(`${sha(Buffer.from(z))}  ${z}\n`), z);
        // Not one of the zip's jars is taken for an extra mod (only the pinned download, which is not in the zip).
        assert.equal(fs.readFileSync(path.join(t.state, 'extra-mods.sha256'), 'utf8'), `${sha(ESM_BYTES)}  ${ESM}\n`);
        assert.match(fs.readFileSync(path.join(t.state, 'mod-director.txt'), 'utf8'),
            new RegExp(`^mod-director: OK: 2 pinned download\\(s\\) match; ${2 + ODD.length} jars of the pinned zip match; 1 extra mod\\(s\\)$`, 'm'));
        assert.ok(!fs.existsSync(path.join(t.state, 'systemctl.calls')), 'the server keeps running');
    });

    test('round 10 A: a changed or missing jar with such a name is a MISMATCH or MISSING, never "a bad line"', () => {
        addOdd();
        assert.equal(buildFn('hash_pack_jars').status, 0);
        fs.writeFileSync(path.join(t.server, ODD[0]), 'other bytes');
        fs.rmSync(path.join(t.server, ODD[1]));
        t.put('mods/A New Mod (1.0).jar');
        const r = check();
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stdout, /^mod-director: MISMATCH mods\/Aether Continuation v1\.3\.0\.jar sha256 [0-9a-f]{64} != [0-9a-f]{64} \(pack\)$/m);
        assert.match(r.stdout, /^mod-director: MISSING mods\/EndReborn \[0\.3\.9\]\.jar \(pack\)$/m);
        assert.match(r.stdout, /^mod-director: EXTRA mods\/A New Mod \(1\.0\)\.jar sha256 [0-9a-f]{64} \(not in the pinned zip or the pinned list\)$/m);
        assert.match(r.stdout, /^mod-director: FAILED: 3 problem\(s\)$/m);
        assert.doesNotMatch(r.stdout, /bad line/);
        // An --extra-mod upload under such a zip name, with other bytes, is still refused by name.
        fs.writeFileSync(path.join(t.server, ODD[0]), 'an upload');
        const up = buildFn('record_extra_mods; echo survived');
        assert.equal(up.status, 1);
        assert.equal(phase(), 'failed:extra-mod: Aether Continuation v1.3.0.jar would replace a jar of the pinned zip');
    });

    test('main runs the check right after the first Done, before the whitelist and ready', () => {
        const src = fs.readFileSync(build, 'utf8');
        assert.match(src, /wait_for_done\n\n {2}phase mod-director\n {2}check_mod_director\n\n {2}phase whitelist/);
        assert.match(src, /unzip -Z1 "\$INCOMING\/pack\.zip" > "\$STATE\/pack-files\.list"\n {2}hash_pack_jars\n(.*\n)? {2}rm -f "\$INCOMING\/pack\.zip"/);
        assert.match(src, /chown -R minecraft:minecraft "\$SERVER\/mods"\n {4}record_extra_mods/);
    });
});

describe('the committed list (deploy/test-server/mod-director.sha256)', () => {
    test('full SHA-256 values, the jar as a top-level mods/ path, GitHub\'s digest, the sources and ADR 0008 cited', () => {
        const text = fs.readFileSync(committed, 'utf8');
        const entries = text.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(/ {2}/));
        assert.deepEqual(entries, [
            ['48ba1339ebf6417ad571d29589e61dd0d5745dc34549b2065676ccf5a4de3792', BUNDLE],
            ['b57590bfb8d0fcb343af837a818efd8e4bcf7d6cea9a74e73da188e98235f933', ESM],
        ]);
        assert.match(text, /ADR 0008/);
        assert.doesNotMatch(text, /pending/);
        assert.match(text, /https:\/\/raw\.githubusercontent\.com\/Rebirth-of-the-Night\/Rebirth-Of-The-Night\/stable\/config\/mod-director\/fd-3\.3\.4\/file-director_requisites\.bundle\.json/);
        assert.match(text, /https:\/\/github\.com\/lirkas\/ESM-Tweaks\/releases\/download\/v0\.4\.5-compat\/esmtweaks-1\.12\.2-0\.4\.5\.jar/);
        assert.match(text, /the pinned zip ships only Mod Director itself \(mods\/!mod-director-launchwrapper-1\.9\.1\.jar\)/);
        assert.match(text, /"Installed mod file \/opt\/rotn\/server\/mods\/esmtweaks-1\.12\.2-0\.4\.5\.jar"/);
    });
});
