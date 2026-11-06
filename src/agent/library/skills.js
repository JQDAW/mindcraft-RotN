import * as mc from "../../utils/mcdata.js";
import * as world from "./world.js";
import * as names112 from "./names112.js";
import { countItem, parseName, formatName, findItem, itemMatches, blockMatcher, variantMeta, inventoryKey } from "./rotn_names.js";
import { worldSources, itemVariants, toolAllows, allowedTool, allowedTools, toolUsesLeft, describeTool, stowCarried, isToolFor, handRoute } from "./rotn_sources.js";
import { craftNeeds, describeNeeds, fillNow, filledRecipe } from "./craft_needs.js";
import { isGenericCobble, cobbleChoices, cobbleRocksHeld, ROCKS_PER_COBBLE } from "./cobble.js";
import { treeBase, canopyOf, standSpots, retreatFrom, sideFace, isBranch, isTreeLeaves, branchesNear, FALLING_TREE, FELL_PLAN } from "./felling.js";
import { oreMemberNames } from "../agenda_driver.js";
import { fallSafe, treeSafe, standsOnTree, isFirmGround, isUnsafeBlock, isLeafBlock, leafFromGround, itemOnGround } from "./fall_safety.js";
import { standCheck, sameBlock, describeTarget } from "./stand_on.js";
import prismarineRecipe from "prismarine-recipe";
import { safeError } from "../safe_error.js";
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import settings from "../../../settings.js";

const blockPlaceDelay = settings.block_place_delay == null ? 0 : settings.block_place_delay;
const useDelay = blockPlaceDelay > 0;

export function log(bot, message) {
    bot.output += message + '\n';
}

async function autoLight(bot) {
    if (world.shouldPlaceTorch(bot)) {
        try {
            const pos = world.getPosition(bot);
            return await placeBlock(bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
        } catch (err) {return false;}
    }
    return false;
}

/**
 * A weapon's rank by its material, a sword above an axe of the same material. A heuristic:
 * neither mineflayer's items nor rotn-data carry attack damage (upstream sorted by an
 * item.attackDamage that does not exist), and RotN's durabilities do not follow damage.
 */
export function weaponRank(item) {
    const name = String(item?.name ?? '');
    const tier = /diamond/.test(name) ? 4 : /iron/.test(name) ? 3 : /stone|flint|bone|obsidian/.test(name) ? 2 : 1;
    return tier * 2 + (/sword/.test(name) ? 1 : 0);
}

/**
 * Hold the best weapon (else a pickaxe or shovel). Never throws (G3 round 7 B: a rejected click
 * here ended self_defense, and the bot died without hitting back): when the equip fails, the fight
 * goes on with what is in hand. Whether the weapon is held. `fight.equipFailed`: after the first
 * failed equip of a fight, no more are tried in it (#296 review 2: each try can wait about 11 s for
 * an unanswered click and its retry, while the bot does not attack).
 */
async function equipHighestAttack(bot, fight = {}) {
    const isWeapon = (item) => !!item && (item.name.includes('sword') || (item.name.includes('axe') && !item.name.includes('pickaxe')));
    const best = (items) => items.filter(isWeapon).sort((a, b) => weaponRank(b) - weaponRank(a))[0] ?? null;
    // A weapon in the off hand (which threats.hasWeapon counts) is moved into the inventory when
    // it is better than any there, so it can be held in the main hand (#238 review 1 and nit 3).
    const off = bot.inventory.slots?.[45];
    const inInventory = best(bot.inventory.items());
    if (isWeapon(off) && (!inInventory || weaponRank(off) > weaponRank(inInventory))) {
        const full = (bot.inventory.firstEmptyInventorySlot?.() ?? null) === null;
        const moved = await stowCarried(bot, isWeapon, { resyncMs: 0 });
        if (!moved.length) log(bot, `Could not take the ${off.name} from the off hand${full ? ': the inventory is full' : ''}.`); // #238 nit 2
    }
    let weapon = best(bot.inventory.items());
    if (!weapon)
        weapon = bot.inventory.items().find(item => item.name.includes('pickaxe') || item.name.includes('shovel')) ?? null;
    if (!weapon) return false;
    if (fight.equipFailed) return false; // fighting with what is in hand (#296 review 2)
    if (bot.heldItem === weapon || (weapon.slot != null && bot.heldItem?.slot === weapon.slot)) return true;
    try {
        await bot.equip(weapon, 'hand');
        return true;
    } catch (err) {
        fight.equipFailed = true;
        log(bot, `Could not take the ${weapon.name} in hand (${safeError(err)}); fighting with ${bot.heldItem?.name ?? 'bare hands'} for the rest of this fight.`);
        return false;
    }
}

// The ingredients of one craft, keyed by canonical name: "planks:0" when the recipe pins
// a variant, "planks" when any will do (metadata null). mcdata's helper drops the meta,
// so a mixed stack could pass the limit and fail in bot.craft (#131 re-review nit).
function recipeIngredients(recipe) {
    const out = {};
    const add = (ingredient, n) => {
        if (!ingredient || ingredient.id < 0) return; // -1 is an empty slot
        const name = formatName(mc.getItemName(ingredient.id), ingredient.metadata ?? null);
        out[name] = (out[name] ?? 0) + n;
    };
    if (recipe.inShape) for (const ingredient of recipe.inShape.flat()) add(ingredient, ingredient.count);
    if (recipe.ingredients) for (const ingredient of recipe.ingredients) add(ingredient, -ingredient.count); // unshaped counts are negative
    return out;
}

/**
 * !craftRecipe("cobblestone"): craft the cobblestone each held rock kind makes (rotn-data's 4-rocks
 * recipes, cobble.js), from the kind with the most rocks, until `num` are made (G3 round 3 A).
 */
async function craftCobbleFromRocks(bot, num, ops) {
    const choices = cobbleChoices(bot);
    if (choices.length === 0) {
        const held = cobbleRocksHeld(bot).map(c => `${c.have} ${c.rock}`);
        log(bot, `Cobblestone takes ${ROCKS_PER_COBBLE} rocks of one kind, and each kind makes its own cobblestone; `
            + `you have ${held.length ? held.join(', ') : 'no such rocks'}. Collect more with !collectBlocks("pyrotech:rock", 8).`);
        return false;
    }
    let made = 0;
    for (const c of choices) {
        if (made >= num) break;
        const n = Math.min(num - made, Math.floor(c.have / ROCKS_PER_COBBLE));
        log(bot, `Cobblestone from your rocks: ${n} ${c.gives} (${ROCKS_PER_COBBLE} ${c.rock} each).`);
        // By the rock's own recipe (#233 review 1): bot.recipesFor could pick another recipe for the
        // same output (undergroundbiomes:regular_cobblestone turns 4 modded cobbles into vanilla).
        const before = countItem(bot, c.gives);
        const needs = { recipeId: c.recipeId, requiresTable: c.requiresTable, ready: true, inputs: [], how: `from your ${c.rock} rocks` };
        await craftByFill(bot, c.gives, n, needs, null, false, ops);
        made += Math.max(0, countItem(bot, c.gives) - before);
    }
    return made > 0;
}

export async function craftRecipe(bot, itemName, num=1, ops=CRAFT_TABLE_OPS) {
    /**
     * Attempt to craft the given item name from a recipe. May craft many items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to craft.
     * @returns {Promise<boolean>} true if the recipe was crafted, false otherwise.
     * @example
     * await skills.craftRecipe(bot, "stick");
     **/
    // ops: how a table is placed and picked up (tests pass their own; CRAFT_TABLE_OPS below).
    // "cobblestone": the kind the bot's rocks make (G3 round 3 A: sedimentary rocks make chalk cobble).
    if (isGenericCobble(itemName)) return await craftCobbleFromRocks(bot, num, ops);
    const run = currentRun(bot); // checked after each await (#225 review)
    let placedTable = false;
    // The variant to craft: "planks:1" asks for spruce planks; a bare "planks" any (B1b).
    // A null meta would let bot.recipesFor return oak planks for spruce.
    const craftMeta = mc.resolveName(itemName)?.meta ?? null;

    // getItemCraftingRecipes gives null for an item without recipes (#151 re-review).
    if ((mc.getItemCraftingRecipes(itemName)?.length ?? 0) == 0) {
        log(bot, `${itemName} is either not an item, or it does not have a crafting recipe!`);
        return false;
    }

    // get recipes that don't require a crafting table
    let recipes = bot.recipesFor(mc.getItemId(itemName), craftMeta, 1, null); 
    let craftingTable = null;
    const craftingTableRange = 16;
    placeTable: if (!recipes || recipes.length === 0) {
        recipes = bot.recipesFor(mc.getItemId(itemName), craftMeta, 1, true);
        if(!recipes || recipes.length === 0) break placeTable; //Don't bother going to the table if we don't have the required resources.

        // Look for crafting table
        craftingTable = world.getNearestBlock(bot, 'crafting_table', craftingTableRange);
        if (craftingTable === null){

            // Try to place crafting table
            let hasTable = world.getInventoryCounts(bot)['crafting_table'] > 0;
            if (hasTable) {
                // ops.place guards a missing free space and logs why it failed (#198 review).
                craftingTable = await ops.place(bot, itemName);
                if (!craftingTable) return false;
                placedTable = true;
                if (run.aborted) { await ops.pickUp(bot); return false; } // take the table back, then stop
                recipes = bot.recipesFor(mc.getItemId(itemName), craftMeta, 1, craftingTable);
            }
            else {
                log(bot, `Crafting ${itemName} requires a crafting table.`)
                return false;
            }
        }
        else {
            recipes = bot.recipesFor(mc.getItemId(itemName), craftMeta, 1, craftingTable);
        }
    }
    // From here a table placed above is picked up again however this ends, also when bot.craft
    // throws (#198 review); craftByFill takes that over when it is called.
    try {
    if (!recipes || recipes.length === 0) {
        // Say what is missing by RotN's recipes, judged by rotn-data's canFill (C1): slots are
        // independent, so mixed rocks are fine; cobblestone has one recipe per rock type.
        const needs = craftNeeds(bot, itemName);
        if (needs && !needs.ready)
            log(bot, `You do not have the resources to craft ${itemName}. ${describeNeeds(itemName, needs)}`);
        else if (needs) {
            // canFill says the items fit a RotN recipe, but bot.registry has no variant for this mix
            // (its variants are capped): craft from the bot's own stacks (C1).
            const placed = placedTable;
            placedTable = false; // craftByFill picks it up
            return await craftByFill(bot, itemName, num, needs, craftingTable, placed, ops, run);
        }
        else {
            // No RotN craft way: upstream's text from the registry recipes, guarded (#151 review).
            let first = null;
            try { first = mc.getItemCraftingRecipes(itemName)?.[0]?.[0] ?? null; } catch { first = null; }
            const requires = first ? ` It requires: ${Object.entries(first).map(([key, value]) => `${key}: ${value}`).join(', ')}.` : '';
            log(bot, `You do not have the resources to craft a ${itemName}.${requires}`);
        }
        return false;
    }
    
    if (craftingTable && bot.entity.position.distanceTo(craftingTable.position) > 4) {
        await goToNearestBlock(bot, 'crafting_table', 4, craftingTableRange);
        if (run.aborted) return false; // the finally picks a placed table up
    }

    const recipe = recipes[0];
    console.log('crafting...');
    //Check that the agent has sufficient items to use the recipe `num` times.
    const requiredIngredients = recipeIngredients(recipe); //Items required to use the recipe once, by variant.
    // Count each ingredient with countItem: "planks:0" only oak, "planks" every variant (#131 review).
    const inventory = Object.fromEntries(Object.keys(requiredIngredients).map(name => [name, countItem(bot, name)]));
    const craftLimit = mc.calculateLimitingResource(inventory, requiredIngredients);
    
    await craftPausingAutoEat(bot, recipe, Math.min(craftLimit.num, num), craftingTable);
    if(craftLimit.num<num) log(bot, `Not enough ${craftLimit.limitingResource} to craft ${num}, crafted ${craftLimit.num}. You now have ${countItem(bot, itemName)} ${itemName}.`);
    else log(bot, `Successfully crafted ${itemName}, you now have ${countItem(bot, itemName)} ${itemName}.`);
    } finally {
        if (placedTable) await ops.pickUp(bot);
    }

    //Equip any armor the bot may have crafted.
    //There is probablly a more efficient method than checking the entire inventory but this is all mineflayer-armor-manager provides. :P
    bot.armorManager.equipAll(); 

    return true;
}

/**
 * bot.craft with mineflayer-auto-eat paused: it clicks the inventory too, and an eat in the middle of
 * a craft got a click rejected in net-forge's offline test (Request 2 answer). It is enabled again
 * afterwards only if it was on before. An eat already under way is given up to `eatWaitMs` to finish.
 */
export async function craftPausingAutoEat(bot, recipe, count, table, eatWaitMs = 3000) {
    const autoEat = bot.autoEat;
    const wasOn = !!autoEat && typeof autoEat.disable === 'function' && !autoEat.disabled;
    if (wasOn) autoEat.disable();
    try {
        for (let waited = 0; autoEat?.isEating && waited < eatWaitMs; waited += 100)
            await new Promise(resolve => setTimeout(resolve, 100));
        await bot.craft(recipe, count, table);
    } finally {
        if (wasOn) autoEat.enable?.();
    }
}

/** How long a crafting table's block update may come late before it counts as not placed. */
export const TABLE_LATE_UPDATE_MS = 1200;

/** Place a crafting table near the bot for a craft: the table block, or null (logged). */
async function placeTableNear(bot, itemName, lateMs = TABLE_LATE_UPDATE_MS) {
    const pos = world.getNearestFreeSpace(bot, 1, 6);
    if (!pos) {
        log(bot, `Could not place a crafting table to craft ${itemName}: no free space nearby.`);
        return null;
    }
    await placeBlock(bot, 'crafting_table', pos.x, pos.y, pos.z);
    let table = world.getNearestBlock(bot, 'crafting_table', 16);
    if (!table) {
        // The block update can come late (P1: up to 1158 ms), and placeBlock then reports a failure
        // although the table stands: look again, so it is used and picked up, not left behind.
        await new Promise(resolve => setTimeout(resolve, lateMs));
        table = world.getNearestBlock(bot, 'crafting_table', 16);
    }
    if (!table) log(bot, `Could not place a crafting table to craft ${itemName}.`);
    return table;
}

/** Pick up a crafting table the bot placed for a craft; a failure is logged, never thrown. */
async function pickUpTable(bot) {
    try {
        await collectBlock(bot, 'crafting_table', 1);
    } catch (err) {
        log(bot, `Could not pick up the crafting table again (${safeError(err)}).`);
    }
}

/** How craftByFill places and picks up a table (tests pass their own). */
export const CRAFT_TABLE_OPS = { place: placeTableNear, pickUp: pickUpTable };

/**
 * Craft by rotn-data's recipe with the stacks canFill assigns (C1): for a mix of kinds (1 igneous and
 * 2 metamorphic rocks for a stone pickaxe) that bot.registry's capped variants leave out. One craft at
 * a time, judged afresh each time, at a crafting table when the recipe needs one.
 * `table` and `placed` carry a table craftRecipe already found or placed, so it is not placed twice.
 * A craft counts only when the item's count in the inventory grew; the loop stops when it did not.
 * A table placed here or by craftRecipe is picked up again, also when bot.craft throws (#194 review).
 * @returns {Promise<boolean>} true if at least one was crafted.
 */
export async function craftByFill(bot, itemName, num, needs, table = null, placed = false, ops = CRAFT_TABLE_OPS, run = currentRun(bot)) {
    if (!needs.recipeId) {
        if (placed) await ops.pickUp(bot);
        log(bot, `Could not craft ${itemName}: rotn-data names no recipe for these items. ${describeNeeds(itemName, needs)}`.trimEnd());
        return false;
    }
    let made = 0;
    let why = null;
    try {
        if (!needs.requiresTable) {
            if (placed) await ops.pickUp(bot);
            table = null;
            placed = false;
        }
        else {
            table ??= world.getNearestBlock(bot, 'crafting_table', 16);
            if (!table) {
                if (countItem(bot, 'crafting_table') < 1) {
                    log(bot, `Crafting ${itemName} requires a crafting table.`);
                    return false;
                }
                table = await ops.place(bot, itemName);
                placed = !!table;
                if (!table) return false;
            }
            if (run.aborted) return false; // the finally picks a placed table up
            if (bot.entity.position.distanceTo(table.position) > 4)
                await goToNearestBlock(bot, 'crafting_table', 4, 16);
        }
        const { Recipe } = prismarineRecipe(bot.registry);
        while (made < num && !bot.interrupt_code && !run.aborted) {
            const fill = fillNow(bot, needs.recipeId);
            if (!fill?.ok) { why = made === 0 ? 'the items no longer fit the recipe' : null; break; }
            let recipe;
            try {
                recipe = new Recipe(filledRecipe(bot.registry, needs.recipeId, fill.assignment));
            } catch (err) {
                why = err.message;
                break;
            }
            const before = countItem(bot, itemName);
            try {
                await craftPausingAutoEat(bot, recipe, 1, table);
            } catch (err) {
                why = `the craft failed (${safeError(err)})`;
                break;
            }
            if (countItem(bot, itemName) <= before) {
                why = `the craft gave no ${itemName}`;
                break;
            }
            made++;
        }
    } finally {
        if (placed) await ops.pickUp(bot);
    }
    if (made === 0) {
        log(bot, `Could not craft ${itemName}: ${why ?? 'nothing was crafted'}. ${describeNeeds(itemName, needs)}`.trimEnd());
        return false;
    }
    // needs.how: where the items came from ("from your pyrotech:rock:0 rocks"); C1's default (#234 nit).
    const how = needs.how ?? 'from mixed items';
    if (made < num) log(bot, `Crafted ${made} of ${num} ${itemName} ${how}; ${why ?? 'not enough for more'}. You now have ${countItem(bot, itemName)} ${itemName}.`);
    else log(bot, `Successfully crafted ${itemName} ${how}, you now have ${countItem(bot, itemName)} ${itemName}.`);
    bot.armorManager?.equipAll();
    return true;
}

export async function wait(bot, milliseconds) {
    /**
     * Waits for the given number of milliseconds.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} milliseconds, the number of milliseconds to wait.
     * @returns {Promise<boolean>} true if the wait was successful, false otherwise.
     * @example
     * await skills.wait(bot, 1000);
     **/
    // setTimeout is disabled to prevent unawaited code, so this is a safe alternative that enables interrupts
    let timeLeft = milliseconds;
    let startTime = Date.now();
    
    while (timeLeft > 0) {
        if (bot.interrupt_code) return false;
        
        let waitTime = Math.min(2000, timeLeft);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        let elapsed = Date.now() - startTime;
        timeLeft = milliseconds - elapsed;
    }
    return true;
}

export async function smeltItem(bot, itemName, num=1, ops=FURNACE_OPS) {
    /**
     * Puts 1 coal in furnace and smelts the given item name, waits until the furnace runs out of fuel or input items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to smelt. Ores must contain "raw" like raw_iron.
     * @param {number} num, the number of items to smelt. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was smelted, false otherwise. Fail
     * @example
     * await skills.smeltItem(bot, "raw_iron");
     * await skills.smeltItem(bot, "beef");
     **/
    const run = currentRun(bot); // first: a limit during the walk must stop it too (#225 review)

    // isSmeltable checks bare names; "sand:0" from !inventory is sand (#131 re-review).
    if (!mc.isSmeltable(parseName(itemName)?.name ?? itemName)) {
        log(bot, `Cannot smelt ${itemName}. Hint: make sure you are smelting the 'raw' item.`);
        return false;
    }

    let placedFurnace = false;
    let placedAt = null;
    let furnaceBlock = undefined;
    const furnaceRange = 16;
    // A furnace this skill placed is picked up again however it ends (#225 nit: an aborted run left
    // it; after smelting it is often lit_furnace, which collectBlock(bot, 'furnace') does not match).
    const putAway = async () => {
        if (!placedFurnace) return;
        placedFurnace = false;
        await ops.pickUp(bot, placedAt);
    };
    furnaceBlock = world.getNearestBlock(bot, names112.FURNACE_BLOCKS, furnaceRange);
    if (!furnaceBlock){
        // Try to place furnace
        let hasFurnace = world.getInventoryCounts(bot)['furnace'] > 0;
        if (hasFurnace) {
            furnaceBlock = await ops.place(bot, furnaceRange);
            if (furnaceBlock) { placedFurnace = true; placedAt = furnaceBlock.position.clone ? furnaceBlock.position.clone() : furnaceBlock.position; }
            else log(bot, 'Could not place your furnace.');
            if (run.aborted) { await putAway(); return false; }
        }
    }
    if (!furnaceBlock){
        log(bot, `There is no furnace nearby and you have no furnace.`)
        return false;
    }
    if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
        await goToNearestBlock(bot, names112.FURNACE_BLOCKS, 4, furnaceRange);
        if (run.aborted) { await putAway(); return false; }
    }
    bot.modes.pause('unstuck');
    await bot.lookAt(furnaceBlock.position);
    if (run.aborted) { await putAway(); return false; }

    console.log('smelting...');
    const furnace = await bot.openFurnace(furnaceBlock);
    if (run.aborted) { closeQuietly(bot, furnace); await putAway(); return false; }
    // check if the furnace is already smelting something
    let input_item = furnace.inputItem();
    if (input_item && input_item.type !== mc.getItemId(itemName) && input_item.count > 0) {
        // TODO: check if furnace is currently burning fuel. furnace.fuel is always null, I think there is a bug.
        // This only checks if the furnace has an input item, but it may not be smelting it and should be cleared.
        log(bot, `The furnace is currently smelting ${mc.getItemName(input_item.type)}.`);
        await putAway();
        return false;
    }
    // check if the bot has enough items to smelt
    if (countItem(bot, itemName) < num) { // "log" counts every log; "log:1" spruce only (B1b)
        log(bot, `You do not have enough ${itemName} to smelt.`);
        await putAway();
        return false;
    }

    // fuel the furnace
    if (!furnace.fuelItem()) {
        let fuel = mc.getSmeltingFuel(bot);
        if (!fuel) {
            log(bot, `You have no fuel to smelt ${itemName}, you need coal, charcoal, or wood.`);
            await putAway();
            return false;
        }
        log(bot, `Using ${fuel.name} as fuel.`);

        const put_fuel = Math.ceil(num / mc.getFuelSmeltOutput(fuel.name));

        if (fuel.count < put_fuel) {
            log(bot, `You don't have enough ${fuel.name} to smelt ${num} ${itemName}; you need ${put_fuel}.`);
            await putAway();
            return false;
        }
        await furnace.putFuel(fuel.type, null, put_fuel);
        log(bot, `Added ${put_fuel} ${mc.getItemName(fuel.type)} to furnace fuel.`);
        console.log(`Added ${put_fuel} ${mc.getItemName(fuel.type)} to furnace fuel.`)
    }
    // put the items in the furnace
    await furnace.putInput(mc.getItemId(itemName), parseName(itemName)?.meta ?? null, num);
    // wait for the items to smelt
    let total = 0;
    let smelted_item = null;
    await new Promise(resolve => setTimeout(resolve, 200));
    let last_collected = Date.now();
    while (total < num) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (furnace.outputItem()) {
            smelted_item = await furnace.takeOutput();
            if (smelted_item) {
                total += smelted_item.count;
                last_collected = Date.now();
            }
        }
        if (Date.now() - last_collected > 11000) {
            break; // if nothing has been collected in 11 seconds, stop
        }
        if (bot.interrupt_code || run.aborted) {
            break;
        }
    }
    // take all remaining in input/fuel slots
    if (furnace.inputItem()) {
        await furnace.takeInput();
    }
    if (furnace.fuelItem()) {
        await furnace.takeFuel();
    }

    await bot.closeWindow(furnace);

    await putAway();
    if (total === 0) {
        log(bot, `Failed to smelt ${itemName}.`);
        return false;
    }
    if (total < num) {
        log(bot, `Only smelted ${total} ${mc.getItemName(smelted_item.type)}.`);
        return false;
    }
    log(bot, `Successfully smelted ${itemName}, got ${total} ${mc.getItemName(smelted_item.type)}.`);
    return true;
}

