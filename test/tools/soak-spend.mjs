#!/usr/bin/env node
// Soak evidence: the LLM spend of a soak's bot journal (driver.log), per day and night window, for the
// evidence README (soaks 12 and 13 did this by hand; #599 review 4 was about the window boundaries).
//
//   node test/tools/soak-spend.mjs <driver.log> [--json]
//
// Offline, reads one file, prints numbers only (no line text).
// - A call is one `[openrouter] usage ...` line. Its reasoning tokens are the `[openrouter] reasoning_tokens N`
//   line after it, before the next usage line (none: null, openrouter.js prints no line then).
// - A memory summary (lead, 2026-11-24, from soak 14 on): the first usage line after a `[memory] summary
//   turns <n> kept <k>` marker (skills-rotn #601). A log with no marker at all (before #601) falls back to
//   the old rule, a prompt under 2,000 tokens, and says so (`memoryRule`). Summaries may overlap a command
//   call in the journal; the marker rule then takes the next usage line, as the lead set it.
// - `[openrouter] reasoning effort=none for this call` lines (#600) are counted, and the summaries'
//   reasoning tokens are reported apart from the other calls'.
// - Windows: a night runs from `[night] sunset is near` (or `[night] it is night`) to the night's first
//   `[night] morning` line; the days are the gaps (day 1 from the first journal line). The README states
//   this boundary; a section that ends a night at the dig-out says its own.
// - Self-prompting: from `starting self-prompt loop` to `self prompt loop stopped` (open at the end:
//   counted to the last line).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const MEMORY_MARKER = /^\[memory\] summary turns (\d+) kept (\d+)\b/;
export const EFFORT_LINE = /^\[openrouter\] reasoning (\S+) for this call$/;
export const USAGE_LINE = /^\[openrouter\] usage prompt_tokens (\S+), completion_tokens (\S+), cost_usd (\S+)$/;
export const REASONING_LINE = /^\[openrouter\] reasoning_tokens (\S+)$/;
export const PROVIDER_LINE = /^\[openrouter\] provider ([\w .?-]{0,40}), finish_reason /;
export const NIGHT_START = /^\[night\] (sunset is near|it is night): building a shelter/;
export const NIGHT_END = /^\[night\] morning\b/;
export const LOOP_START = /^starting self-prompt loop$/;
export const LOOP_STOP = /^self prompt loop stopped$/;
/** The pre-#601 memory-summary rule: a prompt under this many tokens. */
export const OLD_SUMMARY_PROMPT_MAX = 2000;
/** A journal line: ISO time, the unit's process tag, the message. */
const JOURNAL = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:[+-]\d\d:\d\d|Z)) \S+?: ?(.*)$/;

const num = (v) => { const n = Number(String(v).replace(/,$/, '')); return Number.isFinite(n) ? n : null; };
const hms = (ms) => new Date(ms).toISOString().slice(11, 19);

/** [{t (ms), msg}] for the journal lines of a driver.log text; other lines are skipped. */
export function parseJournal(text) {
    const out = [];
    for (const line of String(text).split('\n')) {
        const m = JOURNAL.exec(line);
        if (!m) continue;
        const t = Date.parse(m[1]);
        if (Number.isFinite(t)) out.push({ t, msg: m[2].trimEnd() });
    }
    return out;
}

/** The calls, in order: {t, prompt, completion, usd, reasoning, memory, effort, provider, selfPrompting}. */
export function calls(lines) {
    const memoryRule = lines.some(l => MEMORY_MARKER.test(l.msg)) ? 'marker' : 'prompt-size';
    const list = [];
    let pendingMemory = 0; // markers not yet matched to a usage line
    let pendingEffort = null;
    let provider = null;
    let last = null; // the call whose reasoning line may still come
    let looping = false; // inside a self-prompt loop, by line order (a stop and a call can share a second)
    for (const { t, msg } of lines) {
        if (LOOP_START.test(msg)) { looping = true; continue; }
        if (LOOP_STOP.test(msg)) { looping = false; continue; }
        if (MEMORY_MARKER.test(msg)) { pendingMemory++; continue; }
        let m = EFFORT_LINE.exec(msg);
        if (m) { pendingEffort = m[1]; continue; }
        m = PROVIDER_LINE.exec(msg);
        if (m) { provider = m[1]; continue; }
        m = USAGE_LINE.exec(msg);
        if (m) {
            const prompt = num(m[1]);
            const memory = memoryRule === 'marker' ? pendingMemory > 0 : (prompt !== null && prompt < OLD_SUMMARY_PROMPT_MAX);
            if (memoryRule === 'marker' && pendingMemory > 0) pendingMemory--;
            last = { t, prompt, completion: num(m[2]), usd: num(m[3]), reasoning: null, memory, effort: memory ? pendingEffort : null, provider, selfPrompting: looping };
            if (memory) pendingEffort = null;
            provider = null;
            list.push(last);
            continue;
        }
        m = REASONING_LINE.exec(msg);
        if (m && last && last.reasoning === null) last.reasoning = num(m[1]);
    }
    return { memoryRule, list };
}

