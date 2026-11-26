// G4 #5 (test/scenarios/g4/PLAN.md: the soak counts eating, fights, fleeing and the food level
// from the bot's journal). One stable, greppable line per event, all starting "[survival] ":
//
//   [survival] ate <item> food <before>-><after>
//   [survival] fight start <mob> (<where>)              where: open | shelter
//   [survival] fight end <mob> <outcome> after <secs> s  outcome: killed | gone | stopped | capped | interrupted | died
//   [survival] flee <mob> (<why>)
//   [survival] food <food> health <health> (<reason>)    reason: check (at most once a minute) | low (each new lower level at or below food.EAT_AT, 8; at most once a minute)
//   [survival] hurt <amount> health <before>-><after> (by <source>)   soak 2: health fell by HURT.minDrop or more within HURT.windowMs
//   [survival] hurt-detail drops <amount>@+<s>s,... at <x>,<y>,<z> vy <v> ground|air cause <fall|starving|none> near <mob>@<d>m[/swung-<s>s],...
//                                                                     soak 5: right after each hurt line
//   [survival] swing <mob> with <item> +<ms> ms|first: health <before> -> <after>|gone   soak 7: each swing of the shelter fight
//   [survival] weapon <item>|hand (<where>)              soak 7 (c): what the bot holds at a fight's first hit, after it took its best
//                                                         weapon in hand; where: shelter | open | attack | cell | hunt;
//                                                         soak 7 (e): only when the held item differs from the last weapon line's
//
// Soak 2 (rotn-v0.1.4): the server sends no death messages, and two deaths had no cause in the
// journal. The hurt line names the likely source: 'starving' (food 0: Hunger Overhaul's
// damageOnStarve=200 kills at once), a mob within HURT.mobRange (its entity type), 'fall' when the
// bot was falling, else 'unknown'. Soak 3 (rotn-v0.1.5): the nearest entity of any kind was named,
// and that was most often Zombie Awareness's invisible scent marker on the bot's own trail
// (zombieawareness:entityscent) or the soul left at a death spot (randomthings:playersoul), not
// the zombie that hit. Now only an entity that can hurt counts (mayHurt: rotn-data level not
// 'none', or an animal that fights back when provoked, or a player); of those, the nearest that
// swung its arm in the last HURT.swingMs, else the nearest hostile one, else the nearest.
//
// Tokens never hold spaces: <item> is food.foodKey, "<registry name>:<meta>" ("minecraft:bread:0",
// "rustic:wildberries:0"), from the eating reflex and the consume skill alike; <mob> the
// entity type ("zombie", "zombie_players:zombie_player"; a player is "player", never a name), so no
// custom name, username or server text reaches the journal. The console only: chat is unchanged.

// No import of food.js (it imports this file): the eat threshold is passed in (bindSurvivalLog).
import { threatFor, attackSent } from './threats.js';

export const SURVIVAL_TAG = '[survival]';
/** The food line's period, and the least time between two "low" lines (G4: no periodic line more than once a minute). */
export const FOOD_LOG_MS = 60_000;
/** After an eat, how long the bot's food level may take to change (the server's update_health). */
export const FOOD_UPDATE_MS = 500;
export const FIGHT_OUTCOMES = ['killed', 'gone', 'stopped', 'capped', 'interrupted', 'died'];

// Soak 12 (G): '/' kept for a drop's "<mob>/arrow" (entity and item names hold none).
const token = (s) => String(s ?? 'unknown').replace(/[^\w:./-]/g, '_') || 'unknown';
/** A mob's name for the journal: its entity type; a player is "player" (never a username). */
export const mobName = (e) => (e?.type === 'player' ? 'player' : token(e?.name));
const num = (n) => (Number.isFinite(n) ? String(Math.round(n * 10) / 10) : 'unknown');

