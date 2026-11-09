// isolate-tmp.mjs: a test file's temp dirs go away however it ends (lead, 2026-11-09: /tmp is RAM-backed on the CX33).
import './isolate-tmp.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const helper = pathToFileURL(path.join(here, 'isolate-tmp.mjs')).href;

/** Runs a fixture importing the helper with its own parent temp dir; returns the result and what it left there. */
function runFixture(body, args = []) {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-'));
    const file = path.join(parent, 'fixture.test.mjs');
    fs.writeFileSync(file, `import ${JSON.stringify(helper)};\nimport fs from 'node:fs';\nimport os from 'node:os';\nimport path from 'node:path';\nimport { execFileSync } from 'node:child_process';\nconst d = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\nfs.writeFileSync(path.join(d, 'big.txt'), 'x');\nconst sh = execFileSync('sh', ['-c', 'mktemp -d'], { encoding: 'utf8' }).trim();\nconsole.log('DIR=' + d + ' SH=' + sh);\n${body}\n`);
    const r = spawnSync(process.execPath, [...args, file], { encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: parent, TEMP: parent, TMP: parent } });
    const m = /DIR=(\S+) SH=(\S+)/.exec(r.stdout);
    const left = fs.readdirSync(parent).filter((n) => n !== 'fixture.test.mjs');
    return { r, m, parent, left };
}

describe('isolate-tmp: nothing is left, however the test file ends', () => {
    for (const [name, body, args, status] of [
        ['a normal end', '', [], 0],
        ['a failed test (node --test)', `import('node:test').then(({ test }) => test('x', () => { throw new Error('boom'); }));`, ['--test'], 1],
        ['an uncaught exception', `throw new Error('boom');`, [], 1],
        ['process.exit(3)', `process.exit(3);`, [], 3],
    ]) {
        test(name, () => {
            const { r, m, parent, left } = runFixture(body, args);
            assert.equal(r.status, status, r.stderr);
            assert.ok(m, r.stdout);
            assert.ok(m[1].startsWith(parent) && m[1] !== parent, 'the test\'s own temp dir is under the private dir');
            assert.equal(path.dirname(m[2]), path.dirname(m[1]), 'a spawned shell\'s mktemp is in the private dir too');
            assert.deepEqual(left, [], 'the private dir is gone');
        });
    }
});

describe('every test/unit file that makes temp dirs imports it first', () => {
    test('mkdtemp or mktemp in a test file: its first import is ./isolate-tmp.mjs', () => {
        const bad = [];
        for (const f of fs.readdirSync(here).filter((n) => n.endsWith('.test.js'))) {
            const src = fs.readFileSync(path.join(here, f), 'utf8');
            if (!/mkdtemp|mktemp/.test(src)) continue;
            const first = src.split('\n').find((l) => l.startsWith('import '));
            if (first !== 'import \'./isolate-tmp.mjs\';') bad.push(f);
        }
        assert.deepEqual(bad, []);
    });
});
