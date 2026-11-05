// Food values on the pack (3.3.4/food-values.json, tools/build-food-values.mjs) in the shape
// mineflayer and mineflayer-auto-eat read from minecraft-data: registry.foods / foodsByName /
// foodsArray ({ id, name, displayName, stackSize, foodPoints, saturation, effectiveQuality,
// saturationRatio }). minecraft-data's 1.12.2 table has vanilla values; this pack's differ.
import { registryName } from './names.js';

/** One minecraft-data food entry from a food-values.json entry (meta 0) and a registry item. */
export function toRegistryFood(item, fv) {
    const saturation = fv.saturation;
    return {
        id: item.id, name: item.name, displayName: item.displayName, stackSize: item.stackSize,
        foodPoints: fv.hunger, saturation,
        effectiveQuality: fv.hunger + saturation,
        saturationRatio: fv.hunger > 0 ? saturation / fv.hunger : 0,
    };
}

/**
 * Replace registry.foods, foodsByName and foodsArray, in place, with the pack's values for every
 * registry item that has computed food values (meta 0; the registry has one entry per item id).
 * Items with no computed value (food-values.json notComputed) are left out rather than given
 * vanilla values. Returns { installed, left: [names of the old table's foods not installed] }.
 *
 * It does NOT ban anything (#209 review): harmful foods (rotten flesh, spider eye, ...) are
 * installed like any other, and the table has one entry per item id at meta 0, so the pufferfish
 * (minecraft:fish meta 3, Poison IV) shares the cod's entry and looks like cod. The eating code
 * must check avoidFood(name, meta) on the actual stack before eating, and set mineflayer-auto-eat's
 * bannedFood from avoidFood. bannedFood is per item name, so it cannot ban fish meta 3 without
 * banning every fish: a pufferfish needs the meta-aware check.
 * @param {object} registry bot.registry (minecraft-data shape, after forge-bridge's extendRegistry)
 * @param {(name: string, meta: number) => object|null} foodValues the catalog's foodValues
 */
export function installFoods(registry, foodValues) {
    const before = Object.values(registry.foods ?? {}).map((f) => f.name);
    const next = [];
    for (const item of registry.itemsArray ?? Object.values(registry.items ?? {})) {
        const fv = foodValues(registryName(item.name), 0);
        if (fv && fv.hunger != null) next.push(toRegistryFood(item, fv));
    }
    for (const k of Object.keys(registry.foods ?? {})) delete registry.foods[k];
    for (const k of Object.keys(registry.foodsByName ?? {})) delete registry.foodsByName[k];
    registry.foods ??= {};
    registry.foodsByName ??= {};
    if (Array.isArray(registry.foodsArray)) registry.foodsArray.length = 0; else registry.foodsArray = [];
    for (const f of next) { registry.foods[f.id] = f; registry.foodsByName[f.name] = f; registry.foodsArray.push(f); }
    const have = new Set(next.map((f) => f.name));
    return { installed: next.length, left: before.filter((n) => !have.has(n)) };
}
