// Where an item comes from in the RotN world, for collecting (skills-rotn B2).
// The facts are rotn-data's howToGet "world" rules (3.3.4/world-sources.json):
// breaking a rock pile by hand gives 1 rock; mining stone with a pickaxe below
// Sturdy gives 4 rocks of the stone's type instead of cobblestone; and so on.
// No RotN block names are hard-coded here.
import { howToGet, getItem, registryName, botName } from '../../../packages/rotn-data/index.js';
import { formatName, parseName } from './rotn_names.js';

// rotn-data's howToGet for a canonical name, or null for an unknown item.
function lookup(name) {
    const p = parseName(name);
    if (!p) return null;
    try {
        return howToGet(registryName(p.name), p.meta == null ? {} : { meta: p.meta });
    } catch {
        return null;
    }
}

// An ore member as a canonical name: a wildcard member (meta null) is the bare name, any variant.
const memberName = (m) => (m.meta == null ? botName(m.name) : formatName(botName(m.name), m.meta));

/**
 * The items a name stands for when collecting. A bare name whose world rule carries
 * an ore dictionary (rotn-data #142: the rock-pile and stone rules carry ore "rock")
 * stands for every member of that ore, because the recipes that need it (crude axe,
 * Crafting Tools, stone tools) accept any member: pyrotech:rock 0, 6, 8 and every
 * Underground Biomes rock (pyrotech_compat:rock_igneous, _metamorphic,
 * _sedimentary). Dirt clumps, sand piles and wood chips are not members (#141
 * review). Without ore data, rotn-data's narrowed item metas are used. An explicit
 * variant ("pyrotech:rock:0") is just itself.
 */
export function itemVariants(name) {
    const p = parseName(name);
    if (!p || p.meta != null) return [name];
    const result = lookup(name);
    const ore = (result?.ways ?? []).find(w => w.kind === 'world' && w.ore?.members?.some(m => botName(m.name) === p.name))?.ore;
    if (ore) return [...new Set(ore.members.map(memberName))];
    const metas = result?.item?.metas;
    if (!Array.isArray(metas) || metas.length === 0) return [name];
    return metas.map(meta => formatName(p.name, meta));
}

/**
 * The world rules for getting an item by breaking blocks (only rules whose action is "break").
 * @param {string} name a canonical item name ("pyrotech:rock", "pyrotech:rock:0")
 * @returns {Array<{blocks: string[], tool: {type: string, minLevel?: number, maxLevel?: number}|null, count: number, text: string}>}
 *          count is the rule's documented yield (a hint; collectBlock counts the real gain);
 *          text is the rule's summary, for the bot's log
 */
export function worldSources(name) {
    const result = lookup(name);
    if (!result) return [];
    const sources = rulesOf(result, name);
    if (isPlainStick(name) && !sources.some(s => s.blocks.includes(DEAD_BUSH_STICKS.blocks[0]))) sources.push({ ...DEAD_BUSH_STICKS });
    return sources;
}

/**
 * TEMPORARY, until rotn-data's by-hand dead bush rule for sticks lands (lead, G3 round 8 A); remove it
 * then. It stands in only while no rotn-data rule names the dead bush. Evidence: round 8 A, a dead
 * bush broken by hand gave a stick ("Broke deadbush ... (it gave 1 stick)"); vanilla 1.12
 * BlockDeadBush drops 0-2 sticks when not sheared, and the pack has no override for it.
 */
const DEAD_BUSH_STICKS = {
    blocks: ['deadbush'], tool: null, preferredTool: null, unlessTool: null, id: 'dead-bush-fallback', count: 1,
    text: 'Break a dead bush by hand: it drops 0-2 sticks.',
};
const isPlainStick = (name) => { const p = parseName(name); return p?.name === 'stick' && (p.meta == null || p.meta === 0); };

function rulesOf(result, name) {
    // A bare name ("pyrotech:rock") means every member of the rule's ore; an explicit variant
    // ("pyrotech:rock:0") only the blocks that drop that variant (#145 review nit).
    const bare = parseName(name)?.meta == null;
    return (result?.ways ?? [])
        // Only rules that break a block; item-on-block rules (debark a log) are skills of their own (C2).
        .filter(w => w.kind === 'world' && w.action === 'break' && Array.isArray(w.blocks) && w.blocks.length > 0)
        .map(w => ({
            // With an ore (rotn-data #142), the blocks and metas whose drop is in it: the
            // Underground Biomes piles at every meta, pyrotech:rock only at 0, 6 and 8.
            blocks: bare && w.ore?.blocks?.length
                ? w.ore.blocks.flatMap(b => b.metas.map(meta => formatName(botName(b.name), meta)))
                : w.blocks.map(b => formatName(botName(b.name), b.meta ?? null)),
            tool: w.tool ?? null,
            // A tool that helps but is not needed (rotn-data #252: an axe fells a tree faster; by hand works).
            preferredTool: w.preferredTool ?? null,
            // A tool that changes the drop (rotn-data #288: a shovel of level 1+ makes dirt drop dirt,
            // not 4 dirt piles): the rule holds only while the bot does NOT use such a tool.
            unlessTool: w.unlessTool ?? null,
            id: w.id ?? null, // the rule ("fell-tree": a Dynamic Trees branch fells the tree)
            count: typeof w.count === 'number' && w.count > 0 ? w.count : 1,
            text: w.summary ?? w.action ?? '',
        }));
}

