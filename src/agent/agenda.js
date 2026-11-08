// The autonomous agenda (skills-rotn E2; PLAN priority stack level 4).
//
// A RotN progression plan as data: each step has a goal for the self-prompter
// (in the bot's own commands) and a done check over the bot's state that needs
// no LLM. The current step is the first one not done; a step once done stays
// done (crafting uses items up), and a stone pickaxe means the steps before it
// are behind the bot. After a restart it picks up from the file and the world. The LLM is called only by the self-prompter, at its decision
// points; the agenda itself never calls it.
//
// Progress (active or not, when each step was first done, each step's LLM budget
// spent, a stuck step) is kept in
// ./bots/<name>/agenda.json, written atomically; a corrupt file is moved aside.
//
// Chat lines for harness-ops (the runner parses them from the server log):
//   agenda step <id> started: <short>
//   agenda step <id> done
//   agenda steps done: <id>, <id>, ...   (two or more done in the same tick, one line: G3 round 4
//                                        C+D, 12 lines in one second got the bot kicked for spam)
//   agenda step <id> stuck: <why>   (its LLM budget is spent; the agenda pauses)
//   agenda done
// (E3 adds "agenda paused for task <id>" and "agenda resumed: <id>".)
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SHELTER_LEAD_MIN, dirtPileRecipes } from './library/night.js';
import { foodShortfall, FOOD_TARGET } from './library/food.js';

/**
 * RotN's first day, docs/research/rotn-progression.md section 3, steps 1-9. A rock is any
 * member of the rock ore dictionary (collectBlock and craftNeeds follow rotn-data).
 * done(s): s.count(name) counts the bot's items (a bare name: every variant; "pyrotech:rock":
 * every rock); s.countOre(ore) counts every member of a rotn-data ore ("logWood", "plankWood":
 * modded RotN trees too, #164 review); s.near(block) finds a placed block within 16.
 */