export const ateLine = (item, before, after) => `${SURVIVAL_TAG} ate ${token(item)} food ${num(before)}->${num(after)}`;
export const fightStartLine = (mob, where) => `${SURVIVAL_TAG} fight start ${token(mob)} (${where === 'shelter' ? 'shelter' : 'open'})`;
export const fightEndLine = (mob, outcome, ms) => {
    if (!FIGHT_OUTCOMES.includes(outcome)) throw new Error(`unknown fight outcome ${outcome}`);
    return `${SURVIVAL_TAG} fight end ${token(mob)} ${outcome} after ${Math.max(0, Math.round(ms / 1000))} s`;
};
export const fleeLine = (mob, why) => `${SURVIVAL_TAG} flee ${token(mob)} (${String(why ?? 'unknown').replace(/[()\n\r]/g, ' ').trim() || 'unknown'})`;
/** Soak 7: one shelter-fight swing: the held item, ms since the swing before it (null: the first), the mob's health before it and at the next look ('gone': no longer in the world; null: unknown). */
export const swingLine = (mob, item, sinceMs, before, after) => `${SURVIVAL_TAG} swing ${token(mob)} with ${token(item ?? 'hand')} ${Number.isFinite(sinceMs) ? `+${Math.round(sinceMs)} ms` : 'first'}: health ${num(before)} -> ${after === 'gone' ? 'gone' : num(after)}`;
/** Soak 7 (c): what the bot holds at the first hit of a fight (after equipHighestAttack); 'hand' when nothing. */
export const weaponLine = (item, where) => `${SURVIVAL_TAG} weapon ${token(item ?? 'hand')} (${where})`;
const weaponSaidFor = new WeakMap(); // bot -> the held item its last weapon line named
/**
 * weaponLine for the bot now, only when the held item differs from the one its last weapon line
 * named (soak 7 (e): avoidEnemies' cornered hit called this every 500 ms). Whether it logged.
 */
export function logWeapon(bot, where) {
    const item = bot?.heldItem?.name ?? null;
    if (bot && typeof bot === 'object') {
        if (weaponSaidFor.has(bot) && weaponSaidFor.get(bot) === item) return false;
        weaponSaidFor.set(bot, item);
    }
    console.log(weaponLine(item, where));
    return true;
}
export const hurtLine = (amount, before, after, source) => `${SURVIVAL_TAG} hurt ${num(amount)} health ${num(before)}->${num(after)} (by ${Array.isArray(source)
    ? source.map(x => `${token(x.source)} ${num(x.amount)}`).join(', ') : token(source)})`;
export const HURT = { minDrop: 4, windowMs: 2000, mobRange: 5, swingMs: 1000, fallingRange: 4, detailRange: 16, detailMobs: 3 };
/** A falling block or a falling Dynamic Trees tree (entity names). */
const FALLING = /falling/;

/** Swings kept per bot (bindSurvivalLog): older ones are dropped once there are more than this many. */
const SWINGS_KEPT = 64;

/**
 * Whether an entity can have dealt the damage (soak 3): a player, a mob rotn-data rates above
 * 'none' (or an unknown one mc.isHostile counts), or an animal that fights back when provoked (a
 * bull). Not a marker such as zombieawareness:entityscent or randomthings:playersoul (level 'none').
 */
export function mayHurt(e) {
    if (!e || e.type === 'object' || e.name === 'item') return false;
    if (e.type === 'player') return true;
    if (Number.isFinite(e.rotnProvokedAt)) return true; // soak 14 (F3): the bot hit it
    const t = threatFor(e);
    // Soak 14 (F3, death 1): a grove sprite is level 'none' with no provoked flag, but it fights back once
    // provoked (reaction ignore-unless-provoked, as the endermen): it hit for 5.5 three times as "unknown".
    return !!t && (t.level !== 'none' || !!t.provoked || t.reaction === 'ignore-unless-provoked');
}

/**
 * Soak 14 (F3, the lead): a mob the bot's own attack (or sweep, or projectile) hit is provoked for the rest
 * of its chase: marked on the entity, and forgotten once it is more than PROVOKED.chase blocks away (rotn-data:
 * a provoked grove sprite chases within 40 blocks while in sight). The hurt source and the low-health flee
 * point at it.
 */
export const PROVOKED = { chase: 40 };
/**
 * #612 review 4 (the lead): only a mob that fights back is marked (reaction ignore-unless-provoked, an animal that
 * fights back when provoked, or a level above 'none'): a hunted cow is not, so a hit with no swing is not put on it.
 */
