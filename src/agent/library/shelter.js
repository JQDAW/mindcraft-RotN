// Building the first-night shelter (skills-rotn D2b): a closed 1x2 space whose walls and roof are
// sturdy (rock, a full cube, stone's hardness or more; night.js isSturdy). RotN's mobs dig through
// dirt and wood, so those are replaced. The bot builds from inside, so upstream placeBlock (which
// walks away from a target closer than 1.1 blocks) is not used. No light is placed.
//
// The floor is kept when it is a solid block, sturdy or not: replacing it means digging under the
// bot, and a mob would have to come from below. A known limit, named in the log line.
//
// Each site is dry-run first (siteNeeds), in the build order: a cell that has to be dug must not
// have a falling block above it or a liquid next to it outside the shell (#195 review 1), and every
// cell must have a face to be placed against when its turn comes (review 3).

import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { isSturdy, shelterShell, dumpState } from './night.js';
import { loadRotnData, PACK_VERSION, registryName } from '../../../packages/rotn-data/index.js';
import { toolLevels, carriedItems } from './rotn_sources.js';
import { log, breakBlockAt, goToGoal } from './skills.js';

const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const SIX = [new Vec3(0, -1, 0), ...HORIZONTAL, new Vec3(0, 1, 0)];
const HAZARD = /lava|fire/;
/** How long a placement's block update may come late (P1 measured up to 1158 ms) before a retry. */
export const LATE_UPDATE_MS = 1200;

export const isLiquid = (b) => !!b && (/water|lava/.test(b.name ?? '') || dumpState(b)?.liquid === true);
export const isEmpty = (b) => !!b && b.boundingBox === 'empty' && !isLiquid(b) && !/fire/.test(b.name ?? '');
const isSolid = (b) => !!b && b.boundingBox === 'block';
/** A block that falls when undermined: rotn-data's falls() (#205), else gravel, sand, concrete powder, anvils, the dragon egg. */
export const isFalling = (b) => {
    if (typeof b?.name !== 'string' || !b.name) return false;
    // rotn-data's per-block gravity (#205: BlockFalling and the pack's modded falling blocks).
    let falls = null;
    try { falls = loadRotnData(PACK_VERSION).falls(registryName(b.name)); } catch { falls = null; }
    if (typeof falls === 'boolean') return falls;
    // A block rotn-data does not know: judged by name and material, as before.
    const st = dumpState(b);
    return /sand|gravel|anvil|dragon_egg|concrete_powder/.test(b.name) || ['sand', 'anvil', 'dragon_egg'].includes(st?.material);
};
const key = (p) => `${p.x},${p.y},${p.z}`;
const at = (p) => `${p.x}, ${p.y}, ${p.z}`;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Inventory stacks the shelter may use (sturdy as blocks), cobblestone first, then the biggest. */
export function shelterItems(bot) {
    return bot.inventory.items()
        .filter(i => isSturdy({ name: i.name, metadata: i.metadata ?? 0 }))
        .sort((a, b) => (b.name === 'cobblestone') - (a.name === 'cobblestone') || b.count - a.count);
}

const countOf = (items) => items.reduce((n, i) => n + i.count, 0);

/** The walls (4 sides x 2, lower first) and the roof of the 1x2 space at feet, in build order. */
function wallsAndRoof(p) {
    const shell = shelterShell(p); // floor, roof, then each side lower and upper
    return [...shell.slice(2).filter((_, i) => i % 2 === 0), ...shell.slice(2).filter((_, i) => i % 2 === 1), shell[1]];
}

/** Where a block can go against a solid neighbour (never the bot's own 1x2 space): the neighbour, or null. */
function supportFor(pos, interior, solidAt) {
    for (const d of SIX) {
        const q = pos.plus(d);
        if (!interior.has(key(q)) && solidAt(q)) return q;
    }
    return null;
}

/** The cell next to the roof to hold it up from, when nothing is next to the roof: on a finished wall. */
function propFor(roof, solidAt, emptyAt) {
    return HORIZONTAL.map(d => roof.plus(d)).find(q => solidAt(q.offset(0, -1, 0)) && emptyAt(q)) ?? null;
}

