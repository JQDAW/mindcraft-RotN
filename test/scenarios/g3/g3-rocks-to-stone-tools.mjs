// G3 (a), ready-to-try item 4: from a fresh spawn the REAL Mindcraft agent completes RotN's early game with
// RotN recipes: rocks, crude axe, logs, planks, Crafting Tools, crafting table, stone pickaxe and axe,
// cobblestone from rocks. The plan: coord/STATUS-harness-ops.md, "Scenario g3-rocks-to-stone-tools" (lead, #101).
//
// Driver: test/runner/drivers/mindcraft-driver.mjs (main.js with the pinned model, LLM_MODEL in lib/g3.mjs);
// the runner records the LLM calls and cost (llm: true), and a G3 run is gate-valid only under batch.mjs's
// spend stop (maxBatchUsd, USD 2, 'equal'). The runner whispers nothing here: the agent starts its agenda by
// itself on a fresh bot (skills-rotn's E2 autostart).
//
// The server is the arbiter; the agent's own chat only decides WHEN the run ends early:
//   1. login_online (startSession; the world seed must be the G3 world, the G2 seed).
//   2. Stat objectives (approved on #101: scoreboard objectives add|remove, players list), added right
//      after the join: the craft stats of the five crafted items and cobblestone, the crafting table's
//      use stat (1.12 counts a placed block as a use of its item), deaths and play time.
//   3. fresh_start: the pack's first-join Bread and Bundle gives are in this run's log (a first join), and
//      the count-only `clear <bot> <item> -1 0` finds none of the target items: the stone
//      tools, the table, the crude axe, Crafting Tools and every block a 4-rocks recipe makes (rotn-data's
//      rockRecipes; RotN's rocks make different cobbles, so no name is hard-coded).
//   4. Every milestonePollMs (60 s): `scoreboard players list <bot>` (milestones: the minute each craft
//      stat first reaches 1; deaths). No tp of any form (lead, #201 review). The run ends when both stone tools
//      have a craft stat and the agent says "agenda step cobblestone done" or "agenda done", when it says
//      "agenda step <id> stuck" (its agenda pauses; nothing more would happen), when the bot leaves or its
//      driver exits, or at maxMinutes (25, 'equal': a longer limit would be a weaker run).
//   5. The final counts (count-only clear) and the final scores, then the objectives are removed.
// Checks:
//   stone_tools     at least 1 stone pickaxe and 1 stone axe held;
//   crafting_table  at least 1 held, or placed: its use stat is at least 1, or (lead, after round 3
//                   continuation A, where the use stat stayed 0 for a placed table) a cell the bot says it
//                   placed a table at holds minecraft:crafting_table by the server's testforblock, and the
//                   table's craft stat is at least 1;
//   cobblestone     at least 1 of the 4-rocks outputs held (exact name and meta);
//   crafted_by_bot  (gating, lead #101; S1-A found all five stats) the craft stat is at least 1 for the
//                   crude axe, Crafting Tools, the table and both stone tools: looted tools cannot pass;
//   no_cheat        cheatProblems (lib/g3.mjs) finds nothing in the run's log: no command by the bot except
//                   the pack's own first-join ones, no give, no game mode change, no op.
// Not claimed: logs and planks (the table and tools prove them; the debarked plank has no stat).
import { startSession } from '../../runner/lib/session.mjs';
import { G2_WORLD_SEED, testforblockVerdict } from '../../runner/lib/g2.mjs';
import { G3_DEFAULTS, G3_GATE_PARAMS, cheatProblems, guardConsole, statCriterion } from '../../runner/lib/g3.mjs';
import { clearTestCommand, clearTestCount, playerScores, scoreboardAddResult } from '../../runner/lib/s1.mjs';
import { chatLines } from '../../runner/lib/server-log.mjs';
import { lateConsole } from '../../runner/lib/late-console.mjs';
import { rockRecipes } from '../../../packages/rotn-data/index.js';

const MS = 1000;

