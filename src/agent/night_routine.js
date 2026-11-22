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
import pf from 'mineflayer-pathfinder';
import { NightClock, nightPhase, NIGHT_START, isWall, REPAIR_LABEL, BACK_AWAY_LABEL, POCKET_LABEL, BURROW_LABEL, SCROLL_LABEL, shelterShell, isFullDay, replanHold } from './library/night.js';
import { buildShelter, siteNeeds, siteProblem, clearSpace, isLiquid, isFalling, isEmpty, hurtsOnContact, shelterItems, softItems, exactAt, SETTLE, heldCells, retreatPlan, backAway } from './library/shelter.js';
import { goToGoal, descendFromTree, avoidEnemies, inShelterReach } from './library/skills.js';
import { stowCarried, toolAllows } from './library/rotn_sources.js';
import { digPit, pitOut, quickByHand, digWithin, digBudget } from './library/pit.js';
import { burrowThreat, burrowAway, burrowsFrom, digRule, digEquip, BURROW } from './library/burrow.js';
import { nightRelocationPlan, walkAwayAtNight, NIGHT_RELOCATE } from './respawn_relocate.js';
import { escapedRecently, scrollRefusal, useSpawnScroll } from './respawn_escape.js';
import { groundPlan, walkToGround, stepToDry, planText, inWater, GROUND } from './library/shelter_ground.js';
import { escape } from './library/escape.js';
import { hasWeapon, shelterEnemy, shelterTarget, threatFor, isPlayerZombie, canFightHard, maxHitOf, inMeleeReach, meleeReach, fightNumbers, fightOdds, hurtingInReach } from './library/threats.js';
import { isBranch, isTrunkShell } from './library/felling.js';
import { MAX_SAFE_DROP, isTreePart, standsOnTree } from './library/fall_safety.js';
import { say, isGiverGoal, ownsPrompt } from './agenda_driver.js';
import { OPEN_GOAL_PREFIX, STANDING_GOAL_PREFIX } from './agenda.js';
import settings from './settings.js';
import { heldFoodHunger, FOOD_TARGET } from './library/food.js';

export { REPAIR_LABEL };

/** How often the bot inside checks its shelter for a breach or for having left it. */
export const CHECK_MS = 10_000;
/** Wait before another try after a shelter could not be built. */
export const RETRY_MS = 30_000;
export const BUILD_ATTEMPTS = 3;
/**
 * Soak 2 (rotn-v0.1.4, night 2): the unstuck reflex stopped the hole shelter every ~22 s, and an
 * interruption was never a try, so the night never got a shelter. This many interruptions per
 * build phase are free (a reflex that really had to act); after that each one counts as a failed try,
 * so the tries (BUILD_ATTEMPTS, the hole) run out and the night ends in a shelter or in 'exposed'.
 */
export const FREE_INTERRUPTS = 2;
/**
 * #431 review 2: a threat reflex (a fight, a flee) that stops the build had to act: such
 * interruptions are counted apart, with this larger bound, and then count as a failed try too.
 */
export const THREAT_INTERRUPTS = 6;
const THREAT_MODES = ['self_defense', 'cowardice', 'self_preservation'];
/**
 * #431 review 2: an exposed night (no shelter after the tries) tries again once it has been quiet
 * (no hostile mob within QUIET_RANGE) this long, at most EXPOSED_RETRIES times a night.
 */
export const EXPOSED_RETRY_MS = 60_000;
export const EXPOSED_RETRIES = 4;
const QUIET_RANGE = 16;
/** At dusk a running action gets this long to finish; by night it is stopped at once (#204 review 3). */
export const DUSK_WAIT_MS = 60_000;
/**
 * G3 round 9 B (fix e): a digging zombie (Epic Siege Mod) opened the dirt shelter between two checks.
 * Digging shows first as block break progress; for this long after it is seen on a shelter block,
 * the shelter is checked on every tick instead of every CHECK_MS.
 */
export const DIG_ALARM_MS = 15_000;
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

// Full daylight (night.js, where the re-plan hold reads it too).
export { isFullDay };

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
        burrowSteps: 0, // soak 5 Fix B: burrow steps taken this night (BURROW.maxSteps)
        burrowNoneAt: null, // when the last burrow ended short of far enough (the next waits CHECK_MS)
        ...GROUND_CLEAR, groundSkip: [],
        gen: 0, // bumped by resetNight, so a job that ends after a reset changes nothing
    };
}

/**
 * Soak 8 (night 2): the walks to better ground (shelter_ground.js). groundMoves: walks this night
 * (GROUND.maxMoves); groundSkip: the places reached (not chosen again: #557 review 5); buildNoPlace/buildRefused:
 * the last build found no place, and what refused the sites; pitNoPlace: the hole this build phase
 * found no place (#557 review 7); noPlaceCell: where the night was found
 * to have no place, and no better ground was found or left (no retry from there); sameCellSaid: that was said.
 */
const GROUND_CLEAR = { groundMoves: 0, buildNoPlace: false, buildRefused: null, pitNoPlace: false, pitNoPlaceAt: null, noPlaceCell: null, sameCellSaid: false, escapes: 0 };
const GROUND_LABEL = 'action:walkToGround';
const ESCAPE_LABEL = 'action:escape';
/** Soak 8, the flooded pit (the lead's escape plan): escapes a night (library/escape.js), when a walk to better ground or out of the water finds no way. */
export const NIGHT_ESCAPES = 2;
const DRY_LABEL = 'action:stepToDry';

/**
 * Back to day: not sheltered, no site (#204 review 6). On death and on spawn (the bot is
 * elsewhere), and when the routine is turned off. At night the routine starts again on its next tick.
 */
export function resetNight(agent, why) {
    if (agent?.bot) agent.bot.rotnSheltered = false;
    const n = agent?._night;
    if (!n) return;
    restoreCowardice(agent, n);
    Object.assign(n, { pit: false, pitNext: false, pitTried: false, leftDeathSpot: false, escapeSeen: false, relocTries: 0, relocPending: false, relocWaitUntil: null, descended: false, pitProgress: {}, burrowSteps: 0, burrowNoneAt: null, ...GROUND_CLEAR, groundSkip: [] });
    if (n.state !== 'day') console.log(`[night] ${why}: not in a shelter any more`);
    Object.assign(n, { state: 'day', site: null, attempts: 0, nextAt: 0, checkedAt: null, duskAt: null, stopping: false, toldGiver: false, repairStall: null, digAt: null });
    Object.assign(n, { clears: [], tolerated: false, clearSaid: false, leaveFrom: null, exitTries: 0, exitAt: null, mobSince: null, mobSaid: false, closedOn: null, unsettled: 0, ...MORNING_CLEAR });
    n.gen++;
}

/**
 * A giver's typed command or !goal takes over while the bot is in its shelter (#204 re-review 1):
 * it may walk the bot out, so the shelter's rules end (cowardice and self_defense act again), and
 * the shelter is built again (or found closed) once the giver's work is done.
 */
/**
 * The morning rule's state (#477 review 1: resetNight, leaveShelterFor and the hand-back clear it all;
 * a stale "leaving" would silence the shelter fight, the hurt-eating and the hand fight a whole night).
 */
const MORNING_CLEAR = { morningAct: null, morningWhy: null, morningLeaving: false, mobFirst: null, mobStateSaid: false, mobGoneAt: null, closeSaid: null, closeBurrowTried: null, closeBurrowWhy: null, closeSealTried: null, capHeldSaid: false, capReleaseSaid: false, capSealTried: false };

export function leaveShelterFor(agent, why) {
    const n = agent?._night;
    if (!n || n.state !== 'inside') return false;
    if (agent.bot) agent.bot.rotnSheltered = false;
    if (n.site) n.lastShelter = n.site.clone?.() ?? n.site; // #479 nit 3
    console.log(`[night] ${why} takes over: the shelter's rules are off until it is done`);
    Object.assign(n, { state: 'building', attempts: 0, nextAt: 0, site: null, digAt: null, repairStall: null });
    Object.assign(n, { clears: [], tolerated: false, clearSaid: false, leaveFrom: null, exitTries: 0, exitAt: null, mobSince: null, mobSaid: false, ...MORNING_CLEAR });
    return true;
}

/**
 * Stop autonomy at its checkpoint; what ran keeps its place and resumes without a new run. The
 * agenda's and a task's own goals resume through their drivers; any other goal running here (the
 * model's own) is kept for resumeNightGoal (#463 rework: after full day the self-prompter runs again
 * if it ran at dusk). A giver's typed goal is never stopped here (the routine yields to it).
 */
function holdAutonomy(agent) {
    const sp = agent.self_prompter;
    if (sp.isActive()) {
        // #468 review 2: not the open goal: the agenda gives it again (under its window budget).
        // #478: nor the standing goal (the agenda gives it again, one budget a day).
        if (!ownsPrompt(agent) && sp.prompt && !sp.prompt.startsWith(OPEN_GOAL_PREFIX) && !sp.prompt.startsWith(STANDING_GOAL_PREFIX)) agent._night_goal = sp.prompt;
        sp.stop(false);
    }
    agent._agenda_paused = true;
    if (agent._task_id) agent._task_paused = true;
    agent._task_tick_at = undefined; // no task LLM time while sheltering
}

/**
 * After the night (the routine back to 'day', and full day): the goal holdAutonomy stopped, other
 * than the agenda's or a task's, starts again, once; not when the self-prompter already runs another
 * goal. A giver's !endGoal or !stop forgets it (forgetNightGoal).
 * Called by the priority stack after tasks and the walk away after a respawn. Returns whether it did.
 */
export function resumeNightGoal(agent) {
    const goal = agent._night_goal;
    // #463 nit 2: and not before full day (replanHold), so a death in the dawn gap does not start it
    // while the death's prompt is held.
    if (!goal || (agent._night && agent._night.state !== 'day') || replanHold(agent)) return false;
    agent._night_goal = null;
    const sp = agent.self_prompter;
    if (sp.isActive() || sp.loop_active) return false;
    console.log('[night] morning: the goal that ran at dusk resumes');
    sp.start(goal);
    return true;
}

/** #463 nit 1: a task giver's !endGoal or !stop: the goal the night stopped does not come back. */
export function forgetNightGoal(agent) {
    agent._night_goal = null;
}

/**
 * The back-away (#470) and the hole's side pocket (soak 3, the lead's (a)) as a job: backAway into
 * plan.to. #470 review 3: in plan.to (sealed or not) that is the shelter now: held or repaired there
 * by the checks, never built afresh beside a mob. done: the line's verb ("backed away", "moved into
 * the side pocket").
 */
