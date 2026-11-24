// G4 #5 (CX23 soak m1: food fell to 1, nothing got food): the bot may hunt for food, but on the live
// server never an animal that may belong to a player (lead's hard rule; the checks are in
// ownership.js), nor one whose hunt brings a fight it must not take (retaliationRisk, #448).

import * as mc from '../../utils/mcdata.js';
import { threatFor } from './threats.js';
import { OWNERSHIP, mayBelongToPlayer } from './ownership.js';
import { logWeapon } from './survival_log.js';

/**
 * Soak 2 (rotn-v0.1.4): at food 4 or lower (Normal difficulty) Hunger Overhaul gives weakness
 * (-4 attack: a bare hand does nothing), slowness and mining slowdown (its jar's
 * HungerOverhaulEventHook, config addLowHungerWeakness=true): the bot chased a sow it could not hurt
 * until food 0 killed it. No hunting at this food level or lower: forage or eat instead.
 */
export const HUNT_MIN_FOOD = 4;
export const tooWeakToHunt = (bot) => Number.isFinite(bot?.food) && bot.food <= HUNT_MIN_FOOD;

// ownedRadius, baseRadius and placedMax are copied from OWNERSHIP (ownership.js), their source of
// truth: the ownership checks and foraging read OWNERSHIP, so changing HUNT.* has no effect on them.
export const HUNT = { retaliationRadius: 16, radius: 16, ...OWNERSHIP, maxMs: 90_000, checkMs: 500, stuckMs: 8000, skipMs: 5 * 60_000 };

/**
 * Soak 2 (rotn-v0.1.4): the reflex hunted the same sow, uphill and out of reach, 6 times in 4 min;
 * each hunt stood still until the unstuck reflex stopped it. An animal whose hunt ended without a
 * kill (stuck, time, interrupted) is left alone for HUNT.skipMs (bot.rotnHuntSkip, by entity id).
 */
export function skipAnimal(bot, id, now = Date.now()) {
    if (!bot || id == null) return;
    const skip = bot.rotnHuntSkip ??= new Map();
    skip.set(id, now + HUNT.skipMs);
    if (skip.size > 64) skip.delete(skip.keys().next().value);
}
const skippedNow = (bot, e, now = Date.now()) => (bot?.rotnHuntSkip?.get(e.id) ?? 0) > now;

/**
 * Animals the bot may hunt for food: vanilla's adult cow, mooshroom, pig, rabbit and sheep, and
 * Animania's adult females, which this pack spawns instead (rotn-data common-mobs: cow_*, sow_*,
 * ewe_*, doe_*). Never a chicken or a hen (raw chicken is avoided food, rotn-data) nor a llama (no
 * meat) (#422 review 5). Animania names its young apart (calf_, piglet_, lamb_, kit_, kid_, chick_),
 * and its males (bull_, hog_, ram_, buck_, rooster_) are left alone: some charge when hit.
 */
const VANILLA_FOOD = new Set(['cow', 'mooshroom', 'pig', 'rabbit', 'sheep']);
const ANIMANIA_FOOD = /^animania:(cow|sow|ewe|doe)_[a-z_]+$/;
export const isHuntableAnimal = (e) => !!e?.name
    && ((VANILLA_FOOD.has(e.name) && mc.isHuntable(e)) || ANIMANIA_FOOD.test(e.name));

/**
 * Soak 13 (C1, the lead): a generic kind the model searches for (!searchForEntity("cow")) also means
 * the Animania adults hunting treats as that food, so the search and the hunt agree. A chicken has no
 * Animania food kind (hunting never takes a hen). A rabbit: RABBIT below (the rabbit breeds, read at call time).
 */
