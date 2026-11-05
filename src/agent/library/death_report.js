// The death report (skills-rotn D3; brief deliverable 8; PLAN ready-to-try: "After death it
// respawns, reports what it lost and carries on without a chat-spam loop").
//
// RotN (rotn-progression.md, hazard table; config/corpsecomplex.cfg, config/respawntimer.cfg):
// respawn after 7 s; the bot keeps its main hand, off hand, armor and baubles; everything else
// drops where it died and does not despawn; half the XP is lost. (Research, not yet seen live:
// the LLM note hedges it until the G3 (b) run.)
//
// What was lost is measured, never assumed: the inventory while alive against the inventory a
// few seconds after the respawn. The server clears the slots one tick before it sends health 0,
// so the "before" is the fullest of the last few samples taken while alive.

import { requestReplan } from '../replan.js';
import { safeError } from '../safe_error.js';
import { nightPhase } from './night.js';
import { namedAfter } from './threats.js';

/** Samples kept while alive (one a second). */
export const SAMPLES_KEPT = 3;
/** Wait after the respawn before the "after" inventory is read (Corpse Complex restores kept items). */
export const SETTLE_MS = 3000;
/** No respawn after this long: ask again (a respawn timer may refuse an early request). */
export const RESPAWN_RETRY_MS = 9000;
export const RESPAWN_RETRY_EVERY_MS = 3000;
export const RESPAWN_MAX_RETRIES = 20;
/** A death message this long before 'death' still names its cause. */
export const CAUSE_WINDOW_MS = 5000;
/** At most one death chat line in this time. */
export const CHAT_GAP_MS = 60_000;
/** This many deaths in STREAK_MS: the bot stops chatting about deaths (log only). */
export const STREAK_DEATHS = 3;
export const STREAK_MS = 10 * 60_000;
/**
 * The death spot (G3 round 2: the LLM sent the bot straight back to 'last_death_position', where
 * a zombie carrying its name killed it again). Within DEATH_SPOT_RADIUS of the last death the bot
 * does not walk for DEATH_SPOT_WAIT_MS, never at dusk or night, and never while a mob carrying
 * its name is loaded within DEATH_SPOT_RADIUS of the spot.
 */
export const DEATH_SPOT_WAIT_MS = 5 * 60_000;
export const DEATH_SPOT_RADIUS = 24;

/** {key: count} over every slot (inventory, armor, off hand). The key keeps 1.12 variants apart. */
export function inventoryCounts(bot) {
    const counts = {};
    for (const it of bot?.inventory?.slots || []) {
        if (!it || !it.name || !(it.count > 0)) continue;
        const key = it.metadata ? `${it.name}:${it.metadata}` : it.name;
        counts[key] = (counts[key] || 0) + it.count;
    }
    return counts;
}

const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);

