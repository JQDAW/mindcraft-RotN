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
// spent, the stuck steps and their retries) is kept in
// ./bots/<name>/agenda.json, written atomically; a corrupt file is moved aside.
//
// Chat lines for harness-ops (the runner parses them from the server log):
//   agenda step <id> started: <short>
//   agenda step <id> done
//   agenda steps done: <id>, <id>, ...   (two or more done in the same tick, one line: G3 round 4
//                                        C+D, 12 lines in one second got the bot kicked for spam)
//   agenda step <id> stuck: <why>; retry <n> of 3 in 20 min or at the next full day; going on with the steps that do not need it
//   agenda step <id> stuck: <why>; its 3 retries are spent: one retry at each new full day; going on with the steps that do not need it
//   agenda step <id> retried (<n> of 3): a fresh budget      (#463 decision: the agenda never pauses on a stuck step)
//   agenda step <id> retried (<n>, at a new full day): a fresh budget
//   agenda open goal: step <id> waits; self-prompting on gathering for it (#468 review: nothing runnable)
//   agenda done
// (E3 adds "agenda paused for task <id>" and "agenda resumed: <id>".)
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SHELTER_LEAD_MIN, dirtPileRecipes, isFullDay } from './library/night.js';
import { foodShortfall, FOOD_TARGET, FOOD_SHORT_AT, EMERGENCY_FOOD, EAT_AT, EAT_NOW_AT, emergencyFoodText, NEVER_EAT_TEXT } from './library/food.js';
import { HUNT_MIN_FOOD } from './library/hunting.js';

/**
 * RotN's first day, docs/research/rotn-progression.md section 3, steps 1-9. A rock is any
 * member of the rock ore dictionary (collectBlock and craftNeeds follow rotn-data).
 * done(s): s.count(name) counts the bot's items (a bare name: every variant; "pyrotech:rock":
 * every rock); s.countOre(ore) counts every member of a rotn-data ore ("logWood", "plankWood":
 * modded RotN trees too, #164 review); s.near(block) finds a placed block within 16.
 * after: the steps whose items this one uses (#463 decision: while a step is stuck, the steps that
 * do not need it, directly or through others, go on).
 */
