// Fix B (soak 5, PR 5): burrowing away from a mob that digs through anything.
//
// Soak 5 (00:46): an Ice and Fire troll broke into the bot's shelter and killed it. rotn-data #496
// (mob-digging.json 'blasters', the troll's traits): when a troll has no path to its target and is
// 1.73 to 5.47 blocks from it, it blasts the blocks about 1.9 ahead of it at its mid-height; every
// block with explosion resistance below 8.37 breaks (stone, cobblestone, dirt, planks, glass). It
// hits for 18 (2 hits kill), through a 1-block wall when the bot stands against it. Never fight it.
//
// The lead's rule (PR 5): at night, when an avoid mob that digs anything (a blaster, or a digger
// that needs no tool) breaches or threatens the shelter, the bot burrows away from it: each step
// a 1x2 column dug beside it (or two blocks straight down) that takes it farther from the mob, in
// ground enclosed on every other side (never out into the open or a cave), with the cells it left
// sealed behind. A pickaxe it holds may be used (stone). A 1x2 tunnel is too small for a troll
// (1.2 wide, 3.5 tall), so it has no path and stays out; the seal is for the zombies.
//
// Numbers (the lead's, PR 5): it starts with the mob within its blast range + startMargin (about 7
// blocks), stops at its blast range + stopMargin (about 8) or more, at most maxSteps steps a night
// and maxMs a burrow. A surface shelter has no enclosed side at its feet, so its first steps go
// down (the surface-shelter escape: dig down, seal above).

import { Vec3 } from 'vec3';
import { handDiggable, dumpState, isWall, placeableDirt } from './night.js';
import { mobDigging } from '../../../packages/rotn-data/index.js';
import { isEmpty, isLiquid, hazardOf, hurtsOnContact, isFalling, mobIn, centerIn, fillCell, craftMore, shelterItems, softItems, wallItems, nearbyDiggers, countOf } from './shelter.js';
import { threatFor } from './threats.js';
import { isTreePart } from './fall_safety.js';
import { toolAllows, allowedTool } from './rotn_sources.js';
import { digWithin, digBudget } from './pit.js';
import { log, craftRecipe } from './skills.js';

/**
 * startMargin/stopMargin: blocks past the mob's blast range (mobDigging maxDistance; fallbackReach
 * for a digger with none) where a burrow starts and stops. maxSteps: steps a night; maxMs: one
 * burrow; minGain: how much farther (3D, feet to feet) each step must take the bot; fallMs: the
 * wait for the drop of a step down.
 */
export const BURROW = { startMargin: 1.5, stopMargin: 2.5, fallbackReach: 5.47, maxSteps: 16, maxMs: 60_000, minGain: 0.5, fallMs: 1500 };

const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const at = (p) => `${p.x}, ${p.y}, ${p.z}`;
const key = (p) => `${p.x},${p.y},${p.z}`;
const regName = (n) => (typeof n === 'string' && n.includes(':') ? n : `minecraft:${n}`);

function diggingOf(e) {
    try { return mobDigging(regName(e?.name)) ?? null; } catch { return null; }
}

/** A mob to burrow away from: one to avoid that digs through anything (a blaster: the troll; or a digger that needs no tool). */
export function burrowsFrom(e) {
    if (threatFor(e)?.reaction !== 'avoid') return false;
    const d = diggingOf(e);
    return !!d?.digs && (d.mechanism === 'blast' || d.requiresTools === false);
}

/** {start, stop}: the distances (3D, feet to feet) at which a burrow from this mob starts and stops. */
export function burrowRanges(e) {
    const d = diggingOf(e);
    const reach = Number.isFinite(d?.maxDistance) ? d.maxDistance : BURROW.fallbackReach;
    return { start: reach + BURROW.startMargin, stop: reach + BURROW.stopMargin };
}

/** The nearest mob to burrow away from within its start range: {mob, d, ranges}, or null. */
export function burrowThreat(bot) {
    const here = bot?.entity?.position;
    if (!here) return null;
    let best = null;
    for (const e of Object.values(bot.entities ?? {})) {
        if (!e || e === bot.entity || !e.position || !burrowsFrom(e)) continue;
        const d = e.position.distanceTo(here), ranges = burrowRanges(e);
        if (d <= ranges.start && (!best || d < best.d)) best = { mob: e, d, ranges };
    }
    return best;
}