/** Day and night windows: [{name, from, to}] (ms), covering the first to the last journal line. */
export function windows(lines) {
    if (!lines.length) return [];
    const first = lines[0].t;
    const end = lines[lines.length - 1].t;
    const out = [];
    let day = 1;
    let night = 0;
    let from = first;
    let inNight = false;
    for (const { t, msg } of lines) {
        if (!inNight && NIGHT_START.test(msg)) {
            out.push({ name: `Day ${day}`, from, to: t });
            night++; inNight = true; from = t;
        } else if (inNight && NIGHT_END.test(msg)) {
            out.push({ name: `Night ${night}`, from, to: t });
            day++; inNight = false; from = t;
        }
    }
    out.push({ name: inNight ? `Night ${night} (open at the end)` : `Day ${day}`, from, to: end });
    return out;
}

/** Self-prompting time (ms), by the loop's start and stop lines, and the calls logged inside it (line order). */
export function selfPrompting(lines, list) {
    const spans = [];
    let on = null;
    for (const { t, msg } of lines) {
        if (on === null && LOOP_START.test(msg)) on = t;
        else if (on !== null && LOOP_STOP.test(msg)) { spans.push([on, t]); on = null; }
    }
    const open = on !== null;
    if (open) spans.push([on, lines[lines.length - 1].t]);
    const c = list.filter(x => x.selfPrompting);
    return { ms: spans.reduce((s, [a, b]) => s + (b - a), 0), runs: spans.length, openAtEnd: open, calls: c.length, usd: sum(c, 'usd') };
}

function sum(list, key) { return list.reduce((s, x) => s + (x[key] ?? 0), 0); }
function tally(list) {
    return {
        calls: list.length, usd: sum(list, 'usd'), prompt: sum(list, 'prompt'), completion: sum(list, 'completion'),
        reasoning: sum(list, 'reasoning'), reasoningLines: list.filter(x => x.reasoning !== null).length,
        maxCompletion: list.reduce((m, x) => Math.max(m, x.completion ?? 0), 0),
        maxReasoning: list.reduce((m, x) => Math.max(m, x.reasoning ?? 0), 0),
    };
}

/** The whole breakdown of a driver.log text. */
export function soakSpend(text) {
    const lines = parseJournal(text);
    const { memoryRule, list } = calls(lines);
    const mem = list.filter(x => x.memory);
    const rest = list.filter(x => !x.memory);
    // Windows are [from, to): a call at a window's exact end belongs to the next one; the last takes its end.
    const raw = windows(lines);
    const ws = raw.map((w, i) => {
        const inW = list.filter(x => x.t >= w.from && (i === raw.length - 1 ? x.t <= w.to : x.t < w.to));
        return { ...w, all: tally(inW), memory: tally(inW.filter(x => x.memory)) };
    });
    const providers = {};
    for (const x of list) providers[x.provider ?? '(none)'] = (providers[x.provider ?? '(none)'] ?? 0) + 1;
    const span = lines.length ? lines[lines.length - 1].t - lines[0].t : 0;
    return {
        memoryRule,
        markers: lines.filter(l => MEMORY_MARKER.test(l.msg)).length,
        effortLines: lines.filter(l => EFFORT_LINE.test(l.msg)).length,
        from: lines[0]?.t ?? null, to: lines[lines.length - 1]?.t ?? null, spanMs: span,
        total: tally(list), memory: tally(mem), other: tally(rest),
        memoryWithEffort: mem.filter(x => x.effort !== null).length,
        windows: ws, selfPrompting: selfPrompting(lines, list), providers,
    };
}