/**
 * Dry run of a shelter at feet, in the build order: the cells to fill, the blocks that takes (a
 * roof prop included), the cells that would have no face to be placed against (`unsupported`), and
 * why digging would be unsafe (`unsafe`: a falling block above or a liquid next to a cell to dig).
 * null when the site cannot be used at all: the floor is not solid, the 1x2 space is not free, a
 * shell cell is lava or fire, or a block is not loaded.
 */
export function siteNeeds(bot, feet) {
    const p = new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z));
    if (!isSolid(bot.blockAt(p.offset(0, -1, 0)))) return null;
    if (!isEmpty(bot.blockAt(p)) || !isEmpty(bot.blockAt(p.offset(0, 1, 0)))) return null;
    const order = wallsAndRoof(p);
    if (order.some(q => { const b = bot.blockAt(q); return !b || HAZARD.test(b.name ?? ''); })) return null;

    const interior = new Set([key(p), key(p.offset(0, 1, 0))]);
    const shell = new Set(order.map(key));
    const sim = new Map(); // key -> 'solid' | 'empty', the cells the build changes
    const solidAt = (q) => (sim.has(key(q)) ? sim.get(key(q)) === 'solid' : isSolid(bot.blockAt(q)));
    const emptyAt = (q) => (sim.has(key(q)) ? sim.get(key(q)) === 'empty' : isEmpty(bot.blockAt(q)));
    const todo = [], unsupported = [];
    let blocks = 0, unsafe = null;
    for (const pos of order) {
        const b = bot.blockAt(pos);
        if (isSturdy(b)) continue;
        todo.push(pos);
        if (!isEmpty(b) && !isLiquid(b)) { // dug first
            const above = bot.blockAt(pos.offset(0, 1, 0));
            if (!unsafe && isFalling(above))
                unsafe = `${above.name} above ${at(pos)} would fall in`;
            const wet = SIX.map(d => pos.plus(d)).find(q => !interior.has(key(q)) && !shell.has(key(q)) && isLiquid(bot.blockAt(q)));
            if (!unsafe && wet) unsafe = `${bot.blockAt(wet).name} next to ${at(pos)} would flow in`;
            sim.set(key(pos), 'empty');
        }
        if (!supportFor(pos, interior, solidAt) && pos.equals(p.offset(0, 2, 0))) {
            const prop = propFor(pos, solidAt, emptyAt);
            if (prop) { sim.set(key(prop), 'solid'); blocks++; }
        }
        if (supportFor(pos, interior, solidAt)) sim.set(key(pos), 'solid');
        else unsupported.push(pos);
        blocks++;
    }
    return { feet: p, todo, blocks, unsupported, unsafe };
}

/**
 * The site within `radius` (and 2 up or down) that needs the fewest blocks, then the nearest. Only
 * sites where digging is safe and every cell has a support face count (#195 review 1 and 3).
 */
export function chooseSite(bot, radius = 4) {
    const base = bot.entity.position.floored();
    let best = null;
    for (let dy = -2; dy <= 2; dy++)
        for (let dx = -radius; dx <= radius; dx++)
            for (let dz = -radius; dz <= radius; dz++) {
                const need = siteNeeds(bot, base.offset(dx, dy, dz));
                if (!need || need.unsafe || need.unsupported.length > 0) continue;
                const score = need.blocks * 4 + Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
                if (!best || score < best.score) best = { ...need, score };
            }
    return best;
}

/**
 * The pickaxe level needed to dig back out: the highest harvest level of the blocks the walls will
 * be made of (the bot's sturdy items and the rock already in the shell). 0 for cobblestone and stone.
 */
function exitLevel(bot, feet) {
    const blocks = [...shelterItems(bot).map(i => ({ name: i.name, metadata: i.metadata ?? 0 })),
        ...wallsAndRoof(feet).map(q => bot.blockAt(q)).filter(isSturdy)];
    return Math.max(0, ...blocks.map(b => dumpState(b)?.harvestLevel).filter(Number.isInteger));
}

