// How the bot reacts to the mobs around it, from rotn-data's threat table
// (skills-rotn D2c; G3 (b) "survives the first night"). rotn-data's threatOf gives
// each mob a reaction from the research's hazard table, the mods' bytecode and the
// pack's configs (rotn-data #111, #115, #118, #120, #143, #178, #179). Until now
// nothing in src/agent read it: the modes fought or fled from anything with
// type 'mob' (mc.isHostile). Pure functions over the bot's state; the modes in
// modes.js act on the plan.
//
// Reactions (rotn-data README, threatOf):
//   avoid                   a dangerous mob (dragons, sea serpent, ...): flee, never fight
//   keep-distance           explodes (creepers, Fire Creepers): back off at once
//   take-cover              ranged (skeletons, witches, ...): get out of its range
//   fight                   melee: fight it, but retreat when two or more come at once
//                           (rotn-progression.md hazard table, zombies)
//   ignore-unless-provoked  endermen and the like: never attack, never look at it. Fight back
//                           only when that mob is angry (the enderman's "screaming" flag);
//                           for one whose flag is unknown, back off after a hit nearby
//   ignore                  not a threat
// Any mob, whatever its reaction, may also be one the bot must not look at (rotn-data's
// lookAt: false): idle_staring never looks at it, and no random look is made near it.
//
// rotn-data's sources (documented, vanilla, verified, inferred class rules) are treated the
// same: the inferred rules lean cautious (every creeper variant keeps its distance, skeleton
// variants take cover), so acting on them never makes the bot bolder (#186 review nit).
import { threatOf, nightThreats } from '../../../packages/rotn-data/index.js';
import * as mc from '../../utils/mcdata.js';

/** How far each reaction's mob is watched, and how far the bot moves away from it. */
export const RANGES = {
    avoid: { near: 24, away: 32 },
    'keep-distance': { near: 6, away: 10 },
    'take-cover': { near: 12, away: 18 },
    fight: { near: 8, away: 16 },
};
/** Retreat instead of fighting when this many melee mobs are within RANGES.fight.near. */
export const OUTNUMBERED = 2;
/** A mob whose anger the bot cannot read: back off this soon after a hit, this close to it. */
const PROVOKED_MS = 3000;
const PROVOKED_DIST = 4;
/**
 * Where a do-not-look mob shows it is angry: the 1.12 enderman's metadata index 13 ("screaming",
 * set while it targets a player; 12 is its carried block). Tied to the mob itself, not to any
 * damage the bot took (#186 review: fall damage next to an enderman made the bot attack it).
 */
const ANGRY_FLAG = { enderman: 13 };

const cache = new Map();

/**
 * The bot's view of a mob: {name, reaction, level, explodes, ranged, doNotLook}, or null for
 * players, items and the like. A mob rotn-data does not know falls back to mc.isHostile: fight.
 */
export function threatFor(entity) {
    if (!entity || typeof entity.name !== 'string' || entity.type === 'player' || entity.type === 'object' || entity.name === 'item') return null;
    if (!cache.has(entity.name)) {
        let t = null;
        try { t = threatOf(entity.name); } catch { t = null; }
        cache.set(entity.name, t ? {
            name: entity.name,
            reaction: t.reaction,
            level: t.level,
            explodes: !!t.explodes,
            ranged: !!t.ranged,
            // rotn-data's lookAt (#187): false for a mob that targets whoever looks at it (the
            // enderman family, the ender creeper) or whose gaze needs a look back (the cockatrice).
            doNotLook: t.lookAt === false,
        } : null);
    }
    const known = cache.get(entity.name);
    if (known) return known;
    return mc.isHostile(entity)
        ? { name: entity.name, reaction: 'fight', level: 'hostile', explodes: false, ranged: false, doNotLook: false }
        : null;
}

/**
 * A mob that carries the bot's name (G3 round 2: "Zombie FRCFLD" killed the bot at its death
 * spot; a pack mod raises a zombie from a dead player, carrying its items; rotn-data is naming
 * the mod). Read from the custom name (1.12 metadata 2), a player-like username or the display
 * name, never the bot itself. Such a mob is a strong threat: flee, never fight.
 */
export function namedAfter(entity, username) {
    if (!entity || !username || (entity.type === 'player' && entity.username === username)) return false;
    const want = String(username).toLowerCase();
    const names = [entity.customName, entity.metadata?.[2], entity.username, entity.displayName, entity.nametag];
    return names.some(n => typeof n === 'string' && n.toLowerCase().includes(want));
}

/** Whether the bot must not look at this mob (an enderman's stare check). */
export const doNotLook = (entity) => !!threatFor(entity)?.doNotLook;

