// Scenario-side helpers for the G2 scenarios ("see the world"): collect the bot's paged chat replies
// and read the server's answers to testforblock, testfor, summon and give. The bot only reports names;
// every verdict is the server's (test/runner/DRIVER.md, G2).
//
// Reply format (one or more chat lines, paged because vanilla kicks a player for chat spam):
//   <BOT> KIND TOKEN PAGE/PAGES field field ...; field field ...; ...
// The 1.12.2 en_us strings parsed below are the server's own (lang keys commands.testforblock.*,
// commands.testfor.success, commands.summon.*, commands.give.*); a real run confirms them.
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { chatLines, parseLine } from './server-log.mjs';

/** A full registry name, "namespace:path". Anything else (null, a number, "unknown") is not a name. */
export const REGISTRY_NAME = /^[a-z][a-z0-9_.-]*:[a-z0-9_./-]*[a-z][a-z0-9_./-]*$/;   // "1:0" (an id) is not a name
export const isRegistryName = (n) => typeof n === 'string' && REGISTRY_NAME.test(n) && !/(^|[:_/])unknown([_/]|$)/.test(n);

/**
 * The pages the bot has said so far for KIND TOKEN. Returns null if none yet, else
 * {total, complete, entries: [[field, ...], ...]} in page order. Duplicate pages keep the first.
 */
export function replyPages(lines, bot, kind, token) {
    const re = new RegExp(`^${kind} ${token} (\\d+)/(\\d+)(?: (.*))?$`);
    const pages = new Map();
    let total = null;
    for (const c of chatLines(lines, bot)) {
        const m = re.exec(c.text.trim());
        if (!m) continue;
        total = Number(m[2]);
        if (!pages.has(Number(m[1]))) pages.set(Number(m[1]), m[3] ?? '');
    }
    if (total === null) return null;
    const complete = total >= 1 && Array.from({ length: total }, (_, i) => i + 1).every((i) => pages.has(i));
    const entries = [...pages.entries()].sort((a, b) => a[0] - b[0])
        .flatMap(([, text]) => text.split(';').map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+/)));
    return { total, complete, entries };
}

/** Wait until every page of KIND TOKEN arrived, or the timeout. Returns replyPages' result (maybe incomplete) or null. */
export async function awaitReply(ctx, sinceMarker, bot, kind, token, timeoutMs) {
    let last = null;
    const done = await ctx.waitFor(() => {
        last = replyPages(sinceMarker(), bot, kind, token);
        return last?.complete ? last : null;
    }, timeoutMs);
    return done ?? last;
}

const msgs = (lines) => lines.map((l) => parseLine(l)?.msg ?? l);
const firstOther = (lines) => msgs(lines).find(Boolean) ?? 'no answer from the server';

/** testforblock X Y Z NAME META: {ok, detail}. ok only on the exact success line for these coordinates. */
export function testforblockVerdict(lines, [x, y, z]) {
    for (const m of msgs(lines)) {
        if (m === `Successfully found the block at ${x},${y},${z}.`) return { ok: true, detail: 'found' };
        if (m.startsWith(`The block at ${x},${y},${z} `)) return { ok: false, detail: m };
    }
    return { ok: false, detail: firstOther(lines) };
}

/** testfor SELECTOR: ok on "Found <name>". */
export function testforVerdict(lines) {
    const hit = msgs(lines).find((m) => /^Found \S/.test(m));
    return hit ? { ok: true, detail: hit } : { ok: false, detail: firstOther(lines) };
}

export function summonVerdict(lines) {
    const ms = msgs(lines);
    return ms.includes('Object successfully summoned') ? { ok: true, detail: 'summoned' } : { ok: false, detail: firstOther(lines) };
}

export function giveVerdict(lines, bot) {
    const hit = msgs(lines).find((m) => new RegExp(`^Given .+ \\* \\d+ to ${bot}$`).test(m));
    return hit ? { ok: true, detail: hit } : { ok: false, detail: firstOther(lines) };
}

/** Integer fields, or null if any is not an integer. */
export function ints(fields) {
    const out = fields.map((f) => (/^-?\d+$/.test(f ?? '') ? Number(f) : NaN));
    return out.some(Number.isNaN) ? null : out;
}

/** A deterministic PRNG (mulberry32) so a run's spot-check positions can be reproduced from its seed. */
export function prng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Keep notes small: the first n items and how many there were. */
export const sample = (arr, n = 20) => ({ count: arr.length, first: arr.slice(0, n) });

