// Offline unit tests for test/tools/lint-baseline.mjs (the CI lint gate). No ESLint run here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, compareBaselines, countsFromResults, MAX_TOTAL } from '../tools/lint-baseline.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = { total: 5, files: { 'src/a.js': 3, 'src/b.js': 2 } };

describe('lint baseline gate', () => {
    test('same counts pass', () => {
        assert.deepEqual(compare(base, { 'src/a.js': 3, 'src/b.js': 2 }), { ok: true, total: 5, problems: [], improved: [] });
    });

    test('a new error in a listed file fails even if another file got better', () => {
        const r = compare(base, { 'src/a.js': 4, 'src/b.js': 1 });
        assert.equal(r.ok, false);
        assert.deepEqual(r.problems, ['src/a.js: 4 errors, baseline 3 (+1)']);
        assert.deepEqual(r.improved, ['src/b.js: 1 errors, baseline 2']);
    });

    test('an error in a new file fails', () => {
        const r = compare(base, { 'src/a.js': 3, 'src/b.js': 2, 'test/new.js': 1 });
        assert.equal(r.ok, false);
        assert.match(r.problems.join('\n'), /test\/new\.js: 1 errors, baseline 0/);
        assert.match(r.problems.join('\n'), /total 6 errors, baseline 5/);
    });

    test('fixed files are reported as improvements', () => {
        const r = compare(base, { 'src/a.js': 3 });
        assert.equal(r.ok, true);
        assert.deepEqual(r.improved, ['src/b.js: 0 errors, baseline 2']);
    });

    test('the total can never pass the ceiling', () => {
        const r = compare({ total: 10, files: { 'x.js': 10 } }, { 'x.js': 10 }, 9);
        assert.equal(r.ok, false);
        assert.match(r.problems[0], /ceiling 9/);
    });

    test('a PR baseline may lower counts but never raise them', () => {
        assert.equal(compareBaselines(base, { total: 4, files: { 'src/a.js': 2, 'src/b.js': 2 } }).ok, true);
        const r = compareBaselines(base, { total: 6, files: { 'src/a.js': 3, 'src/b.js': 2, 'src/c.js': 1 } });
        assert.equal(r.ok, false);
        assert.deepEqual(r.problems, ['baseline raises src/c.js from 0 to 1', 'baseline raises the total from 5 to 6']);
        assert.match(compareBaselines(base, { total: 9, files: { 'src/a.js': 3 } }).problems.join(), /not the sum/);
    });

    test('first introduction (no base baseline) is still held to the ceiling', () => {
        assert.equal(compareBaselines(null, { total: 2, files: { 'a.js': 2 } }, 2).ok, true);
        assert.equal(compareBaselines(null, { total: 3, files: { 'a.js': 3 } }, 2).ok, false);
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
