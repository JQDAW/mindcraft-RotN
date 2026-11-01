import minecraftData from 'minecraft-data';
import settings from '../agent/settings.js';
import { createBot } from 'mineflayer';
import prismarine_items from 'prismarine-item';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as pvp } from 'mineflayer-pvp';
import { plugin as collectblock } from 'mineflayer-collectblock';
import { plugin as autoEat } from 'mineflayer-auto-eat';
import plugin from 'mineflayer-armor-manager';
import { createForgeConnect, CaptureWriter, throttleMovement, forgeOptionsFromEnv, assertMicrosoftAuthSafe, quietMsaCodeHandler, recordAgentExit, extendRegistry, attachFmlEntities } from '../../packages/forge-bridge/index.js';
import { toNew as rdToNew, toOld as rdToOld, blockToOld, parseOld, botName } from '../../packages/rotn-data/index.js';
const armorManager = plugin;
let mc_version = settings.minecraft_version;
let mcdata = null;
let Item = null;

// rotn-data brief item 4: the name and registry helpers below read `mcdata`, which initBot sets to
// bot.registry at login (net-forge #46; forge-bridge extends it with the server's modded ids,
// ADR 0003 decision 4). Before login it is null, as upstream.
const reg = () => mcdata;

/** Test-only: point the helpers at a registry without a live bot (sets the same `mcdata`). */
export function __setRegistryForTest(registry) {
    mcdata = registry;
}

/**
 * The agent's naming API (lead decision for #44; harness-ops' G2 check imports it).
 * Same signatures and null semantics as packages/rotn-data's toNew/toOld:
 * toNew('log', 1) / toNew('log:1') -> 'spruce_log'; toNew('pyrotech:rock', 6) -> 'pyrotech:rock:6';
 * toOld('oak_log') -> { name: 'minecraft:log', meta: 0 }; anything unmappable -> null.
 */
export function toNew(name, meta = 0) {
    return rdToNew(name, meta);
}

export function toOld(name) {
    return rdToOld(name);
}

/**
 * Resolve a block or item name to the name the bot's registry uses, plus metadata.
 * Accepts 1.12 names ("log", "log:1", "minecraft:log"), modded names ("pyrotech:rock",
 * "pyrotech:rock:6") and 1.21-style names ("oak_log", "short_grass"), via rotn-data.
 *
 * Order (rotn-data follow-up 3): with prefer 'old' (the default), a name the registry has as is
 * wins, so a name valid in both versions keeps its 1.12 meaning: grass (the grass block, not the
 * plant), stone_slab (the smooth slab), snow (the snow block), melon (the slice), nether_brick
 * (the block). Otherwise the 1.21 name is translated. prefer 'new' translates first; the command
 * boundary uses it for names the LLM wrote (skills-rotn).
 * @param {string} name
 * @param {'items'|'blocks'} [kind]
 * @param {{prefer?: 'old'|'new'}} [opts]
 * @returns {{name: string, meta: number|null}|null} meta is null when the name carried none
 */
export function resolveName(name, kind = 'items', { prefer = 'old' } = {}) {
    const byName = reg()?.[`${kind}ByName`];
    if (!byName || typeof name !== 'string') return null;
    const direct = () => {
        const p = parseOld(name);
        const n = p && botName(p.name);
        return n && byName[n] ? { name: n, meta: p.meta } : null;
    };
    const translated = () => {
        const t = kind === 'blocks' ? blockToOld(name)[0] : rdToOld(name);
        const n = t && botName(t.name);
        return n && byName[n] ? { name: n, meta: t.meta } : null;
    };
    return prefer === 'new' ? (translated() ?? direct()) : (direct() ?? translated());
}

const idOf = (v) => (v !== null && typeof v === 'object' ? v.id : v);

/**
 * @typedef {string} ItemName
 * @typedef {string} BlockName
*/

export const WOOD_TYPES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry'];
export const MATCHING_WOOD_BLOCKS = [
    'log',
    'planks',
    'sign',
    'boat',
    'fence_gate',
    'door',
    'fence',
    'slab',
    'stairs',
    'button',
    'pressure_plate',
    'trapdoor'
]
export const WOOL_COLORS = [
    'white',
    'orange',
    'magenta',
    'light_blue',
    'yellow',
    'lime',
    'pink',
    'gray',
    'light_gray',
    'cyan',
    'purple',
    'blue',
    'brown',
    'green',
    'red',
    'black'
]