/** Walk (sneaking) to the middle of the cell, so a wall placed next to the bot does not hit it. */
async function centerIn(bot, p, { timeoutMs = 2000 } = {}) {
    const c = p.offset(0.5, 0, 0.5);
    const off = () => Math.hypot(bot.entity.position.x - c.x, bot.entity.position.z - c.z);
    if (off() <= 0.15) return true;
    try {
        bot.setControlState('sneak', true);
        for (let waited = 0; off() > 0.15 && waited < timeoutMs; waited += 50) {
            await bot.lookAt(new Vec3(c.x, bot.entity.position.y + 1.62, c.z), true);
            bot.setControlState('forward', true);
            await sleep(50);
        }
    } finally {
        bot.setControlState('forward', false);
        bot.setControlState('sneak', false);
    }
    return off() <= 0.15;
}

/** Entity types that block a placement: mobs and players (mineflayer's 1.12 'mob', and the newer names). */
const BODY_TYPES = ['player', 'mob', 'hostile', 'animal', 'passive', 'ambient', 'water_creature'];

/**
 * A mob or player (not the bot) standing in the cell, which a block cannot be placed into.
 * Dropped items, XP orbs and arrows do not count (#204 re-review 2).
 */
export function mobIn(bot, cell) {
    return Object.values(bot.entities ?? {}).find(e => e && e !== bot.entity && e.position && BODY_TYPES.includes(e.type)
        && Math.floor(e.position.x) === cell.x && Math.floor(e.position.z) === cell.z
        && e.position.y > cell.y - (e.height ?? 1.8) && e.position.y < cell.y + 1) ?? null;
}

/** One placement of a sturdy block at target against a solid neighbour outside the 1x2 space. */
async function placeOnce(bot, target, interior) {
    const item = shelterItems(bot)[0];
    if (!item) return false;
    const mob = mobIn(bot, target);
    if (mob) {
        // #204 nit: say why the cell stays open, instead of a placement that fails without a word.
        log(bot, `Cannot close ${at(target)}: ${mob.name ?? mob.displayName ?? 'a mob'} stands in it.`);
        return false;
    }
    const refPos = supportFor(target, interior, (q) => isSolid(bot.blockAt(q)));
    if (!refPos) return false;
    const ref = bot.blockAt(refPos);
    const face = target.minus(refPos);
    try {
        await bot.equip(item, 'hand');
        await bot.lookAt(ref.position.offset(0.5, 0.5, 0.5).plus(face.scaled(0.5)), true);
        await bot.placeBlock(ref, face);
    } catch {
        // mineflayer can throw although the block was placed (a late or missed update): look.
    }
    return isSturdy(bot.blockAt(target));
}

/**
 * Make one cell sturdy: place, and when the block is not there, wait for a late update, look
 * again and try once more (#195 review 4).
 */
async function fillCell(bot, target, interior) {
    for (let attempt = 0; attempt < 2; attempt++) {
        if (isSturdy(bot.blockAt(target))) return true;
        if (!isEmpty(bot.blockAt(target)) && !isLiquid(bot.blockAt(target))) return false;
        if (await placeOnce(bot, target, interior)) return true;
        await sleep(LATE_UPDATE_MS);
        if (isSturdy(bot.blockAt(target))) return true;
    }
    return false;
}

/**
 * Build (or repair) a shelter: choose a site nearby (the bot's own cell when it is usable and needs
 * no more blocks than another), go there, then make every wall and the roof sturdy, from inside.
 * It needs a pickaxe that can dig the walls, so the bot can always get out again (#195 review 2).
 * Each line it logs comes from the bot's own view of the world, never from a command's chat reply.
 * @param {{site?: Vec3, radius?: number}} [opts] site: repair the shelter at this feet position.
 * @returns {Promise<{closed: boolean, feet: Vec3|null, placed: number, missing: Vec3[], line: string}>} line: what it logged.
 */
