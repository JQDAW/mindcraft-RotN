// Building the first-night shelter (skills-rotn D2b): a closed 1x2 space whose walls and roof are
// sturdy (night.js isSturdy: rock of stone's hardness or more, or any cobblestone or stone of the
// pack's ore dictionary; always a full cube). RotN's mobs dig through dirt and wood, so those are
// replaced; dirt is only the fallback when sturdy blocks or a pickaxe are missing (G3 round 6 B).
// The bot builds from inside, so upstream placeBlock (which
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
import { isSturdy, isSoftWall, isWall, handDiggable, dirtPileRecipes, shelterShell, dumpState } from './night.js';
import { loadRotnData, PACK_VERSION, registryName, botName } from '../../../packages/rotn-data/index.js';
import { formatName } from './rotn_names.js';
import { toolLevels, stowCarried, describeCarried } from './rotn_sources.js';
import { cobbleChoices } from './cobble.js';
import { log, breakBlockAt, goToGoal, craftRecipe } from './skills.js';

const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const SIX = [new Vec3(0, -1, 0), ...HORIZONTAL, new Vec3(0, 1, 0)];
/** How long a placement's block update may come late (P1 measured up to 1158 ms) before a retry. */
export const LATE_UPDATE_MS = 1200;

/**
 * Real fire or lava: rotn-data's material (G3 round 7 B), so a block whose name only holds "fire"
 * (every iceandfire: block, unfired pottery, a firefly) is no hazard. By name for a block rotn-data
 * does not know.
 */
export const hazardOf = (b) => {
    if (typeof b?.name !== 'string' || !b.name) return null;
    const material = dumpState(b)?.material;
    if (material) return ['fire', 'lava'].includes(material) ? material : null;
    return /(^|[:_])(fire|lava)$/.exec(b.name)?.[2] ?? null;
};
export const isLiquid = (b) => !!b && (/water|lava/.test(b.name ?? '') || dumpState(b)?.liquid === true);
export const isEmpty = (b) => !!b && b.boundingBox === 'empty' && !isLiquid(b) && !hazardOf(b);
const isSolid = (b) => !!b && b.boundingBox === 'block';
/**
 * A block the bot's body cannot share a cell with: rotn-data's solid material with a collision box
 * (a carpet, a snow layer, a torch or grass are not); mineflayer's bounding box for an unknown block.
 */
const isBodyBlock = (b) => {
    const st = dumpState(b);
    if (st && typeof st.solid === 'boolean') return st.solid && (st.collision?.length ?? 0) > 0;
    return isSolid(b);
};
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

/** Inventory stacks of the fallback block (dirt), the biggest first (G3 round 6 B). */
export function softItems(bot) {
    return bot.inventory.items()
        .filter(i => isSoftWall({ name: i.name, metadata: i.metadata ?? 0 }))
        .sort((a, b) => b.count - a.count);
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
 * Why a site cannot be used at all, or null: `{pos, block, why, text}`, text naming the block and
 * where it is. A new site needs a solid floor, a free 1x2 space and no fire or lava in its walls
 * and roof. `occupied` (the shelter the bot is in, G3 round 7 B): only real fire or lava there, or
 * a solid block in the bot's two cells, counts; a torch, a carpet, a snow layer, grass or water in
 * the space does not, nor the floor (when it goes, the bot falls and is no longer in the shelter).
 * Dropped items are entities, never blocks, so they never count.
 */
export function siteProblem(bot, feet, { occupied = false } = {}) {
    const p = new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z));
    const found = (pos, b, why) => ({ pos, block: b?.name ?? 'unloaded', why, text: `${b?.name ?? 'an unloaded block'} at ${at(pos)} (${why})` });
    const floor = p.offset(0, -1, 0);
    if (!occupied && !isSolid(bot.blockAt(floor))) return found(floor, bot.blockAt(floor), 'the floor is not solid');
    for (const q of [p, p.offset(0, 1, 0)]) {
        const b = bot.blockAt(q);
        if (!b) return found(q, b, 'not loaded');
        const hazard = hazardOf(b);
        if (hazard) return found(q, b, `${hazard} in the 1x2 space`);
        if (occupied ? isBodyBlock(b) : !isEmpty(b)) return found(q, b, occupied ? 'a solid block in the 1x2 space' : 'the 1x2 space is not free');
    }
    for (const q of wallsAndRoof(p)) {
        const b = bot.blockAt(q);
        if (!b) return found(q, b, 'not loaded');
        const hazard = hazardOf(b);
        if (hazard) return found(q, b, `${hazard} in the walls or roof`);
    }
    return null;
}

