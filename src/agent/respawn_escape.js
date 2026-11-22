// Soak 10 (rotn-v0.1.16, 15:51-16:16): 53 deaths in a ring around the world spawn. Every death raised
// a player zombie (Zombie Players: it never burns, never despawns, targets a player it sees within 16);
// the bot respawned among them with nothing, and two flights cut each other off: cowardice's "Moved 32
// away" and the night routine's 24-block walk from the death spots (a walk, not a sprint, that could
// dig). The day relocate (respawn_relocate.js) never started: it waits while a reflex is active, and
// cowardice always was. Each respawn was caught in 13 to 25 s.
//
// The lead's plan (R1-R6, approved 2026-11-22):
// R1: right after a respawn, at any time of day, with a death spot of the last 30 min or a player
//     zombie within ESCAPE_RUN.trigger of the bot or the world spawn: one escape job owns the bot
//     (cowardice, self_defense, unstuck, item pickup, hunting, eating, the night routine, the agenda
//     and the model's commands wait; self_preservation stays on). It sprints, fall-safe, with no
//     digging, building, pickups or fights, away from the weighted centre (1/d^2) of every recent
//     death spot, the spawn square and the hostiles near, re-aimed every second, until it is
//     ESCAPE_RUN.away from every death spot and from the spawn square (spawnRadius 10), at most
//     ESCAPE_RUN.maxMs. A mob on the way: re-aim, never stop; a hit: keep running. At a walk when
//     food is ESCAPE_RUN.walkFood or lower (food 0 kills).
// R2: at night the shelter goes where the escape ended, a hole first (night_routine: escapedRecently).
// R6: the Scroll of New Life (lifescroll:spawnscroll) sets the respawn point where the bot stands
//     (rotn-data: forced spawn, respawn within ~2 blocks; deaths within 32 blocks of it raise no
//     player zombie). The bot uses it once, by skill, never the model: at its first night shelter
//     site at least SCROLL.away from the spawn square and every death spot, with no hostile within
//     SCROLL.quiet.

import pf from 'mineflayer-pathfinder';
import { isPlayerZombie } from './library/threats.js';
import * as mc from '../utils/mcdata.js';
import { safeError } from './safe_error.js';
import { isGiverGoal } from './agenda_driver.js';
import { placesToLeave } from './respawn_relocate.js';

/**
 * away: blocks from every recent death spot and from the spawn square; spawnRadius: the spawn
 * square's half side (the spawnRadius gamerule, 10: a respawn lands within it); trigger: a death
 * spot or a player zombie this near the bot or the spawn starts it; afterDeathMs: how soon after a
 * death it may start; hostileRange: hostiles that steer the aim; aimMs: how often it re-aims; ahead:
 * how far ahead each aim points; checkMs: its poll; maxMs: its cap; walkFood: at or below, no sprint;
 * tries: runs per death (one a reflex cut short is run again); pitWithinMs: an escape this recent
 * makes the night shelter a hole (R2).
 */
export const ESCAPE_RUN = { away: 64, spawnRadius: 10, trigger: 48, afterDeathMs: 3 * 60_000, hostileRange: 32, aimMs: 1000, ahead: 16,
    checkMs: 250, maxMs: 60_000, walkFood: 6, tries: 3, pitWithinMs: 3 * 60_000 };
/** The modes the escape pauses while it runs (self_preservation stays on). */
export const ESCAPE_PAUSES = ['cowardice', 'self_defense', 'unstuck', 'item_collecting', 'hunting', 'eating', 'torch_placing', 'elbow_room'];

