// Soak 2 (rotn-v0.1.4, night 2): the unstuck reflex moved the bot away from its own hole shelter
// every ~22 s while it dug (a slow block: standing still while digging looked stuck), and it
// stopped a hunt the same way. Lead's rule: unstuck never moves the bot while an action is making
// progress. This module stamps the progress the world shows (a block broken or placed by the bot)
// on bot.rotnProgressAt; modes.js `actionProgress` reads it with the dig in progress and whether the
// walk's goal or the fight's target gets closer.

/** Stamp bot.rotnProgressAt whenever the bot breaks or places a block. Idempotent. */
export function installProgress(bot) {
    if (!bot || bot.rotnProgressHooked) return false;
    bot.rotnProgressHooked = true;
    const stamp = () => { bot.rotnProgressAt = Date.now(); };
    bot.on?.('diggingCompleted', stamp);
    if (typeof bot.placeBlock === 'function') {
        const place = bot.placeBlock.bind(bot);
        bot.placeBlock = async (...args) => {
            const r = await place(...args);
            stamp();
            return r;
        };
    }
    return true;
}

/** Bounds of what counts as progress: a dig gets 2 x its estimate (at least digMinMs); closer by `closer` blocks. */
export const PROGRESS = { digMinMs: 5000, closer: 0.5 };

/** How far the action's target is: the fight's target (mineflayer-pvp), else the walk's goal heuristic. */
function targetDistance(bot) {
    const here = bot?.entity?.position;
    if (!here) return null;
    const t = bot.pvp?.target;
    if (t?.position) return { key: `pvp:${t.id}`, dist: t.position.distanceTo(here) };
    const g = bot.pathfinder?.goal;
    if (g && typeof g.heuristic === 'function') {
        try {
            const p = here.floored();
            const h = g.heuristic({ x: p.x, y: p.y, z: p.z });
            if (Number.isFinite(h)) return { key: g, dist: h };
        } catch { /* no estimate */ }
    }
    return null;
}

/**
 * Why the running action is making progress now, or null. `memo` keeps what was seen between calls
 * (the unstuck mode object): the last stamp, the dig and when it started, the best distance to the
 * target. Progress: a block broken or placed since the last call; a dig still within 2 x
 * bot.digTime (at least PROGRESS.digMinMs) after it was first seen; the target PROGRESS.closer
 * nearer than the nearest yet. #431 review 1: a new dig or a new target is not progress by itself
 * (its start is only recorded), so a retry loop that starts over in place is still freed.
 */
export function actionProgress(bot, memo, now = Date.now()) {
    const stamp = bot?.rotnProgressAt ?? 0;
    if (stamp > (memo.progressSeen ?? 0)) { memo.progressSeen = stamp; return 'a block broken or placed'; }
    const dig = bot?.targetDigBlock;
    if (dig) {
        const key = dig.position ? `${dig.position.x},${dig.position.y},${dig.position.z}` : String(dig.name);
        if (memo.digKey !== key) {
            let est = null;
            try { est = bot.digTime?.(dig); } catch { est = null; }
            Object.assign(memo, { digKey: key, digSince: now, digAllowMs: Math.max(PROGRESS.digMinMs, 2 * (Number.isFinite(est) ? est : 0)) });
        } else if (now - memo.digSince <= memo.digAllowMs) return 'a dig underway';
    } else memo.digKey = null;
    const d = targetDistance(bot);
    if (!d) { memo.targetKey = null; return null; }
    if (memo.targetKey !== d.key) { memo.targetKey = d.key; memo.targetBest = d.dist; return null; } // only its start
    if (d.dist < memo.targetBest - PROGRESS.closer) { memo.targetBest = d.dist; return 'the target is closer'; }
    return null;
}
