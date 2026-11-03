// Night and shelter facts for RotN (skills-rotn D2a; G3 (b) "survives the first night").
// Pure functions over the bot's state: no packets, no block placing (that is D2b,
// after the P1 probe measures placing on RotN).
//
// The day cycle on RotN 3.3.4 was measured by harness-ops' S1-A survey (2026-11-02,
// STATUS-harness-ops "The day cycle"): the time runs at the vanilla rate (about
// 1,199 ticks per minute), but Extended Days freezes it for about 10 min at 3000
// (morning) and at 16000 (early night). Night is 12542-23460, about 19 min. So the
// time of day is a usable signal once these freezes are known. The brief's caution
// ("do not rely on world time values") predates that measurement. Lead decision (D2a):
// world time with these bounds is the primary detector, with a fallback when the value
// stops advancing (NightClock).
//
// A shelter (rotn-progression.md section 3, step 12): the bot stands in a 1x2
// space, fully enclosed by sturdy blocks (stone or cobblestone, never dirt, sand,
// gravel, wood or leaves: mobs dig through those, and Fire Creepers burn wood).
import { Vec3 } from 'vec3';

export const NIGHT_START = 12542;
export const NIGHT_END = 23460;
export const MORNING_FREEZE = 3000;
export const NIGHT_FREEZE = 16000;
export const TICKS_PER_MIN = 1199;
export const FREEZE_MIN = 10;
/** Start sheltering this long before sunset (the plan says 5 to 8 min). */
export const SHELTER_LEAD_MIN = 6;

const norm = (t) => ((Math.floor(t) % 24000) + 24000) % 24000;

/**
 * Minutes of running time until sunset, counting the morning freeze if it is still ahead.
 * 0 at night. At exactly 3000 the time may be frozen, with an unknown part of the freeze left,
 * so it gives the least time that is certain (the freeze is not counted).
 */
export function minutesToSunset(timeOfDay) {
    const t = norm(timeOfDay);
    if (t >= NIGHT_START && t < NIGHT_END) return 0;
    const ticks = t >= NIGHT_END ? 24000 - t + NIGHT_START : NIGHT_START - t;
    const freezeAhead = t < MORNING_FREEZE || t >= NIGHT_END;
    return ticks / TICKS_PER_MIN + (freezeAhead ? FREEZE_MIN : 0);
}

/** 'night', 'dusk' (shelter now: sunset within SHELTER_LEAD_MIN) or 'day'. */
export function nightPhase(timeOfDay) {
    const t = norm(timeOfDay);
    if (t >= NIGHT_START && t < NIGHT_END) return 'night';
    return minutesToSunset(t) <= SHELTER_LEAD_MIN ? 'dusk' : 'day';
}

/** A time value stuck longer than this (the measured freeze plus a margin) is not trusted. */
export const STUCK_BOUND_MIN = FREEZE_MIN + 5;

/**
 * The time of day the night detector uses (lead decision on D2a): the server's value, and a
 * fallback when it has not advanced for longer than STUCK_BOUND_MIN.
 *
 * The fallback is the wall clock: the last value plus the measured rate for the time since,
 * less one freeze if the value stuck at a freeze point. In 1.12 sky light and the sunset event
 * are no independent signal: chunk sky light is fixed per block (the darkening is computed from
 * the same world time), and the agent's 'sunset' event comes from the time packets. Each switch
 * to and from the fallback is logged once.
 */
export class NightClock {
    constructor({ log = (m) => console.warn(m) } = {}) {
        this.log = log;
        this.last = null; // {t, at}: the latest value and when it last changed
        this.fallback = false;
    }

    /** Feed the server's time of day (bot.time.timeOfDay) with the wall-clock time in ms. */
    observe(timeOfDay, at) {
        if (!Number.isFinite(timeOfDay)) return;
        const t = norm(timeOfDay);
        if (this.last && this.last.t === t) return;
        if (this.fallback) {
            this.fallback = false;
            this.log(`[night] the time advances again (${this.last?.t} -> ${t}); using the server's time`);
        }
        this.last = { t, at };
    }

    /** The time of day to judge by, or null before the first value. */
    timeOfDay(at) {
        if (!this.last) return null;
        const stuckMin = (at - this.last.at) / 60_000;
        if (stuckMin <= STUCK_BOUND_MIN) return this.last.t;
        if (!this.fallback) {
            this.fallback = true;
            this.log(`[night] the time has stayed at ${this.last.t} for ${Math.round(stuckMin)} min (more than ${STUCK_BOUND_MIN}); using the wall clock until it advances`);
        }
        const atFreeze = this.last.t === MORNING_FREEZE || this.last.t === NIGHT_FREEZE;
        const runMin = Math.max(0, stuckMin - (atFreeze ? FREEZE_MIN : 0));
        return norm(this.last.t + runMin * TICKS_PER_MIN);
    }

    /** nightPhase of timeOfDay(at); null before the first value. */
    phase(at) {
        const t = this.timeOfDay(at);
        return t === null ? null : nightPhase(t);
    }
}

/** A block mobs cannot simply dig or burn through: rock, or a solid modded block as hard as stone. */
export function isSturdy(block) {
    if (!block || block.boundingBox !== 'block' || block.transparent) return false;
    if (block.material) return block.material === 'rock';
    return Number.isFinite(block.hardness) && block.hardness >= 1.5;
}

const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

/** The 10 shell positions around a 1x2 space whose lower cell is at feet: floor, roof, 4 sides x 2. */
export function shelterShell(feet) {
    const p = new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z));
    const shell = [p.offset(0, -1, 0), p.offset(0, 2, 0)];
    for (const d of HORIZONTAL) shell.push(p.plus(d), p.plus(d).offset(0, 1, 0));
    return shell;
}

/**
 * What a shelter at feet still needs.
 * @returns {{interiorClear: boolean, missing: Array<{pos: Vec3, block: string}>, closed: boolean}}
 *   missing: shell positions that are not sturdy (to fill or replace with cobblestone), with what
 *   is there now; closed: the interior is free and the shell is complete.
 */
export function shelterPlan(bot, feet) {
    const p = new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z));
    const free = (b) => !!b && b.boundingBox === 'empty' && !/lava|water|fire/.test(b.name ?? '');
    const interiorClear = free(bot.blockAt(p)) && free(bot.blockAt(p.offset(0, 1, 0)));
    const missing = shelterShell(p)
        .map(pos => ({ pos, b: bot.blockAt(pos) }))
        .filter(({ b }) => !isSturdy(b))
        .map(({ pos, b }) => ({ pos, block: b?.name ?? 'unloaded' }));
    return { interiorClear, missing, closed: interiorClear && missing.length === 0 };
}
