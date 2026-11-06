// Collision shapes, liquids and hazards for modded blocks (#256 review question, #259 review).
// extendRegistry gives every modded block a solid full cube, so mineflayer's physics, the
// pathfinder and the skills' fall checks saw rock piles and plants as walls and floors, and Dynamic
// Trees leaves 0.5 too high.
//
// applyCollisionShapes puts what a player collides with in each state on bot.registry's modded block
// entries: rotn-data's playerCollision (#269: the boxes addCollisionBoxToList adds for a player, the
// call entities really collide through; several boxes for stairs or cauldrons), or the dumped
// getCollisionBoundingBox (`collision`) when no playerCollision is given. A state whose shape depends
// on its neighbours (`varies`: fences, walls, panes, Dynamic Trees branches) gets one full-width box
// as tall as the tallest box seen for it (at least 1), because a per-state table cannot know the connections.
// With data/collision-overrides-3.3.4.json (built from the pinned pack by
// tools/build-collision-overrides.mjs; its rules are in that tool's header):
// - walk-through is opt-in (lead decision, #259): a state a player has no box in is walk-through
//   only if the data lists it (reviewed harmless classes: plants, flowers, grass, saplings, crops,
//   rock piles). Every other state without a box is a solid full cube, so an unknown modded fluid,
//   trap or portal is never air to the pathfinder;
// - `liquid: true` on modded fluids (BlockFluidBase, BlockLiquid, IFluidBlock), which stay solid;
// - `forge.hazard` ('trap', 'fire', 'portal', 'web', 'lava') for skills-rotn's avoid lists;
// - `shapes` names a reviewed box for a block, over the dump (unused on 3.3.4 since #269: the
//   Dynamic Trees leaves' half-height DYNAMIC_LEAVES_BOX now comes from playerCollision, and the
//   overrides tool checks that it still does).
// Shapes are per metadata (`stateShapes`, which prismarine-block reads on 1.12 too). prismarine-block
// takes `boundingBox` from the entry blocksByStateId gives for the state, so a state whose
// boundingBox or hazard differs from its block's gets its own copy of the entry there (same id,
// name and minStateId). The block's own entry is 'empty' only when every state is walk-through.
// Vanilla blocks are not touched (minecraft-data has their shapes). The data is validated and every
// change planned before the registry is touched, so a failure leaves every modded block a full cube.

import fs from 'node:fs';
import { shapeTableWith } from './registry-extension.js';

const FULL_CUBE = [[0, 0, 0, 1, 1, 1]];
// BlockDynamicLeaves.addCollisionBoxToList, bytecode 96-116 (test/fixtures/dynamictrees-0.13.4/).
export const DYNAMIC_LEAVES_BOX = [0.125, 0, 0.125, 0.875, 0.5, 0.875];
export const HAZARD_KINDS = ['trap', 'fire', 'portal', 'web', 'lava'];
export const COLLISION_OVERRIDES_FILE = new URL('../data/collision-overrides-3.3.4.json', import.meta.url);

let cached = null;
export function loadCollisionOverrides() {
    cached ??= JSON.parse(fs.readFileSync(COLLISION_OVERRIDES_FILE, 'utf8'));
    return cached;
}

const isBox = (b) => Array.isArray(b) && b.length === 6 && b.every(Number.isFinite);
const isShape = (s) => Array.isArray(s) && s.every(isBox);
const isMeta = (m) => Number.isInteger(m) && m >= 0 && m < 16;
const sameShape = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Throws unless the overrides data is well formed: every named shape valid, every block entry's
 * fields of the right kind. Called before anything is changed.
 */
export function validateCollisionOverrides(data) {
    const bad = (msg) => { throw new Error(`collision overrides: ${msg}`); };
    if (!data || typeof data !== 'object' || !data.blocks || typeof data.blocks !== 'object') bad('no blocks');
    for (const [k, s] of Object.entries(data.shapes ?? {})) if (!isShape(s?.shapes)) bad(`shape '${k}' is not a list of boxes`);
    for (const [name, o] of Object.entries(data.blocks)) {
        if (o.shapes !== undefined && !data.shapes?.[o.shapes]) bad(`${name}: unknown shape '${o.shapes}'`);
        if (o.walkThrough !== undefined && o.walkThrough !== 'all' && !(Array.isArray(o.walkThrough) && o.walkThrough.every(isMeta))) bad(`${name}: walkThrough must be 'all' or metas`);
        if (o.liquid !== undefined && typeof o.liquid !== 'boolean') bad(`${name}: liquid must be a boolean`);
        if (o.hazard !== undefined && !HAZARD_KINDS.includes(o.hazard)) bad(`${name}: unknown hazard '${o.hazard}'`);
        for (const [m, k] of Object.entries(o.hazardByMeta ?? {})) {
            if (!isMeta(Number(m)) || !HAZARD_KINDS.includes(k)) bad(`${name}: hazardByMeta ${m}: ${k}`);
        }
        if (o.walkThrough && (o.liquid || o.hazard)) bad(`${name}: a liquid or hazard cannot be walk-through`);
        // hazardByMeta means a partial hazard (hazardBlockIds leaves partial hazards out by default).
        if (o.hazard && o.hazardByMeta) bad(`${name}: hazard (every state) and hazardByMeta (some states) together`);
    }
    return data;
}