export function initBot(username, { onMsaCode } = {}) {
    // Read the version here, not at module load: settings are empty until
    // setSettings() runs, which is after this module is imported (seam-map A).
    const configuredVersion = settings.minecraft_version;
    const options = {
        username: username,
        host: settings.host,
        port: settings.port,
        auth: settings.auth,
        version: configuredVersion,
        checkTimeoutInterval: 60000,  // 60s keep-alive check (default 30s) — reduces disconnects on slow servers
    }
    if (!configuredVersion || configuredVersion === "auto") {
        delete options.version;
    }
    // Env switches (FORGE_BRIDGE, FORGE_CAPTURE, FORGE_MODLIST_FILE,
    // MINDCRAFT_PROFILES_FOLDER) are documented in packages/forge-bridge/src/env.js.
    const env = forgeOptionsFromEnv(username);
    // Per-bot Microsoft token cache, outside every repo (docs/research/ops.md
    // section 1). Refuse to start without it (nmp would use its shared default
    // cache), with it inside a git work tree, or with DEBUG enabling
    // prismarine-auth's output (it prints tokens). See forge-bridge src/auth-guard.js.
    if (options.auth === 'microsoft') {
        assertMicrosoftAuthSafe({ username, profilesFolder: env.profilesFolder });
    }
    if (env.profilesFolder) {
        options.profilesFolder = env.profilesFolder;
    }
    // A bot never runs the interactive device-code login itself: that is the
    // human's step (packages/forge-bridge/tools/msa-login.mjs). The default logs
    // one line and never the code; a caller (a harness driver) can pass its own
    // onMsaCode to fail fast.
    options.onMsaCode = onMsaCode ?? quietMsaCodeHandler(username);

    // Forge 1.12.2 (RotN): ping first, then attach forge-bridge with the server's
    // ModList before the socket opens (ADR 0003). FORGE_BRIDGE=auto attaches only
    // when the ping reports FML.
    const forge = { bridge: null, capture: null, mode: env.mode };
    if (forge.mode !== 'off') {
        if (env.captureFile) {
            forge.capture = new CaptureWriter({ file: env.captureFile, redact: { username } });
            console.log(`[mcdata] forge-bridge capture: ${env.captureFile}`);
        }
        options.connect = createForgeConnect({
            host: options.host,
            port: options.port,
            mode: forge.mode,
            modListFile: env.modListFile,
            pingTimeoutMs: env.pingTimeoutMs,
            capture: forge.capture,
            onAttach: (bridge) => {
                forge.bridge = bridge;
                options.brand = 'fml,forge';
                // After the last RegistryData: modded names in bot.registry (brief item 4).
                bridge.on('registries', (snap) => {
                    forge.registryReport = extendRegistry(bot.registry, snap, { log: (m) => console.log(`[forge-bridge] ${m}`) });
                    mcdata = bot.registry; // the helpers see the extended maps (same object, refreshed for clarity)
                    bot.emit('forge_registry', forge.registryReport);
                });
                // Mod entities spawned with FML EntitySpawn go into bot.entities (brief item 6).
                attachFmlEntities(bot, bridge, { log: (m) => console.log(`[forge-bridge] ${m}`) });
            },
        });
    }

    const bot = createBot(options);
    bot.forge = forge;
    // ADR 0003 decision 5, agent side: agent.js calls this on its exit paths. It
    // writes the reason for the main process (MINDCRAFT_EXIT_REASON_FILE) and
    // returns the exit code: the kick's (3 for fatal), or 1.
    forge.recordExit = (o = {}) => recordAgentExit({
        ...o, kick: forge.bridge?.lastKick ?? null, clientEnded: bot._client?.ended !== false,
    });

    // Throttle position packets to avoid kicks on Paper/Spigot servers. Inside each
    // 50 ms window the newest position and look are kept and merged, so the server
    // always gets the latest state (upstream sent the oldest and dropped the rest).
    bot._client.write = throttleMovement(bot._client.write.bind(bot._client), { intervalMs: 50 });

    // PartialReadError used to be swallowed silently. It is still not fatal, but it
    // is counted and logged. protodef drops packets it cannot read without an
    // 'error' event, so those are counted by forge-bridge's deserializer hook
    // (and kept in its capture); 'error' events here come from plugin channels.
    // (protodef's own "partial packet" line: PROTODEF_LOG_PARTIAL=1.)
    let clientPartialReadErrors = 0;
    Object.defineProperty(bot, 'partialReadErrors', {
        get: () => clientPartialReadErrors + (forge.bridge?.stats.partialReadErrors ?? 0),
    });
    const originalEmit = bot._client.emit.bind(bot._client);
    bot._client.emit = function(event, ...args) {
        if (event === 'error' && args[0]) {
            const err = args[0];
            const errStr = err instanceof Error ? err.message : String(err);
            if (errStr.includes('PartialReadError')) {
                clientPartialReadErrors++;
                console.warn(`[mcdata] PartialReadError #${clientPartialReadErrors} (not fatal):`, errStr.substring(0, 300));
                forge.capture?.event('client_partial_read_error', { n: clientPartialReadErrors, message: errStr.substring(0, 300) });
                return true;
            }
        }
        return originalEmit(event, ...args);
    };

    bot.loadPlugin(pathfinder);
    bot.loadPlugin(pvp);
    bot.loadPlugin(collectblock);
    bot.loadPlugin(autoEat);
    bot.loadPlugin(armorManager); // auto equip armor
    bot.once('resourcePack', () => {
        bot.acceptResourcePack();
    });

    bot.once('login', () => {
        mc_version = bot.version;
        // The name helpers read bot.registry, which forge-bridge extends with the server's
        // modded ids (rotn-data request 4). Same API as minecraftData(); vanilla stays vanilla.
        mcdata = bot.registry ?? minecraftData(mc_version);
        Item = prismarine_items(mc_version);
    });

    return bot;
}

