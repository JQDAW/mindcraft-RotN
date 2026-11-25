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

/**
 * keptMs, stepMs: how long the server gets to put a broken block back, and how often it is looked at. #632 review 5
 * (the lead): keptFor(bot) = min(maxMs, max(keptMs, 2 x ping + 50)), from bot.player.ping (a remote link).
 */
export const BROKE_CHECK = { keptMs: 100, maxMs: 1000, stepMs: 50 };
export const keptFor = (bot) => {
    const ping = Number(bot?.player?.ping);
    return Math.min(BROKE_CHECK.maxMs, Math.max(BROKE_CHECK.keptMs, Number.isFinite(ping) ? 2 * ping + 50 : 0));
};
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const at = (p) => `${p.x}, ${p.y}, ${p.z}`;

/**
 * C1: whether the block is still where it was after its break resolved (the same name and meta), looked at for up
 * to BROKE_CHECK.keptMs. An unloaded cell (null) is not "still there".
 */
export async function stillThere(bot, block, { keptMs = keptFor(bot), stepMs = BROKE_CHECK.stepMs } = {}) {
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
 * C2: the walk's digs: those numbered after `from` and up to `to` (the target's own dig or fell, #632 review 2 and 4:
 * a fell's cuts and anything after are not the walk), other than the target's own cell (bot.rotnDigs.log, kept by
 * the bot.dig wrapper, library/hands.js). "1 dirt" / "2 grass and 1 dirt", or '' when none.
 */
export function walkDigsText(bot, from, target, to = Infinity) {
    const d = bot?.rotnDigs;
    if (!d?.log?.length) return '';
    const since = d.log.filter(e => e.n > from && e.n <= to && !(target && e.at && e.at.x === target.x && e.at.y === target.y && e.at.z === target.z));
    if (!since.length) return '';
    const byName = {};
    for (const e of since) byName[e.name ?? 'block'] = (byName[e.name ?? 'block'] ?? 0) + 1;
    return Object.entries(byName).map(([n, k]) => `${k} ${n}`).join(' and ');
}

/**
 * C3: the item asked for that `key` (an inventory key) crafts into by a recipe of the pack whose ingredients are all
 * that one item (rotn-data's dump): 1 minecraft:cobblestone -> 4 pyrotech:rock; #632 review 1: 4
 * pyrotech_compat:rock_metamorphic:3 -> 1 undergroundbiomes:metamorphic_cobble:3 (soak 15's "it gave 16 rocks"
 * for a cobble collect). {per, count, name} (the result's meta kept, #632 review 7), or null. `wanted`: the
 * item's variants.
 */
let sameItem = null;
function sameItemIndex() {
    if (sameItem) return sameItem;
    sameItem = new Map();
    let recipes = [];
    try { recipes = loadRotnData(PACK_VERSION)?.dump?.recipes?.recipes ?? []; } catch { recipes = []; }
    for (const r of recipes) {
        const ing = (r.ingredients ?? []).filter(Boolean);
        if (!ing.length || !r.result?.name) continue;
        // Every ingredient one and the same single stack.
        const first = ing[0].stacks?.length === 1 ? ing[0].stacks[0] : null;
        if (!first || !ing.every(x => x.stacks?.length === 1 && x.stacks[0].name === first.name && (x.stacks[0].meta ?? 0) === (first.meta ?? 0))) continue;
        const k = `${first.name}:${first.meta ?? 0}`;
        if (!sameItem.has(k)) sameItem.set(k, []);
        sameItem.get(k).push({ per: ing.length, result: r.result });
    }
    return sameItem;
}
const shortName = (name, meta) => `${name.replace(/^minecraft:/, '')}${meta ? `:${meta}` : ''}`;
export function craftsInto(key, wanted) {
    const p = parseName(key);
    if (!p) return null;
    const full = registryName(p.name);
    const results = sameItemIndex().get(`${full}:${p.meta ?? 0}`) ?? [];
    const want = (wanted ?? []).map(w => { const q = parseName(w); return q ? { name: registryName(q.name), meta: q.meta } : null; }).filter(Boolean);
    const hit = results.find(x => want.some(w => w.name === x.result.name && (w.meta == null || w.meta === (x.result.meta ?? 0))));
    return hit ? { per: hit.per, count: hit.result.count ?? 1, name: shortName(hit.result.name, hit.result.meta ?? 0) } : null;
}
/** "crafts into 4 pyrotech:rock each" / "4 make 1 undergroundbiomes:metamorphic_cobble:3". */
export const craftsIntoText = (c) => (!c ? '' : c.per === 1 ? `crafts into ${c.count} ${c.name} each` : `${c.per} make ${c.count} ${c.name}`);
export function __resetCraftsIntoForTest() { sameItem = null; }
