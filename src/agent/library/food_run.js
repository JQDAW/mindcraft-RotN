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
 * ends at a hostile within hostileRange, or night. night: the night emergency: at most 4 min, within 16;
 * hostiles do not end it (it is night: self_defense fights them, the weapon in hand), health below
 * minHealth does. emergencyAt: the food level of the night emergency (food 0 is about 16 min away at rest,
 * 236 s a point by the #611 review, and kills 4 s later; walking for food costs about 0.7 points a minute). rounds: at most this many forage or hunt tries in one run.
 */
export const FOOD_RUN = {
    sunset: { maxMs: 3 * 60_000, forage: 24, hunt: 32 },
    night: { maxMs: 4 * 60_000, forage: 16, hunt: 16 },
    hostileRange: 16, emergencyAt: 4, minHealth: 8, rounds: 12,
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
export async function foodRun(bot, { maxMs, forage, hunt, need = Infinity, stop = () => null, deps = {} } = {}) {
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
        if (tooWeakToHunt(bot)) { why = 'no ripe wild food, and too weak to hunt'; break; }
        if (!hasWeapon(bot)) { why = 'no ripe wild food, and no weapon to hunt with'; break; }
        const target = d.huntTarget(bot, { bases, radius: hunt });
        if (!target) { why = `no ripe wild food and no animal to hunt within ${hunt} blocks`; break; }
        const end = await d.huntAnimal(bot, target, { keepGoing: () => keepGoing() && !tooWeakToHunt(bot), maxMs: Math.max(1000, Math.min(HUNT.maxMs, left())), equip: d.equip });
        if (end === 'killed' && !bot.interrupt_code) {
            const at = target.position?.clone?.() ?? target.position ?? null;
            try { await d.pickupKillDrops(bot, at); } catch { /* the meat may still come in */ }
        } else if (end === 'stuck' || end === 'time') skipAnimal(bot, target.id);
        try { await d.rearm(bot); } catch { /* best effort */ }
    }
    return { points: Math.round((heldFoodPoints(bot) - before) * 10) / 10, ms: Date.now() - start, why };
}
