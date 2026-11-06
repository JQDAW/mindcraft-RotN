// Collision shapes, liquids and hazards for modded blocks (#256 review question, #259 review).
// extendRegistry gives every modded block a solid full cube, so mineflayer's physics, the
// pathfinder and the skills' fall checks saw rock piles and plants as walls and floors, and Dynamic
// Trees leaves 0.5 too high.
//
// applyCollisionShapes puts rotn-data's dumped per-state collision on bot.registry's modded block
// entries, with data/collision-overrides-3.3.4.json (built from the pinned pack by
// tools/build-collision-overrides.mjs; its rules are in that tool's header):
// - walk-through is opt-in (lead decision, #259): a state the dump gives no box is walk-through
//   only if the data lists it (reviewed harmless classes: plants, flowers, grass, saplings, crops,
//   rock piles). Every other state without a box is a solid full cube, so an unknown modded fluid,
//   trap or portal is never air to the pathfinder;
// - `liquid: true` on modded fluids (BlockFluidBase, BlockLiquid, IFluidBlock), which stay solid;
// - `forge.hazard` ('trap', 'fire', 'portal', 'web', 'lava') for skills-rotn's avoid lists;
// - Dynamic Trees leaves get the half-height box a player collides with (DYNAMIC_LEAVES_BOX); the
//   dump reads getCollisionBoundingBox and records a full cube.
// Shapes are per metadata (`stateShapes`, which prismarine-block reads on 1.12 too). prismarine-block
// takes `boundingBox` from the entry blocksByStateId gives for the state, so a state whose
// boundingBox or hazard differs from its block's gets its own copy of the entry there (same id,
// name and minStateId). The block's own entry is 'empty' only when every state is walk-through.
// Vanilla blocks are not touched (minecraft-data has their shapes). The data is validated and every
// change planned before the registry is touched, so a failure leaves every modded block a full cube.

import fs from 'node:fs';
import { registerShapes } from './registry-extension.js';

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
    }
    return data;
}

/**
 * The dump's collision for each of the 16 metas (a meta with no state takes the default state's),
 * or null when the dump has no usable collision for the block (no states, or a state whose
 * collision is missing or malformed).
 */
export function dumpShapesByMeta(dumped) {
    const states = dumped?.states;
    if (!Array.isArray(states) || states.length === 0) return null;
    if (!states.every((s) => isMeta(s.meta) && isShape(s.collision))) return null;
    const def = states.find((s) => s.meta === dumped.defaultMeta) ?? states[0];
    const byMeta = new Map(states.map((s) => [s.meta, s.collision]));
    return { defaultMeta: def.meta, shapes: Array.from({ length: 16 }, (_, m) => byMeta.get(m) ?? def.collision) };
}

// What one modded block becomes, or null to leave it as it is. Pure: changes nothing.
function planBlock(entry, dumped, o, data) {
    const byMeta = dumpShapesByMeta(dumped);
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
    const hazards = shapes.map((_, m) => hazardOf(m));
    return {
        source,
        shapes: shapes[def],
        stateShapes: shapes.some((s) => !sameShape(s, shapes[def])) ? shapes : null,
        boundingBox: boxes.every((b) => b === 'empty') ? 'empty' : 'block',
        boxes,
        hazard: o?.hazard ?? null,
        hazards,
        liquid: !!o?.liquid,
    };
}

/**
 * Applies collision shapes, liquid and hazard flags to the modded blocks of a registry that
 * extendRegistry extended. Entries are this registry's own objects (extendRegistry makes them), so
 * they are updated in place; blocksByStateId gets per-state copies where a state differs, and the
 * collision-shape table is replaced by a copy (registerShapes) for Block classes made later.
 * @param {object} registry  bot.registry after extendRegistry
 * @param {object|null|undefined} dumpBlocks  rotn-data's dump: `blocks.json`'s `blocks` (by registry name)
 * @param {{ overrides?: object, log?: (msg: string) => void }} [opts]
 */
export function applyCollisionShapes(registry, dumpBlocks, { overrides = loadCollisionOverrides(), log = () => {} } = {}) {
    if (!registry?.entitiesByForgeId) {
        throw new Error('applyCollisionShapes: this registry was not extended (call extendRegistry first)');
    }
    validateCollisionOverrides(overrides);
    // 1. Plan every change; nothing is touched until all are planned.
    const plans = [];
    for (const entry of registry.blocksArray ?? []) {
        if (!entry?.forge?.modded) continue;
        const regName = entry.registryName ?? entry.name;
        const plan = planBlock(entry, dumpBlocks?.[regName], overrides.blocks[regName], overrides);
        plans.push([entry, plan]);
    }
    // 2. Apply.
    const report = { fromDump: 0, noDumpData: 0, walkThroughBlocks: 0, walkThroughSomeStates: 0, perStateEntries: 0, liquid: 0, hazard: {}, shapes: {} };
    const changed = [];
    for (const [entry, plan] of plans) {
        if (!plan || plan.source === 'default') report.noDumpData++;
        if (!plan) continue;
        if (plan.source === 'dump') report.fromDump++;
        else if (plan.source !== 'default') report.shapes[plan.source] = (report.shapes[plan.source] ?? 0) + 1;
        entry.shapes = plan.shapes;
        if (plan.stateShapes) entry.stateShapes = plan.stateShapes;
        else delete entry.stateShapes;
        entry.boundingBox = plan.boundingBox;
        if (plan.liquid) { entry.liquid = true; report.liquid++; }
        const forge = { ...entry.forge, collision: plan.source };
        if (plan.hazard) forge.hazard = plan.hazard;
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
        changed.push(entry);
    }
    registerShapes(registry, changed);
    const h = Object.entries(report.hazard).map(([k, n]) => `${n} ${k}`).join(', ') || 'none';
    log(`collision shapes: ${report.fromDump} modded blocks from the dump, ${report.walkThroughBlocks} walk-through `
        + `(+${report.walkThroughSomeStates} in some states), ${report.liquid} liquid, hazards: ${h}; ${report.noDumpData} without dump data keep their shape`);
    return report;
}