export function fightsBack(e) {
    if (!e || e.type === 'player' || e.type === 'object' || e.name === 'item') return false;
    const t = threatFor(e);
    return !!t && (t.reaction === 'ignore-unless-provoked' || !!t.provoked || t.level !== 'none');
}
/** A mob that attacks once provoked (and chases): ignore-unless-provoked (the grove sprite) or a level above 'none'. */
export function attacksOnceProvoked(e) {
    const t = e && e.type !== 'player' ? threatFor(e) : null;
    return !!t && (t.reaction === 'ignore-unless-provoked' || t.level !== 'none');
}
export function markProvoked(e, now = Date.now()) {
    if (e && typeof e === 'object' && fightsBack(e)) e.rotnProvokedAt = now;
}
export function isProvoked(bot, e) {
    if (!Number.isFinite(e?.rotnProvokedAt)) return false;
    const here = bot?.entity?.position;
    if (here && e.position && e.position.distanceTo(here) > PROVOKED.chase) { delete e.rotnProvokedAt; return false; }
    return bot?.entities?.[e.id] === e || !bot?.entities;
}
/** A living entity that may have swung at the bot (any mob, a player): not an item, an object or a marker. */
const living = (e) => !!e && e.type !== 'object' && e.name !== 'item' && !/entityscent|playersoul/.test(e.name ?? '');

/** Soak 14 (F3): the mob a hurt line named last ({id, at} on the bot), for the low-health flee (modes.js). */
function noteHitter(bot, e, now) { if (bot && e?.id !== undefined) bot.rotnLastHitter = { id: e.id, at: now }; }
/** The entity a hurt line named within ms, still in the world, or null. */
export function recentHitter(bot, ms = 3000, now = Date.now()) {
    const h = bot?.rotnLastHitter;
    if (!h || now - h.at > ms) return null;
    return bot.entities?.[h.id] ?? null;
}

const isHostileThreat = (e) => e.type !== 'player' && ['hostile', 'dangerous'].includes(threatFor(e)?.level);

/**
 * The likely source of the damage just taken (see the header): 'starving', a mob type, 'fall' or
 * 'unknown'. `swings` maps entity id to the time of its last arm swing (bindSurvivalLog).
 */
export function hurtSource(bot, { swings = null, now = Date.now() } = {}) {
    if (Number.isFinite(bot?.food) && bot.food <= 0) return 'starving';
    // Soak 5 (01:42:52, "hurt 17 (by unknown)"): the bot had landed after a 24-block drop. The damage
    // record (damage_record.js) names a landing after a drop over 3 as the fall: that first.
    if (bot?.lastDamageCause === 'fall' && now - (bot.lastDamageTime ?? -Infinity) <= HURT.windowMs) return 'fall';
    const here = bot?.entity?.position;
    // A falling block or tree (an object entity, which mayHurt leaves out) right over the bot:
    // #502 nit 1: at or above its feet, within 2 blocks sideways.
    const falling = here ? Object.values(bot.entities ?? {}).find(e => e && e !== bot.entity && e.position
        && FALLING.test(e.name ?? '') && e.position.distanceTo(here) <= HURT.fallingRange
        && e.position.y >= here.y && Math.hypot(e.position.x - here.x, e.position.z - here.z) <= 2) : null;
    if (falling) return token(falling.name);
    if (here) {
        const inRange = Object.values(bot.entities ?? {})
            .filter(e => e && e !== bot.entity && e.position && e.position.distanceTo(here) <= HURT.mobRange)
            .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here));
        // Soak 14 (F3, the lead): a mob that swung within HURT.swingMs and is within HURT.mobRange is named
        // whatever its threat level (a mob that hits the bot must be attributable); then one the bot provoked.
        const swung = inRange.find(e => living(e) && now - (swings?.get(e.id) ?? -Infinity) <= HURT.swingMs);
        const near = inRange.filter(mayHurt);
        // #612 review 4: a provoked attacker (ignore-unless-provoked, as the grove sprite, or above 'none') before a
        // hostile one; a provoked animal that only fights back (a hunted cow: provoked.fightBack) after them.
        const pick = swung ?? near.find(e => isProvoked(bot, e) && attacksOnceProvoked(e)) ?? near.find(isHostileThreat)
            ?? near.find(e => isProvoked(bot, e)) ?? near[0];
        if (pick) { noteHitter(bot, pick, now); return mobName(pick); }
    }
    if ((bot?.entity?.velocity?.y ?? 0) < -0.5) return 'fall';
    return 'unknown';
}

