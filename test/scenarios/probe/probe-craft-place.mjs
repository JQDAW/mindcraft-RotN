// Probe P1 (net-forge's "Probe plan P1", coord/STATUS-net-forge.md; lead: accepted in principle). It
// shows, on the real RotN 3.3.4 server, what the offline tests cannot:
//   - REID serverbound: window_click stacks with item ids above 4095 are accepted (rock, crude axe,
//     Crafting Tools);
//   - FastWorkbench: right-clicking a crafting table opens FML's "fastbench" window, and a 3x3 craft in it
//     works;
//   - placing and eating on 1.12, with the real block_change latency (it sets place_block_timeout_ms).
// NEVER a gate: run() records P1_NOT_GATE first, so the verdict is at best "SMOKE-PASS (not a gate pass)".
//
// Driver: net-forge's packages/forge-bridge/tools/g1-driver.mjs with its probe commands (#162), started
// with ROTN_DRIVER_PROBE=1. The protocol is summarised in test/runner/lib/probe.mjs. No LLM, no key.
//
// Console (lead: give, effect, setblock, testforblock and clear are allowed for P1 only, on the disposable
// test server): every command goes through guardP1Console, so nothing outside P1_CONSOLE_ALLOW is sent.
// The bot never gets op.
//
// Steps:
//   1. login_online, as in G1/G2; `gamerule doDaylightCycle false`, `time set day`, `tp <bot> -45 66 -66`.
//   2. setup: `clear <bot>`, the gives, `effect <bot> minecraft:hunger 10 10`; the table at -43 66 -66
//      (setblock, then testforblock); each placement cell set to air with stone under it.
//   3. craft_*: probe-craft for each of the four recipes (rotn-data's recipe ids); the driver's reply must
//      be ok, and the server's own count-only `clear <bot> <item> -1 0` must show the plan's counts.
//   4. place_5: probe-place five cobblestones; the driver's reply must be ok and `testforblock` must find
//      minecraft:cobblestone at each. notes.placeLatencyMs records each updateMs.
//   5. eat: probe-eat bread; the driver's ok (food up, one bread fewer) and the server counts 1 bread left.
//   6. `clear <bot>`, the end.
// Window-click transactions and the FastWorkbench window are not in the driver's replies: the evidence
// step reads them from the capture, whose path notes.capture records (the driver's `forge` event).
// The scenario stops early if the driver exits (notes.driverExited).
import crypto from 'node:crypto';
import { startSession } from '../../runner/lib/session.mjs';
import { lastTeleport } from '../../runner/lib/server-log.mjs';
import { giveVerdict, testforblockVerdict } from '../../runner/lib/g2.mjs';
import { clearTestCommand, clearTestCount } from '../../runner/lib/s1.mjs';
import {
    P1_NOT_GATE, P1_PLAN, PROBE_DRIVER_ENV, below, guardP1Console, probeCraft, probeEat, probePlace, probeReply,
} from '../../runner/lib/probe.mjs';

const MS = 1000;
const newToken = () => crypto.randomBytes(6).toString('hex');

/** The capture file the driver reports in its `forge` event, or null. */
export function captureOf(output) {
    for (const l of output) {
        if (!l.startsWith('DRIVER ')) continue;
        try {
            const e = JSON.parse(l.slice(7));
            if (e?.type === 'forge' && e.capture) return e.capture;
        } catch { /* not an event */ }
    }
    return null;
}

