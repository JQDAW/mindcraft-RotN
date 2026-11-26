// Soak 16 trap (21:17-21:20, the lead's go on /home/rv/soak16-trap-skills.md): the stone pickaxe (131 uses, rotn-data's
// dump) was used up by a destructive !goToCoordinates that tunnelled about 57 blocks across and 11 down through stone;
// nothing logged the break; the walk ended "Unable to reach" in a tunnel, and the escape could neither dig a stair nor
// the headroom for a pillar (every Underground Biomes stone needs a pickaxe). This module is the pickaxe's state (the
// uses left) and its scripted re-craft: 1 cobble -> 4 rocks (2x2), 2 planks -> 4 sticks, 3 rocks + 2 sticks at a table
// (crafttweaker:stone_pickaxe), for the escape (before its climb) and the post-agenda pickaxe reserve.

import { getItem, registryName, loadRotnData, PACK_VERSION, botName, WILDCARD_META } from '../../../packages/rotn-data/index.js';
import { carriedItems, countItem, formatName, inventoryKey } from './rotn_names.js';
import { craftsInto } from './collect_lines.js';
import { handDiggable } from './night.js';
import { isEmpty } from './shelter.js';
import { Vec3 } from 'vec3';

/**
 * item: the pickaxe crafted. rocks, sticks: its recipe (crafttweaker:stone_pickaxe, at a table). walkKeep (#642 review
 * 8): a walk never digs with the pickaxe's last uses (the escape may): keepShare of its uses, at least keepMin (the
 * stone pickaxe: 27 of 132). The client's damage is the server's last set_slot for the stack (mineflayer predicts no
 * durability), so it can lag a dig or two behind: the share is the margin for that too.
 */
export const PICKAXE = { item: 'stone_pickaxe', rocks: 3, sticks: 2, keepShare: 0.2, keepMin: 4 };

const maxDamageOf = (name) => { try { return getItem(registryName(name))?.maxDamage ?? null; } catch { return null; } };
const levelOf = (name) => { try { const l = getItem(registryName(name))?.toolClasses?.pickaxe; return typeof l === 'number' && l >= 0 ? l : null; } catch { return null; } };

/** The uses a tool has left: it breaks when its damage goes above its max (rotn-data #551). Infinity when unknown. */
export function usesLeft(item) {
    const max = maxDamageOf(item?.name);
    if (!(max > 0)) return Infinity;
    const used = item.durabilityUsed ?? item.metadata ?? 0;
    return Math.max(0, max - used + 1);
}

/** The uses a walk keeps for the escape on this tool: keepShare of its uses, at least keepMin; keepMin when unknown. */
export function walkKeep(item) {
    const max = maxDamageOf(item?.name);
    return max > 0 ? Math.max(PICKAXE.keepMin, Math.ceil(PICKAXE.keepShare * (max + 1))) : PICKAXE.keepMin;
}

/** The carried pickaxe (inventory or off hand) with the most uses left: {item, level, uses, keep}, or null. */
/** Only names like these are looked up in the dump (a walk asks at every start: no dump load for a stack of dirt). */
export const PICKAXE_NAME = /pickaxe|mattock|paxel|drill/;
export function bestPickaxe(bot) {
    let best = null;
    for (const item of carriedItems(bot)) {
        if (!PICKAXE_NAME.test(item?.name ?? '')) continue;
        const level = levelOf(item?.name);
        if (level === null) continue;
        const uses = usesLeft(item);
        if (uses <= 0) continue;
        if (!best || uses > best.uses) best = { item, level, uses, keep: walkKeep(item) };
    }
    return best;
}

/** The uses left on the best carried pickaxe; 0 with none. */
export const pickaxeUses = (bot) => bestPickaxe(bot)?.uses ?? 0;
/** Whether a walk may dig with the pickaxe: one carried with more than its walkKeep uses left. */
export const walkPickaxeOk = (bot) => { const b = bestPickaxe(bot); return !!b && b.uses > b.keep; };

const oreCache = new Map();
/** The inventory names of an ore dictionary entry (a bare name counts every variant). */
export function oreNames(ore) {
    if (!oreCache.has(ore)) {
        let members = [];
        try { members = loadRotnData(PACK_VERSION).oreDict(ore) ?? []; } catch { members = []; }
        const bare = new Set(members.filter(m => m.meta == null || m.meta === WILDCARD_META).map(m => botName(m.name)));
        const variants = members.filter(m => m.meta != null && m.meta !== WILDCARD_META && !bare.has(botName(m.name))).map(m => formatName(botName(m.name), m.meta));
        oreCache.set(ore, [...bare, ...new Set(variants)]);
    }
    return oreCache.get(ore);
}
const countOre = (bot, ore) => oreNames(ore).reduce((n, v) => n + countItem(bot, v, { offHand: false }), 0);
const isPlanks = (i) => /(^|:)planks$|_planks$/.test(i?.name ?? '');
const isTable = (i) => /(^|:)crafting_table$/.test(i?.name ?? '');

