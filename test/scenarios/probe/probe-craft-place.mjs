// Probe P1 (net-forge's "Probe plan P1", coord/STATUS-net-forge.md; lead: accepted in principle). It
// shows, on the real RotN 3.3.4 server, what the offline tests cannot:
//   - REID serverbound: window_click stacks with item ids above 4095 are accepted (rock, crude axe,
//     Crafting Tools);
//   - FastWorkbench: right-clicking a crafting table opens FML's "fastbench" window, and a 3x3 craft in it
//     works;
//   - placing and eating on 1.12, with the real block_change latency (it sets place_block_timeout_ms).
// NEVER a gate: run() records P1_NOT_GATE first, so the verdict is at best "SMOKE-PASS (not a gate pass)".
//
// Driver: net-forge's packages/forge-bridge/tools/g1-driver.mjs with the probe commands in
// test/runner/lib/probe.mjs (the protocol is written there). No LLM, no OpenRouter key.
//
// Console (lead: give, effect, setblock, testforblock and clear are allowed for P1 only, on the disposable
// test server): every command goes through guardP1Console, so nothing outside P1_CONSOLE_ALLOW is sent.
// The bot never gets op.
//
// Steps:
//   1. login_online, as in G1/G2; `gamerule doDaylightCycle false`, `time set day`, `tp <bot> -45 66 -66`.
//   2. setup: `clear <bot>`, the gives, `effect <bot> minecraft:hunger 10 10`; the table at -43 66 -66
//      (setblock, then testforblock); each placement cell set to air with stone under it.
//   3. craft_*: probe-craft for each of the four recipes; the driver's reply must be ok, and the
//      server's own count-only `clear <bot> <item> -1 0` must show the plan's counts afterwards.
//      transactions_accepted: no craft had a rejected transaction. fastbench_window: the table craft
//      ran in FML's "fastbench" window.
//   4. place_5: probe-place five cobblestones; the driver's reply must be ok and `testforblock` must
//      find minecraft:cobblestone at each. notes.placeLatencyMs records each latency.
//   5. eat: probe-eat bread; ok, foodAfter > foodBefore, and the server counts 1 bread left.
//   6. `clear <bot>`, the end.
import crypto from 'node:crypto';
import { startSession } from '../../runner/lib/session.mjs';
import { lastTeleport } from '../../runner/lib/server-log.mjs';
import { giveVerdict, testforblockVerdict } from '../../runner/lib/g2.mjs';
import { clearTestCommand, clearTestCount } from '../../runner/lib/s1.mjs';
import { P1_NOT_GATE, P1_PLAN, below, guardP1Console, probeCraft, probeEat, probePlace, probeReply } from '../../runner/lib/probe.mjs';

const MS = 1000;
const newToken = () => crypto.randomBytes(6).toString('hex');
const short = (id) => id.split(':')[1];

