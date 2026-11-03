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
//   ignore-unless-provoked  endermen and the like: never attack, never look at it; fight
//                           back only right after it hurt the bot
//   ignore                  not a threat
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
/** A provoked mob (one the bot must not look at) may be fought back this soon after a hit. */
const PROVOKED_MS = 3000;
const PROVOKED_DIST = 4;

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
            // rotn-data has no field for it yet; its summary says "Do not look at it".
            doNotLook: t.reaction === 'ignore-unless-provoked' && /do not look at it/i.test(t.summary ?? ''),
        } : null);
    }
    const known = cache.get(entity.name);
    if (known) return known;
    return mc.isHostile(entity)
        ? { name: entity.name, reaction: 'fight', level: 'hostile', explodes: false, ranged: false, doNotLook: false }
        : null;
}

/** Whether the bot must not look at this mob (an enderman's stare check). */
export const doNotLook = (entity) => !!threatFor(entity)?.doNotLook;

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

    const hurtAt = bot.lastDamageTime ?? 0;
    const provoked = near.find(x => x.t.reaction === 'ignore-unless-provoked' && x.d <= PROVOKED_DIST);
    if (provoked && now - hurtAt <= PROVOKED_MS) {
        const id = provoked.e.id;
        return { action: 'fight', why: 'provoked', from: provoked.e, isEnemy: (e) => e.id === id };
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
