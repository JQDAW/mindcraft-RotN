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
import { combatOf, hitsToKill } from '../../../packages/rotn-data/index.js';
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

// ---------------------------------------------------------------------------------------------------------
// Probe BC (step 3 of the lead's Better Combat plan, 2026-11-21; net-forge #521 is the wrapper under test,
// rotn-data #518 the numbers). Does Better Combat's own attack packet (bot.attack with FORGE_BC_ATTACK=on)
// hit a zombie in full every time on the real RotN 3.3.4 server, where the vanilla use_entity attack
// (bot.attackVanilla) lands only once? Shared by test/scenarios/probe/probe-bc-attack.mjs, its driver
// (test/runner/drivers/bc-attack-driver.mjs, test/runner/drivers/bc-attack.mjs) and their unit tests.
// A probe, never a gate.

export const BC_NOT_GATE = 'probe BC measures Better Combat\'s attack packet against the vanilla attack; it is never a gate pass';

/**
 * The disposable test server's name, as deploy/test-server.sh makes it (mcr-test-YYYYMMDD-HHMMSS). The BC
 * console list admits summon and kill, so it refuses every command unless TEST_SERVER_NAME has this form:
 * the lead allowed them for the disposable CPX42 only.
 */
export const TEST_SERVER_NAME_RE = /^mcr-test-\d{8}-\d{6}$/;

const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (cmd) => new RegExp(`^${esc(cmd)}$`);
/**
 * The console commands probe BC may send, for this bot (#527 review: exactly the plan's commands). The lead
 * allowed `summon` and `kill` for this probe only, on the disposable CPX42: summon only the plan's three
 * zombies (A and B with exactly {NoAI:1}, the AI zombie bare) at their fixed cells; kill exactly
 * @e[type=zombie]. give, tp, clear, setblock and testforblock only for this bot, the BC items with the plan's
 * counts and the landing spot; fill only the lane's two fills (no setblock at all), testforblock only the
 * lane's cells; bc-hit only as the plan pairs path, zombie and item.
 * P1's list (P1_CONSOLE_ALLOW) is separate and gets none of this.
 */
export function bcConsoleAllow(bot, plan = BC_PLAN) {
    if (typeof bot !== 'string' || !new RegExp(`^${NAME}$`).test(bot)) throw new Error(`bad bot name '${bot}'`);
    const cell = (c) => c.join(' ');
    // One item per give (attempt 2, #540: 1.12 refuses a count above an item's stack size, 1 for a tool).
    const gives = [...new Set([...plan.weapons.filter((w) => w.give).map((w) => w.item), plan.ai.item])];
    const items = `(${plan.weapons.map((w) => esc(w.item)).join('|')})`;
    const T = '[0-9a-f]{6,32}';
    return [
        /^say scenario-[0-9a-z-]+-begin$/,                                     // the runner's begin marker
        /^seed$/,
        /^gamerule doDaylightCycle false$/,
        /^time set day$/,
        exact(`tp ${bot} ~ ~ ~`),
        exact(`tp ${bot} ${cell(plan.landing)}`),
        exact(`clear ${bot}`),
        ...gives.map((item) => exact(`give ${bot} ${item} 1 0`)),
        ...bcLaneFills(plan.lane).map(exact),
        ...bcLaneCells(plan.lane).map(([x, y, z, b]) => exact(`testforblock ${x} ${y} ${z} ${b}`)),
        exact(bcLaneClear(plan)),
        exact(`summon minecraft:zombie ${cell(plan.zombieA)} {NoAI:1}`),
        exact(`summon minecraft:zombie ${cell(plan.zombieB)} {NoAI:1}`),
        exact(`summon minecraft:zombie ${cell(plan.zombieAi)}`),
        /^kill @e\[type=zombie\]$/,
        new RegExp(`^tell ${esc(bot)} bc-hit ${T} vanilla ${esc(plan.zombieA.join(','))} ${items}$`),
        new RegExp(`^tell ${esc(bot)} bc-hit ${T} bc ${esc(plan.zombieB.join(','))} ${items}$`),
        new RegExp(`^tell ${esc(bot)} bc-hit ${T} bc ai ${esc(plan.ai.item)}$`),
    ];
}

/** The test server's console, limited to probe BC's commands, and only on a disposable test server. */
export function guardBcConsole(server, serverName, bot) {
    const g = guardConsole(server, bcConsoleAllow(bot));
    const named = typeof serverName === 'string' && TEST_SERVER_NAME_RE.test(serverName);
    return {
        ...g,
        console(cmd, waitS) {
            if (!named) throw new Error(`console command refused in probe BC: TEST_SERVER_NAME '${serverName ?? ''}' is not a disposable test server (mcr-test-YYYYMMDD-HHMMSS)`);
            return g.console(cmd, waitS);
        },
    };
}

