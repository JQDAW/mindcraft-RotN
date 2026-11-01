#!/usr/bin/env node
// Lint gate for CI (harness-ops, brief deliverable 3).
//
// The upstream Mindcraft code has 259 ESLint errors on develop (CLAUDE.md). A PR may not add any:
// for every file, its error count must not exceed the count in test/lint-baseline.json (a file
// that is not listed counts as 0), and the total must not exceed the baseline total or MAX_TOTAL.
// Fixing errors is welcome; the run then tells you to lower the baseline with --update.
//
//   node test/tools/lint-baseline.mjs                    check the working tree against the baseline
//   node test/tools/lint-baseline.mjs --base-ref REF     also refuse a baseline that raises any count
//                                                        compared with REF's baseline (CI: the PR base)
//   node test/tools/lint-baseline.mjs --update           rewrite the baseline from the working tree
//
// Exit codes: 0 pass, 1 new lint errors or a raised baseline, 2 usage or setup error.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MAX_TOTAL = 259; // develop on 2026-11-01; only an ADR may raise it
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = 'test/lint-baseline.json';

/** Per-file error counts from ESLint results, keyed by repo-relative POSIX path. */
export function countsFromResults(results, root = repo) {
    const files = {};
    for (const r of results) {
        if (r.errorCount > 0) files[path.relative(root, r.filePath).split(path.sep).join('/')] = r.errorCount;
    }
    return files;
}

const sum = (files) => Object.values(files).reduce((a, b) => a + b, 0);

/**
 * Compare current per-file counts with a baseline ({total, files}).
 * Returns {ok, total, problems: [string], improved: [string]}.
 */
export function compare(baseline, current, maxTotal = MAX_TOTAL) {
    const problems = [];
    const improved = [];
    const total = sum(current);
    for (const [file, n] of Object.entries(current)) {
        const was = baseline.files[file] ?? 0;
        if (n > was) problems.push(`${file}: ${n} errors, baseline ${was} (+${n - was})`);
        else if (n < was) improved.push(`${file}: ${n} errors, baseline ${was}`);
    }
    for (const [file, was] of Object.entries(baseline.files)) {
        if (!(file in current)) improved.push(`${file}: 0 errors, baseline ${was}`);
    }
    if (total > baseline.total) problems.push(`total ${total} errors, baseline ${baseline.total}`);
    if (total > maxTotal) problems.push(`total ${total} errors, ceiling ${maxTotal}`);
    return { ok: problems.length === 0, total, problems, improved };
}

/** A PR's baseline may only lower counts compared with the base branch's baseline. */
export function compareBaselines(base, head, maxTotal = MAX_TOTAL) {
    const problems = [];
    for (const [file, n] of Object.entries(head.files)) {
        const was = base ? (base.files[file] ?? 0) : n;
        if (n > was) problems.push(`baseline raises ${file} from ${was} to ${n}`);
    }
    if (sum(head.files) !== head.total) problems.push(`baseline total ${head.total} is not the sum of its files (${sum(head.files)})`);
    if (base && head.total > base.total) problems.push(`baseline raises the total from ${base.total} to ${head.total}`);
    if (head.total > maxTotal) problems.push(`baseline total ${head.total} is above the ceiling ${maxTotal}`);
    return { ok: problems.length === 0, problems };
}

async function lint() {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: repo });
    return countsFromResults(await eslint.lintFiles(['.']));
}

function readBaselineAt(ref) {
    try {
        return JSON.parse(execFileSync('git', ['show', `${ref}:${BASELINE}`], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch {
        return null; // the base branch predates the baseline file
    }
}

async function main(argv) {
    const update = argv.includes('--update');
    const i = argv.indexOf('--base-ref');
    const baseRef = i >= 0 ? argv[i + 1] : null;
    if (i >= 0 && !baseRef) {
        console.error('--base-ref needs a git ref');
        return 2;
    }
    const current = await lint();
    const file = path.join(repo, BASELINE);
    if (update) {
        const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
        fs.writeFileSync(file, JSON.stringify({ total: sum(sorted), files: sorted }, null, 2) + '\n');
        console.log(`wrote ${BASELINE}: ${sum(sorted)} errors in ${Object.keys(sorted).length} files`);
        return 0;
    }
    const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
    let ok = true;
    if (baseRef) {
        const b = compareBaselines(readBaselineAt(baseRef), baseline);
        for (const p of b.problems) console.error(`BASELINE RAISED: ${p}`);
        ok &&= b.ok;
    }
    const c = compare(baseline, current);
    for (const p of c.problems) console.error(`NEW LINT ERRORS: ${p}`);
    for (const p of c.improved) console.log(`fewer errors (lower the baseline with --update): ${p}`);
    ok &&= c.ok;
    console.log(`lint: ${c.total} errors (baseline ${baseline.total}, ceiling ${MAX_TOTAL}): ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) console.error('Run `npx eslint <file>` on the files above. Fix the new errors; do not raise the baseline.');
    return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
        console.error(e);
        process.exitCode = 2;
    });
}
