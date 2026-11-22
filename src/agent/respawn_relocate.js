// CX23 soak (rotn-v0.1.3): 14 deaths in 23 min in a ring around the world spawn. Each death raised
// a player zombie (Zombie Players) that never burns or despawns, the bot respawned among them with
// nothing, and the agenda sent it to dig dirt right there. After a respawn (a death in the last
// RELOCATE.recentMs), or when a player zombie is within RELOCATE.zombieNearSpawn of the spawn point
// while the bot is near it, the bot first walks to RELOCATE.away blocks from the spawn point and
// from every recent death spot, before the agenda resumes (priority.js). Once per death; for the
// zombie case at most once per RELOCATE.retryMs. A walk that does not get there is logged and the
// agenda resumes from where the bot is.

import pf from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { goToGoal, descendFromTree } from './library/skills.js';
import { standsOnTree } from './library/fall_safety.js';
import { isPlayerZombie, shelterEnemy } from './library/threats.js';
import { safeError } from './safe_error.js';
import { isGiverGoal } from './agenda_driver.js';
import { dimensionKey, sameDimension } from './library/death_report.js';

/**
 * tries: walks per death (or per zombie trigger) when one is interrupted (#416 review 3: a reflex,
 * now that cowardice is on, often cuts it short), waitMs apart; a walk that ran out its time or
 * ended short is not retried.
 */
// Soak 10 (R4): away 64 (was 48), as the respawn escape (respawn_escape.ESCAPE_RUN.away).
export const RELOCATE = { away: 64, recentMs: 10 * 60_000, zombieNearSpawn: 24, walkMs: 90_000, retryMs: 5 * 60_000, maxTarget: 160, tries: 3, waitMs: 5000 };

