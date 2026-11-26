// Round 17 V (Fable verdict 2, S2; the lead's plan approval): one inventory view. Soak 15's readers disagreed: findItem
// and crafting read items() (slots 9-44), countItem and carriedItems added the off hand, !inventory and
// world.getInventoryCounts walked every slot, the 2x2 grid, the crafting result and the armour included. The model was
// shown counts the actuators could not use ("19-43 rocks" vs "you have no such rocks"; at 22:51:15 !placeHere("dirt")
// said "Don't have any dirt" while !inventory listed dirt:0: 16, the phantom result mineflayer writes into slot 0).
// Window 0 (1.12): 0 the crafting result, 1-4 the 2x2 grid, 5-8 the armour (head, torso, legs, feet), 9-35 the main
// inventory, 36-44 the hotbar, 45 the off hand; the cursor is inventory.selectedItem.
// Every module reads the inventory through this one (a static test checks no other module reads slots); the window
// click layer (inventory_sync.js) is the only other one that touches slots, to move stacks.

export const SLOTS = Object.freeze({ RESULT: 0, GRID: Object.freeze([1, 2, 3, 4]), ARMOR: Object.freeze([5, 6, 7, 8]), USABLE_FROM: 9, HOTBAR_FROM: 36, USABLE_TO: 44, OFF_HAND: 45 });
/** #657 review 5: the 2x2 grid's slots, for the click layer (inventory_sync.js re-exports it). */
export const GRID_SLOTS = SLOTS.GRID;
export const OFF_HAND = SLOTS.OFF_HAND;
export const ARMOR_NAMES = Object.freeze(['head', 'torso', 'legs', 'feet']);

const ok = (s) => !!s && typeof s.name === 'string' && (s.count ?? 1) > 0;
const slotsOf = (bot) => (Array.isArray(bot?.inventory?.slots) ? bot.inventory.slots : []);

/**
 * Where the bot's stacks are: {usable, offHand, cursor, grid, result, armor}.
 * usable: slots 9-44 (what crafting, placing and an eat can use: mineflayer's items() when it has one);
 * offHand: slot 45 (where #614 keeps the stone pickaxe: a death keeps it); cursor: the stack on the cursor;
 * grid: the 2x2 crafting grid's stacks (each with its slot); result: the crafting result slot (mineflayer writes the
 * predicted result there before it clicks it: never a held stack); armor: {head, torso, legs, feet}.
 */
export function view(bot) {
    const slots = slotsOf(bot);
    let usable;
    try { usable = typeof bot?.inventory?.items === 'function' ? bot.inventory.items().filter(ok) : null; } catch { usable = null; }
    usable ??= slots.slice(SLOTS.USABLE_FROM, SLOTS.USABLE_TO + 1).filter(ok);
    const armor = {};
    SLOTS.ARMOR.forEach((k, i) => { armor[ARMOR_NAMES[i]] = ok(slots[k]) ? slots[k] : null; });
    return {
        usable,
        offHand: ok(slots[SLOTS.OFF_HAND]) ? slots[SLOTS.OFF_HAND] : null,
        cursor: ok(bot?.inventory?.selectedItem) ? bot.inventory.selectedItem : null,
        grid: SLOTS.GRID.filter(k => ok(slots[k])).map(k => slots[k]),
        result: ok(slots[SLOTS.RESULT]) ? slots[SLOTS.RESULT] : null,
        armor,
    };
}

/** The usable stacks and the off-hand one: what the bot carries to use (tools, food, blocks). */
export function carried(bot) {
    const v = view(bot);
    return v.offHand && !v.usable.includes(v.offHand) ? [...v.usable, v.offHand] : v.usable;
}

/** The off-hand stack, or null. */
export const offHand = (bot) => view(bot).offHand;
/** The cursor's stack, or null. */
export const cursorStack = (bot) => view(bot).cursor;
/** The worn armour as a list (no empty slots). */
export const wornArmor = (bot) => Object.values(view(bot).armor).filter(Boolean);
/** Whether the 2x2 grid holds anything, and its slot numbers. */
export const gridSlotsHeld = (bot) => SLOTS.GRID.filter(k => ok(slotsOf(bot)[k]));

/**
 * Every stack anywhere in window 0 and on the cursor (the death report's loss diff and a tool's break check, which must
 * see a stack wherever it went), each once.
 */
export function everyStack(bot) {
    const out = slotsOf(bot).filter(ok);
    const c = view(bot).cursor;
    if (c && !out.includes(c)) out.push(c);
    return out;
}

/** A free main or hotbar slot (9-44) other than `except`, or null. */
export function freeUsableSlot(bot, except = null) {
    const slots = slotsOf(bot);
    for (let i = SLOTS.USABLE_FROM; i <= SLOTS.USABLE_TO; i++) if (i !== except && !slots[i]) return i;
    return null;
}

/** The hotbar's 9 slots (36-44), empty ones as null: which one to hold. */
export const hotbar = (bot) => Array.from({ length: 9 }, (_, i) => { const st = slotsOf(bot)[SLOTS.HOTBAR_FROM + i]; return ok(st) ? st : null; });
/** An open window's cursor stack (a chest's or a table's), or null. */
export const windowCursor = (win) => (ok(win?.selectedItem) ? win.selectedItem : null);

/** The count of slots in window 0 (the report's totalSlots). */
export const slotCount = (bot) => slotsOf(bot).length;

/** The first stack among `stacks` the predicate takes, or null. */
export const findIn = (stacks, pred) => stacks.find(s => ok(s) && pred(s)) ?? null;
