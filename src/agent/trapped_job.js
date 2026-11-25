// Soak 16 trap (21:20, the lead's go on /home/rv/soak16-trap-skills.md (3)): a failed !goToSurface left the bot trapped
// at 9, 68, -63; the standing goal's budget was spent seconds later, so the self-prompter stopped and nothing re-planned
// until the night routine. The Fable plan's update-loop invariant (Q1: "walkableExit to an open-sky cell exists or an
// escape is scheduled"): when the bot is idle and trapped, a scripted escape (the day budget; it makes a stone pickaxe
// first when it has none) runs as an action; when it fails, one re-plan goes to the model with the why, due outside the
// standing goal's budget (replan.js: a due request prompts even with self-prompting stopped), at most once per
// ESCAPE_HOLD.ms per cell, so being trapped cannot drive LLM calls.
// Also the post-agenda pickaxe reserve: the agenda's stone_pickaxe step done and no pickaxe carried (used up, lost at a
// death): one is re-crafted by script when the bot holds the makings (pickaxe.js), at most PICKAXE_RESERVE.triesPerDay.

import { isTrapped, stillTrapped, escape, escapeText, surfaceTarget, ESCAPE_HOLD } from './library/escape.js';
import { bestPickaxe, pickaxePlan, makePickaxe, PICKAXE_RECIPE_TEXT } from './library/pickaxe.js';
import { requestReplan } from './replan.js';

/**
 * checkMs: how often an idle bot is looked at; idleTrapMs: how often isTrapped runs when the bot has not dug since the
 * last look (a dig, or a failed escape's mark, makes it look at once).
 */
export const TRAP_JOB = { checkMs: 10_000, idleTrapMs: 60_000, label: 'action:escape (trapped)' };
export const PICKAXE_RESERVE = { triesPerDay: 2, label: 'action:craftRecipe:stone_pickaxe (reserve)' };

const at = (p) => `${p.x}, ${p.y}, ${p.z}`;
const feet = (bot) => bot.entity.position.floored();

/** Whether the bot may be given a scripted job now: no action, no reflex, no night routine, no hold, no respawn escape. */
export function idleForJob(agent) {
    if (agent?.actions?.executing) return false;
    try { if (agent.bot?.modes?.anyActive?.()) return false; } catch { return false; }
    const night = agent._night?.state;
    if (night && night !== 'day') return false;
    if (agent.control?.hold) return false;
    if (agent._escape?.job) return false;
    if (agent.self_prompter?.isActive?.()) return false; // the agenda's prompt says "!goToSurface first" itself
    return typeof agent.actions?.runAction === 'function';
}

/** The failed escapes near here within ESCAPE_HOLD.windowMs (escape.escapeIfTrapped's record). */
const failsNear = (bot, here, now) => (bot.rotnEscapeFails ?? []).filter(f => now - f.t < ESCAPE_HOLD.windowMs && f.at?.distanceTo?.(here) <= ESCAPE_HOLD.cells);

/**
 * One update-loop tick: returns what it did ('escape', 'replan', 'held', 'pickaxe') or null. `run` (the escape) and
 * `craft` are for tests.
 */
export function trappedTick(agent, { now = Date.now(), run = null, craft = null } = {}) {
    const bot = agent?.bot;
    if (!bot?.entity?.position || !idleForJob(agent)) return null;
    const j = agent._trapJob ??= { checkedAt: 0, trapAt: 0, digs: -1, replans: [], pickaxeDay: null, pickaxeTries: 0 };
    if (now - j.checkedAt < TRAP_JOB.checkMs) return null;
    j.checkedAt = now;
    const digs = bot.rotnDigs?.count ?? 0;
    let trapped = null;
    try {
        if (bot.rotnTrapped) trapped = stillTrapped(bot, now);
        else if (digs !== j.digs || now - j.trapAt >= TRAP_JOB.idleTrapMs) {
            j.digs = digs; j.trapAt = now;
            if (isTrapped(bot).trapped) trapped = feet(bot);
        }
    } catch { trapped = null; }
    if (trapped) return trappedJob(agent, j, trapped, { now, run, craft });
    return pickaxeReserve(agent, j, { now, craft });
}

