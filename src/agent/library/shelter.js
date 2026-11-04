// Building the first-night shelter (skills-rotn D2b): a closed 1x2 space whose walls and roof are
// sturdy (rock, a full cube, stone's hardness or more; night.js isSturdy). RotN's mobs dig through
// dirt and wood, so those are replaced. The bot builds from inside, so upstream placeBlock (which
// walks away from a target closer than 1.1 blocks) is not used. No light is placed.
//
// The floor is kept when it is a solid block, sturdy or not: replacing it means digging under the
// bot, and a mob would have to come from below. A known limit, named in the log line.

import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { isSturdy, shelterShell } from './night.js';
import { log, breakBlockAt, goToGoal } from './skills.js';

const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const SIX = [new Vec3(0, -1, 0), ...HORIZONTAL, new Vec3(0, 1, 0)];
const HAZARD = /lava|fire/;

const isEmpty = (b) => !!b && b.boundingBox === 'empty' && !/lava|water|fire/.test(b.name ?? '');
const isSolid = (b) => !!b && b.boundingBox === 'block';
const at = (p) => `${p.x}, ${p.y}, ${p.z}`;

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

/** The roof has something to be placed against now (the bot is inside, so not the head cell). */
const roofHasRef = (bot, p) => [...HORIZONTAL.map(d => p.offset(0, 2, 0).plus(d)), p.offset(0, 3, 0)]
    .some(q => isSolid(bot.blockAt(q)));

/**
 * What a shelter at feet would take: the wall and roof cells that are not sturdy, and the blocks
 * needed for them (plus one to hold up the roof when nothing is next to it).
 * null when the site is not usable: the floor is not solid, the 1x2 space is not free, a shell cell
 * is lava or fire, or a block is not loaded.
 */
export function siteNeeds(bot, feet) {
    const p = new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z));
    if (!isSolid(bot.blockAt(p.offset(0, -1, 0)))) return null;
    if (!isEmpty(bot.blockAt(p)) || !isEmpty(bot.blockAt(p.offset(0, 1, 0)))) return null;
    const cells = wallsAndRoof(p).map(pos => ({ pos, b: bot.blockAt(pos) }));
    if (cells.some(({ b }) => !b || HAZARD.test(b.name ?? ''))) return null;
    const todo = cells.filter(({ b }) => !isSturdy(b)).map(({ pos }) => pos);
    const roofTodo = todo.some(q => q.equals(p.offset(0, 2, 0)));
    return { feet: p, todo, blocks: todo.length + (roofTodo && !roofHasRef(bot, p) ? 1 : 0) };
}

/** The usable site within `radius` (and 2 up or down) that needs the fewest blocks, then the nearest. */
export function chooseSite(bot, radius = 4) {
    const base = bot.entity.position.floored();
    let best = null;
    for (let dy = -2; dy <= 2; dy++)
        for (let dx = -radius; dx <= radius; dx++)
            for (let dz = -radius; dz <= radius; dz++) {
                const need = siteNeeds(bot, base.offset(dx, dy, dz));
                if (!need) continue;
                const score = need.blocks * 4 + Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
                if (!best || score < best.score) best = { ...need, score };
            }
    return best;
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
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    } finally {
        bot.setControlState('forward', false);
        bot.setControlState('sneak', false);
    }
    return off() <= 0.15;
}

/** Place a sturdy block at target against a solid neighbour; true if a sturdy block is there after. */
async function placeSturdy(bot, target) {
    const item = shelterItems(bot)[0];
    if (!item) return false;
    for (const d of SIX) {
        const ref = bot.blockAt(target.plus(d));
        if (!isSolid(ref)) continue;
        const face = new Vec3(-d.x, -d.y, -d.z);
        try {
            await bot.equip(item, 'hand');
            await bot.lookAt(ref.position.offset(0.5, 0.5, 0.5).plus(face.scaled(0.5)), true);
            await bot.placeBlock(ref, face);
        } catch {
            // mineflayer can throw although the block was placed (a late or missed update): look.
        }
        return isSturdy(bot.blockAt(target));
    }
    return false;
}

/**
 * Build (or repair) a shelter: choose a site nearby (the bot's own cell when it is usable and needs
 * no more blocks than another), go there, then make every wall and the roof sturdy, from inside.
 * Each line it logs comes from the bot's own view of the world, never from a command's chat reply.
 * @param {{site?: Vec3, radius?: number}} [opts] site: repair the shelter at this feet position.
 * @returns {Promise<{closed: boolean, feet: Vec3|null, placed: number, missing: Vec3[]}>}
 */
export async function buildShelter(bot, { site = null, radius = 4 } = {}) {
    const plan = site ? siteNeeds(bot, site) : chooseSite(bot, radius);
    if (!plan) {
        log(bot, site ? `Cannot repair the shelter at ${at(site.floored())}: the space or its floor is not usable.`
            : `Found no place for a shelter within ${radius} blocks (needs a solid floor, a free 1x2 space, no lava).`);
        return { closed: false, feet: null, placed: 0, missing: [] };
    }
    const { feet } = plan;
    const have = countOf(shelterItems(bot));
    if (have < plan.blocks) {
        log(bot, `A shelter at ${at(feet)} needs ${plan.blocks} sturdy blocks (cobblestone or stone); you have ${have}.`);
        return { closed: false, feet, placed: 0, missing: plan.todo };
    }
    if (!bot.entity.position.floored().equals(feet)) {
        try { await goToGoal(bot, new pf.goals.GoalBlock(feet.x, feet.y, feet.z)); } catch { /* checked below */ }
        if (!bot.entity.position.floored().equals(feet)) {
            log(bot, `Could not reach the shelter site at ${at(feet)}.`);
            return { closed: false, feet, placed: 0, missing: plan.todo };
        }
    }
    await centerIn(bot, feet);

    let placed = 0;
    const roof = feet.offset(0, 2, 0);
    for (const pos of wallsAndRoof(feet)) {
        if (bot.interrupt_code) break;
        const b = bot.blockAt(pos);
        if (isSturdy(b)) continue;
        if (!isEmpty(b) && !/water/.test(b?.name ?? '')) {
            if (!await breakBlockAt(bot, pos.x, pos.y, pos.z)) continue;
        }
        if (pos.equals(roof) && !roofHasRef(bot, feet)) {
            // Nothing next to the roof cell: hold it up with one block on top of a finished wall.
            const prop = HORIZONTAL.map(d => roof.plus(d)).find(q => isSturdy(bot.blockAt(q.offset(0, -1, 0))) && isEmpty(bot.blockAt(q)));
            if (prop && await placeSturdy(bot, prop)) placed++;
        }
        if (await placeSturdy(bot, pos)) placed++;
    }
    const missing = wallsAndRoof(feet).filter(q => !isSturdy(bot.blockAt(q)));
    const floor = bot.blockAt(feet.offset(0, -1, 0));
    const floorNote = isSturdy(floor) ? '' : ` The floor is ${floor?.name ?? 'unknown'}, not rock.`;
    if (missing.length === 0)
        log(bot, `Shelter closed at ${at(feet)}: placed ${placed} blocks.${floorNote}`);
    else
        log(bot, `Shelter at ${at(feet)} is not closed: ${missing.length} open (${missing.map(at).join('; ')}); placed ${placed}.`);
    return { closed: missing.length === 0, feet, placed, missing };
}
