// Collision shapes for modded blocks (#256 review question). extendRegistry gives every modded
// block a solid full cube, so mineflayer's physics, the pathfinder and the skills' fall checks
// saw rock piles and plants as walls and floors, and Dynamic Trees leaves 0.5 too high.
//
// applyCollisionShapes puts rotn-data's dumped per-state collision on bot.registry's modded block
// entries, with the exceptions in data/collision-overrides-3.3.4.json (built from the pinned pack by
// tools/build-collision-overrides.mjs) where the dump is known to be wrong:
// - the dump reads getCollisionBoundingBox, but entities collide with what addCollisionBoxToList
//   adds. Dynamic Trees' leaves override only the latter: a player collides with a half-height,
//   inset box (DYNAMIC_LEAVES_BOX), the dump says full cube;
// - blocks whose class overrides addCollisionBoxToList and whose dump has no box keep the full cube
//   (not made walk-through).
// Shapes are per metadata (`stateShapes`, which prismarine-block reads on 1.12 too). `boundingBox`
// is per block in prismarine-block: 'empty' only when no state has a box, so the pathfinder and the
// skills' `boundingBox === 'empty'` checks never walk into a state that collides.
// Vanilla blocks are not touched (minecraft-data has their shapes), nor are blocks without dump data.

import fs from 'node:fs';
import { registerShapes } from './registry-extension.js';

const FULL_CUBE = [[0, 0, 0, 1, 1, 1]];
// BlockDynamicLeaves.addCollisionBoxToList, bytecode 96-116 (test/fixtures/dynamictrees-0.13.4/).
export const DYNAMIC_LEAVES_BOX = [0.125, 0, 0.125, 0.875, 0.5, 0.875];
export const COLLISION_OVERRIDES_FILE = new URL('../data/collision-overrides-3.3.4.json', import.meta.url);

let cached = null;
export function loadCollisionOverrides() {
    cached ??= JSON.parse(fs.readFileSync(COLLISION_OVERRIDES_FILE, 'utf8'));
    return cached;
}

const isBox = (b) => Array.isArray(b) && b.length === 6 && b.every(Number.isFinite);
const isShape = (s) => Array.isArray(s) && s.every(isBox);
const sameShape = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The shapes for one dumped block: `{ shapes, stateShapes? }`, or null when the dump has no
 * usable collision for it (no states, or a state whose collision is missing or malformed).
 * @param {{ defaultMeta?: number, states?: Array<{ meta: number, collision?: number[][] }> }} dumped
 */
export function shapesFromDump(dumped) {
    const states = dumped?.states;
    if (!Array.isArray(states) || states.length === 0) return null;
    if (!states.every((s) => Number.isInteger(s.meta) && s.meta >= 0 && s.meta < 16 && isShape(s.collision))) return null;
    const def = states.find((s) => s.meta === dumped.defaultMeta) ?? states[0];
    const byMeta = new Map(states.map((s) => [s.meta, s.collision]));
    const stateShapes = Array.from({ length: 16 }, (_, m) => byMeta.get(m) ?? def.collision);
    const varies = stateShapes.some((s) => !sameShape(s, def.collision));
    return varies ? { shapes: def.collision, stateShapes } : { shapes: def.collision };
}

/**
 * Applies collision shapes to the modded blocks of a registry extendRegistry extended. Entries are
 * this registry's own objects (extendRegistry makes them), so they are updated in place; the
 * collision-shape table is replaced by a copy (registerShapes) for Block classes made later.
 * @param {object} registry  bot.registry after extendRegistry
 * @param {object|null|undefined} dumpBlocks  rotn-data's dump: `blocks.json`'s `blocks` (by registry name)
 * @param {{ overrides?: object, log?: (msg: string) => void }} [opts]
 * @returns {{ fromDump: number, perState: number, walkThrough: number, overridden: object, noDumpData: number, unchanged: number }}
 */
export function applyCollisionShapes(registry, dumpBlocks, { overrides = loadCollisionOverrides(), log = () => {} } = {}) {
    if (!registry?.entitiesByForgeId) {
        throw new Error('applyCollisionShapes: this registry was not extended (call extendRegistry first)');
    }
    const report = { fromDump: 0, perState: 0, walkThrough: 0, overridden: {}, noDumpData: 0, unchanged: 0 };
    const changed = [];
    for (const entry of registry.blocksArray ?? []) {
        if (!entry?.forge?.modded) continue;
        const regName = entry.registryName ?? entry.name;
        const o = overrides?.blocks?.[regName];
        let next;
        let source;
        if (o) {
            const shapes = overrides.shapes?.[o.use]?.shapes;
            if (!isShape(shapes)) throw new Error(`collision overrides: ${regName} uses '${o.use}', which has no valid shapes`);
            next = { shapes };
            source = o.use;
            report.overridden[o.use] = (report.overridden[o.use] ?? 0) + 1;
        } else {
            next = shapesFromDump(dumpBlocks?.[regName]);
            if (!next) { report.noDumpData++; continue; }
            source = 'dump';
            report.fromDump++;
            if (next.stateShapes) report.perState++;
        }
        const all = next.stateShapes ?? [next.shapes];
        const boundingBox = all.every((s) => s.length === 0) ? 'empty' : 'block';
        if (boundingBox === 'empty') report.walkThrough++;
        if (sameShape(next.shapes, FULL_CUBE) && !next.stateShapes && entry.boundingBox === 'block') report.unchanged++;
        entry.shapes = next.shapes;
        if (next.stateShapes) entry.stateShapes = next.stateShapes;
        else delete entry.stateShapes;
        entry.boundingBox = boundingBox;
        entry.forge = { ...entry.forge, collision: source };
        changed.push(entry);
    }
    registerShapes(registry, changed);
    const o = Object.entries(report.overridden).map(([k, n]) => `${n} ${k}`).join(', ') || 'none';
    log(`collision shapes: ${report.fromDump} modded blocks from the dump (${report.perState} per state, `
        + `${report.walkThrough} walk-through), overridden: ${o}; ${report.noDumpData} without dump data keep a full cube`);
    return report;
}
