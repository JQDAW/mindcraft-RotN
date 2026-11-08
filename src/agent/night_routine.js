// The night routine (skills-rotn D2b-2), for G3 (b) "survives the first night": from dusk to full
// daylight the bot is in a closed rock shelter, and tasks and the agenda wait. No LLM call.
//
//   day -> (dusk or night) build a shelter (!buildShelter's skill) -> inside: stay; every
//   CHECK_MS look for a breach and repair it, break a block that got into the bot's space, or build
//   again when the bot is no longer in it or the shelter is deadly (fire, lava, drowning) -> full
//   daylight: dig out one side and hand back to the task or agenda that was running.
//
// When no shelter can be built (BUILD_ATTEMPTS failures, for example too few blocks), the bot
// stays where it is until morning ('exposed'), with its normal reflexes (lead decision on #204).
// Night is judged by NightClock (D2a: world time first, the wall clock when the time is stuck).
// Control holds (a giver's !stop or !pause) come first (priority.js); a giver's typed !goal runs
// first too, and the bot says the shelter waits for it.

import { Vec3 } from 'vec3';
import { NightClock, nightPhase, NIGHT_START, isWall, handDiggable, REPAIR_LABEL, shelterShell } from './library/night.js';
import { buildShelter, siteNeeds, siteProblem, clearSpace, isLiquid, isFalling, isEmpty, hurtsOnContact, shelterItems, softItems, exactAt, SETTLE } from './library/shelter.js';
import { breakBlockAt, descendFromTree } from './library/skills.js';
import { stowCarried } from './library/rotn_sources.js';
import { digPit, pitOut, moveAwayFrom, PIT } from './library/pit.js';
import { hasWeapon, shelterEnemy } from './library/threats.js';
import { isBranch, isTrunkShell } from './library/felling.js';
import { MAX_SAFE_DROP, isTreePart, standsOnTree } from './library/fall_safety.js';
import { say, isGiverGoal } from './agenda_driver.js';
import settings from './settings.js';

export { REPAIR_LABEL };

/** How often the bot inside checks its shelter for a breach or for having left it. */
export const CHECK_MS = 10_000;
/** Wait before another try after a shelter could not be built. */
export const RETRY_MS = 30_000;
export const BUILD_ATTEMPTS = 3;
/** At dusk a running action gets this long to finish; by night it is stopped at once (#204 review 3). */
export const DUSK_WAIT_MS = 60_000;
/**
 * G3 round 9 B (fix e): a digging zombie (Epic Siege Mod) opened the dirt shelter between two checks.
 * Digging shows first as block break progress; for this long after it is seen on a shelter block,
 * the shelter is checked on every tick instead of every CHECK_MS.
 */
export const DIG_ALARM_MS = 15_000;
/**
 * G3 round 9 B (fix h): after a death at night the bot first walks away from where it died (the
 * killer, and the player zombie that rises there) when that was less than this long ago.
 */
export const DEATH_NEAR_MS = 20 * 60_000;
/**
 * G3 gate B: a pillaring zombie (Epic Siege Mod) put its scaffolding into the bot's head cell, and
 * the bot left its closed shelter and died. A block in the bot's two cells that is no hazard is
 * broken from inside, at most maxClears times within windowMs; then, if it does not suffocate the
 * bot, the bot stays with it (the walls are still closed).
 */
export const SPACE_CLEAR = { maxClears: 3, windowMs: 60_000 };
/**
 * Leaving a deadly shelter at night with a hostile mob this close: the in-shelter fight rules
 * (rotnSheltered 'open': fight in place, no chase, no flee) hold until the bot is out of the cell.
 */
export const LEAVE_MOB_RANGE = 8;

const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const at = (p) => `${p.x}, ${p.y}, ${p.z}`;
const hot = (b) => isLiquid(b) || /fire/.test(b?.name ?? '');

/** Full daylight: the day phase, and the sun no longer rising (the rise ends at time 0). */
export const isFullDay = (t) => t >= 0 && t < NIGHT_START && nightPhase(t) === 'day';

/** The night state of an agent, made on first use. */
export function nightState(agent) {
    return agent._night ??= {
        clock: new NightClock(),
        state: 'day', // 'day' | 'building' | 'inside' | 'exposed'
        site: null,
        attempts: 0,
        nextAt: 0,
        checkedAt: null,
        duskAt: null,
        stopping: false,
        toldGiver: false,
        job: null, // the action running for the routine (build, repair, dig out)
        repairStall: null, // #331 re-review: {fightEndedAt, dug, retry}: the last repair placed nothing (#334: dug, the blocks seen dug since)
        digAt: null, // round 9 B: {pos, tick}: digging last seen on a shelter block (tick: when a nightTick saw it)
        pit: false, // round 9 B (fix h): the shelter is a hole (its morning exit is pitOut)
        pitNext: false, // the next build try is a hole
        pitTried: false, // a hole was tried this night
        pitProgress: {}, // the hole being dug (digPit's progress.P), so an interrupted dig goes on in it
        leftDeathSpot: false, // the walk away from a recent death spot was done (or not needed)
        descended: false, // CX23 soak: the climb down from a tree was tried this build phase
        clears: [], // G3 gate B: when a block in the bot's space was broken from inside (SPACE_CLEAR)
        tolerated: false, // a block in the bot's space that does not suffocate it is kept (it came back too often)
        clearSaid: false, // the clear was said in chat this shelter (then only logged)
        leaveFrom: null, // the deadly shelter left with a mob near: 'open' until the bot is out of this cell
        exitTries: 0, // round 10 B: morning tries at digging out of this shelter (EXIT_TRIES)
        exitAt: null, // when the next try may start
        closedOn: null, // gate2 B: {at, floor}: where the bot was and its floor block when this shelter closed
        unsettled: 0, // #381 review 2: builds in a row refused because the bot was not at rest on the floor (uncounted, SETTLE.retries)
        mobSince: null, // #364 follow-up (b): when the morning wait for a hostile mob near the shelter began
        mobSaid: false, // that wait was said in chat (then only logged)
        cowardiceOn: false, // the routine turned cowardice on while exposed with no weapon
        gen: 0, // bumped by resetNight, so a job that ends after a reset changes nothing
    };
}

