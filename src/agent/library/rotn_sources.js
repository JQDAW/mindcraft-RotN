// Where an item comes from in the RotN world, for collecting (skills-rotn B2).
// The facts are rotn-data's howToGet "world" rules (3.3.4/world-sources.json):
// breaking a rock pile by hand gives 1 rock; mining stone with a pickaxe below
// Sturdy gives 4 rocks of the stone's type instead of cobblestone; and so on.
// No RotN block names are hard-coded here.
import { howToGet, getItem, registryName, botName } from '../../../packages/rotn-data/index.js';
import { formatName, parseName } from './rotn_names.js';

/**
 * The world rules for getting an item by breaking blocks.
 * @param {string} name a canonical item name ("pyrotech:rock", "pyrotech:rock:0")
 * @returns {Array<{blocks: string[], tool: {type: string, minLevel?: number, maxLevel?: number}|null, count: number, text: string}>}
 *          text is the rule's summary, for the bot's log
 */
export function worldSources(name) {
    const p = parseName(name);
    if (!p) return [];
    let result = null;
    try {
        result = howToGet(registryName(p.name), p.meta == null ? {} : { meta: p.meta });
    } catch {
        return [];
    }
    return (result?.ways ?? [])
        .filter(w => w.kind === 'world' && Array.isArray(w.blocks) && w.blocks.length > 0)
        .map(w => ({
            blocks: w.blocks.map(b => formatName(botName(b.name), b.meta ?? null)),
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

/** Whether the bot holds a tool the rule accepts (no rule: any hand). */
export function toolAllows(bot, tool) {
    if (!tool) return true;
    return toolLevels(bot, tool.type).some(level =>
        (tool.minLevel == null || level >= tool.minLevel) && (tool.maxLevel == null || level <= tool.maxLevel));
}

/** "a pickaxe below Sturdy (level 0)" style text for a rule's tool, for the bot's log. */
export function describeTool(tool) {
    if (!tool) return 'nothing';
    const range = tool.maxLevel != null && tool.minLevel == null ? ` of level ${tool.maxLevel} or lower`
        : tool.minLevel != null && tool.maxLevel == null ? ` of level ${tool.minLevel} or higher`
        : tool.minLevel != null ? ` of level ${tool.minLevel}-${tool.maxLevel}` : '';
    return `a ${tool.type}${range}`;
}
