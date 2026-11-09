// G4 #5 (test/scenarios/g4/PLAN.md: the soak counts eating, fights, fleeing and the food level
// from the bot's journal). One stable, greppable line per event, all starting "[survival] ":
//
//   [survival] ate <item> food <before>-><after>
//   [survival] fight start <mob> (<where>)              where: open | shelter
//   [survival] fight end <mob> <outcome> after <secs> s  outcome: killed | gone | stopped | capped | interrupted | died
//   [survival] flee <mob> (<why>)
//   [survival] food <food> health <health> (<reason>)    reason: check (at most once a minute) | low (fell to food.EAT_AT, 12, or below; at most once a minute)
//   [survival] hurt <amount> health <before>-><after> (by <source>)   soak 2: health fell by HURT.minDrop or more within HURT.windowMs
//
// Soak 2 (rotn-v0.1.4): the server sends no death messages, and two deaths had no cause in the
// journal. The hurt line names the likely source: 'starving' (food 0: Hunger Overhaul's
// damageOnStarve=200 kills at once), the nearest mob within HURT.mobRange (its entity type), 'fall'
// when the bot was falling, else 'unknown'.
//
// Tokens never hold spaces: <item> is food.foodKey, "<registry name>:<meta>" ("minecraft:bread:0",
// "rustic:wildberries:0"), from the eating reflex and the consume skill alike; <mob> the
// entity type ("zombie", "zombie_players:zombie_player"; a player is "player", never a name), so no
// custom name, username or server text reaches the journal. The console only: chat is unchanged.

// No import of food.js (it imports this file): the eat threshold is passed in (bindSurvivalLog).

export const SURVIVAL_TAG = '[survival]';
/** The food line's period, and the least time between two "low" lines (G4: no periodic line more than once a minute). */
export const FOOD_LOG_MS = 60_000;
/** After an eat, how long the bot's food level may take to change (the server's update_health). */
export const FOOD_UPDATE_MS = 500;
export const FIGHT_OUTCOMES = ['killed', 'gone', 'stopped', 'capped', 'interrupted', 'died'];

const token = (s) => String(s ?? 'unknown').replace(/[^\w:.-]/g, '_') || 'unknown';
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
export const hurtLine = (amount, before, after, source) => `${SURVIVAL_TAG} hurt ${num(amount)} health ${num(before)}->${num(after)} (by ${token(source)})`;
export const HURT = { minDrop: 4, windowMs: 2000, mobRange: 5 };

/** The likely source of the damage just taken (see the header): 'starving', a mob type, 'fall' or 'unknown'. */
export function hurtSource(bot) {
    if (Number.isFinite(bot?.food) && bot.food <= 0) return 'starving';
    const here = bot?.entity?.position;
    if (here) {
        const near = Object.values(bot.entities ?? {})
            .filter(e => e && e !== bot.entity && e.position && e.type !== 'object' && e.name !== 'item' && e.position.distanceTo(here) <= HURT.mobRange)
            .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))[0];
        if (near) return mobName(near);
    }
    if ((bot?.entity?.velocity?.y ?? 0) < -0.5) return 'fall';
    return 'unknown';
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
    let w = state.hurt;
    if (!w || h > w.from) { state.hurt = { from: h, at: now }; return null; }
    if (now - w.at > HURT.windowMs) w = state.hurt = { from: last, at: now };
    if (w.from - h < HURT.minDrop) return null;
    const text = hurtLine(w.from - h, w.from, h, hurtSource(bot));
    state.hurt = { from: h, at: now };
    console.log(text);
    return text;
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
    let first = null, startedAt = null, ended = false;
    return {
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
 * The food line: once every FOOD_LOG_MS while alive ("check"), and when the food level falls to
 * eatAt (food.EAT_AT) or below from above it ("low", at most once per FOOD_LOG_MS). Call it as often as wanted.
 */
export function foodCheck(state, bot, now = Date.now(), eatAt = 12) {
    if (!Number.isFinite(bot?.food) || botDead(bot)) return null;
    const fell = Number.isFinite(state.lastFood) && state.lastFood > eatAt && bot.food <= eatAt;
    state.lastFood = bot.food;
    let reason = null;
    if (fell && now - (state.lowAt ?? -Infinity) >= FOOD_LOG_MS) { reason = 'low'; state.lowAt = now; }
    else if (now - (state.checkAt ?? -Infinity) >= FOOD_LOG_MS) reason = 'check';
    if (!reason) return null;
    state.checkAt = now; // a low line counts as this minute's check
    const text = foodLine(bot.food, bot.health, reason);
    console.log(text);
    return text;
}

/** Wire the food line to the bot: every physics tick and health update checks it (cheap; rate-limited). */
export function bindSurvivalLog(bot, { eatAt }) {
    const state = {};
    const check = () => { try { foodCheck(state, bot, Date.now(), eatAt); } catch { /* never breaks the bot */ } };
    bot.on('health', () => { try { hurtCheck(state, bot, Date.now()); } catch { /* never breaks the bot */ } });
    bot.on('health', check);
    bot.on('physicsTick', check);
    return state;
}
