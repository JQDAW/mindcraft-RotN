// The RotN data catalog (brief deliverable 2): one pack version's facts, loaded
// from packages/rotn-data/<version>/.
//
// Two layers:
// - registry-names.json: every block, item, entity and biome name the real 3.3.4
//   server synced (net-forge's G1 RegistryData capture). Always present.
// - the dump (ADR 0004; tools/dumper, format "rotn-dump/1", see README.md):
//   blocks.json, items.json, recipes.json, smelting.json, entities.json,
//   oredict.json, spawns.json, manifest.json. Present once a dump has been run on
//   the test server and imported. Until then, property queries return null and
//   `hasDump` is false; nothing is guessed.
//
// Every key is a full registry name ("minecraft:log", "pyrotech:rock") plus
// metadata. Lookups also accept 1.21-style names ("oak_log") and old names with
// metadata ("log:1").
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createTranslator } from './translate.js';
import { parseOld, registryName, WILDCARD_META } from './names.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.join(HERE, '..');
export const DUMP_FORMAT = 'rotn-dump/1';
export const DUMP_FILES = ['manifest', 'blocks', 'items', 'recipes', 'smelting', 'entities', 'oredict', 'spawns'];

function readJson(dir, base) {
    for (const [ext, decode] of [['.json', (b) => b], ['.json.br', (b) => zlib.brotliDecompressSync(b)]]) {
        const p = path.join(dir, base + ext);
        if (fs.existsSync(p)) return JSON.parse(decode(fs.readFileSync(p)).toString('utf8'));
    }
    return null;
}

const sameMeta = (want, have) => want == null || have === WILDCARD_META || want === WILDCARD_META || want === have;

export class RotnData {
    /**
     * @param {string} dir  folder with registry-names.json and (optionally) the dump files
     * @param {{ version?: string }} [opts]
     */
    constructor(dir, { version = path.basename(dir) } = {}) {
        this.dir = dir;
        this.version = version;
        const names = readJson(dir, 'registry-names');
        if (!names) throw new Error(`rotn-data: ${dir} has no registry-names.json`);
        const ids = (k) => new Set(Object.keys(names.registries[k]?.ids ?? {}));
        this.names = { blocks: ids('minecraft:blocks'), items: ids('minecraft:items'), entities: ids('minecraft:entities'), biomes: ids('minecraft:biomes') };
        this.miningLevels = readJson(dir, 'mining-levels')?.levels ?? {};

        this.dump = {};
        for (const f of DUMP_FILES) this.dump[f] = readJson(dir, f);
        const fmt = this.dump.manifest?.format;
        if (this.dump.manifest && fmt !== DUMP_FORMAT) throw new Error(`rotn-data: dump format ${fmt}, expected ${DUMP_FORMAT}`);
        this.hasDump = !!this.dump.manifest;

        this.translator = createTranslator({ isKnownModded: (n) => this.names.items.has(n) || this.names.blocks.has(n) || this.names.entities.has(n) });
        this._recipesByResult = null;
        this._entitiesByModId = null;
        this._lookupIndex = null;
    }

    // ---- name resolution ---------------------------------------------------

    /**
     * Resolve any accepted spelling to { name, meta } (meta null when the input had none).
     * Order: a 1.21 vanilla name ("oak_log", exact variant), then a 1.12 name the server
     * knows ("log:1"; "log" without metadata means any variant), then other spellings.
     * @param {'items'|'blocks'} kind
     */
    resolve(input, kind = 'items') {
        if (input && typeof input === 'object') {
            const n = registryName(input);
            return n ? { name: n, meta: input.metadata ?? input.meta ?? null } : null;
        }
        // A 1.21 name means one exact variant ("coal" is coal:0, "charcoal" coal:1).
        const t = kind === 'blocks' ? this.translator.blockToOld(input)[0] : this.translator.toOld(input);
        if (t && this.translator.isNewName(input, kind) && this.names[kind].has(t.name)) return t;
        const p = parseOld(input);
        if (p && this.names[kind].has(p.name)) return p;
        if (t && this.names[kind].has(t.name)) return t;
        // A block given by its item name or the other way round ("log" vs "oak_log").
        if (p && (this.names.items.has(p.name) || this.names.blocks.has(p.name))) return p;
        return t ?? null;
    }

    isKnown(name, kind = 'items') {
        const r = this.resolve(name, kind);
        return !!r && this.names[kind].has(r.name);
    }

    // ---- blocks and items --------------------------------------------------

