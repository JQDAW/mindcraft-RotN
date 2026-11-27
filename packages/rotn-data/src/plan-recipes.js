// What mcdata's crafting planner (getDetailedCraftingPlan) needs from the dump (soak 17 L3, lead task
// 2026-11-26): an item's RotN recipes with each ingredient's full member list, so an ore input ("rock",
// "ladderMat", "plankWood") is counted against every member the bot holds (craft-fill.js canFill) rather
// than the one stack a minecraft-data variant names; which items are rocks (gathered, never crafted:
// 4 rocks make a cobble and a cobble gives rocks back, a loop the planner must not walk); and a short
// label for an ore the bot still lacks. Items are named by inventory keys as world.getInventoryCounts writes them:
// "name:meta" for an item with subtypes ("pyrotech:rock:8", "planks:1"), the bare name otherwise or for any meta.
import { botName, WILDCARD_META } from './names.js';
import { canFill } from './craft-fill.js';
import { rockRecipes } from './howto.js';

const rank = (name) => (name.startsWith('pyrotech:') ? 0 : name.startsWith('minecraft:') ? 1 : 2);
const MAX_LABEL_NAMES = 6;

const raw = new WeakMap();
/** The dump's raw recipe by id (its `dynamic` and `matchesSample` flags, which recipesFor's shape drops). */
function rawRecipe(catalog, id) {
    if (!raw.has(catalog)) raw.set(catalog, new Map((catalog.dump.recipes?.recipes ?? []).map((r) => [r.id, r])));
    return raw.get(catalog).get(id) ?? null;
}

/**
 * "rock (any of pyrotech:rock, pyrotech_compat:rock_*)": the ore (or "any of" without one) and its members'
 * item names in rank order; names that share a "mod:word_" prefix are one "mod:word_*". Members that are all one
 * item are listed by meta ("any of coal:0, coal:1"); an item listed once shows its `key` when given
 * ("any of pyrotech:material:14, string").
 * @param {string|null} ore
 * @param {Array<{name: string, meta?: number|null, key?: string}>} members registry or bot names; key: the inventory key
 */
export function oreLabel(ore, members) {
    let names = [...new Set(members.map((m) => botName(m.name)))];
    // #669 review 4: metas of one item ("coal:0", "coal:1") keep their metas, else the label is "any of coal".
    if (names.length === 1 && members.length > 1) names = members.map((m) => (m.meta == null ? botName(m.name) : `${botName(m.name)}:${m.meta}`));
    // Soak 18: an item listed once keeps its inventory key ("any of pyrotech:material:14, string", not "pyrotech:material").
    else names = names.map((n) => { const ms = members.filter((m) => botName(m.name) === n); return ms.length === 1 && ms[0].key ? ms[0].key : n; });
    const prefix = (n) => { const m = /^([^:]+:[^_]+_)/.exec(n); return m ? m[1] : null; };
    const shared = new Map();
    for (const n of names) if (prefix(n)) shared.set(prefix(n), (shared.get(prefix(n)) ?? 0) + 1);
    const out = [];
    for (const n of names) {
        const p = prefix(n);
        const s = p && shared.get(p) > 1 ? `${p}*` : n;
        if (!out.includes(s)) out.push(s);
    }
    const list = out.slice(0, MAX_LABEL_NAMES).join(', ') + (out.length > MAX_LABEL_NAMES ? ', ...' : '');
    return ore ? `${ore} (any of ${list})` : `any of ${list}`;
}

/** An inventory key: "name:meta" when the dump says the item has subtypes and a meta is given, else the bot name. */
export function itemKey(catalog, name, meta = null) {
    const n = botName(name);
    if (meta == null || meta === WILDCARD_META) return n;
    const it = catalog.getItem(n);
    return it?.propertiesKnown && it.hasSubtypes ? `${n}:${meta}` : n;
}

/** An inventory key as {name, meta}; meta null for a bare key. */
export function parseKey(key) {
    const i = key.lastIndexOf(':');
    const tail = i > 0 ? key.slice(i + 1) : '';
    return /^\d+$/.test(tail) ? { name: key.slice(0, i), meta: Number(tail) } : { name: key, meta: null };
}

/**
 * How many of a recipe's slots, for `times` crafts, the pools ({inventoryKey: count}) cannot fill now (canFill:
 * every member counts, no item for two slots). A bare key of an item with subtypes (a total, any variant) fills
 * only an any-meta slot.
 * @returns {number|null} null for an unknown recipe
 */
export function fillShortfall(catalog, recipe, pools, { times = 1 } = {}) {
    const stacks = [];
    for (const pool of pools) for (const [k, n] of Object.entries(pool ?? {})) {
        if (!(n > 0)) continue;
        const { name, meta } = parseKey(k);
        const it = catalog.getItem(name);
        stacks.push({ name, meta: meta ?? (it?.propertiesKnown && it.hasSubtypes ? -1 : 0), count: n });
    }
    return canFill(catalog, recipe, stacks, { times })?.missing ?? null;
}

/**
 * The rock recipe (rockRecipes) whose cobble, one in the cobblestone ore, the most held rocks make, or null
 * if no such rock is held. The first such recipe on a tie.
 * @param {(key: string) => number} have how many of an inventory key the bot holds
 * @returns {{rock: string, gives: string, have: number}|null} inventory keys
 */