/**
 * Dry run of a shelter at feet, in the build order: the cells to fill, the blocks that takes (a
 * roof prop included), the cells that would have no face to be placed against (`unsupported`), and
 * why digging would be unsafe (`unsafe`: a falling block above or a liquid next to a cell to dig).
 * null when the site cannot be used at all (siteProblem says why): the floor is not solid, the 1x2
 * space is not free, a shell cell is lava or fire, or a block is not loaded. `occupied`: the
 * shelter the bot is in (siteProblem).
 */
export function siteNeeds(bot, feet, { accept = isSturdy, occupied = false } = {}) {
    const p = new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z));
    if (siteProblem(bot, p, { occupied })) return null;
    const order = wallsAndRoof(p);

    const interior = new Set([key(p), key(p.offset(0, 1, 0))]);
    const shell = new Set(order.map(key));
    const sim = new Map(); // key -> 'solid' | 'empty', the cells the build changes
    const solidAt = (q) => (sim.has(key(q)) ? sim.get(key(q)) === 'solid' : isSolid(bot.blockAt(q)));
    const emptyAt = (q) => (sim.has(key(q)) ? sim.get(key(q)) === 'empty' : isEmpty(bot.blockAt(q)));
    const todo = [], unsupported = [];
    let blocks = 0, unsafe = null;
    for (const pos of order) {
        const b = bot.blockAt(pos);
        if (accept(b)) continue;
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
    // A side the bot can dig out of by hand (both cells filled with dirt or already hand-diggable):
    // what a shelter built without a pickaxe needs (G3 round 6 B).
    const filled = new Set(todo.map(key));
    const byHand = (q) => filled.has(key(q)) || handDiggable(bot.blockAt(q));
    const handExit = HORIZONTAL.some(d => byHand(p.plus(d)) && byHand(p.plus(d).offset(0, 1, 0)));
    return { feet: p, todo, blocks, unsupported, unsafe, handExit };
}

/**
 * The site within `radius` (and 2 up or down) that needs the fewest blocks, then the nearest. Only
 * sites where digging is safe and every cell has a support face count (#195 review 1 and 3).
 */
