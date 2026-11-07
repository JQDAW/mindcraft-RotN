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
import { isPlayerZombie, canFightHard } from './threats.js';

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
 * the player zombie Zombie Players raised there killed it again). Within DEATH_SPOT_RADIUS of the
 * last death, in the same dimension, the bot does not walk:
 *   - for DEATH_SPOT_WAIT_MS after the death;
 *   - at dusk or night within DEATH_SPOT_NIGHT_MS (one Minecraft day) of the death, so the rule
 *     ends (#227 review 4);
 *   - while a player zombie is loaded within DEATH_SPOT_RADIUS of the spot.
 * The bot's shelter or home is always allowed (review 4): the places named like home, shelter,
 * bed or base, and the night routine's shelter site, within HOME_RADIUS of the target.
 */
export const DEATH_SPOT_WAIT_MS = 5 * 60_000;
export const DEATH_SPOT_NIGHT_MS = 20 * 60_000;
export const DEATH_SPOT_RADIUS = 24;
export const HOME_RADIUS = 4;
const HOME_NAMES = /home|shelter|bed|base/i;

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

/**
 * The same item's variants summed (T1, the lead: the chat line said "3 rock_metamorphic:6, 4
 * rock_metamorphic:2"): "3 log:1, 2 log" -> "5 log", largest first. The log line keeps the variants.
 */
/**
 * Items whose meta is a different item, kept apart in the chat line too (#338 review): dye:4 is
 * lapis and dye:15 bone meal, coal:1 is charcoal, golden_apple:1 the enchanted apple.
 */
export const DISTINCT_METAS = new Set(['dye', 'coal', 'golden_apple']);
const baseOf = (key) => {
    const name = key.replace(/:\d+$/, '');
    return DISTINCT_METAS.has(name.replace(/^minecraft:/, '')) ? key : name;
};

export function sumVariants(lost) {
    const byName = new Map();
    for (const l of lost) {
        const name = baseOf(l.key);
        byName.set(name, (byName.get(name) ?? 0) + l.count);
    }
    return [...byName].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
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
        if (this.pending.pos) this.last = { at: now, pos: this.pending.pos, dimension };
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
        const chatLine = `died at ${at}${cause}; lost ${formatLoss(sumVariants(lost))}${xp}`;

        let chat = null;
        const streak = this.deaths.filter(t => now - t < STREAK_MS).length;
        if (streak >= STREAK_DEATHS) {
            if (!this.quietStreak) {
                this.quietStreak = true;
                chat = `I died ${streak} times in ${STREAK_MS / 60_000} min; I stop reporting deaths in chat for now.`;
            }
        } else {
            this.quietStreak = false;
            if (now - this.lastChatAt >= CHAT_GAP_MS) chat = `I ${chatLine}.`;
        }
        if (chat) this.lastChatAt = now;
        return { line, chat, lost, pos: p.pos, cause: p.cause, at: p.at, dimension: p.dimension, label: p.label || '', streak: streak >= STREAK_DEATHS };
    }
}

const where = (p) => (p ? `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}` : 'unknown');

/** How long Corpse Complex keeps the dropped items at the death spot (config: Drop Despawn Timer 600). */
export const DROPS_LAST_MIN = 10;

/**
 * What the model is told about the items it dropped (lead decision on rotn-data Request 12), with
 * the minutes left counted from the death (#247 review 1), so a note read later is not stale.
 */
export function lostItemsNote(minutesLeft) {
    if (minutesLeft <= 0) {
        return `They lay at the death spot for ${DROPS_LAST_MIN} minutes after your death and are gone now; `
            + 'move on and do not plan around them.';
    }
    return `They lie at the death spot for about ${minutesLeft} more minutes (${DROPS_LAST_MIN} minutes from your death), `
        + 'and a zombie rises there (Zombie Players: it never burns in daylight and never leaves). They are lost unless '
        + 'that zombie is killed before then; waiting for day does not help. Go back for them only with a weapon and more '
        + 'than half your health; otherwise move on and do not plan around the lost items.';
}