/**
 * Soak 12 (G): a shot is an arrow (or a bolt or dart) within ARROW.range of the bot at the drop that
 * spawned within ARROW.freshMs (2.5 s: a stuck arrow stops counting then; #594 re-review 1), or one that
 * went from the world within ARROW.range in the last ARROW.goneMs (an arrow that hits is removed about
 * 50 ms after the health packet). Its drop is named after the nearest ranged mob (threats.threatFor(e).ranged)
 * as "<mob>/arrow"; else hurtSource. Arrows the server sends in the first ARROW.freshMs after the bot's
 * respawn packet (the chunks' stuck arrows, sent again before the first health update, so before
 * mineflayer's 'spawn') are not counted as fresh (#594 nit 1, #597 review 1). The first join needs no
 * window: bindSurvivalLog binds after the first spawn, so the arrows sent at the join reached no listener
 * (#597 nit).
 */
export const ARROW = { range: 2.5, goneMs: 500, mobRange: 24, freshMs: 2500 };
const isArrow = (e) => /(arrow|bolt|dart)$/.test(String(e?.name ?? ''));
/**
 * #594 nit 1, #597 review 1: the start of the bot's respawn or login: the entities the server sends right
 * after it are old, not shot. mineflayer's 'respawn' (the respawn packet) and 'login' start the window;
 * its 'spawn' (the first health update, after the entities) only starts one when none began within
 * ARROW.freshMs before it: the earliest time wins.
 */
export function noteBotSpawn(state, now = Date.now(), { fallback = false } = {}) {
    if (fallback && now - (state.spawnedAt ?? -Infinity) < ARROW.freshMs) return;
    state.spawnedAt = now;
}
/** #594 re-review 1: an arrow's spawn time (entitySpawn), kept ARROW.freshMs: only a fresh arrow is a shot. */
export function noteArrowSpawn(state, e, now = Date.now()) {
    if (!isArrow(e) || e?.id == null) return;
    if (now - (state.spawnedAt ?? -Infinity) < ARROW.freshMs) return; // #594 nit 1: re-sent at the spawn
    const m = state.arrowSpawns ??= new Map();
    m.set(e.id, now);
    for (const [id, at] of m) if (now - at > ARROW.freshMs) m.delete(id);
}
export function noteArrowGone(state, bot, e, now = Date.now()) {
    const p = bot?.entity?.position;
    if (p && isArrow(e) && e.position && e.position.distanceTo(p) <= ARROW.range) state.arrowAt = now;
}
export function dropSource(bot, state = {}, now = Date.now()) {
    const p = bot?.entity?.position;
    // #594 review 2 and re-review 1: a stuck arrow lies about 60 s, and a skeleton's misses land around the
    // bot, so a near arrow alone would claim every hit. An arrow's velocity reads 0 here (mineflayer sets
    // none for objects, and the 1.12.2 tracker sends arrows no velocity), and its destroy comes about 50 ms
    // after the health packet: a shot is an arrow near the bot that spawned within ARROW.freshMs, or one
    // gone near it within ARROW.goneMs.
    const fresh = (e) => now - (state.arrowSpawns?.get(e.id) ?? -Infinity) <= ARROW.freshMs;
    const arrow = !!p && (now - (state.arrowAt ?? -Infinity) <= ARROW.goneMs
        || Object.values(bot.entities ?? {}).some(e => e && e !== bot.entity && e.position && isArrow(e) && fresh(e) && e.position.distanceTo(p) <= ARROW.range));
    if (arrow) {
        const shooter = Object.values(bot.entities ?? {}).filter(e => e && e !== bot.entity && e.position && e.position.distanceTo(p) <= ARROW.mobRange && threatFor(e)?.ranged)
            .sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p))[0];
        return `${shooter ? mobName(shooter) : 'unknown'}/arrow`;
    }
    return hurtSource(bot, { swings: state.swings, now });
}
/** Soak 12 (G): the window's drops by source ([{source, amount}], largest first) when more than one source; else null. */
export function sourcesOf(drops) {
    const by = new Map();
    for (const d of drops) if (d.source) by.set(d.source, (by.get(d.source) ?? 0) + d.amount);
    if (by.size > 1) by.delete('unknown'); // a drop with nothing named, next to a named one: not a source of its own
    if (by.size < 2) return by.size === 1 ? [...by.keys()][0] : null;
    return [...by].map(([source, amount]) => ({ source, amount })).sort((a, b) => b.amount - a.amount);
}

