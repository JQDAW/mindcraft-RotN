#!/usr/bin/env node
// Soak journal invariants (lead, 2026-11-25, plan "soak 16 plan (harness-ops)" (a)): read a soak's bot journal
// (driver.log) and count the "invariant breaks", patterns that mark a known class of soak failure, so a new soak
// is compared with the old ones and a trap, a starving run or a death loop shows while the soak still runs.
//
//   node test/tools/soak-invariants.mjs <driver.log | evidence dir> [--server <server.log>] [--json]
//   node test/tools/soak-invariants.mjs --table <dir of evidence dirs> [--json]
//
// Offline, reads files only, prints numbers, times and journal line numbers (no line text beyond short
// quotes of the bot's own log lines). With an evidence dir, server.log next to driver.log is read too
// (I12's server death causes). A partial journal (a soak still running) works the same way.
//
// An invariant whose log line did not exist in the soak's release is "n/a" (null), never 0. The release
// is read from the journal's `[release] rotn-v0.1.N-<sha>` line; soaks before that line (M1, soak 2) count
// as release 0, so only the invariants built on lines every release printed apply to them.
//
// The invariants (thresholds in INVARIANTS; calibrated on the 15 committed soak journals, soaks M1 and 2-15):
//   I1  trapped              path-failure episodes: at least `minAttempts` failed path attempts (`Path not found`,
//                            `Unable to reach`, `NoPath`, `Took to long to decide path`; lines within `attemptGapS`
//                            of each other are one attempt), each within `gapMin` of the last, with no arrival
//                            (`You have reached`, `escape done`, `dug out`, `left the shelter`) or death in between
//                            (#623 review 2: a death loop is not a trap). It understates an enclosed trap: a short
//                            move inside the pocket (`You have reached` 1 block away) ends the episode, so soak 15's
//                            trap (22:41 to 00:01) shows as one 3.4-min episode; I2 shows the rest. Exact once the
//                            path-failure lines carry the bot's position.
//                            Escape episodes (soak 16, the lead; rotn-v0.1.15 on, n/a before): an escape run from its
//                            start (`[escape] trapped at …`, `[escape] stuck at …`, `[night] …: getting out first (escape
//                            N of M)`; a start within `escapeJoinS` of an open episode's last line joins it) to its end:
//                            cleared (`[escape] out at … in S s`, `[night] the escape got out at …`, `[trapped] out:`),
//                            not cleared (`[escape] still stuck at … after S s …: why`, `[night] the escape failed
//                            (why)`, `[trapped] still trapped:`, a death), interrupted (`still stuck … : interrupted`,
//                            stopped by a reflex or a command: escape.js #562 review 5, not a failure by itself), or open
//                            at the journal's end. The caller is named: the trap check, the night routine, !goToSurface,
//                            the morning, the trapped job (#642 `[trapped] at X, idle: the escape runs`), else other.
//                            Trap spans (#648 review 1): the escapes that did not clear, joined while they stay within
//                            `spanCells` (escape.js ESCAPE_HOLD.cells) of the first, from the first one's start until an
//                            escape clears, the bot dies, a position line puts it more than `spanCells` away, or the
//                            journal ends (`open`, which fires: the trap was still on). #642's `[trapped] at X …` re-plan
//                            and give-up lines (`the escape failed N times here …`) count as escapes that did not clear.
//                            An interrupted escape opens a span only if a failed escape or a death follows before an
//                            escape clears or the bot moves away. I1's count is the path-failure episodes plus the trap
//                            spans; `longestMin` is the longest of either. Cleared escapes are listed with their seconds.
//                            The limit (#648 review 2): before rotn-v0.1.22 (#624) !goToSurface was upstream's
//                            goToSurface and logged no `[escape]` line, and the `[trapped]` lines start with #642 (after
//                            rotn-v0.1.22). So soak 15's trap shows only as the path episode above and I2.
//   I2  enclosed-morning     `could not leave the shelter … after N tries` lines; nights spent in the same shelter as
//                            the night before (`in the shelter at X until morning`, X repeated).
//   I3  rejected-click       rejected window clicks: one per `[forge-bridge] click rejected:` line (#618) when the
//                            journal has them, else one per `[inventory] <op>: … Server rejected transaction` line
//                            (the first try and `the second try failed too`; each click logs further copies through
//                            the craft and the agent, which are not counted). #618 logs at most 50 `click rejected:`
//                            lines and then one limit line (`… lines logged; further rejections … are not`), which
//                            is not a click: with it, the count is the larger of the two sources (#623 review 3).
//   I4  dig-refused-with-tool `[forge-bridge] dig refused:` lines (#618) whose rule gives a tool the bot carries a
//                            finite time (a usable tool out of the hand); before #618, Tool Progression refusals
//                            (`needs a better tool`, `dig time for … is Infinity`) while the latest inventory
//                            listing names a pickaxe. n/a before rotn-v0.1.19. The two sources count differently
//                            (#623 review 8): #618's line names where the tool is and is once per block and position;
//                            the older rule only knows a pickaxe was listed, so it counts every refusal it sees.
//                            #625 logs at most 100 `dig refused:` lines per connection, then one limit line (`… lines
//                            logged; further refusals on this connection are not`), which DIG_REFUSED does not match;
//                            it marks I4 as capped: its counts are then lower bounds (`capped`, printed "at least").
//   I5  sunset-food-short    food-for-the-night lines (each sunset, and each night shelter after a respawn) with food
//                            held below the night's need: `held H points, the night needs about N`
//                            with H < N (rotn-v0.1.21 on), `food worth W hunger held, … less than T` (before);
//                            and the sunset food runs with their `+P points`. n/a where no sunset food line exists.
//   I6  starving             food lines at `lowFood` or less, the lowest food, `no safe food` runs longer than
//                            `noSafeFoodMin` with no eat, and `(by starving)` hurt lines.
//   I7  gate-then-act        an act on a mob within `afterS` of a refusal of that mob (`left alone, it may belong to a
//                            player: X`, `Not attacking X`): a hunt started (`[survival] weapon … (hunt)` whose next
//                            hunting line names X; #623 review 1), a `!attack("X")` that ran, a hunting line for X,
//                            or a hit from X. Timed from the first of these. n/a before rotn-v0.1.19.
//   I8  refused-command      model commands refused by design (`newAction not allowed`, an invalid item or block
//                            name, a parameter out of range) and model replies with a command that never ran (no
//                            `parsed command` or `Agent executed: !…` before the next reply).
//   I9  false-collect        `Broke X: … (it gave …)` followed by `Collected 0` within `collectS`; `Broke X` in the
//                            same second as a tool refusal of X. n/a before rotn-v0.1.19.
//   I10 death-loop           at least `minDeaths` deaths, each within `windowMin` and `radius` blocks of the one before.
//   I11 summary-cost         memory summaries (test/tools/soak-spend.mjs's pairing) with more than `bigReasoning`
//                            reasoning tokens, and the summaries' share of the spend.
//   I13-I15                  round 17 M's evidence checks 1-3 (code-built memory, #637): soak-memory-checks.mjs has
//                            their rules. I13 memory-facts: each `[memory] facts` field against the state lines (n/a
//                            with no facts line); I14 wrong-state claims in the model's replies; I15 repeated failures
//                            (the same command and args failing again within 10 min). M4 check 5 is I11's share with
//                            its USD per hour of journal (`usdPerHour`).
//   I12 unattributed-hurt    `(by unknown)` hurt lines; deaths the server puts on a mob (`was slain by`, `was shot
//                            by`) whose last hurt line within `hurtS` before it names no mob (or none came). n/a before
//                            rotn-v0.1.5 (no hurt lines; M1 and soak 2). Deaths pair with server.log's in order; when the
//                            two counts differ the pairing is not trusted: null, with a note (#623 review 4).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseJournal as spendJournal, calls as spendCalls } from './soak-spend.mjs';
import { memoryFactsCheck, wrongClaims, repeatedFailures, serverChat, MEMORY_CHECKS } from './soak-memory-checks.mjs';

