// Probe P1 (net-forge's "Probe plan P1", coord/STATUS-net-forge.md; lead: accepted in principle): does
// crafting (REID item ids, FastWorkbench), placing and eating work against the real RotN 3.3.4 server?
// A probe, never a gate. Shared by test/scenarios/probe/probe-craft-place.mjs and its unit tests.
//
// THE DRIVER PROTOCOL: net-forge's, in packages/forge-bridge/tools/probe-commands.mjs (#162), used here as
// it is. The driver answers only with ROTN_DRIVER_PROBE=1, which the scenario sets when it starts the bot.
//   The scenario sends each command as a console `tell <bot> ...`, so it reaches mineflayer's 'whisper'
//   event from "Server" (S1-A evidence); the driver accepts only that sender, and the whole whisper text
//   must be the command. TOKEN: 6-32 hex characters, each runs once. Positions are "x,y,z".
//     probe-craft TOKEN RECIPE_ID [x,y,z]      one craft with rotn-data's dump recipe RECIPE_ID (e.g.
//                                               crafttweaker:pyro_crude_axe); with x,y,z, at that table
//     probe-place TOKEN ITEM x,y,z FACE        place ITEM against the block x,y,z on FACE
//     probe-eat   TOKEN ITEM                   eat one ITEM (bot.consume); auto-eat is off during the probe
//   Each command gets exactly one line on stdout within the driver's 60 s limit (then ok:false, timedOut):
//     DRIVER {"type":"probe","token":TOKEN,"cmd":"craft"|"place"|"eat","ok":bool, ...}
//     craft: recipe, table, variant, variants, result, resultMeta, before, after (the result item held),
//            ms, tableBlock; ok means after > before
//     place: before, after (block names at the target), expected, otherUpdates, totalMs, updateMs (to the
//            server's block update for the placed block), timeoutMs; ok means the block changed to the item
//     eat:   foodBefore, foodAfter, countBefore, countAfter, ms; ok means food up and one item fewer
//     on failure: error (and timedOut for the time limit)
//   plus one chat line, which the scenario does not need.
//   The driver reports neither window-click transactions nor the FastWorkbench window per command; those
//   come from the capture (ROTN_DRIVER_CAPTURE=1) in the evidence step, as net-forge's plan says.
import { guardConsole } from './g3.mjs';

export const P1_NOT_GATE = 'P1 is a probe of crafting, placing and eating, never a gate pass';
export const PROBE_TOKEN = /^[0-9a-f]{6,32}$/;
export const FACES = ['up', 'down', 'north', 'south', 'east', 'west'];

const NAME = '[A-Za-z0-9_]{3,16}';
const N = '-?\\d+';
const ITEM = '[a-z0-9_]+:[a-z0-9_]+';
/**
 * The console commands P1 may send (lead: give, effect, setblock, testforblock and clear are allowed for
 * P1 only, on the disposable test server). Anchored; anything else is refused before it is sent.
 */
export const P1_CONSOLE_ALLOW = [
    /^say scenario-[0-9a-z-]+-begin$/,                                     // the runner's begin marker
    /^seed$/,
    /^gamerule doDaylightCycle false$/,
    /^time set day$/,
    new RegExp(`^tp ${NAME} ~ ~ ~$`),
    new RegExp(`^tp ${NAME} ${N} ${N} ${N}$`),
    new RegExp(`^clear ${NAME}$`),                                         // the empty start and the end
    new RegExp(`^clear ${NAME} ${ITEM} ${N} 0$`),                          // count only
    new RegExp(`^give ${NAME} ${ITEM} \\d{1,2} \\d{1,2}$`),
    new RegExp(`^effect ${NAME} minecraft:hunger \\d{1,3} \\d{1,3}$`),
    new RegExp(`^setblock ${N} ${N} ${N} minecraft:(crafting_table|air|stone)$`),
    new RegExp(`^testforblock ${N} ${N} ${N} ${ITEM}( \\d{1,2})?$`),
    new RegExp(`^tell ${NAME} probe-(craft|place|eat) [0-9a-f]{6,32}( \\S+){1,3}$`),     // the driver anchors and checks each form
];