/**
 * Place the furnace from the inventory on the nearest free space. Its own furnace, or null: the
 * placement must succeed and a furnace must stand at that position. Never the nearest furnace,
 * which could be someone else's that smeltItem would then pick up (#238 review 2).
 */
export async function placeFurnaceNear(bot, range, { place = placeBlock, freeSpace = world.getNearestFreeSpace } = {}) {
    const pos = freeSpace(bot, 1, range);
    if (!pos) return null;
    // The place must be air before placing (#247 review 3), so a furnace there afterwards is ours.
    if (bot.blockAt(pos)?.name !== 'air') return null;
    // placeBlock can report a failure (or throw) although the server placed it (#238 nit 1): what
    // stands at pos decides. pos was air, so a furnace there is this one, never someone else's.
    try { await place(bot, 'furnace', pos.x, pos.y, pos.z); }
    catch (err) { log(bot, `Placing the furnace failed (${safeError(err)}).`); }
    const b = bot.blockAt(pos);
    return b && names112.isFurnace(b.name) ? b : null;
}

/** Pick up a furnace at pos (lit or not): break it with the right tool, then take the drop. */
export async function pickUpFurnaceAt(bot, pos) {
    const b = pos ? bot.blockAt(pos) : null;
    if (!b || !names112.isFurnace(b.name)) return false;
    try {
        if (!await breakBlockAt(bot, pos.x, pos.y, pos.z)) return false;
        await pickupNearbyItems(bot);
        return true;
    } catch (err) {
        log(bot, `Could not pick the furnace up again (${safeError(err)}).`);
        return false;
    }
}

/** How smeltItem places and picks up its own furnace (tests pass their own). */
export const FURNACE_OPS = { place: placeFurnaceNear, pickUp: pickUpFurnaceAt };

export async function clearNearestFurnace(bot) {
    /**
     * Clears the nearest furnace of all items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the furnace was cleared, false otherwise.
     * @example
     * await skills.clearNearestFurnace(bot);
     **/
    const run = currentRun(bot); // first: a limit during the walk must stop it too (#225 review)
    let furnaceBlock = world.getNearestBlock(bot, names112.FURNACE_BLOCKS, 32);
    if (!furnaceBlock) {
        log(bot, `No furnace nearby to clear.`);
        return false;
    }
    if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
        await goToNearestBlock(bot, names112.FURNACE_BLOCKS, 4, 32);
        if (run.aborted) return false;
    }

    console.log('clearing furnace...');
    const furnace = await bot.openFurnace(furnaceBlock);
    if (run.aborted) { closeQuietly(bot, furnace); return false; }
    console.log('opened furnace...')
    // take the items out of the furnace
    let smelted_item, intput_item, fuel_item;
    if (furnace.outputItem())
        smelted_item = await furnace.takeOutput();
    if (furnace.inputItem())
        intput_item = await furnace.takeInput();
    if (furnace.fuelItem())
        fuel_item = await furnace.takeFuel();
    console.log(smelted_item, intput_item, fuel_item)
    let smelted_name = smelted_item ? `${smelted_item.count} ${smelted_item.name}` : `0 smelted items`;
    let input_name = intput_item ? `${intput_item.count} ${intput_item.name}` : `0 input items`;
    let fuel_name = fuel_item ? `${fuel_item.count} ${fuel_item.name}` : `0 fuel items`;
    log(bot, `Cleared furnace, received ${smelted_name}, ${input_name}, and ${fuel_name}.`);
    return true;

}


export async function attackNearest(bot, mobType, kill=true) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} mobType, the type of mob to attack.
     * @param {boolean} kill, whether or not to continue attacking until the mob is dead. Defaults to true.
     * @returns {Promise<boolean>} true if the mob was attacked, false if the mob type was not found.
     * @example
     * await skills.attackNearest(bot, "zombie", true);
     **/
    bot.modes.pause('cowardice');
    if (mobType === 'drowned' || mobType === 'cod' || mobType === 'salmon' || mobType === 'tropical_fish' || mobType === 'squid')
        bot.modes.pause('self_preservation'); // so it can go underwater. TODO: have an drowning mode so we don't turn off all self_preservation
    const mob = world.getNearbyEntities(bot, 24).find(entity => entity.name === mobType);
    if (mob) {
        return await attackEntity(bot, mob, kill);
    }
    log(bot, 'Could not find any '+mobType+' to attack.');
    return false;
}

export async function attackEntity(bot, entity, kill=true) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} entity, the entity to attack.
     * @returns {Promise<boolean>} true if the entity was attacked, false if interrupted
     * @example
     * await skills.attackEntity(bot, entity);
     **/

    let pos = entity.position;
    await equipHighestAttack(bot)

    if (!kill) {
        if (bot.entity.position.distanceTo(pos) > 5) {
            console.log('moving to mob...')
            await goToPosition(bot, pos.x, pos.y, pos.z);
        }
        console.log('attacking mob...')
        await bot.attack(entity);
    }
    else {
        bot.pvp.attack(entity);
        while (world.getNearbyEntities(bot, 24).includes(entity)) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (bot.interrupt_code) {
                bot.pvp.stop();
                return false;
            }
        }
        log(bot, `Successfully killed ${entity.name}.`);
        await pickupNearbyItems(bot);
        return true;
    }
}

export async function defendSelf(bot, range=9, isEnemy=(entity) => mc.isHostile(entity), keepFighting=() => true) {
    /**
     * Defend yourself from all nearby hostile mobs until there are no more.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} range, the range to look for mobs. Defaults to 8.
     * @param {function} isEnemy, which mobs to fight (skills-rotn D2c: the modes pass rotn-data's
     *   "fight" mobs, so an enderman or a creeper is never attacked). Defaults to mc.isHostile.
     * @param {function} keepFighting, checked each round: false ends the fight (D2c, #186 review:
     *   a creeper or more mobs arriving mid-fight must lead to a retreat). Defaults to always.
     * @returns {Promise<boolean>} true if the bot found any enemies and has killed them, false if no entities were found.
     * @example
     * await skills.defendSelf(bot);
     * **/
    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    let attacked = false;
    const fight = {}; // one line when the weapon cannot be taken in hand (G3 round 7 B)
    let enemy = world.getNearestEntityWhere(bot, isEnemy, range);
    while (enemy) {
        await equipHighestAttack(bot, fight);
        if (bot.entity.position.distanceTo(enemy.position) >= 4 && enemy.name !== 'creeper' && enemy.name !== 'phantom') {
            try {
                bot.pathfinder.setMovements(new pf.Movements(bot));
                await boundedGoto(bot, new pf.goals.GoalFollow(enemy, 3.5), GO_TO_LIMITS.stepMs);
            } catch (err) {/* might error if entity dies, ignore */}
        }
        if (bot.entity.position.distanceTo(enemy.position) <= 2) {
            try {
                bot.pathfinder.setMovements(new pf.Movements(bot));
                let inverted_goal = new pf.goals.GoalInvert(new pf.goals.GoalFollow(enemy, 2));
                await boundedGoto(bot, inverted_goal, GO_TO_LIMITS.stepMs);
            } catch (err) {/* might error if entity dies, ignore */}
        }
        bot.pvp.attack(enemy);
        attacked = true;
        await new Promise(resolve => setTimeout(resolve, 500));
        enemy = world.getNearestEntityWhere(bot, isEnemy, range);
        if (bot.interrupt_code) {
            bot.pvp.stop();
            return false;
        }
        if (enemy && !keepFighting()) {
            log(bot, `Stopped fighting: the situation changed.`);
            break;
        }
    }
    bot.pvp.stop();
    if (attacked)
        log(bot, `Successfully defended self.`);
    else
        log(bot, `No enemies nearby to defend self from.`);
    return attacked;
}



