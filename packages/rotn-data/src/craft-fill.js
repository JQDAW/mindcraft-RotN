// "Can these stacks fill this craft?" (#152 review, for skills-rotn #151): one rule shared by
// rotn-data's recipe variants and the skills layer. Each slot of a dump recipe accepts any stack its
// ingredient lists (wildcard metadata = any meta; stacks that need NBT are not matched, as in
// registry-recipes.js), slots are independent (the server accepts a mix, e.g. 1 igneous + 2
// metamorphic rocks for a stone pickaxe), and one item is never counted for two slots: slots are
// matched to item units by bipartite matching, so "sand (any)" plus "red sand" in one recipe does not
// count the same red sand twice. Pure functions over a RotnData catalog.
import { WILDCARD_META } from './names.js';

const fullName = (n) => (typeof n === 'string' && !n.includes(':') ? `minecraft:${n}` : n);

/** The non-empty slots of a dump-shaped recipe (catalog.recipesFor: inShape or ingredients). */
function slotsOf(recipe) {
    const cells = recipe.inShape ? recipe.inShape.flat() : recipe.ingredients ?? (Array.isArray(recipe.slots) ? recipe.slots : []);
    return cells.filter(Boolean);
}

const accepts = (ingredient, stack) => (ingredient.stacks ?? []).some((s) => !s.nbt
    && fullName(s.name) === stack.name && (s.meta == null || s.meta === WILDCARD_META || s.meta === stack.meta));

/**
 * Whether `stacks` can fill a recipe `times` times.
 * @param {import('./catalog.js').RotnData} catalog
 * @param {object|string} recipe a howToGet craft way ({ recipeId }), a recipe id, or a dump-shaped
 *        recipe (catalog.recipesFor's inShape/ingredients)
 * @param {Array<{name: string, meta?: number, metadata?: number, count: number}>} stacks the inventory
 *        (bot item names like "stick" or full names like "minecraft:stick")
 * @param {{times?: number}} [opts]
 * @returns {{ok: boolean, missing: number, assignment: Array<{name: string, meta: number}|null>, recipeId: string|null}|null}
 *          assignment: per slot of the first craft only (with times > 1, the slots of the later crafts
 *          are matched too, but not listed), the stack it takes (null if none); null for an unknown recipe
 */
export function canFill(catalog, recipe, stacks, { times = 1 } = {}) {
    const r = typeof recipe === 'string' ? catalog.recipeById(recipe)
        : recipe?.recipeId && !recipe.inShape && !recipe.ingredients ? catalog.recipeById(recipe.recipeId) : recipe;
    if (!r) return null;
    const slots = slotsOf(r);
    const need = slots.length * Math.max(1, times);
    // Item units, at most as many per stack as there are slots to fill. Stacks no slot accepts are
    // dropped first, so a full inventory of unrelated items does not slow the matching (#152 nit).
    const units = [];
    for (const s of stacks ?? []) {
        const stack = { name: fullName(s.name), meta: s.meta ?? s.metadata ?? 0 };
        if (!slots.some((slot) => accepts(slot, stack))) continue;
        for (let i = 0; i < Math.min(s.count ?? 0, need); i++) units.push(stack);
    }
    // Kuhn's augmenting paths: slot k (of `times` copies) -> a unit it accepts.
    const owner = new Array(units.length).fill(-1);
    const slotOf = (k) => slots[k % slots.length];
    const tryAssign = (k, seen) => {
        for (let u = 0; u < units.length; u++) {
            if (seen[u] || !accepts(slotOf(k), units[u])) continue;
            seen[u] = true;
            if (owner[u] === -1 || tryAssign(owner[u], seen)) { owner[u] = k; return true; }
        }
        return false;
    };
    let filled = 0;
    for (let k = 0; k < need; k++) if (tryAssign(k, new Array(units.length).fill(false))) filled++;
    const assignment = slots.map((_, k) => {
        const u = owner.indexOf(k);
        return u < 0 ? null : { name: units[u].name, meta: units[u].meta };
    });
    return { ok: filled === need, missing: need - filled, assignment, recipeId: r.id ?? null };
}
