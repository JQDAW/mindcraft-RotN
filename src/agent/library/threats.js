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
import { threatOf, nightThreats, UNKNOWN_MELEE } from '../../../packages/rotn-data/index.js';
import * as mc from '../../utils/mcdata.js';
import { mayBelongToPlayer } from './ownership.js';

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
/** #448: how much farther than its reach an animal may stand and still be taken for the one that hit (it closes in to swing). */
const PROVOKED_REACH_SLACK = 1;

/**
 * #448 (soak 2's "gored to death"): whether a recent hit counts as this provoked animal's. With
 * rotn-data's provoked block: the hit was at least its damage, or it stood within its reach (+1).
 * Starving, a fall or another mob's small hit next to it no longer count. Without that block, as
 * before: any hit while it is within PROVOKED_DIST.
 */
function hitByIt(bot, x, now) {
    if (now - (bot.lastDamageTime ?? -Infinity) > PROVOKED_MS) return false;
    const p = x.t.provoked;
    if (!p) return x.d <= PROVOKED_DIST;
    if (worldDamage(bot)) return false; // #453 review 1
    return x.d <= (p.reach ?? 2) + PROVOKED_REACH_SLACK || (Number.isFinite(p.damage) && (bot.lastDamageTaken ?? 0) >= p.damage);
}

/**
 * #453 review 1: damage the world did, never an animal's hit: a fall (damage_record.js), or
 * starving (food 0 and 1 damage).
 */
const worldDamage = (bot) => bot.lastDamageCause === 'fall' || bot.lastDamageCause === 'starving'
    || (bot.food === 0 && (bot.lastDamageTaken ?? 0) <= 1);

/**
 * #453 review 1 (BLOCKER): hitting an animal back needs more than hitByIt: the hit was at least its
 * damage AND it stood within its reach (+1) AND the world did not do it. A false fight on the live
 * server would hit a player's wolf or llama.
 */
function fightsBack(bot, x, now) {
    const p = x.t.provoked;
    return !!p && now - (bot.lastDamageTime ?? -Infinity) <= PROVOKED_MS && !worldDamage(bot)
        && x.d <= (p.reach ?? 2) + PROVOKED_REACH_SLACK && Number.isFinite(p.damage) && (bot.lastDamageTaken ?? 0) >= p.damage;
}

/** #453 review 1: whether this animal may be a player's (mayBelongToPlayer, the bot's known bases); unreadable: yes. */
function ownedMaybe(bot, e) {
    try { return !!mayBelongToPlayer(bot, e, { bases: bot.rotnBases?.() ?? [] }); } catch { return true; }
}
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
            // rotn-data #448: an animal that hits back when hurt ({damage, reach?, callsForHelp,
            // fightBack, ...}; fightBack false: never fight it, get away), or null.
            provoked: t.provoked ?? null,
            // rotn-data #496 (mob-melee.json): {damage, maxDamage, hitsThroughWalls?, reach?}, or null
            // when unknown (never zero: maxHitOf assumes UNKNOWN_MELEE).
            melee: t.melee ? { damage: t.melee.damage, maxDamage: t.melee.maxDamage ?? t.melee.damage,
                hitsThroughWalls: !!t.melee.hitsThroughWalls, reach: Number.isFinite(t.melee.reach) ? t.melee.reach : null } : null,
        } : null);
    }
    const known = cache.get(entity.name);
    if (known) return known;
    return mc.isHostile(entity)
        ? { name: entity.name, reaction: 'fight', level: 'hostile', explodes: false, ranged: false, doNotLook: false, melee: null }
        : null;
}

/**
 * A mob to hit from inside the night shelter (#331 review 1): any mob rotn-data does not ignore,
 * whatever the plan says (two zombies, a skeleton or a creeper near make the plan 'flee', and
 * cowardice is quiet in the shelter, so the zombie in the opening was never hit). Never a calm mob
 * (ignore-unless-provoked) and never one that must not be looked at (the enderman family).
 */
export function shelterEnemy(entity) {
    const t = threatFor(entity);
    return !!t && !t.doNotLook && t.reaction !== 'ignore' && t.reaction !== 'ignore-unless-provoked';
}