export async function collectBlock(bot, blockType, num=1, exclude=null) {
    /**
     * Collect one of the given block type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to collect.
     * @param {number} num, the number of blocks to collect. Defaults to 1.
     * @param {list} exclude, a list of positions to exclude from the search. Defaults to null.
     * @returns {Promise<boolean>} true if the block was collected, false if the block type was not found.
     * @example
     * await skills.collectBlock(bot, "oak_log");
     **/
    if (num < 1) {
        log(bot, `Invalid number of blocks to collect: ${num}.`);
        return false;
    }
    // blockType is a canonical name ("log", "log:0", "dirt:0"); aliases key on its bare name (#131 review).
    const baseType = parseName(blockType)?.name ?? blockType;
    // The variants the name stands for: rotn-data narrows a bare rock name to the rock
    // variants, so dirt clumps and sand piles are not "rocks" (#141 review).
    const targets = itemVariants(blockType);
    let blocktypes = [...targets];
    if (baseType === 'coal' || baseType === 'diamond' || baseType === 'emerald' || baseType === 'iron' || baseType === 'gold' || baseType === 'lapis_lazuli' || baseType === 'redstone')
        blocktypes.push(baseType+'_ore');
    if (baseType === 'dirt')
        blocktypes.push(names112.GRASS_BLOCK); // 1.12: the grass block drops dirt
    // RotN world rules (rotn-data howToGet, B2): the blocks whose breaking gives this item, if
    // the bot holds the tool the rule needs. Rocks also come from stone mined with a pickaxe
    // below Sturdy. That is also why the old cobblestone -> stone alias is gone: such stone
    // drops rocks, not cobblestone.
    const ruleTools = []; // [matcher, tool] for rules that need a tool
    const preferredTools = []; // [matcher, tool] for rules where a tool helps but is not needed (#252)
    const needsTool = [];
    const fellMatchers = []; // rotn-data "fell-tree": breaking a branch fells the whole tree
    const avoidTools = []; // [matcher, tool]: rules whose drop a tool changes (rotn-data #288 unlessTool)
    const sources = worldSources(blockType);
    for (const source of sources) {
        if (!toolAllows(bot, source.tool)) {
            needsTool.push(source);
            continue;
        }
        for (const name of source.blocks)
            if (!blocktypes.includes(name)) blocktypes.push(name);
        if (source.tool) ruleTools.push([blockMatcher(source.blocks), source.tool, source.blocks]);
        else if (source.preferredTool) preferredTools.push([blockMatcher(source.blocks), source.preferredTool]);
        if (source.unlessTool) avoidTools.push([blockMatcher(source.blocks), source.unlessTool]);
        if (source.id === 'fell-tree') fellMatchers.push(blockMatcher(source.blocks));
    }
    // The item's own blocks give it only with a tool the bot lacks (rotn-data #288: dirt drops
    // itself only to a shovel of level 1+; by hand it drops 4 dirt piles, and "Broke dirt but got no
    // dirt" was all the bot learned). Then collect what those blocks do give by hand and craft it
    // (4 dirt piles -> 1 dirt in the inventory grid), when rotn-data has such a way.
    const ownBlocks = (s) => s.blocks.some(b => (parseName(b)?.name ?? b) === baseType);
    if (!collectRouting && needsTool.some(ownBlocks) && !sources.some(s => ownBlocks(s) && toolAllows(bot, s.tool))) {
        const route = handRoute(bot, blockType);
        if (route) return await collectByRoute(bot, blockType, num, route, needsTool.find(ownBlocks));
    }
    // Any Dynamic Trees branch fells its tree, whichever rule names it (rotn-data #13: a branch
    // broken by hand drops the tree's logs and sticks): always the safe cut, never collect().
    const fellsTree = (block) => isBranch(block) || fellMatchers.some(matches => matches(block));
    const woodTarget = isWoodSearch(blockType);
    const ruleToolFor = (block) => ruleTools.find(([matches]) => matches(block))?.[1] ?? null;
    const avoidToolFor = (block) => avoidTools.find(([matches]) => matches(block))?.[1] ?? null;
    // Never hold a tool that changes the rule's drop (a shovel of level 1+ for dirt piles); false
    // when it cannot be let go without throwing it away (#291 review: a full inventory).
    const handOff = async (avoid) => !avoid || await stopHolding(bot, avoid);
    const cannotLetGo = (block) => `Not digging ${block.name}: you hold ${bot.heldItem?.name}, which would make it drop dirt instead of ${blockType}, `
        + 'and with a full inventory and no other item in the hotbar it could only be let go by throwing it away. Free a slot first.';
    // Count what the bot really gains, not a rule's yield (#141 review): the targets in the
    // inventory before and after each break. A block with no item (water) counts 1 per success.
    const countsItems = mc.getItemId(baseType) != null;
    // The held targets by inventory key ("pyrotech_compat:rock_igneous:7"), so the bot can say
    // which items it really gained (#145 review nit).
    const heldByKey = () => {
        const byKey = {};
        for (const item of bot.inventory.items()) {
            if (!targets.some(name => itemMatches(item, name))) continue;
            const key = inventoryKey(item) ?? item.name;
            byKey[key] = (byKey[key] ?? 0) + item.count;
        }
        return byKey;
    };
    const gainedByKey = {};
    const allHeld = () => {
        const byKey = {};
        for (const item of bot.inventory.items()) {
            const key = inventoryKey(item) ?? item.name;
            byKey[key] = (byKey[key] ?? 0) + item.count;
        }
        return byKey;
    };
    const isLiquid = baseType === 'lava' || baseType === 'water';
    let isWanted = blockMatcher(blocktypes); // the shared resolver: names and variants (#131 review)
    // A rule's tool can break during the run: stop searching that rule's blocks (B2b).
    const dropRule = (tool) => {
        const gone = new Set(ruleTools.filter(([, t]) => t === tool).flatMap(([, , names]) => names));
        blocktypes = blocktypes.filter(name => !gone.has(name) || targets.includes(name));
        ruleTools.splice(0, ruleTools.length, ...ruleTools.filter(([, t]) => t !== tool));
        isWanted = blockMatcher(blocktypes);
    };

    let collected = 0;

    const movements = new pf.Movements(bot);
    movements.dontMineUnderFallingBlock = false;
    movements.dontCreateFlow = true;

    // Blocks to ignore safety for, usually next to lava/water
    const unsafeBlocks = ['obsidian'];

    // Bounded (G3 review of #221): bot.collectBlock.collect has no time limit. Each block gets
    // COLLECT_LIMITS.blockMs (then it is given up and skipped), the whole run totalMs.
    const CL = COLLECT_LIMITS;
    const run = currentRun(bot);
    const runStart = Date.now();
    const givenUp = [];
    const refusedTrees = new Set(); // trees fellTree found no safe place for: said once (G3 round 5 A)
    // Fall safety (G3 round 4 B, fall_safety.js): off a tree first; mineflayer-collectblock's own
    // walks never drop over 3 blocks nor break a branch; leaves only from the ground.
    if (standsOnTree(bot) && !(await descendFromTree(bot, run))) {
        log(bot, `Not collecting ${blockType}: you are up on a tree and found no safe way down; try !moveAway or wait.`);
        return false;
    }
    // Intended to last (#256 nit): mineflayer-collectblock keeps one Movements for every collect, so
    // this makes all its walks fall-safe from the first collect on (fallSafe marks it, so only once).
    if (bot.collectBlock?.movements) fallSafe(bot.collectBlock.movements);
    for (let i=0; i<num && collected<num; i++) { // collected counts the items really gained (a stone can give 4 rocks)
        if (run.aborted) break;
        if (Date.now() - runStart >= CL.totalMs) {
            log(bot, `Stopped collecting ${blockType}: time limit of ${secsText(CL.totalMs)} reached.`);
            break;
        }
        let blocks = world.getNearestBlocksWhere(bot, block => {
            if (!isWanted(block)) {
                return false;
            }
            // findBlocks' section scan passes blocks without a position (G3 round 2 B: "Cannot read
            // properties of null (reading 'x')" after the first give-up).
            if (block.position && givenUp.some(p => p.equals(block.position))) return false;
            // Leaves only where the bot can reach them standing on the ground: never climb for them.
            if (isLeafBlock(block) && !leafFromGround(bot, block)) return false;
            // Wood only on the surface: never a log underground (G3 round 5 A rerun).
            if (block.position && woodTarget && world.isUnderground(bot, block.position)) return false;
            if (exclude) {
                for (let position of exclude) {
                    if (block.position.x === position.x && block.position.y === position.y && block.position.z === position.z) {
                        return false;
                    }
                }
            }
            if (isLiquid) {
                // collect only source blocks
                return block.metadata === 0;
            }
            
            return movements.safeToBreak(block) || unsafeBlocks.includes(block.name);
        }, 64, 1);

        if (blocks.length === 0) {
            if (collected === 0)
                log(bot, `No ${blockType} nearby to collect.`);
            else
                log(bot, `No more ${blockType} nearby to collect.`);
            // Say which other source the bot could use with the right tool (B2).
            for (const source of needsTool)
                log(bot, `${source.text} That needs ${describeTool(source.tool)}.`);
            break;
        }
        const block = blocks[0];
        // A rule's tool decides what drops: below Sturdy stone gives rocks, a Sturdy pickaxe
        // cobblestone. So equip a tool the rule accepts, not the fastest (#141 review).
        const ruleTool = ruleToolFor(block);
        if (ruleTool) {
            const ruleItem = allowedTool(bot, ruleTool);
            if (!ruleItem) { // it broke or was dropped since the search began (lead, before G3)
                log(bot, `No longer have ${describeTool(ruleTool)} to break ${block.name}; skipping those blocks.`);
                dropRule(ruleTool);
                i--; // finding the tool gone is not an attempt (#145 review nit); dropRule removes the rule, so this ends
                continue;
            }
            await bot.equip(ruleItem, 'hand');
        }
        else if (avoidToolFor(block)) {
            // rotn-data #288: by hand (or a lesser tool), never the tool that changes the drop;
            // mineflayer-tool would pick the fastest, which is that shovel.
            if (!await handOff(avoidToolFor(block))) {
                log(bot, cannotLetGo(block));
                break;
            }
        }
        else {
            // A preferred tool (an axe to fell a tree, rotn-data #252) when the bot holds one; else the hand.
            const preferred = preferredTools.find(([matches]) => matches(block))?.[1];
            const prefItem = preferred ? allowedTool(bot, preferred) : null;
            if (prefItem) await bot.equip(prefItem, 'hand');
            else await bot.tool.equipForBlock(block);
        }
        if (run.aborted) break;
        if (isLiquid) {
            const bucket = bot.inventory.findInventoryItem('bucket');
            if (!bucket) {
                log(bot, `Don't have bucket to harvest ${blockType}.`);
                return false;
            }
            await bot.equip(bucket, 'hand');
        }
        const itemId = bot.heldItem ? bot.heldItem.type : null
        if (!block.canHarvest(itemId)) {
            log(bot, `Don't have right tools to harvest ${blockType}.`);
            return false;
        }
        try {
            let success = false;
            const before = heldByKey();
            const allBefore = allHeld();
            const breakIt = async () => {
                if (isLiquid) return await useToolOnBlock(bot, 'bucket', block);
                // By hand when the block has no collision box (a rock pile), or when a rule's tool must
                // stay equipped: bot.collectBlock.collect would re-equip the fastest tool (B2).
                // A Dynamic Trees branch fells the whole tree, which falls as one entity and can
                // crush the bot (G3 round 3 B): cut it safely (fellTree), and collect its logs after
                // the fall, around the tree (G3 smoke C+D).
                if (fellsTree(block)) {
                    const r = await fellTree(bot, block, run, refusedTrees);
                    for (const p of r.skip) givenUp.push(p);
                    return r.cut;
                }
                // Leaves from the ground (G3 round 4 B), not with collectBlock's walk into the tree.
                if (isLeafBlock(block)) {
                    const r = await breakLeafFromGround(bot, block, run);
                    if (!r) givenUp.push(block.position.clone ? block.position.clone() : block.position);
                    return r;
                }
                // A rule whose drop a tool changes is dug here too: bot.collectBlock.collect would
                // equip the fastest tool (rotn-data #288).
                const avoid = avoidToolFor(block);
                if (ruleTool || avoid || mc.mustCollectManually(block.name)) {
                    await goToPosition(bot, block.position.x, block.position.y, block.position.z, 2);
                    if (run.aborted) return false;
                    if (!await handOff(avoid)) { log(bot, cannotLetGo(block)); return false; } // still not after the walk
                    await bot.dig(block);
                    if (run.aborted) return true; // broken; the gain is still counted below
                    await pickupNearbyItems(bot);
                    return true;
                }
                await bot.collectBlock.collect(block);
                return true;
            };
            const blockMs = Math.min(CL.blockMs, CL.totalMs - (Date.now() - runStart));
            const breaking = breakIt();
            const res = await within(breaking, blockMs, () => {
                try { Promise.resolve(bot.collectBlock?.cancelTask?.()).catch(() => {}); } catch { /* best effort */ }
                try { bot.stopDigging?.(); } catch { /* best effort */ }
                stopWalking(bot);
            });
            if (res === TIMED_OUT) {
                // Let the cancelled break end before the next block (#224 review 2), at most STOP_SETTLE_MS.
                await within(breaking.catch(() => {}), STOP_SETTLE_MS);
                givenUp.push(block.position.clone ? block.position.clone() : block.position);
                log(bot, `Gave up on ${block.name} at ${block.position.x}, ${block.position.y}, ${block.position.z}: time limit of ${secsText(blockMs)} reached.`);
            }
            else success = res;
            if (success) {
                let gained = 1; // a block with no item (water): one per success
                if (countsItems) {
                    gained = 0;
                    for (const [key, n] of Object.entries(heldByKey())) {
                        const d = n - (before[key] ?? 0);
                        if (d > 0) {
                            gained += d;
                            gainedByKey[key] = (gainedByKey[key] ?? 0) + d;
                        }
                    }
                }
                collected += gained;
                if (gained === 0) {
                    // Say what it did give (round 5 A rerun: a felled spruce gave logs, the stick
                    // line said only "got no stick"), and that sticks are rare from felling.
                    const other = Object.entries(allHeld()).map(([key, n]) => [key, n - (allBefore[key] ?? 0)]).filter(([, d]) => d > 0);
                    const gave = other.length ? ` (it gave ${other.map(([key, d]) => `${d} ${key}`).join(', ')})` : '';
                    const rare = baseType === 'stick' && fellsTree(block) ? ' A felled tree drops few sticks, often none.' : '';
                    log(bot, `Broke ${block.name} but got no ${blockType}${gave}.${rare}`);
                }
            }
            if (run.aborted) break;
            await autoLight(bot);
        }
        catch (err) {
            if (err.name === 'NoChests') {
                log(bot, `Failed to collect ${blockType}: Inventory full, no place to deposit.`);
                break;
            }
            else {
                log(bot, `Failed to collect ${blockType}: ${err}.`);
                continue;
            }
        }
        
        if (bot.interrupt_code)
            break;  
    }
    // Name what was really gained when it is not just the asked-for name (a rock can be an
    // Underground Biomes rock): "Collected 3 pyrotech:rock (2 pyrotech_compat:rock_metamorphic:0, ...)".
    // A run that ended up on a tree anyway (a pile, a pickup) climbs down before it returns.
    if (!run.aborted && standsOnTree(bot)) await descendFromTree(bot, run);
    // Sticks short (G3 round 5 A: no tree could be felled safely, 0 sticks): RotN keeps 2 planks
    // (ore:stickMat) -> 4 sticks in the inventory grid, so make the rest from held planks.
    let fromPlanks = 0;
    if (baseType === 'stick' && collected < num && !run.aborted && !bot.interrupt_code)
        fromPlanks = await sticksFromPlanks(bot, num - collected, run);
    collected += fromPlanks;
    const gainedNames = Object.entries(gainedByKey);
    const details = gainedNames.length && !(gainedNames.length === 1 && gainedNames[0][0] === blockType)
        ? ` (${gainedNames.map(([key, n]) => `${n} ${key}`).join(', ')})` : '';
    log(bot, `Collected ${collected} ${blockType}${details}${fromPlanks ? `, ${fromPlanks} of them made from planks` : ''}.`);
    return collected > 0;
}

let collectRouting = false; // collectByRoute's own collect does not take another route

/** mineflayer's player window: the hotbar is slots 36-44. */
const HOTBAR_START = 36;

/**
 * Stop holding a tool the spec matches (rotn-data #288: a shovel of level 1+ turns dirt piles back
 * into dirt), never by throwing it away. #291 review: mineflayer's unequip('hand') tosses the held
 * stack when no hotbar or inventory slot is free. So, in order: switch to an empty hotbar slot, or
 * to one holding something else; else unequip only while an inventory slot is free. Returns
 * whether the bot no longer holds such a tool.
 */
export async function stopHolding(bot, tool) {
    if (!isToolFor(bot.heldItem, tool)) return true;
    const slots = bot.inventory?.slots ?? [];
    const hotbar = Array.from({ length: 9 }, (_, i) => slots[HOTBAR_START + i] ?? null);
    let i = hotbar.findIndex(it => !it);
    if (i < 0) i = hotbar.findIndex(it => !isToolFor(it, tool));
    if (i >= 0 && typeof bot.setQuickBarSlot === 'function') {
        bot.setQuickBarSlot(i);
        return !isToolFor(bot.heldItem, tool);
    }
    if (bot.inventory?.firstEmptyInventorySlot?.() != null) {
        await bot.unequip('hand'); // a free slot: it moves the stack there, nothing is tossed
        return !isToolFor(bot.heldItem, tool);
    }
    return false;
}

/** How collectByRoute crafts (tests pass their own). */
export const COLLECT_ROUTE_OPS = { craft: (...args) => craftRecipe(...args) };

/**
 * Collect an item by its hand route (rotn_sources.handRoute): collect route.per of the input for
 * each item still wanted (the inputs held count), then craft them in the inventory grid. rotn-data
 * #288: !collectBlocks("dirt") without a level-1 shovel collects dirt piles, 4 per dirt.
 */
async function collectByRoute(bot, blockType, num, route, shovelRule) {
    const before = countItem(bot, blockType);
    log(bot, `${blockType} drops itself only with ${describeTool(shovelRule.tool)}. By hand: ${route.text} `
        + `Collecting ${route.input} (${route.per} per ${blockType}) and crafting.`);
    const needInputs = Math.max(0, route.per * num - countItem(bot, route.input));
    if (needInputs > 0) {
        collectRouting = true;
        try { await collectBlock(bot, route.input, needInputs); } finally { collectRouting = false; }
    }
    const n = Math.min(num, Math.floor(countItem(bot, route.input) / route.per));
    if (n > 0 && !currentRun(bot).aborted) await COLLECT_ROUTE_OPS.craft(bot, route.gives, n);
    const gained = Math.max(0, countItem(bot, blockType) - before);
    log(bot, `Collected ${gained} ${blockType}${gained ? ` (crafted from ${route.input})` : ''}.`);
    return gained > 0;
}

/** Held planks (ore:stickMat) by kind: { "planks:1": 3, ... }. A stick takes 2 of one kind. */
function planksByKind(bot) {
    const names = oreMemberNames('stickMat');
    const byKind = {};
    for (const item of bot.inventory.items()) {
        if (!names.some(name => itemMatches(item, name))) continue;
        const key = inventoryKey(item) ?? item.name;
        byKind[key] = (byKind[key] ?? 0) + item.count;
    }
    return byKind;
}

/**
 * A plank (a stickMat member) that a held log makes in the 2x2 grid now, or null (rotn-data #278:
 * vanilla logs need a table, but mangrove, Pam's maple, cinnamon and paperbark, twilight oak, tower
 * wood and End logs do not). Only recipes made of logs, so planks are never turned into other planks.
 */
export function gridPlanksReady(bot, logNames = oreMemberNames('logWood')) {
    const isLog = (name) => { const p = parseName(name); return !!p && logNames.some(n => itemMatches({ name: p.name, metadata: p.meta ?? 0 }, n)); };
    for (const name of oreMemberNames('stickMat')) {
        const way = craftNeeds(bot, name);
        if (way?.ready && !way.requiresTable && way.inputs.length > 0
            && way.inputs.every(i => i.kinds.length > 0 && i.kinds.every(k => isLog(k.name)))) return name;
    }
    return null;
}

/** A crafting table placed within 16 blocks, or one held. */
const tableAtHand = (bot) => countItem(bot, 'crafting_table') > 0 || !!world.getNearestBlock(bot, 'crafting_table', 16);

/**
 * Held planks by kind that sticks may use: before the bot has a table (none near or held), one plank
 * of the most-held kind is kept for it (round 5 A rerun; the lead's Hit With Axe path).
 */
function sparePlanksByKind(bot) {
    const byKind = planksByKind(bot);
    if (tableAtHand(bot)) return byKind;
    const most = Object.entries(byKind).sort((a, b) => b[1] - a[1])[0];
    if (most) byKind[most[0]] -= 1;
    return byKind;
}

/** The sticks crafts the held planks allow: 2 of one kind each, never a mixed pair (#268 follow-up 3). */
export const stickCraftsHeld = (bot) => Object.values(sparePlanksByKind(bot)).reduce((n, c) => n + Math.floor(Math.max(0, c) / 2), 0);

/**
 * Sticks short (G3 round 5 A: no tree could be felled safely): make `need` sticks from held planks,
 * 2 planks of one kind giving 4 (RotN keeps it, in the inventory grid). Without a pair of one kind,
 * held logs (ore:logWood) are made into planks first (#268 follow-up 2), but only with a crafting
 * table near or held: every RotN log -> planks recipe is a 3-high column (rotn-data; round 5 A
 * rerun: "Crafting planks requires a crafting table"). Bounded rounds, each must make progress.
 * Returns the sticks made.
 */
