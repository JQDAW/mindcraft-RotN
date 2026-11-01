// Matches expected recipes (transcribed from the pack's CraftTweaker scripts,
// test/fixtures/scripts-3.3.4-early-recipes.json) against recipes in the dump.
// ADR 0004: the dump is the source of truth; the scripts are a cross-check.
import { parseOld, WILDCARD_META } from './names.js';

const key = (s) => `${s.name}:${s.meta}`;

/** Expand one expected alternative list (["ore:rock", "minecraft:flint", "x:y:*"]) into a set of "name:meta". */
export function expandAlternatives(alts, oreDict) {
    const out = new Set();
    for (const a of alts) {
        if (a.startsWith('ore:')) {
            const stacks = oreDict(a.slice(4));
            if (!stacks) throw new Error(`ore dictionary has no ${a}`);
            for (const s of stacks) out.add(key(s));
        } else if (a.endsWith(':*')) {
            const p = parseOld(a.slice(0, -2));
            out.add(`${p.name}:${WILDCARD_META}`);
        } else {
            const p = parseOld(a);
            out.add(`${p.name}:${p.meta ?? 0}`);
        }
    }
    return out;
}

const ingredientSet = (ing) => new Set((ing?.stacks ?? []).map(key));
const eqSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

/** Remove empty rows and columns from a grid of (ingredient|null). */
export function trimGrid(grid) {
    let rows = grid.filter(r => r.some(c => c != null));
    if (rows.length === 0) return [];
    const width = Math.max(...rows.map(r => r.length));
    rows = rows.map(r => Array.from({ length: width }, (_, i) => r[i] ?? null));
    const keep = [];
    for (let x = 0; x < width; x++) if (rows.some(r => r[x] != null)) keep.push(x);
    const first = keep[0];
    const last = keep[keep.length - 1];
    return rows.map(r => r.slice(first, last + 1));
}

const mirror = (grid) => grid.map(r => [...r].reverse());

function gridsMatch(expected, actual) {
    if (expected.length !== actual.length) return false;
    return expected.every((row, y) => row.length === actual[y].length && row.every((e, x) => {
        const a = actual[y][x];
        if (e == null || a == null) return e == null && a == null;
        return eqSet(e, ingredientSet(a));
    }));
}

function multisetMatch(expected, actual) {
    if (expected.length !== actual.length) return false;
    const used = new Array(actual.length).fill(false);
    return expected.every(e => {
        const i = actual.findIndex((a, j) => !used[j] && eqSet(e, ingredientSet(a)));
        if (i < 0) return false;
        used[i] = true;
        return true;
    });
}

/**
 * @param {object} expected  one entry of the fixture
 * @param {object} recipe    one entry of catalog.recipesFor() (named shape)
 * @param {(key: string) => Array<{name, meta}>|null} oreDict
 */
export function recipeMatches(expected, recipe, oreDict) {
    if (recipe.result.name !== expected.result.name) return false;
    if ((recipe.result.count ?? 1) !== (expected.result.count ?? 1)) return false;
    if (expected.type === 'shapeless') {
        if (recipe.type !== 'shapeless') return false;
        return multisetMatch(expected.ingredients.map(a => expandAlternatives(a, oreDict)), recipe.ingredients);
    }
    if (recipe.type !== 'shaped') return false;
    const want = trimGrid(expected.shape.map(r => r.map(c => (c ? expandAlternatives(c, oreDict) : null))));
    const have = trimGrid(recipe.inShape);
    if (gridsMatch(want, have)) return true;
    return !!expected.mirrored && gridsMatch(mirror(want), have);
}