/** Note an entity's arm swing (the attack animation) for hurtSource. */
export function noteSwing(swings, entity, now = Date.now()) {
    if (!entity || entity.id == null) return;
    swings.set(entity.id, now);
    if (swings.size > SWINGS_KEPT) {
        for (const [id, at] of swings) if (now - at > HURT.swingMs) swings.delete(id);
    }
}

/**
 * The hurt line when health has fallen by HURT.minDrop or more since the start of a HURT.windowMs
 * window; null otherwise. `state` keeps the window and the last health seen. #432 review 1: a stale
 * window (quiet for HURT.windowMs) starts again from the last health seen, not from the new value,
 * so a single hit, a fall or starving after a quiet spell is caught; a heal starts it at the new value.
 */
export function hurtCheck(state, bot, now = Date.now()) {
    const h = bot?.health;
    if (!Number.isFinite(h)) return null;
    const last = Number.isFinite(state.lastHealth) ? state.lastHealth : h;
    state.lastHealth = h;
    // Soak 5 (00:59:54, "hurt 18.5 by zombie"): several zombies' hits in one window read as one
    // hit. Each drop is kept for the detail line.
    // Soak 12 (G): each drop gets its own source (deaths 10-11: an arrow's 1.9 and a zombie's 5 in one
    // window, the line said "by zombie", the server "shot by Skeleton").
    const drop = h < last ? { at: now, amount: last - h, source: dropSource(bot, state, now) } : null;
    // Soak 14 (F3, the lead): the health the bot last had before an unlogged loss (drops under HURT.minDrop):
    // the highest since the last hurt line, and when. Death 1 went 20 -> 15.7 with no line before its first hit.
    if (!state.seen || h >= state.seen.health) state.seen = { health: h, at: now };
    let w = state.hurt;
    if (!w || h > w.from) { state.hurt = { from: h, at: now }; state.drops = []; return null; }
    if (now - w.at > HURT.windowMs) { w = state.hurt = { from: last, at: now }; state.drops = []; }
    if (drop) (state.drops ??= []).push(drop);
    // Soak 14 (F3): a drop to 0 is always a line (death 1's 1 -> 0 was under minDrop, and no line named the killer).
    if (w.from - h < HURT.minDrop && !(drop && h <= 0)) return null;
    const since = state.seen && state.seen.health - w.from >= 0.5 ? ` since ${num(state.seen.health)} at ${new Date(state.seen.at).toISOString().slice(11, 19)}` : '';
    state.seen = { health: h, at: now };
    const text = hurtLine(w.from - h, w.from, h, sourcesOf(state.drops ?? []) ?? hurtSource(bot, { swings: state.swings, now })) + since;
    const detail = hurtDetail(bot, state.drops ?? [], { swings: state.swings, now, start: w.at, firstSeen: state.firstSeen });
    state.hurt = { from: h, at: now };
    state.drops = [];
    console.log(text);
    console.log(detail);
    return text;
}

/**
 * Soak 5: the line under each hurt line, to check its source afterwards: each drop in the window
 * (its amount and its time from the window's start), where the bot is (position, vertical speed, on
 * the ground or not, the damage record's cause), and the HURT.detailMobs nearest entities that can
 * hurt within HURT.detailRange (type, distance, the last arm swing). Tokens only: never a name.
 */
/**
 * Soak 16 death 2: the killing hit's detail listed zombie_players:zombie_player@0m, the Zombie Player the death itself
 * spawns at the bot's spot (its spawn packet can come before the health packet). An entity first seen at or after the
 * window's last drop (firstSeen: entitySpawn times, noteSpawn) did not deal it: left out. FIRST_SEEN.slackMs: the order
 * of the two packets.
 */