/** The driver's switch for this probe: bc-attack-driver.mjs turns it into FORGE_BC_ATTACK=on for initBot. */
export const BC_DRIVER_ENV = Object.freeze({ ROTN_DRIVER_BC_ATTACK: 'on' });

/** One bc-hit command: PATH vanilla|bc, TARGET [x,y,z] (a NoAI zombie standing there) or 'ai', ITEM or 'hand'. */
export function bcHit(bot, t, path, target, item) {
    if (!['vanilla', 'bc'].includes(path)) throw new Error(`bad bc-hit path '${path}'`);
    const where = target === 'ai' ? 'ai' : pos(target);
    return `tell ${bot} bc-hit ${token(t)} ${path} ${where} ${item}`;
}

/** The driver's bc_hit reply for this token (the first one), or null. */
export function bcReply(output, t) {
    for (const l of output) {
        if (!l.startsWith('DRIVER ')) continue;
        let e;
        try {
            e = JSON.parse(l.slice(7));
        } catch {
            continue;
        }
        if (e?.type === 'bc_hit' && e.token === t) return e;
    }
    return null;
}

/**
 * Probe BC's plan (the lead's step 4). The bot stands in an enclosed stone lane in the air (attempt 1, #535: a
 * Dynamic Trees trunk stood in the ground lane, and setblock cannot replace a trunk shell; the lead approved
 * this lane): 1 wide, 2 high, along x at y 120, with a stone floor, a stone roof, stone walls on both sides and
 * at both ends. Nothing grows there, no zombie burns (the roof), the AI zombie cannot leave the lane or be
 * knocked off it, and no mob spawns within 24 blocks of the bot. For each weapon two NoAI zombies stand 2
 * blocks from the bot: A (west) is hit on the vanilla path at Better Combat's cooldown, B (east) on Better
 * Combat's path. Then one zombie with its AI, 3 blocks east, on Better Combat's path with a stone sword.
 * The expected hits to kill come from rotn-data's hitsToKill (#518, #528) at run time: bcExpected(item, {health}).
 * give: how many of the item the scenario gives, one `give <bot> ITEM 1 0` each (attempt 2, #540: a tool's
 * give count is at most 1). The crude axe's durability is 8 and it loses 2 a hit, so it breaks after 4
 * landed hits: 6 are given and the driver takes the next one when one breaks.
 * cooldownTicks: net-forge's plan (3): stone sword 13, stone axe 50, crude axe 22, hand 13.
 */
export const BC_PLAN = Object.freeze({
    landing: [-45, 120, -66],
    lane: { xFrom: -48, xTo: -41, y: 120, z: -66 },   // the air cells; y is the bot's feet
    zombieA: [-47, 120, -66],
    zombieB: [-43, 120, -66],
    zombieAi: [-42, 120, -66],
    laneClearRadius: 8,
    weapons: Object.freeze([
        { check: 'stone_sword', item: 'minecraft:stone_sword', give: 1, cooldownTicks: 13 },
        { check: 'stone_axe', item: 'minecraft:stone_axe', give: 1, cooldownTicks: 50 },
        { check: 'crude_axe', item: 'pyrotech:crude_axe', give: 6, cooldownTicks: 22 },
        { check: 'hand', item: 'hand', give: 0, cooldownTicks: 13 },
    ]),
    ai: { item: 'minecraft:stone_sword', cooldownTicks: 13 },
    maxHits: 40,
    maxMs: 60000,
});

/**
 * The lane clear before each step (rotn-data, after #540): kill @e[type=zombie] matches only minecraft:zombie,
 * so a Fish's Undead Rising parasite (spawned from a dying vanilla zombie; it attaches to and hits the player) or a
 * Special Mobs variant survives it and stays in the lane, the likely cause of attempt 2's stone-axe anomaly. This
 * kills every entity that is not a player within laneClearRadius of the lane's centre (the landing cell), fixed
 * numbers only. type=!player cannot match the bot or any other player. The radius covers every lane cell
 * (the farthest, an end wall's corner, is under 6 blocks away) and reaches only the air around the lane at y 120.
 */
export function bcLaneClear(plan = BC_PLAN) {
    const [x, y, z] = plan.landing;
    return `kill @e[type=!player,x=${x},y=${y},z=${z},r=${plan.laneClearRadius}]`;
}

