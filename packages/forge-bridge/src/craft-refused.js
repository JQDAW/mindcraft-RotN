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

const ATTACHED = Symbol.for('mindcraft-rotn.craftRefusedLog');
export const CRAFT_REFUSED = { maxLines: 50 };
/** The notice after the last line (for harness-ops' soak-invariants). */
export const craftRefusedCapLine = (maxLines) => `craft refused: ${maxLines} lines logged; further refusals on this connection are not`;

/** The line (without the "[forge-bridge] " prefix) for one craftResultRefused event. */
export function craftRefusedLine(ev) {
    const where = `window ${ev?.windowId ?? '?'}${ev?.windowType ? ` (${ev.windowType})` : ''}`;
    const what = ev?.server
        ? `the server makes ${ev.server} from this grid, not ${ev?.expected ?? '?'}`
        : `the server has no result for this grid, expected ${ev?.expected ?? '?'}`;
    return `craft refused: ${where}: ${what}; nothing taken`;
}

/**
 * Logs each craftResultRefused (patches/mineflayer craft.js). Once per bot.
 * @returns {{lines: number, dropped: number}} a live count
 */
export function attachCraftRefusedLog(bot, { log = (m) => console.log(`[forge-bridge] ${m}`), maxLines = CRAFT_REFUSED.maxLines } = {}) {
    if (bot[ATTACHED]) return bot[ATTACHED];
    const report = { lines: 0, dropped: 0 };
    bot[ATTACHED] = report;
    bot.on('craftResultRefused', (ev) => {
        if (report.lines >= maxLines) { report.dropped++; return; }
        report.lines++;
        log(craftRefusedLine(ev));
        if (report.lines === maxLines) log(craftRefusedCapLine(maxLines));
    });
    return report;
}