// One full-width box from the cell's floor to the top of the tallest box, or a full cube when there
// is no box: for a state whose shape depends on its neighbours (a fence is 1.5 high and, connected,
// fills its row; a Dynamic Trees branch grows arms toward the next tree part).
const neighbourSafeShape = (boxes) => (boxes.length ? [[0, 0, 0, 1, Math.max(1, ...boxes.map((b) => b[4])), 1]] : FULL_CUBE);

/**
 * The shape for each of the 16 metas (a meta with no state takes the default state's), or null when
 * the dump has no usable data for the block (no states, or a state whose `collision` is missing or
 * malformed). With `playerCollision` (rotn-data's, as `(regName, meta) => { boxes, varies } | null`)
 * each state's shape is what a player collides with; a state whose result is missing or malformed
 * keeps its `collision`, and a `varies` state gets neighbourSafeShape of both.
 * `sources` counts the states by where their shape came from: player, varies, collision.
 */
export function dumpShapesByMeta(dumped, { name, playerCollision } = {}) {
    const states = dumped?.states;
    if (!Array.isArray(states) || states.length === 0) return null;
    if (!states.every((s) => isMeta(s.meta) && isShape(s.collision))) return null;
    const sources = { player: 0, varies: 0, collision: 0 };
    const shapeOf = (s) => {
        const pc = playerCollision?.(name, s.meta);
        if (!pc || !isShape(pc.boxes)) { sources.collision++; return s.collision; }
        if (pc.varies === true) { sources.varies++; return neighbourSafeShape([...pc.boxes, ...s.collision]); }
        sources.player++;
        return pc.boxes;
    };
    const byMeta = new Map(states.map((s) => [s.meta, shapeOf(s)]));
    const def = states.find((s) => s.meta === dumped.defaultMeta) ?? states[0];
    const defShape = byMeta.get(def.meta);
    return { defaultMeta: def.meta, shapes: Array.from({ length: 16 }, (_, m) => byMeta.get(m) ?? defShape), sources };
}

// What one modded block becomes, or null to leave it as it is. Pure: changes nothing.
function planBlock(entry, dumped, o, data, playerCollision) {
    const byMeta = dumpShapesByMeta(dumped, { name: entry.registryName ?? entry.name, playerCollision });
    const hazardOf = (m) => o?.hazardByMeta?.[m] ?? o?.hazard ?? null;
    if (!byMeta && !o?.liquid && !o?.hazard && !o?.hazardByMeta) return null;
    let shapes;
    let source;
    if (o?.shapes) {
        shapes = Array(16).fill(data.shapes[o.shapes].shapes);
        source = o.shapes;
    } else if (byMeta) {
        const walk = (m) => o?.walkThrough === 'all' || (Array.isArray(o?.walkThrough) && o.walkThrough.includes(m));
        shapes = byMeta.shapes.map((s, m) => (s.length === 0 && !walk(m) ? FULL_CUBE : s));
        source = 'dump';
    } else {
        shapes = Array(16).fill(entry.shapes ?? FULL_CUBE); // no dump data: the shape stays, the flags apply
        source = 'default';
    }
    const def = byMeta?.defaultMeta ?? 0;
    const boxes = shapes.map((s) => (s.length ? 'block' : 'empty'));
    let hazards = shapes.map((_, m) => hazardOf(m));
    // A partial hazard (hazardByMeta) only when some real state is harmless. If it covers every state
    // the dump lists, or the dump lists none (unknown: the safe side), it is a whole-block hazard, so
    // hazardBlockIds keeps it for blocksToAvoid (#263 review).
    let hazardByMeta = o?.hazardByMeta ? { ...o.hazardByMeta } : null;
    const metas = Array.isArray(dumped?.states) ? dumped.states.map((s) => s.meta).filter(isMeta) : [];
    if (hazardByMeta && (metas.length === 0 || metas.every((m) => hazardByMeta[m]))) {
        const first = hazards.find(Boolean);
        hazards = hazards.map((h) => h ?? first);
        hazardByMeta = null;
    }
    return {
        source,
        shapes: shapes[def],
        stateShapes: shapes.some((s) => !sameShape(s, shapes[def])) ? shapes : null,
        boundingBox: boxes.every((b) => b === 'empty') ? 'empty' : 'block',
        boxes,
        // The block-level kind: every state's, or the first harmful state's (an avoid list by block id
        // must not miss poison ivy); each state's own kind stays on its blocksByStateId entry.
        hazard: o?.hazard ?? hazards.find(Boolean) ?? null,
        hazardByMeta,
        hazards,
        liquid: !!o?.liquid,
        sources: source === 'dump' ? byMeta.sources : null,
    };
}

