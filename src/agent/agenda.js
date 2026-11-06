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
//   agenda step <id> stuck: <why>   (its LLM budget is spent; the agenda pauses)
//   agenda done
// (E3 adds "agenda paused for task <id>" and "agenda resumed: <id>".)
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
        id: 'sticks', short: 'collect 4 sticks',
        // G3 round 4 B and rotn-data Request 13: leaves never drop sticks on this pack; a felled
        // tree does (0-7 with its logs), and a trunk broken by hand fells it too. collectBlock fells
        // it safely (fellTree) and picks the sticks up with the logs.
        goal: 'Get at least 4 sticks with !collectBlocks("stick", 4). In RotN sticks come from felling a tree: breaking its trunk, even by hand, fells it and drops logs and sticks. Leaves drop no sticks.',
        done: (s) => s.count('stick') >= 4 || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'crude_axe', short: 'craft a crude axe',
        goal: 'Craft a crude axe with !craftRecipe("pyrotech:crude_axe", 1): 1 rock and 2 sticks, in your inventory grid. It breaks after about 8 uses, so keep a spare.',
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
        goal: 'Craft Crafting Tools with !craftRecipe("contenttweaker:crafting_tools", 1): the crude axe, 1 rock and 1 stick.',
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

export class Agenda {
    /**
     * @param {string} botName
     * @param {{dir?: string, steps?: Array, now?: () => number}} [opts]
     */
    constructor(botName, { dir = `./bots/${botName}`, steps = ROTN_EARLY_GAME, now = Date.now } = {}) {
        this.file = path.join(dir, 'agenda.json');
        this.steps = steps;
        this.now = now;
        this.active = false;
        this.done_at = {}; // step id -> when it was first seen done
        this.spent = {}; // step id -> {attempts, llm_ms}: the self-prompter's runs for it (#164 review)
        this.stuck = null; // {id, why, at}: a step whose budget ran out; the agenda is paused
        this.loadProblem = null;
        this.existed = false; // a readable agenda.json was there: autostart leaves it alone
        this.load();
    }

    load() {
        if (!existsSync(this.file)) return;
        try {
            const data = JSON.parse(readFileSync(this.file, 'utf8'));
            if (!data || typeof data !== 'object' || typeof data.active !== 'boolean') throw new Error('no agenda state');
            this.active = data.active;
            this.done_at = data.done_at && typeof data.done_at === 'object' ? data.done_at : {};
            this.spent = data.spent && typeof data.spent === 'object' ? data.spent : {};
            this.stuck = data.stuck && typeof data.stuck.id === 'string' ? data.stuck : null;
            this.existed = true;
        } catch (err) {
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
            writeFileSync(tmp, JSON.stringify({ version: 1, active: this.active, done_at: this.done_at, spent: this.spent, stuck: this.stuck, updated_at: this.now() }, null, 2));
            renameSync(tmp, this.file);
            this.existed = true; // a later spawn (a respawn) must not autostart it either
        } catch (err) {
            console.warn(`[agenda] Could not save ${this.file} (${err.message}).`);
        }
    }

    /** Start or resume. A giver's start after a stuck step gives that step a fresh budget. */
    start() {
        if (this.active && !this.stuck) return;
        if (this.stuck) { delete this.spent[this.stuck.id]; this.stuck = null; }
        this.active = true;
        this.save();
    }
    stop() { if (this.active) { this.active = false; this.save(); } }

    /** The self-prompter's budget spent on a step so far. */
    spentOn(id) { return this.spent[id] ?? { attempts: 0, llm_ms: 0 }; }
    /** One more self-prompter run for a step (saved: a crash loop cannot reset it). */
    recordAttempt(id) {
        const b = this.spentOn(id);
        this.spent[id] = { attempts: b.attempts + 1, llm_ms: b.llm_ms };
        this.save();
    }
    /** Time the self-prompter (the LLM) ran for a step; saved by the caller now and then. */
    addLlmTime(id, ms) {
        const b = this.spentOn(id);
        this.spent[id] = { attempts: b.attempts, llm_ms: b.llm_ms + ms };
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
        return { step, newlyDone };
    }
}

/** The agenda as lines for !agenda: "agenda: active, step <id> (<short>); done: a, b". */
export function describeAgenda(agenda, current, newlyDone = []) {
    // newlyDone: steps judge() found done that the driver has not recorded yet.
    const done = agenda.steps.filter(s => agenda.done_at[s.id] || newlyDone.includes(s)).map(s => s.id);
    const state = agenda.stuck ? `paused (step ${agenda.stuck.id} stuck: ${agenda.stuck.why}; a giver's !agendaStart retries it)`
        : agenda.active ? 'active' : 'stopped';
    const now = current ? `step ${current.id} (${current.short})` : 'all steps done';
    return `agenda: ${state}, ${now}; done: ${done.length ? done.join(', ') : 'none'}`;
}
