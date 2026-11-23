// Dig time by the Forge 1.12.2 server's rule, from rotn-data's dump (#593 review).
//
// mineflayer's bot.dig waits block.digTime(heldItemType, ...) and then sends STOP_DESTROY.
// prismarine-block's digTime reads minecraft-data's vanilla tables (registry.materials[material]
// for the speed, block.harvestTools for the harvest check), which no modded tool is in: a
// pyrotech:flint_pickaxe on stone waited 7.5 s (hand speed) where the server takes 0.6 s. The same
// digTime drives pathfinder's dig costs and bestHarvestTool, and mineflayer-tool's equipForBlock.
//
// The server (PlayerInteractionManager, vanilla bytecode plus Forge 14.23.5.2860's binpatch):
// - progress = relHardness * (ticks since START + 1). A STOP at progress >= 0.7 breaks the block;
//   an earlier STOP becomes the one "delayed destroy", which the server finishes at progress 1.0
//   (a second early STOP while one is pending is ignored), and the server sends the real block back
//   at once. mineflayer does not wait for the server: it predicts air and resolves dig(). So the
//   client must wait the server's time; up to 30% short still breaks at the STOP.
// - relHardness = ForgeHooks.blockStrength = digSpeed / hardness / (canHarvestBlock ? 30 : 100).
//   digSpeed starts from the item's getDestroySpeed (a tool's efficiency when one of its tool
//   classes is the block's harvest tool, else 1), then efficiency, haste, fatigue, water and
//   not-on-ground, then PlayerEvent.BreakSpeed: a cancelled event gives speed 0 (never breaks).
// - canHarvestBlock: the material needs no tool -> yes; no harvest tool, or the item has no level
//   for it -> the item's vanilla canHarvestBlock; else item level >= block harvest level.
// - Tool Progression (prevent_block_destruction=true on this pack) cancels BreakSpeed when its own
//   check fails: the block names a harvest tool and the main hand is empty, has no level in that
//   class, or a level below the block's. A block with no harvest tool passes its check.
//
// The rule here (forgeDigTime), per block state from the dump:
//   hardness < 0 -> Infinity. Tool required and a harvest tool named: the tool's level in that class
//   >= the harvest level, else Infinity (Tool Progression). Tool required and no harvest tool: the
//   item's vanilla harvest check (prismarine's harvestTools), x100 when it fails. Speed: the tool's
//   speed in the block's harvest-tool class when it has that class; for an item with no tool classes
//   (swords, shears, non-tools) prismarine's vanilla material speed; else 1. Then prismarine's
//   modifiers, rounded up to whole ticks of 50 ms, exactly as prismarine-block does.
// Anything the dump does not know (no state, no finite hardness) keeps prismarine's own digTime.
//
// attachDigTime replaces digTime on the Block class this bot's world builds its blocks with
// (prismarine-chunk's, made for bot.registry), taken from the first block of the first loaded
// column. Only that class changes: minecraft-data and every other Block class keep prismarine's.

export const TICK_MS = 50;
const INSTALLED = Symbol.for('mindcraft-rotn.forgeDigTime');
const ATTACHED = Symbol.for('mindcraft-rotn.forgeDigTimeAttached');

function effectLevel(registry, name, effects) {
    const d = registry?.effectsByName?.[name];
    if (!d || !effects) return 0;
    const e = effects[d.id];
    return e ? e.amplifier + 1 : 0;
}

function enchantmentLevel(registry, name, enchantments) {
    const d = registry?.enchantmentsByName?.[name];
    if (!d || !Array.isArray(enchantments)) return 0;
    for (const e of enchantments) {
        if (typeof e?.name === 'string' ? e.name.includes(name) : e?.name === d.name) return e.lvl;
    }
    return 0;
}

function miningFatigueMultiplier(level) {
    switch (level) {
        case 0: return 1.0;
        case 1: return 0.3;
        case 2: return 0.09;
        case 3: return 0.0027;
        default: return 8.1E-4;
    }
}

/**
 * The server's dig time in ms for one block state and one held item, or null when the state has no
 * finite hardness (the caller keeps prismarine's own digTime).
 * @param {{hardness: number, harvestTool?: string|null, harvestLevel?: number, toolRequired?: boolean}} state
 *        the dump's block state
 * @param {{classes: Object<string, number>, speed?: Object<string, number>}|null} tool the held item's
 *        tool classes (class -> level) and speeds (class -> speed); null for the hand or an item with
 *        no tool classes
 * @param {{registry?: object, vanillaSpeed?: number, vanillaCanHarvest?: boolean, enchantments?: Array,
 *        effects?: object, inWater?: boolean, notOnGround?: boolean}} [opts] vanillaSpeed and
 *        vanillaCanHarvest: prismarine's material speed and harvestTools answer for the held item
 *        (used only for an item with no tool classes, and for a tool-required block with no harvest tool)
 * @returns {number|null}
 */
