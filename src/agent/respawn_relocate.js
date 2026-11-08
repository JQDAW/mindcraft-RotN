// CX23 soak (rotn-v0.1.3): 14 deaths in 23 min in a ring around the world spawn. Each death raised
// a player zombie (Zombie Players) that never burns or despawns, the bot respawned among them with
// nothing, and the agenda sent it to dig dirt right there. After a respawn (a death in the last
// RELOCATE.recentMs), or when a player zombie is within RELOCATE.zombieNearSpawn of the spawn point
// while the bot is near it, the bot first walks to RELOCATE.away blocks from the spawn point and
// from every recent death spot, before the agenda resumes (priority.js). Once per death; for the
// zombie case at most once per RELOCATE.retryMs. A walk that does not get there is logged and the
// agenda resumes from where the bot is.

import pf from 'mineflayer-pathfinder';
import { goToGoal } from './library/skills.js';
import { isPlayerZombie } from './library/threats.js';
import { safeError } from './safe_error.js';

export const RELOCATE = { away: 48, recentMs: 10 * 60_000, zombieNearSpawn: 24, walkMs: 90_000, retryMs: 5 * 60_000, maxTarget: 160 };

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
    const places = placesToLeave(agent, now);
    if (!places.some(p => hdist(p.pos, here) < RELOCATE.away)) return null; // far from all of them already
    const last = agent._death?.last;
    if (last && now - last.at < RELOCATE.recentMs && r.forDeath !== last.at) return { kind: 'death', places, key: last.at };
    const spawn = places.find(p => p.what === 'spawn');
    if (spawn && hdist(spawn.pos, here) < RELOCATE.away && now - r.triedAt >= RELOCATE.retryMs) {
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
export function targetAwayFrom(here, places) {
    const cx = places.reduce((s, p) => s + p.pos.x, 0) / places.length;
    const cz = places.reduce((s, p) => s + p.pos.z, 0) / places.length;
    let dx = here.x - cx, dz = here.z - cz;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) { dx = 1; dz = 0; } else { dx /= len; dz /= len; }
    for (let d = RELOCATE.away; d <= RELOCATE.maxTarget; d += 4) {
        const t = { x: cx + dx * d, z: cz + dz * d };
        if (places.every(p => hdist(p.pos, t) >= RELOCATE.away + 4)) return { x: Math.round(t.x), z: Math.round(t.z) };
    }
    return null;
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
export function relocateTick(agent, { now = Date.now(), walk = walkTo, log = (l) => console.log(l) } = {}) {
    const r = agent._relocate ??= { forDeath: null, triedAt: -Infinity, job: null };
    if (r.job) return 'relocating';
    const why = relocationReason(agent, now);
    if (!why) return null;
    if (why.kind === 'death') r.forDeath = why.key;
    r.triedAt = now;
    const bot = agent.bot;
    const deaths = why.places.filter(p => p.what === 'death spot').length;
    const what = [why.places.some(p => p.what === 'spawn') ? 'the spawn' : null, deaths ? `${deaths} recent death spot${deaths === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ');
    const target = targetAwayFrom(bot.entity.position, why.places);
    if (!target) { log(`[respawn] no place ${RELOCATE.away} blocks from ${what} within ${RELOCATE.maxTarget}; the agenda resumes here`); return null; }
    log(`[respawn] ${why.kind === 'death' ? 'after a death' : 'a player zombie is at the spawn'}: moving at least ${RELOCATE.away} blocks from ${what}, towards ${target.x}, ${target.z}, before the agenda resumes`);
    // The agenda's self-prompting waits (as at night): its commands would stop the walk.
    if (agent.self_prompter?.isActive?.()) agent.self_prompter.stop(false);
    agent._agenda_paused = true;
    r.job = Promise.resolve()
        .then(() => agent.actions.runAction('action:leaveDeathArea', () => walk(bot, target)))
        .catch(err => log(`[respawn] the walk away failed: ${safeError(err)}`))
        .then(() => {
            r.job = null;
            const here = bot.entity?.position;
            const nearest = here ? Math.min(...why.places.map(p => hdist(p.pos, here))) : 0;
            log(nearest >= RELOCATE.away
                ? `[respawn] now ${Math.round(nearest)} blocks from ${what} at ${at(here)}; the agenda resumes`
                : `[respawn] got only ${Math.round(nearest)} blocks from ${what}${here ? ` (at ${at(here)})` : ''}; the agenda resumes`);
        });
    return 'relocating';
}
