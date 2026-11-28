// Soak 18 S18c (rotn-data's finding, /home/rv/s18-cobble-variant.md; dl:2142-2149, dl:2311-2352): a craft with the
// inventory full. "Could not craft undergroundbiomes:igneous_cobble:2: the craft gave no ...": 36 stacks, the 4
// rhyolite rocks came from a stack of 5 (1 left, so no slot freed), and the cobble had nowhere to go: mineflayer's
// putAway threw it on the ground, where a full inventory cannot pick it up. net-forge's #682 emits
// 'craftResultDropped' inside bot.craft for that. These say before a craft whether its result has room, and after it
// what was thrown.
import * as inv from './inventory_view.js';
import { itemMatches } from './rotn_names.js';

const stackMax = (bot, s) => s?.stackSize ?? bot?.registry?.items?.[s?.type]?.stackSize ?? 64;

/** No free main or hotbar slot (9-44). */
export const inventoryFull = (bot) => inv.freeUsableSlot(bot) === null;

/** A held stack of `name` (its variant, e.g. "undergroundbiomes:igneous_cobble:2") with room for more. */
export function roomFor(bot, name) {
    const items = bot?.inventory?.items?.() ?? [];
    return items.some(s => itemMatches(s, name) && (s.count ?? 0) < stackMax(bot, s));
}

/** Whether a craft's result of `name` has somewhere to go now: a free slot, or a stack of it with room. */
export const resultHasRoom = (bot, name) => !inventoryFull(bot) || roomFor(bot, name);

/**
 * Watch bot.craft for results thrown on the ground (#682 'craftResultDropped'). The listener never throws (a
 * throwing listener would make bot.craft reject after the throw). Returns {drops, stop}.
 */
export function watchCraftDrops(bot) {
    const drops = [];
    const onDrop = (ev) => {
        try { drops.push({ name: ev?.name ?? null, metadata: ev?.metadata ?? 0, count: ev?.count ?? null, thrown: ev?.thrown ?? 0, position: ev?.position ?? null }); } catch { /* never throw here */ }
    };
    try { bot?.on?.('craftResultDropped', onDrop); } catch { /* no events */ }
    return { drops, stop: () => { try { bot?.removeListener?.('craftResultDropped', onDrop); } catch { /* gone */ } } };
}

const at = (p) => (p && Number.isFinite(p.x) ? ` at ${p.x}, ${p.y}, ${p.z}` : '');

/**
 * The why of a craft whose result count did not rise: the result was thrown (drops), or the inventory was full with no
 * stack of it with room. Null when neither (some other cause).
 */
export function noRoomWhy(bot, itemName, drops = []) {
    const thrown = drops.reduce((n, d) => n + (d.thrown ?? 0), 0);
    if (thrown > 0) {
        const d = drops.filter(x => (x.thrown ?? 0) > 0).at(-1);
        return `the craft made it, but your inventory is full (no free slot, no ${itemName} stack with room), so ${thrown} ${d.name ?? itemName} `
            + `${thrown === 1 ? 'was' : 'were'} thrown on the ground${at(d.position)}: free a slot (!discard something you do not need), then pick it up`;
    }
    if (inventoryFull(bot) && !roomFor(bot, itemName))
        return `your inventory is full (no free slot, no ${itemName} stack with room), so the result had nowhere to go: free a slot first (!discard something you do not need)`;
    return null;
}
