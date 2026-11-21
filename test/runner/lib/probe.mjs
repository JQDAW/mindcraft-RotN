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

const ZOMBIE_AT = `${N} ${N} ${N}`;
/**
 * The console commands probe BC may send. The lead allowed `summon` and `kill` for this probe only, on the
 * disposable CPX42: summon exactly a plain minecraft:zombie at whole-block coordinates, with no NBT or with
 * exactly {NoAI:1}; kill exactly @e[type=zombie]. P1's list (P1_CONSOLE_ALLOW) does not get them.
 */
export const BC_CONSOLE_ALLOW = [
    /^say scenario-[0-9a-z-]+-begin$/,                                     // the runner's begin marker
    /^seed$/,
    /^gamerule doDaylightCycle false$/,
    /^time set day$/,
    new RegExp(`^tp ${NAME} ~ ~ ~$`),
    new RegExp(`^tp ${NAME} ${N} ${N} ${N}$`),
    new RegExp(`^clear ${NAME}$`),
    new RegExp(`^give ${NAME} ${ITEM} \\d{1,2} \\d{1,2}$`),
    new RegExp(`^setblock ${N} ${N} ${N} minecraft:(air|stone)$`),
    new RegExp(`^testforblock ${N} ${N} ${N} minecraft:(air|stone)$`),
    new RegExp(`^summon minecraft:zombie ${ZOMBIE_AT}( \\{NoAI:1\\})?$`),
    /^kill @e\[type=zombie\]$/,
    new RegExp(`^tell ${NAME} bc-hit [0-9a-f]{6,32} (vanilla|bc) (${N},${N},${N}|ai) (${ITEM}|hand)$`),
];

/** The test server's console, limited to probe BC's commands, and only on a disposable test server. */
export function guardBcConsole(server, serverName) {
    const g = guardConsole(server, BC_CONSOLE_ALLOW);
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
 * Probe BC's plan (the lead's step 4). The bot stands at `bot` on a stone floor in a roofed 1-wide lane along
 * x (floor y-1, air at y and y+1, a stone roof at y+2, so no zombie burns in daylight). For each weapon two
 * NoAI zombies stand 2 blocks from it: A (west) is hit on the vanilla path at Better Combat's cooldown,
 * B (east) on Better Combat's path. Then one zombie with its AI, 3 blocks east, on Better Combat's path
 * with a stone sword.
 *
 * hits: rotn-data #518's hitsToKill on Better Combat's packet against an unarmoured zombie (2 armour):
 * stone sword 8, stone axe 9, bare hand 27 (about 54 if Better Combat's "Unarmed & Non-Weapon Damage
 * Reduction" 0.5 applies on the server; the plan's note for rotn-data). #518 has no crude-axe row: it has
 * the stone axe's damage (3, Material Changer), so 9. Its durability is 8 and it loses 2 a hit, so it
 * breaks after 4 landed hits: 6 are given and the driver takes the next one when one breaks.
 * cooldownTicks: net-forge's plan (3): stone sword 13, stone axe 50, crude axe 22, hand 13.
 */
export const BC_PLAN = Object.freeze({
    landing: [-45, 66, -66],                      // P1's landing spot (G2 batch 8), on the G2 seed
    lane: { xFrom: -48, xTo: -41, y: 66, z: -66 },
    zombieA: [-47, 66, -66],
    zombieB: [-43, 66, -66],
    zombieAi: [-42, 66, -66],
    weapons: Object.freeze([
        { check: 'stone_sword', item: 'minecraft:stone_sword', give: 1, cooldownTicks: 13, hits: [8] },
        { check: 'stone_axe', item: 'minecraft:stone_axe', give: 1, cooldownTicks: 50, hits: [9] },
        { check: 'crude_axe', item: 'pyrotech:crude_axe', give: 6, cooldownTicks: 22, hits: [9] },
        { check: 'hand', item: 'hand', give: 0, cooldownTicks: 13, hits: [27, 54] },
    ]),
    ai: { item: 'minecraft:stone_sword', cooldownTicks: 13 },
    maxHits: 40,
    maxMs: 60000,
});

/** The lane's cells: [x, y, z, block] for every setblock, floor first, then the air, then the roof. */
export function bcLaneBlocks(lane = BC_PLAN.lane) {
    const out = [];
    for (let x = lane.xFrom; x <= lane.xTo; x++) out.push([x, lane.y - 1, lane.z, 'minecraft:stone']);
    for (let x = lane.xFrom; x <= lane.xTo; x++) out.push([x, lane.y, lane.z, 'minecraft:air'], [x, lane.y + 1, lane.z, 'minecraft:air']);
    for (let x = lane.xFrom; x <= lane.xTo; x++) out.push([x, lane.y + 2, lane.z, 'minecraft:stone']);
    return out;
}

/** "Near" #518's count: within max(1, 15%) of one of the expected counts. Returns the matched count or null. */
export function nearHits(n, expected) {
    if (!Number.isFinite(n)) return null;
    for (const e of expected) if (Math.abs(n - e) <= Math.max(1, Math.round(e * 0.15))) return e;
    return null;
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
 * each lowers the health; the zombie dies, or (only when #518's count is above maxHits) the projection
 * from the drops is near it; the count is near #518's; no gap between Better Combat packets is under the
 * cooldown; the self-check did not trip. Both: the reply is ok, the zombie was found and did not burn.
 * Returns {ok, why, projected, matched}.
 */
export function judgeSeries(r, { path, hits: expected = [], cooldownTicks = null, maxHits = BC_PLAN.maxHits, ai = false } = {}) {
    const bad = [];
    if (!r) return { ok: false, why: 'no reply', projected: null, matched: null };
    if (!r.ok) bad.push(`driver: ${r.error ?? 'not ok'}`);
    if (!r.target) bad.push('no zombie found');
    if (r.burned) bad.push('the zombie burned (fire damage mixes with the hits)');
    if (r.tripped) bad.push('the self-check tripped (back to vanilla)');
    const hits = (r.hits ?? []).filter((h) => !h.afterDeath);   // a swing at a zombie already dead cannot land
    const sent = hits.filter((h) => h.sent);
    const want = path === 'vanilla' ? 'vanilla' : 'bettercombat';
    const off = sent.filter((h) => h.path !== want);
    if (off.length) bad.push(`${off.length} hit(s) not on the ${want} path (#${off.map((h) => h.i).join(', #')})`);
    if (sent.length !== hits.length) bad.push(`${hits.length - sent.length} call(s) sent nothing`);
    let projected = null;
    let matched = null;
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
        if (!ai) {
            const canProject = expected.some((e) => e > maxHits) && r.end !== 'dead';
            if (r.end !== 'dead' && !canProject) bad.push(`the zombie did not die (${r.end ?? 'no end'})`);
            matched = nearHits(projected, expected);
            if (matched === null) bad.push(`${projected ?? '?'} hits to kill${r.end === 'dead' ? '' : ' (projected)'}, not near #518's ${expected.join(' or ')}`);
        } else if (r.end !== 'dead') bad.push(`the zombie did not die (${r.end ?? 'no end'})`);
        const minGap = cooldownTicks === null ? null : cooldownTicks * 50 - GAP_SLACK_MS;
        const gaps = r.gaps?.bettercombat ?? [];
        const short = minGap === null ? [] : gaps.filter((g) => g < minGap);
        if (short.length) bad.push(`${short.length} gap(s) between Better Combat packets under ${cooldownTicks} ticks (${short.join(', ')} ms)`);
    }
    return { ok: bad.length === 0, why: bad.join('; ') || 'as planned', projected, matched };
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