const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const at = (p) => `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;

/** Horizontal distance from p to a place: a death spot's point, or the spawn's square (spawnRadius each way). */
export function placeDistance(p, place, spawnRadius = ESCAPE_RUN.spawnRadius) {
    if (place.what !== 'spawn') return hdist(p, place.pos);
    const dx = Math.max(0, Math.abs(p.x - place.pos.x) - spawnRadius), dz = Math.max(0, Math.abs(p.z - place.pos.z) - spawnRadius);
    return Math.hypot(dx, dz);
}
const nearestOf = (p, places) => (places.length ? Math.min(...places.map(q => placeDistance(p, q))) : Infinity);

/** The hostile mobs (a player zombie, or any mcdata hostile) within range of the bot. */
export function hostilesNear(bot, range = ESCAPE_RUN.hostileRange) {
    const here = bot?.entity?.position;
    if (!here) return [];
    return Object.values(bot.entities ?? {}).filter(e => e && e !== bot.entity && e.position && e.position.distanceTo(here) <= range
        && (isPlayerZombie(e) || (() => { try { return mc.isHostile(e); } catch { return false; } })()));
}

/**
 * Why the bot must escape now ({places, key}), or null: a death in the last ESCAPE_RUN.afterDeathMs
 * not escaped from yet, a recent death spot or a player zombie within ESCAPE_RUN.trigger of the bot or
 * the spawn, and the bot not yet ESCAPE_RUN.away from them all.
 */
export function escapeReason(agent, now = Date.now()) {
    const bot = agent?.bot;
    const here = bot?.entity?.position;
    const last = agent?._death?.last;
    if (!here || !last || !Number.isFinite(last.at) || now - last.at > ESCAPE_RUN.afterDeathMs) return null;
    if (Number.isFinite(bot.health) && bot.health <= 0) return null; // not respawned yet
    const r = agent._escape ??= { forDeath: null, tries: 0, job: null, endedAt: null };
    if (r.forDeath === last.at && (r.done || r.tries >= ESCAPE_RUN.tries)) return null;
    const places = placesToLeave(agent, now);
    const spawn = places.find(p => p.what === 'spawn');
    const deaths = places.filter(p => p.what === 'death spot');
    const near = (p) => hdist(p, here) <= ESCAPE_RUN.trigger || (spawn && hdist(p, spawn.pos) <= ESCAPE_RUN.trigger);
    const zombie = Object.values(bot.entities ?? {}).some(e => e && e !== bot.entity && e.position && isPlayerZombie(e) && near(e.position));
    if (!deaths.some(d => near(d.pos)) && !zombie) return null;
    if (nearestOf(here, places) >= ESCAPE_RUN.away) return null;
    return { places, key: last.at };
}

/**
 * The point ESCAPE_RUN.ahead from the bot away from the weighted centre (1/d^2) of the places (the
 * spawn's square by its nearest point) and the hostiles near. Straight away from the spawn when the
 * pulls cancel out.
 */
export function aimPoint(bot, places, hostiles = hostilesNear(bot)) {
    const here = bot.entity.position;
    let vx = 0, vz = 0;
    const pull = (x, z) => {
        let dx = here.x - x, dz = here.z - z;
        const d = Math.max(1, Math.hypot(dx, dz));
        dx /= d; dz /= d;
        vx += dx / (d * d); vz += dz / (d * d);
    };
    for (const p of places) {
        if (p.what === 'spawn') {
            const r = ESCAPE_RUN.spawnRadius;
            pull(Math.min(Math.max(here.x, p.pos.x - r), p.pos.x + r), Math.min(Math.max(here.z, p.pos.z - r), p.pos.z + r));
        } else pull(p.pos.x, p.pos.z);
    }
    for (const h of hostiles) pull(h.position.x, h.position.z);
    let len = Math.hypot(vx, vz);
    if (len < 1e-9) {
        const s = places.find(p => p.what === 'spawn')?.pos;
        vx = s ? here.x - s.x : 1; vz = s ? here.z - s.z : 0;
        len = Math.hypot(vx, vz) || 1;
        if (!s || len < 1e-9) { vx = 1; vz = 0; len = 1; }
    }
    return { x: Math.round(here.x + vx / len * ESCAPE_RUN.ahead), z: Math.round(here.z + vz / len * ESCAPE_RUN.ahead) };
}

/** The escape's movements: fall-safe (installWalkSafety), sprinting per bot.rotnSprint, and no digging, towers, scaffolding or parkour. */
export function escapeMovements(bot) {
    const m = new pf.Movements(bot);
    m.canDig = false;
    m.allow1by1towers = false;
    m.allowParkour = false;
    m.scafoldingBlocks = [];
    return m;
}

/**
 * The run itself: re-aimed every ESCAPE_RUN.aimMs until ESCAPE_RUN.away from every place, the cap,
 * or a stop. Returns {arrived, far, ms, stopped?}. ops: setGoal(bot, x, z), sleep(ms), now().
 */
export async function escapeRun(bot, places, { now = () => Date.now(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), setGoal = null } = {}) {
    const start = now();
    const far = () => nearestOf(bot.entity.position, places);
    const goTo = setGoal ?? ((b, x, z) => b.pathfinder.setGoal(new pf.goals.GoalNearXZ(x, z, 2)));
    if (!setGoal) bot.pathfinder.setMovements(escapeMovements(bot));
    let aimed = -Infinity;
    try {
        for (;;) {
            const d = far();
            if (d >= ESCAPE_RUN.away) return { arrived: true, far: d, ms: now() - start };
            if (bot.interrupt_code) return { arrived: false, far: d, ms: now() - start, stopped: 'interrupted' };
            if (now() - start >= ESCAPE_RUN.maxMs) return { arrived: false, far: d, ms: now() - start, stopped: 'time' };
            if (now() - aimed >= ESCAPE_RUN.aimMs) {
                const t = aimPoint(bot, places);
                goTo(bot, t.x, t.z);
                aimed = now();
            }
            await sleep(ESCAPE_RUN.checkMs);
        }
    } finally {
        if (!setGoal) { try { bot.pathfinder.setGoal(null); } catch { /* best effort */ } }
    }
}

/** Whether an escape ended within ESCAPE_RUN.pitWithinMs (R2: the night shelter there is a hole). */
export function escapedRecently(agent, now = Date.now()) {
    const t = agent?._escape?.endedAt;
    return Number.isFinite(t) && now - t <= ESCAPE_RUN.pitWithinMs;
}

/**
 * One check, from the priority stack before the night routine: 'escaping' while the escape runs (the
 * night routine, the agenda and the model's goal wait), else null. A task giver's typed goal waits for
 * it too (a respawn among zombies is no time for a walk elsewhere). Never throws.
 */
export function respawnEscapeTick(agent, { now = Date.now(), run = escapeRun, log = (l) => console.log(l) } = {}) {
    const r = agent._escape ??= { forDeath: null, tries: 0, job: null, endedAt: null };
    if (r.job) return 'escaping';
    let why = null;
    try { why = escapeReason(agent, now); } catch (err) { log(`[respawn] escape check: ${safeError(err)}`); why = null; }
    if (!why) return null;
    if (r.forDeath !== why.key) Object.assign(r, { forDeath: why.key, tries: 0, done: false });
    r.tries++;
    const bot = agent.bot;
    const deaths = why.places.filter(p => p.what === 'death spot').length;
    const what = [why.places.some(p => p.what === 'spawn') ? 'the spawn' : null, deaths ? `${deaths} recent death spot${deaths === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ');
    const sprint = !(Number.isFinite(bot.food) && bot.food <= ESCAPE_RUN.walkFood);
    const zombies = hostilesNear(bot).filter(isPlayerZombie).length;
    log(`[respawn] escape (try ${r.tries} of ${ESCAPE_RUN.tries}): ${sprint ? 'sprinting' : `walking (food ${bot.food})`} at least ${ESCAPE_RUN.away} blocks from ${what}`
        + `${zombies ? `, ${zombies} player zombie${zombies === 1 ? '' : 's'} near` : ''}; no digging, no pickups, no fights`);
    const sp = agent.self_prompter;
    if (sp?.isActive?.() && !isGiverGoal(agent)) sp.stop(false);
    agent._agenda_paused = true;
    const modes = bot.modes;
    for (const m of ESCAPE_PAUSES) { try { modes?.pause?.(m); } catch { /* not every mode exists */ } }
    const wasSprint = bot.rotnSprint;
    bot.rotnSprint = sprint;
    bot.rotnEscaping = true; // unstuck holds off (modes.js)
    let result = null;
    r.job = Promise.resolve()
        .then(() => agent.actions.runAction('action:respawnEscape', async () => { result = await run(bot, why.places); }, { keepReplan: true }))
        .catch(err => { log(`[respawn] the escape failed: ${safeError(err)}`); return null; })
        .then((ret) => {
            r.job = null;
            bot.rotnSprint = wasSprint ?? false;
            bot.rotnEscaping = false;
            for (const m of ESCAPE_PAUSES) { try { modes?.unpause?.(m); } catch { /* best effort */ } }
            r.endedAt = Date.now();
            const here = bot.entity?.position;
            const far = here ? Math.round(nearestOf(here, why.places)) : 0;
            const secs = Math.round((result?.ms ?? 0) / 1000);
            if (result?.arrived) {
                r.done = true;
                log(`[respawn] escape done: ${far} blocks from ${what} at ${here ? at(here) : '?'} in ${secs} s`);
                return;
            }
            const how = ret?.interrupted || result?.stopped === 'interrupted' ? 'was interrupted' : result?.stopped === 'time' ? `ran out of its ${ESCAPE_RUN.maxMs / 1000} s` : 'ended';
            if (result?.stopped === 'time') r.done = true;
            log(`[respawn] the escape ${how} at ${far} blocks from ${what}${here ? ` (at ${at(here)})` : ''}${r.done || r.tries >= ESCAPE_RUN.tries ? '' : '; running it again'}`);
        });
    return 'escaping';
}