/** The levels of every tool of this type the bot holds ("pickaxe" -> [0] for a stone pickaxe). */
export function toolLevels(bot, type) {
    const levels = [];
    // inventory.items() only: the same stacks allowedTool and mineflayer-tool's equipForBlock can
    // equip (#229 review). A stack on the cursor or in the off hand is moved back first (stowCarried).
    for (const item of bot.inventory.items()) {
        const level = getItem(registryName(item.name))?.toolClasses?.[type];
        if (typeof level === 'number' && level >= 0) levels.push(level);
    }
    return levels;
}

/** Where the bot's stacks are: the inventory (slots 9-44), the off hand (slot 45), the cursor. */
function carriedPlaces(bot) {
    const inv = bot?.inventory;
    const ok = (i) => i && typeof i.name === 'string';
    return {
        inventory: (inv?.items?.() ?? []).filter(ok),
        offHand: ok(inv?.slots?.[45]) ? inv.slots[45] : null,
        cursor: ok(inv?.selectedItem) ? inv.selectedItem : null,
    };
}

/**
 * A log line of where the matching stacks are (G3 round 2 B: the night routine said "without a
 * pickaxe" while the bot owned a stone pickaxe; the log could not tell why).
 */
export function describeCarried(bot, want = () => true) {
    const p = carriedPlaces(bot);
    const names = (list) => (list.length ? list.map(i => i.name).join(', ') : 'none');
    return `inventory: ${names(p.inventory.filter(want))}; off hand: ${p.offHand ? p.offHand.name : 'empty'}; `
        + `cursor: ${p.cursor ? p.cursor.name : 'empty'}; held: ${bot?.heldItem?.name ?? 'nothing'}`;
}

/** Wait for pending slot updates (after a rejected click the server resends every slot). */
export const RESYNC_MS = 600;

/**
 * Move a matching stack from the cursor (an equip cut short) or the off hand back into the
 * inventory, so the check and every equip path (allowedTool, equipForBlock) see the same stacks
 * (#229 review). Then wait RESYNC_MS for pending slot updates. Returns what was moved.
 */
/** How long one window click may take before stowCarried gives up on it (#229 review). */
export const STOW_CLICK_MS = 3000;