export const ROTN_EARLY_GAME = [
    {
        id: 'rocks', short: 'collect 6 rocks',
        after: [],
        goal: 'Collect at least 6 rocks with !collectBlocks("pyrotech:rock", 6). Rock piles lie on the ground near spawn; break them by hand.',
        done: (s) => s.count('pyrotech:rock') >= 6 || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'sticks', short: 'collect 3 sticks',
        after: [],
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
        after: ['rocks', 'sticks'],
        goal: 'Craft a crude axe with !craftRecipe("pyrotech:crude_axe", 1): 1 rock and 2 sticks (River Cane or bamboo work too), in your inventory grid. It breaks on its 9th block (each block costs 1 of its 8 durability; a hit on a mob costs 2, so it breaks on the 5th hit): keep 2 uses for your first plank.',
        done: (s) => s.count('pyrotech:crude_axe') > 0 || s.count('stone_axe') > 0 || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'logs', short: 'collect 3 logs',
        after: ['crude_axe'],
        goal: 'Fell a tree with the crude axe and collect at least 3 logs with !collectBlocks("log", 3). Stand to the side: trees fall the way you chop.',
        done: (s) => s.countOre('logWood') >= 3 || s.count('crafting_table') > 0 || s.near('crafting_table') || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'first_plank', short: 'make the first plank',
        after: ['logs'],
        goal: 'Make your first plank: place a log, use the crude axe on it to debark it, then use the axe on the debarked log for a plank.',
        done: (s) => s.countOre('plankWood') > 0 || s.count('crafting_table') > 0 || s.near('crafting_table') || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'crafting_tools', short: 'craft Crafting Tools',
        after: ['first_plank'],
        // The lead's Hit With Axe decision (round 5 A rerun): with no stick left and no table yet,
        // collectBlock makes sticks by using the crude axe on a placed log and plank (sticksByAxe).
        goal: 'Craft Crafting Tools with !craftRecipe("contenttweaker:crafting_tools", 1): the crude axe (it is used up), 1 rock and 1 stick (or River Cane or bamboo). Make your first plank before this. With no stick left, !collectBlocks("stick", 1) chops a placed log and plank with the crude axe for 2 sticks (about 5 uses) and keeps a plank for the table.',
        done: (s) => s.count('contenttweaker:crafting_tools') > 0 || s.count('crafting_table') > 0 || s.near('crafting_table') || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'crafting_table', short: 'craft a crafting table',
        after: ['crafting_tools'],
        goal: 'Craft a crafting table with !craftRecipe("crafting_table", 1): 1 plank and the Crafting Tools.',
        done: (s) => s.count('crafting_table') > 0 || s.near('crafting_table') || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'planks_sticks', short: 'make planks and sticks at the table',
        after: ['crafting_table'],
        goal: 'At the crafting table, turn logs into planks with !craftRecipe("planks", 2) and planks into sticks with !craftRecipe("stick", 1), until you have at least 4 planks and 4 sticks.',
        done: (s) => (s.countOre('plankWood') >= 4 && s.count('stick') >= 4) || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'stone_pickaxe', short: 'craft a stone pickaxe',
        after: ['planks_sticks', 'rocks'],
        goal: 'Craft a stone pickaxe at the crafting table with !craftRecipe("stone_pickaxe", 1): 3 rocks and 2 sticks.',
        done: (s) => s.count('stone_pickaxe') > 0,
    },
    {
        id: 'stone_axe', short: 'craft a stone axe',
        after: ['planks_sticks', 'rocks'],
        goal: 'Craft a stone axe at the crafting table with !craftRecipe("stone_axe", 1): 3 rocks and 2 sticks. Chop with it from now on.',
        done: (s) => s.count('stone_axe') > 0,
    },
    {
        id: 'cobblestone', short: 'make cobblestone from rocks',
        after: ['stone_pickaxe'],
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
 * Soak 10 (S1, the lead: 4): blocks kept over the shelter's for its repairs. The reserve held exactly
 * 10 dirt, the dusk build used them all, and the repair after a zombie dug a wall placed nothing.
 */
export const REPAIR_SPARE = 4;
/** What the shelter reserve holds: the shelter's blocks and the repair spare. */
export const SHELTER_HOLD = SHELTER_RESERVE + REPAIR_SPARE;
/**
 * The reserve is due this many minutes of running time before sunset (the night routine starts at
 * SHELTER_LEAD_MIN). With the measured cycle (night.js) only about 8 min run between the morning
 * freeze (3001) and sunset, and minutesToSunset does not count a freeze the time is already in:
 * so the reserve is due from the morning freeze on, about 12 min before the night routine.
 */
export const RESERVE_LEAD_MIN = SHELTER_LEAD_MIN + 4;
/** #630 re-review 3: the shelter blocks reserve is due from this many minutes before sunset (its job's two runs fit before 11). */
export const SHELTER_BLOCKS_LEAD_MIN = SHELTER_LEAD_MIN + 10;

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
    id: 'shelter_blocks', short: `keep ${SHELTER_HOLD} blocks for the night's shelter and its repairs`,
    reserve: true,
    // Soak 16 (R5, Fable S3, the lead): a scripted body (agenda_driver AUTO_JOBS.shelter_blocks: cobblestone from the
    // rocks held, then a bounded rock collect that stays out of holes, then cobblestone again); the model when it found
    // nothing in reach, or without a pickaxe (a dirt shelter). Not due between its runs.
    autoJob: 'shelter_blocks',
    // Not at night (minutesToSunset is 0 from sunset to sunrise; #284 review 1): the night routine
    // shelters then, and nothing may send the bot out for blocks in the dark.
    // #630 re-review 3 (the lead): due from SHELTER_BLOCKS_LEAD_MIN (16) before sunset, so its scripted job (a run must
    // start 11 min before sunset at the latest: dusk at 6, 4 min, 1 min margin) gets its runs before dusk. #630 delta
    // (the lead): on the pack's clock minutesToSunset never lies in 11-16 (about 18 before the morning freeze at 3001,
    // then 7.96: it counts none of the freeze): the window is read from sunsetEstimateMin, which counts the rest of the
    // freeze (18 at its start, 15 after 3 min, 10 after 8). Never at night (minutesToSunset 0).
    due: (s) => {
        const m = s.minutesToSunset?.() ?? Infinity;
        const est = s.sunsetEstimateMin?.() ?? m;
        return m > 0 && est <= SHELTER_BLOCKS_LEAD_MIN && !s.jobWaiting?.('shelter_blocks');
    },
    done: (s) => reserveHave(s) >= SHELTER_HOLD,
    // Only when goalNow fails: both cases, as goalNow tells them apart.
    goal: `Night is near. At dusk the night routine builds a shelter of ${SHELTER_RESERVE} blocks on open ground, and keeps ${REPAIR_SPARE} more to repair it when a zombie digs a wall open. If you have a pickaxe, it is built from sturdy blocks (any cobblestone or stone): make cobblestone from 4 rocks of one kind with !craftRecipe("cobblestone", 1); for more rocks, !collectBlocks("pyrotech:rock", 8) takes the loose rock piles on the ground within 48 blocks first, then stone open to the air that leaves you a walkable way out (never digging down into a hole). If you have no pickaxe, it is built of dirt only, which you can dig out of by hand: dig dirt or grass by hand with !collectBlocks("betterwithmods:dirt_pile", ${4 * SHELTER_HOLD}) (4 piles make one dirt, which the shelter crafts itself). Keep these blocks for the night: do not place them.`,
    goalNow: (s) => {
        const have = reserveHave(s);
        // CX23 soak: what the bot is told counts the morning freeze still to run (sunsetEstimateMin);
        // the due rule above keeps the least certain time.
        const mins = Math.max(1, Math.round((s.sunsetEstimateMin?.() ?? s.minutesToSunset?.() ?? 0) - SHELTER_LEAD_MIN));
        if (noPickaxe(s)) {
            return `Night is near: in about ${mins} min the night routine builds a shelter. You have no pickaxe yet, so it is built of dirt, which you can dig out of by hand in the morning. `
                + `It needs ${SHELTER_RESERVE} blocks on open ground and ${REPAIR_SPARE} more for repairs (${SHELTER_HOLD}), and you have ${have} (dirt, and dirt from your dirt piles). `
                + `${pileAsk(SHELTER_HOLD - have)} `
                + 'Keep these blocks for the night: do not place them.';
        }
        const head = `Night is near: in about ${mins} min the night routine builds a shelter from sturdy blocks (any cobblestone or stone). It needs ${SHELTER_RESERVE} on open ground and ${REPAIR_SPARE} more for repairs (${SHELTER_HOLD}), and you have ${have}. `;
        const c = s.cobble?.()[0];
        const how = c
            ? `Your ${c.rock} rocks make ${c.gives}, 4 rocks each: craft it with !craftRecipe("cobblestone", ${Math.min(Math.floor(c.have / 4), SHELTER_HOLD - have)}). `
            : 'Collect rocks with !collectBlocks("pyrotech:rock", 8): it takes the loose rock piles on the ground within 48 blocks first (they break by hand), then stone open to the air that leaves you a walkable way out, never digging down into a hole. Then make cobblestone from 4 rocks of one kind with !craftRecipe("cobblestone", 1). ';
        // Soak 16 (R5): the block job found nothing in reach here.
        const none = s.jobFoundNone?.('shelter_blocks')
            ? 'The block job found no loose rocks within 48 blocks and no stone open to the air with a way out here. Look for rock piles or bare stone elsewhere (a hillside, a riverbank), or gather dirt piles: the shelter uses dirt when it has too few sturdy blocks. '
            : '';
        return head + none + how + 'Keep these blocks for the night: do not place them.';
    },
};

/**
 * #463 decision (soak 3: stone_axe stuck at 20:12 paused the agenda, and the bot idled 67 min, food
 * 8 -> 2): an autonomous bot must not go idle. A stuck step (its budget spent) gets a fresh budget
 * after cooldownMs or at the next full day (a later in-game day, in full daylight), whichever comes
 * first, `max` times; after that (#468 review) one retry at each new full day, without limit: a step
 * is never given up and the agenda never finishes by giving up. Meanwhile the steps that do not need
 * it go on; with none left, food as a standing duty, else the open goal (openGoal: the model's own
 * goal, under its LLM budget, priority.js modelGoalTick).
 */
export const STUCK_RETRY = { cooldownMs: 20 * 60_000, max: 3 };
/**
 * Soak 4 (#478): after "agenda done" the self-prompter stopped and never started again. The lead's
 * standing goal: the model's own goal once the agenda is done and no reserve is wanted, under the
 * open goal's budget (priority.js OPEN_GOAL) with one window per in-game day (windowMs when the day
 * is unknown). exploreRadius: how far from the last shelter it is told to explore.
 */
export const STANDING = { exploreRadius: 64, windowMs: 20 * 60_000 };
/** The standing goal's start: not an autonomy prefix either (the model's own goal). */
export const STANDING_GOAL_PREFIX = 'Standing goal (the agenda is done): ';

/** The open goal's start: not an autonomy prefix (AUTONOMY_PREFIXES), so it counts as the model's own goal. */
export const OPEN_GOAL_PREFIX = 'Open goal while the agenda waits: ';

/**
 * Lead decision after soak 3 (rotn-v0.1.5): a weapon before night. After the first death the bot
 * never held a weapon again; bare hands did not hurt the zombies digging into its shelter, and
 * they hit for 6-8 (12 deaths). Like the shelter reserve: due in the same window before night,
 * after the shelter's blocks and before food, with its own budget (spent: not again until the night
 * is past). Done when the bot holds a weapon threats.hasWeapon counts (soak 10: with a kill's worth
 * of hits left; never the crude axe, a tool that breaks on its 5th hit).
 */
/**
 * Soak 5 (the lead's Fix H, which updates the soak 3 decision): after a death the bot went hunting
 * with no weapon and no food (~30 commands in 3 min, !attack on a sow bare-handed), and died to
 * zombies by day. With no weapon, the weapon reserve comes before the food reserve at any time of
 * day, unless food is WEAPON_FIRST.foodAtMost or lower (then food first).
 */
export const WEAPON_FIRST = { foodAtMost: 6 };
/** #500 follow-up 4: what the standing and open goals say about food while the bot holds no weapon. */
export const NO_WEAPON_FOOD = 'with no weapon: forage for food (!forage), do not hunt; make a weapon first';
const beforeNight = (s) => { const m = s.minutesToSunset?.() ?? Infinity; return m > 0 && m <= RESERVE_LEAD_MIN; };
const foodFirst = (s) => { const f = s.food?.(); return Number.isFinite(f) && f <= WEAPON_FIRST.foodAtMost; };

/**
 * Soak 10 (the lead's answer 3, rotn-data's soak 10 answers): the weapon is the wooden club
 * (spartanweaponry:club_wood): 2 logs in the inventory grid, no table; Better Combat damage 4, 131
 * durability at 1 a hit, about 7 hits to kill a zombie or a zombie player. The crude axe is a tool,
 * never a weapon (threats.NOT_WEAPONS): it breaks on its 5th hit, before it kills one zombie.
 * logs: the logs one club takes.
 */
export const CLUB = { item: 'spartanweaponry:club_wood', logs: 2 };
const clubLogs = (s) => (s.countOre?.('logWood') ?? 0) >= CLUB.logs;

export const WEAPON_RESERVE_STEP = {
    id: 'weapon', short: 'hold a weapon for the night', reserve: true, when: 'before night',
    // ctx.foodDue (Fix H): the food reserve is due now; the weapon then comes first by day too.
    // Soak 10 (W2): with no weapon and the logs for a club held, at any time (the club right after the logs step).
    due: (s, ctx = {}) => beforeNight(s) || (!!ctx.foodDue && !foodFirst(s)) || clubLogs(s),
    // Soak 11 (E1): the logs held come first, before night too: a new window, so a fresh budget (weaponWanted).
    whenNow: (s) => (clubLogs(s) ? 'no weapon, logs held' : beforeNight(s) ? 'before night' : 'no weapon, before food'),
    // Soak 10 (W1): a weapon with a kill's worth of hits left (threats.WEAPON.killHits); a crude axe never counts.
    done: (s) => (typeof s.weaponReady === 'function' ? s.weaponReady() !== false : s.hasWeapon?.() !== false),
    // Soak 10 (W2): with the logs held, the driver crafts the club itself (no model call; agenda_driver autoCraftTick).
    autoCraft: { item: CLUB.item, ready: clubLogs },
    goal: 'Night is near and you hold no weapon. Zombies here hit for 3 each, several at once, and dig into shelters; bare hands do not hurt them. '
        + `Craft a wooden club from ${CLUB.logs} logs in your inventory grid (no crafting table needed): !craftRecipe("${CLUB.item}", 1). It hits for 4 and lasts 131 hits: about 7 hits kill a zombie. `
        + 'With fewer logs, get logs first: !collectBlocks("log", 2) (a trunk breaks by hand too, and the crude axe fells a tree). '
        + 'The crude axe is a tool, not a weapon: it breaks on its 5th hit, before it kills one zombie; keep it for the Crafting Tools.',
    goalNow: (s) => {
        const logs = s.countOre?.('logWood') ?? 0;
        const have = `You hold ${logs} log${logs === 1 ? '' : 's'}${logs >= CLUB.logs ? ', enough for a club' : ''}. `;
        const goal = beforeNight(s) ? WEAPON_RESERVE_STEP.goal
            : WEAPON_RESERVE_STEP.goal.replace('Night is near and you hold no weapon.', clubLogs(s)
                ? 'You hold no weapon, and you have the logs for one.'
                : 'You hold no weapon and you are short of food: the weapon comes first (hunting needs one, and zombies attack by day too); the agenda goes on to food once you hold one.');
        return goal.replace('Craft a wooden club', `${have}Craft a wooden club`);
    },
};

/**
 * Soak 7 (d), the lead's rule: the bot respawned at food 12 with nothing to eat; the agenda put the
 * shelter blocks and the weapon first, and the bot first ate 5 min 48 s after its "low" food line
 * (ate_when_low allows 5 min). Within windowMs of a death, at food FOOD_SHORT_AT (12) or lower with no
 * safe food held, the food reserve comes before the shelter reserve and the weapon (with no weapon
 * its goal forages, never hunts: Fix H). windowMs bounds it, so the shelter blocks still get their
 * time before night.
 */
export const FOOD_AFTER_DEATH = { windowMs: 4 * 60_000 };
/** Whether the food reserve comes first now (FOOD_AFTER_DEATH). */
export function foodFirstAfterDeath(s) {
    let since = Infinity, food = null, held = 0;
    try { since = s.sinceDeathMs?.() ?? Infinity; food = s.food?.(); held = s.foodHeld?.() ?? 0; } catch { return false; }
    return Number.isFinite(since) && since <= FOOD_AFTER_DEATH.windowMs && Number.isFinite(food) && food <= FOOD_SHORT_AT && held <= 0;
}

/**
 * Soak 14 (F2, the lead): each death took the dirt piles (60, then 72), and nights 2 and 3 had no shelter
 * (food first after the deaths, then a dirt collect that hung). After a respawn by day, within windowMs of the
 * death, while the night is nightMin minutes away or less and the bot holds fewer blocks than the shelter needs
 * (SHELTER_HOLD), the shelter reserve comes first: before food after a death (FOOD_AFTER_DEATH) and before H3.
 * (After the morning freeze sunset is at most 7.9 min away, inside RESERVE_LEAD_MIN: the reserve is due then anyway.)
 */
export const SHELTER_AFTER_DEATH = { windowMs: 15 * 60_000, nightMin: 15, foodAtMost: 4 };
export function shelterFirstAfterDeath(s) {
    let since = Infinity, m = Infinity, have = 0, food = null, held = 0;
    try { since = s.sinceDeathMs?.() ?? Infinity; m = s.minutesToSunset?.() ?? Infinity; have = reserveHave(s); food = s.food?.(); held = s.foodHeld?.() ?? 0; } catch { return false; }
    // #614 review 8 (the lead): not at food SHELTER_AFTER_DEATH.foodAtMost or lower with no food held: Mining Fatigue
    // refuses the digs then, and food comes first.
    if (Number.isFinite(food) && food <= SHELTER_AFTER_DEATH.foodAtMost && held <= 0) return false;
    return Number.isFinite(since) && since <= SHELTER_AFTER_DEATH.windowMs && m > 0 && m <= SHELTER_AFTER_DEATH.nightMin && have < SHELTER_HOLD;
}

/**
 * Soak 11 (H3, the lead): 22:03:42, 9 min before sunset, the before-night shelter blocks came before
 * food at food 7-8 with no food held (the 4 min after the 21:57 death had gone on the club); food came
 * back at 22:06 at food 6, and the night began at food 4 with nothing to eat (food 0 kills at once).
 * Before night, with no food held, when food would reach EAT_NOW_AT by sunset at the working rate
 * (minPerHunger: about 1 every 2 min with walks, digging and sprints), the food reserve comes before
 * the shelter blocks; the weapon stays ahead of both (2 logs).
 * #588 review 1 (the lead's decision): the night routine takes over at SHELTER_LEAD_MIN, so the
 * agenda's turn before night is only the shelter blocks' window (RESERVE_LEAD_MIN down to
 * SHELTER_LEAD_MIN). Inside it food gets at most ONE run (Agenda.foodBeforeBlocks): until food is
 * held, that run ends, or its budget is spent; then the blocks win for the rest of the window.
 */
// The wait for a picked food run to start (#588 re-review nit 2, #590 review): the driver passes it
// (state.foodStartMs, agenda_driver.foodStartMs): its longest food backoff (BACKOFF_MS doubling over
// stepBudget().attempts runs) plus a tick and FOOD_START_SLACK_MS, never below startMs (the backoff
// clock starts only once a self-prompter loop still finishing a long command is idle) and never above
// half the blocks' window (RESERVE_LEAD_MIN). With no driver (tests, !agenda) startMs itself.
// startSlackMs: from the driver's own start (recordAttempt) to its self-prompter running.
export const FOOD_BEFORE_NIGHT = { minPerHunger: 2, startMs: 120_000, startSlackMs: 10_000 };
/** #588 nit 1: the wait for a picked food run to start: the driver's bound, else FOOD_BEFORE_NIGHT.startMs. */
// #590 re-review nit: the 120 s floor here too, whatever the state passes (agenda.js never imports the driver).
const startBound = (s) => { let ms = null; try { ms = s.foodStartMs?.() ?? null; } catch { ms = null; } return Number.isFinite(ms) && ms > 0 ? Math.max(FOOD_BEFORE_NIGHT.startMs, ms) : FOOD_BEFORE_NIGHT.startMs; };
/** Whether food comes before the shelter blocks now (FOOD_BEFORE_NIGHT). */
export function foodRunsOutBeforeNight(s) {
    let m = Infinity, food = null, held = 0;
    try { m = s.minutesToSunset?.() ?? Infinity; food = s.food?.(); held = s.foodHeld?.() ?? 0; } catch { return false; }
    if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(food) || held > 0) return false;
    return food - m / FOOD_BEFORE_NIGHT.minPerHunger <= EAT_NOW_AT;
}

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
// Soak 14 (F1): held is in points (hunger + saturation, heldFoodPoints), and the saturation counts for the night's need.
const foodShort = (s, ctx = {}) => foodShortfall({ food: s.food?.(), held: s.foodHeld?.() ?? 0, saturation: s.saturation?.() ?? 0,
    minutesToSunset: s.minutesToSunset?.() ?? Infinity, finished: !!ctx.finished, reserveLeadMin: RESERVE_LEAD_MIN });
