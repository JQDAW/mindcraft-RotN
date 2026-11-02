#!/usr/bin/env node
// The G3 gate evidence cross-check (#122 review nit 1): every G3 result.json must be vouched for by the
// batch summary batch.mjs wrote (batch.json), because the ROTN_G3_BATCH marker alone can be forged.
//
//   node test/tools/g3-batch-check.mjs <batch.json> <result.json>...
//
// Prints one line per problem; exit 0 = consistent, 1 = not, 2 = usage. See crossCheckBatch in
// test/runner/lib/g3.mjs. CI runs the same check over every committed test/evidence/g3/<batch>/.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { crossCheckBatch } from '../runner/lib/g3.mjs';

/** Reads the files and runs the check: the problems. */
export function checkFiles(summaryFile, resultFiles) {
    const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
    let summary;
    try {
        summary = read(summaryFile);
    } catch (e) {
        return [`${summaryFile}: cannot be read as JSON (${e.code ?? 'parse error'})`];
    }
    const results = [];
    const problems = [];
    for (const f of resultFiles) {
        try {
            results.push({ file: f, result: read(f) });
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [summaryFile, ...resultFiles] = process.argv.slice(2);
    if (!summaryFile || !resultFiles.length) {
        console.error('usage: g3-batch-check.mjs <batch.json> <result.json>...');
        process.exitCode = 2;
    } else {
        const p = checkFiles(summaryFile, resultFiles);
        for (const m of p) console.error(m);
        if (!p.length) console.log(`consistent: ${resultFiles.length} result(s) vouched for by ${summaryFile}`);
        process.exitCode = p.length ? 1 : 0;
    }
}