/** The click's promise, or a rejection after ms (a click the server never answers). */
function clickWithin(promise, ms, what) {
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} got no answer within ${ms / 1000} s`)), ms); });
    return Promise.race([Promise.resolve(promise), limit]).finally(() => clearTimeout(timer));
}

/**
 * Move a matching stack from the cursor (an equip cut short) or the off hand back into the
 * inventory, so the check and every equip path (allowedTool, equipForBlock) see the same stacks
 * (#229 review). Then wait RESYNC_MS for pending slot updates. Returns what was moved.
 * An open window (a chest, a table) is closed first, as clickWindow would act on it (#229 review 2).
 * Its cursor stack is dropped into one of that window's inventory slots before: closing a 1.12
 * container throws whatever is on the cursor onto the ground. Each click has STOW_CLICK_MS.
 */
export async function stowCarried(bot, want = () => true, { resyncMs = RESYNC_MS, clickMs = STOW_CLICK_MS } = {}) {
    const inv = bot?.inventory;
    const moved = [];
    try {
        const open = bot?.currentWindow;
        if (open && open !== inv) {
            const held = open.selectedItem;
            const slot = open.firstEmptyInventorySlot?.() ?? null;
            if (held && slot == null) {
                // Closing now would drop the stack on the ground: leave the window and the stack alone.
                console.warn(`[inventory] a window is open with ${held.name} on the cursor and no free slot; not closing it`);
                return moved;
            }
            if (held) {
                await clickWithin(bot.clickWindow(slot, 0, 0), clickMs, 'putting the cursor stack down');
                if (want(held)) moved.push(`${held.name} from the cursor`);
            }
            bot.closeWindow(open);
        }
        const empty = () => inv?.firstEmptyInventorySlot?.() ?? null;
        const p = carriedPlaces(bot);
        if (p.cursor && want(p.cursor) && empty() != null) {
            await clickWithin(bot.clickWindow(empty(), 0, 0), clickMs, 'putting the cursor stack down'); // into an empty slot
            moved.push(`${p.cursor.name} from the cursor`);
        }
        if (p.offHand && want(p.offHand) && empty() != null) {
            await clickWithin(bot.moveSlotItem(45, empty()), clickMs, 'moving the off-hand stack');
            moved.push(`${p.offHand.name} from the off hand`);
        }
    } catch (err) {
        console.warn(`[inventory] could not move a stack back into the inventory: ${err?.message}`);
    }
    if (resyncMs > 0) await new Promise(resolve => setTimeout(resolve, resyncMs));
    return moved;
}

const levelOk = (tool, level) => (tool.minLevel == null || level >= tool.minLevel) && (tool.maxLevel == null || level <= tool.maxLevel);

/** Whether the bot holds a tool the rule accepts (no rule: any hand). */
export function toolAllows(bot, tool) {
    if (!tool) return true;
    return toolLevels(bot, tool.type).some(level => levelOk(tool, level));
}

/**
 * The stack to equip for a rule: the highest-level held tool of the type the rule
 * still accepts (a stone pickaxe, not an iron one, for "below Sturdy"), or null.
 */
export function allowedTool(bot, tool) {
    if (!tool) return null;
    let best = null;
    let bestLevel = -1;
    for (const item of bot.inventory.items()) {
        const level = getItem(registryName(item.name))?.toolClasses?.[tool.type];
        if (typeof level === 'number' && level >= 0 && levelOk(tool, level) && level > bestLevel) {
            best = item;
            bestLevel = level;
        }
    }
    return best;
}

/** Whether an item is a tool the rule's tool spec accepts ({type, minLevel?, maxLevel?}). */
export function isToolFor(item, tool) {
    if (!item || !tool) return false;
    const level = getItem(registryName(item.name ?? ''))?.toolClasses?.[tool.type];
    return typeof level === 'number' && level >= 0 && levelOk(tool, level);
}

/**
 * Another way to get an item when its own blocks give it only with a tool the bot lacks (rotn-data
 * #288: dirt drops itself only to a shovel of level 1+; by hand it drops 4 dirt piles): a craft
 * with no table from one input that the bot can collect now. {input, per, gives, text} in bot
 * names ("betterwithmods:dirt_pile", 4, "dirt:0"), or null.
 */
export function handRoute(bot, name) {
    const p = parseName(name);
    const result = lookup(name);
    if (!p || !result) return null;
    const want = registryName(p.name);
    for (const w of result.ways ?? []) {
        if (w.kind !== 'craft' || w.requiresTable || w.inputs?.length !== 1 || w.gives?.name !== want) continue;
        if (p.meta != null && (w.gives.meta ?? 0) !== p.meta) continue;
        const input = w.inputs[0];
        for (const c of input.choices ?? []) {
            const inputName = c.meta ? formatName(botName(c.name), c.meta) : botName(c.name);
            const usable = worldSources(inputName).find(s => toolAllows(bot, s.tool));
            if (!usable) continue;
            return { input: inputName, per: input.count, gives: formatName(botName(w.gives.name), w.gives.meta ?? 0), text: usable.text };
        }
    }
    return null;
}

/** Every held item that is the rule's tool (allowedTool gives only the best one). */
export function allowedTools(bot, tool) {
    if (!tool) return [];
    return bot.inventory.items().filter(item => {
        const level = getItem(registryName(item.name))?.toolClasses?.[tool.type];
        return typeof level === 'number' && level >= 0 && levelOk(tool, level);
    });
}

/**
 * Uses a tool has left by its damage (1.12: the item's metadata) and rotn-data's maxDamage (the
 * crude axe has 8): maxDamage - damage, the uses after which it is still whole; null when unknown.
 */
export function toolUsesLeft(item) {
    const max = getItem(registryName(item?.name ?? ''))?.maxDamage;
    if (!(max > 0)) return null;
    const used = item.durabilityUsed ?? item.metadata ?? 0;
    return Math.max(0, max - used);
}

/** "a pickaxe below Sturdy (level 0)" style text for a rule's tool, for the bot's log. */
export function describeTool(tool) {
    if (!tool) return 'nothing';
    const range = tool.maxLevel != null && tool.minLevel == null ? ` of level ${tool.maxLevel} or lower`
        : tool.minLevel != null && tool.maxLevel == null ? ` of level ${tool.minLevel} or higher`
        : tool.minLevel != null ? ` of level ${tool.minLevel}-${tool.maxLevel}` : '';
    return `a ${tool.type}${range}`;
}