/**
 * Back to day: not sheltered, no site (#204 review 6). On death and on spawn (the bot is
 * elsewhere), and when the routine is turned off. At night the routine starts again on its next tick.
 */
export function resetNight(agent, why) {
    if (agent?.bot) agent.bot.rotnSheltered = false;
    const n = agent?._night;
    if (!n) return;
    restoreCowardice(agent, n);
    Object.assign(n, { pit: false, pitNext: false, pitTried: false, leftDeathSpot: false, descended: false, pitProgress: {} });
    if (n.state !== 'day') console.log(`[night] ${why}: not in a shelter any more`);
    Object.assign(n, { state: 'day', site: null, attempts: 0, nextAt: 0, checkedAt: null, duskAt: null, stopping: false, toldGiver: false, repairStall: null, digAt: null });
    Object.assign(n, { clears: [], tolerated: false, clearSaid: false, leaveFrom: null, exitTries: 0, exitAt: null, mobSince: null, mobSaid: false, closedOn: null, unsettled: 0 });
    n.gen++;
}

/**
 * A giver's typed command or !goal takes over while the bot is in its shelter (#204 re-review 1):
 * it may walk the bot out, so the shelter's rules end (cowardice and self_defense act again), and
 * the shelter is built again (or found closed) once the giver's work is done.
 */
export function leaveShelterFor(agent, why) {
    const n = agent?._night;
    if (!n || n.state !== 'inside') return false;
    if (agent.bot) agent.bot.rotnSheltered = false;
    console.log(`[night] ${why} takes over: the shelter's rules are off until it is done`);
    Object.assign(n, { state: 'building', attempts: 0, nextAt: 0, site: null, digAt: null, repairStall: null });
    Object.assign(n, { clears: [], tolerated: false, clearSaid: false, leaveFrom: null, exitTries: 0, exitAt: null, mobSince: null, mobSaid: false });
    return true;
}

/** Stop autonomy at its checkpoint; what ran keeps its place and resumes without a new run. */
function holdAutonomy(agent) {
    const sp = agent.self_prompter;
    if (sp.isActive()) sp.stop(false);
    agent._agenda_paused = true;
    if (agent._task_id) agent._task_paused = true;
    agent._task_tick_at = undefined; // no task LLM time while sheltering
}

/**
 * Run fn as an action. When it ends, `then(result, ret)` gets fn's result (null when it did not
 * finish) and runAction's return ({interrupted, ...}; null when it threw), unless a reset came first.
 */
function startJob(agent, n, label, fn, then) {
    const gen = n.gen;
    let result = null, ret = null;
    n.job = Promise.resolve()
        .then(() => agent.actions.runAction(label, async () => { result = await fn(); }))
        .then(r => { ret = r ?? null; })
        .catch(err => console.warn(`[night] ${label} failed: ${err?.message ?? err}`))
        .then(() => {
            n.job = null;
            if (n.gen === gen) then(result, ret);
        });
}

/**
 * How deep digOut may tunnel through a hillside to reach an open cell (round 10 B: the shelter at
 * -34 64 -49 had no level way out on any side, so the bot stayed walled in all morning).
 */
export const EXIT_DEPTH = 3;
/** Morning tries at digging out (RETRY_MS apart) before the bot hands back still enclosed. */
export const EXIT_TRIES = 3;

const SIDE_NAMES = new Map([['1,0', 'east'], ['-1,0', 'west'], ['0,1', 'south'], ['0,-1', 'north']]);
const sideName = (d) => SIDE_NAMES.get(`${d.x},${d.z}`);
const ALL_AROUND = [...HORIZONTAL, new Vec3(0, 1, 0), new Vec3(0, -1, 0)];
/** A block the bot can stand on: a solid block with no liquid in it that does not hurt, and no part of a tree. */
const standable = (b) => !!b && b.boundingBox === 'block' && !isLiquid(b) && !hot(b) && !hurtsOnContact(b) && !isTreePart(b);