/**
 * Is the agent's naming API wired and correct? G2 asks whether the AGENT sees correct names, and the
 * agent's naming API is src/utils/mcdata.js's toNew(name, meta?) and toOld(name) (PR #36 / #44
 * contract, same signatures and null semantics as rotn-data's). A child process (node --input-type=module)
 * imports src/utils/mcdata.js, the module the agent itself runs, and
 *   1. requires typeof toNew === 'function' && typeof toOld === 'function';
 *   2. runs every entry of packages/rotn-data/vanilla/flattening-items.json (expected values only)
 *      through THOSE exports both ways: toNew(old, meta) === new and toOld(new) deep-equals {name: old, meta}.
 * "wired" only if both pass; otherwise every G2 run calls notGate (PR #36 re-review). A child process,
 * so the runner itself never loads mineflayer and its plugins, and a module that hangs or crashes cannot
 * take the runner with it.
 * Returns {wired, why, entries, failureCount, failures (first 20)}.
 */
export const AGENT_NAMING_SCRIPT = `
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
const root = process.env.ROTN_G2_ROOT;
const out = (o) => { process.stdout.write('G2NAMING ' + JSON.stringify(o) + '\\n'); process.exit(0); };
let mc;
try {
    mc = await import(pathToFileURL(path.join(root, 'src', 'utils', 'mcdata.js')).href);
} catch (e) {
    out({ wired: false, why: 'src/utils/mcdata.js could not be imported: ' + String(e && e.message || e).slice(0, 300) });
}
const missing = ['toNew', 'toOld'].filter((n) => typeof mc[n] !== 'function');
if (missing.length) out({ wired: false, why: 'src/utils/mcdata.js does not export ' + missing.join(' and ') + ' as functions' });
let entries;
try {
    entries = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'rotn-data', 'vanilla', 'flattening-items.json'), 'utf8')).entries;
} catch (e) {
    out({ wired: false, why: 'packages/rotn-data/vanilla/flattening-items.json not available (' + (e.code || e.message) + ')' });
}
if (!Array.isArray(entries) || entries.length === 0) out({ wired: false, why: 'flattening-items.json has no entries' });
const failures = [];
for (const e of entries) {
    let next, back;
    try { next = mc.toNew(e.old, e.meta); } catch (err) { next = 'threw: ' + (err && err.message); }
    try { back = mc.toOld(e.new); } catch (err) { back = 'threw: ' + (err && err.message); }
    if (next !== e.new) failures.push('toNew(' + e.old + ', ' + e.meta + ') = ' + JSON.stringify(next) + ', table says ' + e.new);
    if (!back || back.name !== e.old || back.meta !== e.meta) failures.push('toOld(' + e.new + ') = ' + JSON.stringify(back) + ', table says ' + e.old + ':' + e.meta);
}
out({
    wired: failures.length === 0,
    why: failures.length
        ? failures.length + ' failure(s) in the ' + entries.length + '-entry round trip through mcdata.js toNew/toOld; first: ' + failures[0]
        : 'mcdata.js exports toNew and toOld; all ' + entries.length + ' table entries round-trip through them',
    entries: entries.length, failureCount: failures.length, failures: failures.slice(0, 20),
});
`;

export function agentNaming(repoRoot, { timeoutMs = 180000, run = spawnSync, node = process.execPath } = {}) {
    const r = run(node, ['--input-type=module', '-e', AGENT_NAMING_SCRIPT], {
        cwd: repoRoot, env: { ...process.env, ROTN_G2_ROOT: repoRoot, NODE_OPTIONS: '' }, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
    });
    const line = String(r.stdout ?? '').split('\n').reverse().find((l) => l.startsWith('G2NAMING '));
    if (!line) {
        const why = r.error ? `the naming check could not run (${r.error.code ?? r.error.message})` : `the naming check gave no result (exit ${r.status}): ${String(r.stderr ?? '').trim().slice(-300)}`;
        return { wired: false, why, entries: 0, failureCount: 0, failures: [] };
    }
    try {
        const o = JSON.parse(line.slice('G2NAMING '.length));
        return { wired: o.wired === true, why: String(o.why ?? ''), entries: o.entries ?? 0, failureCount: o.failureCount ?? 0, failures: o.failures ?? [] };
    } catch {
        return { wired: false, why: 'the naming check printed an unreadable result', entries: 0, failureCount: 0, failures: [] };
    }
}