export function forgeDigTime(state, tool, { registry = null, vanillaSpeed = 1, vanillaCanHarvest = false, enchantments = [], effects = {}, inWater = false, notOnGround = false } = {}) {
    const hardness = state?.hardness;
    if (typeof hardness !== 'number' || !Number.isFinite(hardness)) return null;
    if (hardness < 0) return Infinity;
    const cls = typeof state.harvestTool === 'string' && state.harvestTool !== '' ? state.harvestTool : null;
    const isTool = !!tool?.classes && Object.keys(tool.classes).length > 0;
    const level = cls && isTool ? tool.classes[cls] : undefined;
    const hasClass = Number.isInteger(level) && level >= 0;

    let canHarvest;
    if (!state.toolRequired) canHarvest = true;
    else if (!cls) canHarvest = !!vanillaCanHarvest;
    else {
        canHarvest = hasClass && level >= Math.max(0, Number.isInteger(state.harvestLevel) ? state.harvestLevel : 0);
        if (!canHarvest) return Infinity; // Tool Progression cancels BreakSpeed: the server never breaks it
    }

    let speed = 1;
    if (hasClass) speed = tool.speed?.[cls] ?? 1;
    else if (!isTool && vanillaSpeed > 0) speed = vanillaSpeed;

    const efficiency = enchantmentLevel(registry, 'efficiency', enchantments);
    if (efficiency > 0 && speed > 1.0) speed += efficiency * efficiency + 1;
    const haste = Math.max(effectLevel(registry, 'Haste', effects), effectLevel(registry, 'ConduitPower', effects));
    if (haste > 0) speed *= 1 + (0.2 * haste);
    const fatigue = effectLevel(registry, 'MiningFatigue', effects);
    if (fatigue > 0) speed *= miningFatigueMultiplier(fatigue);
    if (inWater && enchantmentLevel(registry, 'aqua_affinity', enchantments) === 0) speed /= 5.0;
    if (notOnGround) speed /= 5.0;

    if (hardness === 0) return 0;
    const delta = speed / hardness / (canHarvest ? 30.0 : 100.0);
    if (delta === 0) return Infinity;
    if (delta >= 1.0) return 0;
    return Math.ceil(1.0 / delta) * TICK_MS;
}

/** The dump's state for one metadata of a dumped block (as rotn-data's getBlock returns it), or null. */
export function pickState(dumpBlock, meta) {
    const states = Array.isArray(dumpBlock?.states) ? dumpBlock.states : [];
    const m = Number.isInteger(meta) ? meta : 0;
    return states.find(s => s.meta === m) ?? (states.length === 1 ? states[0] : null);
}

const fullName = (entry) => {
    const n = entry?.registryName ?? entry?.name;
    if (typeof n !== 'string' || n === '') return null;
    return n.includes(':') ? n : `minecraft:${n}`;
};

/**
 * Whether a dumped hardness of 0 is believable. Most dumped zeros of solid blocks are dumper misreads
 * (rotn-data's mob-digging notes; sponge 0.6, stone_slab2 2 and skull 1 read 0), and a wrong 0 sends
 * STOP at once, below the server's 0.7: so a 0 counts only when rotn-data lists it as real, when
 * minecraft-data's vanilla entry is 0 too, or for a modded block that is not solid (plants, torches).
 */
export function believableZero(state, name, entry, knownReal) {
    if (state?.hardness !== 0) return true;
    if (knownReal?.has?.(name)) return true;
    if (entry && !entry.forge?.modded && name.startsWith('minecraft:')) return (entry.hardness ?? 0) === 0;
    return state.solid === false;
}

/**
 * stateOf and toolOf for attachDigTime from rotn-data's catalog (its getBlock and getItem). A state
 * whose dumped hardness 0 is not believable (believableZero) gives null: prismarine's own time.
 * @param {{getBlock: (name: string) => object|null, getItem: (name: string) => object|null, mobDiggingData?: object}} rd
 * @param {object} registry bot.registry (extended), for the block's and the held item's name
 */
export function dumpDigSources(rd, registry) {
    const knownReal = new Set(rd?.mobDiggingData?.hardnessZero?.knownReal ?? []);
    return {
        stateOf: (block) => {
            const entry = registry?.blocks?.[block.type];
            const name = fullName(entry) ?? fullName(block);
            const st = name ? pickState(rd.getBlock(name), block.metadata) : null;
            return st && believableZero(st, name, entry, knownReal) ? st : null;
        },
        toolOf: (itemType) => {
            const name = fullName(registry?.items?.[itemType]);
            const it = name ? rd.getItem(name) : null;
            const classes = it?.toolClasses;
            return classes && Object.keys(classes).length ? { classes, speed: it.speed ?? {} } : null;
        },
    };
}