/**
 * The way out of the shelter at feet towards d, as a plan {dig, how, byHand}, or {why} when there
 * is none. The side's two wall cells are dug, then:
 * - 'level': the two cells beyond are free;
 * - 'step': the ground beyond is one block higher with two free cells above it (round 10 B), and
 *   the cell over the opening is dug too, so the bot has room to jump;
 * - 'tunnel': neither, so the next two cells are dug as well, up to EXIT_DEPTH deep, until one of
 *   the two holds (a hillside).
 * No cell is dug that has liquid or fire next to it or a falling block over it (#204 review 5), nor a
 * Dynamic Trees branch or trunk shell (#364 review 1: breaking one fells the tree onto the bot). A
 * level or tunnel exit needs firm ground with a fall of at most MAX_SAFE_DROP from the exit cell (#364 review 2: no
 * opening over a cliff, no tunnel into a cave's drop), and every cell walked through on the way
 * (the side's wall cell and each tunnel cell) needs firm ground right under it (#364 follow-up a).
 */
function exitPlan(bot, feet, d) {
    const dig = [];
    const unsafe = (q) => {
        if (ALL_AROUND.some(o => hot(bot.blockAt(q.plus(o))))) return `liquid or fire next to ${at(q)}`;
        if (isFalling(bot.blockAt(q.offset(0, 1, 0)))) return `a falling block over ${at(q)}`;
        const b = bot.blockAt(q);
        if (isBranch(b) || isTrunkShell(b)) return `a tree's ${b.name} at ${at(q)}`;
        return null;
    };
    // The ground under the exit cell: the first block below that is not free, with a fall of at most
    // MAX_SAFE_DROP onto it (the ground MAX_SAFE_DROP + 1 below the exit cell, as fall_safety counts).
    const noGround = (exit) => {
        for (let dy = 1; dy <= MAX_SAFE_DROP + 1; dy++) {
            const b = bot.blockAt(exit.offset(0, -dy, 0));
            if (isEmpty(b)) continue;
            return standable(b) ? null : `no firm ground under ${at(exit)} (${b?.name ?? 'unloaded'})`;
        }
        return `a drop of more than ${MAX_SAFE_DROP} blocks beyond ${at(exit)}`;
    };
    // #364 follow-up (a): every cell the bot walks through has firm ground right under it (a dug
    // tunnel cell over a cave would drop the bot into it on the way out).
    const noFloor = (q) => {
        const b = bot.blockAt(q.offset(0, -1, 0));
        return standable(b) ? null : `no firm floor under ${at(q)} (${b?.name ?? 'unloaded'})`;
    };
    const take = (q) => { if (!isEmpty(bot.blockAt(q))) dig.push(q); };
    for (let k = 1; k <= EXIT_DEPTH; k++) {
        const lower = feet.plus(d.scaled(k)), upper = lower.offset(0, 1, 0);
        const why = unsafe(upper) ?? unsafe(lower) ?? noFloor(lower);
        if (why) return { why };
        take(upper); take(lower);
        const nextLower = lower.plus(d), nextUpper = upper.plus(d), nextHead = nextUpper.offset(0, 1, 0);
        if ([nextLower, nextUpper].some(q => hot(bot.blockAt(q)))) return { why: `liquid or fire at ${at(nextLower)}` };
        let how = null;
        if (isEmpty(bot.blockAt(nextLower)) && isEmpty(bot.blockAt(nextUpper))) {
            const drop = noGround(nextLower);
            if (drop) return { why: drop };
            how = k === 1 ? 'level' : 'tunnel';
        }
        else if (standable(bot.blockAt(nextLower)) && isEmpty(bot.blockAt(nextUpper)) && isEmpty(bot.blockAt(nextHead))) {
            const room = upper.offset(0, 1, 0); // over the opening: the jump's headroom
            const roomWhy = isEmpty(bot.blockAt(room)) ? null : unsafe(room);
            if (roomWhy) return { why: roomWhy };
            take(room);
            how = k === 1 ? 'step' : 'tunnel';
        }
        if (how) return { dig, how, byHand: dig.every(q => handDiggable(bot.blockAt(q))) };
    }
    return { why: `no free cell within ${EXIT_DEPTH} blocks` };
}

/**
 * Open one side of the shelter so the bot can walk out (exitPlan): a side dug by hand first (dirt,
 * G3 round 6 B: it needs no pickaxe, which a bot that died and built its shelter of dirt does not
 * have), then the plan with the fewest blocks; each side's refusal is logged. The opening is
 * checked after digging. Returns the side's lower wall position, or null.
 */
export async function digOut(bot, feet) {
    // The pickaxe must be where breakBlockAt's equipForBlock looks (#229 review).
    const moved = await stowCarried(bot, (i) => /pickaxe/.test(i.name), { resyncMs: 0 }); // no wait: it is night
    if (moved.length) console.log(`[night] moved ${moved.join(' and ')} back into the inventory to dig out`);
    const plans = [];
    for (const d of HORIZONTAL) {
        const plan = exitPlan(bot, feet, d);
        if (plan.why) console.log(`[night] dig out: not the ${sideName(d)} side (${plan.why})`);
        else plans.push({ ...plan, d });
    }
    plans.sort((a, b) => (b.byHand - a.byHand) || (a.dig.length - b.dig.length)); // stable: HORIZONTAL order on a tie
    for (const plan of plans) {
        let dug = true;
        for (const q of plan.dig) dug &&= isEmpty(bot.blockAt(q)) || await breakBlockAt(bot, q.x, q.y, q.z);
        if (dug && plan.dig.every(q => isEmpty(bot.blockAt(q)))) {
            if (plan.how !== 'level') console.log(`[night] dig out: the ${sideName(plan.d)} side (${plan.how === 'step' ? 'a step up' : 'a tunnel'}, ${plan.dig.length} blocks)`);
            return feet.plus(plan.d);
        }
        console.log(`[night] dig out: could not open the ${sideName(plan.d)} side`);
    }
    return null;
}

