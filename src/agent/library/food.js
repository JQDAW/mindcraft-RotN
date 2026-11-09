// What to eat in RotN (skills-rotn D1). mineflayer-auto-eat only knows the foods in
// bot.registry.foodsByName, one entry per item id (meta 0), so it cannot tell a pufferfish
// (fish:3) from a cod, and it would eat the bread first. The 'eating' mode (modes.js) chooses here.
//
// Food values are the pack's, from rotn-data (#209): foodValues(item, meta) applies Hunger
// Overhaul and the pack scripts (bread 3, cooked beef 2; P1 measured bread +3). Foods to avoid
// come from rotn-data's avoidFood(item, meta), plus the few it does not cover (LOCAL_AVOID).

import * as rotnData from '../../../packages/rotn-data/index.js';
import { logAte } from './survival_log.js';

/** Eat at this food level or lower ("Eat at food 12 or lower; starving is instant death"). */
export const EAT_AT = 12;
/** At this food level or lower the bot eats even during an action or a fight. */
export const EAT_NOW_AT = 6;
/**
 * Soak 2 (rotn-v0.1.4): on this pack food 0 is instant death (Hunger Overhaul damageOnStarve=200,
 * config/hungeroverhaul/HungerOverhaul.cfg), and at 4 or lower weakness, slowness and mining
 * slowdown set in. At this level or lower anything edible is eaten, avoided food too (its poison or
 * hunger effect does not kill), before the bot starves.
 */
export const EMERGENCY_FOOD = 5;
/**
 * #432 review 2: the avoided foods an emergency may eat, least harm first (then the most hunger):
 * a golden apple (kept, but harmless), raw venison (hunger 5 s, 75%), raw chicken (hunger 30 s, 30%),
 * rotten flesh (hunger 30 s, 80%), hawthorn berries (poison). Never cloudsbluff (levitation), nor
 * pufferfish, raw egg, inventory food or the other poisons; never chorus fruit (it teleports).
 */
export const EMERGENCY_FOODS = ['minecraft:golden_apple', 'betteranimalsplus:venisonraw', 'harvestcraft:venisonrawitem', 'twilightforest:raw_venison',
    'harvestcraft:rawtofenisonitem', 'minecraft:chicken', 'minecraft:rotten_flesh', 'biomesoplenty:berries'];
/** 1.12: health regenerates only at this food level or higher (CX23 soak: eat between fights). */
export const REGEN_FOOD = 18;
/** An eat that throws (mineflayer's 2500 ms consume timeout) is judged this long after. */
export const CONSUME_CHECK_MS = 1000;

/**
 * Never eaten, on top of rotn-data's avoidFood. Hawthorn berries (`biomesoplenty:berries`): the
 * thorns are poisonous (rotn-progression.md hazard table). Chorus fruit teleports the bot at
 * random, and golden apples are kept (both banned by mineflayer-auto-eat's defaults).
 * `meta` null means every variant.
 */
export const LOCAL_AVOID = [
    { name: 'biomesoplenty:berries', meta: null, why: 'hawthorn: the thorns are poisonous (rotn-progression.md)' },
    { name: 'minecraft:chorus_fruit', meta: null, why: 'teleports at random' },
    { name: 'minecraft:golden_apple', meta: null, why: 'kept, not eaten as food' },
];

/** Eaten only when nothing else is left: "Keep the starting bread as a last resort". */
export const LAST_RESORT_FOODS = ['minecraft:bread'];

const fullName = (item) => { try { return rotnData.registryName(item.name); } catch { return null; } };
const metaOf = (item) => (Number.isInteger(item.metadata) ? item.metadata : 0);
/** A food's key, for counting and for the foods given up on: "rustic:wildberries:0". */
export const foodKey = (item) => `${fullName(item) ?? item.name}:${metaOf(item)}`;

/**
 * {hunger, saturation, source} of an inventory stack on this pack, or null when it is no food.
 * source is rotn-data's ('crafttweaker', 'hungeroverhaul-table', 'hungeroverhaul-rule'). For a food
 * whose value rotn-data could not compute ('not-computed': HarvestCraft and Biomes O' Plenty foods
 * no script sets), the vanilla value with Hunger Overhaul's rule (hunger / 2, at least 1) is an
 * estimate, marked 'estimate', so the food still counts but ranks low.
 */
export function foodValue(item) {
    const name = fullName(item);
    if (!name) return null;
    let f = null;
    try { f = rotnData.foodValues(name, metaOf(item)); } catch { f = null; }
    if (!f) return null;
    if (Number(f.hunger) > 0) return { hunger: Number(f.hunger), saturation: Number(f.saturation) || 0, source: f.source };
    const vanilla = Number(f.vanilla?.hunger);
    if (f.source === 'not-computed' && vanilla > 0) return { hunger: Math.max(1, Math.round(vanilla / 2)), saturation: 0, source: 'estimate' };
    return null;
}