export const INVARIANTS = {
    trapped: { minAttempts: 3, gapMin: 10, attemptGapS: 2, escapeJoinS: 30, spanCells: 3 },
    starving: { lowFood: 4, noSafeFoodMin: 5 },
    gateThenAct: { afterS: 60 },
    falseCollect: { collectS: 30 },
    deathLoop: { minDeaths: 3, windowMin: 5, radius: 24 }, // chained: a respawn lands within ±10 of the spawn (soak 10)
    summaryCost: { bigReasoning: 10000 },
    unattributed: { hurtS: 15 },
};

/** The first release (rotn-vX.Y.Z) whose journal has each invariant's lines (#648 review 6: compared in full). */
export const SINCE = { I1escape: '0.1.15', I4: '0.1.19', I7: '0.1.19', I9: '0.1.19', I12: '0.1.5' };

/** Whether the release is at least `since` ('X.Y.Z'); a journal with no release line (M1, soak 2) is none. */
export function releaseAtLeast(rel, since) {
    if (!rel?.version) return false;
    const a = rel.version, b = since.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return true;
}

const JOURNAL = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:[+-]\d\d:\d\d|Z)) \S+?: ?(.*)$/;
const RELEASE = /^\[release\] rotn-v(\d+)\.(\d+)\.(\d+)-/;
const FAIL_PATH = /^(Path not found|Unable to reach|(Error: |Code execution triggered catch: )?NoPath|(Error: )?Timeout: Took to long to decide path)/;
const ARRIVED = /^(You have reached\b|\[respawn\] escape done|\[night\] (morning: )?(dug out|left the shelter)|\[night\] morning: (dug out|left the shelter))/;
const ESCAPE_START = /^(\[escape\] (trapped|stuck) at (-?\d+, -?\d+, -?\d+)|\[night\] .*: getting out first \(escape \d+ of \d+\)$)/;
const ESCAPE_STEP = /^\[escape\] /;
// #642's trapped job (trapped_job.js): its escape run, its re-plan and give-up lines (the bot is still trapped at X), and
// its own result lines after the escape's.
const TRAPPED_RUNS = /^\[trapped\] at -?\d+, -?\d+, -?\d+, idle: the escape runs\b/;
const TRAPPED_STILL_AT = /^\[trapped\] at (-?\d+, -?\d+, -?\d+)(?:, idle, the escape failed \d+ s ago: one re-plan|: the escape failed (\d+) times here\b)/;
const TRAPPED_OUT = /^\[trapped\] out: /;
const TRAPPED_STILL = /^\[trapped\] still trapped: (.*)$/;
const GO_TO_SURFACE = /^parsed command: \{ commandName: '!goToSurface'/;
const MORNING_ESCAPE = /^\[night\] morning: .*climbing out with the escape/;
const ESCAPE_OUT = /^\[escape\] out at (-?\d+, -?\d+, -?\d+) \(([^;]*); dug (\d+), placed (\d+)\) in ([\d.]+) s$/;
const ESCAPE_STUCK = /^\[escape\] still stuck at (-?\d+, -?\d+, -?\d+) after ([\d.]+) s \(dug (\d+), placed (\d+)\): (.*)$/;
const NIGHT_ESCAPE_OUT = /^\[night\] the escape got out at (-?\d+, -?\d+, -?\d+)$/;
const NIGHT_ESCAPE_FAILED = /^\[night\] the escape failed \((.*)\)$/;
const COULD_NOT_LEAVE = /^\[night\] morning: could not leave the shelter at (-?\d+, -?\d+, -?\d+) after \d+ tries/;
const IN_SHELTER = /^\[night\] in the shelter at (-?\d+, -?\d+, -?\d+) until morning$/;
const CLICK_REJECTED = /^\[forge-bridge\] click rejected: /;
const CLICK_LIMIT = /^\[forge-bridge\] click rejected: \d+ lines logged; further rejections/;
const INV_REJECTED = /^\[inventory\] \S+: (the second try failed too: )?(Error: )?Server rejected transaction for clicking on slot (\d+)/;
const DIG_REFUSED = /^\[forge-bridge\] dig refused: (\S+) at (-?\d+, -?\d+, -?\d+)/;
/** #625: once per connection after the 100th refusal line. DIG_REFUSED does not match it; it marks I4 as capped. */
const DIG_LIMIT = /^\[forge-bridge\] dig refused: \d+ lines logged; further refusals/;
const TOOL_REFUSAL = /(\S+) needs a better tool \(Tool Progression\)|dig time for (\S+) is Infinity/;
const INVENTORY = /^INVENTORY$/;
const SUNSET_NEW = /^\[night\] food for the night: food (\d+)(?: \(\+[\d.]+ saturation\))?, held ([\d.]+) points, the night needs about ([\d.]+)/;
const SUNSET_OLD = /^\[night\] food for the night: food worth (\d+) hunger held, food (\d+); (enough|less than)/;
const FOOD_RUN = /^\[night\] the food run ended: \+([\d.]+) points/;
const FOOD_LINE = /^\[survival\] food (\d+) health ([\d.]+)/;
const ATE = /^\[survival\] ate /;
const NO_SAFE_FOOD = /^\[reflex\] eating: food \d+, but no safe food/;
const HURT = /^\[survival\] hurt ([\d.]+) health [\d.]+->([\d.]+) \(by ([^)]*)\)/;
const LEFT_ALONE = /^\[reflex\] hunting: left alone, it may belong to a player: (\S+):/;
const NOT_ATTACKING = /^Not attacking (\S+): /;
const HUNTING = /^\[reflex\] hunting (\S+): /;
const HUNT_START = /^\[survival\] weapon \S+ \(hunt\)$/;
const ATTACK_PARSED = /^parsed command: \{ commandName: '!attack', args: \[ '([^']+)' \] \}/;
const REFUSED_CMD = /newAction not allowed|^(Agent executed: \S+ and got: )?Invalid (item|block) type|Param '\S+' must be/;
const REPLY = /^Generated response: /;
const REPLY_CMD = /![a-zA-Z]+\(/;
const PARSED = /^(parsed command: |Agent executed: !)/;
const BROKE_GAVE = /^Broke (\S+): no (\S+) yet \(it gave /;
const BROKE = /^Broke (\S+): /;
const COLLECTED_0 = /^Collected 0 /;
const DEATH = /^\[death\] died at (-?\d+), (-?\d+), (-?\d+); waiting for the respawn$/;
const SERVER_DEATH = /\]: (<bot>|[A-Za-z0-9_]{3,16}) (was (slain|shot|killed|blown up|pricked|squashed|fireballed|impaled|gored|struck|burnt|stung|pummeled|poked|skewered)\b.*|starved to death|drowned\b.*|died\b.*|fell\b.*|burned to death|went up in flames|tried to swim in lava.*|hit the ground too hard.*|suffocated in a wall|withered away|walked into .*)$/;
const MOB_DEATH = /^was (slain|shot) by /;

const hms = (ms) => new Date(ms).toISOString().slice(11, 19);
const key = (x, y, z) => `${x}, ${y}, ${z}`;

/** [{n (1-based file line), t (ms), msg}] for the journal lines of a driver.log text. */
export function readJournal(text) {
    const out = [];
    String(text).split('\n').forEach((line, i) => {
        const m = JOURNAL.exec(line);
        if (!m) return;
        const t = Date.parse(m[1]);
        if (Number.isFinite(t)) out.push({ n: i + 1, t, msg: m[2].trimEnd() });
    });
    return out;
}

/** The release: its tag, its [major, minor, patch] (`version`) and patch number; none when the journal has no release line. */
export function releaseOf(lines) {
    for (const { msg } of lines) { const m = RELEASE.exec(msg); if (m) return { tag: `rotn-v${m[1]}.${m[2]}.${m[3]}`, version: [Number(m[1]), Number(m[2]), Number(m[3])], patch: Number(m[3]) }; }
    return { tag: null, version: null, patch: 0 };
}

/** The server's death messages for the bot, in order: [{line (1-based), cause}]. */
export function serverDeaths(text) {
    const out = [];
    String(text ?? '').split('\n').forEach((line, i) => {
        const m = SERVER_DEATH.exec(line);
        if (m && /DedicatedServer/.test(line)) out.push({ n: i + 1, cause: m[2] });
    });
    return out;
}

const at = (l) => ({ t: hms(l.t), line: l.n });
const firsts = (list, n = 3) => list.slice(0, n);

// Lines that put the bot at a cell (for a trap span's "moved away"); an escape's own lines are not used.
const BOT_AT = [
    /^You have reached at (-?\d+), (-?\d+), (-?\d+)/,
    /^- Position: x: (-?[\d.]+), y: (-?[\d.]+), z: (-?[\d.]+)/,
    /^\[night\] in the shelter at (-?\d+), (-?\d+), (-?\d+) until morning$/,
    /^Moved away from \(.*?\) to \((-?\d+), (-?\d+), (-?\d+)\)/,
    /^\[respawn\] (?:now .* at|escape done: .* at) (-?\d+), (-?\d+), (-?\d+)/,
];
const cellOf = (m) => `${Math.floor(Number(m[1]))}, ${Math.floor(Number(m[2]))}, ${Math.floor(Number(m[3]))}`;
// null when a cell is not known (#648 re-review: never taken as the same place).
const dist = (a, b) => {
    if (!a || !b) return null;
    const [x1, y1, z1] = a.split(', ').map(Number), [x2, y2, z2] = b.split(', ').map(Number);
    return Math.hypot(x1 - x2, y1 - y2, z1 - z2);
};

/** The escapes as found (journal lines kept), and #642's trapped-job signals. */
function rawEscapes(lines) {
    const p = INVARIANTS.trapped;
    const eps = [];
    const signals = [];
    let cur = null;
    let callerLine = null; // the last !goToSurface, morning-escape or trapped-job line, for `by`
    let lastAt = null; // the last cell a line put the bot at, for an escape whose start names none
    const end = (l, result, extra = {}) => { eps.push({ from: cur.from, end: l, at: cur.at, by: cur.by, result, extra }); cur = null; };
    for (const l of lines) {
        for (const re of BOT_AT) { const m = re.exec(l.msg); if (m) { lastAt = { at: cellOf(m), t: l.t }; break; } }
        if (GO_TO_SURFACE.test(l.msg)) callerLine = { l, by: '!goToSurface' };
        else if (MORNING_ESCAPE.test(l.msg)) callerLine = { l, by: 'morning' };
        else if (TRAPPED_RUNS.test(l.msg)) callerLine = { l, by: 'trapped job' };
        let m;
        if ((m = TRAPPED_STILL_AT.exec(l.msg))) { signals.push({ l, at: m[1], gaveUp: m[2] != null }); continue; }
        const start = ESCAPE_START.exec(l.msg);
        if (start) {
            if (cur && l.t - cur.lastT <= p.escapeJoinS * 1000) { cur.lastT = l.t; cur.last = l; if (!cur.at && start[3]) cur.at = start[3]; continue; }
            if (cur) end(cur.last, 'not cleared', { why: 'no end line before the next escape' });
            const caller = callerLine && l.t - callerLine.l.t <= p.escapeJoinS * 1000 ? callerLine.by : 'other';
            const at0 = start[3] ?? (lastAt && l.t - lastAt.t <= 60_000 ? lastAt.at : null);
            cur = { from: l, lastT: l.t, last: l, at: at0, by: start[2] === 'trapped' ? 'trap check' : start[2] ? caller : 'night' };
            callerLine = null;
            continue;
        }
        if (!cur) continue; // a [night] or [trapped] end line after an [escape] end closed the episode, or a stray step
        if ((m = ESCAPE_OUT.exec(l.msg))) { end(l, 'cleared', { seconds: Number(m[5]), how: m[2], dug: Number(m[3]), placed: Number(m[4]), to: m[1] }); continue; }
        if ((m = ESCAPE_STUCK.exec(l.msg))) {
            // #648 review 3: interrupted (a reflex or a command stopped it: escape.js #562 review 5) is not a failure.
            end(l, /^interrupted\b/.test(m[5]) ? 'interrupted' : 'not cleared', { seconds: Number(m[2]), dug: Number(m[3]), placed: Number(m[4]), why: m[5] });
            continue;
        }
        if ((m = NIGHT_ESCAPE_OUT.exec(l.msg))) { end(l, 'cleared', { to: m[1] }); continue; }
        if ((m = NIGHT_ESCAPE_FAILED.exec(l.msg))) { end(l, 'not cleared', { why: m[1] }); continue; }
        if (TRAPPED_OUT.test(l.msg)) { end(l, 'cleared', {}); continue; }
        if ((m = TRAPPED_STILL.exec(l.msg))) { end(l, /\binterrupted\b/.test(m[1]) ? 'interrupted' : 'not cleared', { why: m[1] }); continue; }
        if (DEATH.test(l.msg)) { end(l, 'not cleared', { why: 'died' }); continue; }
        if (ESCAPE_STEP.test(l.msg)) { cur.lastT = l.t; cur.last = l; }
    }
    if (cur) eps.push({ from: cur.from, end: null, last: cur.last, at: cur.at, by: cur.by, result: 'open', extra: {} });
    return { eps, signals };
}

/**
 * The escape episodes (I1, soak 16): [{t, line, at, by, result: 'cleared'|'not cleared'|'interrupted'|'open', seconds,
 * endLine, how?, why?}]. `by`: 'trap check' (`[escape] trapped`), 'night' (the night routine's `getting out first`),
 * '!goToSurface' (its `parsed command` line within `escapeJoinS` before), 'morning' (`[night] morning: … climbing out
 * with the escape` just before), 'trapped job' (#642's `[trapped] at X, idle: the escape runs`), else 'other'; `at`
 * is the start cell when a line names it (else the last cell a line put the bot at, within 60 s).
 */
export function escapeEpisodes(lines) {
    return rawEscapes(lines).eps.map(e => {
        const lastT = (e.end ?? e.last).t;
        // The escape's own seconds when its end line gives them, else the journal's (whole seconds).
        const seconds = e.extra.seconds ?? Math.round((lastT - e.from.t) / 100) / 10;
        return { t: hms(e.from.t), line: e.from.n, at: e.at, by: e.by, result: e.result, endLine: e.end ? e.end.n : null, ...e.extra, seconds };
    });
}

/**
 * The trap spans (#648 review 1): the escapes that did not clear (and #642's still-trapped lines), joined while they
 * stay within `spanCells` of the span's first cell, until an escape clears, a death, a line puts the bot more than
 * `spanCells` away (outside an escape's own lines), or the journal ends ('open'). An interrupted escape starts a span
 * only if a failed escape, a still-trapped line or a death follows first. [{t, line, at, until, untilLine, minutes,
 * end: 'cleared'|'died'|'moved away'|'open', fails, interrupted, gaveUp}].
 */
export function trapSpans(lines) {
    const cells = INVARIANTS.trapped.spanCells;
    const { eps, signals } = rawEscapes(lines);
    const inEscape = eps.map(e => [e.from.n, (e.end ?? e.last).n]);
    const events = [
        ...eps.map(e => ({ n: (e.end ?? e.from).n, t: (e.end ?? e.from).t, kind: 'esc', e })),
        ...signals.map(s => ({ n: s.l.n, t: s.l.t, kind: 'sig', s })),
    ];
    for (const l of lines) {
        if (DEATH.test(l.msg)) { events.push({ n: l.n, t: l.t, kind: 'death' }); continue; }
        if (inEscape.some(([a, b]) => l.n >= a && l.n <= b)) continue;
        for (const re of BOT_AT) { const m = re.exec(l.msg); if (m) { events.push({ n: l.n, t: l.t, kind: 'pos', at: cellOf(m) }); break; } }
    }
    events.sort((a, b) => a.n - b.n);
    const within = (a, b) => { const d = dist(a, b); return d != null && d <= cells; };
    const spans = [];
    let span = null;
    let pend = null; // interrupted escapes not yet a span
    const close = (ev, why) => { if (span) spans.push({ ...span, until: ev.t, untilLine: ev.n, end: why }); span = null; };
    const fail = (ev, at, fromL, extra = {}) => {
        if (span && within(at, span.at)) { span.fails++; if (extra.gaveUp) span.gaveUp = true; return; }
        // The old span ends where the new escape starts.
        if (span) close({ n: fromL.n, t: fromL.t }, at && span.at ? 'moved away' : 'another escape (a cell not known)');
        const p = pend && within(at, pend.at) ? pend : null;
        span = { fromT: p ? p.fromT : fromL.t, fromN: p ? p.fromN : fromL.n, at: p ? p.at : at, fails: 1, interrupted: p ? p.interrupted : 0, gaveUp: !!extra.gaveUp };
        pend = null;
    };
    for (const ev of events) {
        if (ev.kind === 'esc') {
            const r = ev.e.result;
            if (r === 'cleared') { close(ev, 'cleared'); pend = null; continue; }
            if (r === 'interrupted') {
                if (span && within(ev.e.at, span.at)) span.interrupted++;
                else if (pend && within(ev.e.at, pend.at)) pend.interrupted++;
                else pend = { fromT: ev.e.from.t, fromN: ev.e.from.n, at: ev.e.at, interrupted: 1 };
                continue;
            }
            fail(ev, ev.e.at, ev.e.from); // not cleared, or open at the journal's end
            continue;
        }
        if (ev.kind === 'sig') { fail(ev, ev.s.at, ev.s.l, { gaveUp: ev.s.gaveUp }); continue; }
        if (ev.kind === 'death') {
            if (!span && pend) span = { fromT: pend.fromT, fromN: pend.fromN, at: pend.at, fails: 0, interrupted: pend.interrupted, gaveUp: false };
            pend = null;
            close(ev, 'died');
            continue;
        }
        if (span && span.at && dist(ev.at, span.at) > cells) close(ev, 'moved away');
        if (pend && pend.at && dist(ev.at, pend.at) > cells) pend = null;
    }
    if (span && lines.length) close({ n: lines.at(-1).n, t: lines.at(-1).t }, 'open');
    return spans.map(s => ({ t: hms(s.fromT), line: s.fromN, at: s.at, until: hms(s.until), untilLine: s.untilLine, minutes: Math.round((s.until - s.fromT) / 6000) / 10, end: s.end, fails: s.fails, interrupted: s.interrupted, gaveUp: s.gaveUp }));
}

function trapped(lines, rel) {
    const p = INVARIANTS.trapped;
    const episodes = [];
    let cur = null;
    let lastFailT = -Infinity;
    const close = () => { if (cur && cur.attempts >= p.minAttempts) episodes.push(cur); cur = null; };
    for (const l of lines) {
        if (ARRIVED.test(l.msg) || DEATH.test(l.msg)) { close(); lastFailT = -Infinity; continue; }
        if (!FAIL_PATH.test(l.msg)) continue;
        if (l.t - lastFailT <= p.attemptGapS * 1000) { lastFailT = l.t; continue; } // the same attempt
        if (cur && l.t - cur.lastT > p.gapMin * 60_000) close();
        if (!cur) cur = { from: l, attempts: 0, lastT: l.t, last: l };
        cur.attempts++; cur.lastT = l.t; cur.last = l; lastFailT = l.t;
    }
    close();
    const list = episodes.map(e => ({ ...at(e.from), until: hms(e.last.t), untilLine: e.last.n, attempts: e.attempts, minutes: Math.round((e.last.t - e.from.t) / 6000) / 10 }));
    const pathLongest = list.reduce((m, e) => Math.max(m, e.minutes), 0);
    if (!releaseAtLeast(rel, SINCE.I1escape)) {
        return { count: list.length, pathEpisodes: list.length, attempts: list.reduce((s, e) => s + e.attempts, 0), longestMin: pathLongest, first: firsts(list), trapSpans: null, spanList: null, escapes: null, escapesNotCleared: null, escapesInterrupted: null, escapesCleared: null, longestClearedS: null, escapeList: null };
    }
    const esc = escapeEpisodes(lines);
    const spans = trapSpans(lines);
    const cleared = esc.filter(e => e.result === 'cleared');
    return {
        count: list.length + spans.length, pathEpisodes: list.length, attempts: list.reduce((s, e) => s + e.attempts, 0),
        longestMin: Math.max(pathLongest, spans.reduce((m, s) => Math.max(m, s.minutes), 0)), first: firsts(list),
        trapSpans: spans.length, spanList: spans.slice(0, 5),
        escapes: esc.length, escapesNotCleared: esc.filter(e => e.result === 'not cleared').length, escapesInterrupted: esc.filter(e => e.result === 'interrupted').length,
        escapesCleared: cleared.length, longestClearedS: cleared.reduce((m, e) => Math.max(m, e.seconds), 0), escapeList: esc.slice(0, 20),
    };
}

function enclosedMorning(lines) {
    const couldNot = lines.filter(l => COULD_NOT_LEAVE.test(l.msg));
    const shelters = lines.map(l => ({ l, m: IN_SHELTER.exec(l.msg) })).filter(x => x.m);
    const repeated = [];
    for (let i = 1; i < shelters.length; i++) if (shelters[i].m[1] === shelters[i - 1].m[1]) repeated.push({ ...at(shelters[i].l), shelter: shelters[i].m[1] });
    return { count: couldNot.length, sameShelterNights: repeated.length, first: firsts(couldNot.map(at)), repeated: firsts(repeated) };
}

function rejectedClicks(lines) {
    const limit = lines.some(l => CLICK_LIMIT.test(l.msg));
    const fb = lines.filter(l => CLICK_REJECTED.test(l.msg) && !CLICK_LIMIT.test(l.msg));
    const inv = lines.filter(l => INV_REJECTED.test(l.msg));
    const secondTries = inv.filter(l => /the second try failed too/.test(l.msg)).length;
    const invFirst = firsts(inv.map(l => ({ ...at(l), slot: Number(INV_REJECTED.exec(l.msg)[3]) })));
    if (fb.length && !limit) return { count: fb.length, source: 'click rejected', secondTries: null, first: firsts(fb.map(at)) };
    if (fb.length && fb.length >= inv.length) return { count: fb.length, source: 'click rejected (capped)', secondTries: null, first: firsts(fb.map(at)) };
    return { count: inv.length, source: fb.length ? '[inventory] (click rejected capped)' : '[inventory]', secondTries, first: invFirst };
}

function digRefusedWithTool(lines, rel) {
    if (!releaseAtLeast(rel, SINCE.I4)) return null;
    const fb = lines.filter(l => DIG_REFUSED.test(l.msg)); // DIG_REFUSED needs `<block> at x, y, z`: never the cap line
    const capped = lines.some(l => DIG_LIMIT.test(l.msg));
    if (fb.length || capped) {
        // `rule: held Infinity, <tool> <ms> ms`: a carried tool with a finite time is a usable tool out of the hand.
        const usable = fb.filter(l => /rule: .*?, \S+ \d+ ms/.test(l.msg));
        // Past #625's cap line the refusals are not logged: the counts are then lower bounds ("at least").
        return { count: usable.length, refusals: fb.length, capped, source: capped ? 'dig refused (capped)' : 'dig refused', first: firsts(usable.map(at)) };
    }
    let pickaxeListed = false;
    const out = [];
    let refusals = 0;
    for (let i = 0; i < lines.length; i++) {
        const { msg } = lines[i];
        if (INVENTORY.test(msg)) {
            pickaxeListed = false;
            for (let j = i + 1; j < lines.length && /^- /.test(lines[j].msg); j++) if (/pickaxe/.test(lines[j].msg)) pickaxeListed = true;
            continue;
        }
        if (/^Successfully crafted \S*pickaxe/.test(msg)) { pickaxeListed = true; continue; }
        if (TOOL_REFUSAL.test(msg) && !/^\[forge-bridge\] dig time: /.test(msg)) {
            refusals++;
            if (pickaxeListed) out.push(lines[i]);
        }
    }
    return { count: out.length, refusals, source: 'tool refusal + inventory', first: firsts(out.map(at)) };
}

function sunsetFood(lines) {
    const sunsets = [];
    for (const l of lines) {
        let m = SUNSET_NEW.exec(l.msg);
        if (m) { sunsets.push({ l, food: Number(m[1]), held: Number(m[2]), need: Number(m[3]), short: Number(m[2]) < Number(m[3]) }); continue; }
        m = SUNSET_OLD.exec(l.msg);
        if (m) sunsets.push({ l, food: Number(m[2]), held: Number(m[1]), need: null, short: m[3] === 'less than' });
    }
    if (!sunsets.length) return null;
    const runs = lines.filter(l => FOOD_RUN.test(l.msg)).map(l => ({ ...at(l), points: Number(FOOD_RUN.exec(l.msg)[1]) }));
    const short = sunsets.filter(s => s.short);
    return { count: short.length, nightFoodLines: sunsets.length, foodRuns: runs.length, foodRunPoints: runs.reduce((s, r) => s + r.points, 0), first: firsts(short.map(s => ({ ...at(s.l), food: s.food, held: s.held, ...(s.need == null ? {} : { need: s.need }) }))) };
}

function starving(lines) {
    const p = INVARIANTS.starving;
    const foods = lines.map(l => ({ l, m: FOOD_LINE.exec(l.msg) })).filter(x => x.m).map(x => ({ l: x.l, food: Number(x.m[1]) }));
    const low = foods.filter(f => f.food <= p.lowFood);
    const runs = [];
    let run = null;
    for (const l of lines) {
        if (ATE.test(l.msg)) { if (run && run.last.t - run.from.t > p.noSafeFoodMin * 60_000) runs.push(run); run = null; continue; }
        if (!NO_SAFE_FOOD.test(l.msg)) continue;
        if (!run) run = { from: l, last: l, lines: 0 };
        run.last = l; run.lines++;
    }
    if (run && run.last.t - run.from.t > p.noSafeFoodMin * 60_000) runs.push(run);
    const starvingHurt = lines.filter(l => { const m = HURT.exec(l.msg); return m && m[3] === 'starving'; });
    return {
        count: low.length, lowestFood: foods.length ? Math.min(...foods.map(f => f.food)) : null,
        noSafeFoodRuns: runs.length, longestNoSafeFoodMin: runs.reduce((m, r) => Math.max(m, Math.round((r.last.t - r.from.t) / 6000) / 10), 0),
        starvingHurt: starvingHurt.length, first: firsts(low.map(f => ({ ...at(f.l), food: f.food }))),
    };
}

/**
 * Whether lines[i] is an act on `mob`: a hunt started on it, a !attack on it that ran, a hunting line or a hit.
 * A hunt start's mob is the next hunting line's, looked for by index up to `untilT` and never past the next hunt
 * start (#623 re-review).
 */
function actsOn(lines, i, mob, untilT = Infinity) {
    const { msg } = lines[i];
    if (HUNT_START.test(msg)) {
        for (let j = i + 1; j < lines.length && lines[j].t <= untilT; j++) {
            if (HUNT_START.test(lines[j].msg)) return false;
            const h = HUNTING.exec(lines[j].msg);
            if (h) return h[1] === mob;
        }
        return false;
    }
    const a = ATTACK_PARSED.exec(msg);
    if (a) return a[1] === mob;
    return HUNTING.exec(msg)?.[1] === mob || HURT.exec(msg)?.[3] === mob;
}

function gateThenAct(lines, rel) {
    if (!releaseAtLeast(rel, SINCE.I7)) return null;
    const p = INVARIANTS.gateThenAct;
    const refusals = [];
    for (const l of lines) {
        const m = LEFT_ALONE.exec(l.msg) ?? NOT_ATTACKING.exec(l.msg);
        if (m) refusals.push({ l, mob: m[1] });
    }
    const out = [];
    for (const r of refusals) {
        const untilT = r.l.t + p.afterS * 1000;
        const act = lines.find((l, i) => l.t > r.l.t && l.t <= untilT && actsOn(lines, i, r.mob, untilT));
        if (act) out.push({ ...at(r.l), mob: r.mob, act: hms(act.t), actLine: act.n, afterS: Math.round((act.t - r.l.t) / 1000) });
    }
    return { count: out.length, refusals: refusals.length, first: firsts(out) };
}

function refusedCommands(lines) {
    const refused = lines.filter(l => REFUSED_CMD.test(l.msg));
    const neverRan = [];
    for (let i = 0; i < lines.length; i++) {
        if (!REPLY.test(lines[i].msg) || !REPLY_CMD.test(lines[i].msg)) continue;
        let ran = false;
        for (let j = i + 1; j < lines.length && !REPLY.test(lines[j].msg); j++) if (PARSED.test(lines[j].msg)) { ran = true; break; }
        if (!ran) neverRan.push(lines[i]);
    }
    return { count: refused.length, neverRan: neverRan.length, first: firsts(refused.map(at)), neverRanFirst: firsts(neverRan.map(at)) };
}

function falseCollects(lines, rel) {
    if (!releaseAtLeast(rel, SINCE.I9)) return null;
    const p = INVARIANTS.falseCollect;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (BROKE_GAVE.test(l.msg)) {
            const zero = lines.slice(i + 1).find(x => x.t - l.t <= p.collectS * 1000 && COLLECTED_0.test(x.msg));
            if (zero) { out.push({ ...at(l), kind: 'gave, then Collected 0' }); continue; }
        }
        const b = BROKE.exec(l.msg);
        if (b && lines.some(x => x.t === l.t && x !== l && TOOL_REFUSAL.test(x.msg) && x.msg.includes(b[1]))) out.push({ ...at(l), kind: 'broke and refused in the same second' });
    }
    return { count: out.length, first: firsts(out) };
}