/**
 * Soak 5 (rotn-v0.1.11, 00:46): the bot swung six times from its pocket shelter at an Ice and Fire
 * troll (avoid: 18 attack, 200 health, armor 9; "4 hits did not hurt"), took one hit of 18 and died.
 * The lead's rule: the bot hits only a melee mob (reaction 'fight'), whatever the shelter state
 * (closed, open, the hand fight, the morning fight) and in a cell it closes (shelter.hitOutOf);
 * never one to avoid, keep away from or take cover from, and never one it must not look at.
 * shelterEnemy stays the presence check (what is near the shelter); this is what may be hit.
 */
export function shelterTarget(entity) {
    const t = threatFor(entity);
    return !!t && !t.doNotLook && t.reaction === 'fight';
}

/**
 * Zombie Players' zombie (G3 round 2: "Zombie FRCFLD" killed the bot at its death spot). The mod
 * raises one where any player died; its name is not readable here (it is in the undecoded FML
 * spawn data), so it is matched by its entity type (rotn-data #226: a zombie that never despawns).
 */
export const PLAYER_ZOMBIE = 'zombie_players:zombie_player';
export const isPlayerZombie = (entity) => entity?.name === PLAYER_ZOMBIE;

/**
 * Soak 2 (rotn-v0.1.4, 22:47): the bot fought a slime with its hands, fell from health 20 to 2 in
 * about 4 s, and died moments later. A big slime does its size in damage per hit (4 for the largest), splits
 * when killed, and has +3 health on this pack (config/roughmobsrevamped.cfg). A slime of size
 * SLIME.bigSize or more is fought only with a weapon and health of SLIME.minHealth or more;
 * otherwise the bot keeps away from it. Tiny slimes are fought as before. rotn-data's entry for
 * slime stays 'fight' (vanilla); the size rule is the bot's (a size-aware entry is requested).
 */
export const SLIME = { bigSize: 2, minHealth: 14, sizeIndex: 12, minAttack: 4 };
// #434 review: magma cubes split and hit by size the same way.
const SLIMES = /(^|:)([a-z_]*slime|magma_cube)$/;
/**
 * #434 review (a): a crude axe is no real weapon. Attack damage on this pack: the pack's
 * config/materialchanger.cfg (active ATTACK_DAMAGE lines: stone axe 3, stone sword 3.5, crude axe 3,
 * diamond sword 8, diamond axe 7, redstone sword 7, bone sword 4; the iron and golden lines at the top
 * of that file are commented-out examples), else vanilla 1.12 for the items it leaves alone (wooden
 * sword 4, iron sword 6, golden sword 4, wooden axe 7, iron axe 9, golden axe 7). An item not listed
 * counts as no real weapon (fail safe). To move to rotn-data as a cited table.
 */
export const WEAPON_ATTACK = {
    'pyrotech:crude_axe': 3, 'minecraft:stone_axe': 3, 'minecraft:stone_sword': 3.5, 'minecraft:wooden_sword': 4, 'minecraft:wooden_axe': 7,
    'minecraft:iron_sword': 6, 'minecraft:iron_axe': 9, 'minecraft:golden_sword': 4, 'minecraft:golden_axe': 7,
    'minecraft:diamond_sword': 8, 'minecraft:diamond_axe': 7, 'pyrotech:redstone_sword': 7, 'mod_lavacow:bonesword': 4,
};
const fullItemName = (n) => (n.includes(':') ? n : `minecraft:${n}`);
/** The bot's best attack damage among the weapons it carries (WEAPON_ATTACK), or 0. */
export function bestAttack(bot) {
    const items = [...(bot?.inventory?.items?.() ?? []), bot?.inventory?.slots?.[45]];
    return Math.max(0, ...items.map(i => (typeof i?.name === 'string' ? WEAPON_ATTACK[fullItemName(i.name)] ?? 0 : 0)));
}
/** A slime's size (1.12 EntitySlime metadata index 12), or null when it cannot be read. */
export const slimeSize = (e) => (Number.isInteger(e?.metadata?.[SLIME.sizeIndex]) ? e.metadata[SLIME.sizeIndex] : null);
/** A slime (any mod's: slime, specialmobs:lemonslime, primitivemobs:brain_slime) or a magma cube that is big, or of unknown size. */
export const isBigSlime = (e) => typeof e?.name === 'string' && SLIMES.test(e.name) && !(slimeSize(e) !== null && slimeSize(e) < SLIME.bigSize);
export const canFightSlime = (bot) => bestAttack(bot) >= SLIME.minAttack && bot?.health >= SLIME.minHealth;

