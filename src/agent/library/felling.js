// skills-rotn (G3 round 3 batch B): safe felling. In RotN a Dynamic Trees tree falls as one entity
// (dynamictrees:falling_tree; Dramatic Trees, with RLMixins' "Falling Overhaul") when its trunk is
// cut, and it killed the bot: "FRCFLD was crushed by a falling tree", 3 s after the cut, while it
// stood at the tree. The rotn-progression research says trees fall in the direction you chop
// ([W-Tips]), so the bot cuts from the side away from the canopy, never from under it.
// This module only plans, from the blocks the bot sees; skills.fellTree walks, cuts and waits.
import { Vec3 } from 'vec3';

/** Dynamic Trees (and its addons') branch and leaves blocks. */
const DT = /^dynamictrees[a-z]*:/;
export const isBranch = (b) => !!b && DT.test(b.name) && /branch/.test(b.name);
export const isTreeLeaves = (b) => !!b && DT.test(b.name) && /leaves/.test(b.name);
const isCanopy = (b) => isBranch(b) || isTreeLeaves(b);
/** Dynamic Trees' rooty soil under a trunk (rootydirt, rootysand, ...). */
export const isRooty = (b) => !!b && DT.test(b.name) && /rooty/.test(b.name);
const empty = (b) => !b || b.boundingBox === 'empty';
const solid = (b) => !!b && b.boundingBox === 'block';

/**
 * How far the plan looks: the canopy's reach around the trunk, its height, and where the bot stands.
 * G3 round 5 A: a stand ring of 2 to 3.5 lay under almost any grown canopy (Dynamic Trees leaves
 * reach 3 to 4 blocks past the branch ends), so normal trees were refused. The ring now reaches 4.5
 * out; the cut reach is 5 from the eyes (the 1.12 server allows a dig within 6).
 */
export const FELL_PLAN = { canopyRadius: 5, canopyHeight: 20, standMin: 2, standMax: 4.5, reach: 5, retreat: 4 };

/**
 * The tree's lowest trunk block for a branch block the bot found (which may be a limb high in the
 * canopy): a branch block within the canopy radius, at or below it, standing on rooty soil or on
 * ground, never on another tree block (#242 review 1: leaves under a limb looked solid, as
 * forge-bridge gives modded blocks a full box). The one nearest the found block's column, or null.
 */
export function treeBase(bot, pos, plan = FELL_PLAN) {
    let best = null;
    const r = Math.ceil(plan.canopyRadius);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        for (let y = pos.y; y >= pos.y - plan.canopyHeight; y--) {
            const p = new Vec3(pos.x + dx, y, pos.z + dz);
            if (!isBranch(bot.blockAt(p))) continue;
            const below = bot.blockAt(p.offset(0, -1, 0));
            if (!isRooty(below) && !(solid(below) && !DT.test(below.name))) continue;
            const d = Math.hypot(dx, dz);
            if (!best || d < best.d || (d === best.d && y < best.p.y)) best = { p, d };
        }
    }
    return best?.p ?? null;
}

/** The canopy above the trunk: its cells, and its lean (the mean horizontal offset from the trunk). */
export function canopyOf(bot, base, plan = FELL_PLAN) {
    const cells = [];
    const r = Math.ceil(plan.canopyRadius);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.hypot(dx, dz) > plan.canopyRadius) continue;
        for (let y = base.y + 1; y <= base.y + plan.canopyHeight; y++) {
            const p = new Vec3(base.x + dx, y, base.z + dz);
            if ((dx !== 0 || dz !== 0 || y > base.y + 1) && isCanopy(bot.blockAt(p))) cells.push(p);
        }
    }
    const lean = { x: 0, z: 0 };
    for (const c of cells) { lean.x += (c.x - base.x) / cells.length; lean.z += (c.z - base.z) / cells.length; }
    return { cells, lean };
}

/**
 * Where to stand to cut the trunk at `base`: on the ground beside it, standMin to standMax blocks
 * out, the head within reach of the trunk block, no branch anywhere above, and no other trunk next
 * to it (not inside a ring of trunks). Leaves above are allowed (G3 round 5 A: they covered every
 * place beside a normal tree) but only off the side the canopy leans to: the tree falls away from
 * the face the bot hits, so the leaves above the bot swing up and away. Best first: a place under
 * no canopy at all, then the side away from the canopy's lean, with the least canopy near.
 */
export function standSpots(bot, base, plan = FELL_PLAN) {
    const { cells, lean } = canopyOf(bot, base, plan);
    const leanLen = Math.hypot(lean.x, lean.z);
    const spots = [];
    const r = Math.ceil(plan.standMax);
    const target = base.offset(0.5, 0.5, 0.5);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const d = Math.hypot(dx, dz);
        if (d < plan.standMin || d > plan.standMax) continue;
        // At the cut height or one below, never above: the fall follows the side face the bot
        // hits, and from above it could hit the top face (#242 review 5).
        for (const dy of [0, -1]) {
            const p = new Vec3(base.x + dx, base.y + dy, base.z + dz);
            if (!solid(bot.blockAt(p.offset(0, -1, 0))) || !empty(bot.blockAt(p)) || !empty(bot.blockAt(p.offset(0, 1, 0)))) continue;
            if (p.offset(0.5, 1.62, 0.5).distanceTo(target) > plan.reach) continue;
            let branchAbove = false, leavesAbove = false;
            for (let y = p.y + 2; y <= base.y + plan.canopyHeight && !branchAbove; y++) {
                const b = bot.blockAt(new Vec3(p.x, y, p.z));
                branchAbove = isBranch(b);
                leavesAbove ||= isTreeLeaves(b);
            }
            if (branchAbove) continue;
            const away = leanLen > 0.25 ? -(dx * lean.x + dz * lean.z) / (d * leanLen) : 0; // 1: opposite the lean
            if (leavesAbove && away < 0) continue; // under leaves on the side it leans to
            let ringed = false;
            for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                for (const oy of [0, 1]) ringed ||= isBranch(bot.blockAt(p.offset(ox, oy, oz)));
            }
            if (ringed) continue;
            const near = cells.filter(c => Math.hypot(c.x - p.x, c.z - p.z) <= 2).length;
            spots.push({ pos: p, covered: leavesAbove, score: away * 10 - near - d * 0.1 });
            break;
        }
    }
    return spots.sort((a, b) => (a.covered - b.covered) || (b.score - a.score)).map(s => s.pos);
}

/** The trunk's side face towards the spot, the one to hit (a horizontal unit vector). */
export function sideFace(base, spot) {
    const dx = spot.x - base.x, dz = spot.z - base.z;
    return Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx) || 1, 0, 0) : new Vec3(0, 0, Math.sign(dz) || 1);
}

/** Where to step back to right after the cut: further out from the trunk along base -> spot. */
export function retreatFrom(base, spot, plan = FELL_PLAN) {
    const dx = spot.x - base.x, dz = spot.z - base.z;
    const d = Math.hypot(dx, dz) || 1;
    return new Vec3(Math.round(spot.x + dx / d * plan.retreat), spot.y, Math.round(spot.z + dz / d * plan.retreat));
}

/** The falling tree entity Dynamic Trees spawns when a trunk is cut. */
export const FALLING_TREE = 'dynamictrees:falling_tree';
