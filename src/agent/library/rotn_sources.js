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
            count: typeof w.count === 'number' && w.count > 0 ? w.count : 1,
            text: w.summary ?? w.action ?? '',
        }));
}

/** The levels of every tool of this type the bot holds ("pickaxe" -> [0] for a stone pickaxe). */
export function toolLevels(bot, type) {
    const levels = [];
    for (const item of bot.inventory.items()) {
        const level = getItem(registryName(item.name))?.toolClasses?.[type];
        if (typeof level === 'number' && level >= 0) levels.push(level);
    }
    return levels;
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

/** "a pickaxe below Sturdy (level 0)" style text for a rule's tool, for the bot's log. */
export function describeTool(tool) {
    if (!tool) return 'nothing';
    const range = tool.maxLevel != null && tool.minLevel == null ? ` of level ${tool.maxLevel} or lower`
        : tool.minLevel != null && tool.maxLevel == null ? ` of level ${tool.minLevel} or higher`
        : tool.minLevel != null ? ` of level ${tool.minLevel}-${tool.maxLevel}` : '';
    return `a ${tool.type}${range}`;
}