export function cobbleFromRocks(catalog, have) {
    let best = null;
    for (const r of rockRecipes(catalog)) {
        if (!inOre(catalog, 'cobblestone', r.gives.name, r.gives.meta)) continue;
        const rock = itemKey(catalog, r.rock.name, r.rock.meta);
        const n = have(rock);
        if (n > 0 && (!best || n > best.have)) best = { rock, gives: itemKey(catalog, r.gives.name, r.gives.meta), have: n };
    }
    return best;
}

/** Whether an item is in an ore dictionary entry; meta null means any of its metas. */
export function inOre(catalog, ore, name, meta = null) {
    const full = name.includes(':') ? name : `minecraft:${name}`;
    return (catalog.oreDict(ore) ?? []).some((s) => s.name === full && (meta == null || s.meta === WILDCARD_META || s.meta === meta));
}

/**
 * An item's crafting recipes as the planner reads them, likeliest first (howToGet's order: pyrotech
 * inputs, then minecraft, then the rest; a 2x2 recipe before a table one), without the recipes the
 * registry install leaves out (dynamic, a failed sample grid, recipe-collisions.json's `drop`).
 * Stacks that are the result itself are taken out of an ingredient ("4 of any cobblestone -> 4
 * cobblestone" keeps the other cobbles); a recipe left with an empty ingredient is dropped.
 * @param {import('./catalog.js').RotnData} catalog
 * @param {string} item registry or bot name, no meta
 * @param {{meta?: number|null}} [opts] only recipes whose result has this meta
 * @returns {Array<{recipeId: string, requiresTable: boolean, gives: {name: string, meta: number, count: number, key: string},
 *           inputs: Array<{count: number, ore: string|null, members: Array<{name: string, meta: number|null}>, keys: string[], label: string}>,
 *           recipe: object}>} names are bot names; keys are the members' inventory keys, likeliest first; label is the
 *           one key, or the ore's label for several; `recipe` is the dump-shaped recipe for canFill (result stacks removed)
 */
export function planRecipes(catalog, item, { meta = null } = {}) {
    const drop = catalog.recipeCollisionsData?.drop ?? {};
    const out = [];
    for (const r of catalog.recipesFor(item, { meta: meta ?? undefined })) {
        const src = rawRecipe(catalog, r.id);
        if (src?.dynamic || src?.matchesSample === false || r.id in drop) continue;
        const isResult = (s) => s.name === r.result.name && (s.meta === WILDCARD_META || s.meta === r.result.meta);
        const strip = (c) => (c ? { ...c, stacks: (c.stacks ?? []).filter((s) => !s.nbt && !isResult(s)) } : c);
        const recipe = r.inShape ? { ...r, inShape: r.inShape.map((row) => row.map(strip)) } : { ...r, ingredients: (r.ingredients ?? []).map(strip) };
        const cells = (recipe.inShape ? recipe.inShape.flat() : recipe.ingredients).filter(Boolean);
        if (cells.some((c) => c.stacks.length === 0)) continue;
        const groups = new Map();
        for (const c of cells) {
            const k = JSON.stringify(c.stacks);
            if (!groups.has(k)) {
                const stacks = c.stacks.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s.name) - rank(b.s.name) || a.i - b.i).map((x) => x.s);
                const wild = new Set(stacks.filter((s) => s.meta === WILDCARD_META).map((s) => s.name));
                const seen = new Set();
                const members = [];
                for (const s of stacks) {
                    const m = { name: botName(s.name), meta: s.meta === WILDCARD_META ? null : s.meta };
                    if (m.meta != null && wild.has(s.name)) continue;
                    const key = `${m.name}:${m.meta}`;
                    if (!seen.has(key)) { seen.add(key); members.push(m); }
                }
                const ore = c.ore ?? (c.ores?.length === 1 ? c.ores[0] : null);
                const keys = [...new Set(members.map((m) => itemKey(catalog, m.name, m.meta)))];
                const keyed = members.map((m) => ({ ...m, key: itemKey(catalog, m.name, m.meta) }));
                groups.set(k, { count: 0, ore, members, keys, label: keys.length === 1 ? keys[0] : oreLabel(ore, keyed) });
            }
            groups.get(k).count++;
        }
        const inputs = [...groups.values()];
        const score = inputs.reduce((a, g) => a + rank(g.members[0].name.includes(':') ? g.members[0].name : `minecraft:${g.members[0].name}`), 0) * 2 + (r.requiresTable ? 1 : 0);
        out.push({ recipeId: r.id, requiresTable: r.requiresTable, gives: { ...r.result, name: botName(r.result.name), key: itemKey(catalog, r.result.name, r.result.meta) }, inputs, recipe, score });
    }
    out.sort((a, b) => a.score - b.score || (a.gives.meta ? 1 : 0) - (b.gives.meta ? 1 : 0));
    // Recipes that differ only in their id (a vanilla and a CraftTweaker copy) are one.
    const seen = new Set();
    return out.filter((w) => {
        const k = JSON.stringify([w.requiresTable, w.gives, w.inputs]);
        if (seen.has(k)) return false;
        seen.add(k);
        delete w.score;
        return true;
    });
}
