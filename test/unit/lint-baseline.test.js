// Offline unit tests for test/tools/lint-baseline.mjs (the CI lint gate). No ESLint run here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, compareBaselines, countsFromResults, readBaselineAt, trackedJsFiles, parseArgs, SetupError, MAX_TOTAL } from '../tools/lint-baseline.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = { total: 5, files: { 'src/a.js': 3, 'src/b.js': 2 } };

describe('lint ratchet on the total', () => {
    test('same counts pass', () => {
        assert.deepEqual(compare(base, { 'src/a.js': 3, 'src/b.js': 2 }), { ok: true, total: 5, problems: [], moved: [] });
    });

    test('per-file counts may move (rename, upstream merge) while the total stays put', () => {
        const r = compare(base, { 'src/a2.js': 3, 'src/b.js': 2 });
        assert.equal(r.ok, true);
        assert.deepEqual(r.moved, ['src/a.js: 3 -> 0', 'src/a2.js: 0 -> 3']);
    });

    test('a higher total fails as new lint errors', () => {
        const r = compare(base, { 'src/a.js': 3, 'src/b.js': 2, 'test/new.js': 1 });
        assert.equal(r.ok, false);
        assert.match(r.problems[0], /total 6 errors, baseline 5 \(\+1\): new lint errors/);
    });

    test('a lower total fails until the baseline is lowered (the fix is locked in)', () => {
        const r = compare(base, { 'src/a.js': 3 });
        assert.equal(r.ok, false);
        assert.match(r.problems[0], /below the baseline 5: lock the fix in with `node test\/tools\/lint-baseline.mjs --update`/);
    });

    test('the ceiling holds even if the baseline was edited upwards', () => {
        const r = compare({ total: 10, files: { 'x.js': 10 } }, { 'x.js': 10 }, { maxTotal: 9 });
        assert.equal(r.ok, false);
        assert.match(r.problems[0], /above the ceiling 9/);
    });

    test('--allow-raise lets the total rise past the baseline and the ceiling, but not fall', () => {
        assert.equal(compare(base, { 'src/a.js': 9 }, { maxTotal: 5, allowRaise: true }).ok, true);
        assert.equal(compare(base, { 'src/a.js': 1 }, { allowRaise: true }).ok, false);
    });
});

describe('baseline file against the base branch', () => {
    test('a PR baseline may move per-file counts and lower the total, never raise it', () => {
        assert.equal(compareBaselines(base, { total: 5, files: { 'src/a.js': 1, 'src/c.js': 4 } }).ok, true);
        assert.equal(compareBaselines(base, { total: 4, files: { 'src/a.js': 4 } }).ok, true);
        const r = compareBaselines(base, { total: 6, files: { 'src/a.js': 6 } });
        assert.deepEqual(r.problems, ['baseline raises the total from 5 to 6']);
        assert.equal(compareBaselines(base, { total: 6, files: { 'src/a.js': 6 } }, { allowRaise: true }).ok, true);
        assert.match(compareBaselines(base, { total: 9, files: { 'src/a.js': 3 } }).problems.join(), /not the sum/);
    });

    test('first introduction (no base baseline) is still held to the ceiling', () => {
        assert.equal(compareBaselines(null, { total: 2, files: { 'a.js': 2 } }, { maxTotal: 2 }).ok, true);
        assert.equal(compareBaselines(null, { total: 3, files: { 'a.js': 3 } }, { maxTotal: 2 }).ok, false);
    });

    test('readBaselineAt fails closed (PR #8 review finding 1)', () => {
        const fake = (fail) => (args) => {
            const verb = args[0];
            if (fail[verb]) throw Object.assign(new Error(`${verb} failed`), { stderr: `fatal: ${verb}` });
            return verb === 'show' ? (fail.badJson ? '{nope' : JSON.stringify(base)) : '';
        };
        assert.deepEqual(readBaselineAt('origin/develop', { run: fake({}) }), base);
        assert.equal(readBaselineAt('origin/develop', { run: fake({ 'cat-file': true }) }), null, 'file missing in the ref: no base baseline');
        assert.throws(() => readBaselineAt('origin/gone', { run: fake({ 'rev-parse': true }) }), SetupError, 'unknown ref');
        assert.equal(readBaselineAt('origin/gone', { run: fake({ 'rev-parse': true }), allowMissingBase: true }), null);
        assert.throws(() => readBaselineAt('origin/develop', { run: fake({ show: true }) }), /git show origin\/develop:test\/lint-baseline.json failed/);
        assert.throws(() => readBaselineAt('origin/develop', { run: fake({ badJson: true }) }), /not valid JSON/);
    });
});

describe('inputs', () => {
    test('only tracked .js/.mjs/.cjs files are linted', () => {
        let seen;
        const files = trackedJsFiles((args) => { seen = args; return 'a.js\0b/c.mjs\0'; });
        assert.deepEqual(files, ['a.js', 'b/c.mjs']);
        assert.deepEqual(seen, ['ls-files', '-z', '--', '*.js', '*.mjs', '*.cjs']);
    });

    test('parseArgs', () => {
        assert.deepEqual(parseArgs(['--base-ref', 'origin/develop', '--allow-missing-base']),
            { update: false, baseRef: 'origin/develop', allowMissingBase: true, allowRaise: false });
        assert.throws(() => parseArgs(['--base-ref']), SetupError);
        assert.throws(() => parseArgs(['--base-ref', '--update']), SetupError);
        assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
    });

    test('countsFromResults keeps files with errors, as repo-relative POSIX paths', () => {
        const root = path.resolve('/r');
        const res = [
            { filePath: path.join(root, 'src', 'a.js'), errorCount: 2 },
            { filePath: path.join(root, 'src', 'ok.js'), errorCount: 0 },
        ];
        assert.deepEqual(countsFromResults(res, root), { 'src/a.js': 2 });
    });

    test('the committed baseline is consistent and within the ceiling', () => {
        const b = JSON.parse(fs.readFileSync(path.join(repo, 'test', 'lint-baseline.json'), 'utf8'));
        assert.equal(compareBaselines(null, b).ok, true);
        assert.ok(b.total <= MAX_TOTAL);
    });
});
