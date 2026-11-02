// S1, the survey and smoke batch before G3 (coord/STATUS-harness-ops.md, "G3 batches"): parsers for
// the vanilla 1.12 command replies that G3's server-side arbiters will use, the census classification
// for the site survey, and the day-cycle summary. The reply forms are taken from the 1.12 en_us lang
// file. Verifying them on the real RotN server is S1's job, so every scenario also records the raw
// reply lines.
import { parseLine } from './server-log.mjs';

const msgs = (lines) => lines.map((l) => parseLine(l)?.msg ?? l);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `clear <bot> <item> <meta> 0` (maxCount 0: count only, remove nothing). 1.12 prints
 * "commands.clear.testing" ("<bot> has N items that match the criteria") when N > 0, and throws
 * "commands.clear.failure" ("Could not clear the inventory of <bot>, no items to remove") when N is 0.
 * Returns {count, line}, or null when neither reply is there.
 */
export function clearTestCount(lines, bot) {
    const has = new RegExp(`^${esc(bot)} has (\\d+) items that match the criteria\\.?$`);
    const none = new RegExp(`^Could not clear the inventory of ${esc(bot)}, no items to remove\\.?$`);
    for (const m of msgs(lines)) {
        const r = has.exec(m);
        if (r) return { count: Number(r[1]), line: m };
        if (none.test(m)) return { count: 0, line: m };
    }
    return null;
}

/** The `clear` test command for one item: never a real clear (maxCount 0). */
export const clearTestCommand = (bot, item, meta = -1) => `clear ${bot} ${item} ${meta} 0`;

/**
 * `scoreboard objectives add <name> <criteria>`: 'added' | 'invalid' (unknown criteria) | 'exists' |
 * 'too-long' (more than 16 characters), or null when no known reply is there.
 */