export function chooseSite(bot, radius = 4, { accept = isSturdy, handExit = false } = {}) {
    const base = bot.entity.position.floored();
    let best = null;
    for (let dy = -2; dy <= 2; dy++)
        for (let dx = -radius; dx <= radius; dx++)
            for (let dz = -radius; dz <= radius; dz++) {
                const need = siteNeeds(bot, base.offset(dx, dy, dz), { accept });
                if (!need || need.unsafe || need.unsupported.length > 0 || (handExit && !need.handExit)) continue;
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

/**
 * One placement at target against a solid neighbour outside the 1x2 space. mode.items(bot): the
 * stacks to place, best first; mode.accept(block): what counts as a wall.
 */
async function placeOnce(bot, target, interior, mode) {
    const item = mode.items(bot)[0];
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
    return mode.accept(bot.blockAt(target));
}

/**
 * Make one cell a wall: place, and when the block is not there, wait for a late update, look
 * again and try once more (#195 review 4).
 */
async function fillCell(bot, target, interior, mode) {
    for (let attempt = 0; attempt < 2; attempt++) {
        if (mode.accept(bot.blockAt(target))) return true;
        if (!isEmpty(bot.blockAt(target)) && !isLiquid(bot.blockAt(target))) return false;
        if (await placeOnce(bot, target, interior, mode)) return true;
        await sleep(LATE_UPDATE_MS);
        if (mode.accept(bot.blockAt(target))) return true;
    }
    return false;
}

/** The refusal for a plan that cannot be built, or null. */
function planProblem(plan, site, radius, handExit, bot = null) {
    if (!plan)
        return site ? `Cannot repair the shelter at ${at(site.floored())}: ${siteProblem(bot, site, { occupied: true })?.text ?? 'the space is not usable'}.`
            : `Found no place for a shelter within ${radius} blocks (needs a solid floor, a free 1x2 space, safe digging and a face for every block${handExit ? ', and a side you can dig out by hand' : ''}).`;
    if (plan.unsafe) return `Cannot build the shelter at ${at(plan.feet)}: ${plan.unsafe}.`;
    // chooseSite never returns such a site; a site the caller names is checked too (#195 nit).
    if (plan.unsupported.length > 0)
        return `Cannot build the shelter at ${at(plan.feet)}: nothing to place a block against at ${plan.unsupported.map(at).join('; ')}.`;
    if (handExit && !plan.handExit) return `Cannot build the shelter at ${at(plan.feet)}: no side of it could be dug out by hand.`;
    return null;
}

/**
 * Craft more shelter blocks from what the bot holds, before giving up (G3 round 6 B: 44 rocks and
 * 32 dirt piles were held at dusk): cobblestone from rocks (each rock kind makes its own), dirt
 * from dirt piles. The caller counts again afterwards.
 */
async function craftMore(bot, what, short, craft) {
    if (short <= 0) return;
    try {
        if (what === 'cobblestone' && cobbleChoices(bot).length > 0) {
            log(bot, `The shelter needs ${short} more sturdy blocks: making cobblestone from your rocks.`);
            await craft(bot, 'cobblestone', short);
        } else if (what === 'dirt') {
            // Each kind of pile by its own recipe (#284 nit): BWM's dirt pile makes minecraft:dirt,
            // the loamy, sandy and silty piles make Biomes O' Plenty dirt (rotn-data).
            let left = short;
            for (const r of dirtPileRecipes()) {
                const piles = countOf(bot.inventory.items().filter(i => registryName(i.name) === r.name && (i.metadata ?? 0) === r.meta));
                const n = Math.min(left, Math.floor(piles / r.per));
                if (n <= 0) continue;
                const gives = formatName(botName(r.gives.name), r.gives.meta ?? 0);
                log(bot, `The shelter needs ${left} more blocks: making ${n} ${gives} from your ${botName(r.name)} (${r.per} each).`);
                await craft(bot, gives, n);
                left -= n;
                if (left <= 0) break;
            }
        }
    } catch (err) {
        console.warn(`[shelter] could not craft ${what}: ${err?.message ?? err}`);
    }
}

/** Whether the bot holds a pickaxe of at least level, after moving one on the cursor or off hand back. */
async function pickaxeFor(bot, level) {
    if (toolLevels(bot, 'pickaxe').some(l => l >= level)) return { ok: true, where: '' };
    // G3 round 2 B: a pickaxe on the cursor or in the off hand is moved back into the inventory
    // (where every equip path looks), and pending slot updates are awaited, before concluding.
    const isPick = (i) => /pickaxe/.test(i.name);
    const moved = await stowCarried(bot, isPick);
    if (moved.length) log(bot, `Moved ${moved.join(' and ')} back into the inventory.`);
    if (toolLevels(bot, 'pickaxe').some(l => l >= level)) return { ok: true, where: '' };
    const where = describeCarried(bot, isPick);
    console.log(`[shelter] pickaxe check: need level ${level}; ${where}`);
    return { ok: false, where };
}

/**
 * Build (or repair) a shelter: choose a site nearby (the bot's own cell when it is usable and needs
 * no more blocks than another), go there, then make every wall and the roof sturdy, from inside.
 * It needs a pickaxe that can dig the walls, so the bot can always get out again (#195 review 2).
 * Each line it logs comes from the bot's own view of the world, never from a command's chat reply.
 *
 * G3 round 6 B: with too few sturdy blocks, cobblestone is first crafted from the rocks held. Still
 * too few, or no pickaxe (after a death): dirt is the fallback, crafted from dirt piles when needed.
 * Without a pickaxe only dirt is placed, and the site needs a side that can be dug out by hand.
 * @param {{site?: Vec3, radius?: number, keepSoft?: boolean, craft?: Function}} [opts] site: repair the
 *   shelter at this feet position; keepSoft: its dirt walls stay (the night routine's repairs);
 *   craft: how blocks are crafted (skills.craftRecipe; tests pass their own).
 * @returns {Promise<{closed: boolean, feet: Vec3|null, placed: number, missing: Vec3[], soft: number, line: string}>}
 *   line: what it logged; soft: the dirt blocks in its walls and roof.
 */
export async function buildShelter(bot, { site = null, radius = 4, keepSoft = false, craft = craftRecipe } = {}) {
    const refuse = (feet, missing, line) => { log(bot, line); return { closed: false, feet, placed: 0, missing, soft: 0, line }; };
    // 1. A sturdy shelter (rock walls); a repair keeps the dirt walls it has.
    // A repair is of the shelter the bot is in: only fire, lava or a solid block there stops it (G3 round 7 B).
    let plan = site ? siteNeeds(bot, site, { accept: keepSoft ? isWall : isSturdy, occupied: true }) : chooseSite(bot, radius);
    const problem = planProblem(plan, site, radius, false, bot);
    const level = problem ? 0 : exitLevel(bot, plan.feet);
    const pick = await pickaxeFor(bot, level);
    // Without a pickaxe the dirt-wall search is tried before any refusal (#284 review 3): dirt walls
    // already there are kept, so a site the sturdy search had to dig at may need no digging.
    if (problem && pick.ok) return refuse(plan?.feet ?? null, plan?.todo ?? [], problem);
    const sturdy = () => countOf(shelterItems(bot));
    if (pick.ok && sturdy() < plan.blocks) await craftMore(bot, 'cobblestone', plan.blocks - sturdy(), craft);
    let mode = { items: shelterItems, accept: keepSoft ? isWall : isSturdy };

    // 2. The dirt fallback: too few sturdy blocks, or no pickaxe to dig out of rock.
    if (!pick.ok || sturdy() < plan.blocks) {
        const handExit = !pick.ok;
        const soft = site ? siteNeeds(bot, site, { accept: isWall, occupied: true }) : chooseSite(bot, radius, { accept: isWall, handExit });
        // With a pickaxe, the fallback site (it may be another one) must still be one to get out of.
        const softProblem = planProblem(soft, site, radius, handExit, bot)
            ?? (pick.ok && !soft.handExit && !toolLevels(bot, 'pickaxe').some(l => l >= exitLevel(bot, soft.feet))
                ? `Cannot build the shelter at ${at(soft.feet)}: your pickaxe could not dig out of its walls.` : null);
        // Without a pickaxe only dirt goes in: the bot must be able to dig itself out by hand.
        const items = (b) => (pick.ok ? [...shelterItems(b), ...softItems(b)] : softItems(b));
        if (!softProblem && countOf(items(bot)) < soft.blocks) await craftMore(bot, 'dirt', soft.blocks - countOf(items(bot)), craft);
        const have = countOf(items(bot));
        if (!softProblem && have >= soft.blocks) {
            plan = soft;
            mode = { items, accept: isWall };
            log(bot, `Building the shelter with dirt too${pick.ok ? '' : ' (no pickaxe: dirt can be dug out by hand)'}; mobs can dig through dirt.`);
        } else {
            const dirt = countOf(softItems(bot));
            const fallback = softProblem ? `the dirt fallback does not fit here either (${softProblem.replace(/\.$/, '')})`
                : `a shelter with dirt needs ${soft.blocks} blocks, and you have ${have}${pick.ok ? '' : ' dirt'}`;
            if (!pick.ok && problem)
                return refuse(plan?.feet ?? soft?.feet ?? null, plan?.todo ?? [], `Not building a shelter: ${problem.replace(/\.$/, '')}. Without a pickaxe only dirt would do`
                    + ` (Pickaxes: ${pick.where}), but ${fallback}.`);
            if (!pick.ok)
                return refuse(plan.feet, plan.todo, `Not building a shelter at ${at(plan.feet)}: without a pickaxe${level > 0 ? ` of level ${level}` : ''} you could not dig out of it again.`
                    + ` Pickaxes: ${pick.where}. A dirt shelter could be dug out by hand, but ${fallback}.`);
            return refuse(plan.feet, plan.todo, `A shelter at ${at(plan.feet)} needs ${plan.blocks} sturdy blocks (cobblestone or stone); you have ${sturdy()}.`
                + (dirt > 0 || softProblem ? ` And ${fallback}.` : ''));
        }
    }
    const { feet } = plan;

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
            if (mode.accept(b)) continue;
            if (!isEmpty(b) && !isLiquid(b)) {
                if (!await breakBlockAt(bot, pos.x, pos.y, pos.z)) continue;
            }
            if (pos.equals(roof) && !supportFor(roof, interior, (q) => isSolid(bot.blockAt(q)))) {
                // Nothing next to the roof cell: hold it up with one block on top of a finished wall.
                const prop = propFor(roof, (q) => mode.accept(bot.blockAt(q)), (q) => isEmpty(bot.blockAt(q)));
                if (prop && await fillCell(bot, prop, interior, mode)) placed++;
            }
            if (await fillCell(bot, pos, interior, mode)) placed++;
        }
    } finally {
        bot.rotnStationary = false;
    }
    const missing = wallsAndRoof(feet).filter(q => !mode.accept(bot.blockAt(q)));
    const soft = wallsAndRoof(feet).filter(q => !isSturdy(bot.blockAt(q)) && isSoftWall(bot.blockAt(q))).length;
    const floor = bot.blockAt(feet.offset(0, -1, 0));
    const floorNote = isSturdy(floor) ? '' : ` The floor is ${floor?.name ?? 'unknown'}, not rock.`;
    const softNote = soft > 0 ? ` ${soft} of its walls and roof are dirt, which mobs can dig through.` : '';
    const line = missing.length === 0
        ? `Shelter closed at ${at(feet)}: placed ${placed} blocks.${softNote}${floorNote}`
        : `Shelter at ${at(feet)} is not closed: ${missing.length} open (${missing.map(at).join('; ')}); placed ${placed}.`;
    log(bot, line);
    return { closed: missing.length === 0, feet, placed, missing, soft, line };
}
