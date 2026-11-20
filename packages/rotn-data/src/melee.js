// How hard a mob hits and what a falling tree does (soak 5: a troll's 18-damage hit; G4 lead task,
// 2026-11-20). Pure functions over a RotnData catalog; no network, no game state.
//
// mobMelee reads 3.3.4/mob-melee.json: damage = the mob's ATTACK_DAMAGE with an empty hand after the
// pack's attribute changes, which is what a player takes per hit on this pack (difficulty normal)
// before armour, enchantments and potions. Each entry cites the bytecode or config line.
//
// fallingTree and fallingTreeDamage read 3.3.4/falling-trees.json (Dynamic Trees, in the pack as
// DramaticTrees-1.12.2-0.13.4.jar): a felled trunk hits each living entity it touches once.

/**
 * The conservative melee damage to assume for a mob whose hit is unknown (mobMelee returns null):
 * the worst hit in mob-melee.json (the Ice and Fire troll's 18). null means unknown, never zero:
 * a planner comparing health with a mob's damage uses UNKNOWN_MELEE for it.
 */
export const UNKNOWN_MELEE = 18;

/**
 * A mob's melee hit, or null when mob-melee.json has no entry for it: null means unknown (not read,
 * or no melee), never zero; assume UNKNOWN_MELEE.
 * @param {import('./catalog.js').RotnData} catalog
 * @param {string} entityName a registry name ("minecraft:zombie")
 * @returns {{name: string, damage: number, maxDamage: number, hitsToKill: number|null,
 *   reach?: number, intervalTicks?: number, onHit?: string, weapon?: string, note?: string,
 *   confidence: string, evidence: string[]}|null}
 *   maxDamage: with the strongest item it is given that was read (= damage when none);
 *   hitsToKill: hits that kill an unarmoured player at 20 health (null for a mob that does no damage).
 */
export function mobMelee(catalog, entityName) {
    const m = catalog.mobMeleeData?.mobs?.[entityName];
    if (!m) return null;
    const maxDamage = m.maxDamage ?? m.damage;
    return {
        name: entityName,
        ...structuredClone(m),
        maxDamage,
        hitsToKill: m.damage > 0 ? Math.ceil(20 / m.damage) : null,
    };
}

/** The falling-tree facts (falling-trees.json) without the evidence list, or null when the pack has none. */
export function fallingTree(catalog) {
    const t = catalog.fallingTreesData;
    if (!t) return null;
    const { evidence, description, format, pack, ...facts } = t;
    return structuredClone(facts);
}

/**
 * About how much a falling Dynamic Trees tree hits an entity for (before armour).
 * @param {import('./catalog.js').RotnData} catalog
 * @param {{woodVolume: number, massCenterHeight: number, angle?: number}} tree
 *   woodVolume: the falling wood in full-log blocks (a branch of radius r counts r^2/64, a full log 1);
 *   massCenterHeight: blocks above the cut; angle: degrees the tree has fallen when it reaches the
 *   entity (default 90: the ground, the worst case)
 * @returns {number} 0 when trees do not hurt on this pack or the hit is below the 2 threshold.
 *   The fall speed (degrees a tick) grows by 0.1 / massCenterHeight a tick from 0, so after
 *   `angle` degrees it is about sqrt(2 x 0.1 / massCenterHeight x angle): a continuous estimate of the
 *   per-tick sum, a little high.
 */
export function fallingTreeDamage(catalog, { woodVolume, massCenterHeight, angle = 90 } = {}) {
    const t = catalog.fallingTreesData;
    if (!t?.enabled || !(woodVolume > 0) || !(massCenterHeight > 0)) return 0;
    const speed = Math.sqrt((2 * 0.1 * Math.min(Math.max(angle, 0), 90)) / massCenterHeight);
    const raw = woodVolume * speed * 3;
    return raw > 2 ? Math.round(raw * t.multiplier * 10) / 10 : 0;
}
