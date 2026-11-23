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
// R2: at night, after an escape that got there, the shelter goes where it ended, a hole first
//     (night_routine: escapedRecently); after one that fell short, the night walk takes the full target
//     (escapeFellShort, #581 review 3).
// R6: the Scroll of New Life (lifescroll:spawnscroll) sets the respawn point where the bot stands
//     (rotn-data: forced spawn, respawn within ~2 blocks; deaths within 32 blocks of it raise no
//     player zombie). The bot uses it once, by skill, never the model: at its first night shelter
//     site at least SCROLL.away from the spawn square and every death spot, with no hostile within
//     SCROLL.quiet.

import pf from 'mineflayer-pathfinder';
import { isPlayerZombie, shelterEnemy } from './library/threats.js';
import { safeError } from './safe_error.js';
import { isGiverGoal } from './agenda_driver.js';
import { placesToLeave } from './respawn_relocate.js';
import { waitText } from './library/wait_text.js';
export { waitText }; // #588 re-review nit 2: one helper (library/wait_text.js)

/**
 * away: blocks from every recent death spot and from the spawn square; spawnRadius: the spawn
 * square's half side (the spawnRadius gamerule, 10: a respawn lands within it); trigger: a death
 * spot or a player zombie this near the bot or the spawn starts it; afterDeathMs: how soon after a
 * death it may start; hostileRange: hostiles that steer the aim; aimMs: how often the aim is checked;
 * turnDeg: the change of direction that sets a new goal (#581 review 6: each new goal resets the path
 * and drops the sprint); ahead: how far ahead each aim points; checkMs: its poll; maxMs: its cap;
 * walkFood: at or below, no sprint (checked while it runs, #581 review 7); tries: runs per death (a
 * self_preservation interrupt or a death is no try, #581 review 1); pitWithinMs: an escape that got
 * there this recently makes the night shelter a hole there (R2); stallMs/detourMs: no progress for
 * stallMs turns the aim 90 degrees for detourMs (#581 nit 8: water, a cliff, a wall).
 */
export const ESCAPE_RUN = { away: 64, spawnRadius: 10, trigger: 48, afterDeathMs: 3 * 60_000, hostileRange: 32, aimMs: 1000, turnDeg: 30, ahead: 16,
    checkMs: 250, maxMs: 60_000, walkFood: 6, tries: 3, pitWithinMs: 3 * 60_000, stallMs: 5000, detourMs: 3000, minGain: 2,
    // #583 nit 3: dueFreshMs spans about six of the agent's 300 ms update ticks (agent.js INTERVAL), so a flag
    // refreshed each tick never lapses between them, and one a hold stopped refreshing lapses in 2 s.
    dueFreshMs: 2000 };
/** The modes the escape pauses while it runs (self_preservation stays on). */
export const ESCAPE_PAUSES = ['cowardice', 'self_defense', 'unstuck', 'item_collecting', 'hunting', 'eating', 'torch_placing', 'elbow_room'];
/** The escape's action label. */
export const ESCAPE_LABEL = 'action:respawnEscape';