/**
 * Applies collision shapes, liquid and hazard flags to the modded blocks of a registry that
 * extendRegistry extended. Entries are this registry's own objects (extendRegistry makes them), so
 * they are updated in place; blocksByStateId gets per-state copies where a state differs, and the
 * collision-shape table is replaced by a copy (registerShapes) for Block classes made later.
 * @param {object} registry  bot.registry after extendRegistry
 * @param {object|null|undefined} dumpBlocks  rotn-data's dump: `blocks.json`'s `blocks` (by registry name)
 * @param {{ overrides?: object, log?: (msg: string) => void,
 *   playerCollision?: (regName: string, meta: number) => ({ boxes: number[][], varies: boolean|null }|null) }} [opts]
 *   playerCollision: rotn-data's (RotnData.playerCollision for that block and meta); without it the
 *   dumped `collision` is used
 */
export function applyCollisionShapes(registry, dumpBlocks, { overrides = loadCollisionOverrides(), log = () => {}, playerCollision } = {}) {
    if (!registry?.entitiesByForgeId) {
        throw new Error('applyCollisionShapes: this registry was not extended (call extendRegistry first)');
    }
    validateCollisionOverrides(overrides);
    // 1. Plan every change; nothing is touched until all are planned.
    const plans = [];
    for (const entry of registry.blocksArray ?? []) {
        if (!entry?.forge?.modded) continue;
        const regName = entry.registryName ?? entry.name;
        const plan = planBlock(entry, dumpBlocks?.[regName], overrides.blocks[regName], overrides, playerCollision);
        plans.push([entry, plan]);
    }
    // The new collision-shape table, built before anything changes.
    const table = shapeTableWith(registry.blockCollisionShapes, plans.filter(([, p]) => p).map(([e, p]) => ({ name: e.name, shapes: p.shapes })));
    // 2. Apply (nothing below can throw on a valid plan).
    const report = { fromDump: 0, noDumpData: 0, walkThroughBlocks: 0, walkThroughSomeStates: 0, perStateEntries: 0, liquid: 0, hazard: {}, shapes: {}, states: { player: 0, varies: 0, collision: 0 } };
    for (const [entry, plan] of plans) {
        if (!plan || plan.source === 'default') report.noDumpData++;
        if (!plan) continue;
        if (plan.source === 'dump') {
            report.fromDump++;
            for (const k of Object.keys(report.states)) report.states[k] += plan.sources[k];
        } else if (plan.source !== 'default') report.shapes[plan.source] = (report.shapes[plan.source] ?? 0) + 1;
        entry.shapes = plan.shapes;
        if (plan.stateShapes) entry.stateShapes = plan.stateShapes;
        else delete entry.stateShapes;
        entry.boundingBox = plan.boundingBox;
        if (plan.liquid) { entry.liquid = true; report.liquid++; }
        const forge = { ...entry.forge, collision: plan.source };
        if (plan.hazard) forge.hazard = plan.hazard;
        if (plan.hazardByMeta) forge.hazardByMeta = plan.hazardByMeta;
        const kinds = [...new Set(plan.hazards.filter(Boolean))];
        if (kinds.length) forge.hazardKinds = kinds;
        entry.forge = forge;
        if (plan.boundingBox === 'empty') report.walkThroughBlocks++;
        else if (plan.boxes.includes('empty')) report.walkThroughSomeStates++;
        for (const k of new Set(plan.hazards.filter(Boolean))) report.hazard[k] = (report.hazard[k] ?? 0) + 1;
        for (let m = 0; m < 16; m++) {
            const k = plan.hazards[m];
            if (plan.boxes[m] === entry.boundingBox && k === plan.hazard) continue;
            const sid = (entry.minStateId ?? (entry.id << 4)) + m;
            if (registry.blocksByStateId[sid] !== entry) continue;
            const f = { ...forge };
            if (k) f.hazard = k; else delete f.hazard;
            registry.blocksByStateId[sid] = { ...entry, boundingBox: plan.boxes[m], forge: f };
            report.perStateEntries++;
        }
    }
    registry.blockCollisionShapes = table;
    const h = Object.entries(report.hazard).map(([k, n]) => `${n} ${k}`).join(', ') || 'none';
    const st = report.states;
    log(`collision shapes: ${report.fromDump} modded blocks from the dump (states: ${st.player} player boxes, ${st.varies} neighbour-dependent, ${st.collision} collision box), ${report.walkThroughBlocks} walk-through `
        + `(+${report.walkThroughSomeStates} in some states), ${report.liquid} liquid, hazards: ${h}; ${report.noDumpData} without dump data keep their shape`);
    return report;
}

