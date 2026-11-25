// Weapon sweeps on the pack (3.3.4/weapon-sweep.json, hand-written from Better Combat's and vanilla's bytecode and
// config/bettercombat.cfg): whether a player's melee hit with a held item also hits the mobs next to the struck one,
// and how far from the struck mob that reaches.
import { registryName } from './names.js';

/** Better Combat's sweep radius in blocks for a sweep level (0 when the level is below 1): 1 + width + 0.25 x (level - 1). */
export function sweepRadius(level, attackerWidth = 0.6) {
    if (!Number.isFinite(level) || level < 1) return 0;
    return Math.round((1 + attackerWidth + 0.25 * (level - 1)) * 1e6) / 1e6;
}

const isHand = (item) => item == null || item === '' || item === 'hand' || item === 'air' || item === 'minecraft:air';

/**
 * Whether a held item sweeps, and how far.
 * @param {import('./catalog.js').RotnData} catalog
 * @param {string|{name: string}|null} item a registry name ('minecraft:iron_sword'), a bare vanilla path ('iron_sword'),
 *   a bot.registry entry or held stack ({name}), or 'hand' / null for an empty hand
 * @param {{path?: 'bettercombat'|'vanilla', enchantment?: number, potion?: number, attackerWidth?: number}} [opts]
 *   path: the attack packet (Better Combat's, the bot's normal one; or the vanilla use_entity fallback);
 *   enchantment: the item's Sweeping level; potion: the attacker's wards:effect_sweeping level (amplifier + 1);
 *   attackerWidth: 0.6 for a player
 * @returns {object|null} bettercombat: { item, path, weapon, entry, level, sweeps, radius, alsoWithinReach: true };
 *   vanilla: { item, path, weapon, sweeps, boxGrow, maxPlayerDistance }. On both paths `weapon` is whether Better
 *   Combat treats the item as a weapon (weapons.json bcWeapon). An item weapons.json does not list (any held item that
 *   is not a melee tool or weapon, or a name this pack does not have) is unknown: weapon, entry, level, sweeps and
 *   radius are null (#621 review 2), so a caller can treat it as "may sweep" rather than "does not". The empty hand is
 *   known (weapon false). null when the data file is missing.
 */
export function weaponSweep(catalog, item = 'hand', { path = 'bettercombat', enchantment = 0, potion = 0, attackerWidth } = {}) {
    const data = catalog.weaponSweepData;
    if (!data) return null;
    if (path !== 'bettercombat' && path !== 'vanilla') throw new Error(`rotn-data: unknown attack path ${path}`);
    const raw = typeof item === 'object' && item !== null ? item.name : item;
    const name = isHand(raw) ? 'hand' : registryName(raw);
    const w = name === 'hand' ? null : catalog.weaponsData?.items?.[name] ?? null;
    const unknown = name !== 'hand' && !w;
    const width = attackerWidth ?? data.betterCombat.attackerWidth;
    const weapon = unknown ? null : !!w?.bcWeapon;

    if (path === 'vanilla') {
        const sweeps = unknown ? null : !!w && w.base === data.vanillaFallback.itemBase;
        return {
            item: name, path, weapon, sweeps,
            boxGrow: sweeps ? { ...data.vanillaFallback.boxGrow } : null,
            maxPlayerDistance: sweeps ? data.vanillaFallback.maxPlayerDistance : null,
        };
    }
    if (unknown) return { item: name, path, weapon: null, entry: null, level: null, sweeps: null, radius: null, alsoWithinReach: true };

    const itemPath = name === 'hand' ? '' : name.slice(name.indexOf(':') + 1);
    const entry = weapon ? data.betterCombat.entries.find((e) => itemPath.includes(e.substring)) ?? null : null;
    const level = (entry?.sweep ?? 0) + Math.max(0, potion | 0) + Math.max(0, enchantment | 0);
    return {
        item: name, path, weapon,
        entry: entry ? { ...entry } : null,
        level,
        sweeps: level >= 1,
        radius: sweepRadius(level, width),
        alsoWithinReach: true,
    };
}