export const FIRST_SEEN = { slackMs: 100, keepMs: 60_000 };
export function noteSpawn(state, e, now = Date.now()) {
    if (e?.id == null) return;
    const m = state.firstSeen ??= new Map();
    m.set(e.id, now);
    for (const [id, at] of m) if (now - at > FIRST_SEEN.keepMs) m.delete(id);
}

export function hurtDetail(bot, drops, { swings = null, now = Date.now(), start = now, firstSeen = null } = {}) {
    const lastDrop = drops.length ? drops.at(-1).at : now;
    const newcomer = (e) => { const t = firstSeen?.get?.(e.id); return Number.isFinite(t) && t >= lastDrop - FIRST_SEEN.slackMs; };
    const p = bot?.entity?.position;
    const where = p ? `${num(p.x)},${num(p.y)},${num(p.z)}` : 'unknown';
    const vy = bot?.entity?.velocity?.y;
    const ground = bot?.entity?.onGround === true ? 'ground' : bot?.entity?.onGround === false ? 'air' : 'unknown';
    const ds = drops.length ? drops.map(d => `${num(d.amount)}@+${num((d.at - start) / 1000)}s${d.source ? `=${token(d.source)}` : ''}`).join(',') : 'none';
    const near = p ? Object.values(bot.entities ?? {})
        .filter(e => e && e !== bot.entity && e.position && e.position.distanceTo(p) <= HURT.detailRange && !newcomer(e)
            && (mayHurt(e) || FALLING.test(e.name ?? '') || (living(e) && now - (swings?.get(e.id) ?? -Infinity) <= HURT.swingMs)))
        .sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p))
        .slice(0, HURT.detailMobs)
        .map(e => {
            const swung = swings?.get(e.id);
            return `${mobName(e)}@${num(e.position.distanceTo(p))}m${Number.isFinite(swung) ? `/swung-${num((now - swung) / 1000)}s` : ''}`;
        }) : [];
    return `${SURVIVAL_TAG} hurt-detail drops ${ds} at ${where} vy ${num(vy)} ${ground} cause ${token(bot?.lastDamageCause ?? 'none')} near ${near.length ? near.join(',') : 'none'}`;
}

export const foodLine = (food, health, reason) => `${SURVIVAL_TAG} food ${num(food)} health ${num(health)} (${reason === 'low' ? 'low' : 'check'})`;

/** Log the eat line once the food level has changed (at most FOOD_UPDATE_MS later). */
export async function logAte(bot, item, before) {
    for (let waited = 0; !(bot.food > before) && waited < FOOD_UPDATE_MS; waited += 50) await new Promise(r => setTimeout(r, 50));
    console.log(ateLine(item, before, bot.food));
}

/** Whether a fought mob is dead or gone from the world (removed, invalid, or health 0). */
export const mobDead = (bot, e) => !!e && (e.isValid === false || bot.entities?.[e.id] !== e || (Number.isFinite(e.health) && e.health <= 0));
const botDead = (bot) => bot.isAlive === false || bot.health === 0;

/**
 * One fight's journal lines: start() at its first swing, end(outcome) once. The outcome is "died"
 * when the bot is dead, "killed" when the first mob fought is dead or gone from the world, else
 * the caller's (gone: no enemy left in range; stopped; capped; interrupted).
 */
export function fightJournal(bot, where) {
    let first = null, startedAt = null, ended = false, weaponSaid = false;
    return {
        /** Soak 7 (c): once per fight, what the bot holds (after its equip). */
        weapon() {
            if (weaponSaid) return;
            weaponSaid = true;
            logWeapon(bot, where);
        },
        start(enemy) {
            if (first) return;
            first = enemy;
            startedAt = Date.now();
            console.log(fightStartLine(mobName(enemy), where));
        },
        end(outcome) {
            if (!first || ended) return;
            ended = true;
            const o = botDead(bot) ? 'died' : (outcome === 'gone' && mobDead(bot, first)) ? 'killed' : outcome;
            console.log(fightEndLine(mobName(first), o, Date.now() - startedAt));
        },
    };
}