function deathLoops(lines) {
    const p = INVARIANTS.deathLoop;
    const deaths = lines.map(l => ({ l, m: DEATH.exec(l.msg) })).filter(x => x.m).map(x => ({ l: x.l, x: Number(x.m[1]), y: Number(x.m[2]), z: Number(x.m[3]) }));
    const loops = [];
    let i = 0;
    while (i < deaths.length) {
        const a = deaths[i];
        let j = i + 1;
        // Chained: each death within windowMin and radius of the one before it (a respawn point moves the loop by up to ±10).
        while (j < deaths.length && deaths[j].l.t - deaths[j - 1].l.t <= p.windowMin * 60_000 && Math.hypot(deaths[j].x - deaths[j - 1].x, deaths[j].y - deaths[j - 1].y, deaths[j].z - deaths[j - 1].z) <= p.radius) j++;
        if (j - i >= p.minDeaths) { loops.push({ ...at(a.l), place: key(a.x, a.y, a.z), deaths: j - i, until: hms(deaths[j - 1].l.t) }); i = j; } else i++;
    }
    return { count: loops.length, deaths: deaths.length, loopDeaths: loops.reduce((s, x) => s + x.deaths, 0), first: firsts(loops) };
}

function summaryCost(text) {
    const { list } = spendCalls(spendJournal(text));
    const mem = list.filter(c => c.memory);
    const big = mem.filter(c => (c.reasoning ?? 0) > INVARIANTS.summaryCost.bigReasoning);
    const usd = list.reduce((s, c) => s + (c.usd ?? 0), 0);
    const memUsd = mem.reduce((s, c) => s + (c.usd ?? 0), 0);
    // M4 check 5 (the lead's addition): the absolute spend too, per hour of journal.
    const lines = readJournal(text);
    const hours = lines.length > 1 ? (lines.at(-1).t - lines[0].t) / 3_600_000 : 0;
    const skipped = lines.filter(l => /^\[memory\] summary skipped \(no player turn\)/.test(l.msg)).length;
    return {
        count: big.length, summaries: mem.length, maxReasoning: mem.reduce((m, c) => Math.max(m, c.reasoning ?? 0), 0), share: usd ? Math.round(1000 * memUsd / usd) / 10 : null,
        usd: Math.round(usd * 1e6) / 1e6, usdPerHour: hours ? Math.round(1e5 * usd / hours) / 1e5 : null, skipped, first: firsts(big.map(c => ({ t: hms(c.t), reasoning: c.reasoning }))),
    };
}

