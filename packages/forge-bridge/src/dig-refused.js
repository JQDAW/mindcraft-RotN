// A line when the Forge dig-time rule refuses a dig (soak 15).
//
// bot.dig throws "dig time for X is Infinity" at once when Tool Progression keeps the held item from
// block X (dig-time.js; no packet goes out). In soak 15 the stone pickaxe was in the off hand (slot
// 45, #614's rearmWeapon), out of sight of equipForBlock and the pathfinder (inventory.items() is
// slots 9-44), so every stone dig was refused and the bot was trapped; the journal could not show
// where the pickaxe was. This line does, once per block and position:
//
//   [forge-bridge] dig refused: undergroundbiomes:metamorphic_stone:6 at -58, 55, -50 (pickaxe level 0,
//   hardness 0.9); held planks:1 (no pickaxe level); pickaxe tools: stone_pickaxe (level 0) off hand;
//   rule: held Infinity, stone_pickaxe 350 ms
//
// The tools listed are those of the block's harvest tool class (pickaxe when the block names none),
// wherever they are in the player window: hotbar <n>, main <slot>, off hand, armour <slot>, grid
// <slot> (the 2x2 crafting grid), cursor. "rule" is the installed digTime for each, as if held.

const ATTACHED = Symbol.for('mindcraft-rotn.digRefusedLog');
const INFINITY_ERR = /dig time for .+ is Infinity/;
export const DIG_REFUSED = { maxKeys: 1000 };

/** Where a slot of the player window is, in words. */
export function slotPlace(slot) {
    if (slot === 'cursor') return 'cursor';
    if (slot === 45) return 'off hand';
    if (slot >= 36 && slot <= 44) return `hotbar ${slot - 36}`;
    if (slot >= 9 && slot <= 35) return `main ${slot}`;
    if (slot >= 5 && slot <= 8) return `armour ${slot}`;
    if (slot >= 1 && slot <= 4) return `grid ${slot}`;
    return `slot ${slot}`;
}

const itemName = (item) => (item ? `${item.name}${item.metadata ? `:${item.metadata}` : ''}` : 'nothing');
const ms = (t) => (Number.isFinite(t) ? `${Math.round(t)} ms` : String(t));

/**
 * The line for a refused dig of `block` (bot.dig's own throw), or null when the block is missing.
 * @param {object} bot mineflayer bot
 * @param {object} block the block bot.dig was given
 * @param {{stateOf: Function, toolOf: Function}} sources dumpDigSources(rd, registry)
 */
export function digRefusedLine(bot, block, sources) {
    if (!block?.position) return null;
    const p = block.position;
    let state = null;
    try { state = sources?.stateOf?.(block) ?? null; } catch { state = null; }
    const cls = state?.harvestTool || 'pickaxe';
    const levelOf = (item) => {
        if (!item) return undefined;
        let tool = null;
        try { tool = sources?.toolOf?.(item.type) ?? null; } catch { tool = null; }
        const lvl = tool?.classes?.[cls];
        return Number.isInteger(lvl) && lvl >= 0 ? lvl : undefined;
    };
    const effects = bot.entity?.effects ?? {};
    const notOnGround = bot.entity ? !bot.entity.onGround : false;
    const timeWith = (item) => {
        try { return block.digTime(item ? item.type : null, false, false, notOnGround, item?.enchants ?? [], effects); } catch (e) { return `error (${e.message})`; }
    };

    const rule = state
        ? `${cls === state.harvestTool ? `${cls} level ${state.harvestLevel ?? 0}` : 'no harvest tool'}${state.toolRequired === false ? ', no tool required' : ''}, hardness ${state.hardness}`
        : 'not in the dump';
    const held = bot.heldItem ?? null;
    const heldLvl = levelOf(held);
    const heldText = `${itemName(held)} (${heldLvl === undefined ? `no ${cls} level` : `${cls} level ${heldLvl}`})`;

    const found = [];
    const slots = bot.inventory?.slots ?? [];
    for (let i = 0; i < slots.length; i++) {
        const it = slots[i];
        if (it && levelOf(it) !== undefined) found.push({ item: it, where: slotPlace(i), slot: i });
    }
    const cursor = bot.inventory?.selectedItem ?? null;
    if (cursor && levelOf(cursor) !== undefined) found.push({ item: cursor, where: 'cursor', slot: 'cursor' });
    const tools = found.length
        ? found.map((f) => `${itemName(f.item)} (level ${levelOf(f.item)}) ${f.where}`).join(', ')
        : 'none carried';
    const times = [`held ${ms(timeWith(held))}`, ...found.map((f) => `${itemName(f.item)} ${ms(timeWith(f.item))}`)];
    return `dig refused: ${block.name}:${block.metadata ?? 0} at ${p.x}, ${p.y}, ${p.z} (${rule}); held ${heldText}; `
        + `${cls} tools: ${tools}; rule: ${times.join(', ')}`;
}

/**
 * Wraps bot.dig: when it throws the rule's Infinity, logs digRefusedLine once per block (name and
 * meta) and position, then rethrows unchanged. Installed once mineflayer has added bot.dig.
 * @returns {{ lines: number }}
 */
export function attachDigRefusedLog(bot, sources, { log = (m) => console.log(`[forge-bridge] ${m}`), maxKeys = DIG_REFUSED.maxKeys } = {}) {
    if (bot[ATTACHED]) return bot[ATTACHED];
    const report = { lines: 0 };
    bot[ATTACHED] = report;
    const seen = new Set();
    const install = () => {
        const dig = bot.dig;
        if (typeof dig !== 'function' || dig[ATTACHED]) return;
        const wrapped = async function (block, ...rest) {
            try {
                return await dig.call(this, block, ...rest);
            } catch (err) {
                if (INFINITY_ERR.test(String(err?.message ?? ''))) {
                    try {
                        const p = block?.position;
                        const key = `${block?.name}:${block?.metadata}@${p?.x},${p?.y},${p?.z}`;
                        if (!seen.has(key) && seen.size < maxKeys) {
                            seen.add(key);
                            const line = digRefusedLine(bot, block, sources);
                            if (line) { report.lines++; log(line); }
                        }
                    } catch { /* the diagnostic never changes the dig's outcome */ }
                }
                throw err;
            }
        };
        wrapped[ATTACHED] = true;
        bot.dig = wrapped;
    };
    if (typeof bot.dig === 'function') install();
    // mineflayer adds bot.dig with its plugins on the first 'inject_allowed'; this listener runs after it.
    else bot.once?.('inject_allowed', install);
    return report;
}
