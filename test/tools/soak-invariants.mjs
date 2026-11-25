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
//   I12 unattributed-hurt    `(by unknown)` hurt lines; deaths the server puts on a mob (`was slain by`, `was shot
//                            by`) whose last hurt line within `hurtS` before it names no mob (or none came). n/a before
//                            rotn-v0.1.5 (no hurt lines; M1 and soak 2). Deaths pair with server.log's in order; when the
//                            two counts differ the pairing is not trusted: null, with a note (#623 review 4).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseJournal as spendJournal, calls as spendCalls } from './soak-spend.mjs';

export const INVARIANTS = {
    trapped: { minAttempts: 3, gapMin: 10, attemptGapS: 2 },
    starving: { lowFood: 4, noSafeFoodMin: 5 },
    gateThenAct: { afterS: 60 },
    falseCollect: { collectS: 30 },
    deathLoop: { minDeaths: 3, windowMin: 5, radius: 24 }, // chained: a respawn lands within ±10 of the spawn (soak 10)
    summaryCost: { bigReasoning: 10000 },
    unattributed: { hurtS: 15 },
};

/** The first release (rotn-v0.1.N) whose journal has each invariant's lines. */
export const SINCE = { I4: 19, I7: 19, I9: 19, I12: 5 };

const JOURNAL = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:[+-]\d\d:\d\d|Z)) \S+?: ?(.*)$/;
const RELEASE = /^\[release\] rotn-v(\d+)\.(\d+)\.(\d+)-/;
const FAIL_PATH = /^(Path not found|Unable to reach|(Error: |Code execution triggered catch: )?NoPath|(Error: )?Timeout: Took to long to decide path)/;
const ARRIVED = /^(You have reached\b|\[respawn\] escape done|\[night\] (morning: )?(dug out|left the shelter)|\[night\] morning: (dug out|left the shelter))/;
const COULD_NOT_LEAVE = /^\[night\] morning: could not leave the shelter at (-?\d+, -?\d+, -?\d+) after \d+ tries/;
const IN_SHELTER = /^\[night\] in the shelter at (-?\d+, -?\d+, -?\d+) until morning$/;
const CLICK_REJECTED = /^\[forge-bridge\] click rejected: /;
const CLICK_LIMIT = /^\[forge-bridge\] click rejected: \d+ lines logged; further rejections/;
const INV_REJECTED = /^\[inventory\] \S+: (the second try failed too: )?(Error: )?Server rejected transaction for clicking on slot (\d+)/;
const DIG_REFUSED = /^\[forge-bridge\] dig refused: (\S+) at (-?\d+, -?\d+, -?\d+)/;
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

