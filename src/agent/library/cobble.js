// skills-rotn (G3 round 3 batch A): which cobblestone the bot's rocks make. In RotN each rock kind
// has its own 4-rocks recipe (rotn-data rockRecipes: 35 of them); "cobblestone" is any output in
// rotn-data's cobblestone ore (vanilla, Underground Biomes and ContentTweaker cobbles), not the
// sandstones, holystone or defiled stone some rocks also make. The round 3 bot held 8 sedimentary
// rocks, and !craftRecipe("cobblestone") looked at vanilla cobblestone's recipes (4 plain rocks,
// or Twilight Forest's giant cobblestone) instead of chalk cobble.
import { rockRecipes, recipesFor, loadRotnData, PACK_VERSION, botName, WILDCARD_META } from '../../../packages/rotn-data/index.js';
import { countItem, formatName } from './rotn_names.js';

/** Rocks per cobblestone (every rock recipe is 4 of one kind). */
export const ROCKS_PER_COBBLE = 4;

let recipes = null;
/**
 * [{rock, gives, recipeId, requiresTable}] in bot names: the rock recipes whose output is
 * cobblestone. Cached only when the ore and the recipes loaded (#233 review 4: a failed load was
 * cached for the life of the process).
 */
const loadRotn = () => ({ ore: loadRotnData(PACK_VERSION).oreDict('cobblestone') ?? [], rocks: rockRecipes() ?? [] });

export function cobbleRecipes(load = loadRotn, { tableLookup = recipesFor } = {}) {
    if (recipes) return recipes;
    let ore = [];
    let rocks = [];
    try {
        ({ ore, rocks } = load());
    } catch { return []; }
    const inOre = (g) => ore.some(m => m.name === g.name && (m.meta == null || m.meta === WILDCARD_META || m.meta === g.meta));
    let lookupFailed = false;
    const tableFor = (r) => {
        try { return !!tableLookup(r.gives.name)?.find(x => x.id === r.recipeId)?.requiresTable; }
        catch { lookupFailed = true; return false; } // a guess: not cached (#234 nit)
    };
    const list = rocks.filter(r => inOre(r.gives)).map(r => ({
        rock: formatName(botName(r.rock.name), r.rock.meta),
        gives: formatName(botName(r.gives.name), r.gives.meta),
        recipeId: r.recipeId,
        requiresTable: tableFor(r),
    }));
    if (ore.length && list.length && !lookupFailed) recipes = list;
    return list;
}

/** Tests only: forget the cache. */
export function __resetCobbleCache() {
    recipes = null;
}

/** A request for cobblestone in general ("cobblestone"), not one named kind. */
export const isGenericCobble = (name) => typeof name === 'string' && /^(minecraft:)?cobblestone$/i.test(name.trim());

/** The cobblestones the bot can make now: one per rock kind it has 4 of, most rocks first. */
export function cobbleChoices(bot) {
    return cobbleRecipes()
        .map(r => ({ ...r, have: countItem(bot, r.rock) }))
        .filter(c => c.have >= ROCKS_PER_COBBLE)
        .sort((a, b) => b.have - a.have);
}

/** The rock kinds the bot holds that make cobblestone, for a log line ("3 pyrotech_compat:rock_sedimentary:1"). */
export function cobbleRocksHeld(bot) {
    return cobbleRecipes().map(r => ({ ...r, have: countItem(bot, r.rock) })).filter(c => c.have > 0).sort((a, b) => b.have - a.have);
}