/**
 * The lane's two fills, in order: the whole box around it stone (x from xFrom-1 to xTo+1, y from y-1 to y+2, z
 * from z-1 to z+1), then its two rows of air. Nothing else is ever placed.
 */
export function bcLaneFills(lane = BC_PLAN.lane) {
    return [
        `fill ${lane.xFrom - 1} ${lane.y - 1} ${lane.z - 1} ${lane.xTo + 1} ${lane.y + 2} ${lane.z + 1} minecraft:stone`,
        `fill ${lane.xFrom} ${lane.y} ${lane.z} ${lane.xTo} ${lane.y + 1} ${lane.z} minecraft:air`,
    ];
}

/**
 * Every cell that makes the lane, [x, y, z, block]: the air (2 rows), the floor and the roof under and over it,
 * the side walls (both rows, both sides) and the two end walls. The setup checks each with testforblock before
 * anything is summoned. 68 cells for an 8-long lane.
 */
export function bcLaneCells(lane = BC_PLAN.lane) {
    const out = [];
    const xs = [];
    for (let x = lane.xFrom; x <= lane.xTo; x++) xs.push(x);
    const { y, z } = lane;
    for (const x of xs) out.push([x, y, z, 'minecraft:air'], [x, y + 1, z, 'minecraft:air']);
    for (const x of xs) out.push([x, y - 1, z, 'minecraft:stone'], [x, y + 2, z, 'minecraft:stone']);
    for (const x of xs) for (const dz of [-1, 1]) out.push([x, y, z + dz, 'minecraft:stone'], [x, y + 1, z + dz, 'minecraft:stone']);
    for (const x of [lane.xFrom - 1, lane.xTo + 1]) out.push([x, y, z, 'minecraft:stone'], [x, y + 1, z, 'minecraft:stone']);
    return out;
}

/**
 * The hits to kill a plain zombie (20 health, 2 armour) on Better Combat's packet, from rotn-data's hitsToKill
 * (#518, #528), as a range: min every hit a crit (x1.5), max no crit at all. Better Combat crits a sneak attack
 * (an IMob whose attack and revenge targets are both not the player: a NoAI zombie's first hit) and at random
 * (5% base, +0.1 sword, +0.25 axe), so any count in the range is possible. With an empty hand it takes 0.5 off
 * (#528): 36 to 54. perHit and critHit are one hit's health drop without and with a crit. health: the zombie's
 * start health as measured (#533 review: entity_metadata at the series' start); without it, the catalogue's 20.
 * @returns {{min: number, max: number, perHit: number, critHit: number, health: number, healthFrom: 'measured'|'catalogue'}}
 */
export function bcExpected(item, { mob = 'minecraft:zombie', health } = {}) {
    const h = typeof health === 'number' && health > 0 ? health : undefined;
    const k = hitsToKill({ mob, weapon: item === 'hand' ? 'hand' : item, path: 'bettercombat', ...(h === undefined ? {} : { health: h }) });
    if (!k) throw new Error(`rotn-data has no hitsToKill for ${item} against ${mob}`);
    return { min: k.minHits, max: k.hits, perHit: k.perHit, critHit: k.critHit, health: k.health, healthFrom: h === undefined ? 'catalogue' : 'measured' };
}

/**
 * Which Better Combat hits were crits, as far as the health drop shows: a drop at least halfway from perHit to
 * critHit is a crit, a smaller one is not; the killing hit, cut short by the health left, says nothing unless
 * its drop is a crit's. Returns {crits: [hit numbers], plain: [...], unknown: [...]}.
 */
export function markCrits(hits, { perHit, critHit }) {
    const mid = (perHit + critHit) / 2;
    const out = { crits: [], plain: [], unknown: [] };
    for (const h of hits) {
        if (!(h.drop > 0)) continue;
        if (h.drop >= mid) out.crits.push(h.i);
        else if (h.died || h.healthAfter === 0) out.unknown.push(h.i);
        else out.plain.push(h.i);
    }
    return out;
}

/** The catalogue's zombie health (rotn-data combat.json maxHealth, 20): a target that starts otherwise is not a fresh zombie. */
export const zombieCatalogueHealth = () => combatOf('minecraft:zombie')?.maxHealth ?? 20;

/**
 * A series whose zombie was not a fresh one cannot be judged (attempt 2, #540: zombie A started at 8 health and
 * was hurt before the bot's first hit): its measured start health differs from the catalogue's. Returns the
 * reason, or null. A start health that was not read is not flagged (the range then uses the catalogue's).
 */
