// Digging mobs (lead task from G3 smoke round 9 B, 2026-11-07): which mobs dig toward their target,
// and which blocks they can dig, from Epic Siege Mod + ESM-Tweaks + Tool Progression bytecode and
// the pack's configs (3.3.4/mob-digging.json, which cites each step). Pure functions over a RotnData
// catalog; no network, no game state.
//
// canMobDig mirrors ESM-Tweaks AltEntityAIDigging.canHarvest for one block state:
//   hardness < 0 -> no (unbreakable); material not solid -> no (isSolid; the dump records
//   blocksMovement, the same except for web, which is solid); hardness 0 -> no (canHarvest says yes,
//   but HarvestUtil.getBlockStrength is 0, so the dig never finishes), but only for the cited
//   hardnessZero.knownReal blocks: any other dumped 0 is probably a dumper misread, so that answer
//   is uncertain and assumes a real hardness above 0 (#350 review); 'Requires Tools' false -> yes;
//   else yes if HarvestUtil.canBreakBlockByHand (Tool Progression overwrite first, then the
//   material, then a null harvest tool), else yes only with the block's harvest tool at its level
//   in either hand. No digger has a Digging Blacklist (ESM reads a mob's own entry only).

/** The digging facts for a mob, or null when it does not dig (or the pack has no digging data). */
export function mobDigging(catalog, entityName) {
    const data = catalog.mobDiggingData;
    const d = data?.diggers?.[entityName];
    if (!d) return null;
    return {
        name: entityName,
        digs: true,
        requiresTools: d.requiresTools,
        reach: data.settings.reach,
        keepWithin: data.settings.keepWithin,
        when: data.when,
        confidence: data.confidence,
    };
}

/**
 * Whether a digging mob can dig a block state.
 * @param {object} catalog RotnData
 * @param {string} entityName a registry name in mob-digging.json's diggers ("minecraft:zombie")
 * @param {string} blockName a 1.12 block registry name ("minecraft:cobblestone")
 * @param {{meta?: number, held?: Array<{type: string, level: number}>}} [opts] the block meta
 *   (default: the block's default meta) and the tool classes the mob holds in either hand
 * @returns {null | {canDig: boolean, byHand: boolean, needs: {type: string, minLevel: number}|null,
 *   ticksByHand: number|null, uncertain: boolean, reason: string}} null for an unknown mob (not a
 *   digger) or block.
 *   uncertain: true when the dump's hardness is 0 for a block outside mob-digging.json's
 *   hardnessZero.knownReal (most of those are dumper misreads). canDig then follows the tool rules as
 *   if the hardness were above 0, ticksByHand is null, and a planner must not count it as mob-proof.
 *   needs: the tool that would let a requiresTools mob dig a block it cannot dig by hand.
 *   ticksByHand: about how long an empty-handed mob on the ground takes (null when it cannot dig it):
 *   30 x hardness when the block's material needs no tool, else 100 x hardness, whatever the mob.
 */
export function canMobDig(catalog, entityName, blockName, { meta, held = [] } = {}) {
    const mob = mobDigging(catalog, entityName);
    const block = catalog.dump?.blocks?.blocks?.[blockName];
    if (!mob || !block) return null;
    const m = meta ?? block.defaultMeta ?? 0;
    const s = block.states.find((x) => x.meta === m);
    if (!s) return null;
    // HarvestUtil.getBlockStrength returns 0 for hardness <= 0, so the progress never reaches 1. That is
    // certain only where the 0 itself is: the dump misreads many states as 0 (slabs, stairs, walls).
    const solid = s.solid || s.material === 'web';
    const uncertain = s.hardness === 0 && solid && !(catalog.mobDiggingData.hardnessZero?.knownReal ?? []).includes(blockName);
    const why = (reason) => (uncertain ? `${reason}; hardness unknown (the dump says 0)` : reason);
    const no = (reason, needs = null) => ({ canDig: false, byHand: false, needs, ticksByHand: null, uncertain, reason: why(reason) });
    const yes = (byHand, needs, ticksByHand, reason) => ({ canDig: true, byHand, needs, ticksByHand: uncertain ? null : ticksByHand, uncertain, reason: why(reason) });
    if (typeof s.hardness !== 'number' || s.hardness < 0) return no('unbreakable');
    if (!solid) return no('not solid');
    if (s.hardness === 0 && !uncertain) return no('hardness 0: the dig never finishes');
    const ticks = catalog.mobDiggingData.settings.ticksPerHardness;
    const noToolNeeded = s.toolRequired === false;
    // Empty-handed, getBlockStrength divides by 30 only when the material needs no tool, else by 100,
    // also for a mob without Requires Tools and for a block whose harvest tool is null (bedrock).
    const ticksByHand = Math.max(1, Math.round(s.hardness * (noToolNeeded ? ticks.noToolNeeded : ticks.toolNeededButMissing)));
    if (!mob.requiresTools) return yes(true, null, ticksByHand, 'this mob needs no tool');
    const key = `${blockName}:${m}`;
    const exc = catalog.mobDiggingData.toolProgressionExceptions ?? {};
    const toolNull = s.harvestTool == null || s.harvestTool === 'null';
    const byHand = exc.byHand?.includes(key) ? true : exc.needsTool?.includes(key) ? toolNull : noToolNeeded || toolNull;
    if (byHand) return yes(true, null, ticksByHand, 'needs no tool');
    const needs = { type: s.harvestTool, minLevel: Math.max(0, s.harvestLevel ?? 0) };
    if (held.some((t) => t?.type === needs.type && (t.level ?? -1) >= needs.minLevel)) {
        return yes(false, needs, null, 'holds the right tool');
    }
    return no('needs a tool it does not hold', needs);
}
