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
import { goToGoal } from './library/skills.js';
import { isPlayerZombie } from './library/threats.js';
import { safeError } from './safe_error.js';
import { isGiverGoal } from './agenda_driver.js';

/**
 * tries: walks per death (or per zombie trigger) when one is interrupted (#416 review 3: a reflex,
 * now that cowardice is on, often cuts it short), waitMs apart; a walk that ran out its time or
 * ended short is not retried.
 */
export const RELOCATE = { away: 48, recentMs: 10 * 60_000, zombieNearSpawn: 24, walkMs: 90_000, retryMs: 5 * 60_000, maxTarget: 160, tries: 3, waitMs: 5000 };

/** Horizontal distance (what "away" means on the surface). */
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const at = (p) => `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;

/** The places to keep away from: the spawn point (when known) and the recent death spots in this dimension. */
export function placesToLeave(agent, now = Date.now()) {
    const bot = agent.bot;
    const dim = bot?.game?.dimension;
    const places = (agent._death?.recentSpots?.(now) ?? [])
        .filter(s => s.pos && (s.dimension == null || dim == null || s.dimension === dim))
        .map(s => ({ pos: s.pos, what: 'death spot' }));
    const sp = bot?.spawnPoint;
    if (sp && !(sp.x === 0 && sp.y === 0 && sp.z === 0)) places.unshift({ pos: sp, what: 'spawn' });
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
 * A point at least RELOCATE.away from every place: straight away from their centre (from the bot's
 * position), as near as that allows; or null when none within RELOCATE.maxTarget.
 */
export function targetAwayFrom(here, places, { surfaceOk = () => true } = {}) {
    const cx = places.reduce((s, p) => s + p.pos.x, 0) / places.length;
    const cz = places.reduce((s, p) => s + p.pos.z, 0) / places.length;
    let dx = here.x - cx, dz = here.z - cz;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) { dx = 1; dz = 0; } else { dx /= len; dz /= len; }
    for (let d = RELOCATE.away; d <= RELOCATE.maxTarget; d += 4) {
        const t = { x: Math.round(cx + dx * d), z: Math.round(cz + dz * d) };
        // #416 nit: not a point whose surface (where loaded) is water or lava; on, farther out.
        if (places.every(p => hdist(p.pos, t) >= RELOCATE.away + 4) && surfaceOk(t.x, t.z)) return t;
    }
    return null;
}

/** The surface at x, z near the bot's height is not a liquid (unloaded: assumed fine). */
function dryAt(bot) {
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

/** The walk (fall-safe goToGoal) to within 4 blocks of the target, at most RELOCATE.walkMs. */
async function walkTo(bot, target) {
    let timer;
    const limit = new Promise(resolve => { timer = setTimeout(() => { try { bot.pathfinder?.stop?.(); } catch { /* best effort */ } resolve(); }, RELOCATE.walkMs); });
    try { await Promise.race([goToGoal(bot, new pf.goals.GoalNearXZ(target.x, target.z, 4)).catch(() => {}), limit]); }
    finally { clearTimeout(timer); }
}

/**
 * One check, from the priority stack before the agenda: 'relocating' while the walk away runs (the
 * agenda and the model's goal wait), else null. Never throws.
 */
export function relocateTick(agent, { now = Date.now(), clock = Date.now, walk = walkTo, log = (l) => console.log(l) } = {}) {
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
    r.job = Promise.resolve()
        .then(() => agent.actions.runAction('action:leaveDeathArea', () => walk(bot, target)))
        .catch(err => { log(`[respawn] the walk away failed: ${safeError(err)}`); return null; })
        .then((ret) => {
            r.job = null;
            const here = bot.entity?.position;
            const nearest = here ? Math.min(...why.places.map(p => hdist(p.pos, here))) : 0;
            if (nearest >= RELOCATE.away) { log(`[respawn] now ${Math.round(nearest)} blocks from ${what} at ${at(here)}; the agenda resumes`); return; }
            // #416 review 3: cut short by a reflex or a command: tried again after RELOCATE.waitMs, at most RELOCATE.tries walks.
            if (ret?.interrupted && r.tries < RELOCATE.tries) {
                if (why.kind === 'death') r.forDeath = null; else r.triedAt = -Infinity;
                r.notBefore = clock() + RELOCATE.waitMs;
                log(`[respawn] the walk away was interrupted at ${Math.round(nearest)} blocks (try ${r.tries} of ${RELOCATE.tries}); trying again in ${RELOCATE.waitMs / 1000} s`);
                return;
            }
            log(`[respawn] got only ${Math.round(nearest)} blocks from ${what}${here ? ` (at ${at(here)})` : ''}; the agenda resumes`);
        });
    return 'relocating';
}