/** The test server's console, limited to P1's commands. */
export const guardP1Console = (server) => guardConsole(server, P1_CONSOLE_ALLOW);

const pos = (p) => p.join(',');
const token = (t) => {
    if (!PROBE_TOKEN.test(t)) throw new Error(`bad probe token '${t}'`);
    return t;
};
export const probeCraft = (bot, t, recipeId, table = null) => `tell ${bot} probe-craft ${token(t)} ${recipeId}${table ? ` ${pos(table)}` : ''}`;
export function probePlace(bot, t, item, ref, face) {
    if (!FACES.includes(face)) throw new Error(`bad face '${face}'`);
    return `tell ${bot} probe-place ${token(t)} ${item} ${pos(ref)} ${face}`;
}
export const probeEat = (bot, t, item) => `tell ${bot} probe-eat ${token(t)} ${item}`;

/** The driver's reply for this command and token in its output (the first one), or null. */
export function probeReply(output, cmd, t) {
    for (const l of output) {
        if (!l.startsWith('DRIVER ')) continue;
        let e;
        try {
            e = JSON.parse(l.slice(7));
        } catch {
            continue;
        }
        if (e?.type === 'probe' && e.cmd === cmd && e.token === t) return e;
    }
    return null;
}

/**
 * P1's steps as data (net-forge's plan): what is given, the four crafts with the server's counts after
 * each, where the table and the five placements go, and what is eaten.
 */
export const P1_PLAN = Object.freeze({
    landing: [-45, 66, -66],                                              // G2 batch 8's landing spot
    gives: [
        ['pyrotech:rock', 8, 0],
        ['minecraft:stick', 6, 0],
        ['minecraft:planks', 1, 0],
        ['minecraft:bread', 2, 0],
        ['minecraft:cobblestone', 8, 0],
    ],
    hunger: [10, 10],                                                     // seconds, amplifier: food under 20 for the eat step
    table: [-43, 66, -66],
    // recipeId: rotn-data's dump recipe (net-forge's #162 e2e test); item: the result the server counts.
    crafts: [
        { check: 'crude_axe', recipeId: 'crafttweaker:pyro_crude_axe', item: 'pyrotech:crude_axe', grid: '2x2', counts: { 'pyrotech:crude_axe': 1, 'pyrotech:rock': 7 } },
        { check: 'crafting_tools', recipeId: 'crafttweaker:crafting_tools', item: 'contenttweaker:crafting_tools', grid: '2x2', counts: { 'contenttweaker:crafting_tools': 1, 'pyrotech:crude_axe': 0 } },
        { check: 'crafting_table', recipeId: 'crafttweaker:crafting_table', item: 'minecraft:crafting_table', grid: '2x2', counts: { 'minecraft:crafting_table': 1, 'minecraft:planks': 0 } },
        { check: 'stone_pickaxe', recipeId: 'crafttweaker:stone_pickaxe', item: 'minecraft:stone_pickaxe', grid: '3x3', atTable: true, counts: { 'minecraft:stone_pickaxe': 1, 'pyrotech:rock': 3 } },
    ],
    // Five cobblestones on the floor, 2 blocks from the bot, away from the table (east of the bot). Each
    // target cell is set to air and the floor under it to stone first, so the result depends on the
    // client, not on the terrain.
    place: { item: 'minecraft:cobblestone', face: 'up', targets: [[-47, 66, -66], [-45, 66, -68], [-45, 66, -64], [-47, 66, -68], [-47, 66, -64]] },
    eat: { item: 'minecraft:bread', before: 2, after: 1 },
});

/** The driver's opt-in (#162): it answers probe commands only with this in its environment. */
export const PROBE_DRIVER_ENV = Object.freeze({ ROTN_DRIVER_PROBE: '1' });

/** The floor block under a target cell (the block placed against). */
export const below = ([x, y, z]) => [x, y - 1, z];
