#!/usr/bin/env node
// Soak evidence: the LLM spend of a soak's bot journal (driver.log), per day and night window, for the
// evidence README (soaks 12 and 13 did this by hand; #599 review 4 was about the window boundaries).
//
//   node test/tools/soak-spend.mjs <driver.log> [--result <result.json>] [--json]
//
// Offline, reads the given files, prints numbers only (no line text).
// - A call is one `[openrouter] usage ...` line. Its reasoning tokens are the `[openrouter] reasoning_tokens N`
//   line after it, before the next usage line (none: null, openrouter.js prints no line then). A field
//   openrouter.js prints as `unknown` is null: it adds nothing to a sum and is counted (`unknownUsd`).
// - A memory summary (soak 14): the call whose reply goes to history.js. openrouter.js prints `Received.`
//   after a call's usage and reasoning lines; the next line from the caller is `Memory updated to:` (or
//   `[memory] summary returned|failed`) for a summary and `Generated response:` for a command. That pairs
//   each summary with its own usage line even when a summary and a command call overlap, which they do:
//   history.js starts the summary and the next command's prompt goes out at once, and the command's
//   reply usually comes back first. The `[memory] summary turns <n> kept <k>` marker (skills-rotn #601)
//   was to be the rule (lead, 2026-11-24), but in soak 14 the next usage line after a marker was a
//   command call 18 times of 22; markers are counted and compared with the summaries found. A call with
//   no clear pairing (another `Received.` or usage line comes first) falls back to the old rule, a prompt
//   under 2,000 tokens, and is counted (`unclear`); so does a log with no `Received.` line at all.
// - `[openrouter] reasoning effort=none for this call` lines (#600) are counted, with the
//   `the reasoning setting may have been refused` lines (after one, openrouter.js sends no setting).
//   The summaries' reasoning tokens are reported apart from the other calls'.
// - Windows: a night runs from `[night] sunset is near` (or `[night] it is night`) to the night's first
//   `[night] morning` line; the days are the gaps. Day 1 is named from the bot's `<bot> spawned.` line
//   (the first line if there is none) and also holds anything before it. Every window after the last
//   night is a "Day" (soak 13's README called its last one "Morning 4"). Calls go to windows by line
//   order (#602 review 1): a call printed before a boundary line in the same second stays in the window
//   before it. The README states this boundary; a section that ends a night at the dig-out says its own.
// - Self-prompting: a "loop run" is one `starting self-prompt loop` to `self prompt loop stopped` pair
//   (one still open at the end runs to the last line). A call counts as self-prompting when its usage line
//   is printed inside a run, by line order; so a memory summary started inside a run whose usage line
//   comes after `self prompt loop stopped` counts outside it (#602 review 7).
// - USD per hour: one figure per README, the gate's (#602 review 4). With --result (the run's result.json,
//   or a result.json next to the driver.log), it is the scenario's `llmUsage.usdPerHour`: the usage lines'
//   USD over the journal's covered minutes. The tool checks that its own USD total equals the gate's. With
//   no result.json it prints USD over the journal span and says it is not the gate's figure.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const MEMORY_MARKER = /^\[memory\] summary turns (\d+) kept (\d+)\b/;
export const EFFORT_LINE = /^\[openrouter\] reasoning (\S+) for this call$/;
export const USAGE_LINE = /^\[openrouter\] usage prompt_tokens (\S+), completion_tokens (\S+), cost_usd (\S+)$/;
export const REASONING_LINE = /^\[openrouter\] reasoning_tokens (\S+)$/;
export const PROVIDER_LINE = /^\[openrouter\] provider ([\w .?-]{0,40}), finish_reason /;
/** openrouter.js after a call's provider, usage and reasoning lines. */
export const RECEIVED = /^Received\.$/;
/** The caller's first line after a memory summary's reply (history.js). */
export const SUMMARY_END = /^(Memory updated to:|\[memory\] summary (returned|failed)\b)/;
/** The caller's first line after a command call's reply (agent.js; or a null reply). */
export const COMMAND_END = /^(Generated response:|Error: Generated response is not a string)/;
/** openrouter.js when the reasoning setting was refused (it then sends none). */
export const EFFORT_REFUSED = /^\[openrouter\] the reasoning setting may have been refused\b/;
export const NIGHT_START = /^\[night\] (sunset is near|it is night): building a shelter/;
export const NIGHT_END = /^\[night\] morning\b/;
export const LOOP_START = /^starting self-prompt loop$/;
export const LOOP_STOP = /^self prompt loop stopped$/;
export const SPAWNED = /^\S+ spawned\.$/;
/** The pre-#601 memory-summary rule: a prompt under this many tokens. */
export const OLD_SUMMARY_PROMPT_MAX = 2000;
/** A journal line: ISO time, the unit's process tag, the message. */
const JOURNAL = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:[+-]\d\d:\d\d|Z)) \S+?: ?(.*)$/;