export async function sticksFromPlanks(bot, need, run = currentRun(bot), rounds = 4, axeOps = AXE_CHOP_OPS) {
    const logNames = oreMemberNames('logWood');
    const logsHeld = () => logNames.reduce((n, name) => n + countItem(bot, name), 0);
    const planksHeld = () => Object.values(planksByKind(bot)).reduce((n, c) => n + c, 0);
    let made = 0;
    let gridFailed = false;
    for (let r = 0; r < rounds && made < need && !run.aborted && !bot.interrupt_code; r++) {
        const crafts = Math.ceil((need - made) / 4);
        const pairs = stickCraftsHeld(bot);
        if (pairs === 0) {
            // No table: a log whose planks recipe is 2x2 is crafted first (rotn-data #278).
            const grid = !gridFailed && !tableAtHand(bot) ? gridPlanksReady(bot, logNames) : null;
            if (grid) {
                const before = planksHeld();
                log(bot, `Making ${grid} from your logs in the 2x2 grid (these logs need no crafting table).`);
                await craftRecipe(bot, grid, 1);
                if (planksHeld() > before) continue;
                log(bot, `Could not make ${grid} from your logs (the reason is above).`);
                gridFailed = true;
            }
            // No table near or held: Hit With Axe with any axe of level 0 or more (the lead's
            // decision, rotn-data #272): a placed log gives 1 plank (2 uses), a placed plank 2 sticks.
            if (!tableAtHand(bot)) {
                if (allowedTool(bot, AXE_ANY)) { made += await sticksByAxe(bot, need - made, run, axeOps); break; }
                if (logsHeld() === 0 && planksHeld() === 0) break;
                // Said once, with what to do instead, so the model does not retry the same command
                // (#270 review 1; round 5 A rerun: "Crafting planks requires a crafting table").
                log(bot, 'Not making planks: in RotN most logs (all vanilla ones) become planks only at a crafting table, and there is none near or held, and you hold no axe to chop them (place a log or plank and use the axe on it). Get a crude axe or a table first. Until then, River Cane or bamboo (picked by hand) work as sticks for the crude axe and the Crafting Tools.');
                break;
            }
            if (logsHeld() === 0) break;
            const before = planksHeld();
            log(bot, `Making planks from logs for sticks.`);
            await craftRecipe(bot, 'planks', Math.ceil(crafts / 2)); // 1 log: 4 planks in vanilla; another round if fewer
            if (planksHeld() <= before) {
                log(bot, 'Could not make planks from your logs (the reason is above); not trying again in this collect.');
                break;
            }
            continue;
        }
        const before = countItem(bot, 'stick');
        const left = need - made;
        log(bot, `Making the other ${left} stick${left === 1 ? '' : 's'} from planks (2 planks of one kind give 4).`);
        await craftRecipe(bot, 'stick', Math.min(crafts, pairs));
        const got = Math.max(0, countItem(bot, 'stick') - before);
        if (got === 0) {
            log(bot, 'Could not make sticks from your planks (the reason is above); not trying again in this collect.');
            break;
        }
        made += got;
    }
    return made;
}

/** Any axe of level 0 or more: the crude, flint or stone axe (rotn-data #272: Hit With Axe). */
export const AXE_ANY = { type: 'axe', minLevel: 0 };

/**
 * Bounds for Hit With Axe: axe clicks in all, time, the wait per click and for drops. reserve: the
 * uses each axe keeps (#274 review 1: the Crafting Tools need the same crude axe, often worn from
 * felling). cleanupMs: breaking a placed block back on an early exit.
 */
export const AXE_CHOP_LIMITS = { clicks: 8, totalMs: 90_000, settleMs: 1500, pickupMs: 5000, dropRadius: 3, reserve: 1, cleanupMs: 5000 };

/**
 * Hit With Axe (rotn-data #272; the lead's decision for round 5 A rerun: the path to sticks before
 * a table exists). Place a block and use (right-click) any axe of level 0 or more on it: a log is
 * debarked on the first click (+1 bark) and gives 1 plank on the second; a plank gives 2 sticks.
 * Each click costs 1 axe use, and the drop lands one block toward the bot. Planks are made from
 * held logs; before the bot has a table, one plank is kept for it. Bounded by AXE_CHOP_LIMITS:
 * a log or plank is chopped only when an axe has its uses and still keeps `reserve` (#274 review 1).
 * Gives up with a reason when there is no axe, nothing to chop, or a click changes nothing. Every
 * exit after a placement breaks the block back by hand and picks up the drops (#274 review 3).
 * ops.place(bot, name) places the item near the bot and returns the block (or null); ops.pickup
 * picks up the drops around a position; ops.takeBack breaks a placed block. Returns the sticks gained.
 */
export async function sticksByAxe(bot, need, run = currentRun(bot), ops = AXE_CHOP_OPS, limits = {}) {
    const L = { ...AXE_CHOP_LIMITS, ...limits };
    const O = { ...AXE_CHOP_OPS, ...ops };
    const start = Date.now();
    const left = () => L.totalMs - (Date.now() - start);
    const sticks = () => countItem(bot, 'stick');
    const first = sticks();
    if (!allowedTool(bot, AXE_ANY)) {
        log(bot, 'Not making sticks with an axe: you hold no axe (a crude, flint or stone axe works).');
        return 0;
    }
    // The axe for `uses` more clicks that still keeps L.reserve: the one with the most uses left.
    const usesLeft = (a) => toolUsesLeft(a) ?? Infinity; // unknown: only the click cap bounds it
    const axeFor = (uses) => allowedTools(bot, AXE_ANY).filter(a => usesLeft(a) - uses >= L.reserve)
        .sort((a, b) => usesLeft(b) - usesLeft(a))[0] ?? null;
    const keepAxe = (what, uses) => {
        const most = Math.max(...allowedTools(bot, AXE_ANY).map(usesLeft));
        log(bot, `Keeping the axe for the Crafting Tools: it has ${most} use${most === 1 ? '' : 's'} left, and chopping a ${what} takes ${uses}; stopping.`);
    };
    const logNames = oreMemberNames('logWood');
    const heldLog = () => bot.inventory.items().find(i => logNames.some(n => itemMatches(i, n))) ?? null;
    const plankNames = oreMemberNames('stickMat');
    const plankCount = () => bot.inventory.items().filter(i => plankNames.some(n => itemMatches(i, n))).reduce((n, i) => n + i.count, 0);
    const sparePlank = () => {
        const kind = Object.entries(sparePlanksByKind(bot)).find(([, n]) => n > 0)?.[0];
        return kind ? bot.inventory.items().find(i => (inventoryKey(i) ?? i.name) === kind) ?? null : null;
    };
    const stopped = () => run.aborted || !!bot.interrupt_code;
    // Every exit after a placement (#274 review 3): break what is left of the block back by hand
    // (not with the axe: its uses are kept), then pick the drops up. Bounded; when the command was
    // stopped or timed out, the block is still broken back, but there is no walk after the drops.
    const cleanUp = async (pos) => {
        const rest = bot.blockAt(pos);
        if (rest && rest.name !== 'air' && rest.boundingBox !== 'empty') {
            try {
                const res = await within(O.takeBack(bot, rest), L.cleanupMs, () => { try { bot.stopDigging?.(); } catch { /* best effort */ } });
                if (res === TIMED_OUT) log(bot, `Could not break the placed ${rest.name} back within ${secsText(L.cleanupMs)}.`);
            } catch (err) {
                log(bot, `Could not break the placed ${rest.name} back (${safeError(err)}).`);
            }
        }
        if (stopped()) { log(bot, `Stopped; the drops are left near ${pos}.`); return; }
        await O.pickup(bot, pos, L);
    };
    let clicks = 0;
    // Place `item`, click it with the axe up to maxClicks times while it changes, then clean up;
    // true when `gained()` rose.
    const chop = async (item, gained, maxClicks) => {
        const name = inventoryKey(item) ?? item.name;
        const block = await O.place(bot, name);
        if (!block) { log(bot, `Could not place ${name} to chop it with the axe.`); return false; }
        const pos = block.position;
        const before = gained();
        let ok = true;
        try {
            for (let i = 0; i < maxClicks && clicks < L.clicks && left() > 0 && !stopped(); i++) {
                const now = bot.blockAt(pos);
                if (!now || now.name === 'air') break;
                if (!allowedTool(bot, AXE_ANY)) { log(bot, 'Your axe broke; stopping.'); ok = false; break; }
                const axe = axeFor(1);
                if (!axe) { keepAxe(now.name, 1); ok = false; break; }
                await bot.equip(axe, 'hand');
                await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
                const was = `${now.name}:${now.metadata}`;
                await bot.activateBlock(now);
                clicks++;
                let after = null;
                for (const until = Date.now() + Math.min(L.settleMs, Math.max(0, left())); ;) {
                    after = bot.blockAt(pos);
                    if (!after || `${after.name}:${after.metadata}` !== was || Date.now() >= until) break;
                    await new Promise(r => setTimeout(r, 100));
                }
                if (after && `${after.name}:${after.metadata}` === was) {
                    log(bot, `Using the axe on the placed ${now.name} changed nothing; stopping.`);
                    ok = false;
                    break;
                }
            }
        } finally {
            await cleanUp(pos);
        }
        return ok && !stopped() && gained() > before;
    };
    while (sticks() - first < need && clicks < L.clicks && left() > 0 && !stopped()) {
        if (!allowedTool(bot, AXE_ANY)) { log(bot, 'Your axe broke; stopping.'); break; }
        const short = need - (sticks() - first);
        // 2 planks of one kind make 4 sticks with no axe use: craft them in the inventory grid.
        if (stickCraftsHeld(bot) > 0) {
            const before = sticks();
            await craftRecipe(bot, 'stick', Math.min(Math.ceil(short / 4), stickCraftsHeld(bot)));
            if (sticks() <= before) break;
            continue;
        }
        const plank = sparePlank();
        // A spare plank: chop it when 2 sticks will do, or when there is no log to pair it with.
        if (plank && (short <= 2 || !heldLog())) {
            if (!axeFor(1)) { keepAxe('plank', 1); break; }
            log(bot, `Chopping a placed ${inventoryKey(plank) ?? plank.name} with the axe for 2 sticks.`);
            if (!(await chop(plank, sticks, 1))) break;
            continue;
        }
        const wood = heldLog();
        if (!wood) {
            log(bot, `No logs${plankCount() ? ' or spare planks (one is kept for the crafting table)' : ' or planks'} to chop with the axe.`);
            break;
        }
        if (!axeFor(2)) { keepAxe('log', 2); break; }
        log(bot, `Chopping a placed ${inventoryKey(wood) ?? wood.name} with the axe for a plank (2 uses).`);
        if (!(await chop(wood, plankCount, 2))) break;
    }
    if (clicks >= L.clicks && sticks() - first < need) log(bot, `Stopped chopping: ${L.clicks} axe uses in this collect.`);
    else if (left() <= 0) log(bot, `Stopped chopping: time limit of ${secsText(L.totalMs)} reached.`);
    return Math.max(0, sticks() - first);
}

/**
 * Where to place a block to chop it (#274 review 4): an empty cell 1.5 to 3 blocks from the bot
 * (in reach, never its own cell), on firm ground (not leaves, a branch, a liquid or a hazard),
 * with no liquid or hazard within 1 block, and no ledge beside it: each side is solid or has firm
 * ground under it, so the drop (it lands one block toward the bot) stays up here. Nearest first;
 * the bot's own level before one up or down. Null when there is none.
 */
export function chopSpot(bot, maxDist = 3) {
    const me = bot.entity.position;
    const feet = new Vec3(Math.floor(me.x), Math.floor(me.y), Math.floor(me.z));
    const spots = [];
    for (let dx = -maxDist; dx <= maxDist; dx++) {
        for (let dz = -maxDist; dz <= maxDist; dz++) {
            const h = Math.hypot(dx, dz);
            if (h < 1.5 || h > maxDist) continue;
            for (const dy of [0, -1, 1]) {
                const p = feet.offset(dx, dy, dz);
                if (chopSpotOk(bot, p)) spots.push({ p, d: h + Math.abs(dy) });
            }
        }
    }
    spots.sort((a, b) => a.d - b.d);
    return spots[0]?.p ?? null;
}

/** chopSpot's test for one cell. */
export function chopSpotOk(bot, p) {
    const cell = bot.blockAt(p);
    if (!cell || cell.boundingBox !== 'empty' || isUnsafeBlock(bot, cell)) return false;
    if (!isFirmGround(bot, bot.blockAt(p.offset(0, -1, 0)))) return false;
    for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
            for (let z = -1; z <= 1; z++) {
                const b = bot.blockAt(p.offset(x, y, z));
                if (!b || isUnsafeBlock(bot, b)) return false;
            }
        }
    }
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const side = bot.blockAt(p.offset(x, 0, z));
        if (side.boundingBox === 'empty' && !isFirmGround(bot, bot.blockAt(p.offset(x, -1, z)))) return false;
    }
    return true;
}

/** Place an item at a chopSpot; the block, or null. */
async function placeNear(bot, name) {
    const pos = chopSpot(bot);
    if (!pos) {
        log(bot, 'No safe spot near you to place it on: it needs firm ground 2-3 blocks away (not leaves), no liquid or hazard beside it, and no ledge.');
        return null;
    }
    await placeBlock(bot, name, pos.x, pos.y, pos.z);
    const b = bot.blockAt(pos);
    return b && b.name !== 'air' ? b : null;
}

/** Break a placed block back by hand (#274 review 3): the axe's uses are kept for the Crafting Tools. */
async function takeBackByHand(bot, block) {
    if (bot.heldItem && typeof bot.unequip === 'function') await bot.unequip('hand');
    await bot.dig(block, true);
}

/** Walk to the items near pos (the drops of an axe click) that lie on firm ground, bounded. */
async function pickUpNear(bot, pos, L = AXE_CHOP_LIMITS) {
    const start = Date.now();
    const tried = new Set();
    while (Date.now() - start < L.pickupMs && !bot.interrupt_code) {
        const item = Object.values(bot.entities ?? {}).find(e => e?.name === 'item' && e.position && !tried.has(e.id ?? e)
            && e.position.distanceTo(pos) <= L.dropRadius && itemOnGround(bot, e));
        if (!item) break;
        tried.add(item.id ?? item);
        const p = item.position;
        await within(goToGoal(bot, new pf.goals.GoalNear(p.x, p.y, p.z, 1), { canDig: false }),
            Math.max(0, L.pickupMs - (Date.now() - start)), () => stopWalking(bot));
        await new Promise(r => setTimeout(r, 250));
    }
}

export const AXE_CHOP_OPS = { place: placeNear, pickup: pickUpNear, takeBack: takeBackByHand };

export async function pickupNearbyItems(bot) {
    /**
     * Pick up all nearby items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the items were picked up, false otherwise.
     * @example
     * await skills.pickupNearbyItems(bot);
     **/
    const distance = 8;
    // Only items on firm ground: one lying on leaves or a branch would lead the bot up into the
    // tree (G3 round 4 B). Never dig on the way (the no-dig movements were lost in goToGoal).
    const getNearestItem = bot => bot.nearestEntity(entity => entity.name === 'item' && bot.entity.position.distanceTo(entity.position) < distance
        && itemOnGround(bot, entity));
    let nearestItem = getNearestItem(bot);
    let pickedUp = 0;
    while (nearestItem) {
        await goToGoal(bot, new pf.goals.GoalFollow(nearestItem, 1), { canDig: false });
        await new Promise(resolve => setTimeout(resolve, 200));
        let prev = nearestItem;
        nearestItem = getNearestItem(bot);
        if (prev === nearestItem) {
            break;
        }
        pickedUp++;
    }
    log(bot, `Picked up ${pickedUp} items.`);
    return true;
}


/** Bounds for climbing down from a tree and for breaking leaves from the ground (G3 round 4 B). */
export const TREE_SAFETY = { descendMs: 20_000, leafWalkMs: 20_000, leafReach: 4 };

/**
 * Off a tree, safely (G3 round 4 B): walk to the nearest place on firm ground (not leaves, not a
 * branch) with fall-safe movements: no drop over 3 blocks, no broken branch, no tower, no parkour.
 * Leaves may be dug on the way down. Bounded by TREE_SAFETY.descendMs. Returns true when the bot
 * is no longer on a tree; false leaves it where it is, which is safer than a jump.
 */
export async function descendFromTree(bot, run = currentRun(bot)) {
    if (!standsOnTree(bot)) return true;
    const moves = fallSafe(new pf.Movements(bot));
    moves.allow1by1towers = false;
    moves.allowParkour = false;
    moves.scafoldingBlocks = [];
    const ground = new pf.goals.Goal();
    // Firm ground below, and not standing in a liquid or a hazard (#259).
    ground.isEnd = (node) => isFirmGround(bot, bot.blockAt(new Vec3(node.x, node.y - 1, node.z)))
        && !isUnsafeBlock(bot, bot.blockAt(new Vec3(node.x, node.y, node.z)));
    log(bot, 'You are up on a tree; climbing down to the ground (at most 3 blocks per drop).');
    bot.pathfinder.setMovements(moves);
    try { await within(bot.pathfinder.goto(ground), TREE_SAFETY.descendMs, () => stopWalking(bot)); }
    catch { /* no path: checked below */ }
    if (run.aborted) return !standsOnTree(bot);
    const down = !standsOnTree(bot);
    if (!down) log(bot, 'Found no safe way down from the tree (no drop over 3 blocks); staying put.');
    return down;
}

/**
 * Break one leaves block from the ground (G3 round 4 B): collectBlock's walk dug, towered and
 * stepped onto leaves to reach the nearest ones, often in the canopy. Here the walk stays on the
 * ground (treeSafe), the block must be within reach from there, and nothing is dug but the leaves.
 * Returns true when it was broken.
 */
export async function breakLeafFromGround(bot, block, run = currentRun(bot)) {
    const p = block.position;
    bot.pathfinder.setMovements(treeSafe(bot, new pf.Movements(bot)));
    try {
        await within(bot.pathfinder.goto(new pf.goals.GoalNear(p.x, p.y, p.z, TREE_SAFETY.leafReach)),
            TREE_SAFETY.leafWalkMs, () => stopWalking(bot));
    } catch { /* no path: checked below */ }
    if (run.aborted) return false;
    const eye = bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);
    if (standsOnTree(bot) || eye.distanceTo(p.offset(0.5, 0.5, 0.5)) > TREE_SAFETY.leafReach + 0.5) {
        log(bot, `Could not reach ${block.name} at ${p.x}, ${p.y}, ${p.z} from the ground; skipping it.`);
        return false;
    }
    await bot.dig(block, true);
    if (run.aborted) return true;
    await pickupNearbyItems(bot);
    return true;
}

/**
 * Bounds for picking up a felled tree's drops (G3 smoke C+D). On this pack a branch break fells
 * the whole tree, which falls in the chop direction and drops its logs where it lands, a few
 * seconds later. The search is around the broken branch, not the bot.
 * G3 round 5 A rerun: "no drops appeared within 6 s" three times, and later 25 logs lay around
 * (picked up by item_collecting): a tall spruce lands up to its height away, and late. So the
 * radius is a tall tree's height, the wait for drops 15 s, and the whole pickup at most 60 s;
 * pickupMs lets the last pickup reach the inventory before the gain is counted.
 */
