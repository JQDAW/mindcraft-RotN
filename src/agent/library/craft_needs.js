// What the bot still needs to craft an item by RotN's recipes (skills-rotn C1,
// the part that needs no slot clicks; #145 review nit 1).
//
// The recipes are rotn-data's (howToGet "craft" ways from the server dump),
// matched by output and ingredients, never by a CraftTweaker recipe id. An
// input may be an ore dictionary ("rock", "ladderMat"); rotn-data's
// installRecipes gives equal ingredients the same stack, so bot.recipesFor and
// bot.craft only accept an input of 3 rocks when 3 are of ONE kind. A mixed haul
// (2 metamorphic and 1 igneous rock) is refused, and the bot must say which kind
// to get more of.
import { howToGet, loadRotnData, PACK_VERSION, registryName, botName, WILDCARD_META } from '../../../packages/rotn-data/index.js';
import { countItem, formatName, parseName } from './rotn_names.js';

const memberName = (m) => (m.meta == null ? botName(m.name) : formatName(botName(m.name), m.meta));

// Every stack that fits an input: the full ore dictionary (a way lists at most 6 choices), else its choices.
function inputMembers(input) {
    if (input.ore) {
        const members = loadRotnData(PACK_VERSION).oreDict(input.ore);
        if (Array.isArray(members) && members.length > 0)
            return members.map(s => ({ name: s.name, meta: s.meta === WILDCARD_META ? null : s.meta }));
    }
    return Array.isArray(input.choices) ? input.choices : [];
}

/**
 * How close the bot is to crafting the item once: the RotN craft way with the
 * fewest missing items, and per input the kinds the bot holds (most first).
 * @returns {{requiresTable: boolean, gives: object, inputs: Array<{ore: string|null, count: number,
 *           label: string, kinds: Array<{name: string, have: number}>, short: number, more: string|null}>,
 *           short: number, ready: boolean}|null} null when the item has no RotN craft way
 */
export function craftNeeds(bot, name) {
    const p = parseName(name);
    if (!p) return null;
    let result = null;
    try {
        result = howToGet(registryName(p.name), p.meta == null ? {} : { meta: p.meta });
    } catch {
        return null;
    }
    const ways = (result?.ways ?? []).filter(w => w.kind === 'craft' && Array.isArray(w.inputs));
    if (ways.length === 0) return null;
    const evaluated = ways.map(way => {
        const inputs = way.inputs.map(input => {
            const members = inputMembers(input);
            const kinds = members.map(m => ({ name: memberName(m), have: countItem(bot, memberName(m)) }))
                .filter(k => k.have > 0)
                .sort((a, b) => b.have - a.have);
            const best = kinds[0] ?? null;
            const short = Math.max(0, input.count - (best?.have ?? 0));
            const label = input.ore ?? (members[0] ? memberName(members[0]) : '?');
            // The kind to get more of: the one the bot holds most of, else the likeliest choice.
            const more = short > 0 ? (best?.name ?? (members[0] ? memberName(members[0]) : null)) : null;
            return { ore: input.ore ?? null, count: input.count, label, kinds, short, more };
        });
        const short = inputs.reduce((n, i) => n + i.short, 0);
        return { requiresTable: !!way.requiresTable, gives: way.gives, inputs, short, ready: short === 0 };
    });
    evaluated.sort((a, b) => a.short - b.short || Number(a.requiresTable) - Number(b.requiresTable));
    return evaluated[0];
}

/**
 * The bot's log line, for example: "To craft stone_pickaxe (at a crafting table): 3 rock of one
 * kind: you have 2 pyrotech_compat:rock_metamorphic, 1 pyrotech_compat:rock_igneous, so get 1 more
 * pyrotech_compat:rock_metamorphic; 2 ladderMat of one kind: you have 4 stick (enough)."
 */
export function describeNeeds(name, needs) {
    const parts = needs.inputs.map(i => {
        const kind = i.ore ? `${i.count} ${i.label} of one kind` : `${i.count} ${i.label}`;
        const held = i.kinds.length ? `you have ${i.kinds.map(k => `${k.have} ${k.name}`).join(', ')}` : 'you have none';
        const verdict = i.short > 0 ? `, so get ${i.short} more ${i.more}` : ' (enough)';
        return `${kind}: ${held}${verdict}`;
    });
    const where = needs.requiresTable ? ' (at a crafting table)' : '';
    return `To craft ${name}${where}: ${parts.join('; ')}.`;
}