/**
 * Replaces digTime on one Block class (the prototype of `block`) with the Forge rule. Idempotent per
 * class. Returns true when it installed now, false when the class already had it or is unusable.
 * @param {object} block an instance of the class to change
 * @param {{stateOf: (block: object) => object|null, toolOf: (itemType: number) => object|null,
 *          registry?: object, onFallback?: (block: object) => void}} sources
 */
export function installDigTime(block, { stateOf, toolOf, registry = null, onFallback = () => {} }) {
    const proto = block ? Object.getPrototypeOf(block) : null;
    if (!proto || typeof proto.digTime !== 'function' || Object.prototype.hasOwnProperty.call(proto, INSTALLED)) return false;
    const original = proto.digTime;
    // Per class (one bot): the dump's answer per block type and metadata, and per held item type.
    const states = new Map();
    const tools = new Map();
    const stateFor = (b) => {
        const key = `${b.type}:${b.metadata}`;
        if (!states.has(key)) {
            let st = null;
            try { st = stateOf(b) ?? null; } catch { st = null; }
            states.set(key, st);
        }
        return states.get(key);
    };
    const toolFor = (type) => {
        if (type == null) return null;
        if (!tools.has(type)) {
            let t = null;
            try { t = toolOf(type) ?? null; } catch { t = null; }
            tools.set(type, t);
        }
        return tools.get(type);
    };
    proto.digTime = function forgeRuleDigTime(heldItemType, creative, inWater, notOnGround, enchantments = [], effects = {}) {
        if (creative) return 0;
        const state = stateFor(this);
        const held = heldItemType ?? null;
        const ms = state
            ? forgeDigTime(state, toolFor(held), {
                registry,
                vanillaSpeed: (held != null && registry?.materials?.[this.material]?.[held]) || 1,
                vanillaCanHarvest: held != null && !!this.harvestTools?.[held],
                enchantments: enchantments ?? [],
                effects: effects ?? {},
                inWater,
                notOnGround,
            })
            : null;
        if (ms !== null) return ms;
        onFallback(this);
        return original.call(this, heldItemType, creative, inWater, notOnGround, enchantments, effects);
    };
    Object.defineProperty(proto, INSTALLED, { value: { original }, enumerable: false });
    return true;
}

/** prismarine's own digTime for a class attachDigTime changed (undefined when it did not). */
export function originalDigTime(block) {
    const proto = block ? Object.getPrototypeOf(block) : null;
    return proto && Object.prototype.hasOwnProperty.call(proto, INSTALLED) ? proto[INSTALLED].original : undefined;
}

/**
 * Installs the Forge rule on the Block class of this bot's world, from the first block of the first
 * loaded column (bot 'chunkColumnLoad'). Call after extendRegistry. Once per bot.
 * @param {object} bot mineflayer bot
 * @param {{stateOf: Function, toolOf: Function}} sources see dumpDigSources
 * @param {{log?: (msg: string) => void}} [opts]
 * @returns {{installed: boolean, fallbacks: number}} live report
 */
export function attachDigTime(bot, sources, { log = () => {} } = {}) {
    if (typeof sources?.stateOf !== 'function' || typeof sources?.toolOf !== 'function') {
        throw new Error('attachDigTime: stateOf and toolOf are required');
    }
    if (bot[ATTACHED]) return bot[ATTACHED];
    const report = { installed: false, fallbacks: 0 };
    const unknown = new Set();
    const onFallback = (b) => {
        report.fallbacks++;
        const key = `${b.name}:${b.metadata}`;
        if (unknown.size < 1000 && !unknown.has(key)) {
            unknown.add(key);
            log(`dig time: ${key} is not in the dump, prismarine's vanilla dig time is used (logged once)`);
        }
    };
    const onColumn = (pos) => {
        let block = null;
        try { block = bot.blockAt?.(pos); } catch { block = null; }
        if (!block) return;
        bot.removeListener('chunkColumnLoad', onColumn);
        const now = installDigTime(block, { ...sources, registry: bot.registry, onFallback });
        report.installed = true;
        log(now ? 'dig time: the Forge 1.12 rule from the dump is installed (modded tools dig at their speed)'
            : 'dig time: the Forge 1.12 rule was already installed on this Block class');
    };
    bot.on('chunkColumnLoad', onColumn);
    Object.defineProperty(bot, ATTACHED, { value: report, enumerable: false, configurable: true });
    return report;
}
