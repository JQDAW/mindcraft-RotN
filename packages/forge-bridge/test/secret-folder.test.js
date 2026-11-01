// The token-cache folder checks used by tools/msa-login.mjs (PR #10 review
// items 3 and 4). Offline: temp folders only; the login tool is run only on a
// path it must refuse, so it exits before any network call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findGitWorkTree, prepareSecretFolder, realLocation } from '../src/secret-folder.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, '..', 'tools', 'msa-login.mjs');

function sandbox() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-bridge-secret-'));
    assert.equal(findGitWorkTree(root), null, 'the OS temp folder must not be inside a git work tree for this test');
    return root;
}

test('any folder inside a git work tree is refused, including worktrees (.git file) and folders not yet created', () => {
    const root = sandbox();
    const checkout = path.join(root, 'checkout');
    fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });
    const worktree = path.join(root, 'wt');
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: ../checkout/.git/worktrees/wt\n');
    for (const dir of [checkout, path.join(checkout, 'a', 'b'), path.join(worktree, 'deep', 'msa')]) {
        assert.throws(() => prepareSecretFolder(dir), /inside the git work tree/);
        if (dir !== checkout) assert.equal(fs.existsSync(dir), false, 'nothing is created on refusal');
    }
    assert.equal(findGitWorkTree(path.join(worktree, 'x')), worktree);
});

test('a folder outside every work tree is created with mode 0700', () => {
    const root = sandbox();
    const dir = path.join(root, 'FRCFLD', 'msa');
    assert.equal(prepareSecretFolder(dir), path.resolve(dir));
    assert.ok(fs.statSync(dir).isDirectory());
    if (process.platform !== 'win32') {
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
        fs.chmodSync(dir, 0o755);
        prepareSecretFolder(dir);
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700, 'an existing folder is tightened');
    }
});

test('msa-login.mjs refuses a folder inside this repo before contacting anyone', () => {
    const inside = path.join(HERE, 'fixtures', 'must-not-exist-msa');
    const r = spawnSync(process.execPath, [TOOL, 'FRCFLD'], {
        env: { ...process.env, MINDCRAFT_PROFILES_FOLDER: inside, DEBUG: '*' },
        encoding: 'utf8',
        timeout: 20_000,
    });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /inside the git work tree/);
    assert.equal(fs.existsSync(inside), false);
});

test('msa-login.mjs clears DEBUG before prismarine-auth loads', () => {
    const src = fs.readFileSync(TOOL, 'utf8');
    const del = src.indexOf('delete process.env.DEBUG');
    const req = src.indexOf("require('prismarine-auth')");
    assert.ok(del > 0 && req > del, 'delete process.env.DEBUG must come before the prismarine-auth require');
    assert.ok(!/^import .*prismarine-auth/m.test(src), 'a static import would load before the delete runs');
});

test('a junction or symlink outside a repo that points into one is refused (realpath)', () => {
    const root = sandbox();
    const checkout = path.join(root, 'repo');
    fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });
    fs.mkdirSync(path.join(checkout, 'inner'));
    const link = path.join(root, 'outside-link');
    fs.symlinkSync(path.join(checkout, 'inner'), link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(findGitWorkTree(link), null, 'the link path itself is outside the repo');
    assert.equal(realLocation(path.join(link, 'not', 'yet')), path.join(fs.realpathSync.native(path.join(checkout, 'inner')), 'not', 'yet'));
    assert.throws(() => prepareSecretFolder(path.join(link, 'msa')), /inside the git work tree/);
    assert.equal(fs.existsSync(path.join(checkout, 'inner', 'msa')), false);
});