const ANIMANIA_KIND = { cow: /^animania:cow_/, pig: /^animania:sow_/, sheep: /^animania:ewe_/ };
/** True when entity e is of the kind asked: its own name, or (for pig, cow, sheep, rabbit) an Animania food adult of that kind. */
export function matchesKind(e, kind) {
    const name = e?.name;
    if (!name || typeof kind !== 'string') return false;
    const k = kind.trim().toLowerCase();
    if (name === kind || name === k) return true;
    if (k === 'rabbit') return RABBIT.test(name);
    return !!ANIMANIA_KIND[k]?.test(name) && ANIMANIA_FOOD.test(name);
}
/** Soak 13 (C1): the animals the bot can see, by name (vanilla's passive animals and every Animania entity). */
const VANILLA_ANIMALS = new Set(['chicken', 'cow', 'mooshroom', 'pig', 'rabbit', 'sheep', 'horse', 'donkey', 'mule', 'llama', 'wolf', 'ocelot', 'parrot', 'polar_bear']);
export const isAnimal = (e) => !!e?.name && (VANILLA_ANIMALS.has(e.name) || /^animania:/.test(e.name));

// The ownership checks (mayBelongToPlayer and its helpers) live in ownership.js (#453 nit 2: no
// import cycle with threats.js); they are re-exported here for the existing importers.
export { PLAYER_BUILT, mayBelongToPlayer, nearBase, playerBuiltNear, knownBases, trackBotPlaced } from './ownership.js';

/**
 * #448 (soak 2's "gored to death", G4 #5): why hunting this animal would bring a fight the bot must
 * not take, or null. Within HUNT.retaliationRadius (16) of the animal or of the bot: an animal that
 * must not be fought (rotn-data provoked.fightBack false: an Animania bull, a polar bear, a panda, a
 * book wyrm); and, for an animal whose kind calls for help when hurt (Animania cows: every cow of
 * the breed within 16 joins in), another of its kind. A lone cow away from bulls is still hunted.
 * Not covered yet (#453 review 5): a polar bear near its cub attacks unprovoked (vanilla AIAttackPlayer).
 */
export function retaliationRisk(bot, target, { radius = HUNT.retaliationRadius } = {}) {
    const here = bot?.entity?.position;
    if (!target?.position) return null;
    const calls = !!threatFor(target)?.provoked?.callsForHelp;
    for (const e of Object.values(bot?.entities ?? {})) {
        if (!e?.position || e === target || e === bot.entity) continue;
        const near = e.position.distanceTo(target.position) <= radius || (!!here && e.position.distanceTo(here) <= radius);
        if (!near) continue;
        const p = threatFor(e)?.provoked;
        if (p && p.fightBack === false) return `a ${e.name} within ${radius} blocks (it charges whoever hurts it or its herd; never hunt near one)`;
        if (calls && e.name === target.name && e.position.distanceTo(target.position) <= radius)
            return `in a herd: another ${e.name} within ${radius} blocks, and its kind calls the herd when one is hurt`;
    }
    return null;
}

/** The nearest animal the bot may hunt (within radius, not a baby, not maybe a player's, no retaliation risk), or null; `skipped` gets the reasons. */
/**
 * Soak 11 (H2, rotn-data's soak 11 Animania food answer): a regular pig, cow or sheep drops 2-8 meat
 * (prime breeds 1-4); a rabbit 0-2 (none in a quarter of kills, half if unfed), at 2 hunger raw; the
 * soak 11 cottontail kill left no food. A pig, cow or sheep in range comes before a rabbit; then the
 * nearest. 0: worth a hunt first; 1: a rabbit.
 */
// #588 nit 2: the rabbit breeds by name (rotn-data); a goat doe (animania:doe_alpine, doe_kiko) is not a rabbit.
export const RABBIT_BREEDS = ['cottontail', 'dutch', 'havana', 'jack', 'lop', 'rex', 'new_zealand', 'chinchilla'];
const RABBIT = new RegExp(`^(animania:doe_(${RABBIT_BREEDS.join('|')})|rabbit)$`);
export const meatRank = (e) => (RABBIT.test(e?.name ?? '') ? 1 : 0);
const huntOrder = (here) => (a, b) => (meatRank(a) - meatRank(b)) || (a.position.distanceTo(here) - b.position.distanceTo(here));

