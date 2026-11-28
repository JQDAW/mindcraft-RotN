// A line when a craft is refused because the server makes something else from the grid (soak 16).
//
// Two pack recipes can take the same grid: 9 sticks are DungeonTactics' planks_from_sticks and
// AncientBeasts' stick_wall, and the server (FastWorkbench, CraftingManager.findMatchingRecipe) makes
// the first in its registry. mineflayer wrote the chosen recipe's result into slot 0 and clicked it;
// the server took the stick wall, used up the 9 sticks, and rejected the click. patches/mineflayer
// (craft.js grabResult) now reads the server's slot 0 first; when it is another item, or empty after
// 500 ms, it clicks nothing, emits craftResultRefused and throws. This logs, once per refusal:
//
//   [forge-bridge] craft refused: window 1 (minecraft:crafting_table): the server makes
//   ancientbeasts:stick_wall x1 from this grid, not planks x1; nothing taken
//
// or, with no result: "... the server has no result for this grid, expected planks x1; nothing taken".
// At most CRAFT_REFUSED.maxLines lines per connection, then one notice. Nothing is consumed: at a table
// mineflayer's craft() closes the window and the server puts the grid back into the inventory; the
// 2x2 grid stays until skills' returnGrid (#619) closes window 0.
//
// Soak 18: a crafted result that finds no room in the inventory (no stack of it with room, no empty
// slot 9-44) is thrown on the ground by mineflayer's putAway (a slot -999 click: Container.slotClick
// drops the cursor at the bot's feet, and a full inventory cannot pick it up), and bot.craft still
// resolves. The patch (craft.js grabResult) emits craftResultDropped; this logs, with its own cap:
//
//   [forge-bridge] craft result undergroundbiomes:igneous_cobble:2 x1: thrown on the ground at -169, 69, -133
//   (window 0, minecraft:inventory): no inventory slot had room
//
// or, when part of it joined a stack: "craft result planks x4: 2 into the inventory, 2 thrown on the ground ...".

const ATTACHED = Symbol.for('mindcraft-rotn.craftRefusedLog');
export const CRAFT_REFUSED = { maxLines: 50 };
/** The notice after the last line (for harness-ops' soak-invariants). */
export const craftRefusedCapLine = (maxLines) => `craft refused: ${maxLines} lines logged; further refusals on this connection are not`;

/** The notice after the last craft-result line. */
export const craftDroppedCapLine = (maxLines) => `craft result: ${maxLines} lines logged; further thrown results on this connection are not`;

/** The line (without the "[forge-bridge] " prefix) for one craftResultDropped event. */
export function craftDroppedLine(ev) {
    const made = ev?.count ?? '?';
    const thrown = ev?.thrown ?? '?';
    const p = ev?.position;
    const at = p && [p.x, p.y, p.z].every(Number.isFinite) ? ` at ${p.x}, ${p.y}, ${p.z}` : '';
    const where = `window ${ev?.windowId ?? '?'}${ev?.windowType ? `, ${ev.windowType}` : ''}`;
    const split = typeof made === 'number' && typeof thrown === 'number' && thrown < made ? `${made - thrown} into the inventory, ${thrown} ` : '';
    return `craft result ${ev?.result ?? '?'}: ${split}thrown on the ground${at} (${where}): no inventory slot had room${split ? ' for them' : ''}`;
}

/** The line (without the "[forge-bridge] " prefix) for one craftResultRefused event. */
export function craftRefusedLine(ev) {
    const where = `window ${ev?.windowId ?? '?'}${ev?.windowType ? ` (${ev.windowType})` : ''}`;
    const what = ev?.server
        ? `the server makes ${ev.server} from this grid, not ${ev?.expected ?? '?'}`
        : `the server has no result for this grid, expected ${ev?.expected ?? '?'}`;
    return `craft refused: ${where}: ${what}; nothing taken`;
}

/**
 * Logs each craftResultRefused and each craftResultDropped (patches/mineflayer craft.js). Once per bot.
 * Each kind has its own cap of maxLines lines.
 * @returns {{lines: number, dropped: number, thrown: {lines: number, dropped: number}}} a live count
 *   (the refusals; thrown: the craft-result lines)
 */
export function attachCraftRefusedLog(bot, { log = (m) => console.log(`[forge-bridge] ${m}`), maxLines = CRAFT_REFUSED.maxLines } = {}) {
    if (bot[ATTACHED]) return bot[ATTACHED];
    const report = { lines: 0, dropped: 0, thrown: { lines: 0, dropped: 0 } };
    bot[ATTACHED] = report;
    bot.on('craftResultRefused', (ev) => {
        if (report.lines >= maxLines) { report.dropped++; return; }
        report.lines++;
        log(craftRefusedLine(ev));
        if (report.lines === maxLines) log(craftRefusedCapLine(maxLines));
    });
    bot.on('craftResultDropped', (ev) => {
        const t = report.thrown;
        if (t.lines >= maxLines) { t.dropped++; return; }
        t.lines++;
        log(craftDroppedLine(ev));
        if (t.lines === maxLines) log(craftDroppedCapLine(maxLines));
    });
    return report;
}