/**
 * #435 review: the tool rule for breaking b, from rotn-data's dump (moved here from night_routine.js
 * for the burrow): {type, minLevel} when the dump says a tool is required, null when the hand will
 * do, false when nothing breaks it (negative hardness, or a tool required but none named: bedrock),
 * undefined when the dump does not know the block. The registry's canHarvest is no guide on this
 * pack: forge-bridge leaves harvestTools unset for modded blocks, so it says yes to modded rock by hand.
 */
export function digRule(b) {
    const st = dumpState(b);
    if (!st) return undefined;
    if (st.hardness < 0 || (st.toolRequired && !st.harvestTool)) return false;
    if (!st.toolRequired) return null;
    return { type: st.harvestTool, minLevel: Number.isInteger(st.harvestLevel) ? Math.max(0, st.harvestLevel) : 0 };
}

/**
 * #435 review 2: the equip for a dig, when the dump knows the block: a tool it requires is put in
 * hand explicitly (the best one the rule allows; false when none is carried); otherwise
 * equipForBlock picks, and the hand is good enough. Undefined: digWithin's own equip and check.
 */
export function digEquip(bot, block) {
    const rule = digRule(block);
    if (rule === undefined) return undefined;
    if (rule === false) return () => Promise.resolve(false);
    if (rule === null) return async () => { try { await bot.tool?.equipForBlock?.(block); } catch { /* the hand will do */ } return true; };
    return async () => {
        const tool = allowedTool(bot, rule);
        if (!tool) return false;
        if (bot.heldItem?.name !== tool.name || (bot.heldItem?.metadata ?? 0) !== (tool.metadata ?? 0)) await bot.equip(tool, 'hand');
        return true;
    };
}

/** Ground around a burrow: a full solid block, not a liquid, a hazard or a block that hurts on contact. */
const solid = (b) => !!b && b.boundingBox === 'block' && !isLiquid(b) && !hazardOf(b) && !hurtsOnContact(b);

/** Whether the bot can dig b out of its way: empty already, or ground it can break with its hand or a tool it holds (a pickaxe for stone). Never a tree part. */
export function burrowDiggable(bot, b) {
    if (isEmpty(b)) return true;
    if (!solid(b) || isTreePart(b)) return false;
    const rule = digRule(b);
    if (rule === null) return true;
    if (rule === undefined) return handDiggable(b);
    if (rule === false) return false;
    return toolAllows(bot, rule);
}

/** The blocks the bot holds to seal with (sturdy, dirt, and dirt from piles). */
const sealBlocks = (bot) => countOf(shelterItems(bot)) + placeableDirt(bot.inventory.items());

/**
 * Soak 7 (C): whether a body (not the bot) overlaps the cell, so nothing can be placed there (a
 * zombie that walked into the bot's own cell); its hitbox, not just its feet's block.
 */
const BODY_TYPES = ['player', 'mob', 'hostile', 'animal', 'passive', 'ambient', 'water_creature']; // as shelter.js mobIn

function bodyOverlaps(bot, c) {
    return Object.values(bot.entities ?? {}).some(e => {
        if (!e || e === bot.entity || !e.position || !BODY_TYPES.includes(e.type ?? 'mob')) return false;
        const w = (Number.isFinite(e.width) ? e.width : 0.6) / 2, h = Number.isFinite(e.height) ? e.height : 1.8;
        return e.position.x + w > c.x && e.position.x - w < c.x + 1 && e.position.z + w > c.z && e.position.z - w < c.z + 1
            && e.position.y + h > c.y && e.position.y < c.y + 1;
    });
}