/** Soak 16 (F2): the food target now (points held), for the scripted food job; null when not short. */
export const foodTargetNow = (s, ctx = {}) => foodShort(s, ctx);

/**
 * G4 #5 (CX23 soak m1: food fell to 1; after the deaths nothing to eat, and once the agenda was
 * done nothing got food). Like the shelter reserve, not a step of the list: judged anew every tick,
 * after the shelter reserve and before the current step, also after "agenda done" (a standing
 * duty), with its own budget. Due by food.foodShortfall: before night the night's need (food.nightFoodNeed, points); once
 * the agenda is done FOOD_TARGET.day; and at once when food is FOOD_SHORT_AT (12) or lower with none held. Never at
 * night: the bot stays sealed. Hunting only wild animals (the !attack guard and the hunting reflex,
 * library/hunting.js). Ripe wild food first (lead, after rotn-data #423): !forage picks wildberry
 * bushes and breaks ripe herbs and gardens (library/foraging.js), then hunting.
 */
export const FOOD_RESERVE_STEP = {
    id: 'food', short: 'hold food items for the day and the night (not the hunger bar)', reserve: true, when: 'food',
    // Soak 16 (F2): a scripted body (agenda_driver AUTO_JOBS.food: forage within 48, then hunt within 64, 4 min a run,
    // 4 runs a day, 3 min apart); not due between its runs (the other steps go on); the model only when a run found
    // nothing in reach (it picks a direction), the day's runs are spent, or in the before-night window.
    autoJob: 'food',
    due: (s, ctx) => foodShort(s, ctx) !== null && !s.jobWaiting?.('food'),
    done: () => false, // done when no longer due (enough held)
    goal: `Food: on this pack food falls about 1 point every 4 minutes at rest (a sealed night costs about 7) and about 1 every 1.5 minutes while walking or hunting, and starving kills: food 0 kills you at once, at any health. Long walks cost hunger. Keep enough food held for the night: you should end the night at food 7 or more (hunger plus saturation, your food bar and what you hold together). Gather ripe wild food first with !forage (wildberry bushes, wild herbs, HarvestCraft gardens); only while you hold a weapon, else hunt a wild pig, cow or sheep near you (2 to 8 meat each; a rabbit drops 0 to 2, a young animal nothing) and pick up the meat (raw meat is safe: 1 hunger each, a rabbit 2, never raw chicken; eat it raw when hungry); with no weapon, do not hunt: make a weapon first. Never an animal with a name tag, on a leash, tamed, or near fences, farms or houses: it may belong to a player. Do not eat raw chicken or rotten flesh unless your food is ${EMERGENCY_FOOD} or lower, and then only these, in this order: ${emergencyFoodText()}; never ${NEVER_EAT_TEXT}. Bread and cooked meat are good night food: you eat by yourself at food ${EAT_AT} or lower, the least valuable food first.`,
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
        // Soak 2: at HUNT_MIN_FOOD (4) or lower weakness leaves the bot unable to hurt an animal; at
        // EMERGENCY_FOOD (5) or lower the eating reflex already eats avoided food (#432 review 3:
        // the two differ by one on purpose: the eating starts a step before the hunting stops).
        const weak = Number.isFinite(food) && food <= HUNT_MIN_FOOD;
        const emergency = Number.isFinite(food) && food <= EMERGENCY_FOOD;
        // Soak 5 (Fix H): with no weapon, forage first; hunting waits for a weapon (the weapon reserve
        // comes first unless food is WEAPON_FIRST.foodAtMost or lower); no animals are named then.
        const armed = s.hasWeapon?.() !== false;
        const near = weak
            ? `At food ${food} you are too weak to hunt (weakness): eat the food you hold, and !forage nearby; do not walk far. `
            : !armed
            ? `You hold no weapon: gather ripe wild food with !forage${crops.length ? '' : ' (berry bushes, wild herbs, HarvestCraft gardens; look around nearby, do not walk far)'}; hunting waits until you hold a weapon. `
            : animals.length
            ? `Near you: ${animals.slice(0, 3).join(', ')}: kill one with !attack("${animals[0]}") and pick up what it drops. `
            : crops.length ? 'No wild animal is near. ' : 'No ripe wild food and no wild animal is near: try !forage once you see berry bushes, herbs or HarvestCraft gardens; or look for an animal (pigs, cows and sheep first, a rabbit only if there is nothing else; on this pack mostly Animania ones, which !searchForEntity("cow"), "pig" or "sheep" also finds) with !searchForEntity (one search also lists every animal in sight: a miss with none in sight means no animal of any kind is near, so try elsewhere), away from fences and houses, then !attack it. ';
        // Soak 13 (C3a): "your food is 13 of 20 ... get to at least 12" read as met (the model ended the goal twice
        // at food 13 holding food worth 4): the step wants food held, and the bar does not count.
        // Soak 14 (F1): in food points (hunger + saturation per item: a cooked meat 2.8, bread 4.2), as the night's need.
        // #612 review 6: in the before-night window the need counts the bar (food.nightFoodNeed): "N more points
        // beyond your bar"; by day the target is food held, and the bar does not count.
        const m = s.minutesToSunset?.() ?? Infinity;
        const night = m > 0 && m <= RESERVE_LEAD_MIN && foodShort(s, ctx) !== null;
        // Soak 16 (F2): the scripted food job found nothing in reach here: the model only picks a direction.
        const kind = s.jobFoundNone?.('food');
        const none = kind === 'noWeapon'
            ? 'The food job found no ripe wild food within 48 blocks, and you hold no weapon to hunt the animals in sight: make a weapon first (a wooden club from 2 logs), or look for ripe wild food elsewhere; the food job runs again by itself once you hold one. '
            : kind
            ? 'The food job (ripe wild food within 48 blocks, animals within 64) found nothing here. Choose a direction you have not been, walk about 100 blocks there with !goToCoordinates, and the food job runs again there by itself. '
            : '';
        return none + `Food: you hold food worth ${held} points in your inventory; `
            + (night ? `for the night you need food worth at least ${target} points held beyond your hunger bar${Number.isFinite(food) ? ` (${food} of 20)` : ''}.`
                : `this step wants food worth at least ${target} points held${Number.isFinite(food) ? ` (your hunger bar, ${food} of 20, does not count toward it)` : ''}.`)
            + ` On this pack food falls about 1 point every 4 minutes at rest (a sealed night costs about 7) and about 1 every 1.5 minutes while walking or hunting, and starving kills. Food 0 kills you at once on this pack, at any health, and long walks cost hunger: stay near. You eat by yourself at food ${EAT_AT} or lower, the least valuable food first: keep the rest. `
            + wild + near + 'Raw meat is safe (1 hunger each, a rabbit 2; never raw chicken): eat it raw when hungry. A pig, cow or sheep drops 2 to 8 meat, a rabbit 0 to 2 (often none): a kill is food only once its meat is in your inventory. Never an animal with a name tag, on a leash, tamed, or near fences, farms or houses: it may belong to a player (the bot refuses those). '
            + (emergency ? `At food ${EMERGENCY_FOOD} or lower, with no other food, eat only these, in this order: ${emergencyFoodText()}; never ${NEVER_EAT_TEXT}.`
                : 'Do not eat raw chicken or rotten flesh; cooked meat and bread are good night food.');
    },
};