export const FELL_LIMITS = { radius: 20, settleMs: 15_000, quietMs: 2000, walkMs: 8000, totalMs: 60_000, pickupMs: 1000 };

/**
 * After a branch break: wait (bounded) for the drops to appear and settle, then walk to each
 * item within `radius` of the branch, nearest first, each walk and the whole run bounded.
 * The caller counts the real gain from the inventory. Returns the number of walks that arrived.
 */
/** How long the falling tree may take to appear after the cut, and to be gone. */
export const TREE_FALL = { appearMs: 3000, maxMs: 15_000, stepAwayMs: 4000 };

/**
 * Fell a Dynamic Trees tree safely (G3 round 3 B: the bot was crushed by a falling tree it cut):
 * find its lowest trunk block, stand beside it on the side away from the canopy, never under it
 * or between trunks (felling.js), cut that block, step back at once, wait until the falling tree
 * entity is gone, then collect the logs around the tree. No safe place: the tree is not cut and
 * its blocks are skipped. Returns {cut, skip}: skip, the positions collectBlock must not try again.
 */
export async function fellTree(bot, block, run = currentRun(bot), refused = null) {
    const base = treeBase(bot, block.position);
    const at = (p) => `${p.x}, ${p.y}, ${p.z}`;
    // The found block too: a branch beyond the canopy radius would bring the same tree back
    // (G3 round 5 A: one tree refused 4 times in one collect, 6 in the run).
    const treeBlocks = (b) => [block.position, b, ...canopyOf(bot, b).cells.filter(p => isBranch(bot.blockAt(p)))];
    if (!base) {
        // Every branch around it, not just this block (round 5 A rerun: a felled tree's trunk the
        // bot still saw, 4 blocks, "its trunk is not in sight" 4 times in each of 2 collects).
        log(bot, `Not cutting the tree at ${at(block.position)}: its trunk is not in sight.`);
        return { cut: false, skip: [block.position, ...branchesNear(bot, block.position)] };
    }
    // A tree already refused in this collect: skipped without a word (refused: base keys).
    if (refused?.has(at(base))) return { cut: false, skip: treeBlocks(base) };
    const spots = standSpots(bot, base);
    if (spots.length === 0) {
        refused?.add(at(base));
        log(bot, `Not cutting the tree at ${at(base)}: no place beside it that is under no branch, off the side its canopy leans to and not between trunks. A falling tree can crush you.`);
        return { cut: false, skip: treeBlocks(base) };
    }
    // Walks near the tree never dig (#242 review 2): a broken branch would fell it onto the bot.
    // And never drop over 3 blocks (G3 round 4 B).
    const walk = async (goal, ms) => {
        const moves = fallSafe(new pf.Movements(bot));
        moves.canDig = false;
        bot.pathfinder.setMovements(moves);
        try { await within(bot.pathfinder.goto(goal), ms, () => stopWalking(bot)); } catch { /* checked by the caller */ }
    };
    let spot = null;
    for (const [i, s] of spots.slice(0, 3).entries()) { // the best few; the walk may not get there
        // The first approach may come from far off or round obstacles: the normal walk limit. Once
        // the bot is at the tree, another place nearby gets a step's time (#242 follow-up).
        await walk(new pf.goals.GoalBlock(s.x, s.y, s.z), i === 0 ? GO_TO_LIMITS.totalMs : GO_TO_LIMITS.stepMs);
        if (run.aborted) return { cut: false, skip: [] };
        if (bot.entity.position.floored().equals(s)) { spot = s; break; }
    }
    if (!spot) {
        refused?.add(at(base));
        log(bot, `Not cutting the tree at ${at(base)}: could not reach a safe place beside it.`);
        return { cut: false, skip: treeBlocks(base) };
    }
    const trunk = bot.blockAt(base);
    if (!isBranch(trunk)) return { cut: false, skip: [base] };
    // The items already near the tree, so its own logs count as new when they land with the fall.
    const itemsBefore = Object.values(bot.entities ?? {}).filter(e => e?.name === 'item' && e.position && e.position.distanceTo(base) <= FELL_LIMITS.radius).length;
    // Hit the side face towards the bot (#242 review 5): the tree falls away from it.
    const face = sideFace(base, spot);
    // Round 5 must show the relaxed guard is safe (#268 review 1): say when the bot cut from under
    // the tree's leaves, in the log and in what the death report reads.
    // Any leaves, vanilla too (#270 review 3: isTreeLeaves matches Dynamic Trees leaves only).
    let underLeaves = false;
    for (let y = spot.y + 2; y <= base.y + FELL_PLAN.canopyHeight && !underLeaves; y++) {
        const b = bot.blockAt(new Vec3(spot.x, y, spot.z));
        underLeaves = isTreeLeaves(b) || isLeafBlock(b);
    }
    await bot.lookAt(base.offset(0.5 + face.x * 0.5, 0.5, 0.5 + face.z * 0.5));
    // Its blocks as the bot sees them now: after the fall they are skipped for this collect, so a
    // trunk the bot still sees is never cut again (round 5 A rerun: one tree cut 4 times).
    const standing = treeBlocks(base);
    await bot.dig(trunk, true, face);
    bot.rotnLastFell = { at: Date.now(), pos: base.clone ? base.clone() : base, underLeaves }; // the death report reads it
    log(bot, `Cut the tree at ${at(base)} from ${at(spot)}, away from its canopy${underLeaves ? ' (from under its leaves)' : ''}; stepping back.`);
    // Step back at once: the tree falls a moment after the cut.
    const away = retreatFrom(base, spot);
    await walk(new pf.goals.GoalNear(away.x, away.y, away.z, 1), TREE_FALL.stepAwayMs); // a failed step back: still wait
    // Collect only after the falling tree is gone (or never showed up in time).
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const falling = () => Object.values(bot.entities ?? {}).some(e => e?.name === FALLING_TREE && e.position && e.position.distanceTo(base) <= 32);
    const start = Date.now();
    let seen = false;
    while (Date.now() - start < TREE_FALL.maxMs && !bot.interrupt_code && !run.aborted) {
        if (falling()) seen = true;
        else if (seen || Date.now() - start >= TREE_FALL.appearMs) break;
        await sleep(200);
    }
    if (run.aborted) return { cut: true, skip: standing };
    await collectFelledDrops(bot, base, {}, itemsBefore);
    return { cut: true, skip: standing };
}

async function collectFelledDrops(bot, center, limits = {}, baseline = null) {
    const L = { ...FELL_LIMITS, ...limits };
    const start = Date.now();
    const left = () => L.totalMs - (Date.now() - start);
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
    const dropsNear = () => Object.values(bot.entities ?? {})
        .filter(e => e && e.name === 'item' && e.position && e.position.distanceTo(center) <= L.radius);
    // Wait for the fall: until new drops have appeared (more than were already on the ground,
    // #222 review) and stayed the same for quietMs, at most settleMs.
    // baseline: the drops near the tree before the cut (fellTree), as the logs land when the fall ends.
    const before = baseline ?? dropsNear().length;
    let seen = before;
    let changedAt = Date.now();
    while (Date.now() - start < L.settleMs && !bot.interrupt_code) {
        await sleep(200);
        const n = dropsNear().length;
        if (n !== seen) { seen = n; changedAt = Date.now(); }
        else if (n > before && Date.now() - changedAt >= L.quietMs) break;
    }
    const where = `${Math.round(center.x)}, ${Math.round(center.y)}, ${Math.round(center.z)}`;
    if (seen <= before) {
        log(bot, `Broke the tree at ${where}: no drops appeared within ${secsText(L.settleMs)}.`);
        if (before === 0) return 0;
    }
    const tried = new Set();
    let walked = 0;
    while (!bot.interrupt_code && left() > 0) {
        const here = bot.entity.position;
        // Only drops on firm ground: one caught in another tree's leaves would lead the bot up (G3 round 4 B).
        const item = dropsNear().filter(e => !tried.has(e.id ?? e) && itemOnGround(bot, e))
            .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))[0];
        if (!item) break;
        tried.add(item.id ?? item);
        const p = item.position;
        try {
            const walk = await within(goToGoal(bot, new pf.goals.GoalNear(p.x, p.y, p.z, 1)),
                Math.min(L.walkMs, left()), () => stopWalking(bot));
            if (walk !== TIMED_OUT) walked++;
        } catch { /* a walk that failed: try the next drop */ }
        await sleep(Math.min(250, left()));
    }
    // The last pickup reaches the inventory a moment after the walk: count after it (round 5 A rerun).
    if (walked > 0) await sleep(Math.min(L.pickupMs ?? 0, Math.max(0, left())));
    const leftBehind = dropsNear().length;
    log(bot, `Felled the tree at ${where}: ${seen} drops within ${L.radius} blocks (${Math.max(0, seen - before)} new), ${leftBehind} left behind`
        + `${leftBehind && left() <= 0 ? ` (the ${secsText(L.totalMs)} limit)` : ''}.`);
    return walked;
}

export async function breakBlockAt(bot, x, y, z) {
    /**
     * Break the block at the given position. Will use the bot's equipped item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate of the block to break.
     * @param {number} y, the y coordinate of the block to break.
     * @param {number} z, the z coordinate of the block to break.
     * @returns {Promise<boolean>} true if the block was broken, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.breakBlockAt(bot, position.x, position.y - 1, position.x);
     **/
    if (x == null || y == null || z == null) throw new Error('Invalid position to break block at.');
    let block = bot.blockAt(Vec3(x, y, z));
    if (block.name !== 'air' && !names112.isLiquid(block.name)) {
        if (bot.modes.isOn('cheat')) {
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' air';
            bot.chat(msg);
            log(bot, `Used /setblock to break block at ${x}, ${y}, ${z}.`);
            return true;
        }

        if (bot.entity.position.distanceTo(block.position) > 4.5) {
            let pos = block.position;
            let movements = new pf.Movements(bot);
            movements.canPlaceOn = false;
            movements.allow1by1towers = false;
            bot.pathfinder.setMovements(movements);
            await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
        }
        if (bot.game.gameMode !== 'creative') {
            await bot.tool.equipForBlock(block);
            const itemId = bot.heldItem ? bot.heldItem.type : null
            if (!block.canHarvest(itemId)) {
                log(bot, `Don't have right tools to break ${block.name}.`);
                return false;
            }
        }
        await bot.dig(block, true);
        log(bot, `Broke ${block.name} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    else {
        log(bot, `Skipping block at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)} because it is ${block.name}.`);
        return false;
    }
    return true;
}


export async function placeBlock(bot, blockType, x, y, z, placeOn='bottom', dontCheat=false) {
    /**
     * Place the given block type at the given position. It will build off from any adjacent blocks. Will fail if there is a block in the way or nothing to build off of.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to place, which can be a block or item name.
     * @param {number} x, the x coordinate of the block to place.
     * @param {number} y, the y coordinate of the block to place.
     * @param {number} z, the z coordinate of the block to place.
     * @param {string} placeOn, the preferred side of the block to place on. Can be 'top', 'bottom', 'north', 'south', 'east', 'west', or 'side'. Defaults to bottom. Will place on first available side if not possible.
     * @param {boolean} dontCheat, overrides cheat mode to place the block normally. Defaults to false.
     * @returns {Promise<boolean>} true if the block was placed, false otherwise.
     * @example
     * let p = world.getPosition(bot);
     * await skills.placeBlock(bot, "oak_log", p.x + 2, p.y, p.x);
     * await skills.placeBlock(bot, "torch", p.x + 1, p.y, p.x, 'side');
     **/
    const target_dest = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));

    if (blockType === 'air') {
        log(bot, `Placing air (removing block) at ${target_dest}.`);
        return await breakBlockAt(bot, x, y, z);
    }

    if (bot.modes.isOn('cheat') && !dontCheat) {
        if (bot.restrict_to_inventory) {
            let block = findItem(bot, blockType);
            if (!block) {
                log(bot, `Cannot place ${blockType}, you are restricted to your current inventory.`);
                return false;
            }
        }

        // invert the facing direction
        let face = placeOn === 'north' ? 'south' : placeOn === 'south' ? 'north' : placeOn === 'east' ? 'west' : 'east';
        if (blockType.includes('torch') && placeOn !== 'bottom') {
            // 1.12 has no wall_torch block (B1b); this cheat-only branch cannot run on RotN (A2)
            if (placeOn !== 'side' && placeOn !== 'top') {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType.includes('button') || blockType === 'lever') {
            if (placeOn === 'top') {
                blockType += `[face=ceiling]`;
            }
            else if (placeOn === 'bottom') {
                blockType += `[face=floor]`;
            }
            else {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType === 'ladder' || blockType === 'repeater' || blockType === 'comparator') {
            blockType += `[facing=${face}]`;
        }
        if (blockType.includes('stairs')) {
            blockType += `[facing=${face}]`;
        }
        if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
        let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' ' + blockType;
        bot.chat(msg);
        if (blockType.includes('door'))
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y+1) + ' ' + Math.floor(z) + ' ' + blockType + '[half=upper]');
        if (blockType.includes('bed'))
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z-1) + ' ' + blockType + '[part=head]');
        log(bot, `Used /setblock to place ${blockType} at ${target_dest}.`);
        return true;
    }

    let item_name = blockType;
    if (item_name == "redstone_wire")
        item_name = "redstone";
    else if (item_name === 'water') {
        item_name = 'water_bucket';
    }
    else if (item_name === 'lava') {
        item_name = 'lava_bucket';
    }
    let block_item = findItem(bot, item_name); // "planks:0" or "planks" (#131 review)
    if (!block_item && bot.game.gameMode === 'creative' && !bot.restrict_to_inventory) {
        await bot.creative.setInventorySlot(36, mc.makeItem(item_name, 1)); // 36 is first hotbar slot
        block_item = findItem(bot, item_name);
    }
    if (!block_item) {
        log(bot, `Don't have any ${item_name} to place.`);
        return false;
    }

    const targetBlock = bot.blockAt(target_dest);
    if (blockMatcher([blockType])(targetBlock) || (targetBlock.name === names112.GRASS_BLOCK && parseName(blockType)?.name === 'dirt')) {
        log(bot, `${blockType} already at ${targetBlock.position}.`);
        return false;
    }
    const empty_blocks = names112.EMPTY_BLOCKS; // 1.12 names (B1); "grass" is the solid grass block in 1.12
    if (!empty_blocks.includes(targetBlock.name)) {
        log(bot, `${targetBlock.name} in the way at ${targetBlock.position}.`);
        const removed = await breakBlockAt(bot, x, y, z);
        if (!removed) {
            log(bot, `Cannot place ${blockType} at ${targetBlock.position}: block in the way.`);
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 200)); // wait for block to break
    }
    // get the buildoffblock and facevec based on whichever adjacent block is not empty
    let buildOffBlock = null;
    let faceVec = null;
    const dir_map = {
        'top': Vec3(0, 1, 0),
        'bottom': Vec3(0, -1, 0),
        'north': Vec3(0, 0, -1),
        'south': Vec3(0, 0, 1),
        'east': Vec3(1, 0, 0),
        'west': Vec3(-1, 0, 0),
    }
    let dirs = [];
    if (placeOn === 'side') {
        dirs.push(dir_map['north'], dir_map['south'], dir_map['east'], dir_map['west']);
    }
    else if (dir_map[placeOn] !== undefined) {
        dirs.push(dir_map[placeOn]);
    }
    else {
        dirs.push(dir_map['bottom']);
        log(bot, `Unknown placeOn value "${placeOn}". Defaulting to bottom.`);
    }
    dirs.push(...Object.values(dir_map).filter(d => !dirs.includes(d)));

    for (let d of dirs) {
        const block = bot.blockAt(target_dest.plus(d));
        if (!empty_blocks.includes(block.name)) {
            buildOffBlock = block;
            faceVec = new Vec3(-d.x, -d.y, -d.z); // invert
            break;
        }
    }
    if (!buildOffBlock) {
        log(bot, `Cannot place ${blockType} at ${targetBlock.position}: nothing to place on.`);
        return false;
    }

    const pos = bot.entity.position;
    const pos_above = pos.plus(Vec3(0,1,0));
    const dont_move_for = ['torch', 'redstone_torch', 'redstone', 'lever', 'button', 'rail', 'detector_rail', 
        'powered_rail', 'activator_rail', 'tripwire_hook', 'tripwire', 'water_bucket', 'string'];
    if (!dont_move_for.includes(item_name) && (pos.distanceTo(targetBlock.position) < 1.1 || pos_above.distanceTo(targetBlock.position) < 1.1)) {
        // too close
        let goal = new pf.goals.GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, 2);
        let inverted_goal = new pf.goals.GoalInvert(goal);
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await boundedGoto(bot, inverted_goal, GO_TO_LIMITS.stepMs);
    }
    if (bot.entity.position.distanceTo(targetBlock.position) > 4.5) {
        // too far
        let pos = targetBlock.position;
        let movements = new pf.Movements(bot);
        bot.pathfinder.setMovements(movements);
        await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }

    // will throw error if an entity is in the way, and sometimes even if the block was placed
    try {
        if (item_name.includes('bucket')) {
            await useToolOnBlock(bot, item_name, buildOffBlock);
        }
        else {
            await bot.equip(block_item, 'hand');
            await bot.lookAt(buildOffBlock.position.offset(0.5, 0.5, 0.5));
            await bot.placeBlock(buildOffBlock, faceVec);
            log(bot, `Placed ${blockType} at ${target_dest}.`);
            await new Promise(resolve => setTimeout(resolve, 200));
            return true;
        }
    } catch (err) {
        log(bot, `Failed to place ${blockType} at ${target_dest}.`);
        return false;
    }
}

export async function equip(bot, itemName) {
    /**
     * Equip the given item to the proper body part, like tools or armor.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to equip.
     * @returns {Promise<boolean>} true if the item was equipped, false otherwise.
     * @example
     * await skills.equip(bot, "iron_pickaxe");
     **/
    if (itemName === 'hand') {
        await bot.unequip('hand');
        log(bot, `Unequipped hand.`);
        return true;
    }
    let item = bot.inventory.slots.find(slot => slot && itemMatches(slot, itemName));
    if (!item) {
        if (bot.game.gameMode === "creative") {
            await bot.creative.setInventorySlot(36, mc.makeItem(itemName, 1));
            item = findItem(bot, itemName);
        }
        else {
            log(bot, `You do not have any ${itemName} to equip.`);
            return false;
        }
    }
    if (itemName.includes('leggings')) {
        await bot.equip(item, 'legs');
    }
    else if (itemName.includes('boots')) {
        await bot.equip(item, 'feet');
    }
    else if (itemName.includes('helmet')) {
        await bot.equip(item, 'head');
    }
    else if (itemName.includes('chestplate') || itemName.includes('elytra')) {
        await bot.equip(item, 'torso');
    }
    else if (itemName.includes('shield')) {
        await bot.equip(item, 'off-hand');
    }
    else {
        await bot.equip(item, 'hand');
    }
    log(bot, `Equipped ${itemName}.`);
    return true;
}