export default {
    id: 'probe-craft-place',
    gate: 'P1',
    title: 'Probe P1: crafting (REID ids, FastWorkbench), placing and eating on the real RotN server (a probe, never a gate)',
    checks: {
        login_online: 'The bot logs in with its own account (online mode)',
        setup: 'The test server set the probe up: the items were given and the crafting table stands at its place',
        craft_crude_axe: 'crafttweaker:pyro_crude_axe (2x2) crafted: the driver reports it, and the server counts the crude axe and the rocks left',
        craft_crafting_tools: 'crafttweaker:crafting_tools (2x2) crafted, confirmed by the server\'s counts',
        craft_crafting_table: 'crafttweaker:crafting_table (2x2) crafted, confirmed by the server\'s counts',
        craft_stone_pickaxe: 'crafttweaker:stone_pickaxe (3x3) crafted at the placed table, confirmed by the server\'s counts',
        place_5: 'Five cobblestones placed, each confirmed by testforblock; the block update latency recorded',
        eat: 'Bread eaten: food went up and the server counts one bread less',
    },
    defaults: {
        bot: 'FRCFLD',
        loginTimeoutMs: 240 * MS,
        settleMs: 10 * MS,
        replyTimeoutMs: 75 * MS,   // the driver answers within its own 60 s limit per command
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
        let exited = false;
        const ask = async (cmd, line) => {
            if (!bot.alive()) {
                exited = true;
                return null;
            }
            const t = newToken();
            con(line(t));
            const r = await ctx.waitFor(() => probeReply(bot.output(), cmd, t) ?? (bot.alive() ? null : { exited: true }), p.replyTimeoutMs);
            if (r?.exited) {
                exited = true;
                return null;
            }
            return r;
        };
        const noReply = () => (exited ? 'the driver exited' : `no reply within ${p.replyTimeoutMs / MS}s`);

        // 1. login (the driver with its probe commands on), the fixed time and the landing spot
        const s = await startSession(ctx, { name, env: { ...PROBE_DRIVER_ENV } });
        ctx.check('login_online', s.ok, s.why);
        if (!s.ok) return;
        await clock.sleep(p.settleMs);
        ctx.note('capture', captureOf(bot.output()));
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
            const reply = await ask('craft', (t) => probeCraft(name, t, c.recipeId, c.atTable ? plan.table : null));
            const counts = Object.fromEntries(Object.keys(c.counts).map((item) => [item, count(item)]));
            const countsOk = Object.entries(c.counts).every(([item, want]) => counts[item] === want);
            crafts.push({
                recipeId: c.recipeId, grid: c.grid, ok: reply?.ok ?? null, error: reply?.error ?? (reply ? null : noReply()),
                result: reply?.result ?? null, before: reply?.before ?? null, after: reply?.after ?? null, ms: reply?.ms ?? null,
                variant: reply?.variant ?? null, tableBlock: reply?.tableBlock ?? null, counts, want: c.counts,
            });
            ctx.check(`craft_${c.check}`, reply?.ok === true && countsOk,
                `${reply ? `driver ok=${reply.ok}${reply.error ? ` (${reply.error})` : ''}` : noReply()}; ` +
                Object.entries(c.counts).map(([item, want]) => `${item} ${counts[item] ?? '?'} (want ${want})`).join(', '));
            if (exited) break;
        }
        ctx.note('crafts', crafts);
        if (exited) return ctx.note('driverExited', true);

        // 4. five placements, each confirmed by testforblock
        const places = [];
        for (const cell of plan.place.targets) {
            const reply = await ask('place', (t) => probePlace(name, t, plan.place.item, below(cell), plan.place.face));
            const found = testforblockVerdict(con(`testforblock ${cell.join(' ')} ${plan.place.item}`), cell);
            places.push({ cell, ok: reply?.ok ?? null, updateMs: reply?.updateMs ?? null, totalMs: reply?.totalMs ?? null,
                after: reply?.after ?? null, error: reply?.error ?? (reply ? null : noReply()), server: found.ok });
            if (exited) break;
        }
        ctx.note('places', places);
        ctx.note('placeLatencyMs', places.map((x) => x.updateMs));
        const placed = places.filter((x) => x.ok === true && x.server).length;
        ctx.check('place_5', placed === plan.place.targets.length,
            `${placed}/${plan.place.targets.length} placed and confirmed; update latencies ms: ${places.map((x) => x.updateMs ?? '?').join(', ')}`);
        if (exited) return ctx.note('driverExited', true);

        // 5. eat
        const eat = await ask('eat', (t) => probeEat(name, t, plan.eat.item));
        const breadLeft = count(plan.eat.item);
        ctx.note('eat', eat
            ? { ok: eat.ok, foodBefore: eat.foodBefore, foodAfter: eat.foodAfter, countBefore: eat.countBefore, countAfter: eat.countAfter, ms: eat.ms, error: eat.error ?? null, breadLeft }
            : { reply: null, why: noReply(), breadLeft });
        ctx.check('eat', eat?.ok === true && breadLeft === plan.eat.after,
            eat ? `driver ok=${eat.ok}; food ${eat.foodBefore} -> ${eat.foodAfter}; bread left ${breadLeft ?? '?'} (want ${plan.eat.after})` : `${noReply()}; bread left ${breadLeft ?? '?'}`);
        if (exited) return ctx.note('driverExited', true);

        // 6. the end
        con(`clear ${name}`);
    },
};
