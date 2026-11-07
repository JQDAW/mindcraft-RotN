// The night routine (skills-rotn D2b-2), for G3 (b) "survives the first night": from dusk to full
// daylight the bot is in a closed rock shelter, and tasks and the agenda wait. No LLM call.
//
//   day -> (dusk or night) build a shelter (!buildShelter's skill) -> inside: stay; every
//   CHECK_MS look for a breach and repair it, or build again when the bot is no longer in it or
//   the shelter is no longer usable -> full daylight: dig out one side and hand back to the task
//   or agenda that was running.
//
// When no shelter can be built (BUILD_ATTEMPTS failures, for example too few blocks), the bot
// stays where it is until morning ('exposed'), with its normal reflexes (lead decision on #204).
// Night is judged by NightClock (D2a: world time first, the wall clock when the time is stuck).
// Control holds (a giver's !stop or !pause) come first (priority.js); a giver's typed !goal runs
// first too, and the bot says the shelter waits for it.

import { Vec3 } from 'vec3';
import { NightClock, nightPhase, NIGHT_START, isWall, handDiggable, REPAIR_LABEL } from './library/night.js';
import { buildShelter, siteNeeds, siteProblem, isLiquid, isFalling, isEmpty } from './library/shelter.js';
import { breakBlockAt } from './library/skills.js';
import { stowCarried } from './library/rotn_sources.js';
import { digPit, pitOut, moveAwayFrom, PIT } from './library/pit.js';
import { hasWeapon } from './library/threats.js';
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
 * G3 round 9 B (fix h): after a death at night the bot first walks away from where it died (the
 * killer, and the player zombie that rises there) when that was less than this long ago.
 */
export const DEATH_NEAR_MS = 20 * 60_000;

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
        repairStall: null, // #331 re-review: {fightEndedAt}: the last repair placed nothing
        pit: false, // round 9 B (fix h): the shelter is a hole (its morning exit is pitOut)
        pitNext: false, // the next build try is a hole
        pitTried: false, // a hole was tried this night
        pitProgress: {}, // the hole being dug (digPit's progress.P), so an interrupted dig goes on in it
        leftDeathSpot: false, // the walk away from a recent death spot was done (or not needed)
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
    Object.assign(n, { pit: false, pitNext: false, pitTried: false, leftDeathSpot: false, pitProgress: {} });
    if (n.state !== 'day') console.log(`[night] ${why}: not in a shelter any more`);
    Object.assign(n, { state: 'day', site: null, attempts: 0, nextAt: 0, checkedAt: null, duskAt: null, stopping: false, toldGiver: false, repairStall: null });
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
    Object.assign(n, { state: 'building', attempts: 0, nextAt: 0, site: null });
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
 * Open one side of the shelter (its lower and upper wall) so the bot can walk out, with the
 * build's own safety checks (#204 review 5): nothing liquid, burning or falling around the
 * opening (outside both cells, or above the upper one), and a free way out. The opening is
 * checked after digging. Returns the side's lower wall position, or null.
 */
export async function digOut(bot, feet) {
    // The pickaxe must be where breakBlockAt's equipForBlock looks (#229 review).
    const moved = await stowCarried(bot, (i) => /pickaxe/.test(i.name), { resyncMs: 0 }); // no wait: it is night
    if (moved.length) console.log(`[night] moved ${moved.join(' and ')} back into the inventory to dig out`);
    // A side dug by hand (dirt, G3 round 6 B) first: it needs no pickaxe, which a bot that died
    // and built its shelter of dirt does not have.
    const byHand = (d) => [feet.plus(d), feet.plus(d).offset(0, 1, 0)].every(q => isEmpty(bot.blockAt(q)) || handDiggable(bot.blockAt(q)));
    const sides = [...HORIZONTAL.filter(byHand), ...HORIZONTAL.filter(d => !byHand(d))];
    for (const d of sides) {
        const lower = feet.plus(d), upper = lower.offset(0, 1, 0);
        const outside = [lower.plus(d), upper.plus(d)];
        if (outside.some(q => hot(bot.blockAt(q)))) continue;
        if (isFalling(bot.blockAt(upper.offset(0, 1, 0)))) continue;
        if (!outside.every(q => isEmpty(bot.blockAt(q)))) continue; // a hillside: no way out there
        for (const q of [upper, lower]) {
            if (!isEmpty(bot.blockAt(q))) await breakBlockAt(bot, q.x, q.y, q.z);
        }
        if (isEmpty(bot.blockAt(lower)) && isEmpty(bot.blockAt(upper))) return lower;
    }
    return null;
}