/** Why a stack must not be eaten (rotn-data's avoidFood, or LOCAL_AVOID), or null. */
export function avoidReason(item) {
    const name = fullName(item);
    if (!name) return null;
    const local = LOCAL_AVOID.find(f => f.name === name && (f.meta === null || f.meta === metaOf(item)));
    if (local) return local.why;
    let a = null;
    try { a = rotnData.avoidFood(name, metaOf(item)); } catch { a = null; }
    if (!a) return null;
    const effects = (a.effects ?? []).map(e => e.effect).filter(Boolean);
    return effects.length ? effects.join(', ') : (a.note ?? 'harmful');
}

export const isAvoided = (item) => avoidReason(item) !== null;

/**
 * mineflayer-auto-eat's bannedFood (bot item names). It matches by name only, so a food that is
 * harmful at any meta is banned by name: all of `fish`, as a pufferfish (fish:3) and a cod share
 * the name. The 'eating' mode eats by meta and still eats cod.
 */
export function autoEatBannedFood() {
    const names = new Set(LOCAL_AVOID.map(f => f.name));
    let avoid = {};
    try { avoid = rotnData.loadRotnData(rotnData.PACK_VERSION).foodData?.avoid ?? {}; } catch { avoid = {}; }
    for (const name of Object.keys(avoid)) names.add(name);
    return [...names].map(n => { try { return rotnData.botName(n); } catch { return n; } }).sort();
}

/**
 * The stack to eat now, or null: any safe food, the most hunger first (then saturation), and the
 * last-resort foods only when nothing else is left. `skip`: food keys given up on. `emergency`
 * (food at EMERGENCY_FOOD or lower): when no safe food is held, the EMERGENCY_FOODS too, least
 * harm first.
 */
export function chooseFood(bot, { skip = new Set(), valueFn = foodValue, emergency = false } = {}) {
    const edible = bot.inventory.items()
        .filter(item => !skip.has(foodKey(item)))
        .map(item => ({ item, food: valueFn(item) }))
        .filter(({ food }) => food);
    const safe = edible.filter(({ item }) => !isAvoided(item));
    const rank = (a, b) => b.food.hunger - a.food.hunger || b.food.saturation - a.food.saturation;
    const normal = safe.filter(({ item }) => !LAST_RESORT_FOODS.includes(fullName(item))).sort(rank);
    if (normal.length > 0) return normal[0].item;
    if (safe.length > 0) return safe.sort(rank)[0].item;
    if (!emergency) return null;
    const harm = (x) => EMERGENCY_FOODS.indexOf(fullName(x.item));
    return edible.filter(x => harm(x) >= 0).sort((a, b) => harm(a) - harm(b) || rank(a, b))[0]?.item ?? null;
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
    // G4 #5: "[survival] ate <item> food <before>-><after>" once the food level has changed.
    if (ate) await logAte(bot, key, before);
    return { ate, threw, before, after: bot.food };
}

/**
 * CX23 soak: hurt with food below REGEN_FOOD (no regeneration), eat the chosen food once, e.g.
 * between two fights in the night shelter. Returns eatFood's result, or null when there is no need
 * or no safe food.
 */
export async function eatToHeal(bot, { checkMs = CONSUME_CHECK_MS } = {}) {
    if (!(bot?.health < 20) || !(bot?.food < REGEN_FOOD)) return null;
    const item = chooseFood(bot);
    if (!item) return null;
    return await eatFood(bot, item, { checkMs });
}

/**
 * G4 #5 (CX23 soak m1: food fell to 1; after the deaths nothing to eat, and nothing got food once
 * the agenda was done). On this pack hunger falls about 1 every 4 min even idle (the soak's third
 * night: 10 to 1 in 35 min), early foods give 1 to 3, and starving kills. The hunger value of safe
 * food the bot should hold (lead decision): by day after the agenda is done, before night (the
 * shelter reserve's window), and at dusk (the night routine's check).
 */
export const FOOD_TARGET = { day: 12, night: 8, dusk: 6 };

/** The hunger value of the safe food held (never avoided food; bread counts). */
export function heldFoodHunger(bot) {
    let total = 0;
    for (const item of bot?.inventory?.items?.() ?? []) {
        if (isAvoided(item)) continue;
        const f = foodValue(item);
        if (f) total += f.hunger * (item.count ?? 1);
    }
    return total;
}

/**
 * The food target the bot is short of now, or null: never at night (minutesToSunset 0: the bot
 * stays sealed, never out for food); FOOD_TARGET.night in the before-night window (0 < minutes <=
 * reserveLeadMin); FOOD_TARGET.day by day once the agenda is done (`finished`); and at any time but
 * night when food is at EAT_AT or lower and no safe food is held. An unknown food level: null.
 */
export function foodShortfall({ food, held, minutesToSunset, finished = false, reserveLeadMin = 10 }) {
    if (!Number.isFinite(food)) return null;
    const m = Number.isFinite(minutesToSunset) ? minutesToSunset : Infinity;
    if (m <= 0) return null;
    if (m <= reserveLeadMin) return held < FOOD_TARGET.night ? FOOD_TARGET.night : null;
    if (finished && held < FOOD_TARGET.day) return FOOD_TARGET.day;
    if (food <= EAT_AT && held <= 0) return FOOD_TARGET.day;
    return null;
}