export function isHuntable(mob) {
    if (!mob || !mob.name) return false;
    const animals = ['chicken', 'cow', 'llama', 'mooshroom', 'pig', 'rabbit', 'sheep'];
    return animals.includes(mob.name.toLowerCase()) && !mob.metadata[16]; // metadata 16 is not baby
}

export function isHostile(mob) {
    if (!mob || !mob.name) return false;
    return  (mob.type === 'mob' || mob.type === 'hostile') && mob.name !== 'iron_golem' && mob.name !== 'snow_golem';
}

// blocks that don't work with collectBlock, need to be manually collected
export function mustCollectManually(blockName) {
    // all crops (that aren't normal blocks), torches, buttons, levers, redstone,
    const full_names = ['wheat', 'carrots', 'potatoes', 'beetroots', 'nether_wart', 'cocoa', 'sugar_cane', 'kelp', 'short_grass', 'fern', 'tall_grass', 'bamboo',
        'poppy', 'dandelion', 'blue_orchid', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'lilac', 'wither_rose', 'lily_of_the_valley', 'wither_rose',
        'lever', 'redstone_wire', 'lantern']
    const partial_names = ['sapling', 'torch', 'button', 'carpet', 'pressure_plate', 'mushroom', 'tulip', 'bush', 'vines', 'fern']
    return full_names.includes(blockName.toLowerCase()) || partial_names.some(partial => blockName.toLowerCase().includes(partial));
}

export function getItemId(itemName) {
    const r = resolveName(itemName, 'items');
    return r ? reg().itemsByName[r.name].id : null;
}

// Also takes a 1.12 recipe ingredient object {id, metadata} (seam map: those dropped out).
export function getItemName(itemId) {
    let item = reg().items[idOf(itemId)];
    if (item) {
        return item.name;
    }
    return null;
}

export function getBlockId(blockName) {
    const r = resolveName(blockName, 'blocks');
    return r ? reg().blocksByName[r.name].id : null;
}

export function getBlockName(blockId) {
    let block = reg().blocks[idOf(blockId)];
    if (block) {
        return block.name;
    }
    return null;
}

export function getEntityId(entityName) {
    if (typeof entityName !== 'string') return null;
    const p = parseOld(entityName);
    let entity = reg().entitiesByName[entityName] ?? (p && reg().entitiesByName[botName(p.name)]);
    if (entity) {
        return entity.id;
    }
    return null;
}

