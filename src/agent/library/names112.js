// Minecraft 1.12.2 block and entity facts that Mindcraft's skills assumed in
// 1.21 terms (skills-rotn B1, seam map rows for skills.js, world.js, modes.js
// and queries.js). Vanilla 1.12 registry facts only; RotN item and recipe facts
// come from rotn-data. names112.test.js checks every name here against
// minecraft-data 1.12.2.

// 1.12 splits still and flowing liquids into separate blocks.
export const WATER_BLOCKS = ['water', 'flowing_water'];
export const LAVA_BLOCKS = ['lava', 'flowing_lava'];
export const isWater = (name) => WATER_BLOCKS.includes(name);
export const isLava = (name) => LAVA_BLOCKS.includes(name);
export const isLiquid = (name) => isWater(name) || isLava(name);

// A burning furnace is a different block in 1.12.
export const FURNACE_BLOCKS = ['furnace', 'lit_furnace'];
export const isFurnace = (name) => FURNACE_BLOCKS.includes(name);

// In 1.12 "grass" is the grass block (1.21 "grass_block"); the plant is "tallgrass".
export const GRASS_BLOCK = 'grass';

// Blocks a placed block may replace. Upstream: air, water, lava, (short) grass,
// tall grass, snow (the layer), dead bush, fern. 1.12: tallgrass covers grass,
// fern and dead shrub; double_plant covers tall grass and large fern (and the
// tall flowers, which then fail to place, as before for unknown blocks).
export const EMPTY_BLOCKS = ['air', ...WATER_BLOCKS, ...LAVA_BLOCKS, 'tallgrass', 'double_plant', 'snow_layer', 'deadbush'];

// Wooden doors (1.12 names; no mangrove, cherry, bamboo, crimson or warped).
export const WOODEN_DOORS = ['wooden_door', 'spruce_door', 'birch_door', 'jungle_door', 'acacia_door', 'dark_oak_door'];

// 1.12 world height.
export const WORLD_MIN_Y = 0;
export const WORLD_MAX_Y = 255;

/**
 * Whether a door is open. 1.12 has no block-state properties in minecraft-data
 * (_properties is empty), so read the metadata: the lower half's bit 4 is
 * "open"; the upper half (bit 8 set) keeps hinge and power, so read the block
 * below it.
 */
export function isDoorOpen(bot, block) {
    if (!block) return false;
    if (typeof block._properties?.open === 'boolean') return block._properties.open;
    let lower = block;
    if ((block.metadata & 8) !== 0) lower = bot.blockAt(block.position.offset(0, -1, 0));
    return !!lower && (lower.metadata & 4) !== 0;
}

/** 1.12 Ageable "is baby" is entity metadata index 12, a boolean (1.21: index 16). */
export function isBaby(entity) {
    const m = entity?.metadata;
    return !!m && (m[12] === true || m[12] === 1);
}

// 1.12 villager profession, entity metadata index 13 (an int).
export const VILLAGER_PROFESSIONS_112 = ['Farmer', 'Librarian', 'Priest', 'Blacksmith', 'Butcher', 'Nitwit'];
