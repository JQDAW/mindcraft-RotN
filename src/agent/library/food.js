// What to eat in RotN (skills-rotn D1). mineflayer-auto-eat only knows the vanilla foods in
// bot.registry.foodsByName, so it cannot see RotN's foods (rustic berries, ginseng, ...), and it
// would eat the bread first (the most food points). Which foods to avoid is not in the dump, so the
// list below cites docs/research/rotn-progression.md (hazard table and first-day script).
//
// Food values (#206 review 1): the pack's scripts/food.zs changes hunger on about 300 foods (bread
// gives 3, not 5; P1 measured +3). The dump's `variants[].food` holds the vanilla values. Until
// rotn-data exposes the pack's values (requested: `foodOf(name, meta)`), the ranking falls back to
// the dump and says so once. The rules that keep the bot safe (the avoid list, bread last, the
// food levels) do not depend on the values.

import * as rotnData from '../../../packages/rotn-data/index.js';

/** Eat at this food level or lower ("Eat at food 12 or lower; starving is instant death"). */
export const EAT_AT = 12;
/** At this food level or lower the bot eats even during an action or a fight. */
export const EAT_NOW_AT = 6;
/** An eat that throws (mineflayer's 2500 ms consume timeout) is judged this long after. */
export const CONSUME_CHECK_MS = 1000;

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

const fullName = (item) => { try { return rotnData.registryName(item.name); } catch { return null; } };
const metaOf = (item) => (Number.isInteger(item.metadata) ? item.metadata : 0);
/** A food's key, for counting and for the foods given up on: "rustic:wildberries:0". */
export const foodKey = (item) => `${fullName(item) ?? item.name}:${metaOf(item)}`;

let warnedVanilla = false;

/**
 * {hunger, saturation, source} of an inventory stack, or null when it is no food. source is
 * 'pack' (rotn-data's foodOf, the food.zs values) or 'dump' (vanilla values, a fallback).
 */
export function foodValue(item) {
    const name = fullName(item);
    if (!name) return null;
    const meta = metaOf(item);
    if (typeof rotnData.foodOf === 'function') {
        let f = null;
        try { f = rotnData.foodOf(name, meta); } catch { f = null; }
        return f && Number(f.hunger) > 0 ? { hunger: Number(f.hunger), saturation: Number(f.saturation) || 0, source: 'pack' } : null;
    }
    let entry = null;
    try { entry = rotnData.getItem(name); } catch { return null; }
    const variants = Array.isArray(entry?.variants) ? entry.variants : [];
    const v = variants.find(x => x.meta === meta) ?? (entry?.hasSubtypes ? null : variants[0]);
    const food = v?.food;
    if (!food || !(Number(food.hunger) > 0)) return null;
    if (!warnedVanilla) {
        warnedVanilla = true;
        console.warn('[food] rotn-data has no pack food values yet (foodOf); ranking foods by the dump\'s vanilla values');
    }
    return { hunger: Number(food.hunger), saturation: Number(food.saturation) || 0, source: 'dump' };
}

export function isAvoided(item) {
    const name = fullName(item);
    return AVOID_FOODS.some(f => f.name === name && (f.meta === null || f.meta === metaOf(item)));
}

/**
 * The stack to eat now, or null: any safe food, the most hunger first (then saturation), and the
 * last-resort foods only when nothing else is left. `skip`: food keys given up on.
 */
export function chooseFood(bot, { skip = new Set(), valueFn = foodValue } = {}) {
    const safe = bot.inventory.items()
        .filter(item => !skip.has(foodKey(item)) && !isAvoided(item))
        .map(item => ({ item, food: valueFn(item) }))
        .filter(({ food }) => food);
    const rank = (a, b) => b.food.hunger - a.food.hunger || b.food.saturation - a.food.saturation;
    const normal = safe.filter(({ item }) => !LAST_RESORT_FOODS.includes(fullName(item))).sort(rank);
    if (normal.length > 0) return normal[0].item;
    return safe.sort(rank)[0]?.item ?? null;
}

/**
 * Whether to eat now. At EAT_NOW_AT or lower always, a fight included (#206 review 4); at EAT_AT
 * or lower only when idle and no threat is near.
 */
export function wantsToEat(food, { idle = false, threatened = false } = {}) {
    if (!Number.isFinite(food)) return false;
    return food <= EAT_NOW_AT || (idle && !threatened && food <= EAT_AT);
}

const countKey = (bot, key) => bot.inventory.items().filter(i => foodKey(i) === key).reduce((n, i) => n + i.count, 0);

/**
 * Eat one item of `item`. A consume that throws (mineflayer gives up after 2500 ms, also when the
 * server did let the bot eat) is unknown, not a failure (net-forge's E1 rule, #206 review 2): after
 * CONSUME_CHECK_MS the food level and the item count decide.
 * @returns {Promise<{ate: boolean, threw: Error|null, before: number, after: number}>}
 */
export async function eatFood(bot, item, { checkMs = CONSUME_CHECK_MS } = {}) {
    const key = foodKey(item);
    const before = bot.food, had = countKey(bot, key);
    let threw = null;
    try {
        await bot.equip(item, 'hand');
        await bot.consume();
    } catch (err) {
        threw = err;
        await new Promise(resolve => setTimeout(resolve, checkMs));
    }
    // A consume that resolved has eaten; after a throw the food level or the item count tells.
    const ate = !threw || bot.food > before || countKey(bot, key) < had;
    return { ate, threw, before, after: bot.food };
}