const watchedBots = new WeakSet();

/**
 * Listen for digging on the shelter (round 9 B, fix e), once per bot: mineflayer emits
 * blockBreakProgressObserved(block, destroyStage, entity) for another entity's digging. Digging at
 * a shelter block while the bot is inside raises the alarm, and a block for the repair goes in hand.
 */
function watchDigging(agent, bot) {
    if (watchedBots.has(bot) || typeof bot.on !== 'function') return;
    watchedBots.add(bot);
    bot.on('blockBreakProgressObserved', (block, stage, entity) => {
        const n = agent._night;
        if (!n || n.state !== 'inside' || !n.site || !block?.position) return;
        if (!shelterShell(n.site).some(q => q.equals(block.position))) return;
        const first = !n.digAt;
        n.digAt = { pos: block.position, tick: null }; // the next tick times it, on its own clock
        // #334 re-review 2: a no-progress repair stall lets one retry through per block first seen dug
        // since the stall began (two diggers alternating events do not retry it on every tick).
        const key = `${block.position.x},${block.position.y},${block.position.z}`;
        if (n.repairStall && !n.repairStall.dug.has(key)) { n.repairStall.dug.add(key); n.repairStall.retry = true; }
        if (!first) return;
        console.log(`[night] ${entity?.name ?? 'something'} is digging the shelter at ${at(block.position)}: checking at once, ready to repair`);
        // Not while a fight in place runs (#334 review nit after #331): its weapon stays in hand.
        if (bot.rotnFightingInPlace) return;
        const item = [...shelterItems(bot), ...softItems(bot)][0];
        if (item && bot.heldItem?.name !== item.name)
            Promise.resolve(bot.equip(item, 'hand')).catch(err => console.warn(`[night] could not take ${item.name} in hand: ${err?.message ?? err}`));
    });
}

/** Whether digging was seen on the shelter within DIG_ALARM_MS (and ends the alarm after it). */
function digAlarm(n, now) {
    if (!n.digAt) return false;
    n.digAt.tick ??= now;
    if (now - n.digAt.tick < DIG_ALARM_MS) return true;
    n.digAt = null;
    return false;
}

/** The nearest hostile mob (one the shelter fight would hit) within range of the bot, or null. */
export function hostileNear(bot, range = LEAVE_MOB_RANGE) {
    const here = bot?.entity?.position;
    if (!here) return null;
    let best = null, bestD = Infinity;
    for (const e of Object.values(bot.entities ?? {})) {
        if (!e || e === bot.entity || !e.position || !shelterEnemy(e)) continue;
        const d = e.position.distanceTo(here);
        if (d <= range && d < bestD) { best = e; bestD = d; }
    }
    return best;
}

/** "a zombie at x, y, z" for hostileNear's mob (tests' ops may return just true). */
const mobText = (e) => e?.position ? `a ${e.name ?? e.displayName ?? 'hostile mob'} at ${at(e.position.floored())}` : 'a hostile mob';

/** What the routine does in the world (tests pass their own). */
export const NIGHT_OPS = { buildShelter, digOut, siteNeeds, siteProblem, clearSpace, hostileNear, digPit, pitOut, moveAwayFrom, onTree: standsOnTree, descend: (bot) => descendFromTree(bot) };

/**
 * The bot's last death spot when it died less than DEATH_NEAR_MS ago, in this dimension, and is
 * within PIT.awayFrom of it now (round 9 B: it respawned 9 blocks from it, at night), else null.
 */
function deathSpotNear(agent, now) {
    const last = agent._death?.last;
    const pos = agent.bot?.entity?.position;
    if (!last?.pos || !pos || !Number.isFinite(last.at) || now - last.at >= DEATH_NEAR_MS) return null;
    const dim = agent.bot.game?.dimension;
    if (last.dimension != null && dim != null && last.dimension !== dim) return null;
    const d = Math.hypot(pos.x - last.pos.x, pos.y - last.pos.y, pos.z - last.pos.z);
    return d < PIT.awayFrom ? { pos: last.pos, d } : null;
}

/**
 * Exposed with no weapon (round 9 B, fix h): keep away from mobs rather than fight bare-handed.
 * Returns whether the bot keeps away now (cowardice on, by the routine or already).
 */
function keepAwayIfUnarmed(agent, n) {
    const modes = agent.bot?.modes;
    if (!modes?.isOn || !modes.setOn || hasWeapon(agent.bot)) return false;
    if (modes.isOn('cowardice')) return true;
    if (modes.setOn('cowardice', true) === false) return false;
    n.cowardiceOn = true;
    return true;
}

