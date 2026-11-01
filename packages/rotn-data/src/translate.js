// Two-way name translation between Minecraft 1.12.2 names + metadata (what the
// RotN server and bot.registry use) and the 1.21-style names Mindcraft's prompts,
// commands and skills use (brief deliverable 3). Used at the command boundary.
//
// Contract (also given to harness-ops for the G2 scenarios):
// - toNew(oldName, meta = 0) -> string | null
//     "log", 1 / "log:1" / "minecraft:log:1"  -> "spruce_log"
//     modded names pass through: "pyrotech:rock", 6 -> "pyrotech:rock:6" (":0" is omitted)
// - toOld(newName) -> { name: 'minecraft:log', meta: 1 } | null   (full registry name)
// - blockToNew / blockToOld do the same for block states (blockToOld lists every state).
// - Anything that cannot be mapped is null, never a guess, a number or "unknown".
import { createRequire } from 'node:module';
import { parseOld, botName } from './names.js';

const require = createRequire(import.meta.url);

function indexTable(entries) {
    const byOld = new Map(); // "minecraft:log" -> Map(meta -> entry)
    const byNew = new Map(); // "oak_log" -> [entry, ...] in table order
    for (const e of entries) {
        if (!byOld.has(e.old)) byOld.set(e.old, new Map());
        byOld.get(e.old).set(e.meta, e);
        if (!byNew.has(e.new)) byNew.set(e.new, []);
        byNew.get(e.new).push(e);
    }
    return { byOld, byNew };
}

/**
 * @param {object} [opts]
 * @param {(regName: string) => boolean} [opts.isKnownModded]  true if a modded registry name exists on the server
 *        (blocks or items). Default: every modded name is accepted.
 */
export function createTranslator({ isKnownModded = () => true, items, blocks } = {}) {
    const itemTable = indexTable(items ?? require('../vanilla/flattening-items.json').entries);
    const blockTable = indexTable(blocks ?? require('../vanilla/flattening-blocks.json').entries);

    function lookupOld(table, name, meta) {
        const metas = table.byOld.get(name);
        if (!metas) return undefined; // name not in this table
        const e = metas.get(meta);
        if (e) return e;
        // Damageable items (tools, armour) carry damage in the metadata field and
        // have exactly one entry at meta 0.
        if (metas.size === 1 && metas.has(0)) return metas.get(0);
        return null; // known name, unknown variant
    }

    function modded(p, meta) {
        if (!isKnownModded(p.name)) return null;
        return meta ? `${p.name}:${meta}` : p.name;
    }

    function toNew(oldName, meta = 0) {
        const p = parseOld(oldName);
        if (!p) return null;
        const m = p.meta ?? (Number.isInteger(meta) ? meta : 0);
        if (!p.name.startsWith('minecraft:')) return modded(p, m);
        const it = lookupOld(itemTable, p.name, m);
        if (it !== undefined) return it ? it.new : null;
        const bl = lookupOld(blockTable, p.name, m);
        return bl ? bl.new : null;
    }

    function blockToNew(oldName, meta = 0) {
        const p = parseOld(oldName);
        if (!p) return null;
        const m = p.meta ?? (Number.isInteger(meta) ? meta : 0);
        if (!p.name.startsWith('minecraft:')) return modded(p, m);
        const bl = lookupOld(blockTable, p.name, m);
        if (bl !== undefined) return bl ? bl.new : null;
        const it = lookupOld(itemTable, p.name, m);
        return it ? it.new : null;
    }

    function splitNew(newName) {
        if (typeof newName !== 'string') return null;
        const s = newName.trim().toLowerCase();
        if (!s) return null;
        if (s.startsWith('minecraft:') && !/:\d+$/.test(s)) return { vanilla: s.slice('minecraft:'.length) };
        if (s.includes(':')) return { modded: s };
        return { vanilla: s };
    }

    function oldFallback(name) {
        // Not a 1.21 name, but a valid 1.12 name ("log", "minecraft:log:2", "pyrotech:rock:6").
        const p = parseOld(name);
        if (!p) return null;
        if (p.name.startsWith('minecraft:')) {
            if (!itemTable.byOld.has(p.name) && !blockTable.byOld.has(p.name)) return null;
            return { name: p.name, meta: p.meta ?? 0 };
        }
        return isKnownModded(p.name) ? { name: p.name, meta: p.meta ?? 0 } : null;
    }

    function toOld(newName) {
        const s = splitNew(newName);
        if (!s) return null;
        if (s.modded) return oldFallback(s.modded);
        const it = itemTable.byNew.get(s.vanilla);
        if (it) return { name: it[0].old, meta: it[0].meta };
        const bl = blockTable.byNew.get(s.vanilla);
        if (bl) {
            const pick = bl.find(e => e.old === `minecraft:${s.vanilla}` && e.meta === 0) ?? bl.find(e => e.meta === 0) ?? bl[0];
            return { name: pick.old, meta: pick.meta };
        }
        return oldFallback(s.vanilla);
    }

    /** Every 1.12 block state that shows as `newName`, e.g. oak_log -> log:0, log:4, log:8. */
    function blockToOld(newName) {
        const s = splitNew(newName);
        if (!s) return [];
        if (s.modded) { const o = oldFallback(s.modded); return o ? [o] : []; }
        const bl = blockTable.byNew.get(s.vanilla);
        if (bl) return bl.map(e => ({ name: e.old, meta: e.meta }));
        const o = oldFallback(s.vanilla);
        return o ? [o] : [];
    }

    /** All 1.21-style vanilla item names (for prompts and fuzzy lookup). */
    function newItemNames() { return [...itemTable.byNew.keys()]; }
    function newBlockNames() { return [...blockTable.byNew.keys()]; }

    /** True if `name` is a 1.21-style vanilla name in the item (or block) table. */
    function isNewName(name, kind = 'items') {
        const sp = splitNew(name);
        if (!sp?.vanilla) return false;
        return (kind === 'blocks' ? blockTable : itemTable).byNew.has(sp.vanilla);
    }

    return { toNew, toOld, blockToNew, blockToOld, isNewName, newItemNames, newBlockNames, botName };
}