/** Horizontal distance (what "away" means on the surface). */
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const at = (p) => `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;

/**
 * The places to keep away from: the spawn point (when known, and only in the overworld) and the
 * recent death spots in this dimension (death_report.sameDimension; #474 review 1: an unnamed modded
 * dimension is "unknown:<id>", never the overworld).
 */
export function placesToLeave(agent, now = Date.now()) {
    const bot = agent.bot;
    const dim = dimensionKey(bot);
    const places = (agent._death?.recentSpots?.(now) ?? [])
        .filter(s => s.pos && sameDimension(bot, s.dimension))
        .map(s => ({ pos: s.pos, what: 'death spot', at: s.at }));
    const sp = bot?.spawnPoint;
    // #471 nit 5: the spawn point is in the overworld; elsewhere (an unknown modded dimension too,
    // #472 nit 3) it is no place to leave.
    const overworld = dim == null || dim === 'overworld';
    if (overworld && sp && !(sp.x === 0 && sp.y === 0 && sp.z === 0)) places.unshift({ pos: sp, what: 'spawn' });
    return places;
}

/** Why the bot must leave now ({kind: 'death'|'zombie', places, key}), or null. */
export function relocationReason(agent, now = Date.now()) {
    const bot = agent.bot;
    const here = bot?.entity?.position;
    if (!here) return null;
    const r = agent._relocate ??= { forDeath: null, triedAt: -Infinity, job: null };
    if (now < (r.notBefore ?? -Infinity)) return null; // an interrupted walk waits RELOCATE.waitMs before the next try
    const places = placesToLeave(agent, now);
    if (!places.some(p => hdist(p.pos, here) < RELOCATE.away)) return null; // far from all of them already
    const last = agent._death?.last;
    if (last && now - last.at < RELOCATE.recentMs && r.forDeath !== last.at) return { kind: 'death', places, key: last.at };
    // #416 review 4: the zombie trigger never cuts into running work: only with no action running.
    const between = !agent.actions?.executing;
    const spawn = places.find(p => p.what === 'spawn');
    if (between && spawn && hdist(spawn.pos, here) < RELOCATE.away && now - r.triedAt >= RELOCATE.retryMs) {
        const zombie = Object.values(bot.entities ?? {}).find(e => e && e !== bot.entity && e.position
            && isPlayerZombie(e) && hdist(e.position, spawn.pos) <= RELOCATE.zombieNearSpawn);
        if (zombie) return { kind: 'zombie', places, key: null };
    }
    return null;
}

/**
 * A point at least `away` (RELOCATE.away) from every place: straight away from their centre (from the bot's
 * position), as near as that allows; or null when none within RELOCATE.maxTarget.
 */
export function targetAwayFrom(here, places, { surfaceOk = () => true, away = RELOCATE.away } = {}) {
    const cx = places.reduce((s, p) => s + p.pos.x, 0) / places.length;
    const cz = places.reduce((s, p) => s + p.pos.z, 0) / places.length;
    let dx = here.x - cx, dz = here.z - cz;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) { dx = 1; dz = 0; } else { dx /= len; dz /= len; }
    for (let d = away; d <= RELOCATE.maxTarget; d += 4) {
        const t = { x: Math.round(cx + dx * d), z: Math.round(cz + dz * d) };
        // #416 nit: not a point whose surface (where loaded) is water or lava; on, farther out.
        if (places.every(p => hdist(p.pos, t) >= away + 4) && surfaceOk(t.x, t.z)) return t;
    }
    return null;
}

/** The surface at x, z near the bot's height is not a liquid (unloaded: assumed fine). */
export function dryAt(bot) {
    const y0 = Math.floor(bot.entity?.position?.y ?? 64);
    return (x, z) => {
        for (let y = y0 + 16; y >= y0 - 32; y--) {
            const b = bot.blockAt?.(new Vec3(x, y, z));
            if (!b) return true; // not loaded
            if (b.name === 'air' || b.boundingBox === 'empty' && !/water|lava/.test(b.name)) continue;
            return !/water|lava/.test(b.name);
        }
        return true;
    };
}

/**
 * The walk (fall-safe goToGoal) to within 4 blocks of the target, at most RELOCATE.walkMs. Soak 5
 * (00:56): a walk that failed (no path from the spawn tree) was taken for one that ended short:
 * it now returns {failed: true, why}.
 */
async function walkTo(bot, target) {
    let timer;
    const limit = new Promise(resolve => { timer = setTimeout(() => { try { bot.pathfinder?.stop?.(); } catch { /* best effort */ } resolve(); }, RELOCATE.walkMs); });
    try {
        return await Promise.race([goToGoal(bot, new pf.goals.GoalNearXZ(target.x, target.z, 4)).then(() => null, (err) => ({ failed: true, why: safeError(err) })), limit]);
    } finally { clearTimeout(timer); }
}

/**
 * One check, from the priority stack before the agenda: 'relocating' while the walk away runs (the
 * agenda and the model's goal wait), else null. Never throws.
 */
export function relocateTick(agent, { now = Date.now(), clock = Date.now, walk = walkTo, log = (l) => console.log(l),
    onTree = standsOnTree, descend = (bot) => descendFromTree(bot) } = {}) {
    const r = agent._relocate ??= { forDeath: null, triedAt: -Infinity, job: null };
    if (r.job) return 'relocating';
    // #416 review 1: a goal a task giver typed, or self-prompting a bot-to-bot conversation paused,
    // is never stopped for this: it waits, as the agenda does (which yields to it below).
    const sp = agent.self_prompter;
    if ((sp && isGiverGoal(agent)) || sp?.isPaused?.()) return null;
    const why = relocationReason(agent, now);
    if (!why) return null;
    // #416 review 3: not while a reflex acts (a flee, a fight, eating): the agenda waits with it.
    if (agent.bot?.modes?.anyActive?.()) return 'relocating:wait';
    const key = why.kind === 'death' ? why.key : 'zombie';
    if (r.triesFor !== key) Object.assign(r, { triesFor: key, tries: 0 });
    r.tries++;
    if (why.kind === 'death') r.forDeath = why.key;
    r.triedAt = now;
    const bot = agent.bot;
    const deaths = why.places.filter(p => p.what === 'death spot').length;
    const what = [why.places.some(p => p.what === 'spawn') ? 'the spawn' : null, deaths ? `${deaths} recent death spot${deaths === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ');
    const target = targetAwayFrom(bot.entity.position, why.places, { surfaceOk: dryAt(bot) });
    if (!target) { log(`[respawn] no place ${RELOCATE.away} blocks from ${what} within ${RELOCATE.maxTarget}; the agenda resumes here`); return null; }
    log(`[respawn] ${why.kind === 'death' ? 'after a death' : 'a player zombie is at the spawn'}: moving at least ${RELOCATE.away} blocks from ${what}, towards ${target.x}, ${target.z}, before the agenda resumes`);
    // The agenda's self-prompting waits (as at night): its commands would stop the walk.
    if (agent.self_prompter?.isActive?.()) agent.self_prompter.stop(false);
    agent._agenda_paused = true;
    // Soak 5 (00:56:18): respawned up the spawn tree, the walk found no path and the agenda resumed
    // up there ("got only 4 blocks"). Down from the tree first; a walk that failed (no path, still
    // on the tree) is tried again like one a reflex cut short.
    let walked = null;
    r.job = Promise.resolve()
        .then(() => agent.actions.runAction('action:leaveDeathArea', async () => {
            if (onTree(bot)) {
                log('[respawn] up on a tree: climbing down before the walk away');
                if (!await descend(bot)) { walked = { failed: true, why: `still up on the tree${bot.rotnTreeWhy ? `: ${bot.rotnTreeWhy}` : ''}` }; return; }
            }
            walked = await walk(bot, target);
        }, { keepReplan: true })) // #463 review 1: the death's re-plan survives the walk
        .catch(err => { log(`[respawn] the walk away failed: ${safeError(err)}`); return null; })
        .then((ret) => {
            r.job = null;
            const here = bot.entity?.position;
            const nearest = here ? Math.min(...why.places.map(p => hdist(p.pos, here))) : 0;
            if (nearest >= RELOCATE.away) { log(`[respawn] now ${Math.round(nearest)} blocks from ${what} at ${at(here)}; the agenda resumes`); return; }
            // #416 review 3: cut short by a reflex or a command (soak 5: or failed): tried again after
            // RELOCATE.waitMs, at most RELOCATE.tries walks.
            if ((ret?.interrupted || walked?.failed) && r.tries < RELOCATE.tries) {
                if (why.kind === 'death') r.forDeath = null; else r.triedAt = -Infinity;
                r.notBefore = clock() + RELOCATE.waitMs;
                const how = ret?.interrupted ? 'was interrupted' : `failed (${walked.why})`;
                log(`[respawn] the walk away ${how} at ${Math.round(nearest)} blocks (try ${r.tries} of ${RELOCATE.tries}); trying again in ${RELOCATE.waitMs / 1000} s`);
                return;
            }
            if (walked?.failed) { log(`[respawn] the walk away failed at ${Math.round(nearest)} blocks from ${what} (${walked.why}) after ${r.tries} tries; the agenda resumes`); return; }
            log(`[respawn] got only ${Math.round(nearest)} blocks from ${what}${here ? ` (at ${at(here)})` : ''}; the agenda resumes`);
        });
    return 'relocating';
}

