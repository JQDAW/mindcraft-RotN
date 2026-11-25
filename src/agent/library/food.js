// What to eat in RotN (skills-rotn D1). mineflayer-auto-eat only knows the foods in
// bot.registry.foodsByName, one entry per item id (meta 0), so it cannot tell a pufferfish
// (fish:3) from a cod, and it would eat the bread first. The 'eating' mode (modes.js) chooses here.
//
// Food values are the pack's, from rotn-data (#209): foodValues(item, meta) applies Hunger
// Overhaul and the pack scripts (bread 3, cooked beef 2; P1 measured bread +3). Foods to avoid
// come from rotn-data's avoidFood(item, meta), plus the few it does not cover (LOCAL_AVOID).

import * as rotnData from '../../../packages/rotn-data/index.js';
import { logAte } from './survival_log.js';

/**
 * Eat at this food level or lower when idle. Soak 14 (F1, the lead): 12 ate every find at once (food 9 to 12),
 * so the bot held no food at any sunset and starved twice. 8 keeps food held for the night; Hunger Overhaul
 * heals only at food 7 or more (minHungerToHeal) and slows the bot at 4 or less (rotn-data).
 */
export const EAT_AT = 8;
/**
 * Soak 14 (F1): with no safe food held, the food reserve starts at this food level or lower (by day), as it
 * did at the old EAT_AT 12: the bot goes for food well before it eats.
 */
export const FOOD_SHORT_AT = 12;
/**
 * Soak 14 (net-forge, (D)): Hunger Overhaul gives real Mining Fatigue at low food (difficulty 2): food 4 I (x0.3),
 * 3 II (x0.09), 2 III, 1 or less IV: from this food level or lower a dig of anything harder than a crop is 11
 * times slower or more, up to impossible (dirt by hand 926 s at IV). No dig is planned here without eating first.
 */
export const DIG_WEAK_FOOD = 3;
export const digWeakText = (food) => `food ${food}: Hunger Overhaul's Mining Fatigue (${food <= 1 ? 'IV' : food === 2 ? 'III' : 'II'}) makes every dig 11 times slower or more; eat first`;
/** At this food level or lower the bot eats even during an action or a fight. */
export const EAT_NOW_AT = 6;
/**
 * Soak 2 (rotn-v0.1.4): on this pack food 0 is instant death (Hunger Overhaul damageOnStarve=200,
 * config/hungeroverhaul/HungerOverhaul.cfg), and at 4 or lower weakness, slowness and mining
 * slowdown set in. At this level or lower, with no other food, the EMERGENCY_FOODS below are eaten
 * too, least harm first (their poison or hunger effect does not kill), before the bot starves;
 * never the other avoided foods (#432 review 2).
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
const EMERGENCY_NAMES = {
    'minecraft:golden_apple': 'a golden apple', 'betteranimalsplus:venisonraw': 'raw venison', 'harvestcraft:venisonrawitem': 'raw venison',
    'twilightforest:raw_venison': 'raw venison', 'harvestcraft:rawtofenisonitem': 'raw tofenison', 'minecraft:chicken': 'raw chicken',
    'minecraft:rotten_flesh': 'rotten flesh', 'biomesoplenty:berries': 'hawthorn berries',
};
/** #432 nit: EMERGENCY_FOODS in words, in their order ("a golden apple, raw venison, ..., then hawthorn berries"), for prompts. */
export function emergencyFoodText() {
    const names = [...new Set(EMERGENCY_FOODS.map(id => EMERGENCY_NAMES[id] ?? id))];
    return `${names.slice(0, -1).join(', ')}, then ${names.at(-1)}`;
}
/** #432 nit: what is never eaten, emergency or not, in words. */
export const NEVER_EAT_TEXT = 'cloudsbluff, chorus fruit, pufferfish, raw eggs or any other food';
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

/**
 * Eaten only when nothing else is left. Soak 14 (F1, the lead): none now. Bread is a 4.2-point night food
 * (rotn-data), kept by the value order of chooseFood (least valuable first by day), not by name.
 */
