// Extends mineflayer's bot.registry (prismarine-registry over minecraft-data
// 1.12.2) with the ids the Forge server synced in RegistryData (ADR 0003
// decision 4, net-forge brief item 4), so bot.blockAt(), inventory items, mob
// spawns and biomes carry modded names.
//
// The shared-registry contract (for rotn-data and Mindcraft's helpers):
// - Vanilla entries keep minecraft-data's object and unprefixed name ("stone").
//   If the server moved a vanilla block, item or biome to another id, a copy with
//   the new id is used, and every such rebind is reported and logged.
// - Entities are different: minecraft:entities holds EntityList ids, but 1.12's
//   spawn_entity uses *object* ids (item 2, arrow 60, boat 1), which is what
//   minecraft-data's entities map holds for objects. Vanilla entity entries are
//   therefore never rebound or deleted. Modded entities are added only where the id
//   is free, and entitiesByForgeId maps every synced EntityList id to its entry.
// - Modded entries are new objects named by their full registry name
//   ("pyrotech:rock"), with `registryName` and `forge: { modded: true,
//   propertiesKnown }`. Without rotn-data's properties they get safe defaults:
//   a block is a solid full cube (so physics never falls through a modded floor),
//   diggable with a conservative hardness of 1.5 (stone's, so digTime is > 0),
//   no drops; an item stacks to 64; an entity is a mob.
// - Block states are `id << 4 | meta`, so blocksByStateId gets 16 states per block.
// - `properties` (rotn-data's dump, ADR 0004) can fill in or override any field,
//   keyed by full registry name.
// - Dummied entries (registered by a mod the client claims but the save lacks) are skipped.
// - Only bot.registry's own maps (and its blockCollisionShapes) are replaced. prismarine-registry copies
//   minecraft-data shallowly, so the maps are copied before they change, and the
//   process-wide minecraft-data object stays vanilla.

const SECTION = { blocks: 'minecraft:blocks', items: 'minecraft:items', entities: 'minecraft:entities', biomes: 'minecraft:biomes' };
const FULL_CUBE = [[0, 0, 0, 1, 1, 1]];
// Stone's hardness. With hardness null and diggable true, prismarine-block's digTime
// is 0, so pathfinder plans through modded blocks and bot.dig loops (PR #25 review).
export const DEFAULT_BLOCK_HARDNESS = 1.5;