/** A sword or an axe (not a pickaxe) in the inventory or the off hand (slot 45; #227 nit). */
export function hasWeapon(bot) {
    const items = [...(bot?.inventory?.items?.() ?? []), bot?.inventory?.slots?.[45]];
    return items.some(i => typeof i?.name === 'string' && /sword|(^|[:_])axe$/.test(i.name));
}

/**
 * The lead's policy for a player zombie (#227 review 1): fight only with a weapon and health
 * above half; otherwise get away.
 */
export const canFightHard = (bot) => hasWeapon(bot) && bot?.health > 10;

/**
 * The most a mob hits for (rotn-data #496, mob-melee.json maxDamage: with the strongest item it may
 * be given, a zombie's stone axe), or UNKNOWN_MELEE (18, the troll's) when rotn-data has no entry
 * for it, or for no mob: null means unknown, never zero.
 */
export function maxHitOf(entity) {
    const m = entity ? threatFor(entity)?.melee : null;
    return Number.isFinite(m?.maxDamage) ? m.maxDamage : UNKNOWN_MELEE;
}

const round1 = (v) => Math.round(v * 10) / 10;
const shortName = (e) => (typeof e?.name === 'string' ? e.name.replace(/^minecraft:/, '') : null);

/**
 * Soak 5 (rotn-v0.1.11), the lead's rule for a fight: at health 1.5 the bot started a fight with a
 * zombie and died within a second (01:00:11); respawned with no weapon, it fought a zombie by hand
 * for 15 s and died (01:00:40). A melee mob is fled from, not fought, with no weapon or at a health
 * that one hit of it may take (PR 5, the lead's rule: health <= maxHitOf(mob); Fix G used 8). Only
 * a cornered bot hits back: skills.avoidEnemies hits a fight mob that keeps within 3 blocks while it
 * tries to get away.
 *
 * Why the bot must not start or go on with a fight against `mob` now ('no weapon', 'health 12, a
 * zombie hits up to 12.5'), or null. Without a mob, the unknown mob's UNKNOWN_MELEE.
 */
export function fightRefusal(bot, mob = null) {
    if (!hasWeapon(bot)) return 'no weapon';
    const h = bot?.health, max = maxHitOf(mob);
    if (!Number.isFinite(h) || h > max) return null;
    const name = shortName(mob);
    const who = name ? `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}` : 'an unknown mob';
    return `health ${round1(h)}, ${who} hits up to ${round1(max)}`;
}

/** A 'fight' plan becomes a flee from the same mobs when fightRefusal says so. */
function unlessRefused(bot, plan) {
    const why = fightRefusal(bot, plan.from);
    if (!why) return plan;
    return { action: 'flee', why: `${plan.why}, and ${why}`, from: plan.from, away: RANGES.fight.away, isEnemy: plan.isEnemy };
}

/**
 * Whether this mob hurt the bot: it is angry, or the bot was hit within PROVOKED_MS (3 s) while it
 * was within PROVOKED_DIST (4 blocks). An approximation (#227 nit): 1.12 sends the bot's health
 * and a hurt animation but not who dealt the damage, so another mob's hit, an arrow or fall damage
 * with this mob close by counts too; and a mob that hit from farther away does not.
 */