/** The release's patch number (rotn-v0.1.N -> N), or 0 when the journal has no release line. */
export function releaseOf(lines) {
    for (const { msg } of lines) { const m = RELEASE.exec(msg); if (m) return { tag: `rotn-v${m[1]}.${m[2]}.${m[3]}`, patch: Number(m[3]) }; }
    return { tag: null, patch: 0 };
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

function trapped(lines) {
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
    return { count: list.length, attempts: list.reduce((s, e) => s + e.attempts, 0), longestMin: list.reduce((m, e) => Math.max(m, e.minutes), 0), first: firsts(list) };
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
    if (rel.patch < SINCE.I4) return null;
    const fb = lines.filter(l => DIG_REFUSED.test(l.msg));
    if (fb.length) {
        // `rule: held Infinity, <tool> <ms> ms`: a carried tool with a finite time is a usable tool out of the hand.
        const usable = fb.filter(l => /rule: .*?, \S+ \d+ ms/.test(l.msg));
        return { count: usable.length, refusals: fb.length, source: 'dig refused', first: firsts(usable.map(at)) };
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

/** Whether lines[i] is an act on `mob`: a hunt started on it, a !attack on it that ran, a hunting line or a hit. */
function actsOn(lines, i, mob) {
    const { msg } = lines[i];
    if (HUNT_START.test(msg)) return lines.slice(i + 1).find(x => HUNTING.test(x.msg))?.msg.match(HUNTING)[1] === mob;
    const a = ATTACK_PARSED.exec(msg);
    if (a) return a[1] === mob;
    return HUNTING.exec(msg)?.[1] === mob || HURT.exec(msg)?.[3] === mob;
}

function gateThenAct(lines, rel) {
    if (rel.patch < SINCE.I7) return null;
    const p = INVARIANTS.gateThenAct;
    const refusals = [];
    for (const l of lines) {
        const m = LEFT_ALONE.exec(l.msg) ?? NOT_ATTACKING.exec(l.msg);
        if (m) refusals.push({ l, mob: m[1] });
    }
    const out = [];
    for (const r of refusals) {
        const act = lines.find((l, i) => l.t > r.l.t && l.t - r.l.t <= p.afterS * 1000 && actsOn(lines, i, r.mob));
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
    if (rel.patch < SINCE.I9) return null;
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
    return { count: big.length, summaries: mem.length, maxReasoning: mem.reduce((m, c) => Math.max(m, c.reasoning ?? 0), 0), share: usd ? Math.round(1000 * memUsd / usd) / 10 : null, first: firsts(big.map(c => ({ t: hms(c.t), reasoning: c.reasoning }))) };
}

function unattributed(lines, serverText, rel) {
    if (rel.patch < SINCE.I12) return null;
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
        I1: trapped(lines),
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
    };
}

/** The baseline row: the counts only (null = n/a). */
export function baselineRow(r) {
    const c = (x, k = 'count') => (x == null ? null : x[k]);
    return {
        release: r.release,
        I1_trapped: c(r.I1), I1_longestMin: c(r.I1, 'longestMin'),
        I2_couldNotLeave: c(r.I2), I2_sameShelterNights: c(r.I2, 'sameShelterNights'),
        I3_rejectedClicks: c(r.I3),
        I4_digRefusedWithTool: c(r.I4), I4_refusals: c(r.I4, 'refusals'),
        I5_nightFoodShort: c(r.I5), I5_nightFoodLines: c(r.I5, 'nightFoodLines'), I5_foodRuns: c(r.I5, 'foodRuns'),
        I6_lowFoodLines: c(r.I6), I6_lowestFood: c(r.I6, 'lowestFood'), I6_noSafeFoodRuns: c(r.I6, 'noSafeFoodRuns'), I6_starvingHurt: c(r.I6, 'starvingHurt'),
        I7_gateThenAct: c(r.I7), I7_refusals: c(r.I7, 'refusals'),
        I8_refusedCommands: c(r.I8), I8_neverRan: c(r.I8, 'neverRan'),
        I9_falseCollects: c(r.I9),
        I10_deathLoops: c(r.I10), I10_deaths: c(r.I10, 'deaths'), I10_loopDeaths: c(r.I10, 'loopDeaths'),
        I11_bigSummaries: c(r.I11), I11_summaries: c(r.I11, 'summaries'), I11_shareOfSpend: c(r.I11, 'share'),
        I12_unknownHurt: c(r.I12), I12_deathsUnnamed: c(r.I12, 'deathsUnnamed'),
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
    row('I1', 'trapped', r.I1, `${r.I1.count} episodes, ${r.I1.attempts} failed path attempts, longest ${r.I1.longestMin} min`);
    row('I2', 'enclosed-morning', r.I2, `${r.I2.count} "could not leave the shelter", ${r.I2.sameShelterNights} nights in the same shelter as the night before`);
    row('I3', 'rejected-click', r.I3, `${r.I3.count} rejected clicks (from ${r.I3.source}${r.I3.secondTries != null ? `; ${r.I3.secondTries} second tries failed too` : ''})`);
    row('I4', 'dig-refused-with-tool', r.I4, r.I4 && `${r.I4.count} of ${r.I4.refusals} tool refusals with a usable tool carried (${r.I4.source})`);
    row('I5', 'sunset-food-short', r.I5, r.I5 && `${r.I5.count} of ${r.I5.nightFoodLines} food-for-the-night lines short of the night's need; ${r.I5.foodRuns} sunset food runs (+${r.I5.foodRunPoints} points)`);
    row('I6', 'starving', r.I6, `${r.I6.count} food lines at ${INVARIANTS.starving.lowFood} or less (lowest ${cell(r.I6.lowestFood)}), ${r.I6.noSafeFoodRuns} "no safe food" runs over ${INVARIANTS.starving.noSafeFoodMin} min (longest ${r.I6.longestNoSafeFoodMin} min), ${r.I6.starvingHurt} starving hurt lines`);
    row('I7', 'gate-then-act', r.I7, r.I7 && `${r.I7.count} of ${r.I7.refusals} refusals followed by an act on that mob (a hunt started, a !attack that ran, a hunting line or a hit) within ${INVARIANTS.gateThenAct.afterS} s`);
    row('I8', 'refused-command', r.I8, `${r.I8.count} commands refused by design, ${r.I8.neverRan} replies with a command that never ran`);
    for (const f of r.I8.neverRanFirst ?? []) o.push(`    never ran: ${f.t} (driver.log:${f.line})`);
    row('I9', 'false-collect', r.I9, r.I9 && `${r.I9.count} false "Broke …" lines`);
    row('I10', 'death-loop', r.I10, `${r.I10.count} loops (${r.I10.loopDeaths} of ${r.I10.deaths} deaths)`);
    row('I11', 'summary-cost', r.I11, `${r.I11.count} of ${r.I11.summaries} memory summaries over ${INVARIANTS.summaryCost.bigReasoning} reasoning tokens (max ${r.I11.maxReasoning}); summaries ${cell(r.I11.share)}% of the spend`);
    row('I12', 'unattributed-hurt', r.I12, r.I12 && `${r.I12.count} "(by unknown)" hurt lines; ${cell(r.I12.deathsUnnamed)} deaths by a mob with no mob named before them${r.I12.deathsUnnamed == null ? ` (${r.I12.note ?? 'no server.log'})` : ''}`);
    for (const d of r.I12?.deathsFirst ?? []) o.push(`    death ${d.t} (driver.log:${d.line}), server: ${d.server} (server.log:${d.serverLine})`);
    return o.join('\n');
}

const COLS = [['I1_trapped', 'I1 trap'], ['I1_longestMin', 'min'], ['I2_couldNotLeave', 'I2'], ['I3_rejectedClicks', 'I3 clicks'], ['I4_digRefusedWithTool', 'I4'], ['I5_nightFoodShort', 'I5 short'], ['I5_nightFoodLines', 'night food'], ['I6_lowestFood', 'I6 low'], ['I6_noSafeFoodRuns', 'nsf runs'], ['I7_gateThenAct', 'I7'], ['I8_refusedCommands', 'I8'], ['I8_neverRan', 'never ran'], ['I9_falseCollects', 'I9'], ['I10_deathLoops', 'I10 loops'], ['I10_deaths', 'deaths'], ['I11_bigSummaries', 'I11 big'], ['I11_shareOfSpend', 'sum %'], ['I12_unknownHurt', 'I12 unk'], ['I12_deathsUnnamed', 'unnamed']];

/** The table across soaks, as Markdown. */
export function renderTable(rows) {
    const o = [`| Soak | Release | ${COLS.map(c => c[1]).join(' | ')} |`, `| --- | --- | ${COLS.map(() => '---').join(' | ')} |`];
    for (const [n, r] of Object.entries(rows)) o.push(`| ${n.replace(/^g4soak-/, '')} | ${r.release ?? '–'} | ${COLS.map(c => cell(r[c[0]])).join(' | ')} |`);
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
