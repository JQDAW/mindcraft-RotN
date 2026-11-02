// RotN 3.3.4's crafting recipes in minecraft-data's recipe format, keyed by the connected server's
// numeric item ids (rotn-data brief item 4: getItemCraftingRecipes and getDetailedCraftingPlan on
// RotN recipes; ADR 0004: prismarine-recipe-compatible shape).
//
// Why: bot.registry.recipes is minecraft-data's vanilla 1.12.2 table. RotN removes or rewrites many
// of those recipes (no wooden tools, the stone pickaxe from 3 rocks, the crafting table from a plank
// and Crafting Tools), so mineflayer's bot.recipesFor / bot.craft and Mindcraft's
// getItemCraftingRecipes would plan crafts the server refuses. installRecipes() replaces the table's
// contents with the dump's recipes (the server's CraftingManager after CraftTweaker).
//
// In place: mineflayer's craft plugin binds prismarine-recipe to the registry when the bot is
// created, and prismarine-recipe keeps a reference to registry.recipes. So the object is emptied
// and refilled, never replaced. (In one process the object is minecraft-data's cached 1.12.2 table,
// so every user of minecraftData('1.12.2') sees RotN recipes afterwards; a bot process is RotN-only.)
//
// Ore dictionary and alternatives: a dump ingredient lists every stack that matches it, but a
// minecraft-data slot holds one {id, metadata}. Each dump recipe becomes several variants, one per
// choice of stack; slots with the same ingredient take the same stack (all planks of one wood).
// Variants are listed likeliest first (pyrotech: stacks, then minecraft:, then the rest, each in the dump's order; choices with a smaller index sum first) and capped per recipe
// (maxVariants), because some recipes have tens of thousands of combinations. An item's recipes are
// ordered the same way (the sum of their ingredients' best stack ranks), recipes without a table
// first on a tie, then result metadata 0, so the first variant is the early-game path (3 rocks, not 3 flint, for the stone
// pickaxe; sticks from planks, not from bamboo). They are built lazily, per result id, on
// first access, so only the items the bot asks about cost anything.
//
// Skipped: recipes the dumper flags dynamic or whose sample grid did not match (matchesSample false),
// stacks with NBT (a slot cannot require NBT here), stacks whose item the registry does not know,
// recipes left with an ingredient that has no usable stack, and variants that take the result itself
// (same id, same or any metadata): an ore dictionary conversion such as "4 cobblestone (any
// cobblestone) -> 4 cobblestone" would otherwise list the result as its own first ingredient. Wildcard metadata (32767) becomes
// metadata null, which prismarine-recipe and mineflayer treat as "any". Each result carries
// `meta` next to `metadata`, so Recipe.find(id, meta) (bot.recipesFor) returns only that metadata's recipes.
//
// Not emitted: outShape (the dump's `remaining`, items left in the grid such as buckets; 1,116 of
// 6,089 recipes, none on the G3 path). prismarine-recipe 1.5.0's computeDelta reads inShape when
// it applies outShape (applyShape uses recipe.inShape[y]), so a recipe with an outShape would
// count every input as returned and look free to bot.recipesFor. It needs a prismarine-recipe
// patch first (#102 review follow-up; STATUS).
import { botName, WILDCARD_META } from './names.js';

export const DEFAULT_MAX_VARIANTS = 256;

const rank = (name) => (name.startsWith('pyrotech:') ? 0 : name.startsWith('minecraft:') ? 1 : 2);

/** Sort key of a dump recipe: its ingredients' best ranks summed, then a table last. */
function recipeScore(r) {
    const cells = (Array.isArray(r.slots) ? r.slots : (r.ingredients ?? [])).filter(Boolean);
    const groups = new Map(cells.map((c) => [JSON.stringify(c.stacks ?? []), c]));
    let s = 0;
    for (const c of groups.values()) s += Math.min(2, ...(c.stacks ?? []).map((x) => rank(x.name)));
    return s * 2 + (r.requiresTable ? 1 : 0);
}

/** The registry's numeric id for a registry name, or null. */
function itemId(registry, name) {
    const e = registry.itemsByName?.[botName(name)];
    return e && Number.isInteger(e.id) ? e.id : null;
}