export const ROTN_EARLY_GAME = [
    {
        id: 'rocks', short: 'collect 6 rocks',
        goal: 'Collect at least 6 rocks with !collectBlocks("pyrotech:rock", 6). Rock piles lie on the ground near spawn; break them by hand.',
        done: (s) => s.count('pyrotech:rock') >= 6 || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'sticks', short: 'collect 3 sticks',
        // G3 round 4 B: a felled tree drops sticks (0-7 with its logs), and a trunk broken by hand
        // fells it too. (rotn-data Request 13 said leaves never drop sticks; rotn-data #312 corrected
        // it: Pyrotech adds a stick half the time when a player breaks leaves. Request 17.) collectBlock fells
        // it safely (fellTree) and picks the sticks up with the logs.
        // G3 round 5 A rerun: 3 felled spruces gave 25 logs and 1 stick, and planks need a table
        // (every log -> planks recipe is a 1x3 column; rotn-data). Before the table the bot needs
        // 3 ore:stickWood (2 for the crude axe, 1 for Crafting Tools), and River Cane
        // (biomesoplenty:plant_1:5) and BOP bamboo are stickWood too, picked by hand (rotn-data).
        // G3 round 8 A: two felled spruces gave 0 sticks while a dead bush stood near; broken by hand
        // it gave a stick. collectBlock now breaks dead bushes first, and tries other tree species
        // after one gave none.
        goal: 'Get at least 3 sticks: 2 for the crude axe and 1 for the Crafting Tools. !collectBlocks("stick", 3) first breaks dead bushes nearby by hand (0-2 sticks each), then leaves you can reach from the ground (a stick half the time; it never climbs for them), then fells trees (breaking a trunk, even by hand), trying another kind of tree after one gave no sticks; a felled tree drops few sticks, often none. River Cane (tall cane by rivers) and bamboo work as sticks in both recipes and break by hand: !collectBlocks("biomesoplenty:plant_1:5", 3) or !collectBlocks("biomesoplenty:bamboo", 3). Planks from ordinary logs need a crafting table here, so they come later.',
        done: (s) => s.countOre('stickWood') >= 3 || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'crude_axe', short: 'craft a crude axe',
        goal: 'Craft a crude axe with !craftRecipe("pyrotech:crude_axe", 1): 1 rock and 2 sticks (River Cane or bamboo work too), in your inventory grid. It breaks after about 8 uses: keep 2 uses for your first plank.',
        done: (s) => s.count('pyrotech:crude_axe') > 0 || s.count('stone_axe') > 0 || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'logs', short: 'collect 3 logs',
        goal: 'Fell a tree with the crude axe and collect at least 3 logs with !collectBlocks("log", 3). Stand to the side: trees fall the way you chop.',
        done: (s) => s.countOre('logWood') >= 3 || s.count('crafting_table') > 0 || s.near('crafting_table') || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'first_plank', short: 'make the first plank',
        goal: 'Make your first plank: place a log, use the crude axe on it to debark it, then use the axe on the debarked log for a plank.',
        done: (s) => s.countOre('plankWood') > 0 || s.count('crafting_table') > 0 || s.near('crafting_table') || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'crafting_tools', short: 'craft Crafting Tools',
        // The lead's Hit With Axe decision (round 5 A rerun): with no stick left and no table yet,
        // collectBlock makes sticks by using the crude axe on a placed log and plank (sticksByAxe).
        goal: 'Craft Crafting Tools with !craftRecipe("contenttweaker:crafting_tools", 1): the crude axe (it is used up), 1 rock and 1 stick (or River Cane or bamboo). Make your first plank before this. With no stick left, !collectBlocks("stick", 1) chops a placed log and plank with the crude axe for 2 sticks (about 5 uses) and keeps a plank for the table.',
        done: (s) => s.count('contenttweaker:crafting_tools') > 0 || s.count('crafting_table') > 0 || s.near('crafting_table') || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'crafting_table', short: 'craft a crafting table',
        goal: 'Craft a crafting table with !craftRecipe("crafting_table", 1): 1 plank and the Crafting Tools.',
        done: (s) => s.count('crafting_table') > 0 || s.near('crafting_table') || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'planks_sticks', short: 'make planks and sticks at the table',
        goal: 'At the crafting table, turn logs into planks with !craftRecipe("planks", 2) and planks into sticks with !craftRecipe("stick", 1), until you have at least 4 planks and 4 sticks.',
        done: (s) => (s.countOre('plankWood') >= 4 && s.count('stick') >= 4) || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'stone_pickaxe', short: 'craft a stone pickaxe',
        goal: 'Craft a stone pickaxe at the crafting table with !craftRecipe("stone_pickaxe", 1): 3 rocks and 2 sticks.',
        done: (s) => s.count('stone_pickaxe') > 0,
    },
    {
        id: 'stone_axe', short: 'craft a stone axe',
        goal: 'Craft a stone axe at the crafting table with !craftRecipe("stone_axe", 1): 3 rocks and 2 sticks. Chop with it from now on.',
        done: (s) => s.count('stone_axe') > 0,
    },
    {
        id: 'cobblestone', short: 'make cobblestone from rocks',
        goal: 'Mine stone with the stone pickaxe for rocks (!collectBlocks("pyrotech:rock", 8)), then make cobblestone from 4 rocks of one kind with !craftRecipe("cobblestone", 1): each rock kind makes its own cobblestone. Aim for 10 cobblestone: at dusk the night routine builds the shelter from them (10 on open ground), so do not use them by day.',
        // G3 round 3 A: name the cobblestone the rocks the bot holds make (rotn-data rock recipes).
        goalNow: (s) => {
            const c = s.cobble?.()[0];
            if (!c) return null;
            // The real number (#234 nit): what the rocks make, at most what the step still needs.
            const n = Math.min(Math.floor(c.have / 4), Math.max(1, 10 - s.countOre('cobblestone')));
            return `Your ${c.rock} rocks make ${c.gives}, 4 rocks each: craft it with !craftRecipe("cobblestone", ${n}). `
                + 'Mine more rocks with !collectBlocks("pyrotech:rock", 8) when you run short. Aim for 10 cobblestone: at dusk the night routine builds the shelter from them (10 on open ground), so do not use them by day.';
        },
        // D2b-2: the open-ground shelter's 10 blocks. Any cobblestone of the ore counts (G3 round 2 B:
        // 10 undergroundbiomes:metamorphic_cobble held never finished the step).
        done: (s) => s.countOre('cobblestone') >= 10,
    },
];