export async function discard(bot, itemName, num=-1) {
    /**
     * Discard the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to discard.
     * @param {number} num, the number of items to discard. Defaults to -1, which discards all items.
     * @returns {Promise<boolean>} true if the item was discarded, false otherwise.
     * @example
     * await skills.discard(bot, "oak_log");
     **/
    let discarded = 0;
    while (true) {
        let item = findItem(bot, itemName);
        if (!item) {
            break;
        }
        let to_discard = num === -1 ? item.count : Math.min(num - discarded, item.count);
        await bot.toss(item.type, variantMeta(itemName), to_discard);
        discarded += to_discard;
        if (num !== -1 && discarded >= num) {
            break;
        }
    }
    if (discarded === 0) {
        log(bot, `You do not have any ${itemName} to discard.`);
        return false;
    }
    log(bot, `Discarded ${discarded} ${itemName}.`);
    return true;
}

export async function putInChest(bot, itemName, num=-1) {
    /**
     * Put the given item in the nearest chest.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to put in the chest.
     * @param {number} num, the number of items to put in the chest. Defaults to -1, which puts all items.
     * @returns {Promise<boolean>} true if the item was put in the chest, false otherwise.
     * @example
     * await skills.putInChest(bot, "oak_log");
     **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    let item = findItem(bot, itemName);
    if (!item) {
        log(bot, `You do not have any ${itemName} to put in the chest.`);
        return false;
    }
    let to_put = num === -1 ? item.count : Math.min(num, item.count);
    const run = currentRun(bot);
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    if (run.aborted) return false;
    const chestContainer = await bot.openContainer(chest);
    if (run.aborted) { closeQuietly(bot, chestContainer); return false; }
    await chestContainer.deposit(item.type, variantMeta(itemName), to_put);
    await chestContainer.close();
    log(bot, `Successfully put ${to_put} ${itemName} in the chest.`);
    return true;
}

export async function takeFromChest(bot, itemName, num=-1) {
    /**
     * Take the given item from the nearest chest, potentially from multiple slots.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to take from the chest.
     * @param {number} num, the number of items to take from the chest. Defaults to -1, which takes all items.
     * @returns {Promise<boolean>} true if the item was taken from the chest, false otherwise.
     * @example
     * await skills.takeFromChest(bot, "oak_log");
     * **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    const run = currentRun(bot);
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    if (run.aborted) return false;
    const chestContainer = await bot.openContainer(chest);
    if (run.aborted) { closeQuietly(bot, chestContainer); return false; }
    
    // Find all matching items in the chest
    let matchingItems = chestContainer.containerItems().filter(item => itemMatches(item, itemName));
    if (matchingItems.length === 0) {
        log(bot, `Could not find any ${itemName} in the chest.`);
        await chestContainer.close();
        return false;
    }
    
    let totalAvailable = matchingItems.reduce((sum, item) => sum + item.count, 0);
    let remaining = num === -1 ? totalAvailable : Math.min(num, totalAvailable);
    let totalTaken = 0;
    
    // Take items from each slot until we've taken enough or run out
    for (const item of matchingItems) {
        if (remaining <= 0 || run.aborted) break;
        
        let toTakeFromSlot = Math.min(remaining, item.count);
        await chestContainer.withdraw(item.type, variantMeta(itemName), toTakeFromSlot);
        
        totalTaken += toTakeFromSlot;
        remaining -= toTakeFromSlot;
    }
    
    await chestContainer.close();
    log(bot, `Successfully took ${totalTaken} ${itemName} from the chest.`);
    return totalTaken > 0;
}

export async function viewChest(bot) {
    /**
     * View the contents of the nearest chest.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the chest was viewed, false otherwise.
     * @example
     * await skills.viewChest(bot);
     * **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    const run = currentRun(bot);
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    if (run.aborted) return false;
    const chestContainer = await bot.openContainer(chest);
    if (run.aborted) { closeQuietly(bot, chestContainer); return false; }
    let items = chestContainer.containerItems();
    if (items.length === 0) {
        log(bot, `The chest is empty.`);
    }
    else {
        log(bot, `The chest contains:`);
        for (let item of items) {
            log(bot, `${item.count} ${item.name}`);
        }
    }
    await chestContainer.close();
    return true;
}

export async function consume(bot, itemName="") {
    /**
     * Eat/drink the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item to eat/drink.
     * @returns {Promise<boolean>} true if the item was eaten, false otherwise.
     * @example
     * await skills.eat(bot, "apple");
     **/
    let item, name;
    if (itemName) {
        item = findItem(bot, itemName);
        name = itemName;
    }
    if (!item) {
        log(bot, `You do not have any ${name} to eat.`);
        return false;
    }
    await bot.equip(item, 'hand');
    await bot.consume();
    log(bot, `Consumed ${item.name}.`);
    return true;
}


export async function giveToPlayer(bot, itemType, username, num=1) {
    /**
     * Give one of the specified item to the specified player
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemType, the name of the item to give.
     * @param {string} username, the username of the player to give the item to.
     * @param {number} num, the number of items to give. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was given, false otherwise.
     * @example
     * await skills.giveToPlayer(bot, "oak_log", "player1");
     **/
    if (bot.username === username) {
        log(bot, `You cannot give items to yourself.`);
        return false;
    }
    let player = bot.players[username].entity
    if (!player) {
        log(bot, `Could not find ${username}.`);
        return false;
    }
    await goToPlayer(bot, username, 3);
    // if we are 2 below the player
    log(bot, bot.entity.position.y, player.position.y);
    if (bot.entity.position.y < player.position.y - 1) {
        await goToPlayer(bot, username, 1);
    }
    // if we are too close, make some distance
    if (bot.entity.position.distanceTo(player.position) < 2) {
        let too_close = true;
        let start_moving_away = Date.now();
        await moveAwayFromEntity(bot, player, 2);
        while (too_close && !bot.interrupt_code) {
            await new Promise(resolve => setTimeout(resolve, 500));
            too_close = bot.entity.position.distanceTo(player.position) < 5;
            if (too_close) {
                await moveAwayFromEntity(bot, player, 5);
            }
            if (Date.now() - start_moving_away > 3000) {
                break;
            }
        }
        if (too_close) {
            log(bot, `Failed to give ${itemType} to ${username}, too close.`);
            return false;
        }
    }

    await bot.lookAt(player.position);
    if (await discard(bot, itemType, num)) {
        let given = false;
        bot.once('playerCollect', (collector, collected) => {
            console.log(collected.name);
            if (collector.username === username) {
                log(bot, `${username} received ${itemType}.`);
                given = true;
            }
        });
        let start = Date.now();
        while (!given && !bot.interrupt_code) {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (given) {
                return true;
            }
            if (Date.now() - start > 3000) {
                break;
            }
        }
    }
    log(bot, `Failed to give ${itemType} to ${username}, it was never received.`);
    return false;
}

export async function goToGoal(bot, goal, { canDig = true } = {}) {
    /**
     * Navigate to the given goal. Use doors and attempt minimally destructive movements.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {pf.goals.Goal} goal, the goal to navigate to.
     * @param {{canDig?: boolean}} options, canDig false: never dig (no destructive fallback).
     **/

    // Every walk is fall-safe (G3 round 4 B, fall_safety.js): no drop over 3 blocks, and never a
    // broken Dynamic Trees branch, which fells the tree (also the stuck reflex's walk away).
    const nonDestructiveMovements = fallSafe(new pf.Movements(bot));
    const dontBreakBlocks = ['glass', 'glass_pane'];
    for (let block of dontBreakBlocks) {
        nonDestructiveMovements.blocksCantBreak.add(mc.getBlockId(block));
    }
    nonDestructiveMovements.placeCost = 2;
    nonDestructiveMovements.digCost = 10;
    // A caller that set no-dig movements (pickupNearbyItems) used to get these replaced by digging
    // ones here; a drop resting on leaves then led the bot up into the tree (G3 round 4 B).
    if (!canDig) nonDestructiveMovements.canDig = false;

    const destructiveMovements = canDig ? fallSafe(new pf.Movements(bot)) : nonDestructiveMovements;

    let final_movements = destructiveMovements;

    const pathfind_timeout = 1000;
    if (await bot.pathfinder.getPathTo(nonDestructiveMovements, goal, pathfind_timeout).status === 'success') {
        final_movements = nonDestructiveMovements;
        log(bot, `Found non-destructive path.`);
    }
    else if (await bot.pathfinder.getPathTo(destructiveMovements, goal, pathfind_timeout).status === 'success') {
        log(bot, `Found destructive path.`);
    }
    else {
        log(bot, `Path not found, but attempting to navigate anyway using destructive movements.`);
    }

    const doorCheckInterval = startDoorInterval(bot);

    bot.pathfinder.setMovements(final_movements);
    try {
        // Bounded (G3 smoke C+D: !searchForBlock("log", 64) never returned): pathfinder.goto has
        // no time limit and can keep going on partial paths. At the limit the walk is stopped
        // and this throws, as a stopped walk does; goToPosition reports it.
        const limitMs = GO_TO_LIMITS.totalMs;
        const walked = await within(bot.pathfinder.goto(goal), limitMs, () => stopWalking(bot));
        clearInterval(doorCheckInterval);
        if (walked === TIMED_OUT) throw new Error(`time limit of ${secsText(limitMs)} reached`);
        return true;
    } catch (err) {
        clearInterval(doorCheckInterval);
        // A stopped walk is an interrupt, not an error (G3 round 2: the flee threw "PathStopped"
        // twice and the mode reported "Code threw exception"): something stopped the pathfinder
        // (a new action, a death, a reflex). Returns false; the caller decides what that means.
        if (err?.name === 'PathStopped') {
            log(bot, 'Walk stopped (interrupted).');
            return false;
        }
        // we need to catch so we can clean up the door check interval, then rethrow the error
        throw err;
    }
}

let _doorInterval = null;
function startDoorInterval(bot) {
    /**
     * Start helper interval that opens nearby doors if the bot is stuck.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {number} the interval id.
     **/
    if (_doorInterval) {
        clearInterval(_doorInterval);
    }
    let prev_pos = bot.entity.position.clone();
    let prev_check = Date.now();
    let stuck_time = 0;


    const doorCheckInterval = setInterval(() => {
        const now = Date.now();
        if (bot.entity.position.distanceTo(prev_pos) >= 0.1) {
            stuck_time = 0;
        } else {
            stuck_time += now - prev_check;
        }
        
        if (stuck_time > 1200) {
            // shuffle positions so we're not always opening the same door
            const positions = [
                bot.entity.position.clone(),
                bot.entity.position.offset(0, 0, 1),
                bot.entity.position.offset(0, 0, -1), 
                bot.entity.position.offset(1, 0, 0),
                bot.entity.position.offset(-1, 0, 0),
            ]
            let elevated_positions = positions.map(position => position.offset(0, 1, 0));
            positions.push(...elevated_positions);
            positions.push(bot.entity.position.offset(0, 2, 0)); // above head
            positions.push(bot.entity.position.offset(0, -1, 0)); // below feet
            
            let currentIndex = positions.length;
            while (currentIndex != 0) {
                let randomIndex = Math.floor(Math.random() * currentIndex);
                currentIndex--;
                [positions[currentIndex], positions[randomIndex]] = [
                positions[randomIndex], positions[currentIndex]];
            }
            
            for (let position of positions) {
                let block = bot.blockAt(position);
                if (block && block.name &&
                    !block.name.includes('iron') &&
                    (block.name.includes('door') ||
                     block.name.includes('fence_gate') ||
                     block.name.includes('trapdoor'))) 
                {
                    bot.activateBlock(block);
                    break;
                }
            }
            stuck_time = 0;
        }
        prev_pos = bot.entity.position.clone();
        prev_check = now;
    }, 200);
    _doorInterval = doorCheckInterval;
    return doorCheckInterval;
}

export async function goToPosition(bot, x, y, z, min_distance=2) {
    /**
     * Navigate to the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to navigate to. If null, the bot's current x coordinate will be used.
     * @param {number} y, the y coordinate to navigate to. If null, the bot's current y coordinate will be used.
     * @param {number} z, the z coordinate to navigate to. If null, the bot's current z coordinate will be used.
     * @param {number} distance, the distance to keep from the position. Defaults to 2.
     * @returns {Promise<boolean>} true if the position was reached, false otherwise.
     * @example
     * let position = world.world.getNearestBlock(bot, "oak_log", 64).position;
     * await skills.goToPosition(bot, position.x, position.y, position.x + 20);
     **/
    const run = currentRun(bot); // checked after the walk (#225 review)
    if (x == null || y == null || z == null) {
        log(bot, `Missing coordinates, given x:${x} y:${y} z:${z}`);
        return false;
    }
    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
        log(bot, `Teleported to ${x}, ${y}, ${z}.`);
        return true;
    }
    
    const checkDigProgress = () => {
        if (bot.targetDigBlock) {
            const targetBlock = bot.targetDigBlock;
            const itemId = bot.heldItem ? bot.heldItem.type : null;
            if (!targetBlock.canHarvest(itemId)) {
                log(bot, `Pathfinding stopped: Cannot break ${targetBlock.name} with current tools.`);
                bot.pathfinder.stop();
                bot.stopDigging();
            }
        }
    };
    
    const progressInterval = setInterval(checkDigProgress, 1000);
    
    try {
        await goToGoal(bot, new pf.goals.GoalNear(x, y, z, min_distance));
        clearInterval(progressInterval);
        if (run.aborted) return false; // its command already reported failure
        const distance = bot.entity.position.distanceTo(new Vec3(x, y, z));
        if (distance <= min_distance+1) {
            log(bot, `You have reached at ${x}, ${y}, ${z}.`);
            return true;
        }
        else {
            log(bot, `Unable to reach ${x}, ${y}, ${z}, you are ${Math.round(distance)} blocks away.`);
            return false;
        }
    } catch (err) {
        log(bot, `Pathfinding stopped: ${err.message}.`);
        clearInterval(progressInterval);
        return false;
    }
}

/** standOnBlock: one more walk when the first ends within this many blocks (off by one). */
export const STAND_ON_RETRY_WITHIN = 2;

/**
 * Stand on top of the block at x, y, z (the block's own coordinates) and check it (G3 round 5 C,
 * the lead: the bot ended beside the gold block, said it stood on it and called !taskDone). It walks
 * to x, y+1, z with range 0, then checks that the block under its feet is that block (and named
 * blockName, when given). Off by one: one more walk. Returns true only when the check passed.
 * @param {MinecraftBot} bot
 * @param {number} x, y, z the block to stand on.
 * @param {string} blockName the block it must be, or null for any solid block.
 * @returns {Promise<boolean>}
 * @example
 * await skills.standOnBlock(bot, -42, 68, -50, "gold_block");
 */
export async function standOnBlock(bot, x, y, z, blockName = null) {
    const run = currentRun(bot);
    const target = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), name: blockName || null };
    const what = describeTarget(target);
    const block = bot.blockAt(new Vec3(target.x, target.y, target.z));
    if (block && target.name && !sameBlock(block.name, target.name)) {
        log(bot, `The block at ${target.x} ${target.y} ${target.z} is ${block.name}, not ${target.name}; not standing on it.`);
        return false;
    }
    if (block && block.boundingBox !== 'block') {
        log(bot, `There is nothing to stand on at ${target.x} ${target.y} ${target.z}: the block there is ${block.name}.`);
        return false;
    }
    let check = null;
    for (let walk = 1; walk <= 2; walk++) {
        await goToPosition(bot, target.x, target.y + 1, target.z, 0);
        if (run.aborted) return false; // its command already reported failure
        check = standCheck(bot, target);
        if (check.ok) {
            log(bot, `You are standing on ${what} (checked: it is the block under your feet).`);
            return true;
        }
        const p = bot.entity.position;
        const off = Math.hypot(p.x - (target.x + 0.5), p.z - (target.z + 0.5));
        if (walk === 1 && off <= STAND_ON_RETRY_WITHIN) log(bot, `Not on it yet: ${check.why}. Trying once more.`);
        else break;
    }
    log(bot, `You are NOT standing on ${what}: ${check.why}. Do not say you are on it, and do not report a task done for it.`);
    return false;
}

/** A search for wood: a log or a tree's branch (or what a felled tree gives, by rotn-data). */
function isWoodSearch(blockType) {
    const name = parseName(blockType)?.name ?? blockType;
    return isBranch({ name }) || oreMemberNames('logWood').some(n => (parseName(n)?.name ?? n) === name)
        || worldSources(blockType).some(s => s.id === 'fell-tree');
}

export async function goToNearestBlock(bot, blockType,  min_distance=2, range=64) {
    /**
     * Navigate to the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to navigate to.
     * @param {number} min_distance, the distance to keep from the block. Defaults to 2.
     * @param {number} range, the range to look for the block. Defaults to 64.
     * @returns {Promise<boolean>} true if the block was reached, false otherwise.
     * @example
     * await skills.goToNearestBlock(bot, "oak_log", 64, 2);
     * **/
    const MAX_RANGE = 512;
    if (range > MAX_RANGE) {
        log(bot, `Maximum search range capped at ${MAX_RANGE}. `);
        range = MAX_RANGE;
    }
    let block = null;
    if (blockType === 'water' || blockType === 'lava') {
        let blocks = world.getNearestBlocksWhere(bot, block => block.name === blockType && block.metadata === 0, range, 1);
        if (blocks.length === 0) {
            log(bot, `Could not find any source ${blockType} in ${range} blocks, looking for uncollectable flowing instead...`);
            blocks = world.getNearestBlocksWhere(bot, block => block.name === blockType, range, 1);
        }
        block = blocks[0];
    }
    else if (isWoodSearch(blockType)) {
        // Wood: a tree on the surface, never a log underground (G3 round 5 A rerun: a log at
        // y 45 under the surface, and the walk ran out its 180 s). On this pack trees are
        // Dynamic Trees branches, so those are searched too (rotn-data fell-tree).
        const names = [blockType, ...worldSources(blockType).filter(s => s.id === 'fell-tree').flatMap(s => s.blocks)];
        block = world.getNearestBlocksWhere(bot, blockMatcher(names), range, 64)
            .find(b => b && !world.isUnderground(bot, b.position)) ?? null;
        if (!block) {
            log(bot, `Could not find any ${blockType} on the surface in ${range} blocks (logs underground are left alone).`);
            return false;
        }
    }
    else {
        block = world.getNearestBlock(bot, blockType, range);
    }
    if (!block) {
        log(bot, `Could not find any ${blockType} in ${range} blocks.`);
        return false;
    }
    log(bot, `Found ${blockType} at ${block.position}. Navigating...`);
    return await goToPosition(bot, block.position.x, block.position.y, block.position.z, min_distance);
}