// ---- lookups for skills-rotn (#259 re-review): avoid lists and floor checks by block id ----

/**
 * Ids of the **whole-block** hazards: every state of the block harms. This is the set for
 * mineflayer-pathfinder's `Movements.blocksToAvoid` (by block id), and the default.
 * A block whose entry has `forge.hazardByMeta` is a *partial* hazard: only those states harm (BOP
 * `plant_0`: poison ivy is meta 4, the short grass beside it is harmless). Partial hazards are left
 * out unless `includePartial: true`; check their states with `stateHazard` (`partialHazardBlockIds`
 * lists them). Putting them in blocksToAvoid would avoid all BOP short grass.
 * @param {object} registry  bot.registry after applyCollisionShapes
 * @param {{ kinds?: string[], includePartial?: boolean }} [opts]  kinds: only blocks with one of
 *        these kinds (default every kind in HAZARD_KINDS); includePartial: add the partial hazards
 * @returns {Set<number>}
 */
export function hazardBlockIds(registry, { kinds = HAZARD_KINDS, includePartial = false } = {}) {
    const want = new Set(kinds);
    const ids = new Set();
    for (const b of registry?.blocksArray ?? []) {
        const f = b?.forge;
        if (!f?.hazard) continue;
        if (isPartial(f) && !includePartial) continue;
        if (kindsOf(f).some((x) => want.has(x))) ids.add(b.id);
    }
    return ids;
}

// Every kind of a hazard block: its states' kinds (forge.hazardKinds), else the block-level kind.
const kindsOf = (f) => (Array.isArray(f.hazardKinds) && f.hazardKinds.length ? f.hazardKinds : [f.hazard]);

/**
 * Ids of the partial-hazard blocks (`forge.hazardByMeta` present: some states harm, others not).
 * Check their states with `stateHazard`.
 * @returns {Set<number>}
 */
export function partialHazardBlockIds(registry, { kinds = HAZARD_KINDS } = {}) {
    const want = new Set(kinds);
    const ids = new Set();
    for (const b of registry?.blocksArray ?? []) {
        if (isPartial(b?.forge) && kindsOf(b.forge).some((k) => want.has(k))) ids.add(b.id);
    }
    return ids;
}

const isPartial = (f) => !!f?.hazardByMeta && Object.keys(f.hazardByMeta).length > 0;

/**
 * Ids of the modded blocks applyCollisionShapes marked `liquid` (modded fluids). Vanilla water and
 * lava are not included: minecraft-data names them.
 * @returns {Set<number>}
 */
export function liquidBlockIds(registry) {
    const ids = new Set();
    for (const b of registry?.blocksArray ?? []) if (b?.liquid === true && b.forge) ids.add(b.id);
    return ids;
}

/**
 * The hazard kind of one block state, or null: a prismarine Block (its stateId, or type and
 * metadata) or a state id. Per state, so BOP short grass is null and poison ivy 'trap'.
 */
export function stateHazard(registry, blockOrStateId) {
    const b = blockOrStateId;
    const sid = typeof b === 'number' ? b : (b?.stateId ?? (Number.isInteger(b?.type) ? (b.type << 4) | (b.metadata ?? 0) : undefined));
    if (!Number.isInteger(sid)) return null;
    return registry?.blocksByStateId?.[sid]?.forge?.hazard ?? null;
}
