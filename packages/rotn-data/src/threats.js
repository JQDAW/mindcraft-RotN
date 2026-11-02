// First-night threats (rotn-data Phase 3 PR 3, for skills-rotn's modes and the G3 first-night
// scenario): how to react to a mob (threatOf), and which hostile mobs a biome spawns at night
// (nightThreats). Pure functions over a RotnData catalog; no network, no game state.
//
// threatOf combines the entity facts (entity(): hostile = IMob or bytecode-cited player targeting,
// dangerous = entity-overrides.json) with the hand-written reactions in threat-reactions.json.
// nightThreats reads the dump's biome spawn lists, 'monster' category only, weighted like
// common-mobs.json. Not reflected: spawn-time rules (light level, Mob Stages, invasions) and
// MultiMob's lists, which carry no biome filter of their own (plains lists ghasts and wither
// skeletons) and apply their conditions at spawn time.

import { isOverworldBiome } from './biomes.js';

const DEFAULT_REACTION = { dangerous: 'avoid', hostile: 'fight', none: 'ignore' };

/**
 * How to react to a mob.
 * @param {import('./catalog.js').RotnData} catalog
 * @param {string} input entity registry name ("minecraft:zombie", "charm:spectre")
 * @returns {{name: string, displayName: string|null, level: 'dangerous'|'hostile'|'none',
 *   reaction: string, source: 'documented'|'vanilla'|'default', summary: string|null,
 *   explodes: boolean, ranged: boolean, evidence: string[]}|null} null for an unknown entity
 */
export function threatOf(catalog, input) {
    const e = catalog.entity(input);
    if (!e) return null;
    const level = e.dangerous ? 'dangerous' : e.hostile ? 'hostile' : 'none';
    const r = catalog.threatReactions?.entities?.[e.name];
    // A dangerous mob is avoided whatever a reaction entry says (entity-overrides.json wins).
    const reaction = level === 'dangerous' ? 'avoid' : (r?.reaction ?? DEFAULT_REACTION[level]);
    return {
        name: e.name,
        displayName: e.displayName ?? null,
        level,
        reaction,
        source: r && level !== 'dangerous' ? r.confidence : 'default',
        summary: r?.summary ?? null,
        explodes: !!r?.explodes,
        ranged: !!r?.ranged,
        evidence: [...(r?.evidence ?? []), ...(e.threat?.evidence ? [e.threat.evidence] : [])],
    };
}

/**
 * Hostile and dangerous mobs a biome spawns at night (its 'monster' spawn list), most likely first.
 * @param {import('./catalog.js').RotnData} catalog
 * @param {{biome?: string|string[], limit?: number}} [opts] a biome registry name ("minecraft:plains")
 *        or several; default: every overworld biome (src/biomes.js, as common-mobs.json)
 * @returns {Array<{name, displayName, level, reaction, explodes, ranged, share: number, biomes: number}>}
 *        share = the mob's spawn weight / all listed monsters' weight over the biomes (0-1)
 */
export function nightThreats(catalog, { biome, limit = 20 } = {}) {
    const spawns = catalog.dump.spawns?.biomes ?? {};
    const wanted = biome == null ? Object.keys(spawns).filter(isOverworldBiome) : [].concat(biome);
    const weight = new Map();
    const where = new Map();
    for (const b of wanted) {
        for (const s of spawns[b]?.monster ?? []) {
            if (!s.entity || !(s.weight > 0)) continue;
            weight.set(s.entity, (weight.get(s.entity) ?? 0) + s.weight);
            where.set(s.entity, (where.get(s.entity) ?? 0) + 1);
        }
    }
    const rows = [];
    for (const [name, w] of weight) {
        const t = threatOf(catalog, name);
        if (!t || t.level === 'none') continue;
        rows.push({ name, displayName: t.displayName, level: t.level, reaction: t.reaction, explodes: t.explodes, ranged: t.ranged, weight: w, biomes: where.get(name) });
    }
    const total = rows.reduce((a, r) => a + r.weight, 0);
    return rows
        .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
        .slice(0, limit)
        .map(({ weight: w, ...r }) => ({ ...r, share: total ? Math.round((w / total) * 1000) / 1000 : 0 }));
}