/** What `before` has more of than `after`: [{key, count}], largest first. */
export function lossDiff(before, after) {
    const lost = [];
    for (const [key, n] of Object.entries(before || {})) {
        const d = n - ((after || {})[key] || 0);
        if (d > 0) lost.push({ key, count: d });
    }
    return lost.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** "12 cobblestone, 3 log:1 and 5 more kinds" (at most `max` kinds named). */
export function formatLoss(lost, max = 6) {
    if (!lost.length) return 'nothing';
    const named = lost.slice(0, max).map(l => `${l.count} ${l.key}`).join(', ');
    return lost.length > max ? `${named} and ${lost.length - max} more kinds` : named;
}

/**
 * One death at a time: samples while alive, the death (position, cause), the report after the
 * respawn, and the chat limits. Pure; the agent wires the events and the timers.
 */
export class DeathReporter {
    constructor() {
        this.samples = [];          // [{counts, xp}] while alive, newest last
        this.pending = null;        // the death not reported yet
        this.deaths = [];           // times of recent deaths (streak)
        this.lastChatAt = -Infinity;
        this.quietStreak = false;   // the streak note was given
    }

    /** While alive (health > 0), about once a second. */
    sample(bot) {
        this.samples.push({ counts: inventoryCounts(bot), xp: bot?.experience?.level ?? null });
        if (this.samples.length > SAMPLES_KEPT) this.samples.shift();
    }

    /** On 'death'. Returns the pending record, or null when one is already open. */
    died({ pos = null, dimension = null, now = Date.now() } = {}) {
        if (this.pending) return null;
        const best = this.samples.reduce((a, s) => (!a || total(s.counts) > total(a.counts) ? s : a), null);
        this.pending = {
            at: now, pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null, dimension,
            before: best?.counts || {}, xpBefore: best?.xp ?? null,
            cause: this.early && now - this.early.at <= CAUSE_WINDOW_MS ? this.early.text : null,
        };
        this.early = null;
        this.samples = [];
        this.deaths = this.deaths.filter(t => now - t < STREAK_MS);
        this.deaths.push(now);
        if (this.pending.pos) this.last = { at: now, pos: this.pending.pos };
        return this.pending;
    }

    /**
     * The server's death message. Vanilla sends it a tick before health 0, so it usually comes
     * before 'death': it is kept for CAUSE_WINDOW_MS for the next death.
     */
    cause(message, { now = Date.now() } = {}) {
        if (!message) return;
        const text = String(message).slice(0, 200);
        if (this.pending) { if (!this.pending.cause) this.pending.cause = text; }
        else this.early = { text, at: now };
    }

    /**
     * After the respawn has settled: the report, once per death, or null.
     * {line, chat: string|null, lost, pos, cause}. `chat` is null when rate-limited or in a streak.
     */
    report(bot, { now = Date.now() } = {}) {
        const p = this.pending;
        if (!p) return null;
        this.pending = null;
        const lost = lossDiff(p.before, inventoryCounts(bot));
        const xpAfter = bot?.experience?.level ?? null;
        const at = p.pos ? `${Math.floor(p.pos.x)}, ${Math.floor(p.pos.y)}, ${Math.floor(p.pos.z)}` : 'unknown';
        const xp = p.xpBefore != null && xpAfter != null && xpAfter < p.xpBefore ? `; XP level ${p.xpBefore} -> ${xpAfter}` : '';
        const cause = p.cause ? ` (${p.cause})` : '';
        const line = `died at ${at}${cause}; lost ${formatLoss(lost)}${xp}`;

        let chat = null;
        const streak = this.deaths.filter(t => now - t < STREAK_MS).length;
        if (streak >= STREAK_DEATHS) {
            if (!this.quietStreak) {
                this.quietStreak = true;
                chat = `I died ${streak} times in ${STREAK_MS / 60_000} min; I stop reporting deaths in chat for now.`;
            }
        } else {
            this.quietStreak = false;
            if (now - this.lastChatAt >= CHAT_GAP_MS) chat = `I ${line}.`;
        }
        if (chat) this.lastChatAt = now;
        return { line, chat, lost, pos: p.pos, cause: p.cause, dimension: p.dimension, label: p.label || '', streak: streak >= STREAK_DEATHS };
    }
}

const where = (p) => (p ? `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}` : 'unknown');

/**
 * Why the bot must not walk to `pos` now because it is near its last death spot, or null.
 * Used by the walking commands (!goToRememberedPlace, !goToCoordinates).
 */
export function deathSpotBlocked(agent, pos, { now = Date.now() } = {}) {
    const last = agent?._death?.last;
    if (!last?.pos || !pos) return null;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    if (dist(pos, last.pos) > DEATH_SPOT_RADIUS) return null;
    const ago = now - last.at;
    if (ago < DEATH_SPOT_WAIT_MS) {
        const left = Math.ceil((DEATH_SPOT_WAIT_MS - ago) / 60_000);
        return `you died there ${Math.round(ago / 1000)} s ago and what killed you may still be there; wait ${left} more min`;
    }
    const bot = agent.bot;
    let phase = null;
    try { phase = agent._night?.clock?.phase?.(now) ?? null; } catch { phase = null; }
    if (!phase && typeof bot?.time?.timeOfDay === 'number') phase = nightPhase(bot.time.timeOfDay);
    if (phase === 'night' || phase === 'dusk') return `it is ${phase}; go back to where you died only by day`;
    const named = Object.values(bot?.entities ?? {}).find(e => e !== bot.entity && e?.position
        && namedAfter(e, bot.username) && dist(e.position, last.pos) <= DEATH_SPOT_RADIUS);
    if (named) return 'a mob carrying your name (a risen player zombie) is there; it is a strong threat';
    return null;
}

/**
 * Wire the death report to an agent (called once at login). Samples once a second while alive;
 * on 'death' saves 'last_death_position' and asks for the respawn again if it was refused; after
 * the respawn has settled, reports once (log, rate-limited chat) and records a re-plan note.
 * The upstream LLM prompt on every death message is gone (it could loop: a death, a prompt, an
 * action, a death). Timers and the clock are injectable for tests.
 */
export function bindDeathReport(agent, { setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now() } = {}) {
    const bot = agent.bot;
    const d = agent._death = new DeathReporter();
    let lastSample = -Infinity, retry = null, settle = null;

    bot.on('physicsTick', () => {
        if (!(bot.health > 0) || bot.isAlive === false || d.pending) return;
        const t = now();
        if (t - lastSample < 1000) return;
        lastSample = t;
        d.sample(bot);
    });

    bot.on('death', () => {
        const rec = d.died({ pos: bot.entity?.position, dimension: bot.game?.dimension, now: now() });
        if (!rec) return;
        // The action the death interrupted; this listener runs before the agent's own death
        // listener stops it (#215 review 1).
        rec.label = agent.actions?.currentActionLabel || '';
        if (rec.pos) {
            try { agent.memory_bank?.rememberPlace?.('last_death_position', rec.pos.x, rec.pos.y, rec.pos.z); }
            catch (err) { console.warn(`[death] remember place: ${safeError(err)}`); }
        }
        console.log(`[death] died at ${where(rec.pos)}; waiting for the respawn`);
        let tries = 0;
        const ask = () => {
            retry = null;
            if (bot.isAlive) return;
            if (++tries > RESPAWN_MAX_RETRIES) { console.warn(`[death] no respawn after ${RESPAWN_MAX_RETRIES} requests; giving up`); return; }
            if (tries === 1) console.log(`[death] no respawn after ${RESPAWN_RETRY_MS / 1000} s; asking again every ${RESPAWN_RETRY_EVERY_MS / 1000} s`);
            try { bot.respawn?.(); } catch (err) { console.warn(`[death] respawn: ${safeError(err)}`); }
            retry = setTimer(ask, RESPAWN_RETRY_EVERY_MS);
        };
        if (retry) clearTimer(retry);
        retry = setTimer(ask, RESPAWN_RETRY_MS);
    });

    bot.on('spawn', () => {
        if (retry) { clearTimer(retry); retry = null; }
        if (!d.pending) return;
        if (settle) clearTimer(settle);
        settle = setTimer(() => { settle = null; reportDeath(agent, { now: now() }); }, SETTLE_MS);
    });
}

/** The report for the pending death: one log line, the chat line if allowed, a re-plan note. */
export function reportDeath(agent, { now = Date.now() } = {}) {
    const r = agent._death?.report(agent.bot, { now });
    if (!r) return null;
    console.log(`[death] ${r.line}`);
    if (r.chat && !agent.shut_up) {
        Promise.resolve().then(() => agent.openChat(r.chat)).catch(err => console.warn(`[death] chat: ${safeError(err)}`));
    }
    // The LLM gets the bot's own state only, never the server's death text (it can carry a mob's
    // or player's custom name). Where the items went is hedged until G3 (b) shows how Corpse
    // Complex behaves (#215 review 2).
    const items = r.lost.length
        ? `You no longer have ${formatLoss(r.lost)}; they may lie at the death spot (unconfirmed).`
        : 'Your inventory looks unchanged.';
    // A death is due for a prompt even when nothing was running (#215 review 1), except in a
    // death streak: then the note waits for the next prompt, so deaths cannot drive LLM calls.
    requestReplan(agent, 'death', r.label, {
        now, due: !r.streak,
        note: `You died at ${where(r.pos)} and respawned. ${items} The spot is saved as 'last_death_position'. `
            + `Do not go back there for ${DEATH_SPOT_WAIT_MS / 60_000} min, nor at dusk or night: what killed you may still be there, `
            + 'and a zombie carrying your name may rise there.',
    });
    return r;
}