/** The stat objectives (names at most 16 characters). gates: part of crafted_by_bot. */
export const G3A_STATS = Object.freeze([
    { obj: 'g3a_c_crude', criteria: statCriterion('craftItem', 'pyrotech:crude_axe'), item: 'pyrotech:crude_axe', gates: true },
    { obj: 'g3a_c_ctools', criteria: statCriterion('craftItem', 'contenttweaker:crafting_tools'), item: 'contenttweaker:crafting_tools', gates: true },
    { obj: 'g3a_c_table', criteria: statCriterion('craftItem', 'minecraft:crafting_table'), item: 'minecraft:crafting_table', gates: true },
    { obj: 'g3a_c_spick', criteria: statCriterion('craftItem', 'minecraft:stone_pickaxe'), item: 'minecraft:stone_pickaxe', gates: true },
    { obj: 'g3a_c_saxe', criteria: statCriterion('craftItem', 'minecraft:stone_axe'), item: 'minecraft:stone_axe', gates: true },
    { obj: 'g3a_c_cobble', criteria: statCriterion('craftItem', 'minecraft:cobblestone'), item: 'minecraft:cobblestone', gates: false },
    { obj: 'g3a_u_table', criteria: statCriterion('useItem', 'minecraft:crafting_table'), item: 'minecraft:crafting_table', gates: false },
    { obj: 'g3a_deaths', criteria: 'stat.deaths', gates: false },
    { obj: 'g3a_played', criteria: 'stat.playOneMinute', gates: false },
]);

/** Every block a "4 identical rocks" recipe makes: [{name, meta}], unique (rotn-data, 3.3.4 dump). */
export function cobbleOutputs(recipes = rockRecipes()) {
    const seen = new Map();
    for (const r of recipes) seen.set(`${r.gives.name}:${r.gives.meta ?? 0}`, { name: r.gives.name, meta: r.gives.meta ?? 0 });
    return [...seen.values()];
}

const TOOLS = ['minecraft:stone_pickaxe', 'minecraft:stone_axe'];
/** The pack's first-join gives that fresh_start requires (PACK_FIRST_JOIN ids). */
export const FIRST_JOIN_KIT = ['give_bread', 'give_bundle'];
/** The target items a fresh spawn holds none of (also g3-first-night's fresh_start). */
export const START_EMPTY = [...TOOLS, 'minecraft:crafting_table', 'pyrotech:crude_axe', 'contenttweaker:crafting_tools'];

/** The most placement claims the end checks with testforblock (each is one console command). */
export const MAX_TABLE_CLAIMS = 5;
/**
 * The cells the bot says it placed a crafting table at, from its own output (Mindcraft's placeBlock prints
 * "Placed crafting_table at (x, y, z)."; a "minecraft:" prefix is accepted): distinct cells, the newest
 * MAX_TABLE_CLAIMS. A claim is only a pointer: the server's testforblock decides.
 */
export function tablePlacements(lines) {
    // Anchored on the skill's own log form (lead, #245 review): the exact whole line placeBlock logs
    // (src/agent/library/skills.js), inside the contiguous output block of an action or a mode:
    //   Agent executed: !placeHere and got: Action output:      (or "Mode <m> finished executing, code_return: Action output:")
    //   Placed crafting_table at (-42, 67, -54).
    // Never from the LLM's text: Mindcraft prints a reply as "Generated response: ..." and echoes it as
    // "<bot> full response to system: ""..."""; everything from the first through the echo's closing '""' is
    // skipped, however many lines it spans, so a reply cannot fake a header or a claim. Chat arrives as
    // "<bot> received message from <who>: ..." lines, which never open a block.
    const cells = [];
    let inLlm = false;
    let sawEcho = false;
    let inOutput = false;
    for (const raw of lines) {
        const l = String(raw).replace(/\r$/, '');
        if (inLlm) {
            if (/^\S+ full response to system: ""/.test(l)) sawEcho = true;
            if (sawEcho && l.endsWith('""')) inLlm = false;
            continue;
        }
        if (l.startsWith('Generated response:')) { inLlm = true; sawEcho = false; inOutput = false; continue; }
        if (/^(?:Agent executed: !\w+ and got: |Mode \w+ finished executing, code_return: )Action output:$/.test(l)) { inOutput = true; continue; }
        if (!inOutput) continue;
        if (l.trim() === '') { inOutput = false; continue; }   // the block ends at its blank line
        const m = /^Placed (?:minecraft:)?crafting_table at \((-?\d+), (-?\d+), (-?\d+)\)\.$/.exec(l);
        if (!m) continue;
        const at = [Number(m[1]), Number(m[2]), Number(m[3])];
        const i = cells.findIndex((c) => c.join() === at.join());
        if (i >= 0) cells.splice(i, 1);
        cells.push(at);
    }
    return cells.slice(-MAX_TABLE_CLAIMS);
}
const ENDS = (t) => /^agenda (step cobblestone done|done)$/.test(t);
const STUCK = /^agenda step (\S+) stuck: (.*)$/;

