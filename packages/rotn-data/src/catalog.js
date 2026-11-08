// The RotN data catalog (brief deliverable 2): one pack version's facts, loaded
// from packages/rotn-data/<version>/.
//
// Two layers:
// - registry-names.json: every block, item, entity and biome name the real 3.3.4
//   server synced (net-forge's G1 RegistryData capture). Always present.
// - the dump (ADR 0004; tools/dumper, format "rotn-dump/1", see README.md):
//   blocks.json, items.json, recipes.json, smelting.json, entities.json,
//   oredict.json, spawns.json, serializers.json (dumper 0.1.0 after PR #48; the first 3.3.4 dump
//   predates it), state-meta-remap.json (dumper 0.2.0), manifest.json. Present once a dump has been run on
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
import { howToGet, rockRecipes } from './howto.js';
import { threatOf, nightThreats } from './threats.js';
import { mobDigging, canMobDig } from './digging.js';
import { forageFood, forageSources, forageHazard } from './forage.js';
import { canFill } from './craft-fill.js';
import { parseOld, registryName, WILDCARD_META } from './names.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.join(HERE, '..');
export const DUMP_FORMAT = 'rotn-dump/1';
export const DUMP_FILES = ['manifest', 'blocks', 'items', 'recipes', 'smelting', 'entities', 'oredict', 'spawns', 'serializers', 'state-meta-remap'];

function readJson(dir, base) {
    for (const [ext, decode] of [['.json', (b) => b], ['.json.br', (b) => zlib.brotliDecompressSync(b)]]) {
        const p = path.join(dir, base + ext);
        if (fs.existsSync(p)) return JSON.parse(decode(fs.readFileSync(p)).toString('utf8'));
    }
    return null;
}

const sameMeta = (want, have) => want == null || have === WILDCARD_META || want === WILDCARD_META || want === have;

/**
 * True for the box a Dynamic Trees branch gives when no neighbour is a tree part: one cube centred
 * on the cell whose half-size is a whole number of blocks (the branch radius, not radius / 16).
 * DramaticTrees-1.12.2-0.13.4.jar (SHA-256 b86dae76...7ffe) BlockBranchBasic.addCollisionBoxToList
 * (func_185477_a) bytecode 171-216: with no connection it adds AxisAlignedBB(0.5, 0.5, 0.5, 0.5, 0.5,
 * 0.5).grow(radius); BlockBranchThick hands radius <= 8 to it. The dumper's probe cells have no tree
 * parts around them, so every branch state of radius <= 8 was dumped with this box (2 to 16 blocks
 * wide, entityCollisionVaries false). In a tree every branch connects, and its shape is the core box
 * plus arms toward its tree-part neighbours, so the dumped box says nothing about it (Request 14 run).
 * Only for a block whose class is in a Dynamic Trees package: Dynamic Trees, its addons, and the
 * Dynamic Trees branches Rustic registers as rustic:olivebranch and rustic:ironwoodbranch (#269 review).
 * @param {{ class?: string }} block the blocks.json entry
 */
export function isDtBranchNoConnectionBox(block, boxes) {
    if (!/dynamictrees/.test(String(block?.class ?? '')) || !Array.isArray(boxes) || boxes.length !== 1) return false;
    const [x0, y0, z0, x1, y1, z1] = boxes[0];
    const h = x1 - 0.5;
    return Number.isInteger(h) && h >= 1 && [x0, y0, z0].every((v) => v === 0.5 - h) && [y1, z1].every((v) => v === 0.5 + h);
}

/**
 * True for a Dynamic Trees cactus branch (dynamictrees:cactusbranch, #279 review). Its dumped box is
 * only the core: DramaticTrees-1.12.2-0.13.4.jar BlockBranchCactus.addCollisionBoxToList
 * (func_185477_a) adds an arm toward each side whose getSideConnectionRadius is above 0 (bytecode
 * 7-159) and, for a non-trunk branch growing out sideways, a stub upward (163-305), then the core box
 * (308-358). The dumper's all-air probe has no cactus parts around it, so the arms never appear, and
 * entityCollisionVaries is false.
 * @param {{ class?: string }} block the blocks.json entry
 */
