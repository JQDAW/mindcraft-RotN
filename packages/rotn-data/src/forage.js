// Wild food blocks (lead task G4 #5 food, 2026-11-08): how a player harvests Rustic wildberry bushes,
// BoP berry bushes (the pack's "hawthorn"), wild Rustic herbs, HarvestCraft gardens and mushrooms,
// what each gives, and the plant hazards next to them. From 3.3.4/forage-food.json, which cites the
// jars' bytecode and the pack's scripts and configs. Pure functions over a RotnData catalog; food values
// come from foodValues / avoidFood (food-values.json), not from forage-food.json.

/** Expected count of each item from one block-state's break rule ({ forced, pickOne, rolls, fromList }). */
function expectedDrops(rule) {
    const out = new Map();
    const add = (s, mean, max) => {
        const k = `${s.name}:${s.meta ?? 0}`;
        const e = out.get(k) ?? { name: s.name, meta: s.meta ?? 0, mean: 0, max: 0 };
        e.mean += mean;
        e.max += max;
        out.set(k, e);
    };
    for (const s of rule.forced ?? []) add(s, s.count, s.count);
    if (rule.pickOne?.length) {
        const total = rule.pickOne.reduce((n, p) => n + p.weight, 0);
        const best = new Map();
        for (const p of rule.pickOne) {
            for (const s of p.items) {
                add(s, (s.count * p.weight) / total, 0);
                const k = `${s.name}:${s.meta ?? 0}`;
                best.set(k, Math.max(best.get(k) ?? 0, s.count));
            }
        }
        for (const [k, c] of best) out.get(k).max += c;
    }
    for (const r of rule.rolls ?? []) add(r.item, r.item.count * r.times * r.chance, r.item.count * r.times);
    if (rule.fromList) {
        const n = rule.fromList.list.length;
        const k = Math.min(rule.fromList.distinct, n);
        for (const s of rule.fromList.list) add({ ...s, count: 1 }, k / n, 1);
    }
    return [...out.values()].map((e) => ({ ...e, mean: Math.round(e.mean * 10000) / 10000 }));
}

/** The food values (and avoidFood) of the items a forage block gives. */
function foodsOf(catalog, entry, drops) {
    const names = Array.isArray(entry.food)
        ? entry.food.map((n) => ({ name: n, meta: 0 }))
        : drops.map((d) => ({ name: d.name, meta: d.meta }));
    const out = [];
    for (const { name, meta } of names) {
        const values = catalog.foodValues(name, meta);
        if (!values) continue;
        const { avoid, ...v } = values;
        out.push({ name, meta, values: v, avoid: avoid ?? null });
    }
    return out;
}

/**
 * How to get food from one block state.
 * @param {object} catalog RotnData
 * @param {string|object} blockInput "rustic:wildberry_bush", "rustic:wildberry_bush:1" or a mineflayer
 *   block ({ name, metadata })
 * @param {number} [meta] the block meta (default: from the input, else the block's default meta)
 * @returns {null | {id, kind, block, meta, state, ready, how: 'right-click'|'break'|'wait',
 *   rightClick: object|null, break: {destroysBlock, drops: [{name, meta, mean, max}], notWhileSneaking,
 *   silkTouch, note}, food: [{name, meta, values, avoid}], hazards: object[], regrow, touch,
 *   cook: object[]|null, confidence}} null for a block (or meta) that is not a forage source.
 *   how: the action that gives food from this state now ('wait' = nothing yet; let it regrow).
 *   rightClick: null when right-clicking this state gives nothing; else what it gives and `harm`
 *   (non-null for the hawthorn: never right-click it).
 */
export function forageFood(catalog, blockInput, meta) {
    const data = catalog.forageData;
    const r = catalog.resolve(blockInput, 'blocks');
    if (!data || !r) return null;
    const m = meta ?? r.meta ?? catalog.dump?.blocks?.blocks?.[r.name]?.defaultMeta ?? 0;
    const entry = data.blocks.find((b) => b.block === r.name && b.metas.includes(m));
    if (!entry) return null;
    const rule = entry.break?.byMeta?.[m] ?? null;
    const drops = rule ? expectedDrops(rule) : [];
    const rc = entry.rightClick && entry.rightClick.metas.includes(m) ? structuredClone(entry.rightClick) : null;
    const smelt = entry.kind === 'mushroom' ? catalog.smeltingOf(entry.block) : null;
    return {
        id: entry.id,
        kind: entry.kind,
        block: entry.block,
        meta: m,
        state: entry.states[m],
        ready: entry.readyMetas.includes(m),
        how: entry.how[m],
        rightClick: rc,
        break: {
            destroysBlock: entry.break.destroysBlock,
            drops,
            notWhileSneaking: entry.break.notWhileSneaking ?? false,
            silkTouch: entry.break.silkTouch ?? null,
            note: entry.break.note ?? null,
        },
        food: foodsOf(catalog, entry, drops),
        hazards: forageHazard(catalog, r.name, m) ?? [],
        regrow: entry.regrow ? structuredClone(entry.regrow) : null,
        touch: entry.touch ? structuredClone(entry.touch) : null,
        cook: smelt ? (Array.isArray(smelt) ? smelt : [smelt]).map((s) => ({ via: 'smelting', output: s.output })) : null,
        confidence: data.confidence,
    };
}

/**
 * Every forage block to look for, best first: [{ id, kind, block, metas, readyMetas, how }].
 * `metas` are the states worth walking to (ready ones, or for a bush any state that regrows).
 * @param {{ includeNotFood?: boolean, includeAvoided?: boolean }} [opts] includeNotFood: also list
 *   mushrooms (food only once smelted); includeAvoided: also list blocks whose food avoidFood flags
 *   (cloudsbluff)
 */
export function forageSources(catalog, { includeNotFood = false, includeAvoided = false } = {}) {
    const data = catalog.forageData;
    if (!data) return [];
    return data.blocks
        .filter((b) => includeNotFood || b.kind !== 'mushroom')
        .filter((b) => includeAvoided || !(Array.isArray(b.food) && b.food.length && b.food.every((n) => catalog.avoidFood(n))))
        .map((b) => ({ id: b.id, kind: b.kind, block: b.block, metas: [...b.metas], readyMetas: [...b.readyMetas], how: { ...b.how } }));
}

/**
 * Plant hazards of one block state: [{ id, on: 'touch'|'right-click', effects, damage, damageSource,
 * unlessWearing, note }] (poison ivy, thorns and tiny cacti on touch; the hawthorn on right-click), or null.
 */
export function forageHazard(catalog, blockInput, meta) {
    const data = catalog.forageData;
    const r = catalog.resolve(blockInput, 'blocks');
    if (!data || !r) return null;
    const m = meta ?? r.meta ?? catalog.dump?.blocks?.blocks?.[r.name]?.defaultMeta ?? 0;
    const hs = data.hazards.filter((h) => h.block === r.name && h.metas.includes(m)).map((h) => structuredClone(h));
    return hs.length ? hs : null;
}
