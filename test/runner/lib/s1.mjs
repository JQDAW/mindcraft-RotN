// S1, the survey and smoke batch before G3 (coord/STATUS-harness-ops.md, "G3 batches"): parsers for
// the vanilla 1.12 command replies that G3's server-side arbiters will use, the census classification
// for the site survey, and the day-cycle summary. The reply forms are taken from the 1.12 en_us lang
// file. Verifying them on the real RotN server is S1's job, so every scenario also records the raw
// reply lines.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseLine } from './server-log.mjs';

/** Every S1 run calls ctx.notGate with this first: S1 is never a gate pass (#106 review finding 1). */
export const S1_NOT_GATE = 'S1 is a survey/smoke, never a gate pass';

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
 * 'too-long' (more than 16 characters), or null when no known reply is there. 'invalid' needs the
 * criterion, so that a reply about some other criterion is never taken for this one.
 */
export function scoreboardAddResult(lines, name, criteria) {
    for (const m of msgs(lines)) {
        if (m === `Added new objective '${name}' successfully`) return 'added';
        // Only a reply about THIS criterion counts (#106 review finding 4).
        if (criteria !== undefined && m === `Invalid objective criteria type '${criteria}'`) return 'invalid';
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
    // Vanilla 1.12 has no cobblestone recipe, so this stat may not exist; RotN adds "4 rocks to 1" (#106 finding 3).
    { obj: 's1_c_cobble', criteria: 'stat.craftItem.minecraft.cobblestone', vanilla: false },
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
// Containers a bot could take items from. The check fails closed (#106 review finding 2): a type is a
// container if ANY of three signals says so:
//   1. its registry name looks like one (CONTAINER_RE);
//   2. it is a vanilla block with an inventory, or a spawner (a dungeon with loot chests);
//   3. its Java block class in rotn-data's dump looks like one (CONTAINER_CLASS_RE; the dump has the
//      class but no tile-entity flag, so the class name is the signal).
// Everything modded that no group claims is listed for the lead (unclassifiedModded), so nothing hides.
// A false positive only makes the survey look closer.
export const CONTAINER_RE = /(chest|barrel|crate|shulker|cabinet|cupboard|basket|drawer|storage|sack)/;
export const VANILLA_INVENTORY = new Set([
    'minecraft:chest', 'minecraft:trapped_chest', 'minecraft:ender_chest', 'minecraft:dispenser', 'minecraft:dropper',
    'minecraft:hopper', 'minecraft:furnace', 'minecraft:lit_furnace', 'minecraft:brewing_stand', 'minecraft:mob_spawner',
]);
export const CONTAINER_CLASS_RE = /(Chest|Container|Barrel|Crate|Shulker|Hopper|Dispenser|Dropper|Furnace|Cabinet|Cupboard|Inventory|Storage|Drawer|Basket|Sack|Bag|Box|TileEntity|Mimic|Spawner)/;

/**
 * Block registry name -> Java class name, from rotn-data's block dump under root
 * (packages/rotn-data/3.3.4/blocks.json.br, format rotn-dump/1), or null when it is not there.
 */
export function loadBlockClasses(root) {
    const file = path.join(root, 'packages', 'rotn-data', '3.3.4', 'blocks.json.br');
    if (!fs.existsSync(file)) return null;
    try {
        const dump = JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(file)).toString('utf8'));
        if (dump?.format !== 'rotn-dump/1' || !dump.blocks) return null;
        return new Map(Object.entries(dump.blocks).map(([name, b]) => [name, String(b?.class ?? '')]));
    } catch {
        return null;
    }
}

/** Why a census type counts as a container ('name', 'vanilla inventory', 'class <Leaf>'), or null. */
export function containerReason(name, classes) {
    if (VANILLA_INVENTORY.has(name)) return 'vanilla inventory';
    if (CONTAINER_RE.test(name)) return 'name';
    const leaf = classes?.get(name)?.split('.').pop();
    if (leaf && CONTAINER_CLASS_RE.test(leaf)) return `class ${leaf}`;
    return null;
}

/**
 * Census entries [{name, meta, count, cand}] -> {rocks, trees, stone, containers, unclassifiedModded}.
 * Each group is {types: ["name meta count"], blocks: total count, cand: [{name, meta, pos}]}; container
 * types also say why ("name meta count (why)"). unclassifiedModded lists every non-minecraft type no
 * group claims ("name meta count <class leaf>"). classes: loadBlockClasses() or null.
 */
export function classifyCensus(entries, classes = null) {
    const take = (es, why) => ({
        types: es.map((e) => `${e.name} ${e.meta} ${e.count}${why ? ` (${why(e)})` : ''}`),
        blocks: es.reduce((a, e) => a + (e.count || 0), 0),
        cand: es.flatMap((e) => (e.cand ?? []).map((pos) => ({ name: e.name, meta: e.meta, pos }))),
    });
    const containers = entries.filter((e) => containerReason(e.name, classes));
    const rest = entries.filter((e) => !containerReason(e.name, classes));
    const out = {
        rocks: take(rest.filter((e) => ROCK_RE.test(e.name))),
        trees: take(rest.filter((e) => TREE_RE.test(e.name))),
        stone: take(rest.filter((e) => STONE_RE.test(e.name))),
        containers: take(containers, (e) => containerReason(e.name, classes)),
    };
    const claimed = (e) => ROCK_RE.test(e.name) || TREE_RE.test(e.name) || STONE_RE.test(e.name);
    out.unclassifiedModded = rest.filter((e) => !e.name.startsWith('minecraft:') && !claimed(e))
        .map((e) => `${e.name} ${e.meta} ${e.count} <${classes?.get(e.name)?.split('.').pop() ?? 'class unknown'}>`);
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