const num = (v) => { const n = Number(String(v).replace(/,$/, '')); return /^-?[\d.]+(e-?\d+)?,?$/i.test(String(v)) && Number.isFinite(n) ? n : null; };
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

/**
 * The calls, in order: {i (line index), t, prompt, completion, usd, reasoning, memory, kind ('summary' |
 * 'command' | 'unclear'), provider, selfPrompting}; `unclear` calls are summaries by the prompt-size rule.
 */
export function calls(lines) {
    const list = [];
    let provider = null;
    let last = null; // the call whose reasoning line may still come
    let unreceived = null; // the last call whose `Received.` has not come
    let awaiting = null; // the call whose `Received.` came, waiting for its caller's first line
    let orphanEnds = 0; // summary end lines with no call waiting
    let looping = false; // inside a self-prompt loop run, by line order (a stop and a call can share a second)
    const unclear = () => { if (awaiting) { awaiting.kind = 'unclear'; awaiting = null; } };
    lines.forEach(({ t, msg }, i) => {
        if (LOOP_START.test(msg)) { looping = true; return; }
        if (LOOP_STOP.test(msg)) { looping = false; return; }
        if (RECEIVED.test(msg)) { unclear(); awaiting = unreceived; unreceived = null; return; }
        if (SUMMARY_END.test(msg)) { if (awaiting) { awaiting.kind = 'summary'; awaiting = null; } else orphanEnds++; return; }
        if (COMMAND_END.test(msg)) { if (awaiting) { awaiting.kind = 'command'; awaiting = null; } return; }
        let m = PROVIDER_LINE.exec(msg);
        if (m) { provider = m[1]; return; }
        m = USAGE_LINE.exec(msg);
        if (m) {
            unclear();
            if (unreceived) unreceived.kind = 'unclear';
            last = { i, t, prompt: num(m[1]), completion: num(m[2]), usd: num(m[3]), reasoning: null, kind: null, provider, selfPrompting: looping };
            unreceived = last;
            provider = null;
            list.push(last);
            return;
        }
        m = REASONING_LINE.exec(msg);
        if (m && last && last.reasoning === null) last.reasoning = num(m[1]);
    });
    unclear();
    for (const c of list) {
        if (c.kind === null) c.kind = 'unclear';
        c.memory = c.kind === 'summary' || (c.kind === 'unclear' && c.prompt !== null && c.prompt < OLD_SUMMARY_PROMPT_MAX);
    }
    return { list, unclear: list.filter(c => c.kind === 'unclear').length, orphanEnds };
}

/**
 * Day and night windows: [{name, from, to (ms), fromI, toI (line indexes, [fromI, toI))}], covering every
 * journal line; the last window ends after the last line. Day 1's `from` is the spawn line's time.
 */
export function windows(lines) {
    if (!lines.length) return [];
    const spawn = lines.find(l => SPAWNED.test(l.msg));
    const out = [];
    let day = 1;
    let night = 0;
    let from = (spawn ?? lines[0]).t;
    let fromI = 0;
    let inNight = false;
    lines.forEach(({ t, msg }, i) => {
        if (!inNight && NIGHT_START.test(msg)) {
            out.push({ name: `Day ${day}`, from, to: t, fromI, toI: i });
            night++; inNight = true; from = t; fromI = i;
        } else if (inNight && NIGHT_END.test(msg)) {
            out.push({ name: `Night ${night}`, from, to: t, fromI, toI: i });
            day++; inNight = false; from = t; fromI = i;
        }
    });
    out.push({ name: inNight ? `Night ${night} (open at the end)` : `Day ${day}`, from, to: lines[lines.length - 1].t, fromI, toI: lines.length });
    return out;
}