export class Agenda {
    /**
     * @param {string} botName
     * @param {{dir?: string, steps?: Array, now?: () => number, reserve?: object|null}} [opts]
     *   reserve: the before-night step (SHELTER_RESERVE_STEP; null for none)
     */
    constructor(botName, { dir = `./bots/${botName}`, steps = ROTN_EARLY_GAME, now = Date.now, reserve = SHELTER_RESERVE_STEP, food = FOOD_RESERVE_STEP, weapon = WEAPON_RESERVE_STEP } = {}) {
        this.file = path.join(dir, 'agenda.json');
        this.steps = steps;
        this.now = now;
        this.reserve = reserve;
        this.food = food; // G4 #5: the food reserve (FOOD_RESERVE_STEP; null for none)
        this.foodOffUntil = 0; // its budget ran out: not asked again before this time
        this.foodDay = { key: null, runs: 0 }; // its runs this in-game day (FOOD_DAY_RUNS)
        this.reserveOff = false; // its budget ran out: not again until the night is past
        this.weapon = weapon; // the before-night weapon (WEAPON_RESERVE_STEP; null for none)
        this.weaponOff = false; // its budget ran out: not again until the night is past
        // #500 follow-up 3: the window (whenNow) it was last judged in. #502 nit 4: saved in
        // agenda.json (weaponOff is not: a restart rebuilds it from the saved spent budget), so a
        // budget spent by day still gets its fresh dusk budget after a restart.
        this.weaponWindow = null;
        // Soak 11 (E2): when its budget ran out (a death after it gives a fresh one). #587 nit 8: saved in
        // agenda.json, and kept when a restart rebuilds weaponOff from the spent budget.
        this.weaponOffAt = null;
        this.weaponDusk = null; // #587 nit 7: whether it was last judged before night; #587 re-review nit 4: saved
        this.finished = false; // "agenda done": only the reserve runs
        this.active = false;
        this.done_at = {}; // step id -> when it was first seen done
        this.spent = {}; // step id -> {attempts, llm_ms}: the self-prompter's runs for it (#164 review)
        this.stuck = {}; // step id -> {why, at, day, retries, cooling, capped}: budgets that ran out (STUCK_RETRY)
        this.standing = null; // the standing goal's window {key, llmMs, starts, lastStartAt, ended} (priority.js)
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
            this.stuck = {};
            if (data.stuck && typeof data.stuck.id === 'string') {
                // Before the #463 decision one stuck step paused the agenda (active false). The step
                // now waits for its retry; the agenda is NOT made active again (#468 review 4): it
                // stays as it was saved, and a task giver's !agendaStart resumes it.
                this.stuck[data.stuck.id] = { why: data.stuck.why ?? null, at: data.stuck.at ?? this.now(), day: null, retries: 0, cooling: true, capped: false };
            } else if (data.stuck && typeof data.stuck === 'object') {
                for (const [id, e] of Object.entries(data.stuck)) if (e && typeof e === 'object') this.stuck[id] = e;
            }
            this.finished = data.finished === true;
            this.standing = data.standing && typeof data.standing.key === 'string' ? data.standing : null;
            this.weaponWindow = typeof data.weaponWindow === 'string' ? data.weaponWindow : null;
            this.weaponOffAt = Number.isFinite(data.weaponOffAt) ? data.weaponOffAt : null;
            this.weaponDusk = typeof data.weaponDusk === 'boolean' ? data.weaponDusk : null;
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
            writeFileSync(tmp, JSON.stringify({ version: 2, active: this.active, finished: this.finished, done_at: this.done_at, spent: this.spent, stuck: this.stuck, standing: this.standing, weaponWindow: this.weaponWindow, weaponOffAt: this.weaponOffAt, weaponDusk: this.weaponDusk, updated_at: this.now() }, null, 2));
            renameSync(tmp, this.file);
            this.existed = true; // a later spawn (a respawn) must not autostart it either
        } catch (err) {
            console.warn(`[agenda] Could not save ${this.file} (${err.message}).`);
        }
    }

    /** Start or resume. A giver's start gives every stuck step a fresh budget and its retries back. */
    start() {
        const stuckIds = Object.keys(this.stuck);
        if (this.active && stuckIds.length === 0) return;
        // A (re)start in this process is a fresh start, not the restart's resume (#327 review 1):
        // e.g. !agendaStop then !agendaStart before the first step line.
        this.loadedActive = false;
        for (const id of stuckIds) delete this.spent[id];
        this.stuck = {};
        this.active = true;
        this.finished = false;
        this.save();
    }
    stop() { if (this.active || this.finished) { this.active = false; this.finished = false; this.save(); } }
    /** All steps done: not active, but the before-night reserve still runs (G3 round 6 B). */
    finish() { this.active = false; this.finished = !!this.reserve || !!this.food || !!this.weapon; this.save(); }

    /** Whether a step id is one of the reserves (the shelter blocks, the weapon, the food). */
    isReserveId(id) { return id != null && (id === this.reserve?.id || id === this.weapon?.id || id === this.food?.id); }
    /**
     * #588 review 1 (the lead): whether food comes before the shelter blocks now (H3,
     * foodRunsOutBeforeNight), for at most one food run inside the blocks' window: once food was
     * picked for it, only while that run goes on (state.foodRunning); after it, the blocks win until
     * the window is over (reset outside it).
     */
    foodBeforeBlocks(state, { readOnly = false } = {}) {
        let window = false;
        try { window = beforeNight(state); } catch { window = false; }
        if (!window) { if (!readOnly) this.h3Run = null; return false; }
        if (!foodRunsOutBeforeNight(state)) return false;
        if (!this.h3Run) return true; // no food run yet in this window
        if (this.h3Run.ended) return false;
        let running = false;
        try { running = !!state.foodRunning?.(); } catch { running = false; }
        if (running) { if (!readOnly) this.h3Run.seen = true; return true; }
        // Picked, its run not started yet (the driver may judge again first, or wait out its backoff):
        // still food, for at most FOOD_BEFORE_NIGHT.startMs; started by the driver (recordAttempt), for
        // startSlackMs until its self-prompter runs; a run seen and now over: the blocks for the rest of
        // the window. #588 re-review nit 5: a self-prompter paused mid-run (a task, an E3 hold) reads as
        // over too: the blocks then, as for a run that ended.
        const now = this.now();
        const waiting = !this.h3Run.seen && (this.h3Run.started != null
            ? now - this.h3Run.started < FOOD_BEFORE_NIGHT.startSlackMs
            : now - this.h3Run.at < startBound(state));
        if (waiting) return true;
        if (!readOnly) this.h3Run.ended = true;
        return false;
    }
    /**
     * H3's one food run in this window was picked (#588 review 1). #588 re-review nit 4: not saved in
     * agenda.json: a restart inside the window may give food one more run there (rare, and bounded by
     * the food budget).
     */
    foodBeforeBlocksRan() { this.h3Run ??= { at: this.now(), started: null, seen: false, ended: false }; }

    /** A reserve, if one is wanted now: the shelter reserve first, then the weapon, then food (G4 #5). */
    anyReserveWanted(state) {
        // Soak 14 (F2): after a respawn by day with the night near and too few blocks: the shelter blocks first.
        if (shelterFirstAfterDeath(state)) { const r = this.reserveWanted(state); if (r) return r; }
        // Soak 7 (d): after a death, hungry with nothing to eat: food first (FOOD_AFTER_DEATH).
        const first = foodFirstAfterDeath(state) ? this.foodWanted(state) : null;
        if (first) return first;
        // Soak 11 (H3): food would run low by sunset with none held: the weapon, then food, then the blocks.
        if (this.foodBeforeBlocks(state)) {
            const w = this.weaponWanted(state, { foodDue: this.foodDue(state) });
            if (w) return w;
            const f = this.foodWanted(state);
            if (f) { this.foodBeforeBlocksRan(); return f; }
            return this.reserveWanted(state);
        }
        return this.reserveWanted(state) ?? this.weaponWanted(state, { foodDue: this.foodDue(state) }) ?? this.foodWanted(state);
    }
    /** A reserve's budget is spent: the shelter reserve and the weapon until the night is past; food for FOOD_RETRY_MS. */
    reserveStuck(id) {
        if (id === this.food?.id) this.foodOffUntil = this.now() + FOOD_RETRY_MS;
        else if (id === this.weapon?.id) { this.weaponOff = true; if (this.weaponOffAt === null) { this.weaponOffAt = this.now(); this.save(); } }
        else this.reserveOff = true;
    }

    /**
     * The before-night weapon (WEAPON_RESERVE_STEP) when it is wanted now: due, none held, budget
     * not spent. Once the night is no longer near, its budget is fresh again for the next dusk.
     */
    weaponWanted(state, { readOnly = false, foodDue = false } = {}) {
        const r = this.weapon;
        if (!r) return null;
        let due = false;
        try { due = !!r.due(state, { foodDue }); } catch { due = false; }
        if (!due) {
            if (!readOnly) {
                this.weaponOff = false; this.weaponOffAt = null; delete this.spent[r.id]; // #468 review 5: a query changes no budget
                if (this.weaponWindow !== null) { this.weaponWindow = null; this.save(); }
            }
            return null;
        }
        // #500 follow-up 3: asked by day (before food) and spent, it gets a fresh budget once its
        // window turns to before night (the soak 3 dusk weapon, #470).
        let window = null;
        try { window = r.whenNow?.(state) ?? null; } catch { window = null; }
        if (!readOnly && window) {
            // Soak 11 (E1): the logs for a club now held (a new window) gives a fresh budget too, before night as
            // by day: 21:25 the bot held 33 logs and no weapon, its budget spent on the search for logs, and the
            // reserve stayed off until the night (the driver's auto-craft never ran).
            const fresh = () => { this.weaponOff = false; this.weaponOffAt = null; delete this.spent[r.id]; };
            if (this.weaponWindow && this.weaponWindow !== window && (window === 'before night' || window === 'no weapon, logs held')) fresh();
            // #587 nit 7: with the logs held all day the window stays 'no weapon, logs held' into the dusk;
            // the dusk still gives a fresh budget (the soak 3 dusk weapon, #470).
            let dusk = false;
            try { dusk = beforeNight(state); } catch { dusk = false; }
            if (dusk && this.weaponDusk === false) fresh();
            if (this.weaponDusk !== dusk) { this.weaponDusk = dusk; this.save(); } // #587 re-review nit 4: a restart inside the dusk keeps it
            if (this.weaponWindow !== window) { this.weaponWindow = window; this.save(); } // #502 nit 4: kept across a restart
        }
        // Soak 11 (E2): a death after the budget was spent (a lost weapon) gives a fresh budget.
        if (this.weaponOff && !readOnly) {
            let since = Infinity;
            try { since = state.sinceDeathMs?.() ?? Infinity; } catch { since = Infinity; }
            if (Number.isFinite(since) && this.now() - since > (this.weaponOffAt ?? Infinity)) { this.weaponOff = false; this.weaponOffAt = null; delete this.spent[r.id]; }
        }
        if (this.weaponOff) return null;
        let done = false;
        try { done = !!r.done(state); } catch { done = false; }
        return done ? null : r;
    }

    /** Whether the food reserve is due now (its rule only: no budget, no day cap; Fix H's weapon-first check). */
    foodDue(state, { standing = false } = {}) {
        const r = this.food;
        if (!r) return false;
        try { return !!r.due(state, { finished: this.finished || standing }); } catch { return false; }
    }

    /**
     * G4 #5: the food reserve when it is wanted now (due by food.foodShortfall, its budget not spent
     * or FOOD_RETRY_MS past, and a run left this day or one running), else null. When it is not due, its budget is fresh for the next time.
     */
    foodWanted(state, { standing = false, readOnly = false } = {}) {
        const r = this.food;
        if (!r) return null;
        let due = false;
        // standing: every step left waits on a stuck one, so food is a standing duty, as once the agenda is done.
        try { due = !!r.due(state, { finished: this.finished || standing }); } catch { due = false; }
        if (!due) {
            if (!readOnly) { delete this.spent[r.id]; this.foodOffUntil = 0; }
            return null;
        }
        if (this.now() < this.foodOffUntil) return null;
        // #468 review 5: a query (readOnly) changes no budget.
        if (this.foodOffUntil && !readOnly) { delete this.spent[r.id]; this.foodOffUntil = 0; } // a fresh budget after the wait
        const key = dayKeyOf(state, this.now());
        if (this.foodDay.key !== key) {
            if (readOnly) return r;
            this.foodDay = { key, runs: 0 };
        }
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
    reserveWanted(state, { readOnly = false } = {}) {
        const r = this.reserve;
        if (!r) return null;
        let due = false;
        try { due = !!r.due(state); } catch { due = false; }
        if (!due) {
            if (!readOnly) { this.reserveOff = false; delete this.spent[r.id]; }
            return null;
        }
        if (readOnly) { // #468 review 5: a query changes no budget
            let done = false;
            try { done = !!r.done(state); } catch { done = false; }
            return this.reserveOff || done ? null : r;
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
        // #588 re-review nit 2: H3's food run starts here (the driver's own start, after its backoff).
        if (id === this.food?.id && this.h3Run && this.h3Run.started == null) this.h3Run.started = this.now();
        const b = this.spentOn(id);
        this.spent[id] = { ...b, attempts: b.attempts + 1 }; // keeps the reserve's need and refresh
        this.save();
    }
    /** Time the self-prompter (the LLM) ran for a step; saved by the caller now and then. */
    addLlmTime(id, ms) {
        const b = this.spentOn(id);
        this.spent[id] = { ...b, llm_ms: b.llm_ms + ms };
    }
    /**
     * A step's budget is spent (#463 decision): it waits for its retry (retryDue), and the agenda goes
     * on with the steps that do not need it. After STUCK_RETRY.max retries it is capped: one retry at
     * each new full day, never given up (#468 review 2). Returns its record ({retries, capped, ...}).
     */
    markStuck(id, why, state = null) {
        const e = this.stuck[id] ?? { retries: 0 };
        let day = null;
        try { day = state?.day?.() ?? null; } catch { day = null; }
        // capped: its STUCK_RETRY.max retries are spent: from now on one retry at each new full day.
        Object.assign(e, { why, at: this.now(), day: Number.isFinite(day) ? day : null, cooling: true, capped: (e.retries ?? 0) >= STUCK_RETRY.max });
        delete e.givenUp; // the field of #468's first version
        this.stuck[id] = e;
        this.save();
        return e;
    }

    /** Whether a step waits (stuck, before its retry). */
    isWaiting(id) { return !!this.stuck[id]?.cooling; }

    /**
     * The stuck steps whose retry is due now: STUCK_RETRY.cooldownMs after it got stuck, or a later
     * in-game day in full daylight; once capped, only the latter (with the day unknown, the cooldown).
     * Each gets a fresh budget. Returns [{id, retry, capped}].
     */
    retryDue(state) {
        const out = [];
        let day = null, t = null;
        try { day = state?.day?.() ?? null; t = state?.timeOfDay?.() ?? null; } catch { day = t = null; }
        for (const [id, e] of Object.entries(this.stuck)) {
            if (!e.cooling) continue;
            const dayKnown = Number.isFinite(day) && Number.isFinite(e.day);
            const nextDay = dayKnown && day > e.day && Number.isFinite(t) && isFullDay(((t % 24000) + 24000) % 24000);
            const cooled = this.now() - e.at >= STUCK_RETRY.cooldownMs;
            if (!(nextDay || (cooled && (!e.capped || !dayKnown)))) continue;
            e.retries = (e.retries ?? 0) + 1;
            e.cooling = false;
            delete this.spent[id];
            out.push({ id, retry: e.retries, capped: !!e.capped });
        }
        if (out.length) this.save();
        return out;
    }

    /**
     * Judge the steps against the bot's state.
     * @returns {{step: object|null, newlyDone: object[]}} step: the first step not done (null: all done)
     */
    evaluate(state) {
        const retried = this.retryDue(state);
        const { step, newlyDone, waiting } = this.judge(state);
        for (const s of newlyDone) { this.done_at[s.id] = this.now(); delete this.stuck[s.id]; }
        if (newlyDone.length) this.save();
        return { step, newlyDone, retried, waiting };
    }

    /**
     * The same judgement without recording anything (for !agenda, #164 review: the driver
     * alone records a step done, so its "agenda step <id> done" line is never swallowed).
     */
    judge(state, { readOnly = false } = {}) {
        const newlyDone = [];
        let step = null;
        // #463 decision: a step waits while it is stuck, and so does every step that needs it
        // (after, directly or through others) and is not done.
        const waits = new Set();
        let waiting = false;
        for (const s of this.steps) {
            // A step once done stays done: crafting the crude axe uses up sticks, and walking away
            // from the table must not send the agenda back. Steps not yet done are judged from the world.
            let done = !!this.done_at[s.id];
            if (!done) {
                try { done = !!s.done(state); } catch { done = false; }
            }
            if (done) {
                if (!this.done_at[s.id]) newlyDone.push(s);
            } else if (this.isWaiting(s.id) || (s.after ?? []).some(a => waits.has(a))) {
                waits.add(s.id);
                waiting = true;
            } else if (!step) {
                step = s;
            }
        }
        // Before night, too few shelter blocks: the reserve comes first (G3 round 6 B); then food (G4 #5).
        // Every step left waits: food as a standing duty (#463 decision); else nothing runnable, and
        // the driver hands over to the open goal (openGoal).
        // readOnly (#468 review 5, !agenda): the reserves are judged without touching their budgets.
        const blocked = waiting && !step;
        // Then a weapon before night (soak 3, lead decision), then food (G4 #5).
        // Soak 5 (Fix H): with no weapon, the weapon before food at any time of day (unless food is
        // WEAPON_FIRST.foodAtMost or lower).
        const foodDue = this.foodDue(state, { standing: blocked });
        // Soak 7 (d): after a death, hungry with nothing to eat: food before the other reserves.
        const first = foodFirstAfterDeath(state) ? this.foodWanted(state, { standing: blocked, readOnly }) : null;
        // Soak 11 (H3): food would run low by sunset with none held: the weapon, then food (one run, #588
        // review 1), then the blocks.
        const h3 = () => {
            const w = this.weaponWanted(state, { readOnly, foodDue });
            if (w) return w;
            const f = this.foodWanted(state, { standing: blocked, readOnly });
            if (f) { if (!readOnly) this.foodBeforeBlocksRan(); return f; }
            return this.reserveWanted(state, { readOnly });
        };
        // Soak 14 (F2): after a respawn by day with the night near and too few blocks: the shelter blocks first.
        const shelterFirst = shelterFirstAfterDeath(state) ? this.reserveWanted(state, { readOnly }) : null;
        const pick = shelterFirst ?? first ?? (this.foodBeforeBlocks(state, { readOnly })
            ? h3()
            : this.reserveWanted(state, { readOnly }) ?? this.weaponWanted(state, { readOnly, foodDue }) ?? this.foodWanted(state, { standing: blocked, readOnly }))
            ?? step;
        return { step: pick, newlyDone, waiting: blocked };
    }

    /** The standing goal's window key: the in-game day ("done@day N"), else a STANDING.windowMs slice of time. */
    standingKey(state, now = this.now()) {
        let day = null;
        try { day = state?.day?.() ?? null; } catch { day = null; }
        return Number.isFinite(day) ? `done@day ${day}` : `done@t ${Math.floor(now / STANDING.windowMs)}`;
    }

    /** The standing goal (STANDING): reserves, tools, exploring by day near the last shelter. */
    standingGoal(state, { shelter = null } = {}) {
        let held = 0, blocks = 0;
        try { held = state?.foodHeld?.() ?? 0; blocks = reserveHave(state); } catch { /* the plain text */ }
        const where = shelter ? `your last shelter at ${shelter.x}, ${shelter.y}, ${shelter.z}` : 'where you are';
        const kind = state && noPickaxe(state) ? 'dirt (no pickaxe yet)' : 'cobblestone first';
        let armed = true;
        try { armed = state?.hasWeapon?.() !== false; } catch { armed = true; }
        return `${STANDING_GOAL_PREFIX}keep food worth at least ${FOOD_TARGET.day} points (you hold ${held}) and ${SHELTER_HOLD} blocks for the night's shelter and its repairs (you have ${blocks}; ${kind}); `
            + (armed ? '' : `${NO_WEAPON_FOOD}; `)
            + 'keep a weapon and a pickaxe, and make better ones when you can (a stone sword or axe, a spare pickaxe); '
            + `explore by day within ${STANDING.exploreRadius} blocks of ${where}, away from where you died (a zombie rises there and stays); `
            + 'be back near it before dusk: the night routine builds the shelter then.';
    }

    /** The current stuck window's key (#468 review 1: the open goal's budget is per window), or null. */
    openGoalKey() {
        const stuck = this.steps.find(s => this.isWaiting(s.id));
        return stuck ? `${stuck.id}@${this.stuck[stuck.id].at}` : null;
    }

    /**
     * #468 review 1: the model's own goal while nothing in the agenda is runnable (every step left
     * waits on a stuck one): which step, what failed, when it is retried; gather what it needs,
     * explore nearby, keep the food and shelter reserves. Null when no step waits.
     */
    openGoal(state = null) {
        const stuck = this.steps.find(s => this.isWaiting(s.id));
        if (!stuck) return null;
        const e = this.stuck[stuck.id];
        const left = Math.max(1, Math.ceil((STUCK_RETRY.cooldownMs - (this.now() - e.at)) / 60_000));
        const when = e.capped ? `its ${STUCK_RETRY.max} retries are spent, so it is retried once at each new full day`
            : `it is retried with a fresh budget in about ${left} min or at the next full day`;
        const blocks = state && noPickaxe(state) ? 'dirt (no pickaxe yet)' : 'cobblestone or stone';
        let unarmed = false;
        try { unarmed = state?.hasWeapon?.() === false; } catch { unarmed = false; }
        return `${OPEN_GOAL_PREFIX}step ${stuck.id} (${stuck.short}) is stuck: ${e.why}; ${when}. Its goal was: ${stuck.goal} `
            + 'Until then: gather the materials it needs, and explore nearby for them (rock piles, dead bushes, trees, a crafting table you placed), '
            + `away from where you died. Keep food worth at least ${FOOD_TARGET.day} points${unarmed ? ` (${NO_WEAPON_FOOD})` : ''}, and keep ${SHELTER_HOLD} blocks of ${blocks} for the night's shelter and its repairs: do not place them.`;
    }
}

/** The agenda as lines for !agenda: "agenda: active, step <id> (<short>); done: a, b". */
export function describeAgenda(agenda, current, newlyDone = []) {
    // newlyDone: steps judge() found done that the driver has not recorded yet.
    const done = agenda.steps.filter(s => agenda.done_at[s.id] || newlyDone.includes(s)).map(s => s.id);
    const state = agenda.active ? 'active' : agenda.finished ? 'done (before night it still keeps the shelter blocks)' : 'stopped';
    const stuck = Object.entries(agenda.stuck ?? {}).map(([id, e]) => (!e.cooling ? `${id} on retry ${e.retries}`
        : e.capped ? `${id} waits for its retry at the next full day (${STUCK_RETRY.max} retries spent)`
        : `${id} waits for retry ${(e.retries ?? 0) + 1} of ${STUCK_RETRY.max}`));
    const waitingAll = !current && stuck.length > 0 && agenda.steps.some(s => !(agenda.done_at[s.id] || newlyDone.includes(s)));
    const now = current ? `step ${current.id} (${current.short})` : waitingAll ? 'the steps left wait' : 'all steps done';
    return `agenda: ${state}, ${now}; done: ${done.length ? done.join(', ') : 'none'}${stuck.length ? `; stuck: ${stuck.join(', ')} (a giver's !agendaStart retries at once)` : ''}`;
}