export function getAllItems(ignore) {
    if (!ignore) {
        ignore = [];
    }
    let items = []
    const all = reg().items;
    for (const itemId in all) {
        const item = all[itemId];
        if (!ignore.includes(item.name)) {
            items.push(item);
        }
    }
    return items;
}

export function getAllItemIds(ignore) {
    const items = getAllItems(ignore);
    let itemIds = [];
    for (const item of items) {
        itemIds.push(item.id);
    }
    return itemIds;
}

export function getAllBlocks(ignore) {
    if (!ignore) {
        ignore = [];
    }
    let blocks = []
    const all = reg().blocks;
    for (const blockId in all) {
        const block = all[blockId];
        if (!ignore.includes(block.name)) {
            blocks.push(block);
        }
    }
    return blocks;
}

export function getAllBlockIds(ignore) {
    const blocks = getAllBlocks(ignore);
    let blockIds = [];
    for (const block of blocks) {
        blockIds.push(block.id);
    }
    return blockIds;
}

export function getAllBiomes() {
    return reg().biomes;
}

export function getItemCraftingRecipes(itemName) {
    let itemId = getItemId(itemName);
    const allRecipes = reg().recipes ?? {};
    if (!allRecipes[itemId]) {
        return null;
    }

    let recipes = [];
    for (let r of allRecipes[itemId]) {
        let recipe = {};
        let ingredients = [];
        if (r.ingredients) {
            ingredients = r.ingredients;
        } else if (r.inShape) {
            ingredients = r.inShape.flat();
        }
        for (let ingredient of ingredients) {
            let ingredientName = getItemName(ingredient);
            if (ingredientName === null) continue;
            if (!recipe[ingredientName])
                recipe[ingredientName] = 0;
            recipe[ingredientName]++;
        }
        recipes.push([
            recipe,
            {craftedCount : r.result.count}
        ]);
    }
    // sort recipes by if their ingredients include common items
    const commonItems = ['oak_planks', 'oak_log', 'coal', 'cobblestone'];
    recipes.sort((a, b) => {
        let commonCountA = Object.keys(a[0]).filter(key => commonItems.includes(key)).reduce((acc, key) => acc + a[0][key], 0);
        let commonCountB = Object.keys(b[0]).filter(key => commonItems.includes(key)).reduce((acc, key) => acc + b[0][key], 0);
        return commonCountB - commonCountA;
    });

    return recipes;
}

export function isSmeltable(itemName) {
    const misc_smeltables = ['beef', 'chicken', 'cod', 'mutton', 'porkchop', 'rabbit', 'salmon', 'tropical_fish', 'potato', 'kelp', 'sand', 'cobblestone', 'clay_ball'];
    return itemName.includes('raw') || itemName.includes('log') || misc_smeltables.includes(itemName);
}

export function getSmeltingFuel(bot) {
    let fuel = bot.inventory.items().find(i => i.name === 'coal' || i.name === 'charcoal' || i.name === 'blaze_rod')
    if (fuel)
        return fuel;
    fuel = bot.inventory.items().find(i => i.name.includes('log') || i.name.includes('planks'))
    if (fuel)
        return fuel;
    return bot.inventory.items().find(i => i.name === 'coal_block' || i.name === 'lava_bucket');
}

export function getFuelSmeltOutput(fuelName) {
    if (fuelName === 'coal' || fuelName === 'charcoal')
        return 8;
    if (fuelName === 'blaze_rod')
        return 12;
    if (fuelName.includes('log') || fuelName.includes('planks'))
        return 1.5
    if (fuelName === 'coal_block')
        return 80;
    if (fuelName === 'lava_bucket')
        return 100;
    return 0;
}

export function getItemSmeltingIngredient(itemName) {
    return {    
        baked_potato: 'potato',
        steak: 'raw_beef',
        cooked_chicken: 'raw_chicken',
        cooked_cod: 'raw_cod',
        cooked_mutton: 'raw_mutton',
        cooked_porkchop: 'raw_porkchop',
        cooked_rabbit: 'raw_rabbit',
        cooked_salmon: 'raw_salmon',
        dried_kelp: 'kelp',
        iron_ingot: 'raw_iron',
        gold_ingot: 'raw_gold',
        copper_ingot: 'raw_copper',
        glass: 'sand'
    }[itemName];
}

