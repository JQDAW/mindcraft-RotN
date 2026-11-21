// A melee fight on this pack, in numbers (soak 7: a zombie with a chainmail helmet won a shelter fight; lead
// task, 2026-11-21). Pure functions over a RotnData catalog's 3.3.4/combat.json; no network, no game state.
//
// The bot's hit: attackDamage (1 + the held item's modifier, after Material Changer), then on the vanilla
// attack packet x (0.2 + 0.8 c^2) and only the excess over the target's lastDamage (Better Combat keeps the
// target inside its invulnerability window), then Damage Control x0.8, then armour, then Protection.
// Better Combat's own attack packet (channel bettercombat, discriminator 5) skips both the cooldown
// scaling and the invulnerability window.

/** The two ways the bot can send an attack. */
export const ATTACK_PATHS = ['bettercombat', 'vanilla'];

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

/**
 * A mob's fight numbers, or null when combat.json does not list it.
 * @returns {{name: string, maxHealth: number, armor: number, armorToughness: number, attackIntervalTicks?: number,
 *   reach?: number, bowIntervalTicks?: number, fuseTicks?: number, explosionRadius?: number, spawnArmor?: string,
 *   leaderBonus?: object, note?: string, confidence: string}|null}  (without evidence)
 */
export function combatOf(catalog, entityName) {
    const m = catalog.combatData?.mobs?.[entityName];
    if (!m) return null;
    const { evidence, ...facts } = m;
    return { name: entityName, ...structuredClone(facts) };
}

/**
 * A weapon's numbers on this pack ('hand' for an empty hand), or null when combat.json does not list it.
 * @returns {{item: string, attackDamage: number, attackSpeed: number, cooldownTicks: number, vanilla?: object,
 *   durability?: number, durabilityPerHit?: number, note?: string}|null}
 */
export function weaponStats(catalog, item = 'hand') {
    const w = catalog.combatData?.weapons?.[item || 'hand'];
    if (!w) return null;
    const { evidence, ...facts } = w;
    return { item: item || 'hand', ...structuredClone(facts) };
}

/** The armour points of worn items (unknown items count 0), from combat.json's armor.items. */
export function armorPoints(catalog, items = []) {
    const table = catalog.combatData?.armor?.items ?? {};
    return items.reduce((sum, it) => sum + (table[it] ?? 0), 0);
}

/** Vanilla CombatRules: the damage left after armour and toughness. */
export function afterArmor(damage, armor = 0, toughness = 0) {
    const reduction = clamp(armor - damage / (2 + toughness / 4), armor * 0.2, 20);
    return damage * (1 - reduction / 25);
}

/**
 * The health one bot hit takes off a target.
 * @param {import('./catalog.js').RotnData} catalog
 * @param {{weapon?: string, path?: 'bettercombat'|'vanilla', cooled?: number, armor?: number, toughness?: number,
 *   protection?: number, lastDamage?: number}} hit
 *   weapon: an item id or 'hand'; path: which attack packet; cooled: the vanilla cooldown fraction c (0..1, vanilla
 *   only); armor/toughness: the target's; protection: its Protection EPF; lastDamage: the raw amount of the hit the
 *   target last took (vanilla only: 0 for a mob nothing has hurt yet).
 * @returns {number|null} null for an unknown weapon.
 */
export function meleeHitDamage(catalog, { weapon = 'hand', path = 'bettercombat', cooled = 1, armor = 0, toughness = 0, protection = 0, lastDamage = 0 } = {}) {
    const w = weaponStats(catalog, weapon);
    if (!w) return null;
    if (!ATTACK_PATHS.includes(path)) throw new Error(`rotn-data: unknown attack path ${path}`);
    let amount = w.attackDamage;
    if (path === 'vanilla') {
        const c = clamp(cooled, 0, 1);
        amount *= 0.2 + 0.8 * c * c;
        amount = amount > lastDamage ? amount - lastDamage : 0;
    }
    amount *= catalog.combatData.playerAttack.damageModifier;
    amount = afterArmor(amount, armor, toughness);
    return amount * (1 - clamp(protection, 0, 20) / 25);
}

/**
 * How many bot hits a mob takes, and how long that is at the weapon's cooldown.
 * @param {{mob: string, weapon?: string, path?: 'bettercombat'|'vanilla', armorItems?: string[], health?: number,
 *   protection?: number}} fight armorItems: what the mob wears (e.g. ['minecraft:chainmail_helmet']);
 *   health: start health (default its maxHealth).
 * @returns {{hits: number, perHit: number, ticks: number, health: number, armor: number}|null} ticks: from the first
 *   hit to the last at the weapon's cooldown (Better Combat's client paces to it; the server does not check). hits is Infinity
 *   when the bot cannot kill it (the vanilla path: after the first hit, same-weapon hits deal nothing). null for an
 *   unknown mob or weapon.
 */
export function hitsToKill(catalog, { mob, weapon = 'hand', path = 'bettercombat', armorItems = [], health, protection = 0 } = {}) {
    const m = combatOf(catalog, mob);
    const w = weaponStats(catalog, weapon);
    if (!m || !w) return null;
    const hp = health ?? m.maxHealth;
    const armor = m.armor + armorPoints(catalog, armorItems);
    const opts = { weapon, armor, toughness: m.armorToughness ?? 0, protection };
    const perHit = meleeHitDamage(catalog, { ...opts, path });
    let hits;
    if (path === 'vanilla') {
        // A fresh mob takes the first hit in full; every later one at the same amount deals nothing.
        hits = perHit >= hp ? 1 : Infinity;
    } else {
        hits = perHit > 0 ? Math.ceil(hp / perHit - 1e-9) : Infinity;
    }
    const ticks = Number.isFinite(hits) ? Math.round((hits - 1) * w.cooldownTicks * 10) / 10 : Infinity;
    return { hits, perHit, ticks, health: hp, armor };
}