function restoreCowardice(agent, n) {
    if (!n.cowardiceOn) return;
    n.cowardiceOn = false;
    agent.bot?.modes?.setOn?.('cowardice', false);
}

/**
 * A hole shelter (round 9 B, fix h): dig the hole, then roof it with the shelter's own repair at
 * the hole (which crafts the roof's dirt from the dug piles).
 */
async function pitShelter(bot, ops, progress) {
    const feet = await ops.digPit(bot, { progress });
    if (!feet) return { closed: false, feet: null, line: 'found no place to dig a hole shelter' };
    return ops.buildShelter(bot, { site: feet, keepSoft: true });
}

function line(agent, text) {
    console.log(text);
    say(agent, text);
}

function startBuilding(n, now) {
    n.state = 'building';
    n.attempts = 0;
    n.unsettled = 0;
    n.descended = false;
    n.nextAt = now;
}

/**
 * G3 gate B: what the bot does about a problem in the shelter it is in, when that problem is not
 * deadly. A solid block in its two cells (a pillaring zombie's scaffolding) is broken from inside,
 * bounded by SPACE_CLEAR; after that, a block that neither suffocates it nor hurts on contact is kept
 * and the bot stays.
 * A block not loaded is looked at again on the next check. Returns the tick's result when the bot
 * stays, or null when the shelter must be left (fire, lava, drowning, a block it suffocates in or
 * that hurts on contact).
 */
function keepShelter(agent, n, ops, found, now) {
    const bot = agent.bot;
    if (found?.kind === 'unloaded') return 'night:inside';
    if (found?.kind !== 'body') return null;
    n.clears = n.clears.filter(t => now - t < SPACE_CLEAR.windowMs);
    if (n.clears.length < SPACE_CLEAR.maxClears && ops.clearSpace) {
        n.clears.push(now);
        const text = `[night] ${found.text}: breaking it from inside; staying in the shelter`;
        if (n.clearSaid) console.log(text); else { n.clearSaid = true; line(agent, text); } // said once, then logged (T1)
        // The repair's label: self_defense waits for it, as for a repair, and no reflex walks the bot out.
        startJob(agent, n, REPAIR_LABEL, () => ops.clearSpace(bot, found.pos), (ok) => {
            if (!ok) console.warn(`[night] could not break ${found.block} at ${at(found.pos)}`);
            n.checkedAt = -Infinity; // look again on the next tick
        });
        return 'night:inside';
    }
    if (found.suffocates || found.hurts) return null; // #355 review 2: never kept when it hurts on contact
    n.tolerated = true;
    line(agent, `[night] ${found.text} keeps coming back or cannot be broken; it does not suffocate me and the walls are closed: staying in the shelter`);
    n.checkedAt = -Infinity; // the walls are checked on the next tick, with the block allowed
    return 'night:inside';
}

/**
 * One tick of the night routine. null when it is day and nothing night-related runs (the priority
 * stack goes on to tasks and the agenda); otherwise 'night:<state>' and nothing below it runs.
 */
