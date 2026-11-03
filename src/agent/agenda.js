// The autonomous agenda (skills-rotn E2; PLAN priority stack level 4).
//
// A RotN progression plan as data: each step has a goal for the self-prompter
// (in the bot's own commands) and a done check over the bot's state that needs
// no LLM. The current step is the first one not done; a step once done stays
// done (crafting uses items up), and a stone pickaxe means the steps before it
// are behind the bot. After a restart it picks up from the file and the world. The LLM is called only by the self-prompter, at its decision
// points; the agenda itself never calls it.
//
// Progress (active or not, when each step was first done) is kept in
// ./bots/<name>/agenda.json, written atomically; a corrupt file is moved aside.
//
// Chat lines for harness-ops (the runner parses them from the server log):
//   agenda step <id> started: <short>
//   agenda step <id> done
//   agenda done
// (E3 adds "agenda paused for task <id>" and "agenda resumed: <id>".)
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * RotN's first day, docs/research/rotn-progression.md section 3, steps 1-9. A rock is any
 * member of the rock ore dictionary (collectBlock and craftNeeds follow rotn-data).
 * done(s): s.count(name) counts the bot's items (a bare name: every variant; "pyrotech:rock":
 * every rock); s.near(block) finds a placed block within 16.
 */
export const ROTN_EARLY_GAME = [
    {
        id: 'rocks', short: 'collect 6 rocks',
        goal: 'Collect at least 6 rocks with !collectBlocks("pyrotech:rock", 6). Rock piles lie on the ground near spawn; break them by hand.',
        done: (s) => s.count('pyrotech:rock') >= 6 || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'sticks', short: 'collect 4 sticks',
        goal: 'Get at least 4 sticks with !collectBlocks("stick", 4). Sticks drop from leaves; punching trees does not work in RotN.',
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
        done: (s) => s.count('log') + s.count('log2') >= 3 || s.count('crafting_table') > 0 || s.near('crafting_table') || s.count('stone_pickaxe') > 0,
    },
    {
        id: 'first_plank', short: 'make the first plank',
        goal: 'Make your first plank: place a log, use the crude axe on it to debark it, then use the axe on the debarked log for a plank.',
        done: (s) => s.count('planks') > 0 || s.count('crafting_table') > 0 || s.near('crafting_table') || s.count('stone_pickaxe') > 0,
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
        done: (s) => (s.count('planks') >= 4 && s.count('stick') >= 4) || s.count('stone_pickaxe') > 0,
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
        goal: 'Mine stone with the stone pickaxe for rocks (!collectBlocks("pyrotech:rock", 8)), then make cobblestone from 4 rocks of one type with !craftRecipe("cobblestone", 1). Aim for 8 cobblestone for a shelter.',
        done: (s) => s.count('cobblestone') >= 8,
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
        this.loadProblem = null;
        this.load();
    }

    load() {
        if (!existsSync(this.file)) return;
        try {
            const data = JSON.parse(readFileSync(this.file, 'utf8'));
            if (!data || typeof data !== 'object' || typeof data.active !== 'boolean') throw new Error('no agenda state');
            this.active = data.active;
            this.done_at = data.done_at && typeof data.done_at === 'object' ? data.done_at : {};
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
            writeFileSync(tmp, JSON.stringify({ version: 1, active: this.active, done_at: this.done_at, updated_at: this.now() }, null, 2));
            renameSync(tmp, this.file);
        } catch (err) {
            console.warn(`[agenda] Could not save ${this.file} (${err.message}).`);
        }
    }

    start() { if (!this.active) { this.active = true; this.save(); } }
    stop() { if (this.active) { this.active = false; this.save(); } }

    /**
     * Judge the steps against the bot's state.
     * @returns {{step: object|null, newlyDone: object[]}} step: the first step not done (null: all done)
     */
    evaluate(state) {
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
                if (!this.done_at[s.id]) {
                    this.done_at[s.id] = this.now();
                    newlyDone.push(s);
                }
            } else if (!step) {
                step = s;
            }
        }
        if (newlyDone.length) this.save();
        return { step, newlyDone };
    }
}

/** The agenda as lines for !agenda: "agenda: active, step <id> (<short>); done: a, b". */
export function describeAgenda(agenda, current) {
    const done = agenda.steps.filter(s => agenda.done_at[s.id]).map(s => s.id);
    const state = agenda.active ? 'active' : 'stopped';
    const now = current ? `step ${current.id} (${current.short})` : 'all steps done';
    return `agenda: ${state}, ${now}; done: ${done.length ? done.join(', ') : 'none'}`;
}
