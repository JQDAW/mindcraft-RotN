// Round 17 M (Fable Q4.1, the human's approval on condition that it improves play): the bot's memory built from
// code. Soak 15's model summaries were 34-52% of the LLM spend, one had 31k completion tokens, and they narrated a
// state the bot did not have ("Up to y=60" at y 57; "steps 1-9 done" while still on step 9). With the profile's
// "memory": "code" (profiles/rotn-bot.json), $MEMORY is these facts, read from the game state at each prompt, plus
// the bot's own notes (!note; the summary model only for a chunk with a task giver's words, history.js).
// Only what the prompt does not already carry: $SELF_PROMPT has the agenda step's goal, $STATS and $INVENTORY the
// position, health, food and the inventory. Every position comes from code (the night state, the respawn record,
// the memory bank), never from the model's text. The server's death text is never shown (it may carry a custom
// name): a death's cause is one of a few fixed words.

import { describeAgenda, SHELTER_HOLD } from './agenda.js';
import { heldFoodPoints, nightFoodNeed } from './library/food.js';
import { isSturdy, placeableDirt } from './library/night.js';
import { carriedItems } from './library/rotn_names.js';
import { isWeaponItem } from './library/threats.js';
import { offHand } from './library/inventory_view.js';

/**
 * The profile's "memory" key (history.js): "code" builds $MEMORY here; "summary" (or none: upstream's profiles) keeps
 * the model's summary. The way back if soak 17 shows worse play.
 */
export const MEMORY_MODES = ['code', 'summary'];
export function memoryMode(agent) {
    return agent?.prompter?.profile?.memory === 'code' ? 'code' : 'summary';
}

/** Bounds: records kept, lines shown, chars per line. */
export const MEMORY_FACTS = {
    // Soak 17 S7 (R4, the ewe): failuresStored kept in the record; the list shows every failure younger than failureHoldMs
    // (a refusal's leave-alone: !attack on a mob it could not reach, 5 min) first, then older ones, newest first, at most
    // failuresChars in all (not a count: three newer search misses pushed the ewe out of a 3-entry list).
    failuresStored: 12, failuresChars: 600, failureHoldMs: 5 * 60_000,
    failureWhyMax: 100, failureCmdMax: 60, failureLineMax: 120, // #637 review 2: a line each
    deathsShown: 2,
    collectsKept: 4, collectsMs: 30 * 60_000,
    placesMax: 4,
    notesMax: 300,
    lineMax: 220,
};
export const FACTS_HEAD = 'Facts from the game (computed now, not remembered):';
export const NOTES_HEAD = 'Your notes (your own words; they may be outdated):';