/** Sturdy blocks kept for the night's shelter (10 on open ground: 8 walls, a roof and its prop). */
export const SHELTER_RESERVE = 10;
/**
 * The reserve is due this many minutes of running time before sunset (the night routine starts at
 * SHELTER_LEAD_MIN). With the measured cycle (night.js) only about 8 min run between the morning
 * freeze (3001) and sunset, and minutesToSunset does not count a freeze the time is already in:
 * so the reserve is due from the morning freeze on, about 12 min before the night routine.
 */
export const RESERVE_LEAD_MIN = SHELTER_LEAD_MIN + 4;

/**
 * G3 round 6 B (the lead): before dusk the agenda keeps at least 9 sturdy blocks for the shelter.
 * Not a step of the list: it is judged anew every day, comes before the current step while the
 * night is near and the bot holds too few, and runs after "agenda done" too. s.minutesToSunset()
 * and s.shelterBlocks() (every cobblestone and stone of the pack, night.js isSturdy) come from the
 * driver; a state without them never makes it due.
 */
// #284 review 2 (lead decision): with no pickaxe held, a shelter must be one the bot can dig out of
// by hand, and the reserve never sends the bot on a rock run before the pickaxe step. With a
// pickaxe, it asks for sturdy blocks. #284 review 3: with no pickaxe the shelter places only dirt
// (shelter.js), so only placeable dirt counts then (held, or what its dirt piles make): 10
// cobblestone and no dirt is not a reserve.
const noPickaxe = (s) => s.hasPickaxe?.() === false;
/**
 * The pile that dirt dug by hand drops, and how many make one dirt (rotn-data #288 and its recipe:
 * betterwithmods:dirt_pile, 4). Dug by hand, or with a shovel below level 1, dirt drops 4 piles.
 */
export function dirtPile(recipes = dirtPileRecipes) {
    let r = null;
    try { r = recipes().find(x => x.gives?.name === 'minecraft:dirt') ?? null; } catch { r = null; }
    if (!r) return { name: 'betterwithmods:dirt_pile', per: 4 };
    // The recipe's own variant (#291 nit): a pile with a meta other than 0 is asked for by it.
    const name = r.name.replace(/^minecraft:/, '');
    return { name: r.meta ? `${name}:${r.meta}` : name, per: r.per };
}
/** The no-pickaxe ask: piles for `blocks` dirt blocks (each dirt block dug by hand gives `per` piles). */
const pileAsk = (blocks) => {
    const p = dirtPile();
    return `Dig dirt or grass by hand with !collectBlocks("${p.name}", ${p.per * blocks}): dug by hand (or with a shovel below level 1) it drops ${p.per} piles of dirt, not a dirt block, and ${p.per} piles make one dirt, which the shelter crafts itself. Do not use a flint, bone or iron shovel for it: those get the dirt block instead.`;
};
/** What the reserve needs now: dirt without a pickaxe, sturdy blocks with one. */
const reserveNeed = (s) => (noPickaxe(s) ? 'dirt' : 'sturdy');
const reserveHave = (s) => (noPickaxe(s) ? (s.dirtBlocks?.() ?? 0) : (s.shelterBlocks?.() ?? 0));

