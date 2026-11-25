// recipe-collisions.json from the dump: which crafting recipes' grids, as mineflayer lays them out, another recipe with a
// different result also matches on the server (#639 review 1). This is net-forge's soak 16 scan (its scratch
// `collide.cjs`, which produced /home/rv/soak16-recipe-collisions.txt and -any.txt; this file reproduces both lists),
// made a tool so the committed file can be regenerated and checked.
//
// The scan, for each dump recipe A (not dynamic, sample grid matched, every ingredient with a stack):
// - the grid mineflayer lays out: a shaped recipe at the top left; a shapeless one into the last free slots
//   (slot n*n - 1 - i for ingredient i); 2x2 without a table, 3x3 with one. In the first-ranked mode each ingredient
//   takes its first-ranked stack (pyrotech, then minecraft, then the rest; no NBT stacks; a wildcard as meta 0); in
//   the `any` mode each cell keeps the whole ingredient, so a recipe B matches when one of its stacks could fill it;
// - every other recipe B against that grid with the server's matcher: shaped at any offset and mirrored, empty cells
//   empty; shapeless as a one-to-one match of its ingredients to the filled cells; stacks equal by name and meta, a
//   wildcard meta matching any;
// - a pair is listed under A when B's result (name, meta, count) differs from A's.
// Only recipes with as many filled cells as the grid are compared (a shaped B needs every grid cell covered by its
// pattern with nothing outside it; a shapeless B one ingredient per filled cell), which changes no answer.
//
// The committed file takes `collisions` from the `any` mode (the wider list) and `firstRankedCount` from the
// first-ranked one; `drop` is the one recipe the server can never make here (the soak 16 stick wall case).
//
// Usage: node packages/rotn-data/tools/build-recipe-collisions.mjs [--check] [--list first|any]
//   --check compares with the committed file and exits 1 on a difference; --list prints a mode's list in
//   collide.cjs's text format instead (for diffing against an old scan). About 20 s per mode.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadRotnData } from '../src/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '../3.3.4/recipe-collisions.json');
const W = 32767;

const rank = (n) => (n.startsWith('pyrotech:') ? 0 : n.startsWith('minecraft:') ? 1 : 2);
const cellsOf = (x) => (x.type === 'shaped' ? x.slots : x.ingredients || []).filter(Boolean);
const best = (ing) => {
    const s = (ing.stacks || []).map((st, i) => ({ st, i })).filter((o) => !o.st.nbt).sort((a, b) => rank(a.st.name) - rank(b.st.name) || a.i - b.i)[0];
    return s ? { name: s.st.name, meta: s.st.meta === W ? 0 : s.st.meta } : null;
};
const one = (s, st) => s.name === st.name && (s.meta === W || st.meta === W || s.meta === st.meta);
// A grid cell is a stack ({name, meta}) in the first-ranked mode, an ingredient ({stacks}) in the any mode.
const ingMatch = (ing, c) => (c.stacks ? c.stacks.some((st) => (ing.stacks || []).some((s) => one(s, st))) : (ing.stacks || []).some((s) => one(s, c)));

function layout(A, any) {
    const n = A.requiresTable ? 3 : 2;
    const g = Array(n * n).fill(null);
    const pick = new Map();
    const choose = (ing) => {
        const k = JSON.stringify(ing.stacks);
        if (!pick.has(k)) pick.set(k, best(ing));
        return pick.get(k);
    };
    if (A.type === 'shaped') {
        if (A.width > n || A.height > n) return null;
        for (let y = 0; y < A.height; y++) {
            for (let x = 0; x < A.width; x++) {
                const ing = A.slots[y * A.width + x];
                if (!ing) continue;
                const s = any ? ing : choose(ing);
                if (!s) return null;
                g[y * n + x] = s;
            }
        }
    } else {
        if (A.ingredients.length > n * n) return null;
        A.ingredients.forEach((ing, i) => { g[n * n - 1 - i] = any ? ing : choose(ing); });
        if (g.some((c, i) => i >= n * n - A.ingredients.length && !c)) return null;
    }
    return { n, g };
}

