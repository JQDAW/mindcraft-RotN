// Imports a dump fetched from the test server (tools/dumper, format rotn-dump/1)
// into packages/rotn-data/<version>/ (ADR 0004).
//
// Checks, in order (any failure stops the import and writes nothing):
//   0. the dumper jar that ran is the expected one: manifest.dumperJar.sha256 must equal
//      --jar-sha256 (the hash recorded from the dumper-build artifact before the batch);
//   1. the DONE marker exists (the dumper writes it last) and the manifest is rotn-dump/1
//      with no errors and Forge 14.23.5.2860;
//   2. every block, item and entity name in the dump is in the server's RegistryData
//      capture (registry-names.json) and the other way round;
//   3. every early-game recipe in test/fixtures/scripts-<version>-early-recipes.json is
//      found in the dump (the CraftTweaker scripts cross-check).
// It then adds the pack pin (version, zip SHA-256) and the SHA-256 of every raw fetched file
// (manifest.import.rawSha256) to the manifest and writes each file as sorted JSON (.json, or
// .json.br when larger than 1 MiB).
//
// Usage: node packages/rotn-data/tools/import-dump.mjs <fetched rotn-dump dir> --jar-sha256 <hex>
//        [--version 3.3.4] [--allow-errors] [--dry-run]
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RotnData, DUMP_FORMAT, DUMP_FILES } from '../src/catalog.js';
import { recipeMatches } from '../src/crosscheck.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

export const PACK_PINS = {
    '3.3.4': { zipSha256: '90642fd5cd098e9140bc67d44d5e05ca492706b02aa202657b64013bee7f5205', forge: '14.23.5.2860' },
};
const BROTLI_ABOVE = 1 << 20; // 1 MiB (PR #47 review: was 4 MiB)

const SECTIONS = { blocks: 'blocks', items: 'items', entities: 'entities' };

function readDumpFile(dir, name) {
    const p = path.join(dir, `${name}.json`);
    if (!fs.existsSync(p)) throw new Error(`missing ${name}.json in ${dir}`);
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (v.format !== DUMP_FORMAT) throw new Error(`${name}.json: format ${v.format}, expected ${DUMP_FORMAT}`);
    return v;
}

