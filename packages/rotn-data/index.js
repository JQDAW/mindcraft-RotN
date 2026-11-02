// @mindcraft-rotn/rotn-data: RotN 3.3.4 facts and 1.12 <-> 1.21 name translation
// (rotn-data brief, deliverables 2 and 3). See README.md for the API and data format.
import { loadRotnData, RotnData, DUMP_FORMAT } from './src/catalog.js';
import { installRecipes as installRecipesInto } from './src/registry-recipes.js';

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
export const lookup = (query, opts) => pack().lookup(query, opts);
// "How do I get X" (Phase 3): world rules (3.3.4/world-sources.json), recipes, smelting, plain drops.
export const howToGet = (item, opts) => pack().howToGet(item, opts);
export const rockRecipes = () => pack().rockRecipes();
export { formatHowToGet } from './src/howto.js';
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
 * @param {{maxVariants?: number}} [opts]
 */
export const installRecipes = (registry, opts) => installRecipesInto(registry, pack().dump.recipes?.recipes ?? [], opts);
export { convertRecipe, choiceTuples, DEFAULT_MAX_VARIANTS } from './src/registry-recipes.js';
