// Round 17 K (Fable S3, S6; /home/rv/k-plan-skills.md): command preconditions. A command may carry
// canRun(agent, ...args, context) -> {code, why} | why | null, which commands/index.js runs before perform: before the
// running action is stopped (runAsAction -> actions.runAction), before any walk or craft. A refusal is the command's
// output and goes into the memory's Recent failures with its why.
// Rules: canRun is synchronous and only reads (inventory, blocks, recipes, memos): no await, no path search, no
// Movements. An exception inside it counts as null: a bug in a precondition never blocks a command.
import * as mc from '../../utils/mcdata.js';
import * as world from '../library/world.js';
import { countItem } from '../library/rotn_names.js';
import { craftNeeds, describeNeeds } from '../library/craft_needs.js';
import { isGenericCobble, cobbleChoices, ROCKS_PER_COBBLE } from '../library/cobble.js';
import { TABLE_CHAIN } from '../library/pickaxe.js';
import { safeError } from '../safe_error.js';
import * as inv from '../library/inventory_view.js';

/** How far craftRecipe looks for a crafting table (skills.craftRecipe's craftingTableRange). */
export const CRAFT_TABLE_RANGE = 16;

/**
 * A command's canRun, guarded: {code, why} or null. Not a function, a throw, a promise (an async canRun breaks the
 * rule) or an empty answer: null, and the command runs as before.
 */
export function checkCanRun(command, agent, args, context) {
    if (typeof command?.canRun !== 'function') return null;
    // K1 review 3: during an escape climb the state is about to change (a stair cell dug, a table made); the command
    // waits for the climb (action_manager ESCAPE_WAIT) as before and its skill judges the state after it.
    if (agent?.bot?.rotnClimbing === true) return null;
    let r = null;
    try {
        r = command.canRun(agent, ...(args ?? []), context);
    } catch (err) {
        console.warn(`[canRun] ${command.name}: the check threw (${safeError(err)}); the command runs.`);
        return null;
    }
    if (!r) return null;
    if (typeof r.then === 'function') {
        console.warn(`[canRun] ${command.name}: the check returned a promise (it must be synchronous); the command runs.`);
        return null;
    }
    if (typeof r === 'string') return { code: 'refused', why: r };
    return r.why ? { code: r.code ?? 'refused', why: String(r.why) } : null;
}

/** A perform hands its skill's {ok, code, why, where} to the command layer (commands/index.js reads context._k). */
export function noteResult(context, r) {
    if (context?._k && r && typeof r === 'object') context._k.result = r;
    return r;
}

/**
 * !craftRecipe's canRun, in craftRecipe's own order (skills.craftRecipe), so it refuses only what craftRecipe would:
 * 1. no crafting recipe on this pack (dl16:2090 wooden_pickaxe, dl17:3038 metamorphic_stone), with a hint;
 * 2. an input only the off hand holds: never refused, craftRecipe moves it (#670 L4, dl17:2273); nor anything while a
 *    stack sits in the 2x2 grid or on the cursor (K1 review 1: craftRecipe returns them first);
 * 3. no registry recipe at all and rotn-data's fill not ready: what is missing (dl16:819, dl17:2217), the table's way
 *    too when none is near or held;
 * 4. a table recipe, no table within 16 blocks and none held (dl16:776, 1017): the whole way to a table, said once.
 * "cobblestone" (the rock kinds, cobble.js) is left to its own craft.
 */
export function craftRecipeCanRun(agent, name) {
    const bot = agent?.bot;
    if (!bot || typeof name !== 'string' || isGenericCobble(name)) return null;
    if ((mc.getItemCraftingRecipes(name)?.length ?? 0) === 0) return { code: 'no-recipe', why: noRecipeText(bot, name) };
    // K1 review 1: stacks in the 2x2 grid or on the cursor are not counted here (craftNeeds and recipesFor read items()),
    // and craftRecipe returns them to the inventory first (returnGrid, soak 15 N3): the craft judges.
    if (inv.gridSlotsHeld(bot).length || inv.cursorStack(bot)) return null;
    const needs = craftNeeds(bot, name);
    if (needs && !needs.ready && craftNeeds(bot, name, { offHand: true })?.ready) return null;
    const id = mc.getItemId(name);
    const meta = mc.resolveName(name)?.meta ?? null;
    if (bot.recipesFor(id, meta, 1, null)?.length) return null;
    const noTable = !world.getNearestBlock(bot, 'crafting_table', CRAFT_TABLE_RANGE) && countItem(bot, 'crafting_table') === 0;
    if (!bot.recipesFor(id, meta, 1, true)?.length) {
        if (!needs || needs.ready) return null; // craftByFill or upstream's text: the craft says
        const table = needs.requiresTable && noTable ? ` It is made at a crafting table, and there is none within ${CRAFT_TABLE_RANGE} blocks and none in your inventory: ${tableWay(bot)}` : '';
        return { code: 'missing', why: `You do not have the resources to craft ${name}. ${describeNeeds(name, needs)}${table}` };
    }
    if (!noTable) return null;
    return { code: 'no-table', why: `Crafting ${name} requires a crafting table: there is none within ${CRAFT_TABLE_RANGE} blocks and none in your inventory. ${tableWay(bot)}` };
}

/**
 * The way to a crafting table from what the bot holds (TABLE_CHAIN, read from the table down): each link's needs while
 * the link below it is missing too, and the first link that can be made now with its command. Soak 16: dl16:776 ->
 * 798 -> 819 -> 1017 -> 1530 named one link per failed call.
 */
export function tableWay(bot) {
    const chain = [...TABLE_CHAIN].reverse(); // crafting_table, Crafting Tools, the crude axe
    const parts = [];
    for (let i = 0; i < chain.length; i++) {
        const item = chain[i].item;
        const n = craftNeeds(bot, item);
        if (!n) break;
        if (n.ready) { parts.push(`Make the ${item} now: !craftRecipe("${item}", 1).`); break; }
        parts.push(describeNeeds(item, n));
        const lower = chain[i + 1]?.item;
        if (!lower || countItem(bot, lower) > 0) break;
    }
    return parts.length ? parts.join(' ') : 'Make one: !craftRecipe("crafting_table", 1).';
}

/** Why there is no recipe, and what to do instead (dl16:2090, dl17:3038). */
export function noRecipeText(bot, name) {
    const known = mc.getItemId(name) != null || mc.getBlockId(name) != null;
    const head = known ? `Cannot craft ${name}: it has no crafting recipe on this pack.` : `Cannot craft ${name}: there is no item of that name.`;
    const base = String(name).split(':').pop().replace(/:\d+$/, '');
    if (/(^|_)stone$/.test(base)) {
        const c = cobbleChoices(bot)[0];
        return `${head} For shelter blocks, make cobblestone from your rocks instead: `
            + (c ? `your ${c.rock} rocks make ${c.gives}: !craftRecipe("cobblestone", ${Math.floor(c.have / ROCKS_PER_COBBLE)}) (${ROCKS_PER_COBBLE} rocks each).`
                : `collect rocks with !collectBlocks("pyrotech:rock", 8), then !craftRecipe("cobblestone", 1) (${ROCKS_PER_COBBLE} rocks of one kind each).`);
    }
    if (mc.getBlockId(name) != null) return `${head} It is a block: mine it with !collectBlocks("${name}", 1).`;
    return `${head} !craftable lists what you can make now.`;
}