/** The re-plan note for a death by a falling tree: what happened and how not to repeat the cut. */
const treeNote = (lastFell) => `A falling tree crushed you${lastFell?.pos ? ` (the one you cut at ${where(lastFell.pos)})` : ''}: `
    + 'in RotN a cut tree falls as one piece. Get logs only with !collectBlocks("log", n), which cuts the lowest trunk block '
    + 'from the side away from the canopy and steps back; never cut a tree by hand or from under its leaves. ';

/**
 * Why the bot must not walk to `pos` now because it is near its last death spot, or null.
 * Used by the walking commands (!goToRememberedPlace, !goToCoordinates).
 */
export function deathSpotBlocked(agent, pos, { now = Date.now() } = {}) {
    const last = agent?._death?.last;
    if (!last?.pos || !pos) return null;
    const bot = agent.bot;
    const dimension = bot?.game?.dimension;
    if (last.dimension != null && dimension != null && last.dimension !== dimension) return null;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    if (dist(pos, last.pos) > DEATH_SPOT_RADIUS) return null;
    if (isHome(agent, pos, dist)) return null;
    const ago = now - last.at;
    if (ago < DEATH_SPOT_WAIT_MS) {
        const left = Math.ceil((DEATH_SPOT_WAIT_MS - ago) / 60_000);
        return `you died there ${Math.round(ago / 1000)} s ago and what killed you may still be there; wait ${left} more min`;
    }
    const zombie = Object.values(bot?.entities ?? {}).find(e => e !== bot.entity && e?.position
        && isPlayerZombie(e) && dist(e.position, last.pos) <= DEATH_SPOT_RADIUS);
    // The zombie never burns and never leaves (rotn-data #243), so this rule ends only when it dies.
    // With a weapon and more than half its health the bot may go and fight it (the fight policy;
    // lead decision on rotn-data Request 12); otherwise it stays away.
    if (zombie && !canFightHard(bot)) return 'a player zombie (it rises where a player died) is there, and you lack a weapon or more than half your health to fight it';
    // After DROPS_LAST_MIN the items are gone (#247 review 1): no fight for them past the zombie, and
    // no walk to the spot itself. The area around it stays open (the zombie may be anywhere near).
    if (ago >= DROPS_LAST_MIN * 60_000 && (zombie || dist(pos, last.pos) <= HOME_RADIUS)) {
        return `your items there are already lost (they last ${DROPS_LAST_MIN} minutes after the death)${zombie ? ', and its zombie stays' : ''}`;
    }
    if (ago < DEATH_SPOT_NIGHT_MS) {
        let phase = null;
        try { phase = agent._night?.clock?.phase?.(now) ?? null; } catch { phase = null; }
        if (!phase && typeof bot?.time?.timeOfDay === 'number') phase = nightPhase(bot.time.timeOfDay);
        // Not "only by day" (#247 review 2): the items are gone by then, and waiting does not help.
        if (phase === 'night' || phase === 'dusk') {
            // From DROPS_LAST_MIN on the items are gone already (#247 nit), before that they will be.
            const items = ago >= DROPS_LAST_MIN * 60_000 ? 'the items you left there are already lost' : 'the items left there will be lost';
            return `it is ${phase}: do not go back to where you died now; ${items}`;
        }
    }
    return null;
}