function unattributed(lines, serverText, rel) {
    if (!releaseAtLeast(rel, SINCE.I12)) return null;
    const p = INVARIANTS.unattributed;
    const unknown = lines.filter(l => HURT.exec(l.msg)?.[3] === 'unknown');
    const deaths = lines.filter(l => DEATH.test(l.msg));
    let deathsUnnamed = null;
    const firstDeaths = [];
    if (serverText != null) {
        const sd = serverDeaths(serverText);
        if (sd.length !== deaths.length) return { count: unknown.length, deathsUnnamed: null, note: `death counts differ: journal ${deaths.length}, server.log ${sd.length}`, first: firsts(unknown.map(at)), deathsFirst: [] };
        deathsUnnamed = 0;
        deaths.forEach((d, k) => {
            const cause = sd[k]?.cause;
            if (!cause || !MOB_DEATH.test(cause)) return;
            const hurts = lines.filter(l => l.t <= d.t && d.t - l.t <= p.hurtS * 1000 && HURT.test(l.msg));
            const last = hurts.at(-1);
            const named = last && !['unknown', 'starving', 'fall'].includes(HURT.exec(last.msg)[3]);
            if (!named) { deathsUnnamed++; firstDeaths.push({ ...at(d), server: cause, serverLine: sd[k].n }); }
        });
    }
    return { count: unknown.length, deathsUnnamed, first: firsts(unknown.map(at)), deathsFirst: firsts(firstDeaths) };
}

