// The overworld biomes of the dump's spawn lists (shared by tools/build-common-mobs.mjs and
// src/threats.js). The dump has no dimension per biome, so they are chosen by name: the server
// uses level-type BIOMESOP, so the overworld is vanilla plus Biomes O' Plenty, plus mods that add
// overworld biomes (Defiled Lands, Ice and Fire's glacier).

export const OVERWORLD_NAMESPACES = ['minecraft', 'biomesoplenty', 'defiledlands'];
export const OVERWORLD_EXTRA = ['iceandfire:glacier'];
export const NOT_OVERWORLD = new Set([
    'minecraft:hell', 'minecraft:sky', 'minecraft:void',
    // Biomes O' Plenty's Nether biomes
    'biomesoplenty:corrupted_sands', 'biomesoplenty:fungi_forest', 'biomesoplenty:phantasmagoric_inferno',
    'biomesoplenty:polar_chasm', 'biomesoplenty:undergarden', 'biomesoplenty:visceral_heap',
]);

/** Is this biome registry name an overworld biome? */
export const isOverworldBiome = (b) => !NOT_OVERWORLD.has(b) && (OVERWORLD_NAMESPACES.includes(b.split(':')[0]) || OVERWORLD_EXTRA.includes(b));