/** Self-prompting time (ms) over its loop runs, and the calls logged inside a run (line order). */
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
        calls: list.length, usd: sum(list, 'usd'), unknownUsd: list.filter(x => x.usd === null).length,
        prompt: sum(list, 'prompt'), completion: sum(list, 'completion'),
        reasoning: sum(list, 'reasoning'), reasoningLines: list.filter(x => x.reasoning !== null).length,
        maxCompletion: list.reduce((m, x) => Math.max(m, x.completion ?? 0), 0),
        maxReasoning: list.reduce((m, x) => Math.max(m, x.reasoning ?? 0), 0),
    };
}

/**
 * The gate's USD per hour from a result.json object (g4-soak-2h's `llmUsage` note), or null: {usdPerHour,
 * usd, minutes, calls}.
 */
export function gateUsage(result) {
    const u = result?.notes?.llmUsage;
    if (!u || typeof u.usdPerHour !== 'number') return null;
    return { usdPerHour: u.usdPerHour, usd: u.usd, minutes: u.minutes, calls: u.calls };
}

/** The whole breakdown of a driver.log text; `result`: the run's result.json object, for the gate's USD/h. */
export function soakSpend(text, { result = null } = {}) {
    const lines = parseJournal(text);
    const { list, unclear, orphanEnds } = calls(lines);
    const mem = list.filter(x => x.memory);
    const rest = list.filter(x => !x.memory);
    const ws = windows(lines).map(w => {
        const inW = list.filter(x => x.i >= w.fromI && x.i < w.toI);
        return { ...w, all: tally(inW), memory: tally(inW.filter(x => x.memory)) };
    });
    const providers = {};
    for (const x of list) providers[x.provider ?? '(none)'] = (providers[x.provider ?? '(none)'] ?? 0) + 1;
    const span = lines.length ? lines[lines.length - 1].t - lines[0].t : 0;
    const total = tally(list);
    const gate = gateUsage(result);
    return {
        unclear, orphanEnds,
        markers: lines.filter(l => MEMORY_MARKER.test(l.msg)).length,
        summaryEnds: lines.filter(l => SUMMARY_END.test(l.msg)).length,
        effortLines: lines.filter(l => EFFORT_LINE.test(l.msg)).length,
        effortRefused: lines.filter(l => EFFORT_REFUSED.test(l.msg)).length,
        from: lines[0]?.t ?? null, to: lines[lines.length - 1]?.t ?? null, spanMs: span,
        total, memory: tally(mem), other: tally(rest),
        summaryPromptsOver: mem.filter(x => x.prompt !== null && x.prompt >= OLD_SUMMARY_PROMPT_MAX).length,
        windows: ws, selfPrompting: selfPrompting(lines, list), providers,
        // One USD/h per README: the gate's when result.json is there; else the journal span's, labelled.
        usdPerHour: gate
            ? { source: 'gate', value: gate.usdPerHour, minutes: gate.minutes, gateUsd: gate.usd, matches: Math.abs(gate.usd - total.usd) < 5e-7 }
            : { source: 'journal span', value: span ? Math.round(total.usd / (span / 3_600_000) * 1e6) / 1e6 : null, minutes: Math.round(span / 6000) / 10 },
    };
}

const usd = (v) => v.toFixed(6);
const int = (v) => v.toLocaleString('en-US');
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '–');

