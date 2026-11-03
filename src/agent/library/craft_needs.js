// What the bot still needs to craft an item by RotN's recipes (skills-rotn C1,
// the part that needs no slot clicks).
//
// The recipes are rotn-data's (howToGet "craft" ways from the server dump),
// matched by output and ingredients, never by a CraftTweaker recipe id. Whether
// the inventory can fill a way is rotn-data's canFill (#152): every slot accepts
// any stack its ingredient lists, slots are independent (1 igneous + 2
// metamorphic rocks make a stone pickaxe), and one item is never counted for two
// slots. The mixed-rock rule lives there only; this module words the result.
// Cobblestone still needs 4 rocks of one type because rotn-data has one recipe
// per rock type.
import { howToGet, canFill, loadRotnData, PACK_VERSION, registryName, botName, WILDCARD_META } from '../../../packages/rotn-data/index.js';
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

// The inventory as canFill wants it.
const stacksOf = (bot) => bot.inventory.items().map(i => ({ name: i.name, meta: i.metadata ?? 0, count: i.count }));

/**
 * How close the bot is to crafting the item once: the RotN craft way canFill finds the
 * fewest missing items for, and per input what the bot holds and what to get.
 * @returns {{requiresTable: boolean, gives: object, recipeId: string|null, inputs: Array<{ore: string|null,
 *           count: number, label: string, kinds: Array<{name: string, have: number}>, short: number,
 *           more: string|null}>, short: number, ready: boolean}|null} null when the item has no RotN craft way
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
    const stacks = stacksOf(bot);
    const evaluated = ways.map(way => {
        const fill = canFill(way, stacks); // the whole recipe: the verdict
        const inputs = way.inputs.map(input => {
            const members = inputMembers(input);
            // This input alone, for the message: how many of its slots the inventory can fill.
            const part = canFill({ ingredients: Array(input.count).fill({ stacks: members }) }, stacks);
            const kinds = members.map(m => ({ name: memberName(m), have: countItem(bot, memberName(m)) }))
                .filter(k => k.have > 0)
                .sort((a, b) => b.have - a.have);
            const short = part ? part.missing : input.count;
            const label = input.ore ?? (members[0] ? memberName(members[0]) : '?');
            // What to get: any member of an ore ("pyrotech:rock (any rock)", what collecting a bare
            // pyrotech:rock gathers, #151 review), else the input's own item.
            const more = short > 0 && members[0]
                ? (input.ore ? `${botName(members[0].name)} (any ${input.ore})` : (kinds[0]?.name ?? memberName(members[0])))
                : null;
            return { ore: input.ore ?? null, count: input.count, label, kinds, short, more };
        });
        const short = fill ? fill.missing : inputs.reduce((n, i) => n + i.short, 0);
        return { requiresTable: !!way.requiresTable, gives: way.gives, recipeId: way.recipeId ?? null, inputs, short, ready: !!fill?.ok };
    });
    evaluated.sort((a, b) => a.short - b.short || Number(a.requiresTable) - Number(b.requiresTable));
    return evaluated[0];
}

/**
 * The bot's log line, for example: "To craft stone_pickaxe (at a crafting table): 3 rock: you have
 * 2 pyrotech_compat:rock_metamorphic, so get 1 more pyrotech:rock (any rock); 2 ladderMat: you have
 * 4 stick (enough)."
 */
export function describeNeeds(name, needs) {
    const parts = needs.inputs.map(i => {
        const held = i.kinds.length ? `you have ${i.kinds.map(k => `${k.have} ${k.name}`).join(', ')}` : 'you have none';
        const verdict = i.short > 0 ? `, so get ${i.short}${i.kinds.length ? ' more' : ''} ${i.more}` : ' (enough)';
        return `${i.count} ${i.label}: ${held}${verdict}`;
    });
    const where = needs.requiresTable ? ' (at a crafting table)' : '';
    return `To craft ${name}${where}: ${parts.join('; ')}.`;
}