function startBackAway(agent, n, ops, plan, tolerateBody, label, done) {
    const bot = agent.bot;
    startJob(agent, n, label, () => ops.backAway(bot, plan), (r) => {
        const inTo = !!r?.site || bot.entity.position.floored().equals(plan.to);
        if (!inTo) { console.warn(`[night] ${done === 'backed away' ? 'backing away' : 'the side pocket'} did not work (${r?.why ?? 'no result'}); staying in the shelter at ${at(n.site)}`); return; }
        n.site = plan.to.clone?.() ?? plan.to;
        n.repairStall = null;
        n.checkedAt = null;
        // Soak 5 (00:46:55): the "out of the shelter" line named the hole's closing spot, not the
        // pocket's: where the bot stands now, in the new cell.
        n.closedOn = { at: exactAt(bot), floor: bot.blockAt?.(n.site.offset(0, -1, 0))?.name ?? 'unknown' };
        const still = ops.siteNeeds(bot, n.site, { accept: isWall, occupied: true, tolerateBody });
        bot.rotnSheltered = still && still.todo.length === 0 ? true : 'open';
        if (bot.rotnSheltered === true) n.handFight = false; // #470 nit
        line(agent, r?.site ? `[night] ${done}: in the shelter at ${at(n.site)}, the cells behind sealed`
            : `[night] ${done} into ${at(n.site)}, but ${r?.why ?? 'the seal failed'}; holding or repairing there`);
    });
}

/**
 * Soak 5 Fix B (PR 5): burrow away from threat.mob (burrow.burrowAway) as a job. Where the bot ends
 * up is the shelter now (as after a back-away): held or repaired there, never built afresh beside
 * the mob. Every step counts against the night's BURROW.maxSteps.
 */
function startBurrow(agent, n, ops, threat) {
    const bot = agent.bot, mob = threat.mob, name = mob.name ?? 'hostile mob';
    line(agent, `[night] ${aMob(name)} (digs through anything) ${threat.d.toFixed(1)} blocks from the shelter at ${at(n.site)}: burrowing away from it`);
    startJob(agent, n, BURROW_LABEL, () => ops.burrowAway(bot, mob, { maxSteps: BURROW.maxSteps - (n.burrowSteps ?? 0) }), (r) => {
        n.burrowSteps = (n.burrowSteps ?? 0) + (r?.steps ?? 0);
        const here = burrowedInto(bot, n, ops);
        const far = r?.stopped === 'far' || r?.stopped === 'gone';
        // #507 review 4: when the burrow ended (up to BURROW.maxMs after the tick that started it).
        n.burrowNoneAt = far ? null : (ops.now ?? Date.now)();
        const steps = r?.steps ?? 0;
        const moved = steps ? `burrowed ${steps} step${steps === 1 ? '' : 's'} into ${at(here)}` : `did not burrow (still at ${at(here)})`;
        const m = bot.entities?.[mob.id];
        const dist = m?.position ? `, ${m.position.distanceTo(bot.entity.position).toFixed(1)} blocks from ${aMob(name)}` : '';
        const end = {
            far: 'far enough; sealed behind',
            gone: `${aMob(name)} is gone`,
            cornered: `no step further (${r?.why}); not hitting it`,
            budget: `the night's ${BURROW.maxSteps} burrow steps are used; not hitting it`,
            time: `${BURROW.maxMs / 1000} s up; trying again in ${CHECK_MS / 1000} s`,
            failed: `${r?.why}; not hitting it`,
        }[r?.stopped] ?? `the burrow ended (${r?.why ?? 'no result'})`;
        line(agent, `[night] ${moved}${dist}: ${end}`);
    });
}

/**
 * Run fn as an action. When it ends, `then(result, ret)` gets fn's result (null when it did not
 * finish) and runAction's return ({interrupted, ...}; null when it threw), unless a reset came first.
 */
function startJob(agent, n, label, fn, then) {
    const gen = n.gen;
    let result = null, ret = null;
    n.job = Promise.resolve()
        .then(() => {
            // #431 review 2: only a stop of this run is attributed to its stopper, not an older one.
            if (agent.rotnLastInterrupt?.of === label) agent.rotnLastInterrupt = null;
            // #463 review 1: the routine's own jobs are no fresh decision: a held re-plan (a death's)
            // survives them and goes once at full day.
            return agent.actions.runAction(label, async () => { result = await fn(); }, { keepReplan: true });
        })
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
/** Why a cell must not be dug on the way out (unloaded, liquid or fire next to it, a falling block over it, a tree part), or null. */
function unsafeCell(bot, q) {
    // #435 review 4: blockAt is null in a chunk not loaded; nothing is known about the cell.
    if ([q, ...ALL_AROUND.map(o => q.plus(o))].some(c => !bot.blockAt(c))) return `an unloaded cell at or next to ${at(q)}`;
    if (ALL_AROUND.some(o => hot(bot.blockAt(q.plus(o))))) return `liquid or fire next to ${at(q)}`;
    if (isFalling(bot.blockAt(q.offset(0, 1, 0)))) return `a falling block over ${at(q)}`;
    const b = bot.blockAt(q);
    if (isBranch(b) || isTrunkShell(b)) return `a tree's ${b.name} at ${at(q)}`;
    return null;
}

/**
 * The ground under an exit cell: the first block below that is not free, with a fall of at most
 * MAX_SAFE_DROP onto it (the ground MAX_SAFE_DROP + 1 below the exit cell, as fall_safety counts).
 */
function noGroundUnder(bot, exit) {
    for (let dy = 1; dy <= MAX_SAFE_DROP + 1; dy++) {
        const b = bot.blockAt(exit.offset(0, -dy, 0));
        if (isEmpty(b)) continue;
        return standable(b) ? null : `no firm ground under ${at(exit)} (${b?.name ?? 'unloaded'})`;
    }
    return `a drop of more than ${MAX_SAFE_DROP} blocks beyond ${at(exit)}`;
}

/**
 * Soak 2 (rotn-v0.1.4, 23:21): the night shelter was the stone pit the bot had dug while collecting
 * rocks: every side was rock for more than EXIT_DEPTH, and digOut only goes sideways, so all three
 * morning tries failed. With no sideways exit, stairs up towards d: up to UP_STEPS steps, each one
 * up and one across (the headroom over the bot, then the step's two cells; the step stands on the
 * block beside the bot), until the two cells beyond the top step are free with ground under them.
 * The same safety rules as the sideways exits. A plan {dig, how: 'stairs', byHand, exit} or {why}.
 */
export const UP_STEPS = 4;
const WORLD_TOP = 256; // 1.12
/**
 * #435 review 3: nothing but air, plants or a tree's leaves and branches over q, up to the top of
 * the world: stairs that end in a cave are no way out. A column not loaded is not open.
 */
function openSky(bot, q) {
    for (let y = q.y; y < WORLD_TOP; y++) {
        const b = bot.blockAt(new Vec3(q.x, y, q.z));
        if (!b || isLiquid(b) || (b.boundingBox !== 'empty' && !isTreePart(b))) return false;
    }
    return true;
}
function stairsUpPlan(bot, feet, d) {
    const dig = [];
    const take = (q) => { if (!isEmpty(bot.blockAt(q))) dig.push(q); };
    let p = feet;
    for (let k = 1; k <= UP_STEPS; k++) {
        const next = p.plus(d).offset(0, 1, 0);
        const cells = [p.offset(0, 2, 0), next, next.offset(0, 1, 0)];
        for (const q of cells) { const why = unsafeCell(bot, q); if (why) return { why }; }
        const step = p.plus(d); // what the step stands on
        if (!isEmpty(bot.blockAt(step)) && !standable(bot.blockAt(step))) return { why: `no firm step at ${at(step)} (${bot.blockAt(step)?.name ?? 'unloaded'})` };
        if (isEmpty(bot.blockAt(step))) return { why: `no step at ${at(step)} (it is open)` };
        cells.forEach(take);
        p = next;
        const out = p.plus(d);
        if (isEmpty(bot.blockAt(out)) && isEmpty(bot.blockAt(out.offset(0, 1, 0))) && !hot(bot.blockAt(out)) && !noGroundUnder(bot, out)) {
            if (!openSky(bot, out)) return { why: `no open sky over ${at(out)}` };
            return { dig, how: 'stairs', byHand: dig.every(q => quickByHand(bot.blockAt(q))), exit: out, steps: k };
        }
    }
    return { why: `no way up within ${UP_STEPS} steps` };
}

function exitPlan(bot, feet, d) {
    const dig = [];
    const unsafe = (q) => unsafeCell(bot, q);
    const noGround = (exit) => noGroundUnder(bot, exit);
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
        if (how) return { dig, how, byHand: dig.every(q => quickByHand(bot.blockAt(q))) };
    }
    return { why: `no free cell within ${EXIT_DEPTH} blocks` };
}

/**
 * #435 review 1: the block among the plan's blocks that no tool the bot carries can break, or null
 * when all of them can be. By the dump (toolAllows: toolLevels against the harvest level); a block
 * the dump does not know, by the registry's rule with the hand or a pickaxe carried.
 */
function unharvestable(bot, plan) {
    if (bot.game?.gameMode === 'creative') return null;
    const picks = [null, ...(bot.inventory?.items?.() ?? []).filter(i => /pickaxe/.test(i.name)).map(i => i.type)];
    const breakable = (b) => {
        const rule = digRule(b);
        if (rule === null) return true;
        if (rule === false) return false;
        if (rule) return toolAllows(bot, rule);
        return typeof b?.canHarvest !== 'function' || picks.some(t => b.canHarvest(t));
    };
    return plan.dig.map(q => bot.blockAt(q)).find(b => !breakable(b)) ?? null;
}

/** How near a block must be to break it (as breakBlockAt): the higher steps are walked up to. */
const EXIT_REACH = 4.5;
/** The walk of an exit (tests pass their own): never digs, bounded by goToGoal. */
const exitWalk = (bot, goal) => goToGoal(bot, goal, { canDig: false });

/**
 * Soak 4 (rotn-v0.1.7), the lead's morning rule: a hostile mob still within LEAVE_MOB_RANGE of the
 * shelter at full day is waited for at most waitMs (2 min). Then the bot fights it through the wall
 * on its side when it holds a weapon, has fightHealth or more, at most maxFight hostile mobs are
 * near and nothing that explodes, shoots or must be avoided is within dangerRange; else (or below
 * fleeHealth in that fight, or once morningDanger holds during it) it leaves by the side away from
 * the mob and walks awayDist from it. A hole or side-pocket shelter always leaves (its far stairs).
 * capMs: never later than this, it hands back to the agenda. goneMs: a mob out of range for less
 * than this keeps the wait's start (and the cap).
 */