export function isDtCactusBranch(block) {
    return /dynamictrees.*\.BlockBranchCactus$/.test(String(block?.class ?? ''));
}

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
        // Threat overrides beyond IMob, each citing the mod's bytecode (entity-overrides.json).
        const ov = readJson(dir, 'entity-overrides');
        this.entityOverrides = ov?.entities ?? {};
        // Vanilla animals another mod removes on this pack (Animania: config/animania.cfg).
        this.replacedByMod = ov?.replacedByMod?.entities ?? {};
        // Non-recipe ways to get items, hand-written with evidence (world-sources.json, for howToGet).
        this.worldSources = readJson(dir, 'world-sources')?.sources ?? [];
        // How to react to first-night mobs, hand-written with evidence (threat-reactions.json).
        this.threatReactions = readJson(dir, 'threat-reactions') ?? null;
        // Which mobs dig toward their target and which blocks they can dig, from Epic Siege Mod,
        // ESM-Tweaks and Tool Progression bytecode (mob-digging.json, hand-written with evidence).
        this.mobDiggingData = readJson(dir, 'mob-digging') ?? null;
        // Wild food blocks and plant hazards (forage-food.json, hand-written with citations).
        this.forageData = readJson(dir, 'forage-food') ?? null;
        // Which blocks fall (gravity), from the pack's bytecode and configs (falling-blocks.json,
        // built by tools/build-falling-blocks.mjs).
        this.fallingBlocks = readJson(dir, 'falling-blocks')?.blocks ?? null;
        // Food values on this pack and foods to avoid (food-values.json, tools/build-food-values.mjs).
        this.foodData = readJson(dir, 'food-values') ?? null;

        this.dump = {};
        for (const f of DUMP_FILES) this.dump[f] = readJson(dir, f);
        const fmt = this.dump.manifest?.format;
        if (this.dump.manifest && fmt !== DUMP_FORMAT) throw new Error(`rotn-data: dump format ${fmt}, expected ${DUMP_FORMAT}`);
        this.hasDump = !!this.dump.manifest;

        this.translator = createTranslator({ isKnownModded: (n) => this.names.items.has(n) || this.names.blocks.has(n) || this.names.entities.has(n) });
        this._recipesByResult = null;
        this._entitiesByModId = null;
        this._lookupIndex = null;
        this._remapByBlock = null;
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
        return { name: r.name, meta: r.meta ?? b.defaultMeta ?? 0, propertiesKnown: true, ...b, state, ...this._fallFields(r.name) };
    }

    /**
     * What a player collides with in a block state (net-forge #259): `{ boxes, varies, source }`.
     * From dumper 0.3.0, `boxes` is the state's `entityCollision` (addCollisionBoxToList for a
     * player standing on the block, read at an all-air cell; [x0, y0, z0, x1, y1, z1] relative to
     * the cell) and `varies` is `entityCollisionVaries` (true: the shape depends on the
     * neighbouring blocks or on the block really in the cell, e.g. a fence's connections, so a
     * per-state table cannot give it). It does not catch tile-entity dependence (the dumper never
     * places the state), so `false` is not proof that the shape is fixed. Before 0.3.0, or
     * when the call threw, it falls back to `collision` (getCollisionBoundingBox) with
     * `varies: null` and `source: 'collision'`. A Dynamic Trees branch whose dumped box is the
     * no-connection cube (isDtBranchNoConnectionBox) also gets `collision` (its core box), with
     * `varies: true` and `source: 'collision'`: in a tree its arms depend on the neighbouring tree parts.
     * A Dynamic Trees cactus branch (isDtCactusBranch) keeps its dumped core box with `varies: true`:
     * its arms toward the neighbouring cactus parts are not in the dump.
     * `null` for an unknown block or a block without a dump.
     */
    playerCollision(input) {
        const b = this.getBlock(input);
        if (!b?.propertiesKnown || !b.state) return null;
        const s = b.state;
        if (isDtBranchNoConnectionBox(b, s.entityCollision)) return { boxes: s.collision ?? null, varies: true, source: 'collision' };
        if (isDtCactusBranch(b) && Array.isArray(s.entityCollision)) return { boxes: s.entityCollision, varies: true, source: 'entityCollision' };
        if (Array.isArray(s.entityCollision)) return { boxes: s.entityCollision, varies: s.entityCollisionVaries ?? null, source: 'entityCollision' };
        return { boxes: s.collision ?? null, varies: null, source: 'collision' };
    }

    _fallFields(name) {
        if (!this.fallingBlocks) return {};
        const f = this.fallingBlocks[name];
        return { falls: !!f, fallsWhen: f?.when ?? null };
    }

    /**
     * Whether a block falls (gravity): sand, gravel, concrete powder, anvils, and the modded ones
     * (BlockFalling subclasses, blocks that make their own falling entity, ContentTweaker blocks a
     * pack script gives gravity, Ore Stone Variants ores on sand or gravel). Per block, not per state.
     * @returns {boolean|null} null for an unknown block or without falling-blocks.json
     */
    falls(input) {
        const b = this.getBlock(input);
        return b && 'falls' in b ? b.falls : null;
    }

    /**
     * The falling-blocks.json entry: { via: 'BlockFalling'|'own-code'|'contenttweaker-gravity'|'osv-background',
     *   when: 'unsupported-below'|'loses-support'|'player-nearby'|'redstone-powered'|'tree-felled', class, ...evidence },
     * or null when the block does not fall (or is unknown).
     */
    fallInfo(input) {
        const r = this.resolve(input, 'blocks');
        return (r && this.fallingBlocks?.[r.name]) ?? null;
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
     * What a food gives on this pack: { name, meta, hunger, saturationModifier, saturation, source,
     * vanilla, script?, avoid? }. `saturation` = hunger * saturationModifier * 2 (what eating adds,
     * capped at the food level). `source`: 'crafttweaker' (a pack script, cited in `script` by line),
     * 'hungeroverhaul-table' or 'hungeroverhaul-rule' (Hunger Overhaul's change of the vanilla value).
     * A food whose value is not computed (Hunger Overhaul's HarvestCraft and Biomes O' Plenty tables)
     * gives hunger and saturation null with `source: 'not-computed'`. Null for an item that is not food.
     * @param {number} [meta] default: the input's metadata, else 0
     */
    foodValues(input, meta) {
        const r = this.resolve(input, 'items');
        if (!r || !this.foodData) return null;
        const m = meta ?? r.meta ?? 0;
        const e = this.foodData.foods[r.name]?.[m];
        const avoid = this.avoidFood(r.name, m);
        if (e) return { name: r.name, meta: m, ...e, ...(avoid ? { avoid } : {}) };
        if (this.foodData.notComputed[r.name]?.includes(m)) {
            const v = this.dump.items?.items?.[r.name]?.variants?.find((x) => x.meta === m)?.food;
            return { name: r.name, meta: m, hunger: null, saturationModifier: null, saturation: null, source: 'not-computed', vanilla: v ? { hunger: v.hunger, saturationModifier: v.saturation } : null, ...(avoid ? { avoid } : {}) };
        }
        return null;
    }

    /**
     * Why not to eat a food: { effects: [{ effect, seconds, level, chance }], confidence, evidence,
     * note?, ore? } (vanilla effects from the server jar, the pack's eating effects from
     * scripts/events.zs, cloudsbluff from the research), or null.
     */
    avoidFood(input, meta) {
        const r = this.resolve(input, 'items');
        const a = r && this.foodData?.avoid?.[r.name];
        if (!a) return null;
        const m = meta ?? r.meta ?? 0;
        if (a.metas && !a.metas.includes(m)) return null;
        const { metas: _metas, ...rest } = a;
        return rest;
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

    /** One dump recipe by id, in recipesFor's shape, or null. CraftTweaker ids are only stable within one dump. */
    recipeById(id) {
        if (!this._recipesById) this._recipesById = new Map((this.dump.recipes?.recipes ?? []).map((r) => [r.id, r]));
        const r = this._recipesById.get(id);
        return r ? this._shape(r) : null;
    }

    /** Whether inventory stacks can fill a recipe or howToGet craft way (src/craft-fill.js). */
    canFill(recipe, stacks, opts) {
        return canFill(this, recipe, stacks, opts);
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

    /**
     * The entity-metadata DataSerializer table (serializers.json, for forge-bridge):
     * { serializers: [{id, class, vanilla}], usage: { [entity]: [{index, serializerId, class}] } },
     * or null for a dump made before the dumper wrote it.
     */
    serializers() {
        const s = this.dump.serializers;
        return s ? { serializers: s.serializers ?? [], usage: s.usage ?? {} } : null;
    }

    // ---- network block-state ids (state-meta-remap.json, for forge-bridge) ----

    /**
     * Network block-state ids whose metadata is not (id & 15). Forge maps getStateFromMeta(m) to
     * id << 4 | m in a second pass and the later put wins, so the double plant's upper half is
     * sent as 175 << 4 | 11 while a Forge client reports meta 10 (tools/dumper/README.md).
     * null for a dump made before dumper 0.2.0. Otherwise
     * { encoding, records: [{networkId, block, blockId, idMeta, stateMeta, stateNetworkId, state}],
     *   byBlock: { [block]: { [idMeta]: stateMeta } }, scanned, anomalies }.
     * networkId and blockId are the dumped (test) server's ids; byBlock does not depend on them.
     */
    stateMetaRemap() {
        const r = this.dump['state-meta-remap'];
        if (!r) return null;
        return { encoding: r.encoding, records: r.remap ?? [], byBlock: this._remapIndex(), scanned: r.scanned ?? null, anomalies: r.anomalies ?? null };
    }

    _remapIndex() {
        if (!this._remapByBlock) {
            const byBlock = {};
            for (const x of this.dump['state-meta-remap']?.remap ?? []) (byBlock[x.block] ??= {})[x.idMeta] = x.stateMeta;
            this._remapByBlock = byBlock;
        }
        return this._remapByBlock;
    }

    /**
     * The metadata a Forge client reports for `block` received with metadata `idMeta`
     * (networkId & 15): the remapped meta, else idMeta. null when the dump has no remap table
     * (nothing is guessed) or the block is unknown. Throws a RangeError unless idMeta is an
     * integer 0-15 (#80 review).
     */
    clientMeta(block, idMeta) {
        if (!Number.isInteger(idMeta) || idMeta < 0 || idMeta > 15) throw new RangeError(`rotn-data clientMeta: idMeta must be an integer 0-15, got ${idMeta}`);
        if (!this.dump['state-meta-remap']) return null;
        const n = registryName(block);
        if (!n || !this.names.blocks.has(n)) return null;
        return this._remapIndex()[n]?.[idMeta] ?? idMeta;
    }

    /**
     * networkId -> client meta for the remapped ids only, on a server whose block ids are
     * `blockIds` ({ [registryName]: id }, e.g. forge-bridge's registry sync). Blocks missing from
     * `blockIds` are left out. null when the dump has no remap table.
     * @returns {Map<number, number>|null}
     */
    networkRemap(blockIds) {
        if (!this.dump['state-meta-remap']) return null;
        const out = new Map();
        for (const [block, metas] of Object.entries(this._remapIndex())) {
            const id = blockIds?.[block];
            if (!Number.isInteger(id)) continue;
            for (const [m, stateMeta] of Object.entries(metas)) out.set(id << 4 | Number(m), stateMeta);
        }
        return out;
    }

    // ---- entities ----------------------------------------------------------

    /** Entity facts by registry name: { modId, modEntityTypeId, hostile, kinds, ... } or a stub. */
    entity(input) {
        const n = registryName(input);
        if (!n || !this.names.entities.has(n)) return null;
        const e = this.dump.entities?.entities?.[n];
        return e ? this._withThreat(n, { name: n, propertiesKnown: true, ...e }) : this._withThreat(n, { name: n, propertiesKnown: false });
    }

    /**
     * Threat fields (entity-overrides.json). `imob` is the dump's fact (the class implements IMob);
     * `targetsPlayers` is true only where the override cites bytecode that targets players;
     * `hostile` = imob || targetsPlayers (what forge-bridge and isHostile read); `dangerous` marks
     * threats to avoid rather than fight; `threat` carries the confidence and the bytecode evidence.
     */
    _withThreat(name, e) {
        const o = this.entityOverrides[name];
        const imob = e.hostile ?? null;
        const out = { ...e, imob, targetsPlayers: !!o?.targetsPlayers, dangerous: !!o?.dangerous };
        if (imob !== null || o) out.hostile = !!(imob || o?.targetsPlayers);
        if (o) out.threat = { confidence: o.confidence, evidence: o.evidence, ...(o.note ? { note: o.note } : {}), ...(o.lookAt === false ? { lookAt: false } : {}) };
        const r = this.replacedByMod[name];
        if (r) {
            const replacements = Object.entries(this.dump.entities?.entities ?? {})
                .filter(([, x]) => x.class?.startsWith(r.replacementsPackage + '.') && x.class.slice(r.replacementsPackage.length + 1).indexOf('.') < 0)
                .map(([n]) => n).sort();
            out.replacedBy = { by: r.by, config: r.config, replacements };
        }
        return out;
    }

    /** True if another mod removes this vanilla entity on this pack (Animania's chicken, cow, pig, rabbit, sheep). */
    isReplaced(input) {
        return !!this.entity(input)?.replacedBy;
    }

    /** True for entities to avoid rather than fight (Ice and Fire dragons, sea serpent, ...). */
    isDangerous(input) {
        return !!this.entity(input)?.dangerous;
    }

    /** Mod-local entity table (ADR 0004): FML EntitySpawn's (modId, modEntityTypeId) -> registry name. */
    entityByModId(modId, modEntityTypeId) {
        if (!this._entitiesByModId) {
            this._entitiesByModId = new Map();
            for (const [name, e] of Object.entries(this.dump.entities?.entities ?? {})) {
                if (e.modSpawn !== false && e.modEntityTypeId != null) this._entitiesByModId.set(`${e.modId}#${e.modEntityTypeId}`, this._withThreat(name, { name, ...e }));
            }
        }
        return this._entitiesByModId.get(`${modId}#${modEntityTypeId}`) ?? null;
    }

    /**
     * net-forge's mod-local entity table shape: { [modId]: { [modEntityTypeId]: registryName } },
     * from every dumped entity with an FML mod spawn (modSpawn !== false) and an integer type id.
     * Entities with usesVanillaSpawning arrive in vanilla spawn packets and are named through
     * bot.registry.entitiesByForgeId instead, but they are listed here too.
     */
    modEntityTable() {
        const out = {};
        for (const [name, e] of Object.entries(this.dump.entities?.entities ?? {})) {
            if (e.modSpawn === false || !Number.isInteger(e.modEntityTypeId) || !e.modId) continue;
            (out[e.modId] ??= {})[e.modEntityTypeId] = name;
        }
        return out;
    }

    // ---- how to get an item (Phase 3) --------------------------------------

    /** Every way to get an item: world rules, crafting, smelting, plain block drops (src/howto.js). */
    howToGet(input, opts) {
        return howToGet(this, input, opts);
    }

    /** The "4 identical rocks -> block" recipes: which block each rock type makes (src/howto.js). */
    rockRecipes() {
        return rockRecipes(this);
    }

    // ---- first-night threats (Phase 3) -------------------------------------

    /** How to react to a mob: level, reaction, summary and evidence (src/threats.js). */
    threatOf(input) {
        return threatOf(this, input);
    }

    /** The digging facts for a mob (src/digging.js), or null when it does not dig. */
    mobDigging(entityName) {
        return mobDigging(this, entityName);
    }

    /** Whether a digging mob can dig a block state (src/digging.js). */
    canMobDig(entityName, blockName, opts) {
        return canMobDig(this, entityName, blockName, opts);
    }

    /** How to get food from a wild block state (src/forage.js), or null when it is not a forage source. */
    forageFood(block, meta) {
        return forageFood(this, block, meta);
    }

    /** Every forage block to look for, best first (src/forage.js). */
    forageSources(opts) {
        return forageSources(this, opts);
    }

    /** Plant hazards of a block state (poison ivy, thorns, the hawthorn's right-click), or null. */
    forageHazard(block, meta) {
        return forageHazard(this, block, meta);
    }

    /** Hostile mobs a biome (default: the overworld) spawns at night, most likely first (src/threats.js). */
    nightThreats(opts) {
        return nightThreats(this, opts);
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
