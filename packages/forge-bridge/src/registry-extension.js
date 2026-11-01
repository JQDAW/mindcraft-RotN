// Extends mineflayer's bot.registry (prismarine-registry over minecraft-data
// 1.12.2) with the ids the Forge server synced in RegistryData (ADR 0003
// decision 4, net-forge brief item 4), so bot.blockAt(), inventory items, mob
// spawns and biomes carry modded names.
//
// The shared-registry contract (for rotn-data and Mindcraft's helpers):
// - Vanilla entries keep minecraft-data's object and unprefixed name ("stone").
//   If the server moved a vanilla name to another id, a copy with the new id is used.
// - Modded entries are new objects named by their full registry name
//   ("pyrotech:rock"), with `registryName` and `forge: { modded: true,
//   propertiesKnown }`. Without rotn-data's properties they get safe defaults:
//   a block is a solid full cube (so physics never falls through a modded floor),
//   diggable, hardness null, no drops; an item stacks to 64; an entity is a mob.
// - Block states are `id << 4 | meta`, so blocksByStateId gets 16 states per block.
// - `properties` (rotn-data's dump, ADR 0004) can fill in or override any field,
//   keyed by full registry name.
// - Dummied entries (registered by a mod the client claims but the save lacks) are skipped.
// - Only bot.registry's own maps (and its blockCollisionShapes) are replaced. prismarine-registry copies
//   minecraft-data shallowly, so the maps are copied before they change, and the
//   process-wide minecraft-data object stays vanilla.

const SECTION = { blocks: 'minecraft:blocks', items: 'minecraft:items', entities: 'minecraft:entities', biomes: 'minecraft:biomes' };
const FULL_CUBE = [[0, 0, 0, 1, 1, 1]];

function displayNameOf(registryName) {
    const path = registryName.includes(':') ? registryName.split(':')[1] : registryName;
    return path.split(/[_/.]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

const vanillaName = (registryName) => (registryName.startsWith('minecraft:') ? registryName.slice('minecraft:'.length) : null);

const DEFAULTS = {
    blocks: (id, name) => ({
        id, name, displayName: displayNameOf(name), hardness: null, resistance: null, stackSize: 64,
        diggable: true, boundingBox: 'block', shapes: FULL_CUBE, material: undefined, harvestTools: undefined,
        drops: [], transparent: false, emitLight: 0, filterLight: 15,
        minStateId: id << 4, maxStateId: (id << 4) | 15, defaultState: id << 4,
    }),
    items: (id, name) => ({ id, name, displayName: displayNameOf(name), stackSize: 64 }),
    entities: (id, name) => ({ id, internalId: id, name, displayName: displayNameOf(name), type: 'mob', width: null, height: null, category: 'Modded' }),
    biomes: (id, name) => ({ id, name, displayName: displayNameOf(name), category: 'none', temperature: 0.5, precipitation: 'rain', rainfall: 0.5, depth: 0, dimension: 'overworld', color: 0 }),
};

function rebind(kind, base, id) {
    const e = { ...base, id };
    if (kind === 'blocks') Object.assign(e, { minStateId: id << 4, maxStateId: (id << 4) | 15, defaultState: id << 4 });
    if (kind === 'entities') e.internalId = id;
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
 * @param {{ properties?: { blocks?: object, items?: object, entities?: object, biomes?: object } }} [opts]
 * @returns {{ added: object, rebound: object, total: object }} counts per kind
 */
export function extendRegistry(registry, snapshot, { properties = {} } = {}) {
    const report = { added: {}, rebound: {}, total: {} };
    for (const [kind, section] of Object.entries(SECTION)) {
        const synced = snapshot.get(section);
        const byId = { ...(registry[kind] ?? {}) };
        const staticByName = registry[`${kind}ByName`] ?? {};
        let added = 0;
        let rebound = 0;
        if (synced) {
            for (const [regName, id] of synced.byName) {
                if (synced.dummied?.has(regName)) continue;
                const vName = vanillaName(regName);
                const base = vName ? staticByName[vName] : null;
                let entry;
                if (base && base.id === id && !properties[kind]?.[regName]) {
                    entry = base; // unchanged vanilla object
                } else if (base) {
                    entry = rebind(kind, base, id);
                    if (base.id !== id) {
                        rebound++;
                        if (byId[base.id] === base) delete byId[base.id]; // the old slot is no longer this name's
                    }
                } else {
                    entry = { ...DEFAULTS[kind](id, regName), registryName: regName, forge: { modded: true, propertiesKnown: false } };
                    added++;
                }
                const props = properties[kind]?.[regName];
                if (props) {
                    entry = { ...entry, ...props, id, name: entry.name };
                    if (entry.forge) entry.forge = { ...entry.forge, propertiesKnown: true };
                }
                byId[id] = entry;
            }
        }
        const array = Object.values(byId);
        registry[kind] = byId;
        registry[`${kind}Array`] = array;
        registry[`${kind}ByName`] = Object.fromEntries(array.map(e => [e.name, e]));
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
        report.added[kind] = added;
        report.rebound[kind] = rebound;
        report.total[kind] = array.length;
    }
    return report;
}