export function getItemBlockSources(itemName) {
    let itemId = getItemId(itemName);
    let sources = [];
    for (let block of getAllBlocks()) {
        if (block.drops.includes(itemId)) {
            sources.push(block.name);
        }
    }
    return sources;
}

export function getItemAnimalSource(itemName) {
    return {    
        raw_beef: 'cow',
        raw_chicken: 'chicken',
        raw_cod: 'cod',
        raw_mutton: 'sheep',
        raw_porkchop: 'pig',
        raw_rabbit: 'rabbit',
        raw_salmon: 'salmon',
        leather: 'cow',
        wool: 'sheep'
    }[itemName];
}

export function getBlockTool(blockName) {
    const r = resolveName(blockName, 'blocks');
    let block = r ? reg().blocksByName[r.name] : null;
    if (!block || !block.harvestTools) {
        return null;
    }
    return getItemName(Object.keys(block.harvestTools)[0]);  // Double check first tool is always simplest
}

export function makeItem(name, amount=1) {
    const r = resolveName(name, 'items');
    return new Item(r ? reg().itemsByName[r.name].id : null, amount, r?.meta ?? 0);
}

/**
 * Returns the number of ingredients required to use the recipe once.
 * 
 * @param {Recipe} recipe
 * @returns {Object<mc.ItemName, number>} an object describing the number of each ingredient.
 */
export function ingredientsFromPrismarineRecipe(recipe) {
    let requiredIngedients = {};
    if (recipe.inShape)
        for (const ingredient of recipe.inShape.flat()) {
            if(ingredient.id<0) continue; //prismarine-recipe uses id -1 as an empty crafting slot
            const ingredientName = getItemName(ingredient.id);
            requiredIngedients[ingredientName] ??=0;
            requiredIngedients[ingredientName] += ingredient.count;
        }
    if (recipe.ingredients)
        for (const ingredient of recipe.ingredients) {
            if(ingredient.id<0) continue;
            const ingredientName = getItemName(ingredient.id);
            requiredIngedients[ingredientName] ??=0;
            requiredIngedients[ingredientName] -= ingredient.count;
            //Yes, the `-=` is intended.
            //prismarine-recipe uses positive numbers for the shaped ingredients but negative for unshaped.
            //Why this is the case is beyond my understanding.
        }
    return requiredIngedients;
}

/**
 * Calculates the number of times an action, such as a crafing recipe, can be completed before running out of resources.
 * @template T - doesn't have to be an item. This could be any resource.
 * @param {Object.<T, number>} availableItems - The resources available; e.g, `{'cobble_stone': 7, 'stick': 10}`
 * @param {Object.<T, number>} requiredItems - The resources required to complete the action once; e.g, `{'cobble_stone': 3, 'stick': 2}`
 * @param {boolean} discrete - Is the action discrete?
 * @returns {{num: number, limitingResource: (T | null)}} the number of times the action can be completed and the limmiting resource; e.g `{num: 2, limitingResource: 'cobble_stone'}`
 */
export function calculateLimitingResource(availableItems, requiredItems, discrete=true) {
    let limitingResource = null;
    let num = Infinity;
    for (const itemType in requiredItems) {
        if (availableItems[itemType] < requiredItems[itemType] * num) {
            limitingResource = itemType;
            num = availableItems[itemType] / requiredItems[itemType];
        }
    }
    if(discrete) num = Math.floor(num);
    return {num, limitingResource}
}

let loopingItems = new Set();

export function initializeLoopingItems() {

    loopingItems = new Set(['coal',
        'wheat',
        'bone_meal',
        'diamond',
        'emerald',
        'raw_iron',
        'raw_gold',
        'redstone',
        'blue_wool',
        'packed_mud',
        'raw_copper',
        'iron_ingot',
        'dried_kelp',
        'gold_ingot',
        'slime_ball',
        'black_wool',
        'quartz_slab',
        'copper_ingot',
        'lapis_lazuli',
        'honey_bottle',
        'rib_armor_trim_smithing_template',
        'eye_armor_trim_smithing_template',
        'vex_armor_trim_smithing_template',
        'dune_armor_trim_smithing_template',
        'host_armor_trim_smithing_template',
        'tide_armor_trim_smithing_template',
        'wild_armor_trim_smithing_template',
        'ward_armor_trim_smithing_template',
        'coast_armor_trim_smithing_template',
        'spire_armor_trim_smithing_template',
        'snout_armor_trim_smithing_template',
        'shaper_armor_trim_smithing_template',
        'netherite_upgrade_smithing_template',
        'raiser_armor_trim_smithing_template',
        'sentry_armor_trim_smithing_template',
        'silence_armor_trim_smithing_template',
        'wayfinder_armor_trim_smithing_template']);
}


