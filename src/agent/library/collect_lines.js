// Soak 16 (C, the lead): truthful lines from !collectBlocks. Soak 15:
// - "Broke pyrotech_compat:rock_igneous: no pyrotech:rock yet" (22:37:18, 22:37:50) with nothing picked up, and
//   "Broke dirt: no betterwithmods:dirt_pile yet" (22:40:07): a dig the server may have cancelled resolves on
//   mineflayer's predicted air (Forge 1.12 dig rules), and the line said "Broke" all the same;
// - "Broke undergroundbiomes:metamorphic_stone: no pyrotech:rock yet (it gave 4 betterwithmods:dirt_pile)" (22:41:56):
//   the 4 piles were the walk's own dig of a dirt block on the way, not the stone's;
// - a drop that crafts into the item asked for (cobblestone -> 4 rocks) was named as if it were nothing.

import { Vec3 } from 'vec3';
import { loadRotnData, PACK_VERSION, registryName } from '../../../packages/rotn-data/index.js';
import { parseName } from './rotn_names.js';

/** keptMs, stepMs: how long the server gets to put a broken block back (2 ticks), and how often it is looked at. */
export const BROKE_CHECK = { keptMs: 100, stepMs: 50 };
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const at = (p) => `${p.x}, ${p.y}, ${p.z}`;

/**
 * C1: whether the block is still where it was after its break resolved (the same name and meta), looked at for up
 * to BROKE_CHECK.keptMs. An unloaded cell (null) is not "still there".
 */
export async function stillThere(bot, block, { keptMs = BROKE_CHECK.keptMs, stepMs = BROKE_CHECK.stepMs } = {}) {
    const p = block?.position;
    if (!p || typeof bot?.blockAt !== 'function') return false;
    const same = () => {
        const b = bot.blockAt(p instanceof Vec3 ? p : new Vec3(p.x, p.y, p.z));
        return !!b && b.name === block.name && (b.metadata ?? 0) === (block.metadata ?? 0);
    };
    for (let waited = 0; ; waited += stepMs) {
        if (!same()) return false;
        if (waited >= keptMs) return true;
        await sleep(stepMs);
    }
}
export const notBrokenText = (block) => `${block.name}:${block.metadata ?? 0} at ${at(block.position)} was not broken: the server kept it; skipping it.`;

/**
 * C2: the digs since `from` (bot.rotnDigs.log, kept by the bot.dig wrapper, library/hands.js) other than the target's
 * own cell: the walk's digs on the way. "1 dirt" / "2 grass and 1 dirt", or '' when none.
 */
export function walkDigsText(bot, from, target) {
    const d = bot?.rotnDigs;
    if (!d?.log?.length) return '';
    const since = d.log.filter(e => e.n > from && !(target && e.at && e.at.x === target.x && e.at.y === target.y && e.at.z === target.z));
    if (!since.length) return '';
    const byName = {};
    for (const e of since) byName[e.name ?? 'block'] = (byName[e.name ?? 'block'] ?? 0) + 1;
    return Object.entries(byName).map(([n, k]) => `${k} ${n}`).join(' and ');
}

/**
 * C3: the item asked for that `key` (an inventory key) crafts into by a one-ingredient recipe of the pack (rotn-data's
 * dump: minecraft:cobblestone -> 4 pyrotech:rock), as "4 pyrotech:rock", or null. `wanted`: the item's variants.
 */
let oneIngredient = null;
function oneIngredientIndex() {
    if (oneIngredient) return oneIngredient;
    oneIngredient = new Map();
    let recipes = [];
    try { recipes = loadRotnData(PACK_VERSION)?.dump?.recipes?.recipes ?? []; } catch { recipes = []; }
    for (const r of recipes) {
        const ing = (r.ingredients ?? []).filter(Boolean);
        if (ing.length !== 1 || !r.result?.name) continue;
        for (const s of ing[0].stacks ?? []) {
            const k = `${s.name}:${s.meta ?? 0}`;
            if (!oneIngredient.has(k)) oneIngredient.set(k, []);
            oneIngredient.get(k).push(r.result);
        }
    }
    return oneIngredient;
}
export function craftsInto(key, wanted) {
    const p = parseName(key);
    if (!p) return null;
    const full = registryName(p.name);
    const results = oneIngredientIndex().get(`${full}:${p.meta ?? 0}`) ?? [];
    const want = new Set((wanted ?? []).map(w => { const q = parseName(w); return q ? registryName(q.name) : null; }).filter(Boolean));
    const r = results.find(x => want.has(x.name));
    return r ? `${r.count ?? 1} ${r.name.replace(/^minecraft:/, '')}` : null;
}
export function __resetCraftsIntoForTest() { oneIngredient = null; }
