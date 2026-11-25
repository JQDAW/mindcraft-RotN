// Item stack sizes as the server has them (soak 15, the rejected window clicks).
//
// StackUp 0.2.5 (config/stackup/*.stackup) raises stack sizes on RotN 3.3.4: dirt piles, rocks and
// sticks 256; dirt, cobble and planks 128; and some go down (modded tools 1). bot.registry had 64
// for every modded item (extendRegistry's default) and minecraft-data's value for vanilla ones, and
// prismarine-windows predicts every click with that stackSize (fillSlotWithSelectedItem, the craft
// result's maxTransferrable, mineflayer's putSelectedItemRange). A 1.12 server sends no slot update
// after a click it accepts (EntityPlayerMP.isChangingQuantityOnly during the click's
// detectAndSendChanges), so each merge past 64 left the client's window silently wrong, and a later
// click on that slot was rejected ("Server rejected transaction", 18 times in soak 15).
//
// rotn-data's dump has each item's runtime stackSize (StackUp applied). applyStackSizes writes it
// into bot.registry with applyProperties (entries are swapped in every map, never changed in
// minecraft-data's shared objects), once the registry is extended and before any window arrives:
// prismarine-item reads registry.items[type].stackSize when it makes each Item.
//
// #618 review 5, a known limit: the size is per item, not per stack. Forge's
// Item.getItemStackLimit(ItemStack) can depend on a stack's meta or NBT, but rotn-data's dump records
// one stackSize per item (its 9,710 variant entries carry none of their own), and prismarine-item
// takes stackSize from the item type alone. An item whose limit varies by stack keeps its item value
// (the dump cannot show whether any item on this pack does). Covering one would need a per-stack size
// in the dump and a prismarine-item patch.

import { applyProperties } from './registry-extension.js';

/** The registry entry for a dumped item name: the full name, else (vanilla) the bare one. */
function entryFor(registry, name) {
    const byName = registry?.itemsByName ?? {};
    return byName[name] ?? (name.startsWith('minecraft:') ? byName[name.slice('minecraft:'.length)] : undefined);
}

/**
 * The dumped stack sizes that differ from bot.registry's: { properties: {items: {name: {stackSize}}},
 * vanilla, modded, notInRegistry }. Items the registry does not have (not on this server) are counted
 * and left out; an item with no positive integer stackSize in the dump is left out.
 */
export function dumpStackSizes(dumpItems, registry) {
    const items = {};
    let vanilla = 0, modded = 0, notInRegistry = 0;
    for (const [name, item] of Object.entries(dumpItems ?? {})) {
        const size = item?.stackSize;
        if (!Number.isInteger(size) || size < 1) continue;
        const entry = entryFor(registry, name);
        if (!entry) { notInRegistry++; continue; }
        if (entry.stackSize === size) continue;
        items[name] = { stackSize: size };
        if (name.startsWith('minecraft:')) vanilla++; else modded++;
    }
    return { properties: { items }, vanilla, modded, notInRegistry };
}

/**
 * Sets bot.registry's item stack sizes to the server's (rotn-data's dump). The registry must be
 * extended (applyProperties refuses minecraft-data's shared maps). Logs one line.
 * @returns {{ changed: number, vanilla: number, modded: number, notInRegistry: number, missing: string[] }}
 */
export function applyStackSizes(registry, dumpItems, { log = () => {}, examples = ['betterwithmods:dirt_pile', 'pyrotech:rock', 'minecraft:dirt', 'minecraft:stick', 'pyrotech:crude_axe'] } = {}) {
    const { properties, vanilla, modded, notInRegistry } = dumpStackSizes(dumpItems, registry);
    const { applied, missing } = applyProperties(registry, properties);
    const changed = applied.items ?? 0;
    const shown = examples.filter((n) => properties.items[n]).map((n) => `${n} ${properties.items[n].stackSize}`);
    log(`stack sizes: ${changed} items from the dump (${vanilla} vanilla, ${modded} modded) differ from 64 or minecraft-data${shown.length ? `, e.g. ${shown.join(', ')}` : ''}`);
    return { changed, vanilla, modded, notInRegistry, missing };
}