const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const at = (p) => `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;

/** Horizontal distance from p to a place: a death spot's point, or the spawn's square (spawnRadius each way). */
export function placeDistance(p, place, spawnRadius = ESCAPE_RUN.spawnRadius) {
    if (place.what !== 'spawn') return hdist(p, place.pos);
    const dx = Math.max(0, Math.abs(p.x - place.pos.x) - spawnRadius), dz = Math.max(0, Math.abs(p.z - place.pos.z) - spawnRadius);
    return Math.hypot(dx, dz);
}
const nearestOf = (p, places) => (places.length ? Math.min(...places.map(q => placeDistance(p, q))) : Infinity);

/**
 * The hostile mobs within range of the bot: a player zombie, or what the shelter treats as an enemy
 * (threats.shelterEnemy; #581 review 5: never an animal or a villager, which mcdata's isHostile counted).
 */
export function hostilesNear(bot, range = ESCAPE_RUN.hostileRange) {
    const here = bot?.entity?.position;
    if (!here) return [];
    return Object.values(bot.entities ?? {}).filter(e => e && e !== bot.entity && e.position && e.position.distanceTo(here) <= range
        && (isPlayerZombie(e) || (() => { try { return !!shelterEnemy(e); } catch { return false; } })()));
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
 * spawn's square by its nearest point) and the hostiles near; turned by `turn` degrees (a detour).
 * Straight away from the spawn when the pulls cancel out.
 */
export function aimPoint(bot, places, hostiles = hostilesNear(bot), turn = 0) {
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
    vx /= len; vz /= len;
    if (turn) {
        const a = turn * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        [vx, vz] = [vx * c - vz * s, vx * s + vz * c];
    }
    return { x: Math.round(here.x + vx * ESCAPE_RUN.ahead), z: Math.round(here.z + vz * ESCAPE_RUN.ahead) };
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

const angleDeg = (a, b) => {
    const d = Math.abs(Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x)) * 180 / Math.PI;
    return d > 180 ? 360 - d : d;
};

/**
 * The run itself: until ESCAPE_RUN.away from every place, the cap, or a stop. Returns {arrived, far,
 * ms, stopped?}. The aim is checked every ESCAPE_RUN.aimMs; a new goal only when the direction turned
 * ESCAPE_RUN.turnDeg or more, or the bot is near the goal (#581 review 6). The food is checked as it
 * runs: at ESCAPE_RUN.walkFood or lower, no sprint (#581 review 7). No progress for stallMs: a 90-degree
 * detour for detourMs, the other side next time (#581 nit 8). ops: setGoal(bot, x, z), sleep(ms), now().
 */
export async function escapeRun(bot, places, { now = () => Date.now(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), setGoal = null } = {}) {
    const start = now();
    const far = () => nearestOf(bot.entity.position, places);
    const goTo = setGoal ?? ((b, x, z) => b.pathfinder.setGoal(new pf.goals.GoalNearXZ(x, z, 2)));
    const before = bot.pathfinder?.movements ?? null;
    if (!setGoal) bot.pathfinder.setMovements(escapeMovements(bot));
    let aimed = -Infinity, goal = null, dir = null;
    let best = far(), bestAt = start, detour = 0, detourUntil = -Infinity, side = 90;
    try {
        for (;;) {
            const d = far();
            const t = now();
            if (d >= ESCAPE_RUN.away) return { arrived: true, far: d, ms: t - start };
            if (bot.interrupt_code) return { arrived: false, far: d, ms: t - start, stopped: 'interrupted' };
            if (t - start >= ESCAPE_RUN.maxMs) return { arrived: false, far: d, ms: t - start, stopped: 'time' };
            if (bot.rotnSprint && Number.isFinite(bot.food) && bot.food <= ESCAPE_RUN.walkFood) {
                bot.rotnSprint = false;
                if (bot.pathfinder?.movements) bot.pathfinder.movements.allowSprinting = false;
            }
            if (d >= best + ESCAPE_RUN.minGain) { best = d; bestAt = t; }
            if (t - bestAt >= ESCAPE_RUN.stallMs && t >= detourUntil) {
                detour = side; side = -side; detourUntil = t + ESCAPE_RUN.detourMs; bestAt = t; aimed = -Infinity;
            }
            if (t >= detourUntil && detour) { detour = 0; aimed = -Infinity; }
            if (t - aimed >= ESCAPE_RUN.aimMs) {
                aimed = t;
                const p = aimPoint(bot, places, hostilesNear(bot), detour);
                const here = bot.entity.position;
                const v = { x: p.x - here.x, z: p.z - here.z };
                const nearGoal = goal && hdist(here, goal) <= 4;
                if (!goal || nearGoal || !dir || angleDeg(v, dir) >= ESCAPE_RUN.turnDeg) {
                    goTo(bot, p.x, p.z);
                    goal = p; dir = v;
                }
            }
            await sleep(ESCAPE_RUN.checkMs);
        }
    } finally {
        if (!setGoal) {
            try { bot.pathfinder.setGoal(null); } catch { /* best effort */ }
            // #581 review 7: the movements from before the run come back (no sprinting leaks into later walks).
            try { if (before) bot.pathfinder.setMovements(before); } catch { /* best effort */ }
        }
    }
}

/**
 * R2: whether an escape got there within ESCAPE_RUN.pitWithinMs (arrived, or the bot is at least
 * ESCAPE_RUN.away from every place now): the night shelter then is a hole where it ended (#581 review 3).
 */
export function escapedRecently(agent, now = Date.now()) {
    const r = agent?._escape;
    if (!Number.isFinite(r?.endedAt) || now - r.endedAt > ESCAPE_RUN.pitWithinMs) return false;
    if (r.arrived) return true;
    const here = agent.bot?.entity?.position;
    return !!here && nearestOf(here, placesToLeave(agent, now)) >= ESCAPE_RUN.away;
}
/** #581 review 3: an escape ended recently without getting there: the night walk takes the full target. */
export function escapeFellShort(agent, now = Date.now()) {
    const r = agent?._escape;
    return Number.isFinite(r?.endedAt) && now - r.endedAt <= ESCAPE_RUN.pitWithinMs && !escapedRecently(agent, now);
}

/**
 * #581 re-review nit 5: the escape's whole window: it runs, or it is due (waiting for self_preservation,
 * or between tries). Commands wait for all of it (commands/actions.js runAsAction).
 */
export function escapeWindow(agent, now = Date.now()) {
    if (agent?._escape?.job) return true;
    try { return !!escapeReason(agent, now); } catch { return false; }
}
/**
 * The flag commands read (actions.js runAsAction): set on each tick from escapeWindow, and good for
 * ESCAPE_RUN.dueFreshMs of wall time (dueUntil). #581 follow-up 1: a control hold (a giver's !stop or
 * !pause) returns before this tick runs, and a flag left true refused every typed command for hours.
 */
const noteWindow = (agent, now) => {
    if (!agent?._escape) return;
    agent._escape.due = escapeWindow(agent, now);
    // #583 nit 2: the window by the tick's (injectable) now; dueUntil by the wall clock runAsAction reads.
    agent._escape.dueUntil = agent._escape.due ? Date.now() + ESCAPE_RUN.dueFreshMs : 0;
};

/**
 * One check, from the priority stack before the night routine: 'escaping' while the escape runs (the
 * night routine, tasks, the agenda and the model's goal wait), 'escaping:wait' while self_preservation
 * acts (#581 review 1: a swim-up or a low-health move away is never cut), else null. A task giver's
 * goal is paused for it and resumed after (#581 review 4). Never throws.
 */
export function respawnEscapeTick(agent, { now = Date.now(), run = escapeRun, log = (l) => console.log(l) } = {}) {
    const r = agent._escape ??= { forDeath: null, tries: 0, job: null, endedAt: null };
    if (r.job) return 'escaping';
    let why = null;
    try { why = escapeReason(agent, now); } catch (err) { log(`[respawn] escape check: ${safeError(err)}`); why = null; }
    noteWindow(agent, now);
    if (!why) return null;
    const bot = agent.bot;
    if (bot.modes?.isActive?.('self_preservation')) return 'escaping:wait';
    if (r.forDeath !== why.key) Object.assign(r, { forDeath: why.key, tries: 0, done: false, arrived: false });
    r.tries++;
    const deaths = why.places.filter(p => p.what === 'death spot').length;
    const what = [why.places.some(p => p.what === 'spawn') ? 'the spawn' : null, deaths ? `${deaths} recent death spot${deaths === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ');
    const sprint = !(Number.isFinite(bot.food) && bot.food <= ESCAPE_RUN.walkFood);
    const zombies = hostilesNear(bot).filter(isPlayerZombie).length;
    log(`[respawn] escape (try ${r.tries} of ${ESCAPE_RUN.tries}): ${sprint ? 'sprinting' : `walking (food ${bot.food})`} at least ${ESCAPE_RUN.away} blocks from ${what}`
        + `${zombies ? `, ${zombies} player zombie${zombies === 1 ? '' : 's'} near` : ''}; no digging, no pickups, no fights`);
    const sp = agent.self_prompter;
    let giverPaused = null;
    if (sp?.isActive?.()) {
        if (isGiverGoal(agent)) {
            // #581 review 4: a task giver's goal waits too: paused (kept), resumed when the escape ends.
            giverPaused = sp.prompt;
            sp.setPromptPaused?.(sp.prompt);
            Promise.resolve(sp.stopLoop?.()).catch(() => {});
        } else sp.stop(false);
    }
    agent._agenda_paused = true;
    const modes = bot.modes;
    const wasSprint = bot.rotnSprint;
    // #581 re-review nit 3: a stale record of an earlier escape's stopper is not this one's.
    if (agent.rotnLastInterrupt?.of === ESCAPE_LABEL) agent.rotnLastInterrupt = null;
    let result = null;
    r.job = Promise.resolve()
        .then(() => agent.actions.runAction(ESCAPE_LABEL, async () => {
            // #581 re-review 1: the pauses inside the action, once it runs. runAction first waits for the
            // running action (a cowardice flee) to stop, and modes.update() unpauses every mode while the
            // agent is idle in between: paused before, cowardice was live again when the run began.
            for (const m of ESCAPE_PAUSES) { try { modes?.pause?.(m); } catch { /* not every mode exists */ } }
            bot.rotnSprint = sprint;
            bot.rotnEscaping = true; // unstuck holds off (modes.js)
            result = await run(bot, why.places);
        }, { keepReplan: true }))
        .catch(err => { log(`[respawn] the escape failed: ${safeError(err)}`); return null; })
        .then((ret) => {
            r.job = null;
            bot.rotnSprint = wasSprint ?? false;
            if (bot.pathfinder?.movements && !bot.rotnSprint) bot.pathfinder.movements.allowSprinting = false;
            bot.rotnEscaping = false;
            for (const m of ESCAPE_PAUSES) { try { modes?.unpause?.(m); } catch { /* best effort */ } }
            if (giverPaused && sp?.isPaused?.()) { try { sp.start(giverPaused); } catch { /* best effort */ } }
            r.endedAt = Date.now();
            const here = bot.entity?.position;
            const far = here ? Math.round(nearestOf(here, why.places)) : 0;
            const secs = Math.round((result?.ms ?? 0) / 1000);
            if (result?.arrived) {
                r.done = true;
                r.arrived = true;
                log(`[respawn] escape done: ${far} blocks from ${what} at ${here ? at(here) : '?'} in ${secs} s`);
                return;
            }
            // #581 nit 9: a death during the run ends it; the next death has its own escape.
            if (agent._death?.last?.at !== why.key) { log(`[respawn] the escape ended with a death at ${far} blocks from ${what}`); return; }
            // #581 review 1: a self_preservation interrupt (a swim-up, a low-health move away) is no try.
            const by = agent.rotnLastInterrupt?.of === ESCAPE_LABEL ? agent.rotnLastInterrupt.by : null;
            if ((ret?.interrupted || result?.stopped === 'interrupted') && by === 'self_preservation') r.tries = Math.max(0, r.tries - 1);
            const how = ret?.interrupted || result?.stopped === 'interrupted' ? `was interrupted${by ? ` by ${by}` : ''}` : result?.stopped === 'time' ? `ran out of its ${ESCAPE_RUN.maxMs / 1000} s` : 'ended';
            if (result?.stopped === 'time') r.done = true;
            // #581 follow-up 3: between tries, commands stay held until the next tick starts the next run.
            noteWindow(agent, Date.now());
            log(`[respawn] the escape ${how} at ${far} blocks from ${what}${here ? ` (at ${at(here)})` : ''}${r.done || r.tries >= ESCAPE_RUN.tries ? '' : '; running it again'}`);
        });
    return 'escaping';
}