export const SHELTER_RESERVE_STEP = {
    id: 'shelter_blocks', short: `keep ${SHELTER_RESERVE} blocks for the night's shelter`,
    reserve: true,
    // Not at night (minutesToSunset is 0 from sunset to sunrise; #284 review 1): the night routine
    // shelters then, and nothing may send the bot out for blocks in the dark.
    due: (s) => { const m = s.minutesToSunset?.() ?? Infinity; return m > 0 && m <= RESERVE_LEAD_MIN; },
    done: (s) => reserveHave(s) >= SHELTER_RESERVE,
    // Only when goalNow fails: both cases, as goalNow tells them apart.
    goal: `Night is near. At dusk the night routine builds a shelter of ${SHELTER_RESERVE} blocks on open ground. If you have a pickaxe, it is built from sturdy blocks (any cobblestone or stone): make cobblestone from 4 rocks of one kind with !craftRecipe("cobblestone", 1), and mine stone with the pickaxe for more rocks. If you have no pickaxe, it is built of dirt only, which you can dig out of by hand: dig dirt or grass by hand with !collectBlocks("betterwithmods:dirt_pile", ${4 * SHELTER_RESERVE}) (4 piles make one dirt, which the shelter crafts itself). Keep these blocks for the night: do not place them.`,
    goalNow: (s) => {
        const have = reserveHave(s);
        // CX23 soak: what the bot is told counts the morning freeze still to run (sunsetEstimateMin);
        // the due rule above keeps the least certain time.
        const mins = Math.max(1, Math.round((s.sunsetEstimateMin?.() ?? s.minutesToSunset?.() ?? 0) - SHELTER_LEAD_MIN));
        if (noPickaxe(s)) {
            return `Night is near: in about ${mins} min the night routine builds a shelter. You have no pickaxe yet, so it is built of dirt, which you can dig out of by hand in the morning. `
                + `It needs ${SHELTER_RESERVE} blocks on open ground, and you have ${have} (dirt, and dirt from your dirt piles). `
                + `${pileAsk(SHELTER_RESERVE - have)} `
                + 'Keep these blocks for the night: do not place them.';
        }
        const head = `Night is near: in about ${mins} min the night routine builds a shelter from sturdy blocks (any cobblestone or stone). It needs ${SHELTER_RESERVE} on open ground, and you have ${have}. `;
        const c = s.cobble?.()[0];
        const how = c
            ? `Your ${c.rock} rocks make ${c.gives}, 4 rocks each: craft it with !craftRecipe("cobblestone", ${Math.min(Math.floor(c.have / 4), SHELTER_RESERVE - have)}). `
            : 'Collect rocks with !collectBlocks("pyrotech:rock", 8) (rock piles break by hand; stone mined with a stone pickaxe gives rocks), then make cobblestone from 4 rocks of one kind with !craftRecipe("cobblestone", 1). ';
        return head + how + 'Keep these blocks for the night: do not place them.';
    },
};

/** After the food reserve's budget is spent, it is not asked again for this long (G4 #5). */
export const FOOD_RETRY_MS = 10 * 60_000;
/**
 * #422 review 8: at most this many self-prompter runs for the food reserve per in-game day (by
 * bot.time.day; a 20-min window when unknown), so its LLM spend stays well inside ADR 0010's
 * USD 0.05/h (the soak measured 0.0116/h in all). Counted in memory: a restart starts afresh.
 */
export const FOOD_DAY_RUNS = 3;
const dayKeyOf = (s, now) => { const d = s.day?.(); return Number.isFinite(d) ? `day ${d}` : `t ${Math.floor(now / (20 * 60_000))}`; };
/** The food reserve's shortfall now (food.foodShortfall with the shelter reserve's window), or null. */
const foodShort = (s, ctx = {}) => foodShortfall({ food: s.food?.(), held: s.foodHeld?.() ?? 0,
    minutesToSunset: s.minutesToSunset?.() ?? Infinity, finished: !!ctx.finished, reserveLeadMin: RESERVE_LEAD_MIN });

/**
 * G4 #5 (CX23 soak m1: food fell to 1; after the deaths nothing to eat, and once the agenda was
 * done nothing got food). Like the shelter reserve, not a step of the list: judged anew every tick,
 * after the shelter reserve and before the current step, also after "agenda done" (a standing
 * duty), with its own budget. Due by food.foodShortfall: before night FOOD_TARGET.night held; once
 * the agenda is done FOOD_TARGET.day; and at once when food is 12 or lower with none held. Never at
 * night: the bot stays sealed. Hunting only wild animals (the !attack guard and the hunting reflex,
 * library/hunting.js). Ripe wild food first (lead, after rotn-data #423): !forage picks wildberry
 * bushes and breaks ripe herbs and gardens (library/foraging.js), then hunting.
 */