export function scoreboardAddResult(lines, name) {
    for (const m of msgs(lines)) {
        if (m === `Added new objective '${name}' successfully`) return 'added';
        if (/^Invalid objective criteria type '/.test(m)) return 'invalid';
        if (m === `An objective with the name '${name}' already exists`) return 'exists';
        if (new RegExp(`^The name '${esc(name)}' is too long for an objective`).test(m)) return 'too-long';
    }
    return null;
}

/**
 * `scoreboard players list <bot>`: {objectiveName: score}. 1.12 prints a header
 * "Showing N tracked objective(s) for <bot>:" and one line "- <displayName>: <score> (<objectiveName>)"
 * per objective, or "Player <bot> has no scores recorded". Returns null when neither form is there.
 */
export function playerScores(lines, bot) {
    const m = msgs(lines);
    if (m.some((l) => l === `Player ${bot} has no scores recorded`)) return {};
    const head = m.findIndex((l) => new RegExp(`^Showing \\d+ tracked objective\\(s\\) for ${esc(bot)}:$`).test(l));
    if (head < 0) return null;
    const out = {};
    for (const l of m.slice(head + 1)) {
        const e = /^- .*: (-?\d+) \(([^()]+)\)$/.exec(l);
        if (!e) break;
        out[e[2]] = Number(e[1]);
    }
    return out;
}

/** `time query daytime` -> the day time in ticks ("Time is N"), or null. */
export function timeQuery(lines) {
    for (const m of msgs(lines)) {
        const r = /^Time is (\d+)$/.exec(m);
        if (r) return Number(r[1]);
    }
    return null;
}

/**
 * The stat criteria G3's crafted_by_bot check wants (coord/STATUS-harness-ops.md, arbiter 2). The
 * vanilla items surely have them; whether the RotN items do is what S1 finds out. In 1.12 the name is
 * "stat.craftItem." plus the registry name with ':' replaced by '.'. Objective names may have at most
 * 16 characters, so each criterion gets a short one.
 */
export const S1_CRITERIA = [
    { obj: 's1_c_table', criteria: 'stat.craftItem.minecraft.crafting_table', vanilla: true },
    { obj: 's1_c_spick', criteria: 'stat.craftItem.minecraft.stone_pickaxe', vanilla: true },
    { obj: 's1_c_saxe', criteria: 'stat.craftItem.minecraft.stone_axe', vanilla: true },
    { obj: 's1_c_cobble', criteria: 'stat.craftItem.minecraft.cobblestone', vanilla: true },
    { obj: 's1_c_crudeaxe', criteria: 'stat.craftItem.pyrotech.crude_axe', vanilla: false },
    { obj: 's1_c_ctools', criteria: 'stat.craftItem.contenttweaker.crafting_tools', vanilla: false },
    { obj: 's1_deaths', criteria: 'stat.deaths', vanilla: true },
    { obj: 's1_played', criteria: 'stat.playOneMinute', vanilla: true },
];

// Census classification for the site survey (block registry names as the agent reads them).
export const ROCK_RE = /^(pyrotech:rock|pyrotech_compat:rock_[a-z]+)$/;   // pyrotech:rock (any meta) and Underground Biomes rocks
export const TREE_RE = /^(minecraft:log2?|dynamictrees[a-z]*:[a-z0-9_]*(branch|trunkshell|rootydirt)[a-z0-9_]*)$/;
export const STONE_RE = /^(minecraft:stone|undergroundbiomes:[a-z_]*_stone)$/;
// Containers a bot could loot tools from (lead, #101: S1 checks there are none near the cube).
// Vanilla loot holders, plus modded ones by name; a false positive only makes the survey look closer.
export const CONTAINER_RE = /(^minecraft:(dispenser|dropper|hopper)$|chest|barrel|crate|shulker|cabinet|cupboard)/;

/**
 * Census entries [{name, meta, count, cand}] -> {rocks, trees, stone, containers}, each
 * {types: ["name meta count"], blocks: total count, cand: [{name, meta, pos}]}.
 */
export function classifyCensus(entries) {
    const groups = { rocks: ROCK_RE, trees: TREE_RE, stone: STONE_RE, containers: CONTAINER_RE };
    const out = {};
    for (const [k, re] of Object.entries(groups)) {
        const es = entries.filter((e) => re.test(e.name));
        out[k] = {
            types: es.map((e) => `${e.name} ${e.meta} ${e.count}`),
            blocks: es.reduce((a, e) => a + (e.count || 0), 0),
            cand: es.flatMap((e) => (e.cand ?? []).map((pos) => ({ name: e.name, meta: e.meta, pos }))),
        };
    }
    return out;
}

/**
 * Day-cycle samples [{s: seconds since start, daytime}] -> a summary: ticks per real minute (the
 * median of the positive steps, per minute), the wraps (daytime going down), the observed range, and
 * the cycle length that rate implies (24000 ticks). Extended Days may slow time down; the measured
 * rate is what G3's dawn bound is pinned from.
 */
export function dayCycleSummary(samples) {
    const ok = samples.filter((x) => Number.isFinite(x.daytime));
    const rates = [];
    const wraps = [];
    for (let i = 1; i < ok.length; i++) {
        const dt = ok[i].s - ok[i - 1].s;
        const d = ok[i].daytime - ok[i - 1].daytime;
        if (d < 0) wraps.push({ s: ok[i].s, from: ok[i - 1].daytime, to: ok[i].daytime });
        else if (dt > 0) rates.push((d / dt) * 60);
    }
    rates.sort((a, b) => a - b);
    const median = rates.length ? rates[Math.floor(rates.length / 2)] : null;
    return {
        samples: samples.length,
        parsed: ok.length,
        ticksPerMinute: median === null ? null : Math.round(median * 10) / 10,
        cycleMinutes: median ? Math.round((24000 / median) * 10) / 10 : null,
        wraps,
        first: ok[0] ?? null,
        last: ok[ok.length - 1] ?? null,
        min: ok.length ? Math.min(...ok.map((x) => x.daytime)) : null,
        max: ok.length ? Math.max(...ok.map((x) => x.daytime)) : null,
    };
}