function sortKeys(obj) {
    return Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** SHA-256 of every raw file in the fetched folder (DONE and the *.json files), sorted by name. */
export function rawHashes(src) {
    const out = {};
    for (const f of fs.readdirSync(src).filter(n => n === 'DONE' || n.endsWith('.json')).sort()) {
        out[f] = sha256(fs.readFileSync(path.join(src, f)));
    }
    return out;
}

/**
 * @param {{ src: string, jarSha256: string, outDir?: string, version?: string, allowErrors?: boolean,
 *           dryRun?: boolean, registryDir?: string, expectedRecipes?: object[] }} opts
 * @returns {{ written: string[], problems: string[], crosscheck: Array<{key: string, ok: boolean}> }}
 */
export function importDump({ src, jarSha256, version = '3.3.4', outDir, allowErrors = false, dryRun = false, registryDir, expectedRecipes } = {}) {
    outDir ??= path.join(ROOT, version);
    registryDir ??= outDir;
    const pin = PACK_PINS[version];
    const problems = [];
    if (!fs.existsSync(path.join(src, 'DONE'))) throw new Error(`${src}/DONE is missing: the dump did not finish (or was fetched mid-write)`);
    const files = {};
    for (const f of DUMP_FILES) files[f] = readDumpFile(src, f);
    const m = files.manifest;
    // 0. the jar that ran (PR #47 review): required, and it must match.
    const ranSha = m.dumperJar?.sha256 ?? null;
    if (!/^[0-9a-f]{64}$/.test(jarSha256 ?? '')) problems.push('no expected jar SHA-256 given (--jar-sha256 <64 hex>)');
    else if (ranSha !== jarSha256) problems.push(`manifest.dumperJar.sha256 ${ranSha} is not the expected ${jarSha256}`);
    if (m.errors?.length && !allowErrors) problems.push(`manifest lists ${m.errors.length} errors: ${m.errors.join('; ').slice(0, 400)}`);
    if (pin && m.forge !== pin.forge) problems.push(`Forge ${m.forge}, expected ${pin.forge}`);

    // 2. names agree with the registry capture
    const names = JSON.parse(fs.readFileSync(path.join(registryDir, 'registry-names.json'), 'utf8')).registries;
    for (const [kind, key] of Object.entries(SECTIONS)) {
        const synced = new Set(Object.keys(names[`minecraft:${kind}`]?.ids ?? {}));
        const dumped = new Set(Object.keys(files[kind][key] ?? {}));
        const missing = [...synced].filter(n => !dumped.has(n));
        const extra = [...dumped].filter(n => !synced.has(n));
        if (missing.length) problems.push(`${kind}: ${missing.length} synced but not dumped, e.g. ${missing.slice(0, 5).join(', ')}`);
        if (extra.length) problems.push(`${kind}: ${extra.length} dumped but not synced, e.g. ${extra.slice(0, 5).join(', ')}`);
    }

    // 3. scripts cross-check, on a catalog over the fetched files
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rotn-import-'));
    let crosscheck = [];
    try {
        fs.copyFileSync(path.join(registryDir, 'registry-names.json'), path.join(tmp, 'registry-names.json'));
        for (const f of DUMP_FILES) fs.writeFileSync(path.join(tmp, `${f}.json`), JSON.stringify(files[f]));
        const cat = new RotnData(tmp, { version });
        expectedRecipes ??= JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures', `scripts-${version}-early-recipes.json`), 'utf8')).recipes;
        crosscheck = expectedRecipes.map(e => ({ key: e.key, ok: cat.recipesFor(e.result.name).some(r => recipeMatches(e, r, (k) => cat.oreDict(k))) }));
        for (const c of crosscheck) if (!c.ok) problems.push(`scripts cross-check: no dumped recipe matches ${c.key}`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    if (problems.length) return { written: [], problems, crosscheck };

    // write
    files.manifest = {
        ...m,
        pack: { version, zipSha256: pin?.zipSha256 ?? null },
        importedFrom: 'tools/dumper via deploy/test-server.sh --fetch rotn-dump',
        import: { expectedJarSha256: jarSha256, rawSha256: rawHashes(src) },
    };
    files.blocks.blocks = sortKeys(files.blocks.blocks);
    files.items.items = sortKeys(files.items.items);
    files.entities.entities = sortKeys(files.entities.entities);
    files.oredict.ores = sortKeys(files.oredict.ores);
    files.spawns.biomes = sortKeys(files.spawns.biomes);
    files.recipes.recipes = [...files.recipes.recipes].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const written = [];
    for (const f of DUMP_FILES) {
        const text = JSON.stringify(files[f], null, 1) + '\n';
        const big = Buffer.byteLength(text) > BROTLI_ABOVE;
        const target = path.join(outDir, `${f}.json${big ? '.br' : ''}`);
        if (!dryRun) {
            fs.mkdirSync(outDir, { recursive: true });
            for (const ext of ['.json', '.json.br']) fs.rmSync(path.join(outDir, f + ext), { force: true });
            fs.writeFileSync(target, big ? zlib.brotliCompressSync(Buffer.from(text), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }) : text);
        }
        written.push(target);
    }
    return { written, problems, crosscheck };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
    const src = args.find((a, i) => !a.startsWith('--') && !['--version', '--jar-sha256'].includes(args[i - 1]));
    if (!src) { console.error('usage: import-dump.mjs <rotn-dump dir> --jar-sha256 <hex> [--version 3.3.4] [--allow-errors] [--dry-run]'); process.exit(2); }
    const res = importDump({ src, jarSha256: valueOf('--jar-sha256'), version: valueOf('--version') ?? '3.3.4', allowErrors: args.includes('--allow-errors'), dryRun: args.includes('--dry-run') });
    for (const c of res.crosscheck) console.log(`cross-check ${c.ok ? 'ok  ' : 'FAIL'} ${c.key}`);
    if (res.problems.length) { for (const p of res.problems) console.error(`problem: ${p}`); process.exit(1); }
    for (const w of res.written) console.log(`wrote ${w}`);
}
