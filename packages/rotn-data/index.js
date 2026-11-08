// @mindcraft-rotn/rotn-data: RotN 3.3.4 facts and 1.12 <-> 1.21 name translation
// (rotn-data brief, deliverables 2 and 3). See README.md for the API and data format.
import { loadRotnData, RotnData, DUMP_FORMAT } from './src/catalog.js';
import { installRecipes as installRecipesInto } from './src/registry-recipes.js';
import { installFoods as installFoodsInto } from './src/foods.js';

export { loadRotnData, RotnData, DUMP_FORMAT };
export { createTranslator } from './src/translate.js';
export { registryName, botName, parseOld, formatOld, WILDCARD_META } from './src/names.js';

/** The pack version this project pins (ADR 0005). */
export const PACK_VERSION = '3.3.4';

const pack = () => loadRotnData(PACK_VERSION);

// Name translation, checked against the names the RotN 3.3.4 server syncs.
export const toNew = (oldName, meta = 0) => pack().translator.toNew(oldName, meta);
export const toOld = (newName) => pack().translator.toOld(newName);
export const blockToNew = (oldName, meta = 0) => pack().translator.blockToNew(oldName, meta);
export const blockToOld = (newName) => pack().translator.blockToOld(newName);

// Catalog (brief deliverable 2).
export const getBlock = (name) => pack().getBlock(name);
export const getItem = (name) => pack().getItem(name);
export const recipesFor = (item, opts) => pack().recipesFor(item, opts);
export const smeltingFor = (item) => pack().smeltingFor(item);
export const harvestInfo = (block, meta) => pack().harvestInfo(block, meta);
export const foodValues = (item, meta) => pack().foodValues(item, meta);
export const avoidFood = (item, meta) => pack().avoidFood(item, meta);
export const falls = (block) => pack().falls(block);
export const lookup = (query, opts) => pack().lookup(query, opts);
// "How do I get X" (Phase 3): world rules (3.3.4/world-sources.json), recipes, smelting, plain drops.
export const howToGet = (item, opts) => pack().howToGet(item, opts);
export const rockRecipes = () => pack().rockRecipes();
// Can these inventory stacks fill this recipe or craft way? One rule for rotn-data and skills-rotn (#152 review).
export const canFill = (recipe, stacks, opts) => pack().canFill(recipe, stacks, opts);
export { formatHowToGet } from './src/howto.js';
// First-night threats (Phase 3): reaction per mob (3.3.4/threat-reactions.json) and night spawns per biome.
export const threatOf = (entityName) => pack().threatOf(entityName);
export const nightThreats = (opts) => pack().nightThreats(opts);
export const mobDigging = (entityName) => pack().mobDigging(entityName);
export const canMobDig = (entityName, blockName, opts) => pack().canMobDig(entityName, blockName, opts);
// Wild food (G4 #5): berry bushes, herbs, gardens, mushrooms and plant hazards (3.3.4/forage-food.json).
export const forageFood = (block, meta) => pack().forageFood(block, meta);
export const forageSources = (opts) => pack().forageSources(opts);
export const forageHazard = (block, meta) => pack().forageHazard(block, meta);
export { NIGHT_THREATS_NOT_REFLECTED } from './src/threats.js';
export const entity = (name) => pack().entity(name);
export const entityByModId = (modId, typeId) => pack().entityByModId(modId, typeId);
export const isDangerous = (name) => pack().isDangerous(name);
export const isReplaced = (name) => pack().isReplaced(name);
export const modEntityTable = () => pack().modEntityTable();
export const stateMetaRemap = () => pack().stateMetaRemap();
export const clientMeta = (block, idMeta) => pack().clientMeta(block, idMeta);
export const networkRemap = (blockIds) => pack().networkRemap(blockIds);

/**
 * Replace bot.registry.recipes' contents, in place, with RotN's crafting recipes from the dump,
 * keyed by that registry's (the connected server's) item ids. See src/registry-recipes.js.
 * @param {object} registry bot.registry after forge-bridge's extendRegistry
 * @param {{recipes?: object[], maxVariants?: number}} [opts] recipes: the dump's recipe list to use
 *        (default: the pinned pack's); mcdata.installRotnRecipesOnce passes its injected catalog's
 */
export const installRecipes = (registry, { recipes, ...opts } = {}) => installRecipesInto(registry, recipes ?? pack().dump.recipes?.recipes ?? [], opts);
/**
 * Replace bot.registry.foods / foodsByName / foodsArray, in place, with this pack's food values
 * (mineflayer-auto-eat and bot.registry readers then see them). See src/foods.js. It bans nothing and
 * is meta 0 only (a pufferfish looks like cod): the eating code must check avoidFood(name, meta).
 */
export const installFoods = (registry) => installFoodsInto(registry, (n, m) => pack().foodValues(n, m));
export { convertRecipe, choiceTuples, DEFAULT_MAX_VARIANTS, snapshotRecipeTable, restoreRecipeTable } from './src/registry-recipes.js';