/** Usable {id, metadata} choices for one dump ingredient, likeliest first, without duplicates. */
function candidates(registry, ingredient) {
    const seen = new Set();
    const out = [];
    const stacks = (ingredient?.stacks ?? []).map((s, i) => ({ s, i }))
        .sort((a, b) => rank(a.s.name) - rank(b.s.name) || a.i - b.i);
    for (const { s } of stacks) {
        if (s.nbt) continue;
        const id = itemId(registry, s.name);
        if (id === null) continue;
        const metadata = s.meta === WILDCARD_META || s.meta == null ? null : s.meta;
        const key = `${id}:${metadata}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id, metadata });
    }
    return out;
}

/**
 * Index tuples over group sizes, smallest index sum first, at most `max` of them.
 * @param {number[]} sizes
 * @param {number} max
 * @returns {number[][]}
 */
export function choiceTuples(sizes, max) {
    const out = [];
    if (sizes.some((n) => n <= 0)) return out;
    const maxSum = sizes.reduce((a, n) => a + n - 1, 0);
    const walk = (i, left, acc) => {
        if (out.length >= max) return;
        if (i === sizes.length) {
            if (left === 0) out.push([...acc]);
            return;
        }
        // What the remaining groups can still absorb bounds this group's index from below.
        const restMax = sizes.slice(i + 1).reduce((a, n) => a + n - 1, 0);
        for (let k = Math.max(0, left - restMax); k <= Math.min(sizes[i] - 1, left); k++) {
            acc.push(k);
            walk(i + 1, left - k, acc);
            acc.pop();
            if (out.length >= max) return;
        }
    };
    for (let s = 0; s <= maxSum && out.length < max; s++) walk(0, s, []);
    return out;
}

/**
 * The minecraft-data recipe variants of one dump recipe ([] if it cannot be used).
 * @returns {{variants: object[], skipped: string|null, truncated: boolean}}
 */
export function convertRecipe(registry, r, { maxVariants = DEFAULT_MAX_VARIANTS } = {}) {
    if (r.dynamic) return { variants: [], skipped: 'dynamic', truncated: false };
    if (r.matchesSample === false) return { variants: [], skipped: 'sample grid did not match', truncated: false };
    const resultId = itemId(registry, r.result?.name ?? '');
    if (resultId === null) return { variants: [], skipped: 'result not in the registry', truncated: false };
    const shaped = Array.isArray(r.slots);
    const cells = shaped ? r.slots : (r.ingredients ?? []);
    // Group equal ingredients so they take the same stack.
    const groups = new Map();
    const slotGroup = cells.map((c) => {
        if (!c) return null;
        const key = JSON.stringify(c.stacks ?? []);
        if (!groups.has(key)) groups.set(key, candidates(registry, c));
        return key;
    });
    const keys = [...groups.keys()];
    if (keys.some((k) => groups.get(k).length === 0)) return { variants: [], skipped: 'an ingredient has no usable stack', truncated: false };
    const sizes = keys.map((k) => groups.get(k).length);
    const tuples = choiceTuples(sizes, maxVariants);
    const total = sizes.reduce((a, n) => a * n, 1);
    // `meta` as well as `metadata` (#102 review): prismarine-recipe's Recipe.find filters by the
    // requested metadata only when the result has a `meta` key, so without it bot.recipesFor(planks,
    // 1) would also return oak planks recipes for spruce.
    const meta = r.result.meta ?? 0;
    const result = { id: resultId, metadata: meta, meta, count: r.result.count ?? 1 };
    const takesResult = (c) => c.id === result.id && (c.metadata === null || c.metadata === result.metadata);
    const variants = tuples.filter((t) => !keys.some((k, i) => takesResult(groups.get(k)[t[i]]))).map((t) => {
        const pick = new Map(keys.map((k, i) => [k, groups.get(k)[t[i]]]));
        const items = slotGroup.map((k) => (k === null ? null : { ...pick.get(k) }));
        if (!shaped) return { ingredients: items.filter(Boolean), result: { ...result } };
        const w = r.width;
        const inShape = [];
        for (let y = 0; y < r.height; y++) inShape.push(items.slice(y * w, (y + 1) * w));
        return { inShape, result: { ...result } };
    });
    return { variants, skipped: null, truncated: total > tuples.length };
}

/**
 * Replace registry.recipes' contents (in place) with the dump's recipes, built lazily per result id.
 * @param {object} registry bot.registry (prismarine-registry, extended by forge-bridge)
 * @param {object[]} dumpRecipes the dump's recipes.json `recipes` list
 * @param {{maxVariants?: number}} [opts]
 * @returns {{results: number, recipes: number, resultNotInRegistry: number, stats: () => object}}
 */
export function installRecipes(registry, dumpRecipes, { maxVariants = DEFAULT_MAX_VARIANTS } = {}) {
    if (!registry || typeof registry !== 'object') throw new TypeError('installRecipes: a registry is required');
    if (!registry.recipes || typeof registry.recipes !== 'object') registry.recipes = {};
    const target = registry.recipes;
    for (const k of Object.keys(target)) delete target[k];
    const byResult = new Map();
    let resultNotInRegistry = 0;
    for (const r of dumpRecipes ?? []) {
        const id = itemId(registry, r.result?.name ?? '');
        if (id === null) { resultNotInRegistry++; continue; }
        if (!byResult.has(id)) byResult.set(id, []);
        byResult.get(id).push(r);
    }
    const built = { results: 0, variants: 0, skipped: {}, truncated: 0 };
    for (const [id, list] of byResult) {
        Object.defineProperty(target, id, {
            enumerable: true,
            configurable: true,
            get() {
                const variants = [];
                // Likeliest first; on a tie metadata 0 (oak planks, not acacia), then the dump's order.
                const ordered = list.map((r, i) => ({ r, i, s: recipeScore(r), m: r.result?.meta ? 1 : 0 }))
                    .sort((a, b) => a.s - b.s || a.m - b.m || a.i - b.i).map((x) => x.r);
                for (const r of ordered) {
                    const c = convertRecipe(registry, r, { maxVariants });
                    if (c.skipped) built.skipped[c.skipped] = (built.skipped[c.skipped] ?? 0) + 1;
                    if (c.truncated) built.truncated++;
                    variants.push(...c.variants);
                }
                built.results++;
                built.variants += variants.length;
                Object.defineProperty(target, id, { value: variants, enumerable: true, configurable: true, writable: true });
                return variants;
            },
        });
    }
    return {
        results: byResult.size,
        recipes: [...byResult.values()].reduce((a, l) => a + l.length, 0),
        resultNotInRegistry,
        /** What lazy building has done so far. */
        stats: () => ({ ...built, skipped: { ...built.skipped } }),
    };
}