/** Every invariant of one journal (and its server.log text, or null). */
export function soakInvariants(text, { serverText = null } = {}) {
    const lines = readJournal(text);
    const rel = releaseOf(lines);
    return {
        release: rel.tag, from: lines[0] ? hms(lines[0].t) : null, to: lines.at(-1) ? hms(lines.at(-1).t) : null, lines: lines.length,
        I1: trapped(lines, rel),
        I2: enclosedMorning(lines),
        I3: rejectedClicks(lines),
        I4: digRefusedWithTool(lines, rel),
        I5: sunsetFood(lines),
        I6: starving(lines),
        I7: gateThenAct(lines, rel),
        I8: refusedCommands(lines),
        I9: falseCollects(lines, rel),
        I10: deathLoops(lines),
        I11: summaryCost(text),
        I12: unattributed(lines, serverText, rel),
        ...(() => {
            const chat = serverChat(serverText, lines[0]?.t);
            return { I13: memoryFactsCheck(lines, chat), I14: wrongClaims(lines, chat), I15: repeatedFailures(lines) };
        })(),
    };
}

/** The baseline row: the counts only (null = n/a). */
export function baselineRow(r) {
    const c = (x, k = 'count') => (x == null ? null : x[k]);
    return {
        release: r.release,
        I1_trapped: c(r.I1), I1_longestMin: c(r.I1, 'longestMin'), I1_escapes: c(r.I1, 'escapes'), I1_escapesNotCleared: c(r.I1, 'escapesNotCleared'),
        I2_couldNotLeave: c(r.I2), I2_sameShelterNights: c(r.I2, 'sameShelterNights'),
        I3_rejectedClicks: c(r.I3),
        I4_digRefusedWithTool: c(r.I4), I4_refusals: c(r.I4, 'refusals'), I4_capped: r.I4 == null ? null : !!r.I4.capped,
        I5_nightFoodShort: c(r.I5), I5_nightFoodLines: c(r.I5, 'nightFoodLines'), I5_foodRuns: c(r.I5, 'foodRuns'),
        I6_lowFoodLines: c(r.I6), I6_lowestFood: c(r.I6, 'lowestFood'), I6_noSafeFoodRuns: c(r.I6, 'noSafeFoodRuns'), I6_starvingHurt: c(r.I6, 'starvingHurt'),
        I7_gateThenAct: c(r.I7), I7_refusals: c(r.I7, 'refusals'),
        I8_refusedCommands: c(r.I8), I8_neverRan: c(r.I8, 'neverRan'),
        I9_falseCollects: c(r.I9),
        I10_deathLoops: c(r.I10), I10_deaths: c(r.I10, 'deaths'), I10_loopDeaths: c(r.I10, 'loopDeaths'),
        I11_bigSummaries: c(r.I11), I11_summaries: c(r.I11, 'summaries'), I11_shareOfSpend: c(r.I11, 'share'),
        I12_unknownHurt: c(r.I12), I12_deathsUnnamed: c(r.I12, 'deathsUnnamed'),
        I11_usdPerHour: c(r.I11, 'usdPerHour'),
        I13_factsLines: c(r.I13, 'factsLines'), I13_misses: c(r.I13, 'misses'), I13_fields: c(r.I13, 'fields'),
        I14_claims: c(r.I14, 'claims'), I14_wrong: c(r.I14, 'wrong'), I14_unverifiable: c(r.I14, 'unverifiable'),
        I15_repeats: c(r.I15), I15_perHour: c(r.I15, 'perHour'), I15_inMemory: c(r.I15, 'inMemory'),
    };
}