export const FOOD_RESERVE_STEP = {
    id: 'food', short: 'keep food for the day and the night', reserve: true, when: 'food',
    due: (s, ctx) => foodShort(s, ctx) !== null,
    done: () => false, // done when no longer due (enough held)
    goal: `Food: on this pack hunger falls about 1 every 4 minutes, even resting, and starving kills. Keep food worth at least ${FOOD_TARGET.night} hunger before night. Gather ripe wild food first with !forage (wildberry bushes, wild herbs, HarvestCraft gardens), else kill a wild cow, pig, sheep or rabbit near you with !attack("<its name>") and pick up the meat (raw meat gives 1 hunger; eat it raw if needed). Never an animal with a name tag, on a leash, tamed, or near fences, farms or houses: it may belong to a player. Do not eat raw chicken or rotten flesh; keep the bread for last.`,
    goalNow: (s, ctx) => {
        const target = foodShort(s, ctx) ?? FOOD_TARGET.day;
        const held = s.foodHeld?.() ?? 0;
        const food = s.food?.();
        const animals = s.huntable?.() ?? [];
        const crops = s.forageable?.() ?? [];
        // Ripe wild food first: quicker and safer than a hunt (lead, after rotn-data #423).
        const wild = crops.length
            ? `Ripe wild food near you: ${crops.slice(0, 3).join(', ')}: gather it first with !forage (it picks berry bushes and breaks ripe herbs and gardens, never a player's). `
            : '';
        const near = animals.length
            ? `Near you: ${animals.slice(0, 3).join(', ')}: kill one with !attack("${animals[0]}") and pick up what it drops. `
            : crops.length ? 'No wild animal is near. ' : 'No ripe wild food and no wild animal is near: try !forage once you see berry bushes, herbs or HarvestCraft gardens; or look for an animal (cows, pigs, sheep, rabbits; on this pack mostly Animania ones such as animania:cow_holstein or animania:sow_old_spot) with !searchForEntity, away from fences and houses, then !attack it. ';
        return `Food: you hold food worth ${held} hunger${Number.isFinite(food) ? ` and your food is ${food} of 20` : ''}. On this pack hunger falls about 1 every 4 minutes, even resting, and starving kills: get to at least ${target}. `
            + wild + near + 'Raw meat gives 1 hunger each; eat it raw if needed. Never an animal with a name tag, on a leash, tamed, or near fences, farms or houses: it may belong to a player (the bot refuses those). '
            + 'Do not eat raw chicken or rotten flesh; keep the bread for last.';
    },
};

export class Agenda {
    /**
     * @param {string} botName
     * @param {{dir?: string, steps?: Array, now?: () => number, reserve?: object|null}} [opts]
     *   reserve: the before-night step (SHELTER_RESERVE_STEP; null for none)
     */
    constructor(botName, { dir = `./bots/${botName}`, steps = ROTN_EARLY_GAME, now = Date.now, reserve = SHELTER_RESERVE_STEP, food = FOOD_RESERVE_STEP } = {}) {
        this.file = path.join(dir, 'agenda.json');
        this.steps = steps;
        this.now = now;
        this.reserve = reserve;
        this.food = food; // G4 #5: the food reserve (FOOD_RESERVE_STEP; null for none)
        this.foodOffUntil = 0; // its budget ran out: not asked again before this time
        this.foodDay = { key: null, runs: 0 }; // its runs this in-game day (FOOD_DAY_RUNS)
        this.reserveOff = false; // its budget ran out: not again until the night is past
        this.finished = false; // "agenda done": only the reserve runs
        this.active = false;
        this.done_at = {}; // step id -> when it was first seen done
        this.spent = {}; // step id -> {attempts, llm_ms}: the self-prompter's runs for it (#164 review)
        this.stuck = null; // {id, why, at}: a step whose budget ran out; the agenda is paused
        this.loadProblem = null;
        this.existed = false; // a readable agenda.json was there: autostart leaves it alone
        this.loadedActive = false; // agenda.json said active: the first step it names says "resumed after a restart" (G4 #11 prep)
        this.load();
    }