/** The README tables (Markdown). */
export function render(r) {
    const o = [];
    o.push(`Memory summaries: each call paired with its caller's first line after \`Received.\` (\`Memory updated to:\` = a summary): ${r.memory.calls} summaries (${r.summaryPromptsOver} with a prompt of ${int(OLD_SUMMARY_PROMPT_MAX)} tokens or more), ${r.summaryEnds} summary end lines, ${r.markers} \`[memory] summary turns\` markers; ${r.unclear} calls not clearly paired (the prompt-size rule for them)${r.orphanEnds ? `; **${r.orphanEnds} summary end lines with no call**` : ''}.`);
    o.push(`\`[openrouter] reasoning … for this call\` lines: ${r.effortLines}; \`the reasoning setting may have been refused\` lines: ${r.effortRefused}.`);
    o.push('A night runs from `sunset is near` to its first `[night] morning` line; calls go to windows by line order. Day 1 starts at the spawn line; every window after the last night is a Day.');
    o.push('');
    o.push('| Window | Calls | Memory summaries (calls, USD, reasoning tokens) | Completion tokens | Reasoning tokens | USD |');
    o.push('| --- | --- | --- | --- | --- | --- |');
    for (const w of r.windows) {
        const m = w.memory.calls ? `${w.memory.calls}, ${usd(w.memory.usd)}, ${int(w.memory.reasoning)}` : '0';
        o.push(`| ${w.name} (${hms(w.from)}–${hms(w.to)}) | ${w.all.calls} | ${m} | ${w.all.calls ? int(w.all.completion) : '–'} | ${w.all.calls ? int(w.all.reasoning) : '–'} | ${w.all.calls ? usd(w.all.usd) : '–'} |`);
    }
    o.push(`| **Total** | **${r.total.calls}** | **${r.memory.calls}, ${usd(r.memory.usd)} (${pct(r.memory.usd, r.total.usd)}), ${int(r.memory.reasoning)}** | **${int(r.total.completion)}** | **${int(r.total.reasoning)}** | **${usd(r.total.usd)}** |`);
    o.push('');
    const u = r.usdPerHour;
    if (u.source === 'gate') {
        o.push(`- USD per hour (the gate's, result.json \`llmUsage\`): ${u.value} over ${u.minutes} min; the gate's USD ${u.gateUsd} ${u.matches ? 'equals' : '**differs from**'} this tool's ${usd(r.total.usd)}.`);
    } else {
        o.push(`- USD per hour over the journal span ${hms(r.from)}–${hms(r.to)} (${u.minutes} min): ${u.value}. **Not the gate's figure** (no result.json): use result.json's for the README.`);
    }
    if (r.total.unknownUsd) o.push(`- **${r.total.unknownUsd} usage line(s) have cost_usd unknown**: they add nothing to the USD sums.`);
    o.push(`- Reasoning: ${int(r.total.reasoning)} of ${int(r.total.completion)} completion tokens (${pct(r.total.reasoning, r.total.completion)}); ${r.total.calls - r.total.reasoningLines} calls had no reasoning_tokens line.`);
    o.push(`- Memory summaries: ${r.memory.calls} of ${r.total.calls} calls (${pct(r.memory.calls, r.total.calls)}), USD ${usd(r.memory.usd)} (${pct(r.memory.usd, r.total.usd)}); completion ${int(r.memory.completion)} (max ${int(r.memory.maxCompletion)}), reasoning ${int(r.memory.reasoning)} (max ${int(r.memory.maxReasoning)}).`);
    o.push(`- Other calls: ${r.other.calls}, USD ${usd(r.other.usd)}; completion ${int(r.other.completion)}, reasoning ${int(r.other.reasoning)} (max ${int(r.other.maxReasoning)}).`);
    const sp = r.selfPrompting;
    o.push(`- Self-prompting: ${(sp.ms / 60_000).toFixed(1)} min in ${sp.runs} loop runs (each \`starting self-prompt loop\` to \`self prompt loop stopped\`${sp.openAtEnd ? '; the last open at the end' : ''}), ${sp.calls} calls with their usage line inside a run, USD ${usd(sp.usd)}${sp.ms ? ` (${(sp.usd / (sp.ms / 3_600_000)).toFixed(4)}/h)` : ''}; outside them ${r.total.calls - sp.calls} calls, USD ${usd(r.total.usd - sp.usd)}.`);
    o.push(`- Providers: ${Object.entries(r.providers).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`);
    return o.join('\n');
}

function main(argv) {
    const usage = () => { console.error('usage: node test/tools/soak-spend.mjs <driver.log> [--result <result.json>] [--json]'); process.exit(2); };
    const json = argv.includes('--json');
    let resultFile = null;
    const files = [];
    for (let k = 0; k < argv.length; k++) {
        if (argv[k] === '--json') continue;
        if (argv[k] === '--result') { resultFile = argv[++k] ?? usage(); continue; }
        files.push(argv[k]);
    }
    if (files.length !== 1) usage();
    let text;
    try { text = fs.readFileSync(files[0], 'utf8'); } catch (err) { console.error(`soak-spend: cannot read ${files[0]}: ${err.code ?? err.message}`); process.exit(2); }
    // The run's result.json: --result, else one next to the driver.log (the evidence folder's layout).
    const beside = path.join(path.dirname(files[0]), 'result.json');
    const rf = resultFile ?? (fs.existsSync(beside) ? beside : null);
    let result = null;
    if (rf) {
        try { result = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch (err) { console.error(`soak-spend: cannot read ${rf}: ${err.code ?? err.message}`); process.exit(2); }
    }
    const r = soakSpend(text, { result });
    if (!r.total.calls) { console.error('soak-spend: no [openrouter] usage line in this file'); process.exit(1); }
    console.log(json ? JSON.stringify(r, null, 2) : render(r));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