export default {
    id: 'probe-craft-place',
    gate: 'P1',
    title: 'Probe P1: crafting (REID ids, FastWorkbench), placing and eating on the real RotN server (a probe, never a gate)',
    checks: {
        login_online: 'The bot logs in with its own account (online mode)',
        setup: 'The test server set the probe up: the items were given and the crafting table stands at its place',
        craft_crude_axe: 'pyrotech:crude_axe (2x2) crafted: the driver reports it, and the server counts the result and the rocks used',
        craft_crafting_tools: 'contenttweaker:crafting_tools (2x2) crafted, confirmed by the server\'s counts',
        craft_crafting_table: 'minecraft:crafting_table (2x2) crafted, confirmed by the server\'s counts',
        craft_stone_pickaxe: 'minecraft:stone_pickaxe (3x3) crafted at the placed table, confirmed by the server\'s counts',
        transactions_accepted: 'No craft had a window click the server rejected (REID item ids above 4095 accepted)',
        fastbench_window: 'The table craft ran in FML\'s FastWorkbench window ("fastbench")',
        place_5: 'Five cobblestones placed, each confirmed by testforblock; the block_change latency recorded',
        eat: 'Bread eaten: food went up and the server counts one bread less',
    },
    defaults: {
        bot: 'FRCFLD',
        loginTimeoutMs: 240 * MS,
        settleMs: 10 * MS,
        replyTimeoutMs: 30 * MS,
        pollMs: 1 * MS,
        tpSettleMs: 3 * MS,
        logTail: 20000,
        consoleWaitS: 1,
    },
    gateParams: {},

    async run(ctx) {
        const { bot, clock, params: p } = ctx;
        ctx.notGate(P1_NOT_GATE);
        const server = guardP1Console(ctx.server);
        const name = p.bot;
        const plan = P1_PLAN;
        const con = (cmd) => server.console(cmd, p.consoleWaitS);
        const count = (item) => clearTestCount(con(clearTestCommand(name, item, -1)), name)?.count ?? null;
        const ask = (cmd, line) => {
            const t = newToken();
            con(line(t));
            return ctx.waitFor(() => probeReply(bot.output(), cmd, t), p.replyTimeoutMs);
        };

        // 1. login, the fixed time and the landing spot
        const s = await startSession(ctx, { name });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        await clock.sleep(p.settleMs);
        con('gamerule doDaylightCycle false');
        con('time set day');
        const teleported = lastTeleport(con(`tp ${name} ${plan.landing.join(' ')}`), name);
        await clock.sleep(p.tpSettleMs);
        ctx.note('landing', { planned: plan.landing, teleportedTo: teleported, botPosition: lastTeleport(con(`tp ${name} ~ ~ ~`), name) });

        // 2. setup
        con(`clear ${name}`);
        const gives = plan.gives.map(([item, n, meta]) => ({ item, n, ...giveVerdict(con(`give ${name} ${item} ${n} ${meta}`), name) }));
        con(`effect ${name} minecraft:hunger ${plan.hunger.join(' ')}`);
        con(`setblock ${plan.table.join(' ')} minecraft:crafting_table`);
        const table = testforblockVerdict(con(`testforblock ${plan.table.join(' ')} minecraft:crafting_table`), plan.table);
        for (const cell of plan.place.targets) {
            con(`setblock ${cell.join(' ')} minecraft:air`);
            con(`setblock ${below(cell).join(' ')} minecraft:stone`);
        }
        ctx.note('setup', { gives: gives.map(({ item, n, ok }) => ({ item, n, ok })), table: table.detail });
        const setupOk = gives.every((g) => g.ok) && table.ok;
        ctx.check('setup', setupOk, `${gives.filter((g) => g.ok).length}/${gives.length} gives confirmed; table: ${table.detail}`);
        if (!setupOk) return;

        // 3. the four crafts, each confirmed by the server's own counts
        const crafts = [];
        for (const c of plan.crafts) {
            const reply = await ask('craft', (t) => probeCraft(name, t, c.recipe, c.atTable ? plan.table : null));
            const counts = Object.fromEntries(Object.keys(c.counts).map((item) => [item, count(item)]));
            const countsOk = Object.entries(c.counts).every(([item, want]) => counts[item] === want);
            crafts.push({ recipe: c.recipe, grid: c.grid, ok: reply?.ok ?? null, error: reply?.error ?? (reply ? null : 'no reply'),
                window: reply?.window ?? null, modWindow: reply?.modWindow ?? null, transactions: reply?.transactions ?? null, counts, want: c.counts });
            ctx.check(`craft_${short(c.recipe)}`, reply?.ok === true && countsOk,
                `${reply ? `driver ok=${reply.ok}${reply.error ? ` (${reply.error})` : ''}` : `no reply within ${p.replyTimeoutMs / MS}s`}; ` +
                Object.entries(c.counts).map(([item, want]) => `${item} ${counts[item] ?? '?'} (want ${want})`).join(', '));
        }
        ctx.note('crafts', crafts);
        const rejected = crafts.map((c) => c.transactions?.rejected).filter((n) => n !== undefined);
        const allCounted = crafts.every((c) => Number.isInteger(c.transactions?.rejected));
        ctx.check('transactions_accepted', allCounted && rejected.every((n) => n === 0),
            allCounted ? `rejected per craft: ${rejected.join(', ')}` : 'a craft reply has no transaction counts');
        const atTable = crafts.find((c) => plan.crafts.find((x) => x.recipe === c.recipe)?.atTable);
        const fastbench = atTable?.window === 'fastbench' && atTable?.modWindow?.modId === 'fastbench';
        ctx.check('fastbench_window', fastbench, `table craft window: ${atTable?.window ?? 'none'}, mod window: ${JSON.stringify(atTable?.modWindow ?? null)}`);

        // 4. five placements, each confirmed by testforblock
        const places = [];
        for (const cell of plan.place.targets) {
            const reply = await ask('place', (t) => probePlace(name, t, plan.place.item, below(cell), plan.place.face));
            const found = testforblockVerdict(con(`testforblock ${cell.join(' ')} ${plan.place.item}`), cell);
            places.push({ cell, ok: reply?.ok ?? null, ms: reply?.ms ?? null, name: reply?.name ?? null, error: reply?.error ?? (reply ? null : 'no reply'), server: found.ok });
        }
        ctx.note('places', places);
        ctx.note('placeLatencyMs', places.map((x) => x.ms));
        const placed = places.filter((x) => x.ok === true && x.server).length;
        ctx.check('place_5', placed === plan.place.targets.length,
            `${placed}/${plan.place.targets.length} placed and confirmed; latencies ms: ${places.map((x) => x.ms ?? '?').join(', ')}`);

        // 5. eat
        const eat = await ask('eat', (t) => probeEat(name, t, plan.eat.item));
        const breadLeft = count(plan.eat.item);
        ctx.note('eat', eat ? { ok: eat.ok, foodBefore: eat.foodBefore, foodAfter: eat.foodAfter, ms: eat.ms, error: eat.error ?? null, breadLeft } : { reply: null, breadLeft });
        const ate = eat?.ok === true && Number(eat.foodAfter) > Number(eat.foodBefore) && breadLeft === plan.eat.after;
        ctx.check('eat', ate, eat ? `food ${eat.foodBefore} -> ${eat.foodAfter}; bread left ${breadLeft ?? '?'} (want ${plan.eat.after})` : `no reply within ${p.replyTimeoutMs / MS}s; bread left ${breadLeft ?? '?'}`);

        // 6. the end
        con(`clear ${name}`);
    },
};
