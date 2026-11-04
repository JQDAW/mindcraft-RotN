// Offline tests for G3 (a), test/scenarios/g3/g3-rocks-to-stone-tools.mjs, and the shared G3 arbiters in
// test/runner/lib/g3.mjs (cheatProblems, statCriterion). A simulated RotN server answers the scenario's
// console commands (count-only clear, scoreboard stats, tp ~ ~ ~, seed) in 1.12's forms (S1-A), and a fake
// agent plays a scripted early game on the fake clock: crafts raise the server's stats and inventory, and
// it chats skills-rotn's agenda lines. No server, no LLM, no network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { runScenario } from '../runner/lib/runner.mjs';
import { G3_CONSOLE_ALLOW, PACK_FIRST_JOIN, cheatProblems, statCriterion } from '../runner/lib/g3.mjs';
import g3a, { G3A_STATS, cobbleOutputs } from '../scenarios/g3/g3-rocks-to-stone-tools.mjs';

const NAME = 'FRCFLD';
const MIN = 60000;
const tick = () => new Promise((r) => setImmediate(r));
const stamp = (ms) => {
    const s = 12 * 3600 + Math.floor(ms / 1000);
    return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const line = (ms, msg) => `[${stamp(ms)}] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: ${msg}`;

const CRIT = Object.fromEntries(G3A_STATS.map((s) => [s.criteria, s.obj]));
const COBBLE = 'undergroundbiomes:metamorphic_cobble';

/** The default early game, in minutes after the join: what the agent crafts, holds and says. */
const PLAY = [
    [3, { craft: 'pyrotech:crude_axe', inv: { 'pyrotech:crude_axe:0': 1 } }],
    [6, { craft: 'contenttweaker:crafting_tools', inv: { 'pyrotech:crude_axe:0': -1, 'contenttweaker:crafting_tools:0': 1 } }],
    [9, { craft: 'minecraft:crafting_table', use: 'minecraft:crafting_table' }],   // crafted and placed at once
    [12, { craft: 'minecraft:stone_pickaxe', inv: { 'minecraft:stone_pickaxe:0': 1 } }],
    [14, { craft: 'minecraft:stone_axe', inv: { 'minecraft:stone_axe:0': 1 } }],
    [18, { inv: { [`${COBBLE}:0`]: 8 }, say: 'agenda step cobblestone done' }],
];

/**
 * opt.play: the script (default PLAY); opt.start: inventory at the join ({'name:meta': n});
 * opt.lines: [[minute, raw log message]] written at that minute; opt.noPack: no first-join pack lines;
 * opt.badCriterion: a criterion the server does not know; opt.kickAt: the minute the bot is kicked.
 */
function sim(opt = {}) {
    const log = [];
    let t = 0;
    let joinT = null;
    let online = false;
    let alive = false;
    const inv = new Map(Object.entries(opt.start ?? {}));
    const stats = new Map();
    const objectives = new Map();
    const sent = [];
    const add = (msg) => log.push(line(t, msg));
    const play = [...(opt.play ?? PLAY)];
    const extra = [...(opt.lines ?? [])];
    const put = (k, n) => inv.set(k, (inv.get(k) ?? 0) + n);
    const stat = (c) => stats.set(c, (stats.get(c) ?? 0) + 1);
    const advance = () => {
        if (joinT === null || !online) return;
        const m = (t - joinT) / MIN;
        while (play.length && play[0][0] <= m) {
            const [, e] = play.shift();
            if (e.craft) stat(statCriterion('craftItem', e.craft));
            if (e.use) stat(statCriterion('useItem', e.use));
            for (const [k, n] of Object.entries(e.inv ?? {})) put(k, n);
            if (e.say) add(`<${NAME}> ${e.say}`);
        }
        while (extra.length && extra[0][0] <= m) add(extra.shift()[1]);
        if (opt.kickAt !== undefined && m >= opt.kickAt) {
            online = false;
            add(`${NAME} lost connection: Kicked by an operator`);
            add(`${NAME} left the game`);
        }
    };
    const count = (item, meta) => [...inv].filter(([k]) => {
        const i = k.lastIndexOf(':');
        return k.slice(0, i) === item && (meta === -1 || Number(k.slice(i + 1)) === meta);
    }).reduce((n, [, v]) => n + v, 0);
    const server = {
        console(cmd, waitS = 1) {
            advance();
            sent.push(cmd);
            const before = log.length;
            let m;
            if ((m = /^say (.*)$/.exec(cmd))) add(`[Server] ${m[1]}`);
            else if (cmd === 'seed') add('Seed: 1880465901402976865');
            else if ((m = /^clear (\S+) (\S+) (-?\d+) 0$/.exec(cmd))) {
                const n = online ? count(m[2], Number(m[3])) : null;
                if (n === null) add(`That player cannot be found`);
                else add(n ? `${m[1]} has ${n} items that match the criteria` : `Could not clear the inventory of ${m[1]}, no items to remove`);
            } else if ((m = /^scoreboard objectives add (\S+) (\S+)$/.exec(cmd))) {
                if (objectives.has(m[1])) add(`An objective with the name '${m[1]}' already exists`);
                else if (m[2] === opt.badCriterion || !(m[2] in CRIT)) add(`Invalid objective criteria type '${m[2]}'`);
                else { objectives.set(m[1], m[2]); add(`Added new objective '${m[1]}' successfully`); }
            } else if ((m = /^scoreboard objectives remove (\S+)$/.exec(cmd))) {
                if (objectives.delete(m[1])) add(`Removed objective '${m[1]}' successfully`);
                else add(`No objective was found by the name '${m[1]}'`);
            } else if (cmd === `scoreboard players list ${NAME}`) {
                const shown = [...objectives].filter(([, c]) => (stats.get(c) ?? 0) > 0);
                if (!shown.length) add(`Player ${NAME} has no scores recorded`);
                else {
                    add(`Showing ${shown.length} tracked objective(s) for ${NAME}:`);
                    for (const [o, c] of shown) add(`- ${o}: ${stats.get(c)} (${o})`);
                }
            } else if (cmd === `tp ${NAME} ~ ~ ~`) add(online ? `Teleported ${NAME} to -44.5, 66.0, -65.5` : 'That player cannot be found');
            t += waitS * 1000;
            return log.slice(before);
        },
        log: (n) => { advance(); return log.slice(-n); },
    };
    const bot = {
        start() {
            alive = true;
            online = true;
            joinT = t;
            log.push(`[${stamp(t)}] [User Authenticator #1/INFO] [net.minecraft.server.network.NetHandlerLoginServer]: UUID of player ${NAME} is 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d`);
            add(`${NAME} joined the game`);
            if (!opt.noPack) {
                add(`[${NAME}: Game rule commandBlockOutput has been updated to false]`);
                add(`[${NAME}: Game rule sendCommandFeedback has been updated to false]`);
                add(`[${NAME}: Given    [Bread] * 1 to ${NAME}]`);
                add(`[${NAME}: Given    [Bundle] * 1 to ${NAME}]`);
            }
        },
        alive: () => alive,
        exitCode: () => (alive ? null : 0),
        output: () => [],
        stop() { alive = false; online = false; return Promise.resolve(); },
    };
    const clock = { now: () => t, sleep: async (ms) => { t += ms; for (let i = 0; i < 3; i++) await tick(); } };
    return { server, bot, clock, sent, objectives, minutes: () => (t - (joinT ?? 0)) / MIN };
}

const fast = { consoleWaitS: 0, lateReplyMs: 2000, latePollMs: 1000, pollMs: 1000 };
const run = (s, params = {}) => runScenario(g3a, { ...s, runId: 'r1', params: { ...fast, ...params } });
const byName = (r) => Object.fromEntries(r.checks.map((c) => [c.check, c]));

describe('the shared G3 arbiters (lib/g3.mjs)', () => {
    const L = (ms, m) => line(ms, m);
    test('cheatProblems allows only the pack\'s first-join commands, once each, right after the first join', () => {
        const lines = [L(0, `${NAME} joined the game`),
            L(1000, `[${NAME}: Game rule commandBlockOutput has been updated to false]`), L(1000, `[${NAME}: Given    [Bread] * 1 to ${NAME}]`)];
        assert.deepEqual(cheatProblems(lines, NAME), { problems: [], packFirstJoin: ['gamerule_commandBlockOutput', 'give_bread'] });
        // The same bread give later, or twice, is a command by the bot.
        const later = cheatProblems([...lines, L(60000, `[${NAME}: Given    [Bread] * 1 to ${NAME}]`)], NAME);
        assert.deepEqual(later.problems, [`the bot ran a command: [${NAME}: Given    [Bread] * 1 to ${NAME}]`]);
        // Before any join line nothing is allowed.
        assert.equal(cheatProblems([L(0, `[${NAME}: Game rule commandBlockOutput has been updated to false]`)], NAME).problems.length, 1);
    });

    test('cheatProblems finds console gives, other senders\' commands on the bot, game mode changes and op', () => {
        const j = L(0, `${NAME} joined the game`);
        for (const msg of [`Given [Stone Pickaxe] * 1 to ${NAME}`, `[JQDAW: Given [Stone Axe] * 1 to ${NAME}]`, `[JQDAW: Set ${NAME}'s game mode to Creative Mode]`,
            `Set ${NAME}'s game mode to Creative Mode`, `Opped ${NAME}`, `[${NAME}: Set own game mode to Creative Mode]`, `[${NAME}: Teleported ${NAME} to 0, 70, 0]`]) {
            assert.equal(cheatProblems([j, L(5000, msg)], NAME).problems.length, 1, msg);
        }
        // Lines about other players, and the bot's own chat, are not cheating.
        assert.deepEqual(cheatProblems([j, L(5000, 'Given [Stone Pickaxe] * 1 to FRCFLD2'), L(6000, `<${NAME}> /give me a pickaxe`), L(7000, '[JQDAW: Given [Bread] * 1 to JQDAW]')], NAME).problems, []);
    });

    test('statCriterion writes 1.12 criteria', () => {
        assert.equal(statCriterion('craftItem', 'pyrotech:crude_axe'), 'stat.craftItem.pyrotech.crude_axe');
        assert.equal(statCriterion('useItem', 'minecraft:crafting_table'), 'stat.useItem.minecraft.crafting_table');
    });
});

describe('g3-rocks-to-stone-tools on a simulated server', () => {
    test('the scenario module: G3, the real agent, maxMinutes 25 and maxBatchUsd 2 compared equal, objective names fit 16 characters', () => {
        assert.equal(g3a.gate, 'G3');
        assert.equal(g3a.llm, true);
        assert.equal(g3a.defaults.maxMinutes, 25);
        assert.equal(g3a.defaults.maxBatchUsd, 2);
        assert.deepEqual(g3a.gateParams, { maxMinutes: 'equal', maxBatchUsd: 'equal' });
        assert.equal(g3a.defaults.worldSeed, '1880465901402976865');
        for (const st of G3A_STATS) assert.ok(st.obj.length <= 16, st.obj);
        // rotn-data's 4-rocks outputs: the Underground Biomes cobbles at the G3 spawn and vanilla cobblestone among them.
        const outs = cobbleOutputs().map((o) => `${o.name}:${o.meta}`);
        assert.ok(outs.includes('minecraft:cobblestone:0') && outs.includes(`${COBBLE}:0`), outs.join(' '));
    });

    test('the early game works: every check passes, it ends at the agent\'s cobblestone line, and only approved commands are sent', async () => {
        const s = sim();
        const r = await run(s);
        const c = byName(r);
        for (const k of Object.keys(g3a.checks)) assert.equal(c[k].pass, true, `${k}: ${c[k].detail} ${r.error ?? ''}`);
        assert.match(r.notes.end.reason, /^done:/);
        assert.ok(r.notes.end.minutes >= 18 && r.notes.end.minutes < 20, String(r.notes.end.minutes));
        assert.deepEqual(Object.keys(r.notes.milestonesMin).sort(), ['g3a_c_crude', 'g3a_c_ctools', 'g3a_c_saxe', 'g3a_c_spick', 'g3a_c_table', 'g3a_u_table']);
        assert.deepEqual(r.notes.cobbleHeld, [{ name: COBBLE, meta: 0, count: 8 }]);
        assert.deepEqual(r.notes.packFirstJoin, PACK_FIRST_JOIN.map((x) => x.id));
        assert.ok(r.notes.track.length >= 18, 'a position every minute');
        for (const cmd of s.sent) assert.ok(G3_CONSOLE_ALLOW.some((re) => re.test(cmd)), `not approved: ${cmd}`);
        assert.equal(s.objectives.size, 0, 'the objectives are removed at the end');
        assert.equal(r.gateValid, true, r.weakenedParams.join('; '));
        assert.deepEqual(r.notes.craftingTablePath, { path: 'placed', useStat: 'added', fallback: false, held: 0, placed: 1 });
    });

    test('the server rejects the table\'s use stat: crafting_table falls back to "held", and the result says so (lead, #201)', async () => {
        const play = PLAY.map(([m, e]) => (e.use ? [m, { craft: e.craft, inv: { 'minecraft:crafting_table:0': 1 } }] : [m, e]));
        const r = await run(sim({ play, badCriterion: statCriterion('useItem', 'minecraft:crafting_table') }));
        const c = byName(r);
        assert.equal(c.crafting_table.pass, true, c.crafting_table.detail);
        assert.match(c.crafting_table.detail, /\(the use stat objective: invalid\)/);
        assert.deepEqual(r.notes.craftingTablePath, { path: 'held', useStat: 'invalid', fallback: true, held: 1, placed: 0 });
        assert.equal(c.crafted_by_bot.pass, true, 'the use stat is not part of crafted_by_bot');
    });

    test('looted tools (held, never crafted): stone_tools passes, crafted_by_bot fails', async () => {
        const play = [[5, { inv: { 'minecraft:stone_pickaxe:0': 1, 'minecraft:stone_axe:0': 1, 'minecraft:crafting_table:0': 1, [`${COBBLE}:0`]: 4 }, say: 'agenda done' }]];
        const r = await run(sim({ play }));
        const c = byName(r);
        assert.equal(c.stone_tools.pass, true);
        assert.equal(c.crafting_table.pass, true);
        assert.equal(c.crafted_by_bot.pass, false);
        assert.match(c.crafted_by_bot.detail, /pyrotech:crude_axe 0/);
        assert.match(r.notes.end.reason, /^maxMinutes \(25\)/, 'no craft stat, so the agent\'s "agenda done" alone does not end the run');
    });

    test('a give to the bot during the run fails no_cheat', async () => {
        const r = await run(sim({ lines: [[4, `Given [Stone Pickaxe] * 1 to ${NAME}`]] }));
        const c = byName(r);
        assert.equal(c.no_cheat.pass, false);
        assert.match(c.no_cheat.detail, /a give to the bot: Given \[Stone Pickaxe\]/);
    });

    test('a stone pickaxe at the start fails fresh_start', async () => {
        const r = await run(sim({ start: { 'minecraft:stone_pickaxe:0': 1 } }));
        assert.equal(byName(r).fresh_start.pass, false);
        assert.match(byName(r).fresh_start.detail, /minecraft:stone_pickaxe 1/);
    });

    test('nothing happens: the run ends at maxMinutes and the item checks fail', async () => {
        const s = sim({ play: [] });
        const r = await run(s);
        const c = byName(r);
        assert.match(r.notes.end.reason, /^maxMinutes \(25\) reached/);
        assert.ok(r.notes.end.minutes >= 25 && r.notes.end.minutes < 27, String(r.notes.end.minutes));
        for (const k of ['stone_tools', 'crafting_table', 'cobblestone', 'crafted_by_bot']) assert.equal(c[k].pass, false, k);
        assert.equal(c.no_cheat.pass, true);
    });

    test('a stuck agenda ends the run early; a kick ends it with the reason', async () => {
        const stuck = await run(sim({ play: [[7, { say: 'agenda step logs stuck: no tree found' }]] }));
        assert.match(stuck.notes.end.reason, /^the agenda is stuck at step logs: no tree found/);
        assert.ok(stuck.notes.end.minutes < 9);
        const kicked = await run(sim({ kickAt: 10 }));
        assert.match(kicked.notes.end.reason, /^the bot is gone: lost \(Kicked by an operator\)/);
        assert.equal(byName(kicked).stone_tools.pass, false);
    });

    test('a craft stat the server does not know fails crafted_by_bot with the reason', async () => {
        const r = await run(sim({ badCriterion: statCriterion('craftItem', 'pyrotech:crude_axe') }));
        assert.equal(byName(r).crafted_by_bot.pass, false);
        assert.match(byName(r).crafted_by_bot.detail, /pyrotech:crude_axe objective invalid/);
        assert.equal(byName(r).stone_tools.pass, true);
    });

    test('a longer maxMinutes or a higher maxBatchUsd is never a gate pass', async () => {
        for (const params of [{ maxMinutes: 30 }, { maxBatchUsd: 5 }]) {
            const r = await run(sim(), params);
            assert.equal(r.gateValid, false, JSON.stringify(params));
            assert.equal(r.pass, false);
        }
    });
});