    /**
     * @returns {object|null} the dumped block (with `states`), a names-only stub
     *          ({ name, propertiesKnown: false }) before a dump, or null if unknown.
     */
    getBlock(input) {
        const r = this.resolve(input, 'blocks');
        if (!r || !this.names.blocks.has(r.name)) return null;
        const b = this.dump.blocks?.blocks?.[r.name];
        if (!b) return { name: r.name, meta: r.meta, propertiesKnown: false };
        const state = this._state(b, r.meta);
        return { name: r.name, meta: r.meta ?? b.defaultMeta ?? 0, propertiesKnown: true, ...b, state };
    }

    _state(b, meta) {
        const states = b.states ?? [];
        const want = meta ?? b.defaultMeta ?? 0;
        return states.find(s => s.meta === want) ?? states.find(s => s.meta === (b.defaultMeta ?? 0)) ?? states[0] ?? null;
    }

    getItem(input) {
        const r = this.resolve(input, 'items');
        if (!r || !this.names.items.has(r.name)) return null;
        const it = this.dump.items?.items?.[r.name];
        if (!it) return { name: r.name, meta: r.meta, propertiesKnown: false };
        const variant = (it.variants ?? []).find(v => v.meta === (r.meta ?? 0)) ?? null;
        return { name: r.name, meta: r.meta ?? 0, propertiesKnown: true, ...it, variant };
    }

    /**
     * Harvest rule for one block state, from the dump (Tool Progression levels included).
     * @returns {{block: string, meta: number, hardness: number, tool: string|null, level: number,
     *           levelName: string|null, toolRequired: boolean, material: string}|null}
     */
    harvestInfo(input, meta) {
        const b = this.getBlock(input);
        if (!b || !b.propertiesKnown) return null;
        const s = meta == null ? b.state : this._state(b, meta);
        if (!s) return null;
        const level = s.harvestLevel ?? -1;
        return {
            block: b.name,
            meta: s.meta,
            hardness: s.hardness,
            tool: s.harvestTool ?? null,
            level,
            levelName: level >= 0 ? (this.miningLevels[String(level)] ?? null) : null,
            toolRequired: !!s.toolRequired,
            material: s.material,
        };
    }

    // ---- recipes -----------------------------------------------------------

    _indexRecipes() {
        if (this._recipesByResult) return;
        this._recipesByResult = new Map();
        for (const r of this.dump.recipes?.recipes ?? []) {
            const k = r.result?.name;
            if (!k) continue;
            if (!this._recipesByResult.has(k)) this._recipesByResult.set(k, []);
            this._recipesByResult.get(k).push(r);
        }
    }

    /**
     * Crafting-grid recipes (crafting table and 2x2 grid) that make `item`, after CraftTweaker.
     * Shape (ADR 0004, prismarine-recipe-like, keyed by names):
     *   { id, type: 'shaped'|'shapeless', result: {name, meta, count}, requiresTable,
     *     inShape: [[ingredient|null]] (shaped), ingredients: [ingredient] (shapeless) }
     * ingredient = { stacks: [{name, meta}], ore?: string } (ore dictionary keys expanded into stacks).
     * @param {{ meta?: number }} [opts]  only recipes whose result has this metadata
     */
    recipesFor(input, { meta } = {}) {
        this._indexRecipes();
        const r = this.resolve(input, 'items');
        if (!r) return [];
        const want = meta ?? r.meta;
        return (this._recipesByResult.get(r.name) ?? []).filter(x => sameMeta(want, x.result.meta)).map(x => this._shape(x));
    }

    _shape(x) {
        const out = { id: x.id, type: x.type, result: x.result, requiresTable: !!x.requiresTable };
        if (x.type === 'shaped') {
            const rows = [];
            for (let y = 0; y < x.height; y++) rows.push(x.slots.slice(y * x.width, (y + 1) * x.width));
            out.inShape = rows;
            // The dumper reports the recipe's own flag when it has one, and always tests a mirrored grid.
            const mirrored = x.mirroredTested ?? x.mirrored;
            if (mirrored != null) out.mirrored = mirrored;
        } else {
            out.ingredients = x.ingredients;
        }
        if (x.remaining) out.remaining = x.remaining;
        if (x.staged) out.staged = x.staged;
        return out;
    }

    /** Furnace recipes whose output is `item` (FurnaceRecipes after CraftTweaker). */
    smeltingFor(input) {
        const r = this.resolve(input, 'items');
        if (!r) return [];
        return (this.dump.smelting?.smelting ?? []).filter(s => s.output.name === r.name && sameMeta(r.meta, s.output.meta));
    }

    /** Furnace recipe that takes `item` as input, or null. */
    smeltingOf(input) {
        const r = this.resolve(input, 'items');
        if (!r) return null;
        return (this.dump.smelting?.smelting ?? []).find(s => s.input.name === r.name && sameMeta(r.meta ?? 0, s.input.meta)) ?? null;
    }