export const MORNING = { waitMs: 2 * 60_000, capMs: 5 * 60_000, fightHealth: 14, fleeHealth: 12, maxFight: 1, dangerRange: 16, awayDist: 16, goneMs: 30_000, capQuietMs: 30_000 };

/**
 * #477 review 2: why the morning fight must not go on (more than maxFight hostile mobs within
 * LEAVE_MOB_RANGE, or a mob that explodes, shoots or must be avoided within dangerRange), or null.
 */
export function morningDanger(bot, site) {
    const c = site.offset(0.5, 0, 0.5);
    const mobs = Object.values(bot.entities ?? {}).filter(e => e && e !== bot.entity && e.position && shelterEnemy(e));
    const near = mobs.filter(e => e.position.distanceTo(c) <= LEAVE_MOB_RANGE);
    const danger = mobs.find(e => e.position.distanceTo(c) <= MORNING.dangerRange && ['avoid', 'keep-distance', 'take-cover'].includes(threatFor(e)?.reaction));
    if (near.length > MORNING.maxFight) return `${near.length} hostile mobs near`;
    if (danger) return `a ${danger.name} near (${threatFor(danger).reaction})`;
    return null;
}

/**
 * The morning choice with a mob near: {action: 'fight'|'leave', why}. pit: a hole or side-pocket shelter.
 * Soak 7 (death 1, A), the lead's rule: a fight only when it is winnable by the numbers
 * (threats.fightOdds: the bot ends it above what the mob may hit for). Until rotn-data publishes
 * the mob's health, its attack interval and our weapon's damage (asked after soak 7), no fight is
 * judged winnable, so the bot leaves by the far side. numbers: tests pass their own.
 */
export function morningChoice(bot, site, { pit = false, numbers = fightNumbers } = {}) {
    const c = site.offset(0.5, 0, 0.5);
    const near = Object.values(bot.entities ?? {}).filter(e => e && e !== bot.entity && e.position && shelterEnemy(e) && e.position.distanceTo(c) <= LEAVE_MOB_RANGE);
    const health = Math.round(bot.health ?? 0);
    // #477 review 1: a hole (or its side pocket) is never opened toward a mob: out by its far stairs.
    if (pit) return { action: 'leave', why: 'a hole shelter' };
    if (!hasWeapon(bot)) return { action: 'leave', why: 'no weapon' };
    if (!(bot.health >= MORNING.fightHealth)) return { action: 'leave', why: `armed, but health ${health}` };
    const danger = morningDanger(bot, site);
    if (danger) return { action: 'leave', why: danger };
    if (near[0] && isPlayerZombie(near[0]) && !canFightHard(bot)) return { action: 'leave', why: 'a player zombie, and no weapon or health at half or less' };
    const odds = fightOdds(numbers(bot, near[0] ?? null), maxHitOf(near[0] ?? null));
    if (!odds.winnable) return { action: 'leave', why: `armed, health ${health}, but ${odds.why}` };
    return { action: 'fight', why: `armed, health ${health}, one ${near[0]?.name ?? 'mob'} near (${odds.why})` };
}

/** The shelter's side facing pos (a mob): the horizontal direction most towards it (x first on a tie). */
export function sideToward(feet, pos) {
    const dx = pos.x - (feet.x + 0.5), dz = pos.z - (feet.z + 0.5);
    return HORIZONTAL.slice().sort((a, b) => (b.x * dx + b.z * dz) - (a.x * dx + a.z * dz))[0];
}

/** Open the shelter's wall (feet and head) on the side toward pos, so a mob there steps into reach. Returns the open cells, or null. */
export async function openToward(bot, feet, pos, { walk = exitWalk } = {}) {
    await stowCarried(bot, (i) => /pickaxe/.test(i.name), { resyncMs: 0 });
    const d = sideToward(feet, pos);
    const cells = [feet.plus(d).offset(0, 1, 0), feet.plus(d)];
    for (const q of cells) {
        if (bot.interrupt_code) return null;
        if (!isEmpty(bot.blockAt(q)) && !await digExitCell(bot, q, walk)) return null;
    }
    if (!cells.every(q => isEmpty(bot.blockAt(q)))) return null;
    console.log(`[night] morning: opened the ${sideName(d)} wall (${cells.map(at).join(' and ')})`);
    return cells;
}

/**
 * The mob's state at the end of the morning grace (soak 4: why it stayed): whether it moved, its
 * health, what it holds and wears on its head, and the sky light where it stands (shade).
 */
export function mobStateLine(bot, mob, first, waitedMs) {
    const moved = first?.pos && mob.position ? mob.position.distanceTo(first.pos) : null;
    const health = Number.isFinite(mob.health) ? mob.health : Number.isFinite(mob.metadata?.[7]) ? mob.metadata[7] : null;
    const eq = Array.isArray(mob.equipment) ? mob.equipment : [];
    const held = mob.heldItem?.name ?? eq[0]?.name ?? 'nothing';
    const helmet = eq[5]?.name ?? 'none';
    let sky = null;
    try { sky = mob.position ? bot.blockAt?.(mob.position.floored?.() ?? mob.position)?.skyLight ?? null : null; } catch { sky = null; }
    // #477 nit: another mob than the first one seen is no "has not moved".
    const other = first?.id != null && mob.id != null && first.id !== mob.id;
    const how = other ? 'is a different mob from the first one' : moved === null ? 'may have moved' : moved < 0.5 ? 'has not moved' : `moved ${Math.round(moved * 10) / 10} blocks`;
    return `[night] morning: after ${Math.round(waitedMs / 1000)} s ${mobText(mob)} ${how}; `
        + `health ${health ?? 'unknown'}, holds ${held}, helmet ${helmet}, sky light ${sky ?? 'unknown'}`;
}

/** Dig one cell of an exit within the per-block limit (#435 review 2, digBudget): true when it is gone or was free. */
async function digExitCell(bot, q, walk) {
    if (isEmpty(bot.blockAt(q))) return true;
    if (bot.entity.position.distanceTo(q) > EXIT_REACH) {
        try { await walk(bot, new pf.goals.GoalNear(q.x, q.y, q.z, 4)); }
        catch (err) { console.log(`[night] dig out: no walk to ${at(q)}: ${err?.message ?? err}`); return false; }
        if (bot.entity.position.distanceTo(q) > EXIT_REACH) return false;
    }
    const block = bot.blockAt(q);
    const { limitMs } = digBudget(bot, block);
    const equip = digEquip(bot, block);
    const dug = await digWithin(bot, block, limitMs, equip ? { equip } : {});
    if (dug === false) console.log(`[night] dig out: could not break ${block.name} at ${at(q)}${equip ? ' (no tool it needs in hand)' : ''}`);
    if (dug === 'timeout') console.log(`[night] dig out: ${block.name} at ${at(q)} was not dug within ${(limitMs / 1000).toFixed(1)} s`);
    return dug === true;
}

/**
 * Open one side of the shelter so the bot can walk out (exitPlan): a side dug by hand first (dirt,
 * G3 round 6 B: it needs no pickaxe, which a bot that died and built its shelter of dirt does not
 * have), then the plan with the fewest blocks; each side's refusal is logged. The opening is
 * checked after digging. A plan with a block the bot cannot harvest is dropped before anything is
 * dug (#435 review 1: the roof stays on), and with no sideways plan left it takes stairs up. A plan
 * that fails after the bot walked up its stairs walks the bot back to feet before anything else
 * (#435 review 4). Returns the side's lower wall position (stairs: the cell at the top), or null.
 * `walk` is for tests.
 */
