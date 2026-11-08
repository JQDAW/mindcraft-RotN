// What the running bot itself says at its start, read from its log (on S the unit's journal; lib/service.mjs), for
// the checks the Mindcraft driver's mindcraft_start event answers on T (G4 D on S; lead, after #383):
//   - main.js (#385), once per process start, after every settings override:
//       [settings] effective task_givers=<json array> allow_server_task_giver=<json>
//   - skills-rotn (#386), once per agent start, right after tasks.json and agenda.json are loaded:
//       [state] <name> at start: tasks=<absent|corrupt|n> agenda=<absent|corrupt|all-done|step> memory=<absent|corrupt|n>
// Both describe the state AT START (the MindServer could change agent settings later; it is not used on the CX23),
// and a value that does not parse is a failed check, never a throw. No self-asserted marker stands in for either.
import { TEST_TASK_GIVER } from './g3.mjs';

export const SETTINGS_RE = /^\[settings\] effective task_givers=(\[.*\]) allow_server_task_giver=(\S+)$/;
/** The same line matched loosely first, so a malformed value is named as such, not as a missing line (#389 review). */
export const SETTINGS_LOOSE_RE = /^\[settings\] effective task_givers=(.*) allow_server_task_giver=(\S+)$/;
export const STATE_LOOSE_RE = /^\[state\] (\S+) at start: (.*)$/;
/** A missing start line (lead, #389 review): a failed check, worded as the release's gap. */
export const missingLine = (what) => `the release prints no ${what} line (setup gap?)`;
export const STATE_RE = /^\[state\] (\S+) at start: tasks=(absent|corrupt|\d+) agenda=(absent|corrupt|all-done|[\w:.-]+) memory=(absent|corrupt|\d+)$/;

const parse = (s) => { try { return { ok: true, value: JSON.parse(s) }; } catch { return { ok: false }; } };

/**
 * production_givers from the first [settings] line: passes only if allow_server_task_giver is false and the console
 * sender (Server) is not in task_givers. -> {pass, detail, line}
 */
export function productionGiversAtStart(lines) {
    const line = lines.find((l) => SETTINGS_LOOSE_RE.test(l)) ?? null;
    if (!line) return { pass: false, line, detail: missingLine('[settings] effective task_givers=... allow_server_task_giver=...') };
    const [, giversText, allowText] = SETTINGS_LOOSE_RE.exec(line);
    const givers = parse(giversText);
    const allow = parse(allowText);
    if (!SETTINGS_RE.test(line) || !givers.ok || !Array.isArray(givers.value)) return { pass: false, line, detail: `at start: task_givers is not a JSON array (${giversText.slice(0, 120)})` };
    if (!allow.ok) return { pass: false, line, detail: `at start: allow_server_task_giver is not JSON (${allowText.slice(0, 40)})` };
    const hasServer = givers.value.some((g) => String(g) === TEST_TASK_GIVER);
    const pass = allow.value === false && !hasServer;
    return { pass, line, detail: `at start: allow_server_task_giver=${allowText}, task_givers ${giversText}${hasServer ? ` (names ${TEST_TASK_GIVER})` : ''}` };
}

/**
 * fresh_bot_state from the first [state] line of this bot: passes only if tasks, agenda and memory were all absent
 * (corrupt files were there too). -> {pass, detail, line}
 */
export function freshStateAtStart(lines, name) {
    const lower = String(name).toLowerCase();
    const parsed = lines.map((l) => STATE_RE.exec(l)).filter(Boolean);
    const m = parsed.find((x) => x[1].toLowerCase() === lower) ?? null;
    if (!m) {
        const other = parsed[0];
        if (other) return { pass: false, line: other[0], detail: `the [state] line names ${other[1]}, not ${name}` };
        // A [state] line of another form is named as such, not as a missing line (#389 review).
        const loose = lines.map((l) => STATE_LOOSE_RE.exec(l)).find((x) => x && x[1].toLowerCase() === lower);
        if (loose) return { pass: false, line: loose[0], detail: `the [state] line is not in the expected form (${loose[2].slice(0, 120)})` };
        return { pass: false, line: null, detail: missingLine(`[state] ${name} at start: ...`) };
    }
    const values = { tasks: m[2], agenda: m[3], memory: m[4] };
    const present = Object.entries(values).filter(([, v]) => v !== 'absent');
    return {
        pass: present.length === 0,
        line: m[0],
        detail: present.length ? `at start: ${present.map(([k, v]) => `${k}=${v}`).join(', ')} (the human resets the state under the GO)` : 'at start: tasks, agenda and memory all absent',
    };
}