    oreDict(key) { return this.dump.oredict?.ores?.[key] ?? null; }

    // ---- entities ----------------------------------------------------------

    /** Entity facts by registry name: { modId, modEntityTypeId, hostile, kinds, ... } or a stub. */
    entity(input) {
        const n = registryName(input);
        if (!n || !this.names.entities.has(n)) return null;
        const e = this.dump.entities?.entities?.[n];
        return e ? { name: n, propertiesKnown: true, ...e } : { name: n, propertiesKnown: false };
    }

    /** Mod-local entity table (ADR 0004): FML EntitySpawn's (modId, modEntityTypeId) -> registry name. */
    entityByModId(modId, modEntityTypeId) {
        if (!this._entitiesByModId) {
            this._entitiesByModId = new Map();
            for (const [name, e] of Object.entries(this.dump.entities?.entities ?? {})) {
                if (e.modEntityTypeId != null) this._entitiesByModId.set(`${e.modId}#${e.modEntityTypeId}`, { name, ...e });
            }
        }
        return this._entitiesByModId.get(`${modId}#${modEntityTypeId}`) ?? null;
    }

    // ---- fuzzy lookup (for !lookup) ----------------------------------------

    _buildLookup() {
        const idx = new Map(); // name -> { name, kind, displayName, newName }
        const add = (name, kind, extra = {}) => {
            const k = `${kind}|${name}`;
            if (!idx.has(k)) idx.set(k, { name, kind, ...extra });
            else Object.assign(idx.get(k), extra);
        };
        for (const n of this.names.items) add(n, 'item');
        for (const n of this.names.blocks) if (!this.names.items.has(n)) add(n, 'block');
        for (const n of this.names.entities) add(n, 'entity');
        for (const [n, it] of Object.entries(this.dump.items?.items ?? {})) {
            for (const v of it.variants ?? []) {
                if (!v.displayName) continue;
                if (v.meta === 0) add(n, 'item', { displayName: v.displayName });
                else add(`${n}:${v.meta}`, 'item', { displayName: v.displayName });
            }
        }
        for (const [n, e] of Object.entries(this.dump.entities?.entities ?? {})) if (e.displayName) add(n, 'entity', { displayName: e.displayName });
        for (const neu of this.translator.newItemNames()) {
            const o = this.translator.toOld(neu);
            const key = o.meta ? `${o.name}:${o.meta}` : o.name;
            add(key, 'item', { newName: neu });
        }
        this._lookupIndex = [...idx.values()].map(e => ({ ...e, hay: [e.name, e.displayName, e.newName].filter(Boolean).map(s => s.toLowerCase()) }));
    }

    /**
     * Fuzzy search over every registry name, 1.21 alias and dumped display name.
     * @returns {Array<{name: string, kind: 'item'|'block'|'entity', displayName?: string, newName?: string, score: number}>}
     */
    lookup(query, { limit = 10, kind } = {}) {
        if (typeof query !== 'string' || !query.trim()) return [];
        if (!this._lookupIndex) this._buildLookup();
        const q = query.trim().toLowerCase();
        const qWords = q.split(/[\s_:.-]+/).filter(Boolean);
        const scored = [];
        for (const e of this._lookupIndex) {
            if (kind && e.kind !== kind) continue;
            let best = 0;
            for (const h of e.hay) {
                const path = h.includes(':') ? h.slice(h.indexOf(':') + 1) : h;
                let s = 0;
                if (h === q || path === q) s = 100;
                else if (path.startsWith(q) || h.startsWith(q)) s = 80;
                else if (h.includes(q)) s = 60;
                else {
                    const words = h.split(/[\s_:.-]+/);
                    const hits = qWords.filter(w => words.some(x => x === w || x.startsWith(w))).length;
                    if (hits === qWords.length) s = 40 + hits;
                    else if (hits > 0) s = 10 * hits;
                }
                if (s > best) best = s;
            }
            if (best > 0) {
                // Prefer vanilla and shorter names on ties.
                const tie = (e.name.startsWith('minecraft:') ? 0.5 : 0) - e.name.length / 1000;
                scored.push({ e, score: best + tie });
            }
        }
        scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
        return scored.slice(0, limit).map(({ e, score }) => {
            const out = { name: e.name, kind: e.kind, score: Math.round(score * 100) / 100 };
            if (e.displayName) out.displayName = e.displayName;
            if (e.newName) out.newName = e.newName;
            return out;
        });
    }
}

const cache = new Map();

/** Load (and cache) one pack version's data: loadRotnData('3.3.4'). */
export function loadRotnData(version = '3.3.4') {
    if (!cache.has(version)) cache.set(version, new RotnData(path.join(PACKAGE_ROOT, version), { version }));
    return cache.get(version);
}