export function notMeasured(r, catalogue = zombieCatalogueHealth()) {
    const h = r?.target?.startHealth;
    if (typeof h !== 'number') return null;
    return Math.abs(h - catalogue) > 1e-3 ? `not measured: the zombie started at ${h} health, not the catalogue's ${catalogue}` : null;
}

/**
 * A NoAI series is clean only if nothing else was there (the lead, after #543): returns why it is not, or null.
 * - the census saw a living entity that is not a player (health above 0) inside the lane's box (bcLaneFills' first
 *   fill: x xFrom-1..xTo+1, y y-1..y+2, z z-1..z+1, block coordinates) other than the zombies standing in the
 *   step's own cells (cells: the target's and its partner's, within 0.75 of either cell's centre: a NoAI zombie
 *   does not move);
 * - or the bot was hurt during the series (botHurts).
 */
export function noAiIntrusion(r, { cells, lane = BC_PLAN.lane } = {}) {
    const inBox = ([x, y, z]) => x >= lane.xFrom - 1 && x < lane.xTo + 2 && y >= lane.y - 1 && y < lane.y + 3 && z >= lane.z - 1 && z < lane.z + 2;
    const atCell = ([x, y, z]) => (cells ?? []).some(([cx, cy, cz]) => Math.hypot(x - (cx + 0.5), y - cy, z - (cz + 0.5)) <= 0.75);
    const seen = new Map();
    for (const c of r?.census ?? []) {
        for (const e of c.entities ?? []) {
            if (!(typeof e.health === 'number' && e.health > 0) || !Array.isArray(e.pos) || !inBox(e.pos)) continue;
            if (atCell(e.pos) && /zombie/i.test(String(e.name ?? ''))) continue;
            if (!seen.has(e.id)) seen.set(e.id, `${e.name ?? '?'} #${e.id} at ${e.pos.join(' ')} (t ${c.t} ms)`);
        }
    }
    const why = [];
    if (seen.size) why.push(`the census saw ${[...seen.values()].join(', ')} in the lane`);
    const hurts = r?.botHurts ?? [];
    if (hurts.length) why.push(`the bot was hurt ${hurts.length}x (${hurts.map((h) => `${h.amount} at t ${h.t} ms, ${h.cause}`).join('; ')})`);
    return why.length ? `not clean: ${why.join('; ')}` : null;
}

/** A timer may fire up to 1 ms early against Date.now: a gap this much under the cooldown still counts as on time. */
export const GAP_SLACK_MS = 2;

/**
 * The hits needed to kill: the hits sent if the zombie died, else the start health over the mean drop of
 * the hits so far, rounded up (a series cut at 40 hits or 60 s), or null with no drop at all.
 */
export function projectedHits(r) {
    const hits = (r?.hits ?? []).filter((h) => !h.afterDeath);
    if (r?.end === 'dead') return hits.length;
    const drops = hits.map((h) => h.drop).filter((d) => typeof d === 'number' && d > 0);
    if (!drops.length || !(r?.target?.startHealth > 0)) return null;
    const mean = drops.reduce((a, b) => a + b, 0) / hits.length;
    return Math.ceil(r.target.startHealth / mean);
}

/**
 * The verdict on one series (the plan's pass rules). vanilla: at least 2 hits sent, all on the vanilla path;
 * the first lowers the zombie's health and no later one does. bc: every hit on Better Combat's path and
 * each lowers the health; the zombie dies, or (only when the range's max is above maxHits) the projection
 * from the drops stands for the count; the count is in rotn-data's range (bcExpected: all crits to no crit);
 * no gap between Better Combat packets is under the cooldown; the self-check did not trip. Both: the reply
 * is ok, the zombie was found and did not burn. With expected's perHit and critHit, the crits are marked
 * (markCrits), and whether the first hit was one (firstHitCrit: true, false or null for unknown; a NoAI zombie's
 * first Better Combat hit is a sneak attack, #528). A zombie that did not start at the catalogue's health
 * (notMeasured) makes the series inconclusive: not ok, but inconclusive: true and no pass rule applied (the
 * lead, after #540). So does, for a NoAI series (noAiCells: the step's two zombie cells), anything else alive in
 * the lane or a hurt to the bot (noAiIntrusion, after #543). Returns {ok, inconclusive, why, projected, inRange, crits, firstHitCrit}.
 */