/** R6: the Scroll of New Life. away: from the spawn square and every death spot; quiet: no hostile this near. */
export const SCROLL = { item: 'lifescroll:spawnscroll', away: 100, quiet: 16, waitMs: 2000 };
export const isSpawnScroll = (item) => !!item && typeof item.name === 'string' && /(^|:)spawnscroll$/.test(item.name) && /lifescroll/.test(item.name);

/**
 * R6: why the scroll is not used here (a reason), or null when it may be: held, at least SCROLL.away
 * from the spawn square and from every death spot the bot knows, no hostile within SCROLL.quiet.
 */
export function scrollRefusal(agent, site) {
    const bot = agent?.bot;
    if (!bot?.inventory?.items?.().some(isSpawnScroll)) return 'no scroll held';
    const spots = [...(agent._death?.spots ?? []), ...(agent._death?.last ? [agent._death.last] : [])].filter(s => s?.pos);
    const places = [...placesToLeave(agent).filter(p => p.what === 'spawn'), ...spots.map(s => ({ pos: s.pos, what: 'death spot' }))];
    const near = places.find(p => placeDistance(site, p) < SCROLL.away);
    if (near) return `${Math.round(placeDistance(site, near))} blocks from ${near.what === 'spawn' ? 'the spawn' : `the death spot at ${at(near.pos)}`} (it needs ${SCROLL.away})`;
    const mob = hostilesNear(bot, SCROLL.quiet)[0];
    if (mob) return `a ${mob.name ?? 'hostile mob'} is within ${SCROLL.quiet} blocks`;
    return null;
}