/**
 * Soak 17 E(1) (the lead): RotN's crafting table is a plank and Crafting Tools; the tools are a crude axe, a rock and a
 * stick (the crude axe is used up); the crude axe is a rock and 2 sticks, all in the 2x2 grid (rotn-data's recipes;
 * pickaxe_chain.test.js pins these numbers against them). Soak 17 escape 3: "no pickaxe, and none can be made here: a
 * stone pickaxe needs a crafting table (none carried or near)", with 4 planks, 3 sticks and 510 rocks; the model then
 * made the crude axe, the tools and the table itself.
 */
export const TABLE_CHAIN = Object.freeze([
    { item: 'pyrotech:crude_axe', rocks: 1, sticks: 2, planks: 0 },
    { item: 'contenttweaker:crafting_tools', rocks: 1, sticks: 1, planks: 0 },
    { item: 'crafting_table', rocks: 0, sticks: 0, planks: 1 },
]);
const PLANKS_PER_STICK_CRAFT = 2, STICKS_PER_CRAFT = 4;

/**
 * What making a stone pickaxe takes from what the bot carries: {ready, crafts: [[item, times]...], why}. Rocks from
 * cobble (one cobble kind that crafts into rocks, 4 each), sticks from planks (4 from 2), a crafting table when none is
 * carried or near (soak 17 E(1): the crude axe, then Crafting Tools, then the table: TABLE_CHAIN, the steps already
 * carried left out), then the pickaxe (skills.craftRecipe places a carried table and picks it up again).
 * tableNear: whether a crafting table is within reach (the caller's world check).
 */
export function pickaxePlan(bot, { tableNear = false } = {}) {
    const items = bot?.inventory?.items?.() ?? [];
    const needTable = !tableNear && !items.some(isTable);
    if (!needTable) return planFor(bot, items, []);
    // The table chain's steps still to do: from the first one whose result is not carried yet.
    const carried = (name) => countItem(bot, name, { offHand: false }) > 0;
    const from = carried(TABLE_CHAIN[1].item) ? 2 : carried(TABLE_CHAIN[0].item) ? 1 : 0;
    const chain = TABLE_CHAIN.slice(from);
    const full = planFor(bot, items, chain);
    if (full.ready) return full;
    // Not enough for the table too: what the pickaxe alone lacks, then the table and what its makings add.
    const base = planFor(bot, items, []);
    const add = (k) => chain.reduce((n, c) => n + c[k], 0);
    const makings = [[add('rocks'), 'rock'], [add('sticks'), 'stick'], [add('planks'), 'plank']].filter(([n]) => n > 0).map(([n, w]) => `${n} more ${w}${n === 1 ? '' : 's'}`);
    const table = `a crafting table (none carried or near) or the makings of one (${chain.map(c => c.item).join(', then ')}: ${makings.join(', ')})`;
    return { ready: false, crafts: full.crafts, why: `a stone pickaxe needs ${[...(base.missing ?? []), table].join(', ')}` };
}

/** The crafts for the pickaxe plus the table chain's steps `chain`: {ready, crafts, why} (and missing, for pickaxePlan). */
function planFor(bot, items, chain) {
    const crafts = [];
    const missing = [];
    const need = (k) => chain.reduce((n, c) => n + c[k], 0);
    const rocksNeed = PICKAXE.rocks + need('rocks');
    let rocks = countOre(bot, 'rock');
    if (rocks < rocksNeed) {
        const rockNames = oreNames('rock');
        for (const s of items) {
            const key = inventoryKey(s) ?? s.name;
            const c = craftsInto(key, rockNames);
            if (!c || c.per !== 1 || !(c.count > 0)) continue;
            const times = Math.min(s.count, Math.ceil((rocksNeed - rocks) / c.count));
            crafts.push([c.name, times]);
            rocks += times * c.count;
            if (rocks >= rocksNeed) break;
        }
        if (rocks < rocksNeed) missing.push(`${rocksNeed} rocks (you have ${countOre(bot, 'rock')}, and no cobble that breaks down into rocks)`);
    }
    const planks = items.filter(isPlanks).reduce((n, i) => n + i.count, 0);
    const planksKept = need('planks'); // the table's plank stays a plank
    const sticksNeed = PICKAXE.sticks + need('sticks');
    const sticks = countOre(bot, 'stickWood');
    if (sticks < sticksNeed) {
        const times = Math.ceil((sticksNeed - sticks) / STICKS_PER_CRAFT);
        if (planks - planksKept >= times * PLANKS_PER_STICK_CRAFT) crafts.push(['stick', times]);
        else missing.push(`${sticksNeed} sticks (you have ${sticks}, and fewer than ${times * PLANKS_PER_STICK_CRAFT + planksKept} planks)`);
    } else if (planks < planksKept) missing.push('a plank for the table');
    if (missing.length) return { ready: false, crafts, why: `a stone pickaxe needs ${missing.join(', ')}`, missing };
    for (const c of chain) crafts.push([c.item, 1]);
    crafts.push([PICKAXE.item, 1]);
    return { ready: true, crafts, why: null };
}

