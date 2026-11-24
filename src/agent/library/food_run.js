// Soak 14 (F1, the lead): the bot held no food at any sunset and starved twice (night 1 in its shelter at
// food 1, night 3 in the open at food 2). A bounded food run by skill (no LLM): ripe wild food first
// (forageNearby), then, armed and strong enough, the nearest huntable animal (huntAnimal) and its meat
// (pickupKillDrops). Used at sunset when the bot holds less than the night needs (night_routine), and at
// night when food is FOOD_RUN.emergencyAt or lower with no food held (starving is certain, a night outside
// is not).

import { heldFoodPoints } from './food.js';
import { huntTarget, huntAnimal, tooWeakToHunt, skipAnimal, HUNT } from './hunting.js';
import { hasWeapon } from './threats.js';
import * as skills from './skills.js';

/**
 * sunset: at `sunset is near`, before the shelter: at most 3 min, ripe food within 24, animals within 32;
 * ends at a hostile within hostileRange, or night. night: the night emergency: at most 4 min in all, within
 * 16; a reflex (self_defense, eating) interrupts it like any action, and the night routine resumes it after
 * the reflex within what is left of its 4 min (#612 review 2); health below minHealth ends it at food 3 or 4 (at
 * anyHealthAt, 2, or lower it goes on at any health: #612 review 5). backMs: the walk back into the shelter after
 * it (#612 review 3). emergencyAt: the food level
 * of the night emergency (food 0 is about 16 min away at rest,
 * 236 s a point by the #611 review, and kills 4 s later; walking for food costs about 0.7 points a minute). rounds: at most this many forage or hunt tries in one run.
 */
export const FOOD_RUN = {
    sunset: { maxMs: 3 * 60_000, forage: 24, hunt: 32 },
    night: { maxMs: 4 * 60_000, forage: 16, hunt: 16 },
    hostileRange: 16, emergencyAt: 4, minHealth: 8, anyHealthAt: 2, backMs: 20_000, rounds: 12,
    // #612 re-review (the lead): at most this many resumes after reflexes, and this long from the emergency's start in
    // all (4 min of running and 2 for the reflexes); then back into the shelter, or a shelter where the bot is.
    maxResumes: 5, wallMs: 6 * 60_000,
};

const DEPS = {
    forageNearby: (bot, opts) => skills.forageNearby(bot, opts),
    huntTarget, huntAnimal,
    pickupKillDrops: (bot, at) => skills.pickupKillDrops(bot, at),
    equip: (bot) => skills.equipHighestAttack(bot),
    rearm: (bot) => skills.rearmWeapon(bot),
};

/**
 * One food run. maxMs, forage, hunt: the bounds (FOOD_RUN.sunset or .night); need: the points that end it
 * early; stop(): a reason to end it now (a hostile at sunset, low health at night), or null.
 * Returns {points, ms, why}: the points of safe food gained, and why it ended.
 */
// weakHunt (#612 review 1, the lead): at food HUNT_MIN_FOOD (4) or lower Hunger Overhaul's weakness makes a hunt
// slow, but at the night emergency (or a sunset run at that food) starvation is certain and a weak hunt is not:
// armed, it hunts anyway. Everywhere else tooWeakToHunt holds.
export async function foodRun(bot, { maxMs, forage, hunt, need = Infinity, stop = () => null, weakHunt = false, deps = {} } = {}) {
    const d = { ...DEPS, ...deps };
    const start = Date.now();
    const before = heldFoodPoints(bot);
    const left = () => maxMs - (Date.now() - start);
    const bases = (() => { try { return bot.rotnBases?.() ?? []; } catch { return []; } })();
    const keepGoing = () => left() > 0 && !stop() && !bot.interrupt_code;
    let why = null, noForage = false;
    for (let round = 0; !why; round++) {
        if (bot.interrupt_code) { why = 'stopped'; break; }
        if (left() <= 0) { why = 'time'; break; }
        const s = stop();
        if (s) { why = s; break; }
        if (heldFoodPoints(bot) - before >= need) { why = 'enough'; break; }
        if (round >= FOOD_RUN.rounds) { why = `${FOOD_RUN.rounds} tries`; break; }
        if (!noForage) {
            const got = await d.forageNearby(bot, { keepGoing, radius: forage, limits: { totalMs: Math.max(1000, Math.min(90_000, left())) } });
            if (!got) noForage = true; // nothing (more) ripe in reach: the hunt next
            continue;
        }
        const weak = tooWeakToHunt(bot) && !weakHunt;
        if (weak) { why = 'no ripe wild food, and too weak to hunt'; break; }
        if (!hasWeapon(bot)) { why = 'no ripe wild food, and no weapon to hunt with'; break; }
        const target = d.huntTarget(bot, { bases, radius: hunt });
        if (!target) { why = `no ripe wild food and no animal to hunt within ${hunt} blocks`; break; }
        const end = await d.huntAnimal(bot, target, { keepGoing: () => keepGoing() && (weakHunt || !tooWeakToHunt(bot)), maxMs: Math.max(1000, Math.min(HUNT.maxMs, left())), equip: d.equip });
        if (end === 'killed' && !bot.interrupt_code) {
            const at = target.position?.clone?.() ?? target.position ?? null;
            try { await d.pickupKillDrops(bot, at); } catch { /* the meat may still come in */ }
        } else if (end === 'stuck' || end === 'time') skipAnimal(bot, target.id);
        try { await d.rearm(bot); } catch { /* best effort */ }
    }
    return { points: Math.round((heldFoodPoints(bot) - before) * 10) / 10, ms: Date.now() - start, why };
}