/**
 * The next burrow step away from mob, or {why} when there is none. A step: {kind: 'side'|'down',
 * to (the new feet cell), dig (the cells to dig, in order), seal (the cells to fill behind), d (the
 * new distance)}. side: the 1x2 column beside the bot, its far side, both flanks, roof and floor
 * solid ground, nothing that falls above it; seal: the bot's two cells. down: the two blocks under
 * its feet, each one's four sides and the floor below solid ground; seal: the bot's feet cell (the
 * new roof). #507 review 1: the floor never a block that falls; a falling block beside the new cell
 * only on solid ground that is not dug. Each cell to dig must be diggable (burrowDiggable) with no body in it, and the step must
 * take the bot BURROW.minGain farther from the mob; the farthest wins. Soak 7 (C): no step whose
 * seal cells hold a body (a zombie in the bot's own cell), and with prefer ('down') that step wins
 * whenever it is allowed.
 */
export function burrowStep(bot, mob, { prefer = null } = {}) {
    const here = bot.entity.position, p = here.floored();
    const now = here.distanceTo(mob.position);
    if (sealBlocks(bot) < 1) return { why: 'no blocks to seal with' };
    const steps = [];
    for (const d of HORIZONTAL) {
        const r0 = p.plus(d), r1 = r0.offset(0, 1, 0);
        const perp = [new Vec3(d.z, 0, d.x), new Vec3(-d.z, 0, -d.x)];
        steps.push({ kind: 'side', dir: d, to: r0, dig: [r1, r0], seal: [p, p.offset(0, 1, 0)], fallsFrom: r1.offset(0, 1, 0), floor: r0.offset(0, -1, 0),
            around: [r0.plus(d), r1.plus(d), ...perp.flatMap(q => [r0.plus(q), r1.plus(q)]), r1.offset(0, 1, 0)] });
    }
    const d1 = p.offset(0, -1, 0), d2 = p.offset(0, -2, 0);
    steps.push({ kind: 'down', to: d2, dig: [d1, d2], seal: [p], fallsFrom: null, floor: d2.offset(0, -1, 0),
        around: HORIZONTAL.flatMap(h => [d1.plus(h), d2.plus(h)]) });
    const why = new Map();
    let best = null;
    for (const s of steps) {
        const name = s.kind === 'down' ? 'down' : `${s.dir.x},${s.dir.z}`;
        const bad = s.dig.find(c => !burrowDiggable(bot, bot.blockAt(c)) || mobIn(bot, c));
        if (bad) { why.set(name, `${bot.blockAt(bad)?.name ?? 'unloaded'} at ${at(bad)} cannot be dug`); continue; }
        const open = s.around.find(c => !solid(bot.blockAt(c)));
        if (open) { why.set(name, `${bot.blockAt(open)?.name ?? 'unloaded'} at ${at(open)}: not enclosed`); continue; }
        // #507 review 1 (pit.js pitProblem, #337 review 4): never a floor that falls (gravel, sand), and
        // no falling block beside the new cell without solid ground under it that stays.
        const floor = bot.blockAt(s.floor);
        if (!solid(floor) || isFalling(floor)) { why.set(name, `no firm floor at ${at(s.floor)} (${floor?.name ?? 'unloaded'})`); continue; }
        if (s.fallsFrom && isFalling(bot.blockAt(s.fallsFrom))) { why.set(name, `${bot.blockAt(s.fallsFrom).name} above would fall in`); continue; }
        const digKeys = new Set(s.dig.map(key));
        const loose = s.around.find(c => isFalling(bot.blockAt(c))
            && (digKeys.has(key(c.offset(0, -1, 0))) || !solid(bot.blockAt(c.offset(0, -1, 0)))));
        if (loose) { why.set(name, `${bot.blockAt(loose).name} at ${at(loose)} has nothing solid under it and would fall in`); continue; }
        if (sealBlocks(bot) < s.seal.length) { why.set(name, `${s.seal.length} blocks to seal with, ${sealBlocks(bot)} held`); continue; }
        const held = s.seal.find(c => bodyOverlaps(bot, c));
        if (held) { why.set(name, `a body in ${at(held)}, which the step seals`); continue; }
        const d = s.to.offset(0.5, 0, 0.5).distanceTo(mob.position);
        if (d < now + BURROW.minGain) { why.set(name, `not farther from it (${d.toFixed(1)})`); continue; }
        if (prefer && s.kind === prefer) return { ...s, d }; // soak 7 (C): the step down first when it is allowed
        if (!best || d > best.d) best = { ...s, d };
    }
    if (best) return best;
    return { why: [...why].map(([k, v]) => `${k}: ${v}`).join('; ') || 'no step' };
}

