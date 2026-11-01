// Scenario-side helpers for the G2 scenarios ("see the world"): collect the bot's paged chat replies
// and read the server's answers to testforblock, testfor, summon and give. The bot only reports names;
// every verdict is the server's (test/runner/DRIVER.md, G2).
//
// Reply format (one or more chat lines, paged because vanilla kicks a player for chat spam):
//   <BOT> KIND TOKEN PAGE/PAGES field field ...; field field ...; ...
// The 1.12.2 en_us strings parsed below are the server's own (lang keys commands.testforblock.*,
// commands.testfor.success, commands.summon.*, commands.give.*); a real run confirms them.
import fs from 'node:fs';
import path from 'node:path';
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
 * Is the agent's naming path wired to rotn-data (rotn-data brief item 4)? G2 asks whether the AGENT
 * sees correct names, so until src/utils/mcdata.js itself imports rotn-data's package and exports
 * toNew and toOld, no G2 run counts (PR #36 re-review, item 3). Read statically on purpose: importing
 * mcdata.js would load mineflayer and every plugin into the runner. Returns {wired, why}.
 */
export function mcdataWiring(repoRoot) {
    let src;
    try {
        src = fs.readFileSync(path.join(repoRoot, 'src', 'utils', 'mcdata.js'), 'utf8');
    } catch (e) {
        return { wired: false, why: `src/utils/mcdata.js not readable (${e.code ?? e.message})` };
    }
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const imports = /\bfrom\s+['"][^'"]*packages\/rotn-data(?:\/[^'"]*)?['"]/.test(code) || /\bimport\(\s*['"][^'"]*packages\/rotn-data/.test(code);
    const exported = (n) => new RegExp(String.raw`export\s+(?:async\s+)?function\s+${n}\b|export\s+(?:const|let|var)\s+${n}\b|export\s*\{[^}]*\b${n}\b[^}]*\}`).test(code);
    const missing = ['toNew', 'toOld'].filter((n) => !exported(n));
    if (!imports) return { wired: false, why: 'src/utils/mcdata.js does not import packages/rotn-data' };
    if (missing.length) return { wired: false, why: `src/utils/mcdata.js does not export ${missing.join(' and ')}` };
    return { wired: true, why: 'src/utils/mcdata.js imports packages/rotn-data and exports toNew and toOld' };
}
