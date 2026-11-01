#!/usr/bin/env node
// Lint gate for CI (harness-ops, brief deliverable 3; tightened after the PR #8 review).
//
// The upstream Mindcraft code has 259 ESLint errors on develop (CLAUDE.md). The rule is a ratchet on
// the TOTAL number of errors in the tracked *.js, *.mjs and *.cjs files (`git ls-files`):
//   - more errors than test/lint-baseline.json's total fails ("new lint errors");
//   - FEWER errors also fails until the baseline is lowered with --update, so a fix is locked in;
//   - per-file counts may move (renames, upstream merges), as long as the total does not rise;
//   - the total can never pass MAX_TOTAL.
// A PR may raise the total only with --allow-raise, which CI passes only for a PR labelled
// `lint-raise-approved`, and only with a lead approval cited in the PR body. Even then the raise must
// be recorded: the current total must equal the PR's own baseline total (run --update and commit it),
// so it shows in the diff and develop's next run passes. --allow-raise only lets that baseline sit
// above the base branch's; it never lifts MAX_TOTAL, which only an edit to the constant can raise
// (PR #11 review finding 1).
//
//   node test/tools/lint-baseline.mjs                     check the working tree against the baseline
//   node test/tools/lint-baseline.mjs --base-ref REF      also refuse a baseline whose total is above REF's
//                                                         (CI: the PR's base branch)
//       [--allow-missing-base]                            treat an unknown REF as "no base baseline"
//   node test/tools/lint-baseline.mjs --update            rewrite the baseline from the working tree
//   node test/tools/lint-baseline.mjs --allow-raise ...   see above
//
// Exit codes: 0 pass, 1 the ratchet failed, 2 usage or setup error (a git or ESLint failure is never a pass).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MAX_TOTAL = 259; // develop on 2026-11-01; a hard ceiling: only an ADR and an edit here may raise it
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = 'test/lint-baseline.json';

export class SetupError extends Error {}

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
 * Returns {ok, total, problems: [string], moved: [string]}. moved is information only.
 */
export function compare(baseline, current, { maxTotal = MAX_TOTAL, allowRaise = false } = {}) {
    const problems = [];
    const moved = [];
    const total = sum(current);
    for (const file of [...new Set([...Object.keys(baseline.files), ...Object.keys(current)])].sort()) {
        const was = baseline.files[file] ?? 0;
        const now = current[file] ?? 0;
        if (now !== was) moved.push(`${file}: ${was} -> ${now}`);
    }
    if (total > baseline.total) {
        problems.push(allowRaise
            ? `total ${total} errors, baseline ${baseline.total}: --allow-raise needs the raise recorded; run \`node test/tools/lint-baseline.mjs --update\` and commit ${BASELINE}`
            : `total ${total} errors, baseline ${baseline.total} (+${total - baseline.total}): new lint errors`);
    }
    if (total < baseline.total) problems.push(`total ${total} errors is below the baseline ${baseline.total}: lock the fix in with \`node test/tools/lint-baseline.mjs --update\` and commit ${BASELINE}`);
    if (total > maxTotal) problems.push(`total ${total} errors is above the ceiling ${maxTotal}`);
    return { ok: problems.length === 0, total, problems, moved };
}

/**
 * A PR's baseline must be self-consistent, within MAX_TOTAL, and must not raise the base branch's
 * total unless allowRaise (a lead-approved raise, which compare() then holds to this baseline).
 */
export function compareBaselines(base, head, { maxTotal = MAX_TOTAL, allowRaise = false } = {}) {
    const problems = [];
    if (sum(head.files) !== head.total) problems.push(`baseline total ${head.total} is not the sum of its files (${sum(head.files)})`);
    if (base && head.total > base.total && !allowRaise) problems.push(`baseline raises the total from ${base.total} to ${head.total}`);
    if (head.total > maxTotal) problems.push(`baseline total ${head.total} is above the ceiling ${maxTotal}`);
    return { ok: problems.length === 0, problems };
}

const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