/**
 * R6: use the scroll here (equip it, right-click), by skill only (bot.rotnScrollBySkill lets skills.consume
 * and useToolOn through; the model is refused). Returns {used, why}.
 */
export async function useSpawnScroll(bot, { waitMs = SCROLL.waitMs } = {}) {
    const scroll = bot.inventory.items().find(isSpawnScroll);
    if (!scroll) return { used: false, why: 'no scroll held' };
    const before = bot.inventory.items().filter(isSpawnScroll).reduce((n, i) => n + i.count, 0);
    const held = bot.heldItem;
    bot.rotnScrollBySkill = true;
    try {
        await bot.equip(scroll, 'hand');
        bot.activateItem();
        for (let waited = 0; waited < waitMs; waited += 100) {
            if (bot.inventory.items().filter(isSpawnScroll).reduce((n, i) => n + i.count, 0) < before) break;
            await new Promise(r => setTimeout(r, 100));
        }
        try { bot.deactivateItem?.(); } catch { /* best effort */ }
    } catch (err) {
        return { used: false, why: safeError(err) };
    } finally {
        bot.rotnScrollBySkill = false;
        if (held && held !== scroll) { try { await bot.equip(held, 'hand'); } catch { /* best effort */ } }
    }
    const after = bot.inventory.items().filter(isSpawnScroll).reduce((n, i) => n + i.count, 0);
    return after < before ? { used: true } : { used: false, why: 'the scroll was not used up (no answer from the server)' };
}