const usd = (v) => v.toFixed(6);
const int = (v) => v.toLocaleString('en-US');
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '–');

/** The README tables (Markdown). */
export function render(r) {
    const o = [];
    o.push(`Memory summaries counted by: ${r.memoryRule === 'marker' ? `the \`[memory] summary turns\` marker (${r.markers} markers)` : `a prompt under ${int(OLD_SUMMARY_PROMPT_MAX)} tokens (no \`[memory] summary turns\` marker in this log)`}.`);
    o.push(`\`[openrouter] reasoning … for this call\` lines: ${r.effortLines}; summaries after one: ${r.memoryWithEffort} of ${r.memory.calls}.`);
    o.push('A night runs from `sunset is near` to its first `[night] morning` line.');
    o.push('');
    o.push('| Window | Calls | Memory summaries (calls, USD, reasoning tokens) | Completion tokens | Reasoning tokens | USD |');
    o.push('| --- | --- | --- | --- | --- | --- |');
    for (const w of r.windows) {
        const m = w.memory.calls ? `${w.memory.calls}, ${usd(w.memory.usd)}, ${int(w.memory.reasoning)}` : '0';
        o.push(`| ${w.name} (${hms(w.from)}–${hms(w.to)}) | ${w.all.calls} | ${m} | ${w.all.calls ? int(w.all.completion) : '–'} | ${w.all.calls ? int(w.all.reasoning) : '–'} | ${w.all.calls ? usd(w.all.usd) : '–'} |`);
    }
    o.push(`| **Total** | **${r.total.calls}** | **${r.memory.calls}, ${usd(r.memory.usd)} (${pct(r.memory.usd, r.total.usd)}), ${int(r.memory.reasoning)}** | **${int(r.total.completion)}** | **${int(r.total.reasoning)}** | **${usd(r.total.usd)}** |`);
    o.push('');
    const h = r.spanMs / 3_600_000;
    o.push(`- Journal span ${hms(r.from)}–${hms(r.to)} (${(r.spanMs / 60_000).toFixed(1)} min): USD ${h ? (r.total.usd / h).toFixed(4) : '–'}/h.`);
    o.push(`- Reasoning: ${int(r.total.reasoning)} of ${int(r.total.completion)} completion tokens (${pct(r.total.reasoning, r.total.completion)}); ${r.total.calls - r.total.reasoningLines} calls had no reasoning_tokens line.`);
    o.push(`- Memory summaries: ${r.memory.calls} of ${r.total.calls} calls (${pct(r.memory.calls, r.total.calls)}), USD ${usd(r.memory.usd)} (${pct(r.memory.usd, r.total.usd)}); completion ${int(r.memory.completion)} (max ${int(r.memory.maxCompletion)}), reasoning ${int(r.memory.reasoning)} (max ${int(r.memory.maxReasoning)}).`);
    o.push(`- Other calls: ${r.other.calls}, USD ${usd(r.other.usd)}; completion ${int(r.other.completion)}, reasoning ${int(r.other.reasoning)} (max ${int(r.other.maxReasoning)}).`);
    const sp = r.selfPrompting;
    o.push(`- Self-prompting: ${(sp.ms / 60_000).toFixed(1)} min in ${sp.runs} runs${sp.openAtEnd ? ' (the last open at the end)' : ''}, ${sp.calls} calls, USD ${usd(sp.usd)}${sp.ms ? ` (${(sp.usd / (sp.ms / 3_600_000)).toFixed(4)}/h)` : ''}; outside it ${r.total.calls - sp.calls} calls, USD ${usd(r.total.usd - sp.usd)}.`);
    o.push(`- Providers: ${Object.entries(r.providers).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`);
    return o.join('\n');
}

function main(argv) {
    const json = argv.includes('--json');
    const files = argv.filter(a => a !== '--json');
    if (files.length !== 1) {
        console.error('usage: node test/tools/soak-spend.mjs <driver.log> [--json]');
        process.exit(2);
    }
    let text;
    try { text = fs.readFileSync(files[0], 'utf8'); } catch (err) { console.error(`soak-spend: cannot read ${files[0]}: ${err.code ?? err.message}`); process.exit(2); }
    const r = soakSpend(text);
    if (!r.total.calls) { console.error('soak-spend: no [openrouter] usage line in this file'); process.exit(1); }
    console.log(json ? JSON.stringify(r, null, 2) : render(r));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
