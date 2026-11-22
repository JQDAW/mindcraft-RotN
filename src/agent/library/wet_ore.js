// Soak 8 (rotn-v0.1.14, #558), the lead's escape plan PR 2 (4): the model mined copper ore by
// flowing water under a stone overhang (-86, 62, -125); the drowning reflex stopped the mining 4
// times, and the bot ended in a flooded pit for 36 min. collectBlock now leaves such an ore alone:
// one with a liquid beside it, one with no dry footing within reach, and one the drowning reflex
// fired twice for (within WET_ORE.drownMemoryMs). Said once per collect (collectBlock).
// Only fall_safety here (no shelter or skills import): skills.js imports this.

import { Vec3 } from 'vec3';
import { isLiquid, isFirmGround, isUnsafeBlock } from './fall_safety.js';

/**
 * reach: eye to the block's centre for a footing cell (a player's reach); drownMax: drowning-reflex
 * fires for one target before it is given up; drownMemoryMs: how long they are remembered.
 */
export const WET_ORE = { reach: 4.5, drownMax: 2, drownMemoryMs: 30 * 60_000 };

const SIX = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const key = (p) => `${p.x},${p.y},${p.z}`;
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

/** Why a block is left alone (an ore by water, or one the drowning reflex fired for twice), or null. */
export function wetOreRefusal(bot, block, now = Date.now()) {
    if (!block?.position) return null;
    const seen = bot?.rotnDrowned?.get(key(block.position));
    if (seen && now - seen.at <= WET_ORE.drownMemoryMs && seen.n >= WET_ORE.drownMax) return 'the drowning reflex fired twice going for it';
    if (!isOre(block)) return null;
    if (SIX.some(d => isLiquid(bot, bot.blockAt(block.position.plus(d))))) return 'a liquid beside it';
    if (!footingFor(bot, block.position)) return 'no dry footing within reach';
    return null;
}