/** What the routine does in the world (tests pass their own). */
export const NIGHT_OPS = { buildShelter, digOut, siteNeeds, siteProblem, digPit, pitOut, moveAwayFrom };

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
    n.nextAt = now;
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
        Object.assign(n, { pitTried: false, leftDeathSpot: false, pitProgress: {} });
        line(agent, '[night] morning: back to work');
        return null;
    }
    holdAutonomy(agent);

    if (n.state === 'building') {
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
                n.pitNext = false;
                n.state = 'inside';
                n.site = r.feet;
                n.pit = pit;
                n.checkedAt = null; // set by the next tick, on its clock
                bot.rotnSheltered = true;
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
        if (isFullDay(t)) {
            const out = n.pit ? () => ops.pitOut(bot, n.site) : () => ops.digOut(bot, n.site);
            startJob(agent, n, 'action:leaveShelter', out, (side) => {
                bot.rotnSheltered = false;
                n.state = 'day';
                n.site = null;
                Object.assign(n, { pit: false, pitTried: false, leftDeathSpot: false, pitProgress: {} });
                line(agent, side ? `[night] morning: dug out of the shelter at ${at(side)}; back to work`
                    : '[night] morning: found no safe side to open; back to work');
            });
            return 'night:inside';
        }
        if (n.checkedAt === null) n.checkedAt = now;
        // #331 review 4: while a wall is known open (a repair did not close it, or a fight in place
        // held it up), every tick checks and repairs, not every CHECK_MS.
        const open = bot.rotnSheltered === 'open';
        // #331 re-review: a repair that placed nothing (no blocks left, a mob in the cell) is not
        // tried again on every tick all night (thousands of log lines an hour): it waits CHECK_MS
        // again, unless a fight in place has ended since (the cell may be free now).
        const stalled = !!n.repairStall && n.repairStall.fightEndedAt === (bot.rotnFightEndedAt ?? null);
        if ((!open || stalled) && now - n.checkedAt < CHECK_MS) return 'night:inside';
        n.checkedAt = now;
        if (!bot.entity.position.floored().equals(n.site)) {
            // Pushed, teleported (AggroTP) or walked out: a new shelter where it is now.
            bot.rotnSheltered = false;
            line(agent, `[night] no longer in the shelter at ${at(n.site)}: building a new one`);
            startBuilding(n, now);
            return 'night:building';
        }
        // Dirt walls (the fallback) are walls too: only an opening is a breach (G3 round 6 B). Only
        // real fire or lava, or a solid block in the bot's two cells, makes the shelter unusable: a
        // dropped item or a harmless block (a torch, a carpet, snow) never does (G3 round 7 B).
        const need = ops.siteNeeds(bot, n.site, { accept: isWall, occupied: true });
        if (!need) {
            // It cannot be repaired there (#204 review 2); say exactly what is where (G3 round 7 B).
            const found = ops.siteProblem?.(bot, n.site, { occupied: true });
            bot.rotnSheltered = false;
            line(agent, `[night] the shelter at ${at(n.site)} is no longer usable: ${found?.text ?? 'the check found it unusable but named nothing'}; building a new one`);
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
            startJob(agent, n, REPAIR_LABEL, () => ops.buildShelter(bot, { site: n.site, keepSoft: true }), (r) => {
                if (r?.closed) { bot.rotnSheltered = true; n.repairStall = null; return; }
                if ((r?.placed ?? 0) > 0) { n.repairStall = null; return; } // progress: the next tick tries again
                // Nothing placed: back to every CHECK_MS until a fight in place ends (#331 re-review).
                if (!n.repairStall) console.warn(`[night] the repair placed nothing (${r?.line ?? 'no result'}); checking again in ${CHECK_MS / 1000} s`);
                n.repairStall = { fightEndedAt: bot.rotnFightEndedAt ?? null };
            });
        }
        return 'night:inside';
    }

    return `night:${n.state}`; // exposed
}