/**
 * Soak 3 (rotn-v0.1.5), the lead's C: after a death, at night, the night routine first walks away by
 * this rule instead of 28 blocks from the last death spot only (soak 3: that walk gave up in about
 * 2 s three times, and a respawn sheltered beside two older spots and died 23 s later; the one
 * relocation that ran, by day, got 50 blocks away). Full: at least RELOCATE.away (48) from the spawn
 * and every recent death spot. Short (the lead's change): with a hostile mob within hostilePathRange
 * of the way, or no weapon once it is night, only to the first spot at least shortAway from every
 * recent death spot. recentMs: a death this recent (the death spots kept); tries: walks a reflex cut
 * short, waitMs apart; checkMs: how often the walk looks whether it may stop.
 */
export const NIGHT_RELOCATE = { recentMs: 30 * 60_000, shortAway: 24, hostilePathRange: 16, tries: 3, waitMs: 5000, walkMs: RELOCATE.walkMs, checkMs: 500 };

/** The nearest hostile mob (threats.shelterEnemy) within range of the straight way from a to b (horizontally), or null. */
export function hostileNearWay(bot, a, b, range = NIGHT_RELOCATE.hostilePathRange) {
    const vx = b.x - a.x, vz = b.z - a.z, len2 = vx * vx + vz * vz;
    const dist = (p) => {
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / len2)) : 0;
        return Math.hypot(p.x - (a.x + t * vx), p.z - (a.z + t * vz));
    };
    let best = null, bestD = Infinity;
    for (const e of Object.values(bot.entities ?? {})) {
        if (!e || e === bot.entity || !e.position || !shelterEnemy(e)) continue;
        const d = dist(e.position);
        if (d <= range && d < bestD) { best = e; bestD = d; }
    }
    return best;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The walk away at night after a recent death (NIGHT_RELOCATE), or null when none is needed (no
 * death within recentMs in this dimension, or already far enough). night: the night proper (not
 * dusk); armed: the bot holds a weapon. Returns {mode: 'full'|'short', target, places, away, line}.
 */
