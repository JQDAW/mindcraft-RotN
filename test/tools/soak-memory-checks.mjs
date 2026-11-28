// Round 17 M (code-built memory, #637), the plan's M4 evidence checks 1-3, for soak-invariants.mjs (I13-I15).
// Each check reads the bot's journal (driver.log; readJournal's lines) and, where it helps, the test server's log
// (the agenda's chat lines). Offline, reads files only. #637's PR body has the line formats.
//
//   I13 memory-facts (M4 check 1)  every `[memory] facts <n> chars: <text>` line (its lines joined by " / "), field by
//       field, against the code's own state lines within `windowS` (either side): the agenda step (soak 17: the state at
//       the facts line's time, the latest source at or before it within `bracketMin` plus any within `agendaAfterS`
//       after it: the self-prompt goal `RotN agenda, step N of M (<id>)`, `!agenda` replies (also `done (…), step X`),
//       the server's `agenda step <id> started`, `agenda done` / `agenda standing goal started`, and a scripted-job line
//       while the agenda is active; a numbered step named after its `step X done` line or in the line's own done list,
//       and `active, all steps done` with steps not done, are misses; soak 18 (B1): a source in the facts line's own
//       second that disagrees makes the field unverifiable, as the logs cannot order the two), the
//       deaths (`[death] died at X; waiting for the respawn` lines so far, the last one's cell), the last shelter
//       (`[night] in the shelter at X until morning`), the pickaxe (`[shelter] pickaxe check: … inventory: …`,
//       `dig refused: … pickaxe tools: …`; soak 17, by day: the pickaxe count from a craft's `you now have`, a listing that
//       shows the hands, `[pickaxe] made`, `[tool] … broke`, unknown after a death), the food held (`[night] food for the
//       night: … held H points`, and the standing goal's `you hold H` within `goalS` unless an inventory change lands
//       between), the shelter blocks (the server's `shelter_blocks: the scripted job ended: +G … (N of 14`: N once it
//       ended, N - G before it; the standing goal's `you have N` as above; soak 18 (B2): the last job's end count plus
//       each cobble craft after it, `Cobblestone from your rocks: N <item>` confirmed by `Successfully crafted <item>`, or
//       a craft's `you now have N` less the last count of that item, until a night, a death, a craft of unknown gain or
//       a shortened output of a command that collects or crafts, which may hide a craft),
//       each failure (a command with those args that ran and failed around `<n> min ago`; #675's merged `!cmd(args) xN:`
//       needs exactly N such failures with the full args, each within failureHoldMin of the next) and each collect (`Collected N <item>` around its time; soak 18
//       (B3): with none, a scripted job's run or a collecting or crafting command's shortened output in that time
//       leaves it unverifiable; a job with no end line ends at the next job's start or after bracketMin). A
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
//       command between the two (`inMemory`: the first failure was in the memory). Per hour of journal. Soak 18, a
//       separate count (`planAfterDefer`): a `!getCraftingPlan` of a target (or its chain) asked again within `deferMin`
//       after the model said it would drop or defer that target. The chain: the plans asked from the reply's first try
//       at the named target (a `!craftRecipe` or `!getCraftingPlan`, within `repeatMin` before it) to the reply.
import { looksFailed } from '../../src/agent/memory_facts.js';
import { ROTN_EARLY_GAME } from '../../src/agent/agenda.js';

// The numbered agenda steps (`step N of 11`), the same order in every release since rotn-v0.1.5; a goal line naming a
// number wins over this.
const STEP_IDS = ROTN_EARLY_GAME.map(s => s.id);
const KNOWN_IDS = new Set([...STEP_IDS, 'shelter_blocks', 'weapon', 'food']);

export const MEMORY_CHECKS = { windowS: 30, yTolerance: 2, repeatMin: 10, handSample: 20, minSamples: 5, bracketMin: 10, agendaAfterS: 3, goalS: 5, inFlightS: 2, deferMin: 60, failureHoldMin: 5 };