/**
 * Gets a detailed plan for crafting an item considering current inventory
 */
export function getDetailedCraftingPlan(targetItem, count = 1, current_inventory = {}) {
    initializeLoopingItems();
    if (!targetItem || count <= 0 || !getItemId(targetItem)) {
        return "Invalid input. Please provide a valid item name and positive count.";
    }

    if (isBaseItem(targetItem)) {
        const available = current_inventory[targetItem] || 0;
        if (available >= count) return "You have all required items already in your inventory!";
        return `${targetItem} is a base item, you need to find ${count - available} more in the world`;
    }

    const inventory = { ...current_inventory };
    const leftovers = {};
    const plan = craftItem(targetItem, count, inventory, leftovers);
    return formatPlan(targetItem, plan);
}

function isBaseItem(item) {
    return loopingItems.has(item) || getItemCraftingRecipes(item) === null;
}

function craftItem(item, count, inventory, leftovers, crafted = { required: {}, steps: [], leftovers: {} }) {
    // Check available inventory and leftovers first
    const availableInv = inventory[item] || 0;
    const availableLeft = leftovers[item] || 0;
    const totalAvailable = availableInv + availableLeft;

    if (totalAvailable >= count) {
        // Use leftovers first, then inventory
        const useFromLeft = Math.min(availableLeft, count);
        leftovers[item] = availableLeft - useFromLeft;
        
        const remainingNeeded = count - useFromLeft;
        if (remainingNeeded > 0) {
            inventory[item] = availableInv - remainingNeeded;
        }
        return crafted;
    }

    // Use whatever is available
    const stillNeeded = count - totalAvailable;
    if (availableLeft > 0) leftovers[item] = 0;
    if (availableInv > 0) inventory[item] = 0;

    if (isBaseItem(item)) {
        crafted.required[item] = (crafted.required[item] || 0) + stillNeeded;
        return crafted;
    }

    const recipe = getItemCraftingRecipes(item)?.[0];
    if (!recipe) {
        crafted.required[item] = stillNeeded;
        return crafted;
    }

    const [ingredients, result] = recipe;
    const craftedPerRecipe = result.craftedCount;
    const batchCount = Math.ceil(stillNeeded / craftedPerRecipe);
    const totalProduced = batchCount * craftedPerRecipe;

    // Add excess to leftovers
    if (totalProduced > stillNeeded) {
        leftovers[item] = (leftovers[item] || 0) + (totalProduced - stillNeeded);
    }

    // Process each ingredient
    for (const [ingredientName, ingredientCount] of Object.entries(ingredients)) {
        const totalIngredientNeeded = ingredientCount * batchCount;
        craftItem(ingredientName, totalIngredientNeeded, inventory, leftovers, crafted);
    }

    // Add crafting step
    const stepIngredients = Object.entries(ingredients)
        .map(([name, amount]) => `${amount * batchCount} ${name}`)
        .join(' + ');
    crafted.steps.push(`Craft ${stepIngredients} -> ${totalProduced} ${item}`);

    return crafted;
}

function formatPlan(targetItem, { required, steps, leftovers }) {
    const lines = [];

    if (Object.keys(required).length > 0) {
        lines.push('You are missing the following items:');
        Object.entries(required).forEach(([item, count]) => 
            lines.push(`- ${count} ${item}`));
        lines.push('\nOnce you have these items, here\'s your crafting plan:');
    } else {
        lines.push('You have all items required to craft this item!');
        lines.push('Here\'s your crafting plan:');
    }

    lines.push('');
    lines.push(...steps);

    if (Object.keys(required).some(item => item.includes('oak')) && !targetItem.includes('oak')) {
        lines.push('Note: Any varient of wood can be used for this recipe.');
    }

    if (Object.keys(leftovers).length > 0) {
        lines.push('\nYou will have leftover:');
        Object.entries(leftovers).forEach(([item, count]) => 
            lines.push(`- ${count} ${item}`));
    }

    return lines.join('\n');
}