export function huntTarget(bot, { bases = [], radius = HUNT.radius, skipped = [] } = {}) {
    const here = bot?.entity?.position;
    if (!here) return null;
    const animals = Object.values(bot.entities ?? {})
        .filter(e => e && e !== bot.entity && e.position && isHuntableAnimal(e) && e.position.distanceTo(here) <= radius && !skippedNow(bot, e))
        .sort(huntOrder(here));
    for (const e of animals) {
        const why = mayBelongToPlayer(bot, e, { bases }) ?? retaliationRisk(bot, e);
        if (!why) return e;
        skipped.push(`${e.name}: ${why}`);
    }
    return null;
}

/** The names of the wild animals near (within radius) the bot may hunt, a pig, cow or sheep before a rabbit, then nearest first (for the food reserve's prompt). */
export function nearbyHuntable(bot, { bases = [], radius = 32 } = {}) {
    const here = bot?.entity?.position;
    if (!here) return [];
    return Object.values(bot.entities ?? {})
        .filter(e => e && e !== bot.entity && e.position && isHuntableAnimal(e) && e.position.distanceTo(here) <= radius && !skippedNow(bot, e))
        .sort(huntOrder(here))
        .filter(e => !mayBelongToPlayer(bot, e, { bases }) && !retaliationRisk(bot, e))
        .map(e => e.name);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/**
 * One bounded hunt (#422 review 1: the reflex's attackEntity looped while the animal was within
 * 24 blocks, an unreachable cow kept the bot out after dark). mineflayer-pvp attacks; every
 * HUNT.checkMs the hunt ends when the animal is dead or gone, the bot is stopped, keepGoing() says
 * no (the phase is no longer day, a threat came), or after maxMs. pvp stops however it ends.
 * `equip`: the weapon equip (skills.equipHighestAttack; passed in, as skills imports this module's
 * users). Soak 2: it also ends 'stuck' when for HUNT.stuckMs the bot has not moved a block, got no
 * closer and hurt the animal no more (an animal out of reach: the unstuck reflex used to end it).
 * Returns 'killed' | 'gone' | 'interrupted' | 'stopped' | 'time' | 'stuck'.
 */
export async function huntAnimal(bot, entity, { keepGoing = () => true, maxMs = HUNT.maxMs, equip = null, stuckMs = HUNT.stuckMs } = {}) {
    try { await equip?.(bot); } catch { /* fights with what is in hand */ }
    logWeapon(bot, 'hunt'); // soak 7 (c)
    const start = Date.now();
    bot.pvp?.attack?.(entity);
    const health = () => (Number.isFinite(entity.metadata?.[7]) ? entity.metadata[7] : null); // 1.12 EntityLivingBase health
    // #431 review 5: horizontal distances only (an animal up a slope, or the bot bobbing up and
    // down in place, must not look like getting closer or moving).
    const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const dist = () => (bot.entity?.position && entity.position ? flat(entity.position, bot.entity.position) : Infinity);
    let mark = { at: start, pos: bot.entity?.position?.clone?.() ?? null, dist: dist(), health: health() };
    try {
        for (;;) {
            await sleep(HUNT.checkMs);
            if (!bot.entities?.[entity.id] || entity.isValid === false) return 'killed';
            if (bot.interrupt_code) return 'interrupted';
            if (!keepGoing()) return 'stopped';
            const now = Date.now();
            if (now - start >= maxMs) return 'time';
            const d = dist();
            if (d > 24) return 'gone';
            const h = health();
            const moved = mark.pos && bot.entity?.position ? flat(bot.entity.position, mark.pos) >= 1 : true;
            if (moved || d < mark.dist - 0.5 || (h !== null && mark.health !== null && h < mark.health))
                mark = { at: now, pos: bot.entity?.position?.clone?.() ?? null, dist: Math.min(d, mark.dist), health: h };
            else if (now - mark.at >= stuckMs) return 'stuck';
        }
    } finally {
        try { bot.pvp?.stop?.(); } catch { /* best effort */ }
    }
}