const at = (p) => `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;
const ago = (ms) => (ms < 60_000 ? 'just now' : `${Math.round(ms / 60_000)} min ago`);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
const isPos = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/** "12 W", "90 NE": the distance and compass direction from `from` to `to` (north is -z). */
export function bearing(from, to) {
    if (!isPos(from) || !isPos(to)) return '';
    const dx = to.x - from.x, dz = to.z - from.z;
    const d = Math.round(Math.hypot(dx, dz));
    if (d < 2) return 'here';
    const ns = dz < -d * 0.38 ? 'N' : dz > d * 0.38 ? 'S' : '';
    const ew = dx > d * 0.38 ? 'E' : dx < -d * 0.38 ? 'W' : '';
    return `${d} ${ns}${ew}`;
}

/** The fact records the memory keeps (saved with the history): failures, deaths, collects. */
export function emptyFacts() {
    return { failures: [], deaths: [], collects: [], deathCount: 0 };
}

/**
 * A failed command (commands/index.js): what, why (the result's last line until round 17 K gives a structured why),
 * where and when. The last MEMORY_FACTS.failuresStored (the list shown is chosen by failureLines).
 */
export function recordFailure(facts, { cmd, why, code = null, pos = null, at: when = Date.now() }) {
    if (!facts || !cmd) return;
    const entry = { cmd: clip(String(cmd).trim(), MEMORY_FACTS.failureCmdMax), why: clip(String(why ?? 'no reason given').trim(), MEMORY_FACTS.failureWhyMax), at: when };
    if (code) entry.code = String(code);
    if (isPos(pos)) entry.pos = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    // Round 17 K (the lead): the same command with the same code within failureHoldMs updates its entry (the time, the
    // why, the place, a count) instead of adding one, so a repeated miss does not push the others out. A failure with no
    // code (a regex-judged one) is the same when its why is.
    const list = facts.failures ?? [];
    const key = (e) => `${e.cmd}\u0000${e.code ? `code:${e.code}` : `why:${e.why}`}`;
    const i = list.findLastIndex(e => key(e) === key(entry) && when - e.at < MEMORY_FACTS.failureHoldMs);
    if (i >= 0) entry.count = (list[i].count ?? 1) + 1;
    const rest = i >= 0 ? [...list.slice(0, i), ...list.slice(i + 1)] : list;
    facts.failures = [...rest, entry].slice(-MEMORY_FACTS.failuresStored);
}

/** The action manager's marker for a skill that threw (action_manager.js), followed by "Error: <message>" and frames. */
export const THREW = '!!Code threw exception!!';

/**
 * The why of a failed command's output: for a skill that threw (#637 review 1), the first line of its "Error: <msg>";
 * else the last non-empty line, without the upstream "Action output:" wrapper. null when there is no text.
 */
export function failureWhy(output) {
    if (typeof output !== 'string') return null;
    const threw = output.indexOf(THREW);
    if (threw >= 0) {
        const err = output.slice(threw + THREW.length).split('\n').map(l => l.trim()).find(l => /^Error:/.test(l));
        return err ?? 'the command threw an error';
    }
    const lines = output.split('\n').map(l => l.trim()).filter(l => l && !/^(Action output|Code output):?$/i.test(l));
    return lines.at(-1) ?? null;
}

/**
 * Whether a command's output says it failed: a skill that threw, or a last line in one of the skills' and the command
 * layer's failure phrasings. #637 review 3: known phrasings only, the refusals anchored at the line's start ("Not now:",
 * "Not collecting ..."), so a success whose last line says "is not" or "not now" in passing is no failure.
 */
const FAILED = [
    /\bfailed\b/i, // "!collectBlocks failed: time limit ...", "Failed to ..."
    /\b(could not|couldn't|cannot|can't|unable to)\b/i,
    /\b(no path|path not found|pathfinding stopped)\b/i,
    /\bwas not (broken|placed|crafted|used)\b/i,
    /\b(do not|don't) have\b/i,
    /\bnot enough\b/i,
    /\bnone (found|within|in sight|left)\b/i,
    /^no \S+( \S+)? (found|within|nearby|in sight)\b/i,
    /\bnot found\b/i,
    /\b(not allowed|refused|timed out|time limit)\b/i,
    /\bnothing to (eat|place|craft|collect)\b/i,
    /^Not (now|\w+ing)\b/, // the refusals: "Not now: the respawn escape ...", "Not collecting ...", "Not going to ..."
    /^You are trapped\b/,
    /^Collected 0\b/,
];
export function looksFailed(output) {
    if (typeof output === 'string' && output.includes(THREW)) return true;
    const why = failureWhy(output);
    return !!why && FAILED.some(re => re.test(why));
}

/** A death's cause in fixed words (the server's text may carry a mob's or a player's custom name). */
const CAUSES = [
    [/hit the ground|fell from|fell off|fell out|fell too far|doomed to fall/i, 'a fall'],
    [/starved/i, 'starving'],
    [/drowned/i, 'drowning'],
    [/burn|flames|fire|lava/i, 'fire or lava'],
    [/suffocated|in a wall|squished/i, 'suffocation'],
    [/blown up|blew up/i, 'an explosion'],
    [/shot|arrow|fireball/i, 'a ranged mob'],
    [/slain|killed|pummeled|struck/i, 'a mob'],
];
export function causeWord(text) {
    if (typeof text !== 'string' || !text) return null;
    for (const [re, word] of CAUSES) if (re.test(text)) return word;
    return 'unknown';
}

/** A death (death_report.reportDeath's record): its time, place and cause word. */
export function recordDeath(facts, { at: when, pos = null, cause = null, byTree = false }) {
    if (!facts) return;
    facts.deathCount = (facts.deathCount ?? 0) + 1;
    const entry = { at: when ?? Date.now(), cause: byTree && !cause ? 'a tree it cut' : causeWord(cause) };
    if (isPos(pos)) entry.pos = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    facts.deaths = [...(facts.deaths ?? []), entry].slice(-MEMORY_FACTS.deathsShown);
}

/**
 * The collects the bot made (skills.collectBlock writes bot.rotnCollects): the new ones since the last read are
 * moved into the facts, the newest MEMORY_FACTS.collectsKept within collectsMs kept.
 */
export function pullCollects(facts, bot, now = Date.now()) {
    if (!facts) return;
    const seen = facts.collectsSeenAt ?? 0;
    const fresh = (bot?.rotnCollects ?? []).filter(c => c && Number.isFinite(c.at) && c.at > seen && c.item);
    if (fresh.length) facts.collectsSeenAt = Math.max(...fresh.map(c => c.at));
    const kept = [...(facts.collects ?? []), ...fresh.map(c => ({ item: c.item, got: c.got ?? 0, reason: c.reason ?? null, range: c.range ?? null, from: isPos(c.from) ? c.from : null, to: isPos(c.to) ? c.to : null, at: c.at }))]
        .filter(c => now - c.at <= MEMORY_FACTS.collectsMs);
    // One line per item: the newest.
    const byItem = new Map();
    for (const c of kept) byItem.set(c.item, c);
    facts.collects = [...byItem.values()].sort((a, b) => a.at - b.at).slice(-MEMORY_FACTS.collectsKept);
}

function agendaLine(agent) {
    const agenda = agent?.agenda;
    if (!agenda?.steps) return null;
    // The step the driver runs now (agenda_driver sets agent._agenda_step); no judge() here: a prompt must not search
    // the world.
    const id = agent._agenda_step;
    const current = id == null ? null : [...agenda.steps, agenda.reserve, agenda.food, agenda.weapon].find(s => s?.id === id) ?? null;
    let text;
    try { text = describeAgenda(agenda, current); } catch { return null; }
    return `Agenda: ${text.replace(/^agenda: /, '')}`;
}

function reservesLine(bot) {
    const items = bot?.inventory?.items?.() ?? [];
    const parts = [];
    const sturdy = items.filter(i => isSturdy({ name: i.name, metadata: i.metadata ?? 0 })).reduce((n, i) => n + i.count, 0);
    let dirt = 0;
    try { dirt = placeableDirt(items); } catch { dirt = 0; }
    parts.push(`shelter blocks ${sturdy} of ${SHELTER_HOLD} (stone or cobble)${dirt ? `, dirt ${dirt}` : ''}`);
    if (Number.isFinite(bot?.food)) {
        const held = heldFoodPoints(bot);
        const need = nightFoodNeed({ food: bot.food, saturation: bot.foodSaturation ?? 0 });
        parts.push(`food held ${held} points${need != null ? `, a night needs ${need} more than your bar` : ''}`);
    }
    const off = offHand(bot);
    const tools = [];
    for (const i of carriedItems(bot)) {
        const kind = /pickaxe/.test(i.name) ? 'pickaxe' : /(^|[_:])axe$/.test(i.name) ? 'axe' : isWeaponItem(i) ? 'weapon' : null;
        if (!kind) continue;
        const name = `${i.name}${i === off ? ' (off hand)' : ''}`;
        if (!tools.includes(name)) tools.push(name);
    }
    parts.push(tools.length ? `tools: ${tools.slice(0, 4).join(', ')}` : 'no pickaxe, axe or weapon');
    return `Reserves: ${parts.join('; ')}`;
}

/** #637 review 2: a heading and one line per failure (newest first), each at most failureLineMax chars, the why first. */
function failureLines(facts, here, now) {
    const f = facts?.failures ?? [];
    if (!f.length) return [];
    // #650 review (the lead): the why is clipped, never the "(N min ago at ...)" suffix: the model keeps the time.
    const line = (e) => {
        const suffix = ` (${ago(now - e.at)}${e.pos ? ` at ${at(e.pos)}${here ? `, ${bearing(here, e.pos)}` : ''}` : ''})`;
        const head = `${e.cmd}${e.count > 1 ? ` x${e.count}` : ''}: `; // round 17 K: a repeat within 5 min
        // #652 nit: at least 10 chars of why, so with a long command and place the line may pass failureLineMax a little.
        const room = Math.max(10, MEMORY_FACTS.failureLineMax - head.length - suffix.length);
        return `${head}${clip(e.why, room)}${suffix}`;
    };
    // Soak 17 S7: the failures still in their leave-alone window first (newest first), then older ones, within
    // failuresChars; shown newest first.
    const newest = f.slice().reverse();
    const held = newest.filter(e => now - e.at < MEMORY_FACTS.failureHoldMs);
    const older = newest.filter(e => now - e.at >= MEMORY_FACTS.failureHoldMs);
    const chosen = new Set();
    let chars = 0;
    for (const e of [...held, ...older]) {
        const n = line(e).length + 1;
        if (chosen.size && chars + n > MEMORY_FACTS.failuresChars) continue;
        chosen.add(e);
        chars += n;
    }
    return ['Recent failures (newest first):', ...newest.filter(e => chosen.has(e)).map(line)];
}

function deathsLine(facts, here, now) {
    const n = facts?.deathCount ?? 0;
    if (!n) return null;
    const d = (facts.deaths ?? []).slice().reverse()
        .map(e => `${ago(now - e.at)}${e.pos ? ` at ${at(e.pos)}${here ? ` (${bearing(here, e.pos)})` : ''}` : ''}${e.cause ? `, ${e.cause}` : ''}`);
    return `Deaths: ${n} since this memory began${d.length ? `; last ${d.join('; before that ')}` : ''}`;
}

/** Places, only from code: the shelter (night state), the respawn point (respawn record), the memory bank. */
function placesLine(agent, here) {
    const out = [];
    const put = (name, p) => { if (isPos(p) && out.length < MEMORY_FACTS.placesMax) out.push(`${name} ${at(p)}${here ? ` (${bearing(here, p)})` : ''}`); };
    const n = agent?._night;
    if (n?.site && n.state && n.state !== 'day') put('tonight\'s shelter', n.site);
    else if (n?.lastShelter) put('last shelter', n.lastShelter);
    if (n?.respawnSet?.pos) put('respawn point (Scroll of New Life)', n.respawnSet.pos);
    const respawns = agent?._escape?.respawns;
    if (!n?.respawnSet && Array.isArray(respawns) && respawns.length) put('last respawn', respawns.at(-1).pos);
    const bank = agent?.memory_bank?.memory ?? {};
    for (const [name, v] of Object.entries(bank)) {
        if (Array.isArray(v) && v.length === 3) put(name === 'last_death_position' ? 'last death' : `saved "${clip(name, 24)}"`, { x: v[0], y: v[1], z: v[2] });
    }
    return out.length ? `Places: ${out.join('; ')}` : null;
}

function collectsLine(facts, here, now) {
    const c = facts?.collects ?? [];
    if (!c.length) return null;
    return `Collects: ${c.slice().reverse().map(e => {
        const where = e.got > 0 ? (e.to ?? e.from) : e.from;
        const pos = where ? ` ${e.got > 0 ? 'near' : 'around'} ${at(where)}${here ? ` (${bearing(here, where)})` : ''}` : '';
        const what = e.got > 0 ? `got ${e.got} ${e.item}${pos}`
            : `no ${e.item}${e.reason === 'none' && e.range ? ` within ${e.range}` : e.reason === 'time' ? ' (time limit)' : ''}${pos}`;
        return `${what}, ${ago(now - e.at)}`;
    }).join('; ')}`;
}

/**
 * The code-built memory text: the facts (each line from the game state now) and the bot's notes. Lines with nothing
 * to say are left out; each line is at most MEMORY_FACTS.lineMax chars.
 */
export function buildMemory(agent, { facts = null, notes = '', now = Date.now() } = {}) {
    const bot = agent?.bot;
    const here = bot?.entity?.position ?? null;
    if (facts) pullCollects(facts, bot, now);
    const lines = [];
    const add = (l) => { if (l) lines.push(clip(l, MEMORY_FACTS.lineMax)); };
    try { add(agendaLine(agent)); } catch { /* no agenda line */ }
    try { if (bot?.inventory) add(reservesLine(bot)); } catch { /* no reserves line */ }
    for (const l of failureLines(facts, here, now)) add(l);
    add(deathsLine(facts, here, now));
    try { add(placesLine(agent, here)); } catch { /* no places line */ }
    add(collectsLine(facts, here, now));
    let text = lines.length ? `${FACTS_HEAD}\n${lines.join('\n')}` : '';
    const n = typeof notes === 'string' ? notes.trim() : '';
    if (n) text += `${text ? '\n' : ''}${NOTES_HEAD} ${n}`;
    return text;
}

/** The notes with a new note added: newest kept, at most MEMORY_FACTS.notesMax chars (older notes cut first). */
export function addNote(notes, note, max = MEMORY_FACTS.notesMax) {
    const text = String(note ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return notes ?? '';
    let all = [...String(notes ?? '').split(' | ').map(s => s.trim()).filter(Boolean), clip(text, max)];
    while (all.length > 1 && all.join(' | ').length > max) all.shift();
    return all.join(' | ');
}
