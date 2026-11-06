#!/usr/bin/env node
// The G3 gate evidence cross-check (#122 review nit 1, #129 review and re-review): every G3 result must be
// vouched for by the batch summary batch.mjs wrote (batch.json), because the ROTN_G3_BATCH marker alone
// can be forged.
//
//   node test/tools/g3-batch-check.mjs <batch.json> <result.json>...   a GATE claim: one batch and its results
//   node test/tools/g3-batch-check.mjs --tree <dir>                     every G3 result under <dir> (consistency)
//
// Smoke is the default (lead, #218 review and #220 decision): only `batch.mjs --gate` writes `gate: true`.
// - The single-batch form is the gate claim check: it needs `gate: true` (and not `smoke: true`).
// - --tree, the evidence check, rejects every G3 result whose batch.json does not say `gate: true`, unless
//   that batch.json is explicitly a smoke record (`smoke: true`, never gate evidence): those are kept as
//   records, checked for consistency and named in the output ("N smoke batch(es), never gate evidence").
//
// --tree is compulsory for evidence. It reads EVERY *.json under <dir>, whatever its name (a result
// committed as g3-result.json or Result.json counts too; #129 re-review nit 1). Each one that is a G3
// result (isG3Result: gate G3 in any case, a g3- scenario, or a scenario loadScenarios marks G3) must
// have a batch.json in its own folder or a parent folder (up to <dir>), and that nearest batch.json must
// vouch for it. A *.json that cannot be read, or a batch.json that is itself a G3 result, is a problem
// too, since either could hide a G3 result. CI runs it over test/evidence/ (test/unit/g3-spend.test.js).
// Gate reviews accept G3 evidence only from test/evidence/g3/<batch>/ (test/runner/DRIVER.md).
//
// Prints one line per problem; exit 0 = consistent, 1 = not, 2 = usage. See crossCheckBatch in
// test/runner/lib/g3.mjs.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { crossCheckBatch, isG3Result } from '../runner/lib/g3.mjs';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const isBatchFile = (f) => path.basename(f) === 'batch.json';

/** Reads the files and runs the check: the problems. */
export function checkFiles(summaryFile, resultFiles, { g3Scenarios = [], gate = false } = {}) {
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
    return [...problems, ...crossCheckBatch(summary, results, { g3Scenarios, gate })];
}

/** Every *.json under dir (recursive, any name and case), batch.json files included. */
export function jsonFilesUnder(dir) {
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile() && /\.json$/i.test(d.name))
        .map((d) => path.join(d.parentPath ?? d.path, d.name));
}

/** Every result file under dir: every *.json except the batch summaries (batch.json). */
export function resultFilesUnder(dir) {
    return jsonFilesUnder(dir).filter((f) => !isBatchFile(f));
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
export function checkEvidenceTree(root, { g3Scenarios = [] } = {}) {
    if (!fs.existsSync(root)) return [];
    const problems = [];
    const byBatch = new Map();
    for (const f of jsonFilesUnder(root)) {
        let result;
        try {
            result = readJson(f);
        } catch (e) {
            problems.push(`${f}: cannot be read as JSON (${e.code ?? 'parse error'}), so it may hide a G3 result`);
            continue;
        }
        if (!isG3Result(result, g3Scenarios)) continue;
        if (isBatchFile(f)) {
            problems.push(`${f}: a batch.json that is itself a G3 result: not a batch summary, and not gate evidence`);
            continue;
        }
        const b = nearestBatch(f, root);
        if (!b) {
            problems.push(`${f}: a G3 result that no batch.json covers (none in its folder or a parent folder): not gate evidence`);
            continue;
        }
        byBatch.set(b, [...(byBatch.get(b) ?? []), f]);
    }
    for (const [b, files] of byBatch) {
        problems.push(...checkFiles(b, files, { g3Scenarios }));
        let kind = null;
        try { kind = batchKind(readJson(b)); } catch { /* checkFiles reported it */ }
        if (kind === 'neither') problems.push(`${b}: says neither gate: true nor smoke: true, so its ${files.length} G3 result(s) are rejected (only batch.mjs --gate writes gate: true)`);
        if (kind === 'both') problems.push(`${b}: says both gate: true and smoke: true, so its ${files.length} G3 result(s) are rejected`);
    }
    return problems;
}

/** What a batch summary is: 'gate' (gate: true only), 'smoke' (smoke: true only), 'both' or 'neither'. */
export function batchKind(summary) {
    const g = summary?.gate === true;
    const s = summary?.smoke === true;
    return g && s ? 'both' : g ? 'gate' : s ? 'smoke' : 'neither';
}

/** The batch.json files under dir that say smoke: true (relative paths, sorted). */
export function smokeBatchesUnder(dir) {
    if (!fs.existsSync(dir)) return [];
    return jsonFilesUnder(dir).filter(isBatchFile).filter((f) => {
        try { return readJson(f).smoke === true; } catch { return false; }
    }).map((f) => path.relative(dir, f).split(path.sep).join('/')).sort();
}

/**
 * The results under dir marked as an infra fault (#248 review: the LLM-failure stop; result.infraFault and
 * the verdict "INFRA FAULT"), so the evidence check names them apart from check fails: "<relative path>
 * (<kind>)", sorted.
 */
export function infraFaultsUnder(dir) {
    if (!fs.existsSync(dir)) return [];
    return resultFilesUnder(dir).flatMap((f) => {
        let r;
        try { r = readJson(f); } catch { return []; }
        return r && typeof r === 'object' && r.infraFault ? [`${path.relative(dir, f).split(path.sep).join('/')} (${r.infraFault.kind ?? 'infra fault'})`] : [];
    }).sort();
}

/** The ids of the scenarios that loadScenarios marks gate G3. */
export async function g3ScenarioIds() {
    const { loadScenarios } = await import('../runner/run.mjs');
    return Object.values(await loadScenarios()).filter((s) => isG3Result({ gate: s.gate })).map((s) => s.id);
}

async function main(args) {
    if (args[0] === '--tree' && args.length === 2) {
        const smoke = smokeBatchesUnder(args[1]);
        const faults = infraFaultsUnder(args[1]);
        return [checkEvidenceTree(args[1], { g3Scenarios: await g3ScenarioIds() }),
            `every G3 result under ${args[1]} is vouched for by a gate: true or smoke: true batch.json; ${smoke.length} smoke batch(es), never gate evidence${smoke.length ? `: ${smoke.join(', ')}` : ''}`
            + `; ${faults.length} infra fault result(s), not check fails${faults.length ? `: ${faults.join(', ')}` : ''}`];
    }
    if (args.length >= 2 && !args[0].startsWith('--')) {
        const [summaryFile, ...resultFiles] = args;
        return [checkFiles(summaryFile, resultFiles, { g3Scenarios: await g3ScenarioIds(), gate: true }), `${resultFiles.length} result(s) vouched for by ${summaryFile}, a gate batch (gate: true)`];
    }
    return [null, null];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then(([p, what]) => {
        if (!p) {
            console.error('usage: g3-batch-check.mjs <batch.json> <result.json>... | --tree <dir>');
            process.exitCode = 2;
            return;
        }
        for (const m of p) console.error(m);
        if (!p.length) console.log(`consistent: ${what}`);
        process.exitCode = p.length ? 1 : 0;
    }, (e) => {
        console.error(`error: ${e?.message ?? e}`);
        process.exitCode = 2;
    });
}