const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
/**
 * #642 review 4: where a crafting table can stand in a 1x2 pocket: a cell beside the bot (feet or head height), empty
 * or broken by hand (dirt), never the bot's own two cells. {cell, dig} or null.
 */
export function tableCell(bot) {
    const p = bot.entity.position.floored();
    let dig = null;
    for (const d of HORIZONTAL) for (const c of [p.plus(d), p.plus(d).offset(0, 1, 0)]) {
        const b = bot.blockAt(c);
        if (!b) continue;
        if (isEmpty(b)) return { cell: c, dig: false };
        if (!dig && b.boundingBox === 'block' && handDiggable(b)) dig = { cell: c, dig: true };
    }
    return dig;
}

/** Put a crafting table in the pocket (tableCell; a hand-diggable cell dug first): {cell} or {why}. */
export async function placeTableIn(bot, { say = (l) => console.log(l) } = {}) {
    const spot = tableCell(bot);
    if (!spot) return { why: 'no room for a crafting table here' };
    if (spot.dig) { try { await bot.dig(bot.blockAt(spot.cell)); } catch (err) { return { why: `could not clear ${spot.cell} for the crafting table (${err?.message ?? err})` }; } }
    // Placed straight with mineflayer's placeBlock against a solid neighbour (the floor first): skills.placeBlock steps
    // away from a cell this close to the feet, and in a 1x2 pocket there is nowhere to step.
    const table = (bot.inventory?.items?.() ?? []).find(i => /(^|:)crafting_table$/.test(i.name));
    const ref = [new Vec3(0, -1, 0), ...HORIZONTAL, new Vec3(0, 1, 0)].map(d => ({ d, b: bot.blockAt(spot.cell.plus(d)) }))
        .find(x => x.b && x.b.boundingBox === 'block' && !isEmpty(x.b));
    if (!table || !ref) return { why: `could not place the crafting table at ${spot.cell} (${!table ? 'none carried' : 'nothing to place it on'})` };
    try {
        await bot.equip(table, 'hand');
        await bot.lookAt?.(ref.b.position.offset(0.5, 0.5, 0.5));
        await bot.placeBlock(ref.b, new Vec3(-ref.d.x, -ref.d.y, -ref.d.z));
    } catch { /* checked below */ }
    if (!/crafting_table$/.test(bot.blockAt(spot.cell)?.name ?? '')) return { why: `could not place the crafting table at ${spot.cell}` };
    say(`[pickaxe] placed the crafting table at ${spot.cell}`);
    return { cell: spot.cell };
}

/** The recipe in words, for the model's lines. */
export const PICKAXE_RECIPE_TEXT = 'a stone pickaxe is 3 rocks and 2 sticks at a crafting table (1 cobble breaks down into 4 rocks and 2 planks make 4 sticks, both in your 2x2 grid)';

/**
 * Make a stone pickaxe from what the bot carries (pickaxePlan), each craft through `craft` (skills.craftRecipe).
 * {made, why, crafted: [[item, times]...]}. Never throws.
 */
export async function makePickaxe(bot, { craft, tableNear = false, placeTable = placeTableIn, say = (l) => console.log(l) } = {}) {
    const plan = pickaxePlan(bot, { tableNear });
    if (!plan.ready) return { made: false, why: plan.why, crafted: [] };
    const crafted = [];
    let placed = null;
    try {
        for (const [item, times] of plan.crafts) {
            if (bot.interrupt_code) return { made: false, why: 'interrupted', crafted };
            // #642 review 4: the table goes in a cell of the pocket chosen here (craftRecipe's own free-space search can
            // pick the bot's own cell); it is broken again afterwards, whatever happened (by hand: its drop lands beside
            // the bot).
            if (item === PICKAXE.item && !tableNear) {
                placed = await placeTable(bot, { say });
                if (placed?.why) return { made: false, why: placed.why, crafted };
            }
            let ok = false;
            try { ok = await craft(bot, item, times); } catch (err) { ok = false; say(`[pickaxe] crafting ${item}: ${err?.message ?? err}`); }
            // A step that failed leaves no way to the pickaxe: stop there, saying which (no table placed for nothing).
            if (!ok) return { made: false, why: item === PICKAXE.item ? 'the stone pickaxe craft failed' : `crafting ${item} for the stone pickaxe failed`, crafted };
            crafted.push([item, times]);
        }
        const made = !!bestPickaxe(bot);
        say(`[pickaxe] ${made ? 'made a stone pickaxe' : 'no stone pickaxe after the crafts'} (${crafted.map(([i, n]) => `${i} x${n}`).join(', ') || 'no craft'})`);
        return { made, why: made ? null : 'the crafts made no pickaxe', crafted };
    } finally {
        if (placed?.cell) { try { const t = bot.blockAt(placed.cell); if (/crafting_table$/.test(t?.name ?? '')) await bot.dig(t); } catch { /* left where it is */ } }
    }
}