export function nightRelocationPlan(agent, now = Date.now(), { night = false, armed = false, full: fullOnly = false } = {}) {
    const bot = agent.bot;
    const here = bot?.entity?.position;
    if (!here) return null;
    const places = placesToLeave(agent, now).filter(p => p.what !== 'death spot' || now - (p.at ?? now) < NIGHT_RELOCATE.recentMs);
    const deaths = places.filter(p => p.what === 'death spot');
    if (!deaths.length) return null;
    const surfaceOk = dryAt(bot);
    const full = targetAwayFrom(here, places, { surfaceOk });
    const nearWay = full ? hostileNearWay(bot, here, full) : null;
    const towards = (t) => `towards ${t.x}, ${t.z}`;
    // #581 review 3: after a respawn escape that did not get there, the full target (never the 24-block
    // walk, which ends inside the spawn ring); #581 re-review nit 4: with no full target, the short walk
    // still (not sheltering on the spot).
    if ((fullOnly && !full) || (!fullOnly && (nearWay || (night && !armed) || !full))) {
        if (deaths.every(p => hdist(p.pos, here) >= NIGHT_RELOCATE.shortAway)) return null;
        const target = targetAwayFrom(here, deaths, { surfaceOk, away: NIGHT_RELOCATE.shortAway });
        if (!target) return null;
        const why = nearWay ? `a ${nearWay.name ?? 'hostile mob'} is near the way` : !full ? `there is no place ${RELOCATE.away} blocks away` : 'it is night and I have no weapon';
        return { mode: 'short', target, places: deaths, away: NIGHT_RELOCATE.shortAway,
            line: `[night] I died near here recently, and ${why}: moving to the first spot at least ${NIGHT_RELOCATE.shortAway} blocks from ${plural(deaths.length, 'recent death spot')}, ${towards(target)}, before sheltering` };
    }
    if (places.every(p => hdist(p.pos, here) >= RELOCATE.away)) return null;
    const what = [places.some(p => p.what === 'spawn') ? 'the spawn' : null, plural(deaths.length, 'recent death spot')].filter(Boolean).join(' and ');
    return { mode: 'full', target: full, places, away: RELOCATE.away,
        line: `[night] I died near here recently: moving at least ${RELOCATE.away} blocks from ${what}, ${towards(full)}, before sheltering` };
}

/**
 * The night walk (nightRelocationPlan), bounded by NIGHT_RELOCATE.walkMs. Short: it stops at the first
 * spot at least plan.away from every death spot. Full: it stops early, where it is, once a hostile
 * mob comes within hostilePathRange and the bot is already shortAway from every death spot.
 * shortNow(): whether it is night now and the bot unarmed (#471 nit 2): a full walk then stops at
 * shortAway too. Returns {arrived, nearest, stopped: null|'far'|'hostile'|'night'|'time'}; nearest: the least distance to
 * the places left.
 */
export async function walkAwayAtNight(bot, plan, { walk = (b, t) => goToGoal(b, new pf.goals.GoalNearXZ(t.x, t.z, 4)), shortNow = () => false, log = (l) => console.warn(l) } = {}) {
    const deaths = plan.places.filter(p => p.what === 'death spot');
    // #471 nit 4: no position (a death or a respawn under way): not far from anything.
    const farFrom = (list, d) => { const here = bot.entity?.position; return !!here && list.every(p => hdist(p.pos, here) >= d); };
    let stopped = null, timer, watch;
    const halt = (why) => { stopped = why; try { bot.pathfinder?.stop?.(); } catch { /* best effort */ } };
    const limit = new Promise(resolve => { timer = setTimeout(() => { halt('time'); resolve(); }, NIGHT_RELOCATE.walkMs); });
    watch = setInterval(() => {
        if (stopped) return;
        const here = bot.entity?.position;
        if (!here) return;
        if (plan.mode === 'short' && farFrom(deaths, plan.away)) halt('far');
        else if (plan.mode === 'full' && farFrom(deaths, NIGHT_RELOCATE.shortAway)) {
            if (hostileNearWay(bot, here, here)) halt('hostile');
            // #471 nit 2: an unarmed walk that began at dusk stops at shortAway once night falls.
            else if (shortNow()) halt('night');
        }
    }, NIGHT_RELOCATE.checkMs);
    // #471 nit 3: a walk that throws is logged, not swallowed.
    try { await Promise.race([Promise.resolve().then(() => walk(bot, plan.target)).catch(err => log(`[night] the walk away: ${safeError(err)}`)), limit]); } finally { clearTimeout(timer); clearInterval(watch); }
    const here = bot.entity?.position;
    const nearest = here ? Math.min(...plan.places.map(p => hdist(p.pos, here))) : 0;
    const arrived = nearest >= plan.away || (['hostile', 'night'].includes(stopped) && farFrom(deaths, NIGHT_RELOCATE.shortAway));
    return { arrived, nearest, stopped: arrived && stopped === 'time' ? null : stopped };
}