    load() {
        this.loadState = 'absent'; // G4 #10: 'absent' | 'corrupt' | 'present' (state_report.js)
        if (!existsSync(this.file)) return;
        try {
            const data = JSON.parse(readFileSync(this.file, 'utf8'));
            if (!data || typeof data !== 'object' || typeof data.active !== 'boolean') throw new Error('no agenda state');
            this.active = data.active;
            this.loadedActive = data.active;
            this.done_at = data.done_at && typeof data.done_at === 'object' ? data.done_at : {};
            this.spent = data.spent && typeof data.spent === 'object' ? data.spent : {};
            this.stuck = data.stuck && typeof data.stuck.id === 'string' ? data.stuck : null;
            this.finished = data.finished === true;
            this.existed = true;
            this.loadState = 'present';
        } catch (err) {
            this.loadState = 'corrupt';
            const aside = `${this.file}.corrupt-${this.now()}`;
            try { renameSync(this.file, aside); } catch { /* left in place */ }
            this.loadProblem = `[agenda] ${this.file} could not be read (${err.message}); moved it to ${aside}. The agenda starts fresh (its steps are judged from the world, so little is lost).`;
            console.warn(this.loadProblem);
        }
    }

    save() {
        try {
            mkdirSync(path.dirname(this.file), { recursive: true });
            const tmp = `${this.file}.tmp`;
            writeFileSync(tmp, JSON.stringify({ version: 1, active: this.active, finished: this.finished, done_at: this.done_at, spent: this.spent, stuck: this.stuck, updated_at: this.now() }, null, 2));
            renameSync(tmp, this.file);
            this.existed = true; // a later spawn (a respawn) must not autostart it either
        } catch (err) {
            console.warn(`[agenda] Could not save ${this.file} (${err.message}).`);
        }
    }

    /** Start or resume. A giver's start after a stuck step gives that step a fresh budget. */
    start() {
        if (this.active && !this.stuck) return;
        // A (re)start in this process is a fresh start, not the restart's resume (#327 review 1):
        // e.g. !agendaStop then !agendaStart before the first step line.
        this.loadedActive = false;
        if (this.stuck) { delete this.spent[this.stuck.id]; this.stuck = null; }
        this.active = true;
        this.finished = false;
        this.save();
    }
    stop() { if (this.active || this.finished) { this.active = false; this.finished = false; this.save(); } }
    /** All steps done: not active, but the before-night reserve still runs (G3 round 6 B). */
    finish() { this.active = false; this.finished = !!this.reserve || !!this.food; this.save(); }

    /** Whether a step id is one of the reserves (the shelter blocks, the food). */
    isReserveId(id) { return id != null && (id === this.reserve?.id || id === this.food?.id); }
    /** A reserve, if one is wanted now: the shelter reserve first, then food (G4 #5). */
    anyReserveWanted(state) { return this.reserveWanted(state) ?? this.foodWanted(state); }
    /** A reserve's budget is spent: the shelter reserve until the night is past; food for FOOD_RETRY_MS. */
    reserveStuck(id) {
        if (id === this.food?.id) this.foodOffUntil = this.now() + FOOD_RETRY_MS;
        else this.reserveOff = true;
    }

    /**
     * G4 #5: the food reserve when it is wanted now (due by food.foodShortfall, its budget not spent
     * or FOOD_RETRY_MS past, and a run left this day or one running), else null. When it is not due, its budget is fresh for the next time.
     */
    foodWanted(state) {
        const r = this.food;
        if (!r) return null;
        let due = false;
        try { due = !!r.due(state, { finished: this.finished }); } catch { due = false; }
        if (!due) {
            delete this.spent[r.id];
            this.foodOffUntil = 0;
            return null;
        }
        if (this.now() < this.foodOffUntil) return null;
        if (this.foodOffUntil) { delete this.spent[r.id]; this.foodOffUntil = 0; } // a fresh budget after the wait
        const key = dayKeyOf(state, this.now());
        if (this.foodDay.key !== key) this.foodDay = { key, runs: 0 };
        // This day's runs are used: no new run (the hunting and foraging reflexes still act). The cap
        // is for starting one: a run counted as it started finishes (#422 nit: the 3rd run was
        // stopped about 2 s later by the "agenda done" branch). state.foodRunning: the driver's.
        if (this.foodDay.runs >= FOOD_DAY_RUNS && !state.foodRunning?.()) return null;
        return r;
    }

