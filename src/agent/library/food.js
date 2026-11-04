// What to eat in RotN (skills-rotn D1). mineflayer-auto-eat only knows the vanilla foods in
// bot.registry.foodsByName, so it cannot see RotN's foods (rustic berries, ginseng, ...), and it
// would eat the bread first (the most food points). Food values come from rotn-data's dump
// (items' `variants[].food`); which foods to avoid is not in the dump, so the list below cites
// docs/research/rotn-progression.md (hazard table and first-day script).

import { getItem, registryName } from '../../../packages/rotn-data/index.js';

/** Eat at this food level or lower ("Eat at food 12 or lower; starving is instant death"). */
export const EAT_AT = 12;
/** At this food level or lower the bot eats even in the middle of an action. */
export const EAT_NOW_AT = 6;

/**
 * Never eaten. RotN: hawthorn berries (`biomesoplenty:berries`, poisonous) and cloudsbluff (makes
 * you float upward), rotn-progression.md hazard table. Vanilla, as mineflayer-auto-eat bans them:
 * pufferfish (1.12 `fish:3`), spider eye, poisonous potato, rotten flesh, chorus fruit, raw
 * chicken, golden apples. `meta` null means every variant.
 */
export const AVOID_FOODS = [
    { name: 'biomesoplenty:berries', meta: null },
    { name: 'rustic:cloudsbluff', meta: null },
    { name: 'minecraft:fish', meta: 3 },
    { name: 'minecraft:spider_eye', meta: null },
    { name: 'minecraft:poisonous_potato', meta: null },
    { name: 'minecraft:rotten_flesh', meta: null },
    { name: 'minecraft:chorus_fruit', meta: null },
    { name: 'minecraft:chicken', meta: null },
    { name: 'minecraft:golden_apple', meta: null },
];

/** Eaten only when nothing else is left: "Keep the starting bread as a last resort". */
export const LAST_RESORT_FOODS = ['minecraft:bread'];

const fullName = (item) => { try { return registryName(item.name); } catch { return null; } };

/** {hunger, saturation} of an inventory stack by rotn-data's dump, or null when it is no food. */
export function foodValue(item) {
    const name = fullName(item);
    if (!name) return null;
    let entry = null;
    try { entry = getItem(name); } catch { return null; }
    const variants = Array.isArray(entry?.variants) ? entry.variants : [];
    const meta = Number.isInteger(item.metadata) ? item.metadata : 0;
    const v = variants.find(x => x.meta === meta) ?? (entry?.hasSubtypes ? null : variants[0]);
    const food = v?.food;
    return food && Number(food.hunger) > 0 ? { hunger: Number(food.hunger), saturation: Number(food.saturation) || 0 } : null;
}

export function isAvoided(item) {
    const name = fullName(item);
    return AVOID_FOODS.some(f => f.name === name && (f.meta === null || f.meta === (item.metadata ?? 0)));
}

/**
 * The stack to eat now, or null: any safe food from the dump, the most hunger first (then
 * saturation), and the last-resort foods only when nothing else is left.
 */
export function chooseFood(bot) {
    const safe = bot.inventory.items()
        .map(item => ({ item, food: foodValue(item) }))
        .filter(({ item, food }) => food && !isAvoided(item));
    const rank = (a, b) => b.food.hunger - a.food.hunger || b.food.saturation - a.food.saturation;
    const normal = safe.filter(({ item }) => !LAST_RESORT_FOODS.includes(fullName(item))).sort(rank);
    if (normal.length > 0) return normal[0].item;
    return safe.sort(rank)[0]?.item ?? null;
}

/** Whether to eat now: at EAT_AT or lower when idle, at EAT_NOW_AT or lower in any case. */
export function wantsToEat(food, idle) {
    if (!Number.isFinite(food)) return false;
    return food <= EAT_NOW_AT || (idle && food <= EAT_AT);
}

/** Eat one item of the chosen food. Returns the item eaten, or null. */
export async function eatFood(bot) {
    const item = chooseFood(bot);
    if (!item) return null;
    await bot.equip(item, 'hand');
    await bot.consume();
    return item;
}
