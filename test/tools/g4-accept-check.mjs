#!/usr/bin/env node
// The G4 step-7 evidence check (lib/g4-accept.mjs, checkAcceptanceResults): every result under <dir> that carries a
// g4Acceptance record is checked for consistency, every G4 gate pass must be a valid acceptance run, and per GO the
// runs share one tag and one commit and no test server serves two step-7 runs. g3-batch-check.mjs --tree runs the same
// check in CI.
//
//   node test/tools/g4-accept-check.mjs --tree <dir>                     consistency, and what each GO has so far
//   node test/tools/g4-accept-check.mjs --tree <dir> --complete <GO id>  the G4 claim: every step-7 scenario has a
//                                                                        valid acceptance result in that GO that passed
//
// Prints one line per problem; exit 0 = consistent (and complete, with --complete), 1 = not, 2 = usage.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { G3_ON_SERVICE_NOT_GATE } from '../runner/lib/g3.mjs';
import { checkAcceptanceResults } from '../runner/lib/g4-accept.mjs';
import { jsonFilesUnder } from './g3-batch-check.mjs';

/** Reads every *.json under dir (batch.json aside) and runs the step-7 check. -> {problems, summary} */
export function checkAcceptanceTree(dir, { complete = null } = {}) {
    if (!fs.existsSync(dir)) return { problems: [`${dir}: no such directory`], summary: [] };
    const results = [];
    const problems = [];
    for (const f of jsonFilesUnder(dir).filter((x) => path.basename(x) !== 'batch.json')) {
        try {
            results.push({ file: f, result: JSON.parse(fs.readFileSync(f, 'utf8')) });
        } catch (e) {
            problems.push(`${f}: cannot be read as JSON (${e.code ?? 'parse error'}), so it may hide a G4 result`);
        }
    }
    const r = checkAcceptanceResults(results, { complete, g3OnServiceReason: G3_ON_SERVICE_NOT_GATE });
    return { problems: [...problems, ...r.problems], summary: r.summary };
}

export function parseCli(args) {
    const o = { tree: null, complete: null };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--tree' && args[i + 1]) o.tree = args[++i];
        else if (args[i] === '--complete' && args[i + 1]) o.complete = args[++i];
        else return null;
    }
    return o.tree ? o : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const o = parseCli(process.argv.slice(2));
    if (!o) {
        console.error('usage: g4-accept-check.mjs --tree <dir> [--complete <GO id>]');
        process.exitCode = 2;
    } else {
        const { problems, summary } = checkAcceptanceTree(o.tree, { complete: o.complete });
        for (const p of problems) console.error(p);
        for (const s of summary) console.log(s);
        if (!problems.length) console.log(`consistent: the G4 step-7 records under ${o.tree}${o.complete ? `; GO ${o.complete} is complete: every step-7 scenario passed` : ` (${summary.length} acceptance GO(s))`}`);
        process.exitCode = problems.length ? 1 : 0;
    }
}