function shapedMatches(B, { n, g }) {
    if (B.width > n || B.height > n) return false;
    for (let ox = 0; ox <= n - B.width; ox++) {
        for (let oy = 0; oy <= n - B.height; oy++) {
            for (const mir of [false, true]) {
                let ok = true;
                for (let y = 0; y < n && ok; y++) {
                    for (let x = 0; x < n && ok; x++) {
                        const bx = x - ox;
                        const by = y - oy;
                        let ing = null;
                        if (bx >= 0 && by >= 0 && bx < B.width && by < B.height) ing = B.slots[by * B.width + (mir ? B.width - 1 - bx : bx)];
                        const c = g[y * n + x];
                        if (!ing) { if (c) ok = false; } else if (!c || !ingMatch(ing, c)) ok = false;
                    }
                }
                if (ok) return true;
            }
        }
    }
    return false;
}

function shapelessMatches(B, { g }) {
    const cells = g.filter(Boolean);
    if (cells.length !== B.ingredients.length) return false;
    const used = Array(cells.length).fill(-1);
    const tryI = (i, seen) => {
        for (let c = 0; c < cells.length; c++) {
            if (seen[c] || !ingMatch(B.ingredients[i], cells[c])) continue;
            seen[c] = true;
            if (used[c] < 0 || tryI(used[c], seen)) { used[c] = i; return true; }
        }
        return false;
    };
    for (let i = 0; i < B.ingredients.length; i++) if (!tryI(i, Array(cells.length).fill(false))) return false;
    return true;
}

const key = (res) => `${res.name}:${res.meta}x${res.count}`;
const scannable = (recipes) => recipes.filter((x) => !x.dynamic && x.matchesSample !== false && x.result && cellsOf(x).length && cellsOf(x).every((c) => (c.stacks || []).length));

/**
 * The scan in one mode.
 * @param {object[]} dumpRecipes recipes.json's `recipes`
 * @param {boolean} any every stack an ingredient allows (true) or its first-ranked stack (false)
 * @returns {{scanned: number, types: object, out: {a: object, grid: string, table: boolean, others: object[]}[]}}
 */
export function scanCollisions(dumpRecipes, any) {
    const recipes = scannable(dumpRecipes);
    const byCells = new Map();
    for (const B of recipes) {
        const k = cellsOf(B).length;
        if (!byCells.has(k)) byCells.set(k, []);
        byCells.get(k).push(B);
    }
    const out = [];
    for (const A of recipes) {
        const L = layout(A, any);
        if (!L) continue;
        const filled = L.g.filter(Boolean).length;
        const others = [];
        for (const B of byCells.get(filled) ?? []) {
            if (B === A) continue;
            const m = B.type === 'shaped' ? shapedMatches(B, L) : B.type === 'shapeless' ? shapelessMatches(B, L) : false;
            if (m && key(B.result) !== key(A.result)) others.push(B);
        }
        if (others.length) {
            out.push({
                a: A, table: L.n === 3, others,
                grid: L.g.map((c) => (c ? (c.stacks ? (c.ore || c.stacks[0].name) : `${c.name}:${c.meta}`) : '_')).join(' '),
            });
        }
    }
    const types = {};
    for (const x of dumpRecipes) types[x.type] = (types[x.type] || 0) + 1;
    return { scanned: recipes.length, types, out };
}

/** A mode's list in collide.cjs's text format (the lines it printed). */
export function collisionListText(scan) {
    const line = (x) => `${x.id} -> ${x.result.count} ${key(x.result)}`;
    const lines = [`recipe types ${JSON.stringify(scan.types)} scanned ${scan.scanned} colliding ${scan.out.length}`];
    for (const o of scan.out) lines.push(`${line(o.a)}  [${o.table ? '3x3' : '2x2'}] grid ${o.grid}\n    also: ${o.others.map(line).join('; ')}`);
    return lines.join('\n') + '\n';
}