export default {
    id: 'g3-rocks-to-stone-tools',
    gate: 'G3',
    llm: true,
    title: 'From a fresh spawn the agent makes cobblestone, a crafting table and stone tools with RotN recipes (the server counts)',
    checks: {
        login_online: 'Starting the bot makes it log in with its own account (online mode)',
        fresh_start: 'At the start the bot holds none of the target items (a fresh spawn)',
        stone_tools: 'It ends with a stone pickaxe and a stone axe (the server\'s count)',
        crafting_table: 'It has a crafting table, held or placed (count, or the table\'s use stat)',
        cobblestone: 'It holds cobblestone made from rocks (any 4-rocks output, rotn-data)',
        crafted_by_bot: 'The server\'s craft stats show the bot crafted the crude axe, Crafting Tools, the table and both stone tools',
        no_cheat: 'No give, game mode change, op or command by the bot during the run (the pack\'s first-join commands aside)',
    },
    defaults: {
        bot: 'FRCFLD',
        worldSeed: G2_WORLD_SEED,
        maxMinutes: 25,
        ...G3_DEFAULTS,
        loginTimeoutMs: 240 * MS,
        milestonePollMs: 60 * MS,
        pollMs: 1 * MS,
        logTail: 20000,
        consoleWaitS: 1,
        lateReplyMs: 5 * MS,
        latePollMs: 1 * MS,
    },
    gateParams: { maxMinutes: 'equal', ...G3_GATE_PARAMS },
    // The most minutes a run can take from its start (batch.mjs derives its runner timeout from it, plus a margin):
    // the login wait, then maxMinutes from the join.
    runMinutes: (p) => p.loginTimeoutMs / (60 * MS) + p.maxMinutes,

    async run(ctx) {
        const { bot, clock, params: p } = ctx;
        const server = guardConsole(ctx.server);   // run.mjs guards too; the scenario never relies on that alone
        const name = p.bot;
        const s = await startSession(ctx, { name, checkNaming: false });   // say and seed only
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        const lc = lateConsole(server, clock, { waitS: p.consoleWaitS, lateMs: p.lateReplyMs, pollMs: p.latePollMs });
        const confirm = async (cmd, accept) => {
            const n = lc.late().length;
            const lines = await lc.confirm(cmd, accept);
            if (lc.late().length > n) ctx.note('lateReplies', lc.late());
            return lines;
        };
        const count = async (item, meta = -1) => clearTestCount(await confirm(clearTestCommand(name, item, meta), (l) => clearTestCount(l, name) !== null), name)?.count ?? null;
        const scores = async () => playerScores(await confirm(`scoreboard players list ${name}`, (l) => playerScores(l, name) !== null), name);
        const score = (sc, obj) => (sc ? sc[obj] ?? 0 : null);   // an objective with no score yet is absent: 0 (S1-A)

        // 2. stat objectives; a leftover from an earlier run is removed first, so 'exists' never hides a bad criterion.
        // THE UNCOUNTED GAP (#201 review): 1.12 raises a stat objective's score only by later increments
        // (EntityPlayerMP.addStat -> increaseScore); a new objective starts at 0 and is never backfilled. A craft or
        // death between the join and these adds (seconds; the first craft needs rocks and sticks, minutes) is not
        // counted. That fails safe: a missed craft can only fail crafted_by_bot, never pass it.
        for (const st of G3A_STATS) lc.con(`scoreboard objectives remove ${st.obj}`);
        const added = {};
        for (const st of G3A_STATS) {
            added[st.obj] = scoreboardAddResult(await confirm(`scoreboard objectives add ${st.obj} ${st.criteria}`,
                (l) => scoreboardAddResult(l, st.obj, st.criteria) !== null), st.obj, st.criteria);
        }
        ctx.note('objectives', G3A_STATS.map((st) => ({ obj: st.obj, criteria: st.criteria, result: added[st.obj] })));

        // 3. a fresh start: none of the targets held, and the pack's first-join gives seen in this run's log, which
        //    only a fresh player's first join makes (#201 review)
        const outputs = cobbleOutputs();
        const startNames = [...START_EMPTY, ...new Set(outputs.map((o) => o.name))];
        const start = {};
        for (const item of startNames) start[item] = await count(item);
        const held = Object.entries(start).filter(([, n]) => n !== 0);
        ctx.note('startCounts', start);
        const firstJoin = cheatProblems(s.sinceMarker(), name).packFirstJoin;
        const kit = FIRST_JOIN_KIT.filter((id) => !firstJoin.includes(id));
        ctx.check('fresh_start', held.length === 0 && kit.length === 0,
            [held.length ? `held at the start: ${held.map(([i, n]) => `${i} ${n ?? 'no reply'}`).join(', ')}` : `none of ${startNames.length} target items held`,
                kit.length ? `not a first join: the pack's ${kit.join(' and ')} not in this run's log` : 'the pack\'s first-join Bread and Bundle seen'].join('; '));

        // 4. the run
        const joinedAt = s.joinedAt;
        const minutes = () => Math.round(((clock.now() - joinedAt) / (60 * MS)) * 10) / 10;
        const milestones = {};
        const track = [];
        const agendaLines = () => chatLines(s.sinceMarker(), name).map((c) => c.text).filter((t) => /^(agenda|task) /.test(t));
        let end = null;
        let sc = null;
        while (!end) {
            sc = await scores();
            for (const st of G3A_STATS.filter((x) => x.obj.startsWith('g3a_c_') || x.obj === 'g3a_u_table')) {
                if (milestones[st.obj] === undefined && score(sc, st.obj) >= 1) milestones[st.obj] = minutes();
            }
            track.push({ min: minutes(), deaths: score(sc, 'g3a_deaths') });   // no position: no tp in G3 (#201 review)
            ctx.note('milestonesMin', milestones);
            ctx.note('track', track);
            const said = agendaLines();
            const stuck = said.map((t) => STUCK.exec(t)).find(Boolean);
            const gone = s.events().find(s.gone);
            if (gone) end = `the bot is gone: ${gone.type}${gone.reason ? ` (${gone.reason})` : ''}`;
            else if (!bot.alive()) end = `the driver exited with code ${bot.exitCode()}`;
            else if (score(sc, 'g3a_c_spick') >= 1 && score(sc, 'g3a_c_saxe') >= 1 && said.some(ENDS)) end = 'done: both stone tools crafted and the agent reports its cobblestone step done';
            else if (stuck) end = `the agenda is stuck at step ${stuck[1]}: ${stuck[2]}`;
            else if (clock.now() - joinedAt >= p.maxMinutes * 60 * MS) end = `maxMinutes (${p.maxMinutes}) reached`;
            else await clock.sleep(Math.min(p.milestonePollMs, Math.max(MS, joinedAt + p.maxMinutes * 60 * MS - clock.now())));
        }
        ctx.note('end', { reason: end, minutes: minutes() });
        ctx.note('agendaChat', agendaLines());

        // 5. the server's final counts and scores
        const fin = {};
        for (const item of [...TOOLS, 'minecraft:crafting_table']) fin[item] = await count(item);
        const cobble = [];
        for (const o of outputs) {
            const n = await count(o.name, o.meta);
            if (n !== 0) cobble.push({ ...o, count: n });
        }
        sc = await scores();
        ctx.note('finalCounts', fin);
        ctx.note('cobbleHeld', cobble);
        ctx.note('finalScores', sc);
        for (const st of G3A_STATS) lc.con(`scoreboard objectives remove ${st.obj}`);

        ctx.check('stone_tools', TOOLS.every((t) => fin[t] >= 1), TOOLS.map((t) => `${t} ${fin[t] ?? 'no reply'}`).join(', ') + `; ${end}`);
        const placed = score(sc, 'g3a_u_table');
        // The placed block itself (lead, after round 3 continuation A, where the bot placed its table at -42 67 -54
        // but the use stat stayed 0): every cell the bot says it placed a table at ("Placed crafting_table at (x, y,
        // z)" in its own output) is checked read-only with testforblock. A confirmed cell counts only if the table's
        // craft stat is at least 1, so a table that stood there before cannot pass alone.
        const claims = tablePlacements(typeof bot.output === 'function' ? bot.output() : []);
        const onServer = [];
        for (const at of claims) {
            const v = testforblockVerdict(await confirm(`testforblock ${at.join(' ')} minecraft:crafting_table 0`,
                (l) => { const x = testforblockVerdict(l, at); return x.ok || /^The block at /.test(x.detail ?? ''); }), at);
            onServer.push({ at, table: v.ok, detail: v.ok ? 'found' : v.detail });
        }
        const craftedTable = score(sc, 'g3a_c_table') >= 1;
        const placedBlock = craftedTable && onServer.some((x) => x.table);
        // Which path decided it (lead, #201): the use stat ("placed", approved for G3 (a)), the placed block, or the
        // count ("held"); useStat: the objective's add result, so a rejected criterion shows as the fallback.
        const heldN = fin['minecraft:crafting_table'];
        ctx.note('craftingTablePath', {
            path: placed >= 1 ? 'placed' : placedBlock ? 'placed-block' : heldN >= 1 ? 'held' : 'none',
            useStat: added.g3a_u_table ?? null, fallback: added.g3a_u_table !== 'added', held: heldN, placed,
            claims: onServer,
        });
        const blockText = claims.length
            ? `; the bot's placements: ${onServer.map((x) => `${x.at.join(' ')} ${x.table ? 'a table (server)' : x.detail}`).join(', ')}${onServer.some((x) => x.table) && !craftedTable ? ' (not counted: no table craft stat)' : ''}`
            : '; the bot reported no placement';
        ctx.check('crafting_table', heldN >= 1 || placed >= 1 || placedBlock,
            `held ${heldN ?? 'no reply'}, placed (use stat) ${placed ?? 'no scores'}${added.g3a_u_table === 'added' ? '' : ` (the use stat objective: ${added.g3a_u_table ?? 'no reply'})`}${blockText}`);
        const cobbleN = cobble.reduce((n, c) => n + (c.count ?? 0), 0);
        ctx.check('cobblestone', cobble.some((c) => c.count >= 1),
            cobble.length ? cobble.map((c) => `${c.name}:${c.meta} ${c.count ?? 'no reply'}`).join(', ') + ` (${cobbleN} in all)` : `none of the ${outputs.length} 4-rocks outputs held`);
        const gating = G3A_STATS.filter((st) => st.gates);
        const crafted = gating.map((st) => ({ item: st.item, added: added[st.obj], n: score(sc, st.obj) }));
        ctx.check('crafted_by_bot', crafted.every((c) => c.added === 'added' && c.n >= 1),
            crafted.map((c) => `${c.item} ${c.added === 'added' ? c.n ?? 'no scores' : `objective ${c.added ?? 'no reply'}`}`).join(', '));
        const cheat = cheatProblems(s.sinceMarker(), name);
        ctx.note('packFirstJoin', cheat.packFirstJoin);
        ctx.note('packRepeats', cheat.packRepeats);
        ctx.check('no_cheat', cheat.problems.length === 0, cheat.problems.length ? cheat.problems.slice(0, 5).join('; ') : `nothing found (the pack's first-join commands: ${cheat.packFirstJoin.join(', ') || 'none'})`);
    },
};