export async function goToNearestEntity(bot, entityType, min_distance=2, range=64) {
    /**
     * Navigate to the nearest entity of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} entityType, the type of entity to navigate to.
     * @param {number} min_distance, the distance to keep from the entity. Defaults to 2.
     * @param {number} range, the range to look for the entity. Defaults to 64.
     * @returns {Promise<boolean>} true if the entity was reached, false otherwise.
     **/
    let entity = world.getNearestEntityWhere(bot, entity => entity.name === entityType, range);
    if (!entity) {
        log(bot, `Could not find any ${entityType} in ${range} blocks.`);
        return false;
    }
    let distance = bot.entity.position.distanceTo(entity.position);
    log(bot, `Found ${entityType} ${distance} blocks away.`);
    return await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z, min_distance);
}

export async function goToPlayer(bot, username, distance=3) {
    /**
     * Navigate to the given player.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to navigate to.
     * @param {number} distance, the goal distance to the player.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.goToPlayer(bot, "player");
     **/
    if (bot.username === username) {
        log(bot, `You are already at ${username}.`);
        return true;
    }
    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + username);
        log(bot, `Teleported to ${username}.`);
        return true;
    }

    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    let player = bot.players[username].entity
    if (!player) {
        log(bot, `Could not find ${username}.`);
        return false;
    }

    distance = Math.max(distance, 0.5);
    const goal = new pf.goals.GoalFollow(player, distance);

    await goToGoal(bot, goal, true);

    log(bot, `You have reached ${username}.`);
}


export async function followPlayer(bot, username, distance=4) {
    /**
     * Follow the given player endlessly. Will not return until the code is manually stopped.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to follow.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.followPlayer(bot, "player");
     **/
    let player = bot.players[username].entity
    if (!player)
        return false;

    const move = new pf.Movements(bot);
    move.digCost = 10;
    bot.pathfinder.setMovements(move);
    let doorCheckInterval = startDoorInterval(bot);

    bot.pathfinder.setGoal(new pf.goals.GoalFollow(player, distance), true);
    log(bot, `You are now actively following player ${username}.`);


    while (!bot.interrupt_code) {
        await new Promise(resolve => setTimeout(resolve, 500));
        // in cheat mode, if the distance is too far, teleport to the player
        const distance_from_player = bot.entity.position.distanceTo(player.position);

        const teleport_distance = 100;
        const ignore_modes_distance = 30; 
        const nearby_distance = distance + 2;

        if (distance_from_player > teleport_distance && bot.modes.isOn('cheat')) {
            // teleport with cheat mode
            await goToPlayer(bot, username);
        }
        else if (distance_from_player > ignore_modes_distance) {
            // these modes slow down the bot, and we want to catch up
            bot.modes.pause('item_collecting');
            bot.modes.pause('hunting');
            bot.modes.pause('torch_placing');
        }
        else if (distance_from_player <= ignore_modes_distance) {
            bot.modes.unpause('item_collecting');
            bot.modes.unpause('hunting');
            bot.modes.unpause('torch_placing');
        }

        if (distance_from_player <= nearby_distance) {
            clearInterval(doorCheckInterval);
            doorCheckInterval = null;
            bot.modes.pause('unstuck');
            bot.modes.pause('elbow_room');
        }
        else {
            if (!doorCheckInterval) {
                doorCheckInterval = startDoorInterval(bot);
            }
            bot.modes.unpause('unstuck');
            bot.modes.unpause('elbow_room');
        }
    }
    clearInterval(doorCheckInterval);
    return true;
}