/** Wait (bounded) until the bot's feet are in cell. */
async function settleIn(bot, cell, ms) {
    for (let waited = 0; waited < ms; waited += 50) {
        if (bot.entity.position.floored().equals(cell)) return true;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    return bot.entity.position.floored().equals(cell);
}

/**
 * Take one burrow step (burrowStep): the seal's blocks first (dirt crafted from piles), then dig,
 * move in (a step aside, or the drop down), then fill the cells behind. {site} when the bot is in
 * the new cell with everything behind it sealed; {site, why} when it is in but a seal failed;
 * {why} when it did not get in.
 */
export async function takeBurrowStep(bot, step, { craft = craftRecipe } = {}) {
    const have = () => countOf(shelterItems(bot)) + countOf(softItems(bot));
    if (have() < step.seal.length) await craftMore(bot, 'dirt', step.seal.length - have(), craft);
    if (have() < step.seal.length) return { why: `only ${have()} of the ${step.seal.length} blocks to seal with` };
    for (const c of step.dig) {
        const block = bot.blockAt(c);
        if (isEmpty(block)) continue;
        const equip = digEquip(bot, block);
        const dug = await digWithin(bot, block, digBudget(bot, block).limitMs, equip ? { equip } : {});
        if (dug !== true) return { why: `could not dig ${block.name} at ${at(c)}${dug === 'timeout' ? ' in time' : ''}` };
        if (bot.interrupt_code) return { why: 'interrupted' };
    }
    if (step.kind === 'side') await centerIn(bot, step.to);
    if (!await settleIn(bot, step.to, step.kind === 'down' ? BURROW.fallMs : 0)) return { why: `could not get into ${at(step.to)}` };
    const interior = new Set([key(step.to), key(step.to.offset(0, 1, 0))]);
    const mode = { items: (b) => wallItems(b, [...shelterItems(b), ...softItems(b)], nearbyDiggers(b)), accept: isWall };
    for (const c of step.seal) {
        if (!await fillCell(bot, c, interior, mode)) return { site: step.to, why: `could not seal ${at(c)}` };
    }
    return { site: step.to };
}

/**
 * Burrow away from mob (the night routine's job): steps until the mob is at its stop range or
 * farther (or gone), no step is left, maxSteps are taken, or maxMs is up. Never a hit at the mob.
 * @returns {Promise<{steps: number, site: Vec3|null, stopped: string, why?: string}>} site: the cell
 *   the bot ended in when it moved (null: it did not); stopped: 'far', 'gone', 'cornered', 'budget',
 *   'time', 'failed' (a step did not work: why).
 */
export async function burrowAway(bot, mob, { maxSteps = BURROW.maxSteps, maxMs = BURROW.maxMs, craft = craftRecipe, now = () => Date.now(), stopAt = null, prefer = null } = {}) {
    const start = now();
    const stop = Number.isFinite(stopAt) ? stopAt : burrowRanges(mob).stop;
    let steps = 0, site = null;
    for (;;) {
        const m = bot.entities?.[mob.id] ?? null;
        if (!m?.position) return { steps, site, stopped: 'gone' };
        const d = m.position.distanceTo(bot.entity.position);
        if (d >= stop) return { steps, site, stopped: 'far' };
        if (steps >= maxSteps) return { steps, site, stopped: 'budget' };
        if (now() - start >= maxMs) return { steps, site, stopped: 'time' };
        const step = burrowStep(bot, m, { prefer });
        if (!step.to) return { steps, site, stopped: 'cornered', why: step.why };
        const r = await takeBurrowStep(bot, step, { craft });
        if (r.site) { site = r.site; steps++; }
        if (r.why) return { steps, site, stopped: 'failed', why: r.why };
        log(bot, `Burrowed ${step.kind === 'down' ? 'down' : 'aside'} into ${at(step.to)}, ${step.d.toFixed(1)} blocks from the ${m.name}, and sealed ${step.seal.map(at).join(' and ')} behind.`);
        if (bot.interrupt_code) return { steps, site, stopped: 'failed', why: 'interrupted' };
    }
}
