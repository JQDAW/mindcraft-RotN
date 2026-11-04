// The night routine (skills-rotn D2b-2), for G3 (b) "survives the first night": from dusk to full
// daylight the bot is in a closed rock shelter, and tasks and the agenda wait. No LLM call.
//
//   day -> (dusk or night) build a shelter (!buildShelter's skill) -> inside: stay; every
//   CHECK_MS look for a breach and repair it, or build again when the bot is no longer in it
//   -> full daylight: dig out one side and hand back to the task or agenda that was running.
//
// When no shelter can be built (BUILD_ATTEMPTS failures, for example too few blocks), the bot
// stays where it is until morning ('exposed'), with its normal reflexes. Night is judged by
// NightClock (D2a: world time first, the wall clock when the time is stuck past a freeze).
// Control holds (a giver's !stop or !pause) still come first (priority.js).

import { Vec3 } from 'vec3';
import { NightClock, nightPhase, NIGHT_START } from './library/night.js';
import { buildShelter, siteNeeds } from './library/shelter.js';
import { breakBlockAt } from './library/skills.js';
import { say } from './agenda_driver.js';
import settings from './settings.js';

/** How often the bot inside checks its shelter for a breach or for having left it. */
export const CHECK_MS = 10_000;
/** Wait before another try after a shelter could not be built. */
export const RETRY_MS = 30_000;
export const BUILD_ATTEMPTS = 3;

const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const at = (p) => `${p.x}, ${p.y}, ${p.z}`;
const wet = (b) => /water|lava|fire/.test(b?.name ?? '');

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
        checkedAt: 0,
        job: null, // the action running for the routine (build, repair, dig out)
        lastLine: null,
    };
}

/** Stop autonomy at its checkpoint; what ran keeps its place and resumes without a new run. */
function holdAutonomy(agent) {
    const sp = agent.self_prompter;
    if (sp.isActive()) sp.stop(false);
    agent._agenda_paused = true;
    if (agent._task_id) agent._task_paused = true;
    agent._task_tick_at = undefined; // no task LLM time while sheltering
    return !sp.loop_active;
}

/** Run fn as an action; its result goes to `then` when it ends. A throw ends as `then(null)`. */
function startJob(agent, n, label, fn, then) {
    let result = null;
    n.job = Promise.resolve()
        .then(() => agent.actions.runAction(label, async () => { result = await fn(); }))
        .catch(err => console.warn(`[night] ${label} failed: ${err?.message ?? err}`))
        .then(() => { n.job = null; then(result); });
}

/**
 * Break the wall on one side (lower and upper cell) whose outside is free of liquids, so the bot
 * can walk out. Returns the side's lower wall position, or null.
 */
export async function digOut(bot, feet) {
    for (const d of HORIZONTAL) {
        const lower = feet.plus(d), upper = lower.offset(0, 1, 0);
        if ([lower.plus(d), upper.plus(d)].some(q => wet(bot.blockAt(q)))) continue;
        let ok = true;
        for (const q of [upper, lower]) {
            const b = bot.blockAt(q);
            if (b && b.boundingBox !== 'empty' && !await breakBlockAt(bot, q.x, q.y, q.z)) ok = false;
        }
        if (ok) return lower;
    }
    return null;
}

/** What the routine does in the world (tests pass their own). */
export const NIGHT_OPS = { buildShelter, digOut, siteNeeds };

function line(agent, n, text) {
    n.lastLine = text;
    console.log(text);
    say(agent, text);
}

/**
 * One tick of the night routine. null when it is day and nothing night-related runs (the priority
 * stack goes on to tasks and the agenda); otherwise 'night:<state>' and nothing below it runs.
 */
export function nightTick(agent, { now = Date.now(), ops = NIGHT_OPS } = {}) {
    const bot = agent.bot;
    // settings.night_shelter: false turns the routine off (default on; lead-owned settings.js).
    if (!bot || settings.night_shelter === false) return null;
    const n = nightState(agent);
    n.clock.observe(bot.time?.timeOfDay, now);
    const t = n.clock.timeOfDay(now);
    if (t === null) return null;
    const phase = nightPhase(t);
    if (n.job) return `night:${n.state}`;

    if (n.state === 'day') {
        if (phase === 'day') return null;
        if (!holdAutonomy(agent)) return 'night:waiting';
        line(agent, n, `[night] ${phase === 'dusk' ? 'sunset is near' : 'it is night'}: building a shelter`);
        n.state = 'building';
        n.attempts = 0;
        n.nextAt = now;
    }

    if (isFullDay(t) && n.state !== 'inside') {
        // Morning came before a shelter did (or the bot was exposed): back to work.
        bot.rotnSheltered = false;
        n.state = 'day';
        line(agent, n, '[night] morning: back to work');
        return null;
    }
    holdAutonomy(agent);

    if (n.state === 'building') {
        if (n.nextAt === null) n.nextAt = now + RETRY_MS;
        if (now < n.nextAt) return 'night:building';
        startJob(agent, n, 'action:buildShelter', () => ops.buildShelter(bot), (r) => {
            if (r?.closed) {
                n.state = 'inside';
                n.site = r.feet;
                n.checkedAt = null; // set by the next tick, on its clock
                bot.rotnSheltered = true;
                line(agent, n, `[night] in the shelter at ${at(r.feet)} until morning`);
                return;
            }
            n.attempts++;
            const why = r?.line ?? 'the build ended without a result';
            if (n.attempts >= BUILD_ATTEMPTS) {
                n.state = 'exposed';
                line(agent, n, `[night] no shelter after ${n.attempts} tries (${why}); staying here until morning`);
            } else {
                n.nextAt = null; // the next tick waits RETRY_MS from its own clock
                console.warn(`[night] shelter try ${n.attempts} of ${BUILD_ATTEMPTS} failed (${why})`);
            }
        });
        return 'night:building';
    }

    if (n.state === 'inside') {
        if (isFullDay(t)) {
            startJob(agent, n, 'action:leaveShelter', () => ops.digOut(bot, n.site), (side) => {
                bot.rotnSheltered = false;
                n.state = 'day';
                n.site = null;
                line(agent, n, side ? `[night] morning: dug out of the shelter at ${at(side)}; back to work`
                    : '[night] morning: could not open a wall; back to work');
            });
            return 'night:inside';
        }
        if (n.checkedAt === null) n.checkedAt = now;
        if (now - n.checkedAt < CHECK_MS) return 'night:inside';
        n.checkedAt = now;
        if (!bot.entity.position.floored().equals(n.site)) {
            // Pushed, teleported (AggroTP) or walked out: a new shelter where it is now.
            bot.rotnSheltered = false;
            line(agent, n, `[night] no longer in the shelter at ${at(n.site)}: building a new one`);
            n.state = 'building';
            n.attempts = 0;
            n.nextAt = now;
            return 'night:building';
        }
        const need = ops.siteNeeds(bot, n.site);
        if (need && need.todo.length > 0) {
            bot.rotnSheltered = 'open'; // self_defense fights at the opening meanwhile
            line(agent, n, `[night] the shelter is open at ${need.todo.map(at).join('; ')}: repairing`);
            startJob(agent, n, 'action:buildShelter', () => ops.buildShelter(bot, { site: n.site }), (r) => {
                if (r?.closed) bot.rotnSheltered = true;
                else console.warn('[night] the repair did not close the shelter; trying again at the next check');
            });
        }
        return 'night:inside';
    }

    return `night:${n.state}`; // exposed
}