/** The soak evidence dirs under `dir` (g4soak-*), each with its driver.log, in soak order (M1 first). */
export function evidenceDirs(dir) {
    const order = (n) => { const m = /^g4soak-(m?\d+)-/.exec(n); if (!m) return Infinity; return m[1].startsWith('m') ? -1 : Number(m[1]); };
    return fs.readdirSync(dir).filter(n => /^g4soak-/.test(n) && fs.existsSync(path.join(dir, n, 'driver.log'))).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}

/** Every soak under `dir`: { name: row }. */
export function table(dir) {
    const out = {};
    for (const n of evidenceDirs(dir)) {
        const d = path.join(dir, n);
        const server = path.join(d, 'server.log');
        out[n] = baselineRow(soakInvariants(fs.readFileSync(path.join(d, 'driver.log'), 'utf8'), { serverText: fs.existsSync(server) ? fs.readFileSync(server, 'utf8') : null }));
    }
    return out;
}

const cell = (v) => (v == null ? 'n/a' : String(v));

/** One soak, as text. */
export function render(r, name = 'soak') {
    const o = [`${name}: ${r.release ?? 'release line absent'}, journal ${r.from}–${r.to} (${r.lines} lines). n/a = the release did not print that line.`];
    const row = (id, title, x, detail) => {
        if (x == null) { o.push(`- ${id} ${title}: n/a`); return; }
        o.push(`- ${id} ${title}: ${detail}`);
        for (const f of x.first ?? []) o.push(`    ${f.t}${f.line ? ` (driver.log:${f.line})` : ''}${Object.entries(f).filter(([k]) => !['t', 'line'].includes(k)).map(([k, v]) => ` ${k} ${v}`).join('')}`);
    };
    row('I1', 'trapped', r.I1, `${r.I1.count} (${r.I1.pathEpisodes} path-failure episodes, ${r.I1.attempts} failed path attempts; `
        + (r.I1.escapes == null ? 'escapes n/a' : `${r.I1.trapSpans} trap spans; ${r.I1.escapes} escape episodes: ${r.I1.escapesNotCleared} not cleared, ${r.I1.escapesInterrupted} interrupted, ${r.I1.escapesCleared} cleared, the longest cleared in ${r.I1.longestClearedS} s`)
        + `; longest ${r.I1.longestMin} min)`);
    for (const s of r.I1.spanList ?? []) {
        o.push(`    trap span ${s.t} (driver.log:${s.line}) at ${s.at ?? '?'} until ${s.until} (driver.log:${s.untilLine}), ${s.minutes} min, ended: ${s.end}${s.end === 'open' ? ' (still trapped at the journal\'s end)' : ''}; ${s.fails} escapes not cleared, ${s.interrupted} interrupted${s.gaveUp ? ', the trapped job gave up' : ''}`);
    }
    for (const e of r.I1.escapeList ?? []) {
        const how = e.result === 'cleared' ? (e.to ? ` to ${e.to}${e.how ? ` (${e.how}; dug ${e.dug}, placed ${e.placed})` : ''}` : '') : e.why ? `: ${e.why}` : '';
        o.push(`    escape ${e.t} (driver.log:${e.line})${e.at ? ` at ${e.at}` : ''} by ${e.by}: ${e.result} in ${e.seconds} s${how}${e.endLine ? ` (driver.log:${e.endLine})` : ''}`);
    }
    row('I2', 'enclosed-morning', r.I2, `${r.I2.count} "could not leave the shelter", ${r.I2.sameShelterNights} nights in the same shelter as the night before`);
    row('I3', 'rejected-click', r.I3, `${r.I3.count} rejected clicks (from ${r.I3.source}${r.I3.secondTries != null ? `; ${r.I3.secondTries} second tries failed too` : ''})`);
    row('I4', 'dig-refused-with-tool', r.I4, r.I4 && `${r.I4.capped ? 'at least ' : ''}${r.I4.count} of ${r.I4.capped ? 'at least ' : ''}${r.I4.refusals} tool refusals with a usable tool carried (${r.I4.source}${r.I4.capped ? '; refusals past the cap line are not logged' : ''})`);
    row('I5', 'sunset-food-short', r.I5, r.I5 && `${r.I5.count} of ${r.I5.nightFoodLines} food-for-the-night lines short of the night's need; ${r.I5.foodRuns} sunset food runs (+${r.I5.foodRunPoints} points)`);
    row('I6', 'starving', r.I6, `${r.I6.count} food lines at ${INVARIANTS.starving.lowFood} or less (lowest ${cell(r.I6.lowestFood)}), ${r.I6.noSafeFoodRuns} "no safe food" runs over ${INVARIANTS.starving.noSafeFoodMin} min (longest ${r.I6.longestNoSafeFoodMin} min), ${r.I6.starvingHurt} starving hurt lines`);
    row('I7', 'gate-then-act', r.I7, r.I7 && `${r.I7.count} of ${r.I7.refusals} refusals followed by an act on that mob (a hunt started, a !attack that ran, a hunting line or a hit) within ${INVARIANTS.gateThenAct.afterS} s`);
    row('I8', 'refused-command', r.I8, `${r.I8.count} commands refused by design, ${r.I8.neverRan} replies with a command that never ran`);
    for (const f of r.I8.neverRanFirst ?? []) o.push(`    never ran: ${f.t} (driver.log:${f.line})`);
    row('I9', 'false-collect', r.I9, r.I9 && `${r.I9.count} false "Broke …" lines`);
    row('I10', 'death-loop', r.I10, `${r.I10.count} loops (${r.I10.loopDeaths} of ${r.I10.deaths} deaths)`);
    row('I11', 'summary-cost', r.I11, `${r.I11.count} of ${r.I11.summaries} memory summaries over ${INVARIANTS.summaryCost.bigReasoning} reasoning tokens (max ${r.I11.maxReasoning}); summaries ${cell(r.I11.share)}% of the spend`);
    o.push(`    M4 check 5: summaries ${cell(r.I11.share)}% of USD ${r.I11.usd} (USD ${cell(r.I11.usdPerHour)}/h of journal); ${r.I11.skipped} chunks cut with no summary call`);
    row('I12', 'unattributed-hurt', r.I12, r.I12 && `${r.I12.count} "(by unknown)" hurt lines; ${cell(r.I12.deathsUnnamed)} deaths by a mob with no mob named before them${r.I12.deathsUnnamed == null ? ` (${r.I12.note ?? 'no server.log'})` : ''}`);
    for (const d of r.I12?.deathsFirst ?? []) o.push(`    death ${d.t} (driver.log:${d.line}), server: ${d.server} (server.log:${d.serverLine})`);
    row('I13', 'memory-facts', r.I13, r.I13 && `${r.I13.misses} of ${r.I13.fields} verifiable fields wrong in ${r.I13.factsLines} facts lines (${cell(r.I13.share)}% match; ${r.I13.unverifiable} unverifiable); ${Object.entries(r.I13.byField).map(([k, v]) => `${k} ${v.match}/${v.miss}/${v.unverifiable}`).join(', ')} (match/miss/unverifiable)`);
    for (const m of r.I13?.missesFirst ?? []) o.push(`    miss ${m.t} (driver.log:${m.line}) ${m.field}: said ${m.said}, state ${m.state ?? '?'}`);
    row('I14', 'wrong-state claims', r.I14, `${r.I14.wrong} of ${r.I14.claims} claims wrong (${r.I14.unverifiable} unverifiable) in ${r.I14.claimReplies} of ${r.I14.replies} replies; y ${r.I14.byKind.y.join('/')}, count ${r.I14.byKind.count.join('/')}, step ${r.I14.byKind.step.join('/')} (right/wrong/unverifiable)`);
    for (const w of r.I14.wrongFirst) o.push(`    wrong ${w.t} (driver.log:${w.line}) ${w.kind}: said ${w.said}, state ${w.state ?? '?'}`);
    o.push(`    hand-check sample (${r.I14.handSample.length}): ${r.I14.handSample.map(h => h.line).join(', ') || '–'}`);
    row('I15', 'repeated failures', r.I15, `${r.I15.count} repeats within ${MEMORY_CHECKS.repeatMin} min of the same failure (${cell(r.I15.perHour)}/h; ${r.I15.inMemory} after a facts line named it) of ${r.I15.failures} failed commands; within 30 min ${r.I15.within30}, within 60 min ${r.I15.within60}`);
    return o.join('\n');
}

