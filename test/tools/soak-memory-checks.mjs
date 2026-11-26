// Round 17 M (code-built memory, #637), the plan's M4 evidence checks 1-3, for soak-invariants.mjs (I13-I15).
// Each check reads the bot's journal (driver.log; readJournal's lines) and, where it helps, the test server's log
// (the agenda's chat lines). Offline, reads files only. #637's PR body has the line formats.
//
//   I13 memory-facts (M4 check 1)  every `[memory] facts <n> chars: <text>` line (its lines joined by " / "), field by
//       field, against the code's own state lines within `windowS` (either side): the agenda step (the self-prompt
//       goal `RotN agenda, step N of M (<id>)`, `!agenda` replies, the server's `agenda step <id> started|done`), the
//       deaths (`[death] died at X; waiting for the respawn` lines so far, the last one's cell), the last shelter
//       (`[night] in the shelter at X until morning`), the pickaxe (`[shelter] pickaxe check: … inventory: …`,
//       `dig refused: … pickaxe tools: …`), the food held (`[night] food for the night: … held H points`), the shelter
//       blocks (the server's `shelter_blocks: the scripted job ended: … (N of 14`), each failure (a command with those
//       args that ran and failed around `<n> min ago`) and each collect (`Collected N <item>` around its time). A
//       field is a match, a miss, or unverifiable (no state line in the window). n/a with no facts line (the
//       summary mode, or a release before #637). The check passes at 100% of the verifiable fields.
//   I14 wrong-state claims (M4 check 2)  model replies (`Generated response:`) that state the bot's y (`y=60`, `at y
//       57`), a count it holds (`I have 13 cobble`, `got 6 sticks`) or a step done (`step 9 done`, `steps 1-9
//       done`), each against the state within `windowS`: a position line (y within `yTolerance`), the latest
//       inventory listing or `you now have N <item>` line before it (a count; an item the source does not name is
//       unverifiable), the agenda's done steps by `windowS` after the reply (the server's `agenda step <id> done` /
//       `agenda done` lines and `!agenda` replies; step numbers from the goal lines). Also a fixed sample of up to
//       `handSample` claim replies for the plan's hand check (every k-th, so the same journal gives the same sample).
//   I15 repeated failures (M4 check 3)  a command (name and args) whose output failed (memory_facts.js looksFailed,
//       the same test the memory uses) that fails again within `repeatMin`; with a `[memory] facts` line naming the
//       command between the two (`inMemory`: the first failure was in the memory). Per hour of journal.
import { looksFailed } from '../../src/agent/memory_facts.js';
import { ROTN_EARLY_GAME } from '../../src/agent/agenda.js';

// The numbered agenda steps (`step N of 11`), the same order in every release since rotn-v0.1.5; a goal line naming a
// number wins over this.
const STEP_IDS = ROTN_EARLY_GAME.map(s => s.id);
const KNOWN_IDS = new Set([...STEP_IDS, 'shelter_blocks', 'weapon', 'food']);

export const MEMORY_CHECKS = { windowS: 30, yTolerance: 2, repeatMin: 10, handSample: 20 };