/**
 * The baseline as committed at REF. null only when REF has no such file (the base predates the gate)
 * or, with allowMissingBase, when REF itself is unknown. Any other failure is a SetupError: the gate
 * must never pass because git could not answer.
 */
export function readBaselineAt(ref, { allowMissingBase = false, run = git } = {}) {
    try {
        run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    } catch {
        if (allowMissingBase) return null;
        throw new SetupError(`base ref '${ref}' is not available (fetch it, or pass --allow-missing-base)`);
    }
    // Only an empty ls-tree answer means "no such file in REF"; a failing git (e.g. a broken object
    // store) is a setup error, never "no baseline" (PR #11 review finding 3).
    let listed;
    try {
        listed = run(['ls-tree', '--name-only', ref, '--', BASELINE]);
    } catch (e) {
        throw new SetupError(`git ls-tree ${ref} -- ${BASELINE} failed: ${String(e.stderr ?? e.message).trim()}`);
    }
    if (!listed.trim()) return null; // the base predates the gate
    let text;
    try {
        text = run(['show', `${ref}:${BASELINE}`]);
    } catch (e) {
        throw new SetupError(`git show ${ref}:${BASELINE} failed: ${String(e.stderr ?? e.message).trim()}`);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new SetupError(`${ref}:${BASELINE} is not valid JSON: ${e.message}`);
    }
}

/** Tracked JavaScript files only, so untracked local files never count. */
export function trackedJsFiles(run = git) {
    return run(['ls-files', '-z', '--', '*.js', '*.mjs', '*.cjs']).split('\0').filter(Boolean);
}

async function lint() {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: repo, warnIgnored: false });
    const files = trackedJsFiles();
    if (!files.length) throw new SetupError('git ls-files found no JavaScript files');
    return countsFromResults(await eslint.lintFiles(files));
}

export function parseArgs(argv) {
    const o = { update: false, baseRef: null, allowMissingBase: false, allowRaise: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--update') o.update = true;
        else if (a === '--allow-missing-base') o.allowMissingBase = true;
        else if (a === '--allow-raise') o.allowRaise = true;
        else if (a === '--base-ref') {
            o.baseRef = argv[++i];
            if (!o.baseRef || o.baseRef.startsWith('-')) throw new SetupError('--base-ref needs a git ref');
        } else throw new SetupError(`unknown argument '${a}'`);
    }
    return o;
}

async function main(argv) {
    const o = parseArgs(argv);
    const current = await lint();
    const file = path.join(repo, BASELINE);
    if (o.update) {
        const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
        fs.writeFileSync(file, JSON.stringify({ total: sum(sorted), files: sorted }, null, 2) + '\n');
        console.log(`wrote ${BASELINE}: ${sum(sorted)} errors in ${Object.keys(sorted).length} files`);
        return 0;
    }
    if (o.allowRaise) console.warn('WARNING: --allow-raise: the error total may rise. A PR needs a lead approval cited in its body for this.');
    const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
    let ok = true;
    if (o.baseRef) {
        const base = readBaselineAt(o.baseRef, o);
        if (!base) console.log(`no ${BASELINE} at ${o.baseRef}: checking this branch's baseline on its own`);
        const b = compareBaselines(base, baseline, o);
        for (const p of b.problems) console.error(`BASELINE RAISED: ${p}`);
        ok &&= b.ok;
    }
    const c = compare(baseline, current, o);
    const movedNote = o.allowRaise ? 'per-file count moved' : 'per-file count moved (allowed while the total does not rise)';
    for (const m of c.moved) console.log(`${movedNote}: ${m}`);
    for (const p of c.problems) console.error(`LINT RATCHET: ${p}`);
    ok &&= c.ok;
    console.log(`lint: ${c.total} errors (baseline ${baseline.total}, ceiling ${MAX_TOTAL}): ${ok ? 'OK' : 'FAIL'}`);
    if (!ok && c.total > baseline.total && !o.allowRaise) console.error('Run `npx eslint <file>` on the files you changed and fix the new errors; do not raise the baseline.');
    return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
        console.error(e instanceof SetupError ? `lint gate setup error: ${e.message}` : e);
        process.exitCode = 2;
    });
}