const COLS = [['I1_trapped', 'I1 trap'], ['I1_longestMin', 'min'], ['I1_escapes', 'esc'], ['I1_escapesNotCleared', 'esc fail'], ['I2_couldNotLeave', 'I2'], ['I3_rejectedClicks', 'I3 clicks'], ['I4_digRefusedWithTool', 'I4'], ['I5_nightFoodShort', 'I5 short'], ['I5_nightFoodLines', 'night food'], ['I6_lowestFood', 'I6 low'], ['I6_noSafeFoodRuns', 'nsf runs'], ['I7_gateThenAct', 'I7'], ['I8_refusedCommands', 'I8'], ['I8_neverRan', 'never ran'], ['I9_falseCollects', 'I9'], ['I10_deathLoops', 'I10 loops'], ['I10_deaths', 'deaths'], ['I11_bigSummaries', 'I11 big'], ['I11_shareOfSpend', 'sum %'], ['I12_unknownHurt', 'I12 unk'], ['I12_deathsUnnamed', 'unnamed'], ['I11_usdPerHour', 'USD/h'], ['I13_misses', 'M1 miss'], ['I14_claims', 'M2 claims'], ['I14_wrong', 'M2 wrong'], ['I15_repeats', 'M3 rep'], ['I15_perHour', 'M3 /h']];