export async function moveAway(bot, distance) {
    /**
     * Move away from current position in any direction.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.moveAway(bot, 8);
     **/
    // A copy: a server position packet (a respawn) changes bot.entity.position in place, and the
    // log line then named the wrong start (G3 round 4 B: "Moved away from" the respawn point).
    const pos = bot.entity.position.clone();
    let goal = new pf.goals.GoalNear(pos.x, pos.y, pos.z, distance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    bot.pathfinder.setMovements(fallSafe(new pf.Movements(bot))); // goToGoal's are fall-safe too (G3 round 4 B)

    if (bot.modes.isOn('cheat')) {
        const move = new pf.Movements(bot);
        const path = await bot.pathfinder.getPathTo(move, inverted_goal, 10000);
        let last_move = path.path[path.path.length-1];
        if (last_move) {
            let x = Math.floor(last_move.x);
            let y = Math.floor(last_move.y);
            let z = Math.floor(last_move.z);
            bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
            return true;
        }
    }

    if (!await goToGoal(bot, inverted_goal)) return false; // stopped: an interrupt (round 2)
    let new_pos = bot.entity.position;
    log(bot, `Moved away from ${pos.floored()} to ${new_pos.floored()}.`);
    return true;
}

export async function moveAwayFromEntity(bot, entity, distance=16) {
    /**
     * Move away from the given entity.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} entity, the entity to move away from.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     **/
    let goal = new pf.goals.GoalFollow(entity, distance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    bot.pathfinder.setMovements(new pf.Movements(bot));
    // An entity that follows keeps an inverted goal from ever ending: bounded (G3 review of #221).
    return await boundedGoto(bot, inverted_goal, GO_TO_LIMITS.fleeMs) === true;
}

export async function avoidEnemies(bot, distance=16, isEnemy=(entity) => mc.isHostile(entity), canHit=() => true) {
    /**
     * Move a given distance away from all nearby enemy mobs.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @param {function} isEnemy, which mobs to move away from (skills-rotn D2c). Defaults to mc.isHostile.
     * @param {function} canHit, whether a cornered bot may hit that mob (never a creeper or a dragon).
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.avoidEnemies(bot, 8);
     **/
    bot.modes.pause('self_preservation'); // prevents damage-on-low-health from interrupting the bot
    let enemy = world.getNearestEntityWhere(bot, isEnemy, distance);
    while (enemy) {
        const follow = new pf.goals.GoalFollow(enemy, distance+1); // move a little further away
        const inverted_goal = new pf.goals.GoalInvert(follow);
        bot.pathfinder.setMovements(new pf.Movements(bot));
        bot.pathfinder.setGoal(inverted_goal, true);
        await new Promise(resolve => setTimeout(resolve, 500));
        enemy = world.getNearestEntityWhere(bot, isEnemy, distance);
        if (bot.interrupt_code) {
            break;
        }
        if (enemy && bot.entity.position.distanceTo(enemy.position) < 3 && canHit(enemy)) {
            await attackEntity(bot, enemy, false);
        }
    }
    bot.pathfinder.stop();
    log(bot, `Moved ${distance} away from enemies.`);
    return true;
}

export async function stay(bot, seconds=30) {
    /**
     * Stay in the current position until interrupted. Disables all modes.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} seconds, the number of seconds to stay. Defaults to 30. -1 for indefinite.
     * @returns {Promise<boolean>} true if the bot stayed, false otherwise.
     * @example
     * await skills.stay(bot);
     **/
    bot.modes.pause('self_preservation');
    bot.modes.pause('unstuck');
    bot.modes.pause('cowardice');
    bot.modes.pause('self_defense');
    bot.modes.pause('hunting');
    bot.modes.pause('torch_placing');
    bot.modes.pause('item_collecting');
    let start = Date.now();
    while (!bot.interrupt_code && (seconds === -1 || Date.now() - start < seconds*1000)) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `Stayed for ${(Date.now() - start)/1000} seconds.`);
    return true;
}

export async function useDoor(bot, door_pos=null) {
    /**
     * Use the door at the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Vec3} door_pos, the position of the door to use. If null, the nearest door will be used.
     * @returns {Promise<boolean>} true if the door was used, false otherwise.
     * @example
     * let door = world.getNearestBlock(bot, "oak_door", 16).position;
     * await skills.useDoor(bot, door);
     **/
    if (!door_pos) {
        // 1.12 door names (B1); upstream read .position of a null result when a type was absent.
        for (let door_type of names112.WOODEN_DOORS) {
            const door = world.getNearestBlock(bot, door_type, 16);
            if (door) {
                door_pos = door.position;
                break;
            }
        }
    } else {
        door_pos = Vec3(door_pos.x, door_pos.y, door_pos.z);
    }
    if (!door_pos) {
        log(bot, `Could not find a door to use.`);
        return false;
    }

    bot.pathfinder.setGoal(new pf.goals.GoalNear(door_pos.x, door_pos.y, door_pos.z, 1));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    while (bot.pathfinder.isMoving()) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    
    let door_block = bot.blockAt(door_pos);
    await bot.lookAt(door_pos);
    if (!names112.isDoorOpen(bot, door_block))
        await bot.activateBlock(door_block);
    
    bot.setControlState("forward", true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    bot.setControlState("forward", false);
    await bot.activateBlock(door_block);

    log(bot, `Used door at ${door_pos}.`);
    return true;
}

export async function goToBed(bot) {
    /**
     * Sleep in the nearest bed.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the bed was found, false otherwise.
     * @example
     * await skills.goToBed(bot);
     **/
    const beds = bot.findBlocks({
        matching: (block) => {
            return block.name?.includes('bed');
        },
        maxDistance: 32,
        count: 1
    });
    if (beds.length === 0) {
        log(bot, `Could not find a bed to sleep in.`);
        return false;
    }
    let loc = beds[0];
    await goToPosition(bot, loc.x, loc.y, loc.z);
    const bed = bot.blockAt(loc);
    await bot.sleep(bed);
    log(bot, `You are in bed.`);
    bot.modes.pause('unstuck');
    while (bot.isSleeping) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `You have woken up.`);
    return true;
}

export async function tillAndSow(bot, x, y, z, seedType=null) {
    /**
     * Till the ground at the given position and plant the given seed type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to till.
     * @param {number} y, the y coordinate to till.
     * @param {number} z, the z coordinate to till.
     * @param {string} plantType, the type of plant to plant. Defaults to none, which will only till the ground.
     * @returns {Promise<boolean>} true if the ground was tilled, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.tillAndSow(bot, position.x, position.y - 1, position.x, "wheat");
     **/
    let pos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    let block = bot.blockAt(pos);
    log(bot, `Planting ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);

    if (bot.modes.isOn('cheat')) {
        let to_remove = ['_seed', '_seeds'];
        for (let remove of to_remove) {
            if (seedType.endsWith(remove)) {
                seedType = seedType.replace(remove, '');
            }
        }
        placeBlock(bot, 'farmland', x, y, z);
        placeBlock(bot, seedType, x, y+1, z);
        return true;
    }

    if (block.name !== names112.GRASS_BLOCK && block.name !== 'dirt' && block.name !== 'farmland') {
        log(bot, `Cannot till ${block.name}, must be grass or dirt.`);
        return false;
    }
    let above = bot.blockAt(new Vec3(x, y+1, z));
    if (above.name !== 'air') {
        if (block.name === 'farmland') {
            log(bot, `Land is already farmed with ${above.name}.`);
            return true;
        }
        let broken = await breakBlockAt(bot, x, y+1, z);
        if (!broken) {
            log(bot, `Cannot cannot break above block to till.`);
            return false;
        }
    }
    // if distance is too far, move to the block
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    if (block.name !== 'farmland') {
        let hoe = bot.inventory.items().find(item => item.name.includes('hoe'));
        let to_equip = hoe?.name || 'diamond_hoe';
        if (!await equip(bot, to_equip)) {
            log(bot, `Cannot till, no hoes.`);
            return false;
        }
        await bot.activateBlock(block);
        log(bot, `Tilled block x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    
    if (seedType) {
        if (seedType.endsWith('seed') && !seedType.endsWith('seeds'))
            seedType += 's'; // fixes common mistake
        let equipped_seeds = await equip(bot, seedType);
        if (!equipped_seeds) {
            log(bot, `No ${seedType} to plant.`);
            return false;
        }

        await bot.activateBlock(block);
        log(bot, `Planted ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    return true;
}

export async function activateNearestBlock(bot, type) {
    /**
     * Activate the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} type, the type of block to activate.
     * @returns {Promise<boolean>} true if the block was activated, false otherwise.
     * @example
     * await skills.activateNearestBlock(bot, "lever");
     * **/
    let block = world.getNearestBlock(bot, type, 16);
    if (!block) {
        log(bot, `Could not find any ${type} to activate.`);
        return false;
    }
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    await bot.activateBlock(block);
    log(bot, `Activated ${type} at x:${block.position.x.toFixed(1)}, y:${block.position.y.toFixed(1)}, z:${block.position.z.toFixed(1)}.`);
    return true;
}

/**
 * Helper function to find and navigate to a villager for trading
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager
 * @returns {Promise<Object|null>} the villager entity if found and reachable, null otherwise
 */
async function findAndGoToVillager(bot, id) {
    id = id+"";
    const entity = bot.entities[id];
    
    if (!entity) {
        log(bot, `Cannot find villager with id ${id}`);
        let entities = world.getNearbyEntities(bot, 16);
        let villager_list = "Available villagers:\n";
        for (let entity of entities) {
            if (entity.name === 'villager') {
                if (mc.isBaby(entity)) {
                    villager_list += `${entity.id}: baby villager\n`;
                } else {
                    const profession = world.getVillagerProfession(entity);
                    villager_list += `${entity.id}: ${profession}\n`;
                }
            }
        }
        if (villager_list === "Available villagers:\n") {
            log(bot, "No villagers found nearby.");
            return null;
        }
        log(bot, villager_list);
        return null;
    }
    
    if (entity.entityType !== bot.registry.entitiesByName.villager.id) {
        log(bot, 'Entity is not a villager');
        return null;
    }
    
    if (mc.isBaby(entity)) {
        log(bot, 'This is either a baby villager or a villager with no job - neither can trade');
        return null;
    }
    
    const distance = bot.entity.position.distanceTo(entity.position);
    if (distance > 4) {
        log(bot, `Villager is ${distance.toFixed(1)} blocks away, moving closer...`);
        try {
            bot.modes.pause('unstuck');
            const goal = new pf.goals.GoalFollow(entity, 2);
            await goToGoal(bot, goal);
            
            
            log(bot, 'Successfully reached villager');
        } catch (err) {
            log(bot, 'Failed to reach villager - pathfinding error or villager moved');
            console.log(err);
            return null;
        } finally {
            bot.modes.unpause('unstuck');
        }
    }
    
    return entity;
}

/**
 * Show available trades for a specified villager
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager to show trades for
 * @returns {Promise<boolean>} true if trades were shown successfully, false otherwise
 * @example
 * await skills.showVillagerTrades(bot, "123");
 */
export async function showVillagerTrades(bot, id) {
    const villagerEntity = await findAndGoToVillager(bot, id);
    if (!villagerEntity) {
        return false;
    }
    
    try {
        const villager = await bot.openVillager(villagerEntity);
        
        if (!villager.trades || villager.trades.length === 0) {
            log(bot, 'This villager has no trades available - might be sleeping, a baby, or jobless');
            villager.close();
            return false;
        }
        
        log(bot, `Villager has ${villager.trades.length} available trades:`);
        stringifyTrades(bot, villager.trades).forEach((trade, i) => {
            const tradeInfo = `${i + 1}: ${trade}`;
            console.log(tradeInfo);
            log(bot, tradeInfo);
        });
        
        villager.close();
        return true;
    } catch (err) {
        log(bot, 'Failed to open villager trading interface - they might be sleeping, a baby, or jobless');
        console.log('Villager trading error:', err.message);
        return false;
    }
}

/**
 * Trade with a specified villager
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager to trade with
 * @param {number} index - the index (1-based) of the trade to execute
 * @param {number} count - how many times to execute the trade (optional)
 * @returns {Promise<boolean>} true if trade was successful, false otherwise
 * @example
 * await skills.tradeWithVillager(bot, "123", "1", "2");
 */
export async function tradeWithVillager(bot, id, index, count) {
    const villagerEntity = await findAndGoToVillager(bot, id);
    if (!villagerEntity) {
        return false;
    }
    
    try {
        const villager = await bot.openVillager(villagerEntity);
        
        if (!villager.trades || villager.trades.length === 0) {
            log(bot, 'This villager has no trades available - might be sleeping, a baby, or jobless');
            villager.close();
            return false;
        }
        
        const tradeIndex = parseInt(index) - 1; // Convert to 0-based index
        const trade = villager.trades[tradeIndex];
        
        if (!trade) {
            log(bot, `Trade ${index} not found. This villager has ${villager.trades.length} trades available.`);
            villager.close();
            return false;
        }
        
        if (trade.disabled) {
            log(bot, `Trade ${index} is currently disabled`);
            villager.close();
            return false;
        }

        const item_2 = trade.inputItem2 ? stringifyItem(bot, trade.inputItem2)+' ' : '';
        log(bot, `Trading ${stringifyItem(bot, trade.inputItem1)} ${item_2}for ${stringifyItem(bot, trade.outputItem)}...`);
        
        const maxPossibleTrades = trade.maximumNbTradeUses - trade.nbTradeUses;
        const requestedCount = count;
        const actualCount = Math.min(requestedCount, maxPossibleTrades);
        
        if (actualCount <= 0) {
            log(bot, `Trade ${index} has been used to its maximum limit`);
            villager.close();
            return false;
        }
        
        if (!hasResources(villager.slots, trade, actualCount)) {
            log(bot, `Don't have enough resources to execute trade ${index} ${actualCount} time(s)`);
            villager.close();
            return false;
        }
        
        log(bot, `Executing trade ${index} ${actualCount} time(s)...`);
        
        try {
            await bot.trade(villager, tradeIndex, actualCount);
            log(bot, `Successfully traded ${actualCount} time(s)`);
            villager.close();
            return true;
        } catch (tradeErr) {
            log(bot, 'An error occurred while trying to execute the trade');
            console.log('Trade execution error:', tradeErr.message);
            villager.close();
            return false;
        }
    } catch (err) {
        log(bot, 'Failed to open villager trading interface');
        console.log('Villager interface error:', err.message);
        return false;
    }
}

function hasResources(window, trade, count) {
    const first = enough(trade.inputItem1, count);
    const second = !trade.inputItem2 || enough(trade.inputItem2, count);
    return first && second;

    function enough(item, count) {
        let c = 0;
        window.forEach((element) => {
            if (element && element.type === item.type && element.metadata === item.metadata) {
                c += element.count;
            }
        });
        return c >= item.count * count;
    }
}

function stringifyTrades(bot, trades) {
    return trades.map((trade) => {
        let text = stringifyItem(bot, trade.inputItem1);
        if (trade.inputItem2) text += ` & ${stringifyItem(bot, trade.inputItem2)}`;
        if (trade.disabled) text += ' x '; else text += ' » ';
        text += stringifyItem(bot, trade.outputItem);
        return `(${trade.nbTradeUses}/${trade.maximumNbTradeUses}) ${text}`;
    });
}

function stringifyItem(bot, item) {
    if (!item) return 'nothing';
    let text = `${item.count} ${item.displayName}`;
    if (item.nbt && item.nbt.value) {
        const ench = item.nbt.value.ench;
        const StoredEnchantments = item.nbt.value.StoredEnchantments;
        const Potion = item.nbt.value.Potion;
        const display = item.nbt.value.display;

        if (Potion) text += ` of ${Potion.value.replace(/_/g, ' ').split(':')[1] || 'unknown type'}`;
        if (display) text += ` named ${display.value.Name.value}`;
        if (ench || StoredEnchantments) {
            text += ` enchanted with ${(ench || StoredEnchantments).value.value.map((e) => {
                const lvl = e.lvl.value;
                const id = e.id.value;
                return bot.registry.enchantments[id].displayName + ' ' + lvl;
            }).join(' ')}`;
        }
    }
    return text;
}

export async function digDown(bot, distance = 10) {
    /**
     * Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {int} distance, distance to dig down.
     * @returns {Promise<boolean>} true if successfully dug all the way down.
     * @example
     * await skills.digDown(bot, 10);
     **/

    let start_block_pos = bot.blockAt(bot.entity.position).position;
    for (let i = 1; i <= distance; i++) {
        const targetBlock = bot.blockAt(start_block_pos.offset(0, -i, 0));
        let belowBlock = bot.blockAt(start_block_pos.offset(0, -i-1, 0));

        if (!targetBlock || !belowBlock) {
            log(bot, `Dug down ${i-1} blocks, but reached the end of the world.`);
            return true;
        }

        // Check for lava, water
        if (names112.isLiquid(targetBlock.name) || names112.isLiquid(belowBlock.name)) {
            log(bot, `Dug down ${i-1} blocks, but reached ${belowBlock ? belowBlock.name : '(lava/water)'}`)
            return false;
        }

        const MAX_FALL_BLOCKS = 2;
        let num_fall_blocks = 0;
        for (let j = 0; j <= MAX_FALL_BLOCKS; j++) {
            if (!belowBlock || belowBlock.name !== 'air') {
                break;
            }
            num_fall_blocks++;
            belowBlock = bot.blockAt(belowBlock.position.offset(0, -1, 0));
        }
        if (num_fall_blocks > MAX_FALL_BLOCKS) {
            log(bot, `Dug down ${i-1} blocks, but reached a drop below the next block.`);
            return false;
        }

        if (targetBlock.name === 'air') { // 1.12 has no cave_air (B1b)
            log(bot, 'Skipping air block');
            console.log(targetBlock.position);
            continue;
        }

        let dug = await breakBlockAt(bot, targetBlock.position.x, targetBlock.position.y, targetBlock.position.z);
        if (!dug) {
            log(bot, 'Failed to dig block at position:' + targetBlock.position);
            return false;
        }
    }
    log(bot, `Dug down ${distance} blocks.`);
    return true;
}

export async function goToSurface(bot) {
    /**
     * Navigate to the surface (highest non-air block at current x,z).
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the surface was reached, false otherwise.
     **/
    const pos = bot.entity.position;
    for (let y = names112.WORLD_MAX_Y; y >= names112.WORLD_MIN_Y; y--) { // 1.12 height (B1); probably not the best way to find the surface but it works
        const block = bot.blockAt(new Vec3(pos.x, y, pos.z));
        if (!block || block.name === 'air') { // 1.12 has no cave_air (B1b)
            continue;
        }
        await goToPosition(bot, block.position.x, block.position.y + 1, block.position.z, 0); // this will probably work most of the time but a custom mining and towering up implementation could be added if needed
        log(bot, `Going to the surface at y=${y+1}.`);``
        return true;
    }
    return false;
}

/**
 * Bounds for !useOn (skills-rotn; G3 batch A: !useOn("pyrotech:crude_axe", "log") walked to a log
 * and never returned, because pathfinder.goto has no time limit). The search looks at the few
 * nearest targets within `range`; each walk has `walkMs`; the whole use has `totalMs`.
 */
export const USE_ON_LIMITS = { range: 32, candidates: 4, walkMs: 20_000, totalMs: 60_000, settleMs: 1500, reach: 4.5 };

/**
 * The total time one goToGoal walk may take (G3 smoke C+D). 3 min covers a 512-block
 * !searchForBlock walk with detours; every goTo* skill and command walks through goToGoal.
 */
/** How long a cancelled step may take to end before the skill moves on (#224 review 2). */
const STOP_SETTLE_MS = 5000;

/** collectBlock (G3 review of #221): per block, and for the whole run (!collectBlocks has 10 min). */
export const COLLECT_LIMITS = { blockMs: 90_000, totalMs: 8 * 60_000 };

/**
 * The command run this skill belongs to (#224 review 1). A command that hit its total limit
 * (actions.js withinLimit) is marked aborted; it has already reported failure. A skill whose
 * await settles only after that (a late chest window) checks this after its awaits and stops,
 * closing what it opened. The interrupt flag cannot be used: the next command clears it.
 */
export function currentRun(bot) {
    // `in` first: a bot without the property (a strict test double) is never read for it.
    return (bot && 'action_run' in bot ? bot.action_run : null) ?? { aborted: false };
}
function closeQuietly(bot, window) {
    try { if (typeof window?.close === 'function') window.close(); else bot.closeWindow?.(window); } catch { /* best effort */ }
}

export const GO_TO_LIMITS = { totalMs: 180_000, stepMs: 15_000, fleeMs: 30_000 };

/**
 * A raw pathfinder.goto with a time limit (stepMs for a step in a fight or a step back from a
 * placed block, fleeMs for moving away from an entity). At the limit the walk is stopped; returns
 * true, or TIMED_OUT. A goto that fails still throws, as before.
 */
async function boundedGoto(bot, goal, ms) {
    const walked = await within(bot.pathfinder.goto(goal), ms, () => stopWalking(bot));
    return walked === TIMED_OUT ? TIMED_OUT : true;
}

const TIMED_OUT = Symbol('timed out');
/** The promise's value, or TIMED_OUT after `ms` (then `onTimeout` runs). A later rejection is swallowed. */
function within(promise, ms, onTimeout = () => {}) {
    let timer;
    const limit = new Promise(resolve => {
        // Resolve first: onTimeout (a pathfinder stop) rejects the work, which must not win the race.
        timer = setTimeout(() => { resolve(TIMED_OUT); try { onTimeout(); } catch { /* best effort */ } }, Math.max(0, ms));
    });
    const work = Promise.resolve(promise);
    work.catch(() => {});
    return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}
function stopWalking(bot) {
    try { bot.pathfinder?.stop?.(); } catch { /* best effort */ }
    try { bot.pathfinder?.setGoal?.(null); } catch { /* best effort */ }
}
/** {name[:meta]: count} over every inventory slot. */
function slotCounts(bot) {
    const counts = {};
    for (const it of bot.inventory?.slots || []) {
        if (!it || !it.name || !(it.count > 0)) continue;
        const key = it.metadata ? `${it.name}:${it.metadata}` : it.name;
        counts[key] = (counts[key] || 0) + it.count;
    }
    return counts;
}
function gains(before, after) {
    return Object.entries(after).filter(([k, n]) => n > (before[k] || 0)).map(([k, n]) => `${n - (before[k] || 0)} ${k}`);
}
const secsText = (ms) => `${+(ms / 1000).toFixed(1)} s`;
const posText = (p) => `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;

/**
 * Walk to a block and use the tool on it, every step bounded. Returns one of
 * 'used' (an item was gained or the block changed), 'no_effect', 'unreachable', 'blocked',
 * 'no_tool', 'interrupted', 'timeout'.
 */
async function useToolOnBlockBounded(bot, toolName, block, L, left) {
    const where = posText(block.position);
    const distance = toolName === 'water_bucket' && !names112.isLava(block.name) ? 1.5 : 2;
    const walkMs = Math.min(L.walkMs, left());
    const walk = await within(goToPosition(bot, block.position.x, block.position.y, block.position.z, distance),
        walkMs, () => stopWalking(bot));
    if (bot.interrupt_code) return 'interrupted';
    const headPos = () => bot.entity.position.offset(0, bot.entity.height ?? 1.62, 0);
    const center = block.position.offset(0.5, 0.5, 0.5);
    if (walk === TIMED_OUT || headPos().distanceTo(center) > L.reach) {
        log(bot, `Could not reach the ${block.name} at ${where}${walk === TIMED_OUT ? ` within ${secsText(walkMs)}` : ''}.`);
        // A walk cut short by the total limit means time is up.
        return walk === TIMED_OUT && walkMs < L.walkMs ? 'timeout' : 'unreachable';
    }
    if (await within(bot.lookAt(center), left()) === TIMED_OUT) return 'timeout';
    const blockInView = bot.blockAtCursor?.(5);
    if (blockInView && !blockInView.position.equals(block.position)
        && blockInView.position.distanceTo(headPos()) < block.position.distanceTo(headPos())) {
        log(bot, `Block ${blockInView.name} is in the way of the ${block.name} at ${where}.`);
        return 'blocked';
    }
    const equipped = await within(equip(bot, toolName), left());
    if (equipped === TIMED_OUT) return 'timeout';
    if (!equipped) { log(bot, `Could not equip ${toolName}.`); return 'no_tool'; }

    const before = slotCounts(bot);
    const was = { name: block.name, metadata: block.metadata };
    const use = toolName.includes('bucket') ? bot.activateItem() : bot.activateBlock(block);
    if (await within(use, left()) === TIMED_OUT) return 'timeout';
    // The result: an inventory gain, or the block changed (a debarked log, a tilled field).
    const until = Date.now() + Math.min(L.settleMs, Math.max(0, left()));
    let gained = [], now = null;
    for (;;) {
        gained = gains(before, slotCounts(bot));
        now = bot.blockAt(block.position);
        if (gained.length || !now || now.name !== was.name || now.metadata !== was.metadata || Date.now() >= until) break;
        await new Promise(r => setTimeout(r, 100));
    }
    const changed = !now || now.name !== was.name || now.metadata !== was.metadata;
    if (gained.length) log(bot, `Used ${toolName} on ${block.name} at ${where}: gained ${gained.join(', ')}.`);
    else if (changed) log(bot, `Used ${toolName} on ${block.name} at ${where}: it is now ${now ? now.name : 'gone'}; no item gained (not a plank or any other item yet).`);
    else log(bot, `Used ${toolName} on ${block.name} at ${where}: no effect (no item gained, the block is unchanged).`);
    return gained.length || changed ? 'used' : 'no_effect';
}

export async function useToolOn(bot, toolName, targetName, limits = {}) {
    /**
     * Equip a tool and use it on the nearest target. Bounded (USE_ON_LIMITS): a few nearest
     * targets within range, a time limit per walk and in total; a block use is judged by the
     * inventory gain or the block's change.
     * True does not mean an item was gained: a block change alone (debarking a log) is a success
     * too. A caller that needs an item counts the inventory itself; the agenda judges its steps
     * from the inventory only (first_plank needs a plankWood item; a debarked log is logWood).
     * @param {MinecraftBot} bot
     * @param {string} toolName - item name of the tool to equip, or "hand" for no tool.
     * @param {string} targetName - entity type, block type, or "nothing" for no target
     * @returns {Promise<boolean>} true if action succeeded
     */
    const L = { ...USE_ON_LIMITS, ...limits };
    const start = Date.now();
    const left = () => L.totalMs - (Date.now() - start);
    if (toolName !== 'hand' && bot.game.gameMode !== 'creative'
        && !bot.inventory.slots.find(slot => slot && itemMatches(slot, toolName))) {
        log(bot, `You do not have any ${toolName} to use.`);
        return false;
    }

    targetName = targetName.toLowerCase();
    const timeUp = () => { log(bot, `useOn failed: time limit of ${secsText(L.totalMs)} reached.`); return false; };
    if (targetName === 'nothing') {
        const equipped = await within(equip(bot, toolName), left());
        if (equipped === TIMED_OUT) return timeUp();
        if (!equipped) {
            return false;
        }
        if (await within(bot.activateItem(), left()) === TIMED_OUT) return timeUp();
        log(bot, `Used ${toolName}.`);
    } else if (world.isEntityType(targetName)) {
        const entity = world.getNearestEntityWhere(bot, e => e.name === targetName, L.range);
        if (!entity) {
            log(bot, `Could not find any ${targetName} within ${L.range} blocks.`);
            return false;
        }
        const walkMs = Math.min(L.walkMs, left());
        const walk = await within(goToPosition(bot, entity.position.x, entity.position.y, entity.position.z),
            walkMs, () => stopWalking(bot));
        if (bot.interrupt_code) return false;
        if (walk === TIMED_OUT) {
            log(bot, `useOn failed: could not reach the ${targetName} within ${secsText(walkMs)}${walkMs < L.walkMs ? ` (the ${secsText(L.totalMs)} limit)` : ''}.`);
            return false;
        }
        const equipped = await within(toolName === 'hand' ? Promise.resolve(bot.unequip('hand')).then(() => true) : equip(bot, toolName), left());
        if (equipped === TIMED_OUT) return timeUp();
        if (!equipped) return false;
        if (bot.interrupt_code) return false;
        if (await within(bot.useOn(entity), left()) === TIMED_OUT) return timeUp();
        log(bot, `Used ${toolName} on ${targetName}.`);
    } else {
        let blocks;
        if (targetName === 'water' || targetName === 'lava') {
            // we want to get liquid source blocks, not flowing blocks
            // so search for blocks with metadata 0 (not flowing)
            blocks = world.getNearestBlocksWhere(bot, block => block.name === targetName && block.metadata === 0, L.range, L.candidates);
        }
        else {
            blocks = world.getNearestBlocks(bot, targetName, L.range, L.candidates);
        }
        blocks = (blocks || []).filter(Boolean);
        if (blocks.length === 0) {
            log(bot, `Could not find any ${targetName === 'water' || targetName === 'lava' ? 'source ' : ''}${targetName} within ${L.range} blocks.`);
            return false;
        }
        const unreachable = [];
        let timeUp = false, tried = 0;
        for (const block of blocks) {
            if (left() <= 0) { timeUp = true; break; }
            tried++;
            const r = await useToolOnBlockBounded(bot, toolName, block, L, left);
            if (r === 'used') return true;
            if (r === 'interrupted') return false;
            if (r === 'unreachable' || r === 'blocked') { unreachable.push(posText(block.position)); continue; }
            if (r === 'timeout') { timeUp = true; break; }
            return false; // no_effect, no_tool: another block of the same kind would do the same
        }
        stopWalking(bot);
        const secs = Math.round((Date.now() - start) / 1000);
        if (timeUp) log(bot, `useOn failed: time limit of ${secsText(L.totalMs)} reached (tried ${tried} of the ${blocks.length} nearest ${targetName}).`);
        else log(bot, `useOn failed: could not reach any of the ${blocks.length} nearest ${targetName} within ${L.range} blocks (${unreachable.join('; ')}) in ${secs} s.`);
        return false;
    }

    return true;
 }

 export async function useToolOnBlock(bot, toolName, block) {
    /**
     * Use a tool on a specific block.
     * @param {MinecraftBot} bot
     * @param {string} toolName - item name of the tool to equip, or "hand" for no tool.
     * @param {Block} block - the block reference to use the tool on.
     * @returns {Promise<boolean>} true if action succeeded
     */

    const distance = toolName === 'water_bucket' && !names112.isLava(block.name) ? 1.5 : 2;
    await goToPosition(bot, block.position.x, block.position.y, block.position.z, distance);
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));

    // if block in view is closer than the target block, it is in our way. try to move closer
    const viewBlocked = () => {
        const blockInView = bot.blockAtCursor(5);
        const headPos = bot.entity.position.offset(0, bot.entity.height, 0);
        return blockInView && 
            !blockInView.position.equals(block.position) && 
            blockInView.position.distanceTo(headPos) < block.position.distanceTo(headPos);
    }
    const blockInView = bot.blockAtCursor(5);
    if (viewBlocked()) {
        log(bot, `Block ${blockInView.name} is in the way, moving closer...`);
        // choose random block next to target block, go to it
        const nearbyPos = block.position.offset(Math.random() * 2 - 1, 0, Math.random() * 2 - 1);
        await goToPosition(bot, nearbyPos.x, nearbyPos.y, nearbyPos.z, 1);
        await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
        if (viewBlocked()) {
            const blockInView = bot.blockAtCursor(5);
            log(bot, `Block ${blockInView.name} is in the way, not using ${toolName}.`);
            return false;
        }
    }

    const equipped = await equip(bot, toolName);

    if (!equipped) {
        log(bot, `Could not equip ${toolName}.`);
        return false;
    }
    if (toolName.includes('bucket')) {
        await bot.activateItem();
    }
    else {
        await bot.activateBlock(block);
    }
    log(bot, `Used ${toolName} on ${block.name}.`);
    return true;
 }