/**
 * The food line: once every FOOD_LOG_MS while alive ("check"), and at each new lower food level at or below
 * eatAt (food.EAT_AT, 8) ("low", at most once per FOOD_LOG_MS; soak 14). Call it as often as wanted.
 */
export function foodCheck(state, bot, now = Date.now(), eatAt = 8) {
    if (!Number.isFinite(bot?.food) || botDead(bot)) return null;
    // Soak 14 (F1, the lead): "low" at each new lower level at or below eatAt (8, 7, 6, ...), not only when food
    // crosses it (soak 14 saw 3 low lines while food went to 1 twice). Above eatAt the level count starts again.
    // #612 review 9 (the lead): an eat (food up) starts the level count again, so the next drop at or below eatAt logs.
    if (bot.food > eatAt || (Number.isFinite(state.lastFood) && bot.food > state.lastFood)) state.lowLevel = null;
    const fell = Number.isFinite(state.lastFood) && bot.food < state.lastFood && bot.food <= eatAt
        && (state.lowLevel == null || bot.food < state.lowLevel);
    state.lastFood = bot.food;
    let reason = null;
    if (fell && now - (state.lowAt ?? -Infinity) >= FOOD_LOG_MS) { reason = 'low'; state.lowAt = now; state.lowLevel = bot.food; }
    else if (now - (state.checkAt ?? -Infinity) >= FOOD_LOG_MS) reason = 'check';
    if (!reason) return null;
    state.checkAt = now; // a low line counts as this minute's check
    const text = foodLine(bot.food, bot.health, reason);
    console.log(text);
    return text;
}

/** Wire the food and hurt lines to the bot: every physics tick and health update checks them (cheap; rate-limited); every arm swing is noted for the hurt source. */
export function bindSurvivalLog(bot, { eatAt }) {
    const state = { swings: new Map() };
    const check = () => { try { foodCheck(state, bot, Date.now(), eatAt); } catch { /* never breaks the bot */ } };
    bot.on('entitySwingArm', (e) => { try { noteSwing(state.swings, e); } catch { /* never breaks the bot */ } });
    // #594 nit 1, #597 review 1: the respawn packet starts the old-arrows window; 'spawn' only as a fallback.
    // #597 nit: bindSurvivalLog binds after the first spawn (agent.js), so the first join's arrows reached no
    // listener; the login listener only covers a later re-login on the same bot object.
    bot.on('respawn', () => { try { noteBotSpawn(state); } catch { /* never breaks the bot */ } });
    bot.on('login', () => { try { noteBotSpawn(state); } catch { /* never breaks the bot */ } });
    bot.on('spawn', () => { try { noteBotSpawn(state, Date.now(), { fallback: true }); } catch { /* never breaks the bot */ } });
    bot.on('entitySpawn', (e) => { try { noteArrowSpawn(state, e); noteSpawn(state, e); } catch { /* never breaks the bot */ } }); // soak 12 (G); soak 16 death 2
    bot.on('entityGone', (e) => { try { noteArrowGone(state, bot, e); } catch { /* never breaks the bot */ } });
    bot.on('health', () => { try { hurtCheck(state, bot, Date.now()); } catch { /* never breaks the bot */ } });
    // Soak 14 (F3, the lead): every target of the bot's own attack is provoked for its chase (markProvoked).
    // defendSelf wraps bot.attack for a fight and restores what it found, so this wrapper stays underneath.
    if (typeof bot.attack === 'function' && !bot.attack.rotnMarks) {
        const attack = bot.attack;
        // #612 review 4: marked only when the attack was sent (vanilla: at once; Better Combat: its result says).
        const marking = function (target, ...rest) {
            const r = attack.call(this ?? bot, target, ...rest);
            const mark = (v) => { try { if (attackSent(v)) markProvoked(target); } catch { /* never breaks the bot */ } };
            if (r && typeof r.then === 'function') r.then(mark, () => {}); else mark(r);
            return r;
        };
        marking.rotnMarks = true;
        bot.attack = marking;
    }
    bot.on('health', check);
    bot.on('physicsTick', check);
    return state;
}
