#!/usr/bin/env node
// The G3 gate evidence cross-check (#122 review nit 1, #129 review): every G3 result.json must be vouched
// for by the batch summary batch.mjs wrote (batch.json), because the ROTN_G3_BATCH marker alone can be forged.
//
//   node test/tools/g3-batch-check.mjs <batch.json> <result.json>...   one batch and its results
//   node test/tools/g3-batch-check.mjs --tree <dir>                     every G3 result under <dir>
//
// --tree is compulsory for evidence: every G3 result.json under <dir> (gate G3 or a g3- scenario) must have
// a batch.json in its own folder or a parent folder (up to <dir>), and that nearest batch.json must vouch for
// it; an unreadable result.json is a problem too, since it could hide a G3 result. CI runs it over
// test/evidence/ (test/unit/g3-spend.test.js).
//
// Prints one line per problem; exit 0 = consistent, 1 = not, 2 = usage. See crossCheckBatch in
// test/runner/lib/g3.mjs.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { crossCheckBatch, isG3Result } from '../runner/lib/g3.mjs';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** Reads the files and runs the check: the problems. */
export function checkFiles(summaryFile, resultFiles) {
    let summary;
    try {
        summary = readJson(summaryFile);
    } catch (e) {
        return [`${summaryFile}: cannot be read as JSON (${e.code ?? 'parse error'})`];
    }
    const results = [];
    const problems = [];
    for (const f of resultFiles) {
        try {
            results.push({ file: f, result: readJson(f) });
        } catch (e) {
            problems.push(`${f}: cannot be read as JSON (${e.code ?? 'parse error'})`);
        }
    }
    return [...problems, ...crossCheckBatch(summary, results)];
}

/** Every result.json under dir (recursive). */
export function resultFilesUnder(dir) {
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile() && d.name === 'result.json')
        .map((d) => path.join(d.parentPath ?? d.path, d.name));
}

/** The nearest batch.json in the file's folder or a parent folder, stopping at root; null if none. */
function nearestBatch(file, root) {
    const top = path.resolve(root);
    for (let d = path.dirname(path.resolve(file)); ; d = path.dirname(d)) {
        const b = path.join(d, 'batch.json');
        if (fs.existsSync(b)) return b;
        if (d === top || path.dirname(d) === d || !d.startsWith(top)) return null;
    }
}

/**
 * Every G3 result under root must be covered by its nearest batch.json, and each such batch.json must
 * vouch for all the G3 results it covers. Returns the problems (empty = consistent, or no G3 results).
 */
export function checkEvidenceTree(root) {
    if (!fs.existsSync(root)) return [];
    const problems = [];
    const byBatch = new Map();
    for (const f of resultFilesUnder(root)) {
        let result;
        try {
            result = readJson(f);
        } catch (e) {
            problems.push(`${f}: cannot be read as JSON (${e.code ?? 'parse error'}), so it may hide a G3 result`);
            continue;
        }
        if (!isG3Result(result)) continue;
        const b = nearestBatch(f, root);
        if (!b) {
            problems.push(`${f}: a G3 result that no batch.json covers (none in its folder or a parent folder): not gate evidence`);
            continue;
        }
        byBatch.set(b, [...(byBatch.get(b) ?? []), f]);
    }
    for (const [b, files] of byBatch) problems.push(...checkFiles(b, files));
    return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    let p;
    let what;
    if (args[0] === '--tree' && args.length === 2) {
        p = checkEvidenceTree(args[1]);
        what = `every G3 result under ${args[1]} is vouched for by its batch.json`;
    } else if (args.length >= 2 && !args[0].startsWith('--')) {
        const [summaryFile, ...resultFiles] = args;
        p = checkFiles(summaryFile, resultFiles);
        what = `${resultFiles.length} result(s) vouched for by ${summaryFile}`;
    } else {
        console.error('usage: g3-batch-check.mjs <batch.json> <result.json>... | --tree <dir>');
        process.exitCode = 2;
    }
    if (p) {
        for (const m of p) console.error(m);
        if (!p.length) console.log(`consistent: ${what}`);
        process.exitCode = p.length ? 1 : 0;
    }
}