export function hurtBy(bot, entity, { now = Date.now() } = {}) {
    if (!entity?.position || !bot?.entity?.position) return false;
    if (isAngry(entity) === true) return true;
    return now - (bot.lastDamageTime ?? -Infinity) <= PROVOKED_MS && entity.position.distanceTo(bot.entity.position) <= PROVOKED_DIST;
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
 * a ranged mob's range, fight a melee mob, fight back a provoked one. A fight is a flee instead
 * with no weapon or at a health one hit of that mob may take (fightRefusal, soak 5, PR 5).
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
    // A player zombie (round 2): fought like a zombie only with a weapon and health above half;
    // otherwise avoided from the avoid range (#227 review 1).
    const zombies = near.filter(x => isPlayerZombie(x.e) && x.d <= RANGES.avoid.near);
    if (zombies.length && !canFightHard(bot)) {
        return { action: 'flee', why: 'a player zombie, and no weapon or health at half or less', from: zombies[0].e,
            away: RANGES.avoid.away, isEnemy: isPlayerZombie };
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
    // Soak 2: a big slime, with no real weapon (attack SLIME.minAttack) or health under
    // SLIME.minHealth: keep away from it. #434 review (b): after a creeper (it steers by the
    // creeper) and after being outnumbered. #434 nit: a ranged mob near as well steers the flee (it
    // shoots from farther), and the walk keeps away from the slime too. No parentheses in the why:
    // fleeLine turns them to spaces.
    const slimes = canFightSlime(bot) ? [] : near.filter(x => isBigSlime(x.e) && x.d <= RANGES.fight.near);
    const ranged = within('take-cover');
    if (ranged.length) {
        const shoots = is('take-cover');
        return { action: 'flee', why: 'ranged', from: ranged[0].e, away: RANGES['take-cover'].away,
            isEnemy: slimes.length ? (e) => shoots(e) || isBigSlime(e) : shoots };
    }
    if (slimes.length) {
        const size = slimeSize(slimes[0].e);
        return { action: 'flee', why: `a big slime of size ${size ?? 'unknown'}, and no weapon of attack ${SLIME.minAttack} or more, or health under ${SLIME.minHealth}`,
            from: slimes[0].e, away: RANGES.fight.away, isEnemy: isBigSlime };
    }
    if (melee.length) return unlessRefused(bot, { action: 'fight', why: 'melee', from: melee[0].e, isEnemy: is('fight') });

    const calmOnes = near.filter(x => x.t.reaction === 'ignore-unless-provoked' && x.d <= PROVOKED_DIST);
    const angry = calmOnes.find(x => isAngry(x.e) === true);
    if (angry) {
        const id = angry.e.id;
        return unlessRefused(bot, { action: 'fight', why: 'provoked', from: angry.e, isEnemy: (e) => e.id === id });
    }
    // Its anger cannot be read: never attack it unprovoked. After its hit (hitByIt), rotn-data's
    // fightBack decides (#448, the lead's decision): true (a rooster, a wolf, a llama): hit it back;
    // false (an Animania bull: 5 a hit, 24 health; a polar bear, a panda, a book wyrm) or no data:
    // back off, RANGES.fight.away (a bull loses its target past 16 blocks), from it and the others
    // it calls for help.
    // #453 review 1: fightBack true is hit back only on fightsBack (its own hit, not the world's),
    // and never when it may be a player's (a tamed wolf, a chested llama): then the bot backs off.
    // #453 nit 1: each animal by its own rule in the search, so one that did not react (a rooster
    // next to a ferret's peck) neither hides a second one that did nor the herd below.
    const reacts = (x) => isAngry(x.e) === null && (x.t.provoked?.fightBack === true ? fightsBack(bot, x, now) : hitByIt(bot, x, now));
    const hitter = calmOnes.find(reacts);
    if (hitter) {
        const id = hitter.e.id, name = hitter.e.name, p = hitter.t.provoked;
        const flee = { action: 'flee', why: 'provoked', from: hitter.e, away: RANGES.fight.away,
            isEnemy: (e) => e.id === id || (!!p?.callsForHelp && e.name === name) };
        if (p?.fightBack !== true) return flee;
        if (ownedMaybe(bot, hitter.e)) return { ...flee, why: 'provoked, and it may be a player\'s' };
        return unlessRefused(bot, { action: 'fight', why: 'provoked', from: hitter.e, isEnemy: (e) => e.id === id });
    }
    // #448: a food animal whose kind calls for help (Animania cows: the whole herd of the breed comes):
    // a hit with two of one kind within reach is the herd: back off from it. #453 review 1: never
    // for a fall or starving.
    if (now - (bot.lastDamageTime ?? -Infinity) <= PROVOKED_MS && !worldDamage(bot)) {
        const herd = new Map();
        for (const e of Object.values(bot.entities ?? {})) {
            if (e === bot.entity || !e?.position) continue;
            const p = threatFor(e)?.provoked;
            if (!p?.callsForHelp || e.position.distanceTo(me) > (p.reach ?? 2) + PROVOKED_REACH_SLACK) continue;
            herd.set(e.name, [...(herd.get(e.name) ?? []), e]);
        }
        const mob = [...herd.values()].find(list => list.length >= 2);
        if (mob) {
            const name = mob[0].name;
            return { action: 'flee', why: 'a herd fights back', from: mob[0], away: RANGES.fight.away, isEnemy: (e) => e.name === name };
        }
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