    /**
     * The before-night reserve step when it is wanted now (due, too few blocks, budget not spent),
     * else null. Once the night is no longer near, its budget is fresh again for the next dusk.
     * When a pickaxe comes or goes, the reserve needs other blocks (dirt or sturdy blocks): the
     * first such change in a dusk gives it a fresh budget, a later one does not (G3 round 10 A:
     * 4 min went on dirt, the stone pickaxe then asked for cobblestone, and 1 min was left).
     */
    reserveWanted(state) {
        const r = this.reserve;
        if (!r) return null;
        let due = false;
        try { due = !!r.due(state); } catch { due = false; }
        if (!due) {
            this.reserveOff = false;
            delete this.spent[r.id];
            return null;
        }
        const need = reserveNeed(state);
        const b = this.spent[r.id];
        if (b && b.need === undefined) b.need = need; // the need its budget was first spent on
        else if (b && b.need !== need) {
            if (b.refreshed) b.need = need;
            else {
                this.spent[r.id] = { attempts: 0, llm_ms: 0, need, refreshed: true };
                this.reserveOff = false;
            }
        }
        if (this.reserveOff) return null;
        let done = false;
        try { done = !!r.done(state); } catch { done = false; }
        return done ? null : r;
    }

    /** The self-prompter's budget spent on a step so far. */
    spentOn(id) { return this.spent[id] ?? { attempts: 0, llm_ms: 0 }; }
    /** One more self-prompter run for a step (saved: a crash loop cannot reset it). */
    recordAttempt(id) {
        if (id === this.food?.id) this.foodDay.runs++; // #422 review 8: the food reserve's runs per day
        const b = this.spentOn(id);
        this.spent[id] = { ...b, attempts: b.attempts + 1 }; // keeps the reserve's need and refresh
        this.save();
    }
    /** Time the self-prompter (the LLM) ran for a step; saved by the caller now and then. */
    addLlmTime(id, ms) {
        const b = this.spentOn(id);
        this.spent[id] = { ...b, llm_ms: b.llm_ms + ms };
    }
    /** A step's budget is spent: pause the agenda until a giver starts it again. */
    markStuck(id, why) {
        this.stuck = { id, why, at: this.now() };
        this.active = false;
        this.save();
    }

    /**
     * Judge the steps against the bot's state.
     * @returns {{step: object|null, newlyDone: object[]}} step: the first step not done (null: all done)
     */
    evaluate(state) {
        const { step, newlyDone } = this.judge(state);
        for (const s of newlyDone) this.done_at[s.id] = this.now();
        if (newlyDone.length) this.save();
        return { step, newlyDone };
    }

    /**
     * The same judgement without recording anything (for !agenda, #164 review: the driver
     * alone records a step done, so its "agenda step <id> done" line is never swallowed).
     */
    judge(state) {
        const newlyDone = [];
        let step = null;
        for (const s of this.steps) {
            // A step once done stays done: crafting the crude axe uses up sticks, and walking away
            // from the table must not send the agenda back. Steps not yet done are judged from the world.
            let done = !!this.done_at[s.id];
            if (!done) {
                try { done = !!s.done(state); } catch { done = false; }
            }
            if (done) {
                if (!this.done_at[s.id]) newlyDone.push(s);
            } else if (!step) {
                step = s;
            }
        }
        // Before night, too few shelter blocks: the reserve comes first (G3 round 6 B); then food (G4 #5).
        return { step: this.reserveWanted(state) ?? this.foodWanted(state) ?? step, newlyDone };
    }
}

/** The agenda as lines for !agenda: "agenda: active, step <id> (<short>); done: a, b". */
export function describeAgenda(agenda, current, newlyDone = []) {
    // newlyDone: steps judge() found done that the driver has not recorded yet.
    const done = agenda.steps.filter(s => agenda.done_at[s.id] || newlyDone.includes(s)).map(s => s.id);
    const state = agenda.stuck ? `paused (step ${agenda.stuck.id} stuck: ${agenda.stuck.why}; a giver's !agendaStart retries it)`
        : agenda.active ? 'active' : agenda.finished ? 'done (before night it still keeps the shelter blocks)' : 'stopped';
    const now = current ? `step ${current.id} (${current.short})` : 'all steps done';
    return `agenda: ${state}, ${now}; done: ${done.length ? done.join(', ') : 'none'}`;
}