/** Whether a do-not-look mob is loaded within range (an enderman's stare check reaches 64 blocks). */
export function doNotLookNear(bot, range = 64) {
    const me = bot.entity?.position;
    if (!me) return false;
    return Object.values(bot.entities ?? {}).some(e => e !== bot.entity && e?.position && doNotLook(e) && e.position.distanceTo(me) <= range);
}

/** true: the mob is angry (it targets a player); false: calm; null: its anger cannot be read. */
export function isAngry(entity) {
    const i = ANGRY_FLAG[entity?.name];
    if (i === undefined) return null;
    return entity.metadata?.[i] === true;
}

/**
 * What to do about the mobs around the bot now. First match wins:
 * flee a dangerous mob, back off from one that explodes, retreat when outnumbered, get out of
 * a ranged mob's range, fight a melee mob, fight back a provoked one.
 * @returns {{action: 'flee'|'fight', why: string, from: object, away?: number, isEnemy: (e) => boolean}|null}
 *   isEnemy: the mobs the action is about (for skills.avoidEnemies / defendSelf).
 */
export function threatPlan(bot, { now = Date.now() } = {}) {
    const me = bot.entity?.position;
    if (!me) return null;
    const near = [];
    for (const e of Object.values(bot.entities ?? {})) {
        if (e === bot.entity || !e?.position) continue;
        const t = threatFor(e);
        if (!t || t.reaction === 'ignore') continue;
        near.push({ e, t, d: e.position.distanceTo(me) });
    }
    near.sort((a, b) => a.d - b.d);
    // A mob carrying the bot's name comes first: it killed the bot before (round 2).
    const mine = bot.username ? Object.values(bot.entities ?? {})
        .filter(e => e !== bot.entity && e?.position && namedAfter(e, bot.username) && e.position.distanceTo(me) <= RANGES.avoid.near)
        .sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me)) : [];
    if (mine.length) {
        return { action: 'flee', why: 'it carries your name (a risen player zombie)', from: mine[0], away: RANGES.avoid.away,
            isEnemy: (e) => namedAfter(e, bot.username) };
    }
    const within = (reaction) => near.filter(x => x.t.reaction === reaction && x.d <= RANGES[reaction].near);
    const is = (reaction) => (e) => threatFor(e)?.reaction === reaction;

    const avoid = within('avoid');
    if (avoid.length) return { action: 'flee', why: 'dangerous', from: avoid[0].e, away: RANGES.avoid.away, isEnemy: is('avoid') };
    const boom = within('keep-distance');
    if (boom.length) return { action: 'flee', why: 'explodes', from: boom[0].e, away: RANGES['keep-distance'].away, isEnemy: is('keep-distance') };
    const melee = within('fight');
    if (melee.length >= OUTNUMBERED) {
        return { action: 'flee', why: 'outnumbered', from: melee[0].e, away: RANGES.fight.away, isEnemy: (e) => ['fight', 'take-cover'].includes(threatFor(e)?.reaction) };
    }
    const ranged = within('take-cover');
    if (ranged.length) return { action: 'flee', why: 'ranged', from: ranged[0].e, away: RANGES['take-cover'].away, isEnemy: is('take-cover') };
    if (melee.length) return { action: 'fight', why: 'melee', from: melee[0].e, isEnemy: is('fight') };

    const calmOnes = near.filter(x => x.t.reaction === 'ignore-unless-provoked' && x.d <= PROVOKED_DIST);
    const angry = calmOnes.find(x => isAngry(x.e) === true);
    if (angry) {
        const id = angry.e.id;
        return { action: 'fight', why: 'provoked', from: angry.e, isEnemy: (e) => e.id === id };
    }
    // Its anger cannot be read: never attack it; after a hit right next to it, back off.
    const unread = calmOnes.find(x => isAngry(x.e) === null);
    if (unread && now - (bot.lastDamageTime ?? 0) <= PROVOKED_MS) {
        const id = unread.e.id;
        return { action: 'flee', why: 'provoked', from: unread.e, away: RANGES.fight.away, isEnemy: (e) => e.id === id };
    }
    return null;
}

/**
 * The night's likely mobs and what to do about each, as one line for a prompt (the night
 * routine, D2b): "Tonight expect: Zombie (fight), Creeper (keep-distance, explodes), ...".
 */
export function nightThreatNote({ biome, limit = 6 } = {}) {
    let list = [];
    try { list = nightThreats({ biome, limit }) ?? []; } catch { list = []; }
    if (!list.length) return '';
    const items = list.map(t => {
        const extra = [t.explodes ? 'explodes' : null, t.ranged ? 'ranged' : null].filter(Boolean);
        return `${t.displayName ?? t.name} (${[t.reaction, ...extra].join(', ')})`;
    });
    return `Tonight expect: ${items.join('; ')}.`;
}
