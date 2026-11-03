// First-night threats (rotn-data Phase 3 PR 3, for skills-rotn's modes and the G3 first-night
// scenario): how to react to a mob (threatOf), and which hostile mobs a biome spawns at night
// (nightThreats). Pure functions over a RotnData catalog; no network, no game state.
//
// threatOf combines the entity facts (entity(): hostile = IMob or bytecode-cited player targeting,
// dangerous = entity-overrides.json) with the hand-written reactions in threat-reactions.json.
// Order, first match wins: dangerous -> 'avoid' (source 'override'); an 'entities' entry; a
// 'classRules' entry matching the dumped class's simple name, for hostile mobs (source: the rule's
// confidence, default 'inferred': the creeper variants keep distance and the skeleton variants take
// cover; the Special Mobs enderman and witch variants ignore unless provoked and take cover, also
// inferred: only their targeting AI is verified vanilla, and each variant's extra behaviour is
// returned as variantNote); then a
// default from the level (hostile -> fight, otherwise ignore; source 'default').
//
// Not reflected by threatOf: a mob's custom name. It can change behaviour: an Animania rabbit named
// "Killer" targets players (entity-overrides.json reviewedNotMarked, bytecode-cited), but threatOf
// takes the registry name only, so such a rabbit reads as level 'none'.
//
// nightThreats reads the dump's biome spawn lists, 'monster' category only, weighted like
// common-mobs.json. What it does not reflect is listed in NIGHT_THREATS_NOT_REFLECTED.

import { isOverworldBiome } from './biomes.js';

const DEFAULT_REACTION = { hostile: 'fight', none: 'ignore' };

/** Spawn-time rules nightThreats does not reflect (#111 review); it reads only the static lists. */
export const NIGHT_THREATS_NOT_REFLECTED = [
    'Special Mobs variants (specialmobs:*creeper, *skeleton, ...): they replace vanilla mobs as they spawn, so they are in no spawn list. threatOf still covers them (class rules).',
    'Light level: monsters spawn only in darkness (light 7 or less in 1.12), so a lit, sealed shelter changes what can spawn near the bot.',
    'Mob Stages: spawns gated by game stages are listed whether or not the stage is reached.',
    'Invasions and hordes: wave spawns on scheduled nights are not in the spawn lists.',
    "MultiMob's spawn lists: they carry no biome filter of their own (plains lists ghasts and wither skeletons) and apply their conditions at spawn time, so they are not read.",
];

/** The dumped class's simple name ("fathertoast.specialmobs.entity.creeper.EntityFireCreeper" -> "EntityFireCreeper"). */
const simpleClass = (cls) => (typeof cls === 'string' ? cls.slice(cls.lastIndexOf('.') + 1) : '');

function classRule(catalog, e) {
    const name = simpleClass(e.class);
    if (!name) return null;
    return (catalog.threatReactions?.classRules ?? []).find((r) => new RegExp(r.pattern).test(name) && !(r.notPattern && new RegExp(r.notPattern).test(name))) ?? null;
}

/**
 * How to react to a mob.
 * @param {import('./catalog.js').RotnData} catalog
 * @param {string} input entity registry name ("minecraft:zombie", "charm:spectre")
 * @returns {{name: string, displayName: string|null, level: 'dangerous'|'hostile'|'none',
 *   reaction: string, source: 'override'|'documented'|'vanilla'|'verified'|'inferred'|'default', rule?: string,
 *   variantNote?: string,
 *   summary: string|null, explodes: boolean, ranged: boolean, evidence: string[]}|null}
 *   null for an unknown entity
 */
export function threatOf(catalog, input) {
    const e = catalog.entity(input);
    if (!e) return null;
    const level = e.dangerous ? 'dangerous' : e.hostile ? 'hostile' : 'none';
    const overrideEvidence = e.threat?.evidence ? [e.threat.evidence] : [];
    const base = { name: e.name, displayName: e.displayName ?? null, level };
    // A dangerous mob is avoided whatever else applies (entity-overrides.json wins).
    if (level === 'dangerous') {
        return { ...base, reaction: 'avoid', source: 'override', summary: e.threat?.note ?? null, explodes: false, ranged: false, evidence: overrideEvidence };
    }
    const entry = catalog.threatReactions?.entities?.[e.name];
    const rule = !entry && level === 'hostile' ? classRule(catalog, e) : null;
    const r = entry ?? rule;
    const out = {
        ...base,
        reaction: r?.reaction ?? DEFAULT_REACTION[level],
        source: entry ? entry.confidence : rule ? (rule.confidence ?? 'inferred') : 'default',
        summary: r?.summary ?? null,
        explodes: !!r?.explodes,
        ranged: !!r?.ranged,
        evidence: [...(r?.evidence ?? []), ...overrideEvidence],
    };
    if (rule) out.rule = rule.id;
    if (rule?.note) out.note = rule.note;
    // What this variant does beyond the rule's reaction (#143 review: e.g. the thief enderman
    // teleports its target, the domination witch pulls its target in).
    if (rule?.variants?.[e.name]) out.variantNote = rule.variants[e.name];
    return out;
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
