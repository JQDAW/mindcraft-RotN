// The skills layer's name space (skills-rotn B1b; lead decision on STATUS
// Request 8, 2026-11-02).
//
// Skills, inventory counts and LLM-facing output use the bot's 1.12 registry
// names in rotn-data's formatOld convention:
//   "log"             any log variant (no meta given)
//   "log:0"           oak log only; "log:1" spruce
//   "pyrotech:rock:6" a modded variant
//   "crafting_table"  an item without subtypes never carries a meta
// The command boundary turns whatever the LLM wrote (1.21 "oak_log", 1.12
// "log:1", modded "pyrotech:rock") into this form with canonicalName(). A 1.21
// name maps to its exact variant, so "oak_log" is "log:0" (oak only), while a
// plain 1.12 "log" means any log.
//
// Whether an item's metadata names a variant comes from rotn-data's dump
// (Forge's hasSubtypes): logs, planks, coal and rocks have subtypes; tools do
// not (their metadata is damage) and neither does the crafting table.
import { resolveName } from '../../utils/mcdata.js';
import { getItem, toNew, blockToNew, blockToOld, parseOld, botName, registryName } from '../../../packages/rotn-data/index.js';

const subtypeCache = new Map();

/** Whether an item's metadata names a variant (Forge hasSubtypes, from rotn-data's dump). */
export function hasSubtypes(name) {
    const reg = registryName(name);
    if (!reg) return false;
    if (!subtypeCache.has(reg)) subtypeCache.set(reg, !!getItem(reg)?.hasSubtypes);
    return subtypeCache.get(reg);
}

/** "log", 1 -> "log:1"; "log", null -> "log"; meta 0 is kept only for items with subtypes. */
export function formatName(name, meta) {
    if (meta == null) return name;
    if (meta === 0 && !hasSubtypes(name)) return name;
    return `${name}:${meta}`;
}

/** "log:1" -> { name: "log", meta: 1 }; "pyrotech:rock" -> { name: "pyrotech:rock", meta: null }. */
export function parseName(input) {
    const p = parseOld(input);
    return p ? { name: botName(p.name), meta: p.meta } : null;
}

// Names valid in both versions with different meanings (#44 review): for a
// name the LLM wrote, the 1.21 meaning wins (rotn-data: prefer 'new').
export const AMBIGUOUS_NAMES = new Set(['grass', 'stone_slab', 'snow', 'melon', 'nether_brick']);

/**
 * The canonical form of a name the LLM wrote, or null when the bot's registry
 * has no such block or item.
 * - The bot's own 1.12 name is kept as written: "log" (any log), "log:1",
 *   "pyrotech:rock:6", "crafting_table".
 * - Anything else is translated as a 1.21 name to its exact variant:
 *   "oak_log" -> "log:0", "charcoal" -> "coal:1", "grass_block" -> "grass".
 * - The AMBIGUOUS_NAMES always take the 1.21 translation.
 * @param {'items'|'blocks'} kind
 */
export function canonicalName(input, kind = 'items') {
    const p = parseName(input);
    // "minecraft:snow" (how the displays write an ambiguous name) is the bot's own 1.12 name.
    const explicit = typeof input === 'string' && /^s*minecraft:/i.test(input);
    if (p && (explicit || !AMBIGUOUS_NAMES.has(p.name))) {
        const own = resolveName(input, kind, { prefer: 'old' });
        if (own && own.name === p.name) return formatName(own.name, own.meta);
    }
    const r = resolveName(input, kind, { prefer: 'new' });
    return r ? formatName(r.name, r.meta) : null;
}

/** The inventory key for an item stack: "log:1", "pyrotech:rock:6", "stone_pickaxe". */
export function inventoryKey(item) {
    if (!item?.name) return null;
    return displayForm(hasSubtypes(item.name) ? `${item.name}:${item.metadata ?? 0}` : item.name);
}

// What the LLM sees must come back to the same thing (#131 re-review nit): a name that
// means something else in 1.21 (AMBIGUOUS_NAMES, e.g. "snow") is shown with its
// namespace, "minecraft:snow", which canonicalName reads as the 1.12 name.
function displayForm(name) {
    const p = parseName(name);
    return p && AMBIGUOUS_NAMES.has(p.name) ? `minecraft:${name}` : name;
}

/** Whether an item stack is the named item: any variant for a bare name. */
export function itemMatches(item, name) {
    const p = parseName(name);
    if (!p || !item?.name || item.name !== p.name) return false;
    return p.meta == null || !hasSubtypes(p.name) || (item.metadata ?? 0) === p.meta;
}

/** The first inventory stack that is the named item (any variant for a bare name), or null. */
export function findItem(bot, name) {
    return bot.inventory.items().find(item => itemMatches(item, name)) ?? null;
}

/**
 * The metadata to pass to mineflayer's toss/deposit/withdraw for a name: the
 * variant for "log:1", null (any) for a bare name or an item without subtypes
 * (a tool's metadata is its damage, so it must not be pinned).
 */
export function variantMeta(name) {
    const p = parseName(name);
    return p && p.meta != null && hasSubtypes(p.name) ? p.meta : null;
}

/** How many of the named item the bot holds; a bare name counts every variant. */
export function countItem(bot, name) {
    let n = 0;
    for (const item of bot.inventory.items()) {
        if (itemMatches(item, name)) n += item.count;
    }
    return n;
}

/**
 * The block metadata values that count as the named variant, or null for any.
 * A placed block's meta also holds its state (a log's axis is bits 4 and 8), so
 * "log:1" matches spruce logs in every orientation (1, 5, 9) through
 * rotn-data's block translation; without one, the meta must match exactly.
 */
export function blockMetasFor(name) {
    const p = parseName(name);
    if (!p || p.meta == null) return null;
    const newName = toNew(p.name, p.meta);
    const states = newName ? blockToOld(newName).filter(s => botName(s.name) === p.name) : [];
    return new Set(states.length ? states.map(s => s.meta) : [p.meta]);
}

/**
 * One block predicate for a list of names, shared by every block search
 * (#131 review): "log" matches any log, "log:1" spruce logs in any
 * orientation, "dirt:0" plain dirt. Unknown names match nothing.
 * @returns {(block) => boolean} with .names, the bare block names it can match
 */
export function blockMatcher(names) {
    const wanted = new Map(); // bare name -> Set of metas, or null for any
    for (const n of Array.isArray(names) ? names : [names]) {
        const p = parseName(n);
        if (!p) continue;
        const metas = blockMetasFor(n);
        if (metas === null || wanted.get(p.name) === null) wanted.set(p.name, null);
        else wanted.set(p.name, new Set([...(wanted.get(p.name) ?? []), ...metas]));
    }
    const match = (block) => {
        if (!block?.name || !wanted.has(block.name)) return false;
        const metas = wanted.get(block.name);
        return metas === null || metas.has(block.metadata);
    };
    match.names = [...wanted.keys()];
    return match;
}

/** The canonical name of a placed block: a spruce log on its side ("log", 9) -> "log:1". */
export function blockDisplayName(block) {
    if (!block?.name) return null;
    if (!hasSubtypes(block.name)) return displayForm(block.name);
    const newName = blockToNew(block.name, block.metadata ?? 0);
    const old = newName ? blockToOld(newName).find(s => botName(s.name) === block.name) : null;
    return displayForm(formatName(block.name, old ? old.meta : (block.metadata ?? 0)));
}