export async function buildShelter(bot, { site = null, radius = 4 } = {}) {
    const plan = site ? siteNeeds(bot, site) : chooseSite(bot, radius);
    const refuse = (feet, missing, line) => { log(bot, line); return { closed: false, feet, placed: 0, missing, line }; };
    if (!plan)
        return refuse(null, [], site ? `Cannot repair the shelter at ${at(site.floored())}: the space or its floor is not usable.`
            : `Found no place for a shelter within ${radius} blocks (needs a solid floor, a free 1x2 space, safe digging and a face for every block).`);
    const { feet } = plan;
    if (plan.unsafe) return refuse(feet, plan.todo, `Cannot build the shelter at ${at(feet)}: ${plan.unsafe}.`);
    // chooseSite never returns such a site; a site the caller names is checked too (#195 nit).
    if (plan.unsupported.length > 0)
        return refuse(feet, plan.todo, `Cannot build the shelter at ${at(feet)}: nothing to place a block against at ${plan.unsupported.map(at).join('; ')}.`);
    const level = exitLevel(bot, feet);
    if (!toolLevels(bot, 'pickaxe').some(l => l >= level)) {
        // Say what the bot does carry, so a log shows why (G3 round 2 B).
        const picks = carriedItems(bot).filter(i => /pickaxe/.test(i.name)).map(i => i.name);
        return refuse(feet, plan.todo, `Not building a shelter at ${at(feet)}: without a pickaxe${level > 0 ? ` of level ${level}` : ''} you could not dig out of it again.`
            + ` Pickaxes carried: ${picks.length ? picks.join(', ') : 'none'}; the walls need level ${level}.`);
    }
    const have = countOf(shelterItems(bot));
    if (have < plan.blocks)
        return refuse(feet, plan.todo, `A shelter at ${at(feet)} needs ${plan.blocks} sturdy blocks (cobblestone or stone); you have ${have}.`);

    if (!bot.entity.position.floored().equals(feet)) {
        try { await goToGoal(bot, new pf.goals.GoalBlock(feet.x, feet.y, feet.z)); } catch { /* checked below */ }
        if (!bot.entity.position.floored().equals(feet))
            return refuse(feet, plan.todo, `Could not reach the shelter site at ${at(feet)}.`);
    }
    if (!await centerIn(bot, feet))
        return refuse(feet, plan.todo, `Could not stand in the middle of the shelter site at ${at(feet)}, so a wall could hit you; not building.`);

    const interior = new Set([key(feet), key(feet.offset(0, 1, 0))]);
    const roof = feet.offset(0, 2, 0);
    let placed = 0;
    // Building keeps the bot in its cell on purpose: unstuck leaves it alone meanwhile (modes.js).
    bot.rotnStationary = true;
    try {
        for (const pos of wallsAndRoof(feet)) {
            if (bot.interrupt_code) break;
            const b = bot.blockAt(pos);
            if (isSturdy(b)) continue;
            if (!isEmpty(b) && !isLiquid(b)) {
                if (!await breakBlockAt(bot, pos.x, pos.y, pos.z)) continue;
            }
            if (pos.equals(roof) && !supportFor(roof, interior, (q) => isSolid(bot.blockAt(q)))) {
                // Nothing next to the roof cell: hold it up with one block on top of a finished wall.
                const prop = propFor(roof, (q) => isSturdy(bot.blockAt(q)), (q) => isEmpty(bot.blockAt(q)));
                if (prop && await fillCell(bot, prop, interior)) placed++;
            }
            if (await fillCell(bot, pos, interior)) placed++;
        }
    } finally {
        bot.rotnStationary = false;
    }
    const missing = wallsAndRoof(feet).filter(q => !isSturdy(bot.blockAt(q)));
    const floor = bot.blockAt(feet.offset(0, -1, 0));
    const floorNote = isSturdy(floor) ? '' : ` The floor is ${floor?.name ?? 'unknown'}, not rock.`;
    const line = missing.length === 0
        ? `Shelter closed at ${at(feet)}: placed ${placed} blocks.${floorNote}`
        : `Shelter at ${at(feet)} is not closed: ${missing.length} open (${missing.map(at).join('; ')}); placed ${placed}.`;
    log(bot, line);
    return { closed: missing.length === 0, feet, placed, missing, line };
}