export async function digOut(bot, feet, { walk = exitWalk, away = null } = {}) {
    // The pickaxe must be where breakBlockAt's equipForBlock looks (#229 review).
    const moved = await stowCarried(bot, (i) => /pickaxe/.test(i.name), { resyncMs: 0 }); // no wait: it is night
    if (moved.length) console.log(`[night] moved ${moved.join(' and ')} back into the inventory to dig out`);
    const plans = [];
    const consider = (plan, d, refused) => {
        const hard = plan.why ? null : unharvestable(bot, plan);
        const why = plan.why ?? (hard ? `no tool to break ${hard.name} at ${at(hard.position)}` : null);
        if (why) console.log(`[night] dig out: ${refused} (${why})`);
        else plans.push({ ...plan, d });
    };
    for (const d of HORIZONTAL) consider(exitPlan(bot, feet, d), d, `not the ${sideName(d)} side`);
    // Soak 2: no sideways exit (a shelter at the bottom of a pit): stairs up.
    if (plans.length === 0) {
        for (const d of HORIZONTAL) consider(stairsUpPlan(bot, feet, d), d, `no stairs up on the ${sideName(d)} side`);
    }
    // Soak 4: away (a mob's position): the side farthest from it first (the morning rule's leave).
    const from = (plan) => (away ? Math.hypot(feet.x + plan.d.x + 0.5 - away.x, feet.z + plan.d.z + 0.5 - away.z) : 0);
    plans.sort((a, b) => (from(b) - from(a)) || (b.byHand - a.byHand) || (a.dig.length - b.dig.length)); // stable: HORIZONTAL order on a tie
    for (const plan of plans) {
        let dug = true;
        for (const q of plan.dig) {
            if (bot.interrupt_code) return null;
            dug = await digExitCell(bot, q, walk);
            if (!dug) break;
        }
        if (dug && plan.dig.every(q => isEmpty(bot.blockAt(q)))) {
            if (plan.how !== 'level') console.log(`[night] dig out: the ${sideName(plan.d)} side (${plan.how === 'step' ? 'a step up' : plan.how === 'stairs' ? `stairs up, ${plan.steps} steps` : 'a tunnel'}, ${plan.dig.length} blocks)`);
            return plan.how === 'stairs' ? plan.exit : feet.plus(plan.d); // stairs: the cell at the top
        }
        console.log(`[night] dig out: could not open the ${sideName(plan.d)} side`);
        // #435 review 4: a failed plan does not leave the bot part-way up its stairs: the next plan,
        // and the next try, start from the shelter's cell, which is where the night routine looks.
        if (!bot.entity.position.floored().equals(feet)) {
            try { await walk(bot, new pf.goals.GoalBlock(feet.x, feet.y, feet.z)); } catch { /* checked below */ }
            if (!bot.entity.position.floored().equals(feet)) {
                console.log(`[night] dig out: could not get back to ${at(feet)} after a failed way out (now at ${exactAt(bot)})`);
                return null;
            }
        }
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

const key3 = (p) => `${p.x},${p.y},${p.z}`;

/**
 * Soak 5 (death 4): the nearest mob within the in-shelter fight's reach of the bot (inShelterReach)
 * that `which` accepts (default: a melee mob, threats.shelterTarget), or null: one that hits the bot
 * through an opening without standing in it.
 */
export function mobInReach(bot, which = shelterTarget) {
    const here = bot?.entity?.position;
    if (!here) return null;
    let best = null, bestD = Infinity;
    for (const e of Object.values(bot.entities ?? {})) {
        if (!e || e === bot.entity || !e.position || !which(e) || !inShelterReach(bot, e)) continue;
        const d = e.position.distanceTo(here);
        if (d < bestD) { best = e; bestD = d; }
    }
    return best;
}

/** #497 review 1: a threat the shelter never hits (avoid, keep-distance, take-cover: a troll, a creeper, a skeleton). */
export const notMelee = (e) => shelterEnemy(e) && !shelterTarget(e);

/** "a zombie", "an iceandfire:if_troll" (#497 review 6). */
const aMob = (name) => `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;

/** "a zombie at x, y, z" for hostileNear's mob (tests' ops may return just true). */
const mobText = (e) => e?.position ? `a ${e.name ?? e.displayName ?? 'hostile mob'} at ${at(e.position.floored())}` : 'a hostile mob';

/**
 * Soak 7 (death 1, C): the zombie walked through the opened wall into the bot's cell, the bot fell
 * below MORNING.fleeHealth, and the morning rule "left by the side away from it": there is no side
 * away from a mob in the bot's own cell, and the bot stood still, hit from 11 to 0. The nearest
 * hostile mob whose body is in the bot's two cells (inCell), or, while the shelter is open toward
 * it (exposed), a melee mob within its reach (threats.inMeleeReach), as {mob, inCell, d}; else null.
 */
export function closeMob(bot, site, { exposed = true } = {}) {
    const here = bot?.entity?.position;
    if (!here || !site) return null;
    const cells = [site, site.offset(0, 1, 0)];
    let best = null;
    for (const e of Object.values(bot.entities ?? {})) {
        if (!e || e === bot.entity || !e.position || !shelterEnemy(e)) continue;
        const inCell = cells.some(c => Math.floor(e.position.x) === c.x && Math.floor(e.position.z) === c.z
            && e.position.y > c.y - (e.height ?? 1.8) && e.position.y < c.y + 1); // as shelter.js mobIn
        if (!inCell && !(exposed && shelterTarget(e) && inMeleeReach(bot, e))) continue;
        const d = e.position.distanceTo(here);
        if (!best || d < best.d) best = { mob: e, inCell, d };
    }
    return best;
}

/** Soak 7 (C): a burrow away from a mob in reach: at most this many steps, until its reach + margin. */
export const CLOSE = { burrowSteps: 3, margin: 0.5 };

/** The bot moved out of n.site (a burrow): its new cell is the shelter, held or repaired there. */
function burrowedInto(bot, n, ops) {
    const here = bot.entity.position.floored();
    if (!n.site || here.equals(n.site)) return here;
    // #507 review 3: pitOut assumes the hole's 3 below the surface; after a burrow that changed
    // the bot's level, the morning digs out with digOut from where it is.
    if (here.y !== n.site.y) n.pit = false;
    n.site = here;
    n.repairStall = null;
    n.checkedAt = null;
    n.pocketTried = true; // the hole's side pocket is no longer under the bot's roof
    n.closedOn = { at: exactAt(bot), floor: bot.blockAt?.(here.offset(0, -1, 0))?.name ?? 'unknown' };
    const still = ops.siteNeeds(bot, n.site, { accept: isWall, occupied: true, tolerateBody: n.tolerated });
    bot.rotnSheltered = still && still.todo.length === 0 ? true : 'open';
    return here;
}

/** closeMob for the shelter now: {close, todo}, with the shelter's open cells (exposed when any, or when 'open'). */
function closeNow(bot, n, ops) {
    const need = ops.siteNeeds(bot, n.site, { accept: isWall, occupied: true, tolerateBody: n.tolerated });
    const todo = need?.todo ?? [];
    return { close: (ops.closeMob ?? closeMob)(bot, n.site, { exposed: bot.rotnSheltered === 'open' || todo.length > 0 }), todo };
}

/**
 * #514 review 2: MORNING.capMs never hands back with a mob in the bot's cell or in reach (closeNow):
 * the bot stays sheltered (handFight kept) and the hand-back waits until the mob is gone.
 * #514 re-review: not without end: a mob that is not in the bot's cell and has not hurt it for
 * MORNING.capQuietMs (threats.hurtingInReach) lets the far-side leave go ahead; never past a mob in
 * the cell. Returns 'night:inside' while it holds, 'release' when the leave may go ahead, null when
 * no mob is in the cell or in reach.
 */
function holdPastCap(agent, n, ops) {
    const bot = agent.bot;
    const { close } = closeNow(bot, n, ops);
    if (!close) return null;
    const name = aMob(close.mob.name ?? 'hostile mob');
    if (!close.inCell && !hurtingInReach(bot, close.mob, Date.now(), MORNING.capQuietMs)) {
        const text = `[night] morning: ${MORNING.capMs / 60_000} min are up and ${name} ${close.d.toFixed(1)} blocks away has not hurt the bot for ${MORNING.capQuietMs / 1000} s: leaving by the side away from it`;
        if (n.capReleaseSaid) console.log(text); else { n.capReleaseSaid = true; line(agent, text); }
        return 'release';
    }
    const text = `[night] morning: ${MORNING.capMs / 60_000} min are up, but ${name} is still ${close.inCell ? 'in the bot\'s cell' : 'in reach and hurt the bot within ' + MORNING.capQuietMs / 1000 + ' s'} at ${at(n.site)}: staying sheltered until it is gone`;
    if (n.capHeldSaid) console.log(text); else { n.capHeldSaid = true; line(agent, text); }
    return 'night:inside';
}

/**
 * Soak 7 (C), the lead's order, before the morning leaves with a mob in the bot's cell or in reach
 * of it through an opening (closeMob): (i) the shelter's open cells hold no body: close them again
 * (the repair); (ii) a melee mob, armed, and health above what it may hit for (maxHitOf): fight on
 * from the shelter (self_defense); (iii) burrow away from it, a step down first (once per mob);
 * (iv) a melee mob and no burrow step: hit back (handFight). A mob that is no melee mob with no seal
 * or burrow: the leave as before. Returns the tick's result while it holds the bot, else null.
 */
/**
 * #517 review: before the past-cap leave (holdPastCap 'release'), shelter cells still open toward
 * the quiet mob and held by no body get one more re-seal; the leave then goes from a closed shelter.
 * A cell a body holds, or a re-seal that fails, is said: the bot leaves with the opening open.
 * Returns the tick's result while the re-seal runs, else null.
 */
function capSeal(agent, n, ops) {
    if (n.capSealTried) return null;
    const bot = agent.bot;
    const { todo } = closeNow(bot, n, ops);
    if (!todo.length) return null;
    n.capSealTried = true;
    const cells = todo.map(at).join('; ');
    const held = ops.heldCells?.(bot, n.site, todo) ?? [];
    if (held.length) {
        line(agent, `[night] morning: the opening at ${cells} stays open (${aMob(held[0].mob?.name ?? 'hostile mob')} holds it); leaving anyway`);
        return null;
    }
    line(agent, `[night] morning: closing the opening at ${cells} before leaving`);
    startJob(agent, n, REPAIR_LABEL, () => ops.buildShelter(bot, { site: n.site, keepSoft: true, tolerateBody: n.tolerated }), (r) => {
        if (r?.closed) { bot.rotnSheltered = true; console.log(`[night] morning: the shelter at ${at(n.site)} is closed again`); return; }
        line(agent, `[night] morning: the opening at ${cells} did not close (${r?.line ?? 'no result'}); leaving with it open`);
    });
    return 'night:inside';
}

function closeQuarters(agent, n, ops) {
    const bot = agent.bot;
    const { close, todo } = closeNow(bot, n, ops);
    if (!close) { n.handFight = false; return null; }
    const { mob, inCell } = close;
    const name = mob.name ?? 'hostile mob';
    const health = Math.round(bot.health ?? 0);
    const said = (k, text) => { if (n.closeSaid === k) console.log(text); else { n.closeSaid = k; line(agent, text); } };
    const lead = `[night] morning: ${aMob(name)} ${inCell ? `in the bot's cell at ${at(n.site)}` : `${close.d.toFixed(1)} blocks away, in its reach`}: not leaving past it`;
    const held = todo.length ? (ops.heldCells?.(bot, n.site, todo) ?? []) : [];
    // #514 review 1: the re-seal is tried once per mob and opening; a failed one (no blocks, a
    // placement that fails) falls through to (ii)-(iv), so the repair does not hold the fight off.
    const sealKey = `${mob.id ?? name}:${todo.map(key3).join(';')}`;
    if (todo.length && !held.length && !inCell && n.closeSealTried !== sealKey) {
        n.closeSealTried = sealKey;
        said(`seal:${todo.map(key3).join(';')}`, `${lead}; closing the shelter again at ${todo.map(at).join('; ')}`);
        startJob(agent, n, REPAIR_LABEL, () => ops.buildShelter(bot, { site: n.site, keepSoft: true, tolerateBody: n.tolerated }), (r) => {
            if (r?.closed) { bot.rotnSheltered = true; n.handFight = false; console.log(`[night] morning: the shelter at ${at(n.site)} is closed again`); }
        });
        return 'night:inside';
    }
    const melee = shelterTarget(mob);
    const armed = (ops.hasWeapon ?? hasWeapon)(bot);
    const max = maxHitOf(mob);
    if (melee && armed && Number.isFinite(bot.health) && bot.health > max) {
        n.handFight = false;
        if (bot.rotnSheltered !== true) bot.rotnSheltered = 'open';
        said(`fight:${mob.id}`, `${lead}; armed, health ${health} above the ${max} it may hit for: fighting it from the shelter`);
        return 'night:inside';
    }
    if (ops.burrowAway && n.closeBurrowTried !== (mob.id ?? name)) {
        n.closeBurrowTried = mob.id ?? name;
        said(`burrow:${mob.id}`, `${lead}; ${armed ? '' : 'no weapon, '}health ${health}, and it may hit for ${max}: burrowing away from it (a step down first)`);
        const stopAt = meleeReach(mob) + CLOSE.margin;
        startJob(agent, n, BURROW_LABEL, () => ops.burrowAway(bot, mob, { maxSteps: CLOSE.burrowSteps, stopAt, prefer: 'down' }), (r) => {
            const here = burrowedInto(bot, n, ops);
            const steps = r?.steps ?? 0;
            n.closeBurrowWhy = r?.why ?? null;
            const moved = steps ? `burrowed ${steps} step${steps === 1 ? '' : 's'} into ${at(here)}` : `did not burrow (still at ${at(here)})`;
            const end = r?.stopped === 'far' ? 'out of its reach; sealed behind' : r?.stopped === 'gone' ? `${aMob(name)} is gone` : (r?.why ?? r?.stopped ?? 'no result');
            line(agent, `[night] morning: ${moved}: ${end}`);
        });
        return 'night:inside';
    }
    if (melee) {
        n.handFight = true;
        if (bot.rotnSheltered !== true) bot.rotnSheltered = 'open';
        said(`hand:${mob.id}`, `${lead}; ${armed ? '' : 'no weapon, '}health ${health}, and no burrow step${n.closeBurrowWhy ? ` (${n.closeBurrowWhy})` : ''}: ${armed ? 'hitting back' : 'hitting back by hand'}`);
        return 'night:inside';
    }
    n.handFight = false;
    return null;
}

/** What the routine does in the world (tests pass their own). */
export const NIGHT_OPS = { buildShelter, digOut, siteNeeds, siteProblem, clearSpace, hostileNear, digPit, pitOut, onTree: standsOnTree, descend: (bot) => descendFromTree(bot),
    groundPlan, walkToGround, stepToDry, // soak 8: better ground when there is no place
    escape: (bot) => escape(bot), // soak 8: out of a flooded pit first
    nightRelocation: nightRelocationPlan, walkAwayAtNight, morningChoice, openToward,
    escapedRecently, scrollRefusal, useSpawnScroll, // soak 10 (R2, R6)
    // #497 review 2: away from every threat; cornered, it may hit a melee mob only, never a troll or a creeper.
    awayFromMobs: (bot) => avoidEnemies(bot, MORNING.awayDist, shelterEnemy, shelterTarget),
    heldCells, retreatPlan, backAway, hasWeapon, mobInReach, dangerInReach: (bot) => mobInReach(bot, notMelee),
    burrowThreat, burrowAway };

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
    progress.why = null;
    progress.noPlace = false;
    const feet = await ops.digPit(bot, { progress });
    // #431 review 4: a dig that timed out says so (not "no place"). Soak 8: noPlace, no cell for a hole.
    if (!feet) return { closed: false, feet: null, line: progress.why ?? 'found no place to dig a hole shelter', noPlace: !!progress.noPlace };
    return ops.buildShelter(bot, { site: feet, keepSoft: true });
}

/** The bot is at (or next to) cell c. */
function nearCell(bot, c) {
    const p = bot.entity?.position?.floored?.();
    return !!p && !!c && Math.abs(p.x - c.x) <= 1 && Math.abs(p.y - c.y) <= 1 && Math.abs(p.z - c.z) <= 1;
}

/** The bot is at (or next to) the cell where no place was found (soak 8: no retry from there). */
function atNoPlaceCell(bot, n) {
    return nearCell(bot, n.noPlaceCell);
}

/**
 * Exposed until morning: the bot's normal reflexes; with no weapon it keeps away from mobs (cowardice).
 * text: why, said with what the bot does (#337 review 7).
 */
function goExposed(agent, n, text) {
    const bot = agent.bot;
    n.state = 'exposed';
    n.quietSince = null;
    if (n.leaveFrom && bot.rotnSheltered === 'open') bot.rotnSheltered = false; // no shelter: the normal rules
    n.leaveFrom = null;
    const away = keepAwayIfUnarmed(agent, n);
    line(agent, `[night] ${text}; ${away ? 'no weapon: keeping away from mobs until morning' : 'staying here until morning'}`);
}

/**
 * Soak 8 (night 2), the lead's (b): no place for a shelter or a hole here. Look for better ground
 * (shelter_ground.groundPlan: the last shelter, else the best place within GROUND.radius, 12 at night
 * with no weapon) and walk there, at most GROUND.maxMoves walks a night; the shelter tries then start
 * again where the walk ended. The search is async (#557 review 3), so it runs in the job with the walk.
 * onNone(text): no place to walk to (text: why, for the line). Returns 'started', or 'spent' (no
 * walks left, or the ops have none).
 */
function moveToGround(agent, n, ops, phase, refused, onNone) {
    const bot = agent.bot;
    if (!ops.groundPlan || !ops.walkToGround || (n.groundMoves ?? 0) >= GROUND.maxMoves) return 'spent';
    const armed = (ops.hasWeapon ?? hasWeapon)(bot);
    const radius = phase === 'night' && !armed ? GROUND.unarmedRadius : GROUND.radius;
    n.groundRadius = radius;
    // #557 review 4: a walk planned at dusk (24 blocks) stops at 12 once night falls and there is no weapon.
    const shortNow = () => { const tn = n.clock.timeOfDay(Date.now()); return tn !== null && nightPhase(tn) === 'night' && !(ops.hasWeapon ?? hasWeapon)(bot); };
    const report = {};
    let plan = null, from = null;
    startJob(agent, n, GROUND_LABEL, async () => {
        plan = await ops.groundPlan(bot, { radius, lastShelter: n.lastShelter ?? null, skip: n.groundSkip ?? [], report });
        from = bot.entity?.position?.clone?.() ?? null;
        if (!plan) return null;
        n.groundMoves = (n.groundMoves ?? 0) + 1;
        line(agent, `[night] no place for a shelter or a hole here${refused ? ` (${refused})` : ''}; walking to ${at(plan.feet)}: ${planText(plan)}, ${Math.round(plan.d)} blocks away (walk ${n.groundMoves} of ${GROUND.maxMoves})`);
        return ops.walkToGround(bot, plan, { shortNow });
    }, (r, ret) => {
        if (!plan) {
            // #557 review 1: "none" only when there is none; places left out for a mob ahead are said so.
            onNone(ret?.interrupted ? 'and the search for better ground was interrupted'
                : report.mobSkipped > 0 ? `and the places within ${radius} blocks have ${aMob(report.mob ?? 'hostile mob')} ahead on the way (${report.mobSkipped} left out)`
                    : `and none within ${radius} blocks`);
            return;
        }
        const here = bot.entity?.position?.floored?.();
        // #557 review 5: a place is not chosen again once reached (if no shelter fits there after all,
        // the next search looks elsewhere), nor (#557 nit) after a walk that failed with no stop reason
        // (no way there); one a mob, the night, the time limit or a reflex cut short may be.
        if (r?.arrived || (!ret?.interrupted && !r?.stopped)) n.groundSkip = [...(n.groundSkip ?? []), plan.feet];
        const how = r?.arrived ? 'got there'
            : ret?.interrupted ? 'was interrupted'
                : r?.stopped === 'hostile' ? `stopped: ${aMob(r.mob ?? 'hostile mob')} came within ${GROUND.stopRange} blocks`
                    : r?.stopped === 'night' ? `stopped after ${GROUND.unarmedRadius} blocks: night fell, and no weapon`
                        : r?.stopped === 'time' ? `ran out of time (${GROUND.walkMs / 1000} s)`
                            : `did not get there${r?.why ? ` (${r.why})` : ''}`;
        console.log(`[night] the walk to better ground ${how}; sheltering from ${here ? at(here) : 'here'}`);
        // Soak 8, the flooded pit: a walk that found no way (it ended where it began, or in the
        // water; not one a mob, the night or a reflex stopped) gets the escape first.
        const noWay = !r?.arrived && !ret?.interrupted && !['hostile', 'night'].includes(r?.stopped)
            && (inWater(bot) || (!!from && !!bot.entity?.position && from.distanceTo(bot.entity.position) < 1.5));
        if (noWay && tryEscape(agent, n, ops, 'the walk to better ground found no way out', () => buildAgain(n))) return;
        buildAgain(n);
    });
    return 'started';
}

/** The tries (and a hole) start again from where the bot is now (after a walk or an escape). */
function buildAgain(n) {
    startBuilding(n, 0);
    Object.assign(n, { pitTried: false, pitNext: false, pitProgress: {}, buildNoPlace: false, buildRefused: null, pitNoPlace: false, noPlaceCell: null, sameCellSaid: false });
}

/**
 * Soak 8 (the flooded pit), the lead's escape plan: out of a pit or the water first (library/
 * escape.js), at most NIGHT_ESCAPES a night. then(result) runs after it. False when none is left.
 */
function tryEscape(agent, n, ops, why, then) {
    if (!ops.escape || (n.escapes ?? 0) >= NIGHT_ESCAPES) return false;
    n.escapes = (n.escapes ?? 0) + 1;
    const bot = agent.bot;
    line(agent, `[night] ${why}: getting out first (escape ${n.escapes} of ${NIGHT_ESCAPES})`);
    startJob(agent, n, ESCAPE_LABEL, () => ops.escape(bot), (r) => {
        console.log(`[night] the escape ${r?.out ? `got out at ${at(r.at)}` : `failed (${r?.why ?? 'no result'})`}`);
        then(r);
    });
    return true;
}

/**
 * The lead's (c): no better ground (or no walks left): out of the water to the nearest dry ground
 * (shelter_ground.stepToDry), then exposed there; the quiet retries are not made from that cell.
 */
function exposeOnDryGround(agent, n, ops, why) {
    const bot = agent.bot;
    const finish = (r) => {
        n.noPlaceCell = bot.entity?.position?.floored?.() ?? null;
        n.sameCellSaid = false;
        const where = r?.moved && r?.dry ? `out of the water at ${at(r.at)}; `
            : r && !r.dry ? `still in the water (${r.why}); ` : '';
        goExposed(agent, n, `no shelter: ${why}; ${where}no retry from this spot`);
    };
    if (!ops.stepToDry) { finish(null); return; }
    startJob(agent, n, DRY_LABEL, () => ops.stepToDry(bot), (r) => {
        // Soak 8, the flooded pit: still in the water: the escape first; out, the tries start again there.
        if (r && !r.dry && tryEscape(agent, n, ops, `could not get out of the water (${r.why})`, (e) => (e?.out ? buildAgain(n) : finish(r)))) return;
        finish(r);
    });
}

function line(agent, text) {
    console.log(text);
    say(agent, text);
}

function startBuilding(n, now) {
    n.state = 'building';
    n.attempts = 0;
    n.unsettled = 0;
    n.interrupts = 0;
    n.threatInterrupts = 0;
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
        // G4 #5: the night's food, in the journal. Never out for food at night: the bot stays sealed.
        const held = heldFoodHunger(bot);
        console.log(`[night] food for the night: food worth ${held} hunger held, food ${Number.isFinite(bot.food) ? bot.food : 'unknown'}; `
            + (held >= FOOD_TARGET.dusk ? 'enough' : `less than ${FOOD_TARGET.dusk}: staying sealed anyway (never out for food at night)`));
        n.exposedRetries = 0;
        startBuilding(n, now);
    }

    if (isFullDay(t) && n.state !== 'inside') {
        // Morning came before a shelter did (or the bot was exposed): back to work.
        bot.rotnSheltered = false;
        // #479 nit 3: where the night was spent stands in for the last shelter (the standing goal).
        const spent = n.site ?? bot.entity?.position?.floored?.();
        if (spent) n.lastShelter = spent.clone?.() ?? spent;
        n.state = 'day';
        restoreCowardice(agent, n);
        Object.assign(n, { pitTried: false, leftDeathSpot: false, escapeSeen: false, relocTries: 0, relocPending: false, relocWaitUntil: null, descended: false, pitProgress: {}, leaveFrom: null, burrowSteps: 0, burrowNoneAt: null, ...GROUND_CLEAR, groundSkip: [] });
        line(agent, '[night] morning: back to work');
        return null;
    }
    holdAutonomy(agent);

    // #431 review 2: exposed (no shelter after the tries, often because fights kept stopping the
    // build): once no hostile mob has been within QUIET_RANGE for EXPOSED_RETRY_MS, a fresh try
    // (the builds and a hole), at most EXPOSED_RETRIES times a night.
    if (n.state === 'exposed' && (n.exposedRetries ?? 0) < EXPOSED_RETRIES) {
        if (ops.hostileNear?.(bot, QUIET_RANGE)) n.quietSince = null;
        else {
            n.quietSince ??= now;
            if (now - n.quietSince >= EXPOSED_RETRY_MS && atNoPlaceCell(bot, n)) {
                // Soak 8, the lead's (c): never again from the spot where no place was found; better
                // ground instead, while walks are left (GROUND.maxMoves).
                n.quietSince = null;
                const here = at(bot.entity.position.floored());
                if ((n.groundMoves ?? 0) < GROUND.maxMoves && ops.groundPlan) {
                    n.exposedRetries = (n.exposedRetries ?? 0) + 1;
                    line(agent, `[night] quiet for ${EXPOSED_RETRY_MS / 1000} s: looking for better ground again (${n.exposedRetries} of ${EXPOSED_RETRIES})`);
                    restoreCowardice(agent, n);
                    moveToGround(agent, n, ops, phase, null, (text) => {
                        keepAwayIfUnarmed(agent, n);
                        console.log(`[night] no better ground: no place here, ${text}; not trying again from ${here}`);
                    });
                    return 'night:exposed';
                } else if (!n.sameCellSaid) {
                    n.sameCellSaid = true;
                    console.log(`[night] quiet, but there is no place for a shelter here and no walk to better ground left tonight; not trying again from ${here}`);
                }
            } else if (now - n.quietSince >= EXPOSED_RETRY_MS) {
                n.exposedRetries = (n.exposedRetries ?? 0) + 1;
                n.quietSince = null;
                Object.assign(n, { pitTried: false, pitNext: false });
                restoreCowardice(agent, n);
                line(agent, `[night] quiet for ${EXPOSED_RETRY_MS / 1000} s: trying a shelter again (${n.exposedRetries} of ${EXPOSED_RETRIES})`);
                startBuilding(n, now);
            }
        }
    }

    if (n.state === 'building') {
        // CX23 soak (rotn-v0.1.3): respawned in a canopy, every shelter and hole try failed there
        // (leaves under every site). Down to the ground first, once per build phase.
        if (!n.descended && ops.onTree?.(bot)) {
            n.descended = true;
            line(agent, '[night] up on a tree: climbing down before sheltering');
            startJob(agent, n, 'action:descendFromTree', () => ops.descend(bot), (down) => {
                // Soak 5 (00:47): the journal said nothing about why; the descent's last refusal now.
                if (!down) console.warn(`[night] still on the tree${bot.rotnTreeWhy ? ` (${bot.rotnTreeWhy})` : ''}; sheltering from here`);
                n.nextAt = 0;
            });
            return 'night:building';
        }
        // Soak 10 (R2, the lead): right after the respawn escape (respawn_escape.js), the shelter goes
        // where it ended, a hole first (it needs no blocks; the bot lost them at its death), and there
        // is no walk back toward the death spots. Once per build phase.
        if (!n.escapeSeen && ops.escapedRecently?.(agent, now)) {
            n.escapeSeen = true;
            n.leftDeathSpot = true;
            if (!n.pitTried && ops.digPit) { n.pitTried = true; n.pitNext = true; n.nextAt = 0; }
            line(agent, `[night] after the respawn escape: sheltering here at ${at(bot.entity.position.floored())}${n.pitNext ? ', a hole first' : ''}`);
        }
        // Round 9 B (fix h), soak 3 (the lead's C): after a recent death, first away from the spawn and
        // every recent death spot (respawn_relocate.nightRelocationPlan: 48 blocks; with a mob near the
        // way, or no weapon at night, to the first spot 24 blocks from every death spot). A walk a
        // reflex cut short is tried again NIGHT_RELOCATE.waitMs later, NIGHT_RELOCATE.tries walks in all.
        if (!n.leftDeathSpot && ops.nightRelocation) {
            if (n.relocPending) { n.relocPending = false; n.relocWaitUntil = now + NIGHT_RELOCATE.waitMs; }
            if (n.relocWaitUntil != null && now < n.relocWaitUntil) return 'night:building';
            n.relocWaitUntil = null;
            const plan = ops.nightRelocation(agent, now, { night: phase === 'night', armed: (ops.hasWeapon ?? hasWeapon)(bot) });
            if (!plan) n.leftDeathSpot = true;
            else {
                n.relocTries = (n.relocTries ?? 0) + 1;
                const tries = NIGHT_RELOCATE.tries;
                line(agent, `${plan.line}${n.relocTries > 1 ? ` (walk ${n.relocTries} of ${tries})` : ''}`);
                // #471 nit 2: night may fall during a walk that began at dusk.
                const shortNow = () => { const tn = n.clock.timeOfDay(Date.now()); return tn !== null && nightPhase(tn) === 'night' && !(ops.hasWeapon ?? hasWeapon)(bot); };
                startJob(agent, n, 'action:leaveDeathSpot', () => ops.walkAwayAtNight(bot, plan, { shortNow }), (r, ret) => {
                    n.nextAt = 0;
                    const far = `${Math.round(r?.nearest ?? 0)} blocks`;
                    if (ret?.interrupted && !r?.arrived && n.relocTries < tries) {
                        n.relocPending = true;
                        console.log(`[night] the walk away was interrupted at ${far} (walk ${n.relocTries} of ${tries}); trying again in ${NIGHT_RELOCATE.waitMs / 1000} s`);
                        return;
                    }
                    n.leftDeathSpot = true;
                    if (r?.arrived) console.log(`[night] the walk away is done: ${far} from the places left${r.stopped === 'hostile' ? ' (stopped early: a hostile mob came near)' : r.stopped === 'night' ? ' (stopped early: night fell, and no weapon)' : ''}; sheltering here`);
                    else if (r?.stopped === 'time') console.warn(`[night] the walk away ran out of time at ${far} from the places left; sheltering here`);
                    else if (ret?.interrupted) console.warn(`[night] the walk away was interrupted ${tries} times (${far} from the places left); sheltering here`);
                    else console.warn(`[night] the walk away did not get there (${far} from the places left); sheltering here`);
                });
                return 'night:building';
            }
        }
        if (n.nextAt === null) n.nextAt = now + RETRY_MS;
        if (now < n.nextAt) return 'night:building';
        const pit = n.pitNext;
        const label = pit ? 'action:digPit' : 'action:buildShelter';
        startJob(agent, n, label, () => (pit ? pitShelter(bot, ops, n.pitProgress) : ops.buildShelter(bot)), (r, ret) => {
            if (r?.closed) {
                n.unsettled = 0;
                n.pitNext = false;
                n.state = 'inside';
                n.site = r.feet;
                n.pit = pit;
                n.digAt = null; // digging seen at an earlier shelter is not this one's
                n.repairStall = null;
                Object.assign(n, { clears: [], tolerated: false, clearSaid: false, leaveFrom: null, backedAway: false, holdSaid: null, handSaid: null, handFight: false, pocketTried: false, scrollTried: false });
                n.checkedAt = null; // set by the next tick, on its clock
                bot.rotnSheltered = true;
                // Gate2 B: where the bot was and what it stood on, for the line if it is ever out of it.
                n.closedOn = { at: exactAt(bot), floor: bot.blockAt?.(r.feet.offset(0, -1, 0))?.name ?? 'unknown' };
                line(agent, `[night] in the shelter at ${at(r.feet)} until morning`);
                return;
            }
            // #431 review 2: by a threat reflex (THREAT_INTERRUPTS) or by anything else (FREE_INTERRUPTS).
            const stopper = ret?.interrupted && agent.rotnLastInterrupt?.of === label ? agent.rotnLastInterrupt.by : null;
            const threat = THREAT_MODES.includes(stopper);
            const counter = threat ? 'threatInterrupts' : 'interrupts';
            const bound = threat ? THREAT_INTERRUPTS : FREE_INTERRUPTS;
            if (ret?.interrupted && (n[counter] ?? 0) < bound) {
                // A reflex or a command stopped it: not a try; build again once it is done. A hole
                // stays next (#337 review 6), and its dig goes on in the same hole (pitProgress).
                // Soak 2: only so many of them per build phase; later ones count (below).
                n[counter] = (n[counter] ?? 0) + 1;
                n.nextAt = 0;
                console.log(`[night] the ${pit ? 'hole shelter' : 'shelter build'} was interrupted${stopper ? ` by ${stopper}` : ''}; it does not count as a try (${n[counter]} of ${bound}${threat ? ' by a threat reflex' : ''})`);
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
            const why = ret?.interrupted ? `interrupted again (more than ${bound} times${threat ? ' by a threat reflex' : ''})` : (r?.line ?? 'the build ended without a result');
            // #337 review 8: the tries are the shelter builds (BUILD_ATTEMPTS); the hole is one more,
            // once a night, right after the first failed build, and it is not counted.
            if (!pit) n.attempts++;
            // Soak 8: the build found no place at all (not too few blocks, not stopped), and what refused the sites.
            if (!pit) Object.assign(n, { buildNoPlace: !ret?.interrupted && !!r?.noPlace, buildRefused: r?.refused ?? null });
            // #557 nit: a hole's "no place" holds only where it was found. Once the bot has moved since
            // (a fight, a flee), it no longer counts, and the hole may be tried again from here.
            if (!pit && n.pitNoPlace && !nearCell(bot, n.pitNoPlaceAt)) {
                Object.assign(n, { pitNoPlace: false, pitTried: false });
                console.log(`[night] the bot has moved since the hole found no place (at ${at(n.pitNoPlaceAt)}): a hole may be dug here`);
            }
            // Round 9 B (fix h): a shelter that could not be built is followed by a hole; it needs
            // nothing in the inventory.
            if (!pit && !n.pitTried && ops.digPit) {
                n.pitTried = true;
                n.pitNext = true;
                n.nextAt = 0;
                console.warn(`[night] shelter try ${n.attempts} of ${BUILD_ATTEMPTS} failed (${why}); digging a hole shelter instead`);
                return;
            }
            // Soak 8 (night 2), the lead's (b) and (c): no place for a shelter here and none for a hole
            // (the hole comes right after the first build; without one, the build alone): the same
            // tries from the same spot cannot do better. Better ground, else out of the water and exposed.
            // #557 review 7: both must have looked and found nothing. A build that was stopped (a
            // reflex, counted once past FREE_INTERRUPTS) never searched, so a hole that finds no place
            // after it is not enough: the tries go on, and the next build that finds no place walks
            // (pitNoPlace). An interrupted hole never counts as no place either.
            if (pit) Object.assign(n, { pitNoPlace: !ret?.interrupted && !!r?.noPlace, pitNoPlaceAt: bot.entity?.position?.floored?.() ?? null });
            if (!ret?.interrupted && r?.noPlace && (pit ? n.buildNoPlace : (!ops.digPit || n.pitNoPlace))) {
                if (pit) console.warn(`[night] the hole shelter failed (${why})`);
                const refused = n.buildRefused ?? r?.refused ?? null;
                const here = `no place for a shelter or a hole here${refused ? ` (${refused})` : ''}`;
                const moved = moveToGround(agent, n, ops, phase, refused, (text) => exposeOnDryGround(agent, n, ops, `${here}, ${text}`));
                if (moved === 'spent') exposeOnDryGround(agent, n, ops, `${here}, and no walk to better ground left tonight (${n.groundMoves ?? 0} of ${GROUND.maxMoves} made)`);
                return;
            }
            if (n.attempts >= BUILD_ATTEMPTS) {
                // #337 review 7: the line says what the bot does.
                const tries = `${n.attempts} tries${n.pitTried ? ' and a hole shelter' : ''}`;
                goExposed(agent, n, `no shelter after ${tries} (${why})`);
            } else {
                n.nextAt = null; // the next tick waits RETRY_MS from its own clock
                // The hole is not a counted try (#337 review 8; the lead, soak 8).
                console.warn(pit ? `[night] the hole shelter failed (${why})` : `[night] shelter try ${n.attempts} of ${BUILD_ATTEMPTS} failed (${why})`);
            }
        });
        return 'night:building';
    }

    if (n.state === 'inside') {
        // Soak 10 (R6, the lead): the Scroll of New Life sets the respawn point where the bot stands; a
        // death within 32 blocks of it then raises no player zombie. Used once, by skill (never the
        // model), at a closed night shelter far from the spawn and every death spot, with no hostile near.
        if (!isFullDay(t) && !n.scrollTried && n.site && bot.rotnSheltered === true && ops.useSpawnScroll && ops.scrollRefusal) {
            n.scrollTried = true;
            const why = ops.scrollRefusal(agent, n.site);
            if (why) console.log(`[night] the Scroll of New Life is not used at ${at(n.site)}: ${why}`);
            else {
                line(agent, `[night] setting the respawn point here at ${at(n.site)} with the Scroll of New Life (once): far from the spawn and every death spot, no hostile near`);
                startJob(agent, n, SCROLL_LABEL, () => ops.useSpawnScroll(bot), (r) => {
                    line(agent, r?.used ? `[night] the respawn point is now ${at(n.site)}: a death within 32 blocks of it raises no player zombie`
                        : `[night] the Scroll of New Life was not used (${r?.why ?? 'no result'})`);
                });
                return 'night:inside';
            }
        }
        // Round 10 B: a shelter with no way out is not left as 'day' with the bot still walled in:
        // digOut is tried again RETRY_MS later, EXIT_TRIES times, then the bot hands back. Between
        // tries the shelter's checks below run as at night (#364 review 4: breaches, the dig alarm).
        const waiting = n.exitAt != null && now < n.exitAt;
        const walkedOut = n.exitAt != null && !bot.entity.position.floored().equals(n.site);
        if (isFullDay(t) && (!waiting || walkedOut)) {
            const handBack = (text) => {
                bot.rotnSheltered = false;
                if (n.site) n.lastShelter = n.site.clone?.() ?? n.site; // #478: the standing goal explores near it
                n.state = 'day';
                n.site = null;
                Object.assign(n, { pit: false, pitTried: false, leftDeathSpot: false, escapeSeen: false, relocTries: 0, relocPending: false, relocWaitUntil: null, pitProgress: {}, exitTries: 0, exitAt: null, exitLeftAt: null, mobSince: null, mobSaid: false,
                    burrowSteps: 0, burrowNoneAt: null, ...MORNING_CLEAR });
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
                // #435 review 4: a failed way out that could not walk the bot back is no way out.
                const stranded = n.exitLeftAt && bot.entity.position.floored().equals(n.exitLeftAt);
                handBack(stranded
                    ? `[night] morning: a way out of the shelter at ${at(n.site)} failed part-way and the bot is at ${at(n.exitLeftAt)}; back to work, maybe still enclosed: dig a way out`
                    : `[night] morning: out of the shelter at ${at(n.site)}; back to work`);
                return null;
            }
            // #364 review 3: mobs that do not burn wait outside in the day: no opening while one is near.
            // #364 follow-up (b): that wait is no try (3 tries used up by a mob handed back enclosed,
            // and the agenda or the LLM then dug out with it still there): the bot stays in, held,
            // re-checking every RETRY_MS, as long as one is near, for at most the full day (#372 review:
            // a fixed 3 min handed back with the mob still there); the bound is below. A mob that
            // leaves ends its wait (mobSince): a later one gets its own, said again.
            const mob = ops.hostileNear?.(bot, LEAVE_MOB_RANGE);
            if (!mob) n.handFight = false; // soak 7 (C): a cornered fight ends with its mob
            if (mob) n.mobGoneAt = null;
            else if (n.mobSince != null && !n.morningLeaving) {
                // #477 nit: out of range for less than MORNING.goneMs, the wait's start (and the cap) stay.
                n.mobGoneAt ??= now;
                if (now - n.mobGoneAt < MORNING.goneMs) { n.exitAt = n.mobGoneAt + MORNING.goneMs; return 'night:inside'; }
            }
            if (!mob) Object.assign(n, { mobSince: null, mobSaid: false, ...MORNING_CLEAR });
            if (mob) {
                n.mobSince ??= now;
                n.mobFirst ??= { pos: mob.position?.clone?.() ?? mob.position, id: mob.id };
                const waited = now - n.mobSince;
                // Soak 4 (rotn-v0.1.7): a zombie stood 14 min at the shelter's corner (no path in, nothing in
                // line to dig, in shade) and the bot waited the whole day. Now a grace of MORNING.waitMs,
                // then fight it through the wall on its side (armed, health, one mob), else leave by the
                // side away from it; never past MORNING.capMs.
                if (waited < MORNING.waitMs) {
                    n.exitAt = now + RETRY_MS;
                    const text = `[night] morning: ${mobText(mob)} is within ${LEAVE_MOB_RANGE} blocks of the shelter at ${at(n.site)}; staying in until it leaves (checking every ${RETRY_MS / 1000} s, at most ${MORNING.waitMs / 60_000} min)`;
                    if (n.mobSaid) console.log(text); else { n.mobSaid = true; line(agent, text); }
                    return 'night:inside';
                }
                if (!n.mobStateSaid) { n.mobStateSaid = true; line(agent, mobStateLine(bot, mob, n.mobFirst, waited)); }
                if (!n.morningAct) {
                    const choice = (ops.morningChoice ?? morningChoice)(bot, n.site, { pit: !!n.pit });
                    n.morningAct = choice.action;
                    n.morningWhy = choice.why;
                    if (choice.action === 'fight') {
                        line(agent, `[night] morning: ${choice.why}: opening the wall toward ${mobText(mob)} to fight it from the shelter`);
                        startJob(agent, n, 'action:openShelter', () => ops.openToward(bot, n.site, mob.position), (cells) => {
                            if (cells?.length) { bot.rotnSheltered = 'open'; return; } // the in-shelter fight (self_defense, armed) hits it in reach
                            n.morningAct = 'leave';
                            n.morningWhy = 'the wall toward it did not open';
                            console.warn(`[night] morning: could not open the wall toward ${mobText(mob)}; leaving by the side away from it instead`);
                        });
                        return 'night:inside';
                    }
                }
                if (n.morningAct === 'fight') {
                    // #477 review 2: every tick: a second mob, or one that explodes or shoots, ends the fight.
                    const danger = (ops.morningDanger ?? morningDanger)(bot, n.site);
                    if (danger) { n.morningAct = 'leave'; n.morningWhy = `${danger} in the fight`; }
                    else if (Number.isFinite(bot.health) && bot.health < MORNING.fleeHealth) {
                        n.morningAct = 'leave';
                        n.morningWhy = `health ${Math.round(bot.health)} in the fight`;
                    }
                }
                if (n.morningAct === 'leave') {
                    // Soak 7 (C): no leave past a mob in the bot's cell or in reach of it; past the cap,
                    // one that is not in the cell and has been quiet lets the leave go ahead (#514).
                    const capped = waited >= MORNING.capMs ? holdPastCap(agent, n, ops) : null;
                    if (capped === 'release') {
                        n.handFight = false;
                        const sealing = capSeal(agent, n, ops); // #517 review: one more re-seal first
                        if (sealing) return sealing;
                    } else {
                        const holding = closeQuarters(agent, n, ops);
                        if (holding) return holding;
                    }
                    n.morningAct = 'leaving';
                    n.morningLeaving = true; // #477 review 2: busy from the first leave decision until the hand-back
                    line(agent, `[night] morning: ${n.morningWhy}: leaving the shelter at ${at(n.site)} by the side away from ${mobText(mob)}`);
                    const away = mob.position;
                    const out = n.pit ? () => ops.pitOut(bot, n.site, { away }) : () => ops.digOut(bot, n.site, { away });
                    startJob(agent, n, 'action:leaveShelter', async () => {
                        const side = await out();
                        if (side) await ops.awayFromMobs?.(bot);
                        return side;
                    }, (side) => {
                        if (side) { handBack(`[night] morning: left the shelter at ${at(side)} on the side away from ${mobText(mob)}; back to work`); return; }
                        n.morningAct = 'leave'; // the next try, RETRY_MS apart (failedTry)
                        const here = bot.entity.position.floored();
                        n.exitLeftAt = here.equals(n.site) ? null : here;
                        failedTry(`no side of the shelter at ${at(n.site)} away from ${mobText(mob)} to open yet`);
                    });
                    return 'night:inside';
                }
                if (waited >= MORNING.capMs) {
                    const held = holdPastCap(agent, n, ops);
                    if (held === 'release') { // the far-side leave, on the next tick
                        n.morningAct = 'leave';
                        n.morningWhy = `${MORNING.capMs / 60_000} min are up`;
                        return 'night:inside';
                    }
                    if (held) return held;
                    handBack(`[night] morning: ${mobText(mob)} still near the shelter at ${at(n.site)} after ${MORNING.capMs / 60_000} min; back to work (the agenda and the reflexes decide; the shelter may still be closed)`);
                    return null;
                }
                return 'night:inside'; // the fight goes on (self_defense from the opened shelter)
            }
            const out = n.pit ? () => ops.pitOut(bot, n.site) : () => ops.digOut(bot, n.site);
            startJob(agent, n, 'action:leaveShelter', out, (side) => {
                if (side) { handBack(`[night] morning: dug out of the shelter at ${at(side)}; back to work`); return; }
                const here = bot.entity.position.floored();
                n.exitLeftAt = here.equals(n.site) ? null : here; // #435 review 4: where a failed try left it
                failedTry(`no safe side of the shelter at ${at(n.site)} to open yet`);
            });
            return 'night:inside';
        }
        // A fallback since soak 4's morning rule (MORNING.capMs hands back after 5 min, long before
        // the full day ends): kept only for a full day shorter than the cap (a stuck clock).
        // #372 review: the bound of the morning wait for a mob. The lead's noon (6000) comes after
        // the full day ends on this pack's clock (dusk: SHELTER_LEAD_MIN before sunset, about 5348),
        // so the bound is the end of the full day: a warning naming the mob, and the bot stays in
        // this shelter for the night (a hand-back at dusk would only shelter again, here).
        if (n.mobSince != null && !isFullDay(t)) {
            const mob = ops.hostileNear?.(bot, LEAVE_MOB_RANGE);
            const text = `[night] warning: ${mob ? `${mobText(mob)} is still within ${LEAVE_MOB_RANGE} blocks` : 'a hostile mob stayed near'} of the shelter at ${at(n.site)} at the end of the day (waited ${Math.round((now - n.mobSince) / 60_000)} min); staying in it for the night`;
            console.warn(text);
            say(agent, text);
            Object.assign(n, { mobSince: null, mobSaid: false, exitTries: 0, exitAt: null, ...MORNING_CLEAR }); // #477 nit
        }
        if (n.checkedAt === null) n.checkedAt = now;
        // Soak 5 Fix B (PR 5), the lead's rule: at night, a mob that digs through anything (the troll)
        // within its blast range + BURROW.startMargin of the bot in its shelter, closed or open:
        // burrow away from it (burrow.js), never a hit at it. Checked every tick, not every CHECK_MS
        // (a troll closes 10 blocks in a few seconds). After a burrow that did not get it far enough
        // (cornered, the time up, a step that failed), not again for CHECK_MS.
        if (!isFullDay(t) && n.site && bot.entity.position.floored().equals(n.site) && (n.burrowSteps ?? 0) < BURROW.maxSteps
            && (n.burrowNoneAt == null || now - n.burrowNoneAt >= CHECK_MS)) {
            const threat = ops.burrowThreat?.(bot) ?? null;
            if (threat) { startBurrow(agent, n, ops, threat); return 'night:inside'; }
        }
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
        // Soak 3, the lead's (a): a hole shelter, closed: once, into a side pocket at its bottom, with
        // the shaft under the roof sealed behind (shelter.wallItems: blocks the diggers cannot break
        // first, cobblestone first). A zombie that digs the roof then finds a sealed column, not the bot.
        if (need.todo.length === 0 && n.pit && !n.pocketTried && ops.retreatPlan && ops.backAway) {
            n.pocketTried = true;
            const plan = ops.retreatPlan(bot, n.site, []);
            if (plan) {
                line(agent, `[night] the hole shelter at ${at(n.site)}: moving into a side pocket at ${at(plan.to)} and sealing the shaft behind`);
                startBackAway(agent, n, ops, plan, tolerateBody, POCKET_LABEL, 'moved into the side pocket');
                return 'night:inside';
            }
            console.log(`[night] the hole shelter at ${at(n.site)}: no enclosed side for a pocket (or fewer than 2 blocks to seal with); staying under the roof`);
        }
        // Soak 3, the lead's (b), #470 review: with no weapon, a cell a mob holds (heldCells) is left
        // out of the repair and the other open cells are repaired.
        // Soak 5 (death 4: a zombie dug into the dirt shelter and hit the bot from 20 to 0 in 8 s while
        // it fought back from the opening), the lead's rule: with no weapon, or at a health one hit of
        // the mob may take (armed or not; PR 5: maxHitOf), and a melee mob in the opening or in reach
        // through it, the bot backs away into an enclosed column on the far side (once per shelter);
        // only cornered (no way to back away) does it hit back (n.handFight lets
        // modes.fightInShelter swing, by hand or with its weapon).
        // #497 review 1: a threat the shelter never hits (notMelee: a troll, a creeper, a skeleton)
        // in the opening or in reach starts the back-away too, armed or not, at any health; cornered,
        // the bot never hits it. A mob that digs through anything (the troll) is burrowed away from
        // first (above, PR 5); this is what is left when no burrow step was found.
        let skip = [];
        n.handFight = false;
        // #477 review 3: the wall opened for the morning fight is not rebuilt (also in the 30 s the
        // mob is out of range): the fight's opening stays until it ends.
        if (need.todo.length > 0 && n.morningAct === 'fight') { bot.rotnSheltered = 'open'; return 'night:inside'; }
        if (need.todo.length > 0) {
            const armed = (ops.hasWeapon ?? hasWeapon)(bot);
            // PR 5, the lead's rule: low is a health one hit of that mob may take (threats.maxHitOf:
            // its maxDamage, UNKNOWN_MELEE when rotn-data has none; Fix G used 8).
            const low = (mob) => Number.isFinite(bot.health) && bot.health <= maxHitOf(mob);
            const held = ops.heldCells?.(bot, n.site, need.todo) ?? [];
            const heldOther = held.find(h => !shelterTarget(h.mob));
            const other = heldOther ? { mob: heldOther.mob, cell: heldOther.cell } : (() => { const m = ops.dangerInReach?.(bot) ?? null; return m ? { mob: m } : null; })();
            const heldMelee = held.find(h => shelterTarget(h.mob));
            const melee = heldMelee && !armed ? { mob: heldMelee.mob, cell: heldMelee.cell }
                : (() => { const m = ops.mobInReach?.(bot) ?? null; return m && (!armed || low(m)) ? { mob: m } : null; })();
            const reaching = other ?? melee;
            if (reaching) {
                bot.rotnSheltered = 'open';
                const name = reaching.mob.name ?? 'hostile mob';
                const where = reaching.cell ? `in the opening at ${at(reaching.cell)}` : `in reach${reaching.mob.position ? ` at ${at(reaching.mob.position.floored())}` : ''}`;
                const why = other ? `${aMob(name)} (${threatFor(reaching.mob)?.reaction ?? 'not a melee mob'}) ${where}`
                    : `${armed ? '' : 'no weapon, '}health ${Math.round(bot.health)}, and ${aMob(name)} ${where}`;
                const plan = n.backedAway ? null : ops.retreatPlan?.(bot, n.site, need.todo);
                if (plan) {
                    n.backedAway = true;
                    line(agent, `[night] ${why}: backing away into ${at(plan.to)}`);
                    startBackAway(agent, n, ops, plan, tolerateBody, BACK_AWAY_LABEL, 'backed away');
                    return 'night:inside';
                }
                // Cornered: a melee mob is hit back; any other threat never is.
                n.handFight = !other;
                const text = other
                    ? `[night] ${why}, and no way to back away${burrowsFrom(other.mob) ? ' or burrow' : ''}: not hitting it`
                    : `[night] ${armed ? '' : 'no weapon, '}health ${Math.round(bot.health)}, and no way to back away from ${aMob(name)} ${where}: ${armed ? 'hitting back' : 'hitting back by hand'}`;
                const said = reaching.cell ? key3(reaching.cell) : `reach:${reaching.mob.id ?? ''}`;
                if (n.handSaid === said) console.log(text); else { n.handSaid = said; line(agent, text); }
            }
            // A cell the bot will not clear by hitting (no weapon, or a mob it never hits) is left
            // out of the repair; the other open cells are repaired.
            const leave = held.filter(h => !armed || !shelterTarget(h.mob));
            if (leave.length) {
                skip = leave.map(h => h.cell);
                const text = `[night] ${armed ? '' : 'no weapon and '}${aMob(leave[0].mob.name ?? 'hostile mob')} in the opening at ${leave.map(h => at(h.cell)).join('; ')}: not repairing under it; repairing the other open cells`;
                const said = leave.map(h => key3(h.cell)).join(';');
                if (n.holdSaid === said) console.log(text); else { n.holdSaid = said; line(agent, text); }
                if (skip.length >= need.todo.length) return 'night:inside';
            }
        }
        if (need.todo.length > 0) {
            // self_defense fights at the opening, from where the bot stands, and never during the
            // repair (G3 round 9 B: it interrupted the repair and walked out after the zombie).
            bot.rotnSheltered = 'open';
            const text = `[night] the shelter is open at ${need.todo.map(at).join('; ')}: repairing`;
            if (open) console.log(text); else line(agent, text); // said once, then logged (T1: chat volume)
            startJob(agent, n, REPAIR_LABEL, () => ops.buildShelter(bot, { site: n.site, keepSoft: true, tolerateBody, ...(skip.length ? { skip } : {}) }), (r) => {
                // Soak 5 (00:31:47): a repair that closed the shelter said nothing; the journal could not
                // show the roof was closed before the troll came.
                if (r?.closed) { bot.rotnSheltered = true; n.repairStall = null; n.handFight = false; console.log(`[night] the repair closed the shelter at ${at(n.site)}`); return; } // #470 nit: no hand fight once closed
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