/** The table across soaks, as Markdown. */
export function renderTable(rows) {
    const o = [`| Soak | Release | ${COLS.map(c => c[1]).join(' | ')} |`, `| --- | --- | ${COLS.map(() => '---').join(' | ')} |`];
    // A capped I4 (#625) is a lower bound: printed ≥N.
    const value = (r, k) => (k === 'I4_digRefusedWithTool' && r.I4_capped ? `≥${r[k]}` : cell(r[k]));
    for (const [n, r] of Object.entries(rows)) o.push(`| ${n.replace(/^g4soak-/, '')} | ${r.release ?? '–'} | ${COLS.map(c => value(r, c[0])).join(' | ')} |`);
    return o.join('\n');
}

function main(argv) {
    const usage = () => { console.error('usage: node test/tools/soak-invariants.mjs <driver.log | evidence dir> [--server <server.log>] [--json]\n       node test/tools/soak-invariants.mjs --table <dir of evidence dirs> [--json]'); process.exit(2); };
    const json = argv.includes('--json');
    const args = argv.filter(a => a !== '--json');
    const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (err) { console.error(`soak-invariants: cannot read ${f}: ${err.code ?? err.message}`); process.exit(2); } return null; };
    if (args[0] === '--table') {
        if (args.length !== 2) usage();
        let rows;
        try { rows = table(args[1]); } catch (err) { console.error(`soak-invariants: cannot read ${args[1]}: ${err.code ?? err.message}`); process.exit(2); }
        console.log(json ? JSON.stringify(rows, null, 2) : renderTable(rows));
        return;
    }
    let target = null;
    let serverFile = null;
    for (let k = 0; k < args.length; k++) {
        if (args[k] === '--server') { serverFile = args[++k] ?? usage(); continue; }
        if (target) usage();
        target = args[k];
    }
    if (!target) usage();
    let journal = target;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        journal = path.join(target, 'driver.log');
        if (!serverFile && fs.existsSync(path.join(target, 'server.log'))) serverFile = path.join(target, 'server.log');
    }
    const text = read(journal);
    const r = soakInvariants(text, { serverText: serverFile ? read(serverFile) : null });
    if (!r.lines) { console.error('soak-invariants: no journal line in this file'); process.exit(1); }
    console.log(json ? JSON.stringify(r, null, 2) : render(r, path.basename(fs.statSync(target).isDirectory() ? target : path.dirname(target))));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