export function judgeSeries(r, { path, expected = null, cooldownTicks = null, maxHits = BC_PLAN.maxHits, ai = false, catalogueHealth = zombieCatalogueHealth(), noAiCells = null } = {}) {
    const bad = [];
    if (!r) return { ok: false, inconclusive: false, why: 'no reply', projected: null, inRange: null, crits: null, firstHitCrit: null };
    const nm = notMeasured(r, catalogueHealth) ?? (noAiCells ? noAiIntrusion(r, { cells: noAiCells }) : null);
    if (nm) return { ok: false, inconclusive: true, why: nm, projected: null, inRange: null, crits: null, firstHitCrit: null };
    if (!r.ok) bad.push(`driver: ${r.error ?? 'not ok'}`);
    if (!r.target) bad.push('no zombie found');
    if (r.burned) bad.push('the zombie burned (fire damage mixes with the hits)');
    if (r.tripped) bad.push('the self-check tripped (back to vanilla)');
    const hits = (r.hits ?? []).filter((h) => !h.afterDeath);   // a swing at a zombie already dead cannot land
    const sent = hits.filter((h) => h.sent);
    const want = path === 'vanilla' ? 'vanilla' : 'bettercombat';
    const off = sent.filter((h) => h.path !== want);
    if (off.length) bad.push(`${off.length} hit(s) not on the ${want} path (#${off.map((h) => h.i).join(', #')})`);
    // #541: the wrapper refuses a target out of reach or sight ({sent: false, reason: 'reach'|'sight'}): the wrapper
    // refusing, not Better Combat failing; the reasons are named.
    const unsentReasons = [...new Set(hits.filter((h) => !h.sent).map((h) => h.reason ?? 'no reason'))];
    if (sent.length !== hits.length) bad.push(`${hits.length - sent.length} call(s) sent nothing (${unsentReasons.join(', ')})`);
    let projected = null;
    let inRange = null;
    let crits = null;
    let firstHitCrit = null;
    if (path === 'vanilla') {
        if (sent.length < 2) bad.push(`only ${sent.length} hit(s)`);
        else {
            if (!(sent[0].drop > 0)) bad.push('the first hit did not lower the health');
            const later = sent.slice(1).filter((h) => h.drop !== 0);
            if (later.length) bad.push(`${later.length} later hit(s) changed the health (#${later.map((h) => h.i).join(', #')})`);
        }
    } else {
        const none = sent.filter((h) => !(h.drop > 0));
        if (none.length) bad.push(`${none.length} hit(s) did not lower the health (#${none.map((h) => h.i).join(', #')})`);
        projected = projectedHits(r);
        if (expected?.perHit > 0 && expected?.critHit > 0) crits = markCrits(sent, expected);
        if (crits && sent.length) firstHitCrit = crits.crits.includes(sent[0].i) ? true : crits.plain.includes(sent[0].i) ? false : null;
        if (!ai) {
            const canProject = !!expected && expected.max > maxHits && r.end !== 'dead';
            if (r.end !== 'dead' && !canProject) bad.push(`the zombie did not die (${r.end ?? 'no end'})`);
            inRange = !!expected && Number.isFinite(projected) && projected >= expected.min && projected <= expected.max;
            if (!inRange) bad.push(`${projected ?? '?'} hits to kill${r.end === 'dead' ? '' : ' (projected)'}, not in rotn-data's ${expected ? `${expected.min}-${expected.max}` : '(no range)'}`);
        } else if (r.end !== 'dead') bad.push(`the zombie did not die (${r.end ?? 'no end'})`);
        const minGap = cooldownTicks === null ? null : cooldownTicks * 50 - GAP_SLACK_MS;
        const gaps = r.gaps?.bettercombat ?? [];
        const short = minGap === null ? [] : gaps.filter((g) => g < minGap);
        if (short.length) bad.push(`${short.length} gap(s) between Better Combat packets under ${cooldownTicks} ticks (${short.join(', ')} ms)`);
    }
    return { ok: bad.length === 0, inconclusive: false, why: bad.join('; ') || 'as planned', projected, inRange, crits, firstHitCrit };
}

/**
 * Server log lines that fail probe BC: a Forge codec exception (FMLIndexedMessageCodec, how a bad
 * bettercombat payload shows), any WARN/ERROR line or exception naming bettercombat.
 */
export function bcLogProblems(lines) {
    return lines.filter((l) => /FMLIndexedMessageCodec/.test(l)
        || (/bettercombat/i.test(l) && (/\/(WARN|ERROR|FATAL)\]/.test(l) || /Exception|Error:/.test(l))));
}

/** The wrapper's self-check line (net-forge #521), in the driver's output. */
export const BC_TRIP_RE = /bettercombat attack: \d+ hits without a hurt, back to vanilla/;