export const LAST_RESORT_FOODS = [];

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
 * The stack to eat now, or null: any safe food, and the last-resort foods only when nothing else is left.
 * Soak 14 (F1, the lead): the least valuable first (hunger + saturation per item: forage and raw meat before
 * cooked meat and bread), so the best food is kept for the night; `largest` (food at EAT_NOW_AT or lower): the
 * most valuable first. `skip`: food keys given up on. `emergency` (food at EMERGENCY_FOOD or lower): when no
 * safe food is held, the EMERGENCY_FOODS too, least harm first.
 */
export function chooseFood(bot, { skip = new Set(), valueFn = foodValue, emergency = false, largest = false } = {}) {
    const edible = bot.inventory.items()
        .filter(item => !skip.has(foodKey(item)))
        .map(item => ({ item, food: valueFn(item) }))
        .filter(({ food }) => food);
    const safe = edible.filter(({ item }) => !isAvoided(item));
    const worth = (x) => x.food.hunger + x.food.saturation;
    const big = (a, b) => b.food.hunger - a.food.hunger || b.food.saturation - a.food.saturation;
    const rank = largest ? big : (a, b) => worth(a) - worth(b) || a.food.hunger - b.food.hunger;
    const normal = safe.filter(({ item }) => !LAST_RESORT_FOODS.includes(fullName(item))).sort(rank);
    if (normal.length > 0) return normal[0].item;
    if (safe.length > 0) return safe.sort(rank)[0].item;
    if (!emergency) return null;
    const harm = (x) => EMERGENCY_FOODS.indexOf(fullName(x.item));
    return edible.filter(x => harm(x) >= 0).sort((a, b) => harm(a) - harm(b) || big(a, b))[0]?.item ?? null;
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
/**
 * Soak 12 (A3): after a consume resolves, the food level and the item count get this long (polled every
 * step ms) to show the eat: the server sends them a tick after its "eating done" status. #592 review nit
 * 3: 300 ms (6 ticks) for a lagging server; a change that shows later still is counted by the eating mode
 * (a cut eat's food and count are kept: food.lateEat).
 */
export const EAT_SETTLE = { ms: 300, step: 25 };

/** #592 review nit 3: the count of a food key held now. */
export const heldCount = (bot, key) => countKey(bot, key);
/** #592 review nit 3: whether a cut eat ({key, before, had}) has shown since (the food or its count changed). */
export const lateEat = (bot, cut) => !!cut && (bot.food > cut.before || countKey(bot, cut.key) < cut.had);

export async function eatFood(bot, item, { checkMs = CONSUME_CHECK_MS, settleMs = EAT_SETTLE.ms, step = EAT_SETTLE.step } = {}) {
    const key = foodKey(item);
    const before = bot.food, had = countKey(bot, key);
    const changed = () => bot.food > before || countKey(bot, key) < had;
    let threw = null;
    const startedAt = Date.now();
    bot.rotnAteAt = startedAt; // soak 11 (F1): the scroll waits for an eat to be over
    try {
        await bot.equip(item, 'hand');
        await bot.consume();
    } catch (err) {
        threw = err;
        await new Promise(resolve => setTimeout(resolve, checkMs));
    }
    // Soak 12 (A3, death 1): mineflayer ends an eat as done on any change of the held item (and on a
    // cooldown packet), not only on the server's "eating done": 9 eats of raw mutton resolved about 0.5 s
    // apart at "food 12->12" while the zombie hit the bot, and the 2 mutton were still held. Only a food
    // level or item count change is an eat now, after a resolve as after a throw; a resolve with
    // neither is a cut eat (cut: true), never logged as eaten.
    for (let waited = 0; !threw && waited < settleMs && !changed(); waited += step) await new Promise(resolve => setTimeout(resolve, step));
    bot.rotnAteAt = Date.now();
    const ate = changed();
    // G4 #5: "[survival] ate <item> food <before>-><after>" once the food level has changed.
    if (ate) await logAte(bot, key, before);
    return { ate, threw, before, after: bot.food, ...(!ate && !threw ? { cut: true, ms: Date.now() - startedAt, key, had } : {}) };
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
export const FOOD_TARGET = { day: 12 };

/**
 * Soak 14 (F1, the lead): a night's food in points (hunger + saturation: the drain takes saturation first).
 * The #611 review measured soak 14's drain: sealed in the shelter 236 s a point (about 0.26/min: Hunger
 * Overhaul's constant drain; healing costs no food), active 80 to 90 s a point (about 0.7/min: walking,
 * sprinting, jumps). A sealed night of 26 min (the measured 40-min cycle) costs about 7; perMin 0.3 is the
 * rest rate with a margin. The bot should end the night at food 7 (Hunger Overhaul heals from 7).
 * need = floor + perMin x nightMin - (food + saturation), at least 0, at most cap.
 */
export const NIGHT_FOOD = { floor: 7, perMin: 0.3, nightMin: 26, cap: 16 };
export function nightFoodNeed({ food, saturation = 0 }) {
    if (!Number.isFinite(food)) return null;
    const have = food + (Number.isFinite(saturation) ? saturation : 0);
    const need = NIGHT_FOOD.floor + NIGHT_FOOD.perMin * NIGHT_FOOD.nightMin - have;
    return Math.round(Math.min(NIGHT_FOOD.cap, Math.max(0, need)) * 10) / 10;
}

/** Soak 14 (F1): the points (hunger + saturation) of the safe food held (never avoided food). */
export function heldFoodPoints(bot) {
    let total = 0;
    for (const item of bot?.inventory?.items?.() ?? []) {
        if (isAvoided(item)) continue;
        const f = foodValue(item);
        if (f) total += (f.hunger + f.saturation) * (item.count ?? 1);
    }
    return Math.round(total * 10) / 10;
}

/**
 * Soak 16 (F1, Fable verdict 5, the lead): food as a margin all day, not a 3-minute sunset run (food_floor and
 * ate_when_low failed in 12 of 14 soaks). By day the bot should hold the night's need as it will be at sunset plus
 * `margin` points: the bar at sunset is projected (drainPerMin a minute, between 0.3 at rest and 0.7 active, #611; the
 * saturation spent by then). The food job fills it to the reserve + `fill`, so it is not due again for every
 * piece eaten. An unknown time: the night's need at the bar now, + margin.
 */
export const DAY_FOOD = { margin: 4, drainPerMin: 0.5, fill: 2 };
export function dayFoodReserve({ food, minutesToSunset }) {
    if (!Number.isFinite(food)) return null;
    const atSunset = Number.isFinite(minutesToSunset) ? Math.max(0, food - DAY_FOOD.drainPerMin * Math.max(0, minutesToSunset)) : food;
    const need = nightFoodNeed({ food: atSunset, saturation: 0 });
    return Math.round(Math.min(NIGHT_FOOD.cap + DAY_FOOD.margin, need + DAY_FOOD.margin) * 10) / 10;
}

/**
 * The food target the bot is short of now, or null: never at night (minutesToSunset 0: the night routine's
 * own rules then); in the before-night window (0 < minutes <= reserveLeadMin) the night's need (soak 14 F1:
 * nightFoodNeed, in points, against `held`); by day (soak 16, F1) the day reserve (dayFoodReserve) at any time,
 * and FOOD_TARGET.day once the agenda is done (`finished`) or when food is at FOOD_SHORT_AT or lower and no safe
 * food is held, whichever is more. An unknown food level: null. `held`: the points of safe food held (heldFoodPoints).
 */
export function foodShortfall({ food, held, saturation = 0, minutesToSunset, finished = false, reserveLeadMin = 10 }) {
    if (!Number.isFinite(food)) return null;
    const m = Number.isFinite(minutesToSunset) ? minutesToSunset : Infinity;
    if (m <= 0) return null;
    if (m <= reserveLeadMin) { const need = nightFoodNeed({ food, saturation }); return need > 0 && held < need ? need : null; }
    const targets = [];
    const day = dayFoodReserve({ food, minutesToSunset });
    if (Number.isFinite(day) && held < day) targets.push(day);
    if (finished && held < FOOD_TARGET.day) targets.push(FOOD_TARGET.day);
    if (food <= FOOD_SHORT_AT && held <= 0) targets.push(FOOD_TARGET.day);
    return targets.length ? Math.max(...targets) : null;
}