/** R6: the Scroll of New Life. away: from the spawn square and every death spot; quiet: no hostile this near. */
// Soak 11 (F1): waitMs 5 s (2 s before), one retry, and the use only once an eat is over (afterEatMs after it, settleMs at most).
/** #587 review 1: the server's own line after a scroll use (a hint for the journal, never the proof). */
export const SCROLL_SAID = /^Your spawnpoint is now -?\d+, -?\d+, -?\d+!$/;
export const SCROLL = { item: 'lifescroll:spawnscroll', away: 100, quiet: 16, waitMs: 5000, tries: 2, afterEatMs: 1000, settleMs: 5000 };
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
export async function useSpawnScroll(bot, { waitMs = SCROLL.waitMs, settleMs = SCROLL.settleMs, afterEatMs = SCROLL.afterEatMs, tries = SCROLL.tries, step = 100 } = {}) {
    const count = () => bot.inventory.items().filter(isSpawnScroll).reduce((n, i) => n + i.count, 0);
    if (!bot.inventory.items().find(isSpawnScroll)) return { used: false, why: 'no scroll held' };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    // Soak 11 (F1): 21:31:58 the use started in the same second as an eat, and the server log has no
    // lifescroll line: the use never reached it. First the eat (or any held-item use) is over, and
    // SCROLL.afterEatMs has passed since the last one (food.eatFood's rotnAteAt), for at most settleMs.
    const eatingNow = () => !!bot.usingHeldItem || Date.now() - (bot.rotnAteAt ?? -Infinity) < afterEatMs;
    for (let waited = 0; waited < settleMs && eatingNow(); waited += step) {
        if (bot.interrupt_code) return { used: false, why: 'stopped before the use' };
        await sleep(step);
    }
    // #587 nit 2: still eating after settleMs: not now (the next shelter tries again).
    if (eatingNow()) return { used: false, why: `still eating after ${waitText(settleMs)}` };
    const before = count();
    const held = bot.heldItem;
    // #587 review 1 (the lead): the use counts ONLY when the stack shrinks. Any player can type "your
    // spawnpoint is now ..." (and on 1.12 /tell and /say arrive as 'system' too), so the server's line
    // is only a hint for the journal: a 'system' line that is exactly SCROLL_SAID. #587 nit 2: such a line
    // not from the scroll (an op's /tellraw) can only stop the retry; it never marks the scroll used.
    const chat = [];
    let said = null;
    const onChat = (text, position) => {
        const line = String(text ?? '');
        if (position === 'system' && SCROLL_SAID.test(line.trim())) said = line.trim();
        else if (chat.length < 3) chat.push(line.slice(0, 80));
    };
    bot.on?.('messagestr', onChat);
    bot.rotnScrollBySkill = true;
    const notes = [];
    const hint = () => (said ? `; the server said "${said}"` : '');
    try {
        for (let t = 1; t <= tries; t++) {
            if (bot.interrupt_code) { notes.push(`try ${t}: stopped`); break; }
            // #587 nit 5: a late answer to try 1 plus a retry could spend a second scroll: with more than
            // one held (or the server's line seen), no retry.
            if (t > 1 && (count() > 1 || said)) { notes.push(`no try ${t}: ${said ? 'the server answered try 1' : `${count()} scrolls held (a late answer could spend two)`}`); break; }
            const scroll = bot.inventory.items().find(isSpawnScroll);
            if (!scroll) break;
            // #587 nit 3: a throw ends this try only.
            try {
                await bot.equip(scroll, 'hand');
                if (!isSpawnScroll(bot.heldItem)) { notes.push(`try ${t}: the scroll was not in hand (held ${bot.heldItem?.name ?? 'nothing'})`); continue; }
                bot.activateItem();
                // #587 nit 4: a stop ends the wait.
                for (let waited = 0; waited < waitMs && count() >= before && !bot.interrupt_code; waited += step) await sleep(step);
                try { bot.deactivateItem?.(); } catch { /* best effort */ }
            } catch (err) {
                notes.push(`try ${t}: ${safeError(err)}`);
                continue;
            }
            if (count() < before) return { used: true, by: said ? 'the stack shrank and the server said so' : 'the stack shrank', tries: t };
            if (bot.interrupt_code) { notes.push(`try ${t}: stopped`); break; }
            notes.push(`try ${t}: the stack did not shrink in ${waitText(waitMs)} (held ${bot.heldItem?.name ?? 'nothing'} in slot ${bot.heldItem?.slot ?? '?'})`);
        }
    } finally {
        bot.rotnScrollBySkill = false;
        bot.removeListener?.('messagestr', onChat);
        if (held && !isSpawnScroll(held)) { try { await bot.equip(held, 'hand'); } catch { /* best effort */ } }
    }
    return { used: false, why: `the scroll was not used up (${notes.join('; ') || 'no try'}${hint()}; other chat seen (player text, quoted): ${chat.length ? chat.map(c => JSON.stringify(c)).join(', ') : 'none'})` };
}