function displayNameOf(registryName) {
    const path = registryName.includes(':') ? registryName.split(':')[1] : registryName;
    return path.split(/[_/.]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

const vanillaName = (registryName) => (registryName.startsWith('minecraft:') ? registryName.slice('minecraft:'.length) : null);

const DEFAULTS = {
    blocks: (id, name) => ({
        id, name, displayName: displayNameOf(name), hardness: DEFAULT_BLOCK_HARDNESS, resistance: null, stackSize: 64,
        diggable: true, boundingBox: 'block', shapes: FULL_CUBE, material: undefined, harvestTools: undefined,
        drops: [], transparent: false, emitLight: 0, filterLight: 15,
        minStateId: id << 4, maxStateId: (id << 4) | 15, defaultState: id << 4,
    }),
    items: (id, name) => ({ id, name, displayName: displayNameOf(name), stackSize: 64 }),
    entities: (id, name) => ({ id, internalId: id, name, displayName: displayNameOf(name), type: 'mob', width: null, height: null, category: 'Modded' }),
    biomes: (id, name) => ({ id, name, displayName: displayNameOf(name), category: 'none', temperature: 0.5, precipitation: 'rain', rainfall: 0.5, depth: 0, dimension: 'overworld', color: 0 }),
};

function applyProps(entry, props, id) {
    if (!props) return entry;
    const e = { ...entry, ...props, id, name: entry.name };
    if (e.forge) e.forge = { ...e.forge, propertiesKnown: true };
    return e;
}

function rebind(kind, base, id) {
    const e = { ...base, id };
    if (kind === 'blocks') Object.assign(e, { minStateId: id << 4, maxStateId: (id << 4) | 15, defaultState: id << 4 });
    return e;
}

// prismarine-block's class factory sets every block's `shapes` from
// registry.blockCollisionShapes by name, so a Block class made after this
// extension would drop the shapes of names it does not know. Register each
// modded (or reshaped) block in a copy of that table under its own shape key.
function registerShapes(registry, blocks) {
    const table = registry.blockCollisionShapes;
    if (!table || blocks.length === 0) return;
    const copy = { shapes: { ...table.shapes }, blocks: { ...table.blocks } };
    for (const b of blocks) {
        const key = `forge:${b.name}`;
        copy.shapes[key] = b.shapes ?? FULL_CUBE;
        copy.blocks[b.name] = key;
    }
    registry.blockCollisionShapes = copy;
}

/**
 * @param {object} registry  bot.registry (mutated: its maps for blocks, items, entities and biomes are replaced)
 * @param {import('./registries.js').RegistrySnapshot} snapshot  the synced Forge registries
 * @param {{ properties?: { blocks?: object, items?: object, entities?: object, biomes?: object }, log?: (msg: string) => void }} [opts]
 * @returns {{ added: object, rebound: object, total: object, rebinds: Array<{kind:string, name:string, from:number, to:number}>, entityIdsKept: number, entityIdsTaken: number }}
 */
export function extendRegistry(registry, snapshot, { properties = {}, log = () => {} } = {}) {
    const report = { added: {}, rebound: {}, total: {}, rebinds: [], aliases: [], entityIdsKept: 0, entityIdsTaken: 0 };
    const entitiesByForgeId = {};
    for (const [kind, section] of Object.entries(SECTION)) {
        const synced = snapshot.get(section);
        const byId = { ...(registry[kind] ?? {}) };
        const staticByName = registry[`${kind}ByName`] ?? {};
        const staticArray = registry[`${kind}Array`] ?? [];
        // 1.12 names of vanilla entries that minecraft-data spells the 1.13 way
        // (minecraft:silver_shulker_box, minecraft:beaches, ...), aliased in *ByName.
        const aliases = new Map();
        const alias = (vName, regName, entry, id) => {
            aliases.set(vName, entry);
            aliases.set(regName, entry); // also the full "minecraft:<1.12 name>" key
            report.aliases.push({ kind, name: regName, as: entry.name, id });
        };
        // Entities whose list must not be rebuilt from the id map (see below).
        const addedEntities = [];
        let added = 0;
        let rebound = 0;
        if (synced) {
            for (const [regName, id] of synced.byName) {
                if (synced.dummied?.has(regName)) continue;
                const vName = vanillaName(regName);
                const base = vName ? staticByName[vName] : null;
                if (kind === 'entities') {
                    // Never rebind or delete a vanilla entity entry (object ids differ from EntityList ids).
                    if (base) { entitiesByForgeId[id] = base; if (base.id !== id) report.entityIdsKept++; continue; }
                    if (vName) {
                        // A vanilla mob under its 1.12 name: minecraft-data's internalId is the EntityList id.
                        const byInternal = staticArray.filter(e => e.internalId === id);
                        const found = byInternal.find(e => e.type === 'mob') ?? byInternal[0];
                        if (found) { const e = { ...found, registryName: regName }; entitiesByForgeId[id] = e; alias(vName, regName, e, id); continue; }
                    }
                    const entry = applyProps({ ...DEFAULTS.entities(id, regName), registryName: regName, forge: { modded: !vName, propertiesKnown: false } }, properties.entities?.[regName], id);
                    entitiesByForgeId[id] = entry;
                    addedEntities.push(entry);
                    if (byId[id] === undefined) { byId[id] = entry; added++; } else report.entityIdsTaken++;
                    continue;
                }
                let entry;
                if (base && base.id === id && !properties[kind]?.[regName]) {
                    entry = base; // unchanged vanilla object
                } else if (base) {
                    entry = rebind(kind, base, id);
                    if (base.id !== id) {
                        rebound++;
                        report.rebinds.push({ kind, name: regName, from: base.id, to: id });
                        log(`registry rebind: ${kind} ${regName} ${base.id} -> ${id}`);
                        if (byId[base.id] === base) delete byId[base.id]; // the old slot is no longer this name's
                    }
                } else if (vName && byId[id] && !byId[id].forge) {
                    // A vanilla entry minecraft-data names differently (1.13 spelling): keep its
                    // data, record the 1.12 name as registryName, and alias the 1.12 name in *ByName
                    // (minecraft-data's name stays there too). A copy, so the shared object is untouched.
                    entry = { ...byId[id], registryName: regName };
                    alias(vName, regName, entry, id);
                } else {
                    // forge.modded only for non-minecraft: names. A vanilla name with no vanilla
                    // entry at all (items air, portal, end_portal, end_gateway) gets defaults
                    // under its unprefixed name, like every other vanilla entry.
                    entry = { ...DEFAULTS[kind](id, vName ?? regName), registryName: regName, forge: { modded: !vName, propertiesKnown: false } };
                    added++;
                }
                entry = applyProps(entry, properties[kind]?.[regName], id);
                byId[id] = entry;
            }
        }
        // In 1.12, minecraft-data's entities list holds mobs and objects whose ids overlap
        // (50 is both creeper and the tnt object), so the id map hides some of them.
        // Keep minecraft-data's entitiesArray and entitiesByName as they are and only
        // append modded entries (PR #25 review); other kinds are rebuilt from the id map.
        const array = kind === 'entities' ? [...staticArray, ...addedEntities] : Object.values(byId);
        registry[kind] = byId;
        registry[`${kind}Array`] = array;
        const byName = kind === 'entities'
            ? { ...staticByName, ...Object.fromEntries(addedEntities.filter(e => !(e.name in staticByName)).map(e => [e.name, e])) }
            : Object.fromEntries(array.map(e => [e.name, e]));
        for (const [n, e] of aliases) if (!(n in byName)) byName[n] = e;
        registry[`${kind}ByName`] = byName;
        if (kind === 'blocks') {
            const byState = {};
            for (const b of array) {
                const min = b.minStateId ?? (b.id << 4);
                const max = b.maxStateId ?? ((b.id << 4) | 15);
                for (let s = min; s <= max; s++) byState[s] = b;
            }
            registry.blocksByStateId = byState;
            registerShapes(registry, array.filter(b => b.forge || properties.blocks?.[b.registryName ?? `minecraft:${b.name}`]?.shapes));
        }
        if (kind === 'entities') registry.entitiesByForgeId = entitiesByForgeId;
        report.added[kind] = added;
        report.rebound[kind] = rebound;
        report.total[kind] = array.length;
    }
    return report;
}
