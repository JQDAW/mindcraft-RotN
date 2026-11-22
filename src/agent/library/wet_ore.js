// Soak 8 (rotn-v0.1.14, #558), the lead's escape plan PR 2 (4): the model mined copper ore by
// flowing water under a stone overhang (-86, 62, -125); the drowning reflex stopped the mining 4
// times, and the bot ended in a flooded pit for 36 min. collectBlock now leaves such an ore alone:
// one with a liquid beside it, one with no dry footing within reach, and one the drowning reflex
// fired twice for (within WET_ORE.drownMemoryMs). Said once per collect (collectBlock).
// #564 review 1: the footing rule applies only with a liquid within reach of the ore; a buried ore
// in dry rock is collected as before (the pathfinder digs to it).
// #564 review 2 (accepted): the drowning fires are counted per target across collects, for 30 min:
// a swim-up interrupts the collect, so "twice in one collect" cannot happen.
// #564 review nit: each skip also names its liquid (water, lava, or another liquid), so the reason
// line says "in the lava" when lava caused it, not always "in the water" (wetOreSkip).
// Only fall_safety here (no shelter or skills import): skills.js imports this.

import { Vec3 } from 'vec3';
import { isLiquid, isLethal, isFirmGround, isUnsafeBlock } from './fall_safety.js';

/**
 * reach: eye to the block's centre for a footing cell (a player's reach); drownMax: drowning-reflex
 * fires for one target before it is given up; drownMemoryMs: how long they are remembered.
 */
export const WET_ORE = { reach: 4.5, drownMax: 2, drownMemoryMs: 30 * 60_000 };

const SIX = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const key = (p) => `${p.x},${p.y},${p.z}`;
const WATER = /^(minecraft:)?(flowing_)?water$/;
const free = (bot, b) => !!b && b.boundingBox === 'empty' && !isUnsafeBlock(bot, b);

/** An ore by its name: "iron_ore", "minecraft:coal_ore", "osv:simpleores_copper_ore_undergroundbiomes_metamorphic_stone". */
export function isOre(block) {
    const name = typeof block?.name === 'string' ? block.name : '';
    return /(^|[:_])ore($|_)/.test(name);
}

/** A cell the bot can stand in, dry: its two cells free of any liquid or hazard, on firm ground that is no liquid. */
export function dryFooting(bot, c) {
    return free(bot, bot.blockAt(c)) && free(bot, bot.blockAt(c.offset(0, 1, 0))) && isFirmGround(bot, bot.blockAt(c.offset(0, -1, 0)));
}

/** A dry footing cell from which the block is within reach (eye to its centre), or null. */
export function footingFor(bot, pos) {
    const centre = pos.offset(0.5, 0.5, 0.5);
    const r = Math.ceil(WET_ORE.reach);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const c = pos.offset(dx, dy, dz);
        if (c.offset(0.5, 1.62, 0.5).distanceTo(centre) > WET_ORE.reach) continue;
        if (dryFooting(bot, c)) return c;
    }
    return null;
}

/**
 * The drowning reflex fired while a collect went for bot.rotnCollectTarget (modes.js): counted for
 * that block. Returns the count within drownMemoryMs, or 0 when no collect target is set.
 */
export function noteDrowning(bot, now = Date.now()) {
    const p = bot?.rotnCollectTarget;
    if (!p) return 0;
    const seen = bot.rotnDrowned ??= new Map();
    const last = seen.get(key(p));
    const n = last && now - last.at <= WET_ORE.drownMemoryMs ? last.n + 1 : 1;
    seen.set(key(p), { n, at: now });
    return n;
}

/**
 * A liquid within the reach box around pos (WET_ORE.reach, rounded up, each way), or null; the
 * first one found ends the scan. #564 review 1: only then can the ore be "by water".
 */
export function liquidNear(bot, pos) {
    const r = Math.ceil(WET_ORE.reach);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const q = pos.offset(dx, dy, dz);
        if (isLiquid(bot, bot.blockAt(q))) return q;
    }
    return null;
}

/**
 * Which liquid a block is: 'lava' (lava or a molten metal: fall_safety.isLethal, which also takes a
 * modded fluid state the dump reports as hazard lava), 'water', 'liquid' (any other), or null.
 */
export function liquidKind(bot, b) {
    if (!isLiquid(bot, b)) return null;
    if (isLethal(bot, b)) return 'lava';
    return WATER.test(b.name ?? '') ? 'water' : 'liquid';
}

/** The liquid kinds (liquidKind) within the reach box around pos; the scan ends once water and lava are both found. */
export function liquidsNear(bot, pos) {
    const kinds = new Set();
    const r = Math.ceil(WET_ORE.reach);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const k = liquidKind(bot, bot.blockAt(pos.offset(dx, dy, dz)));
        if (k) kinds.add(k);
        if (kinds.has('water') && kinds.has('lava')) return kinds;
    }
    return kinds;
}

/**
 * Why a block is left alone (an ore by a liquid, or one the drowning reflex fired for twice), and
 * which liquids caused it ('water', 'lava', 'liquid'), or null.
 * #564 review 1: the footing rule only with a liquid within the reach box (soak 8: the ore by the
 * river); an ore buried in dry rock, which the pathfinder digs to, has no air cell near and is fine.
 * The drowning reflex is water's (#567 nit 2: modes.js self_preservation fires it only with water at
 * the head, names112.isWater); a liquid beside the ore names the ones beside it; no dry footing
 * names the ones within the reach box.
 */
export function wetOreSkip(bot, block, now = Date.now()) {
    if (!block?.position) return null;
    const seen = bot?.rotnDrowned?.get(key(block.position));
    if (seen && now - seen.at <= WET_ORE.drownMemoryMs && seen.n >= WET_ORE.drownMax) return { why: 'the drowning reflex fired twice going for it', liquids: ['water'] };
    if (!isOre(block)) return null;
    const beside = new Set(SIX.map(d => liquidKind(bot, bot.blockAt(block.position.plus(d)))).filter(Boolean));
    if (beside.size) return { why: 'a liquid beside it', liquids: [...beside] };
    if (!liquidNear(bot, block.position)) return null;
    if (!footingFor(bot, block.position)) return { why: 'no dry footing within reach', liquids: [...liquidsNear(bot, block.position)] };
    return null;
}

/** Why a block is left alone (wetOreSkip's reason), or null. */
export function wetOreRefusal(bot, block, now = Date.now()) {
    return wetOreSkip(bot, block, now)?.why ?? null;
}