const hms = (ms) => new Date(ms).toISOString().slice(11, 19);
const C3 = '(-?\\d+), (-?\\d+), (-?\\d+)';
const FACTS = /^\[memory\] facts \d+ chars: (.*)$/;
const DEATH = new RegExp(`^\\[death\\] died at ${C3}; waiting for the respawn$`);
const IN_SHELTER = new RegExp(`^\\[night\\] in the shelter at ${C3} until morning$`);
const PICK_CHECK = /^\[shelter\] pickaxe check: .*?; inventory: ([^;]+);/;
const DIG_PICKS = /^\[forge-bridge\] dig refused: .*; pickaxe tools: ([^;]+?)(;|$)/;
const NIGHT_FOOD = /^\[night\] food for the night: .*?held ([\d.]+) points/;
const GOAL = /RotN agenda, step (?:(\d+) of \d+ \(([^)]+)\)|([a-z_]+) \(([^)]+)\))/;
const STANDING = /Standing goal \(the agenda is done\)/;
const AGENDA_REPLY = /^Agent executed: !agenda and got: agenda: (active, step (\S+) .*?(?:; done: (.*))?|done\b.*)$/;
const REPLY = /^Generated response: (.*)$/;
const PARSED_ONE = /^parsed command: \{ commandName: '(![A-Za-z]+)', args: \[(.*)\] \}$/;
const PARSED_OPEN = /^parsed command: \{$/;
const EXECUTED = /^Agent executed: (![A-Za-z]+) and got:\s?(.*)$/;
const COLLECTED = /^Collected (\d+) (\S+?)(?:[ ,.(]|$)/;
const NOW_HAVE = /you now have (\d+) (\S+?)\.?$/;
const INVENTORY = /^INVENTORY$/;
const INV_ITEM = /^- (\S+?): (\d+)$/;
// The output of an executed command ends at the next line of another kind (the agent's own lines) or a 2-s gap.
const NOT_OUTPUT = /^(Saved memory|selected examples|Awaiting |\[|Generated response|received message|executing code|parsed command|Agent executed|Mode |action "|Self-prompting|starting self|self prompt|Storing memories|Memory updated|Unpausing|Pausing|<bot>|FRCFLD |Received\.|waiting for code)/;
// Positions of the bot (not of a block or a target).
const POSITIONS = [
    new RegExp(`^You have reached at ${C3}`),
    /^- Position: x: (-?[\d.]+), y: (-?[\d.]+), z: (-?[\d.]+)/,
    new RegExp(`^\\[escape\\] (?:stuck|still stuck|trapped|out) at ${C3}`),
    IN_SHELTER,
    DEATH,
    new RegExp(`^Moved away from \\(.*?\\) to \\(${C3}\\)`),
    new RegExp(`^\\[respawn\\] (?:now .* at|escape done: .* at) ${C3}`),
    /the bot at (-?[\d.]+), (-?[\d.]+), (-?[\d.]+) \(/,
];

/** Server chat lines with journal times: [{t, msg}] (the server log has times only: the journal's date, +1 day past midnight). */
export function serverChat(serverText, firstT) {
    if (!serverText || !Number.isFinite(firstT)) return [];
    const day = new Date(firstT).toISOString().slice(0, 10);
    const out = [];
    for (const line of String(serverText).split('\n')) {
        const m = /^\[(\d\d:\d\d:\d\d)\] \[Server thread\/INFO\] \[net\.minecraft\.server\.dedicated\.DedicatedServer\]: (?:<<bot>>|<(?!bot>)[A-Za-z0-9_]{3,16}>) (.*)$/.exec(line);
        if (!m) continue;
        let t = Date.parse(`${day}T${m[1]}Z`);
        if (t < firstT - 3_600_000) t += 86_400_000;
        out.push({ t, msg: m[2] });
    }
    return out;
}

const near = (list, t, s) => list.filter(x => Math.abs(x.t - t) <= s * 1000);
const before = (list, t) => { let r = null; for (const x of list) { if (x.t <= t) r = x; else break; } return r; };
const norm = (s) => String(s).toLowerCase().replace(/^[a-z0-9_]+:/, '').replace(/:\d+$/, '').replace(/_/g, ' ').trim();
const sing = (w) => (/ss$/.test(w) ? w : w.replace(/(ie)?s$/, (m, ie) => (ie ? 'y' : '')));
/** A claimed item phrase ("metamorphic cobble", "rocks") names a state item id ("undergroundbiomes:metamorphic_cobble"). */
export function itemMatches(phrase, id) {
    const p = phrase.split(' ').map(sing).join(' ');
    const n = norm(id).split(' ').map(sing).join(' ');
    return n === p || n.split(' ').includes(p) || (p.includes(' ') && n.includes(p));
}

/** The bot's state lines from the journal (and the server's chat), in time order. */
function stateOf(lines, chat) {
    const pos = [], goals = [], agendaReplies = [], deaths = [], shelters = [], picks = [], food = [], inventories = [], nowHave = [], collected = [];
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        for (const re of POSITIONS) { const m = re.exec(l.msg); if (m) { pos.push({ t: l.t, y: Math.floor(Number(m[2])), n: l.n }); break; } }
        let m;
        if ((m = GOAL.exec(l.msg)) && /goal/.test(l.msg)) goals.push({ t: l.t, num: m[1] ? Number(m[1]) : null, id: m[2] ?? m[3] });
        else if (STANDING.test(l.msg) && /goal/.test(l.msg)) goals.push({ t: l.t, done: true });
        if ((m = AGENDA_REPLY.exec(l.msg))) agendaReplies.push({ t: l.t, step: m[2] ?? null, done: m[2] ? (m[3] ?? '').split(', ').filter(Boolean) : 'all' });
        if ((m = DEATH.exec(l.msg))) deaths.push({ t: l.t, at: `${m[1]}, ${m[2]}, ${m[3]}` });
        if ((m = IN_SHELTER.exec(l.msg))) shelters.push({ t: l.t, at: `${m[1]}, ${m[2]}, ${m[3]}` });
        if ((m = PICK_CHECK.exec(l.msg))) picks.push({ t: l.t, has: !/^none$/.test(m[1].trim()) });
        else if ((m = DIG_PICKS.exec(l.msg))) picks.push({ t: l.t, has: !/^none carried$/.test(m[1].trim()) });
        if ((m = NIGHT_FOOD.exec(l.msg))) food.push({ t: l.t, held: Number(m[1]) });
        if ((m = NOW_HAVE.exec(l.msg))) nowHave.push({ t: l.t, count: Number(m[1]), item: m[2] });
        if ((m = COLLECTED.exec(l.msg))) collected.push({ t: l.t, count: Number(m[1]), item: m[2] });
        if (INVENTORY.test(l.msg)) {
            const items = [];
            for (let j = i + 1; j < lines.length && lines[j].t - l.t <= 2000; j++) { const it = INV_ITEM.exec(lines[j].msg); if (it) items.push({ item: it[1], count: Number(it[2]) }); else if (!/^- /.test(lines[j].msg)) break; }
            inventories.push({ t: l.t, items });
        }
    }
    const stepDone = chat.map(c => { const m = /^agenda step (\S+) done$/.exec(c.msg); return m ? { t: c.t, id: m[1] } : /^agenda done$/.test(c.msg) ? { t: c.t, all: true } : null; }).filter(Boolean);
    const stepStarted = chat.map(c => { const m = /^agenda step (\S+) (started|: the scripted job)/.exec(c.msg); return m ? { t: c.t, id: m[1] } : null; }).filter(Boolean);
    const shelterBlocks = chat.map(c => { const m = /^agenda step shelter_blocks: the scripted job ended: .*?\((\d+) of \d+;/.exec(c.msg); return m ? { t: c.t, count: Number(m[1]) } : null; }).filter(Boolean);
    return { pos, goals, agendaReplies, deaths, shelters, picks, food, inventories, nowHave, collected, stepDone, stepStarted, shelterBlocks };
}

/** Executed commands: [{t, n, cmd: '!name', args: 'normalized', key, output, failed}]. */
export function executedCommands(lines) {
    const out = [];
    let pending = null; // the last parsed command
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        let m;
        if ((m = PARSED_ONE.exec(l.msg))) { pending = { cmd: m[1], args: m[2] }; continue; }
        if (PARSED_OPEN.test(l.msg)) {
            let name = null, args = '';
            for (let j = i + 1; j < lines.length && j <= i + 12; j++) {
                const n = /commandName: '(![A-Za-z]+)'/.exec(lines[j].msg); if (n) name = n[1];
                const a = /^args: \[(.*)\]$/.exec(lines[j].msg.trim()); if (a) args = a[1];
                if (/^\}$/.test(lines[j].msg.trim())) break;
            }
            if (name) pending = { cmd: name, args };
            continue;
        }
        if (!(m = EXECUTED.exec(l.msg))) continue;
        const outLines = [m[2]];
        for (let j = i + 1; j < lines.length && lines[j].t - lines[j - 1].t <= 2000 && !NOT_OUTPUT.test(lines[j].msg); j++) outLines.push(lines[j].msg);
        const output = outLines.join('\n').trim();
        const args = pending && pending.cmd === m[1] ? pending.args.replace(/\s+/g, ' ').trim() : '';
        out.push({ t: l.t, n: l.n, cmd: m[1], args, key: `${m[1]}(${args})`, output, failed: looksFailed(output) });
        pending = null;
    }
    return out;
}

/** The facts text split into its lines. */
export function factsFields(text) {
    const parts = String(text).split(' / ');
    const f = { agenda: null, reserves: null, failures: [], deaths: null, places: null, collects: null };
    let inFailures = false;
    for (const p of parts) {
        if (/^Your notes /.test(p)) break; // the notes are the model's words: not checked
        if (/^Agenda: /.test(p)) { f.agenda = p; inFailures = false; continue; }
        if (/^Reserves: /.test(p)) { f.reserves = p; inFailures = false; continue; }
        if (/^Recent failures/.test(p)) { inFailures = true; continue; }
        if (/^Deaths: /.test(p)) { f.deaths = p; inFailures = false; continue; }
        if (/^Places: /.test(p)) { f.places = p; inFailures = false; continue; }
        if (/^Collects: /.test(p)) { f.collects = p; inFailures = false; continue; }
        if (inFailures) f.failures.push(p);
    }
    return f;
}

const agoMin = (s) => (/just now/.test(s) ? 0 : Number(/(\d+) min ago/.exec(s)?.[1] ?? NaN));

/** I13: the facts lines against the state lines. null when the journal has no facts line. */
export function memoryFactsCheck(lines, chat = []) {
    const W = MEMORY_CHECKS.windowS;
    const facts = lines.map(l => ({ l, m: FACTS.exec(l.msg) })).filter(x => x.m);
    if (!facts.length) return null;
    const st = stateOf(lines, chat);
    const cmds = executedCommands(lines);
    const res = { factsLines: facts.length, fields: 0, matches: 0, misses: 0, unverifiable: 0, byField: {}, missesFirst: [] };
    const judge = (field, ok, l, detail) => {
        const b = (res.byField[field] ??= { match: 0, miss: 0, unverifiable: 0 });
        if (ok == null) { b.unverifiable++; res.unverifiable++; return; }
        res.fields++;
        if (ok) { b.match++; res.matches++; } else { b.miss++; res.misses++; if (res.missesFirst.length < 10) res.missesFirst.push({ t: hms(l.t), line: l.n, field, ...detail }); }
    };
    for (const { l, m } of facts) {
        const f = factsFields(m[1]);
        const t = l.t;
        // Agenda: the step id named, against any agenda source in the window.
        if (f.agenda) {
            const step = /step (\S+) \(/.exec(f.agenda)?.[1] ?? (/^Agenda: done\b/.test(f.agenda) ? 'done' : null);
            const src = [
                ...near(st.goals, t, W).map(g => (g.done ? 'done' : g.id)),
                ...near(st.agendaReplies, t, W).map(a => a.step ?? 'done'),
                ...near(st.stepStarted, t, W).map(s => s.id),
            ];
            judge('agenda', src.length && step ? src.includes(step) : null, l, { said: step, state: [...new Set(src)].join(',') });
        }
        // Deaths: the count so far (a death within the window may not be in yet), and the last one's cell.
        {
            const n = f.deaths ? Number(/^Deaths: (\d+)/.exec(f.deaths)?.[1]) : 0;
            const now = st.deaths.filter(d => d.t <= t).length;
            const earlier = st.deaths.filter(d => d.t <= t - W * 1000).length;
            judge('deaths', n === now || n === earlier, l, { said: n, state: now });
            const cell = f.deaths && /; last (?:just now|\d+ min ago) at (-?\d+, -?\d+, -?\d+)/.exec(f.deaths)?.[1];
            if (cell) { const d = before(st.deaths, t + W * 1000); judge('last death', d ? d.at === cell : null, l, { said: cell, state: d?.at }); }
        }
        // Places: the shelter, against the last `in the shelter` line by the window's end.
        const shelter = f.places && /(?:tonight's|last) shelter (-?\d+, -?\d+, -?\d+)/.exec(f.places)?.[1];
        if (shelter) { const s = before(st.shelters, t + W * 1000); judge('shelter', s ? s.at === shelter : null, l, { said: shelter, state: s?.at }); }
        if (f.reserves) {
            // The pickaxe: carried or not, against the pickaxe check and dig-refused lines in the window.
            // "stone_pickaxe": no word boundary before "pickaxe" ("_" is a word character).
            const has = /pickaxe/.test(f.reserves.replace(/no pickaxe, axe or weapon/, ''));
            const src = near(st.picks, t, W);
            judge('pickaxe', src.length ? src.some(p => p.has === has) : null, l, { said: has, state: src.map(p => p.has).join(',') });
            const held = Number(/food held ([\d.]+) points/.exec(f.reserves)?.[1]);
            if (Number.isFinite(held)) { const src2 = near(st.food, t, W); judge('food held', src2.length ? src2.some(x => Math.abs(x.held - held) <= 0.1) : null, l, { said: held, state: src2.map(x => x.held).join(',') }); }
            const blocks = Number(/shelter blocks (\d+) of/.exec(f.reserves)?.[1]);
            if (Number.isFinite(blocks)) { const src3 = near(st.shelterBlocks, t, W); judge('shelter blocks', src3.length ? src3.some(x => x.count === blocks) : null, l, { said: blocks, state: src3.map(x => x.count).join(',') }); }
        }
        // Each failure: a command with those args that ran and failed around its "N min ago".
        for (const line of f.failures) {
            const fm = /^(![A-Za-z]+)(?:\((.*?)\))?: .*\((just now|\d+ min ago)\b/.exec(line);
            if (!fm) { judge('failure', null, l, {}); continue; }
            const ago = agoMin(fm[3]);
            const args = (fm[2] ?? '').replace(/"/g, '\'').replace(/\s+/g, ' ').trim();
            const lo = t - (ago + 1.5) * 60_000, hi = t - Math.max(0, ago - 1.5) * 60_000;
            const hit = cmds.some(c => c.failed && c.cmd === fm[1] && c.t >= lo && c.t <= hi && (!args || c.args.replace(/\s+/g, ' ').includes(args.split(',')[0].trim())));
            judge('failure', hit, l, { said: `${fm[1]}(${fm[2] ?? ''})`, ago });
        }
        // Each collect: a `Collected N <item>` line around its time.
        if (f.collects) {
            for (const c of f.collects.replace(/^Collects: /, '').split('; ')) {
                const cm = /^got (\d+) (\S+) .*?, (just now|\d+ min ago)$/.exec(c);
                if (!cm) continue;
                const ago = agoMin(cm[3]);
                const lo = t - (ago + 1.5) * 60_000, hi = t - Math.max(0, ago - 1.5) * 60_000;
                const hit = st.collected.some(x => x.t >= lo && x.t <= hi && x.count === Number(cm[1]) && x.item === cm[2]);
                judge('collect', hit, l, { said: `${cm[1]} ${cm[2]}`, ago });
            }
        }
    }
    res.share = res.fields ? Math.round(1000 * res.matches / res.fields) / 10 : null;
    return res;
}

// A target or another thing's level ("to the surface (y=72)", "dig to y 72", "rocks … at ground level (~y=70)") is not
// where the bot is; "up to y=60" is (soak 15's claim).
const Y_CLAIM = /(?:^|[^a-z0-9_])(?:(surface|sky|reach|target|need|toward|towards|(?:get|go|dig|climb|head|back) to|ground|level|rocks?|ores?|trees?|water|sea)\W{0,12})?y ?(?:=|:|is|at)? ?(-?\d{1,3})(?![\d.,]*\d)/gi;
const COUNT_CLAIM = /\b(?:i have|i've got|have|got|holding|carrying)\s+(\d+)\s+([a-z][a-z ]{1,40}?)(?=\s+(?:now|so|already|and|total|more|left|in|from|for|to|of|here|blocks?|worth|that|which|but|with)\b|[,.!;:)(\u2014-]|$)/gi;
const STEP_CLAIM = /\bsteps? (\d+)(?:\s*[-\u2013]\s*(\d+))?(?: (?:is|are))? done\b|\bstep ([a-z_]+) (?:is )?done\b/gi;

/** I14: the model's state claims against the state lines. */
export function wrongClaims(lines, chat = []) {
    const W = MEMORY_CHECKS.windowS;
    const st = stateOf(lines, chat);
    const idOf = new Map(STEP_IDS.map((id, i) => [i + 1, id])); // step number -> id; the goal lines win
    for (const g of st.goals) if (g.num != null) idOf.set(g.num, g.id);
    const res = { replies: 0, claimReplies: 0, claims: 0, wrong: 0, unverifiable: 0, byKind: { y: [0, 0, 0], count: [0, 0, 0], step: [0, 0, 0] }, wrongFirst: [], handSample: [] };
    const claimReplies = [];
    const judge = (kind, ok, l, detail) => {
        res.claims++;
        const b = res.byKind[kind];
        if (ok == null) { b[2]++; res.unverifiable++; return; }
        if (ok) b[0]++; else { b[1]++; res.wrong++; if (res.wrongFirst.length < 10) res.wrongFirst.push({ t: hms(l.t), line: l.n, kind, ...detail }); }
    };
    const doneBy = (id, num, t) => {
        // Done by t: the server's step-done line, `agenda done`, an !agenda reply listing it, or a goal past its number.
        if (st.stepDone.some(d => d.t <= t && (d.all || d.id === id))) return true;
        if (st.agendaReplies.some(a => a.t <= t && (a.done === 'all' || a.done.includes(id)))) return true;
        if (st.goals.some(g => g.t <= t && (g.done || (num != null && g.num != null && g.num > num)))) return true;
        const known = st.stepDone.length || st.agendaReplies.length || st.goals.length;
        return known ? false : null;
    };
    for (const l of lines) {
        const r = REPLY.exec(l.msg);
        if (!r) continue;
        res.replies++;
        // The command and everything after it are not claims (its args may hold ")" and run to the line's end).
        const text = r[1].replace(/![a-zA-Z]+\(.*$/s, ' ');
        let any = false;
        for (const m of text.matchAll(Y_CLAIM)) {
            if (m[1]) continue; // a target ("to the surface (y=72)"), not where the bot is
            any = true;
            const ps = near(st.pos, l.t, W);
            const y = Number(m[2]);
            judge('y', ps.length ? ps.some(p => Math.abs(p.y - y) <= MEMORY_CHECKS.yTolerance) : null, l, { said: `y ${y}`, state: ps.map(p => p.y).join(',') });
        }
        for (const m of text.matchAll(COUNT_CLAIM)) {
            any = true;
            const n = Number(m[1]);
            const phrase = m[2].trim().toLowerCase();
            const have = [...st.nowHave].reverse().find(x => x.t <= l.t && l.t - x.t <= W * 1000 && itemMatches(phrase, x.item));
            const inv = before(st.inventories.filter(x => l.t - x.t <= W * 1000), l.t);
            let state = null;
            if (have) state = have.count;
            else if (inv) { const hits = inv.items.filter(x => itemMatches(phrase, x.item)); if (hits.length) state = hits.reduce((s, x) => s + x.count, 0); }
            // "Got 4 rocks" may be what a collect got, not the total held: a `Collected N <item>` line in the window agrees too.
            const got = st.collected.some(x => x.t <= l.t && l.t - x.t <= W * 1000 && x.count === n && itemMatches(phrase, x.item));
            judge('count', state == null && !got ? null : state === n || got, l, { said: `${n} ${phrase}`, state });
        }
        for (const m of text.matchAll(STEP_CLAIM)) {
            if (m[3] && !KNOWN_IDS.has(m[3])) continue; // "the step is done": no step named
            any = true;
            if (m[3]) { judge('step', doneBy(m[3], STEP_IDS.indexOf(m[3]) + 1 || null, l.t + W * 1000), l, { said: `step ${m[3]} done` }); continue; }
            const top = Number(m[2] ?? m[1]);
            const id = idOf.get(top);
            const ok = id ? doneBy(id, top, l.t + W * 1000) : st.goals.some(g => g.num != null) ? doneBy(null, top, l.t + W * 1000) : null;
            judge('step', ok, l, { said: `step${m[2] ? 's' : ''} ${m[2] ? `${m[1]}-${m[2]}` : m[1]} done`, state: id ?? '' });
        }
        if (any) { res.claimReplies++; claimReplies.push({ t: hms(l.t), line: l.n }); }
    }
    // The hand-check sample: every k-th claim reply, so the same journal gives the same sample.
    const k = Math.max(1, Math.ceil(claimReplies.length / MEMORY_CHECKS.handSample));
    res.handSample = claimReplies.filter((_, i) => i % k === 0).slice(0, MEMORY_CHECKS.handSample);
    return res;
}

/** I15: the same command and args failing again within repeatMin; inMemory when a facts line named it between. */
export function repeatedFailures(lines) {
    const fails = executedCommands(lines).filter(c => c.failed);
    const facts = lines.filter(l => FACTS.test(l.msg));
    const repeats = [];
    for (let i = 0; i < fails.length; i++) {
        const prev = fails.slice(0, i).reverse().find(f => f.key === fails[i].key && fails[i].t - f.t <= MEMORY_CHECKS.repeatMin * 60_000);
        if (!prev) continue;
        const inMemory = facts.some(x => x.t > prev.t && x.t < fails[i].t && x.msg.includes(`${fails[i].cmd}(`));
        repeats.push({ t: hms(fails[i].t), line: fails[i].n, cmd: fails[i].key, firstLine: prev.n, inMemory });
    }
    const span = lines.length > 1 ? (lines.at(-1).t - lines[0].t) / 3_600_000 : 0;
    // For the lead's choice of window: the repeats within 30 and 60 min as well (the check itself uses repeatMin).
    const within = (min) => fails.filter((f, i) => fails.slice(0, i).some(p => p.key === f.key && f.t - p.t <= min * 60_000)).length;
    return { count: repeats.length, failures: fails.length, inMemory: repeats.filter(r => r.inMemory).length, perHour: span ? Math.round(100 * repeats.length / span) / 100 : null, within30: within(30), within60: within(60), first: repeats.slice(0, 5) };
}