const hms = (ms) => new Date(ms).toISOString().slice(11, 19);
const C3 = '(-?\\d+), (-?\\d+), (-?\\d+)';
const FACTS = /^\[memory\] facts \d+ chars: (.*)$/;
const DEATH = new RegExp(`^\\[death\\] died at ${C3}; waiting for the respawn$`);
const IN_SHELTER = new RegExp(`^\\[night\\] in the shelter at ${C3} until morning$`);
// #650 review 4: every line that names the night's shelter cell (night_routine.js): built, moved into (the side pocket,
// a back-away, a burrow), still or back in it.
const SHELTER_AT = [
    IN_SHELTER,
    new RegExp(`^\\[night\\] .*: in the shelter at ${C3}, the cells behind sealed$`),
    new RegExp(`^\\[night\\] (?:backed away|moved into the side pocket) into ${C3}, but `),
    new RegExp(`^\\[night\\] (?:still|back) in the shelter at ${C3}: closing it again$`),
    new RegExp(`burrowed \\d+ steps? into ${C3}`),
];
const NIGHT_START = /^\[night\] (sunset is near|it is night): building a shelter/;
const MORNING = /^\[night\] morning\b/;
const PICK_CHECK = /^\[shelter\] pickaxe check: .*?; inventory: ([^;]+);/;
const DIG_PICKS = /^\[forge-bridge\] dig refused: .*; pickaxe tools: ([^;]+?)(;|$)/;
const NIGHT_FOOD = /^\[night\] food for the night: .*?held ([\d.]+) points/;
const GOAL = /RotN agenda, step (?:(\d+) of \d+ \(([^)]+)\)|([a-z_]+) \(([^)]+)\))/;
const STANDING = /Standing goal \(the agenda is done\)/;
// soak 17 (A4): a done agenda that keeps a step open answers `agenda: done (before night …), step shelter_blocks (…)`.
const AGENDA_REPLY = /^Agent executed: !agenda and got: agenda: (active, step (\S+) .*?(?:; done: (.*))?|done\b(?: \([^)]*\), step (\S+) \()?.*)$/;
// The standing goal's own numbers (agenda.js standingGoal): food held and shelter blocks, computed when it is sent.
const STANDING_NUMBERS = /Standing goal \(the agenda is done\): keep food worth at least \d+ points \(you hold ([\d.]+)\) and \d+ blocks .*?\(you have (\d+);/;
// The pickaxe count (I13 daytime sources): a craft's `you now have N`, the escape's `[pickaxe] made`, a `[tool] broke`.
const PICK_MADE = /^\[pickaxe\] made an? (\S+) pickaxe\b/;
const PICK_BROKE = /^\[tool\] (\S*pickaxe) broke\b/;
// An inventory change that may land between two code-built numbers a second apart (soak 17: a forage's pickup).
const IN_FLIGHT = /^(Picked up [1-9]|Foraged |Collected [1-9]|.*\byou now have \d|\[survival\] ate |Successfully crafted )/;
const REPLY = /^Generated response: (.*)$/;
// Soak 18 (B2): a cobble craft's gain (`Cobblestone from your rocks: 6 undergroundbiomes:igneous_cobble:0 (4 …`; a
// shortened output may cut the line's start), its confirmation or failure, and a cobble count from a craft.
const FROM_ROCKS = /from your rocks: (\d+) (\S+) \(/;
const CRAFT_FAILED = /^Could not craft (\S+?):/;
const CRAFTED_COBBLE = /^Successfully crafted (\S*cobble\S*?)(?:,| from )/;
const SHORTENED = /has been shortened/;
// #677 review 2: only a command that collects or crafts can hide a `Collected` or craft line in a shortened output.
const MAKES_ITEMS = /^!(?:collectBlocks|craftRecipe|smeltItem)$/;
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
// #650 review 2: not `You have reached at X`: X is the goal's cell (reached within the goal's range), not the bot's.
const POSITIONS = [
    /^- Position: x: (-?[\d.]+), y: (-?[\d.]+), z: (-?[\d.]+)/,
    /^\[survival\] hurt-detail .* at (-?[\d.]+),(-?[\d.]+),(-?[\d.]+) vy /,
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
// The metadata first (#650 round 2: "dirt:0" is dirt, not "0"), then the namespace.
const norm = (s) => String(s).toLowerCase().replace(/:\d+$/, '').replace(/^[a-z0-9_]+:/, '').replace(/_/g, ' ').trim();
const sing = (w) => (/ss$/.test(w) ? w : w.replace(/(ie)?s$/, (m, ie) => (ie ? 'y' : '')));
/** A claimed item phrase ("metamorphic cobble", "rocks") names a state item id ("undergroundbiomes:metamorphic_cobble"). */
export function itemMatches(phrase, id) {
    const p = phrase.split(' ').map(sing).join(' ');
    const n = norm(id).split(' ').map(sing).join(' ');
    return n === p || n.split(' ').includes(p) || (p.includes(' ') && n.includes(p));
}

/** The phrase names exactly that item ("sticks" and "stick"; not "axes" and "crude axe"). */
export function sameItem(phrase, id) {
    return phrase.split(' ').map(sing).join(' ') === norm(id).split(' ').map(sing).join(' ');
}

/** The bot's state lines from the journal (and the server's chat), in time order. */
function stateOf(lines, chat) {
    const pos = [], goals = [], agendaReplies = [], deaths = [], shelters = [], picks = [], food = [], inventories = [], nowHave = [], collected = [], nights = [], commands = [];
    const standing = [], inFlight = [], pickTimeline = [], cobbleCrafts = [], shortened = [];
    const gainPending = new Map(), itemCount = new Map(); // B2: `from your rocks` gains not yet confirmed; last counts
    let nightNo = 0;
    // The pickaxes carried, per kind (#662 review 5: a second kind must not be lost to one kind's count or break).
    // `known`: a listing that shows the hands said what is carried; a death makes it unknown again.
    const picks2 = { known: false, kinds: new Map() };
    const pickState = () => { const sum = [...picks2.kinds.values()].reduce((a, b) => a + b, 0); return sum > 0 ? sum : picks2.known ? 0 : null; };
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        let m0;
        for (const re of POSITIONS) { const m = re.exec(l.msg); if (m) { pos.push({ t: l.t, y: Math.floor(Number(m[2])), n: l.n, at: `${Math.floor(Number(m[1]))}, ${Math.floor(Number(m[2]))}, ${Math.floor(Number(m[3]))}` }); break; } }
        if ((m0 = EXECUTED.exec(l.msg))) {
            commands.push({ t: l.t, cmd: m0[1] });
            // A shortened output may hide crafts (soak 17 17:29:08: one cobble craft cut out): B2's chain stops there.
            if (SHORTENED.test(m0[2]) && MAKES_ITEMS.test(m0[1])) { shortened.push({ t: l.t, n: l.n }); cobbleCrafts.push({ t: l.t, n: l.n, item: null, gain: null }); }
        }
        let m;
        if ((m = GOAL.exec(l.msg)) && /goal/.test(l.msg)) goals.push({ t: l.t, num: m[1] ? Number(m[1]) : null, id: m[2] ?? m[3] });
        else if (STANDING.test(l.msg) && /goal/.test(l.msg)) goals.push({ t: l.t, done: true });
        if ((m = AGENDA_REPLY.exec(l.msg))) agendaReplies.push({ t: l.t, step: m[2] ?? m[4] ?? null, done: m[2] ? (m[3] ?? '').split(', ').filter(Boolean) : 'all' });
        if ((m = STANDING_NUMBERS.exec(l.msg)) && /goal/.test(l.msg)) standing.push({ t: l.t, n: l.n, held: Number(m[1]), blocks: Number(m[2]) });
        if (IN_FLIGHT.test(l.msg)) inFlight.push({ t: l.t, n: l.n });
        // The pickaxe count per kind: a craft's `you now have N <kind>` sets that kind, `[pickaxe] made` adds one, a
        // `[tool] <kind> broke` takes one; a listing (below) sets them all; a death makes them unknown (what a death keeps
        // is not logged per item).
        if ((m = NOW_HAVE.exec(l.msg)) && /pickaxe/.test(m[2])) picks2.kinds.set(m[2], Number(m[1]));
        else if ((m = PICK_MADE.exec(l.msg))) { const k = `${m[1]}_pickaxe`; picks2.kinds.set(k, (picks2.kinds.get(k) ?? 0) + 1); }
        else if ((m = PICK_BROKE.exec(l.msg))) { if (picks2.kinds.has(m[1])) picks2.kinds.set(m[1], Math.max(0, picks2.kinds.get(m[1]) - 1)); }
        else if (DEATH.test(l.msg)) { picks2.known = false; picks2.kinds.clear(); }
        if ((m = DEATH.exec(l.msg))) deaths.push({ t: l.t, at: `${m[1]}, ${m[2]}, ${m[3]}` });
        for (const re of SHELTER_AT) { const s = re.exec(l.msg); if (s) { shelters.push({ t: l.t, at: `${s[1]}, ${s[2]}, ${s[3]}`, night: nightNo }); break; } }
        if (NIGHT_START.test(l.msg)) { nightNo++; nights.push({ t: l.t, no: nightNo, morning: null }); }
        else if (MORNING.test(l.msg) && nights.length && nights.at(-1).morning == null) {
            const night = nights.at(-1);
            night.morning = l.t;
            // A morning with no shelter line that night: night_routine.js takes where the night was spent (the bot's
            // cell) as the last shelter.
            if (!shelters.some(x => x.night === night.no)) { const p = pos.at(-1); if (p?.at) shelters.push({ t: l.t, at: p.at, night: night.no, spent: true }); }
        }
        if ((m = PICK_CHECK.exec(l.msg))) picks.push({ t: l.t, has: !/^none$/.test(m[1].trim()) });
        else if ((m = DIG_PICKS.exec(l.msg))) picks.push({ t: l.t, has: !/^none carried$/.test(m[1].trim()) });
        if ((m = NIGHT_FOOD.exec(l.msg))) food.push({ t: l.t, held: Number(m[1]) });
        // B2: a cobble craft and its gain: the `from your rocks` count it confirms (within 2 s), else the change of that
        // item's `you now have` count; null when neither is known (the chain of sources stops there).
        if ((m = FROM_ROCKS.exec(l.msg))) gainPending.set(m[2], { t: l.t, gain: Number(m[1]) });
        else if ((m = CRAFT_FAILED.exec(l.msg))) gainPending.delete(m[1]);
        else if ((m = CRAFTED_COBBLE.exec(l.msg))) {
            const p = gainPending.get(m[1]);
            const have = NOW_HAVE.exec(l.msg);
            const now = have && have[2] === m[1] ? Number(have[1]) : null;
            const gain = p && l.t - p.t <= 2000 ? p.gain : now != null && itemCount.has(m[1]) ? now - itemCount.get(m[1]) : null;
            cobbleCrafts.push({ t: l.t, n: l.n, item: m[1], gain });
            gainPending.delete(m[1]);
        }
        if ((m = NOW_HAVE.exec(l.msg))) { nowHave.push({ t: l.t, n: l.n, count: Number(m[1]), item: m[2] }); itemCount.set(m[2], Number(m[1])); }
        if ((m = COLLECTED.exec(l.msg))) collected.push({ t: l.t, n: l.n, count: Number(m[1]), item: m[2] });
        if (INVENTORY.test(l.msg)) {
            const items = [];
            for (let j = i + 1; j < lines.length && lines[j].t - l.t <= 2000; j++) { const it = INV_ITEM.exec(lines[j].msg); if (it) items.push({ item: it[1], count: Number(it[2]) }); else if (!/^- /.test(lines[j].msg)) break; }
            inventories.push({ t: l.t, n: l.n, items });
            itemCount.clear();
            for (const x of items) itemCount.set(x.item, (itemCount.get(x.item) ?? 0) + x.count);
            // The pickaxe count from a listing only when it also shows the hands (`IN THE OFF HAND: …`, `WEARING: …`, the
            // lines after the items): soak 17's pickaxe sat in the off hand, which the item lines leave out.
            let hands = false;
            const held = new Map();
            for (const x of items) if (/pickaxe/.test(x.item)) held.set(x.item, (held.get(x.item) ?? 0) + x.count);
            for (let j = i + 1 + items.length; j < lines.length && j <= i + items.length + 4 && lines[j].t - l.t <= 2000; j++) {
                const h = /^IN THE OFF HAND: (?:(\d+) (\S+)|nothing)/i.exec(lines[j].msg);
                if (h) { hands = true; if (h[2] && /pickaxe/.test(h[2])) held.set(h[2], (held.get(h[2]) ?? 0) + Number(h[1])); continue; }
                if (/^WEARING: /.test(lines[j].msg)) hands = true;
            }
            if (hands) { picks2.known = true; picks2.kinds = held; }
        }
        const pc = pickState();
        if (!pickTimeline.length || pickTimeline.at(-1).count !== pc) pickTimeline.push({ t: l.t, n: l.n, count: pc });
    }
    const stepDone = chat.map(c => { const m = /^agenda step (\S+) done$/.exec(c.msg); return m ? { t: c.t, id: m[1] } : /^agenda done$/.test(c.msg) ? { t: c.t, all: true } : null; }).filter(Boolean);
    // #650 review 5: "agenda step shelter_blocks: the scripted job (run 1 of 2 today)" (the id ends at the colon). Soak 17
    // (A2): after `agenda done` (or `agenda standing goal started`) that job runs under the standing goal, so its line is a
    // step only while the agenda is active; a `step X started` line re-opens it. `agendaDone`: the done marks, a source.
    const stepStarted = [], agendaDone = [], shelterBlocks = [], jobs = [];
    let doneNow = false, jobStart = null;
    for (const c of chat) {
        let m;
        if (/^agenda (?:done|standing goal started\b)/.test(c.msg)) { doneNow = true; agendaDone.push({ t: c.t }); continue; }
        if ((m = /^agenda step ([a-z_]+) started\b/.exec(c.msg))) { doneNow = false; stepStarted.push({ t: c.t, id: m[1] }); continue; }
        // B3: every scripted job's run (its collects log no `Collected` line in the journal).
        if ((m = /^agenda step ([a-z_]+): the scripted job ended\b/.exec(c.msg))) { const j = [...jobs].reverse().find(x => x.id === m[1] && x.end === Infinity); if (j) j.end = c.t; }
        if ((m = /^agenda step ([a-z_]+): the scripted job \(run/.exec(c.msg))) {
            // #677 review 3: a job with no end line ends at the next job's start.
            for (const j of jobs) if (j.end === Infinity) j.end = c.t;
            jobs.push({ id: m[1], start: c.t, end: Infinity });
            if (m[1] === 'shelter_blocks') jobStart = c.t;
            if (!doneNow) stepStarted.push({ t: c.t, id: m[1] });
            continue;
        }
        // S1: the job's end count, its gain and its start (the count before the job is count - gain).
        if ((m = /^agenda step shelter_blocks: the scripted job ended: \+(\d+) shelter blocks \((\d+) of \d+;/.exec(c.msg))) { shelterBlocks.push({ t: c.t, count: Number(m[2]), gain: Number(m[1]), start: jobStart ?? c.t }); jobStart = null; }
    }
    // ... or after bracketMin (one still open at the journal's end, or killed with no line).
    for (const j of jobs) if (j.end === Infinity) j.end = j.start + MEMORY_CHECKS.bracketMin * 60_000;
    return { pos, goals, agendaReplies, deaths, shelters, picks, food, inventories, nowHave, collected, stepDone, stepStarted, agendaDone, shelterBlocks, nights, commands, standing, inFlight, pickTimeline, cobbleCrafts, shortened, jobs };
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
            for (let j = i + 1; j < lines.length && j <= i + 50; j++) {
                const n = /commandName: '(![A-Za-z]+)'/.exec(lines[j].msg); if (n) name = n[1];
                const a = /^args: \[(.*)\]$/.exec(lines[j].msg.trim()); if (a) args = a[1];
                else if (/^args: \[$/.test(lines[j].msg.trim())) { // args over several lines: until the closing "]"
                    const parts = [];
                    for (j++; j < lines.length && j <= i + 40 && !/^(\],?|\}|Agent executed: |Generated response: )/.test(lines[j].msg.trim()); j++) parts.push(lines[j].msg.trim());
                    args = parts.join(' ');
                }
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

/**
 * I13: the facts lines against the state lines. null when the journal has no facts line. Per field: match, miss,
 * unverifiable, and `trivial` (a death count of 0 with no death so far: right, but no evidence). The gate (#650 review
 * 10): 0 misses in every field with at least `minSamples` verifiable non-trivial samples; else 'fail' (a miss) or
 * 'too few'.
 */
export function memoryFactsCheck(lines, chat = []) {
    const W = MEMORY_CHECKS.windowS;
    const facts = lines.map(l => ({ l, m: FACTS.exec(l.msg) })).filter(x => x.m);
    if (!facts.length) return null;
    const st = stateOf(lines, chat);
    const cmds = executedCommands(lines);
    // #650 review 9: "Deaths: N since this memory began" counts from a fresh memory.json; the lead resets the bot's state
    // before a soak (`[state] … memory=absent`). A memory carried over (state_report.js writes the turns, or `corrupt`:
    // anything but `absent`; #650 round 2) makes the count unverifiable.
    const carried = lines.some(l => { const m = /^\[state\] .*\bmemory=(\S+)/.exec(l.msg); return m && m[1] !== 'absent'; });
    const res = { factsLines: facts.length, fields: 0, matches: 0, misses: 0, unverifiable: 0, byField: {}, missesFirst: [] };
    const judge = (field, ok, l, detail, trivial = false) => {
        const b = (res.byField[field] ??= { match: 0, miss: 0, unverifiable: 0, trivial: 0 });
        if (ok == null) { b.unverifiable++; res.unverifiable++; return; }
        res.fields++;
        if (ok) { b.match++; res.matches++; if (trivial) b.trivial++; } else { b.miss++; res.misses++; if (res.missesFirst.length < 10) res.missesFirst.push({ t: hms(l.t), line: l.n, field, ...detail }); }
    };
    const nightAt = (t) => { let r = null; for (const n of st.nights) { if (n.t <= t) r = n; else break; } return r; };
    for (const { l, m } of facts) {
        const f = factsFields(m[1]);
        const t = l.t;
        // Agenda: the step id named, against any agenda source in the window.
        if (f.agenda) {
            const step = /step (\S+) \(/.exec(f.agenda)?.[1] ?? (/^Agenda: done\b/.test(f.agenda) ? 'done' : null);
            // Soak 17 (A1, A3): the agenda's state at the facts line's time: the latest source at or before it (within
            // bracketMin), and any source up to agendaAfterS after it (the same moment, logged a little later); not every
            // source within ±windowS (a step that began or ended 20 s later is not the state then).
            const all = [
                ...st.goals.map(g => ({ t: g.t, id: g.done ? 'done' : g.id })),
                ...st.agendaReplies.map(a => ({ t: a.t, id: a.step ?? 'done' })),
                ...st.stepStarted.map(s => ({ t: s.t, id: s.id })),
                ...st.agendaDone.map(d => ({ t: d.t, id: 'done' })),
            ].sort((a, b) => a.t - b.t);
            const last = before(all, t);
            const src = [
                ...(last && t - last.t <= MEMORY_CHECKS.bracketMin * 60_000 ? [last.id] : []),
                ...all.filter(x => x.t > t && x.t - t <= MEMORY_CHECKS.agendaAfterS * 1000).map(x => x.id),
            ];
            // #661 review 1: `active, all steps done` (no step set yet: soak 17 17:17:05, `done: none`) claims every step
            // done. Its own done list is the test: wrong when the list is `none` or names, untruncated, fewer than all.
            const doneList = /; done: (.*)$/.exec(f.agenda.trim())?.[1] ?? null;
            const listed = doneList == null || doneList === 'none' ? [] : doneList.split(', ').map(x => x.trim());
            const truncated = /\.\.\.$/.test(doneList ?? '');
            // B1 (soak 18, 20:53:22 and 20:55:13; #677 review 1): the step changed in the facts line's own second, and the
            // logs cannot order the two. Unverifiable only when the latest source in an earlier second names the facts'
            // step (the state just before the change); else judged as before.
            const sec = (x) => Math.floor(x / 1000);
            const prior = before(all.filter(x => sec(x.t) < sec(t)), t);
            const priorIsStep = !!prior && prior.id === step && t - prior.t <= MEMORY_CHECKS.bracketMin * 60_000;
            const changedNow = all.some(x => sec(x.t) === sec(t) && x.id !== step);
            if (!step && /^Agenda: active, all steps done\b/.test(f.agenda)) {
                const all = doneList === 'none' || (!truncated && STEP_IDS.some(id => !listed.includes(id)));
                judge('agenda', all ? false : null, l, { said: 'active, all steps done', state: `done: ${doneList ?? '?'}` });
            } else if (step && STEP_IDS.includes(step) && listed.slice(0, truncated ? -1 : undefined).includes(step)) {
                // #661 (soak 17 17:22:20, 17:22:23): a numbered step named as the current one in the line's own done list,
                // or after its `step X done` line (below), is stale, whatever the sources before it say.
                judge('agenda', false, l, { said: step, state: `${step} done` });
            } else if (step && STEP_IDS.includes(step) && st.stepDone.some(d => d.id === step && d.t <= t && (!prior || d.t > prior.t))) {
                // Stale after its `step X done` line; B1: a done line in this same second, with the step the latest source
                // before it, is unverifiable.
                const doneAt = st.stepDone.filter(d => d.id === step && d.t <= t && (!prior || d.t > prior.t));
                judge('agenda', priorIsStep && doneAt.every(d => sec(d.t) === sec(t)) ? null : false, l, { said: step, state: `${step} done` });
            } else {
                const ok = src.length && step ? src.includes(step) : null;
                judge('agenda', ok === false && changedNow && priorIsStep ? null : ok, l, { said: step, state: [...new Set(src)].join(',') });
            }
        }
        // Deaths: the count so far (a death within the window may not be in yet), and the last one's cell. A death with
        // no cell (or an 'unknown' cause) still counts.
        {
            const n = f.deaths ? Number(/^Deaths: (\d+)/.exec(f.deaths)?.[1]) : 0;
            const now = st.deaths.filter(d => d.t <= t).length;
            const earlier = st.deaths.filter(d => d.t <= t - W * 1000).length;
            judge('deaths', carried ? null : n === now || n === earlier, l, { said: n, state: now }, n === 0 && now === 0);
            const cell = f.deaths && /; last (?:just now|\d+ min ago) at (-?\d+, -?\d+, -?\d+)/.exec(f.deaths)?.[1];
            if (cell) { const d = before(st.deaths, t + W * 1000); judge('last death', d ? d.at === cell : null, l, { said: cell, state: d?.at }); }
        }
        // Places: the shelter, against the night's last shelter line by the window's end (#650 review 4: every line that
        // names the cell; a morning with no shelter line takes the bot's cell). A source from an earlier night than the
        // latest one begun is no evidence for it: unverifiable.
        const shelter = f.places && /(?:tonight's|last) shelter (-?\d+, -?\d+, -?\d+)/.exec(f.places)?.[1];
        if (shelter) {
            const s = before(st.shelters, t + W * 1000);
            const night = nightAt(t + W * 1000);
            const fresh = s && (!night || s.t >= night.t);
            judge('shelter', fresh ? s.at === shelter : null, l, { said: shelter, state: s?.at });
        }
        if (f.reserves) {
            // The pickaxe: carried or not, against the pickaxe check and dig-refused lines in the window.
            // "stone_pickaxe": no word boundary before "pickaxe" ("_" is a word character).
            const has = /pickaxe/.test(f.reserves.replace(/no pickaxe, axe or weapon/, ''));
            // Daytime sources (soak 17: 0 samples from the night lines alone): the pickaxe count at this line (a craft's
            // `you now have`, a listing, `[pickaxe] made`, `[tool] … broke`; unknown from a death to the next absolute
            // count), and after a change within inFlightS (logged a little after the facts were built).
            const src = near(st.picks, t, W).map(p => p.has);
            const atLine = before(st.pickTimeline.map(x => ({ ...x, t: x.n })), l.n);
            if (atLine && atLine.count != null) src.push(atLine.count > 0);
            for (const x of st.pickTimeline) if (x.n > l.n && x.t - t <= MEMORY_CHECKS.inFlightS * 1000 && x.count != null) src.push(x.count > 0);
            judge('pickaxe', src.length ? src.some(v => v === has) : null, l, { said: has, state: src.join(',') });
            // The standing goal's own numbers within goalS, unless an inventory change lands between the two (or within
            // inFlightS before the earlier one): then that goal line is no evidence (soak 17: a forage's pickup).
            const goals = near(st.standing, t, MEMORY_CHECKS.goalS).filter(g => {
                const lo = Math.min(g.t, t) - MEMORY_CHECKS.inFlightS * 1000, hi = Math.max(g.t, t);
                const [a, b] = [Math.min(g.n, l.n), Math.max(g.n, l.n)];
                return !st.inFlight.some(x => (x.n > a && x.n < b) || (x.t >= lo && x.t <= hi && x.n < a));
            });
            const held = Number(/food held ([\d.]+) points/.exec(f.reserves)?.[1]);
            if (Number.isFinite(held)) { const src2 = [...near(st.food, t, W).map(x => x.held), ...goals.map(g => g.held)]; judge('food held', src2.length ? src2.some(x => Math.abs(x - held) <= 0.1) : null, l, { said: held, state: src2.join(',') }); }
            const blocks = Number(/shelter blocks (\d+) of/.exec(f.reserves)?.[1]);
            if (Number.isFinite(blocks)) {
                // S1: a job that ended by this line gives its count; a later one (within the window) the count before it
                // (count - gain), and both while it ran.
                const src3 = [];
                for (const x of near(st.shelterBlocks, t, W)) {
                    // B2: a cobble craft after the job's end and before this line makes its count stale (soak 18 21:36:09).
                    if (x.t <= t) { if (!st.cobbleCrafts.some(c => c.t > x.t && c.n < l.n)) src3.push(x.count); }
                    else if (x.start >= t) src3.push(x.count - x.gain);
                    else src3.push(x.count, x.count - x.gain);
                }
                src3.push(...goals.map(g => g.blocks));
                // B2 (soak 18): the last job's end count plus each cobble craft after it (by this line, or logged within
                // inFlightS after it), within bracketMin, until a night, a death or a craft of unknown gain.
                const end = before(st.shelterBlocks, t);
                if (end && t - end.t <= MEMORY_CHECKS.bracketMin * 60_000 && !st.nights.some(x => x.t > end.t && x.t <= t) && !st.deaths.some(x => x.t > end.t && x.t <= t)) {
                    const crafts = [];
                    for (const c of st.cobbleCrafts) {
                        if (c.t <= end.t) continue;
                        if (c.n > l.n && c.t - t > MEMORY_CHECKS.inFlightS * 1000) break;
                        crafts.push(c);
                    }
                    const unknown = crafts.findIndex(c => c.gain == null);
                    if (unknown < 0 || crafts[unknown].n > l.n) {
                        const usable = unknown < 0 ? crafts : crafts.slice(0, unknown);
                        const gains = (xs) => xs.reduce((a, c) => a + c.gain, 0);
                        const by = usable.filter(c => c.n < l.n), late = usable.filter(c => c.n > l.n);
                        const atLine = end.count + gains(by);
                        if (by.length || late.length) src3.push(atLine); // by this line (the count before the late ones)
                        if (late.length) src3.push(atLine + gains(late));
                    }
                }
                judge('shelter blocks', src3.length ? src3.some(x => x === blocks) : null, l, { said: blocks, state: src3.join(',') });
            }
        }
        // Each failure: a command with those args that ran and failed around its "N min ago". A line cut before its
        // "(N min ago …)" (memory_facts.js clips at 120 chars), or a command with no `Agent executed` line in the window
        // (#650 review 8: typed by a player, run outside the agent's command log), is unverifiable.
        for (const line of f.failures) {
            // Round 17 K (#675): a repeat within the memory's 5-min hold is merged into one entry, `!cmd(args) x2: why`.
            const fm = /^(![A-Za-z]+)(?:\((.*?)\))?(?: x(\d+))?: .*\((just now|\d+ min ago)\b/.exec(line);
            if (!fm) { judge('failure', null, l, {}); continue; }
            const ago = agoMin(fm[4]);
            const times = fm[3] ? Number(fm[3]) : 1;
            const args = (fm[2] ?? '').replace(/"/g, '\'').replace(/\s+/g, ' ').trim();
            const lo = t - (ago + 1.5) * 60_000, hi = t - Math.max(0, ago - 1.5) * 60_000;
            const ran = cmds.filter(c => c.cmd === fm[1] && c.t >= lo && c.t <= hi);
            const same = (c) => c.failed && (!args || c.args.replace(/\s+/g, ' ').includes(args.split(',')[0].trim()));
            let hit = ran.some(same);
            // xN (#677 review 4): exactly N failed runs with the full args (the memory's key), each within failureHoldMin of
            // the next, ending at the newest one in the window. A command the memory clipped (`...`) matches by its start.
            if (hit && times > 1) {
                const norm2 = (x) => x.replace(/"/g, '\'').replace(/\s+/g, ' ').trim();
                const want = norm2(fm[2] ?? '');
                const full = (c) => c.failed && (/\.\.\.$/.test(want) ? norm2(c.args).startsWith(want.slice(0, -3)) : norm2(c.args) === want);
                const runs = cmds.filter(c => c.cmd === fm[1] && c.t <= hi && full(c));
                const last = runs.findLastIndex(c => c.t >= lo);
                let k = last < 0 ? 0 : 1;
                while (last - k >= 0 && runs[last - k + 1].t - runs[last - k].t <= MEMORY_CHECKS.failureHoldMin * 60_000) k++;
                hit = k === times;
            }
            judge('failure', ran.length ? hit : null, l, { said: `${fm[1]}(${fm[2] ?? ''})${times > 1 ? ` x${times}` : ''}`, ago });
        }
        // Each collect: a `Collected N <item>` line around its time.
        if (f.collects) {
            for (const c of f.collects.replace(/^Collects: /, '').split('; ')) {
                const cm = /^got (\d+) (\S+) .*?, (just now|\d+ min ago)$/.exec(c);
                if (!cm) continue;
                const ago = agoMin(cm[3]);
                const lo = t - (ago + 1.5) * 60_000, hi = t - Math.max(0, ago - 1.5) * 60_000;
                const hit = st.collected.some(x => x.t >= lo && x.t <= hi && x.count === Number(cm[1]) && x.item === cm[2]);
                // B3 (soak 18): no `Collected` line, but a scripted job ran or a command's output was shortened then: the
                // line that would name it is not in the journal.
                const hidden = st.jobs.some(j => j.start <= hi && j.end >= lo) || st.shortened.some(x => x.t >= lo && x.t <= hi);
                judge('collect', hit ? true : hidden ? null : false, l, { said: `${cm[1]} ${cm[2]}`, ago });
            }
        }
    }
    res.share = res.fields ? Math.round(1000 * res.matches / res.fields) / 10 : null;
    // The gate per field: verifiable = match + miss, less the trivial matches.
    const N = MEMORY_CHECKS.minSamples;
    res.gateByField = Object.fromEntries(Object.entries(res.byField).map(([k, b]) => {
        const samples = b.match + b.miss - b.trivial;
        return [k, { samples, verdict: b.miss ? 'fail' : samples >= N ? 'pass' : 'too few' }];
    }));
    const verdicts = Object.values(res.gateByField).map(g => g.verdict);
    res.gate = verdicts.includes('fail') ? 'fail' : verdicts.length && verdicts.every(v => v === 'pass') ? 'pass' : 'too few';
    return res;
}

// A target or another thing's level ("to the surface (y=72)", "dig to y 72", "rocks … at ground level (~y=70)") is not
// where the bot is; "up to y=60" is (soak 15's claim).
const Y_CLAIM = /(?:^|[^a-z0-9_])(?:(surface|sky|reach|target|need|toward|towards|(?:get|go|dig|climb|head|back) to|ground|level|rocks?|ores?|trees?|water|sea)\W{0,12})?y ?(?:=|:|is|at)? ?(-?\d{1,3})(?![\d.,]*\d)/gi;
const STEP_CLAIM = /\bsteps? (\d+)(?:\s*[-–]\s*(\d+))?(?: (?:is|are))? done\b|\bstep ([a-z_]+) (?:is )?done\b/gi;

// Count claims (#650 review 6). A phrase ends at a word that is not part of an item name, or punctuation.
const STOP = 'now|so|already|and|total|more|left|in|from|for|to|of|here|blocks?|worth|that|which|but|with|on|plus|then|ready|needed|need|each|per|at|is|are|was';
const PHRASE = `([a-z][a-z ]{1,40}?)(?=\\s+(?:${STOP})\\b|[,.!;:)(+\\u2014~-]|\\s*$)`;
const VERB_COUNT = new RegExp(`\\b(i have|i've got|have|got|holding|carrying|with)\\s+(\\d+)\\s+${PHRASE}`, 'gi');
const MORE_COUNT = new RegExp(`^\\s*(?:,|and|&|plus|\\(?\\+)\\s*(\\d+)\\s+${PHRASE}`, 'i');
const SUFFIX_COUNT = new RegExp(`\\b(\\d+)\\s+${PHRASE}\\s+(?:on hand|now|in (?:my )?inventory|held|in hand|in stock)\\b`, 'gi');
const TOTAL = /^\s*\((\d+) total(?: now)?\)/i;
const FILLER = /^(?:fresh|loose|extra|new|whole|spare|of the|of|the)\s+/;
const NOT_ITEM = /^(?:already|more|so far|left|total|now|of them|times?|tries|blocks? away|min|minutes?|seconds?|s|steps?|points?|hunger|health|food points?)$/;
// An inventory-changing event between a reply and a listing after it (#650 review 1): then the listing is no evidence.
const QUERY_CMDS = /^Agent executed: !(?:inventory|stats|nearbyBlocks|entities|craftable|savedPlaces|agenda|getCraftingPlan|searchForBlock|searchForEntity|help|modes|lookAtPlayer|lookAtPosition)\b/;
const INVENTORY_CHANGE = /^(Agent executed: !|Collected [1-9]|.*\byou now have \d|Picked up [1-9]|\[survival\] ate |\[death\] )/;

/**
 * The count claims of a reply's text: [{n, phrase, mode}]. mode 'got' ("got 6 sticks", "with 16 piles": a collect's yield or the total),
 * 'held' ("I have 13 cobble", "6 sticks so far", "25 planks now", "(27 total now)": the total only, #650 review 7).
 */
export function countClaims(text) {
    const out = [];
    const clean = (p) => { let q = p.trim().toLowerCase(); while (FILLER.test(q)) q = q.replace(FILLER, ''); return q; };
    // "3 more cobble" is what was added, not a count held: no claim.
    const add = (n, phrase, mode, end) => { const q = clean(phrase); if (q && !NOT_ITEM.test(q) && !/^more\b/.test(q)) out.push({ n: Number(n), phrase: q, mode, end }); };
    const heldAfter = (rest) => /^\s*(?:so far|now|in total|total|already|on hand|held|in (?:my )?inventory)\b/i.test(rest);
    for (const m of text.matchAll(VERB_COUNT)) {
        let end = m.index + m[0].length;
        add(m[2], m[3], /^(got|with)$/i.test(m[1]) && !heldAfter(text.slice(end)) ? 'got' : 'held', end);
        // "I have 19 rocks and 9 cobble (+1 chalk cobble)": the counts that follow in the same list.
        for (let k = 0; k < 4; k++) {
            const more = MORE_COUNT.exec(text.slice(end));
            if (!more) break;
            end += more[0].length;
            add(more[1], more[2], 'held', end);
        }
    }
    for (const m of text.matchAll(SUFFIX_COUNT)) if (!out.some(c => c.n === Number(m[1]) && c.phrase === clean(m[2]))) add(m[1], m[2], 'held', m.index + m[0].length);
    // "(27 total now)": the total of the claim right before it.
    for (const c of [...out]) { const t = TOTAL.exec(text.slice(c.end)); if (t) out.push({ n: Number(t[1]), phrase: c.phrase, mode: 'held', end: c.end + t[0].length }); }
    return out.map(({ end: _end, ...c }) => c);
}

/** I14: the model's state claims against the state lines. */
export function wrongClaims(lines, chat = []) {
    const W = MEMORY_CHECKS.windowS;
    const st = stateOf(lines, chat);
    const idOf = new Map(STEP_IDS.map((id, i) => [i + 1, id])); // step number -> id; the goal lines win
    for (const g of st.goals) if (g.num != null) idOf.set(g.num, g.id);
    const res = { replies: 0, claimReplies: 0, claims: 0, wrong: 0, unverifiable: 0, byKind: { y: [0, 0, 0], count: [0, 0, 0], step: [0, 0, 0] }, wrongFirst: [], handSample: [] };
    const claimReplies = [];
    const failedAt = new Map(executedCommands(lines).map(c => [c.n, c.failed]));
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
    /** The y's the bot was at near t: positions within the window; else (#650 review 2) the last one before and the
     *  first one after, each within bracketMin, when they agree within 1 (the bot did not move up or down between). */
    const ysAt = (t) => {
        const ps = near(st.pos, t, W);
        if (ps.length) return ps.map(p => p.y);
        const B = MEMORY_CHECKS.bracketMin * 60_000;
        const prev = before(st.pos, t), next = st.pos.find(p => p.t > t);
        if (prev && next && t - prev.t <= B && next.t - t <= B && Math.abs(prev.y - next.y) <= 1) return [prev.y, next.y];
        return [];
    };
    const idx = new Map(lines.map((x, j) => [x.n, j]));
    /** Whether something changed the inventory between journal lines a and b (exclusive; a failed command did not). */
    const changedBetween = (a, b) => {
        for (let j = Math.min(idx.get(a), idx.get(b)) + 1; j < Math.max(idx.get(a), idx.get(b)); j++) {
            const x = lines[j].msg;
            if (!INVENTORY_CHANGE.test(x) || QUERY_CMDS.test(x)) continue;
            if (/^Agent executed: !/.test(x) && failedAt.get(lines[j].n)) continue;
            return true;
        }
        return false;
    };
    const invAt = (l) => {
        // The latest listing within the window before the reply (in line order), with no change between; else (#650
        // review 1) the first one within the window after it, with no change between.
        const b = [...st.inventories].reverse().find(x => x.n < l.n && l.t - x.t <= W * 1000);
        if (b) return changedBetween(b.n, l.n) ? null : b;
        const a = st.inventories.find(x => x.n > l.n && x.t - l.t <= W * 1000);
        return a && !changedBetween(l.n, a.n) ? a : null;
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
            // #661 (soak 17 18:06:20): "up from y=25 to y=44": the from-y is where the bot was; the to-y is the claim.
            if (/\bfrom\s*$/i.test(text.slice(Math.max(0, m.index - 8), m.index + (m[0].length - m[0].trimStart().length)))
                && /^\W{0,3}(?:up |down |back )?to y\b/i.test(text.slice(m.index + m[0].length))) continue;
            any = true;
            const ys = ysAt(l.t);
            const y = Number(m[2]);
            judge('y', ys.length ? ys.some(v => Math.abs(v - y) <= MEMORY_CHECKS.yTolerance) : null, l, { said: `y ${y}`, state: ys.join(',') });
        }
        const claims = countClaims(text);
        for (const c of claims) {
            any = true;
            // "9 cobble (+1 chalk cobble)": an item another claim of the reply names more closely is not in this one's sum.
            const closer = (item) => claims.some(o => o !== c && o.phrase.length > c.phrase.length && o.phrase.endsWith(c.phrase) && itemMatches(o.phrase, item));
            // `you now have N X` counts X alone: only a claim naming X itself ("9 sticks", not "2 axes" for a crude axe).
            const have = [...st.nowHave].reverse().find(x => x.n < l.n && l.t - x.t <= W * 1000 && sameItem(c.phrase, x.item) && !changedBetween(x.n, l.n));
            const inv = invAt(l);
            let state = null;
            if (have) state = have.count;
            else if (inv) {
                // The item the phrase names exactly wins over word matches ("16 dirt": dirt, not the dirt piles).
                const exact = inv.items.filter(x => sameItem(c.phrase, x.item));
                const hits = exact.length ? exact : inv.items.filter(x => itemMatches(c.phrase, x.item) && !closer(x.item));
                if (hits.length) state = hits.reduce((s, x) => s + x.count, 0);
            }
            // "got N": a collect's yield in the window agrees too; "have / so far / now / total": the inventory only.
            const got = c.mode === 'got' && st.collected.some(x => x.n < l.n && l.t - x.t <= W * 1000 && x.count === c.n && itemMatches(c.phrase, x.item));
            judge('count', state == null && !got ? null : state === c.n || got, l, { said: `${c.n} ${c.phrase}`, state });
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
    res.handSample = claimReplies.filter((_, j) => j % k === 0).slice(0, MEMORY_CHECKS.handSample);
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
        // #650 review 3: a command with no args is shown as `!goToSurface: why`.
        const inMemory = facts.some(x => x.t > prev.t && x.t < fails[i].t && (x.msg.includes(`${fails[i].cmd}(`) || x.msg.includes(`${fails[i].cmd}:`)));
        repeats.push({ t: hms(fails[i].t), line: fails[i].n, cmd: fails[i].key, firstLine: prev.n, inMemory });
    }
    const span = lines.length > 1 ? (lines.at(-1).t - lines[0].t) / 3_600_000 : 0;
    // For the lead's choice of window: the repeats within 30 and 60 min as well (the check itself uses repeatMin).
    const within = (min) => fails.filter((f, i) => fails.slice(0, i).some(p => p.key === f.key && f.t - p.t <= min * 60_000)).length;
    return { count: repeats.length, failures: fails.length, inMemory: repeats.filter(r => r.inMemory).length, perHour: span ? Math.round(100 * repeats.length / span) / 100 : null, within30: within(30), within60: within(60), first: repeats.slice(0, 5), planAfterDefer: planAfterDefer(lines) };
}

// Soak 18: the model's words for dropping or deferring a target ("I'll drop the sword hunt", "a stone sword can wait",
// "the stone sword is optional anyway").
// "drop" only with the bot as its subject: not a block's drop ("broke without a drop", "leaves drop tinder").
const DEFER = /\b(?:i'll|i will|i'm going to|let's|i)\s+(?:drop|skip|abandon|shelve)\b|\bgiv(?:e|ing) up on\b|\bcan wait\b|\bis optional\b|\bnot (?:needed|worth it)\b/i;
const targetOf = (args) => (/^\s*['"]([^'"]+)['"]/.exec(args ?? '')?.[1] ?? null);
/** The word of a target a reply names it by: the last word of its name ("stone_sword" -> "sword", "pyrotech:tinder" -> "tinder"). */
const keyWord = (target) => { const w = norm(target).split(' ').filter(x => /^[a-z]{4,}$/.test(x)); return w.at(-1) ?? null; };

/**
 * Soak 18 (I15, a separate count): a `!getCraftingPlan` of a target asked again within deferMin after a reply that
 * drops or defers it. A deferring reply names a target (its key word) of a `!craftRecipe` or `!getCraftingPlan` within
 * repeatMin before it; the chain is that target and every target planned from its first try to the reply.
 */
export function planAfterDefer(lines) {
    const cmds = executedCommands(lines).filter(c => c.cmd === '!getCraftingPlan' || c.cmd === '!craftRecipe').map(c => ({ ...c, target: targetOf(c.args) })).filter(c => c.target);
    const plans = cmds.filter(c => c.cmd === '!getCraftingPlan');
    const defers = [];
    for (const l of lines) {
        const r = REPLY.exec(l.msg);
        if (!r) continue;
        const text = r[1].replace(/![a-zA-Z]+\(.*$/s, ' ');
        if (!DEFER.test(text)) continue;
        const recent = cmds.filter(c => c.n < l.n && l.t - c.t <= MEMORY_CHECKS.repeatMin * 60_000);
        const named = recent.filter(c => { const k = keyWord(c.target); return k && new RegExp(`\\b${k}s?\\b`, 'i').test(text); });
        if (!named.length) continue;
        const from = Math.min(...named.map(c => c.n));
        const chain = new Set([...named.map(c => c.target), ...recent.filter(c => c.cmd === '!getCraftingPlan' && c.n >= from).map(c => c.target)]);
        defers.push({ t: l.t, n: l.n, chain });
    }
    const asks = [];
    for (const p of plans) {
        const d = [...defers].reverse().find(x => x.n < p.n && p.t - x.t <= MEMORY_CHECKS.deferMin * 60_000 && x.chain.has(p.target));
        if (d) asks.push({ t: hms(p.t), line: p.n, target: p.target, deferLine: d.n });
    }
    return { count: asks.length, defers: defers.length, first: asks.slice(0, 10) };
}