export const DROP = {
    'dungeontactics:misc/convenience/planks_from_sticks': '9 sticks in the 3x3 grid; the server\'s ancientbeasts:stick_wall (9 sticks) is registered first and always wins (soak 16, seen in the journal), so this recipe can never be crafted here',
};

/** recipe-collisions.json's content from the dump's recipes. */
export function buildRecipeCollisions(dumpRecipes) {
    const any = scanCollisions(dumpRecipes, true);
    const first = scanCollisions(dumpRecipes, false);
    const collisions = {};
    for (const o of any.out) collisions[o.a.id] = [...new Set(o.others.map((b) => b.id))].sort();
    const sorted = Object.fromEntries(Object.keys(collisions).sort().map((k) => [k, collisions[k]]));
    return {
        format: 'rotn-recipe-collisions/1',
        pack: '3.3.4',
        description: 'Crafting recipes whose grid, as mineflayer lays it out, another recipe with a different result also matches on the server, for installRecipes. A grid matched by two recipes gives the one registered first (CraftingManager.REGISTRY order), which the dump does not record, so the bot may get the other recipe\'s result (soak 16: 9 sticks made ancientbeasts:stick_wall, not planks). Built by tools/build-recipe-collisions.mjs from the dump (net-forge\'s soak 16 scan, /home/rv/soak16-net-forge-recipe.md section 4): for each recipe A, the grid mineflayer lays out (shaped at the top left, shapeless into the last free slots; 2x2 without a table, 3x3 with one) with any stack each ingredient allows, checked against every other recipe B with the server\'s matcher (any offset, mirrored, ore stacks, wildcard metadata, shapeless as a multiset); a pair where B\'s result differs is listed under A. Recipes that are dynamic, failed the sample grid or have an ingredient with no stack are not scanned; CraftTweaker conditions and NBT are not modelled.',
        use: 'installRecipes drops the recipes in `drop` and, for each recipe in `collisions`, puts the variants one of its listed recipes also accepts (a multiset match of the variant\'s items to that recipe\'s ingredients) after every other variant of the same result. So recipes[0] and bot.recipesFor\'s first choice are a grid only one recipe matches whenever such a variant exists; a variant that may be shadowed is still offered last.',
        sources: { scan: 'tools/build-recipe-collisions.mjs (net-forge\'s soak 16 scan, /home/rv/soak16-net-forge-recipe.md section 4)', dump: 'packages/rotn-data/3.3.4/recipes.json.br' },
        drop: { ...DROP },
        firstRankedCount: first.out.length,
        collisions: sorted,
        unverified: ['Which recipe of each pair the server picks (registration order) is not in the dump; only the planks/stick wall case was seen. The next dump will record CraftingManager.REGISTRY ids (rotn-data STATUS, Doing).'],
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const a = process.argv.slice(2);
    const recipes = loadRotnData('3.3.4').dump.recipes.recipes;
    if (a.includes('--list')) {
        const mode = a[a.indexOf('--list') + 1];
        if (mode !== 'first' && mode !== 'any') { console.error('usage: build-recipe-collisions.mjs --list first|any'); process.exit(2); }
        process.stdout.write(collisionListText(scanCollisions(recipes, mode === 'any')));
        process.exit(0);
    }
    const json = JSON.stringify(buildRecipeCollisions(recipes), null, 1) + '\n';
    if (a.includes('--check')) {
        const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') === json;
        console.log(same ? 'recipe-collisions.json is up to date' : 'recipe-collisions.json differs from a rebuild');
        process.exit(same ? 0 : 1);
    }
    fs.writeFileSync(OUT, json);
    const r = JSON.parse(json);
    console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${Object.keys(r.collisions).length} recipes (first-ranked ${r.firstRankedCount}), drop ${Object.keys(r.drop).length}`);
}