/** The target is the bot's shelter or home (a remembered place, or the night routine's site). */
function isHome(agent, pos, dist) {
    const homes = [];
    const mem = agent.memory_bank?.memory;
    if (mem && typeof mem === 'object') {
        for (const [name, p] of Object.entries(mem)) {
            if (HOME_NAMES.test(name) && Array.isArray(p) && p.length === 3) homes.push({ x: p[0], y: p[1], z: p[2] });
        }
    }
    const site = agent._night?.site;
    const s = site?.feet ?? site?.pos ?? site;
    if (s && [s.x, s.y, s.z].every(Number.isFinite)) homes.push(s);
    return homes.some(h => dist(h, pos) <= HOME_RADIUS);
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
/**
 * The death message's text for the report, or null when it is not the bot's death. A modded death
 * message (Dynamic Trees' falling tree) reaches mineflayer untranslated, as its key: it does not
 * start with the bot's name, which is then one of its arguments (G3 round 3 B: the report had no
 * cause). Then: "<name> died (<key>)".
 */
export function deathCauseText(name, message, jsonMsg) {
    const key = jsonMsg?.translate;
    if (typeof key !== 'string' || !key.startsWith('death')) return null;
    // The one who died is argument 1 (%1$s); argument 2 is the killer (#242 review 3: in
    // death.attack.player the bot can be argument 2, and that death is not the bot's).
    const first = jsonMsg.with?.[0];
    // A string, a component with .text, or mineflayer's ChatMessage, whose toString() is its plain
    // text. Any other object's toString() gives "[object Object]", which is never a bot's name, so
    // such a message is not taken as the bot's (#242 nit).
    const who = typeof first === 'string' ? first : (first?.text ?? (typeof first?.toString === 'function' ? first.toString() : null));
    if (who != null) return who === name ? (String(message ?? '').startsWith(name) ? String(message) : `${name} died (${key})`) : null;
    const text = String(message ?? '');
    return text.startsWith(name) ? text : null;
}

/**
 * How soon after its own cut a death counts as the falling tree's when the server gave no cause.
 * G3 round 10 A: crushed about 27 s after its own cut, so 30 s, as long as fellTree waits for the
 * fall (TREE_FALL.maxMs).
 */
export const TREE_DEATH_MS = 30_000;

/**
 * Whether the bot was crushed by a falling tree (Dynamic Trees; G3 round 3 B): the cause says so
 * (the text or the untranslated key), or there is no cause and the bot died within TREE_DEATH_MS
 * of cutting a tree (bot.rotnLastFell, set by skills.fellTree).
 */
export function treeDeath(r, lastFell) {
    // The pack's key and text (DramaticTrees-1.12.2-0.13.4.jar, assets/dynamictrees/lang/en_us.lang):
    // death.attack.fallingtree=%1$s was crushed by a falling tree. Also falling_tree (#242 review 4).
    if (r?.cause) return /falling[ _]?tree/i.test(r.cause);
    return !!lastFell && Number.isFinite(r?.at) && r.at >= lastFell.at && r.at - lastFell.at <= TREE_DEATH_MS;
}

export function reportDeath(agent, { now = Date.now() } = {}) {
    const r = agent._death?.report(agent.bot, { now });
    if (!r) return null;
    const lastFell = agent.bot?.rotnLastFell;
    const byTree = treeDeath(r, lastFell);
    // Which stand the cut was from (#268 review 1: round 5 must show cuts from under leaves are safe).
    const stand = byTree && lastFell ? ` [its last cut was from ${lastFell.underLeaves ? "under the tree's leaves" : 'under no canopy'}]` : '';
    console.log(`[death] ${r.line}${byTree && !r.cause ? ' (likely the tree it had just cut)' : ''}${stand}`);
    if (r.chat && !agent.shut_up) {
        Promise.resolve().then(() => agent.openChat(r.chat)).catch(err => console.warn(`[death] chat: ${safeError(err)}`));
    }
    // The LLM gets the bot's own state only, never the server's death text (it can carry a mob's
    // or player's custom name). Where the items went, plainly (rotn-data #226/#243: Corpse Complex
    // drops them at the death spot for 600 s; Zombie Players raises a zombie there that never burns
    // and never despawns; lead decision on rotn-data Request 12).
    const items = r.lost.length
        ? `You no longer have ${formatLoss(r.lost)}. ${lostItemsNote(Math.floor(DROPS_LAST_MIN - (now - (r.at ?? now)) / 60_000))}`
        : 'Your inventory looks unchanged.';
    // A death is due for a prompt even when nothing was running (#215 review 1), except in a
    // death streak: then the note waits for the next prompt, so deaths cannot drive LLM calls.
    requestReplan(agent, 'death', r.label, {
        now, due: !r.streak,
        note: `You died at ${where(r.pos)} and respawned. ${byTree ? treeNote(lastFell) : ''}${items} The spot is saved as 'last_death_position'. `
            + `Do not go back there for ${DEATH_SPOT_WAIT_MS / 60_000} min, nor at dusk or night: what killed you may still be there, `
            + 'and a zombie rises where a player dies.',
    });
    return r;
}