function trappedJob(agent, j, here, { now, run, craft }) {
    const bot = agent.bot;
    const fails = failsNear(bot, here, now);
    const last = fails.at(-1);
    if (last && now - last.t < ESCAPE_HOLD.ms) {
        // Held: the escape failed here within its hold. One re-plan per hold per cell, due (outside the standing budget).
        const key = `${here.x},${here.y},${here.z}`;
        j.replans = j.replans.filter(r => now - r.t < ESCAPE_HOLD.ms);
        if (j.replans.some(r => r.key === key || (r.at && r.at.distanceTo?.(here) <= ESCAPE_HOLD.cells))) return 'held';
        j.replans.push({ key, at: here, t: now });
        const why = last.why ?? 'no result';
        const note = `You are trapped at ${at(here)}: no walkable way to open ground. The escape failed here (${why}).`
            + (/needs a pickaxe \(you carry none\)|a stone pickaxe needs/.test(why) ? ` You have no pickaxe: ${PICKAXE_RECIPE_TEXT}; get them, then !craftRecipe("stone_pickaxe", 1) and !goToSurface.` : ' Get out first: !goToSurface tries from here.');
        console.log(`[trapped] at ${at(here)}, idle, the escape failed ${Math.round((now - last.t) / 1000)} s ago: one re-plan (due)`);
        requestReplan(agent, 'trapped', null, { now, due: true, note });
        return 'replan';
    }
    console.log(`[trapped] at ${at(here)}, idle: the escape runs (day budget)`);
    bot.rotnTrapped = { at: here, since: bot.rotnTrapped?.since ?? now };
    const go = run ?? ((b) => escape(b, { budget: 'day', target: surfaceTarget(b), ...(craft ? { craft } : {}) }));
    const job = async () => {
        const r = await go(bot);
        const t = Date.now();
        if (r?.out) { bot.rotnTrapped = null; console.log(`[trapped] out: ${escapeText(r)}`); return r; }
        if (!r?.interrupted) bot.rotnEscapeFails = [...(bot.rotnEscapeFails ?? []).filter(f => t - f.t < ESCAPE_HOLD.windowMs), { at: r?.at ?? here, t, why: r?.why ?? 'no result' }].slice(-8);
        console.log(`[trapped] still trapped: ${escapeText(r)}`);
        return r;
    };
    Promise.resolve(agent.actions.runAction(TRAP_JOB.label, job)).catch(err => console.warn(`[trapped] the escape job: ${err?.message ?? err}`));
    return 'escape';
}

/** The post-agenda pickaxe reserve: the stone_pickaxe step done, none carried, the makings held: crafted by script. */
function pickaxeReserve(agent, j, { now, craft }) {
    const bot = agent.bot;
    if (!agent.agenda?.done_at?.stone_pickaxe || bestPickaxe(bot)) return null;
    const day = bot.time?.day ?? null;
    if (j.pickaxeDay !== day) { j.pickaxeDay = day; j.pickaxeTries = 0; }
    if (j.pickaxeTries >= PICKAXE_RESERVE.triesPerDay) return null;
    let tableNear = false;
    try { tableNear = !!bot.findBlock?.({ matching: (b) => /crafting_table$/.test(b?.name ?? ''), maxDistance: 4 }); } catch { tableNear = false; }
    const plan = pickaxePlan(bot, { tableNear });
    if (!plan.ready) {
        if (j.pickaxeSaid !== plan.why) { j.pickaxeSaid = plan.why; console.log(`[pickaxe] reserve: no pickaxe carried; not crafted now: ${plan.why}`); }
        return null;
    }
    j.pickaxeTries++;
    console.log(`[pickaxe] reserve: no pickaxe carried: crafting a stone pickaxe (try ${j.pickaxeTries} of ${PICKAXE_RESERVE.triesPerDay} today)`);
    const doCraft = craft ?? (async (b, item, n) => (await import('./library/skills.js')).craftRecipe(b, item, n));
    Promise.resolve(agent.actions.runAction(PICKAXE_RESERVE.label, () => makePickaxe(bot, { craft: doCraft, tableNear })))
        .catch(err => console.warn(`[pickaxe] reserve craft: ${err?.message ?? err}`));
    return 'pickaxe';
}
