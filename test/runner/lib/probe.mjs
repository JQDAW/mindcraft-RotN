// Probe P1 (net-forge's "Probe plan P1", coord/STATUS-net-forge.md; lead: accepted in principle): does
// crafting (REID item ids, FastWorkbench), placing and eating work against the real RotN 3.3.4 server?
// A probe, never a gate. Shared by test/scenarios/probe/probe-craft-place.mjs and its unit tests.
//
// THE DRIVER PROTOCOL: net-forge's reply contract v1 (#162, #167), in
// packages/forge-bridge/tools/probe-commands.mjs and packages/forge-bridge/README.md ("Probe P1: commands
// and reply contract (v1)"), used here as it is. The scenario checks EVERY reply with net-forge's
// checkProbeReply; a reply that breaks the contract fails its step. The driver answers only with
// ROTN_DRIVER_PROBE=1, which the scenario sets when it starts the bot.
//   The scenario sends each command as a console `tell <bot> ...`. 1.12 sends that to the bot as the raw
//   chat component {translate: "commands.message.display.incoming", with: ["Server", message]}, and the
//   driver reads exactly that component (mineflayer's 'message' event), NOT mineflayer's 'whisper' text
//   pattern, which an op's `/say Server whispers to you: ...` would also match (#162 re-review nit 1). It
//   accepts only the sender "Server", and the whole message must be the command. TOKEN: 6-32 hex
//   characters, each runs once. Positions are "x,y,z".
//     probe-craft TOKEN RECIPE_ID [x,y,z]      one craft with rotn-data's dump recipe RECIPE_ID (e.g.
//                                               crafttweaker:pyro_crude_axe); with x,y,z, at that table
//     probe-place TOKEN ITEM x,y,z FACE        place ITEM against the block x,y,z on FACE
//     probe-eat   TOKEN ITEM                   eat one ITEM (bot.consume); auto-eat is off during the probe
//   Each command gets exactly one line on stdout within the driver's 60 s limit (then ok:false, timedOut):
//     DRIVER {"type":"probe","v":1,"token":TOKEN,"cmd":"craft"|"place"|"eat","ok":bool, ...}
//     craft: recipe, table, variant, variants, result, resultMeta, before, after (the result item held),
//            ms, tableBlock; ok means after > before
//     place: item, ref, face, target, before, after (block names at the target), expected, otherUpdates,
//            totalMs, updateMs (to the server's block update for the placed block), timeoutMs; ok means
//            the block changed to the item
//     eat:   item, foodBefore, foodAfter, countBefore, countAfter, ms; ok means food up and one item fewer
//     on failure: error (and timedOut, limitMs for the time limit)
//   Every item and block name is a full registry name ("minecraft:crafting_table"). Plus one chat line,
//   which the scenario does not need.
//   The driver reports neither window-click transactions nor the FastWorkbench window per command; those
//   come from the capture (ROTN_DRIVER_CAPTURE=1) in the evidence step, as net-forge's plan says.
import { guardConsole } from './g3.mjs';
import { playerScores } from './s1.mjs';

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
    // The server's own food level before and after the eat step (the 1.12 `food` criterion; only P1's
    // objective). The lead approved these three scoreboard commands for P1 (#165 review).
    /^scoreboard objectives add p1food food$/,
    /^scoreboard objectives remove p1food$/,
    new RegExp(`^scoreboard players list ${NAME}$`),
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
    // Hunger for the eat step: `effect <bot> minecraft:hunger SECONDS AMPLIFIER`. RotN 3.3.4 runs Hunger
    // Overhaul and AppleCore: 0.01 exhaustion a tick on top of the effect's 0.005 * (amplifier + 1), and a
    // step costs 4 / 0.85 exhaustion, not 4. net-forge's model of it is simulateHunger
    // (packages/forge-bridge/test/fake-containers.js, #177): 22 s at amplifier 19 is 10 steps, 5 of them
    // taken by a fresh player's saturation, so food 20 -> 15. P1 attempt 2 (2026-11-03) measured exactly 15.
    // The old 10 s at amplifier 10 (2 steps) left food at 20.
    hunger: [22, 19],
    foodObjective: 'p1food',
    table: [-43, 66, -66],
    // recipeId: rotn-data's dump recipe (net-forge's #162 e2e test); item: the result the server counts.
    crafts: [
        { check: 'crude_axe', recipeId: 'crafttweaker:pyro_crude_axe', item: 'pyrotech:crude_axe', grid: '2x2', counts: { 'pyrotech:crude_axe': 1, 'pyrotech:rock': 7 } },
        { check: 'crafting_tools', recipeId: 'crafttweaker:crafting_tools', item: 'contenttweaker:crafting_tools', grid: '2x2', counts: { 'contenttweaker:crafting_tools': 1, 'pyrotech:crude_axe': 0 } },
        { check: 'crafting_table', recipeId: 'crafttweaker:crafting_table', item: 'minecraft:crafting_table', grid: '2x2', counts: { 'minecraft:crafting_table': 1, 'minecraft:planks': 0 } },
        { check: 'stone_pickaxe', recipeId: 'crafttweaker:stone_pickaxe', item: 'minecraft:stone_pickaxe', grid: '3x3', atTable: true, counts: { 'minecraft:stone_pickaxe': 1, 'pyrotech:rock': 3 } },
    ],
    // Five cobblestones on the floor, 2 blocks from the bot: west, north, south and the two western corners,
    // away from the table, which stands 2 blocks EAST of the bot (x -43 against the bot's -45). Each
    // target cell is set to air and the floor under it to stone first, so the result depends on the
    // client, not on the terrain.
    place: { item: 'minecraft:cobblestone', face: 'up', targets: [[-47, 66, -66], [-45, 66, -68], [-45, 66, -64], [-47, 66, -68], [-47, 66, -64]] },
    eat: { item: 'minecraft:bread', before: 2, after: 1 },
});

/** The driver's opt-in (#162): it answers probe commands only with this in its environment. */
export const PROBE_DRIVER_ENV = Object.freeze({ ROTN_DRIVER_PROBE: '1' });

/** The bot's food score from `scoreboard players list <bot>`: a number, or null when it has none yet. */
export function foodScore(lines, bot, objective = P1_PLAN.foodObjective) {
    const scores = playerScores(lines, bot);
    return scores && Number.isInteger(scores[objective]) ? scores[objective] : null;
}

/** The floor block under a target cell (the block placed against). */
export const below = ([x, y, z]) => [x, y - 1, z];
