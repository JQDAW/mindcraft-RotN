// Soak 13 (C1, the lead): fruitless !searchForEntity runs. On day 3 the model ran it 35 times (8 kinds,
// ranges 64 to 511, at two spots) and found nothing; each miss said only "Could not find any <kind> in N
// blocks", so it tried the next kind or a wider range. Now a miss says which animals are in sight (or that
// none of any kind is), that a range past what the bot can see finds no more, and after SEARCH_MISSES.count
// misses in one area that searching there again finds nothing more.

import { matchesKind, isAnimal, isAnimalKind } from './hunting.js';

/**
 * #601 review 1: the miss count and the animal lines (in sight, the 64-block range, the no-animals line) are for
 * animal kinds only (isAnimalKind); a search for a zombie or a villager is upstream's, as before.
 */
export { isAnimalKind };

/**
 * How far the bot knows animals (rotn-data, /home/rv/soak13-rotn-data-2.md, from the server and Forge jars and
 * the dumped entities.json): every Animania animal registers a Forge tracking range of 64, a square box
 * (|dx| <= 64 and |dz| <= 64, height ignored); vanilla animals 80, but In Control removes vanilla pigs, chickens
 * and rabbits and Animania replaces cows and sheep. The server sends no animal farther out, so a larger
 * search range finds no more.
 */
export const ENTITY_SIGHT = 64;
/**
 * The miss record: count misses within radius of the first miss and windowMs of it; sightList names at most.
 * moveAway: the walk the no-animals line asks for, two tracking boxes (the lead: a 64-block move still
 * overlaps half the old box; 128 accepted, #601 review 3). Moved 128 along an axis, the new box shares
 * nothing with the searched one; moved 128 diagonally, about 37 x 37 blocks of it still overlap.
 * Deliberately, the count starts again past radius (64), not past moveAway: a search after a shorter move
 * gets its own 3 misses, while the line asks for the longer walk.
 */
export const SEARCH_MISSES = { count: 3, radius: 64, windowMs: 10 * 60_000, sightList: 5, moveAway: 2 * ENTITY_SIGHT };

/**
 * The range to search: the asked range, below ENTITY_SIGHT; at it or above, every entity the bot knows
 * (Infinity: the server's box reaches up to 90 blocks toward its corners, all of it in sight).
 */
export const sightRange = (range) => (Number.isFinite(range) && range < ENTITY_SIGHT ? range : Infinity);
/** The range a reply names: the asked one, or ENTITY_SIGHT. */
export const rangeText = (r) => (Number.isFinite(r) ? r : ENTITY_SIGHT);

/** The nearest entity of the kind (matchesKind: its name, or the Animania food adults of a generic kind) within range, or null. */
export function nearestOfKind(bot, kind, range) {
    const here = bot?.entity?.position;
    if (!here || typeof bot.nearestEntity !== 'function') return null;
    return bot.nearestEntity(e => e && e !== bot.entity && e.position && matchesKind(e, kind) && here.distanceTo(e.position) < range) ?? null;
}

/** The animal kinds in sight (every one the server sends), nearest first, each once, at most SEARCH_MISSES.sightList. */
export function animalsInSight(bot) {
    const here = bot?.entity?.position;
    if (!here) return [];
    const seen = Object.values(bot.entities ?? {})
        .filter(e => e && e !== bot.entity && e.position && isAnimal(e))
        .sort((a, b) => here.distanceTo(a.position) - here.distanceTo(b.position))
        .map(e => e.name);
    return [...new Set(seen)].slice(0, SEARCH_MISSES.sightList);
}

/** A find: the area's misses are forgotten. */
export function noteSearchFind(agent) {
    if (agent) agent.searchMisses = null;
}

/**
 * A miss of `kind` at the bot's position: a new record when there is none, the first miss is more than
 * SEARCH_MISSES.radius away, or SEARCH_MISSES.windowMs has passed since it. Returns the record
 * {at, time, count, kinds}.
 */
export function noteSearchMiss(agent, kind, now = Date.now()) {
    const here = agent?.bot?.entity?.position;
    let r = agent.searchMisses;
    // #601 review 4: a record from a miss with no position (r.at missing) starts again too.
    if (!r || !here || !r.at || now - r.time > SEARCH_MISSES.windowMs || here.distanceTo(r.at) > SEARCH_MISSES.radius) {
        r = { at: here?.clone ? here.clone() : here, time: now, count: 0, kinds: [] };
    }
    r.count += 1;
    if (!r.kinds.includes(kind)) r.kinds.push(kind);
    agent.searchMisses = r;
    return r;
}

/**
 * The model's miss reply: the plain line, the range note when it asked past ENTITY_SIGHT, what is in sight,
 * and from the SEARCH_MISSES.count-th miss in the area, the no-animals line.
 */
export function missText(agent, kind, asked, range, record) {
    const sight = animalsInSight(agent.bot);
    let text = `Could not find any ${kind} in ${rangeText(range)} blocks.`;
    if (Number.isFinite(asked) && asked > ENTITY_SIGHT)
        text += ` You asked for ${asked}: the bot sees animals only within ${ENTITY_SIGHT} blocks, so a larger range finds no more.`;
    text += sight.length ? ` Animals in sight: ${sight.join(', ')}.` : ` No animal of any kind is in sight (${ENTITY_SIGHT} blocks).`;
    if (record && record.count >= SEARCH_MISSES.count) {
        const kinds = record.kinds.join(', ');
        const where = `(${record.count} times within ${SEARCH_MISSES.radius} blocks)`;
        // #601 review 2: with other animals in sight, "no animals" would contradict the line before it.
        text += (sight.length
            ? ` None of ${kinds} near here: you searched for them ${where}, and only the animals above are in sight. Searching again here for them finds nothing more:`
            : ` No animals near here: you searched for ${kinds} ${where} and no animal is in sight. Searching again here finds nothing more:`)
            + ` move more than ${SEARCH_MISSES.moveAway} blocks away, or do something else (!forage, or the agenda's other needs).`;
    }
    return text;
}