export function nightTick(agent, { now = Date.now(), ops = NIGHT_OPS } = {}) {
    const bot = agent.bot;
    if (!bot) return null;
    // settings.night_shelter: false turns the routine off (default on; lead-owned settings.js).
    if (settings.night_shelter === false) {
        if (bot.rotnSheltered || (agent._night && agent._night.state !== 'day')) resetNight(agent, 'the night routine is off');
        return null;
    }
    const n = nightState(agent);
    // G3 gate B: between a death and the respawn nothing night-related runs (the night line was said
    // and a build started while dead, then again after the spawn's reset).
    if (bot.isAlive === false) return 'night:dead';
    watchDigging(agent, bot);
    // A deadly shelter left with a mob near (LEAVE_MOB_RANGE): out of its cell, the normal rules are back.
    if (n.leaveFrom && !bot.entity.position.floored().equals(n.leaveFrom)) {
        if (bot.rotnSheltered === 'open') bot.rotnSheltered = false;
        n.leaveFrom = null;
    }
    n.clock.observe(bot.time?.timeOfDay, now);
    const t = n.clock.timeOfDay(now);
    if (t === null) return null;
    const phase = nightPhase(t);
    if (n.job) return `night:${n.state}`;
    if (n.state === 'day' && phase === 'day') {
        n.duskAt = null;
        return null;
    }

    // A giver's typed !goal runs first (#204 review 4), as it does over a task; say once that
    // the shelter waits for it.
    if (isGiverGoal(agent)) {
        leaveShelterFor(agent, "a task giver's goal");
        if (!n.toldGiver) {
            n.toldGiver = true;
            line(agent, `[night] ${phase === 'day' ? 'the night is over' : 'it is night'}; your goal runs first, and I see to the shelter when it is done`);
        }
        return 'night:yield';
    }
    n.toldGiver = false;

    // A reflex (a fight, fleeing, eating) is acting: let it finish; nothing is started or judged
    // meanwhile, so the build and self_defense do not stop each other (#204 review 1).
    if (bot.modes?.anyActive?.()) return `night:${n.state}`;

    if (n.state === 'day') {
        n.duskAt ??= now;
        holdAutonomy(agent);
        if (agent.self_prompter.loop_active || agent.actions?.executing) {
            // A long action must not use up the time before dark (#204 review 3).
            if ((phase === 'night' || now - n.duskAt >= DUSK_WAIT_MS) && !n.stopping) {
                n.stopping = true;
                console.log(`[night] stopping ${agent.actions?.currentActionLabel || 'the running command'} to build a shelter`);
                Promise.resolve(agent.actions?.stop?.()).catch(err => console.warn(`[night] could not stop the action: ${err?.message ?? err}`));
            }
            return 'night:waiting';
        }
        n.stopping = false;
        line(agent, `[night] ${phase === 'dusk' ? 'sunset is near' : 'it is night'}: building a shelter`);
        startBuilding(n, now);
    }

    if (isFullDay(t) && n.state !== 'inside') {
        // Morning came before a shelter did (or the bot was exposed): back to work.
        bot.rotnSheltered = false;
        n.state = 'day';
        restoreCowardice(agent, n);
        Object.assign(n, { pitTried: false, leftDeathSpot: false, descended: false, pitProgress: {}, leaveFrom: null });
        line(agent, '[night] morning: back to work');
        return null;
    }
    holdAutonomy(agent);

    if (n.state === 'building') {
        // CX23 soak (rotn-v0.1.3): respawned in a canopy, every shelter and hole try failed there
        // (leaves under every site). Down to the ground first, once per build phase.
        if (!n.descended && ops.onTree?.(bot)) {
            n.descended = true;
            line(agent, '[night] up on a tree: climbing down before sheltering');
            startJob(agent, n, 'action:descendFromTree', () => ops.descend(bot), (down) => {
                if (!down) console.warn('[night] still on the tree; sheltering from here');
                n.nextAt = 0;
            });
            return 'night:building';
        }
        // Round 9 B (fix h): died here at night not long ago: first away from the spot.
        const spot = n.leftDeathSpot ? null : deathSpotNear(agent, now);
        n.leftDeathSpot = true;
        if (spot && ops.moveAwayFrom) {
            line(agent, `[night] I died ${Math.round(spot.d)} blocks from here; moving at least ${PIT.awayFrom} away before sheltering`);
            startJob(agent, n, 'action:leaveDeathSpot', () => ops.moveAwayFrom(bot, spot.pos, PIT.awayFrom), (far) => {
                if (!far) console.warn('[night] could not get far from the death spot; sheltering here');
                n.nextAt = 0;
            });
            return 'night:building';
        }
        if (n.nextAt === null) n.nextAt = now + RETRY_MS;
        if (now < n.nextAt) return 'night:building';
        const pit = n.pitNext;
        startJob(agent, n, pit ? 'action:digPit' : 'action:buildShelter', () => (pit ? pitShelter(bot, ops, n.pitProgress) : ops.buildShelter(bot)), (r, ret) => {
            if (r?.closed) {
                n.unsettled = 0;
                n.pitNext = false;
                n.state = 'inside';
                n.site = r.feet;
                n.pit = pit;
                n.digAt = null; // digging seen at an earlier shelter is not this one's
                n.repairStall = null;
                Object.assign(n, { clears: [], tolerated: false, clearSaid: false, leaveFrom: null });
                n.checkedAt = null; // set by the next tick, on its clock
                bot.rotnSheltered = true;
                // Gate2 B: where the bot was and what it stood on, for the line if it is ever out of it.
                n.closedOn = { at: exactAt(bot), floor: bot.blockAt?.(r.feet.offset(0, -1, 0))?.name ?? 'unknown' };
                line(agent, `[night] in the shelter at ${at(r.feet)} until morning`);
                return;
            }
            if (ret?.interrupted) {
                // A reflex or a command stopped it: not a try; build again once it is done. A hole
                // stays next (#337 review 6), and its dig goes on in the same hole (pitProgress).
                n.nextAt = 0;
                console.log(`[night] the ${pit ? 'hole shelter' : 'shelter build'} was interrupted; it does not count as a try`);
                return;
            }
            // #381 review 2: the bot was not at rest on the floor (mid-jump, bobbing): like an
            // interruption, not a try; planned again at once from where it is (a hole stays next).
            // Bounded: after SETTLE.retries such refusals in a row, one counts as a failed build.
            if (r?.unsettled && (n.unsettled ?? 0) < SETTLE.retries) {
                n.unsettled = (n.unsettled ?? 0) + 1;
                n.nextAt = 0;
                console.log(`[night] the ${pit ? 'hole shelter' : 'shelter build'} waited for the bot to stand on the floor (${r.line}); planning again from here, not a try (${n.unsettled} of ${SETTLE.retries})`);
                return;
            }
            n.unsettled = 0;
            n.pitNext = false;
            const why = r?.line ?? 'the build ended without a result';
            // #337 review 8: the tries are the shelter builds (BUILD_ATTEMPTS); the hole is one more,
            // once a night, right after the first failed build, and it is not counted.
            if (!pit) n.attempts++;
            // Round 9 B (fix h): a shelter that could not be built is followed by a hole; it needs
            // nothing in the inventory.
            if (!pit && !n.pitTried && ops.digPit) {
                n.pitTried = true;
                n.pitNext = true;
                n.nextAt = 0;
                console.warn(`[night] shelter try ${n.attempts} of ${BUILD_ATTEMPTS} failed (${why}); digging a hole shelter instead`);
                return;
            }
            if (n.attempts >= BUILD_ATTEMPTS) {
                n.state = 'exposed';
                if (n.leaveFrom && bot.rotnSheltered === 'open') bot.rotnSheltered = false; // no shelter: the normal rules
                n.leaveFrom = null;
                // #337 review 7: the line says what the bot does.
                const away = keepAwayIfUnarmed(agent, n);
                const tries = `${n.attempts} tries${n.pitTried ? ' and a hole shelter' : ''}`;
                line(agent, `[night] no shelter after ${tries} (${why}); ${away ? 'no weapon: keeping away from mobs until morning' : 'staying here until morning'}`);
            } else {
                n.nextAt = null; // the next tick waits RETRY_MS from its own clock
                console.warn(`[night] shelter try ${n.attempts} of ${BUILD_ATTEMPTS} failed (${why})`);
            }
        });
        return 'night:building';
    }

    if (n.state === 'inside') {
        // Round 10 B: a shelter with no way out is not left as 'day' with the bot still walled in:
        // digOut is tried again RETRY_MS later, EXIT_TRIES times, then the bot hands back. Between
        // tries the shelter's checks below run as at night (#364 review 4: breaches, the dig alarm).
        const waiting = n.exitAt != null && now < n.exitAt;
        const walkedOut = n.exitAt != null && !bot.entity.position.floored().equals(n.site);
        if (isFullDay(t) && (!waiting || walkedOut)) {
            const handBack = (text) => {
                bot.rotnSheltered = false;
                n.state = 'day';
                n.site = null;
                Object.assign(n, { pit: false, pitTried: false, leftDeathSpot: false, pitProgress: {}, exitTries: 0, exitAt: null, mobSince: null, mobSaid: false });
                line(agent, text);
            };
            const failedTry = (why) => {
                n.exitTries = (n.exitTries ?? 0) + 1;
                if (n.exitTries < EXIT_TRIES) {
                    n.exitAt = now + RETRY_MS;
                    line(agent, `[night] morning: ${why} (try ${n.exitTries} of ${EXIT_TRIES}); trying again in ${RETRY_MS / 1000} s`);
                } else {
                    handBack(`[night] morning: could not leave the shelter at ${at(n.site)} after ${EXIT_TRIES} tries (${why}); back to work, still enclosed: dig a way out`);
                }
            };
            if (walkedOut) {
                handBack(`[night] morning: out of the shelter at ${at(n.site)}; back to work`);
                return null;
            }
            // #364 review 3: mobs that do not burn wait outside in the day: no opening while one is near.
            // #364 follow-up (b): that wait is no try (3 tries used up by a mob handed back enclosed,
            // and the agenda or the LLM then dug out with it still there): the bot stays in, held,
            // re-checking every RETRY_MS, as long as one is near, for at most the full day (#372 review:
            // a fixed 3 min handed back with the mob still there); the bound is below. A mob that
            // leaves ends its wait (mobSince): a later one gets its own, said again.
            const mob = ops.hostileNear?.(bot, LEAVE_MOB_RANGE);
            if (!mob) Object.assign(n, { mobSince: null, mobSaid: false });
            if (mob) {
                n.mobSince ??= now;
                n.exitAt = now + RETRY_MS;
                const text = `[night] morning: ${mobText(mob)} is within ${LEAVE_MOB_RANGE} blocks of the shelter at ${at(n.site)}; staying in until it leaves (checking every ${RETRY_MS / 1000} s)`;
                if (n.mobSaid) console.log(text); else { n.mobSaid = true; line(agent, text); }
                return 'night:inside';
            }
            const out = n.pit ? () => ops.pitOut(bot, n.site) : () => ops.digOut(bot, n.site);
            startJob(agent, n, 'action:leaveShelter', out, (side) => {
                if (side) handBack(`[night] morning: dug out of the shelter at ${at(side)}; back to work`);
                else failedTry(`no safe side of the shelter at ${at(n.site)} to open yet`);
            });
            return 'night:inside';
        }
        // #372 review: the bound of the morning wait for a mob. The lead's noon (6000) comes after
        // the full day ends on this pack's clock (dusk: SHELTER_LEAD_MIN before sunset, about 5348),
        // so the bound is the end of the full day: a warning naming the mob, and the bot stays in
        // this shelter for the night (a hand-back at dusk would only shelter again, here).
        if (n.mobSince != null && !isFullDay(t)) {
            const mob = ops.hostileNear?.(bot, LEAVE_MOB_RANGE);
            const text = `[night] warning: ${mob ? `${mobText(mob)} is still within ${LEAVE_MOB_RANGE} blocks` : 'a hostile mob stayed near'} of the shelter at ${at(n.site)} at the end of the day (waited ${Math.round((now - n.mobSince) / 60_000)} min); staying in it for the night`;
            console.warn(text);
            say(agent, text);
            Object.assign(n, { mobSince: null, mobSaid: false, exitTries: 0, exitAt: null });
        }
        if (n.checkedAt === null) n.checkedAt = now;
        // #331 review 4: while a wall is known open (a repair did not close it, or a fight in place
        // held it up), every tick checks and repairs, not every CHECK_MS.
        const open = bot.rotnSheltered === 'open';
        // #331 re-review: a repair that placed nothing (no blocks left, a mob in the cell) is not
        // tried again on every tick all night (thousands of log lines an hour): it waits CHECK_MS
        // again, unless a fight in place has ended since (the cell may be free now).
        // ... or a block not yet seen dug since the stall began is dug (#334 re-review 2: once per block).
        const stalled = !!n.repairStall && n.repairStall.fightEndedAt === (bot.rotnFightEndedAt ?? null)
            && !n.repairStall.retry;
        // Round 9 B (#334): while something digs at the shelter, every tick checks; a stall still waits
        // CHECK_MS, unless a block not yet seen dug since the stall began is dug (#334 re-review 2).
        if (((!open && !digAlarm(n, now)) || stalled) && now - n.checkedAt < CHECK_MS) return 'night:inside';
        n.checkedAt = now;
        if (!bot.entity.position.floored().equals(n.site)) {
            // Pushed, teleported (AggroTP) or walked out: a new shelter where it is now.
            bot.rotnSheltered = false;
            // Gate2 B (00:19:39): the move one block lower named nothing; now the line says where
            // the bot is and what the floor is, at closing and now.
            const floorNow = bot.blockAt?.(n.site.offset(0, -1, 0))?.name ?? 'unknown';
            const was = n.closedOn ? `at closing at ${n.closedOn.at} on ${n.closedOn.floor}; ` : '';
            console.log(`[night] out of the shelter at ${at(n.site)}: ${was}now at ${exactAt(bot)}, its floor at ${at(n.site.offset(0, -1, 0))} is ${floorNow}`);
            line(agent, `[night] no longer in the shelter at ${at(n.site)}: building a new one`);
            startBuilding(n, now);
            return 'night:building';
        }
        // Dirt walls (the fallback) are walls too: only an opening is a breach (G3 round 6 B). Only
        // real fire or lava, or a solid block in the bot's two cells, makes the shelter unusable: a
        // dropped item or a harmless block (a torch, a carpet, snow) never does (G3 round 7 B).
        const tolerateBody = n.tolerated;
        const need = ops.siteNeeds(bot, n.site, { accept: isWall, occupied: true, tolerateBody });
        if (!need) {
            // Say exactly what is where (G3 round 7 B).
            const found = ops.siteProblem?.(bot, n.site, { occupied: true, tolerateBody });
            const kept = keepShelter(agent, n, ops, found, now);
            if (kept) return kept;
            // Deadly (fire, lava, drowning, a block it suffocates in and cannot break): it cannot be
            // repaired there (#204 review 2). G3 gate B: with a hostile mob near, the in-shelter fight
            // rules hold until the bot is out of this cell (no chase, no flee into the open).
            const mob = !!ops.hostileNear?.(bot, LEAVE_MOB_RANGE);
            bot.rotnSheltered = mob ? 'open' : false;
            n.leaveFrom = mob ? n.site.clone() : null;
            line(agent, `[night] the shelter at ${at(n.site)} is no longer usable: ${found?.text ?? 'the check found it unusable but named nothing'}; building a new one${mob ? ' (a hostile mob is near: fighting only in reach until out)' : ''}`);
            startBuilding(n, now);
            return 'night:building';
        }
        if (need.todo.length === 0 && open) { bot.rotnSheltered = true; n.repairStall = null; } // closed again: the shelter's rules are back
        if (need.todo.length > 0) {
            // self_defense fights at the opening, from where the bot stands, and never during the
            // repair (G3 round 9 B: it interrupted the repair and walked out after the zombie).
            bot.rotnSheltered = 'open';
            const text = `[night] the shelter is open at ${need.todo.map(at).join('; ')}: repairing`;
            if (open) console.log(text); else line(agent, text); // said once, then logged (T1: chat volume)
            startJob(agent, n, REPAIR_LABEL, () => ops.buildShelter(bot, { site: n.site, keepSoft: true, tolerateBody }), (r) => {
                if (r?.closed) { bot.rotnSheltered = true; n.repairStall = null; return; }
                // CX23 soak: why cells stay open, in the journal (r.line names each cell and its reason).
                if ((r?.placed ?? 0) > 0) { console.log(`[night] the repair placed ${r.placed} but left some open (${r.line})`); n.repairStall = null; return; } // progress: the next tick tries again
                // Nothing placed: back to every CHECK_MS until a fight in place ends (#331 re-review).
                if (!n.repairStall) console.warn(`[night] the repair placed nothing (${r?.line ?? 'no result'}); checking again in ${CHECK_MS / 1000} s`);
                // The same stall goes on: the blocks already seen dug do not let another retry through.
                n.repairStall = { fightEndedAt: bot.rotnFightEndedAt ?? null, dug: n.repairStall?.dug ?? new Set(), retry: false };
            });
        }
        return 'night:inside';
    }

    return `night:${n.state}`; // exposed
}
